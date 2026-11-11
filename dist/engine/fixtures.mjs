import { timestamp } from './validation.mjs';

export const FIXTURE_NOTICE = '합성 시장 데이터 · 실제 시세 및 투자 성과가 아닙니다.';
const ASSET_DEFINITIONS = [
  { symbol: '005930', name: '삼성전자', kind: 'stock', base: 70000, slope: 0.0020, phase: 0.2, quantityStep: 1, minOrderQty: 1, minNotional: 0 },
  { symbol: '000660', name: 'SK하이닉스', kind: 'stock', base: 150000, slope: 0.0015, phase: 1.5, quantityStep: 1, minOrderQty: 1, minNotional: 0 },
  { symbol: 'BTC-KRW', name: '비트코인', kind: 'crypto', base: 85000000, slope: 0.0026, phase: 2.7, quantityStep: 0.00000001, minOrderQty: 0.00000001, minNotional: 5000 },
  { symbol: 'ETH-KRW', name: '이더리움', kind: 'crypto', base: 3300000, slope: 0.0007, phase: 4.1, quantityStep: 0.00000001, minOrderQty: 0.00000001, minNotional: 5000 },
];

function fixturePrice(asset, index) {
  const movement = 1 + index * asset.slope + 0.07 * Math.sin(index / 8 + asset.phase) + 0.02 * Math.sin(index / 3 + asset.phase);
  const unit = asset.kind === 'stock' ? 10 : 1000;
  return Math.round(asset.base * movement / unit) * unit;
}

export function getFixtureHistory({ endAt = '2026-01-01T00:00:00.000Z', bars = 100 } = {}) {
  const end = timestamp(endAt);
  if (!Number.isFinite(end) || !Number.isInteger(bars) || bars < 2 || bars > 2000) throw new TypeError('합성 데이터의 시각 또는 봉 개수가 올바르지 않습니다.');
  const series = ASSET_DEFINITIONS.map(asset => ({
    ...asset,
    prices: Array.from({ length: bars }, (_, index) => ({ at: new Date(end - (bars - 1 - index) * 86400000).toISOString(), close: fixturePrice(asset, index) })),
  }));
  return Array.from({ length: bars }, (_, index) => ({
    id: `synthetic-${series[0].prices[index].at}`,
    asOf: series[0].prices[index].at,
    baseCurrency: 'KRW',
    synthetic: true,
    source: 'synthetic-fixture',
    notice: FIXTURE_NOTICE,
    assets: series.map(({ base, slope, phase, prices, ...asset }) => ({ ...asset, currency: 'KRW', price: prices[index].close, prices: prices.slice(0, index + 1).map(bar => ({ ...bar })) })),
  }));
}

export function getDemoMarket(now = new Date().toISOString()) {
  return getFixtureHistory({ endAt: now, bars: 100 }).at(-1);
}
