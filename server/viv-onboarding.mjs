import {paperBudgetFor} from '../dist/domain/paper-budget.mjs';

export const VIV_INSTRUCTIONS='VIV는 Vibe Investment입니다. 사용자가 처음 시작하거나 설치 직후 대화를 시작하면 viv_onboarding을 조회하고 안내를 따르세요. 사용자의 선택을 기다리고 숫자와 자연어를 모두 받으세요. 결과 확인은 응답의 링크를 호스트의 인앱 브라우저에서 열거나 클릭 가능한 링크로 제공하세요.';

const lessons=[
  {number:1,title:'오늘의 코인 시장 주요 투자동향을 조사하고 수집해줘',tools:['read_market_knowledge','write_market_knowledge']},
  {number:2,title:'유튜브의 거래 기록을 분석해서 전략으로 만들어줘',tools:['read_mind_catalog','read_strategy_ontology','draft_quant_strategy']},
  {number:3,title:'이 링크의 투자법을 내 전략으로 만들어줘',tools:['read_strategy_ontology','read_quant_library','draft_quant_strategy']},
  {number:4,title:'내 모의투자 상태와 최근 판단을 브리핑해줘',tools:['read_investment_status','read_trading_context']},
];

export const VIV_PLAYBOOK=[
  '안녕하세요 투자자님. VIV에 오신 것을 환영합니다.',
  '먼저 viv_onboarding을 인수 없이 호출하세요. 모의 원화 예산이 있으면 기존 예산을 보여주고 튜토리얼 선택으로 이동하세요.',
  '처음이라면 어느 분야에 관심 있나요? 1 주식 / 2 코인 / 3 둘 다. 답을 받은 뒤 “본 게임 전에 모의 투자를 해볼 수 있어요. 모의 원화 예산을 얼마로 설정할까요?”라고 금액을 받으세요.',
  '분야와 금액을 모두 받은 뒤에만 “모의계좌를 세팅하는 중입니다”라고 안내하고 viv_onboarding에 interest, amountKrw, 재시도에도 같은 idempotencyKey를 전달하세요. 응답이 성공한 경우에만 금액과 확인 링크를 안내하세요. 이 단계는 공용 모의 예산을 만들며 전략 배정과 실행은 각각 다음 과업입니다.',
  '“튜토리얼이 있습니다. 진행하실까요? 1 진행 / 2 건너뛰기”를 먼저 물으세요. 진행을 선택하면 “안녕하세요 투자자님. 이런 걸 시켜볼 수 있어요.”와 lessons의 번호 및 제목을 보여주세요.',
  '자료 조사 과업은 호스트의 웹 검색·영상 자막 등 실제 접근 가능한 도구로 원문을 확인하고, VIV에서 현재 라이브러리·양식·전략 노드 메타데이터를 조회하세요. 원문 URL, 공개·조회 시각, 영상 시간대, 확인된 사실과 추론을 구분해 짧게 브리핑하세요. 링크나 접근 가능한 자막이 없으면 링크 또는 제공 가능한 원문을 요청하세요. 확인할 수 없는 거래나 수익은 추정했다고 표시하세요.',
  '저장 전에 “어디에 저장할까요?”라고 묻고 1 라이브러리 자료 초안 / 2 퀀트 전략 초안 / 3 저장 없이 보기 중 현재 과업에 맞는 선택만 제시하세요. 선택한 뒤 해당 쓰기 도구를 호출하고 영수증의 openUrl로 저장 결과를 보여주세요.',
  '한 과업이 끝나면 이 대화에서 완료한 번호를 빼고 남은 번호를 제시하세요. “아직 해보지 않은 항목입니다. 계속 해보시겠어요? 번호로 고르거나 0으로 마칠 수 있어요.” 모두 완료하거나 건너뛰거나 0을 고르면 다음 단계로 이동하세요.',
  '마지막으로 “실제 투자를 하려면 거래소 API 키 연결이 필요해요. 1 지금 연결 / 2 나중에”라고 물으세요. 지금을 고르면 links.connections를 호스트의 인앱 브라우저에서 열거나 링크로 제공하세요. API 키 입력은 VIV 설정 화면에서만 하도록 안내하세요. 선택 자체는 운용 활성화나 주문 동의가 아닙니다.',
].join('\n');

export async function vivOnboarding(args,{origin,call}){
  const current=await call('/api/workspace?view=studio');
  if(!current.ok)return current;
  const workspace=current.value.workspace;
  if(!workspace||!Number.isSafeInteger(workspace.revision))throw Error('ONBOARDING_WORKSPACE_REQUIRED');
  const links={
    paperAccount:origin+'/#settings?view=accounts&executionMode=paper',
    knowledge:origin+'/#library?view=documents&executionMode=paper',
    strategies:origin+'/#library?view=quant&section=components&executionMode=paper',
    connections:origin+'/#settings?view=connections&executionMode=live',
  };
  const existing=paperBudgetFor(workspace,'KRW');
  if(existing)return {ok:true,value:{ok:true,next:'tutorial_offer',paperBudget:{amountKrw:existing.totalBudget,existing:true},lessons,links}};
  if(args.amountKrw===undefined)return {ok:true,value:{ok:true,next:'ask_interest_and_budget',interests:[{number:1,value:'stocks',title:'주식'},{number:2,value:'crypto',title:'코인'},{number:3,value:'both',title:'둘 다'}],lessons,links}};
  const result=await call('/api/workspace/accounts/budget',{method:'POST',body:{quoteCurrency:'KRW',totalBudget:args.amountKrw,expectedRevision:workspace.revision,idempotencyKey:args.idempotencyKey}});
  if(!result.ok)return result;
  return {ok:true,value:{ok:true,next:'tutorial_offer',interest:args.interest,paperBudget:{amountKrw:args.amountKrw,receipt:result.value.budget},lessons,links}};
}
