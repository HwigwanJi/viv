import { assessOpportunity } from './opportunity.mjs';
import { isFiniteNumber, timestamp } from './validation.mjs';

export const CLUTCH_NOTICE = '기회 집중 원칙을 가격 조건·수익 중 증액·추적 청산으로 구성한 연구 정책입니다. 매개변수의 설계 가정과 검증 결과를 정책 버전별로 보관합니다.';
export const CLUTCH_DEFAULTS = Object.freeze({ shortWindow: 5, longWindow: 20, breakoutWindow: 20, trendThreshold: 0.01, minOpportunity: 0.55, baseWeightRatio: 0.35, addProfitThreshold: 0.015, trailingStopRatio: 0.06 });
export const CLUTCH_PARAMETER_SCHEMA = Object.freeze([
  { key: 'shortWindow', label: '단기 관측', type: 'number', unit: '봉', min: 2, max: 100, step: 1 },
  { key: 'longWindow', label: '장기 관측', type: 'number', unit: '봉', min: 3, max: 500, step: 1 },
  { key: 'breakoutWindow', label: '돌파 관측', type: 'number', unit: '봉', min: 3, max: 500, step: 1 },
  { key: 'trendThreshold', label: '추세 기준', type: 'number', unit: 'ratio', min: 0.001, max: 0.2, step: 0.001 },
  { key: 'minOpportunity', label: '최소 기회 점수', type: 'number', unit: 'ratio', min: 0.05, max: 0.95, step: 0.05 },
  { key: 'baseWeightRatio', label: '기본 목표 비중 배수', type: 'number', unit: 'ratio', min: 0.05, max: 1, step: 0.05 },
  { key: 'addProfitThreshold', label: '증액에 필요한 평가 이익', type: 'number', unit: 'ratio', min: 0, max: 0.2, step: 0.005 },
  { key: 'trailingStopRatio', label: '관측 고점 대비 청산 하락', type: 'number', unit: 'ratio', min: 0.005, max: 0.3, step: 0.005 },
].map(item => Object.freeze(item)));

export function validateClutchParameters(parameters) {
  if (!parameters || typeof parameters !== 'object' || Array.isArray(parameters) || Object.keys(parameters).some(key => !Object.hasOwn(CLUTCH_DEFAULTS, key))) return false;
  const p = { ...CLUTCH_DEFAULTS, ...parameters };
  return CLUTCH_PARAMETER_SCHEMA.every(field => isFiniteNumber(p[field.key]) && p[field.key] >= field.min && p[field.key] <= field.max && (field.unit !== '봉' || Number.isInteger(p[field.key]))) && p.longWindow > p.shortWindow;
}

// Recheck the winner-only requirement at fill time, including a next-bar gap.
export function assessClutchFill({ asset, portfolio, proposal }) {
  if (proposal?.strategyId !== 'clutch' || proposal.side !== 'buy') return { allowed: true };
  const position = portfolio?.positions?.[proposal.symbol];
  if (!position || position.quantity <= 0) return { allowed: true };
  const minimum = proposal.minimumAddProfitRatio;
  if (!isFiniteNumber(minimum) || minimum < 0 || minimum > 0.2) return { allowed: false, code: 'CLUTCH_EXECUTION_POLICY_REQUIRED', message: '기회 집중 증액 주문에 검증 가능한 최소 평가 이익 조건이 없습니다.' };
  const pnl = asset.price / position.averageCost - 1;
  if (!isFiniteNumber(pnl) || pnl <= 0 || pnl < minimum) return { allowed: false, code: 'CLUTCH_ADD_PROFIT_LOST_AT_FILL', message: '체결 시점의 평가 이익이 증액 조건보다 낮아 기회 집중 추가 매수를 취소합니다.' };
  return { allowed: true };
}

// A trailing peak must belong to this uninterrupted holding, not a pre-entry rally.
// If the complete current holding cannot be reconstructed, do not invent a peak.
export function observeOpenPosition(asset, portfolio, marketAsOf) {
  const position = portfolio?.positions?.[asset.symbol];
  if (!position || position.quantity === 0) return { held: false, traceable: true, indicators: {} };
  const pnl = asset.price / position.averageCost - 1;
  const incomplete = () => ({ held: true, traceable: false, indicators: { positionPnlRatio: pnl } });
  if (!Array.isArray(portfolio?.ledger) || !isFiniteNumber(pnl)) return incomplete();
  let quantity = 0, entryAt = null, previousAt = -Infinity;
  const fills = [];
  for (const row of portfolio.ledger.filter(item => item?.symbol === asset.symbol)) {
    const at = timestamp(row.at);
    if (!Number.isFinite(at) || at < previousAt || at > timestamp(marketAsOf) || !['buy', 'sell'].includes(row.side) || !isFiniteNumber(row.quantity) || row.quantity <= 0 || !isFiniteNumber(row.fillPrice) || row.fillPrice <= 0) return incomplete();
    previousAt = at;
    if (row.side === 'buy') {
      if (quantity === 0) { entryAt = at; fills.length = 0; }
      quantity += row.quantity;
      fills.push({ at, price: row.fillPrice });
    } else {
      quantity -= row.quantity;
      if (quantity < -1e-10) return incomplete();
      if (Math.abs(quantity) <= 1e-10) { quantity = 0; entryAt = null; fills.length = 0; }
    }
  }
  const tolerance = Math.max(1e-10, Math.abs(position.quantity) * 1e-10);
  if (entryAt === null || Math.abs(quantity - position.quantity) > tolerance || !Array.isArray(asset.prices) || timestamp(asset.prices[0]?.at) > entryAt) return incomplete();
  const observations = asset.prices.filter(bar => timestamp(bar.at) >= entryAt && timestamp(bar.at) <= timestamp(marketAsOf));
  if (!observations.length || observations.some(bar => !isFiniteNumber(bar.close) || bar.close <= 0)) return incomplete();
  const highWaterPrice = Math.max(...observations.map(bar => bar.close), ...fills.map(fill => fill.price));
  const trailingDrawdown = Math.max(0, 1 - asset.price / highWaterPrice);
  if (![highWaterPrice, trailingDrawdown].every(isFiniteNumber)) return incomplete();
  return { held: true, traceable: true, indicators: { positionPnlRatio: pnl, highWaterPrice, trailingDrawdown } };
}

export function evaluateClutchPolicy(asset, parameters, context = {}) {
  const p = { ...CLUTCH_DEFAULTS, ...parameters };
  const opportunity = assessOpportunity(asset, p);
  const position = observeOpenPosition(asset, context.portfolio, context.marketAsOf || context.now);
  const indicators = { ...opportunity.indicators, ...position.indicators };
  const result = (action, code, reason, extra = {}) => ({ action, strength: action === 'hold' ? 0 : opportunity.score, code, reason, indicators, regime: opportunity.regime, opportunityScore: opportunity.score, ...extra });
  if (position.held && !position.traceable) return result('hold', 'CLUTCH_POSITION_HISTORY_REQUIRED', '현재 보유의 진입부터 이어지는 체결·가격 이력이 부족하여 증액과 추적청산을 보류합니다. 공통 손실 보호는 별도로 작동합니다.');
  if (position.held && position.indicators.positionPnlRatio > 0 && position.indicators.trailingDrawdown >= p.trailingStopRatio) {
    return result('sell', 'CLUTCH_TRAILING_EXIT', `진입 이후 관측 고점 대비 ${(position.indicators.trailingDrawdown * 100).toFixed(2)}% 하락하여 이익 중 추적청산 후보를 만듭니다. 관측 사이 손실을 제한한다고 보장하지 않습니다.`);
  }
  if (!opportunity.ready) return result('hold', opportunity.code, '국면·기회 계산에 필요한 가격 이력이 부족하여 판단을 보류합니다.');
  if (position.held && position.indicators.positionPnlRatio <= 0) return result('hold', 'CLUTCH_NO_LOSING_ADD', '평가 손실 또는 손익분기 상태에서는 추가 매수하지 않습니다.');
  if (position.held && position.indicators.positionPnlRatio < p.addProfitThreshold) return result('hold', 'CLUTCH_PROFIT_NOT_CONFIRMED', `증액에 필요한 평가 이익 ${(p.addProfitThreshold * 100).toFixed(2)}%에 도달하지 않았습니다.`);
  if (!['trending', 'burning'].includes(opportunity.regime)) return result('hold', 'CLUTCH_NO_ACTIVE_OPPORTUNITY', '현재 가격 국면은 집중 진입·증액 조건을 만족하지 않습니다.');
  if (opportunity.score < p.minOpportunity) return result('hold', 'CLUTCH_SCORE_BELOW_ENTRY', `기회 점수 ${(opportunity.score * 100).toFixed(0)}점이 진입 기준 ${(p.minOpportunity * 100).toFixed(0)}점보다 낮습니다.`);
  const concentration = Math.max(0, Math.min(1, (opportunity.score - p.minOpportunity) / (1 - p.minOpportunity)));
  const targetWeightFactor = p.baseWeightRatio + (1 - p.baseWeightRatio) * concentration;
  indicators.targetWeightFactor = targetWeightFactor;
  return result('buy', position.held ? 'CLUTCH_WINNER_ADD' : 'CLUTCH_OPPORTUNITY_ENTRY', `${opportunity.regime === 'burning' ? '강한 추세' : '상승 추세'} 국면 · 가격조건 충족도 ${(opportunity.score * 100).toFixed(0)}점. ${position.held ? '수익 중인 보유만 증액' : '새 기회에 진입'}하며 설정 목표 비중의 ${(targetWeightFactor * 100).toFixed(0)}%를 사용합니다.`, { targetWeightFactor, minimumAddProfitRatio: p.addProfitThreshold });
}
