import {gameUnits,gameDecimal} from '../dist/domain/mind-game.mjs';
import {auditEventLearningAccount} from './strategy-learning-event.mjs';
import {processHourlyValueAccount} from './hourly-value-live.mjs';
import {createMultiEventCampaignState,rotateSettledEventCampaign} from '../dist/domain/event-campaign-runtime.mjs';
import {eventPaperPositionAccount,getEventPaperReport,applyEventTargetOrder,markEventPaperAccount} from '../dist/domain/event-paper-execution.mjs';
import {hashInputPackage} from '../dist/domain/workspace.mjs';
import {createDecisionStrategyNode,evaluateStrategyGraph,strategyGraphHash} from '../dist/domain/strategy-graph.mjs';
const copy=structuredClone,check=(v,c)=>{if(!v)throw Object.assign(Error(c),{code:c,status:409});};

export function createHourlyShadowArm({id,manifest,model,initialCapital,dataset,now,benchmark=false}){
 const document=copy(manifest);document.scope.profileId=id;
 const graph=document.data.strategyPlan.graph;
 if(model)graph.nodes.find(n=>n.type==='MODEL'&&n.config.family==='HOURLY_VALUE_FOREST').config.model=copy(model);
 for(const n of graph.nodes)if(n.type==='ORDER')n.config.execution='PAPER';
 const config={mindId:id,quoteCurrency:'KRW',initialCash:initialCapital,startAt:now};
 return {id,manifest:document,graphHash:strategyGraphHash(graph),initialCapital:String(initialCapital),config,campaign:createMultiEventCampaignState({id,config,datasets:[dataset],now}),runtime:{},curve:[{at:now,equity:Number(initialCapital)}],lastMarkAt:now,closedTrades:0,feesPaid:'0',benchmark};
}

function allAccounts(arm){return [...arm.campaign.closedCampaigns.map(c=>c.account),arm.campaign.account];}
export function shadowAccountReport(arm){
 const reports=allAccounts(arm).map(a=>getEventPaperReport(a)),current=reports.at(-1);
 // Exact values stay in the canonical accounts; these totals are presentation metrics.
 return {...current,feesPaid:gameDecimal(reports.reduce((n,r)=>n+gameUnits(r.totalFees),0n)),closedTrades:arm.closedTrades,accounts:reports.length};
}

export async function advanceHourlyShadow(arm,{source,clock,save=async()=>{},valuationOnly=false}){
 const now=()=>clock(),graph=arm.manifest.data.strategyPlan.graph;
 const held=()=>Number(getEventPaperReport(arm.campaign.account).quantity)>0;
 async function rotate(market){
  if(arm.campaign.account.connector.instrument.symbol===market)return;
  check(!held(),'HOURLY_SHADOW_ROTATION_HELD');
  const dataset=await source.dataset(market),result=rotateSettledEventCampaign({state:arm.campaign,dataset,config:arm.config,frame:{asOf:now(),sequence:arm.campaign.transfers.length},id:arm.id});arm.campaign=result.state;
 }
 async function own(market=null){
  const symbol=market??arm.campaign.account.connector.instrument.symbol;if(!held())await rotate(symbol);
  const book=await source.readBook({market:arm.campaign.account.connector.instrument.symbol}),asOf=now(),report=getEventPaperReport(arm.campaign.account),position=eventPaperPositionAccount(arm.campaign.account,{book,asOf});
  position.id=arm.id;position.initialCash=Number(arm.initialCapital);position.exact={cash:report.cash,initialCash:arm.initialCapital};
  position.ledger=allAccounts(arm).flatMap(a=>eventPaperPositionAccount(a,{...(a===arm.campaign.account?{book}:{}),asOf}).ledger).sort((a,b)=>a.at.localeCompare(b.at));
  const dataset=await source.dataset(book.market),fees=dataset.feeSnapshot,asset=book.market.split('-')[1];
  return {book,position,activation:{id:arm.id,status:'ENABLED',config:{profileId:arm.id,quoteCurrency:'KRW',capitalLimit:arm.initialCapital,graphHash:arm.graphHash,manifestHash:hashInputPackage(arm.manifest)},positions:Number(report.quantity)>0?{[asset]:{quantity:report.quantity}}:{}},readiness:{fees,rules:dataset.rules}};
 }
 async function execute(signal){
  const prior=allAccounts(arm).flatMap(a=>a.receipts).find(r=>r.orderId===signal.key);if(prior)return {record:{state:prior.order?.status??'CANCELLED',fills:prior.fills}};
  if(signal.action==='buy')await source.assertEntry(signal.market);await rotate(signal.market);const book=await source.readBook({market:signal.market,after:signal.readyAt});
  check(book.availableAt<=now()&&signal.evaluation.output.execution==='PAPER','HOURLY_SHADOW_PAPER_ONLY');
  const before=getEventPaperReport(arm.campaign.account),result=applyEventTargetOrder(arm.campaign.account,{evaluation:{...signal.evaluation,providerReadyAt:signal.readyAt},orderId:signal.key,book,now:now(),maxSlippageBps:20,participationRate:1,maxDailyLossRatio:arm.maxDailyLossRatio??1,perOrderLimit:arm.perOrderLimit??arm.initialCapital});
  arm.campaign.account=result.account;const after=getEventPaperReport(result.account);
  if(Number(before.quantity)>0&&after.quantity==='0'&&result.fills.length)arm.closedTrades++;
  await record('PAPER_EXECUTION',{key:signal.key,order:result.order,fills:result.fills,blockedReasons:result.blockedReasons});
  return {record:{state:result.order?.status??'CANCELLED',fills:result.fills}};
 }
 async function record(kind,body){await save(kind,body,arm);}
 const orders=async()=>allAccounts(arm).flatMap(a=>a.receipts.map(r=>({idempotencyKey:r.orderId,state:r.order?.status??'CANCELLED',fills:r.fills})));
 if(!valuationOnly&&arm.benchmark){
  if(!arm.benchmarkDispatch&&!held()){
   const account=(await own()).position,nodes=[['value','VALUE',{dataType:'BOOLEAN',value:true}],['quant','QUANT',{mode:'CONDITION',onTrue:'buy',onFalse:'hold',buyTargetWeight:1,sellTargetWeight:0}],['risk','RISK',{maxExposure:1,maxOrderWeight:1,minConfidence:0}],['order','ORDER',{execution:'PAPER',sizing:'TARGET_WEIGHT'}]].map(([id,type,config])=>createDecisionStrategyNode(type,{id,config}));
   const g={schemaVersion:2,contractVersion:'mind-strategy-decision-graph-v2',triggers:['closed_bar'],nodes,edges:[['value','quant','value','signal'],['quant','risk','decision','decision'],['risk','order','approved','approved']].map(([a,b,c,d])=>({id:a+'-'+b,from:{nodeId:a,port:c},to:{nodeId:b,port:d}})),outputNodeId:'order'};
   const evaluation=evaluateStrategyGraph(g,[],{asOf:now(),sourceHash:hashInputPackage(account),trigger:'closed_bar',context:{executionMode:'PAPER',profileId:arm.id,accountId:arm.id,currentWeight:0,account}});
   arm.benchmarkDispatch={key:'btc:'+arm.id+':'+(arm.benchmarkAttempt??0),market:'KRW-BTC',evaluation,readyAt:new Date(Date.parse(now())+100).toISOString()};await record('BTC_PREPARED',{graphHash:strategyGraphHash(g)});
  }
  if(arm.benchmarkDispatch&&now()>=arm.benchmarkDispatch.readyAt&&!held()){const r=await execute(arm.benchmarkDispatch);arm.benchmarkDispatch=null;if(!r.record.fills?.length)arm.benchmarkAttempt=(arm.benchmarkAttempt??0)+1;}
 }else if(!valuationOnly)await processHourlyValueAccount({manifest:arm.manifest,graph,runtime:arm.runtime,clock:now,readOwn:own,readOrders:orders,source,save:record,execute,hasPosition:held,executionMode:'PAPER'});
 if(valuationOnly||Date.parse(now())-Date.parse(arm.lastMarkAt)>=60000){
  const value=held()?await own():null,asOf=now();if(value)arm.campaign.account=markEventPaperAccount(arm.campaign.account,{book:value.book,asOf});
  const report=getEventPaperReport(arm.campaign.account),fee=(await source.dataset(arm.campaign.account.connector.instrument.symbol)).feeSnapshot.takerSellRate;
  const equity=Number(report.cash)+Number(report.marketValue)*(1-Number(fee));arm.curve.push({at:asOf,equity});arm.lastMarkAt=asOf;arm.feesPaid=String(shadowAccountReport(arm).feesPaid);await record('VALUATION',{equity,cash:report.cash,quantity:report.quantity,feeBasis:fee});
 }
 return arm;
}

export function verifyHourlyShadowLedger(arm){const audits=allAccounts(arm).map(a=>auditEventLearningAccount(a));check(audits.reduce((n,a)=>n+a.closed,0)===arm.closedTrades,'HOURLY_SHADOW_CLOSED_TRADES');return {closedTrades:arm.closedTrades,ledgerHash:hashInputPackage(allAccounts(arm)),feesPaid:shadowAccountReport(arm).feesPaid,accounts:audits.length,exactDecimals:18};}
