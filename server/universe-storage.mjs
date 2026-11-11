import {normalizeUpbitMarketCapture} from '../dist/domain/universe-policy.mjs';
import {universeRawBodyReference,assertUniverseRawBodyReference} from '../dist/domain/workspace-storage.mjs';
import {hashInputPackage} from '../dist/domain/workspace.mjs';
import {assertSectorSnapshot} from '../dist/domain/market-sectors.mjs';
import {researchSha256} from '../dist/domain/research.mjs';
export {projectUniverseSourceForStorage as encodeUniverseSource} from '../dist/domain/workspace-storage.mjs';

export const UNIVERSE_SOURCE_BLOB_KIND='universeSourceBlobs';
export const universeRawBlobId=ref=>'sha256-'+assertUniverseRawBodyReference(ref).sha256;
export function readUniverseRawBody(ref,payload){
  assertUniverseRawBodyReference(ref);let body;try{body=JSON.parse(payload);}catch{}
  if(typeof body?.rawText!=='string'||JSON.stringify(universeRawBodyReference(body.rawText))!==JSON.stringify(ref))throw Object.assign(new Error('종목 목록의 보관 원문과 참조가 다릅니다.'),{code:'UNIVERSE_RAW_CORRUPT',status:409});
  return body.rawText;
}
export function hydrateUniverseSectorBlob(entry,payloads){
  if(!Array.isArray(entry.bodyRefs)||!entry.bodyRefs.length||entry.bodyRefs.length>1000||payloads.length!==entry.bodyRefs.length)throw Object.assign(new Error('섹터 원문 참조를 확인하세요.'),{code:'UNIVERSE_RAW_CORRUPT',status:409});
  const raw=entry.bodyRefs.map((ref,index)=>readUniverseRawBody(ref,payloads[index])).join('');
  if(researchSha256(raw)!==entry.bodySha256)throw Object.assign(new Error('섹터 원문 전체 해시를 확인하세요.'),{code:'UNIVERSE_RAW_CORRUPT',status:409});
  let snapshot;try{snapshot=JSON.parse(raw);}catch{throw Object.assign(new Error('섹터 원문 JSON을 확인하세요.'),{code:'UNIVERSE_RAW_CORRUPT',status:409});}
  if(snapshot.id!==entry.snapshot.id||snapshot.contentHash!==entry.snapshot.contentHash)throw Object.assign(new Error('섹터 원문 식별 정보를 확인하세요.'),{code:'UNIVERSE_RAW_CORRUPT',status:409});
  assertSectorSnapshot(snapshot);return {...entry,snapshot};
}
export function hydrateUniverseRawBlob(entry,payload){
  const snapshot={...entry.snapshot,rawText:readUniverseRawBody(entry.rawBodyRef,payload)},{contentHash,...identity}=snapshot;
  if(hashInputPackage(identity)!==contentHash)throw Object.assign(new Error('종목 목록 원문 조각의 해시가 다릅니다.'),{code:'UNIVERSE_RAW_CORRUPT',status:409});
  return {...entry,snapshot};
}

export function decodeUniverseSource(entry){
  if(entry?.storageFormat!=='UPBIT_RAW_CAPTURE_V1')return entry;
  const expected=entry.snapshot.contentHash;
  const snapshot=normalizeUpbitMarketCapture({...entry.snapshot,expectedRawBodySha256:entry.snapshot.rawBodySha256});
  if(snapshot.contentHash!==expected)throw Object.assign(new Error('저장된 업비트 원본과 종목 목록 해시가 다릅니다.'),{code:'UPBIT_STORED_PROJECTION_MISMATCH',status:409});
  const {storageFormat,...rest}=entry;
  return {...rest,snapshot};
}
