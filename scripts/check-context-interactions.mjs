import {readdir,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {CONTEXT_SURFACES,CONTEXT_NATIVE_REASONS} from '../dist/ui/context-interactions.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
export async function contextSourceFiles(base=root){
 const files=['dist/app.mjs'];
 async function walk(relative,filter){for(const entry of await readdir(path.join(base,relative),{withFileTypes:true})){const file=relative+'/'+entry.name;if(entry.isSymbolicLink())throw Error('CONTEXT_SOURCE_SYMLINK: '+file);if(entry.isDirectory())await walk(file,filter);else if(filter(entry.name))files.push(file);}}
 const authored=name=>/\.(?:html|mjs|js|jsx|ts|tsx)$/.test(name);
 await walk('dist/ui',authored);
 await walk('dist/research',authored);
 await walk('dist',name=>name.endsWith('.html'));
 for(const name of await readdir(path.join(base,'dist')))if(authored(name))files.push('dist/'+name);
 for(const name of ['scripts/server-update-view.html','scripts/server-update/view.mjs','scripts/server-update/view-entry.mjs'])files.push(name);
 return [...new Set(files)].sort();
}
export function inspectContextSource(source){
 source=source.replaceAll('\r\n','\n');
 const bindings=new Map();
 const add=value=>bindings.set(value,(bindings.get(value)||0)+1);
 for(const match of source.matchAll(/\bdata-[a-z][a-z0-9-]*(?:action|open|trigger|cta|command|entity|controls|context)[a-z0-9-]*(?:\s*=\s*(?:"[^"]*"|'[^']*'|\{[^}]*\}))?/g))add(match[0].replace(/\s+/g,' '));
 for(const match of source.matchAll(/<(button|a|input|select|textarea|summary|dialog|article|table)\b/g))add('element:'+match[1]);
 for(const match of source.matchAll(/\bon(?:Click|DoubleClick|ContextMenu|KeyDown|PointerDown)\s*=/g))add('handler:'+match[0].replace(/\s+/g,''));
 for(const match of source.matchAll(/\b(?:button|routeLink|renderActionMenu|renderDataTable)\s*\(/g))add('helper:'+match[0].replace(/\s+/g,''));
 const controls=[...bindings].sort(([a],[b])=>a.localeCompare(b));
 const customContainers=[...source.matchAll(/<(div|section|span|li)\b([^>]*?)\b(?:onClick\s*=|data-[\w-]*action\s*=)/gs)].map(match=>match[0].replace(/\s+/g,' '));
 return {controls,signature:createHash('sha256').update(JSON.stringify(controls)).digest('hex'),sourceHash:createHash('sha256').update(source).digest('hex'),customContainers};
}
export function inspectContextReview(sources,review,{groups=CONTEXT_SURFACES}={}){
 const issues=[],owners=new Set([...groups.map(g=>g.id),...Object.keys(CONTEXT_NATIVE_REASONS)]),entries=new Map((review?.sources||[]).map(e=>[e.file,e]));
 if(review?.schemaVersion!==1)issues.push({code:'CONTEXT_REVIEW_SCHEMA'});
 if(!groups.length||groups.some(g=>!g.id||!g.selector||!g.actions?.length))issues.push({code:'CONTEXT_GROUP_CONTRACT'});
 for(const {file,source}of sources){
  const actual=inspectContextSource(source),entry=entries.get(file);
  if(!entry){issues.push({file,code:'CONTEXT_UI_UNREVIEWED'});continue;}
  if(!entry.reason?.trim()||!entry.reviewedAt||!['SOURCE_REVIEWED','BROWSER_VERIFIED','REPRESENTATIVE_BINDING'].includes(entry.review))issues.push({file,code:'CONTEXT_REVIEW_REQUIRED'});
  if(!entry.owners?.length||entry.owners.some(owner=>!owners.has(owner)))issues.push({file,code:'CONTEXT_OWNER_REQUIRED'});
  if(actual.signature!==entry.signature)issues.push({file,code:'CONTEXT_INTERACTION_CHANGED',message:'클릭 UI가 바뀌었습니다. 대상 그룹·현재 액션·상태와 검토 기록을 갱신하세요.'});
  if(actual.sourceHash!==entry.sourceHash)issues.push({file,code:'CONTEXT_SOURCE_REVIEW_CHANGED',message:'동적 렌더링과 같은 개수의 컨트롤 교체도 검토 원본에 다시 연결하세요.'});
  for(const container of actual.customContainers){
   if(/data-context-entity/.test(container)||entry.owners.includes('graph')||entry.nativeContainerReason==='popover-event-boundary')continue;
   issues.push({file,code:'CONTEXT_CUSTOM_TARGET_UNBOUND',container});
  }
 }
 const present=new Set(sources.map(s=>s.file));
 for(const file of entries.keys())if(!present.has(file))issues.push({file,code:'CONTEXT_REVIEW_STALE_SOURCE'});
 return issues;
}
export function inspectContextMatrix(matrix,files){
 const owners=new Set([...CONTEXT_SURFACES.map(g=>g.id),...Object.keys(CONTEXT_NATIVE_REASONS)]),groups=matrix?.groups||[],issues=[];
 if(matrix?.schemaVersion!==1||!groups.length)issues.push({code:'CONTEXT_MATRIX_REQUIRED'});
 for(const owner of owners)if(!groups.some(g=>g.owner===owner))issues.push({code:'CONTEXT_MATRIX_OWNER_MISSING',owner});
 for(const group of groups)if(!group.id||!owners.has(group.owner)||!group.actions?.length||!group.states?.trim()||!group.rule?.trim()||!group.sources?.length||group.sources.some(file=>!files.has(file)))issues.push({code:'CONTEXT_MATRIX_GROUP_INVALID',id:group.id});
 return issues;
}
export async function checkContextInteractions(base=root){
 const sources=await Promise.all((await contextSourceFiles(base)).map(async file=>({file,source:await readFile(path.join(base,file),'utf8')})));
 const review=JSON.parse(await readFile(path.join(base,'design/context-interaction-review.json'),'utf8'));
 const matrix=JSON.parse(await readFile(path.join(base,'design/context-action-matrix.json'),'utf8'));
 const issues=[...inspectContextReview(sources,review),...inspectContextMatrix(matrix,new Set(sources.map(s=>s.file).concat('server/app-notifications.mjs')))];
 if(issues.length)throw Object.assign(Error('CONTEXT_INTERACTION_GATE\n'+issues.map(i=>JSON.stringify(i)).join('\n')),{issues});
 return {files:sources.length,bindings:sources.reduce((n,s)=>n+inspectContextSource(s.source).controls.reduce((m,c)=>m+c[1],0),0)};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const result=await checkContextInteractions();console.log('Context interaction review: '+result.files+' UI sources, '+result.bindings+' interaction declarations covered.');
}
