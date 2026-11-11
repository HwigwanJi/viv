import {hashInputPackage} from './workspace.mjs';

export const JUDGMENT_FEATURES=Object.freeze(['return_1bar','return_6bar','return_24bar','sma30_distance','volatility24','range24','relative_volume24','high24_distance','own_weight','own_entry_return','log_holding_hours','weight_x_entry_return']);
export const JUDGMENT_ACTIONS=Object.freeze(['EXIT_0','PROBE_20','HOLD_CURRENT','PRESS_60']);
const finite=Number.isFinite,iso=v=>typeof v==='string'&&finite(Date.parse(v))&&new Date(v).toISOString()===v;
const check=(ok,code)=>{if(!ok)throw Object.assign(new Error(code),{code,status:409});};
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join(',')===[...keys].sort().join(',');
const verified=new WeakMap();

export function assertJudgmentModel(m){
 const minute=m?.contractVersion==='minute-market-path-value-forest-v4';
 check(exact(m,['contractVersion','authority','createdAt','instrumentId','features','actions','horizonBars','costs','policy','training','method','trees','hash',...(minute?['timeframe']:[])]),'JUDGMENT_SCHEMA');
 const {hash,...body}=m;check(hash===hashInputPackage(body),'JUDGMENT_HASH');
 const coherent=minute||m.contractVersion==='market-path-value-forest-v3';
 check((coherent?(minute?[6,42]:[6,42,84]).includes(m.horizonBars)&&m.method==='BOOTSTRAPPED_MARKET_PATH_REGRESSION':m.contractVersion==='own-state-value-forest-v2'&&m.horizonBars===6&&m.method==='BOOTSTRAPPED_MULTI_OUTPUT_REGRESSION_TREES')&&m.authority==='PAPER_RESEARCH_ONLY'&&iso(m.createdAt)&&(minute?m.timeframe==='1m'&&['crypto:upbit:KRW-XRP','crypto:upbit:KRW-ETH','crypto:upbit:KRW-SOL'].includes(m.instrumentId):m.instrumentId==='crypto:okx:BTC-USDT')&&JSON.stringify(m.features)===JSON.stringify(JUDGMENT_FEATURES)&&JSON.stringify(m.actions)===JSON.stringify(JUDGMENT_ACTIONS),'JUDGMENT_SCHEMA');
 check(exact(m.costs,['feeBps','slippageBps'])&&Object.values(m.costs).every(v=>finite(v)&&v>=0&&v<=100),'JUDGMENT_COSTS');
 check(exact(m.policy,['riskPenalty','minImprovement','pressMinImprovement','maxPredictedAdverse'])&&Object.values(m.policy).every(v=>finite(v)&&v>=0&&v<=1)&&m.policy.pressMinImprovement>=m.policy.minImprovement,'JUDGMENT_POLICY');
 const t=m.training;check(exact(t,['startAt','endAt','lastLabelAt','sampleCount','publicStateCount','sampleHash','datasetHash','publicSourceHash','role'])&&[t.startAt,t.endAt,t.lastLabelAt].every(iso)&&t.startAt<t.lastLabelAt&&t.lastLabelAt<=t.endAt&&Number.isSafeInteger(t.sampleCount)&&t.sampleCount>=100&&Number.isSafeInteger(t.publicStateCount)&&t.publicStateCount>=0&&t.publicStateCount<=t.sampleCount&&['sampleHash','datasetHash','publicSourceHash'].every(k=>/^[a-f0-9]{64}$/.test(t[k]))&&t.role==='RETROSPECTIVE_DEVELOPMENT','JUDGMENT_TRAINING');
 check(Array.isArray(m.trees)&&m.trees.length>=1&&m.trees.length<=32&&JSON.stringify(m).length<=180000,'JUDGMENT_SIZE');
 for(const tree of m.trees){check(Array.isArray(tree)&&tree.length>=1&&tree.length<=63,'JUDGMENT_TREE_SIZE');const seen=new Set();function visit(index,depth){check(Number.isInteger(index)&&index>=0&&index<tree.length&&!seen.has(index)&&depth<=5,'JUDGMENT_TREE_SIZE');seen.add(index);const n=tree[index];if(exact(n,['values','count'])){check(Number.isSafeInteger(n.count)&&n.count>0&&Array.isArray(n.values)&&n.values.every(finite)&&(coherent?n.values.length===2&&n.values.every(v=>v> -1&&v<=100)&&n.values[1]<=n.values[0]:n.values.length===11&&n.values.slice(0,4).every(v=>v>=-1&&v<=100)&&n.values.slice(4,8).every(v=>v>=0&&v<=1)&&n.values.slice(8).every(v=>v>=0&&v<=1)&&Math.abs(n.values.slice(8).reduce((a,b)=>a+b,0)-1)<1e-8),'JUDGMENT_LEAF');}else{check(exact(n,['feature','threshold','left','right'])&&Number.isInteger(n.feature)&&n.feature>=0&&n.feature<(coherent?8:JUDGMENT_FEATURES.length)&&finite(n.threshold),'JUDGMENT_SPLIT');visit(n.left,depth+1);visit(n.right,depth+1);}}visit(0,0);check(seen.size===tree.length,'JUDGMENT_UNREACHABLE_NODE');}
 return m;
}

/** Causal closed bars plus this account's position, never the public trader's current state. */
export function judgmentFeatures(bars,position,{asOf,decisionAt=asOf,timeframe='4h',instrumentId='crypto:okx:BTC-USDT'}={}){
 check(iso(asOf)&&Array.isArray(bars)&&bars.length>=30&&['4h','1m'].includes(timeframe),'JUDGMENT_HISTORY');const b=bars.slice(-30),end=Date.parse(asOf),step=timeframe==='1m'?60000:14400000;
 check(b.every((r,i)=>Array.isArray(r)&&r.length>=6&&r.slice(0,6).every(finite)&&r[0]+step<=end&&r[1]>0&&r[4]>0&&r[2]>=Math.max(r[1],r[4])&&r[3]<=Math.min(r[1],r[4])&&r[3]>0&&r[5]>=0&&(!i||r[0]-b[i-1][0]===step))&&b.at(-1)[0]+step===end,'JUDGMENT_BAR_TIME');
 check(iso(decisionAt)&&decisionAt>=asOf&&position?.instrumentId===instrumentId&&position.asOf===decisionAt&&finite(position.weight)&&position.weight>=0&&position.weight<=1&&finite(position.equity)&&position.equity>0&&typeof position.hasPosition==='boolean'&&(!position.hasPosition||finite(position.unrealizedReturn)&&iso(position.entryAt)&&position.entryAt<=decisionAt),'JUDGMENT_POSITION');
 const closes=b.map(r=>r[4]),p=closes.at(-1),r=b.slice(-24),returns=closes.slice(-25).slice(1).map((v,i)=>Math.log(v/closes.slice(-25)[i])),mean=returns.reduce((a,v)=>a+v,0)/24,vol=Math.sqrt(returns.reduce((a,v)=>a+(v-mean)**2,0)/24),vmean=b.slice(-25,-1).reduce((a,r)=>a+r[5],0)/24;
 const w=position.weight,u=position.hasPosition?position.unrealizedReturn:0,h=position.hasPosition?(Date.parse(decisionAt)-Date.parse(position.entryAt))/3600000:0;
 const x=[p/closes.at(-2)-1,p/closes.at(-7)-1,p/closes.at(-25)-1,p/(closes.reduce((a,v)=>a+v,0)/30)-1,vol,(Math.max(...r.map(r=>r[2]))-Math.min(...r.map(r=>r[3])))/p,vmean>0?b.at(-1)[5]/vmean:0,p/Math.max(...r.map(r=>r[2]))-1,w,u,Math.log1p(h),w*u];
 check(x.every(finite),'JUDGMENT_FEATURES');return x;
}

export function predictJudgmentModel(model,market,position,{asOf,decisionAt=asOf,executionMode='PAPER'}={}){
 // Cache only an immutable private copy; callers can mutate a graph after evaluation.
 let m=verified.get(model);if(!m){assertJudgmentModel(model);m=structuredClone(model);verified.set(model,m);}
 else {check(model.hash===m.hash&&hashInputPackage(Object.fromEntries(Object.entries(model).filter(([k])=>k!=='hash')))===m.hash,'JUDGMENT_HASH');}
 const fail=reason=>({ready:false,status:'BLOCKED',reasonCodes:[reason]});
 if(executionMode!=='PAPER')return fail('JUDGMENT_RESEARCH_ONLY');
 if(!iso(asOf)||asOf<=m.training.lastLabelAt)return fail('JUDGMENT_TRAINING_CUTOFF');
 let x;try{x=judgmentFeatures(market?.bars,position,{asOf,decisionAt,timeframe:m.timeframe??'4h',instrumentId:m.instrumentId});}catch(e){return fail(e.code??'JUDGMENT_INPUT');}
 const coherent=m.contractVersion!=='own-state-value-forest-v2';
 const paths=[],pred=m.trees.map((tree,k)=>{let n=tree[0],path=[];while(!n.values){path.push({feature:m.features[n.feature],value:x[n.feature],threshold:n.threshold,left:x[n.feature]<=n.threshold});n=tree[x[n.feature]<=n.threshold?n.left:n.right];}paths.push({tree:k,path,leafSamples:n.count});return n.values;}),means=Array.from({length:coherent?2:11},(_,i)=>pred.reduce((s,p)=>s+p[i],0)/pred.length);
 const values=JUDGMENT_ACTIONS.map((action,i)=>{
  let expectedNetReturn=means[i],expectedAdverseLoss=means[i+4];
  if(coherent){
   // Learn market paths once; exact account algebra preserves HOLD/target equivalence as weights drift.
   const fee=m.costs.feeBps/10000,slip=m.costs.slippageBps/10000,w=position.weight,target=[0,.2,null,.6][i];let cash=1-w,quantity=w;
   if(target!==null){const buy=target>w,fill=1+(buy?slip:-slip),loss=buy?fill*(1+fee)-1:1-fill*(1-fee),dq=buy?Math.max(0,(target-w)/(1+target*loss)):Math.max(0,(w-target)/(1-target*loss));quantity+=buy?dq:-dq;cash+=buy?-dq*fill*(1+fee):dq*fill*(1-fee);}
   expectedNetReturn=cash+quantity*(1+means[0])*(1-slip)*(1-fee)-1;expectedAdverseLoss=Math.max(0,1-cash-quantity*(1+means[1])*(1-slip)*(1-fee));
  }
  return {action,expectedNetReturn,expectedAdverseLoss,utility:expectedNetReturn-m.policy.riskPenalty*expectedAdverseLoss};
 });
 // A flat cash account has no market exposure; a regression cannot override that identity.
 if(!position.hasPosition&&position.weight===0)for(const i of [0,2])Object.assign(values[i],{expectedNetReturn:0,expectedAdverseLoss:0,utility:0});
 let selected=2;for(const i of [0,1,3]){const gain=values[i].utility-values[2].utility,threshold=i===3?m.policy.pressMinImprovement:m.policy.minImprovement;if(gain>threshold&&values[i].utility>values[selected].utility&&(i!==3||values[i].expectedNetReturn>0&&values[i].expectedAdverseLoss<=m.policy.maxPredictedAdverse))selected=i;}
 return {ready:true,status:'READY',kind:'NUMBER',unit:'scalar',value:selected,modelHash:m.hash,trainingLabelCutoff:m.training.lastLabelAt,horizonBars:m.horizonBars,authority:m.authority,researchRole:'RETROSPECTIVE_DEVELOPMENT',features:Object.fromEntries(m.features.map((f,i)=>[f,x[i]])),actionValues:values,observedExecutionClassScores:coherent?null:{noNewExecution:means[8],increase:means[9],reduceOrExit:means[10],intentNotObserved:true},...(coherent?{marketPathForecast:{terminalReturn:means[0],minimumReturn:means[1],valuation:'CURRENT_PRICE_TARGET_REBALANCE_AND_TERMINAL_LIQUIDATION'}}:{}),costAssumption:m.costs,treePaths:paths,basisRefs:['judgment-model:'+m.hash]};
}
