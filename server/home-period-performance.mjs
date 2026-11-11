import {validateMindPaperAccount} from '../dist/domain/mind-paper.mjs';
import {getInstrument} from '../dist/domain/instruments.mjs';
import {hashInputPackage} from '../dist/domain/workspace.mjs';
import {researchSha256} from '../dist/domain/research.mjs';
import {loadInstrumentMarket} from './instrument-market.mjs';

export const HOME_24H_POLICY='MODIFIED_DIETZ_UTC_HOURLY_24H';
const HOUR=3600000,DAY=24*HOUR,list=v=>Array.isArray(v)?v:[],round=n=>Math.round(n*1e8)/1e8;
const iso=v=>typeof v==='string'&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString()===v;
const finite=v=>typeof v==='number'&&Number.isFinite(v),sha=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const missing=(code,message,extra={})=>({status:'DATA_REQUIRED',returnRatio:null,pnl:null,reason:{code,message},...extra});

export function reconstructPaperInventory(account,at){
  let cash=account.initialCash;const quantities=new Map();
  const timeline=[...account.ledger.map((f,i)=>({...f,_order:i,_fund:false})),...list(account.fundingLedger).map((f,i)=>({...f,_order:f.ledgerOffset,_fund:true,_sequence:i}))].sort((a,b)=>a._order-b._order||Number(b._fund)-Number(a._fund)||(a._sequence??0)-(b._sequence??0));
  for(const event of timeline){if(event.at>at)continue;if(event._fund)cash=round(cash+event.amount);else{cash=event.cashAfter;quantities.set(event.instrumentId,event.quantityAfter);}}
  return {asOf:at,cash,positions:[...quantities].filter(([,quantity])=>quantity>0).map(([instrumentId,quantity])=>({instrumentId,quantity}))};
}

function pricesFor(market,instrument,boundaries,observedAt){
  const source=market?.source,bars=market?.bars;
  if(market?.status!=='READY'||market.instrument?.id!==instrument.id||market.instrument?.quoteCurrency!==instrument.quoteCurrency||market.timeframe!=='1h'||!Array.isArray(bars)||source?.dataOrigin!=='PUBLIC_API'||source.instrumentId!==instrument.id||source.timeframe!=='1h'||!iso(source.availableAt)||!iso(source.receivedAt)||source.receivedAt>source.availableAt||source.availableAt>observedAt||source.barsSha256!==researchSha256(JSON.stringify(bars))||!(sha(source.rawSha256)||sha(source.captureSha256)&&list(source.captures).length&&source.captures.every(c=>sha(c.rawSha256))))return missing('PERIOD_SOURCE_REQUIRED','과거 확정 가격의 출처와 수신 기록을 확인하세요.');
  const selected=[];
  for(const at of boundaries){
    const matches=bars.filter(b=>b.closeTime===at),bar=matches[0];
    if(matches.length!==1||bar.isClosed!==true||!iso(bar.openTime)||Date.parse(bar.closeTime)-Date.parse(bar.openTime)!==HOUR||Date.parse(bar.openTime)%HOUR!==0||bar.closeTime>source.receivedAt||bar.closeTime>observedAt||!finite(bar.close)||bar.close<=0)return missing('PERIOD_BOUNDARY_PRICE_REQUIRED','평가 시작·종료 시점의 확정 가격이 필요합니다.');
    selected.push({instrumentId:instrument.id,currency:instrument.quoteCurrency,at,price:bar.close,openTime:bar.openTime,priceBasis:'CONFIRMED_1H_CLOSE'});
  }
  return {status:'READY',prices:selected,source:{provider:source.provider,url:source.url,receivedAt:source.receivedAt,availableAt:source.availableAt,rawSha256:source.rawSha256??null,captureSha256:source.captureSha256??null,barsSha256:source.barsSha256}};
}

/** Recover both portfolio endpoints from the ledger, then mark only their held assets at public confirmed closes. */
export async function buildHomePeriodPerformance(workspace,{now,fetchImpl,env={},marketLoader=loadInstrumentMarket}={}){
  const clock=()=>new Date(typeof now==='function'?now():now??Date.now()).toISOString(),requestedAt=clock(),endAt=new Date(Math.floor(Date.parse(requestedAt)/HOUR)*HOUR).toISOString(),startAt=new Date(Date.parse(endAt)-DAY).toISOString();
  const pending=[],neededMarks=new Map();
  for(const account of list(workspace.mindPositions).filter(a=>a.kind==='PAPER_ACCOUNT')){
    const row={accountId:account.id,profileId:account.profileId,currency:account.quoteCurrency,accountHash:hashInputPackage(account),startAt,endAt,method:HOME_24H_POLICY};
    let valid=false;try{valid=!validateMindPaperAccount(account).length&&[account.createdAt,account.updatedAt,account.asOf].every(at=>at<=requestedAt)&&account.ledger.every(f=>f.at<=account.asOf)&&list(account.fundingLedger).every(f=>f.at<=requestedAt)&&!['deposits','withdrawals','cashFlows','capitalFlows','transfers'].some(k=>account[k]!=null&&(!Array.isArray(account[k])||account[k].length))&&account.events.every(e=>['MIND_PAPER_FILLED','MIND_PAPER_HELD'].includes(e.type));}catch{}
    if(!valid){pending.push({...row,...missing('PERIOD_ACCOUNT_INVALID','계좌 원장을 확인하세요.')});continue;}
    if(account.createdAt>startAt){pending.push({...row,...missing('ACCOUNT_YOUNGER_THAN_24H','24시간 운용 기록을 기다립니다.')});continue;}
    if(!account.ledger.some(f=>f.at<=endAt)){pending.push({...row,...missing('NO_EXECUTED_TRADES','첫 운용 거래를 기다립니다.')});continue;}
    const start=reconstructPaperInventory(account,startAt),end=reconstructPaperInventory(account,endAt);
    for(const inventory of [start,end])for(const p of inventory.positions){const marks=neededMarks.get(p.instrumentId)??new Set();marks.add(inventory.asOf);neededMarks.set(p.instrumentId,marks);}
    pending.push({...row,account,start,end});
  }
  const markets=new Map();
  await Promise.all([...neededMarks].map(async ([instrumentId,boundaries])=>{
    let instrument;try{instrument=getInstrument(instrumentId);}catch{markets.set(instrumentId,missing('PERIOD_INSTRUMENT_REQUIRED','평가 종목을 확인하세요.'));return;}
    if(instrument.assetClass!=='crypto'||!instrument.timeframes.includes('1h')){markets.set(instrumentId,missing('PERIOD_HOURLY_MARKET_UNSUPPORTED','이 종목의 24시간 평가용 시간봉 연결이 필요합니다.'));return;}
    try{const market=await marketLoader({instrumentId,timeframe:'1h',limit:26,fetchImpl,env,now:clock});markets.set(instrumentId,pricesFor(market,instrument,[...boundaries],clock()));}
    catch(error){markets.set(instrumentId,missing('PERIOD_MARKET_UNAVAILABLE','과거 확정 가격을 불러오지 못했습니다.',{providerCode:typeof error.code==='string'?error.code:null}));}
  }));
  const observedAt=clock(),accounts=pending.map(item=>{
    if(!item.account)return item;
    const {account,start,end,...base}=item,ids=[...new Set([...start.positions,...end.positions].map(p=>p.instrumentId))],failures=ids.filter(id=>markets.get(id)?.status!=='READY').map(instrumentId=>({instrumentId,...markets.get(instrumentId)}));
    if(failures.length)return {...base,...missing(failures[0].reason.code,failures[0].reason.message),failures};
    if(ids.some(id=>markets.get(id).prices.some(p=>p.currency!==account.quoteCurrency)))return {...base,...missing('PERIOD_CURRENCY_MISMATCH','계좌와 같은 통화의 가격을 확인하세요.')};
    const prices=ids.flatMap(id=>markets.get(id).prices),mark=inventory=>inventory.cash+inventory.positions.reduce((n,p)=>n+p.quantity*prices.find(q=>q.instrumentId===p.instrumentId&&q.at===inventory.asOf).price,0),startingEquity=mark(start),endingEquity=mark(end);
    const flows=list(account.fundingLedger).filter(f=>f.at>startAt&&f.at<=endAt),netExternalFlows=flows.reduce((n,f)=>n+f.amount,0),timeWeightedExternalFlows=flows.reduce((n,f)=>n+f.amount*(Date.parse(endAt)-Date.parse(f.at))/DAY,0),capitalBase=startingEquity+timeWeightedExternalFlows,pnl=endingEquity-startingEquity-netExternalFlows;
    if(!finite(capitalBase)||capitalBase<=0||!finite(pnl))return {...base,...missing('POSITIVE_CAPITAL_BASE_REQUIRED','평가 기간의 투자 원금을 확인하세요.')};
    return {...base,status:'READY',returnRatio:pnl/capitalBase,pnl,capitalBase,startingEquity,endingEquity,netExternalFlows,timeWeightedExternalFlows,valuationAsOf:endAt,observedAt,startingSource:ids.length?'PUBLIC_CONFIRMED_CLOSE_AND_LEDGER':'RECONSTRUCTED_CASH_LEDGER',inventory:{start,end},prices,sources:ids.map(instrumentId=>({instrumentId,...markets.get(instrumentId).source})),reason:null};
  });
  return {policyVersion:HOME_24H_POLICY,revision:workspace.revision,requestedAt,observedAt,startAt,endAt,timeframe:'1h',accounts};
}

export function selectHomePeriodMetric(envelope,account,workspace,asOf){
  if(envelope?.policyVersion!==HOME_24H_POLICY||envelope.revision!==workspace.revision||!iso(envelope.observedAt)||envelope.observedAt>asOf||!iso(envelope.startAt)||!iso(envelope.endAt)||Date.parse(envelope.endAt)-Date.parse(envelope.startAt)!==DAY||Date.parse(envelope.endAt)%HOUR!==0||envelope.endAt>asOf)return null;
  const rows=list(envelope.accounts).filter(r=>r.accountId===account.id&&r.profileId===account.profileId&&r.currency===account.quoteCurrency&&r.accountHash===hashInputPackage(account));
  if(rows.length!==1)return null;
  const row=rows[0];if(row.startAt!==envelope.startAt||row.endAt!==envelope.endAt||row.method!==HOME_24H_POLICY)return null;
  if(row.status==='READY'&&(!['returnRatio','pnl','capitalBase','startingEquity','endingEquity','netExternalFlows','timeWeightedExternalFlows'].every(k=>finite(row[k]))||row.capitalBase<=0||Math.abs(row.returnRatio-row.pnl/row.capitalBase)>1e-10))return null;
  if(!['READY','DATA_REQUIRED'].includes(row.status))return null;
  const {accountId,profileId,currency,accountHash,...metric}=row;return structuredClone(metric);
}
