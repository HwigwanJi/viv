import {hashInputPackage} from './workspace.mjs';
import {createDecisionStrategyNode,compileDecisionStrategyGraph} from './strategy-decision-graph.mjs';
import {createSessionStrategyGraph} from './session-strategy.mjs';
import {SESSION_RULE_DEFAULTS,prepareSessionPlan} from './session-rule.mjs';
import {prepareSessionTrendPlan,prepareCappedSessionPlan,sessionTrendSignal,SESSION_STRUCTURE_DEFAULTS} from './session-regime.mjs';
import {prepareBrokerSessionPlan} from './session-order-policy.mjs';

export const SESSION_AI_CONTEXT_VERSION='session-ai-prior-context-v2';
export function sessionMarketHistory(dataset,date){
 const rows=dataset.bars.filter(b=>b.date<date).slice(-120),factor=rows.at(-1)?.futureSplitFactor??1;
 return rows.map(b=>({date:b.date,close:b.close/b.futureSplitFactor*factor,volume:b.volume}));
}
export function sessionAiContext({graph,account,date,decisionAt,feeBps,slippageBps=5,signalHistory,marketHistory,decisionMemory=[]}){
 if(!Array.isArray(marketHistory)||marketHistory.length<60||marketHistory.some((b,i)=>b.date>=date||i&&b.date<=marketHistory[i-1].date||!Number.isFinite(b.close)||b.close<=0))throw Object.assign(new Error('AI 판단 이전의 확정 가격 경로 60거래일 이상을 연결하세요.'),{code:'SESSION_AI_HISTORY'});
 const last=marketHistory.at(-1).close,nav=account.cash+account.quantity*account.history.at(-1),volumeBase=marketHistory.slice(-20).reduce((n,b)=>n+b.volume,0)/20;
 if(decisionMemory.some(m=>m.date>=date))throw Object.assign(new Error('AI 기억에는 판단 이전의 거래 결과를 연결하세요.'),{code:'SESSION_AI_MEMORY'});
 const order=graph.nodes.find(n=>n.type==='ORDER');
 const proposals=graph.nodes.filter(n=>['SESSION_TREND','SESSION_RULE'].includes(n.type)).map(n=>{
  const options={date,decisionAt,feeBps,signalHistory},p=n.type==='SESSION_TREND'?prepareSessionTrendPlan(account,n.config,options):(n.config.maxExposure===undefined?prepareSessionPlan(account,n.config,options):prepareCappedSessionPlan(account,n.config,options)),adapted=prepareBrokerSessionPlan(account,p,order.config),notional=adapted.orders.reduce((sum,o)=>sum+o.quantity*last,0);
  return {nodeId:n.id,targetWeight:p.strategy?.targetWeight??n.config.maxExposure??1,currentWeight:account.quantity*account.history.at(-1)/nav,volatilityTarget:n.config.volatilityTarget??null,plannedOrderCount:adapted.orders.length,buyShares:adapted.orders.filter(o=>o.side==='buy').reduce((sum,o)=>sum+o.quantity,0),sellShares:adapted.orders.filter(o=>o.side==='sell').reduce((sum,o)=>sum+o.quantity,0),estimatedTurnoverRatio:notional/nav,estimatedFeesAndSlippageUSD:notional*(feeBps+slippageBps)/10000,costEstimateBasis:'PRIOR_CLOSE_REFERENCE'};
 });
 const relative=rows=>rows.slice(-60).map((b,i)=>({bar:i,closeRatio:Number((b.close/rows.at(-1).close).toFixed(6))}));
 return {contractVersion:SESSION_AI_CONTEXT_VERSION,knownThrough:marketHistory.at(-1).date,pricePath:relative(marketHistory),volumeRatios:marketHistory.slice(-20).map(b=>volumeBase?Number((b.volume/volumeBase).toFixed(4)):0),benchmarkPath:relative(signalHistory),returns:Object.fromEntries([1,5,20,60].map(n=>[n,marketHistory.length>n?last/marketHistory.at(-1-n).close-1:null])),quant:sessionTrendSignal(signalHistory,{...SESSION_STRUCTURE_DEFAULTS,longTrendGuard:true},decisionAt),position:{equity:nav,cashWeight:account.cash/nav,currentWeight:account.quantity*account.history.at(-1)/nav,unrealizedReturn:account.costBasis?account.quantity*account.history.at(-1)/account.costBasis-1:0,splitProgress:account.t,mode:account.mode,realizedPnlRatio:account.realizedPnl/account.initialCash},proposals,recentDecisions:decisionMemory.slice(-8),recentFills:(account.lastFills??[]).map(f=>({at:f.at,side:f.side,quantity:f.quantity,price:f.fillPrice,fee:f.fee})),costs:{feeBpsPerSide:feeBps,slippageBpsPerSide:slippageBps,closingOrder:'PRIOR_CLOSE_BOUNDED_LIMIT_CLS'},inputHash:hashInputPackage({marketHistory,signalHistory,account,decisionMemory})};
}
export function createSessionAiGraph({volatilityTarget=null,limitBandBps=500}={}){
 const graph=createSessionStrategyGraph({...SESSION_RULE_DEFAULTS,maxExposure:.2}),make=(type,id,config,x,y,label)=>({...createDecisionStrategyNode(type,{id,config,position:{x,y}}),label});
 const cases=[{id:'SPLIT',label:'분할매수'},{id:'TREND',label:'추세 보유'},{id:'CLUTCH',label:'승부 확대'},{id:'CASH',label:'현금 전환'}];
 graph.nodes.push(make('INPUT','session-ai-context',{kind:'CONTEXT',instrumentId:'equity:NASDAQ:TQQQ',required:true},0,-300,'AI 가격 경로와 현재 포지션'),make('JEV_QUESTION','session-ai',{provider:'JEV',question:{schemaVersion:1,contractVersion:'jev-question-v1',id:'session-ai',type:'choice',instructions:[
  '역할: 라오어 투자 모델의 세션 스위칭을 담당하는 AI이자 추세 매매 전문가다.',
  '원 전략: TQQQ40분할 매수와 목표 수익 매도다. 초기 소액 진입으로 놓치는 상승, 추세 중 조기 매도, 하락 중 누적 매수를 점검한다.',
  '판단: 연결한 확정 가격 경로, 거래량, QQQ 흐름과 현재 포지션으로 지금 승부를 걸 기회인지 평가한다. 지속되는 고점·저점 상승과 돌파 유지에는 추세 보유 또는 승부 확대를 선택한다. 약한 반등과 연속 지지 이탈에는 분할매수 또는 현금 전환을 선택한다.',
  '목표: 거래 비용을 차감한 QQQ 초과수익과 최대 낙폭 개선이다. 보유 중에는 지금부터의 상승 여력과 하락 위험을 비교하고, 유리한 추세는 충분히 보유한다. 실제 목표 비중은 proposals에 제시돼 있다.'
 ],candidates:cases.map(c=>({...c,description:{SPLIT:'자금20% 범위에서 기존40분할 매수를 실행한다.',TREND:'추세 보유 경로로 자금을 배분한다.',CLUTCH:'가장 유리한 추세에 승부 확대 경로로 자금을 배분한다.',CASH:'보유분을 현금으로 전환하는 종가 지정가를 계획한다.'}[c.id]}))}},320,-300,'승부사 AI 스위칭'),make('DECISION_ROUTER','session-ai-router',{mode:'CHOICE',payload:'ORDER_PLAN',cases},960,0,'AI 선택에 따른 주문 계획'));
 for(const [id,weight,label,y] of [['TREND',.8,'추세 보유',-120],['CLUTCH',1,'승부 확대',80],['CASH',0,'현금 전환',280]])graph.nodes.push(make('SESSION_TREND','session-'+id.toLowerCase(),{symbol:'TQQQ',targetWeight:weight,rebalancingBand:.05,...(volatilityTarget&&weight>0?{volatilityTarget:volatilityTarget*(id==='CLUTCH'?1.5:1)}:{})},640,y,label));
 const order=graph.nodes.find(n=>n.type==='ORDER');order.config={...order.config,brokerId:'toss',sessionOrderPolicy:'TOSS_LOC',limitBandBps};order.label='토스 종가 지정가 주문';
 graph.edges=graph.edges.filter(e=>e.to.nodeId!=='session-risk');
 const connections=[['session-ai-context','session-ai','data','context'],['session-ai','session-ai-router','value','selector'],['session-rule','session-ai-router','plan','case:SPLIT'],...['TREND','CLUTCH','CASH'].flatMap(id=>[['session-state','session-'+id.toLowerCase(),'data','state'],['session-'+id.toLowerCase(),'session-ai-router','plan','case:'+id]]),['session-ai-router','session-risk','plan','decision']];
 graph.edges.push(...connections.map(([a,b,c,d],i)=>({id:'ai-session-edge-'+i,from:{nodeId:a,port:c},to:{nodeId:b,port:d}})));
 compileDecisionStrategyGraph(graph);return graph;
}
