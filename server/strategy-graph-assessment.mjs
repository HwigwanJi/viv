import {assertMindDocument,mindDocumentHash} from '../dist/domain/mind-manifest.mjs';
import {compileStrategyGraph} from '../dist/domain/strategy-graph.mjs';
import {assertStrategyEvaluation} from '../dist/domain/mind-strategy-plan.mjs';
import {mindRunEvidenceHash} from './mind-observation.mjs';
const iso=v=>typeof v==='string'&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString()===v;

/** Whole-mind returns remain distinct from controlled per-node attribution. */
export function strategyGraphLearningSummary(manifest,runs,{now,manifests=[manifest]}={}){
 assertMindDocument(manifest);const plan=manifest.data.strategyPlan;if(plan?.schemaVersion!==2)return null;
 const compiled=compileStrategyGraph(plan.graph),nodes=plan.graph.nodes.filter(n=>n.type==='COMBINER'&&n.config.mode==='LEARNED_REVIEW');
 if(!nodes.length)return {graphHash:compiled.graphHash,status:'FIXED_WEIGHTS',nodes:[]};
 const matching=[],excluded=[];
 for(const run of runs??[]){
  if(run.profileId!==manifest.scope.profileId)continue;
  const evaluation=run.rawRequest?.state?.strategyEvaluation;
  if(evaluation?.graphEvaluation?.graphHash!==compiled.graphHash)continue;
  try{const saved=manifests.find(m=>m.id===run.manifestId);if(!saved||saved.scope.profileId!==manifest.scope.profileId||run.manifestHash!==mindDocumentHash(saved)||!iso(now)||!iso(run.decisionAt)||run.decisionAt>now)throw new Error('POLICY_VERSION_MISMATCH');assertStrategyEvaluation(evaluation,{manifest:saved,marketAsOf:run.asOf,instrumentId:run.instrumentId,now});}catch{excluded.push({runId:run.id,reason:'FIXED_EXECUTION_SOURCE_REQUIRED'});continue;}
  const observation=run.observation,matured=observation&&iso(observation.period?.end)&&iso(observation.observedAt)&&observation.period.end<=observation.observedAt&&observation.observedAt<=now&&observation.runId===run.id&&observation.source?.runHash===mindRunEvidenceHash(run);
  matching.push({runId:run.id,status:matured?'MATURED_MIND_OUTCOME':'AWAITING_OBSERVATION'});
 }
 return {graphHash:compiled.graphHash,status:'CONTROLLED_COMPARISON_REQUIRED',asOf:now,nodes:nodes.map(n=>({nodeId:n.id,weightVersionId:n.config.weightVersionId,appliedWeights:structuredClone(n.config.weights),observedRunCount:matching.length,maturedMindOutcomeCount:matching.filter(r=>r.status==='MATURED_MIND_OUTCOME').length,controlledSampleCount:0,minimumControlledSamples:n.config.learning.minSamples,status:'AWAITING_CONTROLLED_OUTCOMES',proposal:null})),runs:matching,excluded};
}
