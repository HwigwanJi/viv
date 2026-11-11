const focusableSelector='button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

export function labFocusNode(graph){
 const nodes=graph?.nodes??[];
 return ['ALLOCATE','DECISION_MIXER','DECISION_ROUTER','QUANT','VIBE','JEV_QUESTION','COMBINER','JEV'].map(type=>nodes.find(node=>node.type===type)).find(Boolean)?.id??nodes[0]?.id??null;
}

// Keep the mounted editor and its history in place while isolating the focused arm.
export function isolateLabArm(panel,{document:doc=globalThis.document}={}){
 if(!panel)return ()=>{};
 const changes=[];
 for(let branch=panel;branch?.parentElement;branch=branch.parentElement){
  for(const sibling of branch.parentElement.children)if(sibling!==branch){changes.push([sibling,sibling.inert]);sibling.inert=true;}
  if(branch.parentElement===doc.body)break;
 }
 const attributes=['role','aria-modal','tabindex'].map(name=>[name,panel.getAttribute(name)]),overflow=doc.body?.style.overflow;
 panel.setAttribute('role','dialog');panel.setAttribute('aria-modal','true');panel.setAttribute('tabindex','-1');
 if(doc.body)doc.body.style.overflow='hidden';
 return ()=>{
  for(const [element,inert]of changes)element.inert=inert;
  for(const [name,value]of attributes)value===null?panel.removeAttribute(name):panel.setAttribute(name,value);
  if(doc.body)doc.body.style.overflow=overflow;
 };
}

export function containLabFocus(event,panel,{document:doc=globalThis.document}={}){
 if(event.key!=='Tab'||!panel||event.defaultPrevented)return false;
 const items=[...panel.querySelectorAll(focusableSelector)].filter(node=>!node.inert&&node.getClientRects().length),first=items[0]??panel,last=items.at(-1)??panel;
 if(!panel.contains(doc.activeElement)||event.shiftKey&&doc.activeElement===first||!event.shiftKey&&doc.activeElement===last){event.preventDefault();(event.shiftKey?last:first).focus({preventScroll:true});return true;}
 return false;
}
