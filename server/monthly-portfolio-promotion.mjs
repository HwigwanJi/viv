import {decodeLiveEventBody} from './live-event-body.mjs';
import {hashInputPackage} from '../dist/domain/workspace.mjs';
import {strategyGraphHash} from '../dist/domain/strategy-graph.mjs';
import {inspectPortfolioCandidate} from '../dist/domain/portfolio-promotion-gate.mjs';
import {WorkspaceRepository} from './repository.mjs';
import {monthlyPortfolioMandateActive,monthlyPortfolioScopeHash,readMonthlyPortfolioCandidate} from './monthly-portfolio-authorization.mjs';

async function recordApplied({db,owner,policy,now}){
 const update=policy.lastStrategyUpdate,auth=update?.refreshAuthorization;
 if(update?.status!=='APPLIED'||auth?.kind!=='MONTHLY_PORTFOLIO')return null;
 const verified=await readMonthlyPortfolioCandidate(db,owner,policy.id,auth.candidateEventId),candidate=verified?.candidate;
 if(verified?.scopeHash!==monthlyPortfolioScopeHash(policy.config)||candidate?.metricsHash!==auth.metricsHash||candidate.modelHash!==policy.config.graphHash||!inspectPortfolioCandidate(candidate,{mandateId:policy.portfolioPlanId,now}).eligible)throw Error('MONTHLY_PROMOTION_APPLIED_SCOPE');
 const manifest=await new WorkspaceRepository(db).readObject(owner,'mindManifests',policy.config.manifestId);
 if(strategyGraphHash(manifest.data.strategyPlan.graph)!==candidate.modelHash)throw Error('MONTHLY_PROMOTION_CURRENT_GRAPH');
 const rows=(await db.prepare("SELECT id,recorded_at,body FROM live_automation_events WHERE owner_id=? AND activation_id=? AND kind='DECISION_SUMMARY' AND recorded_at>=? ORDER BY recorded_at DESC LIMIT 30").bind(owner,policy.id,update.appliedAt).all()).results??[];
 const executed=rows.find(row=>{const e=decodeLiveEventBody(row.body).evaluation;return e?.graphHash===policy.config.graphHash&&e.output?.ready===true&&['ACCOUNT','LIVE'].includes(e.output.execution);});
 const receipt={mandateId:policy.portfolioPlanId,activationId:policy.id,trialId:verified.trialId,modelHash:candidate.modelHash,metricsHash:candidate.metricsHash,graphHash:policy.config.graphHash,status:'APPLIED',executionMode:'LIVE',origin:'PRODUCT_AUTO_PROMOTION',appliedAt:update.appliedAt,runtimeVerified:!!executed,runtimeVerifiedAt:executed?.recorded_at??null,runtimeEventId:executed?.id??null},id='monthly-promotion:'+hashInputPackage({owner,activationId:policy.id,metricsHash:candidate.metricsHash});
 await db.prepare("INSERT INTO live_automation_events(id,owner_id,activation_id,kind,recorded_at,body) VALUES(?,?,?,'MANAGED_MODEL_AUTO_APPLIED',?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body,recorded_at=excluded.recorded_at WHERE json_extract(live_automation_events.body,'$.receipt.runtimeVerified')=0").bind(id,owner,policy.id,now,JSON.stringify({candidate,receipt})).run();
 return receipt;
}

/** Called by the product runner inside its existing, active monthly mandate. */
export async function processMonthlyPortfolioPromotion({db,env,owner,policy,clock=()=>new Date().toISOString(),readCandidate=env.READ_MANAGED_PORTFOLIO_CANDIDATE,options={}}){
 const now=clock();if(!monthlyPortfolioMandateActive(policy,now))return {state:'NO_ACTIVE_MONTHLY_MANDATE'};
 const receipt=await recordApplied({db,owner,policy,now});
 if(receipt&&!receipt.runtimeVerified)return {state:'WAITING_FIRST_MODEL_EVALUATION',receipt};
 if(policy.pendingStrategyUpdate)return {state:'WAITING_STRATEGY_UPDATE'};
 if(typeof readCandidate!=='function')return {state:'NO_COMPLETED_CANDIDATE_SOURCE',receipt};
 const verified=await readCandidate({owner,policy,now});if(!verified)return {state:'OBSERVING',receipt};
 const {candidate,graph,trialId,role}=verified;
 if(role!=='CONFIRMATORY'||strategyGraphHash(graph)!==candidate?.modelHash||candidate.baselineModelHash!==policy.config.graphHash||!inspectPortfolioCandidate(candidate,{mandateId:policy.portfolioPlanId,now}).eligible)throw Error('MONTHLY_PROMOTION_CANDIDATE_REQUIRED');
 const candidateEventId='monthly-candidate:'+hashInputPackage({owner,activationId:policy.id,metricsHash:candidate.metricsHash}),body={...verified,scopeHash:monthlyPortfolioScopeHash(policy.config)};
 await db.prepare("INSERT OR IGNORE INTO live_automation_events(id,owner_id,activation_id,kind,recorded_at,body) VALUES(?,?,?,'MANAGED_MODEL_CANDIDATE_VERIFIED',?,?)").bind(candidateEventId,owner,policy.id,now,JSON.stringify(body)).run();
 const repository=options.repository??new WorkspaceRepository(db),workspace=await repository.readOperational(owner),key='monthly-'+hashInputPackage({activationId:policy.id,metricsHash:candidate.metricsHash}),authorization={kind:'MONTHLY_PORTFOLIO',profileId:policy.config.profileId,mandateId:policy.portfolioPlanId,authorizedAt:policy.userConfirmedAt,trialId,modelHash:candidate.modelHash,metricsHash:candidate.metricsHash,candidateEventId};
 const url='http://127.0.0.1:4905/api/workspace/automated-trading/update-strategy',request=new Request(url,{method:'POST',headers:{'Content-Type':'application/json',Origin:new URL(url).origin,'oai-authenticated-user-id':owner},body:JSON.stringify({activationId:policy.id,expectedGraphHash:policy.config.graphHash,graph,expectedRevision:workspace.revision,idempotencyKey:key,userAction:'LIVE_STRATEGY_UPDATE'})}),{handleAutomatedTradingAPI}=await import('./automated-trading.mjs');
 const response=await (options.updateStrategy??handleAutomatedTradingAPI)(request,env,{...options,repository,monthlyPortfolioRefresh:authorization,now:()=>Date.parse(clock())}),result=await response.json();
 if(!response.ok||!result.ok)throw Object.assign(Error(result.message??'MONTHLY_PROMOTION_QUEUE_FAILED'),{code:result.code??'MONTHLY_PROMOTION_QUEUE_FAILED'});
 return {state:'STRATEGY_UPDATE_QUEUED',updateId:result.update.id,modelHash:candidate.modelHash};
}
