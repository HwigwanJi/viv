import {LIFE_FACE_ANCHORS} from './mind-life-anchors.mjs';

export function paintLifeAppearance(ctx,layout,frame,appearance){
 const anchor=LIFE_FACE_ANCHORS[layout.id]?.frames[frame.row*6+frame.col];
 if(!anchor)throw new Error('캐릭터 표정 위치를 확인하세요.');
 const eyes=appearance.eyeVariant??'natural',accessory=appearance.accessory??'none';
 const [[lx,ly],[rx,ry]]=anchor.eyes,distance=Math.hypot(rx-lx,ry-ly),angle=Math.atan2(ry-ly,rx-lx);
 ctx.save();ctx.lineCap='round';ctx.lineJoin='round';
 for(const [x,y,w,h,skin,closed] of anchor.eyes){
  if(eyes==='focused'){
   const side=x===lx?1:-1;ctx.strokeStyle='#49352b';ctx.lineWidth=2.6;ctx.beginPath();ctx.moveTo(x-w*.65,y-h*.65-4-side*2);ctx.quadraticCurveTo(x,y-h*.65-6,x+w*.65,y-h*.65-4+side*2);ctx.stroke();
  }else if(eyes==='sleepy'&&!closed){
   ctx.save();ctx.beginPath();ctx.ellipse(x,y,w*.66,h*.68,0,0,Math.PI*2);ctx.clip();ctx.fillStyle=skin;ctx.fillRect(x-w,y-h,w*2,h*1.12);ctx.strokeStyle='#674932';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(x-w*.65,y+h*.12);ctx.quadraticCurveTo(x,y+h*.22,x+w*.65,y+h*.12);ctx.stroke();ctx.restore();
  }
 }
 ctx.filter='none';
 if(accessory==='glasses'||accessory==='sunglasses'){
  const radius=distance*.36;
  ctx.strokeStyle='#503d2a';ctx.lineWidth=2.4;
  for(const [i,[x,y]] of anchor.eyes.entries()){
   const r=radius*(i===0?1:.83);ctx.save();ctx.translate(x,y);ctx.rotate(angle);
   ctx.beginPath();ctx.ellipse(0,0,r,r*1.04,0,0,Math.PI*2);ctx.fillStyle=accessory==='glasses'?'rgba(255,249,218,.12)':'#26303c';ctx.fill();ctx.stroke();
   ctx.strokeStyle=accessory==='glasses'?'#d7b46a':'#9fbed5';ctx.lineWidth=1.1;ctx.beginPath();ctx.ellipse(0,0,r-1.7,r*1.04-1.7,0,Math.PI,Math.PI*1.68);ctx.stroke();
   ctx.strokeStyle=accessory==='glasses'?'rgba(255,255,245,.8)':'#c0dce8';ctx.lineWidth=1.8;ctx.beginPath();ctx.moveTo(-r*.48,-r*.36);ctx.lineTo(r*.1,-r*.63);ctx.stroke();ctx.restore();
  }
  ctx.beginPath();ctx.moveTo(lx+Math.cos(angle)*radius,ly+Math.sin(angle)*radius);ctx.quadraticCurveTo((lx+rx)/2,(ly+ry)/2-radius*.36,rx-Math.cos(angle)*radius*.83,ry-Math.sin(angle)*radius*.83);ctx.stroke();
 }else if(accessory==='bowtie'&&anchor.neckVisible){
  const [x,y,width]=anchor.neck;ctx.save();ctx.translate(x,y);ctx.rotate(angle);ctx.fillStyle='#bb4e50';ctx.strokeStyle='#703c32';ctx.lineWidth=1.5;
  ctx.beginPath();ctx.moveTo(0,-2);ctx.bezierCurveTo(-width*.25,-width*.45,-width*.64,-width*.36,-width*.5,width*.2);ctx.quadraticCurveTo(-width*.4,width*.4,0,2);ctx.bezierCurveTo(width*.4,width*.4,width*.64,width*.22,width*.5,-width*.28);ctx.quadraticCurveTo(width*.38,-width*.45,0,-2);ctx.fill();ctx.stroke();
  ctx.fillStyle='#e89486';ctx.beginPath();ctx.ellipse(0,0,width*.12,width*.16,0,0,Math.PI*2);ctx.fill();ctx.restore();
 }
 ctx.restore();
 return {eyes,accessory,visible:accessory!=='bowtie'||anchor.neckVisible};
}
