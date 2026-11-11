import {marketKnowledgeHash,knowledgeRelated,selectMarketKnowledge,KNOWLEDGE_CHOICES,KNOWLEDGE_SOURCE_TYPES} from '../dist/domain/market-knowledge.mjs';
import {getInstrument} from '../dist/domain/instruments.mjs';
import {hashInputPackage} from '../dist/domain/workspace.mjs';
import {RepositoryError} from './repository.mjs';
import {assertMindInvestmentScope,universeResolutionRef} from '../dist/domain/universe-policy.mjs';
const check=(v,c,m,status=400)=>{if(!v)throw new RepositoryError(c,m,status);};
export function knowledgeItem(entry){const d=entry.document,c=entry.classificationRecord;return {id:d.id,version:d.data.version,lineageId:d.data.lineageId,previousVersionId:d.data.previousVersionId,title:d.title,status:entry.status,sourceType:d.data.sourceType,publisher:d.data.publisher,authors:d.data.authors,summary:d.data.summary,publishedAt:d.data.publication.publishedAt,publication:d.data.publication,asOf:d.asOf,availableAt:entry.availableAt??d.availableAt,validUntil:d.data.validUntil,scope:{...d.scope,coverage:d.data.coverage},classification:c?{...c.classification,model:c.provider.model,answeredAt:c.provider.answeredAt}:null,contentHash:entry.contentHash,importedAt:entry.importedAt,approvedAt:entry.review?.reviewedAt??null};}
const encode=v=>btoa(JSON.stringify(v)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
const decode=v=>JSON.parse(atob(v.replaceAll('-','+').replaceAll('_','/')));
function relatedPolicyScopes(workspace,instrumentId,{manifests=workspace.mindManifests??[],asOf,profileId='all'}){
  const profiles=new Set((workspace.investmentProfiles??[]).map(p=>p.id)),latest=new Map();
  if(profileId!=='all')check(profiles.has(profileId)||!workspace.investmentProfiles&&manifests.some(m=>m.scope?.profileId===profileId),'PROFILE_NOT_FOUND','현재 작업공간의 마인드를 선택하세요.',404);
  for(const manifest of manifests){if(manifest?.kind!=='mind-policy'||!manifest.scope?.profileId||typeof manifest.availableAt!=='string'||!Number.isFinite(Date.parse(manifest.availableAt))||new Date(manifest.availableAt).toISOString()!==manifest.availableAt||manifest.availableAt>asOf||Array.isArray(workspace.investmentProfiles)&&!profiles.has(manifest.scope.profileId))continue;if(profileId!=='all'&&manifest.scope.profileId!==profileId)continue;const prior=latest.get(manifest.scope.profileId);if(!prior||manifest.data.version>prior.data.version||manifest.data.version===prior.data.version&&manifest.availableAt>prior.availableAt)latest.set(manifest.scope.profileId,manifest);}
  const current=[...latest.values()],scopes=[];
  for(const manifest of current){if(!manifest.data.universe.instrumentIds.includes(instrumentId))continue;const hasScope=!!(manifest.data.universe.scopePolicy||manifest.data.universe.resolution),resolution=hasScope?assertMindInvestmentScope(manifest,instrumentId,{asOf,phase:'knowledge-library'}):null;
    const instrument=getInstrument(instrumentId,{resolution}),candidate=resolution?.candidates.find(i=>i.id===instrumentId),sectorContext=resolution?.sectorContexts[instrumentId]??null;
    if(sectorContext?.status==='READY')check(sectorContext.instrumentId===instrumentId&&sectorContext.snapshotRef?.contentHash===resolution.sectorSnapshotRef?.contentHash,'KNOWLEDGE_SECTOR_SOURCE','뉴스의 종목·섹터와 정책의 고정 원본을 대조하세요.');
    scopes.push({instrument:hasScope?{...instrument,marketCountry:candidate?.marketCountry??sectorContext?.marketCountry}:instrument,options:{strictScope:hasScope,sectorContext,includeRelatedEtfs:resolution?.policy?.equities?.includeRelatedEtfs===true},ref:{profileId:manifest.scope.profileId,manifestId:manifest.id,policyVersion:manifest.data.version,availableAt:manifest.availableAt,universeResolutionRef:resolution?universeResolutionRef(resolution):null}});
  }
  // Older owner libraries can exist before any published mind catalog has been created.
  if(!current.length&&profileId==='all')scopes.push({instrument:getInstrument(instrumentId),options:{},ref:null});
  return scopes;
}
export function queryMarketKnowledge(workspace,query={},options={}){
  const q=query instanceof URLSearchParams?Object.fromEntries(query):query;
  const allowed=['search','status','sourceType','authorId','level','horizon','sentiment','novelty','instrumentId','profileId','versions','pageSize','cursor'];check(Object.keys(q).every(k=>allowed.includes(k)),'KNOWLEDGE_QUERY','지원하는 자료 검색 항목을 선택하세요.');
  if(q.versions)check(['latest','all'].includes(q.versions),'KNOWLEDGE_QUERY','자료 버전 보기 방식을 선택하세요.');
  const asOf=options.asOf??new Date().toISOString();check(typeof asOf==='string'&&Number.isFinite(Date.parse(asOf))&&new Date(asOf).toISOString()===asOf,'KNOWLEDGE_QUERY_TIME','자료 조회 기준 시각을 확인하세요.');
  const search=q.search??'',pageSize=Number(q.pageSize??20);check(typeof search==='string'&&search.length<=200&&Number.isInteger(pageSize)&&pageSize>=1&&pageSize<=50,'KNOWLEDGE_QUERY','검색어 200자와 페이지 크기 1~50을 확인하세요.');
  for(const [key,values] of Object.entries({status:['SAVED','DRAFT','APPROVED'],sourceType:KNOWLEDGE_SOURCE_TYPES,...KNOWLEDGE_CHOICES}))if(q[key])check(values.includes(q[key]),'KNOWLEDGE_QUERY','자료 필터의 선택값을 확인하세요.');
  for(const key of ['authorId','instrumentId','profileId'])if(q[key])check(/^[a-zA-Z0-9][a-zA-Z0-9_.:@/-]{0,199}$/.test(q[key]),'KNOWLEDGE_QUERY','자료 범위의 ID를 확인하세요.');
  const scopeHash=hashInputPackage({...Object.fromEntries(Object.entries(q).filter(([k])=>k!=='cursor')),pageSize,search}),revision=workspace.revision;
  check(q.cursor===undefined||typeof q.cursor==='string'&&q.cursor.length<=2000,'KNOWLEDGE_CURSOR','페이지 커서의 길이를 확인하세요.');
  let after=null;if(q.cursor){try{const c=decode(q.cursor),{checksum,...payload}=c;check(checksum===hashInputPackage(payload)&&c.scopeHash===scopeHash,'KNOWLEDGE_CURSOR_SCOPE','동일한 검색 조건의 페이지를 조회하세요.');check(c.revision===revision,'KNOWLEDGE_CURSOR_STALE','자료가 변경되었습니다. 첫 페이지부터 조회하세요.',409);after=c.lastId;}catch(error){if(error instanceof RepositoryError)throw error;throw new RepositoryError('KNOWLEDGE_CURSOR','페이지 커서를 확인하세요.',400);}}
  let items=(workspace.marketKnowledge??[]).map(knowledgeItem);
  if(q.versions==='latest'){
    const latest=new Map();
    for(const item of items){const lineage=item.lineageId||item.id,prior=latest.get(lineage);if(!prior||item.version>prior.version)latest.set(lineage,item);}
    items=[...latest.values()];
  }
  items=items.filter(item=>!search||[item.title,item.summary,item.publisher,...item.authors.map(a=>a.name)].join(' ').toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  for(const key of ['status','sourceType'])if(q[key])items=items.filter(i=>i[key]===q[key]);
  for(const key of ['level','horizon','sentiment','novelty'])if(q[key])items=items.filter(i=>i.classification?.[key]===q[key]);
  if(q.authorId)items=items.filter(i=>i.authors.some(a=>a.id===q.authorId));
  let relationScopes=null;
  if(q.instrumentId){relationScopes=relatedPolicyScopes(workspace,getInstrument(q.instrumentId).id,{...options,asOf,profileId:q.profileId??'all'});items=items.filter(i=>relationScopes.some(s=>knowledgeRelated({scope:i.scope,data:{coverage:i.scope.coverage}},s.instrument,s.options)));}
  else if(q.profileId&&q.profileId!=='all')check((workspace.investmentProfiles??[]).some(p=>p.id===q.profileId),'PROFILE_NOT_FOUND','현재 작업공간의 마인드를 선택하세요.',404);
  items.sort((a,b)=>b.publishedAt.localeCompare(a.publishedAt)||a.id.localeCompare(b.id));const total=items.length,index=after?items.findIndex(i=>i.id===after):-1;check(!after||index>=0,'KNOWLEDGE_CURSOR','페이지의 기준 자료를 확인하세요.');const page=items.slice(index+1,index+1+pageSize),hasMore=index+1+page.length<total;
  const payload={revision,scopeHash,lastId:page.at(-1)?.id??null};return {revision,page:{items:page,total,pageSize,hasMore,nextCursor:hasMore?encode({...payload,checksum:hashInputPackage(payload)}):null},facets:{sourceTypes:KNOWLEDGE_SOURCE_TYPES,...KNOWLEDGE_CHOICES},scope:{owner:'CURRENT_USER',asOf,search,filters:Object.fromEntries(Object.entries(q).filter(([k])=>!['cursor','pageSize','search'].includes(k))),...(relationScopes?{relationPolicy:'CURRENT_PUBLISHED_MIND_PINNED_SCOPE_UNION_V1',policyRefs:relationScopes.map(s=>s.ref).filter(Boolean)}:{})}};
}
export function verifyKnowledgeVersion(entries,doc){
  check(!entries.some(e=>e.id===doc.id),'KNOWLEDGE_EXISTS','새 자료 버전에는 새로운 ID를 사용하세요.',409);
  check(!entries.some(e=>e.document.data.lineageId===doc.data.lineageId&&e.document.data.version===doc.data.version),'KNOWLEDGE_VERSION_EXISTS','이 자료의 같은 버전이 저장되어 있습니다.',409);
  if(doc.data.version>1){const prev=entries.find(e=>e.id===doc.data.previousVersionId);check(prev&&prev.document.data.lineageId===doc.data.lineageId&&prev.document.data.version===doc.data.version-1&&prev.document.source.id===doc.source.id,'KNOWLEDGE_VERSION_CHAIN','이 사용자가 보관한 직전 자료 버전과 동일 출처를 연결하세요.');}
}
export function verifyKnowledgePins(entries,policy){for(const pin of policy?.documentPins??[]){const e=entries.find(e=>e.id===pin.id);check(e&&e.status==='APPROVED'&&e.document.data.version===pin.version&&e.contentHash===pin.contentHash&&marketKnowledgeHash(e.document)===pin.contentHash,'KNOWLEDGE_PIN_REQUIRED','승인된 라이브러리 자료의 ID·버전·해시를 고정하세요.');}}
export function marketKnowledgeUsage(workspace,entry,manifests,now){
  const same=ref=>ref?.id===entry.id&&ref.version===entry.document.data.version&&ref.contentHash===entry.contentHash;
  const eligibleMinds=manifests.flatMap(manifest=>{const instrumentIds=manifest.data.universe.instrumentIds.filter(id=>selectMarketKnowledge(workspace.marketKnowledge,manifest,getInstrument(id),now).transmittedSourceRefs.some(same));return instrumentIds.length?[{profileId:manifest.scope.profileId,name:manifest.data.name,manifestId:manifest.id,instrumentIds}]:[];});
  const transmitted=(workspace.mindRuns??[]).filter(run=>run.rawRequest?.state?.knowledgeSelection?.transmittedSourceRefs?.some(same)).sort((a,b)=>String(b.decisionAt).localeCompare(String(a.decisionAt))||a.id.localeCompare(b.id));
  const selections=(workspace.mindSelections??[]).filter(selection=>selection.rawRequest?.state?.candidates?.some(candidate=>candidate.knowledgeSelection?.transmittedSourceRefs?.some(same))).sort((a,b)=>String(b.rawRequest?.state?.decisionAt??b.createdAt).localeCompare(String(a.rawRequest?.state?.decisionAt??a.createdAt))||a.id.localeCompare(b.id));
  const run=transmitted[0],selection=selections[0];return {eligibleMinds,transmissionCount:transmitted.length+selections.length,actionTransmissionCount:transmitted.length,selectionTransmissionCount:selections.length,lastTransmittedDecision:run?{id:run.id,profileId:run.profileId,instrumentId:run.instrumentId,decisionAt:run.decisionAt,completedAt:run.decisionCompletedAt??null,model:run.provider?.model??null}:null,lastTransmittedSelection:selection?{id:selection.id,profileId:selection.profileId,selectedInstrumentId:selection.selectedInstrumentId??null,status:selection.status??null,decisionAt:selection.rawRequest?.state?.decisionAt??null,completedAt:selection.completedAt??null,model:selection.provider?.model??null}:null};
}
