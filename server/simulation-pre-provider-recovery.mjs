import {hashInputPackage} from '../dist/domain/workspace.mjs';
import {researchSha256} from '../dist/domain/research.mjs';
import {mindDocumentHash} from '../dist/domain/mind-manifest.mjs';
import {strategyGraphHash} from '../dist/domain/strategy-graph.mjs';
import {nextPortfolioFrame,restorePortfolioAccount,portfolioAccountSummary,preparePortfolioSimulationFrame} from '../dist/domain/portfolio-simulation.mjs';
import {portfolioDataset,portfolioExecutionView} from './portfolio-simulation-engine.mjs';
import {SimulationStoreError} from './simulation-repository.mjs';

export const PRE_PROVIDER_RECOVERY_CONTRACT='SIMULATION_PRE_PROVIDER_RECOVERY_V1';
const FAILURE_CODE='PORTFOLIO_BLIND_PROJECTION',AUDIT_PHASE='PRE_PROVIDER_RECOVERY_AUDIT',clone=structuredClone;
const check=(value,code,message)=>{if(!value)throw new SimulationStoreError(code,message,409);};
// This is a display hint. The review below checks stored rows and the execution lease separately.
export function isPreProviderRecoveryCandidate(head){return head?.config?.mode==='GRAPH_CANONICAL'&&head.config.assetMode==='UPBIT_BTC_PORTFOLIO'&&head.status==='ACTION_REQUIRED'&&!head.archivedAt&&head.lastError?.code===FAILURE_CODE&&head.attempt?.status==='FAILED'&&head.attempt.stageCount===0;}

function stageValue(rows){
 const parts=rows.toSorted((a,b)=>a.index-b.index),first=parts[0];
 check(first&&parts.length===first.partCount&&parts.every((r,i)=>r.index===i&&r.partCount===parts.length&&r.sha256===first.sha256&&r.byteCount===first.byteCount),'SIMULATION_RECOVERY_JOURNAL','완료된 질문의 전체 호출 기록을 대조하세요.');
 const text=parts.map(r=>r.text).join('');check(researchSha256(text)===first.sha256&&new TextEncoder().encode(text).length===first.byteCount,'SIMULATION_RECOVERY_JOURNAL','완료된 질문 원문의 해시를 대조하세요.');return JSON.parse(text).stage;
}
function verifyCompletedJournal(raw,budget,cursor){
 const stages=new Map();
 for(const row of raw.filter(r=>['PROVIDER_STAGE_REQUEST','PROVIDER_STAGE_RESULT'].includes(r.phase))){
  check(Number.isSafeInteger(row.frameSequence)&&row.frameSequence>=1&&row.frameSequence<=cursor&&Number.isSafeInteger(row.stageIndex)&&row.stageIndex>=0&&row.stageIndex<9&&!row.manualRetryAttempt,'SIMULATION_RECOVERY_JOURNAL','현재 지점까지 완료된 질문 예약을 대조하세요.');
  const key=row.frameSequence+':'+row.stageIndex,group=stages.get(key)??{request:[],result:[]};group[row.phase==='PROVIDER_STAGE_REQUEST'?'request':'result'].push(row);stages.set(key,group);
 }
 check(stages.size===budget.reserved&&stages.size===budget.completed,'SIMULATION_RECOVERY_BUDGET','저장된 요청·응답 수와 사용한 호출 예산을 대조하세요.');
 for(const group of stages.values()){
  const request=stageValue(group.request),result=stageValue(group.result);
  check(request&&result&&request.index===result.index&&request.nodeId===result.nodeId&&request.type===result.type&&request.rawRequestHash===hashInputPackage(request.rawRequest)&&result.rawRequestHash===request.rawRequestHash&&hashInputPackage(result.rawRequest)===request.rawRequestHash&&result.rawResponseHash===hashInputPackage(result.rawResponse),'SIMULATION_RECOVERY_JOURNAL','이전 질문의 예약과 수신 원문을 대조하세요.');
 }
 return stages.size;
}

export async function inspectPreProviderRecovery(store,owner,head,options={}){
 check(isPreProviderRecoveryCandidate(head),'SIMULATION_RECOVERY_STATE','호출 전 입력 검증으로 중지된 실험을 선택하세요.');
 check(Object.keys(head.attempt).every(k=>['sequence','asOf','status','stageCount','startedAt'].includes(k))&&head.execution?.phase==='COMPUTING','SIMULATION_RECOVERY_STAGE','현재 봉의 공급자 예약과 응답이 없는지 확인하세요.');
 const frame=nextPortfolioFrame(head.core),sequence=frame?.sequence;
 check(frame&&sequence===head.attempt.sequence&&frame.asOf===head.attempt.asOf&&head.execution.sequence===sequence&&head.execution.asOf===frame.asOf,'SIMULATION_RECOVERY_FRAME','원 계좌의 다음 처리 지점과 중단 시점을 대조하세요.');
 check(head.jevBudget?.unknown===0&&Number.isSafeInteger(head.jevBudget.reserved)&&head.jevBudget.reserved>=0&&head.jevBudget.reserved===head.jevBudget.completed&&head.core.totals.jevCalls===head.jevBudget.completed,'SIMULATION_RECOVERY_BUDGET','모든 이전 호출이 완료된 상태를 확인하세요.');
 const [raw,fills,decisions,curve]=await Promise.all(['raw','fills','decisions','curve'].map(kind=>store.allRows(owner,head.id,kind)));
 check(raw.every(r=>r.frameSequence<sequence),'SIMULATION_RECOVERY_CURRENT_ROWS','중단된 봉에 저장된 공급자·처리 기록을 먼저 확인하세요.');
 check(decisions.length===head.core.cursor&&decisions.length===head.core.rowsCounts.decisions&&decisions.every((r,i)=>r.sequence===i+1)&&fills.length===head.core.rowsCounts.fills&&fills.every(r=>r.frameSequence<sequence)&&curve.length===head.core.rowsCounts.curve&&curve.length===head.core.cursor&&curve.every((r,i)=>r.sequence===i+1),'SIMULATION_RECOVERY_LEDGER','완료된 결정·체결·평가와 계좌 처리 지점을 대조하세요.');
 const completedStages=verifyCompletedJournal(raw,head.jevBudget,head.core.cursor),account=restorePortfolioAccount(head.core,{fills,decisions});
 check(hashInputPackage(portfolioAccountSummary(account))===hashInputPackage(head.core.account),'SIMULATION_RECOVERY_LEDGER','표시된 계좌와 체결 원장으로 복원한 계좌를 대조하세요.');
 check(mindDocumentHash(head.core.manifest)===head.core.pins.manifestHash&&strategyGraphHash(head.core.manifest.data.strategyPlan.graph)===head.core.pins.graphHash,'SIMULATION_RECOVERY_POLICY','고정한 정책과 그래프 원문을 대조하세요.');
 const bundle=portfolioDataset(head.config.datasetId,options),prepared=preparePortfolioSimulationFrame({core:head.core,account,bundle,frame}),preparedGraph=portfolioExecutionView(prepared.request.state.strategyEvaluation.graphEvaluation);
 check(hashInputPackage(preparedGraph)===hashInputPackage(head.execution.evaluation),'SIMULATION_RECOVERY_PREPARED','중단 시점의 원 입력과 준비된 그래프를 대조하세요.');
 const originalHeadHash=hashInputPackage(head);check(hashInputPackage(await store.get(owner,head.id))===originalHeadHash,'SIMULATION_REVISION_CONFLICT','실험이 변경됐습니다. 복구 검토를 다시 조회하세요.');
 const review={contract:PRE_PROVIDER_RECOVERY_CONTRACT,recoveryKind:'PRE_PROVIDER_FAILURE',canRecover:true,id:head.id,revision:head.revision,sequence,asOf:frame.asOf,providerCalls:0,automaticRetries:0,resumeRequiresSeparateStep:true,originalFailure:clone(head.lastError),originalHeadHash,originalAttemptHash:hashInputPackage(head.attempt),originalErrorHash:hashInputPackage(head.lastError),preparedGraphHash:hashInputPackage(head.execution.evaluation),preparedInputHash:prepared.inputHash,graphHash:head.core.pins.graphHash,accountHash:hashInputPackage(head.core.account),ledgerAccountHash:hashInputPackage(account),coreHash:hashInputPackage(head.core),rawRowsHash:hashInputPackage(raw),completedStages,unchangedBudget:clone(head.jevBudget)};
 review.reviewHash=hashInputPackage(review);return {review,frame};
}

export function preparePreProviderRecovery(head,inspection,{now}){
 const {review}=inspection;check(review.contract===PRE_PROVIDER_RECOVERY_CONTRACT&&hashInputPackage(head)===review.originalHeadHash,'SIMULATION_RECOVERY_REVIEW','검토한 원본 상태를 다시 확인하세요.');
 const audit={contract:PRE_PROVIDER_RECOVERY_CONTRACT,recordedAt:now,providerCalls:0,review:clone(review),originalHead:clone(head)},text=JSON.stringify(audit),sha256=researchSha256(text),parts=[];
 for(let offset=0;offset<text.length;){let end=Math.min(text.length,offset+12000);if(end<text.length&&text.charCodeAt(end-1)>=0xD800&&text.charCodeAt(end-1)<=0xDBFF)end--;parts.push(text.slice(offset,end));offset=end;}
 check(parts.length<1000,'SIMULATION_RECOVERY_AUDIT','복구 원문의 저장 범위를 확인하세요.');
 // Portfolio transport reserves per-question slots starting at 3000. Its unused
 // 0..999 interval retains this audit, leaving 9000..9999 for transport failures.
 const byteCount=new TextEncoder().encode(text).length;
 const raw=parts.map((text,index)=>({sequence:review.sequence*10000+index,frameSequence:review.sequence,phase:AUDIT_PHASE,index,partCount:parts.length,text,sha256,byteCount,hashContract:'SOURCE_UTF8_SHA256_V1'}));
 const receipt={contract:review.contract,recoveryKind:review.recoveryKind,sequence:review.sequence,asOf:review.asOf,appliedAt:now,reviewHash:review.reviewHash,providerCalls:0,originalHeadHash:review.originalHeadHash,originalFailure:clone(head.lastError),originalAttemptHash:review.originalAttemptHash,preparedGraphHash:review.preparedGraphHash,audit:{phase:AUDIT_PHASE,sha256,partCount:parts.length,firstSequence:raw[0].sequence}};
 const after=clone(head);after.status='PAUSED';after.revision++;after.updatedAt=now;after.lastError=null;after.attempt=null;after.execution={...after.execution,phase:'PAUSED'};after.recoveries=[...(head.recoveries??[]),receipt];
 return {after,receipt,rows:{raw}};
}
