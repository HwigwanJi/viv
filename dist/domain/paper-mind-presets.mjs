import {createDecisionStrategyNode,compileDecisionStrategyGraph,DECISION_GRAPH_VERSION} from './strategy-decision-graph.mjs';
import {createStrategyModule,strategyGraphHash} from './strategy-graph.mjs';
import {createP50PullbackGraph} from './hourly-pullback.mjs';
import {createAdaptivePortfolioGraph} from './adaptive-portfolio-graph.mjs';

const BTC='crypto:okx:BTC-USDT';
export const FIRST_PAPER_DECISION_STARTER='regime-trend';
export const PAPER_MIND_STARTERS=Object.freeze([
 {id:'adaptive-portfolio',name:'국면 학습 · 현금과 다종목 배분',timeframe:'1h',minHistoryBars:150,description:'시장 상태에 따라 추세·돌파·반등·현금을 함께 평가하고 공동 자금의 목표 비중을 조정합니다.',universe:['BTC','ETH','SOL','XRP','ADA','AVAX','LINK','DOGE'].map(s=>'crypto:upbit:KRW-'+s),maxPositions:8,rebalanceEveryBars:1,philosophy:'확정 시간봉의 추세·시장 폭·변동성·분산으로 유사 국면을 찾는다. 완료된 6시간 보유의 비용 차감 성과로 전략 배분을 학습하고 현금보다 추정 성과가 높은 전략에만 참여한다. 한 개의 원장에서 현금과 여러 종목을 함께 관리하며 매도 체결 대조 이후 매수한다. 시간봉마다 목표를 갱신하고 주문과 보유는 실시간 관리한다. 과거 성과와 미래 수익을 구분한다.'},
 {id:'p50-pullback',name:'급등 후 눌림 P50 · 분할익절',timeframe:'1h',minHistoryBars:7,description:'급등·매도 체결대금·호가 눌림을 확인하고 현금 50%로 진입합니다. Bybit 6종목의 개발 구간 성과를 출발점으로 업비트에서 별도 운용합니다.',universe:['BTC','ETH','SOL','MPLX','BIRB','DOOD'].map(s=>'crypto:upbit:KRW-'+s),maxPositions:1,rebalanceEveryBars:1,philosophy:'최근 1시간 +5% 또는 6시간 +10%인 종목 중 5분 매도대금이 우세하고 호가 중간값이 내린 종목을 6시간 상승률 순으로 고른다. 현금 50% 진입, 순수익 20·30·40%에서 남은 수량 20%씩 익절하고 신호 6시간 뒤 청산한다. 구간별 24시간 중복 익절을 현재 보유 회차에 적용한다.'},
 {id:'regime-trend',name:'국면 추세',description:'장기 추세에 참여하고 추세 아래에서 현금으로 전환합니다.',universe:[BTC],maxPositions:1,rebalanceEveryBars:1,philosophy:'확정 종가와 장기 이동평균으로 상승 추세에 참여한다. 추세가 꺾이면 보유를 줄여 다음 기회를 기다린다.'},
 {id:'short-rotation',name:'단기 순환 · 목표 6%',description:'강한 종목 두 개를 골라 운용하고 목표 수익 또는 5일에 종료합니다.',universe:['BTC','ETH','SOL','XRP'].map(s=>'crypto:okx:'+s+'-USDT'),maxPositions:2,rebalanceEveryBars:1,philosophy:'추세와 상대 모멘텀이 함께 강한 코인에 분산한다. 계좌 순수익률 6% 또는 운용 120시간에 캠페인을 마친다.'},
 {id:'long-momentum',name:'장기 모멘텀',description:'상승 추세의 강한 코인을 골라 주 단위로 재배분합니다.',universe:['BTC','ETH','SOL','XRP'].map(s=>'crypto:okx:'+s+'-USDT'),maxPositions:1,rebalanceEveryBars:42,philosophy:'시계열 모멘텀과 상대 모멘텀을 결합한다. 양의 모멘텀과 이동평균 위의 종목을 고르고 주 단위로 교체한다.'},
 {id:'bear-rebound',name:'하락장 반등',description:'하락 추세의 반등 기회에 진입하고 짧게 청산합니다.',universe:[BTC],maxPositions:1,rebalanceEveryBars:1,philosophy:'하락 추세에서는 현금을 기본으로 유지한다. 과매도 이후 반등 신호를 확인하고 JEV와 퀀트를 결합해 제한된 비중으로 참여한다.'}
].map(v=>Object.freeze(v)));

/** Starter graphs use the same editable nodes, ports and publication compiler. */
export function createPaperMindPresetGraph(presetId,parameters={}){
 const preset=PAPER_MIND_STARTERS.find(v=>v.id===presetId);if(!preset)throw new Error('시작할 전략을 선택하세요.');
 if(presetId==='p50-pullback')return createP50PullbackGraph();
 if(presetId==='adaptive-portfolio')return createAdaptivePortfolioGraph();
 const nodes=[],edges=[];let index=0;
 const add=(id,type,config,label)=>{const node=createDecisionStrategyNode(type,{id,config,position:{x:80+(index%5)*280,y:80+Math.floor(index++/5)*180}});if(label)node.label=label;nodes.push(node);return id;};
 const wire=(from,to,fromPort,toPort)=>edges.push({id:from+'-'+fromPort+'-'+to+'-'+toPort,from:{nodeId:from,port:fromPort},to:{nodeId:to,port:toPort}});
 const inp=(id,kind,metricId)=>add(id,'INPUT',{kind,instrumentId:BTC,required:true,...(metricId?{metricId}:{}),...(kind==='OHLCV'?{timeframe:'4h'}:{})});
 const signal=(id,moduleId,p)=>{add(id,'SIGNAL',createStrategyModule(moduleId,{parameters:p,parametersVersionId:id+'-v1'}));wire('market',id,'data','market');return id;};
 const cond=(id,from,operator,value,port='data')=>{add(id,'CONDITION',{operator,value});wire(from,id,port,'value');return id;};
 const logic=(id,operation,sources)=>{add(id,'BOOLEAN_LOGIC',{operation});sources.forEach(v=>wire(v,id,'condition','conditions'));return id;};
 const quant=(id,from,{buy=1,sell=0,onTrue='buy',onFalse='sell',buyIntent='ENTRY',sellIntent='SIGNAL_EXIT'}={})=>{
  const config={mode:'CONDITION',onTrue,onFalse,buyTargetWeight:buy,sellTargetWeight:sell};
  // Intent names are assigned through the public editor after publication.
  add(id,'QUANT',config);wire(from,id,'condition','signal');return id;
 };
 const router=(id,condition,yes,no)=>{add(id,'DECISION_ROUTER',{mode:'CONDITION'});wire(condition,id,'condition','condition');wire(yes,id,'decision','true');wire(no,id,'decision','false');return id;};
 const positionBool=(id,metric)=>{inp(id,'POSITION',metric);return id;};
 const positive=(id,from)=>cond(id,from,'gt',0,'signal');
 const constant=(id,value)=>{add(id,'VALUE',{dataType:'BOOLEAN',value});return id;};
 const fixedDecision=(id,source,action,target=1)=>{add(id,'QUANT',{mode:'CONDITION',onTrue:action,onFalse:'hold',buyTargetWeight:target,sellTargetWeight:0});wire(source,id,'value','signal');return id;};
 inp('market','OHLCV');let final;
 if(presetId==='regime-trend'){
  signal('trend','SMA_TREND',{lookbackBars:parameters.lookbackBars??480});positive('trend-positive','trend');
  final=quant('trend-decision','trend-positive');
 }else if(presetId==='long-momentum'||presetId==='short-rotation'){
  const lookback=parameters.lookbackBars??(presetId==='long-momentum'?120:42),weight=presetId==='long-momentum'?1:.45;
  signal('momentum','MOMENTUM',{lookbackBars:lookback,scale:.1});signal('trend','SMA_TREND',{lookbackBars:lookback});
  positive('momentum-positive','momentum');positive('trend-positive','trend');logic('entry-ready','ALL',['momentum-positive','trend-positive']);
  const entry=quant('entry-decision','entry-ready',{buy:weight});
  inp('selected','SELECTION','IS_SELECTED');constant('yes',true);const exit=fixedDecision('exit','yes','sell');
  add('selection-route','DECISION_ROUTER',{mode:'CONDITION'});wire('selected','selection-route','data','condition');wire(entry,'selection-route','decision','true');wire(exit,'selection-route','decision','false');final='selection-route';
  if(presetId==='short-rotation'){
   inp('campaign-return','POSITION','PORTFOLIO_RETURN');inp('campaign-hours','POSITION','ACCOUNT_AGE_HOURS');
   cond('goal','campaign-return','gte',parameters.profitTarget??.06);cond('deadline','campaign-hours','gte',parameters.maxHours??120);logic('campaign-finished','ANY',['goal','deadline']);
   inp('campaign-exit-requested','CAMPAIGN','EXIT_REQUESTED');wire('campaign-exit-requested','campaign-finished','data','conditions');
   const campaignExit=fixedDecision('campaign-exit','yes','sell');nodes.find(n=>n.id===campaignExit).config.sellIntent='CAMPAIGN_EXIT';nodes.find(n=>n.id===campaignExit).label='운용 종료';
   final=router('campaign-route','campaign-finished',campaignExit,final);
  }
 }else{
  signal('bear-trend','SMA_TREND',{lookbackBars:parameters.lookbackBars??120});signal('rebound','MOMENTUM',{lookbackBars:parameters.reboundBars??2,scale:.1});signal('oversold','MEAN_REVERSION',{window:20,entryDeviation:parameters.entryDeviation??.03,exitDeviation:.005});
  cond('bear','bear-trend','lt',0,'signal');cond('rebound-positive','rebound','gt',parameters.reboundThreshold??.2,'signal');positive('oversold-positive','oversold');logic('entry-ready','ALL',['bear','rebound-positive','oversold-positive']);
  inp('portfolio','POSITION','PORTFOLIO');
  const candidates=[{id:'full',label:'기본 비중'},{id:'half',label:'절반 비중'},{id:'avoid',label:'진입 보류'}];
  add('rebound-review','JEV_QUESTION',{provider:'JEV',question:{schemaVersion:1,contractVersion:'jev-question-v1',id:'rebound-review',type:'choice',instructions:'연결된 확정 시세·신호·현재 현금과 보유를 검토한다. 하락장 속의 일시 반등을 짧게 거래한다. 반등 지속 근거와 유동성이 충분하면 full, 근거가 섞여 있으면 half, 하락 재개 위험이 크면 avoid를 고른다. 미래 시세를 추정한 사실로 쓰지 않는다.',candidates:candidates.map(c=>({...c,description:{full:'반등 지속 근거가 충분하고 손실 한도 내에서 기본 비중으로 진입한다.',half:'반등 근거가 혼재하여 기본 비중의 절반으로 진입한다.',avoid:'하락 재개 위험이 커 이번 진입을 보류한다.'}[c.id]}))}});
  ['market','portfolio','bear-trend','rebound','oversold'].forEach(id=>wire(id,'rebound-review',nodes.find(n=>n.id===id).type==='SIGNAL'?'signal':'data','context'));
  constant('yes',true);constant('no',false);const full=fixedDecision('full','yes','buy',parameters.entryWeight??.35),half=fixedDecision('half','yes','buy',(parameters.entryWeight??.35)/2),avoid=fixedDecision('avoid','yes','sell');
  add('review-route','DECISION_ROUTER',{mode:'CHOICE',cases:candidates});wire('rebound-review','review-route','value','selector');[[full,'full'],[half,'half'],[avoid,'avoid']].forEach(([id,key])=>wire(id,'review-route','decision','case:'+key));
  add('rebound-mix','DECISION_MIXER',{mode:'TARGET_BLEND',weightVersionId:'rebound-weights-v1',weights:[{nodeId:full,value:1-(parameters.vibeWeight??.25)},{nodeId:'review-route',value:parameters.vibeWeight??.25}]});wire(full,'rebound-mix','decision','decisions');wire('review-route','rebound-mix','decision','decisions');
  const hold=fixedDecision('hold','no','hold');const entering=router('entry-route','entry-ready','rebound-mix',hold);
  inp('held','POSITION','HAS_POSITION');inp('position-return','POSITION','UNREALIZED_RETURN');inp('held-hours','POSITION','HOURS_HELD');
  cond('take-profit','position-return','gte',parameters.takeProfit??.03);cond('stop-loss','position-return','lte',-(parameters.stopLoss??.02));cond('time-exit','held-hours','gte',parameters.holdingHours??24);logic('exit-ready','ANY',['take-profit','stop-loss','time-exit']);
  const exit=fixedDecision('exit','yes','sell'),managing=router('exit-route','exit-ready',exit,hold);
  add('holding-route','DECISION_ROUTER',{mode:'CONDITION'});wire('held','holding-route','data','condition');wire(managing,'holding-route','decision','true');wire(entering,'holding-route','decision','false');final='holding-route';
 }
 add('risk','RISK',{maxExposure:presetId==='bear-rebound'?.35:1,maxOrderWeight:1,minConfidence:.6});add('order','ORDER',{execution:'PAPER',sizing:'TARGET_WEIGHT'});wire(final,'risk','decision','decision');wire('risk','order','approved','approved');
 const graph={schemaVersion:2,contractVersion:DECISION_GRAPH_VERSION,triggers:['manual','closed_bar'],nodes,edges,outputNodeId:'order'};
 compileDecisionStrategyGraph(graph);return graph;
}

const firstPaperDecisionGraphHash=strategyGraphHash(createPaperMindPresetGraph(FIRST_PAPER_DECISION_STARTER));
export const isFirstPaperDecisionPlan=plan=>plan?.approval?.enabled&&plan.scope?.instrumentId===BTC&&
 plan.scope.timeframe==='4h'&&plan.graph?.schemaVersion===2&&strategyGraphHash(plan.graph)===firstPaperDecisionGraphHash;

export function paperTrendResultBasis(record,fills){
 const evaluation=record.strategyEvaluation,trend=Array.isArray(evaluation?.modules)?evaluation.modules.find(module=>module.moduleId==='SMA_TREND'):null;
 const {close,slowMA,lookbackBars}=trend?.indicators??{};
 if(![close,slowMA,lookbackBars].every(Number.isFinite))return null;
 const graph=evaluation.graphEvaluation,output=graph?.output;
 const signal=Array.isArray(graph?.trace)?graph.trace.find(step=>step.nodeId==='trend-decision')?.output?.decision:null;
 const noPosition=trend.ready===true&&record.decision?.action==='hold'&&record.execution?.status==='NO_ORDER_REQUIRED'&&fills?.length===0&&
  signal?.action==='sell'&&signal.targetWeight===0&&output?.currentWeight===0&&output.deltaWeight===0&&close<=slowMA;
 return {close,slowMA,lookbackBars,...(noPosition?{currentWeight:0,targetWeight:0,orderReason:'TARGET_ALREADY_REACHED',
  explanation:'확정 종가가 이동평균'+(close===slowMA?'과 같아':'보다 낮아')+' 목표 보유 비중은 0%였습니다. 당시 이 종목의 보유 비중도 0%여서 매도할 수량이 없었고 모의 주문 없이 유지했습니다.'}:{})};
}
