import fs from 'node:fs';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {gunzipSync} from 'node:zlib';
import {fileURLToPath} from 'node:url';
import {researchSha256} from '../dist/domain/research.mjs';
import {hashInputPackage} from '../dist/domain/workspace.mjs';
import {strategyGraphHash} from '../dist/domain/strategy-graph.mjs';
import {observedAccountFeeSchedule} from '../dist/domain/connectors.mjs';
import {eventDatasetInstrument} from '../dist/domain/event-campaign-runtime.mjs';
import {verifyMonthlyPaperSources,assessMonthlyPaperTrial} from '../server/monthly-portfolio-assessment.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../artifacts/cji-managed-portfolio-20261108');
const check=(ok,code)=>{if(!ok)throw Error(code);};
export function verifyCompletedMonthlyStudy(dir,{owner,policy,now}){
 const protocol=JSON.parse(fs.readFileSync(path.join(dir,'protocol.json'),'utf8'));
 check(protocol.ownerId===owner&&protocol.mandateId===policy.portfolioPlanId&&protocol.profileId===policy.config.profileId&&protocol.baselineModelHash===policy.config.graphHash,'MONTHLY_SOURCE_SCOPE');
 check(protocol.initialCash===policy.config.capitalLimit&&hashInputPackage(protocol.marketIds)===hashInputPackage(policy.config.marketIds)&&Object.keys(protocol.limits).every(k=>protocol.limits[k]===policy.config[k]),'MONTHLY_SOURCE_CAPITAL');
 const sql=new DatabaseSync(path.join(dir,'trial.sqlite'),{readOnly:true});sql.exec('PRAGMA query_only=ON;PRAGMA busy_timeout=3000');
 try{
  const state=JSON.parse(gunzipSync(sql.prepare('SELECT body FROM state WHERE id=1').get().body));
  check(state.status==='COMPLETED'&&state.protocolHash===researchSha256(JSON.stringify(protocol))&&protocol.endsAt<=now,'MONTHLY_SOURCE_NOT_COMPLETE');
  const books=[],rows=sql.prepare('SELECT sequence,kind,sha,body FROM journal ORDER BY sequence').all();
  for(const row of rows){const text=gunzipSync(row.body).toString();check(researchSha256(text)===row.sha,'MONTHLY_SOURCE_JOURNAL');if(row.kind==='OBSERVED_BOOK')books.push(JSON.parse(text));}
  for(const [id,arm]of Object.entries(state.arms)){
   const source=protocol.graphs[id==='BTC'?'BASE':id],paper=structuredClone(source);for(const n of paper.nodes)if(n.type==='ORDER')n.config.execution='PAPER';
   check(strategyGraphHash(arm.sourceGraph)===strategyGraphHash(source)&&arm.modelHash===strategyGraphHash(source)&&strategyGraphHash(arm.graph)===strategyGraphHash(paper),'MONTHLY_SOURCE_FROZEN_GRAPH');
   check(arm.wallet.initialCash===protocol.initialCash&&arm.wallet.profileId===protocol.profileId&&hashInputPackage(arm.limits)===hashInputPackage(protocol.limits),'MONTHLY_SOURCE_ARM_SCOPE');
   for(const [instrumentId,account]of Object.entries(arm.wallet.accounts)){const dataset=state.datasets[instrumentId.split(':').at(-1)];check(dataset&&hashInputPackage(account.connector.feeSchedule)===hashInputPackage(observedAccountFeeSchedule(dataset.feeSnapshot))&&hashInputPackage(account.connector.instrument)===hashInputPackage(eventDatasetInstrument(dataset)),'MONTHLY_SOURCE_EXECUTION_COSTS');}
  }
  const sourceAudit=verifyMonthlyPaperSources({arms:state.arms,books,journalHash:researchSha256(JSON.stringify(rows.map(({sequence,kind,sha})=>({sequence,kind,sha}))))}),assessment=assessMonthlyPaperTrial({protocol,arms:state.arms,completedAt:state.completedAt??state.updatedAt,sourceAudit,modelCostsKnown:!state.newClassificationConsumed}),primary=assessment.candidates.find(c=>c.id===protocol.primaryCandidate&&c.role==='CONFIRMATORY');
  return primary?.inspection.eligible?{role:primary.role,trialId:protocol.id,graph:primary.graph,candidate:primary.evidence,sourceAudit}:null;
 }finally{sql.close();}
}
/** Only completed, owner-bound local trials enter the product; JSON summary flags are ignored. */
export function createMonthlyPortfolioCandidateSource(base=root){
 const rejected=new Map();
 return async({owner,policy,now})=>{
  if(!fs.existsSync(base))return null;
  for(const entry of fs.readdirSync(base,{withFileTypes:true}).filter(e=>e.isDirectory()&&/^monthly-paper-\d+$/.test(e.name)).sort((a,b)=>b.name.localeCompare(a.name))){
   const dir=fs.realpathSync(path.join(base,entry.name));check(dir.startsWith(fs.realpathSync(base)+path.sep),'MONTHLY_SOURCE_PATH');const stateFile=path.join(dir,'state.json'),protocolFile=path.join(dir,'protocol.json');if(!fs.existsSync(stateFile)||!fs.existsSync(protocolFile))continue;
   const status=JSON.parse(fs.readFileSync(stateFile,'utf8'));if(status.status!=='COMPLETED')continue;
   const p=JSON.parse(fs.readFileSync(protocolFile,'utf8'));if(p.ownerId!==owner||p.mandateId!==policy.portfolioPlanId||p.baselineModelHash!==policy.config.graphHash)continue;
   const key=hashInputPackage({owner,policy:policy.config,trial:p.id}),stamp=fs.statSync(stateFile).mtimeMs;if(rejected.get(key)===stamp)continue;
   try{const result=verifyCompletedMonthlyStudy(dir,{owner,policy,now});if(result)return result;rejected.set(key,stamp);}
   catch(error){rejected.set(key,stamp);throw error;}
  }
  return null;
 };
}
