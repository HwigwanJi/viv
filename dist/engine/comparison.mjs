import { runBacktest } from './backtest.mjs';
import { defaultStrategy } from './strategies.mjs';
import { CLUTCH_DEFAULTS } from './clutch-policy.mjs';

export function summarizeExperiment(result) {
  if (!result?.ok) return null;
  const exits = result.executions.filter(item => item.side === 'sell');
  const gains = exits.filter(item => item.realizedPnl > 0).map(item => item.realizedPnl);
  const losses = exits.filter(item => item.realizedPnl < 0).map(item => -item.realizedPnl);
  const grossProfit = gains.reduce((sum, value) => sum + value, 0);
  const grossLoss = losses.reduce((sum, value) => sum + value, 0);
  const averageProfit = gains.length ? grossProfit / gains.length : null;
  const averageLoss = losses.length ? grossLoss / losses.length : null;
  return {
    realizedExitCount: exits.length,
    profitableExitCount: gains.length,
    losingExitCount: losses.length,
    averageProfit,
    averageLoss,
    payoffRatio: averageProfit !== null && averageLoss !== null ? averageProfit / averageLoss : null,
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : null,
    topThreeProfitShare: grossProfit > 0 ? [...gains].sort((a, b) => b - a).slice(0, 3).reduce((sum, value) => sum + value, 0) / grossProfit : null,
    totalCosts: result.feesPaid + result.slippagePaid,
  };
}

// Kept outside runBacktest so persisted experiment results retain their existing schema.
export function compareStrategies({ baseline = defaultStrategy, candidate, ...input } = {}) {
  const opportunityStrategy = candidate || { ...defaultStrategy, id: 'clutch', parameters: { ...CLUTCH_DEFAULTS } };
  const definitions = [
    { label: '기준 전략', strategy: baseline },
    { label: '기회 집중', strategy: opportunityStrategy },
  ];
  const results = definitions.map(({ label, strategy }) => {
    const result = runBacktest({ ...input, strategy });
    return { label, strategyId: strategy.id, result, metrics: summarizeExperiment(result) };
  });
  return {
    ok: results.every(item => item.result.ok),
    mode: 'paper', synthetic: true,
    notice: '같은 합성 관측·초기 자금·비용·위험 한도로 비교한 연구 결과입니다. 전략 우열이나 미래 수익을 입증하지 않습니다.',
    metricDefinition: '이익·손실 평균과 이익 기여는 실현손익이 발생한 매도 체결 단위입니다. 부분 매도도 한 건이며 미청산 손익을 포함하지 않습니다. 상위 3개 이익 기여는 전체 양의 실현손익 중 비율입니다. 분모가 없는 비율은 null입니다.',
    results,
  };
}
