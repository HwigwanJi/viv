import {hashInputPackage} from '../dist/domain/workspace.mjs';
import {mindDocumentHash} from '../dist/domain/mind-manifest.mjs';
import {assertPaperForwardTrial,finishPaperForwardFrame} from '../dist/domain/paper-forward-trial.mjs';
import {prepareMindEvaluation,evaluatePreparedMind,executeMindRun,currentPaperQuote} from './mind-execution-service.mjs';
import {getInstrument} from '../dist/domain/instruments.mjs';
import {createOwnerMarketResolver} from './canonical-instrument-market.mjs';
import {createGraphProviderJournal} from './graph-provider-journal.mjs';
import {StrategyLearningStore} from './strategy-learning-store.mjs';
import {assertStrategyEvaluation} from '../dist/domain/mind-strategy-plan.mjs';
import {assertGraphProviderStages} from '../dist/domain/graph-provider-proof.mjs';
import {createHash} from 'node:crypto';

const clone=structuredClone,H=14400000,BTC='crypto:okx:BTC-USDT';
const check=(v,c,m)=>{if(!v)throw Object.assign(new Error(m),{code:c,status:409});};
const terminal=new Set(['READY_TO_PROMOTE','KEEP_BASELINE','INTERRUPTED','PROMOTED']);
const quoteUrl='https://www.okx.com/api/v5/market/ticker?instId=BTC-USDT';
function shadowWorkspace(base,arm){return {...clone(base),mindPositions:[clone(arm.account)],mindRuns:[],mindSubscriptions:[],mindSelections:[]};}
function frozenQuoteFetch(snapshot,fetchImpl){return async(url,init)=>{
 const u=new URL(String(url));if(u.origin==='https://www.okx.com'&&u.pathname==='/api/v5/market/ticker'&&u.searchParams.get('instId')==='BTC-USDT')return new Response(snapshot.raw,{status:snapshot.status,headers:{'Content-Type':'application/json'}});
 return fetchImpl(url,init);
};}
async function fetchQuote(fetchImpl,clock,notBefore=null){let snapshot;const recorded=async(url,init)=>{const r=await fetchImpl(url,init);snapshot={url:String(url),status:r.status,raw:await r.clone().text(),receivedAt:clock()};return r;};const quote=await currentPaperQuote(getInstrument(BTC),{fetchImpl:recorded,now:clock,notBefore});return {...snapshot,quote};}

// Stable storage sorts JSON keys. Replay the exact provider text to preserve the
// original floating-point summation order while retaining every recorded hash.
function restoreProviderReplay(run){
 const replay=clone(run),stages=replay.rawResponse?.stages??[];
 for(const stage of stages){
  check(typeof stage.rawResponseText==='string','FORWARD_PROVIDER_ORIGINAL','공급자 응답 원문을 확인하세요.');
  let raw;try{raw=JSON.parse(stage.rawResponseText);}catch{check(false,'FORWARD_PROVIDER_ORIGINAL','공급자 응답 원문의 JSON 형식을 확인하세요.');}
  check(hashInputPackage(raw)===stage.rawResponseHash&&hashInputPackage(raw)===hashInputPackage(stage.rawResponse)&&(!stage.exactResponseHash||createHash('sha256').update(stage.rawResponseText).digest('hex')===stage.exactResponseHash),'FORWARD_PROVIDER_ORIGINAL','공급자 원문과 원래 응답 해시를 대조하세요.');
  stage.rawResponse=raw;
  const answer=replay.strategyEvaluation.decisionInputs?.[stage.nodeId];
  if(stage.type==='JEV_QUESTION'){
   check(answer&&hashInputPackage(answer.answer)===hashInputPackage(raw.answers?.[stage.nodeId]??null),'FORWARD_PROVIDER_ANSWER','저장된 선택과 원래 질문 응답을 대조하세요.');
   answer.answer=clone(raw.answers[stage.nodeId]);
  }else if(stage.type==='VIBE'){
   check(answer&&hashInputPackage(answer.probabilities??null)===hashInputPackage(raw.answers?.action?.probabilities??null),'FORWARD_PROVIDER_ANSWER','저장된 투자 선택과 원래 확률을 대조하세요.');
   answer.probabilities=clone(raw.answers.action.probabilities??null);
  }
 }
 if(replay.providerStages)replay.providerStages=clone(stages);
 check(hashInputPackage(replay)===hashInputPackage(run),'FORWARD_PROVIDER_REPLAY','원문 복원 후에도 저장된 실행 값과 해시를 유지하세요.');
 return replay;
}

/** Promotion reopens the immutable originals and compares both final ledgers with their actual runs. */
export async function verifyPaperForwardTrialEvidence({trial,repository,ownerId,now}){
 assertPaperForwardTrial(trial);check(trial.ownerId===ownerId&&trial.status==='READY_TO_PROMOTE','FORWARD_PROMOTION_EVIDENCE','현재 소유자의 전진 비교 통과 근거를 확인하세요.');
 const store=new StrategyLearningStore(repository.db);
 for(const frame of trial.frames){
  const source=await store.read(ownerId,frame.marketRef),quote=await store.read(ownerId,frame.executionQuoteRef);
  check(hashInputPackage(source.market)===frame.marketHash&&hashInputPackage(source.valuationQuote)===frame.valuationQuoteHash&&hashInputPackage(quote)===frame.executionQuoteHash&&source.market.bars.at(-1).closeTime===frame.barCloseAt,'FORWARD_PRICE_EVIDENCE','두 원장에 제공한 봉과 실제 공통 체결 시세를 대조하세요.');
  for(const key of ['baseline','candidate']){
   const arm=trial.arms[key],meta=arm.runs.find(r=>r.id===frame.runIds[key]),record=await store.read(ownerId,meta.runRef),run=record.run;
   check(record.trialId===trial.id&&record.arm===key&&record.phase==='EXECUTED'&&run.id===meta.id&&run.asOf===frame.barCloseAt&&run.manifestHash===arm.manifestHash&&run.inputHash===hashInputPackage(run.rawRequest?.state),'FORWARD_RUN_EVIDENCE','각 계좌의 실제 실행·정책·전송 입력을 대조하세요.');
   const replay=restoreProviderReplay(run);
   assertStrategyEvaluation(replay.strategyEvaluation,{manifest:arm.manifest,marketAsOf:run.asOf,instrumentId:BTC,now});
   assertGraphProviderStages(replay,{graph:arm.manifest.data.strategyPlan.graph,prepared:replay.rawRequest.state.strategyEvaluation,evaluation:replay.strategyEvaluation});
   check(run.decision.graphOutputHash===run.strategyEvaluation.graphEvaluation.outputHash&&run.execution.quote.rawSha256===quote.quote.rawSha256&&run.execution.quote.price===quote.quote.price&&run.execution.quote.asOf===quote.quote.asOf,'FORWARD_EXECUTION_EVIDENCE','그래프 결정과 같은 체결 가격의 영수증을 확인하세요.');
   const fill=arm.account.ledger.find(f=>f.runId===run.id);if(fill)check(run.execution.status==='FILLED'&&Object.keys(fill).every(k=>hashInputPackage(fill[k])===hashInputPackage(run.execution[k]??null)),'FORWARD_FILL_EVIDENCE','독립 원장의 체결과 저장 실행 영수증을 대조하세요.');
   if(frame===trial.frames.at(-1))check(hashInputPackage({...run.execution.accountSnapshotAfter,kind:'PAPER_ACCOUNT'})===hashInputPackage(arm.account),'FORWARD_FINAL_ACCOUNT_EVIDENCE','마지막 실행 영수증과 비교 종료 잔고를 대조하세요.');
  }
 }
 return {contractVersion:'PAPER_FORWARD_VERIFIED_EVIDENCE_V1',trialHash:hashInputPackage(trial),verifiedAt:now,verifiedFrames:trial.frames.length,verifiedArms:2};
}

/** Execute two isolated actual paper ledgers from a single frozen market capture. */
export async function advancePaperForwardTrial({trial,workspace,repository,ownerId,env={},clock=()=>new Date().toISOString(),fetchImpl=fetch,marketLoader,resourceId,token,onWorkspace=()=>{},persist}){
 let t=clone(trial);assertPaperForwardTrial(t);check(t.ownerId===ownerId,'FORWARD_OWNER','시험의 소유자를 확인하세요.');
 if(terminal.has(t.status)||Date.parse(clock())<Date.parse(t.nextCloseAt)+300000)return t;
 if(t.pending){t.status='INTERRUPTED';t.reason='PREVIOUS_FRAME_REQUIRES_REVIEW';t.updatedAt=clock();await persist(t,'interrupted');return t;}
 const bar=t.nextCloseAt,now=clock();
 if(new Date(Math.floor(Date.parse(now)/H)*H).toISOString()!==bar||Date.parse(now)>Date.parse(bar)+600000){t.status='INTERRUPTED';t.reason='MISSED_FORWARD_CANDLE';t.updatedAt=now;await persist(t,'missed');return t;}
 const original=workspace(),subscription=original.mindSubscriptions.find(s=>s.id===t.subscriptionId&&s.ownerId===ownerId);
 check(subscription?.status==='ENABLED'&&subscription.pins.manifestHash===t.arms.baseline.manifestHash&&!subscription.pendingPins,'FORWARD_SOURCE_CHANGED','비교 동안 원 운용의 고정 정책을 유지하세요.');
 const loader=marketLoader??createOwnerMarketResolver({repository,owner:ownerId,workspace:original});
 const market=await loader({instrumentId:BTC,timeframe:'4h',limit:240,strategyHistory:true,env,fetchImpl,now:clock});
 check(market.status==='READY'&&market.bars.at(-1)?.closeTime===bar&&market.bars.every(b=>b.isClosed===true&&b.closeTime<=bar),'FORWARD_MARKET_BOUNDARY','두 전략에 같은 현재 확정 봉까지의 시세를 연결하세요.');
 const valuationQuote=await fetchQuote(fetchImpl,clock),valuationFetch=frozenQuoteFetch(valuationQuote,fetchImpl),store=new StrategyLearningStore(repository.db),prepared={};
 // Both preparations precede any model call. Each receives its own ledger and the same source.
 for(const key of ['baseline','candidate']){
  const arm=t.arms[key],w=shadowWorkspace(original,arm),next=clone(w);
  prepared[key]=await prepareMindEvaluation({workspace:w,next,manifest:arm.manifest,instrumentId:BTC,timeframe:'4h',marketLoader:async()=>clone(market),repository,ownerId,env,fetchImpl:valuationFetch,clock,createdAt:clock(),executionKey:t.id+':'+key+':'+bar,trigger:'paper.forward.candle.closed',executionMode:'research'});
  check(prepared[key].market.bars.at(-1).closeTime===bar,'FORWARD_MARKET_BOUNDARY','두 전략의 확정 봉을 대조하세요.');
 }
 const marketRef=await store.write(ownerId,{market,valuationQuote}),marketHash=hashInputPackage(market),valuationQuoteHash=hashInputPackage(valuationQuote);
 t.status='RUNNING';t.pending={barCloseAt:bar,startedAt:clock(),marketRef,marketHash,valuationQuoteHash,stage:'PREPARED',completedArms:[]};t.updatedAt=clock();await persist(t,'prepared-'+t.frames.length);
 try{
  const runs={};
  for(const key of ['baseline','candidate']){
   const journal=createGraphProviderJournal({repository,ownerId,profileId:t.profileId,manifestHash:t.arms[key].manifestHash,executionKey:t.id+':'+key+':'+bar,barCloseAt:bar,resourceId,token,workspace:workspace(),clock,env,onPersist:onWorkspace,
    async assertReady(current){const s=current.mindSubscriptions.find(s=>s.id===t.subscriptionId);check(s?.status==='ENABLED'&&s.adaptation?.enabled&&s.adaptation?.autoApply&&s.pins.manifestHash===t.arms.baseline.manifestHash&&!s.pendingPins,'FORWARD_SOURCE_CHANGED','비교 운용과 원 정책을 확인하세요.');check(clock()<=new Date(Date.parse(bar)+600000).toISOString(),'FORWARD_EXECUTION_WINDOW','이번 봉의 비교 실행 시간이 지났습니다.');}
   });
   runs[key]=await evaluatePreparedMind(prepared[key],{autoExecuteHold:false,providerHooks:journal});
   const runRef=await store.write(ownerId,{contractVersion:'PAPER_FORWARD_RUN_ORIGINAL_V1',trialId:t.id,arm:key,phase:'DECISION',run:runs[key]});
   t.pending.completedArms.push({arm:key,runId:runs[key].id,runRef});t.pending.stage='DECISIONS';t.updatedAt=clock();await persist(t,'decision-'+key+'-'+t.frames.length);
  }
  const executionQuote=await fetchQuote(fetchImpl,clock,[runs.baseline.decisionCompletedAt,runs.candidate.decisionCompletedAt].sort().at(-1)),executionFetch=frozenQuoteFetch(executionQuote,fetchImpl),executionQuoteRef=await store.write(ownerId,executionQuote),executionQuoteHash=hashInputPackage(executionQuote);
  t.pending.executionQuoteRef=executionQuoteRef;t.pending.executionQuoteHash=executionQuoteHash;t.pending.stage='EXECUTING';t.updatedAt=clock();await persist(t,'quote-'+t.frames.length);
  for(const key of ['baseline','candidate']){
   const p=prepared[key],run=runs[key];await executeMindRun({workspace:p.w,next:p.next,run,manifest:p.manifest,fetchImpl:executionFetch,clock,executionDeadline:new Date(Date.parse(bar)+600000).toISOString()});
   const saved=p.next.mindRuns.find(r=>r.id===run.id),account=p.next.mindPositions.find(a=>a.id===t.arms[key].account.id),runRef=await store.write(ownerId,{contractVersion:'PAPER_FORWARD_RUN_ORIGINAL_V1',trialId:t.id,arm:key,phase:'EXECUTED',run:saved});
   t.arms[key].account=clone(account);t.arms[key].runs.push({id:saved.id,asOf:saved.asOf,manifestHash:saved.manifestHash,decisionAt:saved.decisionAt,decisionCompletedAt:saved.decisionCompletedAt,executionStatus:saved.execution.status,runRef});t.pending.stage='EXECUTED_'+key.toUpperCase();t.updatedAt=clock();await persist(t,'execution-'+key+'-'+t.frames.length);
  }
  t=finishPaperForwardFrame(t,{barCloseAt:bar,marketHash,marketRef,valuationQuoteHash,executionQuoteHash,executionQuoteRef,runIds:{baseline:runs.baseline.id,candidate:runs.candidate.id},completedAt:clock()});await persist(t,'frame-'+t.frames.length);return t;
 }catch(e){
  t.status='INTERRUPTED';t.reason=/^[A-Z0-9_:-]{1,100}$/i.test(e.code??'')?e.code:'FORWARD_FRAME_FAILED';t.updatedAt=clock();t.pending.failure={code:t.reason,at:t.updatedAt};await persist(t,'failed-'+t.frames.length);return t;
 }
}
