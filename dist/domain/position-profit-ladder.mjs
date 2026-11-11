import {resolveQueryParameters,bindPreparedInput} from './strategy-parameters.mjs';
import {createDecisionStrategyNode,compileStrategyGraph,evaluateStrategyGraph} from './strategy-graph.mjs';
import {resolvePositionInput} from './position-input.mjs';
import {hashInputPackage} from './workspace.mjs';

export const hasPositionProfitLadder=graph=>graph?.nodes?.some(n=>n.type==='INPUT'&&n.config.kind==='POSITION'&&n.config.metricId==='INTENT_COOLDOWN_READY')===true;

export function evaluatePositionProfitGraph({graph,account,instrumentId,asOf,executionMode,valuation=null}){
 const inputs={};for(const original of graph.nodes.filter(n=>n.type==='INPUT')){const resolution=resolveQueryParameters(graph,original,{executionInstrumentId:instrumentId}),n=resolution.node;if(!resolution.ready){inputs[n.id]={ready:false,asOf,availableAt:null,sourceRefs:[],missing:resolution.missing};continue;}inputs[n.id]=n.config.kind==='POSITION'?resolvePositionInput({binding:{...n.config,instrumentId:n.config.instrumentId==='execution:current'?instrumentId:n.config.instrumentId},account,profileId:account.profileId,asOf,valuation}):{ready:false,asOf,availableAt:null,sourceRefs:[],missing:['HOURLY_VALUE_SCHEDULED_INPUT']};inputs[n.id]=bindPreparedInput(inputs[n.id],resolution);}
 const value=account.positions.filter(p=>p.instrumentId===instrumentId).reduce((s,p)=>s+p.quantity*p.marketPrice,0);
 return evaluateStrategyGraph(graph,[],{asOf,sourceHash:hashInputPackage({account,instrumentId,asOf}),inputs,trigger:'market_event',context:{profileId:account.profileId,accountId:account.id,executionInstrumentId:instrumentId,currentWeight:account.equity>0?value/account.equity:0,executionMode}});
}

/** Conditions and filled-intent cooldowns remain ordinary editable canonical graph parts. */
export function withPositionProfitLadder(graph,{thresholds=[.2,.3,.4],sellFraction=.2,cooldownMs=86400000,returnMetric='UNREALIZED_RETURN',cooldownScope='ASSET'}={}){
 compileStrategyGraph(graph);if(!['UNREALIZED_RETURN','NET_LIQUIDATION_RETURN'].includes(returnMetric)||!['ASSET','POSITION','POSITION_ONCE'].includes(cooldownScope))throw new TypeError('익절 수익률과 보유별 재실행 범위를 확인하세요.');
 if(!Array.isArray(thresholds)||thresholds.length===0||thresholds.some((v,i)=>!Number.isFinite(v)||v<=0||i&&v<=thresholds[i-1])||!Number.isFinite(sellFraction)||sellFraction<=0||sellFraction>1||!Number.isSafeInteger(cooldownMs)||cooldownMs<0)throw new TypeError('익절 구간·현재 수량의 매도 비율·재실행 간격을 확인하세요.');
 const next=structuredClone(graph),risk=next.nodes.find(n=>n.type==='RISK'),prior=next.edges.find(e=>e.to.nodeId===risk?.id&&e.to.port==='decision');
 if(!prior||next.nodes.some(n=>n.id.startsWith('profit-')))throw new TypeError('기존 위험 검사 앞에 한 개의 분할 익절 경로를 연결하세요.');
 const add=(type,id,config,label)=>{next.nodes.push({...createDecisionStrategyNode(type,{id,config,position:{x:next.nodes.length*150,y:320}}),label});return id;};
 const edge=(a,b,from,to)=>next.edges.push({id:a+'-'+b+'-'+to,from:{nodeId:a,port:from},to:{nodeId:b,port:to}});
 const input=(id,metricId,label,extra={})=>add('INPUT',id,{kind:'POSITION',instrumentId:'execution:current',metricId,required:true,...extra},label);
 const held=input('profit-held','HAS_POSITION','현재 보유 여부'),ret=input('profit-return',returnMetric,'현재 보유 수익률');
 let fallback=prior.from.nodeId,port=prior.from.port;
 for(const [i,threshold]of [...thresholds.entries()].reverse()){
  const prefix='profit-stage-'+i,sellId=prefix+'-sell';
  const hit=add('CONDITION',prefix+'-hit',{operator:'gte',value:threshold},'+'+(threshold*100)+'% 도달');edge(ret,hit,'data','value');
  const cooldown=input(prefix+'-cooldown','INTENT_COOLDOWN_READY',cooldownScope==='POSITION_ONCE'?'이 포지션에서 이 구간 한 번':('이 구간 매도 후 '+(cooldownMs/3600000)+'시간 대기'),{cooldownMs,intentNodeId:sellId,...(cooldownScope!=='ASSET'?{cooldownScope}:{} )});
  const ready=add('BOOLEAN_LOGIC',prefix+'-ready',{operation:'ALL'},'수익 도달 · 이 구간 재실행 가능');edge(hit,ready,'condition','conditions');edge(cooldown,ready,'data','conditions');
  const sell=add('QUANT',sellId,{mode:'CONDITION',onTrue:'sell',onFalse:'hold',buyTargetWeight:1,sellTargetWeight:0,sellPositionFraction:sellFraction,sellIntent:'TAKE_PROFIT'},'남은 물량 '+(sellFraction*100)+'% 익절');edge(ready,sell,'condition','signal');
  const route=add('DECISION_ROUTER',prefix+'-route',{mode:'CONDITION'},'익절 구간 '+(i+1));edge(ready,route,'condition','condition');edge(sell,route,'decision','true');edge(fallback,route,port,'false');fallback=route;port='decision';
 }
 const router=add('DECISION_ROUTER','profit-route',{mode:'CONDITION'},'보유 분할 익절 · 원래 모델 판단');edge(held,router,'data','condition');edge(fallback,router,port,'true');edge(prior.from.nodeId,router,prior.from.port,'false');prior.from={nodeId:router,port:'decision'};
 compileStrategyGraph(next);return next;
}

/** A repeating ladder uses reconciled order IDs, so exchange split fills count once. */
export function withRepeatingPositionProfitLadder(graph,{stepReturn=.05,sellFraction=1/3}={}){
 if(!Number.isFinite(stepReturn)||stepReturn<=0)throw new TypeError('익절 단계 수익률은 양수여야 합니다.');
 const next=withPositionProfitLadder(graph,{thresholds:[stepReturn],sellFraction,cooldownScope:'POSITION',cooldownMs:0});
 const input=next.nodes.find(n=>n.id==='profit-stage-0-cooldown');input.config.profitStepReturn=stepReturn;input.label=(stepReturn*100)+'%p 상승 단계마다 한 번';
 compileStrategyGraph(next);return next;
}
