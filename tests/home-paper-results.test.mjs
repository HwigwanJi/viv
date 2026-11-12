import test from 'node:test';
import assert from 'node:assert/strict';
import {buildHomePerformance,readHomePerformance} from '../server/home-performance.mjs';
import {createHomeShowcase,renderHomeShowcase} from '../dist/ui/home-showcase.mjs';
import {simulationCostSummary} from '../dist/ui/simulation-editor-state.mjs';
import {simulationMarketScope} from '../dist/ui/simulation-asset-scope.mjs';
import {createSimulationPlayground} from '../dist/ui/simulation-playground.mjs';
import {hashInputPackage} from '../dist/domain/workspace.mjs';
import {openLocalDatabase} from '../server/local-db.mjs';
import {WorkspaceRepository} from '../server/repository.mjs';
import {handleMindStudioAPI} from '../server/mind-studio.mjs';
import {handleSimulationAPI} from '../server/simulations.mjs';

test('saved keyless practice shows its inputs before the only execute button',async()=>{
  let simulation={
    id:'practice-saved',status:'CREATED',config:{
      mindId:'mind-a',name:'저장한 실습',mode:'MECHANICAL',initialCash:13579,feeBps:13,slippageBps:2,
      startAt:'2026-09-15T00:00:00.000Z',endAt:'2026-10-15T00:00:00.000Z',
    },progress:{processed:0},
  };
  const app=createSimulationPlayground({
    getRoute:()=>({page:'minds',params:new URLSearchParams('view=simulations&profileId=all&simulationId=practice-saved&executionMode=paper')}),
    request:async(path,body)=>{
      assert.equal(path,'/api/workspace/simulations/item?id=practice-saved');
      assert.equal(body,undefined);
      return {simulation};
    },
  });
  await app.load();
  const html=app.render();
  assert.match(html,/aria-current="page"[^>]*>저장한 조건/);
  assert.match(html,/저장한 실행 조건[^]*13,579\.00 USDT[^]*13\.0bp[^]*2\.0bp[^]*AI 호출[^]*0회[^]*data-simulation-action="run"/);
  assert.equal([...html.matchAll(/data-simulation-action="run"/g)].length,1);
  assert.doesNotMatch(html,/data-simulation-equity/);

  simulation={...simulation,modelReadiness:{readyDecisions:0,totalDecisions:5,warmupDecisions:5}};
  await app.load({force:true});
  assert.match(app.render(),/모델 준비 자료 필요[^]*저장한 실행 조건[^]*data-simulation-action="run"[^>]*disabled/);
});

test('repeat opens read-only review and cancellation restores the same report',async()=>{
  const saved={
    id:'original',status:'COMPLETED',config:{
      mindId:'mind-a',name:'원본',mode:'MECHANICAL',startAt:'2026-09-15T00:00:00Z',
      endAt:'2026-10-15T00:00:00Z',initialCash:13579,feeBps:13,slippageBps:2,
    },
  };
  const params=new URLSearchParams('view=simulations&simulationId=original&tab=report&executionMode=paper');
  const handlers=[];
  const document=globalThis.document;
  globalThis.document={addEventListener(type,handler,capture){if(type==='click'&&!capture)handlers.push(handler);},removeEventListener(){}};
  const app=createSimulationPlayground({
    getRoute:()=>({page:'minds',params}),
    getMinds:()=>[{id:'mind-a',name:'마인드'}],
    navigate(_page,changes){for(const [key,value] of Object.entries(changes))value===null?params.delete(key):params.set(key,value);},
    request:async(path,body)=>{
      assert.equal(body,undefined);
      if(path.endsWith('/item?id=original'))return {simulation:saved};
      if(path.endsWith('/report?id=original&format=json'))return {reportId:'original',hash:'original-hash'};
      const url=new URL(path,'https://example.invalid');
      assert.ok(url.pathname.endsWith('/capabilities'));
      assert.equal(url.searchParams.get('sourceSimulationId'),'original');
      return {canCreate:true,preflight:{ok:true}};
    },
  });
  const click=action=>handlers.at(-1)({preventDefault(){},target:{closest:()=>({dataset:{simulationAction:action,simulationId:'original'}})}});
  try{
    app.start();
    await app.load();
    await click('repeat');
    assert.equal(params.get('setupStep'),'review');
    assert.match(app.render(),/data-setup-step="review"[^]*13,579[^]*예상 최대 AI 호출[^]*0회[^]*새 실험 저장/);
    await click('cancel');
    assert.equal(params.has('setupStep'),false);
    assert.equal(params.get('simulationId'),'original');
    assert.equal(params.get('tab'),'report');
    assert.match(app.render(),/저장 보고서[^]*original-hash/);
  }finally{
    app.destroy();
    if(document===undefined)delete globalThis.document;
    else globalThis.document=document;
  }
});

test('JSON download uses the report shown with its original fingerprint',async()=>{
  const params=new URLSearchParams('view=simulations&simulationId=original&tab=report&executionMode=paper');
  const original={
    id:'original',status:'COMPLETED',config:{mindId:'mind-a',name:'원본',mode:'MECHANICAL'},
  };
  const report={reportId:'original',format:'json',hash:'visible-hash',filename:'original.json',text:'{"snapshot":1}'};
  const downloads=[],reads=[],handlers=[];
  const document=globalThis.document;
  globalThis.document={addEventListener(type,handler,capture){if(type==='click'&&!capture)handlers.push(handler);},removeEventListener(){}};
  const app=createSimulationPlayground({
    getRoute:()=>({page:'minds',params}),
    request:async(path)=>{
      reads.push(path);
      if(path.endsWith('/item?id=original'))return {simulation:original};
      if(path.endsWith('/report?id=original&format=json'))return {...report};
      assert.equal(path,'/api/workspace/simulations/report?id=original&format=csv');
      return {reportId:'original',filename:'original.csv',text:'kind,sequence'};
    },
    download:(...value)=>downloads.push(value),
  });
  const download=id=>handlers.at(-1)({preventDefault(){},target:{closest:()=>({dataset:{simulationAction:'download',simulationId:id}})}});
  try{
    app.start();
    await app.load();
    assert.match(app.render(),/보고서 정보[^]*보고서 ID[^]*원본 식별값[^]*visible-hash[^]*SHA-256/);
    await download('json');
    assert.equal(reads.filter(path=>path.includes('format=json')).length,1);
    assert.deepEqual(downloads[0],['viv-original.json',report.text,'application/json']);
    await download('csv');
    assert.deepEqual(downloads[1],['viv-original.csv','kind,sequence','text/csv']);
  }finally{
    app.destroy();
    if(document===undefined)delete globalThis.document;
    else globalThis.document=document;
  }
});

test('saved AI experiment shows its call ceiling before execute',async()=>{
  const simulation={
    id:'paid-copy',status:'CREATED',config:{mindId:'mind-a',name:'재검증',mode:'JEV_RETROSPECTIVE',optInJev:true,maxJevCalls:42},
    jevBudget:{maximum:42,completed:0},
  };
  const app=createSimulationPlayground({
    getRoute:()=>({page:'minds',params:new URLSearchParams('view=simulations&simulationId=paid-copy&executionMode=paper')}),
    request:async(path,body)=>{
      assert.equal(path,'/api/workspace/simulations/item?id=paid-copy');
      assert.equal(body,undefined);
      return {simulation};
    },
  });
  await app.load();
  assert.match(app.render(),/AI 호출 상한 42회 · 제공사 요금 적용 가능[^]*data-simulation-action="run"/);
});

test('simulation cost summary uses the account currency and retains BTC precision',()=>{
  const draft={assetMode:'UPBIT_BTC_PORTFOLIO',initialCash:0.00123456,feeBps:10,slippageBps:2.5};
  assert.equal(simulationCostSummary(draft,simulationMarketScope(draft)),'0.00123456 BTC · 수수료 10bp · 슬리피지 2.5bp');
});

test('paper home links to saved decisions and latest completed experiments independently of rankings',()=>{
  const at=hour=>`2026-11-11T${hour}:00:00.000Z`;
  const asOf=at('12');
  const run={profileId:'mind-a',experimentType:'FORWARD_PAPER',mode:'live',decisionAt:at('08'),decision:{action:'hold'},status:'COMPLETED'};
  const workspace={investmentProfiles:[{id:'mind-a',name:'추세형'}],mindRuns:[
    {...run,id:'mind-run-saved',decisionCompletedAt:at('10')},
    {...run,id:'mind-run-failed',decisionCompletedAt:at('11'),status:'FAILED'},
    {...run,id:'mind-run-replay',decisionCompletedAt:at('11'),mode:'replay'},
    {...run,id:'mind-run-future',decisionCompletedAt:at('13')},
  ]};
  const report=(simulationId,completedAt,metrics)=>{
    const body={simulationId,name:simulationId,completedAt,status:'COMPLETED',config:{mindId:'mind-a'},
      source:{synthetic:false},metrics,coverage:{warmupFrames:0,totalDecisionFrames:5,readyFrames:5}};
    return {report:{...body,reportHash:hashInputPackage(body)}};
  };
  const winner=report('simulation-winner',at('09'),{totalReturn:.1,maxDrawdown:.05,tradeCount:1});
  const latest=report('simulation-latest',at('11'),null);
  const performance=buildHomePerformance({workspace,simulationHighlights:[latest,winner],asOf});
  assert.equal(performance.latestPaperDecision.id,'mind-run-saved');
  assert.equal(performance.latestPaperExperiment.simulationId,'simulation-latest');
  assert.equal(performance.experimentBest.simulationId,'simulation-winner');
  const paper=renderHomeShowcase({performance},{params:new URLSearchParams()});
  assert.match(paper,/href="#[^"]*profileId=all[^"]*view=simulations[^"]*"[^>]*>전체 시뮬레이션/);
  assert.match(paper,/search=mind-run-saved[^"]*"[^>]*>[^]*?최근 모의 판단/);
  assert.match(paper,/simulationId=simulation-latest[^"]*"[^>]*>[^]*?최근 완료 실험/);
  const empty=renderHomeShowcase({performance:null},{params:new URLSearchParams()});
  assert.match(empty,/profileId=all[^"]*view=records[^"]*"[^>]*>[^]*?모의 판단 기록/);
  assert.match(empty,/profileId=all[^"]*view=simulations[^"]*"[^>]*>[^]*?백테스트 결과/);
  const first=renderHomeShowcase({performance:{...performance,latestPaperDecision:null}},{params:new URLSearchParams()});
  assert.match(first,/<a [^>]*href="#trade\?[^"]*firstDecision=1[^"]*"[^>]*><span><strong>첫 모의 판단<\/strong>/);
  const live=buildHomePerformance({workspace,executionMode:'live',asOf});
  assert.equal(Object.hasOwn(live,'latestPaperDecision'),false);
  assert.doesNotMatch(renderHomeShowcase({performance:live},{params:new URLSearchParams('executionMode=live')}),/home-paper-results/);
  assert.doesNotMatch(renderHomeShowcase({performance:live},{params:new URLSearchParams('executionMode=live')}),/>전체 시뮬레이션/);
});

test('paper decision links render while the market summary is still loading',async()=>{
  let resolveMarket;
  const market=new Promise(resolve=>{resolveMarket=resolve;});
  const home=createHomeShowcase({
    getRoute:()=>({page:'home',params:new URLSearchParams('executionMode=paper')}),
    request:async path=>path.includes('home-performance?')?{performance:{latestPaperDecision:null},revision:1}:market,
  });
  const pending=home.load();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(home.state().marketReadPending,true);
  assert.match(home.render(),/<strong>첫 모의 판단<\/strong>/);
  resolveMarket({});
  await pending;
  assert.equal(home.state().marketReadPending,false);
});

test('returning to paper home reloads completed experiments at the same workspace revision',async()=>{
  let page='home';
  const reads=[];
  const home=createHomeShowcase({
    getRoute:()=>({page,params:new URLSearchParams('executionMode=paper')}),
    getWorkspace:()=>({revision:1}),
    request:async path=>{
      if(path.includes('home-performance?'))reads.push(new URL(path,'http://localhost').searchParams);
      return {performance:{},revision:1};
    },
  });
  await home.load();
  await home.load();
  assert.equal(reads.length,1);
  page='minds';
  await home.load();
  page='home';
  await home.load();
  assert.equal(reads.length,2);
  assert.equal(reads[1].has('refreshValuations'),false);
});

test('fresh owner can prepare a BTC practice and resume without publishing or configuring keys',async()=>{
  const local=await openLocalDatabase(':memory:');
  const owner='practice-owner',repository=new WorkspaceRepository(local.db);
  const base='http://localhost/api/workspace/';
  const now='2026-11-11T18:00:00.000Z';
  const request=(path,body)=>new Request(base+path,{
    method:body?'POST':'GET',headers:{'Content-Type':'application/json','oai-authenticated-user-id':owner},
    ...(body?{body:JSON.stringify(body)}:{}),
  });
  const env={DB:local.db};
  const api=async(path,body)=>{
    const response=await handleSimulationAPI(request('simulations/'+path,body),env,{now});
    return {status:response.status,data:await response.json()};
  };
  try{
    assert.equal((await handleMindStudioAPI(request('minds'),env,{now})).status,200);
    const before=await repository.read(owner);
    const mindId=before.investmentProfiles[0].id;
    assert.equal(before.mindManifests.length,0);
    const mechanical=(await api('capabilities?mindId='+mindId+'&mode=MECHANICAL')).data;
    assert.equal(mechanical.canCreate,true);
    assert.equal(mechanical.policySource,'WORKSPACE_BASELINE');
    const graph=(await api('capabilities?mindId='+mindId+'&mode=GRAPH_CANONICAL')).data;
    assert.equal(graph.canCreate,false);
    assert.ok(graph.blockedReasons.some(reason=>reason.code==='PUBLISHED_MIND_REQUIRED'));

    const saved=await api('create',{
      mindId,mode:'MECHANICAL',name:'첫 BTC 실습',startAt:'2026-10-01T00:00:00.000Z',
      endAt:'2026-10-15T00:00:00.000Z',initialCash:10000,feeBps:10,slippageBps:5,optInJev:false,
      maxJevCalls:0,expectedRevision:before.revision,idempotencyKey:'practice-create',
    });
    assert.equal(saved.status,200,saved.data.message);
    const simulation=saved.data.simulation;
    assert.equal(simulation.manifest.id,mechanical.currentManifest.id);
    assert.equal(simulation.status,'CREATED');
    assert.equal(simulation.jevBudget.maximum,0);
    assert.deepEqual(await repository.read(owner),before);

    const home=async(ownerId=owner,executionMode='paper')=>(await readHomePerformance({
      repository,db:local.db,ownerId,executionMode,now,
    })).performance;
    const prepared=await home();
    assert.deepEqual({...prepared.pendingPaperPractice},{simulationId:simulation.id,profileId:mindId,name:'첫 BTC 실습'});
    assert.equal((await home(owner,'live')).pendingPaperPractice,undefined);
    const another=request('minds');
    another.headers.set('oai-authenticated-user-id','other-practice-owner');
    assert.equal((await handleMindStudioAPI(another,env,{now})).status,200);
    assert.equal((await home('other-practice-owner')).pendingPaperPractice,undefined);

    const route={params:new URLSearchParams()};
    assert.match(renderHomeShowcase({performance:prepared},route),new RegExp('simulationId='+simulation.id+'[^]*?백테스트 이어하기'));
    assert.match(renderHomeShowcase({performance:{...prepared,pendingPaperPractice:null}},route),/practice=quant[^]*?첫 백테스트 실습/);
  }finally{local.close();}
});
