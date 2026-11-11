import {assertModelLibraryTransition} from '../dist/domain/strategy-model.mjs';
import {assertRegimeProgram} from '../dist/domain/regime-program.mjs';
import {checkpointMindAttempts,verifyMindAttemptHistory,MIND_SUBSCRIPTION_HISTORY_KIND} from '../dist/domain/mind-subscription-history.mjs';
import {encodeUniverseSource,decodeUniverseSource,UNIVERSE_SOURCE_BLOB_KIND,universeRawBlobId,hydrateUniverseRawBlob,hydrateUniverseSectorBlob} from './universe-storage.mjs';
import { RESEARCH_COLLECTIONS } from '../dist/domain/research.mjs';
import {validateMindSubscription} from '../dist/domain/mind-subscriptions.mjs';
import {stableStringify,hashInputPackage} from '../dist/domain/workspace.mjs';
import {assertQuantStrategyCollectionTransition} from './quant-strategy-library.mjs';
import {projectCommandReceiptForStorage,receiptResultBytes,receiptResultReference,assertReceiptResultReference,RECEIPT_RESULT_BLOB_FORMAT,RECEIPT_RESULT_LEGACY_FORMAT,splitUniverseSourceBody} from '../dist/domain/workspace-storage.mjs';
import {workspaceProjectionCache} from './workspace-projection-cache.mjs';
import {investmentLifecycleGuard} from './investment-lifecycle-guard.mjs';
import {projectMindRunForStorage,mindRunEvidenceText} from '../dist/domain/workspace-storage.mjs';
import {MIND_RUN_EVIDENCE_KIND,mindRunEvidenceId,hydrateMindRunEvidence} from './mind-run-storage.mjs';
export const RECEIPT_RESULT_ARCHIVE_KIND='receiptResultBlobs';
export const MIND_COLLECTIONS = ['mindDocuments','mindManifests','mindRuns','mindPositions','mindSubscriptions','mindSelections','marketKnowledge','universeSourceSnapshots','newsComparisons','newsComparisonResults','quantStrategies','strategyModels','mindPresets','regimePrograms','homeMarketRecords','learningSessions','simulationDrafts'];
export const WORKSPACE_COLLECTIONS = ['investmentProfiles','profileVersions','strategies','strategyVersions','riskPresets','riskPresetVersions','deployments','accounts','decisionRecords','activityEvents','experiences','memoryCandidates','memoryVersions','commandReceipts','marketSnapshots','sharedAccounts','comparisons',...MIND_COLLECTIONS];
export class RepositoryError extends Error { constructor(code,message,status=409){super(message);this.code=code;this.status=status;} }
const schedulerCollections=['jobs','attempts','events','receipts'];
const metadata = w => {const value=Object.fromEntries(Object.entries(w).filter(([k])=>!WORKSPACE_COLLECTIONS.includes(k)));if(w.research)value.research=Object.fromEntries(Object.entries(w.research).filter(([k])=>!RESEARCH_COLLECTIONS.includes(k)));if(w.scheduler)value.scheduler=Object.fromEntries(Object.entries(w.scheduler).filter(([k])=>!schedulerCollections.includes(k)));return value;};
const objects = w => [...WORKSPACE_COLLECTIONS,...RESEARCH_COLLECTIONS.map(k=>'research.'+k),...schedulerCollections.map(k=>'scheduler.'+k)].flatMap(kind=>(kind.startsWith('research.')?w.research?.[kind.slice(9)]||[]:kind.startsWith('scheduler.')?w.scheduler?.[kind.slice(10)]||[]:w[kind]||[]).map((value,ordinal)=>{
  if(!value||typeof value.id!=='string'||!value.id||value.id.length>200)throw new RepositoryError('INVALID_OBJECT','저장할 객체의 식별자를 확인하세요.',400);
  if(kind==='commandReceipts'&&Object.hasOwn(value,'result')){const {resultRef,...logical}=value;if(new TextEncoder().encode(JSON.stringify(logical)).length>500000)throw new RepositoryError('OBJECT_TOO_LARGE','기록 하나의 자료 범위를 줄여 주세요.',413);}
  if(kind==='mindRuns'&&new TextEncoder().encode(JSON.stringify(value)).length>500000)throw new RepositoryError('OBJECT_TOO_LARGE','기록 하나의 자료 범위를 줄여 주세요.',413);
  const payload=JSON.stringify(kind==='universeSourceSnapshots'?encodeUniverseSource(value):kind==='commandReceipts'?projectCommandReceiptForStorage(value):kind==='mindRuns'?projectMindRunForStorage(value):value);if(new TextEncoder().encode(payload).length>500000)throw new RepositoryError('OBJECT_TOO_LARGE','기록 하나의 자료 범위를 줄여 주세요.',413);
  return {kind,id:kind.startsWith('research.')?value.id+':v'+(value.version??0):value.id,ordinal,payload,value};
}));
const resultId=ref=>'sha256-'+ref.sha256;
function receiptIdentity(receipt){const stored=projectCommandReceiptForStorage(receipt),{resultRef,...metadata}=stored;return stableStringify({...metadata,...(resultRef?{resultDigest:{sha256:resultRef.sha256,byteCount:resultRef.byteCount}}:{})});}
function validateResultText(text,ref){let result;try{result=JSON.parse(text);}catch{throw new RepositoryError('RECEIPT_RESULT_CORRUPT','보관된 명령 결과의 JSON 원문을 확인하세요.',409);}const actual=receiptResultReference(result);if(receiptResultBytes(result)!==text||actual.sha256!==ref.sha256||actual.byteCount!==ref.byteCount)throw new RepositoryError('RECEIPT_RESULT_CORRUPT','보관된 명령 결과의 원문과 해시를 확인하세요.',409);return result;}
export async function readOperationalWorkspace(repository,owner,create,receiptKeys=[]){return typeof repository.readOperational==='function'?repository.readOperational(owner,create,{receiptKeys}):repository.read(owner,create);}
// Hydrating concurrent full histories can exhaust the host heap; preserve every record and serialize only snapshot reads.
const workspaceReads=new WeakMap();
function queueWorkspaceRead(db,read){
 const result=(workspaceReads.get(db)??Promise.resolve()).then(read),settled=result.then(()=>{},()=>{});
 workspaceReads.set(db,settled);settled.then(()=>{if(workspaceReads.get(db)===settled)workspaceReads.delete(db);});return result;
}
export class WorkspaceRepository {
  constructor(db,{projectionCache=workspaceProjectionCache}={}){if(!db?.prepare||!db?.batch)throw new RepositoryError('STORAGE_REQUIRED','서버 저장소 연결을 확인하세요.',503);this.db=db;this.projectionCache=projectionCache;}
  async read(owner,create,retries=0){return queueWorkspaceRead(this.db,()=>this._read(owner,create,retries,{full:true,receiptKeys:[]}));}
  async readOperational(owner,create,{receiptKeys=[]}={}){return queueWorkspaceRead(this.db,()=>this._read(owner,create,0,{full:false,receiptKeys}));}
  async _read(owner,create,retries,mode){
    let head=await this.db.prepare('SELECT revision,metadata FROM workspace_heads WHERE owner_id=?').bind(owner).first();
    if(!head){
      if(!create)return null;
      const seed=await create(), token=crypto.randomUUID(), at=new Date().toISOString();
      const statements=[this.db.prepare('INSERT INTO workspace_heads(owner_id,revision,metadata,last_command_id,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(owner_id) DO NOTHING').bind(owner,seed.revision,JSON.stringify(metadata(seed)),token,at)];
      for(const o of objects(seed)){if(o.kind==='universeSourceSnapshots'){for(const blob of await this._newUniverseBodies(owner,o.value))statements.push(this._universeArchiveStatement(owner,blob,token));}if(o.kind==='commandReceipts'){const body=await this._newReceiptBody(owner,o.value);if(body)statements.push(this._archiveStatement(owner,body,token));}if(o.kind==='mindRuns'){const body=await this._newMindRunEvidence(owner,o.value);if(body)statements.push(this._mindRunArchiveStatement(owner,body,token));}statements.push(this.db.prepare('INSERT INTO workspace_objects(owner_id,kind,object_id,ordinal,payload) SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM workspace_heads WHERE owner_id=? AND last_command_id=?) ON CONFLICT(owner_id,kind,object_id) DO NOTHING').bind(owner,o.kind,o.id,o.ordinal,o.payload,owner,token));}
      await this.db.batch(statements);
      head=await this.db.prepare('SELECT revision,metadata FROM workspace_heads WHERE owner_id=?').bind(owner).first();
    }
    // Keep full captures in storage; a routine workspace read only hydrates the
    // two newest captures. Array ordinals restart in this bounded projection.
    const rows=await this.db.prepare("SELECT object_id,kind,payload FROM workspace_objects WHERE owner_id=? AND kind NOT IN ('receiptResultBlobs','universeSourceBlobs','mindSubscriptionAttemptHistory','mindRunEvidenceBlobs') AND (kind<>'marketSnapshots' OR object_id IN (SELECT object_id FROM workspace_objects WHERE owner_id=? AND kind='marketSnapshots' ORDER BY json_extract(payload,'$.receivedAt') DESC,object_id DESC LIMIT 2)) ORDER BY kind,CASE WHEN kind='marketSnapshots' THEN json_extract(payload,'$.receivedAt') END,ordinal,object_id").bind(owner,owner).all();
    const confirmed=await this.db.prepare('SELECT revision FROM workspace_heads WHERE owner_id=?').bind(owner).first();
    if(confirmed?.revision!==head.revision){if(retries>=3)throw new RepositoryError('READ_CONFLICT','다른 실행이 기록을 갱신하고 있습니다. 잠시 뒤 다시 조회하세요.');return this._read(owner,create,retries+1,mode);}
    const workspace={...JSON.parse(head.metadata),revision:head.revision};
    for(const key of WORKSPACE_COLLECTIONS)workspace[key]=[];
    if(workspace.research)for(const key of RESEARCH_COLLECTIONS)workspace.research[key]=[];
    if(workspace.scheduler)for(const key of schedulerCollections)workspace.scheduler[key]=[];
    const archived=mode.full?new Map((await this.db.prepare("SELECT object_id,payload FROM workspace_objects WHERE owner_id=? AND kind='receiptResultBlobs'").bind(owner).all()).results.map(row=>[row.object_id,row.payload])):null;
    for(const row of rows.results){if(WORKSPACE_COLLECTIONS.includes(row.kind)){let value=row.kind==='universeSourceSnapshots'||row.kind==='commandReceipts'&&!mode.full?this.projectionCache.read(owner,row):JSON.parse(row.payload);if(row.kind==='commandReceipts'&&mode.full)value=await this._hydrateReceipt(owner,value,false,archived);workspace[row.kind].push(value);}else if(row.kind.startsWith('research.')&&RESEARCH_COLLECTIONS.includes(row.kind.slice(9))){workspace.research??={};workspace.research[row.kind.slice(9)]??=[];workspace.research[row.kind.slice(9)].push(JSON.parse(row.payload));}else if(row.kind.startsWith('scheduler.')&&schedulerCollections.includes(row.kind.slice(10))){workspace.scheduler??={};workspace.scheduler[row.kind.slice(10)]??=[];workspace.scheduler[row.kind.slice(10)].push(JSON.parse(row.payload));}}
    const sourceBlobs=new Map((await this.db.prepare("SELECT object_id,payload FROM workspace_objects WHERE owner_id=? AND kind='universeSourceBlobs'").bind(owner).all()).results.map(row=>[row.object_id,row.payload]));
    const runBlobs=new Map((await this.db.prepare("SELECT object_id,payload FROM workspace_objects WHERE owner_id=? AND kind='mindRunEvidenceBlobs'").bind(owner).all()).results.map(row=>[row.object_id,row.payload]));
    workspace.mindRuns=workspace.mindRuns.map(run=>run.evidenceBodyRef?hydrateMindRunEvidence(run,runBlobs.get(mindRunEvidenceId(run.evidenceBodyRef))):run);
    workspace.universeSourceSnapshots=workspace.universeSourceSnapshots.map(entry=>{const lookup=ref=>{const payload=sourceBlobs.get(universeRawBlobId(ref));if(!payload)throw new RepositoryError('UNIVERSE_RAW_MISSING','종목 목록 원문을 찾을 수 없습니다.');return payload;};if(entry.storageFormat==='SECTOR_SNAPSHOT_BLOBS_V1')return hydrateUniverseSectorBlob(entry,entry.bodyRefs.map(lookup));if(entry.storageFormat==='UNIVERSE_RAW_BLOB_V1')return hydrateUniverseRawBlob(entry,lookup(entry.rawBodyRef));return entry;});
    if(!mode.full)await this.hydrateReceiptKeys(owner,workspace,mode.receiptKeys);
    return workspace;
  }
  async hydrateReceiptKeys(owner,workspace,keys=[]){for(const key of new Set(keys.filter(value=>typeof value==='string'))){const index=workspace.commandReceipts.findIndex(r=>r.key===key);if(index>=0)workspace.commandReceipts[index]=await this._hydrateReceipt(owner,workspace.commandReceipts[index],true);}return workspace;}
  async exportWorkspace(owner,workspace){const archived=new Map((await this.db.prepare("SELECT object_id,payload FROM workspace_objects WHERE owner_id=? AND kind='receiptResultBlobs'").bind(owner).all()).results.map(row=>[row.object_id,row.payload])),receipts=[];for(const receipt of workspace.commandReceipts)receipts.push(await this._hydrateReceipt(owner,receipt,false,archived));return {...workspace,commandReceipts:receipts};}
  async _hydrateReceipt(owner,receipt,keepRef,archived=null){
    if(!receipt.resultRef)return receipt;
    const ref=assertReceiptResultReference(receipt.resultRef,receipt.id);let text;
    if(ref.storage===RECEIPT_RESULT_LEGACY_FORMAT){const row=await this.db.prepare("SELECT payload FROM workspace_objects WHERE owner_id=? AND kind='commandReceipts' AND object_id=?").bind(owner,receipt.id).first();if(!row)throw new RepositoryError('RECEIPT_RESULT_MISSING','보관된 명령 결과를 찾을 수 없습니다.',409);const original=JSON.parse(row.payload);if(!Object.hasOwn(original,'result')||receiptIdentity(original)!==receiptIdentity(receipt))throw new RepositoryError('RECEIPT_RESULT_CORRUPT','기존 명령 영수증의 원문 참조를 확인하세요.',409);text=receiptResultBytes(original.result);}
    else {const row=archived?(archived.has(resultId(ref))?{payload:archived.get(resultId(ref))}:null):await this.db.prepare("SELECT payload FROM workspace_objects WHERE owner_id=? AND kind='receiptResultBlobs' AND object_id=?").bind(owner,resultId(ref)).first();if(!row)throw new RepositoryError('RECEIPT_RESULT_MISSING','보관된 명령 결과를 찾을 수 없습니다.',409);text=row.payload;}
    const result=validateResultText(text,ref),{resultRef,...metadata}=receipt;
    return {...metadata,...(keepRef?{resultRef}:{}),result};
  }
  async _newReceiptBody(owner,receipt){
    const stored=projectCommandReceiptForStorage(receipt);if(!stored.resultRef)return null;
    const ref=assertReceiptResultReference(stored.resultRef,receipt.id);if(ref.storage!==RECEIPT_RESULT_BLOB_FORMAT)throw new RepositoryError('RECEIPT_RESULT_MISSING','기존 영수증의 원문 참조를 새 영수증으로 추가할 수 없습니다.',409);
    let text;if(Object.hasOwn(receipt,'result'))text=receiptResultBytes(receipt.result);else {const hydrated=await this._hydrateReceipt(owner,stored,false);text=receiptResultBytes(hydrated.result);const {resultRef,...metadata}=stored;if(new TextEncoder().encode(JSON.stringify({...metadata,result:hydrated.result})).length>500000)throw new RepositoryError('OBJECT_TOO_LARGE','기록 하나의 자료 범위를 줄여 주세요.',413);}
    if(new TextEncoder().encode(text).length>500000)throw new RepositoryError('OBJECT_TOO_LARGE','기록 하나의 자료 범위를 줄여 주세요.',413);
    validateResultText(text,ref);const existing=await this.db.prepare("SELECT payload FROM workspace_objects WHERE owner_id=? AND kind='receiptResultBlobs' AND object_id=?").bind(owner,resultId(ref)).first();if(existing){validateResultText(existing.payload,ref);if(existing.payload!==text)throw new RepositoryError('RECEIPT_RESULT_CORRUPT','같은 해시의 명령 결과 원문을 대조하세요.',409);}return {id:resultId(ref),payload:text};
  }
  _archiveStatement(owner,body,token){return this.db.prepare("INSERT INTO workspace_objects(owner_id,kind,object_id,ordinal,payload) SELECT ?,'receiptResultBlobs',?,0,? WHERE EXISTS(SELECT 1 FROM workspace_heads WHERE owner_id=? AND last_command_id=?) ON CONFLICT(owner_id,kind,object_id) DO NOTHING").bind(owner,body.id,body.payload,owner,token);}
  _mindRunArchiveStatement(owner,body,token){return this.db.prepare("INSERT INTO workspace_objects(owner_id,kind,object_id,ordinal,payload) SELECT ?,'mindRunEvidenceBlobs',?,0,? WHERE EXISTS(SELECT 1 FROM workspace_heads WHERE owner_id=? AND last_command_id=?) ON CONFLICT(owner_id,kind,object_id) DO NOTHING").bind(owner,body.id,body.payload,owner,token);}
  async _newMindRunEvidence(owner,run){
    const projected=projectMindRunForStorage(run);if(!projected.evidenceBodyRef)return null;
    const id=mindRunEvidenceId(projected.evidenceBodyRef),existing=await this.db.prepare("SELECT payload FROM workspace_objects WHERE owner_id=? AND kind='mindRunEvidenceBlobs' AND object_id=?").bind(owner,id).first();
    const payload=mindRunEvidenceText(run)??existing?.payload;
    hydrateMindRunEvidence(projected,payload);
    if(existing&&existing.payload!==payload)throw new RepositoryError('MIND_RUN_EVIDENCE_CORRUPT','저장한 실행 원문의 해시와 내용을 대조하세요.');
    return {id,payload};
  }
  async _hydrateMindRun(owner,run){
    if(!run.evidenceBodyRef)return run;
    const row=await this.db.prepare("SELECT payload FROM workspace_objects WHERE owner_id=? AND kind='mindRunEvidenceBlobs' AND object_id=?").bind(owner,mindRunEvidenceId(run.evidenceBodyRef)).first();
    return hydrateMindRunEvidence(run,row?.payload);
  }
  async _newUniverseBodies(owner,entry){
    if(entry.snapshot?.kind==='TOSS_STOCK_CATALOG_RAW_CHUNK')return [await this._newUniverseBody(owner,entry)];
    if(entry.snapshot?.contractVersion!=='MARKET_SECTOR_SNAPSHOT_V1')return [];
    const projected=encodeUniverseSource(entry),parts=Array.isArray(entry.snapshot.captures)?splitUniverseSourceBody(JSON.stringify(entry.snapshot)):null,bodies=[];
    for(const [index,ref]of projected.bodyRefs.entries()){const id=universeRawBlobId(ref),existing=await this.db.prepare("SELECT payload FROM workspace_objects WHERE owner_id=? AND kind='universeSourceBlobs' AND object_id=?").bind(owner,id).first(),payload=parts?JSON.stringify({rawText:parts[index]}):existing?.payload;if(!payload)throw new RepositoryError('UNIVERSE_RAW_MISSING','섹터 원문을 찾을 수 없습니다.');if(new TextEncoder().encode(payload).length>500000)throw new RepositoryError('OBJECT_TOO_LARGE','원문 조각의 저장 크기를 확인하세요.',413);if(existing&&existing.payload!==payload)throw new RepositoryError('UNIVERSE_RAW_CORRUPT','섹터 원문 저장 내용을 확인하세요.');bodies.push({id,payload});}
    hydrateUniverseSectorBlob(projected,bodies.map(b=>b.payload));return bodies;
  }
  async _newUniverseBody(owner,entry){
    const projected=encodeUniverseSource(entry),id=universeRawBlobId(projected.rawBodyRef);let payload;
    if(typeof entry.snapshot?.rawText==='string')payload=JSON.stringify({rawText:entry.snapshot.rawText});
    else {const row=await this.db.prepare("SELECT payload FROM workspace_objects WHERE owner_id=? AND kind='universeSourceBlobs' AND object_id=?").bind(owner,id).first();if(!row)throw new RepositoryError('UNIVERSE_RAW_MISSING','종목 목록 원문을 찾을 수 없습니다.');payload=row.payload;}
    if(new TextEncoder().encode(payload).length>500000)throw new RepositoryError('OBJECT_TOO_LARGE','종목 원문 조각의 저장 크기를 확인하세요.',413);
    hydrateUniverseRawBlob(projected,payload);const existing=await this.db.prepare("SELECT payload FROM workspace_objects WHERE owner_id=? AND kind='universeSourceBlobs' AND object_id=?").bind(owner,id).first();if(existing&&existing.payload!==payload)throw new RepositoryError('UNIVERSE_RAW_CORRUPT','종목 원문 저장 내용을 확인하세요.');return {id,payload};
  }
  _universeArchiveStatement(owner,body,token){return this.db.prepare("INSERT INTO workspace_objects(owner_id,kind,object_id,ordinal,payload) SELECT ?,'universeSourceBlobs',?,0,? WHERE EXISTS(SELECT 1 FROM workspace_heads WHERE owner_id=? AND last_command_id=?) ON CONFLICT(owner_id,kind,object_id) DO NOTHING").bind(owner,body.id,body.payload,owner,token);}
  async _hydrateUniverseObject(owner,entry){const decoded=decodeUniverseSource(entry),lookup=async ref=>{const row=await this.db.prepare("SELECT payload FROM workspace_objects WHERE owner_id=? AND kind='universeSourceBlobs' AND object_id=?").bind(owner,universeRawBlobId(ref)).first();if(!row)throw new RepositoryError('UNIVERSE_RAW_MISSING','종목 목록 원문을 찾을 수 없습니다.');return row.payload;};if(decoded.storageFormat==='SECTOR_SNAPSHOT_BLOBS_V1')return hydrateUniverseSectorBlob(decoded,await Promise.all(decoded.bodyRefs.map(lookup)));if(decoded.storageFormat==='UNIVERSE_RAW_BLOB_V1')return hydrateUniverseRawBlob(decoded,await lookup(decoded.rawBodyRef));return decoded;}
  async readObject(owner,kind,id){
    if(typeof owner!=='string'||!owner||!WORKSPACE_COLLECTIONS.includes(kind)||typeof id!=='string'||!id||id.length>200)throw new RepositoryError('INVALID_OBJECT','조회할 원본의 식별자를 확인하세요.',400);
    const row=await this.db.prepare('SELECT payload FROM workspace_objects WHERE owner_id=? AND kind=? AND object_id=?').bind(owner,kind,id).first();
    return row?(kind==='universeSourceSnapshots'?this._hydrateUniverseObject(owner,JSON.parse(row.payload)):kind==='commandReceipts'?this._hydrateReceipt(owner,JSON.parse(row.payload),false):kind==='mindRuns'?this._hydrateMindRun(owner,JSON.parse(row.payload)):JSON.parse(row.payload)):null;
  }
  async readMindAttemptHistory(owner,subscription,{offset=0,limit=40}={}){
    if(subscription?.ownerId!==owner||!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>100)throw new RepositoryError('INVALID_ATTEMPT_HISTORY','운용 원본의 소유자와 조회 범위를 확인하세요.',400);
    const checkpoint=subscription.attemptCheckpoint,archived=checkpoint?.count??0,items=[];
    const read=async(start,count)=>(await this.db.prepare("SELECT payload FROM workspace_objects WHERE owner_id=? AND kind=? AND json_extract(payload,'$.subscriptionId')=? ORDER BY ordinal LIMIT ? OFFSET ?").bind(owner,MIND_SUBSCRIPTION_HISTORY_KIND,subscription.id,count,start).all()).results.map(row=>JSON.parse(row.payload));
    if(archived){const tail=(await read(archived-1,1))[0];if(!verifyMindAttemptHistory(tail,{ownerId:owner,subscriptionId:subscription.id,profileId:subscription.profileId})||tail.sequence!==archived||tail.contentHash!==checkpoint.tailHash||tail.attempt.barCloseAt!==checkpoint.throughBarCloseAt)throw new RepositoryError('ATTEMPT_HISTORY_CORRUPT','완료 원본과 운용 체크포인트를 대조하세요.');}
    if(offset<archived){const records=await read(offset,Math.min(limit,archived-offset));let previous=offset?(await read(offset-1,1))[0]?.contentHash:'0'.repeat(64);for(const [i,record]of records.entries()){if(!verifyMindAttemptHistory(record,{ownerId:owner,subscriptionId:subscription.id,profileId:subscription.profileId})||record.sequence!==offset+i+1||record.previousHash!==previous)throw new RepositoryError('ATTEMPT_HISTORY_CORRUPT','완료 원본의 순서와 해시 연결을 확인하세요.');previous=record.contentHash;items.push({...record,storage:'DURABLE_HISTORY'});}if(records.length!==Math.min(limit,archived-offset))throw new RepositoryError('ATTEMPT_HISTORY_MISSING','보존한 완료 실행 원본을 확인하세요.');}
    if(items.length<limit){const start=Math.max(0,offset-archived);for(const [i,attempt]of subscription.attempts.slice(start,start+limit-items.length).entries())items.push({subscriptionId:subscription.id,profileId:subscription.profileId,sequence:archived+start+i+1,attempt:structuredClone(attempt),storage:'RECENT'});}
    const total=archived+subscription.attempts.length;return {items,total,nextCursor:offset+items.length<total?String(offset+items.length):null,checkpoint:checkpoint??null};
  }
  async commit(owner,previous,next,commandId,claimFence=null,linkedWrite=null){
    if(!Number.isSafeInteger(previous.revision)||next.revision!==previous.revision+1)throw new RepositoryError('INVALID_REVISION','저장 버전을 확인하세요.',400);
    assertQuantStrategyCollectionTransition(previous.quantStrategies??[],next.quantStrategies??[],{ownerId:owner});
    assertModelLibraryTransition(previous,next);
    for(const program of next.regimePrograms??[])assertRegimeProgram(program);
    for(const program of previous.regimePrograms??[])if(!next.regimePrograms?.some(p=>p.id===program.id&&stableStringify(p)===stableStringify(program)))throw new RepositoryError('REGIME_PROGRAM_IMMUTABLE','저장된 국면 라우터는 새 버전으로 보존하세요.');
    const attemptHistory=[];
    for(const subscription of next.mindSubscriptions??[]){
      const errors=validateMindSubscription(subscription,next,{ownerId:owner});if(errors.length)throw new RepositoryError(errors[0].code,errors[0].message,400);
      const prior=(previous.mindSubscriptions??[]).find(s=>s.id===subscription.id);
      if(!prior){if(subscription.attemptCheckpoint)throw new RepositoryError('INVALID_ATTEMPT_CHECKPOINT','새 운용은 이전 실행 원본을 확인한 상태로 시작하세요.');continue;}
      const fixed=['ownerId','profileId','accountId','instrumentId','timeframe','quoteCurrency','executionMode','budget','createdAt','version'];if(fixed.some(k=>JSON.stringify(prior[k])!==JSON.stringify(subscription[k])))throw new RepositoryError('SUBSCRIPTION_BINDING_IMMUTABLE','자동운용의 계좌·종목·호출 예산을 보존하세요.',409);
      const removed=prior.attempts.filter(a=>!subscription.attempts.some(b=>b.key===a.key));
      if(removed.length){
        if(JSON.stringify(removed)!==JSON.stringify(prior.attempts.slice(0,removed.length))||removed.some(a=>!['COMPLETED','FAILED','ABANDONED'].includes(a.status)||a.utcDay>=next.updatedAt.slice(0,10)))throw new RepositoryError('SUBSCRIPTION_ATTEMPT_IMMUTABLE','이전 날짜에 완료한 실행 원본만 순서대로 분리해 보존하세요.');
        const history=checkpointMindAttempts(prior,removed);if(JSON.stringify(history.checkpoint)!==JSON.stringify(subscription.attemptCheckpoint))throw new RepositoryError('INVALID_ATTEMPT_CHECKPOINT','분리한 실행 원본과 체크포인트 해시를 대조하세요.');
        for(const record of history.records){const id=record.subscriptionId+':'+record.attempt.key,payload=JSON.stringify(record),stored=await this.db.prepare("SELECT payload FROM workspace_objects WHERE owner_id=? AND kind=? AND object_id=?").bind(owner,MIND_SUBSCRIPTION_HISTORY_KIND,id).first();if(stored&&stored.payload!==payload)throw new RepositoryError('IMMUTABLE_ATTEMPT_HISTORY','완료한 실행 원본의 내용과 해시를 보존하세요.');attemptHistory.push({id,payload,sequence:record.sequence});}
      }else if(JSON.stringify(prior.attemptCheckpoint)!==JSON.stringify(subscription.attemptCheckpoint))throw new RepositoryError('INVALID_ATTEMPT_CHECKPOINT','실행 원본과 함께 체크포인트를 저장하세요.');
      for(const attempt of prior.attempts){const after=subscription.attempts.find(a=>a.key===attempt.key);if(!after){if(removed.some(a=>a.key===attempt.key))continue;throw new RepositoryError('SUBSCRIPTION_ATTEMPT_IMMUTABLE','저장한 호출 예약을 보존하세요.');}if(['key','barCloseAt','utcDay','reservedAt','pins','requiresJev'].some(k=>JSON.stringify(attempt[k])!==JSON.stringify(after[k]))||['COMPLETED','FAILED','ABANDONED'].includes(attempt.status)&&JSON.stringify(attempt)!==JSON.stringify(after))throw new RepositoryError('SUBSCRIPTION_ATTEMPT_IMMUTABLE','저장한 호출 예약·핀·완료 영수증을 보존하세요.',409);}
    }
    const commitToken=crypto.randomUUID();
    const old=new Map(objects(previous).map(o=>[o.kind+':'+o.id,o.payload]));
    // Upgrade legacy inline evidence in the same owner/revision transaction as
    // the user's next normal write, preserving every original in immutable blobs.
    for(const row of (await this.db.prepare("SELECT object_id,payload FROM workspace_objects WHERE owner_id=? AND kind='mindRuns'").bind(owner).all()).results)old.set('mindRuns:'+row.object_id,row.payload);
    const changes=[],bodies=[],universeBodies=[],runBodies=[];
    for(const o of objects(next).filter(o=>old.get(o.kind+':'+o.id)!==o.payload)){
      if(o.kind==='mindRuns'){
        const body=await this._newMindRunEvidence(owner,o.value);if(body)runBodies.push(body);
        const prior=previous.mindRuns?.find(r=>r.id===o.id)?.automation?.portfolioCycle,current=o.value.automation?.portfolioCycle;
        if(prior?.completedBatch&&(JSON.stringify(prior.completedBatch)!==JSON.stringify(current?.completedBatch)||prior.completedBatchHash!==current?.completedBatchHash))throw new RepositoryError('IMMUTABLE_PORTFOLIO_BATCH','완료한 포트폴리오 실행의 원문과 해시를 보존하세요.');
        if(current?.completedBatch){
          if(current.completedBatchHash!==hashInputPackage(current.completedBatch))throw new RepositoryError('PORTFOLIO_BATCH_HASH','포트폴리오 완료 원문과 해시를 대조하세요.');
          if(!prior?.completedBatch){const sub=next.mindSubscriptions?.find(v=>v.id===o.value.automation.subscriptionId&&v.profileId===o.value.profileId&&v.ownerId===owner),attempt=sub?.attempts.find(a=>a.key===o.value.automation.attemptKey);if(!attempt||attempt.runId!==o.id||!['COMPLETED','FAILED'].includes(attempt.status)||JSON.stringify(sub.runtime?.batch)!==JSON.stringify(current.completedBatch))throw new RepositoryError('PORTFOLIO_BATCH_BINDING','완료 예약·대표 결정·포트폴리오 원문을 연결하세요.');}
        }
      }
      if(o.kind==='commandReceipts'){
        const row=await this.db.prepare("SELECT payload FROM workspace_objects WHERE owner_id=? AND kind='commandReceipts' AND object_id=?").bind(owner,o.id).first();
        if(row){if(receiptIdentity(JSON.parse(row.payload))!==receiptIdentity(o.value))throw new RepositoryError('IMMUTABLE_COMMAND_RECEIPT','저장한 명령과 당시 응답은 원문 그대로 보존하세요.',409);continue;}
        const body=await this._newReceiptBody(owner,o.value);if(body)bodies.push(body);
      }
      if(o.kind==='marketSnapshots'||o.kind==='universeSourceSnapshots'||o.kind==='homeMarketRecords'){
        const archived=await this.readObject(owner,o.kind,o.id);
        if(archived){if(JSON.stringify(o.kind==='universeSourceSnapshots'?encodeUniverseSource(archived):archived)!==o.payload)throw new RepositoryError('IMMUTABLE_MARKET_SNAPSHOT','저장된 시세 원본의 내용이 변경되었습니다.',409);continue;}
      }
      if(o.kind==='universeSourceSnapshots')universeBodies.push(...await this._newUniverseBodies(owner,o.value));
      if(o.kind==='marketKnowledge'){
        const stored=await this.readObject(owner,o.kind,o.id),value=JSON.parse(o.payload);
        if(stored){
          const fixed=['document','contentHash','importedAt','importedBy'];
          if(fixed.some(k=>JSON.stringify(stored[k])!==JSON.stringify(value[k]))||stored.classificationRecord&&JSON.stringify(stored.classificationRecord)!==JSON.stringify(value.classificationRecord)||stored.review&&JSON.stringify(stored.review)!==JSON.stringify(value.review)||stored.status==='APPROVED'&&JSON.stringify(stored)!==o.payload)throw new RepositoryError('IMMUTABLE_MARKET_KNOWLEDGE','저장한 공개 원문·실제 분류·승인은 새 자료 버전으로 갱신하세요.',409);
        }
      }
      if(o.kind==='quantStrategies'){
        const stored=await this.readObject(owner,o.kind,o.id);
        if(stored)assertQuantStrategyCollectionTransition([stored],next.quantStrategies,{ownerId:owner});
      }
      changes.push(o);
    }
    const lifecycle=[];for(const profile of next.investmentProfiles??[])if(profile.status==='ARCHIVED'&&previous.investmentProfiles?.find(p=>p.id===profile.id)?.status!=='ARCHIVED'){const guard=await investmentLifecycleGuard(this.db,{owner,profileId:profile.id});if(guard.blocked.length)throw new RepositoryError('PROFILE_OPERATION_ACTIVE','운용을 먼저 중지하고 보유 자산·미확정 주문·판단 응답을 확인한 뒤 보관하세요.',409);lifecycle.push(guard);}
    const fence=(claimFence?' AND EXISTS(SELECT 1 FROM operation_claims WHERE owner_id=? AND resource_id=? AND claim_token=? AND status=\'PENDING\' AND lease_until>=?)':'')+lifecycle.map(guard=>guard.sql).join('')+(linkedWrite?' AND ('+linkedWrite.guard.sql+')':'');
    const params=[next.revision,JSON.stringify(metadata(next)),commitToken,new Date().toISOString(),owner,previous.revision];
    if(claimFence)params.push(owner,claimFence.resourceId,claimFence.token,claimFence.nowMs);
    for(const guard of lifecycle)params.push(...guard.params);
    if(linkedWrite)params.push(...linkedWrite.guard.params);
    const statements=[this.db.prepare('UPDATE workspace_heads SET revision=?,metadata=?,last_command_id=?,updated_at=? WHERE owner_id=? AND revision=?'+fence).bind(...params)];
    for(const record of attemptHistory)statements.push(this.db.prepare("INSERT INTO workspace_objects(owner_id,kind,object_id,ordinal,payload) SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM workspace_heads WHERE owner_id=? AND last_command_id=?) ON CONFLICT(owner_id,kind,object_id) DO NOTHING").bind(owner,MIND_SUBSCRIPTION_HISTORY_KIND,record.id,record.sequence,record.payload,owner,commitToken));
    for(const body of new Map(bodies.map(body=>[body.id,body])).values())statements.push(this._archiveStatement(owner,body,commitToken));
    for(const body of new Map(runBodies.map(body=>[body.id,body])).values())statements.push(this._mindRunArchiveStatement(owner,body,commitToken));
    for(const body of new Map(universeBodies.map(body=>[body.id,body])).values())statements.push(this._universeArchiveStatement(owner,body,commitToken));
    for(const o of changes)statements.push(this.db.prepare('INSERT INTO workspace_objects(owner_id,kind,object_id,ordinal,payload) SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM workspace_heads WHERE owner_id=? AND last_command_id=?) ON CONFLICT(owner_id,kind,object_id) DO UPDATE SET payload=excluded.payload,ordinal=excluded.ordinal').bind(owner,o.kind,o.id,o.ordinal,o.payload,owner,commitToken));
    if(linkedWrite)statements.push(...linkedWrite.statements({owner,commitToken}));
    const results=await this.db.batch(statements);
    if(results[0]?.meta?.changes!==1)throw new RepositoryError('REVISION_CONFLICT','다른 실행에서 기록이 갱신됐습니다. 새로고침 후 다시 실행하세요.');
    return next;
  }
}
