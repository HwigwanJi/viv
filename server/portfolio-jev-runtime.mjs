import {evaluateGraphQuestions} from './graph-question-runtime.mjs';
import {BLIND_PORTFOLIO_HISTORY_VERSION} from '../dist/domain/portfolio-question-evidence.mjs';
import {SIMULATION_RESPONSE_POLICY} from '../dist/domain/simulation-response-policy.mjs';

/** The simulation's existing reservation/result journal owns every real provider call. */
export async function evaluatePortfolioJevFrame({prepared,manifest,env={},fetchImpl=fetch,clock=()=>new Date().toISOString(),providerHooks}={}){
 const evaluation=prepared?.request?.state?.strategyEvaluation,graph=manifest?.data?.strategyPlan?.graph;
 const check=(ok,message)=>{if(!ok)throw Object.assign(new TypeError(message),{code:'PORTFOLIO_JEV_CONTEXT',status:409});};
 check(graph?.schemaVersion===2&&evaluation&&evaluation.executionContext?.researchProjection===BLIND_PORTFOLIO_HISTORY_VERSION,'다종목 역사 비교의 그래프와 익명 입력 정책을 확인하세요.');
 check(!graph.nodes.some(node=>node.type==='VIBE'),'다종목 비중에는 순위와 보유 비중을 JEV 질문에 연결하세요.');
 check(typeof providerHooks?.beforeCall==='function'&&typeof providerHooks?.afterCall==='function','실험의 호출 예약과 원응답 저장을 연결하세요.');
 const result=await evaluateGraphQuestions({request:prepared.request,manifest,env,fetchImpl,clock,providerHooks,simulationResponsePolicy:SIMULATION_RESPONSE_POLICY});
 check(result.providerStages.every(stage=>stage.type==='JEV_QUESTION'&&stage.rawRequest.state.contractVersion===BLIND_PORTFOLIO_HISTORY_VERSION),'실제 JEV에 전달한 익명 입력과 저장 영수증을 대조하세요.');
 return result;
}
