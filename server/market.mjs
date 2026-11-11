import { researchSha256 } from '../dist/domain/research.mjs';
import { validateDataset } from '../dist/trading/model.mjs';

export const BINANCE_MARKET_VERSION = 'binance-closed-rest-v1';
export const BINANCE_MARKET_ORIGIN = 'https://data-api.binance.vision';
export const FOUR_HOUR_MS = 14400000;
export const DAILY_MS = 86400000;
export const MARKET_HASH_CONTRACT = 'dataset-without-self-hash-json-lf-v1';
export class MarketDataError extends TypeError { constructor(code,message){super(message);this.name='MarketDataError';this.code=code;} }
const check=(condition,code,message)=>{if(!condition)throw new MarketDataError(code,message);};
const plain=v=>!!v&&typeof v==='object'&&!Array.isArray(v)&&Object.getPrototypeOf(v)===Object.prototype;
const sha=v=>researchSha256(typeof v==='string'?v:JSON.stringify(v)+'\n');
const iso=n=>new Date(n).toISOString();
function millis(value){const n=typeof value==='number'?value:typeof value==='string'?Date.parse(value):NaN;check(Number.isSafeInteger(n)&&n>=0,'INVALID_MARKET_TIME','자료 수집 시각을 확인하세요.');return n;}
function clock(value){if(typeof value==='function')return ()=>millis(value());if(value!==undefined){const n=millis(value);return ()=>n;}return ()=>Date.now();}
export function latestClosedAsOf(now){return iso(Math.floor(millis(now)/FOUR_HOUR_MS)*FOUR_HOUR_MS);}
const datasetHash=dataset=>sha(Object.fromEntries(Object.entries(dataset).filter(([key])=>key!=='datasetSha256')));
const sourceHash=snapshot=>sha(Object.fromEntries(Object.entries(snapshot).filter(([key])=>!['id','sha256'].includes(key))));
const exact=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const bounded=(n,min,max)=>Number.isInteger(n)&&n>=min&&n<=max;
const utcDay=n=>Math.floor(n/DAILY_MS)*DAILY_MS;
const dayQuery=day=>({symbol:'BTCUSDT',interval:'1d',timeZone:'0',startTime:day,endTime:day+DAILY_MS-1,limit:1});
function dayOpen(rows,record,day,sourceSnapshotId=null){
  check(Array.isArray(rows)&&rows.length===1&&Array.isArray(rows[0])&&rows[0].length===12&&rows[0][0]===day&&rows[0][6]===day+DAILY_MS-1,'DAY_OPEN_UNAVAILABLE','해당 UTC 일자의 공식 시가를 확인하세요.');
  const value=rows[0][1];check(typeof value==='string'&&/^\d+(?:\.\d+)?$/.test(value)&&Number.isFinite(Number(value))&&Number(value)>0&&Number(value)<=1e12,'DAY_OPEN_UNAVAILABLE','일일 위험 기준 시가를 확인하세요.');
  return {day:iso(day).slice(0,10),price:Number(value),availableAt:record.receivedAt,sourceRef:{...(sourceSnapshotId?{sourceSnapshotId}:{}),recordSha256:record.sha256,sourceUrl:record.url},use:'DAILY_RISK_BASELINE_ONLY'};
}

async function responseText(response,maximum){
  if(!response.body?.getReader){check(typeof response.text==='function','INVALID_MARKET_RESPONSE','공개 응답 원문을 읽을 수 없습니다.');const raw=await response.text();check(new TextEncoder().encode(raw).length<=maximum,'MARKET_RESPONSE_SIZE','공개 응답 크기가 처리 한도를 넘었습니다.');return raw;}
  const reader=response.body.getReader(),parts=[];let size=0;
  while(true){const p=await reader.read();if(p.done)break;size+=p.value.byteLength;if(size>maximum){await reader.cancel();throw new MarketDataError('MARKET_RESPONSE_SIZE','공개 응답 크기가 처리 한도를 넘었습니다.');}parts.push(p.value);}
  const bytes=new Uint8Array(size);let offset=0;for(const p of parts){bytes.set(p,offset);offset+=p.byteLength;}return new TextDecoder('utf-8',{fatal:true}).decode(bytes);
}
function client({fetchImpl,readNow,timeoutMs,dataOrigin}){
  return async(path,params={},extra={})=>{
    const url=new URL(path,BINANCE_MARKET_ORIGIN);for(const [key,value]of Object.entries(params))url.searchParams.set(key,String(value));
    const started=readNow(),controller=new AbortController();let timer;
    try{
      const pending=(async()=>{const response=await fetchImpl(url.href,{method:'GET',headers:{Accept:'application/json'},cache:'no-store',redirect:'manual',signal:controller.signal});check(response.status<300||response.status>=400,'MARKET_REDIRECT_REJECTED',`공개 시세 요청의 리다이렉트를 중단했습니다. (${response.status})`);check(response.ok,'MARKET_HTTP_ERROR',`공개 시세 조회를 완료하지 못했습니다. (${response.status})`);const rawBody=await responseText(response,1000000);let body;try{body=JSON.parse(rawBody);}catch{throw new MarketDataError('MARKET_JSON_ERROR','공개 시세 응답 형식을 확인하세요.');}return {body,rawBody};})();
      const {body,rawBody}=await Promise.race([pending,new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new MarketDataError('MARKET_TIMEOUT','공개 시세 조회 시간이 초과됐습니다.'));},timeoutMs);})]);
      const received=readNow();check(received>=started,'MARKET_CLOCK_REWIND','시세 수신 시각의 순서를 확인하세요.');
      return {body,record:{url:url.href,method:'GET',dataOrigin,requestedAt:iso(started),receivedAt:iso(received),availableAt:iso(received),sha256:sha(rawBody),rawBody,...extra}};
    }catch(error){if(error instanceof MarketDataError)throw error;const diagnostic={event:'PUBLIC_MARKET_FETCH_FAILED',host:url.host,path:url.pathname,errorName:String(error?.name??'Error').slice(0,60),causeCode:String(error?.cause?.code??error?.code??'').slice(0,80),message:String(error?.message??'').replace(/https?:\/\/[^\s]+/g,BINANCE_MARKET_ORIGIN).slice(0,300)};console.error(JSON.stringify(diagnostic));const failure=new MarketDataError('MARKET_NETWORK_ERROR','공개 시세를 다시 조회하세요.');failure.diagnostic=diagnostic;throw failure;}finally{clearTimeout(timer);}
  };
}

function normalizeKlines(rows,{interval,asOf,limit}){
  const step=interval==='4h'?FOUR_HOUR_MS:DAILY_MS,cutoff=Math.floor(asOf/step)*step,start=cutoff-limit*step;
  check(Array.isArray(rows)&&rows.length>0&&rows.length<=1001,'INVALID_KLINES','캔들 응답 배열을 확인하세요.');
  const bars=[];let excludedUnclosed=0;
  for(const row of rows){
    check(Array.isArray(row)&&row.length===12&&Number.isSafeInteger(row[0])&&row[0]>=0&&row[0]%step===0,'INVALID_KLINE_TIME','UTC 캔들 시작 시각을 확인하세요.');
    if(row[0]+step>cutoff){excludedUnclosed++;continue;}
    check(Number.isSafeInteger(row[6])&&row[6]===row[0]+step-1,'INVALID_KLINE_CLOSE','캔들 종료 시각과 구간을 대조하세요.');
    check(row[0]>=start,'UNEXPECTED_KLINE_RANGE','요청한 캔들 구간을 대조하세요.');
    const values=row.slice(1,6);check(values.every(v=>typeof v==='string'&&/^\d+(?:\.\d+)?$/.test(v)),'INVALID_KLINE_VALUES','캔들 가격·거래량 형식을 확인하세요.');
    const bar=[row[0],...values.map(Number)];check(bar.slice(1,5).every(v=>Number.isFinite(v)&&v>0&&v<=1e12)&&Number.isFinite(bar[5])&&bar[5]>=0&&bar[5]<=Number.MAX_SAFE_INTEGER&&bar[2]>=Math.max(bar[1],bar[3],bar[4])&&bar[3]<=Math.min(bar[1],bar[2],bar[4]),'INVALID_KLINE_OHLCV','캔들 가격·거래량 관계를 확인하세요.');
    if(bars.length)check(bar[0]===bars.at(-1)[0]+step,'KLINE_GAP','연속 캔들에서 누락·중복·역순이 발견됐습니다.');
    bars.push(bar);
  }
  check(bars.length===limit,'INSUFFICIENT_KLINES','필요한 연속 캔들 수를 확보하지 못했습니다.');
  check(bars[0][0]===start&&bars.at(-1)[0]+step===cutoff,'STALE_KLINES','최신 완료 캔들의 경계를 확인하세요.');
  return {bars,excludedUnclosed,cutoff};
}

/** The returned market object can be passed as options.market={dataset,manifest}. */
export async function loadBinanceMarket({fetchImpl=globalThis.fetch,now,timeoutMs=5000,limit=720,dailyLimit=210,maxClockSkewMs=5000,dataOrigin='PUBLIC_API'}={}){
  check(typeof fetchImpl==='function'&&bounded(limit,500,1000)&&bounded(dailyLimit,210,1000)&&Number.isFinite(timeoutMs)&&timeoutMs>0&&timeoutMs<=30000&&Number.isFinite(maxClockSkewMs)&&maxClockSkewMs>=0&&maxClockSkewMs<=30000&&['PUBLIC_API','FIXTURE'].includes(dataOrigin),'INVALID_MARKET_OPTIONS','시세 수집 범위와 제한 시간을 확인하세요.');
  const readNow=clock(now),started=readNow(),asOf=Date.parse(latestClosedAsOf(started)),get=client({fetchImpl,readNow,timeoutMs,dataOrigin});
  const server=await get('/api/v3/time',{}, {kind:'SERVER_TIME'}),exchangeNow=server.body?.serverTime;
  check(Number.isSafeInteger(exchangeNow)&&Math.abs(exchangeNow-Date.parse(server.record.receivedAt))<=maxClockSkewMs&&exchangeNow>=asOf,'MARKET_CLOCK_SKEW','거래소와 앱의 UTC 시각을 확인하세요.');
  const query=(interval,count)=>{const step=interval==='4h'?FOUR_HOUR_MS:DAILY_MS,end=Math.floor(asOf/step)*step;return {symbol:'BTCUSDT',interval,timeZone:'0',startTime:end-count*step,endTime:end-1,limit:count};};
  const currentDay=utcDay(started),[four,daily,opening]=await Promise.all([get('/api/v3/klines',query('4h',limit),{kind:'KLINES',interval:'4h'}),get('/api/v3/klines',query('1d',dailyLimit),{kind:'KLINES',interval:'1d'}),get('/api/v3/klines',dayQuery(currentDay),{kind:'DAY_OPEN',interval:'1d'})]);
  const a=normalizeKlines(four.body,{interval:'4h',asOf,limit}),b=normalizeKlines(daily.body,{interval:'1d',asOf,limit:dailyLimit}),received=readNow();
  check(Date.parse(latestClosedAsOf(received))===asOf&&received-started<=30000,'STALE_MARKET_CAPTURE','새 완료 캔들이 생성됐습니다. 시세를 다시 조회하세요.');
  const raw={schemaVersion:1,provider:'binance',symbol:'BTCUSDT',dataOrigin,loaderVersion:BINANCE_MARKET_VERSION,receivedAt:iso(received),availableAt:iso(received),records:[server.record,four.record,daily.record,opening.record]},rawSha=sha(raw),sourceSnapshot={...raw,id:`binance-rest-${rawSha}`,sha256:rawSha};
  const dataset={schemaVersion:1,source:`Binance public REST${dataOrigin==='FIXTURE'?' fixture':''} · BTCUSDT spot`,sourceUrl:'https://developers.binance.com/docs/binance-spot-api-docs/rest-api/market-data-endpoints',symbol:'BTCUSDT',interval:'4h',timezone:'UTC',synthetic:dataOrigin==='FIXTURE',dataOrigin,loaderVersion:BINANCE_MARKET_VERSION,sourceSnapshotId:sourceSnapshot.id,barFields:['openTimeMs','open','high','low','close','volume'],availableAtRule:'openTimeMs + 14400000',dailyAvailableAtRule:'dailyBars.openTimeMs + 86400000',receivedAt:iso(received),availableAt:iso(received),dayOpenSnapshot:dayOpen(opening.body,opening.record,currentDay,sourceSnapshot.id),quality:{gaps:[],dailyGaps:[],gapPolicy:'연속 구간의 누락·중복·역순을 거절한다.',excludedUnclosed:a.excludedUnclosed+b.excludedUnclosed},startAt:iso(a.bars[0][0]),endAt:iso(asOf),bars:a.bars,dailyBars:b.bars};
  dataset.datasetSha256=datasetHash(dataset);
  const manifest={schemaVersion:1,loaderVersion:BINANCE_MARKET_VERSION,hashContract:MARKET_HASH_CONTRACT,dataOrigin,datasetSha256:dataset.datasetSha256,sourceSnapshotId:sourceSnapshot.id,sourceSnapshotSha256:sourceSnapshot.sha256,symbol:'BTCUSDT',startAt:dataset.startAt,endAt:dataset.endAt,latestClosedAsOf:iso(asOf),receivedAt:iso(received),availableAt:iso(received),candleCount:a.bars.length,dailyCandleCount:b.bars.length,limits:{fourHour:limit,daily:dailyLimit},quality:clone(dataset.quality),sources:raw.records.map(({rawBody,...meta})=>meta)};
  const result={dataset,manifest,sourceSnapshot,latestClosedAsOf:iso(asOf),receivedAt:iso(received),availableAt:iso(received)};const errors=validateMarketSnapshot(result,{now:iso(received)});check(errors.ok,'MARKET_INTEGRITY',errors.reasons[0]?.message??'시세 스냅샷을 확인하세요.');return result;
}
const clone=v=>structuredClone(v);

/** Pure validation; pass now for forward freshness, omit now when auditing a stored capture. */
export function validateMarketSnapshot(snapshot,{now,maxSnapshotAgeMs=30000,requirePublic=false}={}){
  try{
    const {dataset,manifest,sourceSnapshot}=snapshot??{};check(plain(dataset)&&plain(manifest)&&manifest.loaderVersion===BINANCE_MARKET_VERSION&&manifest.hashContract===MARKET_HASH_CONTRACT,'INVALID_MARKET_SNAPSHOT','시세 수집 계약을 확인하세요.');
    check(['PUBLIC_API','FIXTURE'].includes(manifest.dataOrigin)&&dataset.dataOrigin===manifest.dataOrigin&&dataset.synthetic===(manifest.dataOrigin==='FIXTURE')&&(!requirePublic||manifest.dataOrigin==='PUBLIC_API'),'MARKET_DATA_ORIGIN','실제 공개 데이터와 테스트 자료를 구분하세요.');
    check(dataset.datasetSha256===datasetHash(dataset)&&manifest.datasetSha256===dataset.datasetSha256,'MARKET_DATA_HASH','시세 데이터의 SHA-256을 대조하세요.');
    const validation=validateDataset(dataset);check(validation.ok&&!validation.gaps.length&&!validation.dailyGaps.length,'MARKET_DATA_GAP','시세의 연속성과 가격을 확인하세요.');
    check(Array.isArray(dataset.dailyBars)&&bounded(manifest.limits?.fourHour,500,1000)&&bounded(manifest.limits?.daily,210,1000)&&dataset.bars.length===manifest.limits.fourHour&&dataset.dailyBars.length===manifest.limits.daily&&manifest.candleCount===dataset.bars.length&&manifest.dailyCandleCount===dataset.dailyBars.length,'MARKET_DATA_COUNT','확정된 시세 관측 수를 대조하세요.');
    const end=millis(manifest.latestClosedAsOf),dailyEnd=Math.floor(end/DAILY_MS)*DAILY_MS;
    check(end%FOUR_HOUR_MS===0&&dataset.bars.at(-1)[0]+FOUR_HOUR_MS===end&&dataset.dailyBars.at(-1)[0]+DAILY_MS===dailyEnd&&dataset.endAt===manifest.endAt&&dataset.endAt===manifest.latestClosedAsOf&&dataset.startAt===manifest.startAt&&dataset.startAt===iso(dataset.bars[0][0]),'MARKET_DATA_BOUNDARY','완료 봉과 일봉의 UTC 경계를 대조하세요.');
    const sourceCount=dataset.dayOpenSnapshot?4:3;
    check(dataset.sourceSnapshotId===manifest.sourceSnapshotId&&Array.isArray(manifest.sources)&&manifest.sources.length===sourceCount&&manifest.sources.every(r=>typeof r.sha256==='string'&&/^[a-f0-9]{64}$/.test(r.sha256)&&!Object.hasOwn(r,'rawBody')&&millis(r.availableAt)===millis(r.receivedAt)),'MARKET_SOURCE_LINEAGE','시세 원문과 조회 계보를 확인하세요.');
    if(dataset.dayOpenSnapshot){const opening=dataset.dayOpenSnapshot,r=manifest.sources[3];check(plain(opening)&&opening.day===iso(millis(manifest.receivedAt)).slice(0,10)&&Number.isFinite(opening.price)&&opening.price>0&&opening.use==='DAILY_RISK_BASELINE_ONLY'&&opening.availableAt===r.receivedAt&&opening.sourceRef?.sourceSnapshotId===manifest.sourceSnapshotId&&opening.sourceRef.recordSha256===r.sha256&&opening.sourceRef.sourceUrl===r.url&&r.kind==='DAY_OPEN','DAY_OPEN_LINEAGE','일일 기준 시가의 출처와 사용 시각을 대조하세요.');}
    if(sourceSnapshot){check(sourceSnapshot.id===manifest.sourceSnapshotId&&sourceSnapshot.sha256===manifest.sourceSnapshotSha256&&sourceSnapshot.sha256===sourceHash(sourceSnapshot)&&sourceSnapshot.records.length===sourceCount,'MARKET_SOURCE_HASH','원문 스냅샷의 SHA-256을 대조하세요.');
      check(sourceSnapshot.records.every((r,i)=>r.sha256===sha(r.rawBody)&&exact(Object.fromEntries(Object.entries(r).filter(([k])=>k!=='rawBody')),manifest.sources[i])),'MARKET_SOURCE_HASH','원문 응답 해시와 파생 자료를 대조하세요.');
      const four=normalizeKlines(JSON.parse(sourceSnapshot.records[1].rawBody),{interval:'4h',asOf:end,limit:manifest.limits.fourHour}),daily=normalizeKlines(JSON.parse(sourceSnapshot.records[2].rawBody),{interval:'1d',asOf:end,limit:manifest.limits.daily});check(exact(four.bars,dataset.bars)&&exact(daily.bars,dataset.dailyBars),'MARKET_SOURCE_CONTENT','원문 캔들과 정규 데이터를 대조하세요.');
      if(dataset.dayOpenSnapshot){const r=sourceSnapshot.records[3],expected=dayOpen(JSON.parse(r.rawBody),r,utcDay(millis(manifest.receivedAt)),sourceSnapshot.id);check(exact(expected,dataset.dayOpenSnapshot),'DAY_OPEN_LINEAGE','일일 기준 시가와 원문 응답을 대조하세요.');}
    }
    const received=millis(manifest.receivedAt);check(received>=end&&millis(manifest.availableAt)===received&&dataset.receivedAt===manifest.receivedAt&&dataset.availableAt===manifest.availableAt,'MARKET_AVAILABILITY','수신·사용 가능 시각을 확인하세요.');
    if(now!==undefined){const current=millis(now);check(Number.isFinite(maxSnapshotAgeMs)&&maxSnapshotAgeMs>=0&&current>=received&&current-received<=maxSnapshotAgeMs&&latestClosedAsOf(current)===manifest.latestClosedAsOf,'STALE_MARKET_SNAPSHOT','최신 완료 캔들 자료를 다시 수집하세요.');}
    return {ok:true,reasons:[]};
  }catch(error){return {ok:false,reasons:[{code:error.code??'INVALID_MARKET_SNAPSHOT',message:error.message}]};}
}

/** First locally observed executable book after the completed decision; paper fills only. */
export async function getBinanceExecutableQuote({side,orderEligibleAt,decisionCompletedAt,fetchImpl=globalThis.fetch,now,timeoutMs=5000,dataOrigin='PUBLIC_API'}={}){
  check(['buy','sell'].includes(side)&&typeof fetchImpl==='function'&&Number.isFinite(timeoutMs)&&timeoutMs>0&&timeoutMs<=5000&&['PUBLIC_API','FIXTURE'].includes(dataOrigin),'INVALID_EXECUTION_QUOTE','호가 조회 조건을 확인하세요.');
  const readNow=clock(now),eligible=millis(orderEligibleAt),completed=millis(decisionCompletedAt),started=readNow();check(started>=eligible&&eligible>=completed,'QUOTE_NOT_ELIGIBLE','선택 완료와 주문 가능 시각 이후에 호가를 조회하세요.');
  const get=client({fetchImpl,readNow,timeoutMs,dataOrigin});let body,record,observed,filled,opening,openingRecord;
  for(let attempt=0;attempt<2;attempt++){
    const day=utcDay(readNow()),opened=await get('/api/v3/klines',dayQuery(day),{kind:'DAY_OPEN',interval:'1d'});opening=dayOpen(opened.body,opened.record,day);openingRecord=opened.record;
    const response=await get('/api/v3/ticker/bookTicker',{symbol:'BTCUSDT'},{kind:'BOOK_TICKER'});body=response.body;record=response.record;observed=millis(record.receivedAt);filled=readNow();
    if(utcDay(filled)===day&&utcDay(observed)===day)break;
    check(attempt===0&&filled-started<=2000,'QUOTE_DAY_CHANGED','UTC 일자 변경 후 일일 기준과 호가를 다시 조회하세요.');
  }
  check(body?.symbol==='BTCUSDT'&&[body.bidPrice,body.askPrice,body.bidQty,body.askQty].every(v=>typeof v==='string'&&/^\d+(?:\.\d+)?$/.test(v)&&Number.isFinite(Number(v))&&Number(v)>0&&Number(v)<=1e12)&&Number(body.bidPrice)<Number(body.askPrice),'INVALID_EXECUTION_QUOTE','매수·매도 호가와 수량을 확인하세요.');
  check(observed>=millis(record.requestedAt)&&millis(record.requestedAt)>=eligible&&filled>=observed&&filled-started<=2000,'STALE_EXECUTION_QUOTE','2초 이내의 실행 호가를 다시 조회하세요.');
  check(opening.day===iso(filled).slice(0,10)&&millis(opening.availableAt)<=filled,'QUOTE_DAY_CHANGED','체결 UTC 일자의 기준 시가를 확인하세요.');
  const content={provider:'binance',symbol:'BTCUSDT',dataOrigin,side,bid:Number(body.bidPrice),ask:Number(body.askPrice),quantityAvailable:Number(side==='buy'?body.askQty:body.bidQty),priceSource:'Binance public REST /api/v3/ticker/bookTicker',executionPolicyVersionId:'FORWARD_PAPER_FIRST_EXECUTABLE_V1',decisionCompletedAt:iso(completed),orderEligibleAt:iso(eligible),requestStartedAt:record.requestedAt,quoteObservedAt:iso(observed),receivedAt:iso(observed),exchangeAt:null,exchangeTimeBasis:'LOCAL_OBSERVATION_ONLY',filledAt:iso(filled),dayOpenSnapshot:opening,sourceUrl:record.url,sourceSha256:record.sha256};
  return {...content,quoteId:`binance-book-${sha(content)}`,sourceRecord:record,dayOpenSourceRecord:openingRecord};
}
