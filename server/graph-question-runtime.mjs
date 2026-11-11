import {hashInputPackage} from '../dist/domain/workspace.mjs';
import {evaluateStrategyGraph} from '../dist/domain/strategy-graph.mjs';
import {strategyEvaluationHash} from '../dist/domain/mind-strategy-plan.mjs';
import {graphQuestionInput,graphQuestionProviderRequest,GRAPH_PROVIDER_STAGES_VERSION} from '../dist/domain/graph-question-evidence.mjs';
import {callJevQuestions} from './jev-question-provider.mjs';

const clone=structuredClone;
const check=(ok,code,message)=>{if(!ok)throw Object.assign(new Error(message),{code,status:409});};
const aggregate=stages=>({contractVersion:GRAPH_PROVIDER_STAGES_VERSION,model:stages.at(-1)?.provider?.model??null,models:[...new Set(stages.map(s=>s.provider.model))],attempts:stages.length,stageCount:stages.length,usage:stages.every(s=>['input_tokens','output_tokens'].every(k=>Number.isSafeInteger(s.provider.usage?.[k])))?stages.reduce((sum,s)=>({input_tokens:sum.input_tokens+s.provider.usage.input_tokens,output_tokens:sum.output_tokens+s.provider.usage.output_tokens}),{input_tokens:0,output_tokens:0}):null});

/** Each newly reachable provider node is reserved and retained before advancing. */
export async function evaluateGraphQuestions({request,manifest,env,fetchImpl,clock,providerHooks,projectVibe,callVibe,simulationResponsePolicy=null,allowHeldDecisions=false,completedStages=[],stopAfterNodeIds=[]}){
 const graph=manifest.data.strategyPlan.graph,evaluation=clone(request.state.strategyEvaluation),decisions=clone(evaluation.decisionInputs??{}),stages=clone(completedStages);
 check(Object.entries(decisions).every(([id,a])=>allowHeldDecisions===true&&a?.kind==='JEV_QUESTION'&&a.reuse||graph.edges.some(e=>e.from.nodeId===id&&e.to.port==='choice'&&graph.nodes.some(n=>n.id===e.to.nodeId&&n.type==='SELECT'))&&stages.some(s=>s.nodeId===id&&s.rawRequest?.state?.asOf===evaluation.asOf&&s.rawRequest?.state?.graphHash===evaluation.graphEvaluation.graphHash&&hashInputPackage(s.rawResponse)===a.rawResponseHash&&hashInputPackage(s.rawResponse?.answers?.[id])===hashInputPackage(a.answer)&&s.rawRequestHash===a.rawRequestHash&&s.graphEvaluation?.trace?.find(t=>t.nodeId===id)?.inputHash===a.inputHash)),'GRAPH_PROVIDER_PREPARED_ANSWERS','새 실행의 준비 입력에 이전 질문 응답을 넣을 수 없습니다.');
 check(providerHooks&&typeof providerHooks.beforeCall==='function'&&typeof providerHooks.afterCall==='function','GRAPH_PROVIDER_JOURNAL_REQUIRED','질문별 호출 예약과 응답 저장을 연결하세요.');
 const recompute=()=>{evaluation.decisionInputs=clone(decisions);if(simulationResponsePolicy)evaluation.simulationResponsePolicy=simulationResponsePolicy;evaluation.graphEvaluation=evaluateStrategyGraph(graph,evaluation.modules,{asOf:evaluation.asOf,sourceHash:evaluation.source.datasetSha256,inputs:evaluation.executionInputs,decisions,context:evaluation.executionContext,trigger:evaluation.trigger??'manual',...(simulationResponsePolicy?{simulationResponsePolicy}:{})});evaluation.outputHash=strategyEvaluationHash(evaluation);};
 recompute();
 while(evaluation.graphEvaluation.requiredJevNodeIds?.length){
  check(stages.length<9,'GRAPH_PROVIDER_STAGE_LIMIT','질문과 거래 결정의 실행 횟수를 확인하세요.');
  const nodeId=evaluation.graphEvaluation.requiredJevNodeIds[0],node=graph.nodes.find(n=>n.id===nodeId),currentRequest=clone(request);currentRequest.state.strategyEvaluation=clone(evaluation);
  const question=node.type==='JEV_QUESTION'?graphQuestionInput(graph,evaluation.graphEvaluation,evaluation.executionInputs,nodeId):null;
  const rawRequest=question?graphQuestionProviderRequest(graph,evaluation.graphEvaluation,evaluation.executionInputs,nodeId):projectVibe(currentRequest,manifest);
  const stage={index:stages.length,nodeId,type:node.type,preparedGraphHash:evaluation.graphEvaluation.outputHash,graphEvaluation:clone(evaluation.graphEvaluation),decisionInputsBefore:clone(decisions),rawRequest,rawRequestHash:hashInputPackage(rawRequest),...(graph.edges.some(e=>e.to.port==='choice'&&graph.nodes.some(n=>n.id===e.to.nodeId&&n.type==='SELECT'))?{preparation:{asOf:evaluation.asOf,source:clone(evaluation.source),modules:clone(evaluation.modules),executionInputs:clone(evaluation.executionInputs),executionContext:clone(evaluation.executionContext),trigger:evaluation.trigger}}:{})};
  let result,callStarted=false;
  try{
   result=await providerHooks.reuseResult?.(clone(stage));
   const reused=Boolean(result);
   if(!reused){await providerHooks.beforeCall(clone(stage));callStarted=true;result=question?await callJevQuestions({...question,env,fetchImpl,clock}):await callVibe(rawRequest);}
   check(hashInputPackage(result.rawRequest)===stage.rawRequestHash,'GRAPH_PROVIDER_REQUEST_CHANGED','예약한 요청과 실제 전송 원문을 대조하세요.');
   Object.assign(stage,{rawResponse:clone(result.rawResponse),rawResponseText:result.rawResponseText??JSON.stringify(result.rawResponse),rawResponseHash:hashInputPackage(result.rawResponse),provider:clone(result.provider),...(result.rawRequestHash?{exactRequestHash:result.rawRequestHash}:{}),...(result.rawResponseHash?{exactResponseHash:result.rawResponseHash}:{})});
   if(!reused)await providerHooks.afterCall(clone(stage));
  }catch(error){if(result)for(const key of ['provider','rawRequest','rawResponse','rawResponseText','rawRequestHash','rawResponseHash','responseAvailability'])if(result[key]!==undefined&&error[key]===undefined)error[key]=clone(result[key]);error.providerStages=clone(stages);error.graphStage={index:stage.index,nodeId,type:node.type,callStarted,responseReceived:!!result};throw error;}
  stages.push(stage);
  if(question)decisions[nodeId]={kind:'JEV_QUESTION',answer:clone(result.rawResponse.answers[nodeId]),questionHash:question.questionHash,inputHash:question.inputHash,rawRequestHash:stage.rawRequestHash,rawResponseHash:stage.rawResponseHash};
  else{
   const raw=result.rawResponse,action=raw.answers.action.choice,stance=raw.answers.stance.choice,answer=raw.answers[action==='sell'?'sellEvidence':'buyEvidence'],index=/^r\d+$/.test(answer.choice)?Number(answer.choice.slice(1)):-1,evidence=result.rawRequest.state.evidenceReferences[index],limits=request.state.riskLimits;
   decisions[nodeId]={action,stance,targetWeight:action==='buy'?(stance==='clutch'?limits.clutchBuyWeight:limits.normalBuyWeight):action==='sell'?limits.sellWeight:evaluation.executionContext.currentWeight,confidence:raw.answers.action.confidence,probabilities:clone(raw.answers.action.probabilities??null),basisRefs:action==='hold'||!evidence?[]:[evidence.id],rawRequestHash:stage.rawRequestHash,rawResponseHash:stage.rawResponseHash};
  }
  recompute();
  if(stopAfterNodeIds.includes(nodeId))break;
 }
 return {evaluation,providerStages:stages,provider:stages.length?aggregate(stages):null,rawRequest:clone(request),rawResponse:stages.length?{contractVersion:GRAPH_PROVIDER_STAGES_VERSION,stages:clone(stages)}:null,jevCalled:stages.length>0,jevCallCount:stages.length};
}
