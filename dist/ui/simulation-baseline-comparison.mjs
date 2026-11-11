import {helpTooltip} from './help-tooltip.mjs';

const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const percent=value=>Number.isFinite(value)?(value*100).toFixed(2)+'%':'—';
const points=value=>Number.isFinite(value)?(value*100).toFixed(2)+'%p':'—';
const money=value=>Number.isFinite(value)?new Intl.NumberFormat('ko-KR',{maximumFractionDigits:2}).format(value)+' USDT':'—';

export function simulationDailyDcaHelp(simulation){
 const dca=simulation?.baselineComparison?.benchmarks?.dailyDca;
 return dca?`시작 시 보유한 초기 자금 ${money(simulation.config?.initialCash)}를 ${dca.purchaseDayCount}일로 나누어 매일 ${money(dca.dailyBudget)}씩 수수료를 포함해 매수합니다. UTC 날짜별 첫 체결 가능 봉의 시가에 같은 슬리피지를 적용합니다. 수익률은 잔여 현금을 포함한 전체 계좌 기준입니다. JEV 호출 비용은 별도로 집계합니다.`:'초기 자금을 기간의 매수일 수로 나누어 매일 같은 금액을 매수합니다. 같은 수수료·슬리피지와 잔여 현금을 반영합니다.';
}

export function simulationEquitySeries(simulation){
 const baseline=new Map((simulation?.baselineComparison?.curve??[]).map(point=>[point.at,point]));
 return (simulation?.chartPoints??[]).map(point=>({...point,...(Number.isFinite(baseline.get(point.at)?.dailyDcaEquity)?{dailyDcaEquity:baseline.get(point.at).dailyDcaEquity}:{})}));
}

export function renderSimulationBaselineComparison(simulations){
 if(!simulations?.length||simulations.some(s=>s.status!=='COMPLETED'||!s.baselineComparison))return '';
 const first=simulations[0],common=first.baselineComparison;
 const comparisonKey=s=>JSON.stringify([s.config?.startAt,s.config?.endAt,s.config?.initialCash,s.config?.feeBps,s.config?.slippageBps,s.baselineComparison?.provenance?.datasetHash,s.baselineComparison?.policyHash,s.baselineComparison?.benchmarks]);
 if(simulations.some(s=>comparisonKey(s)!==comparisonKey(first)))return '';
 const dca=common.benchmarks.dailyDca;
 const rows=simulations.map((s,index)=>({label:(simulations.length>1?(index?'B · ':'A · '):'')+(s.name??s.config?.name??'마인드'),metrics:s.metrics,eligible:s.evaluationEligibility?.wholeWindowComparable===true}));
 rows.push({label:'첫날 전액 매수',metrics:common.benchmarks.buyAndHold,eligible:true},{label:'초기자금 분할매수',metrics:dca,eligible:true});
 const headers=['비교 대상','순수익률','분할매수 대비','최대 낙폭','평균 투자 비중'];
 return `<section class="studio-sheet simulation-baseline-comparison" aria-label="매수 방식별 성과 비교"><div class="studio-sheet-head"><h3>매수 방식별 비교</h3>${helpTooltip('비교 기준',simulationDailyDcaHelp(first)+' 평균 투자 비중은 확정 봉마다 전체 평가자산 중 보유자산의 비율을 평균한 값입니다.',{id:'simulation-baseline-comparison-help'})}</div><div class="studio-table-scroll"><table class="studio-table"><thead><tr>${headers.map(label=>`<th>${label}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr><th scope="row">${esc(row.label)}</th><td>${percent(row.metrics?.totalReturn)}</td><td>${row.eligible&&Number.isFinite(row.metrics?.totalReturn)&&Number.isFinite(dca?.totalReturn)?points(row.metrics.totalReturn-dca.totalReturn):'—'}</td><td>${percent(row.metrics?.maxDrawdown)}</td><td>${percent(row.metrics?.averageExposure)}</td></tr>`).join('')}</tbody></table></div></section>`;
}
