import {createWorkspace,hashInputPackage} from '../dist/domain/workspace.mjs';
import {WORKSPACE_COLLECTIONS,RepositoryError} from './repository.mjs';
import {workspaceProjectionCache} from './workspace-projection-cache.mjs';
import {clearMindPaperRunnerHistory} from './mind-paper-runtime.mjs';
import {investmentLifecycleGuard} from './investment-lifecycle-guard.mjs';

export const INVESTMENT_RESET_CONTRACT='WORKSPACE_INVESTMENT_RESET_V1';
const PATH='/api/workspace/reset';
const PRESERVED_KINDS=['marketSnapshots','universeSourceSnapshots','universeSourceBlobs','marketKnowledge','quantStrategies','homeMarketRecords'];
const DELETED_KINDS=[...WORKSPACE_COLLECTIONS.filter(kind=>!PRESERVED_KINDS.includes(kind)),'receiptResultBlobs','mindRunEvidenceBlobs','mindSubscriptionAttemptHistory','scheduler.jobs','scheduler.attempts','scheduler.events','scheduler.receipts'];
const DELETED_TABLES=['simulation_report_rows','simulation_knowledge_snapshots','simulation_command_receipts','simulation_collection_receipts','simulation_reports','strategy_learning_content','operation_claims'];
const RETAINED_TABLES=['broker_connections','market_candle_archives','market_candle_cache'];
const json=(value,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const check=(ok,code,message,status=409)=>{if(!ok)throw new RepositoryError(code,message,status);};
const identifier=value=>typeof value==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9_.:@-]{0,199}$/.test(value);
const placeholders=values=>values.map(()=>'?').join(',');
const reportStateSQL="SELECT COALESCE(json_group_array(json_object('id',id,'revision',revision,'command',last_command)),'[]') AS value FROM (SELECT id,revision,last_command FROM simulation_reports WHERE owner_id=? ORDER BY id)";

async function inventory(db,owner,now){
 const head=await db.prepare('SELECT revision,metadata FROM workspace_heads WHERE owner_id=?').bind(owner).first();
 check(head,'WORKSPACE_REQUIRED','초기화할 마인드 작업 공간을 먼저 여세요.',404);
 const tables=new Set((await db.prepare("SELECT name FROM sqlite_master WHERE type='table'").bind().all()).results.map(row=>row.name));
 const rows=(await db.prepare('SELECT kind,COUNT(*) AS count FROM workspace_objects WHERE owner_id=? GROUP BY kind').bind(owner).all()).results;
 const kinds=Object.fromEntries(rows.map(row=>[row.kind,row.count])),tableCounts={};
 for(const table of [...DELETED_TABLES,...RETAINED_TABLES])tableCounts[table]=tables.has(table)?(await db.prepare('SELECT COUNT(*) AS count FROM '+table+' WHERE owner_id=?').bind(owner).first()).count:0;
 const activeClaims=tables.has('operation_claims')?(await db.prepare("SELECT COUNT(*) AS count FROM operation_claims WHERE owner_id=? AND status='PENDING' AND lease_until>=?").bind(owner,Date.parse(now)).first()).count:0;
 const activeSimulations=tables.has('simulation_reports')?(await db.prepare('SELECT COUNT(*) AS count FROM simulation_reports WHERE owner_id=? AND lease_token IS NOT NULL AND lease_until>=?').bind(owner,Date.parse(now)).first()).count:0;
 const reportState=tables.has('simulation_reports')?(await db.prepare(reportStateSQL).bind(owner).first()).value:'[]';
 const metadata=JSON.parse(head.metadata),deletedObjects=Object.fromEntries(DELETED_KINDS.filter(kind=>kinds[kind]).map(kind=>[kind,kinds[kind]]));
 const counts={minds:kinds.investmentProfiles??0,policies:(kinds.mindManifests??0)+(kinds.mindDocuments??0),paperAccounts:(kinds.accounts??0)+(kinds.mindPositions??0)+(kinds.sharedAccounts??0),experiments:tableCounts.simulation_reports,learningSessions:kinds.learningSessions??0,subscriptions:kinds.mindSubscriptions??0,decisions:(kinds.decisionRecords??0)+(kinds.mindRuns??0),memories:(kinds.memoryVersions??0)+(kinds.memoryCandidates??0),objects:deletedObjects,tables:Object.fromEntries(DELETED_TABLES.map(table=>[table,tableCounts[table]]))};
 const preserved={marketCatalogSnapshots:kinds.universeSourceSnapshots??0,marketCaptures:(kinds.marketSnapshots??0)+tableCounts.market_candle_archives,knowledge:(kinds.marketKnowledge??0)+(metadata.knowledge?.items?.length??0),quantStrategies:kinds.quantStrategies??0,brokerConnections:tableCounts.broker_connections,researchSources:kinds['research.sources']??0};
 const lifecycle=await investmentLifecycleGuard(db,{owner,requireReleasedAllocations:true}),blockedReasons=[...(activeClaims?[{code:'RESET_EXECUTION_IN_PROGRESS',message:'현재 실행의 저장이 끝나면 다시 초기화하세요.',count:activeClaims}]:[]),...(activeSimulations?[{code:'RESET_SIMULATION_IN_PROGRESS',message:'실행 중인 실험을 중지한 뒤 초기화하세요.',count:activeSimulations}]:[]),...(lifecycle.blocked.length?[{code:lifecycle.blocked.includes('EVENT_PAPER_ALLOCATION')?'RESET_PAPER_CAPITAL_ALLOCATED':'RESET_ACTIVE_OPERATION',message:lifecycle.blocked.includes('EVENT_PAPER_ALLOCATION')?'분봉 모의 운용에서 종료하고 자금을 회수한 뒤 초기화하세요.':'실전·분봉 모의 운용을 먼저 중지하고 보유 자산·미확정 주문·판단 응답을 확인한 뒤 초기화하세요.',count:lifecycle.blocked.length}]:[])];
 const previewHash=hashInputPackage({contractVersion:INVESTMENT_RESET_CONTRACT,owner,revision:head.revision,counts,preserved,reportState});
 return {head,tables,reportState,metadata,lifecycle,preview:{contractVersion:INVESTMENT_RESET_CONTRACT,previewHash,counts,preserved,blockedReasons,canReset:!blockedReasons.length}};
}

/** Owner-scoped destructive action. One CAS transaction removes records and their
 * stored originals while retaining provider connections and reusable market data. */
export async function handleWorkspaceReset(request,env={},options={}){
 const url=new URL(request.url);if(url.pathname!==PATH)return null;
 const owner=request.headers.get('oai-authenticated-user-id');if(!owner)return json({ok:false,code:'UNAUTHORIZED',message:'로그인이 필요합니다.'},401);
 if(request.headers.get('Origin')&&request.headers.get('Origin')!==url.origin||request.headers.get('Sec-Fetch-Site')==='cross-site')return json({ok:false,code:'ORIGIN',message:'앱에서 다시 실행하세요.'},403);
 try{
  check(['GET','POST'].includes(request.method)&&!url.search,'RESET_ROUTE','초기화 경로를 확인하세요.',400);
  const db=env.DB?.withSession?env.DB.withSession('first-primary'):env.DB;check(db?.prepare&&db?.batch,'STORAGE_REQUIRED','저장소 연결을 확인하세요.',503);
  const now=new Date(typeof options.now==='function'?options.now():options.now??Date.now()).toISOString();
  if(request.method==='GET'){const current=await inventory(db,owner,now);return json({ok:true,revision:current.head.revision,preview:current.preview});}
  check(request.headers.get('content-type')?.startsWith('application/json'),'RESET_BODY','JSON 요청을 확인하세요.',400);
  const raw=await request.text();check(new TextEncoder().encode(raw).length<=4096,'RESET_BODY','초기화 요청 크기를 확인하세요.',413);let body;try{body=JSON.parse(raw);}catch{check(false,'RESET_BODY','초기화 요청 형식을 확인하세요.',400);}
  check(body&&typeof body==='object'&&!Array.isArray(body)&&Object.keys(body).length===4&&['expectedRevision','idempotencyKey','previewHash','confirmation'].every(key=>Object.hasOwn(body,key))&&Number.isSafeInteger(body.expectedRevision)&&body.expectedRevision>=0&&identifier(body.idempotencyKey)&&/^[a-f0-9]{64}$/.test(body.previewHash)&&body.confirmation==='DELETE_ALL_MINDS','RESET_CONFIRMATION','삭제 범위와 영구 삭제 선택을 확인하세요.',400);
  const fingerprint=hashInputPackage({contractVersion:INVESTMENT_RESET_CONTRACT,...body});
  await db.prepare('CREATE TABLE IF NOT EXISTS workspace_reset_receipts(owner_id TEXT NOT NULL,command_key TEXT NOT NULL,fingerprint TEXT NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(owner_id,command_key))').bind().run();
  const receipt=await db.prepare('SELECT fingerprint,payload FROM workspace_reset_receipts WHERE owner_id=? AND command_key=?').bind(owner,body.idempotencyKey).first();
  if(receipt){check(receipt.fingerprint===fingerprint,'RESET_KEY_CONFLICT','같은 초기화 요청의 내용을 유지하세요.');return json({...JSON.parse(receipt.payload),idempotent:true});}
  const current=await inventory(db,owner,now);
  check(current.head.revision===body.expectedRevision&&current.preview.previewHash===body.previewHash,'RESET_PREVIEW_CHANGED','기록이 변경되었습니다. 삭제 범위를 다시 확인하세요.');
  check(current.preview.canReset,current.preview.blockedReasons[0]?.code,current.preview.blockedReasons[0]?.message);
  const defaults=createWorkspace({now});
  const metadata={...current.metadata,revision:body.expectedRevision+1,updatedAt:now};delete metadata.scheduler;delete metadata.uiPreferences;
  const token=crypto.randomUUID(),result={contractVersion:INVESTMENT_RESET_CONTRACT,deletedCounts:current.preview.counts,preserved:current.preview.preserved,completedAt:now,initialized:{minds:0,strategyDefaults:1,riskDefaults:1}},response={ok:true,revision:metadata.revision,result,idempotent:false};
  let guards=current.lifecycle.sql,guardValues=[...current.lifecycle.params];
  if(current.tables.has('operation_claims')){guards+=" AND NOT EXISTS(SELECT 1 FROM operation_claims WHERE owner_id=? AND status='PENDING' AND lease_until>=?)";guardValues.push(owner,Date.parse(now));}
  if(current.tables.has('simulation_reports')){guards+=' AND NOT EXISTS(SELECT 1 FROM simulation_reports WHERE owner_id=? AND lease_token IS NOT NULL AND lease_until>=?) AND ('+reportStateSQL+')=?';guardValues.push(owner,Date.parse(now),owner,current.reportState);}
  const statements=[db.prepare('UPDATE workspace_heads SET revision=?,metadata=?,last_command_id=?,updated_at=? WHERE owner_id=? AND revision=?'+guards).bind(metadata.revision,JSON.stringify(metadata),token,now,owner,body.expectedRevision,...guardValues)];
  const fence='EXISTS(SELECT 1 FROM workspace_heads WHERE owner_id=? AND last_command_id=?)';
  statements.push(db.prepare('DELETE FROM workspace_objects WHERE owner_id=? AND kind IN ('+placeholders(DELETED_KINDS)+') AND '+fence).bind(owner,...DELETED_KINDS,owner,token));
  for(const table of DELETED_TABLES)if(current.tables.has(table))statements.push(db.prepare('DELETE FROM '+table+' WHERE owner_id=? AND '+fence).bind(owner,owner,token));
  for(const kind of ['strategies','strategyVersions','riskPresets','riskPresetVersions'])for(const [index,value]of defaults[kind].entries())statements.push(db.prepare('INSERT INTO workspace_objects(owner_id,kind,object_id,ordinal,payload) SELECT ?,?,?,?,? WHERE '+fence).bind(owner,kind,value.id,index,JSON.stringify(value),owner,token));
  statements.push(db.prepare('INSERT INTO workspace_reset_receipts(owner_id,command_key,fingerprint,payload) SELECT ?,?,?,? WHERE '+fence+' ON CONFLICT(owner_id,command_key) DO NOTHING').bind(owner,body.idempotencyKey,fingerprint,JSON.stringify(response),owner,token));
  await options.beforeCommit?.();const applied=await db.batch(statements);
  check(applied[0]?.meta?.changes===1,'RESET_PREVIEW_CHANGED','실행 상태가 변경되었습니다. 삭제 범위를 다시 확인하세요.');
  workspaceProjectionCache.evictOwner(owner);clearMindPaperRunnerHistory(env.DB,owner,now);
  return json(response);
 }catch(error){return json({ok:false,code:error.code??'RESET_FAILED',message:error.code?error.message:'마인드 초기화 상태를 다시 확인하세요.'},error.status??500);}
}
