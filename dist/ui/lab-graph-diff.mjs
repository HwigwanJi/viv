import {strategyLearningParameterCatalog} from '../domain/strategy-learning.mjs';
import {readableLiveChanges} from './live-change-review.mjs';

const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const labels={buyAbove:'매수 신호 기준',sellBelow:'매도 신호 기준',buyTargetWeight:'매수 목표 비중',sellTargetWeight:'매도 목표 비중',buyWeightDelta:'매수 증가 비중',sellWeightDelta:'매도 감소 비중',sellPositionFraction:'현재 보유 매도 비율',sellTargetQuantity:'매도 후 남길 수량',direction:'정렬',enabled:'활성 상태',required:'필수 입력',mode:'판단 방식',targetMode:'비중 설정',instructions:'투자 지침',selectedNodeId:'선택 전략',maxExposure:'최대 보유 비중',maxOrderWeight:'주문 한도',minConfidence:'최소 확신도',instrumentId:'입력 종목',timeframe:'봉 간격',kind:'입력 자료',moduleId:'계산 전략',operator:'비교 연산',value:'기준값',onTrue:'조건 충족 행동',onFalse:'조건 미충족 행동',buyIntent:'매수 목적',sellIntent:'매도 목적',execution:'운용 방식',sizing:'주문 방식',type:'질문 형식',provider:'판단 엔진',operation:'논리 연산'};
const generated=new Set(['parametersVersionId','parametersHash','weightVersionId','implementationVersion']);
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
function leaves(value,prefix='',out=new Map()){
 if(Array.isArray(value)&&value.every(v=>v&&typeof v==='object'&&typeof v.nodeId==='string')){for(const item of value)leaves(Object.fromEntries(Object.entries(item).filter(([k])=>k!=='nodeId')),prefix+'['+item.nodeId+']',out);}
 else if(value&&typeof value==='object'&&!Array.isArray(value)){for(const [key,v]of Object.entries(value))if(!generated.has(key))leaves(v,prefix?prefix+'.'+key:key,out);}
 else out.set(prefix,value);
 return out;
}
function display(value,nodes){if(value===undefined)return '없음';if(value===true)return '활성';if(value===false)return '비활성';if(typeof value==='number')return new Intl.NumberFormat('ko-KR',{maximumFractionDigits:8}).format(value);if(nodes.has(value))return nodes.get(value).label||value;return ({DESC:'높은 점수부터',ASC:'낮은 점수부터',buy:'매수',hold:'유지',sell:'매도',SELECT:'선택',FIXED:'고정',CONDITION:'조건',SCORE:'점수',TARGET_WEIGHT:'목표 비중',WEIGHT_DELTA:'비중 증감',gt:'초과',gte:'이상',lt:'미만',lte:'이하',eq:'같음',neq:'다름'})[value]??(typeof value==='string'?value:JSON.stringify(value));}
function replacementLabel(node){
 if(node.type==='VALUE')return ({NUMBER:'상수',TEXT:'텍스트',BOOLEAN:'참·거짓 값'})[node.config?.dataType]||'값';
 if(node.type==='JEV_QUESTION')return ({noul:'JEV 예 확률',score:'JEV 점수',choice:'JEV 선택'})[node.config?.question?.type]||'JEV 질문';
 return ({INPUT:'입력 자료',SIGNAL:'계산 신호',QUANT:'퀀트 결정',VIBE:'바이브 결정',CONDITION:'값 비교',BOOLEAN_LOGIC:'조건 조합',DECISION_ROUTER:'결정 라우터',DECISION_MIXER:'결정 믹서',FILTER:'후보 필터',RANK:'종목 순위',ALLOCATE:'자금 배분',REBALANCE:'리밸런싱',RISK:'위험 한도',ORDER:'모의 주문',COMBINER:'가중치 결합',ROUTER:'신호 선택',JEV:'JEV 결정'})[node.type]||node.type;
}
export function labGraphChanges(left,right){
 if(!left||!right)return [];
 const original=new Map(left.nodes.map(n=>[n.id,n])),nodes=new Map([...left.nodes,...right.nodes].map(n=>[n.id,n])),catalog=new Map(),rows=[];
 if(!same(left.executionScope,right.executionScope)){const describe=scope=>scope?.kind==='EACH_ASSET'?'종목별 평가 · '+scope.timeframe.replace(/m$/,'분봉')+' · 후보 최대 '+scope.maxCandidates+'개 · 동시 보유 '+scope.maxConcurrentPositions+'개':'단일 실행';rows.push({name:'실행 범위',field:'후보 평가',before:describe(left.executionScope),after:describe(right.executionScope)});}
 for(const graph of [left,right])try{for(const p of strategyLearningParameterCatalog(graph))catalog.set(p.nodeId+':'+p.path,p.label);}catch{/* Incomplete drafts remain reviewable before execution validation. */}
 for(const node of right.nodes){
  const before=original.get(node.id),name=node.label||node.type;original.delete(node.id);
  if(!before){rows.push({name,state:'추가됨'});continue;}
  if(before.type!==node.type){
   rows.push({name,field:[before.type,node.type].every(type=>['VALUE','JEV_QUESTION'].includes(type))?'결정 방식':'부품 종류',before:replacementLabel(before),after:replacementLabel(node)});
   const wasEnabled=before.enabled??before.config?.enabled??true,isEnabled=node.enabled??node.config?.enabled??true;
   if(wasEnabled!==isEnabled)rows.push({name,state:isEnabled?'활성화':'비활성화'});
   continue;
  }
  const a=leaves(before.config),b=leaves(node.config);
  if(before.enabled!==node.enabled){a.set('enabled',before.enabled??true);b.set('enabled',node.enabled??true);}
  for(const path of new Set([...a.keys(),...b.keys()]))if(!same(a.get(path),b.get(path))){
   if(path==='enabled'){rows.push({name,state:b.get(path)===false?'비활성화':'활성화'});continue;}
   const weight=path.match(/^weights\[(.+)\]\.value$/),field=catalog.get(node.id+':'+path)||(weight?(nodes.get(weight[1])?.label||weight[1])+' 가중치':labels[path.split('.').at(-1)]||'세부 설정');
   rows.push({name,field,before:display(a.get(path),nodes),after:display(b.get(path),nodes)});
  }
 }
 for(const node of original.values())rows.push({name:node.label||node.type,state:'제거됨'});
 const edges=g=>g.edges.map(e=>JSON.stringify([e.from.nodeId,e.from.port,e.to.nodeId,e.to.port])).sort();if(!same(edges(left),edges(right)))rows.push({name:'연결',state:'구성 변경'});
 const triggers=g=>[...(g.triggers??[])].sort();if(!same(triggers(left),triggers(right))){const describe=g=>triggers(g).map(v=>({manual:'직접 실행',closed_bar:'확정 봉',schedule:'예약 실행'})[v]||v).join(' · ')||'없음';rows.push({name:'실행 시점',field:'시작 조건',before:describe(left),after:describe(right)});}
 return readableLiveChanges(rows);
}
export function renderLabGraphDiff(models){
 const graphs=models.map(m=>m?.data?.strategyPlan?.graph);if(!graphs[0]||!graphs[1])return '';
 const rows=labGraphChanges(graphs[0],graphs[1]),knowledge=models.map(m=>m?.data?.externalKnowledge?.enabled??false);
 if(knowledge[0]!==knowledge[1])rows.push({name:'외부 지식',field:'사용',before:knowledge[0]?'활성':'비활성',after:knowledge[1]?'활성':'비활성'});
 if(!rows.length)return '<p class="muted">같은 구성 · 두 전략의 실행 결과를 비교합니다.</p>';
 const row=r=>`<li${r.field?' class="lab-change-value"':''}><span>${esc(r.name)}${r.field?` · ${esc(r.field)}`:''}</span><strong>${r.state?esc(r.state):`${esc(r.before)} <span aria-label="변경 후">→</span> ${esc(r.after)}`}</strong></li>`;
 return `<section class="lab-change-summary"><h3>비교할 변경점</h3><ul>${rows.slice(0,6).map(row).join('')}</ul>${rows.length>6?`<details><summary>변경 ${rows.length-6}개 더 보기</summary><ul>${rows.slice(6).map(row).join('')}</ul></details>`:''}</section>`;
}
