/** Form-only state; canonical simulation input is built by simulationFormPayload. */
export function simulationGeneratedName(mode, mindName, periodLabel = '사용자 지정') {
  const target = mode === 'GRAPH_CANONICAL' ? (mindName ? mindName + ' · ' : '') + '마인드 전략' : mode === 'JEV_RETROSPECTIVE' ? mindName : '기준 퀀트 전략';
  return periodLabel + ' · ' + target;
}
export function customizeSimulationPeriod(draft, mindName) {
  const next = {...draft, benchmarkPresetId:'custom'};
  if (next.name === next.generatedName) {
    next.generatedName = simulationGeneratedName(next.mode, mindName);
    next.name = next.generatedName;
  }
  return next;
}

export function simulationReadyStart(preflight, mode, startAt, endAt) {
  if (mode !== 'MECHANICAL') return null;
  const r = preflight?.coverage?.modelReadiness, at = r?.firstReadyAt;
  if (!r || !(r.readyDecisions > 0 && r.readyDecisions < r.totalDecisions) || !at) return null;
  const first = Date.parse(at), start = Date.parse(startAt), end = Date.parse(endAt);
  return Number.isFinite(first) && first > start && first < end ? at : null;
}

export function simulationCostSummary(draft, market) {
  const basisPoints = new Intl.NumberFormat('ko-KR', {maximumFractionDigits: 2});
  return `${market.amount(Number(draft.initialCash))} ${market.currency} · 수수료 ${basisPoints.format(Number(draft.feeBps))}bp · 슬리피지 ${basisPoints.format(Number(draft.slippageBps))}bp`;
}
