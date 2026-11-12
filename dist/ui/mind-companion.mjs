import {renderMindHud} from './mind-hud.mjs';
import {currencyAmount} from './currency-format.mjs';
import {renderLifeStage,renderLifePnl,lifeSettings} from './mind-life.mjs';
import {gameTotals} from './mind-game.mjs';
import {helpTooltip,readonlyTooltip} from './help-tooltip.mjs';
import {renderMindActivityPreview} from './mind-activity.mjs';

const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const list=value=>Array.isArray(value)?value:[];
const number=value=>Number.isFinite(value)?new Intl.NumberFormat('ko-KR',{minimumFractionDigits:2,maximumFractionDigits:2}).format(value):'—';
const when=value=>value&&Number.isFinite(Date.parse(value))?new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(value))+' KST':'평가 시각 확인';

export const executionModeOf=route=>route?.params?.get('executionMode')==='live'?'live':'paper';

export function mindAutomationLabel(card={}){
  if(card.executionMode==='paper'&&card.accountScope==='EVENT_PAPER_ALLOCATION'&&card.paperActivity)return '모의 운용 관리';
  if(card.eventStream)return card.executionMode==='live'?(card.liveActivity?'운용 관리':'운용 설정'):'모의 운용 준비';
  if(card.executionMode==='live')return '연결 설정';
  if(mindAutomationAction(card)==='mind-lab')return '실험실 열기';
  if(mindAutomationAction(card)==='mind-trade')return '트레이딩 열기';
  if(card.automation?.enabled||card.automation?.requiresAttention)return '자동 모의 관리';
  return card.automation?.paused||card.automation?.subscriptionId?'자동 모의 시작':'자동 모의 설정';
}

export const mindAutomationAction=card=>card.executionMode==='paper'&&card.accountScope==='EVENT_PAPER_ALLOCATION'&&card.paperActivity?'mind-automation':card.eventStream?'mind-automation':card.executionMode==='paper'&&card.strategyScope==='MIND_UNIVERSE'?'mind-lab':card.executionMode==='paper'&&card.automaticScopeSupported===false&&!card.automation?.subscriptionId&&!card.automation?.enabled&&!card.automation?.requiresAttention?'mind-trade':'mind-automation';

export function renderMindNodeEdit(card,{className='button small primary',companionAction=false}={}){
  return '<button type="button" class="'+esc(className)+'" data-studio-action="strategy-graph" data-studio-id="'+esc(card.profileId)+'"'+(companionAction?' data-companion-action="edit"':'')+' aria-label="'+esc(card.name)+' 노드 편집" title="전략의 노드를 편집합니다.">노드 편집</button>';
}

export function renderMindRename(card,{className='text-button'}={}){
  return '<button type="button" class="'+esc(className)+'" data-studio-action="profile-rename" data-companion-action="rename" data-studio-id="'+esc(card.profileId)+'" aria-label="'+esc(card.name)+' 이름 변경">이름 변경</button>';
}

export function renderMindAutomationEntry(card,{className='text-button'}={}){
  if(card.archived)return renderMindArchiveEntry(card,{className});
  return '<button type="button" class="'+esc(className)+'" data-studio-action="'+mindAutomationAction(card)+'" data-studio-id="'+esc(card.profileId)+'" data-companion-action="automation" aria-label="'+esc(card.name)+' '+mindAutomationLabel(card)+'">'+mindAutomationLabel(card)+'</button>';
}

export function renderMindArchiveEntry(card,{className='text-button'}={}){
  const label=card.archived?'복구':'보관';
  const active=!card.archived&&[card.liveActivity,card.paperActivity].some(item=>item?.status==='ENABLED');
  return '<button type="button"'+(card.archived?'':' hidden')+(active?' disabled title="운용을 중지하고 보유·미확정 주문을 확인한 뒤 보관하세요."':'')+' class="'+esc(card.archived?className:'')+'" data-studio-action="profile-'+(card.archived?'restore':'archive')+'" data-studio-id="'+esc(card.profileId)+'" data-companion-action="archive" aria-label="'+esc(card.name)+' '+label+'">'+label+'</button>';
}

export function restoreCompanionDialogFocus(trigger,container){
  const action=trigger?.dataset?.studioAction,id=trigger?.dataset?.studioId;if(!['profile-edit','profile-rename','strategy-graph','mind-customize'].includes(action)||!id||!(trigger.closest?.('[data-mind-companion]')||trigger.closest?.('[data-mind-management]')))return false;
  const target=[...container?.querySelectorAll?.('[data-mind-companion] [data-studio-action],[data-mind-management] [data-studio-action]')||[]].find(node=>node.dataset.studioAction===action&&node.dataset.studioId===id&&!node.disabled&&node.getClientRects().length);if(!target)return false;target.focus({preventScroll:true});return true;
}

export function companionActionTargets(profileId,executionMode='paper'){
  const mode=executionMode==='live'?'live':'paper',base={profileId,executionMode:mode};
  return {overview:'#minds?'+new URLSearchParams({...base,view:'operations'}),operations:'#minds?'+new URLSearchParams({...base,view:'operations'}),records:'#minds?'+new URLSearchParams({...base,view:'records'}),edit:{action:'strategy-graph',id:profileId}};
}

export function renderExecutionModeToggle(mode='paper'){
  return '<div class="execution-view-toggle" role="group" aria-label="운용 보기">'+[['paper','모의'],['live','실전']].map(([id,label])=>'<button type="button" data-studio-action="execution-mode" data-studio-id="'+id+'" data-companion-mode="'+id+'" aria-pressed="'+(mode===id)+'" aria-label="'+label+' 보기">'+label+'</button>').join('')+'</div>';
}

export function renderLiveExecutionEmpty(){
  return '<section class="mind-live-empty" data-mind-live-empty role="status"><div class="mind-live-mark" aria-hidden="true">↗</div><h2>실전 계좌·주문 연결 대기</h2><p>서비스 연결에서 현재 연결 상태와 지원 범위를 확인하세요.</p><a class="button" href="#settings?view=connections&amp;executionMode=live" data-studio-route data-companion-action="connect">서비스 연결 확인</a></section>';
}

function performanceMarkup(card){
  if(card.executionMode==='live'){
    const ledger=card.liveActivity?.ledger,currency=ledger?.quoteCurrency,recorded=ledger?.realizedPnl!=null&&Number.isFinite(Number(ledger.realizedPnl));
    if(!recorded)return '<p class="mind-companion-no-performance" data-companion-live-performance>'+(card.liveActivity?'자금 확인 중':'운용 자금 설정')+'</p>';
    const pnl=Number(ledger.realizedPnl),hasTrade=list(card.liveActivity.recentActivity).some(r=>r.kind==='STRATEGY_ORDER'&&Number(r.filledQuantity)>0);
    return '<dl class="mind-companion-performance"><div data-live-currency="'+esc(currency)+'"><dt>'+(card.game?.status==='READY'?'누적 실현 손익':'실현 손익')+'</dt><dd data-performance-source="live-ledger">'+(pnl>0?'+':'')+currencyAmount(pnl,currency)+' '+esc(currency)+'</dd><small>'+esc(hasTrade?'매도 체결 기준':'첫 매매를 기다리고 있어요')+'</small></div></dl>';
  }
  if(!list(card.currencies).length)return '<p class="mind-companion-no-performance">모의 계좌 연결 필요</p>';
  return '<dl class="mind-companion-performance">'+card.currencies.map(currency=>{
    const current=Number.isFinite(currency.netReturn),saved=current?currency:Number.isFinite(currency.lastSavedPerformance?.netReturn)?currency.lastSavedPerformance:null;
    const untraded=currency.status==='UNTRADED'||currency.hasPerformance===false,value=untraded?'첫 거래 대기':saved?((saved.netReturn>0?'+':'')+number(saved.netReturn*100)+'%'):'—';
    return '<div data-companion-currency="'+esc(currency.currency)+'"><dt>'+esc(currency.currency)+' 누적 수익률</dt><dd data-performance-source="'+(saved?current?'current':'saved':'unavailable')+'"'+(saved?' data-performance-as-of="'+esc(saved.asOf)+'"':'')+'>'+value+'</dd><small>'+(saved?(current?'평가 ':'마지막 저장 평가 ')+esc(when(saved.asOf)):esc(currency.reason?.message||'평가 자료 확인 필요'))+'</small></div>';
  }).join('')+'</dl>';
}

function holdingsMarkup(card){
 const id='companion-holdings-'+encodeURIComponent(card.profileId);
  if(card.executionMode==='live'){
    const ledger=card.liveActivity?.ledger,positions=list(ledger?.positions).filter(p=>Number(p.quantity)>0);
    return positions.length?'<p class="mind-companion-holdings" id="'+esc(id)+'" data-companion-holdings>'+esc(positions.map(p=>p.asset+' '+new Intl.NumberFormat('ko-KR',{maximumSignificantDigits:10}).format(Number(p.quantity))).join(' · '))+'</p>':ledger?.availableCash!=null&&!(ledger.allocationStatus==='RELEASED'&&Number(ledger.availableCash)===0)?'<p class="mind-companion-holdings" id="'+esc(id)+'" data-companion-holdings>'+(ledger.allocationStatus==='RELEASED'?'가용 자금 기록 ':'투자 가능 ')+currencyAmount(Number(ledger.availableCash),ledger.quoteCurrency)+' '+esc(ledger.quoteCurrency)+'</p>':'';
  }
  const currencies=list(card.currencies),allocations=currencies.map(c=>c.allocation).filter(Boolean),percent=value=>new Intl.NumberFormat('ko-KR',{maximumFractionDigits:1}).format(value*100)+'%',quantity=value=>new Intl.NumberFormat('ko-KR',{maximumFractionDigits:12}).format(value),symbol=(value,currency)=>String(value).replace(new RegExp('-'+currency+'$'),'');

  if(!allocations.length){
    if(!card.holdings?.hasHoldings)return '';
    const names=list(card.holdings.instrumentIds).map(id=>String(id).split(':').at(-1).replace(/-(?:USDT|USD|KRW)$/,''));
    return '<p class="mind-companion-holdings" data-companion-holdings>'+readonlyTooltip(names.join(' · ')+' · 평가 갱신 필요','보유 종목입니다. 현재 비중은 평가 갱신 후 확인하세요.',{id})+'</p>';
  }
  const pending=c=>{const names=list(c.heldInstrumentIds).map(id=>symbol(String(id).split(':').at(-1),c.currency));return names.length?names.join(' / ')+' · 평가 갱신 필요':'계좌 평가 확인 필요';};
  const labels=currencies.map(c=>{const a=c.allocation;if(!a)return (currencies.length>1?c.currency+' · ':'')+pending(c);const assets=a.positions.map(p=>symbol(p.symbol,a.currency)+' · '+percent(p.weight));if(!a.positions.length||a.cashWeight>=.005)assets.push('현금 '+percent(a.cashWeight));return (currencies.length>1?a.currency+' · ':'')+assets.join(' / ');});
  const details=currencies.map(c=>{const a=c.allocation;return a?a.currency+' 계좌 · '+a.positions.map(p=>symbol(p.symbol,a.currency)+' 수량 '+quantity(p.quantity)+' · 평가금액 '+currencyAmount(p.marketValue,a.currency)+' '+a.currency+' · 비중 '+percent(p.weight)).join(' / ')+(a.positions.length?' / ':'')+'현금 '+currencyAmount(a.cash,a.currency)+' '+a.currency+' · 평가 '+when(a.asOf):c.currency+' 계좌 · '+pending(c);}).join(' | ');
  return '<p class="mind-companion-holdings" data-companion-holdings>'+readonlyTooltip(labels.join(' | '),details,{id})+'</p>';
}

function summaryMarkup(view){
  if(view.executionMode!=='paper'||!list(view.summaries).length)return '';
  const signed=value=>(value>0?'+':'')+number(value);
  return '<section class="mind-companion-summary" data-mind-companion-summary aria-label="전체 마인드 모의계좌 합계"><div class="mind-summary-heading"><h2>모의계좌 합계</h2>'+helpTooltip('모의계좌 합계','현재 표시한 마인드의 계좌를 통화별로 합산합니다. 수익률은 전체 초기 자금 대비 순손익이며, 보유 계좌는 같은 평가 시각을 사용합니다.')+'<button type="button" class="text-button" data-studio-action="companion-valuation-refresh"'+(view.valuationLoading?' disabled':'')+'>'+(view.valuationLoading?'현재가 조회 중…':'평가 갱신')+'</button></div>'+(view.valuationError?'<p role="status">'+esc(view.valuationError)+'</p>':'')+view.summaries.map(summary=>{
    const ready=Number.isFinite(summary.equity)&&Number.isFinite(summary.netPnl)&&Number.isFinite(summary.netReturn),label=summary.status==='SAVED'?'저장 평가':summary.status==='CASH_ONLY'?'잔고 기준':'평가 기준';
    return '<div class="mind-summary-row" data-mind-summary-currency="'+esc(summary.currency)+'" data-summary-status="'+esc(summary.status)+'"><strong class="mind-summary-currency">'+esc(summary.currency)+'</strong>'+(ready?'<dl><div><dt>평가자산</dt><dd data-mind-scoreboard="'+esc(summary.currency)+'" data-summary-metric="equity">'+currencyAmount(summary.equity,summary.currency)+'</dd></div><div><dt>순손익</dt><dd data-summary-metric="net-pnl">'+(summary.netPnl>0?'+':'')+currencyAmount(summary.netPnl,summary.currency)+'</dd></div><div><dt>수익률</dt><dd data-summary-metric="return">'+(summary.hasPerformance?signed(summary.netReturn*100)+'%':'첫 거래 대기')+'</dd></div></dl><small>'+label+' <time datetime="'+esc(summary.asOf)+'">'+esc(when(summary.asOf))+'</time></small>':'<p class="mind-summary-unavailable" role="status">'+esc(summary.reason?.message||'계좌 기록 확인 필요')+'</p>')+'</div>';
  }).join('')+'</section>';
}

function cardMarkup(card){
  const id=String(card.profileId),target=companionActionTargets(id,card.executionMode),phase=card.phase||'idle',decision=card.lastDecision;
  const due=card.automation?.nextEligibleAt,schedule=card.executionMode==='paper'&&card.automation?.enabled&&due&&Number.isFinite(Date.parse(due))?'<p class="mind-companion-activity" data-companion-schedule>다음 판단 '+esc(when(due))+'</p>':'';
  const activity=decision?'최근 '+(({buy:'매수 판단',sell:'매도 판단',hold:'관망'})[decision.action]||'판단')+' · '+when(decision.at):'첫 판단 대기';
  const recordedActivity=card.liveActivity??card.paperActivity;
  const preview=recordedActivity?renderMindActivityPreview(recordedActivity,{id:'companion-path-'+encodeURIComponent(id),label:'판단 경로',passive:true}):'';
  const holdings=holdingsMarkup(card),issue=card.executionMode==='paper'?card.automation?.issue:null,issueId='companion-issue-'+encodeURIComponent(id),descriptions=[holdings?'companion-holdings-'+encodeURIComponent(id):null,issue?issueId:null].filter(Boolean).join(' ');
  const issueMarkup=issue?'<p class="mind-companion-issue" data-companion-issue role="status">'+readonlyTooltip(issue.message,issue.message+' · '+when(issue.at)+' · 자동 모의 관리에서 처리 기록을 확인하세요.',{id:issueId})+'</p>':'';
  return '<article class="mind-companion-card" data-mind-companion data-profile-id="'+esc(id)+'" data-execution-mode="'+esc(card.executionMode)+'" data-phase="'+esc(phase)+'" data-motion="'+(card.appearance?.config?.motionIntensity==='off'?'off':'subtle')+'" data-game-day="'+esc(card.game?.day??'')+'" data-game-receipts="'+esc(JSON.stringify(card.game?.settlements??[]))+'"><header class="actions" data-mind-identity><a class="mind-companion-open" data-mind-companion-open data-studio-route href="'+esc(target.overview)+'" aria-label="'+esc(card.name)+' 마인드 열기"'+(descriptions?' aria-describedby="'+esc(descriptions)+'"':'')+'><h2>'+esc(card.name)+'</h2><p class="mind-companion-state" title="'+esc(activity)+'" data-companion-state>'+esc(card.label||'상태 확인')+'</p>'+holdings+renderLifePnl(card)+performanceMarkup(card)+schedule+issueMarkup+'<p class="mind-companion-activity" data-companion-activity>'+esc(activity)+'</p>'+preview+'</a>'+renderMindRename(card,{className:'button'})+'</header><div class="relative">'+renderMindHud(card,{href:target.overview})+'<button type="button" class="mind-companion-customize" data-studio-action="mind-customize" data-studio-id="'+esc(id)+'" data-companion-action="customize" aria-label="'+esc(card.name)+' 캐릭터 꾸미기" title="캐릭터 꾸미기"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 5 4 4M4 20l4-1 12-12a2.8 2.8 0 0 0-4-4L4 15Z"/></svg></button></div><footer>'+renderMindNodeEdit(card,{className:'text-button',companionAction:true})+renderMindAutomationEntry(card)+(card.archived?'':renderMindArchiveEntry(card))+'</footer></article>';
}

function liveScoreboard(view){
 if(view.executionMode!=='live'||!view.cards.some(c=>c.connected))return '';
 const totals=gameTotals(view);
 return '<div class="mind-life-live-summary">'+(totals.length?totals.map(t=>'<div><span>총 자산 '+esc(t.currency)+'</span><strong data-mind-scoreboard="'+esc(t.currency)+'">'+(t.equity===null?'확인 중':currencyAmount(Number(t.equity),t.currency))+'</strong></div>').join(''):'<p class="mind-companion-group-context">현재 배정된 운용 자금이 없습니다.</p>')+lifeSettings()+'</div>';
}

export function renderMindCompanions(view={}){
    if(view.loading)return '<p class="mind-companion-loading" role="status" aria-live="polite">마인드의 운용 상태를 불러오는 중…</p>';
  if(view.error&&!list(view.cards).length)return '<div class="mind-companion-loading" role="alert"><p>'+esc(view.error)+'</p><button type="button" class="button small" data-studio-action="companion-refresh">다시 조회</button></div>';
  if(!list(view.cards).length)return view.archivedView?'<div class="mind-companion-loading"><p>보관한 마인드가 없습니다.</p></div>':'<div class="mind-companion-loading"><p>저장된 마인드가 없습니다.</p><button type="button" class="button" data-studio-action="profile-new">마인드 추가</button></div>';
  const scope=view.activityReady===false?(view.error?'운용 상태 확인 필요':'운용 상태 조회 중'):'자동 운용 '+view.cards.filter(card=>card.automation?.enabled).length+' · 보유 중 '+view.cards.filter(card=>card.holdings?.hasHoldings).length+' · <a href="#settings?view=accounts&amp;executionMode=live" data-studio-route>계좌 관리</a>';
  const overview=view.executionMode==='live'?'<div class="mind-companion-overview">'+liveScoreboard(view)+'<p class="mind-companion-scope">'+scope+'</p></div>':summaryMarkup(view)||'<p class="mind-companion-scope">마인드 모의계좌</p>';
  const cards=view.cards.slice().sort((a,b)=>Number(Boolean(b.automation?.requiresAttention))*4+Number(Boolean(b.automation?.enabled))*2+Number(Boolean(b.holdings?.hasHoldings))-Number(Boolean(a.automation?.requiresAttention))*4-Number(Boolean(a.automation?.enabled))*2-Number(Boolean(a.holdings?.hasHoldings)));
  const released=card=>card.executionMode==='live'&&card.liveActivity?.ledger?.allocationStatus==='RELEASED',past=cards.filter(released),current=cards.filter(card=>!released(card));
  const grid=items=>'<div class="mind-companion-grid">'+items.map(cardMarkup).join('')+'</div>';
  const collection=past.length?'<section class="mind-companion-groups" aria-label="마인드">'+(current.length?'<section aria-labelledby="mind-current-heading"><h2 id="mind-current-heading" class="mind-companion-group-title">현재 마인드</h2>'+grid(current)+'</section>':'')+'<details class="mind-companion-history" data-mind-history="'+(view.archivedView?'archived':'active')+'"'+((view.historyOpen??!current.length)?' open':'')+'><summary><span>지난 운용</span> <span class="mind-companion-history-count">'+past.length+'개 · 총자산 제외</span></summary><p class="mind-companion-group-context">배정이 해제된 운용 기록입니다. 현재 총자산에 포함되지 않습니다.</p>'+grid(past)+'</details></section>':'<section class="mind-companion-grid" aria-label="마인드">'+cards.map(cardMarkup).join('')+'</section>';
  return (view.error?'<div class="mind-operation-attention" role="alert">'+esc(view.error)+' <button type="button" class="button small" data-studio-action="companion-refresh">다시 조회</button></div>':'')+overview+collection;
}
