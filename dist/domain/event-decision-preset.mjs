import {createMultiAssetEventScalpingGraph} from './multi-asset-event-runtime.mjs';
import {createDecisionStrategyNode,compileStrategyGraph} from './strategy-graph.mjs';
import {JEV_QUESTION_CONTRACT} from './jev-question.mjs';
import {surgeMindInstructions} from './surge-mind-contract.mjs';

/** Builds editable entry, holding and asset-choice nodes. */
export function createEventDecisionGraph({timeframe='1m',params={},instrumentId=null,selectionInstrumentIds=[],style='SCALPING'}={}){
 if(!['SCALPING','SURGE'].includes(style))throw new TypeError('스캘핑 또는 급등 승부 구성을 선택하세요.');
 const surge=style==='SURGE';
 const effectiveParams=surge?{entryWeight:params.maxExposure??1,pressWeight:params.maxExposure??1,maxExposure:1,...params}:params;
 const graph=createMultiAssetEventScalpingGraph({timeframe,params:effectiveParams,rank:{minScore:null}}),entry=graph.nodes.find(n=>n.id==='entry').config,press=graph.nodes.find(n=>n.id==='press').config;
 const add=(type,id,label,config)=>graph.nodes.push({...createDecisionStrategyNode(type,{id,config,position:{x:1200,y:graph.nodes.length*110}}),label});
 const edge=(from,to,fromPort,toPort)=>graph.edges.push({id:from+'-'+to+'-'+toPort,from:{nodeId:from,port:fromPort},to:{nodeId:to,port:toPort}});
 const replace=(to,port,from)=>{graph.edges=graph.edges.filter(e=>e.to.nodeId!==to||e.to.port!==port);edge(from,to,'decision',port);};
 const micro=graph.nodes.find(n=>n.id==='rvol').config;
 const quantValue=id=>graph.nodes.find(n=>n.id===id).config.value;
 const quantContext=surge?`연결한 확정 분봉의 가격·거래량 경로, 관측 수급과 현재 포지션을 사용한다. 손절 기준은 ${quantValue('stop-ready')*100}%다. 신규 진입 한도는 ${entry.buyTargetWeight*100}%, 추가 진입 목표는 ${press.buyTargetWeight*100}%다. 보유와 이익 회수는 매 판단 시점의 추세 지속 여부로 결정한다.`:`기준 퀀트는 거래량 ${quantValue('volume-ready')}배, 직전 봉 수익률 ${quantValue('return-ready')*100}%, 직전 고가 돌파 ${quantValue('breakout-ready')*100}%로 진입을 평가하고, 손절 ${quantValue('stop-ready')*100}%, 익절 ${quantValue('profit-ready')*100}%, 보유 ${quantValue('time-ready')*60}분으로 종료를 평가한다.`;
 add('INPUT','decision-market','확정 가격 경로와 체결 흐름',{...micro,metricId:'DECISION_CONTEXT'});
 add('INPUT','decision-position','현재 포지션과 최근 체결',{kind:'POSITION',instrumentId:'execution:current',metricId:'TRADE_HISTORY',required:true,maxAgeMs:3000});
 const instructions=[
  '컨텍스트1: 너는 청지 코인 스캘핑 마인드모델의 AI 판단 부분이다. 퀀트의 고정 조건이 놓치는 기회와 취약점을 현재 가격과 수급의 흐름에서 찾아 수익 기회를 판단한다.',
  `컨텍스트2: ${quantContext}살필 취약점은 고정 청산 시점, 상승 중 보유 종료, 매매 반복 비용이다. 과거 사례와 현재 흐름을 연결해 대응할 기회를 찾는다.`,
  '페르소나: 너는 스캘핑 전문가다. 연결된 확정 분봉, 관측 체결 흐름, 호가 지표, 비용과 현재 포지션을 근거로 지금 승부를 걸 타이밍인가, 걸어볼 만한가를 판단한다.',
 ];
 const question=(id,label,candidates,extra)=>{add('JEV_QUESTION',id,label,{provider:'JEV',reuseWindowMs:0,question:{schemaVersion:1,contractVersion:JEV_QUESTION_CONTRACT,id,type:'choice',instructions:[...(surge?surgeMindInstructions(id==='ai-holding'?'HOLDING':'ENTRY',quantContext):instructions),extra],candidates}});for(const n of ['decision-market','decision-position'])edge(n,id,'data','context');};
 const router=(id,questionId,cases)=>{add('DECISION_ROUTER',id,'AI 선택을 거래 결정에 연결',{mode:'CHOICE',cases:cases.map(([id,label])=>({id,label}))});edge(questionId,id,'value','selector');for(const [key,,node]of cases)edge(node,id,'decision','case:'+key);};
 question('ai-entry','AI 신규 진입 판단',[
  {id:'ENTER',label:'진입',description:`지금 들어갈 가치가 있어 목표 비중 ${entry.buyTargetWeight}로 진입한다.`},
  ...(press.buyTargetWeight>entry.buyTargetWeight?[{id:'PRESS',label:'확대 진입',description:`승부를 확대할 가치가 있어 목표 비중 ${press.buyTargetWeight}로 진입한다.`}]:[]),
  {id:'WAIT',label:'대기',description:'지금은 현금을 유지하고 다음 기회를 기다린다.'},
 ],'판단: 현재 미보유다. 지금 상승에 참여할 가치가 있는지 선택한다.');
 for(const id of ['entry','press']){const node=graph.nodes.find(n=>n.id===id);node.config={...node.config,onTrue:'hold',onFalse:'buy'};graph.edges=graph.edges.filter(e=>e.to.nodeId!==id);edge('has-position',id,'data','signal');}
 router('ai-entry-route','ai-entry',[['ENTER','진입','entry'],...(press.buyTargetWeight>entry.buyTargetWeight?[['PRESS','확대 진입','press']]:[]),['WAIT','대기','wait']]);
 replace('spread-filter','true','ai-entry-route');
 add('QUANT','ai-add','AI 추가 진입 목표',{mode:'CONDITION',onTrue:'buy',onFalse:'hold',buyTargetWeight:press.buyTargetWeight,sellTargetWeight:0,buyIntent:'ADD'});edge('has-position','ai-add','data','signal');
 add('INPUT','decision-weight','현재 보유 비중',{kind:'POSITION',instrumentId:'execution:current',metricId:'WEIGHT',required:true});
 const reducedWeight=entry.buyTargetWeight/2;
 add('CONDITION','can-reduce','축소 목표 초과 보유 확인',{operator:'gt',value:reducedWeight});edge('decision-weight','can-reduce','data','value');
 add('QUANT','ai-reduce','AI 목표 비중 축소',{mode:'CONDITION',onTrue:'sell',onFalse:'hold',buyTargetWeight:entry.buyTargetWeight,sellTargetWeight:reducedWeight,sellIntent:'REDUCE'});edge('can-reduce','ai-reduce','condition','signal');
 add('QUANT','ai-exit','AI 전량 청산',{mode:'CONDITION',onTrue:'sell',onFalse:'hold',buyTargetWeight:entry.buyTargetWeight,sellTargetWeight:0,sellIntent:'EXIT'});edge('has-position','ai-exit','data','signal');
 question('ai-holding','AI 보유 판단',[
  {id:'HOLD',label:'보유',description:'상승 기회가 이어져 현재 수량을 유지한다.'},
  {id:'ADD',label:'추가 진입',description:`더 승부를 걸 가치가 있어 목표 비중 ${press.buyTargetWeight}까지 추가 진입한다. 현재 비중과 가용 자금, 승인된 주문 한도를 반영한다.`},
  {id:'REDUCE',label:'축소',description:`현재 보유 비중을 목표 ${reducedWeight}까지 낮추고 나머지로 상승 기회를 이어간다. 현재 비중이 목표 이하이면 수량을 유지한다. 실제 매도는 거래소 최소 주문 금액과 관측 호가로 결정한다.`},
  {id:'EXIT',label:'청산',description:'이번 기회를 종료하고 전량 회수한다.'},
 ],'판단: 현재 포지션에서 더 승부를 걸 것인가, 그대로 탈 것인가, 일부를 회수할 것인가, 전량 회수할 것인가? 실행 조건을 충족하는 선택지 하나를 고른다.');
 router('ai-holding-route','ai-holding',[['HOLD','보유','wait'],['ADD','추가 진입','ai-add'],['REDUCE','축소','ai-reduce'],['EXIT','청산','ai-exit']]);
 if(surge)replace('stop-priority','false','ai-holding-route');
 else{add('DECISION_ROUTER','ai-time-priority','보유 시간 상한 후 AI 판단',{mode:'CONDITION'});edge('time-ready','ai-time-priority','condition','condition');edge('time-exit','ai-time-priority','decision','true');edge('ai-holding-route','ai-time-priority','decision','false');replace('stop-priority','false','ai-time-priority');}
 if(selectionInstrumentIds.length){
  if(instrumentId!==null||selectionInstrumentIds.length<2||selectionInstrumentIds.length>20||new Set(selectionInstrumentIds).size!==selectionInstrumentIds.length)throw new TypeError('AI 종목 선택에는 서로 다른 후보 2~20개를 연결하세요.');
  const rank=graph.nodes.find(n=>n.id==='universe-rank');rank.config.terms=[2,6,20].map(lookback=>({metric:'MOMENTUM',lookback,weight:1}));
  add('JEV_QUESTION','ai-selection','AI 종목 비교와 현금 선택',{provider:'JEV',reuseWindowMs:0,question:{schemaVersion:1,contractVersion:JEV_QUESTION_CONTRACT,id:'ai-selection',type:'choice',instructions:['컨텍스트1: 너는 청지 코인 스캘핑 마인드모델의 종목 선택 AI다. 퀀트 순위를 출발점으로 지금 승부를 검토할 종목을 찾는다.','컨텍스트2: 퀀트 순위는 2봉·6봉·20봉 모멘텀의 평균이다. 연결된 후보의 모멘텀, 변동성과 거래대금을 비교해 상승의 연속성과 추격 부담을 해석한다.','페르소나: 너는 스캘핑 전문가다. 현재 연결된 후보 중 가장 승부를 걸어볼 만한 종목 하나 또는 현금을 선택한다.'],candidates:[...selectionInstrumentIds.map(id=>({id,label:id,description:'이 종목의 기회를 우선 검토한다.'})),{id:'CASH',label:'현금',description:'현금을 유지하고 다음 기회를 기다린다.'}]}});
  edge('universe-rank','ai-selection','rank','context');edge('ai-selection','universe-select','value','choice');
  edge('universe-rank','ai-holding','rank','context');
  if(surge){const q=graph.nodes.find(n=>n.id==='ai-selection').config.question;q.instructions=surgeMindInstructions('SELECTION','연결된 후보의 2봉·6봉·20봉 모멘텀, 변동성과 거래대금을 비교한다.');q.candidates=q.candidates.map(c=>({...c,description:c.id==='CASH'?'현재 후보보다 현금의 기회가 우세하다.':`이 종목을 선택하고 목표 비중 ${entry.buyTargetWeight}까지 진입한다.`}));replace('spread-filter','true','entry');}
 }
 if(instrumentId!==null){
  replace('position-route','false','spread-filter');delete graph.executionScope;
  for(const n of graph.nodes)if(n.type==='INPUT'&&n.config.instrumentId==='execution:current')n.config.instrumentId=instrumentId;
 }
 const reached=new Set();function visit(id){if(reached.has(id))return;reached.add(id);for(const e of graph.edges.filter(e=>e.to.nodeId===id))visit(e.from.nodeId);}visit(graph.outputNodeId);
 graph.nodes=graph.nodes.filter(n=>reached.has(n.id));graph.edges=graph.edges.filter(e=>reached.has(e.from.nodeId)&&reached.has(e.to.nodeId));
 graph.compositions=graph.compositions.map(c=>({...c,nodeIds:c.nodeIds.filter(id=>reached.has(id))})).filter(c=>c.nodeIds.length>=2);
 const grouped=new Set(graph.compositions.flatMap(c=>c.nodeIds));graph.compositions.push({id:'ai-minute-decisions',name:'AI 진입과 보유 판단',nodeIds:graph.nodes.filter(n=>!grouped.has(n.id)).map(n=>n.id),collapsed:false,version:1});
 compileStrategyGraph(graph);return graph;
}

export function createSurgeDecisionGraph(options={}){return createEventDecisionGraph({...options,style:'SURGE'});}
