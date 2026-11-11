/** Lossless storage shape shared by capacity validation and persistence.
 * UPBIT_RAW_CAPTURE_V1 rebuilds instruments from the retained raw body on read. */
export function projectUniverseSourceForStorage(entry){
  if(entry?.snapshot?.contractVersion==='MARKET_SECTOR_SNAPSHOT_V1'&&Array.isArray(entry.snapshot.captures)){
    const text=JSON.stringify(entry.snapshot),bodyRefs=splitUniverseSourceBody(text).map(universeRawBodyReference),s=entry.snapshot;
    return {...entry,storageFormat:'SECTOR_SNAPSHOT_BLOBS_V1',bodySha256:researchSha256(text),bodyRefs,snapshot:{id:s.id,version:s.version,contractVersion:s.contractVersion,contentHash:s.contentHash,asOf:s.asOf,availableAt:s.availableAt}};
  }
  if(entry?.snapshot?.kind==='TOSS_STOCK_CATALOG_RAW_CHUNK'){
    const {rawText,...snapshot}=entry.snapshot;
    const rawBodyRef=typeof rawText==='string'?universeRawBodyReference(rawText):assertUniverseRawBodyReference(entry.rawBodyRef);
    if(entry.rawBodyRef&&JSON.stringify(assertUniverseRawBodyReference(entry.rawBodyRef))!==JSON.stringify(rawBodyRef))throw new ReceiptStorageError('UNIVERSE_RAW_INTEGRITY','종목 목록 원문 참조를 확인하세요.');
    return {...entry,storageFormat:'UNIVERSE_RAW_BLOB_V1',rawBodyRef,snapshot};
  }
  if(entry?.snapshot?.kind!=='UPBIT_MARKET_SNAPSHOT')return entry;
  const {instruments,...capture}=entry.snapshot;
  return {...entry,storageFormat:'UPBIT_RAW_CAPTURE_V1',snapshot:capture};
}

export function projectWorkspaceForStorage(workspace){
  const projected={...workspace};
  if(Array.isArray(workspace?.universeSourceSnapshots))projected.universeSourceSnapshots=workspace.universeSourceSnapshots.map(projectUniverseSourceForStorage);
  if(Array.isArray(workspace?.commandReceipts))projected.commandReceipts=workspace.commandReceipts.map(receipt=>projectCommandReceiptForStorage(receipt));
  if(Array.isArray(workspace?.mindRuns))projected.mindRuns=workspace.mindRuns.map(projectMindRunForStorage);
  return projected;
}
import {researchSha256} from './research.mjs';
export const RECEIPT_RESULT_BLOB_FORMAT='IMMUTABLE_RESULT_BLOB_V1';
export const RECEIPT_RESULT_LEGACY_FORMAT='LEGACY_INLINE_RECEIPT_V1';
export const MIND_RUN_EVIDENCE_FORMAT='MIND_RUN_EVIDENCE_BLOB_V1';
export const MIND_RUN_EVIDENCE_FIELDS=Object.freeze(['rawRequest','rawResponse','preparedStrategyEvaluation','strategyEvaluation','graphEvaluation','marketBars','accountSnapshot']);
const has=(value,key)=>Object.hasOwn(value??{},key),bytes=value=>new TextEncoder().encode(value).length;
export class ReceiptStorageError extends Error{constructor(code,message){super(message);this.code=code;this.name='ReceiptStorageError';}}
const requireValue=(ok,message)=>{if(!ok)throw new ReceiptStorageError('RECEIPT_RESULT_INTEGRITY',message);};
export function universeRawBodyReference(rawText){return {schemaVersion:1,storage:'UNIVERSE_RAW_BLOB_V1',sha256:researchSha256(rawText),byteCount:bytes(rawText)};}
export function splitUniverseSourceBody(text){const parts=[];for(let i=0;i<text.length;i+=60000)parts.push(text.slice(i,i+60000));return parts;}
export function assertUniverseRawBodyReference(ref){if(!ref||ref.schemaVersion!==1||ref.storage!=='UNIVERSE_RAW_BLOB_V1'||Object.keys(ref).length!==4||!/^[a-f0-9]{64}$/.test(ref.sha256)||!Number.isSafeInteger(ref.byteCount)||ref.byteCount<1||ref.byteCount>500000)throw new ReceiptStorageError('UNIVERSE_RAW_INTEGRITY','종목 목록 원문 참조를 확인하세요.');return ref;}
export function receiptResultBytes(result){
  const text=JSON.stringify(result);requireValue(typeof text==='string','명령 결과의 JSON 원문을 확인하세요.');return text;
}
export function receiptResultReference(result,{receiptId=null}={}){
  const text=receiptResultBytes(result);return {schemaVersion:1,storage:receiptId?RECEIPT_RESULT_LEGACY_FORMAT:RECEIPT_RESULT_BLOB_FORMAT,...(receiptId?{receiptId}:{}),sha256:researchSha256(text),byteCount:bytes(text)};
}
export function assertReceiptResultReference(ref,receiptId){
  const expected=ref?.storage===RECEIPT_RESULT_LEGACY_FORMAT?['schemaVersion','storage','receiptId','sha256','byteCount']:['schemaVersion','storage','sha256','byteCount'];
  requireValue(ref&&typeof ref==='object'&&!Array.isArray(ref)&&Object.keys(ref).length===expected.length&&expected.every(key=>has(ref,key))&&ref.schemaVersion===1&&[RECEIPT_RESULT_BLOB_FORMAT,RECEIPT_RESULT_LEGACY_FORMAT].includes(ref.storage)&&/^[a-f0-9]{64}$/.test(ref.sha256)&&Number.isSafeInteger(ref.byteCount)&&ref.byteCount>=1&&ref.byteCount<=500000&&(ref.storage!==RECEIPT_RESULT_LEGACY_FORMAT||ref.receiptId===receiptId),'명령 결과의 원문 참조를 확인하세요.');return ref;
}
export function projectCommandReceiptForStorage(receipt,{legacyInline=false}={}){
  if(!has(receipt,'result')&&!has(receipt,'resultRef'))return receipt;
  const reference=has(receipt,'resultRef')?assertReceiptResultReference(receipt.resultRef,receipt.id):receiptResultReference(receipt.result,{receiptId:legacyInline?receipt.id:null});
  if(has(receipt,'result')){const actual=receiptResultReference(receipt.result);requireValue(actual.sha256===reference.sha256&&actual.byteCount===reference.byteCount,'명령 결과와 보관 원문의 해시를 대조하세요.');}
  const {result,...metadata}=receipt;return {...metadata,resultRef:reference};
}

/** Immutable execution inputs and provider evidence retain their JSON field order.
 * The mutable execution/observation envelope stays in the canonical run row. */
export function mindRunEvidenceText(run){
  const fields=Object.fromEntries(MIND_RUN_EVIDENCE_FIELDS.filter(key=>has(run,key)).map(key=>[key,run[key]]));
  if(!Object.keys(fields).length)return null;
  return JSON.stringify({contractVersion:MIND_RUN_EVIDENCE_FORMAT,runId:run.id,profileId:run.profileId??null,manifestHash:run.manifestHash??null,fields});
}
export function mindRunEvidenceReference(text){
  requireValue(typeof text==='string'&&bytes(text)>0&&bytes(text)<=500000,'실행 원문의 저장 크기를 확인하세요.');
  return {schemaVersion:1,storage:MIND_RUN_EVIDENCE_FORMAT,sha256:researchSha256(text),byteCount:bytes(text)};
}
export function assertMindRunEvidenceReference(ref){
  if(!ref||typeof ref!=='object'||Object.keys(ref).sort().join(',')!=='byteCount,schemaVersion,sha256,storage'||ref.schemaVersion!==1||ref.storage!==MIND_RUN_EVIDENCE_FORMAT||!/^[a-f0-9]{64}$/.test(ref.sha256)||!Number.isSafeInteger(ref.byteCount)||ref.byteCount<1||ref.byteCount>500000)throw new ReceiptStorageError('MIND_RUN_EVIDENCE_INTEGRITY','실행 원문의 참조와 크기를 확인하세요.');
  return ref;
}
export function projectMindRunForStorage(run){
  const text=mindRunEvidenceText(run);
  if(text===null)return has(run,'evidenceBodyRef')?{...run,evidenceBodyRef:assertMindRunEvidenceReference(run.evidenceBodyRef)}:run;
  const ref=mindRunEvidenceReference(text);
  if(has(run,'evidenceBodyRef')){const original=assertMindRunEvidenceReference(run.evidenceBodyRef);if(original.sha256!==ref.sha256||original.byteCount!==ref.byteCount)throw new ReceiptStorageError('MIND_RUN_EVIDENCE_INTEGRITY','실행 원문과 참조를 대조하세요.');}
  return {...Object.fromEntries(Object.entries(run).filter(([key])=>!MIND_RUN_EVIDENCE_FIELDS.includes(key))),evidenceBodyRef:ref};
}
