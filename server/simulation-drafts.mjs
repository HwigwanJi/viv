import {JEV_EXECUTION_CALL_LIMIT} from '../dist/domain/jev-question.mjs';
import {WorkspaceRepository,readOperationalWorkspace} from './repository.mjs';
import {hashInputPackage,validateWorkspace} from '../dist/domain/workspace.mjs';
import {assertMindDocument,mindDocumentHash} from '../dist/domain/mind-manifest.mjs';
import {diagnoseDecisionGraph,DECISION_GRAPH_VERSION} from '../dist/domain/strategy-graph.mjs';
import {assertQuantStrategyBindingMetadata} from '../dist/domain/quant-strategy-library.mjs';
import {assertGraphCompositions} from '../dist/domain/graph-compositions.mjs';
import {decisionNodePortContract,decisionGraphLimits} from '../dist/domain/strategy-decision-graph.mjs';

export const SIMULATION_DRAFT_CONTRACT='SIMULATION_DRAFT_V1';
const clone=structuredClone,plain=v=>v&&typeof v==='object'&&!Array.isArray(v),id=v=>typeof v==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9_.:@-]{0,199}$/.test(v),iso=v=>typeof v==='string'&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString()===v;
const check=(v,code,message,status=400)=>{if(!v)throw Object.assign(new Error(message),{code,status});};
const fields=(v,required,optional=[])=>plain(v)&&required.every(k=>Object.hasOwn(v,k))&&Object.keys(v).every(k=>required.includes(k)||optional.includes(k));
const json=value=>Response.json(value,{headers:{'Cache-Control':'no-store'}});
const latestManifest=(w,mindId,now)=>(w.mindManifests??[]).filter(m=>m.kind==='mind-policy'&&m.scope.profileId===mindId&&m.availableAt<=now).sort((a,b)=>b.data.version-a.data.version||b.availableAt.localeCompare(a.availableAt))[0];

export function validateSimulationDraftInput(body){
 check(fields(body,['arms','settings','step','expectedRevision','idempotencyKey'],['id','name']),'SIMULATION_DRAFT_INPUT','초안의 전략·기간·비용을 확인하세요.');
 hashInputPackage(body);
 check((body.id===undefined||id(body.id))&&id(body.idempotencyKey)&&Number.isSafeInteger(body.expectedRevision)&&body.expectedRevision>=0,'SIMULATION_DRAFT_COMMAND','초안 식별자와 저장 버전을 확인하세요.');
 check(body.name===undefined||typeof body.name==='string'&&!!body.name.trim()&&body.name.length<=160,'SIMULATION_DRAFT_NAME','초안 이름을 160자 이내로 입력하세요.');
 check(['strategy','period','review'].includes(body.step)&&Array.isArray(body.arms)&&body.arms.length===2,'SIMULATION_DRAFT_ARMS','A와 B 전략을 선택하세요.');
 for(const arm of body.arms){
  check(fields(arm,['mindId','graph','knowledge'],['sourceSimulationId','instrumentPolicy'])&&id(arm.mindId)&&typeof arm.knowledge==='boolean'&&(arm.instrumentPolicy===undefined||['FIXED','UNIVERSE_CURRENT','EACH_ASSET'].includes(arm.instrumentPolicy))&&(arm.sourceSimulationId===undefined||arm.sourceSimulationId===null||id(arm.sourceSimulationId)),'SIMULATION_DRAFT_ARM','각 전략의 마인드·그래프·자료 사용을 확인하세요.');
  const g=arm.graph;check(fields(g,['schemaVersion','contractVersion','triggers','nodes','edges','outputNodeId'],['libraryBindings','compositions','executionScope'])&&g.schemaVersion===2&&g.contractVersion===DECISION_GRAPH_VERSION&&Array.isArray(g.triggers)&&g.triggers.length>0&&g.triggers.every(t=>['manual','closed_bar','market_event'].includes(t))&&new Set(g.triggers).size===g.triggers.length&&Array.isArray(g.nodes)&&g.nodes.length>0&&g.nodes.length<=decisionGraphLimits(g).nodes&&Array.isArray(g.edges)&&g.edges.length<=decisionGraphLimits(g).edges&&typeof g.outputNodeId==='string','SIMULATION_DRAFT_GRAPH','정본 노드 그래프 형식을 확인하세요.');
  // The editor's diagnostics allow unfinished connections; execution still compiles the full graph.
  const diagnosis=diagnoseDecisionGraph(g);check(Object.values(diagnosis.nodes).every(n=>n.state!=='INVALID')&&Object.values(diagnosis.edges).every(e=>e.state!=='INVALID')&&!diagnosis.issues.some(i=>['GRAPH_SCHEMA','GRAPH_OUTPUT','GRAPH_NODE'].includes(i.code)),'SIMULATION_DRAFT_GRAPH',diagnosis.issues[0]?.message??'그래프 부품과 연결 형식을 확인하세요.');
  assertQuantStrategyBindingMetadata(g);
  assertGraphCompositions(g,{portContract:decisionNodePortContract});
 }
 const s=body.settings,event=['UPBIT_EVENT_STREAM','UPBIT_EVENT_UNIVERSE'].includes(s?.assetMode);check(fields(s,['startAt','endAt','initialCash','feeBps','slippageBps','maxJevCalls','benchmarkPresetId'],['assetMode','datasetId','datasetIds'])&&(s.assetMode===undefined||['UPBIT_BTC_PORTFOLIO','UPBIT_EVENT_STREAM','UPBIT_EVENT_UNIVERSE'].includes(s.assetMode))&&(s.datasetId===undefined||id(s.datasetId))&&(s.datasetIds===undefined||s.assetMode==='UPBIT_EVENT_UNIVERSE'&&Array.isArray(s.datasetIds)&&s.datasetIds.length<=20&&s.datasetIds.every(id)&&new Set(s.datasetIds).size===s.datasetIds.length)&&(!s.datasetId||['UPBIT_BTC_PORTFOLIO','UPBIT_EVENT_STREAM','UPBIT_EVENT_UNIVERSE'].includes(s.assetMode))&&(s.startAt===null||iso(s.startAt))&&(s.endAt===null||iso(s.endAt))&&(!s.startAt||!s.endAt||s.startAt<s.endAt),'SIMULATION_DRAFT_PERIOD','기간과 시세 자료를 확인하세요.');
 check(Number.isFinite(s.initialCash)&&s.initialCash>0&&s.initialCash<=1e12&&(event?s.feeBps===null&&s.slippageBps===null:Number.isFinite(s.feeBps)&&s.feeBps>=0&&s.feeBps<=1000&&Number.isFinite(s.slippageBps)&&s.slippageBps>=0&&s.slippageBps<=1000)&&Number.isSafeInteger(s.maxJevCalls)&&s.maxJevCalls>=0&&s.maxJevCalls<=JEV_EXECUTION_CALL_LIMIT&&(s.benchmarkPresetId===null||id(s.benchmarkPresetId)),'SIMULATION_DRAFT_SETTINGS','초기 자금·비용·호출 한도를 확인하세요.');
 hashInputPackage(body);
 return body;
}

export function simulationDraftArm(workspace,draftId,draftArm,mindId){
 if(draftId===undefined||draftId===null){check(draftArm===undefined||draftArm===null,'SIMULATION_DRAFT_SOURCE','초안과 A/B 전략을 함께 선택하세요.');return null;}
 check(id(draftId)&&['A','B'].includes(draftArm),'SIMULATION_DRAFT_SOURCE','초안과 A/B 전략을 함께 선택하세요.');
 const draft=(workspace.simulationDrafts??[]).find(d=>d.id===draftId);check(draft,'SIMULATION_DRAFT_NOT_FOUND','저장한 초안을 찾을 수 없습니다.',404);
 check(!draft.archivedAt,'SIMULATION_DRAFT_ARCHIVED','보관함에서 초안을 복원한 뒤 실행하세요.',409);
 const arm=draft.arms[draftArm==='A'?0:1];check(arm?.mindId===mindId,'SIMULATION_DRAFT_SCOPE','초안에 고정한 마인드를 선택하세요.',409);
 check(mindDocumentHash(arm.source.manifest)===arm.source.manifestHash,'SIMULATION_DRAFT_SOURCE','고정한 원본 정책을 확인하세요.',409);return arm;
}

export async function handleSimulationDraft(request,{owner,store,clock,env,options}){
 const url=new URL(request.url),db=env.DB?.withSession?env.DB.withSession('first-primary'):env.DB,repository=options.repository??new WorkspaceRepository(db);
 check(['GET','POST'].includes(request.method),'SIMULATION_DRAFT_ROUTE','초안 조회·저장 요청을 확인하세요.',404);
 let body=null;
 if(request.method==='POST'){
  check(!url.search&&request.headers.get('content-type')?.startsWith('application/json'),'SIMULATION_DRAFT_INPUT','JSON 초안 요청을 확인하세요.');
  const text=await request.text();check(new TextEncoder().encode(text).length<=160000,'SIMULATION_DRAFT_SIZE','초안 크기를 줄여 주세요.',413);try{body=JSON.parse(text);}catch{check(false,'SIMULATION_DRAFT_INPUT','초안 JSON을 확인하세요.');}validateSimulationDraftInput(body);
 }
 const w=await readOperationalWorkspace(repository,owner,undefined,body?[body.idempotencyKey]:[]);check(w,'SIMULATION_WORKSPACE','마인드를 먼저 만드세요.',404);
 if(request.method==='GET'){
  check([...url.searchParams.keys()].every(k=>k==='id')&&url.searchParams.getAll('id').length<=1,'SIMULATION_DRAFT_QUERY','조회할 초안을 선택하세요.');
  if(url.searchParams.has('id')){const key=url.searchParams.get('id');check(id(key),'SIMULATION_DRAFT_QUERY','초안 식별자를 확인하세요.');const draft=(w.simulationDrafts??[]).find(d=>d.id===key);check(draft,'SIMULATION_DRAFT_NOT_FOUND','저장한 초안을 찾을 수 없습니다.',404);return json({ok:true,draft,workspaceRevision:w.revision});}
  return json({ok:true,items:(w.simulationDrafts??[]).filter(d=>!d.archivedAt).map(({id,name,revision,createdAt,updatedAt,step,arms})=>({id,name,revision,createdAt,updatedAt,step,mindIds:arms.map(a=>a.mindId)})).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)||b.id.localeCompare(a.id)),workspaceRevision:w.revision});
 }
 const fingerprint=hashInputPackage({operation:'simulation.draft.save',input:Object.fromEntries(Object.entries(body).filter(([k])=>!['expectedRevision','idempotencyKey'].includes(k)))}),prior=w.commandReceipts.find(r=>r.key===body.idempotencyKey);
 if(prior){check(prior.type==='simulation.draft.save'&&prior.fingerprint===fingerprint,'SIMULATION_DRAFT_IDEMPOTENCY','같은 요청 키의 초안 내용을 유지하세요.',409);return json({ok:true,...prior.result,workspaceRevision:w.revision,idempotent:true});}
 const before=body.id?(w.simulationDrafts??[]).find(d=>d.id===body.id):null;check(!body.id||before,'SIMULATION_DRAFT_NOT_FOUND','편집할 초안을 찾을 수 없습니다.',404);check(body.expectedRevision===(before?.revision??0),'SIMULATION_DRAFT_CONFLICT','다른 창에서 초안을 변경했습니다. 저장된 초안을 다시 열어 주세요.',409);
 check(!before?.archivedAt,'SIMULATION_DRAFT_ARCHIVED','보관함에서 초안을 복원한 뒤 편집하세요.',409);
 const now=clock(),arms=[];
 for(const [index,input]of body.arms.entries()){
  const previous=before?.arms[index],sourceId=input.sourceSimulationId??null;let source;
  if(previous?.mindId===input.mindId&&(previous.source.sourceSimulationId??null)===sourceId)source=clone(previous.source);
  else {const saved=sourceId?await store.get(owner,sourceId):null;check(!sourceId||saved?.config.mindId===input.mindId,'SIMULATION_DRAFT_SOURCE','같은 마인드의 저장 실험을 선택하세요.',404);const manifest=saved?.core.manifest??latestManifest(w,input.mindId,now);check(manifest,'SIMULATION_DRAFT_MIND','발행한 마인드를 선택하세요.',404);assertMindDocument(manifest);check(!saved||mindDocumentHash(manifest)===saved.core.pins.manifestHash,'SIMULATION_DRAFT_SOURCE','저장 실험의 고정 정책을 확인하세요.',409);source={manifest:clone(manifest),manifestHash:mindDocumentHash(manifest),sourceSimulationId:sourceId};}
  arms.push({mindId:input.mindId,graph:clone(input.graph),knowledge:input.knowledge,...(input.instrumentPolicy?{instrumentPolicy:input.instrumentPolicy}:{}),source});
 }
 const draft={id:before?.id??'simulation-draft-'+hashInputPackage({owner,key:body.idempotencyKey}).slice(0,32),contractVersion:SIMULATION_DRAFT_CONTRACT,revision:(before?.revision??0)+1,status:'DRAFT',name:body.name??before?.name??arms.map(a=>a.source.manifest.data.name).join(' ↔ '),createdAt:before?.createdAt??now,updatedAt:now,arms,settings:clone(body.settings),step:body.step};
 const next=clone(w);next.simulationDrafts??=[];if(before)next.simulationDrafts[next.simulationDrafts.findIndex(d=>d.id===before.id)]=draft;else next.simulationDrafts.push(draft);next.revision++;next.updatedAt=now;
 next.commandReceipts.push({id:'receipt-'+crypto.randomUUID(),key:body.idempotencyKey,type:'simulation.draft.save',fingerprint,revision:next.revision,createdAt:now,result:{draft:clone(draft)}});
 next.activityEvents.push({id:'event-'+crypto.randomUUID(),eventType:'SIMULATION_DRAFT_SAVED',resourceType:'simulation-draft',resourceId:draft.id,occurredAt:now,actorId:'workspace-owner',payload:{requestKey:body.idempotencyKey,draftRevision:draft.revision}});
 const errors=validateWorkspace(next);check(!errors.length,errors[0]?.code??'INVALID_WORKSPACE',errors[0]?.message??'저장할 초안을 확인하세요.');await repository.commit(owner,w,next,body.idempotencyKey);return json({ok:true,draft,workspaceRevision:next.revision});
}

export async function organizeSimulationDraft({owner,id:documentId,expectedRevision,idempotencyKey,action,clock,env,options}){
 check(id(documentId)&&id(idempotencyKey)&&Number.isSafeInteger(expectedRevision)&&expectedRevision>=0&&['archive','restore'].includes(action),'SIMULATION_DRAFT_COMMAND','초안 식별자와 저장 버전을 확인하세요.');
 const db=env.DB?.withSession?env.DB.withSession('first-primary'):env.DB,repository=options.repository??new WorkspaceRepository(db),w=await readOperationalWorkspace(repository,owner,undefined,[idempotencyKey]);check(w,'SIMULATION_WORKSPACE','마인드를 먼저 만드세요.',404);
 const type='simulation.draft.'+action,fingerprint=hashInputPackage({operation:type,id:documentId}),prior=w.commandReceipts.find(r=>r.key===idempotencyKey);
 if(prior){check(prior.type===type&&prior.fingerprint===fingerprint,'SIMULATION_DRAFT_IDEMPOTENCY','같은 요청 키의 초안 작업을 유지하세요.',409);return {ok:true,...prior.result,idempotent:true};}
 const before=(w.simulationDrafts??[]).find(d=>d.id===documentId);check(before,'SIMULATION_DRAFT_NOT_FOUND','저장한 초안을 찾을 수 없습니다.',404);check(before.revision===expectedRevision,'SIMULATION_DRAFT_CONFLICT','초안이 변경되었습니다. 목록을 다시 조회하세요.',409);
 const now=clock(),after={...clone(before),revision:before.revision+1,updatedAt:now,archivedAt:action==='archive'?now:null},result={id:documentId,kind:'comparison',recordType:'EDITOR_DRAFT',revision:after.revision,archivedAt:after.archivedAt,members:[{id:documentId,revision:after.revision}]},next=clone(w);
 next.simulationDrafts[next.simulationDrafts.findIndex(d=>d.id===documentId)]=after;next.revision++;next.updatedAt=now;
 next.commandReceipts.push({id:'receipt-'+crypto.randomUUID(),key:idempotencyKey,type,fingerprint,revision:next.revision,createdAt:now,result:clone(result)});
 next.activityEvents.push({id:'event-'+crypto.randomUUID(),eventType:action==='archive'?'SIMULATION_DRAFT_ARCHIVED':'SIMULATION_DRAFT_RESTORED',resourceType:'simulation-draft',resourceId:documentId,occurredAt:now,actorId:'workspace-owner',payload:{requestKey:idempotencyKey,draftRevision:after.revision}});
 const errors=validateWorkspace(next);check(!errors.length,errors[0]?.code??'INVALID_WORKSPACE',errors[0]?.message??'저장할 초안을 확인하세요.');await repository.commit(owner,w,next,idempotencyKey);return {ok:true,...result};
}
