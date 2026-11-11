import {hashInputPackage} from './workspace.mjs';
import {assertSessionPlan} from './session-rule.mjs';
import {inspectBrokerOrder} from './broker-capabilities.mjs';
const check=(ok,message)=>{if(!ok)throw Object.assign(new Error(message),{code:'SESSION_BROKER_ORDER',status:400});};
export function prepareBrokerSessionPlan(account,plan,config){
 assertSessionPlan(plan,account);check(config.brokerId==='toss'&&config.sessionOrderPolicy==='TOSS_LOC','토스 LOC 주문 계약을 선택하세요.');
 const band=config.limitBandBps??500;check(Number.isInteger(band)&&band>=1&&band<=5000,'종가 지정가 범위를 1~5000bp로 설정하세요.');
 const prior=account.history.at(-1);check(Number.isFinite(prior)&&prior>0,'판단 이전 확정 가격을 연결하세요.');
 const seen=new Set(),orders=[];let cash=account.cash;
 for(const original of plan.orders){
  if(original.side==='buy'&&original.type!=='MOC'){if(seen.has(original.leg))continue;seen.add(original.leg);}
  const order={...original};
  if(order.type==='MOC'){order.type='LOC';order.limitPrice=Math.max(.01,Math.round(prior*(1+(order.side==='buy'?1:-1)*band/10000)*100)/100);}
  const support=inspectBrokerOrder({brokerId:'toss',marketKind:'US_EQUITY',orderType:'LIMIT',timeInForce:order.type==='LOC'?'CLS':'DAY'});check(support.supported,support.message);
  if(order.side==='buy'){const cost=order.limitPrice*(1+plan.feeBps/10000);order.quantity=Math.min(order.quantity,Math.floor((cash+1e-8)/cost));cash-=order.quantity*cost;}
  if(order.quantity>0)orders.push(order);
 }
 const {planHash,...body}=plan,adapted={...body,orders,brokerExecution:{brokerId:'toss',policy:'TOSS_LOC',sourcePlanHash:planHash,limitBandBps:band,priorPrice:prior},assumptions:[...plan.assumptions,'TOSS_FIXED_QUANTITY_LOC_PRIOR_PRICE_BAND','PENDING_SELLS_NOT_CREDITED_TO_BUY_RESERVATION']};
 const result={...adapted,planHash:hashInputPackage(adapted)};assertSessionPlan(result,account);return result;
}
export function sessionBrokerRequests(plan){
 check(plan.brokerExecution?.brokerId==='toss','토스 주문 계획을 연결하세요.');
 return plan.orders.map(order=>{
  check(['LOC','LIMIT'].includes(order.type),'지원하는 세션 주문만 요청으로 변환하세요.');
  return {clientOrderId:'cji-'+hashInputPackage({planHash:plan.planHash,id:order.id}).slice(0,32),symbol:plan.config.symbol,side:order.side.toUpperCase(),orderType:'LIMIT',timeInForce:order.type==='LOC'?'CLS':'DAY',quantity:String(order.quantity),price:order.limitPrice.toFixed(2)};
 });
}
