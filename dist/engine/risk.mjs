import { isFiniteNumber, onQuantityStep, reason, timestamp, validateMarket, validatePortfolio } from './validation.mjs';
import { markTradingDay, portfolioMetrics, valuationErrors } from './portfolio.mjs';

export const HARD_LIMITS = Object.freeze({ maxOrderWeight: 0.10, maxPositionWeight: 0.25, maxDailyLossRatio: 0.02, maxPositionLossRatio: 0.05, maxStalenessMs: 900000 });
export const defaultRisk = Object.freeze({ ...HARD_LIMITS, maxPositionLossRatio: 0.04, feeBps: 10, slippageBps: 10, mode: 'paper' });

export function validateRisk(risk) {
  const errors = [];
  if (!risk || typeof risk !== 'object' || Array.isArray(risk)) return [reason('INVALID_RISK_CONFIG', '위험 관리 설정이 없습니다.')];
  if (risk.mode !== 'paper') errors.push(reason('LIVE_MODE_FORBIDDEN', '실제 거래 모드는 사용할 수 없습니다.'));
  if (Object.keys(risk).some(key => !Object.hasOwn(defaultRisk, key))) errors.push(reason('UNKNOWN_RISK_SETTING', '알 수 없는 위험 관리 설정입니다.'));
  for (const [key, cap] of Object.entries(HARD_LIMITS)) {
    if (!isFiniteNumber(risk[key]) || risk[key] <= 0 || risk[key] > cap) errors.push(reason('INVALID_RISK_LIMIT', `위험 한도 ${key} 값은 0보다 크고 엔진 상한 ${cap} 이하여야 합니다.`, { field: key, cap }));
  }
  for (const key of ['feeBps', 'slippageBps']) if (!isFiniteNumber(risk[key]) || risk[key] < 0 || risk[key] > 1000) errors.push(reason('INVALID_COST_CONFIG', '수수료와 슬리피지는 0~1,000 bp 범위여야 합니다.', { field: key }));
  return errors;
}

export function validateContext({ market, portfolio, risk = defaultRisk, now }) {
  const errors = [...validateRisk(risk), ...validatePortfolio(portfolio)];
  errors.push(...validateMarket(market, { now, maxStalenessMs: isFiniteNumber(risk?.maxStalenessMs) && risk.maxStalenessMs <= HARD_LIMITS.maxStalenessMs ? risk.maxStalenessMs : HARD_LIMITS.maxStalenessMs }));
  if (!errors.length) errors.push(...valuationErrors(portfolio, market));
  if (!errors.length) {
    try { markTradingDay(portfolio, market, now); }
    catch (error) { errors.push(reason('TIME_TRAVEL_FORBIDDEN', error.message)); }
  }
  return errors;
}

export function quoteOrder({ proposal, market, risk = defaultRisk }) {
  const asset = market.assets.find(item => item.symbol === proposal.symbol);
  const referencePrice = asset.price;
  const direction = proposal.side === 'buy' ? 1 : -1;
  const fillPrice = referencePrice * (1 + direction * risk.slippageBps / 10000);
  const gross = fillPrice * proposal.quantity;
  const fee = gross * risk.feeBps / 10000;
  const slippageCost = Math.abs(fillPrice - referencePrice) * proposal.quantity;
  const cashFlow = proposal.side === 'buy' ? -(gross + fee) : gross - fee;
  return { referencePrice, fillPrice, gross, fee, slippageCost, cashFlow, totalCost: gross + fee, netProceeds: gross - fee };
}

export function assessOrder({ market, portfolio, proposal, risk = defaultRisk, now }) {
  const errors = validateContext({ market, portfolio, risk, now });
  if (errors.length) return { allowed: false, reasons: errors };
  if (!proposal || !['buy', 'sell'].includes(proposal.side) || !isFiniteNumber(proposal.quantity) || proposal.quantity <= 0) return { allowed: false, reasons: [reason('INVALID_ORDER', '주문 방향 또는 수량이 올바르지 않습니다.')] };
  const asset = market.assets.find(item => item.symbol === proposal.symbol);
  if (!asset) return { allowed: false, reasons: [reason('UNKNOWN_ASSET', '주문 자산의 시장 데이터가 없습니다.')] };
  if (timestamp(proposal.marketAsOf) !== timestamp(market.asOf)) errors.push(reason('STALE_PROPOSAL', '주문안과 시장 데이터의 시각이 다릅니다.'));
  if (proposal.decisionAt !== undefined && (!Number.isFinite(timestamp(proposal.decisionAt)) || timestamp(proposal.decisionAt) > timestamp(market.asOf))) errors.push(reason('FUTURE_DECISION', '주문 판단 시각이 올바르지 않거나 체결 시각보다 미래입니다.'));
  if (proposal.quantity < asset.minOrderQty || !onQuantityStep(proposal.quantity, asset.quantityStep)) errors.push(reason('INVALID_QUANTITY_STEP', '주문 수량이 최소 수량 또는 주문 단위를 지키지 않습니다.'));
  const nextDay = markTradingDay(portfolio, market, now);
  const metrics = portfolioMetrics(nextDay, market);
  const quote = quoteOrder({ proposal, market, risk });
  if (Object.values(quote).some(value => !isFiniteNumber(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER)) return { allowed: false, reasons: [reason('INVALID_ORDER_VALUE', '주문 금액이 안전한 계산 범위를 벗어났습니다.')] };
  const notional = proposal.quantity * asset.price;
  const equityAfterCosts = metrics.equity - quote.fee - quote.slippageCost;
  if (notional < asset.minNotional) errors.push(reason('BELOW_MINIMUM_NOTIONAL', '최소 주문 금액보다 작습니다.'));
  if (metrics.equity <= 0 || equityAfterCosts <= 0) errors.push(reason('NON_POSITIVE_EQUITY', '주문 가능한 순자산이 없습니다.'));
  const orderCommitment = proposal.side === 'buy' ? quote.totalCost : notional;
  if (orderCommitment > metrics.equity * risk.maxOrderWeight + 1e-7) errors.push(reason('MAX_ORDER_LIMIT', '비용을 포함한 1회 주문 한도를 넘었습니다.'));
  const currentQty = portfolio.positions[proposal.symbol]?.quantity || 0;
  if (proposal.side === 'buy') {
    const averageCost = portfolio.positions[proposal.symbol]?.averageCost || 0;
    if (currentQty > 0 && averageCost > 0 && asset.price / averageCost - 1 <= -risk.maxPositionLossRatio) errors.push(reason('POSITION_LOSS_LIMIT', '개별 보유 손실 기준에 도달하여 추가 매수를 멈춥니다.'));
    if (quote.totalCost > portfolio.cash + 1e-7) errors.push(reason('INSUFFICIENT_CASH', '수수료·슬리피지를 포함한 현금이 부족합니다.'));
    if ((currentQty + proposal.quantity) * asset.price > equityAfterCosts * risk.maxPositionWeight + 1e-7) errors.push(reason('MAX_POSITION_LIMIT', '주문 후 자산별 보유 한도를 넘습니다.'));
    const projectedDailyLoss = nextDay.day.openingEquity > 0 ? (nextDay.day.openingEquity - equityAfterCosts) / nextDay.day.openingEquity : 0;
    if (metrics.dailyLossRatio >= risk.maxDailyLossRatio || projectedDailyLoss > risk.maxDailyLossRatio + Number.EPSILON) errors.push(reason('DAILY_LOSS_LIMIT', '일일 손실 한도에 도달하여 신규 매수를 멈춥니다.'));
  } else if (proposal.quantity > currentQty + 1e-10) errors.push(reason('INSUFFICIENT_HOLDINGS', '매도 가능한 보유 수량이 부족합니다.'));
  return { allowed: errors.length === 0, reasons: errors.length ? errors : [reason('RISK_CHECK_PASSED', '주문이 모든 엔진 위험 한도를 통과했습니다.')], quote, metrics };
}
