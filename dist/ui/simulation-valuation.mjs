import {currencyAmount} from './currency-format.mjs';
import {getInstrument} from '../domain/instruments.mjs';
import {helpTooltip} from './help-tooltip.mjs';

const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const time=value=>value&&Number.isFinite(Date.parse(value))?new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(value))+' KST':'시각 미기록';
const symbol=id=>{try{return getInstrument(id).symbol;}catch{return id||'종목 확인';}};
export const partialPortfolioValuation=s=>s?.evaluationEligibility?.valuation?.reason==='STALE_PORTFOLIO_VALUATION'?s.evaluationEligibility.valuation:null;
export const partialEventValuation=s=>['UPBIT_EVENT_STREAM','UPBIT_EVENT_UNIVERSE'].includes(s?.config?.assetMode)&&s.status==='COMPLETED'&&s.evaluationEligibility?.valuation?.status==='PARTIAL'?s.evaluationEligibility.valuation:null;
export function completeReferenceValuation(s){
 const r=s?.referenceValuation,c=r?.coverage,m=r?.metrics;
 return s?.status==='COMPLETED'&&s.config?.assetMode==='UPBIT_BTC_PORTFOLIO'&&r?.contractVersion==='PORTFOLIO_REFERENCE_NAV_V1'&&r.status==='COMPLETE'&&r.referenceOnly===true&&r.executable===false&&r.method==='BTC_NATIVE_CLOSE_WITH_UPBIT_KRW_CROSS_FALLBACK'&&r.quoteCurrency==='BTC'&&r.startAt===s.config.startAt&&r.endAt===s.config.endAt&&c?.totalFrames>0&&c.valuedFrames===c.totalFrames&&c.missingFrames===0&&[m?.initialEquity,m?.finalEquity,m?.totalReturn,m?.maxDrawdown].every(Number.isFinite)&&typeof r.comparisonBasisHash==='string'&&r.comparisonBasisHash.length===64?r:null;
}
export const activeReferenceValuation=s=>partialPortfolioValuation(s)?completeReferenceValuation(s):null;
export function comparableReferenceValuations(a,b){
 const left=completeReferenceValuation(a),right=completeReferenceValuation(b),ready=s=>s?.evaluationEligibility?.readyDecisions>0&&s.evaluationEligibility.readyDecisions===s.evaluationEligibility.totalDecisions;
 return Boolean((partialPortfolioValuation(a)||partialPortfolioValuation(b))&&left&&right&&left.comparisonBasisHash===right.comparisonBasisHash&&ready(a)&&ready(b));
}
export async function loadSimulationReference(s,request,options){
 if(s?.status!=='COMPLETED'||s.config?.assetMode!=='UPBIT_BTC_PORTFOLIO')return s;
 try{const value=await request('/api/workspace/simulations/reference-valuation?'+new URLSearchParams({id:s.id}),undefined,options);if(!value?.referenceValuation)return s;return {...s,referenceValuation:value.referenceValuation,referenceCurve:value.curve??[],referenceChart:value.chart??null};}catch(problem){if(problem.name==='AbortError')throw problem;return s;}
}
export function referenceValuationStatus(s,{id='reference-nav-help',force=false}={}){
 const r=force?completeReferenceValuation(s):activeReferenceValuation(s);if(!r)return '';
 return '<span role="status" data-reference-nav>참고 NAV · 교차 평가 '+esc(r.coverage.crossDayCount)+'일'+helpTooltip('참고 NAV 평가','저장된 현금과 보유 수량을 사용합니다. BTC 종가가 없는 날은 같은 업비트 UTC 일봉의 종목/KRW 종가를 BTC/KRW 종가로 나눠 평가합니다. 주문·수량·JEV 입력은 원 실험 값을 유지합니다.',{id})+'</span>';
}
export function referenceValuationSources(s,{label=''}={}){
 const r=completeReferenceValuation(s);if(!r)return '';
 const query=typeof r.priceDatasetId==='string'?new URLSearchParams({id:s.id,priceDatasetId:r.priceDatasetId}).toString():null;
 return '<details class="simulation-conditions" data-reference-nav-sources><summary>'+esc(label?label+' · 참고 NAV 가격 출처':'참고 NAV 가격 출처')+'</summary><div class="studio-sheet-body"><dl><div><dt>평가 기간</dt><dd>'+esc(time(r.coverage.firstAt)+' — '+time(r.coverage.lastAt))+'</dd></div><div><dt>가격 기준</dt><dd>업비트 · 동일 UTC 일봉 종가</dd></div><div><dt>평가 시점</dt><dd>'+esc(r.coverage.valuedFrames+' / '+r.coverage.totalFrames)+'</dd></div><div><dt>BTC 종가 · KRW 교차 평가</dt><dd>'+esc(r.coverage.directDayCount+'일 · '+r.coverage.crossDayCount+'일')+'</dd></div></dl>'+(query?'<a href="/api/workspace/simulations/reference-valuation/report?'+esc(query)+'" target="_blank" rel="noopener noreferrer">가격 원문과 참고 평가 보고서 보기</a>':'')+'<details><summary>저장된 가격 출처와 식별값</summary><pre class="code">'+esc(JSON.stringify({id:r.id,priceDatasetId:r.priceDatasetId,method:r.method,startAt:r.startAt,endAt:r.endAt,coverage:r.coverage,sourceHashes:r.sourceHashes,comparisonBasisHash:r.comparisonBasisHash,referenceHash:r.referenceHash},null,2))+'</pre></details></div></details>';
}
export function simulationValuationDetails(s){
 const native=partialEventValuation(s);if(native&&s.config.assetMode==='UPBIT_EVENT_UNIVERSE'){const nav=native.nativeNAV,parts=[native.reason==='INCOMPLETE_EVENT_DECISION_LEDGER'?'저장된 판단 건수와 진행 지점을 대조하세요.':'공용 현금과 보유 종목을 같은 시점의 결제 통화 가격으로 평가해야 전체 수익률을 비교할 수 있습니다.','결제 통화 '+native.quoteCurrency,'요청 종료 '+time(native.requiredAsOf)];if(nav){parts.push('계좌 평가 관측 '+nav.observations+'개');for(const missing of (nav.missing??[]).slice(0,5))parts.push('평가 누락 '+time(missing.asOf??missing.at??missing));}parts.push('원래 현금·보유·체결 기록은 유지됩니다.');return parts.join(' · ');}
 const event=partialEventValuation(s);if(event){const nav=event.referenceNAV,parts=[event.reason==='INCOMPLETE_EVENT_DECISION_LEDGER'?'저장된 판단 건수와 진행 지점을 대조하세요.':'같은 시점의 계좌 가치와 BTC 가격이 모두 있어야 BTC 기준 수익률을 비교할 수 있습니다.','요청 종료 '+time(event.requiredAsOf)];if(nav){parts.push('BTC 평가 관측 '+nav.observations+'개');for(const missing of (nav.missing??[]).slice(0,5))parts.push('평가 누락 '+time(missing.asOf??missing.at??missing));}parts.push('원래 결제 통화의 현금·보유·체결 기록은 유지됩니다.');return parts.join(' · ');}
 const value=partialPortfolioValuation(s);if(!value)return '';
 const parts=['저장 평가 '+currencyAmount(value.finalEquity,value.quoteCurrency)+' '+value.quoteCurrency,'계좌 평가 '+time(value.accountAsOf),'요청 종료 '+time(value.requiredAsOf),'평가 시세 누락 '+value.staleFrames+'개 시점'];
 for(const held of value.incompleteHeldInstruments??[])parts.push(symbol(held.instrumentId)+' · 마지막 시세 '+time(held.priceAsOf));
 if(!(value.incompleteHeldInstruments??[]).length)parts.push('종료 시세는 복구됐으며 기간 중 누락된 평가 구간을 확인하세요.');
 parts.push('보유·거래 원문은 유지하며 전체 기간 수익률과 낙폭 비교에서 제외합니다.');return parts.join(' · ');
}
export function simulationValuationStatus(s,{id='simulation-valuation-help',showAmount=false}={}){
 const event=partialEventValuation(s);if(event)return '<span role="status" data-simulation-valuation="partial">'+(event.reason==='INCOMPLETE_EVENT_DECISION_LEDGER'?'저장 판단 확인':s.config.assetMode==='UPBIT_EVENT_UNIVERSE'?'공용 계좌 평가 확인':'BTC 환산 평가 확인')+helpTooltip('평가 범위',simulationValuationDetails(s),{id})+'</span>';
 const value=partialPortfolioValuation(s);if(!value)return '';
 return '<span role="status" data-simulation-valuation="partial">부분 계좌 평가'+(showAmount?' · 저장 평가 '+esc(currencyAmount(value.finalEquity,value.quoteCurrency)+' '+value.quoteCurrency):'')+helpTooltip('계좌 평가 범위',simulationValuationDetails(s),{id})+'</span>';
}
