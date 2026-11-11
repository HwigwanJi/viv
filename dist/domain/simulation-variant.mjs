import {createDecisionStrategyGraph,createPortfolioDecisionStrategyGraph,createDecisionStrategyNode,compileStrategyGraph,strategyGraphHash} from './strategy-graph.mjs';
import {strategyPlanWithGraph} from './mind-strategy-plan.mjs';
import {disabledExternalKnowledge} from './external-knowledge-policy.mjs';
import {assertMindDocument,mindDocumentHash} from './mind-manifest.mjs';
import {createMultiAssetEventScalpingGraph} from './multi-asset-event-runtime.mjs';
const check=(ok,message)=>{if(!ok)throw Object.assign(new Error(message),{code:'SIMULATION_VARIANT',status:409});};
export function buildSimulationVariant(source,spec,{now,owner='simulation-owner'}={}){
 check(spec&&Object.keys(spec).every(k=>['preset','knowledge','disabledNodes','weights','graph','instrumentPolicy'].includes(k))&&['CURRENT','MIXED','VIBE','QUANT'].includes(spec.preset)&&typeof spec.knowledge==='boolean','실험 구성과 뉴스 사용 여부를 선택하세요.');
 check(!Object.hasOwn(spec,'instrumentPolicy')||['FIXED','UNIVERSE_CURRENT','EACH_ASSET'].includes(spec.instrumentPolicy),'전략의 종목 적용 방식을 선택하세요.');
 const manifest=structuredClone(source),originalHash=mindDocumentHash(source);
 const executionScope=source.data.strategyPlan?.graph?.executionScope,multiEvent=executionScope?.kind==='EACH_ASSET',portfolio=!multiEvent&&source.data.strategyPlan?.scope?.universe==='MIND_UNIVERSE';
 check(!(portfolio||multiEvent)||spec.graph||spec.preset!=='VIBE','다종목 전략의 JEV 판단은 후보 평가와 결정 부품에 직접 연결하세요.');
 let graph=spec.graph?structuredClone(spec.graph):spec.preset==='CURRENT'?structuredClone(source.data.strategyPlan?.graph):multiEvent?createMultiAssetEventScalpingGraph({mode:spec.preset==='MIXED'?'JEV':'QUANT',timeframe:executionScope.timeframe,maxCandidates:executionScope.maxCandidates}):portfolio?createPortfolioDecisionStrategyGraph({jev:spec.preset==='MIXED'}):createDecisionStrategyGraph({preset:spec.preset,moduleId:'BTC_DOC9'});
 check(graph?.schemaVersion===2,'현재 전략을 먼저 실행 그래프로 발행하거나 실험 구성을 선택하세요.');
 const disabled=spec.disabledNodes??[],weights=spec.weights??[];check(Array.isArray(disabled)&&new Set(disabled).size===disabled.length&&disabled.length<=24&&Array.isArray(weights)&&weights.length<=24,'변경할 부품을 한 번씩 선택하세요.');
 for(const nodeId of disabled){const node=graph.nodes.find(n=>n.id===nodeId);check(node&&['QUANT','VIBE'].includes(node.type),'퀀트·JEV 판단 부품을 선택하세요. 위험 한도와 주문은 유지합니다.');const outputs=graph.edges.filter(e=>e.from.nodeId===nodeId);check(outputs.length>0&&outputs.every(e=>graph.nodes.find(n=>n.id===e.to.nodeId)?.type==='DECISION_MIXER'),'이 부품을 끄려면 결정 결합에 다른 판단을 연결하세요.');for(const edge of outputs)graph.nodes.find(n=>n.id===edge.to.nodeId).config.weights.find(w=>w.nodeId===nodeId).value=0;}
 for(const weight of weights){check(weight&&Object.keys(weight).length===3&&typeof weight.mixerId==='string'&&typeof weight.nodeId==='string'&&Number.isFinite(weight.value)&&weight.value>=0&&weight.value<=1,'결합 비중은 0~1로 입력하세요.');const mixer=graph.nodes.find(n=>n.id===weight.mixerId&&n.type==='DECISION_MIXER'),target=mixer?.config.weights.find(w=>w.nodeId===weight.nodeId);check(target&&!disabled.includes(weight.nodeId),'결합에 연결된 활성 판단의 비중을 선택하세요.');target.value=weight.value;}
 const vibes=graph.nodes.filter(n=>n.type==='VIBE');
 compileStrategyGraph(graph);
 const plan=strategyPlanWithGraph(source.data.strategyPlan,graph),graphHash=strategyGraphHash(graph);
 const eachAsset=graph.executionScope?.kind==='EACH_ASSET',eventGraph=graph.nodes.some(n=>n.type==='INPUT'&&n.config.kind==='MICROSTRUCTURE'),instrumentPolicy=eachAsset?'EACH_ASSET':eventGraph?'UNIVERSE_CURRENT':spec.instrumentPolicy;
 check(spec.instrumentPolicy!=='EACH_ASSET'||eachAsset,'종목별 평가 범위를 그래프에서 먼저 설정하세요.');
 if(Object.hasOwn(spec,'instrumentPolicy')&&plan.scope.universe!=='MIND_UNIVERSE'){if(instrumentPolicy==='UNIVERSE_CURRENT')plan.scope.instrumentPolicy=instrumentPolicy;else delete plan.scope.instrumentPolicy;}
 const policySuffix=eachAsset?'-each-asset':Object.hasOwn(spec,'instrumentPolicy')?'-'+(instrumentPolicy==='UNIVERSE_CURRENT'?'universe':'fixed'):'';
 plan.status='APPROVED';plan.approval={required:true,enabled:true,approvedAt:now,approvedBy:owner};plan.planVersionId='experiment-'+graphHash.slice(0,24)+policySuffix;
 manifest.data.strategyPlan=plan;manifest.data.externalKnowledge=spec.knowledge?(source.data.externalKnowledge?.enabled?structuredClone(source.data.externalKnowledge):{...disabledExternalKnowledge(),enabled:true,mode:'subscribed',sourceTypes:['news','macro-release','research'],maxAgeHours:720,maxItems:8}):{...structuredClone(source.data.externalKnowledge??disabledExternalKnowledge()),enabled:false};
 manifest.id='experiment-'+originalHash.slice(0,12)+'-'+graphHash.slice(0,12)+'-'+(spec.knowledge?'news':'price')+policySuffix;manifest.availableAt=now;manifest.provenance.createdAt=now;
 assertMindDocument(manifest);return {manifest,change:{sourceManifestHash:originalHash,graphHash,preset:spec.preset,...(eachAsset||Object.hasOwn(spec,'instrumentPolicy')?{instrumentPolicy}:{}),knowledge:spec.knowledge,disabledNodes:[...disabled],weights:structuredClone(weights),authority:'SIMULATION_ONLY',acceptedAt:now,acceptedBy:owner}};
}
