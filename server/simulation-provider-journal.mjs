import {hashInputPackage} from '../dist/domain/workspace.mjs';
const clone=structuredClone;
const check=(ok,code,message)=>{if(!ok)throw Object.assign(new Error(message),{code,status:409});};
const usage=(current,next)=>{const result=clone(current??{});for(const [key,value]of Object.entries(next??{}))if(Number.isFinite(value)&&value>=0)result[key]=(result[key]??0)+value;return Object.keys(result).length?result:null;};
export function simulationProviderJournal({store,owner,token,frame,clock,env,rawRows,getHead,setHead,manualRetryStageIndex=null,reserveProvider=fn=>fn(),projectEvaluation=clone}){
 const encode=(stage,result)=>{const manualRetry=stage.index===manualRetryStageIndex,rows=rawRows(frame.sequence,{stage,recordedAt:clock()},env);check(rows.length<300,'SIMULATION_STAGE_SIZE','질문별 요청·응답의 저장 범위를 줄이세요.');return rows.map((row,index)=>({...row,sequence:frame.sequence*10000+(manualRetry?8400:3000+stage.index*600)+(result?300:0)+index,phase:result?'PROVIDER_STAGE_RESULT':'PROVIDER_STAGE_REQUEST',stageIndex:stage.index,nodeId:stage.nodeId,...(manualRetry?{manualRetryAttempt:1}:{})}));};
 return {
  async beforeCall(stage){
   const head=getHead();check(Number.isSafeInteger(stage.index)&&stage.index>=0&&stage.index<9&&stage.index===(head.attempt.stageCount??0)&&head.attempt.status==='COMPUTING','SIMULATION_STAGE_ORDER','질문별 실행 순서와 이전 응답의 저장을 확인하세요.');
   check(head.jevBudget.reserved<head.jevBudget.maximum,'SIMULATION_BUDGET_EXHAUSTED','승인한 유료 호출 예산을 모두 사용했습니다.');
   check(stage.rawRequestHash===hashInputPackage(stage.rawRequest),'SIMULATION_STAGE_HASH','질문 원요청의 해시를 확인하세요.');
   const after=clone(head);after.revision++;after.updatedAt=clock();after.jevBudget.reserved++;after.attempt={...after.attempt,status:'JEV_STARTED',stage:{index:stage.index,nodeId:stage.nodeId,type:stage.type,requestHash:stage.rawRequestHash},requestHash:stage.rawRequestHash};after.execution={...after.execution,phase:'JEV_STARTED',evaluation:projectEvaluation(stage.graphEvaluation)};
   await reserveProvider(()=>store.commit(owner,head,after,{token,now:after.updatedAt,rows:{raw:encode(stage,false)}}));setHead(after);
  },
  async afterCall(stage){
   const head=getHead();check(head.attempt.status==='JEV_STARTED'&&head.attempt.stage?.index===stage.index&&head.attempt.stage?.nodeId===stage.nodeId&&head.attempt.stage?.requestHash===stage.rawRequestHash&&stage.rawResponseHash===hashInputPackage(stage.rawResponse),'SIMULATION_STAGE_HASH','예약된 질문과 수신한 응답을 대조하세요.');
   // A user may pause while the network is in flight. Retain received evidence
   // before checking the current execution lease; no further call or fill follows.
   await store.retainProviderStage(owner,head.id,encode(stage,true));
   const after=clone(head);after.revision++;after.updatedAt=clock();after.jevBudget.completed++;after.actualUsage=usage(head.actualUsage,stage.provider?.usage);after.attempt={...after.attempt,status:'COMPUTING',stageCount:stage.index+1,stage:{...after.attempt.stage,responseHash:stage.rawResponseHash,completedAt:after.updatedAt}};after.execution={...after.execution,phase:'COMPUTING'};
   await store.commit(owner,head,after,{token,now:after.updatedAt});setHead(after);
  }
 };
}
