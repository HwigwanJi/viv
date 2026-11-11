import {hashInputPackage} from '../dist/domain/workspace.mjs';
import {strategyGraphHash} from '../dist/domain/strategy-graph.mjs';
import {inspectPortfolioCandidate} from '../dist/domain/portfolio-promotion-gate.mjs';

export function monthlyPortfolioMandateActive(policy,now){
 return policy?.status==='ENABLED'&&policy.config?.mode==='LIVE'&&!!policy.portfolioPlanId&&policy.mandate?.durationDays===30&&['STRATEGY','MODEL','WEIGHTS'].every(v=>policy.mandate.discretion?.includes(v))&&policy.config.startsAt<=now&&now<policy.config.endsAt&&Date.parse(policy.config.endsAt)-Date.parse(policy.config.startsAt)===30*86400000;
}
export function monthlyPortfolioScopeHash(config){
 const {manifestId,manifestHash,graphHash,requiresJev,...scope}=config;
 return hashInputPackage(scope);
}
export async function readMonthlyPortfolioCandidate(db,owner,activationId,eventId){
 const row=await db.prepare("SELECT body FROM live_automation_events WHERE owner_id=? AND activation_id=? AND id=? AND kind='MANAGED_MODEL_CANDIDATE_VERIFIED'").bind(owner,activationId,eventId).first();
 return row?JSON.parse(row.body):null;
}
export async function monthlyPortfolioRefreshAllowed({db,owner,policy,authorization:auth,config,now}){
 if(auth?.kind!=='MONTHLY_PORTFOLIO'||!monthlyPortfolioMandateActive(policy,now)||auth.mandateId!==policy.portfolioPlanId||auth.profileId!==policy.config.profileId||auth.authorizedAt!==policy.userConfirmedAt||auth.modelHash!==config.graphHash||monthlyPortfolioScopeHash(config)!==monthlyPortfolioScopeHash(policy.config))return false;
 const stored=await readMonthlyPortfolioCandidate(db,owner,policy.id,auth.candidateEventId),c=stored?.candidate;
 return stored?.role==='CONFIRMATORY'&&stored.trialId===auth.trialId&&stored.scopeHash===monthlyPortfolioScopeHash(config)&&c?.metricsHash===auth.metricsHash&&c.modelHash===auth.modelHash&&c.baselineModelHash===policy.config.graphHash&&strategyGraphHash(stored.graph)===c.modelHash&&inspectPortfolioCandidate(c,{mandateId:policy.portfolioPlanId,now}).eligible;
}
