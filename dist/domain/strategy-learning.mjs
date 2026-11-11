import {hashInputPackage} from './workspace.mjs';
import {compileStrategyGraph,strategyGraphHash,createStrategyModule} from './strategy-graph.mjs';
import {refreshQuantStrategyBindings} from './quant-strategy-library.mjs';
import {validateSimulationConfig} from './simulation.mjs';
import {buildSimulationBaselineComparison} from './simulation-baselines.mjs';
import {FOUR_HOURS_MS} from '../trading/model.mjs';

export const STRATEGY_LEARNING_VERSION='canonical-strategy-learning-v1';
export const STRATEGY_LEARNING_LIMITS=Object.freeze({parameters:3,candidates:12});
const H=FOUR_HOURS_MS,HASH=/^[a-f0-9]{64}$/,ID=/^[a-zA-Z0-9][a-zA-Z0-9_.:@/-]{0,199}$/;
const clone=structuredClone,finite=v=>typeof v==='number'&&Number.isFinite(v),plain=v=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.getPrototypeOf(v)===Object.prototype;
const iso=v=>typeof v==='string'&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString()===v;
const exact=(v,required,optional=[])=>plain(v)&&required.every(k=>Object.hasOwn(v,k))&&Object.keys(v).every(k=>required.includes(k)||optional.includes(k));
export class StrategyLearningError extends Error{constructor(code,message,status=400){super(message);this.code=code;this.status=status;}}
const check=(ok,code,message)=>{if(!ok)throw new StrategyLearningError(code,message);};
const freeze=v=>{if(v&&typeof v==='object'&&!Object.isFrozen(v)){Object.values(v).forEach(freeze);Object.freeze(v);}return v;};
const sealed=value=>freeze({...value,hash:hashInputPackage(value)});
const verify=(value,kind)=>{const {hash,...content}=value??{};check(HASH.test(hash)&&hashInputPackage(content)===hash&&content.contractVersion===STRATEGY_LEARNING_VERSION&&content.kind===kind,'LEARNING_RECORD_CHANGED','저장된 학습 기록의 원본 해시를 확인하세요.');return value;};
const same=(a,b)=>hashInputPackage(a)===hashInputPackage(b);
const near=(a,b)=>finite(a)&&finite(b)&&Math.abs(a-b)<=Math.max(1e-7,Math.abs(b)*1e-10);
const checkedNumber=(actual,expected,label)=>check(near(actual,expected),'LEARNING_LEDGER_CHANGED',label+' 값을 원본 거래 원장과 대조하세요.');
const EVIDENCE='RETROSPECTIVE_DEVELOPMENT';
const REGIME_POLICY=freeze({id:'PAST_CLOSED_PRICE_REGIME_V1',trendLookbackBars:120,trendDeviation:.02,volatilityLookbackBars:30,volatilityLow:.3,volatilityHigh:.8,annualBars:365*6,segmentCalendar:'UTC_MONTH',labelsRole:'DESCRIPTIVE_PAST_INPUT_ONLY'});
const DEFAULT_OBJECTIVE=freeze({returnWeight:1,drawdownPenalty:1,minImprovement:0,validationReturnTolerance:0,validationDrawdownTolerance:0});
const preparedTokens=new WeakSet(),baselineCache=new WeakMap();
const ACTION_CODES=Object.freeze(['buy','hold','sell']);
function compactDecisionSignature(decisions){
 const statuses=[...new Set(decisions.map(d=>d.executionStatus))].sort();
 return {contractVersion:'FIXED_4H_DECISION_SIGNATURE_V1',startAt:decisions[0].at,stepMs:H,count:decisions.length,statuses,rows:decisions.map(d=>[ACTION_CODES.indexOf(d.action),d.targetWeight,statuses.indexOf(d.executionStatus)])};
}
function expandDecisionSignature(signature){
 if(Array.isArray(signature))return signature;
 check(signature?.contractVersion==='FIXED_4H_DECISION_SIGNATURE_V1'&&iso(signature.startAt)&&signature.stepMs===H&&Number.isSafeInteger(signature.count)&&signature.count>0&&Array.isArray(signature.statuses)&&signature.statuses.every(v=>typeof v==='string'||v===null)&&Array.isArray(signature.rows)&&signature.rows.length===signature.count,'LEARNING_DECISION_SIGNATURE','저장된 판단 비교 기록을 확인하세요.');
 return signature.rows.map((row,i)=>{check(Array.isArray(row)&&row.length===3&&Number.isInteger(row[0])&&row[0]>=0&&row[0]<ACTION_CODES.length&&finite(row[1])&&row[1]>=0&&row[1]<=1&&Number.isInteger(row[2])&&row[2]>=0&&row[2]<signature.statuses.length,'LEARNING_DECISION_SIGNATURE','판단 비교 기록의 행동·비중·실행 상태를 확인하세요.');return {at:new Date(Date.parse(signature.startAt)+i*H).toISOString(),action:ACTION_CODES[row[0]],targetWeight:row[1],executionStatus:signature.statuses[row[2]]};});
}

/** Shared editor/API catalog. Paths address existing canonical config leaves only. */
export function strategyLearningParameterCatalog(graph){
 check(graph?.schemaVersion===2,'LEARNING_GRAPH_REQUIRED','실행 그래프를 선택하세요.');compileStrategyGraph(graph);const result=[];
 for(const n of graph.nodes){
  const add=(path,label,type,value,extra={})=>result.push({id:'parameter-'+hashInputPackage({nodeId:n.id,path}).slice(0,24),nodeId:n.id,nodeType:n.type,nodeLabel:n.label,path,label,type,currentValue:clone(value),defaultValues:[clone(value)],...extra});
  const number=(path,label,value,min=-1e9,max=1e9,integer=false)=>add(path,label,'number',value,{min,max,integer});
  if(n.type==='SIGNAL')for(const [key,value]of Object.entries(n.config.parameters))if(finite(value)){
   const lookback=['window','lookbackBars','maWindow','dailyMaWindow','atrPeriod','slopeZWindow','pivotLeft','pivotRight'].includes(key);
   number('parameters.'+key,({lookbackBars:'이동평균 기간',window:'평균회귀 기간',entryDeviation:'진입 이탈률',exitDeviation:'종료 이탈률'})[key]??key,value,lookback?2:-1e9,lookback?500:1e9,lookback);
  }
  if(n.type==='QUANT'){
   const numericKeys=n.config.targetMode==='WEIGHT_DELTA'?['buyAbove','sellBelow','buyWeightDelta','sellWeightDelta']:['buyAbove','sellBelow','buyTargetWeight',n.config.sellPositionFraction!==undefined?'sellPositionFraction':'sellTargetWeight'];
   for(const key of numericKeys)if(Object.hasOwn(n.config,key)){const label=({buyAbove:'매수 신호 기준',sellBelow:'매도 신호 기준',buyTargetWeight:'매수 목표 비중',sellTargetWeight:'매도 목표 비중',buyWeightDelta:'매수 증가 비중',sellWeightDelta:'매도 감소 비중',sellPositionFraction:'현재 보유 매도 비율'})[key];if(key.endsWith('Delta')||key==='sellPositionFraction')add(key,label,'number',n.config[key],{min:0,max:1,minimumExclusive:true,integer:false});else number(key,label,n.config[key],key.endsWith('Weight')?0:-1,1);}
   for(const key of ['onTrue','onFalse'])if(Object.hasOwn(n.config,key))add(key,key==='onTrue'?'조건 충족 행동':'조건 미충족 행동','choice',n.config[key],{choices:['buy','hold','sell']});
  }
  if(n.type==='CONDITION'){
   if(finite(n.config.value))number('value','조건 기준값',n.config.value);
   add('operator','비교 연산','choice',n.config.operator,{choices:['gt','gte','lt','lte','eq','neq']});
  }
  if(n.type==='VALUE'){
   if(finite(n.config.value))number('value','상수',n.config.value,n.config.unit==='probability'?0:n.config.unit==='signed_score'?-1:-1e9,['probability','signed_score'].includes(n.config.unit)?1:1e9);
   else if(typeof n.config.value==='boolean')add('value','조건 상수','choice',n.config.value,{choices:[false,true]});
   else if(typeof n.config.value==='string')add('value','텍스트 상수','text',n.config.value,{maxLength:12000});
  }
  if(n.type==='VIBE')add('instructions','투자 지침','text',n.config.instructions,{maxLength:6000});
  if(n.type==='JEV_QUESTION'){const instructions=n.config.question.instructions;if(typeof instructions==='string')add('question.instructions','판단 질문','text',instructions,{maxLength:12000});else if(Array.isArray(instructions))instructions.forEach((text,index)=>{if(typeof text==='string')add('question.instructions.'+index,'판단 지침 '+(index+1),'text',text,{maxLength:12000});});}
  if(n.type==='DECISION_ROUTER'&&n.config.mode==='SELECT')add('selectedNodeId','선택 전략','choice',n.config.selectedNodeId,{choices:graph.edges.filter(e=>e.to.nodeId===n.id&&e.to.port==='decisions').map(e=>e.from.nodeId)});
  if(n.type==='DECISION_MIXER')for(const w of n.config.weights)number('weights['+w.nodeId+'].value',(graph.nodes.find(v=>v.id===w.nodeId)?.label??w.nodeId)+' 가중치',w.value,0,1);
 }
 return freeze(result);
}

function applyPatches(graph,patches){
 let next=clone(graph);const touched=new Set();
 for(const p of patches){const node=next.nodes.find(n=>n.id===p.nodeId),weight=p.path.match(/^weights\[(.+)\]\.value$/);check(node,'LEARNING_PARAMETER','변경할 노드를 확인하세요.');
  if(weight)node.config.weights.find(w=>w.nodeId===weight[1]).value=clone(p.value);
  else {const parts=p.path.split('.');let target=node.config;for(const key of parts.slice(0,-1))target=target[key];target[parts.at(-1)]=clone(p.value);}touched.add(node.id);
 }
 for(const n of next.nodes)if(touched.has(n.id)){
  if(n.type==='SIGNAL')n.config=createStrategyModule(n.config.moduleId,{parameters:n.config.parameters,required:n.config.required,parametersVersionId:'learning-params-'+hashInputPackage(n.config.parameters).slice(0,24)});
  if(n.type==='DECISION_MIXER')n.config.weightVersionId='learning-weights-'+hashInputPackage(n.config.weights).slice(0,24);
 }
 next=refreshQuantStrategyBindings(next);compileStrategyGraph(next);return next;
}

/** Immutable, bounded grid fixed before any candidate result is inspected. */
export function createStrategyLearningPlan(input){
 check(exact(input,['id','graph','parameters','training','validation','simulation','datasetHash','inputContextHash','createdAt'],['objective','source']),'LEARNING_PLAN','학습 설정의 필수 항목을 확인하세요.');
 const {id,graph,parameters,training,validation,simulation,createdAt,datasetHash,inputContextHash}=input,source=input.source??null,event=!!source,step=event?Number(source.timeframe?.slice(0,-1))*60000:H;
 check(!event||exact(source,['assetMode','timeframe','quoteCurrency'],['datasetId','datasetIds'])&&['UPBIT_EVENT_STREAM','UPBIT_EVENT_UNIVERSE'].includes(source.assetMode)&&['1m','3m','5m'].includes(source.timeframe)&&['KRW','BTC'].includes(source.quoteCurrency)&&(source.assetMode==='UPBIT_EVENT_STREAM'?typeof source.datasetId==='string'&&!source.datasetIds:Array.isArray(source.datasetIds)&&source.datasetIds.length>=2&&source.datasetIds.length<=20&&new Set(source.datasetIds).size===source.datasetIds.length&&!source.datasetId),'LEARNING_EVENT_SOURCE','단일 또는 다종목의 고정 실측 자료와 분봉·통화를 확인하세요.');
 check(ID.test(id)&&iso(createdAt)&&HASH.test(datasetHash)&&HASH.test(inputContextHash),'LEARNING_SOURCE','학습 ID와 원본 자료 해시·시각을 확인하세요.');
 for(const w of [training,validation])check(exact(w,['startAt','endAt'])&&iso(w.startAt)&&iso(w.endAt)&&Date.parse(w.startAt)%step===0&&Date.parse(w.endAt)%step===0&&Date.parse(w.startAt)<Date.parse(w.endAt),'LEARNING_WINDOW','학습·검증 기간을 선택한 확정 봉 주기에 맞춰 지정하세요.');
 check(training.endAt<=validation.startAt&&validation.endAt<=createdAt,'LEARNING_TEMPORAL_SPLIT','학습 이후의 확정된 기간을 검증 구간으로 지정하세요.');
 check(exact(simulation,event?['initialCash','slippageBps']:['initialCash','feeBps','slippageBps'],event?['feeBps']:[])&&finite(simulation.initialCash)&&simulation.initialCash>0&&['feeBps','slippageBps'].filter(k=>Object.hasOwn(simulation,k)).every(k=>finite(simulation[k])&&simulation[k]>=0&&simulation[k]<=100),'LEARNING_COSTS','모든 후보가 사용할 초기 자금과 거래 비용을 고정하세요.');
 const objective={...DEFAULT_OBJECTIVE,...input.objective};check(exact(objective,Object.keys(DEFAULT_OBJECTIVE))&&Object.values(objective).every(v=>finite(v)&&v>=0)&&objective.returnWeight>0,'LEARNING_OBJECTIVE','수익·낙폭 평가 기준과 검증 허용값을 확인하세요.');
 const catalog=strategyLearningParameterCatalog(graph);
 check(Array.isArray(parameters)&&parameters.length>=1&&parameters.length<=STRATEGY_LEARNING_LIMITS.parameters,'LEARNING_PARAMETER_LIMIT','학습할 설정은 1~3개 선택하세요.');
 const seen=new Set(),dimensions=parameters.map(p=>{
  check(exact(p,['id','nodeId','path','values'],['bounds'])&&ID.test(p.id)&&!seen.has(p.id),'LEARNING_PARAMETER','학습 설정의 고유 ID를 확인하세요.');seen.add(p.id);
  const item=catalog.find(c=>c.nodeId===p.nodeId&&c.path===p.path);check(item&&!seen.has(p.nodeId+'#'+p.path),'LEARNING_PARAMETER','선택한 부품의 편집 가능한 설정을 지정하세요.');seen.add(p.nodeId+'#'+p.path);
  check(Array.isArray(p.values)&&p.values.length>0&&p.values.length<=12,'LEARNING_VALUES','후보 값을 1~12개 입력하세요.');
  if(item.type==='number')check(exact(p.bounds,['min','max'],['maxChange'])&&finite(p.bounds.min)&&finite(p.bounds.max)&&p.bounds.min>=item.min&&p.bounds.max<=item.max&&p.bounds.min<=item.currentValue&&p.bounds.max>=item.currentValue&&(!Object.hasOwn(p.bounds,'maxChange')||finite(p.bounds.maxChange)&&p.bounds.maxChange>=0),'LEARNING_BOUNDS','현재 값을 포함하는 학습 범위와 변경 한도를 지정하세요.');
  else check(!p.bounds,'LEARNING_BOUNDS','문자열과 선택지는 입력한 후보 목록으로 범위를 정하세요.');
  const values=[];for(const v of p.values){
   const allowed=item.type==='number'?finite(v)&&(!item.integer||Number.isInteger(v))&&(!item.minimumExclusive||v>item.min)&&v>=p.bounds.min&&v<=p.bounds.max&&(!Object.hasOwn(p.bounds,'maxChange')||Math.abs(v-item.currentValue)<=p.bounds.maxChange+1e-12):item.type==='choice'?item.choices.some(c=>same(c,v)):typeof v==='string'&&v.trim().length>0&&v.length<=item.maxLength;
   check(allowed,'LEARNING_VALUE','후보 값을 허용 범위 안에서 지정하세요.');if(!values.some(x=>same(x,v)))values.push(clone(v));
  }
  return {...clone(p),values,currentValue:clone(item.currentValue),type:item.type,label:item.label};
 });
 let grid=[[]];for(const p of dimensions){grid=grid.flatMap(parts=>p.values.map(value=>[...parts,{nodeId:p.nodeId,path:p.path,value}]));check(grid.length<=12,'LEARNING_CANDIDATE_LIMIT','전체 후보 조합은 기준 전략을 포함해 12개 이내로 줄이세요.');}
 const originalHash=strategyGraphHash(graph),candidates=[{id:'baseline',baseline:true,graph:clone(graph),graphHash:originalHash,patches:[]}],hashes=new Set([originalHash]);
 for(const all of grid){const patches=all.filter(p=>!same(catalog.find(c=>c.nodeId===p.nodeId&&c.path===p.path).currentValue,p.value));if(!patches.length)continue;
  const changed=applyPatches(graph,patches),graphHash=strategyGraphHash(changed);if(!hashes.has(graphHash)){hashes.add(graphHash);candidates.push({id:'candidate-'+graphHash.slice(0,24),baseline:false,graph:changed,graphHash,patches});}
 }
 check(candidates.length>=2&&candidates.length<=12,'LEARNING_CANDIDATE_LIMIT','기준 전략과 서로 다른 후보를 합쳐 2~12개 구성하세요.');
 return sealed({kind:'PLAN',contractVersion:STRATEGY_LEARNING_VERSION,id,createdAt,graph:clone(graph),sourceGraphHash:originalHash,datasetHash,inputContextHash,...(event?{source:clone(source),stepMs:step,evidencePolicy:{minimumClosedTrades:1,zeroTradeResult:'NO_EVIDENCE',statisticalSignificance:'NOT_ESTIMATED',costs:'OBSERVED_FEE_SPREAD_DEPTH_PARTIAL_FILL',candidateCount:candidates.length}}:{}),parameters:dimensions,training:clone(training),validation:clone(validation),simulation:clone(simulation),objective,regimePolicy:clone(REGIME_POLICY),candidates,evidenceClass:EVIDENCE,forwardValidation:'REQUIRED',adoptionAuthority:'DRAFT_ONLY'});
}

/** Clone once so later caller mutations cannot change the cached source identity. */
export function prepareStrategyLearningDataset(dataset){const value=freeze({dataset:clone(dataset),datasetHash:hashInputPackage(dataset)});preparedTokens.add(value);baselineCache.set(value,new Map());return value;}

function auditLedger(state,report,rows,dataset){
 const checked=validateSimulationConfig(dataset,state.config);check(checked.ok,'LEARNING_SIMULATION_CONFIG',checked.reasons[0]?.message??'실험 기간을 확인하세요.');
 const coverage=checked.coverage,bars=dataset.bars.slice(coverage.firstBarIndex,coverage.lastBarIndex+1),{initialCash,feeBps,slippageBps}=state.config;
 check(exact(rows,['decisions','fills','curve'])&&Object.values(rows).every(Array.isArray)&&rows.decisions.length===bars.length+1&&rows.curve.length===bars.length,'LEARNING_ROWS','선택 기간의 판단·체결·평가 원장을 모두 제공하세요.');
 for(const key of ['decisions','fills','curve'])check(state.rowsCounts[key]===rows[key].length&&report.rowsCounts[key]===rows[key].length,'LEARNING_ROWS','저장한 원장 개수를 대조하세요.');
 const fillMap=new Map(),decisionMap=new Map();
 rows.decisions.forEach((d,i)=>{check(d.sequence===i+1&&d.at===new Date(Date.parse(state.config.startAt)+i*H).toISOString()&&d.ready===true&&['buy','hold','sell'].includes(d.action)&&finite(d.targetWeight)&&d.targetWeight>=0&&d.targetWeight<=1&&!decisionMap.has(d.id),'LEARNING_DECISION','모든 확정 봉의 연속된 판단 기록을 확인하세요.');decisionMap.set(d.id,d);});
 check(rows.decisions.at(-1).executionStatus==='END_OF_PERIOD_PENDING'&&!rows.decisions.at(-1).fillId,'LEARNING_END_BOUNDARY','종료 시각 이후의 주문은 평가에서 제외하세요.');
 for(const f of rows.fills){const d=decisionMap.get(f.decisionId);check(d&&d.fillId===f.id&&d.at===f.at&&d.action===f.side&&f.decisionAt===d.at&&f.decisionBarOpenTime===Date.parse(f.at)-H&&f.fillBarOpenTime===Date.parse(f.at)&&!fillMap.has(f.at)&&f.quantity>0,'LEARNING_FILL_LINK','체결과 원래 확정 봉 판단을 연결하세요.');fillMap.set(f.at,f);}
 let cash=initialCash,quantity=0,costBasis=0,feesPaid=0,slippagePaid=0,realizedPnl=0,peak=initialCash,maxDrawdown=0,exposureSum=0,maximumExposure=0,winning=0;
 for(let i=0;i<bars.length;i++){
  const bar=bars[i],at=new Date(bar[0]).toISOString(),f=fillMap.get(at),d=rows.decisions[i],c=rows.curve[i];
  check(Boolean(d.fillId)===Boolean(f),'LEARNING_FILL_LINK','판단의 체결 연결과 실제 원장을 대조하세요.');
  if(f){const price=bar[1]*(1+(f.side==='buy'?1:-1)*slippageBps/10000),gross=price*f.quantity,fee=gross*feeBps/10000,slip=Math.abs(price-bar[1])*f.quantity;
   for(const [k,v]of Object.entries({referencePrice:bar[1],fillPrice:price,gross,fee,slippageCost:slip}))checkedNumber(f[k],v,k);
   let pnl=0,flow;if(f.side==='buy'){flow=-gross-fee;cash+=flow;costBasis+=gross+fee;quantity+=f.quantity;}else{check(f.quantity<=quantity+1e-9,'LEARNING_ACCOUNTING','보유 수량 안에서 체결하세요.');const removed=quantity>0?costBasis/quantity*f.quantity:0;pnl=gross-fee-removed;flow=gross-fee;cash+=flow;quantity-=f.quantity;costBasis-=removed;if(quantity<=1e-9){quantity=0;costBasis=0;}winning+=Number(pnl>0);}
   if(cash<0&&cash>-1e-7)cash=0;check(cash>=0&&quantity>=0,'LEARNING_ACCOUNTING','거래 원장의 현금과 보유 수량을 확인하세요.');feesPaid+=fee;slippagePaid+=slip;realizedPnl+=pnl;
   for(const [k,v]of Object.entries({cashFlow:flow,realizedPnl:pnl,cashAfter:cash,quantityAfter:quantity,costBasisAfter:costBasis,averageCostAfter:quantity?costBasis/quantity:0}))checkedNumber(f[k],v,k);
  }
  const equity=cash+quantity*bar[4],exposure=equity>0?quantity*bar[4]/equity:0;peak=Math.max(peak,equity);const drawdown=(peak-equity)/peak;maxDrawdown=Math.max(maxDrawdown,drawdown);exposureSum+=exposure;maximumExposure=Math.max(maximumExposure,exposure);
  check(c.sequence===i+1&&c.at===new Date(bar[0]+H).toISOString()&&c.openTime===bar[0],'LEARNING_CURVE','평가 곡선의 실제 봉 시각을 확인하세요.');for(const [k,v]of Object.entries({cash,quantity,equity,exposure,drawdown}))checkedNumber(c[k],v,k);
 }
 check(fillMap.size===rows.fills.length&&[...fillMap.keys()].every(at=>Date.parse(at)>=Date.parse(state.config.startAt)&&Date.parse(at)<Date.parse(state.config.endAt)),'LEARNING_FILL_WINDOW','선택 기간 안의 체결만 포함하세요.');
 const finalEquity=cash+quantity*bars.at(-1)[4],sellCount=rows.fills.filter(f=>f.side==='sell').length;
 const metrics={initialEquity:initialCash,finalEquity,totalReturn:finalEquity/initialCash-1,maxDrawdown,averageExposure:exposureSum/bars.length,maximumExposure,feesPaid,slippagePaid,totalCosts:feesPaid+slippagePaid,realizedPnl,tradeCount:rows.fills.length,buyCount:rows.fills.length-sellCount,sellCount,realizedWinRate:sellCount?winning/sellCount:null};
 for(const [k,v]of Object.entries(metrics))if(v===null)check(report.metrics[k]===null,'LEARNING_METRICS','실현 매도 승률의 표본을 확인하세요.');else checkedNumber(report.metrics[k],v,k);
 for(const [k,v]of Object.entries({cash,quantity,costBasis,equity:finalEquity,feesPaid,slippagePaid,realizedPnl}))checkedNumber(state.account[k],v,k);
 return {metrics,bars,firstBarIndex:coverage.firstBarIndex};
}

function segmentsAndRegimes(rows,baseline,dataset,firstBarIndex,initialCash){
 const months=new Map(),regimes=new Map();let priorEquity=initialCash,priorDca=initialCash;
 for(let i=0;i<rows.curve.length;i++){
  const c=rows.curve[i],b=baseline.curve[i],month=new Date(c.openTime).toISOString().slice(0,7),bucket=months.get(month)??{month,startAt:new Date(c.openTime).toISOString(),endAt:c.at,startEquity:priorEquity,endEquity:c.equity,startDcaEquity:priorDca,endDcaEquity:b.dailyDcaEquity,bars:0};
  bucket.endAt=c.at;bucket.endEquity=c.equity;bucket.endDcaEquity=b.dailyDcaEquity;bucket.bars++;months.set(month,bucket);
  const prefix=dataset.bars.slice(Math.max(0,firstBarIndex+i-120),firstBarIndex+i),contiguous=prefix.length===120&&prefix.at(-1)[0]+H===c.openTime&&prefix.every((bar,j)=>j===0||bar[0]-prefix[j-1][0]===H);
  let trend='INSUFFICIENT_HISTORY',volatility='INSUFFICIENT_HISTORY';
  if(contiguous){const last=prefix.at(-1)[4],ma=prefix.reduce((s,bar)=>s+bar[4],0)/120,deviation=last/ma-1;trend=deviation>.02?'UPTREND':deviation<-.02?'DOWNTREND':'RANGE_BOUND';const r=prefix.slice(-31).slice(1).map((bar,j)=>Math.log(bar[4]/prefix.slice(-31)[j][4])),mean=r.reduce((a,v)=>a+v,0)/r.length,vol=Math.sqrt(r.reduce((a,v)=>a+(v-mean)**2,0)/r.length)*Math.sqrt(365*6);volatility=vol<.3?'LOW_VOLATILITY':vol>.8?'HIGH_VOLATILITY':'NORMAL_VOLATILITY';}
  const key=trend+':'+volatility,group=regimes.get(key)??{trend,volatility,bars:0,strategyPnl:0,dcaPnl:0};group.bars++;group.strategyPnl+=c.equity-priorEquity;group.dcaPnl+=b.dailyDcaEquity-priorDca;regimes.set(key,group);priorEquity=c.equity;priorDca=b.dailyDcaEquity;
 }
 const segments=[...months.values()].map(b=>({...b,strategyReturn:b.endEquity/b.startEquity-1,dcaReturn:b.endDcaEquity/b.startDcaEquity-1,excessReturn:b.endEquity/b.startEquity-b.endDcaEquity/b.startDcaEquity}));
 return {segments,weakSegments:segments.filter(s=>s.excessReturn<0),regimes:[...regimes.values()].map(r=>({...r,excessPnl:r.strategyPnl-r.dcaPnl})),regimePolicy:clone(REGIME_POLICY)};
}

/** Caller supplies server-owned completed simulation rows; no reward is accepted from a prompt. */
export function assessStrategyLearningRun({plan,candidateId,phase,state,report,rows,dataset,inputContextHash,observedAt}){
 verify(plan,'PLAN');const candidate=plan.candidates.find(c=>c.id===candidateId),window=phase==='TRAIN'?plan.training:phase==='VALIDATION'?plan.validation:null;
 check(candidate&&window&&iso(observedAt)&&observedAt>=state.updatedAt&&state.createdAt>=plan.createdAt,'LEARNING_RUN','현재 학습 이후에 완료된 실험을 확인하세요.');
 const token=preparedTokens.has(dataset)?dataset:prepareStrategyLearningDataset(dataset),source=token.dataset;
 check(token.datasetHash===plan.datasetHash&&inputContextHash===plan.inputContextHash,'LEARNING_SOURCE_CHANGED','모든 후보의 가격·외부 자료·정책 입력을 동일하게 고정하세요.');
 check(state.status==='COMPLETED'&&state.mode==='GRAPH_CANONICAL'&&state.cursor===state.coverage.totalDecisionFrames&&state.totals.warmupCount===0&&state.pins.datasetHash===plan.datasetHash&&state.pins.graphHash===candidate.graphHash&&strategyGraphHash(state.manifest.data.strategyPlan.graph)===candidate.graphHash&&hashInputPackage(state.config)===state.pins.configHash&&hashInputPackage(state.manifest)===state.pins.manifestHash,'LEARNING_RUN_SOURCE','완료한 실행 그래프·시세·원 정책을 대조하세요.');
 check(report.simulationId===state.id&&same(report.pins,state.pins)&&same(report.config,state.config)&&report.status==='COMPLETED'&&report.coverage.warmupFrames===0,'LEARNING_REPORT_SOURCE','보고서와 실행 원본을 연결하세요.');
 check(Object.entries({...window,...plan.simulation}).every(([k,v])=>state.config[k]===v),'LEARNING_COMPARISON_CONDITIONS','후보의 기간·초기 자금·수수료·슬리피지를 동일하게 유지하세요.');
 const audit=auditLedger(state,report,rows,source),cache=baselineCache.get(token),cacheKey=hashInputPackage({...window,...plan.simulation}),reportHash=hashInputPackage(report);
 let baseline=cache.get(cacheKey);if(!baseline){baseline=buildSimulationBaselineComparison(state,source,{originReportHash:reportHash});cache.set(cacheKey,baseline);}else for(const key of ['equity','quantity','feesPaid','slippagePaid'])checkedNumber(state.benchmark.account[key],baseline.benchmarks.buyAndHold[key==='equity'?'finalEquity':key],'일시 매수 기준 '+key);
 const analysis=segmentsAndRegimes(rows,baseline,source,audit.firstBarIndex,plan.simulation.initialCash),signature=compactDecisionSignature(rows.decisions);
 return sealed({kind:'ASSESSMENT',contractVersion:STRATEGY_LEARNING_VERSION,planHash:plan.hash,candidateId,graphHash:candidate.graphHash,phase,simulationId:state.id,simulationCreatedAt:state.createdAt,completedAt:state.updatedAt,observedAt,window:clone(window),simulation:clone(plan.simulation),datasetHash:plan.datasetHash,inputContextHash,metrics:audit.metrics,benchmark:{id:'DCA_EQUAL_DAILY_BUDGET',policyHash:baseline.policyHash,totalReturn:baseline.benchmarks.dailyDca.totalReturn,finalEquity:baseline.benchmarks.dailyDca.finalEquity,averageExposure:baseline.benchmarks.dailyDca.averageExposure},excessReturn:audit.metrics.totalReturn-baseline.benchmarks.dailyDca.totalReturn,...analysis,decisionSignature:signature,decisionHash:hashInputPackage(expandDecisionSignature(signature)),sourceHashes:{state:hashInputPackage(state),report:reportHash,rows:hashInputPackage(rows),manifest:state.pins.manifestHash,config:state.pins.configHash,dataset:plan.datasetHash},verifiedRows:clone(state.rowsCounts),providerCalls:state.totals.jevCalls,evidenceClass:EVIDENCE,forwardValidation:'REQUIRED'});
}

const score=(plan,a)=>plan.objective.returnWeight*a.excessReturn-plan.objective.drawdownPenalty*a.metrics.maxDrawdown;
function assessmentSet(plan,assessments,phase,ids){
 check(Array.isArray(assessments)&&assessments.length===ids.length&&new Set(assessments.map(a=>a.candidateId)).size===ids.length,'LEARNING_ASSESSMENTS','필요한 후보의 완료 평가를 각각 한 번 제공하세요.');
 for(const a of assessments){verify(a,'ASSESSMENT');check(a.planHash===plan.hash&&a.phase===phase&&ids.includes(a.candidateId)&&a.datasetHash===plan.datasetHash&&a.inputContextHash===plan.inputContextHash,'LEARNING_ASSESSMENT_SOURCE','같은 학습 계획과 단계의 평가를 연결하세요.');}return assessments;
}
export function compareStrategyLearningDecisions(baseline,candidate){
 const a=expandDecisionSignature(baseline.decisionSignature),b=expandDecisionSignature(candidate.decisionSignature);check(a.length===b.length&&a.every((v,i)=>v.at===b[i].at),'LEARNING_DECISION_ALIGNMENT','동일 시점의 판단을 비교하세요.');
 check(hashInputPackage(a)===baseline.decisionHash&&hashInputPackage(b)===candidate.decisionHash,'LEARNING_DECISION_SIGNATURE','판단 비교 기록의 원본 해시를 대조하세요.');
 let actionChanged=0,targetWeightChanged=0,executionChanged=0,instrumentChanged=0;for(let i=0;i<a.length;i++){actionChanged+=Number(a[i].action!==b[i].action);targetWeightChanged+=Number(Math.abs(a[i].targetWeight-b[i].targetWeight)>1e-12);executionChanged+=Number(a[i].executionStatus!==b[i].executionStatus);instrumentChanged+=Number((a[i].instrumentId??null)!==(b[i].instrumentId??null));}
 return {decisions:a.length,actionChanged,targetWeightChanged,executionChanged,...(a.some(row=>row.instrumentId)||b.some(row=>row.instrumentId)?{instrumentChanged}:{}),identical:actionChanged===0&&targetWeightChanged===0&&executionChanged===0&&instrumentChanged===0,baselineDecisionHash:baseline.decisionHash,candidateDecisionHash:candidate.decisionHash};
}
/** UI/workspace projection; full immutable assessment remains in its evidence record. */
export function strategyLearningAssessmentSummary(assessment){
 verify(assessment,'ASSESSMENT');const {decisionSignature,segments,regimes,hash,kind,...summary}=assessment;return sealed({...clone(summary),kind:'ASSESSMENT_SUMMARY',assessmentHash:hash});
}
export function selectStrategyLearningCandidate({plan,assessments,selectedAt}){
 verify(plan,'PLAN');assessmentSet(plan,assessments,'TRAIN',plan.candidates.map(c=>c.id));check(iso(selectedAt)&&assessments.every(a=>a.observedAt<=selectedAt),'LEARNING_SELECTION_TIME','학습 평가 저장 후 후보를 선택하세요.');
 const baseline=assessments.find(a=>a.candidateId==='baseline'),ranked=assessments.map(a=>({candidateId:a.candidateId,score:score(plan,a),assessmentHash:a.hash,metrics:clone(a.metrics),excessReturn:a.excessReturn,decisionDifference:compareStrategyLearningDecisions(baseline,a)})).sort((a,b)=>Math.abs(b.score-a.score)>1e-12?b.score-a.score:a.candidateId==='baseline'?-1:b.candidateId==='baseline'?1:a.candidateId.localeCompare(b.candidateId));
 const enough=a=>!plan.source||a.metrics.comparisonEligible!==false&&a.metrics.closedTradeCount>=(plan.evidencePolicy?.minimumClosedTrades??1),eligible=ranked.filter(row=>enough(baseline)&&enough(assessments.find(a=>a.candidateId===row.candidateId))),winner=eligible[0]??ranked.find(a=>a.candidateId==='baseline'),improvement=winner.score-score(plan,baseline),candidateId=improvement>plan.objective.minImprovement+1e-12?winner.candidateId:'baseline',noEvidence=!!plan.source&&!eligible.length;
 return sealed({kind:'SELECTION',contractVersion:STRATEGY_LEARNING_VERSION,planHash:plan.hash,selectedAt,candidateId,selectedCandidateId:candidateId,status:noEvidence?'NO_EVIDENCE':candidateId==='baseline'?'KEEP_CURRENT':'VALIDATION_REQUIRED',trainingImprovement:candidateId==='baseline'?0:improvement,ranking:ranked,trainingAssessmentHashes:assessments.map(a=>a.hash).sort(),selectionBasis:'TRAIN_ONLY',evidenceClass:EVIDENCE});
}
export function proposeStrategyLearning({plan,selection,validation,createdAt}){
 verify(plan,'PLAN');verify(selection,'SELECTION');check(selection.planHash===plan.hash,'LEARNING_SELECTION_SOURCE','현재 학습의 선택 결과를 확인하세요.');
 const ids=[...new Set(['baseline',selection.candidateId])];assessmentSet(plan,validation,'VALIDATION',ids);
 check(iso(createdAt)&&validation.every(a=>a.simulationCreatedAt>=selection.selectedAt&&a.observedAt<=createdAt),'LEARNING_HOLDOUT_ORDER','학습 후보를 고정한 뒤 검증 실험을 새로 실행하세요.');
 const baseline=validation.find(a=>a.candidateId==='baseline'),candidate=validation.find(a=>a.candidateId===selection.candidateId),deltaReturn=candidate.metrics.totalReturn-baseline.metrics.totalReturn,deltaDrawdown=candidate.metrics.maxDrawdown-baseline.metrics.maxDrawdown;
 const enough=!plan.source||[baseline,candidate].every(a=>a.metrics.comparisonEligible!==false&&a.metrics.closedTradeCount>=(plan.evidencePolicy?.minimumClosedTrades??1)),passes=enough&&deltaReturn>=-plan.objective.validationReturnTolerance-1e-12&&deltaDrawdown<=plan.objective.validationDrawdownTolerance+1e-12,status=selection.status==='NO_EVIDENCE'||!enough?'NO_EVIDENCE':selection.candidateId==='baseline'?'KEEP_CURRENT':passes?'REVIEW_REQUIRED':'HOLDOUT_REJECTED',chosen=plan.candidates.find(c=>c.id===selection.candidateId);
 return sealed({kind:'PROPOSAL',contractVersion:STRATEGY_LEARNING_VERSION,id:plan.id+':proposal',createdAt,planHash:plan.hash,selectionHash:selection.hash,sourceGraphHash:plan.sourceGraphHash,datasetHash:plan.datasetHash,inputContextHash:plan.inputContextHash,candidateId:chosen.id,candidateGraph:clone(chosen.graph),candidateGraphHash:chosen.graphHash,patches:clone(chosen.patches),status,applied:false,authority:'DRAFT_ONLY',training:{candidateId:selection.candidateId,selectedAt:selection.selectedAt,improvement:selection.trainingImprovement,assessmentHashes:clone(selection.trainingAssessmentHashes)},validation:{baseline:strategyLearningAssessmentSummary(baseline),candidate:strategyLearningAssessmentSummary(candidate),deltaReturn,deltaDrawdown,passed:passes,decisionDifference:compareStrategyLearningDecisions(baseline,candidate)},weakSegments:clone(candidate.weakSegments),...(plan.source?{evidenceQuality:{minimumClosedTrades:plan.evidencePolicy.minimumClosedTrades,minimumRole:'LEDGER_COMPARISON_PRECONDITION',candidateCount:plan.candidates.length,trainingClosedTrades:selection.ranking.map(r=>({candidateId:r.candidateId,count:r.metrics.closedTradeCount})),validationClosedTrades:{baseline:baseline.metrics.closedTradeCount,candidate:candidate.metrics.closedTradeCount},statisticalSignificance:'NOT_ESTIMATED',profitabilityGuarantee:false,executionComparison:'RESEARCH_ONLY_NOT_LIVE_EQUIVALENT',liveLimitsNotReproduced:['PER_ORDER_ABSOLUTE_CAP','MAX_TRADES_PER_DAY','MIN_INTERVAL_MS','ABSOLUTE_DAILY_LOSS_LIMIT'],authority:'DRAFT_ONLY'}}:{}),evidenceClass:EVIDENCE,forwardValidation:'REQUIRED',validationReselection:false});
}
export function adoptStrategyLearningProposal({proposal,currentGraph,adoptedAt}){
 verify(proposal,'PROPOSAL');check(proposal.status==='REVIEW_REQUIRED','LEARNING_PROPOSAL_NOT_ACCEPTABLE','검증을 통과한 후보를 새 초안으로 채택하세요.');
 check(iso(adoptedAt)&&adoptedAt>=proposal.createdAt&&strategyGraphHash(currentGraph)===proposal.sourceGraphHash,'LEARNING_ADOPTION_SOURCE','학습을 시작한 전략과 현재 전략을 대조하세요.');
 const graph=applyPatches(currentGraph,proposal.patches);check(strategyGraphHash(graph)===proposal.candidateGraphHash,'LEARNING_ADOPTION_GRAPH','검증한 후보와 채택할 그래프를 대조하세요.');
 return freeze({graph,adoption:sealed({kind:'ADOPTION',contractVersion:STRATEGY_LEARNING_VERSION,proposalId:proposal.id,proposalHash:proposal.hash,sourceGraphHash:proposal.sourceGraphHash,candidateGraphHash:proposal.candidateGraphHash,adoptedAt,authority:'DRAFT_ONLY',published:false,activated:false,evidenceClass:EVIDENCE,forwardValidation:'REQUIRED'})});
}

/** A rejected or unadopted candidate never silently becomes the next research baseline. */
export function selectNextLearningBasis(previous){
 check(previous?.status==='COMPLETED'&&typeof previous.id==='string'&&previous.plan?.graph,'LEARNING_PARENT','완료된 학습의 기준 전략을 확인하세요.');
 const proposal=previous.proposal,adoption=previous.adoption;let graph=previous.plan.graph,reason=proposal?.status==='HOLDOUT_REJECTED'?'HOLDOUT_REJECTED':proposal?.status==='REVIEW_REQUIRED'?'UNADOPTED_CANDIDATE':'BASELINE_KEPT';
 if(adoption){
  verify(proposal,'PROPOSAL');
  // The service adds the saved document id/time to the sealed domain adoption.
  const {documentId,adoptedAt,...rest}=adoption;verify({...rest,adoptedAt},'ADOPTION');
  check(proposal.status==='REVIEW_REQUIRED'&&adoption.proposalId===proposal.id&&adoption.proposalHash===proposal.hash&&adoption.candidateGraphHash===proposal.candidateGraphHash&&adoption.sourceGraphHash===proposal.sourceGraphHash&&strategyGraphHash(previous.plan.graph)===proposal.sourceGraphHash&&strategyGraphHash(proposal.candidateGraph)===proposal.candidateGraphHash,'LEARNING_ADOPTION_SOURCE','채택한 후보와 원 학습의 전략을 대조하세요.');
  graph=proposal.candidateGraph;reason='ADOPTED_VALIDATED_CANDIDATE';
 }
 compileStrategyGraph(graph);
 return freeze({contractVersion:'NEXT_LEARNING_BASIS_V1',previousSessionId:previous.id,graph:clone(graph),graphHash:strategyGraphHash(graph),reason,proposalHash:proposal?.hash??null,adoptionHash:adoption?.hash??null,authority:'RESEARCH_BASELINE'});
}

/** Matured paper markouts guide the next human/AI research task; historical inputs stay pinned. */
export function buildStrategyLearningPaperPriorities(intake){
 check(intake?.contractVersion==='MATCHED_POLICY_MATURED_PAPER_OBSERVATIONS_V1'&&iso(intake.asOf)&&HASH.test(intake.sourceManifestHash)&&Array.isArray(intake.items)&&intake.count===intake.items.length,'LEARNING_PAPER_CONTEXT','확정된 모의 운용 관측을 확인하세요.');
 const groups=new Map(),seen=new Set();
 for(const item of intake.items){
  check(typeof item.runId==='string'&&!seen.has(item.runId)&&typeof item.instrumentId==='string'&&item.manifestHash===intake.sourceManifestHash&&iso(item.decisionAt)&&iso(item.observedAt)&&iso(item.period?.start)&&iso(item.period?.end)&&item.period.start<=item.period.end&&item.period.end<=item.observedAt&&item.observedAt<=intake.asOf&&HASH.test(item.observationHash)&&finite(item.netReturn)&&finite(item.benchmarkReturn),'LEARNING_PAPER_CONTEXT','관측의 정책·기간·원본을 대조하세요.');seen.add(item.runId);
  const month=item.decisionAt.slice(0,7),key=item.instrumentId+'|'+month;let group=groups.get(key);if(!group){group={instrumentId:item.instrumentId,month,items:[]};groups.set(key,group);}group.items.push(item);
 }
 const priorities=[...groups.values()].map(group=>{
  const items=group.items.toSorted((a,b)=>a.period.start.localeCompare(b.period.start)||a.runId.localeCompare(b.runId)),n=items.length,mean=fn=>items.reduce((sum,item)=>sum+fn(item),0)/n;let overlapPairs=0;
  for(let i=0;i<n;i++)for(let j=i+1;j<n;j++)if(items[j].period.start<items[i].period.end&&items[j].period.end>items[i].period.start)overlapPairs++;
  const meanExcessReturn=mean(item=>item.netReturn-item.benchmarkReturn);
  return {id:'paper-segment-'+hashInputPackage({instrumentId:group.instrumentId,month:group.month}).slice(0,24),instrumentId:group.instrumentId,month:group.month,sampleCount:n,meanNetReturn:mean(item=>item.netReturn),meanBenchmarkReturn:mean(item=>item.benchmarkReturn),meanExcessReturn,negativeFraction:mean(item=>Number(item.netReturn<0)),underperformedFraction:mean(item=>Number(item.netReturn<item.benchmarkReturn)),overlappingPeriodPairs:overlapPairs,status:n<3?'INSUFFICIENT_SAMPLES':meanExcessReturn<0?'REVIEW_PRIORITY':'OBSERVE',firstDecisionAt:items.map(item=>item.decisionAt).sort()[0],lastObservedAt:items.map(item=>item.observedAt).sort().at(-1),sourceObservationHashes:items.map(item=>item.observationHash),sourceRunIds:items.map(item=>item.runId)};
 }).sort((a,b)=>a.meanExcessReturn-b.meanExcessReturn||b.sampleCount-a.sampleCount||a.id.localeCompare(b.id));
 return sealed({kind:'PAPER_RESEARCH_PRIORITIES',contractVersion:STRATEGY_LEARNING_VERSION,projectionVersion:'PAPER_RESEARCH_PRIORITIES_V1',asOf:intake.asOf,sourceManifestHash:intake.sourceManifestHash,intakeHash:hashInputPackage(intake),observationCount:intake.count,grouping:'INSTRUMENT_UTC_DECISION_MONTH',diagnostic:'FIXED_POST_EXECUTION_POSITION_MARKOUT',aggregation:'ARITHMETIC_MEAN_OVER_OBSERVATIONS',independentSamples:false,minimumDescriptiveSamples:3,status:intake.count===0?'NO_OBSERVATIONS':priorities.every(p=>p.status==='INSUFFICIENT_SAMPLES')?'INSUFFICIENT_SAMPLES':'AVAILABLE',priorities,role:'NEXT_CYCLE_PARAMETER_RESEARCH',historicalInputInjection:false,selectionReward:'CANONICAL_HISTORICAL_CHILD_LEDGER',automaticWeightChange:false});
}
