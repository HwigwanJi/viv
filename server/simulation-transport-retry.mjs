import {hashInputPackage} from '../dist/domain/workspace.mjs';
import {researchSha256} from '../dist/domain/research.mjs';
import {nextSimulationFrame,prepareSimulationDataset} from '../dist/domain/simulation.mjs';
import {prepareSimulationFrame,evaluateSimulationFrame} from './simulation-engine.mjs';
import {inspectJevQuestionResponse} from '../dist/domain/jev-question.mjs';
import {inspectMindJevResponse} from './mind-engine.mjs';
import {nextPortfolioFrame,restorePortfolioAccount,portfolioAccountSummary,preparePortfolioSimulationFrame} from '../dist/domain/portfolio-simulation.mjs';
import {mindDocumentHash} from '../dist/domain/mind-manifest.mjs';
import {strategyGraphHash} from '../dist/domain/strategy-graph.mjs';
import {portfolioDataset,portfolioExecutionView} from './portfolio-simulation-engine.mjs';
import {evaluatePortfolioJevFrame} from './portfolio-jev-runtime.mjs';
import dataset from '../dist/data/btc-4h.json' with {type:'json'};
const clone=structuredClone;
const check=(ok,code,message)=>{if(!ok)throw Object.assign(new Error(message),{code,status:409});};
export const SIMULATION_TRANSPORT_RETRY_CONTRACT='EXPLICIT_UNOBSERVED_TRANSPORT_RETRY_V1';
function chunkValue(rows){
 const parts=rows.toSorted((a,b)=>a.index-b.index),first=parts[0];check(first&&parts.length===first.partCount&&parts.every((r,i)=>r.index===i&&r.sha256===first.sha256&&r.byteCount===first.byteCount),'SIMULATION_RETRY_RAW','원래 호출의 모든 기록 조각을 확인하세요.');
 const text=parts.map(r=>r.text).join('');check(researchSha256(text)===first.sha256&&new TextEncoder().encode(text).length===first.byteCount,'SIMULATION_RETRY_HASH','원래 호출 기록의 해시를 확인하세요.');return {value:JSON.parse(text),hash:first.sha256};
}
export async function inspectSimulationTransportRetry(store,owner,head,options={}){
 check(head.config.mode==='GRAPH_CANONICAL'&&head.status==='ACTION_REQUIRED'&&head.attempt?.status==='EXTERNAL_OUTCOME_UNKNOWN'&&!head.archivedAt,'SIMULATION_RETRY_STATE','수신 실패로 중지된 실험을 선택하세요.');
 check(['JEV_QUESTION_NETWORK','JEV_QUESTION_RESPONSE_READ'].includes(head.lastError?.code),'SIMULATION_RETRY_FAILURE','응답 본문을 받지 못한 연결 실패만 다시 전송할 수 있습니다.');
 const sequence=head.attempt.sequence,index=head.attempt.stage?.index,retries=(head.transportRetries??[]).filter(r=>r.sequence===sequence);
 check(retries.length===0,'SIMULATION_RETRY_LIMIT','같은 봉의 수동 재전송은 한 번까지 지원합니다.');
 check(head.core.cursor+1===sequence&&Number.isSafeInteger(index)&&index>=0&&index<9&&head.attempt.stage.type==='JEV_QUESTION','SIMULATION_RETRY_STAGE','중지된 질문과 미처리 봉을 대조하세요.');
 check(head.jevBudget.reserved<head.jevBudget.maximum,'SIMULATION_BUDGET_EXHAUSTED','재전송에 사용할 호출 예산이 필요합니다.');
 const rows=(await store.allRows(owner,head.id,'raw')).filter(r=>r.frameSequence===sequence),failed=chunkValue(rows.filter(r=>r.phase==='PROVIDER_FAILURE'&&!r.manualRetryAttempt)),failure=failed.value.failure;
 check(failure?.attemptKey===head.id+':'+sequence&&failure.code===head.lastError.code&&!failure.response&&['NOT_RECEIVED','NOT_RETAINED'].includes(failure.responseAvailability)&&!failure.provider?.responseReceivedAt&&!failure.provider?.answeredAt&&!failure.provider?.usage&&!failure.provider?.model&&(failure.provider?.responseBodyBytes==null||failure.provider.responseBodyBytes===0),'SIMULATION_RETRY_RESPONSE_PRESENT','수신한 응답이나 일부 본문이 있는 호출은 다시 전송할 수 없습니다.');
 check(failure.request?.retention==='FULL'&&Array.isArray(failure.request.jsonChunks),'SIMULATION_RETRY_REQUEST','원래 질문 요청의 전체 기록을 확인하세요.');
 const text=failure.request.jsonChunks.join('');check(researchSha256(text)===failure.request.sha256,'SIMULATION_RETRY_HASH','원래 요청 원문을 확인하세요.');const failedRequest=JSON.parse(text);
 const reservation=chunkValue(rows.filter(r=>r.phase==='PROVIDER_STAGE_REQUEST'&&r.stageIndex===index&&!r.manualRetryAttempt)),stage=reservation.value.stage;
 check(stage.rawRequestHash===head.attempt.requestHash&&stage.rawRequestHash===hashInputPackage(stage.rawRequest)&&hashInputPackage(failedRequest)===stage.rawRequestHash&&stage.nodeId===head.attempt.stage.nodeId&&stage.index===index,'SIMULATION_RETRY_REQUEST','저장한 요청·질문·예약을 대조하세요.');
 const priorStages=[];
 for(let i=0;i<index;i++){
  const prior=chunkValue(rows.filter(r=>r.phase==='PROVIDER_STAGE_RESULT'&&r.stageIndex===i&&!r.manualRetryAttempt)).value.stage;
  check(prior.index===i&&hashInputPackage(prior.rawRequest)===prior.rawRequestHash&&hashInputPackage(prior.rawResponse)===prior.rawResponseHash,'SIMULATION_RETRY_PRIOR','앞서 완료된 질문의 원문을 대조하세요.');
  const node=head.core.manifest.data.strategyPlan.graph.nodes.find(n=>n.id===prior.nodeId);
  if(prior.type==='JEV_QUESTION')inspectJevQuestionResponse(prior.rawResponse,[node.config.question],{requestedModel:prior.rawRequest.model});else inspectMindJevResponse(prior.rawResponse,prior.rawRequest);
  priorStages.push(prior);
 }
 const portfolio=head.config.assetMode==='UPBIT_BTC_PORTFOLIO',simulation={...head.core,...head.frozenInputs};if(head.frozenInputs.researchCorpus)simulation.knowledge=[...head.frozenInputs.knowledge,...await store.frozenKnowledge(owner,head.frozenInputs.researchCorpus)];
 const frame=portfolio?nextPortfolioFrame(head.core):nextSimulationFrame(head.core,dataset,{prepared:prepareSimulationDataset(dataset,head.config)});check(frame&&frame.sequence===sequence&&frame.asOf===head.attempt.asOf,'SIMULATION_RETRY_FRAME','원래 결정 시점과 봉을 유지하세요.');
 let account=null,bundle=null;
 const fills=await store.allRows(owner,head.id,'fills');
 if(portfolio){
  check(head.attempt.stageCount===index&&hashInputPackage(head.config)===hashInputPackage(head.core.config),'SIMULATION_RETRY_STAGE','고정한 일봉 설정과 중지된 질문 순서를 대조하세요.');
  check(!rows.some(r=>r.phase==='PROVIDER_STAGE_RESULT'&&r.stageIndex>=index),'SIMULATION_RETRY_RESPONSE_PRESENT','수신한 질문 응답을 먼저 확인하세요.');
  const decisions=await store.allRows(owner,head.id,'decisions'),curve=await store.allRows(owner,head.id,'curve');
  check(decisions.length===head.core.cursor&&decisions.length===head.core.rowsCounts.decisions&&decisions.every((r,i)=>r.sequence===i+1)&&fills.length===head.core.rowsCounts.fills&&fills.every(r=>r.frameSequence<sequence)&&curve.length===head.core.cursor&&curve.length===head.core.rowsCounts.curve&&curve.every((r,i)=>r.sequence===i+1),'SIMULATION_RETRY_LEDGER','완료된 결정·체결·평가와 미처리 봉을 대조하세요.');
  account=restorePortfolioAccount(head.core,{fills,decisions});
  check(hashInputPackage(portfolioAccountSummary(account))===hashInputPackage(head.core.account),'SIMULATION_RETRY_LEDGER','표시된 계좌와 복원한 원장을 대조하세요.');
  check(mindDocumentHash(head.core.manifest)===head.core.pins.manifestHash&&strategyGraphHash(head.core.manifest.data.strategyPlan.graph)===head.core.pins.graphHash,'SIMULATION_RETRY_POLICY','고정한 정책과 그래프 원문을 대조하세요.');
  bundle=portfolioDataset(head.config.datasetId,options);
  check(bundle.indexSha256===head.core.pins.datasetHash&&head.frozenInputs.datasetSha256===bundle.indexSha256,'SIMULATION_RETRY_DATASET','생성 시 고정한 BTC 일봉 자료를 대조하세요.');
  check(hashInputPackage(portfolioExecutionView(stage.graphEvaluation))===hashInputPackage(head.execution.evaluation),'SIMULATION_RETRY_PREPARED','중단 시점의 저장된 그래프를 대조하세요.');
 }else simulation.fills=fills.filter(fill=>fill.at<=frame.asOf);
 const now=[...priorStages,stage].map(s=>s.rawRequest.state?.decisionAt).find(Boolean)??head.attempt.reservedAt??head.updatedAt,prepared=portfolio?preparePortfolioSimulationFrame({core:head.core,account,bundle,frame}):prepareSimulationFrame({simulation,frame,now,featureArithmetic:head.recoveryCompatibility?.featureArithmetic??null});
 check(portfolio?!!prepared.request:prepared.ready&&prepared.requiresJev,'SIMULATION_RETRY_INPUT','동일 봉의 계산 자료와 연결 상태를 확인하세요.');
 const replay={frame,simulation,prepared,stage,priorStages,account,bundle,portfolio};let verified=false;
 const providerHooks=transportRetryHooks(replay,{beforeCall(){verified=true;throw Object.assign(new Error('request verified'),{code:'SIMULATION_RETRY_VERIFIED'});},afterCall(){throw new Error('unexpected provider result');}});
 try{if(portfolio)await evaluatePortfolioJevFrame({prepared,manifest:head.core.manifest,env:{},clock:()=>now,providerHooks});else await evaluateSimulationFrame({simulation,frame,prepared,env:{},clock:()=>now,providerHooks});}catch(error){if(error.code!=='SIMULATION_RETRY_VERIFIED')throw error;}
 check(verified,'SIMULATION_RETRY_REQUEST','원래 질문의 동일 요청을 복원하세요.');
 if(portfolio)check(hashInputPackage(await store.get(owner,head.id))===hashInputPackage(head),'SIMULATION_REVISION_CONFLICT','실험이 변경됐습니다. 재전송 검토를 다시 조회하세요.');
 const review={contractVersion:SIMULATION_TRANSPORT_RETRY_CONTRACT,canRetry:true,message:'같은 질문을 한 번 다시 전송합니다. 이전 호출의 과금 여부는 미확정 상태로 보존합니다.',id:head.id,revision:head.revision,sequence,asOf:frame.asOf,nodeId:stage.nodeId,stageIndex:index,originalRequestHash:stage.rawRequestHash,originalRequestSourceHash:failure.request.sha256,originalFailureHash:failed.hash,failureCode:failure.code,responseAvailability:failure.responseAvailability,partialResponseBytesKnown:Number.isSafeInteger(failure.provider?.responseBodyBytes),responseBodyBytes:failure.provider?.responseBodyBytes??null,originalReservedCalls:head.jevBudget.reserved,maximumCalls:head.jevBudget.maximum,manualRetryLimit:1,manualRetriesUsed:0,unknownChargePossible:true,originalProvider:clone(failure.provider),accountHash:hashInputPackage(head.core.account),coreHash:hashInputPackage(head.core),graphHash:head.core.pins.graphHash,priorSuccessfulStages:priorStages.length,automaticRetries:0,...(portfolio?{assetMode:head.config.assetMode,timeframe:'1d',quoteCurrency:'BTC',datasetHash:bundle.indexSha256,preparedInputHash:prepared.inputHash}:{})};review.reviewHash=hashInputPackage(review);
 return {review,frame,simulation,prepared,stage,priorStages,account,bundle,portfolio};
}
export function transportRetryHooks(inspection,journal){
 let retryStarted=false;
 return {
  async reuseResult(stage){
   if(stage.index>=inspection.stage.index)return null;
   const saved=inspection.priorStages[stage.index];check(saved&&saved.nodeId===stage.nodeId&&saved.rawRequestHash===stage.rawRequestHash&&saved.preparedGraphHash===stage.preparedGraphHash,'SIMULATION_RETRY_PRIOR','이전 질문의 동일한 계산 경로와 요청을 재생하세요.');
   return {rawRequest:clone(saved.rawRequest),rawResponse:clone(saved.rawResponse),rawResponseText:saved.rawResponseText,rawRequestHash:saved.exactRequestHash,rawResponseHash:saved.exactResponseHash,provider:clone(saved.provider)};
  },
  async beforeCall(stage){
   if(stage.index===inspection.stage.index){check(!retryStarted&&stage.nodeId===inspection.stage.nodeId&&stage.rawRequestHash===inspection.stage.rawRequestHash&&stage.preparedGraphHash===inspection.stage.preparedGraphHash,'SIMULATION_RETRY_REQUEST_CHANGED','동일한 원요청과 계산 경로로만 재전송하세요.');retryStarted=true;}
   else check(retryStarted&&stage.index>inspection.stage.index,'SIMULATION_RETRY_STAGE','미완료 질문의 순서를 확인하세요.');
   return journal.beforeCall(stage);
  },
  afterCall:stage=>journal.afterCall(stage)
 };
}
