import {createPortfolio,defaultStrategy,defaultRisk,validatePortfolio,validateRisk,validateStrategy} from './engine/index.mjs';
import {createKnowledge,validateKnowledge} from './knowledge.mjs';
export const STORAGE_KEY='keynes-investment-lab-v1';
export const STORAGE_LIMIT_BYTES=4000000;
export const fingerprint=value=>{const s=JSON.stringify(value);let h=2166136261;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619);}return (h>>>0).toString(16).padStart(8,'0');};
export const newState=()=>({schemaVersion:1,portfolio:createPortfolio(),strategy:structuredClone(defaultStrategy),risk:structuredClone(defaultRisk),strategyVersion:1,knowledge:createKnowledge(),journal:[],configHistory:[],backtest:null,updatedAt:new Date().toISOString()});
export function loadState(){
  let raw;
  try{raw=localStorage.getItem(STORAGE_KEY);}catch{return {state:newState(),warning:'브라우저 저장소에 접근할 수 없어 이번 세션에서만 저장됩니다.'};}
  if(!raw)return {state:newState(),warning:null};
  try{
    if(new TextEncoder().encode(raw).byteLength>STORAGE_LIMIT_BYTES)throw new Error('저장 크기 제한');
    const s=JSON.parse(raw);
    if(validateWorkspace(s).length)throw new Error('잘못된 저장 형식');
    return {state:s,warning:null};
  }catch{return {state:newState(),warning:'저장본을 읽지 못했습니다. 기존 저장본은 덮어쓰지 않았습니다. 복구용 JSON을 내려받은 뒤 새 세션을 저장할 수 있습니다.',recovery:raw};}
}
export function saveState(state){
  let next=state;
  try{
    check(plain(state)&&Array.isArray(state.journal)&&Array.isArray(state.configHistory),'저장할 상태가 올바르지 않습니다.');
    next={...state,updatedAt:new Date().toISOString(),journal:state.journal.slice(-250),configHistory:state.configHistory.slice(-50)};
    const errors=validateWorkspace(next);check(!errors.length,errors[0]?.message);
    const raw=JSON.stringify(next);
    check(new TextEncoder().encode(raw).byteLength<=STORAGE_LIMIT_BYTES,'저장 크기 제한을 초과했습니다. JSON 백업을 보관해 주세요.');
    localStorage.setItem(STORAGE_KEY,raw);return {ok:true,state:next};
  }catch(error){return {ok:false,state:next,error:error.message};}
}

const SYMBOLS=['005930','000660','BTC-KRW','ETH-KRW'];
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&(Object.getPrototypeOf(v)===Object.prototype||Object.getPrototypeOf(v)===null);
const num=v=>typeof v==='number'&&Number.isFinite(v)&&Math.abs(v)<=Number.MAX_SAFE_INTEGER;
const positive=v=>num(v)&&v>0;
const nonnegative=v=>num(v)&&v>=0;
const integer=v=>Number.isSafeInteger(v)&&v>=0;
const version=v=>integer(v)&&v>0;
const str=(v,max=6000,empty=false)=>typeof v==='string'&&v.length<=max&&(empty||v.trim().length>0);
const iso=v=>{if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v))return false;try{return new Date(v).toISOString()===v;}catch{return false;}};
const day=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&iso(`${v}T00:00:00.000Z`);
const hash=v=>typeof v==='string'&&/^[0-9a-f]{8}$/.test(v);
const close=(a,b)=>num(a)&&num(b)&&Math.abs(a-b)<=Math.max(0.000001,Number.EPSILON*64*Math.max(Math.abs(a),Math.abs(b)));
const closeQuantity=(a,b)=>num(a)&&num(b)&&Math.abs(a-b)<=Math.max(0.000000000001,Number.EPSILON*64*Math.max(Math.abs(a),Math.abs(b)));
const keys=(v,required,optional=[])=>plain(v)&&required.every(k=>Object.hasOwn(v,k))&&Object.keys(v).every(k=>required.includes(k)||optional.includes(k));
const array=(v,max,checkItem)=>Array.isArray(v)&&v.length<=max&&v.every(checkItem);
const check=(condition,message)=>{if(!condition)throw new TypeError(message);};

// Extra engine output is displayed as escaped JSON; bound its shape without interpreting it.
function safeJson(value,depth=0,ancestors=new Set(),budget={count:0}){
  if(++budget.count>150000||depth>24)return false;
  if(value===null||typeof value==='boolean')return true;
  if(typeof value==='number')return num(value);
  if(typeof value==='string')return value.length<=100000;
  if(!Array.isArray(value)&&!plain(value))return false;
  if(ancestors.has(value))return false;
  ancestors.add(value);
  const entries=Array.isArray(value)?value.map((v,i)=>[String(i),v]):Object.entries(value);
  const valid=entries.length<=(Array.isArray(value)?10000:100)&&entries.every(([k,v])=>!['__proto__','prototype','constructor'].includes(k)&&safeJson(v,depth+1,ancestors,budget));
  ancestors.delete(value);return valid;
}

function validStrategy(value){return keys(value,['id','enabled','targetWeight','scope','parameters'])&&validateStrategy(value).length===0;}
const validRisk=value=>plain(value)&&validateRisk(value).length===0;
const reason=value=>plain(value)&&str(value.code,120)&&str(value.message,6000)&&safeJson(value);
const reasons=value=>array(value,1000,reason);

const EXECUTION_KEYS=['id','clientOrderId','at','decisionAt','mode','synthetic','symbol','side','quantity','strategyId','rationale','referencePrice','fillPrice','gross','fee','slippageCost','cashFlow','totalCost','netProceeds','realizedPnl','equityAfter'];
function validExecution(e){
  if(!keys(e,EXECUTION_KEYS)||!str(e.clientOrderId,160)||e.id!==`paper:${e.clientOrderId}`||!iso(e.at)||!iso(e.decisionAt)||e.decisionAt>e.at||e.mode!=='paper'||e.synthetic!==true||!SYMBOLS.includes(e.symbol)||!['buy','sell'].includes(e.side)||!str(e.strategyId,100)||!str(e.rationale,6000))return false;
  if(!['quantity','referencePrice','fillPrice','gross','totalCost'].every(k=>positive(e[k]))||!['fee','slippageCost','netProceeds','equityAfter'].every(k=>nonnegative(e[k]))||!num(e.cashFlow)||!num(e.realizedPnl))return false;
  return close(e.gross,e.fillPrice*e.quantity)&&close(e.totalCost,e.gross+e.fee)&&close(e.netProceeds,e.gross-e.fee)&&close(e.slippageCost,Math.abs(e.fillPrice-e.referencePrice)*e.quantity)&&close(e.cashFlow,e.side==='buy'?-e.totalCost:e.netProceeds);
}

const LEDGER_KEYS=['id','at','decisionAt','type','mode','symbol','side','quantity','referencePrice','fillPrice','fee','slippageCost','cashFlow','realizedPnl','cashAfter','marketAsOf','synthetic','strategyId','rationale','knowledgeRefs','review'];
function validLedger(row){
  return keys(row,LEDGER_KEYS)&&str(row.id,180)&&iso(row.at)&&iso(row.decisionAt)&&iso(row.marketAsOf)&&row.decisionAt<=row.at&&row.marketAsOf<=row.at&&row.type==='paper-fill'&&row.mode==='paper'&&row.synthetic===true&&SYMBOLS.includes(row.symbol)&&['buy','sell'].includes(row.side)&&['quantity','referencePrice','fillPrice'].every(k=>positive(row[k]))&&['fee','slippageCost','cashAfter'].every(k=>nonnegative(row[k]))&&num(row.cashFlow)&&num(row.realizedPnl)&&str(row.strategyId,100)&&str(row.rationale,6000)&&array(row.knowledgeRefs,200,v=>str(v,96))&&keys(row.review,['status','observation','lesson','proposedRule'])&&['unreviewed','proposed','approved','rejected'].includes(row.review.status)&&['observation','lesson','proposedRule'].every(k=>str(row.review[k],6000,true));
}

function assertPortfolio(p){
  check(keys(p,['id','mode','baseCurrency','cash','initialCash','initialEquity','positions','realizedPnl','feesPaid','slippagePaid','day','valuation','ledger','orders']),'계좌 필드가 올바르지 않습니다.');
  check(validatePortfolio(p).length===0&&str(p.id,120),'계좌 상태가 올바르지 않습니다.');
  check(['cash','initialCash','initialEquity','feesPaid','slippagePaid'].every(k=>nonnegative(p[k]))&&num(p.realizedPnl),'계좌 금액이 안전한 범위를 벗어났습니다.');
  check(keys(p.day,['date','openingEquity','realizedPnl'])&&day(p.day.date)&&nonnegative(p.day.openingEquity)&&num(p.day.realizedPnl),'계좌 일일 상태가 올바르지 않습니다.');
  check(keys(p.valuation,['at','equity'])&&iso(p.valuation.at)&&nonnegative(p.valuation.equity),'계좌 평가 상태가 올바르지 않습니다.');
  check(close(p.initialCash,p.initialEquity)&&p.day.date===new Date(Date.parse(p.valuation.at)+9*60*60*1000).toISOString().slice(0,10),'초기 자금 또는 계좌 거래일이 평가 기록과 일치하지 않습니다.');
  check(Object.values(p.positions).every(pos=>keys(pos,['symbol','quantity','averageCost','realizedPnl'])&&['quantity','averageCost'].every(k=>nonnegative(pos[k]))&&num(pos.realizedPnl)),'보유 자산 필드가 올바르지 않습니다.');
  check(array(p.orders,10000,o=>keys(o,['clientOrderId','fingerprint','execution'])&&str(o.clientOrderId,160)&&str(o.fingerprint,2000)&&validExecution(o.execution)&&o.execution.clientOrderId===o.clientOrderId),'주문 원장이 올바르지 않습니다.');
  check(array(p.ledger,10000,validLedger)&&p.ledger.length===p.orders.length,'체결 원장이 올바르지 않습니다.');
  check(new Set(p.orders.map(o=>o.clientOrderId)).size===p.orders.length&&new Set(p.ledger.map(o=>o.id)).size===p.ledger.length,'주문 또는 체결 ID가 중복됩니다.');
  let cash=p.initialCash,fees=0,slippage=0,realized=0,previous='';
  const positions=Object.fromEntries(SYMBOLS.map(symbol=>[symbol,{quantity:0,averageCost:0,realizedPnl:0}]));
  let dailyRealized=0;
  for(let i=0;i<p.orders.length;i++){
    const order=p.orders[i],e=order.execution,row=p.ledger[i];
    check(row.id===`journal:${e.clientOrderId}`&&row.at>=previous&&row.at<=p.valuation.at,'체결 원장의 순서 또는 ID가 올바르지 않습니다.');
    previous=row.at;
    check(['at','decisionAt','symbol','side','strategyId','rationale'].every(k=>row[k]===e[k])&&['quantity','referencePrice','fillPrice','fee','slippageCost','cashFlow','realizedPnl'].every(k=>close(row[k],e[k])),'주문과 체결 원장이 일치하지 않습니다.');
    let fp;try{fp=JSON.parse(order.fingerprint);}catch{check(false,'주문 지문이 올바르지 않습니다.');}
    check(keys(fp,['symbol','side','quantity','marketAsOf','decisionAt','strategyId'])&&fp.symbol===e.symbol&&fp.side===e.side&&fp.quantity===e.quantity&&fp.marketAsOf===row.marketAsOf&&fp.decisionAt===e.decisionAt&&fp.strategyId===e.strategyId,'주문 지문이 체결 내용과 일치하지 않습니다.');
    cash+=e.cashFlow;fees+=e.fee;slippage+=e.slippageCost;realized+=e.realizedPnl;
    const position=positions[e.symbol];
    if(e.side==='buy'){
      check(close(e.realizedPnl,0),'매수 체결에 실현손익이 기록됐습니다.');
      const quantity=position.quantity+e.quantity;
      position.averageCost=(position.quantity*position.averageCost+e.totalCost)/quantity;
      position.quantity=quantity;
    }else{
      check(e.quantity<=position.quantity+0.000000000001&&close(e.realizedPnl,e.netProceeds-position.averageCost*e.quantity),'매도 원가 또는 실현손익이 원장과 일치하지 않습니다.');
      position.quantity-=e.quantity;
      if(Math.abs(position.quantity)<0.000000000001)position.quantity=0;
      if(!position.quantity)position.averageCost=0;
      position.realizedPnl+=e.realizedPnl;
    }
    if(new Date(Date.parse(e.at)+9*60*60*1000).toISOString().slice(0,10)===p.day.date)dailyRealized+=e.realizedPnl;
    check(close(cash,row.cashAfter)&&cash>=-0.000001&&position.quantity>=-0.000000000001,'체결 후 현금 또는 보유 수량이 원장과 일치하지 않습니다.');
  }
  check(close(cash,p.cash)&&close(fees,p.feesPaid)&&close(slippage,p.slippagePaid)&&close(realized,p.realizedPnl),'계좌 합계가 체결 원장과 일치하지 않습니다.');
  check(SYMBOLS.every(symbol=>closeQuantity(positions[symbol].quantity,p.positions[symbol]?.quantity??0)&&close(positions[symbol].averageCost,p.positions[symbol]?.averageCost??0)&&close(positions[symbol].realizedPnl,p.positions[symbol]?.realizedPnl??0))&&close(dailyRealized,p.day.realizedPnl),'현재 보유 수량·취득 원가·실현손익이 체결 원장과 일치하지 않습니다.');
}

function assertBacktest(b){
  if(b===null)return;
  const base=['ok','mode','synthetic','reasons','curve','executions','configHash','strategyVersion','recordedAt'];
  const success=['notice','initialEquity','finalEquity','totalReturn','totalReturnPct','maxDrawdown','maxDrawdownPct','tradeCount','feesPaid','slippagePaid','blocked','portfolio','unfilledSignals','config','assumptions'];
  check(keys(b,base,b?.ok?success:[])&&typeof b.ok==='boolean'&&b.mode==='paper'&&b.synthetic===true&&hash(b.configHash)&&version(b.strategyVersion)&&iso(b.recordedAt)&&reasons(b.reasons),'실험 기본 정보가 올바르지 않습니다.');
  check(array(b.curve,5000,row=>keys(row,['at','equity','cash','drawdown','dailyPnl'])&&iso(row.at)&&nonnegative(row.equity)&&nonnegative(row.cash)&&num(row.dailyPnl)&&nonnegative(row.drawdown)&&row.drawdown<=1),'실험 곡선이 올바르지 않습니다.');
  check(b.curve.every((row,i)=>i===0||row.at>b.curve[i-1].at)&&array(b.executions,10000,validExecution),'실험 시간 순서 또는 체결이 올바르지 않습니다.');
  if(!b.ok){check(b.reasons.length>0,'실패한 실험에는 차단 이유가 필요합니다.');return;}
  check(success.every(key=>Object.hasOwn(b,key))&&str(b.notice,6000)&&positive(b.initialEquity)&&['finalEquity','feesPaid','slippagePaid'].every(k=>nonnegative(b[k]))&&['totalReturn','totalReturnPct','maxDrawdown','maxDrawdownPct'].every(k=>num(b[k]))&&b.totalReturn>=-1&&b.maxDrawdown>=0&&b.maxDrawdown<=1&&b.maxDrawdownPct>=0&&b.maxDrawdownPct<=100&&integer(b.tradeCount)&&integer(b.unfilledSignals),'실험 수치가 올바르지 않습니다.');
  check(b.curve.length>=2&&b.tradeCount===b.executions.length&&b.reasons.length===0&&array(b.blocked,10000,row=>plain(row)&&iso(row.at)&&reasons(row.reasons)&&safeJson(row))&&array(b.assumptions,100,row=>str(row,6000)),'실험 결과 목록이 올바르지 않습니다.');
  check(keys(b.config,['strategy','risk','startAt','endAt','bars'])&&validStrategy(b.config.strategy)&&validRisk(b.config.risk)&&iso(b.config.startAt)&&iso(b.config.endAt)&&integer(b.config.bars)&&b.config.bars===b.curve.length&&b.config.startAt===b.curve[0].at&&b.config.endAt===b.curve.at(-1).at,'실험 설정과 관측 구간이 일치하지 않습니다.');
  assertPortfolio(b.portfolio);
  check(close(b.initialEquity,b.portfolio.initialEquity)&&close(b.finalEquity,b.curve.at(-1).equity)&&close(b.finalEquity,b.portfolio.valuation.equity)&&close(b.totalReturn,b.finalEquity/b.initialEquity-1)&&close(b.totalReturnPct,b.totalReturn*100)&&close(b.maxDrawdown,Math.max(...b.curve.map(row=>row.drawdown)))&&close(b.maxDrawdownPct,b.maxDrawdown*100)&&close(b.feesPaid,b.portfolio.feesPaid)&&close(b.slippagePaid,b.portfolio.slippagePaid),'실험 요약 수치가 원본 결과와 일치하지 않습니다.');
  check(b.executions.length===b.portfolio.orders.length&&b.executions.every((e,i)=>JSON.stringify(e)===JSON.stringify(b.portfolio.orders[i].execution)),'실험 체결 목록과 계좌 원장이 일치하지 않습니다.');
}

export function validateWorkspace(s){
  try{
    check(safeJson(s),'지원하는 JSON 구조가 아닙니다.');
    check(keys(s,['schemaVersion','portfolio','strategy','risk','strategyVersion','knowledge','journal','configHistory','backtest','updatedAt'],['knowledgeBackups'])&&s.schemaVersion===1&&version(s.strategyVersion)&&iso(s.updatedAt),'워크스페이스 형식이 올바르지 않습니다.');
    check(validStrategy(s.strategy)&&validRisk(s.risk)&&validateKnowledge(s.knowledge).length===0,'전략·위험 설정 또는 지식이 올바르지 않습니다.');
    assertPortfolio(s.portfolio);
    check(array(s.journal,250,j=>plain(j)&&str(j.id,160)&&iso(j.at)&&str(j.type,60)&&str(j.title,1000)&&str(j.detail,12000,true)&&version(j.strategyVersion)&&hash(j.configHash)&&(!Object.hasOwn(j,'marketAsOf')||iso(j.marketAsOf))&&(!Object.hasOwn(j,'signals')||Array.isArray(j.signals))&&(!Object.hasOwn(j,'decisions')||Array.isArray(j.decisions))&&(!Object.hasOwn(j,'execution')||validExecution(j.execution))&&safeJson(j)),'판단 기록이 올바르지 않습니다.');
    check(new Set(s.journal.map(j=>j.id)).size===s.journal.length,'판단 기록 ID가 중복됩니다.');
    check(array(s.configHistory,50,h=>keys(h,['at','version','strategy','risk'])&&iso(h.at)&&version(h.version)&&h.version<s.strategyVersion&&validStrategy(h.strategy)&&validRisk(h.risk)),'설정 수정 이력이 올바르지 않습니다.');
    if(Object.hasOwn(s,'knowledgeBackups'))check(array(s.knowledgeBackups,3,b=>keys(b,['at','knowledge'])&&iso(b.at)&&validateKnowledge(b.knowledge).length===0),'지식 이전본이 올바르지 않습니다.');
    assertBacktest(s.backtest);
    return [];
  }catch(error){return [{code:'INVALID_WORKSPACE',message:error.message}];}
}
