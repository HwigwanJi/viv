import React,{useEffect,useMemo,useRef,useState} from 'react';
import {renderMindAvatar} from './mind-avatar.mjs';
import {mindOutputPhase,mindOutputVisualTokens,mountMindOutputScene,resolveMindOutputAppearance} from './mind-output-3d-scene.mjs';

export function MindOutput3D({identity='',config=null,name='',state='idle'}){
 const host=useRef(null),runtime=useRef(null),[ready,setReady]=useState(false),phase=mindOutputPhase(state),appearance=resolveMindOutputAppearance(identity,config),appearanceKey=JSON.stringify(appearance);
 const fallback=useMemo(()=>renderMindAvatar({identity,config:appearance,phase,size:'large'}),[identity,appearanceKey,phase]);
 useEffect(()=>{
  let active=true;setReady(false);
  try{runtime.current=mountMindOutputScene({host:host.current,identity,config:appearance,state:phase,tokens:mindOutputVisualTokens(host.current),onReady:()=>{if(active)setReady(true);},onFallback:()=>{if(active)setReady(false);}});}catch{runtime.current=null;}
  return ()=>{active=false;runtime.current?.dispose();runtime.current=null;};
 },[identity,appearanceKey]);
 useEffect(()=>{runtime.current?.setState(phase);},[phase]);
 return <span className="mind-output-3d" role="img" aria-label={(name||'마인드')+' 캐릭터'} data-renderer={ready?'webgl':'fallback'} data-phase={phase} data-body={appearance.bodyVariant} data-palette={appearance.colorPalette} data-motion={appearance.motionIntensity}>
  <span className="mind-output-3d__canvas" ref={host} aria-hidden="true"/>
  <span className="mind-output-3d__fallback" hidden={ready} aria-hidden="true" dangerouslySetInnerHTML={{__html:fallback}}/>
 </span>;
}
