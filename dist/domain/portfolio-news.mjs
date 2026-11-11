import {hashInputPackage} from './workspace.mjs';
export const PORTFOLIO_NEWS_VERSION='portfolio-news-signals-v1';
const H=3600000,ratio=v=>Number.isFinite(v)&&v>=0&&v<=1,stamp=v=>typeof v==='string'&&Number.isFinite(Date.parse(v)),hash=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
export function assertPortfolioNews(news){
 if(news?.contractVersion!==PORTFOLIO_NEWS_VERSION||!stamp(news.asOf)||!Array.isArray(news.events)||news.events.length>200||!Array.isArray(news.sourceRefs)||news.sourceRefs.length>200)throw Error('뉴스 입력의 정본, 기준 시각과 원문 참조를 확인하세요.');
 if(news.coefficient&&(!Number.isFinite(news.coefficient.returnBps)||!Number.isSafeInteger(news.coefficient.samples)||news.coefficient.samples<0||!stamp(news.coefficient.trainedThrough)||news.coefficient.trainedThrough>news.asOf))throw Error('뉴스 가중치의 학습 결과와 완료 시각을 확인하세요.');
 for(const e of news.events){
  if(typeof e.id!=='string'||!e.id||!hash(e.sourceHash)||!['crypto','equity'].includes(e.assetClass)||!Array.isArray(e.instrumentIds)||e.instrumentIds.length>500||e.instrumentIds.some(id=>typeof id!=='string')||!Number.isFinite(e.direction)||Math.abs(e.direction)>1||![e.confidence,e.novelty,e.reliability].every(ratio)||!stamp(e.publishedAt)||!stamp(e.availableAt)||e.publishedAt>e.availableAt||e.availableAt>news.asOf)throw Error('뉴스의 공개 시각, 분류 결과, 적용 범위와 점수를 확인하세요.');
  const url=new URL(e.sourceUrl);if(url.protocol!=='https:'||url.username||url.password)throw Error('뉴스 원문의 HTTPS 출처를 확인하세요.');
 }
 return news;
}
export function scorePortfolioNews(news,{instrumentId,assetClass,asOf,halfLifeHours=24}={}){
 assertPortfolioNews(news);if(!stamp(asOf)||!Number.isFinite(halfLifeHours)||halfLifeHours<=0)throw Error('뉴스 점수의 판단 시각과 반감기를 확인하세요.');
 const selected=new Map();
 for(const e of news.events)if(e.assetClass===assetClass&&e.availableAt<=asOf&&(!e.instrumentIds.length||e.instrumentIds.includes(instrumentId))){
  const key=e.id+':'+e.assetClass,prior=selected.get(key);if(!prior||e.availableAt>prior.availableAt)selected.set(key,e);
 }
 let numerator=0,denominator=0;const contributions=[];
 for(const e of selected.values()){
  const ageHours=(Date.parse(asOf)-Date.parse(e.publishedAt))/H,decay=2**(-ageHours/halfLifeHours),weight=e.reliability*e.confidence*e.novelty,contribution=e.direction*weight*decay;
  numerator+=contribution;denominator+=e.reliability;contributions.push({id:e.id,sourceHash:e.sourceHash,direction:e.direction,confidence:e.confidence,novelty:e.novelty,reliability:e.reliability,ageHours,decay,contribution});
 }
 return {score:denominator?numerator/denominator:0,eventCount:contributions.length,contributions,asOf,sourceHash:hashInputPackage([...selected.values()])};
}
/** Fit return-per-signal with an explicit prior; only matured observations enter. */
export function calibrateNewsCoefficient(rows,{asOf,priorBps=100,priorStrength=4}={}){
 if(!stamp(asOf)||!Number.isFinite(priorBps)||!Number.isFinite(priorStrength)||priorStrength<=0)throw Error('뉴스 가중치 학습의 기준 시각과 초기값을 확인하세요.');
 let xx=priorStrength,xy=priorStrength*priorBps/10000,count=0;
 for(const r of rows){if(!stamp(r.knownAt)||!stamp(r.outcomeAvailableAt)||r.knownAt>=r.outcomeAvailableAt||!Number.isFinite(r.signal)||Math.abs(r.signal)>1||!Number.isFinite(r.excessLogReturn))throw Error('뉴스 가중치 학습 표본의 시각과 수익률을 확인하세요.');if(r.outcomeAvailableAt>asOf)continue;xx+=r.signal*r.signal;xy+=r.signal*r.excessLogReturn;count++;}
 return {returnBps:10000*xy/xx,samples:count,priorBps,priorStrength,trainedThrough:asOf};
}
