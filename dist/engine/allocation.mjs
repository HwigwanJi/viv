import { floorQuantity } from './validation.mjs';
import { portfolioMetrics } from './portfolio.mjs';
import { assessOrder, quoteOrder } from './risk.mjs';

export function allocateSignals({ market, portfolio, strategy, risk, signals, now }) {
  const metrics = portfolioMetrics(portfolio, market);
  let reservedCash = 0;
  const proposals = [], decisions = [];
  const costMultiplier = (1 + risk.slippageBps / 10000) * (1 + risk.feeBps / 10000);
  const priority = signal => signal.protectiveExit === true ? 0 : signal.action === 'sell' ? 1 : 2;
  const ordered = [...signals].sort((a, b) => priority(a) - priority(b) || (b.opportunityScore ?? b.strength ?? 0) - (a.opportunityScore ?? a.strength ?? 0) || a.symbol.localeCompare(b.symbol, 'en'));
  for (const signal of ordered) {
    const asset = market.assets.find(item => item.symbol === signal.symbol);
    if (signal.action === 'hold') { decisions.push({ symbol: signal.symbol, action: 'hold', allowed: false, reasons: [{ code: signal.code, message: signal.reason }] }); continue; }
    const quantityHeld = portfolio.positions[asset.symbol]?.quantity || 0;
    const currentValue = quantityHeld * asset.price;
    const maxOrderValue = metrics.equity * risk.maxOrderWeight / (signal.action === 'buy' ? costMultiplier : 1);
    const effectiveTargetWeight = Math.min(strategy.targetWeight * (signal.targetWeightFactor ?? 1), strategy.targetWeight, risk.maxPositionWeight);
    let quantity;
    if (signal.action === 'buy') {
      const target = metrics.equity * effectiveTargetWeight;
      const remainingPosition = Math.max(0, target - currentValue);
      // Keep a tiny reserve because costs reduce the equity denominator used by the broker.
      const positionLimit = Math.max(0, (risk.maxPositionWeight * metrics.equity - currentValue) / (1 + risk.maxPositionWeight * (costMultiplier - 1)));
      const affordable = Math.max(0, (portfolio.cash - reservedCash) / costMultiplier);
      quantity = floorQuantity(Math.min(remainingPosition, maxOrderValue, affordable, positionLimit) / asset.price, asset.quantityStep);
    } else quantity = floorQuantity(Math.min(quantityHeld, maxOrderValue / asset.price), asset.quantityStep);
    if (quantity <= 0 || quantity < asset.minOrderQty || quantity * asset.price < asset.minNotional) {
      decisions.push({ symbol: signal.symbol, action: signal.action, allowed: false, reasons: [{ code: signal.action === 'sell' ? 'NO_SELLABLE_POSITION' : 'NO_ALLOCATABLE_BUDGET', message: signal.action === 'sell' ? '매도할 보유 수량이 없습니다.' : '목표 비중·현금·최소 주문 단위를 만족하는 예산이 없습니다.' }] });
      continue;
    }
    const proposal = { id: `${signal.strategyId}:${asset.symbol}:${signal.action}:${market.asOf}`, symbol: asset.symbol, side: signal.action, quantity, strategyId: signal.strategyId, marketAsOf: market.asOf, targetWeight: effectiveTargetWeight, estimatedPrice: asset.price, signalReason: signal.reason, protectiveExit: signal.protectiveExit === true, mode: 'paper' };
    if (signal.strategyId === 'clutch' && signal.action === 'buy') proposal.minimumAddProfitRatio = signal.minimumAddProfitRatio;
    const assessment = assessOrder({ market, portfolio, proposal, risk, now });
    const quote = quoteOrder({ proposal, market, risk });
    Object.assign(proposal, { estimatedGross: quote.gross, estimatedFee: quote.fee, estimatedSlippage: quote.slippageCost, estimatedTotal: proposal.side === 'buy' ? quote.totalCost : quote.netProceeds });
    decisions.push({ symbol: signal.symbol, action: signal.action, proposalId: proposal.id, allowed: assessment.allowed, reasons: assessment.reasons });
    if (assessment.allowed) {
      proposals.push(proposal);
      if (proposal.side === 'buy') reservedCash += quote.totalCost;
    }
  }
  return { proposals, decisions };
}
