import {assertRegimeProgram,regimeChoices,resolveRegimeModel,regimeTargetMembers} from '../dist/domain/regime-program.mjs';
import {regimeProgramGraphHash,isRegimeProgramGraph} from '../dist/domain/regime-program-graph.mjs';
import {graphRequiresJev,strategyGraphHash} from '../dist/domain/strategy-graph.mjs';
import {mindDocumentHash} from '../dist/domain/mind-manifest.mjs';
import {eventAutomationScope} from './automated-trading.mjs';
const check=(v,c,m)=>{if(!v)throw Object.assign(Error(m),{code:c,status:409});};
export const programBinding=m=>m?.data?.strategySettings?.strategyProgram;
export function defaultProgramAllocations(targets){return Object.fromEntries(targets.map(t=>{const members=regimeTargetMembers(t),base=Math.floor(10000/members.length);return [t.id,Object.fromEntries(members.map((m,i)=>[m.id,i===members.length-1?10000-base*i:base]))];}));}
export function resolveProgramDeployment(manifest,w){
 const binding=programBinding(manifest),program=(w.regimePrograms??[]).find(p=>p.id===binding?.programId&&p.contentHash===binding.programHash);check(binding?.schemaVersion===1&&program&&Object.keys(binding).every(k=>['schemaVersion','programId','programHash','allocations'].includes(k)),'PROGRAM_POLICY_PIN','승인 정책에 연결한 라우터 원문을 확인하세요.');assertRegimeProgram(program);
 check(isRegimeProgramGraph(manifest.data.strategyPlan.graph)&&regimeProgramGraphHash(manifest.data.strategyPlan.graph)===regimeProgramGraphHash(program.graph),'PROGRAM_GRAPH_PIN','발행한 노드와 저장한 라우터 연결이 다릅니다.');
 const resources=[...(w.strategyModels??[]),...(w.mindPresets??[])],targets=[...new Set(regimeChoices(program).map(c=>resolveRegimeModel(program,c.id,resources)))],scopes=[];
 check(binding.allocations&&Object.keys(binding.allocations).length===targets.length,'PROGRAM_ALLOCATION','모든 실행 대상의 구성원 배분을 지정하세요.');
 const membersByTarget=new Map(targets.map(target=>{
  const members=regimeTargetMembers(target),shares=binding.allocations[target.id];check(shares&&Object.keys(shares).length===members.length&&members.every(m=>Number.isSafeInteger(shares[m.id])&&shares[m.id]>0)&&Object.values(shares).reduce((a,b)=>a+b,0)===10000,'PROGRAM_ALLOCATION','묶음 구성원의 배분 합계는 100%여야 합니다.');
  for(const m of members){check(!programBinding(m.manifest)&&m.manifest.data.strategyPlan?.graph&&!isRegimeProgramGraph(m.manifest.data.strategyPlan.graph),'PROGRAM_RECURSION','실행 대상에는 매매 전략을 연결하세요. 라우터의 순환 실행은 허용하지 않습니다.');const graph=m.manifest.data.strategyPlan.graph;check(graph.nodes.some(n=>n.type==='ORDER'&&n.config.execution==='ACCOUNT')&&graph.triggers.includes('market_event'),'PROGRAM_MEMBER_ORDER','구성원의 계좌 주문 부품과 시장 이벤트 실행을 설정하세요.');m.scope=eventAutomationScope(m.manifest);m.shareBps=shares[m.id];m.graphHash=strategyGraphHash(graph);m.manifestHash=mindDocumentHash(m.manifest);scopes.push(m.scope);}
  return [target.id,members];
 }));
 const instrumentIds=[...new Set(scopes.flatMap(s=>s.instrumentIds))],quoteCurrency=scopes[0].quoteCurrency;check(scopes.every(s=>s.quoteCurrency===quoteCurrency)&&instrumentIds.length<=500,'PROGRAM_ACCOUNT_SCOPE','한 운용 묶음에는 같은 결제 통화의 전략을 연결하세요.');
 const scope={instrumentIds,marketIds:instrumentIds.map(v=>v.slice('crypto:upbit:'.length)),instrumentId:instrumentIds[0],market:instrumentIds[0].slice('crypto:upbit:'.length),quoteCurrency,timeframe:'1h',decisionIntervalMs:program.classifier.periodMs},requiresJev=program.classifier.kind==='JEV'||targets.some(t=>membersByTarget.get(t.id).some(m=>graphRequiresJev(m.manifest.data.strategyPlan.graph)));
 const estimatedJevCallsPerDay=(program.classifier.kind==='JEV'?Math.ceil(86400000/program.classifier.periodMs):0)+Math.max(...targets.map(t=>membersByTarget.get(t.id).reduce((sum,m)=>sum+m.manifest.data.strategyPlan.graph.nodes.filter(n=>['JEV_QUESTION','VIBE'].includes(n.type)).length*Math.ceil(86400000/(m.scope.decisionIntervalMs??parseFloat(m.scope.timeframe)*(m.scope.timeframe.endsWith('h')?3600000:m.scope.timeframe.endsWith('d')?86400000:60000))),0)));
 const details={estimatedJevCallsPerDay,programId:program.id,programHash:program.contentHash,name:program.name,version:program.version??1,requiresJev,periodMs:program.classifier.periodMs,handover:'DRAIN',choices:regimeChoices(program).map(c=>{const t=resolveRegimeModel(program,c.id,resources);return {...c,targetId:t.id,targetName:t.name,targetHash:t.contentHash,members:membersByTarget.get(t.id).map(m=>({id:m.id,name:m.name,shareBps:m.shareBps,manifestHash:m.manifestHash,graphHash:m.graphHash}))};})};
 return {binding,program,targets,resources,membersByTarget,scope,requiresJev,details};
}
