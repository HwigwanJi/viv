import {assertHourlyPathModel} from '../domain/hourly-path-model.mjs';
import {assertHourlyModelComponents,createHourlyModelComponents,HOURLY_FEATURE_LABELS} from '../domain/hourly-model-components.mjs';
import {hashInputPackage} from '../domain/workspace.mjs';

export const isInspectableHourlyModel=node=>node?.type==='MODEL'&&['HOURLY_PATH_FOREST','HOURLY_VALUE_FOREST','SURGE_PATH_FOREST'].includes(node.config.family);
export function hourlyModelSources(minds=[]){
 const versions=new Map();
 for(const mind of minds)for(const node of mind.manifest?.data?.strategyPlan?.graph?.nodes??[]){
  if(!isInspectableHourlyModel(node)||!node.config.model)continue;
  const {model,components}=node.config;assertHourlyPathModel(model);if(components)assertHourlyModelComponents(components,model);
  const id=hashInputPackage({model:model.hash,components:components??createHourlyModelComponents(model)}),name=mind.manifest.data.name??mind.id;
  if(versions.has(id)){versions.get(id).sources.push(name);continue;}
  versions.set(id,{id,model:structuredClone(model),...(components?{components:structuredClone(components)}:{}),sources:[name]});
 }
 return [...versions.values()].sort((a,b)=>b.model.training.lastLabelAt.localeCompare(a.model.training.lastLabelAt));
}
export function hourlyModelSourceConfig(config,source){
 assertHourlyPathModel(source.model);if(source.components)assertHourlyModelComponents(source.components,source.model);
 const {components:previous,...base}=config;
 if(config.family==='SURGE_PATH_FOREST'&&source.model.timeframe!=='1m'||config.family!=='SURGE_PATH_FOREST'&&source.model.timeframe!=='1h')throw Error('모델의 입력 주기를 확인하세요.');
 return {...base,model:structuredClone(source.model),...(source.components?{components:structuredClone(source.components)}:{})};
}
export function hourlyModelOverview(config){
 if(!config.model)return null;
 const components=config.components??createHourlyModelComponents(config.model);
 return {features:components.inference.nodes.filter(n=>n.type==='FEATURE').length,trees:components.inference.nodes.filter(n=>n.type==='TREE').length,training:components.training.nodes.length,samples:config.model.training.sampleCount,lastLabelAt:config.model.training.lastLabelAt,geometric:config.model.targetTransform==='LOG1P'};
}
export const hourlyComponentTitle=node=>node.type==='FEATURE'?(node.config.feature.startsWith('return_')?node.config.period+'봉 수익률':HOURLY_FEATURE_LABELS[node.config.feature]):node.type==='TREE'?'조건 나무 '+(node.config.treeIndex+1):null;
// View-only expansion: each split and leaf points back to the exact persisted tree index.
export function hourlyTreeView(model,treeIndex){
 assertHourlyPathModel(model);const tree=model.trees[treeIndex];if(!tree)throw new Error('학습된 나무 번호를 확인하세요.');
 const nodes=[],edges=[],columnRows=new Map();
 function visit(index,depth){const value=tree[index],row=columnRows.get(depth)??0;columnRows.set(depth,row+1);
  nodes.push({id:'tree-node-'+index,index,type:value.values?'LEAF':'SPLIT',depth,row,feature:value.values?null:model.features[value.feature],threshold:value.threshold,values:value.values?.map(v=>model.targetTransform==='LOG1P'?Math.expm1(v):v),samples:value.count});
  if(!value.values)for(const [label,next]of [['이하',value.left],['초과',value.right]]){edges.push({id:index+'-'+next,source:'tree-node-'+index,target:'tree-node-'+next,label});visit(next,depth+1);}
 }visit(0,0);return {nodes,edges};
}
