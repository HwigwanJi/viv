import test from 'node:test';
import assert from 'node:assert/strict';
import {buildWorkspaceCalendar,handleWorkspaceCalendar} from '../server/workspace-calendar.mjs';
import {calendarDay,moveCalendarMonth} from '../dist/system/calendar-date.mjs';
import {createWorkspace,dispatchWorkspaceAction} from '../dist/domain/workspace.mjs';
import {mindAvatarIdentity} from '../dist/ui/mind-avatar.mjs';
import {createWorkspaceCalendar} from '../dist/ui/workspace-calendar.mjs';

test('calendar buckets settled paper PnL by Korean date and preserves currencies',()=>{
  const now='2026-11-15T02:00:00.000Z',month='2026-11';
  const profileId='mind-a',fill=(at,realizedPnl,side='sell')=>({at,realizedPnl,side});
  const workspace={investmentProfiles:[{id:profileId,name:'추세'}],
    mindPositions:[
      {kind:'PAPER_ACCOUNT',profileId,quoteCurrency:'KRW',ledger:[fill('2026-11-11T14:59:00.000Z',-30),fill('2026-11-11T15:00:00.000Z',1200),fill('2026-11-11T15:10:00.000Z',-400),fill('2026-11-11T15:20:00.000Z',0,'buy')]},
      {kind:'PAPER_ACCOUNT',profileId,quoteCurrency:'USDT',ledger:[fill('2026-11-12T07:00:00.000Z',-1.25),fill('2026-11-13T07:00:00.000Z',0),fill('2026-11-14T07:00:00.000Z',null)]}
    ],
    mindSubscriptions:[{profileId,status:'ENABLED',startsAt:'2026-11-15T03:00:00.000Z',endsAt:'2026-11-16T02:00:00.000Z',nextCloseAt:'2026-11-15T04:00:00.000Z'}],
    mindRuns:[{id:'mind-run-paper',profileId,experimentType:'FORWARD_PAPER',decisionAt:'2026-11-12T07:00:00.000Z'},{id:'live',profileId,executionMode:'live',experimentType:'FORWARD_PAPER',decisionAt:'2026-11-12T07:00:00.000Z'}]};
  const experiments=[{name:'진행 중 비교',status:'RUNNING',route:{profileId,simulationId:'backtest-a'}},
    {name:'완료된 비교',status:'COMPLETED',updatedAt:'2026-11-14T07:00:00.000Z',completedAt:'2026-11-13T07:00:00.000Z',metrics:{totalReturn:.15},route:{profileId,simulationId:'backtest-b'}}];
  const data=buildWorkspaceCalendar(workspace,[],experiments,{month,now});
  const byDate=Object.fromEntries(data.days.map(day=>[day.date,day]));
  assert.deepEqual(byDate['2026-11-11'].pnl,[{currency:'KRW',amount:'-30'}]);
  assert.deepEqual(byDate['2026-11-12'].pnl,[{currency:'KRW',amount:'800'},{currency:'USDT',amount:'-1.25'}]);
  assert.equal(byDate['2026-11-12'].entries.filter(x=>x.kind==='activity').length,1);
  assert.deepEqual(byDate['2026-11-13'].pnl,[{currency:'USDT',amount:'0'}]);
  assert.equal(byDate['2026-11-13'].entries.find(x=>x.kind==='experiment').totalReturn,.15);
  assert.equal(byDate['2026-11-14'].unknown,true);
  assert.equal(byDate['2026-11-15'].entries.find(x=>x.label==='다음 판단 예정').at,'2026-11-15T04:05:00.000Z');
  assert.equal(data.active[0].state,'시작 대기');
  assert.match(data.active[1].href,/simulationId=backtest-a/);
  const disabled=buildWorkspaceCalendar(workspace,[],experiments,{month,now,runnersDisabled:true});
  assert.equal(disabled.active[0].state,'실행기 중지');
  assert.ok(!disabled.days.flatMap(d=>d.entries).some(x=>x.label==='다음 판단 예정'));
  assert.equal(calendarDay('2026-11-11T15:00:00Z'),'2026-11-12');
  assert.equal(moveCalendarMonth('2026-12',1),'2027-01');
});

test('calendar only accepts owner-scoped month reads',async()=>{
  const url='https://viv.example/api/workspace/calendar?month=2026-11';
  const headers={'oai-authenticated-user-id':'fixture'};
  assert.equal((await handleWorkspaceCalendar(new Request(url),{},Date.now)).status,401);
  assert.equal((await handleWorkspaceCalendar(new Request(url,{method:'POST',headers}),{},Date.now)).status,405);
  assert.equal((await handleWorkspaceCalendar(new Request(url,{headers:{...headers,Origin:'https://elsewhere.example'}}),{},Date.now)).status,403);
  assert.equal((await handleWorkspaceCalendar(new Request(url+'&month=2026-12',{headers}),{},Date.now)).status,400);
});

test('saved but unstarted experiments appear in the overview without a scheduled date',()=>{
  const states=['CREATED','READY','RUNNING','PAUSED','ACTION_REQUIRED','FAILED','DRAFT','COMPLETED','READY'];
  const experiments=states.map((status,i)=>({name:'experiment '+i,status,route:{simulationId:'sim-'+i},createdAt:'2026-11-13T04:00:00Z',
    ...(i===7?{completedAt:'2026-11-13T04:30:00Z'}:i===8?{archivedAt:'2026-11-13T04:40:00Z'}:{})}));
  const data=buildWorkspaceCalendar({},[],experiments,{month:'2026-11',now:'2026-11-13T05:00:00Z',runnersDisabled:true});
  assert.deepEqual(data.active.map(item=>item.state),['실행 대기','실행 대기','실행 중','일시중지','확인 필요','확인 필요']);
  assert.match(data.active[0].href,/executionMode=paper.*simulationId=sim-0/);
  assert.equal(data.active[0].at,undefined);
  assert.deepEqual(data.days.flatMap(day=>day.entries.map(item=>item.name)),['experiment 7']);
});

test('calendar refreshes the same month when returning from another screen',async()=>{
  const month='2026-11',today='2026-11-13';
  let page='calendar',reads=0;
  const calendar=createWorkspaceCalendar({
    getRoute:()=>({page,params:new URLSearchParams({month,date:today})}),
    request:async()=>({month,today,days:[],active:++reads===1?[{name:'저장한 실험',kind:'experiment',state:'실행 대기',href:'#minds'}]:[]}),
    render:()=>{},
  });
  await calendar.load();
  assert.match(calendar.render(),/저장한 실험/);
  await calendar.load();
  assert.equal(reads,1);
  page='minds';await calendar.load();
  page='calendar';await calendar.load();
  assert.equal(reads,2);
  assert.doesNotMatch(calendar.render(),/저장한 실험/);
});

test('calendar presents active checks before the month and selected date',async()=>{
  const month='2026-11',today='2026-11-12';
  const calendar=createWorkspaceCalendar({
    getRoute:()=>({page:'calendar',params:new URLSearchParams({month,date:today,executionMode:'live'})}),
    request:async()=>({month,today,days:[],active:[{name:'모의 검증',kind:'forward',state:'일시중지',href:'#minds'}]}),
    render:()=>{},
  });
  await calendar.load();
  const markup=calendar.render();
  const order=['id="viv-cal-active-title"','aria-label="월간 캘린더"','id="viv-cal-day-title"'].map(label=>markup.indexOf(label));
  assert.ok(order[0]>=0&&order[0]<order[1]&&order[1]<order[2]);
  const calendarLinks=[...markup.matchAll(/href="(#calendar\?[^"\n]+)"/g)];
  assert.ok(calendarLinks.length>3);
  assert.ok(calendarLinks.every(([,href])=>new URLSearchParams(href.replaceAll('&amp;','&').split('?')[1]).get('executionMode')==='live'));
});

test('character editing saves appearance and display name without a policy revision',()=>{
  const before=createWorkspace({now:'2026-11-10T00:00:00.000Z'}),profile=before.investmentProfiles[0];
  const config=mindAvatarIdentity(profile.id).config;
  const command={type:'profile.appearance.set',idempotencyKey:'avatar-rename',expectedRevision:before.revision,payload:{profileId:profile.id,config,name:'새 표시 이름'}};
  const {workspace}=dispatchWorkspaceAction(before,command,{now:'2026-11-11T00:00:00.000Z'});
  assert.equal(workspace.investmentProfiles[0].displayName,'새 표시 이름');
  assert.deepEqual(workspace.uiPreferences.mindCompanions[profile.id].config,config);
  assert.deepEqual(workspace.profileVersions,before.profileVersions);
  assert.throws(()=>dispatchWorkspaceAction(before,{...command,payload:{...command.payload,name:' '}},{now:'2026-11-11T00:00:00.000Z'}),{code:'INVALID_NAME'});
});

test('returning to the loaded calendar month cancels the discarded month request',async()=>{
  const january='2026-01',february='2026-02',today='2026-01-02';
  let month=january,finish,discardedSignal;
  const calendar=createWorkspaceCalendar({
    getRoute:()=>({page:'calendar',params:new URLSearchParams({month})}),
    request:(url,_body,{signal})=>{
      if(url.endsWith(january))return Promise.resolve({month:january,today,days:[],active:[]});
      discardedSignal=signal;
      return new Promise(resolve=>{finish=()=>resolve({month:february,today,days:[],active:[]});});
    },
    render:()=>{},
  });
  await calendar.load();
  month=february;
  const discarded=calendar.load();
  month=january;
  await calendar.load();
  assert.equal(discardedSignal.aborted,true);
  finish();
  await discarded;
  assert.match(calendar.render(),/id="viv-cal-day-title"/);
});
