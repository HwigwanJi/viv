import {resolveQueryParameters,bindPreparedInput} from './strategy-parameters.mjs';
import {createDecisionStrategyNode,compileStrategyGraph,evaluateStrategyGraph} from './strategy-graph.mjs';
import {portfolioGraphDefaults,PORTFOLIO_CANDIDATE_VERSION} from './portfolio-graph.mjs';
import {withPositionProfitLadder} from './position-profit-ladder.mjs';
import {resolvePositionInput} from './position-input.mjs';
import {expandAssetFilter} from './asset-filter-composition.mjs';
import {arrangeFlatStrategyGraph} from './strategy-graph-layout.mjs';
import {hashInputPackage as hash} from './workspace.mjs';

export const isHourlyScreenGraph=graph=>graph?.executionScope?.kind==='EACH_ASSET'&&graph.executionScope.timeframe==='1h';
export function assertHourlyScreenGraph(graph){
 compileStrategyGraph(graph);
 if(!isHourlyScreenGraph(graph)||graph.nodes.filter(n=>n.type==='INPUT').some(n=>!['ASSET_SET','EXECUTION_ASSET'].includes(n.config.kind)&&!(n.config.kind==='POSITION'&&n.config.instrumentId==='execution:current'))||!graph.triggers.includes('closed_bar'))throw Object.assign(Error('시간봉 후보·선택·자기 보유 노드를 연결하세요.'),{code:'HOURLY_SCREEN_GRAPH'});
 return graph;
}
/** Ordinary editable filters and routers; thresholds never live in the runner. */
export function createP50PullbackGraph({execution='ACCOUNT'}={}){
 const graph={schemaVersion:2,contractVersion:'mind-strategy-decision-graph-v2',executionScope:{kind:'EACH_ASSET',timeframe:'1h',maxCandidates:6,maxConcurrentPositions:1},triggers:['manual','closed_bar','market_event'],nodes:[],edges:[],outputNodeId:'order'};
 const add=(type,id,label,config)=>graph.nodes.push({...createDecisionStrategyNode(type,{id,config,position:{x:(graph.nodes.length%6)*240,y:Math.floor(graph.nodes.length/6)*200}}),label});
 const edge=(a,b,from,to)=>graph.edges.push({id:a+'-'+b+'-'+to,from:{nodeId:a,port:from},to:{nodeId:b,port:to}});
 add('INPUT','candidates','확정 1시간봉과 관측한 5분 체결·호가',{kind:'ASSET_SET',scope:'MIND_UNIVERSE',timeframe:'1h',required:true});
 add('FILTER','attention','최근 1시간 +5% 또는 6시간 +10%',{...portfolioGraphDefaults('FILTER'),minHistoryBars:7,conditionMode:'ANY',conditions:[{metric:'MOMENTUM',lookback:1,operator:'gte',value:.05},{metric:'MOMENTUM',lookback:6,operator:'gte',value:.1}]});
 add('FILTER','pullback','5분 매도대금 우세 · 호가 중간값 하락',{...portfolioGraphDefaults('FILTER'),minHistoryBars:7,conditions:[{metric:'BUY_QUOTE_RATIO_5M',lookback:5,operator:'lt',value:.5},{metric:'MID_RETURN_5M',lookback:5,operator:'lt',value:0}]});
 add('RANK','rank','최근 6시간 상승률 순위',{...portfolioGraphDefaults('RANK'),terms:[{metric:'MOMENTUM',lookback:6,weight:1}],volatilityBars:6,minScore:null});
 add('SELECT','select','최상위 한 종목',{maxPositions:1});add('INPUT','asset','이번 평가 종목',{kind:'EXECUTION_ASSET',required:true});add('MEMBER','selected','선택된 종목인가',{});
 for(const [a,b,from,to]of [['candidates','attention','data','assets'],['attention','pullback','assets','assets'],['pullback','rank','assets','assets'],['rank','select','rank','rank'],['select','selected','selected','assets'],['asset','selected','data','instrument']])edge(a,b,from,to);
 add('INPUT','held','자기 보유 여부',{kind:'POSITION',instrumentId:'execution:current',metricId:'HAS_POSITION',required:true});
 add('INPUT','hours','진입 신호 정시 이후 시간',{kind:'POSITION',instrumentId:'execution:current',metricId:'SIGNAL_HOURS_HELD',required:true});
 add('CONDITION','due','신호 6시간 뒤 전량 청산',{operator:'gte',value:6});edge('hours','due','data','value');
 add('VALUE','always','분기가 선택한 결정 실행',{dataType:'BOOLEAN',value:true});
 for(const [id,action,label]of [['buy','buy','현금의 50% 진입'],['sell','sell','6시간 경과 전량 청산'],['hold','hold','보유 또는 현금 대기']]){add('QUANT',id,label,{mode:'CONDITION',onTrue:action,onFalse:action,buyTargetWeight:.5,sellTargetWeight:0,...(id==='sell'?{sellIntent:'EXIT'}:{})});edge('always',id,'value','signal');}
 const route=(id,label,condition,port,yes,no)=>{add('DECISION_ROUTER',id,label,{mode:'CONDITION'});edge(condition,id,port,'condition');edge(yes,id,'decision','true');edge(no,id,'decision','false');};
 route('entry','미보유 후보 진입','selected','condition','buy','hold');route('exit','시간 청산 또는 보유','due','condition','sell','hold');route('owned','보유 관리 또는 후보 선택','held','data','exit','entry');
 add('RISK','risk','무차입 · 배정액 내 주문',{maxExposure:1,maxOrderWeight:1,minConfidence:0});add('ORDER','order','3분 준비 후 지정가 FOK',{execution,sizing:'TARGET_WEIGHT',orderType:'LIMIT_FOK',maxSlippageBps:20,participationRate:1,entryDelayMs:181000,captureWindowMs:120000});edge('owned','risk','decision','decision');edge('risk','order','approved','approved');
 const complete=withPositionProfitLadder(graph,{returnMetric:'NET_LIQUIDATION_RETURN',cooldownScope:'POSITION'}),prior=complete.edges.find(e=>e.to.nodeId==='risk');
 const extra=(id,label)=>complete.nodes.push({...createDecisionStrategyNode('DECISION_ROUTER',{id,config:{mode:'CONDITION'},position:{x:1500,y:800}}),label}),link=(a,b,from,to)=>complete.edges.push({id:a+'-'+b+'-'+to,from:{nodeId:a,port:from},to:{nodeId:b,port:to}});
 extra('scheduled-due','기한 청산 우선 · 그 외 분할 익절');extra('scheduled-held','보유 기한 관리 · 미보유 진입');
 for(const args of [['due','scheduled-due','condition','condition'],['sell','scheduled-due','decision','true'],[prior.from.nodeId,'scheduled-due',prior.from.port,'false'],['held','scheduled-held','data','condition'],['scheduled-due','scheduled-held','decision','true'],['entry','scheduled-held','decision','false']])link(...args);
 prior.from={nodeId:'scheduled-held',port:'decision'};const atomic=expandAssetFilter(expandAssetFilter(complete,'attention').graph,'pullback').graph;assertHourlyScreenGraph(atomic);return arrangeFlatStrategyGraph(atomic,compileStrategyGraph(atomic),{originX:40,originY:40,rowStep:200,columnStep:300});
}

export function hourlyScreenCandidateInput({profileId,marketIds,boundary,asOf,items,sourceRefs}){
 const value={contractVersion:PORTFOLIO_CANDIDATE_VERSION,profileId,quoteCurrency:'KRW',timeframe:'1h',asOf:boundary,evaluatedAt:asOf,universeHash:hash([...marketIds].map(m=>'crypto:upbit:'+m).sort()),items};
 return {ready:true,value,unit:'ASSET_SET',asOf:boundary,availableAt:asOf,sourceRefs,missing:[]};
}
export function evaluateHourlyScreen({graph,account,market,candidateInput,asOf,executionMode,valuation}){
 assertHourlyScreenGraph(graph);const instrumentId='crypto:upbit:'+market,inputs={};
 if(candidateInput){candidateInput=structuredClone(candidateInput);candidateInput.value.evaluatedAt=asOf;}
 for(const original of graph.nodes.filter(n=>n.type==='INPUT')){const resolution=resolveQueryParameters(graph,original,{executionInstrumentId:instrumentId});if(!resolution.ready){inputs[original.id]={ready:false,value:null,asOf,availableAt:null,sourceRefs:[],missing:resolution.missing};continue;}const n=resolution.node;inputs[n.id]=n.config.kind==='ASSET_SET'?candidateInput??{ready:false,value:null,asOf,availableAt:null,sourceRefs:[],missing:['HOURLY_CANDIDATE_REQUIRED']}:n.config.kind==='EXECUTION_ASSET'?{ready:true,value:instrumentId,unit:'instrumentId',asOf,availableAt:asOf,sourceRefs:[{id:'asset-'+market,contentHash:hash(market),sourceRef:'CANONICAL_HOURLY_SCREEN_ASSET'}],missing:[]}:resolvePositionInput({binding:{...n.config,instrumentId},account,profileId:account.profileId,asOf,valuation});inputs[n.id]=bindPreparedInput(inputs[n.id],resolution);}
 const universeHash=candidateInput?.value?.universeHash,portfolio={profileId:account.profileId,quoteCurrency:account.quoteCurrency,asOf,equity:account.equity,cashWeight:account.cash/account.equity,weights:account.positions.map(p=>({instrumentId:p.instrumentId,weight:p.quantity*p.marketPrice/account.equity})),lastRebalancedAt:null,universeHash};
 return evaluateStrategyGraph(graph,[],{asOf,sourceHash:hash({inputs,account}),inputs,trigger:'closed_bar',context:{profileId:account.profileId,accountId:account.id,executionInstrumentId:instrumentId,currentWeight:account.positions.reduce((s,p)=>s+p.quantity*p.marketPrice,0)/account.equity,executionMode,portfolio}});
}
