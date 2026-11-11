import {gameUnits as units,gameDecimal as decimal} from './mind-game.mjs';
import {researchSha256} from './research.mjs';
import {buildInvestorPerformance} from './investor-performance.mjs';

export const BROKERAGE_REPORT_VERSION='brokerage-report-v3';
export const brokerageReportHash=body=>researchSha256(JSON.stringify(body));
export const BROKERAGE_REPORT_STAGES=Object.freeze([
 ['mandate','운용 위임','기간, 자금, 투자 범위, 한도와 승인 이력'],
 ['research','시장과 뉴스','시장 국면, 출처, 공개 시각과 실제 입력'],
 ['selection','전략과 종목','학습 구간, 비용 반영 추정치와 선택 근거'],
 ['allocation','자산 배분','현재 보유, 목표 비중, 차이와 편입 금액'],
 ['execution','주문과 체결','주문 방식, 체결, 미체결, 가격 차이와 수수료'],
 ['settlement','정산과 보관','현금, 수량, 취득 원가와 거래소 잔고 대사'],
 ['performance','수익과 기여','입출금 조정 수익률, 종목별 손익과 벤치마크'],
 ['risk','위험 관리','낙폭, 회복, 집중도, 손실 한도와 가격 충격'],
 ['costs','운용 비용','거래 수수료, 실제 AI 사용량과 비용 포함 범위'],
 ['review','모델 사후 평가','모델 변경, 자동 채택, 예측과 후속 실제 결과'],
 ['tax','세무 기초자료','처분 내역, 취득 원가, 실현 손익과 증빙'],
 ['operations','운영과 다음 계획','실행 상태, 자료 품질, 담당 기관과 다음 판단'],
].map(([id,title,content])=>Object.freeze({id,title,content})));
const sum=values=>values.reduce((s,v)=>s+units(v??'0'),0n),ratio=(a,b)=>b>0n?Number(a)/Number(b):null;
const at=v=>typeof v==='string'&&Number.isFinite(Date.parse(v));
const cleanNumber=v=>Number.isFinite(v)?v:null;
const OPEN=new Set(['RESERVED','UNKNOWN','PENDING','PARTIALLY_FILLED','RECONCILIATION_REQUIRED','RESPONSE_REVIEW_REQUIRED']);

export function reportTradingActivityRatio(trades,equity){
 if(equity===null||equity===undefined||!Array.isArray(trades)||trades.some(t=>typeof t.exactGross!=='string'))return null;
 return ratio(sum(trades.map(t=>t.exactGross)),units(equity));
}

/** Wealth indices remove external capital flows before measuring drawdown. */
export function observedPortfolioRisk(observations,flows=[],{cashOnlySinceStart=false,startAt,endAt}={}){
 const points=observations.filter(p=>p.equity!==null&&at(p.asOf)&&p.asOf>=startAt&&p.asOf<=endAt).toSorted((a,b)=>a.asOf.localeCompare(b.asOf));
 const result={basis:cashOnlySinceStart?'CASH_LEDGER_RECONSTRUCTION':'OBSERVED_MARK_TO_MARKET_60S',from:points[0]?.asOf??null,to:points.at(-1)?.asOf??null,points:points.length,intervalMs:60000,complete:false,timeWeightedReturn:null,observedMdd:null,maxDrawdown:null,recoveryMs:null,recovered:null,maxGapMs:null,var95:null,expectedShortfall95:null,volatilityPerObservation:null};
 if(cashOnlySinceStart&&points.length){return {...result,from:startAt,to:endAt,complete:true,timeWeightedReturn:0,observedMdd:0,maxDrawdown:0,recoveryMs:0,recovered:true,maxGapMs:0};}
 if(points.length<2)return result;
 let wealth=1,peak=1,mdd=0,peakAt=points[0].asOf,drawdownAt=null,recoveredAt=null,maxGap=0,flowComplete=true;const returns=[];
 for(let i=1;i<points.length;i++){
  const p=points[i-1],q=points[i],events=flows.filter(f=>f.at>p.asOf&&f.at<=q.asOf);
  // A valuation at the flow time is required for an exact linked return.
  if(events.some(f=>f.at!==q.asOf)){flowComplete=false;continue;}
  const base=units(p.equity),net=units(q.equity)-sum(events.map(f=>f.amount));if(base<=0n||net<0n){flowComplete=false;continue;}
  const r=ratio(net-base,base);wealth*=1+r;returns.push(r);maxGap=Math.max(maxGap,Date.parse(q.asOf)-Date.parse(p.asOf));
  if(wealth>=peak){if(drawdownAt&&!recoveredAt)recoveredAt=q.asOf;peak=wealth;peakAt=q.asOf;}
  const dd=1-wealth/peak;if(dd>mdd){mdd=dd;drawdownAt=peakAt;recoveredAt=null;}
 }
 const full=flowComplete&&points[0].asOf===startAt&&Date.parse(endAt)-Date.parse(points.at(-1).asOf)<=90000&&maxGap<=90000;
 const sorted=returns.toSorted((a,b)=>a-b),enough=sorted.length>=30,index=Math.max(0,Math.ceil(sorted.length*.05)-1),tail=sorted.slice(0,index+1),mean=returns.reduce((s,v)=>s+v,0)/Math.max(1,returns.length);
 return {...result,complete:full,timeWeightedReturn:flowComplete?wealth-1:null,observedMdd:flowComplete?mdd:null,maxDrawdown:full?mdd:null,recovered:drawdownAt?!!recoveredAt:true,recoveryMs:drawdownAt?(Date.parse(recoveredAt??endAt)-Date.parse(drawdownAt)):0,maxGapMs:maxGap,var95:enough?Math.max(0,-sorted[index]):null,expectedShortfall95:enough?Math.max(0,-tail.reduce((s,v)=>s+v,0)/tail.length):null,volatilityPerObservation:enough?Math.sqrt(returns.reduce((s,v)=>s+(v-mean)**2,0)/(returns.length-1)):null};
}

export function reportBenchmark(observations,{buyFee,sellFee}={}){
 if(buyFee===undefined||sellFee===undefined)return {status:'FEE_DATA_REQUIRED',btcNetReturn:null,portfolioReturn:null,excessReturn:null,cashReturn:0};
 const points=observations.filter(p=>p.equity!==null&&p.btc?.sourceHash&&Number(p.btc.bid)>0&&Number(p.btc.ask)>=Number(p.btc.bid)&&p.btc.availableAt<=p.asOf).toSorted((a,b)=>a.asOf.localeCompare(b.asOf));
 if(points.length<2)return {status:'COLLECTING',from:points[0]?.asOf??null,to:points.at(-1)?.asOf??null,samples:points.length,btcNetReturn:null,portfolioReturn:null,excessReturn:null,cashReturn:0,basis:'OBSERVED_BTC_BID_ASK_AND_ACCOUNT_FEES'};
 const first=points[0],last=points.at(-1),btc=Number(last.btc.bid)*(1-Number(sellFee))/(Number(first.btc.ask)*(1+Number(buyFee)))-1;
 const portfolio=ratio(units(last.equity)-units(first.equity),units(first.equity));
 return {status:'READY',from:first.asOf,to:last.asOf,samples:points.length,btcNetReturn:btc,portfolioReturn:portfolio,excessReturn:portfolio===null?null:portfolio-btc,cashReturn:0,basis:'OBSERVED_BTC_BID_ASK_AND_ACCOUNT_FEES',depth:'TOP_OF_BOOK_REFERENCE',firstSourceHash:first.btc.sourceHash,lastSourceHash:last.btc.sourceHash};
}

export function buildBrokerageReport({id,activation,activity,decision,decisionEventId,market,news=[],orders=[],fills=[],observations=[],modelUsage=[],broker=null,promotions=[],events=[],generatedAt,sourceCutoffAt,supersedes=null,nextAnalysisAt}={}){
 if(!id||!activation?.config||!activity?.ledger||!at(generatedAt))throw Error('REPORT_INPUT');
 const c=activation.config,m=activity.investorMetrics??{},ledger=activity.ledger,evaluation=decision?.evaluation,trace=evaluation?.trace??[],router=trace.find(n=>n.type==='PORTFOLIO_ROUTER')??trace.find(n=>n.type==='MODEL'&&n.output?.modelReview)?.output.modelReview,target=evaluation?.output?.value,flows=m.flows??[];
 const positions=ledger.positions.map(p=>{const quote=m.valuationSources?.find(q=>q.instrumentId===p.instrumentId),value=quote?decimal(units(p.quantity)*units(String(quote.price))/10n**18n):null;return {...p,marketValue:value,unrealizedPnl:value===null?null:decimal(units(value)-units(p.costBasis)),weight:value!==null&&m.equity?ratio(units(value),units(m.equity)):null,price:quote?.price??null,valuationAt:quote?.asOf??null};});
 const cashOnlySinceStart=fills.length===0&&!positions.length&&m.status==='READY'&&units(m.pnl??'1')===0n&&units(ledger.feesPaid)===0n;
 const risk=observedPortfolioRisk(observations,flows,{cashOnlySinceStart,startAt:activation.userConfirmedAt,endAt:generatedAt});
 const benchmark=flows.length?{...reportBenchmark([]),status:'FLOW_ADJUSTMENT_REQUIRED'}:reportBenchmark(observations,{buyFee:broker?.fees?.takerBuyRate,sellFee:broker?.fees?.takerSellRate});
 const periods=[1,7,30].map(days=>{const cutoff=new Date(Math.max(Date.parse(activation.userConfirmedAt),Date.parse(generatedAt)-days*86400000)).toISOString(),point=observations.find(p=>p.asOf>=cutoff&&p.equity!==null),from=cashOnlySinceStart?cutoff:point?.asOf;if(!from)return {days,status:'COLLECTING',return:null};const opening=cashOnlySinceStart?decimal(units(m.initialCapital)+sum(flows.filter(f=>f.at<=from).map(f=>f.amount))):point.equity,periodFlows=flows.filter(f=>f.at>from&&f.at<=generatedAt),capital=decimal(units(opening)+sum(periodFlows.map(f=>f.amount))),v=buildInvestorPerformance({currency:c.quoteCurrency,startAt:from,asOf:generatedAt,initialCapital:opening,netContributedCapital:capital,flows:periodFlows,currentEquity:m.equity,valuationAt:m.valuationAt,ledgerAsOf:m.ledgerAsOf,realizedPnl:'0',feesPaid:'0',cash:ledger.cash,realizedTimeline:[],source:'BROKERAGE_NAV_BOUNDARIES'});return {days,from,to:generatedAt,fullWindow:Date.parse(generatedAt)-Date.parse(from)>=days*86400000-90000,status:v.status,return:v.flowAdjustedReturn??null,pnl:v.pnl??null};});
 const byMarket=new Map();
 for(const f of fills){if(typeof f.exactGross!=='string')throw Error('REPORT_EXACT_FILL_REQUIRED');const row=byMarket.get(f.instrumentId)??{instrumentId:f.instrumentId,realizedPnl:0n,fees:0n,buyGross:0n,sellGross:0n,fillCount:0};row.realizedPnl+=units(f.exactRealizedPnl);row.fees+=units(f.exactFee);row[f.side==='buy'?'buyGross':'sellGross']+=units(f.exactGross);row.fillCount++;byMarket.set(f.instrumentId,row);}
 for(const p of positions)if(!byMarket.has(p.instrumentId))byMarket.set(p.instrumentId,{instrumentId:p.instrumentId,realizedPnl:0n,fees:0n,buyGross:0n,sellGross:0n,fillCount:0});
 const attribution=[...byMarket.values()].map(r=>{const held=positions.find(p=>p.instrumentId===r.instrumentId),unrealized=held?.unrealizedPnl??(held?null:'0');return {...r,realizedPnl:decimal(r.realizedPnl),fees:decimal(r.fees),buyGross:decimal(r.buyGross),sellGross:decimal(r.sellGross),unrealizedPnl:unrealized,netPnl:unrealized===null?null:decimal(r.realizedPnl+units(unrealized))};});
 const orderDetails=orders.map(o=>{const own=fills.filter(f=>f.exchangeOrderIdentifier===o.identifier),quantity=own.reduce((s,f)=>s+f.quantity,0),gross=Number(decimal(sum(own.map(f=>f.exactGross)))),projected=Number(o.plan?.currentlyExecutableGross)/Number(o.plan?.currentlyExecutableQuantity),vwap=quantity?gross/quantity:null,side=o.request?.side==='bid'?'buy':'sell';return {identifier:o.identifier,market:o.request?.market,side,type:o.request?.ord_type,timeInForce:o.request?.time_in_force??null,state:o.state,createdAt:o.reservedAt??o.createdAt,completedAt:own.at(-1)?.at??null,requestedQuantity:o.request?.volume??o.plan?.requestedQuantity??null,filledQuantity:quantity,fee:decimal(sum(own.map(f=>f.exactFee))),vwap,bookProjectedVwap:cleanNumber(projected),shortfallBps:vwap!==null&&projected>0?(side==='buy'?vwap/projected-1:1-vwap/projected)*10000:null,observedSpreadBps:o.plan?.spreadBps??null,decisionAsOf:o.plan?.signalEvidence?.snapshotAsOf??null,bookAsOf:o.plan?.bookEventTime??null,bookSourceHash:o.plan?.bookSourceHash??null,decisionToFillMs:own.length&&at(o.plan?.signalEvidence?.snapshotAsOf)?Date.parse(own.at(-1).at)-Date.parse(o.plan.signalEvidence.snapshotAsOf):null};});
 const unpriced=modelUsage.filter(u=>u.cost===null||!u.currency),tokens=modelUsage.reduce((s,u)=>s+(u.inputTokens??0)+(u.outputTokens??0),0),currencies=[...new Set(modelUsage.map(u=>u.currency).filter(Boolean))],totals=currencies.map(currency=>({currency,amount:decimal(sum(modelUsage.filter(u=>u.currency===currency&&u.cost!==null).map(u=>u.cost)))}));
 const modelKrw=unpriced.length||currencies.some(v=>v!=='KRW')?null:sum(modelUsage.map(u=>u.cost??'0')),allInPnl=m.pnl===null||m.pnl===undefined||modelKrw===null?null:decimal(units(m.pnl)-modelKrw);
 const experts=(router?.experts??[]).map(e=>({mode:e.mode,expectedNetReturn:cleanNumber(Math.expm1(e.netLogReturn)),selectionScore:e.score,selectionBasis:e.selectionBasis??'CONDITIONAL_MEAN',allocation:e.allocation,samples:e.samples,effectiveSamples:e.effectiveSamples,switchCost:e.switchCost,newsAdjustment:e.newsAdjustment}));
 const allocation=(target?.targets??[]).map(t=>{const p=positions.find(p=>p.instrumentId===t.instrumentId);return {...t,currentWeight:p?.weight??0,currentValue:p?.marketValue??'0',targetValue:m.equity?decimal(units(m.equity)*BigInt(Math.round(t.targetWeight*1e12))/10n**12n):null};}).filter(t=>t.targetWeight>0||Number(t.currentValue)>0);
 allocation.push({instrumentId:'CASH:'+c.quoteCurrency,currentWeight:m.equity?Number(ledger.cash)/Number(m.equity):null,targetWeight:target?.cashWeight??null,currentValue:ledger.cash,targetValue:m.equity&&target?decimal(units(m.equity)*BigInt(Math.round(target.cashWeight*1e12))/10n**12n):null});
 const quality=[];if(m.status!=='READY')quality.push({code:'PERFORMANCE_DATA',detail:m.reason??ledger.status});if(!risk.complete)quality.push({code:'NAV_PATH_PARTIAL',detail:'60초 평가 관측의 전체 기간 경로를 수집합니다.'});if(benchmark.status!=='READY')quality.push({code:'BENCHMARK_WINDOW',detail:'동일한 NAV·BTC 호가 관측 시점의 비교 표본을 수집합니다.'});if(unpriced.length)quality.push({code:'MODEL_PRICE_MISSING',detail:'실제 모델 사용량의 공급자 청구액을 연결합니다.'});if(!broker)quality.push({code:'BROKER_SNAPSHOT_MISSING',detail:'거래소 잔고·수수료 스냅샷을 다시 조회합니다.'});if(decision?.policyRef?.graphHash!==c.graphHash)quality.push({code:'DECISION_GRAPH_CHANGED',detail:'판단 당시 모델과 현재 모델을 각각 대조합니다.'});
 const cash=target?.cashWeight===1,selected=experts.filter(e=>e.allocation>0).map(e=>e.mode),headline=cash?'현금 유지':selected.length?selected.join(', ')+' 배분':'목표 비중 관리';
 const report={schemaVersion:1,contractVersion:BROKERAGE_REPORT_VERSION,id,generatedAt,sourceCutoffAt:sourceCutoffAt??generatedAt,supersedes,activationId:activation.id,profileId:c.profileId,accountId:c.accountId,currency:c.quoteCurrency,decisionEventId,stages:BROKERAGE_REPORT_STAGES,
  summary:{headline,selection:cash?'비현금 전략의 비용 반영 추정치와 현금을 비교해 현금을 선택했습니다.':'선택한 전략의 목표 비중과 현재 보유의 차이를 주문에 연결했습니다.',equity:m.equity??null,netPnl:m.pnl??null,netReturn:m.flowAdjustedReturn??null,allInPnl,orders:orders.length,fills:fills.length,cashWeight:target?.cashWeight??null,nextAnalysisAt},
  mandate:{startsAt:c.startsAt??activation.userConfirmedAt,endsAt:c.endsAt??null,durationDays:activation.mandate?.durationDays??null,discretion:activation.mandate?.discretion??[],capitalLimit:c.capitalLimit,perOrderLimit:c.perOrderLimit,dailyLossLimit:c.dailyLossLimit,maxTradesPerDay:c.maxTradesPerDay,minIntervalMs:c.minIntervalMs,marketCount:c.marketIds.length,sourceActivationIds:activation.sourceActivationIds??[],objective:'기회별 적극 배분과 비용 차감 순수익 확대'},
  research:{marketAsOf:market?.asOf??null,availableAt:market?.availableAt??null,observedMarkets:market?.observedMarketCount??0,approvedMarkets:c.marketIds.length,sourceCount:market?.sourceCount??0,regime:router?.regime??null,news,trainedThrough:router?.trainedThrough??null,predictionHorizon:router?.predictionHorizon??null,samples:router?.samples??null,costBps:router?.costBps??null,experts,forecastBasis:'HISTORICAL_CONDITIONAL_ESTIMATE'},allocation,
  execution:{orders:orderDetails,trades:fills,pending:orders.filter(o=>OPEN.has(o.state)).length,rejected:orders.filter(o=>['FAILED','REJECTED','CANCELLED'].includes(o.state)).length,fillCount:fills.length,turnover:reportTradingActivityRatio(fills,m.equity),turnoverBasis:'GROSS_BUY_SELL_VALUE_OVER_REPORT_EQUITY',shortfallBasis:'ACTUAL_VWAP_VS_OBSERVED_BOOK_PROJECTION'},
  accounting:{status:ledger.status,cash:ledger.cash,reservedCash:ledger.reservedCash,availableCash:ledger.availableCash,equity:m.equity??null,netContributions:m.netContributions??null,initialCapital:m.initialCapital??null,additionalDeposits:m.additionalDeposits??null,withdrawals:m.withdrawals??null,realizedPnl:ledger.realizedPnl,unrealizedPnl:m.unrealizedPnl??null,feesPaid:ledger.feesPaid,positions,flows,valuationAt:m.valuationAt??ledger.valuationAsOf,ledgerAsOf:ledger.ledgerAsOf,sourceRevision:m.sourceRevision??null,broker},
  performance:{flowAdjustedReturn:m.flowAdjustedReturn??null,method:m.method??null,dailyEquivalentReturn:m.dailyEquivalentReturn??null,dailyBasis:'ELAPSED_TIME_GEOMETRIC_EQUIVALENT',elapsedDays:m.elapsedDays??null,timeWeightedReturn:risk.timeWeightedReturn,periods,benchmark,attribution,chart:observations.map(p=>({at:p.asOf,equity:p.equity,btcBid:p.btc?.bid??null,btcAsk:p.btc?.ask??null}))},
  risk:{...risk,cashOnlySinceStart,lossLimit:c.dailyLossLimit,lossLimitRatio:ratio(units(c.dailyLossLimit),units(c.capitalLimit)),concentration:positions.some(p=>p.weight===null)?null:positions.length?Math.max(...positions.map(p=>p.weight)):0,stress:[-.1,-.2,-.3].map(shock=>({shock,estimatedPnl:m.equity?Number(decimal(units(m.equity)-units(ledger.cash)))*shock:null,basis:'CURRENT_HOLDINGS_PARALLEL_PRICE_SHOCK_ASSUMPTION'}))},
  costs:{tradingFees:ledger.feesPaid,feeAccounting:'ALREADY_INCLUDED_IN_NET_PNL',modelCalls:modelUsage.length,inputTokens:modelUsage.reduce((s,u)=>s+(u.inputTokens??0),0),outputTokens:tokens-modelUsage.reduce((s,u)=>s+(u.inputTokens??0),0),modelUsage,modelTotals:totals,unpricedModelCalls:unpriced.length,allInPnl,modelCostBasis:'ACTUAL_CALLS_DURING_THIS_ACTIVATION',researchSetupCost:'EXCLUDED_SEPARATE_PRIOR_PERIOD'},
  governance:{manifestId:c.manifestId,manifestHash:c.manifestHash,graphHash:c.graphHash,decisionGraphHash:decision?.policyRef?.graphHash??null,evaluationHash:evaluation?.outputHash??null,automaticPromotions:promotions,changes:events.filter(e=>['CAPITAL_UPDATED','STRATEGY_UPDATE_APPLIED','PORTFOLIO_CONSOLIDATED'].includes(e.kind)).map(e=>({id:e.id,kind:e.kind,at:e.recordedAt})),roles:[['운용·판단','VIV 그래프와 실행기'],['주문·체결·보관','연결 거래소 '+c.accountId],['정산·수량 대조','거래소 체결과 공용 원장'],['승인·한도','저장된 운용 위임'],['세무 기초자료','체결·취득 원가·실현 손익 내보내기']]},
  operations:{runtime:activity.runtime,policyStatus:activation.status,pendingOrders:activity.pendingOrderCount,nextAnalysisAt,coverage:quality,reportingCadence:'AFTER_EACH_COMPLETED_PORTFOLIO_DECISION',navCadenceSeconds:60},
  tax:{currency:c.quoteCurrency,realizedPnl:ledger.realizedPnl,feesPaid:ledger.feesPaid,disposalCount:fills.filter(f=>f.side==='sell').length,basis:'ACTUAL_FILLS_AND_ACQUISITION_COST',assessment:'BROKER_TAX_STATEMENT_REQUIRED'},
 };
 const persisted=JSON.parse(JSON.stringify(report));return {...persisted,reportHash:brokerageReportHash(persisted)};
}
