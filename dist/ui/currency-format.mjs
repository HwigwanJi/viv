/** BTC amounts retain satoshi precision and expose smaller nonzero amounts. */
export const currencyPrecision=(currency,digits=2)=>currency==='BTC'?8:digits;
export function currencyAmount(value,currency,digits=2){
  if(currency==='BTC'&&Number.isFinite(value)&&value!==0&&Math.abs(value)<1e-18)return value.toExponential(2);
  const precision=currency==='BTC'&&value!==0&&Math.abs(value)<1e-8?18:currencyPrecision(currency,digits);
  return Number.isFinite(value)?new Intl.NumberFormat('ko-KR',{minimumFractionDigits:currency==='BTC'?0:digits,maximumFractionDigits:precision}).format(value):'—';
}
