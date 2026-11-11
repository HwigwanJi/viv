/** Numeric input contracts. Values enter through approved, source-linked observations. */
export const QUANT_INPUT_CATALOG_VERSION='quant-input-catalog-v1';
export const QUANT_INPUT_METRICS=Object.freeze([
 {id:'PER',label:'주가수익비율',unit:'multiple',aliases:['PER','P/E','PE_RATIO'],acceptedUnits:['multiple','배','x'],fiscalPeriodRequired:true},
 {id:'PBR',label:'주가순자산비율',unit:'multiple',aliases:['PBR','P/B','PB_RATIO'],acceptedUnits:['multiple','배','x'],fiscalPeriodRequired:true},
 {id:'ROE',label:'자기자본이익률',unit:'ratio',aliases:['ROE'],acceptedUnits:['ratio','%','percent'],fiscalPeriodRequired:true},
 {id:'DEBT_TO_EQUITY',label:'부채비율',unit:'ratio',aliases:['DEBT_TO_EQUITY','DEBT_RATIO'],acceptedUnits:['ratio','%','percent'],fiscalPeriodRequired:true},
 {id:'EPS',label:'주당순이익',unit:'currency_per_share',aliases:['EPS'],acceptedUnits:['USD/share','KRW/share'],fiscalPeriodRequired:true},
 {id:'MARKET_CAP',label:'시가총액',unit:'currency',aliases:['MARKET_CAP'],acceptedUnits:['USD','KRW','USDT'],fiscalPeriodRequired:false},
].map(metric=>Object.freeze({...metric,aliases:Object.freeze(metric.aliases),acceptedUnits:Object.freeze(metric.acceptedUnits),assetClasses:Object.freeze(['equity']),provider:'APPROVED_MARKET_CONTEXT',automaticProviderConnected:false})));
export function quantInputMetric(id){return QUANT_INPUT_METRICS.find(metric=>metric.id===id)??null;}
export function observationMetricId(observation){if(observation?.metricId)return quantInputMetric(observation.metricId)?.id??null;const name=String(observation?.name??'').trim().toUpperCase();return QUANT_INPUT_METRICS.find(metric=>metric.aliases.includes(name))?.id??null;}
export function normalizeQuantMetric(metricId,value,unit){
 const metric=quantInputMetric(metricId);
 if(!metric)return {ready:false,missing:['UNKNOWN_METRIC']};
 if(typeof value!=='number'||!Number.isFinite(value))return {ready:false,missing:['NUMERIC_VALUE_REQUIRED']};
 if(!metric.acceptedUnits.includes(unit))return {ready:false,missing:['METRIC_UNIT_MISMATCH']};
 const normalizedValue=metric.unit==='ratio'&&['%','percent'].includes(unit)?value/100:value;
 return {ready:true,value:normalizedValue,unit:['currency','currency_per_share'].includes(metric.unit)?unit:metric.unit,originalValue:value,originalUnit:unit,missing:[]};
}
