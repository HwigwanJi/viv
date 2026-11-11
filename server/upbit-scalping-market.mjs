import {researchSha256} from '../dist/domain/research.mjs';

export const UPBIT_SCALP_CAPTURE_VERSION='upbit-scalp-capture-v1';
export const UPBIT_SCALP_MAX_CLOCK_LEAD_MS=3000;
const iso=value=>new Date(value).toISOString(),check=(ok,code,message)=>{if(!ok)throw Object.assign(new Error(message),{code,status:409});},marketOk=m=>/^(BTC|KRW)-[A-Z0-9]{1,20}$/.test(m??''),steps={'1m':60000,'3m':180000,'5m':300000,'60m':3600000},bytes=t=>new TextEncoder().encode(t).length;
export function scalpDecimal(value){
 const text=String(value);check(/^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(text)&&text.length<=90,'SCALP_DECIMAL','가격·수량의 원문 단위를 확인하세요.');
 const [coefficient,exponent='0']=text.toLowerCase().split('e'),negative=coefficient.startsWith('-'),[whole,fraction='']=coefficient.replace('-','').split('.'),power=Number(exponent);check(Number.isInteger(power)&&Math.abs(power)<=30,'SCALP_DECIMAL','소수 정밀도 범위를 확인하세요.');
 const digits=whole+fraction,point=whole.length+power,result=point<=0?'0.'+'0'.repeat(-point)+digits:point>=digits.length?digits+'0'.repeat(point-digits.length):digits.slice(0,point)+'.'+digits.slice(point),[a,b='']=result.split('.'),normalized=a.replace(/^0+(?=\d)/,'')+(b.replace(/0+$/,'')?'.'+b.replace(/0+$/,''):'');return (negative&&normalized!=='0'?'-':'')+normalized;
}
export function parseScalpFinancialJson(raw){
 check(typeof raw==='string'&&bytes(raw)<=2000000,'SCALP_RAW_SIZE','시장 원문 수집 범위를 확인하세요.');
 return JSON.parse(raw.replace(/("(?:trade_price|trade_volume|ask_price|bid_price|ask_size|bid_size|total_ask_size|total_bid_size|acc_trade_price_24h|acc_trade_volume_24h|tick_size|price|volume|funds|remaining_volume|executed_volume|paid_fee|remaining_fee|reserved_fee|locked|balance|bid_fee|ask_fee|maker_bid_fee|maker_ask_fee|min_total|max_total)"\s*:\s*)(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g,(_m,p,n)=>p+JSON.stringify(n)));
}
export function createScalpingRequestBudget(maximum=120){let used=0;return {reserve(){check(used<maximum,'SCALP_REQUEST_BUDGET','공개 시세 수집 한도에 도달했습니다.');used++;},summary:()=>({maximum,used,remaining:maximum-used})};}
const publicQueues=new WeakMap();
export function shareUpbitPublicRateLimit(wrapper,transport=fetch){
 let groups=publicQueues.get(transport);if(!groups)publicQueues.set(transport,groups=new Map());
 publicQueues.set(wrapper,groups);return wrapper;
}
function queuePublic(path,fetchImpl,request){
 const group=path.startsWith('/v1/orderbook')?'orderbook':path.startsWith('/v1/candles/')?'candle':path==='/v1/trades/ticks'?'trade':'ticker';
 let groups=publicQueues.get(fetchImpl);if(!groups)publicQueues.set(fetchImpl,groups=new Map());
 let queue=groups.get(group);if(!queue)groups.set(group,queue={tail:Promise.resolve(),starts:[],notBefore:0});
 const pending=queue.tail.then(async()=>{
  queue.starts=queue.starts.filter(at=>Date.now()-at<1050);
  const wait=Math.max(queue.notBefore,queue.starts.length>=10?queue.starts[0]+1050:0)-Date.now();
  if(wait>0)await new Promise(resolve=>setTimeout(resolve,wait));
  queue.starts=queue.starts.filter(at=>Date.now()-at<1050);queue.starts.push(Date.now());
  const result=await request(),remaining=result.response.headers.get('Remaining-Req'),retry=result.response.headers.get('Retry-After');
  if(/(?:^|;)\s*sec=0\s*(?:;|$)/.test(remaining??'')||result.response.status===429){
   const retryMs=/^\d{1,8}$/.test(retry??'')?Number(retry)*1000:Number.isFinite(Date.parse(retry))?Date.parse(retry)-Date.now():0;
   queue.notBefore=Date.now()+Math.max(1050,retryMs);
  }
  return result;
 });
 queue.tail=pending.catch(()=>{});return pending;
}
export async function captureUpbitPublic(path,params,{budget,fetchImpl=fetch,clock=()=>new Date().toISOString()}={}){
 check(['/v1/ticker/all','/v1/market/all','/v1/candles/days','/v1/candles/seconds','/v1/candles/minutes/60','/v1/ticker','/v1/orderbook','/v1/orderbook/instruments','/v1/trades/ticks',...Object.keys(steps).map(t=>'/v1/candles/minutes/'+Number(t.slice(0,-1)))].includes(path),'SCALP_PUBLIC_PATH','공개 시장 자료 경로를 확인하세요.');
 const url=new URL(path,'https://api.upbit.com');url.search=new URLSearchParams(params);
 const {requestedAt,response,rawBody,receivedAt}=await queuePublic(path,fetchImpl,async()=>{budget?.reserve();const requestedAt=iso(clock());let response,rawBody;try{response=await fetchImpl(url.href,{method:'GET',redirect:'error',cache:'no-store',signal:AbortSignal.timeout(15000)});rawBody=await response.text();}catch{throw Object.assign(new Error('거래소 시세 연결을 기다리고 있습니다.'),{code:'SCALP_PUBLIC_NETWORK',status:503});}return {requestedAt,response,rawBody,receivedAt:iso(clock())};});
 const rawSha256=researchSha256(rawBody),source={id:'scalp-source-'+rawSha256,sourceUrl:url.href,requestedAt,receivedAt,availableAt:receivedAt,method:'GET',httpStatus:response.status,rawSha256,rawBody,remainingReq:response.headers.get('Remaining-Req'),retryAfter:response.headers.get('Retry-After'),hashContract:'RESPONSE_UTF8_SHA256_V1'};
 if(!response.ok)throw Object.assign(new Error(response.status===429?'거래소 시세 조회 한도로 잠시 대기합니다.':'시장 자료 조회를 다시 확인하세요.'),{code:'SCALP_PUBLIC_HTTP_'+response.status,status:409,source});
 return {source,body:parseScalpFinancialJson(rawBody)};
}
export async function readUpbitScalpingCandles({market,timeframe='1m',count=200,to=null,startAt=null,endAt=to,maxPages=24,budget,fetchImpl,clock=()=>new Date().toISOString(),sleep=ms=>new Promise(r=>setTimeout(r,ms))}={}){
 check(marketOk(market)&&steps[timeframe]&&Number.isInteger(count)&&count>=1&&count<=20000&&Number.isInteger(maxPages)&&maxPages>=1&&maxPages<=120,'SCALP_CANDLE_SCOPE','거래쌍·분봉·조회 범위를 확인하세요.');
 const validTime=v=>v===null||typeof v==='string'&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString()===v;check([to,startAt,endAt].every(validTime)&&(!startAt||!endAt||Date.parse(startAt)<Date.parse(endAt)),'SCALP_CANDLE_PERIOD','분봉 조회의 시작과 종료 시각을 확인하세요.');
 const bars=[],rawSources=[],seen=new Set(),step=steps[timeframe];let cursor=to??endAt,excludedUnclosed=0;
 for(let page=0;page<maxPages&&bars.length<count;page++){
  if(page)await sleep(160);const requestedCount=Math.min(200,count-bars.length+1),capture=await captureUpbitPublic('/v1/candles/minutes/'+Number(timeframe.slice(0,-1)),{market,count:String(requestedCount),...(cursor?{to:cursor}:{})},{budget,fetchImpl,clock});rawSources.push(capture.source);
  check(Array.isArray(capture.body)&&capture.body.length<=requestedCount,'SCALP_CANDLE_RESPONSE','분봉 원본의 행 수를 확인하세요.');let oldest=null,previous=Infinity;
  for(const row of capture.body){const open=Date.parse(row.candle_date_time_utc+'Z');check(row.market===market&&row.unit===step/60000&&Number.isFinite(open)&&open%step===0&&open<previous&&(!cursor||open<Date.parse(cursor)),'SCALP_CANDLE_TIME','원문 분봉의 종목·시각·순서를 확인하세요.');previous=open;oldest=open;
   check(!seen.has(open),'SCALP_CANDLE_DUPLICATE','분봉 페이지의 중복을 확인하세요.');seen.add(open);if(open+step>Date.parse(capture.source.receivedAt)){excludedUnclosed++;continue;}
   const v={openTime:iso(open),closeTime:iso(open+step),open:row.opening_price,high:row.high_price,low:row.low_price,close:row.trade_price,volume:row.candle_acc_trade_volume,quoteVolume:row.candle_acc_trade_price,isClosed:true,sourceHash:capture.source.rawSha256};
   for(const key of ['open','high','low','close','volume','quoteVolume'])v[key]=Number(v[key]);check(['open','high','low','close'].every(k=>Number.isFinite(v[k])&&v[k]>0)&&Number.isFinite(v.volume)&&v.volume>=0&&Number.isFinite(v.quoteVolume)&&v.quoteVolume>=0&&v.low<=Math.min(v.open,v.close)&&v.high>=Math.max(v.open,v.close),'SCALP_CANDLE_VALUE','분봉 가격과 거래량 원문을 확인하세요.');bars.push(v);
  }
  if(oldest===null||capture.body.length<requestedCount||startAt&&oldest<=Date.parse(startAt))break;cursor=iso(oldest);
 }
 bars.sort((a,b)=>a.openTime.localeCompare(b.openTime));const selected=bars.filter(b=>(!startAt||b.openTime>=startAt)&&(!endAt||b.closeTime<=endAt)).slice(-count),missingWindows=[];for(let i=1;i<selected.length;i++){const gap=Date.parse(selected[i].openTime)-Date.parse(selected[i-1].closeTime);if(gap>0)missingWindows.push({startAt:selected[i-1].closeTime,endAt:selected[i].openTime,missingCount:gap/step});}
 const value={contractVersion:UPBIT_SCALP_CAPTURE_VERSION,id:'scalp-candles-'+researchSha256(JSON.stringify(rawSources.map(s=>s.rawSha256))).slice(0,32),market,timeframe,startAt:selected[0]?.openTime??null,endAt:selected.at(-1)?.closeTime??null,availableAt:rawSources.at(-1)?.receivedAt??iso(clock()),bars:selected,events:[],rawSources,coverage:{missingWindows,excludedUnclosed,tradeEvents:0,bookEvents:0,earliestObservedAt:selected[0]?.openTime??null,latestObservedAt:selected.at(-1)?.closeTime??null},executionEvidence:'CONFIRMED_CANDLES_ONLY',budget:budget?.summary()??null};return {...value,sourceHash:researchSha256(JSON.stringify(value))};
}
export function normalizeUpbitScalpingEvent(rawBody,{receivedAt,markets}={}){
 const row=parseScalpFinancialJson(rawBody);check(row&&['trade','orderbook'].includes(row.type)&&Array.isArray(markets)&&markets.includes(row.code)&&marketOk(row.code),'SCALP_EVENT_SCOPE','체결·호가의 구독 거래쌍을 확인하세요.');const eventStamp=row.type==='trade'?row.trade_timestamp:row.timestamp;
 check(Number.isSafeInteger(eventStamp)&&eventStamp>0&&eventStamp<=Date.parse(receivedAt)+UPBIT_SCALP_MAX_CLOCK_LEAD_MS,'SCALP_EVENT_TIME','수신 자료와 원 시장 시각을 확인하세요.');const sourceHash=researchSha256(rawBody),base={kind:row.type==='trade'?'TRADE':'ORDER_BOOK',market:row.code,eventTime:iso(eventStamp),receivedAt,availableAt:receivedAt,sourceHash};
 if(row.type==='trade'){
  const match=/"sequential_id"\s*:\s*("[^"]+"|\d+)/.exec(rawBody),sequentialId=match?match[1].replaceAll('"',''):null;check(sequentialId&&['ASK','BID'].includes(row.ask_bid),'SCALP_TRADE_ID','체결 식별자와 매수·매도 방향을 확인하세요.');const price=scalpDecimal(row.trade_price),quantity=scalpDecimal(row.trade_volume);check(Number(price)>0&&Number(quantity)>0,'SCALP_TRADE_VALUE','체결 가격과 수량을 확인하세요.');return {...base,id:row.code+':trade:'+sequentialId,sequentialId,side:row.ask_bid==='BID'?'BUY':'SELL',price,quantity};
 }
 check((row.level===undefined||Number(row.level)===0)&&Array.isArray(row.orderbook_units)&&row.orderbook_units.length>=1&&row.orderbook_units.length<=30,'SCALP_BOOK_LEVEL','개별 호가 레벨 원문을 확인하세요.');const levels=row.orderbook_units.map(u=>({askPrice:scalpDecimal(u.ask_price),askQuantity:scalpDecimal(u.ask_size),bidPrice:scalpDecimal(u.bid_price),bidQuantity:scalpDecimal(u.bid_size)}));
 check(levels.every((l,i)=>Object.values(l).every(v=>Number(v)>0)&&Number(l.askPrice)>Number(l.bidPrice)&&(!i||Number(l.askPrice)>Number(levels[i-1].askPrice)&&Number(l.bidPrice)<Number(levels[i-1].bidPrice))),'SCALP_BOOK_ORDER','호가 가격·잔량·순서를 확인하세요.');return {...base,id:row.code+':book:'+eventStamp+':'+sourceHash.slice(0,16),levels};
}
/** A bounded raw journal streams to its caller; no orders or account methods exist here. */
export function collectUpbitScalpingEvents({markets,durationMs=1800000,maxBytes=268435456,maxQueuedBytes=8388608,maxReconnects=2,onRecord,WebSocketImpl=globalThis.WebSocket,clock=()=>new Date().toISOString()}={}){
 check(Array.isArray(markets)&&markets.length>=1&&markets.length<=10&&new Set(markets).size===markets.length&&markets.every(marketOk)&&typeof onRecord==='function'&&durationMs>=1000&&durationMs<=3600000&&maxBytes>=1000&&maxBytes<=536870912,'SCALP_STREAM_SCOPE','실시간 시장 수집 범위를 확인하세요.');
 const startedAt=iso(clock()),deadline=Date.now()+durationMs,state={contractVersion:UPBIT_SCALP_CAPTURE_VERSION,startedAt,markets:[...markets],tradeEvents:0,bookEvents:0,duplicates:0,invalidEvents:0,bytes:0,reconnects:0,connections:0,gaps:[],status:'CONNECTING'},seen=new Map();let ws,timer,reconnectTimer,stopped=false,queue=Promise.resolve(),queued=0,resolveDone,rejectDone;const done=new Promise((r,j)=>{resolveDone=r;rejectDone=j;});
 const enqueue=record=>{const size=bytes(JSON.stringify(record));queued+=size;queue=queue.then(()=>onRecord(record)).finally(()=>{queued-=size;});return queue;};
 const stop=reason=>{if(stopped)return;stopped=true;clearTimeout(timer);clearTimeout(reconnectTimer);state.status='STOPPED';state.stopReason=reason;state.completedAt=iso(clock());try{ws?.close(1000,'capture complete');}catch{}enqueue({kind:'STREAM_STOP',...state}).then(()=>resolveDone(structuredClone(state))).catch(rejectDone);};
 const connect=()=>{
  if(stopped)return;state.connections++;ws=new WebSocketImpl('wss://api.upbit.com/websocket/v1');
  ws.addEventListener('open',()=>{if(stopped){ws.close();return;}state.status='RECORDING';ws.send(JSON.stringify([{ticket:crypto.randomUUID()},{type:'trade',codes:markets,is_only_realtime:true},{type:'orderbook',codes:markets,is_only_realtime:true,level:0},{format:'DEFAULT'}]));enqueue({kind:'STREAM_CONNECTED',at:iso(clock()),connection:state.connections,markets:[...markets]}).catch(()=>stop('JOURNAL_WRITE_FAILED'));});
  ws.addEventListener('message',event=>{if(stopped)return;const receivedAt=iso(clock()),incoming=typeof event.data==='string'?bytes(event.data):event.data.byteLength??event.data.size??0;queued+=incoming;if(queued>maxQueuedBytes){queued-=incoming;stop('BACKPRESSURE_LIMIT');return;}queue=queue.then(async()=>{if(stopped)return;const rawBody=typeof event.data==='string'?event.data:event.data instanceof ArrayBuffer?new TextDecoder().decode(event.data):await event.data.text(),size=bytes(rawBody);if(state.bytes+size>maxBytes){stop('BYTE_LIMIT');return;}state.bytes+=size;let normalized;try{normalized=normalizeUpbitScalpingEvent(rawBody,{receivedAt,markets});}catch(error){state.invalidEvents++;await onRecord({kind:'INVALID_EVENT',receivedAt,sourceHash:researchSha256(rawBody),rawBody,errorCode:error.code??'INVALID_JSON'});stop('INVALID_EVENT');return;}if(seen.has(normalized.id)){state.duplicates++;return;}seen.set(normalized.id,true);if(seen.size>100000)seen.delete(seen.keys().next().value);state[normalized.kind==='TRADE'?'tradeEvents':'bookEvents']++;await onRecord({kind:'MARKET_EVENT',event:normalized,source:{sourceUrl:'wss://api.upbit.com/websocket/v1',receivedAt,rawSha256:normalized.sourceHash,rawBody}});}).catch(()=>stop('JOURNAL_WRITE_FAILED')).finally(()=>{queued-=incoming;});});
  ws.addEventListener('error',()=>{if(stopped)return;enqueue({kind:'STREAM_ERROR',at:iso(clock()),connection:state.connections}).catch(()=>stop('JOURNAL_WRITE_FAILED'));});
  ws.addEventListener('close',event=>{if(stopped)return;state.gaps.push({at:iso(clock()),connection:state.connections,code:event.code});enqueue({kind:'STREAM_GAP',...state.gaps.at(-1)}).catch(()=>stop('JOURNAL_WRITE_FAILED'));if(state.reconnects>=maxReconnects||Date.now()>=deadline){stop('CONNECTION_CLOSED');return;}state.reconnects++;reconnectTimer=setTimeout(connect,1000);});
 };
 timer=setTimeout(()=>stop('DURATION_COMPLETE'),durationMs);enqueue({kind:'STREAM_START',...state,maxBytes,durationMs}).then(connect).catch(rejectDone);return {startedAt,done,stop,state:()=>structuredClone(state)};
}
