import {remainingLiquidationReturn} from './position-liquidation.mjs';
import {hashInputPackage} from './workspace.mjs';
import {getInstrument} from './instruments.mjs';

export const POSITION_INPUT_VERSION='position-input-v1';
export const POSITION_ACCOUNT_VIEW_VERSION='position-account-view-v1';
export const POSITION_PORTFOLIO_VIEW_VERSION='position-portfolio-view-v1';
export const POSITION_INPUT_METRICS=Object.freeze([
 {id:'PORTFOLIO',label:'포트폴리오 전체',dataType:'CONTEXT',unit:'portfolio'},
 {id:'SNAPSHOT',label:'선택 종목 포지션',dataType:'CONTEXT',unit:'position'},
 {id:'TRADE_HISTORY',label:'현재 포지션과 최근 체결',dataType:'CONTEXT',unit:'position'},
 {id:'QUANTITY',label:'보유 수량',dataType:'NUMBER',unit:'units',key:'quantity'},
 {id:'MARKET_VALUE',label:'보유 평가액',dataType:'NUMBER',unit:'currency',key:'marketValue'},
 {id:'EQUITY',label:'계좌 평가자산',dataType:'NUMBER',unit:'currency',key:'equity'},
 {id:'CASH_WEIGHT',label:'현금 비중',dataType:'NUMBER',unit:'ratio',key:'cashWeight'},
 {id:'HAS_POSITION',label:'보유 여부',dataType:'BOOLEAN',unit:'boolean',key:'hasPosition'},
 {id:'INTENT_COOLDOWN_READY',label:'같은 매도 구간 재실행 가능',dataType:'BOOLEAN',unit:'boolean'},
 {id:'WEIGHT',label:'현재 보유 비중',dataType:'NUMBER',unit:'ratio',key:'weight'},
 {id:'AVERAGE_COST',label:'평균 매입 단가',dataType:'NUMBER',unit:'currency_per_unit',key:'averageCost'},
 {id:'UNREALIZED_RETURN',label:'평가 수익률',dataType:'NUMBER',unit:'ratio',key:'unrealizedReturn'},
 {id:'UNREALIZED_PNL',label:'평가 손익',dataType:'NUMBER',unit:'currency',key:'unrealizedPnl'},
 {id:'CASH',label:'가용 현금',dataType:'NUMBER',unit:'currency',key:'cash'},
 {id:'PORTFOLIO_RETURN',label:'계좌 누적 수익률',dataType:'NUMBER',unit:'ratio',key:'netReturn'},
 {id:'ACCOUNT_AGE_HOURS',label:'계좌 운용 경과 시간',dataType:'NUMBER',unit:'hours',key:'accountAgeHours'},
 {id:'NET_LIQUIDATION_RETURN',label:'매도 수수료·잔량 호가 반영 수익률',dataType:'NUMBER',unit:'ratio'},
 {id:'SIGNAL_HOURS_HELD',label:'진입 신호의 정시부터 경과 시간',dataType:'NUMBER',unit:'hours'},
 {id:'HOURS_HELD',label:'현재 보유 경과 시간',dataType:'NUMBER',unit:'hours',key:'hoursHeld'},
 {id:'ENTRY_COUNT',label:'현재 보유의 매수 횟수',dataType:'NUMBER',unit:'count',key:'entryCount'},
 {id:'ENTRY_TIME_MS',label:'현재 보유 시작 시각',dataType:'NUMBER',unit:'ms',key:'entryTimeMs'},
 {id:'LAST_EXIT_PRICE',label:'직전 전량 매도 단가',dataType:'NUMBER',unit:'currency_per_unit',key:'lastExitPrice'},
 {id:'HOURS_SINCE_EXIT',label:'직전 전량 매도 후 시간',dataType:'NUMBER',unit:'hours',key:'hoursSinceExit'},
].map(metric=>Object.freeze(metric)));
export const positionInputMetric=id=>POSITION_INPUT_METRICS.find(metric=>metric.id===id)??null;
const finite=value=>typeof value==='number'&&Number.isFinite(value)&&Math.abs(value)<1e14;
const iso=value=>typeof value==='string'&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value;
const id=value=>typeof value==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9_.:@/-]{0,199}$/.test(value);
const close=(a,b)=>finite(a)&&finite(b)&&Math.abs(a-b)<=Math.max(1e-8,Math.max(Math.abs(a),Math.abs(b))*1e-7);
const blocked=(asOf,code)=>({ready:false,value:null,unit:null,asOf,availableAt:null,sourceRefs:[],missing:[code]});

export function validPositionInput(binding,input){
 const metric=positionInputMetric(binding?.metricId);let instrument;try{instrument=getInstrument(binding?.instrumentId);}catch{return false;}
 if(!metric||input?.contractVersion!==POSITION_INPUT_VERSION||input.instrumentId!==binding.instrumentId||input.metricId!==metric.id||input.dataType!==metric.dataType)return false;
 const unit=metric.unit==='currency'?instrument.quoteCurrency:metric.unit==='currency_per_unit'?instrument.quoteCurrency+'/unit':metric.unit;
 if(input.unit!==unit)return false;
 if(metric.dataType==='NUMBER')return finite(input.value)&&(['WEIGHT','CASH_WEIGHT'].includes(metric.id)?input.value>=0&&input.value<=1:['hours','count','units'].includes(metric.unit)||['MARKET_VALUE','EQUITY','CASH'].includes(metric.id)?input.value>=0:true);
 if(metric.dataType==='BOOLEAN')return typeof input.value==='boolean';
 const value=input.value;
 const base=value?.contractVersion===POSITION_INPUT_VERSION&&value.instrumentId===binding.instrumentId&&value.quoteCurrency===instrument.quoteCurrency&&id(value.accountId)&&id(value.profileId)&&iso(value.asOf)&&value.asOf<=input.availableAt&&typeof value.hasPosition==='boolean'&&finite(value.cash)&&finite(value.equity)&&input.sourceRefs?.some(ref=>ref.contentHash===value.accountHash);
 return Boolean(base&&(metric.id!=='PORTFOLIO'||validPortfolioValue(value))&&(metric.id!=='TRADE_HISTORY'||Array.isArray(value.recentFills)&&value.recentFills.length<=16&&value.recentFills.every(f=>iso(f.at)&&f.at<=value.asOf&&['buy','sell'].includes(f.side)&&finite(f.quantity)&&f.quantity>0&&finite(f.fillPrice)&&f.fillPrice>0)));
}

/** The paper and historical adapters provide this same owner-scoped account view. */
export function buildPositionSnapshot({account,profileId,instrumentId,asOf,availableAt=asOf}={}){
 if(!iso(asOf)||!iso(availableAt)||availableAt<asOf)return blocked(asOf,'POSITION_TIME_INVALID');
 if(!account)return blocked(asOf,'POSITION_ACCOUNT_REQUIRED');
 let instrument;try{instrument=getInstrument(instrumentId);}catch{return blocked(asOf,'POSITION_INSTRUMENT_INVALID');}
 if(!id(account.id)||!id(profileId)||account.profileId!==profileId||account.quoteCurrency!==instrument.quoteCurrency)return blocked(asOf,'POSITION_ACCOUNT_SCOPE');
 if(!iso(account.asOf)||account.asOf>asOf||account.updatedAt&&(!iso(account.updatedAt)||account.updatedAt>asOf))return blocked(asOf,'POSITION_ACCOUNT_TIME');
 if(!finite(account.cash)||account.cash<0||!finite(account.equity)||account.equity<0||!Array.isArray(account.positions)||!Array.isArray(account.ledger)||account.ledger.length>10000)return blocked(asOf,'POSITION_ACCOUNT_INVALID');
 const seen=new Set();let holdingsValue=0;
 for(const held of account.positions){
  if(!id(held.instrumentId)||seen.has(held.instrumentId)||!finite(held.quantity)||held.quantity<=0||!finite(held.costBasis)||held.costBasis<=0||!finite(held.averageCost)||!close(held.averageCost,held.costBasis/held.quantity)||!finite(held.marketPrice)||held.marketPrice<=0||held.quoteCurrency&&held.quoteCurrency!==account.quoteCurrency||held.priceAsOf&&(!iso(held.priceAsOf)||held.priceAsOf>asOf))return blocked(asOf,'POSITION_HOLDING_INVALID');
  seen.add(held.instrumentId);holdingsValue+=held.quantity*held.marketPrice;
 }
 if(!close(account.equity,account.cash+holdingsValue))return blocked(asOf,'POSITION_EQUITY_MISMATCH');
 let quantity=0,entryAt=null,entryCount=0,lastExit=null,previousAt=null;const runIds=new Set();
 for(const fill of account.ledger){
  if(!id(fill.instrumentId)||!id(fill.runId)||runIds.has(fill.runId)||!iso(fill.at)||fill.at>asOf||previousAt&&fill.at<previousAt||!['buy','sell'].includes(fill.side)||!finite(fill.quantity)||fill.quantity<=0||!finite(fill.fillPrice)||fill.fillPrice<=0)return blocked(asOf,'POSITION_LEDGER_INVALID');
  previousAt=fill.at;runIds.add(fill.runId);if(fill.instrumentId!==instrumentId)continue;
  if(fill.side==='buy'){if(quantity===0){entryAt=fill.at;entryCount=0;}quantity+=fill.quantity;entryCount++;}
  else{
   if(fill.quantity>quantity+1e-8)return blocked(asOf,'POSITION_LEDGER_QUANTITY');
   quantity=Math.max(0,quantity-fill.quantity);
   if(quantity<1e-8){quantity=0;entryAt=null;entryCount=0;lastExit={at:fill.at,runId:fill.runId,price:fill.fillPrice,quantity:fill.quantity,realizedPnl:finite(fill.realizedPnl)?fill.realizedPnl:null,fee:finite(fill.fee)?fill.fee:null,...(fill.intent?{intent:structuredClone(fill.intent)}:{})};}
  }
 }
 const held=account.positions.find(position=>position.instrumentId===instrumentId),heldQuantity=held?.quantity??0;
 if(!close(quantity,heldQuantity))return blocked(asOf,'POSITION_LEDGER_QUANTITY');
 const hasPosition=heldQuantity>0,marketValue=hasPosition?heldQuantity*held.marketPrice:0,costBasis=held?.costBasis??0,unrealizedPnl=hasPosition?marketValue-costBasis:0;
 const accountHash=hashInputPackage(account),value={contractVersion:POSITION_INPUT_VERSION,accountViewVersion:POSITION_ACCOUNT_VIEW_VERSION,accountId:account.id,profileId,instrumentId,quoteCurrency:account.quoteCurrency,asOf,accountAsOf:account.asOf,accountHash,hasPosition,quantity:heldQuantity,cash:account.cash,equity:account.equity,weight:account.equity>0?marketValue/account.equity:0,marketPrice:held?.marketPrice??null,priceAsOf:held?.priceAsOf??(hasPosition?account.asOf:null),marketValue,costBasis,averageCost:held?.averageCost??null,unrealizedPnl,unrealizedReturn:hasPosition?unrealizedPnl/costBasis:null,returnPolicy:'MARK_TO_MARKET_INCLUDES_ENTRY_COST_EXCLUDES_FUTURE_EXIT_COST_V1',entryAt,entryTimeMs:entryAt?Date.parse(entryAt):0,entryCount,lastExit,lastExitPrice:lastExit?.price??null,hoursSinceExit:lastExit?(Date.parse(asOf)-Date.parse(lastExit.at))/3600000:null};
 return {ready:true,value,unit:'position',instrumentId,asOf:account.asOf,availableAt,sourceRefs:[{id:'position-'+hashInputPackage(value).slice(0,32),contentHash:accountHash,sourceRef:'paper-account:'+account.id}],missing:[]};
}

/** One currency account, reconstructed from this mind's ledger at the decision clock. */
export function buildPortfolioSnapshot(options={}){
 const snapshot=buildPositionSnapshot(options);if(!snapshot.ready)return snapshot;
 const {account}=options,{asOf,quoteCurrency}=snapshot.value,quantities=new Map(),holdings=new Map(account.positions.map(held=>[held.instrumentId,held]));
 for(const fill of account.ledger){const prior=quantities.get(fill.instrumentId)||0,next=prior+(fill.side==='buy'?fill.quantity:-fill.quantity);if(next < -1e-8)return blocked(asOf,'POSITION_LEDGER_QUANTITY');quantities.set(fill.instrumentId,Math.max(0,next));}
 for(const [instrumentId,quantity]of quantities)if(!close(quantity,holdings.get(instrumentId)?.quantity??0))return blocked(asOf,'POSITION_LEDGER_QUANTITY');
 const positions=[];
 for(const held of account.positions){
  let instrument;try{instrument=getInstrument(held.instrumentId);}catch{return blocked(asOf,'POSITION_INSTRUMENT_INVALID');}
  if(instrument.quoteCurrency!==quoteCurrency)return blocked(asOf,'POSITION_ACCOUNT_SCOPE');
  if(!close(quantities.get(held.instrumentId)??0,held.quantity))return blocked(asOf,'POSITION_LEDGER_QUANTITY');
  const marketValue=held.quantity*held.marketPrice,unrealizedPnl=marketValue-held.costBasis;
  positions.push({instrumentId:held.instrumentId,symbol:instrument.symbol,quoteCurrency,quantity:held.quantity,averageCost:held.averageCost,costBasis:held.costBasis,marketPrice:held.marketPrice,marketValue,weight:account.equity>0?marketValue/account.equity:0,unrealizedPnl,unrealizedReturn:unrealizedPnl/held.costBasis,priceAsOf:held.priceAsOf??account.asOf});
 }
 positions.sort((a,b)=>a.instrumentId.localeCompare(b.instrumentId));
 const marketValue=positions.reduce((total,p)=>total+p.marketValue,0),costBasis=positions.reduce((total,p)=>total+p.costBasis,0),value={...snapshot.value,portfolioViewVersion:POSITION_PORTFOLIO_VIEW_VERSION,positions,portfolio:{positionCount:positions.length,marketValue,costBasis,unrealizedPnl:marketValue-costBasis,unrealizedReturn:costBasis>0?(marketValue-costBasis)/costBasis:null,cashWeight:account.equity>0?account.cash/account.equity:0}};
 return {...snapshot,value,unit:'portfolio',sourceRefs:[{...snapshot.sourceRefs[0],id:'position-'+hashInputPackage(value).slice(0,32)}]};
}
function validPortfolioValue(value){
 if(value.portfolioViewVersion!==POSITION_PORTFOLIO_VIEW_VERSION||!Array.isArray(value.positions)||!value.portfolio||value.portfolio.positionCount!==value.positions.length)return false;
 const seen=new Set();let marketValue=0,costBasis=0;
 for(const p of value.positions){
  let instrument;try{instrument=getInstrument(p.instrumentId);}catch{return false;}
  if(seen.has(p.instrumentId)||instrument.quoteCurrency!==value.quoteCurrency||p.quoteCurrency!==value.quoteCurrency||!iso(p.priceAsOf)||p.priceAsOf>value.asOf||!finite(p.quantity)||p.quantity<=0||!finite(p.averageCost)||p.averageCost<=0||!finite(p.marketPrice)||p.marketPrice<=0||!finite(p.costBasis)||p.costBasis<=0||!close(p.costBasis,p.quantity*p.averageCost)||!close(p.marketValue,p.quantity*p.marketPrice)||!close(p.weight,value.equity>0?p.marketValue/value.equity:0)||!close(p.unrealizedPnl,p.marketValue-p.costBasis)||!close(p.unrealizedReturn,p.unrealizedPnl/p.costBasis))return false;
  seen.add(p.instrumentId);marketValue+=p.marketValue;costBasis+=p.costBasis;
 }
 return close(value.equity,value.cash+marketValue)&&close(value.portfolio.marketValue,marketValue)&&close(value.portfolio.costBasis,costBasis)&&close(value.portfolio.unrealizedPnl,marketValue-costBasis)&&(costBasis>0?close(value.portfolio.unrealizedReturn,(marketValue-costBasis)/costBasis):value.portfolio.unrealizedReturn===null)&&close(value.portfolio.cashWeight,value.equity>0?value.cash/value.equity:0);
}

function accountNetReturn(account,asOf){
 if(!finite(account.initialCash)||account.initialCash<=0||!finite(account.netPnl)||!finite(account.netReturn))return blocked(asOf,'POSITION_PERFORMANCE_REQUIRED');
 const funding=account.fundingLedger??[];
 if(!Array.isArray(funding)||funding.some(item=>!finite(item.amount)||!iso(item.at)||item.at>asOf))return blocked(asOf,'POSITION_FUNDING_TIME');
 const netFunding=funding.reduce((sum,item)=>sum+item.amount,0),invested=account.initialCash+funding.reduce((sum,item)=>sum+Math.max(0,item.amount),0);
 if(!close(account.netPnl,account.equity-account.initialCash-netFunding)||!close(account.netReturn,account.netPnl/invested))return blocked(asOf,'POSITION_PERFORMANCE_MISMATCH');
 return {ready:true,value:account.netReturn};
}

export function resolvePositionInput({binding,account,profileId,asOf,availableAt=asOf,valuation=null}={}){
 const metric=positionInputMetric(binding?.metricId);if(binding?.kind!=='POSITION'||!metric)return blocked(asOf,'POSITION_METRIC_REQUIRED');
 const snapshot=(metric.id==='PORTFOLIO'?buildPortfolioSnapshot:buildPositionSnapshot)({account,profileId,instrumentId:binding.instrumentId,asOf,availableAt});if(!snapshot.ready)return snapshot;
 if(binding.maxAgeMs!==undefined&&Date.parse(asOf)-Date.parse(snapshot.asOf)>binding.maxAgeMs)return blocked(asOf,'POSITION_ACCOUNT_STALE');
 if(metric.id==='INTENT_COOLDOWN_READY'){
  if(!id(binding.intentNodeId)||!Number.isSafeInteger(binding.cooldownMs)||binding.cooldownMs<0)return blocked(asOf,'POSITION_COOLDOWN_CONFIG');
  if(binding.profitStepReturn!==undefined){
   if(binding.cooldownScope!=='POSITION'||!Number.isFinite(binding.profitStepReturn)||binding.profitStepReturn<=0)return blocked(asOf,'POSITION_PROFIT_STEP_CONFIG');
   const fills=account.ledger.filter(f=>f.instrumentId===binding.instrumentId&&f.side==='sell'&&f.intent?.code==='TAKE_PROFIT'&&f.intent.nodeId===binding.intentNodeId&&snapshot.value.entryAt&&f.at>=snapshot.value.entryAt);
   const completed=new Set(fills.map(f=>f.exchangeOrderIdentifier??f.runId)).size,nextReturn=(completed+1)*binding.profitStepReturn;
   return {...snapshot,value:snapshot.value.hasPosition&&snapshot.value.unrealizedReturn+1e-12>=nextReturn,unit:'boolean',metricId:metric.id,dataType:metric.dataType,contractVersion:POSITION_INPUT_VERSION,nextReturn,completedSteps:completed};
  }
  const last=account.ledger.filter(f=>f.instrumentId===binding.instrumentId&&f.side==='sell'&&f.intent?.code==='TAKE_PROFIT'&&f.intent.nodeId===binding.intentNodeId&&(!['POSITION','POSITION_ONCE'].includes(binding.cooldownScope)||snapshot.value.entryAt&&f.at>=snapshot.value.entryAt)).at(-1);
  return {...snapshot,value:!last||binding.cooldownScope!=='POSITION_ONCE'&&Date.parse(asOf)-Date.parse(last.at)>=binding.cooldownMs,unit:'boolean',metricId:metric.id,dataType:metric.dataType,contractVersion:POSITION_INPUT_VERSION,lastFilledAt:last?.at??null};
 }
 if(metric.id==='SIGNAL_HOURS_HELD'){const entry=snapshot.value.entryAt;return entry?{...snapshot,value:(Math.floor(Date.parse(asOf)/3600000)-Math.floor(Date.parse(entry)/3600000)),unit:'hours',metricId:metric.id,dataType:metric.dataType,contractVersion:POSITION_INPUT_VERSION}:blocked(asOf,'POSITION_NOT_HELD');}
 if(metric.id==='NET_LIQUIDATION_RETURN'){const held=account.positions.find(p=>p.instrumentId===binding.instrumentId),value=held&&valuation?.book?.market===binding.instrumentId.slice('crypto:upbit:'.length)?remainingLiquidationReturn({quantity:held.quantity,costBasis:held.costBasis,...valuation,asOf}):null;return value===null?blocked(asOf,'POSITION_LIQUIDATION_DEPTH_REQUIRED'):{...snapshot,value,unit:'ratio',metricId:metric.id,dataType:metric.dataType,contractVersion:POSITION_INPUT_VERSION};}
 if(metric.id==='TRADE_HISTORY')return {...snapshot,value:{...snapshot.value,recentFills:account.ledger.filter(f=>f.instrumentId===binding.instrumentId).slice(-16).map(f=>Object.fromEntries(['at','side','quantity','fillPrice','fee','realizedPnl'].filter(k=>f[k]!==undefined).map(k=>[k,f[k]])))},metricId:metric.id,dataType:metric.dataType,contractVersion:POSITION_INPUT_VERSION};

 if(metric.id==='ACCOUNT_AGE_HOURS'&&(!iso(account.createdAt)||account.createdAt>asOf))return blocked(asOf,'POSITION_ACCOUNT_AGE_REQUIRED');
 const performance=metric.id==='PORTFOLIO_RETURN'?accountNetReturn(account,asOf):null;if(performance&&!performance.ready)return performance;
 const value=metric.id==='ACCOUNT_AGE_HOURS'?(Date.parse(asOf)-Date.parse(account.createdAt))/3600000:metric.id==='PORTFOLIO_RETURN'?performance.value:['SNAPSHOT','PORTFOLIO'].includes(metric.id)?snapshot.value:metric.id==='CASH_WEIGHT'?(snapshot.value.equity>0?snapshot.value.cash/snapshot.value.equity:0):metric.id==='HOURS_HELD'?(snapshot.value.entryAt?(Date.parse(asOf)-Date.parse(snapshot.value.entryAt))/3600000:null):snapshot.value[metric.key];
 if(value===null||value===undefined)return {...blocked(asOf,metric.id==='LAST_EXIT_PRICE'||metric.id==='HOURS_SINCE_EXIT'?'POSITION_EXIT_REQUIRED':'POSITION_NOT_HELD'),sourceRefs:snapshot.sourceRefs};
 const unit=metric.unit==='currency'?snapshot.value.quoteCurrency:metric.unit==='currency_per_unit'?snapshot.value.quoteCurrency+'/unit':metric.unit;
 return {...snapshot,value:structuredClone(value),unit,metricId:metric.id,dataType:metric.dataType,contractVersion:POSITION_INPUT_VERSION};
}
