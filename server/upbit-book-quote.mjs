import {RepositoryError} from './repository.mjs';
import {researchSha256} from '../dist/domain/research.mjs';
import {upbitBookProjection,assertUpbitBookQuote} from '../dist/domain/upbit-book-quote.mjs';

const fail=(code,message)=>{throw new RepositoryError(code,message,503);};
const check=(ok,code,message)=>{if(!ok)fail(code,message);};
const iso=value=>typeof value==='string'&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value;
export async function currentUpbitBookQuote(instrument,{fetchImpl=fetch,now,notBefore=null,action='hold'}={}){
 check(instrument?.assetClass==='crypto'&&instrument.venue==='UPBIT'&&/^(KRW|BTC|USDT)-[A-Z0-9]{1,30}$/.test(instrument.symbol??'')&&instrument.id==='crypto:upbit:'+instrument.symbol&&instrument.quoteCurrency===instrument.symbol.split('-')[0]&&instrument.baseAsset===instrument.symbol.split('-')[1]&&['buy','sell','hold'].includes(action),'EXECUTION_QUOTE_INVALID','업비트 종목·통화·체결 방향을 확인하세요.');
 check(notBefore===null||iso(notBefore),'EXECUTION_QUOTE_TIME','결정의 실제 기준 시각을 확인하세요.');
 const readTime=()=>new Date(typeof now==='function'?now():now??Date.now()).toISOString(),url=new URL('https://api.upbit.com/v1/orderbook');url.searchParams.set('markets',instrument.symbol);url.searchParams.set('count','30');
 const deadline=Date.now()+8000,attempts=[];
 const pause=async attempt=>{if(attempt>=3||Date.now()+attempt*250>=deadline)return false;await new Promise(resolve=>setTimeout(resolve,attempt*250));return true;};
 for(let attempt=1;attempt<=3;attempt++){
  const remaining=deadline-Date.now();if(remaining<=0)break;
  let response,rawBody;
  try{
   response=await fetchImpl(url.href,{method:'GET',signal:AbortSignal.timeout(Math.max(1,Math.min(2500,remaining))),redirect:'manual',cache:'no-store',headers:{'Cache-Control':'no-cache'}});
   if(response.ok)rawBody=await response.text();
  }catch{
   attempts.push({attempt,receivedAt:readTime(),reason:'QUOTE_NETWORK_UNAVAILABLE'});
   if(await pause(attempt))continue;
   fail('EXECUTION_QUOTE_UNAVAILABLE','현재 호가를 불러오지 못했습니다. 같은 결정의 모의 체결을 다시 실행하세요.');
  }
  if(!response.ok){
   attempts.push({attempt,receivedAt:readTime(),reason:'QUOTE_HTTP_UNAVAILABLE',httpStatus:response.status});
   if([408,500,502,503,504].includes(response.status)&&await pause(attempt))continue;
   fail('EXECUTION_QUOTE_UNAVAILABLE','현재 호가를 불러오지 못했습니다. 잠시 후 다시 조회하세요.');
  }
  check(!response.url||response.url===url.href,'EXECUTION_QUOTE_INVALID','업비트 호가의 실제 공급원 주소를 대조하세요.');
  let parsed;try{parsed=upbitBookProjection(rawBody,instrument,action);}catch(error){fail('EXECUTION_QUOTE_INVALID',error.message);}
  const receivedAt=readTime(),stamp=Date.parse(parsed.asOf),receivedMs=Date.parse(receivedAt),rawSha256=researchSha256(rawBody);
  const reason=notBefore!==null&&stamp<Date.parse(notBefore)?'QUOTE_BEFORE_DECISION':stamp>receivedMs?'QUOTE_CLOCK_AHEAD':receivedMs-stamp>30000?'STALE_QUOTE':null;
  attempts.push({attempt,asOf:parsed.asOf,receivedAt,rawSha256,reason});
  if(reason===null){
   const quote={instrumentId:instrument.id,currency:instrument.quoteCurrency,...parsed,receivedAt,source:'UPBIT_PUBLIC_ORDERBOOK',url:url.href,rawBody,rawSha256,hashContract:'RESPONSE_BYTES_SHA256_V1',freshness:'CURRENT',executionAllowed:true,validation:{notBefore,attemptCount:attempt,attempts}};
   assertUpbitBookQuote(quote,instrument,{now:receivedAt,action,notBefore});return quote;
  }
  if(!await pause(attempt))break;
 }
 fail('EXECUTION_QUOTE_PENDING','결정 이후의 새 호가를 기다리고 있습니다. 잠시 후 같은 결정의 모의 체결을 다시 실행하세요.');
}
