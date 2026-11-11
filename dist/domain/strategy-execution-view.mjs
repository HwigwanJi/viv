import {strategyGraphHash} from './strategy-graph.mjs';
// Presentation derives only from engine observations; playback never executes a graph.
export function strategyExecutionView(graph,execution,{cursor=null}={}){
 if(execution?.observation){
  const observation=execution.observation,known=new Set(graph.nodes.map(n=>n.id)),states=new Set(['idle','done','waiting','queued','blocked','error','unknown','skipped','omitted']),rows=observation.nodes??[];
  if(observation.contractVersion!=='mind-execution-observation-v1'||observation.graphHash!==strategyGraphHash(graph)||!Array.isArray(rows)||new Set(rows.map(n=>n.id)).size!==rows.length||rows.some(n=>!known.has(n.id)||!states.has(n.state)))return {nodes:Object.fromEntries(graph.nodes.map(n=>[n.id,{state:'idle',row:null}])),edges:[],traceLength:0,error:'실행 위치와 그래프 버전을 다시 확인하세요.'};
  const byId=new Map(rows.map(n=>[n.id,n]));
  return {nodes:Object.fromEntries(graph.nodes.map(n=>[n.id,{state:byId.get(n.id)?.state??'idle',row:null}])),edges:graph.edges.filter(e=>(observation.edgeIds??[]).includes(e.id)).map(e=>e.id),traceLength:rows.length};
 }
 const mismatch=Boolean(execution?.evaluation&&execution.evaluation.graphHash!==strategyGraphHash(graph));
 if(mismatch)return {nodes:Object.fromEntries(graph.nodes.map(n=>[n.id,{state:'idle',row:null}])),edges:[],traceLength:0,error:'실행 기록과 그래프 버전이 다릅니다.'};
 const trace=execution?.evaluation?.trace??[],shown=cursor===null?trace:trace.slice(0,cursor+1),byId=new Map(shown.map(row=>[row.nodeId,row])),skipped=new Set(execution?.evaluation?.skippedNodeIds??[]);
 const nodes=Object.fromEntries(graph.nodes.map(node=>{const row=byId.get(node.id);let state='idle';if(row){state=row.output?.disabled?'skipped':row.output?.omitted?'omitted':row.output?.status==='BLOCKED'?'blocked':row.output?.status==='PENDING_JEV'?'waiting':row.output?.ready?'done':['VIBE','JEV_QUESTION'].includes(row.type)?'waiting':'queued';if(cursor!==null&&shown.at(-1)===row&&state==='done')state='replay';if(execution.phase==='EXTERNAL_OUTCOME_UNKNOWN'&&['VIBE','JEV_QUESTION'].includes(row.type)&&!row.output?.ready)state='unknown';if(execution.phase==='FAILED'&&['VIBE','JEV_QUESTION'].includes(row.type)&&!row.output?.ready)state='error';}else if(skipped.has(node.id))state='skipped';return [node.id,{state,row:row??null}];}));
 const edges=graph.edges.filter(edge=>{const target=byId.get(edge.to.nodeId),source=byId.get(edge.from.nodeId);if(!target||!source||source.output?.omitted||!source.output?.ready)return false;if(target.selectedNodeId&&target.selectedNodeId!==edge.from.nodeId&&!['condition','selector'].includes(edge.to.port))return false;const node=graph.nodes.find(n=>n.id===edge.to.nodeId);if(node?.type==='DECISION_MIXER'&&!node.config.weights.some(w=>w.nodeId===edge.from.nodeId&&w.value>0))return false;return true;}).map(edge=>edge.id);
 return {nodes,edges,traceLength:trace.length};
}
export function strategyNodeExcluded(graph,id){const outputs=graph.edges.filter(e=>e.from.nodeId===id);return outputs.length>0&&outputs.every(e=>graph.nodes.find(n=>n.id===e.to.nodeId)?.type==='DECISION_MIXER'&&graph.nodes.find(n=>n.id===e.to.nodeId).config.weights.find(w=>w.nodeId===id)?.value===0);}
export function toggleStrategyDecision(graph,id){
 const next=structuredClone(graph),node=next.nodes.find(n=>n.id===id),outputs=next.edges.filter(e=>e.from.nodeId===id);
 if(!node||!['QUANT','VIBE'].includes(node.type)||!outputs.length||outputs.some(e=>next.nodes.find(n=>n.id===e.to.nodeId)?.type!=='DECISION_MIXER'))throw new Error('결정 믹서에 연결한 퀀트·바이브를 선택하세요.');
 const enable=strategyNodeExcluded(next,id);for(const edge of outputs){const mixer=next.nodes.find(n=>n.id===edge.to.nodeId),weight=mixer.config.weights.find(w=>w.nodeId===id),previous=mixer.config.inactiveWeights?.find(w=>w.nodeId===id);if(!enable&&!mixer.config.weights.some(w=>w.nodeId!==id&&w.value>0))throw new Error('믹서에 활성 결정을 하나 이상 남겨 주세요.');if(enable){if(!previous)throw new Error('저장된 복원 비중이 없습니다. 결정 믹서에서 이 부품의 가중치를 입력하세요.');weight.value=previous.value;mixer.config.inactiveWeights=mixer.config.inactiveWeights.filter(w=>w.nodeId!==id);if(!mixer.config.inactiveWeights.length)delete mixer.config.inactiveWeights;}else if(weight.value>0){mixer.config.inactiveWeights=[...(mixer.config.inactiveWeights??[]).filter(w=>w.nodeId!==id),{nodeId:id,value:weight.value}];weight.value=0;}}
 return next;
}

export function strategyRecommendedChecks(graph){
 const reachable=new Set();const visit=id=>{if(reachable.has(id))return;reachable.add(id);for(const edge of graph.edges.filter(e=>e.to.nodeId===id))visit(edge.from.nodeId);};visit(graph.outputNodeId);
 return graph.nodes.filter(n=>reachable.has(n.id)&&(n.type==='INPUT'&&['KNOWLEDGE','MEMORY','CONTEXT'].includes(n.config.kind)||['VIBE','DECISION_MIXER','DECISION_ROUTER'].includes(n.type))).map(n=>({nodeId:n.id,label:n.label,kind:n.type==='INPUT'?'INPUT':n.type==='VIBE'?'DECISION':n.type==='DECISION_MIXER'?'WEIGHTS':'ROUTING'}));
}
