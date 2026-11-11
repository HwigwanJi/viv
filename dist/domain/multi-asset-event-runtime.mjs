import {createEventScalpingPreset} from './event-strategy-presets.mjs';
import {createDecisionStrategyNode,compileStrategyGraph,strategyGraphHash} from './strategy-graph.mjs';
import {PORTFOLIO_CANDIDATE_VERSION,portfolioGraphDefaults} from './portfolio-graph.mjs';
import {hashInputPackage} from './workspace.mjs';
import {eventBookAt} from './event-strategy-runtime.mjs';

export const MULTI_ASSET_EVENT_VERSION='canonical-multi-asset-event-v1';
const clone=structuredClone,check=(ok,code,message)=>{if(!ok)throw Object.assign(new Error(message),{code,status:409});};
const at=t=>new Date(t).toISOString();

/** Editable flat graph; selection gates entry while existing owned-position protection stays first. */
export function createMultiAssetEventScalpingGraph({mode='QUANT',timeframe='1m',maxCandidates=20,params={},filter={},rank={}}={}){
 const graph=createEventScalpingPreset({mode,timeframe,instrumentId:'crypto:upbit:KRW-XRP',execution:'ACCOUNT',params}).graph;
 graph.executionScope={kind:'EACH_ASSET',timeframe,maxCandidates,maxConcurrentPositions:1};
 for(const n of graph.nodes)if(n.type==='INPUT')n.config.instrumentId='execution:current';
 const add=(type,id,label,config,x,y)=>graph.nodes.push({...createDecisionStrategyNode(type,{id,config,position:{x,y}}),label});
 add('INPUT','universe-assets','투자 범위의 확정 분봉',{kind:'ASSET_SET',scope:'MIND_UNIVERSE',timeframe,required:true},-1200,0);
 add('FILTER','universe-filter','후보 조건',{...portfolioGraphDefaults('FILTER'),minHistoryBars:21,excludeWarnings:false,...filter},-960,0);
 add('RANK','universe-rank','후보 순위',{...portfolioGraphDefaults('RANK'),terms:[{metric:'MOMENTUM',lookback:20,weight:1}],...rank},-720,0);
 add('SELECT','universe-select','상위 후보 선택',{maxPositions:1},-480,0);
 add('INPUT','execution-asset','현재 평가 종목',{kind:'EXECUTION_ASSET',required:true},-480,200);
 add('MEMBER','universe-member','선택 후보에 포함',{},-240,0);
 add('DECISION_ROUTER','selected-entry','선택 후보의 진입 평가',{mode:'CONDITION'},0,-160);
 const edge=(from,to,fromPort,toPort)=>graph.edges.push({id:from+'-'+to+'-'+toPort,from:{nodeId:from,port:fromPort},to:{nodeId:to,port:toPort}});
 for(const a of [['universe-assets','universe-filter','data','assets'],['universe-filter','universe-rank','assets','assets'],['universe-rank','universe-select','rank','rank'],['universe-select','universe-member','selected','assets'],['execution-asset','universe-member','data','instrument'],['universe-member','selected-entry','condition','condition'],['spread-filter','selected-entry','decision','true'],['wait','selected-entry','decision','false']])edge(...a);
 const entry=graph.edges.find(e=>e.to.nodeId==='position-route'&&e.to.port==='false');entry.from.nodeId='selected-entry';entry.id='selected-entry-position-route-false';
 graph.compositions.push({id:'universe-screen',name:'후보 평가와 선택',nodeIds:['universe-assets','universe-filter','universe-rank','universe-select','execution-asset','universe-member','selected-entry'],collapsed:false,version:1});
 compileStrategyGraph(graph);return graph;
}

/** Research composition of shared atoms. Existing published graphs are unchanged. */
export function createScalpingJudgmentGraph({timeframe='1m',efficiencyMin=.3,splitTarget=.75,maxHoldMinutes=60,invalidation=false}={}){
 check(typeof invalidation==='boolean'&&Number.isFinite(efficiencyMin)&&efficiencyMin>0&&efficiencyMin<=1&&Number.isFinite(splitTarget)&&splitTarget>=.45&&splitTarget<=.85&&Number.isFinite(maxHoldMinutes)&&maxHoldMinutes>=15&&maxHoldMinutes<=60,'SCALP_JUDGMENT_PARAMS','방향 일치도, 추가 진입 비중과 보유 시간을 확인하세요.');
 const graph=createMultiAssetEventScalpingGraph({timeframe,params:{rvolMin:1.25,pressRvolMin:2,returnMin:.0002,breakoutMin:0,entryWeight:.45,pressWeight:.85,maxExposure:.9,stopLossRatio:.012,takeProfitRatio:.024,maxHoldMinutes}});
 const ids=[];
 const add=(type,id,label,config)=>{ids.push(id);graph.nodes.push({...createDecisionStrategyNode(type,{id,config,position:{x:1500,y:ids.length*140}}),label});};
 const edge=(from,to,fromPort,toPort)=>graph.edges.push({id:from+'-'+to+'-'+toPort,from:{nodeId:from,port:fromPort},to:{nodeId:to,port:toPort}});
 const input=(id,kind,metricId,label)=>add('INPUT',id,label,{kind,instrumentId:'execution:current',required:true,maxAgeMs:3000,metricId,...(kind==='MICROSTRUCTURE'?{timeframe,lookbackBars:20,flowWindowMs:60000,bookMaxAgeMs:3000}:{})});
 const cond=(id,from,operator,value,label)=>{add('CONDITION',id,label,{operator,value});edge(from,id,'data','value');};
 const all=(id,from,label)=>{add('BOOLEAN_LOGIC',id,label,{operation:'ALL'});from.forEach(n=>edge(n,id,'condition','conditions'));};
 const route=(id,condition,yes,no,label)=>{add('DECISION_ROUTER',id,label,{mode:'CONDITION'});edge(condition,id,'condition','condition');edge(yes,id,'decision','true');edge(no,id,'decision','false');};
 input('window-return','MICROSTRUCTURE','RETURN_WINDOW','직전 20봉 가격 변화');input('path-efficiency','MICROSTRUCTURE','DIRECTIONAL_EFFICIENCY','직전 20봉 방향 일치도');input('buy-flow','MICROSTRUCTURE','BUY_TRADE_RATIO','최근 매수 체결 비중');
 cond('window-positive','window-return','gt',0,'구간 가격 상승');cond('trend-efficiency','path-efficiency','gte',efficiencyMin,'방향 일치도 충족');cond('flow-positive','buy-flow','gte',.55,'매수 체결 우세');
 all('trend-confirmed',['window-positive','trend-efficiency','flow-positive','breakout-ready'],'상승 구간과 돌파 및 체결 확인');
 const press=graph.edges.find(e=>e.to.nodeId==='candidate-choice'&&e.to.port==='condition');press.from.nodeId='trend-confirmed';press.id='trend-confirmed-candidate-choice-condition';
 graph.nodes=graph.nodes.filter(n=>n.id!=='press-ready');graph.edges=graph.edges.filter(e=>e.to.nodeId!=='press-ready');for(const c of graph.compositions)c.nodeIds=c.nodeIds.filter(id=>id!=='press-ready');
 route('winner-continuation','trend-confirmed','time-exit','profit-exit','수익 중 추세 확인 후 보유 연장');
 const profit=graph.edges.find(e=>e.to.nodeId==='profit-priority'&&e.to.port==='true');profit.from.nodeId='winner-continuation';profit.id='winner-continuation-profit-priority-true';
 input('entry-count','POSITION','ENTRY_COUNT','현재 포지션 매수 횟수');
 cond('split-loss','position-return','lte',-.003,'분할 진입 가격 도달');cond('split-count','entry-count','lt',2,'추가 진입 횟수 확인');cond('window-negative','window-return','lt',0,'구간 하락 상태');
 all('rebound-add',['split-loss','split-count','window-negative','return-ready','flow-positive'],'하락 구간 반등과 체결 확인');
 add('QUANT','split-add','반등 확인 후 제한된 추가 진입',{mode:'CONDITION',onTrue:'buy',onFalse:'hold',buyTargetWeight:splitTarget,sellTargetWeight:0,buyIntent:'ENTRY'});edge('rebound-add','split-add','condition','signal');
 route('split-route','rebound-add','split-add','wait','추가 진입 또는 보유');route('holding-time-priority','time-ready','time-exit','split-route','최대 시간 확인 후 보유 판단');
 const timed=graph.edges.find(e=>e.to.nodeId==='profit-priority'&&e.to.port==='false');timed.from.nodeId='split-route';timed.id='split-route-profit-priority-false';
 const holding=graph.edges.find(e=>e.to.nodeId==='holding-time-priority'&&e.to.port==='false');holding.from.nodeId='profit-priority';holding.id='profit-priority-holding-time-priority-false';
 const stop=graph.edges.find(e=>e.to.nodeId==='stop-priority'&&e.to.port==='false');stop.from.nodeId='holding-time-priority';stop.id='holding-time-priority-stop-priority-false';
 if(invalidation){
  cond('failed-breakout','breakout','lt',-.001,'돌파 가격 재이탈');cond('selling-flow','buy-flow','lt',.45,'매도 체결 우세');cond('negative-close','return','lt',0,'직전 확정 봉 하락');cond('entry-grace','held-hours','gte',2/60,'진입 후 2분 경과');
  all('entry-invalidated',['failed-breakout','selling-flow','negative-close','entry-grace'],'돌파 실패와 매도 체결 확인');
  add('QUANT','invalidation-exit','진입 근거 소멸 시 전량 종료',{mode:'CONDITION',onTrue:'sell',onFalse:'hold',buyTargetWeight:.45,sellTargetWeight:0,sellIntent:'EXIT'});edge('entry-invalidated','invalidation-exit','condition','signal');
  route('invalidation-route','entry-invalidated','invalidation-exit','profit-priority','진입 근거 확인 후 보유 판단');holding.from.nodeId='invalidation-route';holding.id='invalidation-route-holding-time-priority-false';
 }
 graph.compositions.push({id:'scalp-judgment',name:'추세 확인과 보유 중 분할 진입',nodeIds:ids,collapsed:false,version:1});
 compileStrategyGraph(graph);return graph;
}

/** Select only received closed bars and observed books. Future values never enter candidate features. */
export function buildEventCandidateInput({datasets,profileId,asOf,timeframe,universeHash,maxCandidates=20}={}){
 check(Array.isArray(datasets)&&datasets.length>=1&&datasets.length<=maxCandidates&&new Set(datasets.map(d=>d.instrumentId)).size===datasets.length,'EVENT_UNIVERSE_SIZE','같은 시각의 후보 종목 자료 1개 이상을 선택하세요.');
 const quoteCurrency=datasets[0].market.split('-')[0],step=Number(timeframe.slice(0,-1))*60000;
 check(['1m','3m','5m'].includes(timeframe)&&datasets.every(d=>d.timeframe===timeframe&&d.market.split('-')[0]===quoteCurrency),'EVENT_UNIVERSE_CURRENCY','후보의 분봉과 원 통화를 맞추세요.');
 const boundary=at(Math.floor(Date.parse(asOf)/step)*step),refs=[],items=datasets.map(d=>{
  const bars=d.bars.filter(b=>b.closeTime<=boundary&&(b.availableAt??b.closeTime)<=asOf).slice(-501).map(b=>Object.fromEntries(['openTime','closeTime','open','high','low','close','volume','quoteVolume'].filter(k=>Object.hasOwn(b,k)).map(k=>[k,b[k]])));
  const book=eventBookAt(d,asOf),levels=book?.levels??[],bid=Number(levels[0]?.bidPrice),ask=Number(levels[0]?.askPrice),valid=levels.length>0&&bid>0&&ask>=bid&&levels.every(l=>['bidPrice','askPrice','bidQuantity','askQuantity'].every(k=>Number.isFinite(Number(l[k]))&&Number(l[k])>=0));
  refs.push({id:'event-dataset:'+d.id,contentHash:d.sourceHash,sourceRef:'OBSERVED_EVENT_DATASET'});
  const quoteVolume=bars.every(b=>Number.isFinite(b.quoteVolume))?bars.reduce((n,b)=>n+b.quoteVolume,0):0;
  return {instrumentId:d.instrumentId,bars,quoteVolume,warning:d.warning===true,warningKnown:typeof d.warning==='boolean',...(valid?{book:{asOf:book.eventTime,availableAt:book.availableAt??book.receivedAt,sourceHash:book.sourceHash,spreadBps:(ask-bid)/((ask+bid)/2)*10000,bidNotional:levels.reduce((n,l)=>n+Number(l.bidPrice)*Number(l.bidQuantity),0),askNotional:levels.reduce((n,l)=>n+Number(l.askPrice)*Number(l.askQuantity),0)}}:{})};
 });
 return {ready:true,asOf:boundary,availableAt:asOf,unit:'ASSET_SET',sourceRefs:refs,missing:[],value:{contractVersion:PORTFOLIO_CANDIDATE_VERSION,profileId,quoteCurrency,timeframe,asOf:boundary,evaluatedAt:asOf,universeHash,items}};
}

export function assertMultiAssetEventGraph(graph,{datasets,instrumentIds}={}){
 compileStrategyGraph(graph);const s=graph.executionScope;
 check(s?.kind==='EACH_ASSET'&&s.maxConcurrentPositions===1,'EVENT_MULTI_SCOPE','종목별 평가 범위와 동시 1종목 운용을 확인하세요.');
 check(datasets.length>=1&&datasets.length<=s.maxCandidates&&datasets.every(d=>d.timeframe===s.timeframe&&instrumentIds.includes(d.instrumentId))&&new Set(datasets.map(d=>d.instrumentId)).size===datasets.length,'EVENT_MULTI_UNIVERSE','발행 정책 투자 범위의 서로 다른 후보 자료를 선택하세요.');
 check(graph.nodes.filter(n=>n.type==='SELECT').length===1&&graph.nodes.filter(n=>n.type==='SELECT').every(n=>n.config.maxPositions===1),'EVENT_MULTI_SELECTION','동시 1종목 모의 운용에는 상위 1개 선택 노드를 연결하세요.');
 check(graph.nodes.filter(n=>n.type==='INPUT').every(n=>n.config.kind==='ASSET_SET'&&n.config.timeframe===s.timeframe||n.config.kind==='EXECUTION_ASSET'||['MICROSTRUCTURE','POSITION'].includes(n.config.kind)&&n.config.instrumentId==='execution:current'&&(n.config.kind==='POSITION'||n.config.timeframe===s.timeframe))&&!graph.nodes.some(n=>n.type==='VIBE')&&graph.triggers.includes('market_event'),'EVENT_MULTI_INPUT','현재 종목의 체결·호가·자기 포지션과 후보 목록을 연결하세요.');
 return {graphHash:strategyGraphHash(graph),universeHash:hashInputPackage([...instrumentIds].sort()),timeframe:s.timeframe};
}
