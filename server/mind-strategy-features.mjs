import {resolveGraphInput} from '../dist/domain/strategy-graph-inputs.mjs';
import {resolveQueryParameters,isParameterPort} from '../dist/domain/strategy-parameters.mjs';
import {loadStrategyParameterData} from './strategy-parameter-data.mjs';
import {hashInputPackage} from '../dist/domain/workspace.mjs';
import {assertMindDocument,mindDocumentHash,assertSafeMindData} from '../dist/domain/mind-manifest.mjs';
import {precomputeFeatures,decideSnapshot} from '../dist/trading/model.mjs';
import {assessOpportunity} from '../dist/engine/opportunity.mjs';
import {evaluateClutchPolicy} from '../dist/engine/clutch-policy.mjs';
import {assessMeanReversion,assessSmaTrend,assessMomentum} from '../dist/engine/strategies.mjs';
import {assertMindStrategyPlan,isMindStrategyPlanActive,strategyPlanHash,strategyEvaluationHash,strategyHoldingEpisode,strategyPlanModules,MindStrategyError} from '../dist/domain/mind-strategy-plan.mjs';
import {evaluateStrategyGraph} from '../dist/domain/strategy-graph.mjs';
import {validateMindPaperAccount} from '../dist/domain/mind-paper.mjs';
import {validatePublicMarketSnapshot} from './market-providers.mjs';
import {resolveStrategyGraphInputs} from './quant-inputs.mjs';
import {researchSha256} from '../dist/domain/research.mjs';
import {verifyUpbitMarketCapture} from './instrument-market.mjs';
const BTC='crypto:okx:BTC-USDT',FOUR=14400000,DAY=86400000,clone=structuredClone;
const check=(c,code,message)=>{if(!c)throw new MindStrategyError(code,message,503);};
const finite=n=>typeof n==='number'&&Number.isFinite(n);
function trailingFeature({episode,bars,asOf,captureId,datasetHash,module,now}){
 const unavailable=reason=>({status:'TRAILING_NOT_APPLICABLE',reason,episodeId:episode?.episodeId??null});
 if(!episode)return unavailable('NO_HOLDING_EPISODE');
 if(bars[0][0]>Date.parse(episode.entryAt)||Date.parse(asOf)<Date.parse(episode.entryAt))return unavailable('HOLDING_PRICE_PATH_REQUIRED');
 const path=bars.filter(b=>b[0]+FOUR>=Date.parse(episode.entryAt)&&b[0]+FOUR<=Date.parse(asOf));if(!path.length)return unavailable('HOLDING_PRICE_PATH_REQUIRED');
 const peak=path.reduce((best,b)=>b[4]>best[4]?b:best),last=path.at(-1),drawdown=Math.max(0,1-last[4]/peak[4]),candidate=last[4]>episode.averageCost&&drawdown>=module.parameters.trailingStopRatio;
 return {status:'APPLICABLE',episodeId:episode.episodeId,entryAt:episode.entryAt,highWaterPrice:peak[4],highWaterObservedAt:new Date(peak[0]+FOUR).toISOString(),priceBasis:'CONFIRMED_POST_ENTRY_CLOSES',observedThrough:asOf,sourceSnapshotId:captureId,sourceDatasetHash:datasetHash,parametersVersionId:module.parametersVersionId,parametersHash:module.parametersHash,candidateObservedAt:candidate?asOf:null,candidateDetectedAt:candidate?now:null,exitCandidate:candidate,trailingDrawdown:drawdown};
}

/** Compute from the owner's full original capture; chart projections stay short. */
export function computeMindStrategyFeatures({manifest,market,capture,account=null,now,contexts=[],memories=[],knowledge=[],contextAsOf=now,trigger='manual',selection=null,campaign=null,dataCatalog=[]}={}){
 assertMindDocument(manifest);const plan=manifest.data.strategyPlan;assertMindStrategyPlan(plan);
 if(!isMindStrategyPlanActive(plan,now))return {status:'STRATEGY_PLAN_INACTIVE',evaluation:null,referenceModel:null};
 const instrumentId=market.instrument.id,currentUniverse=plan.scope.instrumentPolicy==='UNIVERSE_CURRENT';
 const upbitBtc=market.instrument.provider==='upbit'&&market.instrument.quoteCurrency==='BTC';
 check(market.timeframe==='4h'&&(instrumentId===plan.scope.instrumentId||currentUniverse&&manifest.data.universe.instrumentIds.includes(instrumentId)&&market.instrument.assetClass==='crypto'&&(market.instrument.provider==='okx'&&market.instrument.quoteCurrency==='USDT'||upbitBtc)),'STRATEGY_PLAN_SCOPE','발행한 전략과 허용 종목의 4시간봉을 선택하세요.');
 if(instrumentId!==BTC){
  if(upbitBtc)verifyUpbitMarketCapture(market,{now});
  check(currentUniverse&&market.status==='READY'&&market.source?.provider===market.instrument.provider&&market.source.dataOrigin==='PUBLIC_API'&&/^[a-f0-9]{64}$/.test((upbitBtc?market.source.rawCaptureSha256:market.source.rawSha256)??'')&&researchSha256(JSON.stringify(market.bars))===market.source.barsSha256&&market.source.availableAt<=now,'FEATURE_SOURCE_INVALID','선택 종목의 공식 확정 시세와 원문 해시를 확인하세요.');
  check(account===null||account.profileId===manifest.scope.profileId&&account.quoteCurrency===market.instrument.quoteCurrency&&!validateMindPaperAccount(account).length,'FEATURE_ACCOUNT_INVALID','전략 종목과 같은 통화의 실제 모의계좌 원장을 확인하세요.');
  const rows=market.bars.map(b=>[Date.parse(b.openTime),b.open,b.high,b.low,b.close,b.volume]);
  check(rows.length>0&&rows.every((b,i)=>b.every(Number.isFinite)&&b[0]+FOUR<=Date.parse(now)&&(!i||b[0]===rows[i-1][0]+FOUR))&&new Date(rows.at(-1)[0]+FOUR).toISOString()===new Date(Math.floor(Date.parse(now)/FOUR)*FOUR).toISOString(),'FEATURE_SOURCE_INVALID','현재까지 연속된 확정 4시간봉을 확인하세요.');
  check(!strategyPlanModules(plan).some(m=>m.moduleId==='BTC_DOC9'),'STRATEGY_MODULE_SCOPE','선택 종목 전략에는 범용 가격 전략을 연결하세요.');
  const dataset={symbol:market.instrument.symbol,timeframe:'4h',bars:rows,dailyBars:[]},datasetSha256=researchSha256(JSON.stringify(dataset));
  if(!upbitBtc&&market.source.captures)check(researchSha256(JSON.stringify(market.source.captures))===market.source.captureSha256,'FEATURE_SOURCE_INVALID','전체 시세 페이지의 수집 해시를 대조하세요.');
  const source={marketDataRef:market.source.marketDataRef??'public-series-'+datasetSha256,captureSha256:market.source.rawCaptureSha256??market.source.captureSha256??market.source.rawSha256,datasetSha256,receivedAt:market.source.receivedAt,availableAt:market.source.availableAt,usedFourHourCount:rows.length,usedDailyCount:0,provider:market.source.provider,sourceBarsSha256:market.source.barsSha256};
  return computeMindStrategyFeatureSet({manifest,dataset,bars:rows,daily:[],account,asOf:market.bars.at(-1).closeTime,source,now,contexts,memories,knowledge,contextAsOf,trigger,instrumentId,selection,campaign,dataCatalog});
 }
 check(capture?.id===market.source.marketDataRef&&capture.marketData?.dataset,'FEATURE_DATA_REQUIRED','전략 계산에 사용할 사용자 범위의 수집 정본을 준비하세요.');
 const {marketData,...sourceSnapshot}=capture,{dataset,manifest:sourceManifest}=marketData;
 const valid=validatePublicMarketSnapshot({dataset,manifest:sourceManifest,sourceSnapshot},{now,maxSnapshotAgeMs:FOUR,requirePublic:true});
 check(valid.ok&&sourceManifest.latestClosedAsOf===market.bars.at(-1).closeTime&&sourceManifest.latestClosedAsOf===new Date(Math.floor(Date.parse(now)/FOUR)*FOUR).toISOString()&&sourceManifest.availableAt<=now,'FEATURE_SOURCE_INVALID','최신 확정 봉·수신 시점·원문 전체 해시를 검증하세요.');
 check(account===null||account.profileId===manifest.scope.profileId&&account.quoteCurrency==='USDT'&&!validateMindPaperAccount(account).length,'FEATURE_ACCOUNT_INVALID','전략에 연결한 실제 모의계좌 원장을 확인하세요.');
 const asOf=market.bars.at(-1).closeTime,bars=dataset.bars.filter(b=>b[0]+FOUR<=Date.parse(asOf)),daily=dataset.dailyBars.filter(b=>b[0]+DAY<=Date.parse(asOf));
 const source={marketDataRef:capture.id,captureSha256:sourceManifest.sourceSnapshotSha256,datasetSha256:sourceManifest.datasetSha256,receivedAt:sourceManifest.receivedAt,availableAt:sourceManifest.availableAt,usedFourHourCount:bars.length,usedDailyCount:daily.length};
 return computeMindStrategyFeatureSet({manifest,dataset,bars,daily,account,asOf,source,now,contexts,memories,knowledge,contextAsOf,trigger,selection,campaign,dataCatalog});
}

/** Shared causal feature calculations; each adapter validates its own data provenance. */
export function computeMindStrategyFeatureSet({manifest,dataset,bars,daily,account=null,asOf,source,now,contexts=[],memories=[],knowledge=[],contextAsOf=now,trigger='manual',decisions={},historicalReplay=null,selection=null,campaign=null,instrumentId=manifest?.data?.strategyPlan?.scope?.instrumentId??BTC,dataCatalog=[]}={}){
 assertMindDocument(manifest);const plan=manifest.data.strategyPlan;assertMindStrategyPlan(plan);
 check(isMindStrategyPlanActive(plan,now),'STRATEGY_PLAN_INACTIVE','발행된 전략 계획의 사용 설정을 확인하세요.');
 check(Array.isArray(bars)&&bars.length>0&&Array.isArray(daily)&&Date.parse(asOf)<=Date.parse(now),'FEATURE_SOURCE_INVALID','계산할 확정 자료와 기준 시각을 확인하세요.');
 check(instrumentId===plan.scope.instrumentId||plan.scope.instrumentPolicy==='UNIVERSE_CURRENT'&&manifest.data.universe.instrumentIds.includes(instrumentId),'STRATEGY_PLAN_SCOPE','발행한 전략의 허용 종목을 확인하세요.');
 const episode=account?strategyHoldingEpisode(account,instrumentId,now):null;
 const fullAsset={symbol:instrumentId,price:bars.at(-1)[4],prices:bars.map(b=>({at:new Date(b[0]+FOUR).toISOString(),close:b[4]}))};
 const legacyPortfolio=account?{positions:Object.fromEntries(account.positions.map(p=>[p.instrumentId,{...p,symbol:p.instrumentId}])),ledger:account.ledger.map(r=>({...r,symbol:r.instrumentId}))}:null;
 const queryPins=plan.graph?.edges.some(e=>isParameterPort(e.to.port)),instrumentBinding=plan.scope.instrumentPolicy==='UNIVERSE_CURRENT'?{policy:'UNIVERSE_CURRENT',templateInstrumentId:plan.scope.instrumentId,instrumentId}:null;
 const parameterInputs=queryPins?resolveStrategyGraphInputs({graph:plan.graph,manifest,account,market:{instrument:{id:instrumentId},timeframe:dataset.timeframe??'4h'},barsTimeframe:dataset.timeframe??'4h',bars,daily,contexts,memories,knowledge,asOf,contextAsOf,historicalReplay,source,trigger,instrumentBinding,selection,campaign,dataCatalog}):null;
 const modules=[],referenceModels=[],planModules=strategyPlanModules(plan);
 const decisionGraph=plan.schemaVersion===2&&plan.graph.schemaVersion===2;
 for(const originalModule of planModules){
  const signalNode=plan.graph?.nodes.find(n=>n.id===originalModule.nodeId),resolvedModule=signalNode?resolveQueryParameters(plan.graph,signalNode,{executionInstrumentId:instrumentId}):null,m=resolvedModule?.ready?{...originalModule,...resolvedModule.node.config}:originalModule;
  const sourceNode=decisionGraph?plan.graph.nodes.find(n=>n.id===plan.graph.edges.find(e=>e.to.nodeId===m.nodeId&&e.to.port==='market')?.from.nodeId):null,resolvedSource=sourceNode?resolveQueryParameters(plan.graph,sourceNode,{executionInstrumentId:instrumentId}).node:null,parameterInput=parameterInputs&&sourceNode?resolveGraphInput(parameterInputs,sourceNode.id,{graph:plan.graph}):null,count=resolvedSource?.config.lookbackBars,moduleBars=parameterInput?.ready?parameterInput.value.bars:count?bars.slice(-count):bars,moduleDaily=parameterInput?.ready?parameterInput.value.dailyBars:count?daily.filter(b=>b[0]>=moduleBars[0][0]):daily,moduleBarMs=parameterInput?.ready?({'1m':60000,'1h':3600000,'4h':FOUR,'1d':DAY}[parameterInput.timeframe]??FOUR):FOUR,asset=parameterInput?.ready?{symbol:resolvedSource.config.instrumentId,price:moduleBars.at(-1)?.[4],prices:moduleBars.map(b=>({at:new Date(b[0]+moduleBarMs).toISOString(),close:b[4]}))}:count?{...fullAsset,prices:fullAsset.prices.slice(-count)}:fullAsset;
  const common={...(m.nodeId?{nodeId:m.nodeId}:{}),moduleId:m.moduleId,implementationVersion:m.implementationVersion,role:m.role,parametersVersionId:m.parametersVersionId,parametersHash:m.parametersHash,ready:false,missing:[],mechanicalScore:null,regime:null,indicators:{}};
  if(resolvedModule&&!resolvedModule.ready){modules.push({...common,missing:resolvedModule.missing});continue;}
  if(parameterInputs&&sourceNode&&!parameterInput?.ready){modules.push({...common,missing:parameterInput?.missing??['INPUT_NOT_READY']});continue;}
  if(m.moduleId==='MOMENTUM'){
   const feature=assessMomentum(asset,m.parameters,{asOf,barMs:moduleBarMs});modules.push({...common,ready:feature.ready,missing:feature.ready?[]:[feature.code],mechanicalScore:feature.score,indicators:feature.indicators,regime:feature.ready?(feature.score>0?'uptrend':feature.score<0?'downtrend':'flat'):null,signal:{direction:feature.action,label:'CAUSAL_PRICE_MOMENTUM',code:feature.code}});continue;
  }
  if(m.moduleId==='SMA_TREND'){
   const feature=assessSmaTrend(asset,m.parameters,{asOf,barMs:moduleBarMs});modules.push({...common,ready:feature.ready,missing:feature.ready?[]:[feature.code],mechanicalScore:feature.score,indicators:feature.indicators,regime:feature.ready?(feature.score>0?'uptrend':feature.score<0?'downtrend':'flat'):null,signal:{direction:feature.action,label:'CLOSE_VS_SMA',code:feature.code}});continue;
  }
  if(decisionGraph&&m.moduleId!=='BTC_DOC9'){
   const required=m.moduleId==='MEAN_REVERSION'?m.parameters.window:Math.max(m.parameters.longWindow,m.parameters.breakoutWindow+1,m.parameters.shortWindow+1),window=moduleBars.slice(-required);
   if(window.length<required||window.at(-1)?.[0]+moduleBarMs!==Date.parse(asOf)||window.some((bar,i)=>i>0&&bar[0]-window[i-1][0]!==moduleBarMs)){modules.push({...common,missing:['CONTIGUOUS_CLOSE_HISTORY_REQUIRED'],requiredBars:required,availableBars:window.length});continue;}
  }
  if(m.moduleId==='BTC_DOC9'&&parameterInput?.ready&&parameterInput.timeframe!=='4h'){modules.push({...common,missing:['STRATEGY_MODULE_TIMEFRAME']});continue;}
  if(m.moduleId==='BTC_DOC9'){
   const prepared=precomputeFeatures({...dataset,bars:moduleBars,dailyBars:moduleDaily},{config:m.parameters,asOf}),feature=prepared.features.at(-1),reference=decideSnapshot(feature,{config:m.parameters,currentWeight:account?.equity?account.holdingsValue/account.equity:0});
   referenceModels.push({...(m.nodeId?{nodeId:m.nodeId}:{}),moduleId:m.moduleId,label:'BTC_DOC9_INDEPENDENT_REFERENCE_MODEL',modelVersion:reference.modelVersion,action:reference.action,targetWeight:reference.targetWeight,formulaOutput:reference.probabilities,formulaOutputMeaning:'UNVALIDATED_SOFTMAX_REFERENCE_SCORES',ready:reference.ready,asOf:reference.asOf});
   modules.push({...common,ready:reference.ready,missing:clone(feature.missing),mechanicalScore:{S:reference.S,C:reference.C,coverage:reference.coverage,price:reference.categoryScores.price},indicators:{distanceScore:feature.distanceScore,slopeScore:feature.slopeScore,structureScore:feature.structureScore,dailySma:feature.dailySma,dailyAtr:feature.dailyAtr,dailyAvailableAt:feature.dailyAvailableAt,slopeSamples:feature.slopeSamples,confirmedHighs:clone(feature.confirmedHighs),confirmedLows:clone(feature.confirmedLows)}});
  }else if(m.moduleId==='MEAN_REVERSION'){
   const feature=assessMeanReversion(asset,m.parameters);modules.push({...common,ready:feature.code!=='INSUFFICIENT_HISTORY',missing:feature.code==='INSUFFICIENT_HISTORY'?['CLOSE_HISTORY_REQUIRED']:[],mechanicalScore:feature.strength,indicators:feature.indicators,signal:{direction:feature.action,label:'MEAN_REVERSION_CONDITION',code:feature.code}});
  }else{
   const opportunity=assessOpportunity(asset,m.parameters),clutch=evaluateClutchPolicy(asset,m.parameters,{portfolio:legacyPortfolio,marketAsOf:asOf,now});
   const active=opportunity.ready&&['trending','burning'].includes(opportunity.regime)&&opportunity.score>=m.parameters.minOpportunity;
   const factor=active?m.parameters.baseWeightRatio+(1-m.parameters.baseWeightRatio)*Math.max(0,Math.min(1,(opportunity.score-m.parameters.minOpportunity)/(1-m.parameters.minOpportunity))):null;
   const trailing=trailingFeature({episode,bars:moduleBars,asOf,captureId:source.marketDataRef,datasetHash:source.datasetSha256,module:m,now});
   modules.push({...common,ready:opportunity.ready,missing:opportunity.ready?[]:[opportunity.code],mechanicalScore:opportunity.score,regime:opportunity.regime,indicators:opportunity.indicators,signal:{conditionCode:clutch.code,entryCandidate:clutch.action==='buy'},allocationFactor:factor,trailing});
  }
 }
 if(!decisionGraph)check(!modules.some(m=>planModules.find(p=>m.nodeId?p.nodeId===m.nodeId:p.moduleId===m.moduleId).required&&!m.ready),'FEATURE_DATA_REQUIRED','필수 전략 지표의 연속 이력과 준비 상태를 확인하세요.');
 const evaluation={contractVersion:'mind-strategy-features-v1',status:'READY',planId:plan.planId,planVersionId:plan.planVersionId,planHash:strategyPlanHash(plan),manifestId:manifest.id,manifestHash:mindDocumentHash(manifest),instrumentId,timeframe:'4h',asOf,computedAt:now,accountSnapshotHash:account?hashInputPackage(account):null,episode,source:clone(source),modules};
 if(decisionGraph){const position=account?.positions?.find(p=>p.instrumentId===instrumentId),instrumentValue=position?position.quantity*position.marketPrice:0;const instrumentBinding=plan.scope.instrumentPolicy==='UNIVERSE_CURRENT'?{policy:'UNIVERSE_CURRENT',templateInstrumentId:plan.scope.instrumentId,instrumentId}:null;evaluation.executionInputs=parameterInputs??resolveStrategyGraphInputs({graph:plan.graph,manifest,account,bars,daily,contexts,memories,knowledge,asOf,contextAsOf,historicalReplay,source,trigger,instrumentBinding,selection,campaign});evaluation.decisionInputs=clone(decisions);evaluation.executionContext={profileId:manifest.scope.profileId,accountId:account?.id??null,currentWeight:account?.equity>0&&finite(instrumentValue)?instrumentValue/account.equity:null,inputAvailableAt:contextAsOf,...(instrumentBinding?{instrumentBinding}:{})};evaluation.trigger=trigger;}
 if(plan.schemaVersion===2)evaluation.graphEvaluation=evaluateStrategyGraph(plan.graph,modules,{asOf,sourceHash:source.datasetSha256,...(decisionGraph?{inputs:evaluation.executionInputs,decisions:evaluation.decisionInputs,context:evaluation.executionContext,trigger}:{})});
 evaluation.outputHash=strategyEvaluationHash(evaluation);assertSafeMindData(evaluation);
 return {status:'READY',evaluation,referenceModel:referenceModels};
}
export async function loadMindStrategyFeatures({repository,ownerId,manifest,market,account=null,now,contexts=[],memories=[],knowledge=[],contextAsOf=null,trigger='manual',selection=null,campaign=null,env={},fetchImpl,marketLoader}={}){
 const clock=()=>new Date(typeof now==='function'?now():now??Date.now()).toISOString();
 if(!isMindStrategyPlanActive(manifest.data.strategyPlan,clock()))return {status:'STRATEGY_PLAN_INACTIVE',evaluation:null,referenceModel:null};
 check(repository?.readObject&&typeof ownerId==='string'&&ownerId,'FEATURE_OWNER_REQUIRED','사용자 범위가 확인된 정본 저장소를 연결하세요.');
 check(market?.timeframe==='4h'&&(market.instrument?.id===BTC||manifest.data.strategyPlan.scope.instrumentPolicy==='UNIVERSE_CURRENT'&&manifest.data.universe.instrumentIds.includes(market.instrument?.id)),'STRATEGY_PLAN_SCOPE','발행한 전략의 허용 종목과 4시간봉을 선택하세요.');
 const capture=market.instrument?.id===BTC?await repository.readObject(ownerId,'marketSnapshots',market.source?.marketDataRef):null;
 const dataCatalog=await loadStrategyParameterData({manifest,baseMarket:market,env,fetchImpl,clock,marketLoader});
 const at=clock(),value=computeMindStrategyFeatures({manifest,market,capture,account,now:at,contexts,memories,knowledge,contextAsOf:dataCatalog.length?at:contextAsOf??at,trigger,selection,campaign,dataCatalog}),completedAt=clock();
 check(value.evaluation.asOf===new Date(Math.floor(Date.parse(completedAt)/FOUR)*FOUR).toISOString(),'FEATURE_SOURCE_INVALID','전략 계산 중 새 봉이 확정되었습니다. 최신 정본을 확인하세요.');
 value.evaluation.computedAt=completedAt;for(const m of value.evaluation.modules)if(m.trailing?.candidateDetectedAt)m.trailing.candidateDetectedAt=completedAt;
 return value;
}
