import {JEV_EXECUTION_CALL_LIMIT} from '../dist/domain/jev-question.mjs';
import dataset from '../dist/data/btc-4h.json' with {type:'json'};
import historicalCorpus from './data/historical-market-corpus.json' with {type:'json'};
import {hashInputPackage} from '../dist/domain/workspace.mjs';
import {mindDocumentHash} from '../dist/domain/mind-manifest.mjs';
import {graphRequiresJev,strategyGraphHash} from '../dist/domain/strategy-graph.mjs';
import {createStrategyLearningPlan,strategyLearningParameterCatalog,prepareStrategyLearningDataset,assessStrategyLearningRun,selectStrategyLearningCandidate,proposeStrategyLearning,adoptStrategyLearningProposal,selectNextLearningBasis,buildStrategyLearningPaperPriorities} from '../dist/domain/strategy-learning.mjs';
import {WorkspaceRepository,readOperationalWorkspace} from './repository.mjs';
import {SimulationRepository} from './simulation-repository.mjs';
import {resolveStrategyLearningResearch,readStrategyLearningExecutionIntake,strategyLearningResearchProtocol} from './strategy-learning-research.mjs';
import {resolveStrategyLearningEventSource,strategyLearningEventSources,preflightEventStrategyLearning,eventLearningCallLimit,assessEventStrategyLearningRun} from './strategy-learning-event.mjs';
import {StrategyLearningStore} from './strategy-learning-store.mjs';
import {handleSimulationAPI,freezeSimulationWorkspaceInputs} from './simulations.mjs';
import {createSimulationState,nextSimulationFrame,validateSimulationConfig} from '../dist/domain/simulation.mjs';
import {buildSimulationVariant} from '../dist/domain/simulation-variant.mjs';
import {prepareSimulationFrame} from './simulation-engine.mjs';
import {mindRunEvidenceHash} from './mind-observation.mjs';
import {handleMindStudioAPI} from './mind-studio.mjs';
import {acquireClaim,completeClaim,releaseClaim,renewClaim} from './claims.mjs';

const BASE='/api/workspace/strategy-learning',clone=structuredClone;
const json=(v,status=200)=>Response.json(v,{status,headers:{'Cache-Control':'no-store'}});
const check=(ok,code,message,status=400)=>{if(!ok)throw Object.assign(new Error(message),{code,status});};
const identifier=v=>typeof v==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9_.:@-]{0,199}$/.test(v);
let preparedData;
const learningData=()=>preparedData??=prepareStrategyLearningDataset(dataset);
const manifestOf=(w,id,now)=>(w.mindManifests??[]).filter(m=>m.scope.profileId===id&&m.availableAt<=now).sort((a,b)=>b.data.version-a.data.version)[0];
const small=s=>s.summary??({id:s.id,name:s.name,mindId:s.mindId,status:s.status,executionState:s.executionState??null,revision:s.revision,createdAt:s.createdAt,updatedAt:s.updatedAt,archivedAt:s.archivedAt??null,training:s.plan.training,validation:s.plan.validation,candidateCount:s.plan.candidates.length,completed:s.jobs.filter(j=>j.assessment).length,jobCount:s.jobs.length,proposalStatus:s.proposal?.status??null,adoption:s.adoption??null});
function estimate(plan){const count=(window)=>(Date.parse(window.endAt)-Date.parse(window.startAt))/(plan.stepMs??14400000)+1,calls=g=>graphRequiresJev(g)?g.nodes.filter(n=>['VIBE','JEV_QUESTION'].includes(n.type)).length:0;return plan.candidates.reduce((n,c)=>n+count(plan.training)*calls(c.graph),0)+count(plan.validation)*(calls(plan.candidates.find(c=>c.baseline).graph)+Math.max(...plan.candidates.map(c=>calls(c.graph))));}
export function learningPaperObservationIntake(workspace,manifest,now){
 const sourceManifestHash=mindDocumentHash(manifest),eligible=[];
 for(const run of workspace.mindRuns??[]){
  const o=run.observation,execution=run.execution,observedAt=o?.observedAt,endAt=o?.period?.end;
  if(run.profileId!==manifest.scope.profileId||run.manifestId!==manifest.id||run.manifestHash!==sourceManifestHash||!execution||!['FILLED','NO_ORDER_REQUIRED'].includes(execution.status)||execution.outcomeRecord?.mode!=='paper'||execution.accountSnapshotAfter?.profileId!==run.profileId||!o||o.runId!==run.id||o.profileId!==run.profileId||o.source?.manifestHash!==sourceManifestHash||o.source?.runHash!==mindRunEvidenceHash(run)||!observedAt||!endAt||!Number.isFinite(Date.parse(observedAt))||!Number.isFinite(Date.parse(endAt))||endAt>observedAt||observedAt>now||!Number.isFinite(o.metrics?.netReturn)||!Number.isFinite(o.metrics?.benchmarkReturn))continue;
  eligible.push({runId:run.id,manifestId:run.manifestId,manifestHash:sourceManifestHash,instrumentId:run.instrumentId,decisionAt:run.asOf??run.createdAt,executionAt:execution.executedAt??execution.at??null,period:clone(o.period),observedAt,netReturn:o.metrics.netReturn,benchmarkReturn:o.metrics.benchmarkReturn,observationHash:hashInputPackage(o),runHash:hashInputPackage(run)});
 }
 return {contractVersion:'MATCHED_POLICY_MATURED_PAPER_OBSERVATIONS_V1',asOf:now,sourceManifestHash,count:eligible.length,items:eligible,role:'NEXT_CYCLE_RESEARCH_CONTEXT',diagnostic:'FIXED_POST_EXECUTION_POSITION_MARKOUT',rewardAuthority:'CANONICAL_HISTORICAL_CHILD_LEDGER',automaticWeightChange:false};
}
export function startLearningLeaseRenewal(db,{ownerId,resourceId,token,clock,intervalMs=20000}){
 let error=null,pending=Promise.resolve(),stopped=false;
 const renew=()=>{pending=pending.then(async()=>{if(error||stopped)return;try{await renewClaim(db,{ownerId,resourceId,token,nowMs:Date.parse(clock()),leaseMs:120000});}catch(e){error=e;}});return pending;};
 const timer=setInterval(renew,intervalMs);timer.unref?.();
 return {async check(){await renew();if(error)throw error;},async stop(){clearInterval(timer);await pending;stopped=true;}};
}
export function preflightStrategyLearningPlan({plan,sourceManifest,frozenInputs,researchKnowledge,now,owner}){
 const items=[],pin=frozenInputs.researchCorpus;
 let knowledge=frozenInputs.knowledge??[];
 if(pin){
  const entries=researchKnowledge??historicalCorpus.entries;
  check(entries.length===pin.count&&hashInputPackage(entries)===pin.hash,'LEARNING_KNOWLEDGE_PIN','고정한 학습 자료와 사전 확인 자료를 대조하세요.',409);
  knowledge=[...knowledge,...entries];
 }
 for(const phase of ['TRAIN','VALIDATION'])for(const candidate of plan.candidates){
  const window=phase==='TRAIN'?plan.training:plan.validation,requiresJev=graphRequiresJev(candidate.graph),frames=(Date.parse(window.endAt)-Date.parse(window.startAt))/14400000+1,maxCalls=requiresJev?frames*candidate.graph.nodes.filter(n=>['VIBE','JEV_QUESTION'].includes(n.type)).length:0;
  check(maxCalls<=JEV_EXECUTION_CALL_LIMIT,'LEARNING_CHILD_BUDGET',`${phase==='TRAIN'?'학습':'검증'} 후보별 JEV 호출은 최대 10000회입니다. 기간이나 연결한 판단 수를 줄이세요.`);
  check(new TextEncoder().encode(JSON.stringify(candidate.graph)).length<=30000,'LEARNING_GRAPH_SIZE','연결한 지침과 그래프는 후보별 30KB 이내로 구성하세요.');
  const manifest=buildSimulationVariant(sourceManifest,{preset:'CURRENT',graph:candidate.graph,knowledge:sourceManifest.data.externalKnowledge?.enabled??false},{now,owner}).manifest;
  const config={mindId:sourceManifest.scope.profileId,name:'학습 준비 확인',mode:'GRAPH_CANONICAL',...window,...plan.simulation,optInJev:requiresJev,maxJevCalls:maxCalls};
  const checked=validateSimulationConfig(dataset,config);check(checked.ok,checked.reasons[0]?.code??'LEARNING_COVERAGE',checked.reasons[0]?.message??'선택 기간의 자료를 확인하세요.');
  const state=createSimulationState(dataset,config,{id:'learning-preflight',manifest,now}),frame=nextSimulationFrame(state,dataset),simulation={...state,...frozenInputs,knowledge},prepared=prepareSimulationFrame({simulation,frame,now});
  const missingModules=(prepared.strategyEvaluation?.modules??[]).filter(m=>!m.ready);
  check(prepared.ready&&missingModules.length===0,'LEARNING_WARMUP',`${phase==='TRAIN'?'학습':'검증'} 시작 전 지표 이력이 부족합니다. 시작일을 뒤로 이동하거나 지표 기간을 줄이세요.`);
  items.push({candidateId:candidate.id,phase,window,frames,maximumProviderCalls:maxCalls,priceCoverage:'CONTIGUOUS_FULL_WINDOW',startingGraphHistory:'READY'});
 }
 return {contractVersion:'LEARNING_CHILD_PREFLIGHT_V1',items,observedAt:now,finalComparisonEligibility:'ALL_STORED_DECISIONS_READY_REQUIRED'};
}
async function internal(handler,parent,env,options,path,body){const r=await handler(new Request(new URL(path,parent.url),{method:'POST',headers:{'content-type':'application/json','oai-authenticated-user-id':options.ownerId},body:JSON.stringify(body)}),env,options);const value=await r.json();check(r.ok&&value.ok!==false,value.code??'LEARNING_CHILD',value.message??'연결된 실험을 확인하세요.',r.status);return value;}
async function persist(repository,evidence,owner,before,after,commandId,fence){const packed=await evidence.pack(owner,after,small(after)),latest=await readOperationalWorkspace(repository,owner);const current=latest.learningSessions.find(s=>s.id===before.id);check(current?.revision===before.revision,'LEARNING_CONFLICT','최신 학습 상태를 다시 조회하세요.',409);const next=clone(latest);next.learningSessions[next.learningSessions.findIndex(s=>s.id===before.id)]=packed;next.revision++;await repository.commit(owner,latest,next,commandId,fence);return after;}

export async function handleStrategyLearningAPI(request,env={},options={}){
 const url=new URL(request.url);if(!url.pathname.startsWith(BASE))return null;
 const owner=options.ownerId??request.headers.get('oai-authenticated-user-id');if(!owner)return json({ok:false,code:'UNAUTHORIZED',message:'로그인이 필요합니다.'},401);
 if(request.headers.get('Origin')&&request.headers.get('Origin')!==url.origin||request.headers.get('Sec-Fetch-Site')==='cross-site')return json({ok:false,code:'ORIGIN',message:'앱에서 다시 실행하세요.'},403);
 const clock=()=>new Date(typeof options.now==='function'?options.now():Date.now()).toISOString();let claim=null,db,leaseGuard=null;
 try{
  db=env.DB?.withSession?env.DB.withSession('first-primary'):env.DB;
  const repository=options.repository??new WorkspaceRepository(db),store=options.simulationRepository??new SimulationRepository(db),evidence=options.learningStore??new StrategyLearningStore(db),path=url.pathname.slice(BASE.length)||'',w=await readOperationalWorkspace(repository,owner);check(w,'LEARNING_WORKSPACE','마인드를 먼저 만드세요.',404);w.learningSessions??=[];
  const childOptions={...options,ownerId:owner,repository,simulationRepository:store};
  if(request.method==='GET'){
   if(path===''){check(!url.searchParams.has('archived')||['true','false'].includes(url.searchParams.get('archived')),'LEARNING_QUERY','보관함 필터를 확인하세요.');return json({ok:true,items:w.learningSessions.filter(s=>(!url.searchParams.get('mindId')||s.mindId===url.searchParams.get('mindId'))&&Boolean(s.archivedAt)===(url.searchParams.get('archived')==='true')).toReversed().map(small),revision:w.revision});}
   if(path==='/catalog'){const manifest=manifestOf(w,url.searchParams.get('mindId'),clock());check(manifest?.data.strategyPlan?.graph?.schemaVersion===2,'LEARNING_GRAPH_REQUIRED','실행 그래프를 발행한 마인드를 선택하세요.',409);const paperObservations=learningPaperObservationIntake(w,manifest,clock()),sources=await strategyLearningEventSources({env,options}),actualExecutionIntake=await readStrategyLearningExecutionIntake({db,owner,manifest,asOf:clock()});return json({ok:true,sources,researchProtocol:strategyLearningResearchProtocol(),actualExecutionIntake,manifest,parameterCatalog:strategyLearningParameterCatalog(manifest.data.strategyPlan.graph),paperObservations,paperResearchPriorities:buildStrategyLearningPaperPriorities(paperObservations),revision:w.revision,source:{startAt:new Date(dataset.bars[0][0]).toISOString(),endAt:new Date(dataset.bars.at(-1)[0]+14400000).toISOString()},evidenceClass:'RETROSPECTIVE_DEVELOPMENT'});}
   if(path==='/item'){const stored=w.learningSessions.find(s=>s.id===url.searchParams.get('id'));check(stored,'LEARNING_NOT_FOUND','저장된 학습을 찾을 수 없습니다.',404);const session=await evidence.unpack(owner,stored);return json({ok:true,session,revision:session.revision});}
  }
  check(request.method==='POST'&&['/create','/step','/adopt','/archive','/restore','/pause'].includes(path),'LEARNING_ROUTE','학습 요청 경로를 확인하세요.',404);
  const text=await request.text();check(new TextEncoder().encode(text).length<=100000,'LEARNING_SIZE','학습 설정은 100KB 이내로 입력하세요.',413);const body=JSON.parse(text);check(identifier(body.idempotencyKey)&&Number.isSafeInteger(body.expectedRevision),'LEARNING_COMMAND','요청 키와 저장 버전을 확인하세요.');
  const fingerprint=hashInputPackage({path,body:Object.fromEntries(Object.entries(body).filter(([key])=>!['idempotencyKey','expectedRevision'].includes(key)))}),now=clock();
  if(path==='/create'){
   const id='learning-'+hashInputPackage({owner,key:body.idempotencyKey}).slice(0,32),prior=w.learningSessions.find(s=>s.id===id);if(prior){check(prior.createFingerprint===fingerprint,'LEARNING_KEY_CONFLICT','같은 요청 키의 학습 조건을 유지하세요.',409);return json({ok:true,session:await evidence.unpack(owner,prior),revision:prior.revision,idempotent:true});}
   check(w.revision===body.expectedRevision,'LEARNING_CONFLICT','최신 마인드를 다시 조회하세요.',409);
   const sourceManifest=manifestOf(w,body.mindId,now);check(sourceManifest,'LEARNING_MIND','발행한 마인드를 선택하세요.',404);
   let nextBasis=null,cycleLineage=null;
   if(body.previousSessionId){
    const storedPrevious=w.learningSessions.find(s=>s.id===body.previousSessionId);check(storedPrevious&&storedPrevious.mindId===body.mindId&&storedPrevious.status==='COMPLETED','LEARNING_PARENT','완료된 같은 마인드의 학습을 선택하세요.');
    const previous=await evidence.unpack(owner,storedPrevious);nextBasis=selectNextLearningBasis(previous);
    const requestedGraphHash=strategyGraphHash(body.graph??nextBasis.graph);
    cycleLineage={contractVersion:'LEARNING_CYCLE_LINEAGE_V1',previousSessionId:previous.id,previousPlanHash:previous.plan.hash,previousProposalHash:nextBasis.proposalHash,previousAdoptionHash:nextBasis.adoptionHash,basisGraphHash:nextBasis.graphHash,basisReason:nextBasis.reason,requestedGraphHash,graphOrigin:requestedGraphHash===nextBasis.graphHash?'PREVIOUS_RESEARCH_BASIS':'EXPLICIT_RESEARCH_EDIT',authority:'USER_AUTHORED_RESEARCH'};
   }
   const eventSource=await resolveStrategyLearningEventSource(body.source,{env,options,createdAt:now});
   const researchPin=eventSource?null:await store.freezeKnowledge(owner,historicalCorpus.entries),frozenInputs=eventSource?.frozenInputs??{...freezeSimulationWorkspaceInputs(w,sourceManifest,body.validation.endAt),researchCorpus:{...researchPin,corpusId:historicalCorpus.id,sourceHash:historicalCorpus.sourceHash},knowledgeReplay:{contract:'PUBLICATION_TIME_RESEARCH_V1',frozenAt:now}};
   const research=await resolveStrategyLearningResearch({db,owner,workspace:w,sourceManifest,research:body.research,createdAt:now}),actualExecutionIntake=await readStrategyLearningExecutionIntake({db,owner,manifest:sourceManifest,asOf:now});
   const inputContextHash=hashInputPackage({frozenInputs,...(research?{researchHash:research.hash}:{}),policy:{...sourceManifest.data,strategyPlan:null}});
   const plan=createStrategyLearningPlan({id,graph:body.graph??nextBasis?.graph??sourceManifest.data.strategyPlan.graph,datasetHash:eventSource?.datasetHash??learningData().datasetHash,...(eventSource?{source:eventSource.source}:{}),inputContextHash,parameters:body.parameters,training:body.training,validation:body.validation,simulation:body.simulation,...(body.objective?{objective:body.objective}:{}),createdAt:now});
   const estimatedCalls=estimate(plan);check(Number.isInteger(body.maxJevCalls)&&body.maxJevCalls>=0&&body.maxJevCalls<=4096,'LEARNING_BUDGET','전체 JEV 호출 한도는 0~4096회로 입력하세요.');check(!estimatedCalls||body.optInJev===true&&body.maxJevCalls>=estimatedCalls,'LEARNING_BUDGET','전체 후보와 검증 기간을 포함한 JEV 호출 한도를 확인하세요.');
   check(plan.validation.endAt<=now,'LEARNING_PERIOD','확정된 과거 기간을 선택하세요.');
   const preflight=eventSource?await preflightEventStrategyLearning({plan,sourceManifest,eventSource,env,options,now,owner}):preflightStrategyLearningPlan({plan,sourceManifest,frozenInputs,researchKnowledge:await store.frozenKnowledge(owner,frozenInputs.researchCorpus),now,owner});
   const paperObservations=learningPaperObservationIntake(w,sourceManifest,now),paperResearchPriorities=buildStrategyLearningPaperPriorities(paperObservations);
   const session={id,contractVersion:'strategy-learning-session-v1',revision:0,name:String(body.name||'전략 튜닝').slice(0,160),mindId:body.mindId,createdAt:now,updatedAt:now,status:'TRAINING',createFingerprint:fingerprint,sourceManifest:clone(sourceManifest),sourceManifestHash:mindDocumentHash(sourceManifest),frozenInputs,plan,preflight,research,actualExecutionIntake,paperObservations,paperResearchPriorities,cycleLineage,estimatedCalls,budget:{maximum:body.maxJevCalls,reserved:0,completed:0},previousSessionId:body.previousSessionId??null,jobs:plan.candidates.map(c=>({phase:'TRAIN',candidateId:c.id,simulationId:null,assessment:null})),selection:null,proposal:null,adoption:null,receipts:[]};
   const next=clone(w);next.learningSessions.push(await evidence.pack(owner,session,small(session)));next.revision++;await repository.commit(owner,w,next,body.idempotencyKey);return json({ok:true,session,revision:session.revision});
  }
  const stored=w.learningSessions.find(s=>s.id===body.id);check(stored,'LEARNING_NOT_FOUND','저장된 학습을 찾을 수 없습니다.',404);const before=await evidence.unpack(owner,stored),prior=before.receipts.find(r=>r.key===body.idempotencyKey);if(prior){check(prior.fingerprint===fingerprint,'LEARNING_KEY_CONFLICT','같은 요청의 내용을 유지하세요.',409);return json({ok:true,session:before,revision:before.revision,documentId:before.adoption?.documentId,idempotent:true});}
  check(before.revision===body.expectedRevision,'LEARNING_CONFLICT','최신 학습 상태를 다시 조회하세요.',409);
  const resourceId='strategy-learning:'+before.id;claim=await acquireClaim(db,{ownerId:owner,resourceId,key:body.idempotencyKey,fingerprint,baseRevision:before.revision,nowMs:Date.parse(now),leaseMs:120000});
  leaseGuard=startLearningLeaseRenewal(db,{ownerId:owner,resourceId,token:claim.token,clock});
  const currentHead=(await readOperationalWorkspace(repository,owner)).learningSessions.find(s=>s.id===before.id);check(currentHead?.revision===before.revision,'LEARNING_CONFLICT','최신 학습 상태를 다시 조회하세요.',409);
  const after=clone(before);
  if(path==='/step')check(!before.archivedAt,'LEARNING_ARCHIVED','보관함에서 복원한 뒤 학습을 이어가세요.',409);
  if(path==='/archive'||path==='/restore'){
   for(const job of before.jobs.filter(j=>j.simulationId)){const child=await store.get(owner,job.simulationId);check(child&&child.status!=='RUNNING'&&child.attempt?.status!=='JEV_STARTED','LEARNING_PAUSE_REQUIRED','진행 중인 학습을 먼저 일시중지하세요.',409);}
   after.archivedAt=path==='/archive'?now:null;
  }else if(path==='/pause'){
   for(const job of after.jobs.filter(j=>j.simulationId&&!j.assessment)){
    const child=await store.get(owner,job.simulationId);check(child&&child.attempt?.status!=='JEV_STARTED','LEARNING_PAUSE_PENDING','현재 판단의 저장이 끝난 뒤 일시중지하세요.',409);
    if(child.status==='RUNNING'){const paused=await internal(handleSimulationAPI,request,env,childOptions,'/api/workspace/simulations/pause',{id:child.id,expectedRevision:child.revision,idempotencyKey:'learn-pause-'+hashInputPackage({id:after.id,key:body.idempotencyKey,child:child.id}).slice(0,40)});job.progress={processed:paused.simulation.progress.processed,total:paused.simulation.progress.total,status:paused.simulation.status};}
   }
   after.executionState=after.status==='COMPLETED'?'COMPLETED':'PAUSED';
  }else if(path==='/adopt'){
   check(!before.archivedAt,'LEARNING_ARCHIVED','보관함에서 복원한 뒤 전략 초안을 저장하세요.',409);
   check(before.status==='COMPLETED'&&before.proposal,'LEARNING_PROPOSAL','검증이 끝난 학습 결과를 선택하세요.',409);
   const current=manifestOf(w,before.mindId,now);check(mindDocumentHash(current)===before.sourceManifestHash,'LEARNING_SOURCE_CHANGED','현재 정책에서 새 학습을 시작하세요.',409);
   const adopted=adoptStrategyLearningProposal({proposal:before.proposal,currentGraph:before.plan.graph??before.plan.candidates.find(c=>c.baseline).graph,adoptedAt:now});
   const result=await internal(handleMindStudioAPI,request,env,{...childOptions,learningAdoption:{sessionId:before.id,adoption:adopted.adoption}},'/api/workspace/mind-documents/policy-draft',{mindId:before.mindId,strategyPlanDraft:{preset:'BTC_SPOT_V1',enabled:true,strategyMaxExposure:current.data.riskPreset.maxExposure,graph:adopted.graph},expectedRevision:w.revision,idempotencyKey:'adopt-'+before.id});
   after.adoption={...adopted.adoption,documentId:result.document?.id??result.documentId,adoptedAt:now,authority:'DRAFT_ONLY'};
  }else if(before.status!=='COMPLETED'){
   check(!before.archivedAt,'LEARNING_ARCHIVED','보관함에서 복원한 뒤 학습을 이어가세요.',409);
   after.executionState='ACTIVE';
   let job=after.jobs.find(j=>!j.assessment);
   if(job){
    const candidate=after.plan.candidates.find(c=>c.id===job.candidateId),window=job.phase==='TRAIN'?after.plan.training:after.plan.validation;
    const currentEventSource=after.plan.source?await resolveStrategyLearningEventSource(Object.fromEntries(Object.entries(after.plan.source).filter(([k])=>!['timeframe','quoteCurrency'].includes(k))),{env,options,createdAt:after.createdAt}):null;
    if(currentEventSource)check(currentEventSource.datasetHash===after.plan.datasetHash&&hashInputPackage(currentEventSource.frozenInputs)===hashInputPackage(after.frozenInputs),'LEARNING_EVENT_SOURCE_CHANGED','원 학습에 고정한 종목·호가·수수료·주문 규칙으로 계속하세요.',409);
    const stepOptions=currentEventSource?{...childOptions,eventDatasets:Object.fromEntries(currentEventSource.datasets.map(d=>[d.id,d]))}:childOptions;
    if(!job.simulationId){
     const currentWorkspace=await readOperationalWorkspace(repository,owner),baseline=after.jobs.find(j=>j.phase==='TRAIN'&&j.simulationId);
     const childKey='learn-'+hashInputPackage({id:after.id,phase:job.phase,candidateId:job.candidateId}).slice(0,40);
     const workspace={...currentWorkspace,mindManifests:[after.sourceManifest]};
     const value=await internal(handleSimulationAPI,request,env,{...stepOptions,workspace,frozenInputsOverride:after.frozenInputs},'/api/workspace/simulations/create',{mindId:after.mindId,name:(after.name+' · '+(job.phase==='TRAIN'?'학습':'검증')+' · '+(candidate.baseline?'기준 전략':'후보 '+after.plan.candidates.indexOf(candidate))).slice(0,160),mode:'GRAPH_CANONICAL',...window,...after.plan.simulation,optInJev:graphRequiresJev(candidate.graph),maxJevCalls:after.plan.source?eventLearningCallLimit(after.plan,candidate,job.phase):Math.min(JEV_EXECUTION_CALL_LIMIT,after.budget.maximum),...(after.plan.source?Object.fromEntries(Object.entries(after.plan.source).filter(([k])=>!['timeframe','quoteCurrency'].includes(k))):{}),labSpec:{preset:'CURRENT',graph:candidate.graph,knowledge:after.sourceManifest.data.externalKnowledge?.enabled??false},...(!after.plan.source&&baseline?{sourceSimulationId:baseline.simulationId}:{}),expectedRevision:currentWorkspace.revision,idempotencyKey:childKey});job.simulationId=value.simulation.id;
    }
    let head=await store.get(owner,job.simulationId);
    if(!['COMPLETED','FAILED','ACTION_REQUIRED'].includes(head.status)){
     const value=await internal(handleSimulationAPI,request,env,{...stepOptions,learningBudgetContext:{id:after.id,maximum:after.budget.maximum,simulationIds:after.jobs.map(j=>j.simulationId).filter(Boolean)}},'/api/workspace/simulations/step',{id:head.id,expectedRevision:head.revision,idempotencyKey:'learn-step-'+hashInputPackage({id:head.id,revision:head.revision}).slice(0,40)});head=await store.get(owner,value.simulation.id);
    }
    job.progress={processed:head.core.cursor,total:head.core.coverage.totalDecisionFrames,status:head.status};job.execution=head.execution?{phase:head.execution.phase,sequence:head.execution.sequence}:null;
    if(['FAILED','ACTION_REQUIRED'].includes(head.status)){after.status='ACTION_REQUIRED';after.lastError={...head.lastError,simulationId:head.id};}
    else if(head.status==='COMPLETED'){
     const rows={};for(const kind of ['decisions','fills','curve'])rows[kind]=await store.allRows(owner,head.id,kind);
     const assessmentContext={plan:after.plan,candidateId:candidate.id,phase:job.phase,inputContextHash:hashInputPackage({frozenInputs:head.frozenInputs,...(after.research?{researchHash:after.research.hash}:{}),policy:{...after.sourceManifest.data,strategyPlan:null}}),observedAt:clock()};
     job.assessment=after.plan.source?await assessEventStrategyLearningRun({...assessmentContext,head,rows,eventSource:currentEventSource,store,owner}):assessStrategyLearningRun({...assessmentContext,state:head.core,report:head.report,rows,dataset:learningData()});after.status=job.phase==='TRAIN'?'TRAINING':'VALIDATING';after.lastError=null;
    }
    else{after.status=job.phase==='TRAIN'?'TRAINING':'VALIDATING';after.lastError=null;}
    for(const savedJob of after.jobs.filter(j=>j.simulationId)){const savedHead=await store.get(owner,savedJob.simulationId);savedJob.calls={reserved:savedHead.jevBudget.reserved,completed:savedHead.jevBudget.completed};}after.budget.reserved=after.jobs.reduce((n,j)=>n+(j.calls?.reserved??0),0);after.budget.completed=after.jobs.reduce((n,j)=>n+(j.calls?.completed??0),0);check(after.budget.reserved<=after.budget.maximum,'LEARNING_BUDGET','전체 호출 예산을 확인하세요.',409);
   }
   if(after.jobs.every(j=>j.assessment)&&!after.selection){
    after.selection=selectStrategyLearningCandidate({plan:after.plan,assessments:after.jobs.map(j=>j.assessment),selectedAt:clock()});
    const baseline=after.plan.candidates.find(c=>c.baseline),selectedId=after.selection.candidateId??after.selection.selectedCandidateId;
    after.jobs.push(...[...new Set([baseline.id,selectedId])].map(candidateId=>({phase:'VALIDATION',candidateId,simulationId:null,assessment:null})));after.status='VALIDATING';
   }else if(after.selection&&after.jobs.every(j=>j.assessment)){
    after.proposal=proposeStrategyLearning({plan:after.plan,selection:after.selection,validation:after.jobs.filter(j=>j.phase==='VALIDATION').map(j=>j.assessment),createdAt:clock()});after.status='COMPLETED';
   }
  }
  after.revision++;after.updatedAt=clock();after.receipts.push({key:body.idempotencyKey,fingerprint,revision:after.revision});check(after.receipts.length<=4000,'LEARNING_STEP_LIMIT','새 학습 주기를 시작하세요.',409);
  await leaseGuard.check();await persist(repository,evidence,owner,before,after,body.idempotencyKey,{resourceId,token:claim.token,nowMs:Date.parse(clock())});await completeClaim(db,{ownerId:owner,resourceId,token:claim.token,nowMs:Date.parse(clock())});claim=null;
  return json({ok:true,session:after,revision:after.revision,...(after.adoption?{documentId:after.adoption.documentId}:{})});
 }catch(error){if(claim)await releaseClaim(db,{ownerId:owner,resourceId:claim.resourceId,token:claim.token,nowMs:Date.parse(clock())}).catch(()=>{});return json({ok:false,code:error.code??'LEARNING_ERROR',message:error.message??'학습 설정을 확인하세요.'},error.status??400);}finally{await leaseGuard?.stop();}
}
