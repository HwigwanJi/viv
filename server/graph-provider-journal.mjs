import {hashInputPackage,validateWorkspace} from '../dist/domain/workspace.mjs';
import {RepositoryError,readOperationalWorkspace} from './repository.mjs';
import {assertClaim,renewClaim} from './claims.mjs';

export const GRAPH_PROVIDER_JOURNAL_VERSION='graph-provider-journal-v1';
export const GRAPH_PROVIDER_LIMITS=Object.freeze({maxPerDecision:9,maxPerUtcDay:54});
const clone=structuredClone,check=(v,c,m)=>{if(!v)throw new RepositoryError(c,m,409);};
const bytes=v=>new TextEncoder().encode(JSON.stringify(v)).length;
const reservedType='MIND_PROVIDER_STAGE_RESERVED',answeredType='MIND_PROVIDER_STAGE_ANSWERED';
export function graphProviderCallUsage(workspace,{profileId,utcDay}={}){
 const reserved=(workspace.activityEvents??[]).filter(e=>e.eventType===reservedType&&e.payload?.profileId===profileId&&e.occurredAt.slice(0,10)===utcDay),keys=new Set(reserved.map(e=>e.id)),answered=(workspace.activityEvents??[]).filter(e=>e.eventType===answeredType&&keys.has(e.payload?.reservationId));
 return {reserved:reserved.length,completed:new Set(answered.map(e=>e.payload.reservationId)).size,unknown:reserved.length-new Set(answered.map(e=>e.payload.reservationId)).size};
}
export function graphProviderBarCallUsage(workspace,{profileId,barCloseAt}={}){
 const attempts=(workspace.mindSubscriptions??[]).filter(s=>s.profileId===profileId).flatMap(s=>s.attempts??[]),reserved=(workspace.activityEvents??[]).filter(e=>{
  if(e.eventType!==reservedType||e.payload?.profileId!==profileId)return false;
  const mapped=e.payload.barCloseAt??attempts.find(a=>e.payload.executionKey===a.key||e.payload.executionKey?.startsWith(a.key+':'))?.barCloseAt;
  return mapped===barCloseAt;
 }),legacy=attempts.filter(a=>a.barCloseAt===barCloseAt&&a.requiresJev!==false&&a.providerJournalVersion===undefined).length;
 return {reserved:reserved.length+legacy,journalReserved:reserved.length,legacyReserved:legacy};
}

/** Reservation precedes transmission; replies are retained even after pause or a concurrent edit. */
export function createGraphProviderJournal({repository,ownerId,profileId,manifestHash,executionKey,barCloseAt,resourceId,token,workspace,clock=()=>new Date().toISOString(),onPersist=()=>{},beforeReserve=()=>{},afterResponse=()=>{},assertReady=()=>{},env={}}){
 if(barCloseAt!==undefined)check(typeof barCloseAt==='string'&&Number.isFinite(Date.parse(barCloseAt))&&new Date(barCloseAt).toISOString()===barCloseAt&&Date.parse(barCloseAt)%14400000===0,'GRAPH_PROVIDER_BAR','질문 호출 예산에 사용할 확정 4시간봉을 확인하세요.');
 let revision=workspace.revision,index=0;
 const time=()=>new Date(clock()).toISOString(),fence=()=>({ownerId,resourceId,token,nowMs:Date.parse(time())});
 const eventId=(kind,stage)=>'event-graph-'+kind+'-'+hashInputPackage({ownerId,profileId,executionKey,index:stage.index});
 const event=(kind,stage,at,extra={})=>({id:eventId(kind,stage),eventType:kind==='request'?reservedType:answeredType,resourceType:'mind-provider-stage',resourceId:profileId,occurredAt:at,actorId:ownerId,payload:{journalVersion:GRAPH_PROVIDER_JOURNAL_VERSION,executionKey,profileId,manifestHash,...(barCloseAt?{barCloseAt}:{}),...extra,stage:clone(stage)}});
 const secrets=Object.entries(env).filter(([k,v])=>/(?:API_KEY|SECRET|TOKEN|VAULT_KEY)$/.test(k)&&typeof v==='string'&&v.length>=8).map(([,v])=>v);
 const safe=e=>{const text=JSON.stringify(e);check(!secrets.some(v=>text.includes(v)),'PROVIDER_JOURNAL_SECRET','공급자 원문에서 연결 인증정보 노출을 확인했습니다.');check(bytes(e)<=490000,'PROVIDER_JOURNAL_SIZE','질문 원문과 응답의 저장 한도를 확인하세요.');};
 async function commit(base,next,key,{fenced=true}={}){
  next.revision=base.revision+1;next.updatedAt=time();const errors=validateWorkspace(next);check(!errors.length,errors[0]?.code,errors[0]?.message);
  await repository.commit(ownerId,base,next,key,fenced?fence():undefined);revision=next.revision;onPersist(next);
 }
 return {
  async beforeCall(stage){
   check(stage.index===index&&index<GRAPH_PROVIDER_LIMITS.maxPerDecision&&hashInputPackage(stage.rawRequest)===stage.rawRequestHash,'GRAPH_PROVIDER_RESERVATION','단계 순서와 전송할 질문 원문을 확인하세요.');
   const current=await readOperationalWorkspace(repository,ownerId);check(current.revision===revision,'REVISION_CONFLICT','실행 중 마인드 구성이 변경되었습니다. 현재 기록을 확인하세요.');await assertClaim(repository.db,fence());await assertReady(current,stage);
   check(current.investmentProfiles.find(p=>p.id===profileId)?.status!=='ARCHIVED','MIND_ARCHIVED','보관한 마인드의 새 질문 실행을 중지합니다.');
   check(!current.activityEvents.some(e=>e.id===eventId('request',stage)),'GRAPH_PROVIDER_STAGE_ALREADY_RESERVED','이미 전송 예약한 질문의 저장 응답을 확인하세요.');
   const usage=graphProviderCallUsage(current,{profileId,utcDay:time().slice(0,10)}),legacy=(current.mindSubscriptions??[]).filter(s=>s.profileId===profileId).flatMap(s=>s.attempts).filter(a=>a.utcDay===time().slice(0,10)&&a.requiresJev!==false&&a.providerJournalVersion===undefined).length;
   check(usage.reserved+legacy<GRAPH_PROVIDER_LIMITS.maxPerUtcDay,'GRAPH_PROVIDER_DAILY_BUDGET','오늘의 질문 호출 한도에 도달했습니다. 다음 UTC 날짜에 운용을 재개하세요.');
   if(barCloseAt)check(graphProviderBarCallUsage(current,{profileId,barCloseAt}).reserved<GRAPH_PROVIDER_LIMITS.maxPerDecision,'GRAPH_PROVIDER_BAR_BUDGET','이번 확정 봉의 운용·실험 질문 호출 한도에 도달했습니다.');
   const next=clone(current),at=time(),receipt=event('request',stage,at);safe(receipt);check(bytes(receipt)+270000<=490000,'PROVIDER_JOURNAL_SIZE','질문의 입력 범위를 줄여 응답을 저장할 공간을 확보하세요.');
   next.activityEvents.push(receipt);await beforeReserve(next,stage,receipt);await renewClaim(repository.db,{...fence(),leaseMs:120000});await commit(current,next,receipt.id);
  },
  async afterCall(stage){
   const current=await readOperationalWorkspace(repository,ownerId),changed=current.revision!==revision,reservation=current.activityEvents.find(e=>e.id===eventId('request',stage));
   check(reservation&&reservation.payload.executionKey===executionKey&&reservation.payload.stage.rawRequestHash===stage.rawRequestHash&&hashInputPackage(stage.rawRequest)===stage.rawRequestHash&&hashInputPackage(stage.rawResponse)===stage.rawResponseHash,'GRAPH_PROVIDER_RECEIPT','예약한 질문과 실제 원응답을 대조하세요.');
   const receipt=event('response',stage,time(),{reservationId:reservation.id});safe(receipt);check(!current.activityEvents.some(e=>e.id===receipt.id),'GRAPH_PROVIDER_RECEIPT_EXISTS','이미 저장한 질문 응답을 확인하세요.');
   const next=clone(current);next.activityEvents.push(receipt);await afterResponse(next,stage,receipt);await commit(current,next,receipt.id,{fenced:false});index++;
   check(!changed,'REVISION_CONFLICT','실행 중 구성이 변경되어 원응답을 저장하고 다음 질문 실행을 중지했습니다.');await assertClaim(repository.db,fence());await assertReady(next,stage);await renewClaim(repository.db,{...fence(),leaseMs:120000});
  },
  async onFailure(error){
   const pointer=error.graphStage;if(!pointer?.callStarted)return;
   const current=await readOperationalWorkspace(repository,ownerId),reservation=current.activityEvents.find(e=>e.id===eventId('request',pointer));if(!reservation||current.activityEvents.some(e=>e.id===eventId('response',pointer)||e.id===eventId('failure',pointer)))return;
   const stage={...clone(reservation.payload.stage),errorCode:typeof error.code==='string'?error.code:'JEV_PROVIDER_FAILED',responseAvailability:error.responseAvailability??(error.rawResponse!==undefined||error.rawResponseText!==undefined?'RETAINED':'NOT_RECEIVED')};
   for(const k of ['rawResponse','rawResponseText','provider'])if(error[k]!==undefined)stage[k]=clone(error[k]);
   if(stage.rawResponse!==undefined)stage.rawResponseHash=hashInputPackage(stage.rawResponse);
   const receipt=event('failure',stage,time(),{reservationId:reservation.id});receipt.eventType='MIND_PROVIDER_STAGE_FAILED';safe(receipt);const next=clone(current);next.activityEvents.push(receipt);await commit(current,next,receipt.id,{fenced:false});
  }
 };
}
