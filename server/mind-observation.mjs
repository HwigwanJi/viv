import {observeAutomaticMindRun} from './mind-auto-observation.mjs';
import {automaticObservationWindow,automaticCohortPolicyHash,AUTOMATIC_COHORT_POLICY_VERSION} from '../dist/domain/learning-cohort.mjs';
import { mindDocumentHash, assertMindDocument } from '../dist/domain/mind-manifest.mjs';
import { hashInputPackage } from '../dist/domain/workspace.mjs';
import { researchSha256 } from '../dist/domain/research.mjs';
import { validateMindPaperAccount } from '../dist/domain/mind-paper.mjs';
import { getInstrument } from '../dist/domain/instruments.mjs';

export const MIND_OBSERVATION_VERSION = 'mind-fixed-post-execution-close-path-v1';
export const MIND_MULTI_OBSERVATION_VERSION = 'mind-fixed-post-execution-multiasset-close-path-v2';
export const MIND_PORTFOLIO_OBSERVATION_POLICY = 'PORTFOLIO_EXECUTION_ANCHORED_CLOSES_V1';
const finite = v => typeof v === 'number' && Number.isFinite(v), iso = v => typeof v === 'string' && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;
const STEPS = { '1h': 3600000, '4h': 14400000, '1d': 86400000 }, clone = v => structuredClone(v);
const pending = (status, dueAt, code, message) => ({ status, dueAt, reasons: [{ code, message }], observation: null });
const sha = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const sameNumber = (a,b) => finite(a) && finite(b) && Math.abs(a-b) <= 1e-8 * Math.max(1,Math.abs(a),Math.abs(b));

/** The owner-scoped API resolves every market from its verified source store.
 * This pure calculator rechecks identity, timestamps, hashes and complete paths. */
function observeMultiPosition({run,before,after,manifest,market,markets,quote,entryPrice,executionAt,initialEquity,timeframe,step,start,due,dueAt,now,horizonHours}) {
  const wait=(code,message)=>pending('DATA_REQUIRED',dueAt,code,message);
  if (!run.execution.accountSnapshotAfter || after.asOf !== executionAt || after.updatedAt !== executionAt || before.asOf > run.decisionAt || executionAt > now) return wait('OBSERVATION_FIXED_SNAPSHOT_REQUIRED','결정 전·실행 후의 불변 계좌와 실제 평가 시각을 연결하세요.');
  if (!Array.isArray(markets) || markets.length > 100) return wait('OBSERVATION_MULTI_POSITION_SOURCES_REQUIRED','모든 보유 종목의 검증된 시세 목록을 전달하세요.');
  const instrumentIds=[...new Set([run.instrumentId,...before.positions.filter(p=>p.quantity>0).map(p=>p.instrumentId),...after.positions.filter(p=>p.quantity>0).map(p=>p.instrumentId)])].sort();
  for(const id of instrumentIds){
    let instrument;try{instrument=getInstrument(id);}catch{return wait('OBSERVATION_INSTRUMENT_REQUIRED','모든 보유 종목의 거래소·상품 식별 정보를 확인하세요.');}
    if(instrument.quoteCurrency!==after.quoteCurrency)return wait('OBSERVATION_CURRENCY_SCOPE','동일 통화 계좌의 종목 가격으로 관측하세요.');
    if(instrument.assetClass!=='crypto')return wait('OBSERVATION_SESSION_CALENDAR_REQUIRED','주식 관측은 거래일·휴장일 캘린더와 일봉 종료 시각을 연결하세요.');
  }
  const ledgerPrefix=after.ledger.slice(0,before.ledger.length),newFills=after.ledger.slice(before.ledger.length);
  if(hashInputPackage(ledgerPrefix)!==hashInputPackage(before.ledger)||newFills.some(fill=>fill.runId!==run.id||fill.at!==executionAt))return wait('OBSERVATION_FIXED_SNAPSHOT_REQUIRED','해당 결정의 실행 직후 원장 사본을 연결하세요.');
  const receipt=after.receipts.find(value=>value.runId===run.id),expectedOutcome=run.execution.status==='FILLED'?'FILLED':'HOLD';
  if(!receipt||receipt.at!==executionAt||receipt.outcome!==expectedOutcome||newFills.length!==(expectedOutcome==='FILLED'?1:0))return wait('OBSERVATION_FIXED_SNAPSHOT_REQUIRED','같은 결정의 실행 영수증·체결 수와 계좌 사본을 대조하세요.');
  const completedAt=run.decisionCompletedAt??run.decisionAt;
  if(!iso(completedAt)||completedAt<run.decisionAt||!iso(quote.asOf)||quote.asOf<completedAt)return wait('OBSERVATION_ENTRY_SOURCE_REQUIRED','실제 결정 완료 이후의 선택 종목 실행 시세를 연결하세요.');
  const quotes=run.execution.valuationQuotes;
  if(!Array.isArray(quotes)||quotes.length>100)return wait('OBSERVATION_BASELINE_QUOTES_REQUIRED','실행 직후 모든 보유 종목의 가격·관측/수신 시각·원본 해시를 연결하세요.');
  const baseline=new Map(),seenQuotes=new Set();
  for(const value of quotes){
    if(!value||seenQuotes.has(value.instrumentId))return wait('OBSERVATION_BASELINE_QUOTE_CONFLICT','종목별 실행 기준 가격을 고유한 원본 하나에 연결하세요.');
    seenQuotes.add(value.instrumentId);
    if(instrumentIds.includes(value.instrumentId))baseline.set(value.instrumentId,value);
  }
  if(baseline.has(run.instrumentId)&&hashInputPackage(baseline.get(run.instrumentId))!==hashInputPackage(quote))return wait('OBSERVATION_BASELINE_QUOTE_CONFLICT','선택 종목의 실행 시세와 평가 시세 원본을 일치시키세요.');
  baseline.set(run.instrumentId,quote);
  for(const id of instrumentIds){
    const value=baseline.get(id),position=after.positions.find(p=>p.instrumentId===id);
    if(!value||value.instrumentId!==id||value.currency!==after.quoteCurrency||!finite(value.price)||value.price<=0||!iso(value.asOf)||!iso(value.receivedAt)||value.asOf>value.receivedAt||value.receivedAt>executionAt||Date.parse(executionAt)-Date.parse(value.asOf)>30000||!sha(value.rawSha256)||typeof value.source!=='string'||!value.source.trim()||value.executionAllowed===false||['END_OF_DAY','STALE','DELAYED'].includes(value.freshness)||value.priceBasis==='LAST_CLOSED_CANDLE')return wait('OBSERVATION_BASELINE_QUOTES_REQUIRED','각 보유 종목의 실행 시점30초 이내 실제 가격·수신 시각·원본 해시를 준비하세요.');
    if(position&&(!sameNumber(position.marketPrice,value.price)||position.priceAsOf!==value.asOf||position.priceReceivedAt!==value.receivedAt))return wait('OBSERVATION_BASELINE_QUOTE_CONFLICT','불변 계좌의 평가 가격·시각과 해당 시세 원본을 대조하세요.');
  }
  const indexed=new Map();
  for(const value of [market,...markets]){
    if(!value)continue;const id=value.instrument?.id;
    if(!instrumentIds.includes(id))continue;
    if(indexed.has(id)&&hashInputPackage(indexed.get(id))!==hashInputPackage(value))return wait('OBSERVATION_MARKET_SOURCE_CONFLICT','같은 종목·주기의 관측 자료를 한 불변 원본으로 선택하세요.');
    indexed.set(id,value);
  }
  const firstClose=(Math.floor(start/step)+1)*step,expectedCount=(due-firstClose)/step+1,paths=new Map();
  for(const id of instrumentIds){
    const value=indexed.get(id),source=value?.source;
    if(!value)return wait('OBSERVATION_MULTI_POSITION_SOURCES_REQUIRED','선택 종목과 모든 보유 종목의 같은 기간 확정 봉을 준비하세요.');
    if(value.status!=='READY'||value.instrument?.quoteCurrency!==after.quoteCurrency||value.instrument?.assetClass!=='crypto'||value.timeframe!==timeframe||!Array.isArray(value.bars)||!value.bars.length||!source||source.dataOrigin!=='PUBLIC_API'||source.instrumentId!==undefined&&source.instrumentId!==id||source.timeframe!==undefined&&source.timeframe!==timeframe||!iso(source.availableAt)||source.availableAt>now||!iso(source.receivedAt)||source.receivedAt>source.availableAt||!iso(source.asOf)||source.asOf>source.receivedAt||source.asOf>now||source.asOf!==value.bars.at(-1)?.closeTime||source.barsSha256!==researchSha256(JSON.stringify(value.bars)))return wait('OBSERVATION_SOURCE_REQUIRED','모든 종목의 통화·주기·공개 원본·수신/사용 시점·봉 해시를 대조하세요.');
    const canonical=source.hashContract==='CANONICAL_CONFIRMED_BARS_PROJECTION_V1';
    if(canonical?!(sha(source.captureSha256)&&sha(source.datasetSha256)&&source.projectionBarsSha256===source.barsSha256):!sha(source.rawSha256))return wait('OBSERVATION_SOURCE_REQUIRED','각 종목의 실제 응답 원본 또는 정본·dataset·투영 해시를 연결하세요.');
    for(let i=0;i<value.bars.length;i++){
      const bar=value.bars[i];if(!bar||typeof bar!=='object')return wait('OBSERVATION_PATH_INCOMPLETE','실제 확정 OHLCV 행을 연결하세요.');
      const open=Date.parse(bar.openTime),close=Date.parse(bar.closeTime);
      if(bar.isClosed!==true||!iso(bar.openTime)||!iso(bar.closeTime)||close> Date.parse(now)||close-open!==step||open%step!==0||i&&value.bars[i-1].closeTime!==bar.openTime||!['open','high','low','close'].every(key=>finite(bar[key])&&bar[key]>0)||bar.high<Math.max(bar.open,bar.close)||bar.low>Math.min(bar.open,bar.close)||bar.low>bar.high||!finite(bar.volume)||bar.volume<0)return wait('OBSERVATION_PATH_INCOMPLETE','모든 종목의 확정 OHLCV·정확한 UTC 봉 경계·연속성을 확인하세요.');
    }
    const bars=value.bars.filter(bar=>Date.parse(bar.closeTime)>=firstClose&&Date.parse(bar.closeTime)<=due);
    if(bars.length!==expectedCount||bars.some((bar,i)=>Date.parse(bar.closeTime)!==firstClose+i*step))return wait('OBSERVATION_PATH_INCOMPLETE','관측 시작부터 종료까지 모든 종목의 동일 종료 봉 경로를 준비하세요.');
    if(bars.some(bar=>bar.closeTime<=executionAt))return wait('OBSERVATION_EXECUTION_PATH_OVERLAP','실제 실행 이후 확정된 봉에서 복수 보유 성과를 관측하세요.');
    paths.set(id,bars);
  }
  const feesPaid=run.execution.fee??0,slippagePaid=run.execution.slippageCost??0;
  if(![feesPaid,slippagePaid].every(v=>finite(v)&&v>=0))return wait('OBSERVATION_COSTS_REQUIRED','실행 영수증의 실제 수수료와 슬리피지 비용을 확인하세요.');
  if(!sameNumber(initialEquity,before.equity))return wait('OBSERVATION_ACCOUNT_METRICS_REQUIRED','원요청의 초기 평가액과 결정 전 계좌를 대조하세요.');
  const mark=(positions,prices)=>positions.reduce((sum,p)=>sum+p.quantity*prices[p.instrumentId],0),baselinePrices=Object.fromEntries(instrumentIds.map(id=>[id,baseline.get(id).price]));
  const executionEquity=after.cash+mark(after.positions,baselinePrices);
  if(!sameNumber(executionEquity,after.equity))return wait('OBSERVATION_BASELINE_QUOTE_CONFLICT','실행 후 현금·수량·원본 가격의 평가 합계를 계좌와 대조하세요.');
  const path=[{asOf:new Date(start).toISOString(),equity:initialEquity,accountAsOf:before.asOf,basis:'PRE_DECISION_ACCOUNT'},{asOf:executionAt,equity:executionEquity,prices:baselinePrices,basis:'FIXED_POST_EXECUTION_ACCOUNT'}];
  for(let index=0;index<expectedCount;index++){
    const prices=Object.fromEntries(instrumentIds.map(id=>[id,paths.get(id)[index].close]));
    path.push({asOf:paths.get(run.instrumentId)[index].closeTime,equity:after.cash+mark(after.positions,prices),prices,basis:'COMMON_CONFIRMED_CLOSE'});
  }
  if(path.some(point=>!finite(point.equity)||point.equity<0))return wait('OBSERVATION_ACCOUNT_METRICS_REQUIRED','유한한 계좌 평가액을 계산할 수 있는 종목별 가격 경로를 준비하세요.');
  let peak=initialEquity,maxDrawdown=0;for(const point of path){peak=Math.max(peak,point.equity);maxDrawdown=Math.max(maxDrawdown,(peak-point.equity)/peak);}
  const ending=path.at(-1),endingPrice=ending.prices[run.instrumentId],endingEquity=ending.equity,netReturn=endingEquity/initialEquity-1,benchmarkQuantity=initialEquity/(entryPrice*1.0005*1.001),buyAndHoldReturn=benchmarkQuantity*endingPrice/initialEquity-1;
  const scope={kind:'FIXED_MULTI_ASSET_ACCOUNT',accountId:after.id,quoteCurrency:after.quoteCurrency,instrumentIds,selectedInstrumentId:run.instrumentId,timeframe};
  const performance={fixedDecision:true,initialEquity,endingCash:after.cash,endingQuantity:after.positions.find(p=>p.instrumentId===run.instrumentId)?.quantity??0,endingPositions:after.positions.map(p=>({instrumentId:p.instrumentId,quantity:p.quantity,price:ending.prices[p.instrumentId],marketValue:p.quantity*ending.prices[p.instrumentId]})),endingEquity,netReturn,feesPaid,slippagePaid,maxDrawdown,benchmarks:{holdPreDecisionReturn:(before.cash+mark(before.positions,ending.prices))/initialEquity-1,allCashReturn:0,buyAndHoldReturn},benchmarkPolicy:{id:'ALL_IN_BUY_HOLD_10BP_5BP_V1',instrumentId:run.instrumentId,entryPrice,feeBps:10,slippageBps:5,exit:'MARK_TO_CLOSED_PRICE'}};
  const observation={schemaVersion:1,methodVersion:MIND_MULTI_OBSERVATION_VERSION,scope,runId:run.id,profileId:run.profileId,instrumentId:run.instrumentId,period:{start:new Date(start).toISOString(),end:dueAt},horizonHours,actualHorizonHours:(due-start)/3600000,asOf:dueAt,observedAt:now,performance,metrics:{netReturn,benchmarkReturn:buyAndHoldReturn,feesReturn:feesPaid/initialEquity,slippageReturn:slippagePaid/initialEquity,maxDrawdown,benchmarkId:'ALL_IN_BUY_HOLD_10BP_5BP_V1'},path,source:{market:clone(indexed.get(run.instrumentId).source),markets:instrumentIds.map(id=>({instrumentId:id,timeframe,source:clone(indexed.get(id).source),firstCloseAt:paths.get(id)[0].closeTime,lastCloseAt:paths.get(id).at(-1).closeTime})),baselineQuotes:instrumentIds.map(id=>clone(baseline.get(id))),executionQuote:clone(quote),runHash:mindRunEvidenceHash(run),beforeSnapshotHash:hashInputPackage(before),afterSnapshotHash:hashInputPackage(after),manifestHash:run.manifestHash},limitations:['실행 후 현금·종목별 수량을 고정하고 모든 종목의 같은 확정 종가에서 계좌를 평가한다.','최대 낙폭은 실행 평가와 이후 공통 확정 종가를 사용한다.','매수보유 대조는 선택 종목에 전체 초기 자금을 배정한 고정 비용 정책이다.']};
  return {status:'OBSERVED',dueAt,reasons:[],observation};
}

/** Stable evidence identity for a completed decision and its first execution.
 * Observation state and later review metadata are kept in separate records. */
export function mindRunEvidenceHash(run) {
  const fields = ['id', 'profileId', 'instrumentId', 'asOf', 'decisionAt', 'manifestId', 'manifestHash', 'decision', 'rawRequest', 'rawResponse', 'provider', 'accountSnapshot', 'execution'];
  const snapshot = Object.fromEntries(fields.map(key => [key, run?.[key] ?? null]));
  // Older records keep their original evidence identity; only a recorded
  // completion timestamp becomes part of a new record's immutable evidence.
  if (run && Object.hasOwn(run, 'decisionCompletedAt')) snapshot.decisionCompletedAt = run.decisionCompletedAt;
  if (run && Object.hasOwn(run, 'automation')) snapshot.automation = run.automation;
  // Storage uses JSON data. Optional nested undefined members normalize exactly
  // as the persisted JSON while every top-level optional field is explicit null.
  return hashInputPackage(JSON.parse(JSON.stringify(snapshot)));
}

/** Fixed post-execution position markout, using only subsequent closed prices.
 * Future trades in the account do not enter this diagnostic. */
/** Manual starts and portfolio accounts retain their own execution-anchored diagnostics.
 * The fixed BTC automatic cohort still requires its original execution window and scope. */
function portfolioObservationReason(run){
  const a=run?.automation,p=a?.portfolioCycle;
  if(p?.contractVersion!=='MIND_PORTFOLIO_CYCLE_V1'||a.cohortPolicyVersion!==AUTOMATIC_COHORT_POLICY_VERSION||a.cohortPolicyHash!==automaticCohortPolicyHash()||!iso(run.execution?.at))return null;
  let window;try{window=automaticObservationWindow({barCloseAt:a.barCloseAt,executionAt:run.execution.at});}catch{return null;}
  if(p.trigger==='MANUAL_START'||p.completedBatch?.trigger==='MANUAL_START')return 'MANUAL_START';
  if(run.instrumentId!=='crypto:okx:BTC-USDT'||[...(run.accountSnapshot?.positions??[]),...(run.execution.accountSnapshotAfter?.positions??[])].some(position=>position.quantity>0&&position.instrumentId!=='crypto:okx:BTC-USDT'))return 'PORTFOLIO_SCOPE';
  // Older startup records prove their execution time even when a trigger label was absent.
  return window.withinExecutionWindow?null:'OUTSIDE_AUTOMATIC_COHORT_WINDOW';
}
export function observeMindRun(args={}) {
  const reason=portfolioObservationReason(args.run);
  if(reason){
    const value=observeLegacyMindRun({...args,horizonHours:args.horizonHours??8,anchorAt:args.run.execution.at,completeValuation:true});
    if(value.observation)value.observation.observationPolicy={id:MIND_PORTFOLIO_OBSERVATION_POLICY,reason,anchor:'EXECUTION_AT',executionAt:args.run.execution.at,barCloseAt:args.run.automation.barCloseAt,subscriptionId:args.run.automation.subscriptionId,attemptKey:args.run.automation.attemptKey};
    return value;
  }
  if(args.run?.automation)return observeAutomaticMindRun({...args,horizonHours:args.horizonHours??8},observeLegacyMindRun);
  return observeLegacyMindRun(args);
}
function observeLegacyMindRun({ run, account, manifest, market, markets = [], now = new Date().toISOString(), horizonHours = 4, anchorAt, completeValuation=false } = {}) {
  if (!iso(now) || !run || !iso(run.decisionAt) || !Number.isInteger(horizonHours) || horizonHours < 1 || horizonHours > 168) return pending('DATA_REQUIRED', null, 'INVALID_OBSERVATION_INPUT', '결정 시각·현재 시각·1~168시간 관측 기간을 확인하세요.');
  const timeframe = run.rawRequest?.state?.market?.timeframe ?? market?.timeframe ?? '4h', step = STEPS[timeframe];
  if (!step) return pending('DATA_REQUIRED', null, 'OBSERVATION_TIMEFRAME_REQUIRED', '확정 캔들의 시간 간격을 확인하세요.');
  if(anchorAt!==undefined&&(!iso(anchorAt)||anchorAt!==run.execution?.at||anchorAt<run.decisionAt))return pending('DATA_REQUIRED',null,'OBSERVATION_EXECUTION_ANCHOR','실제 체결 영수증의 시각을 관측 시작점에 연결하세요.');
  const start = Date.parse(anchorAt??run.decisionAt), target = start + horizonHours * 3600000, due = Math.ceil(target / step) * step, dueAt = new Date(due).toISOString();
  if (Date.parse(now) < due) return pending('WAITING_TIME', dueAt, 'OBSERVATION_WINDOW_PENDING', '실제 결정 이후 관측 기간의 확정 봉을 기다립니다.');
  try { assertMindDocument(manifest); } catch { return pending('DATA_REQUIRED', dueAt, 'OBSERVATION_MANIFEST_REQUIRED', '원래 결정의 마인드 정책 버전을 조회하세요.'); }
  if (run.profileId !== manifest.scope.profileId || run.manifestHash !== mindDocumentHash(manifest) || run.manifestId !== manifest.id) return pending('DATA_REQUIRED', dueAt, 'OBSERVATION_POLICY_SCOPE', '원래 결정의 프로필과 불변 정책 해시를 대조하세요.');
  const execution = run.execution;
  if (!execution || !['FILLED', 'NO_ORDER_REQUIRED'].includes(execution.status)) return pending('DATA_REQUIRED', dueAt, 'OBSERVATION_EXECUTION_REQUIRED', '모의 체결 또는 유지 영수증을 먼저 기록하세요.');
  const after = execution.accountSnapshotAfter ?? account, before = run.accountSnapshot ?? execution.accountSnapshotBefore;
  if (!after || !before || after.id !== before.id || after.profileId !== run.profileId || before.profileId !== run.profileId || after.quoteCurrency !== before.quoteCurrency || !Array.isArray(after.positions) || !Array.isArray(before.positions) || validateMindPaperAccount(after).length || validateMindPaperAccount(before).length) return pending('DATA_REQUIRED', dueAt, 'OBSERVATION_ACCOUNT_REQUIRED', '같은 통화의 결정 전·실행 후 계좌 스냅샷을 준비하세요.');
  const multiPosition=[...after.positions,...before.positions].some(p=>p.quantity>0&&p.instrumentId!==run.instrumentId);
  if (!execution.accountSnapshotAfter && after.ledger?.some(fill => fill.at > (execution.at ?? run.decisionAt) && fill.runId !== run.id)) return pending('DATA_REQUIRED', dueAt, 'OBSERVATION_FIXED_SNAPSHOT_REQUIRED', '후속 매매 이전의 불변 실행 후 계좌 스냅샷을 조회하세요.');
  const quote = execution.quote, entryPrice = quote?.price ?? execution.referencePrice, executionAt = execution.at ?? quote?.asOf ?? run.decisionAt;
  if (!finite(entryPrice) || entryPrice <= 0 || !iso(executionAt) || executionAt < run.decisionAt || Date.parse(executionAt) >= due || quote?.instrumentId !== run.instrumentId || quote?.currency !== after.quoteCurrency) return pending('DATA_REQUIRED', dueAt, 'OBSERVATION_ENTRY_SOURCE_REQUIRED', '결정 이후에 관측한 종목·통화·실행 가격과 시각을 연결하세요.');
  const initialEquity = run.rawRequest?.state?.portfolio?.equity ?? before.equity, cash = after.cash, quantity = after.positions.find(p => p.instrumentId === run.instrumentId)?.quantity ?? 0, beforeQuantity = before.positions.find(p => p.instrumentId === run.instrumentId)?.quantity ?? 0;
  if (![initialEquity, cash, quantity, before.cash, beforeQuantity].every(finite) || initialEquity <= 0 || cash < 0 || quantity < 0) return pending('DATA_REQUIRED', dueAt, 'OBSERVATION_ACCOUNT_METRICS_REQUIRED', '결정 기준 평가액과 실행 후 현금·수량을 확인하세요.');
  if(multiPosition||completeValuation)return observeMultiPosition({run,before,after,manifest,market,markets,quote,entryPrice,executionAt,initialEquity,timeframe,step,start,due,dueAt,now,horizonHours});
  if (market?.status !== 'READY' || market.instrument?.id !== run.instrumentId || market.instrument?.quoteCurrency !== after.quoteCurrency || market.timeframe !== timeframe || !Array.isArray(market.bars) || !market.source || !iso(market.source.availableAt) || market.source.availableAt > now || market.source.asOf && market.source.asOf > now || market.bars.some(b => b.closeTime > now) || market.source.barsSha256 !== researchSha256(JSON.stringify(market.bars))) return pending('DATA_REQUIRED', dueAt, 'OBSERVATION_SOURCE_REQUIRED', '관측 종목의 확정 캔들·통화·자료 시점과 원본 해시를 준비하세요.');
  if (market.instrument.assetClass !== 'crypto') return pending('DATA_REQUIRED', dueAt, 'OBSERVATION_SESSION_CALENDAR_REQUIRED', '주식 관측은 거래일·휴장일 캘린더와 일봉 종료 시각을 연결하세요.');
  const firstClose = (Math.floor(start / step) + 1) * step, bars = market.bars.filter(b => Date.parse(b.closeTime) >= firstClose && Date.parse(b.closeTime) <= due);
  if (bars.length !== (due - firstClose) / step + 1 || bars.some((b, i) => b.isClosed !== true || !iso(b.closeTime) || Date.parse(b.closeTime) !== firstClose + i * step || Date.parse(b.closeTime) > Date.parse(now) || !finite(b.close) || b.close <= 0)) return pending('DATA_REQUIRED', dueAt, 'OBSERVATION_PATH_INCOMPLETE', '결정 이후 관측 종료까지 연속된 확정 종가를 수집하세요.');
  if (bars.some(b => b.closeTime <= executionAt)) return pending('DATA_REQUIRED', dueAt, 'OBSERVATION_EXECUTION_PATH_OVERLAP', '실행 후의 확정 종가부터 평가할 가격 경로를 준비하세요.');
  const feesPaid = execution.fee ?? 0, slippagePaid = execution.slippageCost ?? 0;
  if (![feesPaid, slippagePaid].every(v => finite(v) && v >= 0)) return pending('DATA_REQUIRED', dueAt, 'OBSERVATION_COSTS_REQUIRED', '실행 영수증의 실제 수수료와 슬리피지 비용을 확인하세요.');
  const path = [{ asOf: run.decisionAt, price: entryPrice, equity: initialEquity }, { asOf: executionAt, price: entryPrice, equity: cash + quantity * entryPrice }, ...bars.map(b => ({ asOf: b.closeTime, price: b.close, equity: cash + quantity * b.close }))];
  let peak = initialEquity, maxDrawdown = 0; for (const point of path) { peak = Math.max(peak, point.equity); maxDrawdown = Math.max(maxDrawdown, (peak - point.equity) / peak); }
  const endingPrice = bars.at(-1).close, endingEquity = cash + quantity * endingPrice, netReturn = endingEquity / initialEquity - 1, benchmarkQuantity = initialEquity / (entryPrice * 1.0005 * 1.001), buyAndHoldReturn = benchmarkQuantity * endingPrice / initialEquity - 1;
  const performance = { fixedDecision: true, initialEquity, endingCash: cash, endingQuantity: quantity, endingEquity, netReturn, feesPaid, slippagePaid, maxDrawdown, benchmarks: { holdPreDecisionReturn: (before.cash + beforeQuantity * endingPrice) / initialEquity - 1, allCashReturn: 0, buyAndHoldReturn }, benchmarkPolicy: { id: 'ALL_IN_BUY_HOLD_10BP_5BP_V1', entryPrice, feeBps: 10, slippageBps: 5, exit: 'MARK_TO_CLOSED_PRICE' } };
  const observation = { schemaVersion: 1, methodVersion: MIND_OBSERVATION_VERSION, runId: run.id, profileId: run.profileId, instrumentId: run.instrumentId, period: { start: run.decisionAt, end: dueAt }, horizonHours, actualHorizonHours: (due - start) / 3600000, asOf: dueAt, observedAt: now, performance, metrics: { netReturn, benchmarkReturn: buyAndHoldReturn, feesReturn: feesPaid / initialEquity, slippageReturn: slippagePaid / initialEquity, maxDrawdown, benchmarkId: 'ALL_IN_BUY_HOLD_10BP_5BP_V1' }, path, source: { market: clone(market.source), executionQuote: clone(quote), runHash: mindRunEvidenceHash(run), afterSnapshotHash: hashInputPackage(after), manifestHash: run.manifestHash }, limitations: ['실행 후 현금과 수량을 고정한 종가 경로 진단이다. 후속 매매의 효과는 별도 운용 성과에서 평가한다.', '첫 구간의 결정 이전 고가·저가는 사용하지 않는다. 최대 낙폭은 실행 평가와 이후 확정 종가로 계산한다.'] };
  return { status: 'OBSERVED', dueAt, reasons: [], observation };
}
