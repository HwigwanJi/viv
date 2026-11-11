import {hashInputPackage} from '../dist/domain/workspace.mjs';
import {researchSha256} from '../dist/domain/research.mjs';
import {assertMarketKnowledgeDocument,marketKnowledgeHash,KNOWLEDGE_CHOICES} from '../dist/domain/market-knowledge.mjs';

export const NEWS_COMPARISON_VERSION='NEWS_REPRESENTATION_PAIRED_V1';
export const NEWS_VARIANTS=Object.freeze(['raw','metadata','hybrid']);
export const NEWS_COMPARISON_SOURCE_TYPES=Object.freeze(['news','macro-release']);
export const PRODUCTION_REPRESENTATION='SUMMARY_CLAIMS_CLASSIFICATION_V1';
const clone=structuredClone,utf8=v=>new TextEncoder().encode(v).byteLength;
const plain=v=>!!v&&typeof v==='object'&&!Array.isArray(v)&&Object.getPrototypeOf(v)===Object.prototype;
const iso=v=>typeof v==='string'&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString()===v;
const id=v=>typeof v==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,199}$/.test(v);
const hash=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const exact=(v,keys)=>plain(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const freeze=v=>{if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;};
const withoutHash=v=>Object.fromEntries(Object.entries(v).filter(([k])=>k!=='contentHash'));
const checkedJSON=(v,depth=0)=>depth<30&&(v===null||typeof v==='boolean'||typeof v==='string'||typeof v==='number'&&Number.isFinite(v)||Array.isArray(v)&&v.every(x=>checkedJSON(x,depth+1))||plain(v)&&Object.entries(Object.getOwnPropertyDescriptors(v)).every(([k,d])=>!['__proto__','constructor','prototype'].includes(k)&&Object.hasOwn(d,'value')&&checkedJSON(d.value,depth+1)));
export class NewsComparisonError extends Error{
 constructor(code,message,details={}){super(message);this.name='NewsComparisonError';this.code=code;this.details=details;this.status=code==='NEWS_COMPARISON_OWNER'?403:code.endsWith('_NOT_FOUND')?404:409;}
}
const check=(ok,code,message,details)=>{if(!ok)throw new NewsComparisonError(code,message,details);};
function available(time,asOf,field){check(iso(time)&&time<=asOf,'NEWS_INPUT_NOT_AVAILABLE','판단 시점까지 실제 준비된 자료를 선택하세요.',{field,time:iso(time)?time:null,decisionAsOf:asOf});}
function span(body,value,keys){
 check(exact(value,keys)&&value.offsetUnit==='UTF16_CODE_UNIT'&&Number.isInteger(value.start)&&Number.isInteger(value.end)&&value.start>=0&&value.end>value.start&&value.end<=body.length&&value.bodySha256===researchSha256(body),'NEWS_SOURCE_SPAN','제공한 본문의 범위와 원문 해시를 확인하세요.');
 const boundary=i=>i===0||i===body.length||!(body.charCodeAt(i)>=0xDC00&&body.charCodeAt(i)<=0xDFFF&&body.charCodeAt(i-1)>=0xD800&&body.charCodeAt(i-1)<=0xDBFF);
 check(boundary(value.start)&&boundary(value.end),'NEWS_SOURCE_SPAN','발췌 범위는 완전한 문자를 포함해야 합니다.');
}
function bodyCoverage(body,value){
 check(exact(value,['status','verification'])&&['PROVIDED_BODY','PROVIDED_EXCERPT','VERIFIED_FULL_TEXT'].includes(value.status),'NEWS_BODY_COVERAGE','제공 본문의 범위를 명시하세요.');
 if(value.status==='VERIFIED_FULL_TEXT'){
  const p=value.verification;check(exact(p,['evidenceRef','bodySha256','verifiedAt','verifiedBy'])&&id(p.evidenceRef)&&p.bodySha256===researchSha256(body)&&iso(p.verifiedAt)&&id(p.verifiedBy),'NEWS_COMPLETENESS_EVIDENCE','전체 원문 확인의 근거와 시각·검토자를 기록하세요.');
 }else check(value.verification===null,'NEWS_BODY_COVERAGE','확인한 본문 범위에 맞는 검증 기록을 사용하세요.');
}
function classificationProjection(record){
 const c=record?.classification;check(plain(c)&&Object.entries(KNOWLEDGE_CHOICES).every(([key,choices])=>choices.includes(c[key])),'NEWS_CLASSIFICATION_REQUIRED','동일 원문에 연결한 실제 분류를 준비하세요.');
 check(plain(c.confidence)&&Object.keys(c.confidence).length===Object.keys(KNOWLEDGE_CHOICES).length&&Object.keys(KNOWLEDGE_CHOICES).every(k=>c.confidence[k]===null||typeof c.confidence[k]==='number'&&Number.isFinite(c.confidence[k])&&c.confidence[k]>=0&&c.confidence[k]<=1),'NEWS_CLASSIFICATION_CONFIDENCE','기록한 분류 확신도를 보존하세요.');
 check(c.reportedNovelty===undefined||c.reportedNovelty===null||KNOWLEDGE_CHOICES.novelty.includes(c.reportedNovelty),'NEWS_CLASSIFICATION_REQUIRED','기록된 신규성 선택을 확인하세요.');
 check(c.noveltyStatus===undefined||c.noveltyStatus===null||['PRIOR_COMPARISON_AVAILABLE','NO_COMPARISON_BASELINE'].includes(c.noveltyStatus),'NEWS_CLASSIFICATION_REQUIRED','신규성 비교 기준을 확인하세요.');
 check(c.pricedIn===undefined||c.pricedIn==='unknown','NEWS_CLASSIFICATION_REQUIRED','가격 반영 상태의 원래 계약을 보존하세요.');
 check(c.noveltyBasis===undefined||c.noveltyBasis===null||c.noveltyBasis==='OWNER_APPROVED_RELATED_LIBRARY_AT_CLASSIFICATION_TIME','NEWS_CLASSIFICATION_REQUIRED','신규성 분류의 원래 비교 범위를 보존하세요.');
 return {...Object.fromEntries(Object.keys(KNOWLEDGE_CHOICES).map(k=>[k,c[k]])),confidence:clone(c.confidence),reportedNovelty:c.reportedNovelty??null,noveltyStatus:c.noveltyStatus??null,pricedIn:c.pricedIn??'unknown',noveltyBasis:c.noveltyBasis??null};
}
/** Pure adapter. Existing claims remain text and are never inferred as typed facts.
 * Existing entry/document/provider originals are read; no source entry is edited. */
export function prepareNewsComparisonSource(entry,{bodyCompleteness,evidenceExcerpt,typedFacts}={}){
 const d=assertMarketKnowledgeDocument(entry?.document),c=entry.classificationRecord;
 check(NEWS_COMPARISON_SOURCE_TYPES.includes(d.data.sourceType),'NEWS_SOURCE_TYPE','비교할 뉴스·경제 발표 원본을 선택하세요.');
 check(entry.id===d.id&&entry.contentHash===marketKnowledgeHash(d)&&entry.status==='APPROVED'&&c?.contentHash===entry.contentHash,'NEWS_APPROVED_SOURCE_REQUIRED','승인한 원문과 분류의 해시를 대조하세요.');
 bodyCoverage(d.data.body,bodyCompleteness);
 check(exact(evidenceExcerpt,['text','offsetUnit','start','end','bodySha256','selectedAt','selectedBy'])&&typeof evidenceExcerpt.text==='string'&&iso(evidenceExcerpt.selectedAt)&&id(evidenceExcerpt.selectedBy),'NEWS_EXCERPT_REQUIRED','동일 제공 본문에서 발췌문과 선택 기록을 명시하세요.');
 span(d.data.body,evidenceExcerpt,['text','offsetUnit','start','end','bodySha256','selectedAt','selectedBy']);
 check(d.data.body.slice(evidenceExcerpt.start,evidenceExcerpt.end)===evidenceExcerpt.text,'NEWS_EXCERPT_MISMATCH','발췌문을 제공한 본문의 실제 범위와 대조하세요.');
 check(Array.isArray(typedFacts)&&new Set(typedFacts.map(f=>f.id)).size===typedFacts.length,'NEWS_TYPED_FACTS_REQUIRED','구조화 사실을 명시적으로 전달하세요. 준비된 값이 없으면 빈 배열을 전달하세요.');
 for(const f of typedFacts){
  check(exact(f,['id','subjectId','predicateId','valueType','value','unit','effectiveAt','availableAt','extractedAt','extractedBy','sourceSpan'])&&id(f.id)&&id(f.subjectId)&&id(f.predicateId)&&['number','boolean','enum'].includes(f.valueType)&&(f.unit===null||id(f.unit))&&iso(f.effectiveAt)&&iso(f.availableAt)&&iso(f.extractedAt)&&id(f.extractedBy),'NEWS_TYPED_FACT','구조화 사실의 형식·자료 시점·추출 기록을 확인하세요.');
  check(f.valueType==='number'?typeof f.value==='number'&&Number.isFinite(f.value):f.valueType==='boolean'?typeof f.value==='boolean':id(f.value),'NEWS_TYPED_FACT_VALUE','구조화 사실에는 수치·참거짓·식별된 범주 값을 사용하세요.');
  span(d.data.body,f.sourceSpan,['offsetUnit','start','end','bodySha256']);
 }
 const source={id:d.id,version:d.data.version,contentHash:entry.contentHash,originDocument:clone(d),providedBody:d.data.body,bodyCompleteness:clone(bodyCompleteness),evidenceExcerpt:clone(evidenceExcerpt),typedFacts:clone(typedFacts),classification:classificationProjection(c),immutableMetadata:{title:d.title,source:clone(d.source),sourceType:d.data.sourceType,publisher:d.data.publisher,authors:clone(d.data.authors),publication:clone(d.data.publication),asOf:d.asOf,sourceAvailableAt:d.availableAt,importedAt:entry.importedAt,fetchedAt:d.data.publication.retrievedAt,classifiedAt:c.provider?.answeredAt,approvedAt:entry.review?.reviewedAt,availableAt:entry.availableAt,classificationRequestId:c.provider?.requestId??null,classificationModel:c.provider?.model??null}};
 check(checkedJSON(source),'NEWS_SOURCE_JSON','유한한 값으로 구성한 원문·분류 기록을 사용하세요.');
 return freeze(source);
}
function sourceAvailable(source,asOf,preparedAt){
 const m=source.immutableMetadata;for(const field of ['asOf','sourceAvailableAt','importedAt','fetchedAt','classifiedAt','approvedAt','availableAt'])available(m[field],asOf,'source.'+source.id+'.'+field);
 available(m.publication.publishedAt,asOf,'source.'+source.id+'.publishedAt');
 available(source.evidenceExcerpt.selectedAt,preparedAt,'source.'+source.id+'.excerpt.selectedAt');
 if(source.bodyCompleteness.verification)available(source.bodyCompleteness.verification.verifiedAt,preparedAt,'source.'+source.id+'.completeness.verifiedAt');
 for(const f of source.typedFacts)for(const field of ['effectiveAt','availableAt','extractedAt'])available(f[field],asOf,'fact.'+f.id+'.'+field);
}
function sourceFromCanonicalCopy(source){
 const body=source.providedBody,excerpt=source.evidenceExcerpt;
 const d=assertMarketKnowledgeDocument(source.originDocument),m=source.immutableMetadata;
 check(NEWS_COMPARISON_SOURCE_TYPES.includes(d.data.sourceType),'NEWS_SOURCE_TYPE','비교할 뉴스·경제 발표 원본을 선택하세요.');
 check(source.id===d.id&&source.version===d.data.version&&source.contentHash===marketKnowledgeHash(d)&&source.providedBody===d.data.body,'NEWS_SOURCE_CHANGED','보관한 문서 원본과 실제 제공 본문의 해시를 대조하세요.');
 check(exact(m,['title','source','sourceType','publisher','authors','publication','asOf','sourceAvailableAt','importedAt','fetchedAt','classifiedAt','approvedAt','availableAt','classificationRequestId','classificationModel']),'NEWS_SOURCE_METADATA','공통 출처 메타데이터의 항목을 확인하세요.');
 const original={title:d.title,source:d.source,sourceType:d.data.sourceType,publisher:d.data.publisher,authors:d.data.authors,publication:d.data.publication,asOf:d.asOf,sourceAvailableAt:d.availableAt,fetchedAt:d.data.publication.retrievedAt};
 for(const[key,value]of Object.entries(original))check(hashInputPackage(m[key])===hashInputPackage(value),'NEWS_SOURCE_CHANGED','보관 원문과 공통 출처 정보를 대조하세요.',{field:key});
 check(id(m.classificationRequestId)&&id(m.classificationModel),'NEWS_CLASSIFICATION_REQUIRED','실제 분류의 요청 ID와 모델을 보존하세요.');
 bodyCoverage(body,source.bodyCompleteness);span(body,excerpt,['text','offsetUnit','start','end','bodySha256','selectedAt','selectedBy']);
 check(body.slice(excerpt.start,excerpt.end)===excerpt.text&&iso(excerpt.selectedAt)&&id(excerpt.selectedBy),'NEWS_EXCERPT_MISMATCH','발췌문과 선택 기록을 제공 본문과 대조하세요.');
 check(Array.isArray(source.typedFacts),'NEWS_TYPED_FACTS_REQUIRED','구조화 사실 배열을 명시하세요.');
 // Canonical sources are built by the pure adapter; revalidate individual facts
 // through the same exact contract rather than accepting raw legacy claims.
 for(const f of source.typedFacts){check(exact(f,['id','subjectId','predicateId','valueType','value','unit','effectiveAt','availableAt','extractedAt','extractedBy','sourceSpan'])&&id(f.id)&&id(f.subjectId)&&id(f.predicateId)&&['number','boolean','enum'].includes(f.valueType)&&(f.unit===null||id(f.unit))&&iso(f.effectiveAt)&&iso(f.availableAt)&&iso(f.extractedAt)&&id(f.extractedBy),'NEWS_TYPED_FACT','구조화 사실과 출처 연결을 확인하세요.');check(f.valueType==='number'?typeof f.value==='number'&&Number.isFinite(f.value):f.valueType==='boolean'?typeof f.value==='boolean':id(f.value),'NEWS_TYPED_FACT_VALUE','구조화 사실 값을 확인하세요.');span(body,f.sourceSpan,['offsetUnit','start','end','bodySha256']);}
 check(new Set(source.typedFacts.map(f=>f.id)).size===source.typedFacts.length,'NEWS_TYPED_FACT','구조화 사실 ID를 구분하세요.');
 const c=classificationProjection({classification:source.classification});
 return {...source,classification:c};
}

import {assertMindDocument,mindDocumentHash} from '../dist/domain/mind-manifest.mjs';
import {selectMarketKnowledge} from '../dist/domain/market-knowledge.mjs';
import {assertMindInvestmentScope,universeResolutionRef} from '../dist/domain/universe-policy.mjs';
import {validateMindJevResponse,evaluateMindRisk} from './mind-engine.mjs';

export const NEWS_COMPARISON_OBJECT_LIMIT=500000;
export const NEWS_COMPARISON_RESPONSE_RESERVE=260000;
export const NEWS_COMPARISON_TRANSFORM='SAME_SOURCE_NEUTRAL_NEWS_REFERENCES_V1';
const recordSeal=value=>freeze({...value,recordHash:hashInputPackage(value)});
const removeRecordHash=value=>Object.fromEntries(Object.entries(value).filter(([k])=>k!=='recordHash'));
const ownerCheck=(record,ownerId)=>check(id(ownerId)&&record.ownerId===ownerId,'NEWS_COMPARISON_OWNER','현재 사용자의 비교 실험을 선택하세요.');
const sizeCheck=(value,field)=>check(utf8(JSON.stringify(value))<=NEWS_COMPARISON_OBJECT_LIMIT,'NEWS_COMPARISON_OBJECT_LIMIT','한 비교 원본의 저장 한도를 초과했습니다.',{field,actual:utf8(JSON.stringify(value)),limit:NEWS_COMPARISON_OBJECT_LIMIT});
const safeIdList=v=>Array.isArray(v)&&new Set(v).size===v.length&&v.every(id);
function recordAssert(record,{ownerId}={}){
 ownerCheck(record,ownerId);
 check(record.kind==='NEWS_INPUT_COMPARISON'&&record.contractVersion===NEWS_COMPARISON_VERSION&&Number.isSafeInteger(record.revision)&&record.revision>=0&&record.recordHash===hashInputPackage(removeRecordHash(record))&&record.plan.contentHash===hashInputPackage(withoutHash(record.plan))&&Array.isArray(record.attempts)&&Array.isArray(record.receipts),'NEWS_COMPARISON_RECORD','저장한 비교 계획과 결과 해시를 대조하세요.');
 return record;
}
function knownContentLeak(request,sources){
 const strings=sources.flatMap(s=>[s.providedBody,s.originDocument.data.summary,...s.originDocument.data.claims.map(c=>c.text)]).filter(v=>typeof v==='string'&&v.length);
 const sourceIds=new Set(sources.map(s=>s.id)),answerKeys=new Set(['rawResponse','jevResponse','futureOutcome','futurePrice','groundTruth','expectedAction','expectedChoice','decisionResult']);
 const walk=value=>{
  if(typeof value==='string'){check(!strings.some(text=>value===text||text.length>=16&&value.includes(text)),'NEWS_HIDDEN_SOURCE_CONTENT','뉴스 본문·요약·주장을 지정한 표현 입력에서만 전달하세요.');return;}
  if(Array.isArray(value)){value.forEach(walk);return;}
  if(!plain(value))return;
  check(!(sourceIds.has(value.id)&&['summary','claims','body','classification','providedBody'].some(k=>Object.hasOwn(value,k))),'NEWS_HIDDEN_SOURCE_CONTENT','같은 뉴스의 숨은 입력을 제거한 원본을 선택하세요.');
  for(const[k,v]of Object.entries(value)){check(!answerKeys.has(k),'NEWS_FUTURE_OUTCOME_INPUT','당시 입력에 후속 결과나 정답을 추가할 수 없습니다.',{field:k});walk(v);}
 };walk(request);
}
function projectSource(source,variant){
 const base={id:source.id,version:source.version,contentHash:source.contentHash,title:source.immutableMetadata.title,immutableMetadata:clone(source.immutableMetadata),bodyCompleteness:clone(source.bodyCompleteness)};
 if(variant==='raw')return {...base,providedBody:source.providedBody};
 const metadata={...base,classification:clone(source.classification),typedFacts:clone(source.typedFacts),typedFactsAvailability:source.typedFacts.length?'PROVIDED_TYPED_FACTS':'CLASSIFICATION_ONLY'};
 return variant==='metadata'?metadata:{...metadata,evidenceExcerpt:clone(source.evidenceExcerpt)};
}
function neutralRequest(base,sources){
 const request=clone(base),byId=new Map(sources.map(s=>[s.id,s])),refs=request.state.evidenceReferences;
 check(Array.isArray(refs)&&plain(request.questions?.buyEvidence?.criteria)&&plain(request.questions?.sellEvidence?.criteria),'NEWS_SOURCE_REQUEST','기존 원본의 근거 선택지와 원요청을 확인하세요.');
 request.state.externalKnowledge=request.state.externalKnowledge.map(s=>byId.has(s.id)?{id:s.id,version:s.version,contentHash:s.contentHash,title:byId.get(s.id).immutableMetadata.title}:s);
 refs.forEach((ref,index)=>{const source=byId.get(ref.id);if(!source||ref.type!=='market-knowledge')return;const text='market-knowledge '+source.id+' · '+source.immutableMetadata.title;
  request.state.evidenceReferences[index]={...ref,text};for(const key of ['summary','claims','body','providedBody','classification'])delete request.state.evidenceReferences[index][key];
  for(const side of ['buyEvidence','sellEvidence'])if(Object.hasOwn(request.questions[side].criteria,'r'+index))request.questions[side].criteria['r'+index]=text;
 });
 knownContentLeak(request,sources);
 return request;
}
function makeSnapshot(spec,{workspace,mindId,preparedAt,limits}){
 check(exact(spec,['id','sourceRunId','eventGroup','sourceDocuments'])&&id(spec.id)&&id(spec.sourceRunId)&&Array.isArray(spec.sourceDocuments)&&spec.sourceDocuments.length>0&&spec.sourceDocuments.length<=limits.maxDocumentsPerSnapshot,'NEWS_COMPARISON_SNAPSHOT','기존 결정·동일 사건·비교할 원문을 선택하세요.');
 const run=workspace.mindRuns?.find(r=>r.id===spec.sourceRunId),state=run?.rawRequest?.state;
 check(run&&run.profileId===mindId&&['live','replay'].includes(run.mode)&&plain(state)&&run.inputHash===hashInputPackage(state)&&run.rawRequest.model&&plain(run.rawRequest.questions)&&Object.keys(run.rawRequest.questions).sort().join(',')==='action,buyEvidence,sellEvidence,stance','NEWS_SOURCE_RUN','현재 마인드에 저장한 실제 원요청을 선택하세요.');
 const asOf=run.decisionAt;
 check(iso(asOf)&&asOf<=preparedAt&&state.decisionAt===asOf&&state.profileId===run.profileId&&state.market?.instrument?.id===run.instrumentId&&state.marketAsOf===run.asOf,'NEWS_SOURCE_RUN_SCOPE','기존 판단의 마인드·종목·실제 시점을 대조하세요.');
 const market=state.market;
 check(Array.isArray(market.closedBars)&&market.closedBars.length>0&&market.closedBars.every((bar,index,rows)=>bar.isClosed===true&&iso(bar.openTime)&&iso(bar.closeTime)&&bar.openTime<bar.closeTime&&bar.closeTime<=asOf&&(!index||rows[index-1].closeTime<bar.closeTime))&&market.closedBars.at(-1).closeTime===run.asOf&&market.asOf===run.asOf&&market.source?.asOf===run.asOf,'NEWS_SOURCE_FUTURE_MARKET','당시까지 확정된 가격 원본으로 비교하세요.');
 available(market.source.availableAt,asOf,'market.source.availableAt');available(market.source.receivedAt,asOf,'market.source.receivedAt');
 if(state.portfolio?.accountAsOf!==null&&state.portfolio?.accountAsOf!==undefined)available(state.portfolio.accountAsOf,asOf,'portfolio.accountAsOf');
 const manifest=workspace.mindManifests?.find(m=>m.id===run.manifestId);
 assertMindDocument(manifest);check(manifest.scope.profileId===mindId&&run.manifestHash===mindDocumentHash(manifest)&&state.manifestHash===run.manifestHash&&state.manifestId===manifest.id&&manifest.availableAt<=asOf,'NEWS_SOURCE_POLICY','기존 결정에 고정한 정책과 해시를 선택하세요.');
 const resolution=assertMindInvestmentScope(manifest,run.instrumentId,{asOf,phase:'news-comparison',...(state.universeResolutionRef?{expectedResolutionHash:state.universeResolutionRef.contentHash}:{})});
 const scopeRef=universeResolutionRef(resolution);
 if(state.universeResolutionRef)check(hashInputPackage(state.universeResolutionRef)===hashInputPackage(scopeRef),'NEWS_SOURCE_UNIVERSE','원래 판단의 동일 투자 범위와 자료 시점을 유지하세요.');
 validateMindJevResponse(run.rawResponse,run.rawRequest);
 const instrument=resolution.candidates?.find(i=>i.id===run.instrumentId)??state.market.instrument,eligible=selectMarketKnowledge(workspace.marketKnowledge??[],manifest,instrument,asOf).selected,original=state.externalKnowledge??[],seen=new Set();
 const sources=spec.sourceDocuments.map(choice=>{
  check(exact(choice,['documentId','bodyCompleteness','evidenceExcerpt','typedFacts'])&&id(choice.documentId)&&!seen.has(choice.documentId),'NEWS_COMPARISON_SOURCE','원문 ID와 표현에 필요한 명시 입력을 한 번씩 전달하세요.');seen.add(choice.documentId);
  const entry=workspace.marketKnowledge?.find(e=>e.id===choice.documentId),sent=original.find(s=>s.id===choice.documentId),allowed=eligible.find(s=>s.id===choice.documentId);
  check(entry&&sent&&allowed&&sent.version===entry.document.data.version&&sent.contentHash===entry.contentHash&&allowed.version===sent.version&&allowed.contentHash===sent.contentHash&&NEWS_COMPARISON_SOURCE_TYPES.includes(entry.document.data.sourceType),'NEWS_SOURCE_NOT_TRANSMITTED','기존 결정에 실제 전달한 사용 가능 뉴스·경제 발표 원본을 선택하세요.');
  check(hashInputPackage(sent.classification)===hashInputPackage(entry.classificationRecord.classification),'NEWS_SOURCE_CLASSIFICATION_CHANGED','원래 전달한 뉴스 분류와 보관 분류를 대조하세요.');
  const source=prepareNewsComparisonSource(entry,choice);sourceFromCanonicalCopy(source);sourceAvailable(source,asOf,preparedAt);
  for(const[field,actual,maximum]of [['providedBody',utf8(source.providedBody),limits.maxBodyUtf8Bytes],['evidenceExcerpt',utf8(source.evidenceExcerpt.text),limits.maxExcerptUtf8Bytes]])check(actual<=maximum,'NEWS_PAYLOAD_LIMIT','명시한 원문·발췌 바이트 한도를 초과했습니다.',{sourceId:source.id,field,actual,limit:maximum});
  return source;
 });
 const group=spec.eventGroup;check(exact(group,['id','knownAt','sourceDocumentIds'])&&id(group.id)&&safeIdList(group.sourceDocumentIds)&&group.sourceDocumentIds.length===sources.length&&sources.every(s=>group.sourceDocumentIds.includes(s.id)),'NEWS_EVENT_GROUP','시점별 같은 사건으로 묶은 원문 ID를 명시하세요.');available(group.knownAt,preparedAt,'eventGroup.knownAt');
 const declaredGroup={...clone(group),groupingMode:group.knownAt<=asOf?'AS_OF_DECLARATION':'RETROSPECTIVE_DECLARATION'};
 const transformed=neutralRequest(run.rawRequest,sources);
 return {id:spec.id,sourceRunId:run.id,profileId:mindId,instrumentId:run.instrumentId,sourceMode:run.mode,sourceModel:run.rawResponse.model,comparisonMode:'PAIRED_DECISION_REPLAY',executionMode:'paper',decisionAsOf:asOf,marketAsOf:run.asOf,preparedAt,eventGroup:declaredGroup,manifestId:manifest.id,manifestHash:run.manifestHash,universeResolutionRef:clone(scopeRef),sourceDocuments:sources,baseRequest:clone(run.rawRequest),commonRequest:transformed,transform:{version:NEWS_COMPARISON_TRANSFORM,sourceRequestHash:hashInputPackage(run.rawRequest),sourceStateHash:run.inputHash,originalQuestionsHash:hashInputPackage(run.rawRequest.questions),commonRequestHash:hashInputPackage(transformed),commonQuestionsHash:hashInputPackage(transformed.questions),rule:'TARGET_NEWS_REFERENCE_TEXT_AND_EVIDENCE_LABELS_TO_COMMON_TITLE_ID; TARGET_CONTENT_ONLY_IN_EXTERNAL_KNOWLEDGE',timing:'CURRENT_PREPARATION_OF_ORIGINAL_AVAILABLE_SOURCE',sourceAvailabilityCutoff:asOf,excerptPreparedAt:preparedAt}};
}
export function createNewsComparisonPlan(input,{workspace,ownerId,now}={}){
 check(id(ownerId)&&iso(now)&&workspace&&exact(input,['id','mindId','snapshots','repetitionsPerVariant','budget','payloadLimits'])&&id(input.id)&&id(input.mindId)&&Array.isArray(input.snapshots)&&input.snapshots.length>0&&new Set(input.snapshots.map(s=>s.id)).size===input.snapshots.length&&Number.isSafeInteger(input.repetitionsPerVariant)&&input.repetitionsPerVariant>=1,'NEWS_COMPARISON_CONFIG','마인드·동일 시점·반복 수와 명시 예산을 준비하세요.');
 const budget=input.budget,limits=input.payloadLimits,keys=['maxDocumentsPerSnapshot','maxBodyUtf8Bytes','maxExcerptUtf8Bytes','maxVariantInputUtf8Bytes'];
 check(exact(budget,['maxDecisionCalls','maxTotalCost'])&&Number.isSafeInteger(budget.maxDecisionCalls)&&budget.maxDecisionCalls>0&&(budget.maxTotalCost===null||exact(budget.maxTotalCost,['currency','amount'])&&['USD','KRW'].includes(budget.maxTotalCost.currency)&&Number.isFinite(budget.maxTotalCost.amount)&&budget.maxTotalCost.amount>0),'NEWS_COMPARISON_BUDGET','실험의 최대 호출 수와 비용 한도를 명시하세요.');
 check(exact(limits,keys)&&keys.every(k=>Number.isSafeInteger(limits[k])&&limits[k]>0),'NEWS_PAYLOAD_LIMITS','원문·발췌·문서 수·전체 요청의 UTF-8 한도를 명시하세요.');
 const count=input.snapshots.length*3*input.repetitionsPerVariant;
 check(Number.isSafeInteger(count)&&count<=budget.maxDecisionCalls,'NEWS_CALL_BUDGET_EXCEEDED','계획한 판단 수가 명시한 호출 한도를 초과했습니다.',{plannedDecisionCalls:count,maxDecisionCalls:budget.maxDecisionCalls});
 const snapshots=input.snapshots.map(spec=>makeSnapshot(spec,{workspace,mindId:input.mindId,preparedAt:now,limits})),eventBySource=new Map();
 for(const s of snapshots)for(const source of s.sourceDocuments){const old=eventBySource.get(source.id);check(!old||old.id===s.eventGroup.id&&old.knownAt===s.eventGroup.knownAt,'NEWS_EVENT_GROUP_CHANGED','같은 원문의 동일 시점 사건 묶음을 유지하세요.');eventBySource.set(source.id,s.eventGroup);}
 const core={schemaVersion:1,contractVersion:NEWS_COMPARISON_VERSION,id:input.id,mindId:input.mindId,createdAt:now,variants:[...NEWS_VARIANTS],repetitionsPerVariant:input.repetitionsPerVariant,budget:clone(budget),payloadLimits:clone(limits),plannedDecisionCalls:count,representationContract:{raw:'PROVIDED_BODY_AND_COMMON_PROVENANCE',metadata:'CLASSIFICATION_AND_EXPLICIT_TYPED_FACTS',hybrid:'SAME_METADATA_AND_VERIFIABLE_PROVIDED_BODY_EXCERPT',productionBaseline:PRODUCTION_REPRESENTATION,legacySummaryAndClaims:'EXCLUDED_FROM_TARGET_NEWS_IN_ALL_ARMS'},snapshots};
 const plan={...core,contentHash:hashInputPackage(core)},record=recordSeal({schemaVersion:1,kind:'NEWS_INPUT_COMPARISON',contractVersion:NEWS_COMPARISON_VERSION,id:input.id,ownerId,mindId:input.mindId,revision:0,status:'PLANNED',createdAt:now,updatedAt:now,plan,attempts:[],receipts:[]});
 for(const s of snapshots)for(const variant of NEWS_VARIANTS)buildNewsComparisonRequest(record,{snapshotId:s.id,variant});
 sizeCheck(record,'plan');return record;
}
function coreOf(record){const plan=record.plan??record;check(plan?.contentHash===hashInputPackage(withoutHash(plan)),'NEWS_COMPARISON_CHANGED','고정 비교 입력의 해시를 대조하세요.');return plan;}
export function buildNewsComparisonInput(record,{snapshotId,variant}={}){
 const plan=coreOf(record);check(NEWS_VARIANTS.includes(variant),'NEWS_VARIANT','등록한 뉴스 표현 군을 선택하세요.');const snapshot=plan.snapshots.find(s=>s.id===snapshotId);check(snapshot,'NEWS_SNAPSHOT_NOT_FOUND','고정한 비교 시점을 선택하세요.');
 const request=clone(snapshot.commonRequest),sources=new Map(snapshot.sourceDocuments.map(s=>[s.id,s]));request.state.externalKnowledge=request.state.externalKnowledge.map(s=>sources.has(s.id)?projectSource(sources.get(s.id),variant):s);
 const bytes=utf8(JSON.stringify(request));check(bytes<=plan.payloadLimits.maxVariantInputUtf8Bytes,'NEWS_PAYLOAD_LIMIT','비교 군의 전체 요청 바이트 한도를 초과했습니다.',{snapshotId,variant,actual:bytes,limit:plan.payloadLimits.maxVariantInputUtf8Bytes});
 const storageEstimate=bytes+NEWS_COMPARISON_RESPONSE_RESERVE+16384;check(storageEstimate<=NEWS_COMPARISON_OBJECT_LIMIT,'NEWS_RESULT_CAPACITY','실제 결과 원문을 보관할 수 있도록 요청 크기를 줄이세요.',{requestBytes:bytes,responseReserve:NEWS_COMPARISON_RESPONSE_RESERVE,limit:NEWS_COMPARISON_OBJECT_LIMIT});
 return freeze({snapshotId,variant,state:request.state,request,inputHash:hashInputPackage(request.state),requestHash:hashInputPackage(request),inputUtf8Bytes:bytes,commonQuestionsHash:hashInputPackage(request.questions),sourceRunId:snapshot.sourceRunId,sourceMode:snapshot.sourceMode,instrumentId:snapshot.instrumentId,decisionAsOf:snapshot.decisionAsOf,eventGroup:clone(snapshot.eventGroup)});
}
export function buildNewsComparisonRequest(record,selection){return buildNewsComparisonInput(record,selection).request;}
export function assertNewsComparisonIsolation(record,inputs){
 const plan=coreOf(record);check(Array.isArray(inputs)&&inputs.length===plan.snapshots.length*3,'NEWS_VARIANTS_INCOMPLETE','각 시점의 세 군을 하나씩 검증하세요.');const seen=new Set();
 for(const actual of inputs){const key=actual.snapshotId+':'+actual.variant;check(!seen.has(key)&&hashInputPackage(actual)===hashInputPackage(buildNewsComparisonInput(record,{snapshotId:actual.snapshotId,variant:actual.variant})),'NEWS_VARIANT_FEATURE_LEAK','비교 군의 고정 원본과 전체 입력을 대조하세요.');seen.add(key);}
 return {ok:true,snapshots:plan.snapshots.length,variantsPerSnapshot:3,questionsFixed:true,sharedSourceRunsFixed:true};
}
function slot(record,{snapshotId,variant,repetition}){
 const plan=coreOf(record);check(NEWS_VARIANTS.includes(variant)&&Number.isSafeInteger(repetition)&&repetition>=1&&repetition<=plan.repetitionsPerVariant,'NEWS_COMPARISON_SLOT','동일 시점의 표현 군과 반복 순서를 확인하세요.');const input=buildNewsComparisonInput(record,{snapshotId,variant});return {...input,repetition,slotKey:hashInputPackage({snapshotId,variant,repetition})};
}
function change(record,mutate,now){const next=clone(record);delete next.recordHash;next.revision++;next.updatedAt=now;mutate(next);sizeCheck(next,'experiment');return recordSeal(next);}
function receipt(record,key,fingerprint,type){const r=record.receipts.find(r=>r.key===key);if(r)check(r.type===type&&r.fingerprint===fingerprint,'NEWS_IDEMPOTENCY_CONFLICT','같은 비교 요청의 작업과 내용이 변경되었습니다.');return r;}
export function reserveNewsComparisonAttempt(record,command,{ownerId,now}={}){
 recordAssert(record,{ownerId});check(iso(now)&&exact(command,['snapshotId','variant','repetition','idempotencyKey','expectedRevision','optInJev'])&&id(command.idempotencyKey)&&command.optInJev===true&&Number.isSafeInteger(command.expectedRevision),'NEWS_COMPARISON_CALL_CONSENT','호출할 비교 군과 명시한 JEV 실행 조건을 확인하세요.');
 const selected=slot(record,command),fingerprint=hashInputPackage({type:'reserve',slotKey:selected.slotKey,requestHash:selected.requestHash}),prior=receipt(record,command.idempotencyKey,fingerprint,'reserve');
 if(prior)return {experiment:record,attempt:record.attempts.find(a=>a.id===prior.attemptId),request:null,canCall:false,idempotent:true};
 check(command.expectedRevision===record.revision,'NEWS_COMPARISON_REVISION_CONFLICT','최신 비교 실험을 다시 조회하세요.');
 check(!record.attempts.some(a=>a.slotKey===selected.slotKey),'NEWS_COMPARISON_SLOT_RESERVED','이 비교 군의 실제 요청이 이미 예약됐습니다.');
 check(!record.attempts.some(a=>['RESERVED','OUTCOME_UNKNOWN'].includes(a.status)),'NEWS_COMPARISON_ACTION_REQUIRED','저장된 호출 결과를 확인한 뒤 다음 비교를 실행하세요.');
 check(record.attempts.length<record.plan.budget.maxDecisionCalls,'NEWS_CALL_BUDGET_EXCEEDED','명시한 판단 호출 한도를 모두 예약했습니다.');
 check(record.plan.budget.maxTotalCost===null,'NEWS_COST_ESTIMATE_REQUIRED','금액 한도를 적용하려면 제공자 요율과 비용 예약 정책을 먼저 연결하세요.');
 const attempt={id:'news-attempt-'+hashInputPackage({experimentId:record.id,slotKey:selected.slotKey}).slice(0,32),slotKey:selected.slotKey,snapshotId:selected.snapshotId,sourceRunId:selected.sourceRunId,sourceMode:selected.sourceMode,instrumentId:selected.instrumentId,variant:selected.variant,repetition:selected.repetition,eventGroupId:selected.eventGroup.id,requestHash:selected.requestHash,inputHash:selected.inputHash,status:'RESERVED',reservedAt:now,completedAt:null,resultId:null,provider:null,decision:null,risk:null,error:null};
 const next=change(record,n=>{n.status='RUNNING';n.attempts.push(attempt);n.receipts.push({key:command.idempotencyKey,type:'reserve',fingerprint,attemptId:attempt.id,createdAt:now});},now);
 return {experiment:next,attempt:clone(attempt),request:clone(selected.request),canCall:true,idempotent:false};
}
function selectedAttempt(record,attemptId){const attempt=record.attempts.find(a=>a.id===attemptId);check(attempt,'NEWS_ATTEMPT_NOT_FOUND','저장한 비교 호출을 선택하세요.');return attempt;}
function providerProjection(provider,raw,attempt,now){
 check(plain(provider)&&id(provider.requestId)&&iso(provider.startedAt)&&provider.startedAt>=attempt.reservedAt&&iso(provider.answeredAt)&&provider.answeredAt>=provider.startedAt&&provider.answeredAt<=now&&provider.httpStatus===200,'NEWS_PROVIDER_PROVENANCE','실제 응답의 요청 ID·HTTP 상태·시작과 완료 시각을 보존하세요.');
 check(provider.model===raw.model,'NEWS_PROVIDER_MODEL','실제 분류 모델과 응답 모델을 대조하세요.');
 const usage=provider.usage??null;check(usage===null||plain(usage)&&Object.keys(usage).length<=30&&Object.entries(usage).every(([k,v])=>/^[a-z][a-z0-9_]{0,79}$/.test(k)&&typeof v==='number'&&Number.isFinite(v)&&v>=0),'NEWS_PROVIDER_USAGE','실제 제공자 사용량을 유한한 수치로 보존하세요.');
 return {requestId:provider.requestId,providerRequestId:id(provider.providerRequestId)?provider.providerRequestId:null,model:provider.model,startedAt:provider.startedAt,answeredAt:provider.answeredAt,responseReceivedAt:iso(provider.responseReceivedAt)?provider.responseReceivedAt:null,httpStatus:200,latencyMs:typeof provider.latencyMs==='number'&&Number.isFinite(provider.latencyMs)&&provider.latencyMs>=0?provider.latencyMs:null,usage:clone(usage)};
}
function derivedDecision(request,raw){
 const action=raw.answers.action.choice,answer=raw.answers[action==='sell'?'sellEvidence':'buyEvidence'],index=/^r\d+$/.test(answer.choice)?Number(answer.choice.slice(1)):-1,evidence=request.state.evidenceReferences[index];
 return {action,stance:raw.answers.stance.choice,confidence:raw.answers.action.confidence,probabilities:clone(raw.answers.action.probabilities??null),stanceConfidence:raw.answers.stance.confidence,stanceProbabilities:clone(raw.answers.stance.probabilities??null),evidenceRefs:action==='hold'||!evidence?[]:[evidence.id],evidence:evidence?clone(evidence):null,allChoices:clone(raw.answers),provider:'jev',model:raw.model,asOf:request.state.marketAsOf,decisionAt:request.state.decisionAt};
}
function finalStatus(next){next.status=next.attempts.some(a=>a.status==='OUTCOME_UNKNOWN')?'ACTION_REQUIRED':next.attempts.some(a=>a.status==='RESERVED')?'RUNNING':next.attempts.length===next.plan.plannedDecisionCalls?(next.attempts.every(a=>a.status==='COMPLETED')?'COMPLETED':'PARTIAL'):'PLANNED';}
export function completeNewsComparisonAttempt(record,{attemptId,idempotencyKey,rawRequest,rawResponse,provider},{ownerId,now}={}){
 recordAssert(record,{ownerId});check(iso(now)&&id(idempotencyKey),'NEWS_COMPARISON_RESULT','실제 비교 응답과 저장 요청을 확인하세요.');const attempt=selectedAttempt(record,attemptId),fingerprint=hashInputPackage({type:'complete',attemptId,rawRequest,rawResponse,provider}),saved=receipt(record,idempotencyKey,fingerprint,'complete');
 if(saved)return {experiment:record,resultArtifact:null,idempotent:true,resultId:attempt.resultId};
 check(attempt.status==='RESERVED','NEWS_ATTEMPT_FINALIZED','이미 보존한 실제 호출 결과를 조회하세요.');
 const expected=buildNewsComparisonRequest(record,{snapshotId:attempt.snapshotId,variant:attempt.variant});check(hashInputPackage(rawRequest)===attempt.requestHash&&hashInputPackage(rawRequest)===hashInputPackage(expected),'NEWS_RESULT_REQUEST_CHANGED','유료 호출 전에 예약한 정확한 요청 원문을 보존하세요.');
 check(checkedJSON(rawResponse)&&utf8(JSON.stringify(rawResponse))<=NEWS_COMPARISON_RESPONSE_RESERVE,'NEWS_RESULT_RESPONSE_LIMIT','실제 응답의 원문 형식과 크기를 확인하세요.');validateMindJevResponse(rawResponse,expected);
 const actualProvider=providerProjection(provider,rawResponse,attempt,now),decision=derivedDecision(expected,rawResponse),risk=evaluateMindRisk(expected,decision),snapshot=record.plan.snapshots.find(s=>s.id===attempt.snapshotId);
 const comparisonEligibility={eligible:rawResponse.model===snapshot.sourceModel,expectedModel:snapshot.sourceModel,actualModel:rawResponse.model,reason:rawResponse.model===snapshot.sourceModel?null:'MODEL_VERSION_CHANGED'},status=comparisonEligibility.eligible?'COMPLETED':'INCOMPARABLE';
 const artifactCore={schemaVersion:1,kind:'NEWS_INPUT_COMPARISON_RESULT',id:'news-result-'+attempt.id,experimentId:record.id,ownerId,attemptId:attempt.id,planHash:record.plan.contentHash,slotKey:attempt.slotKey,snapshotId:attempt.snapshotId,sourceRunId:attempt.sourceRunId,sourceMode:attempt.sourceMode,instrumentId:attempt.instrumentId,variant:attempt.variant,repetition:attempt.repetition,eventGroupId:attempt.eventGroupId,status,comparisonEligibility,createdAt:now,requestHash:attempt.requestHash,responseHash:hashInputPackage(rawResponse),rawRequest:clone(rawRequest),rawResponse:clone(rawResponse),provider:actualProvider,decision,risk,financialEffects:'READ_ONLY_RESEARCH'};
 const resultArtifact=freeze({...artifactCore,contentHash:hashInputPackage(artifactCore)});sizeCheck(resultArtifact,'result');
 const next=change(record,n=>{const a=n.attempts.find(a=>a.id===attemptId);Object.assign(a,{status,comparisonEligibility,completedAt:now,resultId:resultArtifact.id,provider:actualProvider,decision,risk});n.receipts.push({key:idempotencyKey,type:'complete',fingerprint,attemptId,createdAt:now});finalStatus(n);},now);
 return {experiment:next,resultArtifact,idempotent:false,resultId:resultArtifact.id};
}
export function failNewsComparisonAttempt(record,{attemptId,idempotencyKey,errorCode,responseAvailability,rawRequest,rawResponse=null,provider=null},{ownerId,now}={}){
 recordAssert(record,{ownerId});check(iso(now)&&id(idempotencyKey)&&id(errorCode)&&['NOT_RECEIVED','NOT_RETAINED','RECEIVED'].includes(responseAvailability),'NEWS_COMPARISON_FAILURE','실제 실패 원인과 응답 보존 상태를 명시하세요.');const attempt=selectedAttempt(record,attemptId),fingerprint=hashInputPackage({type:'failure',attemptId,errorCode,responseAvailability,rawRequest,rawResponse,provider}),saved=receipt(record,idempotencyKey,fingerprint,'failure');
 if(saved)return {experiment:record,resultArtifact:null,idempotent:true,resultId:attempt.resultId};
 check(attempt.status==='RESERVED','NEWS_ATTEMPT_FINALIZED','보존한 호출 결과를 조회하세요.');check(hashInputPackage(rawRequest)===attempt.requestHash,'NEWS_RESULT_REQUEST_CHANGED','예약한 실제 요청을 보존하세요.');check(checkedJSON(rawResponse)&&checkedJSON(provider),'NEWS_COMPARISON_FAILURE','유한한 실제 응답과 제공자 기록을 보존하세요.');
 const status=responseAvailability==='RECEIVED'?'FAILED':'OUTCOME_UNKNOWN',body={schemaVersion:1,kind:'NEWS_INPUT_COMPARISON_RESULT',id:'news-result-'+attempt.id,experimentId:record.id,ownerId,attemptId,planHash:record.plan.contentHash,slotKey:attempt.slotKey,snapshotId:attempt.snapshotId,sourceRunId:attempt.sourceRunId,sourceMode:attempt.sourceMode,instrumentId:attempt.instrumentId,variant:attempt.variant,repetition:attempt.repetition,eventGroupId:attempt.eventGroupId,status,createdAt:now,requestHash:attempt.requestHash,rawRequest:clone(rawRequest),rawResponse:clone(rawResponse),provider:clone(provider),responseAvailability,errorCode,decision:null,risk:null,financialEffects:'READ_ONLY_RESEARCH'};
 const resultArtifact=freeze({...body,contentHash:hashInputPackage(body)});sizeCheck(resultArtifact,'failureResult');
 const next=change(record,n=>{const a=n.attempts.find(a=>a.id===attemptId);Object.assign(a,{status,completedAt:now,resultId:resultArtifact.id,error:{code:errorCode,responseAvailability}});n.receipts.push({key:idempotencyKey,type:'failure',fingerprint,attemptId,createdAt:now});finalStatus(n);},now);
 return {experiment:next,resultArtifact,idempotent:false,resultId:resultArtifact.id};
}
export function newsComparisonSummary(record,{ownerId}={}){
 recordAssert(record,{ownerId});const grouped=new Map();for(const a of record.attempts){const key=a.snapshotId+':'+a.repetition,rows=grouped.get(key)??[];rows.push(a);grouped.set(key,rows);}const paired=[...grouped.values()].filter(rows=>rows.length===3&&rows.every(a=>a.status==='COMPLETED')&&new Set(rows.map(a=>a.variant)).size===3);
 return {id:record.id,mindId:record.mindId,revision:record.revision,status:record.status,createdAt:record.createdAt,updatedAt:record.updatedAt,planHash:record.plan.contentHash,representationContract:clone(record.plan.representationContract),budget:{...clone(record.plan.budget),plannedDecisionCalls:record.plan.plannedDecisionCalls,reservedCalls:record.attempts.length,completedCalls:record.attempts.filter(a=>a.status==='COMPLETED').length,unknownCalls:record.attempts.filter(a=>a.status==='OUTCOME_UNKNOWN').length,actualMonetaryCost:null,costStatus:'PROVIDER_RATES_NOT_CONFIGURED'},snapshots:record.plan.snapshots.map(s=>({id:s.id,sourceRunId:s.sourceRunId,instrumentId:s.instrumentId,sourceMode:s.sourceMode,comparisonMode:s.comparisonMode,decisionAsOf:s.decisionAsOf,marketAsOf:s.marketAsOf,preparedAt:s.preparedAt,eventGroup:clone(s.eventGroup),manifestId:s.manifestId,manifestHash:s.manifestHash,universeResolutionRef:clone(s.universeResolutionRef),transform:clone(s.transform),sources:s.sourceDocuments.map(d=>({id:d.id,version:d.version,contentHash:d.contentHash,title:d.immutableMetadata.title,bodyCompleteness:d.bodyCompleteness.status,typedFactsCount:d.typedFacts.length}))})),evidenceCounts:{declaredEventGroups:new Set(record.plan.snapshots.map(s=>s.eventGroup.id)).size,snapshots:record.plan.snapshots.length,pairedRepeats:paired.length,countBasis:'DECLARED_EVENT_GROUPS_ARE_NOT_VALIDATED_INDEPENDENT_SAMPLES'},pairedResults:paired.map(rows=>({snapshotId:rows[0].snapshotId,repetition:rows[0].repetition,eventGroupId:rows[0].eventGroupId,sameAction:new Set(rows.map(a=>a.decision.action)).size===1,sameStance:new Set(rows.map(a=>a.decision.stance)).size===1,arms:rows.map(a=>({variant:a.variant,decision:clone(a.decision),risk:clone(a.risk),provider:clone(a.provider),resultId:a.resultId}))})),attempts:record.attempts.map(a=>({...clone(a)})),financialEffects:'READ_ONLY_RESEARCH',performanceStatus:'PAIRED_DECISIONS_ONLY'};
}

