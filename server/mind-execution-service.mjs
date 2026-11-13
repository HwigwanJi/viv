import {operationWindowState} from '../dist/domain/operation-window.mjs';
import {RepositoryError} from './repository.mjs';
import {hashInputPackage} from '../dist/domain/workspace.mjs';
import {getInstrument} from '../dist/domain/instruments.mjs';
import {mindDocumentHash} from '../dist/domain/mind-manifest.mjs';
import {mindEvaluationIdentity,assertTerminalExecutionReady,assertCurrentTerminalWorkspace} from './terminal-readiness.mjs';
import {researchSha256} from '../dist/domain/research.mjs';
import {assertMindInputContext,assertMindRunInputContext,buildMindJevRequest} from './mind-engine.mjs';
import {assertMindInvestmentScope,checkUniversePositionLimits} from '../dist/domain/universe-policy.mjs';
import {isMindStrategyPlanActive,strategyPlanModules} from '../dist/domain/mind-strategy-plan.mjs';
import {archiveMindMarketCapture} from './mind-market-capture.mjs';
const clone=structuredClone,list=v=>Array.isArray(v)?v:[];
const uniqueId=prefix=>prefix+'-'+crypto.randomUUID();
const fail=(code,message,status=400)=>{throw new RepositoryError(code,message,status);};
const check=(value,code,message,status)=>{if(!value)fail(code,message,status);};
const nowISO=options=>options.clock();
export function mindStrategyHistoryBars(manifest,instrument){
 const plan=manifest.data.strategyPlan,currentUniverse=plan?.scope?.instrumentPolicy==='UNIVERSE_CURRENT';
 if(instrument.provider==='upbit'&&plan){
  const counts=strategyPlanModules(plan).map(({moduleId,parameters:p})=>moduleId==='SMA_TREND'?p.lookbackBars:moduleId==='MOMENTUM'?p.lookbackBars+1:moduleId==='MEAN_REVERSION'?p.window:moduleId==='OPPORTUNITY'?Math.max(p.longWindow,p.shortWindow+1,p.breakoutWindow+1):240);
  return Math.max(manifest.data.universe.selection.minHistoryBars,...counts);
 }
 return currentUniverse&&instrument.id!=='crypto:okx:BTC-USDT'?Math.max(240,...plan.graph.nodes.filter(n=>n.type==='SIGNAL').map(n=>Number(n.config.parameters.lookbackBars??n.config.parameters.window??0)+1)):240;
}
export async function currentPaperQuote(instrument,{fetchImpl=fetch,now,notBefore=null,action='hold'}={}){
  const okx=instrument?.assetClass==='crypto'&&instrument.venue==='OKX',upbit=instrument?.assetClass==='crypto'&&instrument.venue==='UPBIT';
  check(okx||upbit,'EXECUTION_QUOTE_REQUIRED','해당 시장의 실시간 실행 시세 연결이 필요합니다.',503);
  if(upbit)check(/^(KRW|BTC|USDT)-[A-Z0-9]{1,30}$/.test(instrument.symbol??'')&&instrument.id==='crypto:upbit:'+instrument.symbol&&instrument.quoteCurrency===instrument.symbol.split('-')[0]&&instrument.baseAsset===instrument.symbol.split('-')[1],'EXECUTION_QUOTE_INVALID','업비트 종목 ID·거래쌍·평가 통화를 대조하세요.',503);
  if(upbit&&instrument.quoteCurrency==='BTC')return (await import('./upbit-book-quote.mjs')).currentUpbitBookQuote(instrument,{fetchImpl,now,notBefore,action});
  check(notBefore===null||typeof notBefore==='string'&&Number.isFinite(Date.parse(notBefore)),'EXECUTION_QUOTE_TIME','결정의 실제 기준 시각을 확인하세요.');
  // Upbit's ticker timestamp is the creation time of its returned snapshot.
  // https://docs.upbit.com/kr/reference/list-tickers
  const url=new URL(upbit?'https://api.upbit.com/v1/ticker':'https://www.okx.com/api/v5/market/ticker');url.searchParams.set(upbit?'markets':'instId',instrument.symbol);
  const readTime=()=>new Date(typeof now==='function'?now():now??Date.now()).toISOString(),deadline=Date.now()+8000,attempts=[];
  for(let attempt=1;attempt<=3;attempt++){
    const remaining=deadline-Date.now();if(remaining<=0)break;
    let received;try{received=await fetchImpl(url.href,{signal:AbortSignal.timeout(Math.max(1,Math.min(2500,remaining))),redirect:'manual',cache:'no-store',headers:{'Cache-Control':'no-cache'}});}catch{
      attempts.push({attempt,receivedAt:readTime(),reason:'QUOTE_NETWORK_UNAVAILABLE'});
      if(attempt<3&&Date.now()+attempt*250<deadline){await new Promise(resolve=>setTimeout(resolve,attempt*250));continue;}
      fail('EXECUTION_QUOTE_UNAVAILABLE',action==='hold'?'시세를 불러오지 못했습니다. 후속 관측 기준을 다시 저장해 보세요.':'실행 가격을 불러오지 못했습니다. 같은 결정의 모의 체결을 다시 실행하세요.',503);
    }
    if(!received.ok&&[408,500,502,503,504].includes(received.status)){
      attempts.push({attempt,receivedAt:readTime(),reason:'QUOTE_HTTP_UNAVAILABLE',httpStatus:received.status});
      if(attempt<3&&Date.now()+attempt*250<deadline){await new Promise(resolve=>setTimeout(resolve,attempt*250));continue;}
    }
    check(received.ok,'EXECUTION_QUOTE_UNAVAILABLE','실행 가격을 불러오지 못했습니다. 같은 결정의 관측 기준 저장 또는 모의 체결을 다시 실행하세요.',503);if(received.url)check(new URL(received.url).origin===url.origin,'EXECUTION_QUOTE_INVALID','실행 가격의 실제 공급원 주소를 대조하세요.',503);const raw=await received.text();check(raw.length<100000,'EXECUTION_QUOTE_INVALID','실행 가격 응답을 확인하세요.',503);
    let body;try{body=JSON.parse(raw);}catch{fail('EXECUTION_QUOTE_INVALID','실행 가격 응답을 확인하세요.',503);}
    const row=upbit?(Array.isArray(body)&&body.length===1?body[0]:null):body.data?.[0],price=Number(upbit?row?.trade_price:row?.last),stamp=Number(upbit?row?.timestamp:row?.ts),receivedAt=readTime(),receivedMs=Date.parse(receivedAt);
    check((upbit?row?.market===instrument.symbol:body.code==='0'&&row?.instId===instrument.symbol)&&price>0&&Number.isFinite(price)&&Number.isSafeInteger(stamp)&&stamp>0&&stamp<8640000000000000,'EXECUTION_QUOTE_INVALID','종목과 실행 가격·시각을 확인하세요.',503);
    const reason=notBefore!==null&&stamp<Date.parse(notBefore)?'QUOTE_BEFORE_DECISION':stamp>receivedMs?'QUOTE_CLOCK_AHEAD':receivedMs-stamp>30000?'STALE_QUOTE':null,asOf=new Date(stamp).toISOString(),rawSha256=researchSha256(raw);
    attempts.push({attempt,asOf,receivedAt,rawSha256,reason});
    if(reason===null)return {instrumentId:instrument.id,price,currency:instrument.quoteCurrency,asOf,receivedAt,source:upbit?'UPBIT_PUBLIC_TICKER':'OKX_PUBLIC_TICKER',url:url.href,rawSha256,validation:{notBefore,attemptCount:attempt,attempts}};
    if(attempt<3&&Date.now()+attempt*500<deadline)await new Promise(resolve=>setTimeout(resolve,attempt*500));
  }
  fail('EXECUTION_QUOTE_PENDING','결정 이후의 새 현재가를 기다리고 있습니다. 잠시 후 같은 결정의 관측 기준 저장 또는 모의 체결을 다시 실행하세요.',503);
}

export async function prepareMindEvaluation({workspace:w,next,manifest,instrumentId,timeframe='4h',marketLoader,repository=null,ownerId=null,env={},fetchImpl,clock=()=>new Date().toISOString(),createdAt=clock(),executionKey=null,trigger='manual',executionMode='research',expectedPolicyHash=null,expectedMarketAsOf=null,selection=null,campaign=null}={}){
 check(w.investmentProfiles.find(p=>p.id===manifest.scope.profileId)?.status!=='ARCHIVED','MIND_ARCHIVED','마인드를 복원한 뒤 새 결정을 실행하세요.',409);
 const body={mindId:manifest.scope.profileId,instrumentId,timeframe},options={fetchImpl,clock},now=createdAt;
          const universeResolution=assertMindInvestmentScope(manifest,body.instrumentId,{asOf:nowISO(options),phase:'prepare'}),instrument=getInstrument(body.instrumentId,{resolution:universeResolution,asOf:nowISO(options)});
          if(executionMode!=='research')assertTerminalExecutionReady({workspace:w,manifest,instrument,timeframe,executionMode,env,now:nowISO(options),phase:'prepare',executionKey,expectedPolicyHash,expectedMarketAsOf});
          const strategyHistory=manifest.data.strategyPlan?.scope?.instrumentPolicy==='UNIVERSE_CURRENT',requiredBars=mindStrategyHistoryBars(manifest,instrument);
          const market=await marketLoader({instrumentId:instrument.id,timeframe:body.timeframe??instrument.defaultTimeframe,limit:requiredBars,strategyHistory,env,fetchImpl:options.fetchImpl,now:()=>nowISO(options),universeResolution});
          if(executionMode!=='research')assertTerminalExecutionReady({workspace:w,manifest,instrument,market,timeframe,executionMode,env,now:nowISO(options),phase:'prepare',executionKey,expectedPolicyHash,expectedMarketAsOf});
          check(market.status==='READY'&&market.bars.length>=manifest.data.universe.selection.minHistoryBars,'MARKET_NOT_READY','연결 상태와 확정 봉 수를 확인하세요.',503);
          if(instrument.provider==='upbit'&&isMindStrategyPlanActive(manifest.data.strategyPlan,nowISO(options)))await archiveMindMarketCapture({repository,ownerId,market,now:nowISO(options)});
          const identity=mindEvaluationIdentity(w,manifest,instrument,market,body.timeframe??instrument.defaultTimeframe,nowISO(options)),{approved,contextVersionHash}=identity,key=executionKey??identity.key;
          const duplicate=w.mindRuns.find(r=>r.executionKey===key);check(executionKey||!duplicate,'CANDLE_ALREADY_EVALUATED','이 마인드·종목·확정 봉의 결정이 저장되어 있습니다.',409);
          const contexts=approved.filter(d=>d.document.kind==='market-context');
          const memories=[...manifest.data.approvedMemory,...approved.filter(d=>['trade-review','principle-evidence'].includes(d.document.kind))];
          const canonicalInputs=manifest.data.strategyPlan?.graph?.schemaVersion===2&&isMindStrategyPlanActive(manifest.data.strategyPlan,nowISO(options));
          if(!canonicalInputs)assertMindInputContext({manifest,market,contexts,memories,knowledge:w.marketKnowledge,now:nowISO(options),phase:'prepare'});
          let account=w.mindPositions.find(a=>a.kind==='PAPER_ACCOUNT'&&a.profileId===body.mindId&&a.quoteCurrency===instrument.quoteCurrency);
          let portfolio=null;
          if(account){
            const quotes=[];for(const position of account.positions){const quote=await currentPaperQuote(getInstrument(position.instrumentId),{fetchImpl:options.fetchImpl,now:()=>nowISO(options)});quotes.push(quote);}
            const {markMindPaperAccount,mindPaperPortfolioState}=await import('../dist/domain/mind-paper.mjs');
            account={...markMindPaperAccount(account,{quotes,now:nowISO(options)}),kind:'PAPER_ACCOUNT'};
            const index=next.mindPositions.findIndex(a=>a.id===account.id);next.mindPositions[index]=account;
            portfolio={...mindPaperPortfolioState(account,instrument.id),accountId:account.id,accountAsOf:account.asOf,valuationSource:{basis:quotes.length?(quotes.some(q=>q.source==='UPBIT_PUBLIC_ORDERBOOK')?'CURRENT_PUBLIC_QUOTES':'CURRENT_PUBLIC_TICKERS'):'CASH_BALANCE',asOf:account.asOf,quotes:quotes.map(q=>({instrumentId:q.instrumentId,asOf:q.asOf,rawSha256:q.rawSha256,source:q.source}))}};
          }
          let inputContextAt=nowISO(options);
          if(manifest.data.strategyPlan?.graph?.nodes.some(n=>n.type==='INPUT'&&n.config.kind==='CAMPAIGN')){
            if(campaign===null){
              const subscription=w.mindSubscriptions?.find(s=>s.profileId===manifest.scope.profileId&&s.accountId===account?.id),state=subscription?.runtime?.campaign;
              const original={contractVersion:'mind-campaign-context-v1',profileId:manifest.scope.profileId,accountId:account?.id,asOf:inputContextAt,exitRequested:!!state,...(subscription?{subscriptionId:subscription.id}:{}),...(state?{requestRunId:state.triggerRunId,requestedAt:state.requestedAt}:{})};campaign={...original,sourceHash:hashInputPackage(original)};
            }else inputContextAt=campaign.asOf;
          }
          const {loadMindStrategyFeatures}=await import('./mind-strategy-features.mjs'),strategy=await loadMindStrategyFeatures({repository,ownerId,manifest,market,account,contexts,memories,knowledge:w.marketKnowledge,selection,campaign,contextAsOf:inputContextAt,env,fetchImpl:options.fetchImpl,marketLoader,trigger:trigger==='manual'?'manual':'closed_bar',now:()=>nowISO(options)});
          if(manifest.data.strategyPlan?.graph?.schemaVersion===2&&strategy.evaluation?.graphEvaluation?.output?.status==='BLOCKED'){
            const error=new RepositoryError('GRAPH_INPUTS_REQUIRED','그래프의 자료·실행 조건을 확인하세요.',503);error.graphEvaluation=strategy.evaluation.graphEvaluation;throw error;
          }
          if(manifest.data.strategyPlan?.graph?.schemaVersion===2)buildMindJevRequest(manifest,market,{portfolio,contexts,memories,knowledge:w.marketKnowledge,strategyEvaluation:strategy.evaluation,trigger,now:nowISO(options)});

 return {w,next,manifest,body,options,now,instrument,market,portfolio,contexts,memories,account,contextVersionHash,key,trigger,env,executionMode,expectedPolicyHash,expectedMarketAsOf,repository,ownerId,strategyEvaluation:strategy.evaluation,strategyReferenceModel:strategy.referenceModel};
}
export async function evaluatePreparedMind(prepared,{autoExecuteHold=true,providerHooks=null}={}){
 const {w,next,manifest,body,options,now,instrument,market,portfolio,contexts,memories,account,contextVersionHash,key,trigger}=prepared,env=prepared.env??{},engine=await import('./mind-engine.mjs');
          if(prepared.executionMode&&prepared.executionMode!=='research'){
            const current=await assertCurrentTerminalWorkspace({repository:prepared.repository,ownerId:prepared.ownerId,workspace:w,instrumentId:instrument.id,timeframe:body.timeframe});
            assertTerminalExecutionReady({workspace:current,manifest,instrument,market,timeframe:body.timeframe,executionMode:prepared.executionMode,env,now:nowISO(options),phase:'before-provider',expectedPolicyHash:prepared.expectedPolicyHash,expectedMarketAsOf:prepared.expectedMarketAsOf});
          }
          let value;try{value=await engine.evaluateMind({manifest,market,portfolio,contexts,memories,knowledge:w.marketKnowledge,strategyEvaluation:prepared.strategyEvaluation,trigger,now:prepared.decisionAt??nowISO(options),env,fetchImpl:options.fetchImpl,clock:()=>nowISO(options),providerHooks});}
          catch(error){if(providerHooks?.onFailure)try{await providerHooks.onFailure(error);}catch(retentionError){error.journalFailureCode=retentionError.code??'PROVIDER_JOURNAL_FAILED';}throw error;}
          const decisionCompletedAt=nowISO(options);
          const run={...value,id:uniqueId('mind-run'),profileId:body.mindId,instrumentId:instrument.id,asOf:market.bars.at(-1).closeTime,createdAt:now,decisionCompletedAt,manifestId:manifest.id,manifestHash:mindDocumentHash(manifest),mode:'live',experimentType:'FORWARD_PAPER',contextVersionHash,executionKey:key,marketSource:market.source,accountSnapshot:account?clone(account):null,execution:{status:value.decision.action==='hold'?'NO_ORDER_REQUIRED':value.risk.allowed?'WAITING_EXECUTION_DATA':'RISK_BLOCKED',reason:value.risk.reasons.map(r=>r.message).join(' ')},marketBars:market.bars.slice(-64)};
          // The immutable stage list has one stored home in the original response.
          if(run.providerStages&&run.rawResponse?.stages&&hashInputPackage(run.providerStages)===hashInputPackage(run.rawResponse.stages))delete run.providerStages;
          if(prepared.strategyEvaluation){run.strategyEvaluation=clone(value.strategyEvaluation??prepared.strategyEvaluation);run.strategyReferenceModel=clone(prepared.strategyReferenceModel);}
          if(autoExecuteHold&&value.decision.action==='hold'&&account&&instrument.assetClass==='crypto'){
            try{
              assertMindRunInputContext({run,manifest,workspace:w,now:nowISO(options)});
              const quote=await currentPaperQuote(instrument,{fetchImpl:options.fetchImpl,now:()=>nowISO(options),notBefore:run.decisionCompletedAt??run.decisionAt});
              const valuationQuotes=[quote];for(const position of account.positions.filter(p=>p.instrumentId!==instrument.id))valuationQuotes.push(await currentPaperQuote(getInstrument(position.instrumentId),{fetchImpl:options.fetchImpl,now:()=>nowISO(options)}));
              const heldAt=nowISO(options),{executeMindPaper,markMindPaperAccount}=await import('../dist/domain/mind-paper.mjs');
              assertMindRunInputContext({run,manifest,workspace:w,now:heldAt});
              const marked=markMindPaperAccount(account,{quotes:valuationQuotes,now:heldAt}),held=executeMindPaper(marked,run,{manifest,quote,instrument,now:heldAt});
              if(held.ok){const index=next.mindPositions.findIndex(a=>a.id===account.id);next.mindPositions[index]={...held.account,kind:'PAPER_ACCOUNT'};run.execution={status:'NO_ORDER_REQUIRED',at:heldAt,quote,valuationQuotes:clone(valuationQuotes),outcomeRecord:held.outcomeRecord,accountSnapshotAfter:clone(held.account)};}
              else {const expired=held.reasons.some(r=>r.code==='DECISION_EXPIRED');Object.assign(run.execution,{status:expired?'DECISION_EXPIRED':'WAITING_EXECUTION_DATA',retryable:!expired,retryAction:expired?'EVALUATE_NEW_CANDLE':'SAVE_HOLD_BASELINE',reason:held.reasons.map(r=>r.message).join(' '),errorCode:expired?'DECISION_EXPIRED':held.reasons[0]?.code??null});}
            }catch(error){
              const requiredBlocked=error.code==='MIND_REQUIRED_INPUTS_UNAVAILABLE'||/^UNIVERSE_|^MIND_UNIVERSE/.test(error.code??'');
              if(requiredBlocked){const index=next.mindPositions.findIndex(a=>a.id===account.id),saved=w.mindPositions.find(a=>a.id===account.id);if(index>=0&&saved)next.mindPositions[index]=clone(saved);}
              Object.assign(run.execution,{status:requiredBlocked?'RISK_BLOCKED':'WAITING_EXECUTION_DATA',retryable:!requiredBlocked,retryAction:requiredBlocked?'EVALUATE_NEW_CANDLE':'SAVE_HOLD_BASELINE',reason:error.code?error.message:'유지 결정의 관측 기준가격 연결을 확인하세요.',errorCode:error.code??'EXECUTION_QUOTE_UNAVAILABLE',...(error.blockedInputs?{blockedInputs:error.blockedInputs,inputRequirementPolicy:error.inputRequirementPolicy}:{})});
            }
          }
          const {observeMindRun}=await import('./mind-observation.mjs'),pending=observeMindRun({run,account:run.execution.accountSnapshotAfter,manifest,now:nowISO(options),horizonHours:4});
          run.observationState=pending.status;run.observationDueAt=pending.dueAt;
          next.mindRuns.push(run);
 return run;
}
export async function executeMindRun({workspace:w,next,run,manifest,fetchImpl,clock=()=>new Date().toISOString(),executionDeadline=null}={}){
 const options={fetchImpl,clock},now=clock();let result;
      const cycle=run.automation?.portfolioCycle;
      if(cycle){check(cycle.phase==='FINAL','PORTFOLIO_SCREENING_ONLY','종목 선정을 마친 최종 결정을 실행하세요.',409);check(run.decision.action!=='buy'||cycle.selectionContext?.selectedInstrumentIds?.includes(run.instrumentId),'PORTFOLIO_NOT_SELECTED','이번 주기에 선정된 종목의 최종 결정을 실행하세요.',409);}
      const priorAccount=w.mindPositions.find(a=>a.kind==='PAPER_ACCOUNT'&&a.profileId===run.profileId&&a.receipts?.some(r=>r.runId===run.id));
      if(priorAccount){result={account:priorAccount,execution:clone(run.execution),idempotent:true};return result;}
      const subscription=run.automation?.subscriptionId?w.mindSubscriptions.find(s=>s.id===run.automation.subscriptionId):null;const checkWindow=at=>check(!run.automation?.subscriptionId||subscription&&operationWindowState(subscription,at)==='ACTIVE','OPERATION_WINDOW','운용 기간이 종료되었습니다. 보유와 판단 기록을 보존합니다.',409);checkWindow(now);
      check(w.investmentProfiles.find(p=>p.id===run.profileId)?.status!=='ARCHIVED','MIND_ARCHIVED','마인드를 복원한 뒤 모의 주문을 실행하세요.',409);
      check(run.manifestHash===mindDocumentHash(manifest),'MANIFEST_CHANGED','마인드가 갱신되었습니다. 새 결정을 실행하세요.',409);
      check(Date.parse(now)-Date.parse(run.createdAt)<600000,'DECISION_EXPIRED','결정 유효시간이 지났습니다. 새 확정 봉을 평가하세요.',409);
      assertMindRunInputContext({run,manifest,workspace:w,now});
      const universeResolution=assertMindInvestmentScope(manifest,run.instrumentId,{asOf:now,phase:'execution',expectedResolutionHash:run.rawRequest?.state?.universeResolutionRef?.contentHash}),instrument=getInstrument(run.instrumentId,{resolution:universeResolution,asOf:now}),index=next.mindPositions.findIndex(a=>a.kind==='PAPER_ACCOUNT'&&a.profileId===run.profileId&&a.quoteCurrency===instrument.quoteCurrency);check(index>=0,'PAPER_ACCOUNT_REQUIRED','해당 통화의 모의계좌를 만드세요.');
      const current=next.mindPositions[index];check(run.accountSnapshot&&current.cash===run.accountSnapshot.cash&&hashInputPackage(current.ledger)===hashInputPackage(run.accountSnapshot.ledger),'ACCOUNT_CHANGED','결정 이후 계좌의 거래가 변경되었습니다. 최신 잔고로 다시 결정하세요.',409);
      if(run.decision.action==='buy'&&!current.positions.some(p=>p.instrumentId===instrument.id))check(next.mindPositions.filter(a=>a.kind==='PAPER_ACCOUNT'&&a.profileId===run.profileId).reduce((n,a)=>n+a.positions.length,0)<manifest.data.universe.selection.maxPositions,'MAX_POSITIONS','이 마인드의 동시 보유 종목 한도에 도달했습니다.',409);
      const quote=await currentPaperQuote(instrument,{fetchImpl:options.fetchImpl,now:()=>nowISO(options),notBefore:run.decisionCompletedAt??run.decisionAt,action:run.decision.action});
      const {executeMindPaper,markMindPaperAccount}=await import('../dist/domain/mind-paper.mjs');
      const quotes=[quote];for(const held of current.positions.filter(p=>p.instrumentId!==instrument.id)){const q=await currentPaperQuote(getInstrument(held.instrumentId),{fetchImpl:options.fetchImpl,now:()=>nowISO(options)});quotes.push(q);}
      const fillAt=nowISO(options);checkWindow(fillAt);check(executionDeadline===null||fillAt<=executionDeadline,'AUTO_EXECUTION_WINDOW','이번 봉의 실행 허용창이 지났습니다.',409);
      assertMindRunInputContext({run,manifest,workspace:w,now:fillAt});
      if(run.decision.action==='buy'&&manifest.data.universe.scopePolicy){const scope=assertMindInvestmentScope(manifest,run.instrumentId,{asOf:fillAt,phase:'execution',expectedResolutionHash:run.rawRequest.state.universeResolutionRef.contentHash}),limit=checkUniversePositionLimits(scope,{instrumentId:instrument.id,positions:next.mindPositions.filter(a=>a.kind==='PAPER_ACCOUNT'&&a.profileId===run.profileId).flatMap(a=>a.positions)});check(limit.allowed,limit.reason??'UNIVERSE_POSITION_LIMIT','허용 범위의 종목·섹터별 보유 한도를 확인하세요.',409);}
      const marked=markMindPaperAccount(current,{quotes,now:fillAt});
      const value=executeMindPaper(marked,run,{manifest,quote,instrument,now:fillAt,feeBps:10,slippageBps:5});
      check(value.ok||!value.reasons.some(r=>r.code==='DECISION_EXPIRED'),'DECISION_EXPIRED','결정 유효시간이 지났습니다. 새 확정 봉으로 JEV 결정을 다시 실행하세요.',409);
      check(value.ok,'PAPER_EXECUTION_BLOCKED',list(value.reasons).map(r=>r.message??r.code??r).join(' ')||'모의 체결 조건을 확인하세요.',409);
      next.mindPositions[index]={...value.account,kind:'PAPER_ACCOUNT'};const savedRun=next.mindRuns.find(r=>r.id===run.id);savedRun.execution={status:value.outcome==='HOLD'?'NO_ORDER_REQUIRED':'FILLED',...value.execution,outcome:value.outcome,outcomeRecord:value.outcomeRecord,quote,valuationQuotes:clone(quotes),at:fillAt,accountSnapshotAfter:clone(value.account)};result={account:next.mindPositions[index],execution:savedRun.execution};
      return result;

}
