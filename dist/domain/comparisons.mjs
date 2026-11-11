export const COMPARISON_SCHEMA_VERSION = 1;
export const COMPARISON_INTERVAL_MS = 14400000;
export const COMPARISON_SETTLE_DELAY_MS = 300000;
export const COMPARISON_MEMBER_STAGES = Object.freeze(['EVALUATING','EVALUATED','EXECUTING','COMPLETED','FAILED','SKIPPED']);
const plain = v => !!v && typeof v === 'object' && !Array.isArray(v) && [Object.prototype,null].includes(Object.getPrototypeOf(v));
const id = v => typeof v === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,199}$/.test(v);
const iso = v => typeof v === 'string' && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;
const bar = v => iso(v) && Date.parse(v) % COMPARISON_INTERVAL_MS === 0;
const hash = v => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const safe = (v,depth=0) => depth < 20 && (v === null || typeof v === 'boolean' || typeof v === 'string' && v.length <= 200000 || typeof v === 'number' && Number.isFinite(v) || Array.isArray(v) && v.length <= 20000 && v.every(x => safe(x,depth+1)) || plain(v) && Object.keys(v).length <= 50 && Object.entries(Object.getOwnPropertyDescriptors(v)).every(([k,d]) => !['__proto__','constructor','prototype'].includes(k) && Object.hasOwn(d,'value') && safe(d.value,depth+1)));
const keys = (v, allowed) => plain(v) && Object.keys(v).every(k => allowed.includes(k));
const groupKeys = ['schemaVersion','id','name','experimentId','experimentType','status','createdAt','updatedAt','createdBy','startAt','cursorAt','conditions','members','round','completedBars','lastCompletedAt','pauseRequestedAt','history'];
const memberKeys = ['profileId','profileVersionId','memoryVersionId','deploymentId','accountId'];
const checkpointKeys = ['deploymentId','stage','generation','evaluateKey','executeKey','decisionId','outcome','error','executionIds','attemptedAt'];
const check = (value, code) => { if (!value) throw new Error(code); };
const canonical=v=>Array.isArray(v)?'['+v.map(canonical).join(',')+']':plain(v)?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}':JSON.stringify(v);
export const hashComparisonSourceContext=value=>researchSha256(canonical(Object.fromEntries(Object.entries(value).filter(([key])=>key!=='hash'))));
export function validateComparisonSourceContext(value){
  try{
    const compact=value?.schemaVersion===2;
    check(safe(value)&&keys(value,compact?['schemaVersion','knowledgeAsOf','knowledge','research','members','hash']:['schemaVersion','knowledgeAsOf','knowledge','research','hash'])&&Object.keys(value).length===(compact?6:5)&&[1,2].includes(value.schemaVersion)&&iso(value.knowledgeAsOf)&&hash(value.hash)&&hashComparisonSourceContext(value)===value.hash&&new TextEncoder().encode(JSON.stringify(value)).length<=200000,'COMPARISON_SOURCE_CONTEXT');
    check(value.knowledge===null||!validateKnowledge(value.knowledge).length,'COMPARISON_SOURCE_CONTEXT');
    if(compact){
      check(value.research===null&&(value.knowledge===null||value.knowledge.items.every(n=>n.status==='approved'&&n.revisions.length===0)),'COMPARISON_SOURCE_CONTEXT');
      check(Array.isArray(value.members)&&value.members.length>=1&&value.members.length<=3&&new Set(value.members.map(m=>m.deploymentId)).size===value.members.length,'COMPARISON_SOURCE_CONTEXT');
      for(const member of value.members){
        check(keys(member,['deploymentId','investmentProfileId','approvedResearchRules','researchSnapshot'])&&Object.keys(member).length===4&&id(member.deploymentId)&&id(member.investmentProfileId)&&Array.isArray(member.approvedResearchRules)&&member.approvedResearchRules.every(r=>keys(r,['id','version','title','text'])&&Object.keys(r).length===4&&id(r.id)&&Number.isSafeInteger(r.version)&&r.version>0&&typeof r.title==='string'&&r.title.length>0&&r.title.length<=120&&typeof r.text==='string'&&r.text.length>0&&r.text.length<=6000),'COMPARISON_SOURCE_CONTEXT');
        const p=member.researchSnapshot;
        if(p===null){check(member.approvedResearchRules.length===0,'COMPARISON_SOURCE_CONTEXT');continue;}
        check(keys(p,['asOf','referenceMode','sources','contexts','rules'])&&Object.keys(p).length===5&&p.asOf===value.knowledgeAsOf&&p.referenceMode==='IMMUTABLE_REFERENCES_V1'&&['sources','contexts','rules'].every(k=>Array.isArray(p[k])),'COMPARISON_SOURCE_CONTEXT');
        check(p.sources.every(s=>keys(s,['id','version','sha256','recordHash','availableAt','scope'])&&Object.keys(s).length===6&&id(s.id)&&Number.isSafeInteger(s.version)&&s.version>0&&hash(s.sha256)&&hash(s.recordHash)&&iso(s.availableAt)&&Date.parse(s.availableAt)<=Date.parse(value.knowledgeAsOf)&&typeof s.scope==='string'),'COMPARISON_SOURCE_CONTEXT');
        check(p.contexts.every(c=>keys(c,['id','version','recordHash','scope','availableAt','blockRefs','sourceReviewIds'])&&Object.keys(c).length===7&&id(c.id)&&Number.isSafeInteger(c.version)&&c.version>0&&hash(c.recordHash)&&iso(c.availableAt)&&Date.parse(c.availableAt)<=Date.parse(value.knowledgeAsOf)&&typeof c.scope==='string'&&Array.isArray(c.sourceReviewIds)&&c.sourceReviewIds.every(id)&&Array.isArray(c.blockRefs)&&c.blockRefs.every(b=>keys(b,['id','version','blockHash','sourceId','sourceVersion','sourceHash','representationId','outputHash','locator'])&&Object.keys(b).length===9&&id(b.id)&&Number.isSafeInteger(b.version)&&b.version>0&&hash(b.blockHash)&&id(b.sourceId)&&Number.isSafeInteger(b.sourceVersion)&&b.sourceVersion>0&&hash(b.sourceHash)&&id(b.representationId)&&hash(b.outputHash)&&plain(b.locator)&&p.sources.some(s=>s.id===b.sourceId&&s.version===b.sourceVersion&&s.sha256===b.sourceHash))),'COMPARISON_SOURCE_CONTEXT');
        check(p.rules.length===member.approvedResearchRules.length&&p.rules.every(r=>keys(r,['id','version','recordHash','contextId','contextVersion','contextHash','scope','approvedAt','availableAt'])&&Object.keys(r).length===9&&id(r.id)&&Number.isSafeInteger(r.version)&&r.version>0&&hash(r.recordHash)&&id(r.contextId)&&Number.isSafeInteger(r.contextVersion)&&r.contextVersion>0&&hash(r.contextHash)&&typeof r.scope==='string'&&iso(r.approvedAt)&&iso(r.availableAt)&&Date.parse(r.approvedAt)<=Date.parse(value.knowledgeAsOf)&&Date.parse(r.availableAt)<=Date.parse(value.knowledgeAsOf)&&member.approvedResearchRules.some(a=>a.id===r.id&&a.version===r.version)&&p.contexts.some(c=>c.id===r.contextId&&c.version===r.contextVersion&&c.recordHash===r.contextHash)),'COMPARISON_SOURCE_CONTEXT');
      }
    }else check(value.research===null||!validateResearch(value.research).length,'COMPARISON_SOURCE_CONTEXT');
    return [];
  }catch{return [{code:'COMPARISON_SOURCE_CONTEXT',message:'비교 봉의 승인 자료 사본과 검증값을 확인하세요.',path:'comparisons.round.sourceContext'}];}
}

export function validateComparison(group, workspace) {
  try {
    check(safe(group) && keys(group,[...groupKeys,'memoryChanges']) && groupKeys.every(k => Object.hasOwn(group,k)), 'COMPARISON_FORMAT');
    check(group.schemaVersion === 1 && id(group.id) && id(group.experimentId) && id(group.createdBy) && typeof group.name === 'string' && group.name.trim().length > 0 && group.name.length <= 120, 'COMPARISON_ID');
    check(['FORWARD_PAPER','HISTORICAL_FUNCTIONAL_REPLAY'].includes(group.experimentType) && ['paused','running'].includes(group.status) && iso(group.createdAt) && iso(group.updatedAt) && Date.parse(group.updatedAt) >= Date.parse(group.createdAt) && bar(group.startAt) && bar(group.cursorAt) && Date.parse(group.cursorAt) >= Date.parse(group.startAt), 'COMPARISON_TIME');
    check(Number.isSafeInteger(group.completedBars) && group.completedBars >= 0 && (group.lastCompletedAt === null || bar(group.lastCompletedAt)) && (group.pauseRequestedAt === null || iso(group.pauseRequestedAt)) && !(group.status === 'running' && group.pauseRequestedAt), 'COMPARISON_STATUS');
    const c = group.conditions;
    check(keys(c,['strategyVersionId','riskPresetVersionId','initialCash','feeBps','slippageBps','feeScheduleSnapshotId','settleDelayMs','sourceHash']) && id(c.strategyVersionId) && id(c.riskPresetVersionId) && id(c.feeScheduleSnapshotId) && Number.isFinite(c.initialCash) && c.initialCash > 0 && c.initialCash <= 1e12 && ['feeBps','slippageBps'].every(k => Number.isFinite(c[k]) && c[k] >= 0 && c[k] <= 1000) && c.settleDelayMs === COMPARISON_SETTLE_DELAY_MS && (c.sourceHash === null || hash(c.sourceHash)), 'COMPARISON_CONDITIONS');
    check(Array.isArray(group.members) && group.members.length >= 1 && group.members.length <= 3 && group.members.every(m => keys(m,memberKeys) && memberKeys.every(k => id(m[k]))), 'COMPARISON_MEMBERS');
    for (const key of ['profileId','deploymentId','accountId']) check(new Set(group.members.map(m => m[key])).size === group.members.length, 'COMPARISON_ISOLATION');
    if (workspace) for (const m of group.members) {
      check(workspace.investmentProfiles.some(p => p.id === m.profileId) && workspace.profileVersions.some(p => p.id === m.profileVersionId && p.entityId === m.profileId) && workspace.memoryVersions.some(p => p.id === m.memoryVersionId && p.investmentProfileId === m.profileId) && workspace.deployments.some(d => d.id === m.deploymentId && d.accountId === m.accountId) && workspace.accounts.some(a => a.id === m.accountId), 'COMPARISON_REFERENCE');
      check(workspace.strategyVersions.some(v => v.id === c.strategyVersionId) && workspace.riskPresetVersions.some(v => v.id === c.riskPresetVersionId), 'COMPARISON_REFERENCE');
    }
    const r = group.round;
    if (r !== null) {
      check(keys(r,['id','asOf','sourceHash','sourceSnapshotId','sourceContext','startedAt','lease','members']) && id(r.id) && r.asOf === group.cursorAt && hash(r.sourceHash) && (r.sourceSnapshotId === null || id(r.sourceSnapshotId)) && iso(r.startedAt), 'COMPARISON_ROUND');
      if(r.sourceContext!==undefined)check(!validateComparisonSourceContext(r.sourceContext).length&&Date.parse(r.sourceContext.knowledgeAsOf)<=Date.parse(r.startedAt)&&(group.experimentType!=='FORWARD_PAPER'||r.sourceContext.knowledgeAsOf===r.asOf)&&(r.sourceContext.schemaVersion!==2||r.sourceContext.members.length===group.members.length&&r.sourceContext.members.every((m,i)=>m.deploymentId===group.members[i].deploymentId&&m.investmentProfileId===group.members[i].profileId)),'COMPARISON_SOURCE_CONTEXT');
      check(r.lease === null || keys(r.lease,['token','until','workerId']) && id(r.lease.token) && id(r.lease.workerId) && Number.isSafeInteger(r.lease.until) && r.lease.until >= Date.parse(r.startedAt), 'COMPARISON_LEASE');
      check(Array.isArray(r.members) && r.members.length === group.members.length && r.members.every((m,i) => keys(m,checkpointKeys) && m.deploymentId === group.members[i].deploymentId && COMPARISON_MEMBER_STAGES.includes(m.stage) && Number.isSafeInteger(m.generation) && m.generation >= 1 && m.generation <= 100 && id(m.evaluateKey) && id(m.executeKey) && (m.decisionId === null || id(m.decisionId)) && (m.outcome === null || typeof m.outcome === 'string' && m.outcome.length <= 100) && (m.error === null || keys(m.error,['code','message']) && id(m.error.code) && typeof m.error.message === 'string' && m.error.message.length <= 500) && Array.isArray(m.executionIds) && m.executionIds.every(id) && (m.attemptedAt === null || iso(m.attemptedAt))), 'COMPARISON_CHECKPOINT');
    }
    check(Array.isArray(group.history) && group.history.length <= 32 && group.history.every(h => keys(h,['id','asOf','status','sourceHash','sourceSnapshotId','sourceContextHash','completedAt','members','observations']) && id(h.id) && bar(h.asOf) && hash(h.sourceHash) && (h.sourceSnapshotId === null || id(h.sourceSnapshotId)) && (h.sourceContextHash===undefined||hash(h.sourceContextHash)) && iso(h.completedAt) && ['COMPLETED','PARTIAL','SKIPPED'].includes(h.status) && Array.isArray(h.members) && h.members.length <= 3 && h.members.every(m => keys(m,['deploymentId','stage','decisionId','outcome','executionIds']) && group.members.some(p=>p.deploymentId===m.deploymentId) && ['COMPLETED','SKIPPED'].includes(m.stage) && (m.decisionId===null||id(m.decisionId)) && typeof m.outcome==='string' && Array.isArray(m.executionIds) && m.executionIds.every(id)) && Array.isArray(h.observations) && h.observations.length <= 3 && h.observations.every(o => keys(o,['deploymentId','cash','btcQuantity','equity','feesPaid','markPrice','asOf']) && group.members.some(m=>m.deploymentId===o.deploymentId) && ['cash','btcQuantity','equity','feesPaid','markPrice'].every(k=>Number.isFinite(o[k])&&o[k]>=0) && iso(o.asOf))), 'COMPARISON_HISTORY');
    if(group.memoryChanges!==undefined)check(Array.isArray(group.memoryChanges)&&group.memoryChanges.length<=200&&group.memoryChanges.every(m=>keys(m,['at','asOf','profileId','deploymentId','previousMemoryVersionId','memoryVersionId','reason'])&&iso(m.at)&&bar(m.asOf)&&Date.parse(m.asOf)>=Date.parse(group.startAt)&&Date.parse(m.asOf)<=Date.parse(group.cursorAt)&&group.members.some(p=>p.profileId===m.profileId&&p.deploymentId===m.deploymentId)&&id(m.previousMemoryVersionId)&&id(m.memoryVersionId)&&typeof m.reason==='string'&&m.reason.trim().length>0&&m.reason.length<=1000&&(!workspace||[m.previousMemoryVersionId,m.memoryVersionId].every(key=>workspace.memoryVersions.some(v=>v.id===key&&v.investmentProfileId===m.profileId)))),'COMPARISON_MEMORY_CHANGES');
    return [];
  } catch (error) { return [{ code: error.message, message: '비교 실험의 조건·구성원·실행 기록을 확인하세요.', path: 'comparisons' }]; }
}
export function validateComparisons(groups, workspace) {
  if (!Array.isArray(groups) || new Set(groups.map(g => g?.id)).size !== groups.length) return [{ code:'INVALID_COMPARISONS', message:'비교 실험 목록을 확인하세요.', path:'comparisons' }];
  return groups.flatMap(g => validateComparison(g,workspace));
}
import {validateKnowledge} from '../knowledge.mjs';
import {validateResearch,researchSha256} from './research.mjs';

