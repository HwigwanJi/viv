import {createMindPaperAccount,transferMindPaperCash,validateMindPaperAccount} from './mind-paper.mjs';

const currencies=['KRW','USD','USDT','BTC'];
const round=n=>Math.round(n*1e8)/1e8;
const check=(ok,code,message)=>{if(!ok)throw Object.assign(new Error(message),{code,status:409});};
const positive=n=>typeof n==='number'&&Number.isFinite(n)&&n>0&&n<=1e12&&round(n)===n;
const SCALE=10n**18n,LOT=10n**10n;
function exact(value){const s=typeof value==='number'?value.toFixed(8):String(value);check(/^-?\d+(?:\.\d{1,18})?$/.test(s),'INVALID_EVENT_RETURN','회수 원장의 금액 단위를 확인하세요.');const negative=s.startsWith('-'),[a,b='']=(negative?s.slice(1):s).split('.');return (negative?-1n:1n)*(BigInt(a)*SCALE+BigInt(b.padEnd(18,'0')));}
function decimal(v){const sign=v<0n?'-':'';if(v<0n)v=-v;const f=(v%SCALE).toString().padStart(18,'0').replace(/0+$/,'');return sign+String(v/SCALE)+(f?'.'+f:'');}
const returns=(workspace,currency)=>(workspace.mindPositions??[]).filter(a=>a.kind==='EVENT_PAPER_ALLOCATION'&&a.quoteCurrency===currency&&a.releasedAt).reduce((n,a)=>n+exact(a.returnedCash)-exact(a.amount),0n);
const spendable=v=>Number(v>=0n?v/LOT:-((-v+LOT-1n)/LOT))/1e8;
export const paperBudgetFor=(workspace,currency)=>(workspace.mindPositions??[]).find(a=>a.kind==='PAPER_BUDGET'&&a.quoteCurrency===currency);
export function paperBudgetSummary(workspace,currency,{eventLedgers=[]}={}){
  const budget=paperBudgetFor(workspace,currency),accounts=(workspace.mindPositions??[]).filter(a=>a.kind==='PAPER_ACCOUNT'&&a.quoteCurrency===currency);
  const externalAllocations=(workspace.mindPositions??[]).filter(a=>a.kind==='EVENT_PAPER_ALLOCATION'&&a.quoteCurrency===currency&&!a.releasedAt);
  const allocated=round(accounts.reduce((n,a)=>n+a.initialCash+(a.fundingLedger??[]).reduce((s,f)=>s+f.amount,0),0)+externalAllocations.reduce((n,a)=>n+a.amount,0));
  const cash=round(accounts.reduce((n,a)=>n+a.cash,0)),holdingsValue=round(accounts.reduce((n,a)=>n+a.holdingsValue,0));
  const exactTotal=exact(budget?.totalBudget??allocated)+returns(workspace,currency)-exact(budget?.eventReturnOffset??'0'),exactAvailable=exactTotal-exact(allocated),totalBudget=Number(decimal(exactTotal)),available=spendable(exactAvailable);
  const ledgers=externalAllocations.map(a=>eventLedgers.filter(l=>l.allocationId===a.id&&l.quoteCurrency===currency&&l.status==='READY')),complete=ledgers.every(rows=>rows.length===1),sumExact=key=>{try{return complete?ledgers.reduce((n,rows)=>n+exact(rows[0][key]),0n):null;}catch{return null;}};
  const eventCash=sumExact('cash'),eventHoldings=sumExact('holdingsValue'),eventEquity=sumExact('equity'),exactCash=eventCash===null?null:exactAvailable+exact(cash)+eventCash,exactHoldings=eventHoldings===null?null:exact(holdingsValue)+eventHoldings,exactEquity=eventEquity===null?null:exactAvailable+exact(cash)+exact(holdingsValue)+eventEquity;
  return {quoteCurrency:currency,configured:!!budget,budgetId:budget?.id??null,totalBudget,allocated,available,exactTotalBudget:decimal(exactTotal),exactAvailable:decimal(exactAvailable),precisionRemainder:decimal(exactAvailable-exact(available)),exactCash:exactCash===null?null:decimal(exactCash),exactHoldingsValue:exactHoldings===null?null:decimal(exactHoldings),exactEquity:exactEquity===null?null:decimal(exactEquity),cash:exactCash===null?null:round(Number(decimal(exactCash))),holdingsValue:exactHoldings===null?null:round(Number(decimal(exactHoldings))),equity:exactEquity===null?null:round(Number(decimal(exactEquity))),netPnl:exactEquity===null?null:round(Number(decimal(exactEquity-exactTotal))),accounts,externalAllocations,valuationStatus:!complete?'EVENT_LEDGER_REQUIRED':eventEquity===null?'EVENT_MARK_REQUIRED':'READY'};
}
export function configurePaperBudget(workspace,{quoteCurrency,totalBudget},{now,id}){
  check(currencies.includes(quoteCurrency)&&positive(totalBudget),'INVALID_BUDGET','통화와 모의 총 예산을 확인하세요.');
  const summary=paperBudgetSummary(workspace,quoteCurrency);
  check(totalBudget>=summary.allocated,'BUDGET_ALREADY_ALLOCATED','마인드에 배정한 금액을 먼저 회수하세요.');
  let budget=paperBudgetFor(workspace,quoteCurrency);const previousBudget=budget?.totalBudget??summary.allocated;
  if(!budget){budget={id,kind:'PAPER_BUDGET',schemaVersion:1,quoteCurrency,totalBudget,createdAt:now,updatedAt:now,history:[]};workspace.mindPositions.push(budget);}
  budget.history.push({id:id+'-change',previousBudget,totalBudget,at:now});budget.totalBudget=totalBudget;budget.updatedAt=now;if((workspace.mindPositions??[]).some(a=>a.kind==='EVENT_PAPER_ALLOCATION'&&a.releasedAt&&a.quoteCurrency===quoteCurrency))budget.eventReturnOffset=decimal(returns(workspace,quoteCurrency));
  return paperBudgetSummary(workspace,quoteCurrency);
}
export function allocatePaperBudget(workspace,{mindId,quoteCurrency,amount,direction='allocate'},{now,id}){
  check(currencies.includes(quoteCurrency)&&positive(amount)&&['allocate','release'].includes(direction),'INVALID_ALLOCATION','통화·금액·배정 방식을 확인하세요.');
  const budget=paperBudgetFor(workspace,quoteCurrency);check(budget,'PAPER_BUDGET_REQUIRED','설정에서 통화별 모의 예산을 먼저 설정하세요.');
  check(!(workspace.mindPositions??[]).some(a=>a.kind==='EVENT_PAPER_ALLOCATION'&&a.profileId===mindId&&a.quoteCurrency===quoteCurrency&&!a.releasedAt),'EVENT_PAPER_ALLOCATION_MANAGED','분봉 모의 운용에 배정한 자금은 해당 운용 원장에서 관리합니다.');
  const summary=paperBudgetSummary(workspace,quoteCurrency);let account=summary.accounts.find(a=>a.profileId===mindId);
  check(direction!=='allocate'||amount<=summary.available,'BUDGET_INSUFFICIENT','공용 예산의 배정 가능 금액이 부족합니다.');
  check(direction!=='release'||account&&amount<=account.cash,'INSUFFICIENT_CASH','이 마인드에서 회수할 수 있는 현금을 확인하세요.');
  if(!account){account={...createMindPaperAccount({id,profileId:mindId,quoteCurrency,initialCash:amount,now}),kind:'PAPER_ACCOUNT',budgetId:budget.id};workspace.mindPositions.push(account);}
  else {const changed=transferMindPaperCash(account,{amount:direction==='allocate'?amount:-amount,transferId:id,now});Object.assign(account,changed,{budgetId:budget.id});}
  budget.history.push({id,accountId:account.id,mindId,amount,direction,at:now});budget.updatedAt=now;
  check(!validateMindPaperAccount(account).length,'PAPER_ACCOUNT_INTEGRITY','자금 배정 이후 원장을 대조하세요.');
  return {account,budget:paperBudgetSummary(workspace,quoteCurrency)};
}
export function reserveEventPaperBudget(workspace,{mindId,quoteCurrency,amount,subscriptionId},{now,id}){
  check(currencies.includes(quoteCurrency)&&positive(amount)&&typeof subscriptionId==='string'&&subscriptionId,'INVALID_ALLOCATION','통화·금액·운용 대상을 확인하세요.');
  const budget=paperBudgetFor(workspace,quoteCurrency),existing=(workspace.mindPositions??[]).find(a=>a.id===id);
  if(existing){check(existing.kind==='EVENT_PAPER_ALLOCATION'&&existing.profileId===mindId&&existing.subscriptionId===subscriptionId&&existing.quoteCurrency===quoteCurrency&&existing.amount===amount&&!existing.releasedAt,'ALLOCATION_CONFLICT','기존 배정 원본과 운용을 대조하세요.');return existing;}
  check(budget,'PAPER_BUDGET_REQUIRED','설정에서 통화별 모의 예산을 먼저 설정하세요.');
  check(!(workspace.mindPositions??[]).some(a=>a.profileId===mindId&&a.quoteCurrency===quoteCurrency&&(a.kind==='PAPER_ACCOUNT'||a.kind==='EVENT_PAPER_ALLOCATION'&&!a.releasedAt)),'PAPER_ACCOUNT_EXISTS','이 마인드의 기존 모의 계좌를 먼저 확인하세요.');
  check(!(workspace.mindSubscriptions??[]).some(s=>s.profileId===mindId&&s.status==='ENABLED'),'PAUSE_BEFORE_TRANSFER','기존 자동 운용을 일시중지한 뒤 자금을 배정하세요.');
  check(amount<=paperBudgetSummary(workspace,quoteCurrency).available,'BUDGET_INSUFFICIENT','공용 예산의 배정 가능 금액이 부족합니다.');
  const allocation={id,kind:'EVENT_PAPER_ALLOCATION',contractVersion:'event-paper-allocation-v1',profileId:mindId,subscriptionId,budgetId:budget.id,quoteCurrency,amount,createdAt:now,updatedAt:now,releasedAt:null};workspace.mindPositions.push(allocation);budget.history.push({id,accountId:id,mindId,amount,direction:'allocate',at:now,contractVersion:allocation.contractVersion,subscriptionId});budget.updatedAt=now;return allocation;
}
export function releaseEventPaperBudget(workspace,{allocationId,subscriptionId,cash},{now,id}){
 const allocation=(workspace.mindPositions??[]).find(a=>a.id===allocationId&&a.kind==='EVENT_PAPER_ALLOCATION'),returned=exact(cash);check(allocation&&allocation.subscriptionId===subscriptionId&&returned>=0n,'EVENT_PAPER_RETURN','원 배정과 회수할 현금을 대조하세요.');
 if(allocation.releasedAt){check(exact(allocation.returnedCash)===returned,'EVENT_PAPER_RETURN_CONFLICT','확정한 회수 원금을 보존하세요.');return allocation;}
 const budget=paperBudgetFor(workspace,allocation.quoteCurrency);check(budget?.id===allocation.budgetId,'EVENT_PAPER_RETURN','원 공용 예산을 확인하세요.');
 allocation.releasedAt=now;allocation.updatedAt=now;allocation.returnedCash=decimal(returned);allocation.realizedPnl=decimal(returned-exact(allocation.amount));allocation.returnReceiptId=id;
 budget.history.push({id,subscriptionId,accountId:allocationId,mindId:allocation.profileId,direction:'event-release',at:now,originalCapital:decimal(exact(allocation.amount)),returnedCash:allocation.returnedCash,realizedPnl:allocation.realizedPnl});budget.updatedAt=now;return allocation;
}
export function validatePaperBudgets(workspace){
  const budgets=(workspace.mindPositions??[]).filter(a=>a.kind==='PAPER_BUDGET');
  if(new Set(budgets.map(b=>b.quoteCurrency)).size!==budgets.length)return [{code:'DUPLICATE_PAPER_BUDGET',message:'통화별 모의 예산을 하나로 유지하세요.'}];
  const external=(workspace.mindPositions??[]).filter(a=>a.kind==='EVENT_PAPER_ALLOCATION');
  try{if(external.some(a=>a.contractVersion!=='event-paper-allocation-v1'||!currencies.includes(a.quoteCurrency)||!positive(a.amount)||!a.profileId||!a.subscriptionId||!budgets.some(b=>b.id===a.budgetId&&b.quoteCurrency===a.quoteCurrency)||a.releasedAt&&(exact(a.returnedCash)<0n||exact(a.realizedPnl)!==exact(a.returnedCash)-exact(a.amount)))||new Set(external.filter(a=>!a.releasedAt).map(a=>a.profileId+'|'+a.quoteCurrency)).size!==external.filter(a=>!a.releasedAt).length)return [{code:'INVALID_EVENT_PAPER_ALLOCATION',message:'분봉 모의 운용의 예산 배정 원본을 확인하세요.'}];}catch{return [{code:'INVALID_EVENT_PAPER_ALLOCATION',message:'모의 운용의 회수 원문 금액을 확인하세요.'}];}
  for(const b of budgets)if(!currencies.includes(b.quoteCurrency)||!positive(b.totalBudget)||!Array.isArray(b.history)||paperBudgetSummary(workspace,b.quoteCurrency).available<0)return [{code:'INVALID_PAPER_BUDGET',message:'모의 예산과 마인드 배정 합계를 대조하세요.'}];
  return [];
}
