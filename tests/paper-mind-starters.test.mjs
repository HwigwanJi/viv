
import test from 'node:test';
import assert from 'node:assert/strict';
import {PAPER_MIND_STARTERS} from '../dist/domain/paper-mind-presets.mjs';
import {openLocalDatabase} from '../server/local-db.mjs';
import {handleMindStudioAPI} from '../server/mind-studio.mjs';
import {WorkspaceRepository} from '../server/repository.mjs';

test('new paper mind and starter policy commit together and replay once',async()=>{
  const local=await openLocalDatabase(':memory:');
  const owner='viv-starter-test';
  const repo=new WorkspaceRepository(local.db);
  const endpoint='http://localhost:4317/api/workspace/';
  const request=async(path,body)=>{
    const response=await handleMindStudioAPI(new Request(endpoint+path,{
      method:body?'POST':'GET',headers:{'Content-Type':'application/json','oai-authenticated-user-id':owner},...(body?{body:JSON.stringify(body)}:{})
    }),{DB:local.db});
    return {status:response.status,data:await response.json()};
  };
  const save=body=>request('mind-documents/policy-draft',body);
  try{
    assert.equal((await request('minds')).status,200);
    const before=await repo.read(owner);
    const preset=PAPER_MIND_STARTERS[0];
    const input={newMind:{name:'새 모의 마인드',settings:{horizon:preset.timeframe}},starterId:preset.id,
      expectedRevision:before.revision,idempotencyKey:'create-starter'};
    assert.equal((await save({...input,starterId:'unknown'})).data.code,'STRATEGY_STARTER_REQUIRED');
    assert.equal((await save({...input,mindId:before.investmentProfiles[0].id})).data.code,'POLICY_DRAFT_INPUT');

    // Fail after the profile and receipt have been staged for the same storage transaction.
    await local.db.prepare("CREATE TRIGGER fail_policy_save BEFORE INSERT ON workspace_objects WHEN NEW.kind='mindDocuments' BEGIN SELECT RAISE(ABORT, 'test policy write failure'); END").bind().run();
    assert.equal((await save(input)).data.ok,false);
    const failed=await repo.read(owner);
    for(const key of ['revision','investmentProfiles','mindDocuments','commandReceipts']){
      assert.deepEqual(failed[key],before[key]);
    }
    await local.db.prepare('DROP TRIGGER fail_policy_save').bind().run();

    const created=await save(input);
    assert.equal(created.status,200,JSON.stringify(created.data).slice(0,400));
    const {document,revision}=created.data;
    assert.equal(revision,before.revision+1);
    assert.equal(document.data.strategyPlan.status,'DRAFT');
    assert.equal(document.data.profileSettings.horizon,preset.timeframe);
    assert.deepEqual(document.data.universe.instrumentIds,preset.universe);
    const replay=await save(input);
    assert.equal(replay.data.idempotent,true);
    assert.equal(replay.data.document.id,document.id);
    assert.equal((await save({...input,starterId:PAPER_MIND_STARTERS[1].id})).data.code,'IDEMPOTENCY_CONFLICT');

    const after=await repo.read(owner);
    const profileId=document.scope.profileId;
    assert.equal(after.investmentProfiles.filter(profile=>profile.id===profileId).length,1);
    assert.equal(after.mindDocuments.filter(entry=>entry.id===document.id).length,1);
    assert.equal(after.commandReceipts.filter(receipt=>receipt.key===input.idempotencyKey).length,1);
    assert.equal(after.mindManifests.find(manifest=>manifest.scope.profileId===profileId).data.strategyPlan,undefined);
    for(const key of ['accounts','deployments','mindSubscriptions']){
      assert.deepEqual(after[key],before[key]);
    }

    const existing=await save({mindId:profileId,starterId:PAPER_MIND_STARTERS[1].id,
      expectedRevision:revision,idempotencyKey:'existing-mind-starter'});
    assert.equal(existing.status,200,JSON.stringify(existing.data).slice(0,400));
    assert.equal(existing.data.document.scope.profileId,profileId);
    assert.equal((await repo.read(owner)).investmentProfiles.length,before.investmentProfiles.length+1);
  }finally{
    local.close();
  }
});

