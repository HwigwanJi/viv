import React,{useLayoutEffect,useRef} from 'react';
import {actionMenuPosition} from './action-menu.mjs';
import {pixelToken} from './design-tokens.mjs';

export function StrategyContextMenu({title,items,point,onClose}){
 const root=useRef(null),origin=useRef(null);
 useLayoutEffect(()=>{
  origin.current=document.activeElement;const node=root.current,anchor=origin.current?.getBoundingClientRect(),inset=pixelToken('--action-menu-viewport-inset',document.documentElement);
  try{node.showPopover();}catch{}
  const position=actionMenuPosition({right:point?.x??anchor?.right??inset,bottom:point?.y??anchor?.bottom??inset,top:point?.y??anchor?.top??inset},node.getBoundingClientRect(),{width:window.innerWidth,height:window.innerHeight},{inset});
  Object.assign(node.style,{left:position.left+'px',top:position.top+'px',maxHeight:position.maxHeight+'px',maxWidth:position.maxWidth+'px'});node.querySelector('[role="menuitem"]')?.focus();
  const outside=event=>{if(!node.contains(event.target))onClose();};document.addEventListener('pointerdown',outside,true);
  return ()=>{document.removeEventListener('pointerdown',outside,true);try{node.hidePopover();}catch{}};
 },[point]);
 function keydown(event){
  const choices=[...root.current.querySelectorAll('[role="menuitem"]')],index=choices.indexOf(document.activeElement);
  if(event.key==='Escape'){event.preventDefault();event.stopPropagation();onClose();origin.current?.focus?.();return;}
  if(event.key==='Tab'){onClose();return;}
  const next=event.key==='Home'?0:event.key==='End'?choices.length-1:event.key==='ArrowDown'?(index+1)%choices.length:event.key==='ArrowUp'?(index-1+choices.length)%choices.length:null;
  if(next!==null){event.preventDefault();event.stopPropagation();choices[next]?.focus();}
 }
 return <div ref={root} popover="manual" className="strategy-node-menu" role="menu" aria-label={title} data-strategy-context-menu onKeyDown={keydown}><strong>{title}</strong>{items.map(item=><button type="button" key={item.label} role="menuitem" tabIndex={-1} aria-disabled={item.disabled||undefined} title={item.disabled?item.reason:undefined} onClick={()=>{if(item.disabled)return;item.run();onClose();}}>{item.label}{item.disabled&&item.reason&&<small className="entity-context-reason">{item.reason}</small>}</button>)}</div>;
}
