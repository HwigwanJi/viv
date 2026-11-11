import {researchSha256} from '../dist/domain/research.mjs';
import {validateDataset} from '../dist/trading/model.mjs';

// OKX v5: https://www.okx.com/docs-v5/en/#order-book-trading-market-data
// Global REST origin: https://www.okx.com/docs-v5/log_en/#2026-05-20
export const OKX_MARKET_VERSION='okx-closed-rest-v1';
export const OKX_MARKET_ORIGIN='https://openapi.okx.com';
export const OKX_MARKET_HASH_CONTRACT='dataset-without-self-hash-json-lf-v1';
export const FOUR_HOUR_MS=14400000,DAILY_MS=86400000;
const INST='BTC-USDT',SYMBOL='BTCUSDT',MAX_PAGE=300;
const clone=value=>structuredClone(value),iso=value=>new Date(value).toISOString();
const plain=value=>!!value&&typeof value==='object'&&!Array.isArray(value)&&Object.getPrototypeOf(value)===Object.prototype;
const sha=value=>researchSha256(typeof value==='string'?value:JSON.stringify(value)+'\n');
const digestDataset=value=>sha(Object.fromEntries(Object.entries(value).filter(([key])=>key!=='datasetSha256')));
const digestSource=value=>sha(Object.fromEntries(Object.entries(value).filter(([key])=>!['id','sha256'].includes(key))));
const exact=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const bounded=(value,min,max)=>Number.isInteger(value)&&value>=min&&value<=max;
const utcDay=value=>Math.floor(value/DAILY_MS)*DAILY_MS;
const latest=value=>Math.floor(value/FOUR_HOUR_MS)*FOUR_HOUR_MS;
const decimal=value=>typeof value==='string'&&/^\d+(?:\.\d+)?$/.test(value)&&Number.isFinite(Number(value));
const stamp=value=>typeof value==='string'&&/^\d{1,16}$/.test(value)&&Number.isSafeInteger(Number(value))&&Number(value)>=0;
export class OkxMarketDataError extends TypeError{constructor(code,message){super(message);this.name='MarketDataError';this.code=code;}}
const check=(condition,code,message)=>{if(!condition)throw new OkxMarketDataError(code,message);};
function millis(value){const result=typeof value==='number'?value:typeof value==='string'?Date.parse(value):NaN;check(Number.isSafeInteger(result)&&result>=0,'INVALID_MARKET_TIME','자료 조회 시각을 확인하세요.');return result;}
function clock(value){if(typeof value==='function')return ()=>millis(value());if(value!==undefined){const at=millis(value);return ()=>at;}return ()=>Date.now();}
function envelope(body){check(plain(body)&&body.code==='0'&&Array.isArray(body.data),'OKX_API_RESPONSE','OKX 공개 시세 응답 코드와 자료 배열을 확인하세요.');return body.data;}
function safeRetryAfter(response){
  const value=response.headers?.get?.('Retry-After')?.trim();
  if(typeof value!=='string')return null;
  if(/^\d{1,10}$/.test(value))return String(Number(value));
  if(/^[A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(value)&&Number.isFinite(Date.parse(value)))return new Date(value).toUTCString();
  return null;
}

async function rawText(response){
  if(!response.body?.getReader){const text=await response.text();check(new TextEncoder().encode(text).length<=1000000,'MARKET_RESPONSE_SIZE','공개 시세 응답의 크기 한도를 초과했습니다.');return text;}
  const reader=response.body.getReader(),parts=[];let size=0;
  while(true){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>1000000){await reader.cancel();throw new OkxMarketDataError('MARKET_RESPONSE_SIZE','공개 시세 응답의 크기 한도를 초과했습니다.');}parts.push(part.value);}
  const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.byteLength;}return new TextDecoder('utf-8',{fatal:true}).decode(bytes);
}
function client({fetchImpl,readNow,timeoutMs,dataOrigin}){return async(path,params={},metadata={})=>{
  const url=new URL(path,OKX_MARKET_ORIGIN);for(const [key,value] of Object.entries(params))url.searchParams.set(key,String(value));
  const requested=readNow(),controller=new AbortController();let timer;
  try{
    const pending=(async()=>{
      const response=await fetchImpl(url.href,{method:'GET',headers:{Accept:'application/json'},cache:'no-store',redirect:'manual',signal:controller.signal});
      if(response.status>=300&&response.status<400||!response.ok){
        const redirected=response.status>=300&&response.status<400,failure=new OkxMarketDataError(redirected?'MARKET_REDIRECT_REJECTED':'MARKET_HTTP_ERROR',redirected?`공개 시세 요청의 리다이렉트를 중단했습니다. (${response.status})`:`OKX 공개 시세 조회를 완료하지 못했습니다. (${response.status})`);
        failure.diagnostic={provider:'okx',host:url.host,path:url.pathname,httpStatus:response.status,retryAfter:safeRetryAfter(response),requestedAt:iso(requested),receivedAt:iso(readNow())};throw failure;
      }
      check(!response.url||new URL(response.url).origin===OKX_MARKET_ORIGIN,'MARKET_SOURCE_ORIGIN','공식 OKX 공개 시세 도메인을 확인하세요.');
      const rawBody=await rawText(response);let body;try{body=JSON.parse(rawBody);}catch{throw new OkxMarketDataError('MARKET_JSON_ERROR','OKX 공개 응답의 JSON 형식을 확인하세요.');}
      return {body,data:envelope(body),rawBody};
    })();
    const result=await Promise.race([pending,new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new OkxMarketDataError('MARKET_TIMEOUT','OKX 공개 시세 조회 시간이 초과됐습니다.'));},timeoutMs);})]);
    const received=readNow();check(received>=requested,'MARKET_CLOCK_REWIND','공개 시세의 요청·수신 시각 순서를 확인하세요.');
    return {...result,record:{url:url.href,method:'GET',dataOrigin,requestedAt:iso(requested),receivedAt:iso(received),availableAt:iso(received),sha256:sha(result.rawBody),rawBody:result.rawBody,...metadata}};
  }catch(error){
    if(error instanceof OkxMarketDataError)throw error;
    const diagnostic={event:'PUBLIC_MARKET_FETCH_FAILED',provider:'okx',host:url.host,path:url.pathname,errorName:String(error?.name??'Error').slice(0,60),causeCode:String(error?.cause?.code??error?.code??'').slice(0,80),message:String(error?.message??'').replace(/https?:\/\/[^\s]+/g,OKX_MARKET_ORIGIN).slice(0,300)};
    console.error(JSON.stringify(diagnostic));const failure=new OkxMarketDataError('MARKET_NETWORK_ERROR','OKX 공개 시세를 다시 조회하세요.');failure.diagnostic=diagnostic;throw failure;
  }finally{clearTimeout(timer);}
};}

function decodePage(rows,{step,end,start,after,count,previous=null}){
  check(Array.isArray(rows)&&rows.length>0&&rows.length<=count,'INVALID_KLINES','OKX 캔들 응답의 자료 수를 확인하세요.');
  const bars=[];let prior=null,excluded=0,last=previous;
  for(const row of rows){
    check(Array.isArray(row)&&row.length===9&&stamp(row[0])&&Number(row[0])%step===0&&['0','1'].includes(row[8]),'INVALID_KLINE_TIME','OKX UTC 캔들의 시간·필드·확정 상태를 확인하세요.');
    const at=Number(row[0]);check(prior===null||at<prior,'KLINE_GAP','OKX 캔들의 중복·역순이 발견됐습니다.');prior=at;
    if(at+step>end){check(row[8]==='0','FUTURE_CONFIRMED_KLINE','완료 시각 이후의 캔들이 확정 상태입니다.');excluded++;continue;}
    check(row[8]==='1','UNCONFIRMED_KLINE','완료 구간에 미확정 OKX 캔들이 있습니다.');
    check(at<after&&at>=start,'UNEXPECTED_KLINE_RANGE','요청한 OKX 캔들 범위를 대조하세요.');
    check(last===null?at===end-step:at===last-step,'KLINE_GAP','OKX 완료 캔들에 누락·중복이 발견됐습니다.');last=at;
    check(row.slice(1,8).every(decimal),'INVALID_KLINE_VALUES','OKX 가격·거래량 문자열을 확인하세요.');
    const bar=[at,...row.slice(1,6).map(Number)];
    check(bar.slice(1,5).every(value=>value>0&&value<=1e12)&&bar[5]>=0&&bar[5]<=Number.MAX_SAFE_INTEGER&&row.slice(6,8).every(value=>Number(value)>=0&&Number(value)<=Number.MAX_SAFE_INTEGER)&&bar[2]>=Math.max(bar[1],bar[3],bar[4])&&bar[3]<=Math.min(bar[1],bar[2],bar[4]),'INVALID_KLINE_OHLCV','OKX 캔들의 가격·거래량 관계를 확인하세요.');bars.push(bar);
  }
  check(bars.length>0,'INSUFFICIENT_KLINES','요청한 구간에 완료된 OKX 캔들이 없습니다.');
  return {bars,excluded,last};
}
function windowFromRecords(records,{interval,count,end}){
  const step=interval==='4h'?FOUR_HOUR_MS:DAILY_MS,bar=interval==='4h'?'4H':'1Dutc',cutoff=Math.floor(end/step)*step,start=cutoff-count*step;
  let after=cutoff,previous=null,excluded=0;const descending=[];
  check(records.length>0&&records.length<=Math.ceil(count/MAX_PAGE)+2,'MARKET_PAGE_COUNT','OKX 캔들의 페이지 수를 확인하세요.');
  for(let page=0;page<records.length;page++){
    const record=records[page],url=new URL(record.url),requested=Math.min(MAX_PAGE,count-descending.length);
    check(record.kind==='KLINES'&&record.interval===interval&&record.page===page&&url.pathname==='/api/v5/market/history-candles'&&url.searchParams.get('instId')===INST&&url.searchParams.get('bar')===bar&&url.searchParams.get('after')===String(after)&&url.searchParams.get('limit')===String(requested)&&[...url.searchParams.keys()].length===4,'MARKET_PAGE_LINEAGE','OKX 캔들 페이지의 요청 순서와 매개변수를 대조하세요.');
    const decoded=decodePage(envelope(JSON.parse(record.rawBody)),{step,end:cutoff,start,after,count:requested,previous});descending.push(...decoded.bars);previous=decoded.last;after=decoded.last;excluded+=decoded.excluded;
  }
  check(descending.length===count&&descending.at(-1)[0]===start,'INSUFFICIENT_KLINES','연속된 OKX 완료 캔들 수를 확인하세요.');return {bars:descending.reverse(),excluded};
}
async function collectWindow(get,{interval,count,end}){
  const step=interval==='4h'?FOUR_HOUR_MS:DAILY_MS,cutoff=Math.floor(end/step)*step,start=cutoff-count*step,bar=interval==='4h'?'4H':'1Dutc';
  let after=cutoff,previous=null,total=0;const records=[];
  while(total<count){
    check(records.length<Math.ceil(count/MAX_PAGE)+2,'MARKET_PAGE_COUNT','OKX 시세 페이지의 진행 상태를 확인하세요.');const requested=Math.min(MAX_PAGE,count-total);
    const result=await get('/api/v5/market/history-candles',{instId:INST,bar,after,limit:requested},{kind:'KLINES',interval,page:records.length});
    const decoded=decodePage(result.data,{step,end:cutoff,start,after,count:requested,previous});records.push(result.record);total+=decoded.bars.length;previous=decoded.last;after=decoded.last;
  }
  return {...windowFromRecords(records,{interval,count,end}),records};
}
const dayQuery=()=>({instId:INST,bar:'1Dutc',limit:1});
function openingFromRecord(record,day,sourceSnapshotId=null){
  const url=new URL(record.url);check(record.kind==='DAY_OPEN'&&url.pathname==='/api/v5/market/candles'&&url.searchParams.get('instId')===INST&&url.searchParams.get('bar')==='1Dutc'&&url.searchParams.get('limit')==='1'&&[...url.searchParams.keys()].length===3,'DAY_OPEN_LINEAGE','OKX UTC 일일 시가의 조회 계보를 확인하세요.');
  const rows=envelope(JSON.parse(record.rawBody));check(rows.length===1&&Array.isArray(rows[0])&&rows[0].length===9&&stamp(rows[0][0])&&Number(rows[0][0])===day&&['0','1'].includes(rows[0][8])&&decimal(rows[0][1])&&Number(rows[0][1])>0&&Number(rows[0][1])<=1e12,'DAY_OPEN_UNAVAILABLE','현재 UTC 일자의 OKX 공식 시가를 확인하세요.');
  return {day:iso(day).slice(0,10),price:Number(rows[0][1]),availableAt:record.receivedAt,sourceRef:{...(sourceSnapshotId?{sourceSnapshotId}:{}),recordSha256:record.sha256,sourceUrl:record.url},use:'DAILY_RISK_BASELINE_ONLY'};
}

export async function loadOkxMarket({fetchImpl=globalThis.fetch,now,timeoutMs=5000,limit=720,dailyLimit=210,maxClockSkewMs=5000,dataOrigin='PUBLIC_API'}={}){
  check(typeof fetchImpl==='function'&&bounded(limit,500,1000)&&bounded(dailyLimit,210,1000)&&Number.isFinite(timeoutMs)&&timeoutMs>0&&timeoutMs<=30000&&Number.isFinite(maxClockSkewMs)&&maxClockSkewMs>=0&&maxClockSkewMs<=30000&&['PUBLIC_API','FIXTURE'].includes(dataOrigin),'INVALID_MARKET_OPTIONS','OKX 공개 시세의 범위·시간 제한을 확인하세요.');
  const readNow=clock(now),started=readNow(),end=latest(started),get=client({fetchImpl,readNow,timeoutMs,dataOrigin});
  const time=await get('/api/v5/public/time',{}, {kind:'SERVER_TIME'});check(time.data.length===1&&stamp(time.data[0]?.ts)&&Math.abs(Number(time.data[0].ts)-millis(time.record.receivedAt))<=maxClockSkewMs&&Number(time.data[0].ts)>=end,'MARKET_CLOCK_SKEW','OKX 거래소와 앱의 UTC 시각을 확인하세요.');
  const [four,daily,opening]=await Promise.all([collectWindow(get,{interval:'4h',count:limit,end}),collectWindow(get,{interval:'1d',count:dailyLimit,end}),get('/api/v5/market/candles',dayQuery(),{kind:'DAY_OPEN',interval:'1d'})]);
  const received=readNow();check(latest(received)===end&&received-started<=30000,'STALE_MARKET_CAPTURE','OKX 수집 중 새 완료 봉이 생성됐습니다. 시세를 다시 조회하세요.');
  const raw={schemaVersion:1,provider:'okx',symbol:SYMBOL,instId:INST,dataOrigin,loaderVersion:OKX_MARKET_VERSION,receivedAt:iso(received),availableAt:iso(received),records:[time.record,...four.records,...daily.records,opening.record]},rawHash=sha(raw),sourceSnapshot={...raw,id:'okx-rest-'+rawHash,sha256:rawHash};
  const dataset={schemaVersion:1,source:`OKX public REST${dataOrigin==='FIXTURE'?' fixture':''} · BTC-USDT spot`,sourceUrl:'https://www.okx.com/docs-v5/en/#order-book-trading-market-data',provider:'okx',symbol:SYMBOL,instId:INST,interval:'4h',timezone:'UTC',synthetic:dataOrigin==='FIXTURE',dataOrigin,loaderVersion:OKX_MARKET_VERSION,sourceSnapshotId:sourceSnapshot.id,barFields:['openTimeMs','open','high','low','close','volume'],availableAtRule:'openTimeMs + 14400000',dailyAvailableAtRule:'dailyBars.openTimeMs + 86400000',receivedAt:iso(received),availableAt:iso(received),dayOpenSnapshot:openingFromRecord(opening.record,utcDay(started),sourceSnapshot.id),quality:{gaps:[],dailyGaps:[],gapPolicy:'확정된 UTC 4시간봉·일봉의 누락·중복·역순을 거절한다.',excludedUnclosed:four.excluded+daily.excluded},startAt:iso(four.bars[0][0]),endAt:iso(end),bars:four.bars,dailyBars:daily.bars};dataset.datasetSha256=digestDataset(dataset);
  const manifest={schemaVersion:1,provider:'okx',instId:INST,loaderVersion:OKX_MARKET_VERSION,hashContract:OKX_MARKET_HASH_CONTRACT,dataOrigin,datasetSha256:dataset.datasetSha256,sourceSnapshotId:sourceSnapshot.id,sourceSnapshotSha256:sourceSnapshot.sha256,symbol:SYMBOL,startAt:dataset.startAt,endAt:dataset.endAt,latestClosedAsOf:iso(end),receivedAt:iso(received),availableAt:iso(received),candleCount:limit,dailyCandleCount:dailyLimit,clockSkewLimitMs:maxClockSkewMs,limits:{fourHour:limit,daily:dailyLimit},quality:clone(dataset.quality),sources:raw.records.map(({rawBody,...record})=>record)};
  const result={dataset,manifest,sourceSnapshot,latestClosedAsOf:iso(end),receivedAt:iso(received),availableAt:iso(received)};const validation=validateOkxMarketSnapshot(result,{now:iso(received)});check(validation.ok,'MARKET_INTEGRITY',validation.reasons[0]?.message??'OKX 시세 원본을 확인하세요.');return result;
}

export function validateOkxMarketSnapshot(snapshot,{now,maxSnapshotAgeMs=30000,requirePublic=false}={}){
  try{
    const {dataset,manifest,sourceSnapshot}=snapshot??{};check(plain(dataset)&&plain(manifest)&&manifest.loaderVersion===OKX_MARKET_VERSION&&dataset.loaderVersion===OKX_MARKET_VERSION&&manifest.hashContract===OKX_MARKET_HASH_CONTRACT&&dataset.provider==='okx'&&manifest.provider==='okx'&&dataset.instId===INST&&manifest.instId===INST&&dataset.symbol===SYMBOL&&manifest.symbol===SYMBOL,'INVALID_MARKET_SNAPSHOT','OKX 공개 자료의 어댑터·현물 종목 계약을 확인하세요.');
    check(['PUBLIC_API','FIXTURE'].includes(manifest.dataOrigin)&&dataset.dataOrigin===manifest.dataOrigin&&dataset.synthetic===(manifest.dataOrigin==='FIXTURE')&&(!requirePublic||manifest.dataOrigin==='PUBLIC_API'),'MARKET_DATA_ORIGIN','실제 OKX 공개 자료와 시험 자료를 구분하세요.');
    check(dataset.datasetSha256===digestDataset(dataset)&&manifest.datasetSha256===dataset.datasetSha256,'MARKET_DATA_HASH','OKX 정규 데이터의 SHA-256을 대조하세요.');
    const validation=validateDataset(dataset);check(validation.ok&&!validation.gaps.length&&!validation.dailyGaps.length,'MARKET_DATA_GAP','OKX 완료 봉의 연속성과 가격을 확인하세요.');
    check(Array.isArray(dataset.dailyBars)&&bounded(manifest.limits?.fourHour,500,1000)&&bounded(manifest.limits?.daily,210,1000)&&dataset.bars.length===manifest.limits.fourHour&&dataset.dailyBars.length===manifest.limits.daily&&manifest.candleCount===dataset.bars.length&&manifest.dailyCandleCount===dataset.dailyBars.length,'MARKET_DATA_COUNT','OKX 완료 봉의 관측 수를 대조하세요.');
    const end=millis(manifest.latestClosedAsOf),received=millis(manifest.receivedAt);check(end%FOUR_HOUR_MS===0&&dataset.bars.at(-1)[0]+FOUR_HOUR_MS===end&&dataset.dailyBars.at(-1)[0]+DAILY_MS===utcDay(end)&&dataset.endAt===manifest.latestClosedAsOf&&dataset.endAt===manifest.endAt&&dataset.startAt===manifest.startAt&&dataset.startAt===iso(dataset.bars[0][0]),'MARKET_DATA_BOUNDARY','OKX UTC 완료 봉의 경계를 대조하세요.');
    check(dataset.sourceSnapshotId===manifest.sourceSnapshotId&&Array.isArray(manifest.sources)&&manifest.sources.length>=5&&manifest.sources.length<=14&&manifest.sources.every(record=>{const url=new URL(record.url);return url.origin===OKX_MARKET_ORIGIN&&!url.username&&!url.password&&record.method==='GET'&&record.dataOrigin===manifest.dataOrigin&&typeof record.sha256==='string'&&/^[a-f0-9]{64}$/.test(record.sha256)&&!Object.hasOwn(record,'rawBody')&&millis(record.requestedAt)<=millis(record.receivedAt)&&millis(record.availableAt)===millis(record.receivedAt)&&millis(record.receivedAt)<=received;}),'MARKET_SOURCE_LINEAGE','OKX 공식 도메인·수신 시각·원문 계보를 확인하세요.');
    const opening=dataset.dayOpenSnapshot,last=manifest.sources.at(-1);check(plain(opening)&&opening.day===iso(received).slice(0,10)&&Number.isFinite(opening.price)&&opening.price>0&&opening.use==='DAILY_RISK_BASELINE_ONLY'&&opening.availableAt===last.receivedAt&&opening.sourceRef?.sourceSnapshotId===manifest.sourceSnapshotId&&opening.sourceRef.recordSha256===last.sha256&&opening.sourceRef.sourceUrl===last.url&&last.kind==='DAY_OPEN','DAY_OPEN_LINEAGE','OKX UTC 시가의 출처와 사용 시점을 대조하세요.');
    if(sourceSnapshot){
      check(sourceSnapshot.provider==='okx'&&sourceSnapshot.instId===INST&&sourceSnapshot.symbol===SYMBOL&&sourceSnapshot.loaderVersion===OKX_MARKET_VERSION&&sourceSnapshot.dataOrigin===manifest.dataOrigin&&sourceSnapshot.receivedAt===manifest.receivedAt&&sourceSnapshot.availableAt===manifest.availableAt&&sourceSnapshot.id===manifest.sourceSnapshotId&&sourceSnapshot.id==='okx-rest-'+sourceSnapshot.sha256&&sourceSnapshot.sha256===manifest.sourceSnapshotSha256&&sourceSnapshot.sha256===digestSource(sourceSnapshot)&&Array.isArray(sourceSnapshot.records)&&sourceSnapshot.records.length===manifest.sources.length,'MARKET_SOURCE_HASH','OKX 시세 원문 사본의 SHA-256을 대조하세요.');
      check(sourceSnapshot.records.every((record,i)=>record.sha256===sha(record.rawBody)&&exact(Object.fromEntries(Object.entries(record).filter(([key])=>key!=='rawBody')),manifest.sources[i])),'MARKET_SOURCE_HASH','OKX 원문 응답과 요청 계보의 해시를 대조하세요.');
      const records=sourceSnapshot.records,server=records[0],url=new URL(server.url),time=envelope(JSON.parse(server.rawBody));check(server.kind==='SERVER_TIME'&&url.pathname==='/api/v5/public/time'&&url.search===''&&time.length===1&&stamp(time[0]?.ts)&&Number.isFinite(manifest.clockSkewLimitMs)&&manifest.clockSkewLimitMs>=0&&manifest.clockSkewLimitMs<=30000&&Math.abs(Number(time[0].ts)-millis(server.receivedAt))<=manifest.clockSkewLimitMs&&Number(time[0].ts)>=end,'MARKET_CLOCK_SKEW','OKX 서버 시간의 원문 계보를 확인하세요.');
      const fourRecords=records.filter(record=>record.kind==='KLINES'&&record.interval==='4h'),dailyRecords=records.filter(record=>record.kind==='KLINES'&&record.interval==='1d');check(records.length===fourRecords.length+dailyRecords.length+2&&records.at(-1).kind==='DAY_OPEN','MARKET_PAGE_LINEAGE','OKX 원문 페이지 종류를 확인하세요.');
      const four=windowFromRecords(fourRecords,{interval:'4h',count:manifest.limits.fourHour,end}),daily=windowFromRecords(dailyRecords,{interval:'1d',count:manifest.limits.daily,end});check(exact(four.bars,dataset.bars)&&exact(daily.bars,dataset.dailyBars)&&dataset.quality.excludedUnclosed===four.excluded+daily.excluded,'MARKET_SOURCE_CONTENT','OKX 원문 완료 봉과 정규 입력을 대조하세요.');check(exact(opening,openingFromRecord(records.at(-1),utcDay(received),sourceSnapshot.id)),'DAY_OPEN_LINEAGE','OKX 일일 시가와 원문 응답을 대조하세요.');
    }
    check(received>=end&&millis(manifest.availableAt)===received&&dataset.receivedAt===manifest.receivedAt&&dataset.availableAt===manifest.availableAt,'MARKET_AVAILABILITY','OKX 자료의 수신·사용 가능 시각을 확인하세요.');
    if(now!==undefined){const current=millis(now);check(Number.isFinite(maxSnapshotAgeMs)&&maxSnapshotAgeMs>=0&&current>=received&&current-received<=maxSnapshotAgeMs&&latest(current)===end,'STALE_MARKET_SNAPSHOT','최신 완료 OKX 봉을 다시 수집하세요.');}
    return {ok:true,reasons:[]};
  }catch(error){return {ok:false,reasons:[{code:error.code??'INVALID_MARKET_SNAPSHOT',message:error.message}]};}
}

export async function getOkxExecutableQuote({side,orderEligibleAt,decisionCompletedAt,fetchImpl=globalThis.fetch,now,timeoutMs=5000,dataOrigin='PUBLIC_API'}={}){
  check(['buy','sell'].includes(side)&&typeof fetchImpl==='function'&&Number.isFinite(timeoutMs)&&timeoutMs>0&&timeoutMs<=5000&&['PUBLIC_API','FIXTURE'].includes(dataOrigin),'INVALID_EXECUTION_QUOTE','OKX 실행 호가 조회 조건을 확인하세요.');
  const readNow=clock(now),eligible=millis(orderEligibleAt),completed=millis(decisionCompletedAt),started=readNow();check(started>=eligible&&eligible>=completed,'QUOTE_NOT_ELIGIBLE','선택 완료와 주문 가능 시각 이후에 OKX 호가를 조회하세요.');
  const get=client({fetchImpl,readNow,timeoutMs,dataOrigin});let body,record,opening,openingRecord,observed,filled,exchange;
  for(let attempt=0;attempt<2;attempt++){
    const day=utcDay(readNow()),opened=await get('/api/v5/market/candles',dayQuery(),{kind:'DAY_OPEN',interval:'1d'});opening=openingFromRecord(opened.record,day);openingRecord=opened.record;
    const result=await get('/api/v5/market/books',{instId:INST,sz:1},{kind:'BOOK_TICKER'});check(result.data.length===1&&plain(result.data[0]),'INVALID_EXECUTION_QUOTE','OKX 최우선 호가 응답을 확인하세요.');body=result.data[0];record=result.record;observed=millis(record.receivedAt);filled=readNow();
    if(utcDay(observed)===day&&utcDay(filled)===day)break;check(attempt===0&&filled-started<=2000,'QUOTE_DAY_CHANGED','UTC 날짜 변경 후 OKX 기준 시가와 호가를 다시 조회하세요.');
  }
  const level=value=>Array.isArray(value)&&value.length===1&&Array.isArray(value[0])&&value[0].length===4&&value[0].slice(0,2).every(price=>decimal(price)&&Number(price)>0&&Number(price)<=1e12)&&value[0][2]==='0'&&typeof value[0][3]==='string'&&/^\d+$/.test(value[0][3])&&Number.isSafeInteger(Number(value[0][3]))&&Number(value[0][3])>0;
  check((body.instId===undefined||body.instId===INST)&&level(body.asks)&&level(body.bids)&&Number(body.bids[0][0])<Number(body.asks[0][0])&&stamp(body.ts),'INVALID_EXECUTION_QUOTE','OKX 현물 최우선 매수·매도 가격과 BTC 수량을 확인하세요.');exchange=Number(body.ts);
  check(exchange<=observed&&observed-exchange<=2000&&observed>=millis(record.requestedAt)&&millis(record.requestedAt)>=eligible&&filled>=observed&&filled-started<=2000,'STALE_EXECUTION_QUOTE','주문 가능 시각 이후 조회한 2초 이내 OKX 호가와 거래소 시각의 신선도를 확인하세요.');
  check(opening.day===iso(filled).slice(0,10)&&millis(opening.availableAt)<=filled,'QUOTE_DAY_CHANGED','OKX 체결 UTC 일자의 기준 시가를 확인하세요.');
  const content={provider:'okx',symbol:SYMBOL,instId:INST,dataOrigin,side,bid:Number(body.bids[0][0]),ask:Number(body.asks[0][0]),quantityAvailable:Number(side==='buy'?body.asks[0][1]:body.bids[0][1]),priceSource:'OKX public REST /api/v5/market/books',executionPolicyVersionId:'FORWARD_PAPER_FIRST_EXECUTABLE_V1',decisionCompletedAt:iso(completed),orderEligibleAt:iso(eligible),requestStartedAt:record.requestedAt,quoteObservedAt:iso(observed),receivedAt:iso(observed),exchangeAt:iso(exchange),exchangeAgeMs:observed-exchange,requestDurationMs:observed-millis(record.requestedAt),exchangeTimeBasis:'EXCHANGE_BOOK_TIMESTAMP_AND_LOCAL_OBSERVATION',filledAt:iso(filled),dayOpenSnapshot:opening,sourceUrl:record.url,sourceSha256:record.sha256};
  return {...content,quoteId:'okx-book-'+sha(content),sourceRecord:record,dayOpenSourceRecord:openingRecord};
}
