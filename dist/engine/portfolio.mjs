import { clone, isFiniteNumber, koreanDate, reason, timestamp, validatePortfolio } from './validation.mjs';

export function createPortfolio({ cash = 10000000, positions = {}, now = new Date().toISOString() } = {}) {
  const copiedPositions = clone(positions);
  const initialCost = Object.values(copiedPositions).reduce((total, item) => total + item.quantity * item.averageCost, 0);
  const portfolio = {
    id: 'local-paper-portfolio', mode: 'paper', baseCurrency: 'KRW', cash, initialCash: cash,
    initialEquity: cash + initialCost, positions: copiedPositions, realizedPnl: 0,
    feesPaid: 0, slippagePaid: 0,
    day: { date: koreanDate(now), openingEquity: cash + initialCost, realizedPnl: 0 },
    valuation: { at: new Date(timestamp(now)).toISOString(), equity: cash + initialCost },
    ledger: [], orders: [],
  };
  const errors = validatePortfolio(portfolio);
  if (errors.length) throw new TypeError(errors.map(item => item.message).join(' '));
  return portfolio;
}

export function portfolioMetrics(portfolio, market) {
  const holdings = Object.values(portfolio.positions).filter(position => position.quantity > 0).map(position => {
    const asset = market.assets.find(item => item.symbol === position.symbol);
    if (!asset) throw new TypeError(`가격이 없는 보유 자산: ${position.symbol}`);
    const value = position.quantity * asset.price;
    return { ...position, price: asset.price, value, costBasis: position.quantity * position.averageCost, unrealizedPnl: value - position.quantity * position.averageCost };
  });
  const holdingsValue = holdings.reduce((sum, holding) => sum + holding.value, 0);
  const equity = portfolio.cash + holdingsValue;
  const unrealizedPnl = holdings.reduce((sum, holding) => sum + holding.unrealizedPnl, 0);
  const result = { cash: portfolio.cash, holdingsValue, equity, realizedPnl: portfolio.realizedPnl, unrealizedPnl, totalPnl: equity - portfolio.initialEquity, feesPaid: portfolio.feesPaid, slippagePaid: portfolio.slippagePaid, dailyPnl: equity - portfolio.day.openingEquity, dailyLossRatio: portfolio.day.openingEquity > 0 ? Math.max(0, (portfolio.day.openingEquity - equity) / portfolio.day.openingEquity) : 0, holdings: holdings.map(item => ({ ...item, weight: equity > 0 ? item.value / equity : 0 })) };
  if (Object.values(result).some(value => typeof value === 'number' && (!isFiniteNumber(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER))) throw new TypeError('포트폴리오 평가 금액이 안전한 계산 범위를 벗어났습니다.');
  return result;
}

export function markTradingDay(portfolio, market, now) {
  const date = koreanDate(now);
  const next = clone(portfolio);
  if (next.day.date > date || timestamp(next.valuation.at) > timestamp(now)) throw new TypeError('포트폴리오의 직전 평가보다 과거로 이동할 수 없습니다.');
  if (next.day.date !== date) next.day = { date, openingEquity: next.valuation.equity, realizedPnl: 0 };
  next.valuation = { at: new Date(timestamp(now)).toISOString(), equity: portfolioMetrics(next, market).equity };
  return next;
}

export function valuationErrors(portfolio, market) {
  try { portfolioMetrics(portfolio, market); return []; }
  catch (error) { return [reason('INVALID_VALUATION', error.message)]; }
}
