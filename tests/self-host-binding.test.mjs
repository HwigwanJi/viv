import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {spawnSync} from 'node:child_process';
import {copyFile,mkdir,mkdtemp,readdir,readFile,rmdir,unlink,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {basename,join} from 'node:path';
import {fileURLToPath} from 'node:url';
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

test('restoring a DB without its configuration exits before setup creates runtime files',async()=>{
  const project=await mkdtemp(join(tmpdir(),'viv restored '));
  const runtime=join(project,'.runtime'),db=join(runtime,'self-host.sqlite');
  const windows=process.platform==='win32';
  const scripts=['install-viv.ps1','setup-self-host.ps1'];
  await mkdir(runtime);
  await writeFile(db,'restored fixture');
  try{
    const inputs=[{command:process.execPath,args:[fileURLToPath(new URL('../scripts/setup-self-host-mac.mjs',import.meta.url)),'pc','manual']}];
    if(windows){
      await mkdir(join(project,'scripts'));
      for(const name of scripts)await copyFile(new URL('../scripts/'+name,import.meta.url),join(project,'scripts',name));
      const command=join(process.env.SystemRoot,'System32','WindowsPowerShell','v1.0','powershell.exe');
      const common=['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File'];
      inputs.push(
        {command,args:[...common,join(project,'scripts',scripts[0]),'-Target','PC','-Client','Manual']},
        {command,args:[...common,join(project,'scripts',scripts[0]),'-Resume']},
      );
    }
    for(const {command,args} of inputs){
      const result=spawnSync(command,args,{cwd:project,env:{...process.env,PATH:''},encoding:'utf8',timeout:15000});
      assert.ifError(result.error);
      assert.equal(result.status,1,result.stdout+result.stderr);
      assert.match(result.stderr,/\.env/);
      assert.ok(result.stderr.includes(basename(project)),result.stderr);
      assert.match(result.stderr,/docs\/agents\/operations\/self-host\.md/);
      assert.deepEqual(await readdir(runtime),['self-host.sqlite']);
      assert.equal(await readFile(db,'utf8'),'restored fixture');
      assert.deepEqual((await readdir(project)).sort(),windows?['.runtime','scripts']:['.runtime']);
    }
  }finally{
    if(windows){
      for(const name of scripts)await unlink(join(project,'scripts',name));
      await rmdir(join(project,'scripts'));
    }
    await unlink(db);
    await rmdir(runtime);
    await rmdir(project);
  }
});
