import {createHash} from 'node:crypto';
import {createWorkspace,hashInputPackage,validateWorkspace} from '../dist/domain/workspace.mjs';
import {listInstruments,getInstrument} from '../dist/domain/instruments.mjs';
import {assertSectorSnapshot} from '../dist/domain/market-sectors.mjs';
import {marketKnowledgeHash} from '../dist/domain/market-knowledge.mjs';
import {buildJevQuestionRequest} from '../dist/domain/jev-question.mjs';
import {HOME_MARKET_CONTRACT,HOME_RECOMMENDATION_CONTRACT,HOME_RECOMMENDATION_DAYS,marketBarSummary,parseDailyIndexCsv,buildHomeRecommendationQuestions,projectHomeRecommendations,homeRecommendationView} from '../dist/domain/home-market.mjs';
import {WorkspaceRepository,readOperationalWorkspace,RepositoryError} from './repository.mjs';
import {acquireClaim,completeClaim,releaseClaim} from './claims.mjs';
import {loadInstrumentMarket} from './instrument-market.mjs';
import {universeSourceState} from './universe-workspace.mjs';
import {callJevQuestions} from './jev-question-provider.mjs';

const BASE='/api/workspace/home-market',DAY=86400000,clone=structuredClone;
const SOURCES=Object.freeze({vix:'https://cdn-api.cboe.com/api/global/us_indices/daily_prices/VIX_History.csv',sp500:'https://fred.stlouisfed.org/graph/fredgraph.csv?id=SP500',tickers:'https://www.okx.com/api/v5/market/tickers?instType=SPOT'});
const references={vix:'https://www.cboe.com/tradable_products/vix/vix_historical_data',sp500:'https://fred.stlouisfed.org/series/SP500',okx:'https://www.okx.com/docs-v5/en/#order-book-trading-market-data'};
const safeId=value=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:@-]{0,159}$/.test(value);
const fail=(code,message,status=400)=>{throw new RepositoryError(code,message,status);};
const check=(ok,code,message,status)=>{if(!ok)fail(code,message,status);};
const iso=value=>new Date(value).toISOString();
const nowOf=options=>()=>iso(typeof options.clock==='function'?options.clock():typeof options.now==='function'?options.now():options.now??Date.now());
const recordsOf=workspace=>workspace.homeMarketRecords??[];
const id=prefix=>prefix+'-'+crypto.randomUUID();
const json=(value,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store'}});
const hashText=value=>createHash('sha256').update(value,'utf8').digest('hex');

async function boundedText(response){
  const reader=response.body?.getReader();if(!reader){const value=await response.text();check(new TextEncoder().encode(value).length<=1500000,'HOME_SOURCE_SIZE','시장 자료의 응답 크기를 확인하세요.',502);return value;}
  const chunks=[];let size=0;try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;check(size<=1500000,'HOME_SOURCE_SIZE','시장 자료의 응답 크기를 확인하세요.',502);chunks.push(value);}}finally{reader.releaseLock();}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}return new TextDecoder().decode(bytes);
}
async function publicSource(url,fetchImpl,clock){
  const requestedAt=clock();let response;try{response=await fetchImpl(url,{redirect:'error',signal:AbortSignal.timeout(12000)});}catch{fail('HOME_SOURCE_UNAVAILABLE','시장 자료 제공처에 연결하지 못했습니다.',502);}
  check(response.ok,'HOME_SOURCE_HTTP_'+response.status,'시장 자료 조회를 완료하지 못했습니다. ('+response.status+')',response.status===429?429:502);
  const raw=await boundedText(response);return {url,requestedAt,receivedAt:clock(),raw,rawHash:hashText(raw),hashContract:'SHA256_UTF8_EXACT_RESPONSE_V1'};
}
function candidateUniverse(workspace,now){
  const latest=new Map();for(const manifest of workspace.mindManifests??[]){if(manifest.availableAt>now)continue;const key=manifest.scope.profileId,prior=latest.get(key);if(!prior||manifest.data.version>prior.data.version)latest.set(key,manifest);}
  const instruments=new Map();
  for(const manifest of latest.values())for(const instrumentId of manifest.data.universe.instrumentIds){try{const instrument=getInstrument(instrumentId,{resolution:manifest.data.universe.resolution});instruments.set(instrumentId,{...instrument,scopeRef:{manifestId:manifest.id,profileId:manifest.scope.profileId,universeHash:manifest.data.universe.resolution?.contentHash??null}});}catch{}}
  if(!latest.size)for(const instrument of listInstruments())instruments.set(instrument.id,{...instrument,scopeRef:{catalog:'REGISTERED_INSTRUMENT_CATALOG'}});
  const all=[...instruments.values()];return {instruments:all.slice(0,12),total:instruments.size,scopeHash:hashInputPackage(all.map(i=>({id:i.id,scopeRef:i.scopeRef}))),policy:'OWNER_PUBLISHED_UNIVERSE_UNION_CATALOG_ORDER_MAX12_V1'};
}
function recentNews(workspace,now){
  const cutoff=Date.parse(now)-14*DAY;
  return (workspace.marketKnowledge??[]).filter(entry=>{
    try{return entry.status==='APPROVED'&&entry.availableAt<=now&&entry.review?.reviewedAt<=now&&entry.classificationRecord?.provider?.answeredAt<=now&&entry.classificationRecord.contentHash===entry.contentHash&&marketKnowledgeHash(entry.document)===entry.contentHash&&entry.document.data.publication.publishedAt<=now&&Date.parse(entry.document.data.publication.publishedAt)>=cutoff&&entry.document.data.publication.retrievedAt<=now&&(!entry.document.data.validUntil||entry.document.data.validUntil>now);}catch{return false;}
  }).sort((a,b)=>b.document.data.publication.publishedAt.localeCompare(a.document.data.publication.publishedAt)).slice(0,30).map(entry=>({id:entry.id,title:entry.document.title,summary:entry.document.data.summary,sourceUrl:entry.document.source.uri,
    publishedAt:entry.document.data.publication.publishedAt,availableAt:entry.availableAt,contentHash:entry.contentHash,instrumentIds:entry.document.scope.instrumentIds,coverage:entry.document.data.coverage,classification:entry.classificationRecord.classification}));
}
const emptyMarket=()=>({status:'EMPTY',asOf:null,indicators:[],issues:[],sourceRefs:[]});
function publicMarket(snapshot,now){
  if(!snapshot)return emptyMarket();const view=clone(snapshot.market);
  for(const item of view.indicators){const age=Date.parse(now)-Date.parse(item.asOf);if(age>(item.precision==='DAY'?5*DAY:item.id==='BTC_REALIZED_VOL_7D'?14400000:300000))item.status='STALE';}
  if(view.indicators.some(item=>item.status!=='READY'))view.status='PARTIAL';
  return view;
}

/** Public observations only; no JEV calls or order execution. Exact used rows are retained. */
export async function collectHomeMarket(workspace,{env={},fetchImpl=fetch,marketLoader=loadInstrumentMarket,clock=()=>new Date().toISOString()}={}){
  const now=clock(),universe=candidateUniverse(workspace,now),news=recentNews(workspace,now),issues=[],indicators=[],captures=[],markets=[];
  const indexResults=await Promise.allSettled([publicSource(SOURCES.vix,fetchImpl,clock),publicSource(SOURCES.sp500,fetchImpl,clock),publicSource(SOURCES.tickers,fetchImpl,clock)]);
  for(const [index,result]of indexResults.entries()){
    const key=['vix','sp500','tickers'][index];if(result.status==='rejected'){issues.push({code:result.reason.code??'HOME_SOURCE_UNAVAILABLE',message:result.reason.message,sourceUrl:SOURCES[key]});continue;}
    const source=result.value;
    try{
      if(key==='tickers'){
        const raw=JSON.parse(source.raw);check(raw.code==='0'&&Array.isArray(raw.data),'HOME_TICKER_RESPONSE','공개 현재가 응답을 확인하세요.',502);
        const selected=raw.data.filter(row=>['BTC-USDT','ETH-USDT'].includes(row.instId));
        for(const symbol of ['BTC-USDT','ETH-USDT']){const row=selected.find(r=>r.instId===symbol),stamp=Number(row?.ts),last=Number(row?.last),open=Number(row?.open24h);check(row&&Number.isFinite(stamp)&&stamp<=Date.parse(source.receivedAt)&&Date.parse(source.receivedAt)-stamp<=300000&&last>0&&open>0,'HOME_TICKER_STALE','최근 현재가와 24시간 기준가를 확인하세요.',502);
          indicators.push({id:symbol.replace('-','_'),label:symbol.split('-')[0],value:last,unit:'USDT',changePct:(last/open-1)*100,asOf:iso(stamp),precision:'INSTANT',status:'READY',sourceUrl:SOURCES.tickers,documentationUrl:references.okx});}
        captures.push({...source,raw:JSON.stringify({code:raw.code,data:selected}),retention:'USED_ROWS_WITH_FULL_RESPONSE_HASH'});
      }else{
        const parsed=parseDailyIndexCsv(source.raw,{kind:key==='vix'?'VIX':'SP500',now:source.receivedAt}),{observations,retainedSource,...indicator}=parsed;
        indicators.push({...indicator,sourceUrl:source.url,documentationUrl:references[key]});captures.push({...source,raw:retainedSource,observations,retention:'USED_ROWS_WITH_FULL_RESPONSE_HASH'});
      }
    }catch(error){issues.push({code:error.code??'HOME_SOURCE_FORMAT',message:error.code?error.message:'시장 자료 형식을 확인하세요.',sourceUrl:source.url});}
  }
  const selected=[...universe.instruments];if(!selected.some(i=>i.id==='crypto:okx:BTC-USDT'))selected.unshift(getInstrument('crypto:okx:BTC-USDT'));
  for(let offset=0;offset<selected.length;offset+=3){
    const batch=selected.slice(offset,offset+3),results=await Promise.allSettled(batch.map(instrument=>marketLoader({instrumentId:instrument.id,timeframe:instrument.defaultTimeframe,limit:48,env,fetchImpl,now:clock})));
    for(const [i,result]of results.entries()){
      const instrument=batch[i];if(result.status==='rejected'){issues.push({code:result.reason.code??'HOME_CANDLES_UNAVAILABLE',message:'종목 시세를 준비하지 못했습니다.',instrumentId:instrument.id,sourceUrl:null});continue;}
      const market=result.value,summary=marketBarSummary(market),age=Date.parse(clock())-Date.parse(summary?.asOf);if(!summary||!Number.isFinite(age)||age<0||age>(instrument.assetClass==='crypto'?14400000:5*DAY)){issues.push({code:summary?'HOME_CANDLES_STALE':market.status??'HOME_CANDLES_UNAVAILABLE',message:'최근 종목 시세 자료가 필요합니다.',instrumentId:instrument.id,sourceUrl:market.source?.url??null});continue;}
      markets.push({instrumentId:instrument.id,summary,bars:clone(market.bars),source:clone(market.source)});
      if(instrument.id==='crypto:okx:BTC-USDT'&&summary.realizedVolatility7d!==null)indicators.push({id:'BTC_REALIZED_VOL_7D',label:'BTC 7일 실현 변동성',value:summary.realizedVolatility7d,unit:'PERCENT_ANNUALIZED',changePct:null,asOf:summary.asOf,precision:'INSTANT',status:'READY',sourceUrl:summary.source.url,method:'SAMPLE_STD_OF_42_FOUR_HOUR_LOG_RETURNS_ANNUALIZED_SQRT_2190_V1'});
    }
  }
  const candidates=universe.instruments.map(instrument=>{
    const market=markets.find(m=>m.instrumentId===instrument.id),related=news.filter(n=>n.instrumentIds.includes(instrument.id));
    return {kind:'instrument',id:instrument.id,instrumentId:instrument.id,name:instrument.name,symbol:instrument.symbol,marketCountry:instrument.marketCountry??(instrument.quoteCurrency==='KRW'?'KR':instrument.assetClass==='equity'?'US':null),
      eligible:!!market||related.length>0,scopeRef:instrument.scopeRef,market:market?.summary??null,sourceRefs:[...(market?[{kind:'candles',instrumentId:instrument.id,asOf:market.summary.asOf,hash:market.summary.source.barsSha256,url:market.summary.source.url}]:[]),...related.map(n=>({kind:'knowledge',id:n.id,hash:n.contentHash,url:n.sourceUrl}))]};
  });
  const sectorSnapshots=universeSourceState(workspace,now).sectorSnapshots.sort((a,b)=>b.availableAt.localeCompare(a.availableAt)),seen=new Set();
  for(const snapshot of sectorSnapshots){
    try{assertSectorSnapshot(snapshot);}catch{continue;}
    const rankOf=sector=>Math.min(...(snapshot.rankings??[]).filter(row=>row.sectorId===sector.id).map(row=>row.rank),1000);
    for(const sector of [...snapshot.sectors].sort((a,b)=>rankOf(a)-rankOf(b))){
      if(seen.has(sector.id))continue;seen.add(sector.id);
      const memberIds=new Set(snapshot.stockMemberships.filter(row=>row.sectorId===sector.id).map(row=>row.instrumentId));
      const members=candidates.filter(candidate=>candidate.kind==='instrument'&&memberIds.has(candidate.id)&&candidate.eligible);
      const related=news.filter(n=>n.coverage.sectors.includes(sector.id)||n.instrumentIds.some(instrumentId=>members.some(member=>member.id===instrumentId)));
      const rankingEvidence=(snapshot.rankings??[]).filter(row=>row.sectorId===sector.id&&row.availableAt<=now&&Date.parse(now)-Date.parse(row.availableAt)<=DAY);
      if(!related.length&&!members.some(member=>member.market)&&!rankingEvidence.length)continue;
      candidates.push({kind:'sector',id:sector.id,sectorId:sector.id,name:sector.name,eligible:true,
        membershipAsOf:snapshot.availableAt,membershipStatus:Date.parse(now)-Date.parse(snapshot.availableAt)>7*DAY?'STALE':'READY',
        memberEvidence:members.map(member=>({instrumentId:member.id,name:member.name,market:member.market})),rankingEvidence:rankingEvidence.map(row=>({...clone(row),changePct:Number(row.changeRate)*100,changeRateBasis:'DECIMAL_RATIO',durationBasis:'TRADING_DAYS',sourceAsOf:null,asOfKind:'RESPONSE_RECEIVED'})),coverage:rankingEvidence.length?'OFFICIAL_SECTOR_RANKINGS_AND_OWNER_ALLOWED_MEMBERS':'OWNER_ALLOWED_MEMBERS_WITH_OBSERVATIONS',
        sourceRefs:[{kind:'sector',id:snapshot.id,hash:snapshot.contentHash,asOf:snapshot.availableAt},...rankingEvidence.map(row=>{const capture=snapshot.captures.find(c=>c.id===row.sourceRef);return {kind:'sector-ranking',id:row.sourceRef,hash:capture.rawBodySha256,url:capture.url,asOf:row.availableAt,marketCountry:row.marketCountry,duration:row.duration,type:row.type};}),...members.flatMap(member=>member.sourceRefs.filter(ref=>ref.kind==='candles')),...related.map(n=>({kind:'knowledge',id:n.id,hash:n.contentHash,url:n.sourceUrl}))]});
      if(candidates.filter(c=>c.kind==='sector').length>=12)break;
    }
    if(candidates.filter(c=>c.kind==='sector').length>=12)break;
  }
  if(!sectorSnapshots.length)issues.push({code:'HOME_SECTOR_SOURCE_REQUIRED',message:'섹터 분류 자료를 연결하면 섹터 후보를 함께 비교할 수 있습니다.',sourceUrl:null});
  if(!news.length)issues.push({code:'HOME_RECENT_KNOWLEDGE_EMPTY',message:'최근 14일의 승인된 시장 자료가 없습니다.',sourceUrl:null});
  const sourceRefs=captures.map(c=>({url:c.url,requestedAt:c.requestedAt,receivedAt:c.receivedAt,rawHash:c.rawHash,retainedHash:hashText(c.raw),hashContract:c.hashContract}));
  const market={status:!indicators.length?'EMPTY':issues.length||indicators.some(i=>i.status!=='READY')?'PARTIAL':'READY',asOf:clock(),indicators,issues,sourceRefs};
  const record={id:id('home-market'),kind:'MARKET_SNAPSHOT',contractVersion:HOME_MARKET_CONTRACT,createdAt:clock(),market,candidates,news,universe:{policy:universe.policy,total:universe.total,selected:universe.instruments.length,scopeHash:universe.scopeHash},evidence:{captures,markets}};
  check(new TextEncoder().encode(JSON.stringify(record)).length<400000,'HOME_RECORD_SIZE','시장 자료의 보관 범위를 줄여 주세요.',413);
  return {...record,contentHash:hashInputPackage(record)};
}

function homeView(workspace,env,now){const records=recordsOf(workspace),snapshot=records.filter(r=>r.kind==='MARKET_SNAPSHOT').reverse().sort((a,b)=>b.createdAt.localeCompare(a.createdAt))[0],recommendation=homeRecommendationView(records,now),record=records.find(r=>r.id===recommendation.id);if(recommendation.status==='READY'&&record.scopeHash!==candidateUniverse(workspace,now).scopeHash){recommendation.status='STALE';recommendation.reason='UNIVERSE_CHANGED';}return {ok:true,revision:workspace.revision,market:publicMarket(snapshot,now),recommendation,connection:{jevConfigured:!!env.TYPESAFE_API_KEY},marketRecordId:snapshot?.id??null};}
async function save(repository,owner,previous,recordList,{key,fingerprint,result,now,fence=null}){
  const next=clone(previous);next.homeMarketRecords??=[];next.homeMarketRecords.push(...recordList);next.revision++;next.updatedAt=now;
  next.commandReceipts.push({id:id('receipt'),key,type:'home.market',fingerprint,revision:next.revision,createdAt:now,result:clone(result)});
  next.activityEvents.push({id:id('event'),eventType:'HOME_MARKET_UPDATED',resourceType:'home-market',resourceId:recordList.at(-1)?.id??'home',occurredAt:now,actorId:'workspace-owner',payload:{requestKey:key}});
  const errors=validateWorkspace(next);check(!errors.length,errors[0]?.code??'HOME_WORKSPACE',errors[0]?.message??'홈 자료 저장 형식을 확인하세요.');
  await repository.commit(owner,previous,next,key,fence);return next;
}

export async function handleHomeMarketAPI(request,env={},options={}){
  const url=new URL(request.url);if(![BASE,BASE+'/refresh',BASE+'/recommend',BASE+'/record'].includes(url.pathname))return null;
  let lease=null,db,owner,clock;
  try{
    owner=request.headers.get('oai-authenticated-user-id');check(owner,'UNAUTHORIZED','로그인이 필요합니다.',401);
    check((!request.headers.get('Origin')||request.headers.get('Origin')===url.origin)&&request.headers.get('Sec-Fetch-Site')!=='cross-site','ORIGIN','앱에서 다시 실행하세요.',403);
    clock=nowOf(options);db=env.DB?.withSession?env.DB.withSession('first-primary'):env.DB;const repository=options.repository??new WorkspaceRepository(db);
    let workspace=await readOperationalWorkspace(repository,owner,()=>createWorkspace({now:clock()}));
    if(request.method==='GET'){
      if(url.pathname===BASE+'/record'){check([...url.searchParams.keys()].every(k=>k==='id')&&safeId(url.searchParams.get('id')),'HOME_RECORD_ID','저장 자료를 선택하세요.');const record=recordsOf(workspace).find(r=>r.id===url.searchParams.get('id'));check(record,'HOME_RECORD_NOT_FOUND','저장 자료를 찾을 수 없습니다.',404);return json({ok:true,revision:workspace.revision,record});}
      check(url.pathname===BASE&&!url.search,'HOME_ROUTE','홈 조회 경로를 확인하세요.',404);return json(homeView(workspace,env,clock()));
    }
    check(request.method==='POST'&&[BASE+'/refresh',BASE+'/recommend'].includes(url.pathname)&&!url.search,'HOME_ROUTE','홈 실행 경로를 확인하세요.',404);
    check(request.headers.get('content-type')?.startsWith('application/json'),'HOME_JSON','JSON 요청을 사용하세요.');
    const text=await request.text();check(text.length<12000,'HOME_BODY_SIZE','요청 크기를 확인하세요.',413);let body;try{body=JSON.parse(text);}catch{fail('HOME_JSON','JSON 요청을 확인하세요.');}
    const recommendation=url.pathname.endsWith('/recommend'),allowed=recommendation?['expectedRevision','idempotencyKey','refresh','optInJev']:['expectedRevision','idempotencyKey'];
    check(body&&typeof body==='object'&&!Array.isArray(body)&&Object.keys(body).every(k=>allowed.includes(k))&&safeId(body.idempotencyKey)&&Number.isSafeInteger(body.expectedRevision)&&(body.refresh===undefined||typeof body.refresh==='boolean')&&(!recommendation||body.optInJev===true),'HOME_COMMAND','저장 버전·요청 키·추천 실행 동의를 확인하세요.');
    const fingerprint=hashInputPackage({path:url.pathname,refresh:body.refresh??false,optInJev:recommendation});await repository.hydrateReceiptKeys?.(owner,workspace,[body.idempotencyKey]);
    const receipt=workspace.commandReceipts.find(r=>r.key===body.idempotencyKey);if(receipt){check(receipt.type==='home.market'&&receipt.fingerprint===fingerprint,'IDEMPOTENCY_CONFLICT','같은 요청 키의 실행 내용이 변경되었습니다.',409);return json({...homeView(workspace,env,clock()),...receipt.result,idempotent:true});}
    check(workspace.revision===body.expectedRevision,'REVISION_CONFLICT','자료가 갱신되었습니다. 다시 조회하세요.',409);
    if(recommendation){
      check(homeRecommendationView(recordsOf(workspace),clock()).status!=='IN_PROGRESS','HOME_RECOMMENDATION_PENDING','진행 중인 추천 요청의 저장 기록을 확인하세요.',409);
      const scopeHash=candidateUniverse(workspace,clock()).scopeHash,latest=recordsOf(workspace).filter(r=>r.kind==='RECOMMENDATION_RESULT').reverse().sort((a,b)=>b.createdAt.localeCompare(a.createdAt))[0];
      if(latest?.status==='COMPLETED'&&latest.validUntil>clock()&&latest.scopeHash===scopeHash&&!body.refresh)return json({...homeView(workspace,env,clock()),cached:true});
      check(env.TYPESAFE_API_KEY,'JEV_CONNECTION_REQUIRED','JEV 연결을 설정하세요.',409);
    }
    lease=await acquireClaim(db,{ownerId:owner,resourceId:'home-market',key:body.idempotencyKey,fingerprint,baseRevision:workspace.revision,nowMs:Date.parse(clock()),leaseMs:120000});
    const snapshot=await collectHomeMarket(workspace,{env,fetchImpl:options.fetchImpl??fetch,marketLoader:options.marketLoader??loadInstrumentMarket,clock});
    const fence=()=>({resourceId:'home-market',token:lease.token,nowMs:Date.parse(clock())});
    if(!recommendation){workspace=await save(repository,owner,workspace,[snapshot],{key:body.idempotencyKey,fingerprint,result:{recordId:snapshot.id},now:clock(),fence:fence()});await completeClaim(db,{ownerId:owner,resourceId:'home-market',token:lease.token,nowMs:Date.parse(clock())});lease=null;return json(homeView(workspace,env,clock()));}
    const input=buildHomeRecommendationQuestions({market:snapshot.market,candidates:snapshot.candidates,news:snapshot.news,now:clock()}),rawRequest=buildJevQuestionRequest(input);
    const reservation={id:id('home-request'),kind:'RECOMMENDATION_REQUEST',contractVersion:HOME_RECOMMENDATION_CONTRACT,createdAt:clock(),marketRecordId:snapshot.id,marketHash:snapshot.contentHash,status:'STARTED',requestKey:body.idempotencyKey,rawRequest,rawRequestHash:hashText(JSON.stringify(rawRequest)),hashContract:'SHA256_UTF8_EXACT_REQUEST_V1',candidateBindings:input.candidateBindings};
    workspace=await save(repository,owner,workspace,[snapshot,reservation],{key:body.idempotencyKey+':reserve',fingerprint,result:{recordId:reservation.id},now:clock(),fence:fence()});
    let result,error=null;
    try{result=await callJevQuestions({...input,env,fetchImpl:options.fetchImpl??fetch,clock});}catch(cause){error=cause;}
    const finished=clock(),record={id:id('home-recommendation'),kind:'RECOMMENDATION_RESULT',contractVersion:HOME_RECOMMENDATION_CONTRACT,requestId:reservation.id,marketRecordId:snapshot.id,marketHash:snapshot.contentHash,scopeHash:snapshot.universe.scopeHash,marketAsOf:snapshot.market.asOf,createdAt:finished,status:error?'FAILED':'COMPLETED',validUntil:error?null:iso(Date.parse(finished)+HOME_RECOMMENDATION_DAYS*DAY),items:error?[]:projectHomeRecommendations(input,result),provider:clone((error??result).provider??null),
      rawRequest:clone((error??result).rawRequest??rawRequest),rawResponse:clone((error??result).rawResponse??null),rawResponseText:(error??result).rawResponseText??null,rawRequestHash:(error??result).rawRequestHash??reservation.rawRequestHash,rawResponseHash:(error??result).rawResponseHash??null,receivedResponseHash:(error??result).receivedResponseHash??null,hashContract:(error??result).hashContract??'SHA256_UTF8_EXACT_REQUEST_V1',...(error?{error:{code:error.code??'HOME_RECOMMENDATION_FAILED',message:error.message}}:{})};
    record.contentHash=hashInputPackage(record);
    for(let attempt=0;attempt<3;attempt++){const current=await readOperationalWorkspace(repository,owner);try{workspace=await save(repository,owner,current,[record],{key:body.idempotencyKey,fingerprint,result:{recordId:record.id,...(error?{failed:true}:{})},now:clock(),fence:fence()});break;}catch(cause){if(cause.code!=='REVISION_CONFLICT'||attempt===2)throw cause;}}
    await completeClaim(db,{ownerId:owner,resourceId:'home-market',token:lease.token,nowMs:Date.parse(clock())});lease=null;
    return json({...homeView(workspace,env,clock()),recordId:record.id});
  }catch(error){return json({ok:false,code:error.code??'HOME_MARKET_FAILED',message:error.code?error.message:'홈 시장 자료를 처리하지 못했습니다.'},error.status??500);}
  finally{if(lease&&db&&owner)await releaseClaim(db,{ownerId:owner,resourceId:'home-market',token:lease.token,nowMs:Date.parse(clock()),status:'FAILED'}).catch(()=>{});}
}
