import {currencyAmount} from './currency-format.mjs';
const number=value=>value!==null&&value!==undefined&&String(value).trim()!==''&&Number.isFinite(Number(value))?Number(value):null;
/** Actual executed amounts only; requested/limit prices never stand in for fills. */
export function tradeFillSummary(record={}){
 const quantity=number(record.filledQuantity),fee=number(record.feesPaid);let gross=number(record.filledGross);
 if(!(quantity>0))return {quantity:quantity===0?0:null,gross:null,averagePrice:null,fee:fee>=0?fee:null};
 if(!(gross>0)){
  const fills=Array.isArray(record.fills)?record.fills:[],ids=new Set(fills.map(fill=>fill.id));
  if(fills.length&&ids.size===fills.length&&fills.every(fill=>typeof fill.id==='string'&&fill.id&&number(fill.quantity)>0&&number(fill.gross)>0)){
   const volume=fills.reduce((sum,fill)=>sum+Number(fill.quantity),0),total=fills.reduce((sum,fill)=>sum+Number(fill.gross),0);
   if(Number.isFinite(volume)&&Number.isFinite(total)&&Math.abs(volume-quantity)<=Math.max(volume,quantity)*1e-10)gross=total;
  }
 }
 const averagePrice=gross>0&&Number.isFinite(gross/quantity)?gross/quantity:null;
 return {quantity,gross:averagePrice===null?null:gross,averagePrice,fee:fee>=0?fee:null};
}
export function tradePrice(value,currency){
 const digits=value>0&&value<1?Math.min(12,Math.ceil(-Math.log10(value))+2):2;
 return currencyAmount(value,currency,digits);
}
