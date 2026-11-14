import {calendarDay,calendarMonth,paperDecisionCalendarTime} from '../dist/system/calendar-date.mjs';
import {paperDecisionRecordHash} from '../dist/system/paper-decision-links.mjs';
import {getEventPaperReport} from '../dist/domain/event-paper-execution.mjs';
import {normalizeOperationWindow,operationWindowState} from '../dist/domain/operation-window.mjs';
import {readOperationalWorkspace,WorkspaceRepository} from './repository.mjs';
import {eventPaperDecimal,eventPaperUnits,listEventPaperSubscriptions} from './event-paper-store.mjs';
import {SimulationRepository} from './simulation-repository.mjs';
import {buildSimulationCollection,readSimulationCollectionHeads} from './simulation-collection.mjs';

const mindLink=profileId=>'#minds?'+new URLSearchParams({profileId,view:'operations',executionMode:'paper'});
const labLink=route=>'#minds?'+new URLSearchParams(Object.entries({view:'simulations',executionMode:'paper',...route}).filter(([,value])=>value!=null));
const validTime=value=>typeof value==='string'&&Number.isFinite(Date.parse(value))?new Date(value).toISOString():null;
const experimentStates=new Map([
  ['CREATED','실행 대기'],['READY','실행 대기'],['RUNNING','실행 중'],
  ['PAUSED','일시중지'],['ACTION_REQUIRED','확인 필요'],['FAILED','확인 필요']
]);

export function buildWorkspaceCalendar(workspace,events,experiments,{month,now,runnersDisabled=false}){
  const names=new Map((workspace.investmentProfiles??[]).map(p=>[p.id,p.displayName??p.name]));
  const name=id=>names.get(id)??'마인드';
  const days=new Map(),active=[];
  function add(at,entry){
    const date=calendarDay(validTime(at));
    if(!date?.startsWith(month+'-'))return;
    if(!days.has(date))days.set(date,{date,entries:[],pnl:new Map(),unknown:false});
    const day=days.get(date);
    day.entries.push({...entry,at});
    return day;
  }
  function addFill(fill,profileId,currency,href){
    const side=fill.side??fill.action;
    if(!['buy','sell'].includes(side))return;
    const date=validTime(fill.at);
    if(!date||date>now)return;
    const day=add(date,{kind:'fill',id:fill.id,label:side==='sell'?'모의 매도 체결':'모의 매수 체결',name:name(profileId),href});
    if(!day||side!=='sell')return;
    try{
      const amount=fill.exactRealizedPnl??(Number.isFinite(fill.realizedPnl)?fill.realizedPnl.toFixed(8):null);
      if(!currency||amount===null)throw Error('Missing ledger amount');
      day.pnl.set(currency,(day.pnl.get(currency)??0n)+eventPaperUnits(amount));
      Object.assign(day.entries.at(-1),{currency,amount});
    }catch{day.unknown=true;}
  }
  for(const account of workspace.mindPositions??[]){
    if(account.kind!=='PAPER_ACCOUNT')continue;
    for(const fill of account.ledger??[])addFill(fill,account.profileId,account.quoteCurrency,
      fill.runId?paperDecisionRecordHash(fill.runId):mindLink(account.profileId));
  }
  for(const sub of workspace.mindSubscriptions??[]){
    const window=normalizeOperationWindow(sub),state=operationWindowState(sub,now),enabled=sub.status==='ENABLED'&&state!=='ENDED';
    const href=mindLink(sub.profileId),title=name(sub.profileId);
    const close=validTime(sub.nextCloseAt),next=validTime(sub.runtime?.nextAttemptAt??(close?new Date(Date.parse(close)+300000).toISOString():null));
    const scheduled=!runnersDisabled&&next&&next>=now&&(!window.startsAt||next>=window.startsAt)&&(!window.endsAt||next<window.endsAt)?next:null;
    if(enabled)active.push({name:title,kind:'forward',state:runnersDisabled?'실행기 중지':state==='WAITING'?'시작 대기':'진행 중',at:state==='WAITING'?window.startsAt:scheduled,atLabel:state==='WAITING'?'시작 예정':'다음 판단 예정',href});
    if(['ACTION_REQUIRED','PAUSED'].includes(sub.status)&&(sub.status==='ACTION_REQUIRED'||sub.attempts?.length||window.startsAt))active.push({name:title,kind:'forward',state:sub.status==='PAUSED'?'일시중지':'확인 필요',at:null,href});
    if(window.startsAt)add(window.startsAt,{kind:'schedule',label:'검증 시작 설정',name:title,href});
    if(window.endsAt)add(window.endsAt,{kind:'schedule',label:'검증 종료 설정',name:title,href});
    if(enabled&&scheduled)add(scheduled,{kind:'schedule',label:'다음 판단 예정',name:title,href});
  }
  let eventLedgerUnavailable=false;
  for(const sub of events){
    const href=mindLink(sub.profileId),title=name(sub.profileId);
    if(sub.status==='ENABLED')active.push({name:title,kind:'forward',state:runnersDisabled?'실행기 중지':'시장 조건 대기',at:null,href});
    if(sub.status==='PAUSED')active.push({name:title,kind:'forward',state:'일시중지',at:null,href});
    add(sub.createdAt,{kind:'activity',label:'분봉 모의 운용 시작',name:title,href});
    if(sub.status==='COMPLETED')add(sub.updatedAt,{kind:'activity',label:'분봉 모의 운용 종료',name:title,href});
    try{
      const reports=[...(sub.state.closedCampaigns??[]).map(c=>c.report),getEventPaperReport(sub.state.account)];
      for(const report of reports)for(const fill of report.ledger??[])addFill(fill,sub.profileId,sub.config.quoteCurrency,href);
    }catch{eventLedgerUnavailable=true;}
  }
  for(const run of workspace.mindRuns??[]){
    const at=paperDecisionCalendarTime(run);
    if(at&&at<=now)add(at,{kind:'activity',label:run.status==='FAILED'?'모의 판단 실패':'모의 판단 기록',name:name(run.profileId),href:paperDecisionRecordHash(run.id)});
  }
  for(const row of experiments){
    if(row.archivedAt||row.status==='DRAFT')continue;
    const href=labLink(row.route);
    const state=experimentStates.get(row.status);
    if(state)active.push({name:row.name,kind:'experiment',state,progress:row.progress,href,
      ...(['CREATED','READY'].includes(row.status)?{period:row.period}:{})});
    if(row.status==='COMPLETED')add(row.completedAt??row.updatedAt,{kind:'experiment',label:row.completedAt?'과거 시세 검증 완료':'과거 시세 결과 갱신',name:row.name,href,period:row.period,totalReturn:row.metrics?.totalReturn,returnLabel:row.metricsLabel});
  }
  return {month,today:calendarDay(now),asOf:now,active,eventLedgerUnavailable,
    days:[...days.values()].sort((a,b)=>a.date.localeCompare(b.date)).map(day=>({...day,
      pnl:[...day.pnl].map(([currency,value])=>({currency,amount:eventPaperDecimal(value)})),
      entries:day.entries.sort((a,b)=>a.at.localeCompare(b.at))}))};
}

export async function handleWorkspaceCalendar(request,env,clock){
  const json=(value,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store'}});
  const url=new URL(request.url),owner=request.headers.get('oai-authenticated-user-id');
  if(!owner)return json({ok:false,message:'로그인이 필요합니다.'},401);
  if(request.method!=='GET')return json({ok:false,message:'캘린더 조회 요청을 확인하세요.'},405);
  if(request.headers.get('Sec-Fetch-Site')==='cross-site'||request.headers.get('Origin')&&request.headers.get('Origin')!==url.origin)return json({ok:false,message:'VIV에서 캘린더를 여세요.'},403);
  const month=calendarMonth(url.searchParams.get('month'));
  if(!month||url.searchParams.size!==1)return json({ok:false,message:'조회할 월을 확인하세요.'},400);
  if(!env.DB)return json({ok:false,message:'저장소에 연결할 수 없습니다.'},503);
  try{
    const now=new Date(clock()).toISOString();
    const [workspace,events,heads]=await Promise.all([
      readOperationalWorkspace(new WorkspaceRepository(env.DB),owner),
      listEventPaperSubscriptions({db:env.DB,owner,limit:null}),
      readSimulationCollectionHeads(new SimulationRepository(env.DB),owner)
    ]);
    const experiments=buildSimulationCollection(heads,workspace?.learningSessions??[],workspace?.simulationDrafts??[]);
    return json({ok:true,...buildWorkspaceCalendar(workspace??{},events,experiments,{month,now,runnersDisabled:env.PREVIEW_RUNNER_STATUS?.().disabled===true})});
  }catch{
    return json({ok:false,message:'캘린더를 불러오지 못했어요. 다시 조회해 주세요.'},503);
  }
}
