
import test from 'node:test';
import assert from 'node:assert/strict';
import {handleBrokerAPI} from '../server/broker-accounts.mjs';
import {createBrokerConnections} from '../dist/ui/broker-connections.mjs';
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

test('a previously saved snapshot cannot confirm a new connection request',async t=>{
  t.mock.method(globalThis,'FormData',function(){return [['accessKey','fixture-access'],['secretKey','fixture-secret']];});
  const saved={provider:'upbit',mode:'READ_ONLY',asOf:'2026-11-10T12:00:00.000Z',accounts:[]};
  const fields=Object.fromEntries(['[type="submit"]','[data-broker-error]','[data-broker-status]','[data-studio-action="close-dialog"]'].map(selector=>[selector,{}]));
  let closed=0,reads=0,response={ok:true},mode='paper';
  const toasts=[];
  const connections=createBrokerConnections({
    request:async path=>{
      if(path.endsWith('/connect'))return response;
      reads++;
      return {connections:[{provider:'upbit',snapshot:saved}]};
    },
    route:()=>({page:'settings',params:new URLSearchParams({view:'accounts',executionMode:mode})}),
    close:()=>closed++,redraw:()=>{},toast:message=>toasts.push(message),
  });
  const form={dataset:{brokerForm:'upbit'},querySelector:selector=>fields[selector],reset:()=>{}};
  const event={target:{closest:()=>form},preventDefault:()=>{}};
  assert.equal(await connections.load(),false);
  assert.equal(reads,0);
  mode='live';
  await connections.load();
  await connections.submit(event);
  assert.equal(reads,2);
  assert.equal(closed,0);
  assert.deepEqual(toasts,[]);
  assert.match(fields['[data-broker-error]'].textContent,/이번 연결 결과를 확인하지 못했습니다/);

  response={ok:true,snapshot:{...saved,asOf:'2026-11-11T12:00:00.000Z'}};
  await connections.submit(event);
  assert.equal(closed,1);
  assert.deepEqual(toasts,['업비트 계좌 연결 및 잔고 조회 완료.']);
});

test('checking broker readiness recovers from a VIV server restart without sending credentials',async()=>{
  const calls=[];
  let failure=new TypeError('Failed to fetch');
  const connections=createBrokerConnections({
    request:async(path,body)=>{
      calls.push({path,body});
      if(failure)throw failure;
      return {connections:[],canConnect:false,network:'IP_CONFIGURATION_REQUIRED',vault:'READY'};
    },
    route:()=>({page:'settings',params:new URLSearchParams({view:'accounts',executionMode:'live'})}),
    redraw:()=>{},
  });
  assert.equal(await connections.load(),false);
  assert.match(connections.render(),/VIV PC 주소가 열린 뒤 다시 확인하세요/);

  failure=Object.assign(new Error('로그인이 필요합니다.'),{serverResponse:true});
  assert.equal(await connections.load(),false);
  assert.match(connections.render(),/로그인이 필요합니다/);

  failure=null;
  assert.equal(await connections.load(),true);
  assert.match(connections.render(),/연결 준비 보기/);
  assert.doesNotMatch(connections.render(),/서버의 응답을 확인하지 못했습니다/);
  assert.deepEqual(calls,Array.from({length:3},()=>({path:'/api/workspace/brokers',body:undefined})));
});
