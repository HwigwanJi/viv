import {PAPER_DECISION_ENTRY,PAPER_HOME_ENTRY,PAPER_PRACTICE_ENTRY,paperBrokerReturnHash} from '../system/paper-decision-links.mjs';
import {CALENDAR_GUIDE_URL,CALENDAR_STATUS_TITLE} from './workspace-calendar.mjs';

const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));

const COLLECTION_TASKS = [['overview','마인드 목록'],['records','전체 기록'],['simulations','전체 시뮬레이션']];
const MIND_TASKS = [['operations','운용'],['principles','전략'],['records','기록'],['knowledge','자료'],['simulations','실험실']];
const JUMP_TASK_KEYWORDS = {calendar:CALENDAR_STATUS_TITLE+' 달력 모의검증 일정 날짜 손익 스케줄 진행 중인 검증 검증 예정 시작 대기 날짜별 손익 오늘 벌었는지 실현 손익 미확인 실현 손익 기록 없음',records:'체결 거래 주문 원장',principles:'규칙 정책 노드',simulations:'백테스트 실험 결과 시뮬레이션',capabilities:'VIV 도움말 사용법 사용 안내 가이드 문서',connections:'AI 연결 MCP Codex Claude Code'};
const BROKER_JUMP_KEYWORDS = '계좌 연결 잔고 자금 거래소 업비트 토스증권 API키';

const TASK_GROUPS = Object.freeze({
  library: [['자료', ['documents', 'quant']], ['운용 지식', ['experiences', 'review', 'memory']], ['가져오기', ['forms']]]
});

export function studioJumpItems(route,navigation,{routeHash,primary,library,settings}) {
  const live=route.params.get('executionMode')==='live';
  const keywords=live?JUMP_TASK_KEYWORDS:{...JUMP_TASK_KEYWORDS,records:JUMP_TASK_KEYWORDS.records+' 모의 판단'};
  const minds=[...(navigation.minds??[])].sort((a,b)=>a.name.localeCompare(b.name,'ko'));
  const nameCounts=new Map();
  for(const mind of minds)nameCounts.set(mind.name,(nameCounts.get(mind.name)??0)+1);
  const mindSource={...route,params:new URLSearchParams([...route.params].filter(([key])=>route.page==='minds'?key==='returnTo':key!=='returnTo'))};
  const mindHref=(profileId,view)=>routeHash(mindSource,'minds',{profileId,view,executionMode:view==='simulations'||!live?'paper':'live'});
  const entries=primary.map(([page,,label])=>({label,group:'주요 화면',keywords:keywords[page]||'',
    taskSuffix:page==='calendar'?'모의검증 일정과 모의 실현 손익':'',href:routeHash(route,page,page==='minds'?{profileId:'all',view:'overview'}:{})}));
  entries.push({label:'첫 모의 판단',group:'모의 실습',keywords:'실습 연습 모의투자 현재 확정 시세 BTC-USDT 4시간봉',
    taskSuffix:live?'모의 화면으로 이동':'',href:PAPER_DECISION_ENTRY});
  entries.push({label:'첫 백테스트 실습',group:'모의 실습',keywords:'과거 데이터 보관 시세 BTC 기준 퀀트 연습',
    taskSuffix:live?'모의 화면으로 이동':'',searchOnly:true,href:PAPER_PRACTICE_ENTRY});
  for(const [view,label]of COLLECTION_TASKS.slice(1))entries.push({label:view==='simulations'&&live?'전체 모의 시뮬레이션':label,group:'전체 마인드',keywords:keywords[view]||'',href:mindHref('all',view)});
  for(const mind of minds){
    const selected=mind.id===navigation.selectedMindId;
    const context=selected?mind.name+(navigation.scopeStatus==='보관됨'?' · 보관됨':''):'';
    const identity=nameCounts.get(mind.name)>1?[mind.createdLabel&&'생성 '+mind.createdLabel,mind.id.slice(-8)].filter(Boolean).join(' · '):'';
    for(const [view,label]of MIND_TASKS){
      if(view==='knowledge'&&!selected)continue;
      const task=view==='simulations'&&live?'모의 '+label:label;
      entries.push({label:mind.name+' / '+task,taskLabel:selected?task:mind.name,taskSuffix:selected?'':task,identity,
        context,group:selected?'현재 마인드':'마인드',keywords:keywords[view]||'',
        searchOnly:!selected&&['principles','simulations'].includes(view),href:mindHref(mind.id,view)});
    }
  }
  for(const [page,items]of [['library',library],['settings',settings]])for(const [view,label]of items){
    if(page==='settings'&&view==='accounts'){
      if(route.params.get('executionMode')!=='live')entries.push({label:'모의 '+label,group:'설정',href:routeHash(route,page,{view,cursor:null})});
      const current=route.page==='trade'?paperBrokerReturnHash('#trade?'+route.params):PAPER_HOME_ENTRY;
      const returnTo=current===PAPER_HOME_ENTRY?paperBrokerReturnHash(route.params.get('returnTo')):current;
      entries.push({label:'실계좌 API 키 등록',group:'설정',keywords:BROKER_JUMP_KEYWORDS,
        href:routeHash(route,page,{view,cursor:null,executionMode:'live',returnTo:returnTo===PAPER_HOME_ENTRY?null:returnTo})});
    }else entries.push({label,group:page==='library'?'라이브러리':'설정',keywords:JUMP_TASK_KEYWORDS[view]||'',href:routeHash(route,page,{view,cursor:null})});
  }
  entries.push({
    label:'앱이 열리지 않을 때',group:'복구 안내',
    keywords:'VIV 도움말 복구 시작 오류 실행 오류 시작 실패 앱 안 열림 안 열려요 무한 부팅 무한 로딩 접속 안됨 연결 문제 '
      +'확인할 앱 파일 설치 화면 다시 확인 설치 화면의 연결 확인을 불러오지 못했습니다. VIV를 시작하지 못했습니다. '
      +'HTML 응답 · 원래 PC 주소와 비교 응답 형식 오류 · JavaScript 필요 파일 응답 비교 '
      +'이 주소에서 다른 웹페이지가 응답했습니다. VIV 서버 상태 응답을 확인할 수 없습니다. 서버 상태 응답 비교 '
      +'VIV 앱 화면 응답 시간이 초과됐습니다. VIV 서버 상태 확인 시간이 초과됐습니다. 잠시 뒤 VIV 다시 열기를 누르세요. '
      +'PC에서 확인한 VIV 설치 주소와 비교하세요. 네트워크 로그인이 필요하면 브라우저에서 연결한 뒤 연결 다시 확인을 누르세요. '
      +'설치한 컴퓨터에서 VIV PC 주소를 열어 확인한 뒤 연결 다시 확인을 누르세요. '
      +'PC에서 확인한 VIV 설치 주소와 비교한 뒤 다시 열어 보세요. 설치한 컴퓨터에서 VIV PC 주소를 확인한 뒤 다시 열어 보세요.',
    href:'https://github.com/HwigwanJi/viv/blob/main/docs/agents/operations/self-host.md#시작-오류가-반복될-때',
    taskSuffix:'새 탭',searchOnly:true,external:true
  });
  entries.push({label:'캘린더 사용법',group:'사용 안내',keywords:'캘린더 도움말',href:CALENDAR_GUIDE_URL,
    taskSuffix:'새 탭',searchOnly:true,external:true});
  return entries;
}

export function studioJumpMatches(text,query){
  const target=text.normalize('NFKC').toLocaleLowerCase();
  const compact=target.replace(/\s+/g,'');
  return query.normalize('NFKC').toLocaleLowerCase().trim().split(/\s+/).every(term=>
    target.includes(term)||/\p{Script=Hangul}/u.test(term)&&compact.includes(term));
}

export function studioJumpResearchItems(route,query,{page,failed},routeHash){
  const source={page:route.page,params:new URLSearchParams({executionMode:route.params.get('executionMode')||'paper'})};
  const href=changes=>routeHash(source,'library',{view:'documents',...changes});
  const currentId=route.page==='library'&&route.params.get('view')==='documents'?route.params.get('knowledgeId'):null;
  const group='저장한 투자 자료';
  const entries=(page?.items??[]).map(item=>({
    label:item.title,group,identity:[item.publisher,'v'+item.version].filter(Boolean).join(' · '),
    research:'reader',href:item.id===currentId?routeHash(route,'library'):href({knowledgeId:item.id})
  }));
  if(failed||page?.hasMore)entries.push({
    label:failed?'투자 자료에서 다시 검색':'투자 자료에서 결과 더 보기',group,
    identity:failed?'빠른 검색 결과를 불러오지 못했습니다.':'',
    research:'library',href:href({search:query,versions:'all'})
  });
  return entries;
}

export function renderStudioJump(entries,{modeLabel='',loading=false,error=''}={}) {
  const groups=new Map();
  for(const entry of entries){if(!groups.has(entry.group))groups.set(entry.group,[]);groups.get(entry.group).push(entry);}
  const ordered=[...groups].sort(([a],[b])=>(a==='현재 마인드'?-1:b==='현재 마인드'?1:0));
  let optionIndex=0;
  return '<div class="studio-jump"><div class="studio-jump-search"><label class="field">화면 찾기<input type="search" data-studio-jump-query role="combobox" aria-autocomplete="list" aria-expanded="true" maxlength="200" placeholder="마인드, 화면, 자료, 도움말…" autocomplete="off" aria-controls="studio-jump-results" aria-describedby="studio-jump-count studio-jump-help"></label>'+(modeLabel?'<span class="pill">'+escape(modeLabel)+' 화면</span>':'')+'</div><p id="studio-jump-count" class="tiny muted" data-studio-jump-count role="status" aria-live="polite">'+entries.length+'개 화면</p><div class="studio-jump-problem" data-studio-jump-problem'+(error&&!loading?'':' hidden')+'><p class="error-text" data-studio-jump-error role="alert">'+escape(error)+'</p><button type="button" class="button small" data-studio-jump-retry>다시 조회</button></div><p class="tiny muted" data-studio-jump-loading role="status"'+(loading?'':' hidden')+'>마인드 목록을 불러오는 중…</p><div id="studio-jump-results" class="studio-jump-results" role="listbox" aria-label="검색 결과">'+ordered.map(([group,items],index)=>'<section class="studio-jump-group" role="group" data-studio-jump-group aria-labelledby="studio-jump-group-'+index+'"><h3 id="studio-jump-group-'+index+'">'+escape(group)+(items[0].context?'<span class="studio-jump-context">'+escape(items[0].context)+'</span>':'')+'</h3>'+items.map(item=>'<a id="studio-jump-item-'+optionIndex+++'" role="option" aria-selected="false" tabindex="-1" data-studio-jump-item'+(item.external?' target="_blank" rel="noopener noreferrer"':' data-studio-route')+(item.research?' data-studio-jump-research="'+item.research+'"':'')+(item.searchOnly?' data-studio-jump-search-only hidden':'')+' data-studio-jump-search="'+escape([item.label,group,item.keywords,item.identity].filter(Boolean).join(' '))+'" href="'+escape(item.href)+'" title="'+escape(item.label)+'"><span>'+escape(item.taskLabel||item.label)+(item.identity?'<small class="studio-jump-context">'+escape(item.identity)+'</small>':'')+'</span>'+(item.taskSuffix?'<span class="studio-jump-task">'+escape(item.taskSuffix)+'</span>':'')+'<span class="studio-jump-arrow" aria-hidden="true">→</span></a>').join('')+'</section>').join('')+'</div><div class="studio-jump-empty" data-studio-jump-empty hidden><p>검색 결과가 없습니다.</p><button type="button" class="button small" data-studio-jump-clear>검색어 지우기</button></div><p id="studio-jump-help" class="sr-only">위아래 방향키로 화면을 고르고 Enter로 엽니다. Esc로 닫습니다.</p><div class="studio-jump-keys" aria-hidden="true"><span><kbd>↑</kbd><kbd>↓</kbd> 이동</span><span><kbd>Enter</kbd> 열기</span><span><kbd>Esc</kbd> 닫기</span></div></div>';
}

export function selectStudioJump(root,item){
  const items=[...root.querySelectorAll('[data-studio-jump-item]')];
  const selected=items.includes(item)&&!item.hidden?item:items.find(candidate=>!candidate.hidden);
  for(const candidate of items)candidate.setAttribute('aria-selected',String(candidate===selected));
  const query=root.querySelector('[data-studio-jump-query]');
  if(selected)query.setAttribute('aria-activedescendant',selected.id);else query.removeAttribute('aria-activedescendant');
  return selected;
}

export function filterStudioJump(root,query,{researchLoading=false}={}){
  let count=0;
  const searching=Boolean(query.trim());
  for(const item of root.querySelectorAll('[data-studio-jump-item]')){
    item.hidden=item.hasAttribute('data-studio-jump-research')?!searching:
      (!searching&&item.hasAttribute('data-studio-jump-search-only'))||!studioJumpMatches(item.dataset.studioJumpSearch,query);
    if(!item.hidden)count++;
  }
  for(const group of root.querySelectorAll('[data-studio-jump-group]'))group.hidden=![...group.querySelectorAll('[data-studio-jump-item]')].some(item=>!item.hidden);
  const empty=root.querySelector('[data-studio-jump-empty]'),message=empty.querySelector?.('p');empty.hidden=count>0||researchLoading;
  if(message)message.textContent=root.querySelector('[data-studio-jump-loading]')?.hidden===false?'목록이 도착하면 검색 결과에 반영합니다.':'검색 결과가 없습니다.';
  const status=root.querySelector('[data-studio-jump-count]'),label=researchLoading?'저장한 투자 자료 검색 중…':count+(searching?'개 검색 결과':'개 화면');if(status.textContent!==label)status.textContent=label;
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
  const items = MIND_TASKS.map(([id,label])=>({...navigation.items.find(item=>item.id===id),id,label,active:id===current||id==='operations'&&current==='overview'}));
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
  if(route.page==='settings'&&route.params.get('view')==='accounts'&&route.params.get('executionMode')==='live'&&
     paperBrokerReturnHash(saved)!==PAPER_HOME_ENTRY)return null;
  if (!saved || !/^#(?:home|trade|minds|library|settings)(?:\?|$)/.test(saved)) return null;
  const target = parseRoute(saved);
  if (target.page === route.page) return null;
  const labels = {home:'홈으로 돌아가기',trade:'트레이딩으로 돌아가기',minds:'마인드로 돌아가기',library:'라이브러리로 돌아가기',settings:'설정으로 돌아가기'};
  const connections = route.page==='settings' && route.params.get('view')==='connections';
  if(connections){
    labels.home='투자 홈으로 돌아가기';
    labels.trade='같은 트레이딩 화면으로 돌아가기';
    if(target.params.has('knowledgeId'))labels.library='같은 자료로 돌아가기';
  }
  const executionMode=(connections&&target.params.get('executionMode'))||route.params.get('executionMode')||'paper';
  return {label:labels[target.page], href:routeHash(target,target.page,{executionMode})};
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
