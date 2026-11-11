const fail=message=>{throw Object.assign(new Error(message),{code:'OPERATION_WINDOW',status:400});};
export function normalizeOperationWindow(input={}, {now}={}){
 const result={};for(const key of ['startsAt','endsAt'])if(input[key]!==undefined&&input[key]!==null&&input[key]!==''){
  const value=input[key];if(typeof value!=='string'||!Number.isFinite(Date.parse(value))||new Date(value).toISOString()!==value)fail('운용 시작과 종료 시각을 확인하세요.');result[key]=value;
 }
 if(result.startsAt&&result.endsAt&&result.startsAt>=result.endsAt)fail('종료 시각을 시작 시각 이후로 설정하세요.');
 if(now&&result.endsAt&&result.endsAt<=now)fail('미래의 종료 시각을 설정하세요.');return result;
}
export function operationWindowState(config={},now){
 if(!Number.isFinite(Date.parse(now)))fail('운용 기준 시각을 확인하세요.');const window=normalizeOperationWindow(config);
 return window.endsAt&&now>=window.endsAt?'ENDED':window.startsAt&&now<window.startsAt?'WAITING':'ACTIVE';
}
