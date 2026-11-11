import {PRICE_STRUCTURE_METRICS,priceStructureMetric} from './price-structure-metrics.mjs';
import {resolveQueryParameters} from './strategy-parameters.mjs';
import {monthlySmaDistance} from './calendar-trend.mjs';
import {resolveGraphInput} from './strategy-graph-inputs.mjs';
import {hashInputPackage} from './workspace.mjs';
import {getInstrument} from './instruments.mjs';
import {assertPortfolioNews} from './portfolio-news.mjs';

export const PORTFOLIO_CANDIDATE_VERSION='portfolio-candidate-set-v1';
export const PORTFOLIO_RANK_VERSION='portfolio-asset-rank-v1';
export const PORTFOLIO_TARGET_VERSION='portfolio-target-weights-v1';
export const ASSET_CONDITION_TYPES=Object.freeze(['ASSET_METRIC','ASSET_COMPARE','ASSET_LOGIC','ASSET_FILTER']);
export const PORTFOLIO_GRAPH_TYPES=Object.freeze(['FILTER',...ASSET_CONDITION_TYPES,'ASSET_REDUCE','RANK','SELECT','MEMBER','ALLOCATE','REBALANCE']);
export const PORTFOLIO_CANDIDATE_TIMEFRAMES=Object.freeze({'1d':86400000,'1h':3600000,'1m':60000,'3m':180000,'5m':300000});
export const PORTFOLIO_SELECTION_VERSION='portfolio-asset-selection-v1';
const DAY=86400000,clone=structuredClone,hash=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const plain=v=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.getPrototypeOf(v)===Object.prototype;
const exact=(v,keys,optional=[])=>plain(v)&&keys.every(k=>Object.hasOwn(v,k))&&Object.keys(v).every(k=>keys.includes(k)||optional.includes(k));
export const PORTFOLIO_FACTOR_METRICS=Object.freeze(['MOMENTUM','LOG_MOMENTUM','VOLATILITY','QUOTE_VOLUME','SMA_DISTANCE','BREAKOUT','BUY_QUOTE_RATIO_5M','MID_RETURN_5M']);
const finite=v=>typeof v==='number'&&Number.isFinite(v),ratio=v=>finite(v)&&v>=0&&v<=1;
const iso=v=>typeof v==='string'&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString()===v;
const id=v=>typeof v==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9_.:@/-]{0,199}$/.test(v);
const unique=values=>[...new Set(values)],clamp=(v,min,max)=>Math.min(max,Math.max(min,v));
const check=(ok,code,message)=>{if(!ok)throw Object.assign(new Error(message),{code,status:400});};
const sum=rows=>rows.reduce((n,v)=>n+v,0);

export const portfolioGraphDefaults=type=>clone({ASSET_REDUCE:{operation:'MEDIAN'},FILTER:{minHistoryBars:121,minQuoteVolume:0,excludeWarnings:true,conditions:[]},RANK:{terms:[{metric:'MOMENTUM',lookback:20,weight:.5},{metric:'MOMENTUM',lookback:60,weight:.3},{metric:'MOMENTUM',lookback:120,weight:.2}],volatilityBars:20,direction:'DESC',minScore:0,scoreOperator:'gt',scoreNormalization:'NONE',normalizationLookback:20},SELECT:{maxPositions:1},MEMBER:{},ALLOCATE:{method:'INVERSE_VOLATILITY',maxPositions:3,minBudget:0,maxBudget:.9,maxAssetWeight:.5},REBALANCE:{everyDays:7,minWeightChange:.01}}[type]);
export function assertPortfolioNodeConfig(type,c){
 if(type==='ASSET_REDUCE')check(exact(c,['operation'])&&['MEDIAN','POSITIVE_FRACTION'].includes(c.operation),'GRAPH_ASSET_REDUCE','중앙값 또는 양수 비율 집계를 선택하세요.');
 if(type==='ASSET_METRIC')check(exact(c,['metric','lookback'],['slowLookback'])&&(PORTFOLIO_FACTOR_METRICS.includes(c.metric)||c.metric==='MONTHLY_SMA_DISTANCE'||PRICE_STRUCTURE_METRICS.includes(c.metric))&&(c.metric==='EMA_RATIO'?Number.isInteger(c.slowLookback)&&c.slowLookback>c.lookback&&c.slowLookback<=500:!Object.hasOwn(c,'slowLookback'))&&Number.isInteger(c.lookback)&&c.lookback>=1&&c.lookback<=500&&(!c.metric.endsWith('_5M')||c.lookback===5),'GRAPH_ASSET_METRIC','지표와 계산 기간을 확인하세요.');
 if(type==='ASSET_COMPARE')check(exact(c,['operator','value'])&&['gt','gte','lt','lte','eq','neq'].includes(c.operator)&&finite(c.value),'GRAPH_ASSET_COMPARE','종목별 비교 연산과 기준값을 확인하세요.');
 if(type==='ASSET_LOGIC')check(exact(c,['operation'])&&['ALL','ANY','NOT'].includes(c.operation),'GRAPH_ASSET_LOGIC','AND·OR·NOT 조합을 선택하세요.');
 if(type==='ASSET_FILTER')check(exact(c,[]),'GRAPH_ASSET_FILTER','후보 종목과 종목별 조건을 연결하세요.');
 if(type==='SELECT')check(exact(c,['maxPositions'])&&Number.isSafeInteger(c.maxPositions)&&c.maxPositions>=1&&c.maxPositions<=500,'GRAPH_ASSET_SELECT','선택할 상위 종목 수를 1~500개로 지정하세요.');
 if(type==='MEMBER')check(exact(c,[]),'GRAPH_ASSET_MEMBER','선택 집합과 확인할 종목을 연결하세요.');
 if(type==='FILTER')check(exact(c,['minHistoryBars','minQuoteVolume','excludeWarnings'],['conditions','conditionMode','maxSpreadBps','minBookNotional','bookMaxAgeMs'])&&(!Object.hasOwn(c,'conditionMode')||['ALL','ANY'].includes(c.conditionMode))&&['maxSpreadBps','minBookNotional'].every(k=>!Object.hasOwn(c,k)||finite(c[k])&&c[k]>=0)&&(!Object.hasOwn(c,'bookMaxAgeMs')||Number.isSafeInteger(c.bookMaxAgeMs)&&c.bookMaxAgeMs>0&&c.bookMaxAgeMs<=3000)&&Number.isInteger(c.minHistoryBars)&&c.minHistoryBars>=2&&c.minHistoryBars<=1000&&finite(c.minQuoteVolume)&&c.minQuoteVolume>=0&&typeof c.excludeWarnings==='boolean'&&(!Object.hasOwn(c,'conditions')||Array.isArray(c.conditions)&&c.conditions.length<=12&&c.conditions.every(t=>exact(t,['metric','lookback','operator','value'])&&PORTFOLIO_FACTOR_METRICS.includes(t.metric)&&(!t.metric.endsWith('_5M')||t.lookback===5)&&Number.isInteger(t.lookback)&&t.lookback>=1&&t.lookback<=500&&['gt','gte','lt','lte','eq','neq'].includes(t.operator)&&finite(t.value))),'GRAPH_ASSET_FILTER','최소 일봉 이력·거래대금·유의 제외 조건을 확인하세요.');
 if(type==='RANK')check(exact(c,['terms','volatilityBars','direction','minScore'],['scoreNormalization','normalizationLookback','scoreOperator'])&&Array.isArray(c.terms)&&c.terms.length>=1&&c.terms.length<=8&&c.terms.every(t=>exact(t,['metric','lookback','weight'])&&PORTFOLIO_FACTOR_METRICS.includes(t.metric)&&(!t.metric.endsWith('_5M')||t.lookback===5)&&Number.isInteger(t.lookback)&&t.lookback>=2&&t.lookback<=500&&finite(t.weight)&&Math.abs(t.weight)<=100)&&c.terms.some(t=>t.weight!==0)&&Number.isInteger(c.volatilityBars)&&c.volatilityBars>=2&&c.volatilityBars<=500&&['ASC','DESC'].includes(c.direction)&&(c.minScore===null||finite(c.minScore))&&(!Object.hasOwn(c,'scoreOperator')||['gt','gte'].includes(c.scoreOperator))&&(!Object.hasOwn(c,'scoreNormalization')||['NONE','VOLATILITY'].includes(c.scoreNormalization))&&(!Object.hasOwn(c,'normalizationLookback')||Number.isInteger(c.normalizationLookback)&&c.normalizationLookback>=2&&c.normalizationLookback<=500)&&(c.scoreNormalization!=='VOLATILITY'||Number.isInteger(c.normalizationLookback)),'GRAPH_ASSET_RANK','순위 계산의 지표·기간·가중치·정렬 방향을 확인하세요.');
 if(type==='ALLOCATE')check(exact(c,['method','maxPositions','minBudget','maxBudget','maxAssetWeight'],['preserveMembers'])&&(!Object.hasOwn(c,'preserveMembers')||typeof c.preserveMembers==='boolean')&&['EQUAL','INVERSE_VOLATILITY'].includes(c.method)&&Number.isInteger(c.maxPositions)&&c.maxPositions>=1&&c.maxPositions<=500&&ratio(c.minBudget)&&ratio(c.maxBudget)&&c.minBudget<=c.maxBudget&&ratio(c.maxAssetWeight)&&c.maxAssetWeight>0,'GRAPH_ALLOCATION','배분 방식·보유 수·운용 비중 범위·종목별 최대 비중을 확인하세요.');
 if(type==='REBALANCE')check(exact(c,['everyDays','minWeightChange'],['calendar'])&&(!Object.hasOwn(c,'calendar')||c.calendar==='UTC_MONTH')&&Number.isInteger(c.everyDays)&&c.everyDays>=1&&c.everyDays<=365&&ratio(c.minWeightChange),'GRAPH_REBALANCE','리밸런싱 주기와 최소 비중 차이를 확인하세요.');
}
export function validPortfolioContext(value,{profileId,asOf}={}){
 if(!exact(value,['profileId','quoteCurrency','asOf','equity','cashWeight','weights','lastRebalancedAt','universeHash'],['lastAllocationBudget','routerSelections','account','surgePositions'])||Object.hasOwn(value,'lastAllocationBudget')&&value.lastAllocationBudget!==null&&!ratio(value.lastAllocationBudget)||value.profileId!==profileId||!id(profileId)||!iso(value.asOf)||value.asOf>asOf||!finite(value.equity)||value.equity<=0||!ratio(value.cashWeight)||!hash(value.universeHash)||!['BTC','USDT','USD','KRW'].includes(value.quoteCurrency)||!Array.isArray(value.weights)||value.weights.length>500||new Set(value.weights.map(w=>w?.instrumentId)).size!==value.weights.length)return false;
 if(value.account&&(!plain(value.account)||value.account.profileId!==profileId||!id(value.account.accountId)||!iso(value.account.asOf)||value.account.asOf>asOf||!hash(value.account.sourceHash)||!Array.isArray(value.account.positions)||value.account.positions.length>500))return false;
 if(value.surgePositions&&(!plain(value.surgePositions)||Object.keys(value.surgePositions).length>500||Object.entries(value.surgePositions).some(([market,p])=>!/^KRW-[A-Z0-9]+$/.test(market)||!plain(p)||!iso(p.entryAt)||p.entryAt>asOf||!finite(p.peak)||p.peak<=0)))return false;
 if(Object.hasOwn(value,'routerSelections')&&(!plain(value.routerSelections)||Object.keys(value.routerSelections).length>128||!Object.entries(value.routerSelections).every(([router,selected])=>id(router)&&id(selected))))return false;
 if(!value.weights.every(w=>{if(!exact(w,['instrumentId','weight'])||!id(w.instrumentId)||!ratio(w.weight))return false;try{return getInstrument(w.instrumentId).quoteCurrency===value.quoteCurrency;}catch{return false;}}))return false;
 if(Math.abs(sum(value.weights.map(w=>w.weight))+value.cashWeight-1)>1e-8)return false;
 return value.lastRebalancedAt===null||iso(value.lastRebalancedAt)&&value.lastRebalancedAt<=asOf;
}
export function validPortfolioCandidateInput(input,{profileId,asOf,portfolio}={}){
 const v=input?.value;
 if(!exact(v,['contractVersion','profileId','quoteCurrency','timeframe','asOf','universeHash','items'],['evaluatedAt','news','newsHalfLifeHours','availableAt'])||v.contractVersion!==PORTFOLIO_CANDIDATE_VERSION||v.profileId!==profileId||v.quoteCurrency!==portfolio?.quoteCurrency||v.universeHash!==portfolio?.universeHash||!Object.hasOwn(PORTFOLIO_CANDIDATE_TIMEFRAMES,v.timeframe)||!iso(v.asOf)||v.asOf!==input.asOf||v.asOf>asOf||Object.hasOwn(v,'evaluatedAt')&&(!iso(v.evaluatedAt)||v.evaluatedAt!==asOf||v.evaluatedAt<v.asOf)||!hash(v.universeHash)||!Array.isArray(v.items)||v.items.length<1||v.items.length>500||new Set(v.items.map(i=>i?.instrumentId)).size!==v.items.length)return false;
 if(v.availableAt&&(!iso(v.availableAt)||v.availableAt<v.asOf||v.availableAt>asOf))return false;
 if(v.news){try{assertPortfolioNews(v.news);if(v.news.asOf>asOf||!finite(v.newsHalfLifeHours)||v.newsHalfLifeHours<=0)return false;}catch{return false;}}
 return v.items.every(item=>{
  if(!exact(item,['instrumentId','bars','quoteVolume','warning'],['book','warningKnown','observations','quote'])||!id(item.instrumentId)||!finite(item.quoteVolume)||item.quoteVolume<0||typeof item.warning!=='boolean'||(Object.hasOwn(item,'warningKnown')&&typeof item.warningKnown!=='boolean')||!Array.isArray(item.bars)||item.bars.length>1000)return false;
  if(item.quote&&(!exact(item.quote,['bidPrice','askPrice','eventTime','availableAt','sourceHash'],['basis','receivedAt','rawSourceHash'])||!iso(item.quote.eventTime)||!iso(item.quote.availableAt)||item.quote.eventTime>item.quote.availableAt||item.quote.availableAt>asOf||!hash(item.quote.sourceHash)||!(Number(item.quote.askPrice)>=Number(item.quote.bidPrice)&&Number(item.quote.bidPrice)>0)))return false;
  if(item.observations!==undefined&&(!exact(item.observations,['asOf','availableAt','sourceHash','buyQuoteRatio5m','midReturn5m'])||!iso(item.observations.asOf)||item.observations.asOf!==v.asOf||!iso(item.observations.availableAt)||item.observations.availableAt>asOf||!hash(item.observations.sourceHash)||!ratio(item.observations.buyQuoteRatio5m)||!finite(item.observations.midReturn5m)))return false;
  if(item.book!==undefined&&(!exact(item.book,['asOf','availableAt','sourceHash','spreadBps','bidNotional','askNotional'])||!iso(item.book.asOf)||!iso(item.book.availableAt)||item.book.asOf>item.book.availableAt||item.book.availableAt>asOf||!hash(item.book.sourceHash)||![item.book.spreadBps,item.book.bidNotional,item.book.askNotional].every(n=>finite(n)&&n>=0)))return false;
  try{if(getInstrument(item.instrumentId).quoteCurrency!==v.quoteCurrency)return false;}catch{return false;}
  return item.bars.every((b,i)=>exact(b,['openTime','closeTime','open','high','low','close','volume'],['quoteVolume'])&&(!Object.hasOwn(b,'quoteVolume')||finite(b.quoteVolume)&&b.quoteVolume>=0)&&iso(b.openTime)&&iso(b.closeTime)&&Date.parse(b.closeTime)-Date.parse(b.openTime)===PORTFOLIO_CANDIDATE_TIMEFRAMES[v.timeframe]&&b.closeTime<=v.asOf&&[b.open,b.high,b.low,b.close,b.volume].every(finite)&&Math.min(b.open,b.high,b.low,b.close)>0&&b.volume>=0&&b.high>=Math.max(b.open,b.close)&&b.low<=Math.min(b.open,b.close)&&(!i||item.bars[i-1].closeTime<=b.openTime));
 });
}
/** Selection preserves the deterministic ranking and its point-in-time scope. */
export function selectPortfolioCandidates(value,config,{choice}={}){
 assertPortfolioNodeConfig('SELECT',config);check(value?.contractVersion===PORTFOLIO_RANK_VERSION&&Array.isArray(value.items),'GRAPH_ASSET_SELECT','계산된 종목 순위를 연결하세요.');
 check(choice===undefined||config.maxPositions===1&&(choice==='CASH'||value.items.some(item=>item.instrumentId===choice)),'GRAPH_ASSET_CHOICE','후보 안의 한 종목 또는 현금을 선택하세요.');
 const items=choice===undefined?value.items.slice(0,config.maxPositions):value.items.filter(item=>item.instrumentId===choice);
 return {contractVersion:PORTFOLIO_SELECTION_VERSION,profileId:value.profileId,quoteCurrency:value.quoteCurrency,timeframe:value.timeframe,asOf:value.asOf,universeHash:value.universeHash,instrumentIds:items.map(i=>i.instrumentId),rankHash:hashInputPackage(value),maxPositions:config.maxPositions};
}
const continuity=(bars,n,asOf)=>bars.length>=n&&bars.at(-1)?.closeTime===asOf&&bars.slice(-n).every((b,i,a)=>i===0||a[i-1].closeTime===b.openTime);
const volatility=(bars,n)=>{const b=bars.slice(-n-1),returns=b.slice(1).map((v,i)=>Math.log(v.close/b[i].close)),mean=sum(returns)/returns.length;return Math.sqrt(sum(returns.map(v=>(v-mean)**2))/returns.length);};
export function portfolioFactorValue(bars,metric,lookback,observations=null){
 if(metric==='MONTHLY_SMA_DISTANCE')return monthlySmaDistance(bars,lookback);
 if(metric==='BUY_QUOTE_RATIO_5M')return observations?.buyQuoteRatio5m??null;
 if(metric==='MID_RETURN_5M')return observations?.midReturn5m??null;
 if(bars.length<lookback+1)return null;
 if(metric==='LOG_MOMENTUM')return Math.log(bars.at(-1).close/bars.at(-1-lookback).close);
 if(metric==='MOMENTUM')return bars.at(-1).close/bars.at(-1-lookback).close-1;
 if(metric==='VOLATILITY')return volatility(bars,lookback);
 if(metric==='SMA_DISTANCE')return bars.at(-1).close/(sum(bars.slice(-lookback).map(b=>b.close))/lookback)-1;
 if(metric==='BREAKOUT')return bars.at(-1).close/Math.max(...bars.slice(-lookback-1,-1).map(b=>b.high))-1;
 if(metric==='QUOTE_VOLUME'){const selected=bars.slice(-lookback);return selected.every(b=>finite(b.quoteVolume))?sum(selected.map(b=>b.quoteVolume))/lookback:null;}
 return null;
}
const compare=(actual,operator,threshold)=>operator==='gt'?actual>threshold:operator==='gte'?actual>=threshold:operator==='lt'?actual<threshold:operator==='lte'?actual<=threshold:operator==='eq'?actual===threshold:actual!==threshold;
export const assetConditionDefaults=type=>clone({ASSET_METRIC:{metric:'MOMENTUM',lookback:1},ASSET_COMPARE:{operator:'gte',value:.05},ASSET_LOGIC:{operation:'ALL'},ASSET_FILTER:{}}[type]);
/** Missing observations cannot silently change the population behind a regime decision. */
export function reduceAssetValues(value,config,excludedInstrument=null){
 assertPortfolioNodeConfig('ASSET_REDUCE',config);
 check(value?.contractVersion==='asset-values-v1'&&Array.isArray(value.items)&&value.items.length<=500&&value.items.every(i=>id(i?.instrumentId))&&new Set(value.items.map(i=>i.instrumentId)).size===value.items.length,'GRAPH_ASSET_REDUCE','동일 시점의 종목별 숫자를 연결하세요.');
 if(excludedInstrument!==null){let valid=false;try{valid=getInstrument(excludedInstrument).id===excludedInstrument;}catch{}check(valid&&value.items.some(i=>i.instrumentId===excludedInstrument),'GRAPH_ASSET_REDUCE_EXCLUDE','제외할 종목은 입력 집합에 포함된 정식 종목 참조여야 합니다.');}
 const items=value.items.filter(i=>i.instrumentId!==excludedInstrument);
 check(items.length>0&&items.every(i=>finite(i.value)),'GRAPH_ASSET_REDUCE_HISTORY','집계 대상 전체의 지표가 필요합니다. 빈 집합·자료 부족을 0으로 처리하지 않습니다.');
 const sorted=items.map(i=>i.value).sort((a,b)=>a-b),mid=Math.floor(sorted.length/2);
 return {value:config.operation==='POSITIVE_FRACTION'?sorted.filter(v=>v>0).length/sorted.length:sorted.length%2?sorted[mid]:(sorted[mid-1]+sorted[mid])/2,unit:config.operation==='MEDIAN'&&value.metric==='QUOTE_VOLUME'?value.quoteCurrency:'ratio',count:items.length,excludedInstrument,asOf:value.asOf,sourceHash:hashInputPackage(value)};
}
/** Each primitive is an executable graph node, not an editor-only illustration. */
export function evaluateAssetCondition(type,config,values,{portfolio}={}){
 assertPortfolioNodeConfig(type,config);const first=values[0];
 const scope=v=>({profileId:v.profileId,quoteCurrency:v.quoteCurrency,timeframe:v.timeframe,asOf:v.asOf,universeHash:v.universeHash});
 const map=(v,kind,items,extra={})=>({...scope(v),contractVersion:kind,candidateHash:v.candidateHash??hashInputPackage(v),items,...extra});
 if(type==='ASSET_METRIC'){
  check(first?.contractVersion===PORTFOLIO_CANDIDATE_VERSION,'GRAPH_ASSET_METRIC','지표에 후보 종목을 연결하세요.');
  if(config.metric==='MONTHLY_SMA_DISTANCE'){check(first.timeframe==='1d'&&first.items.length>0,'CALENDAR_HISTORY_REQUIRED','월말 지표에는 확정 일봉이 필요합니다.');for(const item of first.items)monthlySmaDistance(item.bars,config.lookback);}
  if(PRICE_STRUCTURE_METRICS.includes(config.metric)){
   check(first.timeframe==='1d','PRICE_STRUCTURE_TIMEFRAME','가격 구조 지표에는 확정 일봉을 연결하세요.');
   return map(first,'asset-values-v1',first.items.map(item=>{
    const value=priceStructureMetric(item.bars,config.metric,config.lookback,config.slowLookback);
    check(value!==null||!portfolio?.weights.some(w=>w.instrumentId===item.instrumentId&&w.weight>0),'PRICE_STRUCTURE_HELD_HISTORY_REQUIRED','보유 종목의 추세를 계산할 자료가 부족합니다. 자료 부족을 청산 신호로 처리하지 않습니다.');
    return {instrumentId:item.instrumentId,value,...(value===null?{reason:'PRICE_STRUCTURE_HISTORY_REQUIRED',observedDailyBars:item.bars.length}:{})};
   }),{metric:config.metric,lookback:config.lookback});
  }
  return map(first,'asset-values-v1',first.items.map(item=>({instrumentId:item.instrumentId,value:continuity(item.bars,config.lookback+1,first.asOf)?portfolioFactorValue(item.bars,config.metric,config.lookback,item.observations):null})),{metric:config.metric,lookback:config.lookback});
 }
 if(type==='ASSET_COMPARE'){
  check(first?.contractVersion==='asset-values-v1','GRAPH_ASSET_COMPARE','종목별 숫자 지표를 연결하세요.');
  return map(first,'asset-conditions-v1',first.items.map(item=>({instrumentId:item.instrumentId,value:item.value===null?null:compare(item.value,config.operator,config.value),actual:item.value})));
 }
 if(type==='ASSET_LOGIC'){
  check(values.length>=(config.operation==='NOT'?1:2)&&values.every(v=>v?.contractVersion==='asset-conditions-v1'&&v.candidateHash===first.candidateHash&&JSON.stringify(scope(v))===JSON.stringify(scope(first))&&JSON.stringify(v.items.map(i=>i.instrumentId))===JSON.stringify(first.items.map(i=>i.instrumentId))),'GRAPH_ASSET_CONDITION_SCOPE','같은 시점·후보 집합의 조건끼리 연결하세요.');
  return map(first,'asset-conditions-v1',first.items.map((item,i)=>{const bits=values.map(v=>v.items[i].value),value=config.operation==='NOT'?(bits[0]===null?null:!bits[0]):config.operation==='ANY'?(bits.includes(true)?true:bits.includes(null)?null:false):(bits.includes(false)?false:bits.includes(null)?null:true);return {instrumentId:item.instrumentId,value};}));
 }
 check(type==='ASSET_FILTER'&&first?.contractVersion===PORTFOLIO_CANDIDATE_VERSION&&values[1]?.contractVersion==='asset-conditions-v1'&&values[1].candidateHash===hashInputPackage(first),'GRAPH_ASSET_CONDITION_SCOPE','이 후보 집합에서 계산한 조건을 연결하세요.');
 const selected=new Map(values[1].items.map(item=>[item.instrumentId,item.value]));return {...clone(first),items:first.items.filter(item=>selected.get(item.instrumentId)===true).map(item=>clone(item))};
}
export function filterPortfolioCandidates(value,config){
 assertPortfolioNodeConfig('FILTER',config);const excluded=[],items=[],required=Math.max(config.minHistoryBars,...(config.conditions??[]).map(c=>c.lookback+1));
 for(const item of value.items){let reason=config.excludeWarnings&&item.warningKnown===false?'MARKET_WARNING_UNKNOWN':config.excludeWarnings&&item.warning?'MARKET_WARNING':item.quoteVolume<config.minQuoteVolume?'QUOTE_VOLUME_BELOW_MINIMUM':item.bars.length<required?'HISTORY_TOO_SHORT':!continuity(item.bars,required,value.asOf)?'DAILY_CANDLE_GAP':null;const conditions=[];
  if(!reason&&(Object.hasOwn(config,'maxSpreadBps')||Object.hasOwn(config,'minBookNotional'))){const b=item.book,age=config.bookMaxAgeMs??3000,observedAt=Date.parse(value.evaluatedAt??value.asOf);reason=!b?'BOOK_REQUIRED':observedAt-Date.parse(b.asOf)>age||observedAt-Date.parse(b.availableAt)>age?'BOOK_STALE':Object.hasOwn(config,'maxSpreadBps')&&b.spreadBps>config.maxSpreadBps?'SPREAD_ABOVE_MAXIMUM':Object.hasOwn(config,'minBookNotional')&&Math.min(b.bidNotional,b.askNotional)<config.minBookNotional?'BOOK_DEPTH_BELOW_MINIMUM':null;}
  if(!reason)for(const condition of config.conditions??[]){const actual=portfolioFactorValue(item.bars,condition.metric,condition.lookback,item.observations),passed=actual!==null&&compare(actual,condition.operator,condition.value);conditions.push({...condition,actual,passed});}
  if(conditions.length&&!(config.conditionMode==='ANY'?conditions.some(c=>c.passed):conditions.every(c=>c.passed)))reason=conditions.some(c=>c.actual===null)?'FACTOR_DATA_REQUIRED':'FACTOR_CONDITION_NOT_MET';
  if(reason)excluded.push({instrumentId:item.instrumentId,reason,...(conditions.length?{conditions}:{})});else items.push(clone(item));
 }
 return {value:{...clone(value),items},excluded};
}
export function rankPortfolioCandidates(value,config){
 assertPortfolioNodeConfig('RANK',config);const required=Math.max(config.volatilityBars,config.scoreNormalization==='VOLATILITY'?config.normalizationLookback:0,...config.terms.map(t=>t.lookback))+1,denominator=sum(config.terms.map(t=>Math.abs(t.weight))),excluded=[],scored=[];
 for(const item of value.items){if(!continuity(item.bars,required,value.asOf)){excluded.push({instrumentId:item.instrumentId,reason:item.bars.length<required?'HISTORY_TOO_SHORT':'DAILY_CANDLE_GAP'});continue;}
  const terms=config.terms.map(t=>({...t,value:portfolioFactorValue(item.bars,t.metric,t.lookback,item.observations)}));if(terms.some(t=>t.value===null)){excluded.push({instrumentId:item.instrumentId,reason:'FACTOR_DATA_REQUIRED'});continue;}
  const divisor=config.scoreNormalization==='VOLATILITY'?volatility(item.bars,config.normalizationLookback):1;if(!(divisor>0)){excluded.push({instrumentId:item.instrumentId,reason:'NORMALIZATION_VOLATILITY_ZERO'});continue;}
  const score=sum(terms.map(t=>t.value*t.weight))/denominator/divisor;
  scored.push({instrumentId:item.instrumentId,score,volatility:volatility(item.bars,config.volatilityBars),quoteVolume:item.quoteVolume,historyBars:item.bars.length,terms});
 }
 const breadth=scored.length?scored.filter(item=>item.score>0).length/scored.length:0;
 const eligible=scored.filter(item=>{if(config.minScore!==null&&!compare(item.score,config.scoreOperator??'gt',config.minScore)){excluded.push({instrumentId:item.instrumentId,reason:'SCORE_BELOW_MINIMUM'});return false;}return true;});
 eligible.sort((a,b)=>(config.direction==='DESC'?b.score-a.score:a.score-b.score)||a.instrumentId.localeCompare(b.instrumentId));
 return {value:{contractVersion:PORTFOLIO_RANK_VERSION,profileId:value.profileId,quoteCurrency:value.quoteCurrency,timeframe:value.timeframe,asOf:value.asOf,universeHash:value.universeHash,items:eligible,breadth,candidateCount:value.items.length,eligibleCount:eligible.length},excluded};
}
const targetsValue=(portfolio,asOf,targets,extra={})=>({contractVersion:PORTFOLIO_TARGET_VERSION,profileId:portfolio.profileId,quoteCurrency:portfolio.quoteCurrency,asOf,universeHash:portfolio.universeHash,targets,cashWeight:Math.max(0,1-sum(targets.map(t=>t.targetWeight))),rebalanceDue:true,...extra});
export function currentPortfolioTargets(portfolio,asOf){return targetsValue(portfolio,asOf,portfolio.weights.map(w=>({instrumentId:w.instrumentId,targetWeight:w.weight})),{rebalanceDue:false});}
export function allocatePortfolioTargets(value,budget,config,portfolio,retain=null){
 assertPortfolioNodeConfig('ALLOCATE',config);check(ratio(budget),'GRAPH_ALLOCATION_BUDGET','운용 비중 입력은 0~1이어야 합니다.');
 if(retain)check(retain.contractVersion===PORTFOLIO_RANK_VERSION&&['profileId','quoteCurrency','timeframe','asOf','universeHash'].every(k=>retain[k]===value[k]),'ALLOCATION_RETAIN_SCOPE','같은 시점과 투자 범위의 보유 조건을 연결하세요.');
 const owned=new Set(portfolio.weights.filter(w=>w.weight>1e-10).map(w=>w.instrumentId)),kept=retain?retain.items.filter(i=>owned.has(i.instrumentId)).slice(0,config.maxPositions):[];
 const requestedBudget=clamp(budget,config.minBudget,config.maxBudget),selected=[...kept,...value.items.filter(i=>!kept.some(k=>k.instrumentId===i.instrumentId))].slice(0,config.maxPositions);
 if(config.preserveMembers&&portfolio.lastRebalancedAt!==null&&portfolio.lastAllocationBudget===requestedBudget&&selected.length===owned.size&&selected.every(i=>owned.has(i.instrumentId)))return {value:currentPortfolioTargets(portfolio,value.asOf),requestedBudget,unallocatedBudget:portfolio.cashWeight,excluded:[]};
 const weighted=selected.filter(i=>config.method==='EQUAL'||i.volatility>0).map(i=>({instrumentId:i.instrumentId,score:config.method==='EQUAL'?1:1/i.volatility,targetWeight:0}));
 let remainder=requestedBudget,open=[...weighted];
 while(open.length&&remainder>1e-12){const total=sum(open.map(i=>i.score)),capped=open.filter(i=>remainder*i.score/total>=config.maxAssetWeight);if(!capped.length){for(const item of open)item.targetWeight=remainder*item.score/total;remainder=0;break;}for(const item of capped){item.targetWeight=config.maxAssetWeight;remainder-=config.maxAssetWeight;}open=open.filter(i=>!capped.includes(i));}
 const byId=new Map(weighted.map(i=>[i.instrumentId,i.targetWeight]));for(const held of portfolio.weights)if(!byId.has(held.instrumentId))byId.set(held.instrumentId,0);
 return {value:targetsValue(portfolio,value.asOf,[...byId].map(([instrumentId,targetWeight])=>({instrumentId,targetWeight}))),requestedBudget,unallocatedBudget:Math.max(0,remainder),excluded:selected.filter(i=>!weighted.some(w=>w.instrumentId===i.instrumentId)).map(i=>({instrumentId:i.instrumentId,reason:'ZERO_VOLATILITY'}))};
}
export const portfolioRebalanceDue=(portfolio,asOf,config)=>portfolio.lastRebalancedAt===null||(config.calendar==='UTC_MONTH'?asOf.slice(0,7)!==portfolio.lastRebalancedAt.slice(0,7):Date.parse(asOf)-Date.parse(portfolio.lastRebalancedAt)>=config.everyDays*DAY);
export function rebalancePortfolioTargets(value,config,portfolio){
 assertPortfolioNodeConfig('REBALANCE',config);if(!portfolioRebalanceDue(portfolio,value.asOf,config))return currentPortfolioTargets(portfolio,value.asOf);
 const before=new Map(portfolio.weights.map(w=>[w.instrumentId,w.weight])),largest=Math.max(0,...value.targets.map(t=>Math.abs(t.targetWeight-(before.get(t.instrumentId)??0))));
 return largest+1e-12<config.minWeightChange?currentPortfolioTargets(portfolio,value.asOf):clone(value);
}
export function riskPortfolioTargets(value,config,portfolio){
 const desired=clone(value.targets),exposure=sum(desired.map(t=>t.targetWeight)),scale=exposure>config.maxExposure?config.maxExposure/exposure:1,before=new Map(portfolio.weights.map(w=>[w.instrumentId,w.weight]));
 for(const target of desired)target.targetWeight=clamp(target.targetWeight*scale,Math.max(0,(before.get(target.instrumentId)??0)-config.maxOrderWeight),Math.min(1,(before.get(target.instrumentId)??0)+config.maxOrderWeight));
 const total=sum(desired.map(t=>t.targetWeight));if(total>1){const buys=desired.filter(t=>t.targetWeight>(before.get(t.instrumentId)??0)),excess=total-1,delta=sum(buys.map(t=>t.targetWeight-(before.get(t.instrumentId)??0)));for(const target of buys)target.targetWeight-=excess*(target.targetWeight-(before.get(target.instrumentId)??0))/delta;}
 return targetsValue(portfolio,value.asOf,desired,{rebalanceDue:value.rebalanceDue});
}
export function portfolioOrderChanges(value,portfolio){const before=new Map(portfolio.weights.map(w=>[w.instrumentId,w.weight]));return value.targets.map(t=>({...t,currentWeight:before.get(t.instrumentId)??0,deltaWeight:t.targetWeight-(before.get(t.instrumentId)??0)})).filter(t=>Math.abs(t.deltaWeight)>1e-12).sort((a,b)=>a.deltaWeight-b.deltaWeight||a.instrumentId.localeCompare(b.instrumentId));}

/** Restore a candidate branch from the immutable input and the same editable filters. */
export function restorePortfolioCandidateValue(graph,executionInputs,nodeId,{expectedHash=null}={}){
 const active=new Set(),memo=new Map();function visit(id){
  if(memo.has(id))return memo.get(id);check(!active.has(id),'GRAPH_ASSET_RESTORE','후보 종목 연결을 확인하세요.');active.add(id);
  const node=graph.nodes.find(n=>n.id===id),links=graph.edges.filter(e=>e.to.nodeId===id);let value;
  if(node?.type==='INPUT'&&node.config.kind==='ASSET_SET'){const input=resolveGraphInput(executionInputs,id,{graph});check(input?.ready&&input.value?.contractVersion===PORTFOLIO_CANDIDATE_VERSION,'GRAPH_ASSET_RESTORE','후보 종목 원문을 확인하세요.');value=clone(input.value);const resolved=resolveQueryParameters(graph,node);check(resolved.ready,'GRAPH_ASSET_RESTORE','종목 변수를 확인하세요.');if(resolved.node.config.instrumentId)value.items=value.items.filter(i=>i.instrumentId===resolved.node.config.instrumentId);}
  else if(node?.type==='FILTER'){check(links.length===1&&links[0].to.port==='assets','GRAPH_ASSET_RESTORE','후보 필터 입력을 확인하세요.');value=filterPortfolioCandidates(visit(links[0].from.nodeId),node.config).value;}
  else {check(ASSET_CONDITION_TYPES.includes(node?.type),'GRAPH_ASSET_RESTORE','후보 부품의 연결을 확인하세요.');const ordered=node.type==='ASSET_FILTER'?['assets','conditions'].map(port=>links.find(e=>e.to.port===port)):links;check(ordered.every(Boolean),'GRAPH_ASSET_RESTORE','후보 부품의 필수 연결을 확인하세요.');value=evaluateAssetCondition(node.type,node.config,ordered.map(e=>visit(e.from.nodeId)));}
  active.delete(id);memo.set(id,value);return value;
 }
 const value=visit(nodeId);check(value?.contractVersion===PORTFOLIO_CANDIDATE_VERSION&&(expectedHash===null||hashInputPackage(value)===expectedHash),'GRAPH_ASSET_RESTORE_HASH','후보 필터 원문과 저장 식별값을 대조하세요.');return value;
}

export function materializePortfolioTraceValue({graph,evaluation,inputs,nodeId}){
 const row=evaluation?.trace?.find(item=>item.nodeId===nodeId),summary=row?.output?.valueSummary;check(row?.output?.ready===true&&summary?.kind==='ASSET_SET'&&hash(summary.hash),'GRAPH_ASSET_RESTORE','저장된 후보 입력과 필터 결과를 확인하세요.');return restorePortfolioCandidateValue(graph,inputs,nodeId,{expectedHash:summary.hash});
}
