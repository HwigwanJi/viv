import {isRegimeProgramGraph,regimeNodePorts,compileRegimeProgramGraph,diagnoseRegimeProgramGraph,regimeProgramGraphHash,REGIME_NODE_TYPES} from './regime-program-graph.mjs';
import {instrumentConnectionIssue,ontologyIssue} from './strategy-ontology-validation.mjs';
import {strategyTimeframeParameter,applyParameterValue,parameterPortContracts,parameterSpec,parameterValue,inspectParameterSource,isParameterPort,isCanonicalInstrument,isCanonicalInstrumentSet,STRATEGY_TIMEFRAMES} from './strategy-parameters.mjs';
import {STRATEGY_PORT_TYPE_LABELS,STRATEGY_NUMBER_UNITS,assertOntologyPorts} from './strategy-ontology.mjs';
import {assertHourlyModelComponents} from './hourly-model-components.mjs';
import {inspectGraphBrokerSupport} from './broker-capabilities.mjs';
import {prepareBrokerSessionPlan,sessionBrokerRequests} from './session-order-policy.mjs';
import {STRATEGY_NODE_TYPES,STRATEGY_NODE_LABELS} from './strategy-node-registry.mjs';
import {assertSessionSignalConfig,assertSessionTrendConfig,sessionTrendSignal,prepareSessionTrendPlan,prepareCappedSessionPlan,SESSION_SIGNAL_DEFAULTS,SESSION_TREND_DEFAULTS} from './session-regime.mjs';
import {assertSessionRuleConfig,prepareSessionPlan,assertSessionPlan,SESSION_RULE_DEFAULTS} from './session-rule.mjs';
import {decisionGraphLimits} from './strategy-graph-limits.mjs';
export {decisionGraphLimits} from './strategy-graph-limits.mjs';
import {quantInputMetric} from './quant-input-catalog.mjs';
import {microstructureMetric,MICROSTRUCTURE_TIMEFRAMES,validMicrostructureInput} from './microstructure-input.mjs';
import {assertGraphCompositions} from './graph-compositions.mjs';
import {inspectGraphQuestionReuse} from './graph-question-reuse.mjs';
import {positionInputMetric,validPositionInput} from './position-input.mjs';
import {assertVampModel,predictVampModel} from './vamp-model.mjs';
import {assertJudgmentModel,predictJudgmentModel} from './judgment-model.mjs';
import {assertHourlyPathModel,predictHourlyPathModel} from './hourly-path-model.mjs';
import {SURGE_MODEL_FAMILY,assertSurgeModelConfig,evaluateSurgePath} from './surge-path-model.mjs';
import {HOURLY_VALUE_INPUT,assertHourlyValueNode,evaluateHourlyValueNode} from './hourly-value-node.mjs';
import {validSelectionInput} from './selection-input.mjs';
import {validCampaignInput} from './campaign-input.mjs';
import {SIMULATION_RESPONSE_POLICY,simulationProbabilityAudit} from './simulation-response-policy.mjs';
import {hashInputPackage} from './workspace.mjs';
import {assertStrategyModule,createStrategyModule,StrategyGraphError} from './strategy-graph.mjs';
import {assertQuantStrategyBindingMetadata,quantStrategyBindingsSemantic} from './quant-strategy-library.mjs';
import {resolveGraphInput,effectiveStrategyInputBinding} from './strategy-graph-inputs.mjs';
import {assertJevQuestion,inspectJevQuestionAnswer,JEV_QUESTION_CONTRACT} from './jev-question.mjs';
import {PORTFOLIO_GRAPH_TYPES,ASSET_CONDITION_TYPES,assetConditionDefaults,evaluateAssetCondition,portfolioGraphDefaults,assertPortfolioNodeConfig,validPortfolioContext,validPortfolioCandidateInput,filterPortfolioCandidates,rankPortfolioCandidates,allocatePortfolioTargets,portfolioRebalanceDue,currentPortfolioTargets,rebalancePortfolioTargets,riskPortfolioTargets,portfolioOrderChanges,selectPortfolioCandidates,PORTFOLIO_SELECTION_VERSION,PORTFOLIO_CANDIDATE_TIMEFRAMES} from './portfolio-graph.mjs';
import {ADAPTIVE_PORTFOLIO_TYPES,adaptiveDefaults,assertAdaptiveConfig,marketState,expertPortfolio,routePortfolio} from './adaptive-portfolio.mjs';
import {reduceAssetValues} from './portfolio-graph.mjs';

export const DECISION_GRAPH_VERSION='mind-strategy-decision-graph-v2';
export const DECISION_GRAPH_EVALUATION_VERSION='mind-strategy-decision-evaluation-v2';
export const DECISION_GRAPH_NODE_TYPES=STRATEGY_NODE_TYPES;
export const DECISION_PORT_TYPE_LABELS=STRATEGY_PORT_TYPE_LABELS;
const clone=structuredClone,HASH=/^[a-f0-9]{64}$/,ID=/^[a-zA-Z0-9][a-zA-Z0-9_.:@/-]{0,199}$/;
const plain=v=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.getPrototypeOf(v)===Object.prototype;
const exact=(v,required,optional=[])=>plain(v)&&required.every(k=>Object.hasOwn(v,k))&&Object.keys(v).every(k=>required.includes(k)||optional.includes(k));
const finite=v=>typeof v==='number'&&Number.isFinite(v),ratio=v=>finite(v)&&v>=0&&v<=1;
const iso=v=>typeof v==='string'&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString()===v;
const check=(ok,code,message)=>{if(!ok)throw new StrategyGraphError(code,message);};
const unique=list=>[...new Set(list)];
const label=STRATEGY_NODE_LABELS;
const node=(id,type,config,x,y)=>({id,type,label:label[type],position:{x,y},config});
const link=(from,to,fromPort,toPort)=>({id:from+'-'+to+'-'+toPort,from:{nodeId:from,port:fromPort},to:{nodeId:to,port:toPort}});

/** Port types and cardinality are shared by publication, connection previews and editors. */
export function decisionNodePortContract(node){const ports=resolveDecisionNodePortContract(node);return assertOntologyPorts({...ports,inputs:[...ports.inputs,...parameterPortContracts(node)]});}
function resolveDecisionNodePortContract(node){
 const programPorts=regimeNodePorts(typeof node==='string'?{type:node,config:{}}:node);if(programPorts)return programPorts;
 const type=typeof node==='string'?node:node?.type,c=typeof node==='string'?{}:node?.config??{};
 const port=(id,dataType,accepts=[dataType],minConnections=1,maxConnections=1)=>({id,dataType,accepts,minConnections,maxConnections});
 const output=(id,dataType)=>port(id,dataType,[],1,64);
 const decision=()=>output('decision','DECISION');
 if(type==='MARKET_STATE')return {inputs:[port('assets','ASSET_SET')],outputs:[output('state','CONTEXT')]};
 if(type==='PORTFOLIO_EXPERT')return {inputs:[port('state','CONTEXT')],outputs:[output('proposal','CONTEXT')]};
 if(type==='PORTFOLIO_ROUTER')return {inputs:[port('assets','ASSET_SET'),port('state','CONTEXT'),port('experts','CONTEXT',['CONTEXT'],2,12)],outputs:[output('targets','TARGET_WEIGHTS')]};
 if(type==='SESSION_SIGNAL')return {inputs:[port('state','CONTEXT')],outputs:[output('value','NUMBER')]};
 if(type==='SESSION_RULE'||type==='SESSION_TREND')return {inputs:[port('state','CONTEXT')],outputs:[output('plan','ORDER_PLAN')]};
 if(type==='INPUT')return {inputs:[],outputs:[output('data',['SELECTION','CAMPAIGN'].includes(c.kind)?'BOOLEAN':c.kind==='MICROSTRUCTURE'?(microstructureMetric(c.metricId)?.dataType??'NUMBER'):c.kind==='POSITION'?(positionInputMetric(c.metricId)?.dataType??'CONTEXT'):c.kind==='METRIC'?'NUMBER':c.kind==='EXECUTION_ASSET'?'TEXT':c.kind??'OHLCV')]};
 if(type==='VALUE')return {inputs:[],outputs:[output('value',c.dataType??'NUMBER')]};
 if(type==='MODEL'&&c.family===SURGE_MODEL_FAMILY)return {inputs:[port('assets','ASSET_SET')],outputs:[output('targets','TARGET_WEIGHTS')]};
 if(type==='MODEL'&&c.family==='HOURLY_VALUE_FOREST')return {inputs:[port('state','CONTEXT')],outputs:[decision()]};
 if(type==='MODEL')return {inputs:c.family==='OWN_STATE_VALUE_FOREST'?[port('market','OHLCV'),port('position','CONTEXT')]:c.family==='HOURLY_PATH_FOREST'?[port('market','OHLCV')]:[port('features','CONTEXT')],outputs:[output('value','NUMBER')]};
 if(type==='SIGNAL')return {inputs:[port('market','OHLCV')],outputs:[output('signal','SIGNAL')]};
 if(type==='CONDITION'){const accepts=['SIGNAL','NUMBER',...(c.rightOperand==='INPUT'&&['eq','neq'].includes(c.operator)?['TEXT']:[])];return {inputs:[port('value','NUMBER',accepts),...(c.rightOperand==='INPUT'?[port('compare','NUMBER',accepts)]:[])],outputs:[output('condition','BOOLEAN')]};}
 if(type==='BOOLEAN_LOGIC')return {inputs:[port('conditions','BOOLEAN',['BOOLEAN'],c.operation==='NOT'?1:2,c.operation==='NOT'?1:12)],outputs:[output('condition','BOOLEAN')]};
 if(type==='JEV_QUESTION')return {inputs:[port('context','CONTEXT',['OHLCV','NUMBER','TEXT','BOOLEAN','CHOICE','CONTEXT','MEMORY','KNOWLEDGE','SIGNAL','ASSET_SET','ASSET_RANK','DECISION'],1,32)],outputs:[output('value',c.question?.type==='choice'?'CHOICE':'NUMBER')]};
 if(type==='QUANT')return {inputs:[port('signal',c.mode==='CONDITION'?'BOOLEAN':'SIGNAL'),...(Object.hasOwn(c,'sellTargetQuantity')?[port('position','CONTEXT')]:[])],outputs:[decision()]};
 if(type==='VIBE')return {inputs:[port('context','CONTEXT',['OHLCV','NUMBER','BOOLEAN','CONTEXT','MEMORY','KNOWLEDGE','SIGNAL'],1,64)],outputs:[decision()]};
 if(type==='DECISION_ROUTER'&&['ORDER_PLAN','TARGET_WEIGHTS'].includes(c.payload))return {inputs:c.mode==='CHOICE'?[port('selector','CHOICE'),...(c.cases??[]).map(item=>port('case:'+item.id,c.payload))]:[port('condition','BOOLEAN'),port('true',c.payload),port('false',c.payload)],outputs:[output(c.payload==='TARGET_WEIGHTS'?'targets':'plan',c.payload)]};
 if(type==='DECISION_ROUTER')return {inputs:c.mode==='CONDITION'?[port('condition','BOOLEAN'),port('true','DECISION'),port('false','DECISION')]:c.mode==='CHOICE'?[port('selector','CHOICE'),...(Array.isArray(c.cases)?c.cases:[]).map(item=>port('case:'+item.id,'DECISION'))]:[port('decisions','DECISION',['DECISION'],1,64)],outputs:[decision()]};
 if(type==='DECISION_MIXER')return {inputs:[port('decisions','DECISION',['DECISION'],2,12)],outputs:[decision()]};
 if(type==='FILTER')return {inputs:[port('assets','ASSET_SET')],outputs:[output('assets','ASSET_SET')]};
 if(type==='ASSET_METRIC')return {inputs:[port('assets','ASSET_SET')],outputs:[output('values','ASSET_VALUES')]};
 if(type==='ASSET_REDUCE')return {inputs:[port('values','ASSET_VALUES'),port('exclude','INSTRUMENT',['INSTRUMENT'],0,1)],outputs:[output('value','NUMBER')]};
 if(type==='ASSET_COMPARE')return {inputs:[port('values','ASSET_VALUES')],outputs:[output('conditions','ASSET_CONDITIONS')]};
 if(type==='ASSET_LOGIC')return {inputs:[port('conditions','ASSET_CONDITIONS',['ASSET_CONDITIONS'],c.operation==='NOT'?1:2,c.operation==='NOT'?1:12)],outputs:[output('conditions','ASSET_CONDITIONS')]};
 if(type==='ASSET_FILTER')return {inputs:[port('assets','ASSET_SET'),port('conditions','ASSET_CONDITIONS')],outputs:[output('assets','ASSET_SET')]};
 if(type==='RANK')return {inputs:[port('assets','ASSET_SET')],outputs:[output('rank','ASSET_RANK'),output('breadth','NUMBER')]};
 if(type==='SELECT')return {inputs:[port('rank','ASSET_RANK'),port('choice','CHOICE',['CHOICE'],0,1)],outputs:[output('selected','ASSET_SELECTION')]};
 if(type==='MEMBER')return {inputs:[port('assets','ASSET_SELECTION'),port('instrument','TEXT',['TEXT','INSTRUMENT'])],outputs:[output('condition','BOOLEAN')]};
 if(type==='ALLOCATE')return {inputs:[port('rank','ASSET_RANK'),port('budget','NUMBER'),port('retain','ASSET_RANK',['ASSET_RANK'],0,1)],outputs:[output('targets','TARGET_WEIGHTS')]};
 if(type==='REBALANCE')return {inputs:[port('targets','TARGET_WEIGHTS')],outputs:[output('targets','TARGET_WEIGHTS')]};
 if(type==='RISK'&&c.mode==='SESSION')return {inputs:[port('decision','ORDER_PLAN')],outputs:[output('approved','APPROVED_ORDER_PLAN')]};
 if(type==='ORDER'&&c.sizing==='SESSION_ORDERS')return {inputs:[port('approved','APPROVED_ORDER_PLAN')],outputs:[]};
 if(type==='RISK')return {inputs:[port('decision',c.mode==='PORTFOLIO'?'TARGET_WEIGHTS':'DECISION')],outputs:[output('approved',c.mode==='PORTFOLIO'?'APPROVED_TARGET_WEIGHTS':'APPROVED_DECISION')]};
 if(type==='ORDER')return {inputs:[port('approved',c.sizing==='TARGET_WEIGHTS'?'APPROVED_TARGET_WEIGHTS':'APPROVED_DECISION')],outputs:[]};
 return {inputs:[],outputs:[]};
}
export function decisionGraphNodePorts(node){const ports=decisionNodePortContract(node);return {inputs:ports.inputs.map(p=>p.id),outputs:ports.outputs.map(p=>p.id)};}
export const DECISION_NUMBER_UNITS=STRATEGY_NUMBER_UNITS;
export const DECISION_ACTION_INTENTS=Object.freeze({buy:Object.freeze([{id:'ENTRY',label:'신규 매수'},{id:'ADD',label:'추가 매수'}].map(Object.freeze)),sell:Object.freeze([{id:'REDUCE',label:'비중 축소'},{id:'EXIT',label:'전량 매도'},{id:'STOP_LOSS',label:'손절'},{id:'TAKE_PROFIT',label:'수익 실현'},{id:'CAMPAIGN_EXIT',label:'운용 종료'}].map(Object.freeze))});
export function decisionNumericUnit(node,output=null){
 if(node?.type==='ASSET_REDUCE')return output?.unit??(node.config.operation==='POSITIVE_FRACTION'?'ratio':null);
 if(node?.type==='MODEL')return [SURGE_MODEL_FAMILY,'HOURLY_VALUE_FOREST'].includes(node.config.family)?null:node.config.family==='OWN_STATE_VALUE_FOREST'?'scalar':node.config.family==='HOURLY_PATH_FOREST'?'ratio':'bps';
 if(node?.type==='VALUE'&&node.config.dataType==='NUMBER')return node.config.unit??'scalar';
 if(node?.type==='SIGNAL')return 'signed_score';
 if(node?.type==='RANK')return 'ratio';
 if(node?.type==='JEV_QUESTION')return node.config.question.type==='noul'?'probability':node.config.question.type==='score'?'score':null;
 if(node?.type==='INPUT'&&node.config.kind==='METRIC')return output?(output.unit??(['currency','currency_per_share'].includes(quantInputMetric(node.config.metricId)?.unit)?null:quantInputMetric(node.config.metricId)?.unit??null)):quantInputMetric(node.config.metricId)?.unit??null;
 if(node?.type==='INPUT'&&node.config.kind==='POSITION'){const metric=positionInputMetric(node.config.metricId);return metric?.dataType==='NUMBER'?(output?(output.unit??null):metric.unit):null;}
 if(node?.type==='INPUT'&&node.config.kind==='MICROSTRUCTURE')return microstructureMetric(node.config.metricId)?.unit??null;
 return null;
}
const unitsCompatible=(a,b)=>a&&b&&(a===b||a==='currency'&&['USD','KRW','USDT','BTC'].includes(b)||b==='currency'&&['USD','KRW','USDT','BTC'].includes(a)||a==='currency_per_share'&&['USD/share','KRW/share'].includes(b)||b==='currency_per_share'&&['USD/share','KRW/share'].includes(a)||a==='currency_per_unit'&&['USD/unit','KRW/unit','USDT/unit','BTC/unit'].includes(b)||b==='currency_per_unit'&&['USD/unit','KRW/unit','USDT/unit','BTC/unit'].includes(a));
function conditionUnitIssue(node,links,byId){
 if(node?.type!=='CONDITION'||node.config?.rightOperand!=='INPUT'&&!links.some(e=>e.to.port==='param:value'))return null;
 const left=links.find(e=>e.to.port==='value'),right=links.find(e=>e.to.port===(node.config?.rightOperand==='INPUT'?'compare':'param:value'));if(!left||!right)return null;
 const leftNode=byId.get(left.from.nodeId),rightNode=byId.get(right.from.nodeId),type=(n,e)=>decisionNodePortContract(n).outputs.find(p=>p.id===e.from.port)?.dataType,aType=type(leftNode,left),bType=type(rightNode,right);
 if(aType==='TEXT'||bType==='TEXT')return aType===bType&&['eq','neq'].includes(node.config.operator)?null:connectionIssue('GRAPH_CONDITION_TYPE','텍스트끼리 같음 또는 다름을 비교하세요. 숫자 비교에는 같은 단위의 숫자를 연결하세요.',node.id,'compare');
 const a=decisionNumericUnit(leftNode),b=decisionNumericUnit(rightNode);
 // A median inherits its observed metric's unit; the evaluator checks both resolved units.
 if(!a&&leftNode?.type==='ASSET_REDUCE'||!b&&rightNode?.type==='ASSET_REDUCE')return null;
 return unitsCompatible(a,b)?null:connectionIssue('GRAPH_NUMBER_UNIT','같은 단위의 숫자를 비교하세요. 값 부품에서 단위를 지정할 수 있습니다.',node.id,'compare');
}
const compatibleDecisionPorts=(source,target,edge)=>{
 const output=decisionNodePortContract(source).outputs.find(p=>p.id===edge.from.port),input=decisionNodePortContract(target).inputs.find(p=>p.id===edge.to.port);
 return Boolean(output&&input&&input.accepts.includes(output.dataType));
};
const connectionIssue=(code,message,nodeId=null,portId=null)=>({...ontologyIssue(code,message,nodeId,portId?['inputs',portId]:[],'GraphConnectionConstraint','DecisionGraph'),ok:false,nodeId,portId});
const edgePair=edge=>edge.from.nodeId+'>'+edge.to.nodeId+':'+edge.to.port;
function hasDecisionPath(edges,start,target){const visited=new Set(),pending=[start];while(pending.length){const id=pending.pop();if(id===target)return true;if(visited.has(id))continue;visited.add(id);for(const edge of edges)if(edge?.from?.nodeId===id)pending.push(edge.to?.nodeId);}return false;}

/** Inspect a proposed edge without mutating a partially edited graph. */
export function inspectDecisionConnection(graph,connection,{ignoreEdgeId=null}={}){
 const nodes=Array.isArray(graph?.nodes)?graph.nodes:[],edges=(Array.isArray(graph?.edges)?graph.edges:[]).filter(e=>ignoreEdgeId===null||e?.id!==ignoreEdgeId);
 const fromId=typeof connection?.from==='string'?connection.from:connection?.from?.nodeId,toId=typeof connection?.to==='string'?connection.to:connection?.to?.nodeId;
 const source=nodes.find(n=>n?.id===fromId),target=nodes.find(n=>n?.id===toId);
 if(!source||!target||fromId===toId)return connectionIssue('GRAPH_EDGE','연결할 서로 다른 두 노드를 선택하세요.',toId??fromId??null);
 const sourcePorts=decisionNodePortContract(source).outputs,targetPorts=decisionNodePortContract(target).inputs;
 const fromPort=connection.fromPort??connection.from?.port??(sourcePorts.length===1?sourcePorts[0].id:null),toPort=connection.toPort??connection.to?.port??(targetPorts.filter(p=>!p.parameter).length===1?targetPorts.find(p=>!p.parameter).id:null);
 if(!fromPort||!toPort)return connectionIssue('GRAPH_PORT','연결할 출력과 입력 포트를 선택하세요.',toId,toPort);
 const edge={from:{nodeId:fromId,port:fromPort},to:{nodeId:toId,port:toPort}};
 if(!compatibleDecisionPorts(source,target,edge)){
  const input=targetPorts.find(p=>p.id===toPort),output=sourcePorts.find(p=>p.id===fromPort),needed=input?.accepts.map(type=>DECISION_PORT_TYPE_LABELS[type]??type).join(' 또는 '),current=DECISION_PORT_TYPE_LABELS[output?.dataType]??'출력 포트 확인 필요',last=needed?.charCodeAt(needed.length-1),particle=last>=0xac00&&last<=0xd7a3&&(last-0xac00)%28?'을':'를';
  return connectionIssue('GRAPH_PORT',input?(label[target.type]??target.label)+'에는 '+needed+particle+' 연결하세요. 현재 출력: '+current:'이 노드의 입력 포트를 선택하세요.',toId,toPort);
 }
 const parameterIssue=inspectParameterSource(source,target,toPort);if(parameterIssue)return connectionIssue(parameterIssue.code,parameterIssue.message,toId,toPort);const semanticIssue=instrumentConnectionIssue(source,target,toPort);if(semanticIssue)return {...semanticIssue,ok:false,nodeId:toId,portId:toPort};
 if(target.type==='DECISION_ROUTER'&&target.config?.mode==='CHOICE'&&toPort==='selector'&&!choiceCasesMatch(source,target))return connectionIssue('GRAPH_CHOICE_CASES','질문의 선택지 ID와 라우터의 분기 ID를 일치시키세요.',toId,toPort);
 const unitIssue=conditionUnitIssue(target,[...edges.filter(e=>e?.to?.nodeId===toId),edge],new Map(nodes.filter(n=>n&&typeof n.id==='string').map(n=>[n.id,n])));if(unitIssue)return unitIssue;
 if(connection.id&&edges.some(e=>e?.id===connection.id))return connectionIssue('GRAPH_EDGE','연결 ID를 한 번만 사용하세요.',toId,toPort);
 if(edges.some(e=>e?.from&&e?.to&&edgePair(e)===edgePair(edge)))return connectionIssue('GRAPH_PORT','같은 출력과 입력은 한 번만 연결하세요.',toId,toPort);
 const input=targetPorts.find(p=>p.id===toPort),count=edges.filter(e=>e?.to?.nodeId===toId&&e.to.port===toPort).length;
 if(count>=input.maxConnections)return connectionIssue(target.type==='DECISION_ROUTER'?'GRAPH_ROUTER_INPUT':'GRAPH_INPUT_ARITY',input.maxConnections===1?'이 입력에는 연결 하나만 지정할 수 있습니다.':'이 입력의 최대 연결 수는 '+input.maxConnections+'개입니다.',toId,toPort);
 if(hasDecisionPath(edges,toId,fromId))return connectionIssue('GRAPH_CYCLE','이 연결은 순환을 만듭니다. 앞 단계의 출력을 다음 단계에 연결하세요.',toId,toPort);
 return {ok:true,code:null,message:'',nodeId:toId,portId:toPort};
}
export function createDecisionStrategyNode(type,{id,position={x:40,y:40},instrumentId='crypto:okx:BTC-USDT',moduleId='MEAN_REVERSION',config}={}){
 if(type==='MODEL'&&config===undefined)config={family:'VAMP_RIDGE',model:null};
 check(DECISION_GRAPH_NODE_TYPES.includes(type)&&ID.test(id??''),'GRAPH_NODE','등록된 노드 종류와 고유 ID를 선택하세요.');
 const defaults={SESSION_SIGNAL:SESSION_SIGNAL_DEFAULTS,SESSION_TREND:SESSION_TREND_DEFAULTS,SESSION_RULE:SESSION_RULE_DEFAULTS,INPUT:{kind:'OHLCV',instrumentId,timeframe:'4h',required:true},VALUE:{dataType:'NUMBER',value:0},SIGNAL:null,CONDITION:{operator:'gte',value:0},BOOLEAN_LOGIC:{operation:'ALL'},JEV_QUESTION:{provider:'JEV',question:{schemaVersion:1,contractVersion:JEV_QUESTION_CONTRACT,id,type:'noul',instructions:'연결한 자료가 지정한 조건을 충족하는지 평가한다.',criteria:{true:'조건을 충족한다.',false:'조건을 충족하지 않는다.'}}},QUANT:{buyAbove:.3,sellBelow:-.3,buyTargetWeight:.5,sellTargetWeight:0},VIBE:{provider:'JEV',instructions:'확정 시세와 연결된 투자 자료를 평가해 매수·유지·매도를 결정한다.'},DECISION_ROUTER:{mode:'SELECT',selectedNodeId:'quant'},DECISION_MIXER:{mode:'FIXED',weightVersionId:'weights-v1',weights:[]},RISK:{maxExposure:.6,maxOrderWeight:.2,minConfidence:.6},ORDER:{execution:'PAPER',sizing:'TARGET_WEIGHT'}};
 return {id,type,label:label[type],position:clone(position),config:clone(config??(ADAPTIVE_PORTFOLIO_TYPES.includes(type)?adaptiveDefaults(type):type==='SIGNAL'?createStrategyModule(moduleId):ASSET_CONDITION_TYPES.includes(type)?assetConditionDefaults(type):PORTFOLIO_GRAPH_TYPES.includes(type)?portfolioGraphDefaults(type):defaults[type]))};
}
export function connectDecisionStrategyNodes(graph,{from,to,fromPort,toPort}={}){
 const next=clone(graph),a=next.nodes.find(n=>n.id===from),b=next.nodes.find(n=>n.id===to);check(a&&b,'GRAPH_EDGE','연결할 노드를 선택하세요.');
 const outgoing=decisionGraphNodePorts(a).outputs,incoming=decisionNodePortContract(b).inputs.filter(p=>!p.parameter).map(p=>p.id);check((fromPort||outgoing.length===1)&&(toPort||incoming.length===1),'GRAPH_PORT','조건·참·거짓 입력 포트를 선택하세요.');
 const edge=link(from,to,fromPort??outgoing[0],toPort??incoming[0]);check(!next.edges.some(e=>e.id===edge.id),'GRAPH_EDGE','같은 입력 연결을 한 번 지정하세요.');check(compatibleDecisionPorts(a,b,edge),'GRAPH_PORT','자료·신호·조건·결정에 맞는 입력 포트를 연결하세요.');const parameterIssue=inspectParameterSource(a,b,edge.to.port);if(parameterIssue)check(false,parameterIssue.code,parameterIssue.message);const semanticIssue=instrumentConnectionIssue(a,b,edge.to.port);if(semanticIssue)check(false,semanticIssue.code,semanticIssue.message);if(b.type==='DECISION_ROUTER'&&b.config.mode==='CHOICE'&&edge.to.port==='selector')check(choiceCasesMatch(a,b),'GRAPH_CHOICE_CASES','질문의 선택지 ID와 라우터의 분기 ID를 일치시키세요.');next.edges.push(edge);const unitIssue=conditionUnitIssue(b,next.edges.filter(e=>e.to.nodeId===b.id),new Map(next.nodes.map(n=>[n.id,n])));if(unitIssue)check(false,unitIssue.code,unitIssue.message);
 if(b.type==='DECISION_MIXER'&&!b.config.weights.some(w=>w.nodeId===from))b.config.weights.push({nodeId:from,value:1});return next;
}

/** Add one requested component and its required market dependency without choosing among ambiguous inputs. */
export function addDecisionStrategyNode(graph,type,options={}){
 check(graph?.schemaVersion===2&&Array.isArray(graph.nodes)&&Array.isArray(graph.edges),'GRAPH_SCHEMA','결정 그래프를 열어 부품을 추가하세요.');
 const added=createDecisionStrategyNode(type,options);check(!graph.nodes.some(n=>n.id===added.id),'GRAPH_NODE','고유 노드 ID를 사용하세요.');check(graph.nodes.length<decisionGraphLimits(graph).nodes,'GRAPH_SCHEMA',`한 그래프에는 노드 ${decisionGraphLimits(graph).nodes}개까지 추가할 수 있습니다.`);
 let next=clone(graph);next.nodes.push(added);const addedNodeIds=[added.id],targetPort=type==='SIGNAL'?'market':type==='VIBE'?'context':null;
 const connection={state:'NOT_REQUIRED',targetNodeId:added.id,targetPort,candidateNodeIds:[],sourceNodeId:null};
 if(targetPort!==null){
  const instrumentId=options.instrumentId??'crypto:okx:BTC-USDT',timeframe=options.timeframe??'4h';check(ID.test(instrumentId)&&timeframe==='4h','GRAPH_INPUT_BINDING','지원하는 종목과 4시간봉 시세를 선택하세요.');
  const owned=new Set((next.libraryBindings??[]).flatMap(binding=>Object.values(binding.nodeMap))),matches=next.nodes.filter(n=>n.type==='INPUT'&&n.config.kind==='OHLCV'&&n.config.instrumentId===instrumentId&&n.config.timeframe===timeframe),candidates=matches.filter(n=>!owned.has(n.id)),selected=options.marketNodeId?matches.find(n=>n.id===options.marketNodeId):null;connection.candidateNodeIds=candidates.map(n=>n.id);
  if(options.marketNodeId)check(selected,'GRAPH_INPUT_BINDING','같은 종목·주기의 시세 입력을 선택하세요.');
  let source=selected??(candidates.length===1?candidates[0]:null);
  if(!candidates.length||selected&&owned.has(selected.id)){
   check(next.nodes.length<decisionGraphLimits(graph).nodes,'GRAPH_SCHEMA',`필수 시세 입력을 포함해 노드 ${decisionGraphLimits(graph).nodes}개 이내로 구성하세요.`);let id='market',index=2;while(next.nodes.some(n=>n.id===id))id='market-'+index++;
   source=createDecisionStrategyNode('INPUT',{id,position:options.marketPosition??added.position,config:selected?clone(selected.config):{kind:'OHLCV',instrumentId,timeframe,required:true}});next.nodes.push(source);addedNodeIds.push(id);connection.candidateNodeIds=[id];
  }
  if(source){check(next.edges.length<decisionGraphLimits(graph).edges,'GRAPH_SCHEMA',`한 그래프에는 연결 ${decisionGraphLimits(graph).edges}개까지 추가할 수 있습니다.`);next=connectDecisionStrategyNodes(next,{from:source.id,to:added.id,toPort:targetPort});connection.state='CONNECTED';connection.sourceNodeId=source.id;}
  else connection.state='CONNECTION_REQUIRED';
 }
 return {graph:next,nodeId:added.id,addedNodeIds,connection};
}

export function decisionGraphHash(graph){
 if(isRegimeProgramGraph(graph))return regimeProgramGraphHash(graph);
 return hashInputPackage({contractVersion:graph.contractVersion,...(graph.executionScope?{executionScope:graph.executionScope}:{}),triggers:[...graph.triggers].sort(),nodes:graph.nodes.map(n=>({id:n.id,type:n.type,config:n.type==='DECISION_MIXER'?{...n.config,weights:[...n.config.weights].sort((a,b)=>a.nodeId.localeCompare(b.nodeId)),...(Object.hasOwn(n.config,'inactiveWeights')?{inactiveWeights:[...n.config.inactiveWeights].sort((a,b)=>a.nodeId.localeCompare(b.nodeId))}:{})}:n.config})).sort((a,b)=>a.id.localeCompare(b.id)),edges:graph.edges.map(e=>({from:e.from,to:e.to})).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))),outputNodeId:graph.outputNodeId,...(Object.hasOwn(graph,'libraryBindings')?{libraryBindings:quantStrategyBindingsSemantic(graph)}:{})});
}

function assertDecisionNode(n,byId){
 check(!REGIME_NODE_TYPES.includes(n?.type),'REGIME_GRAPH_SCOPE','국면 부품은 국면 운용 구성에서 연결하세요.');
  check(exact(n,['id','type','label','position','config'])&&ID.test(n.id??'')&&!byId.has(n.id)&&DECISION_GRAPH_NODE_TYPES.includes(n.type)&&typeof n.label==='string'&&n.label.trim().length>0&&n.label.length<=100&&exact(n.position,['x','y'])&&finite(n.position.x)&&finite(n.position.y)&&Math.abs(n.position.x)<=10000&&Math.abs(n.position.y)<=10000,'GRAPH_NODE','노드의 고유 ID·종류·이름·위치를 확인하세요.');
  const c=n.config;
  if(ADAPTIVE_PORTFOLIO_TYPES.includes(n.type))assertAdaptiveConfig(n.type,c);
  if(n.type==='INPUT'&&c.kind==='ASSET_SET')check(exact(c,['kind','scope','timeframe','required'],['instrumentId','instrumentIds'])&&!(c.instrumentId&&c.instrumentIds)&&(!Object.hasOwn(c,'instrumentIds')||isCanonicalInstrumentSet(c.instrumentIds))&&(!Object.hasOwn(c,'instrumentId')||isCanonicalInstrument(c.instrumentId))&&c.scope==='MIND_UNIVERSE'&&Object.hasOwn(PORTFOLIO_CANDIDATE_TIMEFRAMES,c.timeframe)&&c.required===true,'GRAPH_ASSET_SCOPE','마인드 투자 범위와 확정 일봉을 연결하세요.');
  else if(n.type==='INPUT'&&c.kind==='EXECUTION_ASSET')check(exact(c,['kind','required'])&&c.required===true,'GRAPH_EXECUTION_ASSET','현재 실행 종목 입력을 확인하세요.');
 else if(n.type==='INPUT'&&c.kind==='MICROSTRUCTURE')check(exact(c,['kind','instrumentId','required','timeframe','metricId'],['maxAgeMs','lookbackBars','flowWindowMs','bookMaxAgeMs'])&&ID.test(c.instrumentId??'')&&typeof c.required==='boolean'&&MICROSTRUCTURE_TIMEFRAMES.includes(c.timeframe)&&microstructureMetric(c.metricId)&&['maxAgeMs','flowWindowMs','bookMaxAgeMs','lookbackBars'].every(k=>!Object.hasOwn(c,k)||Number.isSafeInteger(c[k])&&c[k]>=0)&&(!Object.hasOwn(c,'lookbackBars')||c.lookbackBars>=2&&c.lookbackBars<=500),'GRAPH_MICROSTRUCTURE_BINDING','체결·호가 지표의 종목·분봉·평가 구간을 확인하세요.');
  else if(n.type==='INPUT')check(exact(c,['kind','instrumentId','required'],['timeframe','metricId','maxAgeMs','enabled','lookbackBars','cooldownMs','intentNodeId','cooldownScope','profitStepReturn'])&&['OHLCV','METRIC','POSITION','SELECTION','CAMPAIGN','CONTEXT','MEMORY','KNOWLEDGE'].includes(c.kind)&&ID.test(c.instrumentId??'')&&typeof c.required==='boolean'&&(!Object.hasOwn(c,'enabled')||typeof c.enabled==='boolean'&&['CONTEXT','MEMORY','KNOWLEDGE'].includes(c.kind))&&(!Object.hasOwn(c,'timeframe')||['4h','1d','1m','1h'].includes(c.timeframe))&&(!Object.hasOwn(c,'maxAgeMs')||Number.isSafeInteger(c.maxAgeMs)&&c.maxAgeMs>=0)&&(!Object.hasOwn(c,'lookbackBars')||c.kind==='OHLCV'&&Number.isSafeInteger(c.lookbackBars)&&c.lookbackBars>=2&&c.lookbackBars<=1000)&&(!Object.hasOwn(c,'cooldownMs')&&!Object.hasOwn(c,'intentNodeId')||c.kind==='POSITION'&&c.metricId==='INTENT_COOLDOWN_READY'&&Number.isSafeInteger(c.cooldownMs)&&c.cooldownMs>=0&&ID.test(c.intentNodeId??''))&&(!Object.hasOwn(c,'cooldownScope')||c.kind==='POSITION'&&c.metricId==='INTENT_COOLDOWN_READY'&&['ASSET','POSITION','POSITION_ONCE'].includes(c.cooldownScope))&&(!Object.hasOwn(c,'profitStepReturn')||c.kind==='POSITION'&&c.metricId==='INTENT_COOLDOWN_READY'&&c.cooldownScope==='POSITION'&&Number.isFinite(c.profitStepReturn)&&c.profitStepReturn>0)&&((c.kind==='OHLCV'&&['4h','1m','1h','1d'].includes(c.timeframe)&&!Object.hasOwn(c,'metricId'))||(c.kind==='METRIC'&&ID.test(c.metricId??''))||(c.kind==='POSITION'&&positionInputMetric(c.metricId)&&!Object.hasOwn(c,'timeframe'))||(c.kind==='SELECTION'&&c.metricId==='IS_SELECTED'&&!Object.hasOwn(c,'timeframe'))||(c.kind==='CAMPAIGN'&&c.metricId==='EXIT_REQUESTED'&&!Object.hasOwn(c,'timeframe'))||(['CONTEXT','MEMORY','KNOWLEDGE'].includes(c.kind)&&!Object.hasOwn(c,'metricId'))),'GRAPH_INPUT_BINDING','자료 종류·대상·주기와 필수 조건을 확인하세요.');
  if(n.type==='SIGNAL')assertStrategyModule(c);
  if(n.type==='MODEL'){if(c.family===SURGE_MODEL_FAMILY)assertSurgeModelConfig(c);else if(c.family==='HOURLY_VALUE_FOREST')assertHourlyValueNode(c);else{check(exact(c,['family','model'],c.family==='HOURLY_PATH_FOREST'?['components']:[])&&['VAMP_RIDGE','OWN_STATE_VALUE_FOREST','HOURLY_PATH_FOREST'].includes(c.family),'GRAPH_MODEL','학습 모델 종류를 확인하세요.');if(c.model!==null)({VAMP_RIDGE:assertVampModel,OWN_STATE_VALUE_FOREST:assertJudgmentModel,HOURLY_PATH_FOREST:assertHourlyPathModel}[c.family])(c.model);if(c.components)assertHourlyModelComponents(c.components,c.model);}}
  if(PORTFOLIO_GRAPH_TYPES.includes(n.type))assertPortfolioNodeConfig(n.type,c);
  if(n.type==='VALUE')check(exact(c,['dataType','value'],['unit'])&&(!Object.hasOwn(c,'unit')||c.dataType==='NUMBER'&&DECISION_NUMBER_UNITS.includes(c.unit))&&(['NUMBER','BOOLEAN','TEXT','INSTRUMENT','INSTRUMENT_SET','TIMEFRAME'].includes(c.dataType))&&(c.dataType==='NUMBER'?finite(c.value):c.dataType==='BOOLEAN'?typeof c.value==='boolean':c.dataType==='INSTRUMENT_SET'?isCanonicalInstrumentSet(c.value):c.dataType==='INSTRUMENT'?isCanonicalInstrument(c.value):c.dataType==='TIMEFRAME'?STRATEGY_TIMEFRAMES.includes(c.value):typeof c.value==='string'&&c.value.length<=12000),'GRAPH_VALUE','값의 자료형과 내용을 확인하세요.');
  if(n.type==='VALUE'&&c.dataType==='NUMBER')check(c.unit==='probability'?ratio(c.value):c.unit==='signed_score'?c.value>=-1&&c.value<=1:true,'GRAPH_VALUE_RANGE','확률은 0~1, 계산 신호는 -1~1 범위로 입력하세요.');
  if(n.type==='CONDITION')check(['gt','gte','lt','lte','eq','neq'].includes(c?.operator)&&(c.rightOperand==='INPUT'?exact(c,['operator','rightOperand']):exact(c,['operator','value'])&&finite(c.value)),'GRAPH_CONDITION','비교 연산과 입력 기준을 확인하세요.');
  if(n.type==='BOOLEAN_LOGIC')check(exact(c,['operation'])&&['ALL','ANY','NOT'].includes(c.operation),'GRAPH_BOOLEAN_LOGIC','모두 충족·하나 이상·반대 조건을 선택하세요.');
  if(n.type==='JEV_QUESTION'){check(exact(c,['provider','question'],['reuseWindowMs'])&&c.provider==='JEV'&&(!Object.hasOwn(c,'reuseWindowMs')||Number.isSafeInteger(c.reuseWindowMs)&&c.reuseWindowMs>=0&&c.reuseWindowMs<=3600000),'GRAPH_JEV_QUESTION','JEV 질문과 판단 유지 시간을 확인하세요.');assertJevQuestion(c.question);check(c.question.id===n.id,'GRAPH_QUESTION_ID','질문 ID와 노드 ID를 일치시키세요.');}
  if(n.type==='QUANT'){
   const extra=['targetMode','buyWeightDelta','sellWeightDelta','sellPositionFraction','sellTargetQuantity','buyIntent','sellIntent'];
   check((c?.mode==='CONDITION'?exact(c,['mode','onTrue','onFalse','buyTargetWeight','sellTargetWeight'],extra)&&['buy','hold','sell'].includes(c.onTrue)&&['buy','hold','sell'].includes(c.onFalse):exact(c,['buyAbove','sellBelow','buyTargetWeight','sellTargetWeight'],extra)&&finite(c.buyAbove)&&finite(c.sellBelow)&&c.buyAbove>c.sellBelow&&c.buyAbove<=1&&c.sellBelow>=-1)&&ratio(c.buyTargetWeight)&&ratio(c.sellTargetWeight)&&c.buyTargetWeight>c.sellTargetWeight,'GRAPH_QUANT','퀀트 판단 조건과 매수·매도 목표 비중을 확인하세요.');
   check(!Object.hasOwn(c,'targetMode')||['TARGET_WEIGHT','WEIGHT_DELTA'].includes(c.targetMode),'GRAPH_QUANT_TARGET','목표 비중 또는 비중 증감을 선택하세요.');
   check(c.targetMode==='WEIGHT_DELTA'?ratio(c.buyWeightDelta)&&c.buyWeightDelta>0&&ratio(c.sellWeightDelta)&&c.sellWeightDelta>0:!Object.hasOwn(c,'buyWeightDelta')&&!Object.hasOwn(c,'sellWeightDelta'),'GRAPH_QUANT_DELTA','매수 증가·매도 감소 비중을 각각 0 초과~1로 입력하세요.');
   check(!Object.hasOwn(c,'sellPositionFraction')||c.targetMode!=='WEIGHT_DELTA'&&ratio(c.sellPositionFraction)&&c.sellPositionFraction>0,'GRAPH_QUANT_SELL_FRACTION','현재 보유의 매도 비율을 0 초과~1로 입력하세요.');
   check(!Object.hasOwn(c,'sellTargetQuantity')||c.targetMode!=='WEIGHT_DELTA'&&!Object.hasOwn(c,'sellPositionFraction')&&typeof c.sellTargetQuantity==='string'&&/^(?:0|[1-9]\d{0,13})(?:\.\d{1,8})?$/.test(c.sellTargetQuantity),'GRAPH_QUANT_SELL_QUANTITY','매도 후 남길 수량을 소수 8자리 이내로 입력하고 자기 포지션을 연결하세요.');
   check(['buy','sell'].every(action=>!Object.hasOwn(c,action+'Intent')||DECISION_ACTION_INTENTS[action].some(intent=>intent.id===c[action+'Intent'])),'GRAPH_QUANT_INTENT','매수·매도에 맞는 거래 목적을 선택하세요.');
   check(c.sellIntent!=='CAMPAIGN_EXIT'||c.sellTargetWeight===0&&c.targetMode!=='WEIGHT_DELTA'&&!Object.hasOwn(c,'sellPositionFraction')&&!Object.hasOwn(c,'sellTargetQuantity'),'GRAPH_CAMPAIGN_EXIT','운용 종료는 목표 비중 0으로 전량 매도하도록 설정하세요.');
  }
  if(n.type==='VIBE')check(exact(c,['provider','instructions'])&&c.provider==='JEV'&&typeof c.instructions==='string'&&c.instructions.trim().length>0&&c.instructions.length<=6000,'GRAPH_VIBE','JEV 판단 지침을 입력하세요.');
  if(n.type==='DECISION_ROUTER')check(['ORDER_PLAN','TARGET_WEIGHTS'].includes(c?.payload)&&c.mode!=='CHOICE'?exact(c,['mode','payload'])&&c.mode==='CONDITION':c?.mode==='CHOICE'?exact(c,['mode','cases'],['payload'])&&(!c.payload||['ORDER_PLAN','TARGET_WEIGHTS'].includes(c.payload))&&Array.isArray(c.cases)&&c.cases.length>=2&&c.cases.length<=12&&new Set(c.cases.map(item=>item?.id)).size===c.cases.length&&c.cases.every(item=>exact(item,['id','label'])&&ID.test(item.id??'')&&typeof item.label==='string'&&item.label.trim().length>0&&item.label.length<=200):exact(c,['mode'],c?.mode==='SELECT'?['selectedNodeId']:[])&&['SELECT','CONDITION'].includes(c.mode)&&(c.mode==='CONDITION'||ID.test(c.selectedNodeId??'')),'GRAPH_DECISION_ROUTER','선택할 결정 또는 조건별 분기를 확인하세요.');
  if(n.type==='DECISION_MIXER'){check(exact(c,['mode','weightVersionId','weights'],['inactiveWeights'])&&['FIXED','TARGET_BLEND'].includes(c.mode)&&ID.test(c.weightVersionId??'')&&Array.isArray(c.weights)&&c.weights.length>=2&&c.weights.length<=12&&new Set(c.weights.map(w=>w.nodeId)).size===c.weights.length&&c.weights.every(w=>exact(w,['nodeId','value'])&&ID.test(w.nodeId??'')&&ratio(w.value))&&c.weights.some(w=>w.value>0),'GRAPH_DECISION_WEIGHTS','결정별 고정 가중치와 버전을 확인하세요.');if(Object.hasOwn(c,'inactiveWeights'))check(Array.isArray(c.inactiveWeights)&&c.inactiveWeights.length>0&&c.inactiveWeights.length<=c.weights.length&&new Set(c.inactiveWeights.map(w=>w?.nodeId)).size===c.inactiveWeights.length&&c.inactiveWeights.every(w=>exact(w,['nodeId','value'])&&ID.test(w.nodeId??'')&&ratio(w.value)&&w.value>0&&c.weights.some(active=>active.nodeId===w.nodeId)),'GRAPH_INACTIVE_WEIGHTS','연결된 결정의 복원 비중을 0 초과~1 범위로 저장하세요.');}
  if(n.type==='RISK'&&c.mode==='SESSION')check(exact(c,['mode','maxExposure','maxOrderWeight'])&&c.maxExposure===1&&c.maxOrderWeight===1,'GRAPH_SESSION_RISK','세션 계획의 무차입 및 보유 수량 한도 고정');
  else if(n.type==='RISK'&&c.mode==='PORTFOLIO')check(exact(c,['mode','maxExposure','maxOrderWeight'])&&ratio(c.maxExposure)&&c.maxExposure>0&&ratio(c.maxOrderWeight)&&c.maxOrderWeight>0,'GRAPH_PORTFOLIO_RISK','전체 보유 비중과 종목별 최대 주문 비중을 확인하세요.');
  else if(n.type==='RISK')check(exact(c,['maxExposure','maxOrderWeight','minConfidence'])&&ratio(c.maxExposure)&&c.maxExposure>0&&ratio(c.maxOrderWeight)&&c.maxOrderWeight>0&&ratio(c.minConfidence),'GRAPH_RISK','최대 비중·주문 비중·JEV 확신도 기준을 확인하세요.');
  if(n.type==='SESSION_SIGNAL')assertSessionSignalConfig(c);
  if(n.type==='SESSION_TREND')assertSessionTrendConfig(c);
  if(n.type==='SESSION_RULE')assertSessionRuleConfig(c);
  if(n.type==='ORDER'&&c.sizing==='SESSION_ORDERS')check(exact(c,['execution','sizing'],['brokerId','sessionOrderPolicy','limitBandBps'])&&c.execution==='PAPER'&&(!c.brokerId||['toss','upbit'].includes(c.brokerId))&&(!c.sessionOrderPolicy||c.sessionOrderPolicy==='TOSS_LOC'&&c.brokerId==='toss')&&(c.limitBandBps===undefined||Number.isInteger(c.limitBandBps)&&c.limitBandBps>=1&&c.limitBandBps<=5000),'GRAPH_SESSION_ORDER','세션 계좌와 거래소 주문 계약을 확인하세요.');
  else if(n.type==='ORDER')check(exact(c,['execution','sizing'],['orderType','maxSlippageBps','maxQuoteAgeMs','entryDelayMs','captureWindowMs','participationRate','takeProfitBps','takeProfitFraction','recheckModelValue'])&&(c.recheckModelValue===undefined||typeof c.recheckModelValue==='boolean'&&c.sizing==='TARGET_WEIGHTS')&&(!Object.hasOwn(c,'takeProfitBps')&&!Object.hasOwn(c,'takeProfitFraction')||Number.isInteger(c.takeProfitBps)&&c.takeProfitBps>0&&c.takeProfitBps<=10000&&ratio(c.takeProfitFraction)&&c.takeProfitFraction>0&&c.execution==='ACCOUNT'&&c.sizing==='TARGET_WEIGHTS')&&(!Object.hasOwn(c,'maxQuoteAgeMs')||Number.isSafeInteger(c.maxQuoteAgeMs)&&c.maxQuoteAgeMs>=1000&&c.maxQuoteAgeMs<=60000)&&(!Object.hasOwn(c,'participationRate')||ratio(c.participationRate)&&c.participationRate>0)&&['entryDelayMs','captureWindowMs'].every(k=>!Object.hasOwn(c,k)||Number.isSafeInteger(c[k])&&c[k]>=0&&c[k]<3600000)&&['PAPER','ACCOUNT'].includes(c.execution)&&['TARGET_WEIGHT','TARGET_WEIGHTS'].includes(c.sizing)&&(!Object.hasOwn(c,'orderType')||['LIMIT_IOC','LIMIT_FOK'].includes(c.orderType))&&(!Object.hasOwn(c,'maxSlippageBps')||finite(c.maxSlippageBps)&&c.maxSlippageBps>=0&&c.maxSlippageBps<=1000),'GRAPH_ORDER','계좌의 목표 비중과 주문 체결 조건을 확인하세요.');
}
function choiceCasesMatch(source,target){return source?.type==='JEV_QUESTION'&&source.config?.question?.type==='choice'&&Array.isArray(source.config.question.candidates)&&Array.isArray(target.config?.cases)&&JSON.stringify(source.config.question.candidates.map(v=>v?.id).sort())===JSON.stringify(target.config.cases.map(v=>v?.id).sort());}
function decisionNodeConnectionIssues(n,links,outgoing,byId){
 const parameterLinks=links.filter(e=>isParameterPort(e.to.port));links=links.filter(e=>!isParameterPort(e.to.port));
 const issues=[],ports={...decisionNodePortContract(n),inputs:decisionNodePortContract(n).inputs.filter(p=>!p.parameter)},sourceIds=links.map(e=>e.from.nodeId),portCount=p=>links.filter(e=>e.to.port===p).length,add=(ok,code,message,portId=null)=>{if(!ok)issues.push(connectionIssue(code,message,n.id,portId));};
 add(['INPUT','VALUE'].includes(n.type)?links.length===0:links.length>0,'GRAPH_INPUT','처리 노드에 실제 입력을 연결하세요.',ports.inputs.length===1?ports.inputs[0].id:null);
 add(n.type==='ORDER'?outgoing.length===0:n.type==='VALUE'||outgoing.length>0,'GRAPH_DISCONNECTED','각 노드의 출력을 모의 주문까지 연결하세요.',ports.outputs[0]?.id??null);
 if(ports.inputs.length===1&&ports.inputs[0].maxConnections===1)add(links.length===1,'GRAPH_INPUT_ARITY','이 노드에는 입력 하나를 연결하세요.',ports.inputs[0].id);
 if(['BOOLEAN_LOGIC','JEV_QUESTION','CONDITION','ALLOCATE','MEMBER','PORTFOLIO_ROUTER'].includes(n.type))for(const p of ports.inputs)add(portCount(p.id)>=p.minConnections&&portCount(p.id)<=p.maxConnections,'GRAPH_INPUT_ARITY','필수 입력의 연결 수를 확인하세요.',p.id);
 const unitIssue=conditionUnitIssue(n,links,byId);if(unitIssue)issues.push(unitIssue);
 for(const edge of parameterLinks){const issue=inspectParameterSource(byId.get(edge.from.nodeId),n,edge.to.port);if(issue)issues.push(connectionIssue(issue.code,issue.message,n.id,edge.to.port));add(parameterLinks.filter(e=>e.to.port===edge.to.port).length===1,'GRAPH_INPUT_ARITY','각 변수 입력에는 연결 하나만 지정하세요.',edge.to.port);}
 const parameterUnitIssue=conditionUnitIssue(n,[...links,...parameterLinks],byId);if(parameterUnitIssue&&!unitIssue)issues.push(parameterUnitIssue);
 if(n.type==='VIBE')add(links.some(e=>{const a=byId.get(e.from.nodeId);return a?.type==='INPUT'&&a.config?.kind==='OHLCV';}),'GRAPH_VIBE_MARKET','JEV 결정에 확정 시세 입력을 연결하세요.','context');
 if(n.type==='DECISION_ROUTER')add(n.config?.mode==='SELECT'?sourceIds.includes(n.config.selectedNodeId)&&new Set(sourceIds).size===sourceIds.length:links.length===ports.inputs.length&&ports.inputs.every(p=>portCount(p.id)===1),'GRAPH_ROUTER_INPUT','선택된 결정 또는 조건·참·거짓 분기를 연결하세요.',n.config?.mode==='SELECT'?'decisions':ports.inputs.find(p=>portCount(p.id)!==1)?.id??null);
 if(n.type==='DECISION_ROUTER'&&n.config?.mode==='CHOICE'){const selected=links.find(e=>e.to.port==='selector');if(selected)add(choiceCasesMatch(byId.get(selected.from.nodeId),n),'GRAPH_CHOICE_CASES','질문의 선택지 ID와 라우터의 분기 ID를 일치시키세요.','selector');}
 if(n.type==='DECISION_MIXER')add(JSON.stringify(sourceIds.slice().sort())===JSON.stringify((Array.isArray(n.config?.weights)?n.config.weights:[]).map(w=>w?.nodeId).sort()),'GRAPH_WEIGHT_INPUT','연결된 결정별 가중치를 하나씩 지정하세요.','decisions');
 return issues;
}
export function compileDecisionStrategyGraph(graph){
 if(isRegimeProgramGraph(graph))return compileRegimeProgramGraph(graph);
 check(exact(graph,['schemaVersion','contractVersion','nodes','edges','outputNodeId','triggers'],['libraryBindings','compositions','executionScope'])&&graph.schemaVersion===2&&graph.contractVersion===DECISION_GRAPH_VERSION&&Array.isArray(graph.nodes)&&graph.nodes.length>=4&&graph.nodes.length<=decisionGraphLimits(graph).nodes&&Array.isArray(graph.edges)&&graph.edges.length>=3&&graph.edges.length<=decisionGraphLimits(graph).edges&&ID.test(graph.outputNodeId??'')&&Array.isArray(graph.triggers)&&graph.triggers.length>0&&graph.triggers.length<=3&&new Set(graph.triggers).size===graph.triggers.length&&graph.triggers.every(t=>['manual','closed_bar','market_event'].includes(t)),'GRAPH_SCHEMA','지원하는 실행 조건과 결정 그래프를 확인하세요.');
 if(graph.executionScope)check(exact(graph.executionScope,['kind','timeframe','maxCandidates','maxConcurrentPositions'])&&graph.executionScope.kind==='EACH_ASSET'&&['1m','3m','5m','1h'].includes(graph.executionScope.timeframe)&&Number.isSafeInteger(graph.executionScope.maxCandidates)&&graph.executionScope.maxCandidates>=2&&graph.executionScope.maxCandidates<=20&&graph.executionScope.maxConcurrentPositions===1,'GRAPH_EXECUTION_SCOPE','분봉 다종목 범위는 후보 2~20개, 동시 보유 1개로 구성하세요.');
 check(graph.executionScope||graph.nodes.some(n=>n.type==='MODEL'&&n.config.family==='HOURLY_VALUE_FOREST')||!graph.nodes.some(n=>n.config?.kind==='EXECUTION_ASSET'||n.config?.instrumentId==='execution:current'),'GRAPH_EXECUTION_SCOPE','현재 종목 입력에는 명시적인 다종목 실행 범위가 필요합니다.');
 if(graph.executionScope)check(graph.nodes.filter(n=>n.type==='INPUT'&&['ASSET_SET','MICROSTRUCTURE'].includes(n.config.kind)).every(n=>strategyTimeframeParameter(graph,n.id)?.value===graph.executionScope.timeframe),'GRAPH_EXECUTION_TIMEFRAME','후보 목록과 종목별 지표의 분봉을 실행 범위와 맞추세요.');
 check(graph.nodes.every(n=>n.config?.instrumentId!=='execution:current'||n.type==='INPUT'&&['MICROSTRUCTURE','POSITION'].includes(n.config.kind)),'GRAPH_EXECUTION_BINDING','현재 종목은 체결·호가와 자기 포지션 입력에 연결하세요.');
 const byId=new Map(),incoming=new Map(),outgoing=new Map();
 for(const n of graph.nodes){assertDecisionNode(n,byId);byId.set(n.id,n);incoming.set(n.id,[]);outgoing.set(n.id,[]);}
 const brokerSupport=inspectGraphBrokerSupport(graph);if(!brokerSupport.supported)check(false,brokerSupport.issues[0].code,brokerSupport.issues[0].message);
 check(graph.nodes.filter(n=>n.type==='VIBE').length<=1&&graph.nodes.filter(n=>n.type==='JEV_QUESTION').length<=8&&graph.nodes.filter(n=>n.type==='SIGNAL').length<=12&&graph.nodes.some(n=>['INPUT','VALUE'].includes(n.type))&&graph.nodes.filter(n=>n.type==='RISK').length===1&&graph.nodes.filter(n=>n.type==='ORDER').length===1&&byId.get(graph.outputNodeId)?.type==='ORDER','GRAPH_OUTPUT','자료·값 입력과 위험 한도·모의 주문을 연결하세요. JEV 질문은 8개, 거래 결정은 한 개까지 지원합니다.');
 const ids=new Set(),pairs=new Set();
 for(const e of graph.edges){
  check(exact(e,['id','from','to'])&&ID.test(e.id??'')&&!ids.has(e.id)&&exact(e.from,['nodeId','port'])&&exact(e.to,['nodeId','port'])&&byId.has(e.from.nodeId)&&byId.has(e.to.nodeId)&&e.from.nodeId!==e.to.nodeId,'GRAPH_EDGE','연결의 양쪽 노드와 고유 ID를 확인하세요.');
   const a=byId.get(e.from.nodeId),b=byId.get(e.to.nodeId),pair=edgePair(e);
   check(compatibleDecisionPorts(a,b,e)&&!pairs.has(pair),'GRAPH_PORT','자료·신호·조건·결정에 맞는 입력 포트를 연결하세요.');const parameterIssue=inspectParameterSource(a,b,e.to.port);if(parameterIssue)check(false,parameterIssue.code,parameterIssue.message);const semanticIssue=instrumentConnectionIssue(a,b,e.to.port);if(semanticIssue)check(false,semanticIssue.code,semanticIssue.message);
  ids.add(e.id);pairs.add(pair);incoming.get(b.id).push(e);outgoing.get(a.id).push(e);
 }
 for(const n of graph.nodes){
  if(n.type==='INPUT'&&n.config.kind==='POSITION'&&n.config.metricId==='INTENT_COOLDOWN_READY'){const target=byId.get(n.config.intentNodeId);check(Number.isSafeInteger(n.config.cooldownMs)&&n.config.cooldownMs>=0&&target?.type==='QUANT'&&target.config.sellIntent==='TAKE_PROFIT'&&hasDecisionPath(graph.edges,n.id,target.id),'GRAPH_POSITION_COOLDOWN','재실행 대기 입력이 실제 익절 동작의 조건으로 연결됐는지 확인하세요.');}
  if(n.type==='MODEL'&&n.config.family==='HOURLY_VALUE_FOREST'){
   const source=byId.get(incoming.get(n.id)[0]?.from.nodeId),risk=graph.nodes.find(v=>v.type==='RISK'),order=byId.get(outgoing.get(risk?.id)?.[0]?.to.nodeId);
   check(graph.nodes.filter(v=>v.type==='MODEL').length===1&&source?.config.kind==='CONTEXT'&&source.config.instrumentId===HOURLY_VALUE_INPUT&&source.config.required===true&&source.config.enabled!==false&&risk?.type==='RISK'&&!risk.config.mode&&order?.id===graph.outputNodeId&&order.type==='ORDER'&&order.config.sizing==='TARGET_WEIGHT','HOURLY_VALUE_GRAPH_SCOPE','자기 계좌·종목 비교 → 학습 판단 → 위험 확인 → 주문 경로를 연결하세요.');
  }
  if(n.type==='MODEL'&&n.config.family==='HOURLY_PATH_FOREST'){
   const market=byId.get(incoming.get(n.id).find(e=>e.to.port==='market')?.from.nodeId);
   check(market?.config.kind==='OHLCV'&&market.config.timeframe==='1h'&&market.config.instrumentId.startsWith('crypto:upbit:KRW-'),'HOURLY_MODEL_GRAPH_SCOPE','업비트 원화 종목의 확정 1시간봉을 연결하세요.');
  }
  if(n.type==='MODEL'&&n.config.family==='OWN_STATE_VALUE_FOREST'&&n.config.model?.timeframe==='1m'){
   const source=port=>byId.get(incoming.get(n.id).find(e=>e.to.port===port)?.from.nodeId),market=source('market'),position=source('position');
   check(market?.config.kind==='OHLCV'&&market.config.timeframe==='1m'&&market.config.instrumentId===n.config.model.instrumentId&&position?.config.kind==='POSITION'&&position.config.instrumentId===n.config.model.instrumentId,'JUDGMENT_GRAPH_SCOPE','분봉 판단모델의 종목과 1분봉, 자기 포지션 입력을 맞추세요.');
  }
  for(const issue of decisionNodeConnectionIssues(n,incoming.get(n.id),outgoing.get(n.id),byId))check(false,issue.code,issue.message);
 }
 const remaining=new Map([...incoming].map(([k,v])=>[k,v.length])),queue=[...remaining].filter(([,n])=>n===0).map(([k])=>k).sort(),order=[];
 while(queue.length){const key=queue.shift();order.push(key);for(const e of outgoing.get(key)){const to=e.to.nodeId;remaining.set(to,remaining.get(to)-1);if(remaining.get(to)===0){queue.push(to);queue.sort();}}}
 check(order.length===graph.nodes.length,'GRAPH_CYCLE','순환 연결을 해제하세요.');
 const ancestors=new Set([graph.outputNodeId]);for(const key of order.toReversed())if(ancestors.has(key))for(const e of incoming.get(key))ancestors.add(e.from.nodeId);
 check(graph.nodes.every(n=>ancestors.has(n.id)||n.type==='VALUE'),'GRAPH_DISCONNECTED','모든 노드의 경로를 최종 주문에 연결하세요.');
 assertQuantStrategyBindingMetadata(graph);
 assertGraphCompositions(graph,{portContract:decisionNodePortContract});
 return {contractVersion:DECISION_GRAPH_VERSION,graphHash:decisionGraphHash(graph),nodeOrder:order,signalNodeIds:order.filter(k=>byId.get(k).type==='SIGNAL'),incoming:Object.fromEntries([...incoming].map(([k,v])=>[k,v.map(e=>clone(e)).sort((a,b)=>a.id.localeCompare(b.id))])),outputNodeId:graph.outputNodeId};
}

/** Diagnose a draft canvas; compiler validity remains the publication authority. */
export function diagnoseDecisionGraph(graph){
 if(isRegimeProgramGraph(graph))return diagnoseRegimeProgramGraph(graph);
 const graphNodes=Array.isArray(graph?.nodes)?graph.nodes:[],graphEdges=Array.isArray(graph?.edges)?graph.edges:[],nodes={},edges={},issues=[],byId=new Map(),incoming=new Map(),outgoing=new Map(),edgeIds=new Set();
 const add=(issue,edgeId=null)=>{const value={...issue,...(edgeId===null?{}:{edgeId})};if(!issues.some(i=>i.code===value.code&&i.nodeId===value.nodeId&&i.portId===value.portId&&i.edgeId===value.edgeId))issues.push(value);if(value.nodeId!==null&&Object.hasOwn(nodes,value.nodeId)&&!nodes[value.nodeId].issues.some(i=>i.code===value.code&&i.portId===value.portId&&i.edgeId===value.edgeId))nodes[value.nodeId].issues.push(value);if(edgeId!==null&&Object.hasOwn(edges,edgeId))edges[edgeId].issues.push(value);};
 for(const n of graphNodes){
  const id=typeof n?.id==='string'?n.id:null;if(id!==null&&!Object.hasOwn(nodes,id)){Object.defineProperty(nodes,id,{value:{state:'VALID',issues:[]},enumerable:true,configurable:true});incoming.set(id,[]);outgoing.set(id,[]);}
  try{assertDecisionNode(n,byId);}catch(error){add(connectionIssue(error.code??'GRAPH_NODE',error.message,id));}
  if(id!==null&&!byId.has(id))byId.set(id,n);
 }
 for(const [index,e]of graphEdges.entries()){
  const id=typeof e?.id==='string'?e.id:'edge:'+index;if(!Object.hasOwn(edges,id))Object.defineProperty(edges,id,{value:{state:'VALID',issues:[]},enumerable:true,configurable:true});
  if(!exact(e,['id','from','to'])||!ID.test(e.id??'')||edgeIds.has(e.id)||!exact(e.from,['nodeId','port'])||!exact(e.to,['nodeId','port'])){add(connectionIssue('GRAPH_EDGE','연결의 양쪽 노드와 고유 ID를 확인하세요.',e?.to?.nodeId??null,e?.to?.port??null),id);continue;}edgeIds.add(e.id);
  const result=inspectDecisionConnection(graph,e,{ignoreEdgeId:e.id});if(!result.ok)add(result,id);
  if(incoming.has(e.to.nodeId))incoming.get(e.to.nodeId).push(e);if(outgoing.has(e.from.nodeId))outgoing.get(e.from.nodeId).push(e);
 }
 for(const n of byId.values())for(const issue of decisionNodeConnectionIssues(n,incoming.get(n.id),outgoing.get(n.id),byId))add(issue);
 const connected=graphEdges.filter(e=>byId.has(e?.from?.nodeId)&&byId.has(e?.to?.nodeId)),ancestors=new Set(),pending=[graph?.outputNodeId];
 while(pending.length){const id=pending.pop();if(ancestors.has(id))continue;ancestors.add(id);for(const edge of connected)if(edge.to.nodeId===id)pending.push(edge.from.nodeId);}
 for(const n of byId.values())if(n.type!=='VALUE'&&!ancestors.has(n.id)&&!nodes[n.id].issues.some(i=>i.code==='GRAPH_DISCONNECTED'))add(connectionIssue('GRAPH_DISCONNECTED','이 노드의 출력을 최종 주문에 연결하세요.',n.id,decisionNodePortContract(n).outputs[0]?.id??null));
 for(const e of connected)if(hasDecisionPath(connected.filter(other=>other!==e),e.to.nodeId,e.from.nodeId))for(const id of [e.from.nodeId,e.to.nodeId])add(connectionIssue('GRAPH_CYCLE','순환 연결을 해제하세요.',id,id===e.to.nodeId?e.to.port:e.from.port),e.id);
 let valid=true;try{compileDecisionStrategyGraph(graph);}catch(error){valid=false;if(!issues.some(i=>i.code===error.code))add(connectionIssue(error.code??'GRAPH_SCHEMA',error.message,error.code==='GRAPH_OUTPUT'?graph?.outputNodeId??null:null));}
 for(const n of byId.values()){
  const entry=nodes[n.id],links=incoming.get(n.id),ports=decisionNodePortContract(n),missing=ports.inputs.some(p=>links.filter(e=>e.to.port===p.id).length<p.minConnections);
  const emptyMixer=n.type==='DECISION_MIXER'&&['FIXED','TARGET_BLEND'].includes(n.config?.mode)&&ID.test(n.config.weightVersionId??'')&&Array.isArray(n.config.weights)&&n.config.weights.length<2&&n.config.weights.every(w=>exact(w,['nodeId','value'])&&ID.test(w.nodeId??'')&&ratio(w.value));
  const incomplete=i=>['GRAPH_INPUT','GRAPH_DISCONNECTED','GRAPH_VIBE_MARKET'].includes(i.code)||['GRAPH_INPUT_ARITY','GRAPH_ROUTER_INPUT','GRAPH_WEIGHT_INPUT'].includes(i.code)&&missing||i.code==='GRAPH_DECISION_WEIGHTS'&&missing&&emptyMixer;
  entry.state=entry.issues.some(i=>!incomplete(i))?'INVALID':entry.issues.length?'INCOMPLETE':n.type==='INPUT'&&n.config?.enabled===false?'DISABLED':'VALID';
 }
 for(const [id,entry]of Object.entries(edges)){const e=graphEdges.find(edge=>edge?.id===id);entry.state=entry.issues.length?'INVALID':byId.get(e?.from?.nodeId)?.config?.enabled===false?'DISABLED':'VALID';}
 return {nodes,edges,valid,issues};
}

export function createDecisionStrategyGraph({preset='QUANT',instrumentId='crypto:okx:BTC-USDT',moduleId='MEAN_REVERSION'}={}){
 check(['QUANT','VIBE','MIXED'].includes(preset),'GRAPH_PRESET','퀀트·JEV·혼합 프리셋을 선택하세요.');
 const nodes=[node('market','INPUT',{kind:'OHLCV',instrumentId,timeframe:'4h',required:true},0,80)],edges=[];
 if(preset!=='VIBE'){nodes.push(node('signal','SIGNAL',createStrategyModule(moduleId),240,40),node('quant','QUANT',{buyAbove:.3,sellBelow:-.3,buyTargetWeight:.5,sellTargetWeight:0},480,40));edges.push(link('market','signal','data','market'),link('signal','quant','signal','signal'));}
 if(preset!=='QUANT'){nodes.push(node('vibe','VIBE',{provider:'JEV',instructions:'확정 시세와 연결된 투자 자료를 평가해 매수·유지·매도를 결정한다.'},480,240));edges.push(link('market','vibe','data','context'));}
 let final=preset==='VIBE'?'vibe':'quant';
 if(preset==='MIXED'){nodes.push(node('mixer','DECISION_MIXER',{mode:'FIXED',weightVersionId:'weights-v1',weights:[{nodeId:'quant',value:.5},{nodeId:'vibe',value:.5}]},720,140));edges.push(link('quant','mixer','decision','decisions'),link('vibe','mixer','decision','decisions'));final='mixer';}
 nodes.push(node('risk','RISK',{maxExposure:.6,maxOrderWeight:.2,minConfidence:.6},960,140),node('order','ORDER',{execution:'PAPER',sizing:'TARGET_WEIGHT'},1200,140));edges.push(link(final,'risk','decision','decision'),link('risk','order','approved','approved'));
 const graph={schemaVersion:2,contractVersion:DECISION_GRAPH_VERSION,triggers:['manual','closed_bar'],nodes,edges,outputNodeId:'order'};compileDecisionStrategyGraph(graph);return graph;
}

/** A starter assembled from the same editable primitives as every other graph. */
export function createPortfolioDecisionStrategyGraph({jev=false}={}){
 const nodes=[
  createDecisionStrategyNode('INPUT',{id:'assets',position:{x:0,y:0},config:{kind:'ASSET_SET',scope:'MIND_UNIVERSE',timeframe:'1d',required:true}}),
  ...['FILTER','RANK','ALLOCATE','REBALANCE'].map((type,index)=>createDecisionStrategyNode(type,{id:type.toLowerCase(),position:{x:240*(index+1),y:0}})),
  createDecisionStrategyNode(jev?'JEV_QUESTION':'VALUE',{id:'budget',position:{x:480,y:280},...(jev?{config:{provider:'JEV',question:{schemaVersion:1,contractVersion:JEV_QUESTION_CONTRACT,id:'budget',type:'noul',instructions:'연결한 후보의 수익률·변동성과 시장 폭을 검토하여 위험 자산에 자금을 배분하기에 우호적인 상태인지 판단한다.',criteria:{true:'상승의 폭과 지속성이 충분하고 변동성 대비 기대수익이 양호하다.',false:'추세가 약화되거나 소수 종목에 집중되어 현금 비중을 높이는 편이 적절하다.'}}}}:{config:{dataType:'NUMBER',value:1,unit:'ratio'}})}),
  ...(jev?[createDecisionStrategyNode('INPUT',{id:'holdings',position:{x:240,y:280},config:{kind:'POSITION',instrumentId:'crypto:upbit:BTC-ETH',metricId:'PORTFOLIO',required:true}})]:[]),
  createDecisionStrategyNode('RISK',{id:'risk',position:{x:1200,y:0},config:{mode:'PORTFOLIO',maxExposure:1,maxOrderWeight:1}}),
  createDecisionStrategyNode('ORDER',{id:'order',position:{x:1440,y:0},config:{execution:'PAPER',sizing:'TARGET_WEIGHTS'}})
 ];
 let graph={schemaVersion:2,contractVersion:DECISION_GRAPH_VERSION,nodes,edges:[],outputNodeId:'order',triggers:['manual','closed_bar']};
 for(const [from,to,fromPort,toPort] of [['assets','filter','data','assets'],['filter','rank','assets','assets'],['rank','allocate','rank','rank'],['budget','allocate','value','budget'],['allocate','rebalance','targets','targets'],['rebalance','risk','targets','decision'],['risk','order','approved','approved'],...(jev?[['rank','budget','rank','context'],['holdings','budget','data','context']]:[])])graph=connectDecisionStrategyNodes(graph,{from,to,fromPort,toPort});
 compileDecisionStrategyGraph(graph);return graph;
}

const blocked=(...codes)=>({ready:false,status:'BLOCKED',reasonCodes:unique(codes.flat())});
const pending=id=>({ready:false,status:'PREPARED',reasonCodes:['VIBE_DECISION_REQUIRED'],requiredVibeNodeIds:[id]});
const propagate=values=>values.some(v=>v.status==='BLOCKED')?blocked(values.flatMap(v=>v.reasonCodes??[])):values.some(v=>!v.ready)?{ready:false,status:'PREPARED',reasonCodes:unique(values.flatMap(v=>v.reasonCodes??[])),requiredVibeNodeIds:unique(values.flatMap(v=>v.requiredVibeNodeIds??[])),...(values.some(v=>v.requiredQuestionNodeIds?.length)?{requiredQuestionNodeIds:unique(values.flatMap(v=>v.requiredQuestionNodeIds??[]))}:{})}:null;
const baseDecision=(action,targetWeight,strength,basisRefs,extra={})=>({action,stance:'normal',targetWeight,strength,basisRefs:unique(basisRefs),authority:'QUANT_FINAL',confidence:null,probabilities:null,provider:'quant',vibeRefs:[],...extra});

export function evaluateDecisionStrategyGraph(graph,features,{asOf,sourceHash,inputs={},decisions={},context={},trigger='manual',simulationResponsePolicy=null}={}){
 check(!isRegimeProgramGraph(graph),'REGIME_PROGRAM_DRIVER_REQUIRED','국면 운용은 선택 상태와 자기 계좌를 관리하는 국면 실행기에 연결하세요.');
 check(simulationResponsePolicy===null||simulationResponsePolicy===SIMULATION_RESPONSE_POLICY,'GRAPH_RESPONSE_POLICY','시뮬레이션 응답 검증 정책을 확인하세요.');
 const compiled=compileDecisionStrategyGraph(graph);check(iso(asOf)&&HASH.test(sourceHash??'')&&Array.isArray(features)&&plain(inputs)&&plain(decisions)&&plain(context)&&['manual','closed_bar','market_event'].includes(trigger),'GRAPH_INPUT','실행 시각·입력·결정·계좌 정보를 확인하세요.');
 const nodes=new Map(graph.nodes.map(n=>[n.id,n])),memo=new Map(),trace=[];
 const currentWeight=context.currentWeight,positionReady=ratio(currentWeight),boundAt=context.inputAvailableAt??asOf,portfolioReady=validPortfolioContext(context.portfolio,{profileId:context.profileId,asOf});
 let targetBranchChanged=false;
 const targetPortfolio=()=>targetBranchChanged?{...context.portfolio,lastRebalancedAt:null,lastAllocationBudget:null}:context.portfolio;
 check(iso(boundAt)&&boundAt>=asOf,'GRAPH_INPUT_TIME','자료 확인 시각을 확인하세요.');
 function visit(id){
  const memoKey=id+":"+targetBranchChanged;if(memo.has(memoKey))return memo.get(memoKey);let n=nodes.get(id);const allLinks=compiled.incoming[id],links=allLinks.filter(e=>!isParameterPort(e.to.port)),reads=[];let output,details={},parameterDetails=null;
  const read=e=>{const source=visit(e.from.nodeId),value=source.ready&&nodes.get(e.from.nodeId)?.type==='RANK'&&e.from.port==='breadth'?{ready:true,status:'READY',kind:'NUMBER',value:source.value.breadth,unit:'ratio',basisRefs:clone(source.basisRefs)}:source;reads.push({nodeId:e.from.nodeId,port:e.to.port,output:value});return value;};
  const parameterLinks=allLinks.filter(e=>isParameterPort(e.to.port));
  if(parameterLinks.length){
   let config=n.config;const parameterBindings=[];
   for(const edge of parameterLinks){const spec=parameterSpec(n,edge.to.port),source=read(edge);if(!source.ready||source.omitted){output=blocked(source.reasonCodes?.length?source.reasonCodes:['GRAPH_PARAMETER_INPUT_REQUIRED']);break;}
    const checked=parameterValue(spec,source.value,decisionNumericUnit(nodes.get(edge.from.nodeId),source));if(!checked.ready){output=blocked(checked.code);break;}
    config=applyParameterValue(config,spec,checked.value);parameterBindings.push({field:spec.key,sourceNodeId:edge.from.nodeId,value:checked.value});
   }
   if(!output){n={...n,config};try{assertDecisionNode(n,new Map());parameterDetails={parameterBindings,resolvedConfigHash:hashInputPackage(config)};}catch(error){output=blocked(error.code??'GRAPH_PARAMETER_CONFIG');}}
  }
  if(output){}else if(n.type==='INPUT'){
   const binding=n.config.instrumentId==='execution:current'?{...n.config,instrumentId:context.executionInstrumentId}:effectiveStrategyInputBinding(n.config,parameterLinks.some(e=>e.to.port==='param:instrumentId')?null:context.instrumentBinding),v=resolveGraphInput(inputs,id,{graph}),optional=!binding.required;
   const cutoff=binding.kind==='OHLCV'?asOf:boundAt;
   const parameterInputValid=!parameterLinks.length||v?.resolvedBindingHash===hashInputPackage(n.config)&&(binding.kind==='OHLCV'?v.instrumentId===binding.instrumentId&&v.timeframe===binding.timeframe:binding.kind==='ASSET_SET'?v.value?.timeframe===binding.timeframe:true);const valid=parameterInputValid&&v&&v.ready===true&&iso(v.asOf)&&v.asOf<=cutoff&&iso(v.availableAt)&&v.availableAt<=boundAt&&Array.isArray(v.sourceRefs)&&v.sourceRefs.length>0&&v.sourceRefs.every(r=>plain(r)&&ID.test(r.id??'')&&HASH.test(r.contentHash??'')&&typeof r.sourceRef==='string'&&r.sourceRef.length>0)&&(!Object.hasOwn(binding,'maxAgeMs')||Date.parse(cutoff)-Date.parse(v.asOf)<=binding.maxAgeMs);
   if(binding.enabled===false)output={ready:true,status:'READY',kind:binding.kind,value:null,basisRefs:[],omitted:true,disabled:true};
   else if(!valid)output=optional&&v?.ready!==true?{ready:true,status:'READY',kind:binding.kind,value:null,basisRefs:[],omitted:true}:{...blocked(v?.missing?.length?v.missing:['INPUT_NOT_READY']),inputNodeId:id};
   else if(binding.kind==='ASSET_SET'&&(!portfolioReady||!validPortfolioCandidateInput(v,{profileId:context.profileId,asOf,portfolio:context.portfolio})))output=blocked('PORTFOLIO_CANDIDATE_INVALID');
   else if(binding.kind==='ASSET_SET'&&(binding.instrumentIds??(binding.instrumentId?[binding.instrumentId]:[])).some(id=>!v.value.items.some(i=>i.instrumentId===id)))output=blocked('PORTFOLIO_INSTRUMENT_MISSING');
   else if(binding.kind==='EXECUTION_ASSET'&&(v.value!==context.executionInstrumentId||!context.portfolio?.weights||!ID.test(v.value??'')))output=blocked('EXECUTION_ASSET_INVALID');
   else if(binding.kind==='METRIC'&&!finite(v.value))output=blocked('METRIC_VALUE_REQUIRED');
   else if(binding.kind==='MICROSTRUCTURE'&&!validMicrostructureInput(binding,v))output=blocked('MICROSTRUCTURE_VALUE_INVALID');
   else if(binding.kind==='POSITION'&&(!validPositionInput(binding,v)||portfolioReady&&binding.metricId==='PORTFOLIO'&&(v.value.profileId!==context.profileId||v.value.quoteCurrency!==context.portfolio.quoteCurrency)))output=blocked('POSITION_VALUE_INVALID');
   else if(binding.kind==='SELECTION'&&!validSelectionInput(binding,v,{profileId:context.profileId,asOf}))output=blocked('SELECTION_VALUE_INVALID');
   else if(binding.kind==='CAMPAIGN'&&!validCampaignInput(binding,v,{profileId:context.profileId,accountId:context.accountId,asOf:boundAt}))output=blocked('CAMPAIGN_VALUE_INVALID');
   else if(binding.kind==='OHLCV'&&(!plain(v.value)||!Array.isArray(v.value.bars)||!v.value.bars.length))output=blocked('OHLCV_VALUE_REQUIRED');
   else output={ready:true,status:'READY',kind:['SELECTION','CAMPAIGN'].includes(binding.kind)?'BOOLEAN':binding.kind==='MICROSTRUCTURE'?microstructureMetric(binding.metricId).dataType:binding.kind==='POSITION'?positionInputMetric(binding.metricId).dataType:binding.kind==='EXECUTION_ASSET'?'TEXT':binding.kind,value:binding.kind==='ASSET_SET'&&(binding.instrumentId||binding.instrumentIds)?{...clone(v.value),items:v.value.items.filter(i=>binding.instrumentId?i.instrumentId===binding.instrumentId:binding.instrumentIds.includes(i.instrumentId)).map(i=>clone(i))}:clone(v.value),unit:v.unit??null,basisRefs:v.sourceRefs.map(r=>r.id),asOf:v.asOf,availableAt:v.availableAt,...(parameterLinks.length?{resolvedBinding:binding}:{})};
   details={...details,binding:clone(binding),inputHash:hashInputPackage(v??null)};
  }else if(n.type==='SESSION_SIGNAL'){
   const source=read(links[0]);output=propagate([source]);if(!output){try{check(context.executionMode==='PAPER','SESSION_RULE_SCOPE','모의 세션 실행 확인');const result=sessionTrendSignal(source.value.signalHistory,n.config,asOf);output={ready:true,status:'READY',kind:'NUMBER',value:result.value,basisRefs:source.basisRefs};details=result;}catch(e){output=blocked(e.code??'SESSION_REGIME_INPUT');}}
  }else if(n.type==='SESSION_RULE'||n.type==='SESSION_TREND'){
   const source=read(links[0]);output=propagate([source]);
   if(!output){try{const value=source.value;check(context.executionMode==='PAPER'&&value?.date===context.sessionDate&&value.decisionAt===asOf&&value.account?.symbol===n.config.symbol,'SESSION_RULE_SCOPE','모의 세션 계좌 및 판단 시각 확인');const prepare=n.type==='SESSION_TREND'?prepareSessionTrendPlan:Object.hasOwn(n.config,'maxExposure')?prepareCappedSessionPlan:prepareSessionPlan;const plan=prepare(value.account,n.config,{date:value.date,decisionAt:asOf,feeBps:value.feeBps,...(n.config.volatilityTarget!==undefined?{signalHistory:value.signalHistory}:{})});output={ready:true,status:'READY',kind:'ORDER_PLAN',value:plan,basisRefs:source.basisRefs};details={...(plan.strategy?{regime:plan.strategy.regime,targetWeight:plan.strategy.targetWeight}:{}),mode:plan.mode,t:value.account.t,star:plan.star,budget:plan.budget,orders:plan.orders.length,planHash:plan.planHash};}catch(e){output=blocked(e.code??'SESSION_RULE_INPUT');}}
  }else if(n.type==='RISK'&&n.config.mode==='SESSION'){
   const source=read(links[0]);output=propagate([source]);if(!output){try{const state=context.sessionAccount;assertSessionPlan(source.value,state);check(context.executionMode==='PAPER','SESSION_RULE_PAPER','모의 세션 실행 확인');output={...clone(source),kind:'APPROVED_ORDER_PLAN',riskAllowed:true};}catch(e){output=blocked(e.code??'SESSION_RULE_RISK');}}
  }else if(n.type==='ORDER'&&n.config.sizing==='SESSION_ORDERS'){
   const source=read(links[0]);output=propagate([source]);if(!output){const plan=n.config.sessionOrderPolicy?prepareBrokerSessionPlan(context.sessionAccount,source.value,n.config):source.value;output={...clone(source),value:plan,kind:'ORDER_PLAN',orderAllowed:source.riskAllowed===true,execution:'PAPER',sizing:'SESSION_ORDERS',...(n.config.sessionOrderPolicy?{brokerRequests:sessionBrokerRequests(plan)}:{})};}
  }else if(n.type==='MODEL'){
   const mode=context.executionMode??nodes.get(graph.outputNodeId).config.execution;
   if(n.config.family===SURGE_MODEL_FAMILY){const source=read(links[0]);output=propagate([source]);if(!output){try{output=evaluateSurgePath(n.config,source.value,context.portfolio,context.portfolioFees,{asOf:boundAt,accountId:context.accountId,maxQuoteAgeMs:nodes.get(graph.outputNodeId).config.maxQuoteAgeMs??3000});}catch(error){output=blocked(error.code??'SURGE_MODEL_INPUT');}}}
   else if(n.config.family==='HOURLY_VALUE_FOREST'){const source=read(links[0]);output=propagate([source]);if(!output){try{output=evaluateHourlyValueNode(n.config,source.value,{asOf:boundAt,profileId:context.profileId,accountId:context.accountId,binding:context.hourlyValueBinding,universe:context.hourlyValueUniverse,executionInstrumentId:context.executionInstrumentId,currentWeight,graphHash:compiled.graphHash,executionEnabled:context.hourlyValueExecutionEnabled,completedSteps:context.hourlyValueCompletedSteps??0});}catch(error){output=blocked(error.code??'HOURLY_VALUE_INPUT');}}}
   else if(n.config.family==='HOURLY_PATH_FOREST'){const market=read(links[0]);output=propagate([market]);if(!output&&market.resolvedBinding&&(market.resolvedBinding.timeframe!=='1h'||!market.resolvedBinding.instrumentId.startsWith('crypto:upbit:KRW-')))output=blocked('HOURLY_MODEL_GRAPH_SCOPE');if(!output)output=n.config.model?predictHourlyPathModel(n.config.model,market.value,{asOf:market.asOf,availableAt:market.availableAt,decisionAt:boundAt,components:n.config.components,componentTrace:Boolean(n.config.components)}):blocked('HOURLY_MODEL_REQUIRED');}
   else if(n.config.family==='OWN_STATE_VALUE_FOREST'){const market=read(links.find(e=>e.to.port==='market')),position=read(links.find(e=>e.to.port==='position'));output=propagate([market,position]);if(!output&&(position.value?.profileId!==context.profileId||position.value?.accountId!==context.accountId||!context.profileId||!context.accountId))output=blocked('JUDGMENT_ACCOUNT_SCOPE');if(!output&&market.resolvedBinding&&(market.resolvedBinding.timeframe!==n.config.model?.timeframe||market.resolvedBinding.instrumentId!==n.config.model?.instrumentId))output=blocked('JUDGMENT_GRAPH_SCOPE');if(!output)output=n.config.model?predictJudgmentModel(n.config.model,market.value,position.value,{asOf,decisionAt:boundAt,executionMode:mode}):blocked('JUDGMENT_MODEL_REQUIRED');}
   else {const source=read(links[0]);output=propagate([source]);if(!output)output=n.config.model?predictVampModel(n.config.model,source.value,{asOf,executionMode:mode}):blocked('VAMP_MODEL_REQUIRED');}
  }else if(n.type==='VALUE'){
   output={ready:true,status:'READY',kind:n.config.dataType,value:clone(n.config.value),basisRefs:['strategy-node:'+id]};
  }else if(n.type==='SIGNAL'){
   const source=read(links[0]);output=propagate([source]);
   if(!output&&(source.omitted||source.kind!=='OHLCV'||!plain(source.value)||!Array.isArray(source.value.bars)||!source.value.bars.length))output=blocked('SIGNAL_OHLCV_REQUIRED');
   if(!output){const f=features.find(v=>v.nodeId===id);if(!f||f.parametersHash!==n.config.parametersHash||f.moduleId!==n.config.moduleId||!f.ready)output=blocked(f?.missing?.length?f.missing:['SIGNAL_NOT_READY']);else{const raw=f.moduleId==='BTC_DOC9'?f.mechanicalScore?.S:['SMA_TREND','MOMENTUM'].includes(f.moduleId)?f.mechanicalScore:f.moduleId==='MEAN_REVERSION'?(f.signal.direction==='buy'?1:f.signal.direction==='sell'?-1:0)*f.mechanicalScore:f.signal.entryCandidate?f.mechanicalScore:f.trailing?.exitCandidate?-f.mechanicalScore:0;check(finite(raw),'GRAPH_FEATURE','유한한 신호 점수를 확인하세요.');const stable=clone(f);if(stable.trailing)delete stable.trailing.candidateDetectedAt;output={ready:true,status:'READY',score:Math.max(-1,Math.min(1,raw)),basisRefs:unique([...source.basisRefs,'strategy-node:'+id])};details={featureHash:hashInputPackage(stable),parametersHash:f.parametersHash};}}
  }else if(n.type==='ASSET_REDUCE'){
   const source=read(links.find(e=>e.to.port==='values')),excludeLink=links.find(e=>e.to.port==='exclude'),excluded=excludeLink?read(excludeLink):null;output=propagate([source,...(excluded?[excluded]:[])]);
   if(!output){try{details=reduceAssetValues(source.value,n.config,excluded?.value??null);output={ready:true,status:'READY',kind:'NUMBER',value:details.value,unit:details.unit,basisRefs:unique([...source.basisRefs,...(excluded?.basisRefs??[]),'strategy-node:'+id])};}catch(e){output=blocked(e.code??'GRAPH_ASSET_REDUCE');}}
  }else if(n.type==='ASSET_METRIC'||n.type==='ASSET_COMPARE'||n.type==='ASSET_LOGIC'||n.type==='ASSET_FILTER'){
   const ordered=n.type==='ASSET_FILTER'?['assets','conditions'].map(port=>read(links.find(e=>e.to.port===port))):links.map(read);output=propagate(ordered);
   if(!output){try{const value=evaluateAssetCondition(n.type,n.config,ordered.map(v=>v.value),{portfolio:context.portfolio});output={ready:true,status:'READY',kind:n.type==='ASSET_FILTER'?'ASSET_SET':n.type==='ASSET_METRIC'?'ASSET_VALUES':'ASSET_CONDITIONS',value,basisRefs:unique(ordered.flatMap(v=>v.basisRefs))};}catch(e){output=blocked(e.code??'GRAPH_ASSET_CONDITION_SCOPE');}}
  }else if(n.type==='FILTER'||n.type==='RANK'){
   const prior=read(links[0]);output=propagate([prior]);if(!output){const result=n.type==='FILTER'?filterPortfolioCandidates(prior.value,n.config):rankPortfolioCandidates(prior.value,n.config);output={ready:true,status:'READY',kind:n.type==='FILTER'?'ASSET_SET':'ASSET_RANK',value:result.value,basisRefs:unique([...prior.basisRefs,'strategy-node:'+id])};details={excluded:result.excluded};}
  }else if(n.type==='SELECT'){
   const prior=read(links.find(e=>e.to.port==='rank')),choiceEdge=links.find(e=>e.to.port==='choice'),choice=choiceEdge?read(choiceEdge):null;output=propagate(choice?[prior,choice]:[prior]);if(!output)output={ready:true,status:'READY',kind:'ASSET_SELECTION',value:selectPortfolioCandidates(prior.value,n.config,choice?{choice:choice.value}:{}),basisRefs:unique([...prior.basisRefs,...(choice?.basisRefs??[]),'strategy-node:'+id])};
  }else if(n.type==='MEMBER'){
   const assets=read(links.find(e=>e.to.port==='assets')),instrument=read(links.find(e=>e.to.port==='instrument'));output=propagate([assets,instrument]);if(!output){if(assets.value?.contractVersion!==PORTFOLIO_SELECTION_VERSION||!Array.isArray(assets.value.instrumentIds)||typeof instrument.value!=='string')output=blocked('ASSET_MEMBERSHIP_INPUT');else output={ready:true,status:'READY',kind:'BOOLEAN',value:assets.value.instrumentIds.includes(instrument.value),basisRefs:unique([...assets.basisRefs,...instrument.basisRefs,'strategy-node:'+id])};}
  }else if(n.type==='ALLOCATE'){
   const ranked=read(links.find(e=>e.to.port==='rank')),retainEdge=links.find(e=>e.to.port==='retain'),retain=retainEdge?read(retainEdge):null,budget=!retain&&ranked.ready&&ranked.value.items.length===0?{ready:true,status:'READY',value:0,basisRefs:[]}:read(links.find(e=>e.to.port==='budget'));output=propagate([ranked,budget,...(retain?[retain]:[])]);if(!output){if(!portfolioReady)output=blocked('PORTFOLIO_CONTEXT_REQUIRED');else{const result=allocatePortfolioTargets(ranked.value,budget.value,n.config,targetPortfolio(),retain?.value);output={ready:true,status:'READY',kind:'TARGET_WEIGHTS',value:result.value,portfolioState:{allocationBudget:result.requestedBudget,routerSelections:{}},basisRefs:unique([...ranked.basisRefs,...budget.basisRefs,...(retain?.basisRefs??[]),'strategy-node:'+id])};details={requestedBudget:result.requestedBudget,unallocatedBudget:result.unallocatedBudget,excluded:result.excluded};}}
  }else if(n.type==='REBALANCE'){
   if(!portfolioReady)output=blocked('PORTFOLIO_CONTEXT_REQUIRED');else if(!portfolioRebalanceDue(targetPortfolio(),asOf,n.config)){output={ready:true,status:'READY',kind:'TARGET_WEIGHTS',value:currentPortfolioTargets(context.portfolio,asOf),portfolioState:{allocationBudget:context.portfolio.lastAllocationBudget??null,routerSelections:{}},basisRefs:['portfolio-state:'+context.profileId,'strategy-node:'+id]};details={reason:'REBALANCE_NOT_DUE',lastRebalancedAt:context.portfolio.lastRebalancedAt};}else{const prior=read(links[0]);output=propagate([prior]);if(!output){const value=rebalancePortfolioTargets(prior.value,n.config,targetPortfolio());output={...clone(prior),value,basisRefs:unique([...prior.basisRefs,'strategy-node:'+id])};details={reason:value.rebalanceDue?'REBALANCE_DUE':'WEIGHT_DIFFERENCE_BELOW_MINIMUM'};}}
  }else if(n.type==='CONDITION'){
   const comparisonEdge=n.config.rightOperand==='INPUT'?links.find(e=>e.to.port==='compare'):parameterLinks.find(e=>e.to.port==='param:value'),value=read(links.find(e=>e.to.port==='value')),comparison=comparisonEdge?read(comparisonEdge):null;output=propagate(comparison?[value,comparison]:[value]);if(!output){const actual=value.score??value.value,target=comparison?(comparison.score??comparison.value):n.config.value,text=typeof actual==='string'||typeof target==='string';if(text&&(!comparison||typeof actual!=='string'||typeof target!=='string'||!['eq','neq'].includes(n.config.operator)))output=blocked('CONDITION_VALUE_REQUIRED');else if(!text&&(!finite(actual)||!finite(target)))output=blocked('CONDITION_VALUE_REQUIRED');else if(!text&&comparison&&!unitsCompatible(decisionNumericUnit(nodes.get(links.find(e=>e.to.port==='value').from.nodeId),value),decisionNumericUnit(nodes.get(comparisonEdge.from.nodeId),comparison)))output=blocked('CONDITION_UNIT_MISMATCH');else{const result=n.config.operator==='gt'?actual>target:n.config.operator==='gte'?actual>=target:n.config.operator==='lt'?actual<target:n.config.operator==='lte'?actual<=target:n.config.operator==='eq'?actual===target:actual!==target;output={ready:true,status:'READY',value:result,actual,threshold:target,operator:n.config.operator,basisRefs:comparison?unique([...value.basisRefs,...comparison.basisRefs]):value.basisRefs};}}
  }else if(n.type==='BOOLEAN_LOGIC'){
   const values=links.map(read);output=propagate(values);if(!output){if(values.some(v=>typeof v.value!=='boolean'))output=blocked('BOOLEAN_VALUE_REQUIRED');else output={ready:true,status:'READY',value:n.config.operation==='ALL'?values.every(v=>v.value):n.config.operation==='ANY'?values.some(v=>v.value):!values[0].value,basisRefs:unique(values.flatMap(v=>v.basisRefs??[]))};}
  }else if(n.type==='JEV_QUESTION'){
   const values=links.map(read);output=propagate(values);if(!output){const answer=decisions[id];if(!values.some(v=>!v.omitted))output=blocked('QUESTION_CONTEXT_REQUIRED');else if(!answer)output={ready:false,status:'PREPARED',reasonCodes:['JEV_QUESTION_REQUIRED'],requiredQuestionNodeIds:[id]};else{const held=inspectGraphQuestionReuse(answer,{question:n.config.question,currentInputHash:hashInputPackage(reads),graphHash:compiled.graphHash,asOf,availableAt:boundAt,reuseWindowMs:n.config.reuseWindowMs??0});const inspected=inspectJevQuestionAnswer(answer.answer,n.config.question);output={ready:true,status:'READY',kind:n.config.question.type==='choice'?'CHOICE':'NUMBER',value:inspected.value,answer:inspected,basisRefs:unique(values.flatMap(v=>v.basisRefs??[]).concat('strategy-node:'+id)),rawRequestHash:answer.rawRequestHash,rawResponseHash:answer.rawResponseHash,...(held?{heldDecision:held}:{})};}details={questionHash:hashInputPackage(n.config.question),inputNodeIds:links.map(e=>e.from.nodeId)};}
  }else if(n.type==='QUANT'){
   const signal=read(links.find(e=>e.to.port==='signal')),position=Object.hasOwn(n.config,'sellTargetQuantity')?read(links.find(e=>e.to.port==='position')):null;output=propagate([signal,...(position?[position]:[])]);if(!output&&position&&(position.value?.contractVersion!=='position-input-v1'||position.value.accountId!==context.accountId||position.value.profileId!==context.profileId||position.value.instrumentId!==context.executionInstrumentId))output=blocked('QUANT_POSITION_SCOPE');if(!output&&n.config.mode==='CONDITION'&&typeof signal.value!=='boolean')output=blocked('BOOLEAN_VALUE_REQUIRED');if(!output){if(!positionReady)output=blocked('PORTFOLIO_WEIGHT_REQUIRED');else{const c=n.config,condition=c.mode==='CONDITION',action=condition?(signal.value?c.onTrue:c.onFalse):signal.score>=c.buyAbove?'buy':signal.score<=c.sellBelow?'sell':'hold',target=c.targetMode==='WEIGHT_DELTA'?(action==='buy'?Math.min(1,currentWeight+c.buyWeightDelta):action==='sell'?Math.max(0,currentWeight-c.sellWeightDelta):currentWeight):(action==='buy'?Math.max(currentWeight,c.buyTargetWeight):action==='sell'?(position?currentWeight*Math.min(1,Number(c.sellTargetQuantity)/Math.max(position.value.quantity,Number.MIN_VALUE)):c.sellPositionFraction!==undefined?currentWeight*(1-c.sellPositionFraction):Math.min(currentWeight,c.sellTargetWeight)):currentWeight),intent=action!=='hold'&&c[action+'Intent']?{code:c[action+'Intent'],nodeId:id}:null;output={ready:true,status:'READY',decision:baseDecision(action,target,condition?null:Math.abs(signal.score),[...signal.basisRefs,...(position?.basisRefs??[]),'strategy-node:'+id],{...(intent?{intent}:{}),...(action==='sell'&&c.sellPositionFraction!==undefined&&context.executionInstrumentId?{positionFraction:{instrumentId:context.executionInstrumentId,fraction:c.sellPositionFraction}}:{}),...(position&&action==='sell'?{positionTarget:{instrumentId:position.value.instrumentId,quantity:c.sellTargetQuantity}}:{})} )};details={method:condition?'EXPLICIT_BOOLEAN_ACTION_V1':'SIGNED_SCORE_THRESHOLDS_V1',...(condition?{condition:signal.value}:{score:signal.score}),...(c.targetMode==='WEIGHT_DELTA'?{sizingPolicy:'WEIGHT_DELTA_V1',currentWeight,requestedDelta:action==='buy'?c.buyWeightDelta:action==='sell'?-c.sellWeightDelta:0,requestedTargetWeight:target}:{})};}}
  }else if(n.type==='VIBE'){
   const sources=links.map(read);output=propagate(sources);if(!output&&!sources.some(source=>source.kind==='OHLCV'&&!source.omitted&&plain(source.value)&&Array.isArray(source.value.bars)&&source.value.bars.length>0))output=blocked('VIBE_OHLCV_REQUIRED');if(!output){const vote=decisions[id];if(!positionReady)output=blocked('PORTFOLIO_WEIGHT_REQUIRED');else if(!vote)output=pending(id);else{check(exact(vote,['action','stance','targetWeight','confidence','probabilities','basisRefs','rawRequestHash','rawResponseHash'])&&['buy','hold','sell'].includes(vote.action)&&['normal','clutch','defensive'].includes(vote.stance)&&ratio(vote.targetWeight)&&ratio(vote.confidence)&&plain(vote.probabilities)&&Object.keys(vote.probabilities).sort().join(',')==='buy,hold,sell'&&Object.values(vote.probabilities).every(ratio)&&(simulationResponsePolicy===SIMULATION_RESPONSE_POLICY?simulationProbabilityAudit(vote.probabilities).accepted:Math.abs(Object.values(vote.probabilities).reduce((a,b)=>a+b,0)-1)<=.005)&&vote.probabilities[vote.action]>=Math.max(...Object.values(vote.probabilities))-1e-8&&Array.isArray(vote.basisRefs)&&vote.basisRefs.every(r=>typeof r==='string'&&r.length>0)&&HASH.test(vote.rawRequestHash??'')&&HASH.test(vote.rawResponseHash??''),'GRAPH_VIBE_DECISION','JEV 원요청·원응답에 결속된 행동·확률·근거를 확인하세요.');output={ready:true,status:'READY',decision:baseDecision(vote.action,vote.targetWeight,vote.confidence,vote.basisRefs,{stance:vote.stance,authority:'JEV_FINAL',confidence:vote.confidence,probabilities:clone(vote.probabilities),provider:'jev',vibeRefs:[{nodeId:id,rawRequestHash:vote.rawRequestHash,rawResponseHash:vote.rawResponseHash,confidence:vote.confidence,action:vote.action}]})};}details={instructionsHash:hashInputPackage(n.config.instructions),inputNodeIds:links.map(e=>e.from.nodeId),voteHash:hashInputPackage(vote??null)};}
  }else if(n.type==='DECISION_ROUTER'){
   let selected;if(n.config.mode==='SELECT')selected=links.find(e=>e.from.nodeId===n.config.selectedNodeId);else if(n.config.mode==='CHOICE'){const selector=read(links.find(e=>e.to.port==='selector'));output=propagate([selector]);if(!output){if(typeof selector.value!=='string'||!n.config.cases.some(item=>item.id===selector.value))output=blocked('ROUTER_CHOICE_UNKNOWN');else{selected=links.find(e=>e.to.port==='case:'+selector.value);details={selectedCaseId:selector.value};}}}else{const condition=read(links.find(e=>e.to.port==='condition'));output=propagate([condition]);if(!output){if(typeof condition.value!=='boolean')output=blocked('BOOLEAN_VALUE_REQUIRED');else selected=links.find(e=>e.to.port===(condition.value?'true':'false'));}}
   if(selected){const priorBranchChanged=targetBranchChanged,isTargets=n.config.payload==='TARGET_WEIGHTS';if(isTargets)targetBranchChanged=targetBranchChanged||context.portfolio?.routerSelections?.[id]!==selected.from.nodeId;const changed=targetBranchChanged;try{output=clone(read(selected));}finally{targetBranchChanged=priorBranchChanged;}if(output.decision){output.decision.authority='FUSION_FINAL';output.decision.basisRefs=unique([...output.decision.basisRefs,...reads.flatMap(v=>v.output.basisRefs??[]),'strategy-node:'+id]);}if(isTargets&&output.ready){output.basisRefs=unique([...output.basisRefs,...reads.flatMap(v=>v.output.basisRefs??[]),'strategy-node:'+id]);output.portfolioState={...output.portfolioState,routerSelections:{...output.portfolioState?.routerSelections,[id]:selected.from.nodeId}};}details={...details,mode:n.config.mode,selectedNodeId:selected.from.nodeId,...(isTargets?{payload:'TARGET_WEIGHTS',branchChanged:changed}:{}),...(n.config.mode==='CHOICE'?{selectedPort:selected.to.port}:{})};}
  }else if(n.type==='DECISION_MIXER'){
   const active=links.filter(e=>n.config.weights.find(w=>w.nodeId===e.from.nodeId).value>0),values=active.map(read);output=propagate(values);
   if(!output){if(!positionReady)output=blocked('PORTFOLIO_WEIGHT_REQUIRED');else{
    const total=n.config.weights.reduce((sum,w)=>sum+w.value,0),weights=active.map(e=>({nodeId:e.from.nodeId,value:n.config.weights.find(w=>w.nodeId===e.from.nodeId).value/total})),votes={buy:0,hold:0,sell:0};
    values.forEach((v,i)=>votes[v.decision.action]+=weights[i].value);
    const max=Math.max(...Object.values(votes)),winners=Object.keys(votes).filter(k=>Math.abs(votes[k]-max)<=1e-12),blend=n.config.mode==='TARGET_BLEND',contributors=values.map((v,i)=>({nodeId:weights[i].nodeId,decision:v.decision,weight:weights[i].value})),blendedTarget=contributors.reduce((sum,v)=>sum+v.decision.targetWeight*v.weight,0),action=blend?(blendedTarget-currentWeight>1e-12?'buy':blendedTarget-currentWeight< -1e-12?'sell':'hold'):winners.length===1?winners[0]:'hold',support=blend?contributors:contributors.filter(v=>v.decision.action===action),denominator=support.reduce((sum,v)=>sum+v.weight,0),target=blend?(action==='hold'?currentWeight:blendedTarget):action==='hold'?currentWeight:support.reduce((sum,v)=>sum+v.decision.targetWeight*v.weight,0)/denominator;
    const stanceWeights={normal:0,clutch:0,defensive:0};for(const v of support)stanceWeights[v.decision.stance]+=v.weight;
    const strongest=Math.max(...Object.values(stanceWeights)),stances=Object.keys(stanceWeights).filter(k=>Math.abs(stanceWeights[k]-strongest)<=1e-12),stance=action==='hold'||stances.length!==1?'normal':stances[0],intentSupport=support.filter(v=>v.decision.action===action),intentDenominator=intentSupport.reduce((sum,v)=>sum+v.weight,0);
    output={ready:true,status:'READY',decision:baseDecision(action,target,blend?null:max,unique(values.flatMap(v=>v.decision.basisRefs).concat('strategy-node:'+id)),{authority:'FUSION_FINAL',provider:'graph',stance,vibeRefs:values.flatMap(v=>v.decision.vibeRefs),...(intentSupport.some(v=>v.decision.intent||v.decision.intentContributors?.length)?{intentContributors:intentSupport.flatMap(v=>v.decision.intent?[{...clone(v.decision.intent),weight:v.weight/intentDenominator}]:(v.decision.intentContributors??[]).map(intent=>({...clone(intent),weight:intent.weight*v.weight/intentDenominator})))}:{})})};
    details={...(blend?{mode:n.config.mode}:{}),weightVersionId:n.config.weightVersionId,effectiveWeights:weights,actionWeights:votes,tie:winners.length>1,stancePolicy:blend?'ALL_TARGET_SUPPORT_WEIGHTED_STANCE_NORMAL_TIE_V1':'WINNING_ACTION_SUPPORT_WEIGHTED_STANCE_NORMAL_TIE_V1',stanceWeights,targetPolicy:blend?'ALL_DECISION_WEIGHTED_TARGET_V1':'WINNING_ACTION_SUPPORT_WEIGHTED_TARGET_V1',...(blend?{currentWeight,requestedDeltaWeight:target-currentWeight}:{}),targetContributors:!blend&&action==='hold'?[]:support.map(v=>({nodeId:v.nodeId,targetWeight:v.decision.targetWeight,weight:v.weight/denominator}))};
   }}
  }else if(ADAPTIVE_PORTFOLIO_TYPES.includes(n.type)){
   const values=links.map(read);output=propagate(values);if(!output){
    const valueFor=port=>values[links.findIndex(e=>e.to.port===port)].value;
    if(n.type==='MARKET_STATE')output={ready:true,status:'READY',kind:'CONTEXT',value:marketState(valueFor('assets'),n.config),basisRefs:unique(values.flatMap(v=>v.basisRefs))};
    else if(n.type==='PORTFOLIO_EXPERT')output={ready:true,status:'READY',kind:'CONTEXT',value:expertPortfolio(valueFor('state'),n.config),basisRefs:unique(values.flatMap(v=>v.basisRefs))};
    else if(n.type==='PORTFOLIO_ROUTER'){
     if(!portfolioReady)output=blocked('PORTFOLIO_CONTEXT_REQUIRED');
     else{const result=routePortfolio(valueFor('assets'),valueFor('state'),values.filter((v,i)=>links[i].to.port==='experts').map(v=>v.value),n.config,context.portfolio);output={ready:true,status:'READY',kind:'TARGET_WEIGHTS',value:result.value,basisRefs:unique(values.flatMap(v=>v.basisRefs))};details=result.learning;}
    }
   }
  }else if(n.type==='RISK'&&n.config.mode==='PORTFOLIO'){
   const prior=read(links[0]);output=propagate([prior]);if(!output){if(!portfolioReady)output=blocked('PORTFOLIO_CONTEXT_REQUIRED');else{const value=prior.value.rebalanceDue?riskPortfolioTargets(prior.value,n.config,context.portfolio):clone(prior.value);output={ready:true,status:'READY',kind:'APPROVED_TARGET_WEIGHTS',value,...(prior.portfolioState?{portfolioState:clone(prior.portfolioState)}:{}),riskAllowed:true,basisRefs:unique([...prior.basisRefs,'strategy-node:'+id])};details={requestedTargets:prior.value.targets,approvedTargets:value.targets};}}
  }else if(n.type==='ORDER'&&n.config.sizing==='TARGET_WEIGHTS'){
   const prior=read(links[0]);output=propagate([prior]);if(!output){if(!portfolioReady)output=blocked('PORTFOLIO_CONTEXT_REQUIRED');else{const changes=portfolioOrderChanges(prior.value,context.portfolio);output={ready:true,status:'READY',kind:'TARGET_WEIGHTS',value:clone(prior.value),...(prior.portfolioState?{portfolioState:clone(prior.portfolioState)}:{}),riskAllowed:prior.riskAllowed===true,orderAllowed:prior.riskAllowed===true&&prior.value.rebalanceDue&&changes.length>0,execution:n.config.execution==='ACCOUNT'?(context.executionMode==='LIVE'?'LIVE':'PAPER'):'PAPER',orderPolicy:{orderType:n.config.orderType??'LIMIT_FOK',maxSlippageBps:n.config.maxSlippageBps??20,...(n.config.maxQuoteAgeMs?{maxQuoteAgeMs:n.config.maxQuoteAgeMs}:{}),...(n.config.recheckModelValue!==undefined?{recheckModelValue:n.config.recheckModelValue}:{}),...(n.config.takeProfitBps?{takeProfitBps:n.config.takeProfitBps,takeProfitFraction:n.config.takeProfitFraction}:{})},sizing:'TARGET_WEIGHTS',basisRefs:unique([...prior.basisRefs,'strategy-node:'+id])};details={changes,executionOrder:'SELL_BEFORE_BUY'};}}
  }else if(n.type==='RISK'){
   const prior=read(links[0]);output=propagate([prior]);if(!output){const d=clone(prior.decision),c=n.config,weak=d.action==='buy'&&d.targetWeight>currentWeight&&d.vibeRefs.some(v=>v.action==='buy'&&v.confidence<c.minConfidence);if(!positionReady)output=blocked('PORTFOLIO_WEIGHT_REQUIRED');else{if(d.action==='buy')d.targetWeight=Math.max(currentWeight,Math.min(d.targetWeight,c.maxExposure,currentWeight+c.maxOrderWeight));else if(d.action==='sell')d.targetWeight=Math.max(d.targetWeight,currentWeight-c.maxOrderWeight);if(d.targetWeight!==prior.decision.targetWeight){delete d.positionTarget;delete d.positionFraction;}d.risk={maxExposure:c.maxExposure,maxOrderWeight:c.maxOrderWeight,minConfidence:c.minConfidence};output={ready:true,status:'READY',decision:d,riskAllowed:!weak,phase:weak?'BLOCKED_RISK':'APPROVED',reasonCodes:weak?['GRAPH_VIBE_CONFIDENCE']:[]};details={requestedTargetWeight:prior.decision.targetWeight,approvedTargetWeight:d.targetWeight};}}
  }else if(n.type==='ORDER'){
   const prior=read(links[0]);output=propagate([prior]);if(!output){const d=clone(prior.decision);if(!positionReady)output=blocked('PORTFOLIO_WEIGHT_REQUIRED');else{const delta=d.targetWeight-currentWeight;if(prior.riskAllowed&&(d.action==='buy'&&delta<=1e-12||d.action==='sell'&&delta>=-1e-12)){d.action='hold';d.targetWeight=currentWeight;details.noOrderReason='TARGET_ALREADY_REACHED';}output={ready:true,status:'READY',decision:d,execution:n.config.execution==='ACCOUNT'?(context.executionMode==='LIVE'?'LIVE':'PAPER'):'PAPER',sizing:'TARGET_WEIGHT',currentWeight,deltaWeight:d.targetWeight-currentWeight,riskAllowed:prior.riskAllowed,orderAllowed:prior.riskAllowed&&d.action!=='hold',phase:prior.phase,reasonCodes:prior.reasonCodes,...(n.config.execution==='ACCOUNT'?{orderPolicy:{orderType:n.config.orderType??'LIMIT_FOK',maxSlippageBps:n.config.maxSlippageBps??20}}:{})};}}
  }else throw new StrategyGraphError('GRAPH_NODE_TYPE','등록된 노드 실행을 확인하세요.');
  if(parameterDetails)details={...details,...parameterDetails};memo.set(memoKey,output);const traced=clone(output);if((n.type==='INPUT'||output.kind==='ASSET_SET')&&Object.hasOwn(traced,'value')){const value=traced.value;delete traced.value;traced.valueSummary={hash:hashInputPackage(value),kind:output.kind,items:output.kind==='ASSET_SET'?value?.items.length??0:Array.isArray(value)?value.length:null,...(output.kind==='OHLCV'&&value?{bars:value.bars.length,dailyBars:value.dailyBars?.length??0}:{}),...(output.kind==='ASSET_SET'&&value?{candidates:value.items.map(item=>({instrumentId:item.instrumentId,historyBars:item.bars.length,lastCloseAt:item.bars.at(-1)?.closeTime??null,quoteVolume:item.quoteVolume}))}:{})};}trace.push({nodeId:id,type:n.type,inputHash:hashInputPackage(reads),...details,output:traced,outputHash:hashInputPackage(output)});return output;
 }
 const result=graph.triggers.includes(trigger)?visit(graph.outputNodeId):blocked('GRAPH_TRIGGER_DISABLED'),output={...result,reasonCodes:result.reasonCodes??[]},requiredVibeNodeIds=unique(result.requiredVibeNodeIds??[]);
 const evaluation={...(context.researchProjection==='BLIND_PORTFOLIO_HISTORY_V1'?{researchProjection:context.researchProjection}:{}),contractVersion:DECISION_GRAPH_EVALUATION_VERSION,graphHash:compiled.graphHash,asOf,sourceHash,trigger,...(simulationResponsePolicy?{simulationResponsePolicy}:{}),trace,skippedNodeIds:compiled.nodeOrder.filter(id=>!trace.some(n=>n.nodeId===id)),requiredVibeNodeIds,...(graph.nodes.some(n=>n.type==='JEV_QUESTION')?{requiredQuestionNodeIds:unique(result.requiredQuestionNodeIds??[]),requiredJevNodeIds:compiled.nodeOrder.filter(id=>[...requiredVibeNodeIds,...(result.requiredQuestionNodeIds??[])].includes(id))}:{}),outputNodeId:graph.outputNodeId,output};return {...evaluation,outputHash:hashInputPackage(evaluation)};
}

export function strategyGraphDecision(evaluation){return evaluation?.output?.ready===true?clone(evaluation.output.decision??null):null;}
export function strategyGraphVibeInputs(graph,evaluation=null){
 compileDecisionStrategyGraph(graph);const ids=evaluation?new Set((evaluation.trace??[]).filter(n=>n.type==='VIBE').map(n=>n.nodeId)):null;
 return graph.nodes.filter(n=>n.type==='VIBE'&&(!ids||ids.has(n.id))).map(n=>({nodeId:n.id,instructions:n.config.instructions,inputs:graph.edges.filter(e=>e.to.nodeId===n.id).map(e=>graph.nodes.find(v=>v.id===e.from.nodeId)).filter(v=>v.config.enabled!==false).map(v=>({nodeId:v.id,type:v.type,config:clone(v.config)}))}));
}
export function graphRequiresJev(graph,evaluation=null){
 if(isRegimeProgramGraph(graph))return graph.nodes.some(n=>n.type==='REGIME_CLASSIFIER'&&n.config.kind==='JEV');
 if(graph?.schemaVersion!==2)return true;
 compileDecisionStrategyGraph(graph);if(evaluation)return (evaluation.requiredJevNodeIds??evaluation.requiredVibeNodeIds)?.length>0;
 const nodes=new Map(graph.nodes.map(n=>[n.id,n])),seen=new Set();
 function visit(id){if(seen.has(id))return false;seen.add(id);const n=nodes.get(id);if(['VIBE','JEV_QUESTION'].includes(n.type))return true;let edges=graph.edges.filter(e=>e.to.nodeId===id);if(n.type==='DECISION_ROUTER'&&n.config.mode==='SELECT')edges=edges.filter(e=>e.from.nodeId===n.config.selectedNodeId);if(n.type==='DECISION_MIXER')edges=edges.filter(e=>n.config.weights.find(w=>w.nodeId===e.from.nodeId).value>0);return edges.some(e=>visit(e.from.nodeId));}
 return visit(graph.outputNodeId);
}
