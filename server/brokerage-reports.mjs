import {decodeLiveEventBody} from './live-event-body.mjs';
import {buildBrokerageReport,brokerageReportHash,BROKERAGE_REPORT_VERSION} from '../dist/domain/brokerage-report.mjs';
import {hashInputPackage} from '../dist/domain/workspace.mjs';
import {gameUnits as units,gameDecimal as decimal} from '../dist/domain/mind-game.mjs';
import {replayLiveAutomationFills} from '../dist/domain/live-trade-ledger.mjs';
import {readLiveAutomationActivity} from './live-automation-read-model.mjs';
import {refreshInvestorValuations} from './mind-investor-performance.mjs';
import {readUpbitTradingReadiness} from './upbit-trading-readiness.mjs';
import {listLiveAutomations,getLiveAutomation} from './live-automation-store.mjs';

const all=async(db,sql,...args)=>(await db.prepare(sql).bind(...args).all()).results??[];
const parse=decodeLiveEventBody;
const fail=(code,status=409)=>{throw Object.assign(Error(code),{code,status});};
const Q=10n**18n;
export async function initializeBrokerageReports(db){
 await db.prepare('CREATE TABLE IF NOT EXISTS brokerage_reports(owner_id TEXT NOT NULL,id TEXT NOT NULL,activation_id TEXT NOT NULL,decision_id TEXT NOT NULL,created_at TEXT NOT NULL,body TEXT NOT NULL,PRIMARY KEY(owner_id,id),UNIQUE(owner_id,activation_id,decision_id))').bind().run();
 await db.prepare('CREATE TABLE IF NOT EXISTS brokerage_nav_observations(owner_id TEXT NOT NULL,activation_id TEXT NOT NULL,as_of TEXT NOT NULL,body TEXT NOT NULL,PRIMARY KEY(owner_id,activation_id,as_of))').bind().run();
}
function verified(row){if(!row)return null;const {reportHash,...body}=parse(row.body);if(brokerageReportHash(body)!==reportHash)fail('REPORT_HASH_MISMATCH');return {...body,reportHash};}
export async function readBrokerageReports({db,owner,reportId,activationId}){
 await initializeBrokerageReports(db);
 if(reportId){const report=verified(await db.prepare('SELECT body FROM brokerage_reports WHERE owner_id=? AND id=?').bind(owner,reportId).first());if(!report)fail('REPORT_NOT_FOUND',404);return {contractVersion:BROKERAGE_REPORT_VERSION,report};}
 if(activationId&&!await getLiveAutomation({db,owner,activationId}))fail('REPORT_NOT_FOUND',404);
 const rows=await all(db,'SELECT body FROM brokerage_reports WHERE owner_id=?'+(activationId?' AND activation_id=?':'')+' ORDER BY created_at DESC LIMIT 100',owner,...(activationId?[activationId]:[]));
 const seen=new Set(),current=rows.map(verified).filter(r=>{const key=r.activationId+':'+r.decisionEventId;if(seen.has(key))return false;seen.add(key);return true;});
 return {contractVersion:BROKERAGE_REPORT_VERSION,items:current.map(r=>({id:r.id,activationId:r.activationId,profileId:r.profileId,generatedAt:r.generatedAt,reportHash:r.reportHash,summary:r.summary})),cadence:'AFTER_EACH_COMPLETED_PORTFOLIO_DECISION'};
}
export async function saveBrokerageReport({db,owner,report}){
 const {reportHash,...body}=report;if(brokerageReportHash(body)!==reportHash)fail('REPORT_HASH_MISMATCH');
 await initializeBrokerageReports(db);
 const edition=report.decisionEventId+':'+report.contractVersion;
 await db.prepare('INSERT OR IGNORE INTO brokerage_reports(owner_id,id,activation_id,decision_id,created_at,body) VALUES(?,?,?,?,?,?)').bind(owner,report.id,report.activationId,edition,report.generatedAt,JSON.stringify(report)).run();
 return verified(await db.prepare('SELECT body FROM brokerage_reports WHERE owner_id=? AND activation_id=? AND decision_id=?').bind(owner,report.activationId,edition).first());
}
async function activitySnapshot({env,owner,activation,clock,fetchImpl,quoteLoader}){
 const activity=(await readLiveAutomationActivity({db:env.DB,owner,activationId:activation.id,asOf:clock(),currentRuntime:env.EVENT_AUTOMATION_STATUS?.()})).items[0];
 const [marked]=await refreshInvestorValuations([activity],{fetchImpl,quoteLoader,now:clock});
 const current=await getLiveAutomation({db:env.DB,owner,activationId:activation.id}),account=await env.DB.prepare('SELECT revision FROM live_automation_accounts WHERE owner_id=? AND account_id=?').bind(owner,activation.config.accountId).first();
 if(current.revision!==marked.investorMetrics?.sourceRevision?.activation||account?.revision!==marked.investorMetrics?.sourceRevision?.account)fail('REPORT_REVISION_CHANGED');
 return marked;
}
export async function recordBrokerageObservation({env,owner,activation,clock,fetchImpl,quoteLoader,bookLoader}){
 const activity=await activitySnapshot({env,owner,activation,clock,fetchImpl,quoteLoader});let btc=null,quoteIssue=null;
 try{const book=await bookLoader('KRW-BTC',{fetchImpl,clock});const now=clock(),top=book.levels[0];
  if(!top?.bidPrice||!top?.askPrice||!book.sourceHash||book.availableAt>now||Date.parse(now)-Date.parse(book.eventTime)>10000)fail('REPORT_BENCHMARK_STALE');
  btc={bid:top.bidPrice,ask:top.askPrice,sourceHash:book.sourceHash,eventTime:book.eventTime,receivedAt:book.receivedAt,availableAt:book.availableAt,rawSource:book.rawSource??null};
 }catch(error){quoteIssue=error.code??error.message;}
 const asOf=clock(),observation={asOf,equity:activity.investorMetrics?.status==='READY'?activity.investorMetrics.equity:null,valuationAt:activity.investorMetrics?.valuationAt??null,ledgerAsOf:activity.ledger.ledgerAsOf,sourceRevision:activity.investorMetrics?.sourceRevision??null,valuationSources:activity.investorMetrics?.valuationSources??[],btc,quoteIssue};
 await env.DB.prepare('INSERT OR IGNORE INTO brokerage_nav_observations VALUES(?,?,?,?)').bind(owner,activation.id,asOf,JSON.stringify(observation)).run();
 return {activity,observation};
}
function usageRecord(provider,id,kind){return {requestId:provider?.requestId??id,kind,model:provider?.model??null,startedAt:provider?.startedAt??null,inputTokens:provider?.usage?.input_tokens??null,outputTokens:provider?.usage?.output_tokens??null,cost:provider?.cost?.amount??null,currency:provider?.cost?.currency??null};}
async function reportInputs({env,owner,activation,decision,activity,clock,fetchImpl,readiness}){
 const db=env.DB,asOf=clock(),start=activation.userConfirmedAt;
 const rows=await all(db,'SELECT f.rowid AS fill_sequence,f.body AS trade_body,o.body AS order_body,o.applied_fee FROM live_automation_fills f JOIN live_automation_orders o ON o.owner_id=f.owner_id AND o.account_id=f.account_id AND o.identifier=f.identifier WHERE f.owner_id=? AND o.activation_id=?',owner,activation.id);
 const gross=new Map(rows.map(r=>{const t=parse(r.trade_body);return [t.id,{funds:t.funds,volume:t.volume}];}));
 const fills=replayLiveAutomationFills(rows,{marketIds:activation.config.marketIds,asOf}).ledger.map(f=>({...f,exactGross:gross.get(f.exchangeTradeId).funds,exactQuantity:gross.get(f.exchangeTradeId).volume}));
 const orders=(await all(db,'SELECT body,state FROM live_automation_orders WHERE owner_id=? AND activation_id=?',owner,activation.id)).map(r=>({...parse(r.body),state:r.state})).filter(o=>o.purpose!=='FUNDING');
 const observations=(await all(db,'SELECT body FROM brokerage_nav_observations WHERE owner_id=? AND activation_id=? AND as_of<=? ORDER BY as_of',owner,activation.id,asOf)).map(r=>parse(r.body));
 const source=await db.prepare("SELECT json_object('asOf',json_extract(body,'$.frame.asOf'),'availableAt',json_extract(body,'$.frame.availableAt'),'observedMarketCount',coalesce(json_extract(body,'$.frame.watch.observedMarkets'),json_array_length(body,'$.frame.series')),'sourceCount',json_array_length(body,'$.frame.sourceRefs'),'news',json_extract(body,'$.frame.news')) AS body FROM live_automation_events WHERE owner_id=? AND activation_id=? AND kind='PORTFOLIO_SOURCE' AND recorded_at<=? ORDER BY recorded_at DESC LIMIT 1").bind(owner,activation.id,decision.recorded_at).first();
 const market=source?parse(source.body):null,latest=new Map();
 const documents=await all(db,"SELECT object_id,json_extract(payload,'$.contentHash') AS hash,json_extract(payload,'$.document.title') AS title FROM workspace_objects WHERE owner_id=? AND kind='marketKnowledge'",owner),byHash=new Map(documents.map(d=>[d.hash,d]));
 for(const e of market?.news?.events??[]){const k=(e.lineageId??e.id)+':'+(e.assetClass??'crypto'),old=latest.get(k);if(!old||(e.availableAt??'')>(old.availableAt??''))latest.set(k,e);}
 const news=[...latest.values()].map(e=>({id:e.id,documentId:byHash.get(e.sourceHash)?.object_id??null,sourceHash:e.sourceHash,title:e.title??e.headline??byHash.get(e.sourceHash)?.title??e.id,source:e.sourceUrl??e.source?.uri??null,publishedAt:e.publishedAt??null,availableAt:e.availableAt??null,direction:e.direction??null,novelty:e.novelty??null,reliability:e.reliability??null,confidence:e.confidence??null,signal:e.signal??e.score??null,assetClass:e.assetClass??null}));
 const newsCalls=await all(db,"SELECT object_id,json_extract(payload,'$.classificationRecord.provider') AS provider FROM workspace_objects WHERE owner_id=? AND kind='marketKnowledge' AND json_extract(payload,'$.classificationRecord.provider.startedAt')>=? AND json_extract(payload,'$.classificationRecord.provider.startedAt')<=?",owner,start,asOf);
 const consumed=new Set(news.map(n=>n.documentId)),modelUsage=new Map(newsCalls.filter(r=>consumed.has(r.object_id)).map(r=>{const u=usageRecord(parse(r.provider),r.object_id,'NEWS_CLASSIFICATION');return [u.requestId,u];}));
 const calls=await all(db,"SELECT id,json_extract(body,'$.callId') AS call_id,json_extract(body,'$.provider') AS provider FROM live_automation_events WHERE owner_id=? AND activation_id=? AND kind IN ('JEV_STARTED','JEV_COMPLETED','JEV_RESPONSE_REJECTED','JEV_OUTCOME_UNKNOWN') AND recorded_at<=? ORDER BY recorded_at",owner,activation.id,asOf);
 for(const r of calls){const id=r.call_id??r.id;if(r.provider||!modelUsage.has(id))modelUsage.set(id,usageRecord(r.provider?parse(r.provider):null,id,'STRATEGY_DECISION'));}
 let broker=null;try{const r=(await readiness({db,owner,env,market:'KRW-BTC',fetchImpl,clock})).readiness;if(r.account&&r.fees)broker={asOf:r.asOf,sourceHash:r.sourceHash,account:r.account,fees:r.fees,supportedBuyTypes:r.rules?.supportedBuyTypes??[],supportedSellTypes:r.rules?.supportedSellTypes??[],cashDifference:decimal(units(r.account.available)+units(r.account.locked)-units(activity.ledger.cash)),cashReconciliationScope:'BROKER_TOTAL_VS_THIS_ACTIVATION',otherAllocationsPossible:true};}catch(error){broker=null;}
 const events=(await all(db,"SELECT id,kind,recorded_at FROM live_automation_events WHERE owner_id=? AND activation_id=? AND kind IN ('CAPITAL_UPDATED','STRATEGY_UPDATE_APPLIED','PORTFOLIO_CONSOLIDATED','MANAGED_MODEL_AUTO_APPLIED') AND recorded_at<=?",owner,activation.id,asOf)).map(r=>({id:r.id,kind:r.kind,recordedAt:r.recorded_at}));
 const decisionBody=parse(decision.body),{outputHash,...evaluation}=decisionBody.evaluation,step=activation.config.graphHash&&evaluation.trace.some(n=>n.type==='MODEL'&&n.output?.modelReview)?60000:3*3600000,nextAnalysisAt=new Date((Math.floor(Date.parse(decisionBody.snapshotAsOf)/step)+1)*step).toISOString();
 if(hashInputPackage(evaluation)!==outputHash||decision.recorded_at>clock()||market?.availableAt>decision.recorded_at)fail('REPORT_DECISION_EVIDENCE');
 const current=await getLiveAutomation({db,owner,activationId:activation.id}),account=await db.prepare('SELECT revision FROM live_automation_accounts WHERE owner_id=? AND account_id=?').bind(owner,activation.config.accountId).first();
 if(current.revision!==activity.investorMetrics?.sourceRevision?.activation||account.revision!==activity.investorMetrics?.sourceRevision?.account)fail('REPORT_REVISION_CHANGED');
 const older=await db.prepare('SELECT id FROM brokerage_reports WHERE owner_id=? AND activation_id=? AND json_extract(body,\'$.decisionEventId\')=? ORDER BY created_at DESC LIMIT 1').bind(owner,activation.id,decision.id).first();
 return {id:'report-'+hashInputPackage({owner,activation:activation.id,decision:decision.id,version:BROKERAGE_REPORT_VERSION}).slice(0,40),activation,activity,decision:decisionBody,decisionEventId:decision.id,market,news,orders,fills,observations,modelUsage:[...modelUsage.values()],broker,promotions:events.filter(e=>e.kind==='MANAGED_MODEL_AUTO_APPLIED').map(e=>({...e,status:'RECEIPT_RECORDED_RUNTIME_VERIFICATION_REQUIRED'})),events,generatedAt:clock(),sourceCutoffAt:asOf,supersedes:older?.id??null,nextAnalysisAt};
}
async function notifyReport(env,owner,r){
 await env.APP_NOTIFY?.(owner,{id:'portfolio:'+r.id,title:'포트폴리오 운용보고서'+(r.supersedes?' · 정정':''),body:r.summary.headline+' · 운용자산 '+(r.summary.equity??'평가 중')+' '+r.currency+' · 체결 '+r.summary.fills+'건',status:'COMPLETED',createdAt:r.generatedAt,profileId:r.profileId,reportId:r.id,details:[{label:'평가 시각',value:r.generatedAt},{label:'자료 범위',value:'시장·배분·주문·정산·성과·위험·비용·모델 이력'},{label:'보고서 해시',value:r.reportHash}]});
}
/** Reporting has no order/activation capabilities and cannot block the trading loop. */
export function createBrokerageReportRunner({env,enabled=true,owner='local-preview-owner',clock=()=>new Date().toISOString(),fetchImpl,quoteLoader,bookLoader,readiness=readUpbitTradingReadiness,setTimer=setTimeout,clearTimer=clearTimeout}={}){
 let timer=null,inFlight=null,running=false;const state={running:false,lastTickAt:null,lastCompletedAt:null,lastError:null,reports:0,observations:0};
 async function collect(){
  await initializeBrokerageReports(env.DB);state.lastTickAt=clock();
  const policies=(await listLiveAutomations({db:env.DB,owner})).filter(p=>p.status==='ENABLED'&&p.portfolioPlanId);
  for(const activation of policies){
   const last=await env.DB.prepare('SELECT as_of FROM brokerage_nav_observations WHERE owner_id=? AND activation_id=? ORDER BY as_of DESC LIMIT 1').bind(owner,activation.id).first();
   let activity;if(!last||Date.parse(clock())-Date.parse(last.as_of)>=60000){const recorded=await recordBrokerageObservation({env,owner,activation,clock,fetchImpl,quoteLoader,bookLoader});activity=recorded.activity;state.observations++;}
   const decision=await env.DB.prepare("SELECT id,recorded_at,body FROM live_automation_events WHERE owner_id=? AND activation_id=? AND kind='DECISION_SUMMARY' ORDER BY recorded_at DESC LIMIT 1").bind(owner,activation.id).first();if(!decision)continue;
   const completed=await env.DB.prepare("SELECT id FROM live_automation_events WHERE owner_id=? AND activation_id=? AND kind='PORTFOLIO_TARGET_COMPLETED' AND recorded_at>=? LIMIT 1").bind(owner,activation.id,decision.recorded_at).first();if(!completed)continue;
   if(parse(decision.body).evaluation.trace.some(n=>n.type==='MODEL'&&n.output?.modelReview)){const latest=verified(await env.DB.prepare('SELECT body FROM brokerage_reports WHERE owner_id=? AND activation_id=? ORDER BY created_at DESC LIMIT 1').bind(owner,activation.id).first());if(latest&&latest.governance?.graphHash===activation.config.graphHash&&Math.floor(Date.parse(latest.sourceCutoffAt)/10800000)===Math.floor(Date.parse(decision.recorded_at)/10800000))continue;}
   let saved=verified(await env.DB.prepare('SELECT body FROM brokerage_reports WHERE owner_id=? AND activation_id=? AND decision_id=?').bind(owner,activation.id,decision.id+':'+BROKERAGE_REPORT_VERSION).first());
   if(!saved){const count=await env.DB.prepare('SELECT count(*) AS n FROM brokerage_nav_observations WHERE owner_id=? AND activation_id=?').bind(owner,activation.id).first();if(count.n<2)continue;activity??=await activitySnapshot({env,owner,activation,clock,fetchImpl,quoteLoader});const input=await reportInputs({env,owner,activation,decision,activity,clock,fetchImpl,readiness});saved=await saveBrokerageReport({db:env.DB,owner,report:buildBrokerageReport(input)});state.reports++;}
   await notifyReport(env,owner,saved);
  }
  state.lastCompletedAt=clock();state.lastError=null;
 }
 function tick(){if(inFlight)return inFlight;inFlight=collect().catch(error=>{state.lastError={code:error.code??error.message,at:clock()};}).finally(()=>{inFlight=null;});return inFlight;}
 async function loop(){await tick();if(running)timer=setTimer(loop,60000);}
 return {start(){if(!(typeof enabled==='function'?enabled():enabled)||running)return;running=state.running=true;timer=setTimer(loop,1000);},async stop(){running=state.running=false;if(timer)clearTimer(timer);await inFlight;},tick,status:()=>({...state,inFlight:!!inFlight})};
}
