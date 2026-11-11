import {listInstruments,getInstrument} from '../dist/domain/instruments.mjs';
import {buildInstrumentCatalogSnapshot,createUniversePolicy,resolveUniversePolicy} from '../dist/domain/universe-policy.mjs';
import {assertSectorSnapshot,selectSectorSnapshot,hasSectorMembershipCoverage} from '../dist/domain/market-sectors.mjs';
import {DEFAULT_MINIMUM_ORDER_AMOUNTS} from '../dist/domain/mind-currency.mjs';
import {hashInputPackage} from '../dist/domain/workspace.mjs';
import {collectUpbitMarketSnapshot,collectTossSectorSnapshot} from './universe-sources.mjs';
import {withTossReadConnection} from './broker-accounts.mjs';
import {collectTossStockCatalog,currentTossCatalog} from './toss-catalog.mjs';
import {EQUITY_ASSET_TYPES,equityAssetType} from '../dist/domain/toss-catalog.mjs';

const clone=structuredClone;
const fail=(code,message,status=400)=>{throw Object.assign(new Error(message),{code,status});};
const list=value=>Array.isArray(value)?value:[];
const stamp=value=>typeof value==='string'&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value;
const latest=(items,kind,now)=>items.filter(e=>e.snapshot?.kind===kind&&e.importedAt<=now&&e.snapshot.availableAt<=now).sort((a,b)=>b.importedAt.localeCompare(a.importedAt))[0]?.snapshot??null;
function tossCatalogMetadata(catalog,now){return catalog?{status:catalog.snapshot.markets.every(m=>Date.parse(now)-Date.parse(m.receivedAt)<=86400000)?'READY':'STALE',provider:'toss',count:catalog.instruments.length,asOf:catalog.snapshot.asOf,availableAt:catalog.snapshot.availableAt,id:catalog.snapshot.id,contentHash:catalog.snapshot.contentHash,markets:catalog.snapshot.markets.map(m=>({market:m.market,marketCountry:m.marketCountry,count:m.count,status:m.status,asOf:m.receivedAt,cacheStatus:Date.parse(now)-Date.parse(m.receivedAt)<=86400000?'READY':'STALE'})),scope:'TOSS_ACTIVE_LISTINGS',cachePolicy:catalog.snapshot.cachePolicy}:{status:'COLLECTION_REQUIRED',provider:'toss',count:0,markets:[]};}

const SEARCH_VENUES=['UPBIT','OKX','KRX','NASDAQ','NYSE','NYSE_ARCA','AMEX','US_ETC'];
const SEARCH_CURRENCIES=['KRW','USD','USDT','BTC'];
function catalogSearchSources(sources,rows,filters,now){
  const {assetClass,market,venue,assetType,sectorId,quoteCurrency}=filters;
  const equityScope=assetClass!=='crypto'&&!['UPBIT','OKX'].includes(venue)&&!['BTC','USDT'].includes(quoteCurrency);
  const cryptoScope=assetClass!=='equity'&&!market&&!assetType&&!sectorId&&!['KRX','NASDAQ','NYSE','NYSE_ARCA','AMEX','US_ETC'].includes(venue)&&quoteCurrency!=='USD';
  const metadata=[];
  if(equityScope){
    const source=tossCatalogMetadata(sources.tossCatalog,now),marketIds=venue?({KRX:['KOSPI','KOSDAQ','KR_ETC'],NYSE_ARCA:['AMEX']})[venue]??[venue]:null;
    const markets=source.markets.filter(m=>(!market||m.marketCountry===market)&&(!marketIds||marketIds.includes(m.market))&&(!quoteCurrency||(quoteCurrency==='KRW'?'KR':'US')===m.marketCountry));
    metadata.push({...source,markets,count:rows.filter(i=>i.listingEvidence==='TOSS_ACTIVE_LISTING').length,status:markets.length?markets.every(m=>m.cacheStatus==='READY')?'READY':'STALE':source.status,asOf:markets.map(m=>m.asOf).sort().at(-1)??null});
  }
  if(cryptoScope&&(!venue||venue==='UPBIT')){
    const s=sources.upbitSnapshot;metadata.push(s?{provider:'upbit',id:s.id,contentHash:s.contentHash,scope:'UPBIT_MARKET_PAIRS',status:Date.parse(now)-Date.parse(s.asOf)<=86400000?'READY':'STALE',asOf:s.asOf,availableAt:s.availableAt,count:rows.filter(i=>i.listingEvidence==='UPBIT_MARKET_LISTING').length}:{provider:'upbit',scope:'UPBIT_MARKET_PAIRS',status:'COLLECTION_REQUIRED',count:0,asOf:null});
  }
  const application=rows.filter(i=>i.listingEvidence==='APPLICATION_CATALOG');if(application.length)metadata.push({provider:'application',scope:'APPLICATION_CATALOG',status:'REFERENCE',count:application.length,asOf:null,venues:[...new Set(application.map(i=>i.venue))]});
  const primary=metadata.length===1?metadata[0]:null,dated=metadata.filter(m=>m.asOf),statuses=metadata.filter(m=>m.provider!=='application').map(m=>m.status);
  const status=statuses.includes('STALE')?'STALE':statuses.includes('COLLECTION_REQUIRED')?'COLLECTION_REQUIRED':statuses.length?'READY':'REFERENCE';
  return {...(primary??{}),provider:primary?.provider??'mixed',status,count:rows.length,asOf:dated.map(m=>m.asOf).sort().at(-1)??null,scope:primary?.scope??'MULTI_MARKET_CATALOG',sources:metadata};
}
export function searchUniverseCatalog(workspace,params,{now,owner=null}={}){
  const input=params instanceof URLSearchParams?Object.fromEntries(params):params??{};
  const allowed=['q','market','assetClass','assetType','sectorId','venue','quoteCurrency','cursor','limit','mindId'];if(Object.keys(input).some(k=>!allowed.includes(k)))fail('UNIVERSE_SEARCH_INPUT','검색 조건을 확인하세요.');
  const q=String(input.q??'').trim().toLocaleLowerCase(),market=input.market||null,assetClass=input.assetClass||null,assetType=input.assetType||null,sectorId=input.sectorId||null,venue=input.venue||null,quoteCurrency=input.quoteCurrency||null,limit=Number(input.limit??40);
  if(q.length>120||market&&!['KR','US'].includes(market)||assetClass&&!['equity','crypto'].includes(assetClass)||assetType&&!EQUITY_ASSET_TYPES.includes(assetType)||venue&&!SEARCH_VENUES.includes(venue)||quoteCurrency&&!SEARCH_CURRENCIES.includes(quoteCurrency)||sectorId&&!/^sector:toss-equity:[A-Za-z0-9_-]{1,40}$/.test(sectorId)||!Number.isSafeInteger(limit)||limit<1||limit>100)fail('UNIVERSE_SEARCH_INPUT','검색어·시장·거래소·통화와 페이지 크기를 확인하세요.');
  const sources=universeSourceState(workspace,now),catalog=sources.tossCatalog,selected=selectSectorSnapshot(sources.sectorSnapshots,{asOf:now}),sector=selected.snapshot;
  const latestSector=[...sources.sectorSnapshots].sort((a,b)=>b.availableAt.localeCompare(a.availableAt)||b.version-a.version)[0]??null,byInstrument=new Map();
  for(const row of [...(sector?.stockMemberships??[]),...(sector?.etfRelations??[])]){if(!byInstrument.has(row.instrumentId))byInstrument.set(row.instrumentId,new Set());byInstrument.get(row.instrumentId).add(row.sectorId);}
  const all=new Map(stockCatalog(sources.sectorSnapshots,catalog).map(i=>[i.id,i]));for(const i of sources.upbitSnapshot?.instruments??[])all.set(i.id,{...getInstrument(i.id),...i});
  const items=[...all.values()].map(i=>({...i,...(i.assetClass==='equity'?{marketCountry:i.marketCountry??(i.venue==='KRX'?'KR':'US'),assetType:equityAssetType(i)}:{}),sectorIds:[...(byInstrument.get(i.id)??[])],listingEvidence:i.provider==='toss'?'TOSS_ACTIVE_LISTING':i.venue==='UPBIT'?'UPBIT_MARKET_LISTING':'APPLICATION_CATALOG',executionAllowed:false}));
  const scoped=items.filter(i=>(!market||i.marketCountry===market)&&(!assetClass||i.assetClass===assetClass)&&(!assetType||i.assetType===assetType)&&(!sectorId||i.assetClass==='equity')&&(!venue||i.venue===venue)&&(!quoteCurrency||i.quoteCurrency===quoteCurrency));
  const filtered=scoped.filter(i=>(!q||[i.name,i.englishName,i.symbol,i.id].filter(Boolean).some(v=>v.toLocaleLowerCase().includes(q)))&&(!sectorId||i.sectorIds.includes(sectorId))).sort((a,b)=>a.symbol.localeCompare(b.symbol)||a.id.localeCompare(b.id));
  const sourceHash=hashInputPackage({catalog:catalog?.snapshot.contentHash??null,upbit:sources.upbitSnapshot?.contentHash??null,sector:latestSector?.contentHash??null,sectorStatus:selected.status}),queryHash=hashInputPackage({q,market,assetClass,assetType,sectorId,venue,quoteCurrency,limit,sourceHash,owner});let offset=0;
  if(input.cursor){const parts=input.cursor.split(':');if(parts.length!==2||parts[0]!==queryHash||!/^\d+$/.test(parts[1]))fail('UNIVERSE_SEARCH_CURSOR','종목 목록이 갱신되었습니다. 첫 페이지부터 검색하세요.',409);offset=Number(parts[1]);if(!Number.isSafeInteger(offset)||offset>filtered.length)fail('UNIVERSE_SEARCH_CURSOR','검색 페이지를 확인하세요.');}
  const sectorCoverage=sector?.coverage??[],requestedCountries=market?[market]:venue==='KRX'||quoteCurrency==='KRW'?['KR']:['NASDAQ','NYSE','NYSE_ARCA','AMEX','US_ETC'].includes(venue)||quoteCurrency==='USD'?['US']:['KR','US'];
  const requiredTypes=assetType==='etf'?['ETF']:assetType?['COMMON_STOCK']:['COMMON_STOCK','ETF'];
  const covered=sectorId?requestedCountries.every(marketCountry=>requiredTypes.every(instrumentType=>hasSectorMembershipCoverage(sectorCoverage,{sectorId,marketCountry,instrumentType}))):false;
  const source=catalogSearchSources(sources,scoped,{assetClass,market,venue,assetType,sectorId,quoteCurrency},now),equities=scoped.filter(i=>i.assetClass==='equity');
  const sectorStatus=assetClass==='crypto'||['UPBIT','OKX'].includes(venue)||['BTC','USDT'].includes(quoteCurrency)?'NOT_APPLICABLE':selected.status==='STALE'?'STALE':sectorId?covered?'READY':'COLLECTION_REQUIRED':sector?'PARTIAL':'COLLECTION_REQUIRED';
  const facets={markets:['KR','US'].map(id=>({id,count:scoped.filter(i=>i.marketCountry===id).length})),assetTypes:EQUITY_ASSET_TYPES.map(id=>({id,count:scoped.filter(i=>i.assetType===id).length})),venues:SEARCH_VENUES.map(id=>({id,count:scoped.filter(i=>i.venue===id).length})),quoteCurrencies:SEARCH_CURRENCIES.map(id=>({id,count:scoped.filter(i=>i.quoteCurrency===id).length}))};
  return {items:clone(filtered.slice(offset,offset+limit)),total:filtered.length,nextCursor:offset+limit<filtered.length?queryHash+':'+(offset+limit):null,asOf:source.asOf,source:{...source,contentHash:sourceHash},facets,coverage:{sectorStatus,classifiedCount:equities.filter(i=>i.sectorIds.length).length,unclassifiedCount:equities.filter(i=>!i.sectorIds.length).length,sectorAsOf:latestSector?.asOf??null,sectorSnapshotRef:selected.ref??null,scopes:clone(sectorCoverage)}};
}
function stockCatalog(sectorSnapshots=[],tossCatalog=null){const items=new Map(listInstruments().map(i=>[i.id,i]));for(const snapshot of [...sectorSnapshots].sort((a,b)=>a.availableAt.localeCompare(b.availableAt))){const names=new Map(snapshot.captures.flatMap(c=>[...(c.normalized.stocks??[]),...(c.normalized.etfs??[])].map(row=>[c.params.marketCountry+':'+row.symbol,row.name])));for(const mapping of snapshot.instrumentMappings){const identity=getInstrument(mapping.instrumentId,{resolution:{candidates:[{id:mapping.instrumentId,instrumentType:mapping.instrumentType}]}}),name=names.get(mapping.marketCountry+':'+mapping.providerSymbol);items.set(identity.id,{...identity,...(name?{name}:{}),instrumentType:mapping.instrumentType,marketCountry:mapping.marketCountry});}}for(const item of tossCatalog?.instruments??[])items.set(item.id,item);return [...items.values()].map(i=>i.assetClass==='equity'?{...i,marketCountry:i.marketCountry??(i.venue==='KRX'?'KR':'US')}:i);}
export function universeSourceState(workspace,now){
  const stored=list(workspace.universeSourceSnapshots);
  return {tossCatalog:currentTossCatalog(workspace,now),upbitSnapshot:latest(stored,'UPBIT_MARKET_SNAPSHOT',now),sectorSnapshots:stored.filter(e=>e.snapshot?.contractVersion==='MARKET_SECTOR_SNAPSHOT_V1'&&e.importedAt<=now&&e.snapshot.availableAt<=now).map(e=>e.snapshot)};
}
export function universeCatalog(workspace,manifest,{now,env={}}={}){
  const sources=universeSourceState(workspace,now),sectorSnapshot=[...sources.sectorSnapshots].sort((a,b)=>b.availableAt.localeCompare(a.availableAt)||b.version-a.version)[0]??null;
  const seedIds=new Set(listInstruments().map(i=>i.id)),selectedIds=new Set(manifest?.data?.universe?.instrumentIds??[]);
  const instruments=new Map(stockCatalog(sources.sectorSnapshots,sources.tossCatalog).map(i=>[i.id,i]));
  for(const item of sources.upbitSnapshot?.instruments??[])instruments.set(item.id,{...getInstrument(item.id),...item});
  for(const item of manifest?.data?.universe?.resolution?.candidates??[])instruments.set(item.id,item);
  return {asOf:now,policy:clone(manifest?.data?.universe??null),instruments:[...instruments.values()].filter(i=>!sources.tossCatalog||i.assetClass==='crypto'||seedIds.has(i.id)||selectedIds.has(i.id)),equities:tossCatalogMetadata(sources.tossCatalog,now),search:{endpoint:'/api/workspace/universe/search',maxLimit:100,filters:['q','market','assetClass','assetType','sectorId','venue','quoteCurrency']},sectorCoverage:sectorSnapshot?clone(sectorSnapshot.coverage):[],upbit:sources.upbitSnapshot?{id:sources.upbitSnapshot.id,asOf:sources.upbitSnapshot.asOf,availableAt:sources.upbitSnapshot.availableAt,count:sources.upbitSnapshot.instruments.length,contentHash:sources.upbitSnapshot.contentHash,status:Date.parse(now)-Date.parse(sources.upbitSnapshot.asOf)<=86400000?'READY':'STALE'}:{status:'COLLECTION_REQUIRED'},sectors:sectorSnapshot?clone(sectorSnapshot.sectors):[],sectorSnapshotRef:sectorSnapshot?{id:sectorSnapshot.id,version:sectorSnapshot.version,contentHash:sectorSnapshot.contentHash,availableAt:sectorSnapshot.availableAt}:null,toss:{status:env.TOSS_ACCESS_TOKEN?'CONFIGURED':'CONNECTION_REQUIRED',importAvailable:true},defaultMinimumOrderAmounts:clone(DEFAULT_MINIMUM_ORDER_AMOUNTS)};
}
export async function collectUniverseSource(body,{now,clock=()=>now,fetchImpl,sleep,workspace,db,owner,env={}}={}){
  if(Object.keys(body).some(k=>!['provider','snapshot','markets','sectorIds','expectedRevision','idempotencyKey'].includes(k)))fail('UNIVERSE_SOURCE_INPUT','수집할 공급처와 요청 키를 확인하세요.');
  if(!['toss','toss-stocks'].includes(body.provider)&&Object.hasOwn(body,'markets'))fail('UNIVERSE_SOURCE_INPUT','토스 섹터 수집에서 시장을 선택하세요.');
  if(body.provider!=='toss'&&Object.hasOwn(body,'sectorIds'))fail('UNIVERSE_SOURCE_INPUT','섹터 수집에서 섹터를 선택하세요.');
  if(body.provider==='toss-stocks'){
    if(Object.hasOwn(body,'snapshot'))fail('UNIVERSE_SOURCE_INPUT','연결된 토스증권에서 종목 목록을 조회하세요.');
    const markets=body.markets??['KR','US'];if(!Array.isArray(markets)||!markets.length||markets.length>2||new Set(markets).size!==markets.length||markets.some(m=>!['KR','US'].includes(m)))fail('TOSS_CATALOG_MARKETS','한국·미국 시장을 선택하세요.');
    const previous=currentTossCatalog(workspace,now);
    if(previous&&markets.every(market=>previous.snapshot.markets.some(m=>m.marketCountry===market)&&previous.snapshot.markets.filter(m=>m.marketCountry===market).every(m=>Date.parse(now)-Date.parse(m.receivedAt)<86400000)))return {entry:list(workspace.universeSourceSnapshots).find(entry=>entry.id===previous.snapshot.id),entries:[],cached:true};
    return withTossReadConnection({db,owner,env,fetchImpl,clock},accessToken=>collectTossStockCatalog({accessToken,markets,retainedCaptures:previous?.sourceCaptures??[],fetchImpl,clock,sleep,version:(previous?.snapshot.version??0)+1}));
  }
  if(body.provider==='upbit'){
    const snapshot=await collectUpbitMarketSnapshot({fetchImpl,now:clock,version:list(workspace.universeSourceSnapshots).filter(s=>s.snapshot?.kind==='UPBIT_MARKET_SNAPSHOT').length+1});
    return {id:snapshot.id,kind:'UPBIT_MARKET_SNAPSHOT',snapshot,importedAt:clock(),source:'PROVIDER_CAPTURE'};
  }
  if(body.provider==='toss-import'){
    const snapshot=clone(assertSectorSnapshot(body.snapshot));
    if(!stamp(snapshot.availableAt)||snapshot.availableAt>now)fail('SECTOR_IMPORT_TIME','현재까지 수집한 섹터 자료를 가져오세요.');
    // Import time is an independent owner-availability boundary; source timestamps stay intact.
    return {id:snapshot.id,kind:'SECTOR_SNAPSHOT',snapshot,importedAt:now,source:'OWNER_IMPORTED'};
  }
  if(body.provider==='toss'){
    if(Object.hasOwn(body,'snapshot'))fail('UNIVERSE_SOURCE_INPUT','연결된 토스증권에서 섹터 자료를 조회하세요.');
    const markets=body.markets??['KR','US'];if(!Array.isArray(markets)||markets.length<1||markets.length>2||new Set(markets).size!==markets.length||markets.some(m=>!['KR','US'].includes(m)))fail('SECTOR_MARKETS','한국·미국 시장을 선택하세요.');
    const sources=universeSourceState(workspace,now),previous=[...sources.sectorSnapshots].sort((a,b)=>b.availableAt.localeCompare(a.availableAt)||b.version-a.version)[0],catalog=stockCatalog(sources.sectorSnapshots,sources.tossCatalog),sourceHash=hashInputPackage(catalog);
    const instrumentMappings=catalog.filter(i=>i.assetClass==='equity').map(i=>({instrumentId:i.id,assetClass:'equity',instrumentType:equityAssetType(i)==='etf'?'ETF':'COMMON_STOCK',marketCountry:i.marketCountry??(i.id.split(':')[1]==='KRX'?'KR':'US'),providerSymbol:i.id.split(':').at(-1),sourceHash,availableAt:now}));
    const sectorIds=body.sectorIds??[];if(!Array.isArray(sectorIds)||sectorIds.length>8||new Set(sectorIds).size!==sectorIds.length||sectorIds.some(id=>!/^sector:toss-equity:[A-Za-z0-9_-]{1,40}$/.test(id)))fail('SECTOR_IDS','수집할 섹터를 8개 이내로 선택하세요.');
    const queries=sectorIds.flatMap(id=>markets.flatMap(marketCountry=>['getSectorStocks','getSectorEtfs'].map(operation=>({operation,marketCountry,sectorId:id.split(':').at(-1)}))));
    const snapshot=await withTossReadConnection({db,owner,env,fetchImpl,clock},accessToken=>collectTossSectorSnapshot({accessToken,queries,previousSnapshots:sources.sectorSnapshots,rankingQueries:markets.map(marketCountry=>({marketCountry,duration:'1w',type:'TOP_GAINERS'})),topRankedMemberCount:sectorIds.length?0:1,instrumentMappings,fetchImpl,now:clock,version:(previous?.version??0)+1,previousVersionId:previous?.id??null}));
    return {id:snapshot.id,kind:'SECTOR_SNAPSHOT',snapshot,importedAt:clock(),source:'PROVIDER_CAPTURE'};
  }
  fail('UNIVERSE_SOURCE_PROVIDER','업비트 목록 또는 토스 섹터 자료 수집을 선택하세요.');
}
export function buildUniverseDraft(workspace,current,input,{now,policyId,version}={}){
  const allowed=['crypto','equities','explicitIncludeIds','explicitExcludeIds','maxPositions','sectorLimits','minimumOrderAmounts','minHistoryBars'];
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!allowed.includes(k)))fail('UNIVERSE_DRAFT_INPUT','투자 범위의 시장·종목·제외 조건을 확인하세요.');
  const {minHistoryBars,...scopeInput}=input;
  if(Object.hasOwn(input,'minHistoryBars')&&(!Number.isSafeInteger(minHistoryBars)||minHistoryBars<1||minHistoryBars>999))fail('UNIVERSE_HISTORY_BARS','최소 시세 이력을 1~999봉의 정수로 입력하세요.');
  const policy=createUniversePolicy({...scopeInput,id:policyId,version,availableAt:now});
  const sources=universeSourceState(workspace,now);
  const all=stockCatalog(sources.sectorSnapshots,sources.tossCatalog);
  // Freeze only the candidate discovery scope, so a selected few stocks do not duplicate a full market catalogue in each mind.
  const sectors=[...sources.sectorSnapshots].sort((a,b)=>b.availableAt.localeCompare(a.availableAt)||b.version-a.version)[0];
  const sectorMembers=new Set([...(sectors?.stockMemberships??[]),...(policy.equities.includeRelatedEtfs?sectors?.etfRelations??[]:[])].filter(edge=>policy.equities.sectorIds.includes(edge.sectorId)).map(edge=>edge.instrumentId));
  const scope=sources.tossCatalog?all.filter(i=>i.assetClass==='crypto'||policy.explicitIncludeIds.includes(i.id)||policy.equities.enabled&&policy.equities.markets.includes(i.marketCountry)&&(!policy.equities.assetTypes?.length||policy.equities.assetTypes.includes(equityAssetType(i)))&&(!policy.equities.sectorIds.length||sectorMembers.has(i.id))):all;
  if(scope.filter(i=>i.assetClass==='equity'&&!policy.explicitExcludeIds.includes(i.id)).length>500)fail('UNIVERSE_TOO_LARGE','종목·섹터·자산 종류로 투자 범위를 500개 이내로 좁히세요.');
  const catalog=buildInstrumentCatalogSnapshot({id:policyId+'-catalog',version,instruments:scope,asOf:now,availableAt:now,origin:sources.tossCatalog?'TOSS_CATALOG_SELECTION:'+sources.tossCatalog.snapshot.contentHash:'APPLICATION_CATALOG'});
  const supportedExecutionIds=[...listInstruments().filter(i=>i.assetClass==='crypto').map(i=>i.id),...list(sources.upbitSnapshot?.instruments).map(i=>i.id)];
  const resolution=resolveUniversePolicy({policy,catalog,...sources,asOf:now,supportedExecutionIds});
  if(resolution.status!=='READY')fail('UNIVERSE_DATA_REQUIRED','투자 범위 자료를 먼저 준비하세요: '+resolution.unresolved.map(r=>r.code).join(', '),409);
  if(!resolution.candidateIds.length)fail('UNIVERSE_EMPTY','조건에 맞는 종목이 없습니다. 시장·종목·제외 조건을 조정하세요.');
  if(resolution.candidateIds.length>500)fail('UNIVERSE_TOO_LARGE','허용 종목을 500개 이내로 좁히세요.');
  const strategy=current.data.strategyPlan;
  if(strategy?.approval?.enabled&&!['UNIVERSE_CURRENT','EACH_ASSET'].includes(strategy.scope.instrumentPolicy)&&!resolution.candidateIds.includes(strategy.scope.instrumentId))fail('UNIVERSE_STRATEGY_SCOPE','사용 중인 고정 전략 종목을 유지하거나 전략 설정을 먼저 변경하세요.',409);
  const held=list(workspace.mindPositions).filter(a=>a.profileId===current.scope.profileId).flatMap(a=>list(a.positions)).filter(p=>p.quantity>0&&!resolution.candidateIds.includes(p.instrumentId));
  if(held.length)fail('UNIVERSE_HELD_POSITION','보유 중인 종목은 매도 후 투자 범위에서 제외하세요.',409);
  return {universe:{...clone(current.data.universe),mode:resolution.candidateIds.length===1?'single':'screened',instrumentIds:resolution.candidateIds,selection:{...clone(current.data.universe.selection),maxPositions:policy.maxPositions,...(Object.hasOwn(input,'minHistoryBars')?{minHistoryBars}:{})},scopePolicy:policy,resolution},catalog};
}
