import test from 'node:test';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {contextSourceFiles,inspectContextSource,inspectContextReview,inspectContextMatrix,checkContextInteractions} from '../scripts/check-context-interactions.mjs';
import {CONTEXT_SURFACES} from '../dist/ui/context-interactions.mjs';
import {parseStudioRoute,studioRouteHash,WORKSPACE_NAV,LIBRARY_VIEWS,SETTINGS_VIEWS} from '../dist/ui/studio-controller.mjs';
import {renderStudioJump,studioJumpItems,studioJumpMatches,studioJumpResearchItems} from '../dist/ui/studio-shell.mjs';
import {terminalModelMeasures,terminalTooltipContent} from '../dist/ui/trading-terminal.mjs';
import {queryMarketKnowledge} from '../server/market-knowledge.mjs';
import {marketKnowledgeExample} from '../dist/domain/market-knowledge.mjs';

test('paper decision previews separate the outcome from model response measures',()=>{
 const view={model:'jev-1.0.0',action:'hold',profileName:'추세형',confidence:1,probabilities:{buy:0,hold:1,sell:0},outcome:'NO_ORDER_REQUIRED',reasons:[]};
 const preview=terminalTooltipContent([view]);
 assert.match(preview,/추가 주문 없음/);
 assert.doesNotMatch(preview,/100\.00%/);
 const measures=terminalModelMeasures(view);
 assert.match(measures,/<summary>모델 응답 지표<\/summary>/);
 assert.match(measures,/행동 선택에 대한 모델 출력/);
 assert.match(measures,/모델 자체 확신도<\/dt><dd>100\.00%/);
 assert.match(measures,/매수 0\.00% · 유지 100\.00% · 매도 0\.00%/);
 assert.equal(terminalModelMeasures({...view,authority:'STRATEGY_GRAPH',decisionMethod:{measureKind:'VOTE'}}),'');
 assert.equal(terminalModelMeasures({...view,model:null}),'');
});

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

test('AI client searches take users to Service Connections in either account view',()=>{
 for(const mode of ['paper','live']){
  const route=parseStudioRoute('#home?executionMode='+mode);
  const entries=studioJumpItems(route,{}, {routeHash:studioRouteHash,primary:WORKSPACE_NAV,library:LIBRARY_VIEWS,settings:SETTINGS_VIEWS});
  for(const query of ['MCP','Claude Code','Codex','AI 연결']){
   const matches=entries.filter(item=>studioJumpMatches(item.label+' '+(item.keywords||''),query));
   assert.equal(matches.length,1);
   const destination=parseStudioRoute(matches[0].href);
   assert.equal(destination.params.get('view'),'connections');
   assert.equal(destination.params.get('executionMode'),mode);
  }
 }
});

test('mind name and task search finds matching strategies and distinguishes duplicate names',()=>{
 const route=parseStudioRoute('#home?executionMode=paper');
 const minds=[{id:'profile-long',name:'국면 추세 실습'},{id:'profile-aa11aa11',name:'국면 추세',createdLabel:'2026. 11. 12. 09:00 KST'},{id:'profile-bb22bb22',name:'국면 추세'}];
 const entries=studioJumpItems(route,{minds},{routeHash:studioRouteHash,primary:WORKSPACE_NAV,library:LIBRARY_VIEWS,settings:SETTINGS_VIEWS});
 const search=query=>entries.filter(item=>studioJumpMatches(item.label+' '+item.keywords,query));
 const strategies=search('국면 추세 전략'.normalize('NFD'));
 assert.deepEqual(search('국면추세 전략'),strategies);
 assert.deepEqual(strategies.map(item=>parseStudioRoute(item.href).params.get('profileId')),['profile-aa11aa11','profile-bb22bb22','profile-long']);
 assert.deepEqual(strategies.map(item=>item.identity),['생성 2026. 11. 12. 09:00 KST · aa11aa11','bb22bb22','']);
 assert.ok(strategies.every(item=>item.searchOnly&&parseStudioRoute(item.href).params.get('view')==='principles'));
 assert.match(renderStudioJump(strategies),/data-studio-jump-search-only hidden/);
 const labs=search('국면 추세 백테스트');
 assert.deepEqual(search('국면추세 백테스트'),labs);
 assert.equal(labs.length,3);
 assert.ok(labs.every(item=>parseStudioRoute(item.href).params.get('view')==='simulations'));
});

test('quick navigation opens a clean mind destination and labels a live-to-paper lab jump',()=>{
 const route=parseStudioRoute('#minds?executionMode=live&profileId=profile-one&view=simulations&simulationId=old&lab=compare&a=old&setup=new&practice=quant&practiceMind=profile-one&expQuery=old');
 const minds=[{id:'profile-one',name:'마인드 하나'},{id:'profile-two',name:'마인드 둘'}];
 const entries=studioJumpItems(route,{minds,selectedMindId:'profile-one'},{routeHash:studioRouteHash,primary:WORKSPACE_NAV,library:LIBRARY_VIEWS,settings:SETTINGS_VIEWS});
 const links=entries.filter(item=>item.label.includes('마인드 둘'));
 const lab=links.find(item=>item.taskSuffix==='모의 실험실');
 const next=parseStudioRoute(lab.href);
 assert.deepEqual(Object.fromEntries(next.params),{profileId:'profile-two',view:'simulations',executionMode:'paper',tab:'overview'});
 const strategy=parseStudioRoute(links.find(item=>item.taskSuffix==='전략').href);
 assert.equal(strategy.params.get('executionMode'),'live');
 const current=entries.find(item=>item.group==='현재 마인드'&&item.taskLabel==='모의 실험실');
 assert.equal(current.searchOnly,false);
});

test('quick research results identify each version and retain the search for full results',()=>{
 const route=parseStudioRoute('#library?executionMode=live&view=documents&search=old&status=SAVED&knowledgeId=other');
 const page={items:[
  {id:'research-2',title:'<실습> 리서치',publisher:'발행자 A',version:2},
  {id:'research-1',title:'<실습> 리서치',publisher:'발행자 B',version:1},
 ],hasMore:true};
 const entries=studioJumpResearchItems(route,'리서치',{page},studioRouteHash);
 assert.deepEqual(entries.slice(0,2).map(item=>item.identity),['발행자 A · v2','발행자 B · v1']);
 assert.deepEqual(entries.slice(0,2).map(item=>Object.fromEntries(parseStudioRoute(item.href).params)),[
  {executionMode:'live',view:'documents',knowledgeId:'research-2'},
  {executionMode:'live',view:'documents',knowledgeId:'research-1'},
 ]);
 assert.match(renderStudioJump(entries),/data-studio-jump-research="reader".*&lt;실습&gt; 리서치/);
 const more=parseStudioRoute(entries[2].href).params;
 assert.equal(more.get('search'),'리서치');
 assert.equal(more.get('versions'),'all');
 assert.equal(more.has('knowledgeId'),false);
 assert.equal(studioJumpResearchItems(route,'리서치',{failed:true},studioRouteHash)[0].href,entries[2].href);
 assert.deepEqual(studioJumpResearchItems(route,'리서치',{page:{items:[]}},studioRouteHash),[]);
});

test('quick research prioritizes title matches before limiting results',()=>{
 const old='2026-11-01T00:00:00.000Z',recent='2026-11-10T00:00:00.000Z';
 const entry=(id,title,version,time,summary='요약')=>{
  const document=marketKnowledgeExample(time);
  Object.assign(document,{id,title});
  Object.assign(document.data,{version,summary});
  return {id,document,status:'SAVED'};
 };
 const workspace={revision:1,marketKnowledge:[
  entry('metadata','다른 자료',1,recent,'반도체 수출'),
  entry('partial','반도체 수출 동향',1,recent),
  entry('v1','반도체 수출',1,old),
  entry('v2','반도체 수출',2,old),
 ]};
 const normal={search:'반도체 수출',pageSize:2,versions:'all'};
 const quick={...normal,search:normal.search.normalize('NFD'),order:'relevance'};
 const ids=result=>result.page.items.map(item=>item.id);
 assert.deepEqual(ids(queryMarketKnowledge(workspace,normal)),['metadata','partial']);
 const page=queryMarketKnowledge(workspace,quick);
 assert.deepEqual(ids(page),['v2','v1']);
 assert.deepEqual(ids(queryMarketKnowledge(workspace,{...quick,cursor:page.page.nextCursor})),['partial','metadata']);
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
