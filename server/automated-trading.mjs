import {calendarPortfolioSelection} from '../dist/domain/adaptive-portfolio-graph.mjs';
import {programBinding,resolveProgramDeployment} from './strategy-program-deployment.mjs';
import {isRegimeProgramGraph} from '../dist/domain/regime-program-graph.mjs';
import {isHourlyScreenGraph,assertHourlyScreenGraph} from '../dist/domain/hourly-pullback.mjs';
import {isHourlyRegimeGraph,assertHourlyRegimeGraph} from '../dist/domain/hourly-regime.mjs';
import {isHourlyValueGraph,assertHourlyValueGraph} from '../dist/domain/hourly-value-graph.mjs';
import {isAdaptivePortfolioGraph,assertAdaptivePortfolioGraph,portfolioSourceSpec,isDailyPortfolioGraph,isSurgePortfolioGraph} from '../dist/domain/adaptive-portfolio-graph.mjs';
import {normalizeOperationWindow} from '../dist/domain/operation-window.mjs';
import {automationRoute,validAutomationInput,supportsLiveStrategyUpdate} from '../dist/system/automation-contracts.mjs';
import {WorkspaceRepository,readOperationalWorkspace} from './repository.mjs';
import {hashInputPackage} from '../dist/domain/workspace.mjs';
import {mindDocumentHash} from '../dist/domain/mind-manifest.mjs';
import {compileStrategyGraph,strategyGraphHash,graphRequiresJev} from '../dist/domain/strategy-graph.mjs';
import {readUpbitTradingReadiness} from './upbit-trading-readiness.mjs';
import {withUpbitReadConnection} from './broker-accounts.mjs';
import {captureUpbitPublic,normalizeUpbitScalpingEvent,scalpDecimal,UPBIT_SCALP_MAX_CLOCK_LEAD_MS} from './upbit-scalping-market.mjs';
import {testUpbitOrderPermission} from './upbit-order-adapter.mjs';
import {readLivePortfolio,prepareLivePortfolio,confirmLivePortfolio,prepareLiveAllocation,readLiveAllocation,confirmLiveAllocation,readLiveCapitalCapacity,updateLiveCapital,prepareLiveAutomation,confirmLiveAutomation,resumeFundingCash,resumeLiveAutomation,stopLiveAutomation,listLiveAutomations,getLiveAutomation,listLiveAutomationOrders,queueLiveStrategyUpdate} from './live-automation-store.mjs';
import {createManagedPortfolioGraph} from '../dist/domain/adaptive-portfolio-graph.mjs';
import {handleMindStudioAPI} from './mind-studio.mjs';
import {strategyPlanWithGraph} from '../dist/domain/mind-strategy-plan.mjs';
import {readLiveAutomationActivity} from './live-automation-read-model.mjs';
import {ensureActiveProfileActivationFence} from './investment-lifecycle-guard.mjs';
import {assertMultiAssetEventGraph} from '../dist/domain/multi-asset-event-runtime.mjs';
import {readBrokerageReports} from './brokerage-reports.mjs';
import {renderBrokerageReport,brokerageTradeCsv} from '../dist/ui/brokerage-report.mjs';

const BASE='/api/workspace/automated-trading',clone=structuredClone;
const json=(value,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store'}});
const check=(ok,code,message,status=409)=>{if(!ok)throw Object.assign(new Error(message),{code,status});};
const id=v=>typeof v==='string'&&/^[A-Za-z0-9_.:@-]{1,199}$/.test(v);
async function startApprovedLive(env,owner,ids){try{await env.START_APPROVED_LIVE?.(owner,ids);}catch{throw Object.assign(Error('승인 설정은 저장됐습니다. 같은 요청으로 운용 연결을 다시 시도하세요.'),{code:'APPROVED_RUNTIME_START_FAILED',status:503});}}
async function assertCurrentApprovalPermission(db,owner,env,options){const evidence=await (options.permissionEvidence??permissionEvidence)(db,owner,env);check(evidence.orderWritePermission==='VERIFIED'&&evidence.status==='PASSED'&&evidence.providerCode!=='bank_account_required','LIVE_ORDER_WRITE_PERMISSION','현재 계좌의 주문 권한과 연결 상태를 확인하세요.');}
async function notifyPreparedApproval(env,owner,preview,{name,profileId,allocation=false,manifest=null}){
 if(!env.APP_NOTIFY)return null;
 const amount=allocation?preview.total:preview.config.capitalLimit,currency=allocation?preview.quoteCurrency:preview.config.quoteCurrency;
 try{await env.APP_NOTIFY(owner,{id:'approval:'+preview.id,title:('운용 승인 · '+name).slice(0,200),body:(name+' · 총 '+amount+' '+currency+'. '+(allocation?'두 모델에 50%씩 배분합니다.':'1회 주문 한도 '+preview.config.perOrderLimit+' '+currency+'. ')+(preview.fundingPlan?'BTC '+preview.fundingPlan.volume+'개 매도 전환 포함(예상 '+preview.fundingPlan.expectedNetQuote+' '+currency+'). ':'')+'승인을 누르면 이 설정으로 자동 운용을 승인합니다.').slice(0,2000),status:'APPROVAL_READY',createdAt:preview.preparedAt,details:[{label:'대상',value:name},{label:'총 운용 금액',value:amount+' '+currency},{label:'승인 방식',value:'시간 만료 없이 유지 · 승인 시 현재 계좌와 모델 버전 확인'},...(isHourlyValueGraph(manifest?.data?.strategyPlan?.graph)?(manifest.data.profileSettings.evidencePreferences??[]).map((value,i)=>({label:'모델 근거 '+(i+1),value})):[])],approval:{kind:allocation?'LIVE_ALLOCATION':'LIVE_ACTIVATION',previewId:preview.id,previewHash:preview.previewHash,profileId}});return null;}catch{return '운용 준비는 저장됐습니다. 알림 연결을 다시 확인하세요.';}
}
const clocks=options=>()=>new Date(options.now?.()??Date.now()).toISOString();
const Q=10n**18n,d=v=>{const [a,b='']=scalpDecimal(v).split('.');check(/^\d+$/.test(a)&&b.length<=18,'AUTOMATION_AMOUNT','운용 금액을 확인하세요.');return BigInt(a)*Q+BigInt(b.padEnd(18,'0'));},out=n=>{const a=n/Q,b=(n%Q).toString().padStart(18,'0').replace(/0+$/,'');return String(a)+(b?'.'+b:'');};
export function eventAutomationScope(manifest){
 if(isAdaptivePortfolioGraph(manifest.data.strategyPlan.graph)){
  const graph=assertAdaptivePortfolioGraph(manifest.data.strategyPlan.graph),instrumentIds=[...manifest.data.universe.instrumentIds],marketIds=instrumentIds.map(v=>v.slice('crypto:upbit:'.length));
  check(instrumentIds.length>0&&instrumentIds.length<=500&&new Set(instrumentIds).size===instrumentIds.length&&instrumentIds.every(v=>/^crypto:upbit:KRW-[A-Z0-9]+$/.test(v)),'AUTOMATION_SCOPE','학습 배분의 원화 투자 범위를 확인하세요.');
  const spec=portfolioSourceSpec(graph);check((spec.sources??[spec]).every(s=>!s.instrumentId||instrumentIds.includes(s.instrumentId)),'AUTOMATION_UNIVERSE','연결한 종목을 승인 투자 범위에 포함하세요.');
  if(spec.timeframe==='1h')check(spec.historyBars<=1000,'AUTOMATION_HISTORY','실전 시간봉 공급의 최대 1000봉 안에서 학습 기간과 국면 기간을 설정하세요.');
  return {instrumentId:instrumentIds[0],market:marketIds[0],instrumentIds,marketIds,quoteCurrency:'KRW',timeframe:spec.timeframe,decisionIntervalMs:spec.stepMs};
 }
 if(isRegimeProgramGraph(manifest.data.strategyPlan.graph)){
  const instrumentIds=manifest.data.universe.instrumentIds;check(programBinding(manifest)&&instrumentIds.length>0&&instrumentIds.every(v=>/^crypto:upbit:(KRW|BTC)-[A-Z0-9]+$/.test(v)),'PROGRAM_SCOPE','라우터 운용의 승인 투자 범위를 확인하세요.');const marketIds=instrumentIds.map(v=>v.slice('crypto:upbit:'.length)),quoteCurrency=marketIds[0].split('-')[0];check(marketIds.every(m=>m.split('-')[0]===quoteCurrency),'PROGRAM_SCOPE','같은 결제 통화의 전략을 연결하세요.');return {instrumentIds,marketIds,instrumentId:instrumentIds[0],market:marketIds[0],quoteCurrency,timeframe:'1h'};
 }
 if(isHourlyScreenGraph(manifest.data.strategyPlan.graph)){
  assertHourlyScreenGraph(manifest.data.strategyPlan.graph);const instrumentIds=[...manifest.data.universe.instrumentIds],marketIds=instrumentIds.map(v=>v.slice('crypto:upbit:'.length));
  check(instrumentIds.length>=1&&instrumentIds.length<=10&&instrumentIds.length<=manifest.data.strategyPlan.graph.executionScope.maxCandidates&&new Set(instrumentIds).size===instrumentIds.length&&instrumentIds.every(v=>/^crypto:upbit:KRW-[A-Z0-9]+$/.test(v)),'AUTOMATION_SCOPE','시간봉 체결·호가 후보는 업비트 원화 1~10종목을 선택하세요.');
  return {instrumentId:instrumentIds[0],market:marketIds[0],instrumentIds,marketIds,quoteCurrency:'KRW',timeframe:'1h',decisionIntervalMs:3600000,universeHash:hashInputPackage([...instrumentIds].sort())};
 }
 if(isHourlyValueGraph(manifest.data.strategyPlan.graph)){
  assertHourlyValueGraph(manifest.data.strategyPlan.graph);const instrumentIds=[...manifest.data.universe.instrumentIds],marketIds=instrumentIds.map(v=>v.slice('crypto:upbit:'.length));
  check(instrumentIds.length>0&&instrumentIds.length<=500&&new Set(instrumentIds).size===instrumentIds.length&&instrumentIds.every(v=>/^crypto:upbit:KRW-[A-Z0-9]+$/.test(v)),'AUTOMATION_SCOPE','시간봉 행동가치 모델의 원화 투자 범위를 확인하세요.');
  return {instrumentId:instrumentIds[0],market:marketIds[0],instrumentIds,marketIds,quoteCurrency:'KRW',timeframe:'1h',decisionIntervalMs:3600000};
 }
 if(isHourlyRegimeGraph(manifest.data.strategyPlan.graph)){
  assertHourlyRegimeGraph(manifest.data.strategyPlan.graph);const instrumentIds=[...manifest.data.universe.instrumentIds],marketIds=instrumentIds.map(v=>v.slice('crypto:upbit:'.length));
  check(instrumentIds.length>0&&instrumentIds.length<=500&&new Set(instrumentIds).size===instrumentIds.length&&instrumentIds.every(v=>/^crypto:upbit:KRW-[A-Z0-9]+$/.test(v)),'AUTOMATION_SCOPE','시간봉 국면 전략의 원화 투자 범위를 확인하세요.');
  return {instrumentId:instrumentIds[0],market:marketIds[0],instrumentIds,marketIds,quoteCurrency:'KRW',timeframe:'1m',decisionIntervalMs:3600000};
 }
 const graph=manifest.data.strategyPlan.graph,universe=manifest.data.universe.instrumentIds,inputs=graph.nodes.filter(n=>n.type==='INPUT'&&n.config.kind==='MICROSTRUCTURE'),first=inputs[0]?.config,multi=graph.executionScope?.kind==='EACH_ASSET';
 check(first&&inputs.every(n=>n.config.instrumentId===first.instrumentId&&n.config.timeframe===first.timeframe),'AUTOMATION_SCOPE','체결·호가 입력의 실행 범위와 분봉을 맞추세요.');
 const instrumentIds=multi?[...universe]:[first.instrumentId];
 check(instrumentIds.length>0&&instrumentIds.length<=10&&new Set(instrumentIds).size===instrumentIds.length&&instrumentIds.every(v=>/^crypto:upbit:(KRW|BTC)-[A-Z0-9]+$/.test(v)),'AUTOMATION_SCOPE','업비트 거래쌍 1개에서 10개까지 운용할 수 있습니다.');
 const marketIds=instrumentIds.map(v=>v.slice('crypto:upbit:'.length)),quoteCurrency=marketIds[0].split('-')[0];
 check(marketIds.every(m=>m.split('-')[0]===quoteCurrency),'AUTOMATION_SCOPE','동일 결제 통화의 거래쌍을 선택하세요.');
 check(instrumentIds.every(v=>universe.includes(v)),'AUTOMATION_UNIVERSE','마인드의 투자 범위에 운용 종목을 추가하세요.');
 if(multi)assertMultiAssetEventGraph(graph,{datasets:instrumentIds.map(instrumentId=>({instrumentId,timeframe:first.timeframe})),instrumentIds});
 return {instrumentId:instrumentIds[0],market:marketIds[0],instrumentIds,marketIds,quoteCurrency,timeframe:first.timeframe,...(multi?{universeHash:hashInputPackage([...instrumentIds].sort())}:{})};
}
export async function automationManifest(owner,profileId,env,options={}){
 check(id(profileId),'AUTOMATION_MIND','운용할 마인드를 선택하세요.');
 const known=new Date(options.now?.()??Date.now()).toISOString(),w=options.workspace??await readOperationalWorkspace(options.repository??new WorkspaceRepository(env.DB),owner),manifest=(w?.mindManifests??[]).filter(m=>m.kind==='mind-policy'&&m.scope.profileId===profileId&&m.availableAt<=known&&(!options.manifestId||m.id===options.manifestId)).sort((a,b)=>b.data.version-a.data.version||b.availableAt.localeCompare(a.availableAt))[0];
 check(w?.investmentProfiles?.some(p=>p.id===profileId&&p.status!=='ARCHIVED'),'PROFILE_NOT_ACTIVE','보관함에서 마인드를 복구한 뒤 운용을 시작하세요.');
 check(manifest?.data.strategyPlan?.status==='APPROVED'&&manifest.data.strategyPlan.approval.enabled,'AUTOMATION_POLICY','노드 전략을 검토하고 발행하세요.');const graph=manifest.data.strategyPlan.graph;compileStrategyGraph(graph);
 const deployment=isRegimeProgramGraph(graph)?resolveProgramDeployment(manifest,w):null,scope=deployment?.scope??eventAutomationScope(manifest);
 if(deployment)check(hashInputPackage(scope.instrumentIds)===hashInputPackage(manifest.data.universe.instrumentIds)&&hashInputPackage(scope.instrumentIds)===hashInputPackage(manifest.scope.instrumentIds),'PROGRAM_UNIVERSE_PIN','라우터 구성원과 발행 정책의 전체 투자 범위를 맞추세요.');
 check(deployment||graph.nodes.some(n=>n.type==='ORDER'&&n.config.execution==='ACCOUNT')&&graph.triggers.includes('market_event'),'AUTOMATION_ORDER','계좌 주문 부품과 시장 이벤트 실행을 설정하세요.');
 return {manifest,graph,scope,...(deployment?{programDetails:deployment.details,requiresJev:deployment.requiresJev}:{}),pins:{manifestId:manifest.id,manifestHash:mindDocumentHash(manifest),graphHash:strategyGraphHash(graph)}};
}
export async function readAutomationBook(market,{fetchImpl=fetch,clock=()=>new Date().toISOString(),sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms))}={}){
 const r=await captureUpbitPublic('/v1/orderbook',{markets:market},{fetchImpl,clock}),row=r.body.find(v=>v.market===market);check(row,'AUTOMATION_BOOK','현재 호가를 확인하세요.');
 const raw=JSON.stringify({...row,type:'orderbook',code:market,level:0}),book=normalizeUpbitScalpingEvent(raw,{receivedAt:r.source.receivedAt,markets:[market]});
 // Wait out the normalizer's bounded clock lead; retain raw timestamps and strict execution freshness checks.
 const clockLead=Date.parse(book.eventTime)-Date.parse(clock());if(clockLead>0&&clockLead<=UPBIT_SCALP_MAX_CLOCK_LEAD_MS){await sleep(clockLead);const remaining=Date.parse(book.eventTime)-Date.parse(clock());if(remaining>0&&remaining<=clockLead)await sleep(remaining+1);}
 return {...book,availableAt:book.eventTime>book.receivedAt?book.eventTime:book.receivedAt,sourceHash:r.source.rawSha256,id:market+':rest:'+r.source.rawSha256,sourceUrl:r.source.sourceUrl,rawSource:r.source};
}
async function initEvidence(db){await db.prepare('CREATE TABLE IF NOT EXISTS live_order_permission_evidence(owner_id TEXT NOT NULL,credential_hash TEXT NOT NULL,payload TEXT NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(owner_id,credential_hash))').bind().run();}
async function credentialHash(db,owner,env){return withUpbitReadConnection({db,owner,env},c=>hashInputPackage({accessKey:c.accessKey}));}
async function permissionEvidence(db,owner,env){await initEvidence(db);const h=await credentialHash(db,owner,env),row=await db.prepare('SELECT payload FROM live_order_permission_evidence WHERE owner_id=? AND credential_hash=?').bind(owner,h).first();return row?JSON.parse(row.payload):{orderWritePermission:'REQUIRED',status:'NOT_CHECKED',code:'UPBIT_ORDER_WRITE_PERMISSION'};}
export const readAutomationPermission=({db,owner,env})=>permissionEvidence(db,owner,env);
async function runtimeSummaries(db,owner,env){
 const exists=await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='live_event_runtime'").bind().first();
 const persisted=exists?(await db.prepare('SELECT activation_id,updated_at,body FROM live_event_runtime WHERE owner_id=?').bind(owner).all()).results??[]:[];
 const current=typeof env.EVENT_AUTOMATION_STATUS==='function'?env.EVENT_AUTOMATION_STATUS():null,map=new Map();
 for(const row of persisted){const r=JSON.parse(row.body);map.set(row.activation_id,{...(r.program?{program:r.program}:{}),lastState:r.lastState,lastEvaluationAt:r.lastEvaluationAt,updatedAt:row.updated_at,providerState:r.providerUnknown?.status??(r.providerPending?'IN_FLIGHT':null),pendingDecision:r.pendingDecision?{snapshotAsOf:r.pendingDecision.snapshotAsOf,validUntil:r.pendingDecision.validUntil}:null});}
 for(const [id,r]of Object.entries(current?.policies??{})){const original=map.get(id)??{};map.set(id,{...original,...(r.program?{program:r.program}:{}),lastState:r.state,updatedAt:current.lastTickAt??original.updatedAt,lastError:r.code?{code:r.code}:null});}
 return map;
}
async function fundingFor(scope,{db,owner,env,options,clock,readiness}){
 if(scope.quoteCurrency!=='KRW'||d(readiness.account.available)>=d(readiness.rules.minBuyTotal))return null;
 const funding=(await (options.readiness??readUpbitTradingReadiness)({db,owner,env,market:'KRW-BTC',fetchImpl:options.fetchImpl,clock})).readiness;
 check(funding.ready,'AUTOMATION_FUNDING_READINESS','BTC 원화 전환 정보를 확인하세요.');if(d(funding.account.assetAvailable)===0n)return null;
 const book=await (options.readBook??readAutomationBook)('KRW-BTC',{fetchImpl:options.fetchImpl,clock});let remaining=d(funding.account.assetAvailable),gross=0n;
 for(const l of book.levels){const q=remaining<d(l.bidQuantity)?remaining:d(l.bidQuantity);gross+=q*d(l.bidPrice)/Q;remaining-=q;if(remaining===0n)break;}
 check(remaining===0n,'AUTOMATION_FUNDING_DEPTH','BTC 전환량에 충분한 호가를 확인하세요.');const fee=(gross*d(funding.fees.takerSellRate)+Q-1n)/Q;
 return {market:'KRW-BTC',side:'ask',ordType:'market',volume:funding.account.assetAvailable,expectedNetQuote:out(gross-fee),sourceHash:hashInputPackage({readiness:funding.sourceHash,book:book.sourceHash}),readiness:funding,book};
}
export async function handleAutomatedTradingAPI(request,env={},options={}){
 const u=new URL(request.url);if(!u.pathname.startsWith(BASE))return null;const action=automationRoute(request.method,u.pathname);
 const reply=(value,status=200)=>{const response=json(value,status);if(action){response.headers.set('X-CJI-Action-Id',action.id);response.headers.set('X-CJI-Action-Version',action.version);}return response;};
 const owner=request.headers.get('oai-authenticated-user-id'),clock=clocks(options);
 if(!owner)return reply({ok:false,code:'UNAUTHORIZED',message:'로그인이 필요합니다.'},401);
 if(request.headers.get('Origin')&&request.headers.get('Origin')!==u.origin||request.headers.get('Sec-Fetch-Site')==='cross-site')return reply({ok:false,code:'ORIGIN',message:'앱에서 다시 실행하세요.'},403);
 try{
  check(action,'AUTOMATION_ROUTE','운용 요청 경로를 확인하세요.',404);
  const db=env.DB,path=u.pathname.slice(BASE.length),profileId=u.searchParams.get('profileId');
  if(request.method==='GET')check(validAutomationInput(action,Object.fromEntries(u.searchParams)),'AUTOMATION_INPUT','조회 입력을 확인하세요.',400);
  if(request.method==='GET'&&path==='/reports')return reply({ok:true,...await readBrokerageReports({db,owner,reportId:u.searchParams.get('reportId'),activationId:u.searchParams.get('activationId')})});
  if(request.method==='GET'&&path==='/report-export'){
   const {report}=await readBrokerageReports({db,owner,reportId:u.searchParams.get('reportId')}),csv=u.searchParams.get('format')==='csv';
   return new Response(csv?brokerageTradeCsv(report):renderBrokerageReport(report),{headers:{'Content-Type':csv?'text/csv; charset=utf-8':'text/html; charset=utf-8','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; style-src 'self'; img-src 'self' data:; font-src 'self'; frame-ancestors 'none'",...(csv?{'Content-Disposition':'attachment; filename="'+report.id+'.csv"'}:{})}});
  }
  if(request.method==='GET'&&path==='/portfolio')return reply({ok:true,portfolioPlan:await readLivePortfolio({db,owner,previewId:u.searchParams.get('previewId')??undefined})});
  if(request.method==='GET'&&path==='/capital'){
   const activationId=u.searchParams.get('activationId'),policy=activationId?await getLiveAutomation({db,owner,activationId}):null,resolved=policy?{scope:{market:policy.config.marketIds[0],quoteCurrency:policy.config.quoteCurrency}}:await automationManifest(owner,profileId,env,options),r=(await (options.readiness??readUpbitTradingReadiness)({db,owner,env,market:resolved.scope.market,fetchImpl:options.fetchImpl,clock})).readiness;
   check(r.ready,'AUTOMATION_READINESS','현재 거래소 잔고를 확인하세요.');const funding=policy?null:await fundingFor(resolved.scope,{db,owner,env,options,clock,readiness:r});
   return reply({ok:true,policy,capital:await readLiveCapitalCapacity({db,owner,activationId,accountId:policy?.config.accountId??'upbit',quoteCurrency:resolved.scope.quoteCurrency,readiness:r,extraCash:policy?.status==='PAUSED'?resumeFundingCash(policy):funding?.expectedNetQuote??'0',now:clock()})});
  }
  if(request.method==='GET'&&path==='/strategy'){
   const policy=await getLiveAutomation({db,owner,activationId:u.searchParams.get('activationId')});
   const repository=options.repository??new WorkspaceRepository(db),manifest=options.workspace?.mindManifests?.find(m=>m.id===policy.config.manifestId)??await repository.readObject(owner,'mindManifests',policy.config.manifestId);
   check(manifest&&mindDocumentHash(manifest)===policy.config.manifestHash,'LIVE_PINNED_MANIFEST','운용 중인 전략 원본을 확인하세요.');
   const host=typeof env.EVENT_AUTOMATION_STATUS==='function'?env.EVENT_AUTOMATION_STATUS():null,supported=!host?.running||supportsLiveStrategyUpdate(host.contractVersion);
   return reply({ok:true,policy,manifest,strategyUpdates:{supported,perOrderLimit:supported,boundary:'NEXT_IDLE_TICK',preserves:['activation','positions','capital','orderHistory','dailyUsage']}});
  }
  if(request.method==='GET'&&path==='/activity')return reply({ok:true,...await readLiveAutomationActivity({db,owner,profileId,activationId:u.searchParams.get('activationId'),asOf:clock(),currentRuntime:typeof env.EVENT_AUTOMATION_STATUS==='function'?env.EVENT_AUTOMATION_STATUS():null})});
  if(request.method==='GET'&&path===''){
   const runtime=await runtimeSummaries(db,owner,env),policies=(await listLiveAutomations({db,owner})).map(p=>({...p,runtime:runtime.get(p.id)??null}));let resolved=null,scopeIssue=null,connection;
   try{if(profileId)resolved=await automationManifest(owner,profileId,env,options);}catch(error){scopeIssue={code:error.code??'AUTOMATION_POLICY',message:error.message};}
   try{connection=await (options.permissionEvidence??permissionEvidence)(db,owner,env);}catch{connection={orderWritePermission:'REQUIRED',status:'CONNECTION_REQUIRED'};}
   const sourcePolicy=policies.filter(p=>!profileId||p.config.profileId===profileId).sort((a,b)=>b.createdAt.localeCompare(a.createdAt))[0],allocationPlan=sourcePolicy?await readLiveAllocation({db,owner,sourceActivationId:sourcePolicy.id}):null;
   const host=typeof env.EVENT_AUTOMATION_STATUS==='function'?env.EVENT_AUTOMATION_STATUS():null;
   return reply({ok:true,allocationPlan,policies:policies.filter(p=>!profileId||p.config.profileId===profileId),scope:resolved?.scope??null,scopeIssue,programDetails:resolved?.programDetails??null,currentManifest:resolved?{id:resolved.manifest.id,version:resolved.manifest.data.version,...resolved.pins}:null,connection,strategyUpdates:{supported:!host?.running||supportsLiveStrategyUpdate(host.contractVersion),boundary:'NEXT_IDLE_TICK'},execution:'AUTOMATIC_AFTER_ACTIVATION'});
  }
  if(request.method==='GET'&&path==='/orders'){
   const activationId=u.searchParams.get('activationId');check(id(activationId),'AUTOMATION_ID','운용을 선택하세요.');const policy=await getLiveAutomation({db,owner,activationId});check(policy,'AUTOMATION_NOT_FOUND','저장된 운용을 찾을 수 없습니다.',404);return reply({ok:true,activationId,items:await listLiveAutomationOrders({db,owner,activationId,limit:100})});
  }
  check(action.api.method==='POST','AUTOMATION_ROUTE','운용 요청 경로를 확인하세요.',404);
  check(request.headers.get('Content-Type')?.startsWith('application/json'),'AUTOMATION_INPUT','운용 설정을 확인하세요.',400);const raw=await request.text();check(new TextEncoder().encode(raw).length<=(path==='/update-strategy'?200000:10000),'AUTOMATION_INPUT','운용 설정 범위를 줄이세요.',413);const body=JSON.parse(raw);
  check(validAutomationInput(action,body),path==='/update-strategy'?'LIVE_UPDATE_INPUT':'AUTOMATION_INPUT','운용 요청 입력을 확인하세요.',400);
  if(path==='/portfolio/prepare'){
   const current=await automationManifest(owner,body.profileId,env,options),policies=await listLiveAutomations({db,owner}),source=policies.find(p=>p.config.profileId===body.profileId&&p.status==='ENABLED');
   check(source,'LIVE_PORTFOLIO_SOURCE','통합 운용의 기준 마인드를 선택하세요.');
   const r=(await (options.readiness??readUpbitTradingReadiness)({db,owner,env,market:source.config.marketIds[0],fetchImpl:options.fetchImpl,clock})).readiness;
   const graph=createManagedPortfolioGraph({news:true,router:{costBps:Math.max(Number(r.fees.takerBuyRate),Number(r.fees.takerSellRate))*10000+10}});
   check(policies.filter(p=>p.status==='ENABLED'&&p.config.accountId===source.config.accountId&&p.config.quoteCurrency==='KRW').every(p=>p.config.marketIds.every(m=>current.scope.marketIds.includes(m))),'LIVE_PORTFOLIO_UNIVERSE','통합 마인드의 투자 범위에 기존 모든 운용 종목을 포함하세요.');
   const internal=async(path,payload)=>{const result=await handleMindStudioAPI(new Request(u.origin+path,{method:'POST',headers:{'Content-Type':'application/json','oai-authenticated-user-id':owner},body:JSON.stringify(payload)}),env,options),value=await result.json();check(result.ok,value.code??'LIVE_UPDATE_POLICY',value.message??'통합 전략 저장을 확인하세요.',result.status);return value;};
   const workspace=options.workspace??await (options.repository??new WorkspaceRepository(db)).read(owner),key='portfolio-'+crypto.randomUUID(),draft=await internal('/api/workspace/mind-documents/policy-draft',{mindId:body.profileId,sourceManifestId:current.manifest.id,expectedSourceManifestHash:current.pins.manifestHash,strategyPlanDraft:{preset:'BTC_SPOT_V1',enabled:true,strategyMaxExposure:1,graph},expectedRevision:workspace.revision,idempotencyKey:key+':draft'});
   const published=await internal('/api/workspace/mind-documents/publish',{documentId:draft.document.id,reason:'전체 계좌를 3시간 학습 포트폴리오로 통합합니다.',expectedRevision:draft.revision,idempotencyKey:key+':publish'}),manifest=published.manifest,scope=eventAutomationScope(manifest);
   const config={...source.config,manifestId:manifest.id,manifestHash:mindDocumentHash(manifest),graphHash:strategyGraphHash(graph),marketIds:scope.marketIds,requiresJev:false,maxJevCallsPerDay:0,dailyLossLimit:body.dailyLossLimit};
   const portfolioPlan=await prepareLivePortfolio({db,owner,target:{name:'통합 포트폴리오',config},readiness:r,orderWriteEvidence:await (options.permissionEvidence??permissionEvidence)(db,owner,env),now:clock()});
   return reply({ok:true,portfolioPlan,manifest});
  }
  if(path==='/portfolio/activate'){
   const plan=await getLiveAutomation({db,owner,previewId:body.previewId});check(plan.contractVersion==='LIVE_PORTFOLIO_PLAN_V2','LIVE_PORTFOLIO_PLAN','통합 운용 설정을 확인하세요.');
   const resolved=await automationManifest(owner,plan.target.config.profileId,env,{...options,manifestId:plan.target.config.manifestId}),r=(await (options.readiness??readUpbitTradingReadiness)({db,owner,env,market:resolved.scope.market,fetchImpl:options.fetchImpl,clock})).readiness;
   await assertCurrentApprovalPermission(db,owner,env,options);await ensureActiveProfileActivationFence(db,'LIVE');
   const policy=await confirmLivePortfolio({db,owner,...body,currentPins:resolved.pins,readiness:r,now:clock()});await startApprovedLive(env,owner,[policy.id]);return reply({ok:true,policy});
  }
  if(path==='/allocation/prepare'){
   const source=await getLiveAutomation({db,owner,activationId:body.sourceActivationId}),resolved=await Promise.all([body.leftProfileId,body.rightProfileId].map(profileId=>automationManifest(owner,profileId,env,options))),r=(await (options.readiness??readUpbitTradingReadiness)({db,owner,env,market:source.config.marketIds[0],fetchImpl:options.fetchImpl,clock})).readiness,evidence=await (options.permissionEvidence??permissionEvidence)(db,owner,env);
   const targets=resolved.map((x,i)=>({name:x.manifest.data.name,decisionIntervalMs:x.scope.decisionIntervalMs??Number(x.scope.timeframe.slice(0,-1))*60000,evidence:body.evidence?.[i===0?'left':'right']??null,config:{...x.pins,profileId:x.manifest.scope.profileId,marketIds:x.scope.marketIds,requiresJev:graphRequiresJev(x.graph),maxJevCallsPerDay:graphRequiresJev(x.graph)?source.config.maxJevCallsPerDay:0}}));
   const allocationPlan=await prepareLiveAllocation({db,owner,sourceActivationId:source.id,targets,readiness:r,orderWriteEvidence:evidence,now:clock()}),notificationWarning=await notifyPreparedApproval(env,owner,allocationPlan,{name:targets.map(t=>t.name).join(' + '),profileId:source.config.profileId,allocation:true});return reply({ok:true,allocationPlan,...(notificationWarning?{notificationWarning}:{})});
  }
  if(path==='/allocation/activate'){
   const plan=await getLiveAutomation({db,owner,previewId:body.previewId});check(plan?.contractVersion==='LIVE_ALLOCATION_PLAN_V1','LIVE_ALLOCATION_PLAN','검토할 배분안을 선택하세요.');const resolved=await Promise.all(plan.targets.map(t=>automationManifest(owner,t.config.profileId,env,options))),r=(await (options.readiness??readUpbitTradingReadiness)({db,owner,env,market:resolved[0].scope.market,fetchImpl:options.fetchImpl,clock})).readiness;
   await assertCurrentApprovalPermission(db,owner,env,options);await ensureActiveProfileActivationFence(db,'LIVE');const policies=await confirmLiveAllocation({db,owner,...body,currentPins:resolved.map(x=>x.pins),readiness:r,now:clock()});await startApprovedLive(env,owner,policies.map(p=>p.id));return reply({ok:true,policies});
  }
  if(path==='/capital'){

   const policy=await getLiveAutomation({db,owner,activationId:body.activationId}),r=(await (options.readiness??readUpbitTradingReadiness)({db,owner,env,market:policy.config.marketIds[0],fetchImpl:options.fetchImpl,clock})).readiness;
   const value=await updateLiveCapital({db,owner,...body,readiness:r,now:clock()});return reply({ok:true,...value,capital:await readLiveCapitalCapacity({db,owner,activationId:body.activationId,quoteCurrency:policy.config.quoteCurrency,readiness:r,now:clock()})});
  }
  if(path==='/update-strategy'){
   check(Object.keys(body).every(k=>['activationId','expectedGraphHash','graph','targetManifestId','targetManifestHash','perOrderLimit','maxJevCallsPerDay','expectedRevision','idempotencyKey','userAction'].includes(k))&&id(body.activationId)&&id(body.idempotencyKey)&&body.idempotencyKey.length<=120&&body.userAction==='LIVE_STRATEGY_UPDATE','LIVE_UPDATE_INPUT','운용 중 전략의 변경 내용을 확인하세요.',400);
   const policy=await getLiveAutomation({db,owner,activationId:body.activationId});check(policy.status==='ENABLED','LIVE_ACTIVATION_DISABLED','운용 중인 전략을 선택하세요.');
   const templateMode=Object.hasOwn(body,'targetManifestId');check(templateMode?!Object.hasOwn(body,'graph')&&id(body.targetManifestId)&&/^[a-f0-9]{64}$/.test(body.targetManifestHash??''):!Object.hasOwn(body,'targetManifestHash'),'LIVE_UPDATE_INPUT','노드 편집 또는 발행 모델 교체 중 하나를 선택하세요.',400);
   let template=null;if(templateMode){const w=options.workspace??await readOperationalWorkspace(options.repository??new WorkspaceRepository(db),owner),m=w.mindManifests.find(m=>m.id===body.targetManifestId);check(m,'POLICY_TEMPLATE_CHANGED','교체할 모델 원본을 확인하세요.');template=await automationManifest(owner,m.scope.profileId,env,{...options,manifestId:m.id});check(template.pins.manifestHash===body.targetManifestHash,'POLICY_TEMPLATE_CHANGED','교체할 모델 버전이 변경됐습니다.');}
   const graph=template?.graph??body.graph,templatePins=template?{manifestId:body.targetManifestId,manifestHash:body.targetManifestHash}:null,graphHash=strategyGraphHash(graph),requiresJev=graphRequiresJev(graph),budget=body.maxJevCallsPerDay??policy.config.maxJevCallsPerDay;
   check(Number.isSafeInteger(budget)&&budget>=0&&budget<=10000&&(!requiresJev||budget>0),'LIVE_CONFIG_JEV_BUDGET','AI 전략의 일 호출 한도를 입력하세요.');
   const perOrderLimit=body.perOrderLimit===undefined?policy.config.perOrderLimit:out(d(body.perOrderLimit));check(d(perOrderLimit)>0n&&d(perOrderLimit)<=d(policy.config.capitalLimit),'LIVE_CONFIG_LIMITS','1회 주문 한도를 총 배정액 안에서 입력하세요.',400);
   const updateId='strategy-update-'+body.idempotencyKey,prior=policy.pendingStrategyUpdate??policy.lastStrategyUpdate;
   if(prior?.id===updateId){check(prior.expectedGraphHash===body.expectedGraphHash&&prior.config.graphHash===graphHash&&prior.config.maxJevCallsPerDay===budget&&prior.config.perOrderLimit===perOrderLimit&&hashInputPackage(prior.templatePins??null)===hashInputPackage(templatePins),'LIVE_UPDATE_ID_REUSED','같은 변경 요청의 내용을 유지하세요.');return reply({ok:true,policy,update:prior});}
   check(policy.config.graphHash===body.expectedGraphHash,'LIVE_UPDATE_STALE','운용 전략이 바뀌었습니다. 최신 노드를 다시 여세요.');check(!policy.pendingStrategyUpdate,'LIVE_UPDATE_PENDING','저장한 전략이 반영된 뒤 다음 변경을 저장하세요.');
   check(!policy.funding||policy.funding.status==='FILLED','LIVE_UPDATE_FUNDING','초기 자금 전환이 끝난 뒤 전략을 변경하세요.');
   const host=typeof env.EVENT_AUTOMATION_STATUS==='function'?env.EVENT_AUTOMATION_STATUS():null;check(!host?.running||supportsLiveStrategyUpdate(host.contractVersion,{templateMode}),'LIVE_UPDATE_RUNTIME_VERSION','실행 서버를 최신 전략 변경 버전으로 갱신하세요.');
   const current=await automationManifest(owner,policy.config.profileId,env,{...options,manifestId:policy.config.manifestId});check(current.pins.manifestHash===policy.config.manifestHash&&current.pins.graphHash===policy.config.graphHash,'LIVE_PINNED_MANIFEST','운용 중인 전략 원본을 확인하세요.');const candidate=clone(current.manifest);candidate.data.strategyPlan=strategyPlanWithGraph(candidate.data.strategyPlan,graph);if(template)candidate.data.universe=clone(template.manifest.data.universe);candidate.data.universe.selection=calendarPortfolioSelection(graph,candidate.data.universe.selection,candidate.data.universe.instrumentIds.length);
   const scope=eventAutomationScope(candidate);check((templateMode?policy.config.marketIds.every(m=>scope.marketIds.includes(m)):hashInputPackage(scope.marketIds)===hashInputPackage(policy.config.marketIds))&&scope.quoteCurrency===policy.config.quoteCurrency&&(scope.timeframe===current.scope.timeframe||isDailyPortfolioGraph(graph)||isSurgePortfolioGraph(graph)),'LIVE_UPDATE_SCOPE','승인한 투자 범위와 결제 통화를 유지하고 지원하는 시세 주기를 연결하세요.');
   check(graph.nodes.some(n=>n.type==='ORDER'&&n.config.execution==='ACCOUNT'),'AUTOMATION_ORDER','계좌 주문 부품을 연결하세요.');
   const internal=async(path,payload)=>{const result=await handleMindStudioAPI(new Request(u.origin+path,{method:'POST',headers:{'Content-Type':'application/json','oai-authenticated-user-id':owner},body:JSON.stringify(payload)}),env,options),value=await result.json();check(result.ok,value.code??'LIVE_UPDATE_POLICY',value.message??'전략 정책 저장을 확인하세요.',result.status);return value;};
   const recovered=options.monthlyPortfolioRefresh?(await (options.repository??new WorkspaceRepository(db)).readOperational(owner)).mindManifests.find(m=>m.scope.profileId===policy.config.profileId&&strategyGraphHash(m.data.strategyPlan.graph)===graphHash&&hashInputPackage(m.data.universe.instrumentIds)===hashInputPackage(candidate.data.universe.instrumentIds)):null;
   let published;
   if(recovered)published={manifest:recovered};
   else{
    const draft=await internal('/api/workspace/mind-documents/policy-draft',{mindId:policy.config.profileId,sourceManifestId:policy.config.manifestId,expectedSourceManifestHash:policy.config.manifestHash,...(templateMode?{strategyTemplate:templatePins}:{strategyPlanDraft:{preset:'BTC_SPOT_V1',enabled:true,strategyMaxExposure:current.manifest.data.strategyPlan.allocation.strategyMaxExposure,graph}}),expectedRevision:body.expectedRevision,idempotencyKey:body.idempotencyKey+':draft'});
    published=await internal('/api/workspace/mind-documents/publish',{documentId:draft.document.id,reason:'운용 중 노드 편집의 저장 요청으로 전략 변경과 실행 반영을 요청합니다.',expectedRevision:draft.revision,idempotencyKey:body.idempotencyKey+':publish'});
   }
   const config={...policy.config,manifestId:published.manifest.id,manifestHash:mindDocumentHash(published.manifest),graphHash,requiresJev,perOrderLimit,maxJevCallsPerDay:budget,marketIds:scope.marketIds};
   const queued=await queueLiveStrategyUpdate({db,owner,activationId:policy.id,updateId,expectedGraphHash:body.expectedGraphHash,config,templatePins,refreshAuthorization:options.monthlyPortfolioRefresh??options.hourlyModelRefresh??null,now:clock()});
   return reply({ok:true,policy:queued,update:queued.pendingStrategyUpdate??queued.lastStrategyUpdate,manifest:published.manifest});
  }
  if(path==='/stop'){check(id(body.activationId),'AUTOMATION_ID','운용을 선택하세요.');return reply({ok:true,policy:await stopLiveAutomation({db,owner,activationId:body.activationId,now:clock()})});}
  if(path==='/resume'){
   const policy=await getLiveAutomation({db,owner,activationId:body.activationId});check(policy,'LIVE_ACTIVATION_NOT_FOUND','재개할 운용을 선택하세요.');
   const resolved=await automationManifest(owner,policy.config.profileId,env,{...options,manifestId:policy.config.manifestId});
   const market=policy.funding&&policy.funding.status!=='FILLED'?policy.funding.market:policy.config.marketIds[0],r=(await (options.readiness??readUpbitTradingReadiness)({db,owner,env,market,fetchImpl:options.fetchImpl,clock})).readiness;
   await assertCurrentApprovalPermission(db,owner,env,options);await ensureActiveProfileActivationFence(db,'LIVE');
   const value=await resumeLiveAutomation({db,owner,...body,currentPins:resolved.pins,readiness:r,now:clock()});if(value.policy.status==='ENABLED')await startApprovedLive(env,owner,[value.policy.id]);return reply({ok:true,...value});
  }
  if(path==='/permission-check'){
   check(/^(KRW|BTC)-[A-Z0-9]+$/.test(body.market??''),'AUTOMATION_MARKET','거래쌍을 선택하세요.');const r=(await (options.readiness??readUpbitTradingReadiness)({db,owner,env,market:body.market,fetchImpl:options.fetchImpl,clock})).readiness;check(r.ready,'AUTOMATION_READINESS','계좌 수수료·잔고를 확인하세요.');
   const fund=await fundingFor({quoteCurrency:body.market.split('-')[0]},{db,owner,env,options,clock,readiness:r}),intent=fund?{market:fund.market,side:'ask',ordType:'market',volume:fund.volume}:{market:body.market,side:'bid',ordType:'price',price:r.rules.minBuyTotal};
   const result=await (options.testPermission??testUpbitOrderPermission)({intent,credentialProvider:()=>withUpbitReadConnection({db,owner,env},clone),fetchImpl:options.fetchImpl,clock}),h=await credentialHash(db,owner,env);await initEvidence(db);await db.prepare('INSERT INTO live_order_permission_evidence(owner_id,credential_hash,payload,updated_at) VALUES(?,?,?,?) ON CONFLICT(owner_id,credential_hash) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at').bind(owner,h,JSON.stringify(result),clock()).run();return reply({ok:true,connection:result,liveOrders:0});
  }
  if(path==='/prepare'){
   const allowed=['profileId','capitalLimit','perOrderLimit','dailyLossLimit','maxTradesPerDay','minIntervalMs','maxJevCallsPerDay','startsAt','endsAt','idempotencyKey'];check(Object.keys(body).every(k=>allowed.includes(k)),'AUTOMATION_INPUT','운용 설정 항목을 확인하세요.',400);
   const resolved=await automationManifest(owner,body.profileId,env,options),r=(await (options.readiness??readUpbitTradingReadiness)({db,owner,env,market:resolved.scope.market,fetchImpl:options.fetchImpl,clock})).readiness;check(r.ready,'AUTOMATION_READINESS','계좌 수수료·잔고를 확인하세요.');
   const funding=await fundingFor(resolved.scope,{db,owner,env,options,clock,readiness:r}),evidence=await (options.permissionEvidence??permissionEvidence)(db,owner,env),config={accountId:'upbit',profileId:body.profileId,...resolved.pins,marketIds:resolved.scope.marketIds,quoteCurrency:resolved.scope.quoteCurrency,capitalLimit:body.capitalLimit,perOrderLimit:body.perOrderLimit,dailyLossLimit:body.dailyLossLimit,maxTradesPerDay:body.maxTradesPerDay,minIntervalMs:body.minIntervalMs,maxJevCallsPerDay:body.maxJevCallsPerDay??0,requiresJev:resolved.requiresJev??graphRequiresJev(resolved.graph),...normalizeOperationWindow(body,{now:clock()})};
   const fundingPlan=funding?Object.fromEntries(Object.entries(funding).filter(([k])=>!['book','readiness'].includes(k))):null;
   const blockedReasons=[];
   if(evidence.providerCode==='bank_account_required')blockedReasons.push({code:'UPBIT_BANK_ACCOUNT_REQUIRED',message:'업비트에서 원화 입출금 계좌 인증을 완료한 뒤 주문 권한을 다시 확인하세요.'});
   else if(evidence.orderWritePermission!=='VERIFIED'||evidence.status!=='PASSED')blockedReasons.push({code:'UPBIT_ORDER_WRITE_PERMISSION',message:'업비트 API에 주문하기 권한을 연결하고 권한을 확인하세요.'});
   const capital=await readLiveCapitalCapacity({db,owner,accountId:config.accountId,quoteCurrency:config.quoteCurrency,readiness:r,extraCash:funding?.expectedNetQuote??'0',now:clock()});
   if(d(config.capitalLimit)>d(capital.maximumCapital))blockedReasons.push({code:'AUTOMATION_CAPITAL',message:'다른 운용 배정액을 제외한 가용액은 '+capital.maximumCapital+' '+config.quoteCurrency+'입니다. 운용 금액을 조정하거나 기존 배정을 변경하세요.'});
   if(blockedReasons.length)return reply({ok:true,canActivate:false,preview:{id:null,previewHash:null,nonce:null,config,readiness:r,capital,fundingPlan,blockedReasons,programDetails:resolved.programDetails??null,expiresAt:null}});
   const preview=await prepareLiveAutomation({db,owner,config,readiness:funding?.readiness??r,orderWriteEvidence:evidence,fundingPlan,programDetails:resolved.programDetails??null,now:clock()}),notificationWarning=await notifyPreparedApproval(env,owner,preview,{name:resolved.manifest.data.name,profileId:config.profileId,manifest:resolved.manifest});return reply({ok:true,canActivate:true,preview:{...preview,readiness:r,capital,fundingPlan,programDetails:resolved.programDetails??null,blockedReasons:[]},...(notificationWarning?{notificationWarning}:{})});
  }
  check(path==='/activate','AUTOMATION_ROUTE','운용 요청 경로를 확인하세요.',404);
  check(body.userAction==='LIVE_AUTOMATION_ACTIVATION','AUTOMATION_USER_ACTIVATION','실전 자동 운용의 전략·금액·한도를 확인하세요.');
  // The confirmation handler resolves all pins and account data again on the server.
  const pending=await getLiveAutomation({db,owner,previewId:body.previewId});check(pending,'AUTOMATION_PREVIEW','운용 설정을 다시 검토하세요.');const resolved=await automationManifest(owner,pending.config.profileId,env,options),r=(await (options.readiness??readUpbitTradingReadiness)({db,owner,env,market:pending.fundingPlan?.market??resolved.scope.market,fetchImpl:options.fetchImpl,clock})).readiness;
  await assertCurrentApprovalPermission(db,owner,env,options);await ensureActiveProfileActivationFence(db,'LIVE');const policy=await confirmLiveAutomation({db,owner,previewId:body.previewId,previewHash:body.previewHash,nonce:body.nonce,userAction:body.userAction,currentPins:resolved.pins,readiness:r,now:clock()});await startApprovedLive(env,owner,[policy.id]);return reply({ok:true,policy});
 }catch(error){if(String(error.message).includes('PROFILE_NOT_ACTIVE'))return reply({ok:false,code:'PROFILE_NOT_ACTIVE',message:'보관함에서 마인드를 복구한 뒤 운용을 시작하세요.'},409);return reply({ok:false,code:error.code??'AUTOMATION_ERROR',message:error.code?error.message:'자동 운용 정보를 확인하세요.'},error.status??400);}
}
