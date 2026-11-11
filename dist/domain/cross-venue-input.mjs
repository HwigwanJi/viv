import {researchSha256} from './research.mjs';
import {hashInputPackage} from './workspace.mjs';

export const CROSS_VENUE_INPUT_VERSION='cross-venue-observation-v1';
const check=(ok,code,message)=>{if(!ok)throw Object.assign(new TypeError(message),{code,status:409});};
const iso=v=>typeof v==='string'&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString()===v;
const positive=v=>(typeof v==='string'&&/^\d+(\.\d+)?$/.test(v)||typeof v==='number')&&Number.isFinite(Number(v))&&Number(v)>0;
const decimal=v=>typeof v==='string'&&/^-?\d+(\.\d+)?$/.test(v)&&Number.isFinite(Number(v));
const midpoint=b=>(Number(b.bid)+Number(b.ask))/2;

/** Receipt-bound single observations; changes in demand and open interest need a time series. */
export function buildCrossVenueSnapshot({market,asOf,receipts,maxAgeMs=5000}={}){
 const match=/^KRW-([A-Z0-9]{1,20})$/.exec(market??'');
 check(match&&iso(asOf)&&Number.isSafeInteger(maxAgeMs)&&maxAgeMs>0&&Array.isArray(receipts)&&receipts.length<=12,'CROSS_VENUE_SCOPE','종목·관측 시각·원문 영수증을 확인하세요.');
 const symbol=match[1]+'USDT',refs=[];
 function source(host,path,predicate=()=>true){
  const matches=receipts.filter(r=>{try{const u=new URL(r.url);return u.protocol==='https:'&&u.hostname===host&&u.pathname===path&&predicate(u);}catch{return false;}});
  check(matches.length===1,'CROSS_VENUE_SOURCE','각 해외 관측의 원문을 하나씩 연결하세요.');const r=matches[0];
  check(r.status===200&&iso(r.startedAt)&&iso(r.receivedAt)&&r.startedAt<=r.receivedAt&&typeof r.body==='string'&&r.body.length<=300000&&researchSha256(r.body)===r.sha256,'CROSS_VENUE_RECEIPT','원문 해시와 수신 기록을 대조하세요.');
  check(r.receivedAt<=asOf&&Date.parse(asOf)-Date.parse(r.receivedAt)<=maxAgeMs,'CROSS_VENUE_TIME','판단 시점까지 수신된 최신 해외 관측을 연결하세요.');
  refs.push({id:r.id,contentHash:r.sha256,sourceRef:r.url,receivedAt:r.receivedAt});return {value:JSON.parse(r.body),receipt:r};
 }
 function eventTime(n,r,spot=false){check(Number.isSafeInteger(n)&&n>0,'CROSS_VENUE_TIME','거래소 관측 시각을 확인하세요.');const t=new Date(n).toISOString();check(t<=asOf&&(!spot||Date.parse(asOf)-n<=maxAgeMs),'CROSS_VENUE_TIME','판단 시각 이전의 거래소 관측과 현물 호가 갱신 시각을 확인하세요.');return {eventTime:t,receivedAt:r.receivedAt,availableAt:t>r.receivedAt?t:r.receivedAt,observationAgeMs:Date.parse(asOf)-n};}
 function book(bid,ask,bidQuantity,askQuantity){check([bid,ask,bidQuantity,askQuantity].every(positive)&&Number(ask)>=Number(bid),'CROSS_VENUE_BOOK','가격·수량·매수매도 호가 순서를 확인하세요.');return {bid:String(bid),ask:String(ask),bidQuantity:String(bidQuantity),askQuantity:String(askQuantity)};}
 const local=source('api.upbit.com','/v1/orderbook',u=>u.searchParams.get('markets')?.split(',').includes(market)&&u.searchParams.get('markets')?.split(',').includes('KRW-USDT'));
 check(Array.isArray(local.value),'CROSS_VENUE_SOURCE','업비트 호가 원문 배열을 확인하세요.');
 function localBook(code){const rows=local.value.filter(r=>r.market===code);check(rows.length===1&&rows[0].orderbook_units?.length,'CROSS_VENUE_SYMBOL','원화 종목과 USDT 환산 호가를 확인하세요.');const r=rows[0],b=r.orderbook_units[0];return {...book(b.bid_price,b.ask_price,b.bid_size,b.ask_size),...eventTime(r.timestamp,local.receipt,true),quoteCurrency:'KRW'};}
 const localSpot=localBook(market),conversion=localBook('KRW-USDT');
 const spot=source('api.binance.com','/api/v3/depth',u=>u.searchParams.get('symbol')===symbol),sb=spot.value;
 check(Number.isSafeInteger(sb.lastUpdateId)&&sb.bids?.length&&sb.asks?.length,'CROSS_VENUE_BOOK','해외 현물 호가와 갱신 ID를 확인하세요.');
 const foreignSpot={...book(sb.bids[0][0],sb.asks[0][0],sb.bids[0][1],sb.asks[0][1]),symbol,quoteCurrency:'USDT',lastUpdateId:sb.lastUpdateId,eventTime:null,receivedAt:spot.receipt.receivedAt,availableAt:spot.receipt.receivedAt,timeBasis:'RECEIPT_ONLY'};
 const funding=source('fapi.binance.com','/fapi/v1/premiumIndex',u=>u.searchParams.get('symbol')===symbol),f=funding.value;
 check(f.symbol===symbol&&positive(f.markPrice)&&positive(f.indexPrice)&&decimal(f.lastFundingRate)&&Number.isSafeInteger(f.nextFundingTime)&&f.nextFundingTime>f.time,'CROSS_VENUE_SYMBOL','선물 종목·마크가격·펀딩 단위를 확인하세요.');
 const open=source('fapi.binance.com','/fapi/v1/openInterest',u=>u.searchParams.get('symbol')===symbol),o=open.value;
 check(o.symbol===symbol&&positive(o.openInterest),'CROSS_VENUE_SYMBOL','미결제약정 종목과 수량을 확인하세요.');
 const body={contractVersion:CROSS_VENUE_INPUT_VERSION,market,instrumentId:'crypto:upbit:'+market,baseAsset:match[1],asOf,maxAgeMs,localSpot,conversion,foreignSpot,perpetual:{symbol,quoteCurrency:'USDT',markPrice:String(f.markPrice),indexPrice:String(f.indexPrice),lastFundingRate:f.lastFundingRate,fundingRateUnit:'RATIO_PER_FUNDING_INTERVAL',nextFundingTime:new Date(f.nextFundingTime).toISOString(),...eventTime(f.time,funding.receipt)},openInterest:{symbol,value:String(o.openInterest),unit:'EXCHANGE_REPORTED_QUANTITY',change:null,...eventTime(o.time,open.receipt)},regionalPremiumBps:(midpoint(localSpot)/(midpoint(foreignSpot)*midpoint(conversion))-1)*10000,coverage:{kind:'SINGLE_SNAPSHOT',signedSpotFlow:null,liquidations:null,absorption:null,leadLag:null},sourceRefs:refs};
 body.availableAt=[localSpot,conversion,foreignSpot,body.perpetual,body.openInterest].map(r=>r.availableAt).sort().at(-1);
 return {...body,sourceHash:hashInputPackage(body)};
}

export function resolveCrossVenueContext({snapshot,market,asOf}){
 const {sourceHash,...body}=snapshot??{};
 check(body.contractVersion===CROSS_VENUE_INPUT_VERSION&&sourceHash===hashInputPackage(body),'CROSS_VENUE_HASH','해외 입력의 원문 결속을 확인하세요.');
 check(body.market===market&&body.instrumentId==='crypto:upbit:'+market,'CROSS_VENUE_SYMBOL','현재 판단 종목과 해외 관측 종목을 일치시키세요.');
 check(iso(asOf)&&body.asOf<=asOf&&Date.parse(asOf)-Date.parse(body.asOf)<=body.maxAgeMs&&[body.localSpot,body.conversion,body.foreignSpot].every(r=>r.availableAt<=asOf&&Date.parse(asOf)-Date.parse(r.eventTime??r.receivedAt)<=body.maxAgeMs)&&[body.perpetual,body.openInterest].every(r=>r.availableAt<=asOf),'CROSS_VENUE_TIME','판단 시점에 사용 가능한 해외 관측을 확인하세요.');
 return structuredClone(snapshot);
}
