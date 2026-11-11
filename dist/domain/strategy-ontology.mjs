import {getInstrument} from './instruments.mjs';

export const STRATEGY_ONTOLOGY_VERSION='strategy-ontology-v3';
const freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};
const catalog=rows=>freeze(Object.fromEntries(rows.map(([id,label,...rest])=>[id,{id,label,...rest[0]}])));
export const STRATEGY_COHORTS=catalog([
 ['VALUE','값·변수',{operation:'BIND',result:'VALUE',visual:'VARIABLE_CHIP'}],
 ['DATA','자료 조회',{operation:'READ',result:'OBSERVATION',visual:'SOURCE_BLOCK'}],
 ['COMPUTE','계산·학습',{operation:'COMPUTE',result:'VALUE',visual:'COMPUTATION_BLOCK'}],
 ['CONDITION','조건 판정',{operation:'TEST',result:'VALUE',visual:'PREDICATE_BLOCK'}],
 ['FLOW','흐름 제어',{operation:'SELECT',result:'VALUE',visual:'BRANCH_BLOCK'}],
 ['DECISION','투자 행동·배분',{operation:'PLAN',result:'PLAN',visual:'DECISION_BLOCK'}],
 ['GUARD','실행 전 검사',{operation:'CHECK',result:'PLAN',visual:'CHECK_BLOCK'}],
 ['EXECUTE','실행',{operation:'EXECUTE',result:'ORDER_REQUEST',visual:'TERMINAL_BLOCK'}],
]);
export const STRATEGY_ENTITY_TYPES=catalog([
 ['INSTRUMENT','거래 종목',{identity:['id'],dimensions:['venue','symbol','assetClass','baseAsset','quoteCurrency'],meaning:'VENUE_SPECIFIC_LISTING'}],
 ['ASSET','기초 자산',{identity:['authority','identifier'],dimensions:['name','assetClass'],meaning:'AUTHORITATIVE_ID_REQUIRED_SYMBOL_IS_NOT_IDENTITY'}],
 ['VENUE','거래소',{identity:['id'],dimensions:['name']}],
 ['LISTING_STATUS','거래 지원 상태 기록',{identity:['instrumentId','sourceHash','effectiveAt'],dimensions:['status','announcedAt','availableAt','effectiveUntil']}],
 ['INSTRUMENT_SET','종목 목록',{identity:['profileId','universeHash','asOf'],dimensions:['instrumentIds']}],
 ['ACCOUNT','계좌',{identity:['ownerId','accountId'],dimensions:['venue','quoteCurrency']}],
 ['POSITION','보유',{identity:['ownerId','accountId','activationId','instrumentId'],dimensions:['quantity','costBasis']}],
 ['OBSERVATION','관측 자료',{identity:['sourceHash','instrumentId','metricId','asOf','unit'],dimensions:['value','availableAt']}],
 ['SOURCE_DOCUMENT','출처 원문',{identity:['sourceHash','uri'],dimensions:['publishedAt','availableAt']}],
 ['EVALUATION','판단 실행',{identity:['evaluationId'],dimensions:['startedAt','endedAt','softwareVersion']}],
 ['SCALAR','단일 값',{identity:[],dimensions:['value','unit']}],
 ['CONDITION','조건값',{identity:[],dimensions:['value','subject']}],
 ['CONTEXT','판단 맥락',{identity:['sourceHash'],dimensions:['asOf','availableAt']}],
 ['MODEL','학습 모델',{identity:['modelHash'],dimensions:['trainedThrough','featureSchema']}],
 ['STRATEGY_MODEL','전략 모델',{identity:['id','version','contentHash'],dimensions:['policy','source'],meaning:'WHOLE_INPUT_ENTRY_HOLD_EXIT_SIZING_POLICY'}],
 ['STRATEGY_PROGRAM','국면 운용 구성',{identity:['id','contentHash'],dimensions:['classifier','routes','handover','minimumDwellMs']}],
 ['MARKET_REGIME','시장 국면 판단',{identity:['programHash','asOf','inputHash'],dimensions:['caseId','evidence']}],
 ['MIND_PRESET','마인드 프리셋',{identity:['id','contentHash'],dimensions:['minds'],meaning:'IMMUTABLE_CONFIGURATION_SNAPSHOTS_WITHOUT_ACCOUNT_OR_RUNNING_JOB_TRANSFER'}],
 ['DECISION','투자 판단',{identity:['decisionId'],dimensions:['instrumentId','action','targetWeight','asOf','decisionAt']}],
 ['ORDER_PLAN','주문 계획',{identity:['planId'],dimensions:['accountId','instrumentId','quantity','orderType']}],
 ['EXECUTION_CHECK','실행 검사 결과',{identity:['decisionId'],dimensions:['allowed','reasons']}],
 ['ORDER','거래소 주문',{identity:['ownerId','accountId','identifier'],dimensions:['activationId','instrumentId','state']}],
 ['FILL','체결',{identity:['accountId','identifier','tradeId'],dimensions:['quantity','price','fee','asOf']}],
]);
export const STRATEGY_RELATIONS=freeze([
 {id:'TRADED_ON',from:'INSTRUMENT',to:'VENUE',cardinality:'ONE',equalFields:[['venue','id']]},
 {id:'REPRESENTS_ASSET',from:'INSTRUMENT',to:'ASSET',cardinality:'OPTIONAL'},
 {id:'STATUS_OF',from:'LISTING_STATUS',to:'INSTRUMENT',cardinality:'ONE',equalFields:[['instrumentId','id']]},
 {id:'CONTAINS',from:'INSTRUMENT_SET',to:'INSTRUMENT',cardinality:'MANY'},
 {id:'OBSERVES',from:'OBSERVATION',to:'INSTRUMENT',cardinality:'ONE',equalFields:[['instrumentId','id']]},
 {id:'HOLDS',from:'ACCOUNT',to:'POSITION',cardinality:'MANY',equalFields:[['ownerId','ownerId'],['accountId','accountId']]},
 {id:'POSITION_INSTRUMENT',from:'POSITION',to:'INSTRUMENT',cardinality:'ONE',equalFields:[['instrumentId','id']]},
 {id:'DECIDES_FOR',from:'DECISION',to:'INSTRUMENT',cardinality:'ONE',equalFields:[['instrumentId','id']]},
 {id:'BASED_ON',from:'DECISION',to:'OBSERVATION',cardinality:'MANY',timeOrder:['availableAt','decisionAt']},
 {id:'PREDICTED_BY',from:'DECISION',to:'MODEL',cardinality:'OPTIONAL',timeOrder:['trainedThrough','decisionAt']},
 {id:'CONTAINS_PREDICTOR',from:'STRATEGY_MODEL',to:'MODEL',cardinality:'MANY'},
 {id:'ROUTES_TO_STRATEGY',from:'STRATEGY_PROGRAM',to:'STRATEGY_MODEL',cardinality:'MANY'},
 {id:'ROUTES_TO_PRESET',from:'STRATEGY_PROGRAM',to:'MIND_PRESET',cardinality:'MANY'},
 {id:'CLASSIFIED_FOR_PROGRAM',from:'MARKET_REGIME',to:'STRATEGY_PROGRAM',cardinality:'ONE',equalFields:[['programHash','contentHash']]},
 {id:'GENERATED_BY',from:'DECISION',to:'EVALUATION',cardinality:'ONE'},
 {id:'USES_OBSERVATION',from:'EVALUATION',to:'OBSERVATION',cardinality:'MANY',timeOrder:['availableAt','endedAt']},
 {id:'SOURCED_FROM',from:'OBSERVATION',to:'SOURCE_DOCUMENT',cardinality:'MANY',timeOrder:['availableAt','availableAt']},
 {id:'DERIVED_FROM',from:'OBSERVATION',to:'OBSERVATION',cardinality:'MANY',timeOrder:['availableAt','availableAt'],acyclic:true},
 {id:'CHECKS',from:'EXECUTION_CHECK',to:'DECISION',cardinality:'ONE'},
 {id:'PLANS_FOR',from:'ORDER_PLAN',to:'INSTRUMENT',cardinality:'ONE',equalFields:[['instrumentId','id']]},
 {id:'USES_ACCOUNT',from:'ORDER',to:'ACCOUNT',cardinality:'ONE',equalFields:[['ownerId','ownerId'],['accountId','accountId']]},
 {id:'ORDERS_INSTRUMENT',from:'ORDER',to:'INSTRUMENT',cardinality:'ONE',equalFields:[['instrumentId','id']]},
 {id:'FILLS',from:'FILL',to:'ORDER',cardinality:'ONE',equalFields:[['accountId','accountId'],['identifier','identifier']]},
]);
export const STRATEGY_ONTOLOGY_REFERENCES=freeze([
 {id:'FIBO',label:'FIBO · 자산과 거래소별 상장',url:'https://raw.githubusercontent.com/edmcouncil/fibo/master/SEC/Securities/SecuritiesListings.rdf',adopted:'기초 자산·거래 종목·거래소·시점별 거래 지원 상태를 구분한다. 심볼만으로 자산을 합치지 않는다.'},
 {id:'PROV_O',label:'W3C PROV-O · 자료 계보',url:'https://www.w3.org/TR/prov-o/',adopted:'관측·출처 원문·모델·판단 실행을 연결하고 사용 가능 시각을 대조한다.'},
 {id:'SHACL',label:'W3C SHACL · 제약과 진단',url:'https://www.w3.org/TR/shacl/',adopted:'대상·경로·규칙·심각도를 포함한 구조화된 JSON 검사 결과를 반환한다.'},
]);
export const LISTING_STATUS_VALUES=freeze(['TRADING','WARNING','SUSPENDED','TERMINATION_SCHEDULED','TERMINATED','UNKNOWN']);
const valueRows=[
 ['OHLCV','시세','OBSERVATION','SERIES'],['NUMBER','숫자 지표','SCALAR','ONE'],['TEXT','텍스트','SCALAR','ONE'],
 ['CHOICE_LIST','선택지 목록','SCALAR','SET'],
 ['STRATEGY_REF','전략 버전 참조','STRATEGY_MODEL','ONE'],
 ['CHOICE','선택지','SCALAR','ONE'],['SIGNAL','계산 신호','SCALAR','ONE'],['BOOLEAN','조건','CONDITION','ONE'],
 ['ORDER_PLAN','세션 주문 계획','ORDER_PLAN','ONE'],['APPROVED_ORDER_PLAN','검사한 세션 주문 계획','EXECUTION_CHECK','ONE'],
 ['CONTEXT','시장 맥락','CONTEXT','ONE'],['MEMORY','학습 기억','CONTEXT','ONE'],['KNOWLEDGE','투자 자료','CONTEXT','ONE'],
 ['DECISION','매수·유지·매도 결정','DECISION','ONE'],['APPROVED_DECISION','위험 검사를 통과한 결정','EXECUTION_CHECK','ONE'],
 ['ASSET_SET','후보 종목','INSTRUMENT_SET','SET'],['ASSET_VALUES','종목별 숫자','SCALAR','PER_INSTRUMENT'],
 ['ASSET_CONDITIONS','종목별 조건','CONDITION','PER_INSTRUMENT'],['ASSET_RANK','종목 순위','INSTRUMENT_SET','RANKED'],
 ['ASSET_SELECTION','선택 종목','INSTRUMENT_SET','SET'],['TARGET_WEIGHTS','목표 배분','DECISION','PER_INSTRUMENT'],
 ['APPROVED_TARGET_WEIGHTS','위험 검사를 통과한 배분','EXECUTION_CHECK','PER_INSTRUMENT'],
 ['INSTRUMENT_SET','종목 참조 목록','INSTRUMENT_SET','SET'],['INSTRUMENT','종목 참조','INSTRUMENT','ONE'],['TIMEFRAME','봉 주기','SCALAR','ONE'],['FEATURE_VECTOR','특징 벡터','SCALAR','VECTOR'],
 ['PATH_VALUES','나무별 예측 경로','SCALAR','VECTOR'],['PATH_RETURN','예측 수익률 경로','OBSERVATION','SERIES'],
 ['CANDLES','학습 시세','OBSERVATION','SERIES'],['TRAINING_ROWS','학습 표본','OBSERVATION','ROWS'],
 ['LOG_TRAINING_ROWS','로그 수익률 학습 표본','OBSERVATION','ROWS'],['TRAINED_FOREST','학습된 나무','MODEL','ONE'],['MODEL','학습 모델 버전','MODEL','ONE'],
];
export const STRATEGY_VALUE_TYPES=catalog(valueRows.map(([id,label,entity,cardinality])=>[id,label,{entity,cardinality}]));
export const STRATEGY_PORT_TYPE_LABELS=freeze(Object.fromEntries(valueRows.map(([id,label])=>[id,label])));
export const STRATEGY_NUMBER_UNITS=freeze(['scalar','ratio','multiple','probability','score','signed_score','count','units','hours','ms','seconds','minutes','bps','USD','KRW','USDT','BTC','USD/share','KRW/share','USD/unit','KRW/unit','USDT/unit','BTC/unit']);
export const STRATEGY_BINDING_SCOPES=catalog([
 ['CONSTANT','고정값',{lifetime:'GRAPH_VERSION'}],['RUN','이번 실행',{lifetime:'EVALUATION',keys:['evaluationId']}],
 ['CURRENT_ASSET','현재 평가 종목',{lifetime:'EVALUATION_ITEM',keys:['evaluationId','instrumentId']}],
 ['ACCOUNT','자기 계좌',{lifetime:'EVALUATION_ACCOUNT',keys:['ownerId','accountId','activationId']}],
 ['MIND_UNIVERSE','마인드 투자 범위',{lifetime:'EVALUATION',keys:['profileId','universeHash']}],
]);
const check=(ok,code,message)=>{if(!ok)throw Object.assign(new TypeError(message),{code});};

/** Identity is separate from current listing status and broker permission. */
export function instrumentReference(id){
 const instrument=getInstrument(id);
 return freeze(Object.fromEntries([['type','INSTRUMENT'],...['id','venue','symbol','assetClass','baseAsset','quoteCurrency'].map(key=>[key,instrument[key]])]));
}
export function assertInstrumentReference(value){
 check(value&&value.type==='INSTRUMENT'&&typeof value.id==='string','ONTOLOGY_INSTRUMENT','종목 참조를 연결하세요.');
 const expected=instrumentReference(value.id);
 check(Object.keys(value).length===Object.keys(expected).length&&Object.keys(expected).every(key=>value[key]===expected[key]),'ONTOLOGY_INSTRUMENT_IDENTITY','종목·거래소·통화가 같은 정식 종목 참조를 연결하세요.');
 return value;
}
export function assertOntologyPorts(ports){
 for(const direction of ['inputs','outputs'])for(const port of ports[direction]??[]){
  const types=[port.dataType??port.type,...(port.accepts??[])];
  check(types.every(type=>Object.hasOwn(STRATEGY_VALUE_TYPES,type)),'ONTOLOGY_PORT_TYPE','정의된 자료형의 포트를 연결하세요.');
 }
 return ports;
}
export function strategyPortSemantics(node,direction,port){
 const dataType=port.dataType??port.type;
 const instrument=direction==='outputs'&&node.type==='INPUT'&&node.config?.kind==='EXECUTION_ASSET'||direction==='inputs'&&node.type==='MEMBER'&&port.id==='instrument';
 return {...port,semanticType:instrument?'INSTRUMENT':dataType,entity:instrument?'INSTRUMENT':STRATEGY_VALUE_TYPES[dataType]?.entity,encoding:dataType};
}
export function strategyOntology(){return structuredClone({version:STRATEGY_ONTOLOGY_VERSION,cohorts:STRATEGY_COHORTS,entities:STRATEGY_ENTITY_TYPES,relations:STRATEGY_RELATIONS,valueTypes:STRATEGY_VALUE_TYPES,numberUnits:STRATEGY_NUMBER_UNITS,bindingScopes:STRATEGY_BINDING_SCOPES,references:STRATEGY_ONTOLOGY_REFERENCES,listingStatusValues:LISTING_STATUS_VALUES,alignment:'ADAPTED_JSON_CONSTRAINTS_NOT_RDF_OR_SHACL_CONFORMANCE',
 invariants:{instrumentIdentity:'VENUE_AND_QUOTE_ARE_PART_OF_IDENTITY',identityEligibility:'SEPARATE_CURRENT_BROKER_CHECK',observationTime:'AVAILABLE_AT_MUST_NOT_EXCEED_EVALUATION_TIME',conditionMissing:'UNKNOWN_IS_NOT_FALSE',perAssetValues:'SAME_CANDIDATE_SCOPE_REQUIRED',executionCheck:'NOT_USER_CONSENT',roleState:'COHORT_IS_INDEPENDENT_OF_EXECUTION_STATUS'},
 bindings:{portEncoding:'EXISTING_GRAPH_V2_PRESERVED',instrumentReference:'dist/domain/strategy-ontology.mjs:instrumentReference',factValidation:'dist/domain/strategy-ontology-validation.mjs:validateOntologyFacts',wireableInstrumentVariable:'PARAMETER_PINS_V1',parameterEncoding:'OPTIONAL_TYPED_EDGES_KEEP_LITERAL_FALLBACK',queryParameterPhase:'VALUE_OR_CURRENT_ASSET_BEFORE_DATA_QUERY',unconnectedVariables:'PRESERVED_WITHOUT_EXECUTION'}});}
