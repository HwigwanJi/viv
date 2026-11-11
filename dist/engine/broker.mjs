import { clone, reason, timestamp, validatePortfolio } from './validation.mjs';
import { assessOrder, defaultRisk } from './risk.mjs';
import { markTradingDay, portfolioMetrics } from './portfolio.mjs';
import { createJournalEntry } from './journal.mjs';
import { assessClutchFill } from './clutch-policy.mjs';

function fingerprint(proposal) {
  return JSON.stringify({ symbol: proposal?.symbol, side: proposal?.side, quantity: proposal?.quantity, marketAsOf: proposal?.marketAsOf, decisionAt: proposal?.decisionAt || proposal?.marketAsOf, strategyId: proposal?.strategyId || 'manual-paper' });
}

export function executePaperOrder({ portfolio, proposal, market, risk = defaultRisk, now = new Date().toISOString(), clientOrderId, mode = 'paper', knowledgeRefs = [] } = {}) {
  const invalidPortfolio = validatePortfolio(portfolio);
  if (invalidPortfolio.length) return { ok: false, portfolio, reasons: invalidPortfolio };
  if (mode !== 'paper' || proposal?.mode && proposal.mode !== 'paper' || risk?.mode !== 'paper') return { ok: false, portfolio, reasons: [reason('LIVE_MODE_FORBIDDEN', '모의 브로커는 실제 거래 요청을 거부합니다.')] };
  if (typeof clientOrderId !== 'string' || !clientOrderId.trim() || clientOrderId.length > 160) return { ok: false, portfolio, reasons: [reason('MISSING_CLIENT_ORDER_ID', '중복 체결을 막을 고유 주문 ID가 필요합니다.')] };
  const requestFingerprint = fingerprint(proposal);
  const previous = portfolio.orders.find(order => order.clientOrderId === clientOrderId);
  if (previous) {
    if (previous.fingerprint !== requestFingerprint) return { ok: false, portfolio, reasons: [reason('IDEMPOTENCY_CONFLICT', '같은 주문 ID를 다른 주문 내용에 사용할 수 없습니다.')] };
    return { ok: true, portfolio, execution: clone(previous.execution), idempotent: true, reasons: [reason('ALREADY_EXECUTED', '이미 체결된 동일 주문입니다. 추가 체결하지 않았습니다.')] };
  }
  const assessment = assessOrder({ market, portfolio, proposal, risk, now });
  if (!assessment.allowed) return { ok: false, portfolio, reasons: assessment.reasons };
  const policy = assessClutchFill({ asset: market.assets.find(asset => asset.symbol === proposal.symbol), portfolio, proposal });
  if (!policy.allowed) return { ok: false, portfolio, reasons: [reason(policy.code, policy.message)] };
  const next = markTradingDay(portfolio, market, now);
  const current = next.positions[proposal.symbol] || { symbol: proposal.symbol, quantity: 0, averageCost: 0, realizedPnl: 0 };
  const quote = assessment.quote;
  let realizedPnl = 0;
  if (proposal.side === 'buy') {
    const quantity = current.quantity + proposal.quantity;
    next.positions[proposal.symbol] = { ...current, quantity, averageCost: (current.quantity * current.averageCost + quote.totalCost) / quantity };
  } else {
    let quantity = current.quantity - proposal.quantity;
    if (Math.abs(quantity) < 1e-12) quantity = 0;
    realizedPnl = quote.netProceeds - current.averageCost * proposal.quantity;
    next.positions[proposal.symbol] = { ...current, quantity, averageCost: quantity ? current.averageCost : 0, realizedPnl: current.realizedPnl + realizedPnl };
  }
  next.cash += quote.cashFlow;
  next.realizedPnl += realizedPnl;
  next.day.realizedPnl += realizedPnl;
  next.feesPaid += quote.fee;
  next.slippagePaid += quote.slippageCost;
  const execution = {
    id: `paper:${clientOrderId}`, clientOrderId, at: new Date(timestamp(now)).toISOString(), decisionAt: proposal.decisionAt || proposal.marketAsOf,
    mode: 'paper', synthetic: true, symbol: proposal.symbol, side: proposal.side, quantity: proposal.quantity,
    strategyId: proposal.strategyId || 'manual-paper', rationale: typeof proposal.signalReason === 'string' ? proposal.signalReason : '사용자 모의 주문',
    ...quote, realizedPnl,
  };
  const metrics = portfolioMetrics(next, market);
  if (next.cash < 0 || Object.values(next.positions).some(item => item.quantity < 0) || !Number.isFinite(metrics.equity)) return { ok: false, portfolio, reasons: [reason('ACCOUNTING_INVARIANT_FAILED', '회계 검증에 실패하여 주문을 반영하지 않았습니다.')] };
  execution.equityAfter = metrics.equity;
  next.valuation = { at: execution.at, equity: metrics.equity };
  next.ledger.push(createJournalEntry({ execution, portfolio: next, market, knowledgeRefs }));
  next.orders.push({ clientOrderId, fingerprint: requestFingerprint, execution });
  return { ok: true, portfolio: next, execution, metrics, idempotent: false, reasons: assessment.reasons };
}
