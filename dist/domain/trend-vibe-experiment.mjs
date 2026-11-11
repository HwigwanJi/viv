import {createDecisionStrategyGraph,createDecisionStrategyNode,connectStrategyNodes,compileStrategyGraph,createStrategyModule} from './strategy-graph.mjs';

export const TREND_VIBE_INSTRUCTIONS='상승장에서는 우가우가 하면서 과감하게 매수 매도 판단을 내린다. 공포에 사고 환희에 판다.';

// A reusable starting composition. Every parameter remains editable in the canonical editor.
export function createTrendVibeExperiment({lookbackBars=120,vibeWeight=.7}={}){
 const baseline=createDecisionStrategyGraph({preset:'QUANT',moduleId:'SMA_TREND'});
 const signal=baseline.nodes.find(n=>n.id==='signal');
 signal.config=createStrategyModule('SMA_TREND',{parameters:{lookbackBars}});
 signal.label='이동평균 추세';
 baseline.nodes.find(n=>n.id==='quant').config.buyTargetWeight=.6;
 const variant=structuredClone(baseline);
 variant.nodes.push(createDecisionStrategyNode('CONDITION',{id:'bull-condition',config:{operator:'gt',value:0},position:{x:480,y:340}}));
 variant.nodes.find(n=>n.id==='bull-condition').label='종가 > 이동평균';
 variant.nodes.push(createDecisionStrategyNode('VIBE',{id:'vibe',config:{provider:'JEV',instructions:TREND_VIBE_INSTRUCTIONS},position:{x:480,y:540}}));
 variant.nodes.push(createDecisionStrategyNode('DECISION_MIXER',{id:'bull-mixer',config:{mode:'FIXED',weightVersionId:'bull-vote-v1',weights:[{nodeId:'quant',value:1-vibeWeight},{nodeId:'vibe',value:vibeWeight}]},position:{x:720,y:300}}));
 variant.nodes.find(n=>n.id==='bull-mixer').label='상승 조건 · 판단 투표';
 variant.nodes.push(createDecisionStrategyNode('DECISION_ROUTER',{id:'regime-router',config:{mode:'CONDITION'},position:{x:960,y:140}}));
 variant.nodes.find(n=>n.id==='regime-router').label='추세별 결정';
 variant.nodes.find(n=>n.id==='risk').position={x:1200,y:140};
 variant.nodes.find(n=>n.id==='order').position={x:1440,y:140};
 variant.edges=variant.edges.filter(e=>e.to.nodeId!=='risk');
 let graph=variant;
 for(const edge of [{from:'signal',to:'bull-condition'},{from:'market',to:'vibe'},{from:'signal',to:'vibe'},
  {from:'quant',to:'bull-mixer'},{from:'vibe',to:'bull-mixer'},
  {from:'bull-condition',to:'regime-router',toPort:'condition'},
  {from:'bull-mixer',to:'regime-router',toPort:'true'},{from:'quant',to:'regime-router',toPort:'false'},
  {from:'regime-router',to:'risk'}])graph=connectStrategyNodes(graph,edge);
 compileStrategyGraph(baseline);compileStrategyGraph(graph);
 return {baseline,variant:graph};
}
