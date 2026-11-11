import {cardGame} from './mind-game.mjs';
import {validateMindPaperAccount,markMindPaperAccount} from './mind-paper.mjs';
import {BTC_4H_AUTO_COHORT_POLICY} from './learning-cohort.mjs';
import {readMindAppearance} from './workspace.mjs';

export const MIND_COMPANION_POLICY='PAPER_LEDGER_COMPANION_V1';
export const MIND_COMPANION_MAX_QUOTE_AGE_MS=30000;
const list=v=>Array.isArray(v)?v:[],copy=structuredClone;
const iso=v=>typeof v==='string'&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString()===v;
const finite=v=>typeof v==='number'&&Number.isFinite(v);
const latest=values=>values.filter(iso).sort().at(-1)??null;
const why=(code,message)=>({code,message});
const held=a=>list(a.positions).filter(p=>finite(p.quantity)&&p.quantity>0);
const within=(stamp,now)=>iso(stamp)&&stamp<=now&&Date.parse(now)-Date.parse(stamp)<=MIND_COMPANION_MAX_QUOTE_AGE_MS;
const policyOf=m=>m?.manifest??(m?.kind==='mind-policy'?m:null);

function accountProblem(a,asOf){
  try{if(validateMindPaperAccount(a).length)return why('INVALID_PAPER_ACCOUNT','모의 계좌와 체결 기록을 확인하세요.');}
  catch{return why('INVALID_PAPER_ACCOUNT','모의 계좌와 체결 기록을 확인하세요.');}
  if(a.asOf>asOf||a.updatedAt>asOf||a.createdAt>asOf||a.ledger.some(f=>f.at>asOf||f.at>a.asOf))return why('ACCOUNT_TIME_UNAVAILABLE','조회 시점까지 기록된 계좌가 필요합니다.');
  // This account version has fixed initial capital and BUY/SELL flows only.
  if(['deposits','withdrawals','cashFlows','capitalFlows','transfers'].some(k=>a[k]!=null&&(!Array.isArray(a[k])||a[k].length))||a.events.some(e=>!['MIND_PAPER_FILLED','MIND_PAPER_HELD'].includes(e?.type)))return why('CAPITAL_FLOW_POLICY_REQUIRED','입출금 내역에 맞는 수익률 계산 기준을 확인하세요.');
  return null;
}

function metrics(a){return {equity:a.equity,initialCapital:a.initialCash+(a.fundingLedger??[]).reduce((n,f)=>n+Math.max(0,f.amount),0),netPnl:a.netPnl,netReturn:a.netReturn,feesPaid:a.feesPaid,asOf:a.asOf};}
function allocation(a,source){
  if(!finite(a.equity)||a.equity<=0)return null;
  return {accountId:a.id,profileId:a.profileId,currency:a.quoteCurrency,equity:a.equity,cash:a.cash,cashWeight:a.cash/a.equity,asOf:a.asOf,source,positions:held(a).map(p=>({instrumentId:p.instrumentId,symbol:p.symbol??p.instrumentId,quantity:p.quantity,marketValue:p.quantity*p.marketPrice,weight:p.quantity*p.marketPrice/a.equity,priceAsOf:p.priceAsOf})).sort((a,b)=>b.weight-a.weight||a.instrumentId.localeCompare(b.instrumentId))};
}
function freshValuation(account,envelopes,workspace,asOf){
  for(const envelope of envelopes){
    const v=envelope?.valuation;
    if(envelope?.ok!==true||envelope.revision!==workspace.revision||v?.status!=='READY'||v.policy!=='COMMON_BASIS_FRESH_QUOTES_30S_V1'||!within(v.basisAt,asOf)||v.asOf!==v.basisAt||v.basisAt<account.updatedAt||!['all',account.profileId].includes(v.scope?.profileId)||v.scope?.quoteCurrency!==account.quoteCurrency)continue;
    if(!list(v.mindSummaries).some(s=>s.accountId===account.id&&s.profileId===account.profileId&&s.quoteCurrency===account.quoteCurrency&&s.asOf===v.basisAt))continue;
    const quotes=list(v.quotes).filter(q=>held(account).some(p=>p.instrumentId===q.instrumentId));
    if(quotes.some(q=>q.currency!==account.quoteCurrency||!within(q.asOf,asOf)||!iso(q.receivedAt)||q.asOf>q.receivedAt||q.receivedAt>v.basisAt||q.source!=='OKX_PUBLIC_TICKER'||!/^[a-f0-9]{64}$/.test(q.rawSha256??'')))continue;
    try{return {account:markMindPaperAccount(account,{quotes,now:v.basisAt}),source:'READ_ONLY_COMMON_BASIS'};}catch{/* An incomplete or older read cannot replace the saved account. */}
  }
  return null;
}

function currencyView(accounts,envelopes,workspace,asOf){
  const currency=accounts[0].quoteCurrency,base={currency,accountIds:accounts.map(a=>a.id),status:'DATA_REQUIRED',equity:null,initialCapital:null,netPnl:null,netReturn:null,feesPaid:null,asOf:null,reason:null,hasPerformance:false,lastSavedPerformance:null,source:null,allocation:null,heldInstrumentIds:[]};
  if(accounts.length!==1)return {...base,reason:why('DUPLICATE_CURRENCY_ACCOUNTS','같은 마인드의 통화별 계좌를 확인하세요.')};
  const account=accounts[0],problem=accountProblem(account,asOf);
  if(problem)return {...base,reason:problem};
  const saved=metrics(account),hasPerformance=account.ledger.length>0;
  const shared={...base,initialCapital:account.initialCash,feesPaid:account.feesPaid,hasPerformance,heldInstrumentIds:held(account).map(p=>p.instrumentId),lastSavedPerformance:{...saved,source:'SAVED_PAPER_ACCOUNT',accountId:account.id}};
  if(!held(account).length)return {...shared,...saved,status:hasPerformance?'CASH_ONLY':'UNTRADED',reason:hasPerformance?null:why('NO_TRADES','첫 모의 거래를 기다립니다.'),source:'CASH_LEDGER',asOf:account.asOf,allocation:allocation(account,'CASH_LEDGER')};
  const marked=freshValuation(account,envelopes,workspace,asOf);
  if(marked)return {...shared,...metrics(marked.account),status:'CURRENT',reason:null,source:marked.source,allocation:allocation(marked.account,marked.source)};
  const savedFresh=within(account.asOf,asOf)&&held(account).every(p=>within(p.priceAsOf,asOf)&&iso(p.priceReceivedAt)&&p.priceAsOf<=p.priceReceivedAt&&p.priceReceivedAt<=account.asOf);
  if(savedFresh)return {...shared,...saved,status:'CURRENT',reason:null,source:'SAVED_PAPER_ACCOUNT',allocation:allocation(account,'SAVED_PAPER_ACCOUNT')};
  return {...shared,status:'STALE',reason:why('VALUATION_STALE','마지막 저장 평가를 표시합니다. 현재 수익률은 시세 갱신 후 확인하세요.'),asOf:account.asOf};
}

const eventUnits=value=>{if(typeof value!=='string'||! /^-?\d+(?:\.\d{1,18})?$/.test(value))throw new TypeError('원장 금액을 확인하세요.');const negative=value.startsWith('-'),[whole,fraction='']=(negative?value.slice(1):value).split('.');return (negative?-1n:1n)*(BigInt(whole)*10n**18n+BigInt(fraction.padEnd(18,'0')));};
function eventCurrencyView(activity,asOf){
  const ledger=activity.ledger??{},currency=activity.quoteCurrency,base={currency,accountIds:[activity.accountId],status:'DATA_REQUIRED',equity:null,initialCapital:null,netPnl:null,netReturn:null,feesPaid:null,asOf:null,reason:why('EVENT_PAPER_LEDGER_REVIEW','모의 운용 원장을 확인하세요.'),hasPerformance:false,lastSavedPerformance:null,source:'EVENT_PAPER_LEDGER',allocation:null,heldInstrumentIds:[],allocationStatus:ledger.allocationStatus};
  try{
    if(activity.executionMode!=='paper'||ledger.status!=='READY'||!activity.accountId||ledger.allocationId!==activity.accountId||ledger.quoteCurrency!==currency||activity.config?.quoteCurrency!==currency||!['ENABLED','PAUSED','COMPLETED'].includes(activity.status)||!iso(ledger.asOf)||ledger.asOf>asOf||!iso(ledger.ledgerAsOf)||ledger.ledgerAsOf>ledger.asOf||!iso(activity.updatedAt)||activity.updatedAt>ledger.asOf) return base;
    if((activity.status==='COMPLETED')!==(ledger.allocationStatus==='RELEASED'))return base;
    const capital=eventUnits(ledger.initialCapital),cash=eventUnits(ledger.cash),fees=eventUnits(ledger.feesPaid),available=eventUnits(ledger.availableCash),reserved=eventUnits(ledger.reservedCash);
    if(capital<=0n||capital!==eventUnits(activity.config.capitalLimit)||cash<0n||fees<0n||available<0n||reserved<0n||!Number.isSafeInteger(ledger.fillCount)||ledger.fillCount<0||!Array.isArray(ledger.positions)||ledger.positions.length>1)return base;
    const positions=ledger.positions.map(p=>({...p,units:eventUnits(p.quantity)}));
    if(positions.some(p=>p.units<=0n||typeof p.instrumentId!=='string')||activity.status==='COMPLETED'&&(positions.length||available!==0n||reserved!==0n)||activity.status!=='COMPLETED'&&available+reserved!==cash)return base;
    const shared={...base,initialCapital:Number(ledger.initialCapital),feesPaid:Number(ledger.feesPaid),hasPerformance:ledger.fillCount>0,heldInstrumentIds:positions.map(p=>p.instrumentId),asOf:ledger.ledgerAsOf};
    if(![shared.initialCapital,shared.feesPaid].every(finite))return base;
    if(ledger.equity==null||positions.length&&(!iso(ledger.valuationAsOf)||ledger.valuationAsOf>ledger.asOf||Date.parse(asOf)-Date.parse(ledger.valuationAsOf)>3000))return {...shared,status:'STALE',reason:why('EVENT_PAPER_VALUATION_REQUIRED','보유 종목의 최신 호가를 기다립니다.')};
    const equity=eventUnits(ledger.equity),pnl=eventUnits(ledger.netPnl),holdings=eventUnits(ledger.holdingsValue);
    if(equity<0n||equity!==cash+holdings||pnl!==equity-capital||!positions.length&&holdings!==0n)return base;
    const values={equity:Number(ledger.equity),initialCapital:Number(ledger.initialCapital),netPnl:Number(ledger.netPnl),netReturn:Number(pnl)/Number(capital),feesPaid:Number(ledger.feesPaid),asOf:positions.length?ledger.valuationAsOf:ledger.ledgerAsOf};
    if(!['equity','initialCapital','netPnl','netReturn','feesPaid'].every(k=>finite(values[k])))return base;
    const allocation=activity.status==='COMPLETED'||equity===0n?null:{accountId:activity.accountId,profileId:activity.profileId,currency,equity:values.equity,cash:Number(ledger.cash),cashWeight:Number(cash)/Number(equity),asOf:values.asOf,source:'EVENT_PAPER_LEDGER',positions:positions.map(p=>({instrumentId:p.instrumentId,symbol:p.market??p.instrumentId,quantity:Number(p.quantity),marketValue:Number(ledger.holdingsValue),weight:Number(holdings)/Number(equity),priceAsOf:ledger.valuationAsOf}))};
    return {...shared,...values,status:positions.length?'CURRENT':ledger.fillCount?'CASH_ONLY':'UNTRADED',reason:ledger.fillCount?null:why('NO_TRADES','첫 모의 거래를 기다립니다.'),lastSavedPerformance:{...values,source:'EVENT_PAPER_LEDGER',accountId:activity.accountId},allocation};
  }catch{return base;}
}
function eventCompanion(base,activities,workspace,asOf,envelopes){
  const ordered=[...activities].sort((a,b)=>(b.updatedAt??'').localeCompare(a.updatedAt??'')||String(b.id).localeCompare(String(a.id))),active=ordered.filter(a=>a.status!=='COMPLETED'),activity=active[0]??ordered[0],currency=eventCurrencyView(activity,asOf);
  const legacy=list(workspace.mindPositions).filter(a=>a.kind==='PAPER_ACCOUNT'&&a.profileId===base.profileId),sameCurrency=legacy.some(a=>a.quoteCurrency===activity.quoteCurrency);
  if(!active.length&&sameCurrency)return null;
  const duplicate=active.length>1||sameCurrency;
  if(duplicate){currency.status='DATA_REQUIRED';currency.equity=null;currency.netPnl=null;currency.netReturn=null;currency.lastSavedPerformance=null;currency.allocation=null;currency.reason=why('EVENT_PAPER_ACCOUNT_CONFLICT','같은 마인드의 모의 자금 배정을 확인하세요.');}
  const runtime=activity.runtime??{},last=activity.lastDecision,validLast=last&&iso(last.at)&&last.at<=asOf,lastDecision=validLast?{id:last.id,action:last.action,stance:last.stance??null,at:last.at,timeKind:'COMPLETED',instrumentId:last.instrumentId,isCurrent:false}:null;
  const heldIds=currency.heldInstrumentIds,enabled=activity.status==='ENABLED',paused=activity.status==='PAUSED',complete=activity.status==='COMPLETED',attention=currency.status==='DATA_REQUIRED'||!!runtime.errorCode||['EXTERNAL_OUTCOME_UNKNOWN','FRAME_REVIEW_REQUIRED'].includes(runtime.providerState),phase=attention?'attention':heldIds.length?'investing':enabled?'observing':'sleep';
  const label=attention?'운용 확인 필요':complete?'운용 종료':heldIds.length?(paused?'투자 중 · 일시중지':'투자 중'):paused?'일시중지':lastDecision?'다음 결정 대기':'첫 자동 실행 대기';
  const otherGroups=new Map();for(const account of legacy.filter(a=>a.quoteCurrency!==activity.quoteCurrency)){const group=otherGroups.get(account.quoteCurrency)??[];group.push(account);otherGroups.set(account.quoteCurrency,group);}
  const currencies=[currency,...[...otherGroups.values()].map(group=>currencyView(group,envelopes,workspace,asOf))].sort((a,b)=>a.currency.localeCompare(b.currency));
  const allHeld=[...new Set(currencies.flatMap(c=>c.heldInstrumentIds))],problem=currencies.find(c=>c.status==='DATA_REQUIRED'),requiresAttention=attention||!!problem,shownPhase=requiresAttention?'attention':allHeld.length?'investing':phase;
  return {...base,accountScope:'EVENT_PAPER_ALLOCATION',scopeLabel:'마인드 모의계좌',paperActivity:copy(activity),paperActivities:copy(ordered),connected:true,phase:shownPhase,label:requiresAttention?'운용 확인 필요':allHeld.length&&!heldIds.length?'투자 중':label,reason:requiresAttention?problem?.reason??why(runtime.errorCode??runtime.providerState,'모의 운용의 처리 기록을 확인하세요.'):currency.reason,currencies,holdings:{hasHoldings:allHeld.length>0,count:allHeld.length,instrumentIds:allHeld},automation:{...base.automation,enabled,status:activity.status,subscriptionId:activity.id,paused,requiresAttention,firstExecutionPending:enabled&&!lastDecision,sourceAsOf:activity.updatedAt},latestRunId:lastDecision?.id??null,lastDecision,sourceAsOf:latest([activity.updatedAt,...currencies.map(c=>c.asOf),lastDecision?.at]),nextAction:{type:'manage',label:'운용 관리',profileId:base.profileId}};
}

/** The visible card scope and its totals share the same validated account projection. */
function companionTotals(cards,asOf){
  const groups=new Map(),seenProfiles=new Set(),accountCurrencies=new Map();
  for(const card of cards){
    if(seenProfiles.has(card.profileId))continue;seenProfiles.add(card.profileId);
    for(const currency of card.currencies){
      if(currency.allocationStatus==='RELEASED'&&currency.status!=='DATA_REQUIRED')continue;
      const rows=groups.get(currency.currency)??[];rows.push({profileId:card.profileId,...currency});groups.set(currency.currency,rows);
      for(const id of currency.accountIds){const currencies=accountCurrencies.get(id)??new Set();currencies.add(currency.currency);accountCurrencies.set(id,currencies);}
    }
  }
  return [...groups].sort(([a],[b])=>a.localeCompare(b)).map(([currency,rows])=>{
    const accountIds=rows.flatMap(row=>row.accountIds),uniqueIds=[...new Set(accountIds)],base={currency,accountIds:uniqueIds,profileIds:rows.map(row=>row.profileId),accountCount:uniqueIds.length,status:'DATA_REQUIRED',equity:null,initialCapital:null,netPnl:null,netReturn:null,feesPaid:null,asOf:null,hasPerformance:rows.some(row=>row.hasPerformance),reason:null};
    if(accountIds.length!==uniqueIds.length||uniqueIds.some(id=>accountCurrencies.get(id).size!==1)||rows.some(row=>row.status==='DATA_REQUIRED'||row.accountIds.length!==1))return {...base,reason:why('AGGREGATE_ACCOUNT_REVIEW','계좌 기록 확인 필요')};
    const values=rows.map(row=>row.status==='STALE'?row.lastSavedPerformance:row);
    if(values.some(value=>!value||!iso(value.asOf)||!['equity','initialCapital','feesPaid'].every(key=>finite(value[key]))||value.initialCapital<=0))return {...base,reason:why('AGGREGATE_ACCOUNT_REVIEW','계좌 기록 확인 필요')};
    const holdings=rows.map((row,index)=>['CURRENT','STALE'].includes(row.status)?values[index]:null).filter(Boolean),basisAt=holdings[0]?.asOf??asOf;
    if(holdings.some(value=>value.asOf!==basisAt)||values.some(value=>value.asOf>basisAt))return {...base,status:'ASOF_ALIGNMENT_REQUIRED',reason:why('AGGREGATE_ASOF_ALIGNMENT','평가 시각 확인 필요')};
    const sum=key=>values.reduce((total,value)=>total+value[key],0),equity=sum('equity'),initialCapital=sum('initialCapital'),feesPaid=sum('feesPaid');
    if(![equity,initialCapital,feesPaid].every(finite)||initialCapital<=0)return {...base,reason:why('AGGREGATE_ACCOUNT_REVIEW','계좌 기록 확인 필요')};
    return {...base,status:!holdings.length?'CASH_ONLY':rows.some(row=>row.status==='STALE')?'SAVED':'CURRENT',equity,initialCapital,netPnl:sum('netPnl'),netReturn:sum('netPnl')/initialCapital,feesPaid,asOf:basisAt};
  });
}

export function paperRuns(workspace,profileId,asOf){
  return list(workspace.mindRuns).filter(r=>(profileId===null||r.profileId===profileId)&&r.experimentType==='FORWARD_PAPER'&&r.mode!=='replay'&&r.decision&&['buy','sell','hold'].includes(r.decision.action)&&iso(r.decisionAt)&&r.decisionAt<=asOf&&(!r.decisionCompletedAt||iso(r.decisionCompletedAt)&&r.decisionCompletedAt<=asOf)&&(!r.provider?.answeredAt||iso(r.provider.answeredAt)&&r.provider.answeredAt<=asOf)).sort((a,b)=>(completedAt(b)??b.decisionAt).localeCompare(completedAt(a)??a.decisionAt)||String(b.id).localeCompare(String(a.id)));
}
function completedAt(run){const at=run.decisionCompletedAt??run.provider?.answeredAt;return iso(at)?at:null;}

function clutchEpisode(accounts,runs,asOf){
  const candidates=[];
  for(const account of accounts){
    if(accountProblem(account,asOf))continue;
    for(const position of held(account)){
      const fills=account.ledger.filter(f=>f.instrumentId===position.instrumentId&&f.at<=asOf);
      let start=0;for(let i=0;i<fills.length;i++)if(fills[i].quantityAfter===0)start=i+1;
      const episode=fills.slice(start),activation=episode.findLast(f=>f.side==='buy'&&f.stance==='clutch'&&f.accountId===account.id&&f.profileId===account.profileId);
      if(!activation)continue;
      // A completed later stance can release an episode. Unexecuted clutch choices cannot create one.
      const laterFills=episode.filter(f=>f.at>activation.at),laterRuns=runs.filter(r=>r.instrumentId===position.instrumentId&&completedAt(r)&&completedAt(r)>activation.at);
      if(laterFills.some(f=>f.stance!=='clutch')||laterRuns.some(r=>r.decision.stance!=='clutch'))continue;
      candidates.push({accountId:account.id,instrumentId:position.instrumentId,episodeId:episode[0].id,activatedByFillId:activation.id,runId:activation.runId,activatedAt:activation.at,asOf:latest([activation.at,...laterRuns.map(completedAt),...laterFills.map(f=>f.at)]),source:'FILLED_CLUTCH_BUY_OPEN_EPISODE'});
    }
  }
  return candidates.sort((a,b)=>b.activatedAt.localeCompare(a.activatedAt))[0]??null;
}

function subscriptionView(raw,profileId,accounts,asOf,stored=[]){
  const ids=new Set(accounts.map(a=>a.id));
  const selected=list(raw).filter(s=>s.profileId===profileId&&ids.has(s.accountId)&&(s.executionMode==null||s.executionMode==='paper')&&(!s.updatedAt||iso(s.updatedAt)&&s.updatedAt<=asOf));
  const originalOf=s=>list(stored).find(v=>v.id===s.id&&v.profileId===s.profileId&&v.accountId===s.accountId&&(!v.updatedAt||iso(v.updatedAt)&&v.updatedAt<=asOf));
  const enabled=selected.filter(s=>s.enabled===true||s.status==='ENABLED');
  const unresolved=selected.find(s=>[s,originalOf(s)].filter(Boolean).some(record=>['ACTION_REQUIRED','JEV_STARTED'].includes(record.status)||list(record.attempts).some(a=>['ACTION_REQUIRED','JEV_STARTED'].includes(a.status))));
  const overdue=enabled.find(s=>{
    const bar=s.nextBarCloseAt??s.nextCloseAt;
    if(s.instrumentId!==BTC_4H_AUTO_COHORT_POLICY.instrumentId||s.timeframe!==BTC_4H_AUTO_COHORT_POLICY.timeframe||!iso(bar)||Date.parse(asOf)<=Date.parse(bar)+BTC_4H_AUTO_COHORT_POLICY.observation.executionOffsetMaxMs)return false;
    const original=originalOf(s);
    return ![s,original].filter(Boolean).some(record=>{
      const runtime=record.runtime??{},last=record.lastAttempt??runtime.lastAttempt,progress=['TRIGGERED','JEV_STARTED','DECISION_COMPLETED','OBSERVATION_SCHEDULED','PAPER_DECLINED','SKIPPED','ABANDONED','ACTION_REQUIRED','COMPLETED','FAILED'];
      return record.lastCompletedBarCloseAt===bar||record.lastCloseAt===bar||list(record.attempts).some(a=>a.barCloseAt===bar&&iso(a.reservedAt)&&a.reservedAt<=asOf)||last?.barCloseAt===bar&&progress.includes(last.stage)&&(!last.completedAt||iso(last.completedAt)&&last.completedAt<=asOf)||runtime.barCloseAt===bar&&progress.includes(runtime.stage);
    });
  });
  const active=unresolved??overdue??enabled[0]??selected[0],runtime=active?.runtime??{};
  const currentStatus=runtime.stage??active?.status,issueFailure=active?.lastFailure??runtime.lastFailure,issueAt=issueFailure?.occurredAt??issueFailure?.failedAt;
  const issue=['WAITING_DATA','RETRY_WAIT','LOCAL_COMPUTATION_INTERRUPTED','ACTION_REQUIRED','FAILED','EXECUTION_RETRY_REQUIRED','PAPER_DECLINED'].includes(currentStatus)&&issueFailure?.message&&iso(issueAt)&&issueAt<=asOf?{status:currentStatus,code:issueFailure.code??'AUTOMATION_INPUT_REQUIRED',message:issueFailure.message,at:issueAt}:null;
  const hasCompletedExecution=[active,active&&originalOf(active)].filter(Boolean).some(record=>{const last=record.lastAttempt??record.runtime?.lastAttempt;return list(record.attempts).some(attempt=>attempt.status==='COMPLETED'&&attempt.runId&&iso(attempt.completedAt)&&attempt.completedAt<=asOf)||Boolean(last?.decisionId&&['OBSERVATION_SCHEDULED','PAPER_DECLINED','COMPLETED'].includes(last.stage)&&iso(last.completedAt)&&last.completedAt<=asOf);});
  return {enabled:enabled.length>0,status:active?.status??'UNCONFIGURED',subscriptionId:active?.id??null,firstExecutionPending:enabled.length>0&&!hasCompletedExecution,paused:selected.length>0&&!enabled.length&&!unresolved,requiresAttention:Boolean(unresolved||overdue||issue),issue,nextBarCloseAt:active?.nextBarCloseAt??active?.nextCloseAt??null,nextEligibleAt:active?.nextEligibleAt??runtime.nextAttemptAt??null,lastMcpDeliveryAt:active?.lastMcpDeliveryAt??runtime.lastMcpDeliveryAt??null,nextCloudRunAt:null,sourceAsOf:latest(selected.map(s=>s.updatedAt)),reason:issue?why(issue.code,issue.message):unresolved?why('AUTOMATION_ACTION_REQUIRED','자동 운용의 처리 기록을 확인하세요.'):overdue?why('AUTOMATION_DELIVERY_UNCONFIRMED','예정 봉의 실행 허용 시간이 지났습니다. 자동 실행 기록을 확인하세요.'):null};
}

/**
 * Pure projection of owner read snapshots. `mode: live` on a FORWARD_PAPER run is a
 * price-source mode; only executionMode selects PAPER/LIVE here. No prices are fetched.
 * Phase priority: unresolved/invalid -> attention; filled open clutch episode -> clutch;
 * held quantities -> investing; enabled permission -> observing (waiting, not delivery);
 * explicit pause/no account -> sleep; valid cash -> idle. Stored valuation remains dated.
 */
export function buildMindCompanions({workspace={},minds=[],subscriptions,valuations=[],liveActivities,paperActivities,executionMode='paper',asOf}={}){
  if(!['paper','live'].includes(executionMode))throw new TypeError('executionMode는 paper 또는 live로 지정하세요.');
  if(!iso(asOf))throw new TypeError('카드 조회 시각을 UTC ISO 형식으로 지정하세요.');
  const definitions=list(minds).length?minds:list(workspace.investmentProfiles),envelopes=Array.isArray(valuations)?valuations:[valuations];
  const cards=definitions.map(mind=>{
    const manifest=policyOf(mind),profileId=mind.kind==='mind-policy'?manifest.scope.profileId:mind.id??manifest?.scope?.profileId,name=mind.name??manifest?.data?.name??profileId;
    const base={profileId,identity:profileId,name,appearance:readMindAppearance(workspace,profileId),policyVersion:mind.version??manifest?.data?.version??null,manifestId:mind.manifestId??manifest?.id??null,executionMode,accountScope:executionMode==='paper'?'MIND_PAPER_ACCOUNTS':'LIVE_ACCOUNTS',scopeLabel:executionMode==='paper'?'마인드 모의계좌':'실전 계좌',connected:false,phase:'sleep',label:'실전 연결 필요',reason:why('LIVE_CONNECTION_REQUIRED','실전 계좌와 주문 연결을 설정하세요.'),currencies:[],holdings:{hasHoldings:false,count:0,instrumentIds:[]},automation:{enabled:false,status:'UNCONNECTED',nextBarCloseAt:null,nextEligibleAt:null,lastMcpDeliveryAt:null,nextCloudRunAt:null},latestRunId:null,lastDecision:null,clutchEpisode:null,recentClutchEvent:null,sourceAsOf:null,nextAction:{type:'connect_live',label:'실전 연결 관리',profileId}};
    if(executionMode==='live'){
      const activity=list(liveActivities).find(item=>item.profileId===profileId);
      if(!activity)return {...base,label:liveActivities===undefined?'상태 조회 중':'시작 전',reason:null,automation:{...base.automation,status:liveActivities===undefined?'LOADING':'NOT_STARTED'},nextAction:{type:'manage',label:'운용 설정',profileId}};
      const ledger=activity.ledger,positions=list(ledger?.positions).filter(p=>Number(p.quantity)>0),enabled=activity.status==='ENABLED',paused=activity.status==='PAUSED',blocked=activity.runtime?.state==='BLOCKED',marketWait=activity.runtime?.state==='WAIT_MARKET_DATA'&&activity.runtime?.errorCode==='SCALP_PUBLIC_HTTP_429',attention=blocked||!marketWait&&!!activity.runtime?.errorCode||activity.status==='ACTION_REQUIRED';
      const hostStopped=activity.runtime?.hostStatus==='DISABLED';
      const last=activity.lastDecision,phase=attention?'attention':positions.length?'investing':enabled&&!hostStopped?'observing':'sleep',label=attention?'운용 확인 필요':hostStopped?(positions.length?'보유 중 / 실행 서버 중지':'실행 서버 중지'):paused?(positions.length?'보유 중 · 일시중지':'일시중지'):marketWait?'시세 재조회 중':positions.length?'보유 중':enabled?'매수 신호 대기':'운용 준비';
      return {...base,liveActivity:copy(activity),connected:true,phase,label,reason:blocked?why('LIVE_RUNTIME_BLOCKED','운용 자료와 연결을 확인한 뒤 새로고침해 주세요.'):null,holdings:{hasHoldings:positions.length>0,count:positions.length,instrumentIds:positions.map(p=>p.instrumentId)},automation:{...base.automation,enabled,status:activity.status,paused,requiresAttention:attention},latestRunId:last?.id??null,lastDecision:last?{id:last.id,action:last.action,at:last.at,instrumentId:last.instrumentId??activity.marketIds?.[0],isCurrent:false}:null,sourceAsOf:activity.runtime?.lastEvaluationAt??activity.runtime?.updatedAt??null,nextAction:{type:'manage',label:'운용 관리',profileId}};
    }
    const eventActivities=list(paperActivities).filter(a=>a.profileId===profileId&&a.executionMode==='paper');
    if(eventActivities.length){const event=eventCompanion(base,eventActivities,workspace,asOf,envelopes);if(event)return event;}
    const accounts=list(workspace.mindPositions).filter(a=>a.kind==='PAPER_ACCOUNT'&&a.profileId===profileId),valid=accounts.filter(a=>!accountProblem(a,asOf));
    const groups=new Map();for(const account of accounts){const items=groups.get(account.quoteCurrency)??[];items.push(account);groups.set(account.quoteCurrency,items);}
    const currencies=[...groups].sort(([a],[b])=>String(a).localeCompare(String(b))).map(([,items])=>currencyView(items,envelopes,workspace,asOf));
    const runs=paperRuns(workspace,profileId,asOf),run=runs[0],finished=run?completedAt(run):null;
    const lastDecision=run?{id:run.id,action:run.decision.action,stance:run.decision.stance??null,at:finished??run.decisionAt,timeKind:finished?'COMPLETED':'REQUESTED',instrumentId:run.instrumentId,isCurrent:false}:null;
    const instrumentIds=[...new Set(valid.flatMap(a=>held(a).map(p=>p.instrumentId)))].sort(),automation=subscriptionView(subscriptions??workspace.mindSubscriptions,profileId,accounts,asOf,workspace.mindSubscriptions),clutch=clutchEpisode(valid,runs,asOf);
    const invalid=currencies.find(c=>c.status==='DATA_REQUIRED');
    let phase,label,reason=null;
    if(automation.requiresAttention||invalid){phase='attention';label=automation.issue?.status==='WAITING_DATA'?'시세 자료 대기':automation.issue?'운용 확인 필요':automation.reason?.code==='AUTOMATION_DELIVERY_UNCONFIRMED'?'자동 실행 확인 필요':'확인 필요';reason=automation.reason??invalid.reason;}
    else if(clutch){phase='clutch';label=automation.paused?'클러치 보유 중 · 일시중지':'클러치 보유 중';reason=why('OPEN_CLUTCH_EPISODE','클러치 매수로 열린 보유를 유지하고 있습니다.');}
    else if(instrumentIds.length){phase='investing';label=automation.paused?'투자 중 · 일시중지':'투자 중';reason=why('OPEN_PAPER_POSITION','저장된 모의 보유 기록이 있습니다.');}
    else if(automation.enabled){phase='observing';label=automation.firstExecutionPending?'첫 자동 실행 대기':'다음 결정 대기';reason=why('AUTOMATION_ENABLED_WAITING','다음 확정 봉의 자동 운용을 허용했습니다.');}
    else if(automation.paused||!accounts.length){phase='sleep';label=accounts.length?'자동 운용 중지':'모의 자금 설정';reason=why(accounts.length?'AUTOMATION_PAUSED':'PAPER_ACCOUNT_REQUIRED',accounts.length?'자동 운용을 중지한 상태입니다.':'모의 계좌를 설정하세요.');}
    else {phase='idle';label='준비됨';reason=why('PAPER_CASH_READY','설정한 모의 자금으로 다음 투자를 준비합니다.');}
    return {...base,connected:accounts.length>0,phase,label,reason,currencies,holdings:{hasHoldings:instrumentIds.length>0,count:instrumentIds.length,instrumentIds},automation,latestRunId:run?.id??null,lastDecision,clutchEpisode:clutch,recentClutchEvent:clutch?{fillId:clutch.activatedByFillId,runId:clutch.runId,at:clutch.activatedAt,instrumentId:clutch.instrumentId}:null,sourceAsOf:latest([...valid.map(a=>a.asOf),lastDecision?.at,automation.sourceAsOf]),nextAction:{type:phase==='attention'?'review':accounts.length?'manage':'fund_paper',label:phase==='attention'?'처리 기록 확인':accounts.length?'마인드 관리':'모의 자금 설정',profileId,...(phase==='attention'&&run?{runId:run.id}:{})}};
  });
  return {schemaVersion:1,policyVersion:MIND_COMPANION_POLICY,executionMode,asOf,cards:copy(cards.map(card=>({...card,game:cardGame(card,{workspace,asOf})}))),summaries:executionMode==='paper'?companionTotals(cards,asOf):[]};
}
