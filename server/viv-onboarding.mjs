import {paperBudgetFor} from '../dist/domain/paper-budget.mjs';
import {PAPER_DECISION_ENTRY,PAPER_HOME_ENTRY,PAPER_PRACTICE_ENTRY,paperDecisionRecordHash,paperPracticeReportHash} from '../dist/system/paper-decision-links.mjs';

export const VIV_TUTORIAL_ACTIONS=['pause','resume','complete','defer_connection'];

export const VIV_INSTRUCTIONS='VIV는 Vibe Investment입니다. 처음 시작·설치 직후·튜토리얼 재개 요청에는 viv_onboarding을 조회하고 저장된 진행 상태에 따라 안내하세요. 숫자와 자연어를 모두 받으세요. 실계좌 연결은 사용자가 요청했거나 liveConnection.offer가 true일 때 안내하세요. 뉴스 조사와 전략 분석은 완료하면 save_market_research로 개인 라이브러리에 바로 저장하세요. 저장 영수증은 라이브러리 상태와 링크로 안내하세요. 검증·정책 반영·운용 완료는 각각 실제 결과를 확인한 경우에만 보고하세요. 조회만 요청한 경우에는 읽기만 하세요. 결과 확인은 응답의 링크를 호스트의 인앱 브라우저에서 열거나 클릭 가능한 링크로 제공하세요.';

const lessons=[
  {number:1,title:'오늘의 코인 시장 주요 투자동향을 조사하고 수집해줘',tools:['read_mind_catalog','read_market_knowledge','save_market_research']},
  {number:2,title:'유튜브의 거래 기록을 분석해서 전략으로 만들어줘',tools:['read_mind_catalog','read_strategy_ontology','save_market_research']},
  {number:3,title:'이 링크의 투자법을 내 전략으로 만들어줘',tools:['read_strategy_ontology','read_quant_library','save_market_research']},
  {number:4,title:'모의로 판단을 연습하고 저장된 근거 확인하기',tools:['read_investment_status','read_trading_context','read_simulation_collection','read_mind_catalog'],choices:[
    {link:'paperPractice',label:'키 없이 BTC 과거 시세 실습',requirements:'보관한 BTC 시세와 기준 퀀트 전략을 사용합니다. 실습용 초기 자금은 따로 정하며 AI 호출은 0회입니다.'},
    {link:'paperDecision',label:'현재 시세로 모의 판단',requirements:'종목의 결제 통화로 모의 자금을 배정하고 최신 시세를 준비합니다. 선택한 전략이 AI를 호출하면 JEV 키가 필요합니다.'},
  ]},
];

export const VIV_PLAYBOOK=[
  '안녕하세요 투자자님. VIV에 오신 것을 환영합니다.',
  '먼저 viv_onboarding을 인수 없이 호출하세요. 이미 모의 원화 예산이 있으면 금액과 확인 링크를 안내하고 next 상태를 따르세요.',
  'tutorial_paused 또는 tutorial_complete에서는 튜토리얼을 다시 권하지 말고 사용자가 하려는 일을 진행하세요. 사용자가 “튜토리얼 계속”, “이어하기”라고 하면 action:resume으로 남은 항목을 불러오세요.',
  '처음이라면 어느 분야에 관심 있나요? 1 주식 / 2 코인 / 3 둘 다. 답을 받은 뒤 “본 게임 전에 모의 투자를 해볼 수 있어요. 모의 원화 예산을 얼마로 설정할까요?”라고 금액을 받으세요.',
  '분야와 금액을 모두 받은 뒤에만 “모의계좌를 세팅하는 중입니다”라고 안내하고 viv_onboarding에 interest, amountKrw, 재시도에도 같은 idempotencyKey를 전달하세요. 응답이 성공한 경우에만 금액과 확인 링크를 안내하세요. 이 단계는 공용 모의 예산을 만들며 전략 배정과 실행은 각각 다음 과업입니다.',
  'tutorial_offer일 때 “튜토리얼이 있습니다. 진행하실까요? 1 진행 / 2 건너뛰기”를 한 번 물으세요. 진행은 action:resume, 건너뛰기 또는 중단은 action:pause로 저장하세요. tutorial_lessons에서는 lessons의 남은 번호와 제목만 보여주세요. 원래 번호를 유지하고 자연어로 말한 과업도 연결하세요.',
  '자료 조사 과업은 호스트의 웹 검색·영상 자막 등 실제 접근 가능한 도구로 원문을 확인하고, VIV에서 현재 라이브러리·양식·전략 노드 메타데이터를 조회하세요. 원문 URL, 공개·조회 시각, 영상 시간대, 확인된 사실과 추론을 구분해 짧게 브리핑하세요. 원문을 열 수 없으면 읽지 못한 부분을 말하고 다른 링크, 원문 붙여넣기, 이 과업 건너뛰기를 제시하세요. 이 과업을 건너뛰면 완료로 표시하지 말고 남은 다른 과업으로 이어가세요. 실제로 확인한 발췌만 사용하고 범위를 표시하세요. 확인할 수 없는 거래나 수익은 미확인으로 남기세요.',
  '저장 양식의 예제 값을 원문 정보로 바꾸세요. publication.publishedAt은 원문 공개 시각, publication.retrievedAt과 provenance.createdAt은 실제 수집·작성 시각입니다. 원문에 공개일이 없으면 publication.precision을 undated로, publishedAt·sourcePublishedValue·timezone을 각각 null로 보내고 실제 수집 시각은 그대로 기록하세요. 이 결과도 바로 저장할 수 있으며 원문 공개 시점이 확인된 버전부터 마인드 판단에 활용할 수 있습니다. availableAt은 수집과 작성이 끝난 시각 이후로 설정하세요.',
  '1~3번 조사·분석 결과는 출처와 함께 save_market_research로 개인 라이브러리에 바로 저장하고, 영수증의 openUrl을 브리핑과 함께 제공하세요. 저장 중 REVISION_CONFLICT를 받으면 read_market_knowledge로 revision을 다시 조회하고 같은 문서·idempotencyKey로 재시도하세요. 응답이 끊겼다면 동일 요청을 재시도해 영수증을 확인하고 중복 문서를 만들지 마세요. 2~3번은 재현할 매매 규칙과 가정을 문서에 담으세요. 검증을 실행했다면 조건·결과를 기록하고, 실행 전이면 검증 상태를 명시하세요. 사용자가 저장 없이 보기를 요청하면 저장하지 마세요.',
  '4번은 read_investment_status로 시작하세요. 처음 연습하거나 키를 나중에 설정하려는 사용자는 links.paperPractice에서 보관한 BTC 시세로 기준 퀀트 전략을 실행할 수 있습니다. 현재 시세의 판단을 원하면 links.paperDecision에서 종목과 마인드를 고릅니다. 종목의 결제 통화로 모의 자금을 배정하고 최신 시세를 준비합니다. 선택한 전략이 AI를 호출하는 경우에 JEV 키가 필요합니다. 두 과업 모두 실계좌 연결 없이 진행하며 백테스트와 현재 시세 모의 판단은 다른 기록으로 안내하세요.',
  '과거 시세 실습 결과를 확인하거나 다시 찾을 때는 read_simulation_collection에 kind:simulation, status:completed를 전달하세요. 실험 ID나 이름을 알면 q에 넣고, 마인드 이름만 알면 read_mind_catalog에서 확인한 mindId로 조회하세요. 후보가 여럿이면 실험 기간 또는 생성 시각을 확인하세요. 일치한 항목의 openUrl을 제공하고 성과·판단 탭을 안내하세요. 완료한 백테스트는 앱의 마인드 → 전체 시뮬레이션에서도 다시 열 수 있습니다.',
  '사용자가 종목 화면에서 결정 실행을 선택하면 앱에 저장된 결정 상세가 열립니다. read_investment_status를 다시 조회하고, 방금 실행한 종목·마인드·시각과 일치하는 항목의 openUrl을 안내하세요. 근거는 read_trading_context에 항목의 id를 decisionId로, profileId를 mindId로, instrumentId를 그대로 전달해 확인하세요. 개별 선택 근거가 저장되지 않은 경우 적용한 원칙과 선택 분포를 안내하세요. 사용자가 브리핑만 요청하면 기존 기록만 조회하세요.',
  '사용자에게 과업 결과를 실제로 제공한 뒤 action:complete와 lesson 번호를 보내세요. 1~3번은 저장 영수증의 documentId를 보내고 사용자가 자료 저장 없이 보기를 요청했다면 readOnly:true로 진행 상태만 기록합니다. 진행 상태 저장도 원하지 않으면 완료 기록을 남기지 마세요. 4번은 근거를 확인한 저장 판단의 decisionId 또는 완료한 기준 퀀트 백테스트의 simulationId를 함께 보냅니다. 둘 중 수행한 결과 하나를 보내고 반환된 openUrl을 안내하세요. 사용자가 브리핑만 원했다면 그 브리핑을 제공한 뒤 번호만 보냅니다. 실행 실패·자료 대기 상태는 완료 처리하지 마세요.',
  '응답 lessons의 남은 항목을 보여주고 0 또는 “여기까지”를 선택하면 action:pause로 중단을 저장하세요. 완료한 항목의 확인 링크는 tutorial.completed에 있습니다. 사용자가 결과를 다시 열어달라고 하면 해당 링크를 제공하세요.',
  'liveConnection.offer가 true일 때만 “실계좌 연결이 필요하신가요? 1 지금 연결 / 2 나중에”를 한 번 안내하세요. 중단하거나 건너뛴 사용자는 요청한 모의 과업으로 이어가세요. 사용자가 지금 연결을 고르거나 직접 연결을 요청하면 links.connections를 열거나 링크로 제공하세요. 나중에를 고르면 action:defer_connection을 보내고 links.paperResume으로 돌아가세요. 발급 중 돌아오려는 경우에도 links.paperResume을 제공하세요. 키는 VIV의 실전 계좌·자금 화면에만 입력합니다. 연결과 잔고 조회가 실제로 확인된 뒤 완료를 안내하세요.',
].join('\n');

async function tutorialProgress(db,owner,args){
  const statement=(sql,...params)=>db.prepare(sql).bind(...params);
  await statement("CREATE TABLE IF NOT EXISTS viv_tutorial_progress(owner_id TEXT PRIMARY KEY,status TEXT NOT NULL,completed TEXT NOT NULL,interest TEXT)").run();
  let previouslyComplete=false;
  if(args.interest){
    await statement("INSERT INTO viv_tutorial_progress(owner_id,status,completed,interest) VALUES(?,'new','{}',?) ON CONFLICT(owner_id) DO UPDATE SET interest=coalesce(interest,excluded.interest)",owner,args.interest).run();
  }else if(args.action==='pause'||args.action==='resume'){
    const status=args.action==='pause'?'paused':'active';
    await statement("INSERT INTO viv_tutorial_progress(owner_id,status,completed) VALUES(?,?,'{}') ON CONFLICT(owner_id) DO UPDATE SET status=excluded.status",owner,status).run();
  }else if(args.action==='complete'){
    const previous=await statement('SELECT completed FROM viv_tutorial_progress WHERE owner_id=?',owner).first();
    const previousResults=JSON.parse(previous?.completed??'{}');
    previouslyComplete=lessons.every(lesson=>Object.hasOwn(previousResults,lesson.number));
    const lesson=String(args.lesson),path='$."'+lesson+'"';
    const result=args.simulationId?{simulationId:args.simulationId}:args.decisionId??args.documentId??null;
    const receipt=result===null?null:JSON.stringify(result);
    await statement("INSERT INTO viv_tutorial_progress(owner_id,status,completed) VALUES(?,'active',json_object(?,json(?))) ON CONFLICT(owner_id) DO UPDATE SET completed=json_set(completed,?,json(coalesce(?,completed -> ?)))",
      owner,lesson,receipt,path,receipt,path).run();
  }
  const row=await statement('SELECT status,completed,interest FROM viv_tutorial_progress WHERE owner_id=?',owner).first();
  return {status:row?.status??'new',completed:JSON.parse(row?.completed??'{}'),interest:row?.interest,previouslyComplete};
}

async function liveConnectionPreference(db,owner,{offer=false,defer=false}={}){
  const statement=(sql,...params)=>db.prepare(sql).bind(...params);
  await statement('CREATE TABLE IF NOT EXISTS viv_connection_prompt(owner_id TEXT PRIMARY KEY,deferred INTEGER NOT NULL)').run();
  if(defer)await statement('INSERT INTO viv_connection_prompt VALUES(?,1) ON CONFLICT(owner_id) DO UPDATE SET deferred=1',owner).run();
  const emitted=offer&&!!await statement('INSERT INTO viv_connection_prompt VALUES(?,0) ON CONFLICT(owner_id) DO NOTHING RETURNING deferred',owner).first();
  const row=await statement('SELECT deferred FROM viv_connection_prompt WHERE owner_id=?',owner).first();
  const deferred=row?.deferred===1;
  return {offer:emitted&&!deferred,deferred};
}

const failure=(code,message)=>({ok:false,value:{ok:false,code,message}});

export async function vivOnboarding(args,{origin,call,db,owner}){
  const current=await call('/api/workspace?view=studio');
  if(!current.ok)return current;
  const workspace=current.value.workspace;
  if(!workspace||!Number.isSafeInteger(workspace.revision))throw Error('ONBOARDING_WORKSPACE_REQUIRED');
  const session=db.withSession?.('first-primary')??db,defer=args.action==='defer_connection';
  const links={
    paperHome:new URL(PAPER_HOME_ENTRY,origin).href,
    paperResume:new URL(PAPER_HOME_ENTRY,origin).href,
    paperAccount:origin+'/#settings?view=accounts&executionMode=paper',
    paperDecision:new URL(PAPER_DECISION_ENTRY,origin).href,
    paperPractice:new URL(PAPER_PRACTICE_ENTRY,origin).href,
    knowledge:origin+'/#library?view=documents&executionMode=paper',
    strategies:origin+'/#library?view=quant&section=components&executionMode=paper',
    connections:origin+'/#settings?view=accounts&executionMode=live',
  };
  const existing=paperBudgetFor(workspace,'KRW');
  if(!existing){
    if(args.action&&!defer)return failure('VIV_PAPER_BUDGET_REQUIRED','먼저 모의 원화 예산을 설정하세요.');
    if(args.amountKrw===undefined)return {ok:true,value:{ok:true,next:'ask_interest_and_budget',interests:[{number:1,value:'stocks',title:'주식'},{number:2,value:'crypto',title:'코인'},{number:3,value:'both',title:'둘 다'}],lessons,links,liveConnection:await liveConnectionPreference(session,owner,{defer})}};
  }
  let paperBudget;
  if(existing)paperBudget={amountKrw:existing.totalBudget,existing:true};
  else{
    const result=await call('/api/workspace/accounts/budget',{method:'POST',body:{quoteCurrency:'KRW',totalBudget:args.amountKrw,expectedRevision:workspace.revision,idempotencyKey:args.idempotencyKey}});
    if(!result.ok)return result;
    paperBudget={amountKrw:args.amountKrw,receipt:result.value.budget};
  }
  if(args.documentId){
    const saved=await call('/api/workspace/market-knowledge/item?'+new URLSearchParams({id:args.documentId}));
    if(!saved.ok&&saved.value.code!=='KNOWLEDGE_NOT_FOUND')return saved;
    if(!saved.ok||!['SAVED','APPROVED'].includes(saved.value.entry?.status))return failure('VIV_TUTORIAL_RESULT_REQUIRED','개인 라이브러리에 저장된 결과를 확인한 뒤 완료로 표시하세요.');
  }
  if(args.decisionId){
    const run=workspace.mindRuns.find(row=>row.id===args.decisionId);
    if(run?.experimentType!=='FORWARD_PAPER'||!['buy','hold','sell'].includes(run.decision?.action)||run.status==='FAILED'){
      return failure('VIV_TUTORIAL_DECISION_REQUIRED','같은 계정의 저장된 모의 판단을 확인한 뒤 완료로 표시하세요.');
    }
  }
  if(args.simulationId){
    const saved=await call('/api/workspace/simulations/item?'+new URLSearchParams({id:args.simulationId}));
    if(!saved.ok&&saved.value.code!=='SIMULATION_NOT_FOUND')return saved;
    const simulation=saved.value.simulation;
    if(!saved.ok||simulation?.id!==args.simulationId||simulation.status!=='COMPLETED'||simulation.config?.mode!=='MECHANICAL'||!simulation.report){
      return failure('VIV_TUTORIAL_SIMULATION_REQUIRED','같은 계정의 완료된 기준 퀀트 백테스트 보고서를 확인한 뒤 완료로 표시하세요.');
    }
  }
  const progress=await tutorialProgress(session,owner,args);
  const selectedLessons=progress.interest==='stocks'
    ?[{...lessons[0],title:'오늘의 주식 시장 주요 투자동향을 조사하고 수집해줘'},...lessons.slice(1)]
    :lessons;
  const remaining=selectedLessons.filter(lesson=>!Object.hasOwn(progress.completed,lesson.number));
  const completed=selectedLessons.filter(lesson=>Object.hasOwn(progress.completed,lesson.number)).map(({number,title})=>{
    const resultId=progress.completed[number];
    if(!resultId)return {number,title};
    if(number===4&&resultId.simulationId)return {number,title,simulationId:resultId.simulationId,openUrl:new URL(paperPracticeReportHash(resultId.simulationId),origin).href};
    if(number===4)return {number,title,decisionId:resultId,openUrl:new URL(paperDecisionRecordHash(resultId),origin).href};
    return {number,title,documentId:resultId,openUrl:links.knowledge+'&'+new URLSearchParams({knowledgeId:resultId})};
  });
  const next=!remaining.length?'tutorial_complete':({new:'tutorial_offer',paused:'tutorial_paused',active:'tutorial_lessons'})[progress.status];
  const paperResult=completed.find(lesson=>lesson.number===4)?.openUrl;
  if(paperResult){
    links.paperResume=paperResult;
    links.connections+='&'+new URLSearchParams({returnTo:new URL(paperResult).hash});
  }
  const offer=args.action==='complete'&&!progress.previouslyComplete&&next==='tutorial_complete'&&progress.status==='active';
  const liveConnection=await liveConnectionPreference(session,owner,{offer,defer});
  return {ok:true,value:{ok:true,next,...(progress.interest?{interest:progress.interest}:{}),paperBudget,lessons:remaining,tutorial:{status:next,completed},links,liveConnection}};
}
