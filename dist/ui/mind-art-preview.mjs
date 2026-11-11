import {paintMindArt} from './mind-art-scene.mjs';
import {createMindGameRuntime} from './mind-game.mjs';
import {gameUnits,gameDecimal} from '../domain/mind-game.mjs';

const root=document.querySelector('[data-mind-art-preview]'),canvasItems=[...root.querySelectorAll('canvas')],status=root.querySelector('[data-art-status]');
const base=new URL('../assets/mind-garden-v2/',import.meta.url);
const load=name=>new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>resolve(image);image.onerror=()=>reject(new Error(name+' 파일을 불러오지 못했습니다.'));image.src=new URL(name,base);});
let demoEquity=gameUnits('180000'),paused=false,clock=0,lastTick=null,lastPaint=0,request=null,disposed=false;
const states=canvasItems.map(canvas=>({canvas,ctx:canvas.getContext('2d'),visible:true,motion:'idle',startedAt:0}));
const reduced=matchMedia('(prefers-reduced-motion: reduce)');let assets;
const runtime=createMindGameRuntime({onCredit(){demoEquity+=gameUnits('1250');root.querySelector('[data-mind-scoreboard]').textContent=Number(gameDecimal(demoEquity)).toLocaleString('ko-KR');root.dataset.demoCredits=String(Number(root.dataset.demoCredits??0)+1);}});
runtime.mount(root);
function paint(){
 if(!assets)return;
 for(const s of states){
  if(!s.visible)continue;
  const stage=s.canvas.closest('[data-mind-game-stage]'),motion=stage.dataset.motionState,weather=stage.dataset.weather;
  if(s.motion!==motion){s.motion=motion;s.startedAt=clock;}
  const frame=paintMindArt(s.ctx,{...assets,motion,weather,time:clock,elapsed:clock-s.startedAt,reduced:reduced.matches});
  s.canvas.dataset.spriteFrame=frame.row+':'+frame.col;s.canvas.dataset.framesRendered=String(Number(s.canvas.dataset.framesRendered??0)+1);
  stage.querySelector('[data-art-weather-label]').textContent=weather==='rainy'?'비':'맑음';
 }
}
function tick(now){
 request=null;if(disposed)return;
 if(lastTick!==null&&!paused&&!document.hidden)clock+=Math.min(now-lastTick,100);lastTick=now;
 if(now-lastPaint>=32){paint();lastPaint=now;}
 if(!document.hidden&&!paused&&!reduced.matches&&states.some(s=>s.visible))request=requestAnimationFrame(tick);
}
function resume(){if(!assets||disposed||request!==null)return;lastTick=null;request=requestAnimationFrame(tick);}
const resize=new ResizeObserver(entries=>{for(const entry of entries){const s=states.find(s=>s.canvas===entry.target),width=Math.max(1,entry.contentRect.width),dpr=Math.min(devicePixelRatio||1,2);s.canvas.width=Math.round(width*dpr);s.canvas.height=Math.round(width*2/3*dpr);s.ctx.setTransform(s.canvas.width/768,0,0,s.canvas.height/512,0,0);}paint();});
const intersection=new IntersectionObserver(entries=>{for(const entry of entries){const s=states.find(s=>s.canvas===entry.target);s.visible=entry.isIntersecting;}resume();});
for(const s of states){resize.observe(s.canvas);intersection.observe(s.canvas);}
root.addEventListener('click',event=>{
 if(event.target.closest('[data-art-pause]')){paused=!paused;const button=root.querySelector('[data-art-pause]');button.textContent=paused?'동작 재생':'동작 멈춤';button.setAttribute('aria-pressed',String(paused));}
 if(event.target.closest('[data-game-demo-profit]'))for(const s of states)s.startedAt=clock;
 // The shared preview controller owns the motion, weather, chime and receipt flight.
 paint();resume();
});
const visibility=()=>{if(document.hidden){if(request!==null)cancelAnimationFrame(request);request=null;lastTick=null;}else resume();};
const reducedChange=()=>{paint();resume();};
document.addEventListener('visibilitychange',visibility);reduced.addEventListener('change',reducedChange);
try{
 const [sunny,rainy,atlas]=await Promise.all([load('garden-sunny-cute.png'),load('garden-rainy-cute.png'),load('cat-atlas-v2.png')]);
 for(const image of [sunny,rainy,atlas])if(image.naturalWidth!==1536||image.naturalHeight!==1024)throw new Error('어셋 크기가 1536×1024 계약과 다릅니다.');
 assets={sunny,rainy,atlas};root.dataset.assetsReady='true';status.textContent='고양이 1종의 4가지 동작과 두 날씨를 비교합니다.';resume();
}catch(error){root.dataset.assetsReady='false';status.textContent=error.message;}
addEventListener('pagehide',()=>{disposed=true;if(request!==null)cancelAnimationFrame(request);resize.disconnect();intersection.disconnect();runtime.destroy();document.removeEventListener('visibilitychange',visibility);reduced.removeEventListener('change',reducedChange);},{once:true});
