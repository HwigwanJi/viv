import {PAPER_DECISION_ENTRY,PAPER_PRACTICE_ENTRY,paperDecisionRecordHash} from '../dist/system/paper-decision-links.mjs';
import {ONTOLOGY_VALIDATION_SCHEMA,validOntologyValidationInput,validateOntologyFacts} from '../dist/domain/strategy-ontology-validation.mjs';
import {capabilityManifest} from '../dist/system/registry.mjs';
import {HOURLY_LEARNING_ACTIONS,validHourlyLearningInput,hourlyLearningRequest} from '../dist/system/hourly-learning-contracts.mjs';
import {normalizeOperationWindow} from '../dist/domain/operation-window.mjs';
import {AUTOMATION_ACTIONS,automationTool,automationRequest,validAutomationInput} from '../dist/system/automation-contracts.mjs';
import {JEV_EXECUTION_CALL_LIMIT} from '../dist/domain/jev-question.mjs';
import {validateSimulationDraftInput} from './simulation-drafts.mjs';
import {MIND_MCP_DELIVERY} from './mind-subscriptions.mjs';
import {buildInvestmentStatus,InvestmentReadError} from './investment-read-model.mjs';
import {parseMindData} from '../dist/domain/mind-manifest.mjs';
import {CLUTCH_DEFAULTS,CLUTCH_PARAMETER_SCHEMA,validateClutchParameters} from '../dist/engine/clutch-policy.mjs';
import {compileStrategyGraph} from '../dist/domain/strategy-graph.mjs';
import {assertStrategyLearningResearchInput,strategyLearningResearchProtocol} from './strategy-learning-research.mjs';
import {getInstrument,MARKET_TIMEFRAME_MS} from '../dist/domain/instruments.mjs';
import {isFirstPaperDecisionPlan,paperDecisionFillCount,paperTrendResultBasis} from '../dist/domain/paper-mind-presets.mjs';
import {VIV_INSTRUCTIONS,VIV_PLAYBOOK,VIV_TUTORIAL_ACTIONS,vivOnboarding} from './viv-onboarding.mjs';
const identifierSchema={type:'string',minLength:1,maxLength:200,pattern:'^[a-zA-Z0-9][a-zA-Z0-9_.:@-]{0,199}$'};
const revisionSchema={type:'integer',minimum:0,maximum:Number.MAX_SAFE_INTEGER};
const objectSchema=(properties={},required=[])=>({type:'object',properties,...(required.length?{required}:{}),additionalProperties:false});
const opportunitySchema=objectSchema(Object.fromEntries(CLUTCH_PARAMETER_SCHEMA.map(f=>[f.key,{type:f.unit==='봉'?'integer':'number',minimum:f.min,maximum:f.max}])),Object.keys(CLUTCH_DEFAULTS));
const strategyDraftSchema=objectSchema({preset:{const:'BTC_SPOT_V1'},enabled:{type:'boolean'},instrumentPolicy:{type:'string',enum:['FIXED','UNIVERSE_CURRENT','EACH_ASSET']},strategyMaxExposure:{type:'number',exclusiveMinimum:0,maximum:1},opportunityParameters:opportunitySchema,graph:{type:'object',maxProperties:9}},['preset','enabled','strategyMaxExposure']);
const knowledgeWriteSchema={...objectSchema({document:{type:'object',maxProperties:60},text:{type:'string',minLength:1,maxLength:160000},format:{type:'string',enum:['json','yaml']},expectedRevision:revisionSchema,idempotencyKey:identifierSchema},['expectedRevision','idempotencyKey']),oneOf:[{required:['document'],not:{required:['text']}},{required:['text'],not:{required:['document']}}]};
const learningWindowSchema=objectSchema({startAt:{type:'string',format:'date-time'},endAt:{type:'string',format:'date-time'}},['startAt','endAt']);
const learningCommandSchema=objectSchema({id:identifierSchema,expectedRevision:revisionSchema,idempotencyKey:identifierSchema},['id','expectedRevision','idempotencyKey']);
const learningParameterSchema=objectSchema({id:identifierSchema,nodeId:identifierSchema,path:{type:'string',minLength:1,maxLength:200},values:{type:'array',minItems:1,maxItems:12,items:{type:['number','string','boolean']}},bounds:objectSchema({min:{type:'number'},max:{type:'number'},maxChange:{type:'number',minimum:0}})},['id','nodeId','path','values']);
const hashSchema={type:'string',pattern:'^[a-f0-9]{64}$'};
const learningSourceSchema={oneOf:[objectSchema({assetMode:{const:'UPBIT_EVENT_STREAM'},datasetId:identifierSchema},['assetMode','datasetId']),objectSchema({assetMode:{const:'UPBIT_EVENT_UNIVERSE'},datasetIds:{type:'array',minItems:2,maxItems:20,uniqueItems:true,items:identifierSchema}},['assetMode','datasetIds'])]};
const researchReferenceSchema=objectSchema({kind:{enum:['MARKET_KNOWLEDGE','MIND_DOCUMENT','EVENT_PAPER_RECORD','LIVE_AUTOMATION_EVENT']},id:identifierSchema,contentHash:hashSchema,subscriptionId:identifierSchema,activationId:identifierSchema},['kind','id','contentHash']);
const learningResearchSchema=objectSchema({contractVersion:{const:'EXTERNAL_RESEARCH_PROTOCOL_V1'},hypothesis:{type:'string',minLength:1,maxLength:6000},cutoffAt:{type:'string',format:'date-time'},sourceManifestHash:hashSchema,references:{type:'array',minItems:1,maxItems:32,items:researchReferenceSchema}},['contractVersion','hypothesis','cutoffAt','sourceManifestHash','references']);
const schemas={
  viv_onboarding:objectSchema({interest:{enum:['stocks','crypto','both']},amountKrw:{type:'integer',minimum:1,maximum:1e12},idempotencyKey:identifierSchema,action:{enum:VIV_TUTORIAL_ACTIONS},lesson:{type:'integer',minimum:1,maximum:4},documentId:identifierSchema,decisionId:identifierSchema,simulationId:identifierSchema,readOnly:{const:true}}),
  validate_strategy_ontology:ONTOLOGY_VALIDATION_SCHEMA,
  read_strategy_ontology:objectSchema(),
 ...Object.fromEntries(HOURLY_LEARNING_ACTIONS.map(a=>[a.mcp_tool,a.inputSchema])),
  ...Object.fromEntries(AUTOMATION_ACTIONS.filter(a=>a.mcp_tool).map(a=>[a.mcp_tool,a.inputSchema])),
  read_event_paper:objectSchema({view:{type:'string',enum:['status','records']},profileId:identifierSchema,subscriptionId:identifierSchema,limit:{type:'integer',minimum:1,maximum:100}}),
  prepare_event_paper:objectSchema({maxPublicRequests:{type:'integer',minimum:1,maximum:Number.MAX_SAFE_INTEGER},startsAt:{type:'string',format:'date-time'},endsAt:{type:'string',format:'date-time'},profileId:identifierSchema,executionMode:{const:'paper'},capitalLimit:{type:'string',pattern:'^\\d+(?:\\.\\d{1,8})?$'},maxJevCallsPerDay:{type:'integer',minimum:0,maximum:JEV_EXECUTION_CALL_LIMIT},expectedRevision:revisionSchema,idempotencyKey:identifierSchema},['profileId','executionMode','capitalLimit','expectedRevision','idempotencyKey']),
  pause_event_paper:objectSchema({subscriptionId:identifierSchema,executionMode:{const:'paper'},expectedSubscriptionRevision:revisionSchema,idempotencyKey:identifierSchema},['subscriptionId','executionMode','expectedSubscriptionRevision','idempotencyKey']),
  release_event_paper:objectSchema({subscriptionId:identifierSchema,executionMode:{const:'paper'},expectedSubscriptionRevision:revisionSchema,idempotencyKey:identifierSchema},['subscriptionId','executionMode','expectedSubscriptionRevision','idempotencyKey']),
  read_simulation_draft:objectSchema({id:identifierSchema}),
  save_simulation_draft:objectSchema({id:identifierSchema,name:{type:'string',minLength:1,maxLength:160},arms:{type:'array',minItems:2,maxItems:2,items:objectSchema({mindId:identifierSchema,graph:{type:'object',maxProperties:9},knowledge:{type:'boolean'},sourceSimulationId:{...identifierSchema,type:['string','null']}},['mindId','graph','knowledge'])},settings:objectSchema({startAt:{type:['string','null'],format:'date-time'},endAt:{type:['string','null'],format:'date-time'},initialCash:{type:'number',exclusiveMinimum:0,maximum:1e12},feeBps:{type:['number','null'],minimum:0,maximum:1000},slippageBps:{type:['number','null'],minimum:0,maximum:1000},maxJevCalls:{type:'integer',minimum:0,maximum:JEV_EXECUTION_CALL_LIMIT},benchmarkPresetId:{...identifierSchema,type:['string','null']},assetMode:{type:'string',enum:['UPBIT_BTC_PORTFOLIO','UPBIT_EVENT_STREAM','UPBIT_EVENT_UNIVERSE']},datasetId:identifierSchema,datasetIds:{type:'array',minItems:2,maxItems:20,uniqueItems:true,items:identifierSchema}},['startAt','endAt','initialCash','feeBps','slippageBps','maxJevCalls','benchmarkPresetId']),step:{type:'string',enum:['strategy','period','review']},expectedRevision:revisionSchema,idempotencyKey:identifierSchema},['arms','settings','step','expectedRevision','idempotencyKey']),
  read_simulation_collection:objectSchema({mindId:identifierSchema,q:{type:'string',maxLength:160},status:{type:'string',enum:['all','draft','active','completed','attention']},kind:{type:'string',enum:['all','simulation','comparison','tuning']},archived:{type:'boolean'},pageSize:{type:'integer',minimum:1,maximum:50},cursor:{type:'string',maxLength:2000}}),
  organize_simulation_collection:objectSchema({action:{type:'string',enum:['archive','restore']},id:identifierSchema,kind:{type:'string',enum:['simulation','comparison','tuning']},memberRevisions:{type:'array',minItems:1,maxItems:2,items:objectSchema({id:identifierSchema,revision:revisionSchema},['id','revision'])},idempotencyKey:identifierSchema},['action','id','kind','memberRevisions','idempotencyKey']),
  read_strategy_learning:objectSchema({view:{type:'string',enum:['list','catalog','item'],default:'list'},mindId:identifierSchema,id:identifierSchema,archived:{type:'boolean'}}),
  create_strategy_learning:objectSchema({mindId:identifierSchema,name:{type:'string',minLength:1,maxLength:160},graph:{type:'object',maxProperties:9},source:learningSourceSchema,research:learningResearchSchema,parameters:{type:'array',minItems:1,maxItems:3,items:learningParameterSchema,description:'catalog의 노드·경로에 후보 값을 최대 3개 매개변수로 지정합니다. 전체 조합은 기준 전략을 포함해 최대 12개입니다.'},training:learningWindowSchema,validation:learningWindowSchema,simulation:objectSchema({initialCash:{type:'number',exclusiveMinimum:0},feeBps:{type:'number',minimum:0},slippageBps:{type:'number',minimum:0}},['initialCash','slippageBps']),objective:objectSchema({returnWeight:{type:'number'},drawdownPenalty:{type:'number'},minImprovement:{type:'number'},validationReturnTolerance:{type:'number'},validationDrawdownTolerance:{type:'number'}}),optInJev:{type:'boolean'},maxJevCalls:{type:'integer',minimum:0,maximum:4096},previousSessionId:identifierSchema,expectedRevision:revisionSchema,idempotencyKey:identifierSchema},['mindId','parameters','training','validation','simulation','optInJev','maxJevCalls','expectedRevision','idempotencyKey']),
  step_strategy_learning:learningCommandSchema,
  pause_strategy_learning:learningCommandSchema,
  archive_strategy_learning:learningCommandSchema,
  restore_strategy_learning:learningCommandSchema,
  adopt_strategy_learning:learningCommandSchema,
  read_quant_library:objectSchema({id:identifierSchema,search:{type:'string',maxLength:200},status:{type:'string',enum:['DRAFT','APPROVED']},format:{type:'string',enum:['json','yaml']}}),
  draft_quant_strategy:{...objectSchema({name:{type:'string',minLength:1,maxLength:100},description:{type:'string',maxLength:2000},definition:{type:'object',maxProperties:3},strategyId:identifierSchema,draftId:identifierSchema,expectedContentHash:{type:'string',pattern:'^[a-f0-9]{64}$'},document:{type:'object',maxProperties:60},text:{type:'string',minLength:1,maxLength:160000},format:{type:'string',enum:['json','yaml']},expectedRevision:revisionSchema,idempotencyKey:identifierSchema},['expectedRevision','idempotencyKey']),oneOf:[{required:['name','definition'],not:{anyOf:[{required:['document']},{required:['text']}]}},{required:['document'],not:{anyOf:[{required:['name']},{required:['definition']},{required:['strategyId']},{required:['draftId']},{required:['expectedContentHash']},{required:['text']}]}},{required:['text'],not:{anyOf:[{required:['name']},{required:['definition']},{required:['strategyId']},{required:['draftId']},{required:['expectedContentHash']},{required:['document']}]}}]},
  draft_mind_policy:{...objectSchema({mindId:identifierSchema,expectedSourceManifestHash:hashSchema,externalKnowledge:{type:'object',maxProperties:60},strategyPlanDraft:strategyDraftSchema,universeDraft:{type:'object',maxProperties:12},expectedRevision:revisionSchema,idempotencyKey:identifierSchema},['mindId','expectedRevision','idempotencyKey']),oneOf:[{required:['externalKnowledge'],not:{anyOf:[{required:['strategyPlanDraft']},{required:['universeDraft']}]}},{required:['strategyPlanDraft'],not:{anyOf:[{required:['externalKnowledge']},{required:['universeDraft']}]}},{required:['universeDraft'],not:{anyOf:[{required:['externalKnowledge']},{required:['strategyPlanDraft']}]}}]},
  read_market_knowledge:objectSchema({documentId:identifierSchema,search:{type:'string',maxLength:200},status:{type:'string',enum:['SAVED','DRAFT','APPROVED']},sourceType:{type:'string',enum:['news','macro-release','investor-letter','investor-disclosure','research','other']},authorId:identifierSchema,level:{type:'string'},horizon:{type:'string'},sentiment:{type:'string'},novelty:{type:'string'},instrumentId:identifierSchema,pageSize:{type:'integer',minimum:1,maximum:50},cursor:{type:'string',maxLength:2000}}),
  write_market_knowledge:knowledgeWriteSchema,
  save_market_research:{...knowledgeWriteSchema,properties:{...knowledgeWriteSchema.properties,documentId:identifierSchema},oneOf:[{required:['document'],not:{anyOf:[{required:['text']},{required:['documentId']}]}},{required:['text'],not:{anyOf:[{required:['document']},{required:['documentId']}]}},{required:['documentId'],not:{anyOf:[{required:['document']},{required:['text']}]}}]},
  classify_market_knowledge:objectSchema({documentId:identifierSchema,expectedRevision:revisionSchema,idempotencyKey:identifierSchema},['documentId','expectedRevision','idempotencyKey']),
  export_market_knowledge:objectSchema({documentId:identifierSchema,format:{type:'string',enum:['json','yaml']}},['documentId','format']),
  read_investment_status:objectSchema(),
  run_due_paper_jobs:objectSchema({maxJobs:{type:'integer',minimum:1,maximum:3}}),
  read_mind_catalog:objectSchema(),
  read_trading_context:objectSchema({mindId:identifierSchema,instrumentId:identifierSchema,decisionId:identifierSchema,timeframe:{type:'string',enum:Object.keys(MARKET_TIMEFRAME_MS)},mode:{type:'string',enum:['live','replay']},view:{const:'result',description:'decisionId와 함께 저장된 현재 시세 모의 판단의 이유와 체결 건수만 조회합니다.'}},['instrumentId']),
  write_mind_document:{...objectSchema({document:{type:'object',maxProperties:60,description:'앱이 제공하는 양식에 맞춘 문서 객체. 서버가 형식과 근거를 검증합니다.'},text:{type:'string',minLength:1,maxLength:160000},format:{type:'string',enum:['json','yaml']},expectedRevision:revisionSchema,idempotencyKey:identifierSchema},['expectedRevision','idempotencyKey']),oneOf:[{required:['document'],not:{required:['text']}},{required:['text'],not:{required:['document']}}]},
  classify_mind_document:objectSchema({documentId:identifierSchema,expectedRevision:revisionSchema,idempotencyKey:identifierSchema},['documentId','expectedRevision','idempotencyKey']),
  read_mind_manifest:objectSchema({mindId:identifierSchema,format:{type:'string',enum:['json','yaml']}},['mindId','format']),
};
const descriptions={
  viv_onboarding:'VIV 시작 안내, 저장한 모의 판단 링크와 튜토리얼 진행을 조회합니다. 인수 없이 시작하고, 원화 모의 예산은 사용자가 분야와 금액을 선택한 경우에 세 인수를 함께 보내 최초 공용 예산을 생성합니다. action:pause·resume으로 중단·재개를 저장하고, action:complete로 실제 결과를 제공한 튜토리얼 번호를 기록합니다. 연결을 미루겠다는 선택은 action:defer_connection으로 저장하고 links.paperResume을 엽니다.',
  validate_strategy_ontology:'종목·계좌·자료·판단의 명시한 객체와 관계를 공용 온톨로지로 검사합니다. 관계 종류·개수·종목/계좌 일치·시점·자료 계보 순환을 검사하고 오류 대상과 경로를 반환합니다. complete가 false면 제공한 사실만 검사합니다. 주문·설정·저장을 수행하지 않습니다.',
  read_strategy_ontology:'노드 편집기와 API의 같은 온톨로지를 조회합니다. 종목·계좌·자료·판단·주문 관계, 역할 코호트, 포트 자료형·실제 연결 지원 상태와 공용 기능 계약을 반환합니다. 운용이나 설정을 변경하지 않습니다.',
 ...Object.fromEntries(HOURLY_LEARNING_ACTIONS.map(a=>[a.mcp_tool,a.description])),
  ...Object.fromEntries(AUTOMATION_ACTIONS.filter(a=>a.mcp_tool).map(a=>[a.mcp_tool,a.description])),
  read_event_paper:'분봉 다종목 모의 운용의 원 정책·후보·실제 모의 원장·공용 예산과 진행 상태를 읽습니다. status는 profileId(전체 all), records는 subscriptionId와 선택 limit를 전달하세요. 공급자를 호출하지 않습니다.',
  prepare_event_paper:'현재 발행 노드 전략과 공용 예산을 대조하고 거래소의 수수료·최소 주문·관측 시장 자료로 분봉·시간봉 모의 운용 검토안을 준비합니다. 배정과 자동 운용 시작은 앱에서 사용자가 검토한 뒤 진행합니다.',
  pause_event_paper:'해당 분봉 모의 운용을 일시중지합니다. 실제 주문 전송을 하지 않으며 보유·미확정 모의 주문·응답과 원장을 보존합니다. 조회한 최신 subscription revision을 전달하세요.',
  release_event_paper:'일시중지한 분봉 모의 운용의 보유와 예약 주문이 없고 판단 결과가 확정되었을 때 같은 원장 현금을 공용 예산에 회수합니다. 서버가 원금·실현손익·반환액을 대조합니다.',
  read_simulation_draft:'저장한 A/B 편집 초안을 조회합니다. id를 생략하면 초안 목록을 반환합니다.',
  save_simulation_draft:'A/B 그래프와 각 원본 정책·기간·비용을 서버 초안으로 저장합니다. 새 초안 expectedRevision은 0, 수정은 문서 revision을 사용합니다. JEV 호출 동의와 투자 실행은 포함하지 않습니다.',
  read_simulation_collection:'시뮬레이션·A/B 비교·전략 튜닝을 과업별 한 행으로 검색합니다. 이름 또는 정확한 실험 ID로 찾아 각 항목의 openUrl을 열 수 있습니다. 수익률은 performance.label의 기준과 함께 읽으세요. 값 0.05는 5%입니다.',
  organize_simulation_collection:'조회한 실험을 보관하거나 복원합니다. memberRevisions는 목록의 members를 그대로 전달하세요. A/B 비교의 구성 실행은 같은 작업으로 정리하고 진행 중인 판단의 저장을 먼저 기다립니다.',
  read_strategy_learning:'catalog에서 현재 정책·편집 가능 경로·고정 자료·실제 체결과 손실의 연구 근거를 조회합니다. 전략 튜닝을 조회합니다. view:list는 마인드별 목록, catalog는 mindId의 발행 그래프와 학습 가능한 매개변수, item은 id의 고정 조건·진행·원실험·평가·초안 연결을 제공합니다. 조회 중 JEV를 호출하지 않습니다.',
  create_strategy_learning:'source로 보관 이벤트 자료를 선택하고 research로 뉴스·논문·기억·실행 원문의 해시와 연구 기준 시각을 고정합니다. 학습과 이후 검증 구간, 후보 프롬프트·가중치, 비용, 평가 목표와 전체 JEV 호출 한도를 고정해 튜닝 세션을 생성합니다. 먼저 catalog를 조회하세요. expectedRevision은 현재 workspace revision입니다. 생성은 운용 정책을 변경하지 않습니다.',
  step_strategy_learning:'튜닝 세션의 다음 실험 배치를 처리합니다. 생성 시 동의한 JEV 예산을 사용하고 원요청·응답을 보존합니다. expectedRevision은 session revision이며 같은 요청의 재전송은 같은 idempotencyKey를 사용합니다.',
  pause_strategy_learning:'현재 실험 배치가 저장된 뒤 튜닝과 자식 실행을 일시중지합니다. 저장된 후보·기간·결과를 보존하며 다음 step으로 이어갑니다.',
  archive_strategy_learning:'전략 튜닝을 보관함으로 옮깁니다. 후보 그래프·판단·거래 기록과 연결 초안을 보존합니다.',
  restore_strategy_learning:'보관한 전략 튜닝을 실험 목록으로 복원합니다. 이전 결과와 다음 실행 위치를 유지합니다.',
  adopt_strategy_learning:'완료한 튜닝의 검증 통과 후보를 정확한 그래프의 새 정책 초안으로 저장합니다. expectedRevision은 session revision입니다. 정책 발행과 자동운용 적용은 앱에서 별도로 검토합니다.',
  read_quant_library:'공용 퀀트 전략의 입력·계산·조건·최종 BUY/HOLD/SELL 정의, 버전과 사용 마인드를 조회합니다. id로 버전 상세, id와 format으로 JSON/YAML 원본을 내보냅니다. 발행한 버전을 마인드 그래프에 배치합니다.',
  draft_quant_strategy:'입력부터 QUANT 최종 판단까지 완성된 공용 전략 초안을 저장합니다. strategyId는 새 버전, draftId와 expectedContentHash는 기존 초안 수정, JSON/YAML 가져오기는 새 전략을 만듭니다. 검토·발행은 라이브러리에서 수행합니다.',
  draft_mind_policy:'자료 연결·투자 범위·등록된 BTC 현물 전략 설정으로 마인드 정책 초안을 만듭니다. 서버가 버전·매개변수 식별값을 생성합니다. 검토와 발행은 앱에서 수행하며 JEV와 주문 API를 호출하지 않습니다.',
  read_market_knowledge:'사용자 소유 시장 라이브러리의 자료를 검색합니다. documentId로 원문, 분류 요청 상태, 승인과 실제 전송 기록을 조회합니다. 검색과 상세 조회의 openUrl로 해당 자료 버전을 앱에서 엽니다.',
  save_market_research:'뉴스 브리핑·전략 리서치를 개인 라이브러리에 바로 저장하고 열기 링크를 반환합니다. 새 문서는 document 또는 text를, 기존 자료를 보관하려면 documentId를 전달하세요. 마인드 활용 승인은 별도입니다.',
  write_market_knowledge:'공개 원문을 조사한 market-knowledge JSON/YAML을 초안으로 보관합니다. 내용 수정은 새 ID와 다음 버전으로 작성하며 승인은 앱에서 수행합니다. 분석 LLM API를 추가 호출하지 않습니다.',
  classify_market_knowledge:'자료 전체와 관련 승인 자료 최대 8개의 제목·요약·핵심 내용을 TypeSafe JEV에 보내 분류합니다. JEV API 사용량은 과금될 수 있습니다. 응답이 끊기면 read_market_knowledge에서 같은 documentId의 classificationAttempt 또는 저장된 분류를 먼저 읽으세요. 같은 요청 키는 저장된 결과를 반환합니다.',
  export_market_knowledge:'시장 지식 원문과 버전·출처·해시를 JSON/YAML로 내보내 새 버전의 분석에 사용합니다.',
  read_investment_status:'현재 사용자 마인드 계좌·최근 결정·관측·문서 검토·예약 상태를 원본 종류와 시점별로 조회합니다. 현재 시세 모의 판단을 시작할 때는 links.paperDecision, 과거 시세 실습은 links.paperPractice를 안내하세요. recentDecisions의 action은 판단, executionStatus는 저장된 실행 상태, fillCount는 모의 체결 건수입니다. null은 확인 불가입니다. status는 판단 상태이며 체결 확인은 executionStatus와 fillCount를 함께 사용하세요. 이유와 체결 원본은 같은 id, profileId, instrumentId로 read_trading_context의 result 보기를 사용하세요.',
  run_due_paper_jobs:'실행 시각이 된 사용자 동의 모의투자 작업을 처리하고 결과를 보관합니다.',
  read_mind_catalog:'투자 마인드, 원칙·학습 문서와 작성 양식을 조회합니다. 실제 자료를 먼저 읽고 분석 문서를 작성하세요.',
  read_trading_context:'선택한 종목과 마인드의 확정 캔들·원칙·기억을 조회합니다. 왜 판단했는지 또는 체결됐는지 묻는 경우 decisionId와 view:result로 저장된 현재 시세 모의 판단의 결과만 읽으세요. decisionId만 함께 전달하면 전체 판단 원문을 포함합니다.',
  write_mind_document:'JSON 또는 YAML 양식의 분석 문서를 검토 가능한 초안으로 저장합니다. 승인·활성화는 앱에서 수행합니다. 별도 분석 LLM API를 호출하지 않습니다.',
  classify_mind_document:'저장한 문서의 공통 메타데이터를 실제 JEV Choice로 분류하고 결과를 기록합니다. 이 명시적 작업은 JEV API를 호출합니다.',
  read_mind_manifest:'투자 마인드의 원칙·설정·문서 참조를 JSON 또는 YAML 매니페스트로 내보냅니다.',
};
const readTools=new Set(['validate_strategy_ontology','read_strategy_ontology','read_hourly_model_learning',...AUTOMATION_ACTIONS.filter(a=>a.mcp_tool&&a.api.method==='GET').map(a=>a.mcp_tool),'read_automated_trading','read_event_paper','read_simulation_draft','read_simulation_collection','read_strategy_learning','read_quant_library','read_market_knowledge','export_market_knowledge','read_investment_status','read_mind_catalog','read_trading_context','read_mind_manifest']);
const id=value=>typeof value==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9_.:@-]{0,199}$/.test(value);
const plain=value=>!!value&&typeof value==='object'&&!Array.isArray(value)&&[Object.prototype,null].includes(Object.getPrototypeOf(value));
function safeDocument(value,depth=0){return depth<20&&(value===null||typeof value==='boolean'||typeof value==='number'&&Number.isFinite(value)||typeof value==='string'&&value.length<=160000||Array.isArray(value)&&value.length<=500&&value.every(item=>safeDocument(item,depth+1))||plain(value)&&Object.keys(value).length<=60&&Object.entries(Object.getOwnPropertyDescriptors(value)).every(([key,descriptor])=>!['__proto__','prototype','constructor'].includes(key)&&Object.hasOwn(descriptor,'value')&&safeDocument(descriptor.value,depth+1)));}
function validArguments(name,args){
  if(name==='validate_strategy_ontology')return validOntologyValidationInput(args);
  const learning=HOURLY_LEARNING_ACTIONS.find(a=>a.mcp_tool===name);if(learning)return validHourlyLearningInput(learning,args);
  const automation=automationTool(name);if(automation)return validAutomationInput(automation,args)&&safeDocument(args);
  if(!plain(args)||!Object.hasOwn(schemas,name)||Object.keys(args).some(key=>!Object.hasOwn(schemas[name].properties,key)))return false;
  if((schemas[name].required??[]).some(key=>!Object.hasOwn(args,key)))return false;
  if(name==='read_trading_context'&&Object.hasOwn(args,'view')&&(args.view!=='result'||!id(args.decisionId)))return false;
  if(name==='viv_onboarding'){
    const count=Object.keys(args).length;
    if(args.action==='pause'||args.action==='resume'||args.action==='defer_connection')return count===1;
    if(args.action==='complete'){
      if(!Number.isInteger(args.lesson)||args.lesson<1||args.lesson>4)return false;
      return args.lesson===4?count===2||count===3&&(id(args.decisionId)||id(args.simulationId)):count===3&&(id(args.documentId)||args.readOnly===true);
    }
    return count===0||count===3&&['stocks','crypto','both'].includes(args.interest)&&Number.isSafeInteger(args.amountKrw)&&args.amountKrw>0&&args.amountKrw<=1e12&&id(args.idempotencyKey);
  }
  if(name==='read_event_paper'){
    const view=args.view??'status';if(!['status','records'].includes(view))return false;
    if(view==='status'&&(!id(args.profileId)||Object.hasOwn(args,'subscriptionId')||Object.hasOwn(args,'limit'))||view==='records'&&(!id(args.subscriptionId)||Object.hasOwn(args,'profileId')||args.limit!==undefined&&(!Number.isInteger(args.limit)||args.limit<1||args.limit>100)))return false;
  }
  if(['prepare_event_paper','pause_event_paper','release_event_paper'].includes(name)&&args.executionMode!=='paper')return false;
  if(name==='prepare_event_paper'&&args.maxPublicRequests!==undefined&&(!Number.isSafeInteger(args.maxPublicRequests)||args.maxPublicRequests<=0))return false;
  if(name==='prepare_event_paper'){try{normalizeOperationWindow(args);}catch{return false;}}
  if(name==='prepare_event_paper'&&(typeof args.capitalLimit!=='string'||!/^\d+(?:\.\d{1,8})?$/.test(args.capitalLimit)||Number(args.capitalLimit)<=0||Number(args.capitalLimit)>1e12||args.maxJevCallsPerDay!==undefined&&(!Number.isInteger(args.maxJevCallsPerDay)||args.maxJevCallsPerDay<0||args.maxJevCallsPerDay>JEV_EXECUTION_CALL_LIMIT)))return false;
  if(args.expectedSubscriptionRevision!==undefined&&(!Number.isSafeInteger(args.expectedSubscriptionRevision)||args.expectedSubscriptionRevision<0))return false;
  if(name==='save_simulation_draft'){try{validateSimulationDraftInput(args);}catch{return false;}}
  if(name==='read_simulation_collection'&&(args.q!==undefined&&(typeof args.q!=='string'||args.q.length>160)||args.kind!==undefined&&!['all','simulation','comparison','tuning'].includes(args.kind)||args.status!==undefined&&!['all','draft','active','completed','attention'].includes(args.status)))return false;
  if(name==='organize_simulation_collection'&&(!['archive','restore'].includes(args.action)||!['simulation','comparison','tuning'].includes(args.kind)||!Array.isArray(args.memberRevisions)||args.memberRevisions.length<1||args.memberRevisions.length>2||!args.memberRevisions.every(m=>plain(m)&&Object.keys(m).length===2&&id(m.id)&&Number.isSafeInteger(m.revision)&&m.revision>=0)))return false;
  if(args.archived!==undefined&&typeof args.archived!=='boolean')return false;
  if(name==='read_strategy_learning'){
    const view=args.view??'list';if(!['list','catalog','item'].includes(view))return false;
    if(view==='item'&&(!args.id||Object.hasOwn(args,'mindId'))||view!=='item'&&Object.hasOwn(args,'id')||view==='catalog'&&!args.mindId||view!=='list'&&Object.hasOwn(args,'archived'))return false;
  }
  if(name==='create_strategy_learning'){
    const stamp=v=>typeof v==='string'&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString()===v;
    if(args.name!==undefined&&(typeof args.name!=='string'||!args.name.trim()||args.name.length>160))return false;
    if(!Array.isArray(args.parameters)||args.parameters.length<1||args.parameters.length>3||!args.parameters.every(v=>plain(v)&&safeDocument(v)&&Object.keys(v).every(key=>['id','nodeId','path','values','bounds'].includes(key))&&id(v.id)&&id(v.nodeId)&&typeof v.path==='string'&&v.path.length>0&&v.path.length<=200&&Array.isArray(v.values)&&v.values.length>0&&v.values.length<=12&&v.values.every(value=>typeof value==='boolean'||typeof value==='number'&&Number.isFinite(value)||typeof value==='string'&&value.length<=160000)&&(v.bounds===undefined||plain(v.bounds)&&Object.keys(v.bounds).every(key=>['min','max','maxChange'].includes(key))&&Object.values(v.bounds).every(value=>typeof value==='number'&&Number.isFinite(value))&&(v.bounds.maxChange===undefined||v.bounds.maxChange>=0))))return false;
    for(const window of [args.training,args.validation])if(!plain(window)||Object.keys(window).length!==2||!stamp(window.startAt)||!stamp(window.endAt)||window.startAt>=window.endAt)return false;
    if(args.training.endAt>args.validation.startAt)return false;
    if(args.source!==undefined){const s=args.source;if(!plain(s)||!(s.assetMode==='UPBIT_EVENT_STREAM'&&Object.keys(s).length===2&&id(s.datasetId)||s.assetMode==='UPBIT_EVENT_UNIVERSE'&&Object.keys(s).length===2&&Array.isArray(s.datasetIds)&&s.datasetIds.length>=2&&s.datasetIds.length<=20&&s.datasetIds.every(id)&&new Set(s.datasetIds).size===s.datasetIds.length))return false;}
    if(args.research!==undefined){try{assertStrategyLearningResearchInput(args.research);}catch{return false;}}
    if(!plain(args.simulation)||Object.keys(args.simulation).some(k=>!['initialCash','feeBps','slippageBps'].includes(k))||!['initialCash','slippageBps',...(args.source?[]:['feeBps'])].every(key=>typeof args.simulation[key]==='number'&&Number.isFinite(args.simulation[key]))||args.simulation.initialCash<=0||args.simulation.slippageBps<0||args.simulation.feeBps!==undefined&&(typeof args.simulation.feeBps!=='number'||!Number.isFinite(args.simulation.feeBps)||args.simulation.feeBps<0))return false;
    if(typeof args.optInJev!=='boolean'||!Number.isInteger(args.maxJevCalls)||args.maxJevCalls<0||args.maxJevCalls>4096||args.objective!==undefined&&(!plain(args.objective)||!Object.keys(args.objective).every(key=>Object.hasOwn(schemas.create_strategy_learning.properties.objective.properties,key))||!Object.values(args.objective).every(value=>typeof value==='number'&&Number.isFinite(value))))return false;
    if(args.graph!==undefined){if(!plain(args.graph)||!safeDocument(args.graph))return false;try{compileStrategyGraph(args.graph);}catch{return false;}}
  }
  if(name==='read_quant_library'&&(args.format&&!args.id||args.id&&(Object.hasOwn(args,'search')||Object.hasOwn(args,'status'))||args.status&&!['DRAFT','APPROVED'].includes(args.status)))return false;
  if(name==='draft_quant_strategy'){
    const variants=['definition','document','text'].filter(key=>Object.hasOwn(args,key));if(variants.length!==1)return false;
    if(variants[0]==='definition'){if(typeof args.name!=='string'||!args.name.trim()||args.name.length>100||!plain(args.definition)||!safeDocument(args.definition)||Object.hasOwn(args,'format'))return false;}
    else if(['name','description','definition','strategyId','draftId','expectedContentHash'].some(key=>Object.hasOwn(args,key)))return false;
    if(Object.hasOwn(args,'draftId')!==Object.hasOwn(args,'expectedContentHash')||args.draftId&&args.strategyId||args.expectedContentHash&&!/^[a-f0-9]{64}$/.test(args.expectedContentHash))return false;
    if(args.description!==undefined&&(typeof args.description!=='string'||args.description.length>2000))return false;
  }
  if(name==='draft_mind_policy'){
    if(['externalKnowledge','strategyPlanDraft','universeDraft'].filter(k=>Object.hasOwn(args,k)).length!==1)return false;
    if(Object.hasOwn(args,'universeDraft')&&(!plain(args.universeDraft)||!safeDocument(args.universeDraft)))return false;
    if(Object.hasOwn(args,'externalKnowledge')&&(!plain(args.externalKnowledge)||!safeDocument(args.externalKnowledge)))return false;
    if(Object.hasOwn(args,'strategyPlanDraft')){const p=args.strategyPlanDraft;if(!plain(p)||Object.keys(p).some(k=>!['preset','enabled','instrumentPolicy','strategyMaxExposure','opportunityParameters','graph'].includes(k))||p.preset!=='BTC_SPOT_V1'||typeof p.enabled!=='boolean'||typeof p.strategyMaxExposure!=='number'||!Number.isFinite(p.strategyMaxExposure)||p.strategyMaxExposure<=0||p.strategyMaxExposure>1)return false;if(p.instrumentPolicy!==undefined&&!['FIXED','UNIVERSE_CURRENT','EACH_ASSET'].includes(p.instrumentPolicy))return false;if(Object.hasOwn(p,'opportunityParameters')&&(!plain(p.opportunityParameters)||Object.keys(p.opportunityParameters).length!==Object.keys(CLUTCH_DEFAULTS).length||!validateClutchParameters(p.opportunityParameters)))return false;if(Object.hasOwn(p,'graph')){if(Object.hasOwn(p,'opportunityParameters'))return false;try{compileStrategyGraph(p.graph);}catch{return false;}}}
  }
  for(const [key,value] of Object.entries(args)){
    if(['mindId','profileId','subscriptionId','instrumentId','decisionId','documentId','idempotencyKey','authorId','id','strategyId','draftId','previousSessionId','activationId','previewId','nonce'].includes(key)&&!id(value))return false;
    if(['search','cursor','sourceType','status','level','horizon','sentiment','novelty'].includes(key)&&(typeof value!=='string'||value.length>(key==='cursor'?2000:200)))return false;
    if(key==='pageSize'&&(!Number.isInteger(value)||value<1||value>50))return false;
    if(key==='expectedSourceManifestHash'&&!/^[a-f0-9]{64}$/.test(value))return false;
    if(key==='expectedRevision'&&(!Number.isSafeInteger(value)||value<0))return false;
    if(key==='maxJobs'&&(!Number.isInteger(value)||value<1||value>3))return false;
    if(key==='format'&&!['json','yaml'].includes(value))return false;
    if(key==='timeframe'&&!Object.hasOwn(MARKET_TIMEFRAME_MS,value))return false;
    if(key==='mode'&&!['live','replay'].includes(value))return false;
    if(key==='text'&&(typeof value!=='string'||!value.trim()||value.length>160000))return false;
    if(key==='document'&&(!plain(value)||!safeDocument(value)))return false;
  }
  if(name==='save_market_research')return ['document','text','documentId'].filter(key=>Object.hasOwn(args,key)).length===1;
  return !['write_mind_document','write_market_knowledge'].includes(name)||Object.hasOwn(args,'text')!==Object.hasOwn(args,'document');
}
function toolResult(output,isError=false){return {isError,content:[{type:'text',text:JSON.stringify(output)}],structuredContent:output};}
function decisionScope(detail,args,context,minds){
  const record=detail?.record??detail?.run;
  const fail=(code,message)=>({ok:false,code,message});
  if(!plain(record)||record.id!==args.decisionId)return fail('DECISION_RECORD_REQUIRED','요청한 판단의 저장 원문을 확인하세요.');
  const profileId=record.profileId??record.investmentProfileId;
  if(!id(profileId)||args.mindId&&profileId!==args.mindId||Array.isArray(minds?.minds)&&!minds.minds.some(mind=>mind.id===profileId))return fail('DECISION_MIND_SCOPE','선택한 마인드와 판단의 소유 범위를 확인하세요.');
  const input=record.inputPackage??{},clues=new Set();let instrumentId=record.instrumentId??null;
  if(!instrumentId){
    for(const provider of [input.marketProvider,input.marketData?.provider,input.marketData?.manifest?.provider]){if(provider==='okx')clues.add('crypto:okx:BTC-USDT');if(provider==='binance')clues.add('crypto:binance:BTCUSDT');}
    for(const loader of [input.marketLoaderVersion,input.marketData?.manifest?.loaderVersion,input.sourceManifest?.loaderVersion]){if(typeof loader==='string'&&loader.startsWith('okx-'))clues.add('crypto:okx:BTC-USDT');if(typeof loader==='string'&&loader.startsWith('binance-'))clues.add('crypto:binance:BTCUSDT');}
    for(const origin of [input.marketOrigin,input.marketData?.dataset?.sourceUrl]){if(typeof origin==='string'){try{const host=new URL(origin).hostname;if(host==='data.binance.vision'||host==='api.binance.com')clues.add('crypto:binance:BTCUSDT');if(host==='openapi.okx.com'||host==='www.okx.com')clues.add('crypto:okx:BTC-USDT');}catch{}}}
    if(clues.size===0&&['HISTORICAL_FUNCTIONAL_REPLAY','MECHANICAL_BACKTEST','POINT_IN_TIME_BACKTEST','RETROSPECTIVE_POLICY_SIMULATION'].includes(input.experimentType))clues.add('crypto:binance:BTCUSDT');
    if(clues.size>1)return fail('DECISION_SOURCE_CONFLICT','판단 원문에 저장된 시세 공급원 단서가 서로 다릅니다. 원본을 확인하세요.');
    instrumentId=[...clues][0]??null;
  }
  if(!instrumentId)return fail('DECISION_SOURCE_REQUIRED','기존 판단에 저장된 종목·시세 원본의 식별 정보를 확인하세요.');
  if(instrumentId!==args.instrumentId)return fail('DECISION_INSTRUMENT_SCOPE','선택 종목과 판단 원문의 실제 거래소·종목을 일치시켜 조회하세요.');
  const experimentType=record.experimentType??input.experimentType;
  const recordMode=record.mode??(experimentType==='FORWARD_PAPER'?'live':experimentType?'replay':null),contextMode=args.mode??context?.model?.mode??'live';
  if(recordMode&&recordMode!==contextMode)return fail('DECISION_MODE_SCOPE','현재 시세와 과거 재생을 같은 범위로 선택해 판단 원문을 조회하세요.');
  return {ok:true,profileId,instrumentId,recordMode,contextMode,warnings:recordMode?[]:['DECISION_MODE_UNVERIFIED']};
}
async function studioCall(request,env,options,path,{method='GET',body}={}){
  const headers={'oai-authenticated-user-id':request.headers.get('oai-authenticated-user-id')};if(body!==undefined){headers['Content-Type']='application/json';headers.Origin=new URL(request.url).origin;}
  const make=()=>new Request(new URL(path,request.url),{method,headers,...(body===undefined?{}:{body:JSON.stringify(body)})});
  const handler=path.startsWith('/api/workspace/hourly-learning')?(await import('./hourly-model-learning.mjs')).handleHourlyLearningAPI:path.startsWith('/api/workspace/automated-trading')?(options.automatedTradingHandler??(await import('./automated-trading.mjs')).handleAutomatedTradingAPI):path.startsWith('/api/workspace/event-paper')?(options.eventPaperHandler??(await import('./event-paper-api.mjs')).handleEventPaperAPI):path.startsWith('/api/workspace/strategy-learning')?(options.strategyLearningHandler??(await import('./strategy-learning.mjs')).handleStrategyLearningAPI):(options.studioHandler??(await import('./mind-studio.mjs')).handleMindStudioAPI);
  let response=await handler(make(),env,options);
  if(response===null||response===undefined){const fallback=options.workspaceHandler??(await import('./workspace-api.mjs')).handleWorkspaceAPI;response=await fallback(make(),env,options);}
  if(!(response instanceof Response))throw new Error('MCP_API_RESPONSE');
  const contentType=response.headers.get('Content-Type')??'',raw=await response.text();
  let value;if(contentType.includes('json')){try{value=JSON.parse(raw);}catch{throw new Error('MCP_API_RESPONSE');}if(!plain(value))throw new Error('MCP_API_RESPONSE');}else value={ok:response.ok,text:raw,contentType};
  return {ok:response.ok&&value?.ok!==false,value};
}
async function callMindTool(request,env,options,name,args){
  const learning=HOURLY_LEARNING_ACTIONS.find(a=>a.mcp_tool===name);if(learning){const call=hourlyLearningRequest(learning.id,args),result=await studioCall(request,env,options,call.path,call.body?{method:'POST',body:call.body}:{});return toolResult(result.value,!result.ok); }
  const automation=automationTool(name);if(automation){const call=automationRequest(automation.id,args),result=await studioCall(request,env,options,call.path,call.body?{method:'POST',body:call.body}:{});return toolResult(result.value,!result.ok);}
  if(name==='read_event_paper'){const {view='status',...query}=args,result=await studioCall(request,env,options,'/api/workspace/event-paper'+(view==='records'?'/records':'')+'?'+new URLSearchParams(query));return toolResult(result.value,!result.ok);}
  if(['prepare_event_paper','pause_event_paper','release_event_paper'].includes(name)){const operation=name.split('_')[0],result=await studioCall(request,env,options,'/api/workspace/event-paper/'+operation,{method:'POST',body:args});return toolResult(result.value,!result.ok);}
  if(name==='read_simulation_draft'||name==='save_simulation_draft'){const read=name==='read_simulation_draft',path='/api/workspace/simulations/draft'+(read&&args.id?'?'+new URLSearchParams(args):''),result=await studioCall(request,env,options,path,read?{}:{method:'POST',body:args});return toolResult(result.value,!result.ok);}
  if(name==='read_simulation_collection'){
    const result=await studioCall(request,env,options,'/api/workspace/simulations/collection?'+new URLSearchParams(args));
    if(result.ok)result.value.items=result.value.items.map(item=>{
      const params=new URLSearchParams({view:'simulations',executionMode:'paper'});
      for(const [key,value] of Object.entries(item.route))if(value!=null)params.set(key,value);
      return {...item,openUrl:new URL('#minds?'+params,new URL('/',request.url)).href};
    });
    return toolResult(result.value,!result.ok);
  }
  if(name==='organize_simulation_collection'){const {action,...body}=args,result=await studioCall(request,env,options,'/api/workspace/simulations/collection/'+action,{method:'POST',body});return toolResult(result.value,!result.ok);}
  if(name==='read_strategy_learning'){
    const {view='list',...query}=args,path='/api/workspace/strategy-learning'+(view==='list'?'':'/'+view)+(Object.keys(query).length?'?'+new URLSearchParams(query):'');
    const result=await studioCall(request,env,options,path);return toolResult(result.value,!result.ok);
  }
  if(['create_strategy_learning','step_strategy_learning','pause_strategy_learning','archive_strategy_learning','restore_strategy_learning','adopt_strategy_learning'].includes(name)){
    const operation=name.split('_')[0],result=await studioCall(request,env,options,'/api/workspace/strategy-learning/'+operation,{method:'POST',body:args});return toolResult(result.value,!result.ok);
  }
  if(name==='read_quant_library'){
    const {id:strategyVersionId,format,...filters}=args;
    const path='/api/workspace/quant-strategies'+(strategyVersionId?(format?'/export':'/item')+'?'+new URLSearchParams({id:strategyVersionId,...(format?{format}:{})}):'?'+new URLSearchParams(filters));
    const result=await studioCall(request,env,options,path);return toolResult(result.value,!result.ok);
  }
  if(name==='draft_quant_strategy'){
    const result=await studioCall(request,env,options,'/api/workspace/quant-strategies/draft',{method:'POST',body:args});
    const name=result.value.item?.name;
    if(result.ok&&name)result.value.openUrl=new URL('/#library?'+new URLSearchParams({view:'quant',section:'components',executionMode:'paper',status:'DRAFT',search:name}),request.url).href;
    return toolResult(result.value,!result.ok);
  }
  if(name==='draft_mind_policy'){const result=await studioCall(request,env,options,'/api/workspace/mind-documents/policy-draft',{method:'POST',body:args});return toolResult(result.value,!result.ok);}
  if(name==='read_mind_catalog'){
    const [catalog,forms,knowledgeForm]=await Promise.all([studioCall(request,env,options,'/api/workspace/minds'),studioCall(request,env,options,'/api/workspace/mind-forms'),studioCall(request,env,options,'/api/workspace/market-knowledge/forms')]);
    if(!catalog.ok||!forms.ok)return toolResult(!catalog.ok?catalog.value:forms.value,true);
    const library=await studioCall(request,env,options,'/api/workspace/market-knowledge?pageSize=8');
    return toolResult({ok:true,catalog:catalog.value,forms:forms.value,researchProtocol:strategyLearningResearchProtocol(),marketKnowledge:{formsUrl:'/api/workspace/market-knowledge/forms',...(knowledgeForm.ok?{form:knowledgeForm.value}:{}),writeTool:'write_market_knowledge',saveTool:'save_market_research',classifyTool:'classify_market_knowledge',...(library.ok?{page:library.value.page,revision:library.value.revision}:{})}});
  }
  if(name==='read_trading_context'){
    if(args.view==='result'){
      const detail=await studioCall(request,env,options,'/api/workspace/decisions/detail?'+new URLSearchParams({id:args.decisionId}));
      if(!detail.ok)return toolResult(detail.value,true);
      const saved=detail.value.decision,scope=decisionScope(saved,args);
      if(!scope.ok)return toolResult(scope,true);
      const {record,manifest,fills}=saved;
      if((record.experimentType??record.inputPackage?.experimentType)!=='FORWARD_PAPER')
        return toolResult({ok:false,code:'PAPER_DECISION_REQUIRED',message:'현재 시세 모의 판단의 기록을 선택하세요.'},true);
      const timeframe=record.timeframe??record.inputPackage?.timeframe??record.rawRequest?.state?.market?.timeframe??record.strategyEvaluation?.timeframe??null;
      if(timeframe&&args.timeframe&&timeframe!==args.timeframe)
        return toolResult({ok:false,code:'DECISION_TIMEFRAME_SCOPE',message:'저장된 판단의 캔들 주기를 확인하세요.'},true);
      let quoteCurrency=record.quoteCurrency??null;
      if(!quoteCurrency)try{quoteCurrency=getInstrument(scope.instrumentId).quoteCurrency;}catch{}
      const basis=isFirstPaperDecisionPlan(manifest?.data?.strategyPlan)?paperTrendResultBasis(record,fills):null;
      return toolResult({ok:true,result:{decisionId:record.id,profileId:scope.profileId,instrumentId:scope.instrumentId,timeframe,
        executionMode:'paper',asOf:record.asOf??record.inputPackage?.asOf??null,quoteCurrency,action:record.decision?.action??null,
        executionStatus:record.execution?.status??null,fillCount:paperDecisionFillCount(record,fills),basis,
        openUrl:new URL(paperDecisionRecordHash(record.id),new URL(request.url).origin).href}});
    }
    const query=new URLSearchParams({...(args.mindId?{profileId:args.mindId}:{}),instrumentId:args.instrumentId,...(args.timeframe?{timeframe:args.timeframe}:{}),...(args.mode?{mode:args.mode}:{})});
    const [context,minds,detail]=await Promise.all([studioCall(request,env,options,'/api/workspace/terminal?'+query),studioCall(request,env,options,'/api/workspace/minds'),args.decisionId?studioCall(request,env,options,'/api/workspace/decisions/detail?'+new URLSearchParams({id:args.decisionId})):Promise.resolve(null)]);
    if(!context.ok||!minds.ok)return toolResult(!context.ok?context.value:minds.value,true);
    if(detail&&!detail.ok)return toolResult(detail.value,true);
    const scope=detail?decisionScope(detail.value.decision,args,context.value,minds.value):null;if(scope&&!scope.ok)return toolResult(scope,true);
    return toolResult({ok:true,scope:{mindId:args.mindId??null,instrumentId:args.instrumentId,decisionId:args.decisionId??null,timeframe:args.timeframe??null,mode:args.mode??null},context:context.value,minds:minds.value,...(detail?{decision:detail.value.decision,decisionContext:scope}:{})});
  }
  const knowledgeOpenUrl=knowledgeId=>new URL('/#library?'+new URLSearchParams({view:'documents',executionMode:'paper',knowledgeId}),request.url).href;
  if(['read_market_knowledge','export_market_knowledge'].includes(name)){
    const {documentId,...filters}=args;const path=name==='export_market_knowledge'?'/api/workspace/market-knowledge/export?'+new URLSearchParams({id:documentId,format:args.format}):documentId?'/api/workspace/market-knowledge/item?'+new URLSearchParams({id:documentId}):'/api/workspace/market-knowledge?'+new URLSearchParams(filters);
    const result=await studioCall(request,env,options,path);
    if(result.ok&&name==='read_market_knowledge'){
      if(documentId)result.value.openUrl=knowledgeOpenUrl(result.value.item.id);
      else for(const item of result.value.page.items)item.openUrl=knowledgeOpenUrl(item.id);
    }
    return toolResult(result.value,!result.ok);
  }
  let shared=['write_market_knowledge','classify_market_knowledge','save_market_research'].includes(name);
  if(name==='write_mind_document'){try{shared=(args.document??parseMindData(args.text,{format:args.format??'auto'})).kind==='market-knowledge';}catch{}}
  if(name==='classify_mind_document'){
    const lookup=await studioCall(request,env,options,'/api/workspace/market-knowledge/item?'+new URLSearchParams({id:args.documentId}));shared=lookup.ok;if(!lookup.ok&&lookup.value.code!=='KNOWLEDGE_NOT_FOUND')return toolResult(lookup.value,true);
  }
  if(shared){
    const operation=name==='save_market_research'?'save':['classify_market_knowledge','classify_mind_document'].includes(name)?'classify':'write';
    const path='/api/workspace/market-knowledge/'+operation;
    const result=await studioCall(request,env,options,path,{method:'POST',body:args});
    const knowledgeId=result.value.item?.id;
    if(result.ok&&operation!=='classify'&&knowledgeId)result.value.openUrl=knowledgeOpenUrl(knowledgeId);
    if(result.ok&&operation==='save'&&knowledgeId)result.value.effect={action:'LIBRARY_SAVE',scope:'PERSONAL_LIBRARY',mindUseChanged:false};
    return toolResult(result.value,!result.ok);
  }
  const path=name==='write_mind_document'?'/api/workspace/mind-documents':name==='classify_mind_document'?'/api/workspace/mind-documents/classify':'/api/workspace/minds/export?'+new URLSearchParams({mindId:args.mindId,format:args.format});
  const result=await studioCall(request,env,options,path,name==='read_mind_manifest'?{}:{method:'POST',body:args});return toolResult(result.value,!result.ok);
}
export async function handleMcp(request,env,options={}){
  const json=(value,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store'}});
  if(request.method!=='POST')return json({error:'Use POST'},405);
  if(request.headers.get('Origin')&&request.headers.get('Origin')!==new URL(request.url).origin||request.headers.get('Sec-Fetch-Site')==='cross-site')return json({error:'Open this operation in the app'},403);
  let input;try{
    const reader=request.body?.getReader();if(!reader)return json({error:'Invalid JSON'},400);const parts=[];let size=0;
    while(true){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>200000){await reader.cancel();return json({error:'Request too large'},413);}parts.push(part.value);}
    const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.byteLength;}input=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
  }catch{return json({error:'Invalid JSON'},400);}
  if(!input||typeof input!=='object'||Array.isArray(input)||input.jsonrpc!=='2.0'||typeof input.method!=='string')return json({jsonrpc:'2.0',id:null,error:{code:-32600,message:'Invalid request'}},400);
  const id=input.id??null,reply=result=>json({jsonrpc:'2.0',id,result});
  if(input.method==='initialize'){
    const versions=['2025-11-25','2025-06-18','2025-03-26','2024-11-05'];
    return reply({protocolVersion:versions.includes(input.params?.protocolVersion)?input.params.protocolVersion:versions[0],capabilities:{tools:{},prompts:{}},serverInfo:{name:'viv',title:'VIV · Vibe Investment',version:'1.0.0'},instructions:VIV_INSTRUCTIONS});
  }
  if(input.method.startsWith('notifications/')&&!Object.hasOwn(input,'id'))return new Response(null,{status:202});
  if(input.method==='ping')return reply({});
  if(input.method==='prompts/list')return reply({prompts:[{name:'viv_start',title:'VIV 시작하기',description:'저장한 모의 판단을 다시 열거나 튜토리얼과 모의계좌 설정을 시작합니다.'}]});
  if(input.method==='prompts/get'&&input.params?.name==='viv_start')return reply({description:'VIV 시작하기',messages:[{role:'user',content:{type:'text',text:VIV_PLAYBOOK}}]});
  if(input.method==='server/discover')return reply({supportedVersions:['2026-07-28'],capabilities:{tools:{}}});
  if(input.method==='tools/list')return reply({tools:Object.entries(schemas).map(([name,inputSchema])=>({name,inputSchema,description:descriptions[name],annotations:automationTool(name)?{readOnlyHint:automationTool(name).api.method==='GET',destructiveHint:['automation.trading.activate','automation.trading.resume','automation.trading.strategy.update'].includes(automationTool(name).id),idempotentHint:automationTool(name).idempotent,openWorldHint:['automation.trading.prepare','automation.trading.activate','automation.trading.resume','automation.trading.strategy.update'].includes(automationTool(name).id)}:{readOnlyHint:readTools.has(name),destructiveHint:['activate_automated_trading','configure_hourly_model_learning'].includes(name),idempotentHint:!['run_due_paper_jobs','prepare_automated_trading','activate_automated_trading','configure_hourly_model_learning'].includes(name),openWorldHint:['prepare_automated_trading','activate_automated_trading','prepare_event_paper','step_strategy_learning','run_due_paper_jobs','read_trading_context','classify_mind_document','classify_market_knowledge'].includes(name)}}))});
  if(input.method==='tools/call'){
    const name=input.params?.name,args=input.params?.arguments??{},owner=request.headers.get('oai-authenticated-user-id');
    if(!Object.hasOwn(schemas,name)||!owner||!validArguments(name,args))return reply(toolResult({ok:false,code:'INVALID_TOOL_ARGUMENTS',message:'로그인과 요청 항목을 확인하세요.'},true));
    if(name==='read_strategy_ontology')return reply(toolResult({ok:true,manifest:capabilityManifest()}));
    if(name==='validate_strategy_ontology')return reply(toolResult({ok:true,report:validateOntologyFacts(args)}));
    if(name==='viv_onboarding'){
      try{
        const result=await vivOnboarding(args,{origin:new URL(request.url).origin,db:env.DB,owner,call:(path,init)=>studioCall(request,env,options,path,init)});
        return reply(toolResult({...result.value,playbook:VIV_PLAYBOOK},!result.ok));
      }catch{return reply(toolResult({ok:false,code:'VIV_ONBOARDING_FAILED',message:'VIV 시작 안내를 불러오지 못했습니다. 연결을 확인한 뒤 다시 시도하세요.'},true));}
    }
    if(!['read_investment_status','run_due_paper_jobs'].includes(name)){
      try{return reply(await callMindTool(request,env,options,name,args));}catch{return reply(toolResult({ok:false,code:'MIND_TOOL_FAILED',message:'분석 도구 실행을 완료하지 못했습니다. 앱의 연결 상태와 문서 형식을 확인하세요.'},true));}
    }
    try{
      const handler=options.workspaceHandler??(await import('./workspace-api.mjs')).handleWorkspaceAPI;
      const result=await handler(new Request(new URL(name==='run_due_paper_jobs'?'/api/workspace/jobs/run':'/api/workspace',request.url),{method:name==='run_due_paper_jobs'?'POST':'GET',headers:{'oai-authenticated-user-id':owner,...(name==='run_due_paper_jobs'?{'Content-Type':'application/json'}:{})},...(name==='run_due_paper_jobs'?{body:JSON.stringify({maxJobs:args.maxJobs??3})}:{})}),env,name==='run_due_paper_jobs'?{...options,[MIND_MCP_DELIVERY]:true}:options);
      const value=await result.json(),now=new Date(typeof options.now==='function'?options.now():options.now??Date.now()).toISOString();
      const output=name==='read_investment_status'&&result.ok?buildInvestmentStatus(value,{now}):name==='run_due_paper_jobs'&&result.ok?{ok:true,report:value.report}:value;
      if(name==='read_investment_status'&&result.ok){
        const origin=new URL(request.url).origin;
        output.links={
          paperDecision:new URL(PAPER_DECISION_ENTRY,origin).href,
          paperPractice:new URL(PAPER_PRACTICE_ENTRY,origin).href,
        };
        output.recentDecisions=output.recentDecisions.map(row=>row.sourceKind==='mind-run'
          ?{...row,openUrl:new URL(paperDecisionRecordHash(row.id),origin).href}
          :row);
      }
      return reply(toolResult(output,!result.ok||output?.ok===false));
    }catch(error){return reply(toolResult({ok:false,code:error instanceof InvestmentReadError?error.code:'INVESTMENT_STATUS_READ_FAILED',message:error instanceof InvestmentReadError?error.message:'현재 사용자 상태를 조회하지 못했습니다. 저장 원본과 연결을 확인하세요.'},true));}
  }
  return json({jsonrpc:'2.0',id,error:{code:-32601,message:'Method not found'}});
}


