export { getDemoMarket, getFixtureHistory, FIXTURE_NOTICE } from './fixtures.mjs';
export { defaultStrategy, STRATEGY_NOTICE, listStrategies, registerStrategy, validateStrategy, generateSignals } from './strategies.mjs';
export { defaultRisk, HARD_LIMITS, validateRisk, assessOrder, quoteOrder } from './risk.mjs';
export { createPortfolio, portfolioMetrics } from './portfolio.mjs';
export { evaluateCycle } from './cycle.mjs';
export { executePaperOrder } from './broker.mjs';
export { runBacktest } from './backtest.mjs';
export { compareStrategies, summarizeExperiment } from './comparison.mjs';
export { assessOpportunity, OPPORTUNITY_REGIMES } from './opportunity.mjs';
export { CLUTCH_DEFAULTS, CLUTCH_NOTICE, CLUTCH_PARAMETER_SCHEMA, validateClutchParameters, evaluateClutchPolicy, observeOpenPosition, assessClutchFill } from './clutch-policy.mjs';
export { validateMarket, validatePortfolio } from './validation.mjs';

export const listModules = () => [
  { id: 'market', name: '시장 어댑터', file: 'fixtures.mjs', status: 'synthetic', description: '합성 가격과 관측 이력. 실제 시세 연결 전 단계' },
  { id: 'signal', name: '판단 전략', file: 'strategies.mjs', status: 'sample', description: '평균 회귀·추세·기회 집중 샘플, 거래소 차이 연구 전용 모듈' },
  { id: 'opportunity', name: '국면과 기회', file: 'opportunity.mjs', status: 'sample', description: '관측 종가로 추세·돌파·기회 점수 계산. VIX·거래량 입력 없음' },
  { id: 'clutch-policy', name: '기회 집중 정책', file: 'clutch-policy.mjs', status: 'sample', description: '기회 강도에 따른 목표 비중 · 수익 중 증액 · 이익 추적청산' },
  { id: 'allocation', name: '자금 배분', file: 'allocation.mjs', status: 'active', description: '목표 비중·잔여 현금·주문 단위 계산' },
  { id: 'risk', name: '안전 필터', file: 'risk.mjs', status: 'enforced', description: '주문·보유·일일 손실 한도를 체결 때 재검사' },
  { id: 'execution', name: '모의 체결', file: 'broker.mjs', status: 'paper-only', description: '수수료·슬리피지·원가·중복 주문 ID 처리' },
  { id: 'journal', name: '판단·복기 원장', file: 'journal.mjs', status: 'active', description: '체결 근거·지식 참조·복기 후보 기록' },
  { id: 'backtest', name: '순차 실험', file: 'backtest.mjs', status: 'synthetic', description: '미래 이력 차단, 관측 시각 순서 고정' },
];
