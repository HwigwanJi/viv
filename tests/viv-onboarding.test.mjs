import test from 'node:test';
import assert from 'node:assert/strict';
import {handleMcp} from '../server/mcp.mjs';
import {querySimulationCollection} from '../server/simulation-collection.mjs';
import {terminalErrorRecovery} from '../server/terminal-readiness.mjs';
import {openLocalDatabase} from '../server/local-db.mjs';

test('VIV MCP negotiates, guides first use, creates a paper budget and preserves it on replay',async()=>{
  const local=await openLocalDatabase(':memory:');
  try{
    const rpc=async(method,params={},owner='viv-test-owner')=>{
      const response=await handleMcp(new Request('http://localhost:4317/mcp',{method:'POST',headers:{'oai-authenticated-user-id':owner},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})}),{DB:local.db});
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
    assert.equal((await onboarding({action:'pause'})).structuredContent.code,'VIV_PAPER_BUDGET_REQUIRED');
    assert.equal((await onboarding({interest:'both',amountKrw:0,idempotencyKey:'viv-1'})).isError,true);
    const saved=await onboarding({interest:'both',amountKrw:2000000,idempotencyKey:'viv-1'});
    assert.equal(saved.isError,false,JSON.stringify(saved.structuredContent));
    assert.equal(saved.structuredContent.next,'tutorial_offer');
    assert.equal(saved.structuredContent.paperBudget.receipt.totalBudget,2000000);
    assert.match(saved.structuredContent.links.connections,/#settings\?view=accounts&executionMode=live/);
    assert.equal(new URL(saved.structuredContent.links.paperDecision).hash,'#trade?executionMode=paper');
    assert.equal(new URL(saved.structuredContent.links.paperPractice).hash,'#minds?profileId=all&view=simulations&executionMode=paper&setup=new&practice=quant');
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
    assert.equal((await onboarding({action:'pause'})).structuredContent.next,'tutorial_paused');
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
    assert.equal((await tool('read_market_knowledge',{status:'SAVED'})).page.total,2);
    const other=await rpc('tools/call',{name:'read_market_knowledge',arguments:{documentId:analysis.id}},'other-viv-user');
    assert.equal(other.isError,true);
    assert.ok(saved.structuredContent.lessons.slice(0,3).every(lesson=>lesson.tools.includes('save_market_research')));
    const completed=await onboarding({action:'complete',lesson:1,documentId:analysis.id});
    assert.equal(completed.structuredContent.tutorial.completed[0].openUrl,result.openUrl);
    assert.deepEqual(completed.structuredContent.lessons.map(item=>item.number),[2,3,4]);
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
    await Promise.all([2,3].map(lesson=>onboarding({action:'complete',lesson,readOnly:true})));
    const done=(await onboarding({})).structuredContent;
    assert.equal(done.next,'tutorial_complete');
    assert.deepEqual(done.lessons,[]);
    assert.deepEqual(done.tutorial.completed.map(item=>item.number),[1,2,3,4]);
    assert.deepEqual(done.paperBudget,{amountKrw:2000000,existing:true});
    const library=await tool('read_quant_library');
    const quant=await tool('draft_quant_strategy',{name:'VIV 튜토리얼 검사 전략',definition:library.templates[0].definition,expectedRevision:library.revision,idempotencyKey:'viv-strategy'});
    assert.equal(quant.entry.status,'DRAFT');
    assert.match(quant.openUrl,/#library\?view=quant&section=components/);
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
