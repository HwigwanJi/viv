import {cssToken,numberToken,pixelToken} from './design-tokens.mjs';

export function interfaceMotionKey(route){return [route.page,...['profileId','view','executionMode','knowledgeView','tab','simulationId'].map(key=>route.params.get(key)||'')].join('|');}

export function createRouteMotion({clock=()=>performance.now(),reduced=()=>globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches,visual=element=>({duration:numberToken('--ui-motion-page-ms',element),distance:pixelToken('--ui-motion-distance-md',element),easing:cssToken('--ui-motion-ease-enter',element)})}={}){
  let key=null,started=0,animation=null;
  return {stop(){animation?.cancel();animation=null;},enter(element,nextKey){
    const now=clock();if(key!==nextKey){key=nextKey;started=now;}
    animation?.cancel();animation=null;
    if(!element?.animate||reduced())return null;
    const tokens=visual(element),elapsed=Math.max(0,now-started);
    if(elapsed>=tokens.duration)return null;
    animation=element.animate([{opacity:0,transform:'translateY('+tokens.distance+'px)'},{opacity:1,transform:'none'}],{duration:tokens.duration,easing:tokens.easing});
    // Data refreshes inherit the same route clock, including a redraw during entry.
    animation.currentTime=elapsed;
    return animation;
  }};
}

export function jumpNavigationIndex(index,key,length){
  if(!length)return -1;
  if(key==='Home')return 0;if(key==='End')return length-1;
  return key==='ArrowUp'?(index<0?length-1:(index-1+length)%length):(index+1)%length;
}
