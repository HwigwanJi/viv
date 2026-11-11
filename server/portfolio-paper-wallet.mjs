import {reviewHourlyValueExecution} from '../dist/domain/hourly-value-policy.mjs';
import {createEventPaperAccount,eventPaperPositionAccount,getEventPaperReport,applyEventTargetOrder,transferEventPaperCash,markEventPaperAccount} from '../dist/domain/event-paper-execution.mjs';
import {eventDatasetInstrument} from '../dist/domain/event-campaign-runtime.mjs';
import {observedAccountFeeSchedule} from '../dist/domain/connectors.mjs';
import {gameUnits as units,gameDecimal as decimal} from '../dist/domain/mind-game.mjs';
import {hashInputPackage} from '../dist/domain/workspace.mjs';
import {auditEventLearningAccount} from './strategy-learning-event.mjs';
const check=(v,c)=>{if(!v)throw Object.assign(Error(c),{code:c});};
function pocket(wallet,dataset,initialCash,now,suffix){return createEventPaperAccount({id:wallet.id+':'+suffix,profileId:wallet.profileId,instrumentId:dataset.instrumentId,instrument:eventDatasetInstrument(dataset),initialCash,feeSchedule:observedAccountFeeSchedule(dataset.feeSnapshot),now});}
export function createPortfolioPaperWallet({id,profileId,initialCash,dataset,now}){
 check(units(initialCash)>0n,'PORTFOLIO_PAPER_CAPITAL');const wallet={contractVersion:'shared-portfolio-event-paper-v1',id,profileId,initialCash:String(initialCash),quoteCurrency:dataset.market.split('-')[0],accounts:{},receipts:[],transfers:[],daily:{},lastEntry:null};wallet.reserve=pocket(wallet,dataset,initialCash,now,'cash');return wallet;
}
export function portfolioPaperPosition(wallet,{books={},asOf}){
 let cash=units(getEventPaperReport(wallet.reserve).cash);const positions=[],ledger=[];
 for(const a of Object.values(wallet.accounts)){const p=eventPaperPositionAccount(a,{...(books[a.instrumentId]?{book:books[a.instrumentId]}:{}),asOf});cash+=units(getEventPaperReport(a).cash);positions.push(...p.positions);ledger.push(...p.ledger);}
 const value=positions.reduce((s,p)=>s+p.marketValue,0),numberCash=Number(decimal(cash)),equity=numberCash+value,initialCash=Number(wallet.initialCash);
 return {id:wallet.id,profileId:wallet.profileId,quoteCurrency:wallet.quoteCurrency,cash:numberCash,equity,initialCash,exact:{cash:decimal(cash),initialCash:wallet.initialCash},positions,ledger:ledger.sort((a,b)=>a.at.localeCompare(b.at)),fundingLedger:[],netPnl:equity-initialCash,netReturn:equity/initialCash-1,asOf};
}
function move(wallet,instrumentId,amount,direction,id,now){
 if(units(amount)===0n)return;const toAsset=direction==='deposit',opposite=toAsset?'withdraw':'deposit';
 wallet.reserve=transferEventPaperCash(wallet.reserve,{id:id+':cash',amount,direction:opposite,now});wallet.accounts[instrumentId]=transferEventPaperCash(wallet.accounts[instrumentId],{id:id+':asset',amount,direction,now});wallet.transfers.push({id,instrumentId,amount,direction,at:now});
}
export function executePortfolioPaperTarget(wallet,{evaluation,key,book,dataset,books,now,limits}){
 check(!evaluation.output.orderPolicy?.takeProfitBps,'PORTFOLIO_PAPER_RESTING_QUEUE_REQUIRED');
 check(wallet.contractVersion==='shared-portfolio-event-paper-v1'&&evaluation.output.execution==='PAPER','PORTFOLIO_PAPER_ONLY');
 check(dataset.instrumentId===evaluation.portfolioExecution.instrumentId&&dataset.market===book.market&&dataset.market.split('-')[0]===wallet.quoteCurrency,'PORTFOLIO_PAPER_SCOPE');
 const requestHash=hashInputPackage({evaluation,key}),prior=wallet.receipts.find(r=>r.key===key);if(prior){check(prior.requestHash===requestHash,'PORTFOLIO_PAPER_IDEMPOTENCY');return {wallet:structuredClone(wallet),record:prior.record};}
 let entryPriceSlippage=evaluation.output.orderPolicy?.maxSlippageBps??20;
 if(evaluation.output.decision.action==='buy'&&evaluation.output.orderPolicy?.recheckModelValue){const selection=evaluation.trace?.find(n=>n.type==='MODEL'&&n.output?.selection)?.output.selection,review=reviewHourlyValueExecution(selection,{market:book.market,askPrice:book.levels[0].askPrice,maxSlippageBps:entryPriceSlippage,buyRate:dataset.feeSnapshot.takerBuyRate,sellRate:dataset.feeSnapshot.takerSellRate});check(review.accepted,review.reason);const cap=units(review.maximumEntryPrice.toFixed(18))-1n,ask=units(book.levels[0].askPrice);check(cap>=ask,'LIVE_MODEL_EDGE_CONSUMED');entryPriceSlippage=Math.min(entryPriceSlippage,Number(cap-ask)/Number(ask)*10000);}
 const next=structuredClone(wallet),id=dataset.instrumentId,position=portfolioPaperPosition(next,{books:{...books,[id]:book},asOf:now}),d=evaluation.output.decision,day=now.slice(0,10),daily=next.daily[day]??={openingEquity:position.equity,entries:0};
 check(Number.isFinite(Number(limits.dailyLossLimit))&&Number(limits.dailyLossLimit)>0&&Number.isSafeInteger(limits.maxTradesPerDay)&&limits.maxTradesPerDay>=0&&Number.isSafeInteger(limits.minIntervalMs)&&limits.minIntervalMs>=0,'PORTFOLIO_PAPER_LIMITS');
 if(d.action==='buy'&&(daily.openingEquity-position.equity>=Number(limits.dailyLossLimit)||limits.maxTradesPerDay>0&&daily.entries>=limits.maxTradesPerDay||next.lastEntry&&Date.parse(now)-Date.parse(next.lastEntry)<limits.minIntervalMs))return {wallet:next,record:{state:'BLOCKED',reason:'APPROVED_ENTRY_LIMIT'}};
 next.accounts[id]??=pocket(next,dataset,'0',now,'asset-'+hashInputPackage(id).slice(0,16));
 if(d.action==='buy')move(next,id,getEventPaperReport(next.reserve).cash,'deposit',key+':fund',now);
 const local=eventPaperPositionAccount(next.accounts[id],{book,asOf:now}),target=position.equity*d.targetWeight,localWeight=d.action==='sell'&&d.targetWeight===0?0:Math.min(1,Math.max(0,target/local.equity));
 const adjusted={...evaluation,portfolioExecution:{...evaluation.portfolioExecution,globalTargetWeight:d.targetWeight,globalEquity:position.equity,localEquity:local.equity},output:{...evaluation.output,decision:{...d,targetWeight:localWeight,...(d.risk?{risk:{...d.risk,maxExposure:Math.min(1,(d.risk.maxExposure??1)*position.equity/local.equity),maxOrderWeight:Math.min(1,(d.risk.maxOrderWeight??1)*position.equity/local.equity)}}:{})}}};delete adjusted.outputHash;adjusted.outputHash=hashInputPackage(adjusted);
 const result=applyEventTargetOrder(next.accounts[id],{evaluation:adjusted,orderId:key,book,now,orderType:evaluation.output.orderPolicy?.orderType??'LIMIT_FOK',maxSlippageBps:entryPriceSlippage,participationRate:evaluation.output.orderPolicy?.participationRate??.1,maxDailyLossRatio:1,perOrderLimit:limits.perOrderLimit});
 next.accounts[id]=result.account;move(next,id,getEventPaperReport(result.account).cash,'withdraw',key+':return',now);
 if(d.action==='buy'&&result.fills.length){daily.entries++;next.lastEntry=now;}
 const record={state:result.order?.status??(result.blockedReasons.includes('MINIMUM_ORDER')?'LIVE_MINIMUM_ORDER':'CANCELLED'),fills:result.fills,blockedReasons:result.blockedReasons};next.receipts.push({key,requestHash,instrumentId:id,at:now,record});return {wallet:next,record};
}
export function markPortfolioPaperWallet(wallet,{books,asOf}){const next=structuredClone(wallet);for(const [id,a]of Object.entries(next.accounts))if(units(getEventPaperReport(a).quantity)>0n){check(books[id],'PORTFOLIO_PAPER_HELD_QUOTE');next.accounts[id]=markEventPaperAccount(a,{book:books[id],asOf});}return next;}
export function verifyPortfolioPaperWallet(wallet){
 const entries=[['reserve',wallet.reserve],...Object.entries(wallet.accounts)],audits=entries.map(([id,a])=>({id,...auditEventLearningAccount(a)}));
 for(const t of wallet.transfers){const reserve=wallet.reserve.connector.fundingLedger.filter(f=>f.id===t.id+':cash'),asset=wallet.accounts[t.instrumentId].connector.fundingLedger.filter(f=>f.id===t.id+':asset');check(reserve.length===1&&asset.length===1&&reserve[0].amount===t.amount&&asset[0].amount===t.amount&&reserve[0].direction!==asset[0].direction,'PORTFOLIO_PAPER_TRANSFER_LEDGER');}
 const netFunding=entries.reduce((sum,[,a])=>sum+(a.connector.fundingLedger??[]).reduce((n,f)=>n+(f.direction==='deposit'?1n:-1n)*units(f.amount),0n),0n);check(netFunding===0n,'PORTFOLIO_PAPER_CAPITAL_CREATED');
 return {exactDecimals:18,closedTrades:audits.reduce((n,a)=>n+a.closed,0),feesPaid:decimal(audits.reduce((n,a)=>n+units(a.report.totalFees),0n)),accounts:audits.map(a=>({id:a.id,cash:a.report.cash,quantity:a.report.quantity,costBasis:a.report.costBasis,realizedPnl:a.report.realizedPnl,ledgerHash:hashInputPackage(entries.find(([id])=>id===a.id)[1])})),netInternalFunding:'0'};
}
