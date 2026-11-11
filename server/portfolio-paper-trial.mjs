import {processAdaptivePortfolio} from './adaptive-portfolio-runtime.mjs';
import {createPortfolioPaperWallet,portfolioPaperPosition,executePortfolioPaperTarget,markPortfolioPaperWallet,verifyPortfolioPaperWallet} from './portfolio-paper-wallet.mjs';
import {strategyGraphHash,compileStrategyGraph} from '../dist/domain/strategy-graph.mjs';
import {getEventPaperReport} from '../dist/domain/event-paper-execution.mjs';
import {remainingLiquidationReturn} from '../dist/domain/position-liquidation.mjs';
import {learningCurveMetrics} from '../dist/domain/hourly-model-learning.mjs';
import {hashInputPackage} from '../dist/domain/workspace.mjs';
const copy=structuredClone;
export function createPortfolioPaperArm({id,profileId,graph,initialCash,dataset,startsAt,limits,instrumentIds}){
 const paper=copy(graph);for(const n of paper.nodes)if(n.type==='ORDER')n.config.execution='PAPER';compileStrategyGraph(paper);
 return {id,sourceGraph:copy(graph),modelHash:strategyGraphHash(graph),graph:paper,instrumentIds:[...instrumentIds],limits:copy(limits),runtime:{},wallet:createPortfolioPaperWallet({id,profileId,initialCash,dataset,now:startsAt}),curve:[{at:startsAt,equity:Number(initialCash),cash:String(initialCash),fillCounts:[],bookRefs:[]}],quality:[],lastMarkAt:startsAt};
}
export const portfolioPaperHeldIds=arm=>Object.entries(arm.wallet.accounts).filter(([,a])=>Number(getEventPaperReport(a).quantity)>0).map(([id])=>id);
export async function stepPortfolioPaperArm(arm,{frame,clock,readBooks,readDataset,save=async()=>{}}){
 let books={};
 const own=async()=>{books=await readBooks(portfolioPaperHeldIds(arm));const surge=arm.graph.nodes.some(n=>n.type==='MODEL'&&n.config.family==='SURGE_PATH_FOREST'),dataset=surge?await readDataset('KRW-BTC'):null;return {activation:{config:{profileId:arm.wallet.profileId}},position:portfolioPaperPosition(arm.wallet,{books,asOf:clock()}),...(dataset?{readiness:{fees:dataset.feeSnapshot}}:{})};};
 const result=await processAdaptivePortfolio({graph:arm.graph,executionMode:'PAPER',scope:{market:'KRW-BTC',instrumentIds:arm.instrumentIds},state:arm.runtime,clock,readOrders:async()=>arm.wallet.receipts.map(r=>({idempotencyKey:r.key,...r.record})),readOwn:own,capture:async()=>frame,save,
  execute:async signal=>{const dataset=await readDataset(signal.market),readyAt=new Date(Date.parse(signal.evaluation.asOf)+100).toISOString(),fresh=await readBooks([...new Set([...portfolioPaperHeldIds(arm),dataset.instrumentId])],{after:readyAt});const e={...signal.evaluation,providerReadyAt:readyAt};const executed=executePortfolioPaperTarget(arm.wallet,{evaluation:e,key:signal.key,book:fresh[dataset.instrumentId],dataset,books:fresh,now:clock(),limits:arm.limits});arm.wallet=executed.wallet;return {record:executed.record};}
 });
 if(arm.runtime.portfolioRebalancedAt===arm.runtime.portfolioPlan?.boundary&&arm.runtime.portfolioPlan.cursor>=arm.runtime.portfolioPlan.changes.length)delete arm.runtime.portfolioPlan;
 return result;
}
export async function markPortfolioPaperArm(arm,{clock,readBooks,force=false}){
 const asOf=clock();if(!force&&Date.parse(asOf)-Date.parse(arm.lastMarkAttemptAt??arm.lastMarkAt)<60000)return null;arm.lastMarkAttemptAt=asOf;
 try{const books=await readBooks(portfolioPaperHeldIds(arm)),now=clock();arm.wallet=markPortfolioPaperWallet(arm.wallet,{books,asOf:now});const position=portfolioPaperPosition(arm.wallet,{books,asOf:now});let equity=position.cash;
  for(const [id,a]of Object.entries(arm.wallet.accounts)){const r=getEventPaperReport(a);if(Number(r.quantity)===0)continue;const rate=Number(a.connector.feeSchedule.sideBps?.sell??a.connector.feeSchedule.bps)/10000,ret=remainingLiquidationReturn({quantity:r.quantity,costBasis:r.costBasis,book:books[id],sellRate:String(rate),asOf:now});if(ret===null)throw Error('PORTFOLIO_PAPER_LIQUIDATION_DEPTH');equity+=Number(r.costBasis)*(1+ret);}
  arm.curve.push({at:now,equity,cash:position.exact.cash,fillCounts:Object.entries(arm.wallet.accounts).map(([id,a])=>[id,a.connector.fills.length]),bookRefs:Object.entries(books).map(([id,b])=>[id,b.sourceHash,hashInputPackage({market:b.market,eventTime:b.eventTime,receivedAt:b.receivedAt,levels:b.levels})])});arm.lastMarkAt=now;return arm.curve.at(-1);
 }catch(error){arm.quality.push({at:clock(),code:error.code??error.message});return null;}
}
export function summarizePortfolioPaperArm(arm){const audit=verifyPortfolioPaperWallet(arm.wallet),metrics=learningCurveMetrics(arm.curve,Number(arm.wallet.initialCash));return {id:arm.id,modelHash:arm.modelHash,valuationAsOf:arm.curve.at(-1)?.at??null,metrics,audit,quality:arm.quality,curveHash:hashInputPackage(arm.curve)};}
