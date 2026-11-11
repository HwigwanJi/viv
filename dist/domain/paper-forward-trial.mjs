import {hashInputPackage} from './workspace.mjs';
import {assertMindDocument,mindDocumentHash} from './mind-manifest.mjs';
import {createMindPaperAccount,validateMindPaperAccount} from './mind-paper.mjs';
import {strategyPlanWithGraph,approveMindStrategyPlan} from './mind-strategy-plan.mjs';

export const PAPER_FORWARD_TRIAL_VERSION='paper-forward-paired-ledgers-v1';
export const PAPER_FORWARD_TRIAL_LIMITS=Object.freeze({maxBars:180,minimumClosedEpisodes:6,minReturnImprovement:.0001,maxDrawdownIncrease:0});
const H=14400000,clone=structuredClone,HASH=/^[a-f0-9]{64}$/;
const iso=v=>typeof v==='string'&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString()===v;
const check=(v,code,message)=>{if(!v)throw Object.assign(new Error(message),{code,status:409});};
export function createPaperTrialCandidateManifest({baselineManifest,candidateGraph,id,ownerId,now}){
 const m=clone(baselineManifest);m.id=id;m.asOf=now;m.availableAt=now;m.data.version++;
 m.source={type:'user',id:ownerId,uri:null};m.provenance={...m.provenance,createdAt:now,authorId:ownerId,recordRefs:[...new Set([...m.provenance.recordRefs,baselineManifest.id])],classification:null};
 m.data.strategyPlan=approveMindStrategyPlan(strategyPlanWithGraph(baselineManifest.data.strategyPlan,candidateGraph,{planVersionId:'forward-'+hashInputPackage(candidateGraph).slice(0,24)}),{now,ownerId});
 assertMindDocument(m);return m;
}
export function createPaperForwardTrial({id,ownerId,subscriptionId,baselineManifest,candidateManifest,initialCash,createdAt,fitEvidenceHash}){
 for(const m of [baselineManifest,candidateManifest])assertMindDocument(m);
 check(iso(createdAt)&&HASH.test(fitEvidenceHash)&&baselineManifest.scope.profileId===candidateManifest.scope.profileId&&mindDocumentHash(baselineManifest)!==mindDocumentHash(candidateManifest),'FORWARD_TRIAL_SOURCE','원 전략과 후보 정책·생성 시각을 확인하세요.');
 const profileId=baselineManifest.scope.profileId,startAt=new Date((Math.floor(Date.parse(createdAt)/H)+1)*H).toISOString();
 const arm=(key,manifest)=>({manifest:clone(manifest),manifestHash:mindDocumentHash(manifest),account:{...createMindPaperAccount({id:'paper-trial-'+hashInputPackage({id,key}).slice(0,32),profileId,quoteCurrency:'USDT',initialCash,now:createdAt}),kind:'PAPER_ACCOUNT'},runs:[],marks:[{at:createdAt,equity:initialCash}]});
 const trial={contractVersion:PAPER_FORWARD_TRIAL_VERSION,id,ownerId,subscriptionId,profileId,createdAt,startAt,nextCloseAt:startAt,endsAt:new Date(Date.parse(startAt)+(PAPER_FORWARD_TRIAL_LIMITS.maxBars-1)*H).toISOString(),initialCash,fitEvidenceHash,status:'WAITING_START',reason:null,updatedAt:createdAt,limits:clone(PAPER_FORWARD_TRIAL_LIMITS),arms:{baseline:arm('baseline',baselineManifest),candidate:arm('candidate',candidateManifest)},frames:[],pending:null};
 assertPaperForwardTrial(trial);return trial;
}
export function assertPaperForwardTrial(t){
 check(t?.contractVersion===PAPER_FORWARD_TRIAL_VERSION&&['WAITING_START','RUNNING','READY_TO_PROMOTE','KEEP_BASELINE','INTERRUPTED','PROMOTED'].includes(t.status)&&[t.createdAt,t.startAt,t.nextCloseAt,t.endsAt,t.updatedAt].every(iso)&&t.startAt>t.createdAt&&Date.parse(t.startAt)%H===0&&t.limits?.maxBars===180&&t.limits.minimumClosedEpisodes===6&&t.limits.minReturnImprovement===.0001&&t.limits.maxDrawdownIncrease===0&&Number.isFinite(t.initialCash)&&t.initialCash>0&&HASH.test(t.fitEvidenceHash)&&Array.isArray(t.frames)&&t.frames.length<=180,'FORWARD_TRIAL_INVALID','전진 비교의 고정 기간·표본·시작 자금을 확인하세요.');
 check(t.endsAt===new Date(Date.parse(t.startAt)+179*H).toISOString()&&t.nextCloseAt===new Date(Date.parse(t.startAt)+t.frames.length*H).toISOString(),'FORWARD_TRIAL_CANDLE_SEQUENCE','비교 기간과 연속 확정 봉을 대조하세요.');
 for(const key of ['baseline','candidate']){
  const a=t.arms?.[key];assertMindDocument(a?.manifest);
  check(a.manifest.scope.profileId===t.profileId&&a.manifestHash===mindDocumentHash(a.manifest)&&a.account.profileId===t.profileId&&a.account.initialCash===t.initialCash&&a.account.createdAt===t.createdAt&&(a.account.fundingLedger??[]).length===0&&a.account.quoteCurrency==='USDT'&&!validateMindPaperAccount(a.account).length&&Array.isArray(a.runs)&&Array.isArray(a.marks)&&a.marks.length===t.frames.length+1&&a.marks.every(p=>iso(p.at)&&Number.isFinite(p.equity)&&p.equity>=0),'FORWARD_TRIAL_ARM_INVALID','각 전략의 독립 원장·정책·같은 시작 자금을 대조하세요.');
 }
 check(t.arms.baseline.account.id!==t.arms.candidate.account.id&&t.arms.baseline.manifestHash!==t.arms.candidate.manifestHash,'FORWARD_TRIAL_INDEPENDENT_ACCOUNTS','비교 전략과 두 계좌의 식별자를 분리하세요.');
 for(const [i,f] of t.frames.entries())check(f.barCloseAt===new Date(Date.parse(t.startAt)+i*H).toISOString()&&[f.marketHash,f.valuationQuoteHash,f.executionQuoteHash].every(h=>HASH.test(h))&&iso(f.completedAt)&&f.completedAt>=f.barCloseAt&&['baseline','candidate'].every(k=>t.arms[k].runs.some(r=>r.id===f.runIds[k]&&r.asOf===f.barCloseAt&&r.manifestHash===t.arms[k].manifestHash)),'FORWARD_TRIAL_FRAME_INVALID','동일 봉·시세 원문·두 전략의 실행 기록을 대조하세요.');
 if(['READY_TO_PROMOTE','PROMOTED'].includes(t.status)){
  const a=paperForwardArmMetrics(t.arms.baseline),b=paperForwardArmMetrics(t.arms.candidate);
  check(t.pending===null&&t.frames.length>0&&a.closedEpisodes>=6&&b.closedEpisodes>=6&&!a.openPositions&&!b.openPositions&&b.netReturn>a.netReturn+.0001&&b.maxDrawdown<=a.maxDrawdown+1e-12&&t.comparison&&hashInputPackage(t.comparison.baseline)===hashInputPackage(a)&&hashInputPackage(t.comparison.candidate)===hashInputPackage(b)&&t.comparison.asOf===t.frames.at(-1).completedAt,'FORWARD_PROMOTION_EVIDENCE','두 독립 원장의 실제 종료 거래·현금 수익·낙폭과 승격 근거를 대조하세요.');
 }
 return t;
}
export function paperForwardArmMetrics(arm){
 let peak=arm.account.initialCash,maxDrawdown=0;for(const p of arm.marks){peak=Math.max(peak,p.equity);maxDrawdown=Math.max(maxDrawdown,peak>0?1-p.equity/peak:0);}
 return {manifestId:arm.manifest.id,manifestHash:arm.manifestHash,initialCash:arm.account.initialCash,equity:arm.account.equity,netReturn:arm.account.netReturn,maxDrawdown,closedEpisodes:arm.account.ledger.filter(f=>f.side==='sell'&&f.quantityAfter<=1e-8).length,openPositions:arm.account.positions.length,asOf:arm.account.asOf};
}
export function finishPaperForwardFrame(trial,frame){
 const t=clone(trial);check(frame.barCloseAt===t.nextCloseAt,'FORWARD_TRIAL_CANDLE_SEQUENCE','다음 확정 봉에서 두 전략을 함께 평가하세요.');t.frames.push(clone(frame));t.nextCloseAt=new Date(Date.parse(t.startAt)+t.frames.length*H).toISOString();t.pending=null;t.updatedAt=frame.completedAt;
 for(const key of ['baseline','candidate'])t.arms[key].marks.push({at:frame.completedAt,equity:t.arms[key].account.equity});
 const a=paperForwardArmMetrics(t.arms.baseline),b=paperForwardArmMetrics(t.arms.candidate),enough=a.closedEpisodes>=6&&b.closedEpisodes>=6,bothFlat=!a.openPositions&&!b.openPositions,ended=t.frames.length>=180;
 if(enough&&bothFlat){const improved=b.netReturn>a.netReturn+.0001&&b.maxDrawdown<=a.maxDrawdown+1e-12;t.status=improved?'READY_TO_PROMOTE':'KEEP_BASELINE';t.reason=improved?'FORWARD_COMPARISON_PASSED':'FORWARD_COMPARISON_NOT_IMPROVED';t.comparison={asOf:frame.completedAt,baseline:a,candidate:b,deltaReturn:b.netReturn-a.netReturn,deltaDrawdown:b.maxDrawdown-a.maxDrawdown};}
 else if(ended){t.status='KEEP_BASELINE';t.reason=bothFlat?'TRIAL_ENDED_INSUFFICIENT_EPISODES':'TRIAL_ENDED_OPEN_POSITIONS';}
 else t.status='RUNNING';
 assertPaperForwardTrial(t);return t;
}
export function paperForwardTrialSummary(t){
 if(!t)return null;assertPaperForwardTrial(t);
 return {id:t.id,status:t.status,createdAt:t.createdAt,startAt:t.startAt,nextCloseAt:t.nextCloseAt,nextDueAt:new Date(Date.parse(t.nextCloseAt)+300000).toISOString(),endsAt:t.endsAt,completedBars:t.frames.length,maxBars:t.limits.maxBars,minimumClosedEpisodes:t.limits.minimumClosedEpisodes,reason:t.reason,asOf:t.updatedAt,arms:{baseline:paperForwardArmMetrics(t.arms.baseline),candidate:paperForwardArmMetrics(t.arms.candidate)},promotion:{eligible:t.status==='READY_TO_PROMOTE',requiresBothFlat:true,minReturnImprovement:.0001,maxDrawdownIncrease:0}};
}
