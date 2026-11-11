// Fixed point valuation of all remaining quantity; truncated depth stays unknown.
const Q=10n**18n;
function units(value){const text=String(value);if(!/^\d+(?:\.\d{1,18})?$/.test(text))throw new TypeError('정확한 가격·수량·수수료가 필요합니다.');const [a,b='']=text.split('.');return BigInt(a)*Q+BigInt(b.padEnd(18,'0'));}
export function remainingLiquidationReturn({quantity,costBasis,book,sellRate,asOf}){
 try{
  if(book?.kind!=='ORDER_BOOK'||![book.eventTime,book.receivedAt,book.availableAt??book.receivedAt].every(t=>Number.isFinite(Date.parse(t))&&t<=asOf&&Date.parse(asOf)-Date.parse(t)<=3000))return null;
  let left=units(quantity),notional=0n,previous=null;const cost=units(costBasis),fee=units(sellRate);if(left<=0n||cost<=0n||fee>=Q)return null;
  for(const level of book.levels){const price=units(level.bidPrice),size=units(level.bidQuantity);if(price<=0n||previous!==null&&price>=previous)return null;previous=price;const take=left<size?left:size;notional+=price*take/Q;left-=take;if(!left)break;}
  return left?null:Number(notional-notional*fee/Q-cost)/Number(cost);
 }catch{return null;}
}
