import {hashInputPackage} from './workspace.mjs';
import {resolveGraphInput} from './strategy-graph-inputs.mjs';
import {buildJevQuestionRequest} from './jev-question.mjs';
import {projectBlindPortfolioHistory,BLIND_PORTFOLIO_HISTORY_VERSION} from './portfolio-question-evidence.mjs';
import {materializePortfolioTraceValue} from './portfolio-graph.mjs';

export const GRAPH_QUESTION_INPUT_VERSION='graph-question-connected-inputs-v1';
export const GRAPH_PROVIDER_STAGES_VERSION='graph-provider-stages-v1';
const clone=structuredClone;
const check=(ok,message)=>{if(!ok)throw Object.assign(new Error(message),{code:'GRAPH_QUESTION_INPUT',status:409});};

/** Keep full source bars in graph evidence; send a named, clock-aligned price/volume path to the provider. */
export function projectMinuteCandidateHistory(value,asOf){
 if(value.timeframe!=='1m')return clone(value);
 const minute=60000,step=3*minute,cutoff=Date.parse(asOf),closed=Math.floor(cutoff/step)*step,start=closed-60*minute;
 return {...clone(value),providerProjection:'MINUTE_CANDIDATES_60M_3M_OHLCV_V1',items:value.items.map(item=>{
  const {bars,...rest}=clone(item),known=bars.filter(b=>Date.parse(b.closeTime)<=cutoff&&(!b.availableAt||Date.parse(b.availableAt)<=cutoff)),rows=[],gaps=[];
  for(let end=start+step;end<=closed;end+=step){const group=known.filter(b=>Date.parse(b.closeTime)>end-step&&Date.parse(b.closeTime)<=end).sort((a,b)=>a.closeTime.localeCompare(b.closeTime));
   if(group.length!==3||group.some((b,i)=>Date.parse(b.closeTime)!==end-step+(i+1)*minute)){gaps.push(new Date(end).toISOString());continue;}
   rows.push([new Date(end).toISOString(),group[0].open,Math.max(...group.map(b=>b.high)),Math.min(...group.map(b=>b.low)),group.at(-1).close,group.reduce((s,b)=>s+b.volume,0),group.reduce((s,b)=>s+(b.quoteVolume??0),0)]);
  }
  return {...rest,pricePath:{sourceTimeframe:'1m',aggregation:'3m',windowMinutes:60,columns:['closeTime','open','high','low','close','volume','quoteVolume'],bars:rows,latestMinutes:known.filter(b=>Date.parse(b.closeTime)>closed).map(b=>[b.closeTime,b.open,b.high,b.low,b.close,b.volume,b.quoteVolume??null]),missingBuckets:gaps,sourceBars:bars.length}};
 })};
}

/** Project only the connected values of the pending question from the saved evaluation. */
export function graphQuestionInput(graph,evaluation,executionInputs,nodeId){
 const node=graph.nodes.find(n=>n.id===nodeId),trace=evaluation.trace.find(t=>t.nodeId===nodeId);
 check(node?.type==='JEV_QUESTION'&&trace?.output?.requiredQuestionNodeIds?.includes(nodeId),'호출할 질문과 준비 계산을 대조하세요.');
 const links=graph.edges.filter(e=>e.to.nodeId===nodeId).sort((a,b)=>a.id.localeCompare(b.id));
 const connectedInputs=links.flatMap(edge=>{
  const source=graph.nodes.find(n=>n.id===edge.from.nodeId),row=evaluation.trace.find(t=>t.nodeId===source.id),output=row?.output;
  check(output?.ready===true,'질문에 연결한 입력의 준비 상태를 확인하세요.');if(output.omitted)return [];
  let value,sourceRefs=[],portType=null;
  if(source.type==='INPUT'){
   const original=resolveGraphInput(executionInputs,source.id,{graph});check(original?.ready===true,'연결 자료의 원문을 확인하세요.');value=clone(original.value);sourceRefs=clone(original.sourceRefs??[]);
   if(source.config.kind==='OHLCV')value={...value,bars:value.bars.slice(-64),dailyBars:(value.dailyBars??[]).slice(-24)};
   if(source.config.kind==='ASSET_SET')value=projectMinuteCandidateHistory(value,evaluation.asOf);
   if(source.config.kind==='MICROSTRUCTURE'&&source.config.metricId==='DECISION_CONTEXT'){
    const {usedEventIds,sourceRefs:rawRefs,sourceHash,instrumentId,market,...context}=value;
    value={...context,metrics:Object.fromEntries(Object.entries(context.metrics).map(([id,point])=>[id,point.value]))};
   }
  }else if(output.valueSummary?.kind==='ASSET_SET'){value=materializePortfolioTraceValue({graph,evaluation,inputs:executionInputs,nodeId:source.id});}
  else if(source.type==='RANK'&&edge.from.port==='breadth'){value=output.value?.breadth;portType='NUMBER';}
  else if(output.decision){value=clone(output.decision);portType='DECISION';}
  else value=Object.hasOwn(output,'value')?clone(output.value):output.score;
  check(value!==undefined,'연결 자료의 출력 값을 확인하세요.');
  return [{nodeId:source.id,port:edge.from.port,dataType:portType??(source.type==='SIGNAL'?'SIGNAL':output.kind??(typeof value==='boolean'?'BOOLEAN':typeof value==='number'?'NUMBER':'TEXT')),value,sourceRefs,...(source.type==='INPUT'&&['POSITION','SELECTION','CAMPAIGN'].includes(source.config.kind)?{label:source.label,binding:{kind:source.config.kind,metricId:source.config.metricId,instrumentId:row.binding?.instrumentId??source.config.instrumentId},unit:resolveGraphInput(executionInputs,source.id,{graph}).unit}:{}),basisRefs:clone(output.basisRefs??[]),outputHash:row.outputHash,...(source.type==='INPUT'?{asOf:output.asOf,availableAt:output.availableAt,projection:source.config.kind==='OHLCV'?'LATEST_64_CONFIRMED_AND_24_DAILY_V1':value?.providerProjection??'CONNECTED_VALUE'}:{})}];
 });
 check(connectedInputs.length>0,'질문에 평가할 자료를 연결하세요.');
 const original={contractVersion:GRAPH_QUESTION_INPUT_VERSION,asOf:evaluation.asOf,graphHash:evaluation.graphHash,questionNodeId:nodeId,connectedInputs};
 return {state:evaluation.researchProjection===BLIND_PORTFOLIO_HISTORY_VERSION?projectBlindPortfolioHistory(original):original,questions:[clone(node.config.question)],questionHash:hashInputPackage(node.config.question),inputHash:trace.inputHash};
}

export function graphQuestionProviderRequest(graph,evaluation,executionInputs,nodeId){return buildJevQuestionRequest(graphQuestionInput(graph,evaluation,executionInputs,nodeId));}
