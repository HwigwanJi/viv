const DAY=86400000;
const fail=()=>{throw Object.assign(new Error('연속된 확정 일봉과 필요한 월말 종가를 확인하세요.'),{code:'CALENDAR_HISTORY_REQUIRED'});};
/** UTC month-end closes only. Missing history is not a bearish signal. */
export function monthlySmaDistance(bars,months){
 if(!Number.isInteger(months)||months<1||!bars.length)fail();
 const last=Date.parse(bars.at(-1).closeTime),end=new Date(last),boundary=Date.UTC(end.getUTCFullYear(),end.getUTCMonth(),1);
 const closes=[];
 for(let i=0;i<months;i++){
  const t=Date.UTC(end.getUTCFullYear(),end.getUTCMonth()-i,1),b=bars.find(b=>Date.parse(b.closeTime)===t);
  if(!b||!(b.close>0)||!Number.isFinite(b.close)||Date.parse(b.closeTime)-Date.parse(b.openTime)!==DAY)fail();
  closes.push(b.close);
 }
 const start=Date.UTC(end.getUTCFullYear(),end.getUTCMonth()-months+1,1),required=bars.filter(b=>Date.parse(b.closeTime)>=start&&Date.parse(b.closeTime)<=boundary);
 if(required.length!==(boundary-start)/DAY+1||required.some((b,i)=>Date.parse(b.closeTime)-Date.parse(b.openTime)!==DAY||i&&b.openTime!==required[i-1].closeTime))fail();
 return closes[0]/(closes.reduce((a,b)=>a+b,0)/months)-1;
}
