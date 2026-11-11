import {createDecisionStrategyNode,compileStrategyGraph} from './strategy-graph.mjs';

const check=(ok,message)=>{if(!ok)throw new TypeError(message);};
const units=value=>{check(typeof value==='string'&&/^(?:0|[1-9]\d{0,13})(?:\.\d{1,8})?$/.test(value),'수량은 소수 8자리 이내로 입력하세요.');const [a,b='']=value.split('.');return BigInt(a)*100000000n+BigInt(b.padEnd(8,'0'));};
const text=value=>{const fraction=(value%100000000n).toString().padStart(8,'0').replace(/0+$/,'');return String(value/100000000n)+(fraction?'.'+fraction:'');};

/** One approved position cycle; its actual remaining quantity is the durable stage. */
export function withPositionProfitTarget({graph,holdingGraph=graph,holdingRouterId='ai-holding-route',instrumentId,entryAt,initialQuantity,triggerReturn=.2}={}){
 compileStrategyGraph(graph);compileStrategyGraph(holdingGraph);
 const entryMs=Date.parse(entryAt),quantity=units(initialQuantity),remaining=text(quantity-quantity/2n);
 check(new Date(entryMs).toISOString()===entryAt&&quantity>1n&&Number.isFinite(triggerReturn)&&triggerReturn>=0,'보유 시작 시각·수량·익절 수익률을 확인하세요.');
 const next=structuredClone(graph),prefix='profit-',risk=next.nodes.find(n=>n.type==='RISK'),prior=next.edges.find(e=>e.to.nodeId===risk?.id&&e.to.port==='decision');
 check(prior&&!next.nodes.some(n=>n.id.startsWith(prefix)),'공용 위험 검사 앞에 익절 경로를 연결하세요.');
 const add=(type,id,config,label)=>{const key=prefix+id;next.nodes.push({...createDecisionStrategyNode(type,{id:key,config,position:{x:next.nodes.length*180,y:400}}),label});return key;};
 const edge=(a,b,from,to)=>next.edges.push({id:a+'-'+b+'-'+to,from:{nodeId:a,port:from},to:{nodeId:b,port:to}});
 const value=add('VALUE','true',{dataType:'BOOLEAN',value:true},'익절 동작');
 const hold=add('QUANT','wait',{mode:'CONDITION',onTrue:'hold',onFalse:'hold',buyTargetWeight:1,sellTargetWeight:0},'목표 전 대기·잔여분 보유');edge(value,hold,'value','signal');
 const router=holdingGraph.nodes.find(n=>n.id===holdingRouterId);
 check(router?.type==='DECISION_ROUTER'&&router.config.mode==='CHOICE'&&['HOLD','ADD','REDUCE','EXIT'].every(id=>router.config.cases.some(c=>c.id===id)),'기존 AI 보유·축소·청산 라우터를 연결하세요.');
 const selected=holdingGraph.edges.find(e=>e.to.nodeId===router.id&&e.to.port==='selector'),question=holdingGraph.nodes.find(n=>n.id===selected?.from.nodeId);
 check(question?.type==='JEV_QUESTION','기존 AI 질문 원본을 확인하세요.');
 const aiId=prefix+'ai',ai=add('JEV_QUESTION','ai',{...structuredClone(question.config),question:{...structuredClone(question.config.question),id:aiId}},'익절 후 AI 보유 판단');
 for(const input of holdingGraph.edges.filter(e=>e.to.nodeId===question.id)){
  const source=holdingGraph.nodes.find(n=>n.id===input.from.nodeId);check(source?.type==='INPUT'&&source.config.kind==='CONTEXT','AI의 정식 시간봉 맥락 입력을 연결하세요.');
  const id=add('INPUT','context-'+source.id,structuredClone(source.config),'익절 후 현재 시장과 보유');edge(id,ai,'data','context');
 }
 const after=add('DECISION_ROUTER','after',structuredClone(router.config),'남은 수량 AI 관리');edge(ai,after,'value','selector');
 for(const choice of ['HOLD','ADD','REDUCE','EXIT']){
  let target=hold;
  if(['REDUCE','EXIT'].includes(choice)){
   const input=holdingGraph.edges.find(e=>e.to.nodeId===router.id&&e.to.port==='case:'+choice),source=holdingGraph.nodes.find(n=>n.id===input?.from.nodeId);
   check(source?.type==='QUANT'&&source.config.mode==='CONDITION'&&source.config.onTrue==='sell','AI 축소·청산 동작을 확인하세요.');
   target=add('QUANT',choice.toLowerCase(),structuredClone(source.config),'AI '+(choice==='REDUCE'?'잔여 수량 축소':'잔여 수량 청산'));edge(value,target,'value','signal');
  }
  edge(target,after,'decision','case:'+choice);
 }
 const binding=metricId=>({kind:'POSITION',instrumentId,metricId,required:true});
 const entered=add('INPUT','entry',binding('ENTRY_TIME_MS'),'이번 보유의 시작 시각'),same=add('CONDITION','same',{operator:'eq',value:entryMs},'승인한 보유');edge(entered,same,'data','value');
 const qty=add('INPUT','quantity',binding('QUANTITY'),'실제 남은 수량'),unfinished=add('CONDITION','unfinished',{operator:'gt',value:Number(remaining)+.00000001},'절반 매도 미완료');edge(qty,unfinished,'data','value');
 const ret=add('INPUT','return',binding('UNREALIZED_RETURN'),'현재 매수호가 수익률'),hit=add('CONDITION','hit',{operator:'gte',value:triggerReturn},'+20% 익절 조건');edge(ret,hit,'data','value');
 const position=add('INPUT','position',binding('SNAPSHOT'),'자기 포지션 원장'),sell=add('QUANT','half',{mode:'CONDITION',onTrue:'sell',onFalse:'hold',buyTargetWeight:1,sellTargetWeight:0,sellTargetQuantity:remaining,sellIntent:'TAKE_PROFIT'},'최초 수량 절반 매도');edge(hit,sell,'condition','signal');edge(position,sell,'data','position');
 const target=add('DECISION_ROUTER','target',{mode:'CONDITION'},'현재 호가에서 익절 검사');edge(hit,target,'condition','condition');edge(sell,target,'decision','true');edge(hold,target,'decision','false');
 const phase=add('DECISION_ROUTER','phase',{mode:'CONDITION'},'익절 전후 분기');edge(unfinished,phase,'condition','condition');edge(target,phase,'decision','true');edge(after,phase,'decision','false');
 const cycle=add('DECISION_ROUTER','cycle',{mode:'CONDITION'},'이번 보유에만 적용');edge(same,cycle,'condition','condition');edge(phase,cycle,'decision','true');edge(prior.from.nodeId,cycle,prior.from.port,'false');prior.from={nodeId:cycle,port:'decision'};
 compileStrategyGraph(next);return {graph:next,initialQuantity,remainingQuantity:remaining,entryAt,instrumentId,triggerReturn};
}
