import {summarizePortfolioPaperArm} from './portfolio-paper-trial.mjs';
import {hashInputPackage} from '../dist/domain/workspace.mjs';
import {researchSha256} from '../dist/domain/research.mjs';
import {strategyGraphHash} from '../dist/domain/strategy-graph.mjs';
import {portfolioCandidateMetricsHash,inspectPortfolioCandidate} from '../dist/domain/portfolio-promotion-gate.mjs';
import {normalizeUpbitScalpingEvent,parseScalpFinancialJson} from './upbit-scalping-market.mjs';
import {gameUnits as units,gameDecimal as decimal} from '../dist/domain/mind-game.mjs';
export function verifyMonthlyPaperSources({arms,books,journalHash}){
 const seen=new Map();for(const book of books){const raw=book.rawSource;if(!raw||raw.method!=='GET'||new URL(raw.sourceUrl).origin!=='https://api.upbit.com'||new URL(raw.sourceUrl).pathname!=='/v1/orderbook'||researchSha256(raw.rawBody)!==book.sourceHash||raw.rawSha256!==book.sourceHash)throw Error('MONTHLY_PAPER_RAW_BOOK');const rows=parseScalpFinancialJson(raw.rawBody),row=rows.find(r=>r.market===book.market);if(!row)throw Error('MONTHLY_PAPER_RAW_MARKET');const normalized=normalizeUpbitScalpingEvent(JSON.stringify({...row,type:'orderbook',code:book.market,level:0}),{receivedAt:raw.receivedAt,markets:[book.market]});if(normalized.eventTime!==book.eventTime||normalized.receivedAt!==book.receivedAt||book.availableAt!==[book.eventTime,raw.receivedAt].sort().at(-1)||hashInputPackage(normalized.levels)!==hashInputPackage(book.levels))throw Error('MONTHLY_PAPER_RAW_LEVELS');const binding=hashInputPackage({market:book.market,eventTime:book.eventTime,receivedAt:book.receivedAt,levels:book.levels});seen.set(book.sourceHash+':'+binding,book);}
 let fills=0;for(const arm of Object.values(arms)){
  for(const account of Object.values(arm.wallet.accounts))for(const r of account.receipts){if(!r.fills.length)continue;const e=r.executionEvidence;if(!seen.has(e.bookSourceHash+':'+e.bookBindingHash))throw Error('MONTHLY_PAPER_FILL_SOURCE');fills+=r.fills.length;}
  for(const [index,row]of arm.curve.entries()){
   if(index===0){if(row.equity!==Number(arm.wallet.initialCash))throw Error('MONTHLY_PAPER_INITIAL_NAV');continue;}
   if(!Array.isArray(row.fillCounts)||!Array.isArray(row.bookRefs))throw Error('MONTHLY_PAPER_NAV_PREFIX');
   let cash=units(arm.wallet.initialCash),liquidation=0n;const counts=new Map(row.fillCounts),refs=new Map(row.bookRefs.map(([id,sha,binding])=>[id,sha+':'+binding]));
   for(const [id,account]of Object.entries(arm.wallet.accounts)){
    const count=counts.get(id)??0;if(!Number.isSafeInteger(count)||count<0||count>account.connector.fills.length)throw Error('MONTHLY_PAPER_NAV_PREFIX');let quantity=0n;
    for(const f of account.connector.fills.slice(0,count)){if(f.occurredAt>row.at)throw Error('MONTHLY_PAPER_FUTURE_FILL');const q=units(f.quantity),gross=units(f.notional),fee=units(f.fee);quantity+=f.side==='buy'?q:-q;cash+=f.side==='buy'?-gross-fee:gross-fee;}
    if(quantity<0n)throw Error('MONTHLY_PAPER_NEGATIVE_POSITION');if(!quantity)continue;const book=seen.get(refs.get(id));if(!book||[book.eventTime,book.receivedAt,book.availableAt??book.receivedAt].some(t=>t>row.at||Date.parse(row.at)-Date.parse(t)>3000))throw Error('MONTHLY_PAPER_NAV_BOOK');let left=quantity,gross=0n;
    for(const level of book.levels){const size=units(level.bidQuantity),take=left<size?left:size;gross+=take*units(level.bidPrice)/(10n**18n);left-=take;if(!left)break;}if(left)throw Error('MONTHLY_PAPER_NAV_DEPTH');const bps=units(account.connector.feeSchedule.sideBps?.sell??account.connector.feeSchedule.bps),denominator=10000n*10n**18n;liquidation+=gross-(gross*bps+denominator-1n)/denominator;
   }
   const equity=Number(decimal(cash+liquidation));if(cash<0n||row.cash!==decimal(cash)||Math.abs(equity-row.equity)>Math.max(1e-8,equity*1e-10))throw Error('MONTHLY_PAPER_NAV_RECONSTRUCTION');
  }
 }
 return {passed:true,bookCaptures:books.length,verifiedFills:fills,journalHash};
}
export function assessMonthlyPaperTrial({protocol,arms,completedAt,sourceAudit,modelCostsKnown}){
 if(!sourceAudit?.passed||completedAt<protocol.endsAt||!protocol.graphs[protocol.primaryCandidate])throw Error('MONTHLY_PAPER_COMPLETE_EVIDENCE');
 const summaries=Object.fromEntries(Object.entries(arms).map(([id,arm])=>[id,summarizePortfolioPaperArm(arm)])),base=summaries.BASE.metrics,btc=summaries.BTC.metrics,candidates=[];
 for(const [id,arm]of Object.entries(arms)){if(['BASE','BTC'].includes(id))continue;const s=summaries[id],m=s.metrics,sourceGraph=arm.sourceGraph;if(strategyGraphHash(sourceGraph)!==protocol.modelHashes[id]||strategyGraphHash(protocol.graphs[id])!==s.modelHash)throw Error('MONTHLY_PAPER_FROZEN_GRAPH');
  let slippageAmount=0;for(const account of Object.values(arm.wallet.accounts))for(const r of account.receipts){if(!r.fills.length)continue;const q=r.executionEvidence.referenceQuote,mid=(Number(q?.bidPrice)+Number(q?.askPrice))/2;if(!(mid>0))throw Error('MONTHLY_PAPER_FILL_COST');for(const f of r.fills)slippageAmount+=Math.max(0,(f.side==='buy'?Number(f.price)-mid:mid-Number(f.price))*Number(f.quantity));}
  const c={mandateId:protocol.mandateId,modelHash:s.modelHash,baselineModelHash:protocol.baselineModelHash,protocolHash:researchSha256(JSON.stringify(protocol)),datasetHash:hashInputPackage({source:sourceAudit,curve:s.curveHash,audit:s.audit}),frozenAt:protocol.registeredAt,validationFrom:protocol.startsAt,validationTo:completedAt,selectionUsedValidation:false,evidenceOrigin:'OBSERVED_EVENT_PAPER',completePricePath:[m,base,btc].every(v=>v?.mdd!==null&&v?.missingIntervals===0)&&![arm,arms.BASE,arms.BTC].some(a=>a.quality.length)&&Date.parse(completedAt)-Date.parse(protocol.endsAt)<=60000,completedRoundTrips:s.audit.closedTrades,withinMandateLimits:hashInputPackage(arm.limits)===hashInputPackage(protocol.limits),metrics:{netReturn:m?.netReturn??null,baselineNetReturn:base?.netReturn??null,benchmarkNetReturn:btc?.netReturn??null,mdd:m?.mdd??null,baselineMdd:base?.mdd??null,benchmarkMdd:btc?.mdd??null,recoveryStatus:m?.recovery?.status??null,observedRecoveryHours:(m?.recovery?.observedMs??m?.recovery?.maxRecoveryMs??NaN)/3600000},costs:{feesIncluded:true,slippageIncluded:true,modelCallsIncluded:modelCostsKnown,feeAmount:Number(s.audit.feesPaid),slippageAmount,modelCallAmount:0,costWindow:'EVALUATION_WINDOW',trainingAndSetupCostsIncluded:false,modelCostBasis:modelCostsKnown?'NO_NEW_EXTERNAL_CLASSIFICATIONS_DURING_WINDOW':'NEW_CLASSIFICATION_COST_UNPRICED'}};
  if(!Number.isFinite(c.metrics.observedRecoveryHours))c.metrics.observedRecoveryHours=null;c.metricsHash=portfolioCandidateMetricsHash(c);candidates.push({id,role:id===protocol.primaryCandidate?'CONFIRMATORY':'EXPLORATORY',graph:sourceGraph,evidence:c,inspection:inspectPortfolioCandidate(c,{mandateId:protocol.mandateId,now:completedAt})});
 }
 return {contractVersion:'monthly-portfolio-paper-assessment-v1',status:candidates.some(c=>c.role==='CONFIRMATORY'&&c.inspection.eligible)?'ELIGIBLE_CANDIDATE':'NO_ELIGIBLE_CANDIDATE',completedAt,protocolHash:researchSha256(JSON.stringify(protocol)),summaries,sourceAudit,candidates,liveOrders:0};
}
