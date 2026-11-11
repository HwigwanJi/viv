import {sessionAiContext} from './session-ai.mjs';
import {createDecisionStrategyNode,compileDecisionStrategyGraph,evaluateDecisionStrategyGraph} from './strategy-decision-graph.mjs';
import {hashInputPackage} from './workspace.mjs';
import {SESSION_RULE_DEFAULTS,assertSessionRuleConfig,executeSessionPlan} from './session-rule.mjs';

export function createSessionStrategyGraph(config=SESSION_RULE_DEFAULTS){
 assertSessionRuleConfig(config);const instrumentId=config.symbol==='TQQQ'?'equity:NASDAQ:TQQQ':'equity:NYSE_ARCA:SOXL';
 const nodes=[createDecisionStrategyNode('INPUT',{id:'session-state',position:{x:0,y:0},config:{kind:'CONTEXT',instrumentId,required:true}}),createDecisionStrategyNode('SESSION_RULE',{id:'session-rule',position:{x:320,y:0},config}),createDecisionStrategyNode('RISK',{id:'session-risk',position:{x:640,y:0},config:{mode:'SESSION',maxExposure:1,maxOrderWeight:1}}),createDecisionStrategyNode('ORDER',{id:'session-order',position:{x:960,y:0},config:{execution:'PAPER',sizing:'SESSION_ORDERS'}})];
 nodes[0].label='일별 운용 상태';nodes[3].label='세션 모의 주문';
 const edges=[['session-state','session-rule','data','state'],['session-rule','session-risk','plan','decision'],['session-risk','session-order','approved','approved']].map(([from,to,a,b],i)=>({id:'session-edge-'+i,from:{nodeId:from,port:a},to:{nodeId:to,port:b}}));
 const graph={schemaVersion:2,contractVersion:'mind-strategy-decision-graph-v2',nodes,edges,outputNodeId:'session-order',triggers:['manual','closed_bar']};compileDecisionStrategyGraph(graph);return graph;
}
export function createSessionSwitchGraph({lookback=200,slopeDays=20,band=.01,trendWeight=.65,splitCap=.2,rebalancingBand=.05,splits=40}={}){
 const graph=createSessionStrategyGraph({...SESSION_RULE_DEFAULTS,splits});
 const make=(type,id,config,x,y,label)=>({...createDecisionStrategyNode(type,{id,config,position:{x,y}}),label});
 graph.nodes.find(n=>n.id==='session-rule').config.maxExposure=splitCap;
 graph.nodes.find(n=>n.id==='session-rule').position={x:640,y:230};
 graph.nodes.push(make('SESSION_SIGNAL','session-signal',{lookback,slopeDays,band},320,-230,'QQQ 확정 추세'),make('CONDITION','session-condition',{operator:'gt',value:0},640,-230,'상승 조건'),make('SESSION_TREND','session-trend',{symbol:'TQQQ',targetWeight:trendWeight,rebalancingBand},640,0,'추세 보유'),make('DECISION_ROUTER','session-router',{mode:'CONDITION',payload:'ORDER_PLAN'},960,0,'국면별 주문 선택'));
 graph.nodes.find(n=>n.id==='session-risk').position={x:1280,y:0};graph.nodes.find(n=>n.id==='session-order').position={x:1600,y:0};
 graph.edges=[['session-state','session-signal','data','state'],['session-signal','session-condition','value','value'],['session-state','session-trend','data','state'],['session-state','session-rule','data','state'],['session-condition','session-router','condition','condition'],['session-trend','session-router','plan','true'],['session-rule','session-router','plan','false'],['session-router','session-risk','plan','decision'],['session-risk','session-order','approved','approved']].map(([a,b,c,d],i)=>({id:'switch-edge-'+i,from:{nodeId:a,port:c},to:{nodeId:b,port:d}}));
 compileDecisionStrategyGraph(graph);return graph;
}
export function prepareSessionEvaluation({graph,account,date,decisionAt,feeBps=10,sourceHash,signalHistory,marketHistory,slippageBps=5,decisionMemory=[],decisions={}}){
 compileDecisionStrategyGraph(graph);const sources=graph.nodes.filter(n=>n.type==='INPUT'),source=sources.find(n=>n.id==='session-state')??sources[0],rules=graph.nodes.filter(n=>n.type==='SESSION_RULE'),instrumentId=account.symbol==='TQQQ'?'equity:NASDAQ:TQQQ':'equity:NYSE_ARCA:SOXL';
 if(rules.length!==1||sources.some(n=>n.config.kind!=='CONTEXT'||n.config.instrumentId!==instrumentId)||!source)throw Object.assign(new Error('세션 계좌와 입력 종목의 연결을 확인하세요.'),{code:'SESSION_GRAPH_SCOPE'});
 const value={account,date,decisionAt,feeBps,...(signalHistory?{signalHistory}:{})},input=value=>({ready:true,asOf:decisionAt,availableAt:decisionAt,value,sourceRefs:[{id:'session-account',contentHash:hashInputPackage(value),sourceRef:'simulation-session-account'}]});
 const executionInputs=Object.fromEntries(sources.map(n=>[n.id,input(n.id==='session-ai-context'?sessionAiContext({graph,account,date,decisionAt,feeBps,slippageBps,signalHistory,marketHistory,decisionMemory}):value)])),executionContext={executionMode:'PAPER',sessionDate:date,sessionAccount:account};
 const evaluation={asOf:decisionAt,source:{datasetSha256:sourceHash},modules:[],executionInputs,executionContext,decisionInputs:structuredClone(decisions),trigger:'closed_bar'};
 evaluation.graphEvaluation=evaluateDecisionStrategyGraph(graph,[],{asOf:decisionAt,sourceHash,inputs:executionInputs,decisions,context:executionContext,trigger:'closed_bar'});return evaluation;
}
export function evaluateSessionStrategy(options){return prepareSessionEvaluation(options).graphEvaluation;}
export function createSessionStructureGraph({trailingDrawdown=.06,confirmationDays=2,trendWeight=.65,reboundWeight=.35,splitCap=.2,rebalancingBand=.05,splits=40,longTrendGuard,volatilityTarget}={}){
 const graph=createSessionSwitchGraph({trendWeight,splitCap,rebalancingBand,splits}),signal=graph.nodes.find(n=>n.type==='SESSION_SIGNAL');
 signal.config={mode:'STRUCTURE',trailingDrawdown,confirmationDays,...(longTrendGuard!==undefined?{longTrendGuard}:{})};signal.label='반등과 추세 전환 판단';
 graph.nodes.find(n=>n.id==='session-condition').config.value=1;
 graph.nodes.find(n=>n.id==='session-condition').label='추세 확인';
 graph.nodes.push(createDecisionStrategyNode('CONDITION',{id:'rebound-condition',config:{operator:'gt',value:0},position:{x:640,y:400}}),createDecisionStrategyNode('SESSION_TREND',{id:'rebound-target',config:{symbol:'TQQQ',targetWeight:reboundWeight,rebalancingBand,regime:'REBOUND'},position:{x:640,y:170}}),createDecisionStrategyNode('DECISION_ROUTER',{id:'rebound-router',config:{mode:'CONDITION',payload:'ORDER_PLAN'},position:{x:960,y:250}}));
 if(volatilityTarget!==undefined){graph.nodes.find(n=>n.id==='session-trend').config.volatilityTarget=volatilityTarget;if(reboundWeight>0)graph.nodes.find(n=>n.id==='rebound-target').config.volatilityTarget=trendWeight>0?volatilityTarget*reboundWeight/trendWeight:volatilityTarget;}
 for(const[id,label]of [['rebound-condition','반등 조건'],['rebound-target','반등 보유'],['rebound-router','반등 주문 선택']])graph.nodes.find(n=>n.id===id).label=label;
 graph.nodes.find(n=>n.id==='session-rule').position={x:640,y:650};
 graph.edges=graph.edges.filter(e=>!(e.from.nodeId==='session-rule'&&e.to.nodeId==='session-router'));
 const connections=[['session-signal','rebound-condition','value','value'],['session-state','rebound-target','data','state'],['rebound-condition','rebound-router','condition','condition'],['rebound-target','rebound-router','plan','true'],['session-rule','rebound-router','plan','false'],['rebound-router','session-router','plan','false']];
 graph.edges.push(...connections.map(([a,b,c,d],i)=>({id:'structure-edge-'+i,from:{nodeId:a,port:c},to:{nodeId:b,port:d}})));
 compileDecisionStrategyGraph(graph);return graph;
}
export function runSessionStrategyDay({graph,account,date,decisionAt,feeBps=10,slippageBps=5,sourceHash,signalHistory,events,limitFillPolicy='OBSERVED'}){
 const evaluation=evaluateSessionStrategy({graph,account,date,decisionAt,feeBps,sourceHash,signalHistory});
 if(!evaluation.output.ready||!evaluation.output.orderAllowed)throw Object.assign(new Error('세션 주문 계획 검사 결과 확인'),{code:'SESSION_GRAPH_BLOCKED',evaluation});
 return {evaluation,...executeSessionPlan(account,evaluation.output.value,events,{slippageBps,limitFillPolicy})};
}
