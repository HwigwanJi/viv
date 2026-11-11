import {readStrategyLearningExecutionIntake} from './strategy-learning-research.mjs';

const check=(ok,code,message)=>{if(!ok)throw Object.assign(new Error(message),{code,status:409});};
/** Internal flow notes cite owned, pinned execution receipts, never an invented URL. */
export async function verifyInternalExecutionContext({db,owner,manifest,document,asOf}){
 check(document.kind==='market-context'&&document.data.category==='flow'&&document.source.uri===null&&['user','mcp-llm','system-export'].includes(document.source.type),'CONTEXT_SOURCE_REQUIRED','외부 시장 자료에는 원문 HTTPS 출처를 연결하세요.');
 check(document.scope.profileId===manifest.scope.profileId&&document.scope.instrumentIds.length>0&&document.scope.instrumentIds.every(id=>manifest.data.universe.instrumentIds.includes(id)),'CONTEXT_EXECUTION_SCOPE','해당 정책의 실제 거래 종목으로 분석 범위를 지정하세요.');
 const citedInstruments=new Set(),intake=await readStrategyLearningExecutionIntake({db,owner,manifest,asOf}),records=intake.items.flatMap(item=>item.sourceRefs.map(ref=>({ref,item}))),find=id=>{
  const matches=records.filter(value=>value.ref.id===id);check(matches.length===1,'CONTEXT_EXECUTION_SOURCE_REQUIRED','같은 마인드와 현재 발행 정책의 실제 체결 원문 ID를 연결하세요.');return matches[0];
 },validate=(id,observation=null)=>{
  const {ref,item}=find(id);check(document.provenance.recordRefs.includes(ref.id)&&document.provenance.contentHashes.includes(ref.contentHash),'CONTEXT_EXECUTION_HASH','실제 체결 원문의 ID와 내용 해시를 함께 보존하세요.');
  check(ref.availableAt<=document.asOf&&ref.availableAt<=document.availableAt&&(!observation||ref.availableAt<=observation.availableAt),'CONTEXT_EXECUTION_TIME','체결 원문을 수신한 뒤 사용 가능한 관측·문서 시각을 지정하세요.');
  const fills=item.cohorts.filter(c=>c.sourceRef.id===ref.id&&c.sourceRef.contentHash===ref.contentHash);check(fills.length>0&&fills.every(c=>document.scope.instrumentIds.includes(c.instrumentId)),'CONTEXT_EXECUTION_SCOPE','연결한 실제 체결과 문서의 적용 종목을 일치시키세요.');
  for(const fill of fills)citedInstruments.add(fill.instrumentId);
  if(observation)check(fills.every(c=>c.at<=observation.asOf),'CONTEXT_EXECUTION_TIME','원 체결 시점 이후의 관측을 연결하세요.');
  return ref;
 };
 validate(document.source.id);for(const observation of document.data.observations)validate(observation.sourceRef,observation);
 check(document.scope.instrumentIds.length===citedInstruments.size&&document.scope.instrumentIds.every(id=>citedInstruments.has(id)),'CONTEXT_EXECUTION_SCOPE','문서의 적용 종목을 인용한 실제 체결 종목에 맞추세요.');
 return {sourceValidation:'SAVED_EXECUTION_SOURCE_VERIFIED',interpretationReview:'REQUIRED',sourceManifestHash:intake.sourceManifestHash};
}
