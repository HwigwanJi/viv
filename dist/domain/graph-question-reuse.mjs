import {hashInputPackage} from './workspace.mjs';
const HASH=/^[a-f0-9]{64}$/,plain=v=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.getPrototypeOf(v)===Object.prototype;
const iso=v=>typeof v==='string'&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString()===v;
const exact=(v,keys)=>plain(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const check=(ok,code,message)=>{if(!ok)throw Object.assign(new TypeError(message),{code,status:409});};

/** A held decision keeps its original request binding and is never relabelled as a fresh answer. */
export function inspectGraphQuestionReuse(answer,{question,currentInputHash,graphHash,asOf,availableAt=asOf,reuseWindowMs=0}={}){
 const keys=['kind','answer','questionHash','inputHash','rawRequestHash','rawResponseHash'];
 check(plain(answer)&&Object.keys(answer).every(k=>keys.includes(k)||k==='reuse')&&keys.every(k=>Object.hasOwn(answer,k))&&answer.kind==='JEV_QUESTION'&&answer.questionHash===hashInputPackage(question)&&[answer.inputHash,answer.rawRequestHash,answer.rawResponseHash].every(v=>HASH.test(v??'')),'GRAPH_QUESTION_RESPONSE','질문의 원문·연결 자료·원응답을 대조하세요.');
 if(!Object.hasOwn(answer,'reuse')){check(answer.inputHash===currentInputHash,'GRAPH_QUESTION_RESPONSE','이 판단에 연결한 자료의 원문 해시를 대조하세요.');return null;}
 const r=answer.reuse;
 check(Number.isSafeInteger(reuseWindowMs)&&reuseWindowMs>0&&reuseWindowMs<=3600000&&exact(r,['evaluatedAt','availableAt','validUntil','graphHash','inputHash'])&&[r.evaluatedAt,r.availableAt,r.validUntil,asOf,availableAt].every(iso)&&r.graphHash===graphHash&&r.inputHash===answer.inputHash&&r.evaluatedAt<=r.availableAt&&r.availableAt<=availableAt&&r.evaluatedAt<=asOf&&Date.parse(r.validUntil)<=Date.parse(r.evaluatedAt)+reuseWindowMs&&r.validUntil>r.availableAt,'GRAPH_QUESTION_REUSE_BINDING','저장된 JEV 판단의 원자료·유효기간과 현재 전략을 대조하세요.');
 check(asOf<r.validUntil,'GRAPH_CACHED_QUESTION_EXPIRED','JEV 판단의 유효기간이 끝났습니다. 새 판단을 요청하세요.');
 return {...structuredClone(r),appliedAt:asOf,originalInputHash:answer.inputHash,currentInputHash,reused:answer.inputHash!==currentInputHash};
}
