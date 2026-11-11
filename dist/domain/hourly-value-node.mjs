import {assertHourlyModelComponents} from './hourly-model-components.mjs';
import {hashInputPackage} from './workspace.mjs';
import {assertHourlyPathModel,predictHourlyPathModel} from './hourly-path-model.mjs';
import {selectHourlyValue,rejectedHourlyValueFallback} from './hourly-value-policy.mjs';
import {createHourlyValueReview,advanceHourlyValueReview} from './hourly-value-review.mjs';

export const HOURLY_VALUE_INPUT='hourly-value:upbit:state';
const check=(ok,code)=>{if(!ok)throw Object.assign(new Error(code),{code});};
export function assertHourlyValueNode(config){
 check(config?.family==='HOURLY_VALUE_FOREST'&&['family,model,policy','components,family,model,policy'].includes(Object.keys(config).sort().join(',')),'HOURLY_VALUE_NODE_CONFIG');
 if(config.model!==null){assertHourlyPathModel(config.model);check(config.model.timeframe==='1h','HOURLY_VALUE_MODEL_TIMEFRAME');}
 if(config.components)assertHourlyModelComponents(config.components,config.model);
 const p=config.policy;check(p&&Object.keys(p).sort().join(',')==='entrySlippageBps,forecastExitSlippageBps,readyDelayMs'&&['entrySlippageBps','forecastExitSlippageBps'].every(k=>Number.isFinite(p[k])&&p[k]>=0&&p[k]<10000)&&Number.isSafeInteger(p.readyDelayMs)&&p.readyDelayMs>=0,'HOURLY_VALUE_NODE_POLICY');
 return config;
}

/** The graph owns ranking and review; the caller supplies its current account and pinned subscription. */
export function evaluateHourlyValueNode(config,snapshot,{asOf,profileId,accountId,binding,universe,executionInstrumentId,currentWeight,graphHash,executionEnabled,completedSteps=0}={}){
 assertHourlyValueNode(config);check(config.model,'HOURLY_MODEL_REQUIRED');
 check(snapshot?.contractVersion==='hourly-value-input-v1'&&snapshot.asOf===asOf&&snapshot.account?.profileId===profileId&&snapshot.account.accountId===accountId&&snapshot.account.asOf===asOf,'HOURLY_VALUE_NODE_SCOPE');
 check(binding?.profileId===profileId&&binding.accountId===accountId&&binding.modelHash===config.model.hash&&binding.graphHash===graphHash&&binding.ledgerHash===snapshot.account.sourceHash,'HOURLY_VALUE_NODE_BINDING');
 check(binding.feeHash===hashInputPackage({buyRate:Number(snapshot.fees?.buyRate),sellRate:Number(snapshot.fees?.sellRate)}),'HOURLY_VALUE_NODE_FEES');
 check(Array.isArray(universe)&&universe.length>0&&universe.every(id=>/^crypto:upbit:KRW-[A-Z0-9]+$/.test(id))&&Array.isArray(snapshot.markets)&&snapshot.markets.every(m=>universe.includes('crypto:upbit:'+m.market))&&snapshot.account.positions.every(p=>universe.includes('crypto:upbit:'+p.market)),'HOURLY_VALUE_NODE_UNIVERSE');
 let selection,state=null;
 if(snapshot.reviewState){
  check(snapshot.reviewState.readyDelayMs===config.policy.readyDelayMs&&snapshot.reviewState.entrySlippageBps===config.policy.entrySlippageBps&&snapshot.reviewState.selection.fees.forecastExitSlippageBps===config.policy.forecastExitSlippageBps,'HOURLY_VALUE_NODE_POLICY_CHANGED');
  state=advanceHourlyValueReview(snapshot.reviewState,{binding,asOf,review:snapshot.review??null});selection=state.selection;
 }else{
  const frames=snapshot.markets.map(m=>{const forecast=predictHourlyPathModel(config.model,{bars:m.bars},{asOf:m.forecastAsOf,availableAt:m.availableAt,decisionAt:asOf,components:config.components});const {bars,...frame}=m;return {...frame,forecast};});
  selection=selectHourlyValue({asOf,profileId,accountId,account:snapshot.account,frames,fees:snapshot.fees,modelHash:config.model.hash,forecastExitSlippageBps:config.policy.forecastExitSlippageBps});
  if(!selection.ready)return selection;
  state=createHourlyValueReview({selection,binding,expiresAt:snapshot.expiresAt,entrySlippageBps:config.policy.entrySlippageBps,readyDelayMs:config.policy.readyDelayMs});
 }
 check([...selection.ownedMarkets,...(selection.selected.market?[selection.selected.market]:[])].every(m=>universe.includes('crypto:upbit:'+m)),'HOURLY_VALUE_NODE_UNIVERSE');
 const fallback=state?.phase==='REJECTED'?rejectedHourlyValueFallback(selection):null,audit={selection,reviewState:state,...(fallback?{fallback}:{})};
 if(fallback?.steps.length&&asOf<state.review.readyAt)return {ready:false,status:'BLOCKED',reasonCodes:['HOURLY_VALUE_WAITING_REJECTED_EXIT'],...audit};
 // Rotation is handed off atomically after review; its replay must measure this timing separately.
 if(state&&state.phase!=='READY'&&!fallback)return {ready:false,status:'BLOCKED',reasonCodes:['HOURLY_VALUE_'+state.phase],...audit};
 if(executionEnabled!==true)return {ready:false,status:'BLOCKED',reasonCodes:['HOURLY_VALUE_OPERATION_INACTIVE'],...audit};
 const steps=fallback?fallback.steps:state?.review?.steps??selection.steps;check(Number.isSafeInteger(completedSteps)&&completedSteps>=0&&completedSteps<=steps.length,'HOURLY_VALUE_STEP_CURSOR');
 check(steps.slice(0,completedSteps).filter(s=>s.action==='sell').every(s=>!snapshot.account.positions.some(p=>p.market===s.market&&Number(p.quantity)>0)),'HOURLY_VALUE_UNSETTLED_STEP');
 const step=steps[completedSteps],market=step?.market??fallback?.market??selection.selected.market;
 check(executionInstrumentId==='crypto:upbit:'+market||!step&&(fallback?.kind??selection.selected.kind)==='CASH','HOURLY_VALUE_EXECUTION_MARKET');
 check(Number.isFinite(currentWeight)&&currentWeight>=0&&currentWeight<=1,'HOURLY_VALUE_NODE_WEIGHT');
 const action=step?.action??'hold',targetWeight=step?.targetWeight??currentWeight,attempt=snapshot.executionAttempt??0;
 check(Number.isSafeInteger(attempt)&&attempt>=0,'HOURLY_VALUE_ATTEMPT');
 return {ready:true,status:'READY',...audit,decision:{action,stance:'normal',targetWeight,strength:null,basisRefs:['hourly-value:'+selection.hash,...(fallback?['hourly-fallback:'+fallback.hash]:[])],authority:'MODEL_FINAL',confidence:null,probabilities:null,provider:'hourly-value-forest',vibeRefs:[],hourlyValue:{selectionHash:selection.hash,reviewHash:state?.hash??null,executionKey:(state?.executionKey??'hourly-value:'+selection.hash)+(fallback?':rejected-exit':'')+(steps.length>1?':step:'+completedSteps:'')+(attempt?':retry:'+attempt:''),selectedMarket:selection.selected.market,executionMarket:step?.market??null,stepsHash:hashInputPackage(steps),stepIndex:completedSteps,...(fallback?{fallbackHash:fallback.hash}:{})}}};
}
