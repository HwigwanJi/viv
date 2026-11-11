import { DEFAULT_MODEL_CONFIG, FOUR_HOURS_MS, DAY_MS, MODEL_VERSION, precomputeFeatures, assertPreparedSeries, decideSnapshot, resolveModelConfig, TradingModelError } from './model.mjs';

export const BACKTEST_ASSUMPTIONS = Object.freeze([
  'UTC 4시간봉 마감에 판단하고 바로 다음 연속 봉의 시가에서 모의 체결한다. 판단 봉 종료와 다음 봉 시작은 같은 시각이며 이벤트 순서는 마감 판단→다음 시가 체결이다.',
  '시가 체결은 처리·통신 지연을 0으로 둔 연구 가정이다. 관측 누락을 건너뛴 체결 후보는 취소한다.',
  '수수료 기본값은 편도 10bps, 슬리피지 기본값은 0bps이다. 매수·매도 체결가의 슬리피지와 수수료 현금흐름을 각각 기록한다.',
  '매 판단의 목표 비중을 다음 시가에서 재검사한다. 반복 Sell은 25% 초과분만 축소하고, 현재 비중이 25% 이하면 수량을 유지한다. 반복 Buy는 목표 미달분만 매수한다.',
  '현물 소수 수량과 전략 전용 USDT 현금으로 계산한다. 거래소 최소 주문액·호가 단위·유동성·세금은 후속 실행 어댑터의 검증 항목이다.',
  '기본 비교는 요청 기간을 유지하고 준비 기간을 현금 Hold로 기록한다. 준비 후 정렬 비교 옵션은 별도 기간과 첫 준비 시각을 반환한다.',
  '마지막 보유량은 마지막 종가로 평가한다. 종료 시 강제 청산을 추가하지 않는다.',
  '매매 횟수는 실제 모의 체결 건수다. 부분 매도도 한 건이며, 상위 이익 기여는 양의 실현손익이 발생한 매도 체결을 기준으로 계산한다.',
  'Sharpe는 수수료·슬리피지를 반영한 4시간 계좌 수익률의 모집단 표준편차와 sqrt(365×6), 무위험 수익률 0을 사용한다. CAGR은 실제 기간의 365일 연율이다.',
  '선택 기간의 평가 곡선에 누락된 4시간 구간이 있으면 Sharpe를 null로 반환하고 누락 수익률 구간 수를 기록한다. 누락 수익률을 보간하지 않는다.',
]);
const finite = value => typeof value === 'number' && Number.isFinite(value);
const iso = value => new Date(value).toISOString();
const time = value => typeof value === 'number' ? value : Date.parse(value);
const check = (condition, code, message) => { if (!condition) throw new TradingModelError(code, message); };

function executeTarget(account, decision, bar, index, feeRate, slippageRate) {
  if (!['buy', 'sell'].includes(decision.action)) return null;
  if (decision.allocationAction === 'keep') return null;
  const referencePrice = bar[1], equityBefore = account.cash + account.quantity * referencePrice;
  const currentValue = account.quantity * referencePrice;
  const beforeWeight = equityBefore > 0 ? currentValue / equityBefore : 0;
  const targetWeight = decision.action === 'buy' ? Math.max(beforeWeight, decision.targetWeight) : Math.min(beforeWeight, decision.targetWeight);
  const side = decision.action;
  const fillPrice = referencePrice * (side === 'buy' ? 1 + slippageRate : 1 - slippageRate);
  let quantity;
  if (side === 'buy') {
    const lossPerUnit = fillPrice * (1 + feeRate) - referencePrice;
    quantity = Math.max(0, (targetWeight * equityBefore - currentValue) / (referencePrice + targetWeight * lossPerUnit));
    quantity = Math.min(quantity, account.cash / (fillPrice * (1 + feeRate)));
  } else {
    const lossPerUnit = referencePrice - fillPrice * (1 - feeRate);
    quantity = Math.max(0, (currentValue - targetWeight * equityBefore) / (referencePrice - targetWeight * lossPerUnit));
    quantity = Math.min(quantity, account.quantity);
  }
  if (!finite(quantity) || quantity <= Math.max(1e-12, account.quantity * 1e-12)) return null;
  const gross = fillPrice * quantity, fee = gross * feeRate, slippageCost = Math.abs(fillPrice - referencePrice) * quantity;
  const cashFlow = side === 'buy' ? -(gross + fee) : gross - fee;
  const realizedPnl = side === 'sell' ? cashFlow - account.averageCost * quantity : 0;
  if (side === 'buy') {
    const nextQuantity = account.quantity + quantity;
    account.averageCost = (account.averageCost * account.quantity + gross + fee) / nextQuantity;
    account.quantity = nextQuantity;
  } else {
    account.quantity -= quantity;
    if (account.quantity <= 1e-12) { account.quantity = 0; account.averageCost = 0; }
  }
  account.cash += cashFlow;
  if (Math.abs(account.cash) <= Math.max(1e-8, equityBefore * 1e-12)) account.cash = 0;
  account.feesPaid += fee; account.slippagePaid += slippageCost; account.realizedPnl += realizedPnl;
  check(account.cash >= -1e-7 && account.quantity >= 0 && [account.cash, account.quantity, account.averageCost].every(finite), 'ACCOUNTING_ERROR', '체결 후 현금·수량·원가가 유효 범위를 벗어났습니다.');
  const equityAfter = account.cash + account.quantity * referencePrice;
  return { id: `paper:${index}:${side}`, mode: 'paper', side, quantity, referencePrice, fillPrice, gross, fee, slippageCost, cashFlow, realizedPnl, cashAfter: account.cash, quantityAfter: account.quantity, averageCostAfter: account.averageCost, equityAfter, targetWeight, beforeWeight, afterWeight: equityAfter > 0 ? account.quantity * referencePrice / equityAfter : 0, decisionAt: decision.asOf, decisionBarOpenTime: decision.decisionBarOpenTime, at: iso(bar[0]), fillBarOpenTime: bar[0], decisionCode: decision.code };
}

function performance({ initialCash, curve, fills, account, start, end, turnover }) {
  const finalEquity = curve.at(-1)?.equity ?? initialCash;
  const totalReturn = finalEquity / initialCash - 1;
  const years = (end - start) / (365 * DAY_MS);
  const annual = years > 0 ? (finalEquity / initialCash) ** (1 / years) - 1 : null;
  const returns = []; let previous = initialCash;
  for (const point of curve) { returns.push(point.equity / previous - 1); previous = point.equity; }
  const mean = returns.length ? returns.reduce((sum, value) => sum + value, 0) / returns.length : 0;
  const std = returns.length ? Math.sqrt(returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / returns.length) : 0;
  const irregularReturnCount = curve.filter((point, index) => index > 0 && Date.parse(point.at) - Date.parse(curve[index - 1].at) !== FOUR_HOURS_MS).length;
  const sharpe = irregularReturnCount === 0 && std > 0 ? mean / std * Math.sqrt(365 * 6) : null;
  const sharpeStatus = irregularReturnCount > 0 ? 'unavailable-data-gap' : std > 0 ? 'available' : 'unavailable-zero-variance';
  const sharpeReason = irregularReturnCount > 0 ? '평가 곡선이 누락된 4시간 구간을 건너므로 고정 간격 Sharpe 연율화를 보류했다.' : std > 0 ? null : '계좌 수익률의 표준편차가 0이어서 Sharpe를 계산할 수 없다.';
  const exits = fills.filter(fill => fill.side === 'sell');
  const wins = exits.filter(fill => fill.realizedPnl > 0).sort((a, b) => b.realizedPnl - a.realizedPnl);
  const losses = exits.filter(fill => fill.realizedPnl < 0);
  const grossProfit = wins.reduce((sum, fill) => sum + fill.realizedPnl, 0), grossLoss = -losses.reduce((sum, fill) => sum + fill.realizedPnl, 0);
  const averageWin = wins.length ? grossProfit / wins.length : null, averageLoss = losses.length ? grossLoss / losses.length : null;
  const topWinners = wins.slice(0, 5).map(fill => ({ id: fill.id, at: fill.at, realizedPnl: fill.realizedPnl, shareOfPositiveRealizedPnl: grossProfit > 0 ? fill.realizedPnl / grossProfit : null }));
  return { initialEquity: initialCash, finalEquity, totalReturn, totalReturnPct: totalReturn * 100, CAGR: finite(annual) ? annual : null, maxDrawdown: curve.reduce((maximum, point) => Math.max(maximum, point.drawdown), 0), sharpe, sharpeStatus, sharpeReason, irregularReturnCount, tradeCount: fills.length, buyCount: fills.filter(fill => fill.side === 'buy').length, sellCount: exits.length, feesPaid: account.feesPaid, slippagePaid: account.slippagePaid, totalCosts: account.feesPaid + account.slippagePaid, turnover, realizedPnl: account.realizedPnl, unrealizedPnl: finalEquity - initialCash - account.realizedPnl, averageExposure: curve.length ? curve.reduce((sum, point) => sum + point.exposure, 0) / curve.length : 0, maximumExposure: curve.reduce((maximum, point) => Math.max(maximum, point.exposure), 0), inMarketRatio: curve.length ? curve.filter(point => point.quantity > 0).length / curve.length : 0, averageWin, averageLoss, payoffRatio: averageWin !== null && averageLoss !== null ? averageWin / averageLoss : null, profitFactor: grossLoss > 0 ? grossProfit / grossLoss : null, topThreeProfitShare: grossProfit > 0 ? wins.slice(0, 3).reduce((sum, fill) => sum + fill.realizedPnl, 0) / grossProfit : null, topWinners };
}

export function runTradingBacktest(dataset, { config: inputConfig = DEFAULT_MODEL_CONFIG, initialCash = 100000, feeBps = 10, slippageBps = 0, startAt, endAt, alignStartToReady = false, prepared, mode = 'model' } = {}) {
  try {
    const config = resolveModelConfig(inputConfig);
    check(finite(initialCash) && initialCash > 0 && initialCash <= 1e12 && finite(feeBps) && feeBps >= 0 && feeBps <= 1000 && finite(slippageBps) && slippageBps >= 0 && slippageBps <= 1000, 'INVALID_BACKTEST_CONFIG', '초기 자금과 체결 비용이 유효 범위를 벗어났습니다.');
    check(typeof alignStartToReady === 'boolean' && ['model', 'buy-and-hold'].includes(mode), 'INVALID_BACKTEST_CONFIG', '실험 모드 또는 기간 정렬 설정이 올바르지 않습니다.');
    const series = prepared ? assertPreparedSeries(prepared, config) : precomputeFeatures(dataset, { config });
    const { bars, features } = series;
    const start = startAt === undefined ? bars[0]?.[0] : time(startAt), end = endAt === undefined ? bars.at(-1)?.[0] + FOUR_HOURS_MS : time(endAt);
    check(finite(start) && finite(end) && end > start && bars.length > 1 && features.length === bars.length, 'INVALID_BACKTEST_WINDOW', '실험 기간에 완결 4시간봉이 충분하지 않습니다.');
    let first = bars.findIndex(bar => bar[0] >= start), last = bars.findLastIndex(bar => bar[0] + FOUR_HOURS_MS <= end);
    check(first >= 0 && last >= first, 'EMPTY_BACKTEST_WINDOW', '선택 기간에 완결 관측이 없습니다.');
    const requestedFirst = first;
    if (alignStartToReady) {
      first = bars.findIndex((bar, index) => index >= requestedFirst && index <= last && index > 0 && features[index - 1].ready && bars[index - 1][0] + FOUR_HOURS_MS === bar[0]);
      check(first >= 0, 'NO_READY_WINDOW', '선택 기간에 준비를 마친 뒤 체결할 관측이 없습니다.');
    }
    const account = { mode: 'paper', currency: 'USDT', cash: initialCash, quantity: 0, averageCost: 0, feesPaid: 0, slippagePaid: 0, realizedPnl: 0 };
    const curve = [], fills = [], canceled = [], decisions = [];
    let peak = initialCash, turnover = 0, readyBars = 0, warmupBars = 0, latestDecision = null;
    let pending = first > 0 ? decideSnapshot(features[first - 1], { config, currentWeight: 0 }) : null;
    for (let index = first; index <= last; index++) {
      const bar = bars[index], feature = features[index];
      if (mode === 'buy-and-hold' && index === first) pending = { action: 'buy', targetWeight: 1, code: 'BUY_AND_HOLD_START', asOf: iso(bar[0]), decisionBarOpenTime: bar[0] - FOUR_HOURS_MS };
      const contiguous = index > 0 && bars[index - 1][0] + FOUR_HOURS_MS === bar[0];
      if (pending && (mode === 'buy-and-hold' && index === first || contiguous)) {
        const fill = executeTarget(account, pending, bar, index, feeBps / 10000, slippageBps / 10000);
        if (fill) { fills.push(fill); turnover += fill.gross; }
      } else if (pending && pending.action !== 'hold' && pending.allocationAction !== 'keep') canceled.push({ code: 'MISSING_NEXT_BAR_OPEN', decisionAt: pending.asOf, nextObservedOpen: iso(bar[0]) });
      const equity = account.cash + account.quantity * bar[4], exposure = equity > 0 ? account.quantity * bar[4] / equity : 0;
      peak = Math.max(peak, equity);
      latestDecision = decideSnapshot(feature, { config, currentWeight: exposure });
      if (feature.ready) readyBars++; else warmupBars++;
      decisions.push({ at: feature.asOf, action: latestDecision.action, targetWeight: latestDecision.targetWeight, ready: latestDecision.ready, code: latestDecision.code });
      pending = mode === 'model' ? latestDecision : null;
      curve.push({ at: feature.asOf, openTime: bar[0], equity, cash: account.cash, quantity: account.quantity, exposure, drawdown: peak > 0 ? (peak - equity) / peak : 0, ready: feature.ready, action: mode === 'buy-and-hold' ? 'hold' : latestDecision.action });
    }
    const firstReady = features.find(feature => feature.ready && feature.availableAt >= start && feature.availableAt <= end);
    const metrics = performance({ initialCash, curve, fills, account, start: bars[first][0], end: bars[last][0] + FOUR_HOURS_MS, turnover });
    return { ok: true, mode: 'paper', modelVersion: MODEL_VERSION, strategyId: mode === 'buy-and-hold' ? 'buy-and-hold' : config.sellTargetWeight === 0 ? 'btc-price-sell0' : 'btc-price-sell25', source: series.source, config, costs: { feeBps, slippageBps }, metrics, curve, fills, canceled, decisions, account, latestDecision: mode === 'model' ? latestDecision : null, unfilledLastDecision: mode === 'model' && pending?.action !== 'hold' ? pending : null, coverage: { requestedStartAt: iso(start), requestedEndAt: iso(end), actualStartAt: iso(bars[first][0]), actualEndAt: iso(bars[last][0] + FOUR_HOURS_MS), alignedToReady: alignStartToReady, firstReadyAt: firstReady?.asOf ?? null, firstFillAt: fills[0]?.at ?? null, totalBars: last - first + 1, readyBars, warmupBars, warmupDays: warmupBars / 6, readyRatio: readyBars / (last - first + 1), sourceGapCount: series.quality.gaps.length, irregularReturnCount: metrics.irregularReturnCount, canceledForMissingOpen: canceled.length }, quality: series.quality, assumptions: [...series.assumptions, ...BACKTEST_ASSUMPTIONS] };
  } catch (error) { return { ok: false, mode: 'paper', modelVersion: MODEL_VERSION, reasons: [{ code: error.code || 'BACKTEST_ERROR', message: error.message }], curve: [], fills: [] }; }
}

export function compareTradingModels(dataset, options = {}) {
  const config = resolveModelConfig(options.config ?? DEFAULT_MODEL_CONFIG);
  const prepared = precomputeFeatures(dataset, { config });
  const variants = [
    { id: 'spec25', label: '가격 구조 · Sell 25% 유지', config },
    { id: 'spec0', label: '가격 구조 · Sell 전량 청산', config: { ...config, sellTargetWeight: 0 } },
    { id: 'buy-and-hold', label: '바이앤홀드', config, mode: 'buy-and-hold' },
  ];
  const results = variants.map(variant => ({ id: variant.id, label: variant.label, result: runTradingBacktest(dataset, { ...options, prepared, config: variant.config, mode: variant.mode ?? 'model' }) }));
  return { ok: results.every(item => item.result.ok), mode: 'paper', modelVersion: MODEL_VERSION, source: prepared.source, results, assumptions: [...prepared.assumptions, ...BACKTEST_ASSUMPTIONS] };
}
