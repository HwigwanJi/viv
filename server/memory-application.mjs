import {validateWorkspace,hashInputPackage,stableStringify,summarizeMemoryEvidence,MEMORY_KNOWLEDGE_TYPES,WorkspaceError} from '../dist/domain/workspace.mjs';

export {summarizeMemoryEvidence};
const clone=value=>structuredClone(value),identifier=value=>typeof value==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,199}$/.test(value),iso=value=>typeof value==='string'&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value;
const check=(ok,code,message)=>{if(!ok)throw new WorkspaceError(code,message);};
const find=(items,id)=>{const value=items.find(item=>item.id===id);check(value,'RESOURCE_NOT_FOUND','선택한 봇·프로필·승인 기억을 찾을 수 없습니다.');return value;};
const unique=values=>[...new Set(values)];
const nextClose=time=>new Date((Math.floor(time/14400000)+1)*14400000).toISOString();
function audit(state,eventType,deploymentId,now,actorId,payload){state.activityEvents.push({id:'memory-apply-event-'+crypto.randomUUID(),eventType,schemaVersion:1,occurredAt:now,recordedAt:now,actorId,actorType:'user',producer:'profile-memory-service',resourceType:'deployment',resourceId:deploymentId,deploymentId,aggregateVersion:state.revision,correlationId:payload.applicationId,causationId:null,status:'recorded',payload:clone(payload)});}

/** One public CAS transaction. The HTTP caller fences live server claims. */
export function applyProfileMemory(workspace,body,options={}){
  const errors=validateWorkspace(workspace);check(!errors.length,errors[0]?.code??'INVALID_WORKSPACE',errors[0]?.message??'저장된 운용 구성을 확인하세요.');
  stableStringify(body);check(body&&typeof body==='object'&&!Array.isArray(body)&&Object.keys(body).every(k=>['deploymentId','sourceMemoryVersionId','reason','expectedRevision','idempotencyKey'].includes(k))&&['deploymentId','sourceMemoryVersionId','reason','expectedRevision','idempotencyKey'].every(k=>Object.hasOwn(body,k))&&identifier(body.deploymentId)&&identifier(body.sourceMemoryVersionId)&&identifier(body.idempotencyKey)&&Number.isSafeInteger(body.expectedRevision)&&body.expectedRevision>=0&&typeof body.reason==='string'&&body.reason.trim().length>0&&body.reason.length<=1000,'INVALID_MEMORY_APPLICATION','대상 봇·승인 기억·적용 이유·저장 버전을 확인하세요.');
  const now=options.now??new Date().toISOString(),actorId=options.actorId;check(iso(now)&&identifier(actorId),'INVALID_MEMORY_APPLICATION','기억 적용의 사용자와 시각을 확인하세요.');
  const fingerprint=hashInputPackage({type:'memory.apply',payload:{deploymentId:body.deploymentId,sourceMemoryVersionId:body.sourceMemoryVersionId,reason:body.reason},actorId}),receipt=workspace.commandReceipts.find(r=>r.key===body.idempotencyKey);
  if(receipt){check(receipt.type==='memory.apply'&&receipt.fingerprint===fingerprint,'IDEMPOTENCY_CONFLICT','같은 기억 적용 요청의 내용이 변경되었습니다.');return {workspace,result:clone(receipt.result),idempotent:true};}
  check(body.expectedRevision===workspace.revision,'REVISION_CONFLICT','최신 운용 구성을 다시 불러오세요.');check(Date.parse(now)>=Date.parse(workspace.updatedAt),'INVALID_TIME','최근 변경 이후의 적용 시각을 확인하세요.');
  const deployment=find(workspace.deployments,body.deploymentId),profile=find(workspace.investmentProfiles,deployment.investmentProfileId),source=find(workspace.memoryVersions,body.sourceMemoryVersionId),previous=find(workspace.memoryVersions,profile.currentMemoryVersionId);
  check(deployment.executionMode==='paper'&&deployment.runtimeStatus==='paused','DEPLOYMENT_RUNNING','모의 운용을 일시중지한 뒤 기억을 적용하세요.');
  check(source.investmentProfileId===profile.id&&Date.parse(source.approvedAt)<=Date.parse(now),'MEMORY_SCOPE','동일 투자 프로필에서 승인한 기억을 선택하세요.');
  const jobs=workspace.scheduler?.jobs??[],attempts=workspace.scheduler?.attempts??[];
  check(!jobs.some(j=>j.deploymentId===deployment.id&&j.status==='active')&&!attempts.some(a=>a.status==='PENDING'&&a.leaseUntil>=Date.parse(now)&&jobs.some(j=>j.id===a.jobId&&j.deploymentId===deployment.id)),'MEMORY_EXECUTION_IN_PROGRESS','예약 실행을 일시중지하고 진행 중인 작업 완료를 확인하세요.');
  const memberships=(workspace.comparisons??[]).filter(g=>g.members.some(m=>m.deploymentId===deployment.id));
  check(memberships.every(g=>g.status==='paused'&&g.round===null),'COMPARISON_ROUND_ACTIVE','비교 운용을 일시중지하고 현재 봉의 처리를 마친 뒤 기억을 적용하세요.');
  check(memberships.every(g=>(g.memoryChanges?.length??0)<200),'MEMORY_APPLICATION_LIMIT','비교 운용의 기억 적용 이력 보관 범위를 확인하세요.');
  const availableAt=new Date(Math.max(Date.parse(now)+1,Date.parse(source.availableAt),...source.items.map(item=>Date.parse(item.availableAt)))).toISOString(),reason=body.reason.trim(),applicationId='memory-application-'+crypto.randomUUID();
  const items=source.items.map(item=>{
    const candidate=find(workspace.memoryCandidates,item.candidateId);check(candidate.status==='APPROVED'&&candidate.investmentProfileId===profile.id,'UNREVIEWED_MEMORY','승인된 원본 후보와 프로필의 기억을 선택하세요.');
    const experienceIds=item.experienceIds??candidate.experienceIds;check(Array.isArray(experienceIds)&&experienceIds.length>0&&experienceIds.every(id=>workspace.experiences.some(e=>e.id===id&&e.investmentProfileId===profile.id&&e.status==='EVALUATED')),'MEMORY_SCOPE','기억에 연결된 원본 경험과 프로필을 확인하세요.');
    const evidenceSummary=summarizeMemoryEvidence(workspace,experienceIds),knowledgeType=item.knowledgeType??candidate.knowledgeType??'HYPOTHESIS';check(MEMORY_KNOWLEDGE_TYPES.includes(knowledgeType),'INVALID_KNOWLEDGE_TYPE','승인한 지식 유형을 확인하세요.');
    const authorization={deploymentId:deployment.id,experimentId:deployment.experimentId,authorizedAt:now,authorizedBy:actorId,reason},authorizations=[...clone(item.authorizations??[]),authorization];
    return {...clone(item),knowledgeType,experienceIds:clone(experienceIds),experienceCount:evidenceSummary.experienceCount,evidenceSummary,sourceApprovedAt:item.sourceApprovedAt??item.approvedAt,sourceAvailableAt:item.sourceAvailableAt??item.availableAt,approvedAt:now,availableAt,authorizations,approvedDeploymentIds:unique([item.deploymentId,...(item.approvedDeploymentIds??[]),...authorizations.map(a=>a.deploymentId)]),approvedExperimentIds:unique([item.experimentId,...authorizations.map(a=>a.experimentId)])};
  });
  const next=clone(workspace);next.revision++;next.updatedAt=now;
  const version={id:'memory-'+crypto.randomUUID(),investmentProfileId:profile.id,version:previous.version+1,previousVersionId:previous.id,sourceMemoryVersionId:source.id,sourceProfileId:source.sourceProfileId??null,items,approvedAt:now,availableAt,createdAt:now,applicationId};
  next.memoryVersions.push(version);const target=find(next.deployments,deployment.id),targetProfile=find(next.investmentProfiles,profile.id),previousMemoryVersionId=target.memoryVersionId;
  target.memoryVersionId=version.id;target.updatedAt=now;targetProfile.currentMemoryVersionId=version.id;targetProfile.updatedAt=now;
  const comparisons=[];for(const g of next.comparisons??[]){const member=g.members.find(m=>m.deploymentId===target.id);if(!member)continue;member.memoryVersionId=version.id;g.memoryChanges??=[];g.memoryChanges.push({at:now,asOf:g.cursorAt,profileId:profile.id,deploymentId:target.id,previousMemoryVersionId,memoryVersionId:version.id,reason});g.updatedAt=now;comparisons.push({comparisonId:g.id,asOf:g.cursorAt});}
  const nextEligibleAsOf=new Date(Math.max(Date.parse(nextClose(Date.parse(now))),Math.ceil(Date.parse(availableAt)/14400000)*14400000)).toISOString();
  const result={deployment:clone(target),memoryVersion:clone(version),sourceMemoryVersionId:source.id,previousMemoryVersionId,applicationId,nextEligibleAsOf,comparisons,knowledgeTypes:unique(items.map(i=>i.knowledgeType)),experienceCount:unique(items.flatMap(i=>i.experienceIds)).length};
  audit(next,'MEMORY_APPLIED',target.id,now,actorId,{applicationId,sourceMemoryVersionId:source.id,previousMemoryVersionId,memoryVersionId:version.id,experimentId:target.experimentId,reason,nextEligibleAsOf});audit(next,'PROPOSAL_INVALIDATED',target.id,now,actorId,{applicationId,reason:'승인 기억 버전 적용',previousMemoryVersionId,memoryVersionId:version.id});
  next.commandReceipts.push({id:'memory-apply-receipt-'+crypto.randomUUID(),key:body.idempotencyKey,type:'memory.apply',fingerprint,revision:next.revision,createdAt:now,result:clone(result)});
  const changedErrors=validateWorkspace(next);check(!changedErrors.length,changedErrors[0]?.code??'INVALID_WORKSPACE',changedErrors[0]?.message??'기억 적용 결과를 확인하세요.');return {workspace:next,result,idempotent:false};
}
