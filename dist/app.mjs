import {mountShell,closeSidebar} from './ui/shell.mjs';
import {createRouteMotion,interfaceMotionKey,jumpNavigationIndex} from './ui/interface-motion.mjs';
import {createStudioController,parseStudioRoute,studioRouteHash,studioPrimaryRouteHash,isPlainNavigationClick,WORKSPACE_NAV,LIBRARY_VIEWS,SETTINGS_VIEWS} from './ui/studio-controller.mjs';
import {renderExecutionModeToggle,executionModeOf,restoreCompanionDialogFocus} from './ui/mind-companion.mjs';
import {investmentBrandMarkup} from './ui/brand.mjs';
import {renderActionMenu} from './ui/action-menu.mjs';
import {createAppInstall} from './ui/app-install.mjs';
import {createAppNotifications} from './ui/app-notifications.mjs';
import {createEntityMenu} from './ui/entity-menu.mjs';
import {createDialogFocusController} from './ui/dialog-focus.mjs';
import {layoutDialogForm} from './ui/dialog-layout.mjs';
import {createFormDrafts} from './ui/form-draft.mjs';
import {pixelToken} from './ui/design-tokens.mjs';
import {installHelpTooltips} from './ui/help-tooltip.mjs';
import {installActionMenus} from './ui/action-menu.mjs';
import {renderStudioContext,renderMindWorkspace,studioPrimaryDestination,studioBreadcrumbs,renderStudioBreadcrumbs,createStudioRouteFocus,createStudioDialogNavigation,studioJumpItems,studioJumpResearchItems,renderStudioJump,filterStudioJump,selectStudioJump} from './ui/studio-shell.mjs';

installHelpTooltips(document);
installActionMenus(document,{window});

const $=selector=>document.querySelector(selector);
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const NAV=WORKSPACE_NAV;
const PATHS={calendar:'<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4m10-4v4M3 10h18M8 15h2m4 0h2"/>',home:'<path d="m3 10 9-7 9 7v10H3ZM9 20v-7h6v7"/>',chart:'<path d="M4 3v17h17M7 12v5m0-10v2m5-4v9m0-4v7m5-14v6m0-3v7"/>',layers:'<path d="m12 3 9 5-9 5-9-5 9-5ZM3 12l9 5 9-5M3 16l9 5 9-5"/>',book:'<path d="M4 4h7l1 2 1-2h7v16h-7l-1 1-1-1H4ZM12 6v15"/>',clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',settings:'<path d="m9 3 1 3h4l1-3 3 2-1 3 2 3 3 1v3l-3 1-2 3 1 3-3 1-1-3h-4l-1 3-3-2 1-3-2-3-3-1v-3l3-1 2-3-1-3Z"/><circle cx="12" cy="13" r="3"/>',menu:'<path d="M4 6h16M4 12h16M4 18h16"/>',close:'<path d="m6 6 12 12M6 18 18 6"/>',panel:'<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18"/>'};
const icon=name=>`<svg class="app-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${PATHS[name]||PATHS.layers}</svg>`;
let toastTimer,renderGeneration=0,dialogLifecycleToken=0,strategyEditorCleanup=null;
const getDialogToken=()=>dialogLifecycleToken+':'+location.hash;
const primaryLocations=new Map();
const routeMotion=createRouteMotion();
matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change',()=>routeMotion.stop());
const entityMenu=createEntityMenu({onError:toast,navigateHref:navigateToHeading});
const dialogFocus=createDialogFocusController({getDialog:()=>$('#detail-dialog'),getContainer:()=>$('#app'),getActiveElement:()=>document.activeElement,restoreFallback:restoreCompanionDialogFocus});
const formDrafts=createFormDrafts(document,{getScope:()=>{const route=parseStudioRoute(location.hash);return [route.page,route.params.get('profileId')||'all',executionModeOf(route)].join('|');}});
const routeFocus=createStudioRouteFocus({getHash:()=>location.hash,find:selector=>document.querySelector(selector)});
function navigateToHeading(href,selector='.studio-content h1[tabindex="-1"]'){routeFocus.request(href,selector);if(location.hash===href)routeFocus.flush();else location.hash=href;}
const dialogNavigation=createStudioDialogNavigation({getDialog:()=>$('#detail-dialog'),cleanup:cleanupStrategyEditor,restore:restoreDialogFocus});
const studio=createStudioController({render,open:openDialog,openStrategyEditor,close:closeDialog,getDialogToken,toast,navigate,download,getRoute:()=>parseStudioRoute(location.hash)});
const appInstall=createAppInstall({window,navigator,open:openDialog,onError:toast,onInstalled:()=>toast('VIV 앱을 설치했습니다.')});
const appNotifications=createAppNotifications({window,navigator,open:openDialog,getDialogToken,onError:toast,openDocument:id=>studio.openDocument(id)});

function toast(message){const node=$('#toast');node.textContent=message;node.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>node.classList.remove('show'),5000);}
function download(name,value,type='application/json'){const blob=new Blob([typeof value==='string'?value:JSON.stringify(value,null,2)],{type}),url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=name;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function cleanupStrategyEditor(){strategyEditorCleanup?.();strategyEditorCleanup=null;$('#detail-dialog').classList.remove('strategy-dialog');}
function setDialogPresentation(dialog,presentation){const docked=presentation==='reader'&&innerWidth>=pixelToken('--ui-reader-breakpoint'),wasDocked=dialog.dataset.readerDocked==='true';if(dialog.open&&wasDocked!==docked)dialog.close();dialog.dataset.presentation=presentation;dialog.dataset.readerDocked=String(docked);document.documentElement.dataset.readerOpen=String(docked);if(!dialog.open){if(docked)dialog.show();else dialog.showModal();}}
function openDialog(title,body,actions='',{presentation='modal',context=''}={}){dialogLifecycleToken++;cleanupStrategyEditor();entityMenu.close();const dialog=$('#detail-dialog');formDrafts.capture();dialogFocus.beforeOpen({replaceOrigin:presentation==='reader'&&!dialog.contains(document.activeElement)});dialog.innerHTML=`<div class="dialog-head"><div><h2 id="dialog-title">${esc(title)}</h2>${context?`<p class="dialog-context">${esc(context)}</p>`:''}</div><button class="shell-control" data-studio-action="close-dialog" aria-label="닫기">${icon('close')}</button></div><div class="dialog-body">${body}</div>${actions?`<div class="dialog-actions">${actions}</div>`:''}`;layoutDialogForm(dialog);formDrafts.prepare(dialog);setDialogPresentation(dialog,presentation);dialogFocus.focusCurrent();if(presentation==='reader')routeFocus.flush();entityMenu.refresh();}
async function openStrategyEditor(options){openDialog(options.readOnly?'판단 경로':'전략 편집','<div data-strategy-editor-root><p class="loading">편집기 불러오는 중…</p></div>');const token=getDialogToken();$('#detail-dialog').classList.add('strategy-dialog');try{const {mountStrategyGraphEditor}=await import('./vendor/strategy-graph-editor.mjs');if(token!==getDialogToken()||!$('#detail-dialog').open)return;strategyEditorCleanup=mountStrategyGraphEditor($('#detail-dialog [data-strategy-editor-root]'),{...options,onClose:closeDialog});return strategyEditorCleanup;}catch(problem){if(token===getDialogToken())openDialog('편집기 연결 오류','<p>'+esc(problem.message)+'</p>');}}
function restoreDialogFocus(){dialogFocus.restore();}
function closeDialog(){dialogLifecycleToken++;formDrafts.capture();cleanupStrategyEditor();const dialog=$('#detail-dialog');if(dialog.open){appNotifications.dismiss();dialog.close();document.documentElement.dataset.readerOpen='false';restoreDialogFocus();}}
function navigate(page,params={}){
  dialogLifecycleToken++;dialogNavigation.beforeRouteChange();closeSidebar();
  const current=parseStudioRoute(location.hash),hash=studioRouteHash(current,page,params),next=parseStudioRoute(hash);
  if(current.page==='minds'&&next.page==='minds'&&(current.params.get('profileId')||'all')!==(next.params.get('profileId')||'all'))routeFocus.request(hash,'.studio-mind-workspace h1[tabindex="-1"], .studio-content h1[tabindex="-1"]');
  location.hash=hash;
}
const primaryHref=(route,page)=>studioPrimaryDestination(route,page,primaryLocations.get(page),{routeHash:studioRouteHash,primaryRouteHash:studioPrimaryRouteHash});
function navigatePrimary(page){dialogLifecycleToken++;dialogNavigation.beforeRouteChange();closeSidebar();location.hash=primaryHref(parseStudioRoute(location.hash),page);}

let hudRenderPending=false;
document.addEventListener('mind-hud-settled',()=>{if(hudRenderPending&&!document.querySelector('[data-hud-interacting]')){hudRenderPending=false;render();}});
function render(){
  if(document.querySelector('.viv-intro')&&studio.state().loading)return;
  if(document.querySelector('[data-hud-interacting]')&&document.querySelector('.vibe-shell')?.dataset.chromeKey?.split('|')[0]===location.hash){hudRenderPending=true;return;}
  hudRenderPending=false;
  const sameRoute=document.querySelector('.vibe-shell')?.dataset.chromeKey?.split('|')[0]===location.hash;
  const active=document.activeElement;
  const retainedFocus=sameRoute&&['#simulation-result-heading','.studio-content h1[tabindex="-1"]','[data-capability-guide]','#first-paper-decision'].find(selector=>active?.matches(selector));
  const retainedCalendar=sameRoute&&active?.dataset?.calDate?'[data-cal-date="'+CSS.escape(active.dataset.calDate)+'"]':null;
  const activeHud=active?.closest?.('[data-mind-hud]'),hudFocus=sameRoute&&activeHud?{key:activeHud.dataset.hudKey,selector:active.matches('[data-hud-viewport]')?'[data-hud-viewport]':['hudGo','hudSeries','hudPeriod'].find(key=>active.dataset[key]!==undefined)}:null;
  if(hudFocus&&hudFocus.selector!=='[data-hud-viewport]'){const key=hudFocus.selector;hudFocus.selector=key?'[data-'+key.replace(/[A-Z]/g,c=>'-'+c.toLowerCase())+'="'+CSS.escape(document.activeElement.dataset[key])+'"]':null;}
  const token=++renderGeneration,route=parseStudioRoute(location.hash),navigation=studio.navigation(route),railOnly=['home','minds'].includes(route.page);
  primaryLocations.set(route.page,'#'+route.page+(route.params.size?'?'+route.params:''));
  dialogFocus.beforeRender({sameRoute:document.querySelector('.vibe-shell')?.dataset.chromeKey?.split('|')[0]===location.hash});
  entityMenu.unmount({preserveMenu:true});studio.unmount();
  const mainNavigation=NAV.filter(([id])=>id!=='settings').map(([id,image,label])=>`<a href="${esc(primaryHref(route,id))}" data-nav="${id}"${route.page===id?' aria-current="page"':''}>${icon(image)}<span>${label}</span></a>`).join('');
  const markup=`<div class="shell studio-shell vibe-shell studio-page-${route.page}${railOnly?' studio-mind-shell':''}${route.page==='home'?' studio-home-shell':''}"><main class="main"><header class="topbar vibe-topbar">${investmentBrandMarkup({href:primaryHref(route,'home')})}<nav class="vibe-navigation" aria-label="주요 메뉴">${mainNavigation}</nav><div class="top-actions">${studio.state().status?.runners?.disabled?'<span class="tiny muted" role="status">자동 주문 중지</span>':''}<button class="studio-jump-trigger" data-studio-jump-open aria-label="화면 찾기" title="화면 찾기 (Ctrl+K)"><svg class="app-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/></svg></button>${appNotifications.button()}${renderExecutionModeToggle(executionModeOf(route))}<span class="vibe-tools">${renderActionMenu({id:'workspace-tools',label:'작업 공간 메뉴',compact:true,content:`<a href="${esc(primaryHref(route,'settings'))}" data-nav="settings">설정</a><button class="shell-control" data-shell="theme" aria-label="테마 변경"></button>${route.page==='settings'?appInstall.button():''}`})}</span></div></header>${['library','settings'].includes(route.page)?`<section class="vibe-context" aria-label="${esc(navigation.title)} 메뉴">${renderStudioContext(navigation,route,{parseRoute:parseStudioRoute,routeHash:studioRouteHash})}</section>`:''}<div class="content studio-content ${route.page==='trade'?'studio-trading-content':route.page==='home'?'studio-home-content':''} ${['settings'].includes(route.page)||route.page==='minds'&&route.params.get('view')==='principles'?'studio-reading-content':''}">${renderMindWorkspace(navigation,route,{parseRoute:parseStudioRoute,routeHash:studioRouteHash})}${studio.render(route)}</div><nav class="vibe-mobile-dock" aria-label="모바일 주요 메뉴">${mainNavigation}</nav></main></div>`;

  const chromeKey=location.hash+'|'+Boolean(studio.state().status?.runners?.disabled),shell=$('.vibe-shell');
  if(shell?.dataset.chromeKey===chromeKey){
    const next=document.createElement('template');next.innerHTML=markup;
    $('.studio-content').replaceWith(next.content.querySelector('.studio-content'));
    const currentNotice=$('.app-notification-button'),nextNotice=next.content.querySelector('.app-notification-button');
    if(currentNotice&&nextNotice&&currentNotice.outerHTML!==nextNotice.outerHTML)currentNotice.replaceWith(nextNotice);
  }else $('#app').innerHTML=markup;
  $('.vibe-shell').dataset.chromeKey=chromeKey;
  mountShell({compactDefault:route.page==='trade'});
  refreshStudioJump();
  queueMicrotask(()=>{if(token===renderGeneration){studio.mount($('#app'));entityMenu.mount($('#app'));if(hudFocus?.selector)document.querySelector('[data-hud-key="'+CSS.escape(hudFocus.key)+'"] '+hudFocus.selector)?.focus({preventScroll:true});if((retainedCalendar||retainedFocus)&&document.activeElement===document.body)document.querySelector(retainedCalendar||retainedFocus)?.focus({preventScroll:true});routeFocus.flush();dialogFocus.afterRender();appNotifications.mount();routeMotion.enter($('.studio-content'),interfaceMotionKey(route));}});
}

let jumpEntriesKey='',jumpRetrying=false,jumpResearch=null;
function cancelJumpResearch(){
  if(!jumpResearch)return;
  clearTimeout(jumpResearch.timer);
  jumpResearch.controller.abort();
  jumpResearch=null;
}
function searchJumpResearch(query,{composing=false}={}){
  const term=query.value.normalize('NFC').trim();
  if(!composing&&jumpResearch?.term===term)return;
  cancelJumpResearch();
  if(term&&!composing){
    const state={term,controller:new AbortController(),loading:true};
    jumpResearch=state;
    state.timer=setTimeout(async()=>{
      state.timer=setTimeout(()=>state.controller.abort(),4000);
      try {
        const params=new URLSearchParams({search:term,versions:'all',pageSize:'6',order:'relevance'});
        state.page=(await studio.request('/api/workspace/market-knowledge?'+params,undefined,{signal:state.controller.signal})).page;
      } catch {
        state.failed=true;
      } finally {
        clearTimeout(state.timer);
        if(jumpResearch===state&&query.isConnected&&query.closest('dialog')?.open){
          state.loading=false;
          refreshStudioJump();
        }
      }
    },220);
  }
  refreshStudioJump();
}
function studioJumpEntries(route){
  const entries=studioJumpItems(route,studio.navigation(route),{routeHash:studioRouteHash,primary:WORKSPACE_NAV,library:LIBRARY_VIEWS,settings:SETTINGS_VIEWS});
  return jumpResearch?[...studioJumpResearchItems(route,jumpResearch.term,jumpResearch,studioRouteHash),...entries]:entries;
}
function refreshStudioJump(){
  const dialog=$('#detail-dialog'),query=dialog.querySelector('[data-studio-jump-query]');if(!dialog.open||!query)return;
  const state=studio.state(),loading=state.loading||jumpRetrying,error=state.workspace?'':state.error;dialog.querySelector('[data-studio-jump-loading]').hidden=!loading;dialog.querySelector('[data-studio-jump-problem]').hidden=!error||loading;dialog.querySelector('[data-studio-jump-error]').textContent=error;dialog.querySelector('[data-studio-jump-retry]').disabled=loading;
  const entries=studioJumpEntries(parseStudioRoute(location.hash)),key=JSON.stringify(entries),filterOptions={researchLoading:jumpResearch?.loading};if(key===jumpEntriesKey){filterStudioJump(dialog,query.value,filterOptions);return;}jumpEntriesKey=key;
  const active=dialog.querySelector('[data-studio-jump-item]:focus'),selected=dialog.querySelector('[data-studio-jump-item][aria-selected="true"]'),href=(selected||active)?.getAttribute('href'),results=dialog.querySelector('.studio-jump-results'),scroll=results.scrollTop,next=document.createElement('template');next.innerHTML=renderStudioJump(entries);results.replaceChildren(...next.content.querySelector('.studio-jump-results').childNodes);filterStudioJump(dialog,query.value,filterOptions);results.scrollTop=scroll;
  const replacement=[...results.querySelectorAll('[data-studio-jump-item]')].find(item=>!item.hidden&&item.getAttribute('href')===href),selection=selectStudioJump(dialog,replacement);if(active)query.focus({preventScroll:true});if(document.activeElement===query)selection?.scrollIntoView({block:'nearest'});
}
function openStudioJump(){if($('#detail-dialog').open||studio.state().formSaving)return;cancelJumpResearch();const route=parseStudioRoute(location.hash),entries=studioJumpEntries(route);jumpEntriesKey=JSON.stringify(entries);openDialog('빠른 이동',renderStudioJump(entries,{modeLabel:executionModeOf(route)==='live'?'실전':'모의',loading:studio.state().loading||jumpRetrying,error:studio.state().workspace?'':studio.state().error}));filterStudioJump($('#detail-dialog'),'');$('#detail-dialog [data-studio-jump-query]')?.focus();}
document.addEventListener('click',event=>{if(event.target.closest('[data-studio-jump-open]'))openStudioJump();});
document.addEventListener('click',async event=>{if(!event.target.closest('[data-studio-jump-retry]')||jumpRetrying)return;jumpRetrying=true;refreshStudioJump();$('#detail-dialog [data-studio-jump-query]')?.focus();try{await studio.refresh({coreOnly:true});}catch{/* refresh preserves the source error for the recovery UI. */}finally{jumpRetrying=false;refreshStudioJump();}});
document.addEventListener('input',event=>{if(event.target.matches('[data-studio-jump-query]'))searchJumpResearch(event.target,{composing:event.isComposing});});
document.addEventListener('compositionend',event=>{if(event.target.matches('[data-studio-jump-query]'))searchJumpResearch(event.target);});
document.addEventListener('click',event=>{if(!event.target.closest('[data-studio-jump-clear]'))return;const query=$('#detail-dialog [data-studio-jump-query]');if(!query)return;query.value='';searchJumpResearch(query);query.focus();});
document.addEventListener('keydown',event=>{
  if(event.isComposing)return;
  if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='k'){event.preventDefault();if($('#detail-dialog[open] [data-studio-jump-query]'))closeDialog();else openStudioJump();return;}
  if(!event.target.closest('.studio-jump'))return;
  if(event.key==='Escape'){event.preventDefault();closeDialog();return;}
  const query=event.target.matches('[data-studio-jump-query]'),items=[...document.querySelectorAll('#detail-dialog [data-studio-jump-item]:not([hidden])')];
  if(query&&event.key==='Enter'){event.preventDefault();items.find(item=>item.getAttribute('aria-selected')==='true')?.click();return;}
  if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)&&(!query||['ArrowDown','ArrowUp'].includes(event.key))){event.preventDefault();const current=items.find(item=>item.getAttribute('aria-selected')==='true'),next=items[jumpNavigationIndex(items.indexOf(current),event.key,items.length)];selectStudioJump($('#detail-dialog'),next);$('#detail-dialog [data-studio-jump-query]').focus({preventScroll:true});next?.scrollIntoView({block:'nearest'});}
});
document.addEventListener('click',event=>dialogFocus.rememberInteraction(event.target),true);
document.addEventListener('click',event=>{
  if(studio.state().formSaving){event.preventDefault();event.stopImmediatePropagation();return;}
  const settingsLink=event.target.closest('.studio-page-settings .studio-task-nav a[data-studio-route]');
  const routeLink=event.target.closest('a[data-studio-route]');
  const routeHref=routeLink?.getAttribute('href');
  if(routeLink?.dataset.calDate&&isPlainNavigationClick(event)){
    event.preventDefault();
    navigateToHeading(routeHref,'[data-cal-date="'+CSS.escape(routeLink.dataset.calDate)+'"]');
    return;
  }
  const paperGuide=routeHref?.startsWith('#trade?')&&parseStudioRoute(routeHref).params.has('firstDecision');
  const paperPractice=routeLink?.hasAttribute('data-first-decision-practice');
  const destination=settingsLink||event.target.closest('[data-studio-jump-item][data-studio-route], [data-broker-paper-home]')||(paperGuide||paperPractice?routeLink:null);
  if(destination&&isPlainNavigationClick(event)){
    event.preventDefault();
    dialogLifecycleToken++;
    dialogNavigation.beforeRouteChange();
    if(settingsLink)closeSidebar();
    const href=destination.getAttribute('href'),sameRoute=location.hash===href;
    cancelJumpResearch();
    if(destination.dataset.studioJumpResearch==='reader'){
      navigateToHeading(href,'[data-library-result-heading]');
      if(sameRoute)void studio.openResearch(parseStudioRoute(href).params.get('knowledgeId'),{showLoading:true}).catch(()=>{});
    }else if(paperPractice)navigateToHeading(href,'[data-simulation-form="create"] select[name="mindId"]');
    else navigateToHeading(href,paperGuide?'#first-paper-decision':undefined);
    return;
  }
  const nav=event.target.closest('[data-nav]');
  if(nav){if(!isPlainNavigationClick(event))return;event.preventDefault();navigatePrimary(nav.dataset.nav);return;}
  if(event.target.closest('[data-app-install]')){appInstall.install();return;}
  if(event.target.closest('[data-studio-route]'))closeSidebar();
  if(event.target.closest('[data-studio-action="close-dialog"]'))closeDialog();
});
$('#detail-dialog').addEventListener('close',()=>{formDrafts.capture();if(!$('#detail-dialog').open){cancelJumpResearch();$('#detail-dialog [data-broker-form]')?.reset();document.documentElement.dataset.readerOpen='false';}dialogNavigation.closed();});
addEventListener('resize',()=>{const dialog=$('#detail-dialog');if(dialog.open&&dialog.dataset.presentation==='reader')setDialogPresentation(dialog,'reader');});
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!event.defaultPrevented&&$('#detail-dialog').open&&$('#detail-dialog').dataset.readerDocked==='true'){event.preventDefault();closeDialog();}});
// Escape invalidates awaiting views before the browser queues its close event.
$('#detail-dialog').addEventListener('cancel',event=>{if(studio.state().formSaving){event.preventDefault();return;}dialogLifecycleToken++;appNotifications.dismiss();});
document.addEventListener('keydown',event=>{if(event.key==='/'&&!event.metaKey&&!event.ctrlKey&&!event.isComposing&&!event.target.closest('input,textarea,select,[contenteditable="true"]')&&!$('#detail-dialog').open){event.preventDefault();const hash=studioRouteHash(parseStudioRoute(location.hash),'trade');routeFocus.request(hash,'[data-terminal-search]');navigate('trade');queueMicrotask(()=>{studio.terminal.focusInstrumentSearch();routeFocus.flush();});}});
window.addEventListener('hashchange',()=>{dialogLifecycleToken++;dialogNavigation.beforeRouteChange();routeFocus.routeChanged(location.hash);render();studio.routeChanged(parseStudioRoute(location.hash));appNotifications.routeChanged();});
const initial=parseStudioRoute(location.hash);if(location.hash!=='#'+initial.page+(initial.params.size?'?'+initial.params:''))history.replaceState(null,'','#'+initial.page+(initial.params.size?'?'+initial.params:''));
studio.start();render();appNotifications.start();
