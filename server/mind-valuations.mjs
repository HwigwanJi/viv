import {currentPaperQuote} from './mind-execution-service.mjs';
import {getInstrument} from '../dist/domain/instruments.mjs';
import {markMindPaperAccount} from '../dist/domain/mind-paper.mjs';
import {researchSha256} from '../dist/domain/research.mjs';
import {RepositoryError} from './repository.mjs';

export const MIND_VALUATION_POLICY='COMMON_BASIS_FRESH_QUOTES_30S_V1';
const MAX_AGE_MS=30000, list=v=>Array.isArray(v)?v:[], clone=structuredClone;
const stamp=v=>typeof v==='string'&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString()===v;
const readTime=now=>new Date(typeof now==='function'?now():now??Date.now()).toISOString();
const check=(ok,code,message,status=400)=>{if(!ok)throw new RepositoryError(code,message,status);};
const queryValue=(query,key)=>query instanceof URLSearchParams?query.get(key):query?.[key];
class QuoteError extends Error{constructor(code,message,metadata={}){super(message);this.code=code;Object.assign(this,metadata);}}

/** A single public price read. The caller never submits an order or changes a stored account. */
export async function loadMindValuationQuote(instrument,{fetchImpl=fetch,now}={}){
  const requestedAt=readTime(now),provider=instrument.provider;
  if(instrument.venue==='UPBIT')return {...await currentPaperQuote(instrument,{fetchImpl,now}),provider};
  if(instrument.assetClass!=='crypto'||instrument.venue!=='OKX')throw new QuoteError('FRESH_STOCK_QUOTE_REQUIRED','주식 보유분의 현재 평가 시세 연결이 필요합니다.',{provider,checkedAt:requestedAt});
  const url=new URL('https://www.okx.com/api/v5/market/ticker');url.searchParams.set('instId',instrument.symbol);
  let response;
  try{response=await fetchImpl(url.href,{signal:AbortSignal.timeout(5000),redirect:'manual',cache:'no-store',headers:{'Cache-Control':'no-cache'}});}
  catch{throw new QuoteError('VALUATION_NETWORK_ERROR','평가 시세를 불러오지 못했습니다.',{provider,checkedAt:readTime(now)});}
  const receivedAt=readTime(now),rawRetry=response.headers?.get?.('Retry-After'),retryAfter=/^\d{1,10}$/.test(rawRetry??'')||Number.isFinite(Date.parse(rawRetry??''))?rawRetry:null;
  const metadata={provider,checkedAt:receivedAt,httpStatus:response.status,retryAfter,requestedAt,receivedAt};
  if(!response.ok)throw new QuoteError(response.status===429?'VALUATION_RATE_LIMIT':'VALUATION_PROVIDER_ERROR',response.status===429?'시세 공급처의 요청 한도로 평가를 완료하지 못했습니다.':'시세 공급처 응답을 확인하세요.',metadata);
  let raw,body;try{raw=await response.text();check(raw.length<100000,'VALUATION_QUOTE_INVALID','평가 시세 응답을 확인하세요.');body=JSON.parse(raw);}catch{throw new QuoteError('VALUATION_QUOTE_INVALID','평가 시세 응답을 확인하세요.',metadata);}
  if(body.code!=='0')throw new QuoteError(body.code==='50011'?'VALUATION_RATE_LIMIT':'VALUATION_PROVIDER_ERROR',body.code==='50011'?'시세 공급처의 요청 한도로 평가를 완료하지 못했습니다.':'시세 공급처 응답을 확인하세요.',{...metadata,providerCode:typeof body.code==='string'&&/^[A-Za-z0-9_-]{1,32}$/.test(body.code)?body.code:null});
  const row=body.data?.[0],price=Number(row?.last),time=Number(row?.ts);
  if(row?.instId!==instrument.symbol||!Number.isFinite(price)||price<=0||!Number.isSafeInteger(time)||time<=0||time>=8640000000000000)throw new QuoteError('VALUATION_QUOTE_INVALID','평가 종목·가격·시각을 확인하세요.',metadata);
  return {instrumentId:instrument.id,price,currency:instrument.quoteCurrency,asOf:new Date(time).toISOString(),receivedAt,source:'OKX_PUBLIC_TICKER',provider,url:url.href,rawSha256:researchSha256(raw)};
}

function quoteFailure(instrument,error,checkedAt){
  return {instrumentId:instrument.id,provider:instrument.provider,code:typeof error?.code==='string'?error.code:'VALUATION_QUOTE_UNAVAILABLE',message:error instanceof QuoteError?error.message:'종목 평가 가격을 확인하지 못했습니다.',checkedAt:stamp(error?.checkedAt)?error.checkedAt:checkedAt,httpStatus:Number.isInteger(error?.httpStatus)?error.httpStatus:null,retryAfter:typeof error?.retryAfter==='string'?error.retryAfter:null,providerCode:typeof error?.providerCode==='string'?error.providerCode:null};
}

/** Owner-scoped, read-only marks of one immutable workspace revision. */
export async function buildMindValuation(workspace,query,{now,fetchImpl,quoteLoader=loadMindValuationQuote,readRevision}={}){
  const profileId=queryValue(query,'profileId')||'all',quoteCurrency=queryValue(query,'quoteCurrency')||'USDT';
  check(profileId==='all'||list(workspace.investmentProfiles).some(p=>p.id===profileId),'MIND_NOT_FOUND','마인드를 선택하세요.',404);
  check(['USDT','USD','KRW','BTC'].includes(quoteCurrency),'VALUATION_CURRENCY','평가 통화를 선택하세요.');
  const accounts=list(workspace.mindPositions).filter(a=>a.kind==='PAPER_ACCOUNT'&&a.quoteCurrency===quoteCurrency&&(profileId==='all'||a.profileId===profileId));
  const scope={profileId,quoteCurrency},revision=workspace.revision,startedAt=readTime(now),quotes=[],failures=[];
  const instruments=[...new Set(accounts.flatMap(a=>list(a.positions).map(p=>p.instrumentId)))].map(getInstrument);
  const results=await Promise.allSettled(instruments.map(instrument=>quoteLoader(instrument,{now,fetchImpl})));
  const basisAt=readTime(now);
  results.forEach((result,index)=>{
    const instrument=instruments[index];if(result.status==='rejected'){failures.push(quoteFailure(instrument,result.reason,basisAt));return;}
    const q=result.value;
    const valid=q?.instrumentId===instrument.id&&q.currency===quoteCurrency&&Number.isFinite(q.price)&&q.price>0&&stamp(q.asOf)&&stamp(q.receivedAt)&&q.asOf<=q.receivedAt&&q.receivedAt<=basisAt&&Date.parse(basisAt)-Date.parse(q.asOf)<=MAX_AGE_MS&&/^[a-f0-9]{64}$/.test(q.rawSha256??'')&&q.source&&q.executionAllowed!==false&&!['END_OF_DAY','STALE','DELAYED'].includes(q.freshness)&&q.priceBasis!=='LAST_CLOSED_CANDLE';
    if(!valid){failures.push(quoteFailure(instrument,new QuoteError('VALUATION_FRESH_QUOTE_REQUIRED','공통 조회 기준 30초 이내의 종목 현재가가 필요합니다.',{checkedAt:basisAt}),basisAt));return;}
    quotes.push(clone(q));
  });
  if(readRevision)check(await readRevision()===revision,'VALUATION_REVISION_CHANGED','평가 조회 중 계좌가 변경되었습니다. 다시 갱신하세요.',409);
  const base={scope,policy:MIND_VALUATION_POLICY,maxQuoteAgeMs:MAX_AGE_MS,startedAt,basisAt,asOf:basisAt,quotes,failures,summary:null,mindSummaries:[]};
  if(!accounts.length)return {ok:true,revision,valuation:{...base,status:'EMPTY'}};
  if(failures.length)return {ok:true,revision,valuation:{...base,status:'DATA_REQUIRED'}};
  let marked;
  try{marked=accounts.map(a=>markMindPaperAccount(a,{quotes:quotes.filter(q=>list(a.positions).some(p=>p.instrumentId===q.instrumentId)),now:basisAt}));}
  catch(error){return {ok:true,revision,valuation:{...base,status:'DATA_REQUIRED',failures:[{instrumentId:null,provider:null,code:error.code??'VALUATION_ACCOUNT_INVALID',message:'저장된 계좌와 평가 시세의 기준을 확인하세요.',checkedAt:basisAt,httpStatus:null,retryAfter:null}]}};}
  const mindSummaries=marked.map(a=>({accountId:a.id,profileId:a.profileId,quoteCurrency:a.quoteCurrency,initialCapital:a.initialCash+(a.fundingLedger??[]).reduce((n,f)=>n+Math.max(0,f.amount),0),cash:a.cash,holdingsValue:a.holdingsValue,equity:a.equity,pnl:a.netPnl,totalReturn:a.netReturn,feesPaid:a.feesPaid,asOf:basisAt,savedAccountAsOf:accounts.find(saved=>saved.id===a.id).asOf,valuationStatus:'READ_ONLY_COMMON_BASIS'}));
  const sum=key=>mindSummaries.reduce((n,a)=>n+a[key],0),equity=sum('equity'),initialCapital=sum('initialCapital');
  const summary={equity,initialCapital,pnl:sum('pnl'),totalReturn:sum('pnl')/initialCapital,feesPaid:sum('feesPaid'),quoteCurrency,asOf:basisAt,basisAt,hasPerformance:accounts.some(a=>list(a.ledger).length>0),valuationBasis:'READ_ONLY_COMMON_BASIS'};
  return {ok:true,revision,valuation:{...base,status:'READY',summary,mindSummaries}};
}
