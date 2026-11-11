import {STRATEGY_COHORTS,strategyPortSemantics,assertOntologyPorts} from './strategy-ontology.mjs';
const definitions=[
 ['MARKET_STATE','시장 상태 계산','시장 상태 계산','연속 확정 시간봉에서 추세·상승 비율·변동성·종목 간 차이를 수치로 계산합니다.','COMPUTE'],
 ['PORTFOLIO_EXPERT','전략별 배분','전략별 배분','추세·돌파·반등·BTC 보유·현금 전략이 목표 비중을 제안합니다.','DECISION'],
 ['PORTFOLIO_ROUTER','학습 배분 라우터','학습 배분 라우터','유사 시장의 완료된 비용 차감 성과로 전략과 현금 비중을 함께 배분합니다.','FLOW'],
 ['CHOICE_LIST','선택지 목록','선택지 변수','고유 ID·이름·판단 기준을 가진 목록을 JEV와 라우터에 함께 연결합니다.','VALUE'],
 ['REGIME_INPUT','시장 입력 변수','시장 입력 변수','시장 전체 판단에 사용할 명시적인 입력 변수를 연결합니다.','DATA'],
 ['REGIME_CLASSIFIER','선택 판단','선택 판단','연결한 입력과 선택지 목록을 기반으로 JEV가 하나를 선택합니다.','COMPUTE'],
 ['STRATEGY_REFERENCE','전략 버전','전체 전략 버전','라이브러리의 완성된 전략 버전을 참조합니다.','FLOW'],
 ['REGIME_ROUTER','전략 라우터','전략 라우터','선택지 ID에 연결된 전략 버전을 선택하고 보유 책임을 인계합니다.','FLOW'],
 ['INPUT','확정 시세','입력 자료','확정 시세, 계좌, 체결 흐름과 후보 종목을 읽습니다.','DATA'],
 ['VALUE','값','값','비교와 계산에 사용할 상수를 제공합니다.','VALUE'],
 ['SIGNAL','가격 신호','가격 신호','시세에서 지정한 퀀트 신호를 계산합니다.','COMPUTE'],
 ['SESSION_RULE','분할매수 규칙','분할매수 규칙','현재 세션 상태에서 분할매수 주문 계획을 만듭니다.','DECISION'],
 ['SESSION_SIGNAL','시장 추세 지표','시장 추세 지표','현재 세션의 추세 지표를 계산합니다.','COMPUTE'],
 ['SESSION_TREND','추세 보유 규칙','추세 보유 규칙','세션의 추세와 보유 상태로 주문 계획을 만듭니다.','DECISION'],
 ['MODEL','학습 모델','학습 모델','학습 모델로 예측합니다. 시간봉 모델은 내부의 특징·나무·합산·학습 경로를 펼쳐 구성합니다.','COMPUTE'],
 ['CONDITION','조건','값 비교','입력값과 기준값을 비교해 조건을 판정합니다.','CONDITION'],
 ['BOOLEAN_LOGIC','조건 조합','조건 조합','여러 조건을 AND, OR, NOT으로 조합합니다.','CONDITION'],
 ['JEV_QUESTION','JEV 질문','JEV 질문','고정 질문과 실제 연결 입력으로 AI 선택을 요청합니다.','COMPUTE'],
 ['QUANT','퀀트 결정','퀀트 결정','연결한 신호와 설정에 따라 매수, 보유, 매도를 결정합니다.','DECISION'],
 ['VIBE','JEV 결정','바이브 결정','연결한 맥락과 질문 결과로 AI 투자 결정을 구성합니다.','DECISION'],
 ['DECISION_ROUTER','결정 선택','결정 라우터','조건에 맞는 결정 또는 주문 계획을 선택합니다.','FLOW'],
 ['DECISION_MIXER','결정 결합','결정 믹서','여러 투자 결정을 지정한 비중으로 결합합니다.','DECISION'],
 ['FILTER','후보 필터','후보 필터','설정한 조건에 맞는 후보 종목을 거릅니다.','FLOW'],
 ['ASSET_METRIC','종목별 지표','종목별 지표','후보마다 하나의 지표를 계산합니다.','COMPUTE'],
 ['ASSET_REDUCE','종목 지표 집계','종목 지표 집계','종목별 숫자의 중앙값 또는 양수 비율을 계산합니다. 제외 종목을 변수로 연결할 수 있습니다.','COMPUTE'],
 ['ASSET_COMPARE','종목별 비교','종목별 비교','종목별 지표를 기준값과 비교합니다.','CONDITION'],
 ['ASSET_LOGIC','종목별 조건 조합','종목별 조건 조합','같은 후보의 조건을 AND, OR, NOT으로 연결합니다.','CONDITION'],
 ['ASSET_FILTER','조건으로 후보 선택','조건으로 후보 선택','연결한 종목별 조건을 통과한 후보를 선택합니다.','FLOW'],
 ['RANK','종목 순위','종목 순위','후보 종목을 지정 지표로 정렬합니다.','COMPUTE'],
 ['SELECT','상위 후보 선택','상위 후보 선택','순위에서 투자 대상 종목을 선택합니다.','FLOW'],
 ['MEMBER','선택 종목 포함 여부','선택 종목 포함 여부','현재 종목이 선택 대상에 포함되는지 판정합니다.','CONDITION'],
 ['ALLOCATE','자금 배분','자금 배분','선택 종목의 목표 자금 비중을 계산합니다.','DECISION'],
 ['REBALANCE','리밸런싱','리밸런싱','현재 보유와 목표 비중에서 조정 대상을 계산합니다.','DECISION'],
 ['RISK','위험 한도','위험 한도','승인된 자금, 노출과 주문 조건으로 결정을 검사합니다.','GUARD'],
 ['ORDER','모의 주문','주문 실행','목표 비중 주문을 실행합니다. 업비트 분봉 모델은 매수 체결 뒤 일부 수량의 지정가 익절을 등록하고, 모델 청산 시 잔여 지정가를 취소합니다.','EXECUTE'],
];
export const STRATEGY_NODE_REGISTRY=Object.freeze(definitions.map(([type,defaultLabel,title,description,cohort])=>Object.freeze({type,defaultLabel,title,description,cohort})));
export const STRATEGY_NODE_TYPES=Object.freeze(STRATEGY_NODE_REGISTRY.map(node=>node.type));
export const STRATEGY_NODE_LABELS=Object.freeze(Object.fromEntries(STRATEGY_NODE_REGISTRY.map(node=>[node.type,node.defaultLabel])));
export const STRATEGY_NODE_TITLES=Object.freeze(Object.fromEntries(STRATEGY_NODE_REGISTRY.map(node=>[node.type,node.title])));

export function strategyNodeCohort(node){
 const type=typeof node==='string'?node:node?.type;
 const id=type==='INPUT'&&node.config?.kind==='EXECUTION_ASSET'?'VALUE':STRATEGY_NODE_REGISTRY.find(row=>row.type===type)?.cohort;
 return STRATEGY_COHORTS[id]??null;
}
export function strategyNodeSemantics(node,ports){
 const cohort=strategyNodeCohort(node);if(!cohort)throw new TypeError('정의된 역할의 노드를 선택하세요.');
 assertOntologyPorts(ports);
 let binding=null;const c=node.config??{};
 if(node.type==='INPUT'){
  if(c.kind==='EXECUTION_ASSET')binding={scope:'CURRENT_ASSET',source:'RUN_CURRENT_ASSET',encoding:'TEXT',semanticType:'INSTRUMENT'};
  else if(c.kind==='ASSET_SET')binding={scope:'MIND_UNIVERSE',source:'MIND_UNIVERSE',encoding:'ASSET_SET'};
  else if(c.instrumentId==='execution:current')binding={scope:'CURRENT_ASSET',source:'RUN_CURRENT_ASSET',encoding:'NODE_CONFIG'};
  else if(['OHLCV','METRIC','MICROSTRUCTURE','POSITION'].includes(c.kind))binding={scope:c.kind==='POSITION'?'ACCOUNT':'CONSTANT',source:'FIXED_INSTRUMENT',instrumentId:c.instrumentId,encoding:'NODE_CONFIG'};
  else binding={scope:'RUN',source:'INPUT_PACKAGE',encoding:'NODE_CONFIG'};
 }else if(node.type==='VALUE')binding={scope:'CONSTANT',source:'NODE_CONFIG',encoding:c.dataType??'NUMBER'};
 const effect=['JEV_QUESTION','VIBE'].includes(node.type)?'EXTERNAL_MODEL_REQUEST':cohort.id==='EXECUTE'?'EXECUTION_BOUNDARY':cohort.id==='DATA'?'READ_STATE':['DECISION','GUARD'].includes(cohort.id)?'PLAN_ONLY':'PURE';
 return {cohort:cohort.id,operation:cohort.operation,effect,binding,ports:Object.fromEntries(['inputs','outputs'].map(direction=>[direction,ports[direction].map(port=>strategyPortSemantics(node,direction,port))]))};
}
