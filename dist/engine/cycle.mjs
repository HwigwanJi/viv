import { defaultStrategy, generateSignals, validateStrategy } from './strategies.mjs';
import { defaultRisk, validateContext } from './risk.mjs';
import { markTradingDay, portfolioMetrics } from './portfolio.mjs';
import { allocateSignals } from './allocation.mjs';

export function evaluateCycle({ market, portfolio, strategy = defaultStrategy, risk = defaultRisk, knowledge = [], now = new Date().toISOString() } = {}) {
  const reasons = [...validateContext({ market, portfolio, risk, now }), ...validateStrategy(strategy)];
  const base = { mode: 'paper', synthetic: true, marketAsOf: market?.asOf || null, strategyId: strategy?.id || null };
  if (reasons.length) return { ...base, ok: false, signals: [], proposals: [], decisions: [], reasons, summary: null };
  const normalizedPortfolio = markTradingDay(portfolio, market, now);
  const signals = generateSignals({ market, strategy, knowledge, portfolio: normalizedPortfolio, now });
  // Safety exits also cover holdings removed from the active strategy's scope.
  for (const position of Object.values(normalizedPortfolio.positions).filter(item => item.quantity > 0)) {
    const asset = market.assets.find(item => item.symbol === position.symbol);
    const lossRatio = 1 - asset.price / position.averageCost;
    if (lossRatio >= risk.maxPositionLossRatio) {
      const protective = { symbol: position.symbol, strategyId: 'risk-protection', action: 'sell', strength: 1, code: 'POSITION_STOP_EXIT', reason: `원가 대비 ${(lossRatio * 100).toFixed(2)}% 손실로 보호 매도 후보를 생성합니다. 체결·손실 한도를 보장하지 않습니다.`, indicators: { lossRatio }, protectiveExit: true, verified: false, knowledgeRefs: [] };
      const index = signals.findIndex(item => item.symbol === position.symbol);
      if (index < 0) signals.push(protective); else signals[index] = protective;
    }
  }
  const { proposals, decisions } = allocateSignals({ market, portfolio: normalizedPortfolio, strategy, risk, signals, now });
  const metrics = portfolioMetrics(normalizedPortfolio, market);
  return {
    ...base, ok: true, market, portfolio: normalizedPortfolio, signals, proposals, decisions, reasons: [],
    summary: { ...metrics, signalCount: signals.length, proposalCount: proposals.length, blockedCount: decisions.filter(item => !item.allowed && item.action !== 'hold').length, feesBps: risk.feeBps, slippageBps: risk.slippageBps, dailyLossLimit: risk.maxDailyLossRatio, notice: '합성 데이터 모의 판단이며, 실제 주문·수익 예측을 제공하지 않습니다.' },
  };
}
