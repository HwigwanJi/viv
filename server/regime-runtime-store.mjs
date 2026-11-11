import {assertRegimeProgram} from '../dist/domain/regime-program.mjs';
const check=(ok,code,message)=>{if(!ok)throw Object.assign(new Error(message),{code,status:409});};
const valid=v=>typeof v==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,199}$/.test(v);

/** Controller and child journals use the same SQLite CAS pattern as event-paper execution. */
export async function createRegimeRuntimeStore({db,owner,instanceId,program}){
 assertRegimeProgram(program);check(valid(owner)&&valid(instanceId),'REGIME_STORAGE_SCOPE','운용 주체와 국면 운용 ID를 확인하세요.');
 await db.batch([
  db.prepare('CREATE TABLE IF NOT EXISTS regime_runtime(owner_id TEXT NOT NULL,instance_id TEXT NOT NULL,part_id TEXT NOT NULL,program_hash TEXT NOT NULL,revision INTEGER NOT NULL,mutation_token TEXT NOT NULL,body TEXT NOT NULL,PRIMARY KEY(owner_id,instance_id,part_id))').bind(),
  db.prepare('CREATE TABLE IF NOT EXISTS regime_runtime_events(owner_id TEXT NOT NULL,instance_id TEXT NOT NULL,part_id TEXT NOT NULL,revision INTEGER NOT NULL,kind TEXT NOT NULL,at TEXT NOT NULL,body TEXT NOT NULL,PRIMARY KEY(owner_id,instance_id,part_id,revision))').bind()
 ]);
 const load=async part=>{const row=await db.prepare('SELECT program_hash,revision,body FROM regime_runtime WHERE owner_id=? AND instance_id=? AND part_id=?').bind(owner,instanceId,part).first();if(!row)return null;check(row.program_hash===program.contentHash,'REGIME_STORAGE_PIN','저장한 운용의 국면 라우터 버전을 보존하세요.');return {...JSON.parse(row.body),revision:row.revision};};
 async function savePart(part,{expectedRevision,next,kind,evidence,at,selection}){
  const token=crypto.randomUUID(),body=JSON.stringify(next);check(Number.isSafeInteger(expectedRevision)&&expectedRevision>=-1&&typeof kind==='string'&&Number.isFinite(Date.parse(at))&&Buffer.byteLength(body)<=500000,'REGIME_STORAGE_INPUT','저장할 실행 상태·버전·시각을 확인하세요.');
  const fence=selection?" AND EXISTS(SELECT 1 FROM regime_runtime c WHERE c.owner_id=? AND c.instance_id=? AND c.part_id='controller' AND c.program_hash=? AND json_extract(c.body,'$.state.epoch')=? AND json_extract(c.body,'$.state.active.model.contentHash')=?)":'',fenceArgs=selection?[owner,instanceId,program.contentHash,selection.epoch,selection.modelHash]:[];
  const write=expectedRevision===-1?db.prepare('INSERT INTO regime_runtime(owner_id,instance_id,part_id,program_hash,revision,mutation_token,body) SELECT ?,?,?,?,0,?,? WHERE NOT EXISTS(SELECT 1 FROM regime_runtime WHERE owner_id=? AND instance_id=? AND part_id=?)'+fence).bind(owner,instanceId,part,program.contentHash,token,body,owner,instanceId,part,...fenceArgs):db.prepare('UPDATE regime_runtime SET revision=revision+1,mutation_token=?,body=? WHERE owner_id=? AND instance_id=? AND part_id=? AND program_hash=? AND revision=?'+fence).bind(token,body,owner,instanceId,part,program.contentHash,expectedRevision,...fenceArgs);
  const results=await db.batch([write,db.prepare('INSERT INTO regime_runtime_events(owner_id,instance_id,part_id,revision,kind,at,body) SELECT owner_id,instance_id,part_id,revision,?,?,? FROM regime_runtime WHERE owner_id=? AND instance_id=? AND part_id=? AND mutation_token=?').bind(kind,at,JSON.stringify(evidence??{}),owner,instanceId,part,token)]);
  check(results[0]?.meta?.changes===1,'REGIME_STATE_CONFLICT','다른 실행이 국면·전략 상태를 변경했습니다. 현재 저장 상태에서 이어가세요.');return {...structuredClone(next),revision:expectedRevision+1};
 }
 const revisions=new Map();
 return {controller:{load:()=>load('controller'),save:command=>savePart('controller',command)},children:{load:async id=>{check(valid(id),'REGIME_STORAGE_SCOPE','전략 버전 ID를 확인하세요.');const v=await load('child:'+id);revisions.set(id,v?.revision??-1);return v;},save:async({id,modelHash,epoch,runtime,kind,evidence,selection,at})=>{check(valid(id)&&revisions.has(id),'REGIME_CHILD_READ_REQUIRED','저장 전에 해당 전략의 실행 상태를 읽으세요.');const saved=await savePart('child:'+id,{expectedRevision:revisions.get(id),next:{modelHash,epoch,runtime},kind,evidence,at,selection});revisions.set(id,saved.revision);return saved;}},history:async()=> (await db.prepare('SELECT part_id,revision,kind,at,body FROM regime_runtime_events WHERE owner_id=? AND instance_id=? ORDER BY at,part_id,revision').bind(owner,instanceId).all()).results.map(e=>({...e,body:JSON.parse(e.body)}))};
}
