import {lifeFrame} from '../domain/mind-life.mjs';
import {paintLifeAppearance} from './mind-life-appearance.mjs';

export function lifeCamera(width,height,dpr,view,position=.5){
 const span=view==='hud'?Math.min(768,512*width/height):view==='portrait'?Math.min(768,Math.max(320,210*width/height)):768,scale=width*dpr/span;
 return [scale,0,0,scale,-Math.max(0,Math.min(768-span,position*768-span/2))*scale,-Math.max(0,397-height/width*span*.88)*scale];
}

const noise=n=>{const v=Math.sin(n*127.1+311.7)*43758.5453;return v-Math.floor(v);};
function prop(ctx,image,index,x,y,width,height,rotation=0,alpha=1){
 const sw=image.naturalWidth/3,sh=image.naturalHeight/2;
 ctx.save();ctx.translate(x,y);ctx.rotate(rotation);ctx.globalAlpha=alpha;
 ctx.drawImage(image,index%3*sw,Math.floor(index/3)*sh,sw,sh,-width/2,-height,width,height);ctx.restore();
}
function scenery(ctx,assets,time,phase,weather,reduced,rain){
 ctx.drawImage(weather==='rainy'?assets.rainy:assets.sunny,0,0,768,512);
 if(weather==='rainy'&&assets.storm){ctx.save();ctx.globalAlpha=Math.min(1,rain*1.1);ctx.drawImage(assets.storm,0,0,768,512);ctx.restore();}
 const wind=reduced?0:(Math.sin(time/7100+phase)*.019+Math.sin(time/19300+phase*.3)*.014)*(1+rain*3)+Math.sin(time/2900+phase)*rain*.018;
 ctx.save();if(rain)ctx.filter=`brightness(${1-rain*.45}) saturate(${1-rain*.25})`;
 prop(ctx,assets.environment,0,70,138,160,154,wind,.9);
 prop(ctx,assets.environment,1,740,140,155,145,-wind*.8,.85);
 prop(ctx,assets.environment,2,700,407,74,105,wind*1.7,.95);
 prop(ctx,assets.environment,3,80,405,66,62,-wind*1.4,.9);
 ctx.restore();
 if(rain){
  ctx.save();const shade=ctx.createLinearGradient(0,0,0,420);shade.addColorStop(0,`rgba(9,20,42,${rain*.35})`);shade.addColorStop(1,`rgba(16,32,48,${rain*.08})`);ctx.fillStyle=shade;ctx.fillRect(0,0,768,512);ctx.restore();
 }
 if(reduced)return;
 prop(ctx,assets.environment,4,100+(time/390+phase*100)%700,145,240,130,0,weather==='rainy'?.18:.12);
 if(weather==='sunny'){
  const strength=.035+Math.max(0,Math.sin(time/23000+phase))*.12;
  ctx.save();ctx.globalCompositeOperation='screen';ctx.globalAlpha=strength;
  const glow=ctx.createLinearGradient(700,0,230,440);glow.addColorStop(0,'#fff4bd');glow.addColorStop(1,'rgba(255,228,155,0)');ctx.fillStyle=glow;
  ctx.beginPath();ctx.moveTo(530,0);ctx.lineTo(730,0);ctx.lineTo(440+Math.sin(time/17000)*24,450);ctx.lineTo(230,450);ctx.closePath();ctx.fill();ctx.restore();
 }
 for(let i=0;i<3;i++){
  const p=(time/(25000+i*7100)+noise(i+phase))%1;
  prop(ctx,assets.environment,5,80+p*700,80+p*350,14,17,Math.sin(p*14+phase)*.8,.55);
 }
}
export function rainParticle(index,time,phase,intensity,layer){
 const seed=index+layer*197+phase,depth=[.5,.82,1.25][layer],fall=(680+noise(seed)*650)/depth,gap=(80+noise(seed+8)*900)*(1-intensity*.85),splash=340+noise(seed+2)*440,period=fall+gap+splash;
 const shifted=time+noise(seed+3)*period,cycle=Math.floor(shifted/period),age=shifted%period,site=seed+cycle*13.37;
 const surface=layer===2?'ground':noise(site+10)<.26?'roof':noise(site+11)<.46?'water':'ground';
 const hitX=surface==='roof'?28+noise(site+12)*215:surface==='water'?545+noise(site+12)*175:245+noise(site+12)*520;
 const hitY=surface==='roof'?139+Math.abs(hitX-132)*.14:surface==='water'?334+noise(site+13)*26:392+noise(site+13)*13;
 const gust=Math.sin(time/5100+phase)*.22+Math.sin(time/17300+phase*.7)*.15,slant=.08+intensity*.24+gust*intensity,speed=(hitY+65)/fall;
 return {surface,depth,hitX,hitY,x:hitX-(age-fall)*speed*slant,y:hitY+(age-fall)*speed,slant,speed,age,fall,splash,gap,seed:site,impact:age>=fall&&age<fall+splash,falling:age<fall};
}
function rainLayer(ctx,time,phase,intensity,layer){
 const count=Math.round([35,48,22][layer]+[85,95,115][layer]*intensity),stats={streaks:0,splashes:0};
 ctx.save();ctx.lineCap='round';
 for(let i=0;i<count;i++){
  const p=rainParticle(i,time,phase,intensity,layer),alpha=(.28+intensity*.48)*[.48,.8,1][layer];
  if(p.falling){
   if(p.y<0||p.y>p.hitY||p.x<0||p.x>768||p.x<245&&p.y>175)continue;
   const length=(9+intensity*(layer===2?29:18)+noise(p.seed+4)*12)*p.depth,tailX=p.x+length*p.slant;
   const streak=ctx.createLinearGradient(tailX,p.y-length,p.x,p.y);streak.addColorStop(0,'rgba(180,215,240,0)');streak.addColorStop(.7,`rgba(180,215,240,${alpha*.5})`);streak.addColorStop(1,`rgba(219,239,255,${alpha})`);
   ctx.strokeStyle=streak;ctx.lineWidth=(.65+intensity*(layer===2?.85:.45))*p.depth;ctx.beginPath();ctx.moveTo(tailX,p.y-length);ctx.lineTo(p.x,p.y);ctx.stroke();stats.streaks++;
  }else if(p.impact){
   const t=(p.age-p.fall)/p.splash,fade=(1-t)*(1-t),water=p.surface==='water',radius=(2+t*(water?17:8))*p.depth;
   ctx.strokeStyle=`rgba(192,224,247,${fade*alpha*.85})`;ctx.lineWidth=.8*p.depth;ctx.beginPath();ctx.ellipse(p.hitX,p.hitY,radius,radius*(water?.23:.12),0,0,Math.PI*2);ctx.stroke();
   if(t<.6){
    const jump=Math.sin(t/.6*Math.PI)*(4+intensity*10)*p.depth;
    for(let d=0;d<3;d++){const spread=(d-1)*(3+t*12)*p.depth,x=p.hitX+spread-t*intensity*8,y=p.hitY-jump*(.6+noise(p.seed+d)*.5);ctx.strokeStyle=`rgba(215,237,251,${fade*alpha})`;ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x+spread*.08,y+1.8*p.depth);ctx.stroke();}
   }
   stats.splashes++;
  }
 }
 ctx.restore();return stats;
}
function wetGround(ctx,time,phase,intensity,reduced){
 ctx.save();
 for(let i=0;i<7;i++){
  const x=270+noise(i+51)*450,y=394+noise(i+63)*10,w=12+noise(i+71)*30;
  ctx.fillStyle=`rgba(104,151,177,${intensity*.21})`;ctx.beginPath();ctx.ellipse(x,y,w,1.7+intensity*1.6,0,0,Math.PI*2);ctx.fill();
  ctx.strokeStyle=`rgba(224,237,243,${intensity*(.1+(reduced?0:Math.sin(time/1800+phase+i)*.04))})`;ctx.lineWidth=.8;ctx.beginPath();ctx.ellipse(x,y,w*.75,1.1,0,0,Math.PI);ctx.stroke();
 }
 if(intensity>.55){const mist=ctx.createLinearGradient(0,370,0,407);mist.addColorStop(0,'rgba(154,185,205,0)');mist.addColorStop(.65,`rgba(154,185,205,${(intensity-.55)*.22})`);mist.addColorStop(1,'rgba(154,185,205,0)');ctx.fillStyle=mist;ctx.fillRect(245,370,523,42);}
 ctx.restore();
}
export function paintLivingMind(ctx,{assets,layout,pose,time=0,phase=0,weather='unknown',rainIntensity=.32,reduced=false,appearance={}}){
 const rain=weather==='rainy'?Math.max(0,Math.min(1,rainIntensity)):0,stats={streaks:0,splashes:0};
 ctx.clearRect(0,0,768,512);ctx.imageSmoothingEnabled=true;scenery(ctx,assets,time,phase,weather,reduced,rain);
 if(rain){wetGround(ctx,time,phase,rain,reduced);if(!reduced)for(const layer of [0,1]){const value=rainLayer(ctx,time,phase,rain,layer);stats.streaks+=value.streaks;stats.splashes+=value.splashes;}}
 const frame=lifeFrame(layout,pose,{reduced}),size=185,scale=size/frame.unit,x=pose.x*768,ground=397;
 const jump=pose.clip==='profit'&&!reduced?Math.sin(Math.min(1,pose.elapsed/1500)*Math.PI)*9:0;
 ctx.fillStyle='rgba(74,70,42,.18)';ctx.beginPath();ctx.ellipse(x,ground-1,36-jump*.4,5,0,0,Math.PI*2);ctx.fill();
 const breath=pose.clip==='idle'&&!reduced?Math.sin((time+phase)/1600)*.012:0;
 ctx.save();ctx.translate(x,ground-jump);ctx.scale(pose.facing*(1-breath*.5),1+breath);
 const hue={blue:210,amber:40,violet:280,sage:120}[appearance.colorPalette],base={cat:25,rabbit:35,frog:90,blob:200,pear:50,heart:5}[layout.id];
 if(hue!==undefined)ctx.filter=`hue-rotate(${hue-base}deg)`;
 ctx.drawImage(assets.atlas,frame.x,frame.y,frame.width,frame.height,(frame.x-frame.col*frame.unit-frame.unit/2)*scale,-frame.baseline*scale,frame.width*scale,frame.height*scale);
 ctx.translate((frame.x-frame.col*frame.unit-frame.unit/2)*scale,-frame.baseline*scale);ctx.scale(scale,scale);paintLifeAppearance(ctx,layout,frame,appearance);ctx.restore();
 if(rain&&!reduced){const value=rainLayer(ctx,time,phase,rain,2);stats.streaks+=value.streaks;stats.splashes+=value.splashes;}
 if(pose.receipt&&Number(pose.receipt.amount)<0){ctx.save();ctx.globalAlpha=Math.max(0,1-pose.elapsed/3600);ctx.font='600 25px sans-serif';ctx.textAlign='center';ctx.fillStyle='#a44641';ctx.fillText(Number(pose.receipt.amount).toLocaleString('ko-KR',{maximumFractionDigits:2})+' '+pose.receipt.currency,x,ground-150+Math.min(18,pose.elapsed/120));ctx.restore();}
 return {...frame,rain:stats};
}
