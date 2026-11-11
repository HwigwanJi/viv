import {simulationMarketScope} from './simulation-asset-scope.mjs';
import {helpTooltip} from './help-tooltip.mjs';

const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const preProviderRecoveryCandidate=s=>s?.status==='ACTION_REQUIRED'&&s.preProviderRecoveryCandidate===true;
export const preProviderRecoveryReview=review=>review?.contract==='SIMULATION_PRE_PROVIDER_RECOVERY_V1'&&review.recoveryKind==='PRE_PROVIDER_FAILURE';
export const canPreparePreProviderRecovery=review=>preProviderRecoveryReview(review)&&review.canRecover===true&&review.providerCalls===0;

export function renderPreProviderRecovery(review,saved){
 const market=simulationMarketScope(saved),account=saved?.account??{},fact=(label,value)=>`<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`;
 const amount=value=>Number.isFinite(value)?market.amount(value)+' '+market.currency:'—';
 return `<section data-simulation-pre-provider-recovery="${esc(review.id)}"><p>${esc(review.sequence)}번째 판단 · ${esc(review.asOf)} · UTC</p><p>이 판단의 JEV 호출 ${esc(review.providerCalls)}회</p><p>${esc(review.originalFailure?.message??review.originalFailure?.code??'저장된 오류 확인')}</p><dl class="simulation-failure-facts">${fact('저장된 계좌 현금',amount(account.cash))}${fact('저장된 보유 종목',Array.isArray(account.positions)?account.positions.length+'종목':'—')}${fact('누적 수수료',amount(account.feesPaid))}${fact('계좌 기준 시각',account.asOf??'—')}</dl><p>재개 준비 후 ‘이어서 실행’으로 저장 지점부터 계산합니다.${helpTooltip('저장 지점에서 재개 준비','기존 실험·전략·계좌·처리한 봉을 유지하고 일시중지 상태로 전환합니다. 이 단계의 추가 JEV 호출은 0회입니다. 이어서 실행하면 중단된 봉의 계산부터 진행합니다.',{id:'simulation-pre-provider-help'})}</p>${!canPreparePreProviderRecovery(review)?`<p role="status">${esc(review.message??review.blockedReason?.message??'재개 조건을 다시 확인하세요.')}</p>`:''}<details><summary>복구 검토 원문</summary><pre class="code">${esc(JSON.stringify(review,null,2))}</pre></details></section>`;
}
