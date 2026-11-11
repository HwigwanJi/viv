import {decisionGraphLimits} from './strategy-graph-limits.mjs';
import {hashInputPackage} from './workspace.mjs';

export const GRAPH_COMPOSITION_VERSION='mind-graph-composition-v1';
const ID=/^[a-zA-Z0-9][a-zA-Z0-9_.:@/-]{0,199}$/,HASH=/^[a-f0-9]{64}$/;
const clone=structuredClone,plain=v=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.getPrototypeOf(v)===Object.prototype;
const exact=(v,keys)=>plain(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const check=(ok,code,message)=>{if(!ok){const error=new Error(message);error.code=code;throw error;}};
const validName=v=>typeof v==='string'&&v.trim().length>0&&v.length<=100;
const groupFor=(graph,id)=>{const group=graph.compositions?.find(g=>g.id===id);check(group,'GRAPH_COMPOSITION_MISSING','선택한 컴포지션을 확인하세요.');return group;};
const handle=(direction,nodeId,port)=>direction+':'+encodeURIComponent(nodeId)+':'+encodeURIComponent(port);

/** Presentation membership only. Flat canonical nodes/edges remain the execution source. */
export function assertGraphCompositions(graph,{portContract}={}){
 if(!Object.hasOwn(graph,'compositions'))return graph;
 check(Array.isArray(graph.compositions)&&graph.compositions.length>0&&graph.compositions.length<=16,'GRAPH_COMPOSITIONS_SCHEMA','컴포지션 목록을 확인하세요.');
 const groups=new Set(),members=new Set(),nodeIds=new Set(graph.nodes.map(n=>n.id));
 for(const group of graph.compositions){
  check(exact(group,['id','name','nodeIds','collapsed','version'])&&ID.test(group.id??'')&&!groups.has(group.id)&&!nodeIds.has(group.id)&&validName(group.name)&&group.version===1&&typeof group.collapsed==='boolean'&&Array.isArray(group.nodeIds)&&group.nodeIds.length>=2&&group.nodeIds.length<=32&&new Set(group.nodeIds).size===group.nodeIds.length,'GRAPH_COMPOSITION_SCHEMA','컴포지션 이름·고유 ID·구성 요소를 확인하세요.');
  groups.add(group.id);
  for(const id of group.nodeIds){check(ID.test(id??'')&&nodeIds.has(id)&&!members.has(id),'GRAPH_COMPOSITION_MEMBERSHIP','각 노드는 하나의 컴포지션에만 넣을 수 있습니다.');members.add(id);}
  if(portContract)compositionBoundary(graph,group.id,{portContract});
 }
 return graph;
}
export function createGraphComposition(graph,{id,name,nodeIds,collapsed=false}={}){
 const next=clone(graph);next.compositions=[...(next.compositions??[]),{id,name:name?.trim(),nodeIds:clone(nodeIds),collapsed,version:1}];return assertGraphCompositions(next);
}
export function ungroupGraphComposition(graph,id){
 groupFor(graph,id);const next=clone(graph);next.compositions=next.compositions.filter(g=>g.id!==id);if(!next.compositions.length)delete next.compositions;return next;
}
export function setGraphCompositionCollapsed(graph,id,collapsed){
 check(typeof collapsed==='boolean','GRAPH_COMPOSITION_SCHEMA','펼침 상태를 확인하세요.');const next=clone(graph);groupFor(next,id).collapsed=collapsed;return assertGraphCompositions(next);
}
export function renameGraphComposition(graph,id,name){const next=clone(graph);groupFor(next,id).name=name?.trim();return assertGraphCompositions(next);}
export function pruneGraphCompositions(graph){
 if(!graph.compositions)return graph;const next=clone(graph),ids=new Set(next.nodes.map(n=>n.id));next.compositions=next.compositions.map(g=>({...g,nodeIds:g.nodeIds.filter(id=>ids.has(id))})).filter(g=>g.nodeIds.length>=2);if(!next.compositions.length)delete next.compositions;return assertGraphCompositions(next);
}

/** Expose existing cut edges and unconnected/leaf ports. No connection is inserted. */
export function compositionBoundary(graph,id,{portContract}={}){
 check(typeof portContract==='function','GRAPH_COMPOSITION_PORT_CONTRACT','정본 포트 계약을 연결하세요.');
 const group=typeof id==='string'?groupFor(graph,id):id,ids=new Set(group.nodeIds),inputs=[],outputs=[];
 const internalEdges=graph.edges.filter(e=>ids.has(e.from.nodeId)&&ids.has(e.to.nodeId));
 const incomingEdges=graph.edges.filter(e=>!ids.has(e.from.nodeId)&&ids.has(e.to.nodeId));
 const outgoingEdges=graph.edges.filter(e=>ids.has(e.from.nodeId)&&!ids.has(e.to.nodeId));
 for(const node of graph.nodes.filter(n=>ids.has(n.id))){const spec=portContract(node);for(const direction of ['inputs','outputs'])for(const port of spec[direction]){
  const side=direction==='inputs'?'to':'from',internal=internalEdges.some(e=>e[side].nodeId===node.id&&e[side].port===port.id),external=(direction==='inputs'?incomingEdges:outgoingEdges).some(e=>e[side].nodeId===node.id&&e[side].port===port.id);
  if(port.parameter&&!external)continue;
  if(!internal||external)(direction==='inputs'?inputs:outputs).push({id:handle(direction,node.id,port.id),nodeId:node.id,port:port.id,dataType:port.dataType,accepts:clone(port.accepts??[]),minConnections:port.minConnections??0,maxConnections:port.maxConnections??1});
 }}
 return {inputs,outputs,internalEdgeIds:internalEdges.map(e=>e.id),incomingEdgeIds:incomingEdges.map(e=>e.id),outgoingEdgeIds:outgoingEdges.map(e=>e.id)};
}
export function resolveGraphCompositionPort(graph,id,portId,{portContract}={}){
 const boundary=compositionBoundary(graph,id,{portContract}),port=[...boundary.inputs,...boundary.outputs].find(p=>p.id===portId);check(port,'GRAPH_COMPOSITION_PORT','연결할 컴포지션 포트를 확인하세요.');return{nodeId:port.nodeId,port:port.port};
}

export function exportGraphComposition(graph,id,{portContract}={}){
 assertGraphCompositions(graph,{portContract});const group=groupFor(graph,id),ids=new Set(group.nodeIds),boundary=compositionBoundary(graph,id,{portContract});
 const body={schemaVersion:1,contractVersion:GRAPH_COMPOSITION_VERSION,version:1,name:group.name,definition:{nodes:clone(graph.nodes.filter(n=>ids.has(n.id))),edges:clone(graph.edges.filter(e=>ids.has(e.from.nodeId)&&ids.has(e.to.nodeId)))},boundary:{inputs:boundary.inputs,outputs:boundary.outputs}};
 return{...body,contentHash:hashInputPackage(body)};
}
export function assertGraphCompositionResource(resource,{portContract}={}){
 check(exact(resource,['schemaVersion','contractVersion','version','name','definition','boundary','contentHash'])&&resource.schemaVersion===1&&resource.contractVersion===GRAPH_COMPOSITION_VERSION&&resource.version===1&&validName(resource.name)&&HASH.test(resource.contentHash??''),'GRAPH_COMPOSITION_RESOURCE','컴포지션 파일의 버전과 이름을 확인하세요.');
 const {contentHash,...body}=resource;check(hashInputPackage(body)===contentHash,'GRAPH_COMPOSITION_HASH','컴포지션 원문 해시가 일치하지 않습니다.');
 const d=resource.definition;check(exact(d,['nodes','edges'])&&Array.isArray(d.nodes)&&d.nodes.length>=2&&d.nodes.length<=32&&Array.isArray(d.edges)&&d.edges.length<=64,'GRAPH_COMPOSITION_RESOURCE','컴포지션의 노드와 연결을 확인하세요.');
 const ids=new Set(d.nodes.map(n=>n?.id));check(ids.size===d.nodes.length&&[...ids].every(id=>ID.test(id??''))&&d.nodes.every(n=>plain(n)&&typeof n.type==='string'&&plain(n.config)&&plain(n.position)&&Number.isFinite(n.position.x)&&Number.isFinite(n.position.y)),'GRAPH_COMPOSITION_RESOURCE','구성 요소의 고유 ID와 위치를 확인하세요.');
 check(new Set(d.edges.map(e=>e.id)).size===d.edges.length&&d.edges.every(e=>ID.test(e.id??'')&&ids.has(e.from?.nodeId)&&ids.has(e.to?.nodeId)),'GRAPH_COMPOSITION_BOUNDARY','외부 연결은 공개 포트로 연결하세요.');
 check(typeof portContract==='function'&&exact(resource.boundary,['inputs','outputs']),'GRAPH_COMPOSITION_PORT_CONTRACT','정본 포트 계약을 연결하세요.');
 const byId=new Map(d.nodes.map(n=>[n.id,n])),pairs=new Set(),incoming=new Map(),outgoing=new Map();
 for(const edge of d.edges){const from=portContract(byId.get(edge.from.nodeId)).outputs.find(p=>p.id===edge.from.port),to=portContract(byId.get(edge.to.nodeId)).inputs.find(p=>p.id===edge.to.port),pair=JSON.stringify([edge.from,edge.to]),key=edge.to.nodeId+':'+edge.to.port;check(from&&to&&to.accepts.includes(from.dataType)&&!pairs.has(pair),'GRAPH_COMPOSITION_PORT_TYPE','구성 요소의 실제 입출력 자료형을 확인하세요.');pairs.add(pair);incoming.set(key,(incoming.get(key)??0)+1);check(incoming.get(key)<=to.maxConnections,'GRAPH_COMPOSITION_PORT_ARITY','내부 입력의 최대 연결 수를 확인하세요.');outgoing.set(edge.from.nodeId,[...(outgoing.get(edge.from.nodeId)??[]),edge.to.nodeId]);}
 const active=new Set(),done=new Set(),visit=id=>{check(!active.has(id),'GRAPH_COMPOSITION_CYCLE','컴포지션 내부에 순환 연결을 만들 수 없습니다.');if(done.has(id))return;active.add(id);for(const next of outgoing.get(id)??[])visit(next);active.delete(id);done.add(id);};for(const id of ids)visit(id);
 for(const direction of ['inputs','outputs']){const ports=resource.boundary[direction];check(Array.isArray(ports)&&ports.length<=64&&new Set(ports.map(p=>p.id)).size===ports.length,'GRAPH_COMPOSITION_BOUNDARY','공개 포트 목록을 확인하세요.');for(const port of ports){const n=d.nodes.find(n=>n.id===port.nodeId),expected=n&&portContract(n)[direction].find(p=>p.id===port.port);check(expected&&exact(port,['id','nodeId','port','dataType','accepts','minConnections','maxConnections'])&&port.id===handle(direction,port.nodeId,port.port)&&port.dataType===expected.dataType&&hashInputPackage(port.accepts)===hashInputPackage(expected.accepts??[])&&port.minConnections===(expected.minConnections??0)&&port.maxConnections===(expected.maxConnections??1),'GRAPH_COMPOSITION_PORT_TYPE','공개 포트의 자료형과 실제 내부 포트를 대조하세요.');}}
 const required=compositionBoundary(d,{nodeIds:[...ids]},{portContract});for(const direction of ['inputs','outputs'])for(const port of required[direction])check(resource.boundary[direction].some(p=>p.id===port.id),'GRAPH_COMPOSITION_BOUNDARY','연결되지 않은 내부 입출력을 공개 포트에 포함하세요.');
 return resource;
}
export function importGraphComposition(graph,resource,{id,position={x:0,y:0},portContract}={}){
 assertGraphCompositionResource(resource,{portContract});const next=clone(graph);check(ID.test(id??'')&&!next.nodes.some(n=>n.id===id)&&!next.compositions?.some(g=>g.id===id),'GRAPH_COMPOSITION_ID','새 컴포지션의 고유 ID를 사용하세요.');
 check(plain(position)&&Number.isFinite(position.x)&&Number.isFinite(position.y),'GRAPH_COMPOSITION_POSITION','컴포지션을 놓을 위치를 확인하세요.');
 check(next.nodes.length+resource.definition.nodes.length<=decisionGraphLimits(graph).nodes&&next.edges.length+resource.definition.edges.length<=decisionGraphLimits(graph).edges,'GRAPH_COMPOSITION_LIMIT',`노드 ${decisionGraphLimits(graph).nodes}개·연결 ${decisionGraphLimits(graph).edges}개 범위에서 추가하세요.`);
 const map=Object.fromEntries(resource.definition.nodes.map((n,i)=>[n.id,id+'-n'+(i+1)]));check(Object.values(map).every(value=>ID.test(value)&&!next.nodes.some(n=>n.id===value)),'GRAPH_COMPOSITION_ID','구성 요소 ID가 중복되지 않게 하세요.');
 check(resource.definition.edges.every((_,i)=>ID.test(id+'-e'+(i+1))&&!next.edges.some(e=>e.id===id+'-e'+(i+1))),'GRAPH_COMPOSITION_ID','연결 ID가 중복되지 않게 하세요.');
 const remap=value=>Array.isArray(value)?value.map(remap):plain(value)?Object.fromEntries(Object.entries(value).map(([key,v])=>[key,(key==='nodeId'||key.endsWith('NodeId'))&&typeof v==='string'&&map[v]?map[v]:remap(v)])):value;
 const minX=Math.min(...resource.definition.nodes.map(n=>n.position.x)),minY=Math.min(...resource.definition.nodes.map(n=>n.position.y));
 next.nodes.push(...resource.definition.nodes.map(n=>{const config=remap(n.config);if(n.type==='JEV_QUESTION'&&config.question)config.question.id=map[n.id];return{...clone(n),id:map[n.id],position:{x:n.position.x-minX+position.x,y:n.position.y-minY+position.y},config};}));
 next.edges.push(...resource.definition.edges.map((e,i)=>({...clone(e),id:id+'-e'+(i+1),from:{...e.from,nodeId:map[e.from.nodeId]},to:{...e.to,nodeId:map[e.to.nodeId]}})));
 return createGraphComposition(next,{id,name:resource.name,nodeIds:Object.values(map),collapsed:true});
}
