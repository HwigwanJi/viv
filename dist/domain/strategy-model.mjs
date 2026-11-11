import {hashInputPackage as hash,stableStringify} from './workspace.mjs';
import {assertMindDocument,mindDocumentHash} from './mind-manifest.mjs';
import {compileStrategyGraph,strategyGraphHash} from './strategy-graph.mjs';

const copy=structuredClone;
const check=(ok,code,message)=>{if(!ok)throw Object.assign(new Error(message),{code,status:400});};
const id=v=>typeof v==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,199}$/.test(v);
const at=v=>typeof v==='string'&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString()===v;
const digest=v=>hash(Object.fromEntries(Object.entries(v).filter(([k])=>k!=='contentHash')));

/** A strategy is the entire editable policy, not its predictor or a QUANT leaf. */
export function createStrategyModel({id:resourceId,version=1,name,manifest,createdAt,previousVersion=null}){
 assertMindDocument(manifest);check(manifest.kind==='mind-policy','STRATEGY_MODEL_POLICY','완성된 마인드 정책을 선택하세요.');
 const graph=manifest.data.strategyPlan?.graph;check(graph,'STRATEGY_MODEL_GRAPH','전략 노드 구성을 먼저 저장하세요.');compileStrategyGraph(graph);
 const value={schemaVersion:1,kind:'strategy-model',id:resourceId,version,name,createdAt,previousVersion,policy:copy(manifest),source:{manifestId:manifest.id,manifestHash:mindDocumentHash(manifest),graphHash:strategyGraphHash(graph)}};
 value.contentHash=digest(value);return assertStrategyModel(value);
}
export function assertStrategyModel(value){
 check(value?.schemaVersion===1&&value.kind==='strategy-model'&&id(value.id)&&Number.isSafeInteger(value.version)&&value.version>=1&&typeof value.name==='string'&&value.name.trim().length>0&&value.name.length<=120&&at(value.createdAt),'STRATEGY_MODEL_FORMAT','전략 모델의 이름·버전·시각을 확인하세요.');
 check(value.contentHash===digest(value),'STRATEGY_MODEL_HASH','전략 모델 원문이 변경되었습니다.');assertMindDocument(value.policy);
 check(value.policy.kind==='mind-policy'&&value.source.manifestId===value.policy.id&&value.source.manifestHash===mindDocumentHash(value.policy)&&value.source.graphHash===strategyGraphHash(value.policy.data.strategyPlan.graph),'STRATEGY_MODEL_SOURCE','전략 모델과 정책·노드 원문을 대조하세요.');
 compileStrategyGraph(value.policy.data.strategyPlan.graph);return value;
}
export const strategyModelPin=model=>({id:assertStrategyModel(model).id,version:model.version,contentHash:model.contentHash});

/** A preset snapshots configuration only. Accounts, running jobs and fills stay with their source. */
export function createMindPreset({id:presetId,name,minds,createdAt}){
 check(id(presetId)&&typeof name==='string'&&name.trim().length>0&&name.length<=120&&at(createdAt)&&Array.isArray(minds)&&minds.length>0,'MIND_PRESET_INPUT','이름과 저장할 마인드를 선택하세요.');
 const seen=new Set();const snapshots=minds.map(({profile,settings,manifest,appearance})=>{
  assertMindDocument(manifest);check(manifest.kind==='mind-policy'&&profile.id===manifest.scope.profileId&&!seen.has(profile.id),'MIND_PRESET_SOURCE','서로 다른 마인드의 완성된 정책을 선택하세요.');seen.add(profile.id);
  return {sourceProfileId:profile.id,name:profile.name,settings:copy(settings),appearance:copy(appearance??null),manifest:copy(manifest),manifestHash:mindDocumentHash(manifest)};
 });
 const value={schemaVersion:1,kind:'mind-preset',id:presetId,name:name.trim(),createdAt,minds:snapshots};value.contentHash=digest(value);return assertMindPreset(value);
}
export function assertMindPreset(value){
 check(value?.schemaVersion===1&&value.kind==='mind-preset'&&id(value.id)&&typeof value.name==='string'&&value.name.length>0&&value.name.length<=120&&at(value.createdAt)&&Array.isArray(value.minds)&&value.minds.length>0&&value.contentHash===digest(value),'MIND_PRESET_HASH','마인드 프리셋 원문과 저장 해시를 확인하세요.');
 for(const m of value.minds){assertMindDocument(m.manifest);check(m.manifest.kind==='mind-policy'&&m.sourceProfileId===m.manifest.scope.profileId&&m.manifestHash===mindDocumentHash(m.manifest),'MIND_PRESET_SOURCE','보관된 정책 원문을 확인하세요.');}return value;
}
export function assertModelLibraryTransition(previous,next){
 for(const kind of ['strategyModels','mindPresets']){
  const validator=kind==='strategyModels'?assertStrategyModel:assertMindPreset,entries=next[kind]??[],seen=new Set();
  for(const e of entries){validator(e);check(!seen.has(e.id),'MODEL_LIBRARY_DUPLICATE','저장 항목 식별자가 중복되었습니다.');seen.add(e.id);}
  for(const e of previous[kind]??[])check(entries.some(n=>n.id===e.id&&stableStringify(n)===stableStringify(e)),'MODEL_LIBRARY_IMMUTABLE','저장된 모델·프리셋은 보존하고 새 버전으로 저장하세요.');
 }
}
