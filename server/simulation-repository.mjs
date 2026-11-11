import {hashInputPackage} from '../dist/domain/workspace.mjs';
import {researchSha256} from '../dist/domain/research.mjs';

export class SimulationStoreError extends Error { constructor(code,message,status=409){super(message);this.name='SimulationStoreError';this.code=code;this.status=status;} }
const check=(v,c,m,s)=>{if(!v)throw new SimulationStoreError(c,m,s);};
const bytes=v=>new TextEncoder().encode(JSON.stringify(v)).byteLength;
const LIMIT=100*1024;
const initializations=new WeakMap();
const storedRow=row=>{const value=JSON.parse(row.payload);check(hashInputPackage(value)===row.sha256,'SIMULATION_ROW_HASH','저장한 결과 행의 원문 해시가 다릅니다. 다시 실행하기 전에 기록을 확인하세요.',409);return {...value,rowHash:row.sha256};};
export class SimulationRepository {
 constructor(db){check(db?.prepare&&db?.batch,'SIMULATION_STORAGE_REQUIRED','시뮬레이션 저장소 연결이 필요합니다.',503);this.db=db;}
 async freezeEventValue(owner,value){
  const text=JSON.stringify(value),sha256=researchSha256(text),byteCount=new TextEncoder().encode(text).length,parts=[];for(let i=0;i<text.length;i+=12000)parts.push(text.slice(i,i+12000));
  check(parts.length>0&&parts.length<=500,'SIMULATION_EVENT_SNAPSHOT_LIMIT','실측 실행 원본의 저장 범위를 확인하세요.',413);
  const entries=parts.map((text,index)=>({contractVersion:'EVENT_IMMUTABLE_UTF8_PART_V1',index,partCount:parts.length,sha256,byteCount,text})),pin=await this.freezeKnowledge(owner,entries);
  return {contractVersion:'EVENT_IMMUTABLE_VALUE_REF_V1',...pin,sha256,byteCount,valueHash:hashInputPackage(value)};
 }
 async frozenEventValue(owner,ref){
  check(ref?.contractVersion==='EVENT_IMMUTABLE_VALUE_REF_V1'&&/^[a-f0-9]{64}$/.test(ref.sha256??'')&&/^[a-f0-9]{64}$/.test(ref.valueHash??'')&&Number.isSafeInteger(ref.byteCount)&&ref.byteCount>0,'SIMULATION_EVENT_SNAPSHOT_REF','실측 실행 원본 참조를 확인하세요.');
  const entries=await this.frozenKnowledge(owner,ref);check(entries.length>0&&entries.every((e,i)=>e.contractVersion==='EVENT_IMMUTABLE_UTF8_PART_V1'&&e.index===i&&e.partCount===entries.length&&e.sha256===ref.sha256&&e.byteCount===ref.byteCount&&typeof e.text==='string'),'SIMULATION_EVENT_SNAPSHOT_PARTS','실측 실행 원본 조각을 대조하세요.');
  const text=entries.map(e=>e.text).join('');check(researchSha256(text)===ref.sha256&&new TextEncoder().encode(text).length===ref.byteCount,'SIMULATION_EVENT_SNAPSHOT_HASH','실측 실행 원본의 바이트를 대조하세요.');let value;try{value=JSON.parse(text);}catch{check(false,'SIMULATION_EVENT_SNAPSHOT_JSON','실측 실행 원본 형식을 확인하세요.');}check(hashInputPackage(value)===ref.valueHash,'SIMULATION_EVENT_SNAPSHOT_HASH','실측 실행 원본 해시를 대조하세요.');return value;
 }
 async eventStorageHead(owner,state){
  if(!['UPBIT_EVENT_STREAM','UPBIT_EVENT_UNIVERSE'].includes(state.config?.assetMode))return state;
  const stored=structuredClone(state),manifest=state.core?.manifest;check(manifest?.data?.strategyPlan?.graph,'SIMULATION_EVENT_MANIFEST','실측 실행의 고정 정책 원본을 확인하세요.');
  stored.core.manifestStorage=await this.freezeEventValue(owner,manifest);
  // Keep only SQL-indexed name and graph fields in the bounded header. Reads hydrate the exact original.
  stored.core.manifest={id:manifest.id,data:{name:manifest.data.name,version:manifest.data.version,strategyPlan:{graph:structuredClone(manifest.data.strategyPlan.graph)}},storageProjection:'EVENT_FROZEN_MANIFEST_REF_V1'};
  if(state.execution&&bytes(state.execution)>8192){stored.executionStorage=await this.freezeEventValue(owner,state.execution);stored.execution={sequence:state.execution.sequence,asOf:state.execution.asOf,phase:state.execution.phase,timing:structuredClone(state.execution.timing??null),blockedReasons:structuredClone(state.execution.blockedReasons??[]),projection:'EVENT_IMMUTABLE_EXECUTION_REF_V1'};}else delete stored.executionStorage;
  return stored;
 }
 async hydrateEventHead(owner,state){
  if(!state||!['UPBIT_EVENT_STREAM','UPBIT_EVENT_UNIVERSE'].includes(state.config?.assetMode))return state;
  if(state.core?.manifestStorage||state.core?.manifest?.storageProjection){check(state.core.manifestStorage&&state.core.manifest?.storageProjection==='EVENT_FROZEN_MANIFEST_REF_V1','SIMULATION_EVENT_MANIFEST_PROJECTION','실측 정책 머리말과 원문 참조를 대조하세요.');const full=await this.frozenEventValue(owner,state.core.manifestStorage),projection={id:full.id,data:{name:full.data.name,version:full.data.version,strategyPlan:{graph:structuredClone(full.data.strategyPlan.graph)}},storageProjection:'EVENT_FROZEN_MANIFEST_REF_V1'};check(JSON.stringify(projection)===JSON.stringify(state.core.manifest),'SIMULATION_EVENT_MANIFEST_PROJECTION','실측 정책 머리말과 원문 참조를 대조하세요.');state.core.manifest=full;delete state.core.manifestStorage;}
  if(state.executionStorage||state.execution?.projection==='EVENT_IMMUTABLE_EXECUTION_REF_V1'){check(state.executionStorage&&state.execution?.projection==='EVENT_IMMUTABLE_EXECUTION_REF_V1','SIMULATION_EVENT_EXECUTION_REF','실측 실행 평가 원문 참조를 확인하세요.');state.execution=await this.frozenEventValue(owner,state.executionStorage);delete state.executionStorage;}
  return state;
 }
 async initialize(){
  if(!initializations.has(this.db))initializations.set(this.db,this.db.batch([
   this.db.prepare('CREATE TABLE IF NOT EXISTS simulation_reports (owner_id TEXT NOT NULL,id TEXT NOT NULL,revision INTEGER NOT NULL,input_hash TEXT NOT NULL,payload TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,last_command TEXT NOT NULL,lease_token TEXT,lease_until INTEGER,PRIMARY KEY(owner_id,id))').bind(),
   this.db.prepare('CREATE TABLE IF NOT EXISTS simulation_knowledge_snapshots (owner_id TEXT NOT NULL,snapshot_hash TEXT NOT NULL,sequence INTEGER NOT NULL,payload TEXT NOT NULL,sha256 TEXT NOT NULL,PRIMARY KEY(owner_id,snapshot_hash,sequence))').bind(),
   this.db.prepare('CREATE TABLE IF NOT EXISTS simulation_report_rows (owner_id TEXT NOT NULL,report_id TEXT NOT NULL,kind TEXT NOT NULL,sequence INTEGER NOT NULL,payload TEXT NOT NULL,sha256 TEXT NOT NULL,PRIMARY KEY(owner_id,report_id,kind,sequence))').bind(),
   this.db.prepare('CREATE TABLE IF NOT EXISTS simulation_command_receipts (owner_id TEXT NOT NULL,command_key TEXT NOT NULL,kind TEXT NOT NULL,fingerprint TEXT NOT NULL,report_id TEXT NOT NULL,payload TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(owner_id,command_key))').bind()
  ]).then(()=>this.db.prepare('CREATE INDEX IF NOT EXISTS simulation_reports_owner_created ON simulation_reports(owner_id,created_at,id)').bind().run()).catch(error=>{initializations.delete(this.db);throw error;}));
  await initializations.get(this.db);
 }
 async get(owner,id){await this.initialize();const row=await this.db.prepare('SELECT payload FROM simulation_reports WHERE owner_id=? AND id=?').bind(owner,id).first();return row?this.hydrateEventHead(owner,JSON.parse(row.payload)):null;}
 async freezeKnowledge(owner,entries){
  await this.initialize();const hash=hashInputPackage(entries);check(entries.length<=500,'SIMULATION_KNOWLEDGE_LIMIT','실험 자료를 500건 이내로 선택하세요.',413);
  const statements=entries.map((entry,i)=>{check(bytes(entry)<=LIMIT,'SIMULATION_KNOWLEDGE_LIMIT','자료 원본을 100KB 이내로 선택하세요.',413);return this.db.prepare('INSERT INTO simulation_knowledge_snapshots(owner_id,snapshot_hash,sequence,payload,sha256) VALUES(?,?,?,?,?) ON CONFLICT(owner_id,snapshot_hash,sequence) DO NOTHING').bind(owner,hash,i,JSON.stringify(entry),hashInputPackage(entry));});
  for(let i=0;i<statements.length;i+=20)await this.db.batch(statements.slice(i,i+20));
  return {hash,count:entries.length};
 }
 async frozenKnowledge(owner,pin){
  await this.initialize();check(pin&&/^[a-f0-9]{64}$/.test(pin.hash)&&Number.isSafeInteger(pin.count),'SIMULATION_KNOWLEDGE_PIN','실험 자료 원본 참조를 확인하세요.',409);
  const rows=await this.db.prepare('SELECT sequence,payload,sha256 FROM simulation_knowledge_snapshots WHERE owner_id=? AND snapshot_hash=? ORDER BY sequence').bind(owner,pin.hash).all();
  const entries=rows.results.map((r,i)=>{const entry=JSON.parse(r.payload);check(r.sequence===i&&hashInputPackage(entry)===r.sha256,'SIMULATION_KNOWLEDGE_HASH','실험 자료 원본을 대조하세요.',409);return entry;});
  check(entries.length===pin.count&&hashInputPackage(entries)===pin.hash,'SIMULATION_KNOWLEDGE_HASH','고정된 실험 자료 집합을 대조하세요.',409);return entries;
 }
 async receipt(owner,key){await this.initialize();const r=await this.db.prepare('SELECT kind,fingerprint,report_id,payload FROM simulation_command_receipts WHERE owner_id=? AND command_key=?').bind(owner,key).first();return r?{kind:r.kind,fingerprint:r.fingerprint,reportId:r.report_id,result:JSON.parse(r.payload)}:null;}
 async create(owner,state,{key,fingerprint,now}){
  await this.initialize();const stored=await this.eventStorageHead(owner,state);check(bytes(stored)<=LIMIT,'SIMULATION_HEADER_LIMIT','고정 정책과 실험 설정의 저장 범위를 줄이세요.',413);
  const payload=JSON.stringify(stored),receipt={simulationId:state.id,revision:state.revision};
  await this.db.batch([
   this.db.prepare('INSERT INTO simulation_reports(owner_id,id,revision,input_hash,payload,created_at,updated_at,last_command) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(owner_id,id) DO NOTHING').bind(owner,state.id,state.revision,state.inputHash,payload,now,now,key),
   this.db.prepare('INSERT INTO simulation_command_receipts(owner_id,command_key,kind,fingerprint,report_id,payload,created_at) SELECT ?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM simulation_reports WHERE owner_id=? AND id=? AND input_hash=? AND last_command=?) ON CONFLICT(owner_id,command_key) DO NOTHING').bind(owner,key,'create',fingerprint,state.id,JSON.stringify(receipt),now,owner,state.id,state.inputHash,key)
  ]);
  const saved=await this.receipt(owner,key);check(saved?.kind==='create'&&saved.fingerprint===fingerprint&&saved.reportId===state.id,'SIMULATION_IDEMPOTENCY_CONFLICT','같은 요청 키의 실험 조건이 변경되었습니다.');return this.get(owner,state.id);
 }
 async claim(owner,id,{revision,nowMs,leaseMs=120000}){
  await this.initialize();const token=crypto.randomUUID(),result=await this.db.prepare('UPDATE simulation_reports SET lease_token=?,lease_until=? WHERE owner_id=? AND id=? AND revision=? AND (lease_token IS NULL OR lease_until<?)').bind(token,nowMs+leaseMs,owner,id,revision,nowMs).run();
  check(result?.meta?.changes===1,'SIMULATION_IN_PROGRESS','다른 실행이 처리 중이거나 보고서 버전이 변경되었습니다.');return token;
 }
 async commit(owner,before,after,{token=null,now,key,kind,fingerprint,rows={},release=false,result={}}={}){
  await this.initialize();check(after.revision===before.revision+1,'SIMULATION_REVISION','보고서 저장 버전을 확인하세요.',400);
  for(const key of ['id','schemaVersion','config','source','inputHash','frozenInputs','experiment','createdAt'])check(JSON.stringify(before[key])===JSON.stringify(after[key]),'SIMULATION_FROZEN_INPUT','생성 시 고정한 정책·기간·비용·원본 자료를 보존하세요.');
  for(const key of ['id','config','manifest','pins','mode','createdAt'])check(JSON.stringify(before.core[key])===JSON.stringify(after.core[key]),'SIMULATION_FROZEN_POLICY','고정한 마인드 정책과 실행 버전을 보존하세요.');
  const stored=await this.eventStorageHead(owner,after);check(bytes(stored)<=LIMIT,'SIMULATION_HEADER_LIMIT','실험 상태의 저장 범위를 줄이세요.',413);
  const command=crypto.randomUUID(),fence=token?' AND lease_token=? AND lease_until>=?':'',params=[after.revision,JSON.stringify(stored),now,command,...(release?[null,null]:[]),owner,before.id,before.revision,...(token?[token,Date.parse(now)]:[])];
  const statements=[this.db.prepare('UPDATE simulation_reports SET revision=?,payload=?,updated_at=?,last_command=?'+(release?',lease_token=?,lease_until=?':'')+' WHERE owner_id=? AND id=? AND revision=?'+fence).bind(...params)];
  for(const [rowKind,items]of Object.entries(rows)){
   let chunk=[],chunkBytes=2;
   const flush=()=>{if(!chunk.length)return;statements.push(this.db.prepare("INSERT INTO simulation_report_rows(owner_id,report_id,kind,sequence,payload,sha256) SELECT ?,?,?,json_extract(value,'$.sequence'),json_extract(value,'$.payload'),json_extract(value,'$.sha256') FROM json_each(?) WHERE EXISTS(SELECT 1 FROM simulation_reports WHERE owner_id=? AND id=? AND last_command=?)").bind(owner,before.id,rowKind,JSON.stringify(chunk),owner,before.id,command));chunk=[];chunkBytes=2;};
   for(const row of items??[]){check(['decisions','fills','curve','raw'].includes(rowKind)&&Number.isSafeInteger(row.sequence)&&row.sequence>=0,'SIMULATION_ROW','실험 결과 행을 확인하세요.',400);check(bytes(row)<=LIMIT,'SIMULATION_ROW_LIMIT','결과 원문을 작은 청크로 나누세요.',413);const entry={sequence:row.sequence,payload:JSON.stringify(row),sha256:hashInputPackage(row)},size=bytes(entry)+1;check(size<=LIMIT,'SIMULATION_ROW_LIMIT','결과 원문을 작은 청크로 나누세요.',413);if(chunkBytes+size>LIMIT)flush();chunk.push(entry);chunkBytes+=size;}flush();
  }
  if(key){const saved={...result,simulationId:before.id,revision:after.revision};check(bytes(saved)<=LIMIT,'SIMULATION_RECEIPT_LIMIT','실행 영수증의 범위를 확인하세요.',413);statements.push(this.db.prepare('INSERT INTO simulation_command_receipts(owner_id,command_key,kind,fingerprint,report_id,payload,created_at) SELECT ?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM simulation_reports WHERE owner_id=? AND id=? AND last_command=?) ON CONFLICT(owner_id,command_key) DO NOTHING').bind(owner,key,kind,fingerprint,before.id,JSON.stringify(saved),now,owner,before.id,command));}
  const applied=await this.db.batch(statements);check(applied[0]?.meta?.changes===1,'SIMULATION_REVISION_CONFLICT','보고서 또는 실행 소유권이 변경되었습니다. 다시 조회하세요.');return after;
 }
 async release(owner,id,token){await this.db.prepare('UPDATE simulation_reports SET lease_token=NULL,lease_until=NULL WHERE owner_id=? AND id=? AND lease_token=?').bind(owner,id,token).run();}
 async retainProviderStage(owner,id,rows){
  await this.initialize();check(rows.length>0&&rows.every(row=>row.phase==='PROVIDER_STAGE_RESULT'&&Number.isSafeInteger(row.sequence)&&bytes(row)<=LIMIT),'SIMULATION_STAGE_ROWS','질문 응답의 저장 범위를 확인하세요.');
  for(const row of rows){const hash=hashInputPackage(row);await this.db.prepare("INSERT INTO simulation_report_rows(owner_id,report_id,kind,sequence,payload,sha256) SELECT ?,?,'raw',?,?,? WHERE EXISTS(SELECT 1 FROM simulation_reports WHERE owner_id=? AND id=?) ON CONFLICT(owner_id,report_id,kind,sequence) DO NOTHING").bind(owner,id,row.sequence,JSON.stringify(row),hash,owner,id).run();const saved=await this.db.prepare("SELECT sha256 FROM simulation_report_rows WHERE owner_id=? AND report_id=? AND kind='raw' AND sequence=?").bind(owner,id,row.sequence).first();check(saved?.sha256===hash,'SIMULATION_STAGE_CONFLICT','이미 보관한 질문 응답의 원문을 유지하세요.');}
 }
 async list(owner,{mindId=null,limit=20,after=null,archived=false}={}){await this.initialize();const where=after?' AND (created_at<? OR (created_at=? AND id<?))':'',rows=await this.db.prepare('SELECT payload FROM simulation_reports WHERE owner_id=?'+(archived?" AND json_extract(payload,'$.archivedAt') IS NOT NULL":" AND json_extract(payload,'$.archivedAt') IS NULL")+(mindId?" AND json_extract(payload,'$.config.mindId')=?":'')+where+' ORDER BY created_at DESC,id DESC LIMIT ?').bind(owner,...(mindId?[mindId]:[]),...(after?[after.createdAt,after.createdAt,after.id]:[]),limit+1).all();return Promise.all(rows.results.map(r=>this.hydrateEventHead(owner,JSON.parse(r.payload))));}
 async forQuantStrategy(owner,{resourceId,version,contentHash,limit=100}={}){
  await this.initialize();check(typeof resourceId==='string'&&Number.isSafeInteger(version)&&/^[a-f0-9]{64}$/.test(contentHash)&&Number.isInteger(limit)&&limit>=1&&limit<=100,'SIMULATION_QUANT_QUERY','조회할 전략 버전과 결과 수를 확인하세요.',400);
  const where="owner_id=? AND json_extract(payload,'$.config.mode')='GRAPH_CANONICAL' AND EXISTS(SELECT 1 FROM json_each(json_extract(simulation_reports.payload,'$.core.manifest.data.strategyPlan.graph.libraryBindings')) AS binding WHERE json_extract(binding.value,'$.resourceId')=? AND json_extract(binding.value,'$.resourceVersion')=? AND json_extract(binding.value,'$.resourceHash')=?)",params=[owner,resourceId,version,contentHash];
  const count=await this.db.prepare('SELECT COUNT(*) AS total FROM simulation_reports WHERE '+where).bind(...params).first(),rows=await this.db.prepare('SELECT payload FROM simulation_reports WHERE '+where+' ORDER BY created_at DESC,id DESC LIMIT ?').bind(...params,limit).all();
  return {items:await Promise.all(rows.results.map(r=>this.hydrateEventHead(owner,JSON.parse(r.payload)))),total:count.total,limit,hasMore:count.total>rows.results.length};
 }
 async rows(owner,id,kind,{after=-1,limit=50,frameSequence=null}={}){await this.initialize();const result=await this.db.prepare('SELECT sequence,payload,sha256 FROM simulation_report_rows WHERE owner_id=? AND report_id=? AND kind=? AND sequence>?'+(frameSequence===null?'':' AND sequence>=? AND sequence<?')+' ORDER BY sequence LIMIT ?').bind(owner,id,kind,after,...(frameSequence===null?[]:[frameSequence*10000,(frameSequence+1)*10000]),limit+1).all();return result.results.map(storedRow);}
 async allRows(owner,id,kind){await this.initialize();const result=await this.db.prepare('SELECT payload,sha256 FROM simulation_report_rows WHERE owner_id=? AND report_id=? AND kind=? ORDER BY sequence').bind(owner,id,kind).all();return result.results.map(storedRow);}
 async chart(owner,id){await this.initialize();const count=await this.db.prepare("SELECT COUNT(*) AS total,MIN(sequence) AS first,MAX(sequence) AS last FROM simulation_report_rows WHERE owner_id=? AND report_id=? AND kind='curve'").bind(owner,id).first(),stride=Math.max(1,Math.ceil(Math.max(0,count.total-1)/398));const result=await this.db.prepare("SELECT payload,sha256 FROM simulation_report_rows WHERE owner_id=? AND report_id=? AND kind='curve' AND (sequence=? OR sequence=? OR sequence % ?=0) ORDER BY sequence").bind(owner,id,count.first,count.last,stride).all(),points=result.results.map(storedRow);return {chartPoints:points,chart:{totalPoints:count.total,renderedPoints:points.length,policy:'UNIFORM_STORED_SEQUENCE_FIRST_LAST_V1'}};}
}
