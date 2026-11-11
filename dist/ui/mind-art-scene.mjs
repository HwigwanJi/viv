export const ART_CLIPS=Object.freeze({idle:{row:0,fps:5,loop:true},scan:{row:1,fps:8,loop:true},think:{row:2,fps:5,loop:true},settle:{row:3,fps:8,loop:false}});
export const ART_BASELINES=Object.freeze([246,230,214,202]);
export function artFrame(motion,elapsed,{reduced=false}={}){
 const clip=ART_CLIPS[motion];if(!clip)throw new RangeError('Unknown art clip');
 if(!Number.isFinite(elapsed)||elapsed<0)throw new RangeError('Invalid elapsed time');
 const step=reduced?0:Math.floor(elapsed*clip.fps/1000),col=clip.loop?step%6:Math.min(step,5);
 return {row:clip.row,col,sx:col*256,sy:clip.row*256,width:256,height:256,baseline:ART_BASELINES[clip.row]};
}
const noise=n=>{const v=Math.sin(n*127.1+311.7)*43758.5453;return v-Math.floor(v);};
function rain(ctx,time,front){
 const count=front?30:62;ctx.lineCap='round';
 for(let i=0;i<count;i++){
  const seed=i+(front?190:0),depth=front?1:.58,speed=(160+noise(seed+4)*160)*depth;
  const x=noise(seed+12)*860-40-(time*.018*depth)%100,y=(noise(seed+1)*600+time*speed/1000)%590-40;
  // The left workbench is under the roof, so this region receives no falling drops.
  if(x<235&&y<308)continue;
  ctx.strokeStyle=front?'rgba(220,235,244,.44)':'rgba(194,219,232,.23)';ctx.lineWidth=front?1.3:.75;
  ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x-3*depth,y+10*depth);ctx.stroke();
 }
}
function surfaceImpacts(ctx,time){
 for(let i=0;i<24;i++){
  const phase=(time/900+noise(i+190))%1,water=i<10;
  const x=water?535+noise(i+800)*180:225+noise(i+840)*510,y=water?330+noise(i+81)*36:391+noise(i+90)*12;
  ctx.strokeStyle=`rgba(202,226,235,${(1-phase)*(water?.4:.28)})`;ctx.lineWidth=.8;
  ctx.beginPath();ctx.ellipse(x,y,1+phase*(water?10:4),.5+phase*(water?2.5:1.2),0,0,Math.PI*2);ctx.stroke();
  if(!water&&phase<.25){ctx.beginPath();ctx.moveTo(x-2,y-1);ctx.lineTo(x-3,y-3);ctx.moveTo(x+2,y-1);ctx.lineTo(x+3,y-3);ctx.stroke();}
 }
}
export function paintMindArt(ctx,{sunny,rainy,atlas,motion,weather,time,elapsed,reduced=false}){
 const frame=artFrame(motion,elapsed,{reduced});ctx.clearRect(0,0,768,512);ctx.imageSmoothingEnabled=true;
 ctx.drawImage(weather==='rainy'?rainy:sunny,0,0,768,512);
 if(!reduced&&weather==='rainy'){rain(ctx,time,false);surfaceImpacts(ctx,time);}
 if(!reduced&&weather==='sunny'){
  for(let i=0;i<12;i++){const x=(noise(i+4)*768+time*.006)%768,y=90+noise(i+40)*300+Math.sin(time*.0008+i)*9;ctx.fillStyle=`rgba(255,242,178,${.25+noise(i+100)*.4})`;ctx.beginPath();ctx.arc(x,y,noise(i+80)*1.2+.6,0,Math.PI*2);ctx.fill();}
 }
 const walk=motion==='scan'&&!reduced?Math.sin(elapsed/3600)*32:0,x=384+walk,foot=397,size=190;
 ctx.fillStyle='rgba(43,37,23,.25)';ctx.beginPath();ctx.ellipse(x+3,foot-1,45,7,0,0,Math.PI*2);ctx.fill();
 ctx.imageSmoothingEnabled=false;ctx.drawImage(atlas,frame.sx,frame.sy,256,256,x-size/2,foot-frame.baseline/256*size,size,size);
 if(!reduced&&weather==='rainy')rain(ctx,time,true);
 return frame;
}
