/** Public quotation adapters and an isolated paper order contract. */
import {instrumentPriceUnit,hasUpbitKrwPricePolicy} from './upbit-price-unit.mjs';
export const CONNECTOR_VERSION = 'public-paper-v1';
export const CONNECTOR_CAPABILITIES = Object.freeze({ publicQuotes: true, publicBooks: true, publicInstruments: true, paper: true, dryRun: true, liveOrders: false, stockAdapter: false });
export const VENUES = Object.freeze({
  upbit: Object.freeze({ id: 'upbit', name: 'Upbit Korea', assetClasses: ['CRYPTO'], baseUrl: 'https://api.upbit.com', documentation: 'https://docs.upbit.com/kr/reference/list-trading-pairs' }),
  okx: Object.freeze({ id: 'okx', name: 'OKX Global', assetClasses: ['CRYPTO'], baseUrl: 'https://openapi.okx.com', documentation: 'https://www.okx.com/docs-v5/en/' }),
});
export const ORDER_STATES = Object.freeze(['RESERVED','PARTIALLY_FILLED','CANCEL_PENDING','FILLED','CANCELLED','UNKNOWN']);
export class ConnectorError extends TypeError { constructor(code, message) { super(message); this.name = 'ConnectorError'; this.code = code; } }
const check = (condition, code, message) => { if (!condition) throw new ConnectorError(code,message); };
const plain = v => !!v && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
const safe = (v,d=0) => d < 25 && (v === null || ['boolean','string'].includes(typeof v) || typeof v === 'number' && Number.isFinite(v) || Array.isArray(v) && v.length <= 10000 && v.every(x=>safe(x,d+1)) || plain(v) && Object.keys(v).length <= 60 && Object.entries(Object.getOwnPropertyDescriptors(v)).every(([k,x])=>!['__proto__','constructor','prototype'].includes(k) && Object.hasOwn(x,'value') && safe(x.value,d+1)));
const fields = (v,allowed,required=[]) => check(plain(v) && safe(v) && Object.keys(v).every(k=>allowed.includes(k)) && required.every(k=>Object.hasOwn(v,k)), 'INVALID_INPUT','입력 항목을 확인하세요.');
const label = v => typeof v === 'string' && v.trim().length > 0 && v.length <= 1000;
const identifier = v => typeof v === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_.:@-]{0,199}$/.test(v);
const clone = v => structuredClone(v);
const canonical = v => Array.isArray(v) ? `[${v.map(canonical).join(',')}]` : plain(v) ? `{${Object.keys(v).sort().map(k=>`${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}` : JSON.stringify(v);
const Q = 10n ** 18n;
function expand(value) {
  const str = String(value); if (!/[eE]/.test(str)) return str;
  const m = /^(\d+)(?:\.(\d*))?[eE]([+-]?\d+)$/.exec(str); check(m, 'INVALID_DECIMAL','소수 값을 확인하세요.');
  const digits=m[1]+(m[2]??''), point=m[1].length+Number(m[3]);
  return point<=0 ? '0.'+'0'.repeat(-point)+digits : point>=digits.length ? digits+'0'.repeat(point-digits.length) : digits.slice(0,point)+'.'+digits.slice(point);
}
function dec(value) {
  check(typeof value === 'string' || typeof value === 'number' && Number.isFinite(value) && value >= 0, 'INVALID_DECIMAL','수량과 금액을 확인하세요.');
  const str=expand(value); check(/^\d{1,18}(?:\.\d{1,18})?$/.test(str), 'INVALID_DECIMAL','수량과 금액은 소수 18자리 이내로 입력하세요.');
  const [integer,fraction='']=str.split('.'); return BigInt(integer)*Q+BigInt(fraction.padEnd(18,'0'));
}
const amount = n => { const a=n/Q, b=(n%Q).toString().padStart(18,'0').replace(/0+$/,''); return b ? `${a}.${b}` : String(a); };
const positive = value => { const n=dec(value); check(n>0n,'INVALID_PRICE_QUANTITY','가격과 수량은 0보다 커야 합니다.'); return n; };
const mul = (a,b) => a*b/Q;
const ceilDiv = (a,b) => (a+b-1n)/b;
const feeFor = (notional,bps) => ceilDiv(notional*dec(bps),Q*10000n);
const time = value => { check(typeof value==='string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,19)===value.slice(0,19),'INVALID_TIME','ISO UTC 시각을 확인하세요.'); return new Date(value).toISOString(); };
const epoch = value => { const n=Number(value); check(Number.isSafeInteger(n) && n>0,'INVALID_QUOTE_TIME','거래소 시각을 확인하세요.'); return new Date(n).toISOString(); };
const venue = id => { check(Object.hasOwn(VENUES,id),'UNSUPPORTED_VENUE','지원하는 거래소를 선택하세요.'); return VENUES[id]; };
function symbolParts(venueId,symbol) {
  venue(venueId); check(typeof symbol==='string' && /^[A-Z0-9]{2,20}-[A-Z0-9]{2,20}$/.test(symbol),'INVALID_SYMBOL','현물 거래쌍을 확인하세요.');
  const [a,b]=symbol.split('-'); return venueId==='upbit' ? {baseAsset:b,quoteAsset:a} : {baseAsset:a,quoteAsset:b};
}
function metadata(meta) {
  fields(meta,['dataOrigin','sourceUrl','receivedAt'],['dataOrigin','sourceUrl','receivedAt']);
  check(['PUBLIC_API','FIXTURE'].includes(meta.dataOrigin) && typeof meta.sourceUrl==='string' && /^https:\/\//.test(meta.sourceUrl),'INVALID_PROVENANCE','응답 출처와 데이터 종류를 확인하세요.');
  return {...meta,receivedAt:time(meta.receivedAt)};
}
function instrumentBase(venueId,symbol,meta) {
  return {id:`${venueId}:${symbol}`,venueId,symbol,...symbolParts(venueId,symbol),assetClass:'CRYPTO',instrumentType:'SPOT',contractMultiplier:'1',settlement:'SPOT',tradingStatus:'UNKNOWN',tickSize:null,lotSize:null,minQuantity:null,minNotional:null,constraintSources:{},...metadata(meta)};
}
export function normalizeUpbitInstrument(pair,policy,meta) {
  check(plain(pair) && plain(policy) && pair.market===policy.market,'INVALID_INSTRUMENT','종목과 호가 정책의 거래쌍을 대조하세요.');
  const out=instrumentBase('upbit',pair.market,meta); out.name=pair.korean_name??pair.english_name??pair.market;
  out.tickSize=amount(positive(policy.tick_size)); out.constraintSources.tickSize={kind:meta.dataOrigin,source:meta.sourceUrl,asOf:out.receivedAt};
  if(out.quoteAsset==='KRW') { out.minNotional='5000'; out.constraintSources.minNotional={kind:'OFFICIAL_DOCUMENT',source:'https://docs.upbit.com/kr/docs/krw-market-info',verifiedAt:'2026-10-16'}; }
  out.warnings=['LOT_SIZE_NOT_PUBLIC','MIN_QUANTITY_NOT_PUBLIC','ACCOUNT_ORDER_ELIGIBILITY_UNVERIFIED'];
  out.marketEvent=clone(pair.market_event??null); return out;
}
export function normalizeOkxInstrument(row,meta) {
  check(plain(row) && row.instType==='SPOT','INVALID_INSTRUMENT','현물 종목 정보를 확인하세요.');
  const out=instrumentBase('okx',row.instId,meta); check(row.baseCcy===out.baseAsset && row.quoteCcy===out.quoteAsset,'INVALID_INSTRUMENT','종목 통화를 대조하세요.');
  for(const [target,key] of [['tickSize','tickSz'],['lotSize','lotSz'],['minQuantity','minSz']]) { out[target]=amount(positive(row[key])); out.constraintSources[target]={kind:meta.dataOrigin,source:meta.sourceUrl,asOf:out.receivedAt}; }
  out.tradingStatus=row.state==='live'?'ACTIVE':row.state==='suspend'?'SUSPENDED':'UNKNOWN'; out.warnings=['MIN_NOTIONAL_NOT_PUBLISHED','ACCOUNT_ORDER_ELIGIBILITY_UNVERIFIED']; return out;
}
export function withPaperConstraints(instrument,assumptions,{source,asOf}={}) {
  check(plain(instrument) && label(source),'INVALID_PAPER_ASSUMPTION','모의 주문 단위의 근거를 기록하세요.'); fields(assumptions,['tickSize','lotSize','minQuantity','minNotional']);
  const out=clone(instrument), at=time(asOf);
  for(const [key,value] of Object.entries(assumptions)) { const n=key==='minNotional'?dec(value):positive(value); check(instrument[key]===null || dec(instrument[key])===n,'CONSTRAINT_OVERRIDE','공개 API에서 확인된 주문 단위를 유지하세요.'); if(instrument[key]===null) {out[key]=amount(n);out.constraintSources[key]={kind:'PAPER_ASSUMPTION',source,asOf:at};} }
  return out;
}
function quoteBase(venueId,symbol,snapshotAt,meta) { return {venueId,instrumentId:`${venueId}:${symbol}`,symbol,...symbolParts(venueId,symbol),snapshotAt:epoch(snapshotAt),...metadata(meta)}; }
export function normalizeUpbitTicker(row,meta) {
  check(plain(row),'INVALID_TICKER','현재가 응답을 확인하세요.');
  return {...quoteBase('upbit',row.market,row.timestamp,meta),kind:'TICKER',lastPrice:amount(positive(row.trade_price)),priceAt:epoch(row.trade_timestamp),priceTimeBasis:'LAST_TRADE',bidPrice:null,askPrice:null};
}
export function normalizeOkxTicker(row,meta) {
  check(plain(row),'INVALID_TICKER','현재가 응답을 확인하세요.');
  return {...quoteBase('okx',row.instId,row.ts,meta),kind:'TICKER',lastPrice:amount(positive(row.last)),priceAt:null,priceTimeBasis:'TICKER_GENERATED_AT',bidPrice:amount(positive(row.bidPx)),askPrice:amount(positive(row.askPx))};
}
function normalizedBook(venueId,symbol,stamp,bids,asks,meta) {
  check(Array.isArray(bids)&&Array.isArray(asks)&&bids.length>0&&asks.length>0&&bids.length<=400&&asks.length<=400,'INVALID_ORDERBOOK','양방향 호가를 확인하세요.');
  const levels=rows=>rows.map(([price,quantity])=>({price:amount(positive(price)),quantity:amount(positive(quantity))}));
  const bid=levels(bids),ask=levels(asks);
  check(bid.every((x,i)=>!i||dec(bid[i-1].price)>dec(x.price)) && ask.every((x,i)=>!i||dec(ask[i-1].price)<dec(x.price)) && dec(bid[0].price)<dec(ask[0].price),'CROSSED_ORDERBOOK','호가 순서와 매수·매도 간격을 확인하세요.');
  return {...quoteBase(venueId,symbol,stamp,meta),kind:'ORDERBOOK',priceAt:epoch(stamp),priceTimeBasis:'ORDERBOOK_GENERATED_AT',bidPrice:bid[0].price,askPrice:ask[0].price,bids:bid,asks:ask};
}
export function normalizeUpbitOrderBook(row,meta) {
  check(plain(row) && Array.isArray(row.orderbook_units) && (row.level===undefined||Number(row.level)===0),'AGGREGATED_ORDERBOOK','개별 호가 단위의 응답을 확인하세요.');
  return normalizedBook('upbit',row.market,row.timestamp,row.orderbook_units.map(x=>[x.bid_price,x.bid_size]),row.orderbook_units.map(x=>[x.ask_price,x.ask_size]),meta);
}
export function normalizeOkxOrderBook(row,symbol,meta) { check(plain(row),'INVALID_ORDERBOOK','호가 응답을 확인하세요.'); return normalizedBook('okx',symbol,row.ts,row.bids,row.asks,meta); }
export function quoteFreshness(quote,{now,maxAgeMs=10000,maxClockSkewMs=2000}={}) {
  check(plain(quote)&&Number.isFinite(maxAgeMs)&&maxAgeMs>=0&&Number.isFinite(maxClockSkewMs)&&maxClockSkewMs>=0,'INVALID_QUOTE','가격 유효기간을 확인하세요.');
  const at=time(now), stamp=time(quote.priceAt??quote.snapshotAt),received=time(quote.receivedAt),ageMs=Date.parse(at)-Date.parse(stamp),snapshotAgeMs=Date.parse(at)-Date.parse(time(quote.snapshotAt));
  const future=Math.min(ageMs,snapshotAgeMs,Date.parse(at)-Date.parse(received)) < -maxClockSkewMs;
  return {asOf:at,ageMs,snapshotAgeMs,isStale:ageMs>maxAgeMs||snapshotAgeMs>maxAgeMs||Date.parse(at)-Date.parse(received)>maxAgeMs,isFuture:future,usable:!future&&ageMs<=maxAgeMs&&snapshotAgeMs<=maxAgeMs&&Date.parse(at)-Date.parse(received)<=maxAgeMs};
}
export function createPublicConnector(venueId,{fetchImpl=globalThis.fetch,now=()=>new Date().toISOString(),timeoutMs=5000,maxAgeMs=10000,dataOrigin='PUBLIC_API'}={}) {
  const definition=venue(venueId); check(typeof fetchImpl==='function' && typeof now==='function' && Number.isFinite(timeoutMs)&&timeoutMs>0&&timeoutMs<=30000&&['PUBLIC_API','FIXTURE'].includes(dataOrigin),'INVALID_CONNECTOR','공개 조회 설정을 확인하세요.');
  async function get(path,params) {
    const url=new URL(path,definition.baseUrl);for(const [k,v]of Object.entries(params))url.searchParams.set(k,v);
    const controller=new AbortController(); let timer;
    try {
      const pending=(async()=>{ const response=await fetchImpl(url.href,{method:'GET',headers:{Accept:'application/json'},cache:'no-store',signal:controller.signal,credentials:'omit',redirect:'error'});check(response.ok,'HTTP_ERROR',`공개 조회 응답을 확인하세요. (${response.status})`);return response.json(); })();
      const body=await Promise.race([pending,new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new ConnectorError('TIMEOUT','공개 조회 시간이 초과됐습니다.'));},timeoutMs);})]);
      check(dataOrigin==='FIXTURE'||!body?.error,'VENUE_ERROR','거래소 공개 응답을 확인하세요.');
      if(venueId==='okx') check(body?.code==='0' && Array.isArray(body.data),'VENUE_ERROR','거래소 공개 응답을 확인하세요.'); else check(Array.isArray(body),'VENUE_ERROR','거래소 공개 응답을 확인하세요.');
      return {rows:venueId==='okx'?body.data:body,meta:{dataOrigin,sourceUrl:url.href,receivedAt:time(now())}};
    } catch(error) { if(error instanceof ConnectorError)throw error;throw new ConnectorError('NETWORK_ERROR','공개 데이터를 다시 조회하세요.'); } finally {clearTimeout(timer);}
  }
  const selected=(rows,symbol,key)=>{const row=rows.find(r=>r?.[key]===symbol);check(row,'INSTRUMENT_NOT_FOUND','거래소에서 거래쌍 응답을 찾을 수 없습니다.');return row;};
  const checkedQuote=q=>({...q,freshness:quoteFreshness(q,{now:time(now()),maxAgeMs})});
  return Object.freeze({venueId,capabilities:CONNECTOR_CAPABILITIES,
    async getInstrument(symbol) {symbolParts(venueId,symbol);if(venueId==='okx'){const r=await get('/api/v5/public/instruments',{instType:'SPOT',instId:symbol});return normalizeOkxInstrument(selected(r.rows,symbol,'instId'),r.meta);}const [a,b]=await Promise.all([get('/v1/market/all',{is_details:'true'}),get('/v1/orderbook/instruments',{markets:symbol})]);return normalizeUpbitInstrument(selected(a.rows,symbol,'market'),selected(b.rows,symbol,'market'),b.meta);},
    async getTicker(symbol) {symbolParts(venueId,symbol);const r=await get(venueId==='okx'?'/api/v5/market/ticker':'/v1/ticker',venueId==='okx'?{instId:symbol}:{markets:symbol});return checkedQuote(venueId==='okx'?normalizeOkxTicker(selected(r.rows,symbol,'instId'),r.meta):normalizeUpbitTicker(selected(r.rows,symbol,'market'),r.meta));},
    async getOrderBook(symbol) {symbolParts(venueId,symbol);const r=await get(venueId==='okx'?'/api/v5/market/books':'/v1/orderbook',venueId==='okx'?{instId:symbol,sz:'20'}:{markets:symbol,level:'0',count:'20'});return checkedQuote(venueId==='okx'?normalizeOkxOrderBook(r.rows[0],symbol,r.meta):normalizeUpbitOrderBook(selected(r.rows,symbol,'market'),r.meta));},
  });
}

function checkedInstrument(instrument) {
  check(plain(instrument)&&identifier(instrument.id)&&['CRYPTO','EQUITY'].includes(instrument.assetClass)&&['SPOT','CASH_EQUITY'].includes(instrument.instrumentType)&&instrument.contractMultiplier==='1'&&instrument.settlement==='SPOT','INVALID_INSTRUMENT','현물·현금 종목 계약을 확인하세요.');
  for(const key of ['tickSize','lotSize','minQuantity','minNotional']) { check(instrument[key]!==null&&instrument[key]!==undefined&&plain(instrument.constraintSources?.[key])&&label(instrument.constraintSources[key].source),'UNKNOWN_ORDER_CONSTRAINT','공개 주문 단위와 모의 가정을 기록하세요.');key==='minNotional'?dec(instrument[key]):positive(instrument[key]); }
  check(instrument.tradingStatus!=='SUSPENDED','INSTRUMENT_SUSPENDED','중단된 종목의 주문을 제한합니다.');return instrument;
}
function checkedFee(fee,now) {
 fields(fee,['bps','kind','source','asOf','sourceHash','sideBps'],['bps','kind','source','asOf']);
 check(['PAPER_ASSUMPTION','OBSERVED_ACCOUNT_RATE'].includes(fee.kind)&&label(fee.source)&&dec(fee.bps)<=dec('1000')&&Date.parse(time(fee.asOf))<=Date.parse(now),'INVALID_FEE','수수료 요율과 원문 출처를 확인하세요.');
 if(fee.kind==='OBSERVED_ACCOUNT_RATE')check(/^[a-f0-9]{64}$/.test(fee.sourceHash??'')&&plain(fee.sideBps)&&Object.keys(fee.sideBps).sort().join(',')==='buy,sell'&&['buy','sell'].every(k=>dec(fee.sideBps[k])<=dec('1000')),'INVALID_FEE','계좌에서 조회한 매수·매도 수수료와 원문 해시를 확인하세요.');
 else check(!Object.hasOwn(fee,'sideBps')&&!Object.hasOwn(fee,'sourceHash'),'INVALID_FEE','모의 비용 가정의 형식을 확인하세요.');
 return {...clone(fee),bps:amount(dec(fee.bps)),asOf:time(fee.asOf)};
}
export function observedAccountFeeSchedule(fees){
 check(plain(fees)&&/^[a-f0-9]{64}$/.test(fees.sourceHash??''),'INVALID_FEE','계좌 수수료 원문을 확인하세요.');
 const buy=amount(dec(fees.takerBuyRate)*10000n),sell=amount(dec(fees.takerSellRate)*10000n);
 return checkedFee({kind:'OBSERVED_ACCOUNT_RATE',bps:buy,sideBps:{buy,sell},source:'UPBIT_AUTHENTICATED_ORDER_CHANCE',sourceHash:fees.sourceHash,asOf:fees.observedAt},fees.observedAt);
}
export function validateOrderIntent(intent,{instrument,quote,feeSchedule,now,maxAgeMs=10000}={}) {
  fields(intent,['id','mode','venueId','instrumentId','accountId','decisionId','side','type','quantity','limitPrice'],['id','mode','venueId','instrumentId','side','type','quantity','limitPrice']);
  check(identifier(intent.id)&&['paper','dry-run'].includes(intent.mode)&&['buy','sell'].includes(intent.side)&&intent.type==='limit','ORDER_MODE_FORBIDDEN','모의 지정가 주문을 선택하세요.');
  checkedInstrument(instrument);const at=time(now),schedule=checkedFee(feeSchedule,at),fee=schedule.sideBps?{...schedule,bps:amount(dec(schedule.sideBps[intent.side]))}:schedule;
  check(intent.instrumentId===instrument.id&&intent.venueId===instrument.venueId&&quote?.instrumentId===instrument.id&&quote.venueId===instrument.venueId,'INSTRUMENT_MISMATCH','주문·가격·종목을 대조하세요.');
  check(['TICKER','ORDERBOOK'].includes(quote.kind)&&['PUBLIC_API','FIXTURE'].includes(quote.dataOrigin)&&label(quote.sourceUrl),'INVALID_QUOTE','가격 종류와 출처를 확인하세요.');
  const fresh=quoteFreshness(quote,{now:at,maxAgeMs});check(fresh.usable,'STALE_QUOTE','사용 가능한 최신 가격을 조회하세요.');
  const quantity=positive(intent.quantity),price=positive(intent.limitPrice),notional=mul(quantity,price);
  check(quantity%positive(instrument.lotSize)===0n&&price%positive(instrumentPriceUnit(instrument,price))===0n,'ORDER_INCREMENT','수량·가격 단위에 맞춰 주문하세요.');
  check(quantity>=positive(instrument.minQuantity)&&notional>0n&&notional>=dec(instrument.minNotional),'MINIMUM_ORDER','최소 주문 수량과 금액을 확인하세요.');
  return {...clone(intent),quantity:amount(quantity),limitPrice:amount(price),estimatedNotional:amount(notional),estimatedFee:amount(feeFor(notional,fee.bps)),feeSchedule:fee,quoteSource:{dataOrigin:quote.dataOrigin,sourceUrl:quote.sourceUrl,snapshotAt:quote.snapshotAt,priceAt:quote.priceAt,receivedAt:quote.receivedAt},validatedAt:at};
}
const reserveFor=(order,remaining)=>order.side==='buy'?{quote:mul(remaining,dec(order.limitPrice))+feeFor(mul(remaining,dec(order.limitPrice)),order.feeSchedule.bps),base:0n}:{quote:0n,base:remaining};
const openOrder=o=>!['FILLED','CANCELLED'].includes(o.status);
function ledgerBalances(state) {
  let quote=dec(state.initialBalances.quote),base=dec(state.initialBalances.base),rq=0n,rb=0n;
  for(const f of state.fundingLedger??[])quote+=f.direction==='deposit'?dec(f.amount):-dec(f.amount);
  for(const f of state.fills) {if(f.side==='buy'){quote-=dec(f.notional)+dec(f.fee);base+=dec(f.quantity);}else{quote+=dec(f.notional)-dec(f.fee);base-=dec(f.quantity);}}
  for(const o of state.orders)if(openOrder(o)){const r=reserveFor(o,dec(o.quantity)-dec(o.filledQuantity));rq+=r.quote;rb+=r.base;}
  check(quote>=rq&&base>=rb,'INSUFFICIENT_BALANCE','주문 예약에 필요한 잔고를 확인하세요.');
  return {quote:{available:amount(quote-rq),reserved:amount(rq)},base:{available:amount(base-rb),reserved:amount(rb)}};
}
export function createPaperConnector({id=globalThis.crypto.randomUUID(),instrument,balances,feeSchedule,now}={}) {
  const at=time(now);check(identifier(id)&&plain(balances),'INVALID_PAPER_ACCOUNT','모의계좌를 확인하세요.');checkedInstrument(instrument);
  return {schemaVersion:1,mode:'paper',id,venueId:instrument.venueId,instrument:clone(instrument),feeSchedule:checkedFee(feeSchedule,at),revision:0,createdAt:at,updatedAt:at,initialBalances:{quote:amount(dec(balances.quote)),base:amount(dec(balances.base))},balances:{quote:{available:amount(dec(balances.quote)),reserved:'0'},base:{available:amount(dec(balances.base)),reserved:'0'}},reconciliationStatus:'MATCHED',orders:[],fills:[],events:[],receipts:[]};
}
export function validatePaperConnector(state) {
  try {
    check(plain(state)&&safe(state)&&state.schemaVersion===1&&state.mode==='paper'&&identifier(state.id)&&Number.isSafeInteger(state.revision)&&state.revision>=0&&['orders','fills','events','receipts'].every(k=>Array.isArray(state[k])),'INVALID_PAPER_STATE','모의 주문 저장 형식을 확인하세요.');
    check(state.fundingLedger===undefined||Array.isArray(state.fundingLedger)&&new Set(state.fundingLedger.map(f=>f.id)).size===state.fundingLedger.length,'INVALID_FUNDING','자금 이동 원장을 확인하세요.');for(const f of state.fundingLedger??[]){check(identifier(f.id)&&['deposit','withdraw'].includes(f.direction)&&positive(f.amount)>0n&&time(f.at)<=time(state.updatedAt),'INVALID_FUNDING','자금 이동의 금액과 시각을 확인하세요.');}
    checkedInstrument(state.instrument);time(state.updatedAt);checkedFee(state.feeSchedule,state.updatedAt);
    check(new Set(state.orders.map(o=>o.id)).size===state.orders.length&&new Set(state.fills.map(f=>f.fillId)).size===state.fills.length&&new Set(state.receipts.map(r=>r.key)).size===state.receipts.length,'DUPLICATE_PAPER_RECORD','중복 주문·체결 기록을 확인하세요.');
    for(const o of state.orders) {check(ORDER_STATES.includes(o.status)&&o.instrumentId===state.instrument.id&&o.venueId===state.venueId&&['buy','sell'].includes(o.side),'INVALID_PAPER_ORDER','모의 주문의 종목·상태를 확인하세요.');const matched=state.fills.filter(f=>f.orderId===o.id),filled=matched.reduce((n,f)=>n+dec(f.quantity),0n);check(filled===dec(o.filledQuantity)&&filled<=positive(o.quantity)&&(o.status!=='FILLED'||filled===dec(o.quantity)),'PAPER_FILL_MISMATCH','주문 수량과 누적 체결량을 대조하세요.');}
    for(const f of state.fills) {const o=state.orders.find(o=>o.id===f.orderId);check(o&&f.side===o.side&&dec(f.notional)===mul(positive(f.quantity),positive(f.price))&&dec(f.fee)===feeFor(dec(f.notional),o.feeSchedule.bps)&&canonical(f.feeSource)===canonical(o.feeSchedule)&&f.feeCurrency===state.instrument.quoteAsset&&f.mode==='paper','PAPER_FILL_MISMATCH','체결 금액과 수수료를 대조하세요.');}
    check(canonical(state.balances)===canonical(ledgerBalances(state)),'PAPER_BALANCE_MISMATCH','잔고·예약·체결 원장을 대조하세요.');return [];
  }catch(error){return [{code:error.code??'INVALID_PAPER_STATE',message:error.message}];}
}
const checkPaper=s=>{const e=validatePaperConnector(s);check(!e.length,e[0]?.code,e[0]?.message);};
export function transferPaperConnectorCash(state,{id,amount:value,direction,now}={}){
 checkPaper(state);const at=time(now);check(identifier(id)&&['deposit','withdraw'].includes(direction)&&at>=time(state.updatedAt),'INVALID_FUNDING','자금 이동 식별자와 시각을 확인하세요.');const cash=amount(positive(value)),prior=state.fundingLedger?.find(f=>f.id===id);if(prior){check(prior.amount===cash&&prior.direction===direction,'FUNDING_CONFLICT','원 자금 이동을 유지하세요.');return clone(state);}
 const next=clone(state);next.fundingLedger??=[];next.fundingLedger.push({id,amount:cash,direction,at,fillOffset:next.fills.length});next.balances=ledgerBalances(next);next.updatedAt=at;next.revision++;checkPaper(next);return next;
}
function applyFill(state,order,fill,now) {
  fields(fill,['fillId','quantity','price','occurredAt'],['fillId','quantity','price','occurredAt']);check(identifier(fill.fillId),'INVALID_FILL','체결 ID를 확인하세요.');
  const prior=state.fills.find(f=>f.fillId===fill.fillId),stamp=time(fill.occurredAt),quantity=positive(fill.quantity),price=positive(fill.price);
  if(prior){check(prior.orderId===order.id&&dec(prior.quantity)===quantity&&dec(prior.price)===price&&prior.occurredAt===stamp,'FILL_ID_CONFLICT','같은 체결 ID의 내용을 대조하세요.');return prior;}
  check(openOrder(order)&&Date.parse(stamp)>=Date.parse(order.createdAt)&&Date.parse(stamp)<=Date.parse(now),'INVALID_FILL_STATE','체결 시각과 주문 상태를 확인하세요.');
  const observedUpbit=hasUpbitKrwPricePolicy(state.instrument)&&order.quoteSource?.dataOrigin==='PUBLIC_API'&&/^https:\/\/api\.upbit\.com\/v1\/orderbook(?:\?|$)/.test(order.quoteSource.sourceUrl);
  check(quantity%positive(state.instrument.lotSize)===0n&&(observedUpbit||price%positive(state.instrument.tickSize)===0n)&&quantity<=dec(order.quantity)-dec(order.filledQuantity)&&(order.side==='buy'?price<=dec(order.limitPrice):price>=dec(order.limitPrice)),'INVALID_FILL','체결 수량·가격·지정가를 대조하세요.');
  const notional=mul(quantity,price);check(notional>0n,'INVALID_FILL','체결 금액이 저장 정밀도보다 작습니다.');
  const record={fillId:fill.fillId,orderId:order.id,side:order.side,quantity:amount(quantity),price:amount(price),notional:amount(notional),fee:amount(feeFor(notional,order.feeSchedule.bps)),feeCurrency:state.instrument.quoteAsset,feeSource:clone(order.feeSchedule),occurredAt:stamp,recordedAt:now,mode:'paper'};
  const cancelPending=order.status==='CANCEL_PENDING';state.fills.push(record);order.filledQuantity=amount(dec(order.filledQuantity)+quantity);order.status=order.filledQuantity===order.quantity?'FILLED':cancelPending?'CANCEL_PENDING':'PARTIALLY_FILLED';order.updatedAt=now;return record;
}
export function dispatchPaperOrder(connector,command,{now,maxAgeMs=10000}={}) {
  checkPaper(connector);fields(command,['type','payload','idempotencyKey','expectedRevision'],['type','payload']);const at=time(now);
  check(Date.parse(at)>=Date.parse(connector.updatedAt),'INVALID_TIME','기록 시각의 순서를 확인하세요.');
  if(command.type==='order.query'){fields(command.payload,['orderId'],['orderId']);const order=connector.orders.find(o=>o.id===command.payload.orderId);check(order,'ORDER_NOT_FOUND','주문을 찾을 수 없습니다.');return {state:clone(connector),result:clone({order,fills:connector.fills.filter(f=>f.orderId===order.id)}),idempotent:true};}
  check(identifier(command.idempotencyKey),'IDEMPOTENCY_REQUIRED','주문 작업의 중복 방지 키를 확인하세요.');
  const fingerprint=canonical({type:command.type,payload:command.payload}),receipt=connector.receipts.find(r=>r.key===command.idempotencyKey);
  if(receipt){check(receipt.fingerprint===fingerprint,'IDEMPOTENCY_CONFLICT','같은 작업 키의 입력을 대조하세요.');return {state:clone(connector),result:clone(receipt.result),idempotent:true};}
  check(command.expectedRevision===undefined||command.expectedRevision===connector.revision,'REVISION_CONFLICT','모의 주문 상태를 다시 조회하세요.');
  const state=clone(connector),p=command.payload;let result;
  if(command.type==='order.reserve'||command.type==='order.dry-run') {
    fields(p,['intent','quote'],['intent','quote']);check(state.reconciliationStatus==='MATCHED','RECONCILIATION_REQUIRED','불확정 주문을 먼저 대사하세요.');
    const intent=validateOrderIntent(p.intent,{instrument:state.instrument,quote:p.quote,feeSchedule:state.feeSchedule,now:at,maxAgeMs});
    check(!state.orders.some(o=>o.id===intent.id),'DUPLICATE_ORDER','이미 등록한 주문 ID입니다.');
    check(!intent.accountId||intent.accountId===state.id,'ACCOUNT_MISMATCH','모의계좌와 주문 계좌를 대조하세요.');
    if(command.type==='order.dry-run'||intent.mode==='dry-run'){ledgerBalances({...state,orders:[...state.orders,{...intent,status:'RESERVED',filledQuantity:'0'}]});return {state:clone(connector),result:{intent,reservation:reserveForDisplay(intent),status:'DRY_RUN'},idempotent:false};}
    const order={...intent,status:'RESERVED',filledQuantity:'0',createdAt:at,updatedAt:at};state.orders.push(order);result=clone(order);
  } else {
    check(['order.fill','order.cancel','order.mark-unknown','order.reconcile'].includes(command.type),'UNKNOWN_ORDER_ACTION','등록된 모의 주문 작업을 선택하세요.');
    const allowed=command.type==='order.fill'?['orderId','fill']:command.type==='order.cancel'?['orderId','confirmed']:command.type==='order.mark-unknown'?['orderId','reason']:['orderId','reportedStatus','fills','confirmed','reportedAt'];fields(p,allowed,['orderId']);
    const order=state.orders.find(o=>o.id===p.orderId);check(order,'ORDER_NOT_FOUND','주문을 찾을 수 없습니다.');
    if(command.type==='order.fill') {check(order.status!=='UNKNOWN','RECONCILIATION_REQUIRED','불확정 주문의 체결은 대사에서 확인하세요.');result=applyFill(state,order,p.fill,at);}
    else if(command.type==='order.cancel') {check(openOrder(order)&&order.status!=='UNKNOWN'&&(p.confirmed===undefined||typeof p.confirmed==='boolean'),'INVALID_CANCEL','취소할 수 있는 주문을 확인하세요.');order.status=p.confirmed===false?'CANCEL_PENDING':'CANCELLED';order.updatedAt=at;result=clone(order);}
    else if(command.type==='order.mark-unknown') {check(openOrder(order)&&label(p.reason),'INVALID_ORDER_STATE','불확정 상태의 이유를 기록하세요.');order.status='UNKNOWN';order.updatedAt=at;result=clone(order);}
    else {
      check(['open','partially_filled','filled','cancelled','not_found'].includes(p.reportedStatus)&&Array.isArray(p.fills)&&typeof p.confirmed==='boolean','INVALID_RECONCILIATION','주문 상태·체결 목록·확인 결과를 입력하세요.');const stamp=time(p.reportedAt);check(Date.parse(stamp)<=Date.parse(at)&&Date.parse(stamp)>=Date.parse(order.updatedAt),'STALE_RECONCILIATION','현재 주문 이후의 대사 결과를 확인하세요.');
      for(const fill of p.fills)applyFill(state,order,fill,at);
      if(p.reportedStatus==='not_found'||!p.confirmed)order.status='UNKNOWN';
      else if(p.reportedStatus==='cancelled'){check(order.filledQuantity!==order.quantity,'RECONCILIATION_CONFLICT','완료 체결과 취소 상태를 대조하세요.');order.status='CANCELLED';}
      else if(p.reportedStatus==='filled'){check(order.filledQuantity===order.quantity,'RECONCILIATION_CONFLICT','모든 체결 근거를 확인하세요.');order.status='FILLED';}
      else {check(order.filledQuantity!==order.quantity && (p.reportedStatus!=='open'||order.filledQuantity==='0') && (p.reportedStatus!=='partially_filled'||order.filledQuantity!=='0'),'RECONCILIATION_CONFLICT','잔여 수량과 거래소 상태를 대조하세요.');order.status=order.filledQuantity==='0'?'RESERVED':'PARTIALLY_FILLED';}
      order.updatedAt=at;result=clone(order);
    }
  }
  state.reconciliationStatus=state.orders.some(o=>o.status==='UNKNOWN')?'REQUIRED':'MATCHED';state.balances=ledgerBalances(state);state.revision++;state.updatedAt=at;
  state.events.push({id:globalThis.crypto.randomUUID(),type:command.type,orderId:p.orderId??p.intent?.id,at,mode:'paper'});state.receipts.push({key:command.idempotencyKey,fingerprint,result:clone(result)});checkPaper(state);return {state,result,idempotent:false};
}
function reserveForDisplay(intent){const r=reserveFor(intent,dec(intent.quantity));return {quote:amount(r.quote),base:amount(r.base)};}
export function liveActivationStatus(evidence={}) {
  const required=['userApproval','serverCredentials','keyPermissionsVerified','accountIdentityVerified','feeScheduleVerified','orderRulesVerified','reconciliationVerified','emergencyStopVerified','deploymentLimitsVerified'];
  return {enabled:false,implementationAvailable:false,missing:[...required.filter(k=>evidence[k]!==true),'liveTransportImplementation'],capabilities:CONNECTOR_CAPABILITIES};
}
