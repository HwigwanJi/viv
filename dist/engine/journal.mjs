export function createJournalEntry({ execution, portfolio, market, knowledgeRefs = [] }) {
  return {
    id: `journal:${execution.clientOrderId}`, at: execution.at, decisionAt: execution.decisionAt,
    type: 'paper-fill', mode: 'paper', symbol: execution.symbol, side: execution.side,
    quantity: execution.quantity, referencePrice: execution.referencePrice,
    fillPrice: execution.fillPrice, fee: execution.fee, slippageCost: execution.slippageCost,
    cashFlow: execution.cashFlow, realizedPnl: execution.realizedPnl,
    cashAfter: portfolio.cash, marketAsOf: market.asOf, synthetic: market.synthetic,
    strategyId: execution.strategyId, rationale: execution.rationale,
    knowledgeRefs: knowledgeRefs.filter(id => typeof id === 'string'),
    review: { status: 'unreviewed', observation: '', lesson: '', proposedRule: '' },
  };
}
