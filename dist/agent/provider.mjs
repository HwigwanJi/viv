import { AGENT_SCHEMA_VERSION, AGENT_LIMITS, AgentContractError, assertResearchContext, buildResearchContext, buildPrompt, validateResearchReview } from './contract.mjs';

export const LOCAL_RESEARCH_NOTICE = '외부 LLM 미연결 · 로컬 규칙으로 자료 공백과 검토 작업을 정리합니다. 투자 판단과 주문을 생성하지 않습니다.';

/** Deterministic bookkeeping only. No language model, credentials, network, or broker dependency. */
export class LocalResearchProvider {
  constructor() {
    this.id = 'local-research';
    this.method = 'local-rules';
    this.externalModelConnected = false;
    Object.freeze(this);
  }

  async review(context) {
    assertResearchContext(context);
    const researchTasks = context.knowledge.gaps.map(gap => ({
      id: `source-gap-${gap.id}`, kind: 'source-gap', title: `자료 확보: ${gap.title}`.slice(0, 160),
      reason: '미확보 자료의 원문과 적용 범위를 확인한 뒤 새 지식 항목으로 검토하세요. 자료 공백 자체는 전략 근거가 아닙니다.',
      evidenceRefs: [], gapRefs: [gap.id], requiresHumanReview: true,
    }));
    if (!context.knowledge.evidence.length) researchTasks.push({
      id: 'source-gap-approved-evidence', kind: 'source-gap', title: '승인된 근거를 확보하세요',
      reason: '현재 전달된 승인 근거가 없습니다. 원문·해석·적용 범위를 검토한 기록이 필요합니다.',
      evidenceRefs: [], gapRefs: [], requiresHumanReview: true,
    });
    for (const item of context.knowledge.evidence.filter(item => ['hypothesis', 'rule'].includes(item.kind))) {
      if (researchTasks.length >= AGENT_LIMITS.tasks) break;
      researchTasks.push({
        id: `invalidation-${item.id}`, kind: 'invalidation-review', title: `반증 조건 검토: ${item.title}`.slice(0, 160),
        reason: '이 근거가 더 이상 적용되지 않는 시장 조건과 관찰 신호를 사람이 검토하세요. 로컬 승인은 수익성 검증이나 실행 권한을 뜻하지 않습니다.',
        evidenceRefs: [{ id: item.id, version: item.version }], gapRefs: [], requiresHumanReview: true,
      });
    }
    if ((context.knowledge.omittedEvidence || context.knowledge.omittedGaps) && researchTasks.length < AGENT_LIMITS.tasks) researchTasks.push({
      id: 'source-gap-context-coverage', kind: 'source-gap', title: '컨텍스트에서 제외된 자료를 검토하세요',
      reason: '입력 크기 제한으로 일부 항목이 제외되었습니다. 이번 검토를 전체 지식 검토 완료로 취급할 수 없습니다.',
      evidenceRefs: [], gapRefs: [], requiresHumanReview: true,
    });
    return validateResearchReview({
      schemaVersion: AGENT_SCHEMA_VERSION, mode: 'proposal-only', providerId: this.id, method: this.method,
      externalModelConnected: false, strategyVersion: context.strategyVersion, configHash: context.configHash,
      marketAsOf: context.market.asOf, researchTasks, notice: LOCAL_RESEARCH_NOTICE,
    }, context);
  }
}

/** Adapter seam: review(context, { messages }) -> contracted JSON. No external adapter is installed. */
export async function runResearchReview(input, { provider = new LocalResearchProvider() } = {}) {
  let context;
  try { context = assertResearchContext(input); } catch (error) {
    if (error.code !== 'UNTRUSTED_CONTEXT') throw error;
    context = buildResearchContext(input);
  }
  if (!provider || typeof provider.review !== 'function' || !['local-rules', 'external-model'].includes(provider.method) || typeof provider.id !== 'string' || !provider.id.trim() || provider.externalModelConnected !== (provider.method === 'external-model')) throw new AgentContractError('INVALID_PROVIDER', '제공자의 종류·연결 상태·review 함수를 명시해야 합니다.');
  const raw = await provider.review(context, { messages: buildPrompt(context) });
  const review = validateResearchReview(raw, context);
  if (review.providerId !== provider.id || review.method !== provider.method || review.externalModelConnected !== provider.externalModelConnected) throw new AgentContractError('INVALID_PROVIDER', '응답의 제공자 정보가 실제 어댑터와 다릅니다.');
  return review;
}
