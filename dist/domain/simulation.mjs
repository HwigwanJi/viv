import {JEV_EXECUTION_CALL_LIMIT} from './jev-question.mjs';
import {DEFAULT_MODEL_CONFIG, FOUR_HOURS_MS, DAY_MS, MODEL_VERSION, validateDataset, resolveModelConfig, precomputeFeatures, decideSnapshot} from '../trading/model.mjs';
import {runTradingBacktest, BACKTEST_ASSUMPTIONS} from '../trading/backtest.mjs';
import {validateBenchmarkSelection} from './benchmark.mjs';
import {hashInputPackage} from './workspace.mjs';
import {graphRequiresJev,strategyGraphHash} from './strategy-graph.mjs';

export const SIMULATION_VERSION = 'btc-period-simulation-v1';
export const SIMULATION_MODES = Object.freeze(['MECHANICAL', 'JEV_RETROSPECTIVE', 'GRAPH_CANONICAL']);
export const SIMULATION_INSTRUMENTS = Object.freeze({dataInstrumentId:'crypto:binance:BTCUSDT',policyInstrumentId:'crypto:okx:BTC-USDT',baseCurrency:'BTC',quoteCurrency:'USDT',mappingVersion:'BTC_UNDERLYING_ARCHIVE_MAPPING_V1'});
export const SIMULATION_SAMPLING_VERSION = 'ALL_CLOSED_BARS_WITH_EXPLICIT_WARMUP_HOLD_V1';
export const SIMULATION_ASSUMPTIONS = Object.freeze([
  ...BACKTEST_ASSUMPTIONS,
  '자료 거래소는 Binance BTCUSDT이며 마인드 정책의 OKX BTC-USDT에 BTC·USDT 연구 매핑을 명시적으로 적용한다.',
  '선택 기간은 시작 포함·종료 제외의 연속 4시간봉이다. 준비 이력은 시작 이전의 확정 자료만 사용한다.',
  'JEV 회고 시뮬레이션은 현재 고정한 정책을 과거 시세에 적용하며 실제 호출 시각과 과거 시장 시각을 각각 보존한다.',
  '기억과 투자 자료는 각 판단의 과거 시장 시각까지 공개·승인된 자료만 선택한다. 현재 정책의 과거 적용과 당시 자료의 가용 시점을 각각 기록한다.',
  '첫 진입은 승인 비중 안에서 허용하고 기존 보유 증액은 요청한 경우 다음 시가의 수수료·슬리피지 후 청산 가치로 수익 조건을 다시 검사한다.',
  '실현 승률은 양의 순실현손익 매도 체결 수 / 전체 매도 체결 수이다. 부분 매도를 각각 한 건으로 세고 매입 원가와 매도 비용을 반영한다.',
  '일일 손실 한도는 UTC 당일 순실현손익의 손실분 / 당일 첫 실행 시가의 체결 전 평가액으로 검사한다. 미실현 가격 변동은 이 한도의 실현손실에 더하지 않는다.',
  '바이앤홀드는 같은 시작 시가·초기 자금·수수료·슬리피지로 1회 매수하고 같은 종료 종가로 평가한다. 현금 기준은 초기 자금을 유지한다.',
]);
const plain = v => v !== null && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
const finite = v => typeof v === 'number' && Number.isFinite(v);
const iso = v => new Date(v).toISOString();
const validTime = v => typeof v === 'string' && Number.isFinite(Date.parse(v)) && iso(Date.parse(v)) === v;
const identifier = v => typeof v === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_.:@-]{0,199}$/.test(v);
const clone = structuredClone;
const preparedCache = new WeakMap(), preparedTokens = new WeakSet(), frameTokens = new WeakMap();
export class SimulationError extends Error { constructor(code,message){super(message);this.name='SimulationError';this.code=code;this.status=400;} }
const check = (ok,code,message) => {if(!ok)throw new SimulationError(code,message);};
const freeze = v => {if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;};
const normalizeConfig = input => {
  const keys=['mindId','name','mode','startAt','endAt','initialCash','feeBps','slippageBps','optInJev','maxJevCalls','modelConfig','benchmarkSelection'];
  check(plain(input)&&Object.keys(input).every(k=>keys.includes(k)),'SIMULATION_CONFIG','시뮬레이션 설정 항목을 확인하세요.');
  const c={mindId:input.mindId??null,name:input.name??'기간 시뮬레이션',mode:input.mode??'MECHANICAL',startAt:input.startAt,endAt:input.endAt,initialCash:input.initialCash??10000,feeBps:input.feeBps??10,slippageBps:input.slippageBps??5,optInJev:input.optInJev??false,maxJevCalls:input.maxJevCalls??(input.mode==='JEV_RETROSPECTIVE'?512:0),modelConfig:clone(resolveModelConfig(input.modelConfig??DEFAULT_MODEL_CONFIG))};
  check((c.mindId===null||identifier(c.mindId))&&typeof c.name==='string'&&c.name.trim().length>0&&c.name.length<=160&&SIMULATION_MODES.includes(c.mode),'SIMULATION_CONFIG','마인드·이름·실행 모드를 확인하세요.');
  check(validTime(c.startAt)&&validTime(c.endAt)&&Date.parse(c.startAt)%FOUR_HOURS_MS===0&&Date.parse(c.endAt)%FOUR_HOURS_MS===0&&c.endAt>c.startAt,'SIMULATION_PERIOD','시작과 종료를 UTC 4시간봉 경계에 맞춰 선택하세요.');
  check(finite(c.initialCash)&&c.initialCash>0&&c.initialCash<=1e12&&[c.feeBps,c.slippageBps].every(v=>finite(v)&&v>=0&&v<=1000),'SIMULATION_COSTS','초기 자금과 편도 비용 범위를 확인하세요.');
  check(typeof c.optInJev==='boolean'&&Number.isInteger(c.maxJevCalls)&&c.maxJevCalls>=0&&c.maxJevCalls<=JEV_EXECUTION_CALL_LIMIT,'SIMULATION_JEV_BUDGET','JEV 호출 한도는 최대 10000회입니다.');
  check(c.mode!=='JEV_RETROSPECTIVE'||c.optInJev===true&&c.maxJevCalls>0&&identifier(c.mindId),'SIMULATION_JEV_CONSENT','JEV 회고 실행은 마인드와 호출 예산 동의가 필요합니다.');
  if(input.benchmarkSelection)c.benchmarkSelection=validateBenchmarkSelection(input.benchmarkSelection,c.startAt,c.endAt);
  return c;
};

export function validateSimulationConfig(dataset,input){
  try{
    const config=normalizeConfig(input),v=validateDataset(dataset);check(v.ok,v.reasons[0]?.code,v.reasons[0]?.message);
    check(dataset.symbol==='BTCUSDT'&&dataset.bars.length<=100000,'SIMULATION_DATASET_SCOPE','BTCUSDT 4시간봉 자료를 선택하세요.');
    const bars=dataset.bars,start=Date.parse(config.startAt),end=Date.parse(config.endAt),first=bars.findIndex(b=>b[0]===start),last=bars.findIndex(b=>b[0]+FOUR_HOURS_MS===end);
    check(start>=bars[0][0]&&end<=bars.at(-1)[0]+FOUR_HOURS_MS,'SIMULATION_COVERAGE','요청 기간 전체를 포함하는 원본 자료가 필요합니다.');
    check(first>=0&&last>=first,'SIMULATION_COVERAGE','요청 시작·종료에 대응하는 확정 봉이 필요합니다.');
    const count=(end-start)/FOUR_HOURS_MS,selected=bars.slice(first,last+1);
    check(selected.length===count&&selected.every((b,i)=>b[0]===start+i*FOUR_HOURS_MS),'SIMULATION_DATA_GAP','선택 기간에 누락된 4시간봉이 있습니다. 연속 기간을 선택하세요.');
    check(config.mode!=='JEV_RETROSPECTIVE'||count+1<=config.maxJevCalls,'SIMULATION_JEV_BUDGET','기간의 판단 수가 동의한 JEV 호출 상한을 초과합니다.');
    return {ok:true,reasons:[],config,coverage:{requestedStartAt:config.startAt,requestedEndAt:config.endAt,actualStartAt:config.startAt,actualEndAt:config.endAt,firstBarIndex:first,lastBarIndex:last,totalBars:count,totalDecisionFrames:count+1,sourceStartAt:iso(bars[0][0]),sourceEndAt:iso(bars.at(-1)[0]+FOUR_HOURS_MS),windowGapCount:0,sourceGapCount:v.gaps.length,firstReadyAt:null,earliestG5ReadyAt:null}};
  }catch(e){return {ok:false,reasons:[{code:e.code??'SIMULATION_CONFIG',message:e.message}],config:null,coverage:null};}
}

export function prepareSimulationDataset(dataset,input){
  const validated=validateSimulationConfig(dataset,input);check(validated.ok,validated.reasons[0]?.code,validated.reasons[0]?.message);
  const key=hashInputPackage(validated.config),cache=preparedCache.get(dataset);if(cache?.has(key))return cache.get(key);
  const series=precomputeFeatures(dataset,{config:validated.config.modelConfig});
  const dailyBars=dataset.dailyBars?clone(dataset.dailyBars):aggregateDaily(series.bars);
  const coverage=clone(validated.coverage);
  if(validated.config.mode==='MECHANICAL'){
    const missingCounts={},frames=[];
    for(let step=0;step<coverage.totalDecisionFrames;step++){
      const at=Date.parse(validated.config.startAt)+step*FOUR_HOURS_MS,feature=series.features[coverage.firstBarIndex-1+step];
      const missing=!feature||feature.availableAt!==at?['PREVIOUS_CLOSED_BAR_REQUIRED']:[...feature.missing];
      if(!missing.length&&!decideSnapshot(feature,{config:validated.config.modelConfig,currentWeight:0}).ready)missing.push('MECHANICAL_CATEGORY_DATA_REQUIRED');
      for(const code of missing)missingCounts[code]=(missingCounts[code]??0)+1;
      frames.push({at,ready:missing.length===0});
    }
    const ready=frames.filter(f=>f.ready);
    coverage.modelReadiness={basis:'PINNED_MECHANICAL_PARAMETERS_AND_COMPLETE_HISTORY_V1',totalDecisions:frames.length,readyDecisions:ready.length,warmupDecisions:frames.length-ready.length,firstReadyAt:ready.length?iso(ready[0].at):null,lastReadyAt:ready.length?iso(ready.at(-1).at):null,comparisonEligibility:ready.length===frames.length?'FULL_WINDOW':ready.length?'PARTIAL_WINDOW':'NO_EVALUABLE_DECISIONS',missingCounts};
  }
  coverage.firstReadyAt=series.features.find(f=>f.ready&&f.availableAt>=Date.parse(coverage.actualStartAt)&&f.availableAt<=Date.parse(coverage.actualEndAt))?.asOf??null;
  coverage.earliestG5ReadyAt=series.bars.find((b,i)=>i>=719&&series.bars[i-719][0]+719*FOUR_HOURS_MS===b[0]&&dailyBars.filter(d=>d[0]+DAY_MS<=b[0]+FOUR_HOURS_MS).length>=210)?.[0]??null;
  if(coverage.earliestG5ReadyAt!==null)coverage.earliestG5ReadyAt=iso(coverage.earliestG5ReadyAt+FOUR_HOURS_MS);
  const p=freeze({config:validated.config,configHash:key,datasetHash:hashInputPackage(dataset),series,dailyBars,coverage});preparedTokens.add(p);
  const map=cache??new Map();map.set(key,p);while(map.size>2)map.delete(map.keys().next().value);preparedCache.set(dataset,map);return p;
}
function aggregateDaily(bars){
  const groups=new Map();for(const b of bars){const day=Math.floor(b[0]/DAY_MS)*DAY_MS;const g=groups.get(day)??[];g.push(b);groups.set(day,g);}
  return [...groups].filter(([t,g])=>g.length===6&&g.every((b,i)=>b[0]===t+i*FOUR_HOURS_MS)).map(([t,g])=>[t,g[0][1],Math.max(...g.map(b=>b[2])),Math.min(...g.map(b=>b[3])),g.at(-1)[4],g.reduce((s,b)=>s+b[5],0)]);
}
function getPrepared(state,dataset,options){const p=options?.prepared??prepareSimulationDataset(dataset,state.config);check(preparedTokens.has(p)&&p.configHash===state.pins.configHash&&hashInputPackage(state.config)===state.pins.configHash&&p.datasetHash===state.pins.datasetHash&&(state.manifest?hashInputPackage(state.manifest):null)===state.pins.manifestHash,'SIMULATION_SOURCE_CHANGED','고정한 시뮬레이션 자료·설정·정책 원본을 대조하세요.');return p;}
function newAccount(initialCash,at){return {mode:'simulation',currency:'USDT',cash:initialCash,quantity:0,averageCost:0,costBasis:0,feesPaid:0,slippagePaid:0,realizedPnl:0,dailyRealizedPnl:0,equity:initialCash,asOf:at,day:at.slice(0,10),dayStartEquity:initialCash,episodeEntryAt:null,episodeEntryId:null};}
function newTotals(){return {decisionCount:0,jevCalls:0,warmupCount:0,tradeCount:0,buyCount:0,sellCount:0,curveCount:0,turnover:0,peakEquity:0,maxDrawdown:0,returnSum:0,returnSquares:0,exposureSum:0,maximumExposure:0,inMarketCount:0,grossProfit:0,grossLoss:0,winningExits:0,losingExits:0,topWinners:[],firstFillAt:null,lastFillAt:null};}

export function createSimulationState(dataset,input,{id,manifest=null,now=new Date().toISOString()}={}){
  check(identifier(id)&&validTime(now),'SIMULATION_ID','실행 ID와 실제 생성 시각을 확인하세요.');const p=prepareSimulationDataset(dataset,input);
  check(p.config.mode==='MECHANICAL'||plain(manifest),'SIMULATION_MANIFEST','마인드 실행에는 고정한 정책 원본이 필요합니다.');
  if(p.config.mode==='GRAPH_CANONICAL'){
    const plan=manifest.data?.strategyPlan,graph=plan?.graph;
    check(graph?.schemaVersion===2&&plan.status==='APPROVED'&&plan.approval?.enabled&&plan.approval.approvedAt<=now,'SIMULATION_GRAPH_REQUIRED','승인하여 발행한 실행 그래프를 선택하세요.');
    check(!graphRequiresJev(graph)||p.config.optInJev&&p.config.maxJevCalls>0,'SIMULATION_JEV_CONSENT','JEV 노드를 포함한 실험의 호출 예산에 동의하세요.');
  }
  const first=p.series.bars[p.coverage.firstBarIndex],benchmark=newAccount(p.config.initialCash,p.config.startAt);
  const initialDecision={action:'buy',targetWeight:1,code:'BUY_AND_HOLD_START',asOf:p.config.startAt,decisionBarOpenTime:first[0]-FOUR_HOURS_MS};
  executeTarget(benchmark,initialDecision,first,p.config,{allowed:true,maxOrderWeight:1,maxExposure:1,minNotional:0},'benchmark:buy');
  const totals=newTotals();totals.peakEquity=p.config.initialCash;
  const previous=p.series.bars[p.coverage.firstBarIndex-1],firstDecision=previous&&previous[0]+FOUR_HOURS_MS===first[0]?{barIndex:p.coverage.firstBarIndex-1,openTime:previous[0],asOf:p.config.startAt,sequence:1}:null;
  return {schemaVersion:1,contractVersion:SIMULATION_VERSION,id,status:'RUNNING',mode:p.config.mode,config:clone(p.config),manifest:clone(manifest),pins:{configHash:p.configHash,datasetHash:p.datasetHash,datasetHashContract:'CANONICAL_DATASET_JSON_SHA256_V1',manifestId:manifest?.id??null,manifestHash:manifest?hashInputPackage(manifest):null,modelVersion:p.config.mode==='GRAPH_CANONICAL'?manifest.data.strategyPlan.graph.contractVersion:MODEL_VERSION,...(p.config.mode==='GRAPH_CANONICAL'?{graphHash:strategyGraphHash(manifest.data.strategyPlan.graph),graphContractVersion:manifest.data.strategyPlan.graph.contractVersion,executionContractVersion:'CANONICAL_GRAPH_SIMULATION_V1'}:{}),decisionSamplingPolicyVersion:SIMULATION_SAMPLING_VERSION,endBoundaryPolicy:'SIGNAL_ONLY',riskBasis:'DAILY_REALIZED_LOSS_RATIO_V1',winnerAddPolicy:'INITIAL_ENTRY_ALLOWED_THEN_COST_INCLUSIVE_WINNER_ADDS_V1',...SIMULATION_INSTRUMENTS},coverage:{...clone(p.coverage),warmupStartAt:iso(p.series.bars[p.config.mode==='MECHANICAL'?0:Math.max(0,p.coverage.firstBarIndex-720)][0]),firstPreperiodDecisionRef:firstDecision},cursor:0,sequence:0,account:newAccount(p.config.initialCash,p.config.startAt),totals,benchmark:{account:benchmark,peakEquity:p.config.initialCash,maxDrawdown:0},rowsCounts:{decisions:0,fills:0,curve:0},createdAt:now,updatedAt:now,pendingLastDecision:null};
}

export function nextSimulationFrame(state,dataset,options={}){
  check(state?.contractVersion===SIMULATION_VERSION&&state.status==='RUNNING'&&Number.isInteger(state.cursor)&&state.cursor>=0&&state.cursor<state.coverage.totalDecisionFrames,'SIMULATION_STATE','다음 판단을 진행할 실행 상태를 확인하세요.');
  const p=getPrepared(state,dataset,options),barIndex=p.coverage.firstBarIndex-1+state.cursor,asOf=iso(Date.parse(state.config.startAt)+state.cursor*FOUR_HOURS_MS),current=p.series.bars[barIndex];
  const bar=current&&current[0]+FOUR_HOURS_MS===Date.parse(asOf)?current:null,isFinal=state.cursor===p.coverage.totalBars;
  const historicalBars=state.mode==='MECHANICAL'?[]:p.series.bars.slice(Math.max(0,barIndex-719),Math.max(0,barIndex+1)).filter(b=>b[0]+FOUR_HOURS_MS<=Date.parse(asOf));
  const dailyBars=state.mode==='MECHANICAL'?[]:p.dailyBars.filter(b=>b[0]+DAY_MS<=Date.parse(asOf)).slice(-210),feature=bar?p.series.features[barIndex]:null,missing=[];
  if(!bar)missing.push('PREVIOUS_CLOSED_BAR_REQUIRED');
  const active=state.manifest?.data?.strategyPlan?.status==='APPROVED'&&state.manifest?.data?.strategyPlan?.approval?.enabled;
  if(state.mode==='MECHANICAL')missing.push(...(feature?.missing??[]));
  else if(state.mode!=='GRAPH_CANONICAL'&&state.manifest?.data.strategyPlan?.graph?.schemaVersion!==2){
    const required=active?720:64;
    if(historicalBars.length<required||!historicalBars.slice(-required).every((b,i,a)=>i===0||b[0]-a[i-1][0]===FOUR_HOURS_MS))missing.push(active?'G5_720_CONTIGUOUS_BARS_REQUIRED':'JEV_64_CONTIGUOUS_BARS_REQUIRED');
    if(active&&(dailyBars.length<210||!dailyBars.every((b,i,a)=>i===0||b[0]-a[i-1][0]===DAY_MS)))missing.push('G5_210_DAILY_BARS_REQUIRED');
  }
  const frame=freeze({id:`${state.id}:frame:${state.cursor+1}`,sequence:state.cursor+1,barIndex,asOf,decisionAt:asOf,bar:bar?clone(bar):null,nextBar:isFinal?null:clone(p.series.bars[barIndex+1]),historicalBars:clone(historicalBars),dailyBars:clone(dailyBars),features:feature?clone(feature):null,account:clone(state.account),config:clone(state.config),ready:missing.length===0,missing:[...new Set(missing)],isFinal,stateHash:hashInputPackage(state),sourceHash:p.datasetHash});
  frameTokens.set(frame,frame.stateHash);return frame;
}

function riskPolicy(risk){
  if(risk===undefined)return {allowed:true,maxOrderWeight:1,maxExposure:1,dailyLossLimit:1,minNotional:0,winnerOnly:false,addProfitThreshold:0};
  check(plain(risk),'SIMULATION_RISK','시뮬레이션 위험 제한을 확인하세요.');
  const r={allowed:risk.allowed??true,reasonCode:risk.reasonCode??null,maxOrderWeight:risk.maxOrderWeight??1,maxExposure:risk.maxExposure??1,dailyLossLimit:risk.dailyLossLimit??1,minNotional:risk.minNotional??0,winnerOnly:risk.winnerOnly??false,addProfitThreshold:risk.addProfitThreshold??0};
  check(typeof r.allowed==='boolean'&&typeof r.winnerOnly==='boolean'&&['maxOrderWeight','maxExposure','dailyLossLimit'].every(k=>finite(r[k])&&r[k]>=0&&r[k]<=1)&&finite(r.minNotional)&&r.minNotional>=0&&finite(r.addProfitThreshold)&&r.addProfitThreshold>=0,'SIMULATION_RISK','위험 제한의 비중·손실·최소 금액을 확인하세요.');return r;
}
function executeTarget(account,decision,bar,config,risk,fillId){
  if(!['buy','sell'].includes(decision.action)||decision.allocationAction==='keep')return {fill:null,reason:'NO_ORDER_REQUIRED'};
  if(!risk.allowed)return {fill:null,reason:risk.reasonCode??'RISK_REJECTED'};
  const price=bar[1],equity=account.cash+account.quantity*price,currentValue=account.quantity*price,currentWeight=equity>0?currentValue/equity:0;
  const feeRate=config.feeBps/10000,slip=config.slippageBps/10000,side=decision.action;
  if(side==='buy'&&account.dayStartEquity>0&&Math.max(0,-account.dailyRealizedPnl)/account.dayStartEquity>=risk.dailyLossLimit&&risk.dailyLossLimit<1)return {fill:null,reason:'DAILY_LOSS_LIMIT'};
  if(side==='buy'&&risk.winnerOnly&&account.quantity>0){const net=account.quantity*price*(1-slip)*(1-feeRate),profit=net-account.quantity*account.averageCost;if(!(profit>0&&profit/(account.quantity*account.averageCost)>=risk.addProfitThreshold))return {fill:null,reason:'CLUTCH_WINNER_ONLY'};}
  const target=side==='buy'?Math.max(currentWeight,Math.min(decision.targetWeight,risk.maxExposure)):Math.min(currentWeight,decision.targetWeight);
  const fillPrice=price*(side==='buy'?1+slip:1-slip),lossPerUnit=side==='buy'?fillPrice*(1+feeRate)-price:price-fillPrice*(1-feeRate);
  let quantity=side==='buy'?Math.max(0,(target*equity-currentValue)/(price+target*lossPerUnit)):Math.max(0,(currentValue-target*equity)/(price-target*lossPerUnit));
  quantity=Math.min(quantity,side==='buy'?Math.min(account.cash/(fillPrice*(1+feeRate)),equity*risk.maxOrderWeight/(fillPrice*(1+feeRate))):Math.min(account.quantity,equity*risk.maxOrderWeight/price));
  if(!finite(quantity)||quantity<=Math.max(1e-12,account.quantity*1e-12))return {fill:null,reason:'TARGET_ALREADY_REACHED'};
  const gross=fillPrice*quantity,fee=gross*feeRate,slippageCost=Math.abs(fillPrice-price)*quantity;
  if(gross<risk.minNotional)return {fill:null,reason:'MIN_NOTIONAL'};
  const cashFlow=side==='buy'?-(gross+fee):gross-fee,realizedPnl=side==='sell'?cashFlow-account.averageCost*quantity:0,wasEmpty=account.quantity===0;
  if(side==='buy'){account.averageCost=(account.quantity*account.averageCost+gross+fee)/(account.quantity+quantity);account.quantity+=quantity;if(wasEmpty){account.episodeEntryAt=iso(bar[0]);account.episodeEntryId=fillId;}}
  else{account.quantity-=quantity;if(account.quantity<=1e-12){account.quantity=0;account.averageCost=0;account.episodeEntryAt=null;account.episodeEntryId=null;}}
  account.cash+=cashFlow;if(Math.abs(account.cash)<Math.max(1e-8,equity*1e-12))account.cash=0;
  account.costBasis=account.quantity*account.averageCost;account.feesPaid+=fee;account.slippagePaid+=slippageCost;account.realizedPnl+=realizedPnl;account.dailyRealizedPnl+=realizedPnl;
  check(account.cash>=0&&account.quantity>=0&&[account.cash,account.quantity,account.averageCost].every(finite),'SIMULATION_ACCOUNTING','체결 후 현금과 보유 수량을 확인하세요.');
  const equityAfter=account.cash+account.quantity*price,fill={...(decision.intent?{intent:clone(decision.intent)}:{}),...(decision.intentContributors?{intentContributors:clone(decision.intentContributors)}:{}),...((decision.intent||decision.intentContributors)?{positionAction:side==='buy'?(wasEmpty?'ENTRY':'ADD'):account.quantity===0?'EXIT':'REDUCE'}:{}),id:fillId,mode:'simulation',side,quantity,referencePrice:price,fillPrice,gross,fee,slippageCost,cashFlow,realizedPnl,cashAfter:account.cash,quantityAfter:account.quantity,averageCostAfter:account.averageCost,costBasisAfter:account.costBasis,equityAfter,targetWeight:target,beforeWeight:currentWeight,afterWeight:equityAfter>0?account.quantity*price/equityAfter:0,decisionAt:decision.asOf,decisionBarOpenTime:decision.decisionBarOpenTime,at:iso(bar[0]),fillBarOpenTime:bar[0],decisionCode:decision.code??null};
  return {fill,reason:'FILLED'};
}

export function applySimulationDecision(state,frame,input,{risk,targetWeight,evaluationStatus=null,missing=[],jevCalled=false,jevCallCount=null,now=state.updatedAt}={}){
  check(frameTokens.has(frame)&&frameTokens.get(frame)===frame.stateHash&&frame.stateHash===hashInputPackage(state)&&frame.sequence===state.cursor+1&&state.status==='RUNNING','SIMULATION_FRAME_CHANGED','현재 순서의 원본 판단 프레임을 사용하세요.');
  check(plain(input)&&['buy','hold','sell'].includes(input.action)&&validTime(now)&&typeof jevCalled==='boolean','SIMULATION_DECISION','판단 행동과 실제 기록 시각을 확인하세요.');
  const ready=frame.ready&&evaluationStatus!=='WARMUP_HOLD';
  check(ready||input.action==='hold'&&!jevCalled,'SIMULATION_WARMUP','준비 이력 대기 프레임은 비용 없는 Hold로 기록하세요.');
  check(Array.isArray(missing)&&missing.length<=30&&missing.every(v=>typeof v==='string'&&v.length<=200),'SIMULATION_WARMUP','준비 대기 사유를 확인하세요.');
  check(['JEV_RETROSPECTIVE','GRAPH_CANONICAL'].includes(state.mode)||!jevCalled,'SIMULATION_MODE','기계식 모드의 JEV 호출 값을 확인하세요.');
  const weight=targetWeight??input.targetWeight??(input.action==='hold'?state.account.quantity*(frame.bar?.[4]??0)/state.account.equity:undefined);
  check(finite(weight)&&weight>=0&&weight<=1,'SIMULATION_TARGET','목표 비중을 0~1 범위로 지정하세요.');
  const policy=riskPolicy(risk),next=clone(state),decision={...clone(input),asOf:frame.asOf,decisionBarOpenTime:frame.bar?.[0]??Date.parse(frame.asOf)-FOUR_HOURS_MS,targetWeight:weight};
  if(jevCallCount!==null)check(Number.isSafeInteger(jevCallCount)&&jevCallCount>=0&&jevCallCount<=9&&jevCalled===(jevCallCount>0),'SIMULATION_JEV_COUNT','실제 공급자 호출 횟수를 확인하세요.');
  const row={id:`${state.id}:decision:${frame.sequence}`,sequence:frame.sequence,at:frame.asOf,barIndex:frame.barIndex,action:decision.action,targetWeight:weight,ready,missing:[...new Set([...frame.missing,...missing])],code:decision.code??(ready?'SIMULATION_DECISION':'WARMUP_HOLD'),evaluationStatus:evaluationStatus??(ready?'DECIDED':'WARMUP_HOLD'),jevCalled,...(jevCallCount!==null?{jevCallCount}:{}),decision:clone(decision),fillId:null,executionStatus:frame.isFinal?'END_OF_PERIOD_PENDING':null};
  const rows={decisions:[row],fills:[],curve:[]};next.totals.decisionCount++;next.totals.jevCalls+=jevCallCount??Number(jevCalled);if(!ready)next.totals.warmupCount++;
  check(next.totals.jevCalls<=next.config.maxJevCalls||next.mode==='MECHANICAL','SIMULATION_JEV_BUDGET','동의한 JEV 호출 예산을 초과했습니다.');
  if(frame.nextBar){
    check(frame.nextBar[0]===Date.parse(frame.asOf),'SIMULATION_NEXT_OPEN','바로 다음 연속 봉의 시가가 필요합니다.');
    const account=next.account,bar=frame.nextBar,day=iso(bar[0]).slice(0,10);if(account.day!==day){account.day=day;account.dayStartEquity=account.cash+account.quantity*bar[1];account.dailyRealizedPnl=0;}
    const result=executeTarget(account,decision,bar,next.config,policy,`${state.id}:fill:${frame.sequence}`);row.executionStatus=result.reason;
    if(result.fill){const f={...result.fill,decisionId:row.id};rows.fills.push(f);row.fillId=f.id;const t=next.totals;t.tradeCount++;t[f.side==='buy'?'buyCount':'sellCount']++;t.turnover+=f.gross;t.firstFillAt??=f.at;t.lastFillAt=f.at;if(f.side==='sell'&&f.realizedPnl>0){t.grossProfit+=f.realizedPnl;t.winningExits++;t.topWinners.push({id:f.id,at:f.at,realizedPnl:f.realizedPnl});t.topWinners.sort((a,b)=>b.realizedPnl-a.realizedPnl);t.topWinners=t.topWinners.slice(0,5);}else if(f.side==='sell'&&f.realizedPnl<0){t.grossLoss-=f.realizedPnl;t.losingExits++;}}
    const previous=account.equity;account.equity=account.cash+account.quantity*bar[4];account.asOf=iso(bar[0]+FOUR_HOURS_MS);
    const t=next.totals,ret=account.equity/previous-1,exposure=account.equity>0?account.quantity*bar[4]/account.equity:0;t.curveCount++;t.peakEquity=Math.max(t.peakEquity,account.equity);t.maxDrawdown=Math.max(t.maxDrawdown,(t.peakEquity-account.equity)/t.peakEquity);t.returnSum+=ret;t.returnSquares+=ret*ret;t.exposureSum+=exposure;t.maximumExposure=Math.max(t.maximumExposure,exposure);t.inMarketCount+=Number(account.quantity>0);
    const b=next.benchmark;b.account.equity=b.account.cash+b.account.quantity*bar[4];b.account.asOf=account.asOf;b.peakEquity=Math.max(b.peakEquity,b.account.equity);b.maxDrawdown=Math.max(b.maxDrawdown,(b.peakEquity-b.account.equity)/b.peakEquity);
    rows.curve.push({id:`${state.id}:curve:${frame.sequence}`,sequence:frame.sequence,at:account.asOf,openTime:bar[0],equity:account.equity,cash:account.cash,quantity:account.quantity,exposure,drawdown:(t.peakEquity-account.equity)/t.peakEquity,ready,action:decision.action,buyAndHoldEquity:b.account.equity,cashBenchmarkEquity:next.config.initialCash});
  }else{next.pendingLastDecision=clone(decision);next.status='COMPLETED';}
  next.cursor++;next.sequence=next.cursor;next.rowsCounts.decisions+=rows.decisions.length;next.rowsCounts.fills+=rows.fills.length;next.rowsCounts.curve+=rows.curve.length;next.updatedAt=now;return {state:next,rows};
}

function metrics(state){
  const a=state.account,t=state.totals,n=t.curveCount,initial=state.config.initialCash,mean=n?t.returnSum/n:0,variance=n?Math.max(0,t.returnSquares/n-mean*mean):0,years=(Date.parse(state.config.endAt)-Date.parse(state.config.startAt))/(365*DAY_MS),annual=(a.equity/initial)**(1/years)-1;
  return {initialEquity:initial,finalEquity:a.equity,totalReturn:a.equity/initial-1,totalReturnPct:(a.equity/initial-1)*100,CAGR:finite(annual)?annual:null,maxDrawdown:t.maxDrawdown,sharpe:variance>0?mean/Math.sqrt(variance)*Math.sqrt(365*6):null,sharpeStatus:variance>0?'available':'unavailable-zero-variance',irregularReturnCount:0,tradeCount:t.tradeCount,buyCount:t.buyCount,sellCount:t.sellCount,realizedWinRate:t.sellCount?t.winningExits/t.sellCount:null,winningExits:t.winningExits,losingExits:t.losingExits,winRateBasis:'POSITIVE_NET_REALIZED_SELL_FILLS_OVER_ALL_SELL_FILLS_V1',feesPaid:a.feesPaid,slippagePaid:a.slippagePaid,totalCosts:a.feesPaid+a.slippagePaid,turnover:t.turnover,realizedPnl:a.realizedPnl,unrealizedPnl:a.quantity>0?a.quantity*((a.equity-a.cash)/a.quantity-a.averageCost):0,averageExposure:n?t.exposureSum/n:0,maximumExposure:t.maximumExposure,inMarketRatio:n?t.inMarketCount/n:0,profitFactor:t.grossLoss>0?t.grossProfit/t.grossLoss:null,averageWin:t.winningExits?t.grossProfit/t.winningExits:null,averageLoss:t.losingExits?t.grossLoss/t.losingExits:null,topThreeProfitShare:t.grossProfit>0?t.topWinners.slice(0,3).reduce((s,f)=>s+f.realizedPnl,0)/t.grossProfit:null,topWinners:t.topWinners.map(f=>({...f,shareOfPositiveRealizedPnl:t.grossProfit>0?f.realizedPnl/t.grossProfit:null}))};
}
export function finalizeSimulationReport(state,dataset,options={}){
  check(state.status==='COMPLETED'&&state.cursor===state.coverage.totalDecisionFrames,'SIMULATION_INCOMPLETE','선택 기간의 모든 판단과 평가를 완료하세요.');getPrepared(state,dataset,options);
  const m=metrics(state),b=state.benchmark.account,buyAndHold={id:'BUY_AND_HOLD',initialEquity:state.config.initialCash,finalEquity:b.equity,totalReturn:b.equity/state.config.initialCash-1,maxDrawdown:state.benchmark.maxDrawdown,feesPaid:b.feesPaid,slippagePaid:b.slippagePaid,totalCosts:b.feesPaid+b.slippagePaid,tradeCount:1,quantity:b.quantity},cash={id:'CASH',initialEquity:state.config.initialCash,finalEquity:state.config.initialCash,totalReturn:0,maxDrawdown:0,feesPaid:0,slippagePaid:0,totalCosts:0,tradeCount:0};
  return {schemaVersion:1,contractVersion:SIMULATION_VERSION,simulationId:state.id,name:state.config.name,mode:state.mode,status:state.status,pins:clone(state.pins),config:clone(state.config),source:{label:dataset.source,url:dataset.sourceUrl??null,synthetic:dataset.synthetic===true,...SIMULATION_INSTRUMENTS},coverage:{...clone(state.coverage),readyFrames:state.totals.decisionCount-state.totals.warmupCount,warmupFrames:state.totals.warmupCount,firstFillAt:state.totals.firstFillAt,lastExecutionAt:state.totals.lastFillAt},metrics:m,benchmarks:{buyAndHold,cash},excessReturn:{buyAndHold:m.totalReturn-buyAndHold.totalReturn,cash:m.totalReturn},account:clone(state.account),rowsCounts:clone(state.rowsCounts),jevCalls:state.totals.jevCalls,unfilledLastDecision:clone(state.pendingLastDecision),createdAt:state.createdAt,completedAt:state.updatedAt,assumptions:clone(SIMULATION_ASSUMPTIONS)};
}

/** Mechanical decisions reuse the section 9 model. The independent batch result is checked for accounting parity. */
export function runMechanicalSimulation(dataset,input,options={}){
  const config={...input,mode:'MECHANICAL',optInJev:false,maxJevCalls:0},prepared=prepareSimulationDataset(dataset,config);let state=createSimulationState(dataset,config,options);const rows={decisions:[],fills:[],curve:[]};
  while(state.status==='RUNNING'){const frame=nextSimulationFrame(state,dataset,{prepared}),weight=frame.account.equity>0?frame.account.quantity*(frame.bar?.[4]??0)/frame.account.equity:0,decision=frame.features?decideSnapshot(frame.features,{config:state.config.modelConfig,currentWeight:weight}):{action:'hold',targetWeight:weight,code:'WARMUP_HOLD'};const result=applySimulationDecision(state,frame,decision,{now:options.now??state.updatedAt});state=result.state;for(const k of Object.keys(rows))rows[k].push(...result.rows[k]);}
  const reference=runTradingBacktest(dataset,{config:config.modelConfig,initialCash:state.config.initialCash,feeBps:state.config.feeBps,slippageBps:state.config.slippageBps,startAt:state.config.startAt,endAt:state.config.endAt,prepared:prepared.series});
  check(reference.ok&&Math.abs(reference.metrics.finalEquity-state.account.equity)<=Math.max(1e-7,state.account.equity*1e-10),'SIMULATION_MECHANICAL_PARITY','순차 실행과 기준 엔진의 비용 포함 결과를 대조하세요.');return {state,rows,report:finalizeSimulationReport(state,dataset,{prepared})};
}
