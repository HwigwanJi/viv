import {paperBudgetFor} from '../dist/domain/paper-budget.mjs';
import {PAPER_DECISION_ENTRY,paperDecisionRecordHash} from '../dist/system/paper-decision-links.mjs';

export const VIV_TUTORIAL_ACTIONS=['pause','resume','complete'];

export const VIV_INSTRUCTIONS='VIV는 Vibe Investment입니다. 처음 시작·설치 직후·튜토리얼 재개 요청에는 viv_onboarding을 조회하고 저장된 진행 상태에 따라 안내하세요. 숫자와 자연어를 모두 받으세요. 뉴스 조사와 전략 분석은 완료하면 save_market_research로 개인 라이브러리에 바로 저장하세요. 저장 영수증은 라이브러리 상태와 링크로 안내하세요. 검증·정책 반영·운용 완료는 각각 실제 결과를 확인한 경우에만 보고하세요. 조회만 요청한 경우에는 읽기만 하세요. 결과 확인은 응답의 링크를 호스트의 인앱 브라우저에서 열거나 클릭 가능한 링크로 제공하세요.';

const lessons=[
  {number:1,title:'오늘의 코인 시장 주요 투자동향을 조사하고 수집해줘',tools:['read_mind_catalog','read_market_knowledge','save_market_research']},
  {number:2,title:'유튜브의 거래 기록을 분석해서 전략으로 만들어줘',tools:['read_mind_catalog','read_strategy_ontology','save_market_research']},
  {number:3,title:'이 링크의 투자법을 내 전략으로 만들어줘',tools:['read_strategy_ontology','read_quant_library','save_market_research']},
  {number:4,title:'첫 모의 판단을 실행하고 근거를 확인해 보고 싶어',tools:['read_investment_status','read_trading_context']},
];

export const VIV_PLAYBOOK=[
  '안녕하세요 투자자님. VIV에 오신 것을 환영합니다.',
  '먼저 viv_onboarding을 인수 없이 호출하세요. 이미 모의 원화 예산이 있으면 금액과 확인 링크를 안내하고 next 상태를 따르세요.',
  'tutorial_paused 또는 tutorial_complete에서는 튜토리얼을 다시 권하지 말고 사용자가 하려는 일을 진행하세요. 사용자가 “튜토리얼 계속”, “이어하기”라고 하면 action:resume으로 남은 항목을 불러오세요.',
  '처음이라면 어느 분야에 관심 있나요? 1 주식 / 2 코인 / 3 둘 다. 답을 받은 뒤 “본 게임 전에 모의 투자를 해볼 수 있어요. 모의 원화 예산을 얼마로 설정할까요?”라고 금액을 받으세요.',
  '분야와 금액을 모두 받은 뒤에만 “모의계좌를 세팅하는 중입니다”라고 안내하고 viv_onboarding에 interest, amountKrw, 재시도에도 같은 idempotencyKey를 전달하세요. 응답이 성공한 경우에만 금액과 확인 링크를 안내하세요. 이 단계는 공용 모의 예산을 만들며 전략 배정과 실행은 각각 다음 과업입니다.',
  'tutorial_offer일 때 “튜토리얼이 있습니다. 진행하실까요? 1 진행 / 2 건너뛰기”를 한 번 물으세요. 진행은 action:resume, 건너뛰기 또는 중단은 action:pause로 저장하세요. tutorial_lessons에서는 lessons의 남은 번호와 제목만 보여주세요. 원래 번호를 유지하고 자연어로 말한 과업도 연결하세요.',
  '자료 조사 과업은 호스트의 웹 검색·영상 자막 등 실제 접근 가능한 도구로 원문을 확인하고, VIV에서 현재 라이브러리·양식·전략 노드 메타데이터를 조회하세요. 원문 URL, 공개·조회 시각, 영상 시간대, 확인된 사실과 추론을 구분해 짧게 브리핑하세요. 링크나 접근 가능한 자막이 없으면 링크 또는 제공 가능한 원문을 요청하세요. 확인할 수 없는 거래나 수익은 추정했다고 표시하세요.',
  '저장 양식의 예제 값을 원문 정보로 바꾸세요. publication.publishedAt은 원문 공개 시각, publication.retrievedAt과 provenance.createdAt은 실제 수집·작성 시각입니다. availableAt은 수집과 작성이 끝난 시각 이후로 설정하세요.',
  '1~3번 조사·분석 결과는 출처와 함께 save_market_research로 개인 라이브러리에 바로 저장하고, 영수증의 openUrl을 브리핑과 함께 제공하세요. 2~3번은 재현할 매매 규칙과 가정을 문서에 담으세요. 검증을 실행했다면 조건·결과를 기록하고, 실행 전이면 검증 상태를 명시하세요. 사용자가 저장 없이 보기를 요청하면 저장하지 마세요.',
  '4번은 read_investment_status로 시작하세요. 새 판단을 연습하려면 links.paperDecision을 열고, 사용자가 원하는 종목과 마인드를 고른 뒤 화면에 표시되는 준비 작업을 함께 진행하세요. 통화 예산이나 배정이 필요하면 화면의 모의 자금 설정을 사용하세요. JEV 연결이 표시되면 AI 판단에 필요한 연결임을 설명하세요. 실계좌 연결은 이 과업에 필요하지 않습니다.',
  '사용자가 종목 화면에서 결정 실행을 선택하면 앱에 저장된 결정 상세가 열립니다. read_investment_status를 다시 조회하고, 방금 실행한 종목·마인드·시각과 일치하는 항목의 openUrl을 안내하세요. 근거는 read_trading_context에서 확인하세요. 사용자가 브리핑만 요청하면 기존 기록만 조회하세요.',
  '사용자에게 과업 결과를 실제로 제공한 뒤 action:complete와 lesson 번호를 보내세요. 1~3번은 저장 영수증의 documentId를 보내고 사용자가 자료 저장 없이 보기를 요청했다면 readOnly:true로 진행 상태만 기록합니다. 진행 상태 저장도 원하지 않으면 완료 기록을 남기지 마세요. 4번은 사용자가 실행한 판단의 저장 기록과 근거를 확인한 뒤 decisionId를 함께 보냅니다. 사용자가 브리핑만 원했다면 그 브리핑을 제공한 뒤 번호만 보냅니다. 실행 실패·자료 대기 상태는 완료 처리하지 마세요.',
  '응답 lessons의 남은 항목을 보여주고 0 또는 “여기까지”를 선택하면 action:pause로 중단을 저장하세요. 완료한 항목의 확인 링크는 tutorial.completed에 있습니다. 사용자가 결과를 다시 열어달라고 하면 해당 링크를 제공하세요.',
  '설치 첫 대화에서 튜토리얼을 마치거나 건너뛴 경우 연결 안내는 한 번만 제공합니다. 복귀 대화에서는 사용자가 실계좌 연결을 요청했을 때만 안내하세요. “실제 투자를 하려면 거래소 API 키 연결이 필요해요. 1 지금 연결 / 2 나중에”라고 물으세요. 지금을 고르면 links.connections를 호스트의 인앱 브라우저에서 열거나 링크로 제공하세요. 키는 VIV의 실전 계좌·자금 화면에서만 입력하도록 안내하세요. 그 화면에서 금융기관을 선택하고 잔고 조회로 연결을 확인합니다.',
].join('\n');

async function tutorialProgress(db,owner,args){
  const statement=(sql,...params)=>db.prepare(sql).bind(...params);
  await statement("CREATE TABLE IF NOT EXISTS viv_tutorial_progress(owner_id TEXT PRIMARY KEY,status TEXT NOT NULL,completed TEXT NOT NULL,interest TEXT)").run();
  if(args.interest){
    await statement("INSERT INTO viv_tutorial_progress(owner_id,status,completed,interest) VALUES(?,'new','{}',?) ON CONFLICT(owner_id) DO UPDATE SET interest=coalesce(interest,excluded.interest)",owner,args.interest).run();
  }else if(args.action==='pause'||args.action==='resume'){
    const status=args.action==='pause'?'paused':'active';
    await statement("INSERT INTO viv_tutorial_progress(owner_id,status,completed) VALUES(?,?,'{}') ON CONFLICT(owner_id) DO UPDATE SET status=excluded.status",owner,status).run();
  }else if(args.action==='complete'){
    const lesson=String(args.lesson),path='$."'+lesson+'"',resultId=args.decisionId??args.documentId??null;
    await statement("INSERT INTO viv_tutorial_progress(owner_id,status,completed) VALUES(?,'active',json_object(?,?)) ON CONFLICT(owner_id) DO UPDATE SET completed=json_set(completed,?,coalesce(?,json_extract(completed,?)))",
      owner,lesson,resultId,path,resultId,path).run();
  }
  const row=await statement('SELECT status,completed,interest FROM viv_tutorial_progress WHERE owner_id=?',owner).first();
  return {status:row?.status??'new',completed:JSON.parse(row?.completed??'{}'),interest:row?.interest};
}

const failure=(code,message)=>({ok:false,value:{ok:false,code,message}});

export async function vivOnboarding(args,{origin,call,db,owner}){
  const current=await call('/api/workspace?view=studio');
  if(!current.ok)return current;
  const workspace=current.value.workspace;
  if(!workspace||!Number.isSafeInteger(workspace.revision))throw Error('ONBOARDING_WORKSPACE_REQUIRED');
  const links={
    paperAccount:origin+'/#settings?view=accounts&executionMode=paper',
    paperDecision:new URL(PAPER_DECISION_ENTRY,origin).href,
    knowledge:origin+'/#library?view=documents&executionMode=paper',
    strategies:origin+'/#library?view=quant&section=components&executionMode=paper',
    connections:origin+'/#settings?view=accounts&executionMode=live',
  };
  const existing=paperBudgetFor(workspace,'KRW');
  if(!existing){
    if(args.action)return failure('VIV_PAPER_BUDGET_REQUIRED','먼저 모의 원화 예산을 설정하세요.');
    if(args.amountKrw===undefined)return {ok:true,value:{ok:true,next:'ask_interest_and_budget',interests:[{number:1,value:'stocks',title:'주식'},{number:2,value:'crypto',title:'코인'},{number:3,value:'both',title:'둘 다'}],lessons,links}};
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
  const progress=await tutorialProgress(db.withSession?.('first-primary')??db,owner,args);
  const selectedLessons=progress.interest==='stocks'
    ?[{...lessons[0],title:'오늘의 주식 시장 주요 투자동향을 조사하고 수집해줘'},...lessons.slice(1)]
    :lessons;
  const remaining=selectedLessons.filter(lesson=>!Object.hasOwn(progress.completed,lesson.number));
  const completed=selectedLessons.filter(lesson=>Object.hasOwn(progress.completed,lesson.number)).map(({number,title})=>{
    const resultId=progress.completed[number];
    if(!resultId)return {number,title};
    if(number===4)return {number,title,decisionId:resultId,openUrl:new URL(paperDecisionRecordHash(resultId),origin).href};
    return {number,title,documentId:resultId,openUrl:links.knowledge+'&'+new URLSearchParams({knowledgeId:resultId})};
  });
  const next=!remaining.length?'tutorial_complete':({new:'tutorial_offer',paused:'tutorial_paused',active:'tutorial_lessons'})[progress.status];
  return {ok:true,value:{ok:true,next,...(progress.interest?{interest:progress.interest}:{}),paperBudget,lessons:remaining,tutorial:{status:next,completed},links}};
}
