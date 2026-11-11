const list=value=>Array.isArray(value)?value:[];
const recoveryActions=new Set(['choose-mind','profile','archive','account','connections','records','wait','run','data','refresh','timeframe','knowledge','paper']);
const readiness=model=>model.terminalReadiness?.schemaVersion===1?model.terminalReadiness:null;
const captureError=model=>/^(MARKET_CAPTURE_REQUIRED|CANONICAL_CAPTURE_(REQUIRED|STALE|BOUNDARY)|MIND_MARKET_BOUNDARY_CHANGED|MIND_CANONICAL_SOURCE)$/.test(model.errorCode||model.runRequirement?.code||'')||/기존 수집 정본|최신 확정 봉.*필요|확정 시세.*수집/.test(model.error||'');

export function terminalRunRequirement(model={}){
  return readiness(model)?.executionReadiness?.blockers?.[0]??model.runRequirement??null;
}

/** The selected mind is explicit; the aggregate view never chooses an executor. */
export function terminalPrimaryAction(model={}){
  const replay=model.source==='replay'&&model.selectedScope&&!['live','replay'].includes(model.selectedScope);
  const selected=list(model.profiles).some(profile=>profile.id===model.selectedMindId);
  if(!selected&&!replay)return {action:'choose-mind',label:'마인드 선택',disabled:!!model.busy};
  if(model.busy)return {action:'run',label:'실행 중…',disabled:true};
  if(model.status==='loading')return {action:'wait',label:'시세 조회 중…',disabled:true};
  const execution=readiness(model)?.executionReadiness,primary=execution?.primaryAction;
  if(primary&&recoveryActions.has(primary.action)){
    if(primary.action==='run'&&!execution.canRun)return {action:'inspect-conditions',label:'실행 조건 확인',disabled:false};
    return {...primary,canonical:true,disabled:primary.action==='wait'};
  }
  if(!model.canRun){const recovery=terminalRecoveryAction(model);return recovery?{...recovery,disabled:recovery.action==='wait'}:{action:'inspect-conditions',label:'실행 조건 확인',disabled:false};}
  return {action:'run',label:replay?'다음 봉 실행':'결정 실행',disabled:false};
}

/** Recovery is an action on the actual missing prerequisite, with no implicit writes. */
export function terminalRecoveryAction(model={}, {context='run'}={}){
  const current=readiness(model),canonical=context==='chart'?current?.marketRecovery?.action:current?.executionReadiness?.primaryAction;
  if(canonical&&recoveryActions.has(canonical.action))return {...canonical,canonical:true};
  const code=context==='chart'?null:model.runRequirement?.code;
  if(code==='MIND_SELECTION_REQUIRED')return {action:'choose-mind',label:'마인드 선택'};
  if(code==='PAPER_ACCOUNT_REQUIRED')return {action:'account',label:'모의 자금 설정'};
  if(model.connectionRequired===true||['CONNECT_REQUIRED','JEV_CONNECTION_REQUIRED','PROVIDER_CONNECTION_REQUIRED'].includes(code)||/연결.*설정|연결 필요/.test(model.error||''))return {action:'connections',label:'연결 설정'};
  if(['STRATEGY_PLAN_SCOPE','INSTRUMENT_OUTSIDE_MIND_SCOPE'].includes(code))return {action:'profile',label:'투자 범위 보기'};
  if(captureError(model))return {action:'data',label:'시세 수집'};
  return model.error?{action:'refresh',label:'다시 조회'}:null;
}

/** Provider diagnostics remain in the saved response; the workspace gives the next useful step. */
export function terminalMarketMessage(model={}){
  if(model.status==='loading')return '가격 조회 중…';
  const message=readiness(model)?.marketRecovery?.issue?.message;if(message)return message;
  if(captureError(model))return '최신 시세가 필요합니다.';
  if(/\b429\b/.test(model.error||''))return '시세 제공처의 호출 대기 시간입니다.';
  if(terminalRecoveryAction(model,{context:'chart'})?.action==='connections')return '시세 연결을 설정하세요.';
  return model.error?'시세를 불러오지 못했습니다.':'가격 데이터가 없습니다.';
}
