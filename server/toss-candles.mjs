import {getInstrument} from '../dist/domain/instruments.mjs';
import {researchSha256} from '../dist/domain/research.mjs';
import {InstrumentMarketError} from './instrument-market.mjs';
import {withTossReadConnection,tossReadConnectionStatus} from './broker-accounts.mjs';

export const TOSS_CANDLE_POLICY='TOSS_CONFIRMED_OHLCV_V1';
export const TOSS_CANDLE_RANGE_POLICY='FULLY_CONTAINED_BARS_V1';
const ORIGIN='https://openapi.tossinvest.com',DAY=86400000,MINUTE=60000;
const hash=value=>researchSha256(typeof value==='string'?value:JSON.stringify(value)),iso=value=>new Date(value).toISOString();
const check=(ok,code,message)=>{if(!ok)throw new InstrumentMarketError(code,message);};
const nowOf=now=>{const value=typeof now==='function'?now():now??Date.now();const n=typeof value==='number'?value:Date.parse(value);check(Number.isSafeInteger(n)&&n>0,'INVALID_MARKET_TIME','시세 조회 시각을 확인하세요.');return n;};
const validStamp=value=>typeof value==='string'&&Number.isFinite(Date.parse(value));
const dayAt=(at,zone)=>{const parts=new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(at);return ['year','month','day'].map(k=>parts.find(p=>p.type===k).value).join('-');};
function midnight(day,zone){const desired=Date.parse(day+'T00:00:00Z');let value=desired;for(let i=0;i<3;i++){const parts=new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(value),get=k=>parts.find(p=>p.type===k).value;value+=desired-Date.parse(`${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:${get('second')}Z`);}return value;}
function decimal(value,positive=true){check(typeof value==='string'&&/^\d+(?:\.\d+)?$/.test(value)&&value.length<=30&&Number.isFinite(Number(value))&&(positive?Number(value)>0:Number(value)>=0),'INVALID_CANDLE_NUMBER','시세 원본의 가격과 거래량을 확인하세요.');return Number(value);}
function normalizeRow(row,instrument,timeframe,now){
 check(row&&validStamp(row.timestamp)&&row.currency===instrument.quoteCurrency,'INVALID_CANDLE_ROW','종목 시세의 시각과 통화를 확인하세요.');
 const stamp=Date.parse(row.timestamp),tradeDate=dayAt(stamp,instrument.timezone),open=timeframe==='1m'?stamp-MINUTE:midnight(tradeDate,instrument.timezone),close=timeframe==='1m'?stamp:midnight(iso(Date.parse(tradeDate+'T00:00:00Z')+DAY).slice(0,10),instrument.timezone);
 check(timeframe==='1m'?stamp%MINUTE===0:stamp===open,'INVALID_CANDLE_ALIGNMENT','공급자가 반환한 봉 기준 시각을 확인하세요.');
 check(open<=now,'FUTURE_CANDLE','미래 거래일의 시세가 반환되었습니다.');
 const bar={openTime:iso(open),closeTime:iso(close),...(timeframe==='1d'?{tradeDate,timeBasis:'LOCAL_CALENDAR_DAY_BUCKET'}:{}),open:decimal(row.openPrice),high:decimal(row.highPrice),low:decimal(row.lowPrice),close:decimal(row.closePrice),volume:decimal(row.volume,false),isClosed:true};
 check(bar.high>=Math.max(bar.open,bar.close,bar.low)&&bar.low<=Math.min(bar.open,bar.close,bar.high),'INVALID_CANDLE_OHLCV','시세 원본의 고가·저가 관계를 확인하세요.');
 return {bar,stamp,closed:close<=now};
}
function queryOptions(options){
 const instrument=options.instrument??getInstrument(options.instrumentId,{resolution:options.universeResolution,snapshot:options.universeSnapshot}),timeframe=options.timeframe??'1d',limit=options.limit??240,startAt=options.startAt??null,endAt=options.endAt??null,adjusted=options.adjusted??true;
 check(instrument.assetClass==='equity'&&['1d','1m'].includes(timeframe)&&Number.isInteger(limit)&&limit>=1&&limit<=10000&&typeof adjusted==='boolean','INVALID_MARKET_OPTIONS','주식 종목·봉 주기·조회 범위를 확인하세요.');
 check((startAt===null||validStamp(startAt))&&(endAt===null||validStamp(endAt))&&(!startAt||endAt&&Date.parse(startAt)<Date.parse(endAt)),'INVALID_MARKET_RANGE','과거 시세의 시작과 종료 시각을 확인하세요.');
 return {instrument,timeframe,limit,startAt:startAt?iso(startAt):null,endAt:endAt?iso(endAt):null,adjusted};
}
async function readPage(url,{accessToken,fetchImpl,now}){
 const requestedAt=iso(nowOf(now));let response;
 try{response=await fetchImpl(url.href,{method:'GET',headers:{Accept:'application/json',Authorization:'Bearer '+accessToken},cache:'no-store',redirect:'manual',signal:AbortSignal.timeout(15000)});}catch{throw new InstrumentMarketError('MARKET_NETWORK_ERROR','토스증권 시세 연결을 확인하세요.');}
 const receivedAt=iso(nowOf(now));check(receivedAt>=requestedAt,'MARKET_CLOCK_REWIND','시세 수집 시각을 확인하세요.');check(!response.url||new URL(response.url).origin===ORIGIN,'MARKET_SOURCE_ORIGIN','토스증권 공식 시세 주소를 확인하세요.');
 const numericHeader=name=>{const value=response.headers?.get?.(name);return /^\d{1,10}$/.test(value??'')?Number(value):null;};
 const rateLimit={group:'MARKET_DATA_CHART',limit:numericHeader('X-RateLimit-Limit'),remaining:numericHeader('X-RateLimit-Remaining'),reset:numericHeader('X-RateLimit-Reset')};
 if(!response.ok)throw new InstrumentMarketError('MARKET_HTTP_ERROR',response.status===429?'토스증권 시세 조회 한도에 도달했습니다. 잠시 후 다시 조회하세요.':`토스증권 시세 조회를 완료하지 못했습니다. (${response.status})`,{provider:'toss',host:'openapi.tossinvest.com',path:url.pathname,httpStatus:response.status,requestedAt,receivedAt,retryAfter:numericHeader('Retry-After')===null?null:String(numericHeader('Retry-After'))});
 const reader=response.body?.getReader();let rawBody;
 if(reader){const chunks=[];let size=0;for(;;){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>1000000){await reader.cancel();throw new InstrumentMarketError('MARKET_RESPONSE_SIZE','시세 원본 크기 한도를 확인하세요.');}chunks.push(part.value);}const bytes=new Uint8Array(size);let at=0;for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.byteLength;}rawBody=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}else rawBody=await response.text();
 check(new TextEncoder().encode(rawBody).length<=1000000,'MARKET_RESPONSE_SIZE','시세 원본 크기 한도를 확인하세요.');let body;try{body=JSON.parse(rawBody);}catch{throw new InstrumentMarketError('MARKET_JSON_ERROR','토스증권 시세 응답 형식을 확인하세요.');}
 return {body,record:{provider:'toss',url:url.href,method:'GET',requestedAt,receivedAt,availableAt:receivedAt,rawSha256:hash(rawBody),rawBody,hashContract:'RESPONSE_UTF8_SHA256_V1',rateLimit}};
}
/** Official daily bars and minute bars retain their distinct timestamp contracts. */
export async function collectTossCandles(options={}){
 const {instrument,timeframe,limit,startAt,endAt,adjusted}=queryOptions(options),{accessToken,fetchImpl=fetch,now,sleep=ms=>new Promise(r=>setTimeout(r,ms))}=options;
 check(typeof accessToken==='string'&&accessToken.length>0,'TOSS_READONLY_CONNECTION_REQUIRED','토스증권 연결을 설정하세요.');
 const readAt=nowOf(now);check(!endAt||Date.parse(endAt)<=readAt,'INVALID_MARKET_RANGE','현재까지 확정된 구간을 선택하세요.');
 const records=[],bars=[],seen=new Map(),seenCursors=new Set();let before=endAt,excludedUnclosed=0,overlapCount=0,exhausted=false,lowerBoundReached=false;
 // At most 51 pages for the bounded 10,000-row history contract.
 for(let page=0;page<51;page++){
  if(page){const previous=records.at(-1).rateLimit;await sleep(previous.remaining===0?Math.max(1050,(previous.reset??1)*1000+10):Math.max(210,previous.limit?Math.ceil(1000/previous.limit)+10:210));}
  const count=Math.min(200,Math.max(2,limit-bars.length+1)),url=new URL('/api/v1/candles',ORIGIN);url.search=new URLSearchParams({symbol:instrument.providerSymbol??instrument.symbol,interval:timeframe,count:String(count),adjusted:String(adjusted),...(before?{before}:{})});
  const {body,record}=await readPage(url,{accessToken,fetchImpl,now});records.push(record);
  const result=body?.result;check(result&&Array.isArray(result.candles)&&result.candles.length<=count&&(result.nextBefore===null||result.nextBefore===undefined||validStamp(result.nextBefore)),'MARKET_PROVIDER_RESPONSE','토스증권 캔들 응답과 다음 페이지 시각을 확인하세요.');
  let previous=null,newRows=0,lastStamp=null;
  for(const row of result.candles){const value=normalizeRow(row,instrument,timeframe,nowOf(now));check(previous===null||value.stamp<previous,'CANDLE_ORDER','시세 원본의 시간 순서를 확인하세요.');previous=value.stamp;lastStamp=value.stamp;check(!before||value.stamp<=Date.parse(before),'CANDLE_PAGE_BOUNDARY','과거 시세 페이지의 상한을 확인하세요.');
   const identity=hash(row);if(seen.has(value.stamp)){check(seen.get(value.stamp)===identity,'CANDLE_PAGE_CHANGED','조회 중 과거 시세가 변경되었습니다. 다시 조회하세요.');overlapCount++;continue;}seen.set(value.stamp,identity);newRows++;
   if(!value.closed){excludedUnclosed++;continue;}
   if(endAt&&Date.parse(value.bar.closeTime)>Date.parse(endAt))continue;
   if(startAt&&Date.parse(value.bar.openTime)<Date.parse(startAt)){lowerBoundReached=true;continue;}
   bars.push(value.bar);
  }
  if(!result.nextBefore||!result.candles.length){exhausted=true;break;}
  if(lowerBoundReached||bars.length>=limit)break;
  const cursor=result.nextBefore,cursorKey=iso(cursor);check(lastStamp!==null&&Date.parse(cursor)<=lastStamp&&!seenCursors.has(cursorKey)&&(before===null||Date.parse(cursor)<Date.parse(before))&&newRows>0,'CANDLE_PAGINATION_STALLED','과거 시세 페이지가 진행되지 않았습니다.');seenCursors.add(cursorKey);before=cursor;
 }
 bars.sort((a,b)=>a.openTime.localeCompare(b.openTime));const selected=bars.slice(-limit),receivedAt=records.at(-1).receivedAt,sourceRefs=records.map(({rawBody,...record})=>record),last=selected.at(-1),asOf=last?.closeTime??null;
 const coverage={rangePolicy:TOSS_CANDLE_RANGE_POLICY,requestedStartAt:startAt,requestedEndAt:endAt,firstBarCloseAt:selected[0]?.closeTime??null,lastBarCloseAt:asOf,lowerBoundReached,providerHistoryExhausted:exhausted,truncated:!!startAt&&!lowerBoundReached&&!exhausted,pageLimitReached:records.length===51&&!lowerBoundReached&&!exhausted&&bars.length<limit,excludedUnclosed,overlapCount};
 const source={provider:'toss',url:sourceRefs[0].url,method:'GET',requestedAt:sourceRefs[0].requestedAt,receivedAt,availableAt:receivedAt,asOf,instrumentId:instrument.id,timeframe,barCount:selected.length,barsSha256:hash(selected),captureSha256:hash(sourceRefs),hashContract:TOSS_CANDLE_POLICY,sourceRefs,dataOrigin:'AUTHENTICATED_API',adjustment:adjusted?'PROVIDER_ADJUSTED':'UNADJUSTED',adjusted,volumeUnit:'SHARES',continuity:'EXCHANGE_TRADING_DATES',timeBasis:timeframe==='1d'?'LOCAL_CALENDAR_DAY_BUCKET':'PROVIDER_MINUTE_END_EXCLUSIVE',completionPolicy:timeframe==='1d'?'NEXT_LOCAL_MIDNIGHT':'PROVIDER_END_TIMESTAMP',marketCoverage:instrument.quoteCurrency==='KRW'?'KRX_NXT_CONSOLIDATED':'PROVIDER_US_EXCHANGES',priceSession:timeframe==='1d'&&instrument.quoteCurrency==='USD'?'REGULAR_SESSION_OFFICIAL_CLOSE':'PROVIDER_SESSION',volumeSession:'PROVIDER_AGGREGATION',requestedLimit:limit,coverage};
 const market={schemaVersion:1,version:TOSS_CANDLE_POLICY,status:last?'READY':'DATA_REQUIRED',instrument,timeframe,bars:selected,quote:last?{price:last.close,currency:instrument.quoteCurrency,asOf,receivedAt,ageMs:nowOf(now)-Date.parse(asOf),freshness:timeframe==='1d'?'END_OF_DAY':'CLOSED_BAR',priceBasis:'LAST_CLOSED_CANDLE',executionAllowed:false}:null,source,warnings:[...(timeframe==='1d'?['END_OF_DAY_REFERENCE','SESSION_CALENDAR_UNVERIFIED']:[]),...(instrument.quoteCurrency==='USD'?['PROVIDER_US_EXCHANGE_COVERAGE']:[]),...(coverage.truncated?['HISTORY_ROW_LIMIT_REACHED']:[]),...(!last?['EMPTY_CANDLES']:[])],connection:{provider:'toss',supportedTimeframes:['1d'],executionAllowed:false}};
 const capture={schemaVersion:1,policy:TOSS_CANDLE_POLICY,collectedAt:receivedAt,query:{instrumentId:instrument.id,timeframe,limit,startAt,endAt,adjusted},records,market};capture.sha256=hash(capture);capture.id='toss-candles-'+capture.sha256;market.source.marketDataRef=capture.id;return capture;
}
async function initialize(db){await db.batch([db.prepare('CREATE TABLE IF NOT EXISTS market_candle_archives (owner_id TEXT NOT NULL, capture_id TEXT NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(owner_id,capture_id))').bind(),db.prepare('CREATE TABLE IF NOT EXISTS market_candle_cache (owner_id TEXT NOT NULL, cache_key TEXT NOT NULL, capture_id TEXT NOT NULL, expires_at TEXT NOT NULL, PRIMARY KEY(owner_id,cache_key))').bind()]);}
function validateCapture(capture){const {id,sha256,...body}=capture??{},market=structuredClone(body.market);if(market?.source)delete market.source.marketDataRef;check(typeof sha256==='string'&&id==='toss-candles-'+sha256&&hash({...body,market})===sha256&&capture.market.source.barsSha256===hash(capture.market.bars)&&capture.records.every(r=>r.rawSha256===hash(r.rawBody)),'CANDLE_ARCHIVE_INTEGRITY','저장된 시세 원본과 해시를 확인하세요.');return capture;}
export async function readTossCandleArchive({db,owner,captureId}){await initialize(db);const row=await db.prepare('SELECT payload FROM market_candle_archives WHERE owner_id=? AND capture_id=?').bind(owner,captureId).first();return row?validateCapture(JSON.parse(row.payload)):null;}
const inflight=new WeakMap();
const ownerQueues=new WeakMap();
async function serializeOwnerRead(db,owner,operation){let queues=ownerQueues.get(db);if(!queues){queues=new Map();ownerQueues.set(db,queues);}const previous=queues.get(owner)??Promise.resolve();const result=previous.catch(()=>{}).then(operation);queues.set(owner,result);try{return await result;}finally{if(queues.get(owner)===result)queues.delete(owner);}}
function projectLimit(market,limit,now){if(!market)return null;const bars=market.bars.slice(-limit);return {...market,bars,quote:market.quote?{...market.quote,ageMs:nowOf(now)-Date.parse(market.quote.asOf)}:null,source:{...market.source,projectedAt:iso(nowOf(now)),barCount:bars.length,captureRequestedLimit:market.source.requestedLimit,requestedLimit:limit,barsSha256:hash(bars),coverage:{...market.source.coverage,firstBarCloseAt:bars[0]?.closeTime??null}}};}
/** Owner-scoped immutable captures and a refreshable lookup index; no account balance is read. */
export async function loadOwnerTossMarket(options={}){
 const {db,owner,env,now,fetchImpl=fetch}=options;check(db?.prepare&&typeof owner==='string'&&owner,'INVALID_MARKET_OPTIONS','시세 저장소의 소유 범위를 확인하세요.');
 const q=queryOptions(options),request={instrumentId:q.instrument.id,timeframe:q.timeframe,limit:!q.startAt&&!q.endAt?Math.max(240,q.limit):q.limit,startAt:q.startAt,endAt:q.endAt,adjusted:q.adjusted},cacheKey=hash({provider:'toss',providerSymbol:q.instrument.providerSymbol??q.instrument.symbol,providerMarket:q.instrument.providerMarket??q.instrument.venue,currency:q.instrument.quoteCurrency,timezone:q.instrument.timezone,policy:TOSS_CANDLE_POLICY,rangePolicy:TOSS_CANDLE_RANGE_POLICY,...request});await initialize(db);
 const read=async()=>{const row=await db.prepare('SELECT capture_id,expires_at FROM market_candle_cache WHERE owner_id=? AND cache_key=?').bind(owner,cacheKey).first();if(!row||row.expires_at<=iso(nowOf(now)))return null;const capture=await readTossCandleArchive({db,owner,captureId:row.capture_id});if(!capture)return null;check(capture.collectedAt<=iso(nowOf(now)),'CANDLE_ARCHIVE_FUTURE','현재 이전에 수집한 시세를 조회하세요.');return {...structuredClone(capture.market),source:{...capture.market.source,cache:{status:'HIT',providerRequests:0,expiresAt:row.expires_at}}};};
 const cached=await read();if(cached)return projectLimit(cached,q.limit,now);
 let owners=inflight.get(db);if(!owners){owners=new Map();inflight.set(db,owners);}const key=owner+':'+cacheKey;if(owners.has(key)){const result=await owners.get(key);return projectLimit(result?{...structuredClone(result),source:{...result.source,cache:{...result.source.cache,status:'COALESCED',providerRequests:0}}}:null,q.limit,now);}
 const work=(async()=>{const second=await read();if(second)return second;const status=await tossReadConnectionStatus(db,owner,env);if(status.status!=='CONFIGURED')return null;
  const capture=await serializeOwnerRead(db,owner,()=>withTossReadConnection({db,owner,env,fetchImpl,clock:()=>iso(nowOf(now))},accessToken=>collectTossCandles({...options,...request,instrument:q.instrument,accessToken,fetchImpl})));validateCapture(capture);
  const at=Date.parse(capture.collectedAt),nextMidnight=midnight(iso(Date.parse(dayAt(at,q.instrument.timezone)+'T00:00:00Z')+DAY).slice(0,10),q.instrument.timezone),historical=!!q.endAt&&Date.parse(q.endAt)<at-DAY,expiresAt=iso(historical?at+7*DAY:q.timeframe==='1d'?Math.min(at+6*3600000,nextMidnight):at+MINUTE);
  await db.batch([db.prepare('INSERT INTO market_candle_archives(owner_id,capture_id,payload,created_at) VALUES(?,?,?,?) ON CONFLICT(owner_id,capture_id) DO NOTHING').bind(owner,capture.id,JSON.stringify(capture),capture.collectedAt),db.prepare('INSERT INTO market_candle_cache(owner_id,cache_key,capture_id,expires_at) VALUES(?,?,?,?) ON CONFLICT(owner_id,cache_key) DO UPDATE SET capture_id=excluded.capture_id,expires_at=excluded.expires_at').bind(owner,cacheKey,capture.id,expiresAt)]);
  return {...structuredClone(capture.market),source:{...capture.market.source,cache:{status:'MISS',providerRequests:capture.records.length,expiresAt}}};})();owners.set(key,work);
 try{return projectLimit(await work,q.limit,now);}finally{owners.delete(key);}
}
