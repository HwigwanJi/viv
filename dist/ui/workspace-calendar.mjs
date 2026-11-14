import {calendarDay,calendarMonth,moveCalendarMonth} from '../system/calendar-date.mjs';
import {currencyAmount} from './currency-format.mjs';

export const CALENDAR_GUIDE_URL='https://github.com/HwigwanJi/viv/blob/main/docs/agents/operations/viv-mcp-playbook.md#캘린더에서-백테스트-이어가기';
export const CALENDAR_STATUS_TITLE='모의검증 현황';

const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const dateTitle=new Intl.DateTimeFormat('ko-KR',{year:'numeric',month:'long',day:'numeric',weekday:'short',timeZone:'UTC'});
const scheduleTime=new Intl.DateTimeFormat('ko-KR',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',timeZone:'Asia/Seoul',hour12:false});
const periodTime=new Intl.DateTimeFormat('ko-KR',{year:'numeric',month:'numeric',day:'numeric',timeZone:'Asia/Seoul'});
const testPeriod=period=>{
  const start=Date.parse(period?.startAt),end=Date.parse(period?.endAt);
  return Number.isFinite(start)&&Number.isFinite(end)&&start<=end?'테스트 기간 '+periodTime.formatRange(start,end):'';
};
const routeLink=(href,label,extra='')=>'<a data-studio-route href="'+esc(href)+'" '+extra+'>'+label+'</a>';
const today=()=>calendarDay(Date.now());
const monthFor=route=>calendarMonth(route.params.get('month'))??today().slice(0,7);
const money=(amount,currency)=>{
  const value=Number(amount),magnitude=Math.abs(value);
  const display=value===0?'0':magnitude<1e-8?value.toExponential(2):currencyAmount(value,currency,magnitude<.01?8:2);
  return (value>0?'+':'')+display+' '+currency;
};
const tone=amount=>Number(amount)>0?'gain':Number(amount)<0?'loss':'even';
const compactAmount=new Intl.NumberFormat('ko-KR',{notation:'compact',signDisplay:'exceptZero',maximumFractionDigits:2});
const pnl=(rows,cell=false)=>rows.map(({currency,amount})=>{
  const full='<span class="viv-cal-amount-full">'+esc(money(amount,currency))+'</span>';
  const short=cell?'<span aria-hidden="true" class="viv-cal-amount-compact">'+esc(Number(amount)!==0&&Math.abs(Number(amount))<.01?(Number(amount)>0?'+':'')+Number(amount).toExponential(1):compactAmount.format(Number(amount)))+'<small>'+esc(currency)+'</small></span>':'';
  return '<span class="viv-cal-pnl" data-tone="'+tone(amount)+'">'+full+short+'</span>';
}).join('');
const dateFor=(route,month,now)=>{
  const selected=route.params.get('date'),day=selected?.startsWith(month+'-')?new Date(selected+'T00:00:00Z'):null;
  if(day&&Number.isFinite(day.getTime())&&day.toISOString().slice(0,10)===selected)return selected;
  return now.startsWith(month+'-')?now:month+'-01';
};

function monthGrid(data,selected,calendarHref){
  const {month,today,days}=data,first=new Date(month+'-01T00:00:00Z'),offset=(first.getUTCDay()+6)%7;
  const count=new Date(moveCalendarMonth(month,1)+'-01T00:00:00Z').getTime()/86400000-first.getTime()/86400000;
  const values=new Map(days.map(day=>[day.date,day]));
  const cells=Array.from({length:Math.ceil((offset+count)/7)*7},(_,index)=>{
    const number=index-offset+1;
    if(number<1||number>count)return '<span class="viv-cal-cell" aria-hidden="true"></span>';
    const key=month+'-'+String(number).padStart(2,'0'),day=values.get(key),entries=day?.entries??[],scheduled=entries.filter(row=>row.kind==='schedule').length;
    const amounts=day?.pnl??[],mark=scheduled?'<span class="viv-cal-marker" aria-hidden="true"></span>':'';
    const pnlStatus=day?.unknown?(amounts.length?'손익 일부 미확인':'손익 미확인'):'';
    const label=[key,key===today?'오늘':'',pnlStatus,...amounts.map(row=>money(row.amount,row.currency)),entries.length?'일정·기록 '+entries.length+'건':''].filter(Boolean).join(', ');
    return routeLink(calendarHref(month,key),'<span class="viv-cal-number">'+number+mark+'</span>'+
      (pnlStatus?'<small>미확인</small>':'')+pnl(amounts,true)+
      (entries.length&&!amounts.length&&!pnlStatus?'<small>'+entries.length+'건</small>':''),'class="viv-cal-cell" data-cal-date="'+key+'" aria-label="'+esc(label)+'"'+(key===selected?' aria-current="date"':'')+(key===today?' data-today':''));
  });
  return '<div class="viv-cal-grid" aria-label="월간 일정">'+['월','화','수','목','금','토','일'].map(day=>'<span class="viv-cal-week">'+day+'</span>').join('')+cells.join('')+'</div>';
}

function agenda(day,selected,eventLedgerUnavailable){
  const records=day?.entries??[];
  const amounts=day?.pnl??[];
  const summary=amounts.length?(day?.unknown||eventLedgerUnavailable?'모의 실현 손익 · 확인된 금액':'모의 실현 손익'):
    day?.unknown?'실현 손익 미확인':eventLedgerUnavailable?'확인된 실현 손익 기록 없음':'실현 손익 기록 없음';
  return '<section class="viv-cal-panel viv-cal-day" aria-labelledby="viv-cal-day-title"><h2 id="viv-cal-day-title">'+esc(dateTitle.format(new Date(selected+'T00:00:00Z')))+'</h2>'+
    '<div class="viv-cal-totals" role="group" aria-label="모의 실현 손익"><span class="muted">'+summary+'</span>'+pnl(amounts)+'</div>'+
    (day?.unknown?'<p class="muted">손익이 확인되지 않은 매도 체결이 있습니다.</p>':'')+
    (records.length?'<ul class="viv-cal-list">'+records.map((row,index)=>{
      const detail=[row.label,scheduleTime.format(new Date(row.at)),testPeriod(row.period)].filter(Boolean).join(' · ');
      const result=Number.isFinite(row.totalReturn)?'<span class="viv-cal-status"><small>'+esc(row.returnLabel??'수익률')+'</small><span class="viv-cal-pnl" data-tone="'+tone(row.totalReturn)+'">'+esc(new Intl.NumberFormat('ko-KR',{style:'percent',signDisplay:'exceptZero',maximumFractionDigits:2}).format(row.totalReturn))+'</span></span>':
        row.amount!==undefined?pnl([row]):'<span aria-hidden="true">↗</span>';
      const decision=row.kind==='activity'&&row.href.startsWith('#minds?')&&new URLSearchParams(row.href.slice(7)).get('kind')==='decisions';
      const focus=row.kind==='fill'?'data-cal-entry="day" data-cal-entry-key="'+esc(row.id??row.at+':'+index)+'"':
        row.kind==='experiment'||decision?'data-cal-entry="day"':'';
      return '<li>'+routeLink(row.href,'<span><strong>'+esc(row.name)+'</strong><small>'+esc(detail)+'</small></span>'+result,focus)+'</li>';
    }).join('')+'</ul>':'<p class="muted">이 날짜에 확인된 일정이나 기록이 없습니다.</p>')+'</section>';
}

function ongoing(rows,expanded){
  const previewCount=2,hasMore=rows.length>previewCount;
  return '<section class="viv-cal-panel viv-cal-active" aria-labelledby="viv-cal-active-title"><h2 id="viv-cal-active-title" tabindex="-1">'+CALENDAR_STATUS_TITLE+' <span class="muted">'+rows.length+'건</span></h2>'+
    (hasMore?'<button type="button" class="button small viv-cal-expand" data-cal-control="active-toggle" data-studio-action="calendar-toggle-active" aria-controls="viv-cal-active-list" aria-expanded="'+expanded+'">'+(expanded?'목록 접기':'전체 '+rows.length+'건 보기')+'</button>':'')+
    (rows.length?'<ul id="viv-cal-active-list" class="viv-cal-list">'+(expanded?rows:rows.slice(0,previewCount)).map(row=>{
      const detail=row.at?row.atLabel+' '+scheduleTime.format(new Date(row.at)):
        testPeriod(row.period)||(row.progress?.total>0?row.progress.completed+' / '+row.progress.total+' 처리':'');
      return '<li>'+routeLink(row.href,'<span><strong>'+esc(row.name)+'</strong><small>'+esc([row.kind==='experiment'?'과거 시세 검증':'모의 운용',detail].filter(Boolean).join(' · '))+'</small></span><span class="viv-cal-status">'+esc(row.state)+'</span>','data-cal-entry="active"')+'</li>';
    }).join('')+'</ul>':
      '<p class="muted">진행하거나 확인할 모의검증이 없습니다.</p>'+routeLink('#minds?profileId=all&view=simulations&executionMode=paper','실험실 열기','class="button small"'))+'</section>';
}

export function createWorkspaceCalendar({getRoute,request,render}){
  let data=null,error=null,pending=null,controller=null,inCalendar=false,activeExpanded=false;
  async function load({force=false}={}){
    const route=getRoute();
    const month=route.page==='calendar'?monthFor(route):null;
    const reentering=Boolean(month)&&!inCalendar;
    inCalendar=Boolean(month);
    if(month&&pending===month)return;
    controller?.abort();
    controller=null;pending=null;
    if(!month||!force&&!reentering&&data?.month===month)return;
    const task=new AbortController();
    controller=task;pending=month;render();
    try{
      const value=await request('/api/workspace/calendar?month='+encodeURIComponent(month),undefined,{signal:task.signal});
      if(!task.signal.aborted){data=value;error=null;}
    }catch(problem){if(!task.signal.aborted)error={month,message:problem.message};}
    finally{if(controller===task){pending=null;if(getRoute().page==='calendar')render();}}
  }
  function markup(){
    const route=getRoute(),month=monthFor(route),current=data?.month===month?data:null,now=current?.today??today(),selected=dateFor(route,month,now);
    const mode=route.params.get('executionMode');
    const calendarHref=(month,date)=>'#calendar?'+new URLSearchParams({month,...(date?{date}:{}),...(mode?{executionMode:mode}:{})});
    const [year,mon]=month.split('-').map(Number),loading=pending===month,failed=error?.month===month;
    const monthLink=(offset,label,icon,control)=>{
      const next=calendarMonth(moveCalendarMonth(month,offset));
      return next?routeLink(calendarHref(next),icon,'class="button" aria-label="'+label+'" data-cal-control="'+control+'"'):'';
    };
    const monthHeadingControl=!calendarMonth(moveCalendarMonth(month,-1))?'previous':!calendarMonth(moveCalendarMonth(month,1))?'next':null;
    return '<section class="viv-calendar"'+(current&&!loading&&!failed?' data-cal-ready':'')+'><header class="viv-cal-head"><div><h1 tabindex="-1">캘린더</h1><p class="muted">모의검증 일정과 날짜별 모의 실현 손익 · 한국 시간</p><p>과거 시세 검증은 완료 또는 결과 갱신 날짜에 표시합니다. '+routeLink('#minds?profileId=all&view=simulations&executionMode=paper&expStatus=completed','완료된 모의검증 찾기','data-cal-control="completed"')+'</p><p><a data-cal-control="guide" href="'+CALENDAR_GUIDE_URL+'" target="_blank" rel="noopener noreferrer">캘린더 사용법 (새 탭)</a></p></div>'+
      routeLink(calendarHref(now.slice(0,7),now),'오늘','class="button" data-cal-control="today"')+'</header>'+
      '<div class="viv-cal-layout">'+(current?ongoing(current.active,activeExpanded):'')+
      '<section class="viv-cal-panel viv-cal-month" aria-label="월간 캘린더"><div class="viv-cal-toolbar">'+monthLink(-1,'이전 달','‹','previous')+
      '<h2'+(monthHeadingControl?' tabindex="-1" data-cal-control="'+monthHeadingControl+'"':'')+'>'+year+'년 '+mon+'월</h2>'+monthLink(1,'다음 달','›','next')+'</div>'+
      (loading&&(!current||failed)?'<p role="status">일정을 불러오는 중…</p>':'')+
      (failed&&!loading?'<p role="alert">'+esc(error.message)+'</p>':'')+
      (failed?'<button type="button" class="button" data-cal-control="retry" data-studio-action="calendar-refresh"'+(loading?' aria-disabled="true"':'')+'>다시 조회</button>':'')+
      monthGrid(current??{month,today:now,days:[]},selected,calendarHref)+
      '<p class="viv-cal-note muted">매도에서 확정된 손익을 통화별로 표시합니다.</p>'+
      (current?.eventLedgerUnavailable?'<p class="viv-cal-note" role="status">일부 분봉 모의 원장을 확인하지 못했습니다.</p>':'')+
      '</section>'+(current?agenda(current.days.find(day=>day.date===selected),selected,current.eventLedgerUnavailable):'')+'</div></section>';
  }
  return {load,render:markup,toggleActive(){activeExpanded=!activeExpanded;render();},destroy(){controller?.abort();}};
}
