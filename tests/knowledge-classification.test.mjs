import test from 'node:test';
import assert from 'node:assert/strict';
import {openLocalDatabase} from '../server/local-db.mjs';
import {handleMindStudioAPI} from '../server/mind-studio.mjs';
import {acquireClaim} from '../server/claims.mjs';
import {hashInputPackage} from '../dist/domain/workspace.mjs';

test('market knowledge retains one JEV outcome when another tab saves during classification',async()=>{
  const local=await openLocalDatabase(':memory:');
  try{
    const env={DB:local.db,TYPESAFE_API_KEY:'isolated-fixture'};
    let calls=0;
    const arrived=Promise.withResolvers(),resume=Promise.withResolvers();
    const fetchImpl=async(_url,{body})=>{
      calls++;
      arrived.resolve();
      await resume.promise;
      const request=JSON.parse(body);
      return Response.json({model:'fixture',answers:Object.fromEntries(Object.entries(request.questions).map(([key,q])=>[key,{type:'choice',choice:Object.keys(q.criteria)[0],confidence:.7}]))});
    };
    const url='http://localhost/api/workspace/market-knowledge';
    const call=async(path='',body)=>{
      const r=await handleMindStudioAPI(new Request(url+path,{method:body?'POST':'GET',headers:{'oai-authenticated-user-id':'knowledge-test-owner',...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined}),env,{fetchImpl});
      return {status:r.status,...await r.json()};
    };
    const {example}=await call('/forms');
    const {revision}=await call();
    const saved=await call('/save',{document:example,expectedRevision:revision,idempotencyKey:'first-note'});
    assert.equal(saved.status,200);
    const args={documentId:example.id,expectedRevision:revision,idempotencyKey:'classify-first'};
    const classification=call('/classify',args);
    await arrived.promise;
    assert.equal((await call('/item?id='+example.id)).classificationAttempt.status,'PENDING');
    assert.equal((await call('/classify',{...args,idempotencyKey:'other-tab-classify'})).code,'IN_PROGRESS');
    const second=structuredClone(example);second.id=second.data.lineageId='concurrent-note';
    assert.equal((await call('/save',{document:second,expectedRevision:saved.revision,idempotencyKey:'second-note'})).status,200);
    resume.resolve();
    const result=await classification;
    assert.equal(result.status,200,JSON.stringify({code:result.code,status:result.status}));
    assert.equal((await call('/classify',args)).idempotent,true);
    assert.equal((await call()).page.total,2);
    assert.equal(calls,1);
  }finally{local.close();}
});


test('classification status reads and failed receipts never retransmit the document',async()=>{
  const local=await openLocalDatabase(':memory:');
  try{
    const env={DB:local.db};
    let calls=0,now=Date.now();
    const fetchImpl=async(_url,{body})=>{
      calls++;
      if(calls===1)return Response.json({message:'denied'},{status:403,headers:{'x-request-id':'first-provider-request'}});
      if(calls===2)throw Error('mock provider disconnected');
      const request=JSON.parse(body);
      return Response.json({model:'fixture',answers:Object.fromEntries(Object.entries(request.questions).map(([key,q])=>[key,{type:'choice',choice:Object.keys(q.criteria)[0],confidence:.7}]))});
    };
    const url='http://localhost/api/workspace/market-knowledge';
    const call=async(path='',body)=>{
      const r=await handleMindStudioAPI(new Request(url+path,{method:body?'POST':'GET',headers:{'oai-authenticated-user-id':'knowledge-test-owner',...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined}),env,{fetchImpl,now:()=>now});
      return {status:r.status,...await r.json()};
    };
    const {example}=await call('/forms');
    const {revision}=await call();
    const saved=await call('/save',{document:example,expectedRevision:revision,idempotencyKey:'save-source'});
    const args={documentId:example.id,expectedRevision:saved.revision,idempotencyKey:'classify-source'};
    const item=()=>call('/item?id='+example.id);
    assert.equal((await item()).classificationAttempt.status,'KEY_REQUIRED');
    assert.equal((await call('/classify',args)).code,'JEV_CONNECTION_REQUIRED');
    assert.equal(calls,0);
    env.TYPESAFE_API_KEY='test-key';
    assert.equal((await item()).classificationAttempt.status,'READY');

    const rejected=await call('/classify',args);
    assert.equal(rejected.status,403);
    assert.equal((await call('/classify',args)).providerFailureEventId,rejected.providerFailureEventId);
    const afterDenial=await item();
    assert.deepEqual(afterDenial.classificationAttempt,{status:'REJECTED',at:afterDenial.classificationAttempt.at,providerRequestId:'first-provider-request',httpStatus:403});
    assert.equal(calls,1);

    const second={...args,idempotencyKey:'classify-new-attempt',expectedRevision:afterDenial.revision};
    const disconnected=await call('/classify',second);
    assert.equal(disconnected.status,502);
    assert.equal((await call('/classify',second)).providerFailureEventId,disconnected.providerFailureEventId);
    const afterDisconnect=await item();
    assert.equal(afterDisconnect.classificationAttempt.status,'UNKNOWN');
    assert.equal(afterDisconnect.entry.status,'SAVED');
    assert.equal(afterDisconnect.entry.classificationRecord,null);
    assert.equal(calls,2);

    const path='/api/workspace/market-knowledge/classify', expiredKey='expired-unknown';
    await acquireClaim(local.db,{ownerId:'knowledge-test-owner',resourceId:'knowledge-classification:'+example.id,key:expiredKey,
      fingerprint:hashInputPackage({path,input:{documentId:example.id}}),baseRevision:afterDisconnect.revision,nowMs:now+1,leaseMs:1000});
    now+=2000;
    assert.equal((await item()).classificationAttempt.status,'UNKNOWN');
    assert.equal((await call('/classify',{...second,idempotencyKey:expiredKey})).code,'KNOWLEDGE_CLASSIFICATION_OUTCOME_UNKNOWN');
    assert.equal(calls,2);

    const recovered=await call('/classify',{...second,expectedRevision:afterDisconnect.revision,idempotencyKey:'explicit-retry'});
    assert.equal(recovered.status,200);
    const final=await item();
    assert.equal(final.entry.status,'SAVED');
    assert.equal(final.classificationAttempt,null);
    assert.equal(final.entry.classificationRecord.provider.requestId,recovered.classificationRecord.provider.requestId);
    assert.equal(calls,3);
  }finally{local.close();}
});
