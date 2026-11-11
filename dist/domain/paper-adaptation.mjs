import {hashInputPackage} from './workspace.mjs';
import {compileStrategyGraph,strategyGraphHash} from './strategy-graph.mjs';

export const PAPER_ADAPTATION_VERSION='paper-episode-allocation-learning-v1';
const clone=structuredClone,HASH=/^[a-f0-9]{64}$/,ID=/^[a-zA-Z0-9][a-zA-Z0-9_.:@/-]{0,199}$/;
const iso=v=>typeof v==='string'&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString()===v;
const num=v=>typeof v==='number'&&Number.isFinite(v),ratio=v=>num(v)&&v>=0&&v<=1;
const check=(v,code,message)=>{if(!v)throw Object.assign(new Error(message),{code,status:409});};
const evidenceRef=v=>v?.contractVersion==='STRATEGY_LEARNING_CONTENT_CHUNKS_V1'&&HASH.test(v.hash??'')&&Number.isSafeInteger(v.chunkCount)&&v.chunkCount>0&&Number.isSafeInteger(v.byteCount)&&v.byteCount>0;
function forwardValidation(v,sourceHash){
 return v===undefined||v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).every(k=>['status','count','minimumEpisodes','sourceManifestHash','applicationAuthority','approvalEvidence'].includes(k))&&['WAITING_EPISODES','OBSERVED'].includes(v.status)&&Number.isSafeInteger(v.count)&&v.count>=0&&v.count<=6&&v.minimumEpisodes===6&&v.sourceManifestHash===sourceHash&&v.applicationAuthority==='BOUNDED_FORWARD_PAPER_EXPERIMENT'&&evidenceRef(v.approvalEvidence);
}
export function validatePaperAdaptation(value){
 if(value===undefined)return true;
 const keys=['contractVersion','enabled','autoApply','mixerNodeId','quantNodeId','vibeNodeId','minEpisodes','maxWeightStep','drawdownPenalty','minImprovement','authorizedAt','authorizedBy','sourceManifestHash','status','evaluatedEpisodeIds','lastEvidence','lastResult','pendingManifestId','forwardValidation','forwardTrialRef'];
 return value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).every(k=>keys.includes(k))&&value.contractVersion===PAPER_ADAPTATION_VERSION&&typeof value.enabled==='boolean'&&typeof value.autoApply==='boolean'&&['mixerNodeId','quantNodeId','vibeNodeId','authorizedBy'].every(k=>ID.test(value[k]??''))&&value.minEpisodes===6&&num(value.maxWeightStep)&&value.maxWeightStep>0&&value.maxWeightStep<=.1&&value.drawdownPenalty===.5&&value.minImprovement===.0001&&iso(value.authorizedAt)&&HASH.test(value.sourceManifestHash??'')&&['WAITING_EPISODES','READY','KEEP_CURRENT','HOLDOUT_REJECTED','REVIEW_REQUIRED','APPLIED','POLICY_CHANGED','DISABLED','FORWARD_RUNNING','FORWARD_REJECTED','FORWARD_INTERRUPTED'].includes(value.status)&&Array.isArray(value.evaluatedEpisodeIds)&&value.evaluatedEpisodeIds.length<=10000&&value.evaluatedEpisodeIds.every(v=>HASH.test(v))&&(value.lastEvidence===null||evidenceRef(value.lastEvidence))&&(value.lastResult===null||value.lastResult&&typeof value.lastResult==='object')&&(value.pendingManifestId===null||ID.test(value.pendingManifestId))&&forwardValidation(value.forwardValidation,value.sourceManifestHash)&&(value.forwardTrialRef===undefined||value.forwardTrialRef===null||evidenceRef(value.forwardTrialRef));
}
export function adaptationMixer(graph,{mixerNodeId,quantNodeId,vibeNodeId}){
 compileStrategyGraph(graph);const mixer=graph.nodes.find(n=>n.id===mixerNodeId),quant=graph.nodes.find(n=>n.id===quantNodeId),vibe=graph.nodes.find(n=>n.id===vibeNodeId);
 check(mixer?.type==='DECISION_MIXER'&&mixer.config.mode==='TARGET_BLEND'&&mixer.config.weights.length===2&&quant?.type==='QUANT'&&vibe?.type==='DECISION_ROUTER'&&vibe.config.mode==='CHOICE','ADAPTATION_MIXER','퀀트와 JEV 선택을 결합한 비중 믹서를 선택하세요.');
 const q=mixer.config.weights.find(w=>w.nodeId===quantNodeId),v=mixer.config.weights.find(w=>w.nodeId===vibeNodeId);
 check(q&&v&&q.value+v.value>0,'ADAPTATION_WEIGHTS','연결된 두 비중의 합을 확인하세요.');
 const question=graph.edges.find(e=>e.to.nodeId===vibeNodeId&&e.to.port==='selector'),questionNode=graph.nodes.find(n=>n.id===question?.from.nodeId);
 check(questionNode?.type==='JEV_QUESTION'&&questionNode.config.question.type==='choice','ADAPTATION_QUESTION','선택 라우터에 JEV 질문을 연결하세요.');
 return {mixer,quant,vibe,questionNode,weight:v.value/(q.value+v.value)};
}
export function paperAdaptationEligibility(manifest){
 const graph=manifest?.data?.strategyPlan?.graph;
 if(graph?.schemaVersion!==2||manifest.data.universe.instrumentIds.length!==1||manifest.data.universe.instrumentIds[0]!=='crypto:okx:BTC-USDT')return {eligible:false,reason:'BTC 단일 종목의 퀀트·JEV 비중 믹서를 연결하세요.'};
 const eligible=[];
 for(const mixer of graph.nodes.filter(n=>n.type==='DECISION_MIXER'&&n.config.mode==='TARGET_BLEND'&&n.config.weights.length===2)){
  const upstream=mixer.config.weights.map(w=>graph.nodes.find(n=>n.id===w.nodeId)),quant=upstream.find(n=>n?.type==='QUANT'),vibe=upstream.find(n=>n?.type==='DECISION_ROUTER'&&n.config.mode==='CHOICE');if(!quant||!vibe)continue;
  const binding={mixerNodeId:mixer.id,quantNodeId:quant.id,vibeNodeId:vibe.id};try{adaptationMixer(graph,binding);eligible.push(binding);}catch{}
 }
 return eligible.length===1?{eligible:true,...eligible[0]}:{eligible:false,reason:eligible.length?'학습할 비중 믹서를 하나로 정리하세요.':'퀀트와 JEV 선택을 결합한 비중 믹서를 연결하세요.'};
}
export function createPaperAdaptation({graph,manifestHash,enabled=true,autoApply=false,mixerNodeId='rebound-mix',quantNodeId='full',vibeNodeId='review-route',maxWeightStep=.1,ownerId,now}){
 adaptationMixer(graph,{mixerNodeId,quantNodeId,vibeNodeId});
 const value={contractVersion:PAPER_ADAPTATION_VERSION,enabled,autoApply,mixerNodeId,quantNodeId,vibeNodeId,minEpisodes:6,maxWeightStep,drawdownPenalty:.5,minImprovement:.0001,authorizedAt:now,authorizedBy:ownerId,sourceManifestHash:manifestHash,status:enabled?'WAITING_EPISODES':'DISABLED',evaluatedEpisodeIds:[],lastEvidence:null,lastResult:null,pendingManifestId:null};
 check(validatePaperAdaptation(value),'ADAPTATION_SETTINGS','학습 설정과 변경 한도를 확인하세요.');return value;
}
function measure(episodes,weight){
 let equity=1,peak=1,drawdown=0;const rows=[];
 for(const e of episodes){const target=e.quantTarget*(1-weight)+e.vibeTarget*weight;
  // A zero target changes trade timing; fixed-episode fitting cannot evaluate that counterfactual.
  if(target<=0||e.actualTarget<=0)return null;
  const scale=target/e.actualTarget,start=equity;
  for(const point of e.returnPath){const value=start*(1+point.netReturn*scale);if(!(value>0))return null;peak=Math.max(peak,value);drawdown=Math.max(drawdown,1-value/peak);}
  equity=start*(1+e.netReturn*scale);peak=Math.max(peak,equity);drawdown=Math.max(drawdown,1-equity/peak);rows.push({episodeId:e.id,targetWeight:target,scale,netReturn:e.netReturn*scale});
 }
 return {netReturn:equity-1,maxDrawdown:drawdown,score:equity-1-.5*drawdown,episodes:rows};
}
/** Fit allocation only on completed, non-overlapping execution episodes. Trade timing stays frozen. */
export function fitPaperEpisodeWeights({graph,settings,episodes,now}){
 check(validatePaperAdaptation(settings)&&iso(now),'ADAPTATION_INPUT','학습 설정과 현재 시각을 확인하세요.');
 const {weight}=adaptationMixer(graph,settings),seen=new Set(),eligible=[];
 for(const e of episodes){
  check(e&&HASH.test(e.id??'')&&!seen.has(e.id)&&e.manifestHash===settings.sourceManifestHash&&e.graphHash===strategyGraphHash(graph)&&iso(e.entryAt)&&iso(e.exitAt)&&iso(e.observedAt)&&e.entryAt<e.exitAt&&e.exitAt<=e.observedAt&&e.observedAt<=now&&num(e.netReturn)&&ratio(e.actualTarget)&&e.actualTarget>0&&ratio(e.quantTarget)&&ratio(e.vibeTarget)&&Array.isArray(e.returnPath)&&e.returnPath.length>=2&&e.returnPath.every((p,i)=>iso(p.at)&&p.at>=e.entryAt&&p.at<=e.exitAt&&num(p.netReturn)&&(!i||p.at>e.returnPath[i-1].at))&&e.returnPath.at(-1).at===e.exitAt&&Math.abs(e.returnPath.at(-1).netReturn-e.netReturn)<1e-10,'ADAPTATION_EPISODE','동일 정책의 종료된 독립 거래와 비용 후 수익 경로를 확인하세요.');seen.add(e.id);
  check(Math.abs(e.actualTarget-(e.quantTarget*(1-weight)+e.vibeTarget*weight))<1e-8,'ADAPTATION_TARGET','실행 당시 퀀트·JEV 목표 비중과 믹서 출력을 대조하세요.');
  if(!settings.evaluatedEpisodeIds.includes(e.id))eligible.push(clone(e));
 }
 eligible.sort((a,b)=>a.entryAt.localeCompare(b.entryAt));check(eligible.every((e,i)=>!i||e.entryAt>eligible[i-1].exitAt),'ADAPTATION_OVERLAP','서로 겹치지 않는 종료 거래를 사용하세요.');
 const common={contractVersion:PAPER_ADAPTATION_VERSION,objective:'REALIZED_EPISODE_NET_RETURN_MINUS_HALF_CLOSE_PATH_DRAWDOWN',evidenceClass:'FIXED_EXECUTED_EPISODE_ALLOCATION_FIT',timingPolicy:'ACTUAL_ENTRY_EXIT_TIMING_HELD_FIXED',modelWeightTraining:false,providerResponsesReused:false,providerCalls:0,applicationAuthority:'PROPOSAL_FOR_INDEPENDENT_FORWARD_TRIAL',sampleMeaning:'FUNCTIONAL_MINIMUM_NOT_STATISTICAL_SUPERIORITY',sourceManifestHash:settings.sourceManifestHash,sourceGraphHash:strategyGraphHash(graph),createdAt:now,currentWeight:weight,maxWeightStep:settings.maxWeightStep,eligibleCount:eligible.length,minimumEpisodes:6,scope:'ONE_MIND_SINGLE_ASSET_FLAT_TO_FLAT_NO_ADD_OR_PARTIAL_EXIT',counterfactualLimits:['Existing entry and exit times and observed JEV choices are held fixed.','A changed portfolio would require a fresh JEV inference; this fit does not claim a new model response.','Unused opportunities and changed trade timing are outside this allocation fit.','A private baseline/candidate forward trial collects at least six newly closed episodes per arm before policy promotion.']};
 if(eligible.length<6)return {...common,status:'WAITING_EPISODES',remaining:6-eligible.length};
 const cohort=eligible.slice(0,6),training=cohort.slice(0,4),holdout=cohort.slice(4),values=[weight,Math.max(0,weight-settings.maxWeightStep),Math.min(1,weight+settings.maxWeightStep)];
 const candidates=[...new Set(values)].map(w=>({weight:w,training:measure(training,w)})).filter(c=>c.training).sort((a,b)=>b.training.score-a.training.score||Math.abs(a.weight-weight)-Math.abs(b.weight-weight));
 const baseline=candidates.find(c=>c.weight===weight),chosen=candidates[0];check(baseline,'ADAPTATION_BASELINE','현재 비중의 동일 거래 평가를 확인하세요.');
 const selected=chosen.training.score>baseline.training.score+settings.minImprovement?chosen:baseline;
 const validation={baseline:measure(holdout,weight),candidate:measure(holdout,selected.weight)};
 const improvement=validation.candidate?validation.candidate.score-validation.baseline.score:null;
 const status=selected.weight===weight?'KEEP_CURRENT':validation.candidate&&improvement>settings.minImprovement&&validation.candidate.netReturn>=validation.baseline.netReturn-1e-12&&validation.candidate.maxDrawdown<=validation.baseline.maxDrawdown+1e-12?'REVIEW_REQUIRED':'HOLDOUT_REJECTED';
 const next=clone(graph),mixer=next.nodes.find(n=>n.id===settings.mixerNodeId);mixer.config.weights=[{nodeId:settings.quantNodeId,value:1-selected.weight},{nodeId:settings.vibeNodeId,value:selected.weight}];mixer.config.weightVersionId='paper-fit-'+hashInputPackage({source:common.sourceGraphHash,episodes:cohort.map(e=>e.id),weight:selected.weight}).slice(0,24);compileStrategyGraph(next);
 const result={...common,status,selectedWeight:selected.weight,training:{episodeIds:training.map(e=>e.id),candidates,selectionUsesHoldout:false},holdout:{episodeIds:holdout.map(e=>e.id),...validation,scoreImprovement:improvement,...(!validation.candidate?{rejectionReason:'FIXED_EPISODE_ALLOCATION_UNEVALUABLE'}:{})},episodes:cohort,candidateGraph:next,candidateGraphHash:strategyGraphHash(next)};
 return {...result,evidenceHash:hashInputPackage(result)};
}
