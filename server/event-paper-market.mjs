import {hashInputPackage} from '../dist/domain/workspace.mjs';
import {compileStrategyGraph} from '../dist/domain/strategy-graph.mjs';
import {createScalpingRequestBudget,readUpbitScalpingCandles,collectUpbitScalpingEvents} from './upbit-scalping-market.mjs';
import {readUpbitTradingReadiness} from './upbit-trading-readiness.mjs';

export const EVENT_PAPER_MARKET_VERSION='upbit-forward-event-snapshot-v1';
export const EVENT_PAPER_MARKET_LIMITS=Object.freeze({maxMarkets:10,maxFlowWindowMs:300000,maxEventsPerMarket:20000,rulesRefreshMs:300000,streamDurationMs:1800000});
const clone=structuredClone,iso=t=>new Date(t).toISOString(),time=t=>Date.parse(t),check=(v,c,m)=>{if(!v)throw Object.assign(new Error(m),{code:c,status:409});};
const sleepDefault=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const marketOf=value=>String(value).replace(/^crypto:upbit:/,'');
const economicRules=r=>({fees:Object.fromEntries(['takerBuyRate','takerSellRate','makerBuyRate','makerSellRate'].filter(k=>r.fees[k]!==undefined).map(k=>[k,r.fees[k]])),rules:Object.fromEntries(['minBuyTotal','minSellTotal','maxTotal','supportedBuyTypes','supportedSellTypes','orderSides','state','tickSize','quantityPrecision','quantityStep'].filter(k=>r.rules[k]!==undefined).map(k=>[k,r.rules[k]]))});
export const eventPaperEconomicRuleHash=dataset=>hashInputPackage(economicRules({fees:dataset.feeSnapshot??dataset.fees,rules:dataset.rules}));

/** Forward-only market adapter. Every source is journaled before it can enter an input snapshot. */
export function createEventPaperMarket({env,owner,config,options={},clock=()=>new Date().toISOString(),onRecord}={}){
 const graph=config?.graph??options.graph,markets=(config?.marketIds??config?.instrumentIds??[]).map(marketOf),timeframe=config?.timeframe??graph?.executionScope?.timeframe;
 compileStrategyGraph(graph);
 check(graph.executionScope?.kind==='EACH_ASSET'&&graph.executionScope.timeframe===timeframe&&['1m','3m','5m'].includes(timeframe)&&markets.length>=2&&markets.length<=Math.min(EVENT_PAPER_MARKET_LIMITS.maxMarkets,graph.executionScope.maxCandidates)&&new Set(markets).size===markets.length&&markets.every(m=>/^(KRW|BTC)-[A-Z0-9]{1,20}$/.test(m))&&new Set(markets.map(m=>m.split('-')[0])).size===1,'EVENT_PAPER_MARKET_SCOPE','같은 통화의 후보 2~10개와 그래프의 분봉 주기를 선택하세요.');
 check(typeof onRecord==='function','EVENT_PAPER_SOURCE_JOURNAL','시장 원문을 보존할 저장소를 연결하세요.');
 const micro=graph.nodes.filter(n=>n.type==='INPUT'&&n.config.kind==='MICROSTRUCTURE'),flowWindowMs=Math.max(60000,...micro.map(n=>n.config.flowWindowMs??60000)),lookback=Math.max(21,...micro.map(n=>(n.config.lookbackBars??20)+1),...graph.nodes.filter(n=>n.type==='RANK').flatMap(n=>[n.config.volatilityBars+1,...(n.config.terms??[]).map(t=>t.lookback+1),...(n.config.scoreNormalization==='VOLATILITY'?[n.config.normalizationLookback+1]:[])]),...graph.nodes.filter(n=>n.type==='FILTER').flatMap(n=>[n.config.minHistoryBars??0,...(n.config.conditions??[]).map(c=>c.lookback+1)]));
 check(flowWindowMs<=EVENT_PAPER_MARKET_LIMITS.maxFlowWindowMs&&lookback<=501,'EVENT_PAPER_MARKET_WINDOW','연속 모의운용의 체결 구간은 5분, 확정 봉은 501개까지 연결합니다.');
 const readReadiness=options.readReadiness??readUpbitTradingReadiness,readCandles=options.readCandles??readUpbitScalpingCandles,collect=options.collectEvents??collectUpbitScalpingEvents,sleep=options.sleep??sleepDefault;
 const rows=new Map(markets.map(m=>[m,{bars:[],candleRefs:[],events:[],book:null,rules:null,feeSnapshot:null,rulesIdentity:null,ruleRefs:[],lastRulesAt:null,lastCandleBoundary:null,overflowAt:null}]));
 let stream=null,started=false,stopped=false,startPromise=null,snapshotPromise=null,connectedSince=null,lastGapAt=null,failure=null,renewStream=false;
 const step=Number(timeframe.slice(0,-1))*60000,now=()=>iso(clock()),fail=(code,message)=>{failure={code,message,at:now()};};
 async function journal(record){await onRecord(clone(record));}
 async function receive(record){
  await journal(record);
  if(record.kind==='STREAM_CONNECTED')connectedSince=record.at;
  if(['STREAM_GAP','STREAM_ERROR'].includes(record.kind)){lastGapAt=record.at;connectedSince=null;}
  if(record.kind==='INVALID_EVENT')fail('EVENT_PAPER_INVALID_MARKET_EVENT','거래소 이벤트 원문을 확인하세요.');
  if(record.kind==='STREAM_STOP'&&!stopped){connectedSince=null;lastGapAt=record.completedAt??now();if(record.stopReason==='DURATION_COMPLETE')renewStream=true;else fail('EVENT_PAPER_STREAM_STOPPED','실시간 시세 연결을 다시 준비하세요.');}
  if(record.kind!=='MARKET_EVENT')return;
  const e=record.event,r=rows.get(e.market);check(r&&e.sourceHash===record.source.rawSha256&&time(e.eventTime)<=time(e.receivedAt)&&time(e.receivedAt)<=time(now()),'EVENT_PAPER_SOURCE_TIME','실제 종목·시장 시각·수신 시각을 대조하세요.');
  if(e.kind==='ORDER_BOOK'){if(!r.book||e.eventTime>r.book.eventTime||e.eventTime===r.book.eventTime&&e.receivedAt>r.book.receivedAt)r.book=clone(e);return;}
  r.events.push(clone(e));const cutoff=time(e.receivedAt)-flowWindowMs-1000;r.events=r.events.filter(t=>time(t.eventTime)>cutoff);
  if(r.events.length>EVENT_PAPER_MARKET_LIMITS.maxEventsPerMarket){r.overflowAt=e.receivedAt;r.events=r.events.slice(-EVENT_PAPER_MARKET_LIMITS.maxEventsPerMarket);}
 }
 async function refreshRules(market,budget){
  const result=await readReadiness({db:options.db,owner,env,market,budget,fetchImpl:options.fetchImpl,clock}),r=result.readiness;
  await journal({kind:'TRADING_RULES_CAPTURE',market,readiness:clone(r),rawSources:clone(result.rawSources??[])});
  check(r?.ready&&r.market===market&&r.fees&&r.rules?.tickSize&&r.rules.state==='active','EVENT_PAPER_TRADING_RULES','연결 계좌의 수수료와 해당 거래쌍의 주문 규칙을 확인하세요.');
  check(time(r.fees.observedAt)<=time(now())&&time(now())-time(r.fees.observedAt)<=EVENT_PAPER_MARKET_LIMITS.rulesRefreshMs&&/^[a-f0-9]{64}$/.test(r.fees.sourceHash??''),'EVENT_PAPER_TRADING_RULES_TIME','현재 확인한 수수료 원문이 필요합니다.');
  const row=rows.get(market),identity=hashInputPackage(economicRules(r));
  if(row.rulesIdentity&&row.rulesIdentity!==identity||config.marketRuleHashes?.[market]&&config.marketRuleHashes[market]!==identity){fail('EVENT_PAPER_RULES_CHANGED','수수료 또는 주문 규칙이 변경되었습니다. 모의운용을 다시 준비하세요.');throw Object.assign(new Error(failure.message),{code:failure.code,status:409});}
  row.rulesIdentity=identity;row.rules=clone(r.rules);row.feeSnapshot=clone(r.fees);row.lastRulesAt=r.asOf??now();row.ruleRefs=(result.rawSources??[]).map(s=>({id:s.id??'source:'+s.rawSha256,contentHash:s.rawSha256,sourceRef:s.sourceUrl}));
 }
 async function refreshCandles(market,budget,boundary){
  const result=await readCandles({market,timeframe,count:lookback,maxPages:3,budget,fetchImpl:options.fetchImpl,clock,sleep});
  await journal({kind:'CANDLE_CAPTURE',market,capture:clone(result)});
  check(result.market===market&&result.timeframe===timeframe&&Array.isArray(result.bars)&&time(result.availableAt)<=time(now()),'EVENT_PAPER_CANDLE_SOURCE','확정 분봉의 실제 수신 시각과 종목을 확인하세요.');
  const row=rows.get(market);row.bars=result.bars.filter(b=>b.isClosed!==false&&time(b.closeTime)<=time(result.availableAt)).map(b=>({...clone(b),availableAt:result.availableAt}));row.candleRefs=(result.rawSources??[]).map(s=>({id:s.id??'source:'+s.rawSha256,contentHash:s.rawSha256,sourceRef:s.sourceUrl}));row.lastCandleBoundary=boundary;
 }
 async function refresh(){
  const budget=createScalpingRequestBudget(80),boundary=iso(Math.floor(time(now())/step)*step);
  for(let i=0;i<markets.length;i++){
   const m=markets[i],r=rows.get(m);if(!r.lastRulesAt||time(now())-time(r.lastRulesAt)>=EVENT_PAPER_MARKET_LIMITS.rulesRefreshMs)await refreshRules(m,budget);
   if(r.lastCandleBoundary!==boundary)await refreshCandles(m,budget,boundary);
   if(i<markets.length-1)await sleep(180);
  }
 }
 function connectStream(){renewStream=false;stream=collect({markets,durationMs:EVENT_PAPER_MARKET_LIMITS.streamDurationMs,maxReconnects:2,WebSocketImpl:options.WebSocketImpl,clock,onRecord:receive});stream.done.catch(()=>fail('EVENT_PAPER_SOURCE_JOURNAL_FAILED','시장 원문 저장을 확인하세요.'));}
 async function start(){
  if(startPromise)return startPromise;
  check(!stopped,'EVENT_PAPER_SOURCE_STOPPED','중지한 시세 연결을 새로 준비하세요.');
  startPromise=(async()=>{started=true;connectStream();try{await refresh();}catch(error){await stop('PREPARE_FAILED');throw error;}return status();})();return startPromise;
 }
 async function snapshot({asOf}={}){
  if(snapshotPromise)return snapshotPromise;
  check(!asOf||Number.isFinite(time(asOf))&&time(asOf)<=time(now()),'EVENT_PAPER_SNAPSHOT_TIME','현재 확인 시각까지의 시장 자료를 사용하세요.');
  snapshotPromise=(async()=>{await start();check(!stopped,'EVENT_PAPER_SOURCE_STOPPED','시세 연결을 다시 준비하세요.');if(failure)throw Object.assign(new Error(failure.message),{code:failure.code,status:409});if(renewStream){await stream.done;connectStream();}await refresh();const at=now(),datasets=markets.map(m=>{
   const r=rows.get(m),flowReady=!!connectedSince&&time(at)-time(connectedSince)>=flowWindowMs&&(!r.overflowAt||time(at)-time(r.overflowAt)>=flowWindowMs),events=[...(flowReady?r.events.filter(e=>e.eventTime<=at&&e.receivedAt<=at&&time(e.eventTime)>time(at)-flowWindowMs):[]),...(r.book&&r.book.eventTime<=at&&r.book.receivedAt<=at?[r.book]:[])].sort((a,b)=>a.receivedAt.localeCompare(b.receivedAt)||a.id.localeCompare(b.id));
   const flowCoverage={status:flowReady?'OBSERVED_CONTINUOUS_WINDOW':'COLLECTING',windowMs:flowWindowMs,observedSince:connectedSince,lastGapAt,overflowAt:r.overflowAt,tradesUsed:events.filter(e=>e.kind==='TRADE').length},sourceRefs=[...r.candleRefs,...r.ruleRefs,...events.map(e=>({id:e.id,contentHash:e.sourceHash,sourceRef:'wss://api.upbit.com/websocket/v1'}))],body={contractVersion:EVENT_PAPER_MARKET_VERSION,id:'forward:'+m+':'+at,market:m,instrumentId:'crypto:upbit:'+m,timeframe,startAt:r.bars[0]?.openTime??at,endAt:at,availableAt:at,bars:clone(r.bars),events:clone(events),feeSnapshot:clone(r.feeSnapshot),rules:clone(r.rules),sourceRefs:sourceRefs.filter((r,i,a)=>a.findIndex(x=>x.id===r.id&&x.contentHash===r.contentHash)===i),flowCoverage,coverage:{closedBars:r.bars.length,lastClosedBarAt:r.bars.at(-1)?.closeTime??null,bookAt:r.book?.eventTime??null,flowReady}};return {...body,sourceHash:hashInputPackage(body)};
  });return {asOf:at,datasets,sourceEvents:[],coverage:{status:status().status,markets:datasets.map(d=>({market:d.market,...d.coverage})),liveOrders:0}};})();try{return await snapshotPromise;}finally{snapshotPromise=null;}
 }
 async function readBook(value){
  const args=typeof value==='string'?{instrumentId:value}:value??{},market=marketOf(args.instrumentId??args.market),after=args.after??iso(time(now())-3000),deadline=args.deadline??iso(time(now())+3000),finish=Math.min(time(deadline),time(now())+3000);check(rows.has(market)&&Number.isFinite(time(after))&&Number.isFinite(time(deadline)),'EVENT_PAPER_BOOK_SCOPE','실행 종목과 유효한 호가 대기 구간을 확인하세요.');
  for(let i=0;i<121;i++){
   if(stopped||failure)return null;const at=now(),book=rows.get(market).book;
   if(book&&book.eventTime>=after&&book.receivedAt>=after&&book.eventTime<=at&&book.receivedAt<=at&&book.receivedAt<deadline&&time(at)-time(book.eventTime)<=3000&&time(at)-time(book.receivedAt)<=3000)return clone(book);
   if(time(at)>=finish)return null;await sleep(25);
  }return null;
 }
 async function stop(reason='USER_PAUSE'){stopped=true;stream?.stop(reason);if(stream)await stream.done.catch(()=>{});return status();}
 function status(){return {contractVersion:EVENT_PAPER_MARKET_VERSION,status:failure?'ACTION_REQUIRED':stopped?'STOPPED':connectedSince?'RECORDING':started?'CONNECTING':'IDLE',markets:[...markets],timeframe,connectedSince,lastGapAt,failure:clone(failure),liveOrders:0};}
 return {start,snapshot,readBook,stop,status};
}
