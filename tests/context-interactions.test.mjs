import test from 'node:test';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {contextSourceFiles,inspectContextSource,inspectContextReview,inspectContextMatrix,checkContextInteractions} from '../scripts/check-context-interactions.mjs';
import {CONTEXT_SURFACES} from '../dist/ui/context-interactions.mjs';
import {parseStudioRoute,studioRouteHash,WORKSPACE_NAV,LIBRARY_VIEWS,SETTINGS_VIEWS,paperTrendDecisionBasis} from '../dist/ui/studio-controller.mjs';
import {renderStudioJump,studioJumpItems,studioJumpMatches,studioJumpResearchItems,studioReturnLink} from '../dist/ui/studio-shell.mjs';
import {terminalModelMeasures,terminalTooltipContent} from '../dist/ui/trading-terminal.mjs';
import {terminalPrimaryAction,terminalRunRequirement} from '../dist/ui/terminal-workspace-controls.mjs';
import {queryMarketKnowledge} from '../server/market-knowledge.mjs';
import {marketKnowledgeExample} from '../dist/domain/market-knowledge.mjs';

test('paper decision previews separate the outcome from model response measures',()=>{
 const view={model:'jev-1.0.0',action:'hold',profileName:'추세형',confidence:1,probabilities:{buy:0,hold:1,sell:0},outcome:'NO_ORDER_REQUIRED',reasons:[]};
 const preview=terminalTooltipContent([view]);
 assert.match(preview,/추가 주문 없음/);
 assert.doesNotMatch(preview,/100\.00%/);
 assert.doesNotMatch(terminalTooltipContent([view],{showOutcome:false}),/추가 주문 없음/);
 const measures=terminalModelMeasures(view);
 assert.match(measures,/<summary>모델 응답 지표<\/summary>/);
 assert.match(measures,/행동 선택에 대한 모델 출력/);
 assert.match(measures,/모델 자체 확신도<\/dt><dd>100\.00%/);
 assert.match(measures,/매수 0\.00% · 유지 100\.00% · 매도 0\.00%/);
 assert.equal(terminalModelMeasures({...view,authority:'STRATEGY_GRAPH',decisionMethod:{measureKind:'VOTE'}}),'');
 assert.equal(terminalModelMeasures({...view,model:null}),'');
});

test('a saved paper decision can be read during the execution cooldown',()=>{
 const wait={code:'MIND_COOLDOWN',action:{action:'wait',label:'다음 결정 대기'}};
 const saved={code:'CANDLE_ALREADY_EVALUATED',action:{action:'records',label:'저장된 결정 보기',params:{runId:'saved-run'}}};
 const data={canRun:false,primaryAction:wait.action,blockers:[wait,saved]};
 const model={selectedMindId:'test',profiles:[{id:'test'}],terminalReadiness:{schemaVersion:1,purpose:'FORWARD_PAPER',executionReadiness:data}};
 assert.deepEqual(terminalPrimaryAction(model),{...saved.action,canonical:true,disabled:false});
 assert.equal(terminalRunRequirement(model),saved);
 assert.equal(data.canRun,false);
 assert.equal(data.primaryAction,wait.action);
 assert.deepEqual(data.blockers,[wait,saved]);
 data.blockers=[wait];
 assert.equal(terminalPrimaryAction(model).disabled,true);
 data.blockers=[wait,{...saved,action:{action:'records'}}];
 assert.equal(terminalPrimaryAction(model).disabled,true);
 model.terminalReadiness.purpose='LIVE_READ_ONLY';
 data.blockers=[wait,saved];
 assert.equal(terminalPrimaryAction(model).disabled,true);
});

test('a guided report makes a missing JEV key visible before paper funding',()=>{
 const account={code:'PAPER_ACCOUNT_REQUIRED',category:'ACCOUNT',action:{action:'account',label:'모의 자금 설정'}};
 const missing={code:'JEV_CONNECTION_REQUIRED',category:'CONNECTION',action:{action:'connections',label:'연결 설정'}};
 const scope={code:'STRATEGY_PLAN_SCOPE',category:'SCOPE',action:{action:'timeframe',label:'주기 이동'}};
 const executionReadiness={canRun:false,primaryAction:account.action,blockers:[account,missing]};
 const model={guidedDecision:true,selectedMindId:'test',profiles:[{id:'test'}],terminalReadiness:{schemaVersion:1,purpose:'FORWARD_PAPER',executionReadiness}};
 assert.equal(terminalRunRequirement(model),missing);
 assert.deepEqual(terminalPrimaryAction(model),{action:'connections',label:'JEV 키 설정',canonical:true,disabled:false});
 assert.equal(terminalRunRequirement({...model,guidedDecision:false}),account);
 assert.equal(executionReadiness.primaryAction,account.action);
 executionReadiness.blockers=[account];
 assert.equal(terminalPrimaryAction(model).action,'account');
 executionReadiness.blockers=[scope,missing];
 executionReadiness.primaryAction=scope.action;
 assert.equal(terminalRunRequirement(model),scope);
 assert.equal(terminalPrimaryAction(model).action,'timeframe');
});

test('paper trend lesson explains no order only when the saved result supports it',()=>{
 const record={decision:{action:'hold'},execution:{status:'NO_ORDER_REQUIRED'},strategyEvaluation:{
  modules:[{moduleId:'SMA_TREND',ready:true,indicators:{close:80,slowMA:100,lookbackBars:480}}],
  graphEvaluation:{trace:[{nodeId:'trend-decision',output:{decision:{action:'sell',targetWeight:0}}}],output:{currentWeight:0,deltaWeight:0}},
 }};
 const basis=paperTrendDecisionBasis(record,'USDT',[]);
 assert.match(basis,/<h3[^>]*>판단에 사용한 시세<\/h3>/);
 assert.match(basis,/이동평균보다 낮아 목표 보유 비중은 0%/);
 assert.match(basis,/이 종목의 보유 비중도 0%여서.*모의 주문 없이 유지/);
 assert.doesNotMatch(paperTrendDecisionBasis(record,'USDT',undefined),/매도할 수량/);
 assert.doesNotMatch(paperTrendDecisionBasis({...record,execution:{status:'RISK_BLOCKED'}},'USDT',[]),/매도할 수량/);
 record.strategyEvaluation.graphEvaluation.output.currentWeight=.3;
 assert.doesNotMatch(paperTrendDecisionBasis(record,'USDT',[]),/매도할 수량/);
 record.strategyEvaluation.graphEvaluation.output.currentWeight=0;
 delete record.strategyEvaluation.modules[0].ready;
 assert.match(paperTrendDecisionBasis(record,'USDT',[]),/480봉 이동평균/);
 assert.doesNotMatch(paperTrendDecisionBasis(record,'USDT',[]),/매도할 수량/);
 delete record.strategyEvaluation.modules[0].indicators;
 assert.equal(paperTrendDecisionBasis(record,'USDT',[]),'');
});

test('help queries find the capability catalog in the current viewing mode',()=>{
 const route=parseStudioRoute('#settings?view=connections&executionMode=live');
 const entries=studioJumpItems(route,{}, {routeHash:studioRouteHash,primary:WORKSPACE_NAV,library:LIBRARY_VIEWS,settings:SETTINGS_VIEWS});
 for(const query of ['도움말','사용 안내','가이드','사용법','VIV 도움말']){
  const matches=entries.filter(item=>studioJumpMatches([item.label,item.group,item.keywords].filter(Boolean).join(' '),query));
  assert.equal(matches.length,query.includes('도움말')?2:1);
  const destination=parseStudioRoute(matches[0].href);
  assert.equal(destination.page,'settings');
  assert.equal(destination.params.get('view'),'capabilities');
  assert.equal(destination.params.get('executionMode'),'live');
 }
});

test('startup recovery searches open the public guide in a separate tab',()=>{
 const route=parseStudioRoute('#home?executionMode=paper');
 const entries=studioJumpItems(route,{}, {routeHash:studioRouteHash,primary:WORKSPACE_NAV,library:LIBRARY_VIEWS,settings:SETTINGS_VIEWS});
 for(const query of ['앱이 열리지 않을 때','복구','시작 오류','앱 안 열림','무한 로딩','무한부팅','앱 무한부팅']){
  const matches=entries.filter(item=>studioJumpMatches([item.label,item.group,item.keywords].filter(Boolean).join(' '),query));
  assert.equal(matches.length,1);
  assert.equal(matches[0].label,'앱이 열리지 않을 때');
  assert.ok(matches[0].href.endsWith('/self-host.md#시작-오류가-반복될-때'));
  const markup=renderStudioJump(matches);
  assert.match(markup,/data-studio-jump-item target="_blank" rel="noopener noreferrer" data-studio-jump-search-only hidden/);
  assert.doesNotMatch(markup,/data-studio-route/);
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

test('first decision searches open the same paper practice from either account view',()=>{
 for(const mode of ['paper','live']){
  const route=parseStudioRoute('#home?executionMode='+mode);
  const entries=studioJumpItems(route,{}, {routeHash:studioRouteHash,primary:WORKSPACE_NAV,library:LIBRARY_VIEWS,settings:SETTINGS_VIEWS});
  for(const query of ['첫 모의 판단','첫모의판단','현재 시세']){
   const matches=entries.filter(item=>studioJumpMatches([item.label,item.group,item.keywords].filter(Boolean).join(' '),query));
   assert.equal(matches.length,1);
   const [entry]=matches,destination=parseStudioRoute(entry.href);
   assert.equal(destination.page,'trade');
   assert.equal(destination.params.get('executionMode'),'paper');
   assert.equal(destination.params.get('firstDecision'),'1');
   assert.equal(entry.taskSuffix,mode==='live'?'모의 화면으로 이동':'');
  }
 }
});

test('the documented first backtest stays searchable from either account view',()=>{
 for(const mode of ['paper','live']){
  const route=parseStudioRoute('#home?executionMode='+mode);
  const entries=studioJumpItems(route,{}, {routeHash:studioRouteHash,primary:WORKSPACE_NAV,library:LIBRARY_VIEWS,settings:SETTINGS_VIEWS});
  const matches=entries.filter(item=>studioJumpMatches(item.label,'첫 백테스트 실습'));
  assert.equal(matches.length,1);
  const [entry]=matches,destination=parseStudioRoute(entry.href);
  assert.equal(entry.searchOnly,true);
  assert.equal(destination.page,'minds');
  assert.equal(destination.params.get('executionMode'),'paper');
  assert.equal(destination.params.get('practice'),'quant');
  assert.equal(destination.params.get('setup'),'new');
  assert.equal(entry.taskSuffix,mode==='live'?'모의 화면으로 이동':'');
 }
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

test('calendar task searches identify paper results from either account view',()=>{
 for(const mode of ['paper','live']){
  const route=parseStudioRoute('#home?executionMode='+mode);
  const entries=studioJumpItems(route,{}, {routeHash:studioRouteHash,primary:WORKSPACE_NAV,library:LIBRARY_VIEWS,settings:SETTINGS_VIEWS});
  for(const query of ['진행 중인 검증','날짜별 손익','오늘 벌었는지','모의 검증','달력']){
   const matches=entries.filter(item=>studioJumpMatches([item.label,item.group,item.keywords].filter(Boolean).join(' '),query));
   assert.equal(matches.length,1,query);
   const [item]=matches;
   assert.equal(item.taskSuffix,'모의검증 일정과 모의 실현 손익');
   assert.equal(item.href,'#calendar?executionMode='+mode);
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

test('first paper decision guidance survives its data return and stays in paper trading',()=>{
 const route=parseStudioRoute('#trade?executionMode=paper&firstDecision=1&profileId=mind-one&timeframe=4h');
 const trade=studioRouteHash(route,'trade',{returnTo:null});
 const settings=parseStudioRoute(studioRouteHash(route,'settings',{view:'data',returnTo:trade}));
 assert.equal(settings.params.has('firstDecision'),false);
 assert.equal(settings.params.get('returnTo'),trade);
 assert.equal(parseStudioRoute(trade).params.get('firstDecision'),'1');
 assert.equal(parseStudioRoute(studioRouteHash(route,'trade',{executionMode:'live'})).params.has('firstDecision'),false);
 assert.equal(parseStudioRoute(studioRouteHash(route,'trade',{firstDecision:null})).params.get('profileId'),'mind-one');
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
test('JEV setup returns to the originating trade, home view or saved document',()=>{
 const recovery=returnTo=>studioReturnLink(parseStudioRoute('#settings?'+new URLSearchParams({view:'connections',executionMode:'live',returnTo})),parseStudioRoute,studioRouteHash);
 const trade='#trade?executionMode=paper&profileId=mind-one&instrumentId=crypto%3Aokx%3ABTC-USDT&timeframe=4h&tab=decisions';
 const home='#home?executionMode=paper&showcase=experiments&currency=BTC';
 assert.deepEqual(recovery(trade),{href:trade,label:'같은 트레이딩 화면으로 돌아가기'});
 assert.deepEqual(recovery(home),{href:home,label:'투자 홈으로 돌아가기'});
 const document='#library?view=documents&executionMode=paper&knowledgeId=source-one';
 assert.deepEqual(recovery(document),{href:document,label:'같은 자료로 돌아가기'});
 for(const invalid of ['https://example.com/#trade','#//example.com','#settings?view=accounts','#trade/other'])assert.equal(recovery(invalid),null);
});
