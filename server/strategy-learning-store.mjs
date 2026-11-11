import {hashInputPackage,stableStringify} from '../dist/domain/workspace.mjs';

const CONTRACT='STRATEGY_LEARNING_CONTENT_CHUNKS_V1',CHARS=24000,clone=structuredClone;
const fail=(condition,code,message)=>{if(!condition)throw Object.assign(new Error(message),{code,status:409});};
const bytes=value=>new TextEncoder().encode(value).length;
const FIELDS=['sourceManifest','frozenInputs','plan','selection','proposal','receipts','paperObservations','paperResearchPriorities','research','actualExecutionIntake'];

/** Large immutable learning evidence is content-addressed; the workspace keeps a small CAS head. */
export class StrategyLearningStore{
 constructor(db){this.db=db;this.ready=null;this.cache=new Map();}
 async initialize(){
  this.ready??=this.db.prepare('CREATE TABLE IF NOT EXISTS strategy_learning_content(owner_id TEXT NOT NULL,content_hash TEXT NOT NULL,chunk_index INTEGER NOT NULL,chunk_count INTEGER NOT NULL,byte_count INTEGER NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(owner_id,content_hash,chunk_index))').bind().run();
  await this.ready;
 }
 async write(owner,value){
  await this.initialize();const text=stableStringify(value),hash=hashInputPackage(value),parts=[];
  const existing=await this.db.prepare('SELECT chunk_count,byte_count FROM strategy_learning_content WHERE owner_id=? AND content_hash=? ORDER BY chunk_index LIMIT 1').bind(owner,hash).first();
  if(existing){
   const ref={contractVersion:CONTRACT,hash,byteCount:existing.byte_count,chunkCount:existing.chunk_count};
   await this.read(owner,ref);return ref;
  }
  for(let offset=0;offset<text.length;){
   let end=Math.min(offset+CHARS,text.length),last=text.charCodeAt(end-1),next=text.charCodeAt(end);
   if(end<text.length&&last>=0xd800&&last<=0xdbff&&next>=0xdc00&&next<=0xdfff)end--;
   parts.push(text.slice(offset,end));offset=end;
  }
  const ref={contractVersion:CONTRACT,hash,byteCount:bytes(text),chunkCount:parts.length},key=owner+':'+hash;
  for(let offset=0;offset<parts.length;offset+=40)await this.db.batch(parts.slice(offset,offset+40).map((part,index)=>this.db.prepare('INSERT INTO strategy_learning_content(owner_id,content_hash,chunk_index,chunk_count,byte_count,payload) VALUES(?,?,?,?,?,?) ON CONFLICT(owner_id,content_hash,chunk_index) DO NOTHING').bind(owner,hash,offset+index,parts.length,ref.byteCount,part)));
  await this.read(owner,ref);this.cache.set(key,clone(value));
  return ref;
 }
 async read(owner,ref){
  fail(ref?.contractVersion===CONTRACT&&/^[a-f0-9]{64}$/.test(ref.hash)&&Number.isSafeInteger(ref.chunkCount)&&ref.chunkCount>0&&Number.isSafeInteger(ref.byteCount)&&ref.byteCount>0,'LEARNING_RECORD_REF','학습 원본의 참조를 확인하세요.');
  await this.initialize();const result=await this.db.prepare('SELECT chunk_index,chunk_count,byte_count,payload FROM strategy_learning_content WHERE owner_id=? AND content_hash=? ORDER BY chunk_index').bind(owner,ref.hash).all(),rows=result.results;
  fail(rows.length===ref.chunkCount&&rows.every((r,index)=>r.chunk_index===index&&r.chunk_count===ref.chunkCount&&r.byte_count===ref.byteCount),'LEARNING_RECORD_MISSING','학습 원본의 모든 조각을 확인하세요.');
  const text=rows.map(r=>r.payload).join('');fail(bytes(text)===ref.byteCount,'LEARNING_RECORD_CHANGED','학습 원본의 크기를 확인하세요.');let value;
  try{value=JSON.parse(text);}catch{fail(false,'LEARNING_RECORD_CHANGED','학습 원본의 형식을 확인하세요.');}
  fail(hashInputPackage(value)===ref.hash,'LEARNING_RECORD_CHANGED','학습 원본의 내용 해시를 확인하세요.');this.cache.set(owner+':'+ref.hash,clone(value));return value;
 }
 async pack(owner,session,summary){
  const head=clone(session),refs={};
  for(const field of FIELDS)if(head[field]!==undefined&&head[field]!==null){refs[field]=await this.write(owner,head[field]);delete head[field];}
  for(const job of head.jobs)if(job.assessment){job.assessmentRef=await this.write(owner,job.assessment);delete job.assessment;}
  return {...head,recordRefs:{contractVersion:CONTRACT,fields:refs},summary:clone(summary)};
 }
 async unpack(owner,head){
  if(!head?.recordRefs)return clone(head);
  fail(head.recordRefs.contractVersion===CONTRACT,'LEARNING_RECORD_REF','학습 원본의 저장 형식을 확인하세요.');
  const {recordRefs,summary,...session}=clone(head);
  for(const [field,ref]of Object.entries(recordRefs.fields)){fail(FIELDS.includes(field),'LEARNING_RECORD_REF','학습 원본의 항목을 확인하세요.');session[field]=await this.read(owner,ref);}
  for(const job of session.jobs)if(job.assessmentRef){job.assessment=await this.read(owner,job.assessmentRef);delete job.assessmentRef;}
  return session;
 }
}
