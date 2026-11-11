import { getInstrument } from '../dist/domain/instruments.mjs';
import { researchSha256 } from '../dist/domain/research.mjs';
import { validatePublicMarketSnapshot } from './market-providers.mjs';
import { InstrumentMarketError, loadInstrumentMarket } from './instrument-market.mjs';
import { loadOwnerTossMarket } from './toss-candles.mjs';

export const CANONICAL_CONFIRMED_BAR_POLICY='CANONICAL_CONFIRMED_BARS_V1';
export const CANONICAL_PROJECTION_VERSION='canonical-btc-d1-projection-v1';
export const LIVE_SPOT_CONTEXT_BARS=80;
export const LIVE_SPOT_CONTEXT_POLICY='LIVE_SPOT_CONTEXT_80_V1';
const BTC='crypto:okx:BTC-USDT',FOUR=14400000,DAY=86400000,clone=structuredClone;
const stamp=value=>typeof value==='string'&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value;
const check=(value,code,message)=>{if(!value)throw new InstrumentMarketError(code,message);};
const readNow=now=>new Date(typeof now==='function'?now():now??Date.now()).toISOString();
const unavailable=(instrument,timeframe,code,message,status='DATA_REQUIRED')=>({schemaVersion:1,version:CANONICAL_PROJECTION_VERSION,status,instrument,timeframe,bars:[],quote:null,source:null,error:message,warnings:[{code,message}],connection:{provider:'OWNER_CANONICAL_D1_CAPTURE',supportedTimeframes:['4h','1d'],executionAllowed:false}});

/** Pure projection of an already collected and immutable owner-scoped capture. */
export function projectCanonicalBtcCapture(capture,{instrumentId=BTC,timeframe='4h',limit=240,now=new Date().toISOString()}={}){
  const instrument=getInstrument(instrumentId);
  check(instrument.id===BTC&&Number.isInteger(limit)&&limit>=1&&limit<=299&&stamp(now),'INVALID_MARKET_OPTIONS','BTC 정본 투영의 종목·범위·현재 시각을 확인하세요.');
  if(!['4h','1d'].includes(timeframe))return unavailable(instrument,timeframe,'CANONICAL_TIMEFRAME_UNAVAILABLE','저장된 BTC 정본은 4시간봉과 일봉을 제공합니다.','UNSUPPORTED_TIMEFRAME');
  check(capture?.marketData?.dataset&&capture.marketData.manifest&&Array.isArray(capture.records),'CANONICAL_CAPTURE_INCOMPLETE','저장된 BTC 수집 정본의 원문·데이터·명세를 확인하세요.');
  const {marketData,...sourceSnapshot}=capture,{dataset,manifest}=marketData;
  check(manifest.provider==='okx'&&manifest.instId==='BTC-USDT'&&manifest.loaderVersion==='okx-closed-rest-v1'&&capture.id===manifest.sourceSnapshotId,'CANONICAL_CAPTURE_IDENTITY','저장된 OKX BTC 수집 정본의 종목과 버전을 대조하세요.');
  check(stamp(manifest.availableAt)&&stamp(manifest.receivedAt)&&manifest.availableAt<=now&&manifest.receivedAt<=now,'CANONICAL_CAPTURE_FUTURE','현재 판단 이전에 수신한 수집 정본을 선택하세요.');
  const verified=validatePublicMarketSnapshot({dataset,manifest,sourceSnapshot},{now,maxSnapshotAgeMs:FOUR,requirePublic:true});
  if(!verified.ok&&verified.reasons[0]?.code==='STALE_MARKET_SNAPSHOT')return unavailable(instrument,timeframe,'CANONICAL_CAPTURE_STALE','현재의 최신 확정 봉을 포함한 기존 수집 정본이 필요합니다.');
  check(verified.ok,'CANONICAL_CAPTURE_INTEGRITY','저장된 BTC 수집 정본의 공개 원문·해시·계보 검증을 완료하지 못했습니다.');
  check(manifest.latestClosedAsOf===new Date(Math.floor(Date.parse(now)/FOUR)*FOUR).toISOString(),'CANONICAL_CAPTURE_BOUNDARY','현재의 최신 확정 봉을 포함한 수집 정본을 선택하세요.');
  const step=timeframe==='4h'?FOUR:DAY,native=timeframe==='4h'?dataset.bars:dataset.dailyBars,selected=native.slice(-limit);
  check(selected.length>0&&selected.at(-1)[0]+step===Math.floor(Date.parse(now)/step)*step,'CANONICAL_CAPTURE_BOUNDARY','정본의 해당 주기 최신 확정 봉을 대조하세요.');
  const records=sourceSnapshot.records.filter(r=>r.kind==='KLINES'&&r.interval===timeframe),rows=records.flatMap(r=>JSON.parse(r.rawBody).data);
  check(selected.every(bar=>rows.some(row=>row[8]==='1'&&bar.every((value,index)=>Number(row[index])===value))),'CANONICAL_PROJECTION_LINEAGE','투영한 봉을 실제 포함하는 정본 원문 페이지를 확인하세요.');
  const bars=selected.map(b=>({openTime:new Date(b[0]).toISOString(),closeTime:new Date(b[0]+step).toISOString(),open:b[1],high:b[2],low:b[3],close:b[4],volume:b[5],isClosed:true})),asOf=bars.at(-1).closeTime;
  const barsSha256=researchSha256(JSON.stringify(bars)),source={provider:'okx',instrumentId:instrument.id,timeframe,requestedLimit:limit,barCount:bars.length,firstBarCloseAt:bars[0].closeTime,lastBarCloseAt:asOf,hashContract:'CANONICAL_CONFIRMED_BARS_PROJECTION_V1',receivedAt:manifest.receivedAt,availableAt:manifest.availableAt,projectedAt:now,asOf,barsSha256,projectionBarsSha256:barsSha256,projectionVersion:CANONICAL_PROJECTION_VERSION,cachePolicy:CANONICAL_CONFIRMED_BAR_POLICY,marketDataRef:capture.id,sourceSnapshotId:capture.id,captureSha256:manifest.sourceSnapshotSha256,sourceSnapshotSha256:manifest.sourceSnapshotSha256,datasetSha256:manifest.datasetSha256,canonicalHashContract:manifest.hashContract,canonicalLoaderVersion:manifest.loaderVersion,canonicalLatestClosedAsOf:manifest.latestClosedAsOf,sourceRefs:clone(manifest.sources),dataOrigin:'PUBLIC_API'};
  return {schemaVersion:1,version:CANONICAL_PROJECTION_VERSION,status:'READY',instrument,timeframe,bars,quote:{price:bars.at(-1).close,currency:'USDT',asOf,receivedAt:manifest.receivedAt,ageMs:Date.parse(now)-Date.parse(asOf),freshness:'CLOSED_BAR',priceBasis:'LAST_CLOSED_CANDLE',executionAllowed:false},source,warnings:native.length<limit?['CANONICAL_AVAILABLE_HISTORY_'+native.length]:[],connection:{provider:'OWNER_CANONICAL_D1_CAPTURE',supportedTimeframes:['4h','1d'],executionAllowed:false}};
}

/** All lookups remain inside the authenticated owner's existing D1 namespace. */
export function createOwnerMarketResolver({repository,owner,workspace,directLoader=loadInstrumentMarket}={}){
  check(typeof owner==='string'&&owner.length>0&&typeof repository?.readObject==='function'&&workspace,'INVALID_MARKET_OPTIONS','소유 범위가 확인된 시세 저장소를 연결하세요.');
  return async options=>{
    const requestedInstrument=getInstrument(options.instrumentId,{resolution:options.universeResolution,snapshot:options.universeSnapshot});
    if(requestedInstrument.id!==BTC){
      if(requestedInstrument.assetClass!=='crypto'){
        if(!requestedInstrument.timeframes.includes(options.timeframe??requestedInstrument.defaultTimeframe))return directLoader(options);
        if(repository.db&&options.env?.BROKER_VAULT_KEY){
          try {const market=await loadOwnerTossMarket({...options,instrument:requestedInstrument,db:repository.db,owner});if(market)return market;}
          catch(error){if(error instanceof InstrumentMarketError)throw error;throw new InstrumentMarketError(error.code??'TOSS_MARKET_CONNECTION',error.code?error.message:'토스증권 시세 연결을 확인하세요.');}
        }
        return directLoader(options);
      }
      const callerRequestedLimit=options.limit??240;
      const strategyHistory=options.strategyHistory===true;
      check(Number.isInteger(callerRequestedLimit)&&callerRequestedLimit>=1&&callerRequestedLimit<=(strategyHistory?999:299),'INVALID_MARKET_OPTIONS','현재 코인 시세의 조회 범위를 확인하세요.');
      // One fixed context request serves selection, chart, action and markout.
      // Failures retain the same host and parameters; this branch never retries.
      const limit=strategyHistory?callerRequestedLimit:LIVE_SPOT_CONTEXT_BARS,market=await directLoader({...options,instrumentId:requestedInstrument.id,limit});
      return {...market,...(market.source?{source:{...market.source,callerRequestedLimit,liveContextPolicy:strategyHistory?'APPROVED_STRATEGY_REQUIRED_HISTORY_V1':LIVE_SPOT_CONTEXT_POLICY,liveContextLimit:limit}}:{})};
    }
    const instrument=getInstrument(BTC),timeframe=options.timeframe??'4h';
    if(!['4h','1d'].includes(timeframe))return unavailable(instrument,timeframe,'CANONICAL_TIMEFRAME_UNAVAILABLE','저장된 BTC 정본은 4시간봉과 일봉을 제공합니다.','UNSUPPORTED_TIMEFRAME');
    const refs=[...(workspace.marketSnapshots??[]).filter(s=>s.provider==='okx'&&s.instId==='BTC-USDT').sort((a,b)=>String(b.receivedAt).localeCompare(String(a.receivedAt))).map(s=>s.id),...(workspace.decisionRecords??[]).filter(r=>r.inputPackage?.marketProvider==='okx'&&r.inputPackage.marketDataRef).slice().reverse().map(r=>r.inputPackage.marketDataRef)];
    let stale=null;
    for(const ref of [...new Set(refs)].slice(0,8)){
      if(typeof ref!=='string'||!/^okx-rest-[a-f0-9]{64}$/.test(ref))continue;
      const capture=await repository.readObject(owner,'marketSnapshots',ref);if(!capture)continue;
      check(capture.id===ref,'CANONICAL_CAPTURE_IDENTITY','소유 범위와 수집 정본 참조를 대조하세요.');
      const market=projectCanonicalBtcCapture(capture,{...options,instrumentId:BTC,timeframe,now:readNow(options.now)});
      if(market.status==='READY')return market;stale=market;
    }
    return stale??unavailable(instrument,timeframe,'CANONICAL_CAPTURE_REQUIRED','기존 BTC 수집기가 저장한 현재 확정 봉 정본이 필요합니다.');
  };
}
