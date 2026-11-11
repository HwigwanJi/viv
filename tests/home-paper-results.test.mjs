import test from 'node:test';
import assert from 'node:assert/strict';
import {buildHomePerformance,readHomePerformance} from '../server/home-performance.mjs';
import {createHomeShowcase,renderHomeShowcase} from '../dist/ui/home-showcase.mjs';
import {hashInputPackage} from '../dist/domain/workspace.mjs';
import {openLocalDatabase} from '../server/local-db.mjs';
import {WorkspaceRepository} from '../server/repository.mjs';
import {handleMindStudioAPI} from '../server/mind-studio.mjs';
import {handleSimulationAPI} from '../server/simulations.mjs';

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
  assert.match(paper,/search=mind-run-saved[^"]*"[^>]*>[^]*?최근 모의 판단/);
  assert.match(paper,/simulationId=simulation-latest[^"]*"[^>]*>[^]*?최근 완료 실험/);
  const empty=renderHomeShowcase({performance:null},{params:new URLSearchParams()});
  assert.match(empty,/profileId=all[^"]*view=records[^"]*"[^>]*>[^]*?모의 판단 기록/);
  assert.match(empty,/profileId=all[^"]*view=simulations[^"]*"[^>]*>[^]*?백테스트 결과/);
  const live=buildHomePerformance({workspace,executionMode:'live',asOf});
  assert.equal(Object.hasOwn(live,'latestPaperDecision'),false);
  assert.doesNotMatch(renderHomeShowcase({performance:live},{params:new URLSearchParams('executionMode=live')}),/home-paper-results/);
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
