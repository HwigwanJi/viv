import { readdir, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import {checkCopy} from './check-ui-copy.mjs';
import {checkContextInteractions} from './check-context-interactions.mjs';
await checkContextInteractions();
async function walk(dir){return (await Promise.all((await readdir(dir,{withFileTypes:true})).map(x=>x.isDirectory()?walk(`${dir}/${x.name}`):`${dir}/${x.name}`))).flat();}
let failed=false;
for(const f of await walk('dist')){
  if(f.endsWith('.mjs')){const r=spawnSync(process.execPath,['--check',f],{encoding:'utf8'});if(r.status){console.error(r.stderr);failed=true;}}
}
const html=await readFile('dist/index.html','utf8');
for(const required of ['lang="ko"','type="module"','viewport','id="app"']) if(!html.includes(required)){console.error('Missing HTML contract:',required);failed=true;}
if(failed)process.exit(1);
console.log('Module syntax and HTML entrypoint verified.');
await checkCopy();
const manifestCheck=spawnSync(process.execPath,['scripts/compile-capabilities.mjs','--check'],{encoding:'utf8'});
if(manifestCheck.status){console.error(manifestCheck.stderr||manifestCheck.stdout);process.exitCode=1;}else console.log(manifestCheck.stdout.trim());
