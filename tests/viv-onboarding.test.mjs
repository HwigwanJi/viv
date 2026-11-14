import test from 'node:test';
import {buildInvestmentStatus} from '../server/investment-read-model.mjs';
import assert from 'node:assert/strict';
import {handleMcp} from '../server/mcp.mjs';
import {disabledExternalKnowledge,marketKnowledgeHash,selectMarketKnowledge} from '../dist/domain/market-knowledge.mjs';
import {querySimulationCollection} from '../server/simulation-collection.mjs';
import {terminalErrorRecovery} from '../server/terminal-readiness.mjs';
import {openLocalDatabase} from '../server/local-db.mjs';
import {handleMindStudioAPI} from '../server/mind-studio.mjs';
import {createPaperMindPresetGraph} from '../dist/domain/paper-mind-presets.mjs';

test('stored paper result reads one owner-scoped record and separates an unknown count from zero',async()=>{
  const record={id:'mind-run-example',profileId:'mind-a',instrumentId:'crypto:okx:BTC-USDT',experimentType:'FORWARD_PAPER',
    timeframe:'4h',asOf:'2026-11-12T08:00:00.000Z',decision:{action:'hold'},execution:{status:'NO_ORDER_REQUIRED'},
    strategyEvaluation:{modules:[{moduleId:'SMA_TREND',ready:true,indicators:{close:80,slowMA:100,lookbackBars:480}}],
      graphEvaluation:{trace:[{nodeId:'trend-decision',output:{decision:{action:'sell',targetWeight:0}}}],output:{currentWeight:0,deltaWeight:0}}}};
  const manifest={data:{strategyPlan:{approval:{enabled:true},scope:{instrumentId:record.instrumentId,timeframe:'4h'},graph:createPaperMindPresetGraph('regime-trend')}}};
  let fills=[];
  const reads=[];
  const studioHandler=request=>{
    const url=new URL(request.url),owner=request.headers.get('oai-authenticated-user-id');
    reads.push({method:request.method,path:url.pathname,id:url.searchParams.get('id'),owner});
    if(owner!=='owner-a')return Response.json({ok:false,code:'RECORD_NOT_FOUND'},{status:404});
    return Response.json({ok:true,decision:{record,manifest,fills,evidence:{notes:['private-source']}}});
  };
  const call=async(overrides={},owner='owner-a')=>{
    const args={view:'result',decisionId:record.id,instrumentId:record.instrumentId,mindId:record.profileId,...overrides};
    const request=new Request('http://localhost:4317/mcp',{method:'POST',headers:{'oai-authenticated-user-id':owner},
      body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'read_trading_context',arguments:args}})});
    return (await (await handleMcp(request,{},{studioHandler})).json()).result;
  };
  const first=await call(),saved=first.structuredContent.result;
  assert.equal(first.isError,false);
  assert.deepEqual(reads,[{method:'GET',path:'/api/workspace/decisions/detail',id:record.id,owner:'owner-a'}]);
  assert.equal(saved.fillCount,0);
  assert.equal(saved.fillSummary,'모의 체결 0건');
  assert.equal(saved.executionStatus,'NO_ORDER_REQUIRED');
  assert.equal(saved.basis.orderReason,'TARGET_ALREADY_REACHED');
  assert.match(saved.basis.explanation,/모의 주문 없이 유지/);
  assert.equal(new URL(saved.openUrl).hash.split('search=')[1],record.id);
  assert.doesNotMatch(first.content[0].text,/private-source/);
  fills=undefined;
  const unknown=(await call()).structuredContent.result;
  assert.equal(unknown.fillCount,null);
  assert.equal(unknown.fillSummary,'모의 체결 미확인');
  assert.equal(unknown.basis.explanation,undefined);
  fills=[{runId:record.id}];
  assert.equal((await call()).structuredContent.result.fillCount,null);
  record.execution.status='FILLED';
  assert.equal((await call()).structuredContent.result.fillCount,1);
  fills=[{runId:'mind-run-unrelated'}];
  assert.equal((await call()).structuredContent.result.fillCount,null);
  fills=[];
  assert.equal((await call()).structuredContent.result.fillCount,null);
  record.execution.status='PARTIALLY_FILLED';
  assert.equal((await call()).structuredContent.result.fillSummary,'모의 체결 미확인');
  record.execution.status='PAPER_REVIEW_READY';
  fills=[{runId:record.id}];
  assert.equal((await call()).structuredContent.result.fillCount,null);
  assert.equal((await call({instrumentId:'crypto:okx:ETH-USDT'})).structuredContent.code,'DECISION_INSTRUMENT_SCOPE');
  assert.equal((await call({mindId:'mind-b'})).structuredContent.code,'DECISION_MIND_SCOPE');
  assert.equal((await call({timeframe:'1h'})).structuredContent.code,'DECISION_TIMEFRAME_SCOPE');
  assert.equal((await call({},'owner-b')).structuredContent.code,'RECORD_NOT_FOUND');
  assert.equal((await call({decisionId:undefined})).structuredContent.code,'INVALID_TOOL_ARGUMENTS');
});

test('VIV MCP negotiates, guides first use, creates a paper budget and preserves it on replay',async()=>{
  const local=await openLocalDatabase(':memory:');
  try{
    const rpc=async(method,params={},owner='viv-test-owner')=>{
      const response=await handleMcp(new Request('http://localhost:4317/mcp?installation=fixture',{method:'POST',headers:{'oai-authenticated-user-id':owner},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})}),{DB:local.db});
      return (await response.json()).result;
    };
    const init=await rpc('initialize',{protocolVersion:'2025-11-25'});
    assert.equal(init.serverInfo.name,'viv');
    assert.equal(init.protocolVersion,'2025-11-25');
    assert.equal((await rpc('prompts/list')).prompts[0].name,'viv_start');
    assert.match((await rpc('prompts/get',{name:'viv_start'})).messages[0].content.text,/튜토리얼이 있습니다/);
    assert.ok((await rpc('tools/list')).tools.some(tool=>tool.name==='viv_onboarding'));
    const onboarding=(args,owner)=>rpc('tools/call',{name:'viv_onboarding',arguments:args},owner);
    assert.equal((await onboarding({})).structuredContent.next,'ask_interest_and_budget');
    const skip=(await onboarding({action:'pause'},'no-budget-skip')).structuredContent;
    assert.equal(skip.next,'tutorial_paused');
    assert.equal(skip.paperBudget,undefined);
    assert.equal((await onboarding({},'no-budget-skip')).structuredContent.next,'tutorial_paused');
    assert.equal((await onboarding({interest:'both',amountKrw:0,idempotencyKey:'viv-1'})).isError,true);
    const saved=await onboarding({interest:'both',amountKrw:2000000,idempotencyKey:'viv-1'});
    assert.equal(saved.isError,false,JSON.stringify(saved.structuredContent));
    assert.equal(saved.structuredContent.next,'tutorial_offer');
    assert.equal(saved.structuredContent.paperBudget.receipt.totalBudget,2000000);
    assert.match(saved.structuredContent.links.connections,/#settings\?view=accounts&executionMode=live/);
    assert.equal(new URL(saved.structuredContent.links.paperHome).hash,'#home?executionMode=paper');
    const firstDecision=new URL(saved.structuredContent.links.paperDecision).hash;
    assert.equal(firstDecision.split('?')[0],'#trade');
    assert.deepEqual(Object.fromEntries(new URLSearchParams(firstDecision.split('?')[1])),{
      executionMode:'paper',firstDecision:'1',instrumentId:'crypto:okx:BTC-USDT',timeframe:'4h'
    });
    assert.equal(new URL(saved.structuredContent.links.paperPractice).hash,'#minds?profileId=all&view=simulations&executionMode=paper&setup=new&practice=quant');
    const briefing=(await rpc('tools/call',{name:'read_investment_status',arguments:{}})).structuredContent;
    assert.deepEqual(briefing.recentDecisions,[]);
    assert.deepEqual(briefing.links,{
      paperDecision:saved.structuredContent.links.paperDecision,
      paperPractice:saved.structuredContent.links.paperPractice,
    });
    assert.match(saved.structuredContent.playbook,/종목·마인드·시각과 일치하는 항목의 openUrl/);
    const repeated=await onboarding({interest:'both',amountKrw:4000000,idempotencyKey:'viv-2'});
    assert.deepEqual(repeated.structuredContent.paperBudget,{amountKrw:2000000,existing:true});
    assert.equal((await onboarding({interest:'stocks',amountKrw:1,idempotencyKey:'repeat-different-interest'})).structuredContent.interest,'both');
    assert.equal((await onboarding({},'other-viv-user')).structuredContent.next,'ask_interest_and_budget');
    const tool=async(name,args={})=>{
      const result=await rpc('tools/call',{name,arguments:args});
      assert.equal(result.isError,false,JSON.stringify(result.structuredContent));
      return result.structuredContent;
    };
    const paused=(await onboarding({action:'pause'})).structuredContent;
    assert.equal(paused.next,'tutorial_paused');
    assert.equal(paused.liveConnection.offer,false);
    assert.equal((await onboarding({})).structuredContent.next,'tutorial_paused');
    assert.equal((await onboarding({action:'resume'})).structuredContent.next,'tutorial_lessons');
    assert.deepEqual((await onboarding({})).structuredContent.lessons.map(item=>item.number),[1,2,3,4]);
    assert.equal((await onboarding({action:'complete',lesson:2})).isError,true);
    assert.equal((await onboarding({action:'complete',lesson:4,decisionId:'unknown-run'})).structuredContent.code,'VIV_TUTORIAL_DECISION_REQUIRED');
    assert.equal((await onboarding({action:'complete',lesson:2,decisionId:'unknown-run'})).isError,true);
    assert.equal((await onboarding({action:'complete',lesson:2,documentId:'missing-note'})).structuredContent.code,'VIV_TUTORIAL_RESULT_REQUIRED');
    const {marketKnowledge}=await tool('read_mind_catalog');
    const document={...marketKnowledge.form.example,title:'VIV 튜토리얼 검사 자료'};
    const knowledge=await tool('write_market_knowledge',{document,expectedRevision:marketKnowledge.revision,idempotencyKey:'viv-note'});
    assert.equal(new URLSearchParams(new URL(knowledge.openUrl).hash.split('?')[1]).get('knowledgeId'),document.id);
    assert.equal((await onboarding({action:'complete',lesson:1,documentId:document.id})).structuredContent.code,'VIV_TUTORIAL_RESULT_REQUIRED');
    const existing=await tool('save_market_research',{documentId:document.id,expectedRevision:knowledge.revision,idempotencyKey:'viv-keep-note'});
    assert.equal(existing.item.status,'SAVED');
    assert.equal(existing.item.contentHash,knowledge.item.contentHash);
    const analysis={...document,id:'viv-analysis',data:{...document.data,lineageId:'viv-analysis'}};
    const save={document:analysis,expectedRevision:existing.revision,idempotencyKey:'viv-analysis'};
    const result=await tool('save_market_research',save);
    assert.equal(result.item.status,'SAVED');
    assert.deepEqual(result.effect,{action:'LIBRARY_SAVE',scope:'PERSONAL_LIBRARY',mindUseChanged:false});
    assert.match(result.openUrl,/knowledgeId=viv-analysis/);
    assert.equal((await tool('save_market_research',save)).item.id,result.item.id);
    const reloaded=await tool('read_market_knowledge',{documentId:analysis.id});
    assert.equal(reloaded.entry.status,'SAVED');
    assert.equal(reloaded.entry.review,null);
    assert.equal(reloaded.entry.classificationRecord,null);
    assert.deepEqual(reloaded.usage.eligibleMinds,[]);
    assert.equal(reloaded.openUrl,result.openUrl);
    const found=await tool('read_market_knowledge',{status:'SAVED'});
    assert.equal(found.page.total,2);
    assert.equal(found.page.items.find(item=>item.id===analysis.id).openUrl,result.openUrl);
    const undated=structuredClone(analysis);
    undated.id=undated.data.lineageId='viv-undated-analysis';
    undated.source.uri='https://example.com/undated';
    Object.assign(undated.data.publication,{precision:'undated',publishedAt:null,sourcePublishedValue:null,timezone:null});
    const undatedSave={expectedRevision:result.revision,idempotencyKey:'viv-undated'};
    const stale=await rpc('tools/call',{name:'save_market_research',arguments:{...undatedSave,document:undated,expectedRevision:existing.revision}});
    assert.equal(stale.structuredContent.code,'REVISION_CONFLICT');
    const revision=(await tool('read_market_knowledge')).revision;
    const undatedResult=await tool('save_market_research',{...undatedSave,document:undated,expectedRevision:revision});
    assert.equal((await tool('save_market_research',{...undatedSave,document:undated})).item.contentHash,undatedResult.item.contentHash);
    assert.equal(undatedResult.item.status,'SAVED');
    assert.equal(undatedResult.item.publishedAt,null);
    assert.equal((await tool('read_market_knowledge',{status:'SAVED'})).page.total,3);
    const claimedTime=structuredClone(undated);
    claimedTime.id=claimedTime.data.lineageId='viv-undated-claimed-time';
    claimedTime.data.publication.publishedAt=analysis.data.publication.publishedAt;
    const rejected=await rpc('tools/call',{name:'save_market_research',arguments:{...undatedSave,document:claimedTime,expectedRevision:undatedResult.revision,idempotencyKey:'viv-undated-invalid'}});
    assert.equal(rejected.structuredContent.code,'KNOWLEDGE_PUBLICATION');
    const classification=await rpc('tools/call',{name:'classify_market_knowledge',arguments:{documentId:undated.id,expectedRevision:undatedResult.revision,idempotencyKey:'viv-undated-classify'}});
    assert.equal(classification.structuredContent.code,'KNOWLEDGE_PUBLICATION_REQUIRED');
    const manifest={data:{universe:{},externalKnowledge:{...disabledExternalKnowledge(),enabled:true,mode:'subscribed',sourceTypes:[undated.data.sourceType]}}};
    const now=undated.availableAt,asApproved=document=>{
      const contentHash=marketKnowledgeHash(document);
      return {id:document.id,document,contentHash,status:'APPROVED',importedAt:now,availableAt:now,review:{reviewedAt:now},classificationRecord:{contentHash,provider:{answeredAt:now},classification:{level:'macro',horizon:'short_term',sentiment:'neutral',novelty:'known',scopeKind:'global'}}};
    };
    const approved=[asApproved(analysis),asApproved(undated)];
    for(const historicalReplay of [null,{contract:'PUBLICATION_TIME_RESEARCH_V1',frozenAt:now}]){
      const selected=selectMarketKnowledge(approved,manifest,{id:'test'},now,{historicalReplay});
      assert.deepEqual(selected.selected.map(x=>x.id),[analysis.id]);
      assert.deepEqual(selected.excluded,[{id:undated.id,reason:'PUBLICATION_TIME_UNVERIFIED'}]);
    }
    const linkResult=await onboarding({action:'complete',lesson:3,documentId:undated.id});
    assert.equal(linkResult.structuredContent.tutorial.completed.find(item=>item.number===3)?.openUrl,undatedResult.openUrl);
    await onboarding({action:'pause'});
    assert.equal((await onboarding({action:'resume'})).structuredContent.tutorial.completed.find(item=>item.number===3)?.openUrl,undatedResult.openUrl);
    const other=await rpc('tools/call',{name:'read_market_knowledge',arguments:{documentId:analysis.id}},'other-viv-user');
    assert.equal(other.isError,true);
    assert.ok(saved.structuredContent.lessons.slice(0,3).every(lesson=>lesson.tools.includes('save_market_research')));
    const completed=await onboarding({action:'complete',lesson:1,documentId:analysis.id});
    assert.equal(completed.structuredContent.tutorial.completed[0].openUrl,result.openUrl);
    assert.deepEqual(completed.structuredContent.lessons.map(item=>item.number),[2,4]);
    await onboarding({action:'complete',lesson:1,readOnly:true});
    assert.equal((await onboarding({})).structuredContent.tutorial.completed[0].documentId,analysis.id);
    await onboarding({action:'pause'});
    const whilePaused=await onboarding({action:'complete',lesson:4});
    assert.equal(whilePaused.structuredContent.next,'tutorial_paused');
    const otherSetup=await onboarding({interest:'stocks',amountKrw:5000,idempotencyKey:'other-setup'},'other-viv-user');
    assert.equal(otherSetup.structuredContent.next,'tutorial_offer');
    assert.match(otherSetup.structuredContent.lessons[0].title,/주식 시장/);
    const otherReturned=(await onboarding({},'other-viv-user')).structuredContent;
    assert.equal(otherReturned.interest,'stocks');
    assert.match(otherReturned.lessons[0].title,/주식 시장/);
    assert.deepEqual(otherSetup.structuredContent.tutorial.completed,[]);
    assert.equal((await onboarding({action:'complete',lesson:1,documentId:analysis.id},'other-viv-user')).structuredContent.code,'VIV_TUTORIAL_RESULT_REQUIRED');
    await onboarding({action:'resume'});
    const finalLessons=await Promise.all([2,3].map(lesson=>onboarding({action:'complete',lesson,readOnly:true})));
    assert.equal(finalLessons.filter(result=>result.structuredContent.liveConnection.offer).length,1);
    const done=(await onboarding({})).structuredContent;
    assert.equal(done.next,'tutorial_complete');
    assert.deepEqual(done.lessons,[]);
    assert.deepEqual(done.tutorial.completed.map(item=>item.number),[1,2,3,4]);
    assert.deepEqual(done.liveConnection,{offer:false,deferred:false});
    assert.equal((await onboarding({action:'complete',lesson:4})).structuredContent.liveConnection.offer,false);
    assert.deepEqual((await onboarding({action:'defer_connection'})).structuredContent.liveConnection,{offer:false,deferred:true});
    assert.deepEqual((await onboarding({action:'resume'})).structuredContent.liveConnection,{offer:false,deferred:true});
    const earlyChoice=(await onboarding({action:'defer_connection'},'no-budget-owner')).structuredContent;
    assert.equal(earlyChoice.next,'ask_interest_and_budget');
    assert.deepEqual(earlyChoice.liveConnection,{offer:false,deferred:true});
    const laterSetup=(await onboarding({interest:'both',amountKrw:1000000,idempotencyKey:'later-budget'},'no-budget-owner')).structuredContent;
    assert.deepEqual(laterSetup.liveConnection,{offer:false,deferred:true});
    await onboarding({action:'resume'},'no-budget-owner');
    for(const lesson of [1,2,3])await onboarding({action:'complete',lesson,readOnly:true},'no-budget-owner');
    const finishedAfterDeferral=(await onboarding({action:'complete',lesson:4},'no-budget-owner')).structuredContent;
    assert.equal(finishedAfterDeferral.next,'tutorial_complete');
    assert.deepEqual(finishedAfterDeferral.liveConnection,{offer:false,deferred:true});
    assert.match(finishedAfterDeferral.links.connections,/#settings\?view=accounts&executionMode=live/);
    assert.deepEqual(done.paperBudget,{amountKrw:2000000,existing:true});
    const library=await tool('read_quant_library');
    const quant=await tool('draft_quant_strategy',{name:'VIV 튜토리얼 검사 전략',definition:library.templates[0].definition,expectedRevision:library.revision,idempotencyKey:'viv-strategy'});
    assert.equal(quant.entry.status,'DRAFT');
    assert.match(quant.openUrl,/#library\?view=quant&section=components/);
  }finally{local.close();}
});

test('VIV reopens a saved paper decision without setting up a KRW budget',async()=>{
  const local=await openLocalDatabase(':memory:');
  const decision={id:'mind-run-saved',profileId:'mind-a',instrumentId:'crypto:okx:BTC-USDT',experimentType:'FORWARD_PAPER',decisionAt:'2026-01-01T00:00:00.000Z',decision:{action:'hold'}};
  const studioHandler=request=>{
    assert.equal(request.method,'GET');
    assert.equal(new URL(request.url).pathname,'/api/workspace');
    const owner=request.headers.get('oai-authenticated-user-id');
    const mindRuns=owner==='owner-a'?[
      decision,
      {...decision,id:'mind-run-failed',decisionAt:'2026-01-02T00:00:00.000Z',status:'FAILED'},
      {...decision,id:'mind-run-screening',decisionAt:'2026-01-02T00:00:00.000Z',execution:{status:'SCREENING_ONLY'}},
      {...decision,id:'mind-run-live',decisionAt:'2026-01-03T00:00:00.000Z',executionMode:'live'},
      {...decision,id:'mind-run-replay',decisionAt:'2026-01-04T00:00:00.000Z',mode:'replay'},
    ]:[];
    return Response.json({ok:true,workspace:{revision:1,mindRuns}});
  };
  const onboarding=async(args={},owner='owner-a')=>{
    const request=new Request('http://localhost:4317/mcp',{method:'POST',headers:{'oai-authenticated-user-id':owner},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'viv_onboarding',arguments:args}})});
    return (await (await handleMcp(request,{DB:local.db},{studioHandler,installation:'a'.repeat(32)})).json()).result.structuredContent;
  };
  try{
    const first=await onboarding();
    assert.equal(first.next,'tutorial_offer');
    assert.equal(first.paperBudget,undefined);
    assert.deepEqual(first.tutorial.completed,[]);
    const {decisionId,mindId,instrumentId,openUrl}=first.savedPaperDecision;
    assert.deepEqual({decisionId,mindId,instrumentId},{decisionId:decision.id,mindId:decision.profileId,instrumentId:decision.instrumentId});
    assert.equal(new URLSearchParams(new URL(openUrl).hash.split('?')[1]).get('search'),decision.id);
    assert.equal(first.links.paperResume,openUrl);
    assert.equal(new URL(openUrl).searchParams.get('installation'),'a'.repeat(32));
    assert.equal((await onboarding({},'owner-b')).savedPaperDecision,undefined);
    assert.equal((await onboarding({action:'resume'})).next,'tutorial_lessons');
    assert.equal((await onboarding({action:'pause'})).next,'tutorial_paused');
    assert.equal((await onboarding()).links.paperResume,openUrl);
    const complete={action:'complete',lesson:4,decisionId};
    assert.equal((await onboarding(complete,'owner-b')).code,'VIV_TUTORIAL_DECISION_REQUIRED');
    assert.equal((await onboarding({...complete,decisionId:'mind-run-screening'})).code,'VIV_TUTORIAL_DECISION_REQUIRED');
    const finished=await onboarding(complete);
    assert.equal(finished.paperBudget,undefined);
    assert.equal(finished.tutorial.completed[0].openUrl,openUrl);
  }finally{local.close();}
});

test('VIV resumes a completed keyless practice with its own saved report',async()=>{
  const local=await openLocalDatabase(':memory:');
  const id='simulation-practice';
  const onboarding=async(args,owner='practice-owner')=>{
    const request=new Request('http://localhost:4317/mcp',{method:'POST',headers:{'oai-authenticated-user-id':owner},
      body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'viv_onboarding',arguments:args}})});
    const response=await handleMcp(request,{DB:local.db},{studioHandler:(request,env,options)=>{
      const url=new URL(request.url);
      if(!url.pathname.endsWith('/simulations/item'))return handleMindStudioAPI(request,env,options);
      const item=url.searchParams.get('id');
      if(request.headers.get('oai-authenticated-user-id')!=='practice-owner')return Response.json({code:'SIMULATION_NOT_FOUND'},{status:404});
      return Response.json({simulation:{id:item,status:item===id||item==='ai-backtest'?'COMPLETED':'CREATED',report:{},config:{mode:item==='ai-backtest'?'JEV_RETROSPECTIVE':'MECHANICAL'}}});
    }});
    return (await response.json()).result.structuredContent;
  };
  try{
    const setup={interest:'crypto',amountKrw:1000000,idempotencyKey:'practice-setup'};
    await onboarding(setup,'other-owner');
    const complete={action:'complete',lesson:4};
    for(const simulationId of ['unfinished','ai-backtest']){
      assert.equal((await onboarding({...complete,simulationId})).code,'VIV_TUTORIAL_SIMULATION_REQUIRED');
    }
    assert.equal((await onboarding({...complete,simulationId:id},'other-owner')).code,'VIV_TUTORIAL_SIMULATION_REQUIRED');
    assert.equal((await onboarding({...complete,simulationId:id,decisionId:'other-kind'})).code,'INVALID_TOOL_ARGUMENTS');
    const finished=await onboarding({...complete,simulationId:id});
    assert.equal(finished.paperBudget,undefined);
    assert.ok(!finished.lessons.some(lesson=>lesson.number===4));
    const [receipt]=finished.tutorial.completed;
    assert.equal(receipt.simulationId,id);
    assert.equal(new URL(receipt.openUrl).hash,'#minds?profileId=all&view=simulations&executionMode=paper&simulationId='+id+'&tab=report');
    assert.equal(finished.links.paperResume,receipt.openUrl);
    assert.equal(new URLSearchParams(new URL(finished.links.connections).hash.split('?')[1]).get('returnTo'),new URL(receipt.openUrl).hash);
    const deferred=await onboarding({action:'defer_connection'});
    assert.equal(deferred.links.paperResume,receipt.openUrl);
    assert.deepEqual(deferred.liveConnection,{offer:false,deferred:true});
    await onboarding(complete);
    await onboarding({action:'pause'});
    const resumed=await onboarding({action:'resume'});
    assert.deepEqual(resumed.tutorial.completed,[receipt]);
    assert.deepEqual((await onboarding({},'other-owner')).tutorial.completed,[]);
  }finally{local.close();}
});

test('MCP finds the exact saved experiment and links to the owner’s paper workspace',async()=>{
  const owner='viv-test-owner',id='simulation-first',createdAt='2026-11-11T01:00:00.000Z';
  const row={id,kind:'simulation',name:'기준 퀀트 전략',status:'COMPLETED',createdAt,mindIds:['mind-a'],
    route:{profileId:'mind-a',simulationId:id,lab:null,tab:'overview'}};
  const rpc=async(q,caller=owner)=>{
    const response=await handleMcp(new Request('http://localhost:4370/mcp',{
      method:'POST',headers:{'oai-authenticated-user-id':caller},
      body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'read_simulation_collection',arguments:{q,status:'completed'}}}),
    }),{}, {studioHandler:request=>{
      assert.equal(request.method,'GET');
      const caller=request.headers.get('oai-authenticated-user-id');
      return Response.json(querySimulationCollection(caller===owner?[row]:[],new URL(request.url).searchParams,
        {owner:caller,now:'2026-11-11T02:00:00.000Z'}));
    }});
    const {result}=await response.json();
    assert.equal(result.isError,false);
    return result.structuredContent.items;
  };
  const [saved]=await rpc(id);
  assert.equal(saved.openUrl,'http://localhost:4370/#minds?view=simulations&executionMode=paper&profileId=mind-a&simulationId=simulation-first&tab=overview');
  assert.equal((await rpc(row.name))[0].openUrl,saved.openUrl);
  assert.deepEqual(await rpc(id,'other-owner'),[]);
});

test('explicit JEV access rejection opens key recovery and unknown outcomes keep the evidence action',()=>{
  for(const [code,httpStatus] of [['MIND_JEV_HTTP',401],['JEV_QUESTION_HTTP',403]]){
    const result=terminalErrorRecovery({code,provider:{httpStatus,requestId:'test'}});
    assert.equal(result.category,'JEV_AUTH');
    assert.equal(result.action.action,'connections');
    assert.equal(result.action.retryPolicy,'AFTER_CORRECTION');
    assert.equal(result.requestId,'test');
  }
  const unknown=terminalErrorRecovery({code:'MIND_JEV_NETWORK',provider:{httpStatus:null}});
  assert.equal(unknown.action.retryPolicy,'INSPECT_EXISTING_ATTEMPT');
  const providerError=terminalErrorRecovery({code:'MIND_JEV_HTTP',provider:{httpStatus:502}});
  assert.equal(providerError.action.action,'records');
  const marketAuth=terminalErrorRecovery({code:'MARKET_UNAVAILABLE',diagnostic:{httpStatus:401}});
  assert.equal(marketAuth.category,'CONNECTION');
});


test('briefing keeps the decision and the exact paper fill state separate',()=>{
  const now='2026-11-14T05:00:00.000Z';
  const run={id:'mind-run-example',profileId:'paper-mind',experimentType:'FORWARD_PAPER',decisionAt:now,
    status:'PAPER_REVIEW_READY',decision:{action:'buy'},execution:{status:'WAITING_EXECUTION_DATA'}};
  const fill={runId:run.id};
  const read=(status,ledger)=>{
    const workspace={revision:1,investmentProfiles:[{id:run.profileId,name:'Paper mind'}],
      mindRuns:[{...run,execution:{status}}],mindPositions:[{kind:'PAPER_ACCOUNT',profileId:run.profileId,ledger}]};
    const [row]=buildInvestmentStatus({workspace},{now}).recentDecisions;
    assert.equal(row.action,'buy');
    assert.equal(row.status,'PAPER_REVIEW_READY');
    assert.equal(row.executionStatus,status);
    return row.fillCount;
  };
  assert.equal(read('WAITING_EXECUTION_DATA',[]),0);
  assert.equal(read('FILLED',[fill]),1);
  assert.equal(read('FILLED',[]),null);
});
