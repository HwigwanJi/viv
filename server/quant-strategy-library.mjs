import {assertQuantStrategyResource,createQuantStrategyResource,builtinQuantStrategies,assertQuantStrategyBindings} from '../dist/domain/quant-strategy-library.mjs';
import {parseMindData,serializeMindData} from '../dist/domain/mind-manifest.mjs';
import {stableStringify} from '../dist/domain/workspace.mjs';
import {SimulationRepository} from './simulation-repository.mjs';

export class QuantStrategyLibraryError extends Error {constructor(code,message,status=400){super(message);this.code=code;this.status=status;}}
const check=(v,c,m,s=400)=>{if(!v)throw new QuantStrategyLibraryError(c,m,s);};
const clone=structuredClone,list=v=>Array.isArray(v)?v:[],same=(a,b)=>stableStringify(a)===stableStringify(b);
const safeId=v=>typeof v==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,199}$/.test(v);
const iso=v=>typeof v==='string'&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString()===v;
export const QUANT_LIBRARY_LIMITS=Object.freeze({maxVersions:500,ownerScope:'CURRENT_USER',versionPolicy:'PUBLISHED_IMMUTABLE_DRAFT_EDITABLE_EXPLICIT_ADOPTION',usageScope:'SAVED_MIND_POLICIES_SUBSCRIPTIONS_RUNS'});
const graphOf=m=>m?.data?.strategyPlan?.graph;
const matches=(graph,entry)=>list(graph?.libraryBindings).filter(b=>b.resourceId===entry.strategyId&&b.resourceVersion===entry.version&&b.resourceHash===entry.contentHash);
const usageRef=(manifest,entry)=>({manifestId:manifest.id,profileId:manifest.scope.profileId,name:manifest.data.name,policyVersion:manifest.data.version,instances:matches(graphOf(manifest),entry).map(b=>({instanceId:b.instanceId,outputNodeId:b.outputNodeId,parameterSnapshot:clone(b.parameterSnapshot)}))});

export function verifyQuantStrategyPins(workspace,document){
 const graph=graphOf(document);if(!graph?.libraryBindings?.length)return;
 assertQuantStrategyBindings(graph,list(workspace.quantStrategies).filter(e=>e.status==='APPROVED').map(e=>e.document));
}
export function quantStrategyUsage(workspace,entry,{manifests=[]}={}){
 const policies=list(workspace.mindManifests).filter(m=>matches(graphOf(m),entry).length),ids=new Set(policies.map(m=>m.id));
 return {scope:QUANT_LIBRARY_LIMITS.usageScope,minds:manifests.filter(m=>matches(graphOf(m),entry).length).map(m=>usageRef(m,entry)),policyVersions:policies.map(m=>usageRef(m,entry)),drafts:list(workspace.mindDocuments).filter(e=>e.status==='DRAFT'&&matches(graphOf(e.document),entry).length).map(e=>usageRef(e.document,entry)),subscriptions:list(workspace.mindSubscriptions).filter(s=>ids.has(s.pins?.manifestId)||ids.has(s.pendingPins?.manifestId)).map(s=>({id:s.id,profileId:s.profileId,status:s.status,manifestId:s.pins.manifestId,pendingManifestId:s.pendingPins?.manifestId??null})),runs:list(workspace.mindRuns).filter(r=>ids.has(r.manifestId)).map(r=>({id:r.id,profileId:r.profileId,manifestId:r.manifestId,instrumentId:r.instrumentId,asOf:r.asOf,action:r.decision?.action??null}))};
}
export async function quantStrategySimulationUsage(db,ownerId,entry){
 const page=await new SimulationRepository(db).forQuantStrategy(ownerId,{resourceId:entry.strategyId,version:entry.version,contentHash:entry.contentHash});
 const simulations=page.items.map(head=>{
  const graph=graphOf(head.core.manifest),bindings=matches(graph,entry),nodeIds=new Set(bindings.flatMap(b=>Object.values(b.nodeMap))),standalone=bindings.length===1&&graph.libraryBindings.length===1&&graph.nodes.every(n=>nodeIds.has(n.id)||['RISK','ORDER'].includes(n.type));
  const processed=head.core.totals.decisionCount,warmup=head.core.totals.warmupCount,ready=processed-warmup,total=head.core.coverage.totalDecisionFrames,wholeWindowComparable=head.status==='COMPLETED'&&ready===total,status=!processed?'NOT_EXECUTED':!ready?'NO_EVALUABLE_DECISIONS':head.status!=='COMPLETED'?'IN_PROGRESS':warmup?'PARTIAL_WINDOW':'FULL_WINDOW',metrics=head.report?.metrics;
  return {id:head.id,name:head.config.name,mindId:head.config.mindId,manifestId:head.core.manifest.id,policyVersion:head.core.manifest.data.version,status:head.status,mode:head.config.mode,startAt:head.config.startAt,endAt:head.config.endAt,createdAt:head.createdAt,reportHash:head.report?.reportHash??null,quoteCurrency:head.core.pins.quoteCurrency,policyInstrumentId:head.core.pins.policyInstrumentId,dataInstrumentId:head.core.pins.dataInstrumentId,instanceIds:bindings.map(b=>b.instanceId),parameterSnapshots:bindings.map(b=>({instanceId:b.instanceId,parameterSnapshot:clone(b.parameterSnapshot)})),attribution:standalone?'STANDALONE_QUANT':'MIND_COMPOSITION',riskConfig:clone(graph.nodes.find(n=>n.type==='RISK')?.config??null),evaluation:{status,readyDecisions:ready,warmupDecisions:warmup,totalDecisions:total,wholeWindowComparable},metrics:wholeWindowComparable&&metrics?{totalReturn:metrics.totalReturn,maxDrawdown:metrics.maxDrawdown,tradeCount:metrics.tradeCount,realizedWinRate:metrics.realizedWinRate,totalCosts:metrics.totalCosts}:null,accountMetrics:metrics?{totalReturn:metrics.totalReturn,maxDrawdown:metrics.maxDrawdown,tradeCount:metrics.tradeCount,finalEquity:metrics.finalEquity}:null,reportPath:'/api/workspace/simulations/report?id='+encodeURIComponent(head.id)};
 });return {simulations,simulationPage:{total:page.total,returned:simulations.length,limit:page.limit,hasMore:page.hasMore,order:'NEWEST_FIRST'}};
}
export function quantStrategyItem(entry,workspace,options={}){
 const usage=quantStrategyUsage(workspace,entry,options);return {id:entry.id,strategyId:entry.strategyId,version:entry.version,name:entry.document.name,description:entry.document.description,status:entry.status,contentHash:entry.contentHash,createdAt:entry.createdAt,publishedAt:entry.review?.reviewedAt??null,usageCount:usage.minds.length};
}
export function readQuantStrategyLibrary(workspace,query={},options={}){
 const q=query instanceof URLSearchParams?Object.fromEntries(query):query;
 check(Object.keys(q).every(k=>['search','status'].includes(k))&&typeof (q.search??'')==='string'&&(q.search??'').length<=200&&(!q.status||['DRAFT','APPROVED'].includes(q.status)),'QUANT_LIBRARY_QUERY','전략 이름과 발행 상태로 검색하세요.');
 const search=(q.search??'').toLocaleLowerCase();return {items:list(workspace.quantStrategies).filter(e=>(!q.status||e.status===q.status)&&(!search||[e.document.name,e.document.description].join(' ').toLocaleLowerCase().includes(search))).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)||b.version-a.version||a.id.localeCompare(b.id)).map(e=>quantStrategyItem(e,workspace,options)),templates:builtinQuantStrategies(),limits:QUANT_LIBRARY_LIMITS};
}
export function quantStrategyEntry(workspace,id){const e=list(workspace.quantStrategies).find(e=>e.id===id);check(e,'QUANT_STRATEGY_NOT_FOUND','저장한 전략 버전을 선택하세요.',404);assertQuantStrategyResource(e.document);return e;}
export function readQuantStrategyItem(workspace,id,options={}){const entry=quantStrategyEntry(workspace,id);return {item:quantStrategyItem(entry,workspace,options),entry,versions:list(workspace.quantStrategies).filter(e=>e.strategyId===entry.strategyId).sort((a,b)=>b.version-a.version).map(e=>quantStrategyItem(e,workspace,options)),usage:quantStrategyUsage(workspace,entry,options)};}
export function exportQuantStrategy(workspace,id,format='json'){
 check(['json','yaml'].includes(format),'QUANT_EXPORT_FORMAT','JSON 또는 YAML 형식을 선택하세요.');const entry=quantStrategyEntry(workspace,id);
 return {id,document:entry.document,text:serializeMindData(entry.document,{format}),filename:entry.strategyId+'-v'+entry.version+'.'+format,contentType:format==='yaml'?'application/yaml':'application/json'};
}
export function createQuantStrategyDraft(workspace,body,{ownerId,now}){
 check(Object.keys(body).every(k=>['name','description','definition','strategyId','draftId','expectedContentHash','document','text','format','expectedRevision','idempotencyKey'].includes(k)),'QUANT_DRAFT_INPUT','전략 원문 또는 이름과 정의를 입력하세요.');
 const editing=body.draftId!==undefined;
 check(editing||list(workspace.quantStrategies).length<QUANT_LIBRARY_LIMITS.maxVersions,'QUANT_LIBRARY_CAPACITY','저장 가능한 전략 버전 수에 도달했습니다.',409);
 const importing=body.document!==undefined||body.text!==undefined;let source=null,previous=null,target=null;
 if(editing){check(!importing&&body.strategyId===undefined&&body.format===undefined&&/^[a-f0-9]{64}$/.test(body.expectedContentHash??''),'QUANT_DRAFT_INPUT','편집할 초안 ID와 원문 해시를 전달하세요.');target=quantStrategyEntry(workspace,body.draftId);check(target.status==='DRAFT','QUANT_STRATEGY_PUBLISHED','발행된 전략은 새 버전으로 편집하세요.',409);check(target.contentHash===body.expectedContentHash,'QUANT_DRAFT_CONFLICT','초안 내용이 변경되었습니다. 최신 원문을 조회하세요.',409);check(!list(workspace.quantStrategies).some(e=>e.strategyId===target.strategyId&&e.version>target.version),'QUANT_DRAFT_SUPERSEDED','이 전략의 최신 초안을 편집하세요.',409);}
 else check(body.expectedContentHash===undefined,'QUANT_DRAFT_INPUT','기존 초안을 편집할 때 원문 해시를 전달하세요.');
 if(importing){check((body.document!==undefined)!==(body.text!==undefined)&&!['name','description','definition','strategyId'].some(k=>body[k]!==undefined),'QUANT_DRAFT_INPUT','가져올 전략 원문 하나를 입력하세요.');source=clone(assertQuantStrategyResource(body.text!==undefined?parseMindData(body.text,{format:body.format??'auto'}):body.document));}
 else {check(body.format===undefined,'QUANT_DRAFT_INPUT','텍스트를 가져올 때 파일 형식을 지정하세요.');if(body.strategyId!==undefined){check(safeId(body.strategyId),'QUANT_STRATEGY_ID','저장한 전략의 식별자를 확인하세요.');previous=list(workspace.quantStrategies).filter(e=>e.strategyId===body.strategyId).sort((a,b)=>b.version-a.version).at(0);check(previous,'QUANT_STRATEGY_NOT_FOUND','현재 워크스페이스의 전략을 선택하세요.',404);check(previous.status==='APPROVED','QUANT_DRAFT_EXISTS','작성 중인 최신 초안을 열어 편집하세요.',409);}}
 const document=createQuantStrategyResource({id:target?.strategyId??previous?.strategyId??'quant-'+crypto.randomUUID(),version:target?.version??(previous?previous.version+1:1),name:source?.name??body.name,description:source?.description??body.description??'',definition:source?.definition??body.definition,createdAt:target?.createdAt??now,previousVersion:target?.document.previousVersion??(previous?{version:previous.version,contentHash:previous.contentHash}:null)});
 if(target){target.document=document;target.contentHash=document.contentHash;return {item:quantStrategyItem(target,workspace),entry:target,document};}
 const entry={id:'quant-version-'+crypto.randomUUID(),strategyId:document.id,version:document.version,document,contentHash:document.contentHash,status:'DRAFT',createdAt:now,createdBy:ownerId,review:null,importedFrom:source?{id:source.id,version:source.version,contentHash:source.contentHash}:null};
 workspace.quantStrategies??=[];workspace.quantStrategies.push(entry);return {item:quantStrategyItem(entry,workspace),entry,document};
}
export function publishQuantStrategy(workspace,body,{ownerId,now}){
 check(Object.keys(body).every(k=>['id','reason','expectedRevision','idempotencyKey'].includes(k)),'QUANT_PUBLISH_INPUT','발행할 전략 버전과 검토 사유를 입력하세요.');const entry=quantStrategyEntry(workspace,body.id);
 check(entry.status==='DRAFT','QUANT_STRATEGY_PUBLISHED','새 전략 버전을 작성해 변경 사항을 발행하세요.',409);
 check(typeof body.reason==='string'&&body.reason.trim().length>=10&&body.reason.length<=2000,'REVIEW_REASON','입력·판단 기준·매개변수를 검토한 사유를 10자 이상 작성하세요.');
 if(entry.version>1)check(list(workspace.quantStrategies).some(e=>e.strategyId===entry.strategyId&&e.version===entry.version-1&&e.status==='APPROVED'&&e.contentHash===entry.document.previousVersion.contentHash),'QUANT_PREVIOUS_VERSION_REQUIRED','직전 전략 버전을 먼저 발행하세요.',409);
 entry.status='APPROVED';entry.review={reviewedAt:now,reviewedBy:ownerId,reason:body.reason.trim()};return {item:quantStrategyItem(entry,workspace),entry,document:entry.document};
}
export function assertQuantStrategyCollectionTransition(previous=[],next=[],{ownerId}={}){
 check(Array.isArray(next)&&next.length<=QUANT_LIBRARY_LIMITS.maxVersions,'QUANT_LIBRARY_CAPACITY','전략 버전 저장 범위를 확인하세요.');const versionKeys=new Set(),ids=new Set();
 for(const e of next){
  check(e&&safeId(e.id)&&!ids.has(e.id)&&Object.keys(e).every(k=>['id','strategyId','version','document','contentHash','status','createdAt','createdBy','review','importedFrom'].includes(k)),'QUANT_STRATEGY_ROW','전략 버전 저장 구조를 확인하세요.');ids.add(e.id);assertQuantStrategyResource(e.document);
  check(e.strategyId===e.document.id&&e.version===e.document.version&&e.contentHash===e.document.contentHash&&e.createdAt===e.document.createdAt&&e.createdBy===ownerId&&['DRAFT','APPROVED'].includes(e.status),'QUANT_STRATEGY_ROW','전략 원문·소유자·버전·해시를 확인하세요.');
  const key=e.strategyId+':'+e.version;check(!versionKeys.has(key),'QUANT_STRATEGY_VERSION_EXISTS','전략 버전 번호가 중복되었습니다.',409);versionKeys.add(key);
  check(e.importedFrom===null||e.importedFrom&&Object.keys(e.importedFrom).length===3&&typeof e.importedFrom.id==='string'&&Number.isSafeInteger(e.importedFrom.version)&&e.importedFrom.version>=1&&/^[a-f0-9]{64}$/.test(e.importedFrom.contentHash),'QUANT_IMPORT_SOURCE','가져온 원본 전략의 식별자·버전·해시를 확인하세요.');
  check(e.status==='DRAFT'?e.review===null:e.review&&Object.keys(e.review).length===3&&e.review.reviewedBy===ownerId&&iso(e.review.reviewedAt)&&e.review.reviewedAt>=e.createdAt&&typeof e.review.reason==='string'&&e.review.reason.trim().length>=10&&e.review.reason.length<=2000,'QUANT_STRATEGY_REVIEW','전략 발행 검토 기록을 확인하세요.');
  if(e.version>1){const prior=next.find(p=>p.strategyId===e.strategyId&&p.version===e.version-1);check(prior&&prior.contentHash===e.document.previousVersion.contentHash,'QUANT_STRATEGY_LINEAGE','직전 전략 원문과 버전 계보를 보존하세요.',409);if(e.status==='APPROVED')check(prior.status==='APPROVED','QUANT_PREVIOUS_VERSION_REQUIRED','직전 전략 버전을 먼저 발행하세요.',409);}
 }
 for(const prior of previous){const after=next.find(e=>e.id===prior.id);check(after,'IMMUTABLE_QUANT_STRATEGY','저장된 전략 버전을 보존하세요.',409);const fixed=['id','strategyId','version','createdAt','createdBy','importedFrom'];check(fixed.every(k=>same(prior[k],after[k]))&&(prior.status==='APPROVED'?same(prior,after):after.status==='APPROVED'?same(prior.document,after.document)&&prior.contentHash===after.contentHash:after.status==='DRAFT'&&same(prior.document.previousVersion,after.document.previousVersion)),'IMMUTABLE_QUANT_STRATEGY','발행 전략의 원문과 초안의 버전 계보를 보존하세요.',409);}
 return next;
}
