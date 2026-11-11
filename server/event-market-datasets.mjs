import {hashInputPackage} from '../dist/domain/workspace.mjs';
import {UPBIT_SCALP_MAX_CLOCK_LEAD_MS} from './upbit-scalping-market.mjs';
export const EVENT_ASSET_MODE='UPBIT_EVENT_STREAM';
const valid=new WeakSet(),clone=structuredClone;
const freeze=v=>{if(v&&typeof v==='object'&&!Object.isFrozen(v)){for(const item of Object.values(v))freeze(item);Object.freeze(v);}return v;};
const check=(ok,code,message)=>{if(!ok)throw Object.assign(new Error(message),{code,status:409});};
const iso=v=>typeof v==='string'&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString()===v;
export function hashEventDataset(body){
 if(!Array.isArray(body.events)||body.events.length<=20000)return hashInputPackage(body);
 // Preserve every event without raising the workspace document validation limit.
 const {events,...metadata}=body,chunks=[];
 for(let i=0;i<events.length;i+=20000)chunks.push(hashInputPackage(events.slice(i,i+20000)));
 return hashInputPackage({...metadata,events:{contractVersion:'event-array-chunks-v1',length:events.length,chunkSize:20000,chunks}});
}
export function assertEventDataset(data){
 if(valid.has(data))return data;
 check(data?.contractVersion==='upbit-event-dataset-v1'&&typeof data.id==='string'&&/^(KRW|BTC)-[A-Z0-9]+$/.test(data.market??'')&&data.instrumentId==='crypto:upbit:'+data.market&&['1m','3m','5m'].includes(data.timeframe)&&[data.startAt,data.endAt,data.availableAt].every(iso)&&data.startAt<data.endAt,'EVENT_DATASET_SCHEMA','호가·체결 자료의 종목과 관측 기간을 확인하세요.');
 const {sourceHash,...body}=data;check(sourceHash===hashEventDataset(body),'EVENT_DATASET_HASH','고정한 호가·체결 자료의 원문을 대조하세요.');
 check(data.feeSnapshot?.source==='UPBIT_AUTHENTICATED_ORDER_CHANCE'&&iso(data.feeSnapshot.observedAt)&&data.feeSnapshot.observedAt<=data.startAt&&/^[a-f0-9]{64}$/.test(data.feeSnapshot.sourceHash??'')&&['takerBuyRate','takerSellRate'].every(k=>typeof data.feeSnapshot[k]==='string'&&/^\d+(\.\d+)?$/.test(data.feeSnapshot[k])&&Number(data.feeSnapshot[k])<=.1),'EVENT_DATASET_FEES','비교 시작 전에 조회한 실제 계좌 수수료가 필요합니다.');
 check(Array.isArray(data.events)&&data.events.length>0&&Array.isArray(data.bars)&&Array.isArray(data.sourceRefs)&&data.sourceRefs.length>0&&data.rules?.quantityStep&&data.rules?.tickSize,'EVENT_DATASET_EVIDENCE','실측 호가·체결과 주문 규칙을 함께 선택하세요.');
 const ids=new Set();let previous='';
 for(const e of data.events){const delayedClock=e.eventTime>e.receivedAt&&Date.parse(e.eventTime)-Date.parse(e.receivedAt)<=UPBIT_SCALP_MAX_CLOCK_LEAD_MS&&iso(e.availableAt)&&e.availableAt>=e.eventTime;
  check(['TRADE','ORDER_BOOK'].includes(e.kind)&&e.market===data.market&&[e.eventTime,e.receivedAt].every(iso)&&(e.eventTime<=e.receivedAt||delayedClock)&&(!e.availableAt||iso(e.availableAt)&&e.availableAt>=e.receivedAt&&e.availableAt<=data.availableAt)&&e.receivedAt>=previous&&e.receivedAt<=data.endAt&&e.eventTime<=data.endAt&&typeof e.id==='string'&&!ids.has(e.id)&&/^[a-f0-9]{64}$/.test(e.sourceHash??''),'EVENT_DATASET_EVENT','실측 이벤트의 시각·순서·식별값을 확인하세요.');ids.add(e.id);previous=e.receivedAt;}
 check(data.events.some(e=>e.kind==='ORDER_BOOK')&&data.events.some(e=>e.kind==='TRADE'),'EVENT_DATASET_COVERAGE','호가와 체결을 모두 관측한 구간을 선택하세요.');
 for(const b of data.bars)check(iso(b.closeTime)&&['open','high','low','close','volume'].every(k=>Number.isFinite(b[k]))&&b.close>0&&b.volume>=0,'EVENT_DATASET_BAR','확정 분봉의 시각·가격·거래량을 확인하세요.');
 check(data.market.startsWith('BTC-')||Array.isArray(data.benchmarkBars)&&data.benchmarkBars.length>1,'EVENT_DATASET_BENCHMARK','같은 시각의 BTC 비교 가격이 필요합니다.');freeze(data);valid.add(data);return data;
}
const summary=d=>({id:d.id,name:'업비트 · '+d.market+' · 호가·체결',contractVersion:d.contractVersion,datasetId:d.id,assetMode:EVENT_ASSET_MODE,market:d.market,instrumentId:d.instrumentId,instruments:[d.instrumentId],timeframe:d.timeframe,quoteCurrency:d.market.split('-')[0],startAt:d.startAt,endAt:d.endAt,availableAt:d.availableAt,sourceHash:d.sourceHash,datasetSha256:d.sourceHash,feeSnapshot:clone(d.feeSnapshot),coverage:clone(d.coverage??{}),executionEvidence:'OBSERVED_EVENTS',eventCount:d.events.length});
export async function listEventDatasets(options={}){
 if(options.eventDatasets)return Object.values(options.eventDatasets).map(d=>summary(assertEventDataset(d)));
 if(options.env?.EVENT_DATASETS?.list)return options.env.EVENT_DATASETS.list();
 return [];
}
export async function getEventDataset(id,options={}){
 if(options.eventDatasets){const d=options.eventDatasets[id]??Object.values(options.eventDatasets).find(d=>!id);check(d,'EVENT_DATASET_REQUIRED','실측 호가·체결 자료를 선택하세요.');return assertEventDataset(d);}
 if(options.env?.EVENT_DATASETS?.get){const d=await options.env.EVENT_DATASETS.get(id);check(d,'EVENT_DATASET_REQUIRED','저장된 호가·체결 자료를 선택하세요.');return assertEventDataset(d);}
 check(false,'EVENT_DATASET_REQUIRED','실측 자료 저장소를 연결한 뒤 관측 구간을 선택하세요.');
}
export const eventDatasetSource=data=>summary(assertEventDataset(data));
