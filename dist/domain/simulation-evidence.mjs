import {hashInputPackage} from './workspace.mjs';
import {runSessionSimulationFrame,applySessionCorporateActions,dailySessionEvents} from './session-simulation.mjs';
import {executeSessionPlan} from './session-rule.mjs';
import {strategyGraphHash,evaluateStrategyGraph} from './strategy-graph.mjs';
import {graphQuestionInput,graphQuestionProviderRequest} from './graph-question-evidence.mjs';
const clone=structuredClone;
export const CANONICAL_SIMULATION_EVIDENCE_VERSION='canonical-simulation-evidence-v1';

/** Full execution inputs are stored once; both exact evaluations remain reconstructable. */
export function canonicalSimulationEvidence(output,prepared){
 const initial=prepared?.strategyEvaluation,final=output.strategyEvaluation;
 if(initial?.graphEvaluation?.contractVersion==='mind-strategy-decision-evaluation-v2'&&output.evaluationStatus==='WARMUP_HOLD')return {rawRequest:null,rawResponse:null,provider:null,strategyEvaluation:clone(initial),executionEvidenceMeaning:'BLOCKED_GRAPH_INPUTS_NO_PROVIDER_REQUEST'};
 if(initial?.graphEvaluation?.contractVersion!=='mind-strategy-decision-evaluation-v2')return {rawRequest:output.rawRequest??null,rawResponse:output.rawResponse??null,provider:output.provider??null,strategyEvaluation:final??null};
 const staged=Array.isArray(output.providerStages),internal=output.jevCalled===false||staged;
 const record={rawRequest:clone(output.rawRequest),rawResponse:clone(output.rawResponse??null),provider:clone(output.provider??null),canonicalExecution:{contractVersion:CANONICAL_SIMULATION_EVIDENCE_VERSION,requestMeaning:staged?'INTERNAL_EXECUTION_WITH_PROVIDER_STAGES':internal?'INTERNAL_EXECUTION_ONLY':'ACTUAL_TRANSMITTED_PROVIDER_REQUEST',preparedRequestHash:prepared.requestHash,preparedEvaluationRef:internal?'rawRequest.state.strategyEvaluation':'canonicalExecution.preparedEvaluation',...(internal?{}:{preparedEvaluation:clone(initial)}),preparedEvaluationHash:hashInputPackage(initial),finalEvaluationPatch:{...(final.simulationResponsePolicy?{simulationResponsePolicy:final.simulationResponsePolicy}:{}),decisionInputs:clone(final.decisionInputs),graphEvaluation:clone(final.graphEvaluation),outputHash:final.outputHash},finalEvaluationHash:hashInputPackage(final)}};
 if(hashInputPackage(restoreSimulationStrategyEvaluation(record))!==hashInputPackage(final))throw new Error('Canonical simulation evidence must reconstruct the final evaluation exactly.');
 return record;
}
export function restoreSimulationStrategyEvaluation(record,{phase='final'}={}){
 if(record.contractVersion==='SESSION_REPLAY_PROOF_V1'){
  if(strategyGraphHash(record.graph)!==record.graphHash)throw new Error('Session replay graph mismatch.');
  let result;
  if(record.providerStages?.length){
   const graph=record.graph,asOf=record.bar.date+'T08:00:00.000Z',account=applySessionCorporateActions(record.accountBefore,record.bar),value={account,date:record.bar.date,decisionAt:asOf,feeBps:record.feeBps,...(record.signalHistory?{signalHistory:record.signalHistory}:{})},input=value=>({ready:true,asOf,availableAt:asOf,value,sourceRefs:[{id:'session-account',contentHash:hashInputPackage(value),sourceRef:'simulation-session-account'}]}),inputs=Object.fromEntries(graph.nodes.filter(n=>n.type==='INPUT').map(n=>[n.id,input(value)])),decisions={};
   for(const stage of record.providerStages)for(const source of stage.rawRequest.state.connectedInputs){
    if(!Object.hasOwn(inputs,source.nodeId)||source.asOf>asOf||source.availableAt>asOf)throw new Error('Session replay question input mismatch.');
    inputs[source.nodeId]={ready:true,asOf:source.asOf,availableAt:source.availableAt,value:clone(source.value),sourceRefs:clone(source.sourceRefs)};
   }
   const evaluate=()=>evaluateStrategyGraph(graph,[],{asOf,sourceHash:record.sourceHash,inputs,decisions,context:{executionMode:'PAPER',sessionDate:record.bar.date,sessionAccount:account},trigger:'closed_bar'});
   let evaluation=evaluate();
   for(const stage of record.providerStages){
    const request=graphQuestionProviderRequest(graph,evaluation,inputs,stage.nodeId),question=graphQuestionInput(graph,evaluation,inputs,stage.nodeId);
    if(hashInputPackage(request)!==stage.rawRequestHash||hashInputPackage(stage.rawRequest)!==stage.rawRequestHash||hashInputPackage(stage.rawResponse)!==stage.rawResponseHash)throw new Error('Session replay provider stage mismatch.');
    decisions[stage.nodeId]={kind:'JEV_QUESTION',answer:clone(stage.rawResponse.answers[stage.nodeId]),questionHash:question.questionHash,inputHash:question.inputHash,rawRequestHash:stage.rawRequestHash,rawResponseHash:stage.rawResponseHash};evaluation=evaluate();
   }
   if(!evaluation.output.ready||!evaluation.output.orderAllowed)throw new Error('Session replay order plan blocked.');
   result={evaluation,...executeSessionPlan(account,evaluation.output.value,dailySessionEvents(record.bar,record.intradayPath),{slippageBps:record.slippageBps,limitFillPolicy:'LIMIT'})};
  }else result=runSessionSimulationFrame({graph:record.graph,account:record.accountBefore,bar:record.bar,feeBps:record.feeBps,slippageBps:record.slippageBps,path:record.intradayPath,sourceHash:record.sourceHash,signalHistory:record.signalHistory});
  if(hashInputPackage(result.evaluation)!==record.evaluationHash||hashInputPackage(result.executionEvidence)!==hashInputPackage(record.executionEvidence))throw new Error('Session replay evaluation mismatch.');
  return {graphEvaluation:result.evaluation,asOf:result.evaluation.asOf};
 }
 if(!record.canonicalExecution)return clone(record.strategyEvaluation??null);
 const c=record.canonicalExecution;if(c.contractVersion!==CANONICAL_SIMULATION_EVIDENCE_VERSION||!['prepared','final'].includes(phase))throw new Error('Unknown canonical simulation evidence contract.');
 const initial=c.preparedEvaluationRef==='rawRequest.state.strategyEvaluation'?record.rawRequest?.state?.strategyEvaluation:c.preparedEvaluationRef==='canonicalExecution.preparedEvaluation'?c.preparedEvaluation:null;
 if(!initial||hashInputPackage(initial)!==c.preparedEvaluationHash)throw new Error('Canonical simulation prepared evaluation hash mismatch.');
 if(phase==='prepared')return clone(initial);
 const final={...clone(initial),...clone(c.finalEvaluationPatch)};
 if(hashInputPackage(final)!==c.finalEvaluationHash)throw new Error('Canonical simulation final evaluation hash mismatch.');return final;
}
