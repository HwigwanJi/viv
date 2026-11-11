import test from 'node:test';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {contextSourceFiles,inspectContextSource,inspectContextReview,inspectContextMatrix,checkContextInteractions} from '../scripts/check-context-interactions.mjs';
import {CONTEXT_SURFACES} from '../dist/ui/context-interactions.mjs';
import {parseStudioRoute,studioRouteHash,WORKSPACE_NAV,LIBRARY_VIEWS,SETTINGS_VIEWS} from '../dist/ui/studio-controller.mjs';
import {studioJumpItems,studioJumpMatches} from '../dist/ui/studio-shell.mjs';

test('help queries find the capability catalog in the current viewing mode',()=>{
 const route=parseStudioRoute('#settings?view=connections&executionMode=live');
 const entries=studioJumpItems(route,{}, {routeHash:studioRouteHash,primary:WORKSPACE_NAV,library:LIBRARY_VIEWS,settings:SETTINGS_VIEWS});
 for(const query of ['도움말','사용 안내','가이드','사용법','VIV 도움말']){
  const matches=entries.filter(item=>studioJumpMatches([item.label,item.group,item.keywords].filter(Boolean).join(' '),query));
  assert.equal(matches.length,1);
  const destination=parseStudioRoute(matches[0].href);
  assert.equal(destination.page,'settings');
  assert.equal(destination.params.get('view'),'capabilities');
  assert.equal(destination.params.get('executionMode'),'live');
 }
});

test('API key searches open real account setup while paper accounts keep their own destination',()=>{
 const route=parseStudioRoute('#home?executionMode=paper');
 const entries=studioJumpItems(route,{}, {routeHash:studioRouteHash,primary:WORKSPACE_NAV,library:LIBRARY_VIEWS,settings:SETTINGS_VIEWS});
 const search=query=>entries.filter(item=>studioJumpMatches([item.label,item.keywords].filter(Boolean).join(' '),query));
 for(const query of ['API 키','업비트 API키','토스증권 연결']){
  const matches=search(query);
  assert.equal(matches.length,1);
  const destination=parseStudioRoute(matches[0].href);
  assert.equal(destination.page,'settings');
  assert.equal(destination.params.get('view'),'accounts');
  assert.equal(destination.params.get('executionMode'),'live');
 }
 const [paper]=search('모의 계좌');
 assert.equal(parseStudioRoute(paper.href).params.get('executionMode'),'paper');
});

const entry=(file,source,extra={})=>({file,owners:['card'],review:'SOURCE_REVIEWED',reviewedAt:'2026-11-04',reason:'카드의 상태별 기존 작업을 공용 메뉴로 연결한다.',...inspectContextSource(source),...extra});
test('Git checkout line endings leave the context review fingerprint stable',()=>{
 const source='<button>열기</button>\n';
 assert.deepEqual(inspectContextSource(source),inspectContextSource(source.replaceAll('\n','\r\n')));
});
test('new UI, helper-created actions and same-count replacements require new context review',()=>{
 const file='dist/ui/card.mjs',source='export const card=()=>`<article><button data-card-action="open">열기</button></article>`;',review={schemaVersion:1,sources:[entry(file,source)]};
 assert.deepEqual(inspectContextReview([{file,source}],review),[]);
 assert.ok(inspectContextReview([{file:'dist/ui/new.mjs',source}],review).some(i=>i.code==='CONTEXT_UI_UNREVIEWED'));
 assert.ok(inspectContextReview([{file,source:source+"button('삭제','remove')"}],review).some(i=>i.code==='CONTEXT_INTERACTION_CHANGED'));
 assert.ok(inspectContextReview([{file,source:source.replace('열기','삭제')}],review).some(i=>i.code==='CONTEXT_SOURCE_REVIEW_CHANGED'));
});
test('custom clickable containers need a bound entity; native and dedicated graph semantics are explicit',()=>{
 const file='dist/ui/new.mjs',source='<div onClick={open}>객체</div>';
 let review={schemaVersion:1,sources:[entry(file,source)]};
 assert.ok(inspectContextReview([{file,source}],review).some(i=>i.code==='CONTEXT_CUSTOM_TARGET_UNBOUND'));
 const bound='<div data-context-entity="card" onClick={open}>객체</div>';review={schemaVersion:1,sources:[entry(file,bound)]};assert.deepEqual(inspectContextReview([{file,source:bound}],review),[]);
 assert.ok(inspectContextReview([{file,source:bound}],{schemaVersion:1,sources:[entry(file,bound,{owners:['unregistered']})]}).some(i=>i.code==='CONTEXT_OWNER_REQUIRED'));
 assert.ok(inspectContextReview([{file,source:bound}],review,{groups:[]}).some(i=>i.code==='CONTEXT_GROUP_CONTRACT'));
 assert.equal(CONTEXT_SURFACES.find(g=>g.id==='notification').actions.includes('처리 완료 후 삭제'),true);
});
test('current authored UI sources all have a current context interaction review',async()=>{
 const result=await checkContextInteractions();assert.ok(result.files>90);assert.ok(result.bindings>1000);
});

test('the action matrix requires every runtime and native owner plus state rules and real source references',()=>{assert.ok(inspectContextMatrix({schemaVersion:1,groups:[]},new Set()).some(v=>v.code==='CONTEXT_MATRIX_OWNER_MISSING'));assert.ok(inspectContextMatrix({schemaVersion:1,groups:[{id:'bad',owner:'unregistered',actions:['열기'],sources:['missing.mjs']}]},new Set()).some(v=>v.code==='CONTEXT_MATRIX_GROUP_INVALID'));});

test('new TSX components and standalone HTML outside the original screen directories enter the review gate',async()=>{const root=await mkdtemp(path.join(os.tmpdir(),'cji-context-scan-'));try{for(const name of ['dist/ui','dist/research','dist/new-screen'])await mkdir(path.join(root,name),{recursive:true});await writeFile(path.join(root,'dist/ui/new.tsx'),'<button>열기</button>');await writeFile(path.join(root,'dist/new-screen/index.html'),'<button>열기</button>');const files=await contextSourceFiles(root);assert.ok(files.includes('dist/ui/new.tsx'));assert.ok(files.includes('dist/new-screen/index.html'));}finally{assert.equal(path.dirname(path.resolve(root)),path.resolve(os.tmpdir()));assert.ok(path.basename(root).startsWith('cji-context-scan-'));await rm(root,{recursive:true,force:true});}});
