import {hashInputPackage} from '../dist/domain/workspace.mjs';
import {approvedResearchRules} from '../dist/domain/research.mjs';

export class PortfolioViewError extends Error {
  constructor(code,message,status=400){super(message);this.name='PortfolioViewError';this.code=code;this.status=status;this.resetCursor=code==='PORTFOLIO_CURSOR_STALE';}
}
const check=(value,code,message,status)=>{if(!value)throw new PortfolioViewError(code,message,status);};
const list=v=>Array.isArray(v)?v:[],find=(items,id)=>list(items).find(v=>v.id===id),finite=v=>typeof v==='number'&&Number.isFinite(v);
const id=v=>typeof v==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/.test(v),time=v=>typeof v==='string'&&Number.isFinite(Date.parse(v)),clip=(v,n=240)=>typeof v==='string'?v.slice(0,n):'';
const VIEWS=['overview','decisions','trades','experiences','knowledge'];
const byTime=(a,b)=>b._time-a._time||(a.id===b.id?0:a.id<b.id?1:-1);
const stamp=v=>time(v)?Date.parse(v):0;
const providerLabel=v=>({binance:'Binance',okx:'OKX'})[v]??null;
function queryInput(query){
  const q=query instanceof URLSearchParams?Object.fromEntries(query):query;
  check(q&&typeof q==='object'&&!Array.isArray(q)&&Object.keys(q).every(k=>['comparisonId','profileId','view','pageSize','cursor','status','search'].includes(k)),'INVALID_PORTFOLIO_QUERY','조회 범위와 조건을 확인하세요.');
  const profileId=q.profileId??'all',view=q.view??'overview',pageSize=q.pageSize===undefined?20:typeof q.pageSize==='string'&&/^(10|20|50)$/.test(q.pageSize)?Number(q.pageSize):q.pageSize;
  check(id(q.comparisonId)&&(profileId==='all'||id(profileId))&&VIEWS.includes(view)&&[10,20,50].includes(pageSize),'INVALID_PORTFOLIO_QUERY','선택 실험·프로필·보기와 페이지 크기를 확인하세요.');
  check(q.cursor===undefined||typeof q.cursor==='string'&&q.cursor.length>0&&q.cursor.length<=2048,'PORTFOLIO_CURSOR_INVALID','조회 위치를 다시 선택하세요.');
  check(q.status===undefined||typeof q.status==='string'&&q.status.length<=64&&!/[\u0000-\u001f]/.test(q.status),'INVALID_PORTFOLIO_QUERY','상태 필터를 확인하세요.');
  check(q.search===undefined||typeof q.search==='string'&&q.search.length<=120&&!/[\u0000-\u001f]/.test(q.search),'INVALID_PORTFOLIO_QUERY','검색어는 120자 이내로 입력하세요.');
  return {comparisonId:q.comparisonId,profileId,view,pageSize,cursor:q.cursor,status:q.status?.trim().toUpperCase()||null,search:q.search?.trim().toLocaleLowerCase()||null};
}
function sourceFor(record,frame,group){
  const input=record?.inputPackage??{},historical=group.experimentType!=='FORWARD_PAPER',manifest=input.marketData?.manifest;
  const provider=input.marketProvider??manifest?.provider??(manifest?.loaderVersion==='okx-closed-rest-v1'?'okx':manifest?.loaderVersion==='binance-closed-rest-v1'?'binance':null)??(frame.sourceSnapshotId?.startsWith('okx-rest-')?'okx':frame.sourceSnapshotId?.startsWith('binance-rest-')||historical?'binance':null);
  return {provider,providerLabel:providerLabel(provider),origin:input.marketOrigin??null,loaderVersion:input.marketLoaderVersion??manifest?.loaderVersion??(historical?'archived-dataset-v1':null),sourceHash:frame.sourceHash??null,sourceSnapshotId:frame.sourceSnapshotId??null,asOf:frame.asOf,symbol:provider==='okx'?'BTC-USDT':provider==='binance'?'BTCUSDT':null};
}
function tradeProvider(fill,record,group){
  const input=record?.inputPackage??{},supplied=fill.quote?.provider??input.marketProvider;
  if(supplied!==undefined&&supplied!==null)return providerLabel(supplied)?supplied:null;
  const loader=input.marketData?.manifest?.loaderVersion;
  if(loader==='binance-closed-rest-v1')return 'binance';
  if(loader==='okx-closed-rest-v1')return 'okx';
  const frame=[...list(group.history),...(group.round?[group.round]:[])].find(f=>f.asOf===input.asOf&&/^[a-f0-9]{64}$/.test(input.sourceHash??'')&&f.sourceHash===input.sourceHash&&list(f.members).some(m=>m.deploymentId===record?.deploymentId&&m.decisionId===record?.id));
  return frame?sourceFor(record,frame,group).provider:null;
}
function decisionRow(record,member,workspace){
  const d=find(workspace.deployments,member.deploymentId),p=find(workspace.investmentProfiles,member.profileId),answer=record.jevResponse?.answers?.action??record.jevResponse?.response?.answers?.action;
  return {id:record.id,asOf:record.inputPackage?.asOf??null,createdAt:record.createdAt??null,profileId:member.profileId,profileName:p?.name??null,deploymentId:member.deploymentId,deploymentName:d?.name??null,action:record.decision?.action??null,stance:record.decision?.stance??null,status:record.decisionStatus??null,outcomeType:record.outcomeType??null,model:record.decision?.model??null,marketProvider:record.inputPackage?.marketProvider??null,choiceConfidence:answer?.confidence??record.decision?.choiceConfidence??null,distribution:answer?.probabilities??record.decision?.choiceDistribution??null,memoryVersionId:record.memoryVersionId??record.inputPackage?.memoryVersionId??null,inputPackageHash:record.inputPackageHash??null};
}
function membersFor(workspace,group){
  const accountIds=new Set(),capitalKeys=new Set();
  return list(group.members).map(member=>{
    const deployment=find(workspace.deployments,member.deploymentId),account=find(workspace.accounts,member.accountId),profile=find(workspace.investmentProfiles,member.profileId);
    check(deployment&&account&&profile&&deployment.investmentProfileId===member.profileId&&deployment.accountId===account.id&&deployment.experimentId===group.experimentId&&deployment.experimentType===group.experimentType,'PORTFOLIO_SCOPE_MISMATCH','실험의 구성원·계좌·모드를 대조하세요.',409);
    check(account.baseCurrency==='USDT'&&finite(account.initialEquity)&&account.initialEquity>0,'PORTFOLIO_CAPITAL_INVALID','계좌의 기준 통화와 실제 초기 자금을 확인하세요.',409);
    let capitalKey='account:'+account.id,shared=null,sleeve=null;
    if(deployment.sharedAccountId){shared=find(workspace.sharedAccounts,deployment.sharedAccountId);sleeve=list(shared?.sleeves).find(s=>s?.id===deployment.sleeveId&&s.deploymentId===deployment.id);check(shared&&sleeve,'PORTFOLIO_SHARED_REFERENCE','공식 공유계좌의 배분 참조를 확인하세요.',409);capitalKey='sleeve:'+shared.id+':'+sleeve.id;}
    check(!accountIds.has(account.id)&&!capitalKeys.has(capitalKey),'PORTFOLIO_DUPLICATE_CAPITAL','같은 계좌·배분 자금을 중복 합산할 수 없습니다.',409);accountIds.add(account.id);capitalKeys.add(capitalKey);
    return {...member,deployment,account,profile,shared,sleeve,capitalKey};
  });
}
function frameRows(workspace,group,members,frame){
  const allMembers=list(group.members),observations=list(frame.observations);
  check(frame.status==='COMPLETED'&&time(frame.asOf)&&list(frame.members).length===allMembers.length&&allMembers.every(m=>frame.members.some(r=>r.deploymentId===m.deploymentId&&r.stage==='COMPLETED')),'PORTFOLIO_FRAME_INCOMPLETE','공통 봉의 전체 완료 기록을 확인하세요.',409);
  check(observations.length===allMembers.length&&new Set(observations.map(o=>o.deploymentId)).size===observations.length,'PORTFOLIO_FRAME_INCOMPLETE','같은 봉의 계좌 평가 기록을 확인하세요.',409);
  const prices=observations.map(o=>o.markPrice);check(prices.every(p=>finite(p)&&p>0)&&prices.every(p=>p===prices[0]),'PORTFOLIO_MIXED_MARK','공통 봉의 같은 기준가로 평가한 기록을 선택하세요.',409);
  const rows=members.map(member=>{
    const observation=observations.find(o=>o.deploymentId===member.deploymentId),checkpoint=frame.members.find(m=>m.deploymentId===member.deploymentId),record=find(workspace.decisionRecords,checkpoint?.decisionId);
    check(observation&&['cash','btcQuantity','equity','feesPaid'].every(k=>finite(observation[k])&&observation[k]>=0)&&time(observation.asOf)&&Math.abs(observation.equity-observation.cash-observation.btcQuantity*observation.markPrice)<=1e-6,'PORTFOLIO_FRAME_VALUES','저장된 현금·보유·공통 기준가 평가를 대조하세요.',409);
    check(record&&record.deploymentId===member.deploymentId&&record.inputPackage?.experimentId===group.experimentId&&record.inputPackage?.experimentType===group.experimentType&&record.inputPackage?.asOf===frame.asOf&&record.inputPackage?.sourceHash===frame.sourceHash&&(!frame.sourceContextHash||record.inputPackage.comparisonContext?.sourceContextHash===frame.sourceContextHash),'PORTFOLIO_FRAME_SOURCE','공통 봉과 당시 결정의 시세·입력 근거 해시를 대조하세요.',409);
    return {profileId:member.profileId,profileName:member.profile.name,deploymentId:member.deploymentId,deploymentName:member.deployment.name,accountId:member.accountId,accountingMode:member.shared?'shared-sleeve':'isolated',sharedAccountId:member.shared?.id??null,sleeveId:member.sleeve?.id??null,initialCapital:member.account.initialEquity,equity:observation.equity,cash:observation.cash,btcQuantity:observation.btcQuantity,pnl:observation.equity-member.account.initialEquity,totalReturn:observation.equity/member.account.initialEquity-1,feesPaid:observation.feesPaid,asOf:frame.asOf,accountAsOf:observation.asOf,markPrice:observation.markPrice,actualSource:sourceFor(record,frame,group)};
  });
  const providers=new Set(rows.map(r=>r.actualSource.provider));check(providers.size<=1,'PORTFOLIO_MIXED_SOURCE','같은 시세 공급원의 공통 봉을 선택하세요.',409);return rows;
}
function baselineRows(members){return members.map(m=>({profileId:m.profileId,profileName:m.profile.name,deploymentId:m.deploymentId,deploymentName:m.deployment.name,accountId:m.accountId,accountingMode:m.shared?'shared-sleeve':'isolated',sharedAccountId:m.shared?.id??null,sleeveId:m.sleeve?.id??null,initialCapital:m.account.initialEquity,equity:m.account.initialEquity,cash:m.account.initialEquity,btcQuantity:0,pnl:null,totalReturn:null,feesPaid:0,asOf:null,accountAsOf:null,markPrice:null,actualSource:null}));}
function total(rows,frame,completedBars){
  const sum=key=>rows.reduce((n,r)=>n+r[key],0),initialCapital=sum('initialCapital'),equity=sum('equity');
  return {basis:frame?'COMPLETED_ROUND':'INITIAL_CAPITAL',hasPerformance:!!frame,valuationBasis:frame?'ROUND_FINAL_BALANCES_AT_COMMON_BAR_CLOSE_V1':'ACCOUNT_INITIAL_EQUITY',asOf:frame?.asOf??null,accountAsOf:frame?rows.map(r=>r.accountAsOf).sort().at(-1):null,sourceHash:frame?.sourceHash??null,sourceSnapshotId:frame?.sourceSnapshotId??null,actualSource:rows[0]?.actualSource??null,initialCapital,equity,cash:sum('cash'),btcQuantity:sum('btcQuantity'),pnl:frame?equity-initialCapital:null,totalReturn:frame?equity/initialCapital-1:null,feesPaid:sum('feesPaid'),completedBars,profileCount:rows.length};
}
function scopedRecords(workspace,group,members){const ids=new Set(members.map(m=>m.deploymentId));return list(workspace.decisionRecords).filter(r=>ids.has(r.deploymentId)&&r.inputPackage?.experimentId===group.experimentId&&r.inputPackage?.experimentType===group.experimentType);}
function usableMemory(item,version,member,asOf){
  const before=v=>time(v)&&Date.parse(v)<=Date.parse(asOf),d=member.deployment;
  return before(version.availableAt)&&before(item.availableAt)&&((item.experimentId===d.experimentId&&(item.deploymentId===d.id||list(item.approvedDeploymentIds).includes(d.id)))||list(item.authorizations).some(a=>a.deploymentId===d.id&&a.experimentId===d.experimentId&&before(a.authorizedAt)&&list(item.approvedDeploymentIds).includes(d.id)&&list(item.approvedExperimentIds).includes(d.experimentId)));
}
function effectiveMemoryAvailableAt(item,version){return time(item.availableAt)&&time(version.availableAt)?new Date(Math.max(Date.parse(item.availableAt),Date.parse(version.availableAt))).toISOString():null;}
function memoryInfo(workspace,group,member,records){
  const applied=find(workspace.memoryVersions,member.memoryVersionId),latest=find(workspace.memoryVersions,member.profile.currentMemoryVersionId),own=records.filter(r=>r.investmentProfileId===member.profileId).sort((a,b)=>stamp(a.createdAt)-stamp(b.createdAt)),lastSent=own.filter(r=>r.jevRequest?.state).at(-1),candidates=list(workspace.memoryCandidates).filter(c=>c.investmentProfileId===member.profileId&&list(c.experienceIds).some(id=>list(workspace.experiences).some(e=>e.id===id&&e.experimentId===group.experimentId)));
  return {latestMemory:{appliedVersionId:applied?.id??null,appliedVersion:applied?.version??null,latestVersionId:latest?.id??null,latestVersion:latest?.version??null,approvedItemCount:list(latest?.items).length,lastSentItemCount:lastSent?list(lastSent.jevRequest.state.approvedPersonalMemory).length:0,lastSentAsOf:lastSent?.inputPackage?.asOf??null},knowledge:{candidateCount:candidates.length,validatedCount:candidates.filter(c=>c.status==='VALIDATED').length,approvedCandidateCount:candidates.filter(c=>c.status==='APPROVED').length,appliedItemCount:list(applied?.items).length,availableItemCount:list(applied?.items).filter(item=>usableMemory(item,applied,member,group.cursorAt)).length}};
}
function pageRows(workspace,group,members,records,view,now){
  const byDeployment=new Map(members.map(m=>[m.deploymentId,m])),recordIds=new Set(records.map(r=>r.id)),profileIds=new Set(members.map(m=>m.profileId));
  if(view==='overview')return [];
  if(view==='decisions')return records.map(r=>({...decisionRow(r,byDeployment.get(r.deploymentId),workspace),_time:stamp(r.inputPackage.asOf),_search:[r.decision?.action,r.decision?.stance,r.decision?.model,byDeployment.get(r.deploymentId).profile.name,byDeployment.get(r.deploymentId).deployment.name].join(' ')}));
  if(view==='trades'){
    const seen=new Set();return members.flatMap(m=>list(m.account.ledger).filter(f=>recordIds.has(f.decisionId)&&(!f.deploymentId||f.deploymentId===m.deploymentId)).map(f=>{
      const key=f.officialFillId?'shared:'+m.shared?.id+':'+f.officialFillId:'account:'+m.account.id+':'+f.id;if(seen.has(key))return null;seen.add(key);
      return {id:f.id,at:f.at,profileId:m.profileId,profileName:m.profile.name,deploymentId:m.deploymentId,deploymentName:m.deployment.name,accountId:m.account.id,decisionId:f.decisionId,side:f.side,status:'FILLED',quantity:f.quantity,fillPrice:f.fillPrice,referencePrice:f.referencePrice,gross:f.gross,fee:f.fee,realizedPnl:f.realizedPnl,sharedAccountId:m.shared?.id??null,officialFillId:f.officialFillId??null,marketProvider:tradeProvider(f,find(records,f.decisionId),group),_time:stamp(f.at),_search:[f.side,m.profile.name,m.deployment.name].join(' ')};
    }).filter(Boolean));
  }
  const experiences=list(workspace.experiences).filter(e=>byDeployment.has(e.deploymentId)&&e.experimentId===group.experimentId&&e.experimentType===group.experimentType&&recordIds.has(e.decisionId));
  if(view==='experiences')return experiences.map(e=>({id:e.id,occurredAt:e.occurredAt,recordedAt:e.recordedAt,profileId:e.investmentProfileId,profileName:byDeployment.get(e.deploymentId).profile.name,deploymentId:e.deploymentId,decisionId:e.decisionId,status:e.status,outcomeType:e.outcomeType,selectedAction:e.selectedAction,summary:clip(e.summary,500),observationDueAt:e.observationDueAt,outcomeObservedAt:e.outcomeObservedAt,evaluationCompletedAt:e.evaluationCompletedAt,observation:e.observation?{asOf:e.observation.asOf,horizonHours:e.observation.horizonHours??null,priceReturn:finite(e.observation.price)&&e.referencePrice>0?e.observation.price/e.referencePrice-1:null,fixedDecision:e.observation.performance?.fixedDecision??false,netReturn:e.observation.performance?.netReturn??null,sourceKind:e.observation.source?.kind??null}:null,_time:stamp(e.occurredAt),_search:[e.summary,e.selectedAction,byDeployment.get(e.deploymentId).profile.name].join(' ')}));
  const experienceIds=new Set(experiences.map(e=>e.id)),rows=[];
  const versions=new Map();for(const m of members)for(const versionId of [m.memoryVersionId,m.profile.currentMemoryVersionId]){const version=find(workspace.memoryVersions,versionId);if(version?.investmentProfileId===m.profileId)versions.set(version.id,{version,member:m});}
  const publishedCandidates=new Set([...versions.values()].flatMap(({version,member})=>list(version.items).map(item=>JSON.stringify([member.profileId,item.candidateId]))));
  for(const c of list(workspace.memoryCandidates).filter(c=>profileIds.has(c.investmentProfileId)&&list(c.experienceIds).some(id=>experienceIds.has(id))&&!(c.status==='APPROVED'&&publishedCandidates.has(JSON.stringify([c.investmentProfileId,c.id])))))rows.push({id:'candidate:'+c.id,entityId:c.id,kind:'CANDIDATE',profileId:c.investmentProfileId,title:c.title,preview:clip(c.text),status:c.status,knowledgeType:c.knowledgeType??'HYPOTHESIS',experienceCount:new Set(list(c.experienceIds)).size,independentSampleCount:c.evidenceSummary?.independentSampleCount??null,availableAt:null,memoryVersionId:null,usage:null,_time:stamp(c.createdAt),_search:[c.title,c.text,c.knowledgeType].join(' ')});
  for(const {version,member} of versions.values())for(const item of list(version.items)){const applied=member.memoryVersionId===version.id,available=applied&&usableMemory(item,version,member,group.cursorAt);rows.push({id:'memory:'+version.id+':'+item.candidateId,entityId:item.candidateId,kind:'APPROVED_MEMORY',profileId:member.profileId,title:item.title,preview:clip(item.text),status:'APPROVED',knowledgeType:item.knowledgeType??'HYPOTHESIS',experienceCount:new Set(list(item.experienceIds)).size,independentSampleCount:item.evidenceSummary?.independentSampleCount??null,availableAt:effectiveMemoryAvailableAt(item,version),memoryVersionId:version.id,memoryVersion:version.version,usage:available?'AVAILABLE':applied?'APPLIED_WAITING':'APPROVED_UNAPPLIED',sourceExperimentId:item.experimentId??null,_time:stamp(version.approvedAt),_search:[item.title,item.text,item.knowledgeType].join(' ')});}
  for(const n of list(workspace.knowledge?.items))rows.push({id:'note:'+n.id,entityId:n.id,kind:'COMMON_NOTE',profileId:null,title:n.title,preview:clip(n.text),status:String(n.status).toUpperCase(),version:n.version,knowledgeType:null,experienceCount:null,independentSampleCount:null,availableAt:n.review?.reviewedAt??null,memoryVersionId:null,usage:'SHARED_SOURCE',_time:stamp(n.updatedAt),_search:[n.title,n.text,n.sourceTitle].join(' ')});
  if(workspace.research){const scopes=['shared',...members.flatMap(m=>['profile:'+m.profileId,'deployment:'+m.deploymentId])];for(const r of approvedResearchRules(workspace.research,now,{scopes})){const original=list(workspace.research.rules).find(v=>v.id===r.id&&v.version===r.version);rows.push({id:'rule:'+r.id+':'+r.version,entityId:r.id,kind:'RESEARCH_RULE',profileId:original?.scope?.startsWith('profile:')?original.scope.slice(8):null,title:r.title,preview:clip(r.text),status:'APPROVED',version:r.version,knowledgeType:null,experienceCount:null,independentSampleCount:null,availableAt:original?.availableAt??null,memoryVersionId:null,usage:'SHARED_SOURCE',scope:original?.scope??null,_time:stamp(original?.approvedAt),_search:[r.title,r.text].join(' ')});}}
  return rows;
}
function encodeCursor(body){const checksum=hashInputPackage(body);return btoa(JSON.stringify({...body,checksum})).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');}
function decodeCursor(value){try{check(/^[A-Za-z0-9_-]+$/.test(value),'PORTFOLIO_CURSOR_INVALID','조회 위치가 올바르지 않습니다.');const parsed=JSON.parse(atob(value.replace(/-/g,'+').replace(/_/g,'/'))),{checksum,...body}=parsed;check(body.v===1&&typeof body.scopeHash==='string'&&Number.isSafeInteger(body.revision)&&body.revision>=0&&Number.isFinite(body.last?.time)&&typeof body.last?.id==='string'&&body.last.id.length<=500&&Object.keys(body).length===4&&hashInputPackage(body)===checksum,'PORTFOLIO_CURSOR_INVALID','조회 위치의 범위와 검증값을 확인하세요.');return body;}catch(error){if(error instanceof PortfolioViewError)throw error;throw new PortfolioViewError('PORTFOLIO_CURSOR_INVALID','조회 위치를 다시 선택하세요.');}}

/** Authenticated owner data is supplied by the caller. This function performs no writes or network requests. */
export function buildPortfolioView(workspace,query,{now=new Date().toISOString()}={}){
  const q=queryInput(query);check(time(now)&&Number.isSafeInteger(workspace?.revision),'INVALID_PORTFOLIO_CONTEXT','저장 버전과 조회 시각을 확인하세요.');
  const group=find(workspace.comparisons,q.comparisonId);check(group,'PORTFOLIO_NOT_FOUND','선택한 실험을 찾을 수 없습니다.',404);
  check(['FORWARD_PAPER','HISTORICAL_FUNCTIONAL_REPLAY'].includes(group.experimentType),'PORTFOLIO_SCOPE_MISMATCH','지원하는 실험 모드를 선택하세요.',409);
  check(list(group.members).length>=1&&group.members.length<=3&&new Set(group.members.map(m=>m.profileId)).size===group.members.length&&new Set(group.members.map(m=>m.deploymentId)).size===group.members.length,'PORTFOLIO_SCOPE_MISMATCH','서로 다른 프로필·운용 봇의 실험 구성을 확인하세요.',409);
  const all=membersFor(workspace,group),members=q.profileId==='all'?all:all.filter(m=>m.profileId===q.profileId);check(members.length,'PORTFOLIO_NOT_FOUND','이 실험의 투자 프로필을 선택하세요.',404);
  const frames=list(group.history).filter(f=>f.status==='COMPLETED').sort((a,b)=>stamp(a.asOf)-stamp(b.asOf)),frame=frames.at(-1),records=scopedRecords(workspace,group,members);
  const financial=frame?frameRows(workspace,group,members,frame):baselineRows(members),summary=total(financial,frame,group.completedBars??0);
  const profiles=financial.map((row,i)=>{const member=members[i],latest=records.filter(r=>r.deploymentId===member.deploymentId).sort((a,b)=>stamp(a.createdAt)-stamp(b.createdAt)).at(-1);return {...row,status:member.deployment.runtimeStatus,runtimeStatus:member.deployment.runtimeStatus,lastDecision:latest?decisionRow(latest,member,workspace):null,...memoryInfo(workspace,group,member,records)};});
  const progress={roundId:group.round?.id??null,asOf:group.round?.asOf??null,active:!!group.round,leaseActive:finite(group.round?.lease?.until)&&group.round.lease.until>Date.parse(now),completed:list(group.round?.members).filter(m=>m.stage==='COMPLETED').length,total:all.length,members:list(group.round?.members).map(m=>({deploymentId:m.deploymentId,profileId:all.find(a=>a.deploymentId===m.deploymentId)?.profileId??null,stage:m.stage,decisionId:m.decisionId??null,outcome:m.outcome??null,error:m.error?{code:m.error.code,message:clip(m.error.message,500)}:null}))};
  const curve=frames.map(f=>({roundId:f.id,...total(frameRows(workspace,group,members,f),f,group.completedBars??0)}));
  let rows=pageRows(workspace,group,members,records,q.view,now).filter(r=>(!q.status||q.status==='ALL'||String(r.status).toUpperCase()===q.status||String(r.outcomeType).toUpperCase()===q.status||String(r.side).toUpperCase()===q.status)&&(!q.search||r._search.toLocaleLowerCase().includes(q.search))).sort(byTime);
  const scope={comparisonId:group.id,experimentId:group.experimentId,experimentType:group.experimentType,profileId:q.profileId,profileIds:members.map(m=>m.profileId),deploymentIds:members.map(m=>m.deploymentId),memberProfiles:all.map(m=>({profileId:m.profileId,profileName:m.profile.name,deploymentId:m.deploymentId,deploymentName:m.deployment.name}))};
  const scopeHash=hashInputPackage({scope,view:q.view,status:q.status,search:q.search,pageSize:q.pageSize}),count=rows.length;
  if(q.cursor){check(q.view!=='overview','PORTFOLIO_CURSOR_INVALID','목록 보기에서 조회 위치를 선택하세요.');const cursor=decodeCursor(q.cursor);check(cursor.scopeHash===scopeHash,'PORTFOLIO_CURSOR_SCOPE','조회 범위가 변경되었습니다. 첫 페이지부터 확인하세요.');check(cursor.revision===workspace.revision,'PORTFOLIO_CURSOR_STALE','기록이 갱신되었습니다. 첫 페이지부터 다시 불러오세요.',409);const index=rows.findIndex(r=>r._time===cursor.last.time&&r.id===cursor.last.id);check(index>=0,'PORTFOLIO_CURSOR_INVALID','조회 위치의 기록을 찾을 수 없습니다.');rows=rows.slice(index+1);}
  const visible=rows.slice(0,q.pageSize),last=visible.at(-1),hasMore=rows.length>q.pageSize;
  return {schemaVersion:1,revision:workspace.revision,scope,summary,profiles,progress,curve,curveCoverage:{retainedFrames:frames.length,truncated:(group.completedBars??0)>frames.length},page:{view:q.view,items:visible.map(({_time,_search,...r})=>r),total:count,pageSize:q.pageSize,hasMore,nextCursor:hasMore?encodeCursor({v:1,scopeHash,revision:workspace.revision,last:{time:last._time,id:last.id}}):null,revision:workspace.revision}};
}
