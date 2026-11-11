import {SIMULATION_RESPONSE_POLICY} from '../dist/domain/simulation-response-policy.mjs';
import {strategyEvaluationHash} from '../dist/domain/mind-strategy-plan.mjs';
import dataset from '../dist/data/btc-4h.json' with {type:'json'};
import sourceManifest from '../dist/data/btc-source-manifest.json' with {type:'json'};
import {getInstrument} from '../dist/domain/instruments.mjs';
import {mindDocumentHash,assertMindDocument,MindDocumentError} from '../dist/domain/mind-manifest.mjs';
import {isMindStrategyPlanActive,strategyOpportunityModule} from '../dist/domain/mind-strategy-plan.mjs';
import {hashInputPackage} from '../dist/domain/workspace.mjs';
import {researchSha256} from '../dist/domain/research.mjs';
import {computeMindStrategyFeatureSet} from './mind-strategy-features.mjs';
import {buildMindJevRequest,evaluateMindRequest,projectCanonicalVibeRequest} from './mind-engine.mjs';
import {graphRequiresJev,evaluateStrategyGraph} from '../dist/domain/strategy-graph.mjs';

export const SIMULATION_ENGINE_VERSION='mind-historical-jevs-v1';
export const SIMULATION_LEGACY_SMA_ARITHMETIC='SMA_LEFT_FOLD_V1';
export const SIMULATION_DATA_INSTRUMENT='crypto:binance:BTCUSDT';
export const SIMULATION_POLICY_INSTRUMENT='crypto:okx:BTC-USDT';
const FOUR=14400000,DAY=86400000,clone=structuredClone;
const check=(condition,code,message)=>{if(!condition)throw new MindDocumentError(code,message);};
const iso=n=>new Date(n).toISOString();
const archiveHash=researchSha256(JSON.stringify(dataset)+'\n');

function projection(simulation,frame){
  const account=frame.account,price=frame.bar?.[4]??frame.historicalBars.at(-1)?.[4];
  check(account&&Number.isFinite(price)&&price>0,'SIMULATION_ACCOUNT_REQUIRED','실험 전용 계좌와 확정 가격을 확인하세요.');
  const fills=(simulation.fills??[]).filter(f=>Date.parse(f.at)<=Date.parse(frame.asOf));
  const ledger=fills.map((fill,index)=>({instrumentId:SIMULATION_POLICY_INSTRUMENT,runId:fill.runId??fill.decisionId??fill.id??'sim-fill-'+index,side:fill.side,at:fill.at,quantity:fill.quantity,fillPrice:fill.fillPrice,fee:fill.fee??0,realizedPnl:fill.realizedPnl??null,intent:fill.intent??null}));
  const costBasis=account.costBasis??account.quantity*account.averageCost;
  const holdingsValue=account.quantity*price,equity=account.cash+holdingsValue;
  const day=frame.asOf.slice(0,10),dailyPnl=fills.filter(f=>f.at.slice(0,10)===day).reduce((n,f)=>n+(f.realizedPnl??0),0);
  const dailyLossRatio=Math.max(0,-dailyPnl)/(account.dayStartEquity||equity);
  const accountId='simulation-account-'+simulation.id;
  return {account:{id:accountId,asOf:frame.asOf,profileId:simulation.manifest.scope.profileId,quoteCurrency:'USDT',cash:account.cash,equity,holdingsValue,positions:account.quantity>0?[{instrumentId:SIMULATION_POLICY_INSTRUMENT,quantity:account.quantity,averageCost:account.averageCost,costBasis,marketPrice:price}]:[],ledger,costPolicy:{feeBps:frame.config.feeBps,slippageBps:frame.config.slippageBps}},portfolio:{accountId,accountAsOf:frame.asOf,quoteCurrency:'USDT',cash:account.cash,quantity:account.quantity,equity,weight:equity>0?holdingsValue/equity:0,dailyLossRatio,feeBps:frame.config.feeBps,slippageBps:frame.config.slippageBps,valuationSource:{basis:'SIMULATION_ARCHIVE_CONFIRMED_CLOSE',asOf:frame.asOf,datasetSha256:archiveHash}}};
}

/** Prepare exact bytes before the server reserves an external call. */
export function prepareSimulationFrame({simulation,frame,now=new Date().toISOString(),featureArithmetic=null}={}){
  check(archiveHash===sourceManifest.datasetSha256,'SIMULATION_SOURCE_HASH','보관 시세 파일과 원문 목록의 해시를 대조하세요.');
  assertMindDocument(simulation?.manifest);
  check(['JEV_RETROSPECTIVE','GRAPH_CANONICAL'].includes(frame?.config?.mode)&&frame.asOf<=now&&simulation.createdAt<=now,'SIMULATION_FRAME_SCOPE','실험 모드·시세 기준·실제 실행 시각을 확인하세요.');
  check(simulation.manifest.scope.profileId===frame.config.mindId&&simulation.manifest.data.universe.instrumentIds.includes(SIMULATION_POLICY_INSTRUMENT),'SIMULATION_MIND_SCOPE','BTC를 허용한 고정 마인드 정책을 선택하세요.');
  const mapping={version:'BTC_UNDERLYING_ARCHIVE_MAPPING_V1',baseAsset:'BTC',quoteCurrency:'USDT',policyInstrumentId:SIMULATION_POLICY_INSTRUMENT,dataInstrumentId:SIMULATION_DATA_INSTRUMENT,policyVenue:'OKX',dataVenue:'BINANCE',executionVenue:'SIMULATION_NEXT_OPEN',datasetSha256:archiveHash,barAlignment:'UTC_4H',priceBasis:'BINANCE_ARCHIVED_SPOT_OHLC',volumeBasis:'BINANCE_BASE_ASSET_VOLUME',venuePriceDifference:'NOT_MEASURED',applicableModules:['BTC_DOC9','OPPORTUNITY','MEAN_REVERSION','SMA_TREND'],costPolicy:'EXPERIMENT_EXPLICIT_FEE_AND_SLIPPAGE_BPS',policyApplication:'SAME_BTC_UNDERLYING_WITH_DISTINCT_VENUE_PROVENANCE'};
  const prepared={ready:frame.ready!==false,manifest:simulation.manifest,frame,sourceMapping:mapping,simulationId:simulation.id,actualRequestedAt:now};
  if(!prepared.ready){prepared.missing=clone(frame.missing??[]);return prepared;}
  const cutoff=Date.parse(frame.asOf),bars=frame.historicalBars??dataset.bars.filter(b=>b[0]+FOUR<=cutoff).slice(-720),daily=frame.dailyBars??dataset.dailyBars.filter(b=>b[0]+DAY<=cutoff).slice(-210);
  check(bars.length>0&&bars.every(b=>b[0]+FOUR<=cutoff)&&daily.every(b=>b[0]+DAY<=cutoff),'SIMULATION_FUTURE_DATA','시세 기준까지 확정된 봉만 입력하세요.');
  check(bars.at(-1)[0]+FOUR===cutoff,'SIMULATION_FRAME_BOUNDARY','마지막 확정 봉과 실험 시세 기준을 대조하세요.');
  const rows=bars.map(b=>({openTime:iso(b[0]),closeTime:iso(b[0]+FOUR),open:b[1],high:b[2],low:b[3],close:b[4],volume:b[5],isClosed:true}));
  const instrument={...getInstrument(SIMULATION_POLICY_INSTRUMENT),venue:'BINANCE',symbol:'BTCUSDT',provider:'binance-public-archive',dataInstrumentId:SIMULATION_DATA_INSTRUMENT};
  const receivedAt=simulation.createdAt,source={provider:'binance-public-archive',dataOrigin:'BUNDLED_PUBLIC_ARCHIVE',rawContentType:'ARCHIVED_DATASET_JSON',rawSha256:archiveHash,barsSha256:researchSha256(JSON.stringify(rows)),datasetSha256:archiveHash,asOf:frame.asOf,receivedAt,availableAt:receivedAt,sourceUrl:dataset.sourceUrl,acquisitionMeaning:'SIMULATION_FROZEN_ARCHIVE_REFERENCE',freshnessPolicy:'HISTORICAL_CLOSED_BARS_V1'};
  const market={status:'READY',instrument,timeframe:'4h',bars:rows,source,quote:{price:rows.at(-1).close,currency:'USDT',asOf:frame.asOf,freshness:'HISTORICAL_REFERENCE',priceBasis:'HISTORICAL_CONFIRMED_CLOSE',executionAllowed:false}};
  const historicalReplay=simulation.knowledgeReplay??null;const projected=projection(simulation,frame);let strategyEvaluation=null;
  if(isMindStrategyPlanActive(simulation.manifest.data.strategyPlan,now)){
    try{
      const result=computeMindStrategyFeatureSet({manifest:simulation.manifest,dataset:{...dataset,bars,dailyBars:daily},bars,daily,account:projected.account,asOf:frame.asOf,source:{marketDataRef:'simulation-archive-'+archiveHash.slice(0,24),captureSha256:archiveHash,datasetSha256:archiveHash,receivedAt,availableAt:receivedAt,usedFourHourCount:bars.length,usedDailyCount:daily.length},contexts:simulation.contexts??[],memories:simulation.memories??simulation.manifest.data.approvedMemory,knowledge:simulation.knowledge??[],contextAsOf:frame.asOf,historicalReplay,trigger:'closed_bar',now});
      strategyEvaluation=result.evaluation;
      // Historical recovery pins the verified original arithmetic for the remaining frames.
      if(featureArithmetic!==null){
        check(featureArithmetic===SIMULATION_LEGACY_SMA_ARITHMETIC,'SIMULATION_ARITHMETIC','저장된 계산 방식 식별값을 확인하세요.');
        for(const module of strategyEvaluation.modules.filter(value=>value.moduleId==='SMA_TREND'&&value.ready)){
          const node=simulation.manifest.data.strategyPlan.graph.nodes.find(node=>node.id===module.nodeId),window=bars.slice(-node.config.parameters.lookbackBars),slowMA=window.reduce((sum,bar)=>sum+bar[4],0)/window.length,close=window.at(-1)[4],score=close>slowMA?1:close<slowMA?-1:0;
          module.mechanicalScore=score;module.regime=score>0?'uptrend':score<0?'downtrend':'flat';module.signal.direction=score>0?'buy':score<0?'sell':'hold';module.indicators={close,slowMA,deviation:close/slowMA-1,lookbackBars:node.config.parameters.lookbackBars};
        }
        const e=strategyEvaluation;e.graphEvaluation=evaluateStrategyGraph(simulation.manifest.data.strategyPlan.graph,e.modules,{asOf:e.asOf,sourceHash:e.source.datasetSha256,inputs:e.executionInputs,decisions:e.decisionInputs,context:e.executionContext,trigger:e.trigger});e.outputHash=strategyEvaluationHash(e);
      }

    }catch(error){if(error.code==='FEATURE_DATA_REQUIRED')return {...prepared,ready:false,missing:['REQUIRED_STRATEGY_FEATURES'],request:null};throw error;}
  }
  const graph=simulation.manifest.data.strategyPlan?.graph;
  if(graph?.schemaVersion===2&&strategyEvaluation?.graphEvaluation?.output?.status==='BLOCKED')return {...prepared,ready:false,missing:['GRAPH_INPUTS_REQUIRED',...(strategyEvaluation.graphEvaluation.output.reasonCodes??[])].slice(0,30),request:null,strategyEvaluation};
  const simulationContext={engineVersion:SIMULATION_ENGINE_VERSION,experimentType:'RETROSPECTIVE_POLICY_SIMULATION',simulationId:simulation.id,historicalAsOf:frame.asOf,actualRequestedAt:now,policyAvailableAt:simulation.manifest.availableAt,policyApplication:'CURRENT_FROZEN_POLICY_ON_ARCHIVED_PRICES',knowledgeCutoff:frame.asOf,sourceMapping:mapping,fillTiming:'NEXT_CONTIGUOUS_BAR_OPEN_ZERO_LATENCY_RESEARCH_ASSUMPTION',modelTrainingKnowledge:'CURRENT_MODEL_PRIOR_KNOWLEDGE_MAY_INCLUDE_HISTORY'};
  const request=buildMindJevRequest(simulation.manifest,market,{portfolio:projected.portfolio,contexts:simulation.contexts??[],memories:simulation.memories??simulation.manifest.data.approvedMemory,knowledge:simulation.knowledge??[],strategyEvaluation,trigger:'simulation.period',now,contextAsOf:frame.asOf,simulationContext,historicalReplay});
  const requiresJev=graph?.schemaVersion===2?graphRequiresJev(graph,strategyEvaluation.graphEvaluation):true,providerRequest=requiresJev?(graph?.schemaVersion===2?projectCanonicalVibeRequest(request,simulation.manifest):request):null;
  return {...prepared,request,requestHash:hashInputPackage(request),providerRequest,providerRequestHash:providerRequest?hashInputPackage(providerRequest):null,market,strategyEvaluation,portfolio:projected.portfolio,requiresJev};
}

export async function evaluateSimulationFrame({simulation,frame,prepared=null,env={},fetchImpl=fetch,clock=()=>new Date().toISOString(),savedProviderResult=null,validationPolicy=null,providerHooks=null}={}){
  const input=prepared??prepareSimulationFrame({simulation,frame,now:new Date(clock()).toISOString()});
  if(!input.ready)return {decision:{action:'hold',stance:'defensive',confidence:null,evidenceRefs:[],provider:'warmup-rule',asOf:frame.asOf},risk:{allowed:false,reasons:[{code:'WARMUP_HOLD',message:'필수 지표의 선행 자료를 준비합니다.'}],targetWeight:frame.account.equity?frame.account.quantity*(frame.bar?.[4]??0)/frame.account.equity:0},targetWeight:0,rawRequest:null,rawResponse:null,provider:null,evaluationStatus:'WARMUP_HOLD',jevCalled:false,missing:clone(input.missing),sourceMapping:input.sourceMapping,...(input.strategyEvaluation?{strategyEvaluation:input.strategyEvaluation,graphEvaluation:input.strategyEvaluation.graphEvaluation}:{})};
  check(input.requestHash===hashInputPackage(input.request)&&input.manifest.id===simulation.manifest.id&&mindDocumentHash(input.manifest)===mindDocumentHash(simulation.manifest)&&input.frame.asOf===frame.asOf,'SIMULATION_PREPARED_CHANGED','호출 예약에 저장한 요청·정책·봉을 보존하세요.');
  if(input.requiresJev&&input.providerRequest)check(input.providerRequestHash===hashInputPackage(input.providerRequest)&&input.providerRequestHash===hashInputPackage(simulation.manifest.data.strategyPlan?.graph?.schemaVersion===2?projectCanonicalVibeRequest(input.request,input.manifest):input.request),'SIMULATION_PREPARED_CHANGED','호출 예약에 저장한 실제 전송 입력을 보존하세요.');
  const result=await evaluateMindRequest({request:input.request,manifest:input.manifest,market:input.market,env,fetchImpl,clock,...(validationPolicy?{validationPolicy}:{}),savedProviderResult,providerHooks});
  const plan=input.manifest.data.strategyPlan,limits=input.manifest.data.riskPreset;
  const clutch=result.decision.action==='buy'&&result.decision.stance==='clutch'&&isMindStrategyPlanActive(plan,input.actualRequestedAt);
  const opportunity=plan?strategyOpportunityModule(plan):null;
  const maxExposure=clutch?Math.min(limits.maxExposure,plan.allocation.strategyMaxExposure):limits.maxExposure;
  const jevCalled=input.requiresJev!==false,canonical=plan?.graph?.schemaVersion===2;
  return {...result,targetWeight:result.risk.targetWeight,risk:{...result.risk,maxExposure,dailyLossLimit:limits.dailyLossLimit,minNotional:limits.minNotional,winnerOnly:Boolean(clutch&&plan.allocation.winnerOnly),addProfitThreshold:opportunity?.parameters.addProfitThreshold??0},strategyEvaluation:result.strategyEvaluation??input.strategyEvaluation,evaluationStatus:canonical?(jevCalled?'GRAPH_JEV_EVALUATED':'GRAPH_QUANT_EVALUATED'):'JEV_EVALUATED',jevCalled,sourceMapping:input.sourceMapping,experimentType:'RETROSPECTIVE_POLICY_SIMULATION'};
}
