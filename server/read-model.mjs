const HOURS = [4,12,24,48,72,168];
const iso = value => new Date(value).toISOString();
export function observationAvailability(workspace,experienceId,{horizonHours=24,now=new Date().toISOString(),historicalDataset}={}){
  const experience=workspace.experiences.find(e=>e.id===experienceId);
  if(!experience||experience.experienceType!=='INVESTMENT_DECISION'||!HOURS.includes(horizonHours))return null;
  const start=Date.parse(experience.occurredAt),end=start+horizonHours*3600000,forward=experience.experimentType==='FORWARD_PAPER';
  const source=forward?workspace.marketSnapshots?.filter(s=>s.marketData?.dataset).at(-1)?.marketData.dataset:historicalDataset;
  const available=(source?.bars??[]).filter(b=>b[0]>=start&&b[0]+14400000<=end&&b[0]+14400000<=Date.parse(now));
  const complete=available.length===horizonHours/4&&available.every((b,i)=>b[0]===start+i*14400000);
  const observed=experience.observation&&experience.observation.asOf===iso(end);
  const status=observed?'OBSERVED':Date.parse(now)<end?'WAITING_TIME':complete?'READY':forward?'READY_TO_FETCH':'DATA_MISSING';
  return {experienceId,horizonHours,status,dueAt:iso(end),requestedEndAt:iso(end),availableThrough:source?.endAt??null,missingBars:Math.max(0,horizonHours/4-available.length),sourceKind:forward?'PUBLIC_API':'HISTORICAL_DATASET',message:status==='WAITING_TIME'?'관측 기간이 끝나면 확정 봉을 수집합니다.':status==='READY_TO_FETCH'?'공개 시세에서 후속 확정 봉을 수집할 수 있습니다.':status==='DATA_MISSING'?'관측 기간의 연속된 확정 봉을 확인하세요.':status==='OBSERVED'?'후속 관측을 보관했습니다.':'후속 확정 봉이 준비됐습니다.'};
}
export function decisionReadModel(workspace,id){
  const record=workspace.decisionRecords.find(r=>r.id===id);if(!record)return null;
  const p=record.inputPackage,find=(key,id)=>workspace[key]?.find(x=>x.id===id),deployment=find('deployments',record.deploymentId);
  const fills=workspace.accounts.flatMap(a=>a.ledger).filter(f=>f.decisionId===record.id);
  const experiences=workspace.experiences.filter(e=>e.decisionId===record.id);
  const candidates=workspace.memoryCandidates.filter(c=>c.experienceIds.some(id=>experiences.some(e=>e.id===id)));
  const start=Date.parse(p.decisionStartedAt),end=Date.parse(p.decisionCompletedAt);
  return {record,profile:find('investmentProfiles',record.investmentProfileId),deployment,fills,experiences,candidates,
    model:{requested:record.jevRequest?.model??null,actual:record.decision.model,questions:record.jevResponse?.answers??null,usage:record.jevResponse?.usage??record.decision.usage??null,processingMs:Number.isFinite(start)&&Number.isFinite(end)?Math.max(0,end-start):null,explanationSource:'SELECTED_EVIDENCE_AND_EXECUTION_RULES'},
    evidence:{notes:p.approvedNotes??[],rules:p.approvedResearchRules??[],memories:p.approvedMemory??[],questionCriteria:record.jevRequest?.questions??null},
    versions:{profile:record.investmentProfileVersionId,strategy:record.strategyVersionId,preset:record.riskPresetVersionId,memory:record.memoryVersionId,model:record.mechanicalModelVersionId,question:record.decisionContractVersionId,fusion:record.fusionPolicyVersionId,execution:p.executionPolicyVersionId},
    reproducibility:{asOf:p.asOf,marketProvider:p.marketProvider??null,marketOrigin:p.marketOrigin??null,marketLoaderVersion:p.marketLoaderVersion??null,inputPackageHash:record.inputPackageHash,sourceHash:p.sourceHash,marketDataRef:p.marketDataRef??null,requestId:record.requestId,experimentType:p.experimentType,policyMode:p.policyMode}};
}
