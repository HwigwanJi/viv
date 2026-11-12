import {getInstrument} from '../domain/instruments.mjs';
import {paperPracticeEntry} from '../system/paper-decision-links.mjs';
import {currencyAmount,currencyPrecision} from './currency-format.mjs';
import {graphDecisionMethod} from './decision-method.mjs';
import {helpTooltip} from './help-tooltip.mjs';
import {cssToken, numberToken, pixelToken} from './design-tokens.mjs';
import {terminalPrimaryAction,terminalRecoveryAction,terminalRunRequirement,terminalMarketMessage} from './terminal-workspace-controls.mjs';
import {renderMindActivityFeed} from './mind-activity.mjs';
import {renderFilterSummary} from './workflow-state.mjs';

const list=value=>Array.isArray(value)?value:[];
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const number=(value,digits=2)=>finite(value)?new Intl.NumberFormat('ko-KR',{minimumFractionDigits:digits,maximumFractionDigits:digits}).format(value):'—';
const priceNumber=(value,instrument)=>finite(value)?new Intl.NumberFormat('ko-KR',{minimumFractionDigits:0,maximumFractionDigits:instrument?.quoteCurrency==='BTC'?8:Math.max(instrument?.priceDecimals??2,value!==0&&Math.abs(value)<1?Math.min(12,Math.ceil(-Math.log10(Math.abs(value)))+3):0)}).format(value):'—';
const percent=value=>finite(value)?number(value*100,2)+'%':'—';
const percentagePoints=value=>finite(value)?number(value*100,2)+'%p':'—';
const epoch=value=>typeof value==='number'?(value<1e11?value*1000:value):Date.parse(value);
const iso=value=>Number.isFinite(epoch(value))?new Date(epoch(value)).toISOString():null;
const stamp=value=>iso(value)?new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(epoch(value)))+' KST':'시각 미수집';
const validTradeDate=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;
const tradeDateLabel=value=>'거래일 '+value.slice(5).replace('-','.');
const tradeDateMarkup=value=>'<time datetime="'+esc(value)+'" title="'+esc(tradeDateLabel(value))+'">'+esc(tradeDateLabel(value))+'</time>';
const compactStamp=value=>iso(value)?new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(epoch(value))).replace(/(\d{2})\. (\d{2})\. /,'$1/$2 '):'시각 미수집';
const quoteStamp=value=>iso(value)?new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',fractionalSecondDigits:3,hour12:false}).format(new Date(epoch(value)))+' KST':'시각 미수집';
const actionName=value=>({buy:'매수',sell:'매도',hold:'유지'})[value]||'응답 확인';
const verdictBadge=(action,{failed=false,judgment=false}={})=>{
  const kind=failed?'failed':['buy','sell','hold'].includes(action)?action:'unknown',label=failed?'실행 실패':actionName(kind)+(judgment&&kind!=='unknown'?' 판단':'');
  return '<span class="pill terminal-verdict-badge terminal-'+kind+'"><span aria-hidden="true">'+({buy:'↗',sell:'↘',hold:'—',failed:'!',unknown:'?'})[kind]+'</span>'+esc(label)+'</span>';
};
const actionColor=value=>({buy:'--ds-success',sell:'--ds-danger',hold:'--ds-text-secondary'})[value]||'--ds-text-secondary';
const timeframeMs=value=>({'1m':60000,'3m':180000,'5m':300000,'1h':3600000,'4h':14400000,'1d':86400000})[String(value).toLowerCase()]||null;
const response=record=>record?.jevResponse?.answers?record.jevResponse:record?.jevResponse?.response?.answers?record.jevResponse.response:record?.rawResponse?.answers?record.rawResponse:null;
const outcomeName=value=>({HOLD_SELECTED:'보유량 유지',NO_ORDER_REQUIRED:'추가 주문 없음',WAITING_EXECUTION_DATA:'실행 시세 대기',TRADE_PROPOSED:'주문 제안',PAPER_FILL_RECORDED:'모의 체결',ORDER_REJECTED:'주문 제한',OBSERVATION_ONLY:'결정 저장 · 계좌 연결 필요',PAPER_REVIEW_READY:'모의 주문 검토 대기',RISK_BLOCKED:'위험·비용 조건 제한',EXECUTED:'모의 체결 완료',FILLED:'모의 체결 완료',READY:'결정 저장'})[value]||'기록 확인';
export const terminalExecutionRetryable=record=>record?.execution?.status==='WAITING_EXECUTION_DATA'&&record.execution.retryable===true;
const count=value=>Number.isSafeInteger(value)?value:'—';
const formName=value=>({'mind-policy':'마인드 정책','trade-review':'거래 분석','market-context':'투자 자료','principle-evidence':'원칙 검증 근거','weight-proposal':'가중치 변경 제안'})[value];
const timeLabel=(label,value)=>iso(value)?`<time datetime="${esc(iso(value))}">${esc(label)} ${esc(stamp(value))}</time>`:`<span>${esc(label)} 시각 미기록</span>`;
const decisionTime=view=>view.completedAt?timeLabel(view.authority?'결정 완료':'JEV 완료',view.completedAt):view.requestedAt?timeLabel(view.authority?'결정 시작':'JEV 요청',view.requestedAt)+'<span class="terminal-time-unrecorded">완료 시각 미기록</span>':'<span>완료 시각 미기록</span>';
const authorityName=view=>view.decisionMethod?.label||graphDecisionMethod({authority:view.authority})?.label||(view.model?'JEV':'방식 미기록');
const nonProbabilistic=view=>Boolean(view.authority)&&view.authority!=='JEV_FINAL'&&view.decisionMethod?.measureKind!=='CONFIDENCE';
const ruleMeasureLabel=view=>view.decisionMethod?.measureKind==='VOTE'?'최다 투표 비중':'계산 강도';
const ruleMeasureValue=view=>view.decisionMethod?.measureKind==='VOTE'?percent(view.strength):number(view.strength,3);
export function terminalModelMeasures(view){
  if(nonProbabilistic(view)||(!view.model&&view.authority!=='JEV_FINAL'&&view.decisionMethod?.measureKind!=='CONFIDENCE'))return '';
  const choices=['buy','hold','sell'].filter(key=>finite(view.probabilities?.[key])),confidence=finite(view.confidence);
  if(!choices.length&&!confidence)return '';
  return '<details class="spaced"><summary>모델 응답 지표</summary><p class="tiny muted">행동 선택에 대한 모델 출력입니다. 실제 성과는 별도 기록에서 확인합니다.</p><dl>'+
    (confidence?'<dt>모델 자체 확신도</dt><dd>'+percent(view.confidence)+'</dd>':'')+
    (choices.length?'<dt>모델 선택 확률</dt><dd>'+choices.map(key=>actionName(key)+' '+percent(view.probabilities[key])).join(' · ')+'</dd>':'')+'</dl></details>';
}
const button=(label,action,id='',extra='')=>`<button type="button" data-terminal-action="${action}" data-terminal-id="${esc(id)}" ${extra}>${esc(label)}</button>`;
const mindTitle=(name,id,label,owner)=>'<h3 title="'+esc(name)+'">'+(id?button(name,'decision',id,'class="terminal-mind-title" data-terminal-owner="'+esc(owner)+'" aria-label="'+esc(name+' · '+label)+'"'):esc(name))+'</h3>';
const empty=text=>`<div class="terminal-empty">${esc(text)}</div>`;
const table=(heads,rows,{className=''}={})=>`<div class="terminal-table-scroll"><table class="terminal-table${className?' '+esc(className):''}"><thead><tr>${heads.map(h=>`<th scope="col">${h}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`;

/** Only genuine, complete OHLC rows enter the price and volume series. */
export function terminalBars(bars,{timeframe='4h',asOf=null}={}){
  const interval=timeframeMs(timeframe),cutoff=asOf===null?Infinity:epoch(asOf),seen=new Map();
  for(const raw of list(bars)){
    const value=Array.isArray(raw)?{openTime:raw[0],open:raw[1],high:raw[2],low:raw[3],close:raw[4],volume:raw[5]}:raw;
    if(!value||value.closed===false)continue;
    const openAt=epoch(value.openTime??value.timestamp??value.time),closeAt=epoch(value.closeTime??value.closedAt??(Number.isFinite(openAt)&&interval?openAt+interval:NaN));
    const {open,high,low,close}=value,volume=finite(value.volume)&&value.volume>=0?value.volume:null;
    if(!Number.isFinite(openAt)||!Number.isFinite(closeAt)||closeAt<=openAt||closeAt>cutoff||![open,high,low,close].every(v=>finite(v)&&v>0)||high<Math.max(open,close)||low>Math.min(open,close)||low>high)continue;
    const time=Math.floor(openAt/1000);
    seen.set(time,{time,open,high,low,close,volume,openAt,closeAt,source:value.source??null,...(validTradeDate(value.tradeDate)?{tradeDate:value.tradeDate}:{})});
  }
  return [...seen.values()].sort((a,b)=>a.time-b.time);
}

const activityMarket=(source,item)=>source.market??(list(item.marketIds).length===1?item.marketIds[0]:null);
function liveActivitySources(item,instrumentId){
 const rows=[],seen=new Set();
 for(const source of [item.lastDecision,...list(item.recentActivity)].filter(Boolean)){
  const market=activityMarket(source,item);
  if('crypto:upbit:'+market!==instrumentId||seen.has(source.id))continue;
  if(source.kind!=='DECISION'&&(source.kind!=='STRATEGY_ORDER'||source.market!==market||source.activationId!==item.activationId))continue;
  seen.add(source.id);rows.push(source);
 }
 return rows;
}

/** A mind-wide saved judgment can open its own detail without becoming a chart marker. */
export function liveTerminalLatestDecision(activities,id){
  const item=list(activities).find(item=>item.lastDecision?.id&&'live-decision:'+item.activationId+':'+item.lastDecision.id===id);
  if(!item)return null;
  const source={...item.lastDecision,kind:'DECISION'},market=activityMarket(source,item);
  return {kind:'LIVE_DECISION',id,instrumentId:market?'crypto:upbit:'+market:null,profileId:item.profileId,quoteCurrency:item.quoteCurrency,at:source.at,decision:{action:source.action},sourceRecord:source,activity:item};
}

/** Actual owner-scoped activity only; exchange funding and unfilled orders never become trades. */
export function liveTerminalRecords(activities,{instrumentId,profileId='all'}={}){
  const records=[],seen=new Set();
  for(const item of list(activities)){
    if(profileId!=='all'&&item.profileId!==profileId||!list(item.marketIds).some(market=>'crypto:upbit:'+market===instrumentId))continue;
    const sources=liveActivitySources(item,instrumentId),add=record=>{if(!seen.has(record.id)){seen.add(record.id);records.push(record);}};
    for(const source of sources){
      const market=activityMarket(source,item);
      if('crypto:upbit:'+market!==instrumentId)continue;
      if(source.kind==='DECISION'&&['buy','sell','hold'].includes(source.action)&&iso(source.at))add({kind:'LIVE_DECISION',id:'live-decision:'+item.activationId+':'+source.id,instrumentId,profileId:item.profileId,quoteCurrency:item.quoteCurrency,at:source.at,decision:{action:source.action},sourceRecord:source,activity:item});
      if(source.kind!=='STRATEGY_ORDER'||source.market!==market||source.activationId!==item.activationId||!['buy','sell'].includes(source.action))continue;
      const fills=list(source.fills),ids=new Set(fills.map(fill=>fill.id));
      if(ids.size!==fills.length)continue;
      for(const fill of fills)if(typeof fill.id==='string'&&fill.id&&iso(fill.at)&&Number(fill.quantity)>0&&Number(fill.price)>0&&Number.isFinite(Number(fill.price))&&Number.isFinite(Number(fill.quantity)))add({kind:'LIVE_FILL',id:'live-fill:'+item.activationId+':'+source.id+':'+fill.id,instrumentId,profileId:item.profileId,quoteCurrency:item.quoteCurrency,at:fill.at,price:Number(fill.price),decision:{action:source.action},fill:{...fill},sourceRecord:source,activity:item});
    }
  }
  return records.sort((a,b)=>epoch(a.at)-epoch(b.at)||a.id.localeCompare(b.id));
}

/** Identity is supplied by the saved decision, never inferred from the current chart. */
export function terminalDecisionView(record,{profiles=[],legacyInstrumentId=null}={}){
  if(record?.kind==='LIVE_FILL'||record?.kind==='LIVE_DECISION'){
    const source=record.sourceRecord,profile=list(profiles).find(p=>p.id===record.profileId);
    return {id:record.id,instrumentId:record.instrumentId,profileId:record.profileId,profileName:profile?.name||'마인드 미확인',quoteCurrency:record.quoteCurrency,action:record.decision?.action,at:iso(record.at),atMs:epoch(record.at),createdAt:iso(record.at),createdAtMs:epoch(record.at),price:record.kind==='LIVE_FILL'?record.price:null,live:true,fill:record.fill??null,sourceRecord:source,record,failed:false,completedAt:source?.recordedAt??null,probabilities:{},reasons:[]};
  }
  const input=record?.inputPackage||{},raw=response(record),answer=raw?.answers?.action,decision=record?.decision||{};
  const instrumentId=record?.instrumentId||input.instrumentId||input.instrument?.id||input.marketSnapshot?.instrumentId||input.marketSnapshot?.symbol||input.symbol||legacyInstrumentId;
  const profileId=record?.investmentProfileId||record?.profileId||record?.mindId||input.investmentProfileId||null;
  const profile=list(profiles).find(p=>p.id===profileId);
  const action=decision.action||answer?.choice;
  const at=input.asOf||record?.asOf||record?.occurredAt;
  const createdAt=record?.createdAt||input.decisionCompletedAt||input.decisionStartedAt||at;
  const requestedAt=record?.provider?.startedAt||record?.requestAt||record?.decisionAt||input.decisionStartedAt||record?.createdAt||null,completedAt=record?.provider?.answeredAt||record?.decisionCompletedAt||record?.completedAt||input.decisionCompletedAt||null;
  const started=epoch(input.decisionStartedAt),completed=epoch(input.decisionCompletedAt);
  const usage=raw?.usage||decision.usage||record?.provider?.usage;
  const failed=record?.decisionStatus==='FAILED'||record?.status==='FAILED';
  const state=record?.jevRequest?.state||record?.rawRequest?.state,rules=list(state?.rules||state?.principles),memories=list(state?.approvedPersonalMemory||state?.approvedMemory);
  const outcome=terminalExecutionRetryable(record)?'WAITING_EXECUTION_DATA':record?.outcomeType||(record?.execution?.status==='FILLED'?'FILLED':['HOLD_SELECTED','PAPER_REVIEW_READY','RISK_BLOCKED'].includes(record?.status)?record.status:record?.execution?.status||record?.status)||null;
  let quoteCurrency=record?.quoteCurrency||input.instrument?.quoteCurrency||input.marketSnapshot?.quoteCurrency||state?.market?.instrument?.quoteCurrency||null;
  if(!quoteCurrency)try{quoteCurrency=getInstrument(instrumentId).quoteCurrency;}catch{}
  return {id:record?.id,instrumentId,quoteCurrency,profileId,profileName:profile?.name||record?.profileName||'마인드 미확인',action,at:iso(at),atMs:epoch(at),createdAt:iso(createdAt),createdAtMs:epoch(createdAt),requestedAt:iso(requestedAt),completedAt:iso(completedAt),price:input.marketSnapshot?.features?.close??state?.market?.features?.lastClose??record?.referencePrice??null,authority:decision.authority??null,decisionMethod:graphDecisionMethod(decision,{graphEvaluation:record?.strategyEvaluation?.graphEvaluation||record?.graphEvaluation||state?.strategyEvaluation?.graphEvaluation}),strength:decision.strength??null,confidence:decision.authority?decision.confidence:answer?.confidence??decision.choiceConfidence??decision.confidence??null,probabilities:decision.authority?(decision.probabilities??{}):answer?.probabilities||decision.choiceDistribution||decision.probabilities||{},stance:decision.stance||raw?.answers?.stance?.choice||null,model:raw?.model||decision.model||record?.provider?.model||null,latencyMs:Number.isFinite(started)&&Number.isFinite(completed)?completed-started:record?.provider?.latencyMs??null,inputTokens:usage?.input_tokens??null,outputTokens:usage?.output_tokens??null,ruleCount:record?.ruleCount??(state?rules.length:null),memoryCount:record?.memoryCount??(state?memories.length:null),externalKnowledgeCount:record?.externalKnowledgeCount??(state?list(state.externalKnowledge).length:null),marketProvider:input.marketProvider||input.marketData?.manifest?.provider||record?.marketSource?.provider||null,experimentType:input.experimentType||record?.experimentType||null,profileVersionId:record?.investmentProfileVersionId||record?.profileVersionId||state?.versionRefs?.profileVersionId||null,memoryVersionId:record?.memoryVersionId||state?.versionRefs?.memoryVersionId||null,reasons:list(decision.reasons).map(v=>typeof v==='string'?v:v?.message).filter(Boolean),failed,outcome,record};
}

/** A marker is attached only to the exact saved decision's completed candle. */
export function terminalDecisionMarkers({bars=[],decisions=[],profiles=[],instrumentId,mindId='all',legacyInstrumentId=null,timeframe='4h',asOf=null}={}){
  const candles=terminalBars(bars,{timeframe,asOf}),byClose=new Map(candles.map(bar=>[bar.closeAt,bar]));
  return list(decisions).map(record=>terminalDecisionView(record,{profiles,legacyInstrumentId})).filter(view=>view.id&&view.instrumentId===instrumentId&&(mindId==='all'||view.profileId===mindId)&&!view.failed&&['buy','sell','hold'].includes(view.action)).map(view=>({view,candle:view.live?candles.find(bar=>bar.openAt<=view.atMs&&view.atMs<bar.closeAt):byClose.get(view.atMs)})).filter(row=>row.candle).sort((a,b)=>a.view.atMs-b.view.atMs||String(a.view.id).localeCompare(String(b.view.id))).map(({view,candle})=>({...view,time:candle.time,price:finite(view.price)?view.price:view.live?null:candle.close,colorToken:actionColor(view.action),shape:view.action==='buy'?'arrowUp':view.action==='sell'?'arrowDown':'circle',position:view.action==='buy'?'belowBar':view.action==='sell'?'aboveBar':'inBar',text:(view.action==='buy'?'B':view.action==='sell'?'S':'H')+' · '+view.profileName}));
}

function liveTooltip(view,{pinned=false,showDetailAction=true}={}){
  const source=view.sourceRecord,fill=view.fill,amount=(value,label)=>value!==null&&value!==undefined?'<dt>'+label+'</dt><dd title="'+esc(value)+'">'+(label==='체결 수량'?number(Number(value),8):currencyAmount(Number(value),view.quoteCurrency))+(label==='체결가'||label==='거래 금액'?' '+esc(view.quoteCurrency):'')+'</dd>':'',label=fill?'실전 체결':'실전 판단';
  return '<section class="terminal-popover-decision"><div>'+verdictBadge(view.action)+'<span>'+label+'</span><strong>'+esc(view.profileName)+'</strong></div><p class="terminal-tooltip-time">'+esc(view.instrumentId?.split(':').at(-1)||'종목 미지정')+'</p><dl><dt>'+(fill?'실제 체결 시각':'판단 기준 시각')+'</dt><dd><time datetime="'+esc(view.at)+'">'+esc(quoteStamp(view.at))+'</time></dd>'+(fill?amount(fill.price,'체결가')+amount(fill.quantity,'체결 수량')+amount(fill.gross,'거래 금액')+'<dt>주문 상태</dt><dd>'+esc(({FILLED:'체결 완료',PARTIALLY_FILLED:'일부 체결',CANCELLED:'주문 취소'})[source.state]||'주문 기록')+'</dd>':finite(source?.targetWeight)?'<dt>목표 비중</dt><dd>'+percent(source.targetWeight)+'</dd>':'')+'</dl>'+(pinned&&showDetailAction?button('판단·체결 상세','decision',view.id):'')+'</section>';
}
export function terminalTooltipContent(views,{pinned=false,showPinHint=true,showDetailAction=true}={}){
  if(views.some(view=>view.live))return '<div class="terminal-popover-heading"><strong>실전 기록</strong>'+(pinned?button('닫기','popover-close','','aria-label="결정 미리보기 닫기"'):showPinHint?'<span>클릭하여 고정</span>':'')+'</div>'+views.map(view=>view.live?liveTooltip(view,{pinned,showDetailAction}):terminalTooltipContent([view],{pinned,showPinHint,showDetailAction})).join('');
  if(!pinned)return `<div class="terminal-popover-heading"><strong>${views.length?esc(stamp(views[0].at)):'결정 기록'}</strong>${showPinHint?'<span>클릭하여 고정</span>':''}</div>${views.map(view=>`<section class="terminal-popover-decision"><div>${verdictBadge(view.action,{failed:view.failed})}<strong>${esc(view.profileName)}</strong></div><p class="terminal-tooltip-time">${decisionTime(view)}</p><p class="terminal-tooltip-choice">${esc(authorityName(view))}${nonProbabilistic(view)?' · '+esc(ruleMeasureLabel(view)+' '+ruleMeasureValue(view)):''}</p><p>${esc(outcomeName(view.outcome))}</p></section>`).join('')}`;
  return `<div class="terminal-popover-heading"><strong>${views.length?esc(stamp(views[0].at)):'결정 기록'}</strong>${pinned?button('닫기','popover-close','','aria-label="결정 미리보기 닫기"'):'<span>클릭하여 고정</span>'}</div>${views.map(view=>`<section class="terminal-popover-decision"><div>${verdictBadge(view.action,{failed:view.failed})}<strong>${esc(view.profileName)}</strong>${pinned?button('실행 상세','decision',view.id):''}</div><dl><dt>기준 봉</dt><dd>${esc(stamp(view.at))}</dd><dt>결정 시각</dt><dd>${decisionTime(view)}</dd><dt>기준 종가</dt><dd>${currencyAmount(view.price,view.quoteCurrency)}</dd><dt>결정 방식</dt><dd>${esc(authorityName(view))}</dd>${nonProbabilistic(view)?'<dt>'+ruleMeasureLabel(view)+'</dt><dd>'+ruleMeasureValue(view)+'</dd>':''}<dt>모델 · 응답</dt><dd>${esc(view.model||'기록 없음')} · ${finite(view.latencyMs)?number(view.latencyMs/1000,2)+'초':'—'}</dd><dt>실제 전송</dt><dd>규칙 ${count(view.ruleCount)} · 개인 기억 ${count(view.memoryCount)} · 공용 자료 ${count(view.externalKnowledgeCount)}</dd><dt>실행 결과</dt><dd>${esc(outcomeName(view.outcome))}</dd></dl>${terminalModelMeasures(view)}${view.reasons.length?`<p>${esc(view.reasons[0])}</p>`:''}</section>`).join('')}`;
}

export function createTradingTerminal(hooks={}){
  let model={},root=null,chart=null,candleSeries=null,volumeSeries=null,markersApi=null,observer=null,themeObserver=null,generation=0,pinned=false,lastPopover=[],lastTrigger=null,search='',instrumentTab='all',recordView='decisions',selectedRange='30',chartExpanded=false,recordsExpanded=false,instrumentPickerOpen=false,outsideMenus=null,recordFocus=null,universeControlFocus=null;
  const listeners=[];
  let instrumentSearchFocus=null,focusInstrumentHeading=false;
  const selected=()=>list(model.instruments).find(i=>i.id===model.selectedInstrumentId)||null;
  const chartInstrumentId=()=>model.marketInstrumentId||model.selectedInstrumentId;
  const scopedDecisions=()=>list(model.decisions).map(record=>terminalDecisionView(record,{profiles:model.profiles,legacyInstrumentId:model.legacyInstrumentId})).filter(v=>v.instrumentId===chartInstrumentId()&&(model.selectedMindId==='all'||!model.selectedMindId||v.profileId===model.selectedMindId)).sort((a,b)=>b.createdAtMs-a.createdAtMs||b.atMs-a.atMs||String(b.id).localeCompare(String(a.id)));
  const markerViews=()=>terminalDecisionMarkers({bars:model.bars,decisions:model.decisions,profiles:model.profiles,instrumentId:chartInstrumentId(),mindId:model.selectedMindId||'all',legacyInstrumentId:model.legacyInstrumentId,timeframe:model.timeframe||'4h',asOf:model.asOf||null});
  const candles=()=>terminalBars(model.bars,{timeframe:model.timeframe||'4h',asOf:model.asOf||null});
  const callback=(name,...args)=>typeof hooks[name]==='function'?hooks[name](...args):undefined;
  const discovery=()=>model.instrumentUniverse;
  function instrumentCollection(){
    if(discovery())return list(discovery().items);
    const query=search.trim().toLocaleLowerCase();
    return list(model.instruments).filter(i=>(instrumentTab==='all'||instrumentTab==='watchlist'&&i.watched||instrumentTab===i.assetClass||instrumentTab==='stock'&&i.assetClass==='equity')&&(!query||[i.symbol,i.name,i.venue].some(v=>String(v||'').toLocaleLowerCase().includes(query))));
  }
  function instrumentRows(){
    const latest=candles().at(-1);
    return instrumentCollection().map(i=>{const unpriced=!!discovery()&&!finite(i.price),market=({KOSPI:'코스피',KOSDAQ:'코스닥',KRX:'한국',NASDAQ:'나스닥',NYSE:'NYSE',NYSE_ARCA:'Arca',AMEX:'AMEX',UPBIT:'업비트'})[i.market||i.venue]||i.market||i.venue||'',type=({etf:'ETF',reit:'리츠',etn:'ETN',preferred:'우선주'})[i.assetType]||i.quoteCurrency||'';return `<tr${i.id===model.selectedInstrumentId?' aria-selected="true"':''}><td><div class="terminal-instrument-cell"><button type="button" class="terminal-star" data-terminal-action="watchlist" data-terminal-id="${esc(i.id)}" aria-label="${esc(i.name||i.symbol)} ${i.watched?'관심 해제':'관심 등록'}" aria-pressed="${!!i.watched}">${i.watched?'★':'☆'}</button><button class="terminal-instrument-name" title="${esc((i.symbol||i.id)+' · '+(i.name||i.venue||''))}" type="button" data-terminal-action="instrument" data-terminal-id="${esc(i.id)}" aria-label="${esc(i.name||i.symbol)} 차트 열기"${i.id===model.selectedInstrumentId?' aria-current="true"':''}><strong>${esc(i.symbol||i.id)}</strong><small>${esc(i.name||i.venue||'')}</small></button></div></td><td><span title="${esc(unpriced?market:currencyAmount(i.price,i.quoteCurrency,i.priceDecimals??2))}">${unpriced?esc(market):currencyAmount(i.price,i.quoteCurrency,i.priceDecimals??2)}</span><small class="${finite(i.change24h)?i.change24h<0?'terminal-negative':'terminal-positive':'terminal-muted'}">${unpriced?esc(type):i.assetClass==='equity'&&validTradeDate(i.tradeDate??(i.id===model.selectedInstrumentId?latest?.tradeDate:null))?tradeDateMarkup(i.tradeDate??latest.tradeDate):iso(i.asOf)?`<time datetime="${esc(iso(i.asOf))}" title="${esc(stamp(i.asOf))}" aria-label="${esc(stamp(i.asOf))}">${esc(compactStamp(i.asOf))}</time>`:esc(i.status==='CONNECT_REQUIRED'||i.status==='unconfigured'?'연결 필요':i.status==='error'||i.status==='ERROR'?'조회 오류':'조회 대기')}</small></td></tr>`;}).join('');
  }
  function universeCount(){const state=discovery();if(state?.filters.sectorId&&['STALE','COLLECTION_REQUIRED'].includes(state.coverage?.sectorStatus))return '구성 수집 필요';return state?.loading?'조회 중':Number.isSafeInteger(state?.total)?new Intl.NumberFormat('ko-KR').format(state.total)+'개':state?.error?'조회 오류':'—';}
  function universeFeedback(){
    const state=discovery();if(!state)return '';
    if(state.loading)return '<span role="status">종목을 찾는 중…</span>';
    if(state.error)return '<span role="alert">'+esc(state.error)+'</span>'+button('다시 조회','universe-retry');
    const collecting=state.collecting,collectionError=state.collectionError?'<span role="alert">'+esc(state.collectionError)+'</span>':'';
    if(state.filters.sectorId&&['STALE','COLLECTION_REQUIRED'].includes(state.coverage?.sectorStatus))return '<span>'+esc(state.coverage.sectorStatus==='STALE'?'섹터 구성 갱신 필요':'섹터 구성 수집 필요')+'</span>'+(state.collectAvailable?button(collecting?'가져오는 중…':'섹터 종목 가져오기','universe-collect-sector','',collecting?'disabled':''):button('자료 설정','data'));
    if(state.source?.status==='COLLECTION_REQUIRED'&&(!state.items.length||state.collecting||state.collectionError)){
      const sources=list(state.sources).length?state.sources:[state.source],upbitMissing=sources.some(source=>source.provider==='upbit'&&source.status==='COLLECTION_REQUIRED'),stocksMissing=sources.some(source=>source.provider==='toss'&&source.status==='COLLECTION_REQUIRED');
      return '<div class="terminal-universe-recovery">'+collectionError+'<strong>검색할 종목 목록이 더 필요합니다.</strong><span>검색어와 선택한 시장을 유지해 목록을 가져옵니다.</span><div>'+(upbitMissing&&hooks.onUniverseCollectCatalog?button(collecting?'업비트 목록 가져오는 중…':'업비트 종목 가져오기','universe-collect-catalog','',collecting?'disabled':''):'')+(stocksMissing?button('주식 목록 설정','data'):!upbitMissing||!hooks.onUniverseCollectCatalog?button('종목 목록 설정','data'):'')+'</div></div>';
    }
    if(!state.items.length)return '<span role="status">'+(state.filters.tab==='watchlist'&&!state.filters.q?'관심 종목을 등록하세요.':'검색 결과가 없습니다.')+'</span>';
    return collectionError;
  }

  function universeSource(){
    const state=discovery();if(!state?.source||state.loading||state.source.provider==='watchlist')return '';
    const names={toss:'토스증권',upbit:'업비트',application:'기본 종목',watchlist:'관심 종목',mixed:'통합 목록'},sources=list(state.sources),providers=[...new Set(sources.map(item=>names[item.provider]||item.provider).filter(Boolean))],label=providers.join(' · ')||names[state.source.provider]||'종목 목록';
    const detail=(sources.length?sources:[state.source]).map(item=>(names[item.provider]||'종목 목록')+' · '+(iso(item.asOf)?stamp(item.asOf):item.provider==='application'?'기본 목록':'시각 미수집')+(item.status==='STALE'?' · 갱신 필요':'')).join(' / ');
    return '<span class="terminal-universe-source-label">'+esc(label)+(state.source.status==='STALE'?' · 갱신 필요':state.source.status==='COLLECTION_REQUIRED'?' · 일부 목록':'')+'</span>'+helpTooltip('목록 수집 시각',detail,{id:'terminal-universe-source-help'});
  }
  function sectorOptions(state){return '<option value="">'+(state.facetsError||state.facetsLoading?'섹터 '+(state.facetsLoading?'조회 중':'조회 실패'):'전체 섹터')+'</option>'+(!list(state.sectors).some(item=>item.id===state.filters.sectorId)&&state.filters.sectorId?'<option value="'+esc(state.filters.sectorId)+'" selected>선택한 섹터 · 목록 확인 필요</option>':'')+list(state.sectors).map(item=>'<option value="'+esc(item.id)+'"'+(state.filters.sectorId===item.id?' selected':'')+'>'+esc(item.name)+'</option>').join('');}
  function facetsFeedback(){const state=discovery();return state?.facetsError&&!state.facetsLoading?'<span role="alert">'+esc(state.facetsError)+'</span><div>'+button('섹터 목록 다시 조회','universe-retry')+'</div>':'';}
  function universeFilters(){const state=discovery();if(!state)return '';return '<label><span class="visually-hidden">주식 유형</span><select data-terminal-universe-filter="assetType" aria-label="주식 유형">'+[['','전체 유형'],['stock','주식'],['etf','ETF'],['reit','리츠'],['etn','ETN'],['preferred','우선주'],['other','기타']].map(([id,name])=>'<option value="'+id+'"'+(state.filters.assetType===id?' selected':'')+'>'+name+'</option>').join('')+'</select></label><label><span class="visually-hidden">주식 섹터</span><select data-terminal-universe-filter="sectorId" aria-label="주식 섹터"'+(state.facetsLoading?' disabled':'')+'>'+sectorOptions(state)+'</select></label>';}
  function universeFilterItems(){
    const state=discovery();if(!state)return [];const f=state.filters;
    return [{key:'q',label:'검색',value:(f.q||'').trim()},{key:'market',label:'시장',value:({KR:'한국 주식',US:'미국 주식'})[f.market]||''},{key:'assetType',label:'유형',value:({stock:'주식',etf:'ETF',reit:'리츠',etn:'ETN',preferred:'우선주',other:'기타'})[f.assetType]||''},{key:'sectorId',label:'섹터',value:f.sectorId?(list(state.sectors).find(item=>item.id===f.sectorId)?.name||f.sectorId):''}];
  }
  function universeFilterSummary(){return renderFilterSummary(universeFilterItems().map(item=>({...item,remove:button('×','universe-clear-filter',item.key,'class="button small workflow-filter-remove" aria-label="'+item.label+' 조건 해제"')})),button('모두 해제','universe-clear-filter','all'));}
  function clearUniverseFilter(id){
    const patch=id==='all'?{q:'',tab:'all',market:'',assetType:'',sectorId:''}:['q','market','assetType','sectorId'].includes(id)?{[id]:''}:null;
    if(!discovery()||!patch)return false;callback('onUniverseFilter',patch);
    const selector=({market:'[data-terminal-market]',assetType:'[data-terminal-universe-filter="assetType"]',sectorId:'[data-terminal-universe-filter="sectorId"]'})[id]||'[data-terminal-search]',target=root?.querySelector(selector);
    (target&&!target.disabled?target:root?.querySelector('[data-terminal-search]'))?.focus?.({preventScroll:true});return true;
  }
  function instrumentSidebar(){
    const state=discovery(),tab=state?.filters.tab||instrumentTab,value=state?.filters.q??search,rows=instrumentRows();
    return `<aside class="terminal-watchlist" id="terminal-instrument-list" aria-label="${state?'전체 종목 탐색':'종목 목록'}"><div class="terminal-list-heading"><h2>${state?'종목 탐색':'현재 종목'}</h2><span data-terminal-universe-count aria-live="polite">${state?universeCount():list(model.instruments).length+'개'}</span></div><div class="terminal-instrument-tabs" aria-label="종목 분류">${[['all',state?'전체':'현재'],['crypto','코인'],['stock','주식'],['watchlist','관심']].map(([id,label])=>button(label,'instrument-tab',id,`aria-pressed="${id===tab}"`)).join('')}</div><label class="terminal-search"><span class="visually-hidden">${state?'전체 종목 검색':'현재 종목 검색'}</span><input type="search" data-terminal-search placeholder="종목명·티커·코드" value="${esc(value)}" aria-label="${state?'전체 종목 검색':'현재 종목 목록 검색'}"></label>${state?'<label class="terminal-market-filter"'+(tab==='crypto'||tab==='watchlist'?' hidden':'')+'><span class="visually-hidden">주식 시장</span><select data-terminal-market aria-label="주식 시장"'+(tab==='crypto'||tab==='watchlist'?' disabled':'')+'>'+[['','전체 시장'],['KR','한국 주식'],['US','미국 주식']].map(([id,label])=>'<option value="'+id+'"'+(state.filters.market===id?' selected':'')+'>'+label+'</option>').join('')+'</select></label><div class="terminal-universe-filters" data-terminal-universe-filters'+(tab==='stock'?'':' hidden')+'>'+universeFilters()+'</div>':''}${state?`<div class="terminal-filter-summary terminal-universe-recovery" data-terminal-facets-feedback${tab==='stock'&&state.facetsError&&!state.facetsLoading?'':' hidden'}>${facetsFeedback()}</div><div class="terminal-filter-summary" data-terminal-filter-summary data-render-key="${esc(JSON.stringify(universeFilterItems()))}">${universeFilterSummary()}</div>`:''}<div class="terminal-instruments-scroll" data-terminal-universe-results aria-busy="${!!state?.loading}"><table class="terminal-instruments" data-terminal-instrument-table${rows?'':' hidden'}><thead><tr><th scope="col">종목</th><th scope="col">${state?'시장 · 시세':'가격 · 시점'}</th></tr></thead><tbody data-terminal-instrument-rows>${rows}</tbody></table><div class="terminal-list-empty" data-terminal-no-instruments ${state?!universeFeedback()?'hidden':'':rows?'hidden':''}>${state?universeFeedback():'검색 결과가 없습니다.'}</div></div>${state?'<div class="terminal-universe-footer" data-terminal-universe-footer'+(state.canPrevious||state.canNext||universeSource()?'':' hidden')+'><div class="terminal-universe-pager" data-terminal-universe-pager role="navigation" aria-label="종목 목록 페이지"'+(state.canPrevious||state.canNext?'':' hidden')+'>'+button('이전','universe-page','previous',(state.loading||!state.canPrevious?'disabled':'')+(!state.canPrevious?' hidden':''))+'<span data-terminal-universe-page>'+(state.page+1)+'쪽</span>'+button('다음','universe-page','next',(state.loading||!state.canNext?'disabled':'')+(!state.canNext?' hidden':''))+'</div><div class="terminal-universe-source" data-terminal-universe-source>'+universeSource()+'</div></div>':''}</aside>`;
  }
  const activityStatus=()=>model.activityStatus??model.status;
  const liveActivityMessage=()=>activityStatus()==='loading'?'운용 기록을 불러오는 중…':activityStatus()==='error'?'운용 기록을 확인할 수 없습니다.':'이 종목의 실전 운용 기록이 없습니다.';
  function rightPane(){
    if(model.executionMode==='live')return '<aside class="terminal-minds" aria-label="선택 종목의 마인드"><div class="terminal-section-heading"><h2>마인드 최근 판단</h2></div><div class="terminal-mind-list">'+list(model.liveActivities).map(item=>{
      const decision=item.lastDecision,market=decision?activityMarket(decision,item):null,weight=decision?.targetWeight;
      const weightMarkup=finite(weight)?'<dl class="terminal-target-weight"><div><dt>목표 비중</dt><dd>'+percent(weight)+'</dd></div></dl>'+(weight>=0&&weight<=1?'<meter class="terminal-weight-meter" min="0" max="1" value="'+weight+'" aria-label="목표 비중" aria-valuetext="'+percent(weight)+'">'+percent(weight)+'</meter>':''):'';
      const actions=hooks.onProfile?button('운용 보기','profile',item.profileId):'';
      return '<section class="terminal-mind-row">'+mindTitle(list(model.profiles).find(p=>p.id===item.profileId)?.name||'마인드',decision?'live-decision:'+item.activationId+':'+decision.id:null,'최근 판단 보기','live:'+item.activationId)+(decision?'<div class="terminal-mind-verdict">'+verdictBadge(decision.action,{judgment:true})+'<span>'+esc(market||'종목 미지정')+'</span></div><div class="terminal-decision-times">'+timeLabel('판단 기준',decision.at)+'</div>'+weightMarkup:'<p class="terminal-muted">첫 판단을 기다리고 있습니다.</p>')+(actions?'<div class="terminal-mind-actions">'+actions+'</div>':'')+'</section>';
    }).join('')+(list(model.liveActivities).length?'':empty(liveActivityMessage()))+'</div></aside>';
    const views=scopedDecisions(),profiles=list(model.profiles).filter(p=>(!model.selectedMindId||model.selectedMindId==='all'||p.id===model.selectedMindId)&&(views.some(v=>v.profileId===p.id)||list(model.mindSummaries).some(v=>v.profileId===p.id&&finite(v.equity)))),instrument={...selected(),...model.instrumentPresentation};
    return '<aside class="terminal-minds" aria-label="선택 종목의 마인드"><div class="terminal-section-heading"><h2>최근 결정</h2><span>'+esc(model.selectedMindId==='all'?'전체 마인드':profiles[0]?.name||'')+'</span></div><div class="terminal-mind-list">'+profiles.map(profile=>{
      const latest=views.find(v=>v.profileId===profile.id),summary=list(model.mindSummaries).find(v=>v.profileId===profile.id),saved=latest?.record,receipt=saved?.execution?.outcomeRecord,after=saved?.execution?.accountSnapshotAfter,before=saved?.accountSnapshot,hasReceipt=receipt?.status==='HOLD'||receipt?.status==='FILLED',beforeQuantity=before?.positions?.find(p=>p.instrumentId===chartInstrumentId())?.quantity??0,afterQuantity=after?.positions?.find(p=>p.instrumentId===chartInstrumentId())?.quantity??0,change=finite(saved?.quantityChange)?saved.quantityChange:before&&after?afterQuantity-beforeQuantity:null,projected=summary?.valuationStatus==='READ_ONLY_COMMON_BASIS',equity=projected?summary.equity:receipt?.equity??summary?.equity,fee=receipt?.feesPaid,equityAsOf=projected?summary.asOf:finite(receipt?.equity)?receipt.asOf||saved?.execution?.accountAsOf||after?.asOf:summary?.asOf,observed=!!saved?.observation;
      const observationLabel=observed?'후속 관측 완료':saved?.observationState==='WAITING_TIME'?'후속 관측 대기':saved?.observationState==='DATA_REQUIRED'?'후속 자료 확인':'후속 관측',retryable=terminalExecutionRetryable(saved);
      const reviewAction=(latest?.outcome==='PAPER_REVIEW_READY'||retryable)&&hooks.onPaperReview?button(retryable?'모의 실행 다시 시도':'모의 주문','paper-review',latest.id):'';
      const detailsActions=latest?(hooks.onObservation?button(observationLabel,'observation',latest.id):'')+(hooks.onProfile?button('마인드 관리','profile',profile.id):''):'';
      return '<section class="terminal-mind-row"><div>'+mindTitle(profile.name,latest?.id,'실행 상세 보기','paper:'+profile.id)+'</div>'+(latest?'<div class="terminal-mind-verdict">'+verdictBadge(latest.action,{failed:latest.failed})+'<span>'+esc(({normal:'보통',clutch:'기회 집중',defensive:'방어'})[latest.stance]||'')+'</span></div><p class="terminal-mind-receipt">'+esc(hasReceipt?(receipt.status==='HOLD'?'보유량 유지 · 추가 주문 0건':'모의 체결 1건'):saved?.execution?.status==='WAITING_EXECUTION_DATA'?'실행 시세 대기':'주문 결과 확인')+(change!==null?' · 보유 변화 '+number(change,6):'')+'</p>':'<p class="terminal-muted">저장된 결정이 없습니다.</p>')+(finite(equity)?'<dl class="terminal-mind-account"><dt>계좌 평가자산</dt><dd>'+currencyAmount(equity,receipt?.currency||summary?.quoteCurrency||instrument.quoteCurrency)+' '+esc(receipt?.currency||summary?.quoteCurrency||instrument.quoteCurrency||'')+'</dd></dl><div class="terminal-equity-asof">'+timeLabel('평가 기준',equityAsOf)+'</div>':'')+(!hasReceipt&&saved?.execution?.reason?'<p class="terminal-muted" role="status">'+esc(saved.execution.reason)+'</p>':'')+(reviewAction?'<div class="terminal-mind-actions">'+reviewAction+'</div>':'')+(latest?'<details class="terminal-decision-details"><summary>결정 정보</summary><div class="terminal-decision-times">'+timeLabel('기준 봉',latest.at)+decisionTime(latest)+(saved?.execution?.at?timeLabel('모의 실행',saved.execution.at):'')+'</div><p class="terminal-mind-inputs">적용 원칙 '+count(latest.ruleCount)+' · 기억 '+count(latest.memoryCount)+' · 공용 자료 '+count(latest.externalKnowledgeCount)+'</p>'+(finite(equity)?'<dl class="terminal-mind-account"><dt>'+(hasReceipt?'이번 체결 수수료':'누적 수수료')+'</dt><dd>'+currencyAmount(hasReceipt?fee:summary?.feesPaid,receipt?.currency||summary?.quoteCurrency||instrument.quoteCurrency)+'</dd></dl>':'')+(saved?.observationDueAt?'<p class="terminal-mind-asof">관측 예정 '+esc(stamp(saved.observationDueAt))+'</p>':'')+(detailsActions?'<div class="terminal-mind-actions">'+detailsActions+'</div>':'')+'</details>':'')+'</section>';
    }).join('')+(profiles.length?'':empty('이 종목의 결정 기록이 없습니다.'))+'</div></aside>';
  }
  function records(){
    const views=scopedDecisions(),tab=model.recordView||recordView;
    if(model.executionMode==='live'&&tab==='decisions'){
      const activities=list(model.liveActivities).filter(item=>(!model.selectedMindId||model.selectedMindId==='all'||item.profileId===model.selectedMindId)&&list(item.marketIds).some(market=>'crypto:upbit:'+market===chartInstrumentId()));
      const feeds=activities.map(item=>{
        const name=list(model.profiles).find(profile=>profile.id===item.profileId)?.name||'마인드',title=name+' · 종목 기록',recentActivity=liveActivitySources(item,chartInstrumentId());
        return recentActivity.length?renderMindActivityFeed({...item,recentActivity},{limit:10,executionMode:'live',title}):'';
      }).join('');
      const feedback=activityStatus()==='loading'||activityStatus()==='error'?liveActivityMessage():activities.length?'이 종목의 판단·거래 기록이 없습니다.':liveActivityMessage();
      if(activityStatus()==='error')return feeds+'<div class="terminal-empty terminal-record-feedback" role="alert"><span>'+esc(feedback)+'</span>'+(hooks.onRefresh?button('다시 조회','refresh'):'')+'</div>';
      return feeds||empty(feedback);
    }
    if(tab==='positions'){
      const positions=list(model.positions).filter(p=>(!p.instrumentId||p.instrumentId===chartInstrumentId())&&(!model.selectedMindId||model.selectedMindId==='all'||p.profileId===model.selectedMindId));
      return positions.length?table(['마인드','수량','평가자산','평가손익','수수료','기준 시점'],positions.map(p=>`<tr><td class="terminal-name-cell" title="${esc(p.profileName||list(model.profiles).find(v=>v.id===p.profileId)?.name||'—')}">${esc(p.profileName||list(model.profiles).find(v=>v.id===p.profileId)?.name||'—')}</td><td>${number(p.quantity,8)} ${esc(selected()?.baseAsset||'')}</td><td>${currencyAmount(p.equity,p.quoteCurrency||selected()?.quoteCurrency)}</td><td class="${p.pnl<0?'terminal-negative':'terminal-positive'}">${currencyAmount(p.pnl,p.quoteCurrency||selected()?.quoteCurrency)}</td><td>${currencyAmount(p.feesPaid,p.quoteCurrency||selected()?.quoteCurrency)}</td><td>${esc(stamp(p.asOf))}</td></tr>`)):empty('이 종목의 '+(model.executionMode==='live'?'실전 보유 내역':'모의 포지션')+'이 없습니다.');
    }
    if(tab==='knowledge'){
      const items=list(model.knowledge).map(k=>{const doc=k.document||k,scope=doc.scope||k.scope||{},metrics=k.metrics||doc.data?.metrics,netReturn=finite(metrics?.netReturn)?metrics.netReturn:k.netReturn??k.observation?.performance?.netReturn,excessReturn=finite(metrics?.netReturn)&&finite(metrics?.benchmarkReturn)?metrics.netReturn-metrics.benchmarkReturn:k.excessReturn;return {...k,title:doc.title||k.title,kind:doc.kind||k.kind,profileId:k.profileId||k.investmentProfileId||scope.profileId,instrumentIds:k.instrumentIds||scope.instrumentIds,knowledgeType:k.knowledgeType||doc.provenance?.classification?.choices?.knowledgeType,netReturn,excessReturn};}).filter(k=>(!k.instrumentId||k.instrumentId===chartInstrumentId())&&(!list(k.instrumentIds).length||k.instrumentIds.includes(chartInstrumentId()))&&(!model.selectedMindId||model.selectedMindId==='all'||k.profileId===model.selectedMindId));
      return items.length?table(['기록','마인드','유형','상태','수익률 / 기준 대비',''],items.map(k=>`<tr><td><strong>${esc(k.title||k.summary||'투자 경험')}</strong><small>${esc(k.preview||'')}</small></td><td>${esc(k.profileName||list(model.profiles).find(v=>v.id===k.profileId)?.name||'공통')}</td><td>${esc(formName(k.kind)||({OBSERVED_FACT:'관측 사실',HYPOTHESIS:'가설',VALIDATED_HEURISTIC:'검증된 경험칙',OPERATING_PROCEDURE:'운영 절차'})[k.knowledgeType]||'경험')}</td><td>${esc(({DRAFT:'검토 대기',PUBLISHED:'발행됨',REJECTED:'반려',REVIEW_REQUIRED:'승인 검토',AWAITING_OBSERVATION:'관측 대기',OBSERVED:'평가 대기',EVALUATED:'평가 완료',CANDIDATE:'검증 대기',VALIDATED:'승인 검토',APPROVED:'승인됨'})[k.status]||'검토 상태 확인')}</td><td>${percent(k.netReturn??k.observation?.performance?.netReturn)} / ${percentagePoints(k.excessReturn)}</td><td>${hooks.onKnowledge?button('열기','knowledge',k.id):''}</td></tr>`)):empty('저장된 경험·지식이 없습니다.');
    }
    return views.length?table(['기준 봉 / 결정 시각','마인드','행동','결정 방식·지표','기준 종가','규칙 / 기억 / 자료 '+helpTooltip('판단 입력 건수','JEV 판단에 실제 전달한 원칙, 승인된 개인 기억, 공용 투자 자료의 건수를 순서대로 표시합니다. 전송 기록이 없으면 —로 표시합니다.',{id:'terminal-decision-input-counts-help'}),'실행 결과',''],views.slice(0,model.pageSize||50).map(v=>`<tr data-terminal-decision-row="${esc(v.id)}"><td>${timeLabel('기준 봉',v.at)}<div class="terminal-record-time">${decisionTime(v)}</div></td><td class="terminal-name-cell" title="${esc(v.profileName)}">${esc(v.profileName)}</td><td>${verdictBadge(v.action,{failed:v.failed})}</td><td class="terminal-numeric-cell">${esc(authorityName(v))}${nonProbabilistic(v)?'<small>'+esc(ruleMeasureLabel(v)+' '+ruleMeasureValue(v))+'</small>':''}</td><td class="terminal-numeric-cell">${currencyAmount(v.price,v.quoteCurrency)}</td><td>${count(v.ruleCount)} / ${count(v.memoryCount)} / ${count(v.externalKnowledgeCount)}</td><td><span class="terminal-decision-result" title="${esc(outcomeName(v.outcome))}">${esc(outcomeName(v.outcome))}</span></td><td>${button('상세','decision',v.id)}</td></tr>`),{className:'terminal-decision-table'}):empty('선택한 종목·마인드의 결정 기록이 없습니다.');
  }
  function valuationControls(){
    if(!hooks.onValuation||model.source==='replay'||model.executionMode==='live')return '';const v=model.valuation,loading=v?.status==='LOADING',identity=model.selectedMindId==='all'?'전체 마인드':list(model.profiles).find(p=>p.id===model.selectedMindId)?.name||'선택 마인드';
    return (loading?'<p class="terminal-aggregate-pending" role="status">보유 종목의 현재가를 조회하는 중…</p>':v?.status==='ERROR'?'<p class="terminal-aggregate-pending" role="alert">평가 갱신 실패 · '+esc(v.message)+'</p>':v?.status==='EMPTY'?'<p class="terminal-aggregate-pending">이 범위에 연결한 모의 계좌가 없습니다.</p>':v?.status==='DATA_REQUIRED'?'<div class="terminal-aggregate-pending" role="alert"><strong>평가 자료 확인 필요</strong>'+list(v.failures).map(f=>'<p>'+esc(list(model.instruments).find(i=>i.id===f.instrumentId)?.symbol||f.instrumentId||'계좌')+' · '+esc(({okx:'OKX',kis:'한국투자증권'})[f.provider]||f.provider||'공급처 확인')+' · '+esc(f.message)+' · '+esc(quoteStamp(f.checkedAt))+(f.httpStatus?' · HTTP '+esc(f.httpStatus):'')+(f.providerCode?' · '+esc(f.providerCode):'')+(f.retryAfter?' · 재요청 기준 '+esc(/^\d+$/.test(f.retryAfter)?f.retryAfter+'초':f.retryAfter):'')+'</p>').join('')+'</div>':v?.status==='READY'?'<details class="terminal-aggregate-pending"><summary>평가 자료 · '+esc(quoteStamp(v.basisAt))+'</summary>'+helpTooltip('평가 합계','각 종목의 현재가가 조회 기준 30초 이내인 경우 합산합니다.',{id:'terminal-valuation-help'})+table(['종목','평가 가격','시세 기준','실제 수신'],list(v.quotes).map(q=>'<tr><td>'+esc(list(model.instruments).find(i=>i.id===q.instrumentId)?.symbol||q.instrumentId)+'</td><td>'+currencyAmount(q.price,q.currency)+' '+esc(q.currency)+'</td><td>'+esc(quoteStamp(q.asOf))+'</td><td>'+esc(quoteStamp(q.receivedAt))+'</td></tr>'))+'</details>':'');
  }
  function actionsMenu(){
    const profileId=model.selectedMindId==='all'?'':model.selectedMindId;
    const items=[hooks.onRefresh?button('새로고침','refresh','','aria-label="종목·시세·기록 새로고침"'+(model.status==='loading'?' disabled':'')):'',hooks.onValuation&&model.source!=='replay'&&model.executionMode!=='live'?button(model.valuation?.status==='LOADING'?'평가 조회 중…':'평가 갱신','valuation','',model.valuation?.status==='LOADING'?'disabled':''):'',hooks.onProfile?button('마인드 관리','profile',profileId):'',hooks.onAccount&&model.executionMode!=='live'?button('모의 자금','account'):'',hooks.onImport?button('가져오기','import'):'',hooks.onExport?button('내보내기','export',profileId):''].filter(Boolean);
    return items.length?'<details class="terminal-actions-menu" data-terminal-menu><summary aria-label="트레이딩 추가 작업">···</summary><div class="terminal-actions-panel" role="group" aria-label="추가 작업">'+items.join('')+'</div></details>':'';
  }
  function recoveryButton(context='run'){
    const action=terminalRecoveryAction(model,{context});if(!action)return '';
    const hook={account:'onAccount',connections:'onConnections',profile:'onProfile',refresh:'onRefresh',data:'onData'}[action.action];
    if(hook&&!hooks[hook])return '';
    return button(action.label,action.canonical?'chart-recovery':action.action,action.action==='profile'?model.selectedMindId:'',action.action==='wait'?'disabled':'');
  }
  function render(nextModel={}){
    model={selectedMindId:'all',timeframe:'4h',status:'ready',...nextModel};
    const instrument={...selected(),...model.instrumentPresentation},series=candles(),last=series.at(-1),markerCount=markerViews().length,executionView=scopedDecisions().find(v=>finite(v.record?.execution?.quote?.price)),executionQuote=executionView?.record?.execution?.quote,nextCloseAt=instrument?.assetClass==='crypto'&&model.source!=='replay'&&last&&timeframeMs(model.timeframe)?last.closeAt+timeframeMs(model.timeframe):null;
    const sources=list(model.sources).length?model.sources:[{id:model.source||instrument?.venue||'',name:model.sourceLabel||instrument?.venue||'공급처 대기'}],tab=model.recordView||recordView,primary=terminalPrimaryAction(model),requirement=terminalRunRequirement(model),requirements=['MIND_SELECTION_REQUIRED','MIND_REQUIRED'].includes(requirement?.code)?null:requirement;
    const readiness=model.terminalReadiness?.executionReadiness;
    const alternate=model.executionMode!=='live'&&list(readiness?.blockers).some(reason=>reason.code==='JEV_CONNECTION_REQUIRED'||reason.category==='JEV_AUTH');
    const failedEventId=requirement?.category==='JEV_AUTH'?requirement.action?.params?.eventId:null;
    const disclosure=primary.action==='run'&&readiness?.requiresJev===true?'실행하면 선택한 시세·마인드 입력을 JEV에 보내며 공급자 이용료가 발생할 수 있습니다.':'';
    const equityDay=instrument?.assetClass==='equity'&&validTradeDate(last?.tradeDate)?last.tradeDate:null,tossEquity=instrument?.assetClass==='equity'&&model.sourceSnapshot?.provider==='toss';
    const footerBasis=tossEquity?(model.sourceSnapshot.adjustment==='PROVIDER_ADJUSTED'?'수정주가':model.sourceSnapshot.adjustment==='UNADJUSTED'?'원주가':'일봉'):model.dataModeLabel||'확정 봉',footerMessage=tossEquity&&model.statusMessage==='거래일 일봉 · 종가 참고 자료'?'':model.statusMessage||'';
    const priceHelp=[equityDay?'거래일 '+equityDay+' · 확정 판정 기준 '+stamp(last.closeAt):'',equityDay&&model.sourceSnapshot?.receivedAt?'원문 수신 '+stamp(model.sourceSnapshot.receivedAt):'',nextCloseAt?'다음 확정 '+stamp(nextCloseAt):'',executionQuote?'최근 실행 시세 '+currencyAmount(executionQuote.price,executionQuote.currency||instrument?.quoteCurrency,instrument?.priceDecimals??2)+' '+(executionQuote.currency||instrument?.quoteCurrency||'')+' · 시세 기준 '+stamp(executionQuote.asOf):''].filter(Boolean).join(' · ');
    return `<section class="trading-terminal${chartExpanded?' is-chart-expanded':''}${recordsExpanded?' is-records-expanded':''}${instrumentPickerOpen?' is-instrument-picker-open':''}" data-terminal-root aria-label="트레이딩">
      <header class="terminal-header">
        <div class="terminal-market-heading"><div class="terminal-symbol-line"><h1 tabindex="-1"><button type="button" data-terminal-action="instrument-picker" aria-label="종목 변경" aria-expanded="${instrumentPickerOpen}" aria-controls="terminal-instrument-list" title="${esc(instrument?.name||'종목 선택')}">${esc(instrument?.symbol||'종목 선택')}<span aria-hidden="true">⌄</span></button></h1><span class="terminal-venue">${esc(instrument?.venue||model.sourceLabel||'')}</span></div>${instrument?.name&&instrument.name!==instrument.symbol?`<span class="terminal-asset-name" title="${esc(instrument.name)}">${esc(instrument.name)}</span>`:''}</div>
        <div class="terminal-price-pair"><div class="terminal-market-price"><strong title="${esc(instrument?.price??last?.close)}">${priceNumber(instrument?.price??last?.close,instrument)}</strong><span>${esc(instrument?.quoteCurrency||'')}</span>${finite(instrument?.change24h)?`<span class="${instrument.change24h<0?'terminal-negative':'terminal-positive'}">${percent(instrument.change24h)} <small>24h</small></span>`:''}</div><div class="terminal-price-label">${esc(equityDay?'거래일 종가':model.priceBasisLabel||'확정 봉 종가')}<span class="terminal-header-asof">${equityDay?tradeDateMarkup(equityDay):'<time datetime="'+esc(iso(last?.closeAt||instrument?.asOf)||'')+'" title="'+esc(stamp(last?.closeAt||instrument?.asOf))+'">'+esc(compactStamp(last?.closeAt||instrument?.asOf))+'</time>'}</span>${priceHelp?helpTooltip('가격 기준',priceHelp,{id:'terminal-price-help'}):''}</div></div>
        <div class="terminal-mind-filter"><label class="visually-hidden" for="terminal-mind-select">마인드</label><select id="terminal-mind-select" data-terminal-mind aria-label="트레이딩 마인드"><option value="all"${model.selectedMindId==='all'?' selected':''}>모든 마인드</option>${list(model.profiles).filter(p=>p.status!=='ARCHIVED'&&!p.archived||p.id===model.selectedMindId).map(p=>`<option value="${esc(p.id)}"${model.selectedMindId===p.id?' selected':''}${p.status==='ARCHIVED'||p.archived?' disabled':''}>${esc(p.name)}${p.status==='ARCHIVED'||p.archived?' · 보관됨':''}</option>`).join('')}</select></div>
        <div class="terminal-header-actions">${hooks.onRun&&!(primary.action==='choose-mind'&&model.selectedMindId==='all')?button(primary.label==='운용 보기'?'마인드 열기':primary.label,primary.canonical&&primary.action!=='run'?'run-recovery':primary.action,primary.action==='profile'?model.selectedMindId:instrument?.id||'',`class="terminal-primary-action"${primary.disabled?' disabled':''}${(disclosure||requirements?.message&&!requirements.message.includes('실전 운용은 마인드에서'))?' aria-describedby="terminal-run-message"':''}`):''}${actionsMenu()}</div>
      </header>
      ${disclosure||requirements?.message&&!requirements.message.includes('실전 운용은 마인드에서')?`<div class="terminal-run-requirement" id="terminal-run-requirement" tabindex="-1"><span id="terminal-run-message" role="status">${esc(disclosure||requirements.message)}</span>${requirements?.action?.nextEligibleAt?timeLabel('다음 실행',requirements.action.nextEligibleAt):''}${failedEventId?button('요청 기록 확인','provider-failure',failedEventId):''}${alternate?'<a class="button small" href="'+esc(paperPracticeEntry(model.selectedMindId))+'" data-studio-route>키 없이 과거 데이터로 실습</a>':''}</div>`:''}
      <div class="terminal-layout">
        ${instrumentSidebar()}
        <div class="terminal-center">
          <div class="terminal-chart-tools"><label class="terminal-timeframes"><span class="visually-hidden">캔들 주기</span><select data-terminal-timeframe aria-label="캔들 주기">${(list(model.supportedTimeframes).length?list(model.supportedTimeframes):['1h','4h','1d']).map(id=>`<option value="${id}"${String(model.timeframe).toLowerCase()===id?' selected':''}>${({'1m':'1분','3m':'3분','5m':'5분','1h':'1시간','4h':'4시간','1d':'일봉'})[id]||id}</option>`).join('')}</select></label>${sources.length>1?`<label class="terminal-source-select"><span class="visually-hidden">시세 공급처</span><select data-terminal-source aria-label="시세 공급처">${sources.map(s=>`<option value="${esc(s.id)}"${s.id===model.source?' selected':''}>${esc(s.name||s.label||s.id)}</option>`).join('')}</select></label>`:`<span class="terminal-source-name">${esc(sources[0]?.name||sources[0]?.label||'')}</span>`}${list(model.scopes).length>1?`<label class="terminal-scope-select"><span>자료</span><select data-terminal-scope aria-label="시세·운용 범위">${model.scopes.map(s=>`<option value="${esc(s.id)}"${s.id===model.selectedScope?' selected':''}>${esc(s.label)}</option>`).join('')}</select></label>`:''}<div class="terminal-chart-layout-actions">${button('화면 맞춤','fit','','aria-label="캔들 전체 기간 보기"')}${button(chartExpanded?'원장 펼치기':'차트 확대','chart-layout','',`aria-pressed="${chartExpanded}" aria-controls="terminal-records"`)}</div></div>
          <div class="terminal-ohlc" data-terminal-ohlc>${last?ohlc(last):'<span>'+(model.status==='loading'?'시세를 불러오는 중…':'가격 데이터 대기')+'</span>'}</div><div class="terminal-chart-frame"><div class="terminal-chart" data-terminal-chart tabindex="0" role="img" aria-label="${esc(instrument?.symbol||'선택 종목')} ${esc(String(model.timeframe).toUpperCase())} 캔들 및 거래량 차트" aria-describedby="terminal-chart-help"></div><p class="visually-hidden" id="terminal-chart-help">마우스 휠과 두 손가락으로 확대·축소합니다. 방향키로 봉을 탐색하고 Enter로 결정 미리보기를 고정합니다. 더하기·빼기로 확대·축소하고 Home으로 전체 기간을 봅니다.</p><div class="terminal-chart-message" data-terminal-chart-message${series.length&&model.status!=='loading'?' hidden':''}${model.error?' role="alert"':''}><strong>${esc(terminalMarketMessage(model))}</strong>${model.error?recoveryButton('chart'):model.status!=='loading'&&hooks.onRefresh?button('시세 조회','refresh'):''}</div><div class="terminal-chart-popover" id="terminal-chart-popover" data-terminal-popover hidden></div></div>
          <div class="terminal-chart-footer"><label class="terminal-ranges"><span class="visually-hidden">차트 표시 범위</span><select data-terminal-range aria-label="차트 표시 범위">${[['30','30봉'],['90','90봉'],['all','전체']].map(([id,label])=>`<option value="${id}"${id===selectedRange?' selected':''}>${label}</option>`).join('')}</select></label><span class="terminal-marker-legend"><i class="terminal-buy">▲ 매수</i><i class="terminal-sell">▼ 매도</i><i class="terminal-hold">● 유지</i><span>${markerCount}개</span></span>${helpTooltip('차트 조작','봉 위의 결정을 눌러 상세를 열 수 있습니다. 방향키로 봉 이동, Enter로 결정 고정, Home으로 전체 기간을 봅니다.',{id:'terminal-chart-controls-help'})}</div>
          ${valuationControls()}${model.summary?`<dl class="terminal-account-line" aria-label="${model.selectedMindId==='all'?'전체 마인드':'선택 마인드'} 계좌 합계"><div><dt>평가자산</dt><dd>${currencyAmount(model.summary.equity,model.summary.quoteCurrency||model.quoteCurrency)} <small>${esc(model.summary.quoteCurrency||model.quoteCurrency||'')}</small></dd></div><div><dt>순손익</dt><dd class="${model.summary.pnl<0?'terminal-negative':'terminal-positive'}">${currencyAmount(model.summary.pnl,model.summary.quoteCurrency||model.quoteCurrency)}</dd></div><div><dt>수익률</dt><dd>${percent(model.summary.totalReturn)}</dd></div><div><dt>수수료</dt><dd>${currencyAmount(model.summary.feesPaid,model.summary.quoteCurrency||model.quoteCurrency)}</dd></div><div class="terminal-account-asof"><dt>평가 기준</dt><dd>${iso(model.summary.asOf)?`<time datetime="${esc(iso(model.summary.asOf))}">${esc(stamp(model.summary.asOf))}</time>`:'시각 미기록'}</dd></div></dl>`:model.aggregationStatus==='ASOF_ALIGNMENT_REQUIRED'?'<p class="terminal-aggregate-pending" role="status">평가 기준 시점 확인 필요</p>':''}
          <div class="terminal-records" id="terminal-records"><div class="terminal-record-tabs" aria-label="종목 기록">${[['decisions','결정 기록'],['positions','포지션'],['knowledge','경험·지식']].map(([id,label])=>button(label,'tab',id,`aria-pressed="${id===tab}"`)).join('')}${button(recordsExpanded?'차트 함께 보기':'기록 확대','records-layout','',`aria-pressed="${recordsExpanded}" aria-controls="terminal-records" class="terminal-record-layout"`)}</div><div data-terminal-records class="terminal-records-body">${records()}</div>${model.nextCursor&&hooks.onMore?`<div class="terminal-record-footer">${button('더 보기','more',model.nextCursor)}</div>`:''}</div>
        </div>${rightPane()}
      </div><footer class="terminal-status"><span class="terminal-connection terminal-${model.status==='error'?'failed':model.status==='loading'?'loading':'connected'}">${esc(model.status==='error'?'시세 연결 확인':model.status==='loading'?'시세 조회 중':model.sourceLabel||instrument?.venue||'출처 확인 필요')}</span><span>${esc(footerBasis)} · ${series.length}봉</span><span>${esc(footerMessage)}</span><a class="terminal-attribution" href="https://www.tradingview.com/" target="_blank" rel="noopener noreferrer">TradingView</a></footer>
    </section>`;
  }
  function ohlc(bar){return `${selected()?.assetClass==='equity'&&validTradeDate(bar.tradeDate)?tradeDateMarkup(bar.tradeDate):'<time>'+esc(stamp(bar.closeAt))+'</time>'}${[['시',bar.open],['고',bar.high],['저',bar.low],['종',bar.close]].map(([label,value])=>`<span>${label} <strong>${priceNumber(value,selected())}</strong></span>`).join('')}<span>거래량 <strong>${number(bar.volume,2)}</strong></span>`;}
  function bind(name,listener){root.addEventListener(name,listener);listeners.push([name,listener]);}
  function hidePopover({restoreFocus=false}={}){const node=root?.querySelector('[data-terminal-popover]');if(node){node.hidden=true;node.removeAttribute('role');}pinned=false;lastPopover=[];root?.querySelector('[data-terminal-chart]')?.setAttribute('aria-describedby','terminal-chart-help');if(restoreFocus)(lastTrigger?.isConnected?lastTrigger:root?.querySelector('[data-terminal-chart]'))?.focus();}
  function showPopover(views,point,{pin=false,trigger=null}={}){
    const node=root?.querySelector('[data-terminal-popover]'),frame=root?.querySelector('.terminal-chart-frame');if(!node||!frame||!views.length)return;
    if(pinned&&!pin)return;
    const wasPinned=pinned;pinned=pin;lastPopover=views;lastTrigger=trigger||lastTrigger;
    node.innerHTML=terminalTooltipContent(views,{pinned});node.hidden=false;node.setAttribute('role',pinned?'dialog':'tooltip');node.setAttribute('aria-label','결정 미리보기');node.classList.toggle('is-pinned',pinned);
    const inset=pixelToken('--terminal-popover-inset',root),offsetX=pixelToken('--terminal-popover-offset-x',root),offsetY=pixelToken('--terminal-popover-offset-y',root);
    const width=Math.max(0,Math.min(pixelToken(pinned?'--terminal-popover-pinned-width':'--terminal-popover-width',root),frame.clientWidth-inset-inset)),x=point?.x??frame.clientWidth-width-offsetY,y=point?.y??offsetY;
    node.style.width=width+'px';node.style.left=Math.max(inset,Math.min(frame.clientWidth-width-inset,x+offsetX))+'px';node.style.top=Math.max(inset,Math.min(Math.max(inset,frame.clientHeight-node.offsetHeight-inset),y+offsetY))+'px';
    root.querySelector('[data-terminal-chart]')?.setAttribute('aria-describedby',pinned?'terminal-chart-help':'terminal-chart-help terminal-chart-popover');
    if(pinned&&!wasPinned)node.querySelector('button')?.focus();
  }
  function setRange(value){
    selectedRange=value;const selector=root?.querySelector('[data-terminal-range]');if(selector)selector.value=value;const series=candles();if(!chart||!series.length)return;
    if(value==='all')chart.timeScale().fitContent();else chart.timeScale().setVisibleLogicalRange({from:Math.max(-numberToken('--terminal-chart-bar-center',root),series.length-Number(value)-numberToken('--terminal-chart-bar-center',root)),to:series.length+numberToken('--terminal-chart-range-tail',root)});
    root?.querySelectorAll('[data-terminal-action="range"]').forEach(node=>node.setAttribute('aria-pressed',String(node.dataset.terminalId===value)));
  }
  function click(event){
    const target=event.target.closest?.('[data-terminal-action]');if(!target||!root?.contains(target)||target.disabled)return false;
    const action=target.dataset.terminalAction,id=target.dataset.terminalId;event.preventDefault();
    closeMenus();
    if(action==='instrument'){focusInstrumentHeading=true;setInstrumentPickerOpen(false);callback('onSelectInstrument',id);}
    else if(action==='instrument-picker')setInstrumentPickerOpen(!instrumentPickerOpen);
    else if(action==='mind')callback('onSelectMind',id);
    else if(action==='timeframe')callback('onTimeframe',id);
    else if(action==='decision'){hidePopover();callback('onDecision',id);}
    else if(action==='knowledge')callback('onKnowledge',id);
    else if(action==='profile')callback('onProfile',id);
    else if(action==='browse-instruments')callback('onBrowseInstruments');
    else if(action==='watchlist')callback('onWatchlist',id,!(instrumentCollection().find(i=>i.id===id)||list(model.instruments).find(i=>i.id===id))?.watched);
    else if(action==='refresh')callback('onRefresh');
    else if(action==='data')callback('onData');
    else if(action==='run-recovery'||action==='chart-recovery'){const recovery=action==='run-recovery'?terminalPrimaryAction(model):terminalRecoveryAction(model,{context:'chart'});if(recovery&&!recovery.disabled&&recovery.action!=='run'&&recovery.action!=='wait')callback('onRecovery',recovery);}
    else if(action==='provider-failure')callback('onRecovery',{action:'records',params:{eventId:id}});
    else if(action==='inspect-conditions')root.querySelector('#terminal-run-requirement')?.focus();
    else if(action==='choose-mind'){const picker=root.querySelector('[data-terminal-mind]');picker?.focus();try{picker?.showPicker?.();}catch{}}
    else if(action==='run'){const primary=terminalPrimaryAction(model);if(primary.action!=='run'||primary.disabled)return false;callback('onRun',id,model.selectedMindId||'all');}
    else if(action==='connections')callback('onConnections');
    else if(action==='account')callback('onAccount',model.selectedMindId||'all');
    else if(action==='paper-review')callback('onPaperReview',id);
    else if(action==='observation')callback('onObservation',id);
    else if(action==='import')callback('onImport');
    else if(action==='export')callback('onExport',id);
    else if(action==='more')callback('onMore',id);
    else if(action==='popover-close')hidePopover({restoreFocus:true});
    else if(action==='fit')setRange('all');
    else if(action==='chart-layout'){setRecordsExpanded(false);setChartExpanded(!chartExpanded);}
    else if(action==='records-layout'){setChartExpanded(false);setRecordsExpanded(!recordsExpanded);}
    else if(action==='range')setRange(id);
    else if(action==='instrument-tab'){if(discovery())callback('onUniverseFilter',{tab:id});else{instrumentTab=id;root.querySelectorAll('[data-terminal-action="instrument-tab"]').forEach(n=>n.setAttribute('aria-pressed',String(n.dataset.terminalId===id)));updateInstrumentRows();}}
    else if(action==='universe-clear-filter')return clearUniverseFilter(id);
    else if(action==='universe-page')return universeReadWithFocus('onUniversePage','universe-page',id);
    else if(action==='universe-retry')return universeReadWithFocus('onUniverseRetry','universe-retry');
    else if(action==='universe-collect-sector')callback('onUniverseCollectSector');
    else if(action==='universe-collect-catalog')return universeReadWithFocus('onUniverseCollectCatalog','universe-collect-catalog');
    else if(action==='valuation'){if(model.valuation?.status!=='LOADING')callback('onValuation');}
    else if(action==='tab'){setChartExpanded(false);recordView=id;model.recordView=id;root.querySelectorAll('[data-terminal-action="tab"]').forEach(n=>n.setAttribute('aria-pressed',String(n.dataset.terminalId===id)));root.querySelector('[data-terminal-records]').innerHTML=records();callback('onTab',id);}
    return true;
  }
  async function universeReadWithFocus(callbackName,errorAction,direction){
    const instrumentId=model.selectedInstrumentId,mindId=model.selectedMindId||'all',filters=JSON.stringify(discovery()?.filters);
    await callback(callbackName,direction);
    const doc=globalThis.document;
    if(!root||!doc||doc.activeElement!==doc.body||model.selectedInstrumentId!==instrumentId||(model.selectedMindId||'all')!==mindId||JSON.stringify(discovery()?.filters)!==filters||doc.querySelector?.('dialog[open]'))return;
    let target;
    if(errorAction==='universe-page')target=discovery()?.error?root.querySelector('[data-terminal-action="universe-retry"]'):root.querySelector('[data-terminal-action="universe-page"][data-terminal-id="'+direction+'"]:not(:disabled)')||root.querySelector('[data-terminal-action="universe-page"]:not(:disabled)');
    else target=root.querySelector((errorAction==='universe-retry'?discovery()?.error:discovery()?.collectionError)?'[data-terminal-action="'+errorAction+'"]':'[data-terminal-search]');
    target=target||root.querySelector('[data-terminal-search]');
    target?.focus?.({preventScroll:true});
  }
  function updateInstrumentRows(){
    if(!root)return;const rows=instrumentRows(),body=root.querySelector('[data-terminal-instrument-rows]'),emptyNode=root.querySelector('[data-terminal-no-instruments]');
    if(body&&body.dataset.renderKey!==rows){const doc=globalThis.document,active=doc?.activeElement,control=body.contains?.(active)&&active?.matches?.('[data-terminal-action="instrument"],[data-terminal-action="watchlist"]')?{action:active.dataset.terminalAction,id:active.dataset.terminalId}:null;body.innerHTML=rows;body.dataset.renderKey=rows;
      if(control&&doc.activeElement===doc.body){const replacement=[...body.querySelectorAll('[data-terminal-action]')].find(node=>node.dataset.terminalAction===control.action&&node.dataset.terminalId===control.id);(replacement||root.querySelector('[data-terminal-search]'))?.focus?.({preventScroll:true});}
    }
    const table=root.querySelector('[data-terminal-instrument-table]');if(table)table.hidden=!rows;
    if(emptyNode){const feedback=discovery()?universeFeedback():'';emptyNode.hidden=discovery()?!feedback:!!rows;if(discovery()&&emptyNode.dataset.renderKey!==feedback){emptyNode.innerHTML=feedback;emptyNode.dataset.renderKey=feedback;}}
  }
  function updateUniverse(next){
    model.instrumentUniverse=next;if(!root)return;
    updateInstrumentRows();const countNode=root.querySelector('[data-terminal-universe-count]'),pageNode=root.querySelector('[data-terminal-universe-page]'),sourceNode=root.querySelector('[data-terminal-universe-source]'),marketNode=root.querySelector('[data-terminal-market]'),queryNode=root.querySelector('[data-terminal-search]');
    if(countNode)countNode.textContent=universeCount();if(pageNode)pageNode.textContent=(next.page+1)+'쪽';if(sourceNode)sourceNode.innerHTML=universeSource();
    if(queryNode&&queryNode!==globalThis.document?.activeElement)queryNode.value=next.filters.q;
    if(marketNode){marketNode.value=next.filters.market;marketNode.disabled=['crypto','watchlist'].includes(next.filters.tab);marketNode.closest('label').hidden=marketNode.disabled;}
    const filtersNode=root.querySelector('[data-terminal-universe-filters]');if(filtersNode){
      filtersNode.hidden=next.filters.tab!=='stock';
      const assetType=filtersNode.querySelector('[data-terminal-universe-filter="assetType"]'),sector=filtersNode.querySelector('[data-terminal-universe-filter="sectorId"]');
      if(assetType)assetType.value=next.filters.assetType;
      if(sector){const key=JSON.stringify([next.filters.sectorId,next.facetsLoading,next.facetsError,list(next.sectors).map(({id,name})=>[id,name])]);if(sector.dataset.renderKey!==key){sector.innerHTML=sectorOptions(next);sector.dataset.renderKey=key;}sector.value=next.filters.sectorId;sector.disabled=!!next.facetsLoading;}
    }
    const facetsNode=root.querySelector('[data-terminal-facets-feedback]');if(facetsNode){facetsNode.hidden=next.filters.tab!=='stock'||!next.facetsError||!!next.facetsLoading;const feedback=facetsFeedback();if(facetsNode.dataset.renderKey!==feedback){facetsNode.innerHTML=feedback;facetsNode.dataset.renderKey=feedback;}}
    const summaryNode=root.querySelector('[data-terminal-filter-summary]'),summaryKey=JSON.stringify(universeFilterItems());if(summaryNode&&summaryNode.dataset.renderKey!==summaryKey){summaryNode.innerHTML=universeFilterSummary();summaryNode.dataset.renderKey=summaryKey;}
    root.querySelector('[data-terminal-universe-results]')?.setAttribute('aria-busy',String(next.loading));
    const pager=root.querySelector('[data-terminal-universe-pager]');if(pager)pager.hidden=!next.canPrevious&&!next.canNext;
    const footer=root.querySelector('[data-terminal-universe-footer]');if(footer)footer.hidden=!next.canPrevious&&!next.canNext&&!universeSource();
    for(const node of root.querySelectorAll('[data-terminal-action="instrument-tab"]'))node.setAttribute('aria-pressed',String(node.dataset.terminalId===next.filters.tab));
    for(const node of root.querySelectorAll('[data-terminal-action="universe-page"]')){const available=node.dataset.terminalId==='previous'?next.canPrevious:next.canNext;node.disabled=next.loading||!available;node.hidden=!available;}
  }
  function change(event){if(event.target.matches?.('[data-terminal-timeframe]'))return callback('onTimeframe',event.target.value);if(event.target.matches?.('[data-terminal-range]'))return setRange(event.target.value);if(event.target.matches?.('[data-terminal-universe-filter]'))callback('onUniverseFilter',{[event.target.dataset.terminalUniverseFilter]:event.target.value});else if(event.target.matches?.('[data-terminal-market]'))callback('onUniverseFilter',{market:event.target.value});else if(event.target.matches?.('[data-terminal-scope]'))callback('onScope',event.target.value);else if(event.target.matches?.('[data-terminal-source]'))callback('onSource',event.target.value);else if(event.target.matches?.('[data-terminal-mind]'))callback('onSelectMind',event.target.value);}
  function input(event){if(event.target.matches?.('[data-terminal-search]')){if(discovery())callback('onUniverseQuery',event.target.value);else{search=event.target.value;updateInstrumentRows();}}}
  let keyboardIndex=null;
  function closeMenus({restoreFocus=false,except=null}={}){for(const menu of root?.querySelectorAll('[data-terminal-menu][open]')||[]){if(except&&menu.contains(except))continue;menu.open=false;if(restoreFocus)menu.querySelector('summary')?.focus();}}
  function setRecordsExpanded(value){recordsExpanded=value;root?.classList?.toggle('is-records-expanded',value);for(const trigger of root?.querySelectorAll('[data-terminal-action="records-layout"]')||[]){trigger.setAttribute('aria-pressed',String(value));trigger.textContent=value?'차트 함께 보기':'기록 확대';}}
  function setChartExpanded(value){chartExpanded=value;root?.classList?.toggle('is-chart-expanded',value);for(const trigger of root?.querySelectorAll('[data-terminal-action="chart-layout"]')||[]){trigger.setAttribute('aria-pressed',String(value));trigger.textContent=value?'원장 펼치기':'차트 확대';}}
  function setInstrumentPickerOpen(value,{restoreFocus=false}={}){
    instrumentPickerOpen=value;root?.classList?.toggle('is-instrument-picker-open',value);
    if(!value)instrumentSearchFocus=null;
    const trigger=root?.querySelector('[data-terminal-action="instrument-picker"]');trigger?.setAttribute('aria-expanded',String(value));
    if(value)root?.querySelector('[data-terminal-search]')?.focus();else if(restoreFocus)trigger?.focus();
  }
  function keydown(event){
    if(event.key==='Enter'&&event.target.matches?.('[data-terminal-search]')&&discovery()){event.preventDefault();callback('onUniverseFilter',{q:event.target.value});return;}
    if(event.key==='Escape'&&root?.querySelector('[data-terminal-menu][open]')){event.preventDefault();event.stopPropagation();closeMenus({restoreFocus:true});return;}
    if(event.key==='Escape'&&pinned){event.preventDefault();event.stopPropagation();hidePopover({restoreFocus:true});return;}
    if(event.key==='Escape'&&instrumentPickerOpen){event.preventDefault();event.stopPropagation();setInstrumentPickerOpen(false,{restoreFocus:true});return;}
    const popup=root?.querySelector('[data-terminal-popover]');
    if(pinned&&event.key==='Tab'&&popup?.contains(event.target)){const focusable=[...popup.querySelectorAll('button:not([disabled]), details > summary')],first=focusable[0],last=focusable.at(-1);if(event.shiftKey&&event.target===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&event.target===last){event.preventDefault();first?.focus();}return;}
    if(!event.target.matches?.('[data-terminal-chart]')||!chart)return;
    const series=candles();if(!series.length)return;
    if(['ArrowLeft','ArrowRight','Home','+','=','-','Enter'].includes(event.key))event.preventDefault();else return;
    if(event.key==='Home'){setRange('all');keyboardIndex=series.length-1;return;}
    if(['+','=','-'].includes(event.key)){const range=chart.timeScale().getVisibleLogicalRange();if(range){const span=range.to-range.from,factor=numberToken(event.key==='-'?'--terminal-chart-zoom-out':'--terminal-chart-zoom-in',root);chart.timeScale().setVisibleLogicalRange({from:range.to-span*factor,to:range.to});}return;}
    keyboardIndex=Math.max(0,Math.min(series.length-1,(keyboardIndex??series.length-1)+(event.key==='ArrowLeft'?-1:event.key==='ArrowRight'?1:0)));
    const bar=series[keyboardIndex];chart.setCrosshairPosition?.(bar.close,bar.time,candleSeries);root.querySelector('[data-terminal-ohlc]').innerHTML=ohlc(bar);
    const views=markerViews().filter(v=>v.time===bar.time);if(views.length)showPopover(views,{x:chart.timeScale().timeToCoordinate(bar.time)||0,y:pixelToken('--terminal-chart-keyboard-y',root)},{pin:event.key==='Enter',trigger:event.target});else if(!pinned)hidePopover();
  }
  async function mount(container){
    destroy();root=container.matches?.('[data-terminal-root]')?container:container.querySelector('[data-terminal-root]');if(!root)return false;
    bind('click',click);bind('change',change);bind('input',input);bind('keydown',keydown);
    if(recordFocus){
      const previous=recordFocus;recordFocus=null;const doc=globalThis.document,active=doc?.activeElement;
      const selector=previous==='refresh'?'[data-terminal-records] [data-terminal-action="refresh"]':'[data-terminal-action="tab"][data-terminal-id="'+previous+'"]';
      if(!active||active===doc?.body)(root.querySelector(selector)||root.querySelector('[data-terminal-action="tab"][aria-pressed="true"]'))?.focus({preventScroll:true});
    }
    if(focusInstrumentHeading){root.querySelector('.terminal-symbol-line h1')?.focus();focusInstrumentHeading=false;}
    else if(instrumentSearchFocus){const selection=instrumentSearchFocus,doc=globalThis.document,input=root.querySelector('[data-terminal-search]');instrumentSearchFocus=null;if(input?.getClientRects?.().length&&(!doc?.activeElement||doc.activeElement===doc.body)&&!doc?.querySelector?.('dialog[open]')){input.focus({preventScroll:true});input.setSelectionRange?.(selection.start,selection.end);}}
    if(universeControlFocus){const saved=universeControlFocus;universeControlFocus=null;const doc=globalThis.document;
      if(instrumentPickerOpen&&saved.instrument===model.selectedInstrumentId&&saved.mind===(model.selectedMindId||'all')&&(!doc?.activeElement||doc.activeElement===doc.body)&&!doc?.querySelector?.('dialog[open]')){
        const candidates=[...root.querySelectorAll('[data-terminal-universe-filter],[data-terminal-market],[data-terminal-action]')],target=candidates.find(node=>saved.filter?node.dataset.terminalUniverseFilter===saved.filter:saved.market?node.matches('[data-terminal-market]'):node.dataset.terminalAction===saved.action&&node.dataset.terminalId===saved.id);
        if(target&&!target.disabled&&target.getClientRects().length)target.focus({preventScroll:true});
      }
    }
    if(globalThis.document?.addEventListener){outsideMenus=event=>closeMenus({except:event.target});document.addEventListener('pointerdown',outsideMenus);}
    bind('focusout',event=>{if(!pinned&&!root?.contains(event.relatedTarget))hidePopover();});
    const host=root.querySelector('[data-terminal-chart]'),rows=candles(),token=++generation;
    if(!rows.length||model.status==='loading')return true;
    try{
      const library=await(hooks.loadChart?hooks.loadChart():import('../vendor/lightweight-charts.mjs'));if(token!==generation||!root?.contains(host))return false;
      const color=name=>cssToken(name,root),metric=name=>numberToken(name,root),length=name=>pixelToken(name,root);
      const text=color('--ds-text-secondary'),background=color('--ds-bg-raised'),border=color('--ds-border-subtle');
      const markerData=views=>views.map(({time,id,colorToken,shape,position})=>({time,id,color:color(colorToken),shape,position,size:metric('--terminal-chart-marker-size')}));
      const volumeData=()=>rows.filter(bar=>bar.volume!==null).map(bar=>({time:bar.time,value:bar.volume,color:color(bar.close>=bar.open?'--terminal-chart-volume-up':'--terminal-chart-volume-down')}));
      chart=library.createChart(host,{autoSize:true,height:Math.max(length('--terminal-chart-compact-height'),host.clientHeight||length('--terminal-chart-mobile-height')),layout:{background:{type:'solid',color:background},textColor:text,fontFamily:color('--ds-font-sans'),fontSize:length('--ds-font-size-xs'),attributionLogo:true},grid:{vertLines:{visible:false},horzLines:{color:border}},rightPriceScale:{borderColor:border,scaleMargins:{top:metric('--terminal-chart-margin-top'),bottom:metric('--terminal-chart-margin-bottom')}},timeScale:{borderColor:border,timeVisible:true,secondsVisible:false,rightOffset:metric('--terminal-chart-right-offset'),barSpacing:length('--terminal-chart-bar-spacing'),minBarSpacing:length('--terminal-chart-min-bar-spacing')},crosshair:{mode:library.CrosshairMode.Normal,vertLine:{color:text,width:metric('--terminal-chart-crosshair-width'),style:library.LineStyle.LargeDashed},horzLine:{color:text,width:metric('--terminal-chart-crosshair-width'),style:library.LineStyle.LargeDashed}},handleScale:{axisPressedMouseMove:true,mouseWheel:true,pinch:true},handleScroll:{mouseWheel:true,pressedMouseMove:true,horzTouchDrag:true,vertTouchDrag:false},localization:{locale:'ko-KR',timeFormatter:time=>stamp(Number(time)*1000)}});
      const candleColors=()=>({upColor:color('--ds-success'),downColor:color('--ds-danger'),wickUpColor:color('--ds-success'),wickDownColor:color('--ds-danger')});
      candleSeries=chart.addSeries(library.CandlestickSeries,{...candleColors(),borderVisible:false,priceLineVisible:true,lastValueVisible:true,priceFormat:{type:'price',precision:currencyPrecision(selected()?.quoteCurrency,selected()?.priceDecimals??2),minMove:10**-currencyPrecision(selected()?.quoteCurrency,selected()?.priceDecimals??2)}});
      candleSeries.setData(rows.map(({time,open,high,low,close})=>({time,open,high,low,close})));
      volumeSeries=chart.addSeries(library.HistogramSeries,{priceFormat:{type:'volume'},priceScaleId:'volume',lastValueVisible:false,priceLineVisible:false});
      volumeSeries.priceScale().applyOptions({scaleMargins:{top:metric('--terminal-chart-volume-top'),bottom:metric('--terminal-chart-volume-bottom')},visible:false});
      volumeSeries.setData(volumeData());
      const views=markerViews();markersApi=library.createSeriesMarkers(candleSeries,markerData(views),{zOrder:'aboveSeries'});
      const byTime=new Map();for(const view of views){if(!byTime.has(view.time))byTime.set(view.time,[]);byTime.get(view.time).push(view);}
      chart.subscribeCrosshairMove(event=>{if(pinned)return;if(!event.point||typeof event.time!=='number'){hidePopover();return;}const row=rows.find(b=>b.time===event.time);if(row)root?.querySelector('[data-terminal-ohlc]')?.replaceChildren(...htmlNodes(ohlc(row)));const found=byTime.get(event.time);if(found?.length)showPopover(found,event.point);else hidePopover();});
      chart.subscribeClick(event=>{const found=byTime.get(event.time);if(found?.length)showPopover(found,event.point,{pin:true,trigger:host});else if(pinned)hidePopover({restoreFocus:true});});
      setRange(selectedRange);
      const message=root.querySelector('[data-terminal-chart-message]');if(message)message.hidden=true;
      if(typeof ResizeObserver==='function'){observer=new ResizeObserver(()=>{if(!pinned)hidePopover();});observer.observe(host);}
      if(typeof MutationObserver==='function'&&document.documentElement){themeObserver=new MutationObserver(()=>{const nextText=color('--ds-text-secondary'),nextBorder=color('--ds-border-subtle');chart?.applyOptions({layout:{background:{type:'solid',color:color('--ds-bg-raised')},textColor:nextText},grid:{horzLines:{color:nextBorder}},rightPriceScale:{borderColor:nextBorder},timeScale:{borderColor:nextBorder},crosshair:{vertLine:{color:nextText},horzLine:{color:nextText}}});candleSeries?.applyOptions(candleColors());volumeSeries?.setData(volumeData());markersApi?.setMarkers?.(markerData(views));});themeObserver.observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});}
      return true;
    }catch(error){if(token!==generation)return false;const message=root?.querySelector('[data-terminal-chart-message]');if(message){message.hidden=false;message.setAttribute('role','alert');message.textContent='차트를 불러오지 못했습니다. '+(error?.message||'다시 조회하세요.');}callback('onChartError',error);return false;}
  }
  function htmlNodes(html){const template=document.createElement('template');template.innerHTML=html;return [...template.content.childNodes];}
  function destroy(){
    const active=globalThis.document?.activeElement;
    if(root?.contains(active)&&active?.matches?.('[data-terminal-records] [data-terminal-action="refresh"]'))recordFocus='refresh';
    else if(root?.contains(active)&&active?.matches?.('[data-terminal-action="tab"]'))recordFocus=active.dataset.terminalId;
    if(root)instrumentSearchFocus=root.contains(active)&&active?.matches?.('[data-terminal-search]')?{start:active.selectionStart,end:active.selectionEnd}:null;
    if(root)universeControlFocus=root.contains(active)&&active?.matches?.('[data-terminal-universe-filter],[data-terminal-market],[data-terminal-action="instrument"],[data-terminal-action="watchlist"],[data-terminal-action="instrument-tab"],[data-terminal-action="universe-page"],[data-terminal-action="universe-retry"]')?{filter:active.dataset.terminalUniverseFilter,market:active.matches('[data-terminal-market]'),action:active.dataset.terminalAction,id:active.dataset.terminalId,instrument:model.selectedInstrumentId,mind:model.selectedMindId||'all'}:null;
    if(root?.contains(active)&&active?.matches?.('.terminal-symbol-line h1'))focusInstrumentHeading=true;
    generation++;if(outsideMenus){globalThis.document?.removeEventListener?.('pointerdown',outsideMenus);outsideMenus=null;}observer?.disconnect();observer=null;themeObserver?.disconnect();themeObserver=null;markersApi?.detach?.();markersApi=null;chart?.remove?.();chart=null;candleSeries=null;volumeSeries=null;if(root)for(const [name,listener]of listeners)root.removeEventListener(name,listener);listeners.length=0;root=null;pinned=false;lastPopover=[];lastTrigger=null;keyboardIndex=null;
  }
  return {render,mount,destroy,updateUniverse,focusInstrumentSearch:()=>setInstrumentPickerOpen(true),handleClick:click,handleChange:change,handleInput:input,state:()=>({instrumentId:model.selectedInstrumentId,mindId:model.selectedMindId,timeframe:model.timeframe,recordView:model.recordView||recordView,search:discovery()?.filters.q??search,instrumentTab:discovery()?.filters.tab||instrumentTab,pinned,chartExpanded,recordsExpanded,instrumentPickerOpen,markerCount:markerViews().length})};
}
