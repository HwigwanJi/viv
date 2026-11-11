import {tradeFillSummary,tradePrice} from './trade-fill-summary.mjs';
import {currencyAmount} from './currency-format.mjs';
import {renderMindHud} from './mind-hud.mjs';
import {cardGame} from '../domain/mind-game.mjs';
import {helpTooltip,tooltipPosition} from './help-tooltip.mjs';
import {numberToken,pixelToken} from './design-tokens.mjs';
import {operationWindowState} from '../domain/operation-window.mjs';

const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const list=value=>Array.isArray(value)?value:[];
export function marketScopeLabel(markets){const ids=list(markets);return ids.length>3?ids.length+'개 종목 · '+ids.slice(0,2).join(', ')+' 외 '+(ids.length-2)+'개':ids.join(' · ');}
export const marketScopeMarkup=markets=>list(markets).length>3?'<details class="studio-universe-summary"><summary>'+esc(marketScopeLabel(markets))+' <span>전체 목록</span></summary><p>'+esc(markets.join(' · '))+'</p></details>':esc(marketScopeLabel(markets)||'—');
const activeStatuses=new Set(['ENABLED','RUNNING','PENDING_FUNDING','FUNDING_PENDING','ACTION_REQUIRED']);
const numeric=value=>value!==null&&value!==undefined&&value!==''&&Number.isFinite(Number(value));
const positive=value=>numeric(value)&&Number(value)>0;
const quantity=value=>numeric(value)?new Intl.NumberFormat('ko-KR',{maximumSignificantDigits:15}).format(Number(value)):'—';
const time=value=>value&&Number.isFinite(Date.parse(value))?new Date(value).toLocaleString('ko-KR',{timeZone:'Asia/Seoul',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false})+' KST':'시각 미기록';
const activityDayFormat=new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',year:'numeric',month:'long',day:'numeric'});
const activityDay=value=>value&&Number.isFinite(Date.parse(value))?activityDayFormat.format(new Date(value)):'시각 미기록';
const money=(value,currency)=>numeric(value)?currency==='KRW'?new Intl.NumberFormat('ko-KR',{maximumFractionDigits:2}).format(Number(value))+'원':currencyAmount(Number(value),currency)+' '+esc(currency):'—';
const amount=(value,currency)=>'<span title="'+esc(numeric(value)?value+' '+currency:'금액 미기록')+'">'+money(value,currency)+'</span>';
const stateLabel=value=>({ENABLED:'자동 운용 중',RUNNING:'자동 운용 중',PAUSED:'일시중지',STOPPED:'중지',ACTION_REQUIRED:'확인 필요',PENDING_FUNDING:'거래 자금 준비 중',FUNDING_PENDING:'거래 자금 준비 중',FILLED:'체결 완료',PARTIALLY_FILLED:'부분 체결',PARTIAL:'부분 체결',CANCELLED_BEFORE_SEND:'전송 전 취소',CANCELLED:'취소',CANCELED:'취소',REJECTED:'주문 거절',UNKNOWN:'결과 확인 필요',RESPONSE_REVIEW_REQUIRED:'응답 확인 필요',RESERVED:'전송 준비',PENDING:'접수 확인 중',OPEN:'미체결'})[value]??'상태 확인';
const nodeState=value=>({done:'완료',skipped:'건너뜀',omitted:'입력 생략',blocked:'진행 차단',waiting:'응답 대기',queued:'처리 대기',error:'오류',unknown:'응답 확인 필요',idle:'미실행'})[value]??'상태 확인';
const runtimeLabels={PORTFOLIO_WAIT_RESEARCH:'설정한 주기에 종목과 현금 비중을 다시 계산합니다.',PORTFOLIO_TARGET_MANAGED:'현금과 종목별 목표 비중을 관리하고 있어요',PORTFOLIO_MANAGING:'매도 체결 후 공용 현금으로 목표 종목을 배분해요',PORTFOLIO_RECONCILING:'다음 종목 주문 전에 체결 결과를 대조하고 있어요',PORTFOLIO_REEVALUATE:'새 확정 시간봉으로 목표 비중을 다시 계산해요',PROGRAM_ACTIVE:'선택한 전략·묶음 운용 중',ACTIVE:'선택한 전략·묶음 운용 중',DRAINING:'이전 묶음 청산·대사 후 전환 준비',WAIT_CLASSIFICATION:'라우터의 자료·판단 대기',CLASSIFICATION_DUE:'연결 자료로 실행 전략 재판단 중',PROGRAM_DRAIN_WAIT_ORDERS:'묶음 전환 전 미확정 주문 확인 중',FIVE_MINUTE_INPUT_WARMUP:'5분 연속 체결·호가 수집 중',CASH_NO_PULLBACK_CANDIDATE:'급등·눌림 동시 충족 후보 대기',HOURLY_SCREEN_WAITING_ENTRY:'정시 이후 3분 진입 준비 대기',HOLD_POSITION:'보유 중 · 익절과 시간 청산 관찰',HOURLY_INPUT_REQUIRED:'판단 입력 확인 필요',HOURLY_VALUE_WAITING_REJECTED_EXIT:'새 진입은 거절하고 기존 보유의 청산 준비 시각을 기다려요',WAIT_NEXT_HOURLY_SIGNAL:'다음 시간봉 판단을 기다리고 있어요',HOURLY_VALUE_WAITING_REVIEW:'선택 종목의 첫 분봉을 재평가하고 있어요',HOURLY_VALUE_WAITING_ENTRY:'가격 재평가를 마치고 진입 준비 시각을 기다려요',HOURLY_REVIEW_UNAVAILABLE:'선택 종목의 지정 분봉 자료를 기다리고 있어요',HOURLY_CAPTURE_TOO_LATE:'다음 시간봉부터 순서대로 판단을 시작해요',HOURLY_VALUE_REJECTED:'재평가 가격에서 비용을 넘는 기회를 기다려요',HOURLY_VALUE_STALE:'계좌 변경 후 다음 시간봉 판단을 기다려요',HOURLY_ORDER_UNFILLED:'다음 관측 호가에서 체결 조건을 다시 확인해요',HOURLY_ROTATION_PENDING:'남은 종목 교체 단계를 이어가고 있어요',WAITING_START:'예약한 시작 시각을 기다리고 있습니다.',PERIOD_ENDED:'설정한 종료 시각에 운용을 멈췄습니다. 보유와 원장은 유지됩니다.',STRATEGY_UPDATE_PENDING:'저장한 전략을 반영하고 있어요',STRATEGY_UPDATE_WAIT_ORDERS:'체결 대사 후 저장한 전략을 반영해요',CREATED:'첫 판단 대기',QUANT_ENTRY_NOT_ELIGIBLE:'진입 조건을 기다리고 있어요',WAIT_NEXT_CLOSED_BAR:'다음 확정 봉을 기다리고 있어요',WAIT_NEXT_JEV_BAR:'다음 판단을 기다리고 있어요',HOLD_PROTECTION:'보유 자산의 보호 조건을 살피고 있어요',PROTECTION_HOLD:'보유 자산의 보호 조건을 살피고 있어요',HOLD:'현재 비중을 유지해요',MISSING_INPUT:'판단 자료를 확인해 주세요',DECISION_EXPIRED:'새로운 판단을 기다리고 있어요',ORDER_RECONCILING:'체결 결과를 확인하고 있어요',ORDER_FILLED:'주문 체결을 확인했어요',ORDER_PARTIALLY_FILLED:'일부 체결 · 남은 수량 확인 중',ORDER_UNKNOWN:'주문 결과를 확인해 주세요',JEV_STARTED:'판단 중이에요',JEV_OUTCOME_UNKNOWN:'판단 응답을 확인해 주세요',FUNDING_RECONCILING:'거래 자금을 준비하고 있어요',FUNDING_SUBMITTED:'거래 자금을 준비하고 있어요',RUNTIME_PAUSED_ENTRIES:'새 진입이 중지돼 있어요'};

/** An activation is one ledger. Never merge old activations into the current one. */
export function selectMindActivity(items,profileId){
 return list(items).filter(item=>!profileId||item.profileId===profileId).slice().sort((a,b)=>Number(activeStatuses.has(b.status))-Number(activeStatuses.has(a.status))||String(b.userConfirmedAt??b.createdAt??'').localeCompare(String(a.userConfirmedAt??a.createdAt??'')))[0]??null;
}

/** Only the server's verified saved trace can provide a path; status alone cannot. */
export function mindActivityTrace(item){
 const trace=item?.lastDecision?.trace,graph=item?.lastDecision?.graph??item?.graph,manifest=item?.lastDecision?.manifest??item?.manifest;
 if(trace?.status!=='VERIFIED'||!graph||trace.graphHash!==graph.graphHash||manifest?.graphHash!==graph.graphHash)return null;
 const graphNodes=new Map(list(graph.nodes).map(node=>[node.id,node])),nodes=list(trace.nodes),ids=list(trace.nodeIds),edges=new Map(list(graph.edges).map(edge=>[edge.id,edge]));
 if(!nodes.length||nodes.length!==ids.length||new Set(ids).size!==ids.length||nodes.some((node,index)=>node.id!==ids[index]||!graphNodes.has(node.id))||list(trace.edgeIds).some(id=>!edges.has(id)))return null;
 const members=new Set(ids),selected=list(trace.edgeIds).map(id=>edges.get(id));
 if(selected.some(edge=>!members.has(edge.from.nodeId)||!members.has(edge.to.nodeId)))return null;
 return {asOf:trace.asOf??item.lastDecision.at,evaluationHash:trace.evaluationHash??null,nodes:nodes.map(node=>({...node,label:node.label||graphNodes.get(node.id).label||node.id})),edges:selected,graphHash:trace.graphHash};
}

export function mindActivityExecution(item){
 const graph=item?.graph,active=item?.runtime?.execution;
 if(active?.contractVersion==='mind-execution-observation-v1'&&active.graphHash===graph?.graphHash&&graph?.nodes.some(n=>n.id===active.activeNodeId))return {phase:active.phase,sequence:active.executionId,observation:active};
 const trace=mindActivityTrace(item),current=trace?.graphHash===graph?.graphHash;
 return {phase:current?'COMPLETED':'IDLE',sequence:item?.lastDecision?.id??null,observation:{contractVersion:'mind-execution-observation-v1',graphHash:graph?.graphHash,asOf:current?trace.asOf:null,activeNodeId:null,nodes:current?trace.nodes.map(n=>({id:n.id,state:n.state})):[],edgeIds:current?trace.edges.map(e=>e.id):[]}};
}

export function mindActivityModel(item,{now=new Date().toISOString()}={}){
 const ledger=item?.ledger,held=list(ledger?.positions).filter(position=>positive(position.quantity)),decision=item?.lastDecision,trace=mindActivityTrace(item),runtime=item?.runtime,state=activeStatuses.has(item?.status)&&item?.config&&operationWindowState(item.config,now)!=='ACTIVE'?(operationWindowState(item.config,now)==='ENDED'?'PERIOD_ENDED':'WAITING_START'):runtime?.state??runtime?.lastState,action=['buy','sell','hold'].includes(decision?.action)?decision.action:null;
 const connectionWait=state===EXCHANGE_CONNECTION_RECOVERY.state&&EXCHANGE_CONNECTION_RECOVERY.codes.includes(runtime?.errorCode??runtime?.lastError?.code),marketWait=connectionWait||state===EXCHANGE_DATA_RECOVERY.state&&EXCHANGE_DATA_RECOVERY.codes.includes(runtime?.errorCode);
 const failure=Boolean(!marketWait&&(runtime?.errorCode||runtime?.lastError)||item?.status==='ACTION_REQUIRED'||['BLOCKED','MISSING_INPUT','ORDER_UNKNOWN','JEV_OUTCOME_UNKNOWN'].includes(state)),paused=['PAUSED','STOPPED'].includes(item?.status),funding=['PENDING_FUNDING','FUNDING_PENDING'].includes(item?.status)||ledger?.status==='FUNDING_PENDING';
 let tone='wait',headline='첫 판단을 기다려요',phase='observing';
 if(!item){headline='운용을 준비해 볼까요';phase='sleep';}
 else if(state==='WAITING_START'){headline='예약한 시작을 기다려요';phase='sleep';}
 else if(state==='PERIOD_ENDED'){headline='운용 기간이 종료됐어요';tone='paused';phase='sleep';}
 else if(paused){headline='운용을 쉬고 있어요';tone='paused';phase='sleep';}
 else if(runtime?.hostStatus==='DISABLED'){headline='주문 실행 서버 중지';tone='paused';phase='sleep';}
 else if(failure){headline='확인이 필요해요';tone='attention';phase='attention';}
 else if(marketWait){headline=connectionWait?'거래소 연결 대기':'시세 재조회 중';}
 else if(funding){headline='거래 자금 준비 중';}
 else if(action==='sell'){headline='매도 판단';tone='sell';phase=held.length?'investing':'idle';}
 else if(held.length){headline='보유 중';tone='hold';phase='investing';}
 else if(action==='buy'){headline='매수 판단';tone='buy';phase='observing';}
 else if(state==='PORTFOLIO_WAIT_RESEARCH'){headline='다음 포트폴리오 판단 대기';}
 else if(state==='PORTFOLIO_TARGET_MANAGED'){headline='현금을 보유하며 기회를 비교해요';}
 else if(action==='hold'||['HOLD','QUANT_ENTRY_NOT_ELIGIBLE'].includes(state)){headline='기회를 기다려요';}
 return {tone,headline,phase,action,held,trace,market:list(item?.marketIds).join(' · '),marketSummary:marketScopeLabel(item?.marketIds),status:state==='WAITING_START'?'시작 예약':state==='PERIOD_ENDED'?'기간 종료':runtime?.hostStatus==='DISABLED'&&activeStatuses.has(item?.status)?'실행 서버 중지':failure&&!paused?'운용 확인 필요':marketWait&&!paused?(connectionWait?'거래소 연결 대기':'시세 재조회 중'):item?stateLabel(item.status):'시작 전',runtime:paused?'자동 매매가 중지돼 있습니다. 금액과 한도를 확인하고 운용을 재개할 수 있어요.':runtime?.hostStatus==='DISABLED'?'저장된 운용 설정은 유지되며 현재 서버의 자동 주문 실행은 중지돼 있습니다':failure?(state==='BLOCKED'?'운용 자료와 연결을 확인한 뒤 새로고침해 주세요':'운용 상태를 확인해 주세요'):marketWait?(connectionWait?'거래소 연결을 30초마다 확인합니다. 연결 복구 후 기존 설정으로 판단을 이어갑니다.':runtime?.errorCode==='SCALP_PUBLIC_HTTP_429'?'거래소 조회 한도로 잠시 대기 후 자동 재시도합니다. 기존 운용 설정은 유지됩니다.':'최신 호가가 수신되면 기존 설정으로 판단을 이어갑니다.'):runtimeLabels[state]??(held.length?'보유 자산을 살피고 있어요':decision?'최근 판단을 확인했어요':state?'운용 상태 확인':'첫 판단 대기'),decisionAt:action?decision.at:null,currency:item?.quoteCurrency??ledger?.quoteCurrency??'—'};
}

const expertLabel={TREND:'추세',BREAKOUT:'돌파',RECOVERY:'회복',BTC_HOLD:'BTC 보유',CASH:'현금',NEWS:'뉴스'};
function branchLabel(node,trace){
 if(node.learning)return '유사 국면 '+node.learning.horizon+' 비용 후 추정 · '+node.learning.experts.map(e=>(expertLabel[e.mode]??e.mode??'이름 미기록')+' '+(100*Math.expm1(e.netLogReturn)).toFixed(2)+'%').join(' · ');
 const scalar=value=>typeof value==='boolean'?(value?'충족':'미충족'):typeof value==='number'&&Number.isFinite(value)?String(value):typeof value==='string'?value:null;
 const selected=trace.nodes.find(candidate=>candidate.id===node.selectedNodeId),port=node.selectedPort==='true'?'충족':node.selectedPort==='false'?'미충족':node.selectedPort,actual=scalar(node.actual),threshold=scalar(node.threshold),value=scalar(node.value),parts=[selected?'선택: '+selected.label:null,port?'분기: '+port:null,typeof node.condition==='boolean'?'조건 '+(node.condition?'충족':'미충족'):null,actual!==null?'관측 '+actual:null,threshold!==null?'기준 '+threshold:null,actual===null&&value!==null?'결과 '+value:null];
 return parts.filter(Boolean).join(' · ');
}
function stepSummary(node,trace){
 if(node.learning)return node.learning.experts.map(e=>(expertLabel[e.mode]??e.mode??'이름 미기록')+' '+(100*e.allocation).toFixed(1)+'%').join(' · ');
 const selected=trace.nodes.find(candidate=>candidate.id===node.selectedNodeId);
 if(typeof node.value==='boolean')return '조건 '+(node.value?'충족':'미충족');
 if(typeof node.condition==='boolean')return '조건 '+(node.condition?'충족':'미충족');
 if(selected)return '선택: '+selected.label;
 return nodeState(node.state);
}

export function renderMindActivityPreview(item,{id='mind-path-'+encodeURIComponent(item?.activationId??'empty'),label='판단 경로',passive=false,historical=false}={}){
 const trace=mindActivityTrace(item),title=trace?(historical?'당시 판단 경로':'최근 판단 경로'):'판단 경로 없음';
 const signature=JSON.stringify([item?.profileId??null,item?.activationId??item?.accountId??null,item?.lastDecision?.id??null,item?.lastDecision?.at??null,item?.lastDecision?.trace?.status??null,trace]);
 const attributes='data-mind-path-trigger data-mind-path-signature="'+esc(signature)+'" aria-controls="'+esc(id)+'" aria-expanded="false" aria-haspopup="dialog"'+(!historical&&!passive&&item?.profileId?' data-studio-action="mind-execution" data-studio-id="'+esc(item.profileId)+'"':'');
 const trigger=passive?'<span '+attributes+' data-mind-path-passive>'+esc(label)+'</span>':'<button type="button" class="mind-path-trigger" '+attributes+'>'+esc(label)+'<span aria-hidden="true"> ↗</span></button>';
 const steps=trace?trace.nodes.map((node,index)=>'<li data-mind-path-step="'+index+'" data-node-id="'+esc(node.id)+'" data-node-state="'+esc(node.state)+'"'+(trace.edges.some(edge=>edge.from.nodeId===node.id&&edge.to.nodeId===trace.nodes[index+1]?.id)?' data-linked-next':'')+'><span class="mind-path-light" aria-hidden="true"></span><span class="mind-path-step-name" title="'+esc(node.label)+'">'+esc(node.label)+'</span><small title="'+esc(branchLabel(node,trace))+'">'+esc(stepSummary(node,trace))+'</small></li>').join(''):'';
 const original=trace?'<details class="mind-path-all"><summary>전체 '+trace.nodes.length+'개 부품 보기</summary><ol>'+trace.nodes.map(node=>'<li><strong>'+esc(node.label)+'</strong><small>'+esc([nodeState(node.state),branchLabel(node,trace)].filter(Boolean).join(' · '))+'</small></li>').join('')+'</ol><p>선택된 연결 '+trace.edges.length+'개</p><ul>'+trace.edges.map(edge=>'<li>'+esc(trace.nodes.find(node=>node.id===edge.from.nodeId)?.label)+' → '+esc(trace.nodes.find(node=>node.id===edge.to.nodeId)?.label)+'</li>').join('')+'</ul></details>':'';
 const source=item?.lastDecision?.manifest??item?.manifest,edit=trace&&item?.profileId&&source?.id&&/^[a-f0-9]{64}$/.test(source.hash??'')?'<div class="actions"><button type="button" class="button small primary" data-studio-action="activity-strategy-draft" data-studio-id="'+esc(item.profileId)+'" data-studio-manifest-id="'+esc(source.id)+'" data-studio-manifest-hash="'+esc(source.hash)+'" data-studio-graph-hash="'+esc(trace.graphHash)+'" title="당시 고정 정책'+(source.version?' v'+esc(source.version):'')+'에서 새 초안을 엽니다.">이 전략 노드 편집</button></div>':'';
 // Template keeps the interactive rich card outside the enclosing companion link.
 return trigger+'<template id="'+esc(id)+'-template"><section id="'+esc(id)+'" class="mind-path-popover" data-mind-path-popover role="dialog" aria-label="'+title+'" tabindex="-1" popover="manual"><header><div><strong>'+title+'</strong>'+(trace?'<small>'+esc(time(trace.asOf))+' · '+(historical?'당시 저장된 판단':'마지막 완료 판단')+'</small>':'')+'</div><button type="button" class="mind-path-close" data-mind-path-close aria-label="판단 경로 닫기">×</button></header>'+(trace?'<p class="mind-path-caption">완료된 처리 순서 <span data-mind-path-progress>'+trace.nodes.length+'</span></p><ol class="mind-path-steps">'+steps+'</ol>'+edit+original:'<p>이 판단의 확인된 경로가 저장되지 않았습니다.</p>')+'</section></template>';
}

export function renderMindActivityHero(item,{idPrefix='operation',profileId=null,controls='',statusDetails='',avatarConfig=null,loading=false,unavailable=false,executionMode='paper'}={}){
 const model=mindActivityModel(item),ledger=item?.ledger,currency=model.currency,decision=item?.lastDecision,holding=model.held.map(position=>position.asset+' '+quantity(position.quantity)).join(' · '),matchedOrder=decision?.order;
 if(loading){model.headline='운용 상태를 불러오는 중';model.runtime='저장된 판단과 자금을 확인하고 있어요';model.phase='idle';model.status='조회 중';}
 if(unavailable&&item){model.headline='최근 상태를 확인해 주세요';model.runtime='저장된 상태 · '+model.status+'. 최근 활동을 다시 불러오세요.';model.phase='attention';model.status='최근 상태 조회 실패';model.tone='attention';}
 if(unavailable&&!item){model.headline='운용 기록을 확인해 주세요';model.runtime='최근 활동을 다시 불러올 수 있어요';model.phase='attention';model.status='확인 필요';}
 const managed=controls.includes('data-operation-actions');
 const mode=item?.activationId?'live':executionMode;
 const card={profileId:item?.profileId??profileId??idPrefix,phase:model.phase,executionMode:mode,appearance:{config:avatarConfig},holdings:{hasHoldings:model.held.length>0},automation:{enabled:activeStatuses.has(item?.status),requiresAttention:model.tone==='attention'},[mode==='live'?'liveActivity':'paperActivity']:item};card.game=cardGame(card,{asOf:new Date().toISOString()});
 const period=item?.graph?.timeframeParameter?.value,periodLabel=({'1m':'1분','3m':'3분','5m':'5분','1h':'1시간','4h':'4시간','1d':'하루'})[period]??period;
 const periodControl=period&&item?.profileId?'<button type="button" class="mind-path-trigger" data-studio-action="strategy-parameter" data-studio-id="'+esc(item.profileId)+'" aria-label="판단 주기 '+esc(periodLabel)+' 편집">'+esc(periodLabel)+'마다 판단 <span aria-hidden="true">↗</span></button>':'';
 const fill=matchedOrder?' · '+stateLabel(matchedOrder.state)+(positive(matchedOrder.filledQuantity)?' '+quantity(matchedOrder.filledQuantity):''):'';
 return '<section class="mind-operation" data-context-entity="operation" data-context-id="'+esc(item?.activationId??item?.id??profileId??'current')+'" data-mind-operation data-tone="'+model.tone+'"'+(managed?' data-managed-controls':'')+'><header class="mind-operation-bar"><div class="mind-operation-state"><h3>운용 상태</h3><span class="mind-operation-status" data-active="'+(activeStatuses.has(item?.status)&&!loading&&!unavailable&&!["attention","paused"].includes(model.tone))+'" role="status"><span class="operation-status-dot" aria-hidden="true"></span>'+esc(model.status)+'</span>'+'<p class="mind-operation-context">'+esc(model.runtime)+'</p>'+statusDetails+'</div>'+(controls?'<div class="mind-operation-controls" aria-label="운용 제어">'+controls+'</div>':'')+'</header><div class="mind-operation-main"'+(loading?' aria-busy="true"':'')+'><dl class="mind-operation-amounts"><div><dt>운용 자금'+helpTooltip('운용 자금','이 운용에 정한 자금 한도입니다. 전체 거래소 계좌 잔고와 구분합니다.',{id:idPrefix+'-capital-help'})+'</dt><dd>'+amount(ledger?.initialCapital,currency)+'</dd></div><div><dt>투자 중'+helpTooltip('투자 중','보유 자산의 매수 원가입니다. 시세 평가액은 계좌 상세에서 확인할 수 있습니다.',{id:idPrefix+'-invested-help'})+'</dt><dd>'+amount(ledger?.ownedCostBasis,currency)+'</dd></div><div><dt>실현 손익'+helpTooltip('실현 손익','매도 체결을 통해 확정된 손익입니다. 거래 자금 전환과 보유 평가액은 별도 항목으로 기록합니다.',{id:idPrefix+'-pnl-help'})+'</dt><dd>'+amount(ledger?.realizedPnl,currency)+'</dd></div></dl><div class="mind-operation-identity" title="'+esc(model.market)+'">'+renderMindHud(card,{variant:'operation',caption:{market:model.marketSummary||'나의 마인드',title:model.headline,detail:null}})+'</div><div class="mind-operation-receipt">'+(model.decisionAt?'<span>'+esc(({buy:'최근 매수 판단',sell:'최근 매도 판단',hold:'최근 관망'})[model.action]??'최근 판단')+' · '+esc(time(model.decisionAt))+esc(fill)+'</span>':'<span>'+esc(model.tone==='paused'?'보유 자산과 과거 체결 기록은 유지됩니다.':loading?'운용 상태와 원장을 확인하고 있습니다.':unavailable?'다시 조회해 현재 상태를 확인하세요.':item?'저장된 판단을 기다리고 있습니다.':'금액과 한도를 설정하면 시작할 수 있어요.')+'</span>')+(loading||!item?'':renderMindActivityPreview(item,{id:idPrefix+'-path'})+periodControl)+'</div>'+(holding?'<p class="mind-operation-held" title="'+esc(holding)+'">보유 · '+esc(holding)+'</p>':'')+'</div></section>';
}

export function activityNotificationTarget(item,record){
 if(item?.activationId)return 'data-auto-action="'+(record?.kind==='RUNTIME'?'history-settings':'orders')+'" data-auto-id="'+esc(item.activationId)+'"'+(record?.kind==='STRATEGY_ORDER'&&record.id?' data-auto-order-identifier="'+esc(record.id)+'"':'');
 if(item?.id?.startsWith('event-paper-'))return 'data-event-paper-action="'+(record?.kind==='RUNTIME'?'settings':'records')+'" data-event-paper-id="'+esc(item.id)+'"';
 if(record?.kind==='RUNTIME')return 'data-studio-action="mind-automation" data-studio-id="'+esc(item?.profileId??'')+'"';
 const run=record?.kind==='DECISION'?record.id:record?.decision?.id;
 if(run?.startsWith('mind-run-'))return 'data-studio-action="decision" data-studio-id="'+esc(run)+'"';
 return 'data-studio-action="mind-view" data-studio-view="records" data-studio-id="'+esc(item?.profileId??'')+'"';
}
export function filterMindActivityRecords(records,{decisions=false,search=''}={}){
 const normalize=value=>String(value??'').normalize('NFKC').toLocaleLowerCase(),terms=normalize(search).trim().split(/\s+/).filter(Boolean);
 return list(records).filter(record=>decisions?record.kind==='DECISION':['STRATEGY_ORDER','FUNDING'].includes(record.kind)).filter(record=>{const text=normalize([record.market,record.action,({buy:'매수',sell:'매도',hold:'관망 유지'})[record.action],record.state,stateLabel(record.state),record.id,time(record.at)].filter(Boolean).join(' '));return terms.every(term=>text.includes(term));});
}
export function activityFeedKind(value){return ['STRATEGY_ORDER','DECISION','FUNDING'].includes(value)?value:'all';}

function feedHeading(rows,{heading,profileId,executionMode,showDecisions,showAll,labelledBy}){
 const kinds=[['STRATEGY_ORDER','거래'],['DECISION','판단'],['FUNDING','자금 전환']].filter(([kind])=>rows.some(row=>row.kind===kind));
 const filter=!showDecisions&&kinds.length>1?'<label class="mind-activity-filter"><span class="sr-only">활동 종류</span><select data-activity-filter aria-label="활동 종류"><option value="all">전체 활동</option>'+kinds.map(([kind,label])=>'<option value="'+kind+'">'+label+'</option>').join('')+'</select></label>':'';
 const href='#minds?'+new URLSearchParams({profileId,executionMode,view:'records',kind:showDecisions?'decisions':'fills'});
 const content=(labelledBy?'':'<h3>'+esc(heading)+'</h3>')+filter+(showAll&&!showDecisions&&profileId?'<a href="'+esc(href)+'" data-studio-route>전체 기록 <span aria-hidden="true">↗</span></a>':'');
 return content?'<header class="mind-activity-head">'+content+'</header>':'';
}
export function renderMindActivityFeed(item,{limit,showDecisions=false,collapseHolds=true,includeLatestDecision=true,profileId=item?.profileId,executionMode=item?.executionMode??'paper',showRuntimeNotice=true,title,labelledBy}={}){
 const records=list(item?.recentActivity),orders=records.filter(record=>record.kind==='STRATEGY_ORDER'),transactions=records.filter(record=>record.kind==='STRATEGY_ORDER'||record.kind==='FUNDING'),linked=new Set(orders.map(record=>record.decision?.id).filter(Boolean));
 const decisions=records.filter(record=>record.kind==='DECISION'),unlinked=decisions.filter(record=>!linked.has(record.id)&&!orders.some(order=>order.id===record.order?.id)),latestHold=unlinked.find(record=>record.action==='hold');
 // Keep actual trading visible even when minute-by-minute HOLDs are newer.
 const rows=(showDecisions?[...decisions]:[...transactions,...(includeLatestDecision&&(latestHold??unlinked[0])?[latestHold??unlinked[0]]:[])]).sort((a,b)=>(Date.parse(b.at)-Date.parse(a.at))||0).slice(0,limit??(showDecisions?Infinity:6)),heading=title??(showDecisions?'판단 기록':includeLatestDecision?'최근 활동':'매매 기록');
 if(!rows.length&&!showDecisions&&includeLatestDecision)return '';
 if(!rows.length)return '<section class="mind-activity-feed"'+(labelledBy?' aria-labelledby="'+esc(labelledBy)+'"':'')+'>'+(labelledBy?'':'<h3>'+esc(heading)+'</h3>')+'<p class="empty">'+(showDecisions?'아직 저장된 판단이 없습니다.':includeLatestDecision?'기록이 생기면 이곳에서 확인할 수 있어요.':'아직 주문·체결이나 자금 전환 기록이 없습니다.')+'</p></section>';
 const label=labelledBy?' aria-labelledby="'+esc(labelledBy)+'"':' aria-label="'+esc(heading)+'"';
 const model=mindActivityModel(item),attention=showRuntimeNotice&&includeLatestDecision&&!showDecisions&&['attention','paused'].includes(model.tone)?'<li data-context-entity="activity" data-context-id="'+esc((item?.activationId??profileId)+':runtime')+'" data-tone="wait"><button type="button" class="mind-notification-cta" data-notification-cta '+activityNotificationTarget(item,{kind:'RUNTIME'})+'><strong>'+esc(model.headline)+'</strong><small>'+esc(model.runtime)+'</small><span class="mind-notification-next">운용 상태 열기 →</span></button></li>':'';
 let currentDayGroup=0;
 const renderRow=record=>{
  const funding=record.kind==='FUNDING',order=record.kind==='STRATEGY_ORDER',filled=order&&positive(record.filledQuantity),tone=!funding&&record.action==='buy'?'buy':!funding&&record.action==='sell'?'sell':'wait',action=({buy:'매수',sell:'매도',hold:'관망'})[record.action]??'판단 기록';
  const heading=funding?'거래 자금 전환':order?action+' · '+(record.executionMode==='paper'||item?.executionMode==='paper'?'모의 ':'')+stateLabel(record.state):({buy:'매수 판단',sell:'매도 판단',hold:'관망 판단'})[record.action]??'저장된 판단';
  const receipt=order?tradeFillSummary(record):null,currency=record.quoteCurrency??item?.quoteCurrency??record.market?.split('-')[0]??'—',asset=record.market?.split('-').slice(1).join('-')||'';
  const facts=funding?stateLabel(record.state)+(positive(record.filledQuantity)?' · '+quantity(record.filledQuantity)+' BTC':''):order?(filled?'체결 '+quantity(record.filledQuantity)+(asset?' '+asset:''):'체결 기록 없음'):numeric(record.targetWeight)?'목표 비중 '+quantity(Number(record.targetWeight)*100)+'%':'';
  const decision=record.kind==='DECISION'?record:order?(record.decision??records.find(candidate=>candidate.kind==='DECISION'&&candidate.order?.id===record.id)):null,pathId='activity-'+encodeURIComponent(item?.activationId??item?.accountId??item?.profileId??'mind')+'-'+encodeURIComponent(record.id??record.at??'record')+'-path';
  const judgement=record.kind==='DECISION',preview=decision?renderMindActivityPreview({...item,lastDecision:decision},{id:pathId,historical:true,label:judgement?heading:'판단 경로'}):'';
  const details=[record.market,facts].filter(Boolean).join(' · ');
  const priceLabel=record.action==='buy'?'평균 매수가':record.action==='sell'?'평균 매도가':'평균 체결가',receiptMarkup=order&&filled?'<dl class="mind-trade-receipt"><div class="mind-trade-price"><dt>'+priceLabel+'</dt><dd>'+(receipt.averagePrice!==null?tradePrice(receipt.averagePrice,currency)+' '+esc(currency):'체결가 미확인')+'</dd></div><div><dt>체결 금액</dt><dd>'+money(receipt.gross,currency)+'</dd></div><div><dt>수수료</dt><dd>'+money(receipt.fee,currency)+'</dd></div></dl>':'';
  const primary=judgement?'<div class="mind-decision-record">'+preview+(details?'<small>'+esc(details)+'</small>':'')+'</div>':'<button type="button" class="mind-notification-cta" data-notification-cta '+activityNotificationTarget(item,record)+'><strong>'+esc(heading)+'</strong>'+(details?'<small>'+esc(details)+'</small>':'')+'<span class="mind-notification-next">체결 원장 보기 →</span></button>'+receiptMarkup+preview;
  return '<li data-context-entity="activity" data-context-id="'+esc(pathId)+'" data-activity-kind="'+esc(record.kind)+'" data-activity-day="'+esc(activityDay(record.at))+'" data-activity-day-group="'+currentDayGroup+'" data-tone="'+tone+'"'+(decision?' data-mind-activity-card':'')+'><span class="mind-activity-icon" aria-hidden="true">'+(funding?'⇄':tone==='buy'?'↗':tone==='sell'?'↘':'·')+'</span><div>'+primary+'</div><time'+(record.at&&Number.isFinite(Date.parse(record.at))?' datetime="'+esc(record.at)+'"':'')+'>'+esc(time(record.at))+'</time></li>';
 };
 const holdKey=record=>record?.kind==='DECISION'&&record.action==='hold'&&numeric(record.targetWeight)&&Number.isFinite(Date.parse(record.at))&&mindActivityTrace({...item,lastDecision:record})&&!record.order&&!record.errorCode&&!list(record.reasonCodes).length&&(!record.state||record.state==='COMPLETED')&&(!record.executionStatus||record.executionStatus==='COMPLETED')?JSON.stringify([record.market??null,Number(record.targetWeight),record.state??null,record.intent??null,record.orderAllowed??null,record.manifest?.hash??null,record.trace.graphHash??null]):null;
 let content='',folded=false,currentDay='';const groupedDays=new Set(rows.map(record=>activityDay(record.at))).size>1,dayHeading=labelledBy?'h3':'h4';
 for(let index=0;index<rows.length;index++){
  const record=rows[index],day=activityDay(record.at),key=showDecisions&&collapseHolds?holdKey(record):null;
  if(groupedDays&&day!==currentDay){currentDayGroup++;content+='<li class="mind-activity-day" data-activity-day-heading="'+currentDayGroup+'"><'+dayHeading+'>'+esc(day)+(day==='시각 미기록'?'':' · KST')+'</'+dayHeading+'></li>';currentDay=day;}content+=renderRow(record);
  if(!key)continue;
  let end=index+1;while(end<rows.length&&activityDay(rows[end].at)===day&&holdKey(rows[end])===key)end++;
  if(end===index+1)continue;
  const group=JSON.stringify([item?.activationId??item?.id??profileId,key,rows[end]?.id??'tail']);folded=true;
  content+='<li class="mind-hold-history"><details data-activity-hold-history="'+esc(group)+'"><summary data-activity-history-toggle>이전 관망 '+(end-index-1)+'건</summary><ol class="mind-activity-history-rows">'+rows.slice(index+1,end).map(renderRow).join('')+'</ol></details></li>';index=end-1;
 }
 return '<section class="mind-activity-feed mind-activity-timeline" data-activity-feed="'+esc(item?.activationId??item?.id??profileId??'current')+'"'+label+'>'+feedHeading(rows,{heading,profileId,executionMode,showDecisions,showAll:includeLatestDecision,labelledBy})+'<p class="mind-activity-count" data-activity-count role="status">'+rows.length+(folded?'건':'건 표시')+'</p><ol>'+attention+content+'</ol></section>';
}

const installed=new WeakMap();
/** Local presentation only: no requests, no graph evaluation, no orders. */
export function installMindActivityPreviews(doc=globalThis.document,{window:win=globalThis.window,setTimer=setTimeout,clearTimer=clearTimeout}={}){
 if(!doc)return {destroy(){}};if(installed.has(doc))return installed.get(doc);
 let trigger=null,panel=null,hoverTimer=null,leaveTimer=null,pinned=false,suppressed=null,openSignature=null,ownerFocused=false;
 const feedFilters=new Map(),holdHistory=new Map();let focusedFilter=null,focusedOperation=null,focusedHistory=null;
 const syncHistory=()=>{for(const group of doc.querySelectorAll?.('[data-activity-hold-history]')??[]){const key=group.dataset.activityHoldHistory;if(holdHistory.has(key)&&group.open!==holdHistory.get(key))group.open=holdHistory.get(key);if(focusedHistory?.key===key&&!focusedHistory.node.isConnected&&doc.activeElement===doc.body)group.querySelector('summary')?.focus({preventScroll:true});}};
 const syncOperationFocus=()=>{if(!focusedOperation||focusedOperation.node.isConnected||doc.activeElement!==doc.body)return;const group=[...doc.querySelectorAll('[data-operation-key]')].find(el=>el.dataset.operationKey===focusedOperation.key),next=group?.querySelector('[data-operation-slot="'+focusedOperation.slot+'"]');if(next&&!next.disabled)next.focus({preventScroll:true});};
 const syncFeeds=()=>{for(const feed of doc.querySelectorAll?.('[data-activity-feed]')??[]){const select=feed.querySelector('[data-activity-filter]');if(!select)continue;const saved=feedFilters.get(feed.dataset.activityFeed)??'all',value=[...select.options].some(option=>option.value===saved)?saved:'all';select.value=value;let count=0;const visibleDays=new Set();for(const row of feed.querySelectorAll('[data-activity-kind]')){const hidden=value!=='all'&&row.dataset.activityKind!==value;if(row.hidden!==hidden)row.hidden=hidden;if(!hidden){count++;visibleDays.add(row.dataset.activityDayGroup);}}for(const heading of feed.querySelectorAll('[data-activity-day-heading]'))heading.hidden=!visibleDays.has(heading.dataset.activityDayHeading);const output=feed.querySelector('[data-activity-count]'),text=count+'건 표시';if(output&&output.textContent!==text)output.textContent=text;if(focusedFilter?.key===feed.dataset.activityFeed&&!focusedFilter.node.isConnected&&doc.activeElement===doc.body)select.focus({preventScroll:true});}};
 const motion=win?.matchMedia?.('(prefers-reduced-motion: reduce)');
 const cancel=()=>{clearTimer(hoverTimer);clearTimer(leaveTimer);hoverTimer=leaveTimer=null;};
 const close=()=>{cancel();setExpanded(trigger,false);try{panel?.hidePopover?.();}catch{}panel?.remove();trigger=panel=null;pinned=false;openSignature=null;ownerFocused=false;};
 const owner=node=>node?.hasAttribute('data-mind-path-passive')?(node.closest?.('[data-mind-companion-open]')??node.closest?.('[data-mind-activity-card]')??node):node;
 const setExpanded=(node,value)=>{node?.setAttribute('aria-expanded',String(value));const host=owner(node);if(host!==node&&host?.hasAttribute?.('data-mind-activity-card'))host.setAttribute('aria-expanded',String(value));};
 const within=node=>Boolean(node&&(owner(trigger)?.contains(node)||panel?.contains(node)));
 const position=()=>{if(!panel||!trigger)return;const host=owner(trigger),anchor=host?.getBoundingClientRect?.()??trigger.getBoundingClientRect(),bubble=panel.getBoundingClientRect(),gap=pixelToken('--mind-activity-preview-gap',doc.documentElement),inset=pixelToken('--mind-activity-preview-inset',doc.documentElement);let box=tooltipPosition(anchor,bubble,{width:win.innerWidth,height:win.innerHeight},{gap,inset});
  if(host!==trigger){const right=anchor.right??anchor.left+anchor.width;if(right+gap+bubble.width<=win.innerWidth-inset)box={left:right+gap,top:Math.max(inset,Math.min(anchor.top,win.innerHeight-bubble.height-inset))};else if(anchor.left-gap-bubble.width>=inset)box={left:anchor.left-gap-bubble.width,top:Math.max(inset,Math.min(anchor.top,win.innerHeight-bubble.height-inset))};}
  panel.style.left=box.left+'px';panel.style.top=box.top+'px';};
 const rebind=()=>{
  if(!trigger)return false;
  if(trigger.isConnected){if(trigger.getAttribute('data-mind-path-signature')!==openSignature){close();return false;}return true;}
  const id=trigger.getAttribute('aria-controls'),replacement=[...(doc.querySelectorAll?.('[data-mind-path-trigger]')??[])].find(node=>node.isConnected&&node.getAttribute('aria-controls')===id&&node.getAttribute('data-mind-path-signature')===openSignature);
  if(!replacement){close();return false;}
  trigger=replacement;setExpanded(trigger,true);position();if(ownerFocused&&doc.activeElement===doc.body)owner(trigger)?.focus?.({preventScroll:true});return true;
 };
 const tick=()=>{
  if(!panel||!rebind()||doc.hidden){close();return;}
  const steps=[...panel.querySelectorAll('[data-mind-path-step]')];
  steps.forEach(step=>{step.hidden=false;step.toggleAttribute('data-replaying',false);});
  const progress=panel.querySelector('[data-mind-path-progress]');if(progress)progress.textContent=steps.length+'개 부품';
 };
 const show=node=>{if(!node?.isConnected||node===suppressed)return;if(trigger===node&&panel){clearTimer(leaveTimer);return;}close();const template=doc.getElementById(node.getAttribute('aria-controls')+'-template');if(!template?.content)return;trigger=node;openSignature=node.getAttribute('data-mind-path-signature');panel=template.content.firstElementChild.cloneNode(true);doc.body.append(panel);setExpanded(trigger,true);try{panel.showPopover?.();}catch{}position();tick();};
 const find=target=>target?.closest?.('[data-notification-cta]')?null:target?.closest?.('[data-mind-path-trigger]')??target?.closest?.('[data-mind-companion-open]')?.querySelector?.('[data-mind-path-passive]')??target?.closest?.('[data-mind-activity-card]')?.querySelector?.('[data-mind-path-passive]');
 const passive=target=>target?.querySelector?.('[data-mind-path-passive]');
 const focused=()=>within(doc.activeElement)||trigger?.hasAttribute('data-mind-path-passive')&&doc.activeElement?.contains?.(trigger);
 const leave=()=>{clearTimer(leaveTimer);leaveTimer=setTimer(()=>{if(!pinned&&!focused())close();},numberToken('--mind-activity-preview-leave-ms',doc.documentElement));};
 const listeners={
  change(event){const select=event.target.closest?.('[data-activity-filter]'),feed=select?.closest('[data-activity-feed]');if(!feed)return;feedFilters.set(feed.dataset.activityFeed,activityFeedKind(select.value));close();syncFeeds();},
  pointerover(event){if(panel?.contains(event.target)){clearTimer(leaveTimer);return;}const node=find(event.target);if(!node||owner(node)?.contains(event.relatedTarget)||event.pointerType==='touch')return;clearTimer(hoverTimer);hoverTimer=setTimer(()=>show(node),numberToken('--mind-activity-preview-hover-ms',doc.documentElement));},
  pointerout(event){const node=find(event.target);if(node===suppressed&&!node?.contains(event.relatedTarget))suppressed=null;if(within(event.target)&&!within(event.relatedTarget))leave();else if(node&&!node.contains(event.relatedTarget))clearTimer(hoverTimer);},
  focusin(event){const history=event.target.closest?.("[data-activity-history-toggle]");focusedHistory=history?{node:history,key:history.closest("[data-activity-hold-history]").dataset.activityHoldHistory}:null;focusedFilter=event.target.matches?.('[data-activity-filter]')?{node:event.target,key:event.target.closest('[data-activity-feed]').dataset.activityFeed}:null;const control=event.target.closest?.('[data-operation-slot]');focusedOperation=control?{node:control,key:control.closest('[data-operation-key]').dataset.operationKey,slot:control.dataset.operationSlot}:null;const node=find(event.target)??passive(event.target);if(node){show(node);ownerFocused=true;}else if(panel?.contains(event.target))clearTimer(leaveTimer);else ownerFocused=false;},
  focusout(event){if(event.target===suppressed||event.target?.contains?.(suppressed))suppressed=null;if((within(event.target)||event.target?.contains?.(trigger))&&!within(event.relatedTarget))leave();},
  click(event){if(event.target.closest?.('[data-studio-action="mind-execution"]')){close();return;}if(event.target.closest?.('[data-mind-path-close]')){const returnTo=owner(trigger);suppressed=trigger;close();returnTo?.focus?.();event.preventDefault();return;}const node=find(event.target);if(!node||node.hasAttribute('data-mind-path-passive')&&!owner(node)?.hasAttribute?.('data-mind-activity-card'))return;event.preventDefault();if(trigger===node&&pinned){suppressed=node;close();}else{suppressed=null;show(node);pinned=true;}},
  pointerdown(event){const node=find(event.target);if(node?.hasAttribute('data-mind-path-passive')&&owner(node)?.closest?.('[data-mind-companion-open]')){suppressed=node;close();return;}if(trigger&&!within(event.target))close();},
  keydown(event){if(event.key==='Escape'&&panel){suppressed=trigger;const returnTo=owner(trigger),returnFocus=panel.contains(doc.activeElement);close();if(returnFocus)returnTo?.focus?.();event.preventDefault();event.stopPropagation();return;}const node=find(event.target);if(['Enter',' '].includes(event.key)&&owner(node)?.hasAttribute?.('data-mind-activity-card')){event.preventDefault();suppressed=null;show(node);pinned=true;}},
  scroll(event){if(panel?.contains(event.target))return;close();},
  toggle(event){const group=event.target;if(group.matches?.('[data-activity-hold-history]')){holdHistory.set(group.dataset.activityHoldHistory,group.open);if(!group.open&&group.contains(trigger)){const returnFocus=panel?.contains(doc.activeElement);close();if(returnFocus)group.querySelector('summary')?.focus({preventScroll:true});}}if(panel?.contains(group))position();},
  visibilitychange(){if(doc.hidden)close();},
 };
 for(const [name,handler]of Object.entries(listeners))doc.addEventListener(name,handler,true);
 const motionChanged=()=>{tick();};motion?.addEventListener?.('change',motionChanged);win?.addEventListener('resize',close);
 const observer=win?.MutationObserver?new win.MutationObserver(()=>{syncHistory();if(trigger)rebind();syncFeeds();syncOperationFocus();}):null;observer?.observe(doc.documentElement,{childList:true,subtree:true});syncFeeds();
 const controller={destroy(){close();observer?.disconnect();for(const [name,handler]of Object.entries(listeners))doc.removeEventListener(name,handler,true);motion?.removeEventListener?.('change',motionChanged);win?.removeEventListener('resize',close);installed.delete(doc);}};installed.set(doc,controller);return controller;
}
import {EXCHANGE_CONNECTION_RECOVERY,EXCHANGE_DATA_RECOVERY} from '../system/automation-contracts.mjs';
