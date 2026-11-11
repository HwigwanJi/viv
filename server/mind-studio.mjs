import {isAdaptivePortfolioGraph,isDailyPortfolioGraph,isSurgePortfolioGraph,calendarPortfolioSelection} from '../dist/domain/adaptive-portfolio-graph.mjs';
import {strategyModelCatalog,saveStrategyModel,saveMindPreset,restoreMindPreset,prepareStrategyProgram,saveRegimeProgram,retirePresetSources} from './strategy-model-library.mjs';
import {verifyInternalExecutionContext} from './internal-execution-context.mjs';
import {retryMindExecution} from './mind-execution-retry.mjs';
import {PAPER_MIND_STARTERS,createPaperMindPresetGraph} from '../dist/domain/paper-mind-presets.mjs';
import {runMindPortfolioCycle} from './mind-portfolio-cycle.mjs';
import {applyLearningPolicyProvenance,syncLearningPolicyGraph} from './learning-policy-provenance.mjs';
import {mindPaperRunnerStatus} from './mind-paper-runtime.mjs';
import {createGraphProviderJournal} from './graph-provider-journal.mjs';
import {paperBudgetFor,paperBudgetSummary,configurePaperBudget,allocatePaperBudget,validatePaperBudgets} from '../dist/domain/paper-budget.mjs';
import {newsComparisonSources,createNewsComparisonFromRun,readNewsComparisons,runNewsComparison} from './news-comparison-service.mjs';
import {verifyStoredUniverseSources} from './universe-sources.mjs';
import {readQuantStrategyLibrary,readQuantStrategyItem,quantStrategyEntry,quantStrategyUsage,quantStrategySimulationUsage,exportQuantStrategy,createQuantStrategyDraft,publishQuantStrategy,verifyQuantStrategyPins} from './quant-strategy-library.mjs';
import {prepareUniverseCandidates,UniverseCandidateError} from './universe-candidates.mjs';
import {universeCatalog,searchUniverseCatalog,collectUniverseSource,buildUniverseDraft} from './universe-workspace.mjs';
import {currentTossCatalog} from './toss-catalog.mjs';
import {tossReadConnectionStatus} from './broker-accounts.mjs';
import {mindSubscriptionCatalog,dispatchMindSubscription,MIND_OBSERVATION_FENCE} from './mind-subscriptions.mjs';
import {mindSubscriptionRecovery,recoverMindSubscription} from './mind-subscription-recovery.mjs';
import {prepareMindEvaluation,evaluatePreparedMind,executeMindRun,mindStrategyHistoryBars} from './mind-execution-service.mjs';
import {buildTerminalReadiness,terminalErrorRecovery} from './terminal-readiness.mjs';
import marketKnowledgeSchema from '../design/mind-forms/market-knowledge.schema.json' with {type:'json'};
import {assertMarketKnowledgeDocument,parseMarketKnowledgeDocument,serializeMarketKnowledgeDocument,marketKnowledgeHash,marketKnowledgeExample,buildKnowledgeClassificationQuestions,knowledgeClassification,priorKnowledgeDigest,selectMarketKnowledge,KNOWLEDGE_CHOICES,KNOWLEDGE_SOURCE_TYPES,disabledExternalKnowledge} from '../dist/domain/market-knowledge.mjs';
import {queryMarketKnowledge,knowledgeItem,verifyKnowledgeVersion,verifyKnowledgePins,marketKnowledgeUsage} from './market-knowledge.mjs';
import { WorkspaceRepository, RepositoryError, MIND_COLLECTIONS, readOperationalWorkspace } from './repository.mjs';
import { createWorkspace, dispatchWorkspaceAction, hashInputPackage, validateWorkspace } from '../dist/domain/workspace.mjs';
import {researchSha256} from '../dist/domain/research.mjs';
import { importKnowledge } from '../dist/knowledge.mjs';
import { listInstruments, getInstrument } from '../dist/domain/instruments.mjs';
import { parseMindDocument, assertMindDocument, serializeMindDocument, exportMindPolicy, mindDocumentHash, attachMindClassification } from '../dist/domain/mind-manifest.mjs';
import { proposePrincipleWeight, approveWeightProposal } from '../dist/domain/learning-assessment.mjs';
import {buildAutomaticEvaluation,assertAutomaticEvaluationSource} from '../dist/domain/learning-cohort-assessment.mjs';
import {draftMindStrategyPlan,approveMindStrategyPlan,strategyPlanHash,createMindStrategyPlan,strategyPlanWithGraph,isMindStrategyPlanActive} from '../dist/domain/mind-strategy-plan.mjs';
import {createStrategyModule} from '../dist/domain/strategy-graph.mjs';
import {refreshQuantStrategyBindings} from '../dist/domain/quant-strategy-library.mjs';
import {strategyGraphLearningSummary} from './strategy-graph-assessment.mjs';
import {loadMindStrategyFeatures} from './mind-strategy-features.mjs';
import {buildMindValuation} from './mind-valuations.mjs';
import {buildMindCompanions} from '../dist/domain/mind-companion.mjs';
import {buildMindMemoryView} from './mind-memory-view.mjs';
import {buildMindLibrary} from './investment-read-model.mjs';
import {captureMindProviderFailure} from './mind-provider-failure.mjs';
import { loadInstrumentMarket, InstrumentMarketError, safeInstrumentMarketDiagnostic } from './instrument-market.mjs';
import { createOwnerMarketResolver } from './canonical-instrument-market.mjs';
import { decisionReadModel } from './read-model.mjs';
import { buildPortfolioView } from './portfolio-views.mjs';
import { acquireClaim, completeClaim, releaseClaim } from './claims.mjs';
import { JEV_MODEL } from '../dist/trading/jev.mjs';
import {mindRunEvidenceHash} from './mind-observation.mjs';
import seed from '../dist/data/knowledge-seed.json' with {type:'json'};
import historical from '../dist/data/btc-4h.json' with {type:'json'};
import formCatalog from '../design/mind-forms/catalog.json' with {type:'json'};
import policySchema from '../design/mind-forms/mind-policy.schema.json' with {type:'json'};
import reviewSchema from '../design/mind-forms/trade-review.schema.json' with {type:'json'};
import contextSchema from '../design/mind-forms/market-context.schema.json' with {type:'json'};
import evidenceSchema from '../design/mind-forms/principle-evidence.schema.json' with {type:'json'};
import weightSchema from '../design/mind-forms/weight-proposal.schema.json' with {type:'json'};
import reviewV2Schema from '../design/mind-forms/trade-review-v2.schema.json' with {type:'json'};
import evidenceV2Schema from '../design/mind-forms/principle-evidence-v2.schema.json' with {type:'json'};
import strategyPlanSchema from '../design/mind-forms/strategy-plan.schema.json' with {type:'json'};

const LEGACY_INSTRUMENT='crypto:binance:BTCUSDT', BTC='crypto:okx:BTC-USDT';
const PATHS=new Set(['/api/workspace/mind-subscriptions/history','/api/workspace/mind-subscriptions/retry-execution','/api/workspace/mind-subscriptions/run-now','/api/workspace/accounts/budget','/api/workspace/accounts/allocate','/api/workspace/mind-subscriptions/recovery','/api/workspace/mind-subscriptions/reconcile','/api/workspace/mind-subscriptions/recover','/api/workspace/mind-subscriptions/abandon','/api/workspace/mind-documents/policy-draft','/api/workspace/mind-subscriptions','/api/workspace/mind-subscriptions/create','/api/workspace/mind-subscriptions/enable','/api/workspace/mind-subscriptions/pause','/api/workspace/mind-subscriptions/apply-version','/api/workspace/market-knowledge','/api/workspace/market-knowledge/item','/api/workspace/market-knowledge/export','/api/workspace/market-knowledge/forms','/api/workspace/market-knowledge/write','/api/workspace/market-knowledge/save','/api/workspace/market-knowledge/classify','/api/workspace/market-knowledge/publish','/api/workspace/terminal','/api/workspace/minds','/api/workspace/mind-forms','/api/workspace/minds/export','/api/workspace/mind-documents','/api/workspace/mind-documents/classify','/api/workspace/mind-documents/publish','/api/workspace/terminal/evaluate','/api/workspace/terminal/select','/api/workspace/terminal/universe','/api/workspace/terminal/accounts','/api/workspace/terminal/execute','/api/workspace/terminal/observe','/api/workspace/terminal/observation','/api/workspace/terminal/records','/api/workspace/minds/weights/propose','/api/workspace/minds/weights/approve','/api/workspace/mind-documents/from-experience']);
const schemas={'mind-policy':policySchema,'trade-review':reviewSchema,'market-context':contextSchema,'principle-evidence':evidenceSchema,'weight-proposal':weightSchema};
for(const suffix of ['','/source','/create','/run'])PATHS.add('/api/workspace/news-comparisons'+suffix);
for(const suffix of ['','/item','/usage','/export','/draft','/publish'])PATHS.add('/api/workspace/quant-strategies'+suffix);
PATHS.add('/api/workspace/universe/catalog');PATHS.add('/api/workspace/universe/search');PATHS.add('/api/workspace/universe/sources');PATHS.add('/api/workspace/mind-valuations');PATHS.add('/api/workspace/mind-memories');PATHS.add('/api/workspace/mind-library');
for(const suffix of ['', '/item', '/model', '/preset', '/restore', '/restore-model', '/retire', '/program', '/deployment'])PATHS.add('/api/workspace/strategy-library'+suffix);
const v2schemas={'trade-review':reviewV2Schema,'principle-evidence':evidenceV2Schema};
const json=(value,status=200,headers={})=>Response.json(value,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...headers}});
const clone=structuredClone, list=x=>Array.isArray(x)?x:[];
const fail=(code,message,status=400)=>{throw new RepositoryError(code,message,status);};
const check=(value,code,message,status)=>{if(!value)fail(code,message,status);};
const nowISO=options=>new Date(typeof options.now==='function'?options.now():options.now??Date.now()).toISOString();
const safeId=x=>typeof x==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,199}$/.test(x);
const uniqueId=prefix=>prefix+'-'+crypto.randomUUID();

function marketFailure(error,env={}){
  const secrets=Object.entries(env).filter(([name,value])=>/key|secret|token|passphrase/i.test(name)&&typeof value==='string'&&value.length).map(([,value])=>value);
  let message=error.message.replace(/[\u0000-\u001f\u007f-\u009f]/g,' ').slice(0,400);for(const secret of secrets)message=message.split(secret).join('[redacted]');
  const diagnostic=safeInstrumentMarketDiagnostic(error.diagnostic,{secrets});
  const status=['INVALID_MARKET_OPTIONS','INVALID_MARKET_TIME'].includes(error.code)?400:error.code==='MARKET_NETWORK_ERROR'||diagnostic?.httpStatus===429||diagnostic?.httpStatus>=500?503:502;
  return {status,payload:{ok:false,code:error.code,message,errorSource:'MARKET_PROVIDER',diagnostic,recovery:terminalErrorRecovery({code:error.code,diagnostic},{now:diagnostic?.receivedAt??new Date().toISOString()})}};
}
function observationSourceFailure(error,instrumentId,checkedAt,env){
  const failure=marketFailure(error,env),diagnostic=failure.payload.diagnostic,retryAfter=diagnostic?.retryAfter??null;
  if(failure.status===400)throw error;
  const receivedAt=diagnostic?.receivedAt&&Date.parse(diagnostic.receivedAt)<=Date.parse(checkedAt)?diagnostic.receivedAt:checkedAt;
  let nextEligibleAt=null;
  if(retryAfter&&/^\d{1,10}$/.test(retryAfter))nextEligibleAt=new Date(Date.parse(receivedAt)+Number(retryAfter)*1000).toISOString();
  else if(retryAfter&&Number.isFinite(Date.parse(retryAfter)))nextEligibleAt=new Date(retryAfter).toISOString();
  return {instrumentId,code:failure.payload.code,message:failure.payload.message,errorSource:'MARKET_PROVIDER',checkedAt,retryAfter,nextEligibleAt,nextEligibilitySource:nextEligibleAt?'PROVIDER_RETRY_AFTER':'UNKNOWN',diagnostic};
}

async function readBody(request){
  check(request.headers.get('Content-Type')?.startsWith('application/json'),'INVALID_JSON','JSON 입력 형식을 확인하세요.');
  const raw=await request.text();check(new TextEncoder().encode(raw).length<=200000,'BODY_TOO_LARGE','문서는 200KB 이내로 작성하세요.',413);
  let body;try{body=JSON.parse(raw);}catch{fail('INVALID_JSON','JSON 문법을 확인하세요.');}
  check(body&&typeof body==='object'&&!Array.isArray(body),'INVALID_JSON','입력 문서를 확인하세요.');return body;
}
function baseManifests(w,now,owner){
  return w.investmentProfiles.map(p=>{
    const saved=list(w.mindManifests).filter(m=>m.scope.profileId===p.id&&m.availableAt<=now).sort((a,b)=>a.data.version-b.data.version||a.availableAt.localeCompare(b.availableAt)).at(-1);
    if(saved)return saved;
    // This is the new runtime's explicit migration snapshot. The legacy engine
    // retains its pinned versions and single-instrument accounting.
    const created=w.profileVersions.find(v=>v.id===p.currentVersionId)?.createdAt??w.createdAt;
    const doc=exportMindPolicy(w,p.id,{now:created,actorId:'workspace-owner',instrumentIds:listInstruments().map(i=>i.id)});
    doc.id='manifest-'+p.id+'-baseline-v'+doc.data.version;
    doc.data.universe.selection={method:'jev',maxPositions:3,minQuoteVolume:0,minHistoryBars:32,rebalance:'manual'};
    return assertMindDocument(doc);
  });
}
function findManifest(w,mindId,now,owner){const m=baseManifests(w,now,owner).find(m=>m.scope.profileId===mindId);check(m,'MIND_NOT_FOUND','마인드를 선택하세요.',404);return m;}
function receipt(w,body,path){
  check(safeId(body.idempotencyKey)&&Number.isSafeInteger(body.expectedRevision),'INVALID_COMMAND','요청 키와 저장 버전을 확인하세요.');
  const fingerprint=hashInputPackage({path,input:Object.fromEntries(Object.entries(body).filter(([k])=>!['expectedRevision','idempotencyKey'].includes(k)))});
  const saved=w.commandReceipts.find(r=>r.key===body.idempotencyKey);
  if(saved){check(saved.studioFingerprint===fingerprint,'IDEMPOTENCY_CONFLICT','같은 요청 키의 입력이 변경되었습니다.',409);return {saved,fingerprint};}
  check(body.expectedRevision===w.revision,'REVISION_CONFLICT','자료가 갱신되었습니다. 새로고침 후 실행하세요.',409);return {saved:null,fingerprint};
}
async function commit(repository,owner,w,next,body,path,result,now,fingerprint,fence){
  next.revision=w.revision+1;next.updatedAt=now;
  next.commandReceipts.push({id:uniqueId('receipt'),key:body.idempotencyKey,type:'mind.studio',fingerprint,studioFingerprint:fingerprint,revision:next.revision,createdAt:now,result:clone(result)});
  next.activityEvents.push({id:uniqueId('event'),eventType:'MIND_STUDIO_CHANGED',resourceType:'mind-studio',resourceId:result.document?.id??result.run?.id??result.manifest?.id??result.selection?.id??'studio',occurredAt:now,actorId:'workspace-owner',payload:{path,requestKey:body.idempotencyKey}});
  const errors=validateWorkspace(next);check(!errors.length,errors[0]?.code??'INVALID_WORKSPACE',errors[0]?.message??'저장할 기록을 확인하세요.');
  await repository.commit(owner,w,next,body.idempotencyKey,fence);return {ok:true,revision:next.revision,...result};
}
function legacyDecision(r){
  const p=r.inputPackage??{},provider=p.marketProvider??'binance';
  return {id:r.id,instrumentId:provider==='okx'?BTC:LEGACY_INSTRUMENT,profileId:r.investmentProfileId,asOf:p.asOf,createdAt:r.createdAt,decision:r.decision,action:r.decision.action,stance:r.decision.stance,confidence:r.decision.confidence,experimentId:p.experimentId,experimentType:p.experimentType,source:provider,status:r.decisionStatus,rawRequest:r.jevRequest,rawResponse:r.jevResponse,model:r.decision.model,inputPackage:p,outcomeType:r.outcomeType,legacy:true};
}
function portableRecords(w,query){
  const records=[...w.decisionRecords.map(legacyDecision),...list(w.mindRuns)];
  return records.filter(r=>(!query.profileId||query.profileId==='all'||r.profileId===query.profileId)&&(!query.experimentId||r.experimentId===query.experimentId)).sort((a,b)=>String(b.createdAt??b.asOf).localeCompare(String(a.createdAt??a.asOf))).slice(0,300);
}
function terminalRecord(record){
  const state=record.rawRequest?.state,p=record.inputPackage??{};
  const before=record.accountSnapshot?.positions,after=record.execution?.accountSnapshotAfter?.positions;
  const quantityChange=Array.isArray(before)&&Array.isArray(after)?(after.find(p=>p.instrumentId===record.instrumentId)?.quantity??0)-(before.find(p=>p.instrumentId===record.instrumentId)?.quantity??0):null;
  return {id:record.id,instrumentId:record.instrumentId,profileId:record.profileId,asOf:record.asOf,timeframe:record.rawRequest?.state?.market?.timeframe??null,createdAt:record.createdAt,decisionAt:record.decisionAt??null,requestAt:record.provider?.startedAt??record.decisionAt??null,decisionCompletedAt:record.decisionCompletedAt??null,completedAt:record.decisionCompletedAt??null,decision:record.decision,rawResponse:record.rawResponse,provider:record.provider,model:record.model??record.provider?.model,referencePrice:p.marketSnapshot?.features?.close??state?.market?.features?.lastClose??null,ruleCount:state?list(state.rules??state.principles).length:null,memoryCount:state?list(state.approvedPersonalMemory??state.approvedMemory).length:null,externalKnowledgeCount:state?list(state.externalKnowledge).length:null,knowledgeSourceRefs:state?clone(state.knowledgeSelection?.transmittedSourceRefs??[]):[],profileVersionId:record.investmentProfileVersionId??state?.versionRefs?.profileVersionId??null,memoryVersionId:record.memoryVersionId??state?.versionRefs?.memoryVersionId??null,marketSource:{provider:record.marketSource?.provider??p.marketProvider??record.source??null},experimentType:record.experimentType,experimentId:record.experimentId??null,outcomeType:record.outcomeType??null,status:record.status,mode:record.mode??'replay',legacy:record.legacy??false,risk:record.risk,quantityChange,execution:record.execution?{status:record.execution.status,reason:record.execution.reason??null,retryable:record.execution.retryable===true,retryAction:record.execution.retryAction??null,errorCode:record.execution.errorCode??null,at:record.execution.at??null,quote:record.execution.quote?{price:record.execution.quote.price??null,asOf:record.execution.quote.asOf??null,receivedAt:record.execution.quote.receivedAt??null,source:record.execution.quote.source??null}:null,accountAsOf:record.execution.accountSnapshotAfter?.asOf??null,fee:record.execution.fee??0,quantity:record.execution.quantity??0,currency:record.execution.currency??null,outcomeRecord:record.execution.outcomeRecord??null}:null,observationState:record.observationState??null,observationDueAt:record.observationDueAt??null,hasObservation:Boolean(record.observation)};
}
function replayMarket(w,query,now){
  check(query.timeframe==='4h','REPLAY_TIMEFRAME','저장된 BTC 재생의 4시간봉을 선택하세요.');
  const group=query.comparisonId?w.comparisons.find(g=>g.id===query.comparisonId):list(w.comparisons).filter(g=>g.experimentType==='HISTORICAL_FUNCTIONAL_REPLAY'&&g.completedBars).at(-1);
  check(!query.comparisonId||group,'COMPARISON_NOT_FOUND','저장된 재생 운용을 선택하세요.',404);
  const records=portableRecords(w,{profileId:query.profileId,experimentId:group?.experimentId}).filter(r=>r.legacy&&r.experimentType==='HISTORICAL_FUNCTIONAL_REPLAY');
  const through=group?.history?.filter(h=>h.status==='COMPLETED').at(-1)?.asOf??records.map(r=>r.asOf).sort().at(-1)??new Date(historical.bars[1200][0]+14400000).toISOString();
  const bars=historical.bars.filter(b=>b[0]+14400000<=Date.parse(through)).slice(-240).map(b=>({openTime:new Date(b[0]).toISOString(),closeTime:new Date(b[0]+14400000).toISOString(),open:b[1],high:b[2],low:b[3],close:b[4],volume:b[5],isClosed:true}));
  return {status:'READY',instrument:{...getInstrument(BTC),id:LEGACY_INSTRUMENT,venue:'Binance',symbol:'BTCUSDT'},bars,quote:null,source:{provider:'binance-archive',url:historical.source?.url??null,availableAt:through,receivedAt:now,barsSha256:hashInputPackage(bars)},warnings:[],group,records,asOf:through};
}
function positionsFor(w,market,query){
  if(query.mode==='replay'&&market.group){
    try{const view=buildPortfolioView(w,{comparisonId:market.group.id,profileId:query.profileId??'all',view:'overview'},{now:query.now});
      return {positions:view.profiles.map(p=>({instrumentId:LEGACY_INSTRUMENT,profileId:p.profileId,quantity:p.btcQuantity,equity:p.equity,pnl:p.pnl,feesPaid:p.feesPaid,asOf:p.asOf,quoteCurrency:'USDT'})),mindSummaries:view.profiles.map(p=>({...p,quoteCurrency:'USDT'})),summary:{...view.summary,quoteCurrency:'USDT',hasPerformance:true},aggregationStatus:'COMMON_COMPLETED_CANDLE'};
    }catch{return {positions:[],mindSummaries:[]};}
  }
  const accounts=list(w.mindPositions).filter(p=>p.kind==='PAPER_ACCOUNT'&&p.quoteCurrency===market.instrument.quoteCurrency&&(!query.profileId||query.profileId==='all'||p.profileId===query.profileId));
  const companions=buildMindCompanions({workspace:w,minds:w.investmentProfiles.filter(p=>!query.profileId||query.profileId==='all'||p.id===query.profileId),executionMode:'paper',asOf:query.now}),summary=companions.summaries.find(s=>s.currency===market.instrument.quoteCurrency);
  const totals=summary&&Number.isFinite(summary.equity)?{equity:summary.equity,initialCapital:summary.initialCapital,feesPaid:summary.feesPaid,quoteCurrency:summary.currency,asOf:summary.asOf,hasPerformance:summary.hasPerformance,pnl:summary.hasPerformance?summary.netPnl:null,totalReturn:summary.hasPerformance?summary.netReturn:null,valuationStatus:summary.status}:null;
  const mindSummaries=accounts.map(a=>{const currency=companions.cards.find(c=>c.profileId===a.profileId)?.currencies.find(c=>c.accountIds.includes(a.id)),values=currency?.status==='STALE'?currency.lastSavedPerformance:currency;return {profileId:a.profileId,equity:values?.equity??null,cash:currency?.status==='DATA_REQUIRED'?null:a.cash,totalReturn:currency?.hasPerformance?values?.netReturn??null:null,pnl:currency?.hasPerformance?values?.netPnl??null:null,initialCapital:values?.initialCapital??null,hasPerformance:currency?.hasPerformance??false,quoteCurrency:a.quoteCurrency,asOf:values?.asOf??a.asOf,valuationStatus:currency?.status??'DATA_REQUIRED'};});
  return {accounts,positions:accounts.flatMap(a=>a.positions.filter(p=>p.instrumentId===market.instrument.id).map(p=>({...p,profileId:a.profileId,quoteCurrency:a.quoteCurrency,equity:p.marketValue,pnl:p.unrealizedPnl,feesPaid:a.feesPaid,asOf:a.asOf??a.updatedAt}))),mindSummaries,summary:totals,aggregationStatus:!accounts.length?'EMPTY_ACCOUNTS':totals?'COMMON_CURRENCY_AND_MARK':summary?.status==='DATA_REQUIRED'?'ACCOUNT_REVIEW_REQUIRED':'ASOF_ALIGNMENT_REQUIRED'};
}
export async function terminalModel(w,query,{now,clock=()=>now??new Date().toISOString(),env={},fetchImpl,marketLoader=loadInstrumentMarket}={}){
  check(['live','replay'].includes(query.mode??'live'),'INVALID_MODE','현재 시세 또는 저장된 재생을 선택하세요.');
  check(['paper','live'].includes(query.executionMode??'paper'),'INVALID_EXECUTION_MODE','모의 투자 또는 실전 조회를 선택하세요.');
  check(!query.profileId||query.profileId==='all'||w.investmentProfiles.some(p=>p.id===query.profileId),'MIND_NOT_FOUND','마인드를 선택하세요.',404);
  const manifests=baseManifests(w,now,'workspace-owner'),selected=manifests.find(m=>m.scope.profileId===query.profileId);
  const requestedId=query.instrumentId??BTC,universeResolution=selected?.data.universe.resolution,listed=currentTossCatalog(w,now)?.instruments.find(i=>i.id===requestedId),universeSnapshot=listed?{instruments:[listed]}:undefined;
  const mode=query.mode??'live',instrument=getInstrument(requestedId,{resolution:universeResolution,snapshot:universeSnapshot}),timeframe=query.timeframe??instrument.defaultTimeframe;
  let market;
  if(mode==='replay')market=replayMarket(w,{...query,timeframe},now);
  else try{
    const upbitStrategy=instrument.provider==='upbit'&&isMindStrategyPlanActive(selected?.data.strategyPlan,new Date(clock()).toISOString()),strategyHistory=upbitStrategy||selected?.data.strategyPlan?.scope?.instrumentPolicy==='UNIVERSE_CURRENT';
    const requiredBars=upbitStrategy?mindStrategyHistoryBars(selected,instrument):strategyHistory&&instrument.id!==BTC?Math.max(240,...selected.data.strategyPlan.graph.nodes.filter(n=>n.type==='SIGNAL').map(n=>Number(n.config.parameters.lookbackBars??n.config.parameters.window??0)+1)):240;
    market=await marketLoader({instrumentId:instrument.id,timeframe,limit:requiredBars,strategyHistory,env,fetchImpl,now:clock,universeResolution,universeSnapshot});
  }
  catch(error){if(!(error instanceof InstrumentMarketError))throw error;const failure=marketFailure(error,env);if(failure.status===400)throw error;market={status:'ERROR',instrument,timeframe,bars:[],quote:null,source:null,warnings:[{code:failure.payload.code,message:failure.payload.message}],error:failure.payload.message,diagnostic:failure.payload.diagnostic};}
  if(mode==='live')market={...market,instrument:{...market.instrument,...instrument}};
  const records=mode==='replay'?market.records:portableRecords(w,query).filter(r=>!r.legacy&&r.instrumentId===instrument.id&&r.mode==='live'&&r.rawRequest?.state?.market?.timeframe===timeframe);
  const finances={...positionsFor(w,market,{...query,mode,now}),instrumentPresentation:{...instrument,...market.instrument,price:mode==='live'?market.quote?.price??market.bars.at(-1)?.close??null:null,asOf:market.bars.at(-1)?.closeTime??null}};
  const activeNames=new Map(manifests.map(m=>[m.scope.profileId,m.data.name]));
  const profiles=w.investmentProfiles.map(p=>({id:p.id,name:activeNames.get(p.id)??p.name}));
  const ownerInstruments=new Map(listInstruments().map(i=>[i.id,i]));for(const manifest of manifests)for(const item of manifest.data.universe.resolution?.candidates??[])ownerInstruments.set(item.id,getInstrument(item.id,{resolution:manifest.data.universe.resolution}));
  if(selected)for(const item of selected.data.universe.resolution?.candidates??[])ownerInstruments.set(item.id,getInstrument(item.id,{resolution:selected.data.universe.resolution}));
  if(!selected&&listed)ownerInstruments.set(instrument.id,instrument);
  const visibleInstruments=selected?selected.data.universe.instrumentIds.map(id=>ownerInstruments.get(id)??getInstrument(id)):[...ownerInstruments.values()];
  const instruments=visibleInstruments.map(i=>({...i,price:i.id===instrument.id&&mode==='live'?market.quote?.price??market.bars.at(-1)?.close??null:null,asOf:i.id===instrument.id?market.bars.at(-1)?.closeTime??null:null,status:i.id===instrument.id?market.status:undefined}));
  const providerId=market.source?.provider??instrument.provider;
  const sourceLabel=mode==='replay'?'Binance · 저장된 재생':({'okx':'OKX','upbit':'업비트','toss':'토스증권','kis':'한국투자증권','naver-reference':'네이버 금융 · 참조 일봉'})[providerId]??providerId;
  const terminalReadiness=buildTerminalReadiness({workspace:w,manifest:selected??null,instrument,market,timeframe,mode,executionMode:query.executionMode??'paper',env,now:new Date(clock()).toISOString()});
  const runRequirement=terminalReadiness.executionReadiness.blockers[0]??null;
  return {
    instruments,selectedInstrumentId:instrument.id,legacyInstrumentId:mode==='replay'?LEGACY_INSTRUMENT:null,
    profiles,selectedMindId:query.profileId??'all',bars:market.bars,decisions:records.map(terminalRecord),timeframe,
    source:mode,sourceLabel,asOf:market.bars.at(-1)?.closeTime??null,sourceSnapshot:market.source,
    sources:[{id:'live',name:'현재 시세'},{id:'replay',name:'저장된 재생'}],supportedTimeframes:mode==='replay'?['4h']:market.connection?.supportedTimeframes??instrument.timeframes,
    ...finances,knowledge:list(w.mindDocuments).filter(d=>!selected||d.document.scope.profileId===selected.scope.profileId).map(d=>({id:d.id,title:d.document.title,status:d.status,kind:d.document.kind,asOf:d.document.asOf,profileId:d.document.scope.profileId,instrumentIds:clone(d.document.scope.instrumentIds),...(d.document.data.metrics?{metrics:{netReturn:d.document.data.metrics.netReturn,benchmarkReturn:d.document.data.metrics.benchmarkReturn,excessReturn:d.document.data.metrics.netReturn-d.document.data.metrics.benchmarkReturn,maxDrawdown:d.document.data.metrics.maxDrawdown}}:{})})),
    canRun:terminalReadiness.executionReadiness.canRun,runRequirement,terminalReadiness,
    status:market.status,error:market.error??(market.status==='CONNECT_REQUIRED'?'주식 시세를 조회하려면 증권 계좌를 연결하세요.':market.status==='UNSUPPORTED_TIMEFRAME'?'이 종목의 지원 주기를 선택하세요.':null),marketDiagnostic:market.diagnostic??null,marketReadAt:market.diagnostic?.receivedAt??market.source?.receivedAt??null,viewedAt:new Date(clock()).toISOString(),
    experimentLabel:mode==='replay'?market.group?.name??'저장된 BTC 실행':instrument.symbol+' · '+(selected?.data.name??'전체 마인드'),
    dataModeLabel:mode==='replay'?'과거 재생 · 당시 가격':instrument.assetClass==='equity'?'참조 일봉 · 실행 가격 연결 필요':'확정 캔들',
    marketInstrumentId:market.instrument.id,quoteCurrency:market.instrument.quoteCurrency,warnings:market.warnings,executionAllowed:false,
    latestRun:records.filter(r=>!r.legacy).map(terminalRecord)[0]??null,
  };
}
function templateExamples(manifest,now){
  const p=manifest.data.principles.find(p=>p.kind==='evidence')??manifest.data.principles[0],metrics={netReturn:0,benchmarkReturn:0,feesReturn:0,slippageReturn:0,maxDrawdown:0,benchmarkId:'SAME_PERIOD_BUY_HOLD'},period={start:new Date(Date.parse(now)-86400000).toISOString(),end:now};
  const envelope=kind=>({schemaVersion:1,id:uniqueId('draft'),kind,title:formCatalog.forms.find(f=>f.kind===kind).title,source:{type:'user',id:'workspace-owner',uri:null},asOf:now,availableAt:now,scope:clone(manifest.scope),principleRefs:[p.id],provenance:{createdAt:now,authorId:'workspace-owner',recordRefs:[],contentHashes:[],classification:null},data:{}});
  const examples={'mind-policy':clone(manifest)};examples['mind-policy'].id=uniqueId('draft');examples['mind-policy'].data.version++;
  if(!examples['mind-policy'].data.strategyPlan)examples['mind-policy'].data.strategyPlan=createMindStrategyPlan({planId:'strategy-'+manifest.scope.profileId.slice(0,120)+'-'+hashInputPackage({profileId:manifest.scope.profileId,scope:'BTC_SPOT_V1'}).slice(0,16)+'-btc-spot',enabled:false});
  const review=envelope('trade-review');review.data={decisionId:'SELECT_SAVED_DECISION',action:'hold',stance:'normal',period,metrics,regime:'unknown',thesis:'저장된 결정과 원본 자료를 연결하세요.',counterevidence:'반대 근거와 논제 훼손 조건을 작성하세요.',outcome:'unresolved',lessons:'결과 관측을 완료한 뒤 교훈을 작성하세요.',sourceRecordHash:'0'.repeat(64)};examples['trade-review']=review;
  const context=envelope('market-context');context.data={category:'macro',summary:'자료 출처와 공개 시점을 확인한 요약을 작성하세요.',observations:[{name:'관측값',value:'원본에서 확인',unit:'원본 단위',asOf:now,availableAt:now,sourceRef:'SOURCE_REFERENCE_REQUIRED'}],regime:'unknown',validUntil:null,uncertainty:'자료 누락과 지연 여부를 작성하세요.'};examples['market-context']=context;
  const evidence=envelope('principle-evidence');evidence.data={principleId:p.id,principleVersion:p.version,decisionId:'SELECT_SAVED_DECISION',period,metrics,regime:'unknown',direction:'unresolved',independenceGroup:'SOURCE_PERIOD_REQUIRED',experimentType:'FORWARD_PAPER',attribution:'observational',sourceRecordHash:'0'.repeat(64)};examples['principle-evidence']=evidence;
  examples['weight-proposal']=proposePrincipleWeight(manifest,p.id,[],{now});
  return formCatalog.forms.map(f=>({...f,schema:schemas[f.kind],...(f.kind==='mind-policy'?{referencedSchemas:{'strategy-plan.schema.json':strategyPlanSchema},draftEndpoint:'/api/workspace/mind-documents/policy-draft',strategyPlanDraftExample:{preset:'BTC_SPOT_V1',enabled:false,strategyMaxExposure:1}}:{}),...(v2schemas[f.kind]?{schemaVariants:{'1':schemas[f.kind],'2':v2schemas[f.kind]},automaticSource:'COMPLETED_AUTOMATIC_RUN'}:{}),example:examples[f.kind],exampleOnly:true}));
}
async function verifyDocumentScope(w,doc,now,owner='workspace-owner',db=null){
  check(w.investmentProfiles.some(p=>p.id===doc.scope.profileId),'DOCUMENT_PROFILE_SCOPE','이 계정의 마인드를 선택하세요.',403);
  doc.scope.instrumentIds.forEach(id=>{if(id!==LEGACY_INSTRUMENT)getInstrument(id);});check(doc.kind==='market-context'||doc.scope.instrumentIds.length>0,'DOCUMENT_INSTRUMENT_SCOPE','적용 종목을 선택하세요.');
  check(doc.asOf<=now,'FUTURE_DOCUMENT','현재까지 공개된 자료를 사용하세요.');
  const manifest=findManifest(w,doc.scope.profileId,now,'workspace-owner');
  check(doc.principleRefs.every(id=>manifest.data.principles.some(p=>p.id===id)||doc.kind==='mind-policy'&&doc.data.principles.some(p=>p.id===id)),'DOCUMENT_PRINCIPLE_SCOPE','마인드의 원칙 ID를 연결하세요.');
  if(doc.kind==='mind-policy'){doc.scope.instrumentIds.forEach(getInstrument);verifyStoredUniverseSources(w,doc,{asOf:now});check(!list(w.mindPositions).filter(a=>a.profileId===doc.scope.profileId).flatMap(a=>list(a.positions)).some(p=>p.quantity>0&&!doc.data.universe.instrumentIds.includes(p.instrumentId)),'UNIVERSE_HELD_POSITION','보유 중인 종목은 매도 후 투자 범위에서 제외하세요.',409);return;}
  if(['trade-review','principle-evidence'].includes(doc.kind)){
    const record=w.decisionRecords.find(r=>r.id===doc.data.decisionId&&r.investmentProfileId===doc.scope.profileId)??list(w.mindRuns).find(r=>r.id===doc.data.decisionId&&r.profileId===doc.scope.profileId);
    check(record,'DOCUMENT_RECORD_REQUIRED','이 마인드의 저장된 결정을 연결하세요.');
    if(record.automation){
      const originalManifest=w.mindManifests.find(m=>m.id===record.manifestId);
      assertAutomaticEvaluationSource(doc,{run:record,manifest:originalManifest,ownerId:owner,runEvidenceHash:mindRunEvidenceHash(record),now});
    }else check(doc.schemaVersion===1,'AUTO_EVALUATION_SOURCE_REQUIRED','버전 2 양식에는 저장된 자동 운용 관측을 연결하세요.');
    const recordHash=record.rawRequest?mindRunEvidenceHash(record):hashInputPackage(record);
    check(doc.data.sourceRecordHash===recordHash&&doc.provenance.contentHashes.includes(doc.data.sourceRecordHash)&&doc.provenance.recordRefs.includes(record.id),'DOCUMENT_RECORD_HASH','저장된 결정의 원본 해시와 연결을 확인하세요.');
    const evaluation=w.experiences.find(e=>e.decisionId===record.id&&e.status==='EVALUATED'&&e.evaluation&&e.observation);
    check(evaluation||record.observation,'EVALUATED_RECORD_REQUIRED','평가 완료된 경험에서 검토 양식을 생성하세요.');
    const actual=record.observation?{metrics:record.observation.metrics,period:record.observation.period}:experienceMetrics(evaluation);
    check(hashInputPackage(doc.data.metrics)===hashInputPackage(actual.metrics)&&hashInputPackage(doc.data.period)===hashInputPackage(actual.period),'DOCUMENT_METRICS_MISMATCH','원장의 실제 순수익률·기준수익률·관측 기간을 사용하세요.');
    if(doc.kind==='principle-evidence'){
      check(doc.data.experimentType===(record.inputPackage?.experimentType??record.experimentType),'DOCUMENT_EXPERIMENT_MISMATCH','원본 실행의 실험 유형을 사용하세요.');
      check(doc.data.attribution==='observational'||record.ablationEvidence?.validated===true,'CONTROLLED_ABLATION_SOURCE_REQUIRED','대조 실험의 검증 기록을 연결한 경우 통제 실험 귀속을 사용하세요.');
      if(record.rawRequest)check(record.rawRequest.state?.principles?.some(p=>p.id===doc.data.principleId&&p.version===doc.data.principleVersion),'PRINCIPLE_NOT_APPLIED','판단 당시 입력에 포함된 원칙 버전을 선택하세요.');
    }
  }
  if(doc.kind==='weight-proposal')fail('SYSTEM_PROPOSAL_REQUIRED','가중치 제안은 저장된 근거에서 계산하세요.');
  if(doc.kind==='market-context'){
    check(doc.data.observations.every(o=>doc.provenance.recordRefs.includes(o.sourceRef)),'CONTEXT_SOURCE_REQUIRED','각 관측의 실제 출처 ID를 연결하세요.');
    if(doc.source.type==='user'&&doc.data.category==='event'&&doc.source.id===doc.id&&doc.provenance.recordRefs.length===1&&doc.provenance.recordRefs[0]===doc.id&&doc.data.observations.every(o=>o.sourceRef===doc.id))return;
    if(doc.source.uri===null&&doc.data.category==='flow')await verifyInternalExecutionContext({db,owner,manifest,document:doc,asOf:now});
    else check(doc.source.uri,'CONTEXT_SOURCE_REQUIRED','외부 시장 자료의 원문 HTTPS 출처를 연결하세요.');
  }
}
function experienceMetrics(exp){
  const o=exp.observation,e=exp.evaluation;
  const p=o.performance??e.performance,netReturn=p?.netReturn,benchmarkReturn=p?.benchmarks?.buyAndHoldReturn;
  check(Number.isFinite(netReturn)&&Number.isFinite(benchmarkReturn)&&p.fixedDecision===true,'OBSERVATION_METRICS_REQUIRED','비용 후 계좌 수익률과 동기간 대조값을 가진 관측을 연결하세요.');
  const start=Date.parse(exp.occurredAt),end=Date.parse(o.asOf),bars=historical.bars.filter(b=>b[0]>=start&&b[0]+14400000<=end);
  check(exp.experimentType==='HISTORICAL_FUNCTIONAL_REPLAY'&&bars.length===(end-start)/14400000,'OBSERVATION_PATH_REQUIRED','자산곡선을 재계산할 원본 확정 봉을 준비하세요.');
  let peak=p.initialEquity,maxDrawdown=0;for(const bar of bars){const equity=p.endingCash+p.endingQuantity*bar[4];peak=Math.max(peak,equity);maxDrawdown=Math.max(maxDrawdown,peak>0?(peak-equity)/peak:0);}
  return {period:{start:exp.occurredAt,end:o.asOf},metrics:{netReturn,benchmarkReturn,feesReturn:p.feesPaid/p.initialEquity,slippageReturn:0,maxDrawdown,benchmarkId:'SAME_PERIOD_BUY_HOLD'}};
}

export async function handleMindStudioAPI(request,env={},options={}){
  const url=new URL(request.url),path=url.pathname;
  if(!PATHS.has(path)&&!(path==='/api/workspace/decisions/detail'&&url.searchParams.get('id')?.startsWith('mind-run-')))return null;
  const owner=request.headers.get('oai-authenticated-user-id');if(!owner)return json({ok:false,code:'UNAUTHORIZED',message:'로그인이 필요합니다.'},401);
  if(request.headers.get('Origin')&&request.headers.get('Origin')!==url.origin||request.headers.get('Sec-Fetch-Site')==='cross-site')return json({ok:false,code:'ORIGIN',message:'앱에서 다시 실행하세요.'},403);
  try{
    const now=nowISO(options),db=env.DB?.withSession?env.DB.withSession('first-primary'):env.DB,repo=new WorkspaceRepository(db);
    const w=await readOperationalWorkspace(repo,owner,()=>({...createWorkspace({now}),knowledge:importKnowledge(JSON.stringify(seed.knowledge))}));
    for(const key of MIND_COLLECTIONS)w[key]??=[];
    const marketLoader=options.marketLoader??createOwnerMarketResolver({repository:repo,owner,workspace:w});
    const manifests=baseManifests(w,now,owner);
    if(request.method==='GET'){
      if(path==='/api/workspace/strategy-library/item'){const id=url.searchParams.get('id'),entry=[...w.strategyModels,...w.mindPresets,...w.regimePrograms].find(v=>v.id===id);check(entry,'STRATEGY_LIBRARY_NOT_FOUND','저장한 버전을 선택하세요.',404);return json({ok:true,revision:w.revision,entry});}
      if(path==='/api/workspace/strategy-library')return json({ok:true,revision:w.revision,...strategyModelCatalog(w)});
      if(path==='/api/workspace/quant-strategies')return json({ok:true,revision:w.revision,...readQuantStrategyLibrary(w,url.searchParams,{manifests})});
      if(path==='/api/workspace/quant-strategies/item'){const result=readQuantStrategyItem(w,url.searchParams.get('id'),{manifests});Object.assign(result.usage,await quantStrategySimulationUsage(db,owner,result.entry));return json({ok:true,revision:w.revision,...result});}
      if(path==='/api/workspace/quant-strategies/usage'){const entry=quantStrategyEntry(w,url.searchParams.get('id'));return json({ok:true,revision:w.revision,id:entry.id,usage:{...quantStrategyUsage(w,entry,{manifests}),...await quantStrategySimulationUsage(db,owner,entry)}});}
      if(path==='/api/workspace/quant-strategies/export')return json({ok:true,revision:w.revision,...exportQuantStrategy(w,url.searchParams.get('id'),url.searchParams.get('format')??'json')});
      if(path==='/api/workspace/news-comparisons/source')return json({ok:true,revision:w.revision,...newsComparisonSources(w,url.searchParams.get('runId'))});
      if(path==='/api/workspace/news-comparisons')return json({ok:true,revision:w.revision,...readNewsComparisons(w,{ownerId:owner,...Object.fromEntries(url.searchParams)})});
      if(path==='/api/workspace/mind-subscriptions/history'){
        const subscription=w.mindSubscriptions.find(s=>s.id===url.searchParams.get('subscriptionId')&&s.ownerId===owner);check(subscription,'SUBSCRIPTION_NOT_FOUND','사용자 소유 운용을 선택하세요.',404);
        const offset=Number(url.searchParams.get('cursor')??0),limit=Number(url.searchParams.get('limit')??40);return json({ok:true,revision:w.revision,...await repo.readMindAttemptHistory(owner,subscription,{offset,limit})});
      }
      if(path==='/api/workspace/mind-subscriptions/recovery')return json(await mindSubscriptionRecovery(w,{repository:repo,ownerId:owner,subscriptionId:url.searchParams.get('subscriptionId'),now}));
      if(path==='/api/workspace/mind-subscriptions')return json({...mindSubscriptionCatalog(w,{ownerId:owner,now,mindId:url.searchParams.get('mindId')??'all',manifests}),runner:mindPaperRunnerStatus(db,owner,w,{now})});
      if(path==='/api/workspace/market-knowledge')return json({ok:true,...queryMarketKnowledge(w,url.searchParams,{manifests,asOf:now})});
      if(path==='/api/workspace/market-knowledge/forms')return json({ok:true,kind:'market-knowledge',schemaVersion:1,schema:marketKnowledgeSchema,example:marketKnowledgeExample(now),choices:KNOWLEDGE_CHOICES,sourceTypes:KNOWLEDGE_SOURCE_TYPES,defaultPolicy:disabledExternalKnowledge(),contract:{revision:'NEW_ID_NEXT_VERSION_IMMUTABLE_SOURCE',classification:'ACTUAL_JEV_OWNER_RELATED_APPROVED_PRIOR',approval:'OWNER_APP_REVIEW',novelty:'OWNER_APPROVED_RELATED_LIBRARY',pricedIn:'unknown',publication:'SOURCE_INSTANT_OR_LOCAL_DAY_END_BOUNDARY_V1',coverage:'GLOBAL_OR_EXPLICIT_INSTRUMENT_LIST_ELSE_ALL_PRESENT_AXES_AND'}});
      if(path==='/api/workspace/market-knowledge/item'||path==='/api/workspace/market-knowledge/export'){
        const entry=w.marketKnowledge.find(e=>e.id===url.searchParams.get('id'));check(entry,'KNOWLEDGE_NOT_FOUND','자료를 선택하세요.',404);
        if(path.endsWith('/export')){const format=url.searchParams.get('format')??'json';return json({ok:true,revision:w.revision,format,text:serializeMarketKnowledgeDocument(entry.document,{format}),document:entry.document,contentHash:entry.contentHash,classificationRecord:entry.classificationRecord,review:entry.review,filename:entry.id+'.'+format});}
        return json({ok:true,revision:w.revision,item:knowledgeItem(entry),entry,usage:marketKnowledgeUsage(w,entry,manifests,now)});
      }
      if(path==='/api/workspace/mind-valuations')return json(await buildMindValuation(w,url.searchParams,{now:()=>nowISO(options),fetchImpl:options.fetchImpl,readRevision:async()=>(await readOperationalWorkspace(repo,owner)).revision}));
      if(path==='/api/workspace/mind-memories')return json(buildMindMemoryView(w,{profileId:url.searchParams.get('profileId')??'all',manifests,now}));
      if(path==='/api/workspace/mind-library')return json(buildMindLibrary(w,url.searchParams,{now}));
      if(path==='/api/workspace/terminal'){const model=await terminalModel(w,Object.fromEntries(url.searchParams),{now,clock:()=>nowISO(options),env,fetchImpl:options.fetchImpl,marketLoader});return json({ok:true,revision:w.revision,model},200,model.marketDiagnostic?.retryAfter?{'Retry-After':model.marketDiagnostic.retryAfter}:{});}
      if(path==='/api/workspace/terminal/records'){const {buildTradingRecords}=await import('./trading-records.mjs');return json({ok:true,...buildTradingRecords(w,url.searchParams)});}
      if(path==='/api/workspace/terminal/observation'){
        const run=w.mindRuns.find(r=>r.id===url.searchParams.get('runId'));check(run,'RUN_NOT_FOUND','관측할 결정 기록을 선택하세요.',404);
        const {observeMindRun}=await import('./mind-observation.mjs');
        const manifest=w.mindManifests.find(m=>m.id===run.manifestId),account=run.execution?.accountSnapshotAfter;
        const horizonHours=Number(url.searchParams.get('horizonHours')??(run.automation?8:4)),value=observeMindRun({run,account,manifest,now,horizonHours}),saved=run.observationAvailability;
        const availability=value.status==='DATA_REQUIRED'&&saved?.status==='DATA_REQUIRED'&&saved.horizonHours===horizonHours&&saved.checkedAt<=now?saved:value;
        return json({ok:true,revision:w.revision,...(run.observation?{status:'OBSERVED',dueAt:run.observation.asOf,observation:run.observation,reasons:[]}:availability)});
      }
      if(path==='/api/workspace/decisions/detail'){
        const run=w.mindRuns.find(r=>r.id===url.searchParams.get('id'));check(run,'RECORD_NOT_FOUND','결정 기록을 선택하세요.',404);
        const pinned=w.mindManifests.find(m=>m.id===run.manifestId&&m.scope.profileId===run.profileId);let manifest=null;
        if(pinned)try{if(mindDocumentHash(pinned)===run.manifestHash)manifest=clone(pinned);}catch{}
        return json({ok:true,decision:{record:run,run,manifest,profile:w.investmentProfiles.find(p=>p.id===run.profileId),model:{actual:run.provider?.model,questions:run.rawResponse?.answers,usage:run.provider?.usage,processingMs:run.provider?.latencyMs},evidence:{memories:run.rawRequest?.state?.memories??[],rules:run.rawRequest?.state?.principles??[],questionCriteria:run.rawRequest?.questions},reproducibility:{asOf:run.asOf,manifestHash:run.manifestHash,marketDataRef:run.marketSource,requestId:run.provider?.requestId},fills:w.mindPositions.flatMap(account=>account.profileId===run.profileId?list(account.ledger).filter(fill=>fill.runId===run.id):[]),experiences:list(w.experiences).filter(experience=>experience.decisionId===run.id||experience.runId===run.id),candidates:[]}});
      }
      if(path==='/api/workspace/minds'){const tossConnection=await tossReadConnectionStatus(db,owner,env);return json({ok:true,revision:w.revision,minds:manifests.map(m=>({id:m.scope.profileId,name:m.data.name,manifestId:m.id,version:m.data.version,status:'PUBLISHED',archived:w.investmentProfiles.find(p=>p.id===m.scope.profileId)?.status==='ARCHIVED',archivedAt:w.investmentProfiles.find(p=>p.id===m.scope.profileId)?.archivedAt??null,manifest:m,strategyLearning:strategyGraphLearningSummary(m,w.mindRuns,{now,manifests:w.mindManifests})})),documents:w.mindDocuments.map(d=>({...d,kind:d.document.kind,title:d.document.title,scope:d.document.scope})),templates:templateExamples(manifests[0],now),connections:{jev:{configured:Boolean(env.TYPESAFE_API_KEY),model:JEV_MODEL},crypto:{provider:'OKX',mode:'PUBLIC_CONFIRMED_CANDLES'},koreanStocks:{status:tossConnection.collectAvailable?'CONFIGURED':'REFERENCE',provider:tossConnection.collectAvailable?'TOSS':env.KIS_APP_KEY&&env.KIS_APP_SECRET&&env.KIS_ACCESS_TOKEN?'KIS':'NAVER_REFERENCE',timeframe:'1d'},usStocks:{status:tossConnection.collectAvailable?'CONFIGURED':env.KIS_APP_KEY&&env.KIS_APP_SECRET&&env.KIS_ACCESS_TOKEN?'CONFIGURED':'CONNECT_REQUIRED',provider:tossConnection.collectAvailable?'TOSS':'KIS',timeframe:'1d'},macro:{status:'APPROVED_DOCUMENTS'},news:{status:'APPROVED_DOCUMENTS'},automation:{scope:'CANONICAL_USDT_SPOT',newMinds:'PORTFOLIO_4H_SUBSCRIPTIONS',instruments:['BTC-USDT','ETH-USDT','SOL-USDT','XRP-USDT'],maxActiveMinds:4}}});}
      if(path==='/api/workspace/universe/search')return json({ok:true,revision:w.revision,...searchUniverseCatalog(w,url.searchParams,{now,owner}),toss:await tossReadConnectionStatus(db,owner,env)});
      const manifest=findManifest(w,url.searchParams.get('mindId')??manifests[0]?.scope.profileId,now,owner);
      if(path==='/api/workspace/universe/catalog')return json({ok:true,revision:w.revision,...universeCatalog(w,manifest,{now,env}),toss:await tossReadConnectionStatus(db,owner,env)});
      if(path==='/api/workspace/mind-forms')return json({ok:true,templates:templateExamples(manifest,now)});
      if(path==='/api/workspace/minds/export'){const format=url.searchParams.get('format')??'json';return json({ok:true,format,filename:manifest.id+'.'+(format==='yaml'?'yaml':'json'),text:serializeMindDocument(manifest,{format}),document:manifest});}
      if(path==='/api/workspace/terminal/universe')return json({ok:true,manifestId:manifest.id,candidates:manifest.data.universe.instrumentIds.map(id=>getInstrument(id,{resolution:manifest.data.universe.resolution})),selection:manifest.data.universe.selection,selectedInstrumentId:w.mindSelections.filter(s=>s.profileId===manifest.scope.profileId).at(-1)?.selectedInstrumentId??null});
      return json({ok:false,message:'요청 경로를 확인하세요.'},404);
    }
    if(request.method!=='POST')return json({ok:false,message:'지원하는 요청 방식을 사용하세요.'},405);
    const body=await readBody(request);
    await repo.hydrateReceiptKeys(owner,w,[body.idempotencyKey]);
    if(['/api/workspace/mind-subscriptions/reconcile','/api/workspace/mind-subscriptions/recover','/api/workspace/mind-subscriptions/abandon'].includes(path))return json(await recoverMindSubscription({repository:repo,ownerId:owner,body,operation:path.split('/').at(-1),options}));
    if(path==='/api/workspace/mind-subscriptions/retry-execution'){
      check(Object.keys(body).every(k=>['subscriptionId','runId','expectedRevision','idempotencyKey'].includes(k))&&safeId(body.subscriptionId)&&safeId(body.runId),'INVALID_SUBSCRIPTION_COMMAND','운용과 저장된 결정 식별자를 확인하세요.',400);
      const prior=receipt(w,body,path);if(prior.saved)return json({ok:true,revision:w.revision,...prior.saved.result,idempotent:true});
      const recovered=await retryMindExecution({env,ownerId:owner,repository:repo,body,fingerprint:prior.fingerprint,options}),current=recovered.workspace;
      return json({...mindSubscriptionCatalog(current,{ownerId:owner,now:nowISO(options),mindId:current.mindSubscriptions.find(s=>s.id===body.subscriptionId).profileId,manifests:baseManifests(current,nowISO(options),owner)}),result:recovered.result,idempotent:recovered.result.idempotent});
    }
    if(path==='/api/workspace/mind-subscriptions/run-now'){
      check(Object.keys(body).every(k=>['subscriptionId','optInPaper','autoExecute','expectedRevision','idempotencyKey'].includes(k))&&body.optInPaper===true&&body.autoExecute===true,'SUBSCRIPTION_APPROVAL','현재 확정 봉의 모의 운용 실행을 확인하세요.',400);
      check(typeof body.subscriptionId==='string'&&typeof body.idempotencyKey==='string'&&body.idempotencyKey.length>=1&&body.idempotencyKey.length<=200,'INVALID_SUBSCRIPTION_COMMAND','운용과 실행 식별자를 확인하세요.',400);
      const prior=receipt(w,body,path);if(prior.saved)return json({ok:true,revision:w.revision,...prior.saved.result,idempotent:true});
      const result=await runMindPortfolioCycle({request,env,ownerId:owner,repository:repo,subscriptionId:body.subscriptionId,options,manualStart:true,manualCommand:{idempotencyKey:body.idempotencyKey,fingerprint:prior.fingerprint},deliverySource:'MANUAL'});let current=await readOperationalWorkspace(repo,owner);
      if(result.idempotent){const saved=clone(current);await commit(repo,owner,current,saved,body,path,{result},nowISO(options),prior.fingerprint);current=saved;}
      return json({ok:true,revision:current.revision,result,idempotent:result.idempotent,...mindSubscriptionCatalog(current,{ownerId:owner,now:nowISO(options),mindId:current.mindSubscriptions.find(s=>s.id===body.subscriptionId).profileId,manifests:baseManifests(current,nowISO(options),owner)})});
    }
    if(path.startsWith('/api/workspace/mind-subscriptions/')){
      const base=clone(w);for(const manifest of manifests)if(!base.mindManifests.some(m=>m.id===manifest.id))base.mindManifests.push(clone(manifest));
      const changed=dispatchMindSubscription(base,body,path.split('/').at(-1),{ownerId:owner,now});
      if(!changed.idempotent)await repo.commit(owner,w,changed.workspace,body.idempotencyKey);
      if(path.endsWith('/pause')&&!changed.idempotent){const {listInFlightClaims}=await import('./claims.mjs');const active=(await listInFlightClaims(db,{ownerId:owner,nowMs:Date.parse(nowISO(options))})).find(c=>c.resourceId==='mind-execution:'+changed.result.profileId);const attempt=changed.result.attempts.find(a=>a.key===active?.key&&['JEV_STARTED','COMPUTING','ACTION_REQUIRED'].includes(a.status));if(active&&attempt&&active.fingerprint===hashInputPackage({subscriptionId:changed.result.id,barCloseAt:attempt.barCloseAt,contract:changed.result.version}))await releaseClaim(db,{ownerId:owner,resourceId:active.resourceId,token:active.token,nowMs:Date.parse(nowISO(options)),status:'CANCELLED'}).catch(()=>{});}
      return json({...mindSubscriptionCatalog(changed.workspace,{ownerId:owner,now:nowISO(options),mindId:changed.result.profileId,manifests:baseManifests(changed.workspace,nowISO(options),owner)}),runner:mindPaperRunnerStatus(db,owner,changed.workspace,{now:nowISO(options)}),subscriptionId:changed.result.id,result:changed.result,idempotent:changed.idempotent});
    }
    const {saved,fingerprint}=receipt(w,body,path);if(saved)return json({ok:true,revision:w.revision,...saved.result,idempotent:true},saved.result?.httpStatus??200);
    const next=clone(w);for(const manifest of manifests)if(!next.mindManifests.some(m=>m.scope.profileId===manifest.scope.profileId))next.mindManifests.push(clone(manifest));let result;
    if(path==='/api/workspace/strategy-library/model'){
      result=saveStrategyModel(next,body,{manifest:findManifest(w,body.mindId,now,owner),now});
    }else if(path==='/api/workspace/strategy-library/preset'){
      result=saveMindPreset(next,body,{manifests,now});
    }else if((path==='/api/workspace/strategy-library/restore'||path==='/api/workspace/strategy-library/restore-model')){
      result=restoreMindPreset(next,body,{now,ownerId:owner});
    }else if(path==='/api/workspace/strategy-library/retire'){
      result=await retirePresetSources(next,body,{now,ownerId:owner,db,manifests});
    }else if(path==='/api/workspace/strategy-library/deployment'){
      result=prepareStrategyProgram(next,body,{now,ownerId:owner});
    }else if(path==='/api/workspace/strategy-library/program'){
      result=saveRegimeProgram(next,body,{now});
    }else if(path==='/api/workspace/accounts/budget'){
      check(Object.keys(body).every(k=>['quoteCurrency','totalBudget','expectedRevision','idempotencyKey'].includes(k)),'INVALID_BUDGET','모의 예산 입력을 확인하세요.');
      result={budget:configurePaperBudget(next,body,{now,id:uniqueId('budget')})};
    }else if(path==='/api/workspace/accounts/allocate'){
      check(Object.keys(body).every(k=>['mindId','quoteCurrency','amount','direction','expectedRevision','idempotencyKey'].includes(k)),'INVALID_ALLOCATION','자금 배정 입력을 확인하세요.');
      findManifest(w,body.mindId,now,owner);
      result=allocatePaperBudget(next,body,{now,id:uniqueId('funding')});
    }else if(path==='/api/workspace/quant-strategies/draft'){
      result=createQuantStrategyDraft(next,body,{ownerId:owner,now});
    }else if(path==='/api/workspace/quant-strategies/publish'){
      result=publishQuantStrategy(next,body,{ownerId:owner,now});
    }else if(path==='/api/workspace/news-comparisons/create'){
      check(Object.keys(body).every(k=>['runId','documentId','excerptText','repetitions','maxDecisionCalls','expectedRevision','idempotencyKey'].includes(k)),'NEWS_CREATE_INPUT','비교 대상과 호출 예산을 확인하세요.');
      const experiment=createNewsComparisonFromRun(w,body,{ownerId:owner,now});next.newsComparisons.push(experiment);result=readNewsComparisons(next,{ownerId:owner,id:experiment.id});
    }else if(path==='/api/workspace/news-comparisons/run'){
      check(Object.keys(body).every(k=>['id','snapshotId','variant','repetition','comparisonRevision','optInJev','expectedRevision','idempotencyKey'].includes(k)),'NEWS_RUN_INPUT','비교 군과 실제 호출 승인을 확인하세요.');
      return json(await runNewsComparison({workspace:w,repository:repo,ownerId:owner,body,env,fetchImpl:options.fetchImpl,clock:()=>nowISO(options),persistReservation:(reserved,result)=>commit(repo,owner,w,reserved,body,path,result,nowISO(options),fingerprint)}));
    }else if(path==='/api/workspace/universe/sources'){
      const collected=await collectUniverseSource(body,{now,clock:()=>nowISO(options),fetchImpl:options.fetchImpl,sleep:options.universeSleep,workspace:w,db,owner,env}),entry=collected.entry??collected;
      for(const chunk of collected.entries??[]){check(!next.universeSourceSnapshots.some(s=>s.id===chunk.id),'UNIVERSE_SOURCE_EXISTS','저장한 자료입니다. 목록을 새로고침하세요.',409);next.universeSourceSnapshots.push(chunk);}
      if(!collected.cached){check(!next.universeSourceSnapshots.some(s=>s.id===entry.id),'UNIVERSE_SOURCE_EXISTS','저장한 자료입니다. 목록을 새로고침하세요.',409);next.universeSourceSnapshots.push(entry);}result={cached:!!collected.cached,source:{id:entry.id,kind:entry.kind,importedAt:entry.importedAt,...(entry.kind==='TOSS_STOCK_CATALOG_SNAPSHOT'?{count:entry.snapshot.count,markets:entry.snapshot.markets.map(m=>({market:m.market,count:m.count})),asOf:entry.snapshot.asOf}:{}),...(entry.kind==='SECTOR_SNAPSHOT'?{sectorCount:entry.snapshot.sectors.length,rankingCount:entry.snapshot.rankings?.length??0,membershipCount:entry.snapshot.stockMemberships.length}:{} )},revision:w.revision+1};
    }else if(path==='/api/workspace/mind-documents/policy-draft'){
      const knowledgeInput=Object.hasOwn(body,'externalKnowledge'),strategyInput=Object.hasOwn(body,'strategyPlanDraft'),universeInput=Object.hasOwn(body,'universeDraft'),starterInput=Object.hasOwn(body,'starterId'),templateInput=Object.hasOwn(body,'strategyTemplate');
      check(Object.keys(body).every(k=>['mindId','newMind','externalKnowledge','strategyPlanDraft','universeDraft','starterId','strategyTemplate','sourceManifestId','expectedSourceManifestHash','expectedRevision','idempotencyKey'].includes(k))&&[knowledgeInput,strategyInput,universeInput,starterInput,templateInput].filter(Boolean).length===1,'POLICY_DRAFT_INPUT','자료 연결·전략·투자 범위 중 하나를 선택해 정책 초안을 작성하세요.');
      const creating=Object.hasOwn(body,'newMind');
      const starter=starterInput?PAPER_MIND_STARTERS.find(p=>p.id===body.starterId):null;
      if(starterInput)check(starter,'STRATEGY_STARTER_REQUIRED','시작 전략을 선택하세요.');
      let mindId=body.mindId;
      if(creating){
        check(starter&&body.newMind&&typeof body.newMind==='object'&&!Array.isArray(body.newMind)&&Object.keys(body.newMind).every(key=>['name','settings'].includes(key))&&['mindId','sourceManifestId','expectedSourceManifestHash'].every(key=>!Object.hasOwn(body,key)),'POLICY_DRAFT_INPUT','새 마인드 설정과 시작 전략을 확인하세요.');
        const created=dispatchWorkspaceAction(next,{type:'profile.create',payload:body.newMind,expectedRevision:w.revision,idempotencyKey:body.idempotencyKey},{now});
        // The studio commit records one receipt for both the profile and its policy.
        created.workspace.commandReceipts=next.commandReceipts;
        Object.assign(next,created.workspace);
        mindId=created.result.profile.id;
      }
      const latest=findManifest(creating?next:w,mindId,now,owner),current=Object.hasOwn(body,'sourceManifestId')?w.mindManifests.find(m=>m.id===body.sourceManifestId&&m.scope.profileId===mindId&&m.availableAt<=now):latest;
      check(current&&(!Object.hasOwn(body,'sourceManifestId')||(strategyInput||templateInput)&&Object.hasOwn(body,'expectedSourceManifestHash')),'POLICY_SOURCE_CHANGED','편집할 발행 전략 원본과 해시를 확인하세요.',409);const document=clone(current);
      if(Object.hasOwn(body,'expectedSourceManifestHash'))check(typeof body.expectedSourceManifestHash==='string'&&/^[a-f0-9]{64}$/.test(body.expectedSourceManifestHash)&&mindDocumentHash(current)===body.expectedSourceManifestHash,'POLICY_SOURCE_CHANGED','학습을 시작한 정책과 현재 발행 버전을 대조하세요.',409);
      if(creating)next.mindManifests.push(clone(latest));
      const policies=[...w.mindManifests,...w.mindDocuments.map(d=>d.document)].filter(d=>d.kind==='mind-policy'&&d.scope.profileId===mindId),maximumVersion=Math.max(current.data.version,...policies.map(d=>d.data.version));
      check(Number.isSafeInteger(maximumVersion)&&maximumVersion<Math.min(Number.MAX_SAFE_INTEGER,1e15-1),'MANIFEST_VERSION_LIMIT','정책 버전의 안전한 증가 범위를 확인하세요.',409);
      document.id=uniqueId('draft');document.asOf=now;document.availableAt=now;document.source={type:'user',id:owner,uri:null};
      document.provenance={...document.provenance,createdAt:now,authorId:owner,recordRefs:[...new Set([...document.provenance.recordRefs,current.id])],classification:null};
      document.data.version=maximumVersion+1;
      if(templateInput){
        const pin=body.strategyTemplate;check(pin&&Object.keys(pin).every(k=>['manifestId','manifestHash'].includes(k)),'POLICY_TEMPLATE','교체할 모델 원본을 확인하세요.');
        const template=w.mindManifests.find(m=>m.id===pin.manifestId&&m.availableAt<=now&&m.data.strategyPlan?.status==='APPROVED'&&m.data.strategyPlan.approval.enabled);
        check(template&&mindDocumentHash(template)===pin.manifestHash&&w.investmentProfiles.some(p=>p.id===template.scope.profileId&&p.status!=='ARCHIVED'),'POLICY_TEMPLATE_CHANGED','교체할 모델의 발행 버전과 해시를 확인하세요.');
        const version=document.data.version;document.data=clone(template.data);document.data.version=version;document.scope={...clone(template.scope),profileId:mindId};document.title=template.title;document.principleRefs=[...template.principleRefs];
        for(const principle of document.data.principles){const old=current.data.principles.find(p=>p.id===principle.id);if(old&&principle.version<=old.version&&hashInputPackage({title:old.title,text:old.text,kind:old.kind,bounds:old.bounds})!==hashInputPackage({title:principle.title,text:principle.text,kind:principle.kind,bounds:principle.bounds}))principle.version=old.version+1;}
        const planId=current.data.strategyPlan?.planId??'strategy-'+mindId,versions=policies.map(p=>p.data.strategyPlan).filter(p=>p?.planId===planId).map(p=>Number(/^v([1-9]\d*)$/.exec(p.planVersionId)?.[1]??0)),max=Math.max(0,...versions);
        check(Number.isSafeInteger(max)&&max<Math.min(Number.MAX_SAFE_INTEGER,1e15-1),'STRATEGY_PLAN_VERSION_LIMIT','전략 버전의 증가 범위를 확인하세요.');
        document.data.strategyPlan=draftMindStrategyPlan({...document.data.strategyPlan,planId,planVersionId:'v'+(max+1)});
        document.provenance.recordRefs=[...new Set([...document.provenance.recordRefs,template.id])];document.provenance.contentHashes=[...new Set([...document.provenance.contentHashes,mindDocumentHash(template),mindDocumentHash(current)])];
      }else if(starterInput){
        const graph=createPaperMindPresetGraph(starter.id),plan=createMindStrategyPlan({planId:'strategy-'+mindId,planVersionId:'v'+document.data.version,enabled:true,strategyMaxExposure:1});
        document.data.strategyPlan=strategyPlanWithGraph(plan,graph);if(document.data.strategyPlan.scope.instrumentId)document.data.strategyPlan.scope.instrumentPolicy='UNIVERSE_CURRENT';
        document.data.universe={mode:starter.universe.length>1?'allowlist':'single',instrumentIds:[...starter.universe],selection:{method:'strategy',maxPositions:starter.maxPositions,minQuoteVolume:0,minHistoryBars:starter.minHistoryBars??32,rebalance:starter.timeframe==='1h'?'1h-close':'4h-close',rebalanceEveryBars:starter.rebalanceEveryBars,exitUnselected:true}};
        document.scope.instrumentIds=[...starter.universe];document.data.profileSettings.horizon=starter.timeframe??'4h';document.data.trigger.interval=starter.timeframe??'4h';
        document.data.riskPreset={...document.data.riskPreset,normalBuyWeight:1,clutchBuyWeight:1,sellWeight:1,maxExposure:1,maxOrderWeight:1};
      }else if(universeInput){const built=buildUniverseDraft(w,current,body.universeDraft,{now,policyId:document.id+'-scope',version:document.data.version});document.data.universe=built.universe;document.scope.instrumentIds=[...built.universe.instrumentIds];next.universeSourceSnapshots.push({id:built.catalog.id,kind:built.catalog.kind,snapshot:built.catalog,importedAt:now,source:'APPLICATION_CATALOG'});}
      else if(knowledgeInput){check(body.externalKnowledge&&typeof body.externalKnowledge==='object'&&!Array.isArray(body.externalKnowledge),'POLICY_DRAFT_INPUT','자료 연결 설정 객체를 전달하세요.');document.data.externalKnowledge=clone(body.externalKnowledge);}
      else{
        const input=body.strategyPlanDraft;
        check(input&&typeof input==='object'&&!Array.isArray(input)&&Object.keys(input).every(k=>['preset','enabled','strategyMaxExposure','opportunityParameters','graph','instrumentPolicy'].includes(k))&&(!Object.hasOwn(input,'instrumentPolicy')||['FIXED','UNIVERSE_CURRENT','EACH_ASSET'].includes(input.instrumentPolicy))&&input.preset==='BTC_SPOT_V1'&&typeof input.enabled==='boolean'&&typeof input.strategyMaxExposure==='number'&&Number.isFinite(input.strategyMaxExposure)&&input.strategyMaxExposure>0&&input.strategyMaxExposure<=1&&!(Object.hasOwn(input,'graph')&&Object.hasOwn(input,'opportunityParameters')),'STRATEGY_PLAN_DRAFT_INPUT','전략 사용·종목 적용 방식과 0 초과 100% 이하 최대 비중을 입력하세요.');
        check(!Object.hasOwn(input,'opportunityParameters')||input.opportunityParameters&&typeof input.opportunityParameters==='object'&&!Array.isArray(input.opportunityParameters),'STRATEGY_PLAN_DRAFT_INPUT','기회 모듈의 등록된 전체 매개변수 객체를 전달하세요.');
        const planId=current.data.strategyPlan?.planId??'strategy-'+current.scope.profileId.slice(0,120)+'-'+hashInputPackage({profileId:current.scope.profileId,scope:'BTC_SPOT_V1'}).slice(0,16)+'-btc-spot';
        const plans=policies.map(p=>p.data.strategyPlan).filter(p=>p?.planId===planId),versions=plans.map(p=>/^v([1-9]\d*)$/.exec(p.planVersionId)).filter(Boolean).map(m=>Number(m[1])),maxPlanVersion=Math.max(0,...versions);
        check(Number.isSafeInteger(maxPlanVersion)&&maxPlanVersion<Number.MAX_SAFE_INTEGER,'STRATEGY_PLAN_VERSION_LIMIT','전략 버전의 안전한 증가 범위를 확인하세요.',409);
        const separateRiskPolicy=current.data.strategyPlan?.scope?.universe==='MIND_UNIVERSE'||current.data.strategyPlan?.graph?.nodes?.some(n=>n.type==='INPUT'&&n.config.kind==='MICROSTRUCTURE');
        const allocationExposure=separateRiskPolicy?current.data.strategyPlan.allocation.strategyMaxExposure:input.strategyMaxExposure;
        document.data.strategyPlan=createMindStrategyPlan({planId,planVersionId:'v'+(maxPlanVersion+1),enabled:input.enabled,strategyMaxExposure:allocationExposure,...(Object.hasOwn(input,'opportunityParameters')?{opportunityParameters:clone(input.opportunityParameters)}:{})});
        if(!separateRiskPolicy)document.data.riskPreset={...document.data.riskPreset,maxExposure:input.strategyMaxExposure};
        if(Object.hasOwn(input,'graph'))document.data.strategyPlan=strategyPlanWithGraph(document.data.strategyPlan,input.graph);
        else if(current.data.strategyPlan?.schemaVersion===2){let graph=clone(current.data.strategyPlan.graph);if(Object.hasOwn(input,'opportunityParameters')){const node=graph.nodes.find(n=>n.id===current.data.strategyPlan.allocation.opportunityNodeId);check(node?.type==='SIGNAL'&&node.config.moduleId==='OPPORTUNITY','STRATEGY_PLAN_DRAFT_INPUT','편집할 기회 집중 노드를 선택하세요.');node.config=createStrategyModule('OPPORTUNITY',{parameters:input.opportunityParameters,parametersVersionId:node.id+'-params-v'+(maxPlanVersion+1),required:node.config.required});if(graph.libraryBindings)graph=refreshQuantStrategyBindings(graph);}document.data.strategyPlan=strategyPlanWithGraph(document.data.strategyPlan,graph);}
        const instrumentPolicy=input.instrumentPolicy??current.data.strategyPlan?.scope?.instrumentPolicy??'FIXED';
        if(document.data.strategyPlan.scope.universe!=='MIND_UNIVERSE'&&instrumentPolicy==='UNIVERSE_CURRENT')document.data.strategyPlan.scope.instrumentPolicy=instrumentPolicy;
      }
      if(isDailyPortfolioGraph(document.data.strategyPlan?.graph))document.data.universe.selection=calendarPortfolioSelection(document.data.strategyPlan.graph,document.data.universe.selection,document.data.universe.instrumentIds.length);
      else if(isSurgePortfolioGraph(document.data.strategyPlan?.graph)){document.data.universe.selection={...document.data.universe.selection,method:'strategy',maxPositions:1,minHistoryBars:30,rebalance:'1m-close',rebalanceEveryBars:document.data.strategyPlan.graph.nodes.find(n=>n.type==='MODEL').config.policy.decisionEveryMinutes,exitUnselected:true};document.data.profileSettings.horizon='1m';document.data.trigger.interval='1m';}
      else if(isAdaptivePortfolioGraph(document.data.strategyPlan?.graph)){
        const g=document.data.strategyPlan.graph,r=g.nodes.find(n=>n.type==='PORTFOLIO_ROUTER').config,lookback=g.nodes.find(n=>n.type==='MARKET_STATE').config.lookback,capacity=g.nodes.filter(n=>n.type==='PORTFOLIO_EXPERT'&&n.config.mode!=='CASH').reduce((n,v)=>n+v.config.maxPositions,0);
        document.data.universe.selection={...document.data.universe.selection,method:'strategy',maxPositions:Math.min(document.data.universe.instrumentIds.length,capacity),minHistoryBars:lookback+r.trainingBars+r.horizonHours+2,rebalance:'1h-close',rebalanceEveryBars:1,exitUnselected:true};
      }
      syncLearningPolicyGraph(document);await applyLearningPolicyProvenance(w,document,{db,owner,pending:options.learningAdoption??null});assertMindDocument(document);verifyKnowledgePins(w.marketKnowledge,document.data.externalKnowledge);verifyQuantStrategyPins(w,document);
      next.mindDocuments.push({id:document.id,document,status:'DRAFT',importedAt:now,importedBy:owner,review:null,classificationRecord:null,sourceValidation:'POLICY_REVIEW_REQUIRED'});result={document};
    }else if(path==='/api/workspace/market-knowledge/save'&&body.documentId!==undefined){
      check(body.document===undefined&&body.text===undefined,'DOCUMENT_INPUT','기존 자료 ID 또는 새 문서 하나를 전달하세요.');
      const entry=next.marketKnowledge.find(e=>e.id===body.documentId);
      check(entry,'KNOWLEDGE_NOT_FOUND','저장할 자료를 선택하세요.',404);
      if(entry.status==='DRAFT')entry.status='SAVED';
      result={item:knowledgeItem(entry),document:entry.document};
    }else if(['/api/workspace/market-knowledge/write','/api/workspace/market-knowledge/save'].includes(path)){
      check((body.text!==undefined)!==(body.document!==undefined),'DOCUMENT_INPUT','문서 또는 텍스트 하나를 전달하세요.');
      const document=body.text!==undefined?parseMarketKnowledgeDocument(body.text,{format:body.format??'auto'}):clone(assertMarketKnowledgeDocument(body.document));
      check(document.asOf<=now&&document.data.publication.publishedAt<=now&&document.data.publication.retrievedAt<=now,'KNOWLEDGE_FUTURE','현재까지 공개·수집한 자료를 작성하세요.');
      check(/^[a-zA-Z0-9][a-zA-Z0-9_.:@-]{0,199}$/.test(document.id),'KNOWLEDGE_ID','자료 ID는 영문·숫자와 하이픈·밑줄·마침표·콜론·@으로 작성하세요.');
      document.scope.instrumentIds.forEach(id=>check(getInstrument(id).id===id,'KNOWLEDGE_INSTRUMENT','거래소를 포함한 정식 종목 ID를 사용하세요.'));verifyKnowledgeVersion(w.marketKnowledge,document);
      const entry={id:document.id,document,contentHash:marketKnowledgeHash(document),status:path.endsWith('/save')?'SAVED':'DRAFT',importedAt:now,importedBy:owner,availableAt:document.availableAt>now?document.availableAt:now,classificationRecord:null,review:null};
      next.marketKnowledge.push(entry);result={item:knowledgeItem(entry),document};
    }else if(path==='/api/workspace/market-knowledge/classify'){
      const entry=next.marketKnowledge.find(e=>e.id===body.documentId);check(entry,'KNOWLEDGE_NOT_FOUND','분류할 자료를 선택하세요.',404);
      check(['DRAFT','SAVED'].includes(entry.status)&&!entry.classificationRecord,'KNOWLEDGE_CLASSIFICATION_LOCKED','새 내용은 새로운 자료 버전으로 작성하세요.',409);
      const resourceId='knowledge-classification:'+entry.id,acquired=await acquireClaim(db,{ownerId:owner,resourceId,key:body.idempotencyKey,fingerprint,baseRevision:w.revision,nowMs:Date.parse(now),leaseMs:90000}),token=acquired.claim?.token??acquired.token;
      try{
        const {callMindJev}=await import('./mind-engine.mjs');
        const request={model:JEV_MODEL,state:{operation:'MARKET_KNOWLEDGE_CLASSIFICATION_V1',classificationAsOf:now,document:entry.document,contentHash:entry.contentHash,approvalStatus:'DRAFT',priorRelatedApproved:priorKnowledgeDigest(w.marketKnowledge,entry.document,now),noveltyBasis:'OWNER_APPROVED_RELATED_LIBRARY_AT_CLASSIFICATION_TIME',pricedIn:'unknown',coverageRouting:'EXPLICIT_DOCUMENT_COVERAGE_ONLY'},questions:buildKnowledgeClassificationQuestions()};
        const value=await callMindJev({request,env,fetchImpl:options.fetchImpl,clock:()=>nowISO(options)}),completedAt=nowISO(options);
        entry.classificationRecord={...value,contentHash:entry.contentHash,classification:knowledgeClassification(value,{priorDigest:request.state.priorRelatedApproved})};entry.availableAt=[entry.availableAt,completedAt].sort().at(-1);result={item:knowledgeItem(entry),classificationRecord:entry.classificationRecord};
        const committed=await commit(repo,owner,w,next,body,path,result,completedAt,fingerprint,{resourceId,token,nowMs:Date.parse(completedAt)});await completeClaim(db,{ownerId:owner,resourceId,token,nowMs:Date.parse(completedAt)});return json(committed);
      }catch(error){await releaseClaim(db,{ownerId:owner,resourceId,token,nowMs:Date.parse(nowISO(options)),status:'FAILED'}).catch(()=>{});throw error;}
    }else if(path==='/api/workspace/market-knowledge/publish'){
      const entry=next.marketKnowledge.find(e=>e.id===body.documentId);check(entry,'KNOWLEDGE_NOT_FOUND','검토할 자료를 선택하세요.',404);
      check(['DRAFT','SAVED'].includes(entry.status),'KNOWLEDGE_REVIEWED','검토 대기 자료를 선택하세요.',409);
      check(typeof body.reason==='string'&&body.reason.trim().length>=10&&body.reason.length<=2000,'REVIEW_REASON','공개 원문·적용 범위·공개 지연을 검토한 사유를 10자 이상 작성하세요.');
      check(entry.classificationRecord&&entry.classificationRecord.contentHash===entry.contentHash&&entry.contentHash===marketKnowledgeHash(entry.document),'KNOWLEDGE_CLASSIFICATION_REQUIRED','저장한 원문에 대한 실제 JEV 분류를 먼저 실행하세요.');
      check(entry.availableAt<=now,'KNOWLEDGE_NOT_AVAILABLE','자료의 사용 가능 시각 이후에 승인하세요.');
      entry.status='APPROVED';entry.review={reviewedBy:owner,reviewedAt:now,reason:body.reason.trim()};entry.availableAt=now;result={item:knowledgeItem(entry),document:entry.document};
    }else if(path==='/api/workspace/mind-documents'){
      check((body.text!==undefined)!==(body.document!==undefined),'DOCUMENT_INPUT','문서 또는 텍스트 하나를 전달하세요.');
      let document=body.text!==undefined?parseMindDocument(body.text,{format:body.format??'auto'}):clone(assertMindDocument(body.document));
      verifyQuantStrategyPins(w,document);await applyLearningPolicyProvenance(w,document,{db,owner});
      await verifyDocumentScope(w,document,now,owner,db);check(safeId(document.id),'DOCUMENT_ID','문서 ID에는 영문·숫자·하이픈·콜론을 사용하세요.');
      check(!w.mindDocuments.some(d=>d.id===document.id),'DOCUMENT_EXISTS','새 문서 ID를 사용하세요.',409);
      const importedHash=mindDocumentHash(document),claimedClassification=document.provenance.classification;
      if(document.kind==='mind-policy'&&document.data.strategyPlan)document.data.strategyPlan=draftMindStrategyPlan(document.data.strategyPlan);
      document.provenance.classification=null;document.availableAt=document.availableAt>now?document.availableAt:now;
      const entry={id:document.id,document,status:'DRAFT',importedAt:now,importedBy:owner,importedHash,claimedClassification,classificationRecord:null,review:null,sourceValidation:document.kind==='market-context'?(document.source.uri===null?'SAVED_EXECUTION_SOURCE_VERIFIED':'EXTERNAL_SOURCE_REVIEW_REQUIRED'):['trade-review','principle-evidence'].includes(document.kind)?'SAVED_RECORD_VERIFIED':'POLICY_REVIEW_REQUIRED'};
      next.mindDocuments.push(entry);result={document};
    }else if(path==='/api/workspace/mind-documents/classify'){
      const entry=next.mindDocuments.find(d=>d.id===body.documentId);check(entry,'DOCUMENT_NOT_FOUND','분류할 문서를 선택하세요.',404);
      await verifyDocumentScope(w,entry.document,now,owner,db);
      const {callMindJev,buildMindDocumentClassificationRequest}=await import('./mind-engine.mjs'),rawRequest=buildMindDocumentClassificationRequest(entry.document,{now}),originalHash=mindDocumentHash(entry.document);
      check(new TextEncoder().encode(JSON.stringify(entry)).length+new TextEncoder().encode(JSON.stringify(rawRequest)).length+260000+8000<=500000,'CLASSIFICATION_STORAGE_LIMIT','자료와 분류 원본의 저장 범위를 확인하세요.',413);
      const resourceId='mind-classification:'+entry.id,claim=await acquireClaim(db,{ownerId:owner,resourceId,key:body.idempotencyKey,fingerprint,baseRevision:w.revision,nowMs:Date.parse(now),leaseMs:90000}),token=claim.claim?.token??claim.token;let completed=false,providerResult=null;
      const fence=at=>({resourceId,token,nowMs:Date.parse(at)});
      try{
        providerResult=await callMindJev({request:rawRequest,env,fetchImpl:options.fetchImpl,clock:()=>nowISO(options)});
        const classifiedAt=nowISO(options),current=await readOperationalWorkspace(repo,owner),classified=clone(current),target=classified.mindDocuments.find(d=>d.id===entry.id);
        check(target&&target.status===entry.status&&mindDocumentHash(target.document)===originalHash,'CLASSIFICATION_DOCUMENT_CHANGED','분류 중 자료가 변경되었습니다. 저장된 호출 원본을 확인하세요.',409);
        await verifyDocumentScope(current,target.document,classifiedAt,owner,db);
        target.document=attachMindClassification(target.document,providerResult.rawResponse,{requestId:providerResult.provider.requestId,answeredAt:classifiedAt});target.classificationRecord={rawRequest,rawResponse:providerResult.rawResponse,provider:providerResult.provider};result={document:target.document};
        const committed=await commit(repo,owner,current,classified,body,path,result,classifiedAt,fingerprint,fence(classifiedAt));await completeClaim(db,{ownerId:owner,resourceId,token,nowMs:Date.parse(classifiedAt)});completed=true;return json(committed);
      }catch(error){
        if(providerResult&&!error.provider){error.provider=providerResult.provider;error.rawRequest=providerResult.rawRequest;error.rawResponse=providerResult.rawResponse;}
        const at=nowISO(options),providerFailure=captureMindProviderFailure(error,{attemptKey:body.idempotencyKey,now:at,env,maxBytes:64000});
        if(providerFailure){
          const current=await readOperationalWorkspace(repo,owner),failedNext=clone(current),eventId=uniqueId('event'),httpStatus=Number.isInteger(error.status)&&error.status>=400&&error.status<600?error.status:400;
          failedNext.activityEvents.push({id:eventId,eventType:'MIND_PROVIDER_FAILED',resourceType:'mind-document',resourceId:entry.id,occurredAt:at,actorId:owner,status:'failed',payload:{path,documentId:entry.id,profileId:entry.document.scope.profileId,sourceDocumentRef:rawRequest.state.sourceDocumentRef,requestKey:body.idempotencyKey,providerFailure}});
          const failed={ok:false,code:error.code??'MIND_JEV_FAILED',message:error.message,httpStatus,providerFailureEventId:eventId};
          return json(await commit(repo,owner,current,failedNext,body,path,failed,at,fingerprint,fence(at)),httpStatus);
        }
        throw error;
      }finally{if(!completed)await releaseClaim(db,{ownerId:owner,resourceId,token,nowMs:Date.parse(nowISO(options)),status:'FAILED'}).catch(()=>{});}
    }else if(path==='/api/workspace/mind-documents/publish'){
      const entry=next.mindDocuments.find(d=>d.id===body.documentId);check(entry,'DOCUMENT_NOT_FOUND','검토할 문서를 선택하세요.',404);
      check(typeof body.reason==='string'&&body.reason.trim().length>=10&&body.reason.length<=2000,'REVIEW_REASON','검토 사유를 10자 이상 작성하세요.');
      check(entry.status==='DRAFT','DOCUMENT_REVIEWED','검토 대기 문서를 선택하세요.',409);await verifyDocumentScope(w,entry.document,now,owner,db);
      const document=entry.document;entry.status='APPROVED';entry.review={reviewedBy:owner,reviewedAt:now,reason:body.reason.trim()};
      if(document.kind==='mind-policy'){
        await applyLearningPolicyProvenance(w,document,{db,owner});
        verifyKnowledgePins(w.marketKnowledge,document.data.externalKnowledge);
        verifyQuantStrategyPins(w,document);
        const previous=findManifest(w,document.scope.profileId,now,owner);check(document.data.version>previous.data.version,'MANIFEST_VERSION','현재 마인드보다 높은 버전을 작성하세요.');
        if(document.data.strategyPlan){const plan=document.data.strategyPlan;for(const m of w.mindManifests){const old=m.data.strategyPlan;if(old&&old.planId===plan.planId&&old.planVersionId===plan.planVersionId)check(strategyPlanHash(old)===strategyPlanHash(plan),'STRATEGY_PLAN_VERSION_REQUIRED','내용을 변경한 전략 계획의 버전 ID를 높이세요.',409);}document.data.strategyPlan=approveMindStrategyPlan(plan,{now,ownerId:owner});}
        check(!next.mindManifests.some(m=>m.id===document.id),'MANIFEST_ID_EXISTS','새 정책 버전에는 새로운 문서 ID를 사용하세요.',409);
        for(const principle of document.data.principles){const old=previous.data.principles.find(p=>p.id===principle.id);if(old&&hashInputPackage({title:old.title,text:old.text,kind:old.kind,bounds:old.bounds})!==hashInputPackage({title:principle.title,text:principle.text,kind:principle.kind,bounds:principle.bounds}))check(principle.version>old.version,'PRINCIPLE_VERSION','변경한 원칙의 버전을 높여 이전 근거를 보존하세요.',409);}
        document.availableAt=document.availableAt>now?document.availableAt:now;next.mindManifests.push(clone(document));result={manifest:document,document};
      }else result={document};
    }else if(path==='/api/workspace/terminal/accounts'){
      findManifest(w,body.mindId,now,owner);check(['USD','KRW','USDT','BTC'].includes(body.quoteCurrency),'ACCOUNT_CURRENCY','USD·KRW·USDT·BTC 중 계좌 통화를 선택하세요.');
      check(!w.mindPositions.some(a=>a.kind==='PAPER_ACCOUNT'&&a.profileId===body.mindId&&a.quoteCurrency===body.quoteCurrency),'PAPER_ACCOUNT_EXISTS','이 마인드와 통화의 모의계좌가 있습니다.',409);
      if(!paperBudgetFor(next,body.quoteCurrency))configurePaperBudget(next,{quoteCurrency:body.quoteCurrency,totalBudget:paperBudgetSummary(next,body.quoteCurrency).allocated+body.initialCash},{now,id:uniqueId('budget')});
      result=allocatePaperBudget(next,{mindId:body.mindId,quoteCurrency:body.quoteCurrency,amount:body.initialCash},{now,id:uniqueId('mind-account')});
    }else if(path==='/api/workspace/terminal/execute'){
      check(Object.keys(body).every(k=>['runId','expectedRevision','idempotencyKey'].includes(k)),'INVALID_MIND_COMMAND','저장된 결정과 요청 키를 전달하세요.');
      const run=w.mindRuns.find(r=>r.id===body.runId);check(run,'RUN_NOT_FOUND','저장된 결정을 선택하세요.',404);
      check(!run.automation||w.mindPositions.some(a=>a.receipts?.some(r=>r.runId===run.id)),'AUTO_EXECUTION_MANAGED','자동운용의 저장된 실행 상태를 확인하세요.',409);
      const resourceId='mind-execution:'+run.profileId,acquired=await acquireClaim(db,{ownerId:owner,resourceId,key:body.idempotencyKey,fingerprint,baseRevision:w.revision,nowMs:Date.parse(now),leaseMs:90000}),token=acquired.token;
      try{
        const manifest=findManifest(w,run.profileId,now,owner);
        result=await executeMindRun({workspace:w,next,run,manifest,fetchImpl:options.fetchImpl,clock:()=>nowISO(options)});
        const completedAt=nowISO(options),value=await commit(repo,owner,w,next,body,path,result,completedAt,fingerprint,{resourceId,token,nowMs:Date.parse(completedAt)});
        await completeClaim(db,{ownerId:owner,resourceId,token,nowMs:Date.parse(nowISO(options))});return json(value);
      }catch(error){await releaseClaim(db,{ownerId:owner,resourceId,token,nowMs:Date.parse(nowISO(options)),status:'FAILED'}).catch(()=>{});throw error;}
    }else if(path==='/api/workspace/terminal/evaluate'||path==='/api/workspace/terminal/select'){
      check(w.investmentProfiles.find(p=>p.id===body.mindId)?.status!=='ARCHIVED','MIND_ARCHIVED','마인드를 복원한 뒤 새 결정을 실행하세요.',409);
      check(Object.keys(body).every(k=>(path.endsWith('/select')?['mindId','mode','venue','quoteCurrency','expectedRevision','idempotencyKey']:['mindId','instrumentId','timeframe','mode','executionMode','expectedPolicyHash','expectedMarketAsOf','expectedRevision','idempotencyKey']).includes(k)),'INVALID_MIND_COMMAND','지원하는 마인드 실행 항목을 전달하세요.');
      check(body.executionMode===undefined||['paper','live'].includes(body.executionMode),'INVALID_EXECUTION_MODE','모의 투자 또는 실전 조회를 선택하세요.');
      check(body.executionMode!=='paper'||/^[a-f0-9]{64}$/.test(body.expectedPolicyHash??'')&&typeof body.expectedMarketAsOf==='string'&&Number.isFinite(Date.parse(body.expectedMarketAsOf)),'TERMINAL_VIEW_REQUIRED','현재 마인드 설정과 차트를 확인한 뒤 실행하세요.',409);
      const manifest=findManifest(w,body.mindId,now,owner),engine=await import('./mind-engine.mjs');
      check(body.mode===undefined||body.mode==='live','FORWARD_CONTEXT_REQUIRED','현재 확정 시세에서 새 마인드 결정을 실행하세요.');
      const last=w.mindRuns.filter(r=>r.profileId===body.mindId).at(-1);check(!last||Date.parse(now)-Date.parse(last.createdAt)>=manifest.data.trigger.cooldownMs,'MIND_COOLDOWN','다음 결정은 호출 간격이 지난 뒤 실행하세요.',429);
      const resourceId='mind-execution:'+body.mindId,acquired=await acquireClaim(db,{ownerId:owner,resourceId,key:body.idempotencyKey,fingerprint,baseRevision:w.revision,nowMs:Date.parse(now),leaseMs:90000});
      const token=acquired.claim?.token??acquired.token;
      try{
        if(path.endsWith('/select')){
          const screening=await prepareUniverseCandidates(manifest,{quoteCurrency:body.quoteCurrency??null,venue:body.venue??null,fetchImpl:options.fetchImpl,clock:()=>nowISO(options)});
          let screeningSourceRef=null;
          if(screening.sourceSnapshot){
            const {rawBody,...sourceMetadata}=screening.sourceSnapshot,rawBodyChunks=[];for(let at=0;at<rawBody.length;at+=12000)rawBodyChunks.push(rawBody.slice(at,at+12000));
            const snapshot={kind:'UPBIT_TICKER_SNAPSHOT',...clone(sourceMetadata),rawBodyEncoding:'UTF8_JOINED_CHUNKS_V1',rawBodyChunks};
            check(new TextEncoder().encode(JSON.stringify(snapshot)).length+1000<=500000,'UNIVERSE_TICKER_STORAGE_LIMIT','후보 원문이 저장 한도를 넘었습니다. 허용 종목 범위를 조정하세요.',413);
            const id='upbit-ticker-'+hashInputPackage(snapshot),entry={id,kind:'UPBIT_TICKER_SNAPSHOT',snapshot,importedAt:nowISO(options),source:'PROVIDER_CAPTURE'};
            check(new TextEncoder().encode(JSON.stringify(entry)).length<=500000,'UNIVERSE_TICKER_STORAGE_LIMIT','후보 원문이 저장 한도를 넘었습니다. 허용 종목 범위를 조정하세요.',413);
            if(!next.universeSourceSnapshots.some(e=>e.id===id))next.universeSourceSnapshots.push(entry);
            screeningSourceRef={id,kind:entry.kind,rawSha256:snapshot.rawSha256,url:snapshot.url,receivedAt:snapshot.receivedAt,parsedAt:snapshot.parsedAt,quoteCurrency:snapshot.quoteCurrency,timeBasis:snapshot.timeBasis};
          }
          const reasonCounts=screening.notQueried.reduce((counts,item)=>(counts[item.reason]=(counts[item.reason]??0)+1,counts),{});
          const screeningContext={policy:screening.rankingPolicy,universeResolutionRef:screening.universeResolutionRef,cohort:screening.cohort,cohortSelectionPolicy:screening.cohortSelectionPolicy??'EXISTING_ENGINE_FIRST_ELIGIBLE_COHORT_V1',sourceRef:screeningSourceRef,allowedCount:manifest.data.universe.instrumentIds.length,shortlistCount:screening.instrumentIds.length,notQueriedCount:screening.notQueried.length,notQueriedReasonCounts:reasonCounts,rankedCandidates:screening.ranking.filter(r=>screening.instrumentIds.includes(r.instrumentId))};
          const markets=[],marketErrors=[],strategyEvaluations={};let rateLimited=false;
          for(const id of screening.instrumentIds){
            const i=screening.instruments.find(item=>item.id===id)??getInstrument(id);
            if(manifest.data.strategyPlan?.approval.enabled&&id!==BTC&&manifest.data.strategyPlan.scope.instrumentPolicy!=='UNIVERSE_CURRENT'){markets.push({instrument:i,timeframe:i.defaultTimeframe,status:'NOT_QUERIED',bars:[],source:null,warnings:[{code:'STRATEGY_PLAN_SCOPE',message:'발행한 전략의 종목 범위를 확인하세요.'}]});continue;}
            if(rateLimited){markets.push({instrument:i,timeframe:i.defaultTimeframe,status:'NOT_QUERIED',bars:[],source:null,warnings:[{code:'QUERY_STOPPED_AFTER_RATE_LIMIT',message:'앞선 공급원 호출 제한 이후 추가 조회를 중단했습니다.'}]});continue;}
            try{const strategyHistory=manifest.data.strategyPlan?.scope?.instrumentPolicy==='UNIVERSE_CURRENT',limit=strategyHistory&&id!==BTC?Math.max(240,...manifest.data.strategyPlan.graph.nodes.filter(n=>n.type==='SIGNAL').map(n=>Number(n.config.parameters.lookbackBars??n.config.parameters.window??0)+1)):80;markets.push(await marketLoader({instrumentId:id,timeframe:i.defaultTimeframe,limit,strategyHistory,env,fetchImpl:options.fetchImpl,now:()=>nowISO(options),universeResolution:manifest.data.universe.resolution}));}
            catch(error){if(!(error instanceof InstrumentMarketError))throw error;marketErrors.push(error);rateLimited=error.diagnostic?.httpStatus===429;const failure=marketFailure(error,env);markets.push({instrument:i,timeframe:i.defaultTimeframe,status:'ERROR',bars:[],source:null,warnings:[{code:failure.payload.code,message:failure.payload.message}],diagnostic:failure.payload.diagnostic});}
          }
          if(!markets.some(m=>m.status==='READY')&&marketErrors.length)throw marketErrors[0];
          for(const market of markets.filter(m=>m.status==='READY')){const loaded=await loadMindStrategyFeatures({repository:repo,ownerId:owner,manifest,market,env,fetchImpl:options.fetchImpl,marketLoader,account:w.mindPositions.find(a=>a.kind==='PAPER_ACCOUNT'&&a.profileId===body.mindId&&a.quoteCurrency===market.instrument.quoteCurrency),now:()=>nowISO(options)});if(loaded.evaluation)strategyEvaluations[market.instrument.id]=loaded.evaluation;}
          const approved=w.mindDocuments.filter(d=>d.status==='APPROVED'&&d.document.scope.profileId===body.mindId&&d.document.availableAt<=nowISO(options));
          const selectionAt=nowISO(options),selectionInput={manifest,markets,strategyEvaluations,screeningContext,knowledge:w.marketKnowledge,contexts:approved.filter(d=>d.document.kind==='market-context'),memories:[...manifest.data.approvedMemory,...approved.filter(d=>['trade-review','principle-evidence'].includes(d.document.kind))],now:selectionAt,portfolios:w.mindPositions.filter(p=>p.kind==='PAPER_ACCOUNT'&&p.profileId===body.mindId)};
          check(!screening.sourceSnapshot||screening.ranking.filter(r=>screening.instrumentIds.includes(r.instrumentId)).every(r=>Date.parse(selectionAt)-Date.parse(r.asOf)<=30000),'UNIVERSE_SCREENING_EXPIRED','캔들 조회 중 후보 거래대금의 유효 시각이 지났습니다. 종목 선정을 다시 실행하세요.',409);
          const preparedRequest=engine.buildMindInstrumentRequest(manifest,markets,selectionInput),marketEvidence=engine.buildMindSelectionMarketEvidence(markets,preparedRequest),screeningRecord={...screeningContext,availableCohorts:screening.availableCohorts,notQueried:screening.notQueried,coverage:screening.coverage??null};
          // Bound both the selection object and the command receipt before the
          // paid request. The provider response reader has a 260KB ceiling.
          check(new TextEncoder().encode(JSON.stringify({rawRequest:preparedRequest,marketEvidence,candidateScreening:screeningRecord,marketCoverage:{...preparedRequest.state.marketCoverage,notQueried:screening.notQueried}})).length+260000+8000<=500000,'SELECTION_STORAGE_LIMIT','정책·자료와 후보 기록이 저장 한도를 넘었습니다. 평가 범위를 좁히세요.',413);
          const selected=await engine.pickMindInstrument({...selectionInput,env,fetchImpl:options.fetchImpl,clock:()=>nowISO(options)});
          const selectionCompletedAt=nowISO(options);
          const selection={...selected,id:uniqueId('mind-selection'),profileId:body.mindId,createdAt:now,completedAt:selectionCompletedAt,candidateScreening:screeningRecord,marketCoverage:{...selected.marketCoverage,notQueried:[...selected.marketCoverage.notQueried,...screening.notQueried],screeningCount:screening.instrumentIds.length}};
          check(new TextEncoder().encode(JSON.stringify(selection)).length<=500000&&new TextEncoder().encode(JSON.stringify({selection})).length+3000<=500000,'SELECTION_STORAGE_LIMIT','실제 선정 기록이 저장 한도를 넘었습니다. 원본 오류 기록을 확인하세요.',413);
          next.mindSelections.push(selection);result={selection};
        }else{
          const prepared=await prepareMindEvaluation({workspace:w,next,repository:repo,ownerId:owner,manifest,instrumentId:body.instrumentId,timeframe:body.timeframe??getInstrument(body.instrumentId).defaultTimeframe,marketLoader,env,fetchImpl:options.fetchImpl,clock:()=>nowISO(options),createdAt:now,executionMode:body.executionMode??'research',expectedPolicyHash:body.expectedPolicyHash??null,expectedMarketAsOf:body.expectedMarketAsOf??null});
          const staged=manifest.data.strategyPlan?.graph?.nodes.some(n=>n.type==='JEV_QUESTION'),provisionalPositions=next.mindPositions;
          const providerHooks=staged?createGraphProviderJournal({repository:repo,ownerId:owner,profileId:body.mindId,manifestHash:mindDocumentHash(manifest),executionKey:body.idempotencyKey,resourceId,token,workspace:w,clock:()=>nowISO(options),env,
            onPersist(saved){Object.assign(w,clone(saved));Object.assign(next,clone(saved));next.mindPositions=provisionalPositions;}
          }):null;
          result={run:await evaluatePreparedMind(prepared,{providerHooks})};

        }
        const completedAt=nowISO(options);
        const committed=await commit(repo,owner,w,next,body,path,result,completedAt,fingerprint,{resourceId,token,nowMs:Date.parse(completedAt)});await completeClaim(db,{ownerId:owner,resourceId,token,nowMs:Date.parse(completedAt)});return json(committed);
      }catch(error){
        try{
          const at=nowISO(options),providerFailure=captureMindProviderFailure(error,{attemptKey:body.idempotencyKey,now:at,env,maxBytes:64000});
          if(providerFailure){
            const failureNext=clone(w),eventId=uniqueId('event'),httpStatus=Number.isInteger(error.status)&&error.status>=400&&error.status<600?error.status:400;
            failureNext.activityEvents.push({id:eventId,eventType:'MIND_PROVIDER_FAILED',resourceType:'mind-studio',resourceId:body.mindId,occurredAt:at,actorId:owner,status:'failed',payload:{path,mindId:body.mindId,manifestId:manifest.id,instrumentId:body.instrumentId??null,requestKey:body.idempotencyKey,providerFailure}});
            const recovery=terminalErrorRecovery(error,{instrumentId:body.instrumentId??null,timeframe:body.timeframe??null,now:at});recovery.action.params={...recovery.action.params,eventId,profileId:body.mindId};
            const failed={ok:false,code:error.code??'MIND_JEV_FAILED',message:error.message,httpStatus,providerFailureEventId:eventId,recovery};
            const persisted=await commit(repo,owner,w,failureNext,body,path,failed,at,fingerprint,{resourceId,token,nowMs:Date.parse(at)});
            return json(persisted,httpStatus);
          }
        }finally{await releaseClaim(db,{ownerId:owner,resourceId,token,nowMs:Date.parse(nowISO(options)),status:'FAILED'}).catch(()=>{});}
        throw error;
      }
    }else if(path==='/api/workspace/terminal/observe'){
      const run=next.mindRuns.find(r=>r.id===body.runId);check(run,'RUN_NOT_FOUND','관측할 결정 기록을 선택하세요.',404);
      const internalFence=options[MIND_OBSERVATION_FENCE];if(internalFence)check(internalFence.ownerId===owner&&internalFence.runId===run.id,'OBSERVATION_FENCE_SCOPE','관측 실행의 소유 범위를 확인하세요.',403);
      const observationFence=()=>internalFence?{resourceId:internalFence.resourceId,token:internalFence.token,nowMs:Date.parse(nowISO(options))}:undefined;
      if(run.observation){check(run.observation.horizonHours===(body.horizonHours??(run.automation?8:4)),'OBSERVATION_WINDOW_LOCKED','보관된 관측 기간을 사용하세요. 다른 기간은 별도 관측 버전으로 관리합니다.',409);result={runId:run.id,status:'OBSERVED',dueAt:run.observation.asOf,reasons:[],observation:clone(run.observation),idempotent:true};return json(await commit(repo,owner,w,next,body,path,result,now,fingerprint,observationFence()));}
      const manifest=w.mindManifests.find(m=>m.id===run.manifestId),{observeMindRun}=await import('./mind-observation.mjs'),horizonHours=body.horizonHours??(run.automation?8:4);
      let observation=observeMindRun({run,account:run.execution?.accountSnapshotAfter,manifest,now,horizonHours});
      if(observation.status==='DATA_REQUIRED'){
        const saved=run.observationAvailability;
        if(saved?.status==='DATA_REQUIRED'&&saved.horizonHours===horizonHours&&saved.checkedAt<=now&&saved.sourceFailures?.some(f=>f.nextEligibleAt&&f.nextEligibleAt>now))observation=clone(saved);
        else{
          const instrument=getInstrument(run.instrumentId),timeframe=run.rawRequest?.state?.market?.timeframe??instrument.defaultTimeframe,sourceFailures=[];
          const load=async instrumentId=>{
            try{return await marketLoader({instrumentId,timeframe,limit:240,env,fetchImpl:options.fetchImpl,now:()=>nowISO(options)});}
            catch(error){if(!(error instanceof InstrumentMarketError))throw error;sourceFailures.push(observationSourceFailure(error,instrumentId,nowISO(options),env));return null;}
          };
          const market=await load(instrument.id),markets=[],otherIds=[...new Set([...(run.accountSnapshot?.positions??[]),...(run.execution?.accountSnapshotAfter?.positions??[])].filter(p=>p.quantity>0&&p.instrumentId!==instrument.id).map(p=>p.instrumentId))];
          if(market?.status==='READY')for(const instrumentId of otherIds){const value=await load(instrumentId);if(!value)break;markets.push(value);}
          observation=sourceFailures.length?{status:'DATA_REQUIRED',dueAt:observation.dueAt,reasons:sourceFailures.map(f=>({code:f.code,instrumentId:f.instrumentId,message:getInstrument(f.instrumentId).symbol+' 후속 시세: '+f.message})),sourceFailures,observation:null}:observeMindRun({run,account:run.execution?.accountSnapshotAfter,manifest,market,markets,now:nowISO(options),horizonHours});
        }
      }
      run.observationState=observation.status;run.observationDueAt=observation.dueAt;if(observation.observation){run.observation=observation.observation;delete run.observationAvailability;}else if(observation.status==='DATA_REQUIRED'){run.observationAvailability={...clone(observation),horizonHours,checkedAt:observation.checkedAt??nowISO(options)};observation=run.observationAvailability;}result={runId:run.id,...observation};
      try{return json(await commit(repo,owner,w,next,body,path,result,nowISO(options),fingerprint,observationFence()));}
      catch(error){
        // Rebase only the failed-source availability and its command receipt.
        // Successful calculations retain the normal revision-conflict policy.
        if(error.code!=='REVISION_CONFLICT'||observation.status!=='DATA_REQUIRED'||!observation.sourceFailures?.length)throw error;
        const current=await readOperationalWorkspace(repo,owner,undefined,[body.idempotencyKey]),prior=current.commandReceipts.find(r=>r.key===body.idempotencyKey);
        if(prior){check(prior.studioFingerprint===fingerprint,'IDEMPOTENCY_CONFLICT','같은 요청 키의 입력이 변경되었습니다.',409);return json({ok:true,revision:current.revision,...prior.result,idempotent:true});}
        const original=w.mindRuns.find(r=>r.id===run.id),savedRun=current.mindRuns.find(r=>r.id===run.id);
        check(savedRun&&mindRunEvidenceHash(savedRun)===mindRunEvidenceHash(original),'OBSERVATION_RUN_CHANGED','관측 대상의 실행 기록이 변경되었습니다. 최신 기록을 다시 조회하세요.',409);
        check(!savedRun.observation&&hashInputPackage(savedRun.observationAvailability??null)===hashInputPackage(original.observationAvailability??null),'OBSERVATION_STATE_CHANGED','관측 상태가 갱신되었습니다. 최신 결과를 다시 조회하세요.',409);
        const rebased=clone(current),target=rebased.mindRuns.find(r=>r.id===run.id);
        target.observationState=run.observationState;target.observationDueAt=run.observationDueAt;target.observationAvailability=clone(run.observationAvailability);
        return json(await commit(repo,owner,current,rebased,body,path,result,nowISO(options),fingerprint,observationFence()));
      }
    }else if(path==='/api/workspace/minds/weights/propose'){
      const manifest=findManifest(w,body.mindId,now,owner),evidence=w.mindDocuments.filter(d=>d.status==='APPROVED'&&d.document.kind==='principle-evidence'&&d.document.scope.profileId===body.mindId&&d.document.data.principleId===body.principleId).map(d=>d.document);
      for(const doc of evidence)await verifyDocumentScope(w,doc,now,owner,db);
      const document=proposePrincipleWeight(manifest,body.principleId,evidence,{now,actorId:owner,...(body.cohortKey?{cohortKey:body.cohortKey}:{})});next.mindDocuments.push({id:document.id,document,status:'DRAFT',importedAt:now,importedBy:owner,classificationRecord:null,review:null});result={document};
    }else if(path==='/api/workspace/minds/weights/approve'){
      const proposal=w.mindDocuments.find(d=>d.id===body.documentId)?.document;check(proposal?.kind==='weight-proposal','PROPOSAL_NOT_FOUND','가중치 제안을 선택하세요.',404);
      const manifest=findManifest(w,proposal.scope.profileId,now,owner),evidence=w.mindDocuments.filter(d=>d.status==='APPROVED'&&d.document.kind==='principle-evidence'&&proposal.data.evidenceIds.includes(d.id)).map(d=>d.document);
      for(const doc of evidence)await verifyDocumentScope(w,doc,now,owner,db);
      const value=approveWeightProposal(manifest,proposal,{actorId:owner,reason:body.reason,now,availableAt:body.availableAt,evidence});next.mindManifests.push(value.manifest);const entry=next.mindDocuments.find(d=>d.id===body.documentId);entry.status='APPROVED';entry.review=value.receipt;result=value;
    }else if(path==='/api/workspace/mind-documents/from-experience'){
      if(body.runId){
        const run=w.mindRuns.find(r=>r.id===body.runId);check(run?.observation,'OBSERVATION_REQUIRED','후속 확정 봉 관측을 완료한 결정을 선택하세요.');
        const manifest=w.mindManifests.find(m=>m.id===run.manifestId);check(manifest,'MANIFEST_NOT_FOUND','결정 당시 정책 버전을 확인하세요.',404);
        const kind=body.kind??'trade-review';check(['trade-review','principle-evidence'].includes(kind),'FORM_KIND','거래 검토 또는 원칙별 근거 양식을 선택하세요.');
        const document=clone(templateExamples(manifest,now).find(f=>f.kind===kind).example),observation=run.observation;
        document.id=uniqueId('document');document.title=getInstrument(run.instrumentId).symbol+' '+(kind==='trade-review'?'거래 검토':'원칙별 근거');document.scope.instrumentIds=[run.instrumentId];
        document.provenance.recordRefs=[run.id];document.provenance.contentHashes=[mindRunEvidenceHash(run),hashInputPackage(observation)];document.source={type:'system-export',id:run.id,uri:null};
        document.data={...document.data,decisionId:run.id,period:clone(observation.period),metrics:clone(observation.metrics),sourceRecordHash:mindRunEvidenceHash(run)};
        if(kind==='principle-evidence'){
          const principle=manifest.data.principles.find(p=>p.id===(body.principleId??document.data.principleId));check(principle&&run.rawRequest.state.principles.some(p=>p.id===principle.id&&p.version===principle.version),'PRINCIPLE_NOT_APPLIED','당시 입력에 포함된 원칙 버전을 선택하세요.');
          document.principleRefs=[principle.id];Object.assign(document.data,{principleId:principle.id,principleVersion:principle.version,experimentType:run.experimentType,attribution:'observational',independenceGroup:run.instrumentId+':'+observation.period.start,direction:'unresolved'});
        }else Object.assign(document.data,{action:run.decision.action,stance:run.decision.stance,outcome:observation.metrics.netReturn>0?'win':observation.metrics.netReturn<0?'loss':'flat',thesis:'저장된 JEV 선택과 적용 원칙을 검토한다.',counterevidence:'대조 성과와 국면별 반례를 원본에서 확인한다.',lessons:'확정 봉 관측과 비용 후 계좌 성과를 바탕으로 교훈을 작성한다.'});
        if(run.automation){
          document.schemaVersion=2;
          if(kind==='trade-review')document.principleRefs=manifest.data.principles.filter(p=>run.rawRequest.state.principles.some(actual=>actual.id===p.id&&actual.version===p.version)).map(p=>p.id);
          document.evaluation=buildAutomaticEvaluation({run,manifest,runEvidenceHash:mindRunEvidenceHash(run),principleIds:document.principleRefs});
          if(kind==='principle-evidence'){const tag=document.evaluation.cohorts.find(c=>c.tag.principleId===document.data.principleId)?.tag;check(tag,'AUTO_EVALUATION_PRINCIPLES','원칙의 실제 관측 코호트를 연결하세요.');document.data.regime=tag.marketRegime;document.data.independenceGroup=tag.opportunityGroupId;}
        }
        assertMindDocument(document);await verifyDocumentScope(w,document,now,owner,db);next.mindDocuments.push({id:document.id,document,status:'DRAFT',importedAt:now,importedBy:owner,review:null});result={document};
        return json(await commit(repo,owner,w,next,body,path,result,now,fingerprint));
      }
      const exp=w.experiences.find(e=>e.id===body.experienceId&&e.status==='EVALUATED'),record=w.decisionRecords.find(r=>r.id===exp?.decisionId);check(exp&&record,'EVALUATED_RECORD_REQUIRED','평가 완료된 투자 경험을 선택하세요.');
      const manifest=findManifest(w,record.investmentProfileId,now,owner),examples=templateExamples(manifest,now),kind=body.kind??'trade-review';check(['trade-review','principle-evidence'].includes(kind),'FORM_KIND','거래 검토 또는 원칙별 근거 양식을 선택하세요.');
      const document=clone(examples.find(f=>f.kind===kind).example),actual=experienceMetrics(exp);document.id=uniqueId('document');document.scope.experimentId=record.inputPackage.experimentId;document.scope.instrumentIds=[(record.inputPackage.marketProvider??'binance')==='binance'?LEGACY_INSTRUMENT:BTC];document.provenance.recordRefs=[record.id,exp.id];document.provenance.contentHashes=[hashInputPackage(record),hashInputPackage(exp)];document.data={...document.data,...actual,decisionId:record.id,sourceRecordHash:hashInputPackage(record)};if(kind==='principle-evidence'){document.data.experimentType=record.inputPackage.experimentType;document.data.independenceGroup=record.inputPackage.experimentId+':'+actual.period.start;}else{document.data.action=record.decision.action;document.data.stance=record.decision.stance;}
      assertMindDocument(document);next.mindDocuments.push({id:document.id,document,status:'DRAFT',importedAt:now,importedBy:owner,review:null});result={document};
    }else return json({ok:false,message:'요청 경로를 확인하세요.'},404);
    const committed=await commit(repo,owner,w,next,body,path,result,now,fingerprint);
    const document=result.document,entry=document&&next.mindDocuments.find(d=>d.id===document.id);
    if(env.APP_NOTIFY&&entry?.status==='DRAFT'&&!w.mindDocuments.some(d=>d.id===document.id)){
      try{await env.APP_NOTIFY(owner,{id:'document-review:'+hashInputPackage({id:document.id}),title:('검토 요청 · '+document.title).slice(0,200),body:'저장한 자료와 변경 내용을 확인하세요. 알림에서 해당 자료의 정식 검토 화면을 엽니다.',status:'INFO',createdAt:now,documentId:document.id});}
      catch{committed.notificationWarning='자료는 저장됐습니다. 알림 저장을 다시 확인하세요.';}
    }
    return json(committed);
  }catch(error){if(error instanceof UniverseCandidateError)return json({ok:false,code:error.code,message:error.message,errorSource:'MARKET_PROVIDER',diagnostic:{provider:'upbit',httpStatus:error.httpStatus??null,retryAfter:error.retryAfter??null},...(error.notQueried?{notQueried:error.notQueried}:{})},error.status,error.retryAfter?{'Retry-After':error.retryAfter}:{});if(error instanceof InstrumentMarketError){const failure=marketFailure(error,env);return json(failure.payload,failure.status,failure.payload.diagnostic?.retryAfter?{'Retry-After':failure.payload.diagnostic.retryAfter}:{});}return json({ok:false,code:error.code??'MIND_STUDIO_ERROR',message:error.code?error.message:'요청을 완료하지 못했습니다. 연결 상태와 저장 자료를 확인하세요.',...(error.path?{path:error.path}:{}),...(error.terminalReadiness?{terminalReadiness:error.terminalReadiness}:{}),...(error.recovery?{recovery:error.recovery}:{}),...(Number.isSafeInteger(error.currentRevision)?{currentRevision:error.currentRevision}:{}),...(error.code==='MIND_REQUIRED_INPUTS_UNAVAILABLE'?{blockedInputs:error.blockedInputs,inputRequirementPolicy:error.inputRequirementPolicy}:{})},error.status??400);}
}
