import {LIFE_CHARACTERS,LIFE_ACTIONS,createLife,stepLife,enqueueLifeSettlement,mindRain,rainLabel} from '../domain/mind-life.mjs';
import {gameUnits,gameDecimal} from '../domain/mind-game.mjs';
import {mindAvatarIdentity} from './mind-avatar.mjs';
import {createMindGameRuntime} from './mind-game.mjs';
import {paintLivingMind,lifeCamera} from './mind-life-scene.mjs';
import {currencyAmount} from './currency-format.mjs';

const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const label={sunny:'맑음',rainy:'비',calm:'흐림',unknown:'손익 미집계'};
export const lifeSettings=()=>'<details class="mind-life-settings"><summary>장면 설정</summary><div><label><input type="checkbox" data-life-animations aria-label="애니메이션" checked>애니메이션</label><button type="button" data-game-sound aria-pressed="false">소리 켜기</button></div></details>';
export function renderLifePnl(card){const g=card.game;if(g?.status!=='READY'||g.todayRealizedPnl===null||(card.executionMode==='live'&&card.liveActivity?.ledger?.allocationStatus==='RELEASED'&&Number(g.todayRealizedPnl)===0))return '';return '<p class="mind-life-today"><span>오늘 실현 손익</span><strong>'+(Number(g.todayRealizedPnl)>0?'+':'')+currencyAmount(Number(g.todayRealizedPnl),g.currency)+' '+esc(g.currency)+'</strong></p>';}
export function renderLifeStage(card,{view='scene'}={}){
 const config={...mindAvatarIdentity(card.profileId).config,...card.appearance?.config},character=LIFE_CHARACTERS.find(c=>c.id===config.bodyVariant)??LIFE_CHARACTERS[0],game=card.game??{},motion=game.motion??({sleep:'rest',observing:'scan',investing:'hold',clutch:'hold',attention:'attention'}[card.phase]??'idle');
 const rain=mindRain(card);
 return '<div class="mind-life-stage" data-life-stage data-mind-avatar="'+LIFE_CHARACTERS.findIndex(c=>c.id===character.id)+'" data-phase="'+esc(card.phase??'idle')+'" data-body="'+esc(config.bodyVariant)+'" data-palette="'+esc(config.colorPalette)+'" data-eyes="'+esc(config.eyeVariant)+'" data-accessory="'+esc(config.accessory)+'" data-motion="'+esc(config.motionIntensity)+'" aria-hidden="true" data-life-view="'+(['portrait','hud'].includes(view)?view:'scene')+'" data-life-phase="'+esc(card.phase??'idle')+'" data-life-id="'+esc(card.executionMode+':'+card.profileId)+'" data-life-character="'+character.id+'" data-life-motion="'+esc(motion)+'" data-life-weather="'+esc(game.weather??'unknown')+'" data-life-rain="'+rain.intensity+'" data-life-loss-rate="'+(rain.lossRate??'')+'" data-life-appearance="'+esc(JSON.stringify(config))+'"><div class="mind-life-fallback"><span class="mind-life-loader" aria-hidden="true"><svg viewBox="0 0 32 32" fill="none" stroke="currentColor"><path d="M7 10h18v12H7zM12 15h1m6 0h1M13 19h6"/></svg></span></div><canvas role="img" aria-label="'+esc(character.name+' / '+(LIFE_ACTIONS.find(a=>a.id===motion)?.label??'대기'))+'"></canvas><span class="mind-life-weather" data-life-weather-label>'+esc(label[game.weather]??label.unknown)+'</span></div>';
}
export function renderLifeGallery(){
 const samples=[0,-430,340,820,1250,-120],cards=LIFE_CHARACTERS.map((character,i)=>{
  const pnl=samples[i],weather=pnl>0?'sunny':pnl<0?'rainy':'calm',card={profileId:'demo-'+character.id,executionMode:'paper',phase:'idle',currencies:[{currency:'KRW',initialCapital:30000}],appearance:{config:{bodyVariant:character.id,colorPalette:null,eyeVariant:'natural',accessory:'none',motionIntensity:'subtle'}},game:{status:'READY',motion:'idle',weather,currency:'KRW',todayRealizedPnl:String(pnl)}};
  return '<article class="mind-life-card" data-life-demo-card data-profile-id="'+card.profileId+'" data-motion="subtle" data-demo-pnl="'+pnl+'">'+renderLifeStage(card)+'<div class="mind-life-card-body"><h2>'+character.name+'</h2><p class="mind-life-card-status">대기 중</p><div class="mind-life-card-money"><span>실현 손익</span><strong data-life-pnl>'+((pnl>0?'+':'')+currencyAmount(pnl,'KRW'))+' KRW</strong></div></div></article>';
 }).join('');
 const total=180000+samples.reduce((a,b)=>a+b,0);
 return '<section class="mind-life-gallery" data-life-gallery><header class="mind-life-header"><div><h1>마인드 <span class="mind-life-mode">모의</span></h1><p>6개</p></div><div class="mind-life-total"><span>총 자산</span><strong data-mind-scoreboard="KRW" data-life-total>'+currencyAmount(total,'KRW')+'</strong><small>KRW</small></div></header><div class="mind-life-toolbar"><label class="mind-life-search">검색<input type="search" data-life-search aria-label="마인드 검색" placeholder="마인드 검색"></label><label>보기<select data-life-weather-mode><option value="minds">마인드</option><option value="rain">날씨 비교</option></select></label><label>활동<select data-life-action>'+LIFE_ACTIONS.map(a=>'<option value="'+a.id+'">'+a.label+'</option>').join('')+'</select></label>'+lifeSettings()+'</div><div class="mind-life-grid">'+cards+'</div><p class="mind-life-empty" data-life-empty hidden>검색 결과가 없습니다.</p></section>';
}

export function createMindLifeRuntime({environment=globalThis}={}){
 let root=null,states=[],request=null,lastTick=null,lastPaint=0,clock=0,disposed=false,paused=false,assetsPromise=null,assets=null,observer=null,resize=null,click=null,change=null,input=null;
 let settingsOpen=false,previewAction='auto',settingsDismiss=null,settingsFocus=null;
 const worlds=new Map(),imagePromises=new Map(),doc=environment.document;
 const reduced=environment.matchMedia?.('(prefers-reduced-motion: reduce)');
 try{paused=environment.localStorage?.getItem('cji-mind-animation')==='off';}catch{}
 const game=createMindGameRuntime({environment,onCredit:({receipt})=>{const s=states.find(s=>s.demoReceipt?.id===receipt.id);if(s&&!s.demoResultApplied){updateDemo(s.canvas.closest('[data-life-demo-card]'),receipt.amount);s.demoResultApplied=true;}},onSettlement:({card,receipt})=>{
  const s=states.find(s=>s.canvas.closest('[data-mind-companion]')===card);if(s){const key=s.key;enqueueLifeSettlement(s.life,receipt,()=>{const current=states.find(t=>t.key===key);if(current)game.presentSettlement(current.canvas.closest('[data-mind-companion]'),receipt,{motionOff:paused});});}
  else if(gameUnits(receipt.amount)>0n)game.presentSettlement(card,receipt);
 }});
 const loadImage=path=>{if(!imagePromises.has(path))imagePromises.set(path,new Promise((resolve,reject)=>{const image=new environment.Image();image.onload=()=>resolve(image);image.onerror=()=>reject(new Error('이미지를 불러오지 못했습니다.'));image.src=new URL(path,import.meta.url).href;}));return imagePromises.get(path);};
 function loadAssets(){
  assetsPromise??=Promise.all([environment.fetch(new URL('../assets/mind-garden-v3/atlas-layout.json',import.meta.url)).then(r=>{if(!r.ok)throw new Error('이미지를 불러오지 못했습니다.');return r.json();}),loadImage('../assets/mind-garden-v2/garden-sunny-cute.png'),loadImage('../assets/mind-garden-v2/garden-rainy-cute.png'),loadImage('../assets/mind-garden-v3/environment.png'),loadImage('../assets/mind-garden-v3/garden-storm.png')]).then(([layout,sunny,rainy,environment,storm])=>({layout,sunny,rainy,environment,storm}));return assetsPromise;
 }
 function updateDemo(card,amount){
  if(!card?.isConnected)return;const pnl=gameUnits(card.dataset.demoPnl)+gameUnits(amount);card.dataset.demoPnl=gameDecimal(pnl);
  card.querySelector('[data-life-pnl]').textContent=(pnl>0n?'+':'')+currencyAmount(Number(gameDecimal(pnl)),'KRW')+' KRW';
  const stage=card.querySelector('[data-life-stage]');stage.dataset.lifeWeather=pnl>0n?'sunny':pnl<0n?'rainy':'calm';
  const rain=mindRain({game:{status:'READY',weather:stage.dataset.lifeWeather,todayRealizedPnl:gameDecimal(pnl),currency:'KRW'},currencies:[{currency:'KRW',initialCapital:30000}]});stage.dataset.lifeRain=rain.intensity;stage.dataset.lifeLossRate=rain.lossRate??'';
  const total=180000n*10n**18n+[...root.querySelectorAll('[data-life-demo-card]')].reduce((sum,c)=>sum+gameUnits(c.dataset.demoPnl),0n);
  root.querySelector('[data-life-total]').textContent=currencyAmount(Number(gameDecimal(total)),'KRW');
 }
 function demoAction(action){
  for(const s of states){s.life.current=null;s.life.queue=[];s.life.mode=null;s.stage.dataset.lifePreviewAction=action==='auto'?'idle':action;
   if(['settle','loss','exit','reduce'].includes(action)){
    const card=s.canvas.closest('[data-life-demo-card]');if(!card)continue;
    const amount=action==='settle'?'1250':action==='loss'?'-430':'0',receipt={id:'demo-'+s.key+'-'+clock,amount,currency:'KRW',at:new Date().toISOString()};
    enqueueLifeSettlement(s.life,receipt,()=>game.presentSettlement(card,receipt,{motionOff:paused}));
    s.demoReceipt=receipt;s.demoResultApplied=false;s.stage.dataset.lifePreviewAction='idle';
   }
  }
 }
 function paint(){
  if(!assets)return;
  let audibleRain=0;
  for(const s of states){
   if(!s.atlas||!s.visible&&s.stage.dataset.ready==='true')continue;
   const off=paused||reduced?.matches||s.appearance.motionIntensity==='off';
   const pose=stepLife(s.life,clock,{motion:s.stage.dataset.lifePreviewAction??s.stage.dataset.lifeMotion,reduced:off});
   if(s.stage.closest('[data-mind-customization-preview]'))Object.assign(pose,{clip:'idle',event:'appearance',x:.5,facing:1,rest:false});
   if(s.width)s.ctx.setTransform(...lifeCamera(s.width,s.height,s.dpr,s.stage.dataset.lifeView,pose.x));
   if(s.demoReceipt&&!s.demoResultApplied&&pose.event==='settlement'&&pose.receipt&&gameUnits(s.demoReceipt.amount)<=0n){updateDemo(s.canvas.closest('[data-life-demo-card]'),s.demoReceipt.amount);s.demoResultApplied=true;}
   const target=Number(s.stage.dataset.lifeRain)||0;s.life.rainIntensity??=target;s.life.rainIntensity=off?target:s.life.rainIntensity+(target-s.life.rainIntensity)*.045;
   const frame=paintLivingMind(s.ctx,{assets:{...assets,atlas:s.atlas},layout:s.layout,pose,time:clock,phase:s.life.phase,weather:s.stage.dataset.lifeWeather,rainIntensity:s.life.rainIntensity,reduced:off,appearance:s.appearance});
   s.canvas.dataset.rainIntensity=s.life.rainIntensity.toFixed(3);s.canvas.dataset.rainDrops=frame.rain.streaks;s.canvas.dataset.rainSplashes=frame.rain.splashes;audibleRain=Math.max(audibleRain,target);
   s.canvas.dataset.lifeFrame=frame.row+':'+frame.col;s.canvas.dataset.lifeEvent=pose.event;s.stage.dataset.ready='true';
   const weatherLabel=s.stage.querySelector('[data-life-weather-label]');weatherLabel.textContent=s.stage.dataset.lifeWeather==='rainy'?rainLabel(target):(label[s.stage.dataset.lifeWeather]??label.unknown);weatherLabel.title=s.stage.dataset.lifeLossRate?'오늘 실현 손익 / 운용 자금 −'+(Number(s.stage.dataset.lifeLossRate)*100).toFixed(2)+'%':'';
   const demo=s.canvas.closest('[data-life-demo-card]');if(demo)demo.querySelector('.mind-life-card-status').textContent=pose.event==='settlement'?(pose.receipt?(Number(pose.receipt.amount)<0?'손실':Number(pose.receipt.amount)>0?'수익':'매도 완료'):'매도 중'):s.stage.dataset.lifePreviewAction&&s.stage.dataset.lifePreviewAction!=='idle'?(LIFE_ACTIONS.find(a=>a.id===s.stage.dataset.lifePreviewAction)?.label??'대기 중'):pose.rest?'휴식':({idle:'대기 중',walk:'이동',read:'검토',carry:'가져오기',sell:'정리'}[pose.clip]??'대기 중');
  }
  game.setRainIntensity(doc.hidden?0:audibleRain);
 }
 function tick(now){
  request=null;if(disposed)return;
  if(lastTick!==null&&!doc.hidden&&!paused)clock+=Math.min(now-lastTick,100);lastTick=now;
  if(now-lastPaint>=40){paint();lastPaint=now;}
  if(!doc.hidden&&!paused&&!reduced?.matches&&states.some(s=>s.visible))request=environment.requestAnimationFrame(tick);
 }
 function resume(){if(disposed||!assets||request!==null)return;lastTick=null;request=environment.requestAnimationFrame(tick);}
 function unmount(){
  game.setRainIntensity(0);game.unmount();if(settingsDismiss){for(const [name,handler]of Object.entries(settingsDismiss))doc?.removeEventListener?.(name,handler,true);settingsDismiss=null;}if(root){const settings=root.querySelector?.('.mind-life-settings');if(settings){settingsOpen=settings.open;const active=doc?.activeElement,selector=settings.contains?.(active)&&['summary','[data-life-animations]','[data-game-sound]'].find(selector=>active?.matches?.(selector));settingsFocus=selector?{selector,route:environment.location?.hash}:null;}root.removeEventListener?.('click',click);root.removeEventListener?.('change',change);root.removeEventListener?.('input',input);}resize?.disconnect();observer?.disconnect();if(request!==null)environment.cancelAnimationFrame?.(request);request=null;root=null;states=[];lastTick=null;
 }
 function mount(next){
  unmount();root=next;if(!next?.querySelectorAll||typeof next.addEventListener!=='function')return;
  const settings=next.querySelector?.('.mind-life-settings'),action=next.querySelector?.('[data-life-action]');if(settings)settings.open=settingsOpen;if(action)action.value=previewAction;
  if(settings){
   const closeSettings=(restoreFocus=false)=>{if(!settings.open)return;settings.open=false;settingsOpen=false;if(restoreFocus)settings.querySelector('summary')?.focus();};
   settingsDismiss={
    pointerdown(event){if(!settings.contains(event.target))closeSettings();},
    focusin(event){if(!settings.contains(event.target))closeSettings();},
    keydown(event){if(event.key!=='Escape'||event.isComposing||event.keyCode===229||!settings.open||!settings.contains(event.target))return;event.preventDefault();event.stopPropagation();closeSettings(true);},
   };
   for(const [name,handler]of Object.entries(settingsDismiss))doc?.addEventListener?.(name,handler,true);
  }
  const focus=settingsFocus;settingsFocus=null;
  const restoreSettingsFocus=()=>{if(focus&&settings&&focus.route===environment.location?.hash&&(!doc?.activeElement||doc.activeElement===doc.body||!doc.activeElement.isConnected))settings.querySelector(settings.open?focus.selector:'summary')?.focus({preventScroll:true});};
  change=event=>{
   if(event.target.matches('[data-life-animations]')){paused=!event.target.checked;try{environment.localStorage?.setItem('cji-mind-animation',paused?'off':'on');}catch{}paint();resume();}
   if(event.target.matches('[data-life-action]')){previewAction=event.target.value;demoAction(previewAction);paint();resume();}
   if(event.target.matches('[data-life-weather-mode]')){const values=event.target.value==='rain'?[-30,-150,-450,-900,-1500,-2400]:[0,-430,340,820,1250,-120];states.forEach((s,i)=>{s.life.current=null;s.life.queue=[];s.demoReceipt=null;const card=s.canvas.closest('[data-life-demo-card]');if(card)updateDemo(card,gameDecimal(gameUnits(values[i])-gameUnits(card.dataset.demoPnl)));});paint();resume();}
  };
  input=event=>{if(!event.target.matches('[data-life-search]'))return;const query=event.target.value.trim().toLocaleLowerCase();let count=0;for(const card of root.querySelectorAll('[data-life-demo-card]')){card.hidden=!card.querySelector('h2').textContent.toLocaleLowerCase().includes(query);if(!card.hidden)count++;}root.querySelector('[data-life-empty]').hidden=count>0;};
  click=()=>resume();next.addEventListener('change',change);next.addEventListener('input',input);next.addEventListener('click',click);
  for(const control of next.querySelectorAll('[data-life-animations]'))control.checked=!paused;
  if(typeof environment.Image!=='function'||typeof environment.requestAnimationFrame!=='function'){game.mount(next);restoreSettingsFocus();return;}
  for(const canvas of next.querySelectorAll('[data-life-stage] canvas')){
   const stage=canvas.closest('[data-life-stage]'),key=stage.dataset.lifeId;let life=worlds.get(key);if(!life){life=createLife(key,{now:clock});worlds.set(key,life);}
   let appearance={};try{appearance=JSON.parse(stage.dataset.lifeAppearance);}catch{}
   states.push({key,canvas,ctx:canvas.getContext('2d'),stage,life,appearance,visible:true,atlas:null,layout:null});
  }
  if(action)for(const s of states)s.stage.dataset.lifePreviewAction=['settle','loss','exit','reduce','auto'].includes(previewAction)?'idle':previewAction;
  game.mount(next);restoreSettingsFocus();
  resize=new environment.ResizeObserver(entries=>{for(const entry of entries){const s=states.find(s=>s.canvas===entry.target);if(!s)continue;s.width=Math.max(1,entry.contentRect.width);s.height=Math.max(1,entry.contentRect.height);s.dpr=Math.min(environment.devicePixelRatio||1,2);s.canvas.width=Math.round(s.width*s.dpr);s.canvas.height=Math.round(s.height*s.dpr);delete s.stage.dataset.ready;}paint();});
  observer=new environment.IntersectionObserver(entries=>{for(const entry of entries){const s=states.find(s=>s.canvas===entry.target);if(s)s.visible=entry.isIntersecting;}resume();});
  for(const s of states){resize.observe(s.canvas);observer.observe(s.canvas);}
  loadAssets().then(async value=>{
   if(disposed||root!==next)return;assets=value;
   await Promise.all(states.map(async s=>{s.layout=assets.layout.characters.find(c=>c.id===s.stage.dataset.lifeCharacter);if(!s.layout)throw new Error('캐릭터를 불러오지 못했습니다.');s.atlas=await loadImage('../assets/mind-garden-v3/'+s.layout.src);if(s.atlas.naturalWidth!==s.layout.width||s.atlas.naturalHeight!==s.layout.height)throw new Error('이미지 크기를 확인하세요.');}));
   if(root===next&&!disposed){paint();resume();}
  }).catch(error=>{if(root===next)for(const s of states)s.stage.dataset.error=error.message;});
 }
 const visibility=()=>{if(doc?.hidden){game.setRainIntensity(0);if(request!==null)environment.cancelAnimationFrame?.(request);request=null;lastTick=null;}else resume();};
 doc?.addEventListener?.('visibilitychange',visibility);reduced?.addEventListener?.('change',resume);
 return {mount,unmount,destroy(){disposed=true;unmount();game.destroy();worlds.clear();doc?.removeEventListener?.('visibilitychange',visibility);reduced?.removeEventListener?.('change',resume);}};
}

