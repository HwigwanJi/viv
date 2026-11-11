import {resolveQueryParameters,bindPreparedInput} from './strategy-parameters.mjs';
import {isHourlyScreenGraph,assertHourlyScreenGraph} from './hourly-pullback.mjs';
import {isHourlyRegimeGraph,assertHourlyRegimeGraph,hourlyRegimeInputs} from './hourly-regime.mjs';
import {isHourlyValueGraph,assertHourlyValueGraph} from './hourly-value-graph.mjs';
import {isAdaptivePortfolioGraph,assertAdaptivePortfolioGraph} from './adaptive-portfolio-graph.mjs';
import {compileStrategyGraph,evaluateStrategyGraph,strategyGraphHash} from './strategy-graph.mjs';
import {strategyEvaluationHash} from './mind-strategy-plan.mjs';
import {buildMicrostructureSnapshot,resolveMicrostructureInput} from './microstructure-input.mjs';
import {resolvePositionInput} from './position-input.mjs';
import {eventPaperPositionAccount,markEventPaperAccount} from './event-paper-execution.mjs';
import {hashInputPackage} from './workspace.mjs';

export const EVENT_STRATEGY_RUNTIME_VERSION='canonical-event-strategy-runtime-v1';
const clone=structuredClone,check=(ok,code,message)=>{if(!ok)throw Object.assign(new TypeError(message),{code,status:409});};
const iso=v=>typeof v==='string'&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString()===v;
export function assertEventStrategyGraph(graph,{instrumentId,timeframe}={}){
 const profit=graph.nodes.find(n=>n.type==='ORDER')?.config.takeProfitBps;if(profit)check(isAdaptivePortfolioGraph(graph)&&graph.nodes.some(n=>n.type==='MODEL'&&n.config.family==='SURGE_PATH_FOREST'),'EVENT_RESTING_PROFIT_SCOPE','지정가 분할 익절은 업비트 분봉 모델의 전체 배분 주문에 연결하세요.');
 if(isAdaptivePortfolioGraph(graph))return assertAdaptivePortfolioGraph(graph);
 if(isHourlyScreenGraph(graph))return assertHourlyScreenGraph(graph);
 if(isHourlyValueGraph(graph))return assertHourlyValueGraph(graph);
 if(isHourlyRegimeGraph(graph))return assertHourlyRegimeGraph(graph);
 compileStrategyGraph(graph);const inputs=graph.nodes.filter(n=>n.type==='INPUT').map(n=>resolveQueryParameters(graph,n,{executionInstrumentId:instrumentId}).node),micro=inputs.filter(n=>n.config.kind==='MICROSTRUCTURE');
 if(graph.executionScope?.kind==='EACH_ASSET'){check(micro.length>0&&graph.executionScope.timeframe===timeframe&&inputs.every(n=>['ASSET_SET','EXECUTION_ASSET'].includes(n.config.kind)||['MICROSTRUCTURE','POSITION'].includes(n.config.kind)&&['execution:current',instrumentId].includes(n.config.instrumentId))&&micro.every(n=>n.config.timeframe===timeframe)&&graph.triggers.includes('market_event')&&!graph.nodes.some(n=>n.type==='VIBE'),'EVENT_GRAPH_SCOPE','다종목 실행 범위와 현재 종목 입력을 확인하세요.');return graph;}
 const ohlcv=inputs.filter(n=>n.config.kind==='OHLCV');
 check((micro.length>0||ohlcv.length>0)&&inputs.every(n=>['MICROSTRUCTURE','POSITION','OHLCV'].includes(n.config.kind)&&n.config.instrumentId===instrumentId)&&ohlcv.every(n=>n.config.timeframe==='1m'&&timeframe==='1m')&&micro.every(n=>n.config.timeframe===timeframe)&&['1m','3m','5m'].includes(timeframe)&&graph.triggers.includes('market_event')&&!graph.nodes.some(n=>n.type==='VIBE'),'EVENT_GRAPH_SCOPE','한 종목의 체결·호가와 자기 포지션으로 구성한 분봉 그래프를 선택하세요. typed JEV 질문은 canonical 한도 8개를 사용합니다.');return graph;
}
/** Latest actually received snapshot at the decision clock; no bar-price substitute. */
export function eventBookAt(dataset,asOf){return dataset.events.filter(e=>e.kind==='ORDER_BOOK'&&e.market===dataset.market&&e.receivedAt<=asOf&&e.eventTime<=asOf&&(!e.availableAt||e.availableAt<=asOf)).reduce((latest,e)=>!latest||e.eventTime>latest.eventTime||e.eventTime===latest.eventTime&&e.receivedAt>latest.receivedAt?e:latest,null);}
export function eventRuntimeCachedAnswers(cached,graph,asOf){
 const result={},graphHash=strategyGraphHash(graph);for(const [id,a]of Object.entries(cached??{})){const n=graph.nodes.find(n=>n.id===id&&n.type==='JEV_QUESTION'),r=a?.reuse;if(n&&r&&r.graphHash===graphHash&&r.validUntil>asOf&&r.availableAt<=asOf&&a.questionHash===hashInputPackage(n.config.question))result[id]=clone(a);}return result;
}
export function prepareEventStrategyFrame({graph,account,dataset,asOf,decisions={},frameAnswers={},candidateInput=null,portfolio=null}={}){
 check(iso(asOf)&&asOf>=account.updatedAt,'EVENT_RUNTIME_TIME','자기 원장 이후의 재생 시각을 확인하세요.');assertEventStrategyGraph(graph,dataset);
 const book=eventBookAt(dataset,asOf);let marked=clone(account),positionAccount=null,positionError=null;
 try{if(book)marked=markEventPaperAccount(account,{book,asOf});positionAccount=eventPaperPositionAccount(marked,{asOf});}catch(error){positionError=error.code??'EVENT_POSITION_UNAVAILABLE';try{positionAccount=eventPaperPositionAccount(account,{asOf});}catch{}}
 const prepared=prepareEventStrategyInputs({graph,dataset,positionAccount,profileId:account.profileId,accountId:account.id,asOf,decisions,frameAnswers,executionMode:'PAPER',candidateInput,portfolio});
 return {...prepared,account:marked,book,positionError,valuationComplete:!!positionAccount&&(positionAccount.positions.length===0||!!book&&Date.parse(asOf)-Date.parse(book.eventTime)<=3000&&Date.parse(asOf)-Date.parse(book.receivedAt)<=3000)};
}
/** Shared input authority for paper replay and a separately activated live engine. */
export function prepareEventStrategyInputs({graph,dataset,positionAccount,profileId,accountId=positionAccount?.id,asOf,decisions={},frameAnswers={},executionMode='PAPER',candidateInput=null,portfolio=null}={}){
 check(iso(asOf)&&['PAPER','LIVE'].includes(executionMode)&&typeof profileId==='string'&&typeof accountId==='string','EVENT_RUNTIME_SCOPE','실행 시각·계좌·마인드 범위를 확인하세요.');assertEventStrategyGraph(graph,dataset);
 const hourly=isHourlyRegimeGraph(graph),inputs=hourly?hourlyRegimeInputs(graph,{...dataset.hourlyRegime,positionAccount,profileId,market:dataset.market,book:eventBookAt(dataset,asOf),asOf}):{},snapshots=new Map();
 for(const original of graph.nodes.filter(n=>n.type==='INPUT'&&!hourly)){const resolution=resolveQueryParameters(graph,original,{executionInstrumentId:dataset.instrumentId});if(!resolution.ready){inputs[original.id]={ready:false,asOf,availableAt:null,value:null,sourceRefs:[],missing:resolution.missing};continue;}const node=resolution.node,binding=node.config.instrumentId==='execution:current'?{...node.config,instrumentId:dataset.instrumentId}:node.config;
  if(resolution.bindings.length&&(['OHLCV','MICROSTRUCTURE','POSITION'].includes(binding.kind)&&binding.instrumentId!==dataset.instrumentId||binding.timeframe&&binding.timeframe!==dataset.timeframe)){inputs[node.id]={ready:false,asOf,availableAt:null,value:null,sourceRefs:[],missing:['GRAPH_PARAMETER_DATA_IDENTITY']};continue;}
  if(binding.kind==='ASSET_SET'){inputs[node.id]=candidateInput??{ready:false,missing:['CANDIDATE_INPUT_REQUIRED']};continue;}
  if(binding.kind==='EXECUTION_ASSET'){inputs[node.id]={ready:true,value:dataset.instrumentId,unit:'instrumentId',asOf,availableAt:asOf,sourceRefs:[{id:'execution:'+dataset.instrumentId,contentHash:hashInputPackage({profileId,accountId,instrumentId:dataset.instrumentId,asOf}),sourceRef:'CANONICAL_EVENT_EXECUTION_SCOPE'}],missing:[]};continue;}
  if(binding.kind==='POSITION')inputs[node.id]=positionAccount?resolvePositionInput({binding,account:positionAccount,profileId,asOf,availableAt:asOf}):{ready:false,asOf,availableAt:null,value:null,unit:null,sourceRefs:[],missing:['POSITION_ACCOUNT_REQUIRED']};
  else if(binding.kind==='OHLCV'){
   const bars=dataset.bars.filter(b=>b.closeTime<=asOf&&(!b.availableAt||b.availableAt<=asOf)).slice(-(binding.lookbackBars??30));
   inputs[node.id]=bars.length&&(!resolution.bindings.length||bars.length>=(binding.lookbackBars??30))&&bars.at(-1).closeTime===asOf?{ready:true,value:{bars:bars.map(b=>[Date.parse(b.openTime),b.open,b.high,b.low,b.close,b.volume]),dailyBars:[]},unit:'OHLCV',instrumentId:dataset.instrumentId,timeframe:'1m',asOf,availableAt:asOf,sourceRefs:clone(dataset.sourceRefs),missing:[]}:{ready:false,asOf,availableAt:null,value:null,unit:'OHLCV',sourceRefs:[],missing:['LATEST_AVAILABLE_CLOSED_BAR_REQUIRED']};
  }
  else{const includePath=binding.metricId==='DECISION_CONTEXT',key=hashInputPackage({includePath,lookbackBars:binding.lookbackBars??20,flowWindowMs:binding.flowWindowMs??60000,bookMaxAgeMs:binding.bookMaxAgeMs??3000});if(!snapshots.has(key))snapshots.set(key,buildMicrostructureSnapshot({instrumentId:dataset.instrumentId,market:dataset.market,timeframe:dataset.timeframe,asOf,availableAt:asOf,bars:dataset.bars,events:dataset.events,sourceRefs:dataset.sourceRefs,fees:dataset.feeSnapshot,flowCoverage:dataset.flowCoverage,includePath,lookbackBars:binding.lookbackBars??20,flowWindowMs:binding.flowWindowMs??60000,bookMaxAgeMs:binding.bookMaxAgeMs??3000}));inputs[node.id]=resolveMicrostructureInput({binding,snapshot:snapshots.get(key),asOf,availableAt:asOf});}
 }
 for(const node of graph.nodes.filter(n=>n.type==='INPUT'))if(inputs[node.id]){const resolution=resolveQueryParameters(graph,node,{executionInstrumentId:dataset.instrumentId});if(resolution.ready)inputs[node.id]=bindPreparedInput(inputs[node.id],resolution);}
 const executionContext={profileId,accountId,executionInstrumentId:dataset.instrumentId,currentWeight:positionAccount?.equity>0?positionAccount.positions.reduce((sum,p)=>sum+p.quantity*p.marketPrice,0)/positionAccount.equity:null,inputAvailableAt:asOf,executionMode,...(graph.executionScope?{executionInstrumentId:dataset.instrumentId,portfolio}: {})},decisionInputs={...eventRuntimeCachedAnswers(decisions,graph,asOf),...frameAnswers};
 const evaluation={contractVersion:EVENT_STRATEGY_RUNTIME_VERSION,asOf,source:{datasetSha256:dataset.sourceHash},modules:[],executionInputs:inputs,executionContext,decisionInputs,trigger:'market_event'};
 evaluation.graphEvaluation=evaluateStrategyGraph(graph,[],{asOf,sourceHash:dataset.sourceHash,inputs,decisions:decisionInputs,context:executionContext,trigger:'market_event'});evaluation.outputHash=strategyEvaluationHash(evaluation);
 return {contractVersion:EVENT_STRATEGY_RUNTIME_VERSION,asOf,positionAccount,executionInputs:inputs,request:{state:{strategyEvaluation:evaluation}},inputHash:hashInputPackage({inputs,executionContext}),sourceHash:dataset.sourceHash};
}
/** Pure recomputation used for saved provider answers and local fixtures, never a call. */
export function evaluateEventStrategyFrame(prepared,{graph,decisions=prepared.request.state.strategyEvaluation.decisionInputs}={}){
 const e=clone(prepared.request.state.strategyEvaluation);e.decisionInputs=clone(decisions);e.graphEvaluation=evaluateStrategyGraph(graph,e.modules,{asOf:e.asOf,sourceHash:e.source.datasetSha256,inputs:e.executionInputs,decisions:e.decisionInputs,context:e.executionContext,trigger:e.trigger});e.outputHash=strategyEvaluationHash(e);return e;
}
