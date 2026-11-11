import {resolveProgramDeployment,defaultProgramAllocations} from './strategy-program-deployment.mjs';
import {createRegimeProgramGraph,regimeGraphDefinition,compileRegimeProgramGraph} from '../dist/domain/regime-program-graph.mjs';
import {createStrategyModel,createMindPreset,assertMindPreset} from '../dist/domain/strategy-model.mjs';
import {createRegimeProgram,resolveRegimeModel,regimeChoices} from '../dist/domain/regime-program.mjs';
import {dispatchWorkspaceAction,hashInputPackage,readMindAppearance} from '../dist/domain/workspace.mjs';
import {assertMindDocument,mindDocumentHash} from '../dist/domain/mind-manifest.mjs';
import {createMindStrategyPlan,strategyPlanWithGraph,approveMindStrategyPlan,draftMindStrategyPlan} from '../dist/domain/mind-strategy-plan.mjs';
import {investmentLifecycleGuard} from './investment-lifecycle-guard.mjs';
import {listEventPaperSubscriptions,saveEventPaperSubscription} from './event-paper-store.mjs';

const check=(ok,code,message,status=400)=>{if(!ok)throw Object.assign(new Error(message),{code,status});};
const copy=structuredClone;
export function strategyModelCatalog(w){
 return {models:(w.strategyModels??[]).map(m=>({id:m.id,name:m.name,version:m.version,createdAt:m.createdAt,contentHash:m.contentHash,source:m.source,nodeCount:m.policy.data.strategyPlan.graph.nodes.length,policyName:m.policy.data.name})),presets:(w.mindPresets??[]).map(p=>({id:p.id,name:p.name,createdAt:p.createdAt,contentHash:p.contentHash,minds:p.minds.map(m=>({name:m.name,sourceProfileId:m.sourceProfileId,graphHash:m.manifest.data.strategyPlan?.graph?hashInputPackage(m.manifest.data.strategyPlan.graph):null}))})),programs:copy(w.regimePrograms??[])};
}
export function saveStrategyModel(w,body,{manifest,now}){
 check(Object.keys(body).every(k=>['mindId','name','previousId','expectedRevision','idempotencyKey'].includes(k)),'STRATEGY_MODEL_INPUT','저장할 마인드·이름·이전 버전을 확인하세요.');
 const previous=body.previousId?(w.strategyModels??[]).find(m=>m.id===body.previousId):null;check(!body.previousId||previous,'STRATEGY_MODEL_NOT_FOUND','이전 전략 버전을 선택하세요.',404);
 const model=createStrategyModel({id:'strategy-model-'+crypto.randomUUID(),version:previous?previous.version+1:1,name:body.name,manifest,createdAt:now,previousVersion:previous?{id:previous.id,version:previous.version,contentHash:previous.contentHash}:null});
 (w.strategyModels??=[]).push(model);return {model};
}
export function saveMindPreset(w,body,{manifests,now}){
 check(Object.keys(body).every(k=>['mindIds','name','expectedRevision','idempotencyKey'].includes(k))&&Array.isArray(body.mindIds)&&new Set(body.mindIds).size===body.mindIds.length,'MIND_PRESET_INPUT','저장할 마인드와 프리셋 이름을 지정하세요.');
 const minds=body.mindIds.map(id=>{const profile=w.investmentProfiles.find(p=>p.id===id),manifest=manifests.find(m=>m.scope.profileId===id);check(profile&&manifest,'MIND_NOT_FOUND','저장할 마인드를 선택하세요.',404);return {profile,manifest,appearance:readMindAppearance(w,id).config,settings:w.profileVersions.find(v=>v.id===profile.currentVersionId).settings};});
 const preset=createMindPreset({id:'mind-preset-'+crypto.randomUUID(),name:body.name,minds,createdAt:now});(w.mindPresets??=[]).push(preset);return {preset,sourceDisposition:'KEPT'};
}
export function restoreMindPreset(w,body,{now,ownerId}){
 check(Object.keys(body).every(k=>['id','name','expectedRevision','idempotencyKey'].includes(k)),'MIND_PRESET_INPUT','복원할 프리셋과 이름을 확인하세요.');let preset=(w.mindPresets??[]).find(p=>p.id===body.id);const model=(w.strategyModels??[]).find(m=>m.id===body.id);if(!preset&&model)preset=createMindPreset({id:'preset-'+model.id,name:model.name,createdAt:now,minds:[{profile:{id:model.policy.scope.profileId,name:model.policy.data.name},settings:model.policy.data.profileSettings,manifest:model.policy}]});check(preset,'MIND_PRESET_NOT_FOUND','저장한 마인드 프리셋을 선택하세요.',404);assertMindPreset(preset);
 const restored=[];
 for(const source of preset.minds){
  const name=body.name?(preset.minds.length===1?body.name:body.name+' · '+source.name):source.name+' · 복원';
  const changed=dispatchWorkspaceAction(w,{type:'profile.create',payload:{name,settings:source.settings},expectedRevision:w.revision,idempotencyKey:'preset-restore-'+crypto.randomUUID()},{now,actorId:ownerId});Object.assign(w,changed.workspace);
  const profile=w.investmentProfiles.find(p=>p.id===changed.result.profile.id);if(source.appearance)w.uiPreferences={schemaVersion:1,mindCompanions:{...w.uiPreferences?.mindCompanions,[profile.id]:{schemaVersion:1,config:copy(source.appearance),updatedAt:now,updatedBy:ownerId}}};
  const document=copy(source.manifest);document.id='preset-policy-'+crypto.randomUUID();document.scope.profileId=profile.id;document.scope.experimentId=null;document.data.name=name;document.title=name;document.data.version=1;document.data.versionRefs.profileVersionId=profile.currentVersionId;document.data.versionRefs.memoryVersionId=profile.currentMemoryVersionId;document.asOf=now;document.availableAt=now;document.source={type:'system-export',id:preset.id,uri:null};document.provenance.classification=null;
  document.data.version=2;if(document.data.strategyPlan){document.data.strategyPlan=draftMindStrategyPlan(document.data.strategyPlan);document.data.strategyPlan.planId='strategy-'+profile.id;document.data.strategyPlan.planVersionId='preset-v1';}assertMindDocument(document);
  (w.mindDocuments??=[]).push({id:document.id,document,status:'DRAFT',importedAt:now,importedBy:ownerId,importedHash:mindDocumentHash(document),claimedClassification:null,classificationRecord:null,review:null,sourceValidation:'POLICY_REVIEW_REQUIRED'});
  restored.push({profileId:profile.id,name,documentId:document.id,graphHash:source.manifest.data.strategyPlan?.graph?hashInputPackage(source.manifest.data.strategyPlan.graph):null,status:'DRAFT',running:false});
 }
 return {presetId:preset.id,restored};
}
export function saveRegimeProgram(w,body,{now}){
 check(Object.keys(body).every(k=>['name','classifier','routes','minimumDwellMs','graph','previousId','expectedRevision','idempotencyKey'].includes(k)),'REGIME_PROGRAM_INPUT','판단과 전략 연결을 확인하세요.');
 const previous=body.previousId?(w.regimePrograms??[]).find(p=>p.id===body.previousId):null;check(!body.previousId||previous,'REGIME_PROGRAM_PREVIOUS','이전 라우터 버전을 선택하세요.',404);
 const definition=body.graph?regimeGraphDefinition(body.graph):{classifier:body.classifier,routes:body.routes,minimumDwellMs:body.minimumDwellMs??0,handover:'DRAIN'};
 const raw=createRegimeProgram({id:'regime-program-'+crypto.randomUUID(),name:body.name,...definition,createdAt:now,version:previous?(previous.version??1)+1:1,previousVersion:previous?{id:previous.id,version:previous.version??1,contentHash:previous.contentHash}:null}),graph=body.graph??createRegimeProgramGraph(raw,{models:w.strategyModels??[]});compileRegimeProgramGraph(graph);
 const program=createRegimeProgram({...raw,graph});
 for(const {id:key} of regimeChoices(program))resolveRegimeModel(program,key,[...(w.strategyModels??[]),...(w.mindPresets??[])]);(w.regimePrograms??=[]).push(program);return {program};
}

/** Save precedes source removal. Pausing is durable even if settlement prevents retirement. */
export async function retirePresetSources(w,body,{now,ownerId,db,manifests}){
 check(Object.keys(body).every(k=>['id','expectedRevision','idempotencyKey'].includes(k)),'MIND_PRESET_INPUT','원본을 정리할 저장 프리셋을 선택하세요.');const preset=(w.mindPresets??[]).find(p=>p.id===body.id);check(preset,'MIND_PRESET_NOT_FOUND','저장 완료한 프리셋을 선택하세요.',404);assertMindPreset(preset);const sources=[];
 // Validate the complete request before stopping any source in a multi-mind preset.
 for(const source of preset.minds){const profile=w.investmentProfiles.find(p=>p.id===source.sourceProfileId);if(!profile||profile.status==='ARCHIVED')continue;const current=manifests.find(m=>m.scope.profileId===profile.id);check(current&&mindDocumentHash(current)===source.manifestHash,'MIND_PRESET_SOURCE_CHANGED','프리셋 저장 후 원본 정책이 바뀌었습니다. 현재 정책을 새로 보관하세요.',409);const guard=await investmentLifecycleGuard(db,{owner:ownerId,profileId:profile.id});check(!guard.blocked.includes('LIVE'),'MIND_PRESET_LIVE_SOURCE','실전 운용의 보유·주문을 먼저 정리하세요. 저장한 프리셋과 실전 설정은 유지합니다.',409);}
 for(const source of preset.minds){
  const profile=w.investmentProfiles.find(p=>p.id===source.sourceProfileId);if(!profile||profile.status==='ARCHIVED'){sources.push({profileId:source.sourceProfileId,status:'ARCHIVED'});continue;}
  const current=manifests.find(m=>m.scope.profileId===profile.id);check(current&&mindDocumentHash(current)===source.manifestHash,'MIND_PRESET_SOURCE_CHANGED','프리셋 저장 후 원본 정책이 바뀌었습니다. 현재 정책을 새로 보관하세요.',409);
  const before=await investmentLifecycleGuard(db,{owner:ownerId,profileId:profile.id});check(!before.blocked.includes('LIVE'),'MIND_PRESET_LIVE_SOURCE','실전 운용의 보유·주문을 먼저 정리하세요. 저장한 프리셋과 실전 설정은 유지합니다.',409);
  for(const s of await listEventPaperSubscriptions({db,owner:ownerId,profileId:profile.id})){if(s.status!=='ENABLED')continue;const next=copy(s);next.status='PAUSED';next.runtime.state='PAUSED';next.updatedAt=now;await saveEventPaperSubscription({db,owner:ownerId,previous:s,next,events:[{id:'preset-retire-'+body.idempotencyKey,kind:'RUNTIME',at:now,body:{state:'PAUSED',presetId:preset.id,holdingsRetained:true}}]});}
  for(const s of w.mindSubscriptions??[])if(s.profileId===profile.id){s.status='PAUSED';s.updatedAt=now;}
  const after=await investmentLifecycleGuard(db,{owner:ownerId,profileId:profile.id});
  if(after.blocked.length||(w.mindSubscriptions??[]).filter(s=>s.profileId===profile.id).some(s=>s.attempts.some(a=>['COMPUTING','JEV_STARTED','ACTION_REQUIRED'].includes(a.status)))){sources.push({profileId:profile.id,status:'PAUSED_WAIT_SETTLEMENT',blockers:after.blocked});continue;}
  const changed=dispatchWorkspaceAction(w,{type:'profile.archive',payload:{profileId:profile.id},expectedRevision:w.revision,idempotencyKey:'preset-retire-'+crypto.randomUUID()},{now,actorId:ownerId});Object.assign(w,changed.workspace);sources.push({profileId:profile.id,status:'ARCHIVED'});
 }
 return {presetId:preset.id,sources};
}

/** A separate unstarted mind uses the common policy and live-approval path. */
export function prepareStrategyProgram(w,body,{now,ownerId}){
 check(Object.keys(body).every(k=>['id','name','allocations','expectedRevision','idempotencyKey'].includes(k)),'PROGRAM_DEPLOYMENT_INPUT','저장한 라우터·묶음과 구성원 배분을 확인하세요.');
 let program=(w.regimePrograms??[]).find(p=>p.id===body.id);
 if(!program){const target=[...(w.mindPresets??[]),...(w.strategyModels??[])].find(p=>p.id===body.id);check(target,'PROGRAM_TARGET','저장한 라우터·묶음을 선택하세요.',404);const raw=createRegimeProgram({id:'regime-program-'+crypto.randomUUID(),name:body.name??target.name,createdAt:now,classifier:{kind:'FIXED',periodMs:3600000,maxAgeMs:0,inputs:[],choices:[{id:'fixed',label:'저장한 구성 실행',description:'저장한 묶음의 모든 마인드를 실행'}]},routes:{fixed:target.kind==='mind-preset'?{kind:'mind-preset',id:target.id,version:1,contentHash:target.contentHash}:{id:target.id,version:target.version,contentHash:target.contentHash}}});program=createRegimeProgram({...raw,graph:createRegimeProgramGraph(raw,{models:[target]})});(w.regimePrograms??=[]).push(program);}
 const targets=[...new Set(Object.values(program.routes).map(p=>p.id))].map(id=>[...(w.strategyModels??[]),...(w.mindPresets??[])].find(v=>v.id===id)),source=targets[0]?.policy??targets[0]?.minds[0]?.manifest;check(source,'PROGRAM_TARGET','실행할 전략 원문을 확인하세요.');
 const binding={schemaVersion:1,programId:program.id,programHash:program.contentHash,allocations:body.allocations??defaultProgramAllocations(targets)},document=copy(source),name=body.name??program.name;
 document.data.strategySettings={...document.data.strategySettings,strategyProgram:binding};document.data.strategyPlan=approveMindStrategyPlan(strategyPlanWithGraph(createMindStrategyPlan({enabled:true}),program.graph??createRegimeProgramGraph(program,{models:targets})),{now,ownerId:'system:strategy-program-compiler'});
 const deployment=resolveProgramDeployment(document,w),changed=dispatchWorkspaceAction(w,{type:'profile.create',payload:{name,settings:source.data.profileSettings},expectedRevision:w.revision,idempotencyKey:'program-mind-'+crypto.randomUUID()},{now,actorId:ownerId});Object.assign(w,changed.workspace);const profile=w.investmentProfiles.find(p=>p.id===changed.result.profile.id);
 document.id='program-policy-'+crypto.randomUUID();document.scope.profileId=profile.id;document.scope.instrumentIds=[...deployment.scope.instrumentIds];document.scope.experimentId=null;document.title=name;document.asOf=now;document.availableAt=now;document.source={type:'system-export',id:program.id,uri:null};document.provenance.classification=null;delete document.data.learningProvenance;
 Object.assign(document.data,{name,version:2,versionRefs:{...document.data.versionRefs,profileVersionId:profile.currentVersionId,memoryVersionId:profile.currentMemoryVersionId},universe:{mode:deployment.scope.instrumentIds.length===1?'single':'allowlist',instrumentIds:deployment.scope.instrumentIds,selection:{method:'strategy',maxPositions:deployment.scope.instrumentIds.length,minQuoteVolume:0,minHistoryBars:1,rebalance:'1h-close'}}});
 document.data.strategyPlan.planId='program-'+profile.id;document.data.strategyPlan.planVersionId='program-v1';assertMindDocument(document);(w.mindManifests??=[]).push(document);
 return {profileId:profile.id,manifest:document,programDetails:deployment.details,running:false};
}
