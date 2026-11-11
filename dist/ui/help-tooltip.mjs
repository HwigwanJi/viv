import {pixelToken,numberToken} from './design-tokens.mjs';

const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let sequence=0;

/** Compact, text-only help using shadcn's trigger/content composition. */
export function helpTooltip(label,text,{id}={}){
  const key=id||'help-'+(++sequence);
  return '<span class="help-tooltip"><button type="button" class="help-tooltip-trigger" data-help-trigger aria-label="'+escape(label)+' 도움말" aria-describedby="'+escape(key)+'"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7v1"/></svg></button><span id="'+escape(key)+'" class="help-tooltip-content" data-help-content role="tooltip" popover="manual" hidden>'+escape(text)+'</span></span>';
}
export function helpLabel(label,text,options){return '<span class="help-label">'+escape(label)+helpTooltip(label,text,options)+'</span>';}

/** Read-only values share the enclosing link's keyboard focus and keep its action. */
export function readonlyTooltip(label,text,{id}={}){
  const key=id||'help-'+(++sequence);
  return '<span data-help-trigger data-help-passive aria-describedby="'+escape(key)+'">'+escape(label)+'</span><span id="'+escape(key)+'" class="help-tooltip-content" data-help-content role="tooltip" popover="manual" hidden>'+escape(text)+'</span>';
}

export function tooltipPosition(anchor,bubble,{width,height},{gap=0,inset=0,arrowInset=0}={}){
  const left=Math.max(inset,Math.min(anchor.left+anchor.width/2-bubble.width/2,width-bubble.width-inset));
  const above=anchor.top-bubble.height-gap>=inset;
  const top=above?anchor.top-bubble.height-gap:Math.min(anchor.bottom+gap,height-bubble.height-inset);
  return {left,top:Math.max(inset,top),side:above?'top':'bottom',arrow:Math.max(arrowInset,Math.min(bubble.width-arrowInset,anchor.left+anchor.width/2-left))};
}

const installed=new WeakMap();
export function installHelpTooltips(doc=globalThis.document,{window:win=globalThis.window,delay,setTimer=setTimeout,clearTimer=clearTimeout}={}){
  if(!doc)return {destroy(){}};
  if(installed.has(doc))return installed.get(doc);
  let trigger=null,content=null,pending=null,closeTimer=null,pinned=false,suppressed=null;
  const cancel=()=>{clearTimer(pending);clearTimer(closeTimer);pending=closeTimer=null;};
  const close=()=>{cancel();if(content){try{content.hidePopover?.();}catch{}content.hidden=true;content.removeAttribute('data-open');}trigger=null;content=null;pinned=false;};
  const place=()=>{
    const position=tooltipPosition(trigger.getBoundingClientRect(),content.getBoundingClientRect(),{width:win.innerWidth,height:win.innerHeight},{gap:pixelToken('--help-tooltip-anchor-gap',doc.documentElement),inset:pixelToken('--help-tooltip-viewport-inset',doc.documentElement),arrowInset:pixelToken('--help-tooltip-arrow-inset',doc.documentElement)});
    content.style.left=position.left+'px';content.style.top=position.top+'px';content.style.setProperty('--help-arrow-x',position.arrow+'px');content.dataset.side=position.side;
  };
  const show=node=>{
    cancel();if(!node?.isConnected||node===suppressed)return;
    if(trigger===node&&content)return;
    close();trigger=node;content=doc.getElementById(node.getAttribute('aria-describedby'));if(!content){trigger=null;return;}
    content.hidden=false;content.setAttribute('data-open','');
    try{content.showPopover?.();}catch{}
    place();
  };
  const find=target=>target?.closest?.('[data-help-trigger]');
  const within=target=>target&&(trigger?.contains(target)||content?.contains(target));
  const leave=()=>{clearTimer(closeTimer);closeTimer=setTimer(()=>{if(!pinned&&doc.activeElement!==trigger&&!(trigger?.getAttribute('data-help-passive')!=null&&doc.activeElement?.contains?.(trigger)))close();},numberToken('--help-tooltip-leave-delay-ms',doc.documentElement));};
  const listeners={
    pointerover(event){if(content?.contains(event.target)){clearTimer(closeTimer);return;}const node=find(event.target);if(!node||node.contains(event.relatedTarget)||event.pointerType==='touch')return;cancel();pending=setTimer(()=>show(node),delay??numberToken('--help-tooltip-hover-delay-ms',doc.documentElement));},
    pointerout(event){const node=find(event.target);if(node&&node===suppressed&&!node.contains(event.relatedTarget))suppressed=null;if(within(event.target)&&!within(event.relatedTarget))leave();else if(node&&!node.contains(event.relatedTarget))cancel();},
    focusin(event){const node=find(event.target)??event.target?.querySelector?.('[data-help-passive]');if(node)show(node);},
    focusout(event){if(find(event.target)===suppressed||event.target?.contains?.(suppressed))suppressed=null;if((within(event.target)||event.target?.contains?.(trigger))&&!within(event.relatedTarget))close();},
    click(event){const node=find(event.target);if(!node||node.getAttribute('data-help-passive')!=null)return;event.preventDefault();if(trigger===node&&pinned){suppressed=node;close();}else{suppressed=null;show(node);pinned=true;}},
    pointerdown(event){if(trigger&&!within(event.target))close();},
    keydown(event){if(event.key==='Escape'&&content){suppressed=trigger;close();event.preventDefault();event.stopPropagation();}},
    scroll(){if(trigger&&doc.activeElement===trigger){const rect=trigger.getBoundingClientRect();if(rect.bottom>0&&rect.top<win.innerHeight){place();return;}}close();},
    close(){close();},
  };
  for(const [name,handler]of Object.entries(listeners))doc.addEventListener(name,handler,true);
  win?.addEventListener('resize',close);
  const observer=win?.MutationObserver?new win.MutationObserver(()=>{if(trigger&&(!trigger.isConnected||!content?.isConnected))close();}):null;
  observer?.observe(doc.documentElement,{childList:true,subtree:true});
  const controller={destroy(){close();observer?.disconnect();for(const [name,handler]of Object.entries(listeners))doc.removeEventListener(name,handler,true);win?.removeEventListener('resize',close);installed.delete(doc);}};
  installed.set(doc,controller);return controller;
}
