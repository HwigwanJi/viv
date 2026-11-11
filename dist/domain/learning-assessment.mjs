import { assertMindDocument, mindDocumentHash, MindDocumentError } from './mind-manifest.mjs';
import { hashInputPackage } from './workspace.mjs';
import {assessAutomaticPrincipleEvidence} from './learning-cohort-assessment.mjs';

export const LEARNING_METHOD_VERSION = 'bounded-shrinkage-v1';
const clone = value => structuredClone(value), clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const iso = v => typeof v === 'string' && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;
const finite = v => typeof v === 'number' && Number.isFinite(v);
const check = (condition, code, message) => { if (!condition) throw new MindDocumentError(code, message); };
const average = values => values.length ? values.reduce((n, v) => n + v, 0) / values.length : 0;

/** Count connected observation windows once. Explicit dependence groups merge
 * across disjoint windows; overlapping windows merge across instruments too. */
function independentClusters(records) {
  const parents = records.map((_, i) => i), find = i => parents[i] === i ? i : (parents[i] = find(parents[i]));
  const join = (a, b) => { const x = find(a), y = find(b); if (x !== y) parents[y] = x; };
  const byGroup = new Map();
  records.forEach((r, i) => { const key = r.data.independenceGroup; if (byGroup.has(key)) join(i, byGroup.get(key)); else byGroup.set(key, i); });
  const ordered = records.map((r, i) => ({ i, start: Date.parse(r.data.period.start), end: Date.parse(r.data.period.end) })).sort((a, b) => a.start - b.start || a.end - b.end);
  let leading = null;
  for (const item of ordered) {
    if (leading && item.start < leading.end) { join(item.i, leading.i); if (item.end > leading.end) leading = { ...item, end: item.end }; }
    else leading = item;
  }
  const groups = new Map(); records.forEach((r, i) => { const root = find(i); if (!groups.has(root)) groups.set(root, []); groups.get(root).push(r); });
  return [...groups.values()];
}

export function assessPrincipleEvidence(manifest, principleId, evidence, options = {}) {
  if(options.cohortKey||Array.isArray(evidence)&&evidence.some(d=>d?.schemaVersion===2))return assessAutomaticPrincipleEvidence(manifest,principleId,evidence,options);
  assertMindDocument(manifest); check(manifest.kind === 'mind-policy', 'LEARNING_POLICY_REQUIRED', '마인드 정책을 선택하세요.');
  const principle = manifest.data.principles.find(p => p.id === principleId), now = options.now ?? new Date().toISOString();
  check(principle && iso(now) && Array.isArray(evidence) && evidence.length <= 2000, 'LEARNING_SCOPE', '원칙·평가 시각·연결 근거를 확인하세요.');
  const policy = manifest.data.weightPolicy, priorStrength = options.priorStrength ?? 8, maxStep = Math.min(options.maxStep ?? policy.maxStep, policy.maxStep), minimum = Math.max(options.minIndependentSamples ?? policy.minIndependentSamples, policy.minIndependentSamples);
  check(finite(priorStrength) && priorStrength >= 3 && priorStrength <= 1000 && finite(maxStep) && maxStep >= 0 && maxStep <= .1 && Number.isSafeInteger(minimum) && minimum >= 3 && minimum <= 2000, 'LEARNING_POLICY', '수축 강도·최대 변경 폭·최소 독립 표본을 확인하세요.');
  const seenIds = new Set(), seenDecisions = new Set(), seenHashes = new Set(), included = [], excluded = [];
  for (const doc of [...evidence].sort((a, b) => String(a?.id).localeCompare(String(b?.id)))) {
    assertMindDocument(doc);
    check(doc.kind === 'principle-evidence' && doc.scope.profileId === manifest.scope.profileId && doc.data.principleId === principle.id && doc.data.principleVersion === principle.version && doc.principleRefs.includes(principle.id), 'LEARNING_EVIDENCE_SCOPE', '같은 프로필과 원칙 버전의 근거를 연결하세요.');
    check(doc.scope.instrumentIds.length > 0 && doc.scope.instrumentIds.every(id => manifest.data.universe.instrumentIds.includes(id)), 'LEARNING_INSTRUMENT_SCOPE', '마인드 정책의 종목 범위 안에서 성과를 평가하세요.');
    let reason = null;
    if (seenIds.has(doc.id) || seenDecisions.has(doc.data.decisionId) || seenHashes.has(doc.data.sourceRecordHash)) reason = 'duplicate-source';
    else if (doc.availableAt > now || doc.asOf > now || doc.data.period.end > now) reason = 'not-available';
    else if (!doc.provenance.contentHashes.includes(doc.data.sourceRecordHash) || !doc.provenance.recordRefs.includes(doc.data.decisionId)) reason = 'provenance-incomplete';
    else if (!['FORWARD_PAPER', 'POINT_IN_TIME_BACKTEST'].includes(doc.data.experimentType)) reason = 'retrospective-policy';
    else if (doc.data.direction === 'unresolved') reason = 'unresolved-attribution';
    seenIds.add(doc.id); seenDecisions.add(doc.data.decisionId); seenHashes.add(doc.data.sourceRecordHash);
    if (reason) excluded.push({ evidenceId: doc.id, reason }); else included.push(doc);
  }
  const clusters = independentClusters(included), samples = clusters.map((group, i) => {
    const netReturn = average(group.map(r => r.data.metrics.netReturn)), benchmarkReturn = average(group.map(r => r.data.metrics.benchmarkReturn)), maxDrawdown = Math.max(...group.map(r => r.data.metrics.maxDrawdown));
    // netReturn already includes fees and slippage. Costs remain an explicit
    // diagnostic and are not subtracted a second time.
    const excessReturn = netReturn - benchmarkReturn, riskAdjustedExcess = clamp(excessReturn, -.5, .5) - .5 * maxDrawdown;
    return { id: `sample-${i + 1}`, evidenceIds: group.map(r => r.id).sort(), start: group.map(r => r.data.period.start).sort()[0], end: group.map(r => r.data.period.end).sort().at(-1), regimes: [...new Set(group.map(r => r.data.regime))].sort(), netReturn, benchmarkReturn, excessReturn, feesReturn: average(group.map(r => r.data.metrics.feesReturn)), slippageReturn: average(group.map(r => r.data.metrics.slippageReturn)), maxDrawdown, riskAdjustedExcess, score: Math.tanh(riskAdjustedExcess / .03), controlled: group.every(r => r.data.attribution === 'controlled-ablation') };
  });
  const independentSampleCount = samples.length, horizons = [...new Set(included.map(r => Date.parse(r.data.period.end) - Date.parse(r.data.period.start)))], enough = independentSampleCount >= minimum && horizons.length === 1;
  // Aggregate payoff magnitude before the bounded transform: many small wins
  // must not outweigh a single large loss merely by vote count.
  const meanRiskAdjustedExcess = average(samples.map(s => s.riskAdjustedExcess)), shrunkScore = Math.tanh(meanRiskAdjustedExcess / .03) * independentSampleCount / (priorStrength + independentSampleCount);
  const rawDelta = maxStep * shrunkScore, status = principle.kind === 'core' ? 'CORE_FIXED' : enough ? 'REVIEW_REQUIRED' : 'INSUFFICIENT_EVIDENCE';
  const proposedWeight = status === 'REVIEW_REQUIRED' ? clamp(principle.weight + rawDelta, principle.bounds.min, principle.bounds.max) : principle.weight;
  const regimes = [...new Set(samples.flatMap(s => s.regimes))].sort();
  return {
    methodVersion: LEARNING_METHOD_VERSION, evaluatedAt: now, status, principleId, principleVersion: principle.version, previousWeight: principle.weight, proposedWeight, delta: proposedWeight - principle.weight,
    evidenceCount: evidence.length, includedEvidenceCount: included.length, independentSampleCount, minimumIndependentSamples: minimum, priorStrength, maxStep, shrunkScore,
    summary: { meanNetReturn: samples.length ? average(samples.map(s => s.netReturn)) : null, meanBenchmarkReturn: samples.length ? average(samples.map(s => s.benchmarkReturn)) : null, meanExcessReturn: samples.length ? average(samples.map(s => s.excessReturn)) : null, meanRiskAdjustedExcess: samples.length ? meanRiskAdjustedExcess : null, maxDrawdown: samples.length ? Math.max(...samples.map(s => s.maxDrawdown)) : null, meanFeesReturn: samples.length ? average(samples.map(s => s.feesReturn)) : null, meanSlippageReturn: samples.length ? average(samples.map(s => s.slippageReturn)) : null, observationHorizonsMs: horizons.sort((a, b) => a - b), comparableHorizon: horizons.length === 1, regimeCount: regimes.length, regimes, controlledSamples: samples.filter(s => s.controlled).length },
    samples, includedEvidenceIds: included.map(r => r.id).sort(), excluded,
    limitations: [
      '같은 원칙 버전·프로필·허용 종목의 사용 가능 기록을 평가한다. 중복 원본과 겹친 관측 기간은 보수적으로 묶는다.',
      '수익률은 동일 관측 기간과 초기 자금의 대조 기준을 사용한다. 순수익률에 포함된 비용은 다시 차감하지 않는다.',
      '국면별 표본 수와 반례를 함께 검토한다. 관측 연구의 성과에는 종목 선택·다른 원칙·시장 노출 효과가 함께 들어간다.',
      '승인한 새 정책 버전을 미래 실행에 명시 적용한다. 원칙의 핵심 문구와 손실·주문 한도는 성과 가중치 제안으로 변경하지 않는다.',
    ],
  };
}

export function proposePrincipleWeight(manifest, principleId, evidence, options = {}) {
  const assessment = assessPrincipleEvidence(manifest, principleId, evidence, options), now = assessment.evaluatedAt;
  const sourceIds=assessment.sourceEvidenceIds??assessment.includedEvidenceIds;
  const proposal = { schemaVersion: 1, id: options.id ?? `weight-${crypto.randomUUID()}`, kind: 'weight-proposal', title: `${manifest.data.principles.find(p => p.id === principleId).title} 가중치 검토`, source: { type: 'system-export', id: LEARNING_METHOD_VERSION, uri: null }, asOf: now, availableAt: now, scope: clone(manifest.scope), principleRefs: [principleId], provenance: { createdAt: now, authorId: options.actorId ?? 'workspace-owner', recordRefs: assessment.includedEvidenceIds, contentHashes: evidence.filter(e => assessment.includedEvidenceIds.includes(e.id)).map(mindDocumentHash), classification: null }, data: { principleId, principleVersion: assessment.principleVersion, previousWeight: assessment.previousWeight, proposedWeight: assessment.proposedWeight, methodVersion: LEARNING_METHOD_VERSION, status: assessment.status, evidenceIds: assessment.includedEvidenceIds, assessment, baseManifestHash: mindDocumentHash(manifest), nextVersion: assessment.principleVersion + 1 } };
  if(assessment.sourceEvidenceIds){proposal.provenance.recordRefs=sourceIds;proposal.provenance.contentHashes=evidence.filter(e=>sourceIds.includes(e.id)).map(mindDocumentHash);proposal.data.evidenceIds=sourceIds;}
  assertMindDocument(proposal); return proposal;
}

export function assertWeightProposalEvidence(manifest, proposal, evidence) {
  assertMindDocument(manifest); assertMindDocument(proposal);
  check(proposal.kind === 'weight-proposal' && proposal.data.baseManifestHash === mindDocumentHash(manifest), 'LEARNING_STALE_PROPOSAL', '가중치 제안과 기준 정책 해시를 대조하세요.');
  const saved = proposal.data.assessment, actual = assessPrincipleEvidence(manifest, proposal.data.principleId, evidence, { now: saved.evaluatedAt, priorStrength: saved.priorStrength, maxStep: saved.maxStep, minIndependentSamples: saved.minimumIndependentSamples,...(saved.comparison?.mode==='AUTO_COHORT_WINDOW_V2'?{cohortKey:saved.comparison.cohortKey}:{}) });
  check(hashInputPackage(actual) === hashInputPackage(saved) && actual.status === proposal.data.status && actual.previousWeight === proposal.data.previousWeight && actual.proposedWeight === proposal.data.proposedWeight && hashInputPackage(actual.sourceEvidenceIds??actual.includedEvidenceIds) === hashInputPackage(proposal.data.evidenceIds), 'LEARNING_EVIDENCE_CHANGED', '원본 근거에서 다시 계산한 가중치 제안과 저장된 평가를 대조하세요.');
  return actual;
}

/** Pure explicit-review transition. Persist the receipt and new manifest under
 * the owner's revision transaction; existing deployments keep their old pins. */
export function approveWeightProposal(manifest, proposal, { actorId, reason, now, availableAt, evidence } = {}) {
  assertMindDocument(manifest); assertMindDocument(proposal);
  check(manifest.kind === 'mind-policy' && proposal.kind === 'weight-proposal' && proposal.scope.profileId === manifest.scope.profileId && proposal.data.baseManifestHash === mindDocumentHash(manifest), 'LEARNING_STALE_PROPOSAL', '제안이 기준으로 삼은 정책 버전을 다시 확인하세요.');
  check(Array.isArray(evidence), 'LEARNING_EVIDENCE_REQUIRED', '승인할 제안의 원본 근거 양식을 함께 조회하세요.'); assertWeightProposalEvidence(manifest, proposal, evidence);
  check(proposal.data.assessment.summary.controlledSamples >= proposal.data.assessment.minimumIndependentSamples, 'LEARNING_CONTROLLED_EVIDENCE_REQUIRED', '같은 관측 기간의 독립 통제 실험을 최소 표본 수만큼 검토한 뒤 원칙 기여 가중치를 승인하세요.');
  const principle = manifest.data.principles.find(p => p.id === proposal.data.principleId), data = proposal.data;
  check(principle?.kind === 'evidence' && principle.version === data.principleVersion && principle.weight === data.previousWeight && data.status === 'REVIEW_REQUIRED', 'LEARNING_REVIEW_REQUIRED', '검토 가능한 성과 원칙 가중치 제안을 선택하세요.');
  check(typeof actorId === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_.:@/-]{0,199}$/.test(actorId) && typeof reason === 'string' && reason.trim().length >= 10 && reason.length <= 2000 && iso(now) && iso(availableAt) && now >= proposal.availableAt && availableAt > now, 'LEARNING_APPROVAL', '검토자·검토 사유·승인 시각과 미래 사용 가능 시각을 작성하세요.');
  check(data.proposedWeight >= principle.bounds.min && data.proposedWeight <= principle.bounds.max && Math.abs(data.proposedWeight - principle.weight) <= manifest.data.weightPolicy.maxStep + 1e-9, 'LEARNING_WEIGHT_LIMIT', '정책이 정한 원칙 가중치 범위와 변경 폭을 확인하세요.');
  const next = clone(manifest); next.id = `mind-${manifest.scope.profileId}-v${manifest.data.version + 1}-${crypto.randomUUID()}`; next.data.version++; next.asOf = now; next.availableAt = availableAt;
  next.source = { type: 'user', id: actorId, uri: null }; next.provenance = { createdAt: now, authorId: actorId, recordRefs: [manifest.id, proposal.id], contentHashes: [mindDocumentHash(manifest), mindDocumentHash(proposal)], classification: null };
  const updated = next.data.principles.find(p => p.id === principle.id); updated.weight = data.proposedWeight; updated.version = data.nextVersion;
  assertMindDocument(next);
  return { manifest: next, receipt: { proposalId: proposal.id, previousManifestId: manifest.id, manifestId: next.id, previousManifestHash: mindDocumentHash(manifest), manifestHash: mindDocumentHash(next), principleId: principle.id, previousWeight: principle.weight, approvedWeight: updated.weight, approvedBy: actorId, approvedAt: now, availableAt, reason: reason.trim(), status: 'APPROVED_VERSION' } };
}
