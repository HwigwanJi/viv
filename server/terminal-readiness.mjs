import {RepositoryError} from './repository.mjs';
import {assertMindInputContext,buildMindJevRequest} from './mind-engine.mjs';
import {mindDocumentHash} from '../dist/domain/mind-manifest.mjs';
import {isMindStrategyPlanActive} from '../dist/domain/mind-strategy-plan.mjs';
import {hashInputPackage} from '../dist/domain/workspace.mjs';
import {selectMarketKnowledge} from '../dist/domain/market-knowledge.mjs';
import {getInstrument} from '../dist/domain/instruments.mjs';
import {graphRequiresJev} from '../dist/domain/strategy-graph.mjs';
import {computeMindStrategyFeatures} from './mind-strategy-features.mjs';
import {mindPaperPortfolioState} from '../dist/domain/mind-paper.mjs';

const list=value=>Array.isArray(value)?value:[];
const action=(name,label,target=null,params={},retryPolicy='AFTER_CORRECTION',nextEligibleAt=null)=>({action:name,label,target,params,retryPolicy,nextEligibleAt});
const issue=(code,category,message,recovery,status=409,extra={})=>({code,category,message,status,action:recovery,...extra});
const currentCaptureCodes=new Set(['MARKET_CAPTURE_REQUIRED','CANONICAL_CAPTURE_REQUIRED','CANONICAL_CAPTURE_STALE','CANONICAL_CAPTURE_BOUNDARY','MIND_MARKET_BOUNDARY_CHANGED','MIND_CANONICAL_SOURCE']);
const millis=value=>Number.isFinite(Date.parse(value))?Date.parse(value):null;

/** Both render-time and execution-time projections use the original approved inputs. */
export function mindEvaluationIdentity(workspace,manifest,instrument,market,timeframe,now){
 const plan=manifest.data.strategyPlan,scopeIds=new Set([instrument.id]);
 if(plan?.graph?.schemaVersion===2&&isMindStrategyPlanActive(plan,now))for(const node of plan.graph.nodes)if(node.type==='INPUT'&&manifest.data.universe.instrumentIds.includes(node.config.instrumentId))scopeIds.add(node.config.instrumentId);
 const approved=list(workspace.mindDocuments).filter(d=>d.status==='APPROVED'&&d.document.scope.profileId===manifest.scope.profileId&&(!d.document.scope.instrumentIds.length||d.document.scope.instrumentIds.some(id=>scopeIds.has(id)))&&d.document.availableAt<=now);
 const librarySelection=selectMarketKnowledge(workspace.marketKnowledge,manifest,instrument,now);
 const contextVersionHash=hashInputPackage({documents:approved.map(d=>({id:d.id,hash:mindDocumentHash(d.document)})).sort((a,b)=>a.id.localeCompare(b.id)),marketKnowledge:librarySelection.transmittedSourceRefs});
 return {approved,contextVersionHash,key:hashInputPackage({manifestHash:mindDocumentHash(manifest),contextVersionHash,instrumentId:instrument.id,asOf:market?.bars?.at(-1)?.closeTime,timeframe})};
}

function retryTime(value,now){
 if(value===null||value===undefined||value==='')return null;
 const seconds=Number(value),stamp=Number.isFinite(seconds)&&seconds>=0?Date.parse(now)+seconds*1000:Date.parse(value);
 return Number.isFinite(stamp)&&stamp>Date.parse(now)?new Date(stamp).toISOString():null;
}

/** Recovery is explicit: a failed read can be retried; an uncertain paid attempt is inspected. */
export function terminalErrorRecovery(error={}, {instrumentId=null,timeframe=null,profileId=null,now=new Date().toISOString()}={}){
 const code=error.code??'MARKET_UNAVAILABLE',diagnostic=error.diagnostic??{},params={instrumentId,timeframe};
 const requestId=error.provider?.requestId??null,providerRequestId=error.provider?.providerRequestId??diagnostic.cfRay??null;
 const extra={requestId,providerRequestId};
 if(code==='MIND_ARCHIVED')return issue(code,'ARCHIVED','보관한 마인드입니다.',action('archive','보관함에서 복구','#minds?profileId=all&mindStatus=archived',{...params,profileId}),409,extra);
 if(currentCaptureCodes.has(code))return issue(code,'DATA_REQUIRED','최신 시세가 필요합니다.',action('data','시세 수집','#settings?view=data',params),503,extra);
 if(code==='UNSUPPORTED_TIMEFRAME'||code==='CANONICAL_TIMEFRAME_UNAVAILABLE')return issue(code,'PARAMETER','지원하는 차트 주기를 선택하세요.',action('timeframe','지원 주기 선택',null,params),400,extra);
 if(['CONNECT_REQUIRED','PROVIDER_CONNECTION_REQUIRED','JEV_CONNECTION_REQUIRED'].includes(code)||diagnostic.httpStatus===401||diagnostic.httpStatus===403)return issue(code,'CONNECTION',code==='JEV_CONNECTION_REQUIRED'?'JEV 연결이 필요합니다.':instrumentId?.startsWith('equity:')?'주식 시세 연결이 필요합니다.':'시세 연결이 필요합니다.',action('connections','연결 설정','#settings?view=connections',params),503,extra);
 const nextEligibleAt=retryTime(diagnostic.retryAfter,now);
 if(diagnostic.httpStatus===429)return issue(code,'RATE_LIMIT','시세 제공처의 호출 대기 시간입니다.',action(nextEligibleAt?'wait':'refresh',nextEligibleAt?'다음 조회 대기':'다시 조회',null,params,'READ_ONLY_RETRY',nextEligibleAt),429,{...extra,nextEligibleAt});
 if(error.provider||code.startsWith('MIND_JEV_'))return issue(code,'PROVIDER_RESULT','결정 요청 기록을 확인하세요.',action('records','요청 기록 확인','#minds?view=records',params,'INSPECT_EXISTING_ATTEMPT'),502,extra);
 return issue(code,'MARKET_READ','시세를 불러오지 못했습니다.',action('refresh','다시 조회',null,params,'READ_ONLY_RETRY'),503,extra);
}

export function buildTerminalReadiness({workspace={},manifest=null,instrument,market=null,timeframe=instrument?.defaultTimeframe,mode='live',executionMode='paper',env={},now=new Date().toISOString(),phase='view',executionKey=null,expectedPolicyHash=null,expectedMarketAsOf=null}={}){
 const params={instrumentId:instrument?.id??null,timeframe},blockers=[];
 const marketCode=market?.errorCode??list(market?.warnings).find(w=>w&&typeof w==='object'&&w.code)?.code??market?.status;
 let marketIssue=null;
 if(market&&market.status!=='READY')marketIssue=terminalErrorRecovery({code:marketCode,diagnostic:market.diagnostic},{...params,now});
 const supported=list(market?.connection?.supportedTimeframes??instrument?.timeframes);
 if(!marketIssue&&supported.length&&!supported.includes(timeframe))marketIssue=terminalErrorRecovery({code:'UNSUPPORTED_TIMEFRAME'},{...params,now});
 const marketRecovery={status:marketIssue?'ACTION_REQUIRED':market?'READY':'NOT_CHECKED',issue:marketIssue,action:marketIssue?.action??null,supportedTimeframes:supported,asOf:market?.bars?.at(-1)?.closeTime??null};
 const add=(code,category,message,recovery,status=409,extra={})=>blockers.push(issue(code,category,message,recovery,status,extra));
 const profileId=manifest?.scope.profileId??null;
 if(list(workspace.investmentProfiles).find(profile=>profile.id===profileId)?.status==='ARCHIVED')blockers.push(terminalErrorRecovery({code:'MIND_ARCHIVED'},{...params,profileId,now}));
 if(mode==='replay')add('REPLAY_READ_ONLY','MODE','저장된 시세와 거래를 조회하고 있습니다.',action('refresh','현재 시세 보기',null,{...params,mode:'live'}));
 if(executionMode==='live')add('LIVE_READ_ONLY','MODE','실전 계좌는 조회 모드입니다.',action('paper','모의 투자로 전환',null,{...params,executionMode:'paper'}));
 if(!manifest)add('MIND_REQUIRED','SELECTION','결정을 실행할 마인드를 선택하세요.',action('choose-mind','마인드 선택'));
 const account=list(workspace.mindPositions).find(a=>a.kind==='PAPER_ACCOUNT'&&a.profileId===profileId&&a.quoteCurrency===instrument?.quoteCurrency)??null;
 const accountState={status:account?'READY':'REQUIRED',accountId:account?.id??null,quoteCurrency:instrument?.quoteCurrency??null,availableCurrencies:[...new Set(list(workspace.mindPositions).filter(a=>a.kind==='PAPER_ACCOUNT'&&a.profileId===profileId).map(a=>a.quoteCurrency))]};
 let identity=null;
 if(manifest){
  if(expectedPolicyHash&&expectedPolicyHash!==mindDocumentHash(manifest))add('TERMINAL_POLICY_CHANGED','VIEW_CHANGED','마인드 설정이 갱신되었습니다. 현재 설정을 확인하세요.',action('refresh','현재 설정 확인',null,params,'READ_ONLY_RETRY'));
  if(expectedMarketAsOf&&market?.status==='READY'&&expectedMarketAsOf!==market.bars?.at(-1)?.closeTime)add('TERMINAL_MARKET_CHANGED','VIEW_CHANGED','새 봉이 확정되었습니다. 최신 차트를 확인하세요.',action('refresh','최신 차트 확인',null,params,'READ_ONLY_RETRY'));
  if(!manifest.data.universe.instrumentIds.includes(instrument?.id))add('INSTRUMENT_OUTSIDE_MIND_SCOPE','SCOPE','마인드의 투자 범위에서 종목을 선택하세요.',action('profile','투자 범위 보기','#minds?profileId='+encodeURIComponent(profileId)+'&view=operations',params),403);
  const plan=manifest.data.strategyPlan;
  if(isMindStrategyPlanActive(plan,now)&&plan.scope.universe==='MIND_UNIVERSE'){
   add('PORTFOLIO_SIMULATION_SCOPE','SCOPE','BTC 다종목 전략은 실험실에서 비교합니다.',action('profile','실험실 열기','#minds?profileId='+encodeURIComponent(profileId)+'&view=simulations&lab=compare',params),409,{strategyScope:structuredClone(plan.scope)});
  }else if(isMindStrategyPlanActive(plan,now)&&((plan.scope.instrumentId!==instrument?.id&&plan.scope.instrumentPolicy!=='UNIVERSE_CURRENT')||plan.scope.timeframe!==timeframe)){
   const symbol=getInstrument(plan.scope.instrumentId).symbol,interval=({'1h':'1시간봉','4h':'4시간봉','1d':'일봉'})[plan.scope.timeframe],destination=symbol+' · '+interval;
   add('STRATEGY_PLAN_SCOPE','SCOPE','이 전략은 '+destination+'에서 실행합니다.',action('timeframe',symbol+' '+interval+'으로 이동',null,{instrumentId:plan.scope.instrumentId,timeframe:plan.scope.timeframe}),409,{strategyScope:structuredClone(plan.scope)});
  }
  if(executionMode==='paper'&&!account)add('PAPER_ACCOUNT_REQUIRED','ACCOUNT',instrument.quoteCurrency+' 모의 자금을 설정하세요.',action('account','모의 자금 설정',null,{profileId,quoteCurrency:instrument.quoteCurrency}),409);
  if(marketIssue)blockers.push(marketIssue);
  if(market?.status==='READY'){
   if(list(market.bars).length<manifest.data.universe.selection.minHistoryBars)add('MARKET_HISTORY_REQUIRED','DATA_REQUIRED','결정에 필요한 시세 구간을 준비하세요.',action(instrument.id==='crypto:okx:BTC-USDT'?'data':'refresh','시세 준비',instrument.id==='crypto:okx:BTC-USDT'?'#settings?view=data':null,params,'READ_ONLY_RETRY'),503,{availableBars:list(market.bars).length,requiredBars:manifest.data.universe.selection.minHistoryBars});
   if(!blockers.length){
    try{
     identity=mindEvaluationIdentity(workspace,manifest,instrument,market,timeframe,now);
     const contexts=identity.approved.filter(d=>d.document.kind==='market-context'),memories=[...manifest.data.approvedMemory,...identity.approved.filter(d=>['trade-review','principle-evidence'].includes(d.document.kind))];
     if(plan?.graph?.schemaVersion===2&&isMindStrategyPlanActive(plan,now)){
      const capture=list(workspace.marketSnapshots).find(value=>value.id===market.source?.marketDataRef);
      const {evaluation}=computeMindStrategyFeatures({manifest,market,capture,account,contexts,memories,knowledge:workspace.marketKnowledge,now});
      if(evaluation.graphEvaluation.output.status==='BLOCKED')throw new RepositoryError('GRAPH_INPUTS_REQUIRED','그래프에 필요한 승인 자료와 시세를 준비하세요.',503);
      buildMindJevRequest(manifest,market,{portfolio:account?mindPaperPortfolioState(account,instrument.id):null,contexts,memories,knowledge:workspace.marketKnowledge,strategyEvaluation:evaluation,now});
     }else assertMindInputContext({manifest,market,contexts,memories,knowledge:workspace.marketKnowledge,now,phase:'prepare'});
    }catch(error){
     const recovery=terminalErrorRecovery(error,{...params,now});
     if(['MIND_REQUIRED_INPUTS_UNAVAILABLE','GRAPH_INPUTS_REQUIRED'].includes(error.code))Object.assign(recovery,{category:'KNOWLEDGE',message:'마인드에 필요한 자료를 준비하세요.',action:action('knowledge','자료 확인','#minds?profileId='+encodeURIComponent(profileId)+'&view=knowledge',params)});
     blockers.push({...recovery,code:error.code??recovery.code,blockedInputs:error.blockedInputs??null});
    }
   }
  }
  const last=list(workspace.mindRuns).filter(r=>r.profileId===profileId).at(-1),nextEligibleMs=last&&millis(last.createdAt)!==null?millis(last.createdAt)+manifest.data.trigger.cooldownMs:null;
  if(nextEligibleMs!==null&&Date.parse(now)<nextEligibleMs){const at=new Date(nextEligibleMs).toISOString();add('MIND_COOLDOWN','COOLDOWN','다음 결정 시각을 기다리고 있습니다.',action('wait','다음 결정 대기',null,params,'AFTER_WAIT',at),429,{nextEligibleAt:at});}
  const duplicate=!executionKey&&identity?list(workspace.mindRuns).find(r=>r.executionKey===identity.key):null;
  if(duplicate)add('CANDLE_ALREADY_EVALUATED','EXISTING_RESULT','현재 봉의 결정이 저장되어 있습니다.',action('records','저장된 결정 보기',null,{runId:duplicate.id,profileId}),409,{runId:duplicate.id});
  const needsJev=plan?.graph?.schemaVersion===2&&isMindStrategyPlanActive(plan,now)?graphRequiresJev(plan.graph):true;
  if(needsJev&&(typeof env.TYPESAFE_API_KEY!=='string'||!env.TYPESAFE_API_KEY.trim()))add('JEV_CONNECTION_REQUIRED','CONNECTION','JEV 연결을 설정하세요.',action('connections','연결 설정','#settings?view=connections'),503);
 }
 const first=blockers[0]??null,canRun=Boolean(manifest&&market?.status==='READY'&&!first);
 return {schemaVersion:1,checkedAt:now,phase,purpose:executionMode==='paper'?'FORWARD_PAPER':executionMode==='live'?'LIVE_READ_ONLY':'DECISION_RESEARCH',marketRecovery,executionReadiness:{status:canRun?'READY':first?'ACTION_REQUIRED':'NOT_CHECKED',canRun,blockers,primaryAction:first?.action??(canRun?action('run','결정 실행',null,{...params,profileId},'EXPLICIT_NEW_DECISION'):null),account:accountState,policy:manifest?{id:manifest.id,version:manifest.data.version,hash:mindDocumentHash(manifest)}:null}};
}

export function assertTerminalExecutionReady(options){
 const readiness=buildTerminalReadiness(options),blocker=readiness.executionReadiness.blockers[0];
 if(blocker){const error=new RepositoryError(blocker.code,blocker.message,blocker.status);error.terminalReadiness=readiness;error.recovery=blocker;throw error;}
 return readiness;
}

/** Awaited market/valuation work can overlap another approved workspace edit. */
export async function assertCurrentTerminalWorkspace({repository,ownerId,workspace,instrumentId,timeframe}){
 if(!repository||!ownerId)return workspace;
 const current=await repository.read(ownerId);
 if(!current||current.revision!==workspace.revision){
  const recovery=issue('TERMINAL_STATE_CHANGED','VIEW_CHANGED','계좌나 투자 설정이 갱신되었습니다. 현재 상태를 확인하세요.',action('refresh','현재 상태 확인',null,{instrumentId,timeframe},'READ_ONLY_RETRY'));
  const error=new RepositoryError(recovery.code,recovery.message,recovery.status);error.recovery=recovery;error.currentRevision=current?.revision??null;throw error;
 }
 return current;
}
