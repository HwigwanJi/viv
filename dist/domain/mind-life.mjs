import {MIND_CHARACTERS,gameUnits} from './mind-game.mjs';

export const LIFE_CHARACTERS=Object.freeze(MIND_CHARACTERS.map(c=>({...c,prop:{cat:'생선',rabbit:'당근',frog:'반딧불 병',blob:'별 조각',pear:'딸기',heart:'편지'}[c.id]})));
export const LIFE_CLIPS=Object.freeze({idle:0,walk:1,read:2,carry:3,sell:4,loss:5,profit:6});
export function mindRain(card){
 const game=card.game??{},activity=card.liveActivity??card.paperActivity;
 if(game.status!=='READY'||game.weather!=='rainy')return {intensity:0,lossRate:null,basis:null};
 try{
  const loss=-gameUnits(game.todayRealizedPnl);if(loss<=0n)return {intensity:0,lossRate:0,basis:null};
  const capital=activity?.quoteCurrency===game.currency&&activity.ledger?.status==='READY'?activity.ledger.initialCapital:card.currencies?.find(c=>c.currency===game.currency)?.initialCapital;
  const principal=gameUnits(capital);if(principal<=0n)throw new Error('Missing principal');
  const lossRate=Number(loss*100000000n/principal)/100000000;
  return {intensity:.12+.88*Math.sqrt(Math.min(1,lossRate/.05)),lossRate,basis:'TODAY_REALIZED_OVER_ALLOCATED_CAPITAL'};
 }catch{return {intensity:.32,lossRate:null,basis:'CAPITAL_UNAVAILABLE'};}
}
export const rainLabel=intensity=>intensity>=.94?'폭우':intensity>=.68?'장대비':intensity>=.34?'비':'이슬비';
export const LIFE_ACTIONS=Object.freeze([
 {id:'auto',label:'자동 재생'},{id:'idle',label:'대기'},{id:'walk',label:'이동'},{id:'carry',label:'가져오기'},{id:'scan',label:'검색'},
 {id:'think',label:'검토'},{id:'entry',label:'매수'},{id:'add',label:'추가 매수'},
 {id:'hold',label:'보유'},{id:'reduce',label:'일부 매도'},{id:'exit',label:'매도'},
 {id:'settle',label:'수익'},{id:'loss',label:'손실'},{id:'rest',label:'일시중지'},
 {id:'attention',label:'확인 필요'},{id:'stale',label:'연결 확인'},
]);
const fixed={walk:'walk',carry:'carry',think:'read',entry:'walk',add:'carry',reduce:'sell',exit:'sell',settle:'profit',loss:'loss',attention:'read',stale:'idle'};
export function seededLifeRandom(identity){let n=2166136261;for(const c of String(identity))n=Math.imul(n^c.charCodeAt(0),16777619);return ()=>{n+=0x6d2b79f5;let t=Math.imul(n^n>>>15,1|n);t^=t+Math.imul(t^t>>>7,61|t);return ((t^t>>>14)>>>0)/4294967296;};}
export function createLife(identity,{now=0}={}){
 const random=seededLifeRandom(identity);
 return {identity,random,phase:random()*90000,event:'idle',lastEvent:null,eventAt:now,eventUntil:now+4000+random()*10000,blinkAt:now+1500+random()*6500,blinkUntil:0,queue:[],current:null,mode:null,modeAt:now};
}
export function enqueueLifeSettlement(life,receipt,onProfit=()=>{}){
 const amount=gameUnits(receipt.amount);life.queue.push({receipt,amount,onProfit,at:null,credited:false});
}
export function stepLife(life,now,{motion='idle',reduced=false}={}){
 if(!Number.isFinite(now)||now<0)throw new RangeError('Invalid animation clock');
 if(life.mode!==motion){life.mode=motion;life.modeAt=now;}
 if(!life.current&&life.queue.length){life.current=life.queue.shift();life.current.at=now;}
 if(life.current){
  const current=life.current,elapsed=now-current.at,delivery=2400,result=3600;
  if(reduced){if(current.amount>0n)current.onProfit();life.current=null;return {clip:current.amount<0n?'loss':current.amount>0n?'profit':'idle',elapsed:0,event:'settlement',once:true,receipt:current.receipt,x:.5,facing:1,blink:false,rest:false};}
  if(elapsed>=delivery&&!current.credited){current.credited=true;if(current.amount>0n)current.onProfit();}
  if(elapsed>=delivery+result){life.current=null;return stepLife(life,now,{motion,reduced});}
  const after=elapsed>=delivery,clip=after?(current.amount<0n?'loss':current.amount>0n?'profit':'idle'):'sell';
  return {clip,elapsed:after?elapsed-delivery:elapsed,event:'settlement',once:true,receipt:after?current.receipt:null,x:.5,facing:1,blink:false,rest:false};
 }
 if(fixed[motion])return {clip:fixed[motion],elapsed:now-life.modeAt,event:motion,once:!['read','walk','carry'].includes(fixed[motion]),x:.5,facing:1,blink:false,rest:false};
 if(reduced)return {clip:'idle',elapsed:0,event:'idle',once:true,x:.5,facing:1,blink:false,rest:false};
 if(now>=life.blinkAt){life.blinkUntil=now+145;life.blinkAt=now+2800+life.random()*6500;}
 if(now>=life.eventUntil){
  const choices=['idle','walk','read','forage','rest'].filter(e=>e!==life.event),event=choices[Math.floor(life.random()*choices.length)];
  life.lastEvent=life.event;life.event=event;life.eventAt=now;
  life.eventUntil=now+({idle:18000,walk:9000,read:14000,forage:18000,rest:19000}[event])+life.random()*({idle:26000,walk:8000,read:17000,forage:9000,rest:30000}[event]);
 }
 const elapsed=now-life.eventAt,progress=Math.min(1,elapsed/(life.eventUntil-life.eventAt));let clip=life.event,clipElapsed=elapsed,once=false,x=.5,facing=1;
 if(clip==='forage'){
  if(elapsed<4500){clip='walk';x=.5-elapsed/4500*.36;facing=-1;}
  else if(elapsed<12000){clip='carry';clipElapsed=elapsed-4500;x=.14+Math.min(1,clipElapsed/7500)*.36;}
  else if(elapsed<14500){clip='sell';clipElapsed=elapsed-12000;once=true;}
  else clip='idle';
 }else if(clip==='walk'){x=.5+Math.sin(progress*Math.PI*2)*.22;facing=Math.cos(progress*Math.PI*2)>=0?1:-1;}
 else if(clip==='rest')clip='idle';
 return {clip,elapsed:clipElapsed,event:life.event,once,x,facing,blink:now<life.blinkUntil,rest:life.event==='rest'};
}
export function lifeFrame(layout,pose,{reduced=false}={}){
 const row=LIFE_CLIPS[pose.clip];if(row===undefined)throw new RangeError('Unknown character action');
 let col;
 if(reduced)col=0;
 else if(pose.clip==='idle')col=pose.rest||pose.blink?1:0;
 else if(pose.clip==='read'){const t=pose.elapsed%11000;col=t<2100?Math.min(5,Math.floor(t/350)):t>8000&&t<8150?5:0;}
 else if(['walk','carry'].includes(pose.clip))col=Math.floor(pose.elapsed/145)%6;
 else col=Math.min(5,Math.floor(pose.elapsed/300));
 const crop=layout.frames.find(f=>f.row===row&&f.col===col);if(!crop)throw new RangeError('Missing character frame');
 return {...crop,row,col,baseline:layout.baselines[row],unit:layout.width/6};
}
