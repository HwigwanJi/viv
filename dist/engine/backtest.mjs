import { getFixtureHistory, FIXTURE_NOTICE } from './fixtures.mjs';
import { defaultRisk, validateRisk } from './risk.mjs';
import { defaultStrategy, validateStrategy } from './strategies.mjs';
import { createPortfolio, portfolioMetrics } from './portfolio.mjs';
import { evaluateCycle } from './cycle.mjs';
import { executePaperOrder } from './broker.mjs';
import { isFiniteNumber, reason, timestamp, validateMarket } from './validation.mjs';

export function runBacktest({ strategy = defaultStrategy, risk = defaultRisk, initialCash = 10000000, feeBps, slippageBps, history = getFixtureHistory() } = {}) {
  const effectiveRisk = { ...risk, ...(feeBps === undefined ? {} : { feeBps }), ...(slippageBps === undefined ? {} : { slippageBps }) };
  const errors = [...validateRisk(effectiveRisk), ...validateStrategy(strategy)];
  if (!isFiniteNumber(initialCash) || initialCash <= 0) errors.push(reason('INVALID_INITIAL_CASH', '초기 현금은 양의 유한수여야 합니다.'));
  if (!Array.isArray(history) || history.length < 2) errors.push(reason('INVALID_BACKTEST_HISTORY', '백테스트에는 최소 두 시점이 필요합니다.'));
  if (!errors.length) {
    let previous = -Infinity;
    const observedCloses = new Map();
    for (const market of history) {
      const at = timestamp(market?.asOf);
      if (!Number.isFinite(at) || at <= previous) { errors.push(reason('NON_CHRONOLOGICAL_HISTORY', '백테스트 시점은 엄격하게 과거부터 정렬해야 합니다.')); break; }
      errors.push(...validateMarket(market, { now: market.asOf, maxStalenessMs: effectiveRisk.maxStalenessMs }));
      if (errors.length) break;
      // Prevent a later snapshot from silently revising already-observed data.
      for (const asset of market.assets) {
        for (const bar of asset.prices) {
          const key = `${asset.symbol}:${bar.at}`;
          if (observedCloses.has(key) && observedCloses.get(key) !== bar.close) errors.push(reason('REVISED_HISTORY', '과거 관측 가격을 바꾼 데이터는 사용할 수 없습니다.', { symbol: asset.symbol }));
          observedCloses.set(key, bar.close);
        }
      }
      previous = at;
      if (errors.length) break;
    }
  }
  if (errors.length) return { ok: false, mode: 'paper', synthetic: true, reasons: errors, curve: [], executions: [] };
  let portfolio;
  try { portfolio = createPortfolio({ cash: initialCash, now: history[0].asOf }); }
  catch (error) { return { ok: false, mode: 'paper', synthetic: true, reasons: [reason('INVALID_INITIAL_PORTFOLIO', error.message)], curve: [], executions: [] }; }
  let peak = initialCash, maxDrawdown = 0;
  const curve = [], executions = [], blocked = [];
  let pendingProposals = [];
  for (const market of history) {
    // A decision can only fill on the next observed bar, never its own closing price.
    for (const pending of pendingProposals) {
      const proposal = { ...pending, marketAsOf: market.asOf, decisionAt: pending.marketAsOf };
      const result = executePaperOrder({ portfolio, proposal, market, risk: effectiveRisk, now: market.asOf, clientOrderId: `backtest:${pending.id}` });
      if (result.ok) {
        portfolio = result.portfolio;
        executions.push({ ...result.execution, decisionAt: pending.marketAsOf });
      } else blocked.push({ at: market.asOf, decisionAt: pending.marketAsOf, symbol: proposal.symbol, reasons: result.reasons });
    }
    const cycle = evaluateCycle({ market, portfolio, strategy, risk: effectiveRisk, now: market.asOf });
    if (!cycle.ok) return { ok: false, mode: 'paper', synthetic: true, reasons: cycle.reasons, curve, executions };
    portfolio = cycle.portfolio;
    for (const decision of cycle.decisions.filter(item => !item.allowed && item.action !== 'hold')) blocked.push({ at: market.asOf, ...decision });
    pendingProposals = cycle.proposals;
    const metrics = portfolioMetrics(portfolio, market);
    peak = Math.max(peak, metrics.equity);
    const drawdown = peak > 0 ? (peak - metrics.equity) / peak : 0;
    maxDrawdown = Math.max(maxDrawdown, drawdown);
    curve.push({ at: market.asOf, equity: metrics.equity, cash: portfolio.cash, drawdown, dailyPnl: metrics.dailyPnl });
  }
  const finalEquity = curve.at(-1).equity;
  return {
    ok: true, mode: 'paper', synthetic: true, notice: FIXTURE_NOTICE,
    initialEquity: initialCash, finalEquity, totalReturn: finalEquity / initialCash - 1, totalReturnPct: (finalEquity / initialCash - 1) * 100,
    maxDrawdown, maxDrawdownPct: maxDrawdown * 100, tradeCount: executions.length,
    feesPaid: portfolio.feesPaid, slippagePaid: portfolio.slippagePaid,
    curve, executions, blocked, portfolio, unfilledSignals: pendingProposals.length,
    config: { strategy, risk: effectiveRisk, startAt: history[0].asOf, endAt: history.at(-1).asOf, bars: history.length },
    assumptions: ['정렬된 합성 일봉 종가만 순차 관측', '관측한 신호는 다음 관측 종가에만 수수료·슬리피지를 적용해 모의 체결', '체결 시점 가격·현금·위험 한도를 다시 검사하며 마지막 시점의 신호는 체결하지 않음', '유동성·거래 시간·세금·배당·기업행사·차입·펀딩·환율 모델 제외', '다음 일봉 종가 체결은 연구용 단순화이며 실제 재현 성과가 아님', '결과는 실제 또는 미래 수익 예측이 아님'],
    reasons: [],
  };
}
