import {hashInputPackage,validateWorkspace} from '../dist/domain/workspace.mjs';
import {mindDocumentHash} from '../dist/domain/mind-manifest.mjs';
import {strategyGraphHash} from '../dist/domain/strategy-graph.mjs';
import {assertStrategyEvaluation} from '../dist/domain/mind-strategy-plan.mjs';
import {validateMindPaperAccount} from '../dist/domain/mind-paper.mjs';
import {createPaperAdaptation,fitPaperEpisodeWeights,adaptationMixer,paperAdaptationEligibility} from '../dist/domain/paper-adaptation.mjs';
import {validateMindSubscription} from '../dist/domain/mind-subscriptions.mjs';
import {mindRunEvidenceHash} from './mind-observation.mjs';
import {WorkspaceRepository,readOperationalWorkspace} from './repository.mjs';
import {StrategyLearningStore} from './strategy-learning-store.mjs';
import {createPaperForwardTrial,createPaperTrialCandidateManifest,assertPaperForwardTrial,paperForwardTrialSummary} from '../dist/domain/paper-forward-trial.mjs';
import {advancePaperForwardTrial,verifyPaperForwardTrialEvidence} from './paper-forward-trial.mjs';
import {acquireClaim,renewClaim,completeClaim,releaseClaim} from './claims.mjs';
const clone=structuredClone,H=14400000,BASE='/api/workspace/paper-adaptation';
const iso=v=>typeof v==='string'&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString()===v;
const finite=v=>typeof v==='number'&&Number.isFinite(v),close=(a,b)=>finite(a)&&finite(b)&&Math.abs(a-b)<Math.max(1e-8,Math.max(Math.abs(a),Math.abs(b))*1e-7);
const check=(ok,code,message,status=409)=>{if(!ok)throw Object.assign(new Error(message),{code,status});};
const json=(v,s=200)=>Response.json(v,{status:s,headers:{'Cache-Control':'no-store'}});
function trialRecovery(trial,subscription){
 if(trial?.status!=='INTERRUPTED')return null;
 const sourceMatches=subscription.pins.manifestHash===trial.arms.baseline.manifestHash&&!subscription.pendingPins;
 const enabled=subscription.status==='ENABLED'&&subscription.adaptation?.enabled&&subscription.adaptation?.autoApply;
 let withinLimit=false;try{withinLimit=Math.abs(adaptationMixer(trial.arms.baseline.manifest.data.strategyPlan.graph,subscription.adaptation).weight-adaptationMixer(trial.arms.candidate.manifest.data.strategyPlan.graph,subscription.adaptation).weight)<=subscription.adaptation.maxWeightStep+1e-12;}catch{}
 return {canRestart:sourceMatches&&enabled&&withinLimit,reason:!sourceMatches?'ORIGINAL_POLICY_CHANGED':!enabled?'ENABLE_AUTOMATIC_COMPARISON':!withinLimit?'CANDIDATE_LIMIT_CHANGED':null};
}

/** Only complete, unscaled actual paper executions become independent fitting samples. */
export function collectPaperAdaptationEpisodes(workspace,subscription,manifest,{now}={}){
 const graph=manifest.data.strategyPlan.graph,settings=subscription.adaptation,manifestHash=mindDocumentHash(manifest),graphHash=strategyGraphHash(graph),account=workspace.mindPositions.find(a=>a.id===subscription.accountId),episodes=[],excluded=[];
 check(settings&&account?.profileId===subscription.profileId&&!validateMindPaperAccount(account).length,'ADAPTATION_ACCOUNT','마인드의 검증된 모의계좌를 확인하세요.');
 adaptationMixer(graph,settings);const runs=new Map(workspace.mindRuns.map(r=>[r.id,r]));let episode=null;
 const reject=(code,fill)=>excluded.push({entryRunId:episode?.entry?.runId??null,runId:fill?.runId??null,code});
 for(const fill of account.ledger){
  if(fill.side==='buy'){if(episode){episode.invalid='ADDITIONAL_ENTRY';continue;}episode={entry:fill,invalid:null};continue;}
  if(!episode)continue;if(fill.quantityAfter>1e-8){episode.invalid='PARTIAL_EXIT';continue;}
  const entry=episode.entry,exit=fill,a=runs.get(entry.runId),b=runs.get(exit.runId);
  try{
   check(!episode.invalid,'ADAPTATION_'+episode.invalid,'독립된 진입·전량 청산 거래를 사용하세요.');
   check(entry.instrumentId===exit.instrumentId&&entry.mode==='paper'&&exit.mode==='paper'&&entry.profileId===subscription.profileId&&exit.profileId===subscription.profileId&&entry.manifestHash===manifestHash&&exit.manifestHash===manifestHash&&iso(entry.at)&&iso(exit.at)&&entry.at<exit.at&&exit.at<=now,'ADAPTATION_EPISODE_SCOPE','동일 정책의 실제 모의 체결을 확인하세요.');
   for(const [run,f]of [[a,entry],[b,exit]]){
    check(run&&run.profileId===subscription.profileId&&run.manifestId===manifest.id&&run.manifestHash===manifestHash&&run.execution?.status==='FILLED'&&run.execution.id===f.id&&run.execution.outcomeRecord?.mode==='paper'&&run.execution.accountSnapshotAfter?.id===account.id&&Object.keys(f).every(k=>hashInputPackage(run.execution[k]??null)===hashInputPackage(f[k])),'ADAPTATION_EXECUTION_BINDING','원장과 실행 영수증의 원문을 대조하세요.');
    check(run.automation?.portfolioCycle?.phase!=='SCREENING','ADAPTATION_SCREENING','실제 체결된 운용 기록을 사용하세요.');
    const ev=run.strategyEvaluation??run.rawRequest?.state?.strategyEvaluation;assertStrategyEvaluation(ev,{manifest,marketAsOf:run.asOf,instrumentId:run.instrumentId,now});
    check(run.decision?.graphOutputHash===ev.graphEvaluation.outputHash&&run.decision.action===ev.graphEvaluation.output.decision.action&&close(run.decision.targetWeight,ev.graphEvaluation.output.decision.targetWeight),'ADAPTATION_FINAL_DECISION_BINDING','최종 그래프와 원결정의 행동·목표 비중·출력 해시를 대조하세요.');
    for(const [nodeId,answer]of Object.entries(ev.decisionInputs??{})){
     const stages=run.rawResponse?.stages?.filter(s=>s.nodeId===nodeId);
     check(stages?.length===1&&answer.kind==='JEV_QUESTION'&&hashInputPackage(stages[0].rawRequest)===answer.rawRequestHash&&hashInputPackage(stages[0].rawResponse)===answer.rawResponseHash&&hashInputPackage(stages[0].rawResponse?.answers?.[nodeId])===hashInputPackage(answer.answer),'ADAPTATION_PROVIDER_BINDING','JEV 선택과 실제 공급자 원요청·원응답을 대조하세요.');
    }
   }
   check(a.accountSnapshot?.positions?.length===0&&b.execution.accountSnapshotAfter.positions.length===0&&close(entry.quantity,exit.quantity)&&!(account.fundingLedger??[]).some(f=>f.at>=entry.at&&f.at<=exit.at),'ADAPTATION_INDEPENDENT_EPISODE','추가 매수·부분 청산·자금 이동이 없는 한 종목 거래를 사용하세요.');
   const ev=a.strategyEvaluation??a.rawRequest?.state?.strategyEvaluation,mix=ev.graphEvaluation.trace.find(t=>t.nodeId===settings.mixerNodeId),contributors=mix?.targetContributors,quantTarget=contributors?.find(c=>c.nodeId===settings.quantNodeId)?.targetWeight,vibeTarget=contributors?.find(c=>c.nodeId===settings.vibeNodeId)?.targetWeight,actualTarget=ev.graphEvaluation.output.decision.targetWeight;
   check(contributors?.length===2&&finite(quantTarget)&&finite(vibeTarget)&&actualTarget>0&&close(mix.output.decision.targetWeight,actualTarget),'ADAPTATION_MIXER_EVIDENCE','위험 한도에 잘리지 않은 믹서 목표와 실제 분기 원문을 확인하세요.');
   const initialEquity=a.accountSnapshot.equity,entryCost=entry.gross+entry.fee,quantity=entry.quantity;
   check(initialEquity>0&&Math.abs(entryCost/initialEquity-actualTarget)<.002&&finite(exit.realizedPnl),'ADAPTATION_ALLOCATION_CLIPPED','현금·주문 한도에 잘리지 않은 실제 배정 금액을 확인하세요.');
   const points=new Map(),sources=[];
   for(const run of workspace.mindRuns){const o=run.observation;if(run.profileId!==subscription.profileId||run.instrumentId!==entry.instrumentId||run.manifestHash!==manifestHash||!o||o.source?.runHash!==mindRunEvidenceHash(run)||o.source?.manifestHash!==manifestHash||!iso(o.observedAt)||o.observedAt>now)continue;
    for(const p of o.path??[]){if(!iso(p.asOf)||p.asOf<=entry.at||p.asOf>=exit.at||Date.parse(p.asOf)%H)continue;const price=p.price??p.prices?.[entry.instrumentId];if(!finite(price)||price<=0)continue;const previous=points.get(p.asOf);check(previous===undefined||close(previous,price),'ADAPTATION_PRICE_CONFLICT','같은 시각의 확정 가격 원본을 대조하세요.');points.set(p.asOf,price);}
    sources.push({runId:run.id,runHash:mindRunEvidenceHash(run),observationHash:hashInputPackage(o),observedAt:o.observedAt});
   }
   const expected=[];for(let at=(Math.floor(Date.parse(entry.at)/H)+1)*H;at<Date.parse(exit.at);at+=H)expected.push(new Date(at).toISOString());
   check(expected.every(at=>points.has(at)),'ADAPTATION_PATH_PENDING','진입부터 청산까지 확정 종가 관측을 기다립니다.');
   const netReturn=exit.realizedPnl/initialEquity,path=[{at:entry.at,netReturn:(quantity*entry.referencePrice-entryCost)/initialEquity},...expected.map(at=>({at,netReturn:(quantity*points.get(at)-entryCost)/initialEquity})),{at:exit.at,netReturn}];
   const result={manifestHash,graphHash,instrumentId:entry.instrumentId,entryAt:entry.at,exitAt:exit.at,observedAt:now,quantTarget,vibeTarget,actualTarget,netReturn,initialEquity,entryCost,fees:entry.fee+exit.fee,slippage:entry.slippageCost+exit.slippageCost,returnPath:path,provenance:{accountId:account.id,entryRunId:a.id,exitRunId:b.id,entryRunHash:mindRunEvidenceHash(a),exitRunHash:mindRunEvidenceHash(b),entryFillHash:hashInputPackage(entry),exitFillHash:hashInputPackage(exit),observations:sources}};
   episodes.push({id:hashInputPackage({entry:entry.id,exit:exit.id,manifestHash}),...result});
  }catch(e){reject(e.code??'ADAPTATION_SOURCE_INVALID',fill);}episode=null;
 }
 return {episodes,excluded,openEpisode:episode?{entryRunId:episode.entry.runId,entryAt:episode.entry.at}:null};
}

async function studioCall(request,env,options,path,body){const {handleMindStudioAPI}=await import('./mind-studio.mjs');const response=await handleMindStudioAPI(new Request(new URL('/api/workspace'+path,request.url),{method:'POST',headers:{'Content-Type':'application/json','oai-authenticated-user-id':options.ownerId},body:JSON.stringify(body)}),env,options),value=await response.json();check(response.ok&&value.ok!==false,value.code??'ADAPTATION_POLICY',value.message??'학습 정책의 발행 상태를 확인하세요.',response.status);return value;}
async function markApplied(state,pins,fit,store,owner,at,trial){
 assertPaperForwardTrial(trial);check(trial.status==='READY_TO_PROMOTE','FORWARD_PROMOTION_EVIDENCE','두 독립 계좌의 전진 비교를 마친 후보를 적용하세요.');
 state.status='APPLIED';state.pendingManifestId=pins.manifestId;state.sourceManifestHash=pins.manifestHash;state.evaluatedEpisodeIds=[];
  state.forwardValidation={status:'WAITING_EPISODES',count:0,minimumEpisodes:6,sourceManifestHash:state.sourceManifestHash,applicationAuthority:'BOUNDED_FORWARD_PAPER_EXPERIMENT',approvalEvidence:await store.write(owner,{contractVersion:'PAPER_ALLOCATION_APPLICATION_V2',authorizedBy:state.authorizedBy,authorizedAt:state.authorizedAt,autoApply:state.autoApply,appliedAt:at,sourceManifestHash:fit.sourceManifestHash,candidateManifestId:pins.manifestId,candidateManifestHash:pins.manifestHash,fitEvidenceHash:fit.evidenceHash,fitEvidenceRef:state.lastEvidence,forwardTrialRef:clone(state.forwardTrialRef),forwardComparison:clone(trial.comparison),maxWeightStep:state.maxWeightStep,applyAtCloseAt:pins.applyAtCloseAt,forwardValidationEpisodes:6})};
}
export async function handlePaperAdaptationAPI(request,env={},options={}){
 const u=new URL(request.url);if(!u.pathname.startsWith(BASE))return null;const owner=options.ownerId??request.headers.get('oai-authenticated-user-id');if(!owner)return json({ok:false,code:'UNAUTHORIZED'},401);
 if(request.headers.get('Origin')&&request.headers.get('Origin')!==u.origin||request.headers.get('Sec-Fetch-Site')==='cross-site')return json({ok:false,code:'ORIGIN'},403);
 const clock=()=>new Date(typeof options.now==='function'?options.now():options.now??Date.now()).toISOString(),db=env.DB?.withSession?env.DB.withSession('first-primary'):env.DB,repository=options.repository??new WorkspaceRepository(db),store=new StrategyLearningStore(repository.db);let claim=null,resourceId=null,success=false;
 try{
  const path=u.pathname.slice(BASE.length),body=request.method==='POST'?await request.json():{},subscriptionId=body.subscriptionId??u.searchParams.get('subscriptionId');let w=await readOperationalWorkspace(repository,owner),sub=w?.mindSubscriptions.find(s=>s.id===subscriptionId&&s.ownerId===owner);check(sub,'ADAPTATION_SUBSCRIPTION','학습할 모의 운용을 선택하세요.',404);
  const subscriptionErrors=validateMindSubscription(sub,w,{ownerId:owner});check(!subscriptionErrors.length,subscriptionErrors[0]?.code,subscriptionErrors[0]?.message);
  const manifest=w.mindManifests.find(m=>m.id===sub.pins.manifestId),graph=manifest?.data.strategyPlan?.graph;check(graph?.schemaVersion===2,'ADAPTATION_GRAPH','발행한 결정 그래프를 확인하세요.');
  const eligibility=paperAdaptationEligibility(manifest);
  if(request.method==='GET'){const intake=sub.adaptation&&eligibility.eligible?collectPaperAdaptationEpisodes(w,sub,manifest,{now:clock()}):null,trial=sub.adaptation?.forwardTrialRef?await store.read(owner,sub.adaptation.forwardTrialRef):null;if(trial)check(trial.ownerId===owner&&trial.subscriptionId===sub.id,'FORWARD_OWNER','비교 원장의 소유자와 운용을 대조하세요.');const trialSummary=paperForwardTrialSummary(trial);if(trialSummary?.status==='READY_TO_PROMOTE'){trialSummary.promotion.waitingForOriginalFlat=!!w.mindPositions.find(a=>a.id===sub.accountId)?.positions.length;if(trialSummary.promotion.waitingForOriginalFlat){trialSummary.promotion.eligible=false;trialSummary.reason='WAITING_ORIGINAL_ACCOUNT_FLAT';}}if(trialSummary&&trialRecovery(trial,sub))trialSummary.recovery=trialRecovery(trial,sub);return json({ok:true,revision:w.revision,eligibility,settings:sub.adaptation??null,trial:trialSummary,intake: intake?{count:intake.episodes.filter(e=>e.manifestHash===sub.adaptation.sourceManifestHash&&!sub.adaptation.evaluatedEpisodeIds.includes(e.id)).length,minimumEpisodes:6,excluded:intake.excluded,openEpisode:intake.openEpisode}:null});}
  check(request.method==='POST'&&['/configure','/step','/restart'].includes(path),'ADAPTATION_ROUTE','지원하는 학습 요청을 선택하세요.',404);
  check(w.revision===body.expectedRevision&&typeof body.idempotencyKey==='string'&&/^[\w:@.-]{1,199}$/.test(body.idempotencyKey),'ADAPTATION_REVISION','최신 운용 상태와 요청 키를 확인하세요.');
  resourceId='paper-adaptation:'+sub.id;const fingerprint=hashInputPackage({path,body});claim=await acquireClaim(repository.db,{ownerId:owner,resourceId,key:body.idempotencyKey,fingerprint,baseRevision:w.revision,nowMs:Date.parse(clock()),leaseMs:120000});
  const persist=async(next,suffix)=>{next.revision=w.revision+1;next.updatedAt=clock();const errors=[...validateWorkspace(next),...validateMindSubscription(next.mindSubscriptions.find(s=>s.id===subscriptionId),next,{ownerId:owner})];check(!errors.length,errors[0]?.code,errors[0]?.message,400);await renewClaim(repository.db,{ownerId:owner,resourceId,token:claim.token,nowMs:Date.parse(clock()),leaseMs:120000});await repository.commit(owner,w,next,body.idempotencyKey+suffix,{resourceId,token:claim.token,nowMs:Date.parse(clock())});w=next;sub=w.mindSubscriptions.find(s=>s.id===subscriptionId);};
  if(path==='/configure'){
   check(!sub.pendingPins,'ADAPTATION_PENDING_POLICY','예약된 정책을 다음 봉에 적용한 뒤 학습 설정을 변경하세요.');
   check(eligibility.eligible,'ADAPTATION_SCOPE',eligibility.reason);
   check(Object.keys(body).every(k=>['subscriptionId','expectedRevision','idempotencyKey','enabled','autoApply','mixerNodeId','quantNodeId','vibeNodeId','maxWeightStep'].includes(k)),'ADAPTATION_SETTINGS','지원하는 학습 설정만 입력하세요.');
   const settings=createPaperAdaptation({graph,manifestHash:mindDocumentHash(manifest),enabled:body.enabled??true,autoApply:body.autoApply??false,mixerNodeId:body.mixerNodeId??'rebound-mix',quantNodeId:body.quantNodeId??'full',vibeNodeId:body.vibeNodeId??'review-route',maxWeightStep:body.maxWeightStep??.1,ownerId:owner,now:clock()});
   if(sub.adaptation?.forwardTrialRef){const current=await store.read(owner,sub.adaptation.forwardTrialRef);if(['WAITING_START','RUNNING','READY_TO_PROMOTE'].includes(current.status))check(['mixerNodeId','quantNodeId','vibeNodeId','maxWeightStep'].every(k=>settings[k]===sub.adaptation[k]),'FORWARD_SETTINGS_PINNED','진행 중인 비교의 믹서와 변경 한도를 유지하세요.');}
   if(sub.adaptation&&sub.adaptation.sourceManifestHash===settings.sourceManifestHash)Object.assign(settings,{evaluatedEpisodeIds:sub.adaptation.evaluatedEpisodeIds,lastEvidence:sub.adaptation.lastEvidence,lastResult:sub.adaptation.lastResult,pendingManifestId:sub.adaptation.pendingManifestId,...(sub.adaptation.forwardValidation?{forwardValidation:clone(sub.adaptation.forwardValidation)}:{}),...(sub.adaptation.forwardTrialRef?{forwardTrialRef:clone(sub.adaptation.forwardTrialRef)}:{}),status:settings.enabled?(sub.adaptation.forwardTrialRef&&sub.adaptation.status.startsWith('FORWARD_')?sub.adaptation.status:sub.adaptation.lastResult?.status==='REVIEW_REQUIRED'?'REVIEW_REQUIRED':sub.adaptation.status==='DISABLED'?'WAITING_EPISODES':sub.adaptation.status):'DISABLED'});
   const next=clone(w);next.mindSubscriptions.find(s=>s.id===subscriptionId).adaptation=settings;await persist(next,':configure');success=true;return json({ok:true,settings,revision:w.revision});
  }
  check(Object.keys(body).every(k=>['subscriptionId','expectedRevision','idempotencyKey'].includes(k)),'ADAPTATION_INPUT','저장된 학습 설정으로 실행하세요.');
  check(sub.adaptation?.enabled,'ADAPTATION_DISABLED','학습을 켠 뒤 실행하세요.');
  if(sub.pendingPins&&sub.pendingPins.manifestId===sub.adaptation.pendingManifestId&&sub.pendingPins.manifestHash===sub.adaptation.sourceManifestHash){success=true;return json({ok:true,status:'APPLIED',settings:sub.adaptation,revision:w.revision});}
  const saveTrial=async(trial,suffix)=>{
   assertPaperForwardTrial(trial);check(trial.ownerId===owner&&trial.subscriptionId===sub.id,'FORWARD_OWNER','비교 원장의 소유자와 운용을 대조하세요.');
   const next=clone(w),a=next.mindSubscriptions.find(s=>s.id===subscriptionId).adaptation;a.forwardTrialRef=await store.write(owner,trial);
   a.status=trial.status==='PROMOTED'?'APPLIED':trial.status==='KEEP_BASELINE'?'FORWARD_REJECTED':trial.status==='INTERRUPTED'?'FORWARD_INTERRUPTED':'FORWARD_RUNNING';
   a.lastResult={...a.lastResult,status:a.status,asOf:clock(),trialId:trial.id,trialStatus:trial.status};
   if(['READY_TO_PROMOTE','KEEP_BASELINE','INTERRUPTED','PROMOTED'].includes(trial.status)){
    const id='event-forward-'+hashInputPackage({trialId:trial.id,status:trial.status});if(!next.activityEvents.some(e=>e.id===id))next.activityEvents.push({id,eventType:'PAPER_FORWARD_TRIAL_'+trial.status,resourceType:'paper-forward-trial',resourceId:trial.id,occurredAt:clock(),actorId:owner,payload:{profileId:sub.profileId,subscriptionId:sub.id,trialRef:clone(a.forwardTrialRef),summary:paperForwardTrialSummary(trial)}});
   }
   await persist(next,':forward-'+suffix);
  };
  const priorTrial=sub.adaptation.forwardTrialRef?await store.read(owner,sub.adaptation.forwardTrialRef):null;
  if(priorTrial){assertPaperForwardTrial(priorTrial);check(priorTrial.ownerId===owner&&priorTrial.subscriptionId===sub.id,'FORWARD_OWNER','비교 원장의 소유자와 운용을 대조하세요.');}
  if(path==='/restart'){
   check(priorTrial?.status==='INTERRUPTED','FORWARD_RESTART_STATE','중단된 비교를 선택하세요.');
   const recovery=trialRecovery(priorTrial,sub);check(recovery.canRestart,'FORWARD_RESTART_'+(recovery.reason??'UNAVAILABLE'),'원 정책과 활성 운용·자동 비교 설정을 확인하세요.');
   const retained=await store.read(owner,sub.adaptation.lastEvidence),fit=retained.fit,{evidenceHash,...source}=fit;
   check(hashInputPackage(source)===evidenceHash&&evidenceHash===priorTrial.fitEvidenceHash&&fit.sourceManifestHash===mindDocumentHash(manifest)&&fit.sourceManifestHash===sub.adaptation.sourceManifestHash&&fit.candidateGraphHash===strategyGraphHash(priorTrial.arms.candidate.manifest.data.strategyPlan.graph)&&Math.abs(fit.selectedWeight-fit.currentWeight)<=sub.adaptation.maxWeightStep+1e-12,'FORWARD_FIT_CHANGED','재시작할 후보와 원 정책·선택 근거·비중 한도를 대조하세요.');
   const verified=fitPaperEpisodeWeights({graph,settings:{...sub.adaptation,maxWeightStep:fit.maxWeightStep,evaluatedEpisodeIds:[]},episodes:fit.episodes,now:fit.createdAt});
   check(verified.status==='REVIEW_REQUIRED'&&verified.candidateGraphHash===fit.candidateGraphHash&&hashInputPackage(verified.training)===hashInputPackage(fit.training)&&hashInputPackage(verified.holdout)===hashInputPackage(fit.holdout),'FORWARD_FIT_CHANGED','원래 종료 거래에서 같은 후보가 선택되는지 대조하세요.');
   const account=w.mindPositions.find(a=>a.id===sub.accountId);check(account?.equity>0,'FORWARD_INITIAL_CASH','비교를 시작할 모의 평가자산을 확인하세요.');
   const id='paper-forward-'+hashInputPackage({previousTrialId:priorTrial.id,fitEvidenceHash:evidenceHash,idempotencyKey:body.idempotencyKey}).slice(0,32),candidate=createPaperTrialCandidateManifest({baselineManifest:manifest,candidateGraph:fit.candidateGraph,id:id+'-candidate',ownerId:owner,now:clock()}),trial=createPaperForwardTrial({id,ownerId:owner,subscriptionId,baselineManifest:manifest,candidateManifest:candidate,initialCash:account.equity,createdAt:clock(),fitEvidenceHash:evidenceHash});
   trial.previousTrialRef=clone(sub.adaptation.forwardTrialRef);trial.restart={previousTrialId:priorTrial.id,previousReason:priorTrial.reason,requestedBy:owner,requestedAt:clock()};
   await saveTrial(trial,'explicit-restart');success=true;return json({ok:true,status:sub.adaptation.status,settings:sub.adaptation,trial:paperForwardTrialSummary(trial),revision:w.revision});
  }
  if(priorTrial&&!['KEEP_BASELINE','PROMOTED'].includes(priorTrial.status)){
   if(priorTrial.status==='INTERRUPTED'||!sub.adaptation.autoApply){success=true;return json({ok:true,status:sub.adaptation.status,settings:sub.adaptation,trial:paperForwardTrialSummary(priorTrial),revision:w.revision});}
   const retained=await store.read(owner,sub.adaptation.lastEvidence),fit=retained.fit,{evidenceHash,...source}=fit;
   check(hashInputPackage(source)===evidenceHash&&evidenceHash===priorTrial.fitEvidenceHash&&fit.sourceManifestHash===priorTrial.arms.baseline.manifestHash&&fit.candidateGraphHash===strategyGraphHash(priorTrial.arms.candidate.manifest.data.strategyPlan.graph)&&Math.abs(fit.selectedWeight-fit.currentWeight)<=sub.adaptation.maxWeightStep+1e-12,'FORWARD_FIT_CHANGED','비교 중인 후보와 선택 근거·비중 한도를 대조하세요.');
   const recovered=sub.pendingPins&&strategyGraphHash(w.mindManifests.find(m=>m.id===sub.pendingPins.manifestId)?.data?.strategyPlan?.graph)===fit.candidateGraphHash&&priorTrial.status==='READY_TO_PROMOTE';
   if(!recovered&&(sub.pins.manifestHash!==fit.sourceManifestHash||sub.pendingPins)){const next=clone(w);next.mindSubscriptions.find(s=>s.id===subscriptionId).adaptation.status='POLICY_CHANGED';await persist(next,':forward-policy-changed');success=true;return json({ok:true,status:'POLICY_CHANGED',revision:w.revision});}
   let trial=recovered?priorTrial:await advancePaperForwardTrial({trial:priorTrial,workspace:()=>w,repository,ownerId:owner,env,clock,fetchImpl:options.fetchImpl??fetch,marketLoader:options.marketLoader,resourceId,token:claim.token,onWorkspace:next=>{w=next;sub=w.mindSubscriptions.find(s=>s.id===subscriptionId);},persist:saveTrial});
   if(trial.status==='READY_TO_PROMOTE'){
    await verifyPaperForwardTrialEvidence({trial,repository,ownerId:owner,now:clock()});
    if(!recovered&&w.mindPositions.find(a=>a.id===sub.accountId)?.positions.length){success=true;return json({ok:true,status:'FORWARD_RUNNING',reason:'WAITING_ORIGINAL_ACCOUNT_FLAT',settings:sub.adaptation,trial:paperForwardTrialSummary(trial),revision:w.revision});}
    if(!recovered){
     const opts={...options,ownerId:owner,repository},key='paper-forward-'+trial.id.slice(-32),draft=await studioCall(request,env,opts,'/mind-documents/policy-draft',{mindId:sub.profileId,expectedSourceManifestHash:fit.sourceManifestHash,strategyPlanDraft:{preset:'BTC_SPOT_V1',enabled:true,strategyMaxExposure:manifest.data.riskPreset.maxExposure,graph:fit.candidateGraph},expectedRevision:w.revision,idempotencyKey:key+'-draft'});
     w=await readOperationalWorkspace(repository,owner);const published=await studioCall(request,env,opts,'/mind-documents/publish',{documentId:draft.document?.id??draft.documentId,reason:'동일 시장의 독립 모의계좌 비교에서 각 6건 이상 종료 거래와 현금 수익·낙폭을 검증했다. 전진 비교 '+trial.id,expectedRevision:w.revision,idempotencyKey:key+'-publish'});
     w=await readOperationalWorkspace(repository,owner);await studioCall(request,env,opts,'/mind-subscriptions/apply-version',{subscriptionId,manifestId:published.manifest.id,expectedRevision:w.revision,idempotencyKey:key+'-apply'});w=await readOperationalWorkspace(repository,owner);sub=w.mindSubscriptions.find(s=>s.id===subscriptionId);
    }
    const next=clone(w),a=next.mindSubscriptions.find(s=>s.id===subscriptionId).adaptation;await markApplied(a,sub.pendingPins,fit,store,owner,clock(),trial);trial={...trial,status:'PROMOTED',reason:'FORWARD_COMPARISON_PROMOTED',updatedAt:clock(),publishedManifestId:sub.pendingPins.manifestId,publishedManifestHash:sub.pendingPins.manifestHash};a.forwardTrialRef=await store.write(owner,trial);await persist(next,':forward-promoted');await saveTrial(trial,'promotion-evidence');
   }
   success=true;return json({ok:true,status:sub.adaptation.status,settings:sub.adaptation,trial:paperForwardTrialSummary(trial),revision:w.revision});
  }
  const retained=sub.adaptation.status==='REVIEW_REQUIRED'&&sub.adaptation.lastEvidence?await store.read(owner,sub.adaptation.lastEvidence):null;
  if(retained){const {evidenceHash,...original}=retained.fit??{};check(hashInputPackage(original)===evidenceHash&&retained.fit.sourceManifestHash===sub.adaptation.sourceManifestHash&&retained.fit.sourceGraphHash===strategyGraphHash(graph)&&retained.fit.createdAt<=clock()&&Math.abs(retained.fit.selectedWeight-retained.fit.currentWeight)<=sub.adaptation.maxWeightStep+1e-12,'ADAPTATION_RETAINED_PROOF','검증 후보와 원 정책·허용 변경 한도의 불변 근거를 확인하세요.');const verification=fitPaperEpisodeWeights({graph,settings:{...sub.adaptation,maxWeightStep:retained.fit.maxWeightStep,evaluatedEpisodeIds:[]},episodes:retained.fit.episodes,now:retained.fit.createdAt});check(verification.status==='REVIEW_REQUIRED'&&hashInputPackage(verification.training)===hashInputPackage(retained.fit.training)&&hashInputPackage(verification.holdout)===hashInputPackage(retained.fit.holdout)&&verification.candidateGraphHash===retained.fit.candidateGraphHash,'ADAPTATION_RETAINED_PROOF','보존한 거래로 검증 후보를 다시 계산하세요.');}
  if(sub.adaptation.sourceManifestHash!==mindDocumentHash(manifest)||sub.pendingPins){const next=clone(w);next.mindSubscriptions.find(s=>s.id===subscriptionId).adaptation.status='POLICY_CHANGED';await persist(next,':changed');success=true;return json({ok:true,status:'POLICY_CHANGED',revision:w.revision});}
  const intake=retained?.intake??collectPaperAdaptationEpisodes(w,sub,manifest,{now:clock()}),fit=retained?.fit??fitPaperEpisodeWeights({graph,settings:sub.adaptation,episodes:intake.episodes,now:clock()}),next=clone(w),a=next.mindSubscriptions.find(s=>s.id===subscriptionId).adaptation;
  if(!retained&&fit.status==='WAITING_EPISODES'&&a.lastResult?.status===fit.status&&a.lastResult?.count===fit.eligibleCount){success=true;return json({ok:true,status:fit.status,settings:a,revision:w.revision});}
  a.status=fit.status;a.lastResult={status:fit.status,count:fit.eligibleCount,minimumEpisodes:6,remaining:fit.remaining??0,currentWeight:fit.currentWeight,selectedWeight:fit.selectedWeight??fit.currentWeight,asOf:clock(),objective:fit.objective,evidenceClass:fit.evidenceClass};
  if(a.forwardValidation){a.forwardValidation.count=Math.max(a.forwardValidation.count,Math.min(6,fit.eligibleCount));a.forwardValidation.status=a.forwardValidation.count>=6?'OBSERVED':'WAITING_EPISODES';}
  if(fit.episodes){a.lastEvidence=await store.write(owner,{fit,intake});a.evaluatedEpisodeIds=[...new Set([...a.evaluatedEpisodeIds,...fit.episodes.map(e=>e.id)])];}
  await persist(next,':fit');
  if(fit.status==='REVIEW_REQUIRED'&&sub.adaptation.autoApply){
   const id='paper-forward-'+fit.evidenceHash.slice(0,32),candidate=createPaperTrialCandidateManifest({baselineManifest:manifest,candidateGraph:fit.candidateGraph,id:id+'-candidate',ownerId:owner,now:clock()}),account=w.mindPositions.find(a=>a.id===sub.accountId);
   check(account?.equity>0,'FORWARD_INITIAL_CASH','비교를 시작할 모의 평가자산을 확인하세요.');
   const trial=createPaperForwardTrial({id,ownerId:owner,subscriptionId,baselineManifest:manifest,candidateManifest:candidate,initialCash:account.equity,createdAt:clock(),fitEvidenceHash:fit.evidenceHash});await saveTrial(trial,'create');
  }
  success=true;return json({ok:true,status:sub.adaptation.status,settings:sub.adaptation,revision:w.revision});
 }catch(e){return json({ok:false,code:e.code??'ADAPTATION_FAILED',message:e.message},e.status??500);}finally{if(claim)await (success?completeClaim(repository.db,{ownerId:owner,resourceId,token:claim.token,nowMs:Date.parse(clock())}):releaseClaim(repository.db,{ownerId:owner,resourceId,token:claim.token,nowMs:Date.parse(clock()),status:'FAILED'})).catch(()=>{});}
}

/** Called after observation processing. Every update uses the same owner-scoped public handler. */
export async function runPaperAdaptations({request,env={},ownerId,repository,options={}}={}){
 const w=await readOperationalWorkspace(repository,ownerId),report={processed:0,results:[]};
 for(const sub of w?.mindSubscriptions??[]){if(sub.ownerId!==ownerId||sub.status!=='ENABLED'||!sub.adaptation?.enabled)continue;
  if(sub.adaptation.forwardTrialRef){const trial=await new StrategyLearningStore(repository.db).read(ownerId,sub.adaptation.forwardTrialRef),now=new Date(typeof options.now==='function'?options.now():options.now??Date.now()).toISOString();assertPaperForwardTrial(trial);if(trial.status==='INTERRUPTED'||['WAITING_START','RUNNING','READY_TO_PROMOTE'].includes(trial.status)&&(!sub.adaptation.autoApply||trial.status!=='READY_TO_PROMOTE'&&Date.parse(now)<Date.parse(trial.nextCloseAt)+300000||trial.status==='READY_TO_PROMOTE'&&w.mindPositions.find(a=>a.id===sub.accountId)?.positions.length))continue;}
  if(sub.adaptation.status==='POLICY_CHANGED'||sub.adaptation.status==='REVIEW_REQUIRED'&&!sub.adaptation.autoApply||sub.pendingPins&&sub.pendingPins.manifestId===sub.adaptation.pendingManifestId&&sub.pendingPins.manifestHash===sub.adaptation.sourceManifestHash)continue;
  const manifest=w.mindManifests.find(m=>m.id===sub.pins.manifestId);
  if(sub.adaptation.status==='WAITING_EPISODES'&&sub.adaptation.lastResult&&sub.adaptation.sourceManifestHash===mindDocumentHash(manifest)&&!sub.pendingPins){
   const intake=collectPaperAdaptationEpisodes(w,sub,manifest,{now:new Date(typeof options.now==='function'?options.now():options.now??Date.now()).toISOString()}),count=intake.episodes.filter(e=>!sub.adaptation.evaluatedEpisodeIds.includes(e.id)).length;
   if(count===sub.adaptation.lastResult.count)continue;
  }
  const current=await readOperationalWorkspace(repository,ownerId),response=await handlePaperAdaptationAPI(new Request(new URL(BASE+'/step',request.url),{method:'POST',headers:{'Content-Type':'application/json','oai-authenticated-user-id':ownerId},body:JSON.stringify({subscriptionId:sub.id,expectedRevision:current.revision,idempotencyKey:'paper-fit-tick-'+crypto.randomUUID()})}),env,{...options,ownerId,repository}),value=await response.json();report.processed++;report.results.push({subscriptionId:sub.id,status:value.status??value.code,ok:response.ok});
 }
 return report;
}
