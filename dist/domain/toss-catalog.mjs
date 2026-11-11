/** Official exchange catalogue: identity, asset classification and lossless capture chunks. */
import {hashInputPackage} from './workspace.mjs';
import {researchSha256} from './research.mjs';

export const TOSS_CATALOG_MARKETS=Object.freeze(['KOSPI','KOSDAQ','NYSE','NASDAQ','AMEX','KR_ETC','US_ETC']);
export const EQUITY_ASSET_TYPES=Object.freeze(['stock','etf','reit','etn','preferred','other']);
const securityTypes=['STOCK','FOREIGN_STOCK','DEPOSITARY_RECEIPT','INFRASTRUCTURE_FUND','REIT','ETF','FOREIGN_ETF','ETN','STOCK_WARRANTS'];
const iso=v=>typeof v==='string'&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString()===v;
const check=(ok,code,message)=>{if(!ok)throw Object.assign(new TypeError(message),{code,status:400});};
const seal=value=>({...value,contentHash:hashInputPackage(value)});
const verified=value=>{const {contentHash,...data}=value??{};return typeof contentHash==='string'&&hashInputPackage(data)===contentHash;};
export const tossMarketCountry=market=>market.startsWith('KR')||['KOSPI','KOSDAQ'].includes(market)?'KR':'US';
export function equityAssetType(item){
  if(['ETF','FOREIGN_ETF'].includes(item.securityType)||item.instrumentType==='ETF')return 'etf';
  if(item.securityType==='ETN'||item.instrumentType==='ETN')return 'etn';
  if(item.securityType==='REIT'||item.instrumentType==='REIT')return 'reit';
  if(['STOCK','FOREIGN_STOCK'].includes(item.securityType)&&item.isCommonShare===false)return 'preferred';
  return ['STOCK','FOREIGN_STOCK','DEPOSITARY_RECEIPT'].includes(item.securityType)||item.instrumentType==='COMMON_STOCK'?'stock':'other';
}
export function normalizeTossListedStocks(rawBody,{market,status='ACTIVE'}={}){
  check(TOSS_CATALOG_MARKETS.includes(market)&&['ACTIVE','SCHEDULED','DELISTED'].includes(status),'TOSS_CATALOG_MARKET','조회 시장과 상장 상태를 확인하세요.');
  let body;try{body=JSON.parse(rawBody);}catch{check(false,'TOSS_CATALOG_JSON','종목 목록 원문을 확인하세요.');}
  check(body&&Array.isArray(body.result)&&body.result.length<=30000&&!body.error,'TOSS_CATALOG_ENVELOPE','종목 목록 응답을 확인하세요.');
  const country=tossMarketCountry(market),rows=new Map();
  for(const row of body.result){
    check(row&&typeof row.symbol==='string'&&(country==='KR'?/^(?:[A-Za-z0-9]{6}|[A-Za-z0-9]{8})$/:/^[A-Za-z0-9.\-]{1,32}$/).test(row.symbol)&&typeof row.name==='string'&&row.name.trim()&&row.name.length<=500&&typeof row.securityType==='string'&&/^[A-Z_]{1,64}$/.test(row.securityType)&&typeof row.isCommonShare==='boolean'&&typeof row.isinCode==='string'&&row.isinCode.length<=32,'TOSS_CATALOG_ROW','종목 코드·이름·자산 종류를 확인하세요.');
    const symbol=row.symbol.toUpperCase(),venue=country==='KR'?'KRX':symbol==='SPY'?'NYSE_ARCA':market,assetType=equityAssetType(row);
    const item={id:`equity:${venue}:${symbol}`,symbol,name:row.name,assetClass:'equity',venue,market,marketCountry:country,quoteCurrency:country==='KR'?'KRW':'USD',baseAsset:symbol,provider:'toss',providerSymbol:symbol,providerMarket:market,securityType:row.securityType,instrumentType:assetType==='etf'?'ETF':assetType==='stock'?'COMMON_STOCK':assetType==='preferred'?'PREFERRED_STOCK':row.securityType,assetType,classificationStatus:securityTypes.includes(row.securityType)?'PROVIDER_TYPE':'UNRECOGNIZED_PROVIDER_TYPE',isCommonShare:row.isCommonShare,isinCode:row.isinCode,listingStatus:status};
    const prior=rows.get(item.id);check(!prior||hashInputPackage(prior)===hashInputPackage(item),'TOSS_CATALOG_DUPLICATE','중복 종목의 정체성을 확인하세요.');rows.set(item.id,item);
  }
  return [...rows.values()].sort((a,b)=>a.id.localeCompare(b.id));
}

/** Raw JSON is split by characters without modifying it; concatenation reproduces its exact hash. */
export function buildTossCatalogEntries({id,version=1,captures,availableAt,origin='PROVIDER_CAPTURE'}){
  check(typeof id==='string'&&/^[a-zA-Z0-9:-]{1,150}$/.test(id)&&Number.isSafeInteger(version)&&version>0&&iso(availableAt)&&Array.isArray(captures)&&captures.length>0&&captures.length<=7,'TOSS_CATALOG_CAPTURE','종목 목록의 수집 범위를 확인하세요.');
  check(new Set(captures.map(c=>c.market)).size===captures.length,'TOSS_CATALOG_DUPLICATE_MARKET','시장은 한 번씩 수집하세요.');
  const chunks=[],markets=[];
  for(const capture of captures){
    check([capture.requestStartedAt,capture.receivedAt,capture.availableAt].every(iso)&&capture.requestStartedAt<=capture.receivedAt&&capture.receivedAt<=capture.availableAt&&capture.availableAt<=availableAt,'TOSS_CATALOG_TIME','목록의 수집 시각을 확인하세요.');
    const instruments=normalizeTossListedStocks(capture.rawBody,capture),rawBodySha256=researchSha256(capture.rawBody),chunkRefs=[];
    for(let offset=0;offset<capture.rawBody.length;offset+=60000){
      const chunk=seal({kind:'TOSS_STOCK_CATALOG_RAW_CHUNK',id:`${id}-${capture.market}-${chunkRefs.length}`,catalogId:id,market:capture.market,index:chunkRefs.length,rawText:capture.rawBody.slice(offset,offset+60000)});chunks.push({id:chunk.id,kind:chunk.kind,snapshot:chunk,importedAt:availableAt,source:origin});chunkRefs.push({id:chunk.id,contentHash:chunk.contentHash});
    }
    markets.push({market:capture.market,marketCountry:tossMarketCountry(capture.market),status:capture.status??'ACTIVE',count:instruments.length,url:`https://openapi.tossinvest.com/api/v1/stocks/all?market=${capture.market}&status=${capture.status??'ACTIVE'}`,requestStartedAt:capture.requestStartedAt,receivedAt:capture.receivedAt,availableAt:capture.availableAt,rawBodySha256,chunkRefs});
  }
  const snapshot=seal({schemaVersion:1,kind:'TOSS_STOCK_CATALOG_SNAPSHOT',id,version,origin,asOf:captures.map(c=>c.receivedAt).sort().at(-1),availableAt,markets,count:markets.reduce((sum,m)=>sum+m.count,0),documentation:'https://openapi.tossinvest.com/openapi-docs/latest/openapi.json',cachePolicy:'DAILY_PROVIDER_CATALOG_V1'});
  return {entry:{id,kind:snapshot.kind,snapshot,importedAt:availableAt,source:origin},entries:chunks};
}

export function readTossCatalogSnapshot(entries,snapshot){
  check(verified(snapshot)&&snapshot.kind==='TOSS_STOCK_CATALOG_SNAPSHOT','TOSS_CATALOG_HASH','종목 목록 저장 원본을 확인하세요.');
  const byId=new Map(entries.map(entry=>[entry.id,entry])),instruments=new Map(),sourceCaptures=[];
  for(const market of snapshot.markets){
    const rawBody=market.chunkRefs.map((ref,index)=>{const chunk=byId.get(ref.id)?.snapshot;check(chunk&&verified(chunk)&&chunk.contentHash===ref.contentHash&&chunk.catalogId===snapshot.id&&chunk.market===market.market&&chunk.index===index,'TOSS_CATALOG_CHUNK','종목 목록 원문 조각을 확인하세요.');return chunk.rawText;}).join('');
    check(researchSha256(rawBody)===market.rawBodySha256,'TOSS_CATALOG_RAW_HASH','수집한 종목 목록의 원문 해시를 확인하세요.');
    const rows=normalizeTossListedStocks(rawBody,market);check(rows.length===market.count,'TOSS_CATALOG_COUNT','수집한 종목 수를 확인하세요.');
    sourceCaptures.push({market:market.market,status:market.status,rawBody,requestStartedAt:market.requestStartedAt,receivedAt:market.receivedAt,availableAt:market.availableAt});
    for(const row of rows){const prior=instruments.get(row.id);check(!prior||prior.isinCode===row.isinCode,'TOSS_CATALOG_IDENTITY','서로 다른 시장의 종목 식별 정보를 확인하세요.');instruments.set(row.id,row);}
  }
  return {snapshot,instruments:[...instruments.values()],sourceCaptures};
}
