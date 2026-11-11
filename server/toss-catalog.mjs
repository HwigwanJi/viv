import {TOSS_CATALOG_MARKETS,tossMarketCountry,buildTossCatalogEntries,readTossCatalogSnapshot} from '../dist/domain/toss-catalog.mjs';

const fail=(code,message,status=502)=>{throw Object.assign(new Error(message),{code,status});};
export async function collectTossStockCatalog({accessToken,markets=['KR','US'],retainedCaptures=[],fetchImpl=fetch,clock=()=>new Date().toISOString(),sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms)),id='toss-stocks-'+crypto.randomUUID(),version=1}={}){
  if(!accessToken)fail('BROKER_NOT_CONNECTED','토스증권 계좌를 먼저 연결하세요.',409);
  const requested=TOSS_CATALOG_MARKETS.filter(market=>markets.includes(tossMarketCountry(market))),captures=[];
  for(const market of requested){
    if(captures.length)await sleep(1050);
    const url=new URL('/api/v1/stocks/all','https://openapi.tossinvest.com');url.search=new URLSearchParams({market,status:'ACTIVE'});
    const requestStartedAt=clock();let response;
    try{response=await fetchImpl(url.href,{method:'GET',headers:{Accept:'application/json',Authorization:'Bearer '+accessToken},cache:'no-store',redirect:'manual',signal:AbortSignal.timeout(20000)});}catch{fail('TOSS_CATALOG_NETWORK','토스증권 종목 목록 연결을 확인하세요.');}
    if(response.url&&new URL(response.url).origin!==url.origin)fail('TOSS_CATALOG_ORIGIN','토스증권 공식 목록 주소를 확인하세요.');
    if(!response.ok){const error=Object.assign(new Error(`종목 목록을 가져오지 못했습니다. (${response.status})`),{code:'TOSS_CATALOG_HTTP',status:502,httpStatus:response.status});const retry=response.headers?.get?.('Retry-After');if(/^\d+$/.test(retry??''))error.retryAfter=retry;throw error;}
    const rawBody=await response.text();if(new TextEncoder().encode(rawBody).length>8000000)fail('TOSS_CATALOG_SIZE','종목 목록 응답 크기를 확인하세요.');
    captures.push({market,status:'ACTIVE',rawBody,requestStartedAt,receivedAt:clock(),availableAt:clock()});
  }
  return buildTossCatalogEntries({id,version,captures:[...retainedCaptures.filter(c=>!requested.includes(c.market)),...captures],availableAt:clock()});
}
const cache=new Map();
const freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};
export function currentTossCatalog(workspace,now){
  const entries=workspace.universeSourceSnapshots??[],snapshot=entries.filter(entry=>entry.snapshot?.kind==='TOSS_STOCK_CATALOG_SNAPSHOT'&&entry.importedAt<=now&&entry.snapshot.availableAt<=now).sort((a,b)=>b.snapshot.version-a.snapshot.version||b.importedAt.localeCompare(a.importedAt))[0]?.snapshot;
  if(!snapshot)return null;
  // Repository reads clone values; compare exact retained bytes, not object identity or a supplied hash alone.
  const byId=new Map(entries.map(e=>[e.id,e.snapshot])),chunks=snapshot.markets.flatMap(m=>m.chunkRefs.map(ref=>byId.get(ref.id))),identity=JSON.stringify(snapshot),previous=cache.get(snapshot.contentHash);
  if(previous?.identity===identity&&previous.chunks.length===chunks.length&&chunks.every((chunk,index)=>JSON.stringify(chunk)===previous.chunks[index]))return previous.result;
  const result=freeze(readTossCatalogSnapshot(entries,snapshot));cache.set(snapshot.contentHash,{identity,chunks:chunks.map(chunk=>JSON.stringify(chunk)),result});while(cache.size>4)cache.delete(cache.keys().next().value);return result;
}
