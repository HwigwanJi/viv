const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));

const COLLECTION_TASKS = [['overview','마인드 목록'],['records','전체 기록'],['simulations','전체 시뮬레이션']];
const JUMP_TASK_KEYWORDS = {records:'체결 거래 주문 원장',simulations:'실험실 시뮬레이션'};

const TASK_GROUPS = Object.freeze({
  library: [['자료', ['documents', 'quant']], ['운용 지식', ['experiences', 'review', 'memory']], ['가져오기', ['forms']]]
});

export function studioJumpItems(route,navigation,{routeHash,primary,library,settings}) {
  const entries=primary.map(([page,,label])=>({label,group:'주요 화면',href:routeHash(route,page,page==='minds'?{profileId:'all',view:'overview'}:{})}));
  for(const [view,label]of COLLECTION_TASKS.slice(1))entries.push({label,group:'전체 마인드',keywords:JUMP_TASK_KEYWORDS[view]||'',href:routeHash(route,'minds',{profileId:'all',view,cursor:null,simulationId:null,knowledgePage:null,tab:null,search:null,kind:null})});
  for(const mind of navigation.minds??[])if(mind.id!==navigation.selectedMindId)for(const [view,label]of [['operations','운용'],['records','기록']])entries.push({label:mind.name+' / '+label,taskLabel:mind.name,taskSuffix:label,group:'마인드',keywords:JUMP_TASK_KEYWORDS[view]||'',href:routeHash(route,'minds',{profileId:mind.id,view,cursor:null,simulationId:null,knowledgePage:null,tab:null,search:null,kind:null})});
  if(navigation.selectedMindId&&navigation.selectedMindId!=='all')for(const [view,label]of [['operations','운용'],['principles','전략'],['records','기록'],['knowledge','자료'],['simulations','실험실']])entries.push({label:navigation.scopeName+' / '+label,taskLabel:label,context:navigation.scopeName,group:'현재 마인드',keywords:JUMP_TASK_KEYWORDS[view]||'',href:routeHash(route,'minds',{profileId:navigation.selectedMindId,view,cursor:null,simulationId:null,knowledgePage:null,tab:null,search:null,kind:null})});
  for(const [page,items]of [['library',library],['settings',settings]])for(const [view,label]of items)entries.push({label,group:page==='library'?'라이브러리':'설정',href:routeHash(route,page,{view,cursor:null})});
  return entries;
}

export function studioJumpMatches(text,query){
  const target=text.toLocaleLowerCase();
  return query.toLocaleLowerCase().trim().split(/\s+/).every(term=>target.includes(term));
}

export function renderStudioJump(entries,{modeLabel='',loading=false,error=''}={}) {
  const groups=new Map();
  for(const entry of entries){if(!groups.has(entry.group))groups.set(entry.group,[]);groups.get(entry.group).push(entry);}
  const ordered=[...groups].sort(([a],[b])=>(a==='현재 마인드'?-1:b==='현재 마인드'?1:0));
  let optionIndex=0;
  return '<div class="studio-jump"><div class="studio-jump-search"><label class="field">화면 찾기<input type="search" data-studio-jump-query role="combobox" aria-autocomplete="list" aria-expanded="true" placeholder="계좌, 전략, 학습 자료…" autocomplete="off" aria-controls="studio-jump-results" aria-describedby="studio-jump-count studio-jump-help"></label>'+(modeLabel?'<span class="pill">'+escape(modeLabel)+' 화면</span>':'')+'</div><p id="studio-jump-count" class="tiny muted" data-studio-jump-count role="status" aria-live="polite">'+entries.length+'개 화면</p><div class="studio-jump-problem" data-studio-jump-problem'+(error&&!loading?'':' hidden')+'><p class="error-text" data-studio-jump-error role="alert">'+escape(error)+'</p><button type="button" class="button small" data-studio-jump-retry>다시 조회</button></div><p class="tiny muted" data-studio-jump-loading role="status"'+(loading?'':' hidden')+'>마인드 목록을 불러오는 중…</p><div id="studio-jump-results" class="studio-jump-results" role="listbox" aria-label="이동할 화면">'+ordered.map(([group,items],index)=>'<section class="studio-jump-group" role="group" data-studio-jump-group aria-labelledby="studio-jump-group-'+index+'"><h3 id="studio-jump-group-'+index+'">'+escape(group)+(items[0].context?'<span class="studio-jump-context">'+escape(items[0].context)+'</span>':'')+'</h3>'+items.map(item=>'<a id="studio-jump-item-'+optionIndex+++'" role="option" aria-selected="false" tabindex="-1" data-studio-jump-item data-studio-route data-studio-jump-search="'+escape(item.label+' '+group+(item.keywords?' '+item.keywords:''))+'" href="'+escape(item.href)+'" title="'+escape(item.label)+'"><span>'+escape(item.taskLabel||item.label)+'</span>'+(item.taskSuffix?'<span class="studio-jump-task">'+escape(item.taskSuffix)+'</span>':'')+'<span class="studio-jump-arrow" aria-hidden="true">→</span></a>').join('')+'</section>').join('')+'</div><div class="studio-jump-empty" data-studio-jump-empty hidden><p>검색한 화면이 없습니다.</p><button type="button" class="button small" data-studio-jump-clear>검색어 지우기</button></div><p id="studio-jump-help" class="sr-only">위아래 방향키로 화면을 고르고 Enter로 엽니다. Esc로 닫습니다.</p><div class="studio-jump-keys" aria-hidden="true"><span><kbd>↑</kbd><kbd>↓</kbd> 이동</span><span><kbd>Enter</kbd> 열기</span><span><kbd>Esc</kbd> 닫기</span></div></div>';
}

export function selectStudioJump(root,item){
  const items=[...root.querySelectorAll('[data-studio-jump-item]')];
  const selected=items.includes(item)&&!item.hidden?item:items.find(candidate=>!candidate.hidden);
  for(const candidate of items)candidate.setAttribute('aria-selected',String(candidate===selected));
  const query=root.querySelector('[data-studio-jump-query]');
  if(selected)query.setAttribute('aria-activedescendant',selected.id);else query.removeAttribute('aria-activedescendant');
  return selected;
}

export function filterStudioJump(root,query){
  let count=0;
  for(const item of root.querySelectorAll('[data-studio-jump-item]')){item.hidden=!studioJumpMatches(item.dataset.studioJumpSearch,query);if(!item.hidden)count++;}
  for(const group of root.querySelectorAll('[data-studio-jump-group]'))group.hidden=![...group.querySelectorAll('[data-studio-jump-item]')].some(item=>!item.hidden);
  const empty=root.querySelector('[data-studio-jump-empty]'),message=empty.querySelector?.('p');empty.hidden=count>0;
  if(message)message.textContent=root.querySelector('[data-studio-jump-loading]')?.hidden===false?'목록이 도착하면 검색 결과에 반영합니다.':'검색한 화면이 없습니다.';
  const status=root.querySelector('[data-studio-jump-count]'),label=count+'개 화면';if(status.textContent!==label)status.textContent=label;
  selectStudioJump(root,root.querySelector('[data-studio-jump-item][aria-selected="true"]'));
  return count;
}

/** The primary entry opens the collection; object tabs keep the selected mind. */
export function studioPrimaryDestination(route, page, savedHash, {routeHash, primaryRouteHash}) {
  return page === 'minds'
    ? routeHash(route, 'minds', {profileId:'all',view:'overview',cursor:null,simulationId:null,knowledgePage:null,tab:null,returnTo:null})
    : primaryRouteHash(route, page, savedHash);
}

export function renderMindWorkspace(navigation, route, {parseRoute, routeHash}) {
  if (route.page !== 'minds') return '';
  const collectionHref = routeHash(route,'minds',{profileId:'all',view:'overview',cursor:null,simulationId:null,knowledgePage:null,tab:null});
  if (navigation.selectedMindId === 'all') {
    return `<nav class="studio-mind-collection-nav" aria-label="전체 마인드 작업">${COLLECTION_TASKS.map(([view,label])=>`<a href="${escape(routeHash(route,'minds',{profileId:'all',view,cursor:null,simulationId:null,knowledgePage:null,tab:null}))}" data-studio-route${(route.params.get('view')||'overview')===view?' aria-current="page"':''}>${escape(label)}</a>`).join('')}</nav>`;
  }
  if (!navigation.scopeLoaded) return '';
  const current=route.params.get('view')||'overview';
  const items = [['operations','운용',['overview','operations']],['principles','전략',['principles']],['records','기록',['records']],['knowledge','자료',['knowledge']],['simulations','실험실',['simulations']]].map(([id,label,views])=>({...navigation.items.find(item=>item.id===id),id,label,active:views.includes(current)}));
  const returnLink = studioReturnLink(route,parseRoute,routeHash);
  const actions = ['overview','operations'].includes(current) ? navigation.scopeAutomationMarkup||'' : '';
  const scopeActions = actions?'<div class="studio-mind-workspace-actions" role="group" aria-label="마인드 편집">'+actions+'</div>':'';
  return `<section class="studio-mind-workspace" aria-label="선택한 마인드"><div class="studio-mind-workspace-top"><a href="${escape(collectionHref)}" data-studio-route class="studio-mind-back"><span aria-hidden="true">←</span> 전체 마인드</a>${returnLink?`<a href="${escape(returnLink.href)}" data-studio-route class="studio-mind-origin">${escape(returnLink.label)}</a>`:''}<label class="studio-mind-switcher"><span class="sr-only">마인드 전환</span><select data-studio-profile aria-label="마인드 전환" title="${escape(navigation.scopeName)}">${navigation.minds.map(mind=>`<option value="${escape(mind.id)}"${mind.id===navigation.selectedMindId?' selected':''}>${escape(mind.name)}</option>`).join('')}</select></label></div><div class="studio-mind-workspace-heading"><div class="studio-mind-identity">${navigation.scopeIdentityMarkup||''}<div class="studio-mind-identity-text"><h1 tabindex="-1" title="${escape(navigation.scopeName)}">${escape(navigation.scopeName)}</h1>${navigation.scopeStatus?`<span class="studio-mind-state">${escape(navigation.scopeStatus)}</span>`:''}</div></div>${scopeActions}</div><nav class="studio-mind-tabs" aria-label="마인드 화면">${items.filter(item=>!item.disabled).map(item=>`<a href="${escape(item.href)}" data-studio-route title="${escape(item.label)}"${item.active?' aria-current="page"':''}>${escape(item.label)}</a>`).join('')}</nav></section>`;
}

/** The controller owns destinations; this adapter only groups and renders them. */
export function studioNavigationGroups(page, items = []) {
  const remaining = new Map(items.map(item => [item.id, item]));
  const groups = (TASK_GROUPS[page] || []).map(([label, ids]) => ({
    label,
    items: ids.map(id => { const item = remaining.get(id); remaining.delete(id); return item; }).filter(Boolean)
  })).filter(group => group.items.length);
  if (remaining.size) groups.push({label: groups.length ? '기타' : '', items: [...remaining.values()]});
  return groups;
}

export function studioBreadcrumbs(route, navigation, routeHash) {
  if (route.page === 'home') return [{label:'홈'}];
  const view = route.params.get('view');
  const current = navigation.items.find(item => item.active)?.label || navigation.title;
  if (route.page === 'minds') {
    const crumbs = [{label: '마인드', href: routeHash(route, 'minds', {profileId:'all', view:'overview', cursor:null, simulationId:null})}];
    if (navigation.selectedMindId !== 'all') crumbs.push({label:navigation.scopeName, href:routeHash(route,'minds',{view:'overview',cursor:null,simulationId:null})});
    if (view === 'overview' && navigation.selectedMindId === 'all') return [{label:'전체 마인드'}];
    return [...crumbs, {label:current}];
  }
  if (route.page === 'trade') return [{label:'트레이딩'}, ...(navigation.selectedMindId !== 'all' ? [{label:navigation.scopeName, href:routeHash(route,'minds',{view:'overview',cursor:null})}] : []), {label:'종목 거래'}];
  return [{label:navigation.title, href:routeHash(route,route.page,{view:route.page==='library'?'documents':'connections',cursor:null})}, {label:current}];
}

export function studioReturnLink(route, parseRoute, routeHash) {
  const saved = route.params.get('returnTo');
  if (!saved || !/^#(?:home|trade|minds|library|settings)(?:\?|$)/.test(saved)) return null;
  const target = parseRoute(saved);
  if (target.page === route.page) return null;
  const label = {home:'홈으로 돌아가기',trade:'트레이딩으로 돌아가기',minds:'마인드로 돌아가기',library:'라이브러리로 돌아가기',settings:'설정으로 돌아가기'}[target.page];
  return {label, href:routeHash(target,target.page,{executionMode:route.params.get('executionMode') || 'paper'})};
}

export function renderStudioContext(navigation, route, {parseRoute, routeHash}) {
  if (route.page === 'minds' || route.page === 'home') return '';
  const groups = studioNavigationGroups(route.page, navigation.items);
  const returnLink = studioReturnLink(route, parseRoute, routeHash);
  const scope = navigation.showMindPicker
    ? `<label class="studio-mind-scope"><span>마인드 선택</span><select data-studio-profile aria-label="마인드 선택" title="${escape(navigation.scopeName)}"><option value="all"${navigation.selectedMindId==='all'?' selected':''}>전체 마인드</option>${navigation.minds.map(mind=>`<option value="${escape(mind.id)}"${mind.id===navigation.selectedMindId?' selected':''}>${escape(mind.name)}</option>`).join('')}</select></label>`
    : route.page==='trade' ? `<div class="studio-scope-summary"><span>선택한 마인드</span><span title="${escape(navigation.scopeName)}">${escape(navigation.scopeName)}</span></div>` : '';
  return `<h2>${escape(navigation.title)}</h2>${scope}<nav class="studio-secondary-nav studio-task-nav" aria-label="${escape(navigation.title)} 화면">${groups.map((group,index)=>`<div class="studio-nav-group"${group.label?` role="group" aria-labelledby="studio-nav-group-${index}"`:''}>${group.label?`<h3 id="studio-nav-group-${index}">${escape(group.label)}</h3>`:''}${group.items.map(item=>item.disabled?`<span class="disabled" aria-disabled="true" title="마인드를 선택하세요">${escape(item.label)}</span>`:`<a href="${escape(item.href)}" data-studio-route title="${escape(item.label)}"${item.active?' aria-current="page"':''}>${escape(item.label)}</a>`).join('')}</div>`).join('')}</nav>${returnLink?`<a class="studio-return-link" href="${escape(returnLink.href)}" data-studio-route title="${escape(returnLink.label)}"><span aria-hidden="true">←</span><span>${escape(returnLink.label)}</span></a>`:''}`;
}

export function renderStudioBreadcrumbs(crumbs) {
  return `<ol class="studio-breadcrumb-list" aria-label="현재 위치">${crumbs.map((crumb,index)=>`<li${index===crumbs.length-1?' aria-current="page"':''}>${crumb.href?`<a href="${escape(crumb.href)}" data-studio-route title="${escape(crumb.label)}">${escape(crumb.label)}</a>`:`<span title="${escape(crumb.label)}">${escape(crumb.label)}</span>`}</li>`).join('')}</ol>`;
}

/** Hash navigation completes after microtasks. Focus belongs to the mounted destination. */
export function createStudioRouteFocus({getHash, find}) {
  let pending = null;
  return {
    request(hash, selector) { pending = {hash, selector}; },
    routeChanged(hash) { if (pending && pending.hash !== hash) pending = null; },
    flush() {
      if (!pending || pending.hash !== getHash()) return false;
      const target = find(pending.selector);
      if (!target || target.disabled || target.closest?.('[inert]') || !target.getClientRects().length) return false;
      pending = null;
      target.focus({preventScroll:true});
      return true;
    }
  };
}

/** A navigation close must not restore the opener from a different page. */
export function createStudioDialogNavigation({getDialog, cleanup, restore}) {
  let navigationClose = false;
  return {
    beforeRouteChange() {
      const dialog = getDialog();
      if (!dialog?.open) return false;
      navigationClose = true;
      cleanup();
      dialog.close();
      return true;
    },
    closed() {
      const skipped = navigationClose;
      navigationClose = false;
      if (getDialog()?.open) return;
      cleanup();
      if (!skipped) restore();
    }
  };
}
