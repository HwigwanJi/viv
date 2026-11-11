import {hashInputPackage} from './workspace.mjs';
import {gameUnits} from './mind-game.mjs';

const HASH=/^[a-f0-9]{64}$/,MARKET=/^KRW-[A-Z0-9]+$/,finite=Number.isFinite;
const iso=v=>typeof v==='string'&&finite(Date.parse(v))&&new Date(v).toISOString()===v;
const check=(ok,code)=>{if(!ok)throw Object.assign(new Error(code),{code,status:409});};
const seal=body=>({...body,hash:hashInputPackage(body)});
const amount=v=>{check((typeof v==='number'&&finite(v)||typeof v==='string')&&gameUnits(v)>=0n,'HOURLY_VALUE_AMOUNT');const n=Number(v);check(finite(n)&&n<1e14,'HOURLY_VALUE_AMOUNT');return n;};
const blocked=reason=>({ready:false,status:'BLOCKED',reasonCodes:[reason]});

/** The model's positive edge and quoted price regime must survive the execution quote. */
export function reviewHourlyValueExecution(selection,{market,askPrice,maxSlippageBps,buyRate,sellRate}={}){
 const {hash,...body}=selection??{};check(hash===hashInputPackage(body)&&selection.contractVersion==='hourly-cash-value-selection-v1'&&selection.ready===true&&selection.selected.kind==='ENTER'&&selection.selected.market===market,'MODEL_ENTRY_SELECTION');
 const chosen=selection.selected,ask=amount(askPrice),buy=amount(buyRate),sell=amount(sellRate);check(ask>0&&chosen.ask>0&&chosen.expectedBid>0&&buy<1&&sell<1&&finite(maxSlippageBps)&&maxSlippageBps>=0&&maxSlippageBps<=1000,'MODEL_ENTRY_REVIEW');
 const quoteDriftBps=Math.abs(ask/chosen.ask-1)*10000,maximumEntryPrice=chosen.expectedBid*(1-sell)/(1+buy),reason=quoteDriftBps>maxSlippageBps+1e-9?'LIVE_MODEL_PRICE_CHANGED':ask>=maximumEntryPrice?'LIVE_MODEL_EDGE_CONSUMED':null;
 return {accepted:reason===null,reason,selectionHash:selection.hash,modelHash:selection.modelHash,market,decisionAsk:chosen.ask,executionAsk:ask,quoteDriftBps,maxSlippageBps,expectedBid:chosen.expectedBid,maximumEntryPrice,buyRate:buy,sellRate:sell,interpretation:'MODEL_EXPECTATION_RECHECK_NOT_REALIZED_PROFIT'};
}

/** A failed replacement entry leaves the original HOLD-versus-CASH comparison intact. */
export function rejectedHourlyValueFallback(selection){
 const {hash,...body}=selection??{};check(hash===hashInputPackage(body)&&selection.contractVersion==='hourly-cash-value-selection-v1'&&selection.ready===true&&selection.selected.kind==='ENTER'&&selection.executionAuthority==='VALUATION_ONLY','HOURLY_REVIEW_SELECTION');
 const cash=selection.values.find(v=>v.kind==='CASH'),hold=selection.values.find(v=>v.kind==='HOLD');check(cash&&finite(cash.value)&&(!hold||finite(hold.value)),'HOURLY_VALUE_FALLBACK');
 const keep=hold&&hold.value>=cash.value;
 return seal({contractVersion:'hourly-rejected-entry-fallback-v1',selectionHash:hash,kind:keep?'HOLD':'CASH',market:keep?hold.market:null,value:keep?hold.value:cash.value,steps:structuredClone(keep?[]:selection.steps.filter(s=>s.action==='sell')),executionAuthority:'VALUATION_ONLY'});
}

/** Compare forecasts from the same current wallet. Prior entry cost is absent from this decision. */
export function selectHourlyValue({asOf,profileId,accountId,account,frames,fees,modelHash,forecastExitSlippageBps,maxQuoteAgeMs=3000,timeframe='1h'}={}){
 check(Number.isSafeInteger(maxQuoteAgeMs)&&maxQuoteAgeMs>=1000&&maxQuoteAgeMs<=60000,'QUOTE_AGE_POLICY');const step={'1h':3600000,'1m':60000}[timeframe];check(step,'HOURLY_VALUE_TIMEFRAME');
 check(iso(asOf)&&typeof profileId==='string'&&profileId&&typeof accountId==='string'&&accountId&&HASH.test(modelHash),'HOURLY_VALUE_SCOPE');
 check(account?.profileId===profileId&&account.accountId===accountId&&iso(account.asOf)&&account.asOf<=asOf&&HASH.test(account.sourceHash)&&Array.isArray(account.positions)&&account.positions.length<=500,'HOURLY_VALUE_ACCOUNT');
 check(finite(forecastExitSlippageBps)&&forecastExitSlippageBps>=0&&forecastExitSlippageBps<10000&&iso(fees?.availableAt)&&fees.availableAt<=asOf&&HASH.test(fees.sourceHash),'HOURLY_VALUE_COSTS');
 const buyFee=amount(fees.buyRate),sellFee=amount(fees.sellRate);check(buyFee<1&&sellFee<1,'HOURLY_VALUE_COSTS');
 check(Array.isArray(frames)&&frames.length<=500&&new Set(frames.map(f=>f.market)).size===frames.length,'HOURLY_VALUE_MARKETS');
 const owned=new Map();for(const p of account.positions){check(MARKET.test(p.market)&&!owned.has(p.market),'HOURLY_VALUE_POSITION');const quantity=amount(p.quantity);if(quantity>0)owned.set(p.market,quantity);}
 const cash=amount(account.cash),byMarket=new Map(),excludedFrames=[];
 for(const f of frames){
  check(MARKET.test(f.market)&&typeof f.entryAllowed==='boolean'&&iso(f.forecastAsOf)&&Date.parse(f.forecastAsOf)===Math.floor(Date.parse(asOf)/step)*step&&iso(f.availableAt)&&f.forecastAsOf<=f.availableAt&&f.availableAt<=asOf&&iso(f.quoteAsOf)&&f.quoteAsOf<=f.availableAt&&HASH.test(f.sourceHash)&&['OBSERVED_BBO','HISTORICAL_COST_PROXY'].includes(f.quoteBasis),'HOURLY_VALUE_FRAME');
  const p=f.forecast;check(p?.ready===true&&p.unit==='ratio'&&p.modelHash===modelHash&&iso(p.trainingLabelCutoff)&&p.trainingLabelCutoff<f.forecastAsOf&&finite(p.value)&&p.value> -1&&p.marketPathForecast?.terminalReturn===p.value,'HOURLY_VALUE_FORECAST');
  const bid=amount(f.bidPrice),ask=amount(f.askPrice),reference=amount(p.marketPathForecast.referencePrice);check(bid>0&&ask>=bid&&reference>0,'HOURLY_VALUE_PRICE');
  const exitCost=f.forecastExitSlippageBps??forecastExitSlippageBps;check(finite(exitCost)&&exitCost>=0&&exitCost<10000,'HOURLY_VALUE_COSTS');const expectedBid=reference*(1+p.value)*(1-exitCost/10000);check(finite(expectedBid)&&expectedBid>0,'HOURLY_VALUE_FORECAST');
  const quoteAgeMs=Date.parse(asOf)-Date.parse(f.quoteAsOf);
  if(quoteAgeMs>maxQuoteAgeMs){excludedFrames.push({market:f.market,reason:'HOURLY_VALUE_STALE_QUOTE',quoteAsOf:f.quoteAsOf,quoteAgeMs});continue;}
  byMarket.set(f.market,{...f,bid,ask,expectedBid});
 }
 if([...owned.keys()].some(m=>!byMarket.has(m)))return {...blocked('HOURLY_VALUE_OWN_FRAME_REQUIRED'),excludedFrames};
 if(!byMarket.size)return {...blocked('HOURLY_VALUE_FRESH_FRAME_REQUIRED'),excludedFrames};
 let cashAfterSale=cash,holdValue=cash;for(const [m,q]of owned){const f=byMarket.get(m);cashAfterSale+=q*f.bid*(1-sellFee);holdValue+=q*f.expectedBid*(1-sellFee);}
 const values=[{kind:'CASH',market:null,value:cashAfterSale}],held=owned.size>0;
 let selected=held?{kind:'HOLD',market:owned.size===1?[...owned.keys()][0]:null,value:holdValue}:{kind:'CASH',market:null,value:cashAfterSale};
 if(held){values.push({...selected});if(cashAfterSale>holdValue)selected=values[0];}
 for(const f of byMarket.values()){
  if(!f.entryAllowed||owned.has(f.market))continue;
  const value=cashAfterSale*f.expectedBid*(1-sellFee)/(f.ask*(1+buyFee)),candidate={kind:'ENTER',market:f.market,value,expectedBid:f.expectedBid,ask:f.ask,forecastAsOf:f.forecastAsOf,sourceHash:f.sourceHash};
  check(finite(value),'HOURLY_VALUE_PREDICTION');values.push(candidate);if(value>selected.value)selected=candidate;
 }
 const steps=[];if(selected.kind!=='HOLD'){for(const [market]of owned)steps.push({action:'sell',market,targetWeight:0});if(selected.kind==='ENTER')steps.push({action:'buy',market:selected.market,targetWeight:1});}
 return seal({contractVersion:'hourly-cash-value-selection-v1',ready:true,status:'READY',asOf,profileId,accountId,modelHash,selected:{...selected},values,cashAfterSale,ownedMarkets:[...owned.keys()],steps,...(excludedFrames.length?{excludedFrames}:{}),fees:{buyRate:buyFee,sellRate:sellFee,forecastExitSlippageBps,availableAt:fees.availableAt,sourceHash:fees.sourceHash},inputHash:hashInputPackage({account,frames,fees,modelHash,forecastExitSlippageBps}),executionAuthority:'VALUATION_ONLY',valuation:'NUMBER_FORECAST_SCORING_EXACT_FILL_LEDGER_SEPARATE',depthAssumption:'Current BBO for scoring; observed-depth execution is evaluated separately'});
}

/** Review the pinned choice without substituting another asset after observing the review price. */
export function recheckHourlyValueEntry(selection,review,{asOf,entrySlippageBps,readyDelayMs}={}){
 const {hash,...body}=selection??{};check(hash===hashInputPackage(body)&&selection.ready===true&&selection.contractVersion==='hourly-cash-value-selection-v1'&&selection.executionAuthority==='VALUATION_ONLY','HOURLY_REVIEW_SELECTION');
 check(selection.selected.kind==='ENTER'&&iso(asOf)&&asOf>=selection.asOf&&finite(entrySlippageBps)&&entrySlippageBps>=0&&entrySlippageBps<10000&&Number.isSafeInteger(readyDelayMs)&&readyDelayMs>=0,'HOURLY_REVIEW_SCOPE');
 const chosen=selection.selected,forecastAt=Date.parse(chosen.forecastAsOf);
 check(review?.market===chosen.market&&iso(review.openAt)&&iso(review.closeAt)&&Date.parse(review.openAt)===forecastAt+60000&&Date.parse(review.closeAt)===forecastAt+120000&&selection.asOf<review.closeAt&&iso(review.availableAt)&&review.availableAt>=review.closeAt&&review.availableAt<=asOf&&HASH.test(review.sourceHash),'HOURLY_REVIEW_TIME');
 const price=amount(review.closePrice);check(price>0,'HOURLY_REVIEW_PRICE');
 const netExitPerUnit=chosen.expectedBid*(1-selection.fees.sellRate),newEntryPerUnit=price*(1+entrySlippageBps/10000)*(1+selection.fees.buyRate),ratio=netExitPerUnit/newEntryPerUnit,readyAt=new Date(forecastAt+readyDelayMs).toISOString(),readyToEnter=ratio>1&&readyAt<=asOf;
 return seal({contractVersion:'hourly-entry-value-review-v1',selectionHash:hash,profileId:selection.profileId,accountId:selection.accountId,market:chosen.market,asOf,reviewSourceHash:review.sourceHash,ratio,accepted:ratio>1,readyAt,readyToEnter,steps:structuredClone(readyToEnter?selection.steps:selection.steps.filter(s=>s.action==='sell')),forecastExitPrice:chosen.expectedBid,reviewClosePrice:price,estimatedEntrySlippageBps:entrySlippageBps,executionAuthority:'VALUATION_ONLY',modelHash:selection.modelHash});
}
