import {advanceRegimeProgram,classifyRegimeAxes,regimeInputs,resolveRegimeModel,regimeChoices} from '../dist/domain/regime-program.mjs';
import {hashInputPackage as hash} from '../dist/domain/workspace.mjs';
import {readRegimeProgramInputs} from './regime-program-inputs.mjs';
import {callRegimeJevClassifier} from './regime-jev-classifier.mjs';

const check=(v,code,message)=>{if(!v)throw Object.assign(new Error(message),{code,status:409});};
/** Storage callbacks must CAS the revision. One durable owner/ledger serves every child strategy. */
export async function runRegimeProgram({program,models,load,save,readInputs,readOwn,classify,beforeClassify,runStrategy,clock,env={},fetchImpl=fetch}){
 readInputs??=classifier=>readRegimeProgramInputs(classifier,{clock,env,fetchImpl});
 classify??=request=>callRegimeJevClassifier({request,env,fetchImpl,clock});
 const now=()=>new Date(clock()).toISOString();let record=await load(),state=record?.state??null;
 let classificationError=record?.providerPending||record?.providerUnknown?{code:'REGIME_PROVIDER_UNKNOWN'}:null;
 const persist=async(next,kind,evidence,resolved=false)=>{record=await save({expectedRevision:record?.revision??-1,previous:record,next:{state:next,providerPending:resolved?null:record?.providerPending??null,providerUnknown:resolved?null:record?.providerUnknown??null},kind,evidence,at:now()});state=record.state;};
 let own=await readOwn(),step=advanceRegimeProgram({program,models,state,own,now:now()});
 if(step.needsClassification&&!classificationError){
  try{
  const inputs=await readInputs(program.classifier),at=now(),selected=regimeInputs(program,inputs,at);let classification;
  if(program.classifier.kind==='FIXED')classification={caseId:'fixed',asOf:at,inputHash:hash(selected),evidence:{kind:'SAVED_PRESET'}};
  else if(program.classifier.kind==='AXES')classification=classifyRegimeAxes(program,selected,at);
  else{
   await beforeClassify?.();
   const request={programHash:program.contentHash,nodeId:program.classifier.nodeId,asOf:at,question:program.classifier.question,criteria:program.classifier.criteria,choices:regimeChoices(program),inputs:selected},requestHash=hash(request);
   record=await save({expectedRevision:record?.revision??-1,previous:record,next:{state,providerPending:{requestHash,request,at},providerUnknown:null},kind:'REGIME_PROVIDER_RESERVED',evidence:{request},at});
   let response;try{response=await classify(request);check(regimeChoices(program).some(v=>v.id===response.caseId)&&response.requestHash===requestHash&&response.rawResponse!==undefined,'REGIME_PROVIDER_BINDING','국면 질문과 실제 응답 원문을 대조하세요.');}
   catch(error){record=await save({expectedRevision:record.revision,previous:record,next:{state,providerPending:null,providerUnknown:{requestHash,at:now(),code:error.code??'PROVIDER_FAILED'}},kind:'REGIME_PROVIDER_UNKNOWN',evidence:{requestHash},at:now()});throw error;}
   classification={caseId:response.caseId,asOf:now(),inputHash:hash(selected),evidence:{requestHash,rawResponse:response.rawResponse,provider:response.provider??null}};
  }
  own=await readOwn();step=advanceRegimeProgram({program,models,state,classification,own,now:now()});await persist(step.state,'REGIME_CLASSIFIED',classification,true);
  }catch(error){if(['REVISION_CONFLICT','REGIME_STATE_CONFLICT'].includes(error.code))throw error;classificationError={code:error.code??'REGIME_CLASSIFIER_FAILED'};record=await load();state=record?.state??state;step=advanceRegimeProgram({program,models,state,own:await readOwn(),now:now()});}
 }else if(hash(state?{...state,updatedAt:null}:null)!==hash({...step.state,updatedAt:null}))await persist(step.state,'REGIME_TRANSITION',{selectionHash:step.selectionHash});
 if(classificationError)step.allowEntry=false;
 if(!step.activeModel)return {classificationError,phase:step.state.phase,selectionHash:step.selectionHash,executed:false};
 const model=resolveRegimeModel(program,step.state.active.caseId,models),selection={programHash:program.contentHash,selectionHash:step.selectionHash,epoch:step.state.epoch,caseId:step.state.active.caseId,modelHash:model.contentHash,allowEntry:step.allowEntry};
 // The adapter rechecks this lease immediately before committing a child decision.
 const assertSelection=async(action,orderContext={})=>{const current=await load(),owned=await readOwn(orderContext),fresh=advanceRegimeProgram({program,models,state:current.state,own:owned,now:now()});check(fresh.selectionHash===selection.selectionHash&&(action!=='buy'||!classificationError&&!current.providerPending&&!current.providerUnknown&&fresh.allowEntry),'REGIME_SELECTION_CHANGED','주문 전에 현재 국면·전략·보유 책임을 다시 확인하세요.');};
 const result=await runStrategy({model,selection,assertSelection});return {classificationError,phase:step.state.phase,selection,result,executed:true};
}
