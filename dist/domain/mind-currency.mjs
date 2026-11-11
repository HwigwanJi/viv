/** Quote-denominated paper limits. No FX conversion is inferred. */
export const PAPER_QUOTE_CURRENCIES=Object.freeze(['USDT','USD','KRW','BTC']);
export const DEFAULT_MINIMUM_ORDER_AMOUNTS=Object.freeze({USDT:10,USD:10,KRW:5000,BTC:0.00005});
export const UPBIT_MINIMUM_ORDER_AMOUNTS=Object.freeze({KRW:5000,BTC:0.00005,USDT:0.5});
export const UPBIT_MINIMUM_ORDER_SOURCE='https://support.upbit.com/hc/ko/articles/4403838454809';
export function minimumMindNotional(manifest,instrument){
  const policy=manifest?.data?.universe?.scopePolicy;
  const amount=policy?policy.minimumOrderAmounts?.[instrument?.quoteCurrency]:manifest?.data?.riskPreset?.minNotional;
  if(typeof amount!=='number'||!Number.isFinite(amount)||amount<=0)throw Object.assign(new TypeError('종목의 결제 통화에 맞는 최소 주문 금액을 설정하세요.'),{code:'MIND_CURRENCY_MINIMUM_REQUIRED',status:409});
  const floor=instrument?.provider==='upbit'||instrument?.id?.startsWith('crypto:upbit:')?UPBIT_MINIMUM_ORDER_AMOUNTS[instrument.quoteCurrency]:0;
  if(floor&&amount<floor)throw Object.assign(new TypeError('업비트 마켓의 최소 주문 금액 이상으로 설정하세요.'),{code:'MIND_CURRENCY_MINIMUM_BELOW_MARKET',status:409});
  return amount;
}
