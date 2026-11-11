import {hashInputPackage} from './workspace.mjs';
import {createStrategyModule,StrategyGraphError} from './strategy-graph.mjs';
import {compileDecisionStrategyGraph,createDecisionStrategyGraph} from './strategy-decision-graph.mjs';

export const QUANT_STRATEGY_RESOURCE_VERSION='quant-strategy-resource-v1';
export const QUANT_STRATEGY_BINDING_VERSION='quant-strategy-instance-v1';
const clone=structuredClone,ID=/^[a-zA-Z0-9][a-zA-Z0-9_.:@/-]{0,199}$/,HASH=/^[a-f0-9]{64}$/;
const TYPES=['INPUT','VALUE','SIGNAL','MODEL','CONDITION','BOOLEAN_LOGIC','QUANT'];
const plain=v=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.getPrototypeOf(v)===Object.prototype;
const exact=(v,required,optional=[])=>plain(v)&&required.every(k=>Object.hasOwn(v,k))&&Object.keys(v).every(k=>required.includes(k)||optional.includes(k));
const equal=(a,b)=>hashInputPackage(a)===hashInputPackage(b);
const check=(value,code,message)=>{if(!value)throw new StrategyGraphError(code,message);};
const iso=v=>typeof v==='string'&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString()===v;
const edge=(id,from,to,fromPort='decision',toPort='decision')=>({id,from:{nodeId:from,port:fromPort},to:{nodeId:to,port:toPort}});
const fresh=(prefix,items)=>{let id=prefix,index=1;while(items.some(v=>v.id===id))id=prefix+'-'+index++;return id;};
const orderedEntries=value=>Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)));

// Resources reuse the canonical graph compiler. Temporary risk/order nodes serve
// validation only; every published mind owns its actual risk and order nodes.
function definitionGraph(definition){
 check(exact(definition,['nodes','edges','outputNodeId'])&&Array.isArray(definition.nodes)&&definition.nodes.length>=3&&definition.nodes.length<=24&&Array.isArray(definition.edges)&&definition.nodes.every(n=>TYPES.includes(n?.type))&&definition.nodes.filter(n=>n.type==='QUANT').length===1&&definition.nodes.some(n=>n.id===definition.outputNodeId&&n.type==='QUANT'),'QUANT_RESOURCE_DEFINITION','입력부터 하나의 퀀트 판단까지 완전한 전략을 연결하세요.');
 const nodes=clone(definition.nodes),riskId=fresh('library-validation-risk',nodes),orderId=fresh('library-validation-order',nodes);
 nodes.push({id:riskId,type:'RISK',label:'위험 한도',position:{x:0,y:0},config:{maxExposure:1,maxOrderWeight:1,minConfidence:0}},{id:orderId,type:'ORDER',label:'모의 주문',position:{x:0,y:0},config:{execution:'PAPER',sizing:'TARGET_WEIGHT'}});
 const edges=clone(definition.edges);edges.push(edge(fresh('library-validation-risk-edge',edges),definition.outputNodeId,riskId));edges.push(edge(fresh('library-validation-order-edge',edges),riskId,orderId,'approved','approved'));
 return {schemaVersion:2,contractVersion:'mind-strategy-decision-graph-v2',triggers:['manual','closed_bar'],nodes,edges,outputNodeId:orderId};
}
export function assertQuantStrategyDefinition(definition){compileDecisionStrategyGraph(definitionGraph(definition));return definition;}
export function quantStrategyEditorGraph(resource){assertQuantStrategyResource(resource);return definitionGraph(resource.definition);}
export function quantStrategyResourceHash(resource){const {contentHash,...body}=resource;return hashInputPackage(body);}
export function assertQuantStrategyResource(resource){
 check(exact(resource,['schemaVersion','contractVersion','id','version','name','description','createdAt','previousVersion','definition','contentHash'])&&resource.schemaVersion===1&&resource.contractVersion===QUANT_STRATEGY_RESOURCE_VERSION&&ID.test(resource.id??'')&&Number.isSafeInteger(resource.version)&&resource.version>=1&&typeof resource.name==='string'&&resource.name.trim().length>0&&resource.name.length<=100&&typeof resource.description==='string'&&resource.description.length<=2000&&iso(resource.createdAt)&&HASH.test(resource.contentHash??''),'QUANT_RESOURCE_SCHEMA','전략 이름·버전·작성 시각과 정의를 확인하세요.');
 const prior=resource.previousVersion;check(resource.version===1?prior===null:exact(prior,['version','contentHash'])&&prior.version===resource.version-1&&HASH.test(prior.contentHash??''),'QUANT_RESOURCE_LINEAGE','이전 전략 버전과 원문 해시를 연결하세요.');
 assertQuantStrategyDefinition(resource.definition);check(resource.contentHash===quantStrategyResourceHash(resource),'QUANT_RESOURCE_HASH','전략 원문과 내용 해시를 대조하세요.');return resource;
}
export function createQuantStrategyResource({id,version=1,name,description='',createdAt,previousVersion=null,definition}={}){
 const value={schemaVersion:1,contractVersion:QUANT_STRATEGY_RESOURCE_VERSION,id,version,name,description,createdAt,previousVersion:clone(previousVersion),definition:clone(definition)};
 value.contentHash=quantStrategyResourceHash(value);return assertQuantStrategyResource(value);
}
export function extractQuantStrategyResource(graph,{outputNodeId,...metadata}={}){
 compileDecisionStrategyGraph(graph);const output=graph.nodes.find(n=>n.id===outputNodeId);check(output?.type==='QUANT','QUANT_RESOURCE_OUTPUT','저장할 퀀트 판단 노드를 선택하세요.');
 const selected=new Set(),visit=id=>{if(selected.has(id))return;const node=graph.nodes.find(n=>n.id===id);check(node&&TYPES.includes(node.type),'QUANT_RESOURCE_NODE','공용 퀀트 전략에는 입력·계산·조건·퀀트 판단을 연결하세요.');selected.add(id);graph.edges.filter(e=>e.to.nodeId===id).forEach(e=>visit(e.from.nodeId));};visit(outputNodeId);
 return createQuantStrategyResource({...metadata,definition:{nodes:clone(graph.nodes.filter(n=>selected.has(n.id))),edges:clone(graph.edges.filter(e=>selected.has(e.from.nodeId)&&selected.has(e.to.nodeId))),outputNodeId}});
}
export function builtinQuantStrategies(){
 return [['MEAN_REVERSION','평균 회귀','이동평균 이격 신호와 매수·매도 기준을 조합합니다.'],['BTC_DOC9','BTC 기준 전략','BTC 명세서 가격 신호와 매수·매도 기준을 조합합니다.'],['OPPORTUNITY','기회 집중','추세·모멘텀·돌파 신호와 매수·매도 기준을 조합합니다.'],['SMA_TREND','이동평균 추세','확정 종가와 이동평균을 비교해 추세 방향을 계산합니다.']].map(([moduleId,name,description])=>extractQuantStrategyResource(createDecisionStrategyGraph({moduleId}),{outputNodeId:'quant',id:'quant-template-'+moduleId.toLowerCase().replaceAll('_','-'),version:1,name,description,createdAt:'2026-10-17T00:00:00.000Z'}));
}

function instanceStructure(graph,binding){
 const ids=new Set(Object.values(binding.nodeMap)),nodes=graph.nodes.filter(n=>ids.has(n.id)).map(n=>({id:n.id,type:n.type})).sort((a,b)=>a.id.localeCompare(b.id));
 const edges=graph.edges.filter(e=>ids.has(e.from.nodeId)&&ids.has(e.to.nodeId)).map(e=>({from:e.from,to:e.to})).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
 return {nodes,edges,outputNodeId:binding.outputNodeId};
}
const snapshot=(graph,map)=>orderedEntries(Object.fromEntries(Object.entries(map).map(([local,id])=>[local,clone(graph.nodes.find(n=>n.id===id).config)])));
export function quantStrategyInstanceHash(binding){return hashInputPackage({contractVersion:binding.contractVersion,instanceId:binding.instanceId,resourceId:binding.resourceId,resourceVersion:binding.resourceVersion,resourceHash:binding.resourceHash,nodeMap:orderedEntries(binding.nodeMap),parameterSnapshot:orderedEntries(binding.parameterSnapshot),outputNodeId:binding.outputNodeId,structureHash:binding.structureHash});}
export function quantStrategyBindingsSemantic(graph){return (graph.libraryBindings??[]).map(b=>({...clone(b),nodeMap:orderedEntries(b.nodeMap),parameterSnapshot:orderedEntries(b.parameterSnapshot)})).sort((a,b)=>a.instanceId.localeCompare(b.instanceId));}
export function assertQuantStrategyBindingMetadata(graph){
 if(!Object.hasOwn(graph,'libraryBindings'))return graph;
 check(Array.isArray(graph.libraryBindings)&&graph.libraryBindings.length>0&&graph.libraryBindings.length<=10,'QUANT_BINDINGS_SCHEMA','전략 인스턴스 목록을 확인하세요.');
 const instances=new Set(),owned=new Set();
 for(const b of graph.libraryBindings){
  check(exact(b,['contractVersion','instanceId','resourceId','resourceVersion','resourceHash','nodeMap','parameterSnapshot','outputNodeId','structureHash','instanceSemanticHash'])&&b.contractVersion===QUANT_STRATEGY_BINDING_VERSION&&ID.test(b.instanceId??'')&&!instances.has(b.instanceId)&&ID.test(b.resourceId??'')&&Number.isSafeInteger(b.resourceVersion)&&b.resourceVersion>=1&&HASH.test(b.resourceHash??'')&&HASH.test(b.structureHash??'')&&HASH.test(b.instanceSemanticHash??'')&&plain(b.nodeMap)&&Object.keys(b.nodeMap).length>=3&&Object.entries(b.nodeMap).every(([local,id])=>ID.test(local)&&ID.test(id))&&new Set(Object.values(b.nodeMap)).size===Object.keys(b.nodeMap).length&&plain(b.parameterSnapshot)&&ID.test(b.outputNodeId??''),'QUANT_BINDING_SCHEMA','인스턴스 ID·전략 버전·노드 연결·설정 스냅샷을 확인하세요.');instances.add(b.instanceId);
  const ids=new Set(Object.values(b.nodeMap));check(ids.has(b.outputNodeId)&&graph.nodes.find(n=>n.id===b.outputNodeId)?.type==='QUANT'&&[...ids].every(id=>!owned.has(id)&&graph.nodes.some(n=>n.id===id&&TYPES.includes(n.type))),'QUANT_BINDING_NODES','전략 인스턴스의 고유 노드와 퀀트 출력을 확인하세요.');ids.forEach(id=>owned.add(id));
  check(equal(b.parameterSnapshot,snapshot(graph,b.nodeMap)),'QUANT_BINDING_PARAMETERS','노드 설정과 저장할 전략 인스턴스 설정을 함께 갱신하세요.');
  check(b.structureHash===hashInputPackage(instanceStructure(graph,b)),'QUANT_BINDING_STRUCTURE','공용 전략의 내부 연결을 보존하거나 인스턴스 연결을 해제하세요.');
  check(b.instanceSemanticHash===quantStrategyInstanceHash(b),'QUANT_INSTANCE_HASH','고정한 전략·설정·연결의 실행 해시를 대조하세요.');
  check(graph.edges.every(e=>!ids.has(e.to.nodeId)||ids.has(e.from.nodeId))&&graph.edges.every(e=>!ids.has(e.from.nodeId)||ids.has(e.to.nodeId)||e.from.nodeId===b.outputNodeId),'QUANT_BINDING_BOUNDARY','전략 내부 입력을 유지하고 최종 퀀트 출력을 연결하세요.');
 }
 return graph;
}
function compatibleConfig(base,actual){
 if(base.type==='SIGNAL'){const {parameters:bp,parametersHash:bh,parametersVersionId:bv,...b}=base.config,{parameters:ap,parametersHash:ah,parametersVersionId:av,...a}=actual;return equal(a,b);}
 if(base.type==='INPUT'){const fixed=c=>Object.fromEntries(Object.entries(c).filter(([k])=>!['instrumentId','required','maxAgeMs'].includes(k)));return equal(fixed(base.config),fixed(actual));}
 return base.type==='CONDITION'||base.type==='QUANT'?base.config.mode===actual.mode:true;
}
export function assertQuantStrategyBindings(graph,resources=[]){
 compileDecisionStrategyGraph(graph);check(Array.isArray(resources),'QUANT_RESOURCE_LIST','승인된 전략 원문 목록을 확인하세요.');
 for(const b of graph.libraryBindings??[]){
  const matches=resources.filter(r=>r?.id===b.resourceId&&r.version===b.resourceVersion);check(matches.length===1,'QUANT_RESOURCE_UNAVAILABLE','이 워크스페이스에서 승인된 전략 버전을 연결하세요.');const resource=assertQuantStrategyResource(matches[0]);
  check(resource.contentHash===b.resourceHash,'QUANT_RESOURCE_PIN','고정한 전략 버전의 원문 해시를 확인하세요.');
  check(equal(Object.keys(b.nodeMap).sort(),resource.definition.nodes.map(n=>n.id).sort())&&b.outputNodeId===b.nodeMap[resource.definition.outputNodeId],'QUANT_BINDING_RESOURCE','전략 원문의 모든 노드와 출력을 연결하세요.');
  const mapped={nodes:resource.definition.nodes.map(n=>({id:b.nodeMap[n.id],type:n.type})).sort((a,z)=>a.id.localeCompare(z.id)),edges:resource.definition.edges.map(e=>({from:{...e.from,nodeId:b.nodeMap[e.from.nodeId]},to:{...e.to,nodeId:b.nodeMap[e.to.nodeId]}})).sort((a,z)=>JSON.stringify(a).localeCompare(JSON.stringify(z))),outputNodeId:b.outputNodeId};
  check(equal(mapped,instanceStructure(graph,b))&&resource.definition.nodes.every(n=>compatibleConfig(n,b.parameterSnapshot[n.id])),'QUANT_BINDING_RESOURCE','발행 전략의 계산 종류·입력 계약·내부 연결을 보존하세요.');
 }
 return graph;
}
function configuredNode(node,override,instanceId){
 if(override===undefined)return clone(node);check(plain(override),'QUANT_PARAMETER_OVERRIDE','노드별 설정 객체를 입력하세요.');const next=clone(node);
 if(node.type==='SIGNAL'){check(exact(override,[],['parameters'])&&(!Object.hasOwn(override,'parameters')||plain(override.parameters)),'QUANT_PARAMETER_OVERRIDE','계산 전략의 매개변수를 편집하세요.');const parameters={...next.config.parameters,...override.parameters};next.config=createStrategyModule(next.config.moduleId,{parameters,required:next.config.required,parametersVersionId:instanceId+'-params-'+hashInputPackage(parameters).slice(0,12)});}
 else{const allowed=node.type==='INPUT'?['instrumentId','required','maxAgeMs']:Object.keys(node.config).filter(k=>k!=='mode');check(Object.keys(override).every(k=>allowed.includes(k)),'QUANT_PARAMETER_OVERRIDE','해당 전략이 제공하는 입력·판단 설정을 편집하세요.');next.config={...next.config,...clone(override)};}
 return next;
}
function buildInstance(resource,{instanceId,configOverrides={},position={x:0,y:0}}){
 assertQuantStrategyResource(resource);check(ID.test(instanceId??'')&&instanceId.length<=100&&plain(configOverrides)&&Object.keys(configOverrides).every(id=>resource.definition.nodes.some(n=>n.id===id)),'QUANT_INSTANCE','고유 인스턴스와 등록된 매개변수 노드를 선택하세요.');
 const nodeMap=Object.fromEntries(resource.definition.nodes.map((n,i)=>[n.id,instanceId+'-n'+(i+1)]));
 const nodes=resource.definition.nodes.map(n=>{const configured=configuredNode(n,configOverrides[n.id],instanceId);return {...configured,id:nodeMap[n.id],position:{x:n.position.x+position.x,y:n.position.y+position.y}};});
 const edges=resource.definition.edges.map((e,i)=>({...clone(e),id:instanceId+'-e'+(i+1),from:{...e.from,nodeId:nodeMap[e.from.nodeId]},to:{...e.to,nodeId:nodeMap[e.to.nodeId]}}));
 const binding={contractVersion:QUANT_STRATEGY_BINDING_VERSION,instanceId,resourceId:resource.id,resourceVersion:resource.version,resourceHash:resource.contentHash,nodeMap,parameterSnapshot:snapshot({nodes},nodeMap),outputNodeId:nodeMap[resource.definition.outputNodeId],structureHash:'',instanceSemanticHash:''};binding.structureHash=hashInputPackage(instanceStructure({nodes,edges},binding));binding.instanceSemanticHash=quantStrategyInstanceHash(binding);
 assertQuantStrategyDefinition({nodes,edges,outputNodeId:binding.outputNodeId});return {nodes,edges,binding};
}
export function createQuantStrategyMindGraph(resource,{instanceId,configOverrides={},risk={maxExposure:.6,maxOrderWeight:.2,minConfidence:.6}}={}){
 const instance=buildInstance(resource,{instanceId,configOverrides}),riskId=fresh('risk',instance.nodes),orderId=fresh('order',instance.nodes);
 const graph={schemaVersion:2,contractVersion:'mind-strategy-decision-graph-v2',triggers:['manual','closed_bar'],nodes:[...instance.nodes,{id:riskId,type:'RISK',label:'위험 한도',position:{x:960,y:140},config:clone(risk)},{id:orderId,type:'ORDER',label:'모의 주문',position:{x:1200,y:140},config:{execution:'PAPER',sizing:'TARGET_WEIGHT'}}],edges:[...instance.edges,edge(fresh(instanceId+'-risk',instance.edges),instance.binding.outputNodeId,riskId),edge(fresh(instanceId+'-order',instance.edges),riskId,orderId,'approved','approved')],outputNodeId:orderId,libraryBindings:[instance.binding]};
 compileDecisionStrategyGraph(graph);return graph;
}
export function attachQuantStrategy(graph,resource,{instanceId,configOverrides={},position={x:0,y:0},connectTo,toPort}={}){
 compileDecisionStrategyGraph(graph);const next=clone(graph),instance=buildInstance(resource,{instanceId,configOverrides,position});check(!next.libraryBindings?.some(b=>b.instanceId===instanceId)&&instance.nodes.every(n=>!next.nodes.some(old=>old.id===n.id))&&instance.edges.every(e=>!next.edges.some(old=>old.id===e.id)),'QUANT_INSTANCE_COLLISION','다른 전략 인스턴스 ID를 사용하세요.');next.nodes.push(...instance.nodes);next.edges.push(...instance.edges);
 if(connectTo){const target=next.nodes.find(n=>n.id===connectTo);check(target&&['DECISION_MIXER','DECISION_ROUTER'].includes(target.type)&&target.config.mode!=='CONDITION','QUANT_INSTANCE_TARGET','기존 결정 믹서 또는 지정 라우터에 연결하세요.');next.edges.push(edge(fresh(instanceId+'-output',next.edges),instance.binding.outputNodeId,target.id,'decision',toPort??'decisions'));if(target.type==='DECISION_MIXER')target.config.weights.push({nodeId:instance.binding.outputNodeId,value:1});}
 else{const risk=next.nodes.find(n=>n.type==='RISK'),prior=next.edges.find(e=>e.to.nodeId===risk.id),mixerId=fresh(instanceId+'-combine',next.nodes);check(prior,'QUANT_INSTANCE_TARGET','현재 최종 결정 경로를 확인하세요.');next.edges=next.edges.filter(e=>e!==prior);next.nodes.push({id:mixerId,type:'DECISION_MIXER',label:'전략 결합',position:{x:risk.position.x-100,y:risk.position.y+100},config:{mode:'FIXED',weightVersionId:instanceId+'-mix-v1',weights:[{nodeId:prior.from.nodeId,value:.5},{nodeId:instance.binding.outputNodeId,value:.5}]}});next.edges.push(edge(fresh(instanceId+'-prior',next.edges),prior.from.nodeId,mixerId,'decision','decisions'),edge(fresh(instanceId+'-output',next.edges),instance.binding.outputNodeId,mixerId,'decision','decisions'),edge(fresh(instanceId+'-risk',next.edges),mixerId,risk.id));}
 next.libraryBindings=[...(next.libraryBindings??[]),instance.binding];compileDecisionStrategyGraph(next);return next;
}
export function refreshQuantStrategyBindings(graph,{allowIncomplete=false}={}){
 const next=clone(graph);for(const b of next.libraryBindings??[]){check(b.structureHash===hashInputPackage(instanceStructure(next,b)),'QUANT_BINDING_STRUCTURE','연결한 전략의 내부 구조를 보존하세요.');b.parameterSnapshot=snapshot(next,b.nodeMap);b.instanceSemanticHash=quantStrategyInstanceHash(b);}assertQuantStrategyBindingMetadata(next);if(!allowIncomplete)compileDecisionStrategyGraph(next);return next;
}
export function updateQuantStrategyInstance(graph,resource,{instanceId,configOverrides={}}={}){
 assertQuantStrategyResource(resource);const next=clone(graph),binding=next.libraryBindings?.find(b=>b.instanceId===instanceId);check(binding&&binding.resourceId===resource.id&&binding.resourceVersion===resource.version&&binding.resourceHash===resource.contentHash,'QUANT_INSTANCE_VERSION','편집할 전략의 고정 버전을 선택하세요.');check(plain(configOverrides)&&Object.keys(configOverrides).every(id=>Object.hasOwn(binding.nodeMap,id)),'QUANT_PARAMETER_OVERRIDE','인스턴스에 포함된 노드 설정을 선택하세요.');
 for(const [local,override] of Object.entries(configOverrides)){const node=next.nodes.find(n=>n.id===binding.nodeMap[local]);node.config=configuredNode(node,override,instanceId).config;}
 const result=refreshQuantStrategyBindings(next);const other=result.libraryBindings.filter(b=>b.instanceId!==instanceId);result.libraryBindings=[result.libraryBindings.find(b=>b.instanceId===instanceId)];assertQuantStrategyBindings({...result,nodes:result.nodes,libraryBindings:result.libraryBindings},[resource]);result.libraryBindings.push(...other);return result;
}
export function detachQuantStrategyInstance(graph,instanceId){compileDecisionStrategyGraph(graph);const next=clone(graph);check(next.libraryBindings?.some(b=>b.instanceId===instanceId),'QUANT_INSTANCE','분리할 전략 인스턴스를 선택하세요.');next.libraryBindings=next.libraryBindings.filter(b=>b.instanceId!==instanceId);if(!next.libraryBindings.length)delete next.libraryBindings;compileDecisionStrategyGraph(next);return next;}

export function upgradeQuantStrategyInstance(graph,resource,{instanceId,previousResource}={}){
 compileDecisionStrategyGraph(graph);assertQuantStrategyResource(resource);const next=clone(graph),binding=next.libraryBindings?.find(b=>b.instanceId===instanceId);check(binding&&binding.resourceId===resource.id&&resource.version>binding.resourceVersion,'QUANT_INSTANCE_UPGRADE','같은 전략의 새 버전을 선택하세요.');
 if(previousResource){assertQuantStrategyResource(previousResource);check(previousResource.id===binding.resourceId&&previousResource.version===binding.resourceVersion&&previousResource.contentHash===binding.resourceHash,'QUANT_INSTANCE_VERSION','현재 적용한 전략 원문을 확인하세요.');}
 if(resource.version===binding.resourceVersion+1)check(resource.previousVersion.contentHash===binding.resourceHash,'QUANT_INSTANCE_LINEAGE','현재 버전에서 이어지는 전략 개정본을 선택하세요.');
 check(equal(resource.definition.nodes.map(n=>n.id).sort(),Object.keys(binding.nodeMap).sort()),'QUANT_UPGRADE_STRUCTURE','노드 구성이 달라진 버전은 새 인스턴스로 추가해 연결을 검토하세요.');
 const overrides={};for(const n of resource.definition.nodes){const current=next.nodes.find(v=>v.id===binding.nodeMap[n.id]),prior=previousResource?.definition.nodes.find(v=>v.id===n.id);check(current?.type===n.type,'QUANT_UPGRADE_STRUCTURE','노드 종류가 달라진 버전은 새 인스턴스로 추가하세요.');const source=prior??current;check(n.type!=='SIGNAL'||n.config.moduleId===source.config.moduleId,'QUANT_UPGRADE_PARAMETERS','계산 종류가 달라진 전략은 새 인스턴스로 추가해 설정을 검토하세요.');check(n.type!=='INPUT'||compatibleConfig(source,n.config),'QUANT_UPGRADE_PARAMETERS','입력 종류·지표·주기가 달라진 전략은 새 인스턴스로 추가하세요.');check(n.type!=='QUANT'||n.config.mode===source.config.mode,'QUANT_UPGRADE_PARAMETERS','판단 방식이 달라진 전략은 새 인스턴스로 추가하세요.');const value=current.type==='SIGNAL'?current.config.parameters:current.config,newValues=n.type==='SIGNAL'?n.config.parameters:n.config,base=prior?(prior.type==='SIGNAL'?prior.config.parameters:prior.config):{};check(Object.keys(value).filter(k=>k!=='maxAgeMs').every(k=>Object.hasOwn(newValues,k)&&typeof value[k]===typeof newValues[k]),'QUANT_UPGRADE_PARAMETERS','삭제되거나 자료형이 변경된 설정을 새 인스턴스에서 검토하세요.');const changes=Object.fromEntries(Object.entries(value).filter(([k,v])=>!equal(v,base[k]??null)));overrides[n.id]=n.type==='SIGNAL'?{parameters:changes}:Object.fromEntries(Object.entries(changes).filter(([k])=>k!=='mode'&&(n.type!=='INPUT'||['instrumentId','required','maxAgeMs'].includes(k))));}
 const built=buildInstance(resource,{instanceId,configOverrides:overrides});check(equal(Object.values(binding.nodeMap),Object.values(built.binding.nodeMap)),'QUANT_UPGRADE_STRUCTURE','노드 순서가 달라진 버전은 새 인스턴스로 추가하세요.');
 for(const node of built.nodes){const old=next.nodes.find(v=>v.id===node.id);node.label=old.label;node.position=clone(old.position);next.nodes[next.nodes.indexOf(old)]=node;}
 const ids=new Set(Object.values(binding.nodeMap));next.edges=next.edges.filter(e=>!(ids.has(e.from.nodeId)&&ids.has(e.to.nodeId))).concat(built.edges);next.libraryBindings[next.libraryBindings.indexOf(binding)]=built.binding;compileDecisionStrategyGraph(next);return next;
}
export function previewQuantStrategyUpgrade(graph,resource,{instanceId,previousResource}={}){
 const binding=graph.libraryBindings?.find(b=>b.instanceId===instanceId),base={instanceId,fromVersion:binding?.resourceVersion??null,toVersion:resource?.version??null,changes:[]};
 try{const next=upgradeQuantStrategyInstance(graph,resource,{instanceId,previousResource}),after=next.libraryBindings.find(b=>b.instanceId===instanceId);for(const [local,value] of Object.entries(after.parameterSnapshot)){const before=binding.parameterSnapshot[local],flatten=c=>c.parameters?{...c.parameters}:c;const old=flatten(before),current=flatten(value);for(const key of new Set([...Object.keys(old),...Object.keys(current)]))if(!equal(old[key]??null,current[key]??null))base.changes.push({nodeId:local,field:key,previous:clone(old[key]??null),next:clone(current[key]??null)});}return {...base,compatible:true,previousInstanceHash:binding.instanceSemanticHash,nextInstanceHash:after.instanceSemanticHash};}
 catch(error){return {...base,compatible:false,error:{code:error.code??'QUANT_UPGRADE_INVALID',message:error.message}};}
}
