import {hashInputPackage} from '../dist/domain/workspace.mjs';
import {applyPortfolioSimulationFrame,finalizePortfolioReport} from '../dist/domain/portfolio-simulation.mjs';
import {derivePortfolioSimulationMetrics,portfolioEvaluationRows} from '../dist/domain/portfolio-simulation-metrics.mjs';
import {portfolioExecutionView} from './portfolio-simulation-engine.mjs';

/** A consented resend uses the original portfolio fill and report pipeline. */
export async function preparePortfolioTransportRetryResult({head,inspection,output,review,now,store,owner,env,rawRows,reportEvidence}){
 const {frame,prepared,account,bundle}=inspection,applied=applyPortfolioSimulationFrame({core:head.core,account,bundle,prepared,evaluation:output.evaluation,jevCallCount:output.jevCallCount,now}),after=structuredClone(head);
 after.core=applied.state;after.status=applied.state.status==='COMPLETED'?'COMPLETED':'PAUSED';after.revision++;after.updatedAt=now;after.lastError=null;
 after.attempt={...head.attempt,status:'COMPLETED',completedAt:now,jevCalled:output.jevCalled};after.execution={sequence:frame.sequence,asOf:frame.asOf,phase:'COMPLETED',evaluation:portfolioExecutionView(output.evaluation.graphEvaluation)};after.transportRetries.at(-1).status='COMPLETED';after.transportRetries.at(-1).completedAt=now;
 const {executionInputs,...evaluation}=output.evaluation,rows=applied.rows;
 const retry={contractVersion:review.contractVersion,reviewHash:review.reviewHash,manualRetryAttempt:1,originalFailureHash:review.originalFailureHash,unknownChargePossible:true};
 rows.decisions=rows.decisions.map(row=>({...row,transportRetry:structuredClone(retry)}));
 rows.raw=rawRows(frame.sequence,{contractVersion:'PORTFOLIO_FRAME_EVIDENCE_V1',frame,preparedInputHash:prepared.inputHash,datasetHash:bundle.indexSha256,sourceRefs:Object.values(executionInputs).flatMap(i=>i.sourceRefs),strategyEvaluation:evaluation,graphEvaluation:evaluation.graphEvaluation,provider:output.provider,providerStageCount:output.providerStages.length,transportRetry:retry},env);
 if(after.status==='COMPLETED'){
  after.report=finalizePortfolioReport(after.core);
  const [curve,decisions,raw]=await Promise.all(['curve','decisions','raw'].map(kind=>store.allRows(owner,head.id,kind)));
  const derived=derivePortfolioSimulationMetrics({curve:[...curve,...rows.curve],decisions:[...decisions,...rows.decisions],evaluations:portfolioEvaluationRows([...raw,...rows.raw])});
  after.report.metrics={...after.report.metrics,...derived};after.report.evidence=await reportEvidence(store,owner,after,rows);after.report.reportHash=hashInputPackage(after.report);
 }
 return {after,rows};
}
