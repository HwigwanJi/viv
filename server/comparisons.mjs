import dataset from '../dist/data/btc-4h.json' with { type:'json' };
import manifest from '../dist/data/btc-source-manifest.json' with { type:'json' };
import { precomputeFeatures } from '../dist/trading/model.mjs';
import { dispatchWorkspaceAction, validateWorkspace, hashInputPackage, stableStringify, buildDeploymentContext } from '../dist/domain/workspace.mjs';
import { validateComparison, validateComparisons, validateComparisonSourceContext, hashComparisonSourceContext, COMPARISON_INTERVAL_MS as BAR, COMPARISON_SETTLE_DELAY_MS as SETTLE } from '../dist/domain/comparisons.mjs';
import {approvedResearchRules} from '../dist/domain/research.mjs';
import {assertComparisonEvidenceCurrent} from './execution.mjs';
import { acquireClaim, assertClaim, completeClaim, releaseClaim } from './claims.mjs';
import {latestClosedAsOf} from './market.mjs';
import {loadPublicMarket,validatePublicMarketSnapshot,configuredMarketProvider} from './market-providers.mjs';
import {readOperationalWorkspace} from './repository.mjs';

export { validateComparison, validateComparisons };
export class ComparisonError extends Error { constructor(code,message,status=409) { super(message); this.name='ComparisonError'; this.code=code; this.status=status; } }
const clone=v=>structuredClone(v), iso=v=>typeof v==='string'&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString()===v;
const identifier=v=>typeof v==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,199}$/.test(v), plain=v=>!!v&&typeof v==='object'&&!Array.isArray(v)&&[Object.prototype,null].includes(Object.getPrototypeOf(v));
const check=(v,code,message,status)=>{if(!v)throw new ComparisonError(code,message,status);};
const fields=(v,allowed,required=[])=>{stableStringify(v);check(plain(v)&&Object.keys(v).every(k=>allowed.includes(k))&&required.every(k=>Object.hasOwn(v,k)),'INVALID_COMPARISON_INPUT','비교 실험 입력 항목을 확인하세요.',400);};
const withoutGroups=w=>{const next=clone(w);delete next.comparisons;return next;};
function checked(w) { const errors=validateWorkspace(withoutGroups(w));check(!errors.length,'INVALID_WORKSPACE',errors[0]?.message??'운용 기록을 확인하세요.',400); const groups=validateComparisons(w.comparisons??[],w);check(!groups.length,'INVALID_COMPARISONS',groups[0]?.message??'비교 실험을 확인하세요.',400); }
const nowAt=options=>{const now=options.now??new Date().toISOString();check(iso(now)&&identifier(options.actorId),'INVALID_COMPARISON_CONTEXT','실행 주체와 시각을 확인하세요.',400);return now;};
const fingerprint=(type,body,actorId)=>hashInputPackage({type,payload:Object.fromEntries(Object.entries(body).filter(([k])=>!['expectedRevision','idempotencyKey'].includes(k))),actorId});
function repeated(workspace,body,type,actorId) {check(identifier(body.idempotencyKey)&&Number.isSafeInteger(body.expectedRevision)&&body.expectedRevision>=0,'INVALID_COMPARISON_INPUT','요청 ID와 저장 버전을 확인하세요.',400);const fp=fingerprint(type,body,actorId),r=workspace.commandReceipts.find(r=>r.key===body.idempotencyKey);if(r){check(r.type===type&&r.fingerprint===fp,'IDEMPOTENCY_CONFLICT','같은 비교 요청 ID의 내용이 변경되었습니다.');return {workspace,result:clone(r.result),idempotent:true};}check(body.expectedRevision===workspace.revision,'REVISION_CONFLICT','최신 비교 실험 상태를 확인하세요.');return null;}
function normalize(previous,next,{type,body,actorId,now,result,groups}) {
  const revision=previous.revision+1;next.revision=revision;next.updatedAt=now;
  next.activityEvents.slice(previous.activityEvents.length).forEach(e=>e.aggregateVersion=revision);
  next.commandReceipts=[...clone(previous.commandReceipts),{id:'comparison-receipt-'+crypto.randomUUID(),key:body.idempotencyKey,type,fingerprint:fingerprint(type,body,actorId),revision,createdAt:now,result:clone(result)}];
  next.comparisons=clone(groups);checked(next);return {workspace:next,result:clone(result),idempotent:false};
}
function domain(workspace,type,payload,now,actorId) { return dispatchWorkspaceAction(workspace,{type,payload,idempotencyKey:'comparison-internal-'+crypto.randomUUID(),expectedRevision:workspace.revision},{now,actorId}); }
let firstReadyAt;
export function createComparison(workspace,body,options={}) {
  checked(workspace);fields(body,['name','profileIds','strategyVersionId','riskPresetVersionId','initialCash','feeBps','slippageBps','experimentType','startAt','expectedRevision','idempotencyKey'],['name','profileIds','strategyVersionId','riskPresetVersionId','initialCash','feeBps','slippageBps','experimentType','expectedRevision','idempotencyKey']);
  const now=nowAt(options),actorId=options.actorId,replay=repeated(workspace,body,'comparison.create',actorId);if(replay)return replay;
  check(typeof body.name==='string'&&body.name.trim()&&body.name.length<=120&&Array.isArray(body.profileIds)&&body.profileIds.length>=1&&body.profileIds.length<=3&&new Set(body.profileIds).size===body.profileIds.length&&body.profileIds.every(identifier),'INVALID_COMPARISON_INPUT','이름과 서로 다른 투자 프로필 1~3개를 선택하세요.',400);
  check(['FORWARD_PAPER','HISTORICAL_FUNCTIONAL_REPLAY'].includes(body.experimentType)&&[body.initialCash,body.feeBps,body.slippageBps].every(Number.isFinite)&&body.initialCash>0&&body.initialCash<=1e12&&body.feeBps>=0&&body.feeBps<=1000&&body.slippageBps>=0&&body.slippageBps<=1000,'INVALID_COMPARISON_INPUT','모의 자금·비용·실험 유형을 확인하세요.',400);
  const forward=body.experimentType==='FORWARD_PAPER';if(!firstReadyAt&&!forward)firstReadyAt=precomputeFeatures(dataset).features.find((f,i)=>f.ready&&dataset.bars[i+1]?.[0]===dataset.bars[i][0]+BAR)?.asOf;
  const startAt=body.startAt??(forward?new Date((Math.floor(Date.parse(now)/BAR)+1)*BAR).toISOString():firstReadyAt);
  check(iso(startAt)&&Date.parse(startAt)%BAR===0&&(forward?Date.parse(startAt)>Date.parse(now):Date.parse(startAt)<=Date.parse(now)&&dataset.bars.some((b,i)=>b[0]+BAR===Date.parse(startAt)&&dataset.bars[i+1]?.[0]===b[0]+BAR)),'INVALID_COMPARISON_START','사용 가능한 확정 봉 시점을 선택하세요.',400);
  let next=withoutGroups(workspace);const id='comparison-'+crypto.randomUUID(),members=[],deployments=[];
  for(const profileId of body.profileIds){const profile=next.investmentProfiles.find(p=>p.id===profileId);check(profile,'COMPARISON_PROFILE_NOT_FOUND','투자 프로필을 찾을 수 없습니다.',404);
    const created=domain(next,'deployment.create',{name:(body.name.trim()+' · '+profile.name).slice(0,120),investmentProfileId:profileId,investmentProfileVersionId:profile.currentVersionId,memoryVersionId:profile.currentMemoryVersionId,strategyVersionId:body.strategyVersionId,riskPresetVersionId:body.riskPresetVersionId,initialCash:body.initialCash,accountNow:forward?now:startAt,experimentId:id,experimentType:body.experimentType,feeScheduleSnapshot:{feeBps:body.feeBps,slippageBps:body.slippageBps,source:'비교 실험 공통 모의 비용 가정',kind:'PAPER_ASSUMPTION',observedAt:now}},now,actorId);next=created.workspace;
    const d=created.result.deployment;members.push({profileId,profileVersionId:d.investmentProfileVersionId,memoryVersionId:d.memoryVersionId,deploymentId:d.id,accountId:d.accountId});deployments.push(d);
  }
  const commonFeeId=deployments[0].feeScheduleSnapshot.id;for(const d of next.deployments.filter(d=>members.some(m=>m.deploymentId===d.id)))d.feeScheduleSnapshot.id=commonFeeId;
  const group={schemaVersion:1,id,name:body.name.trim(),experimentId:id,experimentType:body.experimentType,status:'paused',createdAt:now,updatedAt:now,createdBy:actorId,startAt,cursorAt:startAt,conditions:{strategyVersionId:body.strategyVersionId,riskPresetVersionId:body.riskPresetVersionId,initialCash:body.initialCash,feeBps:body.feeBps,slippageBps:body.slippageBps,feeScheduleSnapshotId:commonFeeId,settleDelayMs:SETTLE,sourceHash:forward?null:manifest.datasetSha256},members,round:null,completedBars:0,lastCompletedAt:null,pauseRequestedAt:null,history:[]};
  next=domain(next,'audit.append',{eventType:'COMPARISON_CREATED',resourceType:'comparison',resourceId:id,payload:{deploymentIds:members.map(m=>m.deploymentId),startAt,experimentType:body.experimentType}},now,actorId).workspace;
  return normalize(workspace,next,{type:'comparison.create',body,actorId,now,result:{comparison:group,deployments:next.deployments.filter(d=>members.some(m=>m.deploymentId===d.id))},groups:[...(workspace.comparisons??[]),group]});
}
export function setComparisonStatus(workspace,body,options={}) {
  checked(workspace);fields(body,['comparisonId','status','expectedRevision','idempotencyKey'],['comparisonId','status','expectedRevision','idempotencyKey']);const now=nowAt(options),actorId=options.actorId,replay=repeated(workspace,body,'comparison.status',actorId);if(replay)return replay;
  check(['paused','running'].includes(body.status),'INVALID_COMPARISON_STATUS','일시중지 또는 재개를 선택하세요.',400);const groups=clone(workspace.comparisons??[]),group=groups.find(g=>g.id===body.comparisonId);check(group&&group.createdBy===actorId,'COMPARISON_NOT_FOUND','비교 실험을 찾을 수 없습니다.',404);
  let next=withoutGroups(workspace);for(const member of group.members)next=domain(next,'deployment.status',{deploymentId:member.deploymentId,status:body.status},now,actorId).workspace;
  group.status=body.status;group.pauseRequestedAt=body.status==='paused'?now:null;group.updatedAt=now;if(group.round)group.round.lease=null;
  next=domain(next,'audit.append',{eventType:body.status==='paused'?'COMPARISON_PAUSED':'COMPARISON_RESUMED',resourceType:'comparison',resourceId:group.id,payload:{status:body.status}},now,actorId).workspace;
  return normalize(workspace,next,{type:'comparison.status',body,actorId,now,result:{comparison:group},groups});
}

const terminal=m=>['COMPLETED','SKIPPED'].includes(m.stage);
const effectKeys=(group,asOf,deploymentId,generation)=>{const stem='cmp-'+hashInputPackage({group:group.id,asOf,deploymentId,generation});return {evaluateKey:stem+'-evaluate',executeKey:stem+'-execute'};};
function pinned(workspace,group){for(const m of group.members){const d=workspace.deployments.find(d=>d.id===m.deploymentId);check(d&&d.accountId===m.accountId&&d.investmentProfileId===m.profileId&&d.investmentProfileVersionId===m.profileVersionId&&d.memoryVersionId===m.memoryVersionId&&d.strategyVersionId===group.conditions.strategyVersionId&&d.riskPresetVersionId===group.conditions.riskPresetVersionId&&d.experimentId===group.experimentId&&d.experimentType===group.experimentType&&!d.sharedAccountId&&d.feeScheduleSnapshot.id===group.conditions.feeScheduleSnapshotId&&d.feeScheduleSnapshot.feeBps===group.conditions.feeBps&&d.feeScheduleSnapshot.slippageBps===group.conditions.slippageBps,'COMPARISON_CONDITIONS_CHANGED','비교 구성원의 고정 버전·독립 계좌·비용을 확인하세요.');}}
function envelope(workspace,comparisonId,ownerId){check(workspace,'COMPARISON_NOT_FOUND','사용자 운용 기록을 찾을 수 없습니다.',404);checked(workspace);const group=workspace.comparisons?.find(g=>g.id===comparisonId);check(group&&group.createdBy===ownerId,'COMPARISON_NOT_FOUND','비교 실험을 찾을 수 없습니다.',404);pinned(workspace,group);return {workspace,group};}
function recoverMember(workspace,group,member){
  const receipt=workspace.commandReceipts.find(r=>r.key===member.evaluateKey),record=receipt?.result?.decisionRecord??workspace.decisionRecords.find(r=>r.id===member.decisionId);
  if(!record)return;
  check(record.deploymentId===member.deploymentId&&record.inputPackage?.asOf===group.round.asOf&&record.inputPackage.sourceHash===group.round.sourceHash,'COMPARISON_EFFECT_SCOPE','비교 봉과 보존된 선택 결과를 대조하세요.');member.decisionId=record.id;
  const fills=workspace.accounts.find(a=>a.id===group.members.find(m=>m.deploymentId===member.deploymentId).accountId).ledger.filter(f=>f.decisionId===record.id);
  if(fills.length){member.stage='COMPLETED';member.outcome='TRADE_FILLED';member.executionIds=fills.map(f=>f.id);member.error=null;return;}
  if(record.decisionStatus==='FAILED'){member.stage='FAILED';member.error={code:'DECISION_REQUEST_FAILED',message:'선택 요청을 다시 실행하세요.'};return;}
  if(record.outcomeType!=='TRADE_PROPOSED'||record.decisionStatus!=='READY'){member.stage='COMPLETED';member.outcome=record.outcomeType;member.error=null;return;}
  if(!terminal(member)&&member.stage!=='FAILED')member.stage='EVALUATED';
}
const pick=(value,fields)=>Object.fromEntries(fields.map(key=>[key,clone(value[key])]));
function researchEvidence(workspace,member,knowledgeAsOf){
  if(!workspace.research)return {approvedResearchRules:[],researchSnapshot:null};
  const research=workspace.research,scopes=['shared','profile:'+member.profileId,'deployment:'+member.deploymentId];
  const rules=approvedResearchRules(research,knowledgeAsOf,{scopes});
  if(!rules.length)return {approvedResearchRules:[],researchSnapshot:null};
  const versions=rules.map(rule=>research.rules.find(r=>r.id===rule.id&&r.version===rule.version));
  const contexts=[...new Map(versions.map(rule=>{const context=research.contexts.find(c=>c.id===rule.contextId&&c.version===rule.contextVersion);return [context.id+'@'+context.version,context];})).values()];
  const sources=[...new Map(contexts.flatMap(c=>c.blockRefs).map(ref=>{const source=research.sources.find(s=>s.id===ref.sourceId&&s.version===ref.sourceVersion);return [source.id+'@'+source.version,source];})).values()];
  return {approvedResearchRules:rules,researchSnapshot:{asOf:knowledgeAsOf,referenceMode:'IMMUTABLE_REFERENCES_V1',sources:sources.map(s=>pick(s,['id','version','sha256','recordHash','availableAt','scope'])),contexts:contexts.map(c=>pick(c,['id','version','recordHash','scope','availableAt','blockRefs','sourceReviewIds'])),rules:versions.map(r=>pick(r,['id','version','recordHash','contextId','contextVersion','contextHash','scope','approvedAt','availableAt']))}};
}
/** Freeze approved inputs and immutable provenance references, never raw parser data. */
export function buildComparisonSourceContext(workspace,group,knowledgeAsOf,contextBuiltAt){
  const first=group.members[0],context=buildDeploymentContext(workspace,{deploymentId:first.deploymentId,asOf:group.cursorAt,notes:workspace.knowledge,knowledgeAsOf,contextBuiltAt,policyMode:group.experimentType==='HISTORICAL_FUNCTIONAL_REPLAY'?'retrospective':'strict'});
  const value={schemaVersion:2,knowledgeAsOf,knowledge:workspace.knowledge?{schemaVersion:1,items:context.approvedNotes.map(n=>({...clone(n),revisions:[]}))}:null,research:null,members:group.members.map(member=>({deploymentId:member.deploymentId,investmentProfileId:member.profileId,...researchEvidence(workspace,member,knowledgeAsOf)}))};
  value.hash=hashComparisonSourceContext(value);
  check(!validateComparisonSourceContext(value).length,'COMPARISON_SOURCE_CONTEXT_LIMIT','이번 봉에 사용할 승인 근거와 참조가 저장 한도를 초과했습니다.',400);
  return value;
}
function assertSourceCurrent(workspace,group,deploymentId,now){
  const source=group.round.sourceContext;check(source,'SOURCE_CONTEXT_UNAVAILABLE','이 비교 봉의 승인 자료 사본을 복원할 수 없습니다.');
  const frozen=clone(workspace);if(source.knowledge===null)delete frozen.knowledge;else frozen.knowledge=clone(source.knowledge);if(source.research===null)delete frozen.research;else frozen.research=clone(source.research);
  const member=group.members.find(m=>m.deploymentId===deploymentId),retrospective=group.experimentType==='HISTORICAL_FUNCTIONAL_REPLAY';
  const context=buildDeploymentContext(frozen,{deploymentId,asOf:group.round.asOf,notes:frozen.knowledge,knowledgeAsOf:source.knowledgeAsOf,contextBuiltAt:now,policyMode:retrospective?'retrospective':'strict'});
  context.approvedResearchRules=source.schemaVersion===2?source.members.find(m=>m.deploymentId===deploymentId).approvedResearchRules:source.research?approvedResearchRules(source.research,source.knowledgeAsOf,{scopes:['shared','profile:'+member.profileId,'deployment:'+deploymentId]}):[];
  assertComparisonEvidenceCurrent(workspace,context,now);
}
function finish(group,workspace,now){const r=group.round,observations=group.members.map(m=>{const a=workspace.accounts.find(a=>a.id===m.accountId),record=workspace.decisionRecords.find(d=>d.id===r.members.find(c=>c.deploymentId===m.deploymentId).decisionId),p=record?.inputPackage.marketSnapshot?.features?.close??a.ledger.at(-1)?.referencePrice??0;return {deploymentId:m.deploymentId,cash:a.cash,btcQuantity:a.btcQuantity,equity:a.cash+a.btcQuantity*p,feesPaid:a.feesPaid,markPrice:p,asOf:a.asOf};});const status=r.members.every(m=>m.stage==='COMPLETED')?'COMPLETED':r.members.every(m=>m.stage==='SKIPPED')?'SKIPPED':'PARTIAL';group.history.push({id:r.id,asOf:r.asOf,status,sourceHash:r.sourceHash,sourceSnapshotId:r.sourceSnapshotId,...(r.sourceContext?{sourceContextHash:r.sourceContext.hash}:{}),completedAt:now,members:r.members.map(({deploymentId,stage,decisionId,outcome,executionIds})=>({deploymentId,stage,decisionId,outcome,executionIds})),observations});group.history=group.history.slice(-32);if(status==='COMPLETED')group.completedBars++;group.lastCompletedAt=r.asOf;group.cursorAt=new Date(Date.parse(r.asOf)+BAR).toISOString();group.round=null;group.updatedAt=now;}

/** One shared bar; durable API effects are re-read before every checkpoint. */
export async function runComparison({request,env={},ownerId,repository,options={},comparisonId,adapters={},idempotencyKey,expectedRevision}={}) {
  check(identifier(ownerId)&&identifier(comparisonId)&&repository?.read&&repository?.commit,'INVALID_COMPARISON_CONTEXT','사용자·비교 실험·저장 연결을 확인하세요.',400);
  const configuredLimit=env.COMPARISON_MEMBERS_PER_RUN??3,membersPerRun=typeof configuredLimit==='string'&&/^[1-3]$/.test(configuredLimit)?Number(configuredLimit):configuredLimit;
  check(Number.isSafeInteger(membersPerRun)&&membersPerRun>=1&&membersPerRun<=3,'INVALID_COMPARISON_RUN_LIMIT','비교 요청당 처리할 구성원 수를 1~3으로 설정하세요.',400);
  const wallStart=Date.now(),base=typeof options.now==='function'?null:Date.parse(options.now??new Date().toISOString()),clock=()=>typeof options.now==='function'?new Date(options.now()).toISOString():new Date(base+Date.now()-wallStart).toISOString();
  const read=async()=>{const value=envelope(await readOperationalWorkspace(repository,ownerId,undefined,[idempotencyKey]),comparisonId,ownerId);if(repository.hydrateReceiptKeys)await repository.hydrateReceiptKeys(ownerId,value.workspace,(value.group.round?.members??[]).map(member=>member.evaluateKey));return value;};let current=await read();
  const publicRequest=idempotencyKey!==undefined||expectedRevision!==undefined,runFingerprint=hashInputPackage({type:'comparison.run',comparisonId,ownerId});
  if(publicRequest){check(identifier(idempotencyKey)&&Number.isSafeInteger(expectedRevision)&&expectedRevision>=0,'INVALID_COMPARISON_INPUT','비교 실행 요청 ID와 저장 버전을 확인하세요.',400);const receipt=current.workspace.commandReceipts.find(r=>r.key===idempotencyKey);if(receipt){check(receipt.type==='comparison.run'&&receipt.fingerprint===runFingerprint,'IDEMPOTENCY_CONFLICT','같은 비교 실행 ID의 대상이 변경되었습니다.');return {...current,report:clone(receipt.result.report),idempotent:true};}check(current.workspace.revision===expectedRevision,'REVISION_CONFLICT','최신 비교 실험 상태를 확인하세요.');}
  check(!current.group.pauseRequestedAt,'COMPARISON_PAUSED','비교 실험을 재개한 뒤 실행하세요.');
  const forward=current.group.experimentType==='FORWARD_PAPER',latest=forward?latestClosedAsOf(clock()):null;
  const report={comparisonId,asOf:current.group.cursorAt,status:'waiting',processed:0,completed:0,failed:0,skipped:0,members:[]};
  const appendPublicReceipt=(workspace)=>{if(publicRequest)workspace.commandReceipts.push({id:'comparison-run-receipt-'+crypto.randomUUID(),key:idempotencyKey,type:'comparison.run',fingerprint:runFingerprint,revision:workspace.revision,createdAt:clock(),result:{comparisonId,report:clone(report)}});};
  if(forward&&Date.parse(current.group.cursorAt)+SETTLE>Date.parse(clock())&&!current.group.round){if(publicRequest){const saved=domain(withoutGroups(current.workspace),'audit.append',{eventType:'COMPARISON_WAITING',resourceType:'comparison',resourceId:comparisonId,payload:{asOf:current.group.cursorAt}},clock(),ownerId);saved.workspace.comparisons=clone(current.workspace.comparisons);appendPublicReceipt(saved.workspace);checked(saved.workspace);await repository.commit(ownerId,current.workspace,saved.workspace,idempotencyKey);current=envelope(saved.workspace,comparisonId,ownerId);}return {...current,report};}
  const claim=await acquireClaim(repository.db,{ownerId,resourceId:comparisonId,key:'comparison-round-'+current.group.cursorAt,fingerprint:hashInputPackage({comparisonId,asOf:current.group.cursorAt}),baseRevision:current.workspace.revision,nowMs:Date.parse(clock()),leaseMs:120000}),token=claim.token;
  let market=null;
  const commit=async(eventType,mutate,{requireLease=true,finalReport=false}={})=>{
    for(let attempt=0;attempt<3;attempt++){
      const baseState=await read();check(!baseState.group.pauseRequestedAt,'COMPARISON_PAUSED','비교 실험이 일시중지되었습니다.');
      if(requireLease)check(baseState.group.round?.lease?.token===token,'COMPARISON_LEASE_LOST','비교 실행 소유권이 변경되었습니다.');await assertClaim(repository.db,{ownerId,resourceId:comparisonId,token,nowMs:Date.parse(clock())});
      const groups=clone(baseState.workspace.comparisons),g=groups.find(g=>g.id===comparisonId),extra=clone(baseState.workspace);mutate(g,extra);g.updatedAt=clock();
      check(new TextEncoder().encode(JSON.stringify(g)).length<=500000,'COMPARISON_OBJECT_LIMIT','비교 운용의 상태와 승인 근거 참조가 저장 한도를 초과했습니다.',413);
      const changed=domain(withoutGroups(extra),'audit.append',{eventType,resourceType:'comparison',resourceId:comparisonId,payload:{asOf:g.round?.asOf??g.lastCompletedAt??g.cursorAt}},clock(),ownerId);changed.workspace.comparisons=groups;if(finalReport)appendPublicReceipt(changed.workspace);checked(changed.workspace);
      try{await repository.commit(ownerId,baseState.workspace,changed.workspace,crypto.randomUUID(),{resourceId:comparisonId,token,nowMs:Date.parse(clock())});return envelope(changed.workspace,comparisonId,ownerId);}catch(error){if(error.code!=='REVISION_CONFLICT'||attempt===2)throw error;}
    }
  };
  const effect=async(kind,body)=>{
    const latest=await read();assertSourceCurrent(latest.workspace,latest.group,body.deploymentId,clock());
    if(adapters.effect)return adapters.effect(kind,body);
    const {handleWorkspaceAPI}=await import('./workspace-api.mjs');const response=await handleWorkspaceAPI(new Request(new URL('/api/workspace/'+kind,request?.url??'https://comparison.internal'),{method:'POST',headers:{'Content-Type':'application/json','oai-authenticated-user-id':ownerId},body:JSON.stringify(body)}),env,{...options,now:clock(),comparisonId,comparisonRoundId:current.group.round?.id,...(market?{comparisonMarket:market}:{})});const value=await response.json();if(!response.ok)throw new ComparisonError(value.code??'COMPARISON_EFFECT_FAILED',value.message??'비교 실행을 확인하세요.',response.status);return value;
  };
  const skipRevoked=async code=>{report.status='skipped';current=await commit('COMPARISON_SOURCE_CONTEXT_REVOKED',(g,w)=>{for(const m of g.round.members)if(!terminal(m)){m.stage='SKIPPED';m.outcome=code;m.error=null;report.skipped++;}report.members=clone(g.round.members);finish(g,w,clock());},{finalReport:true});return {...current,report};};
  try{
    if(current.group.round){
      current=await commit('COMPARISON_RECOVERED',(g,w)=>{g.round.lease={token,until:claim.leaseUntil,workerId:'comparison-worker'};for(const m of g.round.members)recoverMember(w,g,m);},{requireLease:false});
      if(current.group.round.members.every(terminal)){report.status='completed';report.members=clone(current.group.round.members);current=await commit('COMPARISON_COMPLETED',(g,w)=>finish(g,w,clock()),{finalReport:true});return {...current,report};}
      if(!current.group.round.sourceContext)return await skipRevoked('SOURCE_CONTEXT_UNAVAILABLE');
      if(forward&&current.group.round.asOf!==latest){report.status='skipped';report.skipped++;current=await commit('COMPARISON_BARS_SKIPPED',(g,w)=>{for(const m of g.round.members)if(!terminal(m)){m.stage='SKIPPED';m.outcome='STALE_FORWARD_BAR';m.error=null;}report.members=clone(g.round.members);finish(g,w,clock());},{finalReport:true});return {...current,report};}
    }
    if(forward){
      if(current.group.round?.sourceSnapshotId){const capture=await repository.readObject(ownerId,'marketSnapshots',current.group.round.sourceSnapshotId);check(capture?.marketData,'COMPARISON_MARKET_MISSING','공통 시세 원본을 복원할 수 없습니다.');const {marketData,...sourceSnapshot}=capture;market={...marketData,sourceSnapshot};}
      else market=options.comparisonMarket??await (adapters.loadMarket??loadPublicMarket)({provider:configuredMarketProvider(env),fetchImpl:options.fetchImpl});
      const verified=validatePublicMarketSnapshot(market,{requirePublic:!adapters.allowFixtureMarket});check(verified.ok&&market.manifest.latestClosedAsOf===latest,'COMPARISON_MARKET_INVALID','동일한 최신 확정 봉과 검증한 공통 시세를 사용하세요.');
    }
    if(!current.group.round){
      current=await commit('COMPARISON_STARTED',(g,w)=>{
        if(forward&&Date.parse(g.cursorAt)<Date.parse(latest)){g.history.push({id:'skipped-'+crypto.randomUUID(),asOf:g.cursorAt,status:'SKIPPED',sourceHash:market.manifest.datasetSha256,sourceSnapshotId:market.sourceSnapshot.id,completedAt:clock(),members:[],observations:[]});g.history=g.history.slice(-32);g.cursorAt=latest;}
        const asOf=g.cursorAt,startedAt=clock();g.round={id:'comparison-bar-'+crypto.randomUUID(),asOf,sourceHash:forward?market.manifest.datasetSha256:manifest.datasetSha256,sourceSnapshotId:forward?market.sourceSnapshot.id:null,sourceContext:buildComparisonSourceContext(w,g,forward?asOf:startedAt,startedAt),startedAt,lease:{token,until:claim.leaseUntil,workerId:'comparison-worker'},members:g.members.map(m=>({deploymentId:m.deploymentId,stage:'EVALUATING',generation:1,...effectKeys(g,asOf,m.deploymentId,1),decisionId:null,outcome:null,error:null,executionIds:[],attemptedAt:null}))};
        if(forward){w.marketSnapshots??=[];if(!w.marketSnapshots.some(s=>s.id===market.sourceSnapshot.id))w.marketSnapshots.push({...clone(market.sourceSnapshot),marketData:{dataset:clone(market.dataset),manifest:clone(market.manifest)}});w.marketSnapshots.sort((a,b)=>a.receivedAt.localeCompare(b.receivedAt)||a.id.localeCompare(b.id));w.marketSnapshots=w.marketSnapshots.slice(-2);}
      },{requireLease:false});
    }
    report.asOf=current.group.round.asOf;
    for(const member of current.group.members){
      if(report.processed>=membersPerRun)break;
      try{
        current=await read();check(!current.group.pauseRequestedAt&&current.group.round?.lease?.token===token,'COMPARISON_PAUSED','비교 실행이 중지되었거나 소유권이 변경되었습니다.');
        let checkpoint=current.group.round.members.find(m=>m.deploymentId===member.deploymentId);if(terminal(checkpoint))continue;report.processed++;
        current=await commit('COMPARISON_MEMBER_RESUMED',(g,w)=>{const m=g.round.members.find(m=>m.deploymentId===member.deploymentId);recoverMember(w,g,m);if(m.stage==='FAILED'){const record=w.decisionRecords.find(d=>d.id===m.decisionId),needsNew=!record||record.decisionStatus==='FAILED'||['DECISION_NOT_EXECUTABLE','STALE_DECISION_CONTEXT','DECISION_INVALIDATED','DECISION_VERSION_MISMATCH'].includes(m.error?.code);if(needsNew&&w.commandReceipts.some(r=>r.key===m.evaluateKey)){m.generation++;Object.assign(m,effectKeys(g,g.round.asOf,m.deploymentId,m.generation));m.decisionId=null;}m.stage=needsNew?'EVALUATING':'EVALUATED';m.error=null;}m.attemptedAt=clock();});
        checkpoint=current.group.round.members.find(m=>m.deploymentId===member.deploymentId);
        if(checkpoint.stage==='EVALUATING'){
          await effect('evaluate',{deploymentId:member.deploymentId,asOf:current.group.round.asOf,idempotencyKey:checkpoint.evaluateKey,expectedRevision:current.workspace.revision});
          current=await commit('COMPARISON_MEMBER_EVALUATED',(g,w)=>recoverMember(w,g,g.round.members.find(m=>m.deploymentId===member.deploymentId)));
        }
        checkpoint=current.group.round.members.find(m=>m.deploymentId===member.deploymentId);if(checkpoint.stage==='FAILED'){report.failed++;continue;}
        if(checkpoint.stage==='EVALUATED'||checkpoint.stage==='EXECUTING'){
          current=await commit('COMPARISON_MEMBER_EXECUTING',g=>{g.round.members.find(m=>m.deploymentId===member.deploymentId).stage='EXECUTING';});checkpoint=current.group.round.members.find(m=>m.deploymentId===member.deploymentId);
          await effect('execute',{deploymentId:member.deploymentId,decisionId:checkpoint.decisionId,idempotencyKey:checkpoint.executeKey,expectedRevision:current.workspace.revision});
          current=await commit('COMPARISON_MEMBER_COMPLETED',(g,w)=>recoverMember(w,g,g.round.members.find(m=>m.deploymentId===member.deploymentId)));
        }
        if(terminal(current.group.round.members.find(m=>m.deploymentId===member.deploymentId)))report.completed++;
      }catch(error){
        if(['COMPARISON_PAUSED','COMPARISON_LEASE_LOST','CLAIM_LOST','CLAIM_EXPIRED'].includes(error.code))throw error;
        if(['SOURCE_CONTEXT_REVOKED','SOURCE_CONTEXT_UNAVAILABLE'].includes(error.code))return await skipRevoked(error.code);
        report.failed++;current=await commit('COMPARISON_MEMBER_FAILED',(g,w)=>{const m=g.round.members.find(m=>m.deploymentId===member.deploymentId);recoverMember(w,g,m);if(!terminal(m)){m.stage='FAILED';m.error={code:identifier(error.code)?error.code:'COMPARISON_EFFECT_FAILED',message:'해당 구성원의 실행 기록을 확인한 뒤 재개하세요.'};}});
      }
    }
    report.members=clone(current.group.round.members);if(current.group.round.members.every(terminal)){report.status='completed';current=await commit('COMPARISON_COMPLETED',(g,w)=>finish(g,w,clock()),{finalReport:true});}else{report.status='partial';current=await commit('COMPARISON_PARTIAL',g=>{g.round.lease=null;},{finalReport:true});}
    return {...current,report};
  }finally{await completeClaim(repository.db,{ownerId,resourceId:comparisonId,token,nowMs:Date.parse(clock())}).catch(()=>releaseClaim(repository.db,{ownerId,resourceId:comparisonId,token,nowMs:Date.parse(clock()),status:'FAILED'}).catch(()=>{}));}
}
