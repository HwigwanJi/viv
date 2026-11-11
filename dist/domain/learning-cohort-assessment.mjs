import {assertMindDocument,mindDocumentHash,MindDocumentError} from './mind-manifest.mjs';
import {hashInputPackage} from './workspace.mjs';
import {AUTOMATIC_COHORT_POLICY_VERSION,BTC_4H_AUTO_COHORT_POLICY,automaticCohortPolicyHash,automaticObservationWindow,validateAutomaticCohortExperience} from './learning-cohort.mjs';

export const AUTOMATIC_LEARNING_COMPARISON='AUTO_COHORT_WINDOW_V2';
const clone=structuredClone,hash=hashInputPackage,check=(value,code,message)=>{if(!value)throw new MindDocumentError(code,message);};
const average=values=>values.length?values.reduce((n,v)=>n+v,0)/values.length:0,clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
const iso=value=>typeof value==='string'&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value;
const HASH=/^[a-f0-9]{64}$/;

/** Re-export immutable automatic references; only actual source IDs are emitted. */
export function buildAutomaticEvaluation({run,manifest,runEvidenceHash,principleIds}={}){
  check(run?.automation&&run.observation&&HASH.test(runEvidenceHash??'')&&manifest?.id===run.manifestId&&mindDocumentHash(manifest)===run.manifestHash,'AUTO_EVALUATION_SOURCE','자동 운용 당시 정책과 완료 관측 원본을 연결하세요.');
  const ids=principleIds??manifest.data.principles.filter(p=>run.rawRequest?.state?.principles?.some(actual=>actual.id===p.id&&actual.version===p.version)).map(p=>p.id);
  check(Array.isArray(ids)&&ids.length>0&&new Set(ids).size===ids.length&&ids.every(id=>manifest.data.principles.some(p=>p.id===id))&&Array.isArray(run.observation.cohorts)&&run.observation.cohorts.length>0,'AUTO_EVALUATION_PRINCIPLES','실제 판단에 적용한 원칙과 관측 코호트를 연결하세요.');
  return {sourceMode:'FORWARD_AUTO',runId:run.id,runEvidenceHash,observationId:run.observation.id??null,observationHash:hash(run.observation),manifestId:manifest.id,manifestHash:run.manifestHash,policyVersion:run.automation.cohortPolicyVersion,policyHash:run.automation.cohortPolicyHash,principleIds:clone(ids),cohorts:clone(run.observation.cohorts)};
}

/** Every persistence boundary rechecks this against the owner's actual run. */
export function assertAutomaticEvaluationSource(doc,{run,manifest,ownerId,runEvidenceHash,now}={}){
  assertMindDocument(doc);
  check(doc.schemaVersion===2&&run?.automation,'EVALUATION_METADATA_DOWNGRADE','자동 운용 관측은 원본 코호트가 포함된 버전 2 양식으로 저장하세요.');
  check(typeof ownerId==='string'&&run.automation.ownerId===ownerId&&run.profileId===doc.scope.profileId&&doc.scope.instrumentIds.length===1&&doc.scope.instrumentIds[0]===run.instrumentId,'AUTO_EVALUATION_OWNER','현재 소유자의 자동 운용·마인드·종목을 연결하세요.');
  const actual=buildAutomaticEvaluation({run,manifest,runEvidenceHash,principleIds:doc.principleRefs});
  check(hash(doc.evaluation)===hash(actual),'AUTO_EVALUATION_CHANGED','저장된 결정·관측·정책·코호트의 원본 참조를 그대로 보존하세요.');
  check(actual.policyVersion===AUTOMATIC_COHORT_POLICY_VERSION&&actual.policyHash===automaticCohortPolicyHash()&&iso(now)&&run.observation.observedAt<=now&&run.observation.period.end<=now,'AUTO_EVALUATION_POLICY','사전 승인한 자동 코호트 정책과 완료된 실제 관측 시각을 확인하세요.');
  check(run.automation.pins?.manifestId===manifest.id&&run.automation.pins.manifestHash===run.manifestHash&&run.automation.pins.cohortPolicyVersion===actual.policyVersion&&run.automation.pins.cohortPolicyHash===actual.policyHash,'AUTO_EVALUATION_POLICY_PINS','자동 구독에 고정한 원래 정책과 코호트 버전을 대조하세요.');
  const window=automaticObservationWindow({barCloseAt:run.automation.barCloseAt,executionAt:run.execution?.at??null});
  check(iso(run.provider?.startedAt)&&run.provider.startedAt>=window.executionWindowStartAt&&run.provider.startedAt<=window.executionWindowEndAt&&run.provider.startedAt<=run.execution.at,'AUTO_EVALUATION_REQUEST_WINDOW','실제 JEV 호출 시작을 사전 승인한 +5~+10분 창과 대조하세요.');
  check(hash(doc.data.period)===hash(run.observation.period)&&hash(doc.data.metrics)===hash(run.observation.metrics),'AUTO_EVALUATION_METRICS','실제 실행·관측의 기간과 비용 후 성과를 보존하세요.');
  for(const id of doc.principleRefs){
    const principle=manifest.data.principles.find(p=>p.id===id),applied=run.rawRequest?.state?.principles?.find(p=>p.id===id);
    check(principle&&applied?.version===principle.version,'AUTO_EVALUATION_PRINCIPLE_VERSION','판단 당시 적용한 원칙 버전을 연결하세요.');
  }
  if(doc.kind==='principle-evidence'){
    const c=actual.cohorts.find(c=>c.tag.principleId===doc.data.principleId),p=manifest.data.principles.find(p=>p.id===doc.data.principleId);
    check(c&&p?.version===doc.data.principleVersion&&doc.data.regime===c.tag.marketRegime&&doc.data.independenceGroup===c.tag.opportunityGroupId,'AUTO_EVALUATION_GROUP','원본 국면·기회 그룹·원칙 버전을 보존하세요.');
    check(doc.data.attribution==='observational','AUTOMATIC_CONTROLLED_ABLATION_REQUIRED','자동 관측은 관측 사실로 발행하고 원칙 기여도는 통제 비교 원본을 갖춘 승인 경로에서 검토하세요.');
  }
  // Structural/source integrity holds even when the preapproved execution window
  // excludes this factual observation from learning.
  const performance=run.observation.performance,quote=run.execution?.quote,before=run.accountSnapshot;
  check(run.observation.methodVersion==='mind-auto-fixed-post-execution-cost-inclusive-v1'&&run.observation.metrics.benchmarkId===BTC_4H_AUTO_COHORT_POLICY.benchmarkPolicyVersion&&before&&quote&&Array.isArray(run.execution.valuationQuotes)&&hash(run.execution.valuationQuotes)===hash(run.observation.source?.preTradeValuation?.quotes),'AUTO_EVALUATION_COST_SOURCE','실행 가격·매매 전 평가 기준·고정 비용·대조 정책의 원본을 연결하세요.');
  const initial=before.cash+before.positions.reduce((sum,p)=>sum+p.quantity*(p.instrumentId===run.instrumentId?quote.price:NaN),0);
  check(Number.isFinite(initial)&&initial>0&&performance?.initialEquity===initial&&run.observation.source.preTradeValuation.accountSnapshotHash===hash(before)&&run.observation.source.preTradeValuation.initialEquity===initial&&run.observation.metrics.netReturn===performance.endingEquity/initial-1&&run.observation.metrics.feesReturn===(run.execution.fee??0)/initial&&run.observation.metrics.slippageReturn===(run.execution.slippageCost??0)/initial,'AUTO_EVALUATION_COST_MISMATCH','매매 전 실제 평가액으로 순수익률·수수료·슬리피지를 다시 대조하세요.');
  for(const c of actual.cohorts){const gate=validateAutomaticCohortExperience({run,observation:run.observation,tag:c.tag});check(gate.reasons.every(r=>['COHORT_EXECUTION_WINDOW','COHORT_INDEPENDENCE_REVIEW_REQUIRED'].includes(r.code)),'AUTO_EVALUATION_INTEGRITY','실제 원본·완료 관측·보유 평가·비용·대조 계약을 다시 확인하세요.');}
  return actual;
}

function tagProblem(doc,tag,manifest,now){
  const e=doc.evaluation,p=BTC_4H_AUTO_COHORT_POLICY;
  if(doc.availableAt>now||doc.asOf>now||doc.data.period.end>now)return 'not-available';
  if(!doc.provenance.contentHashes.includes(e.observationHash)||!doc.provenance.contentHashes.includes(e.runEvidenceHash)||!doc.provenance.recordRefs.includes(e.runId))return 'provenance-incomplete';
  if(e.policyVersion!==AUTOMATIC_COHORT_POLICY_VERSION||e.policyHash!==automaticCohortPolicyHash()||e.manifestHash!==mindDocumentHash(manifest))return 'cohort-policy-mismatch';
  if(!tag||tag.policyVersion!==e.policyVersion||tag.cohortPolicyHash!==e.policyHash||tag.decisionId!==e.runId||tag.manifestHash!==e.manifestHash||tag.principleId!==doc.data.principleId||doc.data.independenceGroup!==tag.opportunityGroupId||doc.data.regime!==tag.marketRegime)return 'cohort-source-mismatch';
  const fields=['policyVersion','cohortPolicyHash','manifestHash','principleId','instrumentId','timeframe','quoteCurrency','marketRegime','marketRegimePolicyVersion','evaluationMode','costPolicyVersion','benchmarkPolicyVersion','valuationPolicyVersion'];
  if(tag.cohortKey!=='cohort-'+hash(Object.fromEntries(fields.map(k=>[k,tag[k]])))||tag.instrumentId!==p.instrumentId||tag.timeframe!==p.timeframe||tag.quoteCurrency!==p.quoteCurrency||['marketRegimePolicyVersion','evaluationMode','costPolicyVersion','benchmarkPolicyVersion','valuationPolicyVersion'].some(k=>tag[k]!==p[k])||doc.data.metrics.benchmarkId!==p.benchmarkPolicyVersion)return 'cohort-contract-mismatch';
  let window;try{window=automaticObservationWindow({barCloseAt:tag.barCloseAt,executionAt:doc.data.period.start});}catch{return 'cohort-execution-window';}
  if(!window.withinExecutionWindow||!tag.executionWindowEligible||hash(doc.data.period)!==hash({start:tag.startAt,end:tag.endAt})||tag.endAt!==window.endAt||tag.actualDurationMs!==window.actualDurationMs||tag.actualDurationMs<p.observation.minActualDurationMs||tag.actualDurationMs>p.observation.maxActualDurationMs)return 'cohort-execution-window';
  return null;
}

/** Policy equivalence preserves actual milliseconds; independence remains explicit. */
export function assessAutomaticPrincipleEvidence(manifest,principleId,evidence,options={}){
  assertMindDocument(manifest);const principle=manifest.data.principles.find(p=>p.id===principleId),now=options.now??new Date().toISOString(),policy=manifest.data.weightPolicy;
  check(principle&&iso(now)&&Array.isArray(evidence)&&evidence.length<=2000,'LEARNING_SCOPE','원칙·평가 시각·연결 근거를 확인하세요.');
  const priorStrength=options.priorStrength??8,maxStep=Math.min(options.maxStep??policy.maxStep,policy.maxStep),minimum=Math.max(options.minIndependentSamples??policy.minIndependentSamples,policy.minIndependentSamples);
  check(Number.isFinite(priorStrength)&&priorStrength>=3&&priorStrength<=1000&&Number.isFinite(maxStep)&&maxStep>=0&&maxStep<=.1&&Number.isSafeInteger(minimum)&&minimum>=3&&minimum<=2000,'LEARNING_POLICY','수축 강도·변경 폭·최소 독립 표본을 확인하세요.');
  const cohortKeys=[...new Set(evidence.filter(d=>d?.schemaVersion===2).flatMap(d=>d.evaluation.cohorts.filter(c=>c.tag.principleId===principleId).map(c=>c.tag.cohortKey)))].sort(),cohortKey=options.cohortKey??(cohortKeys.length===1?cohortKeys[0]:null);
  check(typeof cohortKey==='string'&&/^cohort-[a-f0-9]{64}$/.test(cohortKey),'LEARNING_COHORT_REQUIRED','가중치를 검토할 사전 승인 코호트 하나를 선택하세요.');
  const seen=new Set(),facts=[],independent=[],excluded=[];
  for(const doc of [...evidence].sort((a,b)=>String(a?.id).localeCompare(String(b?.id)))){
    assertMindDocument(doc);check(doc.kind==='principle-evidence'&&doc.scope.profileId===manifest.scope.profileId&&doc.data.principleId===principleId&&doc.data.principleVersion===principle.version&&doc.scope.instrumentIds.every(id=>manifest.data.universe.instrumentIds.includes(id)),'LEARNING_EVIDENCE_SCOPE','같은 마인드·원칙 버전·종목의 근거를 연결하세요.');
    if(doc.schemaVersion!==2){excluded.push({evidenceId:doc.id,reason:'legacy-exact-duration-cohort'});continue;}
    const tag=doc.evaluation.cohorts.find(c=>c.tag.principleId===principleId)?.tag,key=doc.data.decisionId+':'+doc.data.sourceRecordHash;
    let reason=tag?.cohortKey!==cohortKey?'different-cohort':seen.has(key)?'duplicate-source':tagProblem(doc,tag,manifest,now);seen.add(key);
    if(reason){excluded.push({evidenceId:doc.id,reason});continue;}facts.push(doc);
    const independence=tag.independence,review=independence?.review;
    if(!independence?.independentGroupApproved||independence.status!=='REVIEWED_DISTINCT_OPPORTUNITY'||review?.policyVersion!==BTC_4H_AUTO_COHORT_POLICY.independence.policyVersion||review?.commonShock!=='CLEARED'||!iso(review?.reviewedAt)||review.reviewedAt>now||!Array.isArray(review.eventIds))reason='common-shock-review-required';
    else if(doc.data.direction==='unresolved')reason='unresolved-attribution';
    if(reason)excluded.push({evidenceId:doc.id,reason});else independent.push(doc);
  }
  // Explicit groups, the same decision bar, overlapping periods and shared event
  // IDs are connected before counting. Three same-bar wrappers count at most one.
  const groups=[];
  for(const doc of independent){const tag=doc.evaluation.cohorts.find(c=>c.tag.principleId===principleId).tag;const related=groups.filter(g=>g.some(other=>{const t=other.evaluation.cohorts.find(c=>c.tag.principleId===principleId).tag;return tag.opportunityGroupId===t.opportunityGroupId||tag.barCloseAt===t.barCloseAt||doc.data.period.start<other.data.period.end&&other.data.period.start<doc.data.period.end||tag.independence.eventIds.some(id=>t.independence.eventIds.includes(id));}));if(!related.length)groups.push([doc]);else{const merged=[doc,...related.flat()];for(const g of related)groups.splice(groups.indexOf(g),1);groups.push(merged);}}
  const samples=groups.map((g,i)=>{const netReturn=average(g.map(d=>d.data.metrics.netReturn)),benchmarkReturn=average(g.map(d=>d.data.metrics.benchmarkReturn)),maxDrawdown=Math.max(...g.map(d=>d.data.metrics.maxDrawdown)),excessReturn=netReturn-benchmarkReturn,riskAdjustedExcess=clamp(excessReturn,-.5,.5)-.5*maxDrawdown;return {id:'auto-sample-'+(i+1),evidenceIds:g.map(d=>d.id).sort(),start:g.map(d=>d.data.period.start).sort()[0],end:g.map(d=>d.data.period.end).sort().at(-1),regimes:[...new Set(g.map(d=>d.data.regime))].sort(),netReturn,benchmarkReturn,excessReturn,feesReturn:average(g.map(d=>d.data.metrics.feesReturn)),slippageReturn:average(g.map(d=>d.data.metrics.slippageReturn)),maxDrawdown,riskAdjustedExcess,score:Math.tanh(riskAdjustedExcess/.03),controlled:g.every(d=>d.data.attribution==='controlled-ablation')};});
  const count=samples.length,controlled=samples.filter(s=>s.controlled).length,mean=average(samples.map(s=>s.riskAdjustedExcess)),shrunkScore=Math.tanh(mean/.03)*count/(priorStrength+count),status=principle.kind==='core'?'CORE_FIXED':count>=minimum&&controlled>=minimum?'REVIEW_REQUIRED':'INSUFFICIENT_EVIDENCE',proposedWeight=status==='REVIEW_REQUIRED'?clamp(principle.weight+maxStep*shrunkScore,principle.bounds.min,principle.bounds.max):principle.weight,horizons=[...new Set(facts.map(d=>Date.parse(d.data.period.end)-Date.parse(d.data.period.start)))].sort((a,b)=>a-b),regimes=[...new Set(facts.map(d=>d.data.regime))].sort();
  return {methodVersion:'bounded-shrinkage-v1',evaluatedAt:now,status,principleId,principleVersion:principle.version,previousWeight:principle.weight,proposedWeight,delta:proposedWeight-principle.weight,evidenceCount:evidence.length,includedEvidenceCount:facts.length,observedEvidenceCount:facts.length,independenceApprovedGroupCount:count,independentSampleCount:count,minimumIndependentSamples:minimum,priorStrength,maxStep,shrunkScore,comparison:{mode:AUTOMATIC_LEARNING_COMPARISON,cohortKey,policyVersion:AUTOMATIC_COHORT_POLICY_VERSION,policyHash:automaticCohortPolicyHash(),comparablePolicy:facts.length>0,minActualDurationMs:BTC_4H_AUTO_COHORT_POLICY.observation.minActualDurationMs,maxActualDurationMs:BTC_4H_AUTO_COHORT_POLICY.observation.maxActualDurationMs,actualDurationsMs:horizons},summary:{meanNetReturn:facts.length?average(facts.map(d=>d.data.metrics.netReturn)):null,meanBenchmarkReturn:facts.length?average(facts.map(d=>d.data.metrics.benchmarkReturn)):null,meanExcessReturn:facts.length?average(facts.map(d=>d.data.metrics.netReturn-d.data.metrics.benchmarkReturn)):null,meanRiskAdjustedExcess:samples.length?mean:null,maxDrawdown:facts.length?Math.max(...facts.map(d=>d.data.metrics.maxDrawdown)):null,meanFeesReturn:facts.length?average(facts.map(d=>d.data.metrics.feesReturn)):null,meanSlippageReturn:facts.length?average(facts.map(d=>d.data.metrics.slippageReturn)):null,observationHorizonsMs:horizons,comparableHorizon:facts.length>0,regimeCount:regimes.length,regimes,controlledSamples:controlled},samples,includedEvidenceIds:facts.map(d=>d.id).sort(),sourceEvidenceIds:evidence.map(d=>d.id).sort(),sourceEvidenceHashes:evidence.map(d=>({id:d.id,contentHash:mindDocumentHash(d)})).sort((a,b)=>a.id.localeCompare(b.id)),excluded,limitations:['사전 승인한 실행 창·관측 종료·정책·비용·대조 계약으로 비교하며 실제 밀리초 기간을 보존한다.','관측 사실과 독립 기회 승인을 별도로 집계한다. 공통 충격 검토와 통제 실험을 완료한 근거를 가중치 승인에 사용한다.','동일 봉·겹친 기간·동일 기회·공유 사건을 보수적으로 한 표본으로 묶는다. 승인한 새 정책을 미래 실행에 명시 적용한다.']};
}
