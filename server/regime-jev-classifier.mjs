import {callJevQuestions} from './jev-question-provider.mjs';
import {hashInputPackage as hash} from '../dist/domain/workspace.mjs';
import {JEV_QUESTION_CONTRACT} from '../dist/domain/jev-question.mjs';

/** The regular provider validates choices, probabilities, model and response bytes. */
export async function callRegimeJevClassifier({request,env,fetchImpl,clock}){
 const result=await callJevQuestions({state:{asOf:request.asOf,programHash:request.programHash,connectedInputs:request.inputs},questions:[{schemaVersion:1,contractVersion:JEV_QUESTION_CONTRACT,id:request.nodeId,type:'choice',instructions:request.question,candidates:request.choices??Object.entries(request.criteria).map(([id,description])=>({id,description}))}],env,fetchImpl,clock});
 return {caseId:result.rawResponse.answers[request.nodeId].choice,requestHash:hash(request),rawRequest:result.rawRequest,rawResponse:result.rawResponse,provider:result.provider};
}
