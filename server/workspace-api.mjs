import {studioWorkspaceResponse} from './studio-workspace-view.mjs';
import { WorkspaceRepository, RepositoryError, readOperationalWorkspace } from './repository.mjs';
import { createWorkspace, dispatchWorkspaceAction, hashInputPackage, validateWorkspace, WORKSPACE_ACTIONS } from '../dist/domain/workspace.mjs';
import { addKnowledge, updateKnowledge, reviewKnowledge, importKnowledge } from '../dist/knowledge.mjs';
import seed from '../dist/data/knowledge-seed.json' with { type:'json' };
import dataset from '../dist/data/btc-4h.json' with { type:'json' };
import {acquireClaim,assertClaim,completeClaim,releaseClaim,listInFlightClaims} from './claims.mjs';
import {RESEARCH_ACTIONS} from '../dist/domain/research.mjs';
import {createJobsState,dispatchJobAction} from '../dist/domain/jobs.mjs';
import {SHARED_WORKSPACE_ACTIONS,dispatchSharedWorkspaceAction,mirrorSharedExecution} from './shared-execution.mjs';
import {observationAvailability,decisionReadModel} from './read-model.mjs';
import {configuredMarketProvider,marketProvider} from './market-providers.mjs';
import {buildPortfolioView,PortfolioViewError} from './portfolio-views.mjs';
import {assertLegacyCommandAvailable} from './execution-ownership.mjs';
import {investmentLifecycleGuard} from './investment-lifecycle-guard.mjs';
const jsonResponse=(value,status=200,headers={})=>Response.json(value,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...headers}});
const publicActions=WORKSPACE_ACTIONS.filter(t=>!['decision.persist','audit.append'].includes(t));
function mergeBrowserNotes(current,incoming,now){
  const imported=importKnowledge(JSON.stringify(incoming));let knowledge=structuredClone(current);
  for(const item of imported.items){const existing=knowledge.items.find(n=>n.id===item.id);if(existing){if(['title','text','kind','sourceTitle','sourceLocator'].some(k=>existing[k]!==item[k]))throw new RepositoryError('NOTE_IMPORT_CONFLICT','같은 노트의 본문이 다릅니다. 서버 노트를 확인한 뒤 별도 항목으로 가져오세요.');}else knowledge.items.push({...structuredClone(item),status:'proposed',review:null});}
  importKnowledge(JSON.stringify(knowledge));
  let pending=imported.items.filter(n=>n.status==='approved'&&n.review?.decision==='approved');
  while(pending.length){let progress=false;const rest=[];for(const item of pending){const existing=knowledge.items.find(n=>n.id===item.id);if(existing.status==='approved'){progress=true;continue;}try{knowledge=reviewKnowledge(knowledge,item.id,{decision:'approved',reason:('브라우저 검토 가져오기: '+item.review.reason).slice(0,1000)},{now});progress=true;}catch(error){if(error.code!=='UNREVIEWED_EVIDENCE')throw error;rest.push(item);}}if(!progress)break;pending=rest;}
  return knowledge;
}
async function readBody(request){
  if(!request.headers.get('Content-Type')?.startsWith('application/json'))throw new RepositoryError('INVALID_JSON','입력 형식을 확인하세요.',400);
  const reader=request.body?.getReader();if(!reader)throw new RepositoryError('INVALID_JSON','입력 항목을 확인하세요.',400);
  const chunks=[];let bytes=0;while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.length;if(bytes>200000){await reader.cancel();throw new RepositoryError('BODY_TOO_LARGE','한 번에 보낼 자료의 범위를 줄여 주세요.',413);}chunks.push(value);}
  const buffer=new Uint8Array(bytes);let offset=0;for(const chunk of chunks){buffer.set(chunk,offset);offset+=chunk.length;}const text=new TextDecoder().decode(buffer);
  const body=JSON.parse(text);if(!body||typeof body!=='object'||Array.isArray(body))throw new RepositoryError('INVALID_JSON','입력 항목을 확인하세요.',400);return body;
}
const auditCommand=body=>({type:'audit.append',payload:{eventType:'WORKSPACE_RESOURCE_CHANGED',resourceType:'workspace',resourceId:'research',payload:{action:body.type,inputHash:hashInputPackage(body.payload)}},idempotencyKey:body.idempotencyKey,expectedRevision:body.expectedRevision});
export async function handleWorkspaceAPI(request,env={},options={}){
  const url=new URL(request.url), owner=request.headers.get('oai-authenticated-user-id');
  const studioView=request.headers.get('X-Workspace-View')==='studio'||url.pathname==='/api/workspace'&&url.searchParams.get('view')==='studio';
  let responseRepository=null;
  const response=async(payload,status=200,headers={})=>{const value=!studioView&&payload?.workspace&&responseRepository?{...payload,workspace:await responseRepository.exportWorkspace(owner,payload.workspace)}:payload;return jsonResponse(studioView?studioWorkspaceResponse(value):value,status,headers);};
  if(!owner)return await response({ok:false,code:'UNAUTHORIZED',message:'로그인이 필요합니다.'},401);
  if(request.headers.get('Origin')&&request.headers.get('Origin')!==url.origin||request.headers.get('Sec-Fetch-Site')==='cross-site')return await response({ok:false,code:'ORIGIN',message:'앱에서 다시 실행하세요.'},403);
  try{
    const database=env.DB?.withSession?env.DB.withSession('first-primary'):env.DB;
    if(url.pathname==='/api/workspace/simulations'||url.pathname.startsWith('/api/workspace/simulations/')){
      const {handleSimulationAPI}=await import('./simulations.mjs');
      return handleSimulationAPI(request,{...env,DB:database},{...options,ownerId:owner,repository:new WorkspaceRepository(database)});
    }
    const repository=new WorkspaceRepository(database), now=typeof options.now==='function'?new Date(options.now()).toISOString():options.now??new Date().toISOString(),nowWallStart=Date.now();
    responseRepository=repository;
    let workspace=await readOperationalWorkspace(repository,owner,()=>({...createWorkspace({now}),knowledge:importKnowledge(JSON.stringify(seed.knowledge))}));
    if(url.pathname==='/api/workspace/market-captures/status'&&request.method==='GET'){
      const {buildCanonicalBtcCollectionStatus}=await import('./market-data-collect.mjs');
      return await response({ok:true,revision:workspace.revision,collection:buildCanonicalBtcCollectionStatus(workspace,{now})});
    }
    if(url.pathname==='/api/workspace/portfolio-view'&&request.method==='GET'){
      const allowed=new Set(['comparisonId','profileId','view','pageSize','cursor','status','search']);
      for(const key of url.searchParams.keys())if(!allowed.has(key)||url.searchParams.getAll(key).length!==1)throw new PortfolioViewError('INVALID_PORTFOLIO_QUERY','조회 조건을 확인하세요.',400);
      return await response({ok:true,portfolio:buildPortfolioView(workspace,Object.fromEntries(url.searchParams),{now})});
    }
    if(url.pathname==='/api/workspace'&&request.method==='GET'){const inFlight=(await listInFlightClaims(database,{ownerId:owner,nowMs:Date.parse(now)})).map(({resourceId,status,leaseUntil,startedAt,expired})=>({resourceId,status,leaseUntil,startedAt,expired}));return await response({ok:true,workspace,inFlight,storage:'server',market:{provider:configuredMarketProvider(env),providerLabel:marketProvider(configuredMarketProvider(env)).label,origin:marketProvider(configuredMarketProvider(env)).origin,startAt:dataset.startAt,endAt:dataset.endAt,defaultAsOf:new Date(dataset.bars.at(-2)[0]+14400000).toISOString(),instruments:['BTCUSDT']}});}
    if(url.pathname==='/api/workspace/observations/availability'&&request.method==='GET'){
      const availability=observationAvailability(workspace,url.searchParams.get('experienceId'),{horizonHours:Number(url.searchParams.get('horizonHours')??24),now,historicalDataset:dataset});
      if(!availability)throw new RepositoryError('RESOURCE_NOT_FOUND','관측할 투자 경험을 선택하세요.',404);
      return await response({ok:true,availability});
    }
    if(url.pathname==='/api/workspace/decisions/detail'&&request.method==='GET'){
      const decision=decisionReadModel(workspace,url.searchParams.get('id'));
      if(!decision)throw new RepositoryError('RESOURCE_NOT_FOUND','실행 기록을 선택하세요.',404);
      return await response({ok:true,decision});
    }
    if(url.pathname==='/api/workspace/connections/market'&&request.method==='GET'){
      const {loadPublicMarket}=await import('./market-providers.mjs'),provider=marketProvider(configuredMarketProvider(env));
      try{const value=await loadPublicMarket({provider:provider.id,fetchImpl:options.fetchImpl});return await response({ok:true,connection:{status:'connected',provider:provider.id,providerLabel:provider.label,origin:provider.origin,checkedAt:now,latestClosedAsOf:value.manifest.latestClosedAsOf,receivedAt:value.manifest.receivedAt,candleCount:value.manifest.candleCount,dailyCandleCount:value.manifest.dailyCandleCount,sourceSnapshotId:value.sourceSnapshot.id,sourceHash:value.manifest.datasetSha256}});}
      catch(error){if(error.name!=='MarketDataError')throw error;return await response({ok:true,connection:{status:'error',provider:provider.id,providerLabel:provider.label,origin:provider.origin,checkedAt:now,code:error.code,message:error.message,...(error.diagnostic?{diagnostic:error.diagnostic}:{})}});}
    }
    if(url.pathname==='/api/workspace/market-snapshot'&&request.method==='GET'){
      const id=url.searchParams.get('id');if(!id||!/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,199}$/.test(id))throw new RepositoryError('INVALID_OBJECT','조회할 시세 원본을 선택하세요.',400);
      const snapshot=await repository.readObject(owner,'marketSnapshots',id);if(!snapshot)throw new RepositoryError('MARKET_SNAPSHOT_MISSING','저장된 시세 원본을 찾을 수 없습니다.',404);
      return await response({ok:true,snapshot});
    }
    if(request.method!=='POST')return await response({ok:false,message:'요청 경로를 확인하세요.'},404);
    const body=await readBody(request), actorOptions={now,actorId:owner};let changed;
    await repository.hydrateReceiptKeys(owner,workspace,[body.idempotencyKey]);
    assertLegacyCommandAvailable(workspace,url.pathname,body);
    if(url.pathname==='/api/workspace/market-captures/collect'){
      const {buildCanonicalBtcCollectionStatus,collectOwnerCanonicalBtc,canonicalCollectionFailure}=await import('./market-data-collect.mjs');
      const kind='market.capture.collect',resourceId='market-capture:okx:BTC-USDT',instrumentId='crypto:okx:BTC-USDT',clock=()=>new Date(typeof options.now==='function'?options.now():options.now??Date.now()).toISOString();
      if(Object.keys(body).some(k=>!['provider','instrumentId','expectedRevision','idempotencyKey'].includes(k))||body.provider!=='okx'||body.instrumentId!==instrumentId||!Number.isSafeInteger(body.expectedRevision)||body.expectedRevision<0||typeof body.idempotencyKey!=='string'||!/^[a-zA-Z0-9][a-zA-Z0-9_.:@-]{0,199}$/.test(body.idempotencyKey))throw new RepositoryError('INVALID_MARKET_COLLECTION','OKX BTC 정본의 요청 키와 최신 저장 버전을 확인하세요.',400);
      const fingerprint=hashInputPackage({type:kind,provider:body.provider,instrumentId}),saved=workspace.commandReceipts.find(receipt=>receipt.key===body.idempotencyKey);
      if(saved){if(saved.type!==kind||saved.fingerprint!==fingerprint)throw new RepositoryError('IDEMPOTENCY_CONFLICT','같은 요청 키의 자료 수집 조건이 변경되었습니다.',409);return await response({...saved.result.response,revision:workspace.revision,idempotent:true,collection:buildCanonicalBtcCollectionStatus(workspace,{now:clock()})},saved.result.httpStatus,saved.result.retryAfter?{'Retry-After':saved.result.retryAfter}:{});}
      if(body.expectedRevision!==workspace.revision)throw new RepositoryError('REVISION_CONFLICT','최신 자료 상태를 다시 조회한 뒤 수집하세요.',409);
      const acquired=await acquireClaim(database,{ownerId:owner,resourceId,key:body.idempotencyKey,fingerprint,baseRevision:workspace.revision,nowMs:Date.parse(now),leaseMs:120000}),token=acquired.token;
      const store=async(next,outcome,httpStatus,at,eventType,payload,retryAfter=null)=>{
        const prepare=(base,target,value,persistedAt)=>{
          target.revision=base.revision+1;target.updatedAt=persistedAt;
          target.activityEvents.push({id:'event-'+crypto.randomUUID(),eventType,resourceType:'market-data',resourceId:instrumentId,occurredAt:at,actorId:owner,payload});
          target.commandReceipts.push({id:'receipt-'+crypto.randomUUID(),key:body.idempotencyKey,type:kind,fingerprint,revision:target.revision,createdAt:persistedAt,result:{response:value,httpStatus,retryAfter}});
          const errors=validateWorkspace(target);if(errors.length)throw new RepositoryError(errors[0].code,errors[0].message,400);
        };
        prepare(workspace,next,outcome,at);
        try{await repository.commit(owner,workspace,next,body.idempotencyKey,{resourceId,token,nowMs:Date.parse(at)});}
        catch(error){
          // Only failure bookkeeping may be rebased once. No public request or
          // captured source is retried, and the winning financial state stays
          // exactly as the latest owner repository returned it.
          if(httpStatus!==503||eventType!=='MARKET_CAPTURE_COLLECTION_FAILED'||error.code!=='REVISION_CONFLICT')throw error;
          await assertClaim(database,{ownerId:owner,resourceId,token,nowMs:Date.parse(clock())});
          const current=await readOperationalWorkspace(repository,owner,undefined,[body.idempotencyKey]),prior=current.commandReceipts.find(receipt=>receipt.key===body.idempotencyKey);
          if(prior){
            if(prior.type!==kind||prior.fingerprint!==fingerprint)throw new RepositoryError('IDEMPOTENCY_CONFLICT','같은 요청 키의 처리 내용이 변경되었습니다.',409);
            await completeClaim(database,{ownerId:owner,resourceId,token,nowMs:Date.parse(clock())});
            return await response({...prior.result.response,revision:current.revision,idempotent:true,collection:buildCanonicalBtcCollectionStatus(current,{now:clock()})},prior.result.httpStatus,prior.result.retryAfter?{'Retry-After':prior.result.retryAfter}:{});
          }
          const persistedAt=clock();next=structuredClone(current);
          const preview={...next,activityEvents:[...next.activityEvents,{eventType,occurredAt:at,payload}]};
          outcome={...outcome,collection:buildCanonicalBtcCollectionStatus(preview,{now:persistedAt})};
          prepare(current,next,outcome,persistedAt);
          await repository.commit(owner,current,next,body.idempotencyKey,{resourceId,token,nowMs:Date.parse(persistedAt)});
        }
        await completeClaim(database,{ownerId:owner,resourceId,token,nowMs:Date.parse(clock())});
        return await response({...outcome,revision:next.revision},httpStatus,retryAfter?{'Retry-After':retryAfter}:{});
      };
      try{
        let collected;
        try{collected=await collectOwnerCanonicalBtc({workspace,now,clock,fetchImpl:options.fetchImpl,env});}
        catch(error){
          if(['MARKET_CAPTURE_SETTLING','MARKET_CAPTURE_COOLDOWN'].includes(error.code)){await releaseClaim(database,{ownerId:owner,resourceId,token,nowMs:Date.parse(clock()),status:'FAILED'});return await response({ok:false,code:error.code,message:error.message,revision:workspace.revision,collection:error.collection??buildCanonicalBtcCollectionStatus(workspace,{now:clock()})},error.status??409);}
          const at=clock(),lastError=canonicalCollectionFailure(error,{now:at}),next=structuredClone(workspace);
          const failurePayload={provider:'okx',instrumentId,...lastError};
          const preview={...next,activityEvents:[...next.activityEvents,{eventType:'MARKET_CAPTURE_COLLECTION_FAILED',occurredAt:at,payload:failurePayload}]};
          const retryAfter=lastError.retryAfter??null,outcome={ok:false,code:lastError.code??'MARKET_CAPTURE_FAILED',message:'OKX 정본 수집을 완료하지 못했습니다. 다음 허용 시각 이후에 다시 수집하세요.',errorSource:'MARKET_PROVIDER',collection:buildCanonicalBtcCollectionStatus(preview,{now:at})};
          return await store(next,outcome,503,at,'MARKET_CAPTURE_COLLECTION_FAILED',failurePayload,retryAfter);
        }
        const at=clock(),next=structuredClone(workspace),snapshot=collected.snapshot;
        if(!snapshot?.id)throw new RepositoryError('MARKET_CAPTURE_INCOMPLETE','수집한 원본의 식별자와 시세 명세를 확인하세요.',400);
        next.marketSnapshots??=[];if(!next.marketSnapshots.some(value=>value.id===snapshot.id))next.marketSnapshots.push(snapshot);
        next.marketSnapshots.sort((a,b)=>a.receivedAt.localeCompare(b.receivedAt)||a.id.localeCompare(b.id));next.marketSnapshots=next.marketSnapshots.slice(-2);
        const result={reused:collected.reused,snapshotId:snapshot.id,metadata:collected.metadata},outcome={ok:true,result,collection:buildCanonicalBtcCollectionStatus(next,{now:at})};
        return await store(next,outcome,200,at,'MARKET_CAPTURE_COLLECTED',{provider:'okx',instrumentId,reused:collected.reused,sourceSnapshotId:snapshot.id,sourceSnapshotSha256:snapshot.sha256});
      }catch(error){await releaseClaim(database,{ownerId:owner,resourceId,token,nowMs:Date.parse(clock()),status:'FAILED'}).catch(()=>{});throw error;}
    }
    if(url.pathname==='/api/workspace/memory/apply'){
      const {applyProfileMemory}=await import('./memory-application.mjs');
      changed=applyProfileMemory(workspace,body,actorOptions);
      if(!changed.idempotent){
        const resources=new Set([body.deploymentId,...(workspace.comparisons??[]).filter(g=>g.members.some(m=>m.deploymentId===body.deploymentId)).map(g=>g.id)]);
        const claims=await listInFlightClaims(database,{ownerId:owner,nowMs:Date.parse(now)});
        if(claims.some(c=>resources.has(c.resourceId)&&!c.expired))throw new RepositoryError('MEMORY_EXECUTION_IN_PROGRESS','진행 중인 실행을 마친 뒤 기억을 적용하세요.');
        await repository.commit(owner,workspace,changed.workspace,body.idempotencyKey);
      }
      return await response({ok:true,...changed});
    }
    if(url.pathname==='/api/workspace/comparisons/create'||url.pathname==='/api/workspace/comparisons/status'){
      const comparison=await import('./comparisons.mjs');
      changed=url.pathname.endsWith('/create')?comparison.createComparison(workspace,body,actorOptions):comparison.setComparisonStatus(workspace,body,actorOptions);
      if(!changed.idempotent)await repository.commit(owner,workspace,changed.workspace,body.idempotencyKey);
      if(url.pathname.endsWith('/status')&&body.status==='paused'){
        const group=changed.workspace.comparisons.find(g=>g.id===body.comparisonId),resources=new Set([body.comparisonId,...group.members.map(m=>m.deploymentId)]);
        const claims=await listInFlightClaims(database,{ownerId:owner,nowMs:Date.parse(now)});
        for(const claim of claims.filter(c=>resources.has(c.resourceId)))await releaseClaim(database,{ownerId:owner,resourceId:claim.resourceId,token:claim.token,nowMs:Math.max(Date.parse(now),Date.parse(claim.startedAt)),status:'CANCELLED'}).catch(error=>{if(!['CLAIM_FINALIZED','CLAIM_LOST'].includes(error.code))throw error;});
      }
      return await response({ok:true,...changed});
    }
    if(url.pathname==='/api/workspace/comparisons/run'){
      if(Object.keys(body).some(k=>!['comparisonId','idempotencyKey','expectedRevision'].includes(k))||typeof body.comparisonId!=='string'||typeof body.idempotencyKey!=='string'||!Number.isSafeInteger(body.expectedRevision))throw new RepositoryError('INVALID_COMPARISON_INPUT','비교 운용과 실행 요청 항목을 확인하세요.',400);
      const {runComparison}=await import('./comparisons.mjs');
      const value=await runComparison({request,env,ownerId:owner,repository,options,comparisonId:body.comparisonId,idempotencyKey:body.idempotencyKey,expectedRevision:body.expectedRevision});
      return await response({ok:true,workspace:value.workspace,result:{comparison:value.group,report:value.report},report:value.report,idempotent:value.idempotent??false});
    }
    if(url.pathname==='/api/workspace/jobs/run'){const {runOwnerJobs}=await import('./scheduler-api.mjs');const value=await runOwnerJobs({request,env,ownerId:owner,repository,options,maxJobs:body.maxJobs??3});return await response({ok:true,workspace:value.workspace,report:value.report});}
    if(url.pathname==='/api/workspace/actions'){
      if(body.type==='profile.archive'&&!workspace.commandReceipts.some(r=>r.key===body.idempotencyKey)){
        const lifecycle=await investmentLifecycleGuard(database,{owner,profileId:body.payload?.profileId});
        if(lifecycle.blocked.length)throw new RepositoryError('PROFILE_OPERATION_ACTIVE','운용을 먼저 중지하고 보유 자산·미확정 주문·판단 응답을 확인한 뒤 보관하세요.',409);
        const ids=new Set(['mind-execution:'+body.payload?.profileId,...workspace.deployments.filter(d=>d.investmentProfileId===body.payload?.profileId).map(d=>d.id)]),claims=await listInFlightClaims(database,{ownerId:owner,nowMs:Date.parse(now)});
        if(claims.some(c=>ids.has(c.resourceId)&&!c.expired))throw new RepositoryError('PROFILE_EXECUTION_IN_PROGRESS','진행 중인 모의 실행을 마친 뒤 마인드를 보관하세요.',409);
      }
      if(SHARED_WORKSPACE_ACTIONS.includes(body.type))changed=dispatchSharedWorkspaceAction(workspace,body,{ownerId:owner,now});
      else if(['job.create','job.pause','job.resume','job.stop'].includes(body.type)){
        const audit=auditCommand(body);
        if(workspace.commandReceipts.some(r=>r.key===body.idempotencyKey))changed=dispatchWorkspaceAction(workspace,audit,actorOptions);
        else {const jobs=workspace.scheduler??createJobsState({ownerId:owner,now});if(body.type==='job.create'){const d=workspace.deployments.find(d=>d.id===body.payload?.deploymentId);if(d?.executionMode!=='paper'||d.experimentType!=='FORWARD_PAPER')throw new RepositoryError('FORWARD_PAPER_REQUIRED','실시간 모의투자 봇을 선택하세요.',400);}
          const scheduled=dispatchJobAction(jobs,{...body,expectedRevision:jobs.revision},{now});const next=structuredClone(workspace);next.scheduler=scheduled.jobs;
          if(body.type==='job.create'||body.type==='job.resume'||body.type==='job.pause'){const job=scheduled.result;const d=next.deployments.find(d=>d.id===job.deploymentId);d.runtimeStatus=body.type==='job.pause'?'paused':'running';d.updatedAt=now;}
          changed=dispatchWorkspaceAction(next,audit,actorOptions);changed.result=scheduled.result;changed.workspace.commandReceipts.find(r=>r.key===body.idempotencyKey).result=structuredClone(scheduled.result);}
      }else if(body.type==='experience.observe.market'){
        if(!body.payload||Object.keys(body.payload).some(k=>!['experienceId','horizonHours'].includes(k)))throw new RepositoryError('INVALID_OBSERVATION','관측할 경험과 기간을 확인하세요.',400);
        const experienceId=body.payload.experienceId,hours=body.payload.horizonHours??24,receipt=workspace.commandReceipts.find(r=>r.key===body.idempotencyKey);
        if(receipt){const previous=receipt.result;if(receipt.type!=='experience.observe'||previous?.id!==experienceId||previous.observation?.horizonHours!==hours)throw new RepositoryError('IDEMPOTENCY_CONFLICT','동일 관측 요청의 경험과 기간이 변경되었습니다.',409);changed=dispatchWorkspaceAction(workspace,{...body,type:'experience.observe',payload:{experienceId,observation:previous.observation}},actorOptions);}
        else{
          if(body.expectedRevision!==workspace.revision)throw new RepositoryError('REVISION_CONFLICT','최신 경험 기록을 다시 불러오세요.');
          const exp=workspace.experiences.find(e=>e.id===experienceId),record=workspace.decisionRecords.find(r=>r.id===exp?.decisionId),ref=record?.inputPackage.marketDataRef,decisionMarketSnapshot=ref?await repository.readObject(owner,'marketSnapshots',ref):undefined;
          const {observeExperienceMarket}=await import('./observation.mjs'),observed=await observeExperienceMarket(workspace,{experienceId,horizonHours:hours},{now,fetchImpl:options.fetchImpl,decisionMarketSnapshot});
          if(!observed.ready)return await response({ok:false,code:'OBSERVATION_DATA_REQUIRED',message:observed.availability.message,availability:observed.availability},400);
          const next=structuredClone(workspace);if(observed.marketSnapshot){next.marketSnapshots??=[];if(!next.marketSnapshots.some(s=>s.id===observed.marketSnapshot.id))next.marketSnapshots.push(observed.marketSnapshot);next.marketSnapshots.sort((a,b)=>a.receivedAt.localeCompare(b.receivedAt)||a.id.localeCompare(b.id));next.marketSnapshots=next.marketSnapshots.slice(-2);}
          changed=dispatchWorkspaceAction(next,{...body,type:'experience.observe',payload:{experienceId,observation:observed.observation}},{...actorOptions,now:observed.observation.source.observedAt});
        }
      }else if(publicActions.includes(body.type))changed=dispatchWorkspaceAction(workspace,body,actorOptions);
      else if(RESEARCH_ACTIONS.includes(body.type)||['knowledge.note.add','knowledge.note.update','knowledge.note.review','knowledge.note.import'].includes(body.type)){
        const audit=auditCommand(body);
        if(workspace.commandReceipts.some(r=>r.key===body.idempotencyKey))changed=dispatchWorkspaceAction(workspace,audit,actorOptions);
        else{
          const next=structuredClone(workspace);let result;
          if(body.type==='knowledge.note.add')next.knowledge=addKnowledge(next.knowledge,body.payload.item,{now});
          else if(body.type==='knowledge.note.update')next.knowledge=updateKnowledge(next.knowledge,body.payload.id,body.payload.patch,{now});
          else if(body.type==='knowledge.note.review')next.knowledge=reviewKnowledge(next.knowledge,body.payload.id,body.payload.review,{now});
          else if(body.type==='knowledge.note.import')next.knowledge=mergeBrowserNotes(next.knowledge,body.payload.knowledge,now);
          else{const research=await import('../dist/domain/research.mjs');const r=await research.dispatchResearchAction(next.research??research.createResearch({now}),{type:body.type,payload:body.payload},actorOptions);next.research=r.research;result=r.result;}
          changed=dispatchWorkspaceAction(next,audit,actorOptions);changed.result=result??{knowledge:next.knowledge};changed.workspace.commandReceipts.find(r=>r.key===body.idempotencyKey).result=structuredClone(changed.result);
        }
      }else throw new RepositoryError('ACTION_FORBIDDEN','지원하는 작업을 선택하세요.',400);
    }else if(['/api/workspace/evaluate','/api/workspace/execute'].includes(url.pathname)){
      const execution=await import('./execution.mjs'),evaluate=url.pathname.endsWith('/evaluate'),run=evaluate?execution.evaluateDeployment:execution.executeDeployment;
      execution.validateExecutionCommand(body,evaluate?'evaluate':'execute');
      if(workspace.commandReceipts.some(r=>r.key===body.idempotencyKey))return await response({ok:true,...await run(workspace,body,{...options,env,now,actorId:owner})});
      if(body.expectedRevision!==workspace.revision)throw new RepositoryError('REVISION_CONFLICT','새로고침 후 실행하세요.');
      if(!evaluate){const record=workspace.decisionRecords.find(r=>r.id===body.decisionId&&r.deploymentId===body.deploymentId),latestStart=workspace.activityEvents.filter(e=>e.eventType==='DEPLOYMENT_EVALUATION_STARTED'&&e.resourceId===body.deploymentId).at(-1);if(!record||latestStart&&latestStart.payload.commandKey!==record.inputPackage.executionCommandKey)throw new RepositoryError('DECISION_INVALIDATED','새 선택 실행 결과를 확인하세요.');}
      const fingerprint=hashInputPackage({operation:evaluate?'evaluate':'execute',payload:Object.fromEntries(Object.entries(body).filter(([key])=>!['expectedRevision','idempotencyKey'].includes(key)))});
      const acquired=await acquireClaim(database,{ownerId:owner,resourceId:body.deploymentId,key:body.idempotencyKey,fingerprint,baseRevision:workspace.revision,nowMs:Date.parse(now),leaseMs:45000});
      const token=acquired.claim?.token??acquired.token,fence={resourceId:body.deploymentId,token,nowMs:Date.parse(now)};
      const clock=()=>Date.parse(now)+(Date.now()-nowWallStart);
      try{
        if(evaluate){const started=dispatchWorkspaceAction(workspace,{type:'audit.append',payload:{eventType:'DEPLOYMENT_EVALUATION_STARTED',resourceType:'deployment',resourceId:body.deploymentId,payload:{commandKey:body.idempotencyKey,recoveredExpired:!!acquired.recoveredExpired}},idempotencyKey:'start_'+hashInputPackage(body.idempotencyKey),expectedRevision:workspace.revision},actorOptions);if(!started.idempotent){await repository.commit(owner,workspace,started.workspace,body.idempotencyKey,fence);workspace=started.workspace;}}
        await assertClaim(database,{ownerId:owner,resourceId:body.deploymentId,token,nowMs:clock()});
        const savedComparison=!evaluate&&workspace.decisionRecords.find(r=>r.id===body.decisionId)?.inputPackage.comparisonContext;
        const ownedComparison=!evaluate&&workspace.comparisons?.find(g=>g.members.some(m=>m.deploymentId===body.deploymentId));
        const comparisonId=evaluate?options.comparisonId:savedComparison?.comparisonId??ownedComparison?.id;
        let comparison=null;
        if(comparisonId){
          const group=workspace.comparisons?.find(g=>g.id===comparisonId),round=group?.round,member=round?.members.find(m=>m.deploymentId===body.deploymentId);
          if(!group||group.pauseRequestedAt||!round||!round.sourceContext||!member||round.id!==(evaluate?options.comparisonRoundId:savedComparison?.roundId)||round.asOf!==(evaluate?body.asOf:workspace.decisionRecords.find(r=>r.id===body.decisionId)?.inputPackage.asOf)||evaluate&&member.evaluateKey!==body.idempotencyKey||!evaluate&&round.sourceContext.hash!==savedComparison?.sourceContextHash)throw new RepositoryError('SOURCE_CONTEXT_REVOKED','비교 봉이 종료되었거나 승인 자료 사본의 연결이 변경되었습니다.');
          comparison={source:round.sourceContext,binding:{comparisonId:group.id,roundId:round.id,sourceContextHash:round.sourceContext.hash}};
        }
        let market=null,getQuote=options.getQuote,sourceSnapshot=null;
        if(workspace.deployments.find(d=>d.id===body.deploymentId)?.experimentType==='FORWARD_PAPER'){
          const loader=await import('./market-providers.mjs');
          if(evaluate){
            const loaded=options.comparisonMarket??await loader.loadPublicMarket({provider:configuredMarketProvider(env),fetchImpl:options.fetchImpl});
            const group=options.comparisonId&&workspace.comparisons?.find(g=>g.id===options.comparisonId),round=group?.round;
            const boundRound=!!(options.comparisonMarket&&round&&round.id===options.comparisonRoundId&&group.members.some(m=>m.deploymentId===body.deploymentId)&&round.sourceHash===loaded.manifest?.datasetSha256&&round.sourceSnapshotId===loaded.sourceSnapshot?.id&&round.asOf===loaded.manifest?.latestClosedAsOf);
            if(options.comparisonMarket&&!boundRound)throw new RepositoryError('MARKET_INTEGRITY','비교 운용의 공통 봉과 시세 원본 연결을 확인하세요.',400);
            const verified=loader.validatePublicMarketSnapshot(loaded,{now:new Date(clock()).toISOString(),maxSnapshotAgeMs:boundRound?14400000:30000,requirePublic:true});
            if(!verified.ok)throw new RepositoryError('MARKET_INTEGRITY','공개 시세의 출처·시점·해시를 확인하세요.',400);market={dataset:loaded.dataset,manifest:loaded.manifest};sourceSnapshot=loaded.sourceSnapshot;
          }
          else{
            const record=workspace.decisionRecords.find(r=>r.id===body.decisionId),ref=record?.inputPackage.marketDataRef;
            if(ref){
              const capture=await repository.readObject(owner,'marketSnapshots',ref);if(!capture?.marketData)throw new RepositoryError('MARKET_SNAPSHOT_MISSING','결정에 사용한 시세 원본을 찾을 수 없습니다.',409);
              const {marketData,...originalSource}=capture;
              const verified=loader.validatePublicMarketSnapshot({...marketData,sourceSnapshot:originalSource},{requirePublic:true});
              if(capture.id!==ref||marketData.manifest?.datasetSha256!==record.inputPackage.sourceHash||!verified.ok)throw new RepositoryError('MARKET_INTEGRITY','결정에 사용한 원본 시세의 출처·해시를 확인하세요.',409);
              market=marketData;
            }
          }
          const record=!evaluate?workspace.decisionRecords.find(r=>r.id===body.decisionId):null,sourceProvider=loader.providerForSnapshot(market??record?.inputPackage.marketData);
          if(record?.inputPackage.marketProvider&&record.inputPackage.marketProvider!==sourceProvider)throw new RepositoryError('MARKET_PROVIDER_MISMATCH','선택에 사용한 거래소의 호가를 확인하세요.',409);
          getQuote??=(input=>loader.getPublicExecutableQuote({...input,provider:sourceProvider,fetchImpl:options.fetchImpl}));
        }
        const runNow=market?new Date(clock()).toISOString():now;
        const runWorkspace=sourceSnapshot||evaluate&&comparison?structuredClone(workspace):workspace;if(sourceSnapshot){runWorkspace.marketSnapshots??=[];if(!runWorkspace.marketSnapshots.some(s=>s.id===sourceSnapshot.id))runWorkspace.marketSnapshots.push({...sourceSnapshot,marketData:market});runWorkspace.marketSnapshots.sort((a,b)=>a.receivedAt.localeCompare(b.receivedAt)||a.id.localeCompare(b.id));runWorkspace.marketSnapshots=runWorkspace.marketSnapshots.slice(-2);}
        if(evaluate&&comparison){for(const key of ['knowledge','research']){if(comparison.source[key]===null)delete runWorkspace[key];else runWorkspace[key]=structuredClone(comparison.source[key]);}}
        changed=await run(runWorkspace,{...body,expectedRevision:workspace.revision},{...options,env,now:runNow,actorId:owner,evidenceAsOf:evaluate?comparison?.source.knowledgeAsOf:undefined,comparisonSourceContext:evaluate?comparison?.source:undefined,comparisonBinding:comparison?.binding,...(market?{market}:{}),...(sourceSnapshot?{marketDataRef:sourceSnapshot.id}:{}),getQuote});
        if(evaluate&&comparison){for(const key of ['knowledge','research']){if(Object.hasOwn(workspace,key))changed.workspace[key]=structuredClone(workspace[key]);else delete changed.workspace[key];}}
        if(!evaluate){const record=workspace.decisionRecords.find(r=>r.id===body.decisionId),source=market?.dataset??record?.inputPackage.marketData?.dataset??dataset,fill=changed.result?.account?.ledger.at(-1),day=fill?.at?.slice(0,10),dayOpenAt=Date.parse(day+'T00:00:00.000Z'),dayStartPrice=source.bars.find(b=>b[0]===dayOpenAt)?.[1]??(source.dayOpenSnapshot?.day===day?source.dayOpenSnapshot.price:undefined);changed=mirrorSharedExecution(workspace,changed,body,{ownerId:owner,now:new Date(clock()).toISOString(),dayStartPrice});}
        if(!changed.idempotent)await repository.commit(owner,workspace,changed.workspace,body.idempotencyKey,{...fence,nowMs:clock()});
        await completeClaim(database,{ownerId:owner,resourceId:body.deploymentId,token,nowMs:clock()});
        return await response({ok:true,...changed});
      }catch(error){await releaseClaim(database,{ownerId:owner,resourceId:body.deploymentId,token,nowMs:clock(),status:'FAILED'}).catch(()=>{});try{const failureKey='failed_'+hashInputPackage({key:body.idempotencyKey,code:error.code??'FAILED'}),current=await readOperationalWorkspace(repository,owner,undefined,[body.idempotencyKey,failureKey]);if(!current.commandReceipts.some(r=>r.key===body.idempotencyKey)){const failure=dispatchWorkspaceAction(current,{type:'audit.append',payload:{eventType:'DEPLOYMENT_OPERATION_FAILED',resourceType:'deployment',resourceId:body.deploymentId,payload:{commandKey:body.idempotencyKey,operation:evaluate?'evaluate':'execute',code:['WorkspaceError','MarketDataError','SharedAccountError','ClaimError','KnowledgeError','ResearchError','JobError'].includes(error.name)?error.code:'OPERATION_FAILED',guardResults:error.guardResults??[]}},idempotencyKey:failureKey,expectedRevision:current.revision},{actorId:owner,now:new Date(clock()).toISOString()});if(!failure.idempotent)await repository.commit(owner,current,failure.workspace,body.idempotencyKey);}}catch{}throw error;}
    }else return await response({ok:false,message:'요청 경로를 확인하세요.'},404);
    if(!changed.idempotent)await repository.commit(owner,workspace,changed.workspace,body.idempotencyKey);
    return await response({ok:true,...changed});
  }catch(error){const known=error instanceof RepositoryError||error instanceof PortfolioViewError||['WorkspaceError','KnowledgeError','ResearchError','ClaimError','JobError','SharedAccountError','MarketDataError','ConnectorError','ComparisonError','ReceiptStorageError'].includes(error.name),code=known?error.code:error instanceof SyntaxError?'INVALID_JSON':'REQUEST_FAILED';const status=known?(error.status??(['REVISION_CONFLICT','IDEMPOTENCY_CONFLICT','ACCOUNT_INVARIANT','DEPLOYMENT_RUNNING'].includes(code)?409:400)):error instanceof SyntaxError?400:500;return await response({ok:false,code,message:status>=500?'처리 결과를 다시 조회해 주세요.':error instanceof SyntaxError?'입력 형식을 확인하세요.':error.message,...(error.availability?{availability:error.availability}:{}),...(error.resetCursor?{resetCursor:true}:{}),...(error.name==='MarketDataError'&&error.diagnostic?{diagnostic:error.diagnostic}:{})},status);}
}
