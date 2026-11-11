import test from 'node:test';
import assert from 'node:assert/strict';
import {handleMcp} from '../server/mcp.mjs';
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
    assert.equal((await onboarding({interest:'both',amountKrw:0,idempotencyKey:'viv-1'})).isError,true);
    const saved=await onboarding({interest:'both',amountKrw:2000000,idempotencyKey:'viv-1'});
    assert.equal(saved.isError,false,JSON.stringify(saved.structuredContent));
    assert.equal(saved.structuredContent.next,'tutorial_offer');
    assert.equal(saved.structuredContent.paperBudget.receipt.totalBudget,2000000);
    assert.match(saved.structuredContent.links.connections,/#settings\?view=connections/);
    const repeated=await onboarding({interest:'both',amountKrw:4000000,idempotencyKey:'viv-2'});
    assert.deepEqual(repeated.structuredContent.paperBudget,{amountKrw:2000000,existing:true});
    assert.equal((await onboarding({},'other-viv-user')).structuredContent.next,'ask_interest_and_budget');
  }finally{local.close();}
});
