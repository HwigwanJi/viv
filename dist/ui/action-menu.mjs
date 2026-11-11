import {pixelToken} from './design-tokens.mjs';

const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let sequence=0;
const TYPEAHEAD_RESET_MS=1000;
export function createMenuTypeahead(){
  let query='',lastTyped=-Infinity;
  const normalize=value=>String(value??'').normalize('NFKC').trim().toLowerCase();
  return {
    reset(){query='';lastTyped=-Infinity;},
    find(event,labels,index,now=Date.now()){
      if(!labels.length||event.isComposing||event.keyCode===229||event.ctrlKey||event.metaKey||event.altKey||typeof event.key!=='string'||[...event.key].length!==1||event.key===' ')return -1;
      const key=normalize(event.key);if(!key)return -1;query=now-lastTyped>TYPEAHEAD_RESET_MS?key:query+key;lastTyped=now;
      const letters=[...query];if(letters.every(letter=>letter===letters[0]))query=key;
      const start=[...query].length>1?Math.max(0,index):(index+1+labels.length)%labels.length;
      for(let offset=0;offset<labels.length;offset++){const at=(start+offset)%labels.length;if(normalize(labels[at]).startsWith(query))return at;}
      return -1;
    },
  };
}
const attributeMarkup=attributes=>Object.entries(attributes||{}).filter(([name])=>/^(?:data-[a-z0-9-]+|aria-[a-z0-9-]+|title)$/.test(name)).map(([name,value])=>' '+name+'="'+escape(value)+'"').join('');

/** href/content accept application-authored navigation/markup and retain delegated action attributes. */
export function renderActionMenu({id,label='작업',items=[],content='',compact=false,searchLabel=''}={}){
  const key=id||'action-menu-'+(++sequence);let group;
  const body=content||items.map(item=>{const heading=item.group&&item.group!==group?'<div class="ui-action-menu-group" role="presentation">'+escape(item.group)+'</div>':'';group=item.group;const link=item.href&&!item.disabled,tag=link?'a':'button';return heading+'<'+tag+(link?' href="'+escape(item.href)+'"':' type="button"')+' role="menuitem" tabindex="-1"'+attributeMarkup(item.attributes)+(item.disabled?' disabled':'')+'>'+escape(item.label)+'</'+tag+'>';}).join('');
  const search=searchLabel?'<label class="field ui-action-menu-search">'+escape(searchLabel)+'<input type="search" data-ui-menu-search autocomplete="off" spellcheck="false"></label>':'';
  return '<span class="ui-action-menu"><button type="button" class="button small ui-action-menu-trigger'+(compact?' ui-action-menu-compact':'')+'" data-ui-menu-trigger aria-haspopup="'+(searchLabel?'dialog':'menu')+'" aria-expanded="false" aria-controls="'+escape(key)+'" aria-label="'+escape(label)+'" title="'+escape(label)+'">'+(compact?'':'<span>'+escape(label)+'</span>')+'<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/></svg></button><span id="'+escape(key)+'" class="ui-action-menu-panel" role="'+(searchLabel?'dialog':'menu')+'" aria-label="'+escape(label)+'" data-ui-menu-panel popover="manual" hidden>'+search+(searchLabel?'<span role="menu" aria-label="'+escape(label)+'">'+body+'</span><span class="tiny muted" data-ui-menu-results role="status"></span>':body)+'</span></span>';
}

export function actionMenuPosition(anchor,menu,viewport,{gap=0,inset=0}={}){
  const width=Math.max(0,viewport.width-inset*2),height=Math.max(0,viewport.height-inset*2),menuWidth=Math.min(menu.width,width),menuHeight=Math.min(menu.height,height);
  const left=Math.max(inset,Math.min(anchor.right-menuWidth,viewport.width-menuWidth-inset));
  const below=anchor.bottom+gap,above=anchor.top-gap-menuHeight;
  const top=below+menuHeight<=viewport.height-inset?below:above>=inset?above:inset;
  return {left,top,maxHeight:height,maxWidth:width};
}

const installed=new WeakMap();
export function installActionMenus(doc=globalThis.document,{window:win=globalThis.window}={}){
  if(!doc)return {close(){},destroy(){}};
  if(installed.has(doc))return installed.get(doc);
  let trigger=null,panel=null,selected=null,route=null;const typeahead=createMenuTypeahead();
  const find=target=>target?.closest?.('[data-ui-menu-trigger]');
  const inside=target=>target&&(trigger?.contains(target)||panel?.contains(target));
  const enabled=()=>Array.from(panel?.querySelectorAll('button,[role="menuitem"],a[href]')||[]).filter(node=>!node.disabled&&node.getAttribute('aria-disabled')!=='true'&&!node.hidden);
  const identity=node=>JSON.stringify((node?.getAttributeNames?.()||[]).filter(name=>name.startsWith('data-')||name==='href').sort().map(name=>[name,node.getAttribute(name)]).concat([['label',node?.getAttribute('aria-label')||node?.textContent]]));
  const focusChoice=node=>{if(node){selected=identity(node);node.focus();}};
  function close({restoreFocus=false}={}){typeahead.reset();const previous=trigger;if(panel){try{panel.hidePopover?.();}catch{}panel.hidden=true;panel.removeAttribute('data-open');}trigger?.setAttribute('aria-expanded','false');trigger=panel=null;selected=route=null;if(restoreFocus&&previous?.isConnected)previous.focus();}
  function open(node,{last=false,choice=null}={}){
    close();const next=doc.getElementById(node.getAttribute('aria-controls'));if(!next||!node.isConnected)return;
    trigger=node;panel=next;route=win?.location?.hash;panel.hidden=false;panel.setAttribute('data-open','');trigger.setAttribute('aria-expanded','true');
    for(const item of panel.querySelectorAll('button,a[href]')){item.setAttribute('role','menuitem');item.setAttribute('tabindex','-1');}
    try{panel.showPopover?.();}catch{}
    const search=panel.querySelector?.('[data-ui-menu-search]');if(search){search.value='';filter(search);}
    position();
    const choices=enabled();if(search&&!last&&!choice)search.focus();else focusChoice(choice||(last?choices.at(-1):choices[0]));
  }
  function position(){
    const gap=pixelToken('--action-menu-anchor-gap',doc.documentElement),inset=pixelToken('--action-menu-viewport-inset',doc.documentElement),width=doc.documentElement.clientWidth||win.innerWidth,height=doc.documentElement.clientHeight||win.innerHeight;
    panel.style.maxHeight=Math.max(0,height-inset*2)+'px';panel.style.maxWidth=Math.min(pixelToken('--action-menu-max-width',doc.documentElement),Math.max(0,width-inset*2))+'px';
    const position=actionMenuPosition(trigger.getBoundingClientRect(),panel.getBoundingClientRect(),{width,height},{gap,inset});
    panel.style.left=position.left+'px';panel.style.top=position.top+'px';
  }
  function filter(search){const query=search.value.normalize('NFKC').trim().toLocaleLowerCase().replaceAll('_',' ');let count=0;for(const item of panel.querySelectorAll('[role="menuitem"]')){item.hidden=!item.textContent.normalize('NFKC').toLocaleLowerCase().replaceAll('_',' ').includes(query);if(!item.hidden&&!item.disabled)count++;}const status=panel.querySelector('[data-ui-menu-results]');if(status)status.textContent=count?'검색 결과 '+count+'개':'검색 결과가 없습니다. 검색어를 바꾸거나 직접 입력하세요.';}
  const handlers={
    input(event){if(panel?.contains(event.target)&&event.target.matches?.('[data-ui-menu-search]')){filter(event.target);position();}},
    click(event){const node=find(event.target);if(node){event.preventDefault();if(trigger===node)close();else open(node);return;}const action=event.target?.closest?.('button,[role="menuitem"],a[href]');if(action&&panel?.contains(action)&&!action.disabled&&action.getAttribute('aria-disabled')!=='true')close({restoreFocus:true});},
    pointerdown(event){if(trigger&&!inside(event.target))close();},
    focusin(event){if(trigger&&!inside(event.target))close();else if(panel?.contains(event.target))selected=identity(event.target);},
    keydown(event){
      if(event.isComposing||event.keyCode===229)return;
      const node=find(event.target),key=event.key;
      if(node&&['ArrowDown','ArrowUp'].includes(key)){event.preventDefault();open(node,{last:key==='ArrowUp'});return;}
      if(!panel||!inside(event.target))return;
      if(key==='Escape'){event.preventDefault();event.stopPropagation();close({restoreFocus:true});return;}
      if(key==='Tab'){close({restoreFocus:true});return;}
      const link=event.target?.closest?.('a[href]');
      if(key===' '&&link?.getAttribute?.('href')&&!link.disabled&&link.getAttribute('aria-disabled')!=='true'&&!event.defaultPrevented&&!event.ctrlKey&&!event.metaKey&&!event.altKey){event.preventDefault();link.click();return;}
      const searching=event.target.matches?.('[data-ui-menu-search]');if(searching&&key==='Enter'){event.preventDefault();return;}if(searching&&!['ArrowDown','ArrowUp'].includes(key))return;
      const choices=enabled(),at=choices.indexOf(doc.activeElement);let next;
      if(key==='ArrowDown')next=(at+1)%choices.length;
      if(key==='ArrowUp')next=searching?choices.length-1:(at-1+choices.length)%choices.length;
      if(key==='Home')next=0;
      if(key==='End')next=choices.length-1;
      if(next!==undefined&&choices.length){typeahead.reset();event.preventDefault();focusChoice(choices[next]);return;}
      const match=typeahead.find(event,choices.map(item=>item.getAttribute('aria-label')||item.textContent),at);
      if(match>=0){event.preventDefault();focusChoice(choices[match]);}
    },
    scroll(event){if(panel&&!panel.contains(event.target))close();},
    close(){close();},
  };
  for(const [name,handler]of Object.entries(handlers))doc.addEventListener(name,handler,true);
  win?.addEventListener('resize',close);
  const observer=win?.MutationObserver?new win.MutationObserver(()=>{
    if(!trigger||trigger.isConnected&&panel?.isConnected)return;
    const id=trigger.getAttribute('aria-controls'),label=trigger.getAttribute('aria-label'),selection=selected,active=doc.activeElement;
    if(route!==win?.location?.hash||active&&active!==doc.body&&active.isConnected&&!inside(active)){close();return;}
    const matches=Array.from(doc.querySelectorAll('[data-ui-menu-trigger]')).filter(node=>node.getAttribute('aria-controls')===id&&node.getAttribute('aria-label')===label&&!node.disabled&&!node.hidden&&node.getAttribute('aria-disabled')!=='true'&&node.getClientRects?.().length!==0);
    const replacement=matches.length===1?matches[0]:null,nextPanel=replacement&&doc.getElementById(id);
    const choices=Array.from(nextPanel?.querySelectorAll('button,[role="menuitem"],a[href]')||[]).filter(node=>identity(node)===selection&&!node.disabled&&node.getAttribute('aria-disabled')!=='true'&&!node.hidden);
    if(!replacement||choices.length!==1){close();replacement?.focus();return;}
    open(replacement,{choice:choices[0]});
  }):null;
  observer?.observe(doc.documentElement,{childList:true,subtree:true});
  const controller={close,destroy(){close();observer?.disconnect();for(const [name,handler]of Object.entries(handlers))doc.removeEventListener(name,handler,true);win?.removeEventListener('resize',close);installed.delete(doc);}};
  installed.set(doc,controller);return controller;
}
