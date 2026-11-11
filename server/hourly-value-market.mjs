import {hourlyScreenSource} from './hourly-screen-source.mjs';
import {hashInputPackage} from '../dist/domain/workspace.mjs';
import {getInstrument} from '../dist/domain/instruments.mjs';
import {normalizeUpbitScalpingEvent,parseScalpFinancialJson,shareUpbitPublicRateLimit} from './upbit-scalping-market.mjs';
import {currentUpbitBookQuote} from './upbit-book-quote.mjs';
import {captureHourlyValueMarket,readHourlyValueReview} from './hourly-value-capture.mjs';
import {readUpbitEntryEligibility} from './upbit-entry-eligibility.mjs';
import {readUpbitTradingReadiness} from './upbit-trading-readiness.mjs';

const check=(ok,code)=>{if(!ok)throw Object.assign(new Error(code),{code,status:409});},iso=t=>new Date(t).toISOString();
/** Public delivery after preparation: the account fees/rules come from the saved normal readiness capture. */
export function createHourlyValueMarket({env={},owner,config,options={},clock,onRecord,reserveRequest=null}={}){
 const markets=config.marketIds;check(Array.isArray(markets)&&markets.length>0&&markets.length<=500&&new Set(markets).size===markets.length&&markets.every(m=>/^KRW-[A-Z0-9]+$/.test(m))&&Number.isSafeInteger(config.maxPublicRequests)&&config.maxPublicRequests>0&&typeof config.endsAt==='string'&&Number.isFinite(Date.parse(config.endsAt))&&iso(config.endsAt)===config.endsAt,'HOURLY_VALUE_SOURCE_SCOPE');
 const templates=new Map((config.marketTemplates??[]).map(d=>[d.market,structuredClone(d)])),reviews=new Map();let used=config.publicRequestsUsedAtPrepare??0,started=false,stopped=false,budgetFailure=null;
 const now=()=>iso(clock()),fetchImpl=async(url,init)=>{
  const u=new URL(url);check(!stopped&&u.origin==='https://api.upbit.com'&&['/v1/market/all','/v1/ticker','/v1/candles/minutes/60','/v1/candles/minutes/1','/v1/orderbook'].includes(u.pathname)&&!new Headers(init?.headers).has('Authorization'),'HOURLY_VALUE_PUBLIC_SOURCE');
  check(now()<config.endsAt,'OPERATION_WINDOW');try{if(reserveRequest)used=await reserveRequest();else{check(used<config.maxPublicRequests,'HOURLY_VALUE_PUBLIC_BUDGET');used++;}}catch(error){if(error.code==='HOURLY_VALUE_PUBLIC_BUDGET')budgetFailure=error;throw error;}
  return (options.fetchImpl??fetch)(url,init);
 };
 shareUpbitPublicRateLimit(fetchImpl,options.fetchImpl??fetch);
 async function journal(body){await onRecord(structuredClone(body));}
 function book(row,rawSource){check(row&&markets.includes(row.market),'HOURLY_VALUE_BOOK_SOURCE');const event=normalizeUpbitScalpingEvent(JSON.stringify({...row,type:'orderbook',code:row.market,level:0}),{receivedAt:rawSource.receivedAt,markets});return {...event,id:row.market+':rest:'+rawSource.rawSha256,sourceHash:rawSource.rawSha256,availableAt:[event.eventTime,event.receivedAt].sort().at(-1),rawSource};}
 async function readEntrySnapshot(){let result;try{result=await readUpbitEntryEligibility({marketIds:markets,fetchImpl,clock:now});}catch(error){throw budgetFailure??error;}await journal({kind:'HOURLY_ENTRY_ELIGIBILITY',...result});return result.snapshot;}
 const screen=options.screenProfileId?hourlyScreenSource({marketIds:markets,profileId:options.screenProfileId,clock:now,fetchImpl,onRecord:journal}):null;
 const source={
  async start(){
   if(started)return;check(!stopped,'HOURLY_VALUE_SOURCE_STOPPED');
   for(const market of markets)if(!templates.has(market)){
    const result=await (options.readReadiness??readUpbitTradingReadiness)({db:options.db,owner,env,market,fetchImpl:options.fetchImpl,clock:now});await journal({kind:'HOURLY_TRADING_RULES',market,...result});
    const r=result.readiness;check(r?.ready&&r.market===market&&r.rules?.tickSize&&r.rules.state==='active','EVENT_PAPER_TRADING_RULES');templates.set(market,{market,instrumentId:'crypto:upbit:'+market,feeSnapshot:r.fees,rules:r.rules});
   }
   const rates=[...templates.values()].map(d=>[d.feeSnapshot.takerBuyRate,d.feeSnapshot.takerSellRate].map(Number).join(':'));check(new Set(rates).size===1,'HOURLY_VALUE_FEE_SCHEDULE');started=true;
  },
  async stop(){stopped=true;},
  summary:()=>({maximum:config.maxPublicRequests,used,remaining:config.maxPublicRequests-used}),
  fees(market){const d=templates.get(market);check(d,'HOURLY_VALUE_SOURCE_MARKET');return {buyRate:d.feeSnapshot.takerBuyRate,sellRate:d.feeSnapshot.takerSellRate,availableAt:d.feeSnapshot.observedAt,sourceHash:d.feeSnapshot.sourceHash};},
  dataset(market){check(templates.has(market),'HOURLY_VALUE_SOURCE_MARKET');return structuredClone(templates.get(market));},
  readEntrySnapshot,
  async snapshot({ownedMarketIds=[]}={}){
   check(started&&!stopped,'HOURLY_VALUE_SOURCE_STOPPED');const captured=screen?await screen.snapshot():await captureHourlyValueMarket({marketIds:markets,ownedMarketIds,fetchImpl,clock:now,onRecord:journal});
   return {...captured,datasets:markets.map(m=>({...source.dataset(m),id:'hourly-template:'+m,sourceHash:hashInputPackage(source.dataset(m))}))};
  },
  async readReview({market,forecastAsOf}){
   const key=market+':'+forecastAsOf;if(reviews.has(key))return structuredClone(reviews.get(key));
   const review=await readHourlyValueReview({market,forecastAsOf,fetchImpl,clock:now,onRecord:journal});if(review)reviews.set(key,review);return structuredClone(review);
  },
  async readBook({market,after=null}){
   check(markets.includes(market),'HOURLY_VALUE_SOURCE_MARKET');let quote;try{quote=await currentUpbitBookQuote(getInstrument('crypto:upbit:'+market),{fetchImpl,now:clock,notBefore:after});}catch(error){throw budgetFailure??error;}
   const rawSource={rawBody:quote.rawBody,rawSha256:quote.rawSha256,receivedAt:quote.receivedAt,sourceUrl:quote.url};await journal({kind:'HOURLY_EXECUTION_BOOK',rawSource});return book(parseScalpFinancialJson(quote.rawBody).find(row=>row.market===market),rawSource);
  }
 };
 return source;
}
