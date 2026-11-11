import {getInstrument} from './instruments.mjs';
import {hashInputPackage} from './workspace.mjs';

export const STRATEGY_PARAMETER_VERSION='strategy-parameter-pins-v1';
export const STRATEGY_TIMEFRAMES=Object.freeze(['1m','3m','5m','1h','4h','1d']);
export const isParameterPort=port=>typeof port==='string'&&port.startsWith('param:');
export function strategyTimeframeParameter(graph,nodeId=null){
 const input=nodeId?graph?.nodes.find(n=>n.id===nodeId):graph?.nodes.find(n=>n.type==='INPUT'&&n.config.kind==='ASSET_SET')??graph?.nodes.find(n=>strategyParameters(n).some(p=>p.key==='timeframe'));
 if(input){const edge=graph.edges.find(e=>e.to.nodeId===input.id&&e.to.port==='param:timeframe'),source=edge&&graph.nodes.find(n=>n.id===edge.from.nodeId);return {nodeId:source?.id??input.id,field:source?'value':'timeframe',value:source?.config.value??input.config.timeframe};}
 const model=graph?.nodes.find(n=>n.type==='MODEL'&&n.config.model?.timeframe);
 return model?{nodeId:model.id,field:'model',value:model.config.model.timeframe}:null;
}
export function synchronizeStrategyTimeframe(previous,next){
 if(!next.executionScope)return next;
 const before=strategyTimeframeParameter(previous),after=strategyTimeframeParameter(next);
 if(!before||!after||before.value===after.value)return next;
 const synchronized=structuredClone(next);synchronized.executionScope.timeframe=after.value;
 for(const node of synchronized.nodes)if(node.type==='INPUT'&&['ASSET_SET','MICROSTRUCTURE'].includes(node.config.kind)&&!synchronized.edges.some(e=>e.to.nodeId===node.id&&e.to.port==='param:timeframe'))node.config.timeframe=after.value;
 return synchronized;
}
const clone=structuredClone,number=(key,label,unit,min,max,extra={})=>({key,label,dataType:'NUMBER',unit,min,max,...extra});

/** One field contract serves the canvas, compiler, preparation and evaluator. */
export function strategyParameters(node){
 const c=node?.config??{},result=[];
 if(node?.type==='INPUT'&&!['EXECUTION_ASSET'].includes(c.kind)){
  if(!(c.kind==='POSITION'&&c.metricId==='PORTFOLIO')&&(isCanonicalInstrument(c.instrumentId)||c.instrumentId==='execution:current'))result.push({key:'instrumentId',label:'종목',dataType:'INSTRUMENT',phase:'QUERY'});
  if(c.kind==='ASSET_SET'&&!c.instrumentId)result.push({key:'instrumentIds',label:'판단 대상 종목 목록',dataType:'INSTRUMENT_SET',phase:'QUERY'});
  if(c.timeframe)result.push({key:'timeframe',label:'봉 주기',dataType:'TIMEFRAME',choices:c.kind==='ASSET_SET'?['1d','1h','1m','3m','5m']:c.kind==='MICROSTRUCTURE'?['1m','3m','5m']:['1m','1h','4h','1d'],phase:'QUERY'});
  if(c.kind==='OHLCV'||c.kind==='MICROSTRUCTURE')result.push(number('lookbackBars','관측 봉 수','count',2,c.kind==='OHLCV'?1000:500,{integer:true,phase:'QUERY'}));
  if(!['ASSET_SET'].includes(c.kind))result.push(number('maxAgeMs','자료 유효 기간','ms',0,Number.MAX_SAFE_INTEGER,{integer:true,phase:'QUERY'}));
  if(c.kind==='MICROSTRUCTURE')result.push(...['flowWindowMs','bookMaxAgeMs'].map((key,i)=>number(key,['체결 집계 기간','호가 유효 기간'][i],'ms',0,Number.MAX_SAFE_INTEGER,{integer:true,phase:'QUERY'})));
  if(c.kind==='POSITION'&&c.metricId==='INTENT_COOLDOWN_READY')result.push(number('cooldownMs','재실행 대기','ms',0,Number.MAX_SAFE_INTEGER,{integer:true,phase:'QUERY'}));
 }
 if(node?.type==='SIGNAL'&&['MEAN_REVERSION','SMA_TREND','MOMENTUM'].includes(c.moduleId))result.push(number(c.moduleId==='MEAN_REVERSION'?'window':'lookbackBars','계산 기간','count',2,500,{integer:true,phase:'QUERY',group:'parameters'}));
 if(node?.type==='CONDITION'&&c.rightOperand!=='INPUT')result.push(number('value','기준값',null,-1e14,1e14));
 if(node?.type==='ASSET_METRIC'&&c.metric==='EMA_RATIO')result.push(number('slowLookback','느린 평균 기간','count',2,500,{integer:true,phase:'QUERY'}));
 if(node?.type==='ASSET_METRIC')result.push(number('lookback','계산 기간','count',1,500,{integer:true,phase:['MONTHLY_SMA_DISTANCE','EMA_DISTANCE','EMA_RATIO','WEEKLY_EMA_DISTANCE'].includes(c.metric)?'QUERY':'EVAL'}));
 if(node?.type==='MARKET_STATE')result.push(number('lookback','국면 계산 기간','count',24,72,{integer:true}));
 if(node?.type==='PORTFOLIO_EXPERT')result.push(number('maxPositions','동시 종목 수','count',1,20,{integer:true}),number('maxAssetWeight','종목별 최대 비중','ratio',0,1));
 if(node?.type==='PORTFOLIO_ROUTER'){result.push(number('trainingBars','완료된 학습 기간','count',24,720,{integer:true}),number('horizonHours','보유 성과 예측 시간','count',1,24,{integer:true}),number('bandwidth','시장 유사도 범위',null,.01,10),number('temperature','배분 민감도',null,.00001,.1),number('costBps','편도 비용 bp',null,0,100),number('minWeightChange','최소 비중 조정','ratio',0,1));if(Object.hasOwn(c,'newsReturnBps'))result.push(number('newsReturnBps','뉴스 수익 계수','bps',-10000,10000),number('newsHalfLifeHours','뉴스 반감기','count',1,720));if(Object.hasOwn(c,'returnQuantile'))result.push(number('returnQuantile','수익 분포 백분위','ratio',.5,.99));if(Object.hasOwn(c,'rebalanceEveryHours'))result.push(number('rebalanceEveryHours','배분 판단 주기','count',1,24,{integer:true}));}
 if(node?.type==='ASSET_COMPARE')result.push(number('value','기준값',null,-1e14,1e14));
 if(node?.type==='SELECT')result.push(number('maxPositions','선택 개수','count',1,20,{integer:true}));
 if(node?.type==='QUANT'){
  result.push(number('buyTargetWeight','매수 목표 비중','ratio',0,1),number('sellTargetWeight','매도 목표 비중','ratio',0,1));
  for(const [key,label,unit,min,max]of [['buyAbove','매수 신호 기준','signed_score',-1,1],['sellBelow','매도 신호 기준','signed_score',-1,1],['sellPositionFraction','남은 물량 매도 비율','ratio',0,1],['buyWeightDelta','매수 증가 비중','ratio',0,1],['sellWeightDelta','매도 감소 비중','ratio',0,1]])if(Object.hasOwn(c,key))result.push(number(key,label,unit,min,max));
 }
 if(node?.type==='RISK'&&!c.mode)result.push(...['maxExposure','maxOrderWeight','minConfidence'].map((key,i)=>number(key,['최대 보유 비중','1회 변경 비중','최소 확신도'][i],'ratio',0,1)));
 return result.map(p=>({...p,phase:p.phase??'EVALUATE',portId:'param:'+p.key}));
}
export function parameterPortContracts(node){return strategyParameters(node).map(parameter=>({id:parameter.portId,dataType:parameter.dataType,accepts:parameter.dataType==='INSTRUMENT'?['INSTRUMENT','TEXT']:[parameter.dataType],minConnections:0,maxConnections:1,parameter}));}
export const parameterLiteral=(node,spec)=>spec.group?node.config[spec.group]?.[spec.key]:node.config[spec.key];
export function applyParameterValue(config,spec,value){if(!spec.group)return {...config,[spec.key]:value};const parameters={...config.parameters,[spec.key]:value};return {...config,parameters,parametersHash:hashInputPackage(parameters)};}
export const parameterSpec=(node,port)=>strategyParameters(node).find(p=>p.portId===port)??null;
export const isCanonicalInstrument=value=>{try{return typeof value==='string'&&getInstrument(value).id===value;}catch{return false;}};
export const isCanonicalInstrumentSet=value=>Array.isArray(value)&&value.length>0&&value.length<=500&&new Set(value).size===value.length&&value.every(isCanonicalInstrument);
const duration={ms:1,seconds:1000,minutes:60000,hours:3600000};
export function parameterValue(spec,value,unit=null){
 const fail=(code,message)=>({ready:false,code,message,value:null});
 if(spec.dataType==='INSTRUMENT_SET')return isCanonicalInstrumentSet(value)?{ready:true,value:structuredClone(value)}:fail('GRAPH_PARAMETER_INSTRUMENT_SET','중복 없이 정식 종목 참조를 1~500개 연결하세요.');
 if(spec.dataType==='INSTRUMENT')return isCanonicalInstrument(value)?{ready:true,value}:fail('GRAPH_PARAMETER_INSTRUMENT','종목 이름 대신 거래소·통화가 포함된 정식 종목 참조를 연결하세요.');
 if(spec.dataType==='TIMEFRAME')return (spec.choices??STRATEGY_TIMEFRAMES).includes(value)?{ready:true,value}:fail('GRAPH_PARAMETER_TIMEFRAME','이 자료에서 지원하는 봉 주기를 연결하세요.');
 if(typeof value!=='number'||!Number.isFinite(value))return fail('GRAPH_PARAMETER_VALUE','유한한 숫자를 연결하세요.');
 if(spec.unit){
  if(spec.unit==='ms'&&duration[unit])value*=duration[unit];
  else if(spec.unit!==unit)return fail('GRAPH_PARAMETER_UNIT',spec.label+'에 필요한 단위는 '+spec.unit+'입니다.');
 }
 if(value<spec.min||value>spec.max||spec.integer&&!Number.isSafeInteger(value))return fail('GRAPH_PARAMETER_RANGE',spec.label+'의 범위'+(spec.integer?'와 정수 여부':'')+'를 확인하세요.');
 return {ready:true,value};
}
export function inspectParameterSource(source,target,port){
 const spec=parameterSpec(target,port);if(!spec)return null;
 if(spec.phase==='QUERY'&&!(source.type==='VALUE'||source.type==='INPUT'&&source.config.kind==='EXECUTION_ASSET'))return {code:'GRAPH_PARAMETER_QUERY_PHASE',message:'조회 전 종목·기간은 값 변수 또는 현재 평가 종목에서 확정합니다. 조회 결과는 계산·판정 입력에 연결하세요.'};
 if(spec.dataType==='INSTRUMENT'&&source.type==='INPUT'&&source.config.kind==='EXECUTION_ASSET')return null;
 if(spec.dataType==='INSTRUMENT'&&!(source.type==='VALUE'&&['INSTRUMENT','TEXT'].includes(source.config.dataType)&&isCanonicalInstrument(source.config.value)))return {code:'GRAPH_PARAMETER_INSTRUMENT',message:'거래소와 통화가 포함된 정식 종목 변수를 연결하세요.'};
 if(source.type==='VALUE'){
  const checked=parameterValue(spec,source.config.value,source.config.unit??(source.config.dataType==='NUMBER'?'scalar':null));if(!checked.ready)return checked;
 }
 return null;
}
/** QUERY values are resolved before any adapter selects or requests market data. */
export function resolveQueryParameters(graph,node,{executionInstrumentId=null}={}){
 let config=node.config,bindings=[];
 for(const edge of (graph.edges??[]).filter(e=>e.to.nodeId===node.id&&isParameterPort(e.to.port))){
  const spec=parameterSpec(node,edge.to.port);if(spec?.phase!=='QUERY')continue;
  const source=graph.nodes.find(n=>n.id===edge.from.nodeId),issue=source&&inspectParameterSource(source,node,edge.to.port);
  if(!source||issue)return {ready:false,node,missing:[issue?.code??'GRAPH_PARAMETER_SOURCE']};
  const value=source.type==='VALUE'?source.config.value:executionInstrumentId;
  const checked=parameterValue(spec,value,source.config.unit??null);if(!checked.ready)return {ready:false,node,missing:[checked.code]};
  config=applyParameterValue(config,spec,checked.value);bindings.push({field:spec.key,sourceNodeId:source.id,value:checked.value});
 }
 return {ready:true,node:config===node.config?node:{...node,config},bindings};
}
export function bindPreparedInput(input,resolution){return resolution.bindings?.length?{...input,resolvedBindingHash:hashInputPackage(resolution.node.config)}:input;}
/** Changing a source never overwrites the literal fallback stored in node.config. */
export function setParameterConnection(graph,{nodeId,field,sourceNodeId=null,sourcePort='value'}){
 const node=graph.nodes.find(n=>n.id===nodeId),port='param:'+field;if(!parameterSpec(node,port))throw Object.assign(Error('연결할 속성을 선택하세요.'),{code:'GRAPH_PARAMETER_PORT'});
 const next=clone(graph);next.edges=next.edges.filter(e=>!(e.to.nodeId===nodeId&&e.to.port===port));
 if(sourceNodeId)next.edges.push({id:sourceNodeId+'-'+nodeId+'-'+port,from:{nodeId:sourceNodeId,port:sourcePort},to:{nodeId,port}});
 return synchronizeStrategyTimeframe(graph,next);
}
