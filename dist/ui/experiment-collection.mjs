import {renderActionMenu} from './action-menu.mjs';
import {renderFilterSummary} from './workflow-state.mjs';
import {createCursorHistory} from './cursor-navigation.mjs';
import {partialPortfolioValuation} from './simulation-valuation.mjs';

const BASE='/api/workspace/simulations/collection';
const escape=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const kinds={simulation:'백테스트',comparison:'전략 비교',tuning:'전략 튜닝'};
const statuses={DRAFT:'초안',CREATED:'실행 준비',READY:'실행 준비',RUNNING:'실행 중',TRAINING:'탐색 중',VALIDATING:'검증 중',PAUSED:'일시중지',COMPLETED:'완료',ACTION_REQUIRED:'확인 필요',FAILED:'실행 실패'};
const statusFilters={draft:'초안',active:'진행 중',completed:'완료',attention:'확인 필요'};
const filters={expQuery:'q',expKind:'kind',expStatus:'status',expArchived:'archived',expCursor:'cursor'};
const array=value=>Array.isArray(value)?value:[];
const button=(label,action,id='',extra='',className='')=>`<button type="button" class="button small ${className}" data-experiment-action="${action}" data-experiment-id="${escape(id)}" ${extra}>${escape(label)}</button>`;
const options=(values,current)=>values.map(([value,label])=>`<option value="${escape(value)}" ${value===current?'selected':''}>${escape(label)}</option>`).join('');
const date=value=>value&&Number.isFinite(Date.parse(value))?new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value)).replace(/\.\s*$/,''):'—';
const time=value=>new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Seoul',hour:'2-digit',minute:'2-digit',second:'2-digit',...(new Date(value).getUTCMilliseconds()?{fractionalSecondDigits:3}:{}),hour12:false}).format(new Date(value));
function periodRange({startAt,endAt},isDraft){
 const start=date(startAt),end=date(endAt);
 if(start==='—'||end==='—')return `<span>${isDraft?'기간 선택':escape(start+' – '+end)}</span>`;
 const startTime=`<time datetime="${escape(startAt)}">${escape(time(startAt))}</time>`;
 const endTime=`<time datetime="${escape(endAt)}">${escape(time(endAt))}</time>`;
 return start===end
  ?`<span>${escape(start)}<small>${startTime} – ${endTime} KST</small></span>`
  :`<span>${escape(start)} ${startTime}<small>– ${escape(end)} ${endTime} KST</small></span>`;
}
const percent=value=>Number.isFinite(value)?new Intl.NumberFormat('ko-KR',{minimumFractionDigits:2,maximumFractionDigits:2,signDisplay:'exceptZero'}).format(value*100)+'%':'—';

export function experimentCollectionActive(route){return route?.page==='minds'&&route.params.get('view')==='simulations'&&!route.params.get('lab')&&!route.params.get('simulationId')&&!route.params.get('learningId')&&!route.params.get('setup')&&!route.params.get('prepare');}
export function experimentCollectionQuery(route){
 const query=new URLSearchParams({mindId:route.params.get('profileId')||'all',pageSize:'20'});
 for(const [key,name]of Object.entries(filters)){const value=route.params.get(key);if(value&&value!=='all'&&!(name==='archived'&&value==='false'))query.set(name,value);}
 return query;
}
const searchKey=route=>{const query=experimentCollectionQuery(route);query.delete('cursor');return query.toString();};
export function experimentCollectionDestination(item){return {view:'simulations',lab:null,labStep:null,labView:null,draftId:null,simulationId:null,learningId:null,learningView:null,learningStep:null,previousLearningId:null,a:null,b:null,comparisonA:null,comparisonB:null,setup:null,setupStep:null,prepare:null,tab:'overview',cursor:null,...item.route};}

/** The collection is a projection of saved experiments; row actions retain their canonical routes. */
export function createExperimentCollection(hooks){
 let data=null,loading=false,error='',commandError='',notice='',busyId='',root=null,started=false,generation=0,loadedKey='',abort=null,dialogReturn=null,searchDraft=null,filterFocus=null,pageFocus=null,returnFocus=null,undo=null,actionFocus=null;
 const cursors=createCursorHistory(),keys=new Map(),route=()=>hooks.getRoute(),active=()=>experimentCollectionActive(route()),minds=()=>array(hooks.getMinds?.()),redraw=()=>hooks.render?.();
 const routeKey=()=>experimentCollectionQuery(route()).toString(),scope=()=>route().params.get('profileId')||'all';
 const navigate=params=>hooks.navigate('minds',{view:'simulations',lab:null,labStep:null,labView:null,draftId:null,simulationId:null,learningId:null,learningView:null,learningStep:null,previousLearningId:null,a:null,b:null,comparisonA:null,comparisonB:null,setup:null,setupStep:null,prepare:null,tab:'overview',cursor:null,...params});
 const contextKey=()=>routeKey()+'|'+(route().params.get('executionMode')||'paper');
 async function load({force=false}={}){
  if(!active()||undo&&undo.context!==contextKey()){undo=null;notice='';actionFocus=null;}
  if(!active()){if(route().page!=='minds'||route().params.get('view')!=='simulations')returnFocus=null;generation++;abort?.abort();loading=false;loadedKey='';searchDraft=null;filterFocus=null;pageFocus=null;return;}
  const key=routeKey();if(returnFocus&&(returnFocus.key!==key||returnFocus.mode!==(route().params.get('executionMode')||'paper')))returnFocus=null;if(pageFocus&&pageFocus!==key)pageFocus=null;if(searchDraft&&searchDraft.key!==searchKey(route()))searchDraft=null;if(!force&&key===loadedKey&&(loading||data))return;
  const token=++generation;abort?.abort();abort=new AbortController();loadedKey=key;loading=true;error='';redraw();
  try{const value=await hooks.request(BASE+'?'+key,undefined,{signal:abort.signal});if(token!==generation||!active()||routeKey()!==key)return;data=value;}
  catch(problem){if(token===generation&&active()&&routeKey()===key&&problem.name!=='AbortError'){data=null;error=problem.message;}}
  finally{if(token===generation&&active()&&routeKey()===key){loading=false;redraw();}}
 }
 function mindLabel(item){const ids=array(item.mindIds).length?item.mindIds:[item.mindId];return [...new Set(ids)].map(id=>minds().find(mind=>mind.id===id)?.name||item.mindName||'마인드').join(' · ');}
 const outcomeLabel=item=>item.performance?.label??item.metricsLabel??(item.kind==='comparison'?'B 수익률':item.kind==='tuning'?'검증 수익률':'순수익률');
 function outcome(item,sharedLabel){
  if(item.recordType==='EDITOR_DRAFT'||item.status==='DRAFT'||partialPortfolioValuation(item))return '<span class="experiment-outcome-empty">—</span>';
  const performance=item.performance,value=performance?performance.value:item.metrics?.totalReturn,label=outcomeLabel(item);
  if(!Number.isFinite(value))return '<span class="experiment-outcome-empty">—</span>';
  const text=performance?.unit==='percentage-point'?percent(value).replace('%','%p'):percent(value);
  return `<strong class="experiment-return" data-direction="${value>0?'positive':value<0?'negative':'neutral'}">${escape(text)}</strong><small${sharedLabel===label?' class="experiment-shared-outcome"':''}>${escape(label)}</small>`;
 }
 function row(item,showKind,sharedLabel){
  const period=item.period||{},name=item.name||'저장된 실험',mind=mindLabel(item),isBusy=busyId===item.id,archived=!!item.archivedAt,phase=item.status,isDraft=item.recordType==='EDITOR_DRAFT'||phase==='DRAFT',evaluation=item.evaluationStatus??item.evaluationEligibility?.status,phaseLabel=phase==='COMPLETED'&&partialPortfolioValuation(item)?'부분 계좌 평가':phase==='COMPLETED'&&evaluation==='PARTIAL_WINDOW'?'부분 평가':phase==='COMPLETED'&&evaluation==='NO_EVALUABLE_DECISIONS'?'자료 준비 부족':statuses[phase]||phase||'저장됨';
  const verdict=item.kind==='tuning'&&phase==='COMPLETED'?({REVIEW_REQUIRED:'검증 통과',HOLDOUT_REJECTED:'검증 기준 미달',KEEP_CURRENT:'기존 전략 유지'})[item.proposalStatus]:null;
  const validation=verdict?`<small data-experiment-validation="${escape(item.proposalStatus)}">${verdict}</small>`:'';
  const adoption=item.kind==='tuning'&&phase==='COMPLETED'&&typeof item.adoption?.documentId==='string'&&item.adoption.documentId.trim()?'<small data-experiment-adoption>초안 저장됨</small>':'';
  const blocked=isBusy||item.canArchive===false;
  const href=hooks.href?.('minds',experimentCollectionDestination(item)),nameControl=href?'<a class="button small experiment-name" href="'+escape(href)+'" data-experiment-action="open" data-experiment-id="'+escape(item.id)+'" title="'+escape(name)+'">'+escape(name)+'</a>':button(name,'open',item.id,`title="${escape(name)}"`,'experiment-name');
  const actions=renderActionMenu({id:'experiment-actions-'+item.id,label:name+' 작업',compact:true,items:[{label:isDraft?'이어 편집':'열기',href,attributes:{'data-experiment-action':'open','data-experiment-id':item.id}},{label:archived?'복원':'보관',disabled:blocked,attributes:{'data-experiment-action':archived?'restore':'archive','data-experiment-id':item.id}}]});
  const showMind=scope()==='all'||!minds().some(mind=>mind.id===scope())||array(item.mindIds).filter(Boolean).some(id=>id!==scope())||(!array(item.mindIds).length&&item.mindId!==scope());
  return `<tr role="row" data-experiment-row="${escape(item.id)}" ${isBusy?'aria-busy="true"':''}>
   <td role="cell" class="experiment-name-cell">${nameControl}${showMind?`<span class="experiment-mind" title="${escape(mind)}">${escape(mind)}</span>`:''}</td>
   ${showKind?`<td role="cell" class="experiment-kind-cell"><span class="experiment-kind">${escape(kinds[item.kind]||'실험')}</span></td>`:''}
   <td role="cell" class="experiment-period-cell"><span class="experiment-compact-period-label">테스트 기간</span>${periodRange(period,isDraft)}</td>
   <td role="cell" class="experiment-status-cell"><span class="experiment-status" data-state="${escape(phase)}">${escape(phaseLabel)}</span>${!isDraft&&Number.isInteger(item.progress?.total)&&item.progress.total>0&&phase!=='COMPLETED'?`<small>${item.progress.completed??0} / ${item.progress.total}${item.progress.unit==='bars'?'봉':' 실행'}</small>`:''}${validation}${adoption}</td>
   <td role="cell" class="experiment-outcome-cell">${outcome(item,sharedLabel)}</td>
   <td role="cell" class="experiment-menu-cell">${actions}</td>
  </tr>`;
 }
 function render(){
  if(!active())return '';
  const params=route().params,archived=params.get('expArchived')==='true',query=params.get('expQuery')||'',kind=params.get('expKind')||'all',status=params.get('expStatus')||'all',filtered=!!query||kind!=='all'||status!=='all',items=array(data?.items),q=experimentCollectionQuery(route()),pending=loading||loadedKey!==q.toString(),inputQuery=searchDraft?.key===searchKey(route())?searchDraft.value:query,heading=scope()==='all'?'h1':'h2';
  const filterMarkup=`<form class="experiment-filters" data-experiment-search><div class="experiment-search"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/></svg><input type="search" name="expQuery" aria-label="실험 이름 검색" value="${escape(inputQuery)}" placeholder="실험 이름 검색" maxlength="160"><button type="submit" class="button small">검색</button></div><label class="experiment-filter"><span class="sr-only">실험 종류</span><select name="expKind" aria-label="실험 종류">${options([['all','모든 실험'],...Object.entries(kinds)],kind)}</select></label><label class="experiment-filter"><span class="sr-only">실험 상태</span><select name="expStatus" aria-label="실험 상태">${options([['all','모든 상태'],...Object.entries(statusFilters)],status)}</select></label></form>`;
  const filterSummary=renderFilterSummary([{key:'expQuery',label:'이름',value:query},{key:'expKind',label:'종류',value:kind!=='all'?(kinds[kind]||kind):''},{key:'expStatus',label:'상태',value:status!=='all'?(statusFilters[status]||status):''}].map(item=>({...item,remove:button('×','clear-filter',item.key,'aria-label="'+item.label+' 필터 해제"','workflow-filter-remove')})),button('필터 지우기','clear','','','experiment-filter-clear'));
  const showKind=!Object.hasOwn(kinds,kind)||items.some(item=>item.kind!==kind);
  const sharedLabel=!showKind&&items.length>0&&items.every(item=>outcomeLabel(item)===outcomeLabel(items[0]))?outcomeLabel(items[0]):'';
  let body;
  if(pending)body='<div class="experiment-empty" role="status"><span class="experiment-loading-mark" aria-hidden="true"></span><p>실험을 불러오는 중…</p></div>';
  else if(error)body=`<div class="experiment-empty" tabindex="-1" role="alert"><h3>실험을 불러오지 못했어요</h3><p>${escape(error)}</p>${q.has('cursor')?button('처음 페이지','first'):button('다시 조회','refresh')}</div>`;
  else if(!items.length)body=`<div class="experiment-empty" tabindex="-1" role="status"><h3>${filtered?'검색 결과가 없습니다':archived?'보관한 실험이 없습니다':undo?'목록에 남은 실험이 없습니다':'첫 실험을 시작하세요'}</h3><p>${filtered?'다른 이름이나 조건으로 찾아보세요.':archived?'목록에서 보관한 실험을 여기에서 다시 열 수 있습니다.':undo?'보관을 되돌리거나 보관함에서 실험을 다시 열 수 있습니다.':'전략의 성과를 검증하고, 비교하고, 조정하세요.'}</p></div>`;
  else body=`<div class="experiment-table-scroll" tabindex="0" role="region" aria-label="실험 목록"><table role="table" class="experiment-table"><thead role="rowgroup"><tr role="row"><th scope="col" class="experiment-name-cell">실험</th>${showKind?'<th scope="col" class="experiment-kind-cell">종류</th>':''}<th scope="col" class="experiment-period-cell">테스트 기간</th><th scope="col" class="experiment-status-cell">상태</th><th scope="col" class="experiment-outcome-cell">${escape(sharedLabel||'성과')}</th><th scope="col" class="experiment-menu-cell"><span class="sr-only">작업</span></th></tr></thead><tbody role="rowgroup">${items.map(item=>row(item,showKind,sharedLabel)).join('')}</tbody></table></div>`;
  if(!pending&&!error&&(items.length||q.has('cursor')))body+=`<div class="experiment-pagination"><span role="status">${Number.isInteger(data?.total)?'전체 '+data.total+'개'+(items.length!==data.total?' · '+items.length+'개 표시':''):items.length+'개 표시'}</span>${q.has('cursor')||data?.page?.hasMore?`<div>${q.has('cursor')&&cursors.previous(q)?button('처음','first'):''}${q.has('cursor')?button(cursors.has(q)?'이전':'처음',cursors.has(q)?'previous':'first'):''}${data?.page?.hasMore?button('다음','next',data.page.nextCursor):''}</div>`:''}</div>`;
  return `<section class="experiment-collection" data-experiment-collection><div class="studio-page-head experiment-page-head"><div><${heading}>${archived?'실험 보관함':'실험실'}</${heading}>${archived?'<p>보관한 실험을 찾아 복원하세요.</p>':''}</div><div class="actions">${button(archived?'실험 목록':'보관함','archive-view','','','experiment-archive-link')}${button('새 실험','new','','','primary')}</div></div>${filterMarkup}${filterSummary}${notice?`<div class="experiment-notice"><span role="status">${escape(notice)}</span>${undo?button(busyId?'복원 중…':'되돌리기','undo-archive','',`aria-label="${escape(undo.item.name||'실험')} 보관 되돌리기" ${busyId?'disabled':''}`):''}</div>`:''}${commandError?`<p class="error-text" role="alert">${escape(commandError)}</p>`:''}${busyId?'<span class="sr-only" role="status">실험 목록을 저장하는 중…</span>':''}${body}</section>`;
 }
 function openCreate(){
  const selected=scope(),known=minds().some(mind=>mind.id===selected),choices=[['simulation','백테스트','한 전략의 과거 수익률과 거래를 확인합니다.'],['comparison','전략 비교','두 전략을 같은 조건에서 나란히 비교합니다.'],['tuning','전략 튜닝','설정값을 탐색하고 다른 기간에서 검증합니다.']];
  dialogReturn={key:routeKey()};
  hooks.open?.('새 실험',`<form id="experiment-create-form" data-experiment-create class="experiment-create-form"><label class="field">마인드<select name="mindId" required aria-label="실험할 마인드"><option value="">마인드 선택</option>${minds().map(mind=>`<option value="${escape(mind.id)}" ${known&&mind.id===selected?'selected':''}>${escape(mind.name)}</option>`).join('')}</select></label><fieldset class="experiment-purpose"><legend>실험 목적</legend>${choices.map(([id,label,description])=>`<label class="experiment-purpose-option"><input type="radio" name="kind" value="${id}" required><span><strong>${label}</strong><small>${description}</small></span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="m9 5 7 7-7 7"/></svg></label>`).join('')}</fieldset></form>`, '<button type="submit" class="button primary" form="experiment-create-form">계속</button>');
 }
 function archivedReceipt(item,result){
  if(result?.ok!==true||result.id&&result.id!==item.id)return null;
  const members=array(item.members),received=array(result.members).length?result.members:members.length===1&&Number.isSafeInteger(result.revision)?[{id:result.simulation?.id||result.session?.id||item.id,revision:result.revision}]:[];
  if(!members.length||received.length!==members.length||new Set(received.map(member=>member.id)).size!==members.length)return null;
  const updated=members.map(member=>received.find(value=>value.id===member.id));
  if(updated.some((member,i)=>!member||!Number.isSafeInteger(member.revision)||member.revision<members[i].revision))return null;
  return {...item,revision:Number.isSafeInteger(result.revision)?result.revision:undefined,members:updated.map(({id,revision})=>({id,revision}))};
 }
 async function archive(item,action){
  if(busyId||!item||item.canArchive===false)return;const token=generation,context=contextKey(),isUndo=action==='restore'&&undo?.item===item,identity=JSON.stringify({action,id:item.id,kind:item.kind,revision:item.revision,members:item.members}),idempotencyKey=keys.get(identity)||crypto.randomUUID();keys.set(identity,idempotencyKey);busyId=item.id;commandError='';if(!isUndo){notice='';undo=null;}actionFocus={action,id:item.id,context};redraw();
  try{const result=await hooks.request(BASE+'/'+action,{id:item.id,kind:item.kind,...(Number.isSafeInteger(item.revision)?{expectedRevision:item.revision}:{}),memberRevisions:array(item.members).map(member=>({id:member.id,revision:member.revision})),idempotencyKey});keys.delete(identity);if(token!==generation||!active()||contextKey()!==context)return;const saved=action==='archive'?archivedReceipt(item,result):null;undo=saved?{item:saved,context}:null;notice=action==='restore'?'실험을 복원했습니다.':'실험을 보관했습니다.';await load({force:true});}
  catch(problem){if(token===generation&&active()&&contextKey()===context){commandError=problem.message;redraw();}}
  finally{busyId='';if(active()&&contextKey()===context)redraw();}
 }
 function goPage(cursor){const q=experimentCollectionQuery(route());cursor?q.set('cursor',cursor):q.delete('cursor');pageFocus=q.toString();filterFocus=null;return navigate({expCursor:cursor});}
 async function click(event){
  if(!active())return;const control=event.target.closest?.('[data-experiment-action]');if(!control||control.disabled)return;if(control.tagName==='A'&&(event.defaultPrevented||event.button>0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey))return;event.preventDefault();const {experimentAction:action,experimentId:id}=control.dataset;
  if(action==='undo-archive')return undo?.context===contextKey()?archive(undo.item,'restore'):undefined;
  if(action==='new')return openCreate();
  if(action==='refresh')return load({force:true});
  if(action==='clear'){notice='';searchDraft=null;filterFocus={name:'expQuery',start:0,end:0,requested:true};return navigate({expQuery:null,expKind:null,expStatus:null,expCursor:null});}
  if(action==='clear-filter'&&['expQuery','expKind','expStatus'].includes(id)){
   notice='';const next=new URLSearchParams(route().params);next.delete(id);next.delete('expCursor');
   searchDraft=id==='expQuery'?null:searchDraft?.key===searchKey(route())?{...searchDraft,key:searchKey({page:'minds',params:next})}:null;
   filterFocus={name:id,start:0,end:0,requested:true};return navigate({[id]:null,expCursor:null});
  }
  if(action==='archive-view'){notice='';return navigate({expArchived:route().params.get('expArchived')==='true'?null:'true',expCursor:null});}
  if(action==='next'){const q=experimentCollectionQuery(route());cursors.remember(q,id);return goPage(id);}
  if(action==='previous')return goPage(cursors.previous(experimentCollectionQuery(route())));
  if(action==='first')return goPage(null);
  const item=array(data?.items).find(item=>item.id===id);if(!item)return;
  if(action==='open'){returnFocus={key:routeKey(),mode:route().params.get('executionMode')||'paper',id:item.id,params:{profileId:scope(),...Object.fromEntries(Object.keys(filters).map(key=>[key,route().params.get(key)]))}};return hooks.navigate('minds',experimentCollectionDestination(item));}
  if(action==='archive'||action==='restore')return archive(item,action);
 }
 async function submit(event){
  if(!active())return;
  const create=event.target.closest?.('[data-experiment-create]'),search=event.target.closest?.('[data-experiment-search]');if(!create&&!search)return;event.preventDefault();
  const values=Object.fromEntries(new FormData(create||search));
  if(search){notice='';searchDraft=null;return navigate({expQuery:String(values.expQuery||'').trim()||null,expKind:values.expKind==='all'?null:values.expKind,expStatus:values.expStatus==='all'?null:values.expStatus,expCursor:null});}
  const mindId=String(values.mindId||''),kind=values.kind;if(!minds().some(mind=>mind.id===mindId)||!Object.hasOwn(kinds,kind)){create.reportValidity?.();return;}
  dialogReturn=null;hooks.close?.();
  if(kind==='simulation')return hooks.beginSingle?hooks.beginSingle({mindId}):navigate({profileId:mindId,setup:'new'});
  if(kind==='comparison'&&hooks.beginComparison)return hooks.beginComparison({mindId});
  return navigate({profileId:mindId,lab:kind==='comparison'?'compare':'learn',learningId:kind==='tuning'?'new':null});
 }
 function change(event){if(!active()||!['expKind','expStatus'].includes(event.target.name))return;event.target.closest?.('[data-experiment-search]')?.requestSubmit();}
 function input(event){if(active()&&event.target.name==='expQuery'&&event.target.closest?.('[data-experiment-search]'))searchDraft={key:searchKey(route()),value:event.target.value};}
 function focusin(){actionFocus=null;pageFocus=null;if(active())returnFocus=null;}
 function dialogClosed(event){const saved=dialogReturn;if(!saved||event.target.id!=='detail-dialog')return;dialogReturn=null;queueMicrotask(()=>{if(active()&&routeKey()===saved.key&&!document.querySelector?.('dialog[open]'))root?.querySelector?.('[data-experiment-action="new"]')?.focus?.({preventScroll:true});});}
 function mount(container){root=container;if(!active())return;if(actionFocus){if(actionFocus.context!==contextKey()){actionFocus=null;}else if(!loading&&!busyId){const saved=actionFocus;actionFocus=null;const restored=saved.action==='restore'?[...(container.querySelectorAll?.('.experiment-name')||[])].find(node=>node.dataset.experimentId===saved.id):null;const node=error?container.querySelector('[data-experiment-action="refresh"], [data-experiment-action="first"]'):restored||container.querySelector(undo?'[data-experiment-action="undo-archive"]':'[data-experiment-action="archive-view"]');node?.focus?.({preventScroll:true});return;}}if(returnFocus){if(loading||loadedKey!==returnFocus.key||routeKey()!==returnFocus.key)return;const saved=returnFocus;returnFocus=null;const node=[...(container.querySelectorAll?.('.experiment-name')||[])].find(node=>node.dataset.experimentId===saved.id)||container.querySelector('.experiment-table-scroll, .experiment-empty');node?.focus?.({preventScroll:false});return;}if(pageFocus){if(loading||loadedKey!==pageFocus||routeKey()!==pageFocus)return;const node=container.querySelector('.experiment-table-scroll, .experiment-empty');if(node){pageFocus=null;filterFocus=null;node.focus?.({preventScroll:false});}return;}if(!filterFocus||filterFocus.action&&loading)return;const saved=filterFocus;filterFocus=null;const node=container.querySelector(saved.action?'[data-experiment-action="'+saved.action+'"]':'[data-experiment-search] [name="'+saved.name+'"]');node?.focus?.({preventScroll:true});if(saved.name==='expQuery')node?.setSelectionRange?.(saved.start,saved.end);}
 function unmount(){const node=typeof document==='undefined'?null:document.activeElement;if(!pageFocus&&!filterFocus?.requested&&root?.contains?.(node)&&node?.closest?.('[data-experiment-search], [data-experiment-action="refresh"], [data-experiment-action="first"]'))filterFocus=notice&&['refresh','first'].includes(node.dataset?.experimentAction)?{action:node.dataset.experimentAction}:{name:['expQuery','expKind','expStatus'].includes(node.name)?node.name:'expQuery',start:node.selectionStart??0,end:node.selectionEnd??0};root=null;}
 function start(){if(started||typeof document==='undefined')return;started=true;for(const [type,fn]of [['click',click],['submit',submit],['change',change],['input',input],['focusin',focusin],['close',dialogClosed]])document.addEventListener(type,fn,type==='close');}
 function destroy(){undo=null;actionFocus=null;generation++;abort?.abort();dialogReturn=null;pageFocus=null;returnFocus=null;root=null;if(started)for(const [type,fn]of [['click',click],['submit',submit],['change',change],['input',input],['focusin',focusin],['close',dialogClosed]])document.removeEventListener(type,fn,type==='close');started=false;}
 function back(){if(!returnFocus||returnFocus.mode!==(route().params.get('executionMode')||'paper'))return false;navigate(returnFocus.params);return true;}
 return {active,back,load,render,mount,unmount,start,destroy,routeChanged:()=>{commandError='';notice='';undo=null;actionFocus=null;return load();},state:()=>({data,loading,error,commandError,notice,busyId})};
}
