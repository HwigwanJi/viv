import {createPaperConnector, transferPaperConnectorCash, dispatchPaperOrder, validatePaperConnector, ConnectorError} from './connectors.mjs';
import {hashInputPackage} from './workspace.mjs';
import {instrumentPriceUnit,hasUpbitKrwPricePolicy} from './upbit-price-unit.mjs';

export const EVENT_PAPER_VERSION='event-paper-execution-v1';
const Q=10n**18n, BPS=10000n*Q, MAX_BOOK_AGE_MS=3000;
const clone=v=>structuredClone(v), check=(v,code,message)=>{if(!v)throw new ConnectorError(code,message);};
const canonical=v=>hashInputPackage(v);
const stamp=v=>{check(typeof v==='string'&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString()===v,'EVENT_TIME','ISO UTC 시각을 확인하세요.');return v;};
const ident=v=>typeof v==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:@-]{0,159}$/.test(v);
// These integers plan quantities and derive reports; connectors owns every reservation,
// cash mutation, fill fee and reconciliation. No independent cash execution path exists.
function d(v){
 check(typeof v==='string'||typeof v==='number'&&Number.isFinite(v)&&v>=0,'EVENT_DECIMAL','0 이상의 소수 값을 확인하세요.');
 let s=String(v);if(/[eE]/.test(s)){const m=/^(\d+)(?:\.(\d*))?[eE]([+-]?\d+)$/.exec(s);check(m,'EVENT_DECIMAL','소수 값을 확인하세요.');const digits=m[1]+(m[2]??''),p=m[1].length+Number(m[3]);s=p<=0?'0.'+'0'.repeat(-p)+digits:p>=digits.length?digits+'0'.repeat(p-digits.length):digits.slice(0,p)+'.'+digits.slice(p);}
 check(/^\d{1,18}(?:\.\d{1,18})?$/.test(s),'EVENT_DECIMAL','소수 18자리 이내의 값을 확인하세요.');const [a,b='']=s.split('.');return BigInt(a)*Q+BigInt(b.padEnd(18,'0'));
}
const a=n=>{if(n<0n)return '-'+a(-n);const f=(n%Q).toString().padStart(18,'0').replace(/0+$/,'');return String(n/Q)+(f?'.'+f:'');};
const mul=(x,y)=>x*y/Q, ceil=(x,y)=>(x+y-1n)/y, floorLot=(x,lot)=>x/lot*lot;
const min=(x,y)=>x<y?x:y, max=(x,y)=>x>y?x:y;
const ratio=(v,name,zero=true)=>{const n=d(typeof v==='number'?v.toFixed(18):v);check(n<=Q&&(zero||n>0n),'EVENT_RISK',name+' 한도를 확인하세요.');return n;};
function checked(account){
 check(account?.contractVersion===EVENT_PAPER_VERSION&&account.mode==='paper'&&ident(account.id)&&typeof account.profileId==='string'&&typeof account.instrumentId==='string'&&Array.isArray(account.liquidity)&&Array.isArray(account.receipts)&&Array.isArray(account.marks)&&Array.isArray(account.dailyEquity),'EVENT_ACCOUNT','이벤트 모의계좌를 확인하세요.');
 const errors=validatePaperConnector(account.connector);check(!errors.length,errors[0]?.code,errors[0]?.message);
 check(account.connector.id===account.id&&account.quoteCurrency===account.connector.instrument.quoteAsset&&a(d(account.initialCash))===account.connector.initialBalances.quote&&account.connector.initialBalances.base==='0','EVENT_ACCOUNT','원 모의계좌와 통화·초기 자금을 대조하세요.');
 stamp(account.createdAt);stamp(account.updatedAt);return account;
}
function quote(account,book,now,{readyAt=null,maxAgeMs=MAX_BOOK_AGE_MS}={}){
 const i=account.connector.instrument, at=Date.parse(stamp(now));check(Number.isSafeInteger(maxAgeMs)&&maxAgeMs>=1000&&maxAgeMs<=60000,'EVENT_QUOTE_AGE','호가 유효시간을 확인하세요.');
 check(book?.kind==='ORDER_BOOK'&&book.market===i.symbol&&typeof book.id==='string'&&book.id.length>0&&/^[a-f0-9]{64}$/.test(book.sourceHash??'')&&Array.isArray(book.levels)&&book.levels.length>0&&book.levels.length<=200,'EVENT_BOOK','종목·원문 해시·관측 호가를 확인하세요.');
 const event=Date.parse(stamp(book.eventTime)),received=Date.parse(stamp(book.receivedAt));
 check(at>=event&&at>=received,'FUTURE_BOOK','판단 시각 이후의 호가는 사용할 수 없습니다.');
 check(at-event<=maxAgeMs&&at-received<=maxAgeMs,'STALE_BOOK','3초 이내의 호가를 확인하세요.');
 if(readyAt!==null)check(event>=Date.parse(readyAt)&&received>=Date.parse(readyAt),'PRE_DECISION_BOOK','판단과 공급자 응답이 준비된 뒤의 호가를 확인하세요.');
 // Observed Upbit books can include lower price bands and still-open orders from an older policy.
 let bid=null,ask=null;const levels=book.levels.map((l,index)=>{const bp=d(l.bidPrice),ap=d(l.askPrice),bq=d(l.bidQuantity),aq=d(l.askQuantity);check(bp>0n&&ap>bp&&(index===0||bp<bid&&ap>ask),'EVENT_BOOK','호가 순서와 매수·매도 가격을 확인하세요.');check(hasUpbitKrwPricePolicy(i)||bp%d(i.tickSize)===0n&&ap%d(i.tickSize)===0n,'EVENT_BOOK_INCREMENT','호가의 가격 단위를 확인하세요.');bid=bp;ask=ap;return {bidPrice:a(bp),askPrice:a(ap),bidQuantity:a(bq),askQuantity:a(aq)};});
 const payload={market:book.market,eventTime:book.eventTime,receivedAt:book.receivedAt,levels},bindingHash=canonical(payload),prior=account.liquidity.find(l=>l.sourceHash===book.sourceHash);
 check(!prior||prior.bindingHash===bindingHash,'BOOK_HASH_CONFLICT','같은 원문 해시의 호가 내용과 시각을 대조하세요.');
 return {book:{...clone(book),levels},bindingHash,connectorQuote:{kind:'ORDERBOOK',venueId:i.venueId,instrumentId:i.id,symbol:i.symbol,baseAsset:i.baseAsset,quoteAsset:i.quoteAsset,snapshotAt:book.eventTime,priceAt:book.eventTime,receivedAt:book.receivedAt,dataOrigin:book.dataOrigin==='FIXTURE'?'FIXTURE':'PUBLIC_API',sourceUrl:book.sourceUrl??(i.venueId==='upbit'?'https://api.upbit.com/v1/orderbook':'https://openapi.okx.com/api/v5/market/books'),bidPrice:levels[0].bidPrice,askPrice:levels[0].askPrice,bids:levels.map(l=>({price:l.bidPrice,quantity:l.bidQuantity})),asks:levels.map(l=>({price:l.askPrice,quantity:l.askQuantity}))}};
}
function totals(account){
 let quantity=0n,basis=0n,realized=0n,fees=0n;const ledger=[],intents=new Map(account.receipts.map(r=>[r.orderId,r.executionEvidence?.decisionIntent]));
 for(const f of account.connector.fills){const q=d(f.quantity),n=d(f.notional),fee=d(f.fee);let pnl=0n;fees+=fee;
  if(f.side==='buy'){quantity+=q;basis+=n+fee;}else{check(q<=quantity,'EVENT_COST_BASIS','매도 수량과 실제 보유 원장을 대조하세요.');const removed=q===quantity?basis:basis*q/quantity;pnl=n-fee-removed;quantity-=q;basis-=removed;realized+=pnl;}
  ledger.push({runId:f.fillId,orderId:f.orderId,at:f.occurredAt,side:f.side,quantity:Number(f.quantity),fillPrice:Number(f.price),fee:Number(f.fee),realizedPnl:Number(a(pnl)),exactRealizedPnl:a(pnl),exactFee:f.fee,instrumentId:account.instrumentId,...(intents.get(f.orderId)?{intent:clone(intents.get(f.orderId))}:{})});
 }
 check(quantity===d(account.connector.balances.base.available)+d(account.connector.balances.base.reserved),'EVENT_QUANTITY','체결 원장과 원 모의계좌의 수량을 대조하세요.');
 return {quantity,basis,realized,fees,ledger,cash:d(account.connector.balances.quote.available)+d(account.connector.balances.quote.reserved)};
}
function valued(account,bid){const t=totals(account),marketValue=mul(t.quantity,bid),equity=t.cash+marketValue;return {...t,bid,marketValue,equity};}
function appendMark(account,book,now,bindingHash){
 const v=valued(account,d(book.levels[0].bidPrice)),row={at:now,bookId:book.id,sourceHash:book.sourceHash,bookEventTime:book.eventTime,receivedAt:book.receivedAt,bindingHash,bidPrice:a(v.bid),cash:a(v.cash),quantity:a(v.quantity),marketValue:a(v.marketValue),equity:a(v.equity),markPolicy:'OBSERVED_BEST_BID_PLUS_QUOTE_CASH'};
 const day=now.slice(0,10);if(!account.dailyEquity.some(x=>x.day===day))account.dailyEquity.push({day,at:now,equity:a(v.equity)});
 const last=account.marks.at(-1);if(last?.at===now)account.marks[account.marks.length-1]=row;else account.marks.push(row);account.updatedAt=now;return v;
}
export function createEventPaperAccount({id,profileId,instrumentId,instrument,initialCash,feeSchedule,now}={}){
 stamp(now);check(ident(id)&&typeof profileId==='string'&&profileId.length>0&&typeof instrumentId==='string'&&instrumentId.length>0&&d(initialCash)>=0n,'EVENT_ACCOUNT','모의계좌·마인드·초기 자금을 확인하세요.');
 const connector=createPaperConnector({id,instrument,balances:{quote:a(d(initialCash)),base:'0'},feeSchedule,now});
 return {schemaVersion:1,contractVersion:EVENT_PAPER_VERSION,mode:'paper',id,profileId,instrumentId,quoteCurrency:instrument.quoteAsset,initialCash:a(d(initialCash)),connector,createdAt:now,updatedAt:now,liquidity:[],receipts:[],marks:[],dailyEquity:[]};
}
export function markEventPaperAccount(account,{book,asOf}={}){
 checked(account);stamp(asOf);check(Date.parse(asOf)>=Date.parse(account.updatedAt),'EVENT_TIME_ORDER','계좌 기록 이후의 시각을 확인하세요.');const q=quote(account,book,asOf),next=clone(account);appendMark(next,q.book,asOf,q.bindingHash);return next;
}
export function eventPaperPositionAccount(account,{book,asOf=account.updatedAt}={}){
 checked(account);stamp(asOf);check(Date.parse(asOf)>=Date.parse(account.updatedAt),'EVENT_TIME_ORDER','계좌 기록 이후의 시각을 확인하세요.');const last=book?quote(account,book,asOf).book:account.marks.at(-1),bid=book?d(last.levels[0].bidPrice):last?d(last.bidPrice):0n,t=valued(account,bid);
 check(t.quantity===0n||bid>0n&&Date.parse(asOf)-Date.parse(book?last.eventTime:last.bookEventTime)<=MAX_BOOK_AGE_MS&&Date.parse(asOf)-Date.parse(last.receivedAt)<=MAX_BOOK_AGE_MS,'STALE_POSITION_MARK','보유 자산에는 3초 이내의 관측 매수 호가가 필요합니다.');
 const cash=Number(a(t.cash)),equity=Number(a(t.equity)),initialCash=Number(account.initialCash),costBasis=Number(a(t.basis)),quantity=Number(a(t.quantity)),fundingLedger=(account.connector.fundingLedger??[]).map(f=>({...f,amount:(f.direction==='deposit'?1:-1)*Number(f.amount)})),capital=initialCash+fundingLedger.reduce((s,f)=>s+f.amount,0);
 return {id:account.id,profileId:account.profileId,quoteCurrency:account.quoteCurrency,cash,equity,initialCash,netPnl:equity-capital,netReturn:fundingLedger.length?(equity-capital)/(initialCash+fundingLedger.reduce((s,f)=>s+Math.max(0,f.amount),0)):(initialCash>0?equity/initialCash-1:null),fundingLedger,positions:t.quantity>0n?[{instrumentId:account.instrumentId,quoteCurrency:account.quoteCurrency,quantity,costBasis,averageCost:costBasis/quantity,marketPrice:Number(a(bid)),marketValue:Number(a(t.marketValue)),unrealizedPnl:Number(a(t.marketValue-t.basis)),priceAsOf:book?last.eventTime:last.bookEventTime}]:[],ledger:t.ledger,createdAt:account.createdAt,updatedAt:account.updatedAt,asOf};
}
function decision(evaluation){
 const output=evaluation?.output??evaluation,dn=output?.decision;
 check(output?.ready===true&&output.status==='READY'&&output.execution!=='LIVE'&&dn&&['buy','sell','hold'].includes(dn.action)&&Number.isFinite(dn.targetWeight)&&dn.targetWeight>=0&&dn.targetWeight<=1,'EVENT_DECISION','확정된 canonical 노드 판단과 목표 비중을 확인하세요.');
 const at=stamp(evaluation.decisionAt??evaluation.asOf??dn.asOf),times=[at,...[evaluation.providerReadyAt,evaluation.decisionCompletedAt].filter(x=>x!==undefined&&x!==null).map(stamp)];
 return {output,dn,decisionAt:at,readyAt:times.reduce((x,y)=>Date.parse(x)>Date.parse(y)?x:y),decisionHash:canonical(evaluation)};
}
export function applyEventTargetOrder(account,{evaluation,orderId,book,now,orderType='LIMIT_FOK',maxSlippageBps=20,participationRate=.1,maxDailyLossRatio=.02,perOrderLimit=null}={}){
 checked(account);stamp(now);check(ident(orderId),'EVENT_ORDER_ID','모의 주문 ID를 확인하세요.');check(['LIMIT_FOK','LIMIT_IOC'].includes(orderType),'EVENT_ORDER_TYPE','FOK 또는 IOC 지정가 주문을 선택하세요.');
 const rate=ratio(participationRate,'호가 참여',false),daily=ratio(maxDailyLossRatio,'일일 손실',false),slip=d(maxSlippageBps);check(slip<=d('1000'),'EVENT_RISK','슬리피지 한도를 확인하세요.');
 const orderCap=perOrderLimit===null?null:d(perOrderLimit);check(orderCap===null||orderCap>0n,'EVENT_ORDER_CAP','1회 주문 한도를 확인하세요.');
 const requestHash=canonical({evaluation,orderId,book,now,orderType,maxSlippageBps,participationRate,maxDailyLossRatio,...(orderCap===null?{}:{perOrderLimit:a(orderCap)})}),prior=account.receipts.find(r=>r.orderId===orderId);
 if(prior){check(prior.requestHash===requestHash,'EVENT_ORDER_CONFLICT','같은 주문 ID의 입력을 대조하세요.');return {account:clone(account),order:clone(prior.order),fills:clone(prior.fills),blockedReasons:clone(prior.blockedReasons),executionEvidence:{...clone(prior.executionEvidence),idempotent:true}};}
 check(Date.parse(now)>=Date.parse(account.updatedAt),'EVENT_TIME_ORDER','원장 기록 이후의 시각을 확인하세요.');
 let dec,q;try{dec=decision(evaluation);check(Date.parse(now)>=Date.parse(dec.readyAt),'DECISION_NOT_READY','판단과 공급자 응답이 준비된 뒤에 주문하세요.');q=quote(account,book,now,{readyAt:dec.readyAt,maxAgeMs:dec.output.orderPolicy?.maxQuoteAgeMs??MAX_BOOK_AGE_MS});}catch(e){if(!(e instanceof ConnectorError))throw e;return {account:clone(account),order:null,fills:[],blockedReasons:[e.code],executionEvidence:{contractVersion:EVENT_PAPER_VERSION,mode:'paper',orderId,at:now,providerCalls:0,liveOrders:0,reason:e.code}};}
 const next=clone(account),v=appendMark(next,q.book,now,q.bindingHash),{dn,output}=dec;
 const evidence={contractVersion:EVENT_PAPER_VERSION,mode:'paper',orderId,at:now,decisionAt:dec.decisionAt,readyAt:dec.readyAt,decisionHash:dec.decisionHash,...(dn.intent?{decisionIntent:clone(dn.intent)}:{}),bookId:book.id,bookSourceHash:book.sourceHash,bookBindingHash:q.bindingHash,eventTime:book.eventTime,receivedAt:book.receivedAt,orderType,maxSlippageBps:Number(maxSlippageBps),participationRate:Number(participationRate),maxDailyLossRatio:Number(maxDailyLossRatio),...(orderCap===null?{}:{perOrderLimit:a(orderCap)}),targetRiskRatioTolerance:1e-12,feeSchedule:clone(next.connector.feeSchedule),fillModel:'OBSERVED_MARKETABLE_DEPTH_ONLY',passiveQueueFills:false,liquidityPolicy:'CUMULATIVE_PARTICIPATION_CAP_PER_SOURCE_HASH_AND_LEVEL',sizingPolicy:'TARGET_DELTA_FEE_INCLUSIVE_LIMIT_BUDGET_LOT_FLOOR',providerCalls:0,liveOrders:0,idempotent:false};
 function finish(order,fills,reasons=[]){const result={order:clone(order),fills:clone(fills),blockedReasons:reasons,executionEvidence:{...evidence,referenceQuote:{bidPrice:q.book.levels[0].bidPrice,askPrice:q.book.levels[0].askPrice},filledQuantity:a(fills.reduce((n,f)=>n+d(f.quantity),0n)),filledNotional:a(fills.reduce((n,f)=>n+d(f.notional),0n)),fees:a(fills.reduce((n,f)=>n+d(f.fee),0n)),confirmedRemainingCancelled:order?.status==='CANCELLED',connectorRevision:next.connector.revision}};next.receipts.push({orderId,requestHash,...clone(result)});return {account:next,...result};}
 if(dn.action==='hold')return finish(null,[],['HOLD_DECISION']);
 if(output.riskAllowed!==true||output.orderAllowed!==true)return finish(null,[],['GRAPH_ORDER_NOT_ALLOWED']);
 if(output.orderPolicy&&(output.orderPolicy.orderType!==orderType||slip>d(output.orderPolicy.maxSlippageBps)))return finish(null,[],['GRAPH_ORDER_POLICY_MISMATCH']);
 const target=ratio(dn.targetWeight,'목표 비중'),current=v.marketValue,desired=mul(v.equity,target),isBuy=dn.action==='buy';
 if(isBuy?desired<=current:desired>=current)return finish(null,[],['TARGET_ALREADY_REACHED']);
 const risk=dn.risk??output.risk??{};
 if(risk.maxExposure!==undefined&&isBuy&&target>ratio(risk.maxExposure,'노출'))return finish(null,[],['GRAPH_EXPOSURE_LIMIT']);
 // The canonical evaluator computes ratios as IEEE numbers. This only absorbs its
 // floating-point boundary, and never rounds an order up or relaxes minimums.
 if(risk.maxOrderWeight!==undefined&&max(desired,current)-min(desired,current)>mul(v.equity,ratio(risk.maxOrderWeight,'주문 비중'))+ceil(v.equity,10n**12n))return finish(null,[],['GRAPH_ORDER_WEIGHT_LIMIT']);
 const start=d(next.dailyEquity.find(x=>x.day===now.slice(0,10)).equity),loss=start>v.equity?start-v.equity:0n;
 if(isBuy&&start>0n&&loss*Q>=start*daily)return finish(null,[],['DAILY_LOSS_LIMIT']);
 const i=next.connector.instrument,lot=d(i.lotSize),best=d(q.book.levels[0][isBuy?'askPrice':'bidPrice']);
 const rawLimit=isBuy?best*(BPS+slip)/BPS:ceil(best*(BPS-slip),BPS),tick=d(instrumentPriceUnit(i,rawLimit)),limit=isBuy?floorLot(rawLimit,tick):ceil(rawLimit,tick)*tick;
 if(limit<=0n)return finish(null,[],['SLIPPAGE_LIMIT']);
 const feeBps=d(next.connector.feeSchedule.sideBps?.[dn.action]??next.connector.feeSchedule.bps),budget=isBuy?min(min(desired-current,max(0n,v.cash-BigInt(q.book.levels.length+1))),orderCap===null?v.cash:orderCap):current-desired;
 let quantity=isBuy?floorLot(budget*Q*BPS/(limit*(BPS+feeBps)),lot):target===0n?v.quantity:floorLot(budget*Q/best,lot);
 if(!isBuy&&dn.positionFraction){check(dn.positionFraction.instrumentId===account.instrumentId,'EVENT_TARGET_FRACTION_SCOPE','매도 비율과 자기 종목을 대조하세요.');quantity=floorLot(mul(v.quantity,ratio(dn.positionFraction.fraction,'현재 수량 매도 비율')),lot);if(risk.maxOrderWeight!==undefined)quantity=min(quantity,floorLot(mul(v.equity,ratio(risk.maxOrderWeight,'주문 비중'))*Q/best,lot));}
 if(!isBuy&&dn.positionTarget){check(dn.positionTarget.instrumentId===account.instrumentId,'EVENT_TARGET_QUANTITY_SCOPE','매도 수량과 자기 종목을 대조하세요.');quantity=floorLot(max(0n,v.quantity-d(dn.positionTarget.quantity)),lot);if(risk.maxOrderWeight!==undefined)quantity=min(quantity,floorLot(mul(v.equity,ratio(risk.maxOrderWeight,'주문 비중'))*Q/best,lot));}
 if(!isBuy)quantity=min(floorLot(v.quantity,lot),quantity);
 if(quantity<=0n||quantity<d(i.minQuantity)||mul(quantity,limit)<d(i.minNotional))return finish(null,[],['MINIMUM_ORDER']);
 const consumption=next.liquidity.find(l=>l.sourceHash===book.sourceHash)??{sourceHash:book.sourceHash,bookId:book.id,bindingHash:q.bindingHash,used:q.book.levels.map(()=>({buy:'0',sell:'0'}))};
 let remaining=quantity;const planned=[];
 for(let index=0;index<q.book.levels.length&&remaining>0n;index++){const level=q.book.levels[index],price=d(level[isBuy?'askPrice':'bidPrice']);if(isBuy?price>limit:price<limit)break;const cap=floorLot(mul(d(level[isBuy?'askQuantity':'bidQuantity']),rate),lot),used=d(consumption.used[index][dn.action]),available=floorLot(max(0n,cap-used),lot),take=min(remaining,available);if(take>0n){planned.push({index,quantity:a(take),price:a(price)});remaining-=take;}}
 if(orderType==='LIMIT_FOK'&&remaining>0n)return finish(null,[],['FOK_INSUFFICIENT_OBSERVED_DEPTH']);
 const intent={id:orderId,mode:'paper',venueId:i.venueId,instrumentId:i.id,accountId:next.id,decisionId:'decision-'+dec.decisionHash.slice(0,32),side:dn.action,type:'limit',quantity:a(quantity),limitPrice:a(limit)};
 const dispatch=(type,payload,suffix)=>{next.connector=dispatchPaperOrder(next.connector,{type,payload,idempotencyKey:orderId+':'+suffix,expectedRevision:next.connector.revision},{now,maxAgeMs:MAX_BOOK_AGE_MS}).state;};
 try{
  dispatch('order.reserve',{intent,quote:q.connectorQuote},'reserve');
  for(let n=0;n<planned.length;n++){const p=planned[n];dispatch('order.fill',{orderId,fill:{fillId:orderId+':fill:'+n,quantity:p.quantity,price:p.price,occurredAt:now}},'fill:'+n);}
  if(remaining>0n)dispatch('order.cancel',{orderId,confirmed:true},'cancel');
  else dispatch('order.reconcile',{orderId,reportedStatus:'filled',confirmed:true,reportedAt:now,fills:[]},'reconcile');
 }catch(error){if(!(error instanceof ConnectorError))throw error;return {account:clone(account),order:null,fills:[],blockedReasons:[error.code],executionEvidence:{...evidence,atomicRollback:true,reason:error.code}};}
 for(const p of planned)consumption.used[p.index][dn.action]=a(d(consumption.used[p.index][dn.action])+d(p.quantity));
 if(planned.length&&!next.liquidity.some(l=>l.sourceHash===book.sourceHash))next.liquidity.push(consumption);
 appendMark(next,q.book,now,q.bindingHash);
 return finish(next.connector.orders.find(o=>o.id===orderId),next.connector.fills.filter(f=>f.orderId===orderId));
}
export function transferEventPaperCash(account,{id,amount,direction,now}){
 checked(account);const next=clone(account),prior=next.connector.fundingLedger?.some(f=>f.id===id);next.connector=transferPaperConnectorCash(next.connector,{id,amount,direction,now});if(prior)return next;const delta=direction==='deposit'?d(amount):-d(amount);next.capitalFlows??=[];next.capitalFlows.push({id,amount:String(amount),direction,at:now,markOffset:next.marks.length});const day=next.dailyEquity.find(row=>row.day===now.slice(0,10));if(day)day.equity=a(max(0n,d(day.equity)+delta));next.updatedAt=now;return checked(next);
}
export function getEventPaperReport(account,{book,asOf=account.updatedAt}={}){
 checked(account);const marked=book?markEventPaperAccount(account,{book,asOf}):account,last=marked.marks.at(-1);stamp(asOf);check(Date.parse(asOf)>=Date.parse(marked.updatedAt),'EVENT_TIME_ORDER','계좌 기록 이후의 시각을 확인하세요.');
 const t=valued(marked,last?d(last.bidPrice):0n);check(t.quantity===0n||!!last,'POSITION_MARK_REQUIRED','평가할 보유 호가가 필요합니다.');
 let peak=d(marked.initialCash),units=Number(marked.initialCash),nav=1,peakNav=1,maxDrawdown=0;if(!marked.capitalFlows?.length){for(const row of marked.marks){const equity=d(row.equity);peak=max(peak,equity);if(peak>0n)maxDrawdown=Math.max(maxDrawdown,Number(a((peak-equity)*Q/peak)));}}for(const [index,row]of (marked.capitalFlows?.length?marked.marks:[]).entries()){for(const f of marked.capitalFlows??[])if(f.markOffset===index)units+=(f.direction==='deposit'?1:-1)*Number(f.amount)/nav;nav=Number(row.equity)/units;peakNav=Math.max(peakNav,nav);if(peakNav>0)maxDrawdown=Math.max(maxDrawdown,(peakNav-nav)/peakNav);}const contributed=(marked.connector.fundingLedger??[]).reduce((sum,f)=>sum+(f.direction==='deposit'?d(f.amount):-d(f.amount)),0n),capital=d(marked.initialCash)+contributed;
 return {contractVersion:EVENT_PAPER_VERSION,accountId:marked.id,profileId:marked.profileId,instrumentId:marked.instrumentId,quoteCurrency:marked.quoteCurrency,asOf:last?.at??marked.updatedAt,initialCash:marked.initialCash,cash:a(t.cash),quantity:a(t.quantity),costBasis:a(t.basis),averageCost:t.quantity?a(t.basis*Q/t.quantity):null,marketValue:a(t.marketValue),equity:a(t.equity),realizedPnl:a(t.realized),unrealizedPnl:a(t.marketValue-t.basis),netPnl:a(t.equity-capital),netReturn:capital>0n?Number(a(t.equity))/Number(a(capital))-1:null,totalFees:a(t.fees),maxDrawdown,orderCount:marked.connector.orders.length,fillCount:marked.connector.fills.length,orders:clone(marked.connector.orders),fills:clone(marked.connector.fills),ledger:t.ledger,equityCurve:clone(marked.marks),markPolicy:'OBSERVED_BEST_BID_PLUS_QUOTE_CASH',costPolicy:'WEIGHTED_AVERAGE_INCLUDES_ENTRY_FEE_PRORATA_FLOOR_18DP_FINAL_EXIT_CLEARS_BASIS',benchmark:{kind:'HOLD_QUOTE_CURRENCY',currency:marked.quoteCurrency,netReturn:0},passiveQueueFills:false,liveOrders:0};
}
