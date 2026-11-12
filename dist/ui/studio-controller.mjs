import {optionalSessionStorage} from './session-storage.mjs';
import {createWorkspaceCalendar} from './workspace-calendar.mjs';
import {revealDialogError} from './dialog-focus.mjs';
import {terminalRunRequirement} from './terminal-workspace-controls.mjs';
import {mindDocumentImpact} from '../domain/mind-document-impact.mjs';
import {calendarPortfolioSelection} from '../domain/adaptive-portfolio-graph.mjs';
import {createRegimeProgramGraph,isRegimeProgramGraph} from '../domain/regime-program-graph.mjs';
import {createMindHudRuntime,renderMindHud} from './mind-hud.mjs';
import {clearFormDraft,replaceFormDraftValues} from './form-draft.mjs';
import {renderWorkflowState,renderFilterSummary} from './workflow-state.mjs';
import {operationWindowFields,operationWindowValues,operationWindowSummary} from './operation-window.mjs';
import {renderDataTable} from './data-table.mjs';
import {createMindLifeRuntime,renderLifeGallery,renderLifeStage} from './mind-life.mjs';
import {renderCapabilityCatalog,filterCapabilityCatalog} from './capability-catalog.mjs';
import {callAutomation} from '../system/automation-contracts.mjs';
import {currencyAmount} from './currency-format.mjs';
import {PAPER_MIND_STARTERS,createPaperMindPresetGraph,FIRST_PAPER_DECISION_STARTER,isFirstPaperDecisionPlan as firstDecisionPlan,paperTrendResultBasis} from '../domain/paper-mind-presets.mjs';
import {STRATEGY_TRACE_TYPES,strategyInputNodeLabel,strategyTraceNodeLabel,strategyTraceValue,strategyTraceSelection} from './decision-method.mjs';
import {submitPaperFunding} from './paper-funding-request.mjs';
import {paperBudgetSummary} from '../domain/paper-budget.mjs';
import {PAPER_DECISION_ENTRY,PAPER_DECISION_INSTRUMENT,PAPER_DECISION_TIMEFRAME,PAPER_PRACTICE_ENTRY,paperDecisionRecordHash} from '../system/paper-decision-links.mjs';
import {subscriptionInstrumentIds} from '../domain/mind-subscriptions.mjs';
import {createBrokerConnections,brokerPaperReturnLink} from './broker-connections.mjs';
import {createAutomatedTrading,isEventAutomationMind,saveLiveStrategyUpdate} from './automated-trading.mjs';
import {createEventPaperResource} from './event-paper-resource.mjs';
import {createEventPaperTrading,isEventPaperMind} from './event-paper-trading.mjs';
import {TARGET_WEIGHT_FOLLOWING_HELP} from './decision-method.mjs';
import {helpLabel,helpTooltip} from './help-tooltip.mjs';
import {strategyPlanGraph,strategyPlanModules,strategyPlanWithGraph,draftMindStrategyPlan,createMindStrategyPlan} from '../domain/mind-strategy-plan.mjs';
import {createDecisionStrategyGraph,graphRequiresJev,strategyGraphHash} from '../domain/strategy-graph.mjs';
import {universeCatalogPickerMarkup,bindUniverseCatalogPickers} from './universe-catalog-picker.mjs';
import {createTerminalUniverse} from './terminal-universe.mjs';
import {universeEditorMarkup,readUniverseForm,universePolicySummary,updateUniverseSelectionCount,filterUniverseOptions} from './universe-editor.mjs';
import {parseSectorSnapshotImport} from '../domain/market-sectors.mjs';
import {createCursorHistory} from './cursor-navigation.mjs';
import {createSimulationPlayground,isSimulationRoute,SIMULATION_TABS} from './simulation-playground.mjs';
import {buildMindCompanions} from '../domain/mind-companion.mjs';
import {paperMindActivity} from '../domain/mind-activity-projection.mjs';
import {createMindActivityResource} from './mind-activity-resource.mjs';
import {createPaperActivityResource} from './paper-activity-resource.mjs';
import {renderMindActivityHero,renderMindActivityFeed,renderMindActivityPreview,mindActivityExecution,mindActivityModel,filterMindActivityRecords,installMindActivityPreviews} from './mind-activity.mjs';
import {renderMindCompanions,executionModeOf,renderMindAutomationEntry,renderMindNodeEdit} from './mind-companion.mjs';
import {mindAvatarIdentity} from './mind-avatar.mjs';
import {createTradingTerminal,terminalDecisionView,terminalTooltipContent,terminalModelMeasures,terminalExecutionRetryable,liveTerminalRecords,liveTerminalLatestDecision} from './trading-terminal.mjs';
import {listInstruments,getInstrument} from '../domain/instruments.mjs';
import {assertMindDocument,parseMindDocument,serializeMindDocument,mindDocumentHash,MIND_FORM_KINDS} from '../domain/mind-manifest.mjs';
import {investmentFilename} from './brand.mjs';
import {createQuantStrategyLibrary,labelQuantStrategyInstance} from './quant-strategy-library.mjs';
import {attachQuantStrategy,createQuantStrategyMindGraph} from '../domain/quant-strategy-library.mjs';
import {createMarketLibrary,KNOWLEDGE_LABELS,knowledgePublicationLabel} from './market-library.mjs';
import {studioReturnLink} from './studio-shell.mjs';
import {disabledExternalKnowledge} from '../domain/external-knowledge-policy.mjs';
import {createNewsComparisonUI} from './news-comparison.mjs';
import {MIND_APPEARANCE_OPTIONS,readMindAppearance} from '../domain/workspace.mjs';
import {renderActionMenu} from './action-menu.mjs';
import {createHomeShowcase} from './home-showcase.mjs';
import {strategyTimeframeParameter} from '../domain/strategy-parameters.mjs';
import {createMindContextNote} from '../domain/mind-context-note.mjs';

const list=value=>Array.isArray(value)?value:[];
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const num=(value,digits=2)=>Number.isFinite(value)?new Intl.NumberFormat('ko-KR',{minimumFractionDigits:digits,maximumFractionDigits:digits}).format(value):'—';
const money=currencyAmount;
const instrumentCurrency=id=>{try{return getInstrument(id).quoteCurrency;}catch{return null;}};
const pct=value=>Number.isFinite(value)?num(value*100)+'%':'—';
const percentagePoints=value=>Number.isFinite(value)?num(value*100)+'%p':'—';
const when=value=>value&&Number.isFinite(Date.parse(value))?new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(value))+' KST':'—';
const byId=(items,id)=>list(items).find(item=>item.id===id);
const firstPaperDecision=route=>route.page==='trade'&&executionModeOf(route)==='paper'&&route.params.get('firstDecision')==='1';
const button=(label,action,id='',extra='',className='')=>`<button type="button" class="button small${className?' '+esc(className):''}" data-studio-action="${action}" data-studio-id="${esc(id)}" ${extra}>${esc(label)}</button>`;
const row=(label,value)=>`<div class="detail-row"><span>${esc(label)}</span><strong>${value}</strong></div>`;
function savedDecisionManifest(record,detail){const manifest=detail.manifest;if(!manifest||manifest.id!==record.manifestId||manifest.scope?.profileId!==record.profileId)return null;try{return mindDocumentHash(manifest)===record.manifestHash?manifest:null;}catch{return null;}}
function savedDecisionContext(record,detail,view){
  const input=record.inputPackage||{},state=record.rawRequest?.state||record.jevRequest?.state||{};
  const instrumentId=record.instrumentId||input.instrumentId||input.instrument?.id||input.marketSnapshot?.instrumentId||state.market?.instrument?.id;
  let instrument=[state.market?.instrument,input.instrument,input.marketSnapshot?.instrument].find(item=>item?.id===instrumentId);
  if(!instrument&&instrumentId){try{instrument=getInstrument(instrumentId);}catch{instrument={id:instrumentId};}}
  const profileId=record.profileId||record.investmentProfileId||record.mindId||input.investmentProfileId||state.profileId;
  const name=savedDecisionManifest(record,detail)?.data.name||record.profileName||(detail.profile?.id===profileId?detail.profile.name:null)||(view.profileId===profileId?view.profileName:null)||profileId||'마인드 미기록';
  const timeframe=record.timeframe||input.timeframe||state.market?.timeframe||input.marketSnapshot?.timeframe;
  const period=({'1m':'1분봉','3m':'3분봉','5m':'5분봉','1h':'1시간봉','4h':'4시간봉','1d':'일봉'})[timeframe]||'캔들 주기 미기록';
  const experiment=record.experimentType||input.experimentType||state.simulation?.experimentType;
  const explicitMode=record.executionMode||input.executionMode;
  const mode=experiment==='FORWARD_PAPER'?'모의':experiment==='HISTORICAL_FUNCTIONAL_REPLAY'?'과거 실험 · 모의':experiment==='RETROSPECTIVE_POLICY_SIMULATION'?'시뮬레이션 · 모의':explicitMode==='paper'?'모의':explicitMode==='live'?'실전':'저장 유형 확인 필요';
  const version=state.manifestVersion??record.manifestVersion??input.manifestVersion;
  return '<section class="studio-detail-intro" data-saved-decision-context data-decision-id="'+esc(record.id)+'" data-profile-id="'+esc(profileId)+'" data-instrument-id="'+esc(instrumentId)+'"><strong>'+esc(name)+' · '+esc(instrument?.symbol||instrumentId||'종목 미기록')+' · '+esc(instrument?.venue||'거래소 미기록')+'</strong><p class="tiny muted">'+esc(period)+' · '+esc(mode)+(Number.isSafeInteger(version)?' · 적용 정책 v'+version:'')+'</p></section>';
}
export function paperTrendDecisionBasis(record,currency,fills){
  const basis=paperTrendResultBasis(record,fills);
  if(!basis)return '';
  const {close,slowMA,lookbackBars}=basis,explanation=basis.explanation?'<p>'+esc(basis.explanation)+'</p>':'';
  return '<section class="studio-detail-intro" aria-labelledby="paper-trend-basis"><h3 id="paper-trend-basis">판단에 사용한 시세</h3><p>확정 종가 '+esc(money(close,currency))+' · '+num(lookbackBars,0)+'봉 이동평균 '+esc(money(slowMA,currency))+'</p>'+explanation+'</section>';
}
function savedPolicyContext(saved,currentPolicy){
  const doc=saved.document||saved;if(doc.kind!=='mind-policy')return '';
  const relation=currentPolicy?.id===doc.id?'현재 발행 정책':saved.status==='APPROVED'?(currentPolicy?'이전 발행 정책':'저장된 발행 정책'):'검토 중 정책';
  return '<section class="studio-detail-intro" data-saved-policy-context data-document-id="'+esc(doc.id)+'"><strong>'+esc(relation)+' v'+esc(doc.data.version)+'</strong><p class="tiny muted">정책 기준 '+esc(when(doc.asOf))+' · 사용 가능 '+esc(when(doc.availableAt))+'</p></section>';
}
const raw=(value,label='원본 기록')=>`<details class="spaced"><summary>${esc(label)}</summary><pre class="code">${esc(JSON.stringify(value,null,2))}</pre></details>`;
const area=(label,name,value='',extra='',maxLength=12000)=>`<label class="field full">${esc(label)}<textarea name="${name}"${maxLength===null?'':` maxlength="${maxLength}"`} required ${extra}>${esc(value)}</textarea></label>`;
const field=(label,name,value='',type='text',extra='')=>`<label class="field">${esc(label)}<input name="${name}" type="${type}" value="${esc(value)}" required ${extra}></label>`;
const select=(label,name,options,value,required=false)=>`<label class="field">${esc(label)}<select name="${name}"${required?' required':''}>${options.map(([id,name])=>`<option value="${esc(id)}"${id===value?' selected':''}>${esc(name)}</option>`).join('')}</select></label>`;
const table=(heads,rows,empty='기록이 없습니다.')=>rows.length?renderDataTable(heads,rows):typeof empty==='object'?renderWorkflowState(empty):`<div class="empty">${esc(empty)}</div>`;
const TASK_DESCRIPTIONS={'계좌·자금':'연결 계좌의 잔고와 마인드에 배정한 자금을 확인합니다.','서비스 연결':'거래소와 AI 연결 상태를 관리합니다.','자동 운용':'실행 중인 마인드와 최근 운용 기록을 확인합니다.','데이터':'종목 목록과 입력 자료를 수집하고 저장 기록을 관리합니다.','기능 목록':'노드의 입출력과 액션별 호출 경로를 검색합니다.','가져오기 양식':'작성할 자료 종류를 선택하면 해당 양식이 열립니다.','투자 경험':'과거 판단과 후속 성과를 함께 확인합니다.','검토함':'검토를 기다리는 자료를 선택해 확인합니다.'};
const title=(text,actions='')=>`<div class="studio-page-head"><h1 tabindex="-1">${esc(text)}</h1><div class="actions">${actions}</div></div>${TASK_DESCRIPTIONS[text]?`<p class="studio-task-description">${esc(TASK_DESCRIPTIONS[text])}</p>`:''}`;
const CAPABILITY_GUIDE='<a class="button small" data-capability-guide href="https://github.com/HwigwanJi/viv#readme" target="_blank" rel="noopener noreferrer">VIV 사용 안내 ↗</a>';
const MIND_STARTER_GUIDE='<a href="https://github.com/HwigwanJi/viv/blob/main/docs/agents/operations/viv-mcp-playbook.md#기본-프리셋으로-시작하기" target="_blank" rel="noopener noreferrer">기본 프리셋 실습 안내 ↗</a>';
const recordTimeMarkup=record=>{if(record.kind==='fill')return esc(when(record.asOf));const completed=record.completedAt&&Number.isFinite(Date.parse(record.completedAt)),requested=record.requestAt&&Number.isFinite(Date.parse(record.requestAt)),engine=record.authority||record.jevCalled===false?'결정':'JEV';return '<time datetime="'+esc(record.asOf)+'">기준 봉 '+esc(when(record.asOf))+'</time><small class="studio-cell-secondary">'+(completed?engine+' 완료 '+esc(when(record.completedAt)):requested?engine+' 요청 '+esc(when(record.requestAt))+' · 완료 시각 미기록':engine+' 실행 시각 미기록')+'</small>';};
const types=[['OBSERVED_FACT','관측 사실'],['HYPOTHESIS','가설'],['VALIDATED_HEURISTIC','검증된 경험칙'],['OPERATING_PROCEDURE','운영 절차']];
const formNames={'mind-policy':'마인드 정책','trade-review':'거래 분석','market-context':'투자 자료','principle-evidence':'원칙 검증 근거','weight-proposal':'가중치 변경 제안'};
const appearanceFieldLabels=[['bodyVariant','형태',[['blob','물방울'],['pear','둥근 배'],['heart','하트'],['frog','개구리'],['cat','고양이'],['rabbit','토끼']]],['colorPalette','색상',[['blue','파랑'],['amber','노랑'],['violet','보라'],['sage','초록']]],['eyeVariant','눈',[['natural','자연스럽게'],['focused','또렷하게'],['sleepy','졸린 눈']]],['accessory','장식',[['none','없음'],['glasses','안경'],['sunglasses','선글라스'],['bowtie','나비넥타이']]],['motionIntensity','움직임',[['subtle','은은하게'],['off','움직임 없음']]]];
const appearanceFields=appearanceFieldLabels.map(([name,label,choices])=>[name,label,MIND_APPEARANCE_OPTIONS[name].map(value=>[value,choices.find(choice=>choice[0]===value)?.[1]||value])]);
const duration=value=>Number.isFinite(value)&&value>=0?num(Math.floor(value/3600000),0)+'시간 '+num(Math.floor(value%3600000/60000),0)+'분 '+num(value%60000/1000,3)+'초':'기간 미기록';
const cohortPolicyLabel=value=>value==='BTC_4H_AUTO_COHORT_V2'?'BTC 4시간봉 · 평가 기준 2':value==='BTC_4H_AUTO_COHORT_V1'?'BTC 4시간봉 · 평가 기준 1':'저장된 평가 기준';
const learningReasons={'common-shock-review-required':'공통 사건의 독립성 검토 필요','legacy-exact-duration-cohort':'기존 고정 기간 평가 자료','cohort-policy-mismatch':'현재 정책·평가 기준과 다름','cohort-source-mismatch':'원본 평가 묶음 확인 필요','cohort-contract-mismatch':'평가 조건 확인 필요','cohort-execution-window':'사전 실행 허용창 확인 필요','not-available':'자료 사용 가능 시각 대기','duplicate-source':'중복된 관측 원본','provenance-incomplete':'원본 참조 확인 필요','cohort-key-mismatch':'선택한 평가 묶음과 다름','different-cohort':'선택한 평가 묶음과 다름','unresolved-attribution':'원칙 기여도 검토 필요'};
export function automaticEvaluationMarkup(doc){
  const e=doc?.evaluation;if(doc?.schemaVersion!==2||!e)return '';
  const entries=list(e.cohorts).filter(c=>doc.kind!=='principle-evidence'||c.tag?.principleId===doc.data?.principleId);
  return '<section class="spaced"><h3>자동 운용 평가 기준</h3>'+row('평가 정책',esc(cohortPolicyLabel(e.policyVersion)))+row('실행 당시 정책',esc(e.manifestId))+'<div class="actions spaced">'+button('실행 원본','decision',e.runId)+'</div>'+table(['실제 평가 기간','실제 길이','비교 적격','독립성 검토'],entries.map(c=>[esc(when(c.tag?.startAt))+' → '+esc(when(c.tag?.endAt)),esc(duration(c.tag?.actualDurationMs)),c.assessment?.cohortEligible===true?'적격':c.assessment?.cohortEligible===false?'제외':'검토 상태 확인',c.tag?.independence?.independentGroupApproved===true?'독립 기회 승인됨':'독립 기회 검토 필요']))+raw({runId:e.runId,runEvidenceHash:e.runEvidenceHash,observationId:e.observationId,observationHash:e.observationHash,manifestId:e.manifestId,manifestHash:e.manifestHash,policyVersion:e.policyVersion,policyHash:e.policyHash,cohorts:e.cohorts},'원본·평가 정책·기회 묶음 참조')+'</section>';
}
export function providerFailureMarkup(failure,{downloadAction='provider-failure-download',downloadIdPrefix=''}={}){
  if(!failure)return '<p class="tiny muted spaced">보관된 공급자 실패 원문 없음</p>';
  const labels={ANSWER_MISSING:'응답 항목 누락',ANSWER_TYPE:'선택 응답 형식 확인',CHOICE_KEY:'허용 선택값 확인',CONFIDENCE_RANGE:'확신도 범위 확인',PROBABILITY_KEYS:'확률 항목 확인',PROBABILITY_RANGE:'확률 범위 확인',PROBABILITY_SUM:'확률 합계 조건 불충족',CHOICE_NOT_MAXIMUM:'선택값과 최대 확률 불일치',RESPONSE_STRUCTURE_UNAVAILABLE:'응답 구조 확인 필요'};
  return '<section class="spaced"><h3>공급자 응답 검증 기록</h3>'+row('실패 기록 시각',esc(when(failure.recordedAt)))+(Number.isInteger(failure.provider?.httpStatus)?row('공급자 응답 코드','HTTP '+failure.provider.httpStatus):'')+(failure.provider?.responseReceivedAt?row('실제 응답 수신',esc(when(failure.provider.responseReceivedAt))):'')+table(['항목','검증 결과','선택값','확률 합계','선택 확률 / 최대 확률'],list(failure.validationDiagnostics).map(d=>[esc(({action:'행동',stance:'운용 강도',buyEvidence:'매수 근거',sellEvidence:'매도 근거',instrument:'종목'})[d.question]||'응답 구조'),esc(list(d.reasons).length?d.reasons.map(v=>labels[v]||'원본 조건 확인').join(' · '):labels[d.code]||'원본 조건 확인'),esc(d.choice||'—'),num(d.sum,10),num(d.chosenProbability,10)+' / '+num(d.maximumProbability,10)]))+['request','response'].map(key=>{const record=failure[key],retention=record?.retention,label=key==='request'?'요청':'응답';return row(label+' 보관',key==='response'&&failure.responseAvailability==='NOT_RECEIVED'?'응답 미수신':key==='response'&&failure.responseAvailability==='NOT_RETAINED'?'응답 본문 미보관':({FULL:'전체 보관',PREFIX:'앞부분 보관',HASH_ONLY:'원본 식별값 보관'})[retention]||'보관 상태 확인')+(record?row(label+' 보관 크기',num(record.retainedByteCount,0)+' / '+num(record.byteCount,0)+'바이트'):'')+'<div class="actions spaced">'+button(label+(retention==='PREFIX'?' 보관 부분 내려받기':' 원문 내려받기'),downloadAction,downloadIdPrefix+key,['FULL','PREFIX'].includes(retention)&&list(record?.jsonChunks).length?'':'disabled')+'</div>';}).join('')+raw({code:failure.code,responseAvailability:failure.responseAvailability,provider:failure.provider,validationDiagnostics:failure.validationDiagnostics,request:failure.request?{...failure.request,jsonChunks:undefined}:null,response:failure.response?{...failure.response,jsonChunks:undefined}:null},'실제 검증 조건·보관 식별값')+'</section>';
}
const strategyModuleName=id=>({BTC_DOC9:'BTC 기준모델 · 명세서 9장',OPPORTUNITY:'기회 집중',MEAN_REVERSION:'평균 회귀',SMA_TREND:'이동평균 추세',MOMENTUM:'모멘텀'})[id]||id;
export function strategyScopeLabel(plan,universe){
  const dynamic=plan?.scope?.instrumentPolicy==='UNIVERSE_CURRENT'||plan?.scope?.universe==='MIND_UNIVERSE',ids=dynamic?list(universe?.instrumentIds):[plan?.scope?.instrumentId].filter(Boolean),identities=ids.map(id=>{try{return getInstrument(id,{resolution:universe?.resolution});}catch{return {id,symbol:id};}}),period=({'1m':'1분봉','3m':'3분봉','5m':'5분봉','1h':'1시간봉','4h':'4시간봉','1d':'일봉'})[plan?.scope?.timeframe]||'정책 주기';
  const names=identities.slice(0,3).map(i=>i.symbol).join(' · ')+(identities.length>3?' 외 '+(identities.length-3)+'개':''),venues=[...new Set(identities.map(i=>i.venue).filter(Boolean))].join(' · '),currencies=[...new Set(identities.map(i=>i.quoteCurrency).filter(Boolean))].join(' · ');
  return [dynamic?(names||'투자 범위의 운용 종목'):names||'정책 종목',venues,period,dynamic&&currencies?currencies+' 모의 계좌':'현물 모의 계좌'].filter(Boolean).join(' · ');
}
const portfolioLabScope=manifest=>manifest?.data?.strategyPlan?.scope?.universe==='MIND_UNIVERSE';
const experimentScope=manifest=>portfolioLabScope(manifest)||isEventAutomationMind(manifest);
export function strategyTriggerLabel(policy={}){
  const graph=policy.strategyPlan?.graph,timeframe=policy.strategyPlan?.scope?.timeframe,period=({'1m':'1분봉','3m':'3분봉','5m':'5분봉','1h':'1시간봉','4h':'4시간봉','1d':'일봉'})[timeframe]||timeframe||'정책 주기';
  if(graph?.triggers?.length)return graph.triggers.map(trigger=>({market_event:'시장 이벤트',closed_bar:'확정 봉',manual:'직접 실행'})[trigger]||trigger).join(' · ')+' · '+period;
  return (policy.trigger?.event==='closed-candle'?'확정 봉':'직접 실행')+' · '+(({'1m':'1분','3m':'3분','5m':'5분','4h':'4시간','1d':'1일'})[policy.trigger?.interval]||'정책 참조');
}

function automaticScopeIssue(manifest){
  if(!manifest)return null;
  if(isEventAutomationMind(manifest))return null;
  try{subscriptionInstrumentIds(manifest);}catch(error){return error.message;}
  const fixed=subscriptionInstrumentIds(null)[0];
  if(!list(manifest.data?.universe?.instrumentIds).includes(fixed))return '자동 운용의 기준 종목 '+getInstrument(fixed).symbol+'를 투자 범위에 포함하세요.';
  return null;
}
export function activityPolicyDraftSource(documents,{mindId,manifestId,manifestHash,graphHash}){
  const manifest=list(documents).map(value=>value?.document??value).find(value=>value?.id===manifestId&&value.kind==='mind-policy'&&value.scope?.profileId===mindId);
  if(!manifest||!manifest.data?.strategyPlan||mindDocumentHash(manifest)!==manifestHash||strategyGraphHash(strategyPlanGraph(manifest.data.strategyPlan))!==graphHash)throw new Error('당시 정책 원본을 확인할 수 없습니다. 기록의 정책 버전을 다시 조회하세요.');
  assertMindDocument(manifest);return structuredClone(manifest);
}

export function strategyPlanMarkup(plan,universe,{collapseInventory=false}={}){
  if(!plan)return '';
  const graph=strategyPlanGraph(plan),modules=strategyPlanModules(plan),nodeLabel=id=>{const node=graph.nodes.find(n=>n.id===id);return node?.type==='SIGNAL'?(node.label&&node.label!=='가격 신호'&&node.label!==node.config.moduleId?node.label:strategyModuleName(node.config.moduleId)):node?.type==='INPUT'?strategyInputNodeLabel(node):node?.label||id;};
  const inventory=table(['전략','매개변수','입력 전달'],modules.map(m=>[esc(m.nodeId?nodeLabel(m.nodeId):strategyModuleName(m.moduleId)),raw(m.parameters,'설정 보기'),m.required?'필수':'선택']))+'<div class="studio-sheet-body">'+table(['출력','입력'],graph.edges.map(e=>[esc(nodeLabel(e.from.nodeId)),esc(nodeLabel(e.to.nodeId))]))+raw({id:plan.planId,version:plan.planVersionId,graph},'전략 원본')+'</div>';
  return '<section class="studio-sheet spaced"><div class="studio-sheet-head"><h2>'+helpLabel('전략 구성',graph.schemaVersion===2?'연결한 입력과 결정·결합 규칙을 실행하고, 위험 한도에 따라 모의 주문을 계산합니다.':'각 전략의 계산 결과를 연결된 노드에서 처리해 JEV에 전달합니다. JEV가 매수·매도·유지를 선택합니다.')+'</h2></div><div class="studio-sheet-body">'+row('승인 상태',plan.status==='APPROVED'?'승인됨':'검토 대기')+row('사용 설정',plan.approval?.enabled?'사용함':'사용 안 함')+row('적용 범위',esc(strategyScopeLabel(plan,universe)))+'</div>'+(collapseInventory?'<details class="studio-sheet-body" data-policy-graph-inventory><summary>부품 '+graph.nodes.length+'개 · 연결 '+graph.edges.length+'개</summary>'+inventory+'</details>':inventory)+'</section>';
}
export function strategyEvaluationMarkup(evaluation,savedGraph=null){
  if(!evaluation)return '';
  const score=value=>Number.isFinite(value)?num(value,3):value&&typeof value==='object'?Object.entries(value).filter(([,v])=>Number.isFinite(v)).map(([k,v])=>esc(({coverage:'자료 충족도',price:'가격 점수'})[k]||k)+' '+num(v,3)).join(' · ')||'—':'—';
  const types=STRATEGY_TRACE_TYPES;
  const graph=evaluation.graphEvaluation,name=id=>strategyTraceNodeLabel(savedGraph,id,graph?.trace);
  const result=node=>{const out=node.output||{},decision=out.decision;
    if(decision){
      const action=esc(({buy:'매수',sell:'매도',hold:'유지'})[decision.action]);
      if(node.type==='RISK')return (out.riskAllowed?'위험 한도 통과':'위험 한도 차단')+' · 위험검사 후 허용 목표 '+pct(decision.targetWeight);
      if(node.type==='ORDER')return (node.noOrderReason==='TARGET_ALREADY_REACHED'?'목표 도달 · 추가 주문 없음':out.riskAllowed===false?'위험 한도 차단':out.orderAllowed?action+' 주문 의도':'추가 주문 없음')+'<small>현재 '+pct(out.currentWeight)+' → 허용 목표 '+pct(decision.targetWeight)+' · 이번 주문 변경분 '+(out.deltaWeight>0?'+':'')+num(out.deltaWeight*100,2)+'%p</small>'+helpLabel('목표 비중 추종',TARGET_WEIGHT_FOLLOWING_HELP);
      return action+' · 전략 목표 '+pct(decision.targetWeight);
    }
    if(node.type==='JEV')return '근거 '+list(out.evidence).length+'개';
    if(!out.ready)return out.status==='PREPARED'?'JEV 결정 대기':'입력 확인 필요';
    if(node.type==='CONDITION')return (out.value?'충족':'미충족')+' · '+num(out.actual,3)+' / '+num(out.threshold,3);
    const typedValue=strategyTraceValue(node,savedGraph);if(typedValue!==null)return esc(typedValue);
    if(node.type==='INPUT')return '입력 준비됨';return node.type==='SIGNAL'&&Number.isFinite(out.score)?'가격 신호 점수 '+(out.score>0?'+':'')+score(out.score):score(out.score);
  };
  return '<section class="spaced"><h3>전략 실행</h3>'+(graph?.contractVersion==='mind-strategy-decision-evaluation-v2'?row('실행 구조','결정 그래프 v2'):row('전략 버전',esc(evaluation.planVersionId)))+row('자료 기준',esc(when(evaluation.asOf)))+row('사용 자료','4시간봉 '+num(evaluation.source?.usedFourHourCount,0)+'개 · 일봉 '+num(evaluation.source?.usedDailyCount,0)+'개')+(graph?.contractVersion==='mind-strategy-decision-evaluation-v2'?'':table(['계산 전략','상태','방향 점수'],list(evaluation.modules).map(m=>[esc(strategyModuleName(m.moduleId)),m.ready?'준비됨':'자료 확인 필요',score(m.mechanicalScore)])))+(graph?'<h4 class="spaced">실행 경로</h4>'+table(['노드','작업','출력'],list(graph.trace).map(n=>[esc(name(n.nodeId)),esc(types[n.type]||'실행 부품'),result(n)+(n.selectedNodeId?'<small>선택 '+esc(strategyTraceSelection(n,savedGraph,graph.trace))+'</small>':'')+(n.effectiveWeights?'<small>판단 투표 비중 '+n.effectiveWeights.map(w=>esc(name(w.nodeId))+' '+pct(w.value)).join(' · ')+'</small>':'')+(n.actionWeights?'<small>행동별 투표 비중 '+Object.entries(n.actionWeights).map(([action,value])=>esc(({buy:'매수',hold:'유지',sell:'매도'})[action]||action)+' '+pct(value)).join(' · ')+'</small>':'')]))+(list(graph.skippedNodeIds).length?row('건너뛴 노드',esc(graph.skippedNodeIds.map(name).join(', '))):''):'')+raw({planId:evaluation.planId,planVersionId:evaluation.planVersionId,outputHash:evaluation.outputHash,planHash:evaluation.planHash,computedAt:evaluation.computedAt,source:evaluation.source,modules:evaluation.modules,graphEvaluation:graph},'계산·입력 원본')+'</section>';
}

const executionLabel=value=>({HOLD_SELECTED:'보유량 유지',TRADE_PROPOSED:'주문 검토 대기',NO_ORDER_REQUIRED:'추가 주문 없음',WAITING_EXECUTION_DATA:'실행 시세 대기',AUTO_EXECUTION_DECLINED:'모의 체결 확인 필요',ORDER_REJECTED:'주문 제한',PAPER_REVIEW_READY:'모의 주문 검토 대기',RISK_BLOCKED:'위험·비용 조건 제한',OBSERVATION_ONLY:'결정 저장 · 계좌 연결 필요',EXECUTED:'모의 체결 완료',FILLED:'모의 체결 완료'})[value]||'실행 기록 확인';
export const WORKSPACE_NAV=Object.freeze([['home','home','홈'],['trade','chart','마켓'],['minds','layers','마인드'],['calendar','calendar','캘린더'],['library','book','자료'],['settings','settings','설정']]);
export const MIND_VIEWS=Object.freeze([['overview','운용'],['operations','운용'],['simulations','실험실'],['principles','전략'],['records','기록'],['knowledge','연결 자료']]);
export const LIBRARY_VIEWS=Object.freeze([['documents','투자 자료'],['quant','전략 라이브러리'],['experiences','투자 경험'],['review','검토함'],['memory','학습 자료'],['forms','가져오기 양식']]);
export const SETTINGS_VIEWS=Object.freeze([['accounts','계좌·자금'],['connections','서비스 연결'],['automation','자동 운용'],['data','데이터'],['capabilities','기능 목록']]);
const SHARED_WORKSPACE_WRITES=new Set(['profile.create','profile.revise','profile.appearance.set','profile.archive','profile.restore','experience.observe.market','experience.evaluate','memory.propose','memory.validate','memory.approve','memory.reject']);
const SHARED_STUDIO_ACTIONS=new Set(['home-recommendation-details','live-activity-refresh','live-record-search-clear','knowledge-filters-clear','document-note','mind-execution','strategy-parameter','connections','accounts-settings','refresh','companion-refresh','close-dialog','profile-open','profile-knowledge','mind-automation','mind-lab','mind-trade','mind-status','profile-archive','profile-restore','profile-edit','profile-new','mind-customize','mind-view','mind-knowledge-view','knowledge-page','knowledge-policy','knowledge-pin','knowledge','mind-library-refresh','mind-library-first','mind-library-next','mind-library-prev','memory-refresh','open-library','strategy-plan','strategy-graph','activity-strategy-draft','document-graph-edit','export','document-export','download-document','edit-export','document-new','document-editor-retry','document-detail','document-template','document-edit-copy','document-publish','document-publish-live','validate-document','document-apply','document-classify','weight-propose','weight-approve','universe-edit','universe-collect','universe-clear','universe-remove','universe-skip','universe-page','mind-instrument','selected-instrument','sector-import','sector-collect','stocks-collect','upbit-collect','instrument-catalog','sector-status','capture-status','capture-collect','capability-search-clear','export-workspace','decision','mind-observation','experience','candidate','experience-observe','experience-evaluate','memory-propose','memory-validate','memory-approve','memory-reject','review-from-run','evidence-from-run','news-list','news-detail','news-create','news-run','news-result','news-export','news-result-export']);
const SHARED_STUDIO_FORMS=new Set(['document-note','profile','profile-lifecycle','manifest-profile','mind-avatar','document','document-target','document-publish','strategy-plan','knowledge-policy','knowledge-pin','universe-policy','sector-import','weight-propose','weight-approve','experience-evaluate','memory-propose','memory-validate','memory-approve','memory-reject','news-create']);
function sharedWorkspaceWrite(type,path){
  if(path==='/api/workspace/actions')return SHARED_WORKSPACE_WRITES.has(type);
  if(['/api/workspace/home-market/refresh','/api/workspace/home-market/recommend','/api/workspace/market-captures/collect','/api/workspace/minds/weights/propose','/api/workspace/minds/weights/approve','/api/workspace/news-comparisons/create','/api/workspace/news-comparisons/run'].includes(path))return true;
  return ['/api/workspace/mind-documents','/api/workspace/market-knowledge','/api/workspace/quant-strategies','/api/workspace/strategy-library','/api/workspace/universe'].some(base=>path===base||path.startsWith(base+'/'));
}
const ALIASES={desk:'trade',paper:'trade',portfolio:'trade',replay:'trade',studio:'minds',profiles:'minds','replay-settings':'minds',knowledge:'library',wiki:'library','research-sources':'library','browser-notes':'library',records:'minds',trades:'minds',journal:'minds',lab:'minds'};
const OLD_RECORDS=new Set(['records','trades','journal','lab']);

export function mindDocumentReviewView(saved){
  const document=saved.document||saved,classification=document.provenance?.classification,knowledgeType=classification?.choices?.knowledgeType,approved=saved.status==='APPROVED',review=saved.review,reviewedAt=review?.reviewedAt||review?.approvedAt||null;
  const reviewed=approved&&!!reviewedAt;
  return {status:({DRAFT:'검토 대기',APPROVED:'승인됨',REJECTED:'반려'})[saved.status]||'검토 상태 확인',classification:types.find(type=>type[0]===knowledgeType)?.[1]||(classification?'분류 기록 확인':'분류 대기'),sourceValidation:reviewed?'사용자 검토 완료':saved.sourceValidation==='SAVED_RECORD_VERIFIED'?'저장된 원본 확인':saved.sourceValidation==='EXTERNAL_SOURCE_REVIEW_REQUIRED'?'원문 출처 검토 대기':saved.sourceValidation==='POLICY_REVIEW_REQUIRED'?'정책 검토 대기':'원본 검토 대기',approvedAt:approved?reviewedAt:null,reason:review?.reason||null};
}

export function selectionResultMarkup(selection,{profileName='마인드 정보 확인 필요'}={}){
  const state=selection.rawRequest?.state||{},answer=selection.rawResponse?.answers?.instrument||{},candidates=list(state.candidates),probabilities=selection.probabilities||answer.probabilities||{},choice=selection.selectedChoice||answer.choice,confidence=selection.confidence??answer.confidence;
  const catalog=listInstruments(),instrument=id=>candidates.find(c=>c.instrumentId===id)?.market?.instrument||catalog.find(i=>i.id===id),label=id=>{const value=instrument(id);return value?[value.symbol,value.name].filter(Boolean).join(' · '):'종목 정보 확인 필요';};
  const selected=selection.selectedInstrumentId,status=selected?'종목 선정 완료':'선택 보류',lowConfidence=!selected&&choice!=='none'&&Number.isFinite(confidence)&&confidence<.6;
  const reason=selected?'':lowConfidence?'선택 확신도 '+pct(confidence)+'가 최소 60.00%보다 낮아 종목 선정을 보류했습니다.':choice==='none'?'JEV가 이번 후보에서 선택 보류를 선택했습니다.':'선정 조건을 충족한 종목이 없습니다.';
  const exclusion=entry=>({DUPLICATE:'중복 종목',OUTSIDE_UNIVERSE:'허용 종목 범위 밖',STALE_MARKET:'최근 확정 시세 지연',SOURCE_BACKED_QUOTE_VOLUME_REQUIRED:'출처가 연결된 거래대금 필요',MARKET_COHORT_MISMATCH:'거래 구분·통화·봉 주기가 다름',SELECTION_ASOF_MISMATCH:'비교 시세의 기준 시각이 다름',MIND_MARKET_REQUIRED:'확정 시세·자료 출처 연결 필요',MIND_MARKET_HASH:'확정 시세와 보존 원본 불일치',MIND_MARKET_TIME:'확정 시세 기준 시각 검토 필요',MIND_CANDLE_INVALID:'확정 봉 자료 검토 필요'})[entry.reason]||(entry.reason==='HISTORY_REQUIRED'?'확정 봉 '+num(entry.available,0)+'개 / 최소 '+num(entry.required,0)+'개':entry.message||'선정 자료 조건 확인 필요');
  const rows=candidates.map((candidate,index)=>{const market=candidate.market||{},price=market.features?.lastClose??market.quote?.price;return [esc(label(candidate.instrumentId)),pct(probabilities['i'+index]),esc(({'1h':'1시간봉','4h':'4시간봉','1d':'일봉'})[market.timeframe]||'주기 미수집'),num(price)+' '+esc(market.instrument?.quoteCurrency||market.quote?.currency||''),esc(when(market.asOf)),esc(selected===candidate.instrumentId?'선정됨':!selected&&choice==='i'+index&&lowConfidence?'확신도 미달':'비교 후보')];});
  if(Object.hasOwn(probabilities,'none'))rows.push(['선택 보류',pct(probabilities.none),'—','—','—',choice==='none'?'JEV 선택':'비교 대안']);
  return '<section class="studio-selection-result"><h3>'+esc(selected?label(selected):status)+'</h3>'+row('선정 결과',esc(status))+row('마인드',esc(profileName))+row('선택 확률',pct(probabilities[choice]))+row('선택 확신도',pct(confidence))+row('모델',esc(selection.rawResponse?.model||selection.provider?.model||'기록 없음'))+row('비교 시세 기준',esc(when(state.selectionAsOf)))+row('실행 시각',esc(when(selection.createdAt||selection.asOf)))+(reason?'<p class="tiny spaced" role="status">'+esc(reason)+'</p>':'')+'<h3 class="spaced">비교 후보</h3>'+table(['종목','선택 확률','확정 봉','기준 종가','시세 기준','결과'],rows,'저장된 후보 시세가 없습니다.')+'<h3 class="spaced">제외 종목</h3>'+table(['종목','제외 사유'],list(selection.excluded||state.excluded).map(entry=>[esc(label(entry.instrumentId)),esc(exclusion(entry))]),'제외 기록이 없습니다.')+'</section>'+raw(selection,'종목 선정 원본');
}

export function parseStudioRoute(hash=''){
  const [raw,...search]=String(hash).replace(/^#/,'').split('?'),candidate=ALIASES[raw]||raw||'home',page=WORKSPACE_NAV.some(n=>n[0]===candidate)?candidate:'trade',params=new URLSearchParams(search.join('?'));
  if(params.has('executionMode')&&!['paper','live'].includes(params.get('executionMode')))params.set('executionMode','paper');
  if(page!=='trade'||params.get('executionMode')==='live'||params.get('firstDecision')!=='1')params.delete('firstDecision');
  if(params.has('mind')&&!params.has('profileId'))params.set('profileId',params.get('mind'));
  if(params.has('comparison')&&!params.has('comparisonId'))params.set('comparisonId',params.get('comparison'));
  if(page==='trade'&&['decisions','trades','experiences','knowledge'].includes(params.get('view')))params.set('tab',params.get('view')==='trades'?'positions':params.get('view')==='experiences'?'knowledge':params.get('view'));
  for(const name of ['mind','comparison','bot'])params.delete(name);
  if(OLD_RECORDS.has(raw)){params.set('view','records');if(!params.has('profileId'))params.set('profileId','all');}
  if(page==='minds'&&params.get('view')!=='motions'&&!MIND_VIEWS.some(v=>v[0]===params.get('view')))params.set('view','overview');
  if(page==='library'&&!LIBRARY_VIEWS.some(v=>v[0]===params.get('view')))params.set('view','documents');
  if(page!=='library'||params.get('view')!=='documents'||params.has('versions')&&!['latest','all'].includes(params.get('versions')))params.delete('versions');
  if(page!=='library'||params.get('view')!=='documents')params.delete('knowledgeId');
  if(page==='settings'&&!SETTINGS_VIEWS.some(v=>v[0]===params.get('view')))params.set('view','connections');
  if(page!=='settings'||params.get('view')!=='accounts'||params.get('executionMode')!=='live'||!['upbit','toss'].includes(params.get('brokerSetup')))params.delete('brokerSetup');
  if(page==='trade')params.delete('view');
  if(page==='calendar')for(const name of [...params.keys()])if(!['executionMode','month','date'].includes(name))params.delete(name);
  if(page==='home'){
    for(const name of [...params.keys()])if(!['executionMode','showcase','currency','portfolio'].includes(name))params.delete(name);
    if(params.get('portfolio')!=='review'||params.get('executionMode')!=='live')params.delete('portfolio');
    if(params.has('showcase')&&!['performance','experiments'].includes(params.get('showcase')))params.delete('showcase');
  }
  const records=page==='minds'&&params.get('view')==='records';
  const simulations=page==='minds'&&params.get('view')==='simulations';
  if(!simulations||params.get('practice')!=='quant'||params.get('setup')!=='new')params.delete('practiceMind');
  if(simulations&&!SIMULATION_TABS.some(t=>t[0]===params.get('tab')))params.set('tab','overview');
  if(page==='minds'&&!simulations)params.delete('tab');
  if(!simulations)for(const name of ['simulationId','lab','a','b','draftId','comparisonA','comparisonB','archived','learningId','previousLearningId','learningView','learningStep','labView','labStep','setup','setupStep','practice','expQuery','expKind','expStatus','expArchived','expCursor'])params.delete(name);
  if(!records&&!simulations&&page!=='library')for(const name of ['cursor','pageSize','status','search'])params.delete(name);
  return {page,params};
}

export const isRecordsRoute=route=>route.page==='minds'&&route.params.get('view')==='records';
const savedRouteFor=(current,page)=>{let hash=current.params.get('returnTo');for(let depth=0;hash?.startsWith('#')&&depth<4;depth++){const saved=parseStudioRoute(hash);if(saved.page===page)return saved;hash=saved.params.get('returnTo');}return null;};

export function studioRouteHash(current,page,changes={}){
  const target=parseStudioRoute('#'+page),returnRoute=current.page!==target.page?savedRouteFor(current,target.page):null,params=current.page===target.page?new URLSearchParams(current.params):returnRoute?new URLSearchParams(returnRoute.params):new URLSearchParams();
  if(current.page==='home'&&target.page!=='home')params.set('returnTo','#home'+(current.params.size?'?'+current.params:''));
  if(current.page==='trade'&&target.page==='minds')params.set('returnTo','#trade'+(current.params.size?'?'+current.params:''));
  if(current.page==='minds'&&target.page==='library')params.set('returnTo','#minds'+(current.params.size?'?'+current.params:''));
  if(current.page!==target.page&&['trade','minds'].includes(target.page)&&current.params.has('profileId'))params.set('profileId',current.params.get('profileId'));
  if(current.params.has('executionMode'))params.set('executionMode',executionModeOf(current));
  if(OLD_RECORDS.has(String(page).split('?')[0]))params.set('view','records');
  const pageQuery=String(page).includes('?')?target.params:null;
  if(current.page===target.page&&target.page==='minds'){
    const nextView=Object.hasOwn(changes,'view')?changes.view:pageQuery?.get('view')??params.get('view');
    if(nextView!==current.params.get('view'))for(const key of ['search','status','kind','instrumentId','pageSize','cursor'])params.delete(key);
    // A page cursor belongs to its original mind, operating mode and saved experiment.
    for(const key of ['profileId','executionMode','simulationId']){
      const next=Object.hasOwn(changes,key)?changes[key]:pageQuery?.get(key)??current.params.get(key);
      const previous=key==='executionMode'?executionModeOf(current):current.params.get(key)||(key==='profileId'?'all':'');
      const value=key==='executionMode'?(next==='live'?'live':'paper'):String(next??'')||(key==='profileId'?'all':'');
      if(value!==previous){params.delete('cursor');if(key==='profileId')params.delete('expCursor');break;}
    }
  }
  if(pageQuery)for(const [key,value]of pageQuery)params.set(key,value);
  for(const [key,value]of Object.entries(changes)){if(value===null||value==='')params.delete(key);else params.set(key,String(value));}
  const route=parseStudioRoute('#'+target.page+(params.size?'?'+params:''));
  return '#'+route.page+(route.params.size?'?'+route.params:'');
}

/** Workspace IDs are authoritative when a profile mutation precedes the catalog read. */
export function workspaceMindCatalog(workspace,catalog){
  const saved=new Map(list(catalog?.minds).map(mind=>[mind.id,mind]));
  return list(workspace?.investmentProfiles).map(profile=>({...saved.get(profile.id),id:profile.id,name:profile.displayName??profile.name}));
}

export const isPlainNavigationClick=event=>!event.defaultPrevented&&(event.button===undefined||event.button===0)&&!event.metaKey&&!event.ctrlKey&&!event.shiftKey&&!event.altKey;

export function studioPrimaryRouteHash(current,page,savedHash){
  const saved=savedHash?parseStudioRoute(savedHash):current;
  const sharedMind=['trade','minds'].includes(current.page)&&['trade','minds'].includes(page);
  const profileId=current.params.get('profileId')||'all';
  const changedMind=sharedMind&&profileId!==(saved.params.get('profileId')||'all');
  return studioRouteHash(saved,page,{executionMode:executionModeOf(current),...(sharedMind?{profileId}:{}),...(changedMind?{cursor:null,simulationId:null,knowledgePage:null}: {})});
}

export function editMindPolicyDraft(manifest,values,{now=new Date().toISOString(),id='draft-'+crypto.randomUUID()}={}){
  const next=structuredClone(manifest);next.id=id;next.title=values.name;next.asOf=now;next.availableAt=now;next.source={type:'user',id:'workspace-owner',uri:null};
  next.provenance={...next.provenance,createdAt:now,authorId:'workspace-owner',recordRefs:[...new Set([...list(next.provenance.recordRefs),manifest.id])],classification:null};
  next.data={...next.data,name:values.name,version:next.data.version+1,profileSettings:{...next.data.profileSettings,philosophy:values.philosophy,discipline:values.discipline,horizon:values.horizon}};
  for(const principle of next.data.principles){const value=principle.id.endsWith(':philosophy')?values.philosophy:principle.id.endsWith(':discipline')?values.discipline:null;if(value!==null&&principle.text!==value){principle.text=value;principle.version++;}}
  if(Object.hasOwn(values,'evidencePreferences')){
    const preferences=[...new Set(String(values.evidencePreferences).split(',').map(value=>value.trim()).filter(Boolean))];
    if(preferences.some(value=>value.length>240))throw new Error('주요 근거는 항목마다 240자 이내로 입력하세요.');
    const previous=new Set(manifest.data.profileSettings.evidencePreferences),retained=next.data.principles.filter(principle=>principle.kind!=='evidence'||!previous.has(principle.title));
    const evidence=preferences.map(title=>{
      const existing=next.data.principles.find(principle=>principle.kind==='evidence'&&principle.title===title);
      return existing??{id:next.scope.profileId+':evidence:'+crypto.randomUUID(),version:1,title,text:'검토할 근거: '+title,kind:'evidence',weight:.5,bounds:{min:.1,max:.9}};
    });
    next.data.profileSettings.evidencePreferences=preferences;
    next.data.principles=[...retained,...evidence.filter(principle=>!retained.some(item=>item.id===principle.id))];
    next.principleRefs=next.data.principles.map(principle=>principle.id);
    assertMindDocument(next);
  }
  return next;
}

/** A saved policy branches with its complete content and explicit source lineage. */
export function copyMindDocumentDraft(original,{documents=[],mindId=original?.scope?.profileId,simulationId=null,now=new Date().toISOString(),id='draft-'+crypto.randomUUID()}={}){
  assertMindDocument(original);
  if(original.scope.profileId!==mindId)throw new Error('실험과 정책의 마인드가 일치하는지 확인하세요.');
  if(simulationId!==null&&(original.kind!=='mind-policy'||typeof simulationId!=='string'||!simulationId.trim()))throw new Error('실험 원본과 마인드 정책을 확인하세요.');
  const next=structuredClone(original),catalog=[original,...documents.map(entry=>entry.document||entry.manifest||entry)].filter(doc=>doc?.kind==='mind-policy'),policies=catalog.filter(doc=>doc.scope?.profileId===mindId);
  const increment=(values,label)=>{const maximum=Math.max(0,...values);if(!Number.isSafeInteger(maximum)||maximum>=Math.min(Number.MAX_SAFE_INTEGER,1e15-1))throw new Error(label+' 버전의 증가 범위를 확인하세요.');return maximum+1;};
  next.id=id;next.availableAt=[original.availableAt,now].sort().at(-1);next.source={...next.source,type:'user',id:'workspace-owner'};
  next.provenance={...next.provenance,createdAt:now,authorId:'workspace-owner',recordRefs:[...new Set([...original.provenance.recordRefs,original.id,...(simulationId?[simulationId]:[])])],contentHashes:[...new Set([...original.provenance.contentHashes,mindDocumentHash(original)])],classification:null};
  if(next.kind==='mind-policy'){
    next.data.version=increment(policies.map(doc=>doc.data.version),'정책');
    const content=principle=>JSON.stringify({title:principle.title,text:principle.text,kind:principle.kind,bounds:principle.bounds});
    for(const principle of next.data.principles){const versions=policies.flatMap(doc=>doc.data.principles).filter(value=>value.id===principle.id);if(versions.some(value=>value.version>=principle.version&&content(value)!==content(principle)))principle.version=increment(versions.map(value=>value.version),'원칙');}
    if(next.data.strategyPlan){const plan=next.data.strategyPlan,versions=catalog.map(doc=>doc.data.strategyPlan).filter(value=>value?.planId===plan.planId).map(value=>/^v([1-9]\d*)$/.exec(value.planVersionId)).filter(Boolean).map(value=>Number(value[1]));next.data.strategyPlan=draftMindStrategyPlan({...plan,planVersionId:'v'+increment(versions,'전략')});}
  }
  assertMindDocument(next);return next;
}

/** Resume only drafts descended from the current published policy. Live always opens its pinned policy. */
export function latestStrategyDraft(manifest,entries=[]){
 return entries.filter(e=>e.status==='DRAFT').map(e=>e.document??e).filter(d=>d.kind==='mind-policy'&&d.scope?.profileId===manifest.scope.profileId&&d.data.version>manifest.data.version&&d.data.strategyPlan?.graph&&d.provenance?.recordRefs?.includes(manifest.id)).sort((a,b)=>b.data.version-a.data.version||b.availableAt.localeCompare(a.availableAt))[0]??null;
}

/** Discovery metadata enriches explicit sidebar entries without becoming an investment universe. */
export function terminalDisplayInstruments(rows,{metadata=new Map(),watchedIds=[],selectedInstrument=null}={}){
  const entries=new Map(rows.map(item=>[item.id,{...metadata.get(item.id),...item}]));
  for(const id of watchedIds)if(!entries.has(id)){try{entries.set(id,{...getInstrument(id),...metadata.get(id)});}catch{}}
  if(selectedInstrument?.id&&!entries.has(selectedInstrument.id))entries.set(selectedInstrument.id,{...metadata.get(selectedInstrument.id),...selectedInstrument});
  return [...entries.values()];
}
/** Server reads are isolated so a late asset response cannot repaint a new route. */
export function createStudioController(hooks={},options={}){
  const fetchImpl=options.fetchImpl||((...args)=>fetch(...args));
  const terminalNow=options.nowMs||Date.now,terminalCacheTtlMs=30000;
  const endpoints={terminal:'/api/workspace/terminal',minds:'/api/workspace/minds',mindForms:'/api/workspace/mind-forms',mindExport:'/api/workspace/minds/export',mindImport:'/api/workspace/mind-documents',mindClassify:'/api/workspace/mind-documents/classify',mindApply:'/api/workspace/mind-documents/publish',terminalEvaluate:'/api/workspace/terminal/evaluate',...options.endpoints};
  let workspace=null,marketInfo=null,status=null,mindData=null,error='',loading=true,busy=false,formSaving=false,root=null,started=false,terminalData=null,terminalLoading=false,terminalError='',terminalFailure=null,terminalGeneration=0,terminalAbort=null,route=parseStudioRoute(''),poll=null,lastTerminalKey='',forms=[],formsProfileId='',formEditor=null,search='',recordPage=0,requestKeys=new Map(),recordsData=null,recordsLoading=false,recordsError='',recordsGeneration=0,recordsAbort=null,lastRecordsKey='',searchTimer=null,recordFieldFocus=null,searchDraft=null;
  let connectionLoading=false,connectionError='',connectionMessage='';
  const connectionOpenGroups={};
  const connectionDetails=(id,label,body)=>'<details class="spaced" data-connection-group="'+id+'"'+(connectionOpenGroups[id]?' open':'')+'><summary>'+label+'</summary>'+body+'</details>';
  let capabilityData=null,capabilityLoading=false,capabilityError='',capabilityQuery='',capabilityFocus=null;
  const capabilityOpenGroups={},companionHistoryOpenGroups={},mindDisclosureOpenGroups={};
  function mindDisclosure(id,label,body,extra=''){const r=currentRoute(),key=JSON.stringify([r.page,r.params.get('profileId'),r.params.get('view'),executionModeOf(r),id]);return '<details class="mind-operation-depth" data-mind-disclosure="'+esc(key)+'"'+(mindDisclosureOpenGroups[key]?' open':'')+extra+'><summary>'+esc(label)+'</summary>'+body+'</details>';}
  function capabilityToggle(event){const group=event.target;if(group.matches?.('details[data-mind-disclosure]')&&group.isConnected&&root?.contains?.(group))mindDisclosureOpenGroups[group.dataset.mindDisclosure]=group.open;if(group.matches?.('details[data-mind-history]')&&group.isConnected&&root?.contains?.(group))companionHistoryOpenGroups[group.dataset.mindHistory]=group.open;if(group.matches?.('details[data-capability-group-id]')&&group.isConnected&&root?.contains?.(group)&&!capabilityQuery.trim())capabilityOpenGroups[group.dataset.capabilityGroupId]=group.open;if(group.matches?.('details[data-connection-group]'))connectionOpenGroups[group.dataset.connectionGroup]=group.open;}
  function updateCapabilitySearch(field){const catalog=field.closest('[data-capability-catalog]');if(!capabilityQuery.trim())for(const group of catalog.querySelectorAll('[data-capability-group]'))capabilityOpenGroups[group.dataset.capabilityGroupId]=group.open;capabilityQuery=field.value;filterCapabilityCatalog(catalog,capabilityQuery,capabilityOpenGroups);}
  async function loadCapabilities({force=false}={}){if(currentRoute().page!=='settings'||currentRoute().params.get('view')!=='capabilities'||capabilityLoading||capabilityData&&!force)return;capabilityLoading=true;capabilityError='';redraw();try{capabilityData=(await request('/api/capabilities')).manifest;}catch(problem){capabilityError=problem.message;}finally{capabilityLoading=false;redraw();}}
  let captureData=null,captureLoading=false,captureCollecting=false,captureStatusError='',captureActionError='',captureMessage='',captureGeneration=0;
  let automationIntent=null,automationFocus=null;
  let sectorCatalog=null,sectorCatalogLoading=false,sectorCatalogError='',sectorCollecting=false,sectorCollectionKind='',sectorCollectionError='',sectorCollectionMessage='';
  let terminalReadAt=0,terminalReadRevision=null,terminalRequestRevision=null;
  let coreReadGeneration=0,disposed=false;
  let subscriptionData=null,subscriptionMindId='',subscriptionLoading=false,subscriptionError='',subscriptionGeneration=0,subscriptionAbort=null,subscriptionCommand=null,subscriptionActionError=null;
  const paperAdaptations=new Map();
  let recoveryData=null,recoveryGeneration=0,recoveryPending=false,recoveryMindId='',recoveryViewGeneration=0,executionModeFocus=null,mindActionFocus=null,restoringMindActionFocus=false;
  let valuationData=null,valuationKey='',valuationLoading=false,valuationError='',valuationGeneration=0,valuationAbort=null;
  let companionValuations=[],companionValuationLoading=false,companionValuationError='',companionValuationReadAt=0,companionValuationRevision=null,companionValuationGeneration=0,companionValuationAbort=null,companionValuationPoll=null;
  let universeImportReturn=null,catalogPickerCleanup=null;
  const documentImports=new WeakMap();
  let activityPreviews=null,liveAutomationIntent=null,executionViewer=null;
  const liveActivity=createMindActivityResource({request,onChange:()=>{syncExecutionViewer();redraw();queueMicrotask(()=>{if(disposed)return;const item=liveActivity.get(currentRoute().params.get('profileId')),saved=automatedTrading.state().data?.policies?.find(policy=>policy.id===item?.activationId);automatedTrading.load({force:Boolean(item&&(!saved||saved.status!==item.status||saved.pendingStrategyUpdate||item.manifest?.graphHash&&saved.config?.graphHash!==item.manifest.graphHash))}).catch(()=>{});if(currentRoute().page==='home'&&executionModeOf(currentRoute())==='live'&&liveActivity.state().data&&!home.state().loading)home.load({force:true}).catch(()=>{});});}});
  const liveActivityView=()=>executionModeOf(currentRoute())==='live'&&(['home','minds','trade'].includes(currentRoute().page)||currentRoute().page==='settings'&&['automation','connections'].includes(currentRoute().params.get('view')));
  const loadLiveActivity=options=>liveActivityView()?liveActivity.load(options):Promise.resolve();
  const eventPaperBatch=createEventPaperResource({request,onChange:()=>{if(eventPaperBatchView())redraw();}});
  const eventPaperBatchView=()=>executionModeOf(currentRoute())==='paper'&&(currentRoute().page==='home'||currentRoute().page==='minds'&&currentRoute().params.get('view')!=='simulations'||currentRoute().page==='settings'&&['accounts','automation'].includes(currentRoute().params.get('view')));
  const loadEventPaperBatch=options=>eventPaperBatchView()?eventPaperBatch.load(options):Promise.resolve();
  const paperActivity=createPaperActivityResource({request,onChange:()=>redraw(),getWorkspace:()=>workspace,getProfileId:()=>currentRoute().params.get('profileId')||'all',getExecutionMode:()=>executionModeOf(currentRoute())});
  const loadPaperActivity=async()=>{if(currentRoute().page!=='minds'||executionModeOf(currentRoute())!=='paper')return;const selected=currentRoute().params.get('profileId')||'all';if(selected!=='all')return paperActivity.load();const ids=[...new Set(list(workspace?.mindRuns).filter(run=>run.experimentType==='FORWARD_PAPER').map(run=>run.profileId))];for(const profileId of ids){if(disposed||currentRoute().page!=='minds'||executionModeOf(currentRoute())!=='paper')break;await paperActivity.load({profileId});}};
  const automatedTrading=createAutomatedTrading({getAppearance:id=>readMindAppearance(workspace,id).config,request,redraw:()=>redraw(),open:(...args)=>hooks.open?.(...args),close:()=>hooks.close?.(),getDialogToken:hooks.getDialogToken,toast:message=>hooks.toast?.(message),route:()=>currentRoute(),getManifest:id=>savedMind(id)?.manifest,navigate:(...args)=>hooks.navigate?.(...args),getActivity:id=>liveActivity.get(id),getActivities:()=>liveActivity.items(),getActivityState:()=>liveActivity.state(),loadActivity:options=>liveActivity.load(options)});
  const eventPaper=createEventPaperTrading({getAppearance:id=>readMindAppearance(workspace,id).config,request,onData:(value,profileId)=>eventPaperBatch.acceptProfile(value,profileId),redraw:()=>redraw(),open:(...args)=>hooks.open?.(...args),close:()=>hooks.close?.(),getDialogToken:hooks.getDialogToken,toast:message=>hooks.toast?.(message),route:()=>currentRoute(),getManifest:id=>savedMind(id)?.manifest,navigate:(...args)=>hooks.navigate?.(...args)});
  const brokers=createBrokerConnections({request,redraw:()=>redraw(),open:(...a)=>hooks.open?.(...a),close:()=>hooks.close?.(),toast:m=>hooks.toast?.(m),route:()=>currentRoute(),getDialogToken:hooks.getDialogToken});
  let memoryData=null,memoryKey='',memoryLoading=false,memoryError='',memoryGeneration=0,memoryAbort=null,memoryReadAt=0;
  const recordCursors=createCursorHistory(),mindLibraryCursors=createCursorHistory();
  let mindLibraryData=null,mindLibraryKey='',mindLibraryLoading=false,mindLibraryError='',mindLibraryGeneration=0,mindLibraryAbort=null;
  let instruments=listInstruments();const instrumentMetadata=new Map(instruments.map(item=>[item.id,item])),watched=new Set();
  function setMindCatalog(value){
    if(Number.isSafeInteger(value?.revision)&&Number.isSafeInteger(mindData?.revision)&&value.revision<mindData.revision)return;
    const catalog=new Map(listInstruments().map(i=>[i.id,{...i,...instrumentMetadata.get(i.id)}]));
    const candidates=[...list(value?.instruments),...list(value?.minds).flatMap(mind=>list(mind.manifest?.data.universe.resolution?.candidates))];
    for(const item of candidates){try{catalog.set(item.id,{...getInstrument(item.id),...item});}catch{}}
    for(const item of catalog.values())instrumentMetadata.set(item.id,item);instruments.splice(0,instruments.length,...catalog.values());mindData=value;
  }
  const knowledgeItems=new Map();
  try{for(const id of JSON.parse(globalThis.localStorage?.getItem('keynes-watchlist-v1')||'[]')){try{const item=getInstrument(id);watched.add(id);if(!instrumentMetadata.has(id))instrumentMetadata.set(id,item);}catch{}}}catch{}
  try{for(const item of JSON.parse(globalThis.localStorage?.getItem('cji-watchlist-metadata-v1')||'[]'))if(watched.has(item?.id))instrumentMetadata.set(item.id,{...getInstrument(item.id),...watchIdentity(item)});}catch{}
  function watchIdentity(item){return Object.fromEntries(['id','symbol','name','englishName','venue','market','marketCountry','assetClass','assetType','securityType','quoteCurrency'].filter(key=>typeof item?.[key]==='string').map(key=>[key,item[key]]));}
  function saveWatchlist(){try{globalThis.localStorage?.setItem('keynes-watchlist-v1',JSON.stringify([...watched]));globalThis.localStorage?.setItem('cji-watchlist-metadata-v1',JSON.stringify([...watched].map(id=>watchIdentity(instrumentMetadata.get(id)))));}catch{}}
  const terminalUniverse=createTerminalUniverse({request,storage:options.universeStorage??optionalSessionStorage(),onItems:rememberCatalogItems,getWatched:()=>[...watched].map(id=>instrumentMetadata.get(id)).filter(Boolean),onChange:()=>terminal.updateUniverse(terminalUniverseModel())});
  function terminalUniverseModel(){const state=terminalUniverse.state(),quotes=new Map(list(terminalSnapshot()?.instruments).map(item=>[item.id,item]));return {...state,loading:state.loading||!state.loaded&&!state.error,items:state.items.map(item=>({...instrumentMetadata.get(item.id),...item,...quotes.get(item.id),watched:watched.has(item.id)}))};}
  const redraw=()=>{rememberMindActionFocus();const active=typeof document!=='undefined'?document.activeElement:null;capabilityFocus=currentRoute().page==='settings'&&currentRoute().params.get('view')==='capabilities'?(active?.matches?.('[data-capability-search]')?{start:active.selectionStart,end:active.selectionEnd}:active?.matches?.('[data-studio-action="refresh"]')?{refresh:true}:null):null;if(typeof document!=='undefined'&&document.activeElement?.matches?.('[data-studio-search]'))recordFieldFocus={start:document.activeElement.selectionStart,end:document.activeElement.selectionEnd};else if(typeof document!=='undefined'&&document.activeElement?.matches?.('[data-studio-record-filter]'))recordFieldFocus={filter:document.activeElement.dataset.studioRecordFilter};hooks.render?.();};
  const currentRoute=()=>hooks.getRoute?.()||route;
  const home=createHomeShowcase({request,mutate,getDialogToken:hooks.getDialogToken,getRoute:currentRoute,render:redraw,navigate:hooks.navigate,open:hooks.open,download:hooks.download,getWorkspace:()=>workspace,getAutomationSupported:id=>!automaticScopeIssue(savedMind(id)?.manifest),getStrategyScope:id=>savedMind(id)?.manifest?.data?.strategyPlan?.scope?.universe,getEventStream:id=>isEventAutomationMind(savedMind(id)?.manifest),getPaperActivities:()=>eventPaperBatch.items(),getPaperActivityState:()=>eventPaperBatch.state(),loadPaperActivities:options=>eventPaperBatch.load(options),getLiveActivities:()=>liveActivity.items(),getLiveActivityState:()=>liveActivity.state(),loadLiveActivity:options=>liveActivity.load(options),toast:hooks.toast});
  const newsComparisons=createNewsComparisonUI({request,mutate,open:hooks.open,download:hooks.download,getMindId:()=>currentRoute().params.get('profileId'),getRecordsHref:()=>studioRouteHash(currentRoute(),'minds',{profileId:currentRoute().params.get('profileId')||'all',executionMode:'paper',view:'records',kind:'decisions',cursor:null,search:null,status:null,instrumentId:null}),form,getDialogToken:hooks.getDialogToken});
  const library=createMarketLibrary({request,mutate,getRoute:currentRoute,render:redraw,navigate:hooks.navigate,open:hooks.open,close:hooks.close,getDialogToken:hooks.getDialogToken,toast:hooks.toast,download:hooks.download,isBusy:()=>busy,instruments,mindName:id=>profileName(id),onPin:openKnowledgePin,onDecision:openDecision,onMind:id=>{hooks.close?.();hooks.navigate?.('minds',{profileId:id,view:'knowledge'});}});
  let quantMindCatalogRequest=null;
  const loadQuantMindCatalog=()=>quantMindCatalogRequest??=(async()=>{try{setMindCatalog(await request(endpoints.minds));return list(mindData?.minds);}finally{quantMindCatalogRequest=null;}})();
  const quantLibrary=createQuantStrategyLibrary({request,mutate,getRevision:()=>workspace?.revision,getRoute:currentRoute,getDialogToken:hooks.getDialogToken,render:redraw,navigate:hooks.navigate,open:hooks.open,close:hooks.close,toast:hooks.toast,download:hooks.download,isBusy:()=>busy,getMinds:()=>list(mindData?.minds),loadMinds:loadQuantMindCatalog,mindName:id=>profileName(id),onPrepareDeployment:async result=>{await loadQuantMindCatalog();liveAutomationIntent={mindId:result.profileId,configure:true};hooks.navigate?.('minds',{profileId:result.profileId,view:'operations',executionMode:'live'});},openProgramGraph:(program,models,onSave)=>openGraphEditor({name:program.name,initialGraph:program.graph??createRegimeProgramGraph(program,{models}),programModels:models,onSave,saveLabel:'라우터 새 버전 저장',knowledge:false}),onAttach:openQuantStrategyMind,openDocument:documentDetail,openModelGraph:model=>openGraphEditor({mindId:model.policy.scope.profileId,name:model.name,plan:model.policy.data.strategyPlan,readOnly:true})});
  const openGraphEditor=options=>{const id=options.mindId||currentRoute().params.get('profileId');return hooks.openStrategyEditor?.({...options,mind:isRegimeProgramGraph(options.initialGraph)?null:{id,name:options.name,appearance:readMindAppearance(workspace,id).config},quantLibrary:isRegimeProgramGraph(options.initialGraph)?null:quantLibrary.graphHooks});};
  const simulations=createSimulationPlayground({quantLibrary:quantLibrary.graphHooks,getRoute:currentRoute,href:(page,params)=>studioRouteHash(currentRoute(),page,params),request,render:redraw,navigate:hooks.navigate,open:hooks.open,close:hooks.close,getDialogToken:hooks.getDialogToken,toast:hooks.toast,download:hooks.download,openStrategyDraft,documentDetail,getMinds:()=>list(mindData?.minds).filter(m=>byId(workspace?.investmentProfiles,m.id)?.status!=='ARCHIVED').map(m=>({id:m.id,name:m.manifest?.data.name||m.name||profileName(m.id),manifest:m.manifest,appearance:readMindAppearance(workspace,m.id).config}))});
  const calendar=createWorkspaceCalendar({getRoute:currentRoute,request,render:redraw});
  function navigation(value=currentRoute()){
    const selected=value.params.get('profileId')||'all',scopeName=selected==='all'?'전체 마인드':profileName(selected),primary=WORKSPACE_NAV.find(n=>n[0]===value.page)?.[2]||'트레이딩',views=value.page==='minds'?MIND_VIEWS:value.page==='library'?LIBRARY_VIEWS:value.page==='settings'?SETTINGS_VIEWS:[];
    const active=value.params.get('view')||views[0]?.[0],items=views.map(([id,label])=>({id,label,active:active===id,disabled:value.page==='minds'&&selected==='all'&&['operations','principles'].includes(id),href:studioRouteHash(value,value.page,{view:id,cursor:null,knowledgePage:null})}));
    if(value.page==='trade')items.push({id:'trade',label:'종목 거래',active:true,href:studioRouteHash(value,'trade')},{id:'records',label:selected==='all'?'전체 운용 기록':'운용 기록',active:false,href:studioRouteHash(value,'minds',{view:'records',profileId:selected,instrumentId:null,cursor:null})},{id:'mind',label:'마인드 관리',active:false,href:studioRouteHash(value,'minds',{view:'overview'})});
    const scopeLoaded=value.page==='minds'&&selected!=='all'&&!!byId(workspace?.investmentProfiles,selected),executionMode=executionModeOf(value),paperScope=executionMode==='paper'&&['all',selected].includes(subscriptionMindId);
    const companion=scopeLoaded?buildMindCompanions({paperActivities:eventPaperBatch.items(),workspace,minds:workspaceMindCatalog(workspace,mindData),subscriptions:paperScope&&subscriptionData?.revision===workspace.revision?list(subscriptionData.subscriptions):undefined,liveActivities:liveActivity.items(),executionMode,asOf:new Date().toISOString()}).cards.find(card=>card.profileId===selected):null;
    return {page:value.page,title:primary,scopeName,scopeLoaded,scopeIdentityMarkup:companion?renderLifeStage(companion,{view:'portrait'}):'',scopeStatus:byId(workspace?.investmentProfiles,selected)?.status==='ARCHIVED'?'보관됨':companion?.liveActivity?mindActivityModel(companion.liveActivity).status:companion?.label||'',scopeAutomationMarkup:companion&&['overview','operations'].includes(active)?renderMindNodeEdit(companion)+renderActionMenu({id:'mind-identity-actions',label:'마인드 작업',content:renderMindAutomationEntry({...companion,profileId:selected,name:profileName(selected),executionMode,automaticScopeSupported:!automaticScopeIssue(savedMind(selected)?.manifest),strategyScope:savedMind(selected)?.manifest?.data.strategyPlan?.scope?.universe,eventStream:!!companion.paperActivity||!!companion.liveActivity||isEventAutomationMind(savedMind(selected)?.manifest)})+button('캐릭터 꾸미기','mind-customize',selected)+button('마인드 편집','profile-edit',selected)}):companion?renderMindAutomationEntry({...companion,automaticScopeSupported:!automaticScopeIssue(savedMind(selected)?.manifest),strategyScope:savedMind(selected)?.manifest?.data?.strategyPlan?.scope?.universe,eventStream:!!companion.paperActivity||isEventAutomationMind(savedMind(selected)?.manifest),archived:byId(workspace?.investmentProfiles,selected)?.status==='ARCHIVED'},{className:'button small'}):'',selectedMindId:selected,minds:list(workspace?.investmentProfiles).filter(p=>p.status!=='ARCHIVED'||p.id===selected).map(p=>({id:p.id,name:profileName(p.id),createdLabel:p.createdAt?when(p.createdAt):null})),showMindPicker:value.page==='minds',items,breadcrumbs:[primary,...(value.page==='minds'?[scopeName]:[]),...(value.page==='trade'?[]:[views.find(v=>v[0]===active)?.[1]||''])]};
  }
  const savedMind=id=>list(mindData?.minds).find(m=>m.id===id);
  const profileName=id=>{const profile=byId(workspace?.investmentProfiles,id);return profile?.displayName||profile?.name||savedMind(id)?.name||savedMind(id)?.manifest?.data?.name||'공통';};
  const profileVersion=id=>byId(workspace?.profileVersions,id);
  const terminal=createTradingTerminal({
    onBrowseInstruments:()=>openInstrumentCatalog(),
    onUniverseFilter:patch=>terminalUniverse.change(patch),onUniverseQuery:q=>terminalUniverse.change({q},{debounce:true}),onUniversePage:direction=>terminalUniverse.load({direction}),onUniverseRetry:()=>terminalUniverse.load({force:true}),
    onUniverseCollectCatalog:()=>terminalUniverse.collectCatalog(collectUpbitCatalog),
    onUniverseCollectSector:()=>terminalUniverse.collectSector(async filters=>{if(busy)throw new Error('진행 중인 작업이 끝난 뒤 다시 시도하세요.');return mutate('',{provider:'toss',markets:filters.market?[filters.market]:['KR','US'],sectorIds:[filters.sectorId]},'/api/workspace/universe/sources');}),
    onSelectInstrument:id=>{const instrument=instrumentMetadata.get(id)||instruments.find(item=>item.id===id)||getInstrument(id);hooks.navigate?.('trade',{instrumentId:id,timeframe:instrument.defaultTimeframe,comparisonId:null,mode:'live'});},
    onSelectMind:id=>hooks.navigate?.('trade',{profileId:id}),onTimeframe:timeframe=>hooks.navigate?.('trade',{timeframe}),
    onScope:value=>hooks.navigate?.('trade',{mode:value==='live'?'live':'replay',comparisonId:['live','replay'].includes(value)?null:value}),onRefresh:()=>refresh(),onDecision:openTerminalDecision,
    onConnections:openTerminalConnections,
    onData:openTerminalData,
    onRecovery:recoverTerminal,
    onProfile:id=>hooks.navigate?.('minds',{profileId:id||'all',view:'operations'}),onKnowledge:openKnowledge,
    onImport:()=>openDocumentEditor(),onExport:id=>openExport(id),onTab:view=>hooks.navigate?.('trade',{tab:view}),
    onAccount:openAccountForm,onValuation:loadValuation,onPaperReview:openMindOrderReview,onObservation:id=>id.startsWith('mind-run-')?openMindObservation(id):openExperience(list(workspace.experiences).find(e=>e.decisionId===id)?.id),
    onWatchlist:(id,value)=>{value?watched.add(id):watched.delete(id);saveWatchlist();terminalUniverse.refreshWatchlist();},
    onRun:runSelected,onChartError:()=>{},...options.terminalHooks
  });
  function assertDocumentRequestSize(path,serializedBody){
    if(serializedBody&&(path===endpoints.mindImport||path==='/api/workspace/market-knowledge/write')&&new TextEncoder().encode(serializedBody).byteLength>200000){const problem=new Error('저장할 문서와 요청 정보를 합친 크기가 200KB를 초과했습니다. 문서 내용을 줄여 다시 저장하세요.');problem.code='BODY_TOO_LARGE';throw problem;}
  }
  async function request(path,body,{signal,workspaceView='studio'}={}){
    const serializedBody=body?JSON.stringify(body):null;
    assertDocumentRequestSize(path,serializedBody);
    const response=await fetchImpl(path,{method:body?'POST':'GET',cache:'no-store',signal,headers:{'Content-Type':'application/json',...(workspaceView==='studio'?{'X-Workspace-View':'studio'}:{})},...(body?{body:serializedBody}:{})});
    let value;try{value=await response.json();}catch{throw new Error('서버 응답을 확인하지 못했습니다. 저장된 기록을 다시 조회하세요.');}
    if(!response.ok||value.ok===false){const problem=new Error(value.message||value.error?.message||'요청을 완료하지 못했습니다.');problem.code=value.code;problem.serverResponse=true;problem.blockedInputs=value.blockedInputs;problem.inputRequirementPolicy=value.inputRequirementPolicy;problem.availability=value.availability;problem.diagnostic=value.diagnostic;problem.collection=value.collection;problem.terminalReadiness=value.terminalReadiness;problem.recovery=value.recovery;problem.providerFailureEventId=value.providerFailureEventId;problem.status=response.status;throw problem;}return value;
  }
  async function readCore(path){
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),8000);
    try{return await request(path,undefined,{signal:controller.signal});}
    catch(problem){if(controller.signal.aborted)throw new Error('서버 응답이 지연되고 있습니다. 다시 조회해 주세요.');throw problem;}
    finally{clearTimeout(timer);}
  }
  function acceptWorkspace(value){
    if(Number.isSafeInteger(value?.revision)&&Number.isSafeInteger(workspace?.revision)&&value.revision<workspace.revision)return false;
    workspace=value;return true;
  }
  async function refreshPanels({quiet=false,revisionChanged=false,skipSubscriptions=false}={}){
    if(disposed)return;
    const tasks=[calendar.load({force:true}),loadCapabilities({force:true}),loadEventPaperBatch({force:true}),loadPaperActivity(),loadLiveActivity({force:true}),automatedTrading.load({force:true}),eventPaper.load({force:true}),loadMindLibrary({force:revisionChanged}),skipSubscriptions?Promise.resolve():loadMindSubscriptions({force:true,quiet}),simulations.load({force:!quiet}),loadMemoryView({force:!quiet||revisionChanged}),loadCompanionValuations({force:revisionChanged})];
    if(!quiet)tasks.push(loadTerminal({force:true}),currentRoute().page==='trade'?terminalUniverse.load({force:true}):Promise.resolve(),loadRecords({force:true}),library.load({force:true}),quantLibrary.load({force:true}),loadKnowledgePinTitles());
    else if(revisionChanged)tasks.push(quantLibrary.load());
    if(!home.state().marketBusy&&!home.state().recommendationBusy)tasks.push(home.load({force:!quiet}));
    if(!captureCollecting)tasks.push(loadCaptureStatus());
    await Promise.allSettled(tasks);
  }
  async function refresh({quiet=false,coreOnly=false,skipSubscriptions=false}={}){
    if(loading&&started&&workspace===null&&!quiet)return;
    const token=++coreReadGeneration,previousRevision=workspace?.revision,previousMindRevision=mindData?.revision,previousConnections=JSON.stringify(mindData?.connections??null);
    if(!quiet)error='';
    try{
      const [state,catalog,statusRead]=await Promise.allSettled([readCore('/api/workspace?view=studio'),readCore(endpoints.minds),status?Promise.resolve(status):readCore('/api/status')]);
      if(token!==coreReadGeneration||disposed)return workspace;
      if(statusRead.status==='fulfilled')status=statusRead.value;
      if(state.status==='rejected')throw state.reason;
      if(acceptWorkspace(state.value.workspace))marketInfo=state.value.market;
      loading=false;
      if(catalog.status==='fulfilled')setMindCatalog(catalog.value);else if(!quiet)error=catalog.reason.message;
      const revisionChanged=workspace?.revision!==previousRevision;
      if(!quiet||revisionChanged||mindData?.revision!==previousMindRevision||JSON.stringify(mindData?.connections??null)!==previousConnections)redraw();
      if(!coreOnly)await refreshPanels({quiet,revisionChanged,skipSubscriptions});
      return workspace;
    }catch(problem){if(token===coreReadGeneration&&!disposed){loading=false;if(!quiet){error=problem.message;redraw();}}throw problem;}
  }
  async function mutate(type,payload={},path='/api/workspace/actions',{onCommitted,expectedRevision=workspace?.revision,newAttempt=false}={}){
    if(executionModeOf(currentRoute())==='live'&&!sharedWorkspaceWrite(type,path))throw new Error('모의 운용 작업은 모의 보기에서 진행하세요. 실전 운용은 마인드의 운용 관리에서 확인하세요.');
    if(busy||!workspace)throw new Error('현재 저장을 마친 뒤 다시 실행하세요.');
    coreReadGeneration++;busy=true;error='';redraw();const fingerprint=JSON.stringify({path,type,payload}),key=(!newAttempt&&requestKeys.get(fingerprint))||crypto.randomUUID();requestKeys.set(fingerprint,key);
    try{const body=path==='/api/workspace/actions'?{type,payload,idempotencyKey:key,expectedRevision}:{...payload,idempotencyKey:key,expectedRevision},value=await (['/api/workspace/accounts/budget','/api/workspace/accounts/allocate'].includes(path)?submitPaperFunding(request,path,body):request(path,body));try{onCommitted?.(value);}catch{}const refreshQuantUsage=path.startsWith('/api/workspace/mind-documents');if(refreshQuantUsage)quantLibrary.invalidate();requestKeys.delete(fingerprint);if(value.workspace)acceptWorkspace(value.workspace);else try{await refresh({quiet:true,coreOnly:true,skipSubscriptions:path.startsWith('/api/workspace/mind-subscriptions/')||path.startsWith('/api/workspace/paper-adaptation/')});}catch(problem){error='저장 완료 · 최신 화면 조회 실패. '+problem.message+' 새로고침으로 저장 상태를 확인하세요.';}if(['/api/workspace/accounts/budget','/api/workspace/accounts/allocate'].includes(path)){eventPaperBatch.invalidate();await eventPaperBatch.load({force:true});}if(refreshQuantUsage){try{if(value.workspace)setMindCatalog(await request(endpoints.minds));await Promise.all([quantLibrary.load(),loadMindLibrary({force:true})]);}catch(problem){error='저장 완료 · 검토 목록 조회 실패. '+problem.message;}}if(path.startsWith('/api/workspace/mind-subscriptions/'))await loadMindSubscriptions({force:true,quiet:true});return value;}
    catch(problem){if(problem.serverResponse===true&&(path==='/api/workspace/market-captures/collect'&&problem.code||path===endpoints.terminalEvaluate&&problem.recovery?.category==='JEV_AUTH'))requestKeys.delete(fingerprint);try{await refresh({quiet:true,coreOnly:true});}catch{}throw problem;}
    finally{busy=false;redraw();}
  }
  async function mutateInDialog(type,payload,path){const token=hooks.getDialogToken?.();try{const value=await mutate(type,payload,path);return !disposed&&dialogIsCurrent(token)?value:null;}catch(problem){if(!disposed&&dialogIsCurrent(token))throw problem;return null;}}
  function mindInstrument(profileId,preferredId=null){
    const universe=savedMind(profileId)?.manifest?.data.universe,ids=list(universe?.instrumentIds),candidates=[...(ids.includes(preferredId)?[preferredId]:[]),...ids];
    for(const id of candidates){try{return instrumentMetadata.get(id)||getInstrument(id,{resolution:universe?.resolution});}catch{}}
    return ids.length?null:instruments[0];
  }
  function selectedIdentity(){const r=currentRoute(),profile=r.params.get('profileId')||'all',contextMind=profile==='all'?list(mindData?.minds).find(m=>m.manifest?.data?.universe?.instrumentIds?.length)?.id:profile,id=r.params.get('instrumentId')||mindInstrument(contextMind)?.id||'crypto:okx:BTC-USDT';let instrument;try{instrument=instrumentMetadata.get(id)||instruments.find(item=>item.id===id)||getInstrument(id);}catch{instrument=getInstrument('crypto:okx:BTC-USDT');}const timeframe=r.params.get('timeframe')||instrument.defaultTimeframe,profileId=r.params.get('profileId')||'all',comparisonId=r.params.get('comparisonId')||'',mode=r.params.get('mode')||(comparisonId?'replay':'live');return {instrument,timeframe,profileId,comparisonId,mode};}
  function valuationScope(){const identity=selectedIdentity();return {profileId:identity.profileId,quoteCurrency:identity.instrument.quoteCurrency};}
  function companionValuationView(){return currentRoute().page==='minds'&&(currentRoute().params.get('profileId')||'all')==='all'&&(currentRoute().params.get('view')||'overview')==='overview'&&executionModeOf(currentRoute())==='paper';}
  async function loadCompanionValuations({force=false,maxAgeMs=30000}={}){
    if(disposed||!workspace||!companionValuationView()||companionValuationLoading)return;
    const accounts=list(workspace.mindPositions).filter(a=>a.kind==='PAPER_ACCOUNT'),currencies=[...new Set(accounts.filter(a=>list(a.positions).some(p=>p.quantity>0)).map(a=>a.quoteCurrency))].sort(),revision=workspace.revision;
    if(!currencies.length){companionValuations=[];companionValuationError='';return;}
    if(!force&&revision===companionValuationRevision&&Date.now()-companionValuationReadAt<maxAgeMs)return;
    const token=++companionValuationGeneration;companionValuationAbort?.abort();companionValuationAbort=new AbortController();companionValuationLoading=true;companionValuationError='';redraw();
    try{
      const envelopes=await Promise.all(currencies.map(quoteCurrency=>request('/api/workspace/mind-valuations?'+new URLSearchParams({profileId:'all',quoteCurrency}),undefined,{signal:companionValuationAbort.signal})));
      if(disposed||token!==companionValuationGeneration||!companionValuationView())return;
      if(workspace.revision!==revision||envelopes.some((value,index)=>value.revision!==revision||value.valuation?.scope?.profileId!=='all'||value.valuation?.scope?.quoteCurrency!==currencies[index]))throw new Error('평가 조회 중 계좌가 변경되었습니다. 평가를 다시 갱신하세요.');
      companionValuations=envelopes;companionValuationRevision=revision;companionValuationReadAt=Date.now();
      const incomplete=envelopes.find(value=>!['READY','EMPTY'].includes(value.valuation.status));if(incomplete)companionValuationError=incomplete.valuation.failures?.[0]?.message||'보유 종목의 현재가를 확인한 뒤 평가를 다시 갱신하세요.';
    }catch(problem){if(token===companionValuationGeneration&&problem.name!=='AbortError'){companionValuationError=problem.message;companionValuationReadAt=Date.now();companionValuationRevision=revision;}}
    finally{if(token===companionValuationGeneration){companionValuationLoading=false;if(!disposed)redraw();}}
  }
  function valuationModel(){const scope=valuationScope(),key=new URLSearchParams(scope).toString();if(key!==valuationKey)return {};const pending=valuationLoading,error=valuationError,value=valuationData?.revision===workspace?.revision?valuationData.valuation:null;if(!pending&&!error&&!value)return {};return {valuation:pending?{status:'LOADING',scope}:error?{status:'ERROR',scope,message:error}:value,...(value?.status==='READY'&&!pending&&!error?{summary:value.summary,mindSummaries:value.mindSummaries}:{summary:null})};}
  async function loadValuation(){
    if(executionModeOf(currentRoute())==='live')return loadLiveActivity({force:true});
    if(!workspace||valuationLoading||selectedIdentity().mode==='replay')return;const scope=valuationScope(),key=new URLSearchParams(scope).toString(),revision=workspace.revision,token=++valuationGeneration;valuationAbort?.abort();valuationAbort=new AbortController();valuationKey=key;valuationLoading=true;valuationError='';valuationData=null;redraw();
    try{const value=await request('/api/workspace/mind-valuations?'+key,undefined,{signal:valuationAbort.signal});if(token!==valuationGeneration||key!==new URLSearchParams(valuationScope()).toString())return;if(value.revision!==workspace?.revision||revision!==workspace?.revision)throw new Error('평가 조회 중 계좌가 변경되었습니다. 새로고침 후 다시 갱신하세요.');if(value.valuation?.scope?.profileId!==scope.profileId||value.valuation?.scope?.quoteCurrency!==scope.quoteCurrency)throw new Error('평가 대상 마인드와 통화를 다시 확인하세요.');valuationData=value;}
    catch(problem){if(token===valuationGeneration&&problem.name!=='AbortError')valuationError=problem.message;}
    finally{if(token===valuationGeneration){valuationLoading=false;redraw();}}
  }
  function isMemoryView(value=currentRoute()){return value.page==='minds'&&value.params.get('view')==='knowledge'&&value.params.get('knowledgeView')==='memory'||value.page==='library'&&value.params.get('view')==='memory';}
  async function loadMemoryView({force=false}={}){
    if(!workspace||!isMemoryView())return;const profileId=currentRoute().params.get('profileId')||'all',key=profileId+'|'+workspace.revision;if(!force&&memoryKey===key&&(memoryLoading||Date.now()-memoryReadAt<30000))return;memoryAbort?.abort();memoryAbort=new AbortController();const token=++memoryGeneration;memoryKey=key;memoryLoading=true;memoryError='';memoryData=null;redraw();
    try{const value=await request('/api/workspace/mind-memories?'+new URLSearchParams({profileId}),undefined,{signal:memoryAbort.signal});if(token!==memoryGeneration)return;if(value.revision!==workspace?.revision)throw new Error('학습 자료 조회 중 정책이 변경되었습니다. 다시 조회하세요.');memoryData=value;memoryReadAt=Date.now();}
    catch(problem){if(token===memoryGeneration&&problem.name!=='AbortError')memoryError=problem.message;}
    finally{if(token===memoryGeneration){memoryLoading=false;redraw();}}
  }
  function invalidateTerminal(){terminalAbort?.abort();terminalGeneration++;lastTerminalKey='';terminalReadAt=0;terminalReadRevision=null;terminalRequestRevision=null;terminalData=null;terminalError='';terminalLoading=false;}
  function terminalQuery(){const {instrument,timeframe,profileId,comparisonId,mode}=selectedIdentity(),executionMode=executionModeOf(currentRoute());return new URLSearchParams({instrumentId:instrument.id,timeframe,profileId,mode:executionMode==='live'?'live':mode,executionMode,...(comparisonId&&executionMode==='paper'?{comparisonId}:{})});}
  function terminalSnapshot(){return lastTerminalKey===terminalQuery().toString()?terminalData:null;}
  function terminalPending(){return terminalLoading||lastTerminalKey!==terminalQuery().toString();}
  function terminalProblem(){return lastTerminalKey===terminalQuery().toString()?terminalError:'';}
  async function loadTerminal({force=false}={}){
    if(!workspace||currentRoute().page!=='trade')return;
    const query=terminalQuery(),key=query.toString();
    const revision=workspace.revision,age=terminalNow()-terminalReadAt;
    if(!force&&lastTerminalKey===key&&(terminalLoading&&terminalRequestRevision===revision||terminalData&&Number.isSafeInteger(terminalReadRevision)&&terminalReadRevision===revision&&age>=0&&age<terminalCacheTtlMs))return;
    terminalAbort?.abort();terminalAbort=new AbortController();const token=++terminalGeneration;lastTerminalKey=key;terminalRequestRevision=revision;terminalReadRevision=null;terminalReadAt=0;terminalLoading=true;terminalError='';terminalData=null;redraw();
    try{const value=await request(endpoints.terminal+'?'+query,undefined,{signal:terminalAbort.signal});if(token!==terminalGeneration)return;if(revision!==workspace?.revision||Number.isSafeInteger(value.revision)&&value.revision!==workspace.revision)throw new Error('계좌·설정이 변경되었습니다. 최신 시세를 다시 조회하세요.');terminalData=value.model;terminalReadRevision=Number.isSafeInteger(value.revision)?value.revision:null;terminalReadAt=terminalNow();terminalLoading=false;redraw();}
    catch(problem){if(token!==terminalGeneration||problem.name==='AbortError')return;terminalLoading=false;terminalError=problem.message;redraw();}
  }
  function terminalKnowledge(items){return list(items).map(entry=>{const saved=list(mindData?.documents).find(d=>d.id===entry.id||(d.document||d).id===entry.id);return saved?{...saved,...entry,document:saved.document||entry.document||saved}:entry;});}
  function liveTerminalModel(){
    const terminalError=terminalProblem();
    const {instrument,timeframe,profileId}=selectedIdentity(),data=terminalSnapshot()??{},activities=list(liveActivity.items()).filter(item=>(profileId==='all'||item.profileId===profileId)&&list(item.marketIds).some(market=>'crypto:upbit:'+market===instrument.id)),readiness=data.terminalReadiness;
    const primary={action:profileId==='all'?'choose-mind':'profile',label:profileId==='all'?'마인드 선택':'운용 보기',params:{profileId}},liveRequirement={code:'LIVE_READ_ONLY',category:'MODE',message:'실전 운용은 마인드에서 관리합니다.',action:primary};
    return {...data,executionMode:'live',source:'live',sources:[{id:'live',name:data.sourceLabel||instrument.venue}],scopes:[{id:'live',label:'최근 확정 봉'}],selectedScope:'live',selectedInstrumentId:instrument.id,selectedMindId:profileId,timeframe,supportedTimeframes:list(data.supportedTimeframes).length?data.supportedTimeframes:instrument.timeframes,profiles:list(data.profiles).length?data.profiles:list(workspace.investmentProfiles).map(p=>({id:p.id,name:profileName(p.id)})),instruments:terminalDisplayInstruments(list(data.instruments).length?data.instruments:instruments,{metadata:instrumentMetadata,watchedIds:[...watched],selectedInstrument:instrument}).map(i=>({...i,watched:watched.has(i.id)})),bars:list(data.bars),knowledge:terminalKnowledge(data.knowledge),accounts:[],summary:null,mindSummaries:[],aggregationStatus:null,valuation:null,decisions:liveTerminalRecords(activities,{instrumentId:instrument.id,profileId}),latestRun:null,liveActivities:activities,activityStatus:liveActivity.state().error?'error':liveActivity.state().data?'ready':'loading',positions:activities.flatMap(item=>list(item.ledger?.positions).filter(p=>p.instrumentId===instrument.id).map(p=>({...p,profileId:item.profileId,profileName:profileName(item.profileId),quantity:Number(p.quantity),quoteCurrency:item.quoteCurrency,equity:null,pnl:null,feesPaid:null,asOf:item.ledger.ledgerAsOf}))),terminalReadiness:{...readiness,schemaVersion:1,executionReadiness:{...readiness?.executionReadiness,canRun:false,blockers:[liveRequirement],primaryAction:primary,account:null}},runRequirement:liveRequirement,canRun:false,busy,status:terminalPending()?'loading':terminalError||data.status&&data.status!=='READY'?'error':'ready',error:terminalError||data.error||'',recordView:currentRoute().params.get('tab')||'decisions',dataModeLabel:'확정 봉 시세'};
  }
  function model(){
    const terminalData=terminalSnapshot(),terminalLoading=terminalPending(),terminalError=terminalProblem();
    if(executionModeOf(currentRoute())==='live')return liveTerminalModel();
    if(terminalData){const identity=selectedIdentity(),warnings=list(terminalData.warnings),ready=String(terminalData.status||'READY').toUpperCase()==='READY';
      const accounts=Array.isArray(terminalData.accounts)?terminalData.accounts:list(workspace.mindPositions),account=accounts.find(a=>a.profileId===identity.profileId&&a.quoteCurrency===identity.instrument.quoteCurrency),replay=identity.mode==='replay';
      const plan=savedMind(identity.profileId)?.manifest?.data.strategyPlan,planScopeMismatch=plan?.status==='APPROVED'&&plan.approval?.enabled&&((plan.scope.instrumentPolicy==='UNIVERSE_CURRENT'?!list(savedMind(identity.profileId)?.manifest?.data.universe.instrumentIds).includes(identity.instrument.id):plan.scope.instrumentId!==identity.instrument.id)||plan.scope.timeframe!==identity.timeframe);
      const originalReadiness=terminalData.terminalReadiness;
      const sameSelection=terminalFailure&&terminalFailure.profileId===identity.profileId&&terminalFailure.instrumentId===identity.instrument.id&&terminalFailure.timeframe===identity.timeframe&&identity.mode==='live';
      const sameInputs=terminalFailure&&terminalFailure.marketAsOf===originalReadiness?.marketRecovery?.asOf&&terminalFailure.policyHash===originalReadiness?.executionReadiness?.policy?.hash;
      const failure=sameSelection&&(terminalFailure.recovery.category==='JEV_AUTH'?originalReadiness?.executionReadiness?.requiresJev===true:sameInputs)?terminalFailure:null;
      const readiness=failure?{...originalReadiness,schemaVersion:1,executionReadiness:{...originalReadiness?.executionReadiness,status:'ACTION_REQUIRED',canRun:false,blockers:[failure.recovery],primaryAction:failure.recovery.action}}:originalReadiness;
      const runRequirement=readiness?readiness.executionReadiness.blockers[0]||null:replay?null:identity.profileId==='all'?{code:'MIND_SELECTION_REQUIRED',message:'실행할 마인드를 선택하세요.'}:terminalData.canRun===false&&terminalData.runRequirement?terminalData.runRequirement:planScopeMismatch?{code:'STRATEGY_PLAN_SCOPE',message:plan.scope.instrumentPolicy==='UNIVERSE_CURRENT'?'투자 범위의 종목과 '+(({'1h':'1시간봉','4h':'4시간봉','1d':'일봉'})[plan.scope.timeframe]||plan.scope.timeframe)+'을 선택하세요.':'이 마인드의 전략은 '+getInstrument(plan.scope.instrumentId).symbol+' · '+(({'1h':'1시간봉','4h':'4시간봉','1d':'일봉'})[plan.scope.timeframe]||plan.scope.timeframe)+'에서 실행합니다.'}:!account?{code:'PAPER_ACCOUNT_REQUIRED',message:identity.instrument.quoteCurrency+' 모의 계좌 연결 필요'}:terminalData.runRequirement||null;
      const accountTarget=replay?'저장된 모의 운용':identity.profileId==='all'?'마인드 선택 필요':account?identity.instrument.quoteCurrency+' 모의 계좌':identity.instrument.quoteCurrency+' 모의 계좌 연결 필요';
      return {...terminalData,profiles:list(terminalData.profiles).map(p=>({...p,status:byId(workspace?.investmentProfiles,p.id)?.status||p.status})),terminalReadiness:readiness,...(replay?{}:valuationModel()),knowledge:terminalKnowledge(terminalData.knowledge),runRequirement,sourceLabel:({'naver-reference':'네이버금융 · 참고 일봉',kis:'한국투자증권',okx:'OKX','binance-archive':'Binance · 과거 자료'})[terminalData.sourceLabel]||terminalData.sourceLabel,sources:[{id:terminalData.source,name:({'naver-reference':'네이버금융',kis:'한국투자증권',okx:'OKX','binance-archive':'Binance · 과거 자료'})[terminalData.sourceLabel]||terminalData.sourceLabel}],instruments:terminalDisplayInstruments(list(terminalData.instruments),{metadata:instrumentMetadata,watchedIds:[...watched],selectedInstrument:{...identity.instrument,...terminalData.instrumentPresentation}}).map(i=>({...i,watched:watched.has(i.id)})),selectedInstrumentId:terminalData.selectedInstrumentId||identity.instrument.id,selectedMindId:terminalData.selectedMindId||identity.profileId,recordView:currentRoute().params.get('tab')||'decisions',status:terminalLoading?'loading':terminalError||!ready?'error':'ready',error:terminalError||readiness?.marketRecovery?.issue?.message||(!ready?({CONNECT_REQUIRED:'주식 시세를 조회할 증권사 연결을 설정하세요.',UNSUPPORTED_TIMEFRAME:'이 종목이 지원하는 캔들 주기를 선택하세요.'})[terminalData.status]||terminalData.error:'')||'',statusMessage:warnings.includes('END_OF_DAY_REFERENCE')?'거래일 일봉 · 종가 참고 자료':warnings.includes('STALE_CLOSED_CANDLE')?'최근 확정 봉 수집 지연':'',busy,canRun:!busy&&!runRequirement&&(terminalData.canRun||replay&&byId(workspace.comparisons,identity.comparisonId)?.status==='running'),runLabel:identity.comparisonId?'다음 봉 실행':identity.profileId==='all'?'마인드 선택 후 실행':profileName(identity.profileId)+' 결정 실행',runTarget:identity.instrument.symbol+' · '+(identity.profileId==='all'?'전체 마인드':profileName(identity.profileId))+' · '+({'1h':'확정 1시간봉','4h':'확정 4시간봉','1d':'확정 일봉'})[identity.timeframe]+' · '+accountTarget,experimentLabel:identity.instrument.symbol+' · '+(identity.profileId==='all'?'전체 마인드':profileName(identity.profileId)),scopes:[{id:'live',label:'최근 확정 봉'},...(identity.mode==='replay'&&!identity.comparisonId?[{id:'replay',label:'저장된 재생 · 최근'}]:[]),...(identity.instrument.id==='crypto:okx:BTC-USDT'?list(workspace?.comparisons).filter(g=>g.experimentType==='HISTORICAL_FUNCTIONAL_REPLAY').map(g=>({id:g.id,label:g.name})):[])],selectedScope:identity.comparisonId||identity.mode};}
    const {instrument,timeframe,profileId,comparisonId}=selectedIdentity(),data=terminalData||{},market=data.market||data,group=byId(workspace?.comparisons,comparisonId),actualInstruments=terminalDisplayInstruments(list(data.instruments).length?data.instruments:instruments,{metadata:instrumentMetadata,watchedIds:[...watched],selectedInstrument:instrument});
    const selectedQuote=market.quote||data.quote,bars=list(data.bars).length?data.bars:list(market.bars),records=[];
    const summaries=list(data.mindSummaries),positions=list(data.positions);
    return {instruments:actualInstruments.map(i=>({...i,watched:watched.has(i.id),...(i.id===instrument.id?{price:selectedQuote?.price,asOf:selectedQuote?.asOf,status:market.status==='CONNECT_REQUIRED'?'unconfigured':terminalError?'error':'ready'}:{})})),selectedInstrumentId:instrument.id,selectedMindId:profileId,profiles:list(workspace?.investmentProfiles).map(p=>({...p,name:profileName(p.id)})),bars,decisions:records,legacyInstrumentId:'crypto:okx:BTC-USDT',timeframe,source:data.source?.provider||market.source?.provider||instrument.provider,sourceLabel:data.source?.provider||market.source?.provider||instrument.venue,supportedTimeframes:instrument.timeframes,status:terminalLoading?'loading':terminalError||market.status==='ERROR'?'error':'ready',error:terminalError||market.message||({CONNECT_REQUIRED:'주식 일봉을 조회할 증권사 시세 연결을 설정하세요.',UNSUPPORTED_TIMEFRAME:'이 종목이 지원하는 캔들 주기를 선택하세요.'})[market.status]||'',asOf:data.asOf||null,instrumentsAsOf:data.instrumentsAsOf||selectedQuote?.asOf,positions,mindSummaries:summaries,knowledge:[],recordView:currentRoute().params.get('tab')||'decisions',canRun:false,busy,runLabel:group?'다음 봉 실행':'결정 실행',experimentLabel:group?group.name:'종목별 저장 기록',dataModeLabel:group?'과거 기능 재생':'확정 봉 시세',statusMessage:list(market.warnings).map(v=>({END_OF_DAY_REFERENCE:'주식 종가 참고 자료',SESSION_CALENDAR_UNVERIFIED:'거래소 휴장일 검토 필요',KIS_READONLY_CONNECTION_REQUIRED:'증권사 시세 연결 필요',STALE_CLOSED_CANDLE:'최근 확정 봉 지연'})[v]).filter(Boolean).join(' · ')};
  }
  function render(routeValue=currentRoute()){
    route=routeValue;
    if(!workspace){
      const capabilityView=route.page==='settings'&&route.params.get('view')==='capabilities';
      const workspaceHeading=loading?'워크스페이스를 불러오는 중…':'워크스페이스 연결';
      const heading=capabilityView?title('기능 목록',CAPABILITY_GUIDE):`<h1>${workspaceHeading}</h1>`;
      return `<section class="studio-loading">${heading}${error?`<p role="alert">${esc(error)}</p>${button('다시 조회','refresh')}`:'<p>서버에 저장된 종목·마인드·투자 기록을 조회합니다.</p>'}</section>`;
    }
    const notice=error?`<div class="callout warning section" role="alert">${esc(error)} ${button('새로고침','refresh')}</div>`:'';
    const trade=()=>{const view=model();return renderFirstDecision(view)+terminal.render({...view,instrumentUniverse:terminalUniverseModel()});};
    return notice+({home:()=>home.render(),trade,minds:renderMinds,calendar:calendar.render,library:renderLibrary,settings:renderSettings}[routeValue.page]||trade)();
  }
  function renderFirstDecision(view){
    const current=currentRoute();
    if(!firstPaperDecision(current))return '';
    const selected=view.selectedMindId,close=studioRouteHash(current,'trade',{firstDecision:null});
    let message,actions='';
    if(selected==='all'){
      message='BTC-USDT 4시간봉에서 국면 추세 프리셋으로 연습합니다. 이 프리셋은 JEV 키 없이 계산합니다.';
      const published=list(mindData?.minds).filter(mind=>byId(workspace.investmentProfiles,mind.id)?.status!=='ARCHIVED'&&
        mind.manifest?.data.strategyPlan?.status==='APPROVED'&&firstDecisionPlan(mind.manifest.data.strategyPlan));
      const pending=list(mindData?.documents).find(item=>{
        const doc=item.document,profile=byId(workspace.investmentProfiles,doc?.scope?.profileId);
        return profile&&profile.status!=='ARCHIVED'&&item.status==='DRAFT'&&doc.kind==='mind-policy'&&
          doc.data.version>(savedMind(profile.id)?.manifest?.data.version??0)&&firstDecisionPlan(doc.data.strategyPlan);
      });
      actions=!mindData?button('마인드 목록 다시 조회','refresh','','','primary'):
        published.length?published.map(mind=>'<a class="button primary" href="'+esc(studioRouteHash(current,'trade',{profileId:mind.id,instrumentId:PAPER_DECISION_INSTRUMENT,timeframe:PAPER_DECISION_TIMEFRAME}))+'" data-studio-route>'+esc(profileName(mind.id))+'로 시작</a>').join(''):
        pending?button('저장한 전략 초안 검토','document-detail',pending.id,'data-first-decision-review','primary'):
        button('국면 추세 마인드 만들기','profile-new','','','primary');
      actions+='<a class="button" href="'+PAPER_PRACTICE_ENTRY+'" data-studio-route>과거 시세로 연습</a>';
    }else{
      const readiness=view.terminalReadiness?.executionReadiness,step=terminalRunRequirement(view)?.action?.action??readiness?.primaryAction?.action;
      message=readiness?.canRun?'결정 실행을 누르면 판단 근거와 모의 체결 상태를 확인할 수 있습니다.':
        step==='account'?'종목의 결제 통화로 모의 자금을 배정하세요. 처음 설정한 원화 예산은 별도로 보관됩니다.':
        step==='data'?'시세를 수집한 뒤 트레이딩으로 돌아오면 같은 마인드에서 판단을 계속할 수 있습니다.':
        step==='records'?'저장된 결정 보기에서 현재 봉의 판단과 근거를 다시 확인할 수 있습니다.'+
          (list(readiness?.blockers).some(blocker=>blocker.code==='CANDLE_ALREADY_EVALUATED')?' 다음 모의 판단에는 새로 확정된 시세가 필요합니다.':''):
        '아래 트레이딩 화면에서 현재 준비 상태와 다음 행동을 확인하세요.';
      actions='<a class="button" href="'+PAPER_DECISION_ENTRY+'" data-studio-route>마인드 다시 고르기</a>';
    }
    return '<section class="studio-sheet spaced" aria-labelledby="first-paper-decision"><div class="studio-sheet-head"><h2 id="first-paper-decision" tabindex="-1">첫 모의 판단</h2><a href="'+esc(close)+'" data-studio-route>안내 닫기</a></div><div class="studio-sheet-body"><p>'+esc(message)+'</p><div class="actions spaced">'+actions+'</div></div></section>';
  }
  function mindContext(){const id=currentRoute().params.get('profileId')||'all',profile=byId(workspace.investmentProfiles,id),manifest=savedMind(id)?.manifest,version=profileVersion(profile?.currentVersionId);return {id,profile,manifest,policy:manifest?.data,settings:manifest?.data.profileSettings||version?.settings,version,memory:byId(workspace.memoryVersions,profile?.currentMemoryVersionId)};}
  function mindHeading(label,actions='',secondary=''){
    const {id,profile}=mindContext(),name=id==='all'?'전체 마인드':profile?profileName(id):'마인드 확인';
    const customize=profile&&['개요','운용','원칙','전략'].includes(label)?button('캐릭터 꾸미기','mind-customize',id):'';
    const menu=secondary+customize?renderActionMenu({id:'mind-page-actions',label:'마인드 작업',content:secondary+customize}):'';
    const headingTag=id!=='all'&&profile?'h2':'h1',heading=id==='all'?'전체 '+label:profile?label:name;
    return '<div class="studio-page-head" data-mind-management data-profile-id="'+esc(id)+'"><'+headingTag+' tabindex="-1" title="'+esc(heading)+'">'+esc(heading)+'</'+headingTag+'><div class="actions">'+actions+menu+'</div></div>';
  }
  function selectMindRequired(label){return mindHeading(label)+'<section class="studio-sheet"><div class="studio-empty-state"><h2>마인드를 선택하세요.</h2>'+profilePicker('all')+'<p>선택한 마인드의 '+esc(label)+'을 확인합니다.</p></div></section>';}
  function renderMinds(){if(currentRoute().params.get('view')==='motions')return renderLifeGallery();const view=currentRoute().params.get('view')||'overview';if(view==='records')return renderRecords();if(view==='operations')return renderMindOperations();if(view==='simulations')return '<section data-simulation-execution-mode="paper" aria-label="모의 실험실"><p class="tiny muted">모의 실험</p>'+simulations.render()+'</section>';if(view==='principles')return renderMindPrinciples();if(view==='knowledge')return renderConnectedKnowledge();return renderMindOverview();}
  function renderMindOverview(){
    const {id,profile,policy,settings,version}=mindContext();
    if(id==='all'){
      const executionMode=executionModeOf(currentRoute()),paperRead=eventPaperBatch.state(),paperScope=executionMode==='paper'&&subscriptionMindId==='all',archivedView=currentRoute().params.get('mindStatus')==='archived',profiles=list(workspace.investmentProfiles).filter(p=>(p.status==='ARCHIVED')===archivedView),ids=new Set(profiles.map(p=>p.id)),scopedWorkspace={...workspace,investmentProfiles:profiles},view=buildMindCompanions({paperActivities:eventPaperBatch.items(),workspace:scopedWorkspace,valuations:companionValuations,minds:workspaceMindCatalog(workspace,mindData).filter(m=>ids.has(m.id)),subscriptions:paperScope&&subscriptionData?.revision===workspace.revision?list(subscriptionData.subscriptions):undefined,liveActivities:liveActivity.items(),executionMode,asOf:new Date().toISOString()});
      view.cards=view.cards.map(card=>({...card,automaticScopeSupported:!automaticScopeIssue(savedMind(card.profileId)?.manifest),strategyScope:savedMind(card.profileId)?.manifest?.data?.strategyPlan?.scope?.universe,eventStream:!!card.paperActivity||!!card.liveActivity||isEventAutomationMind(savedMind(card.profileId)?.manifest),...(executionMode==='paper'?{paperActivity:card.paperActivity??paperMindActivity(paperActivity.workspace(),card.profileId,{asOf:new Date().toISOString(),valuations:companionValuations}).items[0]??null}:{})}));
      if(archivedView)view.cards=view.cards.map(card=>({...card,archived:true,label:'보관됨',phase:'sleep'}));
      return title('마인드',button('마인드 추가','profile-new','','','primary')+renderActionMenu({id:'mind-collection-actions',label:'마인드 작업',content:button('정책 가져오기','document-new','mind-policy')}))+'<div class="studio-local-tabs" aria-label="마인드 목록">'+button('마인드','mind-status','active','aria-pressed="'+!archivedView+'"')+button('보관함','mind-status','archived','aria-pressed="'+archivedView+'"')+'</div>'+(executionMode==='paper'&&paperRead.loading?'<p class="mind-companion-scope" role="status">분봉 모의 원장을 조회하는 중…</p>':'')+renderMindCompanions({...view,archivedView,historyOpen:companionHistoryOpenGroups[archivedView?'archived':'active'],activityReady:!!liveActivity.state().data,loading:executionMode==='live'?false:paperScope&&subscriptionLoading,error:executionMode==='live'?liveActivity.state().error:[paperScope?subscriptionError:'',paperRead.error].filter(Boolean).join(' '),valuationLoading:companionValuationLoading,valuationError:companionValuationError});
    }
    return renderMindOperations();
  }
  function renderMindUniverse(policy,id){
    const all=list(policy?.universe?.instrumentIds),params=currentRoute().params,query=params.get('universeSearch')||'',items=all.map(value=>instruments.find(i=>i.id===value)||getInstrument(value)).filter(i=>[i.symbol,i.name,i.venue,i.quoteCurrency].join(' ').toLowerCase().includes(query.toLowerCase())),pages=Math.max(1,Math.ceil(items.length/20)),page=Math.min(pages-1,Math.max(0,Number(params.get('universePage'))||0));
    return '<section class="studio-sheet spaced"><div class="studio-sheet-head"><h2>투자 범위</h2>'+button('범위 편집','universe-edit',id)+'</div><div class="studio-sheet-body">'+universePolicySummary(policy?.universe)+'<form data-universe-search><label class="field">종목 검색<input name="query" value="'+esc(query)+'" placeholder="종목명·거래소·통화"></label><button type="submit" class="button small">검색</button></form></div>'+table(['종목','거래소','통화',''],items.slice(page*20,page*20+20).map(i=>[esc(i.symbol+' · '+i.name),esc(i.venue),esc(i.quoteCurrency),experimentScope(savedMind(id)?.manifest)?button(isEventAutomationMind(savedMind(id)?.manifest)&&executionModeOf(currentRoute())==='live'?'자동 운용 설정':'실험실 열기',isEventAutomationMind(savedMind(id)?.manifest)&&executionModeOf(currentRoute())==='live'?'mind-automation':'mind-lab',id):button('트레이딩','mind-instrument',i.id)]),'검색 조건에 맞는 종목이 없습니다.')+'<div class="studio-sheet-body actions">'+button('이전','universe-page',String(page-1),page===0?'disabled':'')+'<span>'+ (page+1)+' / '+pages+'쪽 · '+items.length+'개 종목</span>'+button('다음','universe-page',String(page+1),page>=pages-1?'disabled':'')+'</div></section>';
  }
  function renderMindOperations(){
    const {id,profile}=mindContext();if(!profile)return selectMindRequired('운용');
    if(eventPaper.handles())return eventPaper.render();
    if(executionModeOf(currentRoute())==='live'){
      const item=liveActivity.get(id),read=liveActivity.state();
      if(item===undefined||!item&&read.error)return '<div data-live-read-state tabindex="-1">'+renderMindActivityHero(null,{profileId:id,executionMode:'live',avatarConfig:readMindAppearance(workspace,id).config,idPrefix:'live-read-'+id,loading:!read.error,unavailable:Boolean(read.error),statusDetails:read.error?'<p class="mind-operation-read-error" role="alert">'+esc(read.error)+'</p>':'',controls:read.error?button('다시 조회','live-activity-refresh'):''})+'</div>';
      if(item||isEventAutomationMind(savedMind(id)?.manifest))return automatedTrading.render();
      return '<section class="mind-operation-preparation"><div><h2>운용 준비</h2><p>전략과 투자 범위를 확인하고 운용할 계좌를 연결하세요.</p><div class="actions"><a class="button small" href="#settings?view=accounts&amp;executionMode=live" data-studio-route>계좌 관리</a></div></div>'+renderMindHud({profileId:id,executionMode:'live',phase:'sleep',appearance:readMindAppearance(workspace,id),game:{motion:'rest',weather:'unknown'}},{variant:'operation'})+'</section>';
    }
    const activities=paperMindActivity(paperActivity.workspace(),id,{asOf:new Date().toISOString(),valuations:companionValuations}).items,activity=activities[0]??null,companion=buildMindCompanions({paperActivities:eventPaperBatch.items(),workspace,minds:workspaceMindCatalog(workspace,mindData),subscriptions:subscriptionData?.revision===workspace.revision?list(subscriptionData.subscriptions):undefined,valuations:companionValuations,executionMode:'paper',asOf:new Date().toISOString()}).cards.find(card=>card.profileId===id);
    if(activity){activity.status=companion?.automation?.requiresAttention?'ACTION_REQUIRED':companion?.automation?.enabled?'ENABLED':companion?.automation?.paused?'PAUSED':'PREPARED';}
    const controls=renderMindAutomationEntry({...companion,profileId:id,name:profileName(id),executionMode:'paper',automaticScopeSupported:!automaticScopeIssue(savedMind(id)?.manifest),strategyScope:savedMind(id)?.manifest?.data.strategyPlan?.scope?.universe,eventStream:isEventAutomationMind(savedMind(id)?.manifest)},{className:'button primary'})+button('운용 금액 수정','paper-capital',id);
    const accountDetails='<section class="studio-sheet"><div class="studio-sheet-head"><h2>계좌 상세</h2></div>'+table(['통화','원금','현금','평가자산','누적 수수료','평가 기준'],activities.map(item=>{const ledger=item.ledger,c=item.quoteCurrency;return [esc(c),money(ledger.initialCapital==null?null:Number(ledger.initialCapital),c),money(ledger.cash==null?null:Number(ledger.cash),c),money(ledger.equity==null?null:Number(ledger.equity),c),money(ledger.feesPaid==null?null:Number(ledger.feesPaid),c),esc(when(ledger.valuationAsOf))];}),'모의 자금을 설정하면 잔고를 확인할 수 있어요.')+'</section>';
    const management=mindDisclosure('paper-management','운용 설정 · 계좌 상세',accountDetails+(isEventAutomationMind(savedMind(id)?.manifest)?'':renderMindSubscriptions()),' data-paper-management');
    return (activities.length?activities:[null]).map((item,index)=>'<div class="mind-operation-layout"><div class="mind-operation-primary">'+renderMindActivityHero(item,{profileId:id,idPrefix:'paper-operation-'+id+'-'+index,controls:index===0?controls:'',avatarConfig:readMindAppearance(workspace,id).config})+'</div>'+renderMindActivityFeed(item,{profileId:id,executionMode:'paper',showRuntimeNotice:false})+'</div>').join('')+management;
  }

  function openProfileLifecycle(profileId,restore){
    const profile=byId(workspace?.investmentProfiles,profileId);if(!profile)throw new Error('마인드를 다시 선택하세요.');
    if((profile.status==='ARCHIVED')!==restore)throw new Error('마인드의 현재 보관 상태를 새로고침하세요.');
    const activeModes=[['live',liveActivity.items()],['paper',eventPaperBatch.items()]].filter(([,items])=>list(items).some(item=>item.profileId===profileId&&item.status==='ENABLED')).map(([mode])=>mode);
    if(!restore&&activeModes.length)return hooks.open?.('운용을 먼저 중지하세요',row('마인드',esc(profileName(profileId)))+'<p>운용을 먼저 중지하고 보유 자산·미확정 주문·판단 응답을 확인한 뒤 보관하세요.</p>',activeModes.map(mode=>'<a class="button primary" href="'+esc(studioRouteHash(currentRoute(),'minds',{profileId,view:'operations',executionMode:mode}))+'" data-studio-route>'+esc(mode==='live'?'실전 운용 열기':'분봉 모의운용 열기')+'</a>').join(''));
    form(restore?'마인드 복구':'마인드 보관','profile-lifecycle','<div class="full">'+row('마인드',esc(profileName(profileId)))+'<p>'+(restore?'마인드 목록으로 복구합니다. 자동 모의 운용은 시작 버튼에서 다시 켤 수 있습니다.':'보관하기 전에 운용을 중지하고 보유 자산·미확정 주문·판단 응답을 확인하세요. 정책·계좌·거래·실험 기록을 함께 보관합니다.')+'</p></div><input type="hidden" name="operation" value="'+(restore?'restore':'archive')+'">',profileId,restore?'복구':'보관');
  }
  function openMindLab(id){const profileId=id||currentRoute().params.get('profileId');if(!savedMind(profileId))throw new Error('마인드를 선택하세요.');return hooks.navigate?.('minds',{profileId,view:'simulations',lab:'compare',labStep:'strategy',labView:null,draftId:null,a:null,b:null,simulationId:null,comparisonId:null,comparisonA:null,comparisonB:null,tab:null,cursor:null});}
  function openMindTrading(id){const selectedId=id||currentRoute().params.get('profileId');if(experimentScope(savedMind(selectedId)?.manifest))return isEventAutomationMind(savedMind(selectedId)?.manifest)&&executionModeOf(currentRoute())==='live'?enterMindAutomation(selectedId):openMindLab(selectedId);const profileId=selectedId,manifest=savedMind(profileId)?.manifest,back=currentRoute().params.get('returnTo'),previous=back?.startsWith('#trade')?parseStudioRoute(back):null,previousInstrument=previous?mindInstrument(profileId,previous.params.get('instrumentId')):null;if(previousInstrument&&previousInstrument.id===previous?.params.get('instrumentId')&&list(manifest?.data.universe.instrumentIds).includes(previousInstrument.id))return hooks.navigate?.('trade',{...Object.fromEntries(previous.params),profileId,executionMode:executionModeOf(currentRoute())});const instrument=mindInstrument(profileId);if(!instrument)throw new Error('투자 범위의 종목을 확인하세요.');return hooks.navigate?.('trade',{profileId,instrumentId:instrument.id,timeframe:manifest?.data.strategyPlan?.scope?.timeframe||instrument.defaultTimeframe,mode:'live',comparisonId:null});}
  async function enterMindAutomation(mindId){
    if(!mindId||mindId==='all'||!savedMind(mindId))throw new Error('운용할 마인드를 선택하세요.');
    if(byId(workspace?.investmentProfiles,mindId)?.status==='ARCHIVED')throw new Error('보관함에서 마인드를 복구한 뒤 운용을 설정하세요.');
    if(executionModeOf(currentRoute())==='paper'&&(isEventPaperMind(savedMind(mindId)?.manifest)||eventPaper.handles())){
      if(currentRoute().page==='minds'&&currentRoute().params.get('profileId')===mindId&&['overview','operations'].includes(currentRoute().params.get('view')||'overview')){await eventPaper.load({force:true});return eventPaper.openSettings();}
      return hooks.navigate?.('minds',{profileId:mindId,view:'operations',executionMode:'paper'});
    }
    if(isEventAutomationMind(savedMind(mindId)?.manifest)||executionModeOf(currentRoute())==='live'&&liveActivity.get(mindId)){
      if(executionModeOf(currentRoute())!=='live')return openMindLab(mindId);
      if(currentRoute().page==='minds'&&currentRoute().params.get('profileId')===mindId&&['overview','operations'].includes(currentRoute().params.get('view')||'overview')){await Promise.all([automatedTrading.load({force:true}),loadLiveActivity({force:true})]);return automatedTrading.openSettings();}
      liveAutomationIntent={mindId};return hooks.navigate?.('minds',{profileId:mindId,view:'operations',executionMode:'live'});
    }
    if(executionModeOf(currentRoute())==='live')return hooks.navigate?.('settings',{view:'accounts',executionMode:'live'});
    if(busy)return;
    if(automaticScopeIssue(savedMind(mindId)?.manifest))return openMindTrading(mindId);
    automationIntent={mindId};
    if(currentRoute().page==='minds'&&currentRoute().params.get('view')==='operations'&&currentRoute().params.get('profileId')===mindId){await loadMindSubscriptions({force:true});completeAutomationEntry();return;}
    hooks.navigate?.('minds',{profileId:mindId,view:'operations',executionMode:'paper',cursor:null,knowledgePage:null});
  }
  function completeAutomationEntry(){
    const intent=automationIntent,r=currentRoute();if(!intent||r.page!=='minds'||r.params.get('view')!=='operations'||r.params.get('profileId')!==intent.mindId||executionModeOf(r)!=='paper'||subscriptionLoading)return;
    automationIntent=null;automationFocus=intent.mindId;
    if(subscriptionMindId!==intent.mindId||subscriptionError||!subscriptionData){redraw();return;}
    const data=subscriptionData,subscriptions=list(data.subscriptions),active=subscriptions.find(s=>s.enabled||s.status==='ACTION_REQUIRED'),paused=subscriptions.find(s=>!s.enabled&&s.canEnable!==false);
    if(!active&&paused){automationFocus=null;openSubscriptionEnable(paused.id);return;}
    if(subscriptions.length){redraw();return;}
    if(!subscriptions.length&&data.currentPublishedPolicy?.manifestId&&list(data.cohortPolicies).length&&list(data.budgetPolicies).length){automationFocus=null;openSubscriptionCreate();return;}
    hooks.open?.('운용 준비',subscriptionResolutionMarkup(data.createBlockedReasons,intent.mindId)+'<div class="actions">'+button('노드 설정','strategy-graph',intent.mindId)+button('모의 자금 설정','subscription-account',intent.mindId)+'</div>');redraw();
  }
  function mindSubscriptionScope(value=currentRoute()){
    if(!workspace||executionModeOf(value)==='live')return '';
    const mindId=value.params.get('profileId')||'all',view=value.params.get('view');if(['overview','operations'].includes(view)&&isEventAutomationMind(savedMind(mindId)?.manifest))return '';
    if(value.page==='settings'&&view==='automation'||value.page==='minds'&&view==='overview'&&mindId==='all')return 'all';
    return value.page==='minds'&&['overview','operations'].includes(view)&&mindId!=='all'?mindId:'';
  }
  function clearMindSubscriptions(){
    const changed=!!subscriptionMindId||subscriptionLoading||!!subscriptionError||subscriptionData!==null;
    subscriptionAbort?.abort();subscriptionAbort=null;subscriptionGeneration++;subscriptionMindId='';subscriptionData=null;subscriptionLoading=false;subscriptionError='';paperAdaptations.clear();if(changed)redraw();
  }
  async function loadMindSubscriptions({force=false,quiet=false}={}){
    const mindId=mindSubscriptionScope();if(!mindId){clearMindSubscriptions();return;}
    if(!force&&subscriptionMindId===mindId)return;
    subscriptionAbort?.abort();subscriptionAbort=new AbortController();const token=++subscriptionGeneration,previous=JSON.stringify(subscriptionData),sameScope=subscriptionMindId===mindId;subscriptionMindId=mindId;
    if(!quiet||!sameScope){subscriptionLoading=true;subscriptionData=null;subscriptionError='';redraw();}
    try{
      const value=await request('/api/workspace/mind-subscriptions?'+new URLSearchParams({mindId}),undefined,{signal:subscriptionAbort.signal});
      if(token!==subscriptionGeneration)return;const hadError=!!subscriptionError;subscriptionData=value;subscriptionError='';subscriptionLoading=false;if(!quiet||hadError||JSON.stringify(value)!==previous)redraw();
      if(mindId!=='all')await loadPaperAdaptations(value.subscriptions,token);
    }catch(problem){if(token!==subscriptionGeneration||problem.name==='AbortError')return;subscriptionLoading=false;subscriptionError=problem.message;redraw();}
  }
  async function loadPaperAdaptations(subscriptions,token=subscriptionGeneration){
    await Promise.allSettled(list(subscriptions).map(async subscription=>{
      try{const value=await request('/api/workspace/paper-adaptation?'+new URLSearchParams({subscriptionId:subscription.id}),undefined,{signal:subscriptionAbort?.signal});if(disposed||token!==subscriptionGeneration||value.revision!==workspace?.revision)return;const previous=paperAdaptations.get(subscription.id);paperAdaptations.set(subscription.id,value);if(JSON.stringify(previous)!==JSON.stringify(value))redraw();}
      catch(problem){if(disposed||token!==subscriptionGeneration||problem.name==='AbortError')return;paperAdaptations.delete(subscription.id);}
    }));
  }
  const paperAdaptationHelp='종료 거래 4건 학습·2건 검증으로 최대 10%p 범위의 후보 비중을 찾습니다. 후보는 원 전략과 같은 기간·시세·자금으로 각각 모의 판단과 체결을 수행합니다. 양쪽 종료 거래가 6건 이상이고 보유가 모두 청산되었을 때 수익률 개선과 최대 낙폭을 비교해 반영합니다. 비교는 최대 180개 4시간봉 동안 진행합니다.';
  function paperAdaptationStatus(value){return ({WAITING_EPISODES:'종료 거래 대기',KEEP_CURRENT:'현재 비중 유지',HOLDOUT_REJECTED:'검증 후 현재 비중 유지',REVIEW_REQUIRED:'후보 비중 검토 대기',FORWARD_RUNNING:'후보 병렬 비교 중',FORWARD_REJECTED:'원 전략 유지',FORWARD_INTERRUPTED:'비교 기록 확인 필요',APPLIED:'새 비중 적용 예약',POLICY_CHANGED:'정책 변경 · 설정 확인',DISABLED:'사용 안 함'})[value]||'비교 준비';}
  const activePaperTrial=value=>['WAITING_START','RUNNING','READY_TO_PROMOTE'].includes(value?.status);
  function paperTrialStatus(value){return ({WAITING_START:'다음 확정 봉부터 비교',RUNNING:'후보 병렬 비교 중',READY_TO_PROMOTE:'비교 통과 · 반영 대기',KEEP_BASELINE:'원 전략 유지',INTERRUPTED:'비교 기록 확인 필요',PROMOTED:'후보 비중 반영'})[value]||'비교 상태 확인';}
  function paperTrialMarkup(trial,settings){
    if(!trial)return '';
    const a=trial.arms?.baseline,b=trial.arms?.candidate;if(!a||!b)return '<section class="full spaced" role="status">비교 계좌를 다시 조회하세요.</section>';
    const reason=({FORWARD_COMPARISON_PASSED:'같은 기간 수익률과 최대 낙폭 검증을 통과했습니다.',FORWARD_COMPARISON_NOT_IMPROVED:'비교 결과에 따라 원 전략을 유지합니다.',TRIAL_ENDED_INSUFFICIENT_EPISODES:'비교 기간이 종료되어 원 전략을 유지합니다.',TRIAL_ENDED_OPEN_POSITIONS:'비교 종료 시 보유 포지션이 있어 원 전략을 유지합니다.',PREVIOUS_FRAME_REQUIRES_REVIEW:'이전 봉의 비교 기록을 확인하세요.',MISSED_FORWARD_CANDLE:'비교 기간의 시세와 처리 기록을 확인하세요.'})[trial.reason]??(trial.status==='INTERRUPTED'?'비교 실행 기록을 확인하세요.':'');
    const paused=activePaperTrial(trial)&&(!settings?.enabled||!settings?.autoApply);
    return '<section class="full spaced" data-paper-forward-trial="'+esc(trial.id)+'"><h3>기준·후보 비교</h3>'+row('진행',esc(paused?'후보 비교 일시중지':paperTrialStatus(trial.status))+' · '+num(trial.completedBars,0)+' / '+num(trial.maxBars,0)+'봉')+row('비교 기간',esc(when(trial.startAt))+' → '+esc(when(trial.endsAt)))+(activePaperTrial(trial)&&!paused&&trial.nextDueAt?row('다음 처리 가능',esc(when(trial.nextDueAt))):'')+table(['','기준 전략','후보 전략'],[['초기 자금',num(a.initialCash)+' USDT',num(b.initialCash)+' USDT'],['평가자산',num(a.equity)+' USDT',num(b.equity)+' USDT'],['수익률',pct(a.netReturn),pct(b.netReturn)],['최대 낙폭',pct(a.maxDrawdown),pct(b.maxDrawdown)],['종료 거래',num(a.closedEpisodes,0)+' / '+num(trial.minimumClosedEpisodes,0)+'건',num(b.closedEpisodes,0)+' / '+num(trial.minimumClosedEpisodes,0)+'건'],['보유 종목',num(a.openPositions,0)+'개',num(b.openPositions,0)+'개'],['평가 시각',esc(when(a.asOf)),esc(when(b.asOf))]],'비교 결과를 기다립니다.')+(reason?'<p class="tiny spaced" role="status">'+esc(reason)+'</p>':'')+helpLabel('반영 조건','같은 기간의 후보 수익률 개선 폭이 '+percentagePoints(trial.promotion?.minReturnImprovement)+'를 초과하고 최대 낙폭이 증가하지 않아야 합니다. 양쪽 계좌의 보유가 모두 청산된 상태에서 적용합니다.')+'</section>';
  }
  function paperAdaptationMarkup(subscription){
    const value=paperAdaptations.get(subscription.id);if(value?.eligibility?.eligible!==true)return '';
    const settings=value.settings,trial=value.trial,count=value.intake?.count??0,minimum=value.intake?.minimumEpisodes??6,enabled=settings?.enabled===true;
    const interrupted=trial?.status==='INTERRUPTED',recoveryReason=interrupted&&trial.recovery?.canRestart!==true?({ORIGINAL_POLICY_CHANGED:'원 전략과 현재 운용 정책을 확인하세요.',ENABLE_AUTOMATIC_COMPARISON:'자동 모의 운용과 학습의 자동 반영을 켜세요.',CANDIDATE_LIMIT_CHANGED:'학습 설정에서 이 후보의 변경 폭을 허용해 주세요.'})[trial.recovery?.reason]||'재시작 가능 여부를 다시 조회하세요.':null;
    const comparison=settings?.lastResult&&settings.lastResult.status!=='WAITING_EPISODES'&&(trial||settings.lastEvidence)?settings.lastResult:null;
    const controls=interrupted?'<div class="actions spaced">'+button('비교 다시 시작','paper-adaptation-restart',subscription.id,busy||trial.recovery?.canRestart!==true?'disabled':'')+'</div>'+(recoveryReason?'<p class="tiny spaced" role="status">'+esc(recoveryReason)+'</p>':''):enabled&&!activePaperTrial(trial)?'<div class="actions spaced">'+button('비중 비교','paper-adaptation-step',subscription.id,busy||count<minimum?'disabled':'')+'</div>':'';
    return '<section class="spaced" data-paper-adaptation="'+esc(subscription.id)+'"><div class="studio-sheet-head"><h4>'+helpLabel('비중 학습',paperAdaptationHelp)+'</h4>'+button('학습 설정','paper-adaptation-configure',subscription.id,busy?'disabled':'')+'</div>'+row('진행',enabled?(trial?esc(activePaperTrial(trial)&&!settings.autoApply?'후보 비교 일시중지':paperTrialStatus(trial.status))+' · '+num(trial.completedBars,0)+' / '+num(trial.maxBars,0)+'봉':'종료 거래 '+num(count,0)+' / '+num(minimum,0)+'건 · '+esc(paperAdaptationStatus(settings.status))):'사용 안 함')+(enabled?row('반영 방식',settings.autoApply?'병렬 비교 통과 후 자동 반영 · 최대 '+percentagePoints(settings.maxWeightStep):'후보 비중 검토'):'')+(comparison?row('후보 비중',esc(when(comparison.asOf))+' · JEV '+pct(comparison.currentWeight)+' → '+pct(comparison.selectedWeight)):'')+controls+'</section>';
  }
  function openPaperAdaptation(id){
    const value=paperAdaptations.get(id);if(value?.eligibility?.eligible!==true||!byId(subscriptionData?.subscriptions,id))throw new Error('학습할 모의 운용의 고정 전략을 다시 조회하세요.');
    const settings=value.settings;
    form('비중 학습 설정','paper-adaptation',paperTrialMarkup(value.trial,settings)+'<div class="full">'+helpLabel('종료 거래로 비중 비교',paperAdaptationHelp)+'</div>'+select('학습','enabled',[['false','사용 안 함'],['true','사용함']],String(settings?.enabled??false))+select('결과 반영','autoApply',[['false','후보 비중 검토'],['true','병렬 비교 통과 후 자동 반영']],String(settings?.autoApply??false))+field('한 번에 변경할 최대 비중 (%p)','maxWeightStep',(settings?.maxWeightStep??.1)*100,'number','min="1" max="10" step="1"'+(activePaperTrial(value.trial)?' readonly':'')),id,'학습 설정 저장');
  }
  function restartablePaperTrial(id){const value=paperAdaptations.get(id),subscription=byId(subscriptionData?.subscriptions,id);return value?.trial?.status==='INTERRUPTED'&&value.trial.recovery?.canRestart===true&&subscriptionMindId===currentRoute().params.get('profileId')&&subscription?.profileId===subscriptionMindId?value.trial:null;}
  function openPaperAdaptationRestart(id){
    const trial=restartablePaperTrial(id);if(!trial)throw new Error('현재 비교 상태와 자동 운용 설정을 다시 확인하세요.');
    form('비교 다시 시작','paper-adaptation-restart','<div class="full">'+row('마인드',esc(profileName(subscriptionMindId)))+row('중단된 비교',esc(when(trial.asOf)))+'<p class="spaced">중단된 비교 기록을 보존하고, 두 전략에 같은 시작 자금을 배정한 새 모의 계좌를 만듭니다. 다음 미래 확정 봉부터 두 전략을 다시 비교합니다.</p><p class="tiny spaced">새 비교의 판단에는 설정된 JEV 호출 한도를 사용합니다.</p></div><input type="hidden" name="trialId" value="'+esc(trial.id)+'"><label class="field full"><span><input type="checkbox" name="confirmed" value="true" required> 새 비교 계좌로 다음 확정 봉부터 시작합니다.</span></label>',id,'다음 봉부터 다시 시작');
  }
  function subscriptionStateLabel(value){return ({CAMPAIGN_EXITING:'운용 종료 · 청산 중',CAMPAIGN_COMPLETED:'운용 종료 완료',EXECUTION_RETRY_REQUIRED:'체결 재시도 대기',PAUSED:'일시중지',ENABLED:'자동 실행 허용',WAITING_BAR:'다음 확정 봉 대기',WAITING_TIME:'실행 가능 시각 대기',WAITING_DATA:'확정 시세 대기',RETRY_WAIT:'재시도 대기',ACTION_REQUIRED:'호출 확인 필요 · 자동 실행 중단',RUNNING:'처리 중',EXECUTING:'모의 실행 중',EVALUATING:'JEV 실행 중',COMPUTING:'전략 계산 중',LOCAL_COMPUTATION_INTERRUPTED:'계산 중단',JEV_STARTED:'JEV 요청 후 응답 대기',DECISION_COMPLETED:'결정 저장됨',OBSERVATION_SCHEDULED:'후속 관측 예약됨',PAPER_DECLINED:'모의 실행 조건 미충족',SKIPPED:'해당 봉 처리 건너뜀',ABANDONED:'이번 봉 종결 · 호출 결과 미확정',FAILED:'처리 실패',DECISION_EXPIRED:'실행 허용 시간 경과',RECOVERED:'저장된 결과 복구됨',NO_RECORDS:'저장된 결정·영수증 없음',RECOVERY_AVAILABLE:'저장된 결과 복구 가능',OBSERVING:'후속 관측 중',COMPLETED:'처리 완료',READY:'처리 대기',DISABLED:'중지'})[value]||'실행 상태 확인';}
  function subscriptionPolicyMarkup(data=subscriptionData,subscription=null){
    const cohort=subscription?list(data?.cohortPolicies).find(p=>p.id===subscription.cohortPolicyId&&p.hash===subscription.cohortPolicyHash):list(data?.cohortPolicies)[0],policy=cohort?.policy,budget=subscription?.budget||(subscription?list(data?.budgetPolicies).find(p=>p.id===subscription.evaluationBudgetId&&p.version===subscription.evaluationBudgetVersion):list(data?.budgetPolicies)[0]),bars=policy?.observation?.horizonBars;
    const observation=policy?.observation,window=Number.isFinite(observation?.executionOffsetMinMs)&&Number.isFinite(observation?.executionOffsetMaxMs)?row('실행 허용창','봉 마감 후 '+num(observation.executionOffsetMinMs/60000,0)+'~'+num(observation.executionOffsetMaxMs/60000,0)+'분'):'',cost=policy?.costPolicyVersion==='FIXED_PAPER_10BP_5BP_V1'?row('모의 비용 가정','수수료 0.10% · 슬리피지 0.05%'):'',approval=policy?.approval?.requireUserApproval?row('학습 적용','완료한 관측과 독립 기회 검토 후 사용자 승인'):'';
    return row('평가 정책',Number.isFinite(bars)?'확정 4시간봉 '+num(bars,0)+'개 후 관측':'서버에 고정된 관측 정책')+(budget?row('결정 실행 한도','기준 봉당 최대 '+num(budget.maxPerCandle,0)+'회 · UTC 하루 최대 '+num(budget.maxPerUtcDay,0)+'회'):'')+(window||cost||approval?'<details class="spaced"><summary>고정된 평가·실행 조건</summary>'+window+cost+approval+'</details>':'');
  }
  function subscriptionUsageMarkup(subscription){const usage=subscription.budgetUsage;if(!usage)return '';const complete=/^\d{4}-\d{2}-\d{2}$/.test(usage.utcDay||'')&&['evaluationsStarted','jevCallsReserved','jevCallsCompleted','jevCallsUnknown','quantComputationsStarted'].every(key=>Number.isSafeInteger(usage[key])&&usage[key]>=0);if(!complete)return '';return row('결정 실행 · '+usage.utcDay+' UTC',num(usage.evaluationsStarted,0)+'회')+row('JEV 호출 · '+usage.utcDay+' UTC','예약 '+num(usage.jevCallsReserved,0)+'회 · 완료 '+num(usage.jevCallsCompleted,0)+'회 · 미확정 '+num(usage.jevCallsUnknown,0)+'회');}
  function subscriptionAccountLabel(subscription){const account=list(subscriptionData?.eligibleAccounts).find(a=>a.id===subscription.accountId)||list(workspace.mindPositions).find(a=>a.id===subscription.accountId);return account?'USDT 모의 계좌 · 초기 자금 '+num(account.initialCash):'고정 계좌 정보 확인 필요';}
  function subscriptionScheduledMarkup(subscription){const pins=subscription.pendingPins;return pins?'<p class="tiny spaced" role="status">정책 v'+esc(pins.manifestVersion)+' 적용 예약 · '+esc(when(pins.applyAtCloseAt))+' 기준 봉부터</p>':'';}
  function subscriptionRunnerMarkup(runner){
    if(!runner)return '';
    const state=({DISABLED:'자동 실행 연결 필요',STARTING:'자동 실행 준비 중',IDLE:'다음 실행 대기',RUNNING:'자동 모의 실행 중',ERROR:'자동 실행 확인 필요',STOPPED:'자동 실행 중지'})[runner.status]||'자동 실행 상태 확인';
    return '<div class="studio-sheet-body" data-mind-runner role="status">'+row('자동 실행 서버',(runner.scope==='LOCAL_CANONICAL_PAPER'?helpLabel('이 PC에서 운용','자동 모의 운용을 계속하려면 이 PC를 켜두고 절전을 해제하세요.')+' · ':'')+esc(state))+row('최근 상태 확인',esc(when(runner.heartbeatAt)))+(runner.nextDueAt?row('서버 다음 처리',esc(when(runner.nextDueAt))):'')+(runner.lastFailure?.message?'<p class="error-text">'+esc(runner.lastFailure.message)+'</p>':'')+(['DISABLED','STOPPED','ERROR'].includes(runner.status)?'<div class="actions spaced"><a class="button small" href="'+esc(studioRouteHash(currentRoute(),'settings',{view:'automation',executionMode:'paper'}))+'" data-studio-route>자동 실행 설정 확인</a></div>':'')+'</div>';
  }
  function subscriptionResolutionMarkup(reasons,mindId){
    const codes=new Set(list(reasons).map(reason=>reason.code)),links=[];
    if([...codes].some(code=>/ACCOUNT/.test(code)))links.push(button('모의 계좌 확인','subscription-account',mindId));
    if([...codes].some(code=>/MANIFEST|GRAPH|TIMEFRAME|SCOPE|MIND_REQUIRED/.test(code)))links.push(button('원칙·전략 확인','mind-view',mindId,'data-studio-view="principles"'));
    if(codes.has('OWNER_AUTOMATION_CAPACITY'))links.push('<a class="button small" href="'+esc(studioRouteHash(currentRoute(),'settings',{view:'automation',executionMode:'paper'}))+'" data-studio-route>운용 중인 마인드 확인</a>');
    return links.length?'<div class="actions spaced">'+links.join('')+'</div>':'';
  }
  function executionRetryReady(item){return item?.retryable===true&&Number.isFinite(Date.parse(item.expiresAt))&&terminalNow()<Date.parse(item.expiresAt);}
  function subscriptionRecentMarkup(subscription){
    const cycle=subscription.portfolioCycle,allocations=list(cycle?.allocations),last=subscription.lastAttempt;
    if(allocations.length)return '<section class="spaced" data-subscription-cycle="'+esc(subscription.id)+'"><h4>최근 운용</h4>'+row('기준 봉',esc(when(cycle.barCloseAt)))+table(['종목','결정 · 목표 비중','모의 체결',''],allocations.map(allocation=>{
      const retry=list(subscription.executionRetries).find(item=>item.subscriptionId===subscription.id&&item.runId===allocation.runId);let instrument;try{instrument=instrumentMetadata.get(allocation.instrumentId)||getInstrument(allocation.instrumentId);}catch{}
      const ready=executionRetryReady(retry),reason=!ready&&retry?(retry.retryable?'결정의 실행 가능 시간이 지났습니다.':retry.message||'현재 실행 조건을 다시 확인하세요.') : '';
      return [esc(instrument?.symbol||allocation.instrumentId),esc(({buy:'매수',sell:'매도',hold:'유지'})[allocation.action]||'결정 확인')+' · '+pct(allocation.targetWeight),esc(executionLabel(allocation.executionStatus))+(retry?.message?'<small class="studio-cell-secondary error-text">'+esc(retry.message)+'</small>':''),'<div class="actions">'+button('실행 상세','decision',allocation.runId)+(retry?button('체결 재시도','subscription-retry-execution',subscription.id,'data-studio-run-id="'+esc(allocation.runId)+'" '+(busy||!ready?'disabled':'')):'')+(reason?helpLabel('재시도 조건',reason):'')+'</div>'];
    }))+'</section>';
    return last?'<section class="spaced"><h4>최근 처리</h4>'+row('처리 단계',esc(subscriptionStateLabel(last.stage||last.status)))+(last.action?row('선택',esc(({buy:'매수',sell:'매도',hold:'유지'})[last.action]||'응답 확인')):'')+(last.executionStatus?row('모의 실행',esc(executionLabel(last.executionStatus))):'')+(last.completedAt?row('처리 완료',esc(when(last.completedAt))):'')+(last.decisionId?'<div class="actions spaced">'+button('실행 상세','decision',last.decisionId)+'</div>':'')+'</section>':'<p class="tiny muted spaced">이 자동 실행 설정의 처리 기록이 없습니다.</p>';
  }
  function renderMindSubscriptions(){
    const mindId=currentRoute().params.get('profileId'),data=subscriptionMindId===mindId?subscriptionData:null,subscriptions=list(data?.subscriptions),policy=data?.currentPublishedPolicy,canCreate=data?.canCreate!==false&&!!policy?.manifestId&&list(data?.eligibleAccounts).length>0&&list(data?.cohortPolicies).length>0&&list(data?.budgetPolicies).length>0;
    const scopeIssue=automaticScopeIssue(savedMind(mindId)?.manifest);if(data&&!subscriptions.length&&scopeIssue)return '<section class="studio-sheet spaced" data-mind-subscriptions tabindex="-1"><div class="studio-sheet-head"><h2>'+helpLabel('자동 모의 운용',scopeIssue)+'</h2>'+button('자동 실행 설정','subscription-create',mindId,'disabled')+'</div><div class="studio-sheet-body"><p role="status">'+(portfolioLabScope(savedMind(mindId)?.manifest)?'일봉 포트폴리오는 실험실에서 비교하세요.':'이 투자 범위는 트레이딩에서 직접 실행하세요.')+'</p><div class="actions spaced">'+button(portfolioLabScope(savedMind(mindId)?.manifest)?'실험실 열기':'트레이딩 열기',portfolioLabScope(savedMind(mindId)?.manifest)?'mind-lab':'mind-trade',mindId)+'</div></div></section>';
    const capacity=Number.isSafeInteger(data?.runner?.capacity)?data.runner.capacity:1,saving=subscriptionCommand?.mindId===mindId,actionError=subscriptionActionError?.mindId===mindId?subscriptionActionError.message:'',head='<section class="studio-sheet spaced" data-mind-subscriptions aria-busy="'+(subscriptionLoading||saving)+'"><div class="studio-sheet-head"><h2>'+helpLabel('4시간봉 자동 운용','최대 '+capacity+'개 마인드를 자동 모의 운용합니다. 서버의 실행 상태와 고정 정책·계좌를 확인하세요.')+'</h2><span class="tiny muted">동시 실행 '+capacity+'개 마인드</span><div class="actions">'+button('상태 새로고침','subscription-refresh','',subscriptionLoading||busy?'disabled':'')+(!subscriptions.length?button('자동 실행 설정','subscription-create',mindId,!canCreate||subscriptionLoading||busy?'disabled':''):'')+'</div></div>'+(saving?'<div class="studio-sheet-body"><p role="status" aria-live="polite">자동 실행을 일시중지하는 중…</p></div>':'')+(actionError?'<div class="studio-sheet-body"><p class="error-text" role="alert">'+esc(actionError)+'</p></div>':'');
    if(subscriptionLoading)return head+'<div class="studio-sheet-body"><p role="status">자동 실행 설정을 조회하는 중…</p></div></section>';
    if(subscriptionError)return head+'<div class="studio-sheet-body"><p class="error-text" role="alert">'+esc(subscriptionError)+'</p></div></section>';
    if(!data)return head+'<div class="empty">자동 실행 설정을 조회하세요.</div></section>';
    if(!subscriptions.length)return head+'<div class="studio-sheet-body"><p>마인드의 투자 범위에서 확정 4시간봉마다 종목과 비중을 결정합니다. 설정을 만든 뒤 자동 실행을 켜세요.</p>'+(!list(data.eligibleAccounts).length?'<p class="tiny spaced">이 마인드에 USDT 모의 계좌가 필요합니다.</p><div class="actions">'+button('모의 자금 설정','subscription-account',mindId,busy?'disabled':'')+'</div>':!policy?.manifestId?'<p class="tiny spaced">승인된 마인드 정책이 필요합니다.</p>':'')+list(data.createBlockedReasons).map(reason=>'<p class="tiny spaced" role="status">'+esc(reason.message)+'</p>').join('')+subscriptionResolutionMarkup(data.createBlockedReasons,mindId)+(policy?row('생성 시 고정할 정책',esc(policy.name||profileName(mindId))+' · v'+esc(policy.manifestVersion)):'')+subscriptionPolicyMarkup(data)+'</div></section>';
    return head+subscriptionRunnerMarkup(data?.runner)+subscriptions.map(s=>{
      const last=s.lastAttempt,failure=s.lastFailure,pending=s.pendingVersionChange?.manifestId===s.pendingPins?.manifestId?null:s.pendingVersionChange,enableBlocked=list(s.enableBlockedReasons),requiresReview=s.status==='ACTION_REQUIRED'||enableBlocked.some(reason=>reason.code==='SUBSCRIPTION_ACTION_REQUIRED'),hasStoredAttempt=s.hasAttempts===true||!!last||requiresReview,lastDecision=last?.decisionId,controls=s.enabled?button('일시중지','subscription-pause',s.id,busy?'disabled':''):s.status==='ACTION_REQUIRED'?button('자동 운용 중지','subscription-pause',s.id,busy?'disabled':''):button('자동 실행 켜기','subscription-enable',s.id,busy||s.canEnable===false?'disabled':'');
      return '<div class="studio-sheet-body" data-subscription-id="'+esc(s.id)+'"><div class="studio-sheet-head"><h3>'+esc(s.name||profileName(mindId)+' · BTC-USDT')+'</h3><div class="actions">'+controls+button('지금 한 번 실행','subscription-run-now',s.id,busy||requiresReview||!s.enabled?'disabled':'')+(pending?button('현재 발행 버전 적용','subscription-version',s.id,busy?'disabled':''):'')+'</div></div>'+row('상태',esc(subscriptionStateLabel(s.status)))+(hasStoredAttempt?(requiresReview?'<p class="tiny spaced" role="status">서버 원본을 내보내 호출·계좌 기록을 확인하세요.</p>':'')+'<div class="actions spaced">'+button('저장 기록 확인','subscription-recovery',s.id,busy?'disabled':'')+button('서버 원본 내보내기','export-workspace','',busy?'disabled':'')+'</div>':'')+(s.campaign?row('운용 종료',s.campaign.status==='COMPLETED'?'완료 · '+esc(when(s.campaign.completedAt)):'청산 중 · '+num(list(s.campaign.remainingInstrumentIds).length,0)+'개 종목'):'')+row('운용 기간',esc(operationWindowSummary(s)))+row('고정 정책',esc(profileName(s.profileId||mindId))+' · v'+esc(s.manifestVersion))+row('고정 계좌',esc(subscriptionAccountLabel(s)))+row('다음 기준 봉',esc(when(s.nextBarCloseAt)))+row(s.nextAttemptAt?'다음 재시도 가능':'다음 처리 가능',(s.nextAttemptAt||s.nextEligibleAt)?esc(when(s.nextAttemptAt||s.nextEligibleAt)):'시각 미정')+(data.runner?row('실행 연결',esc(({IDLE:'서버 대기',RUNNING:'서버 처리 중',STARTING:'서버 준비 중',ERROR:'서버 상태 확인 필요',DISABLED:'자동 실행 연결 필요',STOPPED:'서버 중지'})[data.runner.status]||'연결 상태 확인')):row('다음 클라우드 실행',s.nextCloudRunAt?esc(when(s.nextCloudRunAt)):'클라우드 연결 확인 필요'))+(s.lastDeliveryAt?row('최근 자동 실행 요청',esc(when(s.lastDeliveryAt))):s.lastMcpDeliveryAt?row('최근 클라우드 요청',esc(when(s.lastMcpDeliveryAt))):'')+subscriptionPolicyMarkup(data,s)+subscriptionUsageMarkup(s)+paperAdaptationMarkup(s)+subscriptionScheduledMarkup(s)+(pending?'<p class="tiny spaced" role="status">승인된 새 정책 v'+esc(pending.manifestVersion)+'이 있습니다. 현재 v'+esc(s.manifestVersion)+'을 유지하며, 변경을 적용하면 다음 미시작 봉부터 사용합니다.</p>':'')+(!s.enabled&&enableBlocked.length?'<div class="spaced">'+enableBlocked.map(reason=>'<p class="tiny" role="status">'+esc(reason.message)+'</p>').join('')+subscriptionResolutionMarkup(enableBlocked,mindId)+'</div>':'')+subscriptionRecentMarkup(s)+(failure?'<section class="spaced"><h4>최근 실패</h4><p class="error-text" role="alert">'+esc(failure.message||'실패 원본을 확인하세요.')+'</p>'+row('실패 시각',esc(when(failure.occurredAt||failure.failedAt)))+(failure.retryAt?row('재시도 가능',esc(when(failure.retryAt))):'')+'</section>':'')+raw(s,'자동 실행 설정 원본')+'</div>';
    }).join('')+'</section>';
  }
  function openSubscriptionCreate(){
    const data=subscriptionData,mindId=currentRoute().params.get('profileId'),policy=data?.currentPublishedPolicy,manifest=savedMind(mindId)?.manifest;
    if(subscriptionMindId!==mindId||!policy?.manifestId)throw Error('선택한 마인드의 정책을 다시 조회하세요.');
    const accounts=list(data.eligibleAccounts),budget=paperBudgetSummary(workspace,'USDT'),plan=manifest?.data.strategyPlan,ready=plan?.status==='APPROVED'&&plan.approval?.enabled===true,issues=list(data.createBlockedReasons).filter(r=>r.code!=='PAPER_ACCOUNT_REQUIRED');
    if(!ready||issues.length||automaticScopeIssue(manifest)){hooks.open?.('운용 준비','<section class="stack"><h3>1. 전략 노드 설정</h3><p>노드를 저장하고 사용할 정책으로 발행한 뒤 자금과 기간을 설정하세요.</p>'+issues.map(r=>'<p role="status">'+esc(r.message)+'</p>').join('')+'<div class="actions">'+button('노드 설정','strategy-graph',mindId,'','primary')+'<a class="button" href="#library?view=review&executionMode=paper" data-studio-route>저장한 정책 열기</a></div><h3>2. 모의 자금</h3>'+row('배정 가능',money(budget.available,'USDT'))+'<h3>3. 운용 기간</h3><p>전략 설정을 마치면 시작과 종료 시각을 지정할 수 있습니다.</p></section>');return;}
    form('모의 운용 준비','subscription-launch','<div class="full">'+row('전략',esc(policy.name||profileName(mindId))+' · v'+esc(policy.manifestVersion))+row('판단 주기','4시간 확정 봉')+row('배정 가능',money(budget.available,'USDT'))+'</div>'+(accounts.length?select('운용 계좌','accountId',accounts.map(a=>[a.id,'USDT · 원금 '+num(a.initialCash)]))+'<p class="tiny full">기존 계좌의 현금과 보유를 이어갑니다.</p>':(!budget.configured?field('공용 모의 예산 (USDT)','totalBudget',10000,'number','min="0.00000001" step="any" required'):'')+field('배정할 모의 자금 (USDT)','fundAmount',budget.configured?Math.min(budget.available,1000):1000,'number','min="0.00000001" '+(budget.configured?'max="'+budget.available+'" ':'')+'step="any" required')+'<div class="full">'+button('공용 예산 설정','budget-edit','USDT')+'</div>')+operationWindowFields()+'<div class="full">'+button('과거 기간 비교','mind-lab',mindId)+'</div><input type="hidden" name="manifestId" value="'+esc(policy.manifestId)+'"><input type="hidden" name="cohortPolicyHash" value="'+esc(data.cohortPolicies[0].hash)+'"><label class="field full"><span><input type="checkbox" name="optInPaper" value="true" required> 위 전략과 자금, 기간으로 자동 모의 운용합니다.</span></label>',mindId,'동의하고 모의 운용 시작');
  }
  function openSubscriptionEnable(id){
    const s=byId(subscriptionData?.subscriptions,id);if(!s||s.enabled||s.canEnable===false)throw new Error('자동 실행 상태와 시작 조건을 다시 조회하세요.');
    form('자동 모의 운용 켜기','subscription-enable','<div class="full">'+row('마인드 · 종목',esc(profileName(s.profileId))+' · 4시간봉')+row('고정 정책','v'+esc(s.manifestVersion))+(s.pendingPins?row('적용 예약 정책','v'+esc(s.pendingPins.manifestVersion))+row('예약 적용 기준',esc(when(s.pendingPins.applyAtCloseAt))+' 기준 봉부터'):'')+row('고정 계좌',esc(subscriptionAccountLabel(s)))+subscriptionPolicyMarkup(subscriptionData,s)+'</div>'+operationWindowFields(s)+'<input type="hidden" name="cohortPolicyHash" value="'+esc(s.cohortPolicyHash)+'"><label class="field full"><span><input type="checkbox" name="optInPaper" value="true" required> 고정한 계좌에서 위험·비용 검사 후 자동 모의 실행을 허용합니다.</span></label><p class="tiny muted full">다음 확정 봉 처리 시 시세·실행 한도·계좌 상태를 확인하고 적용 정책에 따라 자동 모의 실행을 진행합니다.</p>',id,'동의하고 자동 실행 켜기');
  }
  function openSubscriptionVersion(id){
    const s=byId(subscriptionData?.subscriptions,id),next=s?.pendingVersionChange;if(!next)throw new Error('적용 가능한 새 정책을 다시 조회하세요.');
    const manifest=savedMind(s.profileId)?.manifest,policy=manifest?.id===next.manifestId?manifest.data:null;
    form('자동 실행 정책 변경 검토','subscription-version','<div class="full">'+row('대상 마인드',esc(profileName(s.profileId)))+row('현재 고정 정책','v'+esc(s.manifestVersion))+row('변경할 승인 정책','v'+esc(next.manifestVersion))+row('새 정책 사용 가능',esc(when(next.availableAt)))+row('적용 범위','다음 미시작 봉부터')+row('고정 계좌',esc(subscriptionAccountLabel(s)))+(policy?'<section class="spaced"><h3>새 정책 내용</h3>'+row('투자 철학',esc(policy.profileSettings?.philosophy))+row('운용 규율',esc(policy.profileSettings?.discipline))+table(['원칙','가중치'],list(policy.principles).map(p=>[esc(p.text),num(p.weight,3)]))+policyKnowledgeMarkup(policy)+'</section>':'<p class="tiny spaced">새 정책의 원칙 화면과 버전 원본을 함께 확인하세요.</p>')+'</div><input type="hidden" name="manifestId" value="'+esc(next.manifestId)+'"><label class="field full"><span><input type="checkbox" name="reviewed" value="true" required> 새 정책 버전을 검토했고 다음 미시작 봉부터 적용합니다.</span></label>'+raw({current:{manifestId:s.manifestId,manifestHash:s.manifestHash,versionRefs:s.versionRefs},next},'현재·변경 정책 원본'),id,'다음 미시작 봉부터 적용');
  }
  async function pauseMindSubscription(id){
    const subscription=byId(subscriptionData?.subscriptions,id);if(!subscription||!subscription.enabled&&subscription.status!=='ACTION_REQUIRED'||subscriptionCommand)return;const mindId=subscription.profileId;subscriptionCommand={mindId,id};subscriptionActionError=null;redraw();
    try{await mutate('',{subscriptionId:id},'/api/workspace/mind-subscriptions/pause');hooks.toast?.('자동 실행을 일시중지했습니다. 처리 중인 봉의 상태는 실행 기록에서 확인하세요.');}
    catch(problem){subscriptionActionError={mindId,message:problem.message};throw problem;}
    finally{subscriptionCommand=null;redraw();}
  }
  const recoveryScopeMatches=(mindId,token)=>{const value=currentRoute();return token===recoveryGeneration&&value.page==='minds'&&value.params.get('view')==='operations'&&value.params.get('profileId')===mindId;};
  const recoveryAllowed=action=>list(recoveryData?.recovery?.allowedActions).includes(action);
  const recoveryTitle=()=>profileName(recoveryMindId)+' · BTC-USDT 저장 기록';
  function recoveryFailure(id,message){recoveryData=null;hooks.open?.(recoveryTitle(),'<div data-subscription-recovery><p class="error-text" role="alert">'+esc(message)+'</p></div>',button('저장 기록 다시 조회','subscription-recovery',id));}
  async function openSubscriptionRecovery(id){
    if(recoveryPending||busy)return;const subscription=byId(subscriptionData?.subscriptions,id);if(!subscription)return;const mindId=subscription.profileId,token=++recoveryGeneration;recoveryData=null;recoveryMindId=mindId;hooks.open?.(recoveryTitle(),'<div data-subscription-recovery><p role="status" aria-live="polite">호출·계좌·진행 작업의 저장 기록을 조회하는 중…</p></div>');
    try{const value=await request('/api/workspace/mind-subscriptions/recovery?'+new URLSearchParams({subscriptionId:id}));if(!recoveryScopeMatches(mindId,token))return;if(value.recovery?.subscriptionId!==id||value.recovery?.profileId!==mindId)throw new Error('조회한 자동 운용의 범위를 확인하세요.');recoveryData=value;recoveryMindId=mindId;recoveryViewGeneration=token;renderSubscriptionRecovery();}catch(problem){if(recoveryScopeMatches(mindId,token))recoveryFailure(id,problem.message);}
  }
  function renderSubscriptionRecovery(message='',problem=''){
    const value=recoveryData,r=value?.recovery;if(!r)return;const attempt=r.attempt||{},pins=r.pins||{},budget=r.budget||{},lease=r.lease,reconciliation=r.reconciliation,run=r.decision,receipt=r.receipt,account=r.account,local=attempt.requiresJev===false;
    const currentSubscription=subscriptionData?.revision===value.revision?byId(subscriptionData?.subscriptions,r.subscriptionId):null,nextBar=r.subscriptionStatus==='ENABLED'?currentSubscription?.nextBarCloseAt:null;
    const context='<div class="studio-recovery-context" aria-label="조회 시도와 현재 자동운용 설정">'+row(nextBar&&attempt.barCloseAt<nextBar?'과거 시도 기준 봉':'조회한 시도 기준 봉',esc(when(attempt.barCloseAt))+' · '+esc(subscriptionStateLabel(attempt.status)))+row('현재 자동운용 설정',esc(subscriptionStateLabel(r.subscriptionStatus))+(nextBar?'<small>저장된 처리 대상 '+esc(when(nextBar))+' 봉</small>':r.subscriptionStatus==='ENABLED'?'<small>저장된 처리 대상 최신 조회 필요</small>':'')+'<small>처리 결과는 현재 자동운용의 실행 기록에서 확인합니다.</small>')+'</div>';
    const reasonList=list(r.blockedReasons).map(reason=>'<p class="tiny spaced" role="status">'+esc(reason.message)+'</p>').join('');
    const readOnly=attempt.status==='ABANDONED'&&!list(r.allowedActions).length;
    const leaseStatus=lease?lease.status==='COMPLETED'?'처리 완료':['PENDING','RUNNING'].includes(lease.status)?lease.expired===true?'진행 작업 허용 시간 경과':'처리 중':({FAILED:'처리 실패',CANCELLED:'중단됨'})[lease.status]||'원본 상태 확인':'최근 작업 기록 없음';
    const history='<section aria-labelledby="recovery-attempt-heading"><h3 id="recovery-attempt-heading">저장된 시도</h3>'+row(local?'계산 시작':'호출 예약',esc(when(attempt.reservedAt)))+(attempt.completedAt?row('시도 종료',esc(when(attempt.completedAt))):'')+row('고정 정책','v'+esc(pins.manifestVersion||'—'))+row('이번 봉 결정 실행',num(budget.consumedPerCandle,0)+'회 소모 / 최대 '+num(budget.maxPerCandle,0)+'회')+row('시작일 결정 실행 · UTC',num(budget.consumedUtcDay,0)+'회 소모 / 최대 '+num(budget.maxPerUtcDay,0)+'회'+(attempt.utcDay?' · '+esc(attempt.utcDay):''))+subscriptionUsageMarkup({budgetUsage:r.budgetUsage})+(local?row('이번 시도 JEV 호출','0회'):'')+(reconciliation?row('저장된 대조 시각',esc(when(reconciliation.checkedAt||reconciliation.completedAt)))+row('저장된 대조 결과',esc(({RECOVERY_AVAILABLE:'저장된 결과 복구 가능',NO_RECORDS:'저장된 결정·영수증 없음',ACCOUNT_CHANGED:'예약 후 계좌 변경됨',ABANDONED:'이번 봉 종결 · 호출 결과 미확정',ACTION_REQUIRED:'호출 결과 확인 필요',ABANDON_ALLOWED:'이번 봉 종결 검토 가능',RECONCILING:'진행 작업 대조 중',COMPLETED:'저장 결과 확인 완료',LOCAL_COMPUTATION_INTERRUPTED:'계산 중단 · 다음 봉 재개 가능'})[reconciliation.result]||'검사 원본 확인')):'')+(run?row('저장된 결정',esc(({buy:'매수',sell:'매도',hold:'유지'})[run.action||run.decision?.action]||'결정 기록 있음'))+'<div class="actions spaced">'+button('실행 상세','decision',run.id,recoveryPending?'disabled':'')+'</div>':'<p class="tiny spaced">이 시도에 저장된 결정 기록이 없습니다.</p>')+(receipt?row('저장된 영수증',esc(receipt.status==='HOLD'?'보유 유지 · 추가 주문 없음':executionLabel(receipt.status)))+row('영수증 시각',esc(when(receipt.at||receipt.asOf))):'<p class="tiny spaced">이 시도에 저장된 모의 실행 영수증이 없습니다.</p>')+(r.providerFailure?providerFailureMarkup(r.providerFailure):attempt.status==='ACTION_REQUIRED'?providerFailureMarkup(null):'')+'</section>';
    const current='<section class="spaced" aria-labelledby="recovery-current-heading"><h3 id="recovery-current-heading">현재 조회 · '+esc(when(value.asOf))+'</h3>'+(account?row('현재 계좌 · 예약 대비',account.unchanged===true?'예약 당시와 일치':account.unchanged===false?'예약 후 변경됨':'대조 원본 확인'):'')+row('최근 마인드 작업',esc(leaseStatus))+(lease?.startedAt?row('최근 작업 시작',esc(when(lease.startedAt))):'')+(lease?.finishedAt?row('최근 작업 완료',esc(when(lease.finishedAt))):'')+reasonList+'</section>';
    const controls=(readOnly?'':button('저장 기록 다시 확인','subscription-reconcile',r.subscriptionId,recoveryPending||!recoveryAllowed('reconcile')?'disabled':'')+button('저장된 결과 복구','subscription-recover',r.subscriptionId,recoveryPending||!recoveryAllowed('recover')?'disabled':'')+(local?'':button('이번 봉 종결 검토','subscription-abandon',r.subscriptionId,recoveryPending||!recoveryAllowed('abandon')?'disabled':''))+button('다음 봉부터 재개','subscription-enable',r.subscriptionId,recoveryPending||!recoveryAllowed('resume')?'disabled':''))+button('서버 원본 내보내기','export-workspace','',recoveryPending?'disabled':'');
    hooks.open?.(recoveryTitle(),'<div class="studio-recovery-frame" data-subscription-recovery>'+context+'<div class="studio-recovery-scroll" data-recovery-scroll tabindex="0" role="region" aria-label="'+esc(profileName(recoveryMindId)+' BTC-USDT 저장 기록 본문')+'">'+(message?'<p role="status" aria-live="polite">'+esc(message)+'</p>':'')+(problem?'<p class="error-text" role="alert">'+esc(problem)+'</p>':'')+(readOnly?'<p class="tiny spaced" role="status">종결한 과거 시도 · 읽기 전용</p>':'')+history+current+'<p class="tiny muted spaced">'+(local?'저장된 결정·계좌 기록을 대조하고 계산 중단 기록을 정리한 뒤 다음 봉부터 재개합니다.':'복구는 저장된 결정·계좌 기록을 사용합니다. 이번 봉을 종결하면 호출 결과 미확정과 예산 소모 기록을 보존합니다.')+'</p>'+raw({attemptKey:r.attemptKey,pins,budget,inputSnapshot:r.inputSnapshot,providerStages:r.providerStages,account,lease,reconciliation,receipt,readRevision:value.revision},'호출·고정 입력·계좌·작업 대조 원본')+'</div></div>',controls);
  }
  function openSubscriptionAbandon(id){
    const value=recoveryData,r=value?.recovery;if(recoveryPending||!r||r.attempt?.requiresJev===false||r.subscriptionId!==id||!recoveryAllowed('abandon')||!recoveryScopeMatches(recoveryMindId,recoveryViewGeneration))throw new Error('저장 기록을 다시 대조한 뒤 허용된 조치를 선택하세요.');const reasons=list(r.reasonCodes);if(!reasons.length)throw new Error('서버의 종결 사유 양식을 다시 조회하세요.');
    form(profileName(recoveryMindId)+' · BTC-USDT 이번 봉 처리 종결','subscription-abandon','<div class="full" data-subscription-recovery>'+row('대상 마인드',esc(profileName(recoveryMindId)))+row('기준 봉',esc(when(r.attempt?.barCloseAt)))+row('결과 상태','JEV 호출 결과 미확정 · 호출 예산 소모 유지')+'</div>'+select('종결 사유','reasonCode',reasons.map(reason=>[reason.value||reason.code,reason.label||reason.title]))+'<label class="field full">확인 내용<textarea name="reasonText" maxlength="2000" minlength="10" required></textarea></label><label class="field full"><span><input type="checkbox" name="ackUnknown" value="true" required> 외부 호출 결과가 미확정으로 남는 것을 확인했습니다.</span></label><label class="field full"><span><input type="checkbox" name="ackBudget" value="true" required> 이번 봉과 일일 호출 예산 소모를 유지합니다.</span></label><p class="tiny muted full">서버가 저장된 결정·영수증과 진행 작업을 다시 대조한 뒤 종결합니다. 완료하면 일시중지 상태가 되며 다음 미래 봉부터 별도로 재개할 수 있습니다.</p>',id,'확인하고 이번 봉 종결');
  }
  async function runSubscriptionRecovery(action,payload={}){
    const value=recoveryData,r=value?.recovery;if(recoveryPending||busy||!r||!recoveryAllowed(action)||!recoveryScopeMatches(recoveryMindId,recoveryViewGeneration))throw new Error('저장 기록을 다시 대조한 뒤 허용된 조치를 선택하세요.');const id=r.subscriptionId,mindId=recoveryMindId,attemptKey=r.attemptKey;if(!attemptKey||!Number.isSafeInteger(value.revision))throw new Error('호출 시도와 저장 버전을 다시 조회하세요.');
    const token=++recoveryGeneration;recoveryViewGeneration=token;recoveryPending=true;let committed=false;renderSubscriptionRecovery(({reconcile:'저장된 호출·계좌·진행 작업을 대조하는 중…',recover:'저장된 결과를 복구하는 중…',abandon:'이번 봉의 처리 권한과 저장 기록을 확인하는 중…'})[action]);
    try{const result=await mutate('',{subscriptionId:id,attemptKey,...payload},'/api/workspace/mind-subscriptions/'+action,{expectedRevision:value.revision,onCommitted:()=>{committed=true;if(recoveryScopeMatches(mindId,token))renderSubscriptionRecovery('처리 저장됨 · 최신 대조 조회 중…');}});const fresh=await request('/api/workspace/mind-subscriptions/recovery?'+new URLSearchParams({subscriptionId:id}));if(!recoveryScopeMatches(mindId,token))return;if(fresh.recovery?.subscriptionId!==id||fresh.recovery?.profileId!==mindId)throw new Error('조회한 자동 운용의 범위를 확인하세요.');recoveryData=fresh;recoveryViewGeneration=token;recoveryPending=false;renderSubscriptionRecovery(result.result?.outcome==='DECISION_EXPIRED'?'실행 허용 시간이 지나 결정을 보존하고 이번 봉 처리를 마쳤습니다.':({reconcile:'저장 기록을 다시 대조했습니다.',recover:'저장된 결과를 복구했습니다.',abandon:'이번 봉을 종결하고 자동 운용을 일시중지했습니다.'})[action]);}
    catch(problem){if(recoveryScopeMatches(mindId,token))recoveryFailure(id,(committed?'처리는 저장됨 · 최신 대조 조회 실패. ':'')+problem.message);}
    finally{recoveryPending=false;}
  }
  function renderMindPrinciples(){
    const {id,profile,manifest,policy,settings}=mindContext();if(!profile)return selectMindRequired('전략');
    const graph=policy?.strategyPlan?.graph,nodes=list(graph?.nodes),symbols=list(policy?.universe?.instrumentIds).map(value=>{try{return getInstrument(value).symbol;}catch{return value.split(':').at(-1);}}),event=isEventAutomationMind(manifest),timeframe=strategyTimeframeParameter(graph)?.value??graph?.scope?.timeframe??policy?.strategyPlan?.scope?.timeframe;
    const engine=nodes.length?(graphRequiresJev(graph)?'퀀트 + AI 판단':nodes.some(node=>node.type==='MODEL')?'학습 모델':'퀀트'):'전략 구성 대기',frequency=({'1m':'1분봉','3m':'3분봉','5m':'5분봉','1h':'1시간봉','4h':'4시간봉','1d':'일봉'})[timeframe]??timeframe??'실행 주기 설정',published=policy?.version?'v'+policy.version:'설정 대기';
    const profitOrder=nodes.find(node=>node.type==='ORDER'&&node.config.takeProfitBps)?.config,profitSummary=profitOrder?'매수 체결 후 '+(profitOrder.takeProfitBps/100)+'% 높은 지정가에 매수 수량의 '+(profitOrder.takeProfitFraction*100)+'%를 매도합니다. 남은 수량은 모델이 판단합니다.':null;
    const summary='<section class="studio-sheet studio-strategy-summary"><div class="studio-sheet-head"><h2>전략 구성</h2><span>'+esc(published)+'</span></div><div class="studio-sheet-body">'+row('투자 방식',esc(engine))+row('대상 종목',symbols.length>6?'<details class="studio-universe-summary"><summary>'+symbols.length+'개 종목 <span>목록 보기</span></summary><p>'+esc(symbols.join(' · '))+'</p></details>':esc(symbols.join(' · ')||'종목을 선택하세요'))+row('실행 주기',button(frequency+' ↗','strategy-parameter',id,'aria-label="실행 주기 '+esc(frequency)+' 편집"')+(event&&nodes.some(node=>node.type==='INPUT'&&node.config?.kind==='POSITION')?'<span class="tiny muted">실시간 보유 보호</span>':''))+row('구성',nodes.length?nodes.length+'개 부품 · '+list(graph.edges).length+'개 연결':'전략 편집에서 부품을 연결하세요')+(profitSummary?row('지정가 익절',esc(profitSummary)):settings?.philosophy?'<p class="studio-policy-text">'+esc(settings.philosophy)+'</p>':'')+'</div></section>';
    const advanced=strategyPlanMarkup(policy?.strategyPlan,policy?.universe)+'<section class="studio-sheet"><div class="studio-sheet-head"><h2>철학·규율</h2></div><div class="studio-sheet-body">'+row('투자 철학',esc(settings?.philosophy||'작성 필요'))+row('운용 규율',esc(settings?.discipline||'작성 필요'))+row('주요 근거',esc(list(settings?.evidencePreferences).join(' · ')||'등록된 근거 없음'))+'</div></section>'+(policy?'<section class="studio-sheet spaced"><div class="studio-sheet-head"><h2>원칙별 가중치</h2><span class="tiny muted">발행된 정책 v'+esc(policy.version)+'</span></div>'+table(['원칙','종류','가중치','허용 범위',''],list(policy.principles).map(p=>[esc(p.title),p.kind==='core'?'핵심 원칙':'원칙별 근거',num(p.weight,3),num(p.bounds?.min,2)+'–'+num(p.bounds?.max,2),p.kind==='core'?'고정':button('가중치 검토','weight-propose',p.id)]))+'</section><section class="studio-sheet spaced"><div class="studio-sheet-head"><h2>자료·실행 조건</h2></div><div class="studio-sheet-body">'+row('실행 조건',esc(strategyTriggerLabel(policy)))+table(['입력 자료','정책 설정','필수'],list(policy.inputs).map(i=>[esc(({'price-ohlcv':'확정 가격·거래량','approved-memory':'학습 자료',macro:'매크로 지표',news:'뉴스 맥락'})[i.id]||'자료'),esc(({connected:'연결됨','approved-context':'승인 자료',unavailable:'연결 대기'})[i.status]||'검토 대기'),i.required?'필수':'선택']))+raw(manifest,'현재 정책 원본')+'</div></section>':'<section class="studio-sheet"><div class="empty">발행된 정책을 조회하면 원칙별 설정이 표시됩니다.</div></section>')+renderMindUniverse(policy,id);
    return mindHeading('전략',button('노드 편집','strategy-graph',id,'','primary')+button('범위 편집','universe-edit',id),button('마인드 편집','profile-edit',id)+button('실행 설정','strategy-plan',id)+button('JSON · YAML 내보내기','export',id)+button('정책 가져오기','document-new','mind-policy'))+renderPolicyDrafts(id,policy?.version)+summary+mindDisclosure('strategy-policy','정책·가중치·실행 설정',advanced);
  }

  function renderPolicyDrafts(profileId,currentVersion){
    const drafts=list(mindData?.documents).filter(entry=>entry.status==='DRAFT'&&(entry.document||entry).kind==='mind-policy'&&(entry.document||entry).scope?.profileId===profileId).sort((a,b)=>String((b.document||b).provenance?.createdAt||b.importedAt||'').localeCompare(String((a.document||a).provenance?.createdAt||a.importedAt||'')));
    if(!drafts.length)return '';
    return '<section class="studio-sheet spaced" data-policy-drafts><div class="studio-sheet-head"><h2>검토 중 정책</h2><span class="tiny muted">'+drafts.length+'개</span></div>'+table(['정책','버전','작성 시각','발행 조건',''],drafts.map(entry=>{const doc=entry.document||entry,stale=Number.isFinite(currentVersion)&&doc.data.version<=currentVersion;return [esc(doc.title),'v'+esc(doc.data.version),esc(when(doc.provenance?.createdAt||entry.importedAt)),stale?'정책 버전 갱신 필요':'검토 대기',button('정책 검토','document-detail',entry.id||doc.id)];}))+'</section>';
  }
  function renderConnectedKnowledge(){const {id}=mindContext(),type=currentRoute().params.get('knowledgeView')||'sources';return mindHeading('연결 자료',(type==='documents'?button('문서 추가','document-note',id,'','primary'):'')+button('라이브러리 열기','open-library')+(id!=='all'?button('자료 연결 설정','knowledge-policy',id):''))+'<div class="studio-local-tabs" aria-label="연결 지식 유형">'+[['sources','공용 투자 자료'],['documents','검토 문서'],['observations','후속 관측'],['memory','학습 자료']].map(([key,label])=>button(label,'mind-knowledge-view',key,'aria-pressed="'+(type===key)+'"')).join('')+'</div>'+(type==='sources'?renderKnowledgePolicy():renderMindKnowledge(id,{view:type}));}
  function knowledgeConnectionRows(k){
    if(!k.enabled)return row('공용 자료 입력','사용 안 함');
    const filters=k.mode==='subscribed'?row('출처 유형',esc(k.sourceTypes.map(v=>KNOWLEDGE_LABELS[v]).join(' · ')||'유형 제한 없음'))+row('저자',esc(k.authorIds.join(' · ')||'저자 제한 없음'))+row('자료 수준',esc(k.levels.map(v=>KNOWLEDGE_LABELS[v]).join(' · ')||'수준 제한 없음'))+row('영향 기간',esc(k.horizons.map(v=>KNOWLEDGE_LABELS[v]).join(' · ')||'기간 제한 없음')):'';
    return row('공용 자료 입력','사용함')+row('연결 방식',k.mode==='subscribed'?'조건에 맞는 승인 자료 구독':'선택한 자료 버전 고정')+filters+row('공개 후 유효 시간',num(k.maxAgeHours,0)+'시간')+row('실행당 최대 자료 수',k.maxItems+'개');
  }
  function renderKnowledgePolicy(){
    const {id,profile,policy}=mindContext();if(!profile)return '<section class="studio-sheet">'+table(['마인드','공용 자료','연결 방식',''],list(workspace.investmentProfiles).map(p=>{const k=savedMind(p.id)?.manifest?.data.externalKnowledge||disabledExternalKnowledge();return [esc(profileName(p.id)),k.enabled?'사용함':'사용 안 함',!k.enabled?'사용 안 함':k.mode==='subscribed'?'승인 자료 구독':'자료 버전 고정',button('연결 설정','knowledge-policy',p.id)];}),'마인드를 추가하면 투자 자료를 연결할 수 있습니다.')+'</section>';
    const k=policy?.externalKnowledge||disabledExternalKnowledge(),pins=list(k.documentPins);
    return '<section class="studio-sheet"><div class="studio-sheet-head"><h2>'+helpLabel('공용 자료 입력','각 결정에 적용된 정책과 자료 버전은 실행 기록에서 확인할 수 있습니다.')+'</h2><span class="tiny muted">현재 발행 정책 v'+esc(policy?.version||'—')+'</span></div><div class="studio-sheet-body">'+knowledgeConnectionRows(k)+'<div class="actions spaced">'+button('실행 기록 확인','mind-view',id,'data-studio-view="records"')+'</div></div></section>'+(pins.length?(k.enabled&&k.mode==='pinned'?'<section class="studio-sheet spaced"><div class="studio-sheet-head"><h2>현재 고정 설정</h2></div>':'<details class="studio-sheet spaced"><summary class="studio-sheet-body">보관한 고정 설정 · '+pins.length+'개</summary>')+table(['자료','버전','원본 식별값',''],pins.map(pin=>{const entry=list(workspace.marketKnowledge).find(e=>e.id===pin.id);return [esc(knowledgeItems.get(pin.id)?.title||entry?.document?.title||'자료 제목 조회 중…')+'<details><summary>자료 ID</summary><div class="code">'+esc(pin.id)+'</div></details>','v'+pin.version,'<details><summary><code title="'+esc(pin.contentHash)+'">'+esc(pin.contentHash.slice(0,12))+'…</code></summary><div class="code">'+esc(pin.contentHash)+'</div></details>','<button type="button" class="button small" data-library-action="detail" data-library-id="'+esc(pin.id)+'">원문 열기</button>'];}))+(k.enabled&&k.mode==='pinned'?'</section>':'</details>'):'');
  }
  async function loadKnowledgePinTitles(){const r=currentRoute();if(!workspace||r.page!=='minds'||r.params.get('view')!=='knowledge')return;const pins=list(savedMind(r.params.get('profileId'))?.manifest?.data.externalKnowledge?.documentPins),missing=pins.filter(pin=>!knowledgeItems.has(pin.id)||knowledgeItems.get(pin.id).error);if(!missing.length)return;await Promise.all(missing.map(async pin=>{try{const value=await request('/api/workspace/market-knowledge/item?'+new URLSearchParams({id:pin.id}));knowledgeItems.set(pin.id,value.item);}catch{knowledgeItems.set(pin.id,{id:pin.id,title:'자료 제목 조회 실패',error:true});}}));redraw();}
  function mindLibraryQuery(){const params=currentRoute().params;return new URLSearchParams({profileId:params.get('profileId')||'all',view:params.get('view')||'experiences',pageSize:params.get('pageSize')||'20',...(params.get('cursor')?{cursor:params.get('cursor')}:{})});}
  async function loadMindLibrary({force=false}={}){
    const r=currentRoute();if(r.page!=='library'||!['experiences','review'].includes(r.params.get('view'))){mindLibraryAbort?.abort();mindLibraryGeneration++;mindLibraryLoading=false;mindLibraryKey='';mindLibraryData=null;mindLibraryError='';return;}
    const query=mindLibraryQuery(),key=query.toString();if(!force&&key===mindLibraryKey)return;mindLibraryAbort?.abort();mindLibraryAbort=new AbortController();const token=++mindLibraryGeneration;mindLibraryKey=key;mindLibraryLoading=true;mindLibraryError='';mindLibraryData=null;redraw();
    try{const value=await request('/api/workspace/mind-library?'+query,undefined,{signal:mindLibraryAbort.signal});if(token!==mindLibraryGeneration)return;if(value.scope?.profileId!==query.get('profileId')||value.scope?.view!==query.get('view'))throw new Error('조회 대상이 변경되었습니다. 현재 범위에서 다시 조회하세요.');mindLibraryData=value;}
    catch(problem){if(token===mindLibraryGeneration&&problem.name!=='AbortError')mindLibraryError=problem.status===409?'자료가 변경되었습니다. 첫 페이지에서 다시 조회하세요.':problem.message;}
    finally{if(token===mindLibraryGeneration){mindLibraryLoading=false;redraw();}}
  }
  function navigateMindLibrary(cursor){const changes={cursor},next=parseStudioRoute(studioRouteHash(currentRoute(),'library',changes));mindActionFocus={kind:'mind-library-page',scope:next.page+'?'+next.params.toString(),fallback:null};return hooks.navigate?.('library',changes);}
  function renderLibraryActivity(view,toolbar){
    const query=mindLibraryQuery(),pending=mindLibraryLoading||mindLibraryKey!==query.toString(),page=mindLibraryData?.page,items=list(page?.items),singleMind=query.get('profileId')!=='all',ready=!pending&&!mindLibraryError&&!!page,firstEmpty=ready&&!items.length&&!query.has('cursor'),statuses={DRAFT:'검토 대기',CANDIDATE:'검증 대기',VALIDATED:'승인 검토',AWAITING_OBSERVATION:'관측 대기',WAITING_TIME:'관측 기간 대기',DATA_REQUIRED:'후속 자료 필요',OBSERVED:'관측 완료',EVALUATED:'평가 완료',APPROVED:'승인됨',REJECTED:'반려'};
    const detail=item=>item.detailAction==='market-knowledge-detail'?'<button type="button" class="button small" data-library-action="detail" data-library-id="'+esc(item.sourceId)+'">자료 검토</button>':['mind-observation','experience','document-detail','candidate'].includes(item.detailAction)?button(view==='review'?(item.reviewImpact?.version&&item.reviewImpact.version<=item.reviewImpact.currentVersion?'수정·검토':item.reviewImpact?.action||'검증 결과 검토'):'관측 결과',item.detailAction,item.sourceId):'원본 경로 확인 필요';
    const rows=items.map(item=>{const impact=item.reviewImpact,stale=impact?.version&&impact.version<=impact.currentVersion,sourceLabel=impact?.sourceLabel==='user'?'사용자 작성':impact?.sourceLabel,source=impact?sourceLabel+(impact.sourceId?' · '+impact.sourceId:''):'운용 기록';return [esc(when(item.asOf)),...(!singleMind?[esc(item.profileName||profileName(item.profileId))]:[]),esc(item.title)+'<small class="studio-cell-secondary">'+esc((impact?.kindLabel||({'mind-observation':'마인드 후속 관측','legacy-experience':'기존 운용 경험','legacy-memory-candidate':'기억 후보'})[item.kind]||'검토 자료')+(impact?.version?' v'+impact.version:''))+'</small>',view==='review'?'<span>'+esc(sourceLabel||source)+'</span>'+helpTooltip('자료 출처',source+(impact?.sourceUri?' · '+impact.sourceUri:''))+'<small class="studio-cell-secondary">'+esc(when(item.importedAt||item.availableAt))+'</small>':esc(item.mode==='replay'?'과거일자 재생':item.mode==='live'?'실시간 모의':'저장 관측'),...(view==='review'?['<span>'+esc(impact?.destination||'기억 후보 검증')+'</span>'+helpTooltip('승인 효과',(stale?'현재 발행 정책 v'+impact.currentVersion+' 이후의 새 버전으로 수정해야 발행할 수 있습니다. ':'')+(impact?.effect||'검증 결과를 확인하고 변경안을 승인합니다.'))+'<small class="studio-cell-secondary">'+esc(stale?'현재 발행 v'+impact.currentVersion:impact?.changes?.length?'변경: '+impact.changes.join(' · '):impact?.purpose||'근거 검토')+'</small>']:[pct(item.metrics?.netReturn),percentagePoints(item.metrics?.excessReturn)]),esc(stale?'이전 초안 · 새 버전 필요':statuses[item.status]||'저장 상태 확인'),detail(item)];});
    return title(view==='experiences'?'투자 경험':'검토함',(view==='review'&&!firstEmpty?button('문서 추가','document-note','','','primary'):'')+button('새로고침','mind-library-refresh'))+toolbar+'<section class="studio-sheet" data-mind-library-list tabindex="-1" aria-label="'+(view==='review'?'검토 자료':'투자 경험 목록')+'" aria-busy="'+pending+'">'+(pending?'<p class="empty" role="status">저장된 자료를 조회하는 중…</p>':mindLibraryError?'<p class="empty" role="alert">'+esc(mindLibraryError)+' '+button('첫 페이지 조회','mind-library-first')+'</p>':table(['기준 시점',...(!singleMind?['마인드']:[]),'검토 대상',view==='review'?'출처':'자료 범위',...(view==='experiences'?['순수익률','기준 대비 차이']:['승인 후 반영']),'상태',''],rows,query.has('cursor')?{title:'이 페이지에 자료가 없습니다',description:'앞의 자료를 확인하려면 첫 페이지로 돌아가세요.',action:button('첫 페이지 보기','mind-library-first')}:view==='experiences'?{title:'첫 투자 경험을 기록하세요',description:'판단 기록에서 당시 근거와 후속 성과를 연결합니다.',action:'<a class="button small" data-studio-route href="'+esc(studioRouteHash(currentRoute(),'minds',{profileId:currentRoute().params.get('profileId')||'all',view:'records'}))+'">판단 기록 보기</a>'}:{title:'검토할 자료가 없습니다',description:'새 자료를 저장하면 검토함에서 분류와 발행을 이어갈 수 있습니다.',action:button('문서 추가','document-note')}))+(ready&&items.length?'<div class="studio-pagination"><span>'+(!query.has('cursor')&&!page.hasMore?items.length+'건':items.length+'건 표시 · '+page.total+'건 중')+'</span>'+((query.has('cursor')||page.hasMore)?'<div>'+(query.has('cursor')?button(mindLibraryCursors.has(query)?'이전':'처음','mind-library-prev'):'')+(page.hasMore&&page.nextCursor?button('다음','mind-library-next',page.nextCursor):'')+'</div>':'')+'</div>':'')+'</section>';
  }
  function renderLibrary(){
    const profileId=currentRoute().params.get('profileId')||'all',view=currentRoute().params.get('view')||'documents';
    const toolbar='<div class="studio-query-bar">'+profilePicker(profileId)+'</div>';
    if(view==='quant')return quantLibrary.render();
    if(view==='forms')return title('가져오기 양식',button('JSON · YAML 가져오기','document-new','mind-policy'))+'<div class="studio-template-grid">'+MIND_FORM_KINDS.map(kind=>'<button type="button" class="studio-template-card" data-studio-template="true" data-studio-action="document-new" data-studio-id="'+esc(kind)+'"><span class="studio-template-kind">'+esc(formNames[kind])+'</span><span>'+esc({'mind-policy':'투자 철학, 종목 범위와 전략을 작성합니다.','trade-review':'거래 근거와 실제 순성과를 기록합니다.','market-context':'시세, 뉴스와 매크로 자료를 정리합니다.','principle-evidence':'원칙별 성과와 반례를 연결합니다.','weight-proposal':'기준 가중치와 변경 근거를 제안합니다.'}[kind])+'</span><strong>이 양식으로 작성 →</strong></button>').join('')+'</div>';
    if(view==='experiences'||view==='review')return renderLibraryActivity(view,toolbar);
    if(view==='memory')return title('학습 자료')+renderMindKnowledge(profileId,{view:'memory',controls:profilePicker(profileId),headingLevel:2});
    return library.render();
  }
  function renderMindKnowledge(profileId,{view='documents',controls='',headingLevel=3}={}){
    const showMind=profileId==='all';
    if(view==='memory'){
      const head='<div class="studio-query-bar">'+controls+helpLabel('자료 적용 기준','검토·승인된 자료 중 현재 발행 정책과 종목 범위에 맞는 자료를 최근 24개와 입력 용량 한도 안에서 선택합니다. 실제 입력에 사용한 자료는 각 판단 기록에서 확인할 수 있습니다.')+(memoryData?.asOf?'<span>조회 '+esc(when(memoryData.asOf))+'</span>':'')+button('새로고침','memory-refresh','',memoryLoading?'disabled':'')+'</div>';
      if(memoryLoading)return head+'<section class="studio-sheet"><p class="studio-sheet-body" role="status">학습 자료를 조회하는 중…</p></section>';
      if(memoryError)return head+'<section class="studio-sheet"><p class="studio-sheet-body error-text" role="alert">'+esc(memoryError)+'</p></section>';
      const scoped=memoryData?.scope?.profileId===(profileId||'all')?list(memoryData.items):[],labels={MEMORY_BYTE_LIMIT:'실행 입력 용량 한도',SCOPE_MISMATCH:'정책의 종목·실험 범위 확인',NOT_AVAILABLE:'사용 가능 시각 대기',MEMORY_LIMIT:'최근 24개 한도',MEMORY_SCOPE_MISMATCH:'기존 운용 범위 확인',MEMORY_NOT_AVAILABLE:'승인·사용 가능 시각 확인',INVALID_DOCUMENT:'원문 양식 확인',REVIEW_REQUIRED:'승인 검토 필요'};
      const showMemoryMind=showMind||scoped.some(item=>item.profileId!==profileId);
      const legacy=list(workspace.investmentProfiles).filter(p=>(profileId==='all'||p.id===profileId)&&list(workspace.deployments).some(d=>d.investmentProfileId===p.id)).map(p=>({profile:p,memory:byId(workspace.memoryVersions,p.currentMemoryVersionId)})).filter(v=>list(v.memory?.items).length);
      const eligible=scoped.filter(item=>list(item.eligibleInstrumentIds).length),excluded=scoped.filter(item=>!list(item.eligibleInstrumentIds).length);
      const symbol=id=>instruments.find(i=>i.id===id)?.symbol||id?.split(':').at(-1)||'종목 미기록';
      const memoryRows=items=>items.map(item=>{const reasons=list(item.excludedInstrumentReasons),eligibleIds=list(item.eligibleInstrumentIds);return [esc(item.title)+(item.documentId?'<small>'+esc(formNames[item.kind]||'승인 자료')+'</small>':'<small>정책에 고정한 기억</small>'),...(showMemoryMind?[esc(profileName(item.profileId))]:[]),'v'+esc(item.manifestVersion),eligibleIds.length?esc(eligibleIds.map(symbol).join(' · '))+(reasons.length?'<details class="studio-memory-exclusions"><summary>'+new Set(reasons.map(r=>r.instrumentId)).size+'개 종목 제외</summary><ul>'+reasons.map(r=>'<li>'+esc(symbol(r.instrumentId)+' · '+(labels[r.code]||'적용 조건 확인'))+'</li>').join('')+'</ul></details>':''):'<span class="muted">'+esc(reasons.length?[...new Set(reasons.map(r=>symbol(r.instrumentId)+' · '+(labels[r.code]||'적용 조건 확인')))].join(' / '):'적격 종목 없음 · 적용 조건 확인')+'</span>',esc(when(item.availableAt)),item.lastTransmission?.kind==='selection'?esc('종목 선정 · '+when(item.lastTransmission.completedAt||item.lastTransmission.requestAt))+raw(item.lastTransmission,'전달 원본 참조'):item.lastTransmittedDecision?button('매매 결정 · '+when(item.lastTransmittedDecision.completedAt||item.lastTransmittedDecision.requestAt),'decision',item.lastTransmittedDecision.id):'전송 기록 없음',item.documentId?button('원본 열기','document-detail',item.documentId):byId(workspace.memoryCandidates,item.candidateId)?button('원본 열기','candidate',item.candidateId):button('정책 원본','export',item.profileId)];});
      const heads=['자료',...(showMemoryMind?['마인드']:[]),'현재 정책','적격 종목','사용 가능 시각','최근 실제 전달',''];
      const heading=headingLevel===2?'h2':'h3';
      return head+'<section class="studio-sheet" data-memory-eligible>'+(eligible.length?'<div class="studio-sheet-head"><'+heading+'>현재 정책에서 사용할 학습</'+heading+'><span class="tiny muted">'+eligible.length+'개</span></div>':'')+table(heads,memoryRows(eligible),{headingLevel,title:excluded.length||legacy.length?'현재 조건에 맞는 학습 자료가 없습니다':'사용할 학습 자료를 준비하세요',description:excluded.length||legacy.length?'보존된 다른 자료는 아래에서 확인할 수 있습니다.':'판단과 후속 관측을 검토한 자료가 이곳에 모입니다.',action:'<a class="button small" data-studio-route href="'+esc(studioRouteHash(currentRoute(),'library',{view:'experiences',profileId}))+'">투자 경험 보기</a>'})+'</section>'+(excluded.length?'<details class="studio-sheet spaced" data-memory-excluded><summary class="studio-sheet-body">다른 적용 조건의 학습 · '+excluded.length+'개</summary>'+table(heads,memoryRows(excluded))+'</details>':'')+''+(legacy.length?'<details class="studio-sheet spaced"><summary class="studio-sheet-body">이전 운용의 학습 버전</summary>'+table([...(showMind?['마인드']:[]),'버전','항목','원본'],legacy.map(({profile,memory})=>[...(showMind?[esc(profileName(profile.id))]:[]),'v'+memory.version,memory.items.length+'건',raw(memory,'당시 승인 기억 원본')]))+'</details>':'');
    }
    if(view==='observations'){const runs=list(workspace.mindRuns).filter(r=>profileId==='all'||r.profileId===profileId);return '<section class="studio-sheet">'+table(['결정 봉','종목',...(showMind?['마인드']:[]),'관측 상태','관측 종료',''],runs.slice().reverse().map(r=>[esc(when(r.asOf)),esc(r.instrumentId?.split(':').at(-1)),...(showMind?[esc(profileName(r.profileId))]:[]),r.observation?'관측 완료':r.observationState==='WAITING_TIME'?'관측 기간 대기':r.observationState==='DATA_REQUIRED'?'후속 자료 필요':'후속 관측 확인',esc(when(r.observationDueAt)),button('열기','mind-observation',r.id)]),{title:'후속 관측을 기다리고 있습니다',description:'저장된 판단의 관측 기간과 실제 결과를 이곳에서 확인합니다.',action:'<a class="button small" data-studio-route href="'+esc(studioRouteHash(currentRoute(),'minds',{profileId,view:'records'}))+'">판단 기록 보기</a>'})+'</section>';}
    if(!mindData)return '';
    const documents=list(mindData?.documents).filter(d=>(profileId==='all'||(d.document||d).scope?.profileId===profileId)&&(d.document||d).kind!=='mind-policy'),params=currentRoute().params,kind=params.get('documentKind')||'all',status=params.get('documentStatus')||'all',filtered=documents.filter(d=>(kind==='all'||(d.document||d).kind===kind)&&(status==='all'||d.status===status)).reverse(),pageSize=20,pages=Math.max(1,Math.ceil(filtered.length/pageSize)),page=Math.min(pages,Math.max(1,Number(params.get('knowledgePage'))||1)),slice=filtered.slice((page-1)*pageSize,page*pageSize);
    const hasFilter=kind!=='all'||status!=='all';
    if(!documents.length&&!hasFilter)return '<p class="empty" role="status">연결된 검토 문서가 없습니다.</p>';
    return '<div class="studio-query-bar"><label>양식 <select data-studio-knowledge-filter="documentKind"><option value="all">전체 양식</option>'+MIND_FORM_KINDS.filter(k=>k!=='mind-policy').map(k=>'<option value="'+k+'"'+(kind===k?' selected':'')+'>'+esc(formNames[k])+'</option>').join('')+'</select></label><label>검토 상태 <select data-studio-knowledge-filter="documentStatus">'+[['all','전체 상태'],['DRAFT','검토 대기'],['APPROVED','승인됨'],['REJECTED','반려']].map(([id,label])=>'<option value="'+id+'"'+(status===id?' selected':'')+'>'+label+'</option>').join('')+'</select></label><span>'+filtered.length+'건</span></div><section class="studio-sheet" data-knowledge-document-list tabindex="-1" aria-label="검토 문서">'+table(['자료','양식',...(showMind?['마인드']:[]),'검토 상태','JEV 분류','출처 검토','기준 시점',''],slice.map(d=>{const doc=d.document||d,review=mindDocumentReviewView(d);return [esc(doc.title),esc(formNames[doc.kind]||'투자 자료'),...(showMind?[esc(profileName(doc.scope?.profileId))]:[]),esc(review.status),esc(review.classification),esc(review.sourceValidation),esc(when(doc.asOf)),button('검토','document-detail',d.id)];}),{kind:'filtered',title:'조건에 맞는 연결 자료가 없습니다',description:'양식과 검토 상태를 바꾸거나 필터를 해제하세요.',action:button('필터 해제','knowledge-filters-clear')})+(pages>1?'<div class="studio-pagination"><span>'+page+' / '+pages+'페이지</span><div>'+button('이전','knowledge-page',String(page-1),page<=1?'disabled':'')+button('다음','knowledge-page',String(page+1),page>=pages?'disabled':'')+'</div></div>':'')+'</section>';
  }
  function profilePicker(value){return `<label>마인드 <select data-studio-profile><option value="all"${value==='all'?' selected':''}>전체</option>${list(workspace.investmentProfiles).map(p=>`<option value="${esc(p.id)}"${p.id===value?' selected':''}>${esc(profileName(p.id))}</option>`).join('')}</select></label>`;}
  function recordsQuery(){const params=currentRoute().params,query=new URLSearchParams({profileId:params.get('profileId')||'all',kind:params.get('kind')||'all',pageSize:params.get('pageSize')||'20'});for(const key of ['instrumentId','search','status','cursor'])if(params.get(key))query.set(key,params.get(key));return query;}
  async function loadRecords({force=false}={}){if(!workspace||!isRecordsRoute(currentRoute()))return;if(executionModeOf(currentRoute())==='live'){recordsAbort?.abort();recordsGeneration++;lastRecordsKey='';recordsData=null;recordsLoading=false;recordsError='';return loadLiveActivity({force});}const eventProfile=currentRoute().params.get('profileId');if(eventProfile&&eventProfile!=='all'&&list(eventPaperBatch.items()).some(item=>item.profileId===eventProfile)){recordsAbort?.abort();recordsGeneration++;lastRecordsKey='';recordsData=null;recordsLoading=false;recordsError='';return;}const query=recordsQuery(),key=query.toString();if(!force&&lastRecordsKey===key)return;recordsAbort?.abort();recordsAbort=new AbortController();const token=++recordsGeneration;lastRecordsKey=key;recordsLoading=true;recordsData=null;recordsError='';redraw();try{const value=await request('/api/workspace/terminal/records?'+query,undefined,{signal:recordsAbort.signal});if(token!==recordsGeneration)return;recordsData=value;recordsLoading=false;redraw();}catch(problem){if(token!==recordsGeneration||problem.name==='AbortError')return;recordsLoading=false;recordsError=problem.status===409?'기록이 갱신되었습니다. 첫 페이지에서 다시 조회하세요.':problem.message;redraw();}}
  function renderRecords(){
    if(executionModeOf(currentRoute())==='live'){
      const id=currentRoute().params.get('profileId')||'all',state=liveActivity.state(),decisions=currentRoute().params.get('kind')==='decisions',query=currentRoute().params.get('search')||'',selectedRecords=item=>filterMindActivityRecords(item.recentActivity,{decisions,search:query}),candidates=id==='all'?(liveActivity.items()??[]):[liveActivity.get(id)].filter(Boolean),items=candidates.filter(item=>id!=='all'||selectedRecords(item).length>0);
      const tabs='<nav class="studio-local-tabs" aria-label="운용 기록 유형">'+[['fills','매매'],['decisions','판단']].map(([kind,label])=>'<a class="button small" href="'+esc(studioRouteHash(currentRoute(),'minds',{view:'records',kind,cursor:null}))+'" data-studio-route'+((decisions?'decisions':'fills')===kind?' aria-current="page"':'')+'>'+label+'</a>').join('')+'</nav>';
      const total=candidates.reduce((n,item)=>n+filterMindActivityRecords(item.recentActivity,{decisions}).length,0),matches=candidates.reduce((n,item)=>n+selectedRecords(item).length,0);
      const searchTools='<div class="studio-live-record-query"><div class="studio-query-bar"><label class="studio-record-search"><span>검색</span><input type="search" data-studio-search aria-label="최근 운용 기록 검색" aria-describedby="live-record-search-scope" value="'+esc(recordSearchValue())+'" placeholder="종목·매수/매도·상태"></label>'+renderFilterSummary([{label:'검색',value:query,remove:button('×','live-record-search-clear','','aria-label="최근 기록 검색 해제"','workflow-filter-remove')}])+'</div><p id="live-record-search-scope" class="tiny muted">불러온 최근 기록에서 검색합니다. '+(query&&state.data&&!state.error?'<span role="status">불러온 '+total+'건 중 '+matches+'건 일치</span> · ':'')+'마인드별 최대 '+(id==='all'?6:30)+'건 표시.</p></div>';

      return mindHeading('기록',button('새로고침','companion-refresh'))+tabs+searchTools+(state.error?'<p role="alert">'+esc(state.error)+'</p>':!state.data?'<p role="status">운용 기록을 불러오는 중…</p>':query&&!matches?'<p class="empty" role="status">검색과 일치하는 최근 기록이 없습니다. 검색 조건을 해제하거나 바꿔 보세요.</p>':!items.length?'<p class="empty">최근 '+(decisions?'판단':'매매')+' 기록이 없습니다.</p>':(id==='all'&&!query?'<p class="tiny muted spaced">최근 '+(decisions?'판단':'매매')+' 기록이 있는 마인드 '+items.length+'개</p>':'')+'<div class="studio-record-groups"'+(id==='all'?' data-record-summary':'')+'>'+items.map(item=>(id==='all'?'<section class="studio-sheet studio-record-group"><div class="studio-sheet-head"><div class="studio-record-heading"><h2 id="'+esc('live-records-'+encodeURIComponent(item.activationId??item.profileId))+'"><a class="studio-record-link" data-studio-route href="'+esc(studioRouteHash(currentRoute(),'minds',{profileId:item.profileId,view:'records',cursor:null}))+'">'+esc(profileName(item.profileId))+' <span aria-hidden="true">↗</span></a></h2><span class="pill">최근 '+Math.min(6,selectedRecords(item).length)+'건</span></div></div>':'')+renderMindActivityFeed({...item,recentActivity:selectedRecords(item)},{limit:id==='all'?6:30,showDecisions:decisions,collapseHolds:!query,includeLatestDecision:false,labelledBy:id==='all'?'live-records-'+encodeURIComponent(item.activationId??item.profileId):undefined})+(id==='all'?'</section>':'')).join('')+'</div>');
    }

    const query=recordsQuery(),page=recordsData?.page,items=list(page?.items),instrumentId=query.get('instrumentId')||'',profileId=query.get('profileId'),kind=query.get('kind');
    const eventState=eventPaperBatch.state(),eventMessage=eventState.loading?'분봉 모의 원장을 조회하는 중…':eventState.error,eventNotice=eventMessage?'<section class="studio-sheet spaced" data-paper-records-read tabindex="-1" aria-label="분봉 모의 기록 조회"><div class="studio-sheet-body"><p role="'+(eventState.loading?'status':'alert')+'">'+esc(eventMessage)+'</p>'+(eventState.data&&eventState.readAt?'<p class="tiny muted">저장된 분봉 기록은 마지막 정상 조회 '+esc(when(new Date(eventState.readAt).toISOString()))+' 기준입니다.</p>':'')+button(eventState.loading?'분봉 원장 조회 중…':'분봉 기록 다시 조회','paper-records-refresh','',eventState.loading?'disabled':'')+'</div></section>':'';
    const eventItems=list(eventPaperBatch.items()).filter(item=>profileId==='all'||item.profileId===profileId),decisions=kind==='decisions',eventRecords=eventItems.map(item=>'<section class="studio-sheet studio-record-group spaced" data-event-paper-records><div class="studio-sheet-head"><h2 id="'+esc('paper-records-'+encodeURIComponent(item.id??item.profileId))+'">'+esc(profileName(item.profileId))+' · 최근 분봉 모의 기록</h2>'+button('운용 원장 열기','mind-view',item.profileId,'data-studio-view="operations"')+'</div>'+renderMindActivityFeed(decisions?{...item,recentActivity:list(item.recentActivity).filter(record=>record.kind==='DECISION')}:item,{limit:30,showDecisions:decisions,includeLatestDecision:false,labelledBy:'paper-records-'+encodeURIComponent(item.id??item.profileId)})+'</section>').join('');
    if(profileId!=='all'&&eventItems.length){const tabs='<nav class="studio-local-tabs" aria-label="운용 기록 유형">'+[['fills','매매'],['decisions','판단']].map(([kind,label])=>'<a class="button small" href="'+esc(studioRouteHash(currentRoute(),'minds',{view:'records',kind,cursor:null}))+'" data-studio-route'+((decisions?'decisions':'fills')===kind?' aria-current="page"':'')+'>'+label+'</a>').join('')+'</nav>';return mindHeading('기록',button('새로고침','refresh'))+tabs+eventNotice+eventRecords;}
    const unfiltered=kind==='all'&&!['instrumentId','search','status','cursor'].some(key=>query.get(key));
    if(page?.total===0&&!items.length&&!recordsLoading&&!recordsError&&!recordFieldFocus&&unfiltered&&eventState.data&&!eventState.loading&&!eventState.error)return mindHeading('기록',button('새로고침','refresh'))+eventRecords+(!eventItems.length?'<p class="empty" role="status">모의 운용 기록이 없습니다.</p>':'');
    const statusOptions=[['','전체 상태'],['HOLD_SELECTED','보유량 유지'],['PAPER_REVIEW_READY','모의 주문 검토 대기'],['RISK_BLOCKED','위험·비용 조건 제한'],['FILLED','모의 체결 완료'],['FAILED','실행 실패']];
    return mindHeading('기록',(items.length?button(eventNotice||eventRecords?'결정·체결 기록 내보내기':'현재 페이지 내보내기','export-records','',recordsLoading?'disabled':''):'')+button('새로고침','refresh'))+eventNotice+eventRecords+(eventNotice||eventRecords?'<h2 class="studio-record-source-heading">결정·체결 기록</h2>':'')+'<div class="studio-query-bar"><label>종목 <select data-studio-record-filter="instrumentId"><option value="">전체 종목</option>'+instruments.map(i=>'<option value="'+esc(i.id)+'"'+(i.id===instrumentId?' selected':'')+'>'+esc(i.symbol+' · '+i.name)+'</option>').join('')+'</select></label><label>유형 <select data-studio-record-filter="kind">'+[['all','전체'],['decisions','결정'],['fills','체결']].map(([id,label])=>'<option value="'+id+'"'+(id===kind?' selected':'')+'>'+label+'</option>').join('')+'</select></label><label>상태 <select data-studio-record-filter="status">'+statusOptions.map(([id,label])=>'<option value="'+id+'"'+(id===(query.get('status')||'')?' selected':'')+'>'+label+'</option>').join('')+'</select></label><label class="studio-record-search">검색 <input type="search" aria-label="결정 기록 검색" aria-describedby="paper-record-search-dates" data-studio-search value="'+esc(recordSearchValue())+'" placeholder="날짜·종목·마인드·ID"></label>'+(page?'<span>'+num(page.total,0)+'건</span>':recordsLoading?'<span role="status">조회 중</span>':'')+'</div><p id="paper-record-search-dates" class="tiny muted">검색 예시 2026-11-12 BTC-USDT · 기준 봉, 결정 실행 또는 체결 시각의 한국 날짜로 찾습니다.</p><section class="studio-sheet" aria-busy="'+recordsLoading+'">'+(recordsLoading?'<div class="empty">기록을 조회하는 중…</div>':recordsError?'<div class="empty" role="alert">'+esc(recordsError)+' '+button('첫 페이지 조회','record-first')+'</div>':table(['기준 봉 / 결정 실행','유형','종목','마인드','행동','수량','가격','확신도 / 수수료','상태',''],items.map(r=>[recordTimeMarkup(r),r.kind==='fill'?'체결':'결정',esc(r.instrumentId?.split(':').at(-1)||'—'),esc(r.profileName||profileName(r.profileId)),esc(({buy:'매수',sell:'매도',hold:'유지'})[r.action]||'확인'),num(r.quantity,8),money(r.price,r.quoteCurrency||instrumentCurrency(r.instrumentId)),r.kind==='fill'?money(r.fee,r.quoteCurrency||instrumentCurrency(r.instrumentId))+' '+esc(r.quoteCurrency||''):pct(r.confidence),esc(executionLabel(r.status)),button('상세','decision',r.decisionId||r.id)]),'조회 조건에 맞는 기록이 없습니다.'))+(items.length||query.get('cursor')||recordsLoading?'<div class="studio-pagination"><span>'+(page?num(items.length,0)+'건 표시 · '+num(page.total,0)+'건 중':'')+'</span><label>페이지당 <select data-studio-record-filter="pageSize" aria-label="페이지당 기록 수">'+['10','20','50'].map(size=>'<option value="'+size+'"'+(size===query.get('pageSize')?' selected':'')+'>'+size+'개</option>').join('')+'</select></label><div>'+button(recordCursors.has(query)?'이전':'처음','record-prev','',query.get('cursor')&&!recordsLoading?'':'disabled')+button('다음','record-next',page?.nextCursor||'',page?.hasMore&&!recordsLoading?'':'disabled')+'</div></div>':'')+'</section>';
  }
  function renderSettings(){
    const jobs=list(workspace.scheduler?.jobs),deployments=list(workspace.deployments),view=currentRoute().params.get('view')||'connections';
    if(view==='capabilities')return title('기능 목록',CAPABILITY_GUIDE+button('새로고침','refresh'))+'<p class="spaced">'+MIND_STARTER_GUIDE+'</p>'+renderCapabilityCatalog({data:capabilityData,loading:capabilityLoading,error:capabilityError,openGroups:capabilityOpenGroups,query:capabilityQuery});
    if(view==='accounts')return renderAccounts();
    if(view==='automation'&&executionModeOf(currentRoute())==='live'){
      const state=liveActivity.state(),items=list(liveActivity.items());
      return title('자동 운용',button('새로고침','companion-refresh'))+(state.error?'<p role="alert">'+esc(state.error)+'</p>':!state.data?'<p class="empty" role="status">운용 상태를 불러오는 중…</p>':!items.length?'<section class="studio-sheet"><div class="studio-sheet-body"><p>운용할 마인드를 선택하세요.</p><a class="button primary" href="'+esc(studioRouteHash(currentRoute(),'minds',{profileId:'all',view:'overview',executionMode:'live'}))+'" data-studio-route>마인드 보기</a></div></section>':items.map(item=>'<section class="studio-sheet spaced" aria-label="'+esc(profileName(item.profileId)+' 자동 운용')+'"><div class="studio-sheet-head"><h2>'+esc(profileName(item.profileId))+'</h2></div>'+renderMindActivityHero(item,{idPrefix:'automation-'+item.activationId,avatarConfig:readMindAppearance(workspace,item.profileId).config,controls:'<a class="button primary" href="'+esc(studioRouteHash(currentRoute(),'minds',{profileId:item.profileId,view:'operations',executionMode:'live'}))+'" data-studio-route>운용 관리</a>'})+'</section>').join(''));
    }
    if(view==='data'){
      const returnTo=currentRoute().params.get('returnTo'),captureFirst=returnTo&&parseStudioRoute(returnTo).page==='trade';
      const sources=renderSectorSources(),capture=renderCaptureStatus();
      return title('데이터',button('상태 새로고침','capture-status','',captureLoading||sectorCatalogLoading||captureCollecting||sectorCollecting||upbitCollecting?'disabled':''))+(captureFirst?capture+sources:sources+capture)+'<section class="studio-sheet spaced"><div class="studio-sheet-head"><h2>'+helpLabel('저장 기록','현재 워크스페이스의 기록을 JSON 파일로 내려받습니다.')+'</h2></div><div class="studio-sheet-body">'+row('저장 위치','개인 워크스페이스 서버')+row('내보내기 범위','마인드·결정·모의 계좌·경험·학습 자료의 저장 원본')+'</div><div class="studio-data-actions actions">'+button('서버 기록 내보내기','export-workspace')+'</div></section>'+(executionModeOf(currentRoute())==='paper'?'<section class="studio-sheet spaced"><div class="studio-sheet-head"><h2>투자 기록 초기화</h2>'+button('삭제 범위 확인','workspace-reset','','','danger')+'</div><div class="studio-sheet-body">'+helpLabel('마인드와 투자 기록 삭제','마인드·모의 계좌·거래·실험·학습 기록을 영구 삭제합니다. 연결 설정과 공용 시세·라이브러리는 이어서 사용합니다.')+'</div></section>':'');
    }
    if(view==='automation')return title('자동 운용',button('예약 작업 확인','jobs-run','',busy?'disabled':''))+renderEventPaperAutomation()+renderAutomationSubscriptions()+'<section class="studio-sheet spaced"><div class="studio-sheet-head"><h2>이전 운용 기록</h2><span class="tiny muted">계좌·정책·거래 원본 보관</span></div>'+table(['운용','마인드','유형','기록 기준',''],deployments.map(d=>[esc(d.name),esc(profileName(d.investmentProfileId)),esc(d.experimentType==='FORWARD_PAPER'?'이전 모의 운용':'과거 실험'),esc(when(d.updatedAt)),button('기록 보기','deployment',d.id)]),'보관한 이전 운용이 없습니다.')+'</section>';
    return title('서비스 연결',button(connectionLoading?'상태 조회 중…':'상태 새로고침','connections','',connectionLoading?'disabled aria-busy="true"':''))+`<section class="studio-sheet"><div class="studio-sheet-body">${connectionError?'<p role="alert">'+esc(connectionError)+' 상태 새로고침을 눌러 다시 조회하세요.</p>':''}${connectionMessage?'<p role="status">'+esc(connectionMessage)+'</p>':''}${connectionSummary()}${connectionDetails('raw','연결 상태 원본','<pre class="code">'+esc(JSON.stringify({jev:status?.jev,connections:mindData?.connections},null,2))+'</pre>')}</div></section>`;
  }
  function renderAccounts(){
    if(executionModeOf(currentRoute())==='live')return title('계좌·자금',brokerPaperReturnLink(currentRoute()))+brokers.render();
    const batch=eventPaperBatch.state(),head='<section class="studio-sheet" data-paper-budget aria-busy="'+batch.loading+'"><div class="studio-sheet-head"><h2>'+helpLabel('모의 예산','통화별 공용 예산에서 마인드에 자금을 배정합니다. 총자산은 미배정 현금과 마인드의 현금·보유 평가액을 합산합니다.')+'</h2>'+button(batch.loading?'조회 중…':batch.error?'다시 조회':'자금 새로고침','refresh','',batch.loading?'disabled':'')+'</div>';
    const readState=batch.loading||batch.error?'<div class="studio-sheet-body" data-paper-account-read><p role="'+(batch.error?'alert':'status')+'">'+esc(batch.error||'모의 예산과 배정 내역을 조회하는 중…')+'</p>'+(batch.data&&batch.readAt?'<p class="tiny muted">표시된 금액은 마지막 정상 조회 '+esc(when(new Date(batch.readAt).toISOString()))+' 기준입니다.</p>':'')+'</div>':'';
    if(!batch.data)return title('계좌·자금')+head+readState+'</section>';
    const currencies=['KRW','USD','USDT','BTC'],summaries=currencies.map(c=>list(batch.data.budgets).find(b=>b.quoteCurrency===c)??paperBudgetSummary(workspace,c)),accountMoney=(value,currency)=>value===null||value===undefined?'—':'<span title="'+esc(value+' '+currency)+'">'+money(Number(value),currency)+'</span>';
    const accounts=[...summaries.flatMap(b=>list(b.accounts)),...list(batch.data.subscriptions).filter(s=>s.status!=='COMPLETED').map(s=>({...s.ledger,id:s.accountId,profileId:s.profileId,quoteCurrency:s.config.quoteCurrency,eventPaperId:s.id}))];
    const existingBudgets=summaries.filter(b=>b.configured||accounts.some(a=>a.quoteCurrency===b.quoteCurrency)||[b.totalBudget,b.exactAvailable??b.available,b.allocated,b.exactHoldingsValue??b.holdingsValue,b.exactEquity??b.equity].some(v=>v!==null&&v!==undefined&&Number(v)!==0)),setupBudgets=summaries.filter(b=>!existingBudgets.includes(b));
    const rows=existingBudgets.map(b=>[esc(b.quoteCurrency),accountMoney(b.totalBudget,b.quoteCurrency),accountMoney(b.exactAvailable??b.available,b.quoteCurrency),accountMoney(b.allocated,b.quoteCurrency),accountMoney(b.exactHoldingsValue??b.holdingsValue,b.quoteCurrency),accountMoney(b.exactEquity??b.equity,b.quoteCurrency),button(b.configured?'예산 수정':'예산 설정','budget-edit',b.quoteCurrency)]);
    const setup=setupBudgets.length?'<div class="studio-budget-setup" data-paper-budget-setup><h3>통화 예산 설정</h3><div class="actions">'+setupBudgets.map(b=>button(b.quoteCurrency+' 예산 설정','budget-edit',b.quoteCurrency)).join('')+'</div></div>':'';
    const practice=existingBudgets.some(b=>b.configured)&&!list(workspace.mindRuns).length&&!list(workspace.decisionRecords).length
      ?'<section class="studio-sheet spaced"><div class="studio-sheet-head"><h2>첫 모의 판단</h2></div><div class="studio-sheet-body"><p>보관한 BTC 시세로 실습하거나 현재 확정 시세로 BTC-USDT 국면 추세를 연습할 수 있습니다. 두 실습 모두 JEV 키 없이 진행합니다. 현재 시세 실습은 USDT 모의 자금을 별도로 준비합니다.</p><div class="actions spaced"><a class="button primary" href="'+PAPER_PRACTICE_ENTRY+'" data-studio-route>키 없이 과거 데이터로 실습</a><a class="button" href="'+PAPER_DECISION_ENTRY+'" data-studio-route>현재 시세로 모의 판단</a></div></div></section>':'';
    return title('계좌·자금')+practice+head+readState+(rows.length?table(['통화','총 예산','배정 가능','마인드 배정','보유 평가액','총자산',''],rows):'')+setup+'</section><section class="studio-sheet spaced" data-paper-accounts aria-busy="'+batch.loading+'"><div class="studio-sheet-head"><h2>마인드별 자금</h2>'+button('마인드에 배정','mind-account')+'</div>'+table(['마인드','통화','현금','보유 평가액','평가자산',''],accounts.map(a=>[esc(profileName(a.profileId)),esc(a.quoteCurrency),accountMoney(a.cash,a.quoteCurrency),accountMoney(a.holdingsValue,a.quoteCurrency),accountMoney(a.equity,a.quoteCurrency),a.eventPaperId?button('모의 운용 열기','mind-view',a.profileId,'data-studio-view="operations"'):button('배정·회수','funding-edit',a.id)]),existingBudgets.length?'아직 마인드에 배정한 자금이 없습니다.':'통화 예산을 설정한 뒤 마인드에 자금을 배정하세요.')+'</section>';
  }
  function renderBrokerConnections(){return '<section class="studio-sheet spaced"><div class="studio-sheet-head"><h2>증권·거래소 계좌</h2></div><div class="studio-sheet-body">'+row('토스증권','<a href="https://www.tossinvest.com/signin?redirectUrl=%2Fopen-api%2Flanding" target="_blank" rel="noopener">토스증권 연결 준비 ↗</a>')+row('업비트','<a href="https://upbit.com/mypage/open_api_management" target="_blank" rel="noopener">업비트 연결 준비 ↗</a>')+'</div></section>';}
  function openBudgetForm(currency='USDT',mindId=''){
    const b=paperBudgetSummary(workspace,currency);
    const currencyField=mindId
      ?'<div class="full">'+row('종목의 결제 통화',esc(currency))+'<p>예산을 저장한 뒤 '+esc(profileName(mindId))+'에 배정할 금액을 선택합니다.</p></div><input type="hidden" name="quoteCurrency" value="'+esc(currency)+'">'
      :select('통화','quoteCurrency',['KRW','USD','USDT','BTC'].map(c=>[c,c]),currency);
    form('모의 예산 설정','paper-budget',currencyField+field('총 모의 예산','totalBudget',b.totalBudget||({KRW:10000000,USD:10000,USDT:10000,BTC:0.1}[currency]),'number','min="0.00000001" max="1000000000000" step="any"')+'<div class="full">'+helpLabel('배정된 자금 보존','현재 마인드에 배정된 원금을 포함한 총 예산입니다. 배정 가능 금액만 줄일 수 있습니다.')+'</div>',mindId,mindId?'예산 저장 후 배정':'저장');
  }
  function renderEventPaperAutomation(){
    const state=eventPaperBatch.state(),items=list(eventPaperBatch.items()),head='<section class="studio-sheet spaced" aria-busy="'+state.loading+'"><div class="studio-sheet-head"><h2>분봉 모의운용</h2></div>';
    if(!state.data)return head+'<p class="studio-sheet-body" role="'+(state.error?'alert':'status')+'">'+esc(state.error||'분봉 모의운용을 조회하는 중…')+'</p></section>';
    return head+(state.error?'<p class="studio-sheet-body error-text" role="alert">'+esc(state.error)+'</p>':'')+table(['마인드','상태','투자 범위','계좌','최근 판단',''],items.map(item=>[esc(profileName(item.profileId)),esc(({ENABLED:'모의 운용 중',PAUSED:'일시중지',COMPLETED:'종료 · 자금 회수 완료'})[item.status]||'운용 상태 확인'),esc(list(item.config?.marketIds).join(' · ')),esc(item.config?.quoteCurrency||item.ledger?.quoteCurrency||'—'),esc(when(item.lastDecision?.at||item.runtime?.lastEvaluationAt)),button('운용 열기','mind-view',item.profileId,'data-studio-view="operations"')]),'설정한 분봉 모의운용이 없습니다.')+'</section>';
  }
  function renderAutomationSubscriptions(){
    const head='<section class="studio-sheet" aria-busy="'+subscriptionLoading+'"><div class="studio-sheet-head"><h2>마인드 자동 운용</h2><span class="tiny muted">전체 마인드 · USDT 4시간봉</span></div>';
    if(subscriptionLoading)return head+'<p class="studio-sheet-body" role="status">마인드 자동 운용을 조회하는 중…</p></section>';
    if(subscriptionError)return head+'<p class="studio-sheet-body error-text" role="alert">'+esc(subscriptionError)+'</p></section>';
    const subscriptions=subscriptionMindId==='all'?list(subscriptionData?.subscriptions):[];
    return head+table(['마인드','상태','고정 정책','계좌','다음 기준 봉 / 처리 가능','최근 전달 / 실패',''],subscriptions.map(s=>[esc(profileName(s.profileId)),esc(subscriptionStateLabel(s.status)),'v'+esc(s.manifestVersion),esc(s.quoteCurrency||'USDT'),esc(when(s.nextBarCloseAt))+'<small>처리 가능 '+esc(when(s.nextAttemptAt||s.nextEligibleAt))+'</small>',s.lastFailure?'<span class="error-text">'+esc(s.lastFailure.message||'실패 원본 확인')+'</span><small>'+esc(when(s.lastFailure.occurredAt||s.lastFailure.failedAt))+'</small>':s.lastMcpDeliveryAt?'클라우드 전달 '+esc(when(s.lastMcpDeliveryAt)):'클라우드 전달 기록 없음',button('운용 열기','mind-view',s.profileId,'data-studio-view="operations"')]),'설정한 마인드 자동 운용이 없습니다.')+'</section>';
  }
  async function loadCaptureStatus(){
    if(currentRoute().page!=='settings'||currentRoute().params.get('view')!=='data'){captureGeneration++;captureLoading=false;sectorCatalogLoading=false;return;}
    const token=++captureGeneration;captureLoading=true;sectorCatalogLoading=true;captureStatusError='';sectorCatalogError='';redraw();
    const results=await Promise.allSettled([request('/api/workspace/market-captures/status'),request('/api/workspace/universe/catalog')]);
    if(token!==captureGeneration)return;
    if(results[0].status==='fulfilled')captureData=results[0].value.collection;else captureStatusError=results[0].reason.message;
    if(results[1].status==='fulfilled')sectorCatalog=results[1].value;else sectorCatalogError=results[1].reason.message;
    captureLoading=false;sectorCatalogLoading=false;redraw();
  }
  let upbitCollecting=false,upbitCollectionError='';
  function collectUpbitCatalog(){if(busy)throw new Error('진행 중인 작업이 끝난 뒤 다시 시도하세요.');return mutate('',{provider:'upbit'},'/api/workspace/universe/sources');}
  async function collectUpbitSource(node){
    if(upbitCollecting||busy)return;
    restoreMindActionFocus('upbit-collect','');
    const restore=commandProgress(node,'업비트 목록 가져오는 중…');upbitCollecting=true;upbitCollectionError='';redraw();let problem=null;
    try{await collectUpbitCatalog();await loadCaptureStatus();}
    catch(error){problem=error;upbitCollectionError=error.message;}
    finally{upbitCollecting=false;restore(problem);redraw();}
  }
  function dataSourceCard(kind,heading,count,body,actions,loading=false){
    return '<section class="studio-sheet studio-data-card" data-'+kind+'-sources aria-labelledby="data-source-'+kind+'" aria-busy="'+loading+'"><div class="studio-sheet-head"><h3 id="data-source-'+kind+'" tabindex="-1">'+heading+'</h3><span class="pill">'+esc(count)+'</span></div><div class="studio-sheet-body">'+body+'</div><div class="studio-data-actions actions">'+actions+'</div></section>';
  }
  function renderSectorSources(){
    const catalog=sectorCatalog,ref=catalog?.sectorSnapshotRef,connected=catalog?.toss?.collectAvailable===true,waiting=sectorCatalogLoading||sectorCollecting||upbitCollecting||busy;
    const connectHref=studioRouteHash(currentRoute(),'settings',{view:'accounts',executionMode:'live'}),connectLabel=catalog?.toss?.status==='NETWORK_REQUIRED'?'토스 허용 IP 설정':'토스 계좌 연결';
    const stocks=catalog?.equities,stockReady=catalog?.toss?.collectAvailable===true||stocks?.syncAvailable===true,stockCount=Number.isSafeInteger(stocks?.count)?num(stocks.count,0)+'개':'조회 필요';
    const result=kind=>sectorCollectionKind===kind?(sectorCollectionMessage?'<p class="tiny spaced" role="status">'+esc(sectorCollectionMessage)+'</p>':'')+(sectorCollectionError?'<p class="error-text spaced" role="alert">'+esc(sectorCollectionError)+'</p>':''):'';
    const stocksSection=dataSourceCard('equity','주식 종목 목록','한국·미국 주식 '+stockCount,
      (sectorCatalogLoading&&!catalog?'<p role="status">주식 종목 목록을 조회하는 중…</p>':row('자료 기준',stocks?.asOf?esc(when(stocks.asOf)):'자료 연결 필요'))+(catalog&&!stockReady?'<p class="tiny spaced"><a href="'+esc(connectHref)+'" data-studio-route>'+connectLabel+'</a></p>':'')+result('stocks'),
      button('주식 종목 찾기','instrument-catalog','',sectorCatalogLoading?'disabled':'')+button(sectorCollecting&&sectorCollectionKind==='stocks'?'종목 목록 수집 중…':'토스 전체 종목 가져오기','stocks-collect','',waiting||!stockReady?'disabled':''),sectorCatalogLoading||sectorCollecting&&sectorCollectionKind==='stocks');
    const upbit=catalog?.upbit,upbitSection=dataSourceCard('upbit','업비트 종목 목록','거래쌍 '+(Number.isSafeInteger(upbit?.count)?num(upbit.count,0)+'개':'조회 필요'),
      (sectorCatalogLoading&&!catalog?'<p role="status">업비트 종목 목록을 조회하는 중…</p>':row('자료 기준',upbit?.asOf?esc(when(upbit.asOf)):'목록 가져오기 필요'))+(upbitCollectionError?'<p role="alert" class="error-text">'+esc(upbitCollectionError)+'</p>':''),
      button(upbitCollecting?'업비트 목록 가져오는 중…':'업비트 종목 가져오기','upbit-collect','',waiting?'disabled':''),sectorCatalogLoading||upbitCollecting);
    const sectorsSection=dataSourceCard('sector',helpLabel('섹터 자료','토스증권의 섹터 분류와 시장별 순위, 구성 종목을 공용 자료로 저장합니다. 마인드의 투자 범위와 시장 추천에서 함께 사용합니다.'),'등록 섹터 '+(catalog?num(list(catalog.sectors).length,0)+'개':'조회 필요'),
      (sectorCatalogLoading&&!catalog?'<p role="status">섹터 자료를 조회하는 중…</p>':row('자료 기준',ref?esc(when(ref.availableAt)):catalog?'자료 연결 필요':'조회 필요'))+(catalog&&!connected?'<p class="tiny spaced"><a href="'+esc(connectHref)+'" data-studio-route>'+connectLabel+'</a></p>':'')+result('sectors'),
      button(sectorCollecting&&sectorCollectionKind==='sectors'?'섹터 자료 수집 중…':'토스 섹터 가져오기','sector-collect','',waiting||!connected?'disabled':'')+button('자료 가져오기','sector-import','',waiting?'disabled':''),sectorCatalogLoading||sectorCollecting&&sectorCollectionKind==='sectors');
    return '<section class="studio-data-group" aria-labelledby="data-catalog-title"><div class="studio-data-group-head"><h2 id="data-catalog-title">종목 탐색 자료</h2></div>'+(sectorCatalogError?'<p class="error-text studio-data-group-error" role="alert">'+esc(sectorCatalogError)+' '+button('목록 다시 조회','sector-status','',waiting?'disabled':'')+'</p>':'')+'<div class="studio-data-grid">'+upbitSection+stocksSection+sectorsSection+'</div></section>';
  }
  async function collectSectorSource(node){
    if(sectorCollecting||busy)return;
    const formNode=node.closest?.('[data-studio-form="universe-policy"]'),state=formNode?universeEditorState(formNode):null,dialogToken=hooks.getDialogToken?.();
    if(isDataSettings())restoreMindActionFocus('sector-collect','');const restore=commandProgress(node,'섹터 자료 수집 중…');sectorCollecting=true;sectorCollectionKind='sectors';sectorCollectionError='';sectorCollectionMessage='';redraw();let problem=null;
    try{
      const result=await mutate('',{provider:'toss',markets:['KR','US'],...(state?.draft?.equities?.sectorIds?.length?{sectorIds:state.draft.equities.sectorIds}:{})},'/api/workspace/universe/sources');
      sectorCollectionMessage=Number.isSafeInteger(result.source?.sectorCount)?'토스 섹터 '+num(result.source.sectorCount,0)+'개를 저장했습니다.':'토스 섹터 자료를 저장했습니다.';
      if(state&&dialogIsCurrent(dialogToken))await openUniverseEditor(state.mindId,state.draft,state.searches);else if(!state)await loadCaptureStatus();
      hooks.toast?.(sectorCollectionMessage);
    }catch(error){problem=error;sectorCollectionError=error.message;const target=formNode?.querySelector?.('[data-studio-form-error]');if(target&&formNode.isConnected!==false)target.textContent=error.message;else hooks.toast?.(error.message);}
    finally{sectorCollecting=false;restore(problem);redraw();}
  }
  function renderCaptureStatus(){
    const c=captureData,latest=c?.latest,lastError=c?.lastError,scope=(c?.provider||'okx').toUpperCase()+' · '+(c?.instrumentId?.split(':').at(-1)||'BTC-USDT')+' · '+({'4h':'4시간봉','1d':'일봉'}[c?.timeframe||'4h']||c.timeframe),status=({READY:'현재 확정 봉 보관됨',WAITING_SETTLEMENT:'확정 봉 수집 시각 대기',COOLDOWN:'공급처 재요청 대기',COLLECTION_REQUIRED:'확정 시세 수집 필요'})[c?.status]||'수집 상태 확인',disabled=busy||captureLoading||captureCollecting||!!captureStatusError||c?.canCollect!==true;
    return '<section class="studio-sheet studio-data-group" aria-labelledby="data-capture-title" aria-busy="'+(captureLoading||captureCollecting)+'"><div class="studio-sheet-head"><div><h2 id="data-capture-title" tabindex="-1">확정 시세 보관</h2><p class="studio-data-scope">'+esc(scope)+'</p></div>'+(c?'<span class="pill" aria-label="수집 상태: '+esc(status)+'">'+esc(status)+'</span>':'')+'</div><div class="studio-sheet-body">'+
      (captureCollecting?'<p class="tiny spaced" role="status" aria-live="polite">OKX에서 확정 봉 원문을 수집하고 보관하는 중…</p>':captureLoading?'<p class="tiny spaced" role="status">수집 상태를 조회하는 중…</p>':captureMessage?'<p class="tiny spaced" role="status">'+esc(captureMessage)+'</p>':'')+
      (captureStatusError?'<p class="error-text spaced" role="alert">'+esc(captureStatusError)+' '+button('상태 다시 조회','capture-status','',captureLoading?'disabled':'')+'</p>':'')+(captureActionError?'<p class="error-text spaced" role="alert">'+esc(captureActionError)+'</p>':'')+
      (c?row('현재 보관한 기준 봉',latest?esc(when(latest.latestClosedAsOf)):'보관된 시세 없음')+(!c.canCollect&&['WAITING_SETTLEMENT','COOLDOWN'].includes(c.status)?row('다음 수집 가능',esc(when(c.nextAllowedAt))):'')+'<details class="spaced"><summary>수집 상세</summary>'+row('공급처',esc((c.provider==='okx'?'OKX':c.provider)+' · '+(c.origin||'접속 주소 미기록')))+row('필요한 기준 봉',esc(when(c.requiredClosedAsOf)))+(latest?row('원문 수신',esc(when(latest.receivedAt)))+row('자료 사용 가능',esc(when(latest.availableAt)))+row('보관 봉 수','4시간봉 '+num(latest.candleCount,0)+'개 · 일봉 '+num(latest.dailyCandleCount,0)+'개'):'')+row('다음 수집 가능',esc(when(c.nextAllowedAt)))+
      (lastError?'<section class="spaced"><h3>최근 수집 실패</h3>'+row('공급처 응답',lastError.httpStatus?'HTTP '+esc(lastError.httpStatus):'응답 상태 미기록')+row('실패 시각',esc(when(lastError.failedAt)))+row('재요청 가능',esc(when(lastError.nextAllowedAt)))+(lastError.retryAfter!==null&&lastError.retryAfter!==undefined?row('공급처 Retry-After',esc(lastError.retryAfter)):'')+'</section>':'')+raw(c,'수집 출처·원문 식별값')+'</details>':'<p class="tiny muted spaced">이 종목의 확정 시세 보관 상태를 조회합니다.</p>')+'</div><div class="studio-data-actions actions">'+button(captureCollecting?'확정 시세 수집 중…':'확정 시세 수집','capture-collect','',disabled?'disabled':'')+'</div></section>';
  }
  async function collectCapture(){if(captureCollecting||captureLoading||captureStatusError||busy||captureData?.canCollect!==true)return;if(isDataSettings())restoreMindActionFocus('capture-collect','');captureCollecting=true;captureActionError='';captureMessage='';redraw();try{const value=await mutate('',{provider:'okx',instrumentId:'crypto:okx:BTC-USDT'},'/api/workspace/market-captures/collect',{onCommitted:invalidateTerminal});captureData=value.collection;captureMessage=value.result?.reused?'이미 보관한 확정 시세를 확인했습니다.':'확정 시세 원문을 수집해 보관했습니다.';if(currentRoute().page==='trade')await loadTerminal();}catch(problem){captureActionError=problem.message;if(problem.collection)captureData=problem.collection;}finally{captureCollecting=false;await loadCaptureStatus();redraw();}}
  function connectionSummary(){
    const route=currentRoute(),connections=mindData?.connections||{},korean=connections.koreanStocks,us=connections.usStocks,live=executionModeOf(route)==='live',items=liveActivity.items(),enabled=live?items?.filter(item=>item.status==='ENABLED').length:list(workspace.mindSubscriptions).filter(item=>item.status==='ENABLED').length;
    const jevConfigured=connections.jev?.configured??status?.jev?.configured;
    const back=studioReturnLink(route,parseStudioRoute,studioRouteHash),reviewKey=route.params.get('jevReview')==='1';
    const current=row('현재 보기',live?'실전':'모의')+row('자동 운용',live&&liveActivity.state().error?'운용 상태 조회 실패':enabled===undefined?'상태 조회 중':num(enabled,0)+'개 운용 중')+row('JEV 키',jevConfigured===true?'서버 설정 확인 · 키 유효성 미확인':jevConfigured===false?'설정 안 됨':'설정 상태 조회 필요');
    const jevSetup='<details class="spaced"'+(back||reviewKey?' open':'')+'><summary>AI 판단용 JEV 키 설정</summary><p class="spaced">JEV를 호출하는 판단·분류·추천에 사용합니다. 설정은 VIV 서버가 실행되는 컴퓨터에서 진행하세요.</p><ol class="spaced"><li><a href="https://console.typesafe.ai/keys" target="_blank" rel="noopener noreferrer">TypeSafe 콘솔에서 키 발급·관리 ↗</a></li><li>VIV 설치 폴더의 <code>.env</code>에 <code>TYPESAFE_API_KEY</code>를 설정하세요.</li><li>VIV 서버를 다시 시작하고 이 화면의 <strong>상태 새로고침</strong>을 누르세요. 키 유효성은 다음 JEV 요청의 결과로 확인합니다.</li></ol></details>';
    const next=live?'':'<p class="spaced"><a class="button small" href="'+PAPER_PRACTICE_ENTRY+'" data-studio-route>키 없이 과거 데이터로 실습</a></p>';
    const links='<div class="actions spaced"><a class="button small" href="'+esc(studioRouteHash(currentRoute(),'settings',{view:'accounts'}))+'" data-studio-route>'+ (live?'API 키 등록·계좌 관리':'모의 계좌 관리')+'</a>'+(!live?'<a class="button small" href="'+esc(studioRouteHash(currentRoute(),'settings',{view:'accounts',executionMode:'live'}))+'" data-studio-route>실계좌 API 키 등록</a>':'')+'<a class="button small" href="'+esc(studioRouteHash(currentRoute(),'settings',{view:'automation'}))+'" data-studio-route>자동 운용 보기</a><a class="button small" href="/install.html">휴대폰 연결·설치</a></div>';
    const mcp='<p class="spaced"><a class="button small" href="/install.html?connect=ai&amp;executionMode='+executionModeOf(currentRoute())+'">AI 연결·복구 (MCP)</a></p>';
    const sources=row('코인 시세',connections.crypto?.mode==='PUBLIC_CONFIRMED_CANDLES'?'OKX · 공개 시세':'상태 조회 필요')+row('한국 주식',korean?.provider==='TOSS'?'토스증권 · 일봉':korean?.provider==='KIS'?'한국투자증권 · 일봉':korean?.provider==='NAVER_REFERENCE'?'네이버 금융 · 참조 일봉':'상태 조회 필요')+row('미국 주식',us?.provider==='TOSS'&&us.status==='CONFIGURED'?'토스증권 · 일봉':us?.status==='CONFIGURED'?'한국투자증권 · 시세':us?.status==='CONNECT_REQUIRED'?'한국투자증권 연결 필요':'상태 조회 필요')+row('매크로·뉴스',connections.macro?.status==='APPROVED_DOCUMENTS'&&connections.news?.status==='APPROVED_DOCUMENTS'?'검토한 투자 자료':'자료 검토 필요');
    return current+next+jevSetup+mcp+links+connectionDetails('sources','시세·자료 연결',sources);
  }
  const isDataSettings=()=>currentRoute().page==='settings'&&currentRoute().params.get('view')==='data';
  const mindFocusScope=()=>currentRoute().page+'?'+currentRoute().params.toString();
  function rememberMindActionFocus(){if(typeof document==='undefined'||mindActionFocus)return;const active=document.activeElement;if(isMemoryView()&&active?.matches?.('[data-studio-profile]')){mindActionFocus={kind:'memory-profile',scope:mindFocusScope(),fallback:null};return;}if(currentRoute().page==='settings'&&currentRoute().params.get('view')==='accounts'&&active?.dataset?.brokerAction){mindActionFocus={kind:'broker-action',action:active.dataset.brokerAction,id:active.dataset.brokerProvider,scope:mindFocusScope(),fallback:null};return;}if(isRecordsRoute(currentRoute())&&active?.matches?.('.studio-record-link')){mindActionFocus={kind:'record-link',href:active.getAttribute('href'),scope:mindFocusScope(),fallback:null};return;}if(active?.matches?.('[data-mind-disclosure] > summary')){mindActionFocus={kind:'disclosure-summary',id:active.parentElement.dataset.mindDisclosure,scope:mindFocusScope(),fallback:null};return;}if(active?.dataset?.studioAction&&active.closest?.('[data-mind-disclosure]')){mindActionFocus={action:active.dataset.studioAction,id:active.dataset.studioId,disclosure:active.closest('[data-mind-disclosure]').dataset.mindDisclosure,scope:mindFocusScope(),fallback:null};return;}if(active?.matches?.('[data-mind-history] > summary')){mindActionFocus={kind:'history-summary',id:active.parentElement.dataset.mindHistory,scope:mindFocusScope(),fallback:null};return;}if(active?.dataset?.studioAction==='memory-refresh'&&isMemoryView()||active?.dataset?.studioAction==='mind-library-refresh'&&currentRoute().page==='library'||active?.matches?.('[data-studio-action="connections"]')||active?.dataset?.studioAction==='companion-refresh'||isRecordsRoute(currentRoute())&&['refresh','export-records','record-prev','record-next','record-first','paper-records-refresh'].includes(active?.dataset?.studioAction)||isDataSettings()&&['capture-status','sector-status','upbit-collect','stocks-collect','sector-collect','capture-collect'].includes(active?.dataset?.studioAction)){mindActionFocus={action:active.dataset.studioAction,id:'',scope:mindFocusScope(),fallback:null};return;}const card=active?.closest?.('[data-mind-companion]');if(!card)return;if(active.matches?.('[data-mind-companion-open]'))mindActionFocus={kind:'card-link',id:card.dataset.profileId,href:active.getAttribute('href'),scope:mindFocusScope(),fallback:null};else if(['profile-edit','strategy-graph','mind-customize'].includes(active.dataset?.studioAction))mindActionFocus={action:active.dataset.studioAction,id:active.dataset.studioId,scope:mindFocusScope(),fallback:null};}
  function restorePendingMindActionFocus(container=root||(typeof document!=='undefined'?document.querySelector?.('#app'):null)){
    if(!mindActionFocus||typeof document==='undefined')return;if(mindActionFocus.scope!==mindFocusScope()){mindActionFocus=null;return;}if(document.querySelector?.('dialog[open]'))return;
    const pending=mindActionFocus,restoreAction=pending.action==='sector-status'&&!sectorCatalogError?'capture-status':pending.action,dataFallback={'upbit-collect':'data-source-upbit','stocks-collect':'data-source-equity','sector-collect':'data-source-sector','capture-collect':'data-capture-title'}[pending.action],target=pending.kind==='memory-profile'?container?.querySelector?.('[data-studio-profile]'):pending.kind==='mind-library-page'?(mindLibraryLoading||mindLibraryKey!==mindLibraryQuery().toString()?null:container?.querySelector?.('[data-mind-library-list]')):pending.kind==='knowledge-page'?container?.querySelector?.('[data-knowledge-document-list]'):pending.kind==='broker-action'?[...container?.querySelectorAll?.('[data-broker-action]')||[]].find(node=>node.dataset.brokerAction===pending.action&&node.dataset.brokerProvider===pending.id&&node.getClientRects().length):pending.kind==='record-link'?[...container?.querySelectorAll?.('.studio-record-link')||[]].find(node=>node.getAttribute('href')===pending.href&&node.getClientRects().length):pending.kind==='disclosure-summary'?[...container?.querySelectorAll?.('[data-mind-disclosure]')||[]].find(group=>group.dataset.mindDisclosure===pending.id)?.querySelector('summary'):pending.kind==='history-summary'?container?.querySelector?.('[data-mind-history="'+pending.id+'"] > summary'):pending.kind==='card-link'?[...container?.querySelectorAll?.('[data-mind-companion-open]')||[]].find(node=>node.closest?.('[data-mind-companion]')?.dataset.profileId===pending.id&&node.getAttribute('href')===pending.href&&(node.getClientRects().length||node.closest?.('[data-mind-history]:not([open])'))):[...container?.querySelectorAll?.('[data-studio-action]')||[]].find(node=>node.dataset.studioAction===restoreAction&&node.dataset.studioId===pending.id&&(!pending.disclosure||node.closest?.('[data-mind-disclosure]')?.dataset.mindDisclosure===pending.disclosure)&&!node.disabled&&(node.getClientRects().length||node.closest?.('[data-mind-history]:not([open])'))),focusTarget=target?.disabled?null:target?.closest?.('[data-mind-history]:not([open])')?.querySelector?.('summary')??target,fallback=(pending.kind==='broker-action'?container?.querySelector?.('#broker-'+pending.id+'-title'):null)||(pending.action==='paper-records-refresh'?container?.querySelector?.('[data-paper-records-read]'):null)||(pending.action==='live-activity-refresh'?container?.querySelector?.('[data-live-read-state]'):null)||(isDataSettings()&&dataFallback?container?.querySelector?.('#'+dataFallback):null)||container?.querySelector?.('h1[tabindex="-1"]');
    restoringMindActionFocus=true;try{if(focusTarget){focusTarget.focus({preventScroll:!['knowledge-page','mind-library-page'].includes(pending.kind)});mindActionFocus=null;}else{if(fallback){pending.fallback=fallback;fallback.focus({preventScroll:true});}if(!(pending.kind==='broker-action'&&target?.disabled)&&!(pending.kind==='mind-library-page'&&(mindLibraryLoading||mindLibraryKey!==mindLibraryQuery().toString()))&&!(pending.action==='memory-refresh'&&memoryLoading)&&!subscriptionLoading&&!connectionLoading&&!upbitCollecting&&!captureLoading&&!sectorCatalogLoading&&!sectorCollecting&&!captureCollecting&&!(isRecordsRoute(currentRoute())&&recordsLoading)&&!(pending.action==='paper-records-refresh'&&eventPaperBatch.state().loading)&&!(pending.action==='companion-refresh'&&(executionModeOf(currentRoute())==='paper'?eventPaperBatch.state().loading:liveActivity.state().loading))&&!(pending.action==='live-activity-refresh'&&liveActivity.state().loading))mindActionFocus=null;}}finally{restoringMindActionFocus=false;}
  }
  function restoreMindActionFocus(action,id){mindActionFocus={action,id,scope:mindFocusScope(),fallback:null};queueMicrotask(()=>restorePendingMindActionFocus());}
  function mindActionFocusChanged(event){if(mindActionFocus&&!restoringMindActionFocus&&event.target!==mindActionFocus.fallback)mindActionFocus=null;}
  function form(titleValue,kind,body,id='',label='저장'){catalogPickerCleanup?.();catalogPickerCleanup=null;hooks.open?.(titleValue,`<form data-studio-form="${kind}" data-studio-id="${esc(id)}"><div class="form-grid">${body}</div><p class="tiny muted spaced" data-studio-form-status role="status" aria-live="polite"></p><p id="studio-form-error" class="error-text spaced" data-studio-form-error role="alert" tabindex="-1"></p><div class="form-actions"><button type="button" class="button" data-studio-action="close-dialog">취소</button><button type="submit" class="button primary">${esc(label)}</button></div></form>`);}
  const backgroundDialogActions=new Set(['document-classify','experience-observe','universe-select','news-run']);
  function commandProgress(node,label){const previous=node.textContent;let status=null;node.disabled=true;node.textContent=label;node.setAttribute?.('aria-busy','true');if(typeof document!=='undefined'&&typeof document.createElement==='function'){const dialog=node.closest('dialog');if(dialog){status=dialog.querySelector('[data-studio-command-status]');if(!status){status=document.createElement('p');status.dataset.studioCommandStatus='';status.className='tiny muted spaced';dialog.querySelector('.dialog-body')?.prepend(status);}status.className='tiny muted spaced';status.textContent=label+(backgroundDialogActions.has(node.dataset?.studioAction)?' 창을 닫아도 요청 처리는 계속됩니다.':'');status.setAttribute('role','status');}}return problem=>{if(node.isConnected!==false){node.disabled=false;node.textContent=previous;node.removeAttribute?.('aria-busy');}if(status?.isConnected){status.className=problem?'tiny error-text spaced':'tiny muted spaced';status.textContent=problem?.message||'';status.setAttribute('role',problem?'alert':'status');}};}
  let pendingKnowledgePin=null;
  function knowledgePinPolicy(manifest,item){
    const policy=manifest.data.externalKnowledge||disabledExternalKnowledge();
    return {...policy,enabled:true,mode:'pinned',documentPins:[...policy.documentPins.filter(pin=>pin.id!==item.id),{id:item.id,version:item.version,contentHash:item.contentHash}]};
  }
  function knowledgePinPreview(mindId){
    const manifest=savedMind(mindId)?.manifest;
    if(!mindId)return '<p class="muted">연결할 마인드를 선택하세요.</p>';
    if(!manifest)return '<p class="error-text">현재 마인드 정책을 다시 조회하세요.</p>';
    const before=manifest.data.externalKnowledge||disabledExternalKnowledge(),after=knowledgePinPolicy(manifest,pendingKnowledgePin);
    return '<h3>정책 초안의 변경</h3>'+row('공용 자료 입력',(before.enabled?'사용함':'사용 안 함')+' → 사용함')+row('연결 방식',(before.mode==='subscribed'?'조건에 맞는 자료 구독':'자료 버전 고정')+' → 자료 버전 고정')+row('고정 자료',before.documentPins.length+'개 → '+after.documentPins.length+'개')+row('실행당 최대 자료 수',after.maxItems+'개 · 유지')+(before.enabled&&before.mode==='subscribed'?'<p class="tiny muted">조건에 맞는 자료 구독 대신 고정한 자료 버전을 사용합니다.</p>':'');
  }
  function openKnowledgePin(item){
    pendingKnowledgePin=item;knowledgeItems.set(item.id,item);
    const selected=currentRoute().params.get('profileId'),profiles=list(workspace.investmentProfiles),mindId=profiles.some(p=>p.id===selected)?selected:'';
    form('자료를 마인드에 연결','knowledge-pin','<p class="full">'+esc(item.title)+' · v'+item.version+'</p>'+select('대상 마인드','mindId',[['','마인드를 선택하세요'],...profiles.map(p=>[p.id,profileName(p.id)])],mindId,true)+'<section class="full" data-knowledge-pin-preview aria-live="polite">'+knowledgePinPreview(mindId)+'</section><p class="full tiny muted">선택한 자료 버전과 기존 고정 자료를 정책 초안에 저장합니다. 검토·발행 후 새 정책으로 실행할 때 적용됩니다. 진행 중인 실전 운용은 해당 운용의 정책 변경 경로에서 반영합니다.</p>','','정책 초안 작성');
  }
  function knowledgePolicyForm(id){const manifest=savedMind(id)?.manifest;if(!manifest)return hooks.toast?.('현재 마인드 정책을 다시 조회하세요.');const k=manifest.data.externalKnowledge||disabledExternalKnowledge(),multi=(title,name,choices,selected)=>'<label class="field">'+title+'<select name="'+name+'" multiple size="'+Math.min(6,choices.length)+'">'+choices.map(value=>'<option value="'+value+'"'+(selected.includes(value)?' selected':'')+'>'+esc(KNOWLEDGE_LABELS[value])+'</option>').join('')+'</select></label>';form('공용 자료 연결 설정','knowledge-policy',select('공용 투자 자료','enabled',[['false','사용 안 함'],['true','사용함']],String(k.enabled))+select('연결 방식','mode',[['pinned','선택한 자료 버전 고정'],['subscribed','조건에 맞는 승인 자료 구독']],k.mode)+multi('출처 유형 · 구독 시 필수','sourceTypes',['news','macro-release','investor-letter','investor-disclosure','research','other'],k.sourceTypes)+multi('자료 수준 · 비우면 전체','levels',['macro','micro','mixed','uncertain'],k.levels)+multi('영향 기간 · 비우면 전체','horizons',['short_term','long_term','mixed','uncertain'],k.horizons)+'<label class="field">저자 ID · 쉼표로 구분<input name="authorIds" value="'+esc(k.authorIds.join(', '))+'"></label>'+field('공개 후 유효 시간','maxAgeHours',k.maxAgeHours,'number','min="1" max="87600"')+field('실행당 최대 자료 수','maxItems',k.maxItems,'number','min="1" max="12"')+'<div class="full">'+helpLabel('연결 방식','고정 자료는 라이브러리에서 선택합니다. 구독은 설정한 조건에 맞는 승인 자료를 연결합니다. 새 정책을 발행하면 적용됩니다.')+'</div>',id,'정책 초안 작성');}
  function strategyPlanForm(id){const manifest=savedMind(id)?.manifest;if(!manifest)throw new Error('현재 마인드 정책을 다시 조회하세요.');const plan=manifest.data.strategyPlan;form('전략 설정','strategy-plan','<div class="full">'+row('적용 범위',esc(strategyScopeLabel(plan||createMindStrategyPlan(),manifest.data.universe)))+'</div><input type="hidden" name="preset" value="BTC_SPOT_V1"><label class="field full"><span><input type="checkbox" name="enabled" value="true"'+(plan?.approval?.enabled?' checked':'')+'> 정책 발행 후 전략 모듈 사용</span></label>'+field('최대 종목 비중 · 0 초과~1 이하','strategyMaxExposure',plan?.allocation?.strategyMaxExposure??1,'number','min="0" max="1" step="any"')+'<div class="full">'+helpLabel('전략 설정 적용','새 정책 초안으로 저장합니다. 발행 후 다음 실행부터 적용됩니다. 세부 전략은 노드 편집기에서 조정할 수 있습니다.')+'</div>',id,'전략 정책 초안 작성');}
  function clearDocumentValidation(formNode){if(formNode?.dataset.studioForm!=='document')return;if(formEditor)formEditor.validated=null;for(const selector of ['[data-document-validation]','[data-studio-form-error]']){const result=formNode.querySelector(selector);if(result)result.textContent='';}}
  function externalKnowledgeEvidence(state){const sources=list(state.externalKnowledge),selection=state.knowledgeSelection;if(!sources.length&&!selection)return '';return '<section class="spaced"><h3>실제 전달한 공용 자료</h3>'+table(['자료','버전','원문 공개','사용 가능','JEV 분류',''],sources.map(source=>[esc(source.title),'v'+source.version,esc(knowledgePublicationLabel(source)),esc(when(source.availableAt)),esc([source.classification?.level,source.classification?.horizon,source.classification?.sentiment].filter(Boolean).map(v=>KNOWLEDGE_LABELS[v]).join(' · ')),'<button type="button" class="button small" data-library-action="detail" data-library-id="'+esc(source.id)+'">원문 열기</button>']),selection?.enabled?'범위·공개 시점·유효 기간을 충족한 공용 자료가 없습니다.':'이 실행 정책에서 공용 자료 입력을 사용하지 않습니다.')+raw(selection,'자료 선택·제외 원본')+'</section>';}
  function migratedLegacyOrder(record){const deployment=byId(workspace?.deployments,record?.deploymentId),profileId=record?.investmentProfileId||deployment?.investmentProfileId;return (record?.inputPackage?.experimentType||deployment?.experimentType)==='FORWARD_PAPER'&&savedMind(profileId)?.manifest?profileId:null;}
  function openTerminalDecision(id){
    if(executionModeOf(currentRoute())!=='live')return openDecision(id);
    const record=liveTerminalModel().decisions.find(item=>item.id===id)??liveTerminalLatestDecision(liveActivity.items(),id);if(!record)return hooks.toast?.('이 종목의 실전 기록을 다시 조회하세요.');
    const view=terminalDecisionView(record,{profiles:workspace.investmentProfiles}),item=record.activity,source=record.sourceRecord;
    hooks.open?.(record.kind==='LIVE_FILL'?'실전 체결 상세':'실전 판단 상세',terminalTooltipContent([view],{showPinHint:false,showDetailAction:false})+renderMindActivityPreview({...item,lastDecision:source.kind==='DECISION'?source:source.decision},{id:'terminal-detail-'+encodeURIComponent(record.id),label:'당시 판단 경로'}));
  }
  function openRecordLoading(title){hooks.open?.(title,'<p class="empty" role="status" aria-live="polite">기록 원문을 불러오는 중…</p>');return hooks.getDialogToken?.();}
  async function openResetPreview(){
    const token=openRecordLoading('투자 기록 초기화'),current=()=>!disposed&&dialogIsCurrent(token),retry=button('삭제 범위 다시 조회','workspace-reset');
    try{
      const value=await request('/api/workspace/reset');if(!current())return;
      if(value.revision!==workspace.revision)await refresh({quiet:true});if(!current())return;
      if(value.revision!==workspace.revision)throw new Error('기록이 변경되었습니다. 삭제 범위를 다시 조회하세요.');
      const preview=value.preview,blocked=list(preview.blockedReasons),counts=(values,labels)=>Object.entries(values||{}).filter(([,count])=>Number.isFinite(count)).map(([key,count])=>row(labels[key]||key,num(count,0))).join('');
      const scope='<section class="full"><h3>삭제할 기록</h3>'+counts(preview.counts,{minds:'마인드',policies:'정책',paperAccounts:'모의 계좌',experiments:'실험',learningSessions:'학습 세션',runs:'결정 기록',trades:'모의 체결',subscriptions:'자동 운용',decisions:'결정 기록',memories:'기억'})+'</section><section class="full spaced"><h3>보존할 자료와 연결</h3>'+counts(preview.preserved,{marketCatalogSnapshots:'종목 목록',marketCaptures:'공용 시세',knowledge:'투자 자료',quantStrategies:'퀀트 전략',brokerConnections:'계좌 연결',researchSources:'연구 출처'})+raw({counts:preview.counts,preserved:preview.preserved},'삭제·보존 범위 원본')+'</section>';
      if(preview.canReset!==true||blocked.length)return hooks.open?.('투자 기록 초기화','<p class="empty" role="status">지금은 초기화할 수 없습니다.</p>'+blocked.map(reason=>'<p class="error-text wrap-anywhere" role="alert">'+esc(reason.message)+'</p>').join('')+scope,retry);
      form('투자 기록 초기화','workspace-reset',scope+'<div class="full actions">'+retry+'</div><input type="hidden" name="previewHash" value="'+esc(preview.previewHash)+'">'+field('확인 문구 · 전체 삭제','confirmation','','text','required pattern="전체 삭제" autocomplete="off"')+'<p class="tiny full">위 삭제 항목의 기록이 영구 삭제됩니다.</p>','','영구 삭제');
    }catch(problem){if(current())hooks.open?.('투자 기록 초기화','<p class="empty error-text wrap-anywhere" role="alert">'+esc(problem.message)+'</p>',retry);}
  }
  async function openDecision(id){
    const dialogToken=openRecordLoading('결정 상세');

    try{const value=await request('/api/workspace/decisions/detail?id='+encodeURIComponent(id));if(disposed||!dialogIsCurrent(dialogToken))return;const d=value.decision,r=d.record,pinnedManifest=savedDecisionManifest(r,d),v=terminalDecisionView(r,{profiles:pinnedManifest?[{id:r.profileId,name:pinnedManifest.data.name}]:workspace.investmentProfiles,legacyInstrumentId:'crypto:okx:BTC-USDT'}),answers=d.model?.questions||r.jevResponse?.answers||{};
      const state=r.rawRequest?.state||r.jevRequest?.state||{},providerUsed=Boolean(r.rawResponse||r.jevResponse),canCompareNews=providerUsed&&list(state.externalKnowledge).length>0;
      const paperRecord=r.experimentType==='FORWARD_PAPER'&&r.status!=='FAILED';
      const paperFills=paperRecord?row('모의 체결',Array.isArray(d.fills)?num(d.fills.length,0)+'건':'기록 확인 필요'):'';
      const philosophy=state.philosophy?.philosophy||state.profile?.philosophy||state.investmentProfile?.philosophy||profileVersion(r.investmentProfileVersionId)?.settings.philosophy;
      const principles=list(state.principles||state.rules).filter(rule=>rule?.title||rule?.id);
      const principleDetails=principles.length?'<details class="spaced"><summary>'+principles.length+'개 '+(providerUsed?'전송 원칙·규칙':'원칙·규칙')+'</summary><ul>'+principles.map(rule=>'<li class="spaced"><strong>'+esc(rule.title||rule.id)+'</strong>'+(rule.text?'<p>'+esc(rule.text)+'</p>':'')+'</li>').join('')+'</ul></details>':'';
      const starter=paperRecord&&firstDecisionPlan(pinnedManifest?.data.strategyPlan);
      const trendBasis=starter?paperTrendDecisionBasis(r,v.quoteCurrency,d.fills):'';
      const evidence=r.decision?.evidence;
      const basis=typeof evidence?.title==='string'&&evidence.title
        ?row('선택한 근거',esc(evidence.title)+(typeof evidence.text==='string'?'<p>'+esc(evidence.text)+'</p>':''))
        :providerUsed&&!r.strategyEvaluation?'<p class="tiny muted">개별 선택 근거가 기록되지 않았습니다. 적용한 원칙과 선택 분포를 아래에서 확인할 수 있습니다.</p>':'';
      const recordLink=paperRecord&&currentRoute().params.get('search')!==id
        ?'<a class="button small" href="'+esc(paperDecisionRecordHash(id))+'" data-studio-route>이 판단을 기록에서 보기</a>':'';
      const decisionTimeframe=r.timeframe||r.inputPackage?.timeframe||state.market?.timeframe||r.strategyEvaluation?.timeframe;
      const nextTrade=starter&&r.instrumentId===PAPER_DECISION_INSTRUMENT&&decisionTimeframe===PAPER_DECISION_TIMEFRAME&&
        currentRoute().page!=='trade'&&workspace.investmentProfiles.some(profile=>profile.id===r.profileId&&profile.status!=='ARCHIVED')
        ?'<a class="button small" href="'+esc(studioRouteHash(currentRoute(),'trade',{executionMode:'paper',firstDecision:'1',profileId:r.profileId,instrumentId:PAPER_DECISION_INSTRUMENT,timeframe:PAPER_DECISION_TIMEFRAME}))+'" data-studio-route>이 마인드의 모의 트레이딩 열기</a>':'';
      hooks.open?.('결정 상세',`${paperRecord?'<p role="status" class="tiny muted">저장된 모의 판단</p>':''}${savedDecisionContext(r,d,v)}${paperFills}<div class="studio-decision-summary">${terminalTooltipContent([v],{showPinHint:false})}</div>${basis}${trendBasis}${recordLink}${nextTrade}${terminalModelMeasures(v)}<section class="spaced"><h3>${providerUsed?'JEV 입력':'실행 입력'}</h3>${philosophy?'<h4>투자 철학</h4><p>'+esc(philosophy)+'</p>':''}${principleDetails}${row(providerUsed?'전송 개인 기억':'연결 기억',`${list(state.approvedMemory||state.approvedPersonalMemory).length}개`)}${row('개인 투자 자료',`${list(state.macroAndNews||state.approvedMarketContexts).length}개`)}${row('공용 투자 자료',`${list(state.externalKnowledge).length}개`)}${externalKnowledgeEvidence(state)}${strategyEvaluationMarkup(r.strategyEvaluation||state.strategyEvaluation,pinnedManifest?.data.strategyPlan?.graph||state.strategyPlan?.graph)}${v.authority&&v.authority!=='JEV_FINAL'&&v.decisionMethod?.measureKind!=='CONFIDENCE'?row(v.decisionMethod?.measureKind==='VOTE'?'최다 투표 비중':'계산 강도',v.decisionMethod?.measureKind==='VOTE'?pct(v.strength):num(v.strength,3)):''}${raw(state.effectiveWeights,'실제 적용한 원칙 가중치')}${r.rawResponse||r.jevResponse?raw(answers,'JEV 원판단과 확률 분포'):''}</section><section class="spaced"><h3>체결·경험</h3>${row('실행 상태',esc(executionLabel(v.outcome)))}${r.execution?.reason?row('실행 사유',esc(r.execution.reason)):''}${table(['방향','수량','체결가','수수료'],list(d.fills).map(f=>[esc(f.side),num(f.quantity,8),money(f.fillPrice,f.quoteCurrency||v.quoteCurrency),money(f.fee,f.quoteCurrency||v.quoteCurrency)]),paperRecord&&!Array.isArray(d.fills)?'연결된 체결 기록 확인 필요':'이 결정에 연결된 체결이 없습니다.')}<div class="actions spaced">${list(d.experiences).map(e=>button('경험 · '+when(e.occurredAt),'experience',e.id)).join('')}${r.outcomeType==='TRADE_PROPOSED'?(migratedLegacyOrder(r)?button('현재 마인드 운용','mind-operations',migratedLegacyOrder(r)):button('모의 주문 검토','order-review',id)):''}${r.status==='PAPER_REVIEW_READY'||r.execution?.status==='PAPER_REVIEW_READY'?button('모의 체결 검토','mind-order-review',id):''}${terminalExecutionRetryable(r)?button('모의 실행 다시 시도','mind-order-review',id):''}${id.startsWith('mind-run-')?button('후속 관측 상태 보기','mind-observation',id)+(canCompareNews?button('JEV 뉴스 입력 비교','news-create',id):''):''}${id.startsWith('mind-run-')&&r.decision?.action==='hold'&&!r.execution?.accountSnapshotAfter&&!terminalExecutionRetryable(r)?button('후속 관측 기준 검토','mind-order-review',id):''}</div></section>${raw({versions:d.versions,reproducibility:d.reproducibility},'적용 버전·출처·입력 해시')}${raw(r.rawRequest||r.jevRequest,r.jevCalled===false?'실행 입력':'실제 JEV 요청')}${r.rawResponse||r.jevResponse?raw(r.rawResponse||r.jevResponse,'실제 JEV 응답'):''}${raw(r.risk||r.ruleResults,'실행 조건 검사')}${raw(r.execution,'모의 실행 원본')}`);
    }catch(problem){if(!disposed&&dialogIsCurrent(dialogToken))hooks.open?.('결정 상세','<p class="empty error-text" role="alert">'+esc(problem.message)+'</p>',button('다시 조회','decision',id));}
  }
  function openKnowledge(id){if(list(mindData?.documents).some(d=>d.id===id||(d.document||d).id===id))return documentDetail(id);if(byId(workspace.experiences,id))return openExperience(id);if(byId(workspace.memoryCandidates,id))return openCandidate(id);hooks.toast?.('연결된 경험과 학습 후보를 다시 조회하세요.');}
  async function openExperience(id){
    const dialogToken=openRecordLoading('투자 경험');
    try{
    let e=byId(workspace.experiences,id);if(!e){await refresh({quiet:true});e=byId(workspace.experiences,id);}if(disposed||!dialogIsCurrent(dialogToken))return;if(!e)throw new Error('경험 원본을 다시 조회하세요.');let availability=e.observation?.availability;
    if(e.status==='AWAITING_OBSERVATION'&&e.experienceType==='INVESTMENT_DECISION')try{availability=(await request('/api/workspace/observations/availability?experienceId='+encodeURIComponent(id)+'&horizonHours=24')).availability;}catch{}
    if(disposed||!dialogIsCurrent(dialogToken))return;
    const p=e.observation?.performance;
    hooks.open?.('투자 경험',`<p class="studio-detail-intro">${esc(profileName(e.investmentProfileId))} · ${esc(e.summary)}</p>${row('기준 봉',esc(when(e.occurredAt)))}${row('상태',esc(({AWAITING_OBSERVATION:'24시간 후속 관측 대기',OBSERVED:'관측 완료 · 평가 대기',EVALUATED:'평가 완료'})[e.status]||e.status))}${availability?row('후속 자료',esc(availability.message))+row('관측 종료',esc(when(availability.dueAt)))+row('부족한 확정 봉',`${availability.missingBars}개`):''}${p?row('선택 후 순수익률',pct(p.netReturn))+row('유지 대조 수익률',pct(p.benchmarks?.holdingReturn))+row('현금 대조 수익률',pct(p.benchmarks?.allCashReturn))+row('비용',num(p.feesPaid)+' USDT'):''}${e.evaluation?`<h3 class="spaced">평가</h3><p>${esc(e.evaluation.summary)}</p>`:''}<div class="actions spaced">${e.status==='AWAITING_OBSERVATION'?button('후속 관측 수집','experience-observe',id,availability?.status==='WAITING_TIME'?'disabled':''):e.status==='OBSERVED'?button('경험 평가','experience-evaluate',id):button('학습 후보 작성','memory-propose',id)}${button('실행 상세','decision',e.decisionId)}</div>${raw(e,'경험 원본')}`);
  }catch(problem){if(!disposed&&dialogIsCurrent(dialogToken))hooks.open?.('투자 경험','<p class="empty error-text" role="alert">'+esc(problem.message)+'</p>',button('다시 조회','experience',id));}
  }
  async function openCandidate(id){
    const dialogToken=openRecordLoading('학습 후보');
    try{let c=byId(workspace.memoryCandidates,id);if(!c){await refresh({quiet:true});c=byId(workspace.memoryCandidates,id);}if(disposed||!dialogIsCurrent(dialogToken))return;if(!c)throw new Error('학습 후보 원본을 다시 조회하세요.');hooks.open?.('학습 후보',`<h3>${esc(c.title)}</h3><p class="studio-detail-intro">${esc(c.text)}</p>${row('마인드',esc(profileName(c.investmentProfileId)))}${row('유형',esc(types.find(v=>v[0]===c.knowledgeType)?.[1]||c.knowledgeType))}${row('근거 경험',`${list(c.experienceIds).length}건`)}<div class="actions spaced">${c.status==='CANDIDATE'?button('검증 기록','memory-validate',id):c.status==='VALIDATED'?button('승인','memory-approve',id):''}${['CANDIDATE','VALIDATED'].includes(c.status)?button('반려','memory-reject',id):''}</div>${raw(c)}`);}catch(problem){if(!disposed&&dialogIsCurrent(dialogToken))hooks.open?.('학습 후보','<p class="empty error-text" role="alert">'+esc(problem.message)+'</p>',button('다시 조회','candidate',id));}
  }
  function mindAppearanceForm(id){const card=buildMindCompanions({paperActivities:eventPaperBatch.items(),workspace,minds:workspaceMindCatalog(workspace,mindData),executionMode:executionModeOf(currentRoute()),asOf:new Date().toISOString()}).cards.find(c=>c.profileId===id);if(!card)throw new Error('마인드를 다시 조회하세요.');const config=card.appearance?.config||mindAvatarIdentity(id).config;form('캐릭터 꾸미기','mind-avatar',field('마인드 이름','name',card.name,'text','maxlength="120"')+'<div class="mind-customization-preview full" data-mind-customization-preview aria-label="캐릭터 미리보기">'+renderLifeStage({profileId:'appearance-preview:'+id,executionMode:'paper',phase:'idle',appearance:{config},game:{motion:'idle',weather:'calm'}},{view:'portrait'})+'</div>'+appearanceFields.map(([name,label,choices])=>select(label,name,choices,config[name])).join('')+'<div class="full">'+helpLabel('캐릭터 적용 범위','이 마인드의 모의·실전 보기에 같은 캐릭터를 사용합니다.')+'</div>',id,'저장');if(typeof document!=='undefined')mindGameRuntime.mount(document);}
  function updateMindAppearancePreview(formNode){const preview=formNode.querySelector('[data-mind-customization-preview]');if(preview){const values=Object.fromEntries(new FormData(formNode)),config=Object.fromEntries(appearanceFields.map(([name])=>[name,values[name]]));preview.innerHTML=renderLifeStage({profileId:'appearance-preview:'+formNode.dataset.studioId,executionMode:'paper',phase:'idle',appearance:{config},game:{motion:'idle',weather:'calm'}},{view:'portrait'});mindGameRuntime.mount(preview.ownerDocument??preview);}}
  function profileForm(id=''){
    const p=byId(workspace.investmentProfiles,id),manifest=savedMind(id)?.manifest,s=manifest?.data.profileSettings||profileVersion(p?.currentVersionId)?.settings||{};
    const guided=!id&&firstPaperDecision(currentRoute());
    const starterPicker=p?'':`<div class="field full">
      <label class="field">시작 전략
        <select name="starterId" aria-describedby="mind-starter-hint">
          <option value="">직접 구성</option>
          <optgroup label="기본 프리셋">${PAPER_MIND_STARTERS.map(v=>`<option value="${esc(v.id)}"${guided&&v.id===FIRST_PAPER_DECISION_STARTER?' selected':''}>${esc(v.name)}</option>`).join('')}</optgroup>
        </select>
      </label>
      <small class="muted" id="mind-starter-hint">기본 프리셋 ${PAPER_MIND_STARTERS.length}개 중 고르면 설명과 투자 범위를 확인할 수 있습니다.</small>
      <div class="field" data-starter-preview aria-live="polite" aria-atomic="true"></div>
      <details>
        <summary>기본 프리셋 사용법</summary>
        <p>기본 프리셋은 새 마인드에 전략과 투자 범위를 채웁니다. <strong>직접 구성</strong>에서는 마인드 원칙을 입력하고 전략을 따로 만듭니다.</p>
        <p>처음이라면 <strong>국면 추세</strong>를 골라 생성하고 전략을 검토·발행하세요. 새 마인드의 실험실에서 발행한 전략을 백테스트할 수 있습니다.</p>
        <p>${MIND_STARTER_GUIDE}</p>
      </details>
    </div>`;
    const horizon=select('투자 기간','horizon',[['1m','1분봉'],['3m','3분봉'],['5m','5분봉'],['1h','1시간봉'],['4h','4시간봉'],['1d','일봉'],['multi-day','여러 날']],s.horizon||'4h');
    form(p?'마인드 원칙 편집':'마인드 추가',manifest?'manifest-profile':'profile',
      starterPicker+field('이름','name',manifest?.data.name||p?.name||'')+(p?horizon:`<div data-manual-horizon>${horizon}</div>`)+
      field('주요 근거 · 쉼표 구분','evidencePreferences',list(s.evidencePreferences).join(', '),'text')+area('투자 철학','philosophy',s.philosophy||'')+
      area('손실·비용·반대 근거 검토 원칙','discipline',s.discipline||'')+
      (manifest?'<div class="full">'+helpLabel('정책 초안 저장','원칙을 새 정책 초안으로 저장합니다. 정책 양식에서 가중치·투자 범위·자료·실행 조건을 함께 편집하고 발행할 수 있습니다.')+'</div>':''),id,manifest?'정책 초안 저장':guided?'마인드 만들고 전략 초안 저장':'마인드 생성');
    if(guided&&typeof document!=='undefined'){
      const picker=document.querySelector('#detail-dialog select[name="starterId"]');
      if(picker)updateStarterPreview(picker);
    }
  }
  function starterProfileDefaults(starter){
    return {name:starter.name,philosophy:starter.philosophy,discipline:'확정 시세와 현재 보유 확인, 거래 비용과 손실 한도 적용',evidencePreferences:'가격 추세, 모멘텀, 현재 보유'};
  }
  function updateStarterPreview(picker){
    const formNode=picker.form,starter=PAPER_MIND_STARTERS.find(p=>p.id===picker.value);
    if(firstPaperDecision(currentRoute())&&!formNode.dataset.studioId){
      formNode.querySelector('button[type="submit"]').textContent=starter?'마인드 만들고 전략 초안 저장':'마인드 생성';
    }
    const defaults=starter?starterProfileDefaults(starter):{};
    for(const name of ['name','philosophy','discipline','evidencePreferences']){
      const control=formNode.elements[name];
      control.required=!starter;
      control.placeholder=defaults[name]||'';
    }
    formNode.elements.horizon.disabled=!!starter;
    formNode.querySelector('[data-manual-horizon]').hidden=!!starter;
    const preview=formNode.querySelector('[data-starter-preview]');
    if(!starter){preview.replaceChildren();return;}
    const timeframe=starter.timeframe==='1h'?'1시간봉':'4시간봉';
    const instruments=starter.universe.map(id=>getInstrument(id).symbol).join(', ');
    preview.innerHTML=`<span>${esc(starter.description)}</span><small class="muted">${timeframe} · ${esc(instruments)}</small><small class="muted">빈 항목에는 프리셋 기본값이 적용됩니다. 생성한 전략은 검토·발행 후 실험에서 선택할 수 있습니다.</small>`;
  }
  function chooseDocumentMind(operation,kind='mind-policy'){
    return form('마인드 선택','document-target','<input type="hidden" name="operation" value="'+esc(operation)+'"><input type="hidden" name="kind" value="'+esc(kind)+'">'+select('적용할 마인드','mindId',[['','마인드를 선택하세요'],...list(workspace.investmentProfiles).map(p=>[p.id,profileName(p.id)])],''),'','계속');
  }
  let reviewedDocumentExport=null;
  function openDocumentExport(original){
    const doc=structuredClone(assertMindDocument(original));
    formEditor={doc,format:'json',profileId:doc.scope.profileId};
    hooks.open?.(doc.kind==='mind-policy'?'마인드 정책 내보내기':'자료 내보내기',`<p>${esc(doc.title)}${doc.kind==='mind-policy'?' · 정책 v'+esc(doc.data.version):''}</p><div class="actions spaced">${button('JSON 다운로드','download-document','json')}${button('YAML 다운로드','download-document','yaml')}${button('편집하여 가져오기','edit-export')}</div><details class="spaced" data-document-export-source><summary>JSON 원문</summary><pre class="code">${esc(serializeMindDocument(doc))}</pre></details>`);
  }
  async function openExport(profileId){
    const id=profileId||currentRoute().params.get('profileId');if(id==='all'||!id)return chooseDocumentMind('export');
    const scope=JSON.stringify([currentRoute().page,currentRoute().params.toString()]),dialogToken=openRecordLoading('마인드 정책 내보내기'),current=()=>!disposed&&dialogIsCurrent(dialogToken)&&scope===JSON.stringify([currentRoute().page,currentRoute().params.toString()]);
    try{const value=await request(endpoints.mindExport+'?'+new URLSearchParams({mindId:id,format:'json'}));if(current())openDocumentExport(value.document);}catch(problem){if(current())hooks.open?.('마인드 정책 내보내기','<p class="error-text wrap-anywhere" role="alert">'+esc(problem.message)+'</p>',button('다시 조회','export',id));}
  }
  const draftCatalog=()=>[...list(mindData?.minds).map(mind=>mind.manifest),...list(mindData?.documents),...list(workspace?.mindManifests)].filter(Boolean);
  const dialogIsCurrent=token=>token===undefined||token===hooks.getDialogToken?.();
  async function openDocumentCopy(original,{simulationId=null,mindId=original?.scope?.profileId}={}){
    const source=structuredClone(assertMindDocument(original)),token=hooks.getDialogToken?.();
    setMindCatalog(await request(endpoints.minds));if(!dialogIsCurrent(token))return;
    if(!savedMind(mindId))throw new Error('대상 마인드의 현재 정책을 다시 조회하세요.');
    const doc=copyMindDocumentDraft(source,{documents:draftCatalog(),mindId,simulationId});formEditor={profileId:doc.scope.profileId};
    return openDocumentEditor(doc.kind,serializeMindDocument(doc));
  }
  function executionCaption(item){
    const node=item?.graph?.nodes.find(n=>n.id===item.runtime?.execution?.activeNodeId);
    return node?(item.runtime.execution.phase==='EXTERNAL_OUTCOME_UNKNOWN'?'실행 결과 확인 중 · ':'AI 응답 대기 · ')+node.label:mindActivityModel(item).runtime;
  }
  function syncExecutionViewer(){
    if(!executionViewer)return;
    const viewer=executionViewer;
    if(!dialogIsCurrent(viewer.token)){executionViewer=null;return;}
    const item=liveActivity.get(viewer.mindId);
    if(!item)return;
    if(item.graph?.graphHash!==viewer.graphHash){executionViewer=null;openMindExecution(viewer.mindId).catch(problem=>hooks.toast?.(problem.message));return;}
    viewer.view.update?.({execution:mindActivityExecution(item),name:profileName(viewer.mindId)+' · '+executionCaption(item)});
    const active=item.runtime?.execution?.activeNodeId;
    if(active&&active!==viewer.activeNodeId)viewer.view.focusNode?.(active);
    viewer.activeNodeId=active;
  }
  async function openMindExecution(mindId){
    const token=hooks.getDialogToken?.(),live=executionModeOf(currentRoute())==='live';
    if(live)await loadLiveActivity({force:true});
    if(!dialogIsCurrent(token))return;
    const item=live?liveActivity.get(mindId):eventPaperBatch.items()?.find(v=>v.profileId===mindId);
    if(!item?.graph)throw Error('첫 판단의 실행 그래프를 기다리고 있어요.');
    const context=live?await callAutomation(request,'automation.trading.strategy.read',{activationId:item.activationId}):{manifest:savedMind(mindId)?.manifest};
    if(!dialogIsCurrent(token))return;
    const manifest=context.manifest;
    if(!manifest?.data.strategyPlan||strategyGraphHash(manifest.data.strategyPlan.graph)!==item.graph.graphHash)throw Error('현재 운용 그래프를 다시 조회해 주세요.');
    const active=item.runtime?.execution?.activeNodeId;
    const view=await hooks.openStrategyEditor?.({mindId,mind:{id:mindId,name:profileName(mindId)},plan:manifest.data.strategyPlan,name:profileName(mindId)+' · '+executionCaption(item),readOnly:true,execution:mindActivityExecution(item),autoReplay:false,initialFocusNodeId:active??item.graph.nodes.find(n=>['JEV_QUESTION','MODEL'].includes(n.type))?.id??item.graph.outputNodeId,onEdit:nodeId=>openPolicyGraphDraft({manifest,mindId,requireCurrentPolicy:true,initialFocusNodeId:nodeId})});
    if(view&&live)executionViewer={mindId,graphHash:item.graph.graphHash,activeNodeId:active,view,token:hooks.getDialogToken?.()};
  }
  function openStrategyParameter(mindId){
    const manifest=savedMind(mindId)?.manifest;
    if(!manifest)throw Error('설정할 마인드를 다시 선택하세요.');
    return openPolicyGraphDraft({manifest,mindId,requireCurrentPolicy:true,parameter:'timeframe'});
  }
  function openContextNote(profileId=currentRoute().params.get('profileId')){
    if(!profileId||profileId==='all')return form('문서 추가','document-target','<input type="hidden" name="operation" value="note"><input type="hidden" name="kind" value="market-context">'+select('마인드','mindId',[['','마인드를 선택하세요'],...list(workspace.investmentProfiles).filter(p=>p.status!=='ARCHIVED').map(p=>[p.id,profileName(p.id)])],''),'','작성하기');
    if(!savedMind(profileId))throw Error('문서를 연결할 마인드를 다시 선택하세요.');
    form('문서 추가','document-note','<p class="full tiny muted">'+esc(profileName(profileId))+'에 연결합니다.</p>'+field('제목','title','','text','required maxlength="240"')+area('내용','summary','','required maxlength="12000"')+'<details class="full"><summary>출처와 세부 정보</summary>'+field('출처 링크 (선택)','sourceUri','','url','placeholder="https://"').replace(' required ',' ')+'<input type="hidden" name="category" value="event">'+'</details>',profileId,'문서 저장');
  }
  async function openStrategyDraft({manifest,simulationId,mindId}={}){
    assertMindDocument(manifest);
    if(manifest.kind!=='mind-policy'||!simulationId||manifest.scope.profileId!==mindId)throw new Error('실험과 정책의 마인드가 일치하는지 확인하세요.');
    return openPolicyGraphDraft({manifest,simulationId,mindId});
  }
  async function openQuantStrategyMind(mindId,resource){
    const manifest=savedMind(mindId)?.manifest;if(!manifest)throw new Error('전략을 사용할 마인드를 선택하세요.');
    const basePolicyId=manifest.id,existing=manifest.data.strategyPlan;
    const previous=existing?strategyPlanGraph(existing):null,instanceId='quant-'+crypto.randomUUID();
    const graph=previous?.schemaVersion===2?attachQuantStrategy(previous,resource,{instanceId}):createQuantStrategyMindGraph(resource,{instanceId});
    const plan=strategyPlanWithGraph(existing??null,labelQuantStrategyInstance(graph,resource,instanceId));
    return openGraphEditor({plan,mindId,name:profileName(mindId),layoutOnOpen:previous?.schemaVersion!==2,initialBaseGraph:previous?.schemaVersion===2?previous:null,onSave:async draft=>{
      const dialogToken=hooks.getDialogToken?.();await refresh({quiet:true});if(savedMind(mindId)?.manifest?.id!==basePolicyId)throw new Error('발행 정책이 변경되었습니다. 최신 정책에서 전략을 다시 추가하세요.');
      const result=await mutate('',{mindId,strategyPlanDraft:{preset:'BTC_SPOT_V1',...draft}},'/api/workspace/mind-documents/policy-draft');
      if(dialogIsCurrent(dialogToken))await documentDetail(result.document.id);hooks.toast?.('라이브러리 전략을 정책 초안에 추가했습니다. 검토·발행 후 적용됩니다.');
    }});
  }
  async function openPolicyGraphDraft({manifest,simulationId=null,mindId=manifest?.scope?.profileId,requireCurrentPolicy=false,expectedBasePolicy=null,initialFocusNodeId=null,parameter=null}={}){
    assertMindDocument(manifest);
    if(manifest.kind!=='mind-policy'||manifest.scope.profileId!==mindId)throw new Error('편집할 정책과 마인드가 일치하는지 확인하세요.');
    if(!savedMind(mindId))throw new Error('대상 마인드의 현재 정책을 다시 조회하세요.');
    let liveUpdate=null;const openingToken=hooks.getDialogToken?.();
    if(!simulationId&&executionModeOf(currentRoute())==='live'){
      const cached=automatedTrading.state().data;
      const state=list(cached?.policies).some(p=>p.config?.profileId===mindId&&p.status==='ENABLED')?cached:await callAutomation(request,'automation.trading.read',{profileId:mindId});if(!dialogIsCurrent(openingToken))return;
      const active=list(state.policies).find(p=>p.status==='ENABLED'&&p.config?.profileId===mindId);
      if(active&&state.strategyUpdates?.supported){
        const context=await callAutomation(request,'automation.trading.strategy.read',{activationId:active.id});if(!dialogIsCurrent(openingToken))return;
        if(context.policy.status!=='ENABLED')throw new Error('운용 상태가 변경됐습니다. 현재 운용 화면을 새로고침하세요.');
        if(context.policy.pendingStrategyUpdate)throw new Error('저장한 전략을 반영 중입니다. 반영 후 최신 노드를 여세요.');
        liveUpdate=context.policy;if(requireCurrentPolicy){manifest=context.manifest;requireCurrentPolicy=false;}
      }
    }
    const source=structuredClone(manifest),preserveLegacyExposure=source.data.strategyPlan?.scope?.universe==='MIND_UNIVERSE'||isEventAutomationMind(source);copyMindDocumentDraft(source,{documents:draftCatalog(),mindId,simulationId});
    if(!hooks.openStrategyEditor)throw new Error('전략 편집기를 다시 열어 주세요.');
    let pendingSave=null;
    const plan=source.data.strategyPlan?structuredClone(source.data.strategyPlan):strategyPlanWithGraph(null,createDecisionStrategyGraph({preset:'QUANT'}));
    const continueLive=executionModeOf(currentRoute())==='live'&&isEventAutomationMind(source);
    if(parameter==='timeframe'||!initialFocusNodeId)initialFocusNodeId=strategyTimeframeParameter(plan.graph)?.nodeId??initialFocusNodeId;
    return openGraphEditor({mindId,plan,initialFocusNodeId,layoutOnOpen:!source.data.strategyPlan,name:source.data.name+(expectedBasePolicy?' · 저장된 초안 v'+source.data.version:''),liveUpdate,liveSetup:continueLive&&!liveUpdate,saveLabel:liveUpdate?'저장 및 승인':continueLive?'저장하고 실전 설정':'정책 초안 저장',onSave:async (draft,{onProgress}={})=>{
      const dialogToken=hooks.getDialogToken?.(),fingerprint=JSON.stringify(draft);
      const [latest,catalog]=await Promise.all([request('/api/workspace?view=studio'),request(endpoints.minds)]);workspace=latest.workspace;setMindCatalog(catalog);
      if(!savedMind(mindId))throw new Error('대상 마인드의 현재 정책을 다시 조회하세요.');
      if(liveUpdate){
        if(!pendingSave||pendingSave.fingerprint!==fingerprint)pendingSave={fingerprint,request:{activationId:liveUpdate.id,expectedGraphHash:liveUpdate.config.graphHash,graph:draft.graph,perOrderLimit:draft.perOrderLimit??liveUpdate.config.perOrderLimit,maxJevCallsPerDay:draft.maxJevCallsPerDay??liveUpdate.config.maxJevCallsPerDay,expectedRevision:workspace.revision,idempotencyKey:crypto.randomUUID(),userAction:'LIVE_STRATEGY_UPDATE'}};
        const applied=await saveLiveStrategyUpdate(request,pendingSave.request,{onProgress,isCurrent:()=>!disposed&&dialogIsCurrent(dialogToken)});
        if(!applied||!dialogIsCurrent(dialogToken))return;
        hooks.close?.();hooks.navigate?.('minds',{profileId:mindId,view:'operations',executionMode:'live'});
        await refresh({quiet:true,coreOnly:true});await automatedTrading.load({force:true});hooks.toast?.('새 노드를 운용 전략에 반영했습니다.');
        return;
      }
      if(expectedBasePolicy&&mindDocumentHash(savedMind(mindId).manifest)!==expectedBasePolicy)throw new Error('발행 정책이 변경되었습니다. 저장된 초안과 새 정책을 비교해 다시 여세요.');
      if(requireCurrentPolicy){const current=savedMind(mindId).manifest;if(current.id!==source.id||current.data.version!==source.data.version||mindDocumentHash(current)!==mindDocumentHash(source))throw new Error('발행 정책이 변경되었습니다. 편집기를 다시 열어 최신 정책을 확인하세요.');}
      if(!pendingSave||pendingSave.fingerprint!==fingerprint){
        const document=copyMindDocumentDraft(source,{documents:draftCatalog(),mindId,simulationId});
        document.data.strategyPlan=strategyPlanWithGraph(document.data.strategyPlan,draft.graph);
        document.data.universe.selection=calendarPortfolioSelection(draft.graph,document.data.universe.selection,document.data.universe.instrumentIds.length);
        if(!preserveLegacyExposure&&document.data.strategyPlan.scope.universe!=='MIND_UNIVERSE'&&!isEventAutomationMind(document)){
          if(draft.instrumentPolicy==='UNIVERSE_CURRENT')document.data.strategyPlan.scope.instrumentPolicy='UNIVERSE_CURRENT';
          else if(draft.instrumentPolicy==='FIXED')delete document.data.strategyPlan.scope.instrumentPolicy;
          document.data.strategyPlan.allocation.strategyMaxExposure=draft.strategyMaxExposure;
          document.data.riskPreset={...document.data.riskPreset,maxExposure:draft.strategyMaxExposure};
        }
        document.data.strategyPlan.approval.enabled=continueLive||draft.enabled;
        assertMindDocument(document);pendingSave={fingerprint,document};
      }
      if(!pendingSave.savedDocument)pendingSave.savedDocument=(await mutate('',{document:pendingSave.document,format:'json'},endpoints.mindImport)).document;
      if(continueLive){
        const published=await mutate('',{documentId:pendingSave.savedDocument.id,reason:'노드 편집기에서 저장하고 실전 설정을 선택해 이 전략의 사용과 발행을 요청했습니다.'},endpoints.mindApply);
        await enterLiveAutomationSettings(published,dialogToken);return;
      }
      if(dialogIsCurrent(dialogToken))await documentDetail(pendingSave.savedDocument.id);
      hooks.toast?.(simulationId?'실험에 사용한 정책을 새 초안으로 저장했습니다.':'전략 변경을 새 정책 초안으로 저장했습니다.');
    }});
  }
  const firstPaperPublishEffect='발행 후 같은 마인드의 모의 화면에서 결정 실행을 눌러 판단을 저장할 수 있습니다.';
  function documentImpactRows(doc,currentPolicy,{effect}={}){const impact=mindDocumentImpact(doc,{profileName:profileName(doc.scope?.profileId),currentPolicy});return '<section class="review-impact full" aria-label="반영 범위">'+row('자료 유형',esc(impact.kindLabel))+row('반영 대상',esc(impact.destination))+'<p class="spaced"><strong>발행 효과</strong><br>'+esc(effect??impact.effect)+'</p>'+(impact.changes.length?row('변경 항목',esc(impact.changes.join(' · '))):'')+'</section>';}
  function openDocumentPublish(id,{live=false,paperStarter=false}={}){
    const entry=list(mindData?.documents).find(d=>d.id===id),doc=entry?.document;
    const guided=paperStarter&&firstPaperDecision(currentRoute())&&firstDecisionPlan(doc?.data.strategyPlan);
    if(live&&(!doc||entry.status!=='DRAFT'||!isEventAutomationMind(doc)))throw new Error('실전 설정으로 연결할 분봉 정책 초안을 다시 여세요.');
    const context=live?savedPolicyContext(entry,savedMind(doc.scope.profileId)?.manifest)+'<p class="full">정책을 발행한 뒤 같은 마인드의 실전 설정을 엽니다. 기존 운용 한도를 불러오며 자동 주문은 운용 시작을 완료한 뒤 실행됩니다.</p><input type="hidden" name="afterPublish" value="live">'
      :paperStarter?(guided?'':'<p class="full">발행을 마치면 새 마인드의 전략 화면을 엽니다. 백테스트는 실험실에서 시작할 수 있습니다.</p>')+'<input type="hidden" name="afterPublish" value="paper-starter">':'';
    const reason=guided
      ?'<p class="full tiny muted" id="paper-review-reason-help">확인한 종목과 적용 범위를 적어 주세요. 검토 사유는 발행 기록에 남습니다.</p>'+
        area('검토 사유 (10자 이상)','reason','','aria-describedby="paper-review-reason-help" data-paper-review-reason minlength="10"',2000)
      :area('근거·적용 범위·검토 이유','reason',live?doc.title+'의 노드와 투자 범위를 확인하고 실전 운용 설정으로 연결합니다.':'');
    return form(live?'정책 확인 후 실전 설정':guided?'첫 모의 판단 전략 발행':'자료 검토·발행','document-publish',
      documentImpactRows(doc,savedMind(doc.scope?.profileId)?.manifest,{effect:guided?firstPaperPublishEffect:undefined})+context+reason,id,
      live?'발행하고 실전 설정':guided?'전략 발행':'검토 후 발행');
  }
  async function enterLiveAutomationSettings(result,dialogToken){
    if(!dialogIsCurrent(dialogToken))return;
    const mindId=result.manifest?.scope.profileId;
    if(!mindId||savedMind(mindId)?.manifest?.id!==result.manifest.id)throw new Error('정책은 발행됐습니다. 최신 정책을 새로고침한 뒤 실전 설정을 여세요.');
    const r=currentRoute(),sameRoute=r.page==='minds'&&r.params.get('profileId')===mindId&&r.params.get('view')==='operations'&&executionModeOf(r)==='live';
    hooks.close?.();liveAutomationIntent={mindId,configure:true};hooks.navigate?.('minds',{profileId:mindId,view:'operations',executionMode:'live'});if(sameRoute)await completeLiveAutomationEntry();
  }
  async function completeLiveAutomationEntry(){
    const intent=liveAutomationIntent,r=currentRoute();if(!intent||r.page!=='minds'||r.params.get('view')!=='operations'||r.params.get('profileId')!==intent.mindId||executionModeOf(r)!=='live')return;
    liveAutomationIntent=null;const dialogToken=hooks.getDialogToken?.();await automatedTrading.load({force:true});
    if(disposed||currentRoute().params.get('profileId')!==intent.mindId||executionModeOf(currentRoute())!=='live'||!dialogIsCurrent(dialogToken))return;
    if(intent.configure)automatedTrading.openConfigure({transition:true});else automatedTrading.openSettings();
  }
  let documentEditorRetry=null;
  async function openDocumentEditor(kind='mind-policy',initial='',selectedProfileId=null,withExample=false){
    documentEditorRetry=null;
    const selectedKind=MIND_FORM_KINDS.includes(kind)?kind:'mind-policy',profileId=selectedProfileId||(initial&&formEditor?.profileId?formEditor.profileId:currentRoute().params.get('profileId'));
    if(!profileId||profileId==='all')return chooseDocumentMind(withExample?'template':'import',selectedKind);
    if(!list(workspace.investmentProfiles).some(p=>p.id===profileId))throw new Error('적용할 마인드를 다시 선택하세요.');
    if(!forms.length||formsProfileId!==profileId){
      const scope=JSON.stringify([currentRoute().page,currentRoute().params.toString()]);
      hooks.open?.('표준 양식 가져오기','<p class="empty" role="status" aria-live="polite">양식을 불러오는 중…</p>');
      const token=hooks.getDialogToken?.(),current=()=>!disposed&&dialogIsCurrent(token)&&scope===JSON.stringify([currentRoute().page,currentRoute().params.toString()]);
      try{const loaded=await request(endpoints.mindForms+'?'+new URLSearchParams({mindId:profileId}));if(!current())return;forms=loaded.templates;formsProfileId=profileId;}
      catch(problem){if(current()){hooks.open?.('표준 양식 가져오기','<p class="error-text wrap-anywhere" role="alert">'+esc(problem.message)+'</p>',button('다시 조회','document-editor-retry'));documentEditorRetry={kind:selectedKind,initial,profileId,withExample,scope,token:hooks.getDialogToken?.()};}return;}
    }
    const example=byId(forms,selectedKind)||forms.find(f=>f.kind===selectedKind),source=initial||(withExample&&example?.example?JSON.stringify(example.example,null,2):'');formEditor={...(formEditor||{}),kind:selectedKind,source,profileId,format:'auto',validated:null};
    form('표준 양식 가져오기','document','<fieldset class="form-section full"><legend>읽기 설정</legend><div class="form-grid">'+select('양식','kind',MIND_FORM_KINDS.map(k=>[k,formNames[k]]),selectedKind)+select('파일 형식','format',[['auto','자동 감지'],['json','JSON'],['yaml','YAML']],'auto')+'<label class="field full">JSON · YAML 파일<input type="file" accept=".json,.yaml,.yml,application/json,text/yaml" data-studio-document-file></label></div></fieldset><fieldset class="form-section full studio-document-workspace"><legend>원문과 검증</legend><div class="studio-document-toolbar" role="group" aria-label="문서 검증 도구">'+button('형식 검증','validate-document')+button('예시로 바꾸기','document-template',selectedKind)+helpLabel('가져오기 안내','출처, 공개 시점과 적용 마인드를 함께 저장합니다. 저장된 정책은 원본 이력을 연결한 새 버전 초안으로 가져옵니다. 가져온 자료는 검토 대기로 등록됩니다.')+'</div><div id="document-validation" data-document-validation class="tiny studio-document-validation" role="status"></div>'+area('문서 내용','source',source,'class="studio-document-input" spellcheck="false" aria-describedby="document-validation studio-form-error"',null)+'</fieldset>',profileId,'검토 대기로 저장');
  }
  async function prepareDocumentImport(formNode,values){
    const format=values.format==='auto'?(/^[\s\uFEFF]*[\[{]/.test(values.source)?'json':'yaml'):values.format;
    assertDocumentRequestSize(endpoints.mindImport,JSON.stringify({text:values.source,format,idempotencyKey:'0'.repeat(36),expectedRevision:workspace?.revision}));
    const doc=parseMindDocument(values.source,{format});
    if(doc.kind!==values.kind)throw new Error('선택한 양식과 문서 kind를 맞추세요.');
    if(doc.kind!=='mind-policy')return {text:values.source,format};
    const profileId=formEditor?.profileId||currentRoute().params.get('profileId');
    if(doc.scope.profileId!==profileId)throw new Error('문서의 적용 마인드와 선택한 마인드를 맞추세요.');
    const pending=documentImports.get(formNode);
    if(pending?.text===values.source&&pending.format===format)return pending;
    const dialogToken=hooks.getDialogToken?.(),catalog=await request(endpoints.minds);
    if(!formNode.isConnected||!dialogIsCurrent(dialogToken)||formNode.elements.source.value!==values.source||formNode.elements.format.value!==values.format)return null;
    setMindCatalog(catalog);
    const documents=draftCatalog(),policies=documents.map(entry=>entry.document||entry.manifest||entry).filter(value=>value?.kind==='mind-policy');
    const needsDraft=policies.some(value=>value.id===doc.id||(value.scope.profileId===profileId&&value.data.version>=doc.data.version))||doc.data.strategyPlan?.status==='APPROVED';
    const draft=needsDraft?copyMindDocumentDraft(doc,{documents,mindId:profileId}):null;
    const text=draft?(format==='json'?JSON.stringify(draft):serializeMindDocument(draft,{format})):values.source,payload={text,format};
    documentImports.set(formNode,payload);formNode.elements.source.value=text;
    return payload;
  }
  function terminalFailureEvent(eventId){
    const selected=selectedIdentity(),event=list(workspace?.activityEvents).find(value=>value.id===eventId);
    if(event?.eventType!=='MIND_PROVIDER_FAILED'||event.payload?.mindId!==selected.profileId||event.payload?.instrumentId!==selected.instrument.id||!event.payload?.providerFailure)throw new Error('선택한 마인드와 종목의 요청 기록을 다시 조회하세요.');
    return event;
  }
  async function openTerminalFailure(eventId){
    try{const event=terminalFailureEvent(eventId),failure=event.payload.providerFailure;
      hooks.open?.('결정 요청 기록',row('마인드',esc(profileName(event.payload.mindId)))+row('종목',esc(getInstrument(event.payload.instrumentId).symbol))+row('요청 시각',esc(when(failure.provider?.startedAt??event.occurredAt)))+providerFailureMarkup(failure,{downloadAction:'terminal-failure-download',downloadIdPrefix:event.id+':'}));
    }catch(problem){hooks.toast?.(problem.message);}
  }
  function openTerminalConnections({reviewKey=false}={}){
    const origin=currentRoute();
    if(reviewKey){terminalFailure=null;invalidateTerminal();}
    return hooks.navigate?.('settings',{view:'connections',jevReview:reviewKey?'1':null,returnTo:studioRouteHash(origin,'trade',{returnTo:null})});
  }
  function openTerminalData(){
    return hooks.navigate?.('settings',{view:'data',returnTo:studioRouteHash(currentRoute(),'trade',{returnTo:null})});
  }
  async function recoverTerminal(recovery){
    const {profileId,instrument}=selectedIdentity(),params=recovery?.params||{};
    switch(recovery?.action){
      case 'choose-mind': {const picker=root?.querySelector('[data-terminal-mind]');picker?.focus();try{picker?.showPicker?.();}catch{}return;}
      case 'account': return openAccountForm({mindId:profileId,quoteCurrency:instrument.quoteCurrency});
      case 'connections': return openTerminalConnections({reviewKey:Boolean(params.eventId)});
      case 'data': return openTerminalData();
      case 'profile': return hooks.navigate?.('minds',{profileId,view:'operations'});
      case 'archive': return hooks.navigate?.('minds',{profileId:'all',mindStatus:'archived'});
      case 'knowledge': return hooks.navigate?.('minds',{profileId,view:'knowledge'});
      case 'records': return params.eventId?openTerminalFailure(params.eventId):params.runId?openDecision(params.runId):hooks.navigate?.('minds',{profileId,view:'records'});
      case 'paper': return hooks.navigate?.('trade',{executionMode:'paper'});
      case 'timeframe': {
        const selected=params.instrumentId?getInstrument(params.instrumentId):instrument;
        const timeframe=selected.timeframes.includes(params.timeframe)?params.timeframe:selected.defaultTimeframe;
        return hooks.navigate?.('trade',{instrumentId:selected.id,timeframe,mode:'live',comparisonId:null});
      }
      case 'refresh': {if(params.mode==='live'){const identity=selectedIdentity();return identity.mode!=='live'||identity.comparisonId?hooks.navigate?.('trade',{mode:'live',comparisonId:null}):loadTerminal({force:true});}return refresh();}
      case 'run': return runSelected();
      default: return;
    }
  }
  async function runSelected(){
    if(executionModeOf(currentRoute())==='live')return hooks.navigate?.('minds',{profileId:currentRoute().params.get('profileId')||'all',view:'operations',executionMode:'live'});
    const {instrument,timeframe,profileId,comparisonId,mode}=selectedIdentity(),group=byId(workspace.comparisons,comparisonId),marketAsOf=terminalData?.terminalReadiness?.marketRecovery?.asOf,policyHash=terminalData?.terminalReadiness?.executionReadiness?.policy?.hash;
    const dialogToken=hooks.getDialogToken?.();
    try{
      if(group){
        const cursor=group.cursorAt;
        for(let i=0;i<3;i++){
          const value=await mutate('',{comparisonId},'/api/workspace/comparisons/run'),current=byId(workspace.comparisons,comparisonId);
          if(!current||current.cursorAt!==cursor||value.report?.status!=='partial'||value.report?.failed>0||!(value.report?.processed>0))break;
        }
        await loadTerminal({force:true});
        return;
      }
      const result=await mutate('',{mindId:profileId,instrumentId:instrument.id,timeframe,mode,executionMode:'paper',expectedPolicyHash:policyHash,expectedMarketAsOf:marketAsOf},endpoints.terminalEvaluate);
      terminalFailure=null;
      if(disposed)return;
      if(!dialogIsCurrent(dialogToken)){
        hooks.toast?.('모의 판단을 저장했습니다.');
        return;
      }
      await Promise.all([loadTerminal({force:true}),openDecision(result.run.id)]);
    }catch(problem){
      const authRejected=problem.recovery?.category==='JEV_AUTH';
      if(problem.providerFailureEventId&&(authRejected||problem.recovery?.action?.retryPolicy==='INSPECT_EXISTING_ATTEMPT')){
        terminalFailure={profileId,instrumentId:instrument.id,timeframe,marketAsOf,policyHash,eventId:problem.providerFailureEventId,recovery:problem.recovery};
      }
      if(authRejected&&problem.providerFailureEventId){redraw();if(!dialogIsCurrent(dialogToken))hooks.toast?.(problem.message);return;}
      if(problem.terminalReadiness||String(problem.code||'').startsWith('TERMINAL_'))await loadTerminal({force:true});
      error=problem.message;redraw();hooks.toast?.(problem.message);
    }
  }
  function memoryPropose(id){const e=byId(workspace.experiences,id),eligible=list(workspace.experiences).filter(v=>v.status==='EVALUATED'&&v.investmentProfileId===e.investmentProfileId&&v.deploymentId===e.deploymentId&&v.experimentId===e.experimentId&&v.experienceType===e.experienceType);form('학습 후보 작성','memory-propose',field('제목','title',when(e.occurredAt)+' 관측 검토')+select('지식 유형','knowledgeType',types,'HYPOTHESIS')+`<label class="field full">근거 경험<select name="experienceIds" multiple size="${Math.min(6,Math.max(2,eligible.length))}" required>${eligible.map(v=>`<option value="${esc(v.id)}"${v.id===id?' selected':''}>${esc(when(v.occurredAt)+' · '+pct(v.observation?.performance?.netReturn)+' · '+v.summary)}</option>`).join('')}</select></label>`+area('관측 조건·내용·적용 범위','text',e.evaluation?.summary||'')+(e.experienceType==='EXECUTION_OPERATION'?area('투자 선택에 기여하는 근거','investmentRelevance'):''),id);}
  function memoryValidate(id){const c=byId(workspace.memoryCandidates,id);form('학습 후보 검증','memory-validate',select('지식 유형','knowledgeType',types,c.knowledgeType)+area('검증 요약','summary')+area('반례·적용이 깨지는 조건','counterexamples')+area('표본 외 근거·추가 확인 계획','forwardEvidence')+area('검증 계획','validationPlan',c.validationPlan||'')+area('불확실성','uncertainty',c.uncertainty||''),id);}
  function weightCohorts(mindId,principleId){const groups=new Map();for(const saved of list(mindData?.documents)){const d=saved.document||saved;if(saved.status!=='APPROVED'||d.kind!=='principle-evidence'||d.scope?.profileId!==mindId||d.data?.principleId!==principleId||d.schemaVersion!==2)continue;for(const c of list(d.evaluation?.cohorts).filter(c=>c.tag?.principleId===principleId)){const key=c.tag.cohortKey;if(!groups.has(key))groups.set(key,{key,tag:c.tag,count:0});groups.get(key).count++;}}return [...groups.values()].sort((a,b)=>a.key.localeCompare(b.key));}
  async function proposeWeight(principleId){const mindId=currentRoute().params.get('profileId'),cohorts=weightCohorts(mindId,principleId);if(cohorts.length>1)return form('가중치 평가 묶음 선택','weight-propose','<input type="hidden" name="mindId" value="'+esc(mindId)+'">'+select('비교할 평가 묶음','cohortKey',[['','평가 묶음을 선택하세요'],...cohorts.map((c,index)=>[c.key,'평가 묶음 '+(index+1)+' · '+({trending_up:'상승',trending_down:'하락',range:'횡보',volatile:'변동성 확대',unknown:'국면 미분류'})[c.tag.marketRegime]+' · '+c.count+'건 · '+cohortPolicyLabel(c.tag.policyVersion)])])+'<div class="full">'+helpLabel('비교 조건','같은 원칙·국면·정책·비용·벤치마크 조건의 근거끼리 비교합니다.')+'</div>',principleId,'선택한 묶음 검토');const value=await mutate('',{mindId,principleId,...(cohorts.length?{cohortKey:cohorts[0].key}:{})},'/api/workspace/minds/weights/propose');return documentDetail(value.document.id);}
  function applyMemoryForm(profileId){const p=byId(workspace.investmentProfiles,profileId),versions=list(workspace.memoryVersions).filter(v=>v.investmentProfileId===profileId),deployments=list(workspace.deployments).filter(d=>d.investmentProfileId===profileId);form('운용 기억 적용','memory-apply',select('대상 운용','deploymentId',deployments.map(d=>[d.id,d.name]))+select('승인 기억','sourceMemoryVersionId',versions.map(v=>[v.id,`v${v.version} · ${list(v.items).length}건`]),p.currentMemoryVersionId)+area('적용 이유','reason')+'<p class="tiny full muted">선택한 운용을 일시중지하고 새 기억 버전을 적용합니다. 사용 가능 시각 이후의 확정 봉부터 입력에 포함됩니다.</p>',profileId,'일시중지 후 적용');}
  function universeEditorState(formNode){return {mindId:formNode.dataset.studioId,draft:readUniverseForm(new FormData(formNode)),searches:Object.fromEntries([...formNode.querySelectorAll('[data-universe-options-search]')].map(input=>[input.dataset.universeOptionsKey,input.value])),routeKey:studioRouteHash(currentRoute(),currentRoute().page)};}
  function rememberCatalogItems(items){for(const item of items){try{instrumentMetadata.set(item.id,{...getInstrument(item.id),...item});}catch{}}}
  function bindCatalogDialog(){catalogPickerCleanup?.();catalogPickerCleanup=bindUniverseCatalogPickers(typeof document==='undefined'?null:document.querySelector?.('#detail-dialog'),{request,onItems:rememberCatalogItems,onCollectSector:async filters=>{if(busy||sectorCollecting)throw new Error('진행 중인 자료 수집이 끝난 뒤 다시 시도하세요.');const result=await mutate('',{provider:'toss',markets:filters.market?[filters.market]:['KR','US'],sectorIds:[filters.sectorId]},'/api/workspace/universe/sources');hooks.toast?.('선택한 섹터의 구성 종목을 저장했습니다.');return result;},onChoose:item=>{rememberCatalogItems([item]);hooks.close?.();hooks.navigate?.('trade',{instrumentId:item.id,timeframe:'1d',comparisonId:null,mode:'live'});}});}
  async function openInstrumentCatalog(){const token=openRecordLoading('전체 주식 찾기');try{const catalog=await request('/api/workspace/universe/catalog');if(!dialogIsCurrent(token))return;catalogPickerCleanup?.();hooks.open?.('전체 주식 찾기',universeCatalogPickerMarkup(catalog,{key:'browse',title:'주식 찾기',mode:'navigate'})+'<div class="form-actions">'+button('전체 종목 새로고침','stocks-collect','',(catalog.toss?.collectAvailable===true||catalog.equities?.syncAvailable===true)?'':'disabled')+'</div>');bindCatalogDialog();}catch(problem){if(!disposed&&dialogIsCurrent(token))hooks.open?.('전체 주식 찾기','<p class="error-text wrap-anywhere" role="alert">'+esc(problem.message)+'</p>',button('다시 조회','instrument-catalog'));}}
  async function collectStockSource(node){
    if(sectorCollecting||busy)return;
    const formNode=node.closest?.('[data-studio-form="universe-policy"]'),state=formNode?universeEditorState(formNode):null,dialogToken=hooks.getDialogToken?.(),fromCatalog=!!node.closest?.('#detail-dialog')?.querySelector?.('[data-universe-catalog-picker]');
    if(isDataSettings())restoreMindActionFocus('stocks-collect','');const restore=commandProgress(node,'종목 목록 수집 중…');sectorCollecting=true;sectorCollectionKind='stocks';sectorCollectionError='';sectorCollectionMessage='';redraw();let problem=null;
    try{const result=await mutate('',{provider:'toss-stocks',markets:['KR','US']},'/api/workspace/universe/sources');sectorCollectionMessage=Number.isSafeInteger(result.source?.count??result.source?.instrumentCount)?'토스 종목 '+num(result.source.count??result.source.instrumentCount,0)+'개를 저장했습니다.':'토스 종목 목록을 저장했습니다.';if(dialogIsCurrent(dialogToken)){if(state)await openUniverseEditor(state.mindId,state.draft,state.searches);else if(fromCatalog)await openInstrumentCatalog();}if(!state)await loadCaptureStatus();hooks.toast?.(sectorCollectionMessage);}
    catch(error){problem=error;sectorCollectionError=error.message;const target=formNode?.querySelector?.('[data-studio-form-error]');if(target&&formNode.isConnected!==false)target.textContent=error.message;else hooks.toast?.(error.message);}
    finally{sectorCollecting=false;restore(problem);redraw();}
  }
  async function openUniverseEditor(mindId,draft=null,searches={}){const dialogToken=hooks.getDialogToken?.(),catalog=await request('/api/workspace/universe/catalog?'+new URLSearchParams({mindId}));if(!dialogIsCurrent(dialogToken))return;const manifest=savedMind(mindId)?.manifest,samePolicy=manifest&&JSON.stringify(manifest.data.universe)===JSON.stringify(catalog.policy),mind={name:profileName(mindId),version:samePolicy?manifest.data.version:null};universeImportReturn=null;form('투자 범위 편집','universe-policy',universeEditorMarkup(catalog,{draft,mind,searches}),mindId,'정책 초안 저장');bindCatalogDialog();}
  function usesEventPaperFunding(mindId){return isEventPaperMind(savedMind(mindId)?.manifest)||list(eventPaperBatch.items()).some(item=>item.profileId===mindId&&item.status!=='COMPLETED');}
  function openPaperCapitalForm(mindId,maximum=false){
    const instrument=mindInstrument(mindId),subscription=list(workspace.mindSubscriptions).find(s=>s.profileId===mindId&&s.status==='ENABLED'),accounts=list(workspace.mindPositions).filter(a=>a.kind==='PAPER_ACCOUNT'&&a.profileId===mindId),currency=subscription?.quoteCurrency||accounts[0]?.quoteCurrency||instrument?.quoteCurrency||'USDT',budget=paperBudgetSummary(workspace,currency),account=accounts.find(a=>a.quoteCurrency===currency);
    if(!budget.configured)return openAccountForm({mindId,quoteCurrency:currency});const current=account?Math.round((account.initialCash+list(account.fundingLedger).reduce((sum,f)=>sum+f.amount,0))*1e8)/1e8:0,max=Math.round((current+budget.available)*1e8)/1e8;
    form('운용 금액 수정','paper-capital','<div class="full">'+row('마인드',esc(profileName(mindId)))+row('배정 가능한 최대',money(max,currency)+' '+esc(currency))+'</div>'+field('운용 자금 ('+currency+')','capitalLimit',maximum?max:current,'number','min="0.00000001" max="'+max+'" step="any" required')+'<input type="hidden" name="quoteCurrency" value="'+esc(currency)+'"><div class="full">'+button('모의 계좌 최대 금액','paper-capital-max',mindId)+'</div><p class="full tiny muted">보유와 거래 기록을 유지합니다. 저장한 금액은 다음 판단부터 사용합니다.</p>',mindId,'저장하고 운용에 반영');
  }
  function openAccountForm(overrides={}){
    if(executionModeOf(currentRoute())==='live')return hooks.navigate?.('settings',{view:'accounts',executionMode:'live'});
    const mindId=overrides.mindId||currentRoute().params.get('profileId'),minds=list(mindData?.minds),picker=select('마인드','mindId',[['','마인드 선택'],...minds.map(m=>[m.id,m.name||profileName(m.id)])],mindId);
    if(!mindId||mindId==='all')return form('자금 배정·회수','mind-account',picker+'<p class="full">자금을 배정하거나 회수할 마인드를 선택하세요.</p>','','계속');
    if(usesEventPaperFunding(mindId))return form('자금 배정·회수','mind-account',picker+'<p class="full">분봉 모의운용 화면에서 배정 금액을 정하고 시작 조건을 검토하세요. 자금 회수도 같은 화면에서 진행합니다.</p>','','분봉 모의운용 준비 열기');
    const instrument=currentRoute().page==='trade'?selectedIdentity().instrument:mindInstrument(mindId),currency=overrides.quoteCurrency||instrument?.quoteCurrency||'USDT',b=paperBudgetSummary(workspace,currency);
    if(!b.configured){
      if(currentRoute().page==='trade')return openBudgetForm(currency,mindId);
      hooks.open?.('모의 예산 설정',row('통화',esc(currency))+row('예산','설정에서 공용 예산을 만든 뒤 마인드에 배정하세요.'),button('예산 설정','budget-edit',currency)+button('계좌·자금 열기','accounts-settings'));return;
    }
    form('자금 배정·회수','mind-account',picker+select('통화','quoteCurrency',['KRW','USD','USDT','BTC'].map(c=>[c,c]),currency)+select('자금 이동','direction',[['allocate','배정'],['release','회수']],'allocate')+field('금액','amount',Math.min(b.available,currency==='KRW'?1000000:currency==='BTC'?0.01:1000),'number','min="0.00000001" max="1000000000000" step="any"')+'<div class="full" data-funding-capacity>'+row('배정 가능',money(b.available,currency)+' '+esc(currency))+'</div>','','자금 이동');
  }
  async function openMindOrderReview(id){const dialogToken=openRecordLoading('모의 체결 검토');try{const value=await request('/api/workspace/decisions/detail?id='+encodeURIComponent(id));if(disposed||!dialogIsCurrent(dialogToken))return;const run=value.decision.run||value.decision.record,hold=run.decision?.action==='hold';hooks.open?.(hold?'후속 관측 기준 검토':'모의 체결 검토',row('종목',esc(run.instrumentId))+row('마인드',esc(profileName(run.profileId)))+row('행동',esc(({buy:'매수',sell:'매도',hold:'유지'})[run.decision?.action]||run.decision?.action))+row('목표 비중',pct(run.risk?.targetWeight))+row('선택 확신도',pct(run.decision?.confidence))+'<p class="tiny muted spaced">'+(hold?'기준을 저장하면 새 시세와 계좌 상태를 후속 관측에 사용합니다.':'저장된 결정과 계좌를 대조하고 새 실행 가격·위험·비용 조건을 확인한 뒤 모의 원장에 체결합니다.')+'</p>'+raw(run.risk,'위험·비용 검사')+(run.execution?.reason?row('실행 사유',esc(run.execution.reason)):'')+raw(run.execution,'모의 주문 상태'),button(hold?'후속 관측 기준 저장':'모의 체결 실행','mind-order-execute',id,busy?'disabled':''));}catch(problem){if(!disposed&&dialogIsCurrent(dialogToken))hooks.open?.('모의 체결 검토','<p class="empty error-text" role="alert">'+esc(problem.message)+'</p>',button('다시 조회','mind-order-review',id));}}
  function observationCohortMarkup(observation){const cohorts=list(observation?.cohorts);if(!cohorts.length)return '';return '<section class="spaced"><h3>자동 운용 평가 기준</h3>'+row('평가 정책',esc([...new Set(cohorts.map(c=>cohortPolicyLabel(c.tag?.policyVersion)))].join(' · ')))+row('실제 관측 길이',esc(duration(Date.parse(observation.period?.end)-Date.parse(observation.period?.start))))+table(['원칙','기간 적격','독립성 검토'],cohorts.map(c=>{const p=list(mindData?.minds).flatMap(m=>list(m.manifest?.data.principles)).find(p=>p.id===c.tag?.principleId);return [esc(p?.title||'저장 원칙'),c.assessment?.cohortEligible===true?'적격':c.assessment?.cohortEligible===false?'제외':'검토 상태 확인',c.tag?.independence?.independentGroupApproved===true?'독립 기회 승인됨':'독립 기회 검토 필요'];}))+'</section>';}
  async function openMindObservation(id){const dialogToken=openRecordLoading('결정 후속 관측');try{const value=await request('/api/workspace/terminal/observation?'+new URLSearchParams({runId:id}));if(disposed||!dialogIsCurrent(dialogToken))return;const observation=value.observation;hooks.open?.('결정 후속 관측',row('진행 상태',esc(({WAITING_TIME:'관측 기간 대기',DATA_REQUIRED:'후속 자료 확인 필요',OBSERVED:'관측 완료'})[value.status]||'관측 기준 확인'))+row('관측 종료',esc(when(value.dueAt)))+list(value.reasons).map(r=>'<p class="tiny muted spaced">'+esc(r.message)+'</p>').join('')+(observation?row('순수익률',pct(observation.metrics?.netReturn))+row('동기간 보유 대조',pct(observation.metrics?.benchmarkReturn))+row('기준 대비',Number.isFinite(observation.metrics?.netReturn)&&Number.isFinite(observation.metrics?.benchmarkReturn)?percentagePoints(observation.metrics.netReturn-observation.metrics.benchmarkReturn):'—')+row('실제 관측 길이',esc(duration(Date.parse(observation.period?.end)-Date.parse(observation.period?.start))))+row('최대 낙폭',pct(observation.metrics?.maxDrawdown))+observationCohortMarkup(observation)+raw(observation,'관측 원본'):'<div class="spaced">'+helpLabel('후속 관측','결정 당시 계좌와 가격을 이후 확정 시세와 비교해 결과를 계산합니다.')+'</div>'),(value.status==='DATA_REQUIRED'?button('관측 자료 수집','mind-observe',id,busy?'disabled':''):button('관측 상태 다시 조회','mind-observation',id))+(observation?button('거래 분석 양식','review-from-run',id)+button('원칙 검증 근거','evidence-from-run',id):'')+button('판단 상세','decision',id));}catch(problem){if(!disposed&&dialogIsCurrent(dialogToken))hooks.open?.('결정 후속 관측','<p class="empty error-text" role="alert">'+esc(problem.message)+'</p>',button('다시 조회','mind-observation',id));}}
  async function click(event){
    if(formSaving){event.preventDefault();event.stopImmediatePropagation?.();return;}
    if(event.target.closest?.('[data-event-paper-action]')?.dataset?.eventPaperAction)return eventPaper.click(event);
    if(event.target.closest?.('[data-auto-action]')?.dataset?.autoAction)return automatedTrading.click(event);
    if(event.target.closest?.('[data-broker-action]')?.dataset?.brokerAction)return brokers.click(event);
    const node=event.target.closest?.('[data-studio-action]');if(!node||node.disabled)return;const action=node.dataset.studioAction,id=node.dataset.studioId||'';if(action==='execution-mode'){if(!['paper','live'].includes(id))return;event.preventDefault();executionModeFocus=id;hooks.close?.();return hooks.navigate?.(currentRoute().page,{executionMode:id});}if(executionModeOf(currentRoute())==='live'&&!SHARED_STUDIO_ACTIONS.has(action)){event.preventDefault();hooks.toast?.('모의 운용 작업은 모의 보기에서 진행하세요.');return;}if(action==='close-dialog'){recoveryGeneration++;recoveryData=null;return;}if(action.startsWith('subscription-')&&busy)return;if(!['subscription-recovery','subscription-reconcile','subscription-recover','subscription-abandon','export-workspace','provider-failure-download'].includes(action))recoveryGeneration++;event.preventDefault();
    const progressLabels={'news-run':'JEV 비교 실행 중…','document-classify':'JEV 분류 중…','universe-select':'JEV 종목 선정 중…','mind-order-execute':'모의 실행 중…','order-execute':'모의 실행 중…','mind-observe':'후속 관측 조회 중…','experience-observe':'후속 관측 조회 중…','weight-propose':'가중치 근거 검토 중…','jobs-run':'예약 작업 처리 중…','subscription-pause':'일시중지 중…','subscription-run-now':'전략·모의 체결 처리 중…','subscription-retry-execution':'시세 조회·모의 체결 중…',connections:'상태 조회 중…','export-workspace':'내보낼 원본 조회 중…'};if(progressLabels[action]&&(busy||action==='connections'&&connectionLoading))return;if(action==='connections')rememberMindActionFocus();const finish=progressLabels[action]?commandProgress(node,progressLabels[action]):()=>{};let commandError=null;
    try{
      if(action==='live-record-search-clear'){clearTimeout(searchTimer);searchDraft=null;search='';recordFieldFocus={start:0,end:0};recordCursors.reset();hooks.navigate?.('minds',{view:'records',search:null,cursor:null});redraw();return;}
      if(action==='home-recommendation-details')return home.showDetails('recommendation');
      if(action==='knowledge-filters-clear'){const changes={documentKind:null,documentStatus:null,knowledgePage:null},next=parseStudioRoute(studioRouteHash(currentRoute(),'minds',changes));mindActionFocus={action,id:'',scope:next.page+'?'+next.params.toString(),fallback:null};return hooks.navigate?.('minds',changes);}
      if(action==='refresh'){const route=currentRoute(),keepFocus=route.page==='settings'&&route.params.get('view')==='capabilities'&&typeof document!=='undefined'&&document.activeElement===node;try{return await refresh();}finally{const next=currentRoute();if(keepFocus&&next.page===route.page&&next.params.toString()===route.params.toString()&&document.activeElement===document.body)root?.querySelector('[data-studio-action="refresh"]')?.focus({preventScroll:true});}}
      if(action==='companion-refresh')return await refresh();
      if(action==='paper-records-refresh'){if(executionModeOf(currentRoute())!=='paper'||!isRecordsRoute(currentRoute()))return;restoreMindActionFocus(action,'');if(eventPaperBatch.state().loading){redraw();return;}const read=loadEventPaperBatch({force:true});redraw();return await read;}
      if(action==='live-activity-refresh'){restoreMindActionFocus(action,'');return await loadLiveActivity({force:true});}
      if(action==='memory-refresh'){restoreMindActionFocus(action,'');return await loadMemoryView({force:true});}
      if(action==='capture-status')return await loadCaptureStatus();
      if(action==='capture-collect')return await collectCapture();
      if(action==='companion-valuation-refresh')return loadCompanionValuations({force:true});
      if(action==='mind-status')return hooks.navigate?.('minds',{profileId:'all',view:'overview',mindStatus:id==='archived'?'archived':null});
      if(action==='profile-archive'||action==='profile-restore')return openProfileLifecycle(id,action==='profile-restore');
      if(action==='mind-automation')return await enterMindAutomation(id);
      if(action==='subscription-refresh')return await loadMindSubscriptions({force:true});
      if(action==='subscription-retry-execution'){
        const subscription=byId(subscriptionData?.subscriptions,id),runId=node.dataset.studioRunId,retry=list(subscription?.executionRetries).find(item=>item.subscriptionId===id&&item.runId===runId);
        if(subscriptionMindId!==currentRoute().params.get('profileId')||subscription?.profileId!==subscriptionMindId||!executionRetryReady(retry))throw new Error(retry?.retryable?'결정의 실행 가능 시간이 지났습니다.':retry?.message||'현재 봉의 미체결 기록과 실행 가능 시간을 다시 확인하세요.');
        const value=await mutate('',{subscriptionId:id,runId},'/api/workspace/mind-subscriptions/retry-execution'),result=value.result||value;
        return hooks.toast?.(result.execution?.reason||executionLabel(result.execution?.status||result.status));
      }
      if(action==='paper-adaptation-configure')return openPaperAdaptation(id);
      if(action==='paper-adaptation-restart')return openPaperAdaptationRestart(id);
      if(action==='paper-adaptation-step'){
        const value=paperAdaptations.get(id);if(activePaperTrial(value?.trial))throw new Error('진행 중인 기준·후보 비교를 학습 설정에서 확인하세요.');if(!value?.eligibility?.eligible||!value.settings?.enabled||(value.intake?.count??0)<(value.intake?.minimumEpisodes??6))throw new Error('종료 거래 6건을 모은 뒤 비중을 비교하세요.');
        const result=await mutate('',{subscriptionId:id},'/api/workspace/paper-adaptation/step');await loadMindSubscriptions({force:true,quiet:true});return hooks.toast?.(paperAdaptationStatus(result.status));
      }
      if(action==='subscription-create')return openSubscriptionCreate();
      if(action==='subscription-enable')return openSubscriptionEnable(id);
      if(action==='subscription-version')return openSubscriptionVersion(id);
      if(action==='subscription-account')return openAccountForm({mindId:id,quoteCurrency:'USDT'});
      if(action==='subscription-pause')return await pauseMindSubscription(id);
      if(action==='provider-failure-download'){if(!recoveryScopeMatches(recoveryMindId,recoveryViewGeneration)||!['request','response'].includes(id))throw new Error('대상 저장 기록을 다시 조회하세요.');const record=recoveryData?.recovery?.providerFailure?.[id];if(!['FULL','PREFIX'].includes(record?.retention)||!list(record.jsonChunks).length)throw new Error('내려받을 원문이 보관되지 않았습니다.');const partial=record.retention==='PREFIX',json=record.format==='JSON'&&!partial;return hooks.download?.(investmentFilename('jev-failed-'+id+(partial?'-partial':'')+(json?'.json':'.txt')),record.jsonChunks.join(''),json?'application/json':'text/plain');}
      if(action==='subscription-recovery')return await openSubscriptionRecovery(id);
      if(action==='subscription-reconcile')return await runSubscriptionRecovery('reconcile');
      if(action==='subscription-recover')return await runSubscriptionRecovery('recover');
      if(action==='subscription-abandon')return openSubscriptionAbandon(id);
      if(action==='profile-open')return hooks.navigate?.('minds',{profileId:id,view:'overview',cursor:null});
      if(action==='profile-knowledge')return hooks.navigate?.('minds',{profileId:id,view:'knowledge'});
      if(action==='strategy-plan')return strategyPlanForm(id);
      if(action==='activity-strategy-draft'){
        const reference={mindId:id,manifestId:node.dataset.studioManifestId,manifestHash:node.dataset.studioManifestHash,graphHash:node.dataset.studioGraphHash};
        if(!draftCatalog().some(value=>(value.document??value)?.id===reference.manifestId))setMindCatalog(await request(endpoints.minds));
        return openPolicyGraphDraft({manifest:activityPolicyDraftSource(draftCatalog(),reference),mindId:id});
      }
      if(action==='strategy-graph'){const token=hooks.getDialogToken?.();setMindCatalog(await request(endpoints.minds));if(!dialogIsCurrent(token))return;const manifest=savedMind(id)?.manifest;if(!manifest)throw new Error('현재 마인드 정책을 다시 조회하세요.');const draft=executionModeOf(currentRoute())==='paper'?latestStrategyDraft(manifest,list(mindData?.documents)):null;return openPolicyGraphDraft({manifest:draft??manifest,mindId:id,requireCurrentPolicy:!draft,expectedBasePolicy:draft?mindDocumentHash(manifest):null});}
      if(action==='knowledge-policy')return knowledgePolicyForm(id);
      if(action==='mind-view')return hooks.navigate?.('minds',{profileId:id,view:node.dataset.studioView,cursor:null,knowledgePage:null});
      if(action==='mind-execution')return openMindExecution(id);
      if(action==='strategy-parameter')return openStrategyParameter(id);
      if(action==='document-note')return openContextNote(id||currentRoute().params.get('profileId'));
      if(action==='mind-lab')return openMindLab(id);
      if(action==='mind-trade')return openMindTrading(id);

      if(action==='mind-instrument'){const profileId=currentRoute().params.get('profileId');if(experimentScope(savedMind(profileId)?.manifest))return openMindTrading(profileId);const instrument=getInstrument(id);return hooks.navigate?.('trade',{profileId:currentRoute().params.get('profileId'),instrumentId:id,timeframe:instrument.defaultTimeframe,mode:'live',comparisonId:null});}
      if(action==='mind-knowledge-view')return hooks.navigate?.('minds',{view:'knowledge',knowledgeView:id,knowledgePage:null});
      if(action==='knowledge-page'){const changes={knowledgePage:id},next=parseStudioRoute(studioRouteHash(currentRoute(),currentRoute().page,changes));mindActionFocus={kind:'knowledge-page',scope:next.page+'?'+next.params.toString(),fallback:null};return hooks.navigate?.(currentRoute().page,changes);}
      if(action==='open-library')return hooks.navigate?.('library',{view:'documents',profileId:null,cursor:null});
      if(action==='mind-knowledge-view')return hooks.navigate?.('minds',{view:'knowledge',knowledgeView:id,knowledgePage:null});
      if(action==='open-library')return hooks.navigate?.('library',{view:'documents',profileId:null,cursor:null});
      if(action==='mind-library-refresh'){restoreMindActionFocus('mind-library-refresh','');return await loadMindLibrary({force:true});}
      if(action==='mind-library-first'){mindLibraryCursors.reset();if(currentRoute().params.has('cursor'))return navigateMindLibrary(null);mindActionFocus={kind:'mind-library-page',scope:mindFocusScope(),fallback:null};return await loadMindLibrary({force:true});}
      if(action==='mind-library-next'){if(mindLibraryLoading||mindLibraryKey!==mindLibraryQuery().toString()||mindLibraryError||!mindLibraryData?.page?.hasMore||!id||id!==mindLibraryData.page.nextCursor)return;mindLibraryCursors.remember(mindLibraryQuery(),id);return navigateMindLibrary(id);}
      if(action==='mind-library-prev'){if(mindLibraryLoading||!mindLibraryQuery().has('cursor'))return;return navigateMindLibrary(mindLibraryCursors.previous(mindLibraryQuery()));}
      if(action==='calendar-refresh')return calendar.load({force:true});
      if(action==='profile-edit'||action==='profile-new')return profileForm(id);
      if(action==='mind-customize')return mindAppearanceForm(id);
      if(action.startsWith('news-'))return await newsComparisons.click(action,id,node);
      if(action==='decision')return await openDecision(id);
      if(action==='experience')return await openExperience(id);
      if(action==='candidate')return openCandidate(id);
      if(action==='terminal-failure-download'){
        const split=id.lastIndexOf(':'),eventId=id.slice(0,split),part=id.slice(split+1),saved=terminalFailureEvent(eventId),record=saved.payload.providerFailure[part];
        if(!['request','response'].includes(part)||!['FULL','PREFIX'].includes(record?.retention)||!list(record?.jsonChunks).length)throw new Error('내려받을 원문 보관 상태를 확인하세요.');
        const partial=record.retention==='PREFIX',json=record.format==='JSON'&&!partial;
        return hooks.download?.(investmentFilename('jev-failed-'+part+(partial?'-partial':'')+(json?'.json':'.txt')),record.jsonChunks.join(''),json?'application/json':'text/plain');
      }
      if(action==='event')return hooks.open?.('활동 기록',raw(byId(workspace.activityEvents,id)));
      if(action==='experience-observe'){if(await mutateInDialog('experience.observe.market',{experienceId:id,horizonHours:24}))return await openExperience(id);return;}
      if(action==='experience-evaluate'){const e=byId(workspace.experiences,id);return form('경험 평가','experience-evaluate',area('평가 요약·대조 결과·반례','summary',e.evaluation?.summary||''),id);}
      if(action==='memory-propose')return memoryPropose(id);
      if(action==='memory-validate')return memoryValidate(id);
      if(action==='memory-approve'||action==='memory-reject')return form(action==='memory-approve'?'학습 후보 승인':'학습 후보 반려',action,area('검토 이유','reason'),id);
      if(action==='memory-apply')return applyMemoryForm(id);
      if(action==='paper-capital')return openPaperCapitalForm(id);if(action==='paper-capital-max')return openPaperCapitalForm(id,true);
      if(action==='mind-account')return openAccountForm();
      if(action==='mind-order-review')return await openMindOrderReview(id);
      if(action==='mind-order-execute'){const value=await mutate('',{runId:id},'/api/workspace/terminal/execute');hooks.close?.();await loadTerminal({force:true});if(value.execution?.status==='WAITING_EXECUTION_DATA'){hooks.toast?.(value.execution.reason||'새 실행 시세를 기다리고 있습니다.');return await openMindOrderReview(id);}return hooks.toast?.(value.execution?.status==='NO_ORDER_REQUIRED'?'보유 유지와 관측 기준을 저장했습니다.':'모의 체결을 원장에 저장했습니다.');}
      if(action==='mind-observation')return await openMindObservation(id);
      if(action==='mind-observe'){await mutate('',{runId:id},'/api/workspace/terminal/observe');return await openMindObservation(id);}
      if(action==='review-from-run'||action==='evidence-from-run'){const value=await mutate('',{runId:id,kind:action==='review-from-run'?'trade-review':'principle-evidence'},'/api/workspace/mind-documents/from-experience');return documentDetail(value.document.id);}
      if(action==='export')return await openExport(id);
      if(action==='document-export'){if(!reviewedDocumentExport||reviewedDocumentExport.id!==id||!dialogIsCurrent(reviewedDocumentExport.dialogToken))throw new Error('내보낼 자료를 다시 열어 주세요.');return openDocumentExport(reviewedDocumentExport.document);}
      if(action==='capability-search-clear'){const field=node.closest('[data-capability-catalog]').querySelector('[data-capability-search]');field.value='';updateCapabilitySearch(field);field.focus({preventScroll:true});return;}
      if(action==='document-new')return id?await openDocumentEditor(id,'',null,node.dataset.studioTemplate==='true'):openContextNote();
      if(action==='document-editor-retry'){const retry=documentEditorRetry;if(retry&&dialogIsCurrent(retry.token)&&retry.scope===JSON.stringify([currentRoute().page,currentRoute().params.toString()]))return await openDocumentEditor(retry.kind,retry.initial,retry.profileId,retry.withExample);return;}
      if(action==='download-document'&&formEditor?.doc)return hooks.download?.(investmentFilename(`${formEditor.doc.id}.${id}`),serializeMindDocument(formEditor.doc,{format:id}),id==='yaml'?'application/yaml':'application/json');
      if(action==='edit-export'&&formEditor?.doc)return openDocumentCopy(formEditor.doc);
      if(action==='document-template'){const formNode=node.closest('form'),kind=formNode.elements.kind.value,example=forms.find(f=>f.kind===kind)?.example;clearDocumentValidation(formNode);if(!example)throw new Error('이 양식의 원본을 다시 조회하세요.');replaceFormDraftValues(formNode,{source:JSON.stringify(example,null,2),format:'json'});for(const field of formNode.querySelectorAll?.('input[type="file"]')||[])field.value='';formEditor.doc=example;return;}
      if(action==='validate-document'){const formNode=node.closest('form');clearDocumentValidation(formNode);const doc=parseMindDocument(formNode.elements.source.value,{format:formNode.elements.format.value});if(doc.kind!==formNode.elements.kind.value)throw new Error('선택한 양식과 문서 kind를 맞추세요.');formEditor.validated=doc;const result=formNode.querySelector('[data-document-validation]');result.textContent=`형식 확인 완료 · ${formNames[doc.kind]} · ${doc.title}`;result.scrollIntoView?.({block:'center'});const top=result.getBoundingClientRect?.().top,edge=formNode.querySelector('.studio-document-toolbar')?.getBoundingClientRect?.().bottom;if(Number.isFinite(top)&&Number.isFinite(edge)&&top<edge)result.closest?.('.dialog-form-content')?.scrollBy?.({top:top-edge});return;}
      if(action==='record-next'){recordCursors.remember(recordsQuery(),id);return hooks.navigate?.('minds',{view:'records',cursor:id});}
      if(action==='record-prev'){const cursor=recordCursors.previous(recordsQuery());return hooks.navigate?.('minds',{view:'records',cursor});}
      if(action==='record-first'){recordCursors.reset();if(currentRoute().params.has('cursor'))return hooks.navigate?.('minds',{view:'records',cursor:null});return await loadRecords({force:true});}
      if(action==='export-records')return hooks.download?.(investmentFilename('records-page.json'),{scope:recordsData?.scope,revision:recordsData?.revision,page:recordsData?.page});
      if(action==='export-workspace'){const value=await request('/api/workspace',undefined,{workspaceView:'full'});return hooks.download?.(investmentFilename('server-workspace.json'),value.workspace);}
      if(action==='accounts-settings'){hooks.close?.();return hooks.navigate?.('settings',{view:'accounts'});}
      if(action==='workspace-reset')return await openResetPreview();
      if(action==='subscription-run-now'){
        await mutate('',{subscriptionId:id,optInPaper:true,autoExecute:true},'/api/workspace/mind-subscriptions/run-now');
        return hooks.toast?.('현재 확정 봉의 모의 운용 결과를 저장했습니다.');
      }
      if(action==='budget-edit')return openBudgetForm(id);
      if(action==='funding-edit'){const a=list(workspace.mindPositions).find(a=>a.id===id);if(a)return openAccountForm({mindId:a.profileId,quoteCurrency:a.quoteCurrency});}
      if(action==='connections'){
        if(connectionLoading)return;connectionLoading=true;connectionError='';connectionMessage='';redraw();
        try{const [value,minds]=await Promise.all([request('/api/status'),request(endpoints.minds),loadLiveActivity({force:true})]);if(disposed)return;status=value;setMindCatalog(minds);connectionMessage='연결 설정과 운용 상태를 다시 조회했습니다.';}
        catch(problem){connectionError=problem.message;}
        finally{connectionLoading=false;if(!disposed)redraw();}
        return;
      }
      if(action==='jobs-run'){await mutate('',{maxJobs:1},'/api/workspace/jobs/run');await loadMindSubscriptions({force:true});return hooks.toast?.('처리 가능한 예약 작업을 확인했습니다.');}
      if(action==='deployment')return deploymentDetail(id);
      if(action==='open-deployment-trade'){const d=byId(workspace.deployments,id),group=list(workspace.comparisons).find(g=>list(g.members).some(m=>m.deploymentId===id));hooks.close?.();return hooks.navigate?.('trade',{profileId:d.investmentProfileId,instrumentId:'crypto:okx:BTC-USDT',timeframe:'4h',mode:group?'replay':'live',comparisonId:group?.id||null});}
      if(action==='deployment-new')return hooks.navigate?.('minds',{view:'operations'});
      if(action==='mind-operations'){hooks.close?.();return hooks.navigate?.('minds',{profileId:id,executionMode:'paper',view:'operations'});}
      if(action==='deployment-pause')return await mutate('deployment.status',{deploymentId:id,status:'paused'});
      if(action==='order-review'){const r=byId(workspace.decisionRecords,id);if(migratedLegacyOrder(r))return hooks.open?.('이전 운용 기록','<p>현재 마인드 운용에서 새 결정을 확인하세요.</p>',button('현재 마인드 운용','mind-operations',migratedLegacyOrder(r)));const proposal=list(r?.ruleResults).find(v=>v.id==='order.prepare.paper')?.proposal;return hooks.open?.('모의 주문 검토',row('방향',esc(r?.decision.action))+raw(proposal),button('모의 주문 실행','order-execute',id));}
      if(action==='order-execute'){const r=byId(workspace.decisionRecords,id);if(migratedLegacyOrder(r)){hooks.close?.();return hooks.navigate?.('minds',{profileId:migratedLegacyOrder(r),view:'operations'});}await mutate('',{deploymentId:r.deploymentId,decisionId:id},'/api/workspace/execute');hooks.close?.();return hooks.toast?.('모의 체결을 저장했습니다.');}
      if(action==='document-detail')return documentDetail(id,{paperStarter:node.hasAttribute('data-first-decision-review')&&firstPaperDecision(currentRoute())});
      if(action==='document-graph-edit'){const saved=list(mindData?.documents).find(d=>d.id===id||(d.document||d).id===id);if(!saved)throw new Error('편집할 정책을 다시 조회하세요.');return openPolicyGraphDraft({manifest:saved.document||saved});}
      if(action==='document-edit-copy'){const saved=list(mindData?.documents).find(d=>d.id===id);if(!saved)throw new Error('복사할 자료를 다시 조회하세요.');return openDocumentCopy(saved.document||saved);}
      if(action==='weight-propose')return await proposeWeight(id);
      if(action==='weight-approve')return form('가중치 변경 승인','weight-approve',area('근거·적용 범위·변경 이유','reason')+field('사용 가능 시각 · UTC','availableAt',new Date(Date.now()+3600000).toISOString().slice(0,16),'datetime-local'),id,'새 정책 버전 승인');
      if(action==='document-classify'){if(await mutateInDialog('',{documentId:id},endpoints.mindClassify))return documentDetail(id);return;}
      if(action==='document-publish'||action==='document-publish-live')return openDocumentPublish(id,{live:action==='document-publish-live',paperStarter:node.hasAttribute('data-starter-publish')&&executionModeOf(currentRoute())==='paper'});
      if(action==='instrument-catalog')return openInstrumentCatalog();
      if(action==='stocks-collect')return collectStockSource(node);
      if(action==='universe-skip'){node.closest('[data-universe-picker]').querySelector('[data-universe-selection-count]').focus();return;}
      if(action==='universe-clear'||action==='universe-remove'){const picker=node.closest('[data-universe-picker]');for(const field of picker.querySelectorAll('input[type="checkbox"]'))if(action==='universe-clear'||field.value===id)field.checked=false;updateUniverseSelectionCount(picker);picker.querySelector('[data-universe-values]').dispatchEvent?.(new Event('change',{bubbles:true}));if(action==='universe-remove')picker.querySelector('[data-universe-options-search]').focus();return;}
      if(action==='universe-page')return hooks.navigate?.('minds',{view:'operations',universePage:id});
      if(action==='sector-collect')return collectSectorSource(node);
      if(action==='sector-status')return loadCaptureStatus();
      if(action==='universe-edit')return openUniverseEditor(id||mindContext().id);
      if(action==='upbit-collect')return collectUpbitSource(node);
      if(action==='universe-collect'){const formNode=node.closest('form'),state=formNode?universeEditorState(formNode):null,mindId=state?.mindId||mindContext().id,dialogToken=hooks.getDialogToken?.();await collectUpbitCatalog();if(dialogIsCurrent(dialogToken))await openUniverseEditor(mindId,state?.draft,state?.searches);return hooks.toast?.('업비트 거래쌍 목록을 저장했습니다.');}
      if(action==='sector-import'){const editor=node.closest('[data-studio-form="universe-policy"]');universeImportReturn=editor?universeEditorState(editor):null;return form('공용 섹터 자료 가져오기','sector-import','<div class="full">'+row('저장 대상','공용 섹터 자료')+row('적용 시점','마인드 정책 발행 후')+'</div><label class="field full">'+helpLabel('토스 섹터 자료 · JSON','토스증권 응답과 수집 시각, 구성 종목을 담은 전체 자료를 입력하세요. 저장한 자료는 투자 범위 편집에서 선택할 수 있습니다.')+'<textarea name="source" aria-label="토스 섹터 자료 JSON" required spellcheck="false"></textarea></label><div class="full tiny">'+helpLabel('요청 크기 200KB 이하','자료 본문과 요청 항목을 합산합니다. 저장 오류가 발생하면 입력을 유지하며, 오류 항목을 수정해 다시 저장할 수 있습니다.')+'</div>',universeImportReturn?.mindId||(currentRoute().page==='minds'?mindContext().id:''),'자료 저장');}
      if(action==='universe'){
        const value=await request('/api/workspace/terminal/universe?'+new URLSearchParams({mindId:id})),plan=savedMind(id)?.manifest?.data.strategyPlan,active=plan?.status==='APPROVED'&&plan.approval?.enabled,fixed=active&&plan.scope.instrumentPolicy!=='UNIVERSE_CURRENT',dynamic=active&&!fixed;
        const scope=fixed?getInstrument(plan.scope.instrumentId).symbol+' · '+(({'1h':'1시간봉','4h':'4시간봉','1d':'일봉'})[plan.scope.timeframe]||plan.scope.timeframe)+' 고정 전략':dynamic?'투자 범위의 종목별 전략 실행':'선택 거래소·통화의 허용 종목을 비교합니다. 업비트는 최신 24시간 거래대금으로 후보 12개를 추립니다.',cohorts=[...new Map(list(value.candidates).map(c=>{const i=c.instrument||c;return [i.venue+'|'+i.quoteCurrency,[i.venue+'|'+i.quoteCurrency,i.venue.toUpperCase()+' · '+i.quoteCurrency]];})).values()],cohortControl=active?'':select('비교할 거래소·통화','selectionCohort',cohorts,cohorts[0]?.[0]);
        return hooks.open?.('종목 선정','<p class="tiny muted">'+esc(profileName(id))+' · '+esc(scope)+'</p>'+cohortControl+table(['종목','공급처','상태','기준 시점',...(dynamic?['']:[])],list(value.candidates).map(c=>{const instrument=c.instrument||c,instrumentId=instrument.id||c.instrumentId;return [esc(instrument.symbol||instrumentId),esc(instrument.venue||c.source?.provider||'—'),fixed?instrumentId===plan.scope.instrumentId?'고정 전략 종목':'고정 전략 범위 제외':dynamic?'운용 종목':esc(({READY:'준비됨',CONNECT_REQUIRED:'시세 연결 필요'})[c.status]||'허용 후보'),esc(when(c.asOf||c.quote?.asOf)),...(dynamic?[button('트레이딩 열기','selected-instrument',instrumentId,'data-studio-profile-id="'+esc(id)+'"')]:[])];}))+raw(value,'후보·제외 조건 원본'),button('JEV 종목 선정 실행','universe-select',id,busy||active?'disabled':'')+(fixed?button(getInstrument(plan.scope.instrumentId).symbol+' 트레이딩 열기','selected-instrument',plan.scope.instrumentId,'data-studio-profile-id="'+esc(id)+'"') :''));
      }
      if(action==='universe-select'){const plan=savedMind(id)?.manifest?.data.strategyPlan;if(plan?.status==='APPROVED'&&plan.approval?.enabled)return hooks.toast?.(plan.scope.instrumentPolicy==='UNIVERSE_CURRENT'?'운용할 종목을 선택하고 트레이딩에서 전략을 실행하세요.':getInstrument(plan.scope.instrumentId).symbol+' 고정 전략을 트레이딩에서 실행하세요.');const cohort=node.closest('dialog')?.querySelector('[name="selectionCohort"]')?.value?.split('|'),value=await mutateInDialog('',{mindId:id,...(cohort?{venue:cohort[0],quoteCurrency:cohort[1]}:{})},'/api/workspace/terminal/select');if(!value)return;const selection=value.selection||value.result||value;return hooks.open?.('JEV 종목 선정 결과',selectionResultMarkup(selection,{profileName:profileName(selection.profileId||id)}),selection.selectedInstrumentId?button('선택 종목 열기','selected-instrument',selection.selectedInstrumentId,'data-studio-profile-id="'+esc(selection.profileId||id)+'"'):'');}
      if(action==='selected-instrument'){hooks.close?.();const instrument=getInstrument(id);return hooks.navigate?.('trade',{profileId:node.dataset.studioProfileId||currentRoute().params.get('profileId'),instrumentId:id,timeframe:instrument.defaultTimeframe,comparisonId:null,mode:'live'});}
    }catch(problem){commandError=problem;const errorNode=node.closest('form')?.querySelector('[data-studio-form-error]');if(errorNode){if(action==='validate-document')revealDialogError(errorNode,problem.message);else errorNode.textContent=problem.message;}else if(!backgroundDialogActions.has(action)||!node.closest('dialog')?.open||!node.closest('dialog')?.querySelector('[data-studio-command-status]'))hooks.toast?.(problem.message);}finally{finish(commandError);}
  }
  function deploymentDetail(id){const d=byId(workspace.deployments,id),group=list(workspace.comparisons).find(g=>list(g.members).some(m=>m.deploymentId===id));hooks.open?.('이전 운용 기록',row('운용',esc(d.name))+row('마인드',esc(profileName(d.investmentProfileId)))+row('적용 기억',esc(d.memoryVersionId))+row('실행 유형',esc(d.experimentType==='FORWARD_PAPER'?'이전 모의 운용':'과거 실험'))+row('기록 기준',esc(when(d.updatedAt)))+`<div class="actions spaced">${button('트레이딩에서 기록 보기','open-deployment-trade',id)}${button('현재 마인드 운용','mind-operations',d.investmentProfileId)}</div>${raw({...d,comparisonId:group?.id})}`);}
  function weightComparisonMarkup(a){const c=a.comparison;if(c?.mode!=='AUTO_COHORT_WINDOW_V2')return '';return '<section class="spaced"><h3>선택한 평가 묶음</h3>'+row('평가 정책',esc(cohortPolicyLabel(c.policyVersion)))+row('기간 적격',c.comparablePolicy===true?'사전 승인 범위 충족':'적격 근거 확인 필요')+row('허용 실제 길이',esc(duration(c.minActualDurationMs))+' ~ '+esc(duration(c.maxActualDurationMs)))+row('관측한 실제 길이',esc(list(c.actualDurationsMs).map(duration).join(' · ')||'완료 관측 없음'))+(list(a.excluded).length?'<h4 class="spaced">가중치 적용 보류 근거</h4>'+table(['근거','사유'],a.excluded.map(e=>{const entry=list(mindData?.documents).find(d=>d.id===e.evidenceId);return [entry?button((entry.document||entry).title,'document-detail',e.evidenceId):esc(e.evidenceId),esc(learningReasons[e.reason]||'제외 원본 확인')];})):'' )+raw(c,'선택한 평가 묶음·정책 식별값')+'</section>';}
  function documentBody(doc){const data=doc.data;if(doc.kind==='weight-proposal'){const a=data.assessment||{},summary=a.summary||{};return '<section class="spaced">'+row('검토 상태',esc(({REVIEW_REQUIRED:'가중치 변경 검토',INSUFFICIENT_EVIDENCE:'독립 표본 추가 필요',CORE_FIXED:'핵심 원칙 고정'})[data.status]||'검토 대기'))+row('현재 → 제안 가중치',num(data.previousWeight,3)+' → '+num(data.proposedWeight,3))+(a.comparison?.mode==='AUTO_COHORT_WINDOW_V2'?row('관측 사실',num(a.observedEvidenceCount,0)+'건')+row('비교 적격 근거',num(a.includedEvidenceCount,0)+'건')+row('독립 승인 기회',num(a.independenceApprovedGroupCount,0)+' / 최소 '+num(a.minimumIndependentSamples,0)):row('독립 표본',num(a.independentSampleCount,0)+' / 최소 '+num(a.minimumIndependentSamples,0)))+row('독립 통제 실험',num(summary.controlledSamples,0)+' / 최소 '+num(a.minimumIndependentSamples,0))+row('평균 순수익률',pct(summary.meanNetReturn))+row('평균 동기간 대조',pct(summary.meanBenchmarkReturn))+row('평균 기준 대비',percentagePoints(summary.meanExcessReturn))+row('최대 낙폭',pct(summary.maxDrawdown))+weightComparisonMarkup(a)+'</section>';}
  
    if(doc.kind==='market-context')return '<p class="studio-detail-intro spaced">'+esc(data.summary)+'</p>'+table(['관측값','값','단위','기준 시각','공개 시각'],list(data.observations).map(o=>[esc(o.name),esc(o.value),esc(o.unit),esc(when(o.asOf)),esc(when(o.availableAt))]));
    if(doc.kind==='trade-review'||doc.kind==='principle-evidence')return automaticEvaluationMarkup(doc)+'<section class="spaced">'+row('관측 기간',esc(when(data.period?.start))+' → '+esc(when(data.period?.end)))+row('실제 관측 길이',esc(duration(Date.parse(data.period?.end)-Date.parse(data.period?.start))))+row('순수익률',pct(data.metrics?.netReturn))+row('동기간 보유 대조',pct(data.metrics?.benchmarkReturn))+row('기준 대비',Number.isFinite(data.metrics?.netReturn)&&Number.isFinite(data.metrics?.benchmarkReturn)?percentagePoints(data.metrics.netReturn-data.metrics.benchmarkReturn):'—')+row('최대 낙폭',pct(data.metrics?.maxDrawdown))+(data.thesis?'<h3 class="spaced">투자 논제</h3><p>'+esc(data.thesis)+'</p>':'')+(data.counterevidence?'<h3 class="spaced">반대 근거</h3><p>'+esc(data.counterevidence)+'</p>':'')+(data.lessons?'<h3 class="spaced">관측에서 배운 점</h3><p>'+esc(data.lessons)+'</p>':'')+'</section>';
    if(doc.kind==='mind-policy')return '<p class="studio-detail-intro spaced">'+esc(data.profileSettings?.philosophy)+'</p>'+row('정책 버전','v'+data.version)+table(['원칙','가중치'],list(data.principles).map(p=>[esc(p.title),num(p.weight,3)]))+universePolicySummary(data.universe)+row('최대 투자 비중',pct(data.riskPreset?.maxExposure))+row('일 손실 한도',pct(data.riskPreset?.dailyLossLimit))+strategyPlanMarkup(data.strategyPlan,data.universe,{collapseInventory:true})+policyKnowledgeMarkup(data);return '';}
  function policyKnowledgeMarkup(data){
    const k=data.externalKnowledge||disabledExternalKnowledge(),active=k.enabled&&k.mode==='pinned',pins=k.documentPins.length?table(['고정 자료','버전','원본 식별값',''],k.documentPins.map(pin=>[esc(knowledgeItems.get(pin.id)?.title||'자료 제목 조회 필요')+'<details><summary>자료 ID</summary><div class="code">'+esc(pin.id)+'</div></details>','v'+pin.version,'<details><summary><code title="'+esc(pin.contentHash)+'">'+esc(pin.contentHash.slice(0,12))+'…</code></summary><div class="code">'+esc(pin.contentHash)+'</div></details>','<button type="button" class="button small" data-library-action="detail" data-library-id="'+esc(pin.id)+'">원문 열기</button>']), '고정한 자료 버전이 없습니다.'):'';
    return '<section class="spaced"><h3>공용 투자 자료 연결</h3>'+knowledgeConnectionRows(k)+(pins?(active?'<h4 class="spaced">현재 고정 설정</h4>'+pins:'<details class="spaced"><summary>보관한 고정 설정 · '+k.documentPins.length+'개</summary>'+pins+'</details>'):'')+'</section>';
  }
  async function documentDetail(id,{paperStarter=false}={}){const dialogToken=openRecordLoading('표준 자료 검토');try{let saved=list(mindData?.documents).find(d=>d.id===id||(d.document||d).id===id);if(!saved){const value=await request(endpoints.minds);if(disposed||!dialogIsCurrent(dialogToken))return;mindData=value;saved=list(mindData?.documents).find(d=>d.id===id||(d.document||d).id===id);}if(!saved)throw new Error('자료를 찾을 수 없습니다. 삭제되었거나 아직 불러오지 못한 자료입니다.');const doc=structuredClone(saved.document||saved),review=mindDocumentReviewView(saved),currentPolicy=savedMind(doc.scope?.profileId)?.manifest,stalePolicy=saved.status==='DRAFT'&&doc.kind==='mind-policy'&&Number.isFinite(currentPolicy?.data?.version)&&doc.data.version<=currentPolicy.data.version;if(doc.kind==='mind-policy')await Promise.all(list(doc.data.externalKnowledge?.documentPins).filter(pin=>!knowledgeItems.has(pin.id)).map(async pin=>{try{const value=await request('/api/workspace/market-knowledge/item?'+new URLSearchParams({id:pin.id}));knowledgeItems.set(pin.id,value.item);}catch{knowledgeItems.set(pin.id,{id:pin.id,title:'자료 제목 조회 실패'});}}));if(disposed||!dialogIsCurrent(dialogToken))return;
    const guidedDraft=paperStarter&&firstPaperDecision(currentRoute())&&saved.status==='DRAFT'&&firstDecisionPlan(doc.data.strategyPlan);
    const draftNotice=guidedDraft?'<p class="spaced">전략 초안을 저장했습니다. 투자 범위와 판단 주기를 확인하고 발행을 이어가세요.</p>':'';
    hooks.open?.(guidedDraft?'저장된 전략 초안':doc.kind==='mind-policy'?'전략 정책 검토':'표준 자료 검토',`<h3>${esc(doc.title)}</h3>${draftNotice}${documentImpactRows(doc,currentPolicy,{effect:guidedDraft?firstPaperPublishEffect:undefined})}${savedPolicyContext(saved,currentPolicy)}${row('양식',esc(formNames[doc.kind]||doc.kind))}${row('검토 상태',esc(review.status))}${stalePolicy?row('발행 조건','현재 정책 v'+esc(currentPolicy.data.version)+' 이후의 새 버전으로 작성하세요.'):''}${row('JEV 분류',esc(review.classification))}${row('출처 검토',esc(review.sourceValidation))}${review.approvedAt?row('승인 시각',esc(when(review.approvedAt))):''}${review.reason?row('검토 사유',esc(review.reason)):''}${row('마인드',esc(profileName(doc.scope?.profileId)))}${row('기준 시점',esc(when(doc.asOf)))}${row('사용 가능 시점',esc(when(doc.availableAt)))}${row('출처',esc(doc.source?.type+' · '+doc.source?.id))}${documentBody(doc)}${doc.provenance?.classification?raw(doc.provenance.classification,'실제 JEV 자료 분류'):''}${raw(doc,'양식 원본')}`,(doc.kind==='mind-policy'?button('노드로 편집','document-graph-edit',id,busy?'disabled':''):'')+renderActionMenu({id:'document-actions-'+id,label:'자료 작업',content:button('내보내기','document-export',id)+button('편집본 작성','document-edit-copy',id,busy?'disabled':'')+button('JEV 자료 분류','document-classify',id,busy||saved.status!=='DRAFT'?'disabled':'')+(doc.kind==='mind-policy'&&executionModeOf(currentRoute())==='live'&&isEventAutomationMind(doc)?button('발행 후 실전 설정','document-publish-live',id,busy||saved.status!=='DRAFT'||stalePolicy?'disabled':''):'')})+(doc.kind==='weight-proposal'?button('가중치 변경 승인','weight-approve',id,busy||doc.data.status!=='REVIEW_REQUIRED'||(doc.data.assessment?.summary?.controlledSamples??0)<(doc.data.assessment?.minimumIndependentSamples??3)?'disabled':''):button(guidedDraft?'발행 조건 확인':'검토·발행','document-publish',id,(busy||saved.status!=='DRAFT'||stalePolicy?'disabled ':'')+(paperStarter?'data-starter-publish':''),'primary')));reviewedDocumentExport={id,document:doc,dialogToken:hooks.getDialogToken?.()};}catch(problem){if(!disposed&&dialogIsCurrent(dialogToken))hooks.open?.('표준 자료 검토','<p class="error-text wrap-anywhere" role="alert">'+esc(problem.message)+'</p>',button('다시 조회','document-detail',id));}}
  async function submit(event){
    if(formSaving){event.preventDefault();event.stopImmediatePropagation?.();return;}
    if(event.target.closest?.('[data-event-paper-form]')?.dataset?.eventPaperForm)return eventPaper.submit(event);
    if(event.target.closest?.('[data-auto-form]')?.dataset?.autoForm)return automatedTrading.submit(event);
    if(event.target.closest?.('[data-broker-form]')?.dataset?.brokerForm)return brokers.submit(event);
    if(event.target.matches?.('[data-universe-search]')){event.preventDefault();return hooks.navigate?.('minds',{view:'operations',universeSearch:new FormData(event.target).get('query'),universePage:null});}
    const formNode=event.target.closest?.('[data-studio-form]');if(!formNode)return;event.preventDefault();if(executionModeOf(currentRoute())==='live'&&!SHARED_STUDIO_FORMS.has(formNode.dataset.studioForm)){const message='모의 운용 작업은 모의 보기에서 진행하세요.';const target=formNode.querySelector?.('[data-studio-form-error]');if(target)target.textContent=message;else hooks.toast?.(message);return;}if(busy)return;
    const data=new FormData(formNode),values=Object.fromEntries(data),kind=formNode.dataset.studioForm,id=formNode.dataset.studioId,submit=formNode.querySelector('button[type="submit"]'),previousLabel=submit.textContent,progress=formNode.querySelector('[data-studio-form-status]'),dialogToken=hooks.getDialogToken?.(),controlRoot=formNode.closest?.('dialog')||formNode,controls=[...new Set([submit,...controlRoot.querySelectorAll?.('input,select,textarea,button')||[]])].map(control=>({control,disabled:Boolean(control.disabled)}));formSaving=true;formNode.setAttribute?.('aria-busy','true');for(const {control}of controls)control.disabled=true;submit.disabled=true;submit.textContent=kind==='document-target'?'불러오는 중…':'저장 중…';submit.setAttribute?.('aria-busy','true');if(progress)progress.textContent=kind==='document-target'?'선택한 마인드의 자료를 불러오는 중…':'입력한 내용을 서버에 저장하는 중…';formNode.querySelector('[data-studio-form-error]').textContent='';clearDocumentValidation(formNode);
    try{
      // Target selection only starts a read; release the save lock before waiting so loading can be dismissed.
      if(kind==='document-target'){if(!list(workspace.investmentProfiles).some(p=>p.id===values.mindId))throw new Error('적용할 마인드를 선택하세요.');if(values.operation==='export')return openExport(values.mindId);if(values.operation==='note')return openContextNote(values.mindId);return openDocumentEditor(values.kind,'',values.mindId,values.operation==='template');}
      if(kind==='workspace-reset'){
        if(values.confirmation!=='전체 삭제')throw new Error('확인 문구에 전체 삭제를 입력하세요.');
        await mutate('',{previewHash:values.previewHash,confirmation:'DELETE_ALL_MINDS'},'/api/workspace/reset');
        await refresh({quiet:true});hooks.close?.();hooks.navigate?.('minds',{profileId:'all',view:'overview',executionMode:'paper'});hooks.toast?.('마인드와 투자 기록을 삭제했습니다.');return;
      }
      else if(kind==='profile'){
        const starter=!id&&PAPER_MIND_STARTERS.find(s=>s.id===values.starterId);
        const defaults=starter?starterProfileDefaults(starter):{};
        const payload={...(id?{id}:{}),name:values.name.trim()||defaults.name||'',settings:{
          philosophy:values.philosophy.trim()?values.philosophy:defaults.philosophy||'',
          discipline:values.discipline.trim()?values.discipline:defaults.discipline||'',
          horizon:starter?(starter.timeframe??'4h'):values.horizon,...(id?{}:{style:'custom'}),
          evidencePreferences:(values.evidencePreferences.trim()||defaults.evidencePreferences||'').split(',').map(v=>v.trim()).filter(Boolean),learningPolicy:'user-approved'
        }};
        if(starter){
          const result=await mutate('',{newMind:payload,starterId:starter.id},'/api/workspace/mind-documents/policy-draft');
          clearFormDraft(formNode);
          if(dialogIsCurrent(dialogToken))await documentDetail(result.document.id,{paperStarter:executionModeOf(currentRoute())==='paper'});
          hooks.toast?.('마인드를 만들었습니다. 시작 전략을 검토·발행할 수 있습니다.');
          return;
        }
        await mutate(id?'profile.revise':'profile.create',payload);
      }
      else if(kind==='profile-lifecycle'){const restore=values.operation==='restore';if(!['archive','restore'].includes(values.operation))throw new Error('보관 작업을 다시 선택하세요.');await mutate('profile.'+values.operation,{profileId:id});await refresh({quiet:true});hooks.close?.();hooks.navigate?.('minds',{profileId:'all',view:'overview',mindStatus:restore?null:'archived'});hooks.toast?.(restore?'마인드를 복구했습니다.':'마인드를 보관했습니다.');return;}
      else if(kind==='manifest-profile'){const doc=editMindPolicyDraft(savedMind(id).manifest,values);await mutate('',{document:doc,format:'json'},endpoints.mindImport);}
      else if(kind==='mind-avatar')await mutate('profile.appearance.set',{profileId:id,name:values.name,config:Object.fromEntries(appearanceFields.map(([name])=>[name,values[name]]))});
      else if(kind==='news-create'){await newsComparisons.submit(data,id);return;}
      else if(kind==='universe-policy'){const result=await mutate('',{mindId:id,universeDraft:readUniverseForm(data)},'/api/workspace/mind-documents/policy-draft');clearFormDraft(formNode);await documentDetail(result.document.id);hooks.toast?.('투자 범위 초안을 저장했습니다. 검토·발행 후 적용됩니다.');return;}
      else if(kind==='sector-import'){const snapshot=parseSectorSnapshotImport(values.source,{expectedRevision:workspace?.revision}),returnState=universeImportReturn?.mindId===id?universeImportReturn:null,dialogToken=hooks.getDialogToken?.();await mutate('',{provider:'toss-import',snapshot},'/api/workspace/universe/sources');if(dialogIsCurrent(dialogToken)){if(id&&id!=='all')await openUniverseEditor(id,returnState?.draft,returnState?.searches);else{hooks.close?.();await loadCaptureStatus();}}return;}
      else if(kind==='strategy-plan'){const maximum=Number(values.strategyMaxExposure);if(!Number.isFinite(maximum)||maximum<=0||maximum>1)throw new Error('최대 종목 비중을 0 초과~1 이하로 입력하세요.');const result=await mutate('',{mindId:id,strategyPlanDraft:{preset:'BTC_SPOT_V1',enabled:values.enabled==='true',strategyMaxExposure:maximum}},'/api/workspace/mind-documents/policy-draft');clearFormDraft(formNode);await documentDetail(result.document.id);hooks.toast?.('전략 설정을 정책 초안으로 저장했습니다. 검토·발행 후 적용됩니다.');return;}
      else if(kind==='knowledge-policy'||kind==='knowledge-pin'){const mindId=kind==='knowledge-pin'?values.mindId:id,manifest=savedMind(mindId)?.manifest;
        if(kind==='knowledge-pin'&&!mindId)throw new Error('연결할 마인드를 선택하세요.');if(!manifest)throw new Error('현재 마인드 정책을 다시 조회하세요.');let policy={...(manifest.data.externalKnowledge||disabledExternalKnowledge())};if(kind==='knowledge-pin'){if(!pendingKnowledgePin)throw new Error('라이브러리에서 승인 자료를 다시 선택하세요.');policy=knowledgePinPolicy(manifest,pendingKnowledgePin);}else policy={...policy,enabled:values.enabled==='true',mode:values.mode,sourceTypes:data.getAll('sourceTypes'),levels:data.getAll('levels'),horizons:data.getAll('horizons'),authorIds:values.authorIds.split(',').map(v=>v.trim()).filter(Boolean),maxAgeHours:Number(values.maxAgeHours),maxItems:Number(values.maxItems)};const result=await mutate('',{mindId,externalKnowledge:policy},'/api/workspace/mind-documents/policy-draft');clearFormDraft(formNode);await documentDetail(result.document.id);hooks.toast?.('연결 설정을 정책 초안으로 저장했습니다. 검토·발행할 수 있습니다.');return;}
      else if(kind==='experience-evaluate')await mutate('experience.evaluate',{experienceId:id,summary:values.summary,evaluationVersion:'user-review-v1'});
      else if(kind==='memory-propose'){const e=byId(workspace.experiences,id);await mutate('memory.propose',{investmentProfileId:e.investmentProfileId,experienceIds:data.getAll('experienceIds'),title:values.title,text:values.text,knowledgeType:values.knowledgeType,...(values.investmentRelevance?{investmentRelevance:values.investmentRelevance}:{})});}
      else if(kind==='memory-validate')await mutate('memory.validate',{candidateId:id,...values,methodVersion:'user-reviewed-v1'});
      else if(kind==='memory-approve'||kind==='memory-reject')await mutate(kind==='memory-approve'?'memory.approve':'memory.reject',{candidateId:id,reason:values.reason});
      else if(kind==='memory-apply')await mutate('',{deploymentId:values.deploymentId,sourceMemoryVersionId:values.sourceMemoryVersionId,reason:values.reason},'/api/workspace/memory/apply');
      else if(kind==='document-note'){
        const noteInput={profileId:id,title:values.title,summary:values.summary,sourceUri:values.sourceUri,category:values.category},fingerprint=JSON.stringify(noteInput);
        if(formNode.contextNote?.fingerprint!==fingerprint)formNode.contextNote={fingerprint,document:createMindContextNote(noteInput)};
        const {document}=formNode.contextNote;
        await mutate('',{document,format:'json'},endpoints.mindImport);
        clearFormDraft(formNode);
        await loadMindLibrary({force:true});
        if(dialogIsCurrent(dialogToken)){hooks.close?.();hooks.toast?.('문서를 저장했습니다.');}
        return;
      }
      else if(kind==='document'){const payload=await prepareDocumentImport(formNode,values);if(!payload)return;await mutate('',payload,endpoints.mindImport);}
      else if(kind==='document-publish'){
        const entry=list(mindData?.documents).find(d=>d.id===id),continueLive=values.afterPublish==='live';
        if(continueLive&&!isEventAutomationMind(entry?.document))throw new Error('실전 설정으로 연결할 분봉 정책을 다시 여세요.');
        const result=await mutate('',{documentId:id,reason:values.reason},endpoints.mindApply);
        if(continueLive&&dialogIsCurrent(dialogToken)){
          await enterLiveAutomationSettings(result,dialogToken);return;
        }
        const profileId=result.manifest?.scope.profileId;
        if(values.afterPublish==='paper-starter'&&profileId===entry?.document.scope.profileId&&profileId&&dialogIsCurrent(dialogToken)){
          clearFormDraft(formNode);
          hooks.close?.();
          if(firstPaperDecision(currentRoute())&&firstDecisionPlan(result.manifest.data.strategyPlan)){
            hooks.navigate?.('trade',{profileId,instrumentId:PAPER_DECISION_INSTRUMENT,timeframe:PAPER_DECISION_TIMEFRAME,mode:'live',comparisonId:null,firstDecision:'1',executionMode:'paper'});
            hooks.toast?.('국면 추세를 발행했습니다. 첫 모의 판단을 이어가세요.');
            return;
          }
          hooks.navigate?.('minds',{profileId,view:'principles',executionMode:'paper'});
          hooks.toast?.('시작 전략을 발행했습니다. 실험실에서 백테스트할 수 있습니다.');
          return;
        }
      }
      else if(kind==='weight-propose'){const cohorts=weightCohorts(values.mindId,id);if(!cohorts.some(c=>c.key===values.cohortKey))throw new Error('비교할 평가 묶음을 선택하세요.');const result=await mutate('',{mindId:values.mindId,principleId:id,cohortKey:values.cohortKey},'/api/workspace/minds/weights/propose');return documentDetail(result.document.id);}
      else if(kind==='weight-approve')await mutate('',{documentId:id,reason:values.reason,availableAt:new Date(values.availableAt+'Z').toISOString()},'/api/workspace/minds/weights/approve');
      else if(kind==='paper-capital'){
        const account=list(workspace.mindPositions).find(a=>a.kind==='PAPER_ACCOUNT'&&a.profileId===id&&a.quoteCurrency===values.quoteCurrency),current=account?account.initialCash+list(account.fundingLedger).reduce((sum,f)=>sum+f.amount,0):0,target=Number(values.capitalLimit),delta=Math.round((target-current)*1e8)/1e8;
        if(!Number.isFinite(target)||target<=0)throw Error('운용 금액을 입력하세요.');if(delta)await mutate('',{mindId:id,quoteCurrency:values.quoteCurrency,amount:Math.abs(delta),direction:delta>0?'allocate':'release'},'/api/workspace/accounts/allocate');
      }
      else if(kind==='paper-budget'){
        await mutate('',{quoteCurrency:values.quoteCurrency,totalBudget:Number(values.totalBudget)},'/api/workspace/accounts/budget');
        if(id&&dialogIsCurrent(dialogToken)&&currentRoute().page==='trade'){
          clearFormDraft(formNode);
          const {profileId,instrument}=selectedIdentity();
          if(profileId===id&&instrument.quoteCurrency===values.quoteCurrency)return openAccountForm({mindId:id,quoteCurrency:values.quoteCurrency});
        }
      }
      else if(kind==='mind-account'){if(!list(mindData?.minds).some(m=>m.id===values.mindId))throw new Error('자금을 이동할 마인드를 선택하세요.');if(usesEventPaperFunding(values.mindId)){if(dialogIsCurrent(dialogToken))hooks.close?.();hooks.navigate?.('minds',{profileId:values.mindId,view:'operations',executionMode:'paper'});return;}if(!values.quoteCurrency||!values.direction||!values.amount)return openAccountForm({mindId:values.mindId});await mutate('',{mindId:values.mindId,quoteCurrency:values.quoteCurrency,amount:Number(values.amount),direction:values.direction},'/api/workspace/accounts/allocate');}
      else if(kind==='paper-adaptation-restart'){
        const trial=restartablePaperTrial(id);if(!trial||trial.id!==values.trialId)throw new Error('중단된 비교를 다시 조회한 뒤 시작하세요.');if(values.confirmed!=='true')throw new Error('새 비교를 시작할 조건을 확인하세요.');
        await mutate('',{subscriptionId:id},'/api/workspace/paper-adaptation/restart');await loadMindSubscriptions({force:true,quiet:true});if(dialogIsCurrent(dialogToken))hooks.close?.();hooks.toast?.('새 비교를 다음 확정 봉부터 시작합니다.');return;
      }
      else if(kind==='paper-adaptation'){
        const value=paperAdaptations.get(id),maximum=Number(values.maxWeightStep)/100;
        if(value?.eligibility?.eligible!==true||!byId(subscriptionData?.subscriptions,id))throw new Error('학습할 모의 운용의 고정 전략을 다시 조회하세요.');
        if(!Number.isFinite(maximum)||maximum<=0||maximum>.1)throw new Error('최대 변경 비중을 0 초과~10%p 이하로 입력하세요.');
        const {mixerNodeId,quantNodeId,vibeNodeId}=value.eligibility;
        await mutate('',{subscriptionId:id,enabled:values.enabled==='true',autoApply:values.autoApply==='true',maxWeightStep:maximum,mixerNodeId,quantNodeId,vibeNodeId},'/api/workspace/paper-adaptation/configure');
        await loadMindSubscriptions({force:true,quiet:true});
      }
      else if(kind==='subscription-launch'){
        if(values.optInPaper!=='true')throw Error('자동 모의 운용 동의를 확인하세요.');const window=operationWindowValues(values);
        if(values.totalBudget){const totalBudget=Number(values.totalBudget),amount=Number(values.fundAmount);if(!Number.isFinite(totalBudget)||totalBudget<amount||totalBudget<=0)throw Error('공용 예산을 배정할 자금 이상으로 입력하세요.');await mutate('',{quoteCurrency:'USDT',totalBudget},'/api/workspace/accounts/budget');}
        let accountId=values.accountId||list(subscriptionData?.eligibleAccounts)[0]?.id;
        if(!accountId){const amount=Number(values.fundAmount);if(!Number.isFinite(amount)||amount<=0)throw Error('배정할 모의 자금을 입력하세요.');await mutate('',{mindId:id,quoteCurrency:'USDT',amount,direction:'allocate'},'/api/workspace/accounts/allocate');await loadMindSubscriptions({force:true,quiet:true});accountId=list(subscriptionData?.eligibleAccounts)[0]?.id;}
        if(!accountId)throw Error('저장된 모의 자금 배정을 다시 조회하세요.');
        let subscription=list(subscriptionData?.subscriptions).find(v=>v.profileId===id);
        if(!subscription){const created=await mutate('',{mindId:id,accountId,manifestId:values.manifestId},'/api/workspace/mind-subscriptions/create');subscription=created.result;}
        await mutate('',{subscriptionId:subscription.id,optInPaper:true,autoExecute:true,cohortPolicyHash:values.cohortPolicyHash,...window},'/api/workspace/mind-subscriptions/enable');
      }
      else if(kind==='subscription-create')await mutate('',{mindId:id,accountId:values.accountId,manifestId:values.manifestId},'/api/workspace/mind-subscriptions/create');
      else if(kind==='subscription-enable'){if(values.optInPaper!=='true')throw new Error('자동 모의 실행 동의를 확인하세요.');await mutate('',{subscriptionId:id,optInPaper:true,autoExecute:true,cohortPolicyHash:values.cohortPolicyHash,...operationWindowValues(values)},'/api/workspace/mind-subscriptions/enable');}
      else if(kind==='subscription-version'){if(values.reviewed!=='true')throw new Error('새 정책 버전 검토와 적용 범위를 확인하세요.');await mutate('',{subscriptionId:id,manifestId:values.manifestId},'/api/workspace/mind-subscriptions/apply-version');}
      else if(kind==='subscription-abandon'){if(values.ackUnknown!=='true'||values.ackBudget!=='true')throw new Error('호출 결과 미확정과 예산 소모 유지에 모두 동의하세요.');if(values.reasonText.trim().length<10||values.reasonText.length>2000)throw new Error('확인 내용을 10~2000자로 작성하세요.');if(recoveryData?.recovery?.subscriptionId!==id)throw new Error('대상 자동 운용의 저장 기록을 다시 확인하세요.');return await runSubscriptionRecovery('abandon',{reasonCode:values.reasonCode,reasonText:values.reasonText.trim(),ackUnknown:true,ackBudget:true});}
      clearFormDraft(formNode);if(dialogIsCurrent(dialogToken))hooks.close?.();hooks.toast?.(kind==='profile-rename'?'마인드 이름을 변경했습니다.':'서버에 저장했습니다.');if(kind==='profile-rename'){restoreMindActionFocus(id);return;}await loadTerminal({force:true});if(kind==='manifest-profile'||kind==='mind-avatar')restoreMindActionFocus(kind==='mind-avatar'?'mind-customize':'profile-edit',id);
    }catch(problem){if(formNode.isConnected){const errorNode=formNode.querySelector('[data-studio-form-error]');errorNode.textContent=problem.message;if(kind==='document'&&dialogIsCurrent(dialogToken)&&formNode.closest?.('dialog')?.open!==false){revealDialogError(errorNode,problem.message);}if(kind==='knowledge-pin')queueMicrotask(()=>{if(formNode.isConnected&&dialogIsCurrent(dialogToken)&&typeof document!=='undefined'&&document.activeElement===document.body)submit.focus?.();});}else hooks.toast?.(problem.message);}
    finally{formSaving=false;formNode.removeAttribute?.('aria-busy');for(const {control,disabled}of controls)if(control.isConnected!==false)control.disabled=disabled;if(submit.isConnected){submit.textContent=previousLabel;submit.removeAttribute?.('aria-busy');}if(progress?.isConnected)progress.textContent='';}
  }
  function change(event){if(event.target.name==='starterId'&&event.target.closest?.('[data-studio-form="profile"]'))updateStarterPreview(event.target);if(formSaving){event.preventDefault?.();return;}if(event.target.name==='mindId'&&event.target.closest?.('[data-studio-form="knowledge-pin"]')?.dataset?.studioForm==='knowledge-pin'){const preview=event.target.closest('form').querySelector('[data-knowledge-pin-preview]');if(preview)preview.innerHTML=knowledgePinPreview(event.target.value);return;}if(['quoteCurrency','mindId','direction'].includes(event.target.name)&&event.target.closest?.('[data-studio-form="mind-account"]')?.dataset?.studioForm==='mind-account'){const f=event.target.closest('form');if(event.target.name==='mindId')return openAccountForm({mindId:event.target.value});const currency=f.elements.quoteCurrency.value,budget=paperBudgetSummary(workspace,currency),release=f.elements.direction.value==='release',capacity=release?(budget.accounts.find(a=>a.profileId===f.elements.mindId.value)?.cash??0):budget.available;f.elements.amount.value=String(Math.max(0,Math.min(capacity,currency==='BTC'?0.01:currency==='KRW'?1000000:1000)));const hint=f.querySelector('[data-funding-capacity]');if(hint)hint.innerHTML=row(release?'회수 가능':'배정 가능',money(capacity,currency)+' '+esc(currency));}const picker=event.target.closest?.('[data-universe-picker]');if(picker){updateUniverseSelectionCount(picker,event.target);if(event.target.matches?.('[data-universe-choice]'))picker.querySelector('[data-universe-values]').dispatchEvent(new Event('change',{bubbles:true}));}newsComparisons.change(event.target);const appearanceForm=event.target.closest?.('[data-studio-form="mind-avatar"]');if(appearanceForm&&appearanceFields.some(([name])=>name===event.target.name))return updateMindAppearancePreview(appearanceForm);if(event.target.matches?.('[data-studio-knowledge-filter]'))return hooks.navigate?.(currentRoute().page,{[event.target.dataset.studioKnowledgeFilter]:event.target.value,knowledgePage:null});clearDocumentValidation(event.target.closest?.('[data-studio-form="document"]'));if(event.target.matches?.('[data-studio-profile]')){recordCursors.reset();const changes={profileId:event.target.value,cursor:null,knowledgePage:null,...(isSimulationRoute(currentRoute())?{simulationId:null,tab:'overview'}:{})};if(isMemoryView()){const next=parseStudioRoute(studioRouteHash(currentRoute(),currentRoute().page,changes));mindActionFocus={kind:'memory-profile',scope:next.page+'?'+next.params.toString(),fallback:null};}hooks.navigate?.(currentRoute().page,changes);}if(event.target.matches?.('[data-studio-record-filter]')){recordFieldFocus={filter:event.target.dataset.studioRecordFilter};recordCursors.reset();hooks.navigate?.('minds',{view:'records',[event.target.dataset.studioRecordFilter]:event.target.value,cursor:null});}if(event.target.matches?.('[data-studio-document-file]')){const file=event.target.files?.[0];if(!file)return;const fileError=(message,{focus=true}={})=>{const form=event.target.closest('form');clearDocumentValidation(form);if(!revealDialogError(form?.querySelector('[data-studio-form-error]'),message,{focus}))hooks.toast?.(message);};if(file.size>256000)return fileError('파일 크기를 256KB 이내로 줄여 주세요.');const readingForm=event.target.closest('form'),sourceAtRead=readingForm?.elements.source.value,dialogAtRead=hooks.getDialogToken?.(),ownsRead=()=>readingForm?.isConnected&&event.target.files?.[0]===file&&readingForm.closest?.('dialog')?.open!==false&&(dialogAtRead===undefined||dialogAtRead===hooks.getDialogToken?.());file.text().then(text=>{const formNode=event.target.closest('form');if(ownsRead()){if(formNode.elements.source.value!==sourceAtRead){fileError('파일을 읽는 동안 작성 내용이 바뀌었습니다. 파일을 다시 선택하세요.',{focus:false});return;}replaceFormDraftValues(formNode,{source:text});clearDocumentValidation(formNode);}}).catch(()=>{if(ownsRead())fileError('파일을 읽지 못했습니다.',{focus:false});});}}
  function recordSearchScope(){return currentRoute().page+'?'+new URLSearchParams([...currentRoute().params].filter(([key])=>!['search','cursor'].includes(key))).toString();}
  function recordSearchValue(){const query=currentRoute().params.get('search')||'';return searchDraft?.scope===recordSearchScope()&&searchDraft.base===query?search:query;}
  function input(event){if(event.target.matches?.('[data-capability-search]')){updateCapabilitySearch(event.target);return;}if(formSaving){event.preventDefault?.();return;}if(event.target.matches?.('[data-catalog-query]'))return;if(event.target.matches?.('[data-universe-options-search]')){filterUniverseOptions(event.target.closest('[data-universe-picker]'));return;}clearDocumentValidation(event.target.closest?.('[data-studio-form="document"]'));if(event.target.matches?.('[data-studio-search]')){search=event.target.value;recordFieldFocus={start:event.target.selectionStart,end:event.target.selectionEnd};recordCursors.reset();clearTimeout(searchTimer);const draft={scope:recordSearchScope(),base:currentRoute().params.get('search')||''};searchDraft=draft;if(event.isComposing)return;searchTimer=setTimeout(()=>{if(isRecordsRoute(currentRoute())&&draft===searchDraft&&draft.scope===recordSearchScope()&&draft.base===(currentRoute().params.get('search')||''))hooks.navigate?.('minds',{view:'records',search:search.trim()||null,cursor:null});},250);}}
  const mindGameRuntime=createMindLifeRuntime(),mindHudRuntime=createMindHudRuntime();
  function mount(container){root=container;const catalog=container.querySelector('[data-capability-catalog]'),focus=capabilityFocus;capabilityFocus=null;if(catalog){filterCapabilityCatalog(catalog,capabilityQuery,capabilityOpenGroups);if(focus){const field=focus.refresh?container.querySelector('[data-studio-action="refresh"]'):catalog.querySelector('[data-capability-search]');field?.focus({preventScroll:true});if(!focus.refresh)field?.setSelectionRange?.(focus.start,focus.end);}}mindGameRuntime.mount(container.ownerDocument??container);mindHudRuntime.mount(container);if(automationFocus&&currentRoute().page==='minds'&&currentRoute().params.get('profileId')===automationFocus&&executionModeOf(currentRoute())==='paper'){const section=container.querySelector('[data-mind-subscriptions]');if(section){automationFocus=null;section.closest?.('details')?.setAttribute?.('open','');section.scrollIntoView?.({block:'start'});(section.querySelector('[data-studio-action="subscription-pause"]:not(:disabled),[data-studio-action="subscription-account"]:not(:disabled)')||section.querySelector('button:not(:disabled)')||section).focus?.({preventScroll:true});}}if(executionModeFocus&&executionModeOf(currentRoute())===executionModeFocus&&!document.querySelector?.('dialog[open]')){container.querySelector('[data-companion-mode="'+executionModeFocus+'"]')?.focus();executionModeFocus=null;}if(currentRoute().page==='home')home.mount(container);if(currentRoute().page==='trade')terminal.mount(container);library.mount(container);if(isSimulationRoute(currentRoute()))simulations.mount(container);if(isRecordsRoute(currentRoute())&&recordFieldFocus){const next=container.querySelector(recordFieldFocus.filter?'[data-studio-record-filter="'+recordFieldFocus.filter+'"]':'[data-studio-search]'),position=recordFieldFocus;recordFieldFocus=null;next?.focus();next?.setSelectionRange?.(position.start,position.end);}restorePendingMindActionFocus(container);}
  function unmount(){if(typeof document!=='undefined'&&document.activeElement?.matches?.('[data-mind-library-list]')&&!mindActionFocus)mindActionFocus={kind:'mind-library-page',scope:mindFocusScope(),fallback:null};if(typeof document!=='undefined'&&document.activeElement?.matches?.('[data-knowledge-document-list]')&&!mindActionFocus)mindActionFocus={kind:'knowledge-page',scope:mindFocusScope(),fallback:null};for(const group of root?.querySelectorAll?.('[data-mind-disclosure]')??[])if(group.isConnected)mindDisclosureOpenGroups[group.dataset.mindDisclosure]=group.open;for(const group of root?.querySelectorAll?.('[data-mind-history]')??[])if(group.isConnected)companionHistoryOpenGroups[group.dataset.mindHistory]=group.open;mindHudRuntime.unmount();mindGameRuntime.unmount();home.unmount();terminal.destroy();simulations.unmount();root=null;}
  function recoveryDialogKeydown(event){
    if(event.key!=='Tab'||event.defaultPrevented)return;const dialog=event.target.closest?.('#detail-dialog');if(!dialog?.open||!dialog.querySelector?.('[data-recovery-scroll]'))return;
    const nodes=[...dialog.querySelectorAll('button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),summary,[tabindex]:not([tabindex="-1"])')].filter(node=>!node.disabled&&!node.hidden&&node.tabIndex>=0&&node.getClientRects().length);
    if(!nodes.length)return;const first=nodes[0],last=nodes.at(-1);if(event.shiftKey&&event.target===first){event.preventDefault();last.focus();}else if(!event.shiftKey&&event.target===last){event.preventDefault();first.focus();}
  }
  function recoveryDialogClose(event){if(event.target.matches?.('#detail-dialog')){catalogPickerCleanup?.();catalogPickerCleanup=null;recoveryGeneration++;recoveryData=null;const restore=universeImportReturn,importer=event.target.querySelector?.('[data-studio-form="sector-import"]');if(restore&&importer?.dataset.studioId===restore.mindId&&restore.routeKey===studioRouteHash(currentRoute(),currentRoute().page)){universeImportReturn=null;return openUniverseEditor(restore.mindId,restore.draft,restore.searches).catch(problem=>hooks.toast?.(problem.message));}universeImportReturn=null;}}
  async function routeChanged(value){catalogPickerCleanup?.();catalogPickerCleanup=null;if(automationFocus&&(value.page!=='minds'||value.params.get('view')!=='operations'||value.params.get('profileId')!==automationFocus||executionModeOf(value)!=='paper'))automationFocus=null;if(automationIntent&&(value.page!=='minds'||value.params.get('view')!=='operations'||value.params.get('profileId')!==automationIntent.mindId||executionModeOf(value)!=='paper'))automationIntent=null;recoveryGeneration++;recoveryData=null;universeImportReturn=null;route=value;await Promise.all([calendar.load(),home.load(),loadLiveActivity(),loadEventPaperBatch()]);if(subscriptionMindId!==mindSubscriptionScope(value))clearMindSubscriptions();if(value.page==='trade')await Promise.all([loadTerminal(),terminalUniverse.load()]);if(isRecordsRoute(value))await loadRecords();else{lastRecordsKey='';clearTimeout(searchTimer);recordFieldFocus=null;searchDraft=null;}await library.load();await quantLibrary.load();await loadMindLibrary();await loadKnowledgePinTitles();await loadCapabilities();await loadCaptureStatus();await brokers.load();await Promise.all([automatedTrading.load(),eventPaper.load(),loadLiveActivity(),loadPaperActivity()]);await completeLiveAutomationEntry();await loadMindSubscriptions();await loadCompanionValuations();completeAutomationEntry();await loadMemoryView();await simulations.routeChanged();}
  async function start(){if(started)return;started=true;loading=true;library.start();quantLibrary.start();simulations.start();if(typeof document!=='undefined'){activityPreviews=installMindActivityPreviews(document);document.addEventListener('click',click);document.addEventListener('submit',submit);document.addEventListener('change',change);document.addEventListener('input',input);document.addEventListener('compositionend',input);document.addEventListener('toggle',capabilityToggle,true);document.addEventListener('close',recoveryDialogClose,true);document.addEventListener('keydown',recoveryDialogKeydown);document.addEventListener('focusin',mindActionFocusChanged);}const results=await Promise.allSettled([readCore('/api/workspace?view=studio'),readCore('/api/status'),readCore(endpoints.minds)]);if(results[0].status==='fulfilled'){workspace=results[0].value.workspace;marketInfo=results[0].value.market;}else error=results[0].reason.message;if(results[1].status==='fulfilled')status=results[1].value;if(results[2].status==='fulfilled')setMindCatalog(results[2].value);else error=results[2].reason.message;loading=false;redraw();if(workspace){await Promise.all([calendar.load(),home.load(),loadLiveActivity(),loadEventPaperBatch()]);await Promise.all([loadTerminal(),currentRoute().page==='trade'?terminalUniverse.load():Promise.resolve()]);await loadRecords();await library.load();await quantLibrary.load();await loadMindLibrary();await loadKnowledgePinTitles();await loadCapabilities();await loadCaptureStatus();await brokers.load();await Promise.all([automatedTrading.load(),eventPaper.load(),loadLiveActivity(),loadPaperActivity()]);await completeLiveAutomationEntry();await loadMindSubscriptions();await loadCompanionValuations();await loadMemoryView();await simulations.load();}poll=setInterval(()=>{if(!busy&&typeof document!=='undefined'&&document.visibilityState==='visible'){const route=currentRoute(),liveOperation=route.page==='minds'&&executionModeOf(route)==='live'&&['overview','operations'].includes(route.params.get('view'))&&route.params.get('profileId')&&route.params.get('profileId')!=='all';return (liveOperation?loadLiveActivity({force:true}):refresh({quiet:true})).catch(()=>{});}},30000);poll.unref?.();companionValuationPoll=setInterval(()=>{if(!disposed&&!busy&&typeof document!=='undefined'&&document.visibilityState==='visible'&&eventPaper.handles())return eventPaper.load({maxAgeMs:5000}).catch(()=>{});if(!disposed&&!busy&&typeof document!=='undefined'&&document.visibilityState==='visible'&&eventPaperBatchView())return Promise.allSettled([loadEventPaperBatch({maxAgeMs:5000}),companionValuationView()?loadCompanionValuations({maxAgeMs:20000}):Promise.resolve()]);if(!disposed&&!busy&&typeof document!=='undefined'&&document.visibilityState==='visible'&&liveActivityView())return loadLiveActivity({maxAgeMs:5000}).catch(()=>{});if(!disposed&&!busy&&typeof document!=='undefined'&&document.visibilityState==='visible'&&companionValuationView())return loadCompanionValuations({maxAgeMs:20000}).catch(()=>{});},5000);companionValuationPoll.unref?.();}
  function destroy(){disposed=true;calendar.destroy();mindHudRuntime.destroy();mindGameRuntime.destroy();eventPaperBatch.destroy();paperActivity.destroy();liveActivity.destroy();activityPreviews?.destroy();liveAutomationIntent=null;coreReadGeneration++;automatedTrading.destroy();eventPaper.destroy();terminalUniverse.dispose();catalogPickerCleanup?.();catalogPickerCleanup=null;automationIntent=null;automationFocus=null;clearInterval(poll);clearInterval(companionValuationPoll);clearTimeout(searchTimer);terminalAbort?.abort();recordsAbort?.abort();mindLibraryAbort?.abort();mindLibraryGeneration++;subscriptionAbort?.abort();valuationAbort?.abort();companionValuationGeneration++;companionValuationAbort?.abort();memoryAbort?.abort();valuationGeneration++;memoryGeneration++;terminalGeneration++;recordsGeneration++;captureGeneration++;subscriptionGeneration++;recoveryGeneration++;home.destroy();library.destroy();quantLibrary.destroy();simulations.destroy();unmount();if(typeof document!=='undefined'){document.removeEventListener('click',click);document.removeEventListener('submit',submit);document.removeEventListener('change',change);document.removeEventListener('input',input);document.removeEventListener('compositionend',input);document.removeEventListener('toggle',capabilityToggle,true);document.removeEventListener('close',recoveryDialogClose,true);document.removeEventListener('keydown',recoveryDialogKeydown);document.removeEventListener('focusin',mindActionFocusChanged);mindActionFocus=null;}}
  return {render,navigation,mount,unmount,start,destroy,refresh,routeChanged,openDecision,openDocument:documentDetail,openResearch:library.detail,openStrategyDraft,request,state:()=>({workspace,status,loading,busy,formSaving,error,terminalData,terminalError,terminalLoading,terminalFailure,recordsData,recordsError,recordsLoading,mindLibraryData,mindLibraryLoading,mindLibraryError,captureData,captureLoading,captureCollecting,captureStatusError,captureActionError,subscriptionData,subscriptionLoading,subscriptionError,valuationData,valuationLoading,valuationError,memoryData,memoryLoading,memoryError}),terminal,library,quantLibrary,simulations,home};
}

