import {assessHourlyTrial} from '../dist/domain/hourly-model-learning.mjs';
import {hashInputPackage} from '../dist/domain/workspace.mjs';
import {portfolioCandidateMetricsHash} from '../dist/domain/portfolio-promotion-gate.mjs';
import {verifyHourlyShadowLedger} from './hourly-learning-shadow.mjs';
import {strategyGraphHash} from '../dist/domain/strategy-graph.mjs';

export const hourlyPromotionMandateId=(policy,head)=>policy.portfolioPlanId??'hourly:'+policy.id+':'+head.authorization.at;
/** Configuration and the first real model evaluation have separate, idempotent evidence. */
export async function recordHourlyPromotion({db,owner,policy,manifest,head,trial,appliedAt,now}){
 const graph=manifest.data.strategyPlan.graph,model=graph.nodes.find(n=>n.type==='MODEL'&&n.config.family==='HOURLY_VALUE_FOREST')?.config.model;
 if(policy.status!=='ENABLED'||policy.pendingStrategyUpdate||model?.hash!==trial.modelHashes.candidate||policy.config.graphHash!==strategyGraphHash(graph)||policy.lastStrategyUpdate?.status!=='APPLIED')throw Error('PORTFOLIO_PROMOTION_CURRENT_MODEL');
 const comparison=assessHourlyTrial(trial);if(comparison.status!=='READY_TO_APPLY')throw Error('PORTFOLIO_PROMOTION_TRIAL');
 const verification=Object.fromEntries(Object.entries(trial.arms).map(([kind,arm])=>[kind,verifyHourlyShadowLedger(arm)])),arm=trial.arms.candidate,accounts=[...arm.campaign.closedCampaigns.map(c=>c.account),arm.campaign.account];
 let slippageAmount=0,slippageIncluded=true;
 for(const a of accounts)for(const r of a.receipts){if(!r.fills.length)continue;const q=r.executionEvidence.referenceQuote,mid=q?(Number(q.bidPrice)+Number(q.askPrice))/2:NaN;if(!(mid>0)){slippageIncluded=false;continue;}for(const f of r.fills)slippageAmount+=Math.max(0,(f.side==='buy'?Number(f.price)-mid:mid-Number(f.price))*Number(f.quantity));}
 const preservedLimits=['accountId','quoteCurrency','marketIds','capitalLimit','perOrderLimit','dailyLossLimit','maxTradesPerDay','minIntervalMs'].every(k=>hashInputPackage({value:policy.config[k]??null})===hashInputPackage({value:trial.policyPins[k]??null}));
 const m=comparison.metrics,recovery=m.candidate.recovery,mandateId=hourlyPromotionMandateId(policy,head),candidate={mandateId,activationId:policy.id,modelHash:model.hash,baselineModelHash:trial.modelHashes.baseline,protocolHash:hashInputPackage({trialId:trial.id,startsAt:trial.startsAt,endsAt:trial.endsAt,sourceGraphHash:trial.sourceGraphHash,policyPins:trial.policyPins,rowsRef:trial.rowsRef,modelRef:trial.modelRef}),datasetHash:hashInputPackage(verification),frozenAt:trial.createdAt,validationFrom:trial.startsAt,validationTo:trial.endsAt,selectionUsedValidation:false,evidenceOrigin:'OBSERVED_EVENT_PAPER',completePricePath:Object.values(m).every(v=>v.missingIntervals===0),completedRoundTrips:arm.closedTrades,withinMandateLimits:preservedLimits,metrics:{netReturn:m.candidate.netReturn,baselineNetReturn:m.baseline.netReturn,benchmarkNetReturn:m.btc.netReturn,mdd:m.candidate.mdd,baselineMdd:m.baseline.mdd,benchmarkMdd:m.btc.mdd,recoveryStatus:recovery.status,observedRecoveryHours:(recovery.observedMs??recovery.maxRecoveryMs)/3600000},costs:{feesIncluded:true,slippageIncluded,modelCallsIncluded:true,feeAmount:Number(arm.feesPaid),slippageAmount,modelCallAmount:0,modelCostBasis:'LOCAL_FOREST_NO_EXTERNAL_CALL',executionPriceBasis:'OBSERVED_DEPTH_WITH_REFERENCE_MID',liquidationFeesIncludedInNAV:true}};
 candidate.metricsHash=portfolioCandidateMetricsHash(candidate);
 const row=await db.prepare("SELECT id,recorded_at,body FROM live_automation_events WHERE owner_id=? AND activation_id=? AND kind='HOURLY_VALUE_EVALUATED' AND recorded_at>=? ORDER BY recorded_at DESC LIMIT 1").bind(owner,policy.id,appliedAt).first(),event=row?JSON.parse(row.body):null,selected=event?.evaluation?.trace?.find(t=>t.type==='MODEL')?.output?.selection;
 const runtimeVerified=selected?.modelHash===model.hash&&event.evaluation.graphHash===policy.config.graphHash;
 const receipt={mandateId,activationId:policy.id,trialId:trial.id,modelHash:model.hash,metricsHash:candidate.metricsHash,graphHash:policy.config.graphHash,status:'APPLIED',executionMode:'LIVE',origin:'PRODUCT_AUTO_PROMOTION',appliedAt,runtimeVerified,runtimeVerifiedAt:runtimeVerified?row.recorded_at:null,runtimeEventId:runtimeVerified?row.id:null};
 const id='promotion:'+hashInputPackage({owner,activationId:policy.id,trialId:trial.id}),body=JSON.stringify({candidate,receipt});
 await db.prepare("INSERT INTO live_automation_events(id,owner_id,activation_id,kind,recorded_at,body) VALUES(?,?,?,'MANAGED_MODEL_AUTO_APPLIED',?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body,recorded_at=excluded.recorded_at WHERE json_extract(live_automation_events.body,'$.receipt.runtimeVerified')=0").bind(id,owner,policy.id,now,body).run();
 return receipt;
}
