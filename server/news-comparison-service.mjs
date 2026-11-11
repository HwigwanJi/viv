import {NEWS_COMPARISON_SOURCE_TYPES,createNewsComparisonPlan,reserveNewsComparisonAttempt,completeNewsComparisonAttempt,failNewsComparisonAttempt,newsComparisonSummary} from './news-input-comparison.mjs';
import {callMindJev} from './mind-engine.mjs';
import {researchSha256} from '../dist/domain/research.mjs';
import {hashInputPackage,validateWorkspace} from '../dist/domain/workspace.mjs';
import {RepositoryError,readOperationalWorkspace} from './repository.mjs';
const clone=structuredClone,list=x=>Array.isArray(x)?x:[];
const check=(ok,code,message,status=400)=>{if(!ok)throw new RepositoryError(code,message,status);};
export function newsComparisonSources(workspace,runId){
  const run=list(workspace.mindRuns).find(r=>r.id===runId);check(run,'RUN_NOT_FOUND','비교할 결정 기록을 선택하세요.',404);
  check(run.jevCalled!==false&&run.rawResponse,'NEWS_PROVIDER_DECISION_REQUIRED','JEV 원응답이 저장된 결정을 선택하세요.',409);
  const sent=run.rawRequest?.state?.externalKnowledge??[];
  const documents=list(workspace.marketKnowledge).filter(e=>e.status==='APPROVED'&&NEWS_COMPARISON_SOURCE_TYPES.includes(e.document.data.sourceType)&&sent.some(s=>s.id===e.id&&s.version===e.document.data.version&&s.contentHash===e.contentHash)).map(e=>({id:e.id,title:e.document.title,body:e.document.data.body,contentHash:e.contentHash,version:e.document.data.version,sourceType:e.document.data.sourceType,availableAt:e.availableAt}));
  return {runId:run.id,mindId:run.profileId,instrumentId:run.instrumentId,decisionAt:run.decisionAt,documents};
}
export function createNewsComparisonFromRun(workspace,body,{ownerId,now}={}){
  const source=newsComparisonSources(workspace,body.runId),document=source.documents.find(d=>d.id===body.documentId);
  check(document,'NEWS_SENT_SOURCE_REQUIRED','이 결정에 실제 전달된 승인 자료를 선택하세요.');
  check(typeof body.excerptText==='string'&&body.excerptText.trim().length>0&&body.excerptText.length<=12000,'NEWS_EXCERPT_REQUIRED','저장 본문에서 비교할 근거 구절을 선택하세요.');
  const start=document.body.indexOf(body.excerptText);check(start>=0,'NEWS_EXCERPT_NOT_IN_BODY','근거 구절은 저장 본문과 정확히 일치해야 합니다.');
  check(Number.isSafeInteger(body.repetitions)&&body.repetitions>=1&&body.repetitions<=10,'NEWS_REPETITIONS','각 입력 방식의 반복 수를 1~10회로 설정하세요.');
  const input={id:'news-comparison-'+crypto.randomUUID(),mindId:source.mindId,snapshots:[{id:'case-'+crypto.randomUUID(),sourceRunId:source.runId,eventGroup:{id:'article-'+hashInputPackage({id:document.id,version:document.version}).slice(0,32),knownAt:now,sourceDocumentIds:[document.id]},sourceDocuments:[{documentId:document.id,bodyCompleteness:{status:'PROVIDED_BODY',verification:null},evidenceExcerpt:{text:body.excerptText,offsetUnit:'UTF16_CODE_UNIT',start,end:start+body.excerptText.length,bodySha256:researchSha256(document.body),selectedAt:now,selectedBy:ownerId},typedFacts:[]}]}],repetitionsPerVariant:body.repetitions,budget:{maxDecisionCalls:body.maxDecisionCalls,maxTotalCost:null},payloadLimits:{maxDocumentsPerSnapshot:1,maxBodyUtf8Bytes:160000,maxExcerptUtf8Bytes:48000,maxVariantInputUtf8Bytes:200000}};
  return createNewsComparisonPlan(input,{workspace,ownerId,now});
}
export function readNewsComparisons(workspace,{ownerId,mindId,id,resultId}={}){
  if(resultId){const result=list(workspace.newsComparisonResults).find(r=>r.id===resultId&&r.ownerId===ownerId);check(result,'NEWS_RESULT_NOT_FOUND','저장된 비교 원문을 선택하세요.',404);return {result:clone(result)};}
  if(id){const record=list(workspace.newsComparisons).find(r=>r.id===id&&r.ownerId===ownerId);check(record,'NEWS_COMPARISON_NOT_FOUND','비교 실험을 선택하세요.',404);return {experiment:newsComparisonSummary(record,{ownerId})};}
  return {items:list(workspace.newsComparisons).filter(r=>r.ownerId===ownerId&&(!mindId||mindId==='all'||r.mindId===mindId)).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).map(r=>newsComparisonSummary(r,{ownerId}))};
}
/** Reserve in the owner workspace before the paid request. A retry observes the same slot. */
export async function runNewsComparison({workspace,repository,ownerId,body,env,fetchImpl,clock,persistReservation}){
  const record=list(workspace.newsComparisons).find(r=>r.id===body.id&&r.ownerId===ownerId);check(record,'NEWS_COMPARISON_NOT_FOUND','비교 실험을 선택하세요.',404);
  const reservation=reserveNewsComparisonAttempt(record,{snapshotId:body.snapshotId,variant:body.variant,repetition:body.repetition,idempotencyKey:body.idempotencyKey,expectedRevision:body.comparisonRevision,optInJev:body.optInJev},{ownerId,now:clock()});
  if(!reservation.canCall)return {ok:true,idempotent:true,experiment:newsComparisonSummary(reservation.experiment,{ownerId})};
  check(typeof env?.TYPESAFE_API_KEY==='string'&&env.TYPESAFE_API_KEY.trim().length>0,'JEV_CONNECTION_REQUIRED','JEV 연결을 확인하세요.',503);
  const reserved=clone(workspace);reserved.newsComparisons[reserved.newsComparisons.findIndex(r=>r.id===record.id)]=reservation.experiment;
  await persistReservation(reserved,{experiment:newsComparisonSummary(reservation.experiment,{ownerId})});
  let outcome,providerResult;
  try{const response=providerResult=await callMindJev({request:reservation.request,env,fetchImpl,clock});outcome=completeNewsComparisonAttempt(reservation.experiment,{attemptId:reservation.attempt.id,idempotencyKey:'complete-'+hashInputPackage(body.idempotencyKey),...response},{ownerId,now:clock()});}
  catch(error){
    const sourceText=typeof error.rawResponseText==='string'?{format:'SANITIZED_PROVIDER_TEXT_UTF8_V1',text:error.rawResponseText,sha256:researchSha256(error.rawResponseText)}:null;
    outcome=failNewsComparisonAttempt(reservation.experiment,{attemptId:reservation.attempt.id,idempotencyKey:'failed-'+hashInputPackage(body.idempotencyKey),errorCode:typeof error.code==='string'?error.code:'NEWS_JEV_FAILED',responseAvailability:sourceText||error.rawResponse||providerResult?.rawResponse?'RECEIVED':error.responseAvailability==='NOT_RETAINED'?'NOT_RETAINED':'NOT_RECEIVED',rawRequest:error.rawRequest??providerResult?.rawRequest??reservation.request,rawResponse:sourceText??error.rawResponse??providerResult?.rawResponse??null,provider:error.provider??providerResult?.provider??null},{ownerId,now:clock()});
  }
  for(let retry=0;retry<3;retry++){
    const previous=await readOperationalWorkspace(repository,ownerId),current=previous.newsComparisons.find(r=>r.id===record.id);check(current?.recordHash===reservation.experiment.recordHash,'NEWS_RESERVED_RECORD_CHANGED','저장된 비교 요청을 확인하세요.',409);
    const next=clone(previous);next.newsComparisons[next.newsComparisons.findIndex(r=>r.id===record.id)]=outcome.experiment;
    if(outcome.resultArtifact)next.newsComparisonResults.push(outcome.resultArtifact);
    next.revision=previous.revision+1;next.updatedAt=clock();const errors=validateWorkspace(next);check(!errors.length,errors[0]?.code??'INVALID_WORKSPACE',errors[0]?.message??'저장 결과를 확인하세요.');
    try{await repository.commit(ownerId,previous,next,'news-result-'+reservation.attempt.id);return {ok:true,revision:next.revision,experiment:newsComparisonSummary(outcome.experiment,{ownerId}),resultId:outcome.resultId};}
    catch(error){if(error.code!=='REVISION_CONFLICT'||retry===2)throw error;}
  }
}
