import {PRICE_STRUCTURE_METRICS} from './price-structure-metrics.mjs';
import {resolveQueryParameters,bindPreparedInput} from './strategy-parameters.mjs';
import {createDecisionStrategyNode,compileStrategyGraph,evaluateStrategyGraph} from './strategy-graph.mjs';
import {adaptiveDefaults,assertAdaptiveConfig,EXPERT_MODES} from './adaptive-portfolio.mjs';
import {hashInputPackage} from './workspace.mjs';
import {PORTFOLIO_CANDIDATE_VERSION,assertPortfolioNodeConfig} from './portfolio-graph.mjs';
import {SURGE_MODEL_FAMILY} from './surge-path-model.mjs';
export const isCalendarPortfolioGraph=graph=>graph?.nodes?.some(n=>n.type==='ASSET_METRIC'&&n.config.metric==='MONTHLY_SMA_DISTANCE')&&graph.nodes.some(n=>n.type==='ORDER'&&n.config.sizing==='TARGET_WEIGHTS')&&!graph.executionScope;
export const isDailyPortfolioGraph=graph=>isCalendarPortfolioGraph(graph)||graph?.nodes?.some(n=>n.type==='ASSET_METRIC'&&PRICE_STRUCTURE_METRICS.includes(n.config.metric))&&graph.nodes.some(n=>n.type==='ORDER'&&n.config.sizing==='TARGET_WEIGHTS')&&!graph.executionScope;
export const isSurgePortfolioGraph=graph=>graph?.nodes?.some(n=>n.type==='MODEL'&&n.config.family===SURGE_MODEL_FAMILY)===true;
export const isAdaptivePortfolioGraph=graph=>graph?.nodes?.some(n=>n.type==='PORTFOLIO_ROUTER')||isSurgePortfolioGraph(graph)||isDailyPortfolioGraph(graph);
export function calendarPortfolioSelection(graph,selection,universeSize=500){return isDailyPortfolioGraph(graph)?{...selection,method:'strategy',maxPositions:Math.min(universeSize,Math.max(1,...graph.nodes.filter(n=>n.type==='ALLOCATE').map(n=>n.config.maxPositions))),minHistoryBars:portfolioSourceSpec(graph).minHistoryBars,rebalance:'1d-close',rebalanceEveryBars:1,exitUnselected:true}:selection;}
export function portfolioSourceSpec(graph,inputId){
 const inputs=graph.nodes.filter(n=>n.type==='INPUT');
 if(!inputId&&inputs.length>1){
  const sources=inputs.map(input=>portfolioSourceSpec(graph,input.id));
  if(sources.some(s=>s.timeframe!==sources[0].timeframe))throw Object.assign(new Error('공동 배분의 입력은 같은 확정봉 시점으로 맞추세요. 주봉·월봉은 일봉 원본에서 계산합니다.'),{code:'PORTFOLIO_INPUT_TIMEFRAME'});
  const universeSources=sources.filter(s=>!s.instrumentId);
  return {...sources[0],instrumentId:null,historyBars:Math.max(...sources.map(s=>s.historyBars)),minHistoryBars:Math.max(...(universeSources.length?universeSources:sources).map(s=>s.minHistoryBars)),allowShortHistory:sources.every(s=>s.allowShortHistory),sources};
 }
 const input=inputId?inputs.find(n=>n.id===inputId):inputs[0];if(!input||input.config.kind!=='ASSET_SET')throw Object.assign(new Error('공동 배분의 시세 입력을 확인하세요.'),{code:'PORTFOLIO_QUERY'});
 const resolved=resolveQueryParameters(graph,input);if(!resolved.ready)throw Object.assign(new Error('시세 입력 변수를 확인하세요.'),{code:'PORTFOLIO_QUERY'});
 // History belongs to the input feeding each metric, not to every branch in the graph.
 const descendants=new Set([input.id]);for(let i=0;i<graph.nodes.length;i++){let changed=false;for(const edge of graph.edges)if(descendants.has(edge.from.nodeId)&&!descendants.has(edge.to.nodeId)){descendants.add(edge.to.nodeId);changed=true;}if(!changed)break;}
 const metrics=graph.nodes.filter(n=>n.type==='ASSET_METRIC'&&descendants.has(n.id));
 const calendarMetrics=metrics.filter(n=>n.config.metric==='MONTHLY_SMA_DISTANCE'),calendar=calendarMetrics.length>0,months=calendar?Math.max(...calendarMetrics.map(n=>{const r=resolveQueryParameters(graph,n);if(!r.ready)throw Object.assign(new Error('월말 계산 기간을 확인하세요.'),{code:'PORTFOLIO_HISTORY'});assertPortfolioNodeConfig('ASSET_METRIC',r.node.config);return r.node.config.lookback;})):0;
 const structureMetrics=metrics.filter(n=>PRICE_STRUCTURE_METRICS.includes(n.config.metric)),required=[];
 for(const metric of structureMetrics){const resolvedMetric=resolveQueryParameters(graph,metric);if(!resolvedMetric.ready)throw Object.assign(new Error('지표 기간에 필요한 일봉 조회 범위를 확인하세요.'),{code:'PORTFOLIO_HISTORY'});const c=resolvedMetric.node.config;assertPortfolioNodeConfig('ASSET_METRIC',c);required.push(c.metric==='WEEKLY_EMA_DISTANCE'?c.lookback*7:Math.max(c.lookback,c.slowLookback??0));}
 if(required.some(n=>n>1000))throw Object.assign(new Error('지표 기간에 필요한 일봉 조회 범위를 확인하세요.'),{code:'PORTFOLIO_HISTORY'});
 const adaptive=graph.nodes.filter(n=>descendants.has(n.id)&&['MARKET_STATE','PORTFOLIO_ROUTER'].includes(n.type)).map(n=>{const r=resolveQueryParameters(graph,n);if(!r.ready)throw Object.assign(new Error('국면·학습 기간의 입력 변수를 확인하세요.'),{code:'PORTFOLIO_HISTORY'});assertAdaptiveConfig(n.type,r.node.config);return r.node;});
 // The earliest training decision needs its own preceding state window and a matured outcome.
 const stateHistory=Math.max(0,...adaptive.filter(n=>n.type==='MARKET_STATE').map(n=>n.config.lookback));
 const adaptiveHistory=Math.max(0,...adaptive.filter(n=>n.type==='PORTFOLIO_ROUTER').map(n=>n.config.trainingBars+n.config.horizonHours+stateHistory+1));
 const historyBars=isSurgePortfolioGraph(graph)?31:Math.max(adaptiveHistory,structureMetrics.length?Math.max(1000,calendar?Math.ceil((months+1)*31):0):calendar?Math.ceil((months+1)*31):200);if(!Number.isSafeInteger(historyBars)||historyBars<30||historyBars>1000)throw Object.assign(new Error('입력 계약은 최대 1000봉입니다. 연결한 지표·학습 기간을 확인하세요.'),{code:'PORTFOLIO_HISTORY'});
 const allowShortHistory=structureMetrics.length>0&&!calendar;
 return {input:resolved.node,resolution:resolved,timeframe:resolved.node.config.timeframe,stepMs:isSurgePortfolioGraph(graph)?60000:isDailyPortfolioGraph(graph)?86400000:3600000,historyBars,minHistoryBars:allowShortHistory?Math.max(2,...required):historyBars,allowShortHistory,instrumentId:resolved.node.config.instrumentId??null,instrumentIds:resolved.node.config.instrumentIds??null};
}
export function assertAdaptivePortfolioGraph(graph){
 compileStrategyGraph(graph);
 const inputs=graph.nodes.filter(n=>n.type==='INPUT'),order=graph.nodes.find(n=>n.type==='ORDER');
 if(order.config.recheckModelValue&&!isSurgePortfolioGraph(graph))throw Object.assign(new Error('모델 가치 재검사는 분봉 종목 선택 모델과 연결하세요.'),{code:'MODEL_ENTRY_GRAPH_SCOPE'});
 if(!inputs.length||inputs.some(n=>n.config.kind!=='ASSET_SET')||portfolioSourceSpec(graph).timeframe!==(isSurgePortfolioGraph(graph)?'1m':isDailyPortfolioGraph(graph)?'1d':'1h')||order.config.sizing!=='TARGET_WEIGHTS'||graph.executionScope||!graph.triggers.includes('market_event'))throw Object.assign(new Error('공동 배분은 주기에 맞는 확정 시세 입력과 계좌 목표 비중 주문을 사용합니다.'),{code:'ADAPTIVE_PORTFOLIO_GRAPH'});
 return graph;
}
export function createAdaptivePortfolioGraph({execution='ACCOUNT',router={},expert={},expertModes=EXPERT_MODES}={}){
 const graph={schemaVersion:2,contractVersion:'mind-strategy-decision-graph-v2',nodes:[],edges:[],outputNodeId:'order',triggers:['manual','closed_bar','market_event']};
 const add=(type,id,config,x,y)=>graph.nodes.push(createDecisionStrategyNode(type,{id,config,position:{x,y}}));
 const edge=(a,b,p,q)=>graph.edges.push({id:a+'-'+b+'-'+q,from:{nodeId:a,port:p},to:{nodeId:b,port:q}});
 add('INPUT','assets',{kind:'ASSET_SET',scope:'MIND_UNIVERSE',timeframe:'1h',required:true},0,450);
 add('MARKET_STATE','state',adaptiveDefaults('MARKET_STATE'),350,450);
 edge('assets','state','data','assets');
 expertModes.forEach((mode,i)=>{add('PORTFOLIO_EXPERT',mode.toLowerCase(),{...adaptiveDefaults('PORTFOLIO_EXPERT'),...expert,mode},750,i*300);graph.nodes.at(-1).label={TREND:'추세 지속',BREAKOUT:'고점 돌파',RECOVERY:'하락 후 회복',CASH:'현금 보유',BTC_HOLD:'BTC 보유',NEWS:'뉴스 영향'}[mode];edge('state',mode.toLowerCase(),'state','state');});
 add('PORTFOLIO_ROUTER','router',{...adaptiveDefaults('PORTFOLIO_ROUTER'),...router},1150,450);
 edge('assets','router','data','assets');edge('state','router','state','state');
 for(const mode of expertModes)edge(mode.toLowerCase(),'router','proposal','experts');
 add('RISK','risk',{mode:'PORTFOLIO',maxExposure:1,maxOrderWeight:1},1550,450);
 add('ORDER','order',{execution,sizing:'TARGET_WEIGHTS',orderType:'LIMIT_FOK',maxSlippageBps:20,participationRate:.1},1950,450);
 edge('router','risk','targets','decision');edge('risk','order','approved','approved');
 assertAdaptivePortfolioGraph(graph);return graph;
}
export function createManagedPortfolioGraph({execution='ACCOUNT',router={},expert={},news=false}={}){
 return createAdaptivePortfolioGraph({execution,expertModes:[...EXPERT_MODES,'BTC_HOLD',...(news?['NEWS']:[])],expert:{maxPositions:3,maxAssetWeight:1,...expert},router:{trainingBars:168,horizonHours:3,rebalanceEveryHours:3,...(news?{newsReturnBps:100,newsHalfLifeHours:24}:{}),...router}});
}
export function adaptivePortfolioInputs(graph,{frame,account,fees,asOf,profileId,universe,lastRebalancedAt=null,lastAllocationBudget=null,routerSelections={},surgePositions={},executionMode='LIVE'}){
 assertAdaptivePortfolioGraph(graph);
 if(!frame?.sourceRefs?.length||frame.availableAt>asOf||frame.asOf>asOf)throw Object.assign(new Error('수신한 확정 시장 자료가 필요합니다.'),{code:'ADAPTIVE_PORTFOLIO_SOURCE'});
 const contract=portfolioSourceSpec(graph),specs=contract.sources??[contract],inputs={};
 const universeHash=hashInputPackage([...universe].sort()),equity=account.equity;
 const portfolio={profileId,quoteCurrency:account.quoteCurrency,asOf,equity,cashWeight:account.cash/equity,weights:account.positions.map(p=>({instrumentId:p.instrumentId,weight:p.marketValue/equity})),lastRebalancedAt,lastAllocationBudget,routerSelections,universeHash,...(isSurgePortfolioGraph(graph)?{surgePositions,account:{profileId,accountId:account.id,asOf,cash:account.exact?.cash??account.cash,positions:account.positions.map(p=>({market:p.instrumentId.slice('crypto:upbit:'.length),quantity:p.quantity,entryPrice:p.averageCost??p.costBasis/p.quantity,entryAt:(account.ledger??[]).filter(f=>f.instrumentId===p.instrumentId&&f.side==='buy').at(-1)?.at??null})),sourceHash:hashInputPackage(account)}}:{})};
 for(const spec of specs){
  const source=specs.length===1?frame:frame.inputs?.[spec.input.id];
  if(!source?.sourceRefs?.length||source.availableAt>asOf||source.asOf!==frame.asOf||spec.instrumentId&&!universe.includes(spec.instrumentId)||spec.timeframe!==(source.timeframe??'1h')||!Array.isArray(source.series))throw Object.assign(new Error('각 입력의 승인 투자 범위·확정 시점·시세 주기를 확인하세요.'),{code:'PORTFOLIO_INPUT_SCOPE'});
  if(source.series.some(s=>!universe.includes('crypto:upbit:'+s.market))||spec.instrumentId&&!source.series.some(s=>'crypto:upbit:'+s.market===spec.instrumentId))throw Object.assign(new Error('승인 투자 범위와 연결한 종목의 시세를 확인하세요.'),{code:'PORTFOLIO_INPUT_SCOPE'});
  const requested=spec.instrumentIds??(spec.instrumentId?[spec.instrumentId]:null);
  if(requested&&requested.some(id=>!universe.includes(id)||!source.series.some(s=>'crypto:upbit:'+s.market===id)))throw Object.assign(new Error('지정한 판단 대상의 승인 범위와 시세를 확인하세요.'),{code:'PORTFOLIO_INPUT_SCOPE'});
  const series=source.series.filter(s=>!requested||requested.includes('crypto:upbit:'+s.market));
  if(spec.allowShortHistory&&!requested&&account.positions.some(p=>p.marketValue>0&&!series.some(s=>'crypto:upbit:'+s.market===p.instrumentId)))throw Object.assign(new Error('보유 종목의 시세가 누락됐습니다.'),{code:'PRICE_STRUCTURE_HELD_HISTORY_REQUIRED'});
  const value={contractVersion:PORTFOLIO_CANDIDATE_VERSION,profileId,quoteCurrency:account.quoteCurrency,timeframe:spec.timeframe,asOf:source.asOf,universeHash,...(isSurgePortfolioGraph(graph)?{availableAt:source.availableAt}:{}),...(frame.news?{news:frame.news,newsHalfLifeHours:graph.nodes.find(n=>n.type==='PORTFOLIO_ROUTER')?.config.newsHalfLifeHours??24,evaluatedAt:asOf}:{}),items:series.map(s=>({instrumentId:'crypto:upbit:'+s.market,warning:source.entryEligibility?.markets[s.market]?.allowed!==true,warningKnown:!!source.entryEligibility,...(isSurgePortfolioGraph(graph)?{quote:s.quote}:{}),quoteVolume:s.bars.reduce((a,b)=>a+b.quoteVolume,0),bars:s.bars.map(b=>({openTime:new Date(b.t-spec.stepMs).toISOString(),closeTime:new Date(b.t).toISOString(),open:b.open,high:b.high,low:b.low,close:b.close,volume:b.volume,...(b.quoteVolume!==undefined?{quoteVolume:b.quoteVolume}:{})}))}))};
  inputs[spec.input.id]=bindPreparedInput({ready:true,value,asOf:source.asOf,availableAt:source.availableAt,sourceRefs:source.sourceRefs,missing:[]},spec.resolution);
 }
 return {inputs,context:{profileId,accountId:account.id,currentWeight:1-portfolio.cashWeight,inputAvailableAt:asOf,executionMode,portfolio,...(isSurgePortfolioGraph(graph)?{portfolioFees:fees}: {})}};
}
export function evaluateAdaptivePortfolio(graph,args){const {inputs,context}=adaptivePortfolioInputs(graph,args);return evaluateStrategyGraph(graph,[],{asOf:args.asOf,sourceHash:hashInputPackage(inputs),trigger:'market_event',inputs,context});}
