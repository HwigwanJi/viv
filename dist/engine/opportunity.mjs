import { isFiniteNumber } from './validation.mjs';

export const OPPORTUNITY_REGIMES = Object.freeze(['quiet', 'trending', 'burning', 'cooling', 'unknown']);
const clamp = value => Math.max(0, Math.min(1, value));
const average = values => values.reduce((sum, value) => sum + value, 0) / values.length;

// This is a close-price research heuristic, not a calibrated probability or VIX proxy.
export function assessOpportunity(asset, parameters) {
  const { shortWindow, longWindow, breakoutWindow, trendThreshold } = parameters || {};
  const windowsValid = [shortWindow, longWindow, breakoutWindow].every(value => Number.isInteger(value) && value >= 2 && value <= 500);
  const required = Math.max(longWindow || 0, (breakoutWindow || 0) + 1, (shortWindow || 0) + 1);
  if (!windowsValid || longWindow <= shortWindow || !isFiniteNumber(trendThreshold) || trendThreshold <= 0 || !Array.isArray(asset?.prices) || asset.prices.length < required) {
    return { ready: false, regime: 'unknown', score: 0, indicators: {}, code: 'CLUTCH_INSUFFICIENT_HISTORY' };
  }
  const closes = asset.prices.map(bar => bar.close);
  if (closes.some(value => !isFiniteNumber(value) || value <= 0) || asset.price !== closes.at(-1)) {
    return { ready: false, regime: 'unknown', score: 0, indicators: {}, code: 'CLUTCH_INVALID_OBSERVATION' };
  }
  const shortAverage = average(closes.slice(-shortWindow));
  const longAverage = average(closes.slice(-longWindow));
  const previousHigh = Math.max(...closes.slice(-breakoutWindow - 1, -1));
  const trendGap = shortAverage / longAverage - 1;
  const momentum = asset.price / closes.at(-shortWindow - 1) - 1;
  const breakoutDistance = asset.price / previousHigh - 1;
  const returns = closes.slice(-longWindow).slice(1).map((close, index) => Math.log(close / closes[closes.length - longWindow + index]));
  const returnMean = average(returns);
  const closeVolatility = Math.sqrt(average(returns.map(value => (value - returnMean) ** 2)));
  const trendComponent = clamp((trendGap - trendThreshold * 0.5) / (trendThreshold * 2.5));
  const momentumComponent = clamp(momentum / (trendThreshold * 4));
  const breakoutComponent = clamp(0.5 + breakoutDistance / (trendThreshold * 2));
  const score = clamp(0.45 * trendComponent + 0.35 * momentumComponent + 0.20 * breakoutComponent);
  let regime;
  if (trendGap <= -trendThreshold || momentum < -trendThreshold) regime = 'cooling';
  else if (Math.abs(trendGap) < trendThreshold && Math.abs(momentum) < trendThreshold) regime = 'quiet';
  else if (trendGap >= trendThreshold * 2 && momentum > 0 && breakoutDistance >= 0 && score >= 0.75) regime = 'burning';
  else if (trendGap >= trendThreshold && momentum > 0) regime = 'trending';
  else regime = 'cooling';
  const indicators = { opportunityScore: score, shortAverage, longAverage, previousHigh, trendGap, momentum, breakoutDistance, closeVolatility };
  if (Object.values(indicators).some(value => !isFiniteNumber(value))) return { ready: false, regime: 'unknown', score: 0, indicators: {}, code: 'CLUTCH_INVALID_OBSERVATION' };
  return { ready: true, regime, score, indicators, code: 'CLUTCH_OPPORTUNITY' };
}
