import {isRegimeProgramGraph} from '../domain/regime-program-graph.mjs';
import {renderHourlyLearning} from './hourly-model-learning.mjs';
import {hourlyLearningRequest} from '../system/hourly-learning-contracts.mjs';
import {renderDataTable} from './data-table.mjs';
import {submitFunding} from './paper-funding-request.mjs';
import {operationWindowFields,operationWindowValues,operationWindowSummary} from './operation-window.mjs';
import {callAutomation} from '../system/automation-contracts.mjs';
import {brokerageReportExportPath} from './brokerage-report.mjs';
import {JEV_EXECUTION_CALL_LIMIT} from '../domain/jev-question.mjs';
import {graphRequiresJev,strategyGraphHash} from '../domain/strategy-graph.mjs';
import {eventGraph} from './simulation-asset-scope.mjs';
import {tradeFillSummary,tradePrice} from './trade-fill-summary.mjs';
import {currencyAmount} from './currency-format.mjs';
import {helpTooltip,helpLabel} from './help-tooltip.mjs';
import {renderOperationControls} from './operation-controls.mjs';
import {renderMindActivityHero,renderMindActivityFeed,marketScopeMarkup} from './mind-activity.mjs';

const list=value=>Array.isArray(value)?value:[];
export async function saveLiveStrategyUpdate(request,body,{isCurrent=()=>true,onProgress=()=>{}}={}){
 const id='strategy-update-'+body.idempotencyKey,targetHash=strategyGraphHash(body.graph);
 const read=async()=>{const {policy}=await callAutomation(request,'automation.trading.strategy.read',{activationId:body.activationId});if(policy?.id!==body.activationId)throw Error('변경 대상 운용을 다시 확인하세요.');return policy;};
 const update=policy=>[policy.pendingStrategyUpdate,policy.lastStrategyUpdate].find(value=>value?.id===id);
 let policy=await read();if(!isCurrent())return null;
 if(!update(policy)){
  onProgress('저장 및 발행 중…');
  try{await callAutomation(request,'automation.trading.strategy.update',body);}catch(problem){policy=await read().catch(()=>null);if(!policy||!update(policy))throw problem;}
 }
 const deadline=Date.now()+120000;
 while(isCurrent()){
  try{policy=await read();}catch(problem){if(problem.serverResponse||Date.now()>=deadline)throw problem;onProgress('연결 복구 및 반영 확인 중…');await new Promise(resolve=>setTimeout(resolve,1000));continue;}
  const current=update(policy);
  if(current&&(current.config.graphHash!==targetHash||current.config.maxJevCallsPerDay!==body.maxJevCallsPerDay||body.perOrderLimit!==undefined&&Number(current.config.perOrderLimit)!==Number(body.perOrderLimit)))throw Error('승인한 내용과 변경 요청 기록을 다시 확인하세요.');
  if(current?.status==='APPLIED'){
   if(policy.config.graphHash!==targetHash||body.perOrderLimit!==undefined&&Number(policy.config.perOrderLimit)!==Number(body.perOrderLimit))throw Error('운용 전략이나 주문 한도가 다시 변경됐습니다. 현재 설정을 확인하세요.');
   return policy;
  }
  if(policy.status!=='ENABLED')throw Error('전략 변경 요청은 저장됐습니다. 현재 운용 상태: '+policy.status);
  if(!current)throw Error('변경 요청 기록을 확인해 주세요.');
  if(Date.now()>=deadline)throw Error('변경 요청은 저장됐습니다. 미확정 주문 대사와 실행기 반영을 기다리고 있습니다. 같은 내용으로 다시 누르면 이 요청을 이어서 확인합니다.');
  onProgress('실행기 반영 확인 중…');await new Promise(resolve=>setTimeout(resolve,500));
 }
 return null;
}
const numericValue=value=>value!==null&&value!==undefined&&Number.isFinite(Number(value));
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const amount=(value,currency)=>value!==null&&value!==undefined&&value!==''&&Number.isFinite(Number(value))?currencyAmount(Number(value),currency)+' '+esc(currency):'—';
const quantity=value=>value!==null&&value!==undefined&&value!==''&&Number.isFinite(Number(value))?new Intl.NumberFormat('ko-KR',{maximumSignificantDigits:15}).format(Number(value)):'—';
const time=value=>value&&Number.isFinite(Date.parse(value))?new Date(value).toLocaleString('ko-KR',{timeZone:'Asia/Seoul',hour12:false})+' KST':'—';
const reportDay=new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',year:'numeric',month:'long',day:'numeric'});
const reportClock=new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
function reportList(items){
 const groups=[];
 for(const report of items){
  const date=report.generatedAt&&Number.isFinite(Date.parse(report.generatedAt))?new Date(report.generatedAt):null;
  const day=date?reportDay.format(date):'생성 시각 미기록';
  if(groups.at(-1)?.day!==day)groups.push({day,rows:[]});
  groups.at(-1).rows.push('<li><a href="'+esc(brokerageReportExportPath(report.id))+'" target="_blank" rel="noopener"><span>'+(date?'<time datetime="'+esc(report.generatedAt)+'" title="'+esc(time(report.generatedAt))+'" aria-label="'+esc(time(report.generatedAt))+'">'+esc(reportClock.format(date))+' KST</time>':'')+'<strong>'+esc(report.summary.headline)+'</strong></span><span aria-hidden="true">↗</span></a></li>');
 }
 return '<p class="tiny muted">생성일 기준 · KST · 보고서는 새 탭에서 열립니다.</p>'+groups.map((group,index)=>'<section class="operation-report-group" aria-labelledby="operation-report-day-'+index+'"><h3 id="operation-report-day-'+index+'">'+esc(group.day)+'</h3><ul class="operation-report-list">'+group.rows.join('')+'</ul></section>').join('');
}
const row=(label,value)=>`<div class="detail-row"><span>${esc(label)}</span><strong>${value}</strong></div>`;
const button=(label,action,id='',disabled=false,primary=false,slot='')=>`<button type="button" class="button small${primary?' primary':''}" data-auto-action="${action}" data-auto-id="${esc(id)}"${slot?' data-operation-slot="'+esc(slot)+'"':''}${disabled?' disabled':''}>${esc(label)}</button>`;
const state=value=>({PREPARED:'검토 대기',ENABLED:'자동 운용 중',STOPPED:'중지',PAUSED:'일시중지',ACTION_REQUIRED:'운용 확인 필요',PENDING_FUNDING:'거래 자금 준비 중',FUNDING_PENDING:'거래 자금 준비 중',RUNNING:'자동 운용 중',FAILED:'운용 오류',EXPIRED:'검토 기한 만료',FILLED:'체결',PARTIALLY_FILLED:'부분 체결',PARTIAL:'부분 체결',WAITING:'미체결',PENDING:'미체결',RESERVED:'전송 준비',OPEN:'미체결',CANCELLED:'취소',CANCELED:'취소',REJECTED:'주문 거절',UNKNOWN:'체결 결과 확인 필요',RESPONSE_REVIEW_REQUIRED:'응답 확인 필요',CANCELLED_BEFORE_SEND:'전송 전 취소'})[value]??'상태 확인';
const active=policy=>['ENABLED','RUNNING','PENDING_FUNDING','FUNDING_PENDING','ACTION_REQUIRED'].includes(policy?.status);
export function operationChangeLink(change,policy,profileId,origin=globalThis.location?.origin){
 if(Array.isArray(change?.changes)){const selected=change.changes.find(c=>c.profileId===profileId&&c.activationId===policy?.id);if(!selected)return '';change={...change,...selected};}
 if(!active(policy)||!change||change.profileId!==profileId||change.activationId!==policy?.id||!/^[a-f0-9]{64}$/.test(change.graphHash??'')||change.graphHash===policy.config?.graphHash)return '';
 let url;try{url=new URL(change.url);}catch{return '';}
 if(url.protocol!=='https:'||!/^[a-z0-9-]+\.[a-z0-9-]+\.ts\.net$/.test(url.hostname)||url.port||url.username||url.password||url.pathname!=='/operation-change/'||url.search||url.hash)return '';
 if(/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(origin??''))try{const local=new URL(change.localUrl);if(local.protocol==='http:'&&local.hostname==='127.0.0.1'&&local.port&&local.pathname==='/'&&!local.username&&!local.password&&!local.search&&!local.hash)url=local;}catch{}
 return '<a class="button small primary" data-operation-change-review href="'+esc(url.href)+'">변경안 확인 및 승인</a>';
}
export const isEventAutomationMind=manifest=>isRegimeProgramGraph(manifest?.data?.strategyPlan?.graph)||eventGraph(manifest?.data?.strategyPlan?.graph);
const bankAccountRequired=connection=>connection?.providerCode==='bank_account_required';
const permissionLinks=connection=>bankAccountRequired(connection)?'<div class="actions spaced"><a class="button small" href="https://upbit.com/balances" target="_blank" rel="noopener">업비트 계좌 인증 ↗</a></div>':`<div class="actions spaced"><a class="button small" href="https://upbit.com/mypage/open_api_management" target="_blank" rel="noopener">업비트 권한 설정 ↗</a>${button('연결 정보 변경','accounts')}</div>`;
const blockedPermissionLinks=reasons=>list(reasons).some(reason=>reason.code==='UPBIT_BANK_ACCOUNT_REQUIRED')?permissionLinks({providerCode:'bank_account_required'}):list(reasons).some(reason=>reason.code==='UPBIT_ORDER_WRITE_PERMISSION')?permissionLinks():'';
const permissionVerified=connection=>connection?.orderWritePermission==='VERIFIED'&&connection.status==='PASSED';
function permissionMarkup(connection={}){
 const verified=permissionVerified(connection),label=verified?'주문하기 권한 확인됨':bankAccountRequired(connection)?'원화 계좌 인증 필요':({PERMISSION_REQUIRED:'주문하기 권한 없음',REVIEW_REQUIRED:'검사 결과 확인 필요',CONNECTION_REQUIRED:'계좌 연결 필요',NOT_CHECKED:'확인 전'})[connection.status]??'검사 결과 확인 필요';
 const checkedAt=connection.source?.receivedAt??connection.receivedAt,details=[connection.market?'검사 거래쌍 '+connection.market:null,checkedAt?'검사 시각 '+time(checkedAt):null,connection.providerCode?'거래소 응답 '+connection.providerCode:null,Number.isInteger(connection.source?.httpStatus)?'거래소 응답 상태 '+connection.source.httpStatus:null,connection.code?'검사 코드 '+connection.code:null].filter(Boolean).join(' · ');
 return esc(label)+(details?helpTooltip('주문 권한 검사 상세',details,{id:'auto-permission-evidence'}):'');
}
function configRows(config={}){
 const currency=config.quoteCurrency??'—';
 return row('거래 계좌','업비트 · '+esc(currency))+row('거래쌍',marketScopeMarkup(config.marketIds))+row('총 운용 한도',amount(config.capitalLimit,currency))+row('1회 주문 한도',amount(config.perOrderLimit,currency))+row('일 손실 한도',amount(config.dailyLossLimit,currency))+row('일 최대 매수',config.maxTradesPerDay===0?'제한 없음':Number.isSafeInteger(config.maxTradesPerDay)?config.maxTradesPerDay+'회':'—')+row('최소 매수 간격',Number.isFinite(config.minIntervalMs)?quantity(config.minIntervalMs/1000)+'초':'—')+row('일 최대 JEV 호출',Number.isSafeInteger(config.maxJevCallsPerDay)?config.maxJevCallsPerDay+'회':'—');
}
function settingsAmounts(config={}){
 const currency=config.quoteCurrency??'—',money=value=>'<span title="'+esc(numericValue(value)?value+' '+currency:'금액 미기록')+'">'+(currency==='KRW'&&numericValue(value)?new Intl.NumberFormat('ko-KR',{maximumFractionDigits:2}).format(Number(value))+'원':amount(value,currency))+'</span>';
 return row('총 운용 한도',money(config.capitalLimit))+row('1회 주문 한도',money(config.perOrderLimit))+row('일 손실 한도',money(config.dailyLossLimit));
}
export function automationRuntimeMarkup(policy={}){
 const runtime=policy.runtime;if(!runtime)return '';
 const labels={PROGRAM_ACTIVE:'선택한 전략·묶음 운용 중',ACTIVE:'선택한 전략·묶음 운용 중',DRAINING:'이전 묶음 청산·대사 후 전환 준비',WAIT_CLASSIFICATION:'라우터 자료·판단 대기',CLASSIFICATION_DUE:'자료로 실행 전략 재판단 중',PROGRAM_DRAIN_WAIT_ORDERS:'묶음 전환 전 미확정 주문 확인 중',FIVE_MINUTE_INPUT_WARMUP:'5분 연속 체결·호가 수집 중',CASH_NO_PULLBACK_CANDIDATE:'급등·눌림 동시 충족 후보 대기',HOURLY_SCREEN_WAITING_ENTRY:'정시 이후 3분 진입 준비 대기',HOLD_POSITION:'보유 중 · 익절과 시간 청산 관찰',HOURLY_INPUT_REQUIRED:'판단 입력 확인 필요',CREATED:'첫 판단 대기',QUANT_ENTRY_NOT_ELIGIBLE:'진입 조건 대기',WAIT_NEXT_CLOSED_BAR:'다음 확정 봉 대기',WAIT_NEXT_JEV_BAR:'다음 JEV 판단 대기',HOLD_PROTECTION:'보유 중 · 보호 조건 관찰',PROTECTION_HOLD:'보유 중 · 보호 조건 관찰',HOLD:'유지',MISSING_INPUT:'입력 자료 확인 필요',DECISION_EXPIRED:'신호 유효 시간 경과',EXPIRED:'신호 유효 시간 경과',ORDER_RECONCILING:'주문 체결 확인 중',ORDER_FILLED:'체결 완료',ORDER_PARTIALLY_FILLED:'부분 체결 확인 중',ORDER_CANCELLED:'주문 취소 완료',ORDER_UNKNOWN:'주문 결과 확인 필요',ORDER_PENDING:'주문 접수 확인 중',ORDER_RESERVED:'주문 전송 준비',ORDER_OPEN:'미체결 주문 확인 중',JEV_STARTED:'JEV 판단 중',JEV_COMPLETED:'JEV 판단 완료',JEV_OUTCOME_UNKNOWN:'JEV 응답 확인 필요',JEV_RESPONSE_REVIEW:'JEV 응답 검토 필요',JEV_FAILURE:'JEV 연결 확인 필요',ORDER_DECISION_READY:'주문 조건 확인 중',PROTECTION_DECISION_READY:'보유 종목 보호 주문 준비',FUNDING_RECONCILING:'거래 자금 전환 확인 중',FUNDING_SUBMITTED:'거래 자금 전환 주문 접수',BLOCKED:'운용 조건 확인 필요',STOPPED:'운용 중지',RUNTIME_PAUSED_ENTRIES:'새 진입 중지'};
 const failure=runtime.lastError??policy.lastError,code=runtime.lastState,label=failure?'운용 확인 필요':labels[code]??'운용 상태 확인',details=[code,failure?.code,failure?.message,runtime.providerState?'공급자 상태 '+runtime.providerState:null,runtime.pendingDecision?.snapshotAsOf?'판단 자료 '+time(runtime.pendingDecision.snapshotAsOf):null,runtime.pendingDecision?.validUntil?'신호 유효 시각 '+time(runtime.pendingDecision.validUntil):null].filter(Boolean).join(' · ');
 const program=runtime.program;
 return (program?row('현재 실행 대상',esc(program.targetName??'판단 대기'))+list(program.members).map(m=>row(m.name,esc(labels[m.state?.state]??m.state?.state??'상태 확인')+(m.state?.code?' · '+esc(m.state.code):''))).join(''):'')+row('처리 상태',esc(label)+(details?helpTooltip('운용 상태 상세',details,{id:'auto-runtime-'+encodeURIComponent(policy.id??'current')}):''))+(runtime.lastEvaluationAt?row('최근 판단',esc(time(runtime.lastEvaluationAt))):runtime.updatedAt?row('상태 확인',esc(time(runtime.updatedAt))):'');
}
export function renderAutomationOrders(items=[],{expanded=false}={}){
 if(!items.length)return '<p class="empty">저장된 주문이 없습니다.</p>';
 return renderDataTable(['주문·평균 체결가',{label:'체결 금액',numeric:true},{label:'체결 수량',numeric:true},'주문 상세'],items.map(record=>{
  const request=record.request??{},order=record.order??{},currency=request.market?.split('-')[0]??record.plan?.quoteCurrency??'—',asset=request.market?.split('-').slice(1).join('-')||'',side=({bid:'매수',ask:'매도'})[request.side]??'행동 확인',summary=tradeFillSummary({filledQuantity:order.executedVolume,feesPaid:order.paidFee,fills:list(order.trades).map(t=>({id:t.id,quantity:t.volume,gross:t.funds}))});
  const fills=list(order.trades),fillDetails=fills.length?'<ul class="studio-claims">'+fills.map(fill=>'<li>'+tradePrice(numericValue(fill.price)?Number(fill.price):null,currency)+' '+esc(currency)+' × '+esc(quantity(fill.volume))+(asset?' '+esc(asset):'')+'<small class="studio-cell-secondary">'+esc(time(fill.createdAt))+'</small></li>').join('')+'</ul>':'';
  const details='<details'+(expanded?' open':'')+'><summary>'+(fills.length?'개별 체결 '+fills.length+'건 · 주문 상세':'요청·잔여 수량')+'</summary>'+ row('요청 수량',esc(quantity(request.volume)))+row('잔여 수량',esc(quantity(order.remainingVolume)))+row('주문 식별값',esc(record.identifier??'미기록'))+fillDetails+'</details>';
  const unfilled=summary.quantity===0&&!['FILLED','PARTIALLY_FILLED','PARTIAL'].includes(record.state),priceLabel=side==='행동 확인'?'평균 체결가':'평균 '+side+'가';
  const heading='<div class="automation-order-heading"><div><strong>'+esc(request.market??'—')+' · '+side+'</strong>'+(record.purpose==='FUNDING'?'<span class="pill">거래 자금 전환</span>':'')+'<small class="studio-cell-secondary">'+esc(state(record.state))+'</small><time datetime="'+esc(record.startedAt??record.createdAt??record.reservedAt??'')+'">'+esc(time(record.startedAt??record.createdAt??record.reservedAt))+'</time></div><dl class="mind-trade-receipt"><div class="mind-trade-price"><dt>'+helpLabel(priceLabel,'평균 체결가는 수수료를 제외한 실제 체결 금액 합계를 체결 수량 합계로 나눈 가격입니다. 요청 가격과 구분합니다.')+'</dt><dd>'+(summary.averagePrice!==null?tradePrice(summary.averagePrice,currency)+' '+esc(currency):unfilled?'미체결':'체결가 미확인')+'</dd></div></dl></div>';
  return [heading,amount(summary.gross,currency)+'<small class="studio-cell-secondary">수수료 '+amount(order.paidFee,currency)+'</small>',esc(quantity(order.executedVolume))+(asset?' '+esc(asset):'')+(numericValue(order.remainingVolume)&&Number(order.remainingVolume)>0?'<small class="studio-cell-secondary">잔여 '+esc(quantity(order.remainingVolume))+(asset?' '+esc(asset):'')+'</small>':''),details];
 }),{className:'automation-orders'});
}

export function createAutomatedTrading(hooks,{now=Date.now}={}){
 let learning=null,loadedAt=0,learningDetailsOpen=false,learningPending=null,learningError='',learningEpoch=0;
 let data=null,operationChange=null,key='',generation=0,loading=false,pending=false,error='',preview=null,previewScope='',disposed=false,knownExistingProfile=null,capitalEdit=null,resumeReview=null,reportFlight=null,orderReadEpoch=0;const requestKeys=new Map();
 const context=()=>{const route=hooks.route(),profileId=route.params.get('profileId'),manifest=hooks.getManifest(profileId),live=route.params.get('executionMode')==='live',draftEvent=isEventAutomationMind(manifest),activity=live?hooks.getActivity?.(profileId):null,existing=activity?.profileId===profileId&&Boolean(activity.activationId)||Boolean(profileId)&&knownExistingProfile===profileId||list(data?.policies).some(policy=>policy.config?.profileId===profileId);return {route,profileId,manifest,draftEvent,event:route.page==='minds'&&['operations','overview'].includes(route.params.get('view'))&&(draftEvent||live&&existing),live};};
 const contextKey=()=>{const c=context();return c.event?[c.profileId,c.manifest?.id,c.live?'live':'paper'].join('|'):'';};
 const current=value=>!disposed&&value===contextKey();
 const redraw=()=>{if(!disposed)hooks.redraw?.();};
 let loadFlight=null,refreshFlight=null;
 function load(options={}){const scope=contextKey();if(loadFlight?.scope===scope)return loadFlight.promise;const job={scope,promise:null};loadFlight=job;job.promise=loadNow(options).finally(()=>{if(loadFlight===job)loadFlight=null;});return job.promise;}
 async function loadNow({force=false}={}){
  const c=context(),next=contextKey();if(next!==key){key=next;generation++;learningEpoch++;refreshFlight=null;data=null;learning=null;learningDetailsOpen=false;learningError='';preview=null;previewScope='';error='';loading=false;}
  if(!c.event||!c.live||loading||data&&!force&&Date.now()-loadedAt<30000)return;
  const token=++generation;loading=true;error='';redraw();
  try{const [value,change,learningData]=await Promise.all([callAutomation(hooks.request,'automation.trading.read',{profileId:c.profileId}),hooks.request('/data/pending-operation-change.json').catch(()=>null),hooks.request(hourlyLearningRequest('hourly.learning.read',{profileId:c.profileId}).path).catch(()=>null)]);if(token!==generation||!current(next))return;data=value;operationChange=change;learning=c.manifest?.data?.strategyPlan?.graph?.nodes?.some(n=>n.type==='MODEL'&&n.config.family==='SURGE_PATH_FOREST')?null:learningData?.items?.[0]??null;loadedAt=Date.now();knownExistingProfile=list(value.policies).some(policy=>policy.config?.profileId===c.profileId)?c.profileId:null;}
  catch(problem){if(token===generation&&current(next))error=problem.message;}
  finally{if(token===generation&&current(next)){loading=false;redraw();}}
 }
 function allocationReview(){
  const p=data?.allocationPlan;if(!p||p.status!=='PREPARED')return;
  const valid=p.status==='PREPARED',percent=v=>Number.isFinite(v)?new Intl.NumberFormat('ko-KR',{style:'percent',maximumFractionDigits:2}).format(v):'미산정',evidence=p.targets[0].evidence;
  const comparison=renderDataTable(['모델',{label:'배정',numeric:true},{label:'순수익률',numeric:true},{label:'MDD',numeric:true}],p.targets.map(t=>['<a href="#minds?profileId='+encodeURIComponent(t.config.profileId)+'&executionMode=live&view=principles">'+esc(t.name)+'</a><br><small>50%</small>',amount(t.config.capitalLimit,p.quoteCurrency),percent(t.evidence?.netReturn),percent(t.evidence?.hourlyCloseMdd)]));
  const details=p.targets.map(t=>'<section class="spaced"><h3>'+esc(t.name)+'</h3>'+row('판단 주기',t.decisionIntervalMs?quantity(t.decisionIntervalMs/60000)+'분 확정봉':'전략 노드 기준')+row('1회 주문 한도',amount(t.config.perOrderLimit,p.quoteCurrency))+row('일 손실 한도',amount(t.config.dailyLossLimit,p.quoteCurrency))+row('비교 초기 자금',amount(t.evidence?.initialCash,p.quoteCurrency))+'</section>').join('');
  hooks.open?.('두 모델 자금 배분 최종 승인','<section data-allocation-review><p>기존 단타봇은 중지 상태입니다. 승인하면 아래 배정과 두 모델의 자동 운용을 함께 시작합니다.</p>'+row('배분 총액',amount(p.total,p.quoteCurrency))+comparison+(evidence?'<p class="tiny spaced">'+esc(evidence.period)+'<br>시간봉 종가 MDD. '+esc(evidence.costs)+'</p>':'')+'<p class="spaced">과거 1주일의 비교입니다. AI 성과는 저장된 판단을 유지해 배정 금액으로 재계산했습니다. 두 모델은 시장국면 신호를 공유해 동반 손실이 발생할 수 있습니다.</p><details class="spaced"><summary>거래 조건과 검증 근거</summary>'+details+row('검토 시각',esc(time(p.preparedAt)))+'</details><form data-auto-form="allocation-activate" data-auto-scope="'+esc(contextKey())+'"><p class="error-text spaced" data-auto-form-error role="alert"></p><div class="form-actions"><button type="submit" class="button primary"'+(valid?'':' disabled')+'>50%씩 배분하고 두 모델 운용 시작</button></div></form></section>');
 }
 function render(){
  const c=context();if(!c.event)return '';
  const head='<section class="mind-automation-workspace" data-automated-trading>';
  if(!c.live)return head+`<div class="studio-sheet-body"><p>기록한 호가·체결로 전략을 비교하세요.</p><div class="actions spaced">${button('실험실 열기','lab','',false,true)}</div></div></section>`;
  if(key!==contextKey()||loading&&!data)return head+'<div class="studio-sheet-body" role="status">운용 설정을 불러오는 중…</div></section>';
  if(error&&!data)return head+`<div class="studio-sheet-body"><p role="alert">${esc(error)}</p>${button('다시 조회','reload')}</div></section>`;
  const policies=list(data?.policies),currentPolicy=policies.find(active)??latestPolicy(),verified=permissionVerified(data?.connection),activity=hooks.getActivity?.(c.profileId),activityError=hooks.getActivityState?.()?.error,isActive=active(currentPolicy),canResume=currentPolicy?.status==='PAUSED';
  const allocation=data?.allocationPlan;
  const action=(label,kind,id='',extra={})=>({label,attributes:{'data-auto-action':kind,'data-auto-id':id},...extra});
  const controls=renderOperationControls({id:'automation-utilities-'+encodeURIComponent(c.profileId),pending,currency:currentPolicy?.config?.quoteCurrency,
   primary:isActive?action('자동 운용 중지','stop',currentPolicy.id,{icon:'stop',shortLabel:'중지'}):canResume?action('운용 재개','resume',currentPolicy.id,{icon:'play',shortLabel:'재개'}):c.draftEvent?action(currentPolicy?'새 운용 설정':'운용 설정','configure','',{icon:'play',shortLabel:currentPolicy?'새 운용 설정':'시작 설정'}):null,
   capital:currentPolicy&&(isActive||canResume)?action('운용 금액 수정','capital',currentPolicy.id):null,settings:currentPolicy||!c.draftEvent?action('운용 설정','settings'):null,
   items:[...(allocation?.status==='PREPARED'?[action('50%씩 배분안 최종 승인','allocation-review','',{group:'자금 배분'})]:[]),...(currentPolicy?[action('운용보고서','reports',currentPolicy.id,{group:'조회'}),action('주문·체결 기록','orders',currentPolicy.id,{group:'조회'})]:[]),action('새로고침','reload','',{group:'조회'})]});
  // Older callers without the shared activity cache retain factual policy state only.
  const fallback=currentPolicy?{activationId:currentPolicy.id,profileId:c.profileId,status:currentPolicy.status,marketIds:currentPolicy.config?.marketIds??[data?.scope?.market].filter(Boolean),quoteCurrency:currentPolicy.config?.quoteCurrency??data?.scope?.quoteCurrency,runtime:currentPolicy.runtime}:null;
  const item=activity===undefined?fallback:activity;
  const runtimeError=item?.runtime?.errorCode??item?.runtime?.lastError?.message??item?.runtime?.lastError?.code;
  const historicalIssue=['PAUSED','STOPPED'].includes(item?.status??currentPolicy?.status),marketWait=item?.runtime?.state===EXCHANGE_CONNECTION_RECOVERY.state&&EXCHANGE_CONNECTION_RECOVERY.codes.includes(runtimeError)||item?.runtime?.state===EXCHANGE_DATA_RECOVERY.state&&EXCHANGE_DATA_RECOVERY.codes.includes(runtimeError),runtimeMessage=item?.runtime?.lastError?.message;
  const diagnostic=runtimeError?'<div class="mind-operation-diagnostic" data-operation-diagnostic="'+(historicalIssue?'historical':marketWait?'waiting':'current')+'" role="'+(historicalIssue||marketWait?'status':'alert')+'"><span class="mind-operation-issue-label">'+(historicalIssue?'이전 실행 기록':marketWait?'자동 재시도':'현재 실행 오류')+helpTooltip('운용 상태 상세',runtimeError,{id:'auto-current-error'})+'</span>'+(historicalIssue?'<p>중지 전 실행 기록에 확인할 내용이 있습니다.</p>':'')+(runtimeMessage?'<p>'+esc(runtimeMessage)+'</p>':'')+'</div>':'';
  const readNotice=activityError?'<p class="mind-operation-read-error" role="alert">최근 활동을 불러오지 못했어요. '+esc(activityError)+'</p>':activity===undefined&&hooks.getActivity?'<p class="mind-activity-loading" role="status">최근 활동을 불러오는 중…</p>':'';
  const needsReload=activityError||runtimeError&&!historicalIssue&&!marketWait,refreshing=refreshFlight?.scope===contextKey();
  const statusDetails=diagnostic||readNotice?'<div class="mind-operation-status-details" data-operation-key="auto-status-'+esc(currentPolicy?.id??c.profileId)+'">'+diagnostic+readNotice+(needsReload?'<div class="actions">'+button(loading||refreshing?'조회 중…':activityError?'다시 불러오기':'새로고침','reload','',pending||loading||refreshing,false,'reload')+'</div>':'')+'</div>':'';
  const hero=renderMindActivityHero(item,{executionMode:'live',profileId:context().profileId,avatarConfig:hooks.getAppearance?.(context().profileId),idPrefix:'auto-'+encodeURIComponent(c.profileId),statusDetails,controls:operationChangeLink(operationChange,currentPolicy,c.profileId)+controls,loading:activity===undefined&&!activityError&&typeof hooks.getActivity==='function',unavailable:Boolean(activityError)});
  const attention=!verified?'<section class="mind-operation-attention" role="status"><strong>'+permissionMarkup(data?.connection)+'</strong>'+permissionLinks(data?.connection)+'<div class="actions">'+button('권한 확인','permission','',pending||!data?.scope?.market)+'</div></section>':'';
  const history=policies.filter(policy=>policy.id!==currentPolicy?.id);
  const update=currentPolicy?.pendingStrategyUpdate??currentPolicy?.lastStrategyUpdate,updateStatus=update?'<p role="status" class="mind-operation-attention">'+(update.status==='APPLIED'?'전략 변경 반영 · '+esc(time(update.appliedAt)):'전략 반영 대기 · 미확정 주문 대사 후 다음 판단부터 적용')+'</p>':'';
  const scopeIssue=data?.scopeIssue?'<p class="mind-operation-attention" role="alert">'+esc(data.scopeIssue.message)+'</p>':'';
  return head+'<div class="mind-operation-layout"><div class="mind-operation-primary">'+hero+scopeIssue+updateStatus+attention+(error?`<p class="error-text spaced" role="alert">${esc(error)}</p>`:'')+renderHourlyLearning(learning,{detailsOpen:learningDetailsOpen,pending:learningPending?.scope===contextKey()&&learningPending.epoch===learningEpoch?learningPending:null,error:learningError})+'</div>'+renderMindActivityFeed(item,{profileId:c.profileId,executionMode:'live',showRuntimeNotice:false})+'</div>'+(history.length?'<details class="mind-operation-history"><summary>이전 운용 · '+history.length+'개</summary>'+history.map(policy=>'<section data-auto-policy="'+esc(policy.id)+'"><header><strong>'+esc(state(policy.status))+'</strong><span>'+esc(time(policy.userConfirmedAt??policy.createdAt))+'</span>'+button('주문·체결 기록','orders',policy.id,pending)+button('설정 보기','history-settings',policy.id,pending)+'</header></section>').join('')+'</details>':'')+'</section>';
 }
 function latestPolicy(){return list(data?.policies).slice().sort((a,b)=>String(b.userConfirmedAt??b.createdAt??'').localeCompare(String(a.userConfirmedAt??a.createdAt??'')))[0]??null;}
 function settings(id){
  const c=context(),policy=id?list(data?.policies).find(value=>value.id===id):list(data?.policies).find(active)??latestPolicy();if(!c.event||!c.live||key!==contextKey()||pending)return;
  if(!policy)return configure();
  const verified=permissionVerified(data?.connection);
  const config=policy.config??{};
  hooks.open?.('운용 설정',`<section data-auto-settings><p class="studio-detail-intro">${esc(state(policy.status))} · 저장된 설정</p>${settingsAmounts(config)}${row('운용 기간',esc(operationWindowSummary(config)))}<div class="operation-scope"><h3>투자 범위</h3>${marketScopeMarkup(config.marketIds)}</div><details class="mind-operation-history"><summary>상세 설정</summary>${row('거래 계좌','업비트 · '+esc(config.quoteCurrency??'—'))}${row('일 최대 매수',config.maxTradesPerDay===0?'제한 없음':Number.isSafeInteger(config.maxTradesPerDay)?config.maxTradesPerDay+'회':'—')}${row('최소 매수 간격',Number.isFinite(config.minIntervalMs)?quantity(config.minIntervalMs/1000)+'초':'—')}${row('일 최대 JEV 호출',Number.isSafeInteger(config.maxJevCallsPerDay)?config.maxJevCallsPerDay+'회':'—')}${row('발행 정책',config.manifestId?esc(config.manifestId):'—')}${row('주문 권한',permissionMarkup(data?.connection))}${!verified?permissionLinks(data?.connection)+`<div class="actions spaced">${button('권한 확인','permission','',pending||!data?.scope?.market)}</div>`:''}${automationRuntimeMarkup(policy)}</details>${active(policy)?'<p class="tiny muted spaced">금액을 저장하면 현재 운용의 다음 판단부터 적용됩니다.</p><div class="actions spaced">'+button('운용 금액 수정','capital',policy.id,pending,true)+button('자동 운용 중지','stop',policy.id,pending)+'</div>':policy.status==='PAUSED'?'<p class="tiny muted spaced">기존 모델·금액·보유·수익 기록을 이어서 운용합니다.</p><div class="actions spaced">'+button('운용 재개','resume',policy.id,pending,true)+'</div>':''}</section>`);
 }
 async function editCapital(id){
  if(!context().live||pending)return;const scope=contextKey();hooks.open?.('운용 금액 수정','<p role="status" aria-live="polite">계좌 잔고와 배정 가능한 금액을 조회하고 있습니다.</p>');const dialogToken=hooks.getDialogToken?.();try{const value=await callAutomation(hooks.request,'automation.trading.capital.read',{activationId:id});if(!current(scope)||dialogToken!==undefined&&dialogToken!==hooks.getDialogToken?.())return;capitalEdit={...value,scope};const p=value.policy,c=value.capital,field=(label,name,amount)=>'<label class="field">'+esc(label)+'<input type="number" name="'+name+'" value="'+esc(amount)+'" min="0" step="any" required></label>';
  hooks.open?.('운용 금액 수정','<form data-auto-form="capital" data-auto-scope="'+esc(scope)+'"><div class="form-grid">'+row('계좌에서 배정 가능한 최대',amount(c.maximumCapital,c.quoteCurrency))+field('운용 자금 · '+c.quoteCurrency,'capitalLimit',p.config.capitalLimit)+'<div class="full">'+button('계좌 최대 금액','capital-max',id,false)+'</div>'+field('1회 주문 한도 · '+c.quoteCurrency,'perOrderLimit',p.config.perOrderLimit)+field('하루 손실 한도 · '+c.quoteCurrency,'dailyLossLimit',p.config.dailyLossLimit)+field('하루 매수 횟수 · 0은 제한 없음','maxTradesPerDay',p.config.maxTradesPerDay??0)+'</div><p class="tiny muted">최대 선택은 운용액과 1회 주문 한도를 함께 채웁니다. 보유와 주문 기록을 유지하고 다음 판단부터 적용합니다.</p><p role="alert" data-auto-form-error></p><div class="form-actions"><button class="button" type="button" data-studio-action="close-dialog">취소</button><button class="button primary" type="submit">저장하고 운용에 반영</button></div></form>');}catch(problem){if(current(scope)&&(dialogToken===undefined||dialogToken===hooks.getDialogToken?.()))hooks.open?.('운용 금액 수정','<p role="alert">'+esc(problem.message)+'</p>'+button('다시 조회','capital',id));}
 }
 async function maximumCapital(node){if(!context().live)return;const label=node.textContent;node.disabled=true;node.textContent='최대액 조회 중…';node.setAttribute?.('aria-busy','true');try{const scope=contextKey(),form=node.closest?.('form'),value=await callAutomation(hooks.request,'automation.trading.capital.read',node.dataset.autoId?{activationId:node.dataset.autoId}:{profileId:context().profileId});if(current(scope)&&form?.isConnected!==false){const input=form?.querySelector('[name="capitalLimit"]');if(input)input.value=value.capital.maximumCapital;const orderInput=form?.querySelector('[name="perOrderLimit"]');if(orderInput)orderInput.value=value.capital.maximumCapital;if(capitalEdit&&node.dataset.autoId)capitalEdit={...value,scope};const capacityError=form?.querySelector('[data-auto-form-error]');if(capacityError)capacityError.textContent=Number(value.capital.maximumCapital)===0?(Number(value.capital.exchangeAvailable)>0&&Number(value.capital.otherAllocatedCash)>=Number(value.capital.exchangeAvailable)?'현재 현금은 기존 운용에 모두 배정되어 있어요. 기존 자금은 유지합니다. 추가 입금 후 새 운용 금액을 입력해 주세요.':'현재 추가로 배정할 현금이 없어요. 계좌 잔고와 기존 배정을 확인해 주세요.'):'';}}catch(problem){hooks.toast?.(problem.message);}finally{if(node.isConnected!==false){node.disabled=false;node.textContent=label;node.removeAttribute?.('aria-busy');}}}
 function configure({transition=false}={}){
  const c=context();if(!c.event||!c.draftEvent||!c.live||key!==contextKey()||pending)return;preview=null;previewScope='';
  if(!data?.currentManifest){hooks.open?.('실전 설정 확인','<p role="alert">'+esc(data?.scopeIssue?.message||'발행한 전략과 사용 설정을 확인하세요.')+'</p>'+'<button type="button" class="button primary" data-studio-action="strategy-graph" data-studio-id="'+esc(c.profileId)+'">노드 편집 후 실전 설정</button>');return;}
  const running=list(data.policies).find(active);
  if(running&&!transition)return;
  if(running){hooks.open?.('새 정책 실전 설정',`<section data-auto-transition>${row('현재 운용',esc(state(running.status))+' · '+esc(list(running.config?.marketIds).join(', ')))}${row('새 정책',esc(c.manifest.data.name)+' · v'+esc(data.currentManifest.version))}<details><summary>정책 식별값</summary>${row('현재 정책',esc(running.config?.manifestId))}${row('새 정책',esc(data.currentManifest.id))}</details><p>기존 운용을 중지한 뒤 새 정책의 실전 설정을 엽니다. 기존 금액과 횟수 한도는 이어받습니다. 중지해도 기존 주문과 보유 자산은 유지됩니다.</p><div class="actions spaced">${button('기존 운용 중지 후 설정 계속','stop-configure',running.id,pending,true)}</div></section>`);return;}
  const currency=data.scope.quoteCurrency,minimum=currency==='BTC'?'0.00005':'5000',last=latestPolicy()?.config,previous=last?.quoteCurrency===currency&&list(last.marketIds).includes(data.scope.market)?last:null;
  const graph=c.manifest.data.strategyPlan.graph,requiresJev=data.programDetails?.requiresJev??graphRequiresJev(graph),minuteCalls=data.programDetails?.estimatedJevCallsPerDay??Math.ceil(86400000/(data.scope.decisionIntervalMs??parseFloat(data.scope.timeframe)*(data.scope.timeframe.endsWith('h')?3600000:data.scope.timeframe.endsWith('d')?86400000:60000))),questionsPerBar=graph.executionScope?.kind==='EACH_ASSET'?graph.nodes.filter(n=>n.type==='JEV_QUESTION').length:1,callBudget=previous&&previous.requiresJev!==false?previous.maxJevCallsPerDay:requiresJev?Math.min(JEV_EXECUTION_CALL_LIMIT,minuteCalls*questionsPerBar):0;
  const field=(label,name,value,{min='0',step='any',max=''}={})=>`<label class="field">${esc(label)}<input type="number" name="${name}" value="${value}" min="${min}" step="${step}"${max?' max="'+max+'"':''} required></label>`;
  hooks.open?.('자동 운용 설정',`<form data-auto-form="prepare" data-auto-capital-order="${!previous&&graph.executionScope?.timeframe==='1h'}" data-auto-scope="${esc(contextKey())}"><p class="studio-detail-intro">${previous?'이전 설정을 불러왔어요. 금액과 한도를 확인해 주세요.':'운용할 금액과 한도를 정해 주세요.'}</p><div class="operation-scope"><h3>투자 범위</h3>${marketScopeMarkup(data.scope.marketIds??[data.scope.market])}</div><div class="form-grid mind-operation-setup">${field('총 운용 한도 · '+currency,'capitalLimit',esc(previous?.capitalLimit??'0'))}<div class="full">${button('계좌 최대 금액','capital-max','',pending)}</div>${!previous&&graph.executionScope?.timeframe==='1h'?'<input type="hidden" name="perOrderLimit" value="0"><p class="tiny muted full">1회 주문 한도는 입력한 운용액과 같습니다. 실제 진입 비중과 분할 매도는 연결한 노드가 정합니다.</p>':field('1회 주문 한도 · '+currency,'perOrderLimit',esc(previous?.perOrderLimit??minimum))}${field('일 손실 한도 · '+currency,'dailyLossLimit',esc(previous?.dailyLossLimit??'0'))}${operationWindowFields(previous??{})}</div><details class="mind-operation-advanced" data-auto-advanced><summary>운용 빈도·판단 설정</summary><div class="form-grid">${field('하루 매수 횟수 · 0은 제한 없음','maxTradesPerDay',esc(previous?.maxTradesPerDay??'0'),{step:'1',max:'10000'})}${field('최소 매수 간격 · 초','minIntervalSeconds',esc(numericValue(previous?.minIntervalMs)?previous.minIntervalMs/1000:'0'),{step:'1'})}${field('일 최대 JEV 호출','maxJevCallsPerDay',esc(callBudget),{step:'1',max:String(JEV_EXECUTION_CALL_LIMIT)})}${requiresJev?'<p class="tiny muted full">매 봉 한 번 판단하면 하루 '+quantity(minuteCalls)+'회입니다. '+(questionsPerBar>1?'종목 선택과 진입 및 보유 질문을 함께 계산해 기본 호출 한도를 정했습니다. ':'')+'실제 호출은 선택된 질문과 입력 준비 상태에 따라 달라지며, 확인한 한도까지 사용합니다.</p>':''}</div></details><details class="mind-operation-advanced"><summary>계좌 연결 정보</summary>${row('주문 권한',permissionMarkup(data.connection))}</details><p class="error-text spaced" data-auto-form-error role="alert"></p><div class="form-actions"><button type="submit" class="button primary">설정 검토</button></div></form>`);
 }
 function review(){
  const p=preview;if(!p||!current(previewScope))return;const canActivate=p.canActivate===true&&p.id&&p.previewHash&&p.nonce,fund=p.fundingPlan,currency=p.config.quoteCurrency,fee=p.readiness?.fees;
  hooks.open?.('실전 자동 운용 검토',`<section data-auto-review><p class="studio-detail-intro">승인한 전략과 한도에 따라 실행 서버가 개별 주문을 자동 실행합니다. 퀀트 또는 AI가 매매를 판단하고 서버가 리스크 검사와 체결 대조를 수행합니다.</p>${p.programDetails?'<section class="spaced" data-program-approval><h3>'+esc(p.programDetails.name)+' · v'+p.programDetails.version+'</h3>'+p.programDetails.choices.map(choice=>'<div class="operation-scope"><h4>'+esc(choice.label)+' → '+esc(choice.targetName)+'</h4><p>'+esc(choice.description)+'</p>'+choice.members.map(m=>row(m.name,quantity(m.shareBps/100)+'%')).join('')+'</div>').join('')+'<p class="tiny">이 비율은 새 묶음 안의 배분입니다. 기존에 운용 중인 마인드는 별도 자금으로 계속 실행되므로 같은 종목의 노출이 겹칠 수 있습니다. 이 승인은 기존 마인드를 교체하거나 중지하지 않습니다. 라우터의 실행 대상이 바뀔 때는 이전 묶음의 보유와 미확정 주문을 정산한 뒤 전환합니다. 각 구성원의 수량과 비용은 자기 체결로 구분합니다.</p></section>':''}${configRows(p.config)}${row('운용 기간',esc(operationWindowSummary(p.config)))}${row('계좌 사용 가능',amount(p.readiness?.account?.available,currency))}${p.capital?row('다른 운용 배정액',amount(p.capital.otherAllocatedCash,currency))+row('이번 운용 배정 가능액',amount(p.capital.maximumCapital,currency)):''}${row('관측 시각',esc(time(p.readiness?.asOf)))}${fee?row('매수·매도 수수료',quantity(Number(fee.takerBuyRate)*100)+'% · '+quantity(Number(fee.takerSellRate)*100)+'%'):''}${fund?`<section class="spaced"><h3>시작 시 거래 자금 전환</h3>${row('BTC 매도 수량',amount(fund.volume,'BTC'))}${row('예상 원화 수령',amount(fund.expectedNetQuote,'KRW'))}<p class="tiny">시작하면 위 BTC를 매도해 거래 자금을 마련합니다. 실제 수령액은 체결 가격과 수수료에 따라 달라집니다.</p></section>`:''}${list(p.blockedReasons).map(reason=>`<p role="status" class="spaced">${esc(reason.message)}</p>`).join('')}${!canActivate?blockedPermissionLinks(p.blockedReasons):''}${!canActivate&&list(p.blockedReasons).some(r=>r.code==='AUTOMATION_CAPITAL')&&p.capital&&Number(p.capital.maximumCapital)>0?'<p role="status">요청한 운용액보다 배정 가능액이 적습니다. 아래 버튼으로 금액을 맞춘 뒤 다시 검토하세요.</p>'+button('남은 최대 금액으로 다시 검토','fit-available','',pending):''}<p class="tiny">승인 시 현재 계좌와 모델 버전을 확인합니다.</p><form data-auto-form="activate" data-auto-scope="${esc(previewScope)}"><label class="field full spaced"><span><input type="checkbox" name="confirmed" required${canActivate?'':' disabled'}> ${fund?'BTC 전환과 ':''}위 한도 내 실전 자동 주문에 동의합니다.</span></label><p class="error-text spaced" data-auto-form-error role="alert"></p><div class="form-actions">${button('설정 변경','configure','',pending)}<button type="submit" class="button primary"${canActivate?'':' disabled'}>실전 자동 운용 시작</button></div></form></section>`);
 }
 async function fitAvailable(){
  const p=preview,scope=previewScope;if(pending||!p||!current(scope))return;pending=true;
  try{const value=await callAutomation(hooks.request,'automation.trading.capital.read',{profileId:context().profileId}),maximum=value.capital.maximumCapital;
   if(!(Number(maximum)>0))throw Error('현재 배정 가능한 금액이 없습니다. 기존 운용의 금액을 수정해 주세요.');
   const config=Object.fromEntries(['profileId','capitalLimit','perOrderLimit','dailyLossLimit','maxTradesPerDay','minIntervalMs','maxJevCallsPerDay','startsAt','endsAt'].filter(k=>p.config[k]!==undefined).map(k=>[k,p.config[k]]));config.capitalLimit=maximum;config.perOrderLimit=Number(p.config.perOrderLimit)>Number(maximum)?maximum:p.config.perOrderLimit;config.dailyLossLimit=Number(p.config.dailyLossLimit)>Number(maximum)?maximum:p.config.dailyLossLimit;
   const result=await callAutomation(hooks.request,'automation.trading.prepare',{...config,idempotencyKey:crypto.randomUUID()});
   if(current(scope)){preview={...result.preview,canActivate:result.canActivate};previewScope=scope;pending=false;review();}
  }catch(problem){hooks.open?.('운용 금액 확인','<p role="alert">'+esc(problem.message)+'</p>'+button('설정 수정','configure'));}finally{pending=false;}
 }
 async function permission(){const c=context(),scope=contextKey();if(!c.live||!data?.scope?.market||pending)return;pending=true;redraw();try{const result=await callAutomation(hooks.request,'automation.trading.permission',{market:data.scope.market});if(current(scope)){if(result.connection){data={...data,connection:result.connection};redraw();}await load({force:true});}}catch(problem){if(current(scope)){error=problem.message;redraw();}}finally{pending=false;redraw();}}
 async function orders(id,orderIdentifier=''){
  const c=context(),activity=hooks.getActivity?.(c.profileId);
  if(!c.live||pending||!list(data?.policies).some(p=>p.id===id)&&!(activity?.profileId===c.profileId&&activity.activationId===id)&&!list(hooks.getActivities?.()).some(item=>item.activationId===id))return;
  const epoch=++orderReadEpoch,recordScope=()=>hooks.route().page+'?'+hooks.route().params.toString(),scope=recordScope(),same=()=>!disposed&&epoch===orderReadEpoch&&scope===recordScope(),title=orderIdentifier?'주문·체결 상세':'주문·체결 기록';
  hooks.open?.(title,'<p role="status" aria-live="polite">체결 원장을 불러오는 중…</p>');const dialogToken=hooks.getDialogToken?.();
  try{
   const value=await callAutomation(hooks.request,'automation.trading.orders',{activationId:id});if(!same()||dialogToken!==undefined&&dialogToken!==hooks.getDialogToken?.())return;
   const selected=orderIdentifier?list(value.items).find(record=>record.identifier===orderIdentifier):null;
   hooks.open?.(title,orderIdentifier?(selected?renderAutomationOrders([selected],{expanded:true}):'<p role="status">선택한 주문을 이번 원장에서 찾을 수 없습니다.</p>'):renderAutomationOrders(value.items),orderIdentifier?button('전체 주문 보기','orders',id):'');
  }catch(problem){if(same()&&(dialogToken===undefined||dialogToken===hooks.getDialogToken?.()))hooks.open?.(title,'<p role="alert">'+esc(problem.message)+'</p>','<button type="button" class="button small" data-auto-action="orders" data-auto-id="'+esc(id)+'"'+(orderIdentifier?' data-auto-order-identifier="'+esc(orderIdentifier)+'"':'')+'>다시 조회</button>');}
 }
 async function resume(id){
  const policy=list(data?.policies).find(p=>p.id===id);if(!context().live||policy?.status!=='PAUSED'||pending)return;
  const scope=contextKey();pending=true;resumeReview=null;error='';redraw();
  hooks.open?.('운용 재개 확인','<p role="status">기존 설정과 현재 계좌 잔고를 대조하고 있습니다.</p>');const token=hooks.getDialogToken?.();
  try{const value=await callAutomation(hooks.request,'automation.trading.capital.read',{activationId:id});if(!current(scope)||token!==undefined&&token!==hooks.getDialogToken?.())return;
   if(value.policy?.status!=='PAUSED'||typeof value.capital?.resumeShortfall!=='string')throw Error('최신 서버의 재개 정보를 다시 조회하세요.');
   resumeReview={...value,scope};const c=value.capital,short=c.resumeShortfall!=='0',currency=esc(c.quoteCurrency);
   hooks.open?.('운용 재개 확인','<section>'+settingsAmounts(value.policy.config)+row('재개 원장 금액',esc(c.resumeRequiredCapital)+' '+currency)+row('다른 운용 제외 가용액',esc(c.maximumCapital)+' '+currency)+(short?'<p role="status">원장과 계좌 차액은 <strong>'+esc(c.resumeShortfall)+' '+currency+'</strong>입니다. 아래 버튼은 이 금액을 운용 원금에서 차감해 정산한 뒤 재개합니다. 정산은 별도 이력으로 남으며 과거 매매 수익으로 기록하지 않습니다.</p>':'<p>저장된 설정으로 운용을 이어갑니다.</p>')+'<p class="tiny muted">전략·운용 한도·보유 수량·체결 기록을 유지합니다. 재개하면 서버가 승인된 설정 안에서 자동 주문합니다.</p><form data-auto-form="resume" data-auto-scope="'+esc(scope)+'"><p role="alert" data-auto-form-error></p><div class="form-actions"><button type="button" class="button" data-studio-action="close-dialog">닫기</button><button type="submit" class="button primary">'+(short?'표시된 차액 정산 후 운용 재개':'기존 설정으로 운용 재개')+'</button></div></form></section>');
  }catch(problem){if(current(scope)&&(token===undefined||token===hooks.getDialogToken?.()))hooks.open?.('운용 재개 확인','<p role="alert">'+esc(problem.message)+'</p>'+button('다시 조회','resume',id));}finally{pending=false;redraw();}
 }
 async function stop(id,{configureAfter=false}={}){if(!context().live||!list(data?.policies).some(p=>p.id===id&&active(p))||pending)return;const scope=contextKey(),dialogToken=hooks.getDialogToken?.();pending=true;redraw();try{await callAutomation(hooks.request,'automation.trading.stop',{activationId:id});if(current(scope)){const sameDialog=dialogToken===undefined||dialogToken===hooks.getDialogToken?.();if(sameDialog)hooks.close?.();const closedToken=hooks.getDialogToken?.();await Promise.all([load({force:true}),hooks.loadActivity?.({force:true})]);hooks.toast?.('자동 운용을 중지했습니다.');if(configureAfter&&sameDialog&&current(scope)&&(closedToken===undefined||closedToken===hooks.getDialogToken?.())){pending=false;configure();}}}catch(problem){if(current(scope))error=problem.message;}finally{pending=false;redraw();}}
 async function reports(id){
  const c=context(),activity=hooks.getActivity?.(c.profileId);if(!c.live||!id||!list(data?.policies).some(p=>p.id===id)&&!(activity?.profileId===c.profileId&&activity.activationId===id)&&!list(hooks.getActivities?.()).some(item=>item.activationId===id))return;
  const routeScope=()=>hooks.route().page+'?'+hooks.route().params.toString(),scope=routeScope(),contextScope=contextKey();
  if(reportFlight?.scope===scope&&reportFlight.id===id&&(reportFlight.token===undefined||reportFlight.token===hooks.getDialogToken?.()))return;
  hooks.open?.('포트폴리오 운용보고서','<p role="status">보고서 목록을 불러오는 중…</p>');
  const job={scope,id,token:hooks.getDialogToken?.()};reportFlight=job;
  const same=()=>reportFlight===job&&current(contextScope)&&scope===routeScope()&&(job.token===undefined||job.token===hooks.getDialogToken?.());
  try{
   const value=await callAutomation(hooks.request,'automation.trading.reports.read',{activationId:id});if(!same())return;
   hooks.open?.('포트폴리오 운용보고서',value.items.length?reportList(value.items):'<p>저장된 보고서가 없습니다. 보고서는 운용 판단의 정산이 끝난 뒤 자동 저장됩니다.</p>',button('목록 새로고침','reports',id));
  }catch(problem){if(same())hooks.open?.('포트폴리오 운용보고서','<p role="alert">'+esc(problem.message)+'</p>',button('다시 조회','reports',id));}
  finally{if(reportFlight===job)reportFlight=null;}
 }
 async function click(event){
  const node=event.target.closest?.('[data-auto-action]');if(!node||node.disabled)return;event.preventDefault();const action=node.dataset.autoAction,id=node.dataset.autoId;
  if(action==='resume')return resume(id);
  if(action==='learning-details'){learningDetailsOpen=!learningDetailsOpen;const details=node.closest?.('details');if(details)details.open=learningDetailsOpen;else redraw();return;}
  if(action==='learning-toggle'){
   if(!learning||learningPending?.scope===contextKey()&&learningPending.epoch===learningEpoch)return;
   const target={scope:contextKey(),epoch:learningEpoch,profileId:learning.profileId,activationId:learning.activationId,enabled:node.dataset.learningEnabled===undefined?!learning.enabled:node.dataset.learningEnabled==='true'};
   learningPending=target;learningError='';node.disabled=true;redraw();
   try{
    const latest=await hooks.request(hourlyLearningRequest('hourly.learning.read',{profileId:target.profileId}).path),item=latest.items?.find(i=>i.profileId===target.profileId);
    if(!current(target.scope)||learningEpoch!==target.epoch)return;
    if(!item||item.activationId!==target.activationId)throw Error('자동 학습의 운용 대상을 다시 확인하세요.');
    if(item.enabled===target.enabled){learning=item;return;}
    const call=hourlyLearningRequest('hourly.learning.configure',{profileId:target.profileId,activationId:target.activationId,enabled:target.enabled,autoApply:item.autoApply,expectedRevision:item.revision,userAction:'ENABLE_MODEL_AUTO_REFRESH'});
    const result=await hooks.request(call.path,call.body);
    if(!current(target.scope)||learningEpoch!==target.epoch)return;
    const applied=result.items?.find(i=>i.profileId===target.profileId&&i.activationId===target.activationId);
    if(!applied||applied.enabled!==target.enabled)throw Error('자동 학습 설정의 반영 결과를 확인하지 못했습니다. 다시 조회해 주세요.');
    learning=applied;
    hooks.toast?.(target.enabled?'자동 학습을 켰습니다.':'자동 학습을 껐습니다. 현재 실전 모델은 유지합니다.');
   }catch(e){if(current(target.scope)&&learningEpoch===target.epoch)learningError=e.message;}
   finally{if(learningPending===target)learningPending=null;if(node.isConnected)node.disabled=false;redraw();}
   return;
  }
  if(action==='lab')return hooks.navigate?.('minds',{profileId:context().profileId,view:'simulations',lab:'compare',labStep:'strategy',a:null,b:null,simulationId:null,draftId:null});
  if(action==='allocation-review')return allocationReview();
  if(action==='reports')return reports(id);
  if(action==='accounts'){preview=null;hooks.close?.();return hooks.navigate?.('settings',{executionMode:'live',view:'accounts'});}
  if(action==='principles')return hooks.navigate?.('minds',{profileId:context().profileId,view:'principles'});
  if(action==='fit-available')return fitAvailable();if(action==='capital')return editCapital(id);if(action==='capital-max')return maximumCapital(node);if(action==='reload'){const scope=contextKey();if(refreshFlight?.scope===scope)return;const job={scope};refreshFlight=job;redraw();try{await Promise.all([load({force:true}),hooks.loadActivity?.({force:true})]);}catch(problem){if(current(scope))error=problem.message;}finally{if(refreshFlight===job)refreshFlight=null;if(current(scope))redraw();}return;}if(action==='settings')return settings();if(action==='history-settings')return settings(id);if(action==='configure')return configure();if(action==='permission')return permission();if(action==='orders')return orders(id,node.dataset.autoOrderIdentifier);if(action==='stop')return stop(id);if(action==='stop-configure')return stop(id,{configureAfter:true});
 }
 async function submit(event){
  const form=event.target.closest?.('[data-auto-form]');if(!form)return;event.preventDefault();const c=context();if(pending||!c.event||!c.live||form.dataset.autoScope!==contextKey()||['prepare','activate'].includes(form.dataset.autoForm)&&!c.draftEvent)return;
  const values=Object.fromEntries(new FormData(form)),scope=contextKey(),kind=form.dataset.autoForm,dialogToken=hooks.getDialogToken?.(),errorNode=form.querySelector('[data-auto-form-error]'),controls=[...form.querySelectorAll('input,button')].map(control=>({control,disabled:control.disabled}));
  errorNode.textContent='';pending=true;for(const {control}of controls)control.disabled=true;let focusAfter=null;
  try{
   if(kind==='resume'){
    const p=resumeReview;if(!p||p.scope!==scope)throw Error('최신 재개 정보를 다시 조회하세요.');
    const body={activationId:p.policy.id,expectedRevision:p.policy.revision,userAction:'LIVE_AUTOMATION_RESUME',...(p.capital.resumeShortfall==='0'?{}:{cashAdjustment:'-'+p.capital.resumeShortfall})},fingerprint=JSON.stringify(body),idempotencyKey=requestKeys.get(fingerprint)??crypto.randomUUID();requestKeys.set(fingerprint,idempotencyKey);
    const value=await callAutomation(hooks.request,'automation.trading.resume',{...body,idempotencyKey});requestKeys.delete(fingerprint);
    if(current(scope)){resumeReview=null;hooks.close?.();await Promise.all([load({force:true}),hooks.loadActivity?.({force:true})]);hooks.toast?.(value.policy?.status==='ENABLED'?'기존 운용을 재개했습니다.':'현재 운용은 중지 상태입니다.');}
   }else if(kind==='allocation-activate'){
    const p=data?.allocationPlan;if(!p||p.status!=='PREPARED')throw Error('현재 배분 요청을 확인하세요.');
    await callAutomation(hooks.request,'automation.trading.allocation.activate',{previewId:p.id,previewHash:p.previewHash,nonce:p.nonce,userAction:'LIVE_ALLOCATION_ACTIVATION'});
    if(current(scope)){hooks.close?.();await Promise.all([load({force:true}),hooks.loadActivity?.({force:true})]);hooks.toast?.('두 모델의 배정과 자동 운용을 시작했습니다.');}
   }else if(kind==='capital'){

    const edit=capitalEdit;if(!edit||edit.scope!==scope)throw Error('최신 운용 금액을 다시 조회하세요.');const body={activationId:edit.policy.id,expectedRevision:edit.policy.revision,capitalLimit:values.capitalLimit,perOrderLimit:values.perOrderLimit,dailyLossLimit:values.dailyLossLimit,...(values.maxTradesPerDay===undefined?{}:{maxTradesPerDay:Number(values.maxTradesPerDay)}),userAction:'LIVE_CAPITAL_UPDATE'},fingerprint=JSON.stringify(body),idempotencyKey=requestKeys.get(fingerprint)??crypto.randomUUID();requestKeys.set(fingerprint,idempotencyKey);await callAutomation((path,body)=>submitFunding(hooks.request,path,body),'automation.trading.capital.update',{...body,idempotencyKey});requestKeys.delete(fingerprint);if(current(scope)){capitalEdit=null;hooks.close?.();await Promise.all([load({force:true}),hooks.loadActivity?.({force:true})]);hooks.toast?.('운용 금액을 반영했습니다.');}
   }else if(kind==='prepare'){
    for(const [key,label] of [['capitalLimit','총 운용 한도'],['perOrderLimit','1회 주문 한도'],['dailyLossLimit','일 손실 한도']]){
     const value=key==='perOrderLimit'&&form.dataset.autoCapitalOrder==='true'?values.capitalLimit:values[key];
     if(!/^(?=.*[1-9])\d+(?:\.\d{1,18})?$/.test(value??''))throw new Error(label+'를 0보다 큰 금액으로 입력하세요.');
    }

    if(!Number.isSafeInteger(Number(values.maxTradesPerDay??0))||Number(values.maxTradesPerDay??0)<0){const advanced=form.querySelector('[data-auto-advanced]');if(advanced)advanced.open=true;focusAfter=form.querySelector('[name="maxTradesPerDay"]');throw new Error('매수 횟수를 확인하세요. 0은 제한 없이 운용합니다.');}
    const body={profileId:context().profileId,capitalLimit:values.capitalLimit,perOrderLimit:form.dataset.autoCapitalOrder==='true'?values.capitalLimit:values.perOrderLimit,dailyLossLimit:values.dailyLossLimit,maxTradesPerDay:Number(values.maxTradesPerDay??0),minIntervalMs:Number(values.minIntervalSeconds)*1000,maxJevCallsPerDay:Number(values.maxJevCallsPerDay),...operationWindowValues(values)},fingerprint=JSON.stringify(body),idempotencyKey=requestKeys.get(fingerprint)??crypto.randomUUID();requestKeys.set(fingerprint,idempotencyKey);
    const value=await callAutomation(hooks.request,'automation.trading.prepare',{...body,idempotencyKey});requestKeys.delete(fingerprint);
    if(current(scope)&&(dialogToken===undefined||dialogToken===hooks.getDialogToken?.())){preview={...value.preview,canActivate:value.canActivate};previewScope=scope;pending=false;review();}
   }else if(kind==='activate'){
    const p=preview;if(!p||previewScope!==scope||!p.canActivate||!p.id||!p.previewHash||!p.nonce)throw new Error('운용 설정을 다시 검토하세요.');if(values.confirmed!=='on')throw new Error('실전 자동 주문의 금액과 한도를 확인하세요.');
    // One explicit submission consumes the reviewed capability; no polling path calls activation.
    preview=null;await callAutomation(hooks.request,'automation.trading.activate',{previewId:p.id,previewHash:p.previewHash,nonce:p.nonce,userAction:'LIVE_AUTOMATION_ACTIVATION'});
    if(current(scope)){if(dialogToken===undefined||dialogToken===hooks.getDialogToken?.())hooks.close?.();await Promise.all([load({force:true}),hooks.loadActivity?.({force:true})]);hooks.toast?.('자동 운용을 시작했습니다.');}
   }
  }catch(problem){if(form.isConnected!==false)errorNode.textContent=problem.message;else hooks.toast?.(problem.message);}
  finally{pending=false;for(const {control,disabled}of controls)if(control.isConnected!==false)control.disabled=disabled;focusAfter?.focus?.();redraw();}
 }
 function destroy(){disposed=true;generation++;preview=null;data=null;knownExistingProfile=null;}
 return {load,render,click,submit,destroy,openSettings:()=>settings(),openConfigure:configure,state:()=>({loading,pending,error,scope:key,data,preview})};
}
import {EXCHANGE_CONNECTION_RECOVERY,EXCHANGE_DATA_RECOVERY} from '../system/automation-contracts.mjs';
