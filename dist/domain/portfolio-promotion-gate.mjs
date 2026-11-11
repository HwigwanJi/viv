import {hashInputPackage} from './workspace.mjs';
const hash=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v),finite=v=>typeof v==='number'&&Number.isFinite(v),stamp=v=>typeof v==='string'&&Number.isFinite(Date.parse(v));
export const portfolioCandidateMetricsHash=c=>{const {metricsHash,...content}=c;return hashInputPackage(content);};
export function inspectPortfolioCandidate(candidate,{mandateId,now}={}){
 const reasons=[],c=candidate??{},m=c.metrics??{},costs=c.costs??{};
 if(c.mandateId!==mandateId||!hash(c.modelHash)||!hash(c.baselineModelHash)||!hash(c.protocolHash)||!hash(c.datasetHash)||!hash(c.metricsHash)||c.modelHash===c.baselineModelHash)reasons.push('CANDIDATE_SCOPE_OR_HASH');
 try{if(c.metricsHash!==portfolioCandidateMetricsHash(c))reasons.push('METRICS_CONTENT_CHANGED');}catch{reasons.push('METRICS_CONTENT_CHANGED');}
 if(!stamp(now)||!stamp(c.frozenAt)||!stamp(c.validationFrom)||!stamp(c.validationTo)||Date.parse(c.frozenAt)>=Date.parse(c.validationFrom)||Date.parse(c.validationFrom)>=Date.parse(c.validationTo)||Date.parse(c.validationTo)>Date.parse(now)||c.selectionUsedValidation!==false)reasons.push('INDEPENDENT_VALIDATION_WINDOW');
 if(c.evidenceOrigin!=='OBSERVED_EVENT_PAPER'||c.completePricePath!==true||!Number.isSafeInteger(c.completedRoundTrips)||c.completedRoundTrips<1)reasons.push('OBSERVED_COMPLETE_PAPER_LEDGER');
 if(costs.feesIncluded!==true||costs.slippageIncluded!==true||costs.modelCallsIncluded!==true||![costs.feeAmount,costs.slippageAmount,costs.modelCallAmount].every(v=>finite(v)&&v>=0))reasons.push('COMPLETE_COST_ACCOUNTING');
 if(![m.netReturn,m.baselineNetReturn,m.benchmarkNetReturn,m.mdd,m.baselineMdd,m.benchmarkMdd].every(finite)||[m.mdd,m.baselineMdd,m.benchmarkMdd].some(v=>v<0||v>1)||!['RECOVERED','UNRECOVERED'].includes(m.recoveryStatus)||!finite(m.observedRecoveryHours)||m.observedRecoveryHours<0)reasons.push('COMPARABLE_RETURN_DRAWDOWN_RECOVERY');
 if(!(m.netReturn>0&&m.netReturn>m.baselineNetReturn&&m.netReturn>m.benchmarkNetReturn))reasons.push('POSITIVE_NET_AND_BENCHMARK_EXCESS');
 if(c.withinMandateLimits!==true)reasons.push('MANDATE_LIMITS');
 return {eligible:reasons.length===0,reasons,modelHash:c.modelHash??null,mddChange:finite(m.mdd)&&finite(m.baselineMdd)?m.mdd-m.baselineMdd:null};
}
/** Completion uses actual deployment receipts; fixture success never increments adoption. */
export function portfolioPromotionGate({mandateId,candidates=[],receipts=[],activeModels=[],now=new Date().toISOString()}={}){
 if(typeof mandateId!=='string'||!mandateId||!stamp(now)||!Array.isArray(candidates)||!Array.isArray(receipts)||!Array.isArray(activeModels))throw Error('운용 위임과 후보, 실제 적용 기록을 확인하세요.');
 const inspected=candidates.map(c=>({candidate:c,...inspectPortfolioCandidate(c,{mandateId,now})})),eligible=inspected.filter(c=>c.eligible),applied=new Set();
 for(const r of receipts){const c=eligible.find(v=>v.candidate.modelHash===r.modelHash&&v.candidate.metricsHash===r.metricsHash),active=activeModels.some(a=>a.activationId===r.activationId&&a.mandateId===mandateId&&a.graphHash===r.graphHash&&a.modelHash===r.modelHash);if(c&&active&&r.mandateId===mandateId&&r.status==='APPLIED'&&r.executionMode==='LIVE'&&r.origin==='PRODUCT_AUTO_PROMOTION'&&r.runtimeVerified===true&&hash(r.graphHash)&&stamp(r.appliedAt)&&stamp(r.runtimeVerifiedAt)&&Date.parse(r.appliedAt)>=Date.parse(c.candidate.validationTo)&&Date.parse(r.appliedAt)<=Date.parse(r.runtimeVerifiedAt)&&Date.parse(r.runtimeVerifiedAt)<=Date.parse(now))applied.add(r.modelHash);}
 return {contractVersion:'portfolio-promotion-completion-v1',status:applied.size>=1?'COMPLETE':eligible.length?'AWAITING_PRODUCT_APPLICATION':'RESEARCHING',requiredAppliedCount:1,appliedCount:applied.size,appliedModelHashes:[...applied],eligibleCount:eligible.length,candidates:inspected.map(({candidate,...result})=>result),nextAction:applied.size?'VERIFY_CONTINUED_OPERATION':eligible.length?'CHECK_PRODUCT_APPLICATION_RECEIPT':'REVISE_CAUSAL_ASSUMPTION_AND_REGISTER_NEXT_EXPERIMENT'};
}
