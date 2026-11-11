import {assertMindInvestmentScope,resolveMindInvestmentScope,universeResolutionRef} from '../dist/domain/universe-policy.mjs';
import {getInstrument} from '../dist/domain/instruments.mjs';
import {researchSha256} from '../dist/domain/research.mjs';

export const UNIVERSE_CANDIDATE_POLICY='SOURCE_ELIGIBLE_SAME_VENUE_QUOTE_VOLUME24H_TOP12_V1';
export const UPBIT_CANDIDATE_SOURCE='https://docs.upbit.com/kr/reference/list-quote-tickers';
const clone=structuredClone,iso=v=>typeof v==='string'&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString()===v;
const finite=v=>typeof v==='number'&&Number.isFinite(v),cmp=(a,b)=>a<b?-1:a>b?1:0;
const group=i=>({assetClass:i.assetClass,venue:i.venue,quoteCurrency:i.quoteCurrency});
const groupKey=i=>[i.assetClass,i.venue,i.quoteCurrency].join(':');
export class UniverseCandidateError extends TypeError{
  constructor(code,message,details={}){super(message);this.name='UniverseCandidateError';this.code=code;this.status=503;Object.assign(this,details);}
}
const check=(ok,code,message,details)=>{if(!ok)throw new UniverseCandidateError(code,message,details);};
async function readBody(response){
  const max=2000000;if(!response.body?.getReader){const raw=await response.text();check(new TextEncoder().encode(raw).length<=max,'UNIVERSE_TICKER_SIZE','후보 현재가 원문의 크기를 확인하세요.');return raw;}
  const reader=response.body.getReader(),parts=[];let length=0;
  while(true){const p=await reader.read();if(p.done)break;length+=p.value.length;if(length>max){await reader.cancel();throw new UniverseCandidateError('UNIVERSE_TICKER_SIZE','후보 현재가 원문의 크기를 확인하세요.');}parts.push(p.value);}
  const bytes=new Uint8Array(length);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length;}return new TextDecoder('utf-8',{fatal:true}).decode(bytes);
}

/** One bulk ticker request shortlists bounded candle reads. Every omitted ID keeps its own reason. */
export async function prepareUniverseCandidates(manifest,{quoteCurrency=null,venue=null,limit=12,fetchImpl=fetch,clock=()=>new Date().toISOString()}={}){
  const startedAt=clock();check(iso(startedAt)&&Number.isInteger(limit)&&limit>=1&&limit<=12&&typeof fetchImpl==='function'&&(quoteCurrency===null||['KRW','BTC','USDT','USD'].includes(quoteCurrency))&&(venue===null||typeof venue==='string'&&venue.length<=40),'UNIVERSE_CANDIDATE_INPUT','평가 통화·거래소와 최대 12개 후보를 확인하세요.');
  const resolution=resolveMindInvestmentScope(manifest,{asOf:startedAt}),ids=resolution.candidateIds;
  const instruments=ids.map(id=>getInstrument(id,{resolution})),availableCohorts=[...new Map(instruments.map(i=>[groupKey(i),group(i)])).values()];
  const scopeRef=universeResolutionRef(resolution),notQueried=[];
  // The existing fixed catalog fits the bounded query and retains its original
  // eligible-market cohort choice in the decision engine.
  if(!instruments.some(i=>i.venue==='UPBIT')&&instruments.length<=limit&&quoteCurrency===null&&venue===null)return {status:'READY',instrumentIds:[...ids],instruments,notQueried,cohort:null,availableCohorts,rankingPolicy:'EXISTING_FIXED_CATALOG_ORDER_V1',ranking:[],sourceSnapshot:null,universeResolutionRef:scopeRef};
  const first=instruments.find(i=>(quoteCurrency===null||i.quoteCurrency===quoteCurrency)&&(venue===null||i.venue===venue));
  check(first,'UNIVERSE_COHORT_REQUIRED','허용 목록에 포함된 평가 통화와 거래소를 선택하세요.',{availableCohorts});
  const cohort=group(first),cohortId=groupKey(first),eligible=instruments.filter(i=>groupKey(i)===cohortId);
  for(const instrument of instruments)if(groupKey(instrument)!==cohortId)notQueried.push({instrumentId:instrument.id,reason:'OTHER_VENUE_QUOTE_COHORT',cohort:group(instrument)});
  if(first.venue!=='UPBIT'){
    const chosen=eligible.slice(0,limit);for(const instrument of eligible.slice(limit))notQueried.push({instrumentId:instrument.id,reason:'EXPLICIT_FIXED_COHORT_QUERY_LIMIT'});
    return {status:'READY',instrumentIds:chosen.map(i=>i.id),instruments:chosen,notQueried,cohort,availableCohorts,rankingPolicy:'EXPLICIT_FIXED_COHORT_ORDER_V1',ranking:[],sourceSnapshot:null,universeResolutionRef:scopeRef};
  }
  const url=new URL('https://api.upbit.com/v1/ticker/all');url.searchParams.set('quote_currencies',cohort.quoteCurrency);let response;
  try{response=await fetchImpl(url.href,{method:'GET',headers:{Accept:'application/json','Cache-Control':'no-cache'},cache:'no-store',redirect:'manual',signal:AbortSignal.timeout(12000)});}catch{throw new UniverseCandidateError('UNIVERSE_TICKER_NETWORK','평가 후보의 현재가 원본 연결을 확인하세요.');}
  const receivedAt=clock();check(iso(receivedAt)&&startedAt<=receivedAt,'UNIVERSE_TICKER_CLOCK','후보 원본의 실제 요청·수신 시각을 확인하세요.');
  if(response.url)check(new URL(response.url).origin===url.origin,'UNIVERSE_TICKER_ORIGIN','후보 원본의 공식 공급원 주소를 확인하세요.');
  if(!response.ok){const value=response.headers?.get?.('Retry-After')?.trim(),retryAfter=/^\d{1,10}$/.test(value??'')?String(Number(value)):typeof value==='string'&&value.length<=100&&Number.isFinite(Date.parse(value))?new Date(value).toUTCString():null;throw new UniverseCandidateError('UNIVERSE_TICKER_HTTP',`평가 후보의 현재가를 조회하지 못했습니다. (${response.status})`,{httpStatus:response.status,retryAfter});}
  const rawBody=await readBody(response),completedAt=clock();check(iso(completedAt)&&receivedAt<=completedAt&&Date.parse(completedAt)-Date.parse(receivedAt)<=30000,'UNIVERSE_TICKER_STALE','최신 후보 원본을 다시 조회하세요.');
  let rows;try{rows=JSON.parse(rawBody);}catch{throw new UniverseCandidateError('UNIVERSE_TICKER_JSON','후보 원본 JSON을 확인하세요.');}
  check(Array.isArray(rows)&&rows.length<=10000,'UNIVERSE_TICKER_ROWS','후보 현재가 배열을 확인하세요.');
  const wanted=new Map(eligible.map(i=>[i.symbol,i])),byMarket=new Map(),ranked=[];
  for(const row of rows){if(!wanted.has(row?.market))continue;check(!byMarket.has(row.market),'UNIVERSE_TICKER_DUPLICATE','같은 허용 종목의 중복 티커를 확인하세요.');byMarket.set(row.market,row);}
  for(const instrument of eligible){
    const row=byMarket.get(instrument.symbol);let reason=null;
    if(!row)reason='DATA_REQUIRED_TICKER_MISSING';
    else if(!finite(row.acc_trade_price_24h)||row.acc_trade_price_24h<0)reason='DATA_REQUIRED_24H_QUOTE_VOLUME';
    else if(!Number.isSafeInteger(row.timestamp)||row.timestamp<=0||row.timestamp>Date.parse(receivedAt)||Date.parse(completedAt)-row.timestamp>30000)reason='DATA_REQUIRED_TICKER_TIME';
    else if(!Number.isSafeInteger(row.trade_timestamp)||row.trade_timestamp<=0||row.trade_timestamp>row.timestamp||row.acc_trade_price_24h>0&&row.timestamp-row.trade_timestamp>86400000)reason='DATA_REQUIRED_TRADE_TIME';
    if(reason){notQueried.push({instrumentId:instrument.id,reason});continue;}
    ranked.push({instrumentId:instrument.id,quoteVolume24h:row.acc_trade_price_24h,quoteCurrency:cohort.quoteCurrency,asOf:new Date(row.timestamp).toISOString(),tradeAsOf:new Date(row.trade_timestamp).toISOString()});
  }
  const sourceSnapshot={provider:'upbit',url:url.href,documentation:UPBIT_CANDIDATE_SOURCE,rawBody,rawSha256:researchSha256(rawBody),requestedAt:startedAt,receivedAt,parsedAt:completedAt,quoteCurrency:cohort.quoteCurrency,metric:'acc_trade_price_24h',sourceTimestampField:'timestamp',tradeTimestampField:'trade_timestamp',timeBasis:'ROLLING_24H_AT_EACH_TICKER_TIMESTAMP',sourceFreshnessMs:30000};
  check(ranked.length>0,'UNIVERSE_CANDIDATE_DATA_REQUIRED','거래대금과 시각이 검증된 평가 후보를 준비하세요.',{notQueried,sourceSnapshot});
  ranked.sort((a,b)=>b.quoteVolume24h-a.quoteVolume24h||cmp(a.instrumentId,b.instrumentId));const ranking=ranked.map((r,i)=>({...r,rank:i+1})),chosen=ranking.slice(0,limit);
  for(const row of ranking.slice(limit))notQueried.push({instrumentId:row.instrumentId,reason:'BELOW_QUOTE_VOLUME_SHORTLIST',rank:row.rank,quoteVolume24h:row.quoteVolume24h,quoteCurrency:cohort.quoteCurrency});
  // Recheck the saved policy after the async read, before the caller fetches
  // candles or reserves a paid choice. No source or fallback is substituted.
  for(const row of chosen)assertMindInvestmentScope(manifest,row.instrumentId,{asOf:completedAt,expectedResolutionHash:scopeRef.contentHash,phase:'shortlist'});
  return {status:'READY',instrumentIds:chosen.map(r=>r.instrumentId),instruments:chosen.map(r=>clone(instruments.find(i=>i.id===r.instrumentId))),notQueried,cohort,cohortSelectionPolicy:'EXPLICIT_VENUE_QUOTE_OR_FIRST_POLICY_UNIVERSE_ORDER_V1',availableCohorts,rankingPolicy:UNIVERSE_CANDIDATE_POLICY,ranking,sourceSnapshot,universeResolutionRef:scopeRef,coverage:{allowedCount:ids.length,cohortCount:eligible.length,sourceEligibleCount:ranking.length,selectedCount:chosen.length,omittedCount:notQueried.length,rankingPopulation:'SOURCE_ELIGIBLE_ALLOWED_SAME_VENUE_QUOTE_ONLY'}};
}
