export const SUPPORTED_SYMBOLS = Object.freeze(['005930', '000660', 'BTC-KRW', 'ETH-KRW']);
export const isFiniteNumber = value => typeof value === 'number' && Number.isFinite(value);
export const clone = value => structuredClone(value);
export const reason = (code, message, details = {}) => ({ code, message, ...details });
export const money = value => Math.round(value * 1e8) / 1e8;

export function timestamp(value) {
  if (typeof value !== 'string' && typeof value !== 'number' && !(value instanceof Date)) return NaN;
  return new Date(value).getTime();
}

export function koreanDate(value) {
  return new Date(timestamp(value) + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export function validateMarket(market, { now, maxStalenessMs = 900000 } = {}) {
  const errors = [];
  const at = timestamp(market?.asOf);
  const current = timestamp(now);
  if (!Number.isFinite(current)) errors.push(reason('INVALID_NOW', '평가 시각이 올바르지 않습니다.'));
  if (!Number.isFinite(at)) errors.push(reason('INVALID_MARKET_TIME', '시장 데이터 시각이 올바르지 않습니다.'));
  if (Number.isFinite(current) && Number.isFinite(at)) {
    if (at > current) errors.push(reason('FUTURE_MARKET_DATA', '미래 시각의 시장 데이터를 사용할 수 없습니다.'));
    if (current - at > maxStalenessMs) errors.push(reason('STALE_MARKET_DATA', '시장 데이터의 유효 시간이 지났습니다.'));
  }
  if (market?.baseCurrency !== 'KRW') errors.push(reason('INVALID_CURRENCY', '모의 엔진은 원화 기준 데이터만 받습니다.'));
  if (market?.synthetic !== true || market?.source !== 'synthetic-fixture') {
    errors.push(reason('UNSUPPORTED_DATA_SOURCE', '현재 어댑터는 명시적으로 표시한 합성 데이터만 지원합니다.'));
  }
  if (!Array.isArray(market?.assets) || market.assets.length === 0) {
    errors.push(reason('EMPTY_MARKET', '시장 데이터에 자산이 없습니다.'));
    return errors;
  }
  const seen = new Set();
  for (const asset of market.assets) {
    const symbol = asset?.symbol;
    if (!SUPPORTED_SYMBOLS.includes(symbol) || seen.has(symbol)) errors.push(reason('INVALID_SYMBOL', '지원하지 않거나 중복된 자산입니다.', { symbol }));
    seen.add(symbol);
    if (!isFiniteNumber(asset?.price) || asset.price <= 0) errors.push(reason('INVALID_PRICE', '가격은 양의 유한수여야 합니다.', { symbol }));
    if (asset?.currency !== 'KRW') errors.push(reason('INVALID_CURRENCY', '자산 통화가 원화가 아닙니다.', { symbol }));
    if (!isFiniteNumber(asset?.quantityStep) || asset.quantityStep <= 0 || !isFiniteNumber(asset?.minOrderQty) || asset.minOrderQty <= 0 || !isFiniteNumber(asset?.minNotional) || asset.minNotional < 0) {
      errors.push(reason('INVALID_ASSET_RULES', '자산의 주문 단위가 올바르지 않습니다.', { symbol }));
    }
    if (!Array.isArray(asset?.prices) || asset.prices.length === 0) {
      errors.push(reason('MISSING_HISTORY', '자산 가격 이력이 없습니다.', { symbol }));
      continue;
    }
    let previous = -Infinity;
    for (const bar of asset.prices) {
      const barAt = timestamp(bar?.at);
      if (!Number.isFinite(barAt) || barAt <= previous || barAt > at || !isFiniteNumber(bar?.close) || bar.close <= 0) {
        errors.push(reason('INVALID_PRICE_HISTORY', '가격 이력은 유효한 가격과 과거부터 정렬된 시각을 가져야 합니다.', { symbol }));
        break;
      }
      previous = barAt;
    }
    const last = asset.prices.at(-1);
    if (timestamp(last?.at) !== at || last?.close !== asset.price) errors.push(reason('INCONSISTENT_SNAPSHOT', '현재 가격과 마지막 가격 이력이 일치하지 않습니다.', { symbol }));
  }
  return errors;
}

export function validatePortfolio(portfolio) {
  const errors = [];
  if (portfolio?.mode !== 'paper') errors.push(reason('LIVE_MODE_FORBIDDEN', '이 엔진에서는 모의 거래만 가능합니다.'));
  if (portfolio?.baseCurrency !== 'KRW') errors.push(reason('INVALID_CURRENCY', '포트폴리오 기준 통화가 원화가 아닙니다.'));
  for (const key of ['cash', 'initialCash', 'initialEquity', 'feesPaid', 'slippagePaid']) {
    if (!isFiniteNumber(portfolio?.[key]) || portfolio[key] < 0) errors.push(reason('INVALID_PORTFOLIO', `포트폴리오 ${key} 값이 올바르지 않습니다.`));
  }
  if (!isFiniteNumber(portfolio?.realizedPnl)) errors.push(reason('INVALID_PORTFOLIO', '실현손익이 올바르지 않습니다.'));
  if (!portfolio?.positions || typeof portfolio.positions !== 'object' || Array.isArray(portfolio.positions)) {
    errors.push(reason('INVALID_POSITIONS', '보유 자산이 올바르지 않습니다.'));
  } else {
    for (const [symbol, position] of Object.entries(portfolio.positions)) {
      if (!SUPPORTED_SYMBOLS.includes(symbol) || position?.symbol !== symbol || !isFiniteNumber(position?.quantity) || position.quantity < 0 || !isFiniteNumber(position?.averageCost) || position.averageCost < 0 || !isFiniteNumber(position?.realizedPnl) || (position.quantity > 0 && position.averageCost <= 0)) {
        errors.push(reason('INVALID_POSITION', '보유 수량 또는 취득 원가가 올바르지 않습니다.', { symbol }));
      }
    }
  }
  if (!portfolio?.day || !/^\d{4}-\d{2}-\d{2}$/.test(portfolio.day.date) || !isFiniteNumber(portfolio.day.openingEquity) || portfolio.day.openingEquity < 0 || !isFiniteNumber(portfolio.day.realizedPnl)) errors.push(reason('INVALID_DAILY_STATE', '일일 손실 관리 상태가 올바르지 않습니다.'));
  if (!portfolio?.valuation || !Number.isFinite(timestamp(portfolio.valuation.at)) || !isFiniteNumber(portfolio.valuation.equity) || portfolio.valuation.equity < 0) errors.push(reason('INVALID_VALUATION_STATE', '직전 평가 상태가 올바르지 않습니다.'));
  if (!Array.isArray(portfolio?.ledger) || !Array.isArray(portfolio?.orders)) errors.push(reason('INVALID_LEDGER', '주문 또는 거래 원장이 올바르지 않습니다.'));
  return errors;
}

export function floorQuantity(quantity, step) {
  if (!isFiniteNumber(quantity) || !isFiniteNumber(step) || quantity <= 0 || step <= 0) return 0;
  return Number((Math.floor((quantity + step * 1e-7) / step) * step).toFixed(12));
}

export function onQuantityStep(quantity, step) {
  const units = quantity / step;
  return Number.isFinite(units) && Math.abs(units - Math.round(units)) <= Math.max(1e-7, Math.abs(units) * Number.EPSILON * 4);
}
