import {previewUpbitOrder} from './upbit-order-adapter.mjs';
import {scalpDecimal} from './upbit-scalping-market.mjs';
import {instrumentPriceUnit} from '../dist/domain/upbit-price-unit.mjs';
import {hashInputPackage} from '../dist/domain/workspace.mjs';

const Q=10n**18n,LOT=10n**10n,units=v=>{const [a,b='']=scalpDecimal(v).split('.');return BigInt(a)*Q+BigInt(b.padEnd(18,'0'));},text=v=>{const b=(v%Q).toString().padStart(18,'0').replace(/0+$/,'');return String(v/Q)+(b?'.'+b:'');};
export const isRestingTakeProfit=row=>row.plan?.signalEvidence?.purpose==='RESTING_TAKE_PROFIT';
export const isWorkingTakeProfit=row=>isRestingTakeProfit(row)&&['PENDING','PARTIALLY_FILLED'].includes(row.state)&&!row.cancelAttempt;

/** The existing order ledger is the durable schedule; filled entry quantities pin every reservation. */
export async function placeRestingTakeProfit({graph,activationId,market,rows,readOwn,submit,clock}){
 const node=graph.nodes.find(n=>n.type==='ORDER'),c=node?.config;if(!c?.takeProfitBps)return null;
 if(rows.some(r=>isRestingTakeProfit(r)&&r.request.market===market&&['RESERVED','UNKNOWN','PENDING','PARTIALLY_FILLED','RECONCILIATION_REQUIRED','RESPONSE_REVIEW_REQUIRED'].includes(r.state)))return null;
 const entry=[...rows].sort((a,b)=>(b.reservedAt??b.createdAt??'').localeCompare(a.reservedAt??a.createdAt??'')).find(r=>r.request?.market===market&&r.request.side==='bid'&&r.state==='FILLED'&&units(r.appliedQuantity??r.order?.executedVolume??'0')>0n);
 if(!entry)return null;
 const key='take-profit:'+hashInputPackage({activationId,entry:entry.identifier,graphHash:hashInputPackage(graph)}).slice(0,40);
 if(rows.some(r=>r.idempotencyKey===key))return null;
 const original=units(entry.appliedQuantity??entry.order.executedVolume),sold=rows.filter(r=>isRestingTakeProfit(r)&&r.plan.signalEvidence.entryIdentifier===entry.identifier).reduce((sum,r)=>sum+units(r.appliedQuantity??'0'),0n),desired=original*units(c.takeProfitFraction)/Q/LOT*LOT;
 if(sold>=desired)return null;
 const own=await readOwn(market),position=own.position.positions.find(p=>p.instrumentId==='crypto:upbit:'+market),owned=units(position?own.activation.positions?.[market.split('-')[1]]?.quantity??'0':'0');if(!owned)return null;
 const available=units(own.readiness.account.assetAvailable),quantity=[desired-sold,owned,available].reduce((a,b)=>a<b?a:b)/LOT*LOT;if(!quantity)return null;
 const gross=entry.order.trades.reduce((sum,t)=>sum+units(t.funds),0n),raw=(gross*Q*(10000n+BigInt(c.takeProfitBps))+original*10000n-1n)/(original*10000n),instrument={venueId:'upbit',quoteAsset:market.split('-')[0],symbol:market,tickSize:own.readiness.rules.tickSize,constraintSources:{tickSize:{kind:'PUBLIC_API',source:'https://api.upbit.com/v1/orderbook/instruments',asOf:own.readiness.asOf}}},tick=units(instrumentPriceUnit(instrument,raw)),price=(raw+tick-1n)/tick*tick;
 if(quantity*price/Q<units(own.readiness.rules.minSellTotal))return {state:'TAKE_PROFIT_BELOW_MINIMUM'};
 const plan=previewUpbitOrder({intent:{market,side:'ask',ordType:'limit',price:text(price),volume:text(quantity)},readiness:own.readiness,book:own.book,now:clock(),maxAgeMs:c.maxQuoteAgeMs??3000,signalEvidence:{purpose:'RESTING_TAKE_PROFIT',entryIdentifier:entry.identifier,entryQuantity:text(original),soldQuantity:text(sold),orderNodeId:node.id,takeProfitBps:c.takeProfitBps,takeProfitFraction:c.takeProfitFraction},policyRef:{manifestId:own.activation.config.manifestId,manifestHash:own.activation.config.manifestHash,graphHash:own.activation.config.graphHash}});
 return submit({own,plan,key});
}
