import {hashInputPackage} from './workspace.mjs';
import {validateMindPaperAccount} from './mind-paper.mjs';

export const AUTOMATIC_COHORT_POLICY_VERSION='BTC_4H_AUTO_COHORT_V2';
export const LEGACY_COHORT_POLICY_VERSION='LEGACY_EXACT_DURATION_V1';
const FOUR=14400000,BTC='crypto:okx:BTC-USDT',HASH=/^[a-f0-9]{64}$/;
const id=value=>typeof value==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9_.:@/-]{0,199}$/.test(value);
const stamp=value=>typeof value==='string'&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value;
const plain=value=>value&&typeof value==='object'&&!Array.isArray(value)&&[Object.prototype,null].includes(Object.getPrototypeOf(value));
const exact=(value,keys)=>plain(value)&&Object.keys(value).length===keys.length&&keys.every(k=>Object.hasOwn(value,k));
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const deepFreeze=value=>{Object.values(value).forEach(item=>{if(item&&typeof item==='object')deepFreeze(item);});return Object.freeze(value);};
export const BTC_4H_AUTO_COHORT_POLICY=deepFreeze({schemaVersion:1,policyVersion:AUTOMATIC_COHORT_POLICY_VERSION,instrumentId:BTC,timeframe:'4h',quoteCurrency:'USDT',evaluationMode:'FIXED_POST_EXECUTION_ACCOUNT_V1',marketRegimePolicyVersion:'DECLARED_APPROVED_REGIME_V1',costPolicyVersion:'FIXED_PAPER_10BP_5BP_V1',benchmarkPolicyVersion:'ALL_IN_BUY_HOLD_10BP_5BP_V1',valuationPolicyVersion:'COMPLETE_FIXED_POST_EXECUTION_QUOTES_V1',observation:{anchor:'DECISION_BAR_CLOSE_V1',horizonBars:2,resolution:'4h',start:'EXECUTION_AT',executionOffsetMinMs:300000,executionOffsetMaxMs:600000,minActualDurationMs:28200000,maxActualDurationMs:28500000,requireEndAfterExecution:true},independence:{policyVersion:'EXPLICIT_NONOVERLAP_EVENT_REVIEW_V1',requireExplicitReview:true,minimumIndependentGroups:3},approval:{requireCompletedObservation:true,requireCompleteValuation:true,requireComparator:true,requireControlledAblationForWeightChange:true,requireUserApproval:true}});

export class AutomaticCohortError extends Error{constructor(code,message){super(message);this.name='AutomaticCohortError';this.code=code;this.status=400;}}
const check=(value,code,message)=>{if(!value)throw new AutomaticCohortError(code,message);};
export function validateAutomaticCohortPolicy(policy){
  try{check(hashInputPackage(policy)===hashInputPackage(BTC_4H_AUTO_COHORT_POLICY),'AUTOMATIC_COHORT_POLICY','고정 BTC 자동 운용의 사전 승인 기간·비용·대조·독립성 정책을 확인하세요.');return [];}catch(error){return [{code:error.code??'AUTOMATIC_COHORT_POLICY',message:error.message}];}
}
export function automaticCohortPolicyHash(policy=BTC_4H_AUTO_COHORT_POLICY){const errors=validateAutomaticCohortPolicy(policy);check(!errors.length,errors[0]?.code,errors[0]?.message);return hashInputPackage(policy);}

export function automaticObservationWindow({barCloseAt,executionAt=null}={}){
  check(stamp(barCloseAt)&&Date.parse(barCloseAt)%FOUR===0,'COHORT_BAR_CLOSE','자동 운용의 UTC 4시간 확정 봉을 확인하세요.');
  check(executionAt===null||stamp(executionAt),'COHORT_EXECUTION_TIME','실제 모의 실행 시각을 확인하세요.');
  const policy=BTC_4H_AUTO_COHORT_POLICY.observation,close=Date.parse(barCloseAt),end=close+policy.horizonBars*FOUR,min=close+policy.executionOffsetMinMs,max=close+policy.executionOffsetMaxMs,time=executionAt===null?null:Date.parse(executionAt);
  return {barCloseAt,executionWindowStartAt:new Date(min).toISOString(),executionWindowEndAt:new Date(max).toISOString(),startAt:executionAt,endAt:new Date(end).toISOString(),actualDurationMs:time===null?null:end-time,minActualDurationMs:policy.minActualDurationMs,maxActualDurationMs:policy.maxActualDurationMs,withinExecutionWindow:time!==null&&time>=min&&time<=max&&time<end};
}

function identityParts({subscription,principleId,marketRegime}){
  check(subscription&&id(subscription.id)&&id(subscription.ownerId)&&id(subscription.profileId)&&HASH.test(subscription.pins?.manifestHash)&&subscription.pins?.cohortPolicyVersion===AUTOMATIC_COHORT_POLICY_VERSION&&subscription.pins.cohortPolicyHash===automaticCohortPolicyHash(),'COHORT_SUBSCRIPTION_PINS','고정 구독과 코호트 정책 해시를 확인하세요.');
  check(id(principleId)&&['trending_up','trending_down','range','volatile','unknown'].includes(marketRegime),'COHORT_SCOPE','적용 원칙과 동일 정책으로 판정한 시장 국면을 확인하세요.');
  return {policyVersion:AUTOMATIC_COHORT_POLICY_VERSION,cohortPolicyHash:automaticCohortPolicyHash(),manifestHash:subscription.pins.manifestHash,principleId,instrumentId:BTC,timeframe:'4h',quoteCurrency:'USDT',marketRegime,marketRegimePolicyVersion:BTC_4H_AUTO_COHORT_POLICY.marketRegimePolicyVersion,evaluationMode:BTC_4H_AUTO_COHORT_POLICY.evaluationMode,costPolicyVersion:BTC_4H_AUTO_COHORT_POLICY.costPolicyVersion,benchmarkPolicyVersion:BTC_4H_AUTO_COHORT_POLICY.benchmarkPolicyVersion,valuationPolicyVersion:BTC_4H_AUTO_COHORT_POLICY.valuationPolicyVersion};
}
function reviewValid(value,now){return exact(value,['policyVersion','reviewId','reviewedAt','reviewerId','commonShock','eventIds'])&&value.policyVersion===BTC_4H_AUTO_COHORT_POLICY.independence.policyVersion&&id(value.reviewId)&&id(value.reviewerId)&&stamp(value.reviewedAt)&&value.reviewedAt<=now&&value.commonShock==='CLEARED'&&Array.isArray(value.eventIds)&&value.eventIds.length<=50&&new Set(value.eventIds).size===value.eventIds.length&&value.eventIds.every(id);}

/** Cohort equivalence and opportunity independence have distinct identities. */
export function buildAutomaticCohortTag({run,subscription,principleId,marketRegime='unknown',priorOpportunities=[],independenceEvidence=null,now:reviewAt}={}){
  const parts=identityParts({subscription,principleId,marketRegime}),automation=run?.automation;
  check(run&&id(run.id)&&run.instrumentId===BTC&&run.profileId===subscription.profileId&&run.manifestHash===subscription.pins.manifestHash&&automation?.subscriptionId===subscription.id&&automation.cohortPolicyVersion===AUTOMATIC_COHORT_POLICY_VERSION&&automation.cohortPolicyHash===automaticCohortPolicyHash(),'COHORT_RUN_SCOPE','새 자동 운용 결정과 고정 정책·종목·코호트를 대조하세요.');
  const window=automaticObservationWindow({barCloseAt:automation.barCloseAt,executionAt:run.execution?.at??null}),cohortKey='cohort-'+hashInputPackage(parts),scope={ownerId:subscription.ownerId,subscriptionId:subscription.id,instrumentId:BTC,timeframe:'4h'};
  check(Array.isArray(priorOpportunities)&&priorOpportunities.length<=1000,'COHORT_PRIOR_LIMIT','독립성 검토의 기존 기회 범위를 확인하세요.');
  const now=reviewAt??run.execution?.at??run.decisionCompletedAt??run.decisionAt;check(stamp(now)&&(!run.execution?.at||now>=run.execution.at),'COHORT_RUN_TIME','자동 결정과 독립성 검토의 실제 시각을 확인하세요.');
  const reviewed=!!reviewValid(independenceEvidence,now),events=reviewed?independenceEvidence.eventIds:[],overlaps=[];
  for(const prior of priorOpportunities){
    check(prior&&id(prior.opportunityGroupId)&&stamp(prior.startAt)&&stamp(prior.endAt)&&prior.startAt<prior.endAt&&Array.isArray(prior.eventIds)&&prior.eventIds.length<=50&&prior.eventIds.every(id),'COHORT_PRIOR_SCOPE','기존 기회의 기간·사건·군집 원본을 확인하세요.');
    if(prior.barCloseAt===automation.barCloseAt||window.startAt&&prior.startAt<window.endAt&&window.startAt<prior.endAt||events.some(event=>prior.eventIds.includes(event)))overlaps.push(prior.opportunityGroupId);
  }
  const opportunityGroupId=overlaps.sort()[0]??'opportunity-'+hashInputPackage({...scope,cluster:reviewed?automation.barCloseAt:'UNRESOLVED_COMMON_SHOCK'});
  return {schemaVersion:1,policyVersion:AUTOMATIC_COHORT_POLICY_VERSION,cohortPolicyHash:automaticCohortPolicyHash(),...parts,cohortKey,opportunityGroupId,subscriptionId:subscription.id,profileId:subscription.profileId,decisionId:run.id,barCloseAt:automation.barCloseAt,startAt:window.startAt,endAt:window.endAt,actualDurationMs:window.actualDurationMs,executionWindowStartAt:window.executionWindowStartAt,executionWindowEndAt:window.executionWindowEndAt,executionWindowEligible:window.withinExecutionWindow,independence:{status:reviewed?(overlaps.length?'SHARED_OPPORTUNITY':'REVIEWED_DISTINCT_OPPORTUNITY'):'UNRESOLVED_COMMON_SHOCK',review:reviewed?structuredClone(independenceEvidence):null,eventIds:events,independentGroupApproved:reviewed&&!overlaps.length},weightPromotion:'USER_APPROVED_CONTROLLED_ABLATION_REQUIRED'};
}

/** New automatic observations use this gate; legacy exact-duration math stays intact. */
export function validateAutomaticCohortExperience({run,observation,tag}={}){
  const reasons=[],add=(code,message)=>reasons.push({code,message});
  if(!run?.automation||!tag||tag.policyVersion!==AUTOMATIC_COHORT_POLICY_VERSION||tag.cohortPolicyHash!==automaticCohortPolicyHash()||run.automation.cohortPolicyVersion!==AUTOMATIC_COHORT_POLICY_VERSION||run.automation.cohortPolicyHash!==automaticCohortPolicyHash()||tag.barCloseAt!==run.automation.barCloseAt||tag.decisionId!==run.id||tag.manifestHash!==run.manifestHash||tag.subscriptionId!==run.automation.subscriptionId){add('COHORT_EXPERIENCE_SCOPE','새 자동 운용 결정과 코호트 태그의 원본 범위를 확인하세요.');return {eligible:false,reasons,weightPromotionAllowed:false};}
  const identityFields=['policyVersion','cohortPolicyHash','manifestHash','principleId','instrumentId','timeframe','quoteCurrency','marketRegime','marketRegimePolicyVersion','evaluationMode','costPolicyVersion','benchmarkPolicyVersion','valuationPolicyVersion'];
  if(!id(tag.principleId)||!run.rawRequest?.state?.principles?.some(p=>p.id===tag.principleId)||tag.instrumentId!==BTC||tag.timeframe!=='4h'||tag.quoteCurrency!=='USDT'||!['trending_up','trending_down','range','volatile','unknown'].includes(tag.marketRegime)||['marketRegimePolicyVersion','evaluationMode','costPolicyVersion','benchmarkPolicyVersion','valuationPolicyVersion'].some(k=>tag[k]!==BTC_4H_AUTO_COHORT_POLICY[k])||tag.cohortKey!=='cohort-'+hashInputPackage(Object.fromEntries(identityFields.map(k=>[k,tag[k]]))))add('COHORT_IDENTITY_MISMATCH','동일 원칙·정책·국면·비용·대조 계약의 코호트 식별자를 확인하세요.');
  let window;try{window=automaticObservationWindow({barCloseAt:run.automation.barCloseAt,executionAt:run.execution?.at??null});}catch(error){add(error.code,error.message);return {eligible:false,reasons,weightPromotionAllowed:false};}
  if(!window.withinExecutionWindow||!tag.executionWindowEligible||tag.startAt!==window.startAt||tag.endAt!==window.endAt||tag.actualDurationMs!==window.actualDurationMs)add('COHORT_EXECUTION_WINDOW','실제 실행을 사전 승인한 +5~+10분 창과 관측 기간에 맞추세요.');
  if(!['FILLED','NO_ORDER_REQUIRED'].includes(run.execution?.status)||!run.execution.accountSnapshotAfter||run.execution.accountSnapshotAfter.asOf!==run.execution.at||validateMindPaperAccount(run.execution.accountSnapshotAfter).length||run.execution.accountSnapshotAfter.quoteCurrency!=='USDT'||run.execution.accountSnapshotAfter.positions.some(p=>p.instrumentId!==BTC))add('COHORT_EXECUTION_SNAPSHOT','실행 확정 시각에 고정한 BTC·USDT 원장·평가 계좌를 준비하세요.');
  if(!observation||observation.period?.start!==window.startAt||observation.period?.end!==window.endAt||observation.asOf!==window.endAt||!stamp(observation.observedAt)||observation.observedAt<window.endAt||observation.runId!==run.id||observation.profileId!==run.profileId)add('COHORT_OBSERVATION_COMPLETE','실행 시각부터 기준 봉+8시간까지 완료한 관측을 연결하세요.');
  if(observation?.metrics?.benchmarkId!==BTC_4H_AUTO_COHORT_POLICY.benchmarkPolicyVersion||!['netReturn','benchmarkReturn','feesReturn','slippageReturn','maxDrawdown'].every(k=>finite(observation?.metrics?.[k])))add('COHORT_COMPARATOR_REQUIRED','동일 비용·대조 정책의 유한한 성과와 낙폭을 준비하세요.');
  const after=run.execution?.accountSnapshotAfter,quotes=run.execution?.valuationQuotes,needed=[...new Set([run.instrumentId,...(after?.positions??[]).filter(p=>p.quantity>0).map(p=>p.instrumentId)])];
  if(!Array.isArray(quotes)||quotes.length>100||new Set(quotes.map(q=>q?.instrumentId)).size!==quotes.length||needed.some(instrumentId=>!quotes.some(q=>q.instrumentId===instrumentId&&q.currency==='USDT'&&finite(q.price)&&q.price>0&&stamp(q.asOf)&&stamp(q.receivedAt)&&q.asOf<=q.receivedAt&&q.receivedAt<=window.startAt&&Date.parse(window.startAt)-Date.parse(q.asOf)<=30000&&HASH.test(q.rawSha256??''))))add('COHORT_COMPLETE_VALUATION','실행 시점 모든 보유 종목의 실제 평가 가격·시각·원본 해시를 준비하세요.');
  const cohortEligible=!reasons.length;
  if(!tag.independence?.independentGroupApproved||!reviewValid(tag.independence?.review,observation?.observedAt??window.startAt))add('COHORT_INDEPENDENCE_REVIEW_REQUIRED','중첩·공통 충격을 검토한 독립 기회 승인 기록을 준비하세요.');
  return {eligible:!reasons.length,cohortEligible,independenceEligible:!reasons.some(r=>r.code==='COHORT_INDEPENDENCE_REVIEW_REQUIRED'),reasons,cohortKey:tag.cohortKey,opportunityGroupId:tag.opportunityGroupId,weightPromotionAllowed:false};
}
