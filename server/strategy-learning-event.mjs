import {JEV_EXECUTION_CALL_LIMIT} from '../dist/domain/jev-question.mjs';
import {hashInputPackage} from '../dist/domain/workspace.mjs';
import {researchSha256} from '../dist/domain/research.mjs';
import {mindDocumentHash} from '../dist/domain/mind-manifest.mjs';
import {strategyGraphHash,graphRequiresJev} from '../dist/domain/strategy-graph.mjs';
import {createEventPaperAccount,getEventPaperReport} from '../dist/domain/event-paper-execution.mjs';
import {observedAccountFeeSchedule} from '../dist/domain/connectors.mjs';
import {prepareEventStrategyFrame} from '../dist/domain/event-strategy-runtime.mjs';
import {createMultiEventCampaignState,prepareMultiEventFrame,multiEventSourcePins,eventDatasetInstrument} from '../dist/domain/event-campaign-runtime.mjs';
import {STRATEGY_LEARNING_VERSION} from '../dist/domain/strategy-learning.mjs';
import {getEventDataset,listEventDatasets} from './event-market-datasets.mjs';
import {eventSimulationCapabilities,restoreEventSimulationCheckpoint} from './event-simulation-engine.mjs';
import {multiEventSimulationCapabilities,restoreMultiEventCheckpoint} from './multi-asset-event-simulation.mjs';

const clone=structuredClone,check=(ok,code,message)=>{if(!ok)throw Object.assign(new Error(message),{code,status:409});};
const same=(a,b)=>hashInputPackage(a)===hashInputPackage(b),near=(a,b)=>Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<=Math.max(1e-8,Math.abs(b)*1e-10);
const freeze=v=>{if(v&&typeof v==='object'&&!Object.isFrozen(v)){Object.values(v).forEach(freeze);Object.freeze(v);}return v;};
const seal=v=>freeze({...v,hash:hashInputPackage(v)}),time=t=>new Date(t).toISOString();
const Q=10n**18n,signedUnits=v=>{const s=String(v);return s.startsWith('-')?-units(s.slice(1)):units(s);},units=v=>{const s=String(v);check(/^\d+(\.\d{1,18})?$/.test(s),'LEARNING_EVENT_AMOUNT','원장의 정확한 양수 금액을 확인하세요.');const [a,b='']=s.split('.');return BigInt(a)*Q+BigInt(b.padEnd(18,'0'));};
const decimal=v=>(v<0n?'-':'')+(v<0n?-v:v)/Q+'.'+((v<0n?-v:v)%Q).toString().padStart(18,'0');

export function eventLearningCallLimit(plan,candidate,phase){
 const w=phase==='TRAIN'?plan.training:plan.validation,frames=(Date.parse(w.endAt)-Date.parse(w.startAt))/plan.stepMs+1;
 return graphRequiresJev(candidate.graph)?frames*candidate.graph.nodes.filter(n=>n.type==='JEV_QUESTION').length:0;
}

/** Source selection reads immutable local bindings; it never fetches or constructs market history. */
export async function resolveStrategyLearningEventSource(input,{env={},options={},createdAt=null}={}){
 if(!input)return null;
 const multi=input.assetMode==='UPBIT_EVENT_UNIVERSE',keys=multi?['assetMode','datasetIds']:['assetMode','datasetId'];
 check(input&&['UPBIT_EVENT_STREAM','UPBIT_EVENT_UNIVERSE'].includes(input.assetMode)&&Object.keys(input).every(k=>keys.includes(k))&&keys.every(k=>Object.hasOwn(input,k)),'LEARNING_EVENT_SOURCE','저장된 단일 또는 다종목 호가·체결 자료를 선택하세요.');
 const ids=multi?input.datasetIds:[input.datasetId];check(Array.isArray(ids)&&ids.length>=(multi?2:1)&&ids.length<=(multi?20:1)&&ids.every(id=>typeof id==='string'&&id.length>0)&&new Set(ids).size===ids.length,'LEARNING_EVENT_SOURCE','서로 다른 실측 자료를 선택하세요.');
 const datasets=await Promise.all(ids.map(id=>getEventDataset(id,{...options,env}))),first=datasets[0];
 check(datasets.every(d=>d.timeframe===first.timeframe&&d.market.split('-')[0]===first.market.split('-')[0]&&(!createdAt||d.availableAt<=createdAt)),'LEARNING_EVENT_SOURCE','같은 분봉·통화이며 연구 시작 전에 보관한 실측 자료를 선택하세요.');
 const pins=multiEventSourcePins(datasets),frozenInputs=multi?{contractVersion:'canonical-multi-asset-event-v1',sources:pins}:{contractVersion:'EVENT_SOURCE_PREFIX_V1',datasetId:first.id,datasetSha256:first.sourceHash,feeSnapshotHash:hashInputPackage(first.feeSnapshot),rulesHash:hashInputPackage(first.rules),policy:'EVENT_RECEIVED_AND_CLOSED_BAR_AVAILABLE_AT_OR_BEFORE_DECISION'};
 // Use the execution engine's source identity, including the per-symbol fee and rule pins.
 if(multi){const {MULTI_ASSET_EVENT_VERSION}=await import('../dist/domain/multi-asset-event-runtime.mjs');frozenInputs.contractVersion=MULTI_ASSET_EVENT_VERSION;}
 return {source:{...clone(input),timeframe:first.timeframe,quoteCurrency:first.market.split('-')[0]},datasets,frozenInputs,datasetHash:multi?hashInputPackage(pins):first.sourceHash};
}

export async function strategyLearningEventSources({env={},options={}}={}){
 const datasets=await listEventDatasets({...options,env});return {contractVersion:'STRATEGY_LEARNING_SOURCES_V1',legacy:{assetMode:'BTC_USDT_4H',timeframe:'4h'},event:{assetModes:['UPBIT_EVENT_STREAM','UPBIT_EVENT_UNIVERSE'],datasets,maxCandidates:12,maxJevCallsPerChild:JEV_EXECUTION_CALL_LIMIT,minimumClosedTrades:1,zeroTradeResult:'NO_EVIDENCE',researchRole:'RETROSPECTIVE_DEVELOPMENT',adoptionAuthority:'DRAFT_ONLY'}};
}

export async function preflightEventStrategyLearning({plan,sourceManifest,eventSource,env={},options={},now,owner}){
 const items=[];
 for(const phase of ['TRAIN','VALIDATION'])for(const candidate of plan.candidates){
  const window=phase==='TRAIN'?plan.training:plan.validation,limit=eventLearningCallLimit(plan,candidate,phase);
  check(limit<=JEV_EXECUTION_CALL_LIMIT,'LEARNING_CHILD_BUDGET','분봉 후보별 실제 JEV 호출은 10000회 이내로 설정하세요.');
  check(new TextEncoder().encode(JSON.stringify(candidate.graph)).length<=100000,'LEARNING_GRAPH_SIZE','후보의 그래프와 지침을 100KB 이내로 구성하세요.');
  const b={...Object.fromEntries(Object.entries(plan.source).filter(([k])=>!['timeframe','quoteCurrency'].includes(k))),mindId:sourceManifest.scope.profileId,mode:'GRAPH_CANONICAL',...window,...plan.simulation,optInJev:graphRequiresJev(candidate.graph),maxJevCalls:limit,labSpec:{preset:'CURRENT',graph:candidate.graph,knowledge:false}},w={revision:0,mindManifests:[sourceManifest]},c={env,options,owner,clock:()=>now,loadWorkspace:async()=>w,activeManifest:()=>sourceManifest,simulationDraftArm:()=>null};
  const multi=plan.source.assetMode==='UPBIT_EVENT_UNIVERSE',cap=await (multi?multiEventSimulationCapabilities:eventSimulationCapabilities)(b,c);
  check(cap.canCreate,cap.blockedReasons[0]?.code??'LEARNING_EVENT_PREFLIGHT',cap.blockedReasons[0]?.message??'실측 비교 조건을 확인하세요.');
  const config=cap.preflight.config,graph=candidate.graph,d=eventSource.datasets[0];let prepared;
  if(multi){const state=createMultiEventCampaignState({id:'learning-preflight',config,datasets:eventSource.datasets});prepared=prepareMultiEventFrame({state,graph,datasets:eventSource.datasets,config,asOf:window.startAt}).chosen;}
  else {const account=createEventPaperAccount({id:'learning-preflight',profileId:config.mindId,instrumentId:d.instrumentId,instrument:eventDatasetInstrument(d),initialCash:String(config.initialCash),feeSchedule:observedAccountFeeSchedule(d.feeSnapshot),now:window.startAt});prepared=prepareEventStrategyFrame({graph,account,dataset:d,asOf:window.startAt});}
  items.push({candidateId:candidate.id,phase,window,frames:cap.preflight.coverage.totalDecisionFrames,maximumProviderCalls:limit,priceCoverage:'OBSERVED_EVENT_WINDOW_ONLY',startingGraphHistory:prepared.request.state.strategyEvaluation.graphEvaluation.output.ready?'READY':'NOT_READY',costPolicy:cap.costPolicy,missingHistoryPolicy:'PRESERVE_NOT_READY_AND_BLOCK_ADOPTION'});
 }
 return {contractVersion:'LEARNING_EVENT_CHILD_PREFLIGHT_V1',items,observedAt:now,finalComparisonEligibility:'COMPLETE_NATIVE_NAV_READY_FRAMES_AND_CLOSED_TRADES_REQUIRED',decisionCadence:plan.source.timeframe,executionComparison:{status:'RESEARCH_ONLY_NOT_LIVE_EQUIVALENT',replay:{participationRate:.1,maxDailyLossRatio:.02,maxConcurrentPositions:1,decisionTtlMs:60000},liveLimitsNotReproduced:['PER_ORDER_ABSOLUTE_CAP','MAX_TRADES_PER_DAY','MIN_INTERVAL_MS','ABSOLUTE_DAILY_LOSS_LIMIT'],fundingExcluded:true},liveOrders:0};
}

export function auditEventLearningAccount(account){
 const report=getEventPaperReport(account);let cash=units(account.initialCash),quantity=0n,basis=0n,realized=0n,fees=0n,closed=0,wins=0,cycleRealized=0n;
 const funding=account.connector.fundingLedger??[];check(funding.every(f=>Number.isSafeInteger(f.fillOffset)&&f.fillOffset>=0&&f.fillOffset<=report.fills.length),'LEARNING_EVENT_FUNDING_ORDER','자금 이동의 체결 순서를 확인하세요.');
 for(let index=0;index<=report.fills.length;index++){for(const f of funding.filter(f=>f.fillOffset===index)){cash+=(f.direction==='deposit'?1n:-1n)*units(f.amount);check(cash>=0n,'LEARNING_EVENT_FUNDING_BALANCE','보유 현금 안의 자금 이동을 확인하세요.');}if(index===report.fills.length)break;const f=report.fills[index],q=units(f.quantity),gross=units(f.notional),fee=units(f.fee),price=units(f.price);check(q>0n&&gross===q*price/Q,'LEARNING_EVENT_FILL_MATH','실제 체결 수량·가격·금액을 대조하세요.');fees+=fee;
  const rate=units(String(f.feeSource.bps)),expectedFee=(gross*rate+10000n*Q-1n)/(10000n*Q);check(fee===expectedFee,'LEARNING_EVENT_FILL_FEE','실제 적용한 계좌 수수료를 대조하세요.');
  if(f.side==='buy'){cash-=gross+fee;quantity+=q;basis+=gross+fee;}else {check(f.side==='sell'&&q<=quantity,'LEARNING_EVENT_LEDGER','원 보유 수량 안에서 청산한 거래를 확인하세요.');const removed=q===quantity?basis:basis*q/quantity,pnl=gross-fee-removed;cash+=gross-fee;quantity-=q;basis-=removed;realized+=pnl;cycleRealized+=pnl;if(quantity===0n){closed++;wins+=Number(cycleRealized>0n);cycleRealized=0n;}}
  check(cash>=0n&&quantity>=0n,'LEARNING_EVENT_LEDGER','음수 현금·수량이 없는 실제 모의 원장을 확인하세요.');
 }
 check(cash===units(report.cash)&&quantity===units(report.quantity)&&basis===units(report.costBasis)&&fees===units(report.totalFees)&&realized===signedUnits(report.realizedPnl),'LEARNING_EVENT_LEDGER','체결을 다시 합산한 원 현금·수량·원가·수수료·실현 손익을 대조하세요.');
 return {report,closed,wins,realized:Number(decimal(realized))};
}

/** Assessment consumes only a completed child and its content-addressed event-account checkpoint. */
export async function assessEventStrategyLearningRun({plan,candidateId,phase,head,rows,eventSource,inputContextHash,observedAt,store,owner}){
 const {hash:planHash,...planBody}=plan;check(planHash===hashInputPackage(planBody)&&plan.contractVersion===STRATEGY_LEARNING_VERSION&&plan.kind==='PLAN','LEARNING_RECORD_CHANGED','고정한 연구 계획 원본을 대조하세요.');
 const candidate=plan.candidates.find(c=>c.id===candidateId),window=phase==='TRAIN'?plan.training:phase==='VALIDATION'?plan.validation:null,core=head.core,report=head.report;
 check(candidate&&window&&head.status==='COMPLETED'&&core.status==='COMPLETED'&&core.cursor===core.coverage.totalDecisionFrames&&observedAt>=head.updatedAt&&head.createdAt>=plan.createdAt,'LEARNING_RUN','완료된 실측 학습 실행을 선택하세요.');
 check(eventSource.datasetHash===plan.datasetHash&&inputContextHash===plan.inputContextHash&&same(eventSource.frozenInputs,head.frozenInputs)&&core.pins.datasetHash===plan.datasetHash&&core.pins.graphHash===candidate.graphHash&&strategyGraphHash(core.manifest.data.strategyPlan.graph)===candidate.graphHash&&mindDocumentHash(core.manifest)===core.pins.manifestHash,'LEARNING_RUN_SOURCE','고정한 종목·호가·수수료·정책·후보 그래프를 대조하세요.');
 const {reportHash,...reportBody}=report??{};
 check(reportHash===hashInputPackage(reportBody)&&report.simulationId===head.id&&same(report.pins,core.pins)&&same(report.config,core.config)&&same(report.rowsCounts,core.rowsCounts)&&report.status==='COMPLETED','LEARNING_REPORT_SOURCE','실측 보고서 원본과 실행 원장을 대조하세요.');
 check(Object.entries({...window,...plan.simulation}).every(([k,v])=>head.config[k]===v),'LEARNING_COMPARISON_CONDITIONS','후보의 기간·자금·비용을 고정하세요.');
 const total=core.coverage.totalDecisionFrames;for(const kind of ['decisions','fills','curve'])check(Array.isArray(rows[kind])&&rows[kind].length===core.rowsCounts[kind],'LEARNING_ROWS','모든 실제 판단·체결·평가 행을 대조하세요.');
 const {artifactSha256,...rowManifest}=report.evidence??{};check(rowManifest.contract==='SIMULATION_ROW_HASH_MANIFEST_V1'&&artifactSha256===hashInputPackage(rowManifest)&&rowManifest.inputHash===head.inputHash&&rowManifest.datasetHash===plan.datasetHash&&rowManifest.manifestHash===core.pins.manifestHash,'LEARNING_EVENT_ROW_EVIDENCE','완료한 보고서의 원장 해시 목록을 확인하세요.');
 for(const kind of ['decisions','fills','curve']){const refs=rows[kind].map(row=>{const {rowHash,...body}=row;check(rowHash===hashInputPackage(body),'LEARNING_EVENT_ROW_HASH','저장한 원장 행의 원문을 대조하세요.');return {sequence:row.sequence,sha256:rowHash};}).sort((a,b)=>a.sequence-b.sequence);check(rowManifest.rowCounts[kind]===refs.length&&rowManifest.perKindSha256[kind]===researchSha256(JSON.stringify(refs)),'LEARNING_EVENT_ROW_EVIDENCE','판단·체결·평가의 전체 행 해시를 대조하세요.');}
 check(rows.decisions.length===total&&rows.curve.length===total&&rows.decisions.every((r,i)=>r.sequence===i+1&&r.at===time(Date.parse(window.startAt)+i*plan.stepMs)&&['buy','hold','sell'].includes(r.action)&&Number.isFinite(r.targetWeight)&&r.targetWeight>=0&&r.targetWeight<=1)&&rows.curve.every((r,i)=>r.sequence===i+1&&r.at===rows.decisions[i].at),'LEARNING_EVENT_ALIGNMENT','동일 분봉의 연속된 판단과 실제 평가 시각을 대조하세요.');
 const multi=plan.source.assetMode==='UPBIT_EVENT_UNIVERSE',state=await (multi?restoreMultiEventCheckpoint(head,{store,owner,datasets:eventSource.datasets}):restoreEventSimulationCheckpoint(head,{store,owner,dataset:eventSource.datasets[0]})),accounts=[...(state.closedCampaigns??[]).map(r=>r.account),state.account],audits=accounts.map(auditEventLearningAccount),fills=audits.flatMap(a=>a.report.fills);
 check(new Set(fills.map(f=>f.fillId)).size===fills.length&&fills.length===rows.fills.length,'LEARNING_EVENT_FILL_LINK','체결 ID를 한 번씩 원 계좌와 연결하세요.');
 for(const row of rows.fills){const fill=fills.find(f=>f.fillId===row.id),decision=rows.decisions[row.decisionSequence-1],account=accounts.find(a=>a.connector.fills.some(f=>f.fillId===row.id));check(fill&&same(fill,row.connectorFill)&&fill.orderId===decision?.orderId&&fill.side===decision.action&&row.at===fill.occurredAt&&row.instrumentId===account.instrumentId&&row.at>=decision.at&&row.at<=window.endAt&&row.at>=window.startAt&&near(row.quantity,Number(fill.quantity))&&near(row.fillPrice,Number(fill.price))&&near(row.gross,Number(fill.notional))&&near(row.fee,Number(fill.fee)),'LEARNING_EVENT_FILL_LINK','원 판단·주문·실측 체결과 수수료를 그대로 연결하세요.');}
 if(multi){check(state.transfers.length===accounts.length-1&&state.closedCampaigns.every((c,i)=>same(c.report,audits[i].report)&&Number(c.report.quantity)===0&&c.report.cash===accounts[i+1].initialCash&&state.transfers[i].amount===c.report.cash&&state.transfers[i].fromLedgerHash===hashInputPackage(c.account)),'LEARNING_EVENT_CAPITAL','완전 청산 뒤 이관한 공용 현금과 캠페인 원장을 대조하세요.');}
 check(near(Number(accounts[0].initialCash),plan.simulation.initialCash)&&same(core.account,report.account),'LEARNING_EVENT_CAPITAL','모든 후보의 최초 원금과 최종 계좌를 대조하세요.');
 // Independently reconstruct every pre-decision NAV from earlier fills and the
 // latest actually received bid. Today's OHLC or a later book never marks it.
 for(const point of rows.curve){let cash=units(String(plan.simulation.initialCash));const held=new Map();for(const row of rows.fills.filter(f=>f.decisionSequence<point.sequence&&f.at<=point.at)){const f=row.connectorFill,q=units(f.quantity),gross=units(f.notional),fee=units(f.fee),before=held.get(row.instrumentId)??0n;if(f.side==='buy'){cash-=gross+fee;held.set(row.instrumentId,before+q);}else {check(q<=before,'LEARNING_EVENT_NAV','평가 전 보유 수량 안에서 실제 청산을 연결하세요.');cash+=gross-fee;held.set(row.instrumentId,before-q);}}
  let nav=cash;for(const [instrumentId,q]of held)if(q>0n){const dataset=eventSource.datasets.find(d=>d.instrumentId===instrumentId),book=dataset?.events.filter(e=>e.kind==='ORDER_BOOK'&&e.receivedAt<=point.at&&e.eventTime<=point.at).at(-1);check(book&&Date.parse(point.at)-Date.parse(book.receivedAt)<=3000&&Date.parse(point.at)-Date.parse(book.eventTime)<=3000,'LEARNING_EVENT_NAV','그 시점에 수신한 3초 이내의 평가 호가가 필요합니다.');nav+=q*units(book.levels[0].bidPrice)/Q;}
  check(near(point.cash,Number(decimal(cash)))&&near(point.equity,Number(decimal(nav))),'LEARNING_EVENT_NAV','원 체결 현금·보유 수량·당시 매수 호가로 평가를 다시 대조하세요.');
 }
 const ready=core.totals.warmupCount===0&&rows.decisions.every(r=>r.ready===true),complete=rows.curve.every(r=>r.valuationComplete&&Number.isFinite(r.equity)),last=audits.at(-1).report,finalEquity=Number(last.equity),fees=audits.reduce((n,a)=>n+Number(a.report.totalFees),0),realized=audits.reduce((n,a)=>n+a.realized,0),closed=audits.reduce((n,a)=>n+a.closed,0);
 check(complete,'LEARNING_EVENT_VALUATION','전체 관측 구간의 실제 평가 호가가 필요합니다.');let peak=plan.simulation.initialCash,mdd=0;for(const r of rows.curve){peak=Math.max(peak,r.equity);mdd=Math.max(mdd,1-r.equity/peak);}
 const native=report.nativeQuoteMetrics;check(native&&near(native.initialEquity,plan.simulation.initialCash)&&near(native.finalEquity,finalEquity)&&near(native.totalReturn,finalEquity/plan.simulation.initialCash-1)&&near(native.maxDrawdown,mdd)&&near(native.totalFees??native.feesPaid,fees),'LEARNING_EVENT_REWARD','원 통화의 독립 원장 합계·최종 평가·수수료·낙폭을 대조하세요.');
 const metrics={quoteCurrency:plan.source.quoteCurrency,initialEquity:plan.simulation.initialCash,finalEquity,totalReturn:finalEquity/plan.simulation.initialCash-1,maxDrawdown:mdd,feesPaid:fees,tradeCount:fills.length,closedTradeCount:closed,winningTrades:audits.reduce((n,a)=>n+a.wins,0),realizedPnl:realized,comparisonEligible:ready,evidenceStatus:ready&&closed>0?'OBSERVED_TRADES':'NO_EVIDENCE'},signature=rows.decisions.map(r=>({at:r.at,instrumentId:r.instrumentId??eventSource.datasets[0].instrumentId,action:r.action,targetWeight:r.targetWeight,executionStatus:r.executionStatus??null}));
 let previous=plan.simulation.initialCash;const segments=rows.curve.map(r=>{const value={startAt:time(Date.parse(r.at)-plan.stepMs),endAt:r.at,startEquity:previous,endEquity:r.equity,strategyReturn:r.equity/previous-1,excessReturn:r.equity/previous-1};previous=r.equity;return value;});
 return seal({kind:'ASSESSMENT',contractVersion:STRATEGY_LEARNING_VERSION,planHash:plan.hash,candidateId,graphHash:candidate.graphHash,phase,simulationId:head.id,simulationCreatedAt:head.createdAt,completedAt:head.updatedAt,observedAt,window:clone(window),simulation:clone(plan.simulation),datasetHash:plan.datasetHash,inputContextHash,metrics,benchmark:{id:'HOLD_QUOTE_CURRENCY',quoteCurrency:plan.source.quoteCurrency,totalReturn:0,finalEquity:plan.simulation.initialCash,policyHash:hashInputPackage({id:'HOLD_QUOTE_CURRENCY',source:plan.datasetHash})},excessReturn:metrics.totalReturn,segments,weakSegments:segments.filter(s=>s.excessReturn<0),regimes:[],regimePolicy:{id:'OBSERVED_MINUTE_NAV_SEGMENTS_V1',labelsRole:'DESCRIPTIVE_ONLY',futureInformation:false},decisionSignature:signature,decisionHash:hashInputPackage(signature),sourceHashes:{state:hashInputPackage(core),report:reportHash,rows:hashInputPackage(rows),manifest:core.pins.manifestHash,checkpoint:core.checkpointHash,dataset:plan.datasetHash},verifiedRows:clone(core.rowsCounts),providerCalls:head.jevBudget.completed,evidenceClass:'RETROSPECTIVE_DEVELOPMENT',forwardValidation:'REQUIRED',limitations:{statisticalSignificance:'NOT_ESTIMATED',depthModel:'OBSERVED_BOOK_COUNTERFACTUAL_WITH_PARTICIPATION_LIMIT',passiveQueueFills:false,protectionCadence:plan.source.timeframe,executionComparison:'RESEARCH_ONLY_NOT_LIVE_EQUIVALENT',liveLimitsNotReproduced:['PER_ORDER_ABSOLUTE_CAP','MAX_TRADES_PER_DAY','MIN_INTERVAL_MS','ABSOLUTE_DAILY_LOSS_LIMIT'],fundingExcluded:true}});
}
