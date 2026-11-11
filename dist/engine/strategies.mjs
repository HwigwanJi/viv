import { clone, isFiniteNumber, reason, SUPPORTED_SYMBOLS } from './validation.mjs';
import { OPPORTUNITY_REGIMES } from './opportunity.mjs';
import { CLUTCH_DEFAULTS, CLUTCH_NOTICE, CLUTCH_PARAMETER_SCHEMA, evaluateClutchPolicy, validateClutchParameters } from './clutch-policy.mjs';

export const STRATEGY_NOTICE = '대화의 평균회귀 아이디어를 참고했으나 임계값과 수익성은 미검증인 샘플입니다.';
export const defaultStrategy = Object.freeze({
  id: 'mean-reversion', enabled: true, targetWeight: 0.18,
  scope: Object.freeze([...SUPPORTED_SYMBOLS]),
  parameters: Object.freeze({ window: 20, entryDeviation: 0.04, exitDeviation: 0.01 }),
});

const average = values => values.reduce((sum, value) => sum + value, 0) / values.length;
const mean = (asset, count) => average(asset.prices.slice(-count).map(bar => bar.close));
export function assessMomentum(asset,{lookbackBars,scale},{asOf,barMs=14400000}={}){
 const cutoff=Date.parse(asOf),window=(asset?.prices??[]).filter(bar=>Number.isFinite(Date.parse(bar.at))&&Date.parse(bar.at)<=cutoff).slice(-lookbackBars-1);
 if(!Number.isInteger(lookbackBars)||lookbackBars<2||lookbackBars>500||!isFiniteNumber(scale)||scale<=0||scale>1||!Number.isFinite(cutoff)||window.length!==lookbackBars+1||Date.parse(window.at(-1).at)!==cutoff||window.some((bar,i)=>!isFiniteNumber(bar.close)||bar.close<=0||i>0&&Date.parse(bar.at)-Date.parse(window[i-1].at)!==barMs))return {ready:false,action:'hold',score:null,code:'CONTIGUOUS_CLOSE_HISTORY_REQUIRED',indicators:{}};
 const totalReturn=window.at(-1).close/window[0].close-1,score=Math.max(-1,Math.min(1,totalReturn/scale));
 return {ready:true,action:score>0?'buy':score<0?'sell':'hold',score,strength:Math.abs(score),code:'CAUSAL_PRICE_MOMENTUM',indicators:{lookbackBars,totalReturn,scale,firstClose:window[0].close,lastClose:window.at(-1).close}};
}
export function assessMeanReversion(asset,p){
  if (asset.prices.length < p.window) return { action: 'hold', strength: 0, reason: '평균 계산에 필요한 관측 데이터가 부족합니다.', code: 'INSUFFICIENT_HISTORY', indicators: {} };
  const averagePrice = mean(asset, p.window), deviation = asset.price / averagePrice - 1;
  return { action: deviation < -p.entryDeviation ? 'buy' : deviation > p.exitDeviation ? 'sell' : 'hold', strength: Math.min(1, Math.abs(deviation) / p.entryDeviation), reason: `관측 평균 대비 이탈 ${(deviation * 100).toFixed(2)}%`, code: 'MEAN_DEVIATION', indicators: { averagePrice, deviation } };
}
/** A closed-bar trend regime signal, independent of the account's position. */
export function assessSmaTrend(asset,{lookbackBars},{asOf,barMs=14400000}={}){
  const cutoff=Date.parse(asOf),missing=code=>({ready:false,action:'hold',strength:0,score:null,code,indicators:{}});
  if(!Number.isInteger(lookbackBars)||lookbackBars<2||lookbackBars>500||!Number.isFinite(cutoff)||!Number.isSafeInteger(barMs)||barMs<=0)return missing('INVALID_TREND_INPUT');
  const window=(asset?.prices??[]).filter(bar=>Number.isFinite(Date.parse(bar.at))&&Date.parse(bar.at)<=cutoff).slice(-lookbackBars);
  if(window.length<lookbackBars||Date.parse(window.at(-1).at)!==cutoff||window.some((bar,index)=>!isFiniteNumber(bar.close)||bar.close<=0||index>0&&Date.parse(bar.at)-Date.parse(window[index-1].at)!==barMs))return missing('CONTIGUOUS_CLOSE_HISTORY_REQUIRED');
  const close=window.at(-1).close,base=window[0].close,slowMA=base+average(window.map(bar=>bar.close-base)),score=close>slowMA?1:close<slowMA?-1:0;
  return {ready:true,action:score>0?'buy':score<0?'sell':'hold',strength:Math.abs(score),score,code:'CLOSE_VS_SMA',indicators:{close,slowMA,deviation:close/slowMA-1,lookbackBars}};
}
const registry = new Map();
const freezeTree = value => {
  if (value && typeof value === 'object') { for (const child of Object.values(value)) freezeTree(child); Object.freeze(value); }
  return value;
};

export function registerStrategy(definition) {
  if (!definition || typeof definition.id !== 'string' || !definition.id || typeof definition.generate !== 'function' || typeof definition.validate !== 'function' || registry.has(definition.id)) throw new TypeError('전략은 고유 ID, 검증 함수, 신호 생성 함수를 가져야 합니다.');
  registry.set(definition.id, Object.freeze({ ...definition, defaults: freezeTree(clone(definition.defaults || {})) }));
}

registerStrategy({
  id: 'trend', name: '추세 추종', description: '단기·장기 이동평균의 차이를 이용하는 추정 샘플',
  defaults: { shortWindow: 5, longWindow: 20, threshold: 0.01 },
  validate(parameters) {
    const p = { ...this.defaults, ...parameters };
    return Number.isInteger(p.shortWindow) && Number.isInteger(p.longWindow) && p.shortWindow >= 2 && p.longWindow > p.shortWindow && p.longWindow <= 500 && isFiniteNumber(p.threshold) && p.threshold >= 0 && p.threshold <= 0.5 && Object.keys(parameters).every(key => Object.hasOwn(this.defaults, key));
  },
  generate(asset, p) {
    if (asset.prices.length < p.longWindow) return { action: 'hold', strength: 0, reason: '이동평균 계산에 필요한 관측 데이터가 부족합니다.', code: 'INSUFFICIENT_HISTORY', indicators: {} };
    const shortAverage = mean(asset, p.shortWindow), longAverage = mean(asset, p.longWindow);
    const gap = shortAverage / longAverage - 1;
    return { action: gap > p.threshold ? 'buy' : gap < -p.threshold ? 'sell' : 'hold', strength: Math.min(1, Math.abs(gap) / Math.max(p.threshold * 3, 0.01)), reason: `단기·장기 평균 차이 ${(gap * 100).toFixed(2)}%`, code: 'TREND_SPREAD', indicators: { shortAverage, longAverage, gap } };
  },
});

registerStrategy({
  id: 'mean-reversion', name: '평균 회귀', description: '관측 평균 대비 가격 이탈을 이용하는 추정 샘플',
  defaults: { window: 20, entryDeviation: 0.04, exitDeviation: 0.01 },
  validate(parameters) {
    const p = { ...this.defaults, ...parameters };
    return Number.isInteger(p.window) && p.window >= 2 && p.window <= 500 && isFiniteNumber(p.entryDeviation) && p.entryDeviation > 0 && p.entryDeviation <= 0.5 && isFiniteNumber(p.exitDeviation) && p.exitDeviation >= 0 && p.exitDeviation < p.entryDeviation && Object.keys(parameters).every(key => Object.hasOwn(this.defaults, key));
  },
  generate(asset, p) {
    return assessMeanReversion(asset,p);
  },
});

registerStrategy({
  id: 'cross-venue-spread', name: '거래소 간 가격 차이', description: '국내·해외 가격 차이 연구 전용. 환율·펀딩·공매도·동시체결 모델이 없어 주문 불가',
  researchOnly: true,
  defaults: { entryGap: 0.03, exitGap: 0.01 },
  validate(parameters) {
    const p = { ...this.defaults, ...parameters };
    return isFiniteNumber(p.entryGap) && p.entryGap > 0 && p.entryGap <= 0.5 && isFiniteNumber(p.exitGap) && p.exitGap >= 0 && p.exitGap < p.entryGap && Object.keys(parameters).every(key => Object.hasOwn(this.defaults, key));
  },
  generate() {
    return { action: 'hold', strength: 0, code: 'RESEARCH_ONLY_MISSING_EXECUTION_MODEL', reason: '환율·펀딩·공매도·동시체결 모델 검증 전에는 연구 전용입니다.', indicators: {} };
  },
});

registerStrategy({
  id: 'clutch', name: '기회 집중', description: '기회가 강해질 때 목표 비중 확대 · 수익 중 증액 · 진입 이후 관측 고점 추적청산. 대화 기반 연구 샘플',
  defaults: CLUTCH_DEFAULTS, parameterSchema: CLUTCH_PARAMETER_SCHEMA, notice: CLUTCH_NOTICE,
  validate: validateClutchParameters,
  generate: evaluateClutchPolicy,
});

export function listStrategies() {
  return [...registry.values()].map(({ id, name, description, defaults, parameterSchema = [], researchOnly = false, notice = STRATEGY_NOTICE }) => ({ id, name, description, defaults: { ...defaults }, parameterSchema: clone(parameterSchema), researchOnly, notice, verified: false }));
}

export function validateStrategy(strategy) {
  const errors = [];
  const definition = registry.get(strategy?.id);
  if (!definition) errors.push(reason('UNKNOWN_STRATEGY', '등록되지 않은 전략입니다.'));
  if (typeof strategy?.enabled !== 'boolean') errors.push(reason('INVALID_STRATEGY', '전략 활성화 값이 올바르지 않습니다.'));
  if (!isFiniteNumber(strategy?.targetWeight) || strategy.targetWeight <= 0 || strategy.targetWeight > 1) errors.push(reason('INVALID_TARGET_WEIGHT', '목표 비중은 0보다 크고 1 이하여야 합니다.'));
  if (!Array.isArray(strategy?.scope) || strategy.scope.length === 0 || new Set(strategy.scope).size !== strategy.scope.length || strategy.scope.some(symbol => !SUPPORTED_SYMBOLS.includes(symbol))) errors.push(reason('INVALID_STRATEGY_SCOPE', '전략 대상 자산이 올바르지 않습니다.'));
  if (!strategy?.parameters || typeof strategy.parameters !== 'object' || Array.isArray(strategy.parameters) || (definition && !definition.validate(strategy.parameters))) errors.push(reason('INVALID_STRATEGY_PARAMETERS', '전략 매개변수가 올바르지 않습니다.'));
  return errors;
}

export function generateSignals({ market, strategy, knowledge = [], portfolio, now = market?.asOf }) {
  const definition = registry.get(strategy.id);
  const parameters = { ...definition.defaults, ...strategy.parameters };
  const references = Array.isArray(knowledge) ? knowledge.filter(item => item && typeof item.id === 'string' && item.status !== 'rejected').map(item => item.id) : [];
  const context = freezeTree(clone({ portfolio: portfolio || null, marketAsOf: market.asOf, now }));
  const generatedKeys = ['action', 'strength', 'reason', 'code', 'indicators', 'regime', 'opportunityScore', 'targetWeightFactor', 'minimumAddProfitRatio'];
  return market.assets.filter(asset => strategy.scope.includes(asset.symbol)).map(asset => {
    let generated;
    try {
      generated = strategy.enabled ? definition.generate(freezeTree(clone(asset)), freezeTree(clone(parameters)), context) : { action: 'hold', strength: 0, reason: '전략이 일시 중지되었습니다.', code: 'STRATEGY_PAUSED', indicators: {} };
      // Snapshot plugin output before validation so getters/proxies cannot change fields between reads.
      generated = clone(generated);
    }
    catch { generated = { action: 'hold', strength: 0, reason: '전략 실행 오류로 주문을 중지합니다.', code: 'STRATEGY_ERROR', indicators: {} }; }
    if (!generated || typeof generated !== 'object' || Array.isArray(generated) || Object.keys(generated).some(key => !generatedKeys.includes(key)) || !['buy', 'sell', 'hold'].includes(generated.action) || !isFiniteNumber(generated.strength) || generated.strength < 0 || generated.strength > 1 || typeof generated.reason !== 'string' || typeof generated.code !== 'string' || !generated.indicators || typeof generated.indicators !== 'object' || Array.isArray(generated.indicators) || Object.values(generated.indicators).some(value => !isFiniteNumber(value)) || (Object.hasOwn(generated, 'regime') && !OPPORTUNITY_REGIMES.includes(generated.regime)) || (Object.hasOwn(generated, 'opportunityScore') && (!isFiniteNumber(generated.opportunityScore) || generated.opportunityScore < 0 || generated.opportunityScore > 1)) || (Object.hasOwn(generated, 'targetWeightFactor') && (!isFiniteNumber(generated.targetWeightFactor) || generated.targetWeightFactor <= 0 || generated.targetWeightFactor > 1)) || (Object.hasOwn(generated, 'minimumAddProfitRatio') && (strategy.id !== 'clutch' || !isFiniteNumber(generated.minimumAddProfitRatio) || generated.minimumAddProfitRatio < 0 || generated.minimumAddProfitRatio > 0.2))) generated = { action: 'hold', strength: 0, reason: '전략 신호 검증에 실패했습니다.', code: 'INVALID_SIGNAL', indicators: {} };
    const extra = Object.fromEntries(['regime', 'opportunityScore', 'targetWeightFactor', 'minimumAddProfitRatio'].filter(key => Object.hasOwn(generated, key)).map(key => [key, generated[key]]));
    return { symbol: asset.symbol, strategyId: strategy.id, action: generated.action, strength: generated.strength, reason: generated.reason, code: generated.code, indicators: { ...generated.indicators }, ...extra, notice: definition.notice || STRATEGY_NOTICE, verified: false, knowledgeRefs: references };
  });
}
