import {createDecisionStrategyNode,compileDecisionStrategyGraph} from './strategy-decision-graph.mjs';
import {decisionGraphLimits} from './strategy-graph-limits.mjs';

/** Replace one compound filter with ordinary, independently wired canonical nodes. */
export function expandAssetFilter(graph,nodeId){
 const old=graph.nodes.find(n=>n.id===nodeId),terms=old?.config.conditions??[];
 if(old?.type!=='FILTER'||!terms.length)throw new Error('펼칠 후보 조건을 선택하세요.');
 const next=structuredClone(graph),used=new Set(next.nodes.map(n=>n.id));let serial=1;
 while([...used].some(id=>id.startsWith(nodeId+':parts'+serial+':')))serial++;
 const prefix=nodeId+':parts'+serial+':',added=[],x=Math.min(old.position.x,8800),y=Math.min(old.position.y,8000),labels={MOMENTUM:'가격 변화율',VOLATILITY:'변동성',QUOTE_VOLUME:'평균 거래대금',SMA_DISTANCE:'이동평균 이격',BREAKOUT:'고점 돌파',BUY_QUOTE_RATIO_5M:'5분 매수 체결대금 비중',MID_RETURN_5M:'5분 호가 중간값 변화'};
 const add=(type,suffix,label,config,column,row)=>{const n=createDecisionStrategyNode(type,{id:prefix+suffix,config,position:{x:x+column*300,y:y+row*180}});n.label=label;added.push(n);return n.id;};
 const link=(a,b,from,to)=>next.edges.push({id:prefix+a.split(':').at(-1)+'-'+b.split(':').at(-1)+'-'+to,from:{nodeId:a,port:from},to:{nodeId:b,port:to}});
 const config={...old.config,conditions:[],minHistoryBars:Math.max(old.config.minHistoryBars,...terms.map(t=>t.lookback+1))};delete config.conditionMode;
 const guard=add('FILTER','eligibility','확정 자료·거래 가능 범위',config,0,0),incoming=next.edges.filter(e=>e.to.nodeId===nodeId);
 for(const edge of incoming)edge.to.nodeId=guard;
 const compared=terms.map((term,i)=>{const title=term.metric==='MOMENTUM'?term.lookback+(graph.executionScope?.timeframe==='1h'?'시간':'봉')+' 수익률':labels[term.metric]??term.metric,metric=add('ASSET_METRIC','metric-'+i,title,{metric:term.metric,lookback:term.lookback},1,i),compare=add('ASSET_COMPARE','compare-'+i,title+' 비교',{operator:term.operator,value:term.value},2,i);link(guard,metric,'assets','assets');link(metric,compare,'values','values');return compare;});
 let condition=compared[0];
 if(compared.length>1){condition=add('ASSET_LOGIC','logic',old.config.conditionMode==='ANY'?'하나 이상 충족 · OR':'모두 충족 · AND',{operation:old.config.conditionMode??'ALL'},3,0);for(const id of compared)link(id,condition,'conditions','conditions');}
 next.nodes=next.nodes.map(n=>n.id===nodeId?{...n,type:'ASSET_FILTER',label:'조건 통과 후보',position:{x:x+1200,y},config:{}}:n).concat(added);
 link(guard,nodeId,'assets','assets');link(condition,nodeId,'conditions','conditions');
 for(const group of next.compositions??[])if(group.nodeIds?.includes(nodeId))group.nodeIds.push(...added.map(n=>n.id));
 const limits=decisionGraphLimits(next);if(next.nodes.length>limits.nodes||next.edges.length>limits.edges)throw new Error('펼친 부품이 그래프 크기를 초과합니다. 다른 부품을 정리한 뒤 펼치세요.');
 compileDecisionStrategyGraph(next);return {graph:next,focusNodeId:added.find(n=>n.type==='ASSET_METRIC').id,nodeIds:[nodeId,...added.map(n=>n.id)]};
}
