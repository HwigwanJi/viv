import {hashInputPackage} from './workspace.mjs';

export const SESSION_RULE_VERSION='equity-split-rule-v1';
export const SESSION_ASSET_MODE='US_EQUITY_SESSION';
export const SESSION_RULE_DEFAULTS=Object.freeze({ruleVersion:'LAOR_V4_20260802',symbol:'TQQQ',splits:40,compound:'FULL'});
const finite=n=>typeof n==='number'&&Number.isFinite(n),iso=s=>typeof s==='string'&&Number.isFinite(Date.parse(s))&&new Date(s).toISOString()===s;
const check=(v,message)=>{if(!v)throw Object.assign(new Error(message),{code:'SESSION_RULE_INPUT',status:400});};
const cents=p=>Math.round((p+Number.EPSILON)*100)/100;
export function assertSessionRuleConfig(c){
 check(c&&[4,5].includes(Object.keys(c).length)&&(!Object.hasOwn(c,'maxExposure')?Object.keys(c).length===4:Object.keys(c).length===5&&finite(c.maxExposure)&&c.maxExposure>=0&&c.maxExposure<=1)&&c.ruleVersion==='LAOR_V4_20260802'&&['TQQQ','SOXL'].includes(c.symbol)&&[20,40].includes(c.splits)&&c.compound==='FULL','전략 버전, TQQQ 또는 SOXL, 20 또는 40분할 및 전액 재투자 설정 확인');return c;
}
export function createSessionAccount({symbol='TQQQ',initialCash=100000}={}){
 check(['TQQQ','SOXL'].includes(symbol)&&finite(initialCash)&&initialCash>0&&initialCash<=1e12,'종목 및 초기 USD 자금 확인');
 return {contractVersion:SESSION_RULE_VERSION,symbol,initialCash,cash:initialCash,quantity:0,costBasis:0,realizedPnl:0,feesPaid:0,dividendsPaid:0,t:0,mode:'NORMAL',cycle:1,lastDate:null,history:[],lastPlanHash:null,lastFills:[]};
}
export function assertSessionAccount(s){
 check(s?.contractVersion===SESSION_RULE_VERSION&&['TQQQ','SOXL'].includes(s.symbol)&&['NORMAL','REVERSE'].includes(s.mode)&&[s.initialCash,s.cash,s.quantity,s.costBasis,s.t,s.feesPaid,s.realizedPnl,s.dividendsPaid].every(finite)&&s.initialCash>0&&s.cash>=-1e-7&&Number.isSafeInteger(s.quantity)&&s.quantity>=0&&s.costBasis>=0&&s.t>=0&&Number.isSafeInteger(s.cycle)&&s.cycle>0&&Array.isArray(s.history)&&s.history.length<=5&&s.history.every(p=>finite(p)&&p>0)&&(s.quantity>0||s.costBasis===0),'주기 상태 및 USD 계좌 원장 확인');return s;
}
/** Orders are fixed before the session. The ladder has an explicit finite floor. */
function buyLadder(orders,budget,cap,leg,feeRate){
 cap=cents(cap);if(cap<.01||budget<.01*(1+feeRate))return;
 const net=budget/(1+feeRate),base=Math.floor(net/cap+1e-10);
 if(base>0)orders.push({side:'buy',type:'LOC',quantity:base,limitPrice:cap,leg});
 let previous=cap;
 for(let q=base+1;q<=base+2000;q++){
  const price=Math.floor((net/q+1e-10)*100)/100;
  if(price<.01)break;
  if(price===previous&&orders.at(-1)?.leg===leg){orders.at(-1).quantity++;continue;}
  orders.push({side:'buy',type:'LOC',quantity:1,limitPrice:price,leg});previous=price;
 }
}
export function prepareSessionPlan(account,config,options={}){
 assertSessionRuleConfig(config);if(Object.hasOwn(config,'maxExposure'))return prepareCappedSessionPlan(account,config,options);
 const {date,decisionAt,feeBps=10}=options;
 assertSessionAccount(account);assertSessionRuleConfig(config);
 check(account.symbol===config.symbol&&/^\d{4}-\d{2}-\d{2}$/.test(date??'')&&iso(decisionAt)&&decisionAt.slice(0,10)===date&&(!account.lastDate||date>account.lastDate)&&account.history.length>0&&finite(feeBps)&&feeBps>=0&&feeBps<=1000,'거래일, 확정 가격 이력, 판단 시각 및 비용 확인');
 const s=structuredClone(account),target=config.symbol==='TQQQ'?.15:.20,average=s.quantity?s.costBasis/s.quantity:0,orders=[],feeRate=feeBps/10000,previous=s.history.at(-1),reverseStart=s.mode==='NORMAL'&&s.t>config.splits-1;
 if(reverseStart)s.mode='REVERSE';
 const star=s.mode==='REVERSE'?(s.history.length===5?s.history.reduce((a,b)=>a+b,0)/5:null):average*(1+target-target*2/config.splits*s.t);
 const addSell=(type,quantity,limitPrice,leg)=>{if(quantity>0)orders.push({side:'sell',type,quantity,limitPrice:type==='MOC'?null:cents(limitPrice),leg});};
 let budget=0,forced=false;
 if(s.mode==='REVERSE'){
  check(star!==null,'리버스 모드의 직전 5거래일 종가 확인');
  budget=s.cash/4;forced=reverseStart||budget<cents(star-.01)*(1+feeRate);
  addSell(forced?'MOC':'LOC',Math.floor(s.quantity/(config.splits/2)),star,'REVERSE_SELL');
  if(!forced)buyLadder(orders,budget,star-.01,'REVERSE_BUY',feeRate);
 }else{
  check(config.splits-s.t>0,'일반 모드 잔여 분할 확인');budget=s.cash/(config.splits-s.t);
  if(!s.quantity)buyLadder(orders,budget,previous*1.125,'ENTRY',feeRate);
  else{
   if(s.t<config.splits/2){buyLadder(orders,budget/2,star-.01,'FIRST_STAR',feeRate);buyLadder(orders,budget/2,average,'FIRST_COST',feeRate);}
   else buyLadder(orders,budget,star-.01,'SECOND_STAR',feeRate);
   const quarter=Math.floor(s.quantity/4);addSell('LOC',quarter,star,'QUARTER');addSell('LIMIT',s.quantity-quarter,average*(1+target),'TARGET');
  }
 }
 const body={contractVersion:SESSION_RULE_VERSION,config:structuredClone(config),date,decisionAt,feeBps,accountHash:hashInputPackage(account),mode:s.mode,reverseStart,forced,star:star===null?null:cents(star),budget,orders:orders.map((o,i)=>({...o,id:'order-'+i})),assumptions:['FULL_REINVESTMENT','REVERSE_SELL_LOC_ASSUMED','BUY_LADDER_MAX_2000_EXTRA_SHARES_PER_LEG','COST_BASIS_INCLUDES_BUY_FEES','ENTRY_LOC_PREVIOUS_CLOSE_PLUS_12_5_PERCENT','PARTIAL_FILL_T_PROPORTIONAL_TO_ELIGIBLE_QUANTITY','RISK_NO_CREDIT_NO_SHORT']};
 return {...body,planHash:hashInputPackage(body)};
}
export function assertSessionPlan(plan,account){
 const {planHash,...body}=plan??{};assertSessionAccount(account);
 check(hashInputPackage(body)===planHash&&plan.contractVersion===SESSION_RULE_VERSION&&plan.accountHash===hashInputPackage(account),'주문 계획과 계좌 해시 대조');assertSessionRuleConfig(plan.config);
 check(plan.config.symbol===account.symbol&&iso(plan.decisionAt)&&plan.date===plan.decisionAt.slice(0,10)&&(!account.lastDate||plan.date>account.lastDate)&&Array.isArray(plan.orders)&&plan.orders.length<=8005,'계좌 종목 및 주문 계획 범위 확인');
 if(plan.strategy)check(Object.keys(plan.strategy).sort().join(',')==='previousWeight,regime,resetT,targetWeight'&&['TREND','REBOUND','SPLIT'].includes(plan.strategy.regime)&&typeof plan.strategy.resetT==='boolean'&&[plan.strategy.targetWeight,plan.strategy.previousWeight].every(n=>finite(n)&&n>=0&&n<=1),'국면별 운용 상태 및 비중 확인');
 if(plan.sizingEvidence){const e=plan.sizingEvidence;check(Object.keys(e).sort().join(',')==='cap,lastDate,method,volatility,volatilityTarget'&&e.method==='PRIOR_QQQ_VOL20_X3'&&finite(e.volatility)&&e.volatility>=0&&finite(e.volatilityTarget)&&e.volatilityTarget>0&&e.volatilityTarget<=1&&finite(e.cap)&&e.cap>=0&&e.cap<=1&&/^\d{4}-\d{2}-\d{2}$/.test(e.lastDate)&&e.lastDate<plan.date&&plan.strategy&&Math.abs(plan.strategy.targetWeight-(e.volatility>0?Math.min(e.cap,e.volatilityTarget/e.volatility):e.cap))<1e-12,'직전 변동성 자료와 실제 목표 비중 대조');}
 const ids=new Set();let sells=0;
 for(const o of plan.orders){check(typeof o.id==='string'&&!ids.has(o.id)&&['buy','sell'].includes(o.side)&&['LOC','MOC','LIMIT'].includes(o.type)&&Number.isSafeInteger(o.quantity)&&o.quantity>0&&(o.type==='MOC'?o.limitPrice===null:finite(o.limitPrice)&&o.limitPrice>0)&&typeof o.leg==='string','주문 유형, 수량 및 가격 확인');ids.add(o.id);if(o.side==='sell')sells+=o.quantity;}
 check(sells<=account.quantity,'보유 수량 이내 매도 확인');return plan;
}
/** Session observations are counterfactual fill inputs, never broker confirmations. */
export function executeSessionPlan(account,plan,events,{slippageBps=5,limitFillPolicy='OBSERVED'}={}){
 assertSessionPlan(plan,account);check(Array.isArray(events)&&events.length>0&&finite(slippageBps)&&slippageBps>=0&&slippageBps<=1000&&['OBSERVED','LIMIT'].includes(limitFillPolicy),'세션 관측 및 가격 차이 설정 확인');
 const s=structuredClone(account);if(plan.strategy?.resetT){s.t=0;s.mode='NORMAL';}const remaining=new Map(plan.orders.map(o=>[o.id,o.quantity])),fills=[],seen=new Set();let last=plan.decisionAt,closing=null,sessionRank=-1;
 for(const e of events){
  check(typeof e.id==='string'&&!seen.has(e.id)&&iso(e.at)&&e.at>last&&e.at.slice(0,10)===plan.date&&['PRE','REGULAR','CLOSE','POST'].includes(e.session)&&finite(e.price)&&e.price>0&&Number.isSafeInteger(e.liquidity)&&e.liquidity>=0,'세션 관측 시각, 순서, 가격 및 유동성 확인');seen.add(e.id);last=e.at;
  const rank=['PRE','REGULAR','CLOSE','POST'].indexOf(e.session);check(rank>=sessionRank&&(rank!==3||closing!==null),'장전, 정규장, 종가 경매 및 장후 순서 확인');sessionRank=rank;
  check(closing===null||e.session==='POST','종가 경매 이후 장후 관측 확인');if(e.session==='CLOSE'){check(closing===null,'종가 경매 단일성 확인');closing=e.price;}
  let liquidity=e.liquidity;
  // Auction sells precede buys, while every quantity remains fixed at submission.
  const active=plan.orders.filter(o=>(o.type==='LIMIT'||e.session==='CLOSE')&&remaining.get(o.id)>0).toSorted((a,b)=>(a.side==='sell'?0:1)-(b.side==='sell'?0:1));
  for(const o of active){
   const slip=e.price*(1+(o.side==='buy'?1:-1)*slippageBps/10000),eligible=o.type==='MOC'||(o.side==='buy'?e.price<=o.limitPrice: e.price>=o.limitPrice);
   if(!eligible)continue;
   // LOC uses the auction print; adverse slippage beyond its limit blocks the fill.
   if(o.type!=='MOC'&&(o.side==='buy'?slip>o.limitPrice+1e-9:slip<o.limitPrice-1e-9))continue;
   const price=o.type==='LIMIT'&&limitFillPolicy==='LIMIT'?o.limitPrice:slip;
   const feeRate=plan.feeBps/10000,max=o.side==='sell'?s.quantity:Math.max(0,Math.floor((s.cash+1e-8)/(price*(1+feeRate)))),quantity=Math.min(remaining.get(o.id),liquidity,max);
   if(!quantity)continue;
   const gross=quantity*price,fee=gross*feeRate,allocated=o.side==='sell'?s.costBasis*quantity/s.quantity:0,realizedPnl=o.side==='sell'?gross-fee-allocated:0;
   if(o.side==='buy'){s.cash-=gross+fee;s.quantity+=quantity;s.costBasis+=gross+fee;}else{s.cash+=gross-fee;s.quantity-=quantity;s.costBasis-=allocated;s.realizedPnl+=realizedPnl;if(!s.quantity)s.costBasis=0;}
   s.feesPaid+=fee;liquidity-=quantity;remaining.set(o.id,remaining.get(o.id)-quantity);
   const referencePrice=o.type==='LIMIT'&&limitFillPolicy==='LIMIT'?o.limitPrice:e.price;
   fills.push({id:plan.planHash+':'+e.id+':'+o.id,orderId:o.id,leg:o.leg,at:e.at,session:e.session,side:o.side,quantity,fillPrice:price,referencePrice,slippageCost:Math.abs(price-referencePrice)*quantity,fee,realizedPnl,sourceEventId:e.id});
  }
 }
 check(closing!==null,'명시적 종가 경매 관측 확인');
 const legs=new Set(fills.map(f=>f.leg));s.mode=plan.mode;
 const fraction=leg=>{const orders=plan.orders.filter(o=>o.leg===leg),eligible=orders.filter(o=>o.type!=='LOC'||(o.side==='buy'?closing*(1+slippageBps/10000)<=o.limitPrice+1e-9:closing*(1-slippageBps/10000)>=o.limitPrice-1e-9)),planned=eligible.reduce((n,o)=>n+o.quantity,0),filled=fills.filter(f=>f.leg===leg).reduce((n,f)=>n+f.quantity,0);return planned?Math.min(1,filled/planned):0;};
 if(s.mode==='REVERSE'){
  if(legs.has('REVERSE_SELL'))s.t*=1-2/plan.config.splits*fraction('REVERSE_SELL');
  if(legs.has('REVERSE_BUY'))s.t+=(plan.config.splits-s.t)*.25*fraction('REVERSE_BUY');
  if(s.quantity&&closing>s.costBasis/s.quantity*(1-(plan.config.symbol==='TQQQ'?.15:.20)))s.mode='NORMAL';
 }else{
  if(legs.has('TARGET'))s.t*=1-.75*fraction('TARGET');else if(legs.has('QUARTER'))s.t*=1-.25*fraction('QUARTER');
  if(legs.has('ENTRY'))s.t+=fraction('ENTRY');if(legs.has('SECOND_STAR'))s.t+=fraction('SECOND_STAR');
  if(legs.has('FIRST_STAR'))s.t+=.5*fraction('FIRST_STAR');if(legs.has('FIRST_COST'))s.t+=.5*fraction('FIRST_COST');
 }
 if(!s.quantity){s.t=0;s.mode='NORMAL';if(account.quantity>0||fills.some(f=>f.side==='buy'))s.cycle++;}
 if(plan.strategy)s.sessionRegime=plan.strategy.regime;
 s.lastDate=plan.date;s.history=[...s.history,closing].slice(-5);s.lastPlanHash=plan.planHash;s.lastFills=[];assertSessionAccount(s);
 const mark=events.at(-1);return {account:s,fills,orders:plan.orders.map(o=>({...o,filledQuantity:o.quantity-remaining.get(o.id),status:remaining.get(o.id)===0?'FILLED':remaining.get(o.id)===o.quantity?'EXPIRED':'PARTIAL_EXPIRED'})),close:closing,marketPrice:mark.price,valuationAt:mark.at,equity:s.cash+s.quantity*mark.price,executionEvidence:{mode:'COUNTERFACTUAL_SESSION_REPLAY',actualBrokerFills:false,liveOrders:0,planHash:plan.planHash,eventHash:hashInputPackage(events),slippageBps,limitFillPolicy}};
}

export function prepareCappedSessionPlan(account,c,options){
 assertSessionAccount(account);assertSessionRuleConfig(c);check(Object.hasOwn(c,'maxExposure'),'분할매수 자금 비중 확인');
 const {maxExposure,...legacy}=c,price=account.history.at(-1),nav=account.cash+account.quantity*price,transition=account.sessionRegime!=='SPLIT',capQuantity=Math.floor(nav*maxExposure/price),shadow={...account,cash:Math.max(0,account.cash-nav*(1-maxExposure)),...(transition?{t:0,mode:'NORMAL'}:{})};
 const base=prepareSessionPlan(shadow,legacy,options),reduce=transition&&account.quantity>capQuantity,orders=reduce?[{id:'split-transition',type:'MOC',side:'sell',quantity:account.quantity-capQuantity,limitPrice:null,leg:'SPLIT_TRANSITION'}]:base.orders;
 const {planHash,...body}=base,patch={config:structuredClone(c),orders,...(reduce?{mode:'NORMAL',reverseStart:false,forced:false,budget:0}:{}),strategy:{regime:'SPLIT',resetT:transition,targetWeight:maxExposure,previousWeight:account.quantity*price/nav},assumptions:[...base.assumptions,'RESERVED_CASH_SPLIT_SLEEVE','TRANSITION_DELEVERAGE_NEXT_CLOSE','CAP_IS_PREVIOUS_PRICE_BUDGET_NOT_PRICE_GAP_GUARANTEE']};const value={...body,...patch,accountHash:hashInputPackage(account)};return {...value,planHash:hashInputPackage(value)};
}
