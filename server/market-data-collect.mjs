import {loadPublicMarket,validatePublicMarketSnapshot} from './market-providers.mjs';
import {OKX_MARKET_ORIGIN} from './okx-market.mjs';

export const CANONICAL_COLLECTION_VERSION='owner-btc-explicit-collection-v1';
export const CANONICAL_COLLECTION_SETTLE_MS=300000;
export const CANONICAL_COLLECTION_COOLDOWN_MS=60000;
const BTC='crypto:okx:BTC-USDT',FOUR=14400000,clone=structuredClone;
const iso=value=>new Date(value).toISOString();
const timestamp=value=>typeof value==='string'&&Number.isFinite(Date.parse(value))&&iso(Date.parse(value))===value;
export class CanonicalCollectionError extends Error {
  constructor(code,message,status=400,collection=null){super(message);this.name='CanonicalCollectionError';this.code=code;this.status=status;if(collection)this.collection=collection;}
}
const check=(value,code,message)=>{if(!value)throw new CanonicalCollectionError(code,message);};
function at(value){const result=typeof value==='function'?value():value??new Date().toISOString();check(timestamp(result),'INVALID_MARKET_TIME','자료 수집의 실제 서버 시각을 확인하세요.');return result;}
function metadata(capture){
  const m=capture.marketData.manifest;
  return {sourceSnapshotId:capture.id,sourceSnapshotSha256:capture.sha256,datasetSha256:m.datasetSha256,latestClosedAsOf:m.latestClosedAsOf,receivedAt:m.receivedAt,availableAt:m.availableAt,candleCount:m.candleCount,dailyCandleCount:m.dailyCandleCount};
}
function captures(workspace,now,{fresh=true}={}){
  return (workspace.marketSnapshots??[]).filter(c=>c?.provider==='okx'&&c.instId==='BTC-USDT'&&c.marketData).filter(c=>{
    const {marketData,...sourceSnapshot}=c;
    return timestamp(c.receivedAt)&&c.receivedAt<=now&&timestamp(c.availableAt)&&c.availableAt<=now&&validatePublicMarketSnapshot({...marketData,sourceSnapshot},{...(fresh?{now,maxSnapshotAgeMs:FOUR}:{}),requirePublic:true}).ok;
  }).sort((a,b)=>b.receivedAt.localeCompare(a.receivedAt)||b.id.localeCompare(a.id));
}
function retryAt(value,failedAt){
  if(typeof value!=='string')return null;
  if(/^\d{1,10}$/.test(value)){const next=Date.parse(failedAt)+Number(value)*1000;return Number.isFinite(next)&&next<8640000000000000?next:null;}
  if(/^[A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(value)&&Number.isFinite(Date.parse(value)))return Date.parse(value);
  return null;
}
/** Only bounded public request metadata enters the persisted failure receipt. */
export function canonicalCollectionFailure(error,{now}={}){
  const failedAt=at(now),diagnostic=error?.diagnostic??{},retryAfter=retryAt(diagnostic.retryAfter,failedAt)===null?null:diagnostic.retryAfter;
  const nextAllowedAt=iso(Math.max(Date.parse(failedAt)+CANONICAL_COLLECTION_COOLDOWN_MS,retryAt(retryAfter,failedAt)??0));
  return {code:typeof error?.code==='string'&&/^[A-Z][A-Z0-9_]{1,95}$/.test(error.code)?error.code:'MARKET_COLLECTION_FAILED',httpStatus:Number.isInteger(diagnostic.httpStatus)&&diagnostic.httpStatus>=100&&diagnostic.httpStatus<=599?diagnostic.httpStatus:null,retryAfter,failedAt,nextAllowedAt};
}
function lastFailure(workspace,now){
  const events=(workspace.activityEvents??[]).filter(e=>e.eventType==='MARKET_CAPTURE_COLLECTION_FAILED'&&e.payload?.provider==='okx'&&e.payload.instrumentId===BTC&&timestamp(e.payload.failedAt)&&e.payload.failedAt<=now).sort((a,b)=>b.payload.failedAt.localeCompare(a.payload.failedAt));
  const p=events[0]?.payload;if(!p)return null;
  const safe=canonicalCollectionFailure({code:p.code,diagnostic:{httpStatus:p.httpStatus,retryAfter:p.retryAfter}},{now:p.failedAt});
  return safe;
}
/** Read-only owner-workspace status. Source times keep their original values. */
export function buildCanonicalBtcCollectionStatus(workspace,{now}={}){
  check(workspace&&typeof workspace==='object','WORKSPACE_REQUIRED','로그인한 사용자의 자료 저장소를 확인하세요.');
  const readAt=at(now),time=Date.parse(readAt),boundary=Math.floor(time/FOUR)*FOUR,requiredClosedAsOf=iso(boundary),settledAt=iso(boundary+CANONICAL_COLLECTION_SETTLE_MS),nextClosedAsOf=iso(boundary+FOUR);
  const valid=captures(workspace,readAt),current=valid.find(c=>c.marketData.manifest.latestClosedAsOf===requiredClosedAsOf),latest=current??captures(workspace,readAt,{fresh:false})[0]??null,failure=lastFailure(workspace,readAt);
  const lastError=failure&&(!latest||failure.failedAt>latest.receivedAt)?failure:null,cooldownAt=lastError?Date.parse(lastError.nextAllowedAt):0;
  const status=current?'READY':time<boundary+CANONICAL_COLLECTION_SETTLE_MS?'WAITING_SETTLEMENT':cooldownAt>time?'COOLDOWN':'COLLECTION_REQUIRED';
  const nextAllowedAt=iso(current?boundary+FOUR+CANONICAL_COLLECTION_SETTLE_MS:Math.max(boundary+CANONICAL_COLLECTION_SETTLE_MS,cooldownAt));
  return {schemaVersion:1,version:CANONICAL_COLLECTION_VERSION,provider:'okx',origin:OKX_MARKET_ORIGIN,instrumentId:BTC,timeframe:'4h',status,canCollect:status==='COLLECTION_REQUIRED',requiredClosedAsOf,settledAt,nextClosedAsOf,nextAllowedAt,latest:latest?metadata(latest):null,lastError,readAt};
}
/** The caller owns authentication, claim, CAS and the atomic immutable commit. */
export async function collectOwnerCanonicalBtc({workspace,now,clock,fetchImpl,env}={}){
  const initial=at(now??clock),wallStart=Date.now(),start=Date.parse(initial),readNow=()=>{
    const value=clock?at(clock):iso(start+Date.now()-wallStart);
    check(Date.parse(value)>=start,'MARKET_CLOCK_REWIND','자료 수집의 실제 서버 시각 순서를 확인하세요.');return value;
  };
  const collection=buildCanonicalBtcCollectionStatus(workspace,{now:initial});
  if(collection.status==='READY'){
    const snapshot=clone(captures(workspace,initial).find(c=>c.id===collection.latest.sourceSnapshotId)),{marketData,...sourceSnapshot}=snapshot;
    return {snapshot,market:{...marketData,sourceSnapshot},metadata:metadata(snapshot),reused:true,collection};
  }
  if(!collection.canCollect)throw new CanonicalCollectionError(collection.status==='COOLDOWN'?'MARKET_CAPTURE_COOLDOWN':'MARKET_CAPTURE_SETTLING',collection.status==='COOLDOWN'?'다음 수집 가능 시각에 다시 요청하세요.':'확정 봉 수집 대기 시각 이후에 요청하세요.',collection.status==='COOLDOWN'?429:409,collection);
  const market=await loadPublicMarket({provider:'okx',now:readNow,fetchImpl});
  const completedAt=readNow(),verified=validatePublicMarketSnapshot(market,{now:completedAt,requirePublic:true});
  check(verified.ok,'MARKET_INTEGRITY','수집한 공개 원문·시점·해시를 대조하세요.');
  check(market.manifest.latestClosedAsOf===collection.requiredClosedAsOf&&market.manifest.latestClosedAsOf===iso(Math.floor(Date.parse(completedAt)/FOUR)*FOUR),'CANONICAL_CAPTURE_BOUNDARY','현재의 최신 확정 봉으로 자료를 수집하세요.');
  const snapshot={...clone(market.sourceSnapshot),marketData:{dataset:clone(market.dataset),manifest:clone(market.manifest)}};
  const next={...workspace,marketSnapshots:[...(workspace.marketSnapshots??[]).filter(c=>c.id!==snapshot.id),snapshot]};
  return {snapshot,market,metadata:metadata(snapshot),reused:false,collection:buildCanonicalBtcCollectionStatus(next,{now:completedAt})};
}
