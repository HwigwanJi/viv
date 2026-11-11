
import test from 'node:test';
import assert from 'node:assert/strict';
import {handleBrokerAPI} from '../server/broker-accounts.mjs';
import {openLocalDatabase} from '../server/local-db.mjs';

test('Upbit connection reports the required step and preserves the last verified connection on failure',async()=>{
  const local=await openLocalDatabase(':memory:');
  const env={DB:local.db,BROKER_NETWORK_READY:'true',BROKER_VAULT_KEY:'invalid'};
  const owner='broker-setup-test',secret='fixture-secret-only';
  const input={provider:'upbit',accessKey:'fixture-access-only',secretKey:secret};
  const request=async(path='',body)=>{
    const response=await handleBrokerAPI(new Request('http://localhost:4317/api/workspace/brokers'+path,{
      method:body?'POST':'GET',headers:{'Content-Type':'application/json','oai-authenticated-user-id':owner},...(body?{body:JSON.stringify(body)}:{})
    }),env,{fetchImpl});
    const result=await response.text();
    assert.equal(result.includes(secret),false);
    return JSON.parse(result);
  };
  let calls=0,error;
  const fetchImpl=async(url,options)=>{
    calls++;
    assert.equal(url,'https://api.upbit.com/v1/accounts');
    assert.equal(options.method,undefined);
    if(error)return Response.json({error:{name:error[0],message:secret}},{status:error[1]});
    return Response.json([{currency:'KRW',balance:'5000',locked:'0',avg_buy_price:'0',unit_currency:'KRW'}]);
  };
  try{
    const blocked=await request();
    assert.equal(blocked.canConnect,false);
    assert.equal(blocked.vault,'CONFIGURATION_REQUIRED');
    assert.equal((await request('/connect',input)).code,'VAULT_REQUIRED');
    assert.equal(calls,0);
    env.BROKER_VAULT_KEY='only-a-fixture-encryption-value-123456789';
    assert.equal((await request()).canConnect,true);
    for(const [providerCode,status,code] of [
      ['no_authorization_ip',401,'UPBIT_IP_NOT_ALLOWED'],['out_of_scope',401,'UPBIT_ASSET_SCOPE_REQUIRED'],
      ['out_of_scope',403,'UPBIT_ASSET_SCOPE_REQUIRED'],['expired_access_key',401,'UPBIT_KEY_EXPIRED'],
      ['jwt_verification',401,'UPBIT_KEY_MISMATCH'],['unrecognized',403,'UPBIT_AUTH_REQUIRED']
    ]){
      error=[providerCode,status];
      assert.equal((await request('/connect',input)).code,code);
    }
    assert.deepEqual((await request()).connections,[]);
    error=null;
    const connected=await request('/connect',input);
    assert.equal(connected.snapshot.mode,'READ_ONLY');
    assert.equal(connected.snapshot.accounts[0].currencies[0].cash,5000);
    error=['out_of_scope',401];
    assert.equal((await request('/connect',{...input,accessKey:'different-fixture-access'})).code,'UPBIT_ASSET_SCOPE_REQUIRED');
    assert.deepEqual((await request()).connections[0].snapshot,connected.snapshot);
  }finally{
    local.close();
  }
});

