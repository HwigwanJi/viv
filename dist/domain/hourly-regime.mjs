import {buildPositionSnapshot,resolvePositionInput} from './position-input.mjs';
import {createDecisionStrategyNode,compileStrategyGraph} from './strategy-graph.mjs';
import {hashInputPackage} from './workspace.mjs';
import {resolveCrossVenueContext} from './cross-venue-input.mjs';

export const HOURLY_REGIME_VERSION='upbit-clock-regime-v1';
export const REGIME_BINDINGS=Object.freeze({CONTEXT:'regime:upbit:context',METRIC:'regime:upbit:signal'});
const H=3600000,check=(ok,message)=>{if(!ok)throw Object.assign(new Error(message),{code:'HOURLY_REGIME_INPUT',status:409});};
export const isHourlyRegimeGraph=graph=>graph?.nodes?.some(n=>n.type==='INPUT'&&Object.values(REGIME_BINDINGS).includes(n.config.instrumentId));
export function assertHourlyRegimeGraph(graph){
 compileStrategyGraph(graph);const inputs=graph.nodes.filter(n=>n.type==='INPUT');
 check(inputs.length>0&&inputs.every(n=>n.config.required===true&&(n.config.kind==='POSITION'?(n.config.instrumentId==='execution:current'||n.config.instrumentId.startsWith('crypto:upbit:KRW-')):REGIME_BINDINGS[n.config.kind]===n.config.instrumentId&&(n.config.kind!=='METRIC'||['REGIME_ENTRY','REGIME_EXIT'].includes(n.config.metricId))))&&graph.triggers.includes('market_event')&&!graph.executionScope,'시간봉 국면 입력과 자기 포지션 실행 범위를 확인하세요.');return graph;
}
/** Clock endpoints and observed bars match the retained research; missing candles stay missing. */
export function hourlyRegimeFeatures(market,bars,boundary,availableAt){
 const t=Date.parse(boundary),known=bars.filter(b=>b.t<=t&&(!b.availableAt||b.availableAt<=availableAt)).sort((a,b)=>a.t-b.t),at=x=>known.filter(b=>b.t<=x).at(-1),last=at(t),one=at(t-H),six=at(t-6*H),day=at(t-24*H),window=known.filter(b=>b.t>=t-24*H),prior=window.filter(b=>b.t<t),three=prior.filter(b=>b.t>=t-3*H),sixBars=prior.filter(b=>b.t>=t-6*H);
 if(!last||last.t!==t||!one||!six||!day||window.length<12||!three.length||!sixBars.length)return null;
 const mean=prior.reduce((s,b)=>s+b.quoteVolume,0)/prior.length;if(!(mean>0))return null;
 return {market,at:boundary,price:last.close,r1:last.close/one.close-1,r6:last.close/six.close-1,r24:last.close/day.close-1,high3:Math.max(...three.map(b=>b.high)),low3:Math.min(...three.map(b=>b.low)),high24:Math.max(...prior.map(b=>b.high)),low6:Math.min(...sixBars.map(b=>b.low)),rvol:last.quoteVolume/mean,turnover:window.filter(b=>b.t>t-24*H).reduce((s,b)=>s+b.quoteVolume,0),endpointTimes:{oneHour:new Date(one.t).toISOString(),sixHours:new Date(six.t).toISOString(),day:new Date(day.t).toISOString()},observedHours:window.filter(b=>b.t>t-24*H).length};
}
export function hourlyRegimeDecision(frame,held=null){
 if(held){const own=frame.features.find(f=>f.market===held.market);if(!own)return {action:'hold',reason:'MISSING_OWN_HISTORY'};
  check(['trend','recovery'].includes(held.leg),'보유 포지션의 진입 국면을 확인하세요.');
  const exit=held.leg==='trend'?own.r6<=0:own.price<own.low3||own.r24>=0&&own.r1<0;return {action:exit?'sell':'hold',reason:'OWN_STRUCTURE',own};}
 const trend=frame.breadth>=.5,eligible=frame.liquid.filter(f=>trend?f.r6>0&&f.r24>0:f.r24<-.03&&f.r1>0&&f.price>f.high3&&f.rvol>1).sort((a,b)=>(trend?b.r6-a.r6:b.r1-a.r1)||a.market.localeCompare(b.market));
 return eligible.length?{action:'buy',market:eligible[0].market,leg:trend?'trend':'recovery',reason:'CAUSAL_LIQUID_RANK',selected:eligible[0]}:{action:'hold',reason:'NO_QUALIFIED_CANDIDATE'};
}
export function buildHourlyRegimeFrame({series,boundary,availableAt,sourceRefs,entryEligibility=null}){
 check(new Date(Math.floor(Date.parse(boundary)/H)*H).toISOString()===boundary&&availableAt>=boundary&&sourceRefs?.length,'확정 시간봉 경계와 수신 원문을 확인하세요.');
 const features=series.map(s=>hourlyRegimeFeatures(s.market,s.bars,boundary,availableAt)).filter(Boolean),liquid=[...features].sort((a,b)=>b.turnover-a.turnover||a.market.localeCompare(b.market)).slice(0,50);
 return {contractVersion:HOURLY_REGIME_VERSION,asOf:boundary,availableAt,features,liquid:entryEligibility?liquid.filter(f=>entryEligibility.markets[f.market]?.allowed===true):liquid,breadth:liquid.length?liquid.filter(f=>f.r6>0).length/liquid.length:null,series,sourceRefs,entryEligibility};
}
export function hourlyRegimeInputs(graph,{frame,decision,positionAccount,profileId=positionAccount?.profileId,market,book=null,recentOrders=[],crossVenue=null,asOf}){
 assertHourlyRegimeGraph(graph);
 const inputs=Object.fromEntries(graph.nodes.filter(n=>n.type==='INPUT').map(n=>[n.id,n.config.kind==='POSITION'?resolvePositionInput({binding:{...n.config,instrumentId:n.config.instrumentId==='execution:current'?'crypto:upbit:'+market:n.config.instrumentId},account:positionAccount,profileId,asOf,availableAt:asOf}):{ready:false,value:null,asOf,availableAt:null,sourceRefs:[],missing:['HOURLY_REGIME_FRAME_REQUIRED']} ]));
 if(!frame)return inputs;
 check(frame.contractVersion===HOURLY_REGIME_VERSION&&frame.availableAt<=asOf&&frame.asOf<=asOf,'수신된 시간봉 입력을 확인하세요.');
 const position=positionAccount?.positions.find(p=>p.quantity>0),own=frame.features.find(f=>f.market===market),price=own?.price,weight=positionAccount?.equity>0?positionAccount.positions.reduce((s,p)=>s+p.marketValue,0)/positionAccount.equity:0;
 let currentBook=null;
 if(book){const best=book.levels?.[0],bid=Number(best?.bidPrice),ask=Number(best?.askPrice);check(book.kind==='ORDER_BOOK'&&book.market===market&&[book.eventTime,book.receivedAt,book.availableAt??book.receivedAt].every(t=>Number.isFinite(Date.parse(t))&&t<=asOf)&&bid>0&&ask>=bid&&Number.isFinite(ask),'확인된 현재 호가와 수신 시각을 대조하세요.');
  currentBook={eventTime:book.eventTime,receivedAt:book.receivedAt,availableAt:book.availableAt??book.receivedAt,ageMs:Date.parse(asOf)-Date.parse(book.eventTime),bidPrice:best.bidPrice,askPrice:best.askPrice,bidQuantity:best.bidQuantity,askQuantity:best.askQuantity,spreadBps:(ask-bid)/((ask+bid)/2)*10000,returnFromClosedPrice:price?ask/price-1:null,askReturnsFromClockReferences:own?{oneHour:ask/(price/(1+own.r1))-1,sixHours:ask/(price/(1+own.r6))-1,day:ask/(price/(1+own.r24))-1,referenceTimes:own.endpointTimes}:null,sourceRef:{id:book.id,contentHash:book.sourceHash,sourceRef:book.sourceUrl??null}};
 }
 const snapshot=buildPositionSnapshot({account:positionAccount,profileId:positionAccount?.profileId,instrumentId:'crypto:upbit:'+market,asOf,availableAt:asOf}),entryAt=snapshot.value?.entryAt??null;
 const value={entryEligibility:frame.entryEligibility?{contractVersion:frame.entryEligibility.contractVersion,asOf:frame.entryEligibility.asOf,availableAt:frame.entryEligibility.availableAt,selected:frame.entryEligibility.markets[market],sourceRef:frame.entryEligibility.sourceRef??null,sourceError:frame.entryEligibility.sourceError??null}:null,observationHorizon:'1h',asOf:frame.asOf,market,marketBreadth6h:frame.breadth,liquidCandidates:frame.liquid.slice(0,5),quantReference:decision,path:(frame.series.find(s=>s.market===market)?.bars??[]).filter(b=>b.t<=Date.parse(frame.asOf)&&(!b.availableAt||b.availableAt<=asOf)).slice(-25).map(b=>({...b,closedAt:new Date(b.t).toISOString()})),features:own??null,account:{cash:positionAccount?.exact?.cash??'0',currentWeight:weight,position:position?{market,quantity:String(position.quantity),cost:String(position.costBasis),entryAt,holdingHours:entryAt?(Date.parse(frame.asOf)-Date.parse(entryAt))/H:null,returnSinceEntry:Number(currentBook?.bidPrice??price)/position.averageCost-1,returnSinceEntryBasis:currentBook?'CURRENT_BID':'CLOSED_BAR_PRICE'}:null},recentOrders:(positionAccount?.ledger??recentOrders).filter(o=>o.at<=asOf).slice(-8),historicalBooks:null,signedTradeFlow:null};
 // The retained dataset holds every receipt; one digest binds them without repeating hundreds of hashes in the AI prompt.
 value.currentBook=currentBook;value.decisionAsOf=asOf;
 if(crossVenue)value.crossVenue=resolveCrossVenueContext({snapshot:crossVenue,market,asOf});
 const contentHash=hashInputPackage({value,sourceRefs:frame.sourceRefs}),ref={id:'hourly-regime-'+contentHash,contentHash,sourceRef:'CANONICAL_HOURLY_REGIME'};
 const inputAvailableAt=[frame.availableAt,...(currentBook?[currentBook.availableAt]:[]),...(crossVenue?[crossVenue.availableAt]:[])].sort().at(-1);
 return {...inputs,...Object.fromEntries(graph.nodes.filter(n=>n.type==='INPUT'&&n.config.kind!=='POSITION').map(n=>[n.id,{ready:true,value:n.config.kind==='CONTEXT'?value:n.config.metricId==='REGIME_ENTRY'?Number(decision.action==='buy'):Number(decision.action==='sell'),asOf:currentBook||crossVenue?asOf:frame.asOf,availableAt:inputAvailableAt,sourceRefs:[ref],missing:[]}]))};
}
export function createHourlyRegimeGraph({aiGraph=null}={}){
 if(aiGraph){const graph=structuredClone(aiGraph);for(const n of graph.nodes){if(n.type==='INPUT')n.config={kind:'CONTEXT',instrumentId:REGIME_BINDINGS.CONTEXT,required:true};if(n.type==='ORDER')n.config.execution='ACCOUNT';}graph.triggers=['manual','closed_bar','market_event'];assertHourlyRegimeGraph(graph);return graph;}
 const graph={schemaVersion:2,contractVersion:'mind-strategy-decision-graph-v2',nodes:[],edges:[],outputNodeId:'order',triggers:['manual','closed_bar','market_event']};
 const add=(type,id,config)=>graph.nodes.push({...createDecisionStrategyNode(type,{id,config,position:{x:graph.nodes.length*180,y:100}}),label:({'entry-ready':'진입 조건 충족','exit-ready':'청산 조건 충족',entry:'국면별 진입',exit:'보유 구조 이탈',buy:'전액 진입',sell:'구조 이탈 청산',wait:'보유와 대기',risk:'배정액 한도',order:'계좌 주문',route:'진입 판단',priority:'청산 판단'})[id]});
 add('INPUT','entry',{kind:'METRIC',instrumentId:REGIME_BINDINGS.METRIC,metricId:'REGIME_ENTRY',required:true});add('INPUT','exit',{kind:'METRIC',instrumentId:REGIME_BINDINGS.METRIC,metricId:'REGIME_EXIT',required:true});add('CONDITION','entry-ready',{operator:'gt',value:0});add('CONDITION','exit-ready',{operator:'gt',value:0});
 for(const [id,action] of [['buy','buy'],['sell','sell'],['wait','hold']])add('QUANT',id,{mode:'CONDITION',onTrue:action,onFalse:action,buyTargetWeight:1,sellTargetWeight:0,...(id==='sell'?{sellIntent:'EXIT'}:{})});
 add('DECISION_ROUTER','route',{mode:'CONDITION'});add('DECISION_ROUTER','priority',{mode:'CONDITION'});add('RISK','risk',{maxExposure:1,maxOrderWeight:1,minConfidence:0});add('ORDER','order',{execution:'ACCOUNT',sizing:'TARGET_WEIGHT'});
 const edge=(a,b,from,to)=>graph.edges.push({id:a+'-'+b+'-'+to,from:{nodeId:a,port:from},to:{nodeId:b,port:to}});
 edge('entry','entry-ready','data','value');edge('exit','exit-ready','data','value');for(const id of ['buy','sell','wait'])edge('entry-ready',id,'condition','signal');
 for(const args of [['entry-ready','route','condition','condition'],['buy','route','decision','true'],['wait','route','decision','false'],['exit-ready','priority','condition','condition'],['sell','priority','decision','true'],['route','priority','decision','false'],['priority','risk','decision','decision'],['risk','order','approved','approved']])edge(...args);
 assertHourlyRegimeGraph(graph);return graph;
}
