import {hashInputPackage} from './workspace.mjs';
import {mindDocumentHash} from './mind-manifest.mjs';
import {assertStrategyEvaluation, isMindStrategyPlanActive, MindStrategyError} from './mind-strategy-plan.mjs';
import {assertGraphProviderStages} from './graph-provider-proof.mjs';

export const hasDecisionGraph=manifest=>manifest?.data?.strategyPlan?.graph?.schemaVersion===2;
const check=(condition,message)=>{if(!condition)throw new MindStrategyError('GRAPH_DECISION_PROOF',message,409);};
const fields=['action','stance','targetWeight','strength','authority','confidence','probabilities','intent','intentContributors','positionTarget','positionFraction'];
const projection=decision=>Object.fromEntries(fields.map(key=>[key,decision?.[key]??null]));

/** Execution replays the saved graph and binds its one final action to the original provider response. */
export function assertGraphDecisionProof(run,{manifest,now}={}){
  if(!hasDecisionGraph(manifest))return null;
  const plan=manifest.data.strategyPlan;
  if(plan.status!=='APPROVED'||!plan.approval.enabled)return null;
  check(run.decisionAt===run.rawRequest?.state?.decisionAt&&isMindStrategyPlanActive(plan,run.decisionAt),'발행된 그래프와 원요청의 실행 시각을 대조하세요.');
  const state=run.rawRequest?.state,evaluation=run.strategyEvaluation;
  check(!evaluation?.simulationResponsePolicy,'시뮬레이션 응답은 실전·모의 계좌 주문에 사용할 수 없습니다.');
  check(state&&state.manifestHash===mindDocumentHash(manifest)&&run.inputHash===hashInputPackage(state),'판단 당시 정책과 입력 원본을 대조하세요.');
  assertStrategyEvaluation(evaluation,{manifest,marketAsOf:run.asOf,instrumentId:run.instrumentId,now});
  const prepared=run.preparedStrategyEvaluation??state.strategyEvaluation;
  if(state.strategyEvaluation?.contractVersion==='vibe-connected-input-projection-v1')check(state.strategyEvaluation.preparedOutputHash===prepared?.outputHash,'모델에 전달한 준비 계산의 원본 해시를 대조하세요.');
  else check(hashInputPackage(prepared)===hashInputPackage(state.strategyEvaluation),'퀀트 실행 입력과 준비 계산 원본을 일치시키세요.');
  assertStrategyEvaluation(prepared,{manifest,marketAsOf:run.asOf,instrumentId:run.instrumentId,now});
  check(prepared&&['planHash','manifestHash','asOf','accountSnapshotHash'].every(key=>prepared[key]===evaluation[key]),'입력과 최종 판단의 정책·시세·계좌를 일치시키세요.');
  for(const key of ['modules','source','executionInputs','executionContext','trigger'])check(hashInputPackage(prepared[key]??null)===hashInputPackage(evaluation[key]??null),'최종 계산에 사용한 원래 자료와 실행 조건을 대조하세요.');
  const graph=evaluation.graphEvaluation,decision=graph?.output?.decision;
  check(graph?.output?.ready===true&&decision&&hashInputPackage(projection(decision))===hashInputPackage(projection(run.decision))&&run.decision.graphOutputHash===graph.outputHash,'저장한 노드의 최종 행동·목표 비중과 주문을 일치시키세요.');
  if(decision.action!=='hold')check(graph.output.riskAllowed===true&&graph.output.orderAllowed===true,'그래프의 위험 한도와 주문 승인 결과를 확인하세요.');
  check(hashInputPackage(decision.basisRefs??[])===hashInputPackage(run.decision.evidenceRefs??[]),'계산 근거와 실행 근거를 일치시키세요.');
  const staged=plan.graph.nodes.some(n=>n.type==='JEV_QUESTION');
  if(staged)assertGraphProviderStages(run,{graph:plan.graph,prepared,evaluation});
  const votes=staged?[]:Object.values(evaluation.decisionInputs??{});
  for(const vote of votes){
    check(run.rawResponse&&vote.rawRequestHash===hashInputPackage(run.rawRequest)&&vote.rawResponseHash===hashInputPackage(run.rawResponse),'바이브 판단의 원요청·원응답을 연결하세요.');
    check(vote.action===run.rawResponse.answers?.action?.choice&&vote.confidence===run.rawResponse.answers?.action?.confidence&&vote.stance===run.rawResponse.answers?.stance?.choice,'바이브 원판단을 보존하세요.');
    const limits=state.riskLimits,expectedTarget=vote.action==='buy'?(vote.stance==='clutch'?limits.clutchBuyWeight:limits.normalBuyWeight):vote.action==='sell'?limits.sellWeight:prepared.executionContext.currentWeight;
    const answer=run.rawResponse.answers[vote.action==='sell'?'sellEvidence':'buyEvidence'],index=/^r\d+$/.test(answer?.choice)?Number(answer.choice.slice(1)):-1,evidence=state.evidenceReferences[index];
    check(vote.targetWeight===expectedTarget&&hashInputPackage(vote.probabilities)===hashInputPackage(run.rawResponse.answers.action.probabilities??null)&&hashInputPackage(vote.basisRefs)===hashInputPackage(vote.action==='hold'||!evidence?[]:[evidence.id]),'바이브 원응답의 분포·직접 근거와 정책 목표 비중을 보존하세요.');
  }
  const risk=manifest.data.strategyPlan.graph.nodes.find(node=>node.type==='RISK');
  return {decision,graphHash:graph.graphHash,outputHash:graph.outputHash,maxExposure:risk.config.maxExposure,maxOrderWeight:risk.config.maxOrderWeight};
}
