import {createDecisionStrategyNode,compileStrategyGraph,strategyGraphHash,StrategyGraphError} from './strategy-graph.mjs';
import {MICROSTRUCTURE_TIMEFRAMES} from './microstructure-input.mjs';
import {JEV_QUESTION_CONTRACT} from './jev-question.mjs';

export const EVENT_STRATEGY_PRESET_VERSION='event-scalping-presets-v2';
export const EVENT_SCALPING_DEFAULTS=Object.freeze({rvolMin:1.8,pressRvolMin:2.8,returnMin:.001,breakoutMin:0,maxSpreadBps:12,entryWeight:.35,pressWeight:.65,stopLossRatio:.005,takeProfitRatio:.01,maxHoldMinutes:15,maxExposure:.8,maxOrderWeight:1,minConfidence:.6,orderType:'LIMIT_FOK',maxSlippageBps:20,lookbackBars:20,flowWindowMs:60000,bookMaxAgeMs:3000});
const check=(ok,code,message)=>{if(!ok)throw new StrategyGraphError(code,message);},clone=structuredClone;
function settings(params){
 check(params&&Object.getPrototypeOf(params)===Object.prototype&&Object.keys(params).every(k=>Object.hasOwn(EVENT_SCALPING_DEFAULTS,k)),'EVENT_PRESET_PARAMS','지원하는 스캘핑 매개변수를 확인하세요.');
 const p={...EVENT_SCALPING_DEFAULTS,...params};
 check(Object.entries(p).every(([k,v])=>k==='orderType'?['LIMIT_FOK','LIMIT_IOC'].includes(v):typeof v==='number'&&Number.isFinite(v)),'EVENT_PRESET_PARAMS','유한한 매개변수와 지정가 주문 방식을 확인하세요.');
 check(p.rvolMin>0&&p.pressRvolMin>=p.rvolMin&&p.returnMin>=0&&p.returnMin<=1&&p.breakoutMin>=0&&p.breakoutMin<=1&&p.maxSpreadBps>0&&p.maxSpreadBps<=1000&&p.entryWeight>0&&p.pressWeight>=p.entryWeight&&p.pressWeight<=p.maxExposure&&p.maxExposure<=1&&p.maxOrderWeight===1&&p.minConfidence>=0&&p.minConfidence<=1&&p.stopLossRatio>0&&p.stopLossRatio<1&&p.takeProfitRatio>0&&p.takeProfitRatio<=1&&p.maxHoldMinutes>0&&p.maxHoldMinutes<=1440&&p.maxSlippageBps>=0&&p.maxSlippageBps<=1000,'EVENT_PRESET_RISK','비중·손익·기간 한도를 확인하세요. 현물 진입 최대 비중은 1 이하이고, 전량 종료를 지원하는 공통 주문 비중 한도는 1이어야 합니다.');
 check(Number.isSafeInteger(p.lookbackBars)&&p.lookbackBars>=2&&p.lookbackBars<=500&&Number.isSafeInteger(p.flowWindowMs)&&p.flowWindowMs>0&&Number.isSafeInteger(p.bookMaxAgeMs)&&p.bookMaxAgeMs>0&&p.bookMaxAgeMs<=3000,'EVENT_PRESET_WINDOW','확정 봉 구간과 3초 이내의 호가 기간을 확인하세요.');return p;
}
/** Produces ordinary editable v2 nodes and edges; compositions are presentation only. */
export function createEventScalpingPreset({mode='QUANT',instrumentId='crypto:upbit:BTC-ETH',timeframe='1m',execution='ACCOUNT',params={}}={}){
 check(['QUANT','JEV'].includes(mode)&&typeof instrumentId==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9_.:@/-]{0,199}$/.test(instrumentId)&&MICROSTRUCTURE_TIMEFRAMES.includes(timeframe)&&['ACCOUNT','PAPER'].includes(execution),'EVENT_PRESET_SCOPE','퀀트·JEV 유형, 종목과 분봉을 확인하세요.');
 const p=settings(params),jev=mode==='JEV',nodes=[],edges=[],groups={market:[],entry:[],selection:[],protection:[],execution:[]};
 const add=(type,id,label,config,group)=>{const index=groups[group].length,column={market:0,entry:1,selection:2,protection:3,execution:4}[group],n=createDecisionStrategyNode(type,{id,config,position:{x:40+column*360,y:40+index*145}});n.label=label;nodes.push(n);groups[group].push(id);return id;};
 const edge=(from,to,fromPort,toPort)=>edges.push({id:from+'-'+to+'-'+toPort,from:{nodeId:from,port:fromPort},to:{nodeId:to,port:toPort}});
 const micro=(id,metricId,label)=>add('INPUT',id,label,{kind:'MICROSTRUCTURE',instrumentId,timeframe,metricId,required:true,maxAgeMs:p.bookMaxAgeMs,lookbackBars:p.lookbackBars,flowWindowMs:p.flowWindowMs,bookMaxAgeMs:p.bookMaxAgeMs},'market');
 const position=(id,metricId,label,group='protection')=>add('INPUT',id,label,{kind:'POSITION',instrumentId,metricId,required:true,maxAgeMs:p.bookMaxAgeMs},group);
 const condition=(id,input,operator,value,label,group='entry')=>{add('CONDITION',id,label,{operator,value},group);edge(input,id,'data','value');};
 const quant=(id,input,label,{action='buy',weight=p.entryWeight,intent=null}={},group='entry')=>{add('QUANT',id,label,{mode:'CONDITION',onTrue:action,onFalse:'hold',buyTargetWeight:weight,sellTargetWeight:0,...(intent?{[action+'Intent']:intent}:{})},group);edge(input,id,'condition','signal');};
 const route=(id,input,yes,no,label,group)=>{add('DECISION_ROUTER',id,label,{mode:'CONDITION'},group);edge(input,id,'condition','condition');edge(yes,id,'decision','true');edge(no,id,'decision','false');};
 micro('rvol','RVOL',`직전 ${p.lookbackBars}봉 평균 대비 거래량`);micro('return','RETURN_1','직전 확정 봉 수익률');micro('breakout','BREAKOUT_RATIO','직전 고가 돌파율');micro('spread','SPREAD_BPS','현재 호가 차이');
 position('has-position','HAS_POSITION','현재 보유 여부','selection');position('position-return','UNREALIZED_RETURN','진입 비용 포함 평가 수익률');position('held-hours','HOURS_HELD','현재 포지션 보유 시간');
 condition('volume-ready','rvol','gte',p.rvolMin,'거래량 확산 조건');condition('return-ready','return','gte',p.returnMin,'상승 지속 조건');condition('breakout-ready','breakout','gte',p.breakoutMin,'직전 고가 돌파 조건');condition('spread-ready','spread','lte',p.maxSpreadBps,'호가 차이 한도');
 add('BOOLEAN_LOGIC','entry-ready','진입 조건 모두 충족',{operation:'ALL'},'entry');for(const id of ['volume-ready','return-ready','breakout-ready'])edge(id,'entry-ready','condition','conditions');
 quant('entry','entry-ready','거래량 돌파 진입',{weight:p.entryWeight,intent:'ENTRY'});quant('press','entry-ready','강한 확산에 더 큰 진입',{weight:p.pressWeight,intent:'ENTRY'});
 // HAS_POSITION is boolean and known even when flat. WAIT must not depend on the
 // unavailable flat-position numeric return or on a failed market entry input.
 add('QUANT','wait','관망',{mode:'CONDITION',onTrue:'hold',onFalse:'hold',buyTargetWeight:p.entryWeight,sellTargetWeight:0},'selection');edge('has-position','wait','data','signal');
 let entrySelector;
 if(jev){
  micro('market-context','SNAPSHOT','체결·호가 관측 전체');position('position-context','SNAPSHOT','이 마인드의 현재 포지션','selection');
  const candidates=[{id:'VOLUME_BREAKOUT',label:'거래량 돌파 진입',description:`entry 후보가 buy이면 목표 비중 ${p.entryWeight}. 필수 진입 조건이 false여서 hold이면 우회하여 매수할 수 없다.`},{id:'PRESS',label:'강한 확산에 더 큰 진입',description:`press 후보가 buy이면 목표 비중 ${p.pressWeight}. 호가 깊이·비용·추세 확산이 뒷받침될 때 더 큰 진입을 선택한다. 물타기나 레버리지는 사용하지 않는다.`},{id:'WAIT',label:'관망',description:'거래하지 않고 현금을 유지한다. 확산이 약하거나 비용 대비 기대 움직임이 부족하면 선택한다.'}];
  add('JEV_QUESTION','entry-choice','공격적 진입 후보 선택',{provider:'JEV',reuseWindowMs:60000,question:{schemaVersion:1,contractVersion:JEV_QUESTION_CONTRACT,id:'entry-choice',type:'choice',instructions:[
   '연결된 entry/press DECISION 두 개, 현재 체결·호가 SNAPSHOT, 이 마인드의 POSITION SNAPSHOT만 사용해 다음 진입을 선택한다. 미래 수익률과 이후 시장 자료를 추측해 사실로 쓰지 않는다.',
   '거래량·가격 돌파의 확산과 매수 체결의 연속성이 강하고 관측 깊이가 충분하면 PRESS를 적극 고려한다. 조건이 약하거나 스프레드·왕복 비용·불균형·급등 추격 위험이 기대 움직임보다 크면 WAIT를 선택한다. 수익 가능성이 작은 거래를 횟수만 늘리려고 만들지 않는다.',
   '후보의 action이 hold이면 후보 이름과 관계없이 매수하지 못한다. 사용자가 설정한 현물 목표 비중과 RISK·ORDER의 비중, 최소 주문, 관측 호가 한도를 따른다. 차입과 레버리지는 사용하지 않는다.',
   `RVOL은 현재 확정 봉 BASE 수량 / 직전 ${p.lookbackBars}개 확정 봉 BASE 수량의 산술평균이다. 현재 봉은 분모에서 제외한다. quote turnover나 60봉 중앙값이 아니다.`,
   '확률은 선택의 모델 판단 분포이며 실제 매매 승률이 아니다. 보유 중 손절·익절·시간 종료는 이 질문을 거치지 않는 정량 보호 경로가 수행한다.',
  ],candidates}},'selection');
  for(const id of ['entry','press'])edge(id,'entry-choice','decision','context');for(const id of ['market-context','position-context'])edge(id,'entry-choice','data','context');
  add('DECISION_ROUTER','candidate-choice','JEV가 선택한 후보',{mode:'CHOICE',cases:candidates.map(c=>({id:c.id,label:c.label}))},'selection');edge('entry-choice','candidate-choice','value','selector');for(const [key,id]of [['VOLUME_BREAKOUT','entry'],['PRESS','press'],['WAIT','wait']])edge(id,'candidate-choice','decision','case:'+key);
  route('entry-eligibility','entry-ready','candidate-choice','wait','진입 조건 확인','selection');entrySelector='entry-eligibility';
 }else{
  condition('press-ready','rvol','gte',p.pressRvolMin,'더 강한 거래량 확산','selection');route('candidate-choice','press-ready','press','entry','퀀트 진입 크기 선택','selection');entrySelector='candidate-choice';
 }
 route('spread-filter','spread-ready',entrySelector,'wait','비용 공통 필터','selection');
 condition('stop-ready','position-return','lte',-p.stopLossRatio,'손절 도달','protection');condition('profit-ready','position-return','gte',p.takeProfitRatio,'익절 도달','protection');condition('time-ready','held-hours','gte',p.maxHoldMinutes/60,'최대 보유 시간 도달','protection');
 quant('stop-exit','stop-ready','손절 전량 종료',{action:'sell',intent:'STOP_LOSS'},'protection');quant('profit-exit','profit-ready','익절 전량 종료',{action:'sell',intent:'TAKE_PROFIT'},'protection');quant('time-exit','time-ready','시간 종료 또는 유지',{action:'sell',intent:'EXIT'},'protection');
 route('profit-priority','profit-ready','profit-exit','time-exit','익절 우선, 그 다음 시간 종료','protection');route('stop-priority','stop-ready','stop-exit','profit-priority','손절 최우선 보호','protection');
 add('DECISION_ROUTER','position-route','보유 중 보호 · 미보유 진입',{mode:'CONDITION'},'selection');edge('has-position','position-route','data','condition');edge('stop-priority','position-route','decision','true');edge('spread-filter','position-route','decision','false');
 add('RISK','risk','공통 현물 위험 한도',{maxExposure:p.maxExposure,maxOrderWeight:p.maxOrderWeight,minConfidence:p.minConfidence},'execution');edge('position-route','risk','decision','decision');
 add('ORDER','order','계좌의 관측 지정가 주문',{execution,sizing:'TARGET_WEIGHT',orderType:p.orderType,maxSlippageBps:p.maxSlippageBps},'execution');edge('risk','order','approved','approved');
 const names={market:'관측 시장 입력',entry:'공통 거래량 돌파 후보',selection:jev?'JEV 후보 선택과 보유 분기':'퀀트 후보 선택과 보유 분기',protection:'보유 중 정량 보호',execution:'공통 위험·주문 한도'};
 const graph={schemaVersion:2,contractVersion:'mind-strategy-decision-graph-v2',triggers:['manual','closed_bar','market_event'],nodes,edges,outputNodeId:'order',compositions:Object.entries(groups).filter(([,ids])=>ids.length>=2).map(([id,nodeIds])=>({id:'scalp-'+id,name:names[id],nodeIds,collapsed:false,version:1}))};
 compileStrategyGraph(graph);
 const metadata={contractVersion:EVENT_STRATEGY_PRESET_VERSION,id:jev?'EVENT_JEV_AGGRESSIVE':'EVENT_QUANT_VOLUME_BREAKOUT',mode,instrumentId,timeframe,execution,graphHash:strategyGraphHash(graph),params:clone(p),editable:true,executionSource:'CANONICAL_FLAT_V2_GRAPH',compositions:'PRESENTATION_MEMBERSHIP_ONLY',candidates:['VOLUME_BREAKOUT','PRESS','WAIT'],pressPolicy:'LARGER_FLAT_ENTRY_NOT_HOLDING_ADD_OR_LOSS_AVERAGING',protectivePriority:['STOP_LOSS','TAKE_PROFIT','TIME_EXIT','HOLD'],protectiveBypassesJev:true,positionRouter:'HAS_POSITION_SHORT_CIRCUITS_FLAT_UNAVAILABLE_NUMERIC_POSITION_INPUTS',rvolDefinition:{numerator:'LAST_CONFIRMED_BAR_BASE_VOLUME',denominator:'ARITHMETIC_MEAN_PREVIOUS_CONFIRMED_BASE_VOLUMES',lookbackBars:p.lookbackBars,excludeCurrentFromDenominator:true,quoteTurnover:false,median:false},jev:jev?{questionNodeId:'entry-choice',reuseWindowMs:60000,entryGateNodeId:'entry-eligibility',entryConditionNodeId:'entry-ready',ineligiblePolicy:'WAIT_WITHOUT_PROVIDER',connectedContexts:['entry:DECISION','press:DECISION','market-context:MICROSTRUCTURE_SNAPSHOT','position-context:POSITION_SNAPSHOT'],confidencePolicy:'PRESERVED_IN_QUESTION_TRACE_NOT_PROMOTED_TO_WIN_RATE_OR_VIBE_RISK_CONFIDENCE',calls:0}:null,validation:'FACTORY_COMPILES_CANONICAL_GRAPH_NOT_A_BACKTEST_RESULT',liveOrders:0};
 return {id:metadata.id,label:jev?'공격적 JEV 거래량 스캘핑':'퀀트 거래량 돌파 스캘핑',graph,metadata};
}
export const createEventQuantScalpingGraph=options=>createEventScalpingPreset({...options,mode:'QUANT'}).graph;
export const createEventJevScalpingGraph=options=>createEventScalpingPreset({...options,mode:'JEV'}).graph;
export function createEventStrategyPresets(options={}){return {quant:createEventScalpingPreset({...options,mode:'QUANT'}),jev:createEventScalpingPreset({...options,mode:'JEV'})};}
