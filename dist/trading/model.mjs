export const FOUR_HOURS_MS = 4 * 60 * 60 * 1000;
export const DAY_MS = 24 * 60 * 60 * 1000;
export const MODEL_VERSION = 'btc-spec-section9-explicit-assumptions-v1';
export const DEFAULT_MODEL_CONFIG = Object.freeze({
  k: 4, h0: 1.5, h1: 1.5, buyThreshold: 0.6, sellThreshold: 0.6,
  buyTargetWeight: 1, sellTargetWeight: 0.25,
  dailyMaWindow: 200, atrPeriod: 14, maWindow: 50, slopeZWindow: 90 * 6,
  pivotLeft: 2, pivotRight: 2, distanceScale: 3,
  selectedCategories: Object.freeze(['price']),
  categoryWeights: Object.freeze({ price: 40, derivatives: 25, spot_flow: 15, macro: 10, onchain: 10 }),
});
export const MODEL_ASSUMPTIONS = Object.freeze([
  '원문 9장 최종 권고의 가격 구조 전용·현물 롱온리 설정을 사용한다. k=4, h0=1.5, h1=1.5, 행동 기준은 0.60이다.',
  '전략 전용 자금의 평가액을 분모로 Buy 목표 100%, Sell 목표 25%, Hold 보유 수량 유지를 적용한다.',
  '일봉 200MA는 SMA로 정의한다. ATR은 14일 Wilder 평활이며 처음 14개 TR의 산술평균으로 시작한다.',
  '가격 거리 점수는 tanh(((4시간 종가 - 마지막 완결 일봉 SMA200) / 일봉 ATR14) / 3)이다.',
  '4시간 SMA50의 한 봉 차이를 기울기로 정의하고 최근 540개 연속 기울기의 모집단 표준편차로 z점수를 계산한 뒤 tanh(z/2)를 적용한다.',
  '고점·저점은 좌 2봉·우 2봉보다 엄격히 높은 고점·낮은 저점으로 확정한다. 우측 2봉 마감 뒤부터 사용한다. 최근 확정 고점 2개와 저점 2개가 모두 상승하면 +1, 모두 하락하면 -1, 나머지는 0이다.',
  '가격 구조의 거리·기울기·고저점 점수는 각각 1/3로 합산한다. 세 지표의 준비가 완료되어야 가격 카테고리를 사용한다.',
  'C의 데이터 가용 비율은 선택한 카테고리의 가용 가중치 / 선택 가중치로 계산한다. 미선택 카테고리와 선택 후 결측 카테고리를 구분한다. 점수 절대합이 0이면 C=0이다.',
  'UTC 일봉과 4시간봉은 [시작, 종료) 구간이며 종료 시각부터 관측할 수 있다. 일봉 갱신은 UTC 00:00에 완료된 일봉만 사용한다.',
  'native dailyBars가 있으면 같은 거래소의 완결 일봉을 사용한다. 없으면 UTC 하루의 연속 4시간봉 6개로 일봉을 집계한다.',
  '일봉 누락은 일봉 SMA와 ATR 준비를 다시 시작한다. 4시간봉 누락은 SMA·기울기·고저점 준비를 다시 시작한다. 누락된 시세를 채워 넣지 않는다.',
  'ATR=0, 필수 이력 부족 또는 선택 카테고리 결측이면 Hold를 출력하고 확률은 null로 남긴다.',
  '원문의 반대 신호 2봉 확인은 9장의 제거 권고를 적용한다. 파생·수급·거시·온체인·이벤트 필터는 별도 데이터 연결이 필요한 후속 범위다.',
  'SMA·ATR·기울기·pivot의 세부 정의는 원문에서 비어 있던 재현 조건을 채운 구현 가정이다. 결과에는 이 가정의 버전을 함께 기록한다.',
]);
const categories = Object.keys(DEFAULT_MODEL_CONFIG.categoryWeights);
const configs = new WeakSet([DEFAULT_MODEL_CONFIG]);
const preparedSeries = new WeakSet();
const finite = value => typeof value === 'number' && Number.isFinite(value);
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
const iso = value => new Date(value).toISOString();
const time = value => typeof value === 'number' ? value : Date.parse(value);

export class TradingModelError extends TypeError {
  constructor(code, message) { super(message); this.name = 'TradingModelError'; this.code = code; }
}
const check = (condition, code, message) => { if (!condition) throw new TradingModelError(code, message); };

export function resolveModelConfig(input = DEFAULT_MODEL_CONFIG) {
  if (configs.has(input)) return input;
  check(input && typeof input === 'object' && !Array.isArray(input) && Object.keys(input).every(key => Object.hasOwn(DEFAULT_MODEL_CONFIG, key)), 'INVALID_MODEL_CONFIG', '모델 설정에 알 수 없는 필드가 있습니다.');
  const config = { ...DEFAULT_MODEL_CONFIG, ...input, selectedCategories: [...(input.selectedCategories ?? DEFAULT_MODEL_CONFIG.selectedCategories)], categoryWeights: { ...DEFAULT_MODEL_CONFIG.categoryWeights, ...input.categoryWeights } };
  for (const key of ['k', 'distanceScale']) check(finite(config[key]) && config[key] > 0 && config[key] <= 100, 'INVALID_MODEL_CONFIG', `${key} 설정이 범위를 벗어났습니다.`);
  for (const key of ['h0', 'h1']) check(finite(config[key]) && config[key] >= 0 && config[key] <= 20, 'INVALID_MODEL_CONFIG', `${key} 설정이 범위를 벗어났습니다.`);
  for (const key of ['buyThreshold', 'sellThreshold']) check(finite(config[key]) && config[key] >= 0.5 && config[key] <= 1, 'INVALID_MODEL_CONFIG', '행동 기준은 0.5~1 범위여야 합니다.');
  check(finite(config.buyTargetWeight) && config.buyTargetWeight > 0 && config.buyTargetWeight <= 1 && finite(config.sellTargetWeight) && config.sellTargetWeight >= 0 && config.sellTargetWeight <= config.buyTargetWeight, 'INVALID_MODEL_CONFIG', '목표 비중은 현물 전략 자금 범위여야 합니다.');
  for (const key of ['dailyMaWindow', 'atrPeriod', 'maWindow', 'slopeZWindow', 'pivotLeft', 'pivotRight']) check(Number.isInteger(config[key]) && config[key] >= 1 && config[key] <= 5000, 'INVALID_MODEL_CONFIG', `${key} 관측 기간이 올바르지 않습니다.`);
  check(config.maWindow >= 2 && config.slopeZWindow >= 2 && config.selectedCategories.length > 0 && new Set(config.selectedCategories).size === config.selectedCategories.length && config.selectedCategories.every(category => categories.includes(category)), 'INVALID_MODEL_CONFIG', '선택 카테고리 또는 관측 기간이 올바르지 않습니다.');
  check(Object.keys(config.categoryWeights).every(key => categories.includes(key)) && Object.values(config.categoryWeights).every(value => finite(value) && value >= 0) && config.selectedCategories.every(category => config.categoryWeights[category] > 0), 'INVALID_MODEL_CONFIG', '카테고리 가중치가 올바르지 않습니다.');
  freeze(config); configs.add(config); return config;
}

function validateRows(rows, interval, label) {
  check(Array.isArray(rows) && rows.length > 0 && rows.length <= 1000000, 'INVALID_BARS', `${label} 관측 배열이 비어 있거나 허용 범위를 넘었습니다.`);
  let previous = -Infinity;
  const gaps = [];
  for (const row of rows) {
    check(Array.isArray(row) && row.length === 6 && Number.isSafeInteger(row[0]) && row[0] >= 0 && row[0] % interval === 0 && row[0] > previous, 'INVALID_BAR_TIME', `${label} 시작 시각은 UTC 구간에 맞춰 과거부터 정렬해야 합니다.`);
    check(row.slice(1, 5).every(value => finite(value) && value > 0 && value <= 1e12) && finite(row[5]) && row[5] >= 0 && row[5] <= Number.MAX_SAFE_INTEGER && row[2] >= Math.max(row[1], row[3], row[4]) && row[3] <= Math.min(row[1], row[2], row[4]), 'INVALID_OHLCV', `${label} 가격·거래량 또는 OHLC 관계가 올바르지 않습니다.`);
    if (previous !== -Infinity && row[0] - previous > interval) gaps.push({ after: iso(previous), before: iso(row[0]), missingBars: (row[0] - previous) / interval - 1 });
    previous = row[0];
  }
  return gaps;
}

export function validateDataset(dataset) {
  try {
    check(dataset && dataset.schemaVersion === 1 && dataset.interval === '4h' && dataset.timezone === 'UTC' && typeof dataset.source === 'string' && dataset.source.length > 0, 'INVALID_DATASET', 'UTC 4시간봉 데이터셋 계약이 필요합니다.');
    const gaps = validateRows(dataset.bars, FOUR_HOURS_MS, '4시간봉');
    const dailyGaps = dataset.dailyBars === undefined ? [] : validateRows(dataset.dailyBars, DAY_MS, '일봉');
    return { ok: true, reasons: [], gaps, dailyGaps };
  } catch (error) { return { ok: false, reasons: [{ code: error.code || 'INVALID_DATASET', message: error.message }], gaps: [], dailyGaps: [] }; }
}

class Rolling {
  constructor(size) { this.size = size; this.values = new Array(size); this.count = 0; this.cursor = 0; this.sum = 0; this.sumSquares = 0; }
  push(value) {
    if (this.count === this.size) { const old = this.values[this.cursor]; this.sum -= old; this.sumSquares -= old * old; } else this.count++;
    this.values[this.cursor] = value; this.cursor = (this.cursor + 1) % this.size; this.sum += value; this.sumSquares += value * value;
  }
  get ready() { return this.count === this.size; }
  get mean() { return this.count ? this.sum / this.count : null; }
  get std() { return this.count ? Math.sqrt(Math.max(0, this.sumSquares / this.count - this.mean ** 2)) : null; }
}

function aggregateDaily(bars) {
  const result = []; let current = null;
  for (const bar of bars) {
    const day = Math.floor(bar[0] / DAY_MS) * DAY_MS;
    if (!current || current.day !== day) current = { day, first: bar[0], previous: bar[0], count: 0, continuous: true, row: [day, bar[1], bar[2], bar[3], bar[4], 0] };
    else if (bar[0] !== current.previous + FOUR_HOURS_MS) current.continuous = false;
    current.previous = bar[0]; current.count++; current.row[2] = Math.max(current.row[2], bar[2]); current.row[3] = Math.min(current.row[3], bar[3]); current.row[4] = bar[4]; current.row[5] += bar[5];
    if (current.count === 6 && current.first === day && current.continuous && bar[0] + FOUR_HOURS_MS === day + DAY_MS) result.push(current.row);
  }
  return result;
}

function dailySeries(rows, config) {
  let average = new Rolling(config.dailyMaWindow), seed = [], atr = null, previous = null, consecutive = 0;
  return rows.map(row => {
    if (previous && row[0] !== previous[0] + DAY_MS) { average = new Rolling(config.dailyMaWindow); seed = []; atr = null; previous = null; consecutive = 0; }
    const tr = previous ? Math.max(row[2] - row[3], Math.abs(row[2] - previous[4]), Math.abs(row[3] - previous[4])) : row[2] - row[3];
    average.push(row[4]); consecutive++;
    if (atr === null) { seed.push(tr); if (seed.length === config.atrPeriod) atr = seed.reduce((sum, value) => sum + value, 0) / config.atrPeriod; }
    else atr = (atr * (config.atrPeriod - 1) + tr) / config.atrPeriod;
    previous = row;
    return { openTime: row[0], availableAt: row[0] + DAY_MS, close: row[4], sma: average.ready ? average.mean : null, atr, consecutiveDays: consecutive };
  });
}

export function precomputeFeatures(dataset, { config: inputConfig = DEFAULT_MODEL_CONFIG, asOf } = {}) {
  const quality = validateDataset(dataset);
  check(quality.ok, quality.reasons[0]?.code, quality.reasons[0]?.message);
  const config = resolveModelConfig(inputConfig);
  const cutoff = asOf === undefined ? Infinity : time(asOf);
  check(cutoff === Infinity || finite(cutoff), 'INVALID_AS_OF', '관측 종료 시각이 올바르지 않습니다.');
  const bars = dataset.bars.filter(row => row[0] + FOUR_HOURS_MS <= cutoff).map(row => [...row]);
  const nativeDaily = dataset.dailyBars !== undefined;
  const daily = dailySeries((nativeDaily ? dataset.dailyBars : aggregateDaily(bars)).filter(row => row[0] + DAY_MS <= cutoff), config);
  let dailyIndex = -1, ma = new Rolling(config.maWindow), slopes = new Rolling(config.slopeZWindow), previousMa = null, segmentStart = 0;
  let highs = [], lows = [], seenGap = false;
  const features = [];
  for (let index = 0; index < bars.length; index++) {
    const bar = bars[index], availableAt = bar[0] + FOUR_HOURS_MS;
    const gapBefore = index > 0 && bar[0] !== bars[index - 1][0] + FOUR_HOURS_MS;
    if (gapBefore) { ma = new Rolling(config.maWindow); slopes = new Rolling(config.slopeZWindow); previousMa = null; highs = []; lows = []; segmentStart = index; seenGap = true; }
    while (dailyIndex + 1 < daily.length && daily[dailyIndex + 1].availableAt <= availableAt) dailyIndex++;
    const day = daily[dailyIndex];
    // At most one current UTC day can be incomplete. A missing completed day invalidates the daily window.
    const dailyFresh = !!day && day.availableAt === Math.floor(availableAt / DAY_MS) * DAY_MS;
    ma.push(bar[4]); const sma = ma.ready ? ma.mean : null;
    const slope = sma !== null && previousMa !== null ? sma - previousMa : null;
    if (slope !== null) slopes.push(slope);
    previousMa = sma;
    const candidate = index - config.pivotRight;
    if (candidate - config.pivotLeft >= segmentStart) {
      const row = bars[candidate]; let high = true, low = true;
      for (let other = candidate - config.pivotLeft; other <= candidate + config.pivotRight; other++) if (other !== candidate) { high &&= row[2] > bars[other][2]; low &&= row[3] < bars[other][3]; }
      if (high) { highs.push({ openTime: row[0], confirmedAt: availableAt, price: row[2] }); highs = highs.slice(-2); }
      if (low) { lows.push({ openTime: row[0], confirmedAt: availableAt, price: row[3] }); lows = lows.slice(-2); }
    }
    const structureReady = highs.length === 2 && lows.length === 2;
    const structureScore = !structureReady ? null : highs[1].price > highs[0].price && lows[1].price > lows[0].price ? 1 : highs[1].price < highs[0].price && lows[1].price < lows[0].price ? -1 : 0;
    const slopeZ = slopes.ready && slope !== null ? (slopes.std > 1e-12 ? (slope - slopes.mean) / slopes.std : 0) : null;
    const distanceAtr = dailyFresh && day.sma !== null && day.atr > 0 ? (bar[4] - day.sma) / day.atr : null;
    const missing = [];
    if (!dailyFresh || day.sma === null) missing.push('DAILY_SMA_WARMUP_OR_GAP');
    if (!dailyFresh || !(day.atr > 0)) missing.push('DAILY_ATR_WARMUP_OR_GAP');
    if (slopeZ === null) missing.push('FOUR_HOUR_SLOPE_WARMUP_OR_GAP');
    if (!structureReady) missing.push('CONFIRMED_STRUCTURE_WARMUP_OR_GAP');
    features.push(freeze({ index, openTime: bar[0], availableAt, asOf: iso(availableAt), close: bar[4], ready: missing.length === 0, missing, gapBefore, sinceGapBars: index - segmentStart + 1, historicalGapSeen: seenGap, dailySource: nativeDaily ? 'native-utc-1d' : 'six-complete-4h-bars', dailyAvailableAt: day ? iso(day.availableAt) : null, dailyConsecutiveDays: dailyFresh ? day.consecutiveDays : 0, dailySma: dailyFresh ? day.sma : null, dailyAtr: dailyFresh ? day.atr : null, distanceAtr, distanceScore: distanceAtr === null ? null : Math.tanh(distanceAtr / config.distanceScale), smaFourHour: sma, slope, slopeZ, slopeScore: slopeZ === null ? null : Math.tanh(slopeZ / 2), slopeSamples: slopes.count, structureScore, confirmedHighs: highs.map(value => ({ ...value })), confirmedLows: lows.map(value => ({ ...value })) }));
  }
  const prepared = freeze({ modelVersion: MODEL_VERSION, config, source: { label: dataset.source, url: dataset.sourceUrl || null, symbol: dataset.symbol || 'BTCUSDT', synthetic: dataset.synthetic === true, interval: '4h', timezone: 'UTC' }, bars, features, quality: { ...quality, dailySource: nativeDaily ? 'native-utc-1d' : 'six-complete-4h-bars', windowPolicy: 'strict-contiguous-no-imputation' }, assumptions: MODEL_ASSUMPTIONS });
  preparedSeries.add(prepared); return prepared;
}

export function assertPreparedSeries(prepared, inputConfig = DEFAULT_MODEL_CONFIG) {
  check(preparedSeries.has(prepared), 'INVALID_PREPARED_SERIES', '현재 실행에서 계산한 관측 시리즈가 필요합니다.');
  const config = resolveModelConfig(inputConfig);
  check(['dailyMaWindow', 'atrPeriod', 'maWindow', 'slopeZWindow', 'pivotLeft', 'pivotRight', 'distanceScale'].every(key => prepared.config[key] === config[key]), 'PREPARED_CONFIG_MISMATCH', '지표 설정이 변경되어 관측을 다시 계산해야 합니다.');
  return prepared;
}

export function combineCategoryScores(categoryScores, inputConfig = DEFAULT_MODEL_CONFIG) {
  const config = resolveModelConfig(inputConfig);
  let numerator = 0, absolute = 0, selectedWeight = 0, availableWeight = 0;
  const missingCategories = [];
  for (const category of config.selectedCategories) {
    const weight = config.categoryWeights[category], score = categoryScores[category]; selectedWeight += weight;
    if (score === null || score === undefined) { missingCategories.push(category); continue; }
    check(finite(score) && score >= -1 && score <= 1, 'INVALID_CATEGORY_SCORE', '카테고리 점수는 -1~1의 유한수여야 합니다.');
    availableWeight += weight; numerator += weight * score; absolute += weight * Math.abs(score);
  }
  const coverage = selectedWeight > 0 ? availableWeight / selectedWeight : 0;
  return { S: selectedWeight > 0 ? numerator / selectedWeight : 0, C: absolute > 0 ? clamp(Math.abs(numerator) / absolute * coverage, 0, 1) : 0, coverage, selectedWeight, availableWeight, missingCategories };
}

export function computeProbabilities(S, C, inputConfig = DEFAULT_MODEL_CONFIG) {
  const config = resolveModelConfig(inputConfig);
  check(finite(S) && S >= -1 && S <= 1 && finite(C) && C >= 0 && C <= 1, 'INVALID_SCORES', 'S·C 값이 유효 범위를 벗어났습니다.');
  const logits = [config.k * S, config.h0 + config.h1 * (1 - C), -config.k * S];
  const maximum = Math.max(...logits), exponentials = logits.map(value => Math.exp(value - maximum)), sum = exponentials.reduce((total, value) => total + value, 0);
  return { buy: exponentials[0] / sum, hold: exponentials[1] / sum, sell: exponentials[2] / sum };
}

export function decideSnapshot(feature, { config: inputConfig = DEFAULT_MODEL_CONFIG, currentWeight = 0 } = {}) {
  const config = resolveModelConfig(inputConfig);
  check(feature && Number.isSafeInteger(feature.availableAt) && finite(feature.close) && feature.close > 0 && typeof feature.ready === 'boolean' && finite(currentWeight) && currentWeight >= 0 && currentWeight <= 1 + 1e-10, 'INVALID_FEATURE', '판단할 관측 또는 현재 비중이 올바르지 않습니다.');
  const price = feature.ready ? (feature.distanceScore + feature.slopeScore + feature.structureScore) / 3 : null;
  const categoryScores = Object.fromEntries(config.selectedCategories.map(category => [category, category === 'price' ? price : null]));
  const combined = combineCategoryScores(categoryScores, config);
  const ready = feature.ready && combined.missingCategories.length === 0;
  const probabilities = ready ? computeProbabilities(combined.S, combined.C, config) : null;
  const action = !ready ? 'hold' : probabilities.buy >= config.buyThreshold ? 'buy' : probabilities.sell >= config.sellThreshold ? 'sell' : 'hold';
  const targetWeight = action === 'buy' ? Math.max(currentWeight, config.buyTargetWeight) : action === 'sell' ? Math.min(currentWeight, config.sellTargetWeight) : currentWeight;
  const allocationAction = action === 'buy' && currentWeight < config.buyTargetWeight ? 'increase' : action === 'sell' && currentWeight > config.sellTargetWeight ? 'reduce' : 'keep';
  const evidence = ready ? [
    `가격 거리 ${feature.distanceScore.toFixed(4)} · 기울기 ${feature.slopeScore.toFixed(4)} · 확정 고저점 ${feature.structureScore.toFixed(0)}를 균등 합산했다.`,
    `선택 카테고리 ${config.selectedCategories.join(', ')} · 데이터 가용 비율 ${combined.coverage.toFixed(4)} · S ${combined.S.toFixed(4)} · C ${combined.C.toFixed(4)}.`,
    `마지막 완결 일봉 ${feature.dailyAvailableAt} · 4시간 관측 ${feature.asOf}.`,
  ] : [`지표 준비 대기: ${(feature.missing || []).join(', ') || combined.missingCategories.join(', ')}.`];
  return { modelVersion: MODEL_VERSION, asOf: feature.asOf, availableAt: feature.availableAt, decisionBarOpenTime: feature.openTime, ready, code: ready ? 'BTC_SPEC_DECISION' : 'BTC_MODEL_WARMUP', features: feature, categoryScores, S: combined.S, C: combined.C, coverage: combined.coverage, probabilities, action, targetWeight, currentWeight, allocationAction, evidence, invalidations: ['관측 이후 가격·지표·카테고리 데이터 판이 변경되면 현재 판단을 다시 계산한다.', '연속 관측 또는 완결 일봉 이력이 부족하면 신규 판단을 보류한다.', `다음 4시간봉의 시가 관측이 누락되면 해당 주문 후보를 취소한다.`], assumptions: MODEL_ASSUMPTIONS };
}
