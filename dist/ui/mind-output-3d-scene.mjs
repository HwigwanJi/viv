import * as THREE from 'three';
import {mindAvatarIdentity} from './mind-avatar.mjs';
import {cssToken,numberToken} from './design-tokens.mjs';

const BODIES=['blob','pear','heart','frog','cat','rabbit'],COLORS=['blue','amber','violet','sage'];
const EYES=['natural','focused','sleepy'],ACCESSORIES=['none','glasses','sunglasses','bowtie'];
const PHASES=['idle','sleep','observing','investing','clutch','attention'];
const choose=(value,allowed,fallback)=>allowed.includes(value)?value:fallback;

export function resolveMindOutputAppearance(identity='',config=null){
 const defaults=mindAvatarIdentity(identity).config,value=config&&typeof config==='object'?config:{};
 return {bodyVariant:choose(value.bodyVariant,BODIES,defaults.bodyVariant),colorPalette:choose(value.colorPalette,COLORS,defaults.colorPalette),eyeVariant:choose(value.eyeVariant,EYES,defaults.eyeVariant),accessory:choose(value.accessory,ACCESSORIES,defaults.accessory),motionIntensity:value.motionIntensity==='off'?'off':'subtle'};
}
export function mindOutputPhase(state){return choose(typeof state==='string'?state:state?.phase,PHASES,'idle');}

export function mindOutputVisualTokens(element){
 const read=name=>cssToken('--companion-'+name,element);
 const palettes=Object.fromEntries(COLORS.map(name=>[name,Object.fromEntries(['light','base','shade'].map(tone=>[tone,read(name+'-'+tone)]))]));
 const positive=name=>{const value=numberToken(name,element);if(!(value>0))throw new TypeError('Positive design token required: '+name);return value;};
 return {palettes,face:read('face'),sleepEyes:read('sleep-eyes'),glasses:read('glasses'),sunglasses:read('sunglasses'),sunglassesShine:read('sunglasses-shine'),bowtie:read('bowtie'),bowtieKnot:read('bowtie-knot'),mouth:read('mouth'),shine:read('shine'),shadow:read('shadow'),turnSeconds:positive('--mind-output-3d-turn-seconds'),floatSeconds:positive('--mind-output-3d-float-period-seconds'),maxPixelRatio:positive('--mind-output-3d-max-pixel-ratio')};
}

// The familiar outline is inflated into a closed front-and-back surface. Every
// ring has real depth; no portrait, sprite, or image texture is used by the mesh.
function outlineFor(body){
 const s=new THREE.Shape();
 if(body==='blob')s.moveTo(40,77).bezierCurveTo(29,58,44,32,65,34).bezierCurveTo(73,22,97,23,104,39).bezierCurveTo(126,40,135,64,122,80).bezierCurveTo(130,103,115,124,94,119).bezierCurveTo(76,132,51,123,49,108).bezierCurveTo(30,103,26,87,40,77);
 if(body==='pear')s.moveTo(58,41).bezierCurveTo(65,22,89,22,101,43).lineTo(128,94).bezierCurveTo(139,119,115,133,95,124).bezierCurveTo(84,120,77,120,65,125).bezierCurveTo(42,133,23,115,34,92).lineTo(58,41);
 if(body==='heart')s.moveTo(80,45).bezierCurveTo(56,14,27,34,29,61).bezierCurveTo(31,88,54,120,80,132).bezierCurveTo(107,120,130,86,131,61).bezierCurveTo(132,34,102,14,80,45);
 if(body==='frog')s.moveTo(40,64).bezierCurveTo(24,37,49,22,65,39).bezierCurveTo(73,37,87,37,96,39).bezierCurveTo(113,22,137,39,120,64).bezierCurveTo(140,84,130,116,108,121).bezierCurveTo(93,131,65,130,50,120).bezierCurveTo(27,111,21,83,40,64);
 if(body==='cat')s.moveTo(38,68).lineTo(35,24).quadraticCurveTo(39,19,61,40).quadraticCurveTo(80,33,101,40).quadraticCurveTo(123,19,127,25).lineTo(123,69).quadraticCurveTo(142,103,115,122).quadraticCurveTo(80,139,44,121).quadraticCurveTo(20,103,38,68);
 if(body==='rabbit')s.moveTo(48,58).quadraticCurveTo(25,7,44,7).quadraticCurveTo(59,9,66,48).quadraticCurveTo(80,42,94,48).quadraticCurveTo(102,8,117,7).quadraticCurveTo(137,9,112,58).quadraticCurveTo(139,74,130,102).quadraticCurveTo(121,130,80,129).quadraticCurveTo(39,130,30,102).quadraticCurveTo(21,74,48,58);
 const points=s.getSpacedPoints(80).slice(0,-1).map(p=>new THREE.Vector2((p.x-80)/60,(80-p.y)/60));
 if(THREE.ShapeUtils.area(points)<0)points.reverse();
 return points;
}

export function createMindBodyGeometry(body='blob'){
 const variant=choose(body,BODIES,'blob'),outline=outlineFor(variant),count=outline.length,rings=19,depth=variant==='pear'?.66:variant==='heart'?.56:.62;
 const positions=[0,0,depth],indices=[];
 for(let ring=1;ring<=rings;ring++){
  const angle=Math.PI*ring/(rings+1),radius=Math.sin(angle),z=depth*Math.cos(angle);
  for(const point of outline)positions.push(point.x*radius,point.y*radius,z);
 }
 const back=positions.length/3;positions.push(0,0,-depth);
 for(let i=0;i<count;i++){
  const next=(i+1)%count;indices.push(0,1+i,1+next);
  for(let ring=0;ring<rings-1;ring++){const a=1+ring*count+i,b=1+ring*count+next,c=a+count,d=b+count;indices.push(a,c,b,b,c,d);}
  const a=1+(rings-1)*count+i,b=1+(rings-1)*count+next;indices.push(a,back,b);
 }
 const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setIndex(indices);geometry.computeVertexNormals();geometry.computeBoundingBox();geometry.computeBoundingSphere();geometry.userData={bodyVariant:variant,closedVolume:true};return geometry;
}

const material=color=>new THREE.MeshStandardMaterial({color,roughness:.4,metalness:.02});
function sphere(group,name,at,scale,color){const mesh=new THREE.Mesh(new THREE.SphereGeometry(1,16,10),material(color));mesh.name=name;mesh.position.set(...at);mesh.scale.set(...scale);group.add(mesh);return mesh;}
function tube(group,name,points,radius,color){const mesh=new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points),Math.max(12,points.length*3),radius,6,false),material(color));mesh.name=name;group.add(mesh);return mesh;}

export function createMindOutputScene({identity='',config=null,state='idle',tokens}={}){
 const appearance=resolveMindOutputAppearance(identity,config),phase=mindOutputPhase(state),palette=tokens.palettes[appearance.colorPalette];
 const scene=new THREE.Scene(),character=new THREE.Group();character.name='mind-character';character.userData={identity:String(identity),appearance};scene.add(character);
 const bodyGeometry=createMindBodyGeometry(appearance.bodyVariant),position=bodyGeometry.getAttribute('position'),colors=[];
 const light=new THREE.Color(palette.light),base=new THREE.Color(palette.base),shade=new THREE.Color(palette.shade);
 for(let i=0;i<position.count;i++){const y=position.getY(i),x=position.getX(i),t=THREE.MathUtils.clamp((y+.9)/1.8,0,1),color=t>.45?base.clone().lerp(light,(t-.45)*1.1):shade.clone().lerp(base,t/.45);color.lerp(light,Math.max(0,-x)*.12);colors.push(color.r,color.g,color.b);}
 bodyGeometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));
 const body=new THREE.Mesh(bodyGeometry,new THREE.MeshPhysicalMaterial({vertexColors:true,roughness:.36,metalness:.02,clearcoat:.15,clearcoatRoughness:.38}));body.name='mind-body';character.add(body);body.updateMatrixWorld(true);
 const ray=new THREE.Raycaster(),front=(x,y,lift=.025)=>{ray.set(new THREE.Vector3(x,y,3),new THREE.Vector3(0,0,-1));return ray.intersectObject(body,false)[0]?.point.z+lift;};
 const point=(x,y,lift=.025)=>{const px=(x-80)/60,py=(80-y)/60,z=front(px,py,lift);return new THREE.Vector3(px,py,Number.isFinite(z)?z:.5);};
 const face=new THREE.Group(),openEyes=new THREE.Group(),closedEyes=new THREE.Group(),accessories=new THREE.Group(),brows=new THREE.Group(),mouth=new THREE.Group();face.name='mind-face';openEyes.name='open-eyes';closedEyes.name='closed-eyes';accessories.name='face-accessories';brows.name='focused-brows';mouth.name='mouth';face.add(openEyes,closedEyes,accessories,brows,mouth);character.add(face);
 const frogEyes=appearance.bodyVariant==='frog'&&!['glasses','sunglasses'].includes(appearance.accessory);
 const eyes=frogEyes?[[57,56],[104,56]]:[[65,72],[95,72]];
 for(const [index,[x,y]] of eyes.entries()){
  const p=point(x,y,.035);sphere(openEyes,'eye-'+index,p.toArray(),frogEyes?[.09,.105,.045]:[.062,.094,.038],tokens.face);
  sphere(openEyes,'eye-highlight-'+index,[p.x-.013,p.y+.025,p.z+.034],[.012,.017,.012],tokens.shine);
  tube(closedEyes,'closed-eye-'+index,[point(x-6,y),point(x,y+3),point(x+6,y)],.017,tokens.sleepEyes);
  tube(brows,'brow-'+index,[point(x-6,y-7,.045),point(x+6,y-4,.045)],.019,tokens.face);
 }
 const smile=tube(mouth,'smile',[point(76,87),point(80,89),point(84,87)],.013,tokens.mouth);
 const worried=tube(mouth,'worried',[point(76,90),point(80,87),point(84,90)],.013,tokens.mouth);
 if(appearance.accessory==='glasses'||appearance.accessory==='sunglasses'){
  const dark=appearance.accessory==='sunglasses',color=dark?tokens.sunglasses:tokens.glasses;
  for(const [index,x]of [64,96].entries()){
   if(dark){const p=point(x,71,.065);sphere(accessories,'sunglass-lens-'+index,p.toArray(),[.19,.19,.055],color);tube(accessories,'lens-shine-'+index,[new THREE.Vector3(p.x-.09,p.y+.065,p.z+.052),new THREE.Vector3(p.x-.015,p.y+.095,p.z+.057)],.013,tokens.sunglassesShine);}
   else{const points=Array.from({length:33},(_,i)=>{const angle=2*Math.PI*i/32;return point(x+11*Math.cos(angle),72+14*Math.sin(angle),.06);});tube(accessories,'glasses-frame-'+index,points,.021,color);}
  }
  tube(accessories,'glasses-bridge',[point(75,71,.08),point(80,69,.08),point(85,71,.08)],.019,color);
  for(const [index,sign]of [-1,1].entries())tube(accessories,'glasses-temple-'+index,[point(80+sign*27,69,.055),point(80+sign*35,67,.04),new THREE.Vector3(sign*.67,.2,.12)],.018,color);
 }
 if(appearance.accessory==='bowtie'){
  for(const sign of [-1,1]){const p=point(80+sign*8,112,.04),wing=sphere(character,'bowtie-wing-'+sign,p.toArray(),[.15,.115,.06],tokens.bowtie);wing.rotation.z=sign*-.35;}
  sphere(character,'bowtie-knot',point(80,112,.09).toArray(),[.05,.06,.045],tokens.bowtieKnot);
 }
 const shadow=new THREE.Group();shadow.name='ground-shadow';scene.add(shadow);
 for(let i=0;i<5;i++){const disc=new THREE.Mesh(new THREE.CircleGeometry(1,32),new THREE.MeshBasicMaterial({color:tokens.shadow,transparent:true,opacity:.012+(4-i)*.006,depthWrite:false}));disc.rotation.x=-Math.PI/2;disc.position.y=-1.02-i*.0005;disc.scale.set(.55+i*.07,.32+i*.035,1);shadow.add(disc);}
 const camera=new THREE.OrthographicCamera(-1.35,1.35,1.35,-1.35,.1,20);camera.position.set(0,.22,5);camera.lookAt(0,-.02,0);
 const ambient=new THREE.HemisphereLight(tokens.shine,palette.shade,2.1),key=new THREE.DirectionalLight(tokens.shine,2.5),rim=new THREE.DirectionalLight(palette.light,1.6);key.position.set(-3,4,5);rim.position.set(3,2,-3);scene.add(ambient,key,rim);
 let currentPhase=phase;
 function setPhase(value){currentPhase=mindOutputPhase(value);const sleeping=currentPhase==='sleep'||appearance.eyeVariant==='sleepy';openEyes.visible=!sleeping;closedEyes.visible=sleeping;accessories.visible=!sleeping;brows.visible=!sleeping&&(appearance.eyeVariant==='focused'||currentPhase==='clutch');smile.visible=currentPhase!=='attention';worried.visible=!smile.visible;character.rotation.z=currentPhase==='attention'?-.1:0;}
 function pose(seconds=0,moving=true){const time=moving?seconds:0,active=currentPhase==='investing'||currentPhase==='clutch';character.rotation.y=moving?time*2*Math.PI/tokens.turnSeconds:0;character.position.y=moving?Math.sin(time*2*Math.PI/tokens.floatSeconds)*(active?.045:.026):0;shadow.scale.setScalar(1-character.position.y*.35);}
 function resize(width,height){const aspect=width/height;camera.left=-1.35*Math.max(1,aspect);camera.right=-camera.left;camera.top=1.35*Math.max(1,1/aspect);camera.bottom=-camera.top;camera.updateProjectionMatrix();}
 let disposed=false;
 function dispose(){if(disposed)return;disposed=true;const geometries=new Set(),materials=new Set();scene.traverse(object=>{if(object.geometry)geometries.add(object.geometry);for(const m of [].concat(object.material??[]))materials.add(m);});for(const g of geometries)g.dispose();for(const m of materials)m.dispose();scene.clear();}
 setPhase(phase);pose(0,false);return {scene,camera,character,body,appearance,setPhase,pose,resize,dispose};
}

export function mindOutputWebGLContext(canvas,environment=globalThis){
 if(!environment.window||!environment.window.WebGL2RenderingContext||typeof canvas?.getContext!=='function')return null;
 try{return canvas.getContext('webgl2',{alpha:true,antialias:true,powerPreference:'low-power',premultipliedAlpha:true});}catch{return null;}
}

/** One renderer per visible character; playback only reads the supplied phase. */
export function mountMindOutputScene({host,identity='',config=null,state='idle',tokens,environment=globalThis,onReady=()=>{},onFallback=()=>{},rendererFactory,contextFactory=mindOutputWebGLContext}={}){
 const doc=host?.ownerDocument??environment.document,win=doc?.defaultView??environment.window;
 if(!host||!doc||!win)return {dispose(){},setState(){},supported:false};
 const canvas=doc.createElement('canvas');canvas.setAttribute('aria-hidden','true');canvas.setAttribute('tabindex','-1');
 const context=contextFactory(canvas,{...environment,window:win});if(!context){onFallback();return {dispose(){},setState(){},supported:false};}
 let renderer,model,frame=null,disposed=false,visible=true,elapsed=0,lastTime=null,resizeObserver,intersectionObserver;
 const reduced=win.matchMedia?.('(prefers-reduced-motion: reduce)'),appearance=resolveMindOutputAppearance(identity,config);
 const raf=callback=>win.requestAnimationFrame(callback),cancel=id=>win.cancelAnimationFrame(id);
 const moving=()=>!disposed&&visible&&doc.visibilityState!=='hidden'&&appearance.motionIntensity!=='off'&&!reduced?.matches;
 const stop=()=>{if(frame!==null){cancel(frame);frame=null;}lastTime=null;};
 const draw=()=>{if(!disposed&&visible&&doc.visibilityState!=='hidden')renderer.render(model.scene,model.camera);};
 const tick=time=>{frame=null;if(!moving())return;if(lastTime!==null)elapsed+=Math.min(Math.max(time-lastTime,0),100)/1000;lastTime=time;model.pose(elapsed,true);try{draw();}catch{fallback();return;}frame=raf(tick);};
 const sync=()=>{stop();if(disposed)return;model.pose(elapsed,moving());try{draw();}catch{fallback();return;}if(moving())frame=raf(tick);};
 const resize=()=>{if(disposed)return;const width=Math.max(1,Math.round(host.clientWidth)),height=Math.max(1,Math.round(host.clientHeight));renderer.setPixelRatio(Math.min(win.devicePixelRatio||1,tokens.maxPixelRatio));renderer.setSize(width,height,false);model.resize(width,height);try{draw();}catch{fallback();}};
 const lost=event=>{event.preventDefault();fallback();};
 function dispose(){if(disposed)return;disposed=true;stop();resizeObserver?.disconnect();intersectionObserver?.disconnect();doc.removeEventListener('visibilitychange',sync);win.removeEventListener('resize',resize);if(reduced?.removeEventListener)reduced.removeEventListener('change',sync);else reduced?.removeListener?.(sync);canvas.removeEventListener('webglcontextlost',lost);model?.dispose();renderer?.dispose();context.getExtension?.('WEBGL_lose_context')?.loseContext();canvas.remove();}
 function fallback(){dispose();onFallback();}
 try{
  model=createMindOutputScene({identity,config,state,tokens});renderer=rendererFactory?rendererFactory({canvas,context}):new THREE.WebGLRenderer({canvas,context,alpha:true,antialias:true,powerPreference:'low-power'});renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.setClearColor(0,0);host.appendChild(canvas);
  canvas.addEventListener('webglcontextlost',lost);doc.addEventListener('visibilitychange',sync);win.addEventListener('resize',resize);if(reduced?.addEventListener)reduced.addEventListener('change',sync);else reduced?.addListener?.(sync);
  if(win.ResizeObserver){resizeObserver=new win.ResizeObserver(resize);resizeObserver.observe(host);}
  if(win.IntersectionObserver){intersectionObserver=new win.IntersectionObserver(entries=>{visible=entries.some(entry=>entry.isIntersecting);sync();});intersectionObserver.observe(host);}
  resize();if(disposed)return {dispose,setState(){},supported:false};sync();if(disposed)return {dispose,setState(){},supported:false};onReady();
  return {supported:true,dispose,setState(value){if(!disposed){model.setPhase(value);sync();}}};
 }catch{fallback();return {dispose,setState(){},supported:false};}
}
