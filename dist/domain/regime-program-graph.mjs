import {hashInputPackage as hash} from './workspace.mjs';
import {REGIME_CASES,regimeChoices,createRegimeProgram} from './regime-program.mjs';

export const isRegimeProgramGraph=g=>g?.executionScope?.kind==='STRATEGY_PROGRAM';
export const REGIME_NODE_TYPES=['REGIME_INPUT','CHOICE_LIST','REGIME_CLASSIFIER','STRATEGY_REFERENCE','REGIME_ROUTER'];
const check=(v,c,m)=>{if(!v)throw Object.assign(new Error(m),{code:c,status:400});};
const copy=structuredClone,id=v=>typeof v==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,199}$/.test(v);
const port=(id,dataType,accepts=[dataType],minConnections=1,maxConnections=1)=>({id,dataType,accepts,minConnections,maxConnections});
const out=(id,type)=>port(id,type,[],1,64);
export function regimeNodePorts(node){if(!node)return null;const c=node.config??{};
 if(node.type==='REGIME_INPUT')return {inputs:[],outputs:[out('value',c.valueType??'NUMBER')]};
 if(node.type==='CHOICE_LIST')return {inputs:[],outputs:[out('choices','CHOICE_LIST')]};
 if(node.type==='STRATEGY_REFERENCE')return {inputs:[],outputs:[out('strategy','STRATEGY_REF')]};
 if(node.type==='REGIME_ROUTER')return {inputs:[port('selector','CHOICE'),...(c.choiceIds?[port('choices','CHOICE_LIST')]:[]),...(c.choiceIds??REGIME_CASES).map(k=>port('case:'+k,'STRATEGY_REF'))],outputs:[out('strategy','STRATEGY_REF')]};
 if(node.type==='REGIME_CLASSIFIER')return {inputs:c.kind==='AXES'?[port('x','NUMBER'),port('y','NUMBER')]:[...(c.choiceSource?[port('choices','CHOICE_LIST')]:[]),...list(c.inputs).map(k=>port('input:'+k,'CONTEXT',['CONTEXT','NUMBER','TEXT','OHLCV']))],outputs:[out('choice','CHOICE')]};
 return null;
}
const list=v=>Array.isArray(v)?v:[];
export function createRegimeProgramGraph(program,{models=[]}={}){
 const nodes=[],edges=[];const add=(nodeId,type,config,label,x,y)=>nodes.push({id:nodeId,type,config:copy(config),label,position:{x,y}}),wire=(from,to,fromPort,toPort)=>edges.push({id:'e'+edges.length,from:{nodeId:from,port:fromPort},to:{nodeId:to,port:toPort}});
 const c=copy(program.classifier),choices=regimeChoices(program),bindings=c.inputBindings??{};delete c.inputBindings;if(c.kind!=='AXES'){c.choiceSource=c.choices?'VARIABLE':'LEGACY';delete c.criteria;delete c.choices;}
 add('classifier','REGIME_CLASSIFIER',c,c.kind==='JEV'?'JEV 판단':c.kind==='FIXED'?'저장한 묶음 실행':'두 축 판단 · 기존 템플릿',400,150);
 const inputs=c.kind==='AXES'?[[c.x.input,'NUMBER','x'],[c.y.input,'NUMBER','y']]:c.inputs.map(k=>[k,'CONTEXT','input:'+k]);
 inputs.forEach(([key,valueType,to],i)=>{add('input'+i,'REGIME_INPUT',{inputId:key,valueType,...(bindings[key]?{source:bindings[key]}:{})},key,20,80+i*200);wire('input'+i,'classifier','value',to);});
 add('router','REGIME_ROUTER',{handover:program.handover,minimumDwellMs:program.minimumDwellMs,...(c.kind!=='AXES'?{choiceIds:choices.map(v=>v.id)}:{})},'선택지 → 전략',1100,250);wire('classifier','router','choice','selector');
 if(c.kind!=='AXES'){add('choices','CHOICE_LIST',{items:choices},'판단 선택지',20,inputs.length*200+100);wire('choices','classifier','choices','choices');wire('choices','router','choices','choices');}
 const seen=new Map();choices.forEach(({id:key},index)=>{const pin=program.routes[key],digest=hash(pin);let nodeId=seen.get(digest);if(!nodeId){nodeId='strategy'+seen.size;seen.set(digest,nodeId);add(nodeId,'STRATEGY_REFERENCE',{model:pin},models.find(m=>m.id===pin.id)?.name??'전략 버전 '+pin.version,750,50+index*180);}wire(nodeId,'router','strategy','case:'+key);});
 return {schemaVersion:2,contractVersion:'mind-strategy-decision-graph-v2',executionScope:{kind:'STRATEGY_PROGRAM'},triggers:['manual','closed_bar'],nodes,edges,outputNodeId:'router'};
}
export function regimeGraphDefinition(graph){
 check(isRegimeProgramGraph(graph)&&graph.schemaVersion===2&&Array.isArray(graph.nodes)&&graph.nodes.length>=4&&graph.nodes.length<=128&&Array.isArray(graph.edges)&&graph.edges.length<=256,'REGIME_GRAPH_SCHEMA','전략 라우터의 노드와 연결을 확인하세요.');
 const byId=new Map(),incoming=new Map();for(const n of graph.nodes){check(id(n.id)&&!byId.has(n.id)&&REGIME_NODE_TYPES.includes(n.type)&&n.config&&n.position&&Number.isFinite(n.position.x)&&Number.isFinite(n.position.y),'REGIME_GRAPH_NODE','등록한 국면 부품과 고유 ID를 사용하세요.');byId.set(n.id,n);incoming.set(n.id,[]);}
 const edgeIds=new Set();for(const e of graph.edges){check(id(e.id)&&!edgeIds.has(e.id)&&byId.has(e.from?.nodeId)&&byId.has(e.to?.nodeId)&&e.from.nodeId!==e.to.nodeId,'REGIME_GRAPH_EDGE','연결의 양쪽 부품과 고유 ID를 확인하세요.');edgeIds.add(e.id);const source=regimeNodePorts(byId.get(e.from.nodeId)).outputs.find(p=>p.id===e.from.port),target=regimeNodePorts(byId.get(e.to.nodeId)).inputs.find(p=>p.id===e.to.port);check(source&&target&&target.accepts.includes(source.dataType),'REGIME_GRAPH_PORT','같은 종류의 입력·출력을 연결하세요.');incoming.get(e.to.nodeId).push(e);}
 for(const n of graph.nodes)for(const p of regimeNodePorts(n).inputs)check(incoming.get(n.id).filter(e=>e.to.port===p.id).length===1,'REGIME_GRAPH_INPUT','각 필수 입력에 연결 하나를 지정하세요.');
 const router=byId.get(graph.outputNodeId),classifiers=graph.nodes.filter(n=>n.type==='REGIME_CLASSIFIER');check(router?.type==='REGIME_ROUTER'&&graph.nodes.filter(n=>n.type==='REGIME_ROUTER').length===1&&classifiers.length===1,'REGIME_GRAPH_OUTPUT','국면 판단기와 전략 라우터를 하나씩 연결하세요.');
 const source=(nodeId,portId)=>byId.get(incoming.get(nodeId).find(e=>e.to.port===portId)?.from.nodeId),classifier=classifiers[0];check(source(router.id,'selector')?.id===classifier.id,'REGIME_GRAPH_SELECTOR','국면 판단 결과를 라우터의 선택 입력에 연결하세요.');
 const config=copy(classifier.config),bindings={},readInput=portId=>{const n=source(classifier.id,portId);check(n?.type==='REGIME_INPUT'&&id(n.config.inputId),'REGIME_GRAPH_INPUT','판단기에 시장 입력 변수를 연결하세요.');if(n.config.source)bindings[n.config.inputId]=copy(n.config.source);return n.config.inputId;};
 if(config.kind==='AXES'){config.x.input=readInput('x');config.y.input=readInput('y');}else config.inputs=list(config.inputs).map(k=>readInput('input:'+k));
 if(Object.keys(bindings).length)config.inputBindings=bindings;
 let keys=REGIME_CASES;if(config.choiceSource){const choiceNode=source(classifier.id,'choices');check(choiceNode?.type==='CHOICE_LIST'&&source(router.id,'choices')?.id===choiceNode.id,'REGIME_GRAPH_CHOICES','판단기와 라우터에 같은 선택지 변수를 연결하세요.');const items=list(choiceNode.config.items);keys=items.map(v=>v.id);check(JSON.stringify(keys)===JSON.stringify(router.config.choiceIds),'REGIME_GRAPH_CHOICES','선택지 목록과 라우터 입력을 동기화하세요.');config.criteria=Object.fromEntries(items.map(v=>[v.id,v.description]));if(config.choiceSource==='VARIABLE')config.choices=copy(items);delete config.choiceSource;}
 const routes=Object.fromEntries(keys.map(key=>{const node=source(router.id,'case:'+key);check(node?.type==='STRATEGY_REFERENCE','REGIME_GRAPH_STRATEGY','각 선택지에 전략 버전을 연결하세요.');return [key,copy(node.config.model)];}));
 const reaching=new Set(),active=new Set();const visit=nodeId=>{check(!active.has(nodeId),'REGIME_GRAPH_CYCLE','순환 연결을 해제하세요.');if(reaching.has(nodeId))return;active.add(nodeId);for(const e of incoming.get(nodeId))visit(e.from.nodeId);active.delete(nodeId);reaching.add(nodeId);};visit(router.id);check(reaching.size===graph.nodes.length,'REGIME_GRAPH_DISCONNECTED','모든 부품을 국면 라우터까지 연결하세요.');
 return {classifier:config,routes,handover:router.config.handover,minimumDwellMs:router.config.minimumDwellMs};
}
/** Choice IDs are stable branch identities; removed IDs lose only their obsolete connections. */
export function synchronizeProgramChoices(graph,nodeId){
 const node=graph.nodes.find(n=>n.id===nodeId);if(node?.type==='REGIME_CLASSIFIER'){const ports=regimeNodePorts(node).inputs.map(v=>v.id);graph.edges=graph.edges.filter(e=>e.to.nodeId!==nodeId||ports.includes(e.to.port));return graph;}if(node?.type!=='CHOICE_LIST')return graph;
 const keys=list(node.config.items).map(v=>v.id),routers=new Set(graph.edges.filter(e=>e.from.nodeId===nodeId&&e.to.port==='choices').map(e=>e.to.nodeId));
 for(const router of graph.nodes.filter(n=>routers.has(n.id)&&n.type==='REGIME_ROUTER')){router.config.choiceIds=keys;graph.edges=graph.edges.filter(e=>e.to.nodeId!==router.id||!e.to.port.startsWith('case:')||keys.includes(e.to.port.slice(5)));}return graph;
}
export function regimeProgramGraphHash(graph){return hash({contractVersion:graph.contractVersion,executionScope:graph.executionScope,nodes:graph.nodes.map(n=>({id:n.id,type:n.type,config:n.config})).sort((a,b)=>a.id.localeCompare(b.id)),edges:graph.edges.map(e=>({from:e.from,to:e.to})).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))),outputNodeId:graph.outputNodeId});}
export function compileRegimeProgramGraph(graph){const definition=regimeGraphDefinition(graph);createRegimeProgram({id:'graph-validation',name:'국면 운용',createdAt:'2026-01-01T00:00:00.000Z',...definition});return {graphHash:regimeProgramGraphHash(graph),contractVersion:graph.contractVersion,nodeOrder:graph.nodes.map(n=>n.id),signalNodeIds:[],definition};}
export function diagnoseRegimeProgramGraph(graph){const nodes=Object.fromEntries(graph.nodes.map(n=>[n.id,{state:'VALID',issues:[]}])) ,edges=Object.fromEntries(graph.edges.map(e=>[e.id,{state:'VALID',issues:[]}])) ;try{compileRegimeProgramGraph(graph);return {nodes,edges,valid:true,issues:[]};}catch(e){const issue={code:e.code,message:e.message,nodeId:graph.outputNodeId,portId:null};if(nodes[graph.outputNodeId])nodes[graph.outputNodeId]={state:'INCOMPLETE',issues:[issue]};return {nodes,edges,valid:false,issues:[issue]};}}
