import {assertOntologyPorts} from './strategy-ontology.mjs';
import {hashInputPackage} from './workspace.mjs';

export const HOURLY_PATH_FEATURES=Object.freeze(['return_1bar','return_6bar','return_24bar','sma30_distance','volatility24','range24','relative_volume24','high24_distance']);
export const HOURLY_COMPONENT_VERSION='hourly-model-components-v1';
const fields=HOURLY_PATH_FEATURES,finite=Number.isFinite,H=3600000;
const check=(v,code,message)=>{if(!v)throw Object.assign(Error(message??code),{code,status:409});};
const exact=(o,keys)=>o&&typeof o==='object'&&!Array.isArray(o)&&Object.keys(o).sort().join(',')===[...keys].sort().join(',');
const iso=v=>typeof v==='string'&&finite(Date.parse(v))&&new Date(v).toISOString()===v;
const p=(id,type,many=false)=>({id,type,many});
const componentDefinitions={
 BARS:{title:'확정 시간봉',phase:'inference',inputs:[],outputs:[p('bars','OHLCV')]},
 FEATURE:{title:'특징 계산',phase:'inference',inputs:[p('bars','OHLCV')],outputs:[p('value','NUMBER')]},
 PACK:{title:'특징 묶음',phase:'inference',inputs:fields.map(f=>p(f,'NUMBER')),outputs:[p('features','FEATURE_VECTOR')]},
 TREE:{title:'학습된 조건 나무',phase:'inference',inputs:[p('features','FEATURE_VECTOR')],outputs:[p('values','PATH_VALUES')]},
 MEAN:{title:'예측 평균',phase:'inference',inputs:[p('values','PATH_VALUES',true)],outputs:[p('values','PATH_VALUES')]},
 RETURN:{title:'수익률 환산',phase:'inference',inputs:[p('values','PATH_VALUES')],outputs:[p('forecast','PATH_RETURN')]},
 CANDLES:{title:'보존된 과거 시세',phase:'training',inputs:[],outputs:[p('candles','CANDLES')]},
 SAMPLES:{title:'특징·6시간 뒤 결과 표본',phase:'training',inputs:[p('candles','CANDLES')],outputs:[p('rows','TRAINING_ROWS')]},
 LOG_TARGET:{title:'로그 수익률 목표',phase:'training',inputs:[p('rows','TRAINING_ROWS')],outputs:[p('rows','LOG_TRAINING_ROWS')]},
 FIT:{title:'조건 나무 학습',phase:'training',inputs:[p('rows','LOG_TRAINING_ROWS')],outputs:[p('forest','TRAINED_FOREST')]},
 MODEL:{title:'학습 모델 버전 생성',phase:'training',inputs:[p('forest','TRAINED_FOREST')],outputs:[p('model','MODEL')]}
};
export const HOURLY_COMPONENT_REGISTRY=Object.freeze(Object.fromEntries(Object.entries(componentDefinitions).map(([type,spec])=>{assertOntologyPorts(spec);return [type,Object.freeze({...spec,cohort:['BARS','CANDLES'].includes(type)?'DATA':'COMPUTE'})];})));
export const HOURLY_FEATURE_LABELS=Object.freeze(Object.fromEntries(fields.map((f,i)=>[f,['1봉 수익률','6봉 수익률','24봉 수익률','이동평균과 거리','변동성','고저 범위','평소 대비 거래량','고점과 거리'][i]])));
const featurePeriods=[1,6,24,30,24,24,24,24];
const node=(id,type,config={})=>({id,type,config});
const edge=(from,to,fromPort,toPort,index='')=>({id:from+'-'+to+'-'+toPort+index,from:{nodeId:from,port:fromPort},to:{nodeId:to,port:toPort}});
export function createHourlyModelComponents(model){
 const features=fields.map((feature,i)=>node('feature-'+i,'FEATURE',{feature,period:featurePeriods[i]}));
 const trees=model.trees.map((_,i)=>node('tree-'+i,'TREE',{treeIndex:i}));
 const inference={nodes:[node('bars','BARS'),...features,node('pack','PACK'),...trees,node('mean','MEAN'),node('return','RETURN')],edges:[...features.map(n=>edge('bars',n.id,'bars','bars')),...features.map((n,i)=>edge(n.id,'pack','value',fields[i])),...trees.map(n=>edge('pack',n.id,'features','features')),...trees.map(n=>edge(n.id,'mean','values','values')),edge('mean','return','values','values')],outputNodeId:'return'};
 const training={nodes:[node('candles','CANDLES'),node('samples','SAMPLES',{trainingDays:7}),node('log','LOG_TARGET'),node('fit','FIT',{trees:model.trees.length,maxDepth:4,minLeaf:40,seed:20261027}),node('model','MODEL')],edges:[edge('candles','samples','candles','candles'),edge('samples','log','rows','rows'),edge('log','fit','rows','rows'),edge('fit','model','forest','forest')],outputNodeId:'model'};
 return {contractVersion:HOURLY_COMPONENT_VERSION,inference,training};
}
export function compileHourlyComponentGraph(graph,phase,model){
 check(exact(graph,['nodes','edges','outputNodeId'])&&Array.isArray(graph.nodes)&&graph.nodes.length>0&&graph.nodes.length<=64&&Array.isArray(graph.edges)&&graph.edges.length<=160,'MODEL_COMPONENT_GRAPH','모델 내부 부품과 연결을 확인하세요.');
 const byId=new Map(),incoming=new Map(),edgeIds=new Set();
 for(const n of graph.nodes){check(exact(n,['id','type','config'])&&/^[a-zA-Z0-9_-]{1,100}$/.test(n.id)&&!byId.has(n.id)&&HOURLY_COMPONENT_REGISTRY[n.type]?.phase===phase,'MODEL_COMPONENT_NODE','모델 부품 종류와 고유 이름을 확인하세요.');byId.set(n.id,n);incoming.set(n.id,[]);
  if(n.type==='FEATURE')check(exact(n.config,['feature','period'])&&fields.includes(n.config.feature)&&Number.isSafeInteger(n.config.period)&&n.config.period>=1&&n.config.period<=(['sma30_distance','range24','high24_distance'].includes(n.config.feature)?30:29),'MODEL_COMPONENT_FEATURE','계산 지표와 30봉 안의 비교 기간을 확인하세요.');
  else if(n.type==='TREE')check(exact(n.config,['treeIndex'])&&Number.isSafeInteger(n.config.treeIndex)&&n.config.treeIndex>=0&&(!model||n.config.treeIndex<model.trees.length),'MODEL_COMPONENT_TREE','연결한 모델의 나무 번호를 선택하세요.');
  else if(n.type==='SAMPLES')check(exact(n.config,['trainingDays'])&&Number.isSafeInteger(n.config.trainingDays)&&n.config.trainingDays>=1&&n.config.trainingDays<=7,'MODEL_COMPONENT_SAMPLES','보존 시세에서 최근 1~7일의 학습 구간을 선택하세요.');
  else if(n.type==='FIT')check(exact(n.config,['trees','maxDepth','minLeaf','seed'])&&Number.isSafeInteger(n.config.trees)&&n.config.trees>=1&&n.config.trees<=32&&Number.isSafeInteger(n.config.maxDepth)&&n.config.maxDepth>=1&&n.config.maxDepth<=5&&Number.isSafeInteger(n.config.minLeaf)&&n.config.minLeaf>=1&&n.config.minLeaf<=100000&&Number.isSafeInteger(n.config.seed)&&n.config.seed>=0&&n.config.seed<=4294967295,'MODEL_COMPONENT_FIT','나무 수 1~32, 깊이 1~5와 학습 표본 수·시드를 확인하세요.');
  else check(exact(n.config,[]),'MODEL_COMPONENT_CONFIG','이 부품의 설정을 확인하세요.');
 }
 for(const e of graph.edges){const a=byId.get(e.from?.nodeId),b=byId.get(e.to?.nodeId),out=HOURLY_COMPONENT_REGISTRY[a?.type]?.outputs.find(p=>p.id===e.from?.port),input=HOURLY_COMPONENT_REGISTRY[b?.type]?.inputs.find(p=>p.id===e.to?.port);check(exact(e,['id','from','to'])&&exact(e.from,['nodeId','port'])&&exact(e.to,['nodeId','port'])&&typeof e.id==='string'&&!edgeIds.has(e.id)&&a&&b&&a!==b&&out&&input&&out.type===input.type,'MODEL_COMPONENT_CONNECTION','같은 자료 타입의 출력과 입력을 연결하세요.');edgeIds.add(e.id);incoming.get(b.id).push(e);}
 // Floating-point sums and branch traces must follow semantic ports/tree indices, not serialized edge order.
 for(const n of graph.nodes){const ports=HOURLY_COMPONENT_REGISTRY[n.type].inputs;incoming.get(n.id).sort((a,b)=>{const portOrder=ports.findIndex(p=>p.id===a.to.port)-ports.findIndex(p=>p.id===b.to.port);if(portOrder)return portOrder;const x=byId.get(a.from.nodeId),y=byId.get(b.from.nodeId),treeOrder=(x.type==='TREE'?x.config.treeIndex:32)-(y.type==='TREE'?y.config.treeIndex:32);return treeOrder||(a.from.nodeId<b.from.nodeId?-1:a.from.nodeId>b.from.nodeId?1:0);});}
 for(const n of graph.nodes)for(const port of HOURLY_COMPONENT_REGISTRY[n.type].inputs){const links=incoming.get(n.id).filter(e=>e.to.port===port.id);check(links.length>=1&&links.length<=(port.many?32:1)&&new Set(links.map(e=>e.from.nodeId+':'+e.from.port)).size===links.length,'MODEL_COMPONENT_PORT','필수 입력을 연결하고 같은 연결의 중복을 정리하세요.');}
 const order=[],seen=new Set(),active=new Set();function visit(id){check(!active.has(id),'MODEL_COMPONENT_CYCLE','계산이 되돌아오는 순환 연결을 정리하세요.');if(seen.has(id))return;active.add(id);for(const e of incoming.get(id))visit(e.from.nodeId);active.delete(id);seen.add(id);order.push(id);}
 check(byId.get(graph.outputNodeId)?.type===(phase==='inference'?'RETURN':'MODEL'),'MODEL_COMPONENT_OUTPUT','마지막 출력 부품을 연결하세요.');visit(graph.outputNodeId);check(seen.size===graph.nodes.length,'MODEL_COMPONENT_UNUSED','출력으로 이어지지 않은 부품을 연결하거나 삭제하세요.');
 if(phase==='inference')check(graph.nodes.filter(n=>n.type==='BARS').length===1&&graph.nodes.filter(n=>n.type==='PACK').length===1,'MODEL_COMPONENT_INPUT','한 벌의 시간봉과 특징 묶음을 연결하세요.');
 else check(['CANDLES','SAMPLES','LOG_TARGET','FIT','MODEL'].every(t=>graph.nodes.filter(n=>n.type===t).length===1)&&(!model||graph.nodes.find(n=>n.type==='FIT').config.trees===model.trees.length),'MODEL_COMPONENT_TRAINING','과거 시세·표본·로그 목표·학습·모델 생성 경로를 연결하세요.');
 return {byId,incoming,order};
}
export function assertHourlyModelComponents(components,model){check(exact(components,['contractVersion','inference','training'])&&components.contractVersion===HOURLY_COMPONENT_VERSION,'MODEL_COMPONENT_SCHEMA','학습모델 내부 그래프 버전을 확인하세요.');compileHourlyComponentGraph(components.inference,'inference',model);compileHourlyComponentGraph(components.training,'training',model);return components;}
export function hourlyComponentTraining(components){if(!components)return {trainingDays:7,trees:16,maxDepth:4,minLeaf:40,seed:20261027};assertHourlyModelComponents(components);const nodes=components.training.nodes;return {...nodes.find(n=>n.type==='SAMPLES').config,...nodes.find(n=>n.type==='FIT').config};}
function checkedBars(bars,asOf,timeframe='1h'){const step={'1h':H,'1m':60000}[timeframe];check(step&&iso(asOf)&&Date.parse(asOf)%step===0&&Array.isArray(bars)&&bars.length>=30,'HOURLY_MODEL_HISTORY');const b=bars.slice(-30),t=Date.parse(asOf);check(b.every((r,i)=>Array.isArray(r)&&r.length>=6&&r.slice(0,6).every(finite)&&r[0]===t-(30-i)*step&&r[1]>0&&r[3]>0&&r[4]>0&&r[5]>=0&&r[2]>=Math.max(r[1],r[4])&&r[3]<=Math.min(r[1],r[4])),'HOURLY_MODEL_BAR_TIME');return b;}
export function hourlyFeatureValue(b,feature,period){const c=b.map(r=>r[4]),price=c.at(-1),w=b.slice(-period),mean=a=>a.reduce((s,v)=>s+v,0)/a.length;let value;
 if(feature.startsWith('return_'))value=price/c.at(-period-1)-1;
 else if(feature==='sma30_distance')value=price/mean(c.slice(-period))-1;
 else if(feature==='volatility24'){const r=c.slice(-period-1).slice(1).map((v,i)=>Math.log(v/c.slice(-period-1)[i])),m=mean(r);value=Math.sqrt(r.reduce((s,v)=>s+(v-m)**2,0)/period);}
 else if(feature==='range24')value=(Math.max(...w.map(r=>r[2]))-Math.min(...w.map(r=>r[3])))/price;
 else if(feature==='relative_volume24'){const v=mean(b.slice(-period-1,-1).map(r=>r[5]));value=v?b.at(-1)[5]/v:0;}
 else if(feature==='high24_distance')value=price/Math.max(...w.map(r=>r[2]))-1;
 check(finite(value),'HOURLY_MODEL_FEATURES');return value;
}
export function hourlyComponentFeatures(bars,{asOf,components,timeframe='1h'}={}){const b=checkedBars(bars,asOf,timeframe);if(!components)return fields.map((f,i)=>hourlyFeatureValue(b,f,featurePeriods[i]));const {byId,incoming}=compileHourlyComponentGraph(components.inference,'inference'),pack=components.inference.nodes.find(n=>n.type==='PACK');return fields.map(f=>{const e=incoming.get(pack.id).find(e=>e.to.port===f),n=byId.get(e.from.nodeId);check(n.type==='FEATURE','MODEL_COMPONENT_FEATURE_SOURCE','특징 묶음에는 계산 지표를 연결하세요.');return hourlyFeatureValue(b,n.config.feature,n.config.period);});}
export function evaluateHourlyModelComponents(model,bars,{asOf,components,trace=false}={}){
 const graph=components??createHourlyModelComponents(model);assertHourlyModelComponents(graph,model);const b=checkedBars(bars,asOf,model.timeframe),compiled=compileHourlyComponentGraph(graph.inference,'inference',model),values=new Map(),treePaths=[],steps=[];
 for(const id of compiled.order){const n=compiled.byId.get(id),links=compiled.incoming.get(id),read=port=>links.filter(e=>e.to.port===port).map(e=>values.get(e.from.nodeId));let value;
  if(n.type==='BARS')value=b;
  else if(n.type==='FEATURE')value=hourlyFeatureValue(read('bars')[0],n.config.feature,n.config.period);
  else if(n.type==='PACK')value=fields.map(f=>read(f)[0]);
  else if(n.type==='TREE'){const x=read('features')[0],path=[];let leaf=model.trees[n.config.treeIndex][0];while(!leaf.values){const left=x[leaf.feature]<=leaf.threshold;path.push({feature:model.features[leaf.feature],value:x[leaf.feature],threshold:leaf.threshold,left});leaf=model.trees[n.config.treeIndex][left?leaf.left:leaf.right];}value=leaf.values;treePaths.push({tree:n.config.treeIndex,path,leafSamples:leaf.count});}
  else if(n.type==='MEAN'){const rows=read('values');value=[0,1].map(k=>rows.reduce((s,v)=>s+v[k],0)/rows.length);}
  else value=read('values')[0].map(v=>model.targetTransform==='LOG1P'?Math.expm1(v):v);
  values.set(id,value);if(trace)steps.push({nodeId:id,type:n.type,value:structuredClone(value)});
 }
 const result=values.get(graph.inference.outputNodeId),pack=graph.inference.nodes.find(n=>n.type==='PACK');return {terminal:result[0],minimum:result[1],features:values.get(pack.id),treePaths,...(trace?{componentTrace:{graphHash:hashInputPackage(graph),steps}}:{})};
}
