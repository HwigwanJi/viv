import {gzipSync} from 'node:zlib';
import {captureUpbitPublic,normalizeUpbitScalpingEvent,UPBIT_SCALP_MAX_CLOCK_LEAD_MS} from './upbit-scalping-market.mjs';
import {readUpbitEntryEligibility} from './upbit-entry-eligibility.mjs';
import {minuteFeatureBars,rankSurgeWatch} from '../dist/domain/surge-path-model.mjs';
import {hashInputPackage} from '../dist/domain/workspace.mjs';
const cache=new Map(),M=60000;
const compressed=s=>{const {rawBody,...meta}=s;return {...meta,bodyEncoding:'GZIP_UTF8_BASE64',rawBodyGzipBase64:gzipSync(Buffer.from(rawBody,'utf8')).toString('base64')};};
/** One universe quote request ranks every approved market; candles/depth are read for graph candidates and holdings. */
export async function readMinuteSurgeMarket({db,owner,activationId,marketIds,ownedMarketIds=[],policy,fetchImpl=fetch,clock=()=>new Date().toISOString(),heartbeat=async()=>{},sleep=ms=>new Promise(r=>setTimeout(r,ms))}){
 const boundary=new Date(Math.floor(Date.parse(clock())/M)*M).toISOString(),key=hashInputPackage({owner,activationId,boundary,marketIds,ownedMarketIds,policy});if(cache.has(key))return cache.get(key);
 const pending=(async()=>{
  await db.prepare('CREATE TABLE IF NOT EXISTS surge_watch_snapshots(owner_id TEXT NOT NULL,activation_id TEXT NOT NULL,at TEXT NOT NULL,body TEXT NOT NULL,PRIMARY KEY(owner_id,activation_id,at))').bind().run();
  const rawSources=[],universe=await captureUpbitPublic('/v1/ticker/all',{quote_currencies:'KRW'},{fetchImpl,clock});rawSources.push(universe.source);
  const allowed=new Set(marketIds),watch={at:universe.source.receivedAt,sourceHash:universe.source.rawSha256,rows:universe.body.filter(r=>allowed.has(r.market)).map(r=>({market:r.market,price:Number(r.trade_price),quoteVolume24h:Number(r.acc_trade_price_24h),changeRate:Number(r.signed_change_rate),quoteAt:new Date(Number(r.timestamp)).toISOString()}))};
  const tickerLead=Math.max(0,...watch.rows.map(r=>Date.parse(r.quoteAt)-Date.parse(watch.at)));if(tickerLead>0&&tickerLead<=UPBIT_SCALP_MAX_CLOCK_LEAD_MS){await sleep(tickerLead+1);watch.at=clock();}
  if(watch.rows.some(r=>!(r.price>0&&r.quoteVolume24h>=0)||r.quoteAt>watch.at))throw Object.assign(Error('전체 종목의 실제 시세 시각과 수치를 확인하세요.'),{code:'SURGE_WATCH_SOURCE'});
  const prior=(await db.prepare('SELECT body FROM surge_watch_snapshots WHERE owner_id=? AND activation_id=? AND at>=? AND at<? ORDER BY at').bind(owner,activationId,new Date(Date.parse(watch.at)-policy.watchMinutes*M).toISOString(),watch.at).all()).results.map(r=>JSON.parse(r.body));
  await db.prepare('INSERT OR IGNORE INTO surge_watch_snapshots VALUES(?,?,?,?)').bind(owner,activationId,watch.at,JSON.stringify(watch)).run();
  await db.prepare('DELETE FROM surge_watch_snapshots WHERE owner_id=? AND activation_id=? AND at<?').bind(owner,activationId,new Date(Date.parse(watch.at)-61*M).toISOString()).run();
  const eligibility=await readUpbitEntryEligibility({marketIds,fetchImpl,clock});rawSources.push({id:eligibility.snapshot.id,rawSha256:eligibility.snapshot.rawBodySha256,sourceUrl:eligibility.snapshot.url,rawBody:eligibility.snapshot.rawBody,receivedAt:eligibility.snapshot.receivedAt,requestStartedAt:eligibility.snapshot.requestStartedAt});
  const ranking=rankSurgeWatch(watch,prior,policy),selected=[...new Set([...ranking.filter(r=>eligibility.eligibility.markets[r.market]?.allowed).slice(0,policy.candidateCount).map(r=>r.market),...ownedMarketIds])],series=[];
  for(const market of selected){await heartbeat();const r=await captureUpbitPublic('/v1/candles/minutes/1',{market,count:'31',to:boundary},{fetchImpl,clock});rawSources.push(r.source);const candles=r.body.map(b=>({openTime:new Date(Date.parse(b.candle_date_time_utc+'Z')).toISOString(),open:Number(b.opening_price),high:Number(b.high_price),low:Number(b.low_price),close:Number(b.trade_price),volume:Number(b.candle_acc_trade_volume),quoteVolume:Number(b.candle_acc_trade_price)})).sort((a,b)=>a.openTime.localeCompare(b.openTime));
   if(candles.some(b=>Date.parse(b.openTime)+M>Date.parse(boundary)||![b.open,b.high,b.low,b.close,b.volume].every(Number.isFinite)||b.close<=0))throw Object.assign(Error('확정 분봉 원문을 확인하세요.'),{code:'SURGE_CANDLE_SOURCE'});
   const prepared=minuteFeatureBars(candles,{asOf:boundary,count:30});if(!prepared.ready){if(ownedMarketIds.includes(market))throw Object.assign(Error('보유 종목의 특징 입력을 다시 수집합니다.'),{code:'SURGE_OWN_HISTORY'});continue;}
   series.push({market,bars:prepared.bars.map(b=>({t:b[0]+M,open:b[1],high:b[2],low:b[3],close:b[4],volume:b[5],quoteVolume:b[4]*b[5],availableAt:r.source.receivedAt})),carriedMinuteCount:prepared.carried.length,featureGapPolicy:prepared.policy});
  }
  if(!series.length)throw Object.assign(Error('분봉 후보 입력을 확인하세요.'),{code:'SURGE_NO_CANDIDATES'});
  const books=await captureUpbitPublic('/v1/orderbook',{markets:series.map(s=>s.market).join(',')},{fetchImpl,clock});rawSources.push(books.source);
  const normalized=books.body.map(r=>normalizeUpbitScalpingEvent(JSON.stringify({...r,type:'orderbook',code:r.market,level:0}),{receivedAt:books.source.receivedAt,markets:series.map(s=>s.market)})),lead=Math.max(0,...normalized.map(b=>Date.parse(b.eventTime)-Date.parse(clock())));if(lead>UPBIT_SCALP_MAX_CLOCK_LEAD_MS)throw Object.assign(Error('호가 시각을 확인하세요.'),{code:'SURGE_BOOK_CLOCK'});if(lead>0)await sleep(lead+1);
  for(const s of series){const book=normalized.find(b=>b.market===s.market);if(!book)throw Object.assign(Error('종목별 실제 호가를 확인하세요.'),{code:'SURGE_BOOK_REQUIRED'});s.quote={bidPrice:book.levels[0].bidPrice,askPrice:book.levels[0].askPrice,eventTime:book.eventTime,receivedAt:book.receivedAt,availableAt:[book.eventTime,book.receivedAt].sort().at(-1),sourceHash:book.sourceHash,rawSourceHash:books.source.rawSha256,basis:'OBSERVED_BBO'};}
  return {frame:{contractVersion:'minute-surge-market-v1',timeframe:'1m',asOf:boundary,availableAt:clock(),series,entryEligibility:eligibility.eligibility,watch:{observedMarkets:watch.rows.length,selectedMarkets:selected,sourceHash:watch.sourceHash,ranking:ranking.map(r=>({market:r.market,score:r.score,momentumPerMinute:r.momentumPerMinute,watchFrom:r.watchFrom}))},sourceRefs:rawSources.map(s=>({id:s.id,contentHash:s.rawSha256,sourceRef:s.sourceUrl}))},rawSources:rawSources.map(compressed)};
 })();cache.set(key,pending);try{const result=await pending;for(const k of cache.keys())if(k!==key)cache.delete(k);return result;}catch(e){cache.delete(key);throw e;}
}
