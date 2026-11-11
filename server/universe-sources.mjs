/** Read-only official transports. Credentials are caller supplied and never returned. */
import {researchSha256} from '../dist/domain/research.mjs';
import {normalizeUpbitMarketCapture,resolveUniversePolicy,resolveMindInvestmentScope} from '../dist/domain/universe-policy.mjs';
import {normalizeTossSectorCapture,buildSectorSnapshot,mergeSectorCaptureScopes} from '../dist/domain/market-sectors.mjs';

const stamp=value=>{const raw=typeof value==='function'?value():value??Date.now(),n=typeof raw==='number'?raw:Date.parse(raw);if(!Number.isSafeInteger(n)||n<=0)throw new UniverseSourceError('UNIVERSE_SOURCE_CLOCK','수집 시각을 확인하세요.');return new Date(n).toISOString();};
export class UniverseSourceError extends Error{constructor(code,message,{status=502,provider=null,httpStatus=null,retryAfter=null}={}){super(message);this.code=code;this.status=status;this.provider=provider;this.httpStatus=httpStatus;this.retryAfter=retryAfter;}}
async function read(url,{fetchImpl=fetch,clock,headers={},provider}){
  const requestStartedAt=stamp(clock);let response;
  try{response=await fetchImpl(url.href,{method:'GET',headers:{Accept:'application/json',...headers},cache:'no-store',redirect:'manual',signal:AbortSignal.timeout(12000)});}catch{throw new UniverseSourceError('UNIVERSE_SOURCE_NETWORK','종목 원본 공급처 연결을 확인하세요.',{provider});}
  const receivedAt=stamp(clock);if(receivedAt<requestStartedAt)throw new UniverseSourceError('UNIVERSE_SOURCE_CLOCK','수집 시각의 순서를 확인하세요.');
  if(response.url&&new URL(response.url).origin!==url.origin)throw new UniverseSourceError('UNIVERSE_SOURCE_ORIGIN','공식 원본 공급처 주소를 확인하세요.',{provider});
  if(!response.ok){const header=response.headers?.get?.('Retry-After')?.trim(),retryAfter=/^\d{1,10}$/.test(header||'')?String(Number(header)):Number.isFinite(Date.parse(header))?new Date(header).toUTCString():null;throw new UniverseSourceError('UNIVERSE_SOURCE_HTTP',`종목 원본을 수집하지 못했습니다. (${response.status})`,{provider,httpStatus:response.status,retryAfter});}
  let bytes;if(response.body?.getReader){const reader=response.body.getReader(),parts=[];let size=0;while(true){const p=await reader.read();if(p.done)break;size+=p.value.byteLength;if(size>2000000){await reader.cancel();throw new UniverseSourceError('UNIVERSE_SOURCE_SIZE','종목 원본 크기 한도를 확인하세요.',{provider});}parts.push(p.value);}bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.byteLength;}}else{bytes=new TextEncoder().encode(await response.text());if(bytes.length>2000000)throw new UniverseSourceError('UNIVERSE_SOURCE_SIZE','종목 원본 크기 한도를 확인하세요.',{provider});}
  let rawBody;try{rawBody=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);}catch{throw new UniverseSourceError('UNIVERSE_SOURCE_ENCODING','원본의 UTF-8 인코딩을 확인하세요.',{provider});}
  return {rawBody,requestStartedAt,receivedAt,availableAt:stamp(clock),expectedRawBodySha256:researchSha256(rawBody),origin:'PROVIDER_CAPTURE'};
}
export async function collectUpbitMarketSnapshot({fetchImpl=fetch,now,id='upbit-markets-'+crypto.randomUUID(),version=1}={}){
  const payload=await read(new URL('https://api.upbit.com/v1/market/all?is_details=true'),{fetchImpl,clock:now,provider:'upbit'});
  return normalizeUpbitMarketCapture({id,version,isDetails:true,...payload});
}
/** Supplied OAuth token only; fixed egress IP is an operator connection requirement. No token acquisition occurs here. */
export async function collectTossSectorSnapshot({accessToken,queries=[],rankingQueries=[],topRankedMemberCount=0,instrumentMappings=[],previousSnapshots=[],fetchImpl=fetch,now,id='toss-sectors-'+crypto.randomUUID(),version=1,previousVersionId=null}={}){
  if(typeof accessToken!=='string'||!accessToken.trim())return {status:'CONNECTION_REQUIRED',provider:'toss',requiredConnection:['OAUTH_CLIENT_CREDENTIALS','REGISTERED_EGRESS_IP'],snapshot:null};
  if(!Array.isArray(queries)||queries.length>100||queries.some(q=>!q||!['getSectorStocks','getSectorEtfs'].includes(q.operation)||!['KR','US'].includes(q.marketCountry)||!(/^[A-Za-z0-9_-]{1,40}$/.test(q.sectorId))))throw new UniverseSourceError('SECTOR_QUERY','원본 섹터·국가·조회 종류를 확인하세요.',{status:400});
  if(!Array.isArray(rankingQueries)||rankingQueries.length>4||rankingQueries.some(q=>!q||Object.keys(q).some(k=>!['marketCountry','duration','type'].includes(k))||!['KR','US'].includes(q.marketCountry)||!['TOP_GAINERS','MARKET_TRADING_AMOUNT'].includes(q.type)||!['1d','1w','1mo','3mo','6mo','1y'].includes(q.duration))||!Number.isSafeInteger(topRankedMemberCount)||topRankedMemberCount<0||topRankedMemberCount>2)throw new UniverseSourceError('SECTOR_RANKING_QUERY','섹터 순위의 시장·기간·기준을 확인하세요.',{status:400});
  const operations=[{operation:'getSectors'},...rankingQueries.map(q=>({operation:'getSectorRankings',...q})),...queries],captures=[],seenMembers=new Set(queries.map(q=>q.operation+':'+q.marketCountry+':'+q.sectorId));
  for(const [index,q] of operations.entries()){
    const ranking=q.operation==='getSectorRankings',params=q.operation==='getSectors'?{}:ranking?{type:q.type,marketCountry:q.marketCountry,duration:q.duration}:{sectorId:q.sectorId,marketCountry:q.marketCountry};
    const url=new URL(q.operation==='getSectors'?'/api/v1/sectors':ranking?'/api/v1/sectors/rankings':`/api/v1/sectors/${encodeURIComponent(q.sectorId)}/${q.operation==='getSectorEtfs'?'etfs':'stocks'}`,'https://openapi.tossinvest.com');if(q.operation!=='getSectors')url.search=ranking?new URLSearchParams(params):new URLSearchParams({marketCountry:q.marketCountry});
    const payload=await read(url,{fetchImpl,clock:now,provider:'toss',headers:{Authorization:'Bearer '+accessToken}});
    const capture=normalizeTossSectorCapture({id:id+'-capture-'+index,operation:q.operation,params,...payload});captures.push(capture);
    if(ranking&&topRankedMemberCount)for(const row of capture.normalized.rankings.slice(0,topRankedMemberCount)){const sectorId=row.sectorId.split(':').at(-1),key='getSectorStocks:'+q.marketCountry+':'+sectorId;if(!seenMembers.has(key)){seenMembers.add(key);operations.push({operation:'getSectorStocks',sectorId,marketCountry:q.marketCountry});}}
  }
  const availableAt=stamp(now),merged=mergeSectorCaptureScopes(previousSnapshots,captures,{asOf:availableAt}),observedSymbols=new Set(merged.flatMap(c=>[...(c.normalized.stocks??[]),...(c.normalized.etfs??[])].map(row=>c.params.marketCountry+':'+row.symbol)));
  return buildSectorSnapshot({id,version,previousVersionId,captures:merged,instrumentMappings:instrumentMappings.filter(row=>observedSymbols.has(row.marketCountry+':'+row.providerSymbol)),availableAt});
}

/** Call during owner policy write/publish. A self-rehashed supplied projection is not a provider-source proof. */
export function verifyStoredUniverseSources(workspace,manifest,{asOf}={}){
  const resolution=resolveMindInvestmentScope(manifest,{asOf});if(resolution.legacy)return resolution;
  const rows=Array.isArray(workspace.universeSourceSnapshots)?workspace.universeSourceSnapshots:[];
  const sourceFor=ref=>{const entry=rows.find(e=>e.snapshot?.id===ref.id&&e.snapshot?.version===ref.version&&e.snapshot?.contentHash===ref.contentHash&&e.importedAt<=resolution.asOf);if(!entry)throw new UniverseSourceError('UNIVERSE_STORED_SOURCE_REQUIRED','정책에 고정한 원본을 현재 작업공간에서 확인하세요.',{status:409});return entry.snapshot;};
  const catalog=sourceFor(resolution.sourceRefs.find(r=>r.kind==='catalog')),upbitRef=resolution.sourceRefs.find(r=>r.kind==='upbit-markets'),sectorRef=resolution.sourceRefs.find(r=>r.kind==='equity-sectors');
  const upbitSnapshot=upbitRef?sourceFor(upbitRef):null,sectorSnapshots=sectorRef?[sourceFor(sectorRef)]:[];
  const rebuilt=resolveUniversePolicy({policy:resolution.policy,catalog,upbitSnapshot,sectorSnapshots,sectorSnapshotPin:resolution.sectorSnapshotRef,asOf:resolution.asOf,maxSourceAgeMs:resolution.sourcePolicy.maxSourceAgeMs,supportedExecutionIds:resolution.candidates.filter(i=>i.executionAdapterConnected).map(i=>i.id)});
  if(rebuilt.contentHash!==resolution.contentHash)throw new UniverseSourceError('UNIVERSE_STORED_SOURCE_MISMATCH','저장된 원본과 정책의 투자 범위가 다릅니다.',{status:409});return resolution;
}
