import {hashInputPackage} from './workspace.mjs';
import {HOURLY_PATH_FEATURES,hourlyComponentFeatures,evaluateHourlyModelComponents} from './hourly-model-components.mjs';
export {HOURLY_PATH_FEATURES} from './hourly-model-components.mjs';


const finite=Number.isFinite,H=3600000,HASH=/^[a-f0-9]{64}$/,iso=v=>typeof v==='string'&&finite(Date.parse(v))&&new Date(v).toISOString()===v;
const check=(ok,code)=>{if(!ok)throw Object.assign(new Error(code),{code,status:409});};
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join(',')===[...keys].sort().join(',');

export function assertHourlyPathModel(m){
 check(exact(m,['contractVersion','createdAt','timeframe','horizonBars','features','targetTransform','training','trees','sourceSha256','hash',...(m.contractVersion==='minute-policy-path-forest-v3'?['targetPolicy']:[])])&&(m.contractVersion==='hourly-path-forest-v1'&&m.timeframe==='1h'&&m.horizonBars===6||['minute-pooled-path-forest-v2','minute-policy-path-forest-v3'].includes(m.contractVersion)&&m.timeframe==='1m'&&[6,15,42].includes(m.horizonBars))&&iso(m.createdAt)&&JSON.stringify(m.features)===JSON.stringify(HOURLY_PATH_FEATURES)&&['IDENTITY','LOG1P'].includes(m.targetTransform)&&HASH.test(m.sourceSha256),'HOURLY_MODEL_SCHEMA');
 if(m.targetPolicy)check(exact(m.targetPolicy,['initialStopBps','trailingStopBps','trailingActivationBps'])&&Object.values(m.targetPolicy).every(v=>finite(v)&&v>0&&v<=10000),'PATH_TARGET_POLICY');
 const {hash,...body}=m;check(hash===hashInputPackage(body),'HOURLY_MODEL_HASH');
 check(exact(m.training,['lastLabelAt','sampleCount','rowsSha256'])&&iso(m.training.lastLabelAt)&&Number.isSafeInteger(m.training.sampleCount)&&m.training.sampleCount>0&&HASH.test(m.training.rowsSha256),'HOURLY_MODEL_TRAINING');
 check(Array.isArray(m.trees)&&m.trees.length>0&&m.trees.length<=32&&JSON.stringify(m).length<=180000,'HOURLY_MODEL_SIZE');
 for(const tree of m.trees){check(Array.isArray(tree)&&tree.length>0&&tree.length<=63,'HOURLY_MODEL_TREE');const seen=new Set();function visit(index,depth){check(Number.isInteger(index)&&index>=0&&index<tree.length&&!seen.has(index)&&depth<=5,'HOURLY_MODEL_TREE');seen.add(index);const n=tree[index];if(exact(n,['values','count']))check(Number.isSafeInteger(n.count)&&n.count>0&&Array.isArray(n.values)&&n.values.length===2&&n.values.every(finite)&&n.values[1]<=n.values[0]&&(m.targetTransform==='LOG1P'||n.values.every(v=>v> -1)),'HOURLY_MODEL_LEAF');else {check(exact(n,['feature','threshold','left','right'])&&Number.isInteger(n.feature)&&n.feature>=0&&n.feature<8&&finite(n.threshold),'HOURLY_MODEL_SPLIT');visit(n.left,depth+1);visit(n.right,depth+1);}}visit(0,0);check(seen.size===tree.length,'HOURLY_MODEL_UNREACHABLE');}
 return m;
}

/** Import pooled weights unchanged; the source receipt hash remains separate from the executable model hash. */
export function importHourlyPathModel(source,{sourceSha256}={}){
 check(source?.role==='RESEARCH_SHARED_MARKET_PATH_FOREST'&&source.timeframe==='1h'&&source.horizonBars===6&&JSON.stringify(source.features)===JSON.stringify(HOURLY_PATH_FEATURES)&&source.models?.pooled,'HOURLY_MODEL_SOURCE');
 const p=source.models.pooled,body={contractVersion:'hourly-path-forest-v1',createdAt:source.at,timeframe:'1h',horizonBars:6,features:[...HOURLY_PATH_FEATURES],targetTransform:source.targetTransform??'IDENTITY',training:{lastLabelAt:p.lastLabelAt,sampleCount:p.samples,rowsSha256:source.trainingRowsSha256},trees:structuredClone(p.trees),sourceSha256};
 return assertHourlyPathModel({...body,hash:hashInputPackage(body)});
}

export function hourlyPathFeatures(bars,options={}){return hourlyComponentFeatures(bars,options);}

export function predictHourlyPathModel(model,market,{asOf,availableAt=asOf,decisionAt=asOf,components,componentTrace=false}={}){
 assertHourlyPathModel(model);const fail=reason=>({ready:false,status:'BLOCKED',reasonCodes:[reason]});
 if(!iso(asOf)||asOf<=model.training.lastLabelAt)return fail('HOURLY_MODEL_TRAINING_CUTOFF');
 if(!iso(availableAt)||!iso(decisionAt)||availableAt<asOf||availableAt>decisionAt||asOf>decisionAt)return fail('HOURLY_MODEL_INPUT_TIME');
 let result;try{result=evaluateHourlyModelComponents(model,market?.bars,{asOf,components,trace:componentTrace});}catch(e){return fail(e.code??'HOURLY_MODEL_INPUT');}
 const {features:x,treePaths:paths,terminal,minimum}=result;
 if(!finite(terminal)||!finite(minimum)||terminal<=-1||minimum<=-1)return fail('HOURLY_MODEL_PREDICTION');
 return {ready:true,status:'READY',kind:'NUMBER',unit:'ratio',value:terminal,modelHash:model.hash,sourceModelSha256:model.sourceSha256,trainingLabelCutoff:model.training.lastLabelAt,horizonBars:model.horizonBars,timeframe:model.timeframe,features:Object.fromEntries(model.features.map((k,i)=>[k,x[i]])),marketPathForecast:{terminalReturn:terminal,minimumReturn:minimum,referencePrice:market.bars.at(-1)[4],valuation:'GROSS_PRICE_PATH_BEFORE_TRADING_COSTS'},treePaths:paths,...(componentTrace?{componentTrace:result.componentTrace}:{}),basisRefs:['hourly-model:'+model.hash]};
}
