import {normalizeOperationWindow} from '../domain/operation-window.mjs';
const local=value=>value?new Date(Date.parse(value)+9*3600000).toISOString().slice(0,16):'';
export function operationWindowFields(config={}, {requiresEnd=false}={}){
 return '<fieldset class="full form-grid"><legend>운용 기간</legend><label class="field">시작 시각 (한국 시간)<input type="datetime-local" name="startsAt" value="'+local(config.startsAt)+'"></label><label class="field">종료 시각 (한국 시간)<input type="datetime-local" name="endsAt" value="'+local(config.endsAt)+'"'+(requiresEnd?' required':'')+'></label><p class="tiny muted full">시작을 비우면 즉시 시작합니다. '+(requiresEnd?'종료 시각을 지정해 유한 모의운용을 진행합니다.':'종료를 비우면 계속 운용합니다.')+' 종료 시 새 판단과 주문을 멈추고 보유와 미확정 기록을 유지합니다.</p></fieldset>';
}
export function operationWindowValues(values){
 const result={};for(const key of ['startsAt','endsAt'])if(values[key]){if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(values[key]))throw Error('운용 기간을 확인하세요.');result[key]=new Date(values[key]+':00+09:00').toISOString();if(local(result[key])!==values[key])throw Error('운용 기간을 확인하세요.');}return normalizeOperationWindow(result,{now:new Date().toISOString()});
}
export function operationWindowSummary(config={}){
 const format=value=>new Date(value).toLocaleString('ko-KR',{timeZone:'Asia/Seoul',hour12:false})+' KST';
 return (config.startsAt?format(config.startsAt):'즉시 시작')+' → '+(config.endsAt?format(config.endsAt):'종료 시각 없음');
}
