import {hashInputPackage} from './workspace.mjs';
import {assertSessionAccount,prepareSessionPlan,SESSION_RULE_DEFAULTS} from './session-rule.mjs';
const check=(v,m)=>{if(!v)throw Object.assign(new Error(m),{code:'SESSION_REGIME_INPUT',status:400});};
export const SESSION_TREND_DEFAULTS=Object.freeze({symbol:'TQQQ',targetWeight:.65,rebalancingBand:.05});
export const SESSION_SIGNAL_DEFAULTS=Object.freeze({lookback:200,slopeDays:20,band:.01});
export const SESSION_STRUCTURE_DEFAULTS=Object.freeze({mode:'STRUCTURE',trailingDrawdown:.06,confirmationDays:2});
export function assertSessionSignalConfig(c){if(c?.mode==='STRUCTURE'){const keys=c.longTrendGuard===undefined?'confirmationDays,mode,trailingDrawdown':'confirmationDays,longTrendGuard,mode,trailingDrawdown';check(Object.keys(c).sort().join(',')===keys&&(c.longTrendGuard===undefined||typeof c.longTrendGuard==='boolean')&&Number.isFinite(c.trailingDrawdown)&&c.trailingDrawdown>=.02&&c.trailingDrawdown<=.2&&Number.isInteger(c.confirmationDays)&&c.confirmationDays>=1&&c.confirmationDays<=5,'가격 구조 판단의 낙폭과 연속 확인 일수 확인');return c;}check(c&&Object.keys(c).length===3&&Number.isInteger(c.lookback)&&c.lookback>=20&&c.lookback<=250&&Number.isInteger(c.slopeDays)&&c.slopeDays>=1&&c.slopeDays<=60&&Number.isFinite(c.band)&&c.band>=0&&c.band<=.1,'확정 종가 이동평균, 기울기 기간 및 이격 기준 확인');return c;}
export function assertSessionTrendConfig(c){check(c&&Object.keys(c).sort().join(',')===['symbol','targetWeight','rebalancingBand',...(c.regime===undefined?[]:['regime']),...(c.volatilityTarget===undefined?[]:['volatilityTarget'])].sort().join(',')&&(c.regime===undefined||c.regime==='REBOUND')&&(c.volatilityTarget===undefined||Number.isFinite(c.volatilityTarget)&&c.volatilityTarget>0&&c.volatilityTarget<=1)&&c.symbol==='TQQQ'&&Number.isFinite(c.targetWeight)&&c.targetWeight>=0&&c.targetWeight<=1&&Number.isFinite(c.rebalancingBand)&&c.rebalancingBand>0&&c.rebalancingBand<=.2,'TQQQ 목표 비중, 국면 및 변동성 목표 확인');return c;}
export function sessionTrendSignal(history,c,decisionAt){
 assertSessionSignalConfig(c);check(Array.isArray(history)&&history.length>=(c.mode==='STRUCTURE'?120:c.lookback+c.slopeDays)&&history.length<=310,'QQQ 확정 종가 준비 구간 확인');
 let previous='';for(const b of history){check(/^\d{4}-\d{2}-\d{2}$/.test(b.date)&&b.date>previous&&b.date<decisionAt.slice(0,10)&&Number.isFinite(b.close)&&b.close>0,'판단일 이전 QQQ 확정 종가 및 시간 순서 확인');previous=b.date;}
 if(c.mode==='STRUCTURE')return sessionStructureSignal(history,c);
 const n=history.length,mean=(end)=>history.slice(end-c.lookback,end).reduce((a,b)=>a+b.close,0)/c.lookback,average=mean(n),oldAverage=mean(n-c.slopeDays),close=history.at(-1).close;
 return {value:Math.min(close/average-1-c.band,average/oldAverage-1),close,average,oldAverage,lastDate:history.at(-1).date,sampleCount:history.length};
}
function sessionStructureSignal(history,c){
 const p=history.map(b=>b.close);let phase=0,entryStreak=0,exitStreak=0,details;
 // A fixed, hash-bound history window makes replay independent of worker restarts.
 for(let i=60;i<p.length;i++){
  const close=p[i],prior20=p.slice(i-20,i),high20=Math.max(...prior20),low20=Math.min(...prior20),support10=Math.min(...p.slice(i-10,i)),peak60=Math.max(...p.slice(i-59,i+1));
  const return5=close/p[i-5]-1,return20=close/p[i-20]-1,return60=close/p[i-60]-1,path=Array.from({length:20},(_,j)=>Math.abs(p[i-j]-p[i-j-1])).reduce((a,b)=>a+b,0),efficiency=path?Math.abs(close-p[i-20])/path:0,recovery=close/low20-1,drawdown=1-close/peak60;
  const trendCandidate=return20>0&&(!c.longTrendGuard||return60>0)&&close>=high20*.995&&efficiency>=.15,exitCandidate=drawdown>=c.trailingDrawdown||(close<support10&&return5<0)||Boolean(c.longTrendGuard&&return60<=0),reboundCandidate=return5>0&&recovery>=.02;
  entryStreak=trendCandidate?entryStreak+1:0;exitStreak=exitCandidate?exitStreak+1:0;
  if(phase===2&&exitStreak<c.confirmationDays)phase=2;
  else if(entryStreak>=c.confirmationDays&&!exitCandidate)phase=2;
  else phase=reboundCandidate?1:0;
  details={value:phase,phase:['SPLIT','REBOUND','TREND'][phase],close,high20,low20,support10,peak60,return5,return20,...(c.longTrendGuard!==undefined?{return60}:{}),efficiency,recovery,drawdown,trendCandidate,exitCandidate,reboundCandidate,entryStreak,exitStreak};
 }
 return {...details,lastDate:history.at(-1).date,sampleCount:history.length,method:'CAUSAL_PRICE_STRUCTURE_V1',initialState:'SPLIT',warmupSessions:60};
}
const seal=body=>({...body,planHash:hashInputPackage(body)});
function revisedPlan(base,account,patch){const {planHash,...body}=base;return seal({...body,...patch,accountHash:hashInputPackage(account)});}
export function prepareSessionTrendPlan(account,c,options){
 assertSessionAccount(account);assertSessionTrendConfig(c);check(account.symbol===c.symbol,'추세 주문 종목과 계좌 대조');
 const base=prepareSessionPlan(account,{...SESSION_RULE_DEFAULTS,symbol:c.symbol},options),price=account.history.at(-1),nav=account.cash+account.quantity*price,currentWeight=account.quantity*price/nav;
 let targetWeight=c.targetWeight,volatility;
 if(c.volatilityTarget!==undefined){sessionTrendSignal(options.signalHistory,SESSION_STRUCTURE_DEFAULTS,options.decisionAt);const prices=options.signalHistory.slice(-21).map(b=>b.close),returns=prices.slice(1).map((p,i)=>p/prices[i]-1),mean=returns.reduce((a,b)=>a+b,0)/returns.length;volatility=Math.sqrt(returns.reduce((a,b)=>a+(b-mean)**2,0)/(returns.length-1))*Math.sqrt(252)*3;check(Number.isFinite(volatility)&&volatility>=0,'직전 수익률의 유한한 변동성 확인');targetWeight=volatility>0?Math.min(c.targetWeight,c.volatilityTarget/volatility):c.targetWeight;}
 const regime=c.regime??'TREND',target=Math.floor(nav*targetWeight/(price*(1+base.feeBps/10000))),delta=target-account.quantity,rebalance=account.sessionRegime!==regime||Math.abs(currentWeight-targetWeight)>=c.rebalancingBand;
 const orders=rebalance&&delta?[{id:'trend-target',type:'MOC',side:delta>0?'buy':'sell',quantity:Math.abs(delta),limitPrice:null,leg:'TREND_TARGET'}]:[];
 return revisedPlan(base,account,{mode:'NORMAL',reverseStart:false,forced:false,star:null,budget:Math.max(0,delta)*price,orders,...(volatility!==undefined?{sizingEvidence:{method:'PRIOR_QQQ_VOL20_X3',volatility,volatilityTarget:c.volatilityTarget,cap:c.targetWeight,lastDate:options.signalHistory.at(-1).date}}:{}),strategy:{regime,resetT:true,targetWeight,previousWeight:currentWeight},assumptions:[...base.assumptions,'PRIOR_CLOSE_TARGET_FIXED_QUANTITY_NEXT_CLOSE','NO_CURRENT_SESSION_SIGNAL','TREND_WEIGHT_DRIFTS_WITH_PRICE']});
}
export function sessionSignalHistory(dataset,date,{lag=0}={}){
 check(dataset?.symbol==='QQQ'&&Number.isInteger(lag)&&lag>=0&&lag<=1,'QQQ 자료 및 추가 지연 확인');
 const end=dataset.bars.findIndex(b=>b.date>=date),index=(end<0?dataset.bars.length:end)-lag;
 const rows=dataset.bars.slice(Math.max(0,index-310),index),factor=rows.at(-1)?.futureSplitFactor;
 return rows.map(b=>({date:b.date,close:b.close/b.futureSplitFactor*factor}));
}

export {prepareCappedSessionPlan} from './session-rule.mjs';
