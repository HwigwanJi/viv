import {evaluateAdaptivePortfolio,portfolioSourceSpec} from '../dist/domain/adaptive-portfolio-graph.mjs';
import {hashInputPackage} from '../dist/domain/workspace.mjs';
import {advancePortfolioNewsLearning,retainPortfolioNewsForecast} from './portfolio-news-learning.mjs';
const open=new Set(['RESERVED','UNKNOWN','PENDING','PARTIALLY_FILLED','RECONCILIATION_REQUIRED','RESPONSE_REVIEW_REQUIRED']);
export function portfolioSourceMarkets(spec,approvedMarkets){
 const selected=spec.instrumentIds??(spec.instrumentId?[spec.instrumentId]:null);
 const markets=selected?selected.map(id=>id.startsWith('crypto:upbit:')?id.slice('crypto:upbit:'.length):null):approvedMarkets;
 if(markets.some(m=>!m||!approvedMarkets.includes(m)))throw Object.assign(new Error('승인된 투자 범위 안의 판단 대상을 연결하세요.'),{code:'PORTFOLIO_INPUT_SCOPE'});
 return [...markets];
}
/** Keep per-input history and receipts separate while sharing the decision boundary. */
export async function capturePortfolioSources({graph,capture}){
 const contract=portfolioSourceSpec(graph),specs=contract.sources??[contract],inputs={};
 for(const spec of specs)inputs[spec.input.id]=await capture(spec);
 if(specs.length===1)return inputs[specs[0].input.id];
 const frames=Object.values(inputs),asOf=frames[0].asOf;
 if(frames.some(f=>f.asOf!==asOf||f.timeframe!==contract.timeframe))throw Object.assign(new Error('입력별 확정봉 시점과 주기를 맞추세요.'),{code:'PORTFOLIO_INPUT_SCOPE'});
 return {timeframe:contract.timeframe,asOf,availableAt:frames.map(f=>f.availableAt).sort().at(-1),sourceRefs:frames.flatMap(f=>f.sourceRefs),inputs};
}
/** Persist the target before sending. Reconcile each order before spending its proceeds. */
export async function processAdaptivePortfolio({graph,scope,state,clock,readOrders,readOwn,capture,save,execute,resolveQuestions,executionMode='LIVE'}){
 const step=portfolioSourceSpec(graph).stepMs,boundary=new Date(Math.floor(Date.parse(clock())/step)*step).toISOString(),graphHash=hashInputPackage(graph);
 const orders=await readOrders();if(orders.some(o=>open.has(o.state)))return {state:'PORTFOLIO_RECONCILING'};
 const period=(graph.nodes.find(n=>n.type==='MODEL'&&n.config.family==='SURGE_PATH_FOREST')?.config.policy.decisionEveryMinutes??graph.nodes.find(n=>n.type==='PORTFOLIO_ROUTER')?.config.rebalanceEveryHours??1)*step;
 if(state.portfolioRebalancedGraph===graphHash&&Math.floor(Date.parse(state.portfolioRebalancedAt)/period)===Math.floor(Date.parse(boundary)/period))return {state:'PORTFOLIO_WAIT_RESEARCH',nextAnalysisAt:new Date((Math.floor(Date.parse(boundary)/period)+1)*period).toISOString()};
 let plan=state.portfolioPlan;
 if(plan?.graphHash!==graphHash||plan?.boundary!==boundary){
  const minute=graph.nodes.some(n=>n.type==='MODEL'&&n.config.family==='SURGE_PATH_FOREST'),priorOwn=minute?await readOwn(scope.market):null;
  const frame=await capture(),own=priorOwn??await readOwn(scope.market),asOf=clock();
  const newsConfig=graph.nodes.find(n=>n.type==='PORTFOLIO_ROUTER')?.config;
  if(frame.news&&Object.hasOwn(newsConfig??{},'newsReturnBps')){frame.news={...frame.news,asOf:frame.availableAt,coefficient:advancePortfolioNewsLearning(state,frame,newsConfig)};await save('PORTFOLIO_NEWS_LEARNING',{coefficient:frame.news.coefficient});}
  if(frame.asOf!==boundary||Date.parse(asOf)>=Date.parse(boundary)+step)throw Object.assign(new Error('현재 확정봉 시점으로 다시 판단합니다.'),{code:'PORTFOLIO_FRAME_STALE'});
  const args={executionMode,frame,account:own.position,fees:own.readiness?.fees?{buyRate:own.readiness.fees.takerBuyRate,sellRate:own.readiness.fees.takerSellRate,availableAt:own.readiness.fees.observedAt,sourceHash:own.readiness.fees.sourceHash}:undefined,asOf,profileId:own.activation.config.profileId,universe:scope.instrumentIds,lastRebalancedAt:state.portfolioRebalancedGraph===graphHash?state.portfolioRebalancedAt??null:null,lastAllocationBudget:state.portfolioRebalancedGraph===graphHash?state.portfolioRebalancedBudget??null:null,routerSelections:state.portfolioRebalancedGraph===graphHash?state.portfolioRouterSelections??{}:{},surgePositions:state.portfolioRebalancedGraph===graphHash?state.portfolioSurgePositions??{}:{}};
  let evaluation=evaluateAdaptivePortfolio(graph,args);
  if(evaluation.requiredQuestionNodeIds?.length&&resolveQuestions)evaluation=await resolveQuestions({args,boundary,own});
  if(Date.parse(clock())>=Date.parse(boundary)+step)throw Object.assign(new Error('새 확정봉 자료로 다시 판단합니다.'),{code:'PORTFOLIO_FRAME_STALE'});
  if(!evaluation.output.ready)throw Object.assign(new Error(evaluation.output.reasonCodes.join(', ')),{code:'PORTFOLIO_EVALUATION',reasonCodes:[...evaluation.output.reasonCodes]});
  if(frame.news&&Object.hasOwn(newsConfig??{},'newsReturnBps'))retainPortfolioNewsForecast(state,{frame,evaluation,config:newsConfig,knownAt:clock(),graphHash});
  const targets=evaluation.output.value.targets,byId=new Map(own.position.positions.map(p=>[p.instrumentId,p.marketValue/own.position.equity]));
  const changes=targets.map(t=>({...t,delta:t.targetWeight-(byId.get(t.instrumentId)??0)})).filter(t=>evaluation.output.orderAllowed&&Math.abs(t.delta)>1e-10).sort((a,b)=>a.delta-b.delta||a.instrumentId.localeCompare(b.instrumentId));
  state.lastEvaluationAt=asOf;state.lastDecisionBar=boundary;state.lastState='PORTFOLIO_EVALUATED';
  plan={boundary,graphHash,evaluation,changes,cursor:0,results:[]};state.portfolioPlan=plan;await save('PORTFOLIO_TARGET_PREPARED',{plan,sourceRefs:frame.sourceRefs});await save('DECISION_SUMMARY',{snapshotAsOf:evaluation.asOf,inputHash:evaluation.sourceHash,evaluation});
 }
 if(plan.cursor>=plan.changes.length&&plan.results.some(r=>['LIVE_MODEL_PRICE_CHANGED','LIVE_MODEL_EDGE_CONSUMED'].includes(r.state)))return {state:'PORTFOLIO_ENTRY_REEVALUATE',nextAnalysisAt:new Date(Date.parse(plan.boundary)+period).toISOString(),results:plan.results};
 const settled=plan.results.every(r=>['FILLED','TARGET_REACHED','LIVE_MINIMUM_ORDER','LIVE_TARGET_REACHED'].includes((r.identifier&&orders.find(o=>o.identifier===r.identifier)?.state)||r.state));
 if(plan.cursor>=plan.changes.length&&!settled)return {state:'PORTFOLIO_TARGET_INCOMPLETE',results:plan.results};
 if(plan.cursor>=plan.changes.length&&(state.portfolioRebalancedAt!==plan.boundary||state.portfolioRebalancedGraph!==graphHash)){state.lastState='PORTFOLIO_TARGET_MANAGED';state.portfolioRebalancedAt=plan.boundary;state.portfolioRebalancedGraph=graphHash;state.portfolioRebalancedBudget=plan.evaluation.output.portfolioState?.allocationBudget??plan.evaluation.trace.find(n=>n.type==='ALLOCATE')?.requestedBudget??null;state.portfolioRouterSelections=plan.evaluation.output.portfolioState?.routerSelections??{};state.portfolioSurgePositions=plan.evaluation.output.portfolioState?.surgePositions??{};await save('PORTFOLIO_TARGET_COMPLETED',{boundary:plan.boundary,graphHash,budget:state.portfolioRebalancedBudget,routerSelections:state.portfolioRouterSelections});}
 if(plan.cursor>=plan.changes.length)return {state:'PORTFOLIO_TARGET_MANAGED',targets:plan.evaluation.output.value,learning:plan.evaluation.trace.find(n=>n.type==='PORTFOLIO_ROUTER')};
 const change=plan.changes[plan.cursor],market=change.instrumentId.slice('crypto:upbit:'.length),own=await readOwn(market),p=own.position.positions.find(p=>p.instrumentId===change.instrumentId),current=(p?.marketValue??0)/own.position.equity;
 if(Date.parse(clock())>=Date.parse(plan.boundary)+step)return {state:'PORTFOLIO_REEVALUATE'};
 const action=change.delta<0?'sell':'buy',delta=change.targetWeight-current,key='portfolio:'+hashInputPackage({boundary,graphHash,market,action});
 const prior=orders.find(o=>o.idempotencyKey===key);
 if(prior){plan.results.push({market,identifier:prior.identifier,state:prior.state,recovered:true});plan.cursor++;await save('PORTFOLIO_ORDER_RECOVERED',{key,state:prior.state});return {state:'PORTFOLIO_MANAGING'};}
 if(action==='sell'&&delta>=0||action==='buy'&&delta<=0){plan.results.push({market,state:'TARGET_REACHED'});plan.cursor++;await save('PORTFOLIO_TARGET_REACHED',{market});return {state:'PORTFOLIO_MANAGING'};}
 const {outputHash:parentEvaluationHash,...parent}=plan.evaluation;
 const evaluation={...parent,portfolioExecution:{parentEvaluationHash,instrumentId:change.instrumentId,accountAsOf:own.position.asOf??clock()},output:{...plan.evaluation.output,decision:{action,targetWeight:change.targetWeight,intent:{reason:'REGIME_EXPERT_ALLOCATION'}}}};evaluation.outputHash=hashInputPackage(evaluation);
 await save('ORDER_DECISION_READY',{market,snapshotAsOf:evaluation.asOf,inputHash:evaluation.sourceHash,evaluation});
 try{const result=await execute({own,market,evaluation,key,boundary});plan.results.push({market,identifier:result.record?.identifier,state:result.record?.state??'DISPATCHED'});}
 catch(error){if(!['LIVE_MINIMUM_ORDER','LIVE_TARGET_REACHED','LIVE_MODEL_PRICE_CHANGED','LIVE_MODEL_EDGE_CONSUMED'].includes(error.code))throw error;plan.results.push({market,state:error.code});}
 plan.cursor++;await save('PORTFOLIO_ORDER_DISPATCH',{key,result:plan.results.at(-1)});return {state:'PORTFOLIO_MANAGING'};
}
