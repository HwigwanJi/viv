import {buildMindCompanions} from '../dist/domain/mind-companion.mjs';
import {validateMindPaperAccount} from '../dist/domain/mind-paper.mjs';
import {paperBudgetSummary,validatePaperBudgets} from '../dist/domain/paper-budget.mjs';
import {hashInputPackage} from '../dist/domain/workspace.mjs';
import {buildMindValuation} from './mind-valuations.mjs';
import {RepositoryError} from './repository.mjs';
import {buildHomePeriodPerformance,selectHomePeriodMetric,HOME_24H_POLICY} from './home-period-performance.mjs';
import {readLiveAutomationActivity} from './live-automation-read-model.mjs';
import {readEventPaperActivity} from './event-paper-store.mjs';
import {refreshInvestorValuations,projectPaperInvestorPerformance} from './mind-investor-performance.mjs';

export const HOME_PERFORMANCE_POLICY='OWNER_OPERATIONAL_PERFORMANCE_V1';
const DAY=86400000,MAX_AGE=30000,list=v=>Array.isArray(v)?v:[],finite=v=>typeof v==='number'&&Number.isFinite(v);
const iso=v=>typeof v==='string'&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString()===v;
const currencies=['KRW','USD','USDT','BTC'],round=n=>Math.round(n*1e8)/1e8;
const reason=(code,message)=>({code,message}),sum=(rows,key)=>rows.reduce((n,r)=>n+r[key],0);
const ready=c=>['CURRENT','CASH_ONLY','UNTRADED'].includes(c.status);
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const unavailable=(code,message,extra={})=>({status:'DATA_REQUIRED',returnRatio:null,pnl:null,...extra,reason:reason(code,message)});
const funded=a=>a.initialCash+list(a.fundingLedger).reduce((n,f)=>n+Math.max(0,f.amount),0);
const netFunding=a=>list(a.fundingLedger).reduce((n,f)=>n+f.amount,0);
const policy={allTime:{method:'NET_PROFIT_OVER_GROSS_CONTRIBUTIONS',formula:'(equity - initialCapital - deposits + withdrawals) / (initialCapital + deposits)'},last24h:{method:'MODIFIED_DIETZ_EXACT_24H',formula:'(endingEquity - startingEquity - netExternalFlows) / (startingEquity + timeWeightedExternalFlows)',durationMs:DAY,startingMark:'EXACT_BOUNDARY_OR_RECONSTRUCTED_CASH'},ranking:{scope:'PER_CURRENCY_AND_EXECUTION_MODE',order:'RETURN_DESC',eligible:'VALID_CURRENT_ACCOUNT_WITH_EXECUTED_TRADE',ties:'SHARED_RANK'},costs:'ACCOUNT_LEDGER_INCLUDES_TRADING_COSTS_API_BILLING_EXCLUDED'};
const LIVE_METHOD='OWN_ACTIVATION_NET_EQUITY_OVER_ALLOCATED_CAPITAL',SCALE=10n**18n;
function liveUnits(value){if(typeof value!=='string'||!/^[-]?\d+(?:\.\d{1,18})?$/.test(value))throw Error('Invalid stored live decimal');const negative=value.startsWith('-'),[whole,fraction='']=(negative?value.slice(1):value).split('.');return (negative?-1n:1n)*(BigInt(whole)*SCALE+BigInt(fraction.padEnd(18,'0')));}
function liveDecimal(value){const negative=value<0n;if(negative)value=-value;const fraction=(value%SCALE).toString().padStart(18,'0').replace(/0+$/,'');return (negative?'-':'')+value/SCALE+(fraction?'.'+fraction:'');}
function selectedLiveActivities(value,asOf){
 const rows=Array.isArray(value)?value:list(value?.items),duplicates=new Set(rows.filter((item,index)=>rows.some((other,i)=>i!==index&&other.activationId===item.activationId)).map(item=>item.activationId)),seen=new Set();
 return rows.filter(item=>item&&typeof item.profileId==='string'&&typeof item.activationId==='string'&&iso(item.userConfirmedAt)&&item.userConfirmedAt<=asOf).slice().sort((a,b)=>Number(b.status==='ENABLED')-Number(a.status==='ENABLED')||b.userConfirmedAt.localeCompare(a.userConfirmedAt)).filter(item=>!seen.has(item.profileId)&&seen.add(item.profileId)).map(item=>duplicates.has(item.activationId)?{...item,ledger:{...item.ledger,status:'INVALID_LEDGER'}}:item);
}
function livePerformance(activity,asOf){
 const ledger=activity.ledger??{},startAt=new Date(Date.parse(asOf)-DAY).toISOString(),rows=list(activity.recentActivity),filled=rows.filter(row=>row.kind==='STRATEGY_ORDER'&&typeof row.filledQuantity==='string'&&Number(row.filledQuantity)>0),recent=filled.filter(row=>iso(row.lastFillAt)&&row.lastFillAt>startAt&&row.lastFillAt<=asOf),activityCounts={observedOrderCount:rows.filter(row=>row.kind==='STRATEGY_ORDER').length,observedFilledOrderCount:filled.length,observedOrdersWithFillIn24h:recent.length,observedBuyOrdersWithFillIn24h:recent.filter(row=>row.action==='buy').length,observedSellOrdersWithFillIn24h:recent.filter(row=>row.action==='sell').length,fillTimeUnavailableOrderCount:filled.filter(row=>!iso(row.lastFillAt)).length,coverage:'BOUNDED_SAVED_ACTIVITY_MAX_30',complete:false};
 const base={accountId:activity.accountId,activationId:activity.activationId,currency:activity.quoteCurrency,asOf:ledger.asOf??asOf,ledgerAsOf:ledger.ledgerAsOf??null,valuationAsOf:ledger.valuationAsOf??null,createdAt:activity.userConfirmedAt,initialCapital:ledger.initialCapital??null,ownedCostBasis:ledger.ownedCostBasis??null,realizedPnl:ledger.realizedPnl??null,feesPaid:ledger.feesPaid??null,hasPerformance:false,activityCounts};
 const last24h=unavailable('LIVE_24H_BOUNDARY_VALUATION_REQUIRED','24시간 시작·종료의 검증된 운용 평가 기록이 필요합니다.',{method:'NOT_COMPUTED_WITHOUT_LIVE_BOUNDARY_VALUATIONS',startAt,endAt:asOf,...activityCounts});
 try{
  if(ledger.status!=='READY'||ledger.quoteCurrency!==activity.quoteCurrency||!iso(ledger.ledgerAsOf)||ledger.ledgerAsOf>asOf)throw Error('Live ledger unavailable');
  const capital=liveUnits(ledger.initialCapital),realized=liveUnits(ledger.realizedPnl),fees=liveUnits(ledger.feesPaid),cost=liveUnits(ledger.ownedCostBasis);
  if(capital<=0n||fees<0n||cost<0n)throw Error('Live capital unavailable');
  const hasPerformance=fees>0n||cost>0n||realized!==0n||filled.length>0;
  const shared={...base,hasPerformance};
  if(!hasPerformance)return {...shared,allTime:unavailable('NO_EXECUTED_TRADES','첫 운용 거래를 기다립니다.'),last24h};
  const investor=activity.investorMetrics;
  if(investor?.status==='DATA_REQUIRED')return {...shared,allTime:unavailable('INVESTOR_LEDGER_REVIEW',investor.reason),last24h};
  if(investor?.status==='READY'&&investor.asOf<=asOf&&Number.isFinite(investor.flowAdjustedReturn))return {...shared,allTime:{status:'READY',activationId:activity.activationId,returnRatio:investor.flowAdjustedReturn,pnl:investor.pnl,capitalBase:investor.timeWeightedCapital,initialCapital:investor.initialCapital,realizedPnl:investor.realizedPnl,feesPaid:investor.feesPaid,ownedCostBasis:ledger.ownedCostBasis,startingEquity:investor.initialCapital,endingEquity:investor.equity,startAt:investor.startAt,endAt:investor.asOf,valuationAsOf:investor.valuationAt,ledgerAsOf:investor.ledgerAsOf,method:'OWN_ACTIVATION_MODIFIED_DIETZ',netExternalFlows:liveDecimal(liveUnits(investor.netContributions)-liveUnits(investor.initialCapital)),fundingIncluded:true,reason:null},last24h};
  if(ledger.equity===null||!iso(ledger.valuationAsOf)||ledger.valuationAsOf>asOf)return {...shared,allTime:unavailable('CURRENT_LIVE_VALUATION_REQUIRED','보유 자산의 검증된 현재 평가액이 필요합니다.'),last24h};
  const equity=liveUnits(ledger.equity),pnl=equity-capital,returnRatio=Number(pnl)/Number(capital);
  if(equity<0n||!finite(returnRatio))throw Error('Live equity unavailable');
  return {...shared,allTime:{status:'READY',activationId:activity.activationId,returnRatio,pnl:liveDecimal(pnl),capitalBase:liveDecimal(capital),initialCapital:liveDecimal(capital),realizedPnl:liveDecimal(realized),ownedCostBasis:liveDecimal(cost),feesPaid:liveDecimal(fees),startingEquity:liveDecimal(capital),endingEquity:liveDecimal(equity),startAt:activity.userConfirmedAt,endAt:asOf,valuationAsOf:ledger.valuationAsOf,ledgerAsOf:ledger.ledgerAsOf,method:LIVE_METHOD,executionEvidence:'OWN_ACTIVATION_AGGREGATE_LEDGER_AND_SAVED_ORDERS',fundingIncluded:false,reason:null},last24h};
 }catch{return {...base,allTime:unavailable('LIVE_EXECUTION_LEDGER_REQUIRED','검증된 실전 운용 원장을 확인하세요.'),last24h};}
}
function paperEventPerformance(activity,asOf){
 const ledger=activity.ledger??{},capital=ledger.initialCapital,base={subscriptionId:activity.id,accountId:activity.accountId,currency:activity.quoteCurrency,asOf:ledger.asOf,ledgerAsOf:ledger.ledgerAsOf,valuationAsOf:ledger.valuationAsOf,createdAt:activity.createdAt,initialCapital:capital,realizedPnl:ledger.realizedPnl,feesPaid:ledger.feesPaid,hasPerformance:ledger.fillCount>0},startAt=new Date(Date.parse(asOf)-DAY).toISOString(),last24h=unavailable('EVENT_PAPER_24H_BOUNDARY_REQUIRED','24시간 시작·종료의 운용 평가 기록이 필요합니다.',{method:'EXACT_EVENT_PAPER_BOUNDARY_VALUATIONS_REQUIRED',startAt,endAt:asOf});
 try{
  if(ledger.status!=='READY'||ledger.quoteCurrency!==activity.quoteCurrency||!iso(ledger.ledgerAsOf)||ledger.ledgerAsOf>asOf||!iso(activity.createdAt)||activity.createdAt>asOf)throw Error('Invalid event ledger');
  const principal=liveUnits(capital);if(principal<=0n)throw Error('Invalid event principal');
  if(!base.hasPerformance)return {...base,allTime:unavailable('NO_EXECUTED_TRADES','첫 모의 거래를 기다립니다.'),last24h};
  if(ledger.equity===null||!iso(ledger.valuationAsOf)||ledger.valuationAsOf>asOf)return {...base,allTime:unavailable('EVENT_PAPER_MARK_REQUIRED','보유 자산의 최근 관측 호가를 기다립니다.'),last24h};
  const equity=liveUnits(ledger.equity),profit=equity-principal;if(equity<0n||!Number.isFinite(Number(profit)/Number(principal)))throw Error('Invalid event equity');
  return {...base,allTime:{status:'READY',subscriptionId:activity.id,accountId:activity.accountId,returnRatio:Number(profit)/Number(principal),pnl:liveDecimal(profit),capitalBase:capital,startingEquity:capital,endingEquity:ledger.equity,startAt:activity.createdAt,endAt:activity.status==='COMPLETED'?activity.updatedAt:asOf,valuationAsOf:ledger.valuationAsOf,ledgerAsOf:ledger.ledgerAsOf,method:'CANONICAL_EVENT_PAPER_NET_EQUITY_OVER_ALLOCATED_CAPITAL',executionEvidence:'OWN_EVENT_PAPER_CONNECTOR_LEDGER',reason:null},last24h};
 }catch{return {...base,allTime:unavailable('EVENT_PAPER_LEDGER_REQUIRED','원 모의 운용 원장을 확인하세요.'),last24h};}
}

function safeAccount(a,asOf){
  try{return !validateMindPaperAccount(a).length&&[a.asOf,a.updatedAt,a.createdAt].every(at=>at<=asOf)&&list(a.ledger).every(f=>f.at<=asOf)&&list(a.fundingLedger).every(f=>f.at<=asOf);}catch{return false;}
}

// A cash-only boundary is exactly recoverable from the validated ledger. A held
// boundary requires an actual contemporaneous valuation; later prices never fill it.
function startingEquity(workspace,account,at){
  if(account.createdAt>at)return null;
  let cash=account.initialCash;const quantities=new Map();
  const timeline=[...account.ledger.map((f,i)=>({...f,_order:i,_fund:false})),...list(account.fundingLedger).map((f,i)=>({...f,_order:f.ledgerOffset,_fund:true,_sequence:i}))].sort((a,b)=>a._order-b._order||Number(b._fund)-Number(a._fund)||(a._sequence??0)-(b._sequence??0));
  for(const e of timeline.filter(e=>e.at<=at)){if(e._fund)cash=round(cash+e.amount);else {cash=e.cashAfter;quantities.set(e.instrumentId,e.quantityAfter);}}
  if([...quantities.values()].every(q=>q===0))return {equity:cash,asOf:at,source:'RECONSTRUCTED_CASH_LEDGER',sourceRunId:null};
  const candidates=[{account,runId:null}];
  for(const run of list(workspace.mindRuns))if(run.profileId===account.profileId&&run.experimentType==='FORWARD_PAPER'&&run.mode!=='replay')for(const a of [run.accountSnapshot,run.execution?.accountSnapshotAfter])if(a)candidates.push({account:a,runId:run.id});
  for(const {account:s,runId} of candidates){
    if(s.id!==account.id||s.profileId!==account.profileId||s.quoteCurrency!==account.quoteCurrency||s.initialCash!==account.initialCash||s.asOf!==at||!safeAccount(s,at)||!same(s.ledger,account.ledger.filter(f=>f.at<=at))||!same(s.fundingLedger??[],list(account.fundingLedger).filter(f=>f.at<=at)))continue;
    if(s.positions.some(p=>!iso(p.priceAsOf)||!iso(p.priceReceivedAt)||p.priceAsOf>p.priceReceivedAt||p.priceReceivedAt>at||Date.parse(at)-Date.parse(p.priceAsOf)>MAX_AGE))continue;
    return {equity:s.equity,asOf:at,source:'STORED_ACCOUNT_VALUATION',sourceRunId:runId};
  }
  return null;
}

function accountPerformance(workspace,account,currency,asOf){
  const base={accountId:account.id,currency:account.quoteCurrency,asOf:currency.asOf,createdAt:account.createdAt,hasPerformance:currency.hasPerformance};
  if(!safeAccount(account,asOf)||!ready(currency))return {...base,allTime:unavailable('CURRENT_VALUATION_REQUIRED','현재 평가액을 갱신하세요.'),last24h:unavailable('CURRENT_VALUATION_REQUIRED','현재 평가액을 갱신하세요.')};
  if(!currency.hasPerformance)return {...base,allTime:unavailable('NO_EXECUTED_TRADES','첫 운용 거래를 기다립니다.'),last24h:unavailable('NO_EXECUTED_TRADES','첫 운용 거래를 기다립니다.')};
  const endingEquity=currency.equity,capital=funded(account),pnl=endingEquity-account.initialCash-netFunding(account);
  const allTime={status:'READY',returnRatio:pnl/capital,pnl,capitalBase:capital,startAt:account.createdAt,endAt:asOf,valuationAsOf:currency.asOf,method:policy.allTime.method,reason:null};
  const startAt=new Date(Date.parse(asOf)-DAY).toISOString(),start=startingEquity(workspace,account,startAt);
  if(!start)return {...base,allTime,last24h:unavailable(account.createdAt>startAt?'ACCOUNT_YOUNGER_THAN_24H':'START_VALUATION_REQUIRED',account.createdAt>startAt?'24시간 운용 기록을 기다립니다.':'24시간 전 계좌 평가 기록이 필요합니다.',{startAt,endAt:asOf,method:policy.last24h.method})};
  const flows=list(account.fundingLedger).filter(f=>f.at>startAt&&f.at<=asOf),externalFlows=flows.reduce((n,f)=>n+f.amount,0),weightedFlows=flows.reduce((n,f)=>n+f.amount*(Date.parse(asOf)-Date.parse(f.at))/DAY,0),capitalBase=start.equity+weightedFlows,profit=endingEquity-start.equity-externalFlows;
  const last24h=capitalBase>0?{status:'READY',returnRatio:profit/capitalBase,pnl:profit,capitalBase,startingEquity:start.equity,endingEquity,netExternalFlows:externalFlows,timeWeightedExternalFlows:weightedFlows,startAt,endAt:asOf,valuationAsOf:currency.asOf,startingSource:start.source,sourceRunId:start.sourceRunId,method:policy.last24h.method,reason:null}:unavailable('POSITIVE_CAPITAL_BASE_REQUIRED','평가 기간의 투자 원금을 확인하세요.',{startAt,endAt:asOf,method:policy.last24h.method});
  return {...base,allTime,last24h};
}

function ranks(cards,currency,period){
  const excluded=[],items=[];
  for(const card of cards){const row=card.performance.find(p=>p.currency===currency);if(!row)continue;const metric=row[period];
    if(metric?.status==='READY'&&finite(metric.returnRatio))items.push({profileId:card.profileId,name:card.name,identity:card.identity,appearance:card.appearance,phase:card.phase,label:card.label,accountId:row.accountId,currency,...metric});
    else excluded.push({profileId:card.profileId,accountId:row.accountId,reason:metric?.reason??reason('PERFORMANCE_UNAVAILABLE','운용 기록을 확인하세요.')});
  }
  items.sort((a,b)=>b.returnRatio-a.returnRatio||a.profileId.localeCompare(b.profileId));
  items.forEach((r,i)=>r.rank=i&&r.returnRatio===items[i-1].returnRatio?items[i-1].rank:i+1);
  return {status:items.length?'READY':'EMPTY',period,items,winner:items[0]??null,excluded,eligibleCount:items.length,reason:items.length?null:reason('ELIGIBLE_PERFORMANCE_REQUIRED','평가 가능한 운용 기록을 기다립니다.')};
}

function paperSummaries(workspace,cards,asOf,paperActivities=[]){
  const accounts=list(workspace.mindPositions).filter(a=>a.kind==='PAPER_ACCOUNT'),allCurrencies=[...new Set([...accounts.map(a=>a.quoteCurrency),...list(workspace.mindPositions).filter(a=>a.kind==='PAPER_BUDGET').map(b=>b.quoteCurrency)])].sort();
  return allCurrencies.map(currency=>{
    const summary=paperBudgetSummary(workspace,currency,{eventLedgers:paperActivities.map(a=>a.ledger)}),rows=accounts.filter(a=>a.quoteCurrency===currency),budget=list(workspace.mindPositions).find(a=>a.kind==='PAPER_BUDGET'&&a.quoteCurrency===currency),views=rows.map(a=>cards.find(c=>c.profileId===a.profileId)?.currencies.find(c=>c.accountIds.includes(a.id)));
    const base={currency,scope:'PAPER_BUDGET_AND_MIND_ACCOUNTS',accountIds:rows.map(a=>a.id),accountCount:rows.length,budgetId:budget?.id??null,budget:summary.totalBudget,allocated:summary.allocated,unallocatedCash:summary.available,asOf,netPnl:null,returnRatio:null,equity:null,cash:null,holdingsValue:null,feesPaid:null,hasPerformance:rows.some(a=>a.ledger?.length),status:'DATA_REQUIRED',reason:null};
    const duplicate=rows.some(a=>accounts.filter(b=>b.id===a.id).length!==1||accounts.filter(b=>b.profileId===a.profileId&&b.quoteCurrency===currency).length!==1);
    if(summary.externalAllocations.length||list(workspace.mindPositions).some(a=>a.kind==='EVENT_PAPER_ALLOCATION'&&a.quoteCurrency===currency&&a.releasedAt)){
      const active=paperActivities.filter(a=>a.quoteCurrency===currency&&a.ledger?.allocationStatus==='ALLOCATED'),eventIds=active.map(a=>a.accountId),eventFees=paperActivities.filter(a=>a.quoteCurrency===currency).reduce((n,a)=>n+Number(a.ledger.feesPaid),0),hasPerformance=base.hasPerformance||paperActivities.some(a=>a.quoteCurrency===currency&&a.ledger?.fillCount>0),invalid=duplicate||validatePaperBudgets(workspace).length||rows.some(a=>!safeAccount(a,asOf))||views.some(v=>!v||!ready(v))||summary.equity===null||summary.cash===null||!finite(eventFees);
      if(invalid)return {...base,hasPerformance,accountIds:[...base.accountIds,...eventIds],accountCount:base.accountCount+eventIds.length,reason:reason('EVENT_PAPER_VALUATION_REQUIRED','같은 원장의 모의 계좌와 최근 호가를 확인하세요.')};
      const capitalBase=budget?.totalBudget??summary.totalBudget,exactNetPnl=liveUnits(summary.exactEquity)-liveUnits(capitalBase.toFixed(8)),netPnl=Number(liveDecimal(exactNetPnl));
      return {...base,hasPerformance,scope:'PAPER_BUDGET_LEGACY_AND_EVENT_CONNECTOR_ALLOCATIONS',accountIds:[...base.accountIds,...eventIds],accountCount:base.accountCount+eventIds.length,status:'READY',cash:summary.cash,equity:summary.equity,holdingsValue:summary.holdingsValue,netPnl:hasPerformance?netPnl:null,exactNetPnl:hasPerformance?liveDecimal(exactNetPnl):null,returnRatio:hasPerformance&&capitalBase>0?netPnl/capitalBase:null,capitalBase,feesPaid:sum(views,'feesPaid')+eventFees,valuationAsOf:[...new Set([...views.map(v=>v.asOf),...active.map(a=>a.ledger.valuationAsOf)])],exactCash:summary.exactCash,exactEquity:summary.exactEquity,exactHoldingsValue:summary.exactHoldingsValue,exactAvailable:summary.exactAvailable,precisionRemainder:summary.precisionRemainder,reason:null};
    }
    if(duplicate||validatePaperBudgets(workspace).length||rows.some(a=>!safeAccount(a,asOf))||views.some(v=>!v||!ready(v)))return {...base,reason:reason('ACCOUNT_VALUATION_REQUIRED','계좌와 현재 평가액을 확인하세요.')};
    const cash=summary.available+rows.reduce((n,a)=>n+a.cash,0),equity=summary.available+sum(views,'equity'),netPnl=equity-summary.totalBudget;
    let capitalBase=rows.reduce((n,a)=>n+funded(a),0);
    if(budget){const changes=list(budget.history).filter(h=>finite(h.previousBudget)&&finite(h.totalBudget));capitalBase=changes.length?changes[0].previousBudget+changes.reduce((n,h)=>n+Math.max(0,h.totalBudget-h.previousBudget),0):budget.totalBudget;}
    return {...base,status:'READY',cash,equity,holdingsValue:equity-cash,netPnl:base.hasPerformance?netPnl:null,returnRatio:base.hasPerformance&&capitalBase>0?netPnl/capitalBase:null,capitalBase,feesPaid:sum(views,'feesPaid'),valuationAsOf:[...new Set(views.map(v=>v.asOf))],reason:null};
  });
}

function liveSummaries(connections,asOf){
  const groups=new Map();
  for(const connection of list(connections)){
    const snapshot=connection.snapshot;if(!['toss','upbit'].includes(connection.provider)||snapshot?.provider!==connection.provider||!iso(snapshot.asOf)||snapshot.asOf>asOf)continue;
    for(const account of list(snapshot.accounts))for(const row of list(account.currencies)){
      if(!currencies.includes(row.currency)||typeof account.id!=='string')continue;
      const rows=groups.get(row.currency)??[];rows.push({accountId:connection.provider+':'+account.id,provider:connection.provider,currency:row.currency,available:finite(row.available)&&row.available>=0?row.available:null,cash:finite(row.cash)&&row.cash>=0?row.cash:null,holdingsValue:finite(row.holdingsValue)&&row.holdingsValue>=0?row.holdingsValue:null,equity:finite(row.equity)&&row.equity>=0?row.equity:null,cashBasis:row.cashBasis??'CASH_BALANCE',asOf:snapshot.asOf});groups.set(row.currency,rows);
    }
  }
  return [...groups].sort(([a],[b])=>a.localeCompare(b)).map(([currency,rows])=>{
    const unique=new Set(rows.map(r=>r.accountId)),duplicate=unique.size!==rows.length,aggregate=key=>!duplicate&&rows.every(r=>finite(r[key]))?sum(rows,key):null;
    return {currency,scope:'CONNECTED_BROKER_ACCOUNTS',status:duplicate?'DATA_REQUIRED':'SAVED',accountIds:[...unique],accountCount:unique.size,asOf:null,valuationAsOf:[...new Set(rows.map(r=>r.asOf))].sort(),available:aggregate('available'),cash:aggregate('cash'),holdingsValue:aggregate('holdingsValue'),equity:aggregate('equity'),netPnl:null,returnRatio:null,hasPerformance:false,accounts:duplicate?[]:rows,reason:reason(duplicate?'DUPLICATE_BROKER_ACCOUNT':'LIVE_PERFORMANCE_HISTORY_REQUIRED',duplicate?'중복 계좌 참조를 확인하세요.':'실전 체결·입출금·평가 기록을 연결하세요.')};
  });
}

function experimentViews(reports,asOf,workspace){
  return list(reports).flatMap(entry=>{
    const r=entry.report??entry,{reportHash,...body}=r??{};
    if(entry.archivedAt||workspace.investmentProfiles?.find(p=>p.id===r?.config?.mindId)?.status==='ARCHIVED'||r?.status!=='COMPLETED'||!iso(r.completedAt)||r.completedAt>asOf||!reportHash||hashInputPackage(body)!==reportHash||!finite(r.metrics?.totalReturn)||!finite(r.metrics?.maxDrawdown)||r.source?.synthetic!==false)return [];
    const warmup=r.coverage?.warmupFrames??null,total=r.coverage?.totalDecisionFrames??null,readyFrames=r.coverage?.readyFrames??null;
    const instrumentId=r.source?.dataInstrumentId??r.source?.instrumentId??r.pins?.dataInstrumentId??null,quoteCurrency=r.source?.quoteCurrency??r.pins?.quoteCurrency??null;
    const modelKind=r.config?.mode??r.mode??null,strategyLabel=({MECHANICAL:'기준 퀀트 전략',GRAPH_CANONICAL:'마인드 전략',JEV_RETROSPECTIVE:'마인드 · JEV'})[modelKind]??null;
    return [{simulationId:r.simulationId,profileId:r.config?.mindId??null,profileName:list(workspace.investmentProfiles).find(p=>p.id===r.config?.mindId)?.name??null,name:r.name,modelKind,strategyLabel,kind:'HISTORICAL_SIMULATION',executionMode:'simulation',completedAt:r.completedAt,startAt:r.config?.startAt,endAt:r.config?.endAt,instrumentId,symbol:r.source?.symbol??instrumentId?.split(':').at(-1)??null,policyInstrumentId:r.source?.policyInstrumentId??r.pins?.policyInstrumentId??null,currency:quoteCurrency,quoteCurrency,initialCapital:r.metrics.initialEquity,returnRatio:r.metrics.totalReturn,maxDrawdown:r.metrics.maxDrawdown,tradeCount:r.metrics.tradeCount,hasPerformance:r.metrics.tradeCount>0,evaluationStatus:warmup===0&&Number.isSafeInteger(total)&&total>0&&readyFrames===total?'FULL_WINDOW':'PARTIAL_WINDOW',readyFrames,totalFrames:total,manifestId:r.pins?.manifestId??null,manifestHash:r.pins?.manifestHash??null,reportHash}];
  }).sort((a,b)=>b.completedAt.localeCompare(a.completedAt)||a.simulationId.localeCompare(b.simulationId));
}

/** Pure, owner-scoped projection. No fixture, FX conversion or historical simulation enters an operating ranking. */
export function buildHomePerformance({workspace={},valuations=[],periodValuations=null,brokerConnections=[],liveActivities=[],paperActivities=[],simulationHighlights=[],simulationBestCandidates,executionMode='paper',asOf}={}){
  if(!['paper','live'].includes(executionMode)||!iso(asOf))throw new RepositoryError('HOME_PERFORMANCE_QUERY','운용 모드와 조회 시각을 확인하세요.',400);
  const live=executionMode==='live'?selectedLiveActivities(liveActivities,asOf):[],paper=executionMode==='paper'?paperActivities:[],companions=buildMindCompanions({workspace,valuations,liveActivities:live,paperActivities:paper,executionMode,asOf}),seen=new Set();
  const allCards=companions.cards.filter(c=>{if(seen.has(c.profileId))return false;seen.add(c.profileId);return true;}).map(card=>{
    if(executionMode==='live')return {...card,eventStream:!!card.liveActivity,performance:card.liveActivity?[livePerformance(card.liveActivity,asOf)]:[]};
    if(card.paperActivity){const metric=paperEventPerformance(card.paperActivity,asOf),currency=card.currencies.find(c=>c.currency===card.paperActivity.quoteCurrency);if(!currency||!ready(currency))metric.allTime=unavailable(currency?.reason?.code??'EVENT_PAPER_LEDGER_REQUIRED',currency?.reason?.message??'모의 운용 원장을 확인하세요.');return {...card,eventStream:true,performance:[metric]};}
    const performance=card.currencies.map(c=>{
      const account=list(workspace.mindPositions).find(a=>a.id===c.accountIds[0]&&a.profileId===card.profileId&&a.kind==='PAPER_ACCOUNT');
      if(!account||c.accountIds.length!==1||list(workspace.mindPositions).filter(a=>a.kind==='PAPER_ACCOUNT'&&a.id===account.id).length!==1)return {currency:c.currency,accountId:account?.id??null,allTime:unavailable('DUPLICATE_ACCOUNT','계좌 참조를 확인하세요.'),last24h:unavailable('DUPLICATE_ACCOUNT','계좌 참조를 확인하세요.')};
      const performance=accountPerformance(workspace,account,c,asOf),period=selectHomePeriodMetric(periodValuations,account,workspace,asOf);return period?{...performance,last24h:period}:performance;
    });return {...card,performance};
  });
  const archived=new Set(list(workspace.investmentProfiles).filter(p=>p.status==='ARCHIVED').map(p=>p.id)),cards=allCards.filter(c=>!archived.has(c.profileId)||executionMode==='live'&&c.liveActivity?.status==='ENABLED');
  if(executionMode==='live')cards.sort((a,b)=>Number(b.automation.enabled)-Number(a.automation.enabled)||Number(!!b.liveActivity)-Number(!!a.liveActivity)||String(b.liveActivity?.userConfirmedAt??'').localeCompare(String(a.liveActivity?.userConfirmedAt??'')));
  const rankingCurrencies=[...new Set(cards.flatMap(c=>c.performance.map(p=>p.currency)))].sort();
  const rankings=rankingCurrencies.map(currency=>({currency,allTime:ranks(cards,currency,'allTime'),last24h:ranks(cards,currency,'last24h')}));
  const experiments=experimentViews(simulationHighlights,asOf,workspace),eligible=experimentViews(simulationBestCandidates??simulationHighlights,asOf,workspace).filter(r=>r.evaluationStatus==='FULL_WINDOW'&&r.hasPerformance).sort((a,b)=>b.returnRatio-a.returnRatio||b.completedAt.localeCompare(a.completedAt)||a.simulationId.localeCompare(b.simulationId)),best=eligible[0]??null;
  const selectionScope=simulationBestCandidates?'OWNER_COMPLETED_FULL_WINDOW_REPORTS':'PROVIDED_COMPLETED_FULL_WINDOW_REPORTS',leaderIds=new Set(),experimentLeaders=eligible.filter(r=>{if(!r.profileId||leaderIds.has(r.profileId))return false;leaderIds.add(r.profileId);return true;}).map(r=>({...r,selectionScope}));
  const readPolicy=structuredClone(policy);if(periodValuations?.policyVersion===HOME_24H_POLICY)Object.assign(readPolicy.last24h,{method:HOME_24H_POLICY,startingMark:'LEDGER_AND_PUBLIC_CONFIRMED_1H_CLOSE',endingMark:'LEDGER_AND_PUBLIC_CONFIRMED_1H_CLOSE'});
  if(executionMode==='live'){readPolicy.allTime=cards.some(c=>c.liveActivity?.investorMetrics)?{method:'OWN_ACTIVATION_MODIFIED_DIETZ',formula:'(endingEquity - initialCapital - netExternalFlows) / (initialCapital + elapsedTimeWeightedExternalFlows)',denominator:'OWN_ACTIVATION_ELAPSED_TIME_WEIGHTED_CAPITAL',fundingIncluded:true}: {method:LIVE_METHOD,formula:'(ownActivationEquity - ownAllocatedCapital) / ownAllocatedCapital',denominator:'OWN_ACTIVATION_INITIAL_CAPITAL',fundingIncluded:false};readPolicy.last24h={method:'NOT_COMPUTED_WITHOUT_LIVE_BOUNDARY_VALUATIONS',durationMs:DAY,activity:'OBSERVED_ORDERS_WITH_ACTUAL_TRADE_TIMESTAMP_IN_WINDOW',activityCoverage:'BOUNDED_SAVED_ACTIVITY_MAX_30'};}
  return {schemaVersion:1,policyVersion:HOME_PERFORMANCE_POLICY,executionMode,asOf,revision:workspace.revision??null,policy:readPolicy,last24hWindow:periodValuations?{startAt:periodValuations.startAt,endAt:periodValuations.endAt,timeframe:periodValuations.timeframe,observedAt:periodValuations.observedAt}:null,status:rankings.some(r=>r.allTime.items.length)?'READY':'EMPTY',cards,rankings,accountSummaries:executionMode==='paper'?paperSummaries(workspace,allCards,asOf,paper):liveSummaries(brokerConnections,asOf),experimentHighlights:experiments.slice(0,6),experimentBest:best?{...best,selectionScope}:null,experimentLeaders,limitations:executionMode==='live'?['LIVE_24H_RETURN_REQUIRES_BOUNDARY_VALUATIONS','HELD_LIVE_MARK_NOT_INVENTED','BROKER_BALANCES_SEPARATE_FROM_MIND_CAPITAL','RECENT_ACTIVITY_IS_BOUNDED_NOT_ALL_TIME_FILL_COUNT','CURRENCIES_ARE_SEPARATE','API_BILLING_EXCLUDED']:[periodValuations?'24H_USES_COMMON_COMPLETED_UTC_HOUR':'24H_REQUIRES_EXACT_START_VALUATION',...(paper.length?['EVENT_PAPER_RETURN_IS_PER_PINNED_CAMPAIGN','EVENT_PAPER_24H_RETURN_REQUIRES_BOUNDARY_VALUATIONS']:[]),'CURRENCIES_ARE_SEPARATE','API_BILLING_EXCLUDED']};
}

/** Only existing owner snapshots are read. Provider refresh is explicit and uses the shared valuation service. */
export async function readHomePerformance({repository,db,ownerId,executionMode='paper',asOf,now,refreshValuations=false,includeInvestorMetrics=false,quoteLoader,fetchImpl,env,periodMarketLoader}={}){
  if(typeof ownerId!=='string'||!ownerId)throw new RepositoryError('UNAUTHORIZED','로그인이 필요합니다.',401);
  if(!['paper','live'].includes(executionMode))throw new RepositoryError('HOME_PERFORMANCE_QUERY','운용 모드를 선택하세요.',400);
  const time=()=>asOf??new Date(typeof now==='function'?now():now??Date.now()).toISOString();
  const workspace=await (repository.readOperational?repository.readOperational(ownerId):repository.read(ownerId));
  if(!workspace)throw new RepositoryError('WORKSPACE_NOT_FOUND','작업 공간을 확인하세요.',404);
  let valuations=[],periodValuations=null;
  if(executionMode==='paper'&&refreshValuations){const scopes=[...new Set(list(workspace.mindPositions).filter(a=>a.kind==='PAPER_ACCOUNT').map(a=>a.quoteCurrency))];[valuations,periodValuations]=await Promise.all([Promise.all(scopes.map(quoteCurrency=>buildMindValuation(workspace,{profileId:'all',quoteCurrency},{now:time,quoteLoader,fetchImpl}))),buildHomePeriodPerformance(workspace,{now:time,fetchImpl,env,marketLoader:periodMarketLoader})]);}
  let brokerConnections=[],simulationHighlights=[],simulationBestCandidates=[],liveActivities=[],paperActivities=[];let activityAsOf=time();
  if(db){
    if(executionMode==='live')try{liveActivities=await readLiveAutomationActivity({db,owner:ownerId,asOf:activityAsOf,currentRuntime:typeof env?.EVENT_AUTOMATION_STATUS==='function'?env.EVENT_AUTOMATION_STATUS():null});}catch(error){if(error.code==='LIVE_ACTIVITY_UPDATING')throw new RepositoryError(error.code,error.message,409);throw error;}
    if(executionMode==='paper')paperActivities=(await readEventPaperActivity({db,owner:ownerId,asOf:activityAsOf})).items;
    const tables=(await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('broker_connections','simulation_reports','workspace_heads')").bind().all()).results.map(r=>r.name);
    if(executionMode==='live'&&tables.includes('broker_connections'))brokerConnections=(await db.prepare('SELECT provider,snapshot,updated_at FROM broker_connections WHERE owner_id=?').bind(ownerId).all()).results.map(r=>({provider:r.provider,updatedAt:r.updated_at,snapshot:r.snapshot?JSON.parse(r.snapshot):null}));
    if(tables.includes('simulation_reports'))simulationHighlights=(await db.prepare("SELECT json_extract(payload,'$.report') AS report FROM simulation_reports WHERE owner_id=? AND json_extract(payload,'$.status')='COMPLETED' AND json_extract(payload,'$.archivedAt') IS NULL ORDER BY json_extract(payload,'$.report.completedAt') DESC,id DESC LIMIT 6").bind(ownerId).all()).results.map(r=>({report:r.report?JSON.parse(r.report):null})).filter(r=>r.report);
    const selectedProfiles=new Set();
    if(tables.includes('simulation_reports'))for(let offset=0;;offset+=20){
      const rows=(await db.prepare("SELECT json_extract(payload,'$.report') AS report FROM simulation_reports WHERE owner_id=? AND json_extract(payload,'$.status')='COMPLETED' AND json_extract(payload,'$.archivedAt') IS NULL AND json_type(payload,'$.report.metrics.totalReturn') IN ('real','integer') AND json_extract(payload,'$.report.coverage.warmupFrames')=0 AND json_extract(payload,'$.report.coverage.readyFrames')=json_extract(payload,'$.report.coverage.totalDecisionFrames') AND json_extract(payload,'$.report.metrics.tradeCount')>0 ORDER BY json_extract(payload,'$.report.metrics.totalReturn') DESC,json_extract(payload,'$.report.completedAt') DESC,id LIMIT 20 OFFSET ?").bind(ownerId,offset).all()).results;
      const verified=experimentViews(rows.map(r=>({report:JSON.parse(r.report)})),time(),workspace).filter(r=>r.evaluationStatus==='FULL_WINDOW'&&r.hasPerformance).sort((a,b)=>b.returnRatio-a.returnRatio||b.completedAt.localeCompare(a.completedAt));
      for(const item of verified){const key=item.profileId??item.simulationId;if(selectedProfiles.has(key))continue;selectedProfiles.add(key);const selected=rows.find(row=>JSON.parse(row.report).simulationId===item.simulationId);simulationBestCandidates.push({report:JSON.parse(selected.report)});}if(rows.length<20)break;
    }
    const head=tables.includes('workspace_heads')?await db.prepare('SELECT revision FROM workspace_heads WHERE owner_id=?').bind(ownerId).first():null;
    if(head&&head.revision!==workspace.revision)throw new RepositoryError('HOME_PERFORMANCE_REVISION_CHANGED','운용 기록이 변경되었습니다. 다시 조회하세요.',409);
  }
  if(includeInvestorMetrics&&executionMode==='live'&&refreshValuations){liveActivities={...liveActivities,items:await refreshInvestorValuations(liveActivities.items??liveActivities,{fetchImpl,now:time})};activityAsOf=time();
   if(db)for(const item of liveActivities.items){const source=item.investorMetrics?.sourceRevision;if(!source)continue;const current=await db.prepare('SELECT revision FROM live_automation_activations WHERE owner_id=? AND id=?').bind(ownerId,item.activationId).first(),account=await db.prepare('SELECT revision FROM live_automation_accounts WHERE owner_id=? AND account_id=?').bind(ownerId,item.accountId).first();if(current?.revision!==source.activation||(account?.revision??null)!==source.account)throw new RepositoryError('HOME_PERFORMANCE_REVISION_CHANGED','운용 원장이 갱신되었습니다. 지표를 다시 조회하세요.',409);}
  }
  const performance=buildHomePerformance({workspace,valuations,periodValuations,brokerConnections,liveActivities,paperActivities,simulationHighlights,simulationBestCandidates,executionMode,asOf:activityAsOf});
  if(includeInvestorMetrics)for(const card of performance.cards){
   if(card.liveActivity||card.paperActivity){card.investorMetrics=(card.liveActivity??card.paperActivity).investorMetrics??null;continue;}
   const accounts=list(workspace.mindPositions).filter(a=>a.kind==='PAPER_ACCOUNT'&&a.profileId===card.profileId);
   if(accounts.length!==1)continue;const account=accounts[0],valuation=card.currencies.find(c=>c.currency===account.quoteCurrency);card.investorMetrics=projectPaperInvestorPerformance(account,valuation,{asOf:activityAsOf});
  }
  if(includeInvestorMetrics)performance.investorMetricsIncluded=true;
  return {ok:true,revision:workspace.revision,performance};
}
