import {createDecisionStrategyNode,compileStrategyGraph} from './strategy-graph.mjs';
import {HOURLY_VALUE_INPUT} from './hourly-value-node.mjs';

export const isHourlyValueGraph=graph=>graph?.nodes?.some(n=>n.type==='MODEL'&&n.config.family==='HOURLY_VALUE_FOREST')===true;
export function assertHourlyValueGraph(graph){
 compileStrategyGraph(graph);
 const inputs=graph.nodes.filter(n=>n.type==='INPUT'),models=graph.nodes.filter(n=>n.type==='MODEL');
 if(models.length!==1||models[0].config.family!=='HOURLY_VALUE_FOREST'||!models[0].config.model||inputs.filter(n=>n.config.kind==='CONTEXT'&&n.config.instrumentId===HOURLY_VALUE_INPUT).length!==1||inputs.some(n=>!(n.config.kind==='CONTEXT'&&n.config.instrumentId===HOURLY_VALUE_INPUT)&&!(n.config.kind==='POSITION'&&n.config.instrumentId==='execution:current'))||!graph.triggers.includes('closed_bar'))throw Object.assign(Error('시간봉 행동가치 모델과 자기 계좌 입력을 확인하세요.'),{code:'HOURLY_VALUE_GRAPH_SCOPE'});
 return graph;
}

export function createHourlyValueStrategyGraph({model,policy,execution='PAPER'}={}){
 const nodes=[
  ['state','INPUT',{kind:'CONTEXT',instrumentId:HOURLY_VALUE_INPUT,required:true}],
  ['model','MODEL',{family:'HOURLY_VALUE_FOREST',model,policy}],
  ['risk','RISK',{maxExposure:1,maxOrderWeight:1,minConfidence:0}],
  ['order','ORDER',{execution,sizing:'TARGET_WEIGHT'}]
 ].map(([id,type,config],index)=>createDecisionStrategyNode(type,{id,config,position:{x:index*280,y:0}}));
 const graph={schemaVersion:2,contractVersion:'mind-strategy-decision-graph-v2',triggers:['closed_bar','market_event'],nodes,edges:[['state','model','data','state'],['model','risk','decision','decision'],['risk','order','approved','approved']].map(([from,to,fromPort,toPort])=>({id:from+'-'+to,from:{nodeId:from,port:fromPort},to:{nodeId:to,port:toPort}})),outputNodeId:'order'};
 compileStrategyGraph(graph);return graph;
}
