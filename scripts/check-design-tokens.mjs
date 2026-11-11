import {readFile,readdir,lstat} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {inspectStyleSources} from './style-contract.mjs';
import {styleInputs,STYLE_OUTPUTS,APP_STYLE_OUTPUTS} from './build-styles.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const hash=value=>createHash('sha256').update(value).digest('hex');
export {inspectComponentStyles} from './style-contract.mjs';

export async function checkStyles({checkBuild=true,rootDir=root}={}){
  const root=path.resolve(rootDir);
  const problems=[];let components=0;
  const required=['package.json','package-lock.json','scripts/build-styles.mjs','scripts/check-design-tokens.mjs','scripts/style-contract.mjs','dist/ui/tokens/index.css',...STYLE_OUTPUTS.map(([input])=>input)];
  for(const file of required){try{const info=await lstat(path.join(root,file));if(!info.isFile()||info.isSymbolicLink())problems.push({code:'INVALID_STYLE_SOURCE',file});}catch{problems.push({code:'MISSING_STYLE_SOURCE',file});}}
  if(problems.length)return {ok:false,components,problems};
  const sources=await inspectStyleSources({rootDir:root,outputs:STYLE_OUTPUTS});components=sources.components.length;problems.push(...sources.problems);
  if(checkBuild){
    let manifest;try{manifest=JSON.parse(await readFile(path.join(root,'dist/ui/style-build.json'),'utf8'));}catch{problems.push({code:'MISSING_TAILWIND_BUILD'});}
    if(manifest){
      const expectedOutputs=STYLE_OUTPUTS.map(([,output])=>output).sort(),actualOutputs=Array.isArray(manifest.outputs)?manifest.outputs.map(output=>output?.path):[];
      if(manifest.schemaVersion!==1||manifest.compiler!=='tailwindcss@4.3.3'||actualOutputs.length!==expectedOutputs.length||JSON.stringify([...actualOutputs].sort())!==JSON.stringify(expectedOutputs)||!manifest.outputs.every(output=>/^[a-f0-9]{64}$/.test(output.sha256)))problems.push({code:'INVALID_TAILWIND_BUILD'});
      if(JSON.stringify(manifest.pages)!==JSON.stringify(sources.pages))problems.push({code:'STALE_PAGE_STYLE_COVERAGE'});
      const inputs=await styleInputs({rootDir:root});
      if(manifest.inputHash!==hash(JSON.stringify(inputs))||JSON.stringify(manifest.inputs)!==JSON.stringify(inputs))problems.push({code:'STALE_TAILWIND_BUILD'});
      for(const output of Array.isArray(manifest.outputs)?manifest.outputs:[]){if(!expectedOutputs.includes(output?.path))continue;try{const current=await readFile(path.join(root,output.path));if(hash(current)!==output.sha256)problems.push({code:'GENERATED_CSS_EDITED',file:output.path});}catch{problems.push({code:'MISSING_GENERATED_CSS',file:output.path});}}
      let html='';try{html=await readFile(path.join(root,'dist/index.html'),'utf8');}catch{}
      const links=[...html.matchAll(/<link\b[^>]*\brel=["']stylesheet["'][^>]*\bhref=["']([^"']+)["'][^>]*>/gi)].map(match=>match[1].split('?')[0].replace(/^\.\//,'').replace(/^\//,''));
      for(const [,output]of APP_STYLE_OUTPUTS){const href=output.slice('dist/'.length);if(links.filter(link=>link===href).length!==1)problems.push({code:'GENERATED_CSS_LINK_REQUIRED',file:output});}
      for(const output of expectedOutputs)if(!sources.pages.some(page=>page.stylesheets.includes(output)))problems.push({code:'UNUSED_GENERATED_STYLESHEET',file:output});
      if(links.some(link=>link.startsWith('styles/')||link.startsWith('ui/tokens/')))problems.push({code:'SOURCE_STYLESHEET_LINKED'});
    }
  }
  return {ok:problems.length===0,components,pages:sources.pages,problems};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const result=await checkStyles({checkBuild:!process.argv.includes('--source-only')});
  console.log(JSON.stringify(result,null,2));if(!result.ok)process.exitCode=1;
}
