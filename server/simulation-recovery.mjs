import {hashInputPackage} from '../dist/domain/workspace.mjs';
import {researchSha256} from '../dist/domain/research.mjs';
import {nextSimulationFrame,prepareSimulationDataset} from '../dist/domain/simulation.mjs';
import {prepareSimulationFrame,evaluateSimulationFrame,SIMULATION_LEGACY_SMA_ARITHMETIC} from './simulation-engine.mjs';
import {inspectMindJevResponse} from './mind-engine.mjs';
import {SIMULATION_RESPONSE_POLICY} from '../dist/domain/simulation-response-policy.mjs';
import {SimulationStoreError} from './simulation-repository.mjs';
import {inspectPreProviderRecovery} from './simulation-pre-provider-recovery.mjs';
import dataset from '../dist/data/btc-4h.json' with {type:'json'};
const clone=structuredClone,check=(ok,code,message)=>{if(!ok)throw new SimulationStoreError(code,message,409);};
export const SIMULATION_RECOVERY_CONTRACT='SIMULATION_SAVED_RESPONSE_RECOVERY_V1';
function readPhase(rows,phase){
 const parts=rows.filter(row=>row.phase===phase).sort((a,b)=>a.index-b.index),first=parts[0];
 check(first&&parts.length===first.partCount&&parts.every((row,index)=>row.index===index&&row.partCount===parts.length&&row.sha256===first.sha256&&row.byteCount===first.byteCount),'SIMULATION_RECOVERY_RAW','해당 봉의 전체 요청·응답 원문을 확인하세요.');
 const text=parts.map(row=>row.text).join('');check(new TextEncoder().encode(text).length===first.byteCount&&researchSha256(text)===first.sha256,'SIMULATION_RECOVERY_HASH','저장된 실행 원문의 해시를 대조하세요.');
 return {value:JSON.parse(text),sha256:first.sha256};
}
function retained(value){
 check(value?.retention==='FULL'&&Array.isArray(value.jsonChunks),'SIMULATION_RECOVERY_RETENTION','전체 원문이 보관된 응답을 선택하세요.');
 const text=value.jsonChunks.join('');check(new TextEncoder().encode(text).length===value.byteCount&&researchSha256(text)===value.sha256,'SIMULATION_RECOVERY_HASH','보관된 공급자 원문의 해시를 대조하세요.');return JSON.parse(text);
}
export async function inspectSimulationRecovery(store,owner,head,options={}){
 if(head.config.assetMode==='UPBIT_BTC_PORTFOLIO')return inspectPreProviderRecovery(store,owner,head,options);
 check(head.config.mode==='GRAPH_CANONICAL'&&head.status==='ACTION_REQUIRED'&&head.attempt?.status==='EXTERNAL_OUTCOME_UNKNOWN'&&head.lastError?.code==='MIND_JEV_DISTRIBUTION','SIMULATION_RECOVERY_STATE','확률 분포 확인으로 중지된 실험을 선택하세요.');
 check(!head.archivedAt&&head.jevBudget.unknown===1&&head.core.cursor+1===head.attempt.sequence,'SIMULATION_RECOVERY_SEQUENCE','현재 중지된 봉과 호출 예약을 대조하세요.');
 const sequence=head.attempt.sequence,rows=await store.rows(owner,head.id,'raw',{frameSequence:sequence,limit:200}),reservation=readPhase(rows,'RESERVED_REQUEST'),failed=readPhase(rows,'PROVIDER_FAILURE'),failure=failed.value.failure,request=retained(failure.request),response=retained(failure.response);
 check(failure.attemptKey===head.id+':'+sequence&&failure.code===head.lastError.code&&failure.responseAvailability==='RECEIVED'&&failure.provider?.httpStatus===200,'SIMULATION_RECOVERY_FAILURE','해당 호출의 수신된 실패 원문을 확인하세요.');
 check(hashInputPackage(request)===hashInputPackage(reservation.value.rawRequest)&&hashInputPackage(request)===head.attempt.requestHash&&head.attempt.preparedExecutionRequestHash===reservation.value.preparedExecutionRequestHash,'SIMULATION_RECOVERY_REQUEST','예약된 요청과 실패 요청의 원문을 대조하세요.');
 let originalFailure=null;try{inspectMindJevResponse(response,request);}catch(error){originalFailure={code:error.code,message:error.message};}
 check(originalFailure?.code==='MIND_JEV_DISTRIBUTION','SIMULATION_RECOVERY_ORIGINAL','원래 검증 실패를 재현할 수 있어야 합니다.');
 const validation=inspectMindJevResponse(response,request,{policy:SIMULATION_RESPONSE_POLICY});
 check(Object.values(validation.questions).some(q=>q.acceptedBy==='SIMULATION_ROUNDED_CHOICE_2DP'),'SIMULATION_RECOVERY_PRECISION','두 자리 반올림 범위의 응답을 선택하세요.');
 const simulation={...head.core,...head.frozenInputs};if(head.frozenInputs.researchCorpus)simulation.knowledge=[...head.frozenInputs.knowledge,...await store.frozenKnowledge(owner,head.frozenInputs.researchCorpus)];
 const frame=nextSimulationFrame(head.core,dataset,{prepared:prepareSimulationDataset(dataset,head.config)});check(frame?.sequence===sequence&&frame.asOf===head.attempt.asOf,'SIMULATION_RECOVERY_FRAME','중지된 봉과 계좌 처리 지점을 확인하세요.');
 simulation.fills=(await store.allRows(owner,head.id,'fills')).filter(fill=>(fill.at??fill.asOf)<=frame.asOf);
 const now=request.state.decisionAt;let featureArithmetic=head.recoveryCompatibility?.featureArithmetic??null,prepared=prepareSimulationFrame({simulation,frame,now,featureArithmetic});
 if(prepared.requestHash!==head.attempt.preparedExecutionRequestHash&&!featureArithmetic){featureArithmetic=SIMULATION_LEGACY_SMA_ARITHMETIC;prepared=prepareSimulationFrame({simulation,frame,now,featureArithmetic});}
 check(prepared.ready&&prepared.requiresJev&&prepared.requestHash===head.attempt.preparedExecutionRequestHash&&prepared.providerRequestHash===head.attempt.requestHash&&hashInputPackage(prepared.providerRequest)===hashInputPackage(request)&&hashInputPackage(prepared.strategyEvaluation.graphEvaluation)===hashInputPackage(head.execution.evaluation),'SIMULATION_RECOVERY_PREPARED','당시 계산·계좌·정책·전송 요청의 원본 해시가 모두 일치해야 합니다.');
 const review={contract:SIMULATION_RECOVERY_CONTRACT,id:head.id,revision:head.revision,sequence,asOf:frame.asOf,policyVersion:SIMULATION_RESPONSE_POLICY,featureArithmetic,providerCalls:0,originalFailure,originalRequestHash:head.attempt.requestHash,originalPreparedRequestHash:head.attempt.preparedExecutionRequestHash,originalResponseHash:hashInputPackage(response),originalResponseSourceHash:failure.response.sha256,reservationRowHash:reservation.sha256,failureRowHash:failed.sha256,accountHash:hashInputPackage(head.core.account),rawAnswers:clone(response.answers),validation,provider:clone(failure.provider),remainingFrames:head.core.coverage.totalDecisionFrames-head.core.cursor-1};
 review.reviewHash=hashInputPackage(review);return {review,simulation,frame,prepared,savedProviderResult:{rawRequest:request,rawResponse:response,provider:clone(failure.provider)}};
}
export async function applySimulationRecovery(inspection,{clock}){
 return evaluateSimulationFrame({simulation:inspection.simulation,frame:inspection.frame,prepared:inspection.prepared,clock,validationPolicy:SIMULATION_RESPONSE_POLICY,savedProviderResult:inspection.savedProviderResult,fetchImpl:()=>{throw new SimulationStoreError('SIMULATION_RECOVERY_PROVIDER','저장된 응답 적용은 공급자를 호출할 수 없습니다.',409);}});
}
