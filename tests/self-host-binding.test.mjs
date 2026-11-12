import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {boundMcpUrl,selectSelfHostPort} from '../scripts/self-host-binding.mjs';

test('only a fresh default install can choose another port; an existing server must match the installation',async()=>{
  const owner='a'.repeat(32),other='b'.repeat(32);
  let identification=owner;
  const server=createServer((request,response)=>{
    if(identification)response.setHeader('X-VIV-Setup',identification);
    response.end();
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{
    const {port}=server.address();
    assert.deepEqual(await selectSelfHostPort(port,owner,false),{port,state:'existing'});
    const conflict=await selectSelfHostPort(port,other,false);
    assert.equal(conflict.state,'occupied');
    assert.equal(conflict.port,port);
    assert.equal(conflict.otherViv,true);
    const fallback=await selectSelfHostPort(port,other,true);
    assert.equal(fallback.previousPort,port);
    assert.equal(fallback.state,'free');
    assert.notEqual(fallback.port,port);
    assert.notEqual(fallback.port,4905);
    assert.equal(new URL(boundMcpUrl(fallback.port,other)).searchParams.get('installation'),other);
    identification=null;
    assert.equal((await selectSelfHostPort(port,owner,false)).otherViv,false);
    await assert.rejects(selectSelfHostPort(4905,owner,true),/Invalid VIV port/);
  }finally{
    await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
  }
});
