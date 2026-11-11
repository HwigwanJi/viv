import {BENCHMARK_STEP,benchmarkStepMs,clampBenchmarkWindow} from '../domain/benchmark.mjs';
import {helpTooltip} from './help-tooltip.mjs';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const date=v=>new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',year:'numeric',month:'short',day:'numeric'}).format(new Date(v));
const time=v=>new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(v));
const pct=v=>(v*100).toFixed(1)+'%';
const utcInput=v=>new Date(v).toISOString().slice(0,16);
const pickerViewStates=new WeakMap();
const catalogStep=catalog=>benchmarkStepMs(catalog?.stepMs);
export function parseBenchmarkDateWindow(start,end,catalog){
 const parse=value=>{if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value??''))return null;const ms=Date.parse(value+':00.000Z');return Number.isFinite(ms)&&utcInput(ms)===value?ms:null;};
 const a=parse(start),b=parse(end);
 if(a===null||b===null)return {ok:false,message:'시작과 종료 날짜·시각을 모두 입력하세요.'};
 const step=catalogStep(catalog);if(a%step!==0||b%step!==0)return {ok:false,message:step===86400000?'UTC 기준 00시 일봉 경계를 선택하세요.':step<BENCHMARK_STEP?'UTC 기준 '+(step/60000)+'분 경계를 선택하세요.':'UTC 기준 00·04·08·12·16·20시 중에서 선택하세요.'};
 if(b<=a)return {ok:false,message:'종료 시각을 시작 시각보다 늦게 설정하세요.'};
 if(a<Date.parse(catalog.sourceStartAt)||b>Date.parse(catalog.sourceEndAt))return {ok:false,message:'보관된 시세 기간 안에서 선택하세요.'};
 return {ok:true,selection:{startAt:new Date(a).toISOString(),endAt:new Date(b).toISOString()}};
}
const context=(catalog,selection,full)=>{
  const min=Date.parse(catalog.sourceStartAt),max=Date.parse(catalog.sourceEndAt),a=Date.parse(selection.startAt),b=Date.parse(selection.endAt),pad=Math.max(30*86400000,(b-a)*.7);
  return full?{startAt:catalog.sourceStartAt,endAt:catalog.sourceEndAt}:{startAt:new Date(Math.max(min,a-pad)).toISOString(),endAt:new Date(Math.min(max,b+pad)).toISOString()};
};

export function renderBenchmarkPicker(catalog,selection,{presetId='custom',full=false,focused=false,presetsVisible=true,rangesOpen=false,namespace='benchmark'}={}){
  if(!catalog?.overview?.length||!selection?.startAt||!selection?.endAt||!Number.isFinite(Date.parse(selection.startAt))||!Number.isFinite(Date.parse(selection.endAt))||selection.endAt<=selection.startAt||selection.startAt<catalog.sourceStartAt||selection.endAt>catalog.sourceEndAt)return '';
  const step=catalogStep(catalog),periodDate=step<BENCHMARK_STEP?time:date,view=context(catalog,selection,full),min=Date.parse(view.startAt),max=Date.parse(view.endAt),span=max-min;
  const points=catalog.overview.filter(p=>Date.parse(p[0])>=min&&Date.parse(p[0])<=max),prices=points.map(p=>p[1]),lo=Math.min(...prices),hi=Math.max(...prices),range=hi-lo||1;
  const line=points.map((p,i)=>(i?'L':'M')+((Date.parse(p[0])-min)/span*1000).toFixed(2)+','+(138-(p[1]-lo)/range*116).toFixed(2)).join(' '),area=points.length?line+` L${((Date.parse(points.at(-1)[0])-min)/span*1000).toFixed(2)},155 L${((Date.parse(points[0][0])-min)/span*1000).toFixed(2)},155 Z`:'';
  const left=(Date.parse(selection.startAt)-min)/span*100,right=(Date.parse(selection.endAt)-min)/span*100;
  const chosen=catalog.presets.find(p=>p.id===presetId),label=chosen?.label||'사용자 지정';
  const heading=focused?`<div class="benchmark-graph-tools"><span>${esc(catalog.displayLabel??'BTCUSDT · 4시간봉')}</span>${helpTooltip('기간 그래프',catalog.helpText??"가격 그래프의 양 끝을 끌거나 방향키로 4시간씩 조정하세요. 프리셋은 전체 보관 가격을 비교해 사후 선정한 30일 구간입니다. JEV에는 프리셋 이름과 선정 수익률을 전달하지 않습니다. 상승·하락은 수익률, 횡보는 수익률 ±3% 안에서 가장 좁은 가격 범위, 변동성은 4시간 가격 변화의 표준편차로 선택합니다.",{id:namespace+'-window-help'})}<button type="button" class="button small" data-simulation-action="benchmark-zoom">${full?'선택 구간 확대':'전체 기간'}</button></div>`:`<div class="benchmark-heading"><div><h2>테스트 구간 ${helpTooltip('테스트 구간',catalog.helpText??'가격 그래프의 양 끝을 끌거나 방향키로 4시간씩 조정하세요. 프리셋은 전체 보관 가격을 비교해 사후 선정한 30일 구간입니다. JEV에는 프리셋 이름과 선정 수익률을 전달하지 않습니다. 겹치는 기간은 같은 시장 구간을 공유합니다. 상승·하락은 수익률, 횡보는 수익률 ±3% 안에서 가장 좁은 가격 범위, 변동성은 4시간 가격 변화의 표준편차로 선택합니다.',{id:namespace+'-window-help'})}</h2><span>${esc(catalog.displayLabel??'BTCUSDT · Binance · 4시간봉')}</span></div><button type="button" class="button small" data-simulation-action="benchmark-zoom">${full?'선택 구간 확대':'전체 기간'}</button></div>`;
  const presets=(!focused||presetsVisible)?`<div class="benchmark-presets" aria-label="시장 구간 프리셋">${catalog.presets.map(p=>`<button type="button" data-simulation-action="benchmark-preset" data-simulation-id="${esc(p.id)}" aria-pressed="${presetId===p.id}"${p.available?'':' disabled'}>${esc(p.label)}${focused?'':`<small>${p.available?date(p.startAt)+' – '+date(p.endAt):'자료 없음'}</small>`}</button>`).join('')}${focused?'':`<button type="button" data-simulation-action="benchmark-preset" data-simulation-id="custom" aria-pressed="${presetId==='custom'}">사용자 지정<small>기간 직접 설정</small></button>`}</div>`:'';
  const dateControls=`<div class="benchmark-range-inputs">${['start','end'].map((edge,i)=>`<label>${i?'종료':'시작'} · UTC<input type="datetime-local" name="benchmark-${edge}-date" data-benchmark-date="${edge}" value="${utcInput(selection[i?'endAt':'startAt'])}" min="${utcInput(catalog.sourceStartAt)}" max="${utcInput(catalog.sourceEndAt)}" step="${step/1000}" aria-label="테스트 ${i?'종료':'시작'} 날짜 · UTC"></label>`).join('')}</div><div class="actions"><button type="button" class="button small" data-benchmark-apply>기간 적용</button></div><p data-benchmark-date-error role="alert" hidden></p>`;
  return `<section class="benchmark-picker${focused?' benchmark-picker-focused':''}" data-benchmark-picker data-view-start="${esc(view.startAt)}" data-view-end="${esc(view.endAt)}">${heading}${presets}<div class="benchmark-selection-meta"><strong data-benchmark-selection-label>${esc(label)}</strong><span data-benchmark-selection-period>${periodDate(selection.startAt)} – ${periodDate(selection.endAt)}</span>${Number.isFinite(chosen?.priceReturn)?`<span data-benchmark-market-return>${esc(catalog.returnLabel??'기초자산')} ${pct(chosen.priceReturn)}</span>`:''}</div><div class="benchmark-stage" data-benchmark-stage><svg viewBox="0 0 1000 160" preserveAspectRatio="none" aria-hidden="true"><path class="benchmark-price-area" d="${area}"/><path class="benchmark-price-line" d="${line}"/></svg><div class="benchmark-unselected benchmark-unselected-start" style="width:${left}%" data-benchmark-dim-start></div><div class="benchmark-unselected benchmark-unselected-end" style="left:${right}%;width:${100-right}%" data-benchmark-dim-end></div><div class="benchmark-selection" data-benchmark-edge="move" style="left:${left}%;width:${right-left}%" aria-hidden="true"></div>${['start','end'].map((edge,i)=>`<button type="button" class="benchmark-handle" data-benchmark-edge="${edge}" name="benchmark-${edge}-handle" role="slider" aria-label="테스트 ${i?'종료':'시작'} 시각" aria-valuemin="${min}" aria-valuemax="${max}" aria-valuenow="${Date.parse(selection[i?'endAt':'startAt'])}" aria-valuetext="${time(selection[i?'endAt':'startAt'])} KST" style="left:${i?right:left}%"><span></span></button>`).join('')}</div><div class="benchmark-axis"><span>${periodDate(view.startAt)}</span><span>${periodDate(view.endAt)}</span></div>${dateControls}${focused?`<details class="benchmark-precise-controls" data-simulation-disclosure="ranges"${rangesOpen?' open':''}><summary>범위 미세 조정</summary>`:''}<div class="benchmark-range-inputs">${['start','end'].map((edge,i)=>`<label>${i?'종료':'시작'}<input type="range" name="benchmark-${edge}-range" data-benchmark-range="${edge}" min="${min}" max="${max}" step="${step}" value="${Date.parse(selection[i?'endAt':'startAt'])}" aria-label="테스트 ${i?'종료':'시작'} 범위" aria-valuetext="${time(selection[i?'endAt':'startAt'])} KST"></label>`).join('')}</div>${focused?'</details>':''}</section>`;
}

/** Pointer updates keep the live form mounted; only release triggers the asynchronous preflight. */
export function bindBenchmarkPicker(container,{getCatalog,getSelection,onChange}={}){
  const host=container?.querySelector?.('[data-benchmark-picker]'),stage=host?.querySelector?.('[data-benchmark-stage]');
  if(!stage?.addEventListener)return ()=>{};
  const step=catalogStep(getCatalog()),periodDate=step<BENCHMARK_STEP?time:date,view={startAt:host.dataset.viewStart,endAt:host.dataset.viewEnd},min=Date.parse(view.startAt),max=Date.parse(view.endAt);
  let drag=null,current=getSelection();
  const disclosure=host.querySelector('[data-simulation-disclosure="ranges"]'),dateError=host.querySelector('[data-benchmark-date-error]');
  const savedView=pickerViewStates.get(container);if(disclosure&&savedView)disclosure.open=savedView.rangesOpen;
  const remember=()=>{if(disclosure)pickerViewStates.set(container,{rangesOpen:disclosure.open});};
  disclosure?.addEventListener?.('toggle',remember);
  // A date field can change the authoritative draft before the async preview remounts.
  // Read it once per new gesture; pointer moves continue from that gesture's own state.
  const refreshSelection=()=>{
    try{const latest=getSelection(),a=Date.parse(latest?.startAt),b=Date.parse(latest?.endAt),catalog=getCatalog();if(!Number.isFinite(a)||!Number.isFinite(b)||b<=a||a<Date.parse(catalog.sourceStartAt)||b>Date.parse(catalog.sourceEndAt))return false;current={...latest};return true;}catch{return false;}
  };
  const paint=(commit=false)=>{
    const left=(Date.parse(current.startAt)-min)/(max-min)*100,right=(Date.parse(current.endAt)-min)/(max-min)*100;
    const selected=host.querySelector('[data-benchmark-edge="move"]');selected.style.left=left+'%';selected.style.width=(right-left)+'%';
    host.querySelector('[data-benchmark-dim-start]').style.width=left+'%';const end=host.querySelector('[data-benchmark-dim-end]');end.style.left=right+'%';end.style.width=(100-right)+'%';
    for(const [edge,key,x]of [['start','startAt',left],['end','endAt',right]]){const handle=host.querySelector(`button[data-benchmark-edge="${edge}"]`),range=host.querySelector(`[data-benchmark-range="${edge}"]`),dateField=host.querySelector(`[data-benchmark-date="${edge}"]`);handle.style.left=x+'%';handle.setAttribute('aria-valuenow',Date.parse(current[key]));handle.setAttribute('aria-valuetext',time(current[key])+' KST');range.value=Date.parse(current[key]);range.setAttribute('aria-valuetext',time(current[key])+' KST');if(dateField)dateField.value=utcInput(current[key]);}
    host.querySelector('[data-benchmark-selection-period]').textContent=periodDate(current.startAt)+' – '+periodDate(current.endAt);
    host.querySelector('[data-benchmark-selection-label]').textContent='사용자 지정';host.querySelector('[data-benchmark-market-return]')?.remove();for(const p of host.querySelectorAll('[data-simulation-action="benchmark-preset"]'))p.setAttribute('aria-pressed',String(p.dataset.simulationId==='custom'));
    remember();onChange(current,{commit});
  };
  const update=(edge,value,commit=false)=>{current=clampBenchmarkWindow(current,{startAt:getCatalog().sourceStartAt,endAt:getCatalog().sourceEndAt,stepMs:step},edge,value);paint(commit);};
  const position=event=>{const rect=stage.getBoundingClientRect();return min+Math.min(1,Math.max(0,(event.clientX-rect.left)/rect.width))*(max-min);};
  const down=event=>{if(event.button!==0||!refreshSelection())return;const target=event.target.closest('[data-benchmark-edge]'),at=position(event),edge=target?.dataset.benchmarkEdge||(Math.abs(at-Date.parse(current.startAt))<Math.abs(at-Date.parse(current.endAt))?'start':'end');drag={edge,offset:edge==='move'?at-Date.parse(current.startAt):0};event.preventDefault();stage.setPointerCapture(event.pointerId);if(edge!=='move')update(edge,at);};
  const move=event=>{if(drag)update(drag.edge,position(event)-drag.offset);};
  const up=event=>{if(!drag)return;const saved=drag;drag=null;if(stage.hasPointerCapture(event.pointerId))stage.releasePointerCapture(event.pointerId);update(saved.edge,position(event)-saved.offset,true);};
  const cancel=()=>{if(!drag)return;drag=null;onChange(current,{commit:true});};
  const key=event=>{const handle=event.target.closest('button[data-benchmark-edge]');if(!handle||!refreshSelection())return;const edge=handle.dataset.benchmarkEdge,now=Date.parse(current[edge==='start'?'startAt':'endAt']),delta=['ArrowRight','ArrowUp'].includes(event.key)?step:['ArrowLeft','ArrowDown'].includes(event.key)?-step:0;let value=event.key==='Home'?min:event.key==='End'?max:now+delta;if(!delta&&!['Home','End'].includes(event.key))return;event.preventDefault();update(edge,value,true);};
  const input=event=>{if(event.target.dataset.benchmarkDate&&dateError){dateError.hidden=true;dateError.textContent='';}if(event.target.dataset.benchmarkRange&&refreshSelection())update(event.target.dataset.benchmarkRange,Number(event.target.value),false);};
  const change=event=>{if(event.target.dataset.benchmarkRange&&refreshSelection())update(event.target.dataset.benchmarkRange,Number(event.target.value),true);};
  const applyDates=event=>{const button=event.target.closest?.('[data-benchmark-apply]');if(!button||button.disabled||button.closest?.('fieldset:disabled'))return;event.preventDefault();const value=parseBenchmarkDateWindow(host.querySelector('[data-benchmark-date="start"]').value,host.querySelector('[data-benchmark-date="end"]').value,getCatalog());if(!value.ok){if(dateError){dateError.textContent=value.message;dateError.hidden=false;}return;}if(dateError){dateError.hidden=true;dateError.textContent='';}current=value.selection;paint(true);};
  stage.addEventListener('pointerdown',down);stage.addEventListener('pointermove',move);stage.addEventListener('pointerup',up);stage.addEventListener('pointercancel',cancel);stage.addEventListener('keydown',key);host.addEventListener('input',input);host.addEventListener('change',change);host.addEventListener('click',applyDates);
  return ()=>{remember();disclosure?.removeEventListener?.('toggle',remember);stage.removeEventListener('pointerdown',down);stage.removeEventListener('pointermove',move);stage.removeEventListener('pointerup',up);stage.removeEventListener('pointercancel',cancel);stage.removeEventListener('keydown',key);host.removeEventListener('input',input);host.removeEventListener('change',change);host.removeEventListener('click',applyDates);};
}
