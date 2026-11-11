import {hourlyComponentTraining} from '../dist/domain/hourly-model-components.mjs';
import {HOURLY_LEARNING_ACTIONS,validHourlyLearningInput} from '../dist/system/hourly-learning-contracts.mjs';
import {HOURLY_LEARNING_CONTRACT,hourlyTrainingRows,assessHourlyTrial} from '../dist/domain/hourly-model-learning.mjs';
import {hashInputPackage} from '../dist/domain/workspace.mjs';
import {assertHourlyValueGraph} from '../dist/domain/hourly-value-graph.mjs';
import {strategyGraphHash} from '../dist/domain/strategy-graph.mjs';
import {WorkspaceRepository} from './repository.mjs';
import {getLiveAutomation} from './live-automation-store.mjs';
import {acquireClaim,releaseClaim,assertClaim,renewClaim} from './claims.mjs';
import {StrategyLearningStore} from './strategy-learning-store.mjs';
import {createHourlyLearningSource} from './hourly-learning-source.mjs';
import {createHourlyShadowArm,advanceHourlyShadow,verifyHourlyShadowLedger} from './hourly-learning-shadow.mjs';
import {initializeHourlyLearning,learningRows,learningFirst,readLearning,writeLearning,readLearningTrial,writeLearningTrial} from './hourly-model-learning-store.mjs';
import {publishAppNotification} from './app-notifications.mjs';
import {recordHourlyPromotion} from './portfolio-promotion-evidence.mjs';

const H=3600000,iso=t=>new Date(t).toISOString(),copy=structuredClone,check=(v,c,message=c)=>{if(!v)throw Object.assign(Error(message),{code:c,status:409});};
const stmt=(db,sql,...args)=>db.prepare(sql).bind(...args);
const modelOf=m=>m.data.strategyPlan.graph.nodes.find(n=>n.type==='MODEL'&&n.config.family==='HOURLY_VALUE_FOREST').config.model;
const weightsOnlyGraph=g=>{const v=copy(g);v.nodes.find(n=>n.type==='MODEL'&&n.config.family==='HOURLY_VALUE_FOREST').config.model=null;return v;};
const limitPins=c=>Object.fromEntries(Object.entries(c).filter(([k])=>!['manifestId','manifestHash','graphHash'].includes(k)));
const json=(v,status=200)=>Response.json(v,{status,headers:{'Cache-Control':'no-store'}});

async function currentPolicy(db,owner,id){const p=await getLiveAutomation({db,owner,activationId:id});check(p,'HOURLY_LEARNING_POLICY','학습할 운용 모델을 확인하세요.');const manifest=await new WorkspaceRepository(db).readObject(owner,'mindManifests',p.config.manifestId);check(manifest,'HOURLY_LEARNING_MANIFEST');assertHourlyValueGraph(manifest.data.strategyPlan.graph);return {policy:p,manifest};}

export async function configureHourlyLearning({db,owner,input,now}){
 await initializeHourlyLearning(db);
 check(validHourlyLearningInput(HOURLY_LEARNING_ACTIONS[1],input),'HOURLY_LEARNING_INPUT');
 const previous=await readLearning(db,owner,input.profileId);check(previous?input.expectedRevision===previous.revision:input.expectedRevision===null,'HOURLY_LEARNING_REVISION');
 if(!input.enabled&&previous)return writeLearning(db,owner,previous,{...previous,enabled:false,updatedAt:now,status:'PAUSED'});
 check(input.userAction==='ENABLE_MODEL_AUTO_REFRESH','HOURLY_LEARNING_AUTHORIZATION','자동 학습과 가중치 갱신의 설정 동의를 확인하세요.');
 const {policy,manifest}=await currentPolicy(db,owner,input.activationId);check(policy.config.profileId===input.profileId&&policy.status==='ENABLED','HOURLY_LEARNING_SCOPE');
 const budget=input.maxRequestsPerDay??40000;check(Number.isSafeInteger(budget)&&budget>=100&&budget<=100000,'HOURLY_LEARNING_BUDGET');
 const same=!(previous?.enabled===false&&previous?.runtime?.pendingApply)&&previous?.activationId===policy.id&&previous.nonModelGraphHash===hashInputPackage(weightsOnlyGraph(manifest.data.strategyPlan.graph))&&previous.limitHash===hashInputPackage(limitPins(policy.config));
 return writeLearning(db,owner,previous,{...(same?previous:{}),contractVersion:HOURLY_LEARNING_CONTRACT,profileId:input.profileId,activationId:policy.id,enabled:true,autoApply:input.autoApply,trainingDays:7,trialHours:24,maxRequestsPerDay:budget,marketIds:policy.config.marketIds,sourceGraphHash:policy.config.graphHash,nonModelGraphHash:hashInputPackage(weightsOnlyGraph(manifest.data.strategyPlan.graph)),limitHash:hashInputPackage(limitPins(policy.config)),sourceModelHash:modelOf(manifest).hash,authorization:{owner,at:now,userAction:input.userAction,scope:'MODEL_WEIGHTS_ONLY',preserve:['capital','orderLimits','universe','entryReview','profitLadder','positions','unconfirmedOrders'],autoApply:input.autoApply},createdAt:previous?.createdAt??now,updatedAt:now,status:same?previous.status:'PREPARING',runtime:same?previous.runtime??{}:{},nextTrainAt:same?previous.nextTrainAt??now:now});
}

export async function hourlyLearningStatus({db,owner,profileId=null}){
 await initializeHourlyLearning(db);const heads=await learningRows(db,'SELECT body,revision FROM hourly_model_learning WHERE owner_id=?'+(profileId?' AND profile_id=?':''),owner,...(profileId?[profileId]:[])),items=[];
 for(const r of heads){const h={...JSON.parse(r.body),revision:r.revision},trial=h.runtime?.trialId?await readLearningTrial(db,owner,h.runtime.trialId):null;items.push({profileId:h.profileId,activationId:h.activationId,revision:h.revision,enabled:h.enabled,autoApply:h.autoApply,status:h.status,trainingDays:h.trainingDays,trialHours:h.trialHours,maxRequestsPerDay:h.maxRequestsPerDay,sourceModelHash:h.sourceModelHash,authorization:h.authorization,nextTrainAt:h.nextTrainAt,lastError:h.runtime.lastError??null,requests:h.runtime.requests??null,training:h.runtime.training??null,scores:h.runtime.scores??null,lastApplied:h.runtime.lastApplied??null,trial:trial?{id:trial.id,startsAt:trial.startsAt,endsAt:trial.endsAt,asOf:trial.asOf,status:trial.status,comparison:trial.comparison??assessHourlyTrial(trial),modelHashes:trial.modelHashes,liveOrders:0}:null});}
 return {ok:true,contractVersion:HOURLY_LEARNING_CONTRACT,items};
}

export async function handleHourlyLearningAPI(request,env={},options={}){
 const url=new URL(request.url),owner=request.headers.get('oai-authenticated-user-id');if(!owner)return json({ok:false,code:'UNAUTHORIZED'},401);
 try{
  if(request.method==='GET'&&url.pathname==='/api/workspace/hourly-learning'){const input=Object.fromEntries(url.searchParams);check(validHourlyLearningInput(HOURLY_LEARNING_ACTIONS[0],input)&&[...url.searchParams.keys()].length===Object.keys(input).length,'HOURLY_LEARNING_INPUT');return json({...await hourlyLearningStatus({db:env.DB,owner,profileId:input.profileId??null}),runner:env.HOURLY_LEARNING_STATUS?.()??{running:false}});}
  check(request.method==='POST'&&url.pathname==='/api/workspace/hourly-learning/configure','METHOD');
  check(request.headers.get('Content-Type')?.startsWith('application/json')&&request.headers.get('Origin')===url.origin&&request.headers.get('Sec-Fetch-Site')!=='cross-site','ORIGIN');
  const text=await request.text();check(text.length<=3000,'INPUT_SIZE');const input=JSON.parse(text);check(!input.enabled||typeof env.TRAIN_HOURLY_MODEL==='function','HOURLY_TRAINER_UNAVAILABLE','이 서버에 학습 실행기를 연결하세요.');const now=new Date(options.now?.()??Date.now()).toISOString();await configureHourlyLearning({db:env.DB,owner,input,now});env.HOURLY_LEARNING_WAKE?.();return json(await hourlyLearningStatus({db:env.DB,owner,profileId:input.profileId}));
 }catch(e){return json({ok:false,code:e.code??'HOURLY_LEARNING_FAILED',message:e.code?e.message:'자동 학습 상태를 확인하세요.'},e.status??400);}
}

async function scoreMatured(db,owner,head,now){
 const until=iso(Date.parse(now)-6*H),events=await learningRows(db,"SELECT id,body FROM live_automation_events WHERE owner_id=? AND activation_id=? AND kind='HOURLY_VALUE_EVALUATED' AND recorded_at<=? AND json_type(body,'$.snapshot.markets')='array' ORDER BY recorded_at,id",owner,head.activationId,until);
 const candles=(await learningRows(db,'SELECT market,open_at,body FROM hourly_learning_candles WHERE owner_id=? AND open_at>=?',owner,Date.parse(now)-8*24*H)).map(r=>({...r,c:JSON.parse(r.body)})),map=new Map(candles.map(r=>[r.market+':'+r.open_at,r.c])),seen=new Set();
 for(const event of events){const b=JSON.parse(event.body),s=b.evaluation?.trace?.find(t=>t.type==='MODEL')?.output?.selection;if(!s)continue;const hour=Math.floor(Date.parse(s.asOf)/H)*H,key=s.modelHash+':'+hour;if(seen.has(key))continue;seen.add(key);
  for(const m of b.snapshot.markets){const v=s.values.find(v=>v.market===m.market&&v.kind==='ENTER');if(!v)continue;const future=Array.from({length:6},(_,i)=>map.get(m.market+':'+(hour+i*H)));if(future.some(c=>!c||c.availableAt>now))continue;const actual=future.at(-1).bar[4]/m.bars.at(-1)[4]-1,predicted=v.expectedBid/(m.bars.at(-1)[4]*(1-s.fees.forecastExitSlippageBps/10000))-1,score={modelHash:s.modelHash,forecastAt:iso(hour),labelAt:iso(hour+6*H),predicted,actual,squaredError:(predicted-actual)**2,absoluteError:Math.abs(predicted-actual),selected:s.selected,market:m.market};await stmt(db,'INSERT OR IGNORE INTO hourly_learning_scores(owner_id,profile_id,event_id,market,forecast_at,label_at,body) VALUES(?,?,?,?,?,?,?)',owner,head.profileId,event.id,m.market,score.forecastAt,score.labelAt,JSON.stringify(score)).run();}
 }
 const recent=await learningRows(db,"SELECT forecast_at,AVG(json_extract(body,'$.absoluteError')) mae,AVG(json_extract(body,'$.squaredError')) mse,COUNT(*) markets FROM hourly_learning_scores WHERE owner_id=? AND profile_id=? AND forecast_at>=? GROUP BY forecast_at ORDER BY forecast_at",owner,head.profileId,iso(Date.parse(now)-72*H));
 const last=recent.filter(r=>r.forecast_at>=iso(Date.parse(now)-24*H)),prior=recent.filter(r=>r.forecast_at<iso(Date.parse(now)-24*H)),avg=(a,k)=>a.length?a.reduce((n,r)=>n+r[k],0)/a.length:null;
 return {observedAt:now,forecastHours:recent.length,markets:recent.reduce((n,r)=>n+r.markets,0),last24hMae:avg(last,'mae'),last24hMse:avg(last,'mse'),prior48hMse:avg(prior,'mse'),drift:recent.length>=12&&last.length>=4&&prior.length>=8&&avg(last,'mse')>2*avg(prior,'mse'),driftPolicy:'Hour-aggregated squared-error doubling; retraining signal only, not a trading restriction or significance claim',labelDelayHours:6};
}

export function createHourlyLearningRunner({env,ownerId='local-preview-owner',clock=()=>new Date().toISOString(),enabled=true,options={},setTimer=setTimeout,clearTimer=clearTimeout}={}){
 const db=env.DB,store=new StrategyLearningStore(db);let running=false,pending=null,timer=null;const status={running:false,lastCompletedAt:null,lastError:null};
 async function processProfile(initial,claim){
  let head=initial;const now=()=>clock(),save=async patch=>{await assertClaim(db,{ownerId,resourceId:'hourly-learning:'+head.profileId,token:claim.token,nowMs:Date.parse(now())});head=await writeLearning(db,ownerId,head,{...head,...patch,updatedAt:now()});return head;};
  if(head.runtime.retryAt&&now()<head.runtime.retryAt)return;
  const {policy,manifest}=await currentPolicy(db,ownerId,head.activationId);check(policy.status==='ENABLED','HOURLY_LEARNING_SOURCE_STOPPED');
  const priorApplied=head.runtime.lastApplied;
  if(priorApplied&&!priorApplied.runtimeVerified&&!policy.pendingStrategyUpdate&&policy.config.graphHash===priorApplied.graphHash){const previousTrial=await readLearningTrial(db,ownerId,priorApplied.trialId);if(previousTrial&&assessHourlyTrial(previousTrial).status==='READY_TO_APPLY'){const receipt=await recordHourlyPromotion({db,owner:ownerId,policy,manifest,head,trial:previousTrial,appliedAt:priorApplied.at,now:now()});if(receipt.runtimeVerified)await save({runtime:{...head.runtime,lastApplied:{...priorApplied,runtimeVerified:true,runtimeVerifiedAt:receipt.runtimeVerifiedAt}}});}}
  if(head.nonModelGraphHash!==hashInputPackage(weightsOnlyGraph(manifest.data.strategyPlan.graph))||head.limitHash!==hashInputPackage(limitPins(policy.config))){await save({status:'PREPARING',sourceGraphHash:policy.config.graphHash,sourceModelHash:modelOf(manifest).hash,nonModelGraphHash:hashInputPackage(weightsOnlyGraph(manifest.data.strategyPlan.graph)),limitHash:hashInputPackage(limitPins(policy.config)),marketIds:policy.config.marketIds,nextTrainAt:now(),runtime:{...head.runtime,trialId:null,pendingApply:null,lastError:null}});return;}
  let trial=head.runtime.trialId?await readLearningTrial(db,ownerId,head.runtime.trialId):null;
  if(head.status==='APPLYING'){
   if(policy.pendingStrategyUpdate)return;
   const expected=head.runtime.pendingApply;
   if(policy.config.graphHash===head.sourceGraphHash){const graph=copy(manifest.data.strategyPlan.graph);graph.nodes.find(n=>n.type==='MODEL').config.model=await store.read(ownerId,trial.modelRef);await applyHourlyCandidate({db,env,owner:ownerId,head,trial,graph,clock:now,options});return;}
   check(policy.config.graphHash===expected.graphHash&&modelOf(manifest).hash===expected.modelHash&&policy.lastStrategyUpdate?.status==='APPLIED','HOURLY_LEARNING_APPLY_VERIFY');
   const receipt=await recordHourlyPromotion({db,owner:ownerId,policy,manifest,head,trial,appliedAt:now(),now:now()});
   await save({status:'IDLE',sourceGraphHash:policy.config.graphHash,sourceModelHash:expected.modelHash,runtime:{...head.runtime,trialId:null,pendingApply:null,lastApplied:{...expected,at:receipt.appliedAt,runtimeVerified:receipt.runtimeVerified},lastError:null},nextTrainAt:now()});
   await publishAppNotification({db,owner:ownerId,notification:{id:'learning-applied:'+expected.trialId,title:'학습 모델 자동 갱신 완료',body:'20만원 모델의 학습 가중치를 갱신했습니다. 배정액·주문 한도·분할익절 규칙과 보유 원장은 유지했습니다.',status:'COMPLETED',createdAt:now(),details:[{label:'대상',value:manifest.data.name??head.profileId},{label:'모델 버전',value:expected.modelHash},{label:'비교 근거',value:JSON.stringify(trial?.comparison??{}).slice(0,1900)}],profileId:head.profileId}});return;
  }
  if(policy.config.graphHash!==head.sourceGraphHash){await save({status:'PREPARING',sourceGraphHash:policy.config.graphHash,sourceModelHash:modelOf(manifest).hash,nextTrainAt:now(),runtime:{...head.runtime,trialId:null,pendingApply:null,lastError:null}});return;}
  if(trial?.status==='WAITING_START'&&Date.parse(now())-Date.parse(trial.startsAt)>90000){trial.status='MISSED_START';trial.comparison={status:'MISSED_START',reason:'First sampled valuation was unavailable; retain this attempt and start a fresh comparison.'};await writeLearningTrial(db,ownerId,head,trial);await save({status:'PREPARING',nextTrainAt:now(),runtime:{...head.runtime,trialId:null,lastComparison:trial.comparison,lastError:null}});return;}
  if(trial&&Object.values(trial.arms).some(a=>a.curve.some((p,i)=>i&&Date.parse(p.at)-Date.parse(a.curve[i-1].at)>90000))){trial.status='VALUATION_GAPS';trial.comparison={...assessHourlyTrial(trial),status:'VALUATION_GAPS'};await writeLearningTrial(db,ownerId,head,trial);await save({status:'PREPARING',nextTrainAt:now(),runtime:{...head.runtime,trialId:null,lastComparison:{...trial.comparison,trialId:trial.id},lastError:null}});return;}
  const reserve=async()=>{await renewClaim(db,{ownerId,resourceId:'hourly-learning:'+head.profileId,token:claim.token,nowMs:Date.parse(now()),leaseMs:120000});const fresh=await readLearning(db,ownerId,head.profileId);check(fresh.enabled&&fresh.revision===head.revision,'HOURLY_LEARNING_REVISION');const day=now().slice(0,10),r=head.runtime.requests?.day===day?head.runtime.requests:{day,used:0};check(r.used<head.maxRequestsPerDay,'HOURLY_LEARNING_REQUEST_BUDGET');await save({runtime:{...head.runtime,requests:{day,used:r.used+1}}});};
  const source=(options.createSource??createHourlyLearningSource)({db,owner:ownerId,env,head,clock:now,reserve,fetchImpl:options.fetchImpl,readiness:options.readiness,templates:head.runtime.templates??{}});
  const sourceSave=async()=>save({status:'COMPARING',runtime:{...head.runtime,templates:source.templates(),lastError:null,retryAt:null}});
  if(!trial&&now()>=head.nextTrainAt){
   await save({status:'COLLECTING',runtime:{...head.runtime,lastError:null}});
   if(!head.runtime.bootstrapComplete){const row=await learningFirst(db,"SELECT body FROM live_automation_events WHERE owner_id=? AND activation_id=? AND kind='HOURLY_VALUE_EVALUATED' AND json_type(body,'$.snapshot.markets')='array' ORDER BY recorded_at DESC LIMIT 1",ownerId,head.activationId);check(row,'HOURLY_LEARNING_INPUT_REQUIRED');const input=JSON.parse(row.body).snapshot,markets=input.markets.filter(m=>m.entryAllowed).map(m=>m.market);
    check(markets.length>0,'HOURLY_LEARNING_INPUT_REQUIRED');for(const market of markets){if(head.runtime.bootstrapped?.includes(market))continue;await source.bootstrap([market]);await save({runtime:{...head.runtime,bootstrapped:[...(head.runtime.bootstrapped??[]),market]}});}await save({runtime:{...head.runtime,bootstrapComplete:true,lastHistoryRefreshAt:now()}});
   }
   if(!head.runtime.lastHistoryRefreshAt||Date.parse(now())-Date.parse(head.runtime.lastHistoryRefreshAt)>=H){await source.bootstrap(head.runtime.bootstrapped??[],{count:38});await save({runtime:{...head.runtime,lastHistoryRefreshAt:now()}});}
   const cutoff=now(),candles=(await learningRows(db,'SELECT body FROM hourly_learning_candles WHERE owner_id=? AND open_at>=?',ownerId,Date.parse(cutoff)-9*24*H)).map(r=>JSON.parse(r.body)),components=manifest.data.strategyPlan.graph.nodes.find(n=>n.type==='MODEL'&&n.config.family==='HOURLY_VALUE_FOREST').config.components,rows=hourlyTrainingRows(candles,{cutoff,components});check(rows.length>=80,'HOURLY_LEARNING_SAMPLES');
   const rowsRef=await store.write(ownerId,{cutoff,rows,trainingDays:hourlyComponentTraining(components).trainingDays,universePolicy:'Current eligible universe at bootstrap; subsequent public hourly captures; earlier-only labels; initial survivor selection recorded.'});await save({status:'TRAINING'});
   const started=performance.now(),model=await (options.train??env.TRAIN_HOURLY_MODEL??(()=>{throw Object.assign(Error('학습 실행기를 연결하세요.'),{code:'HOURLY_TRAINER_UNAVAILABLE'});}))(rows,{cutoff,createdAt:now(),...(components?{components}:{})}),modelRef=await store.write(ownerId,model),id='hourly-trial-'+hashInputPackage({profile:head.profileId,model:model.hash,source:policy.config.graphHash,cutoff}).slice(0,32),startsAt=iso((Math.floor(Date.parse(now())/H)+1)*H),dataset=await source.dataset('KRW-BTC');
   const initialCapital=policy.config.capitalLimit,arms={};for(const [kind,m]of [['baseline',modelOf(manifest)],['candidate',model],['btc',modelOf(manifest)]]){arms[kind]=createHourlyShadowArm({id:id+':'+kind,manifest,model:m,initialCapital,dataset,now:startsAt,benchmark:kind==='btc'});arms[kind].perOrderLimit=policy.config.perOrderLimit;arms[kind].maxDailyLossRatio=Math.min(1,Number(policy.config.dailyLossLimit)/Number(initialCapital));}
   trial={id,profileId:head.profileId,startsAt,endsAt:iso(Date.parse(startsAt)+head.trialHours*H),asOf:startsAt,status:'WAITING_START',initialCapital,sourceGraphHash:policy.config.graphHash,sourceModelHash:modelOf(manifest).hash,modelHashes:{baseline:modelOf(manifest).hash,candidate:model.hash},rowsRef,modelRef,arms,createdAt:now(),policyPins:copy(policy.config),authority:'PAPER_ONLY'};
   await writeLearningTrial(db,ownerId,head,trial);await save({status:'COMPARING',nextTrainAt:iso(Date.parse(now())+24*H),runtime:{...head.runtime,trialId:id,templates:source.templates(),training:{at:now(),sampleCount:rows.length,labelCutoff:model.training.lastLabelAt,modelHash:model.hash,seconds:(performance.now()-started)/1000},lastError:null}});
   return;
  }
  if(trial&&now()>=trial.startsAt){
   if(now()<trial.endsAt){
    const persist=async(kind,body,arm)=>{const event={kind,at:now(),body:JSON.parse(JSON.stringify({armId:arm.id,...body}))};event.id=hashInputPackage(event);await writeLearningTrial(db,ownerId,head,trial,[event]);};
    const hour=Math.floor(Date.parse(now())/H)*H;
    if(Date.parse(now())<hour+120000&&Object.values(trial.arms).some(a=>!a.benchmark&&a.runtime.hourlyValue?.lastBoundary!==iso(hour))){const ownedMarketIds=[...new Set(Object.values(trial.arms).filter(a=>a.campaign.account.connector.balances.base.available!=='0').map(a=>a.campaign.account.connector.instrument.symbol))];await source.snapshot({ownedMarketIds});}
    for(const arm of Object.values(trial.arms))await advanceHourlyShadow(arm,{source,clock:now,save:persist});
    trial.asOf=now();trial.status='COMPARING';trial.comparison=assessHourlyTrial(trial);await writeLearningTrial(db,ownerId,head,trial);await sourceSave();
   }else{
    for(const arm of Object.values(trial.arms))await advanceHourlyShadow(arm,{source,clock:now,valuationOnly:true});
    trial.verification=Object.fromEntries(Object.entries(trial.arms).map(([k,a])=>[k,verifyHourlyShadowLedger(a)]));
    trial.asOf=now();trial.comparison=assessHourlyTrial(trial);trial.status=trial.comparison.status;await writeLearningTrial(db,ownerId,head,trial);
    if(trial.status==='READY_TO_APPLY'&&head.autoApply){
     const graph=copy(manifest.data.strategyPlan.graph),model=await store.read(ownerId,trial.modelRef);graph.nodes.find(n=>n.type==='MODEL'&&n.config.family==='HOURLY_VALUE_FOREST').config.model=model;
     check(hashInputPackage(weightsOnlyGraph(graph))===head.nonModelGraphHash,'HOURLY_LEARNING_WEIGHTS_ONLY');
     const graphHash=strategyGraphHash(graph),key='learn-'+trial.id;await save({status:'APPLYING',runtime:{...head.runtime,pendingApply:{trialId:trial.id,modelHash:model.hash,graphHash,idempotencyKey:key},lastError:null}});
     await applyHourlyCandidate({db,env,owner:ownerId,head,trial,graph,clock:now,options});
    }else{
     await save({status:trial.status,nextTrainAt:now(),runtime:{...head.runtime,trialId:null,lastComparison:trial.comparison,lastError:null}});
     await publishAppNotification({db,owner:ownerId,notification:{id:'learning-result:'+trial.id,title:'학습 후보 비교 완료',body:trial.status==='KEEP_CURRENT'?'현재 모델이 유지됐습니다. 새 후보의 비용 차감 성과가 교체 기준을 충족하지 못했습니다.':trial.status==='VALUATION_GAPS'?'비교 중 평가 시세 누락을 기록했습니다. 기존 실전 모델을 유지하고 다음 후보를 비교합니다.':'새 후보가 비교 기준을 통과했습니다. 자동 갱신 설정이 꺼져 현재 모델을 유지합니다.',status:'INFO',createdAt:now(),details:[{label:'비교 결과',value:JSON.stringify(trial.comparison).slice(0,1900)}]}});
    }
   }
  }
  if(!head.runtime.scores||Date.parse(now())-Date.parse(head.runtime.scores.observedAt)>=H){const scores=await scoreMatured(db,ownerId,head,now());await save({runtime:{...head.runtime,scores}});if(scores.drift&&!head.runtime.trialId&&(!head.runtime.lastDriftTrainAt||Date.parse(now())-Date.parse(head.runtime.lastDriftTrainAt)>=6*H))await save({nextTrainAt:now(),runtime:{...head.runtime,lastDriftTrainAt:now()}});}
 }
 async function work(){
  await initializeHourlyLearning(db);const configs=await learningRows(db,"SELECT body,revision FROM hourly_model_learning WHERE owner_id=? AND json_extract(body,'$.enabled')=1",ownerId);
  for(const r of configs){if(!running)break;let claim;const head={...JSON.parse(r.body),revision:r.revision};try{claim=await acquireClaim(db,{ownerId,resourceId:'hourly-learning:'+head.profileId,key:crypto.randomUUID(),fingerprint:hashInputPackage({profileId:head.profileId,revision:head.revision}),baseRevision:head.revision,nowMs:Date.parse(clock()),leaseMs:120000});await processProfile(head,claim);}
   catch(e){options.onError?.(e);if(!['IN_PROGRESS','CLAIM_CONFLICT','HOURLY_LEARNING_REVISION'].includes(e.code)){status.lastError={code:e.code??'HOURLY_LEARNING_FAILED',at:clock()};const current=await readLearning(db,ownerId,head.profileId);if(current?.enabled)await writeLearning(db,ownerId,current,{...current,status:current.runtime.pendingApply?'APPLYING':'RETRY_WAIT',runtime:{...current.runtime,lastError:status.lastError,retryAt:iso(Date.parse(clock())+(e.code==='SCALP_PUBLIC_HTTP_429'?1000:60000))},updatedAt:clock()}).catch(()=>{});}}
   finally{if(claim)await releaseClaim(db,{ownerId,resourceId:'hourly-learning:'+head.profileId,token:claim.token,nowMs:Date.parse(clock()),status:'CANCELLED'}).catch(()=>{});}
  }status.lastCompletedAt=clock();
 }
 const tick=()=>!running?Promise.resolve(false):pending??=(async()=>{try{await work();}finally{pending=null;}})();
 const schedule=()=>{if(!running)return;timer=setTimer(async()=>{await tick().catch(e=>{status.lastError={code:e.code??'HOURLY_LEARNING_STORAGE',at:clock()};});schedule();},10000);timer?.unref?.();};
 return {start(){if(!enabled||running)return;running=status.running=true;schedule();},tick,wake(){if(running)void tick();},status:()=>copy(status),async stop(){running=status.running=false;clearTimer(timer);await pending;}};
}

export async function applyHourlyCandidate({db,env,owner,head,trial,graph,clock,options={}}){
 const stored=await readLearningTrial(db,owner,trial.id);check(stored&&stored.status==='READY_TO_APPLY'&&assessHourlyTrial(stored).status==='READY_TO_APPLY'&&hashInputPackage(stored.modelRef)===hashInputPackage(trial.modelRef),'HOURLY_LEARNING_COMPARISON_REQUIRED');
 for(const arm of Object.values(stored.arms))verifyHourlyShadowLedger(arm);
 const latest=await readLearning(db,owner,head.profileId);check(latest?.enabled&&latest.autoApply&&latest.activationId===head.activationId&&trial.profileId===latest.profileId&&latest.authorization?.scope==='MODEL_WEIGHTS_ONLY'&&latest.runtime.pendingApply?.trialId===trial.id,'HOURLY_LEARNING_AUTO_AUTH');
 const {policy,manifest}=await currentPolicy(db,owner,head.activationId);check(policy.config.graphHash===trial.sourceGraphHash&&hashInputPackage(weightsOnlyGraph(graph))===head.nonModelGraphHash&&hashInputPackage(limitPins(policy.config))===head.limitHash,'HOURLY_LEARNING_APPLY_SCOPE');
 const model=await new StrategyLearningStore(db).read(owner,trial.modelRef);check(model.createdAt<trial.startsAt&&model.training.lastLabelAt<=model.createdAt,'HOURLY_LEARNING_TRAINING_TIME');check(model.hash===modelOf({data:{strategyPlan:{graph}}}).hash,'HOURLY_LEARNING_MODEL_CHANGED');
 const {handleAutomatedTradingAPI}=await import('./automated-trading.mjs'),workspace=await new WorkspaceRepository(db).readOperational(owner),url='http://127.0.0.1:4905/api/workspace/automated-trading/update-strategy';
 const req=new Request(url,{method:'POST',headers:{'Content-Type':'application/json',Origin:new URL(url).origin,'oai-authenticated-user-id':owner},body:JSON.stringify({activationId:policy.id,expectedGraphHash:trial.sourceGraphHash,graph,expectedRevision:workspace.revision,idempotencyKey:head.runtime.pendingApply.idempotencyKey,userAction:'LIVE_STRATEGY_UPDATE'})});
 const response=await (options.updateStrategy??handleAutomatedTradingAPI)(req,env,{...options,hourlyModelRefresh:{profileId:head.profileId,trialId:trial.id,authorizedAt:latest.authorization.at,modelHash:model.hash},now:()=>Date.parse(clock())}),result=await response.json();check(response.ok&&result.ok,result.code??'HOURLY_LEARNING_APPLY_FAILED',result.message);
 return result;
}
