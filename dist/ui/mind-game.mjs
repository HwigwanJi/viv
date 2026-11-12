import {optionalSessionStorage} from './session-storage.mjs';
import {MIND_CHARACTERS,MIND_MOTIONS,gameUnits,gameDecimal} from '../domain/mind-game.mjs';
import {renderMindAvatar} from './mind-avatar.mjs';
import {currencyAmount} from './currency-format.mjs';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const amount=(v,currency)=>currencyAmount(Number(v),currency)+' '+currency;
const weatherLabels={sunny:'맑음',rainy:'비',calm:'잔잔함',unknown:'손익 확인 중'};
export function renderMindStage(card,{preview=false}={}){
 const game=card.game??{motion:'idle',weather:'unknown'},body=card.appearance?.config?.bodyVariant??'blob',index=MIND_CHARACTERS.findIndex(c=>c.id===body);
 const state=MIND_MOTIONS.find(m=>m.id===game.motion)?.name??'대기';
 return '<div class="mind-game-stage" data-mind-game-stage data-motion-state="'+esc(game.motion)+'" data-weather="'+esc(game.weather)+'" data-character="'+esc(body)+'" data-character-rhythm="'+Math.max(0,index)+'">'+
 '<span class="mind-game-weather" aria-label="'+esc(weatherLabels[game.weather]??weatherLabels.unknown)+'"><span class="mind-game-sun"></span><span class="mind-game-cloud"></span><span class="mind-game-cloud mind-game-cloud-back"></span><span class="mind-game-rain"></span></span>'+
 '<span class="mind-game-hill mind-game-hill-back"></span><span class="mind-game-hill"></span><span class="mind-game-ground"></span>'+
 '<svg class="mind-game-workstation" viewBox="0 0 320 190" aria-hidden="true"><g class="mind-game-monitor"><rect x="45" y="47" width="87" height="59" rx="7"/><path d="M80 108v10m-14 0h29"/><path class="mind-game-chart" d="M57 91l12-11 13 4 12-19 12 7 13-15"/></g><g class="mind-game-desk"><path d="M36 125h122M48 128v37m98-37v37"/></g><g class="mind-game-plant"><path d="M267 136v-31m0 20q-20-7-13-23 18 0 13 23m0-10q17-8 16-22-20 2-16 22"/><path d="M253 135h28l-4 23h-20z"/></g><g class="mind-game-lamp"><path d="M219 128v-47l-17-15m-11-2q11-20 25-2z"/></g></svg>'+
 '<span class="mind-game-sparkles" aria-hidden="true">✦ <span>✧</span> ✦</span><span class="mind-game-envelope" aria-hidden="true">↗</span><span class="mind-game-thought" aria-hidden="true"><i></i><i></i><i></i></span>'+
 '<div class="mind-game-character">'+renderMindAvatar({identity:card.profileId,phase:card.phase??'idle',size:'large',config:card.appearance?.config})+'</div>'+
 '<span class="mind-game-action-label">'+esc(state)+'</span>'+(preview?'':'<span class="mind-game-weather-caption">'+esc(weatherLabels[game.weather]??weatherLabels.unknown)+'</span>')+'</div>';
}
export function renderTodayProfit(card){
 const game=card.game,ready=game?.status==='READY';
 return '<p class="mind-game-today" data-weather="'+esc(game?.weather??'unknown')+'"><span>오늘 실현손익</span><strong>'+(ready?(Number(game.todayRealizedPnl)>0?'+':'')+esc(amount(game.todayRealizedPnl,game.currency)):'—')+'</strong><small>한국시간 0시부터 수수료 포함</small></p>';
}
export function gameTotals(view){
 const groups=new Map();for(const card of view.cards??[]){
  if(!card.connected||(card.executionMode==='live'&&card.liveActivity?.ledger?.allocationStatus==='RELEASED'))continue;
  const currencies=card.executionMode==='live'?[{currency:card.liveActivity?.quoteCurrency,equity:card.game?.equity??card.liveActivity?.ledger?.equity,asOf:card.game?.valuationAsOf??card.liveActivity?.ledger?.valuationAsOf}]:card.currencies;
  for(const c of currencies??[]){if(!c.currency)continue;const g=groups.get(c.currency)??{currency:c.currency,equity:0n,complete:true,count:0,asOf:null};g.count++;try{if(c.equity===null||c.equity===undefined)throw 0;g.equity+=gameUnits(c.equity);g.asOf=!g.asOf||c.asOf<g.asOf?c.asOf:g.asOf;}catch{g.complete=false;}groups.set(c.currency,g);}
 }
 return [...groups.values()].map(g=>({...g,equity:g.complete?gameDecimal(g.equity):null}));
}
export function renderGameScoreboard(view){
 const totals=gameTotals(view);
 return '<section class="mind-game-scoreboard" aria-label="마인드 평가금액 합계"><div><span class="mind-game-eyebrow">'+(view.executionMode==='live'?'LIVE':'PAPER')+' MIND GARDEN</span><h2>마인드</h2><p>각자의 판단과 보유를 지켜보세요.</p></div><div class="mind-game-scores">'+(totals.length?totals.map(t=>'<div class="mind-game-score" data-score-currency="'+esc(t.currency)+'"><span>평가금액 합계 <small>'+esc(t.currency)+'</small></span><strong data-mind-scoreboard="'+esc(t.currency)+'">'+(t.equity===null?'평가 확인 중':esc(currencyAmount(Number(t.equity),t.currency)))+'</strong><small>'+(t.equity===null?'보유 자산의 평가 자료를 기다립니다.':t.count+'개 마인드'+(t.asOf?' / '+esc(new Date(t.asOf).toLocaleTimeString('ko-KR',{timeZone:'Asia/Seoul',hour:'2-digit',minute:'2-digit'}))+' 평가':''))+'</small></div>').join(''):'<p>마인드에 운용 자금을 배정하면 합계가 표시됩니다.</p>')+'</div><div class="mind-game-toolbar"><button type="button" class="text-button" data-game-sound aria-pressed="false">소리 켜기</button><a class="text-button" href="#minds?profileId=all&amp;executionMode='+esc(view.executionMode)+'&amp;view=motions" data-studio-route>캐릭터</a></div></section>';
}
export function renderMotionGallery(){
 return '<section class="mind-motion-gallery"><header><span class="mind-game-eyebrow"></span><h1>캐릭터</h1><p>캐릭터 6종의 12가지 동작을 같은 구성으로 살펴보세요. 아래 장면은 모션 미리보기입니다.</p><a class="text-button" href="/#minds?profileId=all&amp;view=overview" data-studio-route>마인드 관리로</a></header><nav class="mind-motion-picker" aria-label="모션 선택">'+MIND_MOTIONS.map((m,i)=>'<button type="button" data-motion-preview="'+m.id+'" aria-pressed="'+(i===0)+'">'+m.name+'</button>').join('')+'<button type="button" data-motion-play aria-pressed="false">전체 모션 재생</button><button type="button" data-game-demo-profit>수익 정산 연출 보기</button><button type="button" data-game-sound aria-pressed="false">소리 켜기</button></nav><div class="mind-game-preview-score">미리보기 평가금액 <strong data-mind-scoreboard="KRW">180,000</strong> KRW</div><div class="mind-companion-grid mind-motion-grid">'+MIND_CHARACTERS.map((c,i)=>{
  const config={bodyVariant:c.id,colorPalette:['blue','amber','violet','sage'][i%4],eyeVariant:'natural',accessory:['none','glasses','bowtie','none','glasses','none'][i],motionIntensity:'subtle'};
  return '<article class="mind-companion-card" data-motion-character="'+c.id+'">'+renderMindStage({profileId:'motion-'+c.id,phase:'idle',appearance:{config},game:{motion:'rest',weather:i%3===0?'sunny':i%3===1?'rainy':'calm'}},{preview:true})+'<h2>'+c.name+'</h2><p>12가지 상황별 동작</p><div class="mind-motion-weather-picker"><button type="button" data-preview-weather="sunny" aria-label="'+c.name+' 맑은 날씨">맑음</button><button type="button" data-preview-weather="rainy" aria-label="'+c.name+' 비오는 날씨">비</button><button type="button" data-preview-weather="calm" aria-label="'+c.name+' 잔잔한 날씨">잔잔함</button></div></article>';
 }).join('')+'</div></section>';
}

export function createMindGameRuntime({environment=globalThis,storage=optionalSessionStorage(environment),onCredit=()=>{},onSettlement=null}={}){
 const seen=new Set(),initialized=new Set(),effects=new Set();let container=null,listener=null,timer=null,motionIndex=0,sound=false,audio=null;
 try{sound=environment.localStorage?.getItem('cji-mind-sound')==='on';}catch{}
 const doc=environment.document;
 let rain=0,rainAudio=null,rainTimer=null,unlocked=false;
 function context(){const Context=environment.AudioContext??environment.webkitAudioContext;if(!Context)return null;if(!audio){audio=new Context();audio.addEventListener?.('statechange',syncSound);}return audio;}
 function syncRain(){
  try{
   if(!sound||!unlocked||rain<=0||!container){if(rainTimer!==null)environment.clearInterval(rainTimer);rainTimer=null;if(rainAudio){const {source,bed,tap}=rainAudio,at=audio.currentTime;bed.gain.cancelScheduledValues(at);tap.gain.cancelScheduledValues(at);bed.gain.setTargetAtTime(0,at,.08);tap.gain.setTargetAtTime(0,at,.04);source.stop(at+.4);rainAudio=null;}return;}
   const c=context();if(!c)return;
   if(!rainAudio){
    const buffer=c.createBuffer(1,Math.ceil(c.sampleRate*16.7),c.sampleRate),data=buffer.getChannelData(0);for(let i=0;i<data.length;i++)data[i]=Math.random()*2-1;
    const source=c.createBufferSource(),low=c.createBiquadFilter(),high=c.createBiquadFilter(),bed=c.createGain(),tap=c.createGain();source.buffer=buffer;source.loop=true;low.type='lowpass';low.frequency.value=1900;high.type='bandpass';high.frequency.value=2500;high.Q.value=.7;bed.gain.value=0;tap.gain.value=0;source.connect(low);low.connect(bed);bed.connect(c.destination);source.connect(high);high.connect(tap);tap.connect(c.destination);source.onended=()=>{for(const node of [source,low,high,bed,tap])node.disconnect();};source.start();rainAudio={source,bed,tap,low};
    rainTimer=environment.setInterval(()=>{if(!rainAudio)return;const at=c.currentTime+.015,p=rainAudio.tap.gain;p.cancelScheduledValues(at);p.setValueAtTime(0,at);for(let i=0;i<1+Math.floor(rain*4);i++){const start=at+i*.047+Math.random()*.025,level=(.012+Math.random()*.045)*rain;p.setValueAtTime(0,start);p.linearRampToValueAtTime(level,start+.002);p.exponentialRampToValueAtTime(.0001,start+.015+Math.random()*.026);}},250);
   }
   rainAudio.bed.gain.setTargetAtTime(.008+rain*.025,c.currentTime,.3);rainAudio.low.frequency.setTargetAtTime(1100+rain*1700,c.currentTime,.4);
  }catch{}
 }
 function chime(){if(!sound||!unlocked)return;try{if(!context())return;audio.resume();[880,1174.66,1567.98].forEach((frequency,i)=>{const oscillator=audio.createOscillator(),gain=audio.createGain(),at=audio.currentTime+i*.085;oscillator.type='sine';oscillator.frequency.value=frequency;gain.gain.setValueAtTime(0,at);gain.gain.linearRampToValueAtTime(.055,at+.008);gain.gain.exponentialRampToValueAtTime(.001,at+.42);oscillator.connect(gain);gain.connect(audio.destination);oscillator.start(at);oscillator.stop(at+.44);});}catch{}}
 function syncSound(){container?.querySelectorAll('[data-game-sound]').forEach(b=>{b.textContent=sound?'소리 끄기':'소리 켜기';b.setAttribute('aria-pressed',String(sound));if(b.dataset)b.dataset.gameAudioState=audio?.state??'NOT_STARTED';});}
 function credit(card,receipt,{preview=false,motionOff=false}={}){
  const target=container?.querySelector('[data-mind-scoreboard="'+receipt.currency+'"]');if(!target||!card)return;
  const start=card.getBoundingClientRect(),finish=target.getBoundingClientRect(),tag=doc.createElement('span');tag.className='mind-game-profit-fly';tag.setAttribute('role','status');tag.setAttribute('data-profit-receipt',receipt.id);tag.textContent='+'+amount(receipt.amount,receipt.currency);tag.style.left=(start.left+start.width/2)+'px';tag.style.top=(start.top+Math.min(start.height/2,140))+'px';doc.body.append(tag);effects.add(tag);chime();
  const done=()=>{tag.remove();effects.delete(tag);target.classList.add('is-crediting');environment.setTimeout(()=>target.classList.remove('is-crediting'),650);onCredit({receipt,preview});};
  if(motionOff||card.dataset?.motion==='off'||environment.matchMedia?.('(prefers-reduced-motion: reduce)').matches||typeof tag.animate!=='function'){environment.setTimeout(done,1600);return;}
  const dx=finish.left+finish.width/2-(start.left+start.width/2),dy=finish.top+finish.height/2-(start.top+Math.min(start.height/2,140));
  const animation=tag.animate([{transform:'translate(-50%,0) scale(.7)',opacity:0,offset:0},{transform:'translate(-50%,-25px) scale(1.08)',opacity:1,offset:.18},{transform:'translate(-50%,-30px) scale(1)',opacity:1,offset:.5},{transform:'translate(calc(-50% + '+dx+'px),'+dy+'px) scale(.45)',opacity:0,offset:1}],{duration:2100,easing:'cubic-bezier(.2,.7,.25,1)',fill:'forwards'});animation.finished.then(done,()=>{tag.remove();effects.delete(tag);});
 }
 function inspectReceipts(){
  for(const card of container?.querySelectorAll('[data-mind-companion]')??[]){
   let receipts;try{receipts=JSON.parse(card.dataset.gameReceipts??'[]');}catch{continue;}
   const profileScope=card.dataset.executionMode+':'+card.dataset.profileId,scope=profileScope+':'+card.dataset.gameDay,key='cji-mind-seen:'+scope;
   if(!initialized.has(scope)){let saved=null;try{saved=storage?.getItem(key);for(const id of JSON.parse(saved??'[]'))seen.add(scope+':'+id);}catch{}if(!saved&&!initialized.has(profileScope))for(const r of receipts)seen.add(scope+':'+r.id);initialized.add(scope);initialized.add(profileScope);}
   for(const r of receipts){const id=scope+':'+r.id;if(seen.has(id))continue;seen.add(id);try{const pnl=gameUnits(r.amount);if(!['KRW','USD','USDT','BTC'].includes(r.currency))continue;if(onSettlement)onSettlement({card,receipt:r});else if(pnl>0n)credit(card,r);}catch{}}
   try{storage?.setItem(key,JSON.stringify(receipts.map(r=>r.id)));}catch{}
  }
 }
 function setMotion(id){if(!MIND_MOTIONS.some(m=>m.id===id))return;container.querySelectorAll('[data-motion-character] [data-mind-game-stage]').forEach(stage=>{stage.dataset.motionState=id;stage.querySelector('.mind-game-action-label').textContent=MIND_MOTIONS.find(m=>m.id===id).name;});container.querySelectorAll('[data-motion-preview]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.motionPreview===id)));}
 function unmount(){if(container&&listener)container.removeEventListener?.('click',listener);if(timer)environment.clearInterval(timer);timer=null;container=null;listener=null;rain=0;syncRain();}
 function mount(root){unmount();if(!root?.querySelectorAll||typeof root.addEventListener!=='function')return;container=root;listener=event=>{
  if(sound&&!unlocked){unlocked=true;try{context()?.resume();}catch{}syncRain();}
  const soundButton=event.target.closest('[data-game-sound]');if(soundButton){sound=!sound;unlocked=true;try{environment.localStorage?.setItem('cji-mind-sound',sound?'on':'off');if(sound)context()?.resume();}catch{}syncSound();syncRain();if(sound)chime();return;}
  const preview=event.target.closest('[data-motion-preview]');if(preview){setMotion(preview.dataset.motionPreview);return;}
  const weather=event.target.closest('[data-preview-weather]');if(weather){weather.closest('[data-motion-character]').querySelector('[data-mind-game-stage]').dataset.weather=weather.dataset.previewWeather;return;}
  const play=event.target.closest('[data-motion-play]');if(play){if(timer){environment.clearInterval(timer);timer=null;play.textContent='전체 모션 재생';play.setAttribute('aria-pressed','false');}else{play.textContent='재생 중지';play.setAttribute('aria-pressed','true');setMotion(MIND_MOTIONS[motionIndex].id);timer=environment.setInterval(()=>{motionIndex=(motionIndex+1)%MIND_MOTIONS.length;setMotion(MIND_MOTIONS[motionIndex].id);},3800);}return;}
  if(event.target.closest('[data-game-demo-profit]')){setMotion('settle');credit(container.querySelector('[data-motion-character]'),{id:'preview-'+Date.now(),currency:'KRW',amount:'1250'},{preview:true});}
 };container.addEventListener?.('click',listener);syncSound();inspectReceipts();}
 return {mount,unmount,presentSettlement:credit,setRainIntensity(value){const next=Number.isFinite(value)?Math.max(0,Math.min(1,value)):0;if(next===rain)return;rain=next;syncRain();},destroy(){unmount();for(const tag of effects)tag.remove();effects.clear();audio?.close?.();}};
}
