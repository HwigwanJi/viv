import {automaticObservationWindow,automaticCohortPolicyHash,AUTOMATIC_COHORT_POLICY_VERSION,buildAutomaticCohortTag,validateAutomaticCohortExperience} from '../dist/domain/learning-cohort.mjs';
import {hashInputPackage} from '../dist/domain/workspace.mjs';
const BTC='crypto:okx:BTC-USDT',clone=structuredClone;
const pending=(status,dueAt,code,message)=>({status,dueAt,reasons:[{code,message}],observation:null});
/** Only new, pinned automatic runs use the execution-anchored cohort contract. */
export function observeAutomaticMindRun(args,legacyObserve){
 const {run,now=new Date().toISOString(),horizonHours=8,manifest}=args,a=run.automation;
 let window;try{window=automaticObservationWindow({barCloseAt:a.barCloseAt,executionAt:run.execution?.at??null});}catch{return pending('DATA_REQUIRED',null,'AUTO_OBSERVATION_POLICY','고정한 자동운용 봉과 실제 실행 시각을 확인하세요.');}
 if(a.cohortPolicyVersion!==AUTOMATIC_COHORT_POLICY_VERSION||a.cohortPolicyHash!==automaticCohortPolicyHash()||horizonHours!==8)return pending('DATA_REQUIRED',window.endAt,'AUTO_OBSERVATION_POLICY','자동운용은 기준 봉부터 두 개의 4시간봉을 관측합니다.');
 if(now<window.endAt)return pending('WAITING_TIME',window.endAt,'OBSERVATION_WINDOW_PENDING','자동운용의 기준 봉+8시간 종료를 기다립니다.');
 if(!window.withinExecutionWindow)return pending('DATA_REQUIRED',window.endAt,'COHORT_EXECUTION_WINDOW','승인한 +5~+10분 창에서 실행한 계좌 기준을 연결하세요.');
 // Existing source/path/snapshot checks remain the first calculation gate.
 const value=legacyObserve({...args,horizonHours:4});if(value.status!=='OBSERVED')return {...value,dueAt:window.endAt};
 const before=run.accountSnapshot,after=run.execution.accountSnapshotAfter,quote=run.execution.quote,quotes=run.execution.valuationQuotes;
 if(!before||!after||before.positions.some(p=>p.instrumentId!==BTC)||after.positions.some(p=>p.instrumentId!==BTC)||!Array.isArray(quotes)||quotes.length!==1||hashInputPackage(quotes[0])!==hashInputPackage(quote)||quote.instrumentId!==BTC||quote.currency!=='USDT'||!/^[a-f0-9]{64}$/.test(quote.rawSha256??'')||quote.asOf>quote.receivedAt||quote.receivedAt>run.execution.at||Date.parse(run.execution.at)-Date.parse(quote.asOf)>30000)return pending('DATA_REQUIRED',window.endAt,'AUTO_PRETRADE_VALUATION_REQUIRED','실행 시점의 원본 가격으로 매매 전 현금·보유량을 함께 평가하세요.');
 const initialEquity=before.cash+(before.positions.find(p=>p.instrumentId===BTC)?.quantity??0)*quote.price;
 if(!Number.isFinite(initialEquity)||initialEquity<=0)return pending('DATA_REQUIRED',window.endAt,'AUTO_PRETRADE_VALUATION_REQUIRED','실행 시점 매매 전 계좌의 양수 평가액을 준비하세요.');
 const quantity=after.positions.find(p=>p.instrumentId===BTC)?.quantity??0,observation=clone(value.observation),points=observation.path.filter(p=>p.asOf>window.startAt);
 const path=[{asOf:window.startAt,price:quote.price,equity:initialEquity,basis:'PRE_TRADE_ACCOUNT_AT_EXECUTION_QUOTES'},{asOf:window.startAt,price:quote.price,equity:after.cash+quantity*quote.price,basis:'POST_TRADE_ACCOUNT_WITH_EXECUTION_COSTS'},...points.map(p=>({...p,equity:after.cash+quantity*p.price}))];
 if(!points.length||points.at(-1).asOf!==window.endAt)return pending('DATA_REQUIRED',window.endAt,'AUTO_OBSERVATION_PATH_REQUIRED','기준 봉+8시간까지 완료한 동일 종목 경로를 준비하세요.');
 let peak=initialEquity,maxDrawdown=0;for(const p of path){peak=Math.max(peak,p.equity);maxDrawdown=Math.max(maxDrawdown,(peak-p.equity)/peak);}
 const endingPrice=path.at(-1).price,endingEquity=path.at(-1).equity,netReturn=endingEquity/initialEquity-1,benchmarkReturn=(initialEquity/(quote.price*1.0005*1.001))*endingPrice/initialEquity-1;
 Object.assign(observation,{methodVersion:'mind-auto-fixed-post-execution-cost-inclusive-v1',period:{start:window.startAt,end:window.endAt},asOf:window.endAt,horizonHours:8,horizonBars:2,actualHorizonHours:window.actualDurationMs/3600000,path});
 Object.assign(observation.performance,{initialEquity,endingEquity,netReturn,maxDrawdown,benchmarks:{holdPreDecisionReturn:(before.cash+(before.positions.find(p=>p.instrumentId===BTC)?.quantity??0)*endingPrice)/initialEquity-1,allCashReturn:0,buyAndHoldReturn:benchmarkReturn},initialCapitalBasis:'PRE_TRADE_ACCOUNT_AT_EXECUTION_QUOTES'});
 Object.assign(observation.metrics,{netReturn,benchmarkReturn,feesReturn:(run.execution.fee??0)/initialEquity,slippageReturn:(run.execution.slippageCost??0)/initialEquity,maxDrawdown});
 observation.source.preTradeValuation={accountSnapshotHash:hashInputPackage(before),at:window.startAt,initialEquity,cash:before.cash,positions:before.positions.map(p=>({instrumentId:p.instrumentId,quantity:p.quantity})),quotes:clone(quotes),contract:'PRE_TRADE_CASH_QUANTITIES_AT_EXECUTION_QUOTES_V1'};
 const subscription={id:a.subscriptionId,ownerId:a.ownerId,profileId:run.profileId,pins:a.pins};
 try{observation.cohorts=manifest.data.principles.map(p=>{const tag=buildAutomaticCohortTag({run,subscription,principleId:p.id,now});return {tag,assessment:validateAutomaticCohortExperience({run,observation,tag})};});}catch{return pending('DATA_REQUIRED',window.endAt,'AUTO_COHORT_PROVENANCE_REQUIRED','자동운용 소유자·정책·원칙의 고정 코호트 참조를 확인하세요.');}
 return {status:'OBSERVED',dueAt:window.endAt,reasons:[],observation};
}
