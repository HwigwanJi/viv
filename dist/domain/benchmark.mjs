export const BENCHMARK_VERSION='btc-regime-window-v1';
export const BENCHMARK_STEP=14400000;
export const benchmarkStepMs=value=>[60000,180000,300000,BENCHMARK_STEP,86400000].includes(value)?value:BENCHMARK_STEP;
export const BENCHMARK_REGIMES=Object.freeze([{id:'bull',label:'상승장'},{id:'bear',label:'하락장'},{id:'sideways',label:'횡보장'},{id:'high-volatility',label:'높은 변동성'},{id:'low-volatility',label:'낮은 변동성'}]);
const iso=v=>new Date(v).toISOString();
const finite=Number.isFinite;
const check=(condition,message)=>{if(!condition){const error=new Error(message);error.code='SIMULATION_BENCHMARK';throw error;}};

/** Evaluation-window selection uses archive outcomes; none of these labels enter a trading frame. */
export function benchmarkWindowStats(bars){
  if(!Array.isArray(bars)||!bars.length)return null;
  const changes=bars.map(b=>Math.log(b[4]/b[1])),mean=changes.reduce((a,b)=>a+b,0)/changes.length;
  const high=Math.max(...bars.map(b=>b[2])),low=Math.min(...bars.map(b=>b[3]));
  return {priceReturn:bars.at(-1)[4]/bars[0][1]-1,realizedVolatility:Math.sqrt(changes.reduce((n,v)=>n+(v-mean)**2,0)/changes.length),priceRange:high/low-1,barCount:bars.length};
}

export function buildBenchmarkCatalog(dataset,source){
  const bars=dataset.bars,windowBars=180,candidates=[];
  // Daily starts, 30 calendar days, with at least 210 calendar days of preceding history.
  for(let i=0;i+windowBars<=bars.length;i++){
    if(bars[i][0]%86400000||bars[i][0]-bars[0][0]<210*86400000)continue;
    const selected=bars.slice(i,i+windowBars);
    if(selected.some((bar,j)=>bar[0]!==selected[0][0]+j*BENCHMARK_STEP))continue;
    candidates.push({startAt:iso(selected[0][0]),endAt:iso(selected.at(-1)[0]+BENCHMARK_STEP),...benchmarkWindowStats(selected)});
  }
  const ranked=(accept,score)=>candidates.filter(accept).sort((a,b)=>score(a)-score(b)||a.startAt.localeCompare(b.startAt))[0];
  const picks={bull:ranked(v=>v.priceReturn>0,v=>-v.priceReturn),bear:ranked(v=>v.priceReturn<0,v=>v.priceReturn),sideways:ranked(v=>Math.abs(v.priceReturn)<=.03,v=>v.priceRange),'high-volatility':ranked(()=>true,v=>-v.realizedVolatility),'low-volatility':ranked(()=>true,v=>v.realizedVolatility)};
  const rules={windowDays:30,startStepDays:1,minimumHistoryDays:210,sidewaysMaxAbsoluteReturn:.03,volatilityBasis:'STANDARD_DEVIATION_LOG_CLOSE_OVER_OPEN_4H',selectionBasis:'ARCHIVED_OUTCOME_EVALUATION_WINDOW'};
  const stride=Math.max(1,Math.ceil(bars.length/3000)),overview=bars.filter((_,i)=>i%stride===0||i===bars.length-1).map(b=>[iso(b[0]),b[4]]);
  return {version:BENCHMARK_VERSION,instrumentId:source.instrumentId,timeframe:'4h',datasetSha256:source.datasetSha256,sourceStartAt:source.startAt,sourceEndAt:source.endAt,rules,overview,presets:BENCHMARK_REGIMES.map(p=>({...p,...(picks[p.id]||{}),available:Boolean(picks[p.id])}))};
}

export function resolveBenchmarkSelection(catalog,presetId,startAt,endAt){
  const id=presetId||'custom',preset=id==='custom'?null:catalog.presets.find(p=>p.id===id&&p.available);
  check(id==='custom'||preset,'벤치마크 프리셋을 다시 선택하세요.');
  check(!preset||preset.startAt===startAt&&preset.endAt===endAt,'프리셋 기간이 변경되었습니다. 사용자 지정 기간으로 저장하세요.');
  return {version:BENCHMARK_VERSION,presetId:id,label:preset?.label||'사용자 지정',instrumentId:catalog.instrumentId,timeframe:catalog.timeframe,datasetSha256:catalog.datasetSha256,startAt,endAt,selectionBasis:preset?'ARCHIVED_OUTCOME_EVALUATION_WINDOW':'USER_SELECTED_WINDOW',...(preset?{rules:structuredClone(catalog.rules),marketStats:{priceReturn:preset.priceReturn,realizedVolatility:preset.realizedVolatility,priceRange:preset.priceRange,barCount:preset.barCount}}:{})};
}

export function validateBenchmarkSelection(value,startAt,endAt){
  check(value&&typeof value==='object'&&!Array.isArray(value),'벤치마크 설정을 확인하세요.');
  check(value.version===BENCHMARK_VERSION&&value.startAt===startAt&&value.endAt===endAt&&value.timeframe==='4h'&&value.instrumentId==='crypto:binance:BTCUSDT'&&/^[a-f0-9]{64}$/.test(value.datasetSha256),'벤치마크의 종목·기간·원본 버전을 확인하세요.');
  check(value.presetId==='custom'||BENCHMARK_REGIMES.some(p=>p.id===value.presetId),'벤치마크 프리셋을 확인하세요.');
  return structuredClone(value);
}

export function clampBenchmarkWindow(selection,bounds,edge,value){
  const step=benchmarkStepMs(bounds.stepMs);
  const min=Date.parse(bounds.startAt),max=Date.parse(bounds.endAt),start=Date.parse(selection.startAt),end=Date.parse(selection.endAt),raw=typeof value==='number'?value:Date.parse(value);
  check([min,max,start,end,raw].every(finite)&&max-min>=step,'선택할 가격 자료 범위를 확인하세요.');
  const snap=v=>Math.round(v/step)*step,clamp=(v,lo,hi)=>Math.min(hi,Math.max(lo,v));
  let a=clamp(start,min,max-step),b=clamp(end,a+step,max);
  if(edge==='start')a=clamp(snap(raw),min,b-step);
  else if(edge==='end')b=clamp(snap(raw),a+step,max);
  else if(edge==='move'){const span=b-a;a=clamp(snap(raw),min,max-span);b=a+span;}
  else check(false,'조정할 기간 경계를 확인하세요.');
  return {startAt:iso(a),endAt:iso(b)};
}
