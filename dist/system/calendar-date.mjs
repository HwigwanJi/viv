const koreanDay=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'});
export const calendarMonth=value=>typeof value==='string'&&/^20\d{2}-(0[1-9]|1[0-2])$/.test(value)?value:null;
export function calendarDay(value){
  if(value===null||value===undefined||!Number.isFinite(new Date(value).getTime()))return null;
  return koreanDay.format(new Date(value));
}
export function paperDecisionCalendarTime(run){
  if(run.experimentType!=='FORWARD_PAPER'||run.executionMode==='live'||run.mode==='replay'||
     run.automation?.portfolioCycle?.phase==='SCREENING'||run.execution?.status==='SCREENING_ONLY')return null;
  const at=run.decisionCompletedAt??run.decisionAt;
  return typeof at==='string'&&Number.isFinite(Date.parse(at))?new Date(at).toISOString():null;
}
export function moveCalendarMonth(month,offset){
  const [year,index]=month.split('-').map(Number);
  return new Date(Date.UTC(year,index-1+offset,1)).toISOString().slice(0,7);
}
