import {adaptivePortfolioInputs,portfolioSourceSpec} from '../dist/domain/adaptive-portfolio-graph.mjs';
import {hashInputPackage} from '../dist/domain/workspace.mjs';
import {evaluateGraphQuestions} from './graph-question-runtime.mjs';

const check=(ok,code,message)=>{if(!ok)throw Object.assign(new Error(message),{code,status:409});};
/** Replay retained stages against the original snapshot; never resend an uncertain paid call. */
export async function resolvePortfolioQuestions({graph,args,boundary,state,save,guard,env,fetchImpl,clock}){
 const graphHash=hashInputPackage(graph),validUntil=new Date(Date.parse(boundary)+portfolioSourceSpec(graph).stepMs).toISOString();
 const fresh=()=>check(clock()<validUntil,'PORTFOLIO_FRAME_STALE','다음 확정봉 시점에는 새 자료로 판단합니다.');
 let attempt=state.portfolioQuestionAttempt;
 check(!attempt?.pending,'PORTFOLIO_JEV_OUTCOME_UNKNOWN','이전 유료 질문의 응답 확인이 필요합니다. 같은 요청을 다시 전송하지 않습니다.');
 await guard({calling:false});fresh();
 if(attempt?.graphHash!==graphHash||attempt?.boundary!==boundary){
  const {inputs,context}=adaptivePortfolioInputs(graph,args);
  attempt={graphHash,boundary,validUntil,stages:[],pending:null,preparation:{asOf:args.asOf,source:{datasetSha256:hashInputPackage(inputs)},modules:[],executionInputs:inputs,executionContext:context,trigger:'market_event'}};
  state.portfolioQuestionAttempt=attempt;await save('PORTFOLIO_QUESTION_PREPARED',{graphHash,boundary,validUntil,inputHash:attempt.preparation.source.datasetSha256});
 }
 check(!attempt.failure,'PORTFOLIO_JEV_RESPONSE_REJECTED','이 확정봉의 질문 응답을 사용할 수 없습니다. 저장된 실패 원문을 확인하세요.');
 const request={state:{strategyEvaluation:structuredClone(attempt.preparation)}};
 const hooks={
  async reuseResult(stage){
   const retained=attempt.stages.find(s=>s.nodeId===stage.nodeId);
   if(!retained)return null;
   check(retained.rawRequestHash===stage.rawRequestHash&&hashInputPackage(retained.rawRequest)===stage.rawRequestHash&&hashInputPackage(retained.rawResponse)===retained.rawResponseHash,'PORTFOLIO_JEV_RECEIPT','저장된 질문·응답 원문과 현재 재생 입력을 대조하세요.');
   return structuredClone(retained);
  },
  async beforeCall(stage){
   await guard({calling:true});fresh();
   check(!attempt.pending,'PORTFOLIO_JEV_OUTCOME_UNKNOWN','중복 유료 호출을 차단합니다.');
   const callId='portfolio-jev-'+crypto.randomUUID();
   attempt.pending={callId,nodeId:stage.nodeId,requestHash:stage.rawRequestHash,startedAt:clock()};
   try{await save('JEV_STARTED',{...attempt.pending,snapshotAsOf:attempt.preparation.asOf,stage},{eventId:callId});}
   catch(error){attempt.pending=null;throw error;}
  },
  async afterCall(stage){
   check(attempt.pending?.requestHash===stage.rawRequestHash,'PORTFOLIO_JEV_RECEIPT','예약한 요청과 받은 응답을 대조하세요.');
   const pending=attempt.pending,retained=structuredClone(stage);
   attempt.stages.push(retained);attempt.pending=null;
   try{await save('JEV_RESULT',{callId:pending.callId,snapshotAsOf:attempt.preparation.asOf,stage},{eventId:pending.callId+'-result'});}
   catch(error){attempt.pending=pending;attempt.stages.pop();throw error;}
   await guard({calling:false});fresh();
  }
 };
 let result;
 try{result=await evaluateGraphQuestions({request,manifest:{data:{strategyPlan:{graph}}},env,fetchImpl,clock,providerHooks:hooks});}
 catch(error){
  if(attempt.pending){
   const failure={callId:attempt.pending.callId,code:error.code??'PORTFOLIO_JEV_FAILURE',responseAvailability:error.responseAvailability??'UNKNOWN',provider:error.provider??null,rawRequest:error.rawRequest??null,rawResponse:error.rawResponse??null,rawResponseText:error.rawResponseText??null,rawRequestHash:error.rawRequestHash??null,rawResponseHash:error.rawResponseHash??null,automaticRetries:0};
   // A complete rejected response ends this snapshot; uncertain outcomes retain the pending call.
   if(error.responseAvailability==='RETAINED'){attempt.failure=failure;attempt.pending=null;}
   else if(['JEV_CONNECTION_REQUIRED','JEV_QUESTION_SECRET_IN_INPUT'].includes(error.code))attempt.pending=null;
   await save('JEV_FAILURE',failure,{eventId:failure.callId+'-failure'});
  }
  throw error;
 }
 await guard({calling:false});fresh();
 return result.evaluation.graphEvaluation;
}
