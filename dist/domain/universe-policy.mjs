/** One frozen permission universe for news, selection, execution and simulation. */
import {hashInputPackage} from './workspace.mjs';
import {researchSha256} from './research.mjs';
import {DEFAULT_MINIMUM_ORDER_AMOUNTS,UPBIT_MINIMUM_ORDER_AMOUNTS} from './mind-currency.mjs';
export {DEFAULT_MINIMUM_ORDER_AMOUNTS} from './mind-currency.mjs';
import {instrumentSectorContext,matchSectorCoverage,selectSectorSnapshot,sectorSnapshotRef} from './market-sectors.mjs';
import {EQUITY_ASSET_TYPES,equityAssetType} from './toss-catalog.mjs';

export const UNIVERSE_POLICY_CONTRACT='MIND_UNIVERSE_POLICY_V1';
export const UNIVERSE_RESOLUTION_CONTRACT='MIND_UNIVERSE_RESOLUTION_V1';
export const CRYPTO_GROUP_POLICY='BASE_ASSET_BTC_V1';
export const UPBIT_DOCUMENT=Object.freeze({url:'https://docs.upbit.com/kr/reference/list-trading-pairs.md',sha256:'5fe1fc63971313f4d405bd4bda36597f54a63523dbdef3f53c8c25c148ca67f2',alertSemanticsUrl:'https://docs.upbit.com/kr/v1.6.4/changelog/market_event.md',alertSemanticsSha256:'c9533d48ea243ffd3e7241cc7ea06aa61464f11610d733b8f161fd70aea3cb55'});
const plain=v=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.getPrototypeOf(v)===Object.prototype;
const iso=v=>typeof v==='string'&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString()===v;
const id=v=>typeof v==='string'&&/^[A-Za-z0-9][A-Za-z0-9:._/-]{0,199}$/.test(v);
const sha=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const cmp=(a,b)=>a<b?-1:a>b?1:0;
const clone=v=>structuredClone(v);
function freeze(v){if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;}
const seal=value=>freeze({...value,contentHash:hashInputPackage(value)});
const withoutHash=({contentHash,...value})=>value;
const sealed=value=>plain(value)&&sha(value.contentHash)&&hashInputPackage(withoutHash(value))===value.contentHash;
export class UniverseError extends TypeError{constructor(code,message){super(message);this.name='UniverseError';this.code=code;}}
const check=(ok,code,message)=>{if(!ok)throw new UniverseError(code,message);};
const exact=(v,keys)=>plain(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const unique=(v,allowed)=>Array.isArray(v)&&new Set(v).size===v.length&&v.every(x=>allowed?allowed.includes(x):id(x));
const ref=value=>({id:value.id,version:value.version,contentHash:value.contentHash});
// Listing warnings remain in the immutable raw snapshot; permission candidates need identity metadata only.
const scopeCandidate=item=>item.id.startsWith('crypto:upbit:')?Object.fromEntries(['id','symbol','name','englishName','assetClass','instrumentType','exchange','venue','baseAsset','quoteCurrency','assetGroup','classificationPolicy'].filter(k=>Object.hasOwn(item,k)).map(k=>[k,clone(item[k])])):clone(item);
export const cryptoAssetGroup=baseAsset=>{check(typeof baseAsset==='string'&&/^[A-Z0-9]{1,30}$/.test(baseAsset),'CRYPTO_BASE_ASSET','명시된 기준 자산을 확인하세요.');return baseAsset==='BTC'?'bitcoin':'alt';};

export function normalizeUpbitMarketCapture({id:captureId,version=1,rawBody,isDetails=true,requestStartedAt,receivedAt,availableAt,expectedRawBodySha256=null,origin='SYNTHETIC_TEST'}){
  check(id(captureId)&&Number.isSafeInteger(version)&&version>0&&typeof isDetails==='boolean'&&['SYNTHETIC_TEST','PROVIDER_CAPTURE'].includes(origin),'UPBIT_CAPTURE','페어 원본 식별자를 확인하세요.');
  check(typeof rawBody==='string'&&new TextEncoder().encode(rawBody).byteLength<=2000000&&[requestStartedAt,receivedAt,availableAt].every(iso)&&requestStartedAt<=receivedAt&&receivedAt<=availableAt,'UPBIT_CAPTURE_TIME','페어 원문과 요청·수신·사용 가능 시각을 확인하세요.');
  const rawBodySha256=researchSha256(rawBody);check(expectedRawBodySha256===null||expectedRawBodySha256===rawBodySha256,'UPBIT_RAW_HASH','페어 원문 해시가 다릅니다.');
  let body;try{body=JSON.parse(rawBody);}catch{throw new UniverseError('UPBIT_JSON','페어 JSON 원문을 확인하세요.');}
  check(Array.isArray(body)&&body.length<=10000,'UPBIT_MARKETS','페어 목록 배열을 확인하세요.');const instruments=new Map();
  for(const row of body){check(plain(row)&&typeof row.market==='string'&&/^(?:KRW|BTC|USDT)-[A-Z0-9]{1,30}$/.test(row.market)&&typeof row.korean_name==='string'&&row.korean_name.trim()&&typeof row.english_name==='string'&&row.english_name.trim(),'UPBIT_PAIR','거래쌍 코드·종목명을 확인하세요.');
    const [quoteCurrency,baseAsset]=row.market.split('-'),event=row.market_event;
    if(event!==undefined)check(plain(event)&&typeof event.warning==='boolean'&&plain(event.caution)&&Object.entries(event.caution).every(([key,value])=>/^[A-Z_]{1,100}$/.test(key)&&typeof value==='boolean'),'UPBIT_ALERT','현재 market_event 원본을 확인하세요.');
    const instrument={id:'crypto:upbit:'+row.market,symbol:row.market,name:row.korean_name,englishName:row.english_name,assetClass:'crypto',instrumentType:'SPOT',exchange:'upbit',venue:'UPBIT',baseAsset,quoteCurrency,assetGroup:cryptoAssetGroup(baseAsset),classificationPolicy:CRYPTO_GROUP_POLICY,marketEvent:event?clone(event):null,alertDataStatus:event?'PROVIDED':isDetails?'MISSING':'NOT_REQUESTED',legacyMarketWarningPresent:Object.hasOwn(row,'market_warning')};
    const prior=instruments.get(instrument.id);check(!prior||hashInputPackage(prior)===hashInputPackage(instrument),'UPBIT_PAIR_CONFLICT','같은 거래쌍의 원본 값이 다릅니다.');instruments.set(instrument.id,instrument);
  }
  return seal({schemaVersion:1,kind:'UPBIT_MARKET_SNAPSHOT',id:captureId,version,origin,transportVerification:'CALLER_RESPONSIBILITY',url:'https://api.upbit.com/v1/market/all?is_details='+isDetails,documentation:UPBIT_DOCUMENT,isDetails,requestStartedAt,receivedAt,asOf:receivedAt,asOfKind:'RESPONSE_RECEIVED',sourceAsOf:null,availableAt,rawBody,rawBodySha256,instruments:[...instruments.values()].sort((a,b)=>cmp(a.id,b.id))});
}
export function assertUpbitMarketSnapshot(value){check(sealed(value)&&value.kind==='UPBIT_MARKET_SNAPSHOT','UPBIT_SNAPSHOT_HASH','페어 스냅샷 해시를 확인하세요.');const rebuilt=normalizeUpbitMarketCapture({...value,expectedRawBodySha256:value.rawBodySha256});check(rebuilt.contentHash===value.contentHash,'UPBIT_SNAPSHOT_PROJECTION','페어 정본과 파생 종목이 다릅니다.');return value;}

export const UPBIT_ENTRY_ELIGIBILITY_CONTRACT=Object.freeze({id:'upbit-entry-eligibility-v1',provider:'upbit',sourceUrl:'https://api.upbit.com/v1/market/all?is_details=true',appliesTo:['NEW_BUY','ADD'],excluded:['UNLISTED','ALERT_DATA_MISSING','INVESTMENT_WARNING'],cautions:'INFORMATIONAL',maxSourceAgeMs:60000,sells:'UNCHANGED'});
/** Warning exclusion covers scheduled delistings already designated as investment warnings. */
export function resolveUpbitEntryEligibility(snapshot,{marketIds,asOf}={}){
 assertUpbitMarketSnapshot(snapshot);
 check(iso(asOf)&&snapshot.availableAt<=asOf&&Date.parse(asOf)-Date.parse(snapshot.asOf)<=UPBIT_ENTRY_ELIGIBILITY_CONTRACT.maxSourceAgeMs,'UPBIT_ELIGIBILITY_TIME','신규 매수용 거래소 종목 정보를 새로 조회하세요.');
 check(Array.isArray(marketIds)&&marketIds.every(m=>typeof m==='string'&&/^(KRW|BTC|USDT)-[A-Z0-9]{1,30}$/.test(m)),'UPBIT_ELIGIBILITY_MARKETS','신규 매수의 거래쌍을 확인하세요.');
 const listed=new Map(snapshot.instruments.map(i=>[i.symbol,i])),markets={};
 for(const market of marketIds){const item=listed.get(market),reason=!item?'UNLISTED':item.alertDataStatus!=='PROVIDED'?'ALERT_DATA_MISSING':item.marketEvent.warning?'INVESTMENT_WARNING':null;markets[market]={allowed:reason===null,reason,marketEvent:item?.marketEvent??null};}
 // shortcut: market/all has no termination date; add official notice ingestion when exact lifecycle dates are required.
 return {contractVersion:UPBIT_ENTRY_ELIGIBILITY_CONTRACT.id,asOf:snapshot.asOf,availableAt:snapshot.availableAt,sourceRef:{id:snapshot.id,contentHash:snapshot.contentHash,sourceRef:snapshot.url,rawBodySha256:snapshot.rawBodySha256},markets};
}

export function buildInstrumentCatalogSnapshot({id:catalogId,version=1,instruments,asOf,availableAt,origin='SYNTHETIC_TEST'}){
  check(id(catalogId)&&Number.isSafeInteger(version)&&version>0&&iso(asOf)&&iso(availableAt)&&asOf<=availableAt&&Array.isArray(instruments)&&instruments.length<=10000,'UNIVERSE_CATALOG','정본 종목 목록과 버전을 확인하세요.');const rows=new Map();
  for(const value of instruments){check(plain(value)&&id(value.id)&&['crypto','equity'].includes(value.assetClass)&&typeof value.symbol==='string','UNIVERSE_INSTRUMENT','거래소가 구분된 종목 ID를 확인하세요.');const row=clone(value);
    if(row.assetClass==='crypto'){check(row.id.startsWith('crypto:')&&typeof row.baseAsset==='string'&&typeof row.quoteCurrency==='string','UNIVERSE_CRYPTO_ID','코인 기준 자산·결제 통화를 확인하세요.');row.exchange=row.id.split(':')[1];row.assetGroup=cryptoAssetGroup(row.baseAsset);if(row.exchange==='upbit')check(row.id==='crypto:upbit:'+row.quoteCurrency+'-'+row.baseAsset,'UNIVERSE_EXCHANGE_ID','업비트의 거래소·결제 통화·기준 자산을 유지하세요.');if(row.exchange==='okx')check(row.id==='crypto:okx:'+row.baseAsset+'-'+row.quoteCurrency,'UNIVERSE_EXCHANGE_ID','OKX의 거래소·기준 자산·결제 통화를 유지하세요.');}
    else {const parts=row.id.split(':'),country=({KRX:'KR',NASDAQ:'US',NYSE:'US',NYSE_ARCA:'US',AMEX:'US',US_ETC:'US'})[parts[1]];check(parts.length===3&&parts[0]==='equity'&&parts[1]===row.venue&&parts[2]===row.symbol&&country,'UNIVERSE_EQUITY_ID','주식의 정본 종목 ID·거래소·심볼을 일치시키세요.');row.marketCountry=row.marketCountry??country;check(row.marketCountry===country,'UNIVERSE_EQUITY_MARKET','주식 시장과 정본 거래소의 국가를 일치시키세요.');}
    const prior=rows.get(row.id);check(!prior||hashInputPackage(prior)===hashInputPackage(row),'UNIVERSE_ID_CONFLICT','동일 종목 ID의 정의가 다릅니다.');rows.set(row.id,row);
  }
  return seal({schemaVersion:1,kind:'INSTRUMENT_CATALOG_SNAPSHOT',id:catalogId,version,asOf,availableAt,origin,instruments:[...rows.values()].sort((a,b)=>cmp(a.id,b.id))});
}

export function createUniversePolicy({id:policyId,version=1,availableAt,crypto,equities,explicitIncludeIds=[],explicitExcludeIds=[],maxPositions,sectorLimits=[],minimumOrderAmounts=DEFAULT_MINIMUM_ORDER_AMOUNTS}){
  check(id(policyId)&&Number.isSafeInteger(version)&&version>0&&iso(availableAt),'UNIVERSE_POLICY_ID','정책 버전·사용 가능 시각을 확인하세요.');
  check(exact(crypto,['enabled','exchanges','quoteMarkets','assetGroups','excludeWarnings','excludeCautions'])&&typeof crypto.enabled==='boolean'&&unique(crypto.exchanges,['upbit','okx'])&&unique(crypto.quoteMarkets,['KRW','BTC','USDT'])&&unique(crypto.assetGroups,['bitcoin','alt'])&&typeof crypto.excludeWarnings==='boolean'&&typeof crypto.excludeCautions==='boolean'&&(!crypto.enabled||crypto.exchanges.length&&crypto.quoteMarkets.length&&crypto.assetGroups.length),'UNIVERSE_CRYPTO_POLICY','거래소·결제 시장·비트코인/알트 범위를 명시하세요.');
  check(exact(equities,['enabled','markets','sectorIds','includeRelatedEtfs',...(Object.hasOwn(equities??{},'assetTypes')?['assetTypes']:[])])&&typeof equities.enabled==='boolean'&&unique(equities.markets,['KR','US'])&&unique(equities.sectorIds)&&equities.sectorIds.every(v=>v.startsWith('sector:toss-equity:'))&&typeof equities.includeRelatedEtfs==='boolean'&&(!equities.enabled||equities.markets.length)&&(!Object.hasOwn(equities,'assetTypes')||unique(equities.assetTypes,EQUITY_ASSET_TYPES)),'UNIVERSE_EQUITY_POLICY','주식 시장·섹터·자산 종류를 확인하세요.');
  check(unique(explicitIncludeIds)&&unique(explicitExcludeIds)&&Number.isSafeInteger(maxPositions)&&maxPositions>=1&&maxPositions<=500&&Array.isArray(sectorLimits)&&sectorLimits.length<=100,'UNIVERSE_LIMITS','명시 종목·제외 종목·동시 보유 한도를 확인하세요.');
  check(new Set(sectorLimits.map(l=>l?.sectorId)).size===sectorLimits.length&&sectorLimits.every(l=>exact(l,['sectorId','maxPositions'])&&id(l.sectorId)&&l.sectorId.startsWith('sector:toss-equity:')&&Number.isSafeInteger(l.maxPositions)&&l.maxPositions>=0&&l.maxPositions<=maxPositions),'UNIVERSE_SECTOR_LIMIT','섹터별 동시 보유 수를 확인하세요.');
  check(exact(minimumOrderAmounts,['KRW','BTC','USDT','USD'])&&Object.values(minimumOrderAmounts).every(v=>typeof v==='number'&&Number.isFinite(v)&&v>0)&&Object.entries(UPBIT_MINIMUM_ORDER_AMOUNTS).every(([currency,floor])=>minimumOrderAmounts[currency]>=floor),'UNIVERSE_MINIMUM_ORDER','통화별 최소 주문금액과 업비트 시장 하한을 확인하세요.');
  return seal({schemaVersion:1,contractVersion:UNIVERSE_POLICY_CONTRACT,id:policyId,version,availableAt,crypto:clone(crypto),equities:clone(equities),explicitIncludeIds:[...explicitIncludeIds].sort(cmp),explicitExcludeIds:[...explicitExcludeIds].sort(cmp),maxPositions,sectorLimits:clone(sectorLimits).sort((a,b)=>cmp(a.sectorId,b.sectorId)),minimumOrderAmounts:clone(minimumOrderAmounts),selectionPolicy:'CATEGORY_UNION_EXPLICIT_INCLUDE_MINUS_EXCLUDE_V1',exitPolicy:'ALLOW_EXISTING_HOLDING_REDUCTION'});
}
export function assertUniversePolicy(policy){check(sealed(policy)&&policy.contractVersion===UNIVERSE_POLICY_CONTRACT,'UNIVERSE_POLICY_HASH','투자 범위 정책의 해시를 확인하세요.');const rebuilt=createUniversePolicy(policy);check(rebuilt.contentHash===policy.contentHash,'UNIVERSE_POLICY_FIELDS','투자 범위 정책의 정본 필드를 확인하세요.');return policy;}

export function resolveUniversePolicy({policy,catalog,upbitSnapshot=null,sectorSnapshots=[],sectorSnapshotPin=null,asOf,maxSourceAgeMs=86400000,supportedExecutionIds=[]}){
  assertUniversePolicy(policy);check(iso(asOf)&&policy.availableAt<=asOf,'UNIVERSE_POLICY_TIME','해당 시각에 사용 가능한 정책을 고정하세요.');check(sealed(catalog)&&catalog.kind==='INSTRUMENT_CATALOG_SNAPSHOT'&&catalog.asOf<=asOf&&catalog.availableAt<=asOf&&buildInstrumentCatalogSnapshot(catalog).contentHash===catalog.contentHash,'UNIVERSE_CATALOG_TIME','해당 시각의 종목 목록을 확인하세요.');check(Number.isSafeInteger(maxSourceAgeMs)&&maxSourceAgeMs>=0&&unique(supportedExecutionIds),'UNIVERSE_READ_POLICY','자료 나이·실제 실행 지원 ID를 확인하세요.');
  const unresolved=[],excluded=[],sources=[{kind:'catalog',...ref(catalog),asOf:catalog.asOf,availableAt:catalog.availableAt}],items=new Map(catalog.instruments.map(i=>[i.id,i]));let upbit=null,sectorRef=null;
  const wantsUpbit=policy.crypto.enabled&&policy.crypto.exchanges.includes('upbit')||policy.explicitIncludeIds.some(id=>id.startsWith('crypto:upbit:'));
  if(wantsUpbit){if(!upbitSnapshot)unresolved.push({code:'UPBIT_SNAPSHOT_REQUIRED'});else{assertUpbitMarketSnapshot(upbitSnapshot);if(upbitSnapshot.asOf>asOf||upbitSnapshot.availableAt>asOf||Date.parse(asOf)-Date.parse(upbitSnapshot.asOf)>maxSourceAgeMs)unresolved.push({code:'UPBIT_SNAPSHOT_TIME'});else{upbit=upbitSnapshot;sources.push({kind:'upbit-markets',...ref(upbit),asOf:upbit.asOf,availableAt:upbit.availableAt,rawBodySha256:upbit.rawBodySha256});for(const row of upbit.instruments){const prior=items.get(row.id);check(!prior||prior.baseAsset===row.baseAsset&&prior.quoteCurrency===row.quoteCurrency,'UNIVERSE_ID_CONFLICT','거래쌍의 자산 정의가 다릅니다.');items.set(row.id,{...prior,...row});}}}}
  const wantsSectors=policy.equities.enabled&&policy.equities.sectorIds.length>0||policy.sectorLimits.length>0;
  if(wantsSectors||sectorSnapshots.length||sectorSnapshotPin){const selected=selectSectorSnapshot(sectorSnapshots,{asOf,expectedRef:sectorSnapshotPin,maxAgeMs:maxSourceAgeMs});if(!selected.snapshot){if(wantsSectors||sectorSnapshotPin)unresolved.push({code:'SECTOR_'+selected.status});}else{sectorRef=sectorSnapshotRef(selected.snapshot);sources.push({kind:'equity-sectors',...sectorRef,asOf:selected.snapshot.asOf,availableAt:selected.snapshot.availableAt,sourceRefs:clone(selected.snapshot.sourceRefs),mappingHash:selected.snapshot.mappingHash});for(const sectorId of new Set([...(policy.equities.enabled?policy.equities.sectorIds:[]),...policy.sectorLimits.map(l=>l.sectorId)]))if(!selected.snapshot.sectors.some(s=>s.id===sectorId))unresolved.push({code:'SECTOR_ID_NOT_FOUND',sectorId});}}
  const eligible=[],contexts={};
  for(const item of [...items.values()].sort((a,b)=>cmp(a.id,b.id))){
    const reasons=[],explicit=policy.explicitIncludeIds.includes(item.id);let category=false;
    if(item.assetClass==='crypto'){
      const exchange=item.exchange||item.id.split(':')[1];category=policy.crypto.enabled&&policy.crypto.exchanges.includes(exchange)&&policy.crypto.quoteMarkets.includes(item.quoteCurrency)&&policy.crypto.assetGroups.includes(cryptoAssetGroup(item.baseAsset));
      if(exchange==='upbit'&&(category||explicit)){const actual=upbit?.instruments.find(i=>i.id===item.id);if(!actual)reasons.push('UPBIT_LISTING_REQUIRED');else if(policy.crypto.excludeWarnings||policy.crypto.excludeCautions){if(actual.alertDataStatus!=='PROVIDED')reasons.push('UPBIT_ALERT_DATA_REQUIRED');else{if(policy.crypto.excludeWarnings&&actual.marketEvent.warning)reasons.push('UPBIT_WARNING');if(policy.crypto.excludeCautions&&Object.values(actual.marketEvent.caution).some(Boolean))reasons.push('UPBIT_CAUTION');}}}
    }else if(item.assetClass==='equity'){
      const market=policy.equities.enabled&&policy.equities.markets.includes(item.marketCountry)&&(!policy.equities.assetTypes?.length||policy.equities.assetTypes.includes(equityAssetType(item)));category=!!market&&!policy.equities.sectorIds.length;
      if(market&&policy.equities.sectorIds.length&&sectorRef){const match=matchSectorCoverage(sectorSnapshots,{instrumentId:item.id,sectorIds:policy.equities.sectorIds,asOf,expectedRef:sectorRef,maxAgeMs:maxSourceAgeMs,includeRelatedEtfs:policy.equities.includeRelatedEtfs});category=match.match===true;contexts[item.id]=match.context;if(match.match===null&&!explicit)reasons.push('SECTOR_'+match.status);}
    }
    if(!category&&!explicit)reasons.push('OUTSIDE_SELECTED_SCOPE');if(policy.explicitExcludeIds.includes(item.id))reasons.push('EXPLICITLY_EXCLUDED');
    if(reasons.length)excluded.push({instrumentId:item.id,reasons});else eligible.push({...scopeCandidate(item),executionAdapterConnected:supportedExecutionIds.includes(item.id)});
  }
  for(const instrumentId of policy.explicitIncludeIds)if(!items.has(instrumentId))unresolved.push({code:'EXPLICIT_INSTRUMENT_UNAVAILABLE',instrumentId});
  if(sectorRef)for(const item of eligible.filter(i=>i.assetClass==='equity'))contexts[item.id]=instrumentSectorContext(sectorSnapshots,{instrumentId:item.id,asOf,expectedRef:sectorRef,maxAgeMs:maxSourceAgeMs});
  check(eligible.length<=500,'UNIVERSE_CANDIDATE_LIMIT','최종 투자 범위는 500개 종목 이내로 좁혀 주세요.');
  return seal({schemaVersion:1,contractVersion:UNIVERSE_RESOLUTION_CONTRACT,asOf,policyRef:ref(policy),policy:clone(policy),status:unresolved.length?'DATA_REQUIRED':'READY',candidateIds:unresolved.length?[]:eligible.map(i=>i.id),candidates:unresolved.length?[]:eligible,previewCandidateIds:unresolved.length?eligible.map(i=>i.id):[],excluded,unresolved,sourceRefs:sources,sectorSnapshotRef:sectorRef,sectorContexts:contexts,sourcePolicy:{maxSourceAgeMs,cryptoClassification:CRYPTO_GROUP_POLICY,exchangeSubstitutionAllowed:false},maxPositions:policy.maxPositions,sectorLimits:clone(policy.sectorLimits)});
}

/** Pass this exact reference to every consumer instead of independently resolving latest sources. */
export function universeResolutionRef(resolution){check(sealed(resolution)&&resolution.contractVersion===UNIVERSE_RESOLUTION_CONTRACT,'UNIVERSE_RESOLUTION_HASH','투자 범위 정본 해시를 확인하세요.');return {contentHash:resolution.contentHash,policyRef:clone(resolution.policyRef),asOf:resolution.asOf};}
export function assertUniverseMember(resolution,instrumentId,{expectedResolutionHash=resolution?.contentHash}={}){
  universeResolutionRef(resolution);check(resolution.contentHash===expectedResolutionHash,'UNIVERSE_RESOLUTION_CHANGED','뉴스·선정·실행·실험의 범위 해시를 일치시키세요.');check(resolution.status==='READY','UNIVERSE_DATA_REQUIRED','투자 범위의 미확보 원본을 먼저 준비하세요.');check(resolution.candidateIds.includes(instrumentId),'UNIVERSE_INSTRUMENT_EXCLUDED','정확한 거래소·종목 ID가 허용 목록에 없습니다.');return true;
}
/** Validate a frozen permission projection. Source authenticity is verified on write by the owner source repository. */
export function assertUniverseResolution(resolution,{asOf=resolution?.asOf}={}){
  universeResolutionRef(resolution);assertUniversePolicy(resolution.policy);
  check(iso(asOf)&&iso(resolution.asOf)&&resolution.asOf<=asOf&&resolution.policy.availableAt<=resolution.asOf,'UNIVERSE_RESOLUTION_TIME','해당 시각 이전에 확정된 투자 범위를 사용하세요.');
  check(hashInputPackage(resolution.policyRef)===hashInputPackage(ref(resolution.policy))&&['READY','DATA_REQUIRED'].includes(resolution.status)&&unique(resolution.candidateIds)&&resolution.candidateIds.length<=500&&Array.isArray(resolution.candidates)&&hashInputPackage(resolution.candidateIds)===hashInputPackage(resolution.candidates.map(i=>i.id))&&new Set(resolution.candidates.map(i=>i.id)).size===resolution.candidates.length,'UNIVERSE_RESOLUTION_FIELDS','고정 정책과 실제 후보 종목의 ID를 일치시키세요.');
  check(resolution.maxPositions===resolution.policy.maxPositions&&hashInputPackage(resolution.sectorLimits)===hashInputPackage(resolution.policy.sectorLimits)&&Array.isArray(resolution.sourceRefs)&&resolution.sourceRefs.length>0,'UNIVERSE_RESOLUTION_POLICY','투자 범위와 보유 한도·원본 참조를 일치시키세요.');
  for(const source of resolution.sourceRefs){check(id(source.id)&&Number.isSafeInteger(source.version)&&source.version>0&&sha(source.contentHash)&&iso(source.asOf)&&iso(source.availableAt)&&source.asOf<=source.availableAt&&source.availableAt<=resolution.asOf,'UNIVERSE_SOURCE_TIME','범위 원본의 기준·사용 가능 시각을 확인하세요.');for(const capture of source.sourceRefs||[])check(iso(capture.receivedAt)&&iso(capture.availableAt)&&capture.receivedAt<=capture.availableAt&&capture.availableAt<=resolution.asOf,'UNIVERSE_SOURCE_TIME','섹터 원본의 수신·사용 가능 시각을 확인하세요.');}
  check(plain(resolution.sectorContexts),'UNIVERSE_SECTOR_CONTEXT','고정 섹터 맥락을 확인하세요.');
  for(const [instrumentId,context] of Object.entries(resolution.sectorContexts)){check(context.instrumentId===instrumentId&&(!context.asOf||iso(context.asOf)&&context.asOf<=resolution.asOf)&&(!context.availableAt||iso(context.availableAt)&&context.availableAt<=resolution.asOf)&&(!context.snapshotRef||context.snapshotRef.contentHash===resolution.sectorSnapshotRef?.contentHash),'UNIVERSE_SECTOR_CONTEXT','같은 스냅샷의 종목별 섹터 맥락을 사용하세요.');for(const source of context.sourceRefs||[])check(iso(source.receivedAt)&&iso(source.availableAt)&&source.receivedAt<=source.availableAt&&source.availableAt<=resolution.asOf,'UNIVERSE_SOURCE_TIME','뉴스와 종목 선정에 사용한 원본의 시각을 확인하세요.');}
  return resolution;
}

/** No latest-source lookup occurs here: every consumer uses the same saved policy resolution. */
export function resolveMindInvestmentScope(manifest,{asOf=new Date().toISOString()}={}){
  check(iso(asOf),'UNIVERSE_READ_TIME','투자 범위 검사 시각을 확인하세요.');const universe=(manifest?.data??manifest)?.universe;
  check(plain(universe)&&unique(universe.instrumentIds)&&universe.instrumentIds.length>0&&universe.instrumentIds.length<=500,'MIND_UNIVERSE','마인드의 허용 종목 목록을 확인하세요.');
  const hasPolicy=Object.hasOwn(universe,'scopePolicy'),hasResolution=Object.hasOwn(universe,'resolution');check(hasPolicy===hasResolution,'UNIVERSE_RESOLUTION_REQUIRED','투자 범위 정책과 고정 해석 결과를 함께 저장하세요.');
  if(!hasPolicy)return seal({schemaVersion:1,contractVersion:UNIVERSE_RESOLUTION_CONTRACT,legacy:true,asOf:null,policyRef:null,status:'READY',candidateIds:[...universe.instrumentIds],candidates:[],sourceRefs:[],sectorSnapshotRef:null,sectorContexts:{},maxPositions:universe.selection?.maxPositions??universe.instrumentIds.length,sectorLimits:[]});
  assertUniversePolicy(universe.scopePolicy);const resolution=assertUniverseResolution(universe.resolution,{asOf});
  check(resolution.policyRef.contentHash===universe.scopePolicy.contentHash&&hashInputPackage(universe.instrumentIds)===hashInputPackage(resolution.candidateIds)&&universe.selection?.maxPositions===resolution.maxPositions,'UNIVERSE_MANIFEST_MISMATCH','마인드의 허용 목록·보유 한도를 고정 투자 범위와 일치시키세요.');
  check(resolution.status==='READY','UNIVERSE_DATA_REQUIRED','투자 범위에 필요한 원본을 먼저 준비하세요.');return resolution;
}
export function assertMindInvestmentScope(manifest,instrumentId,{asOf=new Date().toISOString(),expectedResolutionHash,phase}={}){
  const resolution=resolveMindInvestmentScope(manifest,{asOf});assertUniverseMember(resolution,instrumentId,{expectedResolutionHash:expectedResolutionHash??resolution.contentHash});return resolution;
}
export function checkUniversePositionLimits(resolution,{instrumentId,positions=[],sectorContexts={}}){
  assertUniverseMember(resolution,instrumentId);check(Array.isArray(positions)&&positions.every(p=>id(p.instrumentId)&&Number.isFinite(p.quantity)&&p.quantity>=0),'UNIVERSE_POSITIONS','실제 보유 종목·수량을 확인하세요.');
  const held=new Set(positions.filter(p=>p.quantity>0).map(p=>p.instrumentId));held.add(instrumentId);if(held.size>resolution.maxPositions)return {allowed:false,reason:'MAX_POSITIONS'};
  for(const limit of resolution.sectorLimits){let count=0;for(const id of held){if(id.startsWith('crypto:'))continue;const context=sectorContexts[id]||resolution.sectorContexts[id];if(context?.status!=='READY'||context.snapshotRef?.contentHash!==resolution.sectorSnapshotRef?.contentHash)return {allowed:false,reason:'SECTOR_HOLDING_MAPPING_REQUIRED',instrumentId:id};if(context.stockSectorIds?.includes(limit.sectorId)||context.relatedEtfSectorIds?.includes(limit.sectorId))count++;}if(count>limit.maxPositions)return {allowed:false,reason:'SECTOR_MAX_POSITIONS',sectorId:limit.sectorId,count,maximum:limit.maxPositions};}
  return {allowed:true};
}
