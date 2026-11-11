import {STRATEGY_NODE_REGISTRY} from './strategy-node-registry.mjs';
import {strategyParameters,parameterLiteral,parameterValue,applyParameterValue} from './strategy-parameters.mjs';
import {decisionNumericUnit} from './strategy-decision-graph.mjs';
import {getInstrument} from './instruments.mjs';
import {microstructureMetric} from './microstructure-input.mjs';
import {positionInputMetric} from './position-input.mjs';
import {quantInputMetric} from './quant-input-catalog.mjs';

export const STRATEGY_GUIDE_VERSION='strategy-standard-guide-v1';
const definitions=new Map(STRATEGY_NODE_REGISTRY.map(d=>[d.type,d]));
const action={buy:'매수',hold:'보유',sell:'매도'},operators={gt:'보다 큼',gte:'이상',lt:'보다 작음',lte:'이하',eq:'같음',neq:'다름'},timeframes={'1m':'1분봉','3m':'3분봉','5m':'5분봉','1h':'1시간봉','4h':'4시간봉','1d':'일봉'};
const families={VAMP_LINEAR:'VAMP 선형 예측',OWN_STATE_VALUE_FOREST:'내 포지션 행동가치 모델',HOURLY_VALUE_FOREST:'비용 포함 종목 선택 모델',HOURLY_PATH_FOREST:'가격 경로 예측 모델'};
const modules={SMA_TREND:'이동평균 추세',MOMENTUM:'가격 모멘텀',MEAN_REVERSION:'평균 회귀',BTC_DOC9:'BTC 기준모델',OPPORTUNITY:'기회 집중'};
const factor={MOMENTUM:'수익률',VOLATILITY:'변동성',QUOTE_VOLUME:'거래대금',SMA_DISTANCE:'이동평균 이격',BREAKOUT:'돌파율',BUY_QUOTE_RATIO_5M:'5분 매수 체결대금 비율',MID_RETURN_5M:'5분 중간 호가 수익률'};
const inputs={OHLCV:'확정 시세',METRIC:'투자 지표',POSITION:'내 포지션',MICROSTRUCTURE:'체결·호가',ASSET_SET:'후보 종목',EXECUTION_ASSET:'현재 평가 종목',SELECTION:'이번 종목 선정 결과',CAMPAIGN:'운용 종료 상태',CONTEXT:'투자 자료',MEMORY:'승인된 기억',KNOWLEDGE:'연결 자료'};
export const strategyGuideLabel=node=>!node?'연결할 노드':node.type==='ORDER'&&node.config?.execution==='ACCOUNT'&&(!node.label||['모의 주문','ORDER',node.id].includes(node.label))?'계좌 주문':node.label&&node.label!==node.type?node.label:definitions.get(node.type)?.defaultLabel??({COMBINER:'신호 결합',ROUTER:'신호 선택',JEV:'AI 판단'})[node.type]??node.type;
export function strategyGuideValue(value,unit=null){
 if(value===null||value===undefined)return '설정 필요';
 if(typeof value==='boolean')return value?'참':'거짓';
 if(typeof value!=='number')return timeframes[value]??String(value);
 if(!Number.isFinite(value))return '값 확인 필요';
 const number=n=>new Intl.NumberFormat('ko-KR',{maximumFractionDigits:8}).format(n);
 return ['ratio','probability'].includes(unit)?number(value*100)+'%':unit==='ms'?(value>=3600000&&value%3600000===0?number(value/3600000)+'시간':value>=60000?number(value/60000)+'분':number(value/1000)+'초'):number(value)+({bps:' bp',count:'개',signed_score:'점',score:'점',seconds:'초',minutes:'분',hours:'시간'}[unit]??'');
}
const instrument=id=>{if(id==='execution:current')return '이번에 평가하는 종목';try{const i=getInstrument(id);return i.symbol+' / '+i.venue;}catch{return id??'연결 종목';}};

/** A guide reads the exact same literal/binding rules as the graph; it never evaluates a node. */
function context(graph,node){
 const incoming=graph.edges.filter(e=>e.to.nodeId===node.id),outgoing=graph.edges.filter(e=>e.from.nodeId===node.id),byId=new Map(graph.nodes.map(n=>[n.id,n])),bindings=[];let config=node.config??{};
 const specs=strategyParameters(node);
 for(const spec of specs){const edge=incoming.find(e=>e.to.port===spec.portId);if(!edge)continue;const source=byId.get(edge.from.nodeId);let resolved=null;if(source?.type==='VALUE')resolved=parameterValue(spec,source.config.value,source.config.unit??(source.config.dataType==='NUMBER'?'scalar':null));if(resolved?.ready)config=applyParameterValue(config,spec,resolved.value);bindings.push({key:spec.key,label:spec.label,sourceNodeId:source?.id??edge.from.nodeId,sourceLabel:strategyGuideLabel(source),edgeId:edge.id,status:resolved?.ready?'FIXED':source?.type==='VALUE'?'INVALID':'RUNTIME',value:resolved?.ready?resolved.value:null,unit:spec.unit??decisionNumericUnit(source),reason:resolved?.message??null});}
 const c=config,name=id=>strategyGuideLabel(byId.get(id)),binding=key=>bindings.find(b=>b.key===key),raw=key=>c[key]??c.parameters?.[key];
 const p=(key,unit=null)=>{const b=binding(key);return b&&b.status!=='FIXED'?(b.status==='INVALID'?'연결값의 단위·범위 확인':b.sourceLabel+'의 판단값'):strategyGuideValue(raw(key),b?.unit??unit??specs.find(s=>s.key===key)?.unit);};
 const source=port=>{const e=incoming.find(e=>e.to.port===port);return e?name(e.from.nodeId):'연결할 입력';};
 const facts=[],add=(label,value,rawValue=null)=>{if(value!==undefined&&value!==null)facts.push({label,value:String(value),raw:rawValue===null?null:String(rawValue)});};
 const upstream=incoming.find(e=>e.to.port==='value')??incoming.find(e=>!e.to.port.startsWith('param:')),upstreamNode=byId.get(upstream?.from.nodeId),unit=decisionNumericUnit(upstreamNode)??(upstreamNode?.type==='ASSET_METRIC'&&upstreamNode.config.metric!=='QUOTE_VOLUME'?'ratio':null);
 return {graph,node,c,incoming,outgoing,byId,bindings,p,raw,source,name,facts,add,unit};
}

export const STRATEGY_GUIDE_TEMPLATES=Object.freeze({
 ASSET_REDUCE:x=>{x.add('집계',x.c.operation==='MEDIAN'?'중앙값':'양수 종목 비율');return '동일 시점의 종목별 지표를 하나의 시장 전체 지표로 모아요. 자료가 부족하면 계산을 기다려요.';},
 MARKET_STATE:x=>{x.add('관측 기간',x.c.lookback+'봉');return '결정 시점까지 확정된 가격·거래량으로 시장 국면과 상태 변수를 계산해요.';},
 PORTFOLIO_EXPERT:x=>{x.add('전략',x.c.mode);x.add('최대 종목 수',x.c.maxPositions);return '이 전략의 코인·현금 목표 비중을 만들고 라우터가 비교할 후보로 전달해요.';},
 PORTFOLIO_ROUTER:x=>{x.add('학습 기간',x.c.trainingBars+'봉');x.add('성과 관측 기간',x.c.horizonHours+'시간');return '관측이 끝난 과거 성과와 현재 국면으로 후보 전략의 목표 비중을 선택해요. 미래 수익이 확정된다는 뜻은 아니에요.';},
 REGIME_INPUT:x=>{x.add('시장 변수',x.c.inputId??'입력 연결 필요');x.add('자료형',x.c.valueType);return '시장 전체 판단에 사용할 명시적인 입력 변수를 다음 노드에 연결해요.';},
 CHOICE_LIST:x=>{for(const item of x.c.items??[])x.add(item.label??item.id,item.description??item.id);return '판단기와 라우터가 같은 선택지 목록을 함께 읽어요.';},
 REGIME_CLASSIFIER:x=>{x.add('판단 방식',x.c.kind==='AXES'?'설정된 두 축':'AI 선택');if(x.c.periodMs!==undefined)x.add('갱신 간격',strategyGuideValue(x.c.periodMs,'ms'));if(x.c.question)x.add('질문',x.c.question);if(x.c.kind==='AXES')for(const axis of ['x','y'])if(x.c[axis])x.add(x.c[axis].label,'중심 '+x.c[axis].center+' / 단위 '+x.c[axis].scale);return '연결된 시장 변수와 선택지를 읽어 지금 적용할 경우를 판단해요.';},
 STRATEGY_REFERENCE:x=>{x.add('전략 버전',x.c.model?'v'+x.c.model.version:'전략 연결 필요');x.add('참조 전략',x.c.model?.id);return '저장한 전체 전략 버전을 이 선택의 실행 대상으로 연결해요.';},
 REGIME_ROUTER:x=>{x.add('전략 인계',x.c.handover==='DRAIN'?'기존 전략이 자기 보유를 정리한 뒤 인계':x.c.handover);if(x.c.minimumDwellMs!==undefined)x.add('최소 유지 시간',strategyGuideValue(x.c.minimumDwellMs,'ms'));return '선택된 경우에 연결된 전체 전략 버전으로 이어가요.';},
 INPUT:x=>{const {c,p,add}=x,metric=c.kind==='MICROSTRUCTURE'?microstructureMetric(c.metricId):c.kind==='POSITION'?positionInputMetric(c.metricId):c.kind==='METRIC'?quantInputMetric(c.metricId):null;add('자료',metric?.label??inputs[c.kind]??c.kind);if(c.instrumentId)add('종목',x.bindings.find(b=>b.key==='instrumentId')?.status==='RUNTIME'?p('instrumentId'):instrument(c.instrumentId));if(c.timeframe)add('읽는 주기',p('timeframe'));if(c.lookback!==undefined)add('읽는 기간',p('lookback','scalar')+'봉');if(c.lookbackBars!==undefined)add('관측 봉 수',p('lookbackBars','scalar')+'봉');for(const [key,title]of [['maxAgeMs','자료 유효 기간'],['flowWindowMs','체결 집계 기간'],['bookMaxAgeMs','호가 유효 기간'],['cooldownMs','재실행 대기']])if(c[key]!==undefined)add(title,p(key,'ms'));if(c.windowBars!==undefined)add('관측 구간',p('windowBars','count'));add('입력 상태',c.enabled===false?'사용 해제':c.required?'필수 자료':'선택 자료');return (metric?.label??inputs[c.kind]??'연결 자료')+' 자료를 읽어 다음 노드에 전달해요.';},
 VALUE:x=>{x.add('값',strategyGuideValue(x.c.value,x.c.unit),x.c.value);x.add('자료형',({NUMBER:'숫자',BOOLEAN:'참·거짓',TEXT:'글',INSTRUMENT:'종목',INSTRUMENT_SET:'종목 목록',TIMEFRAME:'봉 주기'})[x.c.dataType]);return '이 값은 연결된 노드의 변수로 사용돼요. 값을 바꾸면 그 변수를 사용하는 노드가 함께 읽어요.';},
 SIGNAL:x=>{const {c,p,add}=x;add('계산법',modules[c.moduleId]??c.moduleId);for(const [key,title,unit]of [['lookbackBars','비교 기간','count'],['window','이동평균 기간','count'],['scale','기준 변화율','ratio'],['entryDeviation','진입 이격','ratio'],['exitDeviation','종료 이격','ratio'],['maWindow','이동평균 기간','count'],['buyThreshold','매수 기준',null],['sellThreshold','매도 기준',null],['shortWindow','단기 기간','count'],['longWindow','장기 기간','count'],['minOpportunity','기회 기준',null]])if(c.parameters?.[key]!==undefined)add(title,['lookbackBars','window','maWindow','shortWindow','longWindow'].includes(key)?p(key,'scalar')+'봉':p(key,unit));return (modules[c.moduleId]??'선택한 계산법')+'으로 가격 신호를 만들어요. 양수와 음수의 강도가 다음 판단에 전달돼요.';},
 CONDITION:x=>{const target=x.c.rightOperand==='INPUT'?x.source('compare'):x.p('value',x.unit);x.add('비교 조건',x.source('value')+' '+operators[x.c.operator]+' '+target);return x.source('value')+' 값이 '+target+' '+operators[x.c.operator]+'인지 확인해요. 결과는 참 또는 거짓으로 전달돼요.';},
 BOOLEAN_LOGIC:x=>{x.add('결합',({ALL:'모두 충족',ANY:'하나 이상 충족',NOT:'참·거짓 반전'})[x.c.operation]);x.add('연결 조건',x.incoming.filter(e=>!e.to.port.startsWith('param:')).length+'개');return ({ALL:'연결한 조건이 모두 참일 때 참을 전달해요.',ANY:'연결한 조건 중 하나라도 참이면 참을 전달해요.',NOT:'연결한 조건의 참과 거짓을 뒤집어요.'})[x.c.operation];},
 QUANT:x=>{const {c,p,add}=x;if(c.mode==='CONDITION'){add('조건이 참이면',action[c.onTrue]);add('조건이 거짓이면',action[c.onFalse]);}else{add('매수 신호 기준',p('buyAbove','signed_score'));add('매도 신호 기준',p('sellBelow','signed_score'));}if(c.targetMode==='WEIGHT_DELTA'){add('매수 비중 증가',p('buyWeightDelta','ratio')+'p');add('매도 비중 감소',p('sellWeightDelta','ratio')+'p');}else{add('매수 목표 비중',p('buyTargetWeight','ratio'));add('매도 목표',c.sellTargetQuantity!==undefined?c.sellTargetQuantity+'개 남김':c.sellPositionFraction!==undefined?'현재 보유의 '+p('sellPositionFraction','ratio')+' 매도':p('sellTargetWeight','ratio'));}return '연결한 '+(c.mode==='CONDITION'?'조건':'신호 점수')+'를 매수·보유·매도 행동과 포지션 크기로 바꿔요.';},
 JEV_QUESTION:x=>{const q=x.c.question??{};x.add('질문',typeof q.instructions==='string'?q.instructions:JSON.stringify(q.instructions??{}));x.add('응답',({choice:'선택지',score:'점수',noul:'확률'})[q.type]);if(q.candidates)x.add('선택지',q.candidates.map(c=>c.label??c.id).join(' / '));if(x.c.reuseWindowMs)x.add('판단 유지',strategyGuideValue(x.c.reuseWindowMs,'ms'));return '연결된 근거와 이 질문을 AI에 전달하는 지점이에요. AI의 답은 뒤에 연결된 비교나 선택 노드에서 사용해요.';},
 VIBE:x=>{x.add('판단 지침',x.c.instructions||'이 마인드의 원칙 적용');return '연결된 자료와 마인드 원칙, 이 지침을 모아 AI의 매수·보유·매도 판단을 구성해요.';},
 DECISION_ROUTER:x=>{x.add('선택 방식',({CONDITION:'조건의 참·거짓',CHOICE:'선택지',SELECT:'지정된 결정'})[x.c.mode]);x.add('전달 대상',x.c.payload==='ORDER_PLAN'?'주문 계획':'투자 결정');return x.c.mode==='CONDITION'?x.source('condition')+'의 결과에 따라 두 결정 중 하나를 선택해요. 조건별 결정을 선택하세요.':x.c.mode==='CHOICE'?x.source('selector')+'가 고른 선택지의 결정을 전달해요. 선택지마다 어떤 판단이 준비되어 있는지 살펴볼 수 있어요.':x.name(x.c.selectedNodeId)+'의 결정을 선택해 다음 단계로 전달해요.';},
 DECISION_MIXER:x=>{const total=(x.c.weights??[]).reduce((s,w)=>s+w.value,0);x.add('결합 방식',x.c.mode==='TARGET_BLEND'?'목표 비중의 가중 평균':'행동별 가중 투표');for(const w of x.c.weights??[])x.add(x.name(w.nodeId),total>0?strategyGuideValue(w.value/total,'ratio'):'가중치 합계 확인',w.value);return x.c.mode==='TARGET_BLEND'?'각 결정의 목표 비중을 합산하고 현재 보유 비중과 비교해 매수·보유·매도를 정해요.':'가중치가 가장 큰 행동을 선택하고, 그 행동에 참여한 결정들의 목표 비중을 결합해요. 같은 득표는 보유로 이어져요.';},
 MODEL:x=>{const {c,add}=x,m=c.model;add('모델',families[c.family]??c.family);if(m?.timeframe)add('학습 주기',strategyGuideValue(m.timeframe));if(m?.horizonBars!==undefined)add('예측 구간',m.horizonBars+'봉');add('학습 표본',m?.training?.sampleCount??'학습 자료 연결 필요');return '입력 자료를 저장된 모델로 계산하고 예측값을 전달해요. 뒤의 비교·행동 노드가 이 예측을 실제 포지션 판단에 사용해요.';},
 SESSION_RULE:x=>{for(const [key,title]of [['symbol','종목'],['ruleVersion','규칙'],['splits','분할 횟수'],['family','계산 방식']])if(x.c[key]!==undefined)x.add(title,x.p(key));if(x.c.maxExposure!==undefined)x.add('운용 비중',x.p('maxExposure','ratio'));return '현재 분할매수 세션의 진행 상태와 이 규칙으로 다음 주문 계획을 만들어요.';},
 SESSION_SIGNAL:x=>{if(x.c.mode==='STRUCTURE'){x.add('판단 기준','가격 구조');x.add('고점 대비 하락',x.p('trailingDrawdown','ratio'));x.add('연속 확인',x.p('confirmationDays')+'거래일');x.add('장기 회복 조건',x.c.longTrendGuard?'60일 수익률 양수':'사용 해제');}else{x.add('이동평균 기간',x.p('lookback')+'거래일');x.add('기울기 확인',x.p('slopeDays')+'거래일');x.add('이격 범위',x.p('band','ratio'));}return '확정된 시장 가격에서 추세와 회복 신호를 계산해 국면 선택에 전달해요.';},
 SESSION_TREND:x=>{x.add('종목',x.c.symbol);x.add('목표 비중',x.p('targetWeight','ratio'));x.add('조정 기준',x.p('rebalancingBand','ratio'));if(x.c.volatilityTarget!==undefined)x.add('변동성 목표',x.p('volatilityTarget','ratio'));return '추세 구간에서 이 목표 비중을 유지하는 주문 계획을 만들어요.';},
 FILTER:x=>{x.add('조건 결합',x.c.conditionMode==='ANY'?'하나 이상':'모두');for(const t of x.c.conditions??[])x.add((factor[t.metric]??t.metric)+' / '+t.lookback+'봉',operators[t.operator]+' '+strategyGuideValue(t.value,t.metric==='QUOTE_VOLUME'?null:'ratio'),t.value);if(x.c.minHistoryBars!==undefined)x.add('최소 이력',x.c.minHistoryBars+'봉');if(x.c.minQuoteVolume!==undefined)x.add('최소 거래대금',strategyGuideValue(x.c.minQuoteVolume));if(x.c.maxSpreadBps!==undefined)x.add('최대 호가 차이',strategyGuideValue(x.c.maxSpreadBps,'bps'));x.add('유의 종목',x.c.excludeWarnings?'제외':'포함');return '후보 종목 중 이 조건을 통과한 종목만 다음 순위·선택 단계로 넘겨요.';},
 ASSET_METRIC:x=>{x.add('지표',factor[x.c.metric]??x.c.metric);x.add('계산 기간',x.p('lookback','scalar')+'봉');return '같은 지표를 후보 종목마다 계산해 종목별 값을 만들어요.';},
 ASSET_COMPARE:x=>{x.add('비교 조건',operators[x.c.operator]+' '+x.p('value',x.unit));return '각 종목의 지표를 기준값과 비교하고 종목별 참·거짓을 만들어요.';},
 ASSET_LOGIC:x=>{x.add('조건 결합',({ALL:'모두 충족',ANY:'하나 이상',NOT:'반전'})[x.c.operation]);return '같은 종목에 대한 조건들을 조합해 그 종목의 최종 통과 여부를 정해요.';},
 ASSET_FILTER:x=>'연결한 종목별 조건을 통과한 후보 집합을 다음 단계로 전달해요.',
 RANK:x=>{for(const t of x.c.terms??[])x.add((factor[t.metric]??t.metric)+' / '+t.lookback+'봉','가중치 '+strategyGuideValue(t.weight));x.add('정렬',x.c.direction==='DESC'?'높은 점수부터':'낮은 점수부터');if(x.c.scoreNormalization)x.add('점수 보정',x.c.scoreNormalization==='VOLATILITY'?'변동성 기준':'원 지표');if(x.c.normalizationLookback!==undefined)x.add('보정 기간',x.c.normalizationLookback+'봉');if(x.c.minScore!==null&&x.c.minScore!==undefined)x.add('최소 점수',strategyGuideValue(x.c.minScore));return '후보들의 점수를 계산해 순위를 만들어요. 다음 선택 노드가 몇 종목을 가져갈지 정해요.';},
 SELECT:x=>{x.add('선택 개수',x.p('maxPositions','count'));return '연결된 순위에서 상위 '+x.p('maxPositions','count')+'를 선택해요. 선택된 종목 집합이 이후의 포함 여부와 자금 배분에 사용돼요.';},
 MEMBER:x=>'이번에 평가하는 종목이 선택된 후보 집합 안에 있는지 참·거짓으로 전달해요.',
 ALLOCATE:x=>{x.add('배분 방식',x.c.method==='EQUAL'?'동일 비중':'역변동성');for(const [k,t]of [['minBudget','최소 운용 비중'],['maxBudget','최대 운용 비중'],['maxAssetWeight','종목별 상한']])if(x.c[k]!==undefined)x.add(t,x.p(k,'ratio'));x.add('최대 보유 종목',x.p('maxPositions','count'));return '선택된 종목마다 이 방식과 범위에 맞는 목표 자금 비중을 계산해요.';},
 REBALANCE:x=>{x.add('확인 간격',x.p('everyDays')+'일');x.add('최소 비중 차이',x.p('minWeightChange','ratio')+'p');return '현재 보유와 목표 배분을 비교해 조정할 종목과 비중을 정해요.';},
 RISK:x=>{for(const [k,t]of [['maxExposure','최대 보유 비중'],['maxOrderWeight','한 번에 변경할 비중'],['minConfidence','최소 확신도']])if(x.c[k]!==undefined)x.add(t,x.p(k,'ratio'));return '앞 단계의 결정이 이 노드에 설정된 보유·주문 조건을 통과하는지 검사해요. 통과한 계획이 주문 노드로 이어져요.';},
 ORDER:x=>{x.add('실행 대상',x.c.execution==='ACCOUNT'?'지정 운용 계좌':'모의 계좌');x.add('수량 계산',x.c.sizing==='SESSION_ORDERS'?'세션 주문 계획':'목표 비중 추종');if(x.c.brokerId)x.add('거래소',x.c.brokerId);if(x.c.sessionOrderPolicy)x.add('주문 정책',x.c.sessionOrderPolicy);if(x.c.orderType)x.add('주문 방식',({LIMIT_FOK:'즉시 전량 체결',LIMIT_IOC:'즉시 가능한 수량 체결',MARKET:'시장가'})[x.c.orderType]??x.c.orderType);if(x.c.maxSlippageBps!==undefined)x.add('가격 한도',strategyGuideValue(x.c.maxSlippageBps,'bps'));if(x.c.takeProfitBps){x.add('익절 가격 상승률',(x.c.takeProfitBps/100)+'%');x.add('매수 수량의 매도 비율',(x.c.takeProfitFraction*100)+'%');}return '앞에서 정한 목표 비중 또는 세션 계획을 실행 모드에 맞는 주문 요청으로 전달하는 마지막 단계예요.';},
 COMBINER:x=>{const total=(x.c.weights??[]).reduce((s,w)=>s+w.value,0);for(const w of x.c.weights??[])x.add(x.name(w.nodeId),total?strategyGuideValue(w.value/total,'ratio'):'가중치 합계 확인',w.value);return '각 신호를 지정 가중치로 합치고 가중치 합계로 나누어 하나의 신호를 만들어요.';},
 ROUTER:x=>'입력 신호 중 절댓값이 가장 큰 신호를 골라요. 강도가 같으면 노드 식별값 순서로 선택해요.',
 JEV:x=>'마인드 원칙과 시장 자료, 승인된 기억, 연결한 신호를 AI 판단에 전달해 최종 매수·보유·매도를 선택해요.',
});

const comparisonPhrase={gt:'보다 크면',gte:'이상이면',lt:'보다 작으면',lte:'이하면',eq:'과 같으면',neq:'과 다르면'};
function predicate(graph,id,seen=new Set()){
 if(seen.has(id))return strategyGuideLabel(graph.nodes.find(n=>n.id===id));seen.add(id);
 const n=graph.nodes.find(n=>n.id===id);if(!n)return '연결된 조건';const x=context(graph,n),c=x.c;
 if(n.type==='CONDITION')return x.source('value')+' 값이 '+(c.rightOperand==='INPUT'?x.source('compare'):x.p('value',x.unit))+' '+comparisonPhrase[c.operator];
 if(n.type==='BOOLEAN_LOGIC'){const parts=x.incoming.filter(e=>!e.to.port.startsWith('param:')).map(e=>predicate(graph,e.from.nodeId,new Set(seen)));return c.operation==='NOT'?parts[0]+'의 반대 조건이면':parts.join(c.operation==='ANY'?' 또는 ':' 그리고 ');}
 if(n.type==='MEMBER'||n.type==='INPUT'&&c.kind==='SELECTION')return '이번 종목이 선택 목록에 있으면';
 if(n.type==='INPUT'&&c.kind==='POSITION'&&c.metricId==='HAS_POSITION')return '이번 종목을 보유하고 있으면';
 if(n.type==='INPUT'&&c.kind==='POSITION'&&c.metricId==='INTENT_COOLDOWN_READY')return c.profitStepReturn?('현재 포지션에서 다음 '+(c.profitStepReturn*100)+'%p 익절 단계에 도달하면'):c.cooldownScope==='POSITION_ONCE'?'현재 포지션에서 이 익절 구간을 아직 체결하지 않았으면':'이 매도 구간의 대기 '+x.p('cooldownMs','ms')+'이 끝났으면';
 return strategyGuideLabel(n)+' 조건이 맞으면';
}
function conditionView(graph,id,seen=new Set()){
 const node=graph.nodes.find(n=>n.id===id);if(!node||seen.has(id))return {label:strategyGuideLabel(node),value:'조건 확인 필요'};seen.add(id);const x=context(graph,node),c=x.c;
 if(node.type==='BOOLEAN_LOGIC')return {operation:c.operation,items:x.incoming.filter(e=>!e.to.port.startsWith('param:')).map(e=>conditionView(graph,e.from.nodeId,new Set(seen)))};
 if(node.type==='CONDITION')return {label:x.source('value'),value:({gt:'> ',gte:'≥ ',lt:'< ',lte:'≤ ',eq:'= ',neq:'≠ '})[c.operator]+(c.rightOperand==='INPUT'?x.source('compare'):x.p('value',x.unit))};
 if(node.type==='INPUT'&&c.kind==='POSITION'&&c.metricId==='INTENT_COOLDOWN_READY')return c.profitStepReturn?{label:'반복 익절 간격',value:(c.profitStepReturn*100)+'%p',note:'체결 주문마다 다음 단계 · 새 포지션에서 초기화'}:c.cooldownScope==='POSITION_ONCE'?{label:'구간 실행',value:'포지션마다 한 번',note:'전량 청산 후 새 진입에서 초기화'}:{label:'동일 구간 재매도 간격',value:x.p('cooldownMs','ms'),note:'첫 매도는 즉시 가능'};
 if(node.type==='INPUT'&&c.kind==='POSITION'&&c.metricId==='HAS_POSITION')return {label:'현재 평가 종목',value:'보유 중'};
 if(node.type==='MEMBER'||node.type==='INPUT'&&c.kind==='SELECTION')return {label:'현재 평가 종목',value:'선택 목록에 포함'};
 return {label:strategyGuideLabel(node),value:'조건 충족'};
}
function presentation(x,text){
 const headings={INPUT:'어떤 자료를 사용하나요?',VALUE:'어떤 값을 전달하나요?',CONDITION:'어떤 값을 비교하나요?',BOOLEAN_LOGIC:'어떤 조건을 조합하나요?',QUANT:'어떻게 투자하나요?',DECISION_ROUTER:'조건에 따라 어떻게 하나요?',JEV_QUESTION:'AI는 무엇을 판단하나요?',MODEL:'무엇을 예측하나요?',FILTER:'어떤 종목을 남기나요?',RANK:'어떤 순서로 정렬하나요?',SELECT:'몇 종목을 선택하나요?',ALLOCATE:'자금을 어떻게 나누나요?',RISK:'주문 한도는 얼마인가요?',ORDER:'어떤 주문을 보내나요?'};
 const condition=x.node.type==='DECISION_ROUTER'&&x.c.mode==='CONDITION'?conditionView(x.graph,x.incoming.find(e=>e.to.port==='condition')?.from.nodeId):null;
 return {heading:headings[x.node.type]??x.name(x.node.id),statement:condition?'':x.node.type==='DECISION_ROUTER'&&x.c.mode==='CHOICE'?x.source('selector')+'의 선택에 따른 결정을 확인하세요.':text,condition};
}
function actionPhrase(graph,nodeId){
 const n=graph.nodes.find(n=>n.id===nodeId);if(!n)return '연결된 결정';const x=context(graph,n),c=x.c;
 if(n.type==='QUANT'){
  const signal=x.incoming.find(e=>e.to.port==='signal'),source=x.byId.get(signal?.from.nodeId),fixed=source?.type==='VALUE'&&typeof source.config.value==='boolean',a=c.mode==='CONDITION'&&(c.onTrue===c.onFalse||fixed)?(fixed?(source.config.value?c.onTrue:c.onFalse):c.onTrue):null;
  if(a==='hold')return '현재 포지션을 유지해요';
  if(a==='sell'||c.sellIntent==='TAKE_PROFIT'){if(c.sellPositionFraction!==undefined)return '남은 물량의 '+x.p('sellPositionFraction','ratio')+'를 매도해요';if(c.sellTargetQuantity!==undefined)return c.sellTargetQuantity+'개를 남기도록 매도해요';return c.sellTargetWeight===0?'전량 매도해요':'목표 보유 비중을 '+x.p('sellTargetWeight','ratio')+'로 낮춰요';}
  if(a==='buy')return c.targetMode==='WEIGHT_DELTA'?'보유 비중을 '+x.p('buyWeightDelta','ratio')+'p 늘려요':'매수 목표 비중을 '+x.p('buyTargetWeight','ratio')+'로 잡아요';
 }
 if(n.type==='SESSION_TREND')return c.symbol+'의 추세를 따라 '+x.p('targetWeight','ratio')+' 비중으로 운용해요';
 if(n.type==='SESSION_RULE')return c.symbol+' 분할매수 규칙으로 주문을 준비해요';
 if(n.type==='STRATEGY_REFERENCE')return strategyGuideLabel(n)+(c.model?' v'+c.model.version:'')+'을 선택해요';
 return strategyGuideLabel(n)+' 판단으로 이어가요';
}
function narrative(x,fallback){
 const {graph,node,c,p,source,incoming,facts}=x;
 if(node.type==='REGIME_INPUT')return (c.inputId??'연결한 시장 변수')+' 자료를 읽어 시장 판단의 입력으로 보내요.';
 if(node.type==='CHOICE_LIST')return (c.items??[]).length+'개 선택지를 판단기와 라우터에 함께 보내요. 같은 선택지 ID로 판단과 전략이 이어져요.';
 if(node.type==='REGIME_CLASSIFIER')return (c.kind==='AXES'?'설정한 두 축으로':'연결된 시장 입력과 선택지를 AI가 읽어')+' 지금 적용할 경우를 고르고, '+strategyGuideValue(c.periodMs,'ms')+' 간격으로 다시 판단해요.';
 if(node.type==='STRATEGY_REFERENCE')return strategyGuideLabel(node)+(c.model?'의 v'+c.model.version:'')+' 버전을 이 경우의 전체 전략으로 사용해요.';
 if(node.type==='REGIME_ROUTER')return '판단기가 고른 선택지에 연결된 전체 전략으로 이어가요.'+(c.minimumDwellMs?' 최소 '+strategyGuideValue(c.minimumDwellMs,'ms')+' 유지 조건을 함께 읽어요.':'');
 if(node.type==='INPUT'){
  if(['OHLCV','ASSET_SET','MICROSTRUCTURE'].includes(c.kind))return (c.lookbackBars?'최근 '+p('lookbackBars','scalar')+'봉의 ':'')+p('timeframe')+' 자료를 읽어 다음 노드로 보내요.';
  if(c.kind==='EXECUTION_ASSET')return '이번에 판단할 종목을 다음 노드에 알려줘요.';
  return (facts.find(f=>f.label==='자료')?.value??'연결 자료')+'를 읽어 다음 노드로 보내요.';
 }
 if(node.type==='VALUE')return '이 변수의 값은 '+strategyGuideValue(c.value,c.unit)+'예요. 연결된 노드들이 이 값을 함께 읽어요.';
 if(node.type==='CONDITION'){const target=c.rightOperand==='INPUT'?source('compare'):p('value',x.unit),op=c.operator,opposite={gt:'lte',gte:'lt',lt:'gte',lte:'gt',eq:'neq',neq:'eq'}[op];return source('value')+' 값이 '+target+' '+comparisonPhrase[op]+' 참을 보내고, '+target+' '+comparisonPhrase[opposite]+' 거짓을 보내요.';}
 if(node.type==='QUANT'){
  const signal=incoming.find(e=>e.to.port==='signal'),input=x.byId.get(signal?.from.nodeId);if(c.mode==='CONDITION'&&input?.type==='VALUE'&&typeof input.config.value==='boolean')return actionPhrase(graph,node.id)+'.';
  const prefix=c.mode==='CONDITION'?(c.onTrue===c.onFalse?actionPhrase(graph,node.id)+'.':'조건이 맞으면 '+action[c.onTrue]+'하고, 다른 경우에는 '+action[c.onFalse]+'해요.'):'신호가 '+p('buyAbove','signed_score')+' 이상이면 매수하고, '+p('sellBelow','signed_score')+' 이하면 매도해요. 그 사이는 보유해요.';
  if(c.mode==='CONDITION'&&c.onTrue===c.onFalse)return prefix;
  return prefix+'\n'+(c.targetMode==='WEIGHT_DELTA'?'매수 때 비중을 '+p('buyWeightDelta','ratio')+'p 늘리고, 매도 때 '+p('sellWeightDelta','ratio')+'p 줄여요.':c.sellPositionFraction!==undefined?'매도할 때 남은 물량의 '+p('sellPositionFraction','ratio')+'를 팔아요.':c.sellTargetQuantity!==undefined?'매도할 때 '+c.sellTargetQuantity+'개를 남겨요.':'매수 목표는 '+p('buyTargetWeight','ratio')+', 매도 목표는 '+p('sellTargetWeight','ratio')+'예요.');
 }
 if(node.type==='DECISION_ROUTER'){
  if(c.mode==='SELECT')return actionPhrase(graph,c.selectedNodeId)+'.';
  if(c.mode==='CONDITION'){const input=incoming.find(e=>e.to.port==='condition'),yes=incoming.find(e=>e.to.port==='true'),no=incoming.find(e=>e.to.port==='false');return predicate(graph,input?.from.nodeId)+', '+actionPhrase(graph,yes?.from.nodeId)+'.\n다른 경우에는 '+actionPhrase(graph,no?.from.nodeId)+'.';}
  return source('selector')+'가 고른 답에 따라 '+(c.cases??[]).length+'가지 판단 중 하나로 이어가요. 경우별 결정을 선택하세요.';
 }
 if(node.type==='FILTER'){const terms=(c.conditions??[]).map(t=>'최근 '+t.lookback+'봉 '+(factor[t.metric]??t.metric)+'이 '+strategyGuideValue(t.value,t.metric==='QUOTE_VOLUME'?null:'ratio')+' '+comparisonPhrase[t.operator]);return terms.length?terms.join(c.conditionMode==='ANY'?' 또는 ':' 그리고 ')+' 그 종목을 다음 노드로 보내요.':'최소 '+c.minHistoryBars+'봉의 이력과 거래대금 '+strategyGuideValue(c.minQuoteVolume)+' 기준을 통과한 후보를 보내요.';}
 if(node.type==='RANK')return (c.terms??[]).map(t=>'최근 '+t.lookback+'봉 '+(factor[t.metric]??t.metric)+' × '+t.weight).join(' + ')+'로 점수를 만들고, '+(c.direction==='DESC'?'높은':'낮은')+' 순서로 다음 노드에 보내요.';
 if(node.type==='SELECT')return '상위 '+p('maxPositions','count')+' 종목을 뽑아 다음 노드로 보내요.';
 if(node.type==='MEMBER')return '이번에 판단하는 종목이 선택 목록에 있으면 참, 목록 밖에 있으면 거짓을 보내요.';
 if(node.type==='BOOLEAN_LOGIC'&&c.operation==='NOT')return '입력이 참이면 거짓을, 거짓이면 참을 다음 노드로 보내요.';
 if(node.type==='BOOLEAN_LOGIC')return (c.operation==='ALL'?'연결된 조건이 모두 맞으면':c.operation==='ANY'?'연결된 조건 중 하나라도 맞으면':'입력 조건의 참·거짓을 뒤집어')+' 참을 다음 노드에 보내요.';
 if(node.type==='ALLOCATE')return '선택 종목에 자금을 '+(c.method==='EQUAL'?'똑같이':'역변동성 비중으로')+' 나눠요. 한 종목의 상한은 '+p('maxAssetWeight','ratio')+'이고, 최대 '+p('maxPositions','count')+'까지 보유해요.';
 if(node.type==='REBALANCE')return p('everyDays')+'일 간격과 비중 차이 '+p('minWeightChange','ratio')+'p를 기준으로 현재 보유를 목표 비중에 맞춰요.';
 if(node.type==='RISK')return '최대 보유 비중 '+p('maxExposure','ratio')+', 한 번에 변경할 비중 '+p('maxOrderWeight','ratio')+'를 확인해요. 조건을 통과한 계획을 다음 노드로 보내요.';
 if(node.type==='ORDER'&&c.takeProfitBps)return '매수 체결 후 매수가보다 '+(c.takeProfitBps/100)+'% 높은 가격에 매수 수량의 '+(c.takeProfitFraction*100)+'%를 지정가 매도로 등록해요. 나머지 수량은 모델 판단을 따라요. 모델이 청산하면 미체결 지정가를 취소하고 남은 수량을 매도해요.';
 if(node.type==='ORDER')return (c.execution==='ACCOUNT'?'지정한 운용 계좌':'모의 계좌')+'에 '+(c.sizing==='SESSION_ORDERS'?'세션의 주문 계획':'목표 비중에 맞춘 주문 계획')+'을 보내요.'+(c.orderType?'\n주문 방식은 '+(({LIMIT_FOK:'즉시 전량 체결',LIMIT_IOC:'즉시 가능한 수량 체결',MARKET:'시장가'})[c.orderType]??c.orderType):'')+(c.maxSlippageBps!==undefined?', 가격 한도는 '+strategyGuideValue(c.maxSlippageBps,'bps')+'예요.':'');
 if(node.type==='JEV_QUESTION'){const q=c.question??{};return '연결한 '+incoming.filter(e=>!e.to.port.startsWith('param:')).length+'개 근거와 질문을 AI에 전달해요.\n'+(q.type==='choice'?(q.candidates??[]).length+'개 선택지 중 고른 답을':q.type==='noul'?'판단한 확률을':'판단한 점수를')+' 다음 노드로 보내요.';}
 if(node.type==='MODEL')return (timeframes[c.model?.timeframe]??'연결된 시장')+' 자료를 '+(families[c.family]??'학습 모델')+'로 계산해요. 예측한 값을 다음 판단에 보내요.';
 if(node.type==='SESSION_RULE')return c.symbol+'를 '+p('splits')+'회로 나누는 '+c.ruleVersion+' 규칙으로 다음 주문을 준비해요.';
 if(node.type==='SESSION_TREND')return c.symbol+'의 추세를 따라 목표 비중 '+p('targetWeight','ratio')+'로 운용하고, '+p('rebalancingBand','ratio')+' 차이를 기준으로 조정해요.';
 return fallback;
}

export function explainStrategyNode(graph,nodeId){
 const node=graph.nodes.find(n=>n.id===nodeId);if(!node)throw new TypeError('현재 전략에서 읽을 노드를 선택하세요.');
 const x=context(graph,node),template=Object.hasOwn(STRATEGY_GUIDE_TEMPLATES,node.type)?STRATEGY_GUIDE_TEMPLATES[node.type]:null,definition=definitions.get(node.type);
 const destinations=[...new Set(x.outgoing.map(e=>e.to.nodeId))].map(id=>'「'+x.name(id)+'」'),receiver=destinations.length?destinations.join(', ')+' 노드':graph.outputNodeId===node.id?'최종 결과':'미연결 출력';
 const named=text=>text.replace(/다음 (?:노드|단계|판단)|뒤에 연결된 비교나 선택 노드|뒤의 비교·행동 노드/g,receiver).replace('연결된 노드들이',receiver+'가');
 const summary=named(template?template(x):'표준 설명 등록 필요');
 const inbound=x.incoming.map(e=>({edgeId:e.id,nodeId:e.from.nodeId,label:x.name(e.from.nodeId),port:e.to.port,parameter:e.to.port.startsWith('param:')})),next=x.outgoing.map(e=>({edgeId:e.id,nodeId:e.to.nodeId,label:x.name(e.to.nodeId),port:e.to.port}));
 let branches=[];
 if(node.type==='DECISION_ROUTER'){
  const c=node.config,conditionEdge=x.incoming.find(e=>e.to.port==='condition'),conditionNode=x.byId.get(conditionEdge?.from.nodeId),condition=conditionNode?.type==='CONDITION'?STRATEGY_GUIDE_TEMPLATES.CONDITION(context(graph,conditionNode)).replace(/인지 확인해요[\s\S]*$/,''):x.source('condition'),cases=c.mode==='CONDITION'?[{id:'true',label:condition+' 조건을 충족하면',port:'true'},{id:'false',label:condition+' 조건과 다르면',port:'false'}]:c.mode==='CHOICE'?(c.cases??[]).map(item=>({id:item.id,label:item.label+' 선택',port:'case:'+item.id})):[{id:'selected',label:'지정한 결정',nodeId:c.selectedNodeId}];
  branches=cases.map(b=>{const edge=x.incoming.find(e=>b.port?e.to.port===b.port:e.from.nodeId===b.nodeId);return {...b,nodeId:edge?.from.nodeId??null,edgeId:edge?.id??null,targetLabel:edge?x.name(edge.from.nodeId):'연결 필요'};});
 }else if(node.type==='REGIME_ROUTER'){const choicesEdge=x.incoming.find(e=>e.to.port==='choices'),items=x.byId.get(choicesEdge?.from.nodeId)?.config.items??[];branches=x.incoming.filter(e=>e.to.port.startsWith('case:')).map(e=>{const id=e.to.port.slice(5),item=items.find(i=>i.id===id);return {id,label:item?.label??id,description:item?.description??'',nodeId:e.from.nodeId,edgeId:e.id,targetLabel:x.name(e.from.nodeId)};});}
 else if(node.type==='ROUTER')branches=x.incoming.map(e=>({id:e.id,label:x.name(e.from.nodeId)+'의 신호가 가장 강할 때',nodeId:e.from.nodeId,edgeId:e.id,targetLabel:x.name(e.from.nodeId)}));
 const text=named(narrative(x,summary));
 return {version:STRATEGY_GUIDE_VERSION,nodeId:node.id,type:node.type,title:strategyGuideLabel(node),role:node.type==='ORDER'&&node.config.execution==='ACCOUNT'?'계좌 주문':definition?.title??({COMBINER:'신호 결합',ROUTER:'신호 선택',JEV:'AI 판단'})[node.type]??node.type,summary,narrative:text,presentation:presentation(x,text),facts:x.facts,bindings:x.bindings,inbound,next,branches:branches.map(b=>({...b,action:actionPhrase(graph,b.nodeId)})),terminal:node.id===graph.outputNodeId,registered:Boolean(template),disabled:node.config?.enabled===false};
}

export function strategyExplorationStart(graph,startId=null){
 const node=graph.nodes.find(n=>n.id===startId)??graph.nodes.find(n=>n.type==='DECISION_ROUTER')??graph.nodes.find(n=>n.type==='INPUT'&&n.config.kind==='ASSET_SET')??graph.nodes[0];
 if(!node)throw new TypeError('전략에 노드를 추가하면 탐험을 시작할 수 있어요.');return {currentId:node.id,frames:[],choices:{},trail:[]};
}
export function strategyExplorationStep(graph,state,action){
 const view=explainStrategyNode(graph,state.currentId),copy=structuredClone(state),snapshot={currentId:state.currentId,frames:structuredClone(state.frames),choices:structuredClone(state.choices)};
 if(action.type==='back'){const previous=copy.trail.pop();return previous?{...previous,trail:copy.trail}:copy;}
 let target=null;
 if(action.type==='branch'){const b=view.branches.find(b=>b.id===action.id);if(!b?.nodeId)throw new TypeError('이 경우에 읽을 결정을 연결하세요.');target=b.nodeId;copy.frames.push({nodeId:state.currentId,label:view.title,kind:'branch',edgeId:b.edgeId});copy.choices[state.currentId]={id:b.id,label:b.label,nodeId:b.nodeId};}
 else if(action.type==='input'){const link=view.inbound.find(e=>e.edgeId===action.edgeId);if(!link)throw new TypeError('이 노드에 연결된 입력을 선택하세요.');target=link.nodeId;copy.frames.push({nodeId:state.currentId,label:view.title,kind:'input',edgeId:link.edgeId});}
 else if(action.type==='return'||action.type==='continue'){const frame=copy.frames.pop();if(!frame)throw new TypeError('돌아갈 단계가 없습니다.');if(action.type==='continue'&&frame.kind==='branch'){const join=explainStrategyNode(graph,frame.nodeId),link=action.edgeId?join.next.find(e=>e.edgeId===action.edgeId):join.next[0];if(action.edgeId&&!link)throw new TypeError('분기의 실제 후속 연결을 선택하세요.');target=link?.nodeId??frame.nodeId;}else target=frame.nodeId;}
 else if(action.type==='next'){const link=view.next.find(e=>e.edgeId===action.edgeId);if(!link)throw new TypeError('현재 노드의 다음 연결을 선택하세요.');target=link.nodeId;}
 else if(action.type==='jump'){if(!graph.nodes.some(n=>n.id===action.nodeId))throw new TypeError('같은 전략의 노드를 선택하세요.');target=action.nodeId;copy.frames=[];}
 else throw new TypeError('탐험할 경로를 선택하세요.');
 if(!graph.nodes.some(n=>n.id===target))throw new TypeError('연결된 노드를 확인하세요.');copy.trail.push(snapshot);copy.currentId=target;return copy;
}

