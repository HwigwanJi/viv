import { readdir, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import {checkCopy} from './check-ui-copy.mjs';
import {checkContextInteractions} from './check-context-interactions.mjs';
await checkContextInteractions();
async function walk(dir){return (await Promise.all((await readdir(dir,{withFileTypes:true})).map(x=>x.isDirectory()?walk(`${dir}/${x.name}`):`${dir}/${x.name}`))).flat();}
const modules=(await walk('dist')).filter(file=>file.endsWith('.mjs')).sort();
let failed=false;
if(process.argv.includes('--rust')){
  const result=spawnSync('cargo',['run','--quiet','--locked','--manifest-path','tools/module-syntax/Cargo.toml','--',process.execPath],{
    input:modules.join('\0'),stdio:['pipe','inherit','inherit'],windowsHide:true,
  });
  if(result.error)console.error('Could not start Cargo:',result.error.message);
  failed=result.status!==0;
}else{
  for(const file of modules){
    const result=spawnSync(process.execPath,['--check',file],{encoding:'utf8'});
    if(result.status!==0){console.error(result.stderr||result.error?.message||file);failed=true;}
  }
}
const html=await readFile('dist/index.html','utf8');
for(const required of ['lang="ko"','type="module"','viewport','id="app"']) if(!html.includes(required)){console.error('Missing HTML contract:',required);failed=true;}
if(failed)process.exit(1);
console.log('Module syntax and HTML entrypoint verified.');
await checkCopy();
const manifestCheck=spawnSync(process.execPath,['scripts/compile-capabilities.mjs','--check'],{encoding:'utf8'});
if(manifestCheck.status){console.error(manifestCheck.stderr||manifestCheck.stdout);process.exitCode=1;}else console.log(manifestCheck.stdout.trim());
