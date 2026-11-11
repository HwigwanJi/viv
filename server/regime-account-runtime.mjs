import {runRegimeProgram} from './regime-program-runtime.mjs';
import {processHourlyValueAccount} from './hourly-value-live.mjs';
import {processHourlyScreenAccount} from './hourly-screen-runtime.mjs';
import {isHourlyValueGraph} from '../dist/domain/hourly-value-graph.mjs';
import {isHourlyScreenGraph} from '../dist/domain/hourly-pullback.mjs';
import {hashInputPackage as hash} from '../dist/domain/workspace.mjs';

/** Selection is above the existing strategy drivers; every child receives the same account/order ports. */
export async function processRegimeAccount({program,models,controller,children,readInputs,classify,readOwn,readOrders,hasPosition,sourceFor,execute,runCanonical,clock,executionMode,ledgerHash}){
 if(!['PAPER','LIVE'].includes(executionMode))throw Object.assign(Error('실행 모드를 지정하세요.'),{code:'REGIME_EXECUTION_MODE'});
 return runRegimeProgram({program,models,...controller,readInputs,classify,clock,
  readOwn:async()=>{const own=await readOwn(),orders=await readOrders();return {hasPosition:hasPosition(own),hasOpenOrders:orders.some(o=>!['FILLED','CANCELLED','REJECTED','CANCELLED_BEFORE_SEND'].includes(o.state)),hasUnknownOrders:orders.some(o=>['UNKNOWN','SUBMITTING','RECONCILING'].includes(o.state)),providerPending:own.providerPending===true};},
  runStrategy:async({model,selection,assertSelection})=>{
   const previous=await children.load(model.id),runtime=previous?.epoch===selection.epoch?structuredClone(previous.runtime):{},graph=model.policy.data.strategyPlan.graph;
   let persistedHash=previous?.epoch===selection.epoch?hash(previous.runtime):null;
   const save=async(kind,evidence)=>{const runtimeHash=hash(runtime);if(kind==='REGIME_CHILD_COMPLETED'&&runtimeHash===persistedHash)return;const result=await children.save({id:model.id,modelHash:model.contentHash,epoch:selection.epoch,runtime:structuredClone(runtime),kind,evidence,selection,at:clock()});persistedHash=runtimeHash;return result;};
   const dispatch=async signal=>{await assertSelection(signal.action??signal.evaluation?.output.decision?.action);return execute({...signal,regimeSelection:{...selection,childGraphHash:model.source.graphHash,childManifestHash:model.source.manifestHash}});};
   let owned=await readOwn();
   const scopedReadOwn=async market=>{owned=await readOwn(market);return owned;};
   const args={manifest:model.policy,graph,runtime,clock,readOwn:scopedReadOwn,readOrders,source:await sourceFor(model),save,execute:dispatch,hasPosition:()=>hasPosition(owned),executionMode,ledgerHash};
   let result;
   if(isHourlyValueGraph(graph))result=await processHourlyValueAccount(args);
   else if(isHourlyScreenGraph(graph))result=await processHourlyScreenAccount(args);
   else{if(typeof runCanonical!=='function')throw Object.assign(Error('공용 퀀트·JEV 실행기를 연결하세요.'),{code:'REGIME_CANONICAL_DRIVER_REQUIRED'});result=await runCanonical({...args,selection,assertSelection});}
   await save('REGIME_CHILD_COMPLETED',{result,inputStateHash:hash(runtime)});return result;
  }});
}
