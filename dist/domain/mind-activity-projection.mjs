import {normalizeOperationWindow,operationWindowState} from './operation-window.mjs';
import {buildMindCompanions} from './mind-companion.mjs';
import {hashInputPackage} from './workspace.mjs';
import {mindDocumentHash} from './mind-manifest.mjs';
import {strategyGraphHash} from './strategy-graph.mjs';
import {strategyExecutionView} from './strategy-execution-view.mjs';
import {getInstrument} from './instruments.mjs';

export const PAPER_MIND_ACTIVITY_VERSION='paper-mind-activity-v1';
const list=value=>Array.isArray(value)?value:[];
const iso=value=>typeof value==='string'&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value;
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const code=value=>typeof value==='string'&&/^[A-Z][A-Z0-9_]{0,99}$/.test(value)?value:null;
const stamp=value=>iso(value)?value:null;
const scalar=value=>typeof value==='boolean'||finite(value)?value:null;
const fields=['action','stance','targetWeight','strength','authority','confidence','probabilities','intent','intentContributors'];
const decisionFields=value=>Object.fromEntries(fields.map(key=>[key,value?.[key]??null]));
const intent=value=>['ENTRY','ADD','REDUCE','EXIT','STOP_LOSS','TAKE_PROFIT','CAMPAIGN_EXIT'].includes(value?.code)?{code:value.code,nodeId:typeof value.nodeId==='string'?value.nodeId:null}:null;

// Preserve the existing paper ledger's decimal value, including its eight-decimal units.
function amount(value){
 if(!finite(value))return null;
 const text=String(Object.is(value,-0)?0:value);
 if(!/[eE]/.test(text))return text;
 const negative=text.startsWith('-'),[mantissa,exponent]=text.replace(/^-/, '').toLowerCase().split('e'),[whole,fraction='']=mantissa.split('.'),digits=whole+fraction,index=whole.length+Number(exponent);
 return (negative?'-':'')+(index<=0?'0.'+'0'.repeat(-index)+digits:index>=digits.length?digits+'0'.repeat(index-digits.length):digits.slice(0,index)+'.'+digits.slice(index));
}
function instrumentCurrency(instrumentId){try{return getInstrument(instrumentId).quoteCurrency;}catch{return null;}}
function graphProjection(graph){return {graphHash:strategyGraphHash(graph),outputNodeId:graph.outputNodeId,nodes:graph.nodes.map(node=>({id:node.id,type:node.type,label:node.label??node.id,position:{x:node.position.x,y:node.position.y}})),edges:graph.edges.map(edge=>({id:edge.id,from:{...edge.from},to:{...edge.to}}))};}
function policyFor(workspace,run,profileId){
 const manifests=list(workspace.mindManifests).filter(manifest=>manifest.id===run?.manifestId);
 if(manifests.length!==1)return {status:'MISSING_MANIFEST',graph:null,manifest:null};
 const manifest=manifests[0];
 try{
  if(manifest.scope?.profileId!==profileId||mindDocumentHash(manifest)!==run.manifestHash)return {status:'GRAPH_MISMATCH',graph:null,manifest:null};
  const graph=manifest.data?.strategyPlan?.graph;
  if(graph?.schemaVersion!==2)return {status:'UNAVAILABLE',graph:null,manifest};
  strategyGraphHash(graph);
  return {status:'VERIFIED',graph,manifest};
 }catch{return {status:'GRAPH_MISMATCH',graph:null,manifest:null};}
}
function emptyTrace(status,evaluation){return {status,graphHash:evaluation?.graphHash??null,asOf:stamp(evaluation?.asOf),nodeIds:[],edgeIds:[],skippedNodeIds:[],nodes:[]};}
function traceProjection(run,policy,asOf){
 const final=run.strategyEvaluation,evaluation=final?.graphEvaluation,empty=status=>emptyTrace(status,evaluation);
 if(!evaluation?.trace)return empty('UNAVAILABLE');
 if(!policy.graph)return empty(policy.status);
 if(evaluation.graphHash!==strategyGraphHash(policy.graph))return empty('GRAPH_MISMATCH');
 try{
  const state=run.rawRequest?.state,prepared=run.preparedStrategyEvaluation??state?.strategyEvaluation;
  // Bind the saved final trace to its original request; never evaluate a new graph here.
  if(!state||state.decisionAt!==run.decisionAt||state.manifestHash!==run.manifestHash||run.inputHash!==hashInputPackage(state)||!prepared)return empty('UNAVAILABLE');
  if(state.strategyEvaluation?.contractVersion==='vibe-connected-input-projection-v1'){
   if(state.strategyEvaluation.preparedOutputHash!==prepared.outputHash)return empty('INVALID_EVALUATION');
  }else if(hashInputPackage(prepared)!==hashInputPackage(state.strategyEvaluation))return empty('INVALID_EVALUATION');
  if(['planHash','manifestHash','asOf','accountSnapshotHash'].some(key=>prepared[key]!==final[key]))return empty('INVALID_EVALUATION');
  if(['modules','source','executionInputs','executionContext','trigger'].some(key=>hashInputPackage(prepared[key]??null)!==hashInputPackage(final[key]??null)))return empty('INVALID_EVALUATION');
  if(!iso(evaluation.asOf)||evaluation.asOf!==run.asOf||evaluation.asOf>run.decisionAt||run.decisionAt>asOf||final.manifestHash!==run.manifestHash||final.simulationResponsePolicy)return empty('INVALID_EVALUATION');
  const {outputHash,...body}=evaluation;
  if(hashInputPackage(body)!==outputHash||run.decision?.graphOutputHash!==outputHash||evaluation.output?.ready!==true||hashInputPackage(decisionFields(evaluation.output.decision))!==hashInputPackage(decisionFields(run.decision)))return empty('INVALID_EVALUATION');
  if(run.graphEvaluation&&hashInputPackage(run.graphEvaluation)!==hashInputPackage(evaluation))return empty('INVALID_EVALUATION');
  const known=new Map(policy.graph.nodes.map(node=>[node.id,node])),ids=evaluation.trace.map(row=>row?.nodeId),skipped=list(evaluation.skippedNodeIds);
  if(!Array.isArray(evaluation.trace)||ids.some(id=>!known.has(id))||new Set(ids).size!==ids.length||skipped.some(id=>!known.has(id)||ids.includes(id))||new Set(skipped).size!==skipped.length)return empty('INVALID_EVALUATION');
  const view=strategyExecutionView(policy.graph,{phase:'COMPLETED',evaluation}),order=new Map(ids.map((id,index)=>[id,index])),selected=new Set(view.edges);
  const edges=policy.graph.edges.filter(edge=>selected.has(edge.id)).sort((a,b)=>order.get(a.to.nodeId)-order.get(b.to.nodeId)||order.get(a.from.nodeId)-order.get(b.from.nodeId));
  return {status:'VERIFIED',graphHash:evaluation.graphHash,asOf:evaluation.asOf,evaluationHash:outputHash,nodeIds:ids,edgeIds:edges.map(edge=>edge.id),skippedNodeIds:[...skipped],nodes:evaluation.trace.map(row=>{
   const node=known.get(row.nodeId),out=row.output??{};
   return {id:row.nodeId,type:node.type,label:node.label??node.id,state:view.nodes[row.nodeId].state,inputHash:row.inputHash??null,outputHash:row.outputHash??null,selectedNodeId:known.has(row.selectedNodeId)?row.selectedNodeId:null,selectedPort:typeof row.selectedPort==='string'?row.selectedPort:null,selectedCaseId:typeof row.selectedCaseId==='string'?row.selectedCaseId:null,condition:scalar(row.condition),actual:node.type==='CONDITION'?scalar(out.actual):null,threshold:node.type==='CONDITION'?scalar(out.threshold):null,value:['CONDITION','BOOLEAN_LOGIC'].includes(node.type)?scalar(out.value):null,ready:out.ready===true,reasonCodes:list(out.reasonCodes).map(code).filter(Boolean)};
  })};
 }catch{return empty('INVALID_EVALUATION');}
}
function runsFor(workspace,profileId,currency,asOf){
 return list(workspace.mindRuns).filter(run=>run.profileId===profileId&&run.experimentType==='FORWARD_PAPER'&&run.mode!=='replay'&&run.executionMode!=='live'&&run.automation?.portfolioCycle?.phase!=='SCREENING'&&run.execution?.status!=='SCREENING_ONLY'&&instrumentCurrency(run.instrumentId)===currency&&['buy','sell','hold'].includes(run.decision?.action)&&iso(run.decisionAt)&&run.decisionAt<=asOf&&(!run.createdAt||iso(run.createdAt)&&run.createdAt<=asOf)&&(!run.decisionCompletedAt||iso(run.decisionCompletedAt)&&run.decisionCompletedAt<=asOf)&&(!run.provider?.answeredAt||iso(run.provider.answeredAt)&&run.provider.answeredAt<=asOf)).sort((a,b)=>(b.decisionCompletedAt??b.provider?.answeredAt??b.decisionAt).localeCompare(a.decisionCompletedAt??a.provider?.answeredAt??a.decisionAt)||String(b.id).localeCompare(String(a.id)));
}
function fillProjection(fill){
 return {kind:'STRATEGY_ORDER',executionMode:'paper',id:fill.id,runId:fill.runId,activationId:null,at:fill.at,state:'FILLED',market:fill.instrumentId.split(':').at(-1),action:fill.side,intent:intent(fill.intent),requestedQuantity:amount(fill.quantity),requestedGross:amount(fill.gross),filledQuantity:amount(fill.quantity),observedFilledQuantity:amount(fill.quantity),filledGross:amount(fill.gross),feesPaid:amount(fill.fee),realizedPnl:amount(fill.realizedPnl),quoteCurrency:fill.currency,evaluationHash:null,inputHash:null,graphHash:null,manifestHash:fill.manifestHash??null,errorCode:null,reconciledAt:fill.at,funding:false};
}
function ledgerProjection(account,currency,asOf,valid){
 const empty={status:'UNAVAILABLE',quoteCurrency:currency.currency,initialCapital:null,cash:null,availableCash:null,reservedCash:null,ownedCostBasis:null,realizedPnl:null,feesPaid:null,positions:[],equity:null,unrealizedPnl:null,valuationAsOf:null,ledgerAsOf:null,asOf,valuationKind:'UNAVAILABLE',hasPerformance:false};
 if(!valid)return {...empty,status:'INVALID_LEDGER',reasonCode:currency.reason?.code??'INVALID_PAPER_ACCOUNT'};
 const positions=account.positions.filter(position=>position.quantity>0),current=['CURRENT','CASH_ONLY','UNTRADED'].includes(currency.status),allocation=currency.allocation;
 return {...empty,status:'READY',initialCapital:amount(account.initialCash+(account.fundingLedger??[]).reduce((sum,f)=>sum+f.amount,0)),cash:amount(account.cash),availableCash:amount(account.cash),reservedCash:'0',ownedCostBasis:amount(positions.reduce((sum,position)=>sum+position.costBasis,0)),realizedPnl:amount(account.realizedPnl),feesPaid:amount(account.feesPaid),positions:positions.map(position=>({instrumentId:position.instrumentId,market:position.instrumentId.split(':').at(-1),asset:position.symbol??position.instrumentId.split(':').at(-1),quantity:amount(position.quantity),costBasis:amount(position.costBasis),marketValue:current?amount(allocation?.positions.find(p=>p.instrumentId===position.instrumentId)?.marketValue):null})),equity:current?amount(currency.equity):null,unrealizedPnl:current?amount(currency.equity-account.cash-positions.reduce((sum,position)=>sum+position.costBasis,0)):null,valuationAsOf:current?currency.asOf:null,ledgerAsOf:account.updatedAt,valuationKind:current?(positions.length?currency.source:'CASH_ONLY'):'MARK_STALE',hasPerformance:currency.hasPerformance,reasonCode:currency.reason?.code??null};
}

/** Pure PAPER projection. It reads saved evidence without evaluating or executing a strategy. */
export function paperMindActivity(workspace,profileId,{asOf,valuations=[]}={}){
 if(!workspace||typeof profileId!=='string'||!iso(asOf))throw new TypeError('마인드와 조회 시각을 확인하세요.');
 const profile=list(workspace.investmentProfiles).find(profile=>profile.id===profileId),accounts=list(workspace.mindPositions).filter(account=>account.kind==='PAPER_ACCOUNT'&&account.profileId===profileId&&account.executionScope!=='HISTORICAL_SIMULATION');
 const envelope={schemaVersion:1,contractVersion:PAPER_MIND_ACTIVITY_VERSION,executionMode:'paper',asOf,items:[],truncated:false};
 if(!profile||!accounts.length)return envelope;
 const filtered={...workspace,mindPositions:list(workspace.mindPositions).filter(account=>account.executionScope!=='HISTORICAL_SIMULATION')},card=buildMindCompanions({workspace:filtered,minds:[profile],executionMode:'paper',asOf,valuations}).cards[0];
 for(const currency of card.currencies){
  const owned=accounts.filter(account=>account.quoteCurrency===currency.currency),account=owned.length===1?owned[0]:null;
  const duplicate=account&&list(workspace.mindPositions).filter(value=>value.kind==='PAPER_ACCOUNT'&&value.id===account.id).length!==1;
  const valid=account&&!duplicate&&currency.status!=='DATA_REQUIRED'&&account.ledger.every(fill=>fill.accountId===account.id&&fill.profileId===profileId&&fill.currency===account.quoteCurrency);
  const runs=runsFor(workspace,profileId,currency.currency,asOf),last=runs[0],policy=policyFor(workspace,last,profileId),fills=valid?account.ledger.map(fillProjection):[],decisions=runs.slice(0,30).map(run=>{
   const frozen=policyFor(workspace,run,profileId),trace=traceProjection(run,frozen,asOf),verified=trace.status==='VERIFIED',fill=fills.find(fill=>fill.runId===run.id&&fill.manifestHash===run.manifestHash);
   if(fill&&verified){fill.evaluationHash=trace.evaluationHash;fill.inputHash=run.inputHash;fill.graphHash=trace.graphHash;}
   return {kind:'DECISION',executionMode:'paper',id:run.id,eventKind:'FORWARD_PAPER',at:run.decisionAt,recordedAt:run.decisionCompletedAt??run.provider?.answeredAt??run.createdAt??run.decisionAt,action:verified?run.decision.action:null,intent:verified?intent(run.decision.intent):null,targetWeight:verified&&finite(run.decision.targetWeight)?run.decision.targetWeight:null,orderAllowed:verified?run.strategyEvaluation.graphEvaluation.output.orderAllowed===true:null,trace,order:fill??null,executionStatus:code(run.execution?.status),reasonCodes:list(run.risk?.reasons).map(reason=>code(reason?.code)).filter(Boolean)};
  });
  const subscription=list(workspace.mindSubscriptions).filter(s=>s.profileId===profileId&&s.accountId===account?.id).sort((a,b)=>String(b.updatedAt).localeCompare(String(a.updatedAt)))[0],window=normalizeOperationWindow(subscription??{}),windowState=subscription?.status==='ENABLED'?operationWindowState(window,asOf):null;
  const issue=card.automation.issue,state=windowState==='WAITING'?'WAITING_START':windowState==='ENDED'||subscription?.runtime?.stage==='PERIOD_ENDED'?'PERIOD_ENDED':issue?'MISSING_INPUT':last?.execution?.status==='FILLED'?'ORDER_FILLED':last?.decision?.action==='hold'?'HOLD':null,status=card.automation.requiresAttention||!valid?'ACTION_REQUIRED':card.automation.enabled?'ENABLED':card.automation.paused?'PAUSED':'PREPARED';
  envelope.items.push({activationId:null,executionMode:'paper',profileId,accountId:account?.id??null,status,config:window,createdAt:stamp(account?.createdAt),userConfirmedAt:null,marketIds:[...new Set([...runs.map(run=>run.instrumentId.split(':').at(-1)),...(valid?account.positions.map(position=>position.instrumentId.split(':').at(-1)):[])])],quoteCurrency:currency.currency,manifest:{id:last?.manifestId??null,hash:last?.manifestHash??null,graphHash:policy.graph?strategyGraphHash(policy.graph):null,version:policy.manifest?.data?.version??null,status:policy.status},graph:policy.graph?graphProjection(policy.graph):null,runtime:{state,lastEvaluationAt:stamp(last?.decisionCompletedAt??last?.decisionAt),updatedAt:stamp(card.sourceAsOf),errorCode:code(issue?.errorCode??issue?.code??(!valid?'INVALID_PAPER_ACCOUNT':null)),providerState:null,reasonCodes:decisions[0]?.reasonCodes??[]},pendingOrderCount:0,ledger:ledgerProjection(account,currency,asOf,valid),lastDecision:decisions[0]??null,recentActivity:[...decisions,...fills].sort((a,b)=>b.at.localeCompare(a.at)||String(b.id).localeCompare(String(a.id))).slice(0,30),funding:null});
  if(runs.length+fills.length>30)envelope.truncated=true;
 }
 return structuredClone(envelope);
}
