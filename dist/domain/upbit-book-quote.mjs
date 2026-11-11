import {researchSha256} from './research.mjs';

export const UPBIT_BOOK_VERSION='upbit-orderbook-v1';
const positive=value=>typeof value==='number'&&Number.isFinite(value)&&value>0&&value<1e14;
const iso=value=>typeof value==='string'&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value;
const fail=message=>{const error=new TypeError(message);error.code='EXECUTION_QUOTE_INVALID';throw error;};
const check=(ok,message)=>{if(!ok)fail(message);};
export function upbitBookProjection(rawBody,instrument,action='hold'){
 check(instrument?.assetClass==='crypto'&&instrument.venue==='UPBIT'&&/^(KRW|BTC|USDT)-[A-Z0-9]{1,30}$/.test(instrument.symbol??'')&&instrument.id==='crypto:upbit:'+instrument.symbol&&instrument.quoteCurrency===instrument.symbol.split('-')[0]&&instrument.baseAsset===instrument.symbol.split('-')[1]&&['buy','sell','hold'].includes(action),'업비트 호가의 종목·통화·행동을 확인하세요.');
 check(typeof rawBody==='string'&&new TextEncoder().encode(rawBody).length<100000,'업비트 호가 원문 크기를 확인하세요.');
 let body;try{body=JSON.parse(rawBody);}catch{fail('업비트 호가 원문을 확인하세요.');}
 const row=Array.isArray(body)&&body.length===1?body[0]:null,units=row?.orderbook_units;
 check(row?.market===instrument.symbol&&row.level===0&&Number.isSafeInteger(row.timestamp)&&row.timestamp>0&&row.timestamp<8640000000000000&&Array.isArray(units)&&units.length>=1&&units.length<=30,'업비트 호가의 거래쌍·시각·조회 단위를 확인하세요.');
 check(positive(row.total_ask_size)&&positive(row.total_bid_size),'업비트 호가의 매수·매도 잔량을 확인하세요.');
 let previous=null;
 for(const unit of units){
  check(unit&&['ask_price','bid_price','ask_size','bid_size'].every(key=>positive(unit[key]))&&unit.ask_price>unit.bid_price&&(!previous||unit.ask_price>previous.ask_price&&unit.bid_price<previous.bid_price),'업비트 호가의 가격 순서·잔량을 확인하세요.');
  previous=unit;
 }
 const best=units[0];check(row.total_ask_size>=best.ask_size&&row.total_bid_size>=best.bid_size,'업비트 최우선 호가와 전체 잔량을 대조하세요.');
 const side=action==='buy'?'ask':'bid';
 return {price:best[side+'_price'],asOf:new Date(row.timestamp).toISOString(),priceBasis:side==='ask'?'BEST_ASK':'BEST_BID',book:{contractVersion:UPBIT_BOOK_VERSION,market:instrument.symbol,action,side,bestAskPrice:best.ask_price,bestAskQuantity:best.ask_size,bestBidPrice:best.bid_price,bestBidQuantity:best.bid_size,availableQuantity:best[side+'_size'],quantityUnit:instrument.baseAsset}};
}
export function assertUpbitBookQuote(quote,instrument,{now,action=quote?.book?.action,notBefore=null,fresh=true}={}){
 check(quote?.source==='UPBIT_PUBLIC_ORDERBOOK'&&quote.hashContract==='RESPONSE_BYTES_SHA256_V1'&&typeof quote.rawSha256==='string'&&/^[a-f0-9]{64}$/.test(quote.rawSha256)&&quote.rawSha256===researchSha256(quote.rawBody??''),'업비트 호가 원문과 해시를 대조하세요.');
 const parsed=upbitBookProjection(quote.rawBody,instrument,action);let url;try{url=new URL(quote.url);}catch{fail('업비트 호가 주소를 확인하세요.');}
 check(url.origin==='https://api.upbit.com'&&url.pathname==='/v1/orderbook'&&!url.username&&!url.password&&!url.hash&&url.searchParams.get('markets')===instrument.symbol&&url.searchParams.get('count')==='30'&&[...url.searchParams.keys()].length===2,'업비트 공식 호가 주소와 거래쌍을 대조하세요.');
 check(quote.instrumentId===instrument.id&&quote.currency===instrument.quoteCurrency&&quote.price===parsed.price&&quote.asOf===parsed.asOf&&quote.priceBasis===parsed.priceBasis&&quote.executionAllowed===true&&quote.freshness==='CURRENT'&&quote.book&&Object.entries(parsed.book).every(([key,value])=>quote.book[key]===value),'업비트 호가와 실행 가격·방향·잔량을 대조하세요.');
 check(iso(now)&&iso(quote.receivedAt)&&quote.asOf<=quote.receivedAt&&quote.receivedAt<=now&&(!fresh||Date.parse(now)-Date.parse(quote.asOf)<=30000)&&(notBefore===null||iso(notBefore)&&notBefore<=quote.asOf),'결정 이후 30초 이내에 수신한 업비트 호가를 확인하세요.');
 return parsed;
}
