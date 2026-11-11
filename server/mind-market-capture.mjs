import {StrategyLearningStore} from './strategy-learning-store.mjs';
import {verifyUpbitMarketCapture} from './instrument-market.mjs';
import {RepositoryError} from './repository.mjs';
import {hashInputPackage} from '../dist/domain/workspace.mjs';

const CONTRACT='MIND_PUBLIC_MARKET_CAPTURE_V1',clone=structuredClone;
const check=(ok,code,message)=>{if(!ok)throw new RepositoryError(code,message,409);};
const archiveId=ref=>'upbit-capture-'+ref.hash;

/** Keep public response bytes in the existing owner-scoped content archive. */
export async function archiveMindMarketCapture({repository,ownerId,market,now}={}){
 check(repository?.db&&typeof ownerId==='string'&&ownerId,'MARKET_CAPTURE_OWNER','시세 원본을 보관할 사용자 저장소를 확인하세요.');
 check(typeof now==='string'&&Number.isFinite(Date.parse(now)),'MARKET_CAPTURE_TIME','시세 원본의 검증 시각을 확인하세요.');
 verifyUpbitMarketCapture(market,{now});
 const {marketDataRef,archiveRef,...source}=market.source;
 // Preserve JSON field order used by the provider projection's byte-hash contract.
 const value={contractVersion:CONTRACT,verifiedAt:now,marketJson:JSON.stringify({instrument:market.instrument,timeframe:market.timeframe,status:market.status,bars:market.bars,quote:market.quote,source,rawCaptures:market.rawCaptures})};
 const store=new StrategyLearningStore(repository.db),ref=await store.write(ownerId,value);
 market.source={...source,marketDataRef:archiveId(ref),archiveRef:ref};
 return {marketDataRef:archiveId(ref),archiveRef:ref};
}

/** Reopen and revalidate the original bytes without making another market request. */
export async function readMindMarketCapture({repository,ownerId,source,now}={}){
 check(repository?.db&&typeof ownerId==='string'&&ownerId&&source?.archiveRef&&source.marketDataRef===archiveId(source.archiveRef),'MARKET_CAPTURE_REF','시세 원본의 사용자 범위와 참조를 확인하세요.');
 const value=await new StrategyLearningStore(repository.db).read(ownerId,source.archiveRef);
 check(value.contractVersion===CONTRACT,'MARKET_CAPTURE_REF','시세 원본의 저장 형식을 확인하세요.');
 check(typeof value.verifiedAt==='string'&&Number.isFinite(Date.parse(value.verifiedAt))&&Number.isFinite(Date.parse(now))&&Date.parse(value.verifiedAt)<=Date.parse(now),'MARKET_CAPTURE_TIME','시세 원본의 저장 시각과 조회 시각을 확인하세요.');
 let market;try{market=JSON.parse(value.marketJson);}catch{check(false,'MARKET_CAPTURE_REF','시세 원본의 JSON 형식을 확인하세요.');}
 const replay=verifyUpbitMarketCapture(market,{now:value.verifiedAt});
 check(Object.entries(market.source).every(([key,entry])=>Object.hasOwn(source,key)&&hashInputPackage(source[key])===hashInputPackage(entry)),'MARKET_CAPTURE_CHANGED','판단에 연결한 수집 메타데이터와 원문을 대조하세요.');
 return {...clone(market),source:{...clone(market.source),marketDataRef:source.marketDataRef,archiveRef:clone(source.archiveRef)},replay};
}
