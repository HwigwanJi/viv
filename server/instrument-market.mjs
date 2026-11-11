import { getInstrument, InstrumentError, MARKET_TIMEFRAME_MS, UPBIT_MINUTE_UNITS } from '../dist/domain/instruments.mjs';
import { researchSha256 } from '../dist/domain/research.mjs';

export const INSTRUMENT_MARKET_VERSION = 'instrument-market-v1.3';
// Officially supported REST origin retained by OKX for compatibility:
// https://www.okx.com/docs-v5/log_en/#2026-05-20
// Each request uses this fixed origin; HTTP 429 stops without host failover.
const OKX_ORIGIN = 'https://www.okx.com', KIS_ORIGIN = 'https://openapi.koreainvestment.com:9443', UPBIT_ORIGIN='https://api.upbit.com';
const STEPS = MARKET_TIMEFRAME_MS;
const iso = value => new Date(value).toISOString(), hash = value => researchSha256(typeof value === 'string' ? value : JSON.stringify(value));
export class InstrumentMarketError extends TypeError { constructor(code,message,diagnostic=null) { super(message); this.name='InstrumentMarketError';this.code=code;this.diagnostic=diagnostic; } }
const check = (condition,code,message) => { if (!condition) throw new InstrumentMarketError(code,message); };
function readClock(now) { const read = typeof now === 'function' ? now : () => now ?? Date.now(); return () => { const raw=read(),value=typeof raw==='number'?raw:Date.parse(raw);check(Number.isSafeInteger(value)&&value>0,'INVALID_MARKET_TIME','자료 조회 시각을 확인하세요.');return value; }; }
function retryAfter(response) { const value=response.headers?.get?.('Retry-After')?.trim(); if (/^\d{1,10}$/.test(value??''))return String(Number(value));if(/^[A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(value??'')&&Number.isFinite(Date.parse(value)))return new Date(value).toUTCString();return null; }
const ERROR_BODY_LIMIT=16384;
function diagnosticText(value,max,secrets=[]){
  if(typeof value!=='string')return null;
  let text=value.replace(/[\u0000-\u001f\u007f-\u009f]/g,' ').replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim();
  for(const secret of secrets.filter(v=>typeof v==='string'&&v.length))text=text.split(secret).join('[redacted]');
  if(/\b(?:authorization|set-cookie|cookie|bearer|appkey|appsecret|api[-_ ]?key|access[-_ ]?token|password|passphrase|signature|secret)\b/i.test(text))return null;
  return text.slice(0,max)||null;
}
/** The API revalidates this allowlist before exposing provider diagnostics. */
export function safeInstrumentMarketDiagnostic(value,{secrets=[]}={}){
  if(!value||typeof value!=='object')return null;
  const origins={okx:['www.okx.com','openapi.okx.com'],upbit:['api.upbit.com'],kis:['openapi.koreainvestment.com:9443'],toss:['openapi.tossinvest.com'],'naver-reference':['fchart.stock.naver.com']},provider=Object.hasOwn(origins,value.provider)?value.provider:null;
  const stamp=v=>typeof v==='string'&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString()===v?v:null;
  const r={provider,host:provider&&origins[provider].includes(value.host)?value.host:null,path:typeof value.path==='string'&&/^\/[A-Za-z0-9/_.-]{0,199}$/.test(value.path)?value.path:null,requestedAt:stamp(value.requestedAt),receivedAt:stamp(value.receivedAt)};
  if(Number.isInteger(value.httpStatus)&&value.httpStatus>=100&&value.httpStatus<=599)r.httpStatus=value.httpStatus;
  if(Object.hasOwn(value,'retryAfter'))r.retryAfter=retryAfter({headers:{get:()=>typeof value.retryAfter==='string'?value.retryAfter:null}});
  if(Object.hasOwn(value,'contentType'))r.contentType=['application/json','application/problem+json','text/html','text/plain','text/xml','application/xml','application/octet-stream'].includes(value.contentType)?value.contentType:null;
  if(Object.hasOwn(value,'server'))r.server=diagnosticText(value.server,80,secrets);
  if(Object.hasOwn(value,'cfRay')){const ray=diagnosticText(value.cfRay,48,secrets);r.cfRay=typeof ray==='string'&&/^[a-fA-F0-9]{8,32}(?:-[A-Za-z0-9]{2,12})?$/.test(ray)?ray:null;}
  if(value.body&&typeof value.body==='object'){
    const b=value.body,format=['JSON','HTML','TEXT','EMPTY','UNAVAILABLE','UNREADABLE'].includes(b.format)?b.format:'UNREADABLE';
    r.body={format,bytesRead:Number.isSafeInteger(b.bytesRead)&&b.bytesRead>=0&&b.bytesRead<=ERROR_BODY_LIMIT?b.bytesRead:0,truncated:b.truncated===true,hashScope:['RESPONSE_BYTES_SHA256_V1','RESPONSE_PREFIX_SHA256_V1'].includes(b.hashScope)?b.hashScope:null,rawSha256:typeof b.rawSha256==='string'&&/^[a-f0-9]{64}$/.test(b.rawSha256)?b.rawSha256:null};
    if(format==='JSON'){const code=diagnosticText(b.code,64,secrets);r.body.code=typeof code==='string'&&/^[A-Za-z0-9_.-]{1,64}$/.test(code)?code:null;r.body.message=diagnosticText(b.message,240,secrets);}
    if(format==='HTML')r.body.title=diagnosticText(b.title,160,secrets);
  }
  return r;
}
async function boundedErrorBody(response,secrets){
  let reader,timer,truncated=false,failed=false,size=0;const parts=[];
  try{
    const stream=response.body;
    if(!stream?.getReader)return {format:stream===null?'EMPTY':'UNAVAILABLE',bytesRead:0,truncated:false,hashScope:stream===null?'RESPONSE_BYTES_SHA256_V1':null,rawSha256:stream===null?hash(''):null};
    reader=stream.getReader();let chunks=0;
    const read=async()=>{while(true){const part=await reader.read();if(part.done)break;const piece=part.value.subarray(0,ERROR_BODY_LIMIT-size);parts.push(piece);size+=piece.byteLength;if(size>=ERROR_BODY_LIMIT||++chunks>=128){truncated=true;reader.cancel().catch(()=>{});break;}}};
    await Promise.race([read(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('DIAGNOSTIC_READ_TIMEOUT')),2000);})]);
  }catch{failed=true;truncated=true;try{reader?.cancel()?.catch(()=>{});}catch{}}
  finally{clearTimeout(timer);}
  const bytes=new Uint8Array(size);let offset=0;for(const p of parts){bytes.set(p,offset);offset+=p.byteLength;}
  if(failed)return {format:'UNREADABLE',bytesRead:size,truncated:true,hashScope:size?'RESPONSE_PREFIX_SHA256_V1':null,rawSha256:size?Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join(''):null};
  const rawSha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join(''),text=new TextDecoder().decode(bytes).trim(),body={format:bytes.length?'TEXT':'EMPTY',bytesRead:bytes.length,truncated,hashScope:truncated?'RESPONSE_PREFIX_SHA256_V1':'RESPONSE_BYTES_SHA256_V1',rawSha256};
  if(!truncated&&text.startsWith('{'))try{const parsed=JSON.parse(text);body.format='JSON';body.code=String(parsed?.code??parsed?.msg_cd??'');body.message=diagnosticText(parsed?.msg??parsed?.msg1??parsed?.message,240,secrets);return body;}catch{}
  if(/^<!doctype\s+html|^<html\b|<title\b/i.test(text)){body.format='HTML';body.title=diagnosticText(text.match(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i)?.[1],160,secrets);}
  return body;
}
async function request(url,{fetchImpl,headers={},clock,provider,format='json',encoding='utf-8'}) {
  const requestedAt=iso(clock()); let response;
  try { response=await fetchImpl(url.href,{method:'GET',headers:{Accept:'application/json',...headers},cache:'no-store',redirect:'manual',signal:AbortSignal.timeout(12000)}); }
  catch { throw new InstrumentMarketError('MARKET_NETWORK_ERROR','시세 공급원 연결을 확인하세요.',{provider,host:url.host,path:url.pathname,requestedAt,receivedAt:iso(clock())}); }
  const receivedAt=iso(clock());check(Date.parse(receivedAt)>=Date.parse(requestedAt),'MARKET_CLOCK_REWIND','수집 시각의 순서를 확인하세요.');
  check(!response.url||new URL(response.url).origin===url.origin,'MARKET_SOURCE_ORIGIN','공식 시세 공급원 주소를 확인하세요.');
  if (!response.ok){
    const secrets=Object.entries(headers).filter(([name])=>/authorization|key|secret|token/i.test(name)).flatMap(([,value])=>typeof value==='string'?[value,value.replace(/^Bearer\s+/i,'')]:[]);
    const diagnostic={provider,host:url.host,path:url.pathname,httpStatus:response.status,retryAfter:retryAfter(response),requestedAt,receivedAt,contentType:response.headers?.get?.('Content-Type')?.split(';')[0]?.trim()?.toLowerCase()??null,server:response.headers?.get?.('Server')??null,cfRay:response.headers?.get?.('CF-Ray')??null,body:await boundedErrorBody(response,secrets)};
    throw new InstrumentMarketError(response.status>=300&&response.status<400?'MARKET_REDIRECT_REJECTED':'MARKET_HTTP_ERROR',`시세 조회를 완료하지 못했습니다. (${response.status})`,safeInstrumentMarketDiagnostic(diagnostic,{secrets}));
  }
  let bytes;
  if(response.body?.getReader){const reader=response.body.getReader(),parts=[];let size=0;while(true){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>1000000){await reader.cancel();throw new InstrumentMarketError('MARKET_RESPONSE_SIZE','시세 응답 크기 한도를 초과했습니다.');}parts.push(part.value);}bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.byteLength;}}
  else {bytes=new TextEncoder().encode(await response.text());check(bytes.length<=1000000,'MARKET_RESPONSE_SIZE','시세 응답 크기 한도를 초과했습니다.');}
  let rawBody;try{rawBody=new TextDecoder(encoding,{fatal:true}).decode(bytes);}catch{throw new InstrumentMarketError('MARKET_TEXT_ENCODING','시세 응답 문자 인코딩을 확인하세요.');}
  let body=rawBody;if(format==='json')try{body=JSON.parse(rawBody);}catch{throw new InstrumentMarketError('MARKET_JSON_ERROR','시세 응답 JSON 형식을 확인하세요.');}
  const rawSha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),value=>value.toString(16).padStart(2,'0')).join('');
  return {body,rawBody,record:{provider,url:url.href,method:'GET',requestedAt,receivedAt,availableAt:receivedAt,encoding,rawSha256,hashContract:'RESPONSE_BYTES_SHA256_V1'}};
}
function numeric(value,{positive=true}={}) { check(typeof value==='string'&&/^\d+(?:\.\d+)?$/.test(value)&&Number.isFinite(Number(value))&&(positive?Number(value)>0:Number(value)>=0),'INVALID_CANDLE_NUMBER','캔들 가격과 거래량을 확인하세요.');return Number(value); }
function validateBars(bars,{instrument,timeframe,now,continuous=true}) {
  check(Array.isArray(bars)&&bars.length>0,'EMPTY_CANDLES','확정 캔들이 준비되지 않았습니다.');
  const times = new Set();
  for(let index=0;index<bars.length;index++) {
    const bar=bars[index],open=Date.parse(bar.openTime),close=Date.parse(bar.closeTime),previous=bars[index-1];
    check(Number.isSafeInteger(open)&&Number.isSafeInteger(close)&&open<close&&close<=now&&bar.isClosed===true&&!times.has(open),'INVALID_CANDLE_TIME','캔들 확정 시각과 중복 여부를 확인하세요.');times.add(open);
    check(['open','high','low','close'].every(key=>Number.isFinite(bar[key])&&bar[key]>0)&&Number.isFinite(bar.volume)&&bar.volume>=0&&bar.high>=Math.max(bar.open,bar.close,bar.low)&&bar.low<=Math.min(bar.open,bar.close,bar.high),'INVALID_CANDLE_OHLCV','캔들 가격 관계와 거래량을 확인하세요.');
    check(!previous||Date.parse(previous.openTime)<open,'CANDLE_ORDER','캔들 시간 순서를 확인하세요.');
    if(continuous){check(open%STEPS[timeframe]===0&&close-open===STEPS[timeframe],'INVALID_CANDLE_ALIGNMENT','UTC 캔들 구간을 확인하세요.');check(!previous||Date.parse(previous.closeTime)===open,'CANDLE_GAP','연속 거래 캔들의 누락을 확인하세요.');}
    else check(bar.tradeDate&&bar.timeBasis==='LOCAL_CALENDAR_DAY_BUCKET'&&instrument.assetClass==='equity','INVALID_STOCK_CANDLE','주식 일봉의 거래일과 시간 기준을 확인하세요.');
  }
  return bars;
}
function result(instrument,timeframe,bars,source,now,warnings=[],extra={}) {
  const last=bars.at(-1),ageMs=now-Date.parse(last.closeTime),crypto=instrument.assetClass==='crypto';
  const requiredLatestCloseAt=crypto?iso(Math.floor(now/STEPS[timeframe])*STEPS[timeframe]):null;
  const freshness=crypto?(last.closeTime===requiredLatestCloseAt?'CLOSED_BAR':'STALE'):'END_OF_DAY';
  return {schemaVersion:1,version:INSTRUMENT_MARKET_VERSION,status:freshness==='STALE'?'DATA_REQUIRED':'READY',instrument,timeframe,bars,quote:{price:last.close,currency:instrument.quoteCurrency,asOf:last.closeTime,receivedAt:source.receivedAt,ageMs,freshness,priceBasis:'LAST_CLOSED_CANDLE',executionAllowed:false},source:{...source,asOf:last.closeTime,barsSha256:hash(bars),instrumentId:instrument.id,timeframe,barCount:bars.length,firstBarCloseAt:bars[0].closeTime,lastBarCloseAt:last.closeTime,...(crypto?{requiredLatestCloseAt,freshnessPolicy:'EXACT_LATEST_CONFIRMED_BOUNDARY_V1'}:{}),...extra},warnings:[...warnings,...(freshness==='STALE'?['STALE_CLOSED_CANDLE']:[])]};
}
const blocked=(instrument,timeframe,status,warnings,extra={})=>({schemaVersion:1,version:INSTRUMENT_MARKET_VERSION,status,instrument,timeframe,bars:[],quote:null,source:null,warnings,...extra});
async function okxMarket(instrument,timeframe,limit,options) {
  // The product consumes confirmed history. Use one history request as the
  // primary route, with the same strict latest-boundary validation below.
  // A provider failure stops this lookup; there is no route or host failover.
  const rows=[],records=[];let after=null;
  for(let page=0;page<4&&rows.length<limit+1;page++){
   const url=new URL('/api/v5/market/history-candles',OKX_ORIGIN);url.search=new URLSearchParams({instId:instrument.symbol,bar:timeframe==='1d'?'1Dutc':timeframe.toUpperCase(),limit:String(Math.min(limit+1-rows.length,300)),...(after?{after}:{})});
   const {body,record}=await request(url,{...options,provider:'okx'});check(body?.code==='0'&&Array.isArray(body.data)&&body.data.length<=300,'MARKET_PROVIDER_RESPONSE','OKX 응답 코드와 캔들을 확인하세요.');
   records.push(record);if(!body.data.length)break;rows.push(...body.data);after=String(body.data.at(-1)?.[0]);
   if(limit<=299)break;
  }
  const readAt=options.clock(),bars=[];let prior=null,excludedUnclosed=0;
  for(const row of rows){check(Array.isArray(row)&&row.length===9&&typeof row[0]==='string'&&/^\d{1,16}$/.test(row[0])&&['0','1'].includes(row[8]),'INVALID_CANDLE_ROW','OKX 캔들 필드와 확정 상태를 확인하세요.');const open=Number(row[0]);check(Number.isSafeInteger(open)&&(prior===null||open<prior),'CANDLE_ORDER','OKX 중복·역순 캔들을 확인하세요.');prior=open;
    check(open<=readAt,'FUTURE_CANDLE','미래 캔들 시작 시각을 확인하세요.');if(row[8]==='0'){check(open+STEPS[timeframe]>readAt,'UNCLOSED_HISTORICAL_CANDLE','과거 구간에 미확정 캔들이 있습니다.');excludedUnclosed++;continue;}
    bars.push({openTime:iso(open),closeTime:iso(open+STEPS[timeframe]),open:numeric(row[1]),high:numeric(row[2]),low:numeric(row[3]),close:numeric(row[4]),volume:numeric(row[5],{positive:false}),isClosed:true});
  }
  bars.reverse();validateBars(bars,{instrument,timeframe,now:readAt});
  const record=records.length===1?records[0]:{...records[0],receivedAt:records.at(-1).receivedAt,availableAt:records.at(-1).availableAt,hashContract:'ORDERED_RESPONSE_REFS_SHA256_V1',captureSha256:hash(records),captures:records};
  return result(instrument,timeframe,bars.slice(-limit),record,readAt,[],{dataOrigin:'PUBLIC_API',requestedLimit:limit,providerRequestedLimit:Math.min(limit+1,300),excludedUnclosed,continuity:'CONTINUOUS_UTC',volumeUnit:instrument.baseAsset});
}
function parseUpbitPage(body,{instrument,timeframe,count,to,seen,now}){
  const bars=[],step=STEPS[timeframe];let previous=null,oldest=null,excludedUnclosed=0;
  check(Array.isArray(body)&&body.length<=count,'MARKET_PROVIDER_RESPONSE','업비트 캔들 응답과 요청 개수를 확인하세요.');
  for(const row of body){
    check(row&&row.market===instrument.symbol&&typeof row.candle_date_time_utc==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(row.candle_date_time_utc),'INVALID_CANDLE_ROW','업비트 정식 페어와 UTC 캔들 시각을 확인하세요.');
    const open=Date.parse(row.candle_date_time_utc+'Z');check(Number.isSafeInteger(open)&&iso(open).slice(0,19)===row.candle_date_time_utc&&(previous===null||open<previous)&&!seen.has(open)&&(!to||open<Date.parse(to)),'CANDLE_ORDER','업비트 캔들의 중복·시간 순서를 확인하세요.');seen.add(open);previous=open;oldest=open;
    check(open<=now,'FUTURE_CANDLE','미래 캔들 시작 시각을 확인하세요.');
    if(timeframe!=='1d')check(row.unit===(UPBIT_MINUTE_UNITS[timeframe]),'INVALID_CANDLE_ALIGNMENT','업비트 요청 봉 간격과 원본 단위를 확인하세요.');
    check(['opening_price','high_price','low_price','trade_price'].every(k=>typeof row[k]==='number'&&Number.isFinite(row[k])&&row[k]>0)&&typeof row.candle_acc_trade_volume==='number'&&Number.isFinite(row.candle_acc_trade_volume)&&row.candle_acc_trade_volume>=0,'INVALID_CANDLE_NUMBER','업비트 원본 가격과 거래량을 확인하세요.');
    // A no-trade interval is absent in the provider source and remains absent.
    if(open+step>now){excludedUnclosed++;continue;}
    bars.push({openTime:iso(open),closeTime:iso(open+step),open:row.opening_price,high:row.high_price,low:row.low_price,close:row.trade_price,volume:row.candle_acc_trade_volume,isClosed:true});
  }
  return {bars,oldest,excludedUnclosed};
}
function upbitResult(instrument,timeframe,limit,captures,now){
  check(Array.isArray(captures)&&captures.length>0&&captures.length<=5,'UPBIT_CAPTURE_REQUIRED','업비트 시세의 수집 원문과 페이지 범위를 확인하세요.');
  const bars=[],records=[],seen=new Set();let to=null,excludedUnclosed=0,ended=false;
  for(const [page,capture]of captures.entries()){
    const {rawBody,...record}=capture,url=new URL(record.url),expectedPath=timeframe==='1d'?'/v1/candles/days':`/v1/candles/minutes/${UPBIT_MINUTE_UNITS[timeframe]}`,count=Math.min(200,limit-bars.length+(page===0?1:0));
    check(!ended&&bars.length<limit&&url.origin===UPBIT_ORIGIN&&url.pathname===expectedPath&&url.searchParams.get('market')===instrument.symbol&&url.searchParams.get('count')===String(count)&&url.searchParams.get('to')===to&&[...url.searchParams.keys()].length===(to?3:2),'UPBIT_CAPTURE_SCOPE','원문 요청의 거래쌍·봉 간격·페이지 순서를 대조하세요.');
    check(record.provider==='upbit'&&record.method==='GET'&&record.encoding==='utf-8'&&record.hashContract==='RESPONSE_BYTES_SHA256_V1'&&typeof rawBody==='string'&&hash(rawBody)===record.rawSha256&&[record.requestedAt,record.receivedAt,record.availableAt].every(v=>typeof v==='string'&&Number.isFinite(Date.parse(v))&&iso(Date.parse(v))===v)&&record.requestedAt<=record.receivedAt&&record.receivedAt===record.availableAt&&Date.parse(record.availableAt)<=now&&(!page||records.at(-1).receivedAt<=record.requestedAt),'UPBIT_CAPTURE_INTEGRITY','수집 원문 해시와 요청·수신 시점을 대조하세요.');
    let body;try{body=JSON.parse(rawBody);}catch{throw new InstrumentMarketError('MARKET_JSON_ERROR','시세 응답 JSON 형식을 확인하세요.');}
    const parsed=parseUpbitPage(body,{instrument,timeframe,count,to,seen,now:Date.parse(record.receivedAt)});bars.push(...parsed.bars);excludedUnclosed+=parsed.excludedUnclosed;records.push(record);ended=!body.length||body.length<count;to=parsed.oldest===null?null:iso(parsed.oldest);
  }
  bars.sort((a,b)=>a.openTime.localeCompare(b.openTime));validateBars(bars,{instrument,timeframe,now});
  const source=records.length===1?records[0]:{provider:'upbit',method:'GET',url:records[0].url,requestedAt:records[0].requestedAt,receivedAt:records.at(-1).receivedAt,availableAt:records.at(-1).availableAt,hashContract:'ORDERED_RESPONSE_REFS_SHA256_V1',captureSha256:hash(records.map(r=>({url:r.url,rawSha256:r.rawSha256}))),captures:records};
  return result(instrument,timeframe,bars.slice(-limit),source,now,[],{dataOrigin:'PUBLIC_API',requestedLimit:limit,providerRequestedLimits:records.map(r=>Number(new URL(r.url).searchParams.get('count'))),excludedUnclosed,continuity:'CONTINUOUS_UTC',volumeUnit:instrument.baseAsset,paginationPolicy:'UPBIT_EXCLUSIVE_TO_MAX5_PAGES_V2',rawCaptureSha256:hash(captures)});
}
/** Replay original public bytes before a canonical strategy consumes BTC-quoted data. */
export function verifyUpbitMarketCapture(market,{now}={}){
  const instrument=getInstrument(market?.instrument?.id),time=readClock(now)();
  check(instrument.provider==='upbit'&&market.timeframe in STEPS&&Number.isInteger(market.source?.requestedLimit)&&market.source.requestedLimit>=1&&market.source.requestedLimit<=999,'UPBIT_CAPTURE_SCOPE','업비트 원본 종목과 조회 범위를 확인하세요.');
  const replay=upbitResult(instrument,market.timeframe,market.source.requestedLimit,market.rawCaptures,time);
  check(market.instrument.symbol===instrument.symbol&&market.instrument.provider===instrument.provider&&market.instrument.assetClass===instrument.assetClass&&market.instrument.quoteCurrency===instrument.quoteCurrency&&market.status===replay.status&&hash(market.bars)===hash(replay.bars)&&Object.entries(replay.source).every(([key,value])=>Object.hasOwn(market.source,key)&&hash(value)===hash(market.source[key]))&&['price','currency','asOf','receivedAt','freshness','priceBasis','executionAllowed'].every(key=>market.quote?.[key]===replay.quote[key]),'UPBIT_PROJECTION_MISMATCH','확정 봉을 원문 수집 페이지와 대조하세요.');
  return replay;
}
async function upbitMarket(instrument,timeframe,limit,options){
  const bars=[],captures=[],seen=new Set();let to=null;
  for(let page=0;page<5&&bars.length<limit;page++){
    const count=Math.min(200,limit-bars.length+(page===0?1:0)),url=new URL(timeframe==='1d'?'/v1/candles/days':`/v1/candles/minutes/${UPBIT_MINUTE_UNITS[timeframe]}`,UPBIT_ORIGIN);
    url.search=new URLSearchParams({market:instrument.symbol,count:String(count),...(to?{to}:{})});
    const {body,rawBody,record}=await request(url,{...options,provider:'upbit'});captures.push({...record,rawBody});
    const parsed=parseUpbitPage(body,{instrument,timeframe,count,to,seen,now:Date.parse(record.receivedAt)});bars.push(...parsed.bars);
    if(!body.length||body.length<count)break;to=parsed.oldest===null?null:iso(parsed.oldest);
  }
  return {...upbitResult(instrument,timeframe,limit,captures,options.clock()),rawCaptures:captures};
}
function localDate(at,timezone){const parts=new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(at);return ['year','month','day'].map(key=>parts.find(part=>part.type===key).value).join('-');}
function midnight(day,timezone) { const target=Date.parse(day+'T00:00:00.000Z');let stamp=target;for(let i=0;i<3;i++){const parts=new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(stamp),get=key=>parts.find(part=>part.type===key).value;const local=Date.parse(`${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:${get('second')}.000Z`);stamp+=target-local;}return stamp; }
function tradeDay(value){check(typeof value==='string'&&/^\d{8}$/.test(value),'INVALID_TRADE_DATE','주식 거래일을 확인하세요.');const day=`${value.slice(0,4)}-${value.slice(4,6)}-${value.slice(6,8)}`,date=new Date(day+'T00:00:00.000Z');check(Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===day&&![0,6].includes(date.getUTCDay()),'INVALID_TRADE_DATE','주식 거래일을 확인하세요.');return day;}
async function kisMarket(instrument,timeframe,limit,options) {
  const {env}=options,required=['KIS_APP_KEY','KIS_APP_SECRET','KIS_ACCESS_TOKEN'];
  if(required.some(key=>typeof env[key]!=='string'||!env[key].trim()))return instrument.quoteCurrency==='KRW'?naverReference(instrument,timeframe,limit,options):blocked(instrument,timeframe,'CONNECT_REQUIRED',['KIS_READONLY_CONNECTION_REQUIRED'],{connection:{provider:'kis',requiredEnvironment:required,capabilities:['daily-candles'],executionAllowed:false}});
  const korea=instrument.quoteCurrency==='KRW',now=options.clock(),day=localDate(now,instrument.timezone).replaceAll('-','');
  const url=new URL(korea?'/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice':'/uapi/overseas-price/v1/quotations/dailyprice',KIS_ORIGIN);
  url.search=new URLSearchParams(korea?{FID_COND_MRKT_DIV_CODE:'J',FID_INPUT_ISCD:instrument.symbol,FID_INPUT_DATE_1:iso(now-(Math.min(limit,100)*2+30)*86400000).slice(0,10).replaceAll('-',''),FID_INPUT_DATE_2:day,FID_PERIOD_DIV_CODE:'D',FID_ORG_ADJ_PRC:'1'}:{AUTH:'',EXCD:instrument.kisExchangeCode,SYMB:instrument.symbol,GUBN:'0',BYMD:day,MODP:'0'});
  const {body,record}=await request(url,{...options,provider:'kis',headers:{authorization:`Bearer ${env.KIS_ACCESS_TOKEN}`,appkey:env.KIS_APP_KEY,appsecret:env.KIS_APP_SECRET,tr_id:korea?'FHKST03010100':'HHDFS76240000',custtype:'P'}});
  check(body?.rt_cd==='0'&&Array.isArray(body.output2)&&body.output2.length<=1000,'MARKET_PROVIDER_RESPONSE','한국투자 시세 응답 코드와 일봉을 확인하세요.');
  const bars=[],seen=new Set();let excludedUnclosed=0,previousDay=null;
  for(const row of body.output2){if(!row||!(korea?row.stck_bsop_date:row.xymd))continue;const date=tradeDay(korea?row.stck_bsop_date:row.xymd);check(!seen.has(date)&&(!previousDay||date<previousDay),'CANDLE_ORDER','주식 일봉의 중복·시간 순서를 확인하세요.');seen.add(date);previousDay=date;
    const open=midnight(date,instrument.timezone),nextDate=iso(Date.parse(date+'T00:00:00.000Z')+86400000).slice(0,10),close=midnight(nextDate,instrument.timezone);
    check(open<=now,'FUTURE_CANDLE','미래 거래일 캔들이 반환됐습니다.');if(close>now){excludedUnclosed++;continue;}
    bars.push({openTime:iso(open),closeTime:iso(close),tradeDate:date,timeBasis:'LOCAL_CALENDAR_DAY_BUCKET',open:numeric(korea?row.stck_oprc:row.open),high:numeric(korea?row.stck_hgpr:row.high),low:numeric(korea?row.stck_lwpr:row.low),close:numeric(korea?row.stck_clpr:row.clos),volume:numeric(korea?row.acml_vol:row.tvol,{positive:false}),isClosed:true});
  }
  bars.reverse();const readAt=options.clock();validateBars(bars,{instrument,timeframe,now:readAt,continuous:false});
  return result(instrument,timeframe,bars.slice(-Math.min(limit,100)),record,readAt,['END_OF_DAY_REFERENCE','SESSION_CALENDAR_UNVERIFIED','CORPORATE_ACTION_ADJUSTMENT_REQUIRED',...(limit>100?['PROVIDER_SINGLE_PAGE_LIMIT_100']:[])],{dataOrigin:'AUTHENTICATED_API',excludedUnclosed,adjustment:'UNADJUSTED',continuity:'EXCHANGE_TRADING_DATES',timeBasis:'LOCAL_CALENDAR_DAY_BUCKET',volumeUnit:'SHARES'});
}
async function naverReference(instrument,timeframe,limit,options) {
  const url=new URL('https://fchart.stock.naver.com/sise.nhn');url.search=new URLSearchParams({symbol:instrument.symbol,timeframe:'day',count:String(limit+1),requestType:'0'});
  const {body,record}=await request(url,{...options,provider:'naver-reference',format:'text',encoding:'euc-kr'});
  check(typeof body==='string'&&!/<!DOCTYPE|<!ENTITY/i.test(body)&&new RegExp(`<chartdata\\s[^>]*symbol=["']${instrument.symbol}["']`).test(body),'MARKET_PROVIDER_RESPONSE','네이버 차트 원본의 종목과 형식을 확인하세요.');
  const records=[...body.matchAll(/<item\s+data=["']([^"']+)["']\s*\/?\s*>/g)];check(records.length>0&&records.length<=limit+1,'INVALID_CANDLE_ROW','네이버 일봉의 행 수를 확인하세요.');
  const bars=[],now=options.clock();let previousDay=null,excludedUnclosed=0;
  for(const match of records){const values=match[1].split('|');check(values.length===6,'INVALID_CANDLE_ROW','네이버 일봉 필드를 확인하세요.');const day=tradeDay(values[0]);check(!previousDay||day>previousDay,'CANDLE_ORDER','네이버 일봉의 중복·시간 순서를 확인하세요.');previousDay=day;
    const open=midnight(day,instrument.timezone),nextDay=iso(Date.parse(day+'T00:00:00.000Z')+86400000).slice(0,10),close=midnight(nextDay,instrument.timezone);check(open<=now,'FUTURE_CANDLE','미래 거래일 캔들이 반환됐습니다.');if(close>now){excludedUnclosed++;continue;}
    bars.push({openTime:iso(open),closeTime:iso(close),tradeDate:day,timeBasis:'LOCAL_CALENDAR_DAY_BUCKET',open:numeric(values[1]),high:numeric(values[2]),low:numeric(values[3]),close:numeric(values[4]),volume:numeric(values[5],{positive:false}),isClosed:true});
  }
  validateBars(bars,{instrument,timeframe,now,continuous:false});
  return result(instrument,timeframe,bars.slice(-limit),record,now,['END_OF_DAY_REFERENCE','SESSION_CALENDAR_UNVERIFIED','ADJUSTMENT_POLICY_UNVERIFIED','PUBLIC_REFERENCE_REDISTRIBUTION_RIGHTS_UNVERIFIED','KIS_READONLY_CONNECTION_OPTIONAL'],{dataOrigin:'PUBLIC_REFERENCE',excludedUnclosed,adjustment:'PROVIDER_POLICY_UNVERIFIED',continuity:'EXCHANGE_TRADING_DATES',timeBasis:'LOCAL_CALENDAR_DAY_BUCKET',volumeUnit:'SHARES',displaySourceUrl:`https://finance.naver.com/item/fchart.naver?code=${instrument.symbol}`,use:'PERSONAL_RESEARCH_REFERENCE'});
}
export async function loadInstrumentMarket({instrumentId,timeframe='4h',limit=240,fetchImpl=fetch,env={},now,universeResolution}={}) {
  const instrument=getInstrument(instrumentId,{resolution:universeResolution});check(Number.isInteger(limit)&&limit>=1&&limit<=(instrument.assetClass==='crypto'?999:299)&&typeof fetchImpl==='function','INVALID_MARKET_OPTIONS','캔들 조회 개수와 연결을 확인하세요.');
  if(!instrument.timeframes.includes(timeframe))return blocked(instrument,timeframe,'UNSUPPORTED_TIMEFRAME',[`SUPPORTED_TIMEFRAMES:${instrument.timeframes.join(',')}`]);
  const options={fetchImpl,env,clock:readClock(now)};return instrument.assetClass==='crypto'?(instrument.provider==='upbit'?upbitMarket(instrument,timeframe,limit,options):okxMarket(instrument,timeframe,limit,options)):kisMarket(instrument,timeframe,limit,options);
}
export { InstrumentError };
