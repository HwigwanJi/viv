import {hashInputPackage} from './workspace.mjs';

export const PORTFOLIO_REFERENCE_NAV_VERSION='PORTFOLIO_REFERENCE_NAV_V1';
const DAY=86400000,METHOD='BTC_NATIVE_CLOSE_WITH_UPBIT_KRW_CROSS_FALLBACK';
const check=(v,code,message)=>{if(!v)throw Object.assign(new Error(message),{code,status:409});};
const payload=row=>{const {rowHash,...value}=row;check(!rowHash||hashInputPackage(value)===rowHash,'REFERENCE_CURVE_HASH','보관한 평가 행의 원문을 확인하세요.');return value;};
const iso=value=>typeof value==='string'&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value;

export function assertPortfolioReferenceDatasets(native,cross){
 check(native?.index?.contractVersion==='upbit-btc-daily-bundle-v1'&&hashInputPackage(native.index)===native.indexCanonicalHash,'REFERENCE_NATIVE_HASH','원 실험의 BTC 일봉 자료를 확인하세요.');
 for(const d of native.datasets){const ref=native.datasetCanonicalHashes.find(r=>r.market===d.market);check(ref&&hashInputPackage(d)===ref.canonicalHash&&native.index.datasets.find(r=>r.market===d.market)?.sha256===ref.sourceSha256,'REFERENCE_NATIVE_HASH','종목별 원 실험 자료를 확인하세요.');}
 const {packageCanonicalHash,...source}=cross??{};
 check(cross?.contractVersion==='upbit-krw-cross-reference-v1'&&cross.referenceOnly===true&&cross.valuationOnly===true&&cross.baseBtcBundleIndexSha256===native.indexSha256&&packageCanonicalHash===hashInputPackage(source),'REFERENCE_DATASET_HASH','참고 평가 자료의 원본과 적용 범위를 확인하세요.');
 const seen=new Set();for(const market of cross.markets){check(/^KRW-[A-Z0-9]+$/.test(market.market)&&!seen.has(market.market)&&market.quoteCurrency==='KRW','REFERENCE_MARKET','참고 평가 시장의 통화를 확인하세요.');seen.add(market.market);
  check(cross.marketCanonicalHashes.find(r=>r.market===market.market)?.canonicalHash===hashInputPackage(market),'REFERENCE_DATASET_HASH','참고 평가 종목 원문을 대조하세요.');const refs=new Map(market.rawRefs.map(r=>[r.sha256,r]));
  check(market.rows.every((r,i)=>iso(r.openTime)&&iso(r.closeTime)&&iso(r.sourceUpdatedAt)&&Date.parse(r.closeTime)-Date.parse(r.openTime)===DAY&&Date.parse(r.openTime)%DAY===0&&r.sourceUpdatedAt>=r.openTime&&iso(refs.get(r.sourcePageHash)?.receivedAt)&&r.sourceUpdatedAt<=refs.get(r.sourcePageHash).receivedAt&&r.closeTime<=refs.get(r.sourcePageHash).receivedAt&&r.closeTime<=cross.endAt&&(!i||market.rows[i-1].closeTime<=r.openTime)&&Number.isFinite(r.close)&&r.close>0&&refs.has(r.sourcePageHash)),'REFERENCE_DAY_BOUNDARY','참고 가격의 확정 일자·원문 저장 시각·원문을 확인하세요.');
 }
 return cross;
}

/** A read-only valuation of the original closing quantities and cash. Neither
 * the execution ledger nor strategy inputs are recalculated by this projection. */
export function buildPortfolioReferenceValuation({report,curve,nativeBundle,crossBundle}){
 check(report?.config?.assetMode==='UPBIT_BTC_PORTFOLIO'&&report.status==='COMPLETED','REFERENCE_REPORT_REQUIRED','완료한 BTC 포트폴리오 실험을 선택하세요.');
 const {reportHash,...reportBody}=report;check(!reportHash||reportHash===hashInputPackage(reportBody),'REFERENCE_REPORT_HASH','원 보고서 해시를 확인하세요.');assertPortfolioReferenceDatasets(nativeBundle,crossBundle);
 check(report.pins.datasetHash===nativeBundle.indexSha256,'REFERENCE_REPORT_DATASET','원 보고서와 동일한 BTC 자료를 선택하세요.');
 const c=report.config,sourceCurve=curve.map(payload).sort((a,b)=>a.sequence-b.sequence),total=(Date.parse(c.endAt)-Date.parse(c.startAt))/DAY;
 check(Number.isInteger(total)&&total>0&&sourceCurve.length===total&&sourceCurve.every((p,i)=>p.sequence===i+1&&p.asOf===new Date(Date.parse(c.startAt)+(i+1)*DAY).toISOString()&&Number.isFinite(p.cash)&&p.cash>=0&&Array.isArray(p.positions)),'REFERENCE_CURVE_BOUNDARY','요청 기간의 일별 보유·현금 기록을 확인하세요.');
 const direct=new Map(nativeBundle.datasets.map(d=>[d.market,new Map(d.rows.map(r=>[r.closeTime,r]))])),krw=new Map(crossBundle.markets.map(d=>[d.market,new Map(d.rows.map(r=>[r.closeTime,r]))]));
 let peak=c.initialCash,maxDrawdown=0,directDayCount=0,crossDayCount=0,cashOnlyDayCount=0,directMarkCount=0,crossMarkCount=0;const missing=[],rows=[];
 for(const point of sourceCurve){let holdings=0;const marks=[],missingIds=[];for(const position of point.positions){check(typeof position.instrumentId==='string'&&position.instrumentId.startsWith('crypto:upbit:BTC-')&&Number.isFinite(position.quantity)&&position.quantity>=0,'REFERENCE_POSITION','BTC 원장의 보유 수량과 종목을 확인하세요.');if(!position.quantity)continue;
   const market=position.instrumentId.slice('crypto:upbit:'.length),native=direct.get(market)?.get(point.asOf);let mark;
   if(native){check(native.closeTime<=point.asOf&&native.time===new Date(Date.parse(point.asOf)-DAY).toISOString()&&Number.isFinite(native.close)&&native.close>0,'REFERENCE_NATIVE_BOUNDARY','원 BTC 종가의 확정 경계를 확인하세요.');mark={instrumentId:position.instrumentId,quantity:position.quantity,priceBTC:native.close,basis:'BTC_NATIVE_CLOSE',asOf:point.asOf,sourceHashes:[native.sourcePageHash]};directMarkCount++;}
   else{const asset=krw.get('KRW-'+market.slice(4))?.get(point.asOf),btc=krw.get('KRW-BTC')?.get(point.asOf);if(!asset||!btc){missingIds.push(position.instrumentId);continue;}check(asset.openTime===btc.openTime&&asset.closeTime===btc.closeTime&&asset.closeTime===point.asOf,'REFERENCE_DAY_BOUNDARY','두 참고 가격의 확정 경계를 확인하세요.');mark={instrumentId:position.instrumentId,quantity:position.quantity,priceBTC:asset.close/btc.close,basis:'UPBIT_KRW_CROSS_CLOSE',asOf:point.asOf,legs:[{market:'KRW-'+market.slice(4),close:asset.close,asOf:asset.closeTime,sourceUpdatedAt:asset.sourceUpdatedAt,sourceHash:asset.sourcePageHash},{market:'KRW-BTC',close:btc.close,asOf:btc.closeTime,sourceUpdatedAt:btc.sourceUpdatedAt,sourceHash:btc.sourcePageHash}],sourceHashes:[asset.sourcePageHash,btc.sourcePageHash]};crossMarkCount++;}
   check(Number.isFinite(mark.priceBTC)&&mark.priceBTC>0&&Number.isFinite(mark.quantity*mark.priceBTC),'REFERENCE_NUMERIC','참고 평가 가격과 수량의 계산 범위를 확인하세요.');holdings+=mark.quantity*mark.priceBTC;marks.push(mark);
  }
  const complete=!missingIds.length,crossInstrumentIds=marks.filter(m=>m.basis==='UPBIT_KRW_CROSS_CLOSE').map(m=>m.instrumentId),equity=complete?point.cash+holdings:null;
  if(complete){if(!marks.length)cashOnlyDayCount++;else if(crossInstrumentIds.length)crossDayCount++;else directDayCount++;peak=Math.max(peak,equity);maxDrawdown=Math.max(maxDrawdown,(peak-equity)/peak);}else missing.push({asOf:point.asOf,instrumentIds:missingIds});
  rows.push({sequence:point.sequence,asOf:point.asOf,cash:point.cash,equity,netReturn:complete?equity/c.initialCash-1:null,drawdown:complete?(peak-equity)/peak:null,benchmarkEquity:c.initialCash,benchmarkReturn:0,crossInstrumentIds,marks,missingInstrumentIds:missingIds});
 }
 const complete=missing.length===0,sourceHashes={simulationReportHash:reportHash??hashInputPackage(report),curveHash:hashInputPackage(sourceCurve),nativeDatasetHash:nativeBundle.indexSha256,crossDatasetHash:crossBundle.packageCanonicalHash,referenceRowsHash:hashInputPackage(rows)},comparisonBasisHash=hashInputPackage({method:METHOD,startAt:c.startAt,endAt:c.endAt,initialCash:c.initialCash,feeBps:c.feeBps,slippageBps:c.slippageBps,participationCap:c.participationCap,nativeDatasetHash:sourceHashes.nativeDatasetHash,crossDatasetHash:sourceHashes.crossDatasetHash});
 const referenceValuation={contractVersion:PORTFOLIO_REFERENCE_NAV_VERSION,id:'reference-nav-'+hashInputPackage(sourceHashes).slice(0,32),status:complete?'COMPLETE':'PARTIAL',referenceOnly:true,executable:false,method:METHOD,priceDatasetId:crossBundle.id,quoteCurrency:'BTC',startAt:c.startAt,endAt:c.endAt,metrics:complete?{initialEquity:c.initialCash,finalEquity:rows.at(-1).equity,totalReturn:rows.at(-1).netReturn,maxDrawdown}:null,coverage:{totalFrames:total,valuedFrames:total-missing.length,missingFrames:missing.length,directDayCount,crossDayCount,cashOnlyDayCount,directMarkCount,crossMarkCount,firstAt:rows[0].asOf,lastAt:rows.at(-1).asOf,missing},sourceHashes,comparisonBasisHash,priceBasis:'EX_POST_UTC_DAILY_CLOSE; SOURCE_UPDATED_AT_RETAINED; KRW_CROSS_RATIO_REFERENCE_ONLY',stateEffect:'NONE'};
 return {referenceValuation:{...referenceValuation,referenceHash:hashInputPackage(referenceValuation)},curve:rows.map(({marks,missingInstrumentIds,...point})=>point),rows};
}
