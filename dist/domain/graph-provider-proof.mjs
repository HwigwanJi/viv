import {hashInputPackage} from './workspace.mjs';
import {evaluateStrategyGraph} from './strategy-graph.mjs';
import {graphQuestionInput,graphQuestionProviderRequest,GRAPH_PROVIDER_STAGES_VERSION} from './graph-question-evidence.mjs';
import {inspectJevQuestionResponse} from './jev-question.mjs';

const clone=structuredClone,same=(a,b)=>hashInputPackage(a??null)===hashInputPackage(b??null);
const check=(ok,message)=>{if(!ok)throw Object.assign(new Error(message),{code:'GRAPH_DECISION_PROOF',status:409});};
/** Replay each newly reachable provider stage using only its preceding answers. */
export function assertGraphProviderStages(run,{graph,prepared,evaluation}){
 const stages=run.providerStages??run.rawResponse?.stages??[],decisions=clone(prepared.decisionInputs??{});
 check(Object.keys(decisions).length===0,'새 실행의 준비 입력과 응답 영수증을 분리하세요.');
 check(Array.isArray(stages)&&stages.length<=9,'질문별 실행 영수증을 확인하세요.');
 check(stages.length?run.rawResponse?.contractVersion===GRAPH_PROVIDER_STAGES_VERSION&&same(stages,run.rawResponse.stages):run.rawResponse===null,'실행 영수증과 응답 원본을 대조하세요.');
 const compute=()=>evaluateStrategyGraph(graph,prepared.modules,{asOf:prepared.asOf,sourceHash:prepared.source.datasetSha256,inputs:prepared.executionInputs,decisions,context:prepared.executionContext,trigger:prepared.trigger??'manual',...(evaluation.simulationResponsePolicy?{simulationResponsePolicy:evaluation.simulationResponsePolicy}:{})});
 for(const [index,stage] of stages.entries()){
  const before=compute(),node=graph.nodes.find(n=>n.id===stage.nodeId);
  check(stage.index===index&&before.requiredJevNodeIds?.[0]===stage.nodeId&&node?.type===stage.type&&same(stage.decisionInputsBefore,decisions)&&stage.preparedGraphHash===before.outputHash&&same(stage.graphEvaluation,before),'질문의 순서·분기와 준비 계산을 대조하세요.');
  check(stage.rawRequestHash===hashInputPackage(stage.rawRequest)&&stage.rawResponseHash===hashInputPackage(stage.rawResponse)&&stage.provider?.model===stage.rawResponse?.model,'각 호출의 원요청·원응답·실제 모델을 대조하세요.');
  if(node.type==='JEV_QUESTION'){
   const input=graphQuestionInput(graph,before,prepared.executionInputs,node.id);
   check(same(stage.rawRequest,graphQuestionProviderRequest(graph,before,prepared.executionInputs,node.id)),'질문에 전달한 연결 자료의 원문을 대조하세요.');
   const inspected=inspectJevQuestionResponse(stage.rawResponse,input.questions,{requestedModel:stage.rawRequest.model});
   check(same(inspected.usage,stage.provider.usage),'질문 공급자의 사용량을 대조하세요.');
   decisions[node.id]={kind:'JEV_QUESTION',answer:clone(stage.rawResponse.answers[node.id]),questionHash:input.questionHash,inputHash:input.inputHash,rawRequestHash:stage.rawRequestHash,rawResponseHash:stage.rawResponseHash};
  }else{
   const raw=stage.rawResponse,state=stage.rawRequest.state,action=raw.answers?.action?.choice,stance=raw.answers?.stance?.choice,limits=run.rawRequest.state.riskLimits,answer=raw.answers?.[action==='sell'?'sellEvidence':'buyEvidence'],position=/^r\d+$/.test(answer?.choice)?Number(answer.choice.slice(1)):-1,evidence=state.evidenceReferences?.[position];
   check(node.type==='VIBE'&&state.manifestHash===run.rawRequest.state.manifestHash&&state.decisionAt===run.rawRequest.state.decisionAt&&['buy','hold','sell'].includes(action),'거래 질문의 원래 정책·시각·선택을 대조하세요.');
   decisions[node.id]={action,stance,targetWeight:action==='buy'?(stance==='clutch'?limits.clutchBuyWeight:limits.normalBuyWeight):action==='sell'?limits.sellWeight:prepared.executionContext.currentWeight,confidence:raw.answers.action.confidence,probabilities:clone(raw.answers.action.probabilities??null),basisRefs:action==='hold'||!evidence?[]:[evidence.id],rawRequestHash:stage.rawRequestHash,rawResponseHash:stage.rawResponseHash};
  }
 }
 const final=compute();check(!final.requiredJevNodeIds?.length&&same(decisions,evaluation.decisionInputs)&&same(final,evaluation.graphEvaluation),'질문 응답과 최종 노드 계산을 일치시키세요.');
 check(run.jevCalled===(stages.length>0)&&run.jevCallCount===stages.length,'실제 공급자 호출 횟수를 일치시키세요.');
 if(stages.length){const usage=stages.every(s=>['input_tokens','output_tokens'].every(k=>Number.isSafeInteger(s.provider.usage?.[k])))?stages.reduce((sum,s)=>({input_tokens:sum.input_tokens+s.provider.usage.input_tokens,output_tokens:sum.output_tokens+s.provider.usage.output_tokens}),{input_tokens:0,output_tokens:0}):null;check(same(usage,run.provider?.usage)&&run.provider.stageCount===stages.length,'단계별 사용량의 합계를 확인하세요.');}
 return {stageCount:stages.length,graphEvaluation:final};
}
