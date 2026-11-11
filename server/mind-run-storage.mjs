import {assertMindRunEvidenceReference,mindRunEvidenceReference,MIND_RUN_EVIDENCE_FORMAT,MIND_RUN_EVIDENCE_FIELDS} from '../dist/domain/workspace-storage.mjs';

export const MIND_RUN_EVIDENCE_KIND='mindRunEvidenceBlobs';
export const mindRunEvidenceId=ref=>'sha256-'+assertMindRunEvidenceReference(ref).sha256;
const fail=(code,message)=>{throw Object.assign(new Error(message),{code,status:409});};
export function hydrateMindRunEvidence(run,text){
  const ref=assertMindRunEvidenceReference(run.evidenceBodyRef);
  if(typeof text!=='string')fail('MIND_RUN_EVIDENCE_MISSING','저장한 실행 원문을 찾을 수 없습니다.');
  const actual=mindRunEvidenceReference(text);
  if(actual.sha256!==ref.sha256||actual.byteCount!==ref.byteCount)fail('MIND_RUN_EVIDENCE_CORRUPT','실행 원문의 해시와 크기를 대조하세요.');
  let payload;try{payload=JSON.parse(text);}catch{fail('MIND_RUN_EVIDENCE_CORRUPT','실행 원문의 JSON을 확인하세요.');}
  if(payload?.contractVersion!==MIND_RUN_EVIDENCE_FORMAT||payload.runId!==run.id||payload.profileId!==(run.profileId??null)||payload.manifestHash!==(run.manifestHash??null)||!payload.fields||typeof payload.fields!=='object'||Array.isArray(payload.fields)||!Object.keys(payload.fields).length||Object.keys(payload.fields).some(key=>!MIND_RUN_EVIDENCE_FIELDS.includes(key))||MIND_RUN_EVIDENCE_FIELDS.some(key=>Object.hasOwn(run,key)))fail('MIND_RUN_EVIDENCE_BINDING','실행 원문의 결정·마인드·정책 연결을 확인하세요.');
  const {evidenceBodyRef,...metadata}=run;return {...metadata,...payload.fields};
}
