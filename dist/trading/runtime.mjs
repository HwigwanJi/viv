const BAR_MS = 14400000;
export const DEFAULT_PAPER_POLICY = Object.freeze({ normalBuyWeight: .5, clutchBuyWeight: 1, sellWeight: .25, maxExposure: 1, maxOrderWeight: 1, dailyLossLimit: .05, feeBps: 10, slippageBps: 0, minNotional: 10 });
const clone = value => structuredClone(value);
const finite = n => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) < 1e15;
const iso = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const close = (a, b) => finite(a) && finite(b) && Math.abs(a - b) <= 1e-7 * Math.max(1, Math.abs(a), Math.abs(b));
const reason = (code, message) => ({ code, message });
const key = value => JSON.stringify(value);
const preparedOrders = new WeakMap();
const accountSnapshot = a => key([a.id, a.cash, a.btcQuantity, a.averageCost, a.realizedPnl, a.feesPaid, a.initialEquity, a.asOf, a.tradingDay, a.dayStartEquity, a.orders.length, a.orders.at(-1)?.executionId || null]);
const validBar = b => Array.isArray(b) && b.length === 6 && Number.isSafeInteger(b[0]) && b[0] % BAR_MS === 0 && b.slice(1, 5).every(v => finite(v) && v > 0) && finite(b[5]) && b[5] >= 0 && b[2] >= Math.max(b[1], b[3], b[4]) && b[3] <= Math.min(b[1], b[4]);
const day = at => at.slice(0, 10);
function balanceBeforeDay(a, tradingDay) {
  const at = Date.parse(tradingDay + 'T00:00:00.000Z');
  const previous = a.ledger.filter(e => Date.parse(e.at) < at).at(-1);
  return { cash: previous?.cashAfter ?? a.initialEquity, quantity: previous?.btcAfter ?? 0 };
}
export function validatePaperPolicy(p) {
  return p && Object.keys(p).length === Object.keys(DEFAULT_PAPER_POLICY).length && Object.keys(DEFAULT_PAPER_POLICY).every(k => Object.hasOwn(p, k)) && ['normalBuyWeight', 'clutchBuyWeight', 'sellWeight', 'maxExposure', 'maxOrderWeight'].every(k => finite(p[k]) && p[k] >= 0 && p[k] <= 1) && p.clutchBuyWeight >= p.normalBuyWeight && p.maxExposure > 0 && p.maxOrderWeight > 0 && finite(p.dailyLossLimit) && p.dailyLossLimit > 0 && p.dailyLossLimit <= 1 && ['feeBps', 'slippageBps'].every(k => finite(p[k]) && p[k] >= 0 && p[k] <= 1000) && finite(p.minNotional) && p.minNotional > 0;
}
export function createPaperAccount({ initialCash = 100000, now = '1970-01-01T00:00:00.000Z' } = {}) {
  if (!finite(initialCash) || initialCash <= 0 || !iso(now)) throw new TypeError('모의 자금과 시작 시각을 확인하세요.');
  return { schemaVersion: 2, id: globalThis.crypto.randomUUID(), baseCurrency: 'USDT', cash: initialCash, btcQuantity: 0, averageCost: 0, realizedPnl: 0, feesPaid: 0, initialEquity: initialCash, asOf: now, tradingDay: day(now), dayStartEquity: initialCash, dayStartPrice: null, orders: [], ledger: [] };
}
export function markPaperAccount(account, { price, asOf, dayStartPrice } = {}) {
  if (validatePaperAccount(account).length || !finite(price) || price <= 0 || !iso(asOf) || Date.parse(asOf) < Date.parse(account.asOf)) throw new TypeError('모의 계좌의 평가 시각을 확인하세요.');
  const next = clone(account), tradingDay = day(asOf);
  if (tradingDay !== account.tradingDay) {
    if (!finite(dayStartPrice) || dayStartPrice <= 0) throw new TypeError('UTC 날짜 시작 가격을 확인하세요.');
    const opening = balanceBeforeDay(account, tradingDay);
    next.tradingDay = tradingDay; next.dayStartPrice = dayStartPrice; next.dayStartEquity = opening.cash + opening.quantity * dayStartPrice;
  }
  next.asOf = asOf;
  return next;
}
export function accountMetrics(a, price) {
  if (!finite(price) || price <= 0) throw new TypeError('BTC 가격을 확인하세요.');
  const holdingsValue = a.btcQuantity * price, equity = a.cash + holdingsValue;
  return { equity, cash: a.cash, btcQuantity: a.btcQuantity, holdingsValue, unrealizedPnl: holdingsValue - a.btcQuantity * a.averageCost, realizedPnl: a.realizedPnl, totalReturn: equity / a.initialEquity - 1, weight: equity > 0 ? holdingsValue / equity : 0 };
}
export function validatePaperAccount(a) {
  const bad = message => [reason('INVALID_PAPER_ACCOUNT', message)];
  if (!a || a.schemaVersion !== 2 || a.baseCurrency !== 'USDT' || typeof a.id !== 'string' || !iso(a.asOf) || !/^\d{4}-\d{2}-\d{2}$/.test(a.tradingDay) || !['cash', 'btcQuantity', 'averageCost', 'feesPaid', 'initialEquity', 'dayStartEquity'].every(k => finite(a[k]) && a[k] >= 0) || a.initialEquity <= 0 || a.dayStartEquity <= 0 || !finite(a.realizedPnl) || !Array.isArray(a.orders) || !Array.isArray(a.ledger) || a.orders.length !== a.ledger.length || a.ledger.length > 10000) return bad('모의 계좌 형식을 확인하세요.');
  let cash = a.initialEquity, quantity = 0, cost = 0, fees = 0, pnl = 0, last = -Infinity; const seen = new Set();
  for (let i = 0; i < a.ledger.length; i++) {
    const e = a.ledger[i], o = a.orders[i];
    if (!e || !['buy', 'sell'].includes(e.side) || !iso(e.at) || Date.parse(e.at) < last || !finite(e.quantity) || e.quantity <= 0 || !finite(e.fillPrice) || e.fillPrice <= 0 || !finite(e.fee) || e.fee < 0 || !close(e.gross, e.quantity * e.fillPrice) || seen.has(e.clientOrderId) || o?.clientOrderId !== e.clientOrderId || o.executionId !== e.id) return bad('체결 내역의 순서와 주문 ID를 확인하세요.');
    seen.add(e.clientOrderId); last = Date.parse(e.at); const gross = e.quantity * e.fillPrice; let realized = 0;
    if (e.side === 'buy') { cost = (quantity * cost + gross + e.fee) / (quantity + e.quantity); quantity += e.quantity; cash -= gross + e.fee; }
    else { if (e.quantity > quantity + 1e-10) return bad('매도 수량이 보유 수량을 넘었습니다.'); realized = gross - e.fee - e.quantity * cost; quantity = Math.max(0, quantity - e.quantity); cash += gross - e.fee; if (quantity < 1e-10) { quantity = 0; cost = 0; } }
    fees += e.fee; pnl += realized;
    if (cash < -1e-6 || !close(e.realizedPnl, realized) || !close(e.cashAfter, cash) || !close(e.btcAfter, quantity) || !close(e.averageCostAfter, cost)) return bad('체결 내역과 계좌 잔액을 대조하세요.');
  }
  const opening = balanceBeforeDay(a, a.tradingDay);
  if (opening.quantity > 0 && (!finite(a.dayStartPrice) || a.dayStartPrice <= 0) || !close(a.dayStartEquity, opening.cash + opening.quantity * (a.dayStartPrice || 0))) return bad('일일 손실 기준을 거래 원장과 대조하세요.');
  return close(a.cash, cash) && close(a.btcQuantity, quantity) && close(a.averageCost, cost) && close(a.feesPaid, fees) && close(a.realizedPnl, pnl) && Date.parse(a.asOf) >= last && a.tradingDay === day(a.asOf) ? [] : bad('모의 잔액과 거래 원장을 대조하세요.');
}
export function preparePaperOrder({ account, decision, policy = DEFAULT_PAPER_POLICY, bar, configVersion, configHash, sourceHash } = {}) {
  const reasons = validatePaperAccount(account); const reject = (code, message) => ({ ok: false, proposal: null, reasons: [...reasons, reason(code, message)] });
  if (reasons.length || !validatePaperPolicy(policy) || !validBar(bar) || !Number.isSafeInteger(configVersion) || configVersion < 1) return reject('INVALID_ORDER_INPUT', '계좌·가격·운용 설정을 확인하세요.');
  const asOf = new Date(bar[0] + BAR_MS).toISOString();
  if (account.tradingDay !== day(asOf)) return reject('DAY_MARK_REQUIRED', 'UTC 날짜의 모의 계좌 평가를 먼저 갱신하세요.');
  if (!decision || decision.asOf !== asOf || !['buy', 'hold', 'sell'].includes(decision.action) || !['jev', 'spec'].includes(decision.provider)) return reject('INVALID_DECISION', '완료된 봉의 매매 신호를 확인하세요.');
  if (decision.provider === 'jev' && (decision.strategyVersion !== configVersion || typeof configHash !== 'string' || !configHash || decision.configHash !== configHash || typeof sourceHash !== 'string' || !sourceHash || decision.sourceHash !== sourceHash)) return reject('STALE_DECISION', '자료와 정책 버전을 갱신한 뒤 다시 실행하세요.');
  if (decision.action === 'hold') return { ok: true, proposal: null, reasons: [reason('HOLD', '현재 비중을 유지합니다.')] };
  const m = accountMetrics(account, bar[4]);
  if (decision.provider === 'jev' && (!decision.accountState || !['cash', 'btcQuantity', 'equity', 'weight'].every(k => close(decision.accountState[k], m[k])))) return reject('STALE_ACCOUNT_DECISION', '모의 잔액이 변경되었습니다. 다시 실행하세요.');
  const rawTarget = decision.provider === 'spec' ? decision.targetWeight : decision.action === 'buy' ? decision.stance === 'clutch' ? policy.clutchBuyWeight : policy.normalBuyWeight : policy.sellWeight;
  if (!finite(rawTarget) || rawTarget < 0 || rawTarget > 1) return reject('INVALID_TARGET', '목표 비중을 확인하세요.');
  const targetWeight = Math.min(rawTarget, policy.maxExposure);
  if (decision.action === 'buy' && targetWeight <= m.weight || decision.action === 'sell' && targetWeight >= m.weight) return { ok: true, proposal: null, reasons: [reason('TARGET_REACHED', '현재 보유 비중이 해당 매매 목표를 충족합니다.')] };
  const dayStartEquity = account.tradingDay === day(asOf) ? account.dayStartEquity : m.equity;
  if (decision.action === 'buy' && m.equity <= dayStartEquity * (1 - policy.dailyLossLimit)) return reject('DAILY_LOSS_LIMIT', '일일 손실 한도에 도달해 매수를 중지했습니다.');
  const proposal = { id: `${account.id}:${asOf}:${configVersion}:${decision.action}`, mode: 'paper', side: decision.action, decisionAt: asOf, targetWeight, configVersion, configHash: configHash || null, sourceHash: sourceHash || null, policy: clone(policy), accountSnapshot: accountSnapshot(account), decision: clone(decision), referencePrice: bar[4] };
  preparedOrders.set(proposal, key(proposal));
  return { ok: true, proposal, reasons: [] };
}
export function executePaperOrder({ account, proposal, fillBar, executionQuote=null, policy = DEFAULT_PAPER_POLICY, configVersion, clientOrderId, configHash, sourceHash } = {}) {
  const rejected = (code, message) => ({ ok: false, account, reasons: [reason(code, message)] });
  const invalid = validatePaperAccount(account); if (invalid.length) return { ok: false, account, reasons: invalid };
  if (!proposal || proposal.mode !== 'paper' || !['buy', 'sell'].includes(proposal.side) || !iso(proposal.decisionAt) || !finite(proposal.targetWeight) || proposal.targetWeight < 0 || proposal.targetWeight > 1 || typeof clientOrderId !== 'string' || !clientOrderId || clientOrderId.length > 200) return rejected('INVALID_PROPOSAL', '모의 주문 내용을 확인하세요.');
  const fingerprint = key(proposal); const existing = account.orders.find(o => o.clientOrderId === clientOrderId);
  if (existing) return existing.fingerprint === fingerprint ? { ok: true, account, execution: clone(account.ledger.find(e => e.id === existing.executionId)), idempotent: true, reasons: [] } : rejected('IDEMPOTENCY_CONFLICT', '같은 주문 ID의 내용이 변경되었습니다.');
  if (!validatePaperPolicy(policy) || key(proposal.policy) !== key(policy) || proposal.configVersion !== configVersion || proposal.accountSnapshot !== accountSnapshot(account)) return rejected('STALE_PROPOSAL', '설정 또는 잔액이 변경되었습니다. 매매 신호를 다시 확인하세요.');
  if (!proposal.decision || proposal.decision.action !== proposal.side || proposal.decision.asOf !== proposal.decisionAt) return rejected('DECISION_MISMATCH', '매매 신호와 주문을 대조하세요.');
  if (!['jev','spec'].includes(proposal.decision.provider) || !['normal','clutch','defensive'].includes(proposal.decision.stance || 'normal')) return rejected('INVALID_DECISION', '매매 신호의 제공 방식과 운용 강도를 확인하세요.');
  if (proposal.decision.provider === 'jev' && (proposal.configHash !== configHash || proposal.sourceHash !== sourceHash || proposal.decision.configHash !== configHash || proposal.decision.sourceHash !== sourceHash || proposal.decision.strategyVersion !== configVersion)) return rejected('STALE_DECISION', '자료와 정책을 갱신한 뒤 다시 실행하세요.');
  const decisionTarget = proposal.decision.provider === 'spec' ? proposal.decision.targetWeight : proposal.side === 'buy' ? proposal.decision.stance === 'clutch' ? policy.clutchBuyWeight : policy.normalBuyWeight : policy.sellWeight;
  if (!finite(decisionTarget) || !close(proposal.targetWeight, Math.min(decisionTarget, policy.maxExposure))) return rejected('TARGET_CHANGED', '운용 정책과 주문 목표 비중을 대조하세요.');
  if (preparedOrders.get(proposal) !== fingerprint) return rejected('PROPOSAL_CHANGED', '주문 후보가 변경되었거나 새로 열렸습니다. 매매 신호부터 다시 확인하세요.');
  if(executionQuote){const q=executionQuote;if(q.executionPolicyVersionId!=='FORWARD_PAPER_FIRST_EXECUTABLE_V1'||![q.bid,q.ask,q.quantityAvailable].every(v=>finite(v)&&v>0)||q.bid>q.ask||![q.decisionCompletedAt,q.orderEligibleAt,q.quoteObservedAt,q.filledAt].every(iso)||Date.parse(q.decisionCompletedAt)>Date.parse(q.orderEligibleAt)||Date.parse(q.orderEligibleAt)>Date.parse(q.quoteObservedAt)||Date.parse(q.quoteObservedAt)>Date.parse(q.filledAt)||Date.parse(q.filledAt)-Date.parse(q.quoteObservedAt)>2000||Date.parse(q.decisionCompletedAt)<Date.parse(proposal.decisionAt)||Date.parse(q.quoteObservedAt)<Date.parse(account.asOf)||typeof q.priceSource!=='string'||!q.priceSource) return rejected('QUOTE_INVALID','호가의 출처·유효 시각·수량을 확인하세요.');}
  else if (!validBar(fillBar) || fillBar[0] !== Date.parse(proposal.decisionAt) || fillBar[0] < Date.parse(account.asOf)) return rejected('FILL_TIME_MISMATCH', '신호 다음 봉의 시가를 확인하세요.');
  const price = executionQuote?(proposal.side==='buy'?executionQuote.ask:executionQuote.bid):fillBar[1], m = accountMetrics(account, price), at = executionQuote?executionQuote.filledAt:new Date(fillBar[0]).toISOString();
  if (account.tradingDay !== day(at)) return rejected('DAY_MARK_REQUIRED', 'UTC 날짜의 모의 계좌 평가를 먼저 갱신하세요.');
  const dayStartEquity = account.tradingDay === day(at) ? account.dayStartEquity : m.equity;
  if (proposal.side === 'buy' && m.equity <= dayStartEquity * (1 - policy.dailyLossLimit)) return rejected('DAILY_LOSS_LIMIT', '체결 시점에 일일 손실 한도에 도달했습니다.');
  const feeRate = policy.feeBps / 10000, slip = policy.slippageBps / 10000;
  const fillPrice = price * (1 + (proposal.side === 'buy' ? slip : -slip));
  const target = Math.min(proposal.targetWeight, policy.maxExposure), current = account.btcQuantity * price;
  let quantity;
  if (proposal.side === 'buy') {
    const targetDelta = Math.max(0, (target * m.equity - current) / (price + target * (fillPrice * (1 + feeRate) - price)));
    quantity = Math.min(targetDelta, account.cash / (fillPrice * (1 + feeRate)), m.equity * policy.maxOrderWeight / (fillPrice * (1 + feeRate)));
  } else {
    const denominator = price + target * (fillPrice * (1 - feeRate) - price);
    quantity = Math.min(account.btcQuantity, Math.max(0, (current - target * m.equity) / denominator), m.equity * policy.maxOrderWeight / price);
  }
  quantity = Math.floor(quantity * 1e8) / 1e8;
  if(executionQuote&&quantity>executionQuote.quantityAvailable)return rejected('QUOTE_DEPTH_REQUIRED','첫 호가의 거래 가능 수량을 초과했습니다. 새 호가 또는 주문 분할을 검토하세요.');
  const gross = quantity * fillPrice, fee = gross * feeRate;
  if (quantity <= 0 || gross < policy.minNotional) return rejected('BELOW_MINIMUM_ORDER', '목표 비중 또는 최소 주문 금액 조건을 충족했습니다.');
  const next = clone(account); let realizedPnl = 0;
  if (proposal.side === 'buy') { next.averageCost = (next.btcQuantity * next.averageCost + gross + fee) / (next.btcQuantity + quantity); next.btcQuantity += quantity; next.cash -= gross + fee; }
  else { realizedPnl = gross - fee - quantity * next.averageCost; next.btcQuantity = Math.max(0, next.btcQuantity - quantity); next.cash += gross - fee; if (next.btcQuantity < 1e-10) { next.btcQuantity = 0; next.averageCost = 0; } }
  next.cash = Math.max(0, next.cash); next.realizedPnl += realizedPnl; next.feesPaid += fee; next.asOf = at; next.tradingDay = day(at); next.dayStartEquity = dayStartEquity;
  const execution = { id: globalThis.crypto.randomUUID(), clientOrderId, at, decisionAt: proposal.decisionAt, side: proposal.side, quantity, referencePrice: price, fillPrice, gross, fee, slippageCost: Math.abs(fillPrice - price) * quantity, realizedPnl, cashAfter: next.cash, btcAfter: next.btcQuantity, averageCostAfter: next.averageCost, configVersion, provider: proposal.decision.provider, stance: proposal.decision.stance || 'normal', evidenceRefs: clone(proposal.decision.evidenceRefs || []) };
  if(executionQuote)Object.assign(execution,{executionPolicyVersionId:'FORWARD_PAPER_FIRST_EXECUTABLE_V1',quote:clone(executionQuote),spreadCost:Math.abs(price-(executionQuote.bid+executionQuote.ask)/2)*quantity});
  next.ledger.push(execution); next.orders.push({ clientOrderId, fingerprint, executionId: execution.id });
  const errors = validatePaperAccount(next); if (errors.length) return { ok: false, account, reasons: errors };
  return { ok: true, account: next, execution, idempotent: false, reasons: [] };
}
