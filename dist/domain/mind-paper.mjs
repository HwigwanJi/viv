import {PAPER_QUOTE_CURRENCIES,minimumMindNotional} from './mind-currency.mjs';
import { getInstrument } from './instruments.mjs';
import { assertMindDocument, mindDocumentHash } from './mind-manifest.mjs';
import { hashInputPackage } from './workspace.mjs';
import {strategyAllocationCheck,MindStrategyError} from './mind-strategy-plan.mjs';
import {assertGraphDecisionProof} from './graph-decision-proof.mjs';
import {mindTargetRemainder} from './mind-target-remainder.mjs';
import {assertUpbitBookQuote} from './upbit-book-quote.mjs';

export const MIND_PAPER_VERSION='mind-multiasset-paper-v1';
export const MIND_PAPER_COST_POLICY=Object.freeze({version:'fixed-paper-cost-v1',feeBps:10,slippageBps:5});
const validHistoricalCostPolicy=account=>account.executionScope==='HISTORICAL_SIMULATION'&&account.quoteCurrency==='BTC'&&account.costPolicy?.version==='historical-paper-cost-v1'&&account.costPolicy.feeBps===25&&account.costPolicy.slippageBps===15&&Object.keys(account.costPolicy).length===3;
const clone=value=>structuredClone(value),finite=value=>typeof value==='number'&&Number.isFinite(value)&&Math.abs(value)<1e14;
const iso=value=>typeof value==='string'&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value;
const id=value=>typeof value==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9_.:@/-]{0,199}$/.test(value);
const rounded=value=>Math.round((value+Number.EPSILON)*1e8)/1e8;
const close=(a,b)=>finite(a)&&finite(b)&&Math.abs(a-b)<=1e-7*Math.max(1,Math.abs(a),Math.abs(b));
// Compare the existing eight-decimal ledger representation without scaling a
// large KRW/USDT Number beyond the safe-integer range. Derived prices/ratios use close.
const ledgerEqual=(a,b)=>finite(a)&&finite(b)&&a===Number(a.toFixed(8))&&b===Number(b.toFixed(8))&&a.toFixed(8)===b.toFixed(8);
const reason=(code,message)=>({code,message});
export class MindPaperError extends TypeError{constructor(code,message){super(message);this.name='MindPaperError';this.code=code;}}
const check=(condition,code,message)=>{if(!condition)throw new MindPaperError(code,message);};
const utcDay=at=>at.slice(0,10);
export function createMindPaperAccount({id:accountId,profileId,quoteCurrency,initialCash,now=new Date().toISOString()}={}){
  check(id(accountId)&&id(profileId)&&PAPER_QUOTE_CURRENCIES.includes(quoteCurrency)&&finite(initialCash)&&rounded(initialCash)>0&&iso(now),'INVALID_PAPER_ACCOUNT','마인드·계좌·통화·모의 자금과 시각을 확인하세요.');
  return {schemaVersion:1,version:MIND_PAPER_VERSION,id:accountId,profileId,quoteCurrency,initialCash:rounded(initialCash),cash:rounded(initialCash),positions:[],ledger:[],receipts:[],events:[],feesPaid:0,realizedPnl:0,equity:rounded(initialCash),holdingsValue:0,unrealizedPnl:0,netPnl:0,netReturn:0,asOf:now,valuationStatus:'CURRENT',day:utcDay(now),dayStartEquity:rounded(initialCash),dailyRealizedPnl:0,dailyRealizedLossRatio:0,costPolicy:clone(MIND_PAPER_COST_POLICY),createdAt:now,updatedAt:now};
}
export function createHistoricalMindPaperAccount(options){check(options.feeBps===25&&options.slippageBps===15&&options.quoteCurrency==='BTC','HISTORICAL_COST_POLICY','BTC 역사 비용 스트레스 조건 25bp·15bp를 확인하세요.');return {...createMindPaperAccount(options),executionScope:'HISTORICAL_SIMULATION',costPolicy:{version:'historical-paper-cost-v1',feeBps:25,slippageBps:15}};}
export function validateMindPaperAccount(account){
  const errors=[],add=message=>errors.push(reason('INVALID_PAPER_ACCOUNT',message));
  if(!account||account.schemaVersion!==1||account.version!==MIND_PAPER_VERSION||!id(account.id)||!id(account.profileId)||!PAPER_QUOTE_CURRENCIES.includes(account.quoteCurrency)||!['initialCash','cash','equity','feesPaid','dayStartEquity'].every(key=>finite(account[key])&&account[key]>=0)||account.initialCash<=0||!ledgerEqual(account.initialCash,rounded(account.initialCash))||!finite(account.realizedPnl)||![account.createdAt,account.updatedAt,account.asOf].every(iso)||account.createdAt>account.updatedAt||!Array.isArray(account.positions)||!Array.isArray(account.ledger)||!Array.isArray(account.receipts)||!Array.isArray(account.events)||account.ledger.length>10000||account.receipts.length>20000||(!account.costPolicy||hashInputPackage(account.costPolicy)!==hashInputPackage(MIND_PAPER_COST_POLICY)&&!validHistoricalCostPolicy(account)))return [reason('INVALID_PAPER_ACCOUNT','모의 계좌와 비용 정책을 확인하세요.')];
  let cash=account.initialCash,fees=0,pnl=0,previousAt=account.createdAt;const positions=new Map(),seen=new Set();
  const funding=account.fundingLedger??[];
  if(!Array.isArray(funding)||funding.some(f=>!id(f.id)||!finite(f.amount)||!ledgerEqual(f.amount,rounded(f.amount))||f.amount===0||!Number.isSafeInteger(f.ledgerOffset)||f.ledgerOffset<0||f.ledgerOffset>account.ledger.length||!iso(f.at)||f.at<account.createdAt||f.at>account.updatedAt)||new Set(funding.map(f=>f.id)).size!==funding.length)return [reason('INVALID_PAPER_ACCOUNT','자금 이동 원장을 확인하세요.')];
  const timeline=[...account.ledger.map((f,i)=>({...f,_order:i,_fund:false})),...funding.map((f,i)=>({...f,_order:f.ledgerOffset??account.ledger.length,_fund:true,_sequence:i}))].sort((a,b)=>a._order-b._order||Number(b._fund)-Number(a._fund)||(a._sequence??0)-(b._sequence??0));
  for(const fill of timeline){
    if(fill._fund){if(fill.at<previousAt){add('자금 이동과 체결의 시간 순서를 확인하세요.');break;}previousAt=fill.at;cash=rounded(cash+fill.amount);if(cash<0||!ledgerEqual(cash,fill.cashAfter)){add('자금 이동과 가용 현금을 대조하세요.');break;}continue;}
    if(!fill||fill.mode!=='paper'||!id(fill.runId)||seen.has(fill.runId)||!iso(fill.at)||fill.at<previousAt||!['buy','sell'].includes(fill.side)||!finite(fill.quantity)||!ledgerEqual(fill.quantity,rounded(fill.quantity))||fill.quantity<=0||!finite(fill.fillPrice)||fill.fillPrice<=0||!finite(fill.fee)||fill.fee<0||!ledgerEqual(fill.gross,rounded(fill.quantity*fill.fillPrice))||fill.currency!==account.quoteCurrency||fill.feeBps!==account.costPolicy.feeBps||fill.slippageBps!==account.costPolicy.slippageBps||!ledgerEqual(fill.fee,rounded(fill.gross*account.costPolicy.feeBps/10000))||!finite(fill.referencePrice)||fill.referencePrice<=0||!close(fill.fillPrice,fill.referencePrice*(1+(fill.side==='buy'?1:-1)*account.costPolicy.slippageBps/10000))){add('체결 원장의 시각·수량·비용을 대조하세요.');break;}
    if(fill.quote?.source==='UPBIT_PUBLIC_ORDERBOOK'){
      try{assertUpbitBookQuote(fill.quote,getInstrument(fill.instrumentId),{now:fill.at,action:fill.side,notBefore:fill.decisionCompletedAt??fill.decisionAt});if(fill.quantity>fill.quote.book.availableQuantity||fill.referencePrice!==fill.quote.price)throw new TypeError('호가 수량');}catch{add('체결 호가 원문·방향·잔량을 대조하세요.');break;}
    }
    seen.add(fill.runId);previousAt=fill.at;const prior=positions.get(fill.instrumentId)??{quantity:0,cost:0};let realized=0;
    if(fill.side==='buy'){prior.cost=rounded(prior.cost+fill.gross+fill.fee);prior.quantity=rounded(prior.quantity+fill.quantity);cash=rounded(cash-rounded(fill.gross+fill.fee));}
    else {if(fill.quantity>prior.quantity+1e-9){add('현물 매도 수량과 보유 수량을 대조하세요.');break;}const removed=fill.quantity>=prior.quantity-1e-9?prior.cost:rounded(prior.cost*fill.quantity/prior.quantity);prior.quantity=rounded(Math.max(0,prior.quantity-fill.quantity));prior.cost=rounded(prior.cost-removed);realized=rounded(fill.gross-fill.fee-removed);cash=rounded(cash+rounded(fill.gross-fill.fee));}
    positions.set(fill.instrumentId,prior);fees=rounded(fees+fill.fee);pnl=rounded(pnl+realized);
    if(cash<0||!ledgerEqual(fill.cashAfter,cash)||!ledgerEqual(fill.realizedPnl,realized)||!ledgerEqual(fill.quantityAfter,prior.quantity)||!ledgerEqual(fill.costBasisAfter,prior.cost)){add('체결 원장과 잔고를 대조하세요.');break;}
  }
  if(!ledgerEqual(account.cash,cash)||!ledgerEqual(account.feesPaid,fees)||!ledgerEqual(account.realizedPnl,pnl))add('현금·누적 수수료·실현 손익을 원장과 대조하세요.');
  const ids=new Set();let value=0,unrealized=0;
  for(const position of account.positions){const actual=positions.get(position.instrumentId);if(ids.has(position.instrumentId)||!actual||actual.quantity<=0||position.quoteCurrency!==account.quoteCurrency||!ledgerEqual(position.quantity,actual.quantity)||!ledgerEqual(position.costBasis,actual.cost)||!close(position.averageCost,actual.cost/actual.quantity)||!finite(position.marketPrice)||position.marketPrice<=0||!iso(position.priceAsOf)){add('보유 종목과 평가 가격을 원장과 대조하세요.');break;}ids.add(position.instrumentId);value+=position.quantity*position.marketPrice;unrealized+=position.quantity*position.marketPrice-position.costBasis;}
  for(const [instrumentId,position]of positions)if(position.quantity>0&&!ids.has(instrumentId))add('보유 종목의 평가 내역을 확인하세요.');
  if(!ledgerEqual(account.holdingsValue,rounded(value))||!ledgerEqual(account.equity,rounded(cash+rounded(value)))||!ledgerEqual(account.unrealizedPnl,rounded(unrealized))||!ledgerEqual(account.netPnl,rounded(account.equity-account.initialCash-funding.reduce((n,f)=>n+f.amount,0)))||!close(account.netReturn,account.netPnl/(account.initialCash+funding.reduce((n,f)=>n+Math.max(0,f.amount),0))))add('통화별 평가 자산을 대조하세요.');
  const receiptIds=new Set();for(const receipt of account.receipts){if(!receipt||!id(receipt.runId)||receiptIds.has(receipt.runId)||!['FILLED','HOLD'].includes(receipt.outcome)||typeof receipt.fingerprint!=='string'||!/^[a-f0-9]{64}$/.test(receipt.fingerprint)||!iso(receipt.at)||receipt.at>account.updatedAt||(receipt.outcome==='FILLED'?!account.ledger.some(fill=>fill.id===receipt.executionId&&fill.runId===receipt.runId):receipt.executionId!==null)){add('결정 실행 영수증과 체결 원장을 대조하세요.');break;}receiptIds.add(receipt.runId);}
  if(account.ledger.some(fill=>!receiptIds.has(fill.runId)))add('체결에 연결된 결정 실행 영수증을 확인하세요.');
  return errors;
}
function assertAccount(account){const errors=validateMindPaperAccount(account);check(!errors.length,'INVALID_PAPER_ACCOUNT',errors[0]?.message??'모의 계좌를 확인하세요.');}
function assertQuote(quote,instrument,now,{fresh=true}={}){
  check(quote&&quote.instrumentId===instrument.id&&quote.currency===instrument.quoteCurrency&&finite(quote.price)&&quote.price>0&&iso(quote.asOf)&&iso(quote.receivedAt)&&quote.asOf<=quote.receivedAt&&quote.receivedAt<=now,'QUOTE_MISMATCH','종목·통화·현재가와 수신 시각을 확인하세요.');
  check(!fresh||Date.parse(now)-Date.parse(quote.asOf)<=30000,'STALE_QUOTE','30초 이내의 현재가를 다시 조회하세요.');
  check(!fresh||quote.executionAllowed!==false&&!['END_OF_DAY','STALE','DELAYED'].includes(quote.freshness)&&quote.priceBasis!=='LAST_CLOSED_CANDLE','REFERENCE_QUOTE','모의 체결에 사용할 현재 호가를 조회하세요.');
  if(quote.source==='UPBIT_PUBLIC_ORDERBOOK'){try{assertUpbitBookQuote(quote,instrument,{now,fresh});}catch(error){throw new MindPaperError(error.code??'EXECUTION_QUOTE_INVALID',error.message);}}
}
function updateMetrics(account,now){
  const funding=account.fundingLedger??[];
  for(const position of account.positions){position.marketValue=rounded(position.quantity*position.marketPrice);position.unrealizedPnl=rounded(position.marketValue-position.costBasis);position.averageCost=position.costBasis/position.quantity;}
  account.holdingsValue=rounded(account.positions.reduce((sum,p)=>sum+p.quantity*p.marketPrice,0));account.equity=rounded(account.cash+account.holdingsValue);account.unrealizedPnl=rounded(account.positions.reduce((sum,p)=>sum+p.quantity*p.marketPrice-p.costBasis,0));account.netPnl=rounded(account.equity-account.initialCash-funding.reduce((n,f)=>n+f.amount,0));account.netReturn=account.netPnl/(account.initialCash+funding.reduce((n,f)=>n+Math.max(0,f.amount),0));
  if(account.day!==utcDay(now)){account.day=utcDay(now);account.dayStartEquity=account.equity;}
  // A full cash release leaves a valid zero-capital account. Keep its actual
  // equity at zero; the smallest ledger unit guards only the loss denominator.
  account.dailyRealizedPnl=rounded(account.ledger.filter(fill=>utcDay(fill.at)===account.day).reduce((sum,fill)=>sum+fill.realizedPnl,0));account.dailyRealizedLossRatio=Math.max(0,-account.dailyRealizedPnl)/Math.max(0.00000001,account.dayStartEquity);account.asOf=now;account.updatedAt=now;return account;
}
export function markMindPaperAccount(account,{quotes=[],asOf,now=asOf??new Date().toISOString()}={}){
  assertAccount(account);check(iso(now)&&(!asOf||iso(asOf)&&asOf<=now&&asOf>=account.updatedAt)&&now>=account.updatedAt&&Array.isArray(quotes),'INVALID_MARK_TIME','계좌 평가 시각과 종목 가격을 확인하세요.');const next=clone(account),seen=new Set();
  for(const quote of quotes){const instrument=getInstrument(quote.instrumentId);check(!seen.has(instrument.id),'DUPLICATE_QUOTE','종목별 평가 가격을 한 번씩 전달하세요.');seen.add(instrument.id);assertQuote(quote,instrument,now,{fresh:false});check(quote.currency===account.quoteCurrency,'CURRENCY_MISMATCH','평가 통화가 같은 계좌를 선택하세요.');const position=next.positions.find(item=>item.instrumentId===instrument.id);if(position){check(quote.asOf>=position.priceAsOf,'QUOTE_TIME_REWIND','기존 평가 이후의 종목 가격을 사용하세요.');Object.assign(position,{marketPrice:quote.price,marketValue:rounded(position.quantity*quote.price),unrealizedPnl:rounded(position.quantity*quote.price-position.costBasis),priceAsOf:quote.asOf,priceReceivedAt:quote.receivedAt});}}
  check(next.positions.every(position=>seen.has(position.instrumentId)),'VALUATION_REQUIRED','보유한 모든 종목의 같은 통화 평가 가격을 준비하세요.');next.valuationStatus='CURRENT';return updateMetrics(next,asOf??now);
}
function fingerprint(account,run,manifest){const strategy=run.rawRequest?.state?.strategyEvaluation??run.strategyEvaluation;return hashInputPackage({accountId:account.id,runId:run.id,profileId:run.profileId,instrumentId:run.instrumentId,asOf:run.asOf,decisionAt:run.decisionAt,...(Object.hasOwn(run,'decisionCompletedAt')?{decisionCompletedAt:run.decisionCompletedAt}:{}),...(strategy?{strategyEvaluationHash:hashInputPackage(strategy)}:{}),decision:run.decision,risk:run.risk,manifestHash:mindDocumentHash(manifest),costPolicy:account.costPolicy});}
function prepare(account,run,{manifest,quote,instrument,now=new Date().toISOString(),feeBps=10,slippageBps=5}={}){

  assertAccount(account);check(!account.executionScope&&hashInputPackage(account.costPolicy)===hashInputPackage(MIND_PAPER_COST_POLICY),'HISTORICAL_ACCOUNT_EXECUTION_BLOCKED','현재 모의 운용의 고정 비용 계좌를 사용하세요.');
  assertMindDocument(manifest);check(manifest.kind==='mind-policy'&&manifest.scope.profileId===account.profileId,'MIND_SCOPE','계좌에 적용할 마인드 정책을 확인하세요.');check(iso(now)&&now>=account.updatedAt,'INVALID_EXECUTION_TIME','최근 계좌 상태 이후에 실행하세요.');
  check(run&&id(run.id)&&run.profileId===account.profileId&&run.instrumentId===instrument?.id&&manifest.data.universe.instrumentIds.includes(run.instrumentId)&&manifest.availableAt<=now,'RUN_SCOPE','결정·계좌·정책·종목 범위를 대조하세요.');
  const canonical=getInstrument(instrument.id);check(canonical.assetClass===instrument.assetClass&&canonical.quoteCurrency===instrument.quoteCurrency&&instrument.quoteCurrency===account.quoteCurrency,'CURRENCY_MISMATCH','같은 통화의 종목과 모의 계좌를 선택하세요.');
  check(run.manifestHash===mindDocumentHash(manifest)&&run.manifestId===manifest.id,'MANIFEST_CHANGED','결정에 사용한 마인드 정책 버전을 선택하세요.');
  check(finite(feeBps)&&finite(slippageBps)&&feeBps===account.costPolicy.feeBps&&slippageBps===account.costPolicy.slippageBps,'COST_POLICY_MISMATCH','서버에 고정한 모의 수수료와 슬리피지를 사용하세요.');
  const key=fingerprint(account,run,manifest),previous=account.receipts.find(receipt=>receipt.runId===run.id);if(previous){check(previous.fingerprint===key,'IDEMPOTENCY_CONFLICT','같은 결정 ID의 내용이 변경되었습니다.');return {duplicate:previous,key,now};}
  const decision=run.decision;check(decision&&['buy','hold','sell'].includes(decision.action)&&['normal','clutch','defensive'].includes(decision.stance)&&iso(run.asOf)&&iso(run.decisionAt)&&run.asOf<=run.decisionAt&&run.decisionAt<=now&&(!decision.asOf||decision.asOf===run.asOf)&&(!decision.decisionAt||decision.decisionAt===run.decisionAt),'INVALID_DECISION','확정 봉과 실제 결정 시각·행동을 확인하세요.');
  const graphProof=assertGraphDecisionProof(run,{manifest,now});
  check(!['replay','HISTORICAL_FUNCTIONAL_REPLAY','RETROSPECTIVE_POLICY_SIMULATION'].includes(run.mode??run.experimentType),'REPLAY_EXECUTION_BLOCKED','현재 확정 시세로 결정한 모의 운용을 선택하세요.');
  const decisionCompletedAt=Object.hasOwn(run,'decisionCompletedAt')?run.decisionCompletedAt:run.decisionAt;
  check(iso(decisionCompletedAt)&&run.decisionAt<=decisionCompletedAt&&decisionCompletedAt<=now,'INVALID_DECISION_COMPLETION','요청 이후에 기록한 실제 결정 완료 시각을 확인하세요.');
  if(canonical.assetClass==='crypto'){
    const interval=run.rawRequest?.state?.market?.timeframe??canonical.defaultTimeframe,step={'1h':3600000,'4h':14400000,'1d':86400000}[interval];
    check(step&&(!Object.hasOwn(run,'validUntil')||iso(run.validUntil)),'INVALID_DECISION_VALIDITY','결정에 사용한 봉 주기와 유효 종료 시각을 확인하세요.');
    const boundary=Date.parse(run.asOf)+step,validUntil=Object.hasOwn(run,'validUntil')?Math.min(boundary,Date.parse(run.validUntil)):boundary;
    check(Date.parse(now)<validUntil,'DECISION_EXPIRED','결정 유효시간이 지났습니다. 새 확정 봉으로 JEV 결정을 다시 실행하세요.');
  }
  assertQuote(quote,instrument,now);check(decisionCompletedAt<=quote.asOf,'QUOTE_BEFORE_DECISION','결정 완료 뒤에 관측한 현재가를 사용하세요.');
  if(quote.source==='UPBIT_PUBLIC_ORDERBOOK')check(quote.book.action===decision.action,'QUOTE_SIDE_MISMATCH','매수는 최우선 매도 호가, 매도·평가는 최우선 매수 호가를 사용하세요.');
  const next=clone(account),position=next.positions.find(item=>item.instrumentId===instrument.id);if(position){check(quote.asOf>=position.priceAsOf,'QUOTE_TIME_REWIND','계좌 평가 이후의 호가를 사용하세요.');Object.assign(position,{marketPrice:quote.price,priceAsOf:quote.asOf,priceReceivedAt:quote.receivedAt});}
  for(const held of next.positions)check(Date.parse(now)-Date.parse(held.priceAsOf)<=30000,'VALUATION_REQUIRED','모든 보유 종목의 30초 이내 평가 가격을 준비하세요.');updateMetrics(next,now);
  return prepareFinancialTarget({next,run,manifest,quote,instrument,now,feeBps,slippageBps,graphProof,key});
}
function prepareFinancialTarget({next,run,manifest,quote,instrument,now,feeBps,slippageBps,graphProof,key,maximumQuantity=null}){
  const decision=run.decision,position=next.positions.find(item=>item.instrumentId===instrument.id);
  const metrics={cash:next.cash,equity:next.equity,holdingsValue:next.holdingsValue,weight:next.equity?next.holdingsValue/next.equity:0,dailyLossRatio:next.dailyRealizedLossRatio,quoteCurrency:next.quoteCurrency,quantity:position?.quantity??0,feeBps,slippageBps};
  if(decision.action==='hold')return {next,key,now,proposal:null,accountMetrics:metrics,outcome:'HOLD'};
  check(run.risk?.allowed===true,'RISK_BLOCKED','결정의 위험 검사 결과를 확인하세요.');check((graphProof||finite(decision.confidence)&&decision.confidence>=.6)&&Array.isArray(decision.evidenceRefs)&&decision.evidenceRefs.length>0,'DECISION_EVIDENCE_REQUIRED','검증된 판정과 직접 근거를 확인하세요.');
  const policy=manifest.data.riskPreset;check(feeBps<=policy.maxFeeBps&&slippageBps<=policy.maxSlippageBps,'COST_LIMIT','현재 비용이 승인된 상한을 넘었습니다.');
  const currentValue=(position?.quantity??0)*quote.price,fillPrice=quote.price*(decision.action==='buy'?1+slippageBps/10000:1-slippageBps/10000),feeRate=feeBps/10000,orderCap=next.equity*Math.min(policy.maxOrderWeight,graphProof?.maxOrderWeight??1),exposureCap=Math.min(policy.maxExposure,graphProof?.maxExposure??1);
  let quantity,targetWeight,remainderTargetWeight,strategyAllocation=null;
  if(decision.action==='buy'){
    check(decision.stance!=='defensive','DEFENSIVE_BUY','위험 관리 선택에 따라 추가 매수를 보류합니다.');check(next.dailyRealizedLossRatio<policy.dailyLossLimit,'DAILY_LOSS_LIMIT','당일 실현 손실 한도에 도달했습니다.');
    check(position||next.positions.length<manifest.data.universe.selection.maxPositions,'MAX_POSITIONS','동시 보유 종목 한도에 도달했습니다.');targetWeight=Math.min(graphProof?decision.targetWeight:decision.stance==='clutch'?policy.clutchBuyWeight:policy.normalBuyWeight,exposureCap);
    remainderTargetWeight=targetWeight;strategyAllocation=strategyAllocationCheck({manifest,run,account:next,quote,now});
    if(strategyAllocation){const requested=policy.clutchBuyWeight*strategyAllocation.allocationFactor,available=(currentValue+Math.min(orderCap,next.cash))/next.equity;remainderTargetWeight=Math.min(graphProof?targetWeight:requested,requested,strategyAllocation.strategyMaxExposure,exposureCap);targetWeight=Math.min(remainderTargetWeight,available);Object.assign(strategyAllocation,{baseTargetWeight:policy.clutchBuyWeight,requestedTargetWeight:requested,accountAvailableExposure:available,approvedTargetWeight:targetWeight,checkedAt:now});}
    const budget=Math.min(Math.max(0,targetWeight*next.equity-currentValue),Math.max(0,exposureCap*next.equity-next.holdingsValue),orderCap,next.cash);quantity=budget/(fillPrice*(1+feeRate));
  }else{check(position?.quantity>0,'NO_SPOT_HOLDING','해당 종목의 현물 보유 수량을 확인하세요.');targetWeight=graphProof?decision.targetWeight:policy.sellWeight;quantity=Math.min(position.quantity,Math.max(0,currentValue-targetWeight*next.equity)/quote.price,orderCap/quote.price);}
  const noOrderReason=mindTargetRemainder({action:decision.action,targetWeight:remainderTargetWeight,equity:next.equity,currentValue,quantity:position?.quantity??0,minimumNotional:minimumMindNotional(manifest,instrument)});
  if(noOrderReason)return {next,key,now,proposal:null,accountMetrics:metrics,outcome:'HOLD',noOrderReason};
  if(maximumQuantity!==null){check(finite(maximumQuantity)&&maximumQuantity>=0,'HISTORICAL_VOLUME_LIMIT','원문 거래량과 참여율 한도를 확인하세요.');quantity=Math.min(quantity,maximumQuantity);}
  const precision=instrument.assetClass==='equity'?1:1e8,fullExit=decision.action==='sell'&&targetWeight===0&&currentValue<=orderCap&&(maximumQuantity===null||position.quantity<=maximumQuantity);quantity=fullExit?position.quantity:Math.floor(quantity*precision)/precision;const gross=rounded(quantity*fillPrice),fee=rounded(gross*feeRate),cashChange=decision.action==='buy'?-rounded(gross+fee):rounded(gross-fee);
  check(quantity>0&&gross>=minimumMindNotional(manifest,instrument),'BELOW_MINIMUM_ORDER','목표 비중과 최소 주문 금액을 확인하세요.');check(next.cash+cashChange>=-1e-8,'INSUFFICIENT_CASH','모의 계좌의 가용 현금을 확인하세요.');
  if(quote.source==='UPBIT_PUBLIC_ORDERBOOK')check(quantity<=quote.book.availableQuantity,'INSUFFICIENT_BOOK_DEPTH','현재 최우선 호가의 잔량이 모의 주문 수량보다 적습니다. 새 호가를 조회하거나 주문 비중을 줄이세요.');
  const proposal={...(decision.intent?{intent:clone(decision.intent)}:{}),...(decision.intentContributors?{intentContributors:clone(decision.intentContributors)}:{}),...((decision.intent||decision.intentContributors)?{positionAction:decision.action==='buy'?(position?.quantity>0?'ADD':'ENTRY'):quantity>=position.quantity-1e-9?'EXIT':'REDUCE'}:{}),mode:'paper',version:MIND_PAPER_VERSION,runId:run.id,accountId:next.id,profileId:next.profileId,instrumentId:instrument.id,side:decision.action,stance:decision.stance,targetWeight,quantity,referencePrice:quote.price,fillPrice,gross,fee,cashChange,currency:next.quoteCurrency,feeBps,slippageBps,decisionAt:run.decisionAt,...(Object.hasOwn(run,'decisionCompletedAt')?{decisionCompletedAt:run.decisionCompletedAt}:{}),...(strategyAllocation?{strategyAllocation}:{}),marketAsOf:run.asOf,quote:clone(quote),manifestHash:run.manifestHash,fingerprint:key};
  return {next,key,now,proposal,accountMetrics:metrics,outcome:'FILLED'};
}
export function previewMindPaper(account,run,options={}){try{const prepared=prepare(account,run,options);return {ok:true,proposal:clone(prepared.proposal??null),accountMetrics:clone(prepared.accountMetrics??null),idempotent:!!prepared.duplicate,outcome:prepared.duplicate?.outcome??prepared.outcome,...(prepared.noOrderReason?{noOrderReason:clone(prepared.noOrderReason)}:{}),reasons:[]};}catch(error){if(!(error instanceof MindPaperError)&&!(error instanceof MindStrategyError)&&error.name!=='MindDocumentError'&&error.name!=='InstrumentError')throw error;return {ok:false,proposal:null,accountMetrics:null,idempotent:false,reasons:[reason(error.code??'INVALID_PAPER_INPUT',error.message)]};}}
export function executeMindPaper(account,run,options={}){
  let p;try{p=prepare(account,run,options);}catch(error){if(!(error instanceof MindPaperError)&&!(error instanceof MindStrategyError)&&error.name!=='MindDocumentError'&&error.name!=='InstrumentError')throw error;return {ok:false,account,execution:null,outcome:'BLOCKED',idempotent:false,reasons:[reason(error.code??'INVALID_PAPER_INPUT',error.message)]};}
  return applyPreparedPaper(account,run,p,options);
}
function applyPreparedPaper(account,run,p,options){
  if(p.duplicate)return {ok:true,account,execution:clone(account.ledger.find(fill=>fill.id===p.duplicate.executionId)??null),outcome:p.duplicate.outcome,outcomeRecord:clone(p.duplicate.outcomeRecord??null),idempotent:true,reasons:[]};
  const next=p.next,proposal=p.proposal;let execution=null;
  if(proposal){let position=next.positions.find(item=>item.instrumentId===proposal.instrumentId),realizedPnl=0;
    if(proposal.side==='buy'){if(!position){position={instrumentId:proposal.instrumentId,symbol:options.instrument.symbol,quoteCurrency:account.quoteCurrency,quantity:0,costBasis:0,averageCost:0,marketPrice:proposal.referencePrice,priceAsOf:proposal.quote.asOf,priceReceivedAt:proposal.quote.receivedAt};next.positions.push(position);}position.costBasis=rounded(position.costBasis+proposal.gross+proposal.fee);position.quantity=rounded(position.quantity+proposal.quantity);}
    else{const removed=proposal.quantity>=position.quantity-1e-9?position.costBasis:rounded(position.costBasis*proposal.quantity/position.quantity);position.quantity=rounded(Math.max(0,position.quantity-proposal.quantity));position.costBasis=rounded(position.costBasis-removed);realizedPnl=rounded(proposal.gross-proposal.fee-removed);}
    position.averageCost=position.quantity?position.costBasis/position.quantity:0;position.marketPrice=proposal.referencePrice;position.marketValue=rounded(position.quantity*position.marketPrice);position.unrealizedPnl=rounded(position.marketValue-position.costBasis);next.cash=rounded(Math.max(0,next.cash+proposal.cashChange));next.realizedPnl=rounded(next.realizedPnl+realizedPnl);next.feesPaid=rounded(next.feesPaid+proposal.fee);
    execution={...clone(proposal),id:`paper-fill-${hashInputPackage({accountId:account.id,runId:run.id}).slice(0,32)}`,at:p.now,realizedPnl,cashAfter:next.cash,quantityAfter:position.quantity,costBasisAfter:position.costBasis,slippageCost:rounded(Math.abs(proposal.fillPrice-proposal.referencePrice)*proposal.quantity),netCashFlow:proposal.cashChange,decisionEvidenceRefs:clone(run.decision.evidenceRefs)};next.ledger.push(execution);next.positions=next.positions.filter(item=>item.quantity>0);
  }
  const outcome=proposal?'FILLED':'HOLD';next.events.push({id:`paper-event-${hashInputPackage({accountId:account.id,runId:run.id}).slice(0,32)}`,type:proposal?'MIND_PAPER_FILLED':'MIND_PAPER_HELD',runId:run.id,instrumentId:run.instrumentId,at:p.now});updateMetrics(next,p.now);
  const outcomeRecord={schemaVersion:1,mode:'paper',runId:run.id,profileId:account.profileId,instrumentId:run.instrumentId,status:outcome,asOf:p.now,currency:account.quoteCurrency,executionId:execution?.id??null,equity:next.equity,cash:next.cash,netPnl:next.netPnl,netReturn:next.netReturn,feesPaid:execution?.fee??0,cumulativeFeesPaid:next.feesPaid,realizedPnl:execution?.realizedPnl??0,cumulativeRealizedPnl:next.realizedPnl,unrealizedPnl:next.unrealizedPnl,performanceWindow:'EXECUTION_MARK_ONLY',...(p.noOrderReason?{noOrderReason:clone(p.noOrderReason)}:{})};
  next.receipts.push({runId:run.id,fingerprint:p.key,outcome,outcomeRecord:clone(outcomeRecord),executionId:execution?.id??null,at:p.now});
  const errors=validateMindPaperAccount(next);if(errors.length)return {ok:false,account,execution:null,outcome:'BLOCKED',idempotent:false,reasons:errors};
  return {ok:true,account:next,execution,outcome,outcomeRecord,idempotent:false,reasons:[]};
}

/** Historical portfolio experiments share exactly the paper financial kernel.
 * Their explicit next-open evidence never satisfies the current-execution path. */
export function executeHistoricalMindPaperTarget(account,run,{manifest,instrument,quote,historical,now=quote?.asOf}={}){
  try{
    assertAccount(account);assertMindDocument(manifest);
    check(historical?.contractVersion==='PORTFOLIO_HISTORICAL_FILL_V1'&&historical.timeframe==='1d'&&historical.sourceHash===quote?.sourceHash&&/^[a-f0-9]{64}$/.test(historical.sourceHash??'')&&historical.asOf===run.asOf&&historical.nextOpenAt===run.asOf&&run.mode==='PORTFOLIO_HISTORICAL_SIMULATION','HISTORICAL_EXECUTION_SOURCE','확정 일봉과 바로 다음 시가의 실험 원문을 확인하세요.');
    check(quote.source==='UPBIT_DAILY_NEXT_OPEN'&&quote.priceBasis==='HISTORICAL_NEXT_OPEN'&&quote.executionAllowed===false&&quote.asOf===now&&quote.receivedAt===now&&finite(historical.volume)&&historical.volume>=0&&finite(historical.participationCap)&&historical.participationCap>0&&historical.participationCap<=.01,'HISTORICAL_EXECUTION_SOURCE','과거 시가와 거래량 참여율을 확인하세요.');
    const canonical=getInstrument(instrument?.id),targets=historical.targets;
    check(canonical.id===run.instrumentId&&canonical.quoteCurrency==='BTC'&&account.quoteCurrency==='BTC'&&manifest.scope.profileId===account.profileId&&run.profileId===account.profileId&&manifest.data.universe.instrumentIds.includes(run.instrumentId)&&run.manifestId===manifest.id&&run.manifestHash===mindDocumentHash(manifest),'RUN_SCOPE','실험의 마인드·종목·BTC 원장을 대조하세요.');
    check(targets?.contractVersion==='portfolio-target-weights-v1'&&targets.profileId===run.profileId&&targets.quoteCurrency==='BTC'&&targets.asOf===run.asOf&&targets.rebalanceDue===true&&Array.isArray(targets.targets)&&targets.targets.some(row=>row.instrumentId===run.instrumentId&&row.targetWeight===run.decision?.targetWeight)&&targets.targets.every(row=>finite(row.targetWeight)&&row.targetWeight>=0&&row.targetWeight<=1)&&targets.targets.reduce((n,r)=>n+r.targetWeight,0)<=1+1e-10,'HISTORICAL_TARGET_BINDING','노드 그래프의 최종 목표 비중을 대조하세요.');
    check(['buy','sell'].includes(run.decision.action)&&run.decision.stance==='normal'&&run.decisionAt===now&&run.risk?.allowed===true&&iso(now)&&now>=account.updatedAt,'HISTORICAL_TARGET_BINDING','실험의 확정 시점·방향·위험 결과를 확인하세요.');
    assertQuote(quote,canonical,now,{fresh:false});
    const next=clone(account),position=next.positions.find(p=>p.instrumentId===instrument.id);
    if(position)Object.assign(position,{marketPrice:quote.price,priceAsOf:now,priceReceivedAt:now});
    check(next.positions.every(p=>p.priceAsOf===now),'VALUATION_REQUIRED','동일 시점에 보유 종목 전체를 평가하세요.');updateMetrics(next,now);
    const key=fingerprint(account,run,manifest),previous=account.receipts.find(r=>r.runId===run.id);
    if(previous){check(previous.fingerprint===key,'IDEMPOTENCY_CONFLICT','같은 실험 결정의 원문을 보존하세요.');return applyPreparedPaper(account,run,{duplicate:previous,key,now},{instrument});}
    const riskNode=manifest.data.strategyPlan?.graph?.nodes.find(node=>node.type==='RISK'&&node.config.mode==='PORTFOLIO');
    check(riskNode&&finite(riskNode.config.maxExposure)&&finite(riskNode.config.maxOrderWeight),'HISTORICAL_RISK_NODE','포트폴리오 위험 노드를 연결하세요.');
    const prepared=prepareFinancialTarget({next,run,manifest,quote,instrument:canonical,now,...account.costPolicy,graphProof:riskNode.config,key,maximumQuantity:historical.volume*historical.participationCap});
    return applyPreparedPaper(account,run,prepared,{instrument:canonical});
  }catch(error){if(!(error instanceof MindPaperError)&&!(error instanceof MindStrategyError)&&error.name!=='MindDocumentError'&&error.name!=='InstrumentError')throw error;return {ok:false,account,execution:null,outcome:'BLOCKED',idempotent:false,reasons:[reason(error.code??'INVALID_PAPER_INPUT',error.message)]};}
}
export function mindPaperPortfolioState(account,instrumentId){assertAccount(account);const position=account.positions.find(item=>item.instrumentId===instrumentId);return {quoteCurrency:account.quoteCurrency,cash:account.cash,quantity:position?.quantity??0,equity:account.equity,weight:account.equity?(position?.quantity??0)*(position?.marketPrice??0)/account.equity:0,totalWeight:account.equity?account.holdingsValue/account.equity:0,dailyLossRatio:account.dailyRealizedLossRatio,feeBps:account.costPolicy.feeBps,slippageBps:account.costPolicy.slippageBps};}

export function transferMindPaperCash(account,{amount,transferId,now}){
  assertAccount(account);check(finite(amount)&&amount!==0&&rounded(amount)===amount&&id(transferId)&&iso(now)&&now>=account.updatedAt,'INVALID_FUNDING','자금 이동 금액과 시각을 확인하세요.');
  check(account.cash+amount>=0,'INSUFFICIENT_CASH','회수할 수 있는 현금이 부족합니다.');
  const next=clone(account);next.fundingLedger??=[];check(!next.fundingLedger.some(f=>f.id===transferId),'DUPLICATE_FUNDING','이미 처리한 자금 이동입니다.');
  next.cash=rounded(next.cash+amount);next.fundingLedger.push({id:transferId,amount,cashAfter:next.cash,ledgerOffset:next.ledger.length,at:now});
  next.dayStartEquity=Math.max(0,rounded(next.dayStartEquity+amount));updateMetrics(next,now);assertAccount(next);return next;
}
