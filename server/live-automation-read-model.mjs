import {decodeLiveEventBody} from './live-event-body.mjs';
import {SUPPORTED_EXPERT_MODES} from '../dist/domain/adaptive-portfolio.mjs';
import {resolveRegimeModel,regimeChoices,regimeTargetMembers} from '../dist/domain/regime-program.mjs';
import {normalizeOperationWindow} from '../dist/domain/operation-window.mjs';
import {LIVE_DECISION_EVENT_KINDS as DECISIONS,LIVE_DECISION_EVENT_FILTER,LIVE_LEDGER_EVENT_FILTER} from './live-automation-store.mjs';
import {liveMindGame} from './mind-game-projection.mjs';
import {hashInputPackage} from '../dist/domain/workspace.mjs';
import {mindDocumentHash} from '../dist/domain/mind-manifest.mjs';
import {strategyGraphHash} from '../dist/domain/strategy-graph.mjs';
import {strategyExecutionView} from '../dist/domain/strategy-execution-view.mjs';
import {strategyTimeframeParameter} from '../dist/domain/strategy-parameters.mjs';
import {projectLiveInvestorPerformance} from './mind-investor-performance.mjs';

export const LIVE_AUTOMATION_ACTIVITY_VERSION='live-automation-activity-v1';
const SCALE=10n**18n,MAX_POLICIES=100,MAX_ACTIVITY=30;
const OPEN=['RESERVED','UNKNOWN','PENDING','PARTIALLY_FILLED','RECONCILIATION_REQUIRED','RESPONSE_REVIEW_REQUIRED'];
const EVENT_COLUMNS="id,kind,recorded_at,CASE WHEN json_extract(body,'$.contentEncoding')='CJI_EVENT_GZIP_UTF8_V1' THEN body ELSE json_object('programMember',json_extract(body,'$.programMember'),'snapshotAsOf',json_extract(body,'$.snapshotAsOf'),'inputHash',json_extract(body,'$.inputHash'),'policyRef',json_extract(body,'$.policyRef'),'evaluation',json_extract(body,'$.evaluation')) END AS body";
const INTENTS=new Set(['ENTRY','ADD','REDUCE','EXIT','STOP_LOSS','TAKE_PROFIT','CAMPAIGN_EXIT']);
const id=v=>typeof v==='string'&&/^[A-Za-z0-9_.:@-]{1,199}$/.test(v),stamp=v=>typeof v==='string'&&Number.isFinite(Date.parse(v))?v:null;
const code=v=>typeof v==='string'&&/^[A-Z][A-Z0-9_]{0,99}$/.test(v)?v:null;
const list=v=>Array.isArray(v)?v:[],parse=decodeLiveEventBody;
const check=(ok,reason,message,status=409)=>{if(!ok)throw Object.assign(new Error(message),{code:reason,status});};
const all=async(db,sql,...args)=>(await db.prepare(sql).bind(...args).all()).results??[];
const first=(db,sql,...args)=>db.prepare(sql).bind(...args).first();
function units(value){check(typeof value==='string'&&/^-?\d+(?:\.\d{1,18})?$/.test(value),'LIVE_ACTIVITY_LEDGER','저장된 실전 원장의 금액을 확인하세요.');const negative=value.startsWith('-'),[whole,fraction='']=(negative?value.slice(1):value).split('.');return (negative?-1n:1n)*(BigInt(whole)*SCALE+BigInt(fraction.padEnd(18,'0')));}
function decimal(value){const negative=value<0n;if(negative)value=-value;const fraction=(value%SCALE).toString().padStart(18,'0').replace(/0+$/,'');return (negative?'-':'')+(value/SCALE)+(fraction?'.'+fraction:'');}
function amount(value){try{return value===null||value===undefined?null:decimal(units(value));}catch{return null;}}
const scalar=v=>typeof v==='boolean'||typeof v==='number'&&Number.isFinite(v)?v:null;
function intent(value){return INTENTS.has(value?.code)?{code:value.code,nodeId:id(value.nodeId)?value.nodeId:null}:null;}
function graphProjection(graph){return {graphHash:strategyGraphHash(graph),timeframeParameter:strategyTimeframeParameter(graph),outputNodeId:graph.outputNodeId,nodes:graph.nodes.map(n=>({id:n.id,type:n.type,label:n.label??n.id,position:{x:n.position.x,y:n.position.y}})),edges:graph.edges.map(e=>({id:e.id,from:{nodeId:e.from.nodeId,port:e.from.port},to:{nodeId:e.to.nodeId,port:e.to.port}}))};}
function originalPolicy(a,manifest){
 const c=a.config;
 try{check(manifest&&manifest.id===c.manifestId&&manifest.scope?.profileId===c.profileId,'MISSING_MANIFEST','');check(mindDocumentHash(manifest)===c.manifestHash&&strategyGraphHash(manifest.data.strategyPlan.graph)===c.graphHash,'GRAPH_MISMATCH','');return {status:'VERIFIED',version:manifest.data.version,graph:manifest.data.strategyPlan.graph,config:c,reference:{id:c.manifestId,hash:c.manifestHash,graphHash:c.graphHash,version:manifest.data.version,status:'VERIFIED'}};}
 catch(error){return {status:error.code==='MISSING_MANIFEST'?'MISSING_MANIFEST':'GRAPH_MISMATCH',version:null,graph:null};}
}
function executionProjection(activation,policy,persisted,asOf){
 const pending=persisted.providerPending,node=policy.graph?.nodes.find(n=>n.id===pending?.nodeId);
 if(!pending||policy.status!=='VERIFIED'||!['JEV_QUESTION','VIBE'].includes(node?.type)||pending.graphHash!==activation.config.graphHash||!stamp(pending.startedAt)||Date.parse(pending.startedAt)>Date.parse(asOf))return null;
 const completed=new Set(list(pending.completedNodeIds).filter(id=>policy.graph.nodes.some(n=>n.id===id)));
 return {contractVersion:'mind-execution-observation-v1',graphHash:activation.config.graphHash,executionId:pending.callId,phase:activation.status==='ENABLED'&&!persisted.providerUnknown?'PREPARED':'EXTERNAL_OUTCOME_UNKNOWN',activeNodeId:pending.nodeId,startedAt:pending.startedAt,asOf:stamp(pending.snapshotAsOf),nodes:policy.graph.nodes.filter(n=>completed.has(n.id)||n.id===pending.nodeId).map(n=>({id:n.id,state:n.id===pending.nodeId?activation.status==='ENABLED'&&!persisted.providerUnknown?'waiting':'unknown':'done'})),edgeIds:[]};
}
function policyForEvent(row,policies){const b=parse(row.body),ref=b.policyRef;if(b.programMember){const tag=b.programMember;return policies.find(p=>p.member&&['programHash','targetHash','memberId','manifestHash','graphHash'].every(k=>p.member[k]===tag[k])&&p.config.manifestHash===ref?.manifestHash&&p.config.graphHash===ref?.graphHash)??{status:'GRAPH_MISMATCH',graph:null};}return policies.find(p=>p.graph&&strategyGraphHash(p.graph)===b.evaluation?.graphHash&&(!ref?.manifestHash||p.config?.manifestHash===ref.manifestHash))??(ref?.manifestHash?{status:'GRAPH_MISMATCH',graph:null}:policies[0]);}
function traceProjection(evaluation,policy){
 const empty=status=>({status,graphHash:evaluation?.graphHash??null,asOf:stamp(evaluation?.asOf),nodeIds:[],edgeIds:[],skippedNodeIds:[],nodes:[]});
 if(!evaluation?.trace)return empty('UNAVAILABLE');
 if(!Array.isArray(evaluation.trace)||evaluation.trace.some(row=>!row||typeof row!=='object'))return empty('INVALID_EVALUATION');
 if(!policy.graph)return empty(policy.status);
 if(evaluation.graphHash!==strategyGraphHash(policy.graph))return empty('GRAPH_MISMATCH');
 const {outputHash,...body}=evaluation;
 if(typeof outputHash!=='string'||hashInputPackage(body)!==outputHash)return empty('INVALID_EVALUATION');
 const known=new Map(policy.graph.nodes.map(n=>[n.id,n])),ids=evaluation.trace.map(r=>r.nodeId);
 if(ids.some(value=>!known.has(value))||new Set(ids).size!==ids.length)return empty('INVALID_EVALUATION');
 const view=strategyExecutionView(policy.graph,{phase:'COMPLETED',evaluation}),order=new Map(ids.map((value,i)=>[value,i]));
 const selected=new Set(view.edges),edges=policy.graph.edges.filter(e=>selected.has(e.id)).sort((a,b)=>order.get(a.to.nodeId)-order.get(b.to.nodeId)||order.get(a.from.nodeId)-order.get(b.from.nodeId));
 return {status:'VERIFIED',graphHash:evaluation.graphHash,asOf:stamp(evaluation.asOf),evaluationHash:outputHash,nodeIds:ids,edgeIds:edges.map(e=>e.id),skippedNodeIds:list(evaluation.skippedNodeIds).filter(value=>known.has(value)),nodes:evaluation.trace.map(row=>{
  const n=known.get(row.nodeId),out=row.output??{};return {id:row.nodeId,type:n.type,label:n.label??n.id,state:view.nodes[row.nodeId].state,...(n.type==='PORTFOLIO_ROUTER'?{learning:{horizon:/^\d+h$/.test(row.predictionHorizon??'')?row.predictionHorizon:null,experts:list(row.experts).filter(e=>SUPPORTED_EXPERT_MODES.includes(e.mode)&&[e.netLogReturn,e.allocation,e.effectiveSamples].every(Number.isFinite)).map(e=>({mode:e.mode,netLogReturn:e.netLogReturn,allocation:e.allocation,effectiveSamples:e.effectiveSamples}))}}:{}),inputHash:row.inputHash??null,outputHash:row.outputHash??null,selectedNodeId:known.has(row.selectedNodeId)?row.selectedNodeId:null,selectedPort:typeof row.selectedPort==='string'?row.selectedPort:null,selectedCaseId:typeof row.selectedCaseId==='string'?row.selectedCaseId:null,condition:scalar(row.condition),actual:n.type==='CONDITION'?scalar(out.actual):null,threshold:n.type==='CONDITION'?scalar(out.threshold):null,value:['CONDITION','BOOLEAN_LOGIC'].includes(n.type)?scalar(out.value):null,ready:out.ready===true,reasonCodes:list(out.reasonCodes).map(code).filter(Boolean)};
 })};
}
function orderProjection(row,asOf){
 const r=parse(row.body),request=r.request??{},plan=r.plan??{},order=r.order??{},at=stamp(r.startedAt??r.reservedAt??r.createdAt);
 if(!at||at>asOf||!['STRATEGY','FUNDING'].includes(r.purpose))return null;
 const purpose=r.purpose==='FUNDING'?'FUNDING':'STRATEGY_ORDER',applied=amount(row.applied_quantity??r.appliedQuantity),fee=amount(row.applied_fee??r.appliedFee),trades=list(order.trades);
 let gross=null,firstFillAt=null,lastFillAt=null,fills=[];try{if(trades.length&&units(applied)>0n&&new Set(trades.map(t=>t.id)).size===trades.length&&trades.every(t=>typeof t.id==='string'&&t.id&&units(t.volume)>0n)&&trades.reduce((sum,t)=>sum+units(t.volume),0n)===units(applied)){
  gross=decimal(trades.reduce((sum,t)=>sum+units(t.funds),0n));
  const times=trades.map(t=>stamp(t.createdAt)?new Date(t.createdAt).toISOString():null);
  if(times.every(time=>time&&time<=asOf)){
   // Only the exact reconciled quantity can supply chart execution prices.
   try{if(row.applied_quantity!==undefined&&(r.activationId??row.activation_id)===row.activation_id&&(!order.market||order.market===request.market)&&(!order.side||order.side===request.side)&&trades.every((t,index)=>id(t.id)&&units(t.price)>0n&&units(t.funds)>0n))fills=trades.map((t,index)=>({id:t.id,price:t.price,quantity:t.volume,gross:t.funds,at:times[index]}));}catch{}
   times.sort();firstFillAt=times[0];lastFillAt=times.at(-1);
  }
 }}catch{}
 return {kind:purpose,id:r.identifier,activationId:row.activation_id??r.activationId,at,state:row.state??r.state,market:request.market??plan.market??null,action:request.side==='bid'?'buy':request.side==='ask'?'sell':null,intent:purpose==='STRATEGY_ORDER'?intent(plan.signalEvidence?.intent):null,requestedQuantity:amount(request.volume),requestedGross:amount(plan.requestedGross),filledQuantity:applied,observedFilledQuantity:amount(order.executedVolume),filledGross:gross,firstFillAt,lastFillAt,fills,feesPaid:fee,realizedPnl:null,quoteCurrency:plan.quoteCurrency??request.market?.split('-')[0]??null,evaluationHash:plan.signalEvidence?.evaluationHash??null,inputHash:plan.signalEvidence?.inputHash??null,graphHash:plan.policyRef?.graphHash??null,evaluationGraphHash:plan.signalEvidence?.programMember?.graphHash??plan.policyRef?.graphHash??null,manifestHash:plan.policyRef?.manifestHash??null,errorCode:code(r.code),reconciledAt:stamp(r.reconciliation?.checkedAt),funding:purpose==='FUNDING'};
}
function decisionProjection(row,policy,asOf){
 if(!DECISIONS.includes(row.kind)||!stamp(row.recorded_at)||row.recorded_at>asOf)return null;
 const b=parse(row.body),ge=b.evaluation;if(stamp(b.snapshotAsOf??ge?.asOf)>asOf)return null;
 const trace=traceProjection(ge,policy),verified=trace.status==='VERIFIED',surge=policy.graph?.nodes.find(n=>n.type==='MODEL'&&n.config.family==='SURGE_PATH_FOREST'),selection=verified&&surge?ge.trace.find(n=>n.nodeId===surge.id)?.output.selection:null,portfolioDecision=selection?.ready?{action:ge.output.orderAllowed?selection.selected.kind==='ENTER'?'buy':'sell':'hold',targetWeight:1-ge.output.value.cashWeight}:null,d=verified?ge.output?.decision??portfolioDecision:null;
 return {policyConfig:policy.config,inputHash:b.inputHash,evaluationHash:ge?.outputHash,graphHash:policy.member?policy.config.graphHash:ge?.graphHash,dto:{...(policy.member?{programMember:policy.member}:{}),manifest:policy.reference??null,...((policy.historical||policy.member)&&policy.graph?{graph:graphProjection(policy.graph)}:{}),kind:'DECISION',id:row.id,eventKind:row.kind,at:stamp(b.snapshotAsOf??ge?.asOf)??row.recorded_at,recordedAt:row.recorded_at,action:['buy','sell','hold'].includes(d?.action)?d.action:null,intent:intent(d?.intent),targetWeight:typeof d?.targetWeight==='number'&&Number.isFinite(d.targetWeight)?d.targetWeight:null,orderAllowed:verified?ge.output?.orderAllowed===true:null,trace,order:null}};
}
function matchesOrder(event,order,activation){
 const c=event?.policyConfig??activation.config,d=event?.dto;
 return d?.trace.status==='VERIFIED'&&d.orderAllowed===true&&order.kind==='STRATEGY_ORDER'&&order.activationId===activation.id&&c.marketIds.includes(order.market)&&[order.evaluationHash,order.inputHash,order.graphHash,order.manifestHash].every(value=>/^[a-f0-9]{64}$/.test(value??''))&&order.action===d.action&&order.evaluationHash===event.evaluationHash&&order.inputHash===event.inputHash&&order.graphHash===event.graphHash&&order.graphHash===c.graphHash&&order.manifestHash===c.manifestHash&&d.at<=order.at&&d.recordedAt<=order.at;
}
const newest=(a,b)=>b.at.localeCompare(a.at)||String(b.id).localeCompare(String(a.id));
function ledgerProjection(a,account,asOf,ledgerAsOf,openOrders,pendingCount){
 const c=a.config,empty=status=>({status,quoteCurrency:c.quoteCurrency,initialCapital:amount(c.capitalLimit),cash:null,availableCash:null,reservedCash:null,ownedCostBasis:null,realizedPnl:null,feesPaid:null,positions:[],equity:null,unrealizedPnl:null,valuationAsOf:null,ledgerAsOf:stamp(ledgerAsOf),asOf});
 if(!account)return empty('UNAVAILABLE');
 if(a.funding&&a.funding.status!=='FILLED')return empty('FUNDING_PENDING');
 try{
  const owned=account.positions?.[a.id]??{},entries=Object.entries(owned),daily=Object.entries(account.daily??{}).filter(([key])=>key.startsWith(a.id+':')),realized=daily.reduce((sum,[,r])=>sum+units(r.realizedPnl),0n),fees=daily.reduce((sum,[,r])=>sum+units(r.feesPaid??'0'),0n),cost=entries.reduce((sum,[,p])=>sum+units(p.costBasis),0n),cash=units(a.capitalPrincipal??c.capitalLimit)+realized-cost;
  check(cash>=0n&&fees>=0n,'LIVE_ACTIVITY_LEDGER','');
  check(entries.every(([,p])=>units(p.quantity)>=0n&&units(p.costBasis)>=0n),'LIVE_ACTIVITY_LEDGER','');
  const positions=entries.filter(([,p])=>units(p.quantity)>0n).map(([asset,p])=>{const market=c.marketIds.find(m=>m.split('-')[1]===asset);check(market,'LIVE_ACTIVITY_LEDGER','');return {instrumentId:'crypto:upbit:'+market,market,asset,quantity:decimal(units(p.quantity)),costBasis:decimal(units(p.costBasis))};});
  const reserved=pendingCount===openOrders.length?openOrders.filter(r=>r.request?.side==='bid').reduce((sum,r)=>sum+units(r.plan.cashRequired),0n):null,allocationStatus=account.claims?(account.claims[a.id]?'ALLOCATED':'RELEASED'):'UNKNOWN';
  const cashOnly=!positions.length;
  return {...empty('READY'),cash:decimal(cash),availableCash:allocationStatus==='RELEASED'?'0':allocationStatus==='ALLOCATED'&&reserved!==null&&reserved<=cash?decimal(cash-reserved):null,reservedCash:reserved===null?null:decimal(reserved),ownedCostBasis:decimal(cost),realizedPnl:decimal(realized),feesPaid:decimal(fees),positions,equity:cashOnly?decimal(cash):null,unrealizedPnl:cashOnly?'0':null,valuationAsOf:cashOnly?stamp(ledgerAsOf??a.userConfirmedAt):null,valuationKind:cashOnly?'CASH_ONLY':'MARK_NOT_RECORDED',allocationStatus};
 }catch{return empty('INVALID_LEDGER');}
}

/** Pure allowlist projection. Stored records are never replayed or written. */
export function projectLiveAutomationActivity({activation,account=null,manifest=null,policyVersions=[],memberPolicies=[],eventRows=[],orderEventRows=[],orderRows=[],openOrderRows=[],fundingFeeRows=[],pendingCount=0,runtime=null,currentRuntime=null,ledgerAsOf=null,asOf}={}){
 const a=parse(activation.body??activation),c=a.config,policy=originalPolicy(a,manifest),seenOrders=new Set(),orders=orderRows.map(row=>orderProjection(row,asOf)).filter(order=>order&&order.activationId===a.id&&!seenOrders.has(order.id)&&seenOrders.add(order.id)).sort(newest).slice(0,MAX_ACTIVITY);
 const versions=policyVersions.map(v=>({...originalPolicy({...a,config:v.config},v.manifest),historical:true})),forRow=row=>policyForEvent(row,[policy,...versions,...memberPolicies]);
 const currentEvents=eventRows.map(row=>decisionProjection(row,forRow(row),asOf)).filter(Boolean).sort((a,b)=>b.dto.recordedAt.localeCompare(a.dto.recordedAt)),seenEvents=new Set(currentEvents.map(event=>event.dto.id)),olderEvents=orderEventRows.filter(row=>!seenEvents.has(row.id)&&seenEvents.add(row.id)).map(row=>decisionProjection(row,forRow(row),asOf)).filter(Boolean),allEvents=[...currentEvents,...olderEvents];
 for(const order of orders){
  const matching=allEvents.find(event=>matchesOrder(event,order,a));
  // A trade's own immutable decision remains inspectable even after newer HOLDs.
  order.decision=matching?{...matching.dto,order:null}:null;
 }
 const events=currentEvents.map(event=>({...event.dto,order:orders.find(order=>matchesOrder(event,order,a))??null}));
 const recentActivity=[...orders,...events.slice(0,Math.max(0,MAX_ACTIVITY-orders.length))].sort(newest);
 const persisted=runtime?parse(runtime.body??runtime):{},live=currentRuntime?.policies?.[a.id],runtimeState=live?.state??persisted.lastState??null,sourceAt=live?stamp(currentRuntime.lastTickAt):stamp(runtime?.updated_at),open=openOrderRows.map(row=>parse(row.body));
 const ledger=ledgerProjection(a,account,asOf,ledgerAsOf,open,pendingCount);let fundingFees=null;if(fundingFeeRows.length>0&&fundingFeeRows.length<=100)try{fundingFees=decimal(fundingFeeRows.reduce((sum,row)=>sum+units(row.applied_fee),0n));}catch{}
 return {activationId:a.id,profileId:c.profileId,accountId:c.accountId,executionMode:'live',config:normalizeOperationWindow(c),status:activation.status??a.status,createdAt:stamp(a.createdAt),userConfirmedAt:stamp(a.userConfirmedAt),marketIds:[...c.marketIds],quoteCurrency:c.quoteCurrency,manifest:{id:c.manifestId,hash:c.manifestHash,graphHash:c.graphHash,version:policy.version,status:policy.status},graph:policy.graph?graphProjection(policy.graph):null,runtime:{state:code(runtimeState),...(persisted.program?{program:structuredClone(persisted.program)}:{}),...(currentRuntime?.status==='DISABLED'?{hostStatus:'DISABLED'}:{}),lastEvaluationAt:stamp(persisted.lastEvaluationAt),updatedAt:sourceAt,errorCode:code(live?.code??persisted.lastErrorCode??persisted.providerUnknown?.code),providerState:code(persisted.providerUnknown?.status??(persisted.providerPending?'IN_FLIGHT':null)),execution:executionProjection({...a,status:currentRuntime?.status==='DISABLED'?'STOPPED':activation.status??a.status},policy,persisted,asOf)},pendingOrderCount:pendingCount,ledger,lastDecision:events[0]??null,recentActivity,funding:a.funding?{status:a.funding.status,market:a.funding.market,approvedVolume:amount(a.funding.volume),executedVolume:amount(a.funding.executedVolume),netQuote:amount(a.funding.netQuote),feesPaid:fundingFees,completedAt:stamp(a.funding.completedAt),profitIncluded:false}:null};
}

async function readProgramMemberPolicies(db,owner,activation,manifest){
 const binding=manifest?.data?.strategySettings?.strategyProgram;if(!binding||originalPolicy(activation,manifest).status!=='VERIFIED')return [];
 const row=await first(db,"SELECT payload FROM workspace_objects WHERE owner_id=? AND kind='regimePrograms' AND object_id=?",owner,binding.programId);if(!row)return [];const program=parse(row.payload);if(program.contentHash!==binding.programHash)return [];
 const resources=[];for(const pin of new Map(Object.values(program.routes).map(p=>[p.id,p])).values()){const row=await first(db,'SELECT payload FROM workspace_objects WHERE owner_id=? AND kind=? AND object_id=?',owner,pin.kind==='mind-preset'?'mindPresets':'strategyModels',pin.id);if(row)resources.push(parse(row.payload));}
 try{const targets=[...new Set(regimeChoices(program).map(c=>resolveRegimeModel(program,c.id,resources)))];return targets.flatMap(target=>regimeTargetMembers(target).map(m=>{const graph=m.manifest.data.strategyPlan.graph,member={programHash:program.contentHash,targetHash:target.contentHash,memberId:m.id,manifestHash:mindDocumentHash(m.manifest),graphHash:strategyGraphHash(graph)};return {status:'VERIFIED',graph,member,config:activation.config,reference:{id:m.manifest.id,hash:member.manifestHash,graphHash:member.graphHash,version:m.manifest.data.version,status:'VERIFIED'}};}));}catch{return [];}
}
/** SELECT-only route source: no vault, market/provider, initialization, or runner calls. */
export async function readLiveAutomationActivity({db,owner,profileId=null,activationId=null,asOf=new Date().toISOString(),currentRuntime=null}={}){
 check(typeof owner==='string'&&owner.length>0&&owner.length<=200,'UNAUTHORIZED','로그인이 필요합니다.',401);check(db?.prepare,'STORAGE_REQUIRED','저장된 운용 기록을 확인하세요.',503);check(stamp(asOf),'LIVE_ACTIVITY_TIME','조회 시각을 확인하세요.',400);
 if(profileId==='all')profileId=null;check(profileId===null||id(profileId),'AUTOMATION_MIND','마인드를 선택하세요.',400);check(activationId===null||id(activationId),'AUTOMATION_ID','운용을 선택하세요.',400);
 const tables=new Set((await all(db,"SELECT name FROM sqlite_master WHERE type='table' AND name IN ('live_automation_activations','live_automation_accounts','live_automation_orders','live_automation_events','live_event_runtime','workspace_objects','live_automation_fills')")).map(row=>row.name));
 if(!tables.has('live_automation_activations'))return {schemaVersion:1,contractVersion:LIVE_AUTOMATION_ACTIVITY_VERSION,executionMode:'live',asOf,items:[],truncated:false};
 const filter=(profileId?' AND json_extract(body,\'$.config.profileId\')=?':'')+(activationId?' AND id=?':''),args=[owner,...(profileId?[profileId]:[]),...(activationId?[activationId]:[])];
 for(let retry=0;retry<2;retry++){
  const rows=await all(db,"SELECT id,account_id,status,revision,body FROM live_automation_activations WHERE owner_id=?"+filter+" ORDER BY CASE WHEN status='ENABLED' THEN 0 ELSE 1 END,json_extract(body,'$.userConfirmedAt') DESC,rowid DESC LIMIT ?",...args,MAX_POLICIES+1),truncated=rows.length>MAX_POLICIES,items=[],fences=[];
  if(activationId)check(rows.length===1,'LIVE_ACTIVATION_NOT_FOUND','운용 기록을 찾을 수 없습니다.',404);
  for(const row of rows.slice(0,MAX_POLICIES)){
   const a=parse(row.body),ar=tables.has('live_automation_accounts')?await first(db,'SELECT revision,body FROM live_automation_accounts WHERE owner_id=? AND account_id=?',owner,row.account_id):null,manifestRow=tables.has('workspace_objects')?await first(db,"SELECT payload FROM workspace_objects WHERE owner_id=? AND kind='mindManifests' AND object_id=?",owner,a.config.manifestId):null;
   const eventRows=tables.has('live_automation_events')?await all(db,'SELECT '+EVENT_COLUMNS+' FROM live_automation_events WHERE owner_id=? AND activation_id=? AND '+LIVE_DECISION_EVENT_FILTER+' AND recorded_at<=? ORDER BY recorded_at DESC,rowid DESC LIMIT ?',owner,row.id,asOf,MAX_ACTIVITY):[];
   const orderRows=tables.has('live_automation_orders')?await all(db,"SELECT activation_id,state,applied_quantity,applied_fee,body FROM live_automation_orders WHERE owner_id=? AND activation_id=? AND json_extract(body,'$.purpose') IN ('STRATEGY','FUNDING') AND COALESCE(json_extract(body,'$.startedAt'),json_extract(body,'$.reservedAt'),json_extract(body,'$.createdAt'))<=? ORDER BY rowid DESC LIMIT ?",owner,row.id,asOf,MAX_ACTIVITY):[];
   const policyVersions=[];
   if(a.strategyRevision&&tables.has('workspace_objects')){
    const changes=await all(db,"SELECT body FROM live_automation_events WHERE owner_id=? AND activation_id=? AND kind='STRATEGY_UPDATE_APPLIED' AND recorded_at<=? ORDER BY rowid DESC LIMIT ?",owner,row.id,asOf,MAX_ACTIVITY);
    const refs=[...eventRows.map(e=>parse(e.body).policyRef),...orderRows.map(o=>parse(o.body).plan?.policyRef),...changes.map(e=>parse(e.body).previousConfig)].filter(ref=>id(ref?.manifestId)&&/^[a-f0-9]{64}$/.test(ref.manifestHash??'')&&/^[a-f0-9]{64}$/.test(ref.graphHash??'')),pins=[...new Map(refs.map(ref=>[ref.manifestId,ref])).values()].filter(ref=>ref.manifestId!==a.config.manifestId);
    if(pins.length){const originals=await all(db,"SELECT object_id,payload FROM workspace_objects WHERE owner_id=? AND kind='mindManifests' AND object_id IN ("+pins.map(()=>'?').join(',')+")",owner,...pins.map(p=>p.manifestId));for(const pin of pins){const original=originals.find(m=>m.object_id===pin.manifestId);if(original)policyVersions.push({config:{...a.config,manifestId:pin.manifestId,manifestHash:pin.manifestHash,graphHash:pin.graphHash},manifest:parse(original.payload)});}}
   }
   const memberPolicies=await readProgramMemberPolicies(db,owner,a,manifestRow?parse(manifestRow.payload):null),orderEventRows=[],policy=originalPolicy(a,manifestRow?parse(manifestRow.payload):null),versions=[policy,...policyVersions.map(v=>originalPolicy({...a,config:v.config},v.manifest)),...memberPolicies],recent=eventRows.map(event=>decisionProjection(event,policyForEvent(event,versions),asOf)).filter(Boolean);
   if(tables.has('live_automation_events')&&policy.status==='VERIFIED')for(const orderRow of orderRows){
    const order=orderProjection(orderRow,asOf);
    if(!order||order.kind!=='STRATEGY_ORDER'||order.activationId!==a.id||!versions.some(p=>p.status==='VERIFIED'&&p.config.graphHash===order.graphHash&&p.config.manifestHash===order.manifestHash)||![order.evaluationHash,order.inputHash].every(value=>/^[a-f0-9]{64}$/.test(value??''))||recent.some(event=>matchesOrder(event,order,a)))continue;
    const event=await first(db,'SELECT '+EVENT_COLUMNS+" FROM live_automation_events WHERE owner_id=? AND activation_id=? AND "+LIVE_DECISION_EVENT_FILTER+" AND recorded_at<=? AND json_extract(body,'$.evaluation.outputHash')=? AND json_extract(body,'$.inputHash')=? AND json_extract(body,'$.evaluation.graphHash')=? ORDER BY recorded_at DESC,rowid DESC LIMIT 1",owner,row.id,order.at,order.evaluationHash,order.inputHash,order.evaluationGraphHash);
    if(event)orderEventRows.push(event);
   }
   const openOrderRows=tables.has('live_automation_orders')?await all(db,'SELECT body FROM live_automation_orders WHERE owner_id=? AND activation_id=? AND state IN (?,?,?,?,?,?) ORDER BY rowid DESC LIMIT ?',owner,row.id,...OPEN,MAX_ACTIVITY+1):[];
   const count=tables.has('live_automation_orders')?await first(db,'SELECT COUNT(*) AS n FROM live_automation_orders WHERE owner_id=? AND activation_id=? AND state IN (?,?,?,?,?,?)',owner,row.id,...OPEN):{n:0};
   const fundingFeeRows=a.funding&&tables.has('live_automation_orders')?await all(db,"SELECT applied_fee FROM live_automation_orders WHERE owner_id=? AND activation_id=? AND json_extract(body,'$.purpose')='FUNDING' ORDER BY rowid DESC LIMIT 101",owner,row.id):[];
   const runtime=tables.has('live_event_runtime')?await first(db,'SELECT updated_at,body FROM live_event_runtime WHERE owner_id=? AND activation_id=?',owner,row.id):null;
   const receipt=tables.has('live_automation_events')?await first(db,'SELECT recorded_at FROM live_automation_events WHERE owner_id=? AND activation_id=? AND '+LIVE_LEDGER_EVENT_FILTER+' ORDER BY recorded_at DESC,rowid DESC LIMIT 1',owner,row.id):null;
   const projected=projectLiveAutomationActivity({activation:row,account:ar?parse(ar.body):null,manifest:manifestRow?parse(manifestRow.payload):null,policyVersions,memberPolicies,eventRows,orderEventRows,orderRows,openOrderRows,fundingFeeRows,pendingCount:count.n,runtime,currentRuntime,ledgerAsOf:receipt?.recorded_at??a.userConfirmedAt,asOf});
   if(tables.has('live_automation_fills')&&projected.ledger.status==='READY'){
    const fillRows=await all(db,'SELECT f.rowid AS fill_sequence,f.body AS trade_body,o.body AS order_body,o.applied_fee FROM live_automation_fills f JOIN live_automation_orders o ON o.owner_id=f.owner_id AND o.account_id=f.account_id AND o.identifier=f.identifier WHERE f.owner_id=? AND o.activation_id=?',owner,row.id);
    const saved=tables.has('live_automation_events')?await first(db,"SELECT body FROM live_automation_events WHERE owner_id=? AND activation_id=? AND kind='SIGNAL_SNAPSHOT' AND recorded_at<=? ORDER BY recorded_at DESC,rowid DESC LIMIT 1",owner,row.id,asOf):null;
    projected.gamification=liveMindGame({activation:a,account:ar?parse(ar.body):{},fillRows,ledger:projected.ledger,snapshot:saved?parse(saved.body):null,asOf});
    const capitalRows=tables.has('live_automation_events')?await all(db,"SELECT id,body FROM live_automation_events WHERE owner_id=? AND activation_id=? AND kind='CAPITAL_UPDATED' AND recorded_at<=? ORDER BY recorded_at,rowid",owner,row.id,asOf):[];
    projected.investorMetrics=projectLiveInvestorPerformance({activation:a,account:ar?parse(ar.body):{},ledger:projected.ledger,fillRows,capitalRows,gamification:projected.gamification,asOf});
   }
   if(projected.investorMetrics)projected.investorMetrics.sourceRevision={activation:row.revision,account:ar?.revision??null};
   items.push(projected);fences.push({id:row.id,revision:row.revision,accountId:row.account_id,accountRevision:ar?.revision??null,sourceAvailableAt:receipt?.recorded_at??a.userConfirmedAt});
  }
  let stable=true;for(const f of fences){const a=await first(db,'SELECT revision FROM live_automation_activations WHERE owner_id=? AND id=?',owner,f.id),account=tables.has('live_automation_accounts')?await first(db,'SELECT revision FROM live_automation_accounts WHERE owner_id=? AND account_id=?',owner,f.accountId):null;if(a?.revision!==f.revision||(account?.revision??null)!==f.accountRevision||f.sourceAvailableAt>asOf){stable=false;break;}}
  if(stable)return {schemaVersion:1,contractVersion:LIVE_AUTOMATION_ACTIVITY_VERSION,executionMode:'live',asOf,items,truncated};
 }
 check(false,'LIVE_ACTIVITY_UPDATING','운용 기록을 갱신하고 있습니다. 잠시 뒤 다시 확인하세요.',409);
}
