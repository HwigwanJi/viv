import { DatabaseSync } from 'node:sqlite';
import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
export function wrapSqlite(database){
  const prepare=sql=>({bind(...params){const statement=database.prepare(sql);const runSync=()=>{const r=statement.run(...params);return {success:true,meta:{changes:Number(r.changes)}};};return {
    async first(){return statement.get(...params)||null;},
    // Let HTTP and timers run between completed reads in long async query chains.
    async all(){const results=statement.all(...params);await new Promise(setImmediate);return {results};},
    async run(){return runSync();}, runSync,
  };}});
  return {prepare,async batch(statements){database.exec('BEGIN IMMEDIATE');try{const result=statements.map(s=>s.runSync());database.exec('COMMIT');return result;}catch(error){database.exec('ROLLBACK');throw error;}}};
}
export async function migrateLocal(database,root=process.cwd()){
  database.exec('CREATE TABLE IF NOT EXISTS local_migrations(tag TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
  const journal=JSON.parse(await readFile(path.join(root,'drizzle/meta/_journal.json'),'utf8'));
  for(const entry of journal.entries){if(database.prepare('SELECT tag FROM local_migrations WHERE tag=?').get(entry.tag))continue;
    const sql=await readFile(path.join(root,'drizzle',entry.tag+'.sql'),'utf8');
    database.exec('BEGIN IMMEDIATE');try{database.exec(sql);database.prepare('INSERT INTO local_migrations VALUES(?,?)').run(entry.tag,new Date().toISOString());database.exec('COMMIT');}catch(error){database.exec('ROLLBACK');throw error;}
  }
}
export async function openLocalDatabase(file=path.resolve('.runtime/investment.sqlite')){
  await mkdir(path.dirname(file),{recursive:true});const database=new DatabaseSync(file);let phase='CONFIGURE';
  try{database.exec('PRAGMA busy_timeout=5000');if(database.prepare('PRAGMA journal_mode').get().journal_mode!=='wal')database.exec('PRAGMA journal_mode=WAL');phase='MIGRATE';await migrateLocal(database);}
  catch(error){error.sqlitePhase=phase;try{database.close();}catch{}throw error;}
  return {db:wrapSqlite(database),get isOpen(){return database.isOpen;},close:()=>database.close()};
}

export async function reopenLocalDatabase(previous,file,{open=openLocalDatabase}={}){
  const next=await open(file);
  try{previous.close();}
  catch(error){
    if(previous.isOpen!==false||error.code!=='ERR_SQLITE_ERROR'||(error.errcode&255)!==10){try{next.close();}catch(cleanup){error.cleanupError={code:cleanup.code,message:cleanup.message};}throw error;}
    next.retiredConnectionError={code:error.code,errcode:error.errcode,message:error.message};
    console.warn('SQLite retired connection:',JSON.stringify(next.retiredConnectionError));
  }
  return next;
}
