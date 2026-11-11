import {prepareSessionEvaluation} from '../dist/domain/session-strategy.mjs';
import {executeSessionPlan} from '../dist/domain/session-rule.mjs';
import {applySessionCorporateActions,dailySessionEvents} from '../dist/domain/session-simulation.mjs';
import {evaluateGraphQuestions} from './graph-question-runtime.mjs';

export async function runSessionQuestionFrame({graph,account,bar,feeBps=10,slippageBps=5,path='HIGH_FIRST',sourceHash,signalHistory,marketHistory,decisionMemory=[],env,fetchImpl,clock,providerHooks}){
 const adjusted=applySessionCorporateActions(account,bar),prepared=prepareSessionEvaluation({graph,account:adjusted,date:bar.date,decisionAt:bar.date+'T08:00:00.000Z',feeBps,slippageBps,sourceHash,signalHistory,marketHistory,decisionMemory});
 const result=await evaluateGraphQuestions({request:{state:{strategyEvaluation:prepared}},manifest:{data:{strategyPlan:{graph}}},env,fetchImpl,clock,providerHooks});
 const evaluation=result.evaluation.graphEvaluation;
 if(!evaluation.output.ready||!evaluation.output.orderAllowed)throw Object.assign(new Error('AI 세션 주문 계획의 입력과 선택 경로를 확인하세요.'),{code:'SESSION_AI_BLOCKED',evaluation});
 return {evaluation,provider:result.provider,providerStages:result.providerStages,jevCallCount:result.jevCallCount,...executeSessionPlan(adjusted,evaluation.output.value,dailySessionEvents(bar,path),{slippageBps,limitFillPolicy:'LIMIT'})};
}
