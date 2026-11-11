import {positionInputMetric} from '../domain/position-input.mjs';
import {microstructureMetric} from '../domain/microstructure-input.mjs';
import {getInstrument} from '../domain/instruments.mjs';

export function strategyInputNodeLabel(node){
 if(node?.type!=='INPUT')return null;
 if(node.label&&!['확정 시세','INPUT',node.id].includes(node.label))return node.label;
 const config=node.config||{};
 if(config.kind==='MICROSTRUCTURE')return microstructureMetric(config.metricId)?.label||'체결·호가';
 if(config.kind==='POSITION')return ({PORTFOLIO:'현재 포트폴리오',SNAPSHOT:'선택 종목 포지션',HAS_POSITION:'현재 보유 여부',UNREALIZED_RETURN:'보유 수익률',HOURS_HELD:'보유 시간'})[config.metricId]||positionInputMetric(config.metricId)?.label||'포트폴리오';
 return ({EXECUTION_ASSET:'현재 평가 종목',ASSET_SET:'후보 종목',OHLCV:'확정 시세',METRIC:'투자 지표',SELECTION:'종목 선정 여부',CAMPAIGN:'운용 종료 요청',CONTEXT:'투자 자료',MEMORY:'기억',KNOWLEDGE:'공용 라이브러리'})[config.kind]||'입력 자료';
}
export const TARGET_WEIGHT_FOLLOWING_HELP='매수·매도 결정마다 현재 보유와 목표의 차이를 주문하며, 최소 주문 금액을 넘는 작은 차이도 반영합니다. 매수는 목표보다 부족한 만큼, 매도는 초과한 만큼 주문합니다. 유지는 현재 보유를 유지합니다. 실제 체결 수량과 비용은 체결 기록에서 확인합니다.';
const array=value=>Array.isArray(value)?value:[];
const roles=new Set(['QUANT','VIBE','DECISION_ROUTER','DECISION_MIXER']);
export const STRATEGY_TRACE_TYPES=Object.freeze({SELECT:'상위 후보 선택',MEMBER:'선택 종목 포함 여부',FILTER:'후보 필터',RANK:'종목 순위',ALLOCATE:'자금 배분',REBALANCE:'리밸런싱',INPUT:'자료 입력',VALUE:'값',SIGNAL:'신호 계산',MODEL:'학습 예측',CONDITION:'값 비교',BOOLEAN_LOGIC:'조건 조합',JEV_QUESTION:'JEV 질문',QUANT:'퀀트 결정',VIBE:'바이브 결정',DECISION_ROUTER:'결정 라우터',DECISION_MIXER:'결정 믹서',RISK:'위험 검사',ORDER:'모의 주문',ROUTER:'신호 선택',COMBINER:'가중치 결합',JEV:'JEV 입력'});
const numeric=value=>Number.isFinite(value)?value.toLocaleString('ko-KR',{minimumFractionDigits:2,maximumFractionDigits:4}):'—';
const percentage=value=>Number.isFinite(value)?(value*100).toFixed(2)+'%':null;
export function strategyTraceNodeLabel(graph,id,trace=[]){const node=array(graph?.nodes).find(n=>n.id===id),type=node?.type||array(trace).find(n=>n.nodeId===id)?.type;if(type==='INPUT'&&node)return strategyInputNodeLabel(node);return node?.label&&node.label!==id?({BTC_DOC9:'BTC 기준모델',MEAN_REVERSION:'평균 회귀',OPPORTUNITY:'기회 집중',SMA_TREND:'이동평균 추세'}[node.label]||node.label):STRATEGY_TRACE_TYPES[type]||'실행 부품';}
export function strategyTraceValue(row,graph){
 const output=row?.output||{},value=output.value,node=array(graph?.nodes).find(n=>n.id===row.nodeId),question=node?.config?.question,type=question?.type||output.answer?.type;
 if(row?.type==='INPUT'&&output.ready&&array(graph?.edges).some(e=>e.from.nodeId===row.nodeId&&array(graph?.nodes).some(n=>n.id===e.to.nodeId&&n.type==='SESSION_RULE')))return '운용 계좌 및 직전 확정 가격 이력';
 if(row?.type==='SESSION_SIGNAL'&&output.ready&&row.method==='CAUSAL_PRICE_STRUCTURE_V1')return ({SPLIT:'분할매수',REBOUND:'반등',TREND:'추세 확인'}[row.phase])+', 20일 수익률 '+percentage(row.return20)+', 고점 낙폭 '+percentage(row.drawdown)+', 진입 '+row.entryStreak+'일, 이탈 '+row.exitStreak+'일, 기준일 '+row.lastDate;
 if(row?.type==='SESSION_SIGNAL'&&output.ready)return '추세 점수 '+numeric(value)+', 기준일 '+row.lastDate;
 if(value?.strategy&&value.contractVersion==='equity-split-rule-v1')return ({TREND:'추세 보유',REBOUND:'반등 보유',SPLIT:'분할매수'}[value.strategy.regime])+', 자금 비중 '+percentage(value.strategy.targetWeight)+', '+(value.orders?.length??value.orderCount)+'개 주문'+(value.sizingEvidence?', 직전 추정 변동성 '+percentage(value.sizingEvidence.volatility)+', 연 목표 '+percentage(value.sizingEvidence.volatilityTarget)+', 비중 상한 '+percentage(value.sizingEvidence.cap):'');
 if(value?.contractVersion==='equity-split-rule-v1')return row.type==='ORDER'?(value.orders?.length??value.orderCount)+'개 세션 주문 계획':(value.mode==='REVERSE'?'리버스':'일반')+' 모드'+(Number.isFinite(row.t)?', T '+numeric(row.t):'')+', 일 매수금 '+numeric(value.budget)+' USD';
 if(node?.config?.kind==='EXECUTION_ASSET'&&typeof value==='string'){try{return getInstrument(value).symbol;}catch{return value;}}
 if(row?.type==='MEMBER'&&typeof value==='boolean')return value?'선택 종목에 포함':'선택 종목에 없음';
 if(value?.contractVersion==='portfolio-asset-selection-v1')return value.instrumentIds.length+'개 선택 · '+value.instrumentIds.map(id=>{try{return getInstrument(id).symbol;}catch{return id;}}).join(', ');
 if(node?.config?.kind==='MICROSTRUCTURE'&&Number.isFinite(value)){const unit=microstructureMetric(node.config.metricId)?.unit,formatted=v=>v.toLocaleString('ko-KR',{maximumFractionDigits:8});return unit==='ratio'?formatted(value*100)+'%':formatted(value)+({multiple:'배',bps:' bp',ms:' ms',count:'건'}[unit]??'');}
 if(row?.type==='JEV_QUESTION'&&typeof value==='string'){const candidates=array(question?.candidates),index=candidates.findIndex(c=>c.id===value),chosen=candidates[index],probability=percentage(output.answer?.probabilities?.[value]);return '선택 '+(chosen?.label||('선택지 '+(index>=0?index+1:'확인')))+(probability?' · 선택 확률 '+probability:'');}
 if(row?.type==='JEV_QUESTION'&&Number.isFinite(value))return type==='noul'?'예 확률 '+percentage(value):'점수 '+numeric(value);
 if(value?.contractVersion==='portfolio-target-weights-v1')return value.targets.filter(t=>t.targetWeight>0).length+'개 종목 · 현금 '+percentage(value.cashWeight);
 if(value?.contractVersion==='portfolio-asset-rank-v1')return value.eligibleCount+'개 후보 · 상승 비율 '+percentage(value.breadth);
 if(output.valueSummary?.kind==='ASSET_SET')return output.valueSummary.items+'개 후보'+(row.excluded?.length?' · 제외 '+row.excluded.length+'개':'');
 if(typeof value==='boolean')return value?'참':'거짓';
 if(Number.isFinite(value))return numeric(value);
 if(typeof value==='string')return value;
 return null;
}
export function strategyTraceSelection(row,graph,trace=[]){if(!row?.selectedNodeId)return null;const node=array(graph?.nodes).find(n=>n.id===row.nodeId),selectedCase=array(node?.config?.cases).find(c=>c.id===row.selectedCaseId),name=strategyTraceNodeLabel(graph,row.selectedNodeId,trace);return selectedCase?.label?selectedCase.label+' → '+name:name;}
/** Display the saved execution route; canonical authority and decisions remain unchanged. */
export function graphDecisionMethod(decision,{graphEvaluation=null,graph=null}={}){
 const authority=decision?.authority;if(!authority)return null;
 const trace=graphEvaluation?.contractVersion==='mind-strategy-decision-evaluation-v2'?array(graphEvaluation.trace):[],nodes=array(graph?.nodes),refs=new Set(array(decision.basisRefs||decision.evidenceRefs));
 const traced=id=>trace.find(node=>node.nodeId===id),saved=id=>nodes.find(node=>node.id===id);
 function describe(node,seen=new Set()){
  if(!node||seen.has(node.nodeId||node.id))return null;seen.add(node.nodeId||node.id);
  if(node.type==='QUANT')return {kind:'QUANT',label:'퀀트',measureKind:'SCORE'};
  if(node.type==='VIBE')return {kind:'VIBE',label:'바이브 · JEV',measureKind:'CONFIDENCE'};
  if(node.type==='DECISION_MIXER')return {kind:'MIXER',label:'가중 합산',measureKind:'VOTE'};
  if(node.type==='DECISION_ROUTER'){
   let selected=node.selectedNodeId;
   if(!selected&&graph?.schemaVersion===2){const candidates=array(graph.edges).filter(edge=>edge.to.nodeId===node.id&&roles.has(saved(edge.from.nodeId)?.type)&&refs.has('strategy-node:'+edge.from.nodeId));if(candidates.length===1)selected=candidates[0].from.nodeId;}
   const chosen=selected?describe(traced(selected)||saved(selected),seen):null;
   return {kind:'ROUTER',label:'라우터'+(chosen?' · '+chosen.label:' · 분기 확인'),measureKind:chosen?.measureKind??null};
  }
  return null;
 }
 const last=trace.slice().reverse().find(node=>roles.has(node.type)&&node.output?.decision);if(last)return describe(last);
 if(graph?.schemaVersion===2){let node=saved(graph.outputNodeId),seen=new Set();while(node&&['ORDER','RISK'].includes(node.type)&&!seen.has(node.id)){seen.add(node.id);const links=array(graph.edges).filter(edge=>edge.to.nodeId===node.id);node=links.length===1?saved(links[0].from.nodeId):null;}if(node&&refs.has('strategy-node:'+node.id)){const method=describe(node);if(method)return method;}}
 return authority==='QUANT_FINAL'?{kind:'QUANT',label:'퀀트',measureKind:'SCORE'}:authority==='JEV_FINAL'?{kind:'VIBE',label:'바이브 · JEV',measureKind:'CONFIDENCE'}:{kind:'UNRESOLVED',label:'결합 방식 확인',measureKind:null};
}
