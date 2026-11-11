import {hashInputPackage} from './workspace.mjs';
import {pruneGraphCompositions} from './graph-compositions.mjs';
import {MODEL_VERSION,DEFAULT_MODEL_CONFIG,resolveModelConfig} from '../trading/model.mjs';
import {CLUTCH_DEFAULTS,validateClutchParameters} from '../engine/clutch-policy.mjs';
import {compileDecisionStrategyGraph,evaluateDecisionStrategyGraph,decisionGraphHash,decisionGraphNodePorts,connectDecisionStrategyNodes} from './strategy-decision-graph.mjs';
export {DECISION_GRAPH_VERSION,DECISION_GRAPH_NODE_TYPES,DECISION_PORT_TYPE_LABELS,createDecisionStrategyGraph,createPortfolioDecisionStrategyGraph,createDecisionStrategyNode,addDecisionStrategyNode,decisionGraphNodePorts,decisionNodePortContract,inspectDecisionConnection,diagnoseDecisionGraph,graphRequiresJev,strategyGraphDecision,strategyGraphVibeInputs} from './strategy-decision-graph.mjs';

export const STRATEGY_GRAPH_VERSION='mind-strategy-graph-v1';
export const STRATEGY_MODULE_VERSIONS=Object.freeze({BTC_DOC9:MODEL_VERSION,OPPORTUNITY:'clutch-close-feature-provider-v1',MEAN_REVERSION:'mean-reversion-close-feature-provider-v1',SMA_TREND:'sma-trend-close-feature-provider-v1',MOMENTUM:'closed-price-momentum-v1'});
export const STRATEGY_GRAPH_LIMITS=Object.freeze({nodes:24,edges:48,signals:12});
const clone=structuredClone,plain=v=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.getPrototypeOf(v)===Object.prototype;
const exact=(v,keys)=>plain(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const id=v=>typeof v==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9_.:@/-]{0,199}$/.test(v),finite=v=>typeof v==='number'&&Number.isFinite(v),iso=v=>typeof v==='string'&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString()===v;
const clamp=(n,a=-1,b=1)=>Math.max(a,Math.min(b,n)),HASH=/^[a-f0-9]{64}$/;
export class StrategyGraphError extends Error{constructor(code,message,status=400){super(message);this.code=code;this.status=status;}}
const check=(ok,code,message)=>{if(!ok)throw new StrategyGraphError(code,message);};
export function strategyGraphHash(graph){if(graph?.schemaVersion===2)return decisionGraphHash(graph);return hashInputPackage({contractVersion:graph.contractVersion,nodes:graph.nodes.map(n=>({id:n.id,type:n.type,config:n.type==='COMBINER'?{...n.config,weights:[...n.config.weights].sort((a,b)=>a.nodeId.localeCompare(b.nodeId))}:n.config})).sort((a,b)=>a.id.localeCompare(b.id)),edges:graph.edges.map(e=>({from:e.from,to:e.to})).sort((a,b)=>(a.from.nodeId+'>'+a.to.nodeId).localeCompare(b.from.nodeId+'>'+b.to.nodeId)),outputNodeId:graph.outputNodeId});}

export function createStrategyModule(moduleId,{parameters,parametersVersionId='parameters-v1',required=true}={}){
 const defaults={BTC_DOC9:DEFAULT_MODEL_CONFIG,OPPORTUNITY:CLUTCH_DEFAULTS,MEAN_REVERSION:{window:20,entryDeviation:.04,exitDeviation:.01},SMA_TREND:{lookbackBars:120},MOMENTUM:{lookbackBars:42,scale:.1}};
 check(Object.hasOwn(defaults,moduleId),'GRAPH_MODULE','등록된 계산 전략을 선택하세요.');
 const value=clone(parameters??defaults[moduleId]);return assertStrategyModule({moduleId,implementationVersion:STRATEGY_MODULE_VERSIONS[moduleId],role:'FEATURE_PROVIDER',required,parametersVersionId,parametersHash:hashInputPackage(value),parameters:value});
}
export function assertStrategyModule(m){
 check(exact(m,['moduleId','implementationVersion','role','required','parametersVersionId','parametersHash','parameters'])&&Object.hasOwn(STRATEGY_MODULE_VERSIONS,m.moduleId)&&m.implementationVersion===STRATEGY_MODULE_VERSIONS[m.moduleId]&&m.role==='FEATURE_PROVIDER'&&typeof m.required==='boolean'&&id(m.parametersVersionId)&&HASH.test(m.parametersHash)&&plain(m.parameters)&&hashInputPackage(m.parameters)===m.parametersHash,'STRATEGY_MODULE_VERSION','등록된 계산 버전과 실제 매개변수 JSON 해시를 대조하세요.');
 if(m.moduleId==='BTC_DOC9'){const resolved=resolveModelConfig(m.parameters);check(hashInputPackage(resolved)===m.parametersHash&&resolved.selectedCategories.length===1&&resolved.selectedCategories[0]==='price','STRATEGY_PARAMETERS','BTC 기준모델의 전체 가격 매개변수를 고정하세요.');}
 else if(m.moduleId==='OPPORTUNITY')check(Object.keys(m.parameters).length===Object.keys(CLUTCH_DEFAULTS).length&&validateClutchParameters(m.parameters),'STRATEGY_PARAMETERS','기회 집중 전략의 전체 매개변수를 고정하세요.');
 else if(m.moduleId==='SMA_TREND')check(exact(m.parameters,['lookbackBars'])&&Number.isInteger(m.parameters.lookbackBars)&&m.parameters.lookbackBars>=2&&m.parameters.lookbackBars<=500,'STRATEGY_PARAMETERS','이동평균 기간은 2~500봉의 정수로 입력하세요.');
 else if(m.moduleId==='MOMENTUM')check(exact(m.parameters,['lookbackBars','scale'])&&Number.isInteger(m.parameters.lookbackBars)&&m.parameters.lookbackBars>=2&&m.parameters.lookbackBars<=500&&finite(m.parameters.scale)&&m.parameters.scale>0&&m.parameters.scale<=1,'STRATEGY_PARAMETERS','모멘텀 기간 2~500봉과 0 초과~1의 신호 척도를 입력하세요.');
 else {const p=m.parameters;check(exact(p,['window','entryDeviation','exitDeviation'])&&Number.isInteger(p.window)&&p.window>=2&&p.window<=500&&finite(p.entryDeviation)&&p.entryDeviation>0&&p.entryDeviation<=.5&&finite(p.exitDeviation)&&p.exitDeviation>=0&&p.exitDeviation<p.entryDeviation,'STRATEGY_PARAMETERS','평균회귀 기간과 진입·종료 이탈값을 확인하세요.');}
 return m;
}
const weight=(nodeId,value=1)=>({nodeId,value,min:0,max:1});
const edge=(from,to,type='signals')=>({id:from+'-to-'+to,from:{nodeId:from,port:'signal'},to:{nodeId:to,port:type}});
const learning=()=>({method:'bounded-shrinkage-holdout-v1',approval:'POLICY_VERSION_REVIEW',status:'AWAITING_CONTROLLED_OUTCOMES',minSamples:6,priorStrength:8,maxStep:.1,lastProposalId:null});
export function createStrategyGraph({modules=['BTC_DOC9','OPPORTUNITY','MEAN_REVERSION']}={}){
 check(Array.isArray(modules)&&modules.length>0,'GRAPH_MODULE','계산 전략을 하나 이상 선택하세요.');
 const nodes=modules.map((m,i)=>({id:'signal-'+(i+1),type:'SIGNAL',label:typeof m==='string'?m:m.moduleId,position:{x:40,y:40+i*140},config:typeof m==='string'?createStrategyModule(m):clone(assertStrategyModule(m))}));
 const sourceIds=nodes.map(n=>n.id);
 nodes.push({id:'combine',type:'COMBINER',label:'가중치 결합',position:{x:360,y:140},config:{mode:'FIXED',weightVersionId:'weights-v1',weights:sourceIds.map(n=>weight(n)),learning:learning()}});
 nodes.push({id:'jev',type:'JEV',label:'JEV 최종 판단',position:{x:680,y:140},config:{provider:'JEV',actionChoices:['buy','hold','sell']}});
 const graph={schemaVersion:1,contractVersion:STRATEGY_GRAPH_VERSION,nodes,edges:[...sourceIds.map(n=>edge(n,'combine')),edge('combine','jev','evidence')],outputNodeId:'jev'};
 compileStrategyGraph(graph);return graph;
}

export function compileStrategyGraph(graph){
 if(graph?.schemaVersion===2)return compileDecisionStrategyGraph(graph);
 check(exact(graph,['schemaVersion','contractVersion','nodes','edges','outputNodeId'])&&graph.schemaVersion===1&&graph.contractVersion===STRATEGY_GRAPH_VERSION&&Array.isArray(graph.nodes)&&graph.nodes.length>=2&&graph.nodes.length<=STRATEGY_GRAPH_LIMITS.nodes&&Array.isArray(graph.edges)&&graph.edges.length>=1&&graph.edges.length<=STRATEGY_GRAPH_LIMITS.edges&&id(graph.outputNodeId),'GRAPH_SCHEMA','전략 그래프의 노드·연결·출력을 확인하세요.');
 const byId=new Map(),incoming=new Map(),outgoing=new Map();
 for(const node of graph.nodes){
  check(exact(node,['id','type','label','position','config'])&&id(node.id)&&!byId.has(node.id)&&['SIGNAL','COMBINER','ROUTER','JEV'].includes(node.type)&&typeof node.label==='string'&&node.label.trim().length>0&&node.label.length<=100&&exact(node.position,['x','y'])&&finite(node.position.x)&&finite(node.position.y)&&Math.abs(node.position.x)<=10000&&Math.abs(node.position.y)<=10000,'GRAPH_NODE','고유 노드 ID·종류·이름·위치를 확인하세요.');
  if(node.type==='SIGNAL')assertStrategyModule(node.config);
  if(node.type==='COMBINER'){
   const c=node.config,l=c?.learning;
   check(exact(c,['mode','weightVersionId','weights','learning'])&&['FIXED','LEARNED_REVIEW'].includes(c.mode)&&id(c.weightVersionId)&&Array.isArray(c.weights)&&c.weights.length>0&&c.weights.length<=12&&new Set(c.weights.map(w=>w.nodeId)).size===c.weights.length&&c.weights.every(w=>exact(w,['nodeId','value','min','max'])&&id(w.nodeId)&&finite(w.value)&&finite(w.min)&&finite(w.max)&&w.min>=0&&w.max<=1&&w.min<=w.value&&w.value<=w.max)&&c.weights.some(w=>w.value>0),'GRAPH_WEIGHTS','연결별 가중치와 허용 범위를 확인하세요.');
   check(exact(l,['method','approval','status','minSamples','priorStrength','maxStep','lastProposalId'])&&l.method==='bounded-shrinkage-holdout-v1'&&l.approval==='POLICY_VERSION_REVIEW'&&l.status==='AWAITING_CONTROLLED_OUTCOMES'&&Number.isInteger(l.minSamples)&&l.minSamples>=6&&l.minSamples<=1000&&finite(l.priorStrength)&&l.priorStrength>=3&&l.priorStrength<=1000&&finite(l.maxStep)&&l.maxStep>0&&l.maxStep<=.1&&(l.lastProposalId===null||id(l.lastProposalId)),'GRAPH_LEARNING_POLICY','학습 표본·수축 강도·변경 폭과 정책 검토 조건을 확인하세요.');
  }
  if(node.type==='ROUTER')check(exact(node.config,['method'])&&node.config.method==='STRONGEST_ABSOLUTE_SCORE','GRAPH_ROUTER','신호 강도 선택 규칙을 확인하세요.');
  if(node.type==='JEV')check(exact(node.config,['provider','actionChoices'])&&node.config.provider==='JEV'&&JSON.stringify(node.config.actionChoices)==='["buy","hold","sell"]','GRAPH_DECISION','JEV 최종 판단의 선택지를 확인하세요.');
  byId.set(node.id,node);incoming.set(node.id,[]);outgoing.set(node.id,[]);
 }
 check(graph.nodes.filter(n=>n.type==='SIGNAL').length>=1&&graph.nodes.filter(n=>n.type==='SIGNAL').length<=12&&graph.nodes.filter(n=>n.type==='JEV').length===1&&byId.get(graph.outputNodeId)?.type==='JEV','GRAPH_OUTPUT','계산 노드 1~12개와 JEV 출력 하나를 연결하세요.');
 const edgeIds=new Set(),pairs=new Set();
 for(const e of graph.edges){
  check(exact(e,['id','from','to'])&&id(e.id)&&!edgeIds.has(e.id)&&exact(e.from,['nodeId','port'])&&exact(e.to,['nodeId','port'])&&byId.has(e.from.nodeId)&&byId.has(e.to.nodeId)&&e.from.nodeId!==e.to.nodeId,'GRAPH_EDGE','연결의 고유 ID와 양쪽 노드를 확인하세요.');
  const from=byId.get(e.from.nodeId),to=byId.get(e.to.nodeId),pair=from.id+'>'+to.id;
  check(from.type!=='JEV'&&to.type!=='SIGNAL'&&e.from.port==='signal'&&e.to.port===(to.type==='JEV'?'evidence':'signals')&&!pairs.has(pair),'GRAPH_PORT','신호 출력과 수신 입력을 연결하세요.');
  edgeIds.add(e.id);pairs.add(pair);incoming.get(to.id).push(from.id);outgoing.get(from.id).push(to.id);
 }
 for(const n of graph.nodes){const inputs=incoming.get(n.id);check(n.type==='SIGNAL'?inputs.length===0:inputs.length>0,'GRAPH_INPUT','모든 처리 노드에 입력 신호를 연결하세요.');check(n.type==='JEV'?outgoing.get(n.id).length===0:outgoing.get(n.id).length>0,'GRAPH_DISCONNECTED','모든 계산 결과를 JEV 출력까지 연결하세요.');if(n.type==='COMBINER')check(JSON.stringify(inputs.slice().sort())===JSON.stringify(n.config.weights.map(w=>w.nodeId).sort()),'GRAPH_WEIGHT_INPUT','연결된 입력마다 하나의 가중치를 지정하세요.');}
 const remaining=new Map([...incoming].map(([k,v])=>[k,v.length])),queue=[...remaining].filter(([,n])=>n===0).map(([k])=>k).sort(),order=[];
 while(queue.length){const key=queue.shift();order.push(key);for(const to of outgoing.get(key)){remaining.set(to,remaining.get(to)-1);if(remaining.get(to)===0){queue.push(to);queue.sort();}}}
 check(order.length===graph.nodes.length,'GRAPH_CYCLE','순환 연결을 해제하세요.');
 const reaching=new Set([graph.outputNodeId]);for(const key of order.toReversed())if(reaching.has(key))for(const input of incoming.get(key))reaching.add(input);
 check(reaching.size===graph.nodes.length,'GRAPH_DISCONNECTED','모든 계산 노드를 JEV 출력에 연결하세요.');
 return {contractVersion:STRATEGY_GRAPH_VERSION,graphHash:strategyGraphHash(graph),nodeOrder:order,signalNodeIds:order.filter(k=>byId.get(k).type==='SIGNAL'),incoming:Object.fromEntries([...incoming].map(([key,values])=>[key,values.sort()])),outputNodeId:graph.outputNodeId};
}

/** Editors may keep a temporary incomplete canvas; publication calls the compiler. */
export function updateStrategyNode(graph,nodeId,patch){const next=clone(graph),node=next.nodes.find(n=>n.id===nodeId);check(node&&plain(patch)&&Object.keys(patch).every(k=>['label','position','config'].includes(k)),'GRAPH_NODE','편집할 노드와 속성을 확인하세요.');Object.assign(node,clone(patch));return next;}
export function addStrategySignal(graph,{moduleId,parameters,nodeId,position}={}){const next=clone(graph);let i=next.nodes.length+1;while(next.nodes.some(n=>n.id==='signal-'+i))i++;const key=nodeId??'signal-'+i;check(id(key)&&!next.nodes.some(n=>n.id===key),'GRAPH_NODE','고유 계산 노드 ID를 사용하세요.');next.nodes.push({id:key,type:'SIGNAL',label:moduleId,position:position??{x:40,y:40+i*100},config:createStrategyModule(moduleId,{parameters,parametersVersionId:key+'-v1'})});return next;}
export function connectStrategyNodes(graph,{from,to,fromPort,toPort}={}){if(graph?.schemaVersion===2)return connectDecisionStrategyNodes(graph,{from,to,fromPort,toPort});const next=clone(graph),target=next.nodes.find(n=>n.id===to);check(next.nodes.some(n=>n.id===from)&&target,'GRAPH_EDGE','연결할 노드를 선택하세요.');const link=edge(from,to,target.type==='JEV'?'evidence':'signals');check(!next.edges.some(e=>e.id===link.id),'GRAPH_EDGE','두 노드 사이의 연결을 확인하세요.');next.edges.push(link);if(target.type==='COMBINER')target.config.weights.push(weight(from));return next;}
export function removeStrategyNode(graph,nodeId){const next=clone(graph);check(next.outputNodeId!==nodeId,'GRAPH_OUTPUT','최종 출력 노드를 유지하세요.');next.nodes=next.nodes.filter(n=>n.id!==nodeId);next.edges=next.edges.filter(e=>e.from.nodeId!==nodeId&&e.to.nodeId!==nodeId);for(const n of next.nodes)if(['COMBINER','DECISION_MIXER'].includes(n.type)){n.config.weights=n.config.weights.filter(w=>w.nodeId!==nodeId);if(n.config.inactiveWeights){n.config.inactiveWeights=n.config.inactiveWeights.filter(w=>w.nodeId!==nodeId);if(!n.config.inactiveWeights.length)delete n.config.inactiveWeights;}}return graph.schemaVersion===2?pruneGraphCompositions(next):next;}
export function disconnectStrategyNodes(graph,edgeId){const next=clone(graph),link=next.edges.find(e=>e.id===edgeId);check(link,'GRAPH_EDGE','연결을 선택하세요.');next.edges=next.edges.filter(e=>e.id!==edgeId);const target=next.nodes.find(n=>n.id===link.to.nodeId);if(['COMBINER','DECISION_MIXER'].includes(target.type)){target.config.weights=target.config.weights.filter(w=>w.nodeId!==link.from.nodeId);if(target.config.inactiveWeights){target.config.inactiveWeights=target.config.inactiveWeights.filter(w=>w.nodeId!==link.from.nodeId);if(!target.config.inactiveWeights.length)delete target.config.inactiveWeights;}}return next;}

export function evaluateStrategyGraph(graph,features,options={}){
 if(graph?.schemaVersion===2)return evaluateDecisionStrategyGraph(graph,features,options);
 const {asOf,sourceHash}=options;
 const compiled=compileStrategyGraph(graph);check(iso(asOf)&&HASH.test(sourceHash??'')&&Array.isArray(features),'GRAPH_INPUT','실제 계산 시점과 입력 원본 해시를 확인하세요.');
 const result=new Map(),trace=[];
 for(const key of compiled.nodeOrder){const node=graph.nodes.find(n=>n.id===key),inputs=compiled.incoming[key].map(k=>({nodeId:k,...result.get(k)}));let output,details={};
  if(node.type==='SIGNAL'){
   const f=features.find(v=>v.nodeId===key);check(f&&f.parametersHash===node.config.parametersHash&&f.moduleId===node.config.moduleId,'GRAPH_FEATURE','계산 노드와 매개변수 버전이 같은 실제 특징을 연결하세요.');
   const raw=f.moduleId==='BTC_DOC9'?f.mechanicalScore?.S:['SMA_TREND','MOMENTUM'].includes(f.moduleId)?f.mechanicalScore:f.moduleId==='MEAN_REVERSION'?(f.signal.direction==='buy'?1:f.signal.direction==='sell'?-1:0)*f.mechanicalScore:f.signal.entryCandidate?f.mechanicalScore:f.trailing?.exitCandidate?-f.mechanicalScore:0;
   check(!f.ready||finite(raw),'GRAPH_FEATURE','유한한 실제 계산값을 확인하세요.');const stableFeature=clone(f);if(stableFeature.trailing)delete stableFeature.trailing.candidateDetectedAt;output={ready:f.ready,score:f.ready?clamp(raw):null,sources:[key]};details={moduleId:f.moduleId,parametersHash:f.parametersHash,featureHash:hashInputPackage(stableFeature)};
  }else if(node.type==='ROUTER'){
   const selected=inputs.filter(i=>i.ready).sort((a,b)=>Math.abs(b.score)-Math.abs(a.score)||a.nodeId.localeCompare(b.nodeId))[0];output=selected?{ready:true,score:selected.score,sources:clone(selected.sources)}:{ready:false,score:null,sources:[]};details={method:node.config.method,selectedNodeId:selected?.nodeId??null};
  }else if(node.type==='COMBINER'){
   const used=inputs.filter(i=>i.ready&&node.config.weights.find(w=>w.nodeId===i.nodeId).value>0),total=used.reduce((s,i)=>s+node.config.weights.find(w=>w.nodeId===i.nodeId).value,0);
   output={ready:total>0,score:total>0?used.reduce((s,i)=>s+i.score*node.config.weights.find(w=>w.nodeId===i.nodeId).value,0)/total:null,sources:[...new Set(used.flatMap(i=>i.sources))]};details={mode:node.config.mode,weightVersionId:node.config.weightVersionId,effectiveWeights:used.map(i=>({nodeId:i.nodeId,value:node.config.weights.find(w=>w.nodeId===i.nodeId).value/total})),learningStatus:node.config.mode==='LEARNED_REVIEW'?node.config.learning.status:null};
  }else {output={ready:inputs.some(i=>i.ready),evidence:inputs.map(i=>({nodeId:i.nodeId,ready:i.ready,score:i.score,sources:i.sources})),authority:'JEV_FINAL_ACTION_WITH_CODE_RISK_LIMITS'};}
  result.set(key,output);trace.push({nodeId:key,type:node.type,inputHash:hashInputPackage(node.type==='SIGNAL'?{sourceHash,asOf,parametersHash:node.config.parametersHash}:inputs),...details,output:clone(output),outputHash:hashInputPackage(output)});
 }
 const evaluation={contractVersion:'mind-strategy-graph-evaluation-v1',graphHash:compiled.graphHash,asOf,sourceHash,trace,outputNodeId:graph.outputNodeId,output:result.get(graph.outputNodeId)};return {...evaluation,outputHash:hashInputPackage(evaluation)};
}

/** A research proposal uses controlled, non-overlapping, matured outcomes. A
 * held-out final third is scored only after fitting the earlier observations. */
export function proposeStrategyGraphWeights(graph,nodeId,outcomes,{now}={}){
 const compiled=compileStrategyGraph(graph),node=graph.nodes.find(n=>n.id===nodeId);check(node?.type==='COMBINER'&&node.config.mode==='LEARNED_REVIEW'&&iso(now)&&Array.isArray(outcomes)&&outcomes.length<=2000,'GRAPH_LEARNING_INPUT','학습 결합 노드·평가 시각·관측 결과를 확인하세요.');
 const p=node.config.learning,keys=node.config.weights.map(w=>w.nodeId).sort(),seen=new Set(),eligible=[],excluded=[];
 for(const sample of [...outcomes].sort((a,b)=>String(a?.start).localeCompare(String(b?.start)))){
  let reason=null;const valid=plain(sample)&&id(sample.id)&&HASH.test(sample.sourceHash??'')&&sample.graphHash===compiled.graphHash&&iso(sample.start)&&iso(sample.end)&&iso(sample.availableAt)&&sample.start<sample.end&&sample.end<=sample.availableAt&&sample.controlled===true&&plain(sample.netExcessReturns)&&JSON.stringify(Object.keys(sample.netExcessReturns).sort())===JSON.stringify(keys)&&Object.values(sample.netExcessReturns).every(v=>finite(v)&&Math.abs(v)<=10);
  if(!valid)reason='CONTROLLED_SOURCE_REQUIRED';else if(sample.availableAt>now)reason='OUTCOME_NOT_MATURED';else if(seen.has(sample.sourceHash)||eligible.some(v=>sample.start<v.end&&sample.end>v.start))reason='DUPLICATE_OR_OVERLAPPING';else if(eligible.length&&Date.parse(sample.end)-Date.parse(sample.start)!==Date.parse(eligible[0].end)-Date.parse(eligible[0].start))reason='HORIZON_MISMATCH';
  if(reason)excluded.push({id:sample?.id??null,reason});else{seen.add(sample.sourceHash);eligible.push(clone(sample));}
 }
 const split=Math.floor(eligible.length*2/3),train=eligible.slice(0,split),holdout=eligible.slice(split),enough=eligible.length>=p.minSamples&&train.length>=3&&holdout.length>=2;
 const weights=node.config.weights.map(w=>{const score=train.length?train.reduce((n,s)=>n+clamp(s.netExcessReturns[w.nodeId],-.5,.5),0)/train.length:0;return {...w,value:enough?clamp(w.value+p.maxStep*Math.tanh(score/.03)*train.length/(p.priorStrength+train.length),w.min,w.max):w.value};});
 const payoff=(list,w)=>list.length&&w.some(item=>item.value>0)?list.reduce((v,s)=>v+w.reduce((n,item)=>n+s.netExcessReturns[item.nodeId]*item.value,0)/w.reduce((n,item)=>n+item.value,0),0)/list.length:null;
 const baseline=payoff(holdout,node.config.weights),candidate=payoff(holdout,weights),status=!enough?'INSUFFICIENT_EVIDENCE':candidate===null||candidate+1e-12<baseline?'HOLDOUT_REJECTED':'REVIEW_REQUIRED';
 return {id:'graph-weight-'+hashInputPackage({graphHash:compiled.graphHash,nodeId,now,outcomes}).slice(0,32),contractVersion:'graph-weight-proposal-v1',graphHash:compiled.graphHash,nodeId,weightVersionId:node.config.weightVersionId,evaluatedAt:now,status,applied:false,weights:status==='REVIEW_REQUIRED'?weights:clone(node.config.weights),trainingIds:train.map(s=>s.id),holdoutIds:holdout.map(s=>s.id),sourceHashes:eligible.map(s=>({id:s.id,hash:s.sourceHash})),excluded,holdout:{baseline,candidate},policy:clone(p)};
}
