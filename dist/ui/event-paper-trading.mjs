import {submitFunding} from './paper-funding-request.mjs';
import {operationWindowFields,operationWindowValues,operationWindowSummary} from './operation-window.mjs';
import {JEV_EXECUTION_CALL_LIMIT} from '../domain/jev-question.mjs';
import {currencyAmount} from './currency-format.mjs';
import {helpTooltip} from './help-tooltip.mjs';
import {renderMindActivityHero,renderMindActivityFeed,marketScopeMarkup} from './mind-activity.mjs';
import {renderOperationControls} from './operation-controls.mjs';

const BASE='/api/workspace/event-paper',list=value=>Array.isArray(value)?value:[];
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const numeric=value=>value!==null&&value!==undefined&&value!==''&&Number.isFinite(Number(value));
const amount=(value,currency)=>'<span title="'+esc(numeric(value)?value+' '+currency:'금액 미기록')+'">'+(numeric(value)?(currency==='KRW'?new Intl.NumberFormat('ko-KR',{maximumFractionDigits:2}).format(Number(value))+'원':currencyAmount(Number(value),currency)+' '+esc(currency)):'—')+'</span>';
const quantity=value=>numeric(value)?new Intl.NumberFormat('ko-KR',{maximumSignificantDigits:15}).format(Number(value)):'—';
const time=value=>value&&Number.isFinite(Date.parse(value))?new Date(value).toLocaleString('ko-KR',{timeZone:'Asia/Seoul',hour12:false})+' KST':'—';
const period=value=>({'1m':'1분봉','3m':'3분봉','5m':'5분봉','1h':'1시간봉'})[value]??'주기 확인 필요';
const symbol=value=>String(value??'').replace(/^crypto:upbit:/,'');
export const paperMarketScopeMarkup=marketScopeMarkup;
const row=(label,value)=>'<div class="detail-row"><span>'+esc(label)+'</span><strong>'+value+'</strong></div>';
const button=(label,action,id='',disabled=false,primary=false)=>'<button type="button" class="button small'+(primary?' primary':'')+'" data-event-paper-action="'+action+'" data-event-paper-id="'+esc(id)+'"'+(disabled?' disabled':'')+'>'+label+'</button>';
const enabled=subscription=>subscription?.status==='ENABLED';
const responsePending=subscription=>['IN_FLIGHT','EXTERNAL_OUTCOME_UNKNOWN','FRAME_REVIEW_REQUIRED'].includes(subscription?.runtime?.providerState);
const releasable=subscription=>subscription?.status==='PAUSED'&&subscription.canRelease===true;
const resumable=subscription=>subscription?.status==='PAUSED'&&!responsePending(subscription);
const status=value=>({ENABLED:'모의 운용 중',PAUSED:'일시중지',COMPLETED:'종료 · 자금 회수 완료',ACTION_REQUIRED:'확인 필요',STOPPED:'중지',PREPARED:'시작 전',FILLED:'모의 체결 완료',PARTIALLY_FILLED:'모의 부분 체결',PARTIAL:'모의 부분 체결',HOLD:'관망',NO_ORDER_REQUIRED:'추가 주문 없음',BLOCKED:'체결 조건 확인',REJECTED:'모의 주문 거절',CANCELLED:'모의 주문 취소'})[value]??'상태 확인';
const reasonsMarkup=reasons=>list(reasons).length?'<ul class="tiny">'+list(reasons).map(reason=>'<li>'+esc(reason.message??reason.reason??'운용 조건을 확인하세요.')+'</li>').join('')+'</ul>':'';
export const isEventPaperMind=manifest=>manifest?.data?.strategyPlan?.graph?.executionScope?.kind==='EACH_ASSET'||manifest?.data?.strategyPlan?.graph?.nodes?.some(n=>n.type==='MODEL'&&n.config.family==='HOURLY_VALUE_FOREST')===true;

export function eventPaperCandidatesMarkup(subscription){
 const candidates=list(subscription?.runtime?.candidates);
 if(subscription?.status==='COMPLETED'&&!candidates.length)return '';
 return '<section class="studio-sheet"><div class="studio-sheet-head"><h3>최근 후보 선정</h3></div><div class="studio-sheet-body">'+(candidates.length?'<div class="studio-table-scroll"><table class="studio-table"><thead><tr><th scope="col">종목</th><th scope="col">선정 결과</th><th scope="col">최근 판단</th></tr></thead><tbody>'+candidates.map(candidate=>'<tr><td>'+esc(symbol(candidate.instrumentId))+'</td><td>'+(candidate.selected===true?'선정':candidate.selected===false?'선정 제외':'미기록')+'</td><td>'+esc(candidate.ready===false?'판단 자료 확인 필요':({buy:'매수',sell:'매도',hold:'관망'})[candidate.action]??'판단 미기록')+'</td></tr>').join('')+'</tbody></table></div>':'<p class="empty">후보 관측을 기다리고 있어요.</p>')+(subscription?.runtime?.lastEvaluationAt?'<p class="tiny muted">판단 기준 '+esc(time(subscription.runtime.lastEvaluationAt))+'</p>':'')+'</div></section>';
}

export function eventPaperRecordsMarkup(items=[],currency){
 const records=list(items);
 if(!records.length)return '<p class="empty">저장된 모의 운용 기록이 없습니다.</p>';
 return '<div class="studio-table-scroll"><table class="studio-table"><thead><tr>'+['시각','종목','기록','수량','수수료'].map(label=>'<th scope="col">'+label+'</th>').join('')+'</tr></thead><tbody>'+records.map(record=>{
  const order=record.kind==='STRATEGY_ORDER',action=({buy:'매수',sell:'매도',hold:'관망'})[record.action]??'저장된',label=order?action+' · '+status(record.state):record.kind==='RUNTIME'?'운용 상태 · '+status(record.state):action+' 판단',quantityValue=order?record.filledQuantity:null;
  return '<tr><td>'+esc(time(record.at))+'</td><td>'+esc(record.market??symbol(record.instrumentId)??'—')+'</td><td>'+esc(label)+'</td><td class="text-right tabular-nums" title="'+esc(quantityValue??'')+'">'+quantity(quantityValue)+'</td><td class="text-right tabular-nums">'+(order?amount(record.fee,record.quoteCurrency??currency):'—')+'</td></tr>';
 }).join('')+'</tbody></table></div>';
}

/** Explicit opt-in only. All polling is read-only; the server owns capital and execution. */
export function createEventPaperTrading(hooks,{now=Date.now}={}){
 let data=null,key='',generation=0,loading=false,pending=false,error='',preview=null,previewScope='',resume=null,release=null,disposed=false,readAt=0;
 const context=()=>{const route=hooks.route(),profileId=route.params.get('profileId'),manifest=hooks.getManifest(profileId);return {route,profileId,manifest,paper:route.params.get('executionMode')!=='live',view:route.page==='minds'&&['operations','overview'].includes(route.params.get('view')||'overview')&&Boolean(profileId&&profileId!=='all'),eligible:isEventPaperMind(manifest)};};
 const contextKey=()=>{const c=context();return c.paper&&c.view?[c.profileId,c.manifest?.id??''].join('|'):'';};
 const current=scope=>!disposed&&scope&&contextKey()===scope;
 const subscriptions=()=>key===contextKey()?list(data?.subscriptions).filter(subscription=>subscription.profileId===context().profileId):[];
 const selected=()=>subscriptions().find(enabled)??subscriptions().find(item=>item.status!=='COMPLETED')??subscriptions()[0]??null;
 const hasOpenSubscription=()=>subscriptions().some(item=>item.status!=='COMPLETED');
 const handles=()=>{const c=context();return c.paper&&c.view&&(c.eligible||subscriptions().length>0);};
 const redraw=()=>{if(!disposed)hooks.redraw?.();};
 const observedRevision=()=>data?.revision;
 const newKey=()=>crypto.randomUUID();
 const open=(title,html)=>hooks.open?.(title,html);
 const form=(kind,html,label,disabled=false)=>'<form class="form-grid" data-event-paper-form="'+kind+'" data-event-paper-scope="'+esc(contextKey())+'">'+html+'<p class="error-text full" role="alert" data-event-paper-error></p><div class="form-actions full"><button type="button" class="button" data-studio-action="close-dialog">취소</button><button type="submit" class="button primary"'+(disabled?' disabled':'')+'>'+label+'</button></div></form>';
 const reset=next=>{key=next;generation++;data=null;error='';preview=null;previewScope='';resume=null;release=null;loading=false;readAt=0;};
 function acceptMutation(result){
  // A pre-command GET must not restore the previous enabled/paused state.
  generation++;loading=false;readAt=0;const subscription=result?.subscription;
  if(subscription?.profileId===context().profileId)data={...data,...(result.revision!==undefined?{revision:result.revision}:{}),subscriptions:[subscription,...list(data?.subscriptions).filter(item=>item.id!==subscription.id)]};
 }
 async function load({force=false,maxAgeMs=Infinity}={}){
  const scope=contextKey();if(scope!==key)reset(scope);if(!scope||loading||data&&!force&&now()-readAt<maxAgeMs)return;
  const token=++generation;loading=true;error='';if(handles())redraw();
  try{const value=await hooks.request(BASE+'?'+new URLSearchParams({profileId:context().profileId}));if(token!==generation||!current(scope))return;data=value;readAt=now();hooks.onData?.(value,context().profileId);}
  catch(problem){if(token===generation&&current(scope))error=problem.message;}
  finally{if(token===generation&&current(scope)){loading=false;redraw();}}
 }
 function configuration(config={},pins={}){
  const currency=config.quoteCurrency??data?.currentManifest?.quoteCurrency??data?.budget?.quoteCurrency;
  return row('투자 범위',paperMarketScopeMarkup(config.marketIds))+row('판단 주기',esc(period(config.timeframe)))+row('운용 기간',esc(operationWindowSummary(config)))+row('모의 운용 자금',amount(config.capitalLimit,currency))+(config.timeframe==='1h'?row('공개 시세 총 조회 예산',config.maxPublicRequests+'회'):'')+row('하루 JEV 호출 한도',Number.isSafeInteger(config.maxJevCallsPerDay)?config.maxJevCallsPerDay+'회':'—')+'<details class="spaced"><summary>고정한 실행 조건</summary>'+row('동시 보유','최대 1종목')+(numeric(config.maxDailyLossRatio)?row('일 손실 한도',quantity(Number(config.maxDailyLossRatio)*100)+'%'):'')+(numeric(config.slippageBps)?row('허용 슬리피지',quantity(config.slippageBps)+'bp'):'')+(config.orderType?row('주문 방식',esc(config.orderType)):'')+row('적용 정책',esc(pins.manifestId??'미기록'))+'</details>';
 }
 function render(){
  if(!handles())return '';
  const subscription=selected(),manifest=data?.currentManifest,currency=subscription?.config?.quoteCurrency??manifest?.quoteCurrency??data?.budget?.quoteCurrency,ledger=subscription?.ledger;
  const action=(label,kind,extra={})=>({label,attributes:{'data-event-paper-action':kind,'data-event-paper-id':subscription?.id??''},...extra});
  const controls=renderOperationControls({id:'paper-operation-'+context().profileId,pending,currency,
   primary:subscription&&subscription.status!=='COMPLETED'?enabled(subscription)?action('모의 운용 일시중지','pause',{icon:'stop',shortLabel:'중지'}):subscription.status==='PAUSED'?action('모의 운용 재개','resume',{icon:'play',shortLabel:'재개',disabled:!resumable(subscription)}):null:action('분봉 모의운용 준비','configure',{icon:'play',shortLabel:'시작 설정',disabled:!manifest||manifest.eligible===false}),
   capital:subscription&&subscription.status!=='COMPLETED'?action('운용 금액 수정','capital'):null,settings:subscription?action('운용 설정','settings',{disabled:!data}):null,items:[...(subscription?[action('운용 원장 보기','records',{group:'조회'})]:[]),action('새로고침','reload',{group:'조회',disabled:loading})]});
  const activity=subscription?{...subscription,executionMode:'paper',quoteCurrency:currency,marketIds:subscription.config?.marketIds,manifest:subscription.manifest??{graphHash:subscription.pins?.graphHash}}:null;
  const hero=subscription?.status==='COMPLETED'?'<section class="studio-sheet"><div class="studio-sheet-head"><h2>모의 운용을 종료했어요</h2><div class="actions">'+controls+'</div></div><div class="studio-sheet-body"><p>남은 현금을 공용 모의 예산으로 돌려보냈습니다. 이전 판단과 체결은 원장에서 확인할 수 있어요.</p>'+button('공용 모의 예산','budget')+'</div></section>':renderMindActivityHero(activity,{profileId:context().profileId,avatarConfig:hooks.getAppearance?.(context().profileId),idPrefix:'event-paper-'+context().profileId,controls,loading:loading&&!data,unavailable:Boolean(error&&!data)});
  const errors=(error?'<p class="error-text" role="alert">'+esc(error)+'</p>':'')+(responsePending(subscription)?'<p role="status">'+(subscription.runtime.providerState==='IN_FLIGHT'?'이전 판단을 처리하고 있어요.':'이전 판단 응답을 확인해야 합니다. 운용 원장에서 저장된 기록을 확인하세요.')+'</p>':'');
  const source='<p class="tiny muted">분봉 모의운용 · '+esc(period(subscription?.config?.timeframe??manifest?.timeframe??context().manifest?.data?.strategyPlan?.graph?.executionScope?.timeframe))+helpTooltip('분봉 모의 운용','이 앱의 운용기가 켜져 있는 동안 관측한 확정 봉마다 후보를 평가합니다. 실제 계좌로 주문을 보내지 않습니다.',{id:'event-paper-source-help'})+'</p>';
  const holdings=subscription?'<section class="studio-sheet"><div class="studio-sheet-head"><h3>모의 계좌</h3>'+button('운용 원장 보기','records',subscription.id,pending)+'</div><div class="studio-sheet-body">'+row(subscription.status==='COMPLETED'?'종료 시 현금':'현금',amount(ledger?.cash,currency))+row(subscription.status==='COMPLETED'?'종료 시 평가자산':'평가자산',amount(ledger?.equity,currency))+row('실현 손익',amount(ledger?.realizedPnl,currency))+(list(ledger?.positions).length?list(ledger.positions).map(position=>row(symbol(position.instrumentId),'<span title="'+esc(position.quantity??'')+'">'+quantity(position.quantity)+' '+esc(position.asset??'')+'</span>')).join(''):'<p class="tiny muted">보유 종목이 없습니다.</p>')+(ledger?.valuationAsOf?'<p class="tiny muted">평가 기준 '+esc(time(ledger.valuationAsOf))+'</p>':'')+'</div></section>':'';
  const waiting=!subscription&&!loading?'<section class="studio-sheet"><div class="studio-sheet-body">'+row('투자 범위',paperMarketScopeMarkup(manifest?.marketIds))+row('배정 가능 모의 예산',amount(data?.budget?.available,currency))+reasonsMarkup(data?.blockedReasons)+button('공용 모의 예산','budget')+button('기록한 시세로 비교','lab')+'</div></section>':'';
  const runner=data?.runner,runnerMessage=runner&&!['STARTING','RUNNING','IDLE'].includes(runner.status)?'운용기 상태를 확인해 주세요.':null;
  return '<section data-event-paper>'+source+errors+(runnerMessage?'<p role="status">'+runnerMessage+helpTooltip('운용기 상태',[runner.status,runner.heartbeatAt?'최근 확인 '+time(runner.heartbeatAt):null,runner.lastError?.message].filter(Boolean).join(' · '),{id:'event-paper-runner-help'})+'</p>':'')+'<div class="mind-operation-layout"><div class="mind-operation-primary">'+hero+waiting+(subscription?eventPaperCandidatesMarkup(subscription)+holdings:'')+'</div>'+renderMindActivityFeed(activity,{profileId:context().profileId,executionMode:'paper'})+'</div></section>';
 }
 function configure(){
  const c=context(),manifest=data?.currentManifest;if(!handles()||!c.eligible||!manifest||manifest.eligible===false||hasOpenSubscription()||pending)return;
  preview=null;resume=null;release=null;const currency=manifest.quoteCurrency??data.budget?.quoteCurrency,requiresJev=manifest.requiresJev===true,hourly=manifest.timeframe==='1h';
  open(hourly?'시간봉 모의운용 준비':'분봉 모의운용 준비',form('prepare','<div class="full">'+row('투자 범위',paperMarketScopeMarkup(manifest.marketIds))+row('판단 주기',esc(period(manifest.timeframe)))+row('배정 가능 모의 예산',amount(data.budget?.available,currency))+'</div><label class="field">운용할 모의 자금 ('+esc(currency)+')<input name="capitalLimit" type="number" min="0.00000001" step="any" value="0" required></label><label class="field">하루 JEV 호출 한도<input name="maxJevCallsPerDay" type="number" min="'+(requiresJev?1:0)+'" max="'+JEV_EXECUTION_CALL_LIMIT+'" step="1" value="'+(requiresJev?String(Math.ceil(1440/Number.parseFloat(manifest.timeframe))):'0')+'"'+(!requiresJev?' readonly':'')+' required></label>'+'<div class="full">'+button('모의 계좌 최대 금액','prepare-max')+'</div>'+(hourly?'<label class="field">공개 시세 총 조회 예산<input name="maxPublicRequests" type="number" min="1" step="1" value="1000" required></label><p class="tiny muted full">시간봉 모의는 종료 시각과 조회 예산을 정합니다. 예산은 재개 후에도 이어집니다.</p>':'')+operationWindowFields({}, {requiresEnd:hourly})+'<p class="tiny muted full">모의 예산에서 자금을 배정합니다. 다음 화면에서 확인한 뒤 시작할 수 있어요.</p><div class="full">'+button('공용 모의 예산','budget')+'</div>','설정 검토'));
 }
 function review(){
  const p=preview;if(!p)return;const allowed=p.canStart===true&&p.id&&p.nonce&&Number.isFinite(Date.parse(p.expiresAt))&&Date.parse(p.expiresAt)>now();
  open('분봉 모의운용 시작 검토',form('start','<div class="full">'+configuration(p.config,p.pins)+reasonsMarkup(p.blockedReasons)+(!allowed?button('공용 모의 예산','budget'):'')+'</div><label class="check full"><input name="confirmed" type="checkbox"'+(!allowed?' disabled':'')+'> 위 모의 자금을 배정하고 확정 봉마다 자동으로 모의 매매하는 데 동의합니다.</label>','분봉 모의운용 시작',!allowed));
 }
 async function editCapital(id,maximum=false){
  await load({force:true});const subscription=subscriptions().find(s=>s.id===id);if(!subscription||subscription.status==='COMPLETED'||pending)return;const currency=subscription.config.quoteCurrency,max=Number(subscription.config.capitalLimit)+Number(data.budget?.available??0);
  open('운용 금액 수정',form('capital','<div class="full">'+row('배정 가능한 최대',amount(String(max),currency))+'</div><label class="field">운용 자금 ('+esc(currency)+')<input name="capitalLimit" type="number" min="0.00000001" max="'+max+'" step="any" value="'+(maximum?max:esc(subscription.config.capitalLimit))+'" required></label><input type="hidden" name="subscriptionId" value="'+esc(id)+'"><div class="full">'+button('모의 계좌 최대 금액','capital-max',id)+'</div><p class="tiny muted full">보유와 원장을 유지하고 다음 판단부터 적용합니다.</p>','저장하고 운용에 반영'));
 }
 function settings(id){
  if(!handles()||!data)return;const subscription=id?subscriptions().find(item=>item.id===id):selected();if(!subscription)return configure();
  open('분봉 모의 운용 설정',configuration(subscription.config,subscription.pins)+row('현재 상태',status(subscription.status))+(subscription.status==='COMPLETED'?'<p class="tiny muted">회수한 자금은 공용 모의 예산에서 확인할 수 있습니다.</p>':'<p class="tiny muted">일시중지해도 보유 자산과 원장은 유지됩니다. 재개하면 같은 정책과 계좌로 이어갑니다.</p>')+(subscription.status==='PAUSED'&&!releasable(subscription)&&subscription.releaseBlockedReason?'<p class="tiny muted">'+esc(subscription.releaseBlockedReason)+'</p>':'')+'<div class="actions spaced">'+(enabled(subscription)?button('모의 운용 일시중지','pause',subscription.id,pending):subscription.status==='PAUSED'?button('모의 운용 재개','resume',subscription.id,pending||!resumable(subscription),true):'')+(releasable(subscription)?button('종료하고 자금 회수','release-review',subscription.id,pending):'')+button('운용 원장 보기','records',subscription.id,pending)+'</div>');
 }
 function resumeReview(id){
  const subscription=subscriptions().find(item=>item.id===id);if(!resumable(subscription)||pending)return;preview=null;resume={id,revision:subscription.revision,scope:contextKey()};
  open('분봉 모의운용 재개',form('resume','<div class="full">'+configuration(subscription.config,subscription.pins)+row('현재 현금',amount(subscription.ledger?.cash,subscription.config?.quoteCurrency))+'<p>추가 자금 배정 없이 저장된 정책·보유 자산·원장을 이어갑니다.</p></div><label class="check full"><input name="confirmed" type="checkbox"> 저장된 모의 운용을 재개합니다.</label>','모의 운용 재개'));
 }
 function releaseReview(id){
  const subscription=subscriptions().find(item=>item.id===id);if(!releasable(subscription)||pending)return;preview=null;resume=null;release={id,revision:subscription.revision,scope:contextKey()};
  const currency=subscription.config.quoteCurrency;
  open('모의 운용 종료·자금 회수',form('release','<div class="full">'+row('배정 원금',amount(subscription.ledger?.initialCapital,currency))+row('반환할 현금',amount(subscription.ledger?.cash,currency))+row('실현 손익',amount(subscription.ledger?.realizedPnl,currency))+'<p>이 운용을 종료하고 남은 현금을 공용 모의 예산으로 돌려보냅니다. 판단과 체결 기록은 보존됩니다.</p></div><label class="check full"><input name="confirmed" type="checkbox"> 모의 운용 종료와 자금 회수를 확인했습니다.</label>','종료하고 자금 회수'));
 }
 async function records(id){
  const subscription=subscriptions().find(item=>item.id===id),scope=contextKey();if(!subscription||pending)return;const token=hooks.getDialogToken?.();pending=true;
  try{const result=await hooks.request(BASE+'/records?'+new URLSearchParams({subscriptionId:id,limit:'30'}));if(current(scope)&&(token===undefined||token===hooks.getDialogToken?.()))open('분봉 모의 운용 원장',eventPaperRecordsMarkup(result.items,subscription.config?.quoteCurrency));}
  catch(problem){if(current(scope))hooks.toast?.(problem.message);}
  finally{pending=false;redraw();}
 }
 async function pause(id){
  const subscription=subscriptions().find(item=>item.id===id),scope=contextKey();if(!subscription||!enabled(subscription)||pending)return;pending=true;
  try{const result=await hooks.request(BASE+'/pause',{subscriptionId:id,expectedSubscriptionRevision:subscription.revision,idempotencyKey:newKey()});if(current(scope)){acceptMutation(result);hooks.close?.();await load({force:true});hooks.toast?.('모의 운용을 일시중지했습니다.');}}
  catch(problem){if(current(scope)){error=problem.message;hooks.toast?.(problem.message);}}
  finally{pending=false;redraw();}
 }
 async function click(event){
  const node=event.target.closest?.('[data-event-paper-action]');if(!node)return;event.preventDefault();if(node.disabled||!handles())return;const action=node.dataset.eventPaperAction,id=node.dataset.eventPaperId;
  if(action==='prepare-max'){const input=node.closest?.('form')?.querySelector('[name="capitalLimit"]');if(input)input.value=String(data.budget?.available??0);return;}if(action==='capital')return editCapital(id);if(action==='capital-max')return editCapital(id,true);if(action==='reload')return load({force:true});if(action==='configure')return configure();if(action==='settings')return settings(id);if(action==='resume')return resumeReview(id);if(action==='release-review')return releaseReview(id);if(action==='pause')return pause(id);if(action==='records')return records(id);
  if(action==='budget'){preview=null;resume=null;release=null;hooks.close?.();return hooks.navigate?.('settings',{executionMode:'paper',view:'accounts'});}
  if(action==='lab')return hooks.navigate?.('minds',{profileId:context().profileId,view:'simulations',lab:'compare',labStep:'strategy',a:null,b:null,simulationId:null,draftId:null});
 }
 async function submit(event){
  const element=event.target.closest?.('[data-event-paper-form]');if(!element)return;event.preventDefault();const scope=contextKey();if(pending||!handles()||element.dataset.eventPaperScope!==scope)return;
  const values=Object.fromEntries(new FormData(element)),kind=element.dataset.eventPaperForm,errorNode=element.querySelector('[data-event-paper-error]'),controls=[...element.querySelectorAll('input,button')].map(control=>({control,disabled:control.disabled})),dialogToken=hooks.getDialogToken?.();errorNode.textContent='';pending=true;for(const {control}of controls)control.disabled=true;
  try{
   if(kind==='capital'){
    const subscription=subscriptions().find(s=>s.id===values.subscriptionId);if(!subscription||subscription.status==='COMPLETED')throw Error('운용 계좌를 다시 조회하세요.');const result=await submitFunding(hooks.request,BASE+'/capital',{subscriptionId:subscription.id,executionMode:'paper',capitalLimit:values.capitalLimit,expectedSubscriptionRevision:subscription.revision,expectedRevision:observedRevision(),idempotencyKey:newKey()});if(current(scope)){acceptMutation(result);hooks.close?.();await load({force:true});hooks.toast?.('운용 금액을 반영했습니다.');}
   }else if(kind==='prepare'){

    if(!context().eligible||data?.currentManifest?.eligible===false||hasOpenSubscription())throw new Error('현재 정책과 모의 운용 상태를 다시 확인하세요.');
    if(!numeric(values.capitalLimit)||Number(values.capitalLimit)<=0)throw new Error('배정할 모의 자금을 입력하세요.');const calls=Number(values.maxJevCallsPerDay);if(!Number.isSafeInteger(calls)||calls<0||calls>JEV_EXECUTION_CALL_LIMIT)throw new Error('하루 JEV 호출 한도를 0~10000회로 입력하세요.');
    const hourly=data.currentManifest.timeframe==='1h',publicBudget=Number(values.maxPublicRequests);if(hourly&&(!Number.isSafeInteger(publicBudget)||publicBudget<=0||!values.endsAt))throw new Error('공개 시세 조회 예산과 종료 시각을 입력하세요.');
    const result=await hooks.request(BASE+'/prepare',{...(hourly?{maxPublicRequests:publicBudget}:{}),profileId:context().profileId,executionMode:'paper',capitalLimit:values.capitalLimit,maxJevCallsPerDay:calls,...operationWindowValues(values),expectedRevision:observedRevision(),idempotencyKey:newKey()});
    if(current(scope)&&(dialogToken===undefined||dialogToken===hooks.getDialogToken?.())){data={...data,revision:result.revision};preview={...result.preview,canStart:result.canStart,blockedReasons:result.blockedReasons};previewScope=scope;pending=false;review();}
   }else if(kind==='release'){
    if(values.confirmed!=='on')throw new Error('종료와 회수 금액을 확인하고 동의해 주세요.');
    const subscription=subscriptions().find(item=>item.id===release?.id);if(!release||release.scope!==scope||!releasable(subscription)||subscription.revision!==release.revision)throw new Error('회수 가능한 운용 상태를 다시 확인하세요.');
    release=null;
    const result=await hooks.request(BASE+'/release',{subscriptionId:subscription.id,expectedSubscriptionRevision:subscription.revision,idempotencyKey:newKey()});
    if(current(scope)){acceptMutation(result);if(dialogToken===undefined||dialogToken===hooks.getDialogToken?.()){const receipt=result.returnReceipt,currency=subscription.config.quoteCurrency;open('모의 자금 회수 완료',row('배정 원금',amount(receipt?.originalCapital,currency))+row('반환한 현금',amount(receipt?.returnedCash,currency))+row('실현 손익',amount(receipt?.realizedPnl,currency))+row('회수 시각',esc(time(receipt?.at)))+'<div class="actions spaced">'+button('공용 모의 예산','budget')+button('운용 원장 보기','records',subscription.id)+'</div>');}await load({force:true});}
   }else if(kind==='start'||kind==='resume'){
    if(values.confirmed!=='on')throw new Error('모의 운용 내용을 확인하고 동의해 주세요.');let body;
    if(kind==='start'){const p=preview;if(!p||previewScope!==scope||!p.canStart||!p.id||!p.nonce||!Number.isFinite(Date.parse(p.expiresAt))||Date.parse(p.expiresAt)<=now())throw new Error('모의 운용 설정을 다시 검토하세요.');body={previewId:p.id,nonce:p.nonce,userConfirmed:true};preview=null;}
    else{const s=subscriptions().find(item=>item.id===resume?.id);if(!resume||resume.scope!==scope||!resumable(s)||s.revision!==resume.revision)throw new Error('중지된 운용 상태를 다시 확인하세요.');body={subscriptionId:s.id,userConfirmed:true};resume=null;}
    const result=await hooks.request(BASE+'/start',{...body,expectedRevision:observedRevision(),idempotencyKey:newKey()});if(current(scope)){acceptMutation(result);if(dialogToken===undefined||dialogToken===hooks.getDialogToken?.())hooks.close?.();await load({force:true});hooks.toast?.('분봉 모의 운용을 시작했습니다.');}
   }
  }catch(problem){if(element.isConnected!==false)errorNode.textContent=problem.message;else hooks.toast?.(problem.message);}
  finally{pending=false;for(const {control,disabled}of controls)if(control.isConnected!==false)control.disabled=disabled;redraw();}
 }
 return {load,render,click,submit,handles,openSettings:settings,openConfigure:configure,destroy(){disposed=true;generation++;preview=null;resume=null;release=null;data=null;},state:()=>({data,loading,pending,error,scope:key,preview,readAt})};
}
