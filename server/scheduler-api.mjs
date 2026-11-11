import {createJobsState,validateJobsState} from '../dist/domain/jobs.mjs';
import {dispatchWorkspaceAction} from '../dist/domain/workspace.mjs';
import {runScheduledJobs,safePublicHttpDiagnostic} from './jobs.mjs';
import {RepositoryError,readOperationalWorkspace} from './repository.mjs';
import {runComparison} from './comparisons.mjs';
import {runMindSubscriptions,runDueMindObservations} from './mind-subscriptions.mjs';
import {runPaperAdaptations} from './paper-adaptation.mjs';
import {legacyForwardBlocked} from './execution-ownership.mjs';
import {MAX_ACTIVE_MIND_SUBSCRIPTIONS} from '../dist/domain/mind-subscriptions.mjs';

const groupDeployments=workspace=>new Set([...(workspace.comparisons??[]).flatMap(group=>group.members.map(member=>member.deploymentId)),...workspace.deployments.filter(d=>legacyForwardBlocked(workspace,d)).map(d=>d.id)]);
// Present group-owned jobs as paused to the legacy runner. Its CAS restores
// their authoritative records so this read projection never changes saved jobs.
const standaloneJobs=(workspace,jobs)=>{const blocked=groupDeployments(workspace);return {...jobs,jobs:jobs.jobs.map(job=>blocked.has(job.deploymentId)?{...job,status:'paused'}:job)};};

export async function runOwnerJobs({request,env,ownerId,repository,options={},maxJobs=3}){
  if(!Number.isSafeInteger(maxJobs)||maxJobs<1||maxJobs>30)throw new RepositoryError('INVALID_WORKER_POLICY','한 번에 실행할 작업 수를 1~30개로 정하세요.',400);
  const clock=()=>typeof options.now==='function'?new Date(options.now()).toISOString():options.now??new Date().toISOString();
  const read=async()=>{const workspace=await readOperationalWorkspace(repository,ownerId);return {workspace,jobs:workspace.scheduler??createJobsState({ownerId,now:clock()})};};
  const standaloneRead=async()=>{const current=await read();return {...current,jobs:standaloneJobs(current.workspace,current.jobs)};};
  const compareAndSwap=async input=>{const current=await read();if(current.workspace.revision!==input.expectedWorkspaceRevision||current.jobs.revision!==input.expectedJobsRevision)throw new RepositoryError('REVISION_CONFLICT','다른 작업이 갱신했습니다. 다음 실행에서 복구합니다.');const blocked=groupDeployments(current.workspace),jobs={...input.jobs,jobs:input.jobs.jobs.map(job=>blocked.has(job.deploymentId)?current.jobs.jobs.find(saved=>saved.id===job.id):job)};if(validateJobsState(jobs).length)throw new RepositoryError('INVALID_JOB_STATE','작업 기록을 확인하세요.',400);const changed=dispatchWorkspaceAction(current.workspace,{type:'audit.append',payload:{eventType:'SCHEDULED_JOB_STATE_CHANGED',resourceType:'scheduler',resourceId:ownerId,payload:{stage:input.reason}},idempotencyKey:crypto.randomUUID(),expectedRevision:current.workspace.revision},{actorId:ownerId,now:clock()});changed.workspace.scheduler=jobs;await repository.commit(ownerId,current.workspace,changed.workspace,crypto.randomUUID());return {workspace:changed.workspace,jobs:standaloneJobs(changed.workspace,jobs)};};
  const effect=kind=>async(_workspace,body)=>{const {handleWorkspaceAPI}=await import('./workspace-api.mjs');const url=new URL('/api/workspace/'+kind,request.url);const response=await handleWorkspaceAPI(new Request(url,{method:'POST',headers:{'Content-Type':'application/json','oai-authenticated-user-id':ownerId},body:JSON.stringify(body)}),env,{...options,now:clock()});const value=await response.json();if(!response.ok){const error=new RepositoryError(value.code,value.message,response.status),diagnostic=safePublicHttpDiagnostic(value.diagnostic);if(diagnostic)error.diagnostic=diagnostic;throw error;}return {...value,persisted:true};};
  const automatic=await runMindSubscriptions({request,env,ownerId,repository,options:{...options,now:clock},maxJobs:Math.min(MAX_ACTIVE_MIND_SUBSCRIPTIONS,maxJobs)});
  if(automatic.deliveryStatus==='IN_PROGRESS')return {...await read(),report:{...automatic,mindSubscriptions:automatic,mindObservations:{processed:0,completed:0,retried:0,failed:0,skipped:0,results:[]},groups:[]},groups:[]};
  const observations=await runDueMindObservations({request,env,ownerId,repository,options:{...options,now:clock},maxJobs:Math.min(1,maxJobs-automatic.processed)});
  const adaptations=await runPaperAdaptations({request,env,ownerId,repository,options:{...options,now:clock}});
  const remaining=maxJobs-automatic.processed-observations.processed;
  const scheduled=remaining>0?await runScheduledJobs({read:standaloneRead,compareAndSwap,evaluate:effect('evaluate'),execute:effect('execute'),effectsPersisted:true},{ownerId,maxJobs:remaining,clock}):{report:{processed:0,completed:0,retried:0,failed:0,skipped:0,results:[]}};
  const report={...scheduled.report,processed:scheduled.report.processed+automatic.processed+observations.processed,completed:scheduled.report.completed+automatic.completed+observations.completed,retried:scheduled.report.retried+automatic.retried+observations.retried,failed:scheduled.report.failed+automatic.failed+observations.failed,skipped:scheduled.report.skipped+automatic.skipped,results:[...automatic.results,...observations.results,...scheduled.report.results],mindSubscriptions:automatic,mindObservations:observations,paperAdaptations:adaptations,groups:[]};
  const due=(group,workspace)=>group.createdBy===ownerId&&group.status==='running'&&group.experimentType==='FORWARD_PAPER'&&!group.pauseRequestedAt&&!group.members.some(m=>legacyForwardBlocked(workspace,workspace.deployments.find(d=>d.id===m.deploymentId)))&&Date.parse(group.cursorAt)+group.conditions.settleDelayMs<=Date.parse(clock());
  const current=await read();
  const candidates=current.workspace.comparisons?.filter(g=>due(g,current.workspace)).sort((a,b)=>Date.parse(a.cursorAt)-Date.parse(b.cursorAt)||a.id.localeCompare(b.id))??[];
  for(const candidate of candidates){
    if(report.processed>=maxJobs)break;
    const latest=await read(),group=latest.workspace.comparisons?.find(value=>value.id===candidate.id);if(!group||!due(group,latest.workspace))continue;
    report.processed++;
    try{
      const completed=await runComparison({request,env,ownerId,repository,options:{...options,now:clock},comparisonId:group.id});
      report.groups.push(completed.report);report.results.push({comparisonId:group.id,status:completed.report.status,asOf:completed.report.asOf});
      if(completed.report.status==='completed')report.completed++;
      else if(completed.report.status==='partial')report.retried++;
      else if(completed.report.status==='skipped')report.skipped++;
    }catch(error){
      const code=typeof error.code==='string'&&/^[a-zA-Z0-9_.:-]{1,200}$/.test(error.code)?error.code:'COMPARISON_RUN_FAILED';
      const failed={comparisonId:group.id,asOf:group.cursorAt,status:'failed',code};report.groups.push(failed);report.results.push(failed);report.failed++;
    }
  }
  return {...await read(),report,groups:report.groups};
}
