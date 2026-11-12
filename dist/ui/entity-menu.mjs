import {pixelToken} from './design-tokens.mjs';
import {companionActionTargets} from './mind-companion.mjs';
import {CONTEXT_ENTITY_SELECTOR,CONTEXT_NATIVE_SELECTOR,CONTEXT_CONTROL_SELECTOR} from './context-interactions.mjs';
import {createMenuTypeahead} from './action-menu.mjs';

/** Entity shortcuts reuse the rendered controls; their existing guards own every action. */
const nativeSelector='a[href],'+CONTEXT_NATIVE_SELECTOR;
const text=node=>node?.getAttribute?.('aria-label')||node?.textContent?.trim()||'';
const controlLabel=node=>node?.dataset?.notificationOpen?'내용 보기':node?.matches?.('.studio-template-card')?'이 양식으로 작성':node?.querySelector?.('.mind-notification-next')?.textContent?.replace(/→/g,'').trim()||text(node);
const controlKey=node=>node.href||JSON.stringify(Object.entries(node.dataset).sort(([a],[b])=>a.localeCompare(b)))+controlLabel(node);
const controls=(node,selector)=>[...node.querySelectorAll(selector)];
const entityControls=entity=>[...(entity.matches?.(CONTEXT_CONTROL_SELECTOR)?[entity]:[]),...controls(entity,CONTEXT_CONTROL_SELECTOR)].filter(node=>!node.matches('[data-entity-menu-more],[data-ui-menu-trigger],[data-help-trigger],[data-help-passive],[aria-pressed],[role="tab"],[data-hud-go]')&&!node.closest('[inert]')&&(!node.closest(CONTEXT_ENTITY_SELECTOR)||node.closest(CONTEXT_ENTITY_SELECTOR)===entity));

export function preserveNativeContext(target,selection=''){
  if(String(selection).trim())return true;
  const native=target?.closest?.(nativeSelector);
  return !!native&&!native.matches?.('[data-mind-companion-open],[data-mind-entity-open]');
}

export function entityMenuDescriptor(entity){
  if(!entity)return null;
  const name=entity.dataset.entityName||entity.querySelector('h2')?.textContent?.trim()||'';
  const shortLabel=value=>name&&value.startsWith(name+' ')?value.slice(name.length).trim()||value:value;
  let kind,id,nodes;
  if(entity.matches('[data-context-entity="notification"]')){
    kind='notification';id=entity.dataset.contextId;nodes=entityControls(entity);
  }else if(entity.matches('[data-context-entity="operation"]')){
    kind='operation';id=entity.dataset.contextId;nodes=entityControls(entity);
  }else if(entity.matches('[data-context-entity="activity"],[data-mind-activity-card],[data-activity-kind]')){
    kind='activity';id=entity.dataset.contextId;nodes=entityControls(entity);
  }else
  if(entity.matches('[data-mind-companion],[data-mind-entity]')){
    kind='mind';id=entity.dataset.profileId;
    nodes=controls(entity,'[data-mind-companion-open],[data-mind-entity-open],[data-companion-action="rename"],[data-companion-action="customize"],[data-companion-action="edit"],[data-companion-action="manage"],[data-companion-action="automation"],[data-companion-action="archive"]');
  }else{
    const instrument=entity.querySelector('[data-terminal-action="instrument"]'),library=entity.querySelector('[data-library-action="detail"]'),simulation=entity.querySelector('[data-simulation-action="open"],[data-simulation-action="row-detail"]'),record=entity.querySelector('[data-studio-action="decision"],[data-terminal-action="decision"],[data-studio-action="document-detail"],[data-studio-action="experience"],[data-studio-action="candidate"],[data-studio-action="mind-observation"]');
    if(instrument){kind='instrument';id=instrument.dataset.terminalId;nodes=controls(entity,'[data-terminal-action="instrument"],[data-terminal-action="watchlist"]');}
    else if(library){kind='library';id=library.dataset.libraryId;nodes=controls(entity,'[data-library-action="detail"]');}
    else if(simulation){kind='simulation';id=simulation.dataset.simulationAction==='row-detail'?simulation.dataset.simulationReportId:simulation.dataset.simulationId;nodes=controls(entity,'[data-simulation-action="open"],[data-simulation-action="row-detail"]');}
    else if(record){kind='record';id=record.dataset.studioId||record.dataset.terminalId;nodes=[record];}
    else {kind=entity.matches('tbody tr')?'row':'card';id=entity.dataset.contextId||null;nodes=entityControls(entity);}
  }
  if(!id&&!['row','card','activity'].includes(kind))return null;
  if(['library','simulation','record'].includes(kind))nodes=entityControls(entity);
  const unique=new Set(),items=nodes.filter(node=>{
    const key=controlKey(node);if(unique.has(key))return false;unique.add(key);return true;
  }).map(target=>({key:'control:'+controlKey(target),label:shortLabel(controlLabel(target)),target,disabled:!!target.disabled||target.getAttribute?.('aria-disabled')==='true',reason:target.disabled||target.getAttribute?.('aria-disabled')==='true'?target.getAttribute?.('title')||'현재 상태에서 실행할 수 없습니다.':''})).filter(item=>item.label);
  if(!items.length&&kind!=='row')return null;
  if(kind==='mind')items.splice(1,0,{key:'mind-records',label:name?'기록 보기':id+' 기록 보기',href:companionActionTargets(id,entity.dataset.executionMode).records});
  const label=({mind:'마인드',operation:'운용',instrument:'종목',record:'기록',library:'자료',simulation:'실험',notification:'알림',activity:'활동',row:'행',card:'항목'})[kind];
  if(id&&kind!=='notification')items.push({key:'copy-id',label:label+' ID 복사',copy:id});
  else if(kind!=='notification'){const content=text(entity);if(content)items.push({key:'copy-content',label:label+' 내용 복사',copy:content});}
  return items.length?{kind,id,name,label:label+' 메뉴',items}:null;
}

export function menuFocusIndex(key,index,count){
  if(!count)return -1;
  return key==='Home'?0:key==='End'?count-1:key==='ArrowDown'?(index+1+count)%count:key==='ArrowUp'?(index-1+count)%count:index;
}

export function clampMenuPosition({x,y,width,height,viewportWidth,viewportHeight,margin=0}){
  return {left:Math.max(margin,Math.min(x,viewportWidth-width-margin)),top:Math.max(margin,Math.min(y,viewportHeight-height-margin))};
}

export function dispatchEntityMenuItem(item,{copyText,navigateHref,onError}={}){
  if(!item||item.disabled)return false;
  if(item.href){navigateHref?.(item.href);return true;}
  if(item.copy){Promise.resolve().then(()=>copyText(item.copy)).catch(()=>onError?.('ID를 복사하지 못했습니다.'));return true;}
  if(!item.target?.isConnected||item.target.disabled||item.target.getAttribute?.('aria-disabled')==='true')return false;
  item.target.click();return true;
}

export function createEntityMenu({document:doc=globalThis.document,window:win=globalThis.window,onError,navigateHref=href=>{win.location.hash=href;}}={}){
  let root=null,menu=null,trigger=null,descriptor=null,started=false,observer=null,resume=null;const typeahead=createMenuTypeahead();
  const copyText=value=>win.navigator.clipboard.writeText(value);
  const activeItems=()=>[...menu?.querySelectorAll('[role="menuitem"]')||[]];
  function close({restoreFocus=false}={}){
    typeahead.reset();
    resume=null;
    try{menu?.hidePopover?.();}catch{}menu?.remove();menu=null;descriptor=null;
    if(trigger?.isConnected){trigger.setAttribute?.('aria-expanded','false');if(restoreFocus)trigger.focus?.({preventScroll:true});}
    trigger=null;
  }
  function show(entity,origin,point,focus=true){
    const next=entityMenuDescriptor(entity);if(!next)return false;close();descriptor=next;trigger=origin;
    menu=doc.createElement('div');menu.className='entity-context-menu';menu.setAttribute('role','menu');menu.setAttribute('aria-label',next.label);menu.setAttribute('popover','manual');menu.id='entity-context-menu';
    if(next.name){const title=doc.createElement('div');title.className='entity-context-title';title.textContent=next.name;menu.append(title);menu.setAttribute('aria-label',next.name+' · '+next.label);}
    for(const [index,item]of next.items.entries()){
      const node=doc.createElement('button');node.type='button';node.setAttribute('role','menuitem');node.tabIndex=-1;node.dataset.entityMenuItem=String(index);node.textContent=item.label;
      if(item.disabled){node.setAttribute('aria-disabled','true');node.title=item.reason;if(item.reason){const reason=doc.createElement('small');reason.className='entity-context-reason';reason.textContent=item.reason;node.append(reason);}}menu.append(node);
    }
    (entity.closest?.('dialog[open]')||doc.body).append(menu);try{menu.showPopover?.();}catch{}trigger?.setAttribute?.('aria-expanded','true');
    const margin=pixelToken('--ds-space-4',doc.documentElement),viewportWidth=doc.documentElement.clientWidth||win.innerWidth,viewportHeight=doc.documentElement.clientHeight||win.innerHeight;
    menu.style.maxWidth='min(var(--ui-menu-max-width),'+Math.max(0,viewportWidth-margin*2)+'px)';menu.style.maxHeight=Math.max(0,viewportHeight-margin*2)+'px';
    const rect=menu.getBoundingClientRect(),anchor=origin?.getBoundingClientRect?.(),position=clampMenuPosition({x:point?.x??anchor?.left??margin,y:point?.y??anchor?.bottom??margin,width:rect.width,height:rect.height,viewportWidth,viewportHeight,margin});
    menu.style.left=position.left+'px';menu.style.top=position.top+'px';if(focus)activeItems()[0]?.focus();return true;
  }
  const dialog=()=>doc.getElementById?.('detail-dialog');
  function entityFor(target){if(target?.closest?.('.react-flow'))return null;const entity=target?.closest?.(CONTEXT_ENTITY_SELECTOR);return entity&&(root?.contains(entity)||dialog()?.contains(entity))?entity:null;}
  function moreFor(entity){return entity?.querySelector('[data-entity-menu-more]');}
  function syncOpenMenu(){
    if(!menu||!trigger||resume)return;
    const entity=entityFor(trigger),next=entityMenuDescriptor(entity);
    if(!next||next.id!==descriptor.id||next.kind!==descriptor.kind){close({restoreFocus:true});return;}
    const same=(a,b)=>a.key===b.key&&a.label===b.label&&a.target===b.target&&a.disabled===b.disabled&&a.reason===b.reason&&a.href===b.href&&a.copy===b.copy;
    if(next.name===descriptor.name&&next.items.length===descriptor.items.length&&next.items.every((item,index)=>same(item,descriptor.items[index])))return;
    const index=activeItems().indexOf(doc.activeElement),selected=descriptor.items[index],rect=menu.getBoundingClientRect(),origin=trigger;
    const selectedIndex=selected?next.items.findIndex(item=>selected.target?item.target===selected.target:item.key===selected.key):-1;
    if(selected&&selectedIndex<0){close({restoreFocus:true});return;}
    show(entity,origin,{x:rect.left,y:rect.top},false);
    if(selected)activeItems()[selectedIndex]?.focus();
  }
  function activate(index){const item=descriptor?.items[index];if(!item||item.disabled)return;close({restoreFocus:true});dispatchEntityMenuItem(item,{copyText,navigateHref,onError});}
  function click(event){
    const item=event.target.closest?.('[data-entity-menu-item]');if(item&&menu?.contains(item)){event.preventDefault();event.stopPropagation();activate(Number(item.dataset.entityMenuItem));return;}
    const more=event.target.closest?.('[data-entity-menu-more]');if(more&&(root?.contains(more)||dialog()?.contains(more))){event.preventDefault();event.stopPropagation();if(trigger===more&&menu)close({restoreFocus:true});else show(entityFor(more),more);}
  }
  function context(event){
    if(event.defaultPrevented)return;
    if(preserveNativeContext(event.target,win.getSelection?.()?.toString()))return;
    const entity=entityFor(event.target);if(!entity)return;
    if(show(entity,moreFor(entity)||event.target.closest?.('button,[tabindex]')||entity,{x:event.clientX,y:event.clientY}))event.preventDefault();
  }
  function keydown(event){
    if(event.isComposing||event.keyCode===229)return;
    if(!menu){if(event.key==='ContextMenu'||event.key==='F10'&&event.shiftKey){if(preserveNativeContext(event.target,win.getSelection?.()?.toString()))return;const entity=entityFor(event.target);if(entity&&show(entity,moreFor(entity))){event.preventDefault();event.stopPropagation();}}return;}
    if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close({restoreFocus:true});return;}
    if(event.key==='Tab'){close({restoreFocus:true});return;}
    const nodes=activeItems(),index=nodes.indexOf(doc.activeElement);
    if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){typeahead.reset();event.preventDefault();event.stopPropagation();nodes[menuFocusIndex(event.key,index,nodes.length)]?.focus();}
    else if(event.key==='Enter'||event.key===' '){if(index>=0){event.preventDefault();event.stopPropagation();activate(index);}}
    else{const match=typeahead.find(event,descriptor.items.map(item=>item.label),index);if(match>=0){event.preventDefault();event.stopPropagation();nodes[match]?.focus();}}
  }
  function outside(event){if(menu&&!menu.contains(event.target)&&!trigger?.contains?.(event.target))close();}
  function scrolled(event){if(menu&&!menu.contains(event.target))close();}
  function refresh(){
    if(!root||!doc?.createElement)return;
    for(const entity of [...root.querySelectorAll(CONTEXT_ENTITY_SELECTOR),...dialog()?.querySelectorAll(CONTEXT_ENTITY_SELECTOR)||[]]){
      if(entity.closest?.('.react-flow')||entity.querySelector('[data-ui-menu-trigger]'))continue;
      const value=entityMenuDescriptor(entity);if(!value||moreFor(entity))continue;
      const button=doc.createElement('button');button.type='button';button.className='entity-menu-more';button.dataset.entityMenuMore=value.kind;button.setAttribute('aria-label',value.label);button.setAttribute('aria-haspopup','menu');button.setAttribute('aria-expanded','false');button.setAttribute('aria-controls','entity-context-menu');button.textContent='⋯';
      if(entity.matches('tbody tr'))(entity.lastElementChild?.querySelector('.studio-table-cell-value')||entity.lastElementChild)?.append(button);else if(entity.matches('button')){continue;}else (entity.querySelector('[data-mind-identity]')??entity).append(button);
    }
  }
  function mount(container){
    root=container;refresh();
    if(resume){const saved=resume;resume=null;const entity=[...root.querySelectorAll(CONTEXT_ENTITY_SELECTOR),...dialog()?.querySelectorAll(CONTEXT_ENTITY_SELECTOR)||[]].find(node=>{const value=entityMenuDescriptor(node);return value?.id===saved.id&&value.kind===saved.kind;});if(entity){show(entity,moreFor(entity)||entity,saved.point);const focused=activeItems().find(node=>descriptor.items[Number(node.dataset.entityMenuItem)]?.key===saved.focusKey);if(focused)focused.focus();else close({restoreFocus:true});}else close();}
    if(!observer&&win.MutationObserver){observer=new win.MutationObserver(records=>{if(resume)return;if(menu&&trigger&&!trigger.isConnected)close();if(records.some(record=>[...record.addedNodes].some(node=>node.nodeType===1&&!node.matches?.('[data-entity-menu-more],#entity-context-menu'))))refresh();if(menu&&records.some(record=>entityFor(trigger)?.contains(record.target)))syncOpenMenu();});observer.observe(doc.body,{childList:true,characterData:true,attributes:true,subtree:true});}
    if(!started){started=true;doc.addEventListener('click',click,true);doc.addEventListener('contextmenu',context);doc.addEventListener('keydown',keydown,true);doc.addEventListener('pointerdown',outside,true);doc.addEventListener('scroll',scrolled,true);win.addEventListener('resize',close);win.addEventListener('hashchange',close);}
  }
  function unmount({preserveMenu=false}={}){if(preserveMenu&&menu&&descriptor.id){const rect=menu.getBoundingClientRect();resume={id:descriptor.id,kind:descriptor.kind,point:{x:rect.left,y:rect.top??0},focusKey:descriptor.items[Number(doc.activeElement?.dataset?.entityMenuItem)]?.key};}else close();root=null;}
  function destroy(){unmount();observer?.disconnect();observer=null;if(started){doc.removeEventListener('click',click,true);doc.removeEventListener('contextmenu',context);doc.removeEventListener('keydown',keydown,true);doc.removeEventListener('pointerdown',outside,true);doc.removeEventListener('scroll',scrolled,true);win.removeEventListener('resize',close);win.removeEventListener('hashchange',close);}started=false;}
  return {mount,unmount,destroy,close,refresh};
}
