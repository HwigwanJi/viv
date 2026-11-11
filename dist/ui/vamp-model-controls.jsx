import React,{useEffect,useState,useRef} from 'react';

const BASE='/api/workspace/strategy-learning/vamp';
async function request(path,body){const response=await fetch(BASE+path,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json'}:{},...(body?{body:JSON.stringify(body)}:{})}),value=await response.json();if(!response.ok||!value.ok)throw new Error(value.message??'학습 기록을 확인하세요.');return value;}
export function VampModelControls({data,expanded}){
 const [datasets,setDatasets]=useState([]),[spec,setSpec]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[receipt,setReceipt]=useState(null),alive=useRef(true),model=data.node.config.model;
 const configRef=useRef(data.node.config);configRef.current=data.node.config;
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 useEffect(()=>{if(!expanded)return;let current=true;request('/catalog').then(r=>{if(current)setDatasets(r.datasets);},e=>{if(current)setError(e.message);});return()=>{current=false;};},[expanded]);
 useEffect(()=>{if(!expanded||!model)return;let current=true;request('/item?modelHash='+encodeURIComponent(model.hash)).then(r=>{if(current)setReceipt(r.run);},()=>{});return()=>{current=false;};},[expanded,model?.hash]);
 function choose(datasetId){const d=datasets.find(d=>d.id===datasetId);if(!d)return;const start=Date.parse(d.startAt),end=Date.parse(d.endAt),split=Math.floor((start+(end-start)/2)/60000)*60000,at=t=>new Date(t).toISOString();setSpec({datasetId,penalty:1,training:{startAt:d.startAt,endAt:at(split)},validation:{startAt:at(split+60000),endAt:d.endAt}});setReceipt(null);}
 async function train(){const original=JSON.stringify(data.node.config);setBusy(true);setError('');setReceipt(null);try{const r=await request('/train',{...spec,idempotencyKey:crypto.randomUUID()});if(alive.current){if(JSON.stringify(configRef.current)!==original)throw new Error('모델 설정이 변경됐습니다. 다시 학습을 선택하세요.');data.onPatch(data.node,{config:{family:'VAMP_RIDGE',model:r.run.model}});setReceipt(r.run);}}catch(e){if(alive.current)setError(e.message);}finally{if(alive.current)setBusy(false);}}
 if(!expanded)return <span className="strategy-inline-caption">{model?'60초 수익률 예측 · 학습 '+model.training.sampleCount+'개':'모델 학습 필요'}</span>;
 return <section aria-label="VAMP 모델 학습">
  <p>호가로 60초 뒤 가격 변화를 학습합니다. 모의 연구용이며 수익성은 별도 검증합니다.</p>
  {model&&<dl className="strategy-node-summary"><div><dt>저장된 모델</dt><dd>학습 표본 {model.training.sampleCount}개</dd></div><div><dt>학습 종료 · UTC</dt><dd>{model.training.endAt}</dd></div></dl>}
  <fieldset disabled={busy||data.saving}><label className="field">관측 자료<select aria-label="VAMP 관측 자료" value={spec?.datasetId??''} onChange={e=>choose(e.target.value)}><option value="">자료 선택</option>{datasets.map(d=><option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
  {spec&&<>{['training','validation'].flatMap(phase=>['startAt','endAt'].map(key=><label key={phase+key} className="field">{phase==='training'?'학습':'검증'} {key==='startAt'?'시작':'종료'} · UTC<input type="datetime-local" step="1" aria-label={'VAMP '+(phase==='training'?'학습':'검증')+' '+(key==='startAt'?'시작':'종료')+' UTC'} value={spec[phase][key].slice(0,19)} onChange={e=>{if(e.target.value)setSpec({...spec,[phase]:{...spec[phase],[key]:new Date(e.target.value+'Z').toISOString()}});}}/></label>))}<label className="field">복잡도 억제 강도<input type="number" min="0.000001" max="1000000" step="any" aria-label="VAMP 복잡도 억제 강도" value={spec.penalty} onChange={e=>setSpec({...spec,penalty:Number(e.target.value)})}/></label></>}
  <button type="button" className="button small" disabled={!spec||busy} onClick={train}>{busy?'학습·검증 중…':'모델 학습·검증'}</button></fieldset>
  {error&&<p role="alert">{error}</p>}{receipt&&<div role="status"><p>학습 {receipt.model.training.sampleCount}개 · 검증 {receipt.validation.sampleCount}개 완료</p><p>예측 오차 {receipt.validation.rmseBps.toFixed(3)} bps · 무변화 기준 {receipt.validation.zeroReturnBaselineRmseBps.toFixed(3)} bps</p><p>이 노드에 연결된 모델의 학습·검증 기록입니다.</p></div>}
 </section>;
}
