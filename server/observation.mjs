import archivedDataset from '../dist/data/btc-4h.json' with {type:'json'};
import archivedManifest from '../dist/data/btc-source-manifest.json' with {type:'json'};
import {FOUR_HOUR_MS} from './market.mjs';
import {loadPublicMarket,validatePublicMarketSnapshot,providerForSnapshot} from './market-providers.mjs';
import {WorkspaceError,hashInputPackage} from '../dist/domain/workspace.mjs';

const iso=value=>new Date(value).toISOString(),finite=value=>typeof value==='number'&&Number.isFinite(value),clone=value=>structuredClone(value);
const check=(ok,code,message)=>{if(!ok)throw new WorkspaceError(code,message);};
export const OBSERVATION_PERFORMANCE_VERSION='fixed-decision-marked-equity-v1';
const PROVIDERS={binance:{kind:'BINANCE_PUBLIC_REST',label:'Binance BTCUSDT'},okx:{kind:'OKX_PUBLIC_REST',label:'OKX BTC-USDT'}};
function observationProvider(workspace,record,options){
  const input=record.inputPackage,candidates=[];
  if(input.marketProvider!==undefined){check(Object.hasOwn(PROVIDERS,input.marketProvider),'OBSERVATION_PROVIDER_UNKNOWN','결정에 고정한 시세 공급원 등록을 확인하세요.');candidates.push(input.marketProvider);}
  const reference=input.marketDataRef,capture=options.decisionMarketSnapshot??workspace.marketSnapshots?.find(s=>s.id===reference);
  if(capture){
    const snapshot=capture.marketData?{...capture.marketData,sourceSnapshot:Object.fromEntries(Object.entries(capture).filter(([k])=>k!=='marketData'))}:capture;
    check(!reference||snapshot.sourceSnapshot?.id===reference,'OBSERVATION_PROVIDER_MISMATCH','당시 결정의 시세 원본 참조를 대조하세요.');
    const verified=validatePublicMarketSnapshot(snapshot,{requirePublic:true});check(verified.ok&&(!input.sourceHash||snapshot.manifest.datasetSha256===input.sourceHash),'MARKET_INTEGRITY','당시 결정의 시세 원본·공급원·해시를 확인하세요.');candidates.push(providerForSnapshot(snapshot));
  }
  if(input.marketData)candidates.push(providerForSnapshot(input.marketData));
  if(input.marketLoaderVersion&&input.marketLoaderVersion!=='archived-dataset-v1')candidates.push(providerForSnapshot({manifest:{loaderVersion:input.marketLoaderVersion}}));
  if(reference?.startsWith('binance-rest-'))candidates.push('binance');
  if(reference?.startsWith('okx-rest-'))candidates.push('okx');
  // Decisions made before provider metadata used the original Binance contract.
  if(!candidates.length&&!reference&&!input.marketData&&!input.marketProvider)return 'binance';
  check(candidates.length>0,'OBSERVATION_PROVIDER_UNKNOWN','결정에 사용한 시세 원본을 복원한 뒤 관측하세요.');
  check(candidates.every(value=>value===candidates[0]),'OBSERVATION_PROVIDER_MISMATCH','결정과 후속 관측의 시세 공급원을 동일하게 유지하세요.');return candidates[0];
}

/** Attribute only this decision's fills; later decisions never enter this path. */
export function decisionPerformance({record,account,referencePrice,price,bars,asOf}){
  const start=record?.inputPackage?.accountSnapshot;
  check(start&&account?.id===start.id&&finite(referencePrice)&&referencePrice>0&&finite(price)&&price>0,'OBSERVATION_ACCOUNT_REQUIRED','선택 당시 계좌와 체결 원장을 확인하세요.');
  const startTime=Date.parse(record.inputPackage.asOf),endTime=Date.parse(asOf),initialEquity=start.cash+start.btcQuantity*referencePrice;
  check(initialEquity>0&&Array.isArray(account.ledger)&&Array.isArray(start.ledger),'OBSERVATION_ACCOUNT_REQUIRED','선택 당시 자산과 원장을 확인하세요.');
  const previousIds=new Set(start.ledger.map(f=>f.id)),related=account.ledger.filter(f=>!previousIds.has(f.id)&&f.decisionId===record.id&&f.deploymentId===record.deploymentId);
  const fills=related.filter(f=>Date.parse(f.at)<=endTime).sort((a,b)=>Date.parse(a.at)-Date.parse(b.at));
  check(new Set(fills.map(f=>f.id)).size===fills.length&&fills.every(f=>Date.parse(f.at)>=startTime&&f.side===record.decision.action&&['buy','sell'].includes(f.side)&&[f.quantity,f.fillPrice,f.gross,f.fee,f.referencePrice].every(finite)&&f.quantity>0&&f.fillPrice>0&&f.gross>0&&f.fee>=0&&f.referencePrice>0),'OBSERVATION_FILL_MISMATCH','해당 선택의 체결 시각·귀속·수량·비용을 대조하세요.');
  let cash=start.cash,quantity=start.btcQuantity,fees=0,position=0;const path=[initialEquity];
  const mark=p=>{const equity=cash+quantity*p;check(finite(equity)&&equity>=0,'OBSERVATION_ACCOUNT_REQUIRED','관측 자산의 범위를 확인하세요.');path.push(equity);};
  for(const bar of bars){
    while(position<fills.length&&Date.parse(fills[position].at)<=bar[0]+FOUR_HOUR_MS){const fill=fills[position++];mark(fill.referencePrice);cash+=fill.side==='buy'?-fill.gross-fill.fee:fill.gross-fill.fee;quantity+=fill.side==='buy'?fill.quantity:-fill.quantity;fees+=fill.fee;check(cash>=-1e-6&&quantity>=-1e-10,'OBSERVATION_FILL_MISMATCH','선택 당시 잔고와 해당 체결의 자금·수량을 대조하세요.');cash=Math.max(0,cash);quantity=Math.max(0,quantity);mark(fill.referencePrice);}
    mark(bar[4]);
  }
  check(position===fills.length,'OBSERVATION_FILL_MISMATCH','체결을 포함하는 연속 관측 봉을 확인하세요.');
  const endingEquity=cash+quantity*price,netReturn=endingEquity/initialEquity-1,fee=record.inputPackage.feeScheduleSnapshot;
  check(fee&&[fee.feeBps,fee.slippageBps].every(v=>finite(v)&&v>=0),'OBSERVATION_COST_REQUIRED','선택에 고정한 수수료와 슬리피지 가정을 확인하세요.');
  const holdingEquity=start.cash+start.btcQuantity*price,holdingReturn=holdingEquity/initialEquity-1;
  const entryPrice=referencePrice*(1+fee.slippageBps/10000),buyQuantity=Math.floor(initialEquity/(entryPrice*(1+fee.feeBps/10000))*1e8)/1e8,buyGross=buyQuantity*entryPrice,buyFee=buyGross*fee.feeBps/10000,buyCash=initialEquity-buyGross-buyFee,buyAndHoldEquity=buyCash+buyQuantity*price,buyAndHoldReturn=buyAndHoldEquity/initialEquity-1;
  return {schemaVersion:1,version:OBSERVATION_PERFORMANCE_VERSION,fixedDecision:true,assumption:'선택 당시 계좌에 해당 결정의 실제 체결만 반영한 뒤 관측 종료까지 현금·수량을 고정한다. 후속 결정의 거래는 제외한다.',excursionBasis:'확정 봉 종가와 실제 체결 기준가에서 평가한 자산 경로',decisionId:record.id,accountId:start.id,selectedAction:record.decision.action,executionStatus:fills.length?'EXECUTED':record.decisionStatus==='REJECTED'?'REJECTED':record.decision.action==='hold'?'HOLD':'UNFILLED',fromAt:record.inputPackage.asOf,asOf,referencePrice,endingPrice:price,startingCash:start.cash,startingQuantity:start.btcQuantity,initialEquity,endingCash:cash,endingQuantity:quantity,endingEquity,netReturn,feesPaid:fees,fillIds:fills.map(f=>f.id),excludedLaterFillIds:related.filter(f=>Date.parse(f.at)>endTime).map(f=>f.id),maxFavorableExcursion:Math.max(...path)/initialEquity-1,maxAdverseExcursion:Math.min(...path)/initialEquity-1,benchmarks:{holdingEquity,holdingReturn,allCashEquity:initialEquity,allCashReturn:0,buyAndHoldEquity,buyAndHoldReturn,buyAndHoldEntryFee:buyFee,buyAndHoldEntrySlippage:buyQuantity*(entryPrice-referencePrice),terminalValuation:'종료 시가평가, 청산 수수료 추가 없음',cashAssumption:'선택 당시 평가자산을 현금으로 둔 대조값, 가상 청산 비용 없음'},opportunityCost:{holding:holdingReturn-netReturn,allCash:-netReturn,buyAndHold:buyAndHoldReturn-netReturn},costAssumption:{feeBps:fee.feeBps,slippageBps:fee.slippageBps,source:fee.source,feeScheduleSnapshotId:fee.id}};
}

/** A read/compute helper. The caller commits capture + observation atomically. */
export async function observeExperienceMarket(workspace,{experienceId,horizonHours=24}={},options={}){
  const now=options.now??new Date().toISOString(),current=Date.parse(now),wallStart=Date.now(),readNow=()=>iso(current+Date.now()-wallStart),experience=workspace.experiences.find(e=>e.id===experienceId);
  check(Number.isFinite(current)&&iso(current)===now&&experience?.experienceType==='INVESTMENT_DECISION'&&[4,12,24,48,72,168].includes(horizonHours),'INVALID_OBSERVATION','관측할 투자 경험과 기간을 확인하세요.');
  check(experience.status==='AWAITING_OBSERVATION','OBSERVATION_STATE','관측 대기 중인 경험을 선택하세요.');
  const record=workspace.decisionRecords.find(r=>r.id===experience.decisionId&&r.deploymentId===experience.deploymentId),account=workspace.accounts.find(a=>a.id===experience.accountId),start=Date.parse(experience.occurredAt),end=start+horizonHours*3600000,due=Math.max(end,Date.parse(experience.observationDueAt)),forward=experience.experimentType==='FORWARD_PAPER';
  check(record&&account&&Number.isSafeInteger(start)&&start%FOUR_HOUR_MS===0&&end>=Date.parse(experience.observationDueAt),'INVALID_OBSERVATION','경험의 선택·원장·관측 시작 봉을 확인하세요.');
  const provider=forward?observationProvider(workspace,record,options):null,availableClose=Math.floor(current/FOUR_HOUR_MS)*FOUR_HOUR_MS;
  let availability={status:'WAITING_TIME',code:'OBSERVATION_DATA_REQUIRED',dueAt:iso(due),requestedEndAt:iso(end),availableAt:iso(due),availableThrough:iso(availableClose),missingBars:Math.max(0,(end-availableClose)/FOUR_HOUR_MS),horizonHours,sourceKind:forward?PROVIDERS[provider].kind:'ARCHIVED_DATASET',provider,message:`관측 종료 ${iso(end)} 이후 확정 봉을 기다립니다. 부족 ${Math.max(0,(end-availableClose)/FOUR_HOUR_MS)}개.`};
  if(current<due)return {ready:false,availability};
  let dataset=archivedDataset,manifest=archivedManifest,marketSnapshot=null;
  if(forward){
    const loaded=await loadPublicMarket({provider,fetchImpl:options.fetchImpl,now:readNow});
    const verified=validatePublicMarketSnapshot(loaded,{now:readNow(),requirePublic:true});check(verified.ok&&providerForSnapshot(loaded)===provider,'MARKET_INTEGRITY',verified.reasons[0]?.message??'후속 확정 봉의 원문·출처·해시를 확인하세요.');
    dataset=loaded.dataset;manifest=loaded.manifest;marketSnapshot={...loaded.sourceSnapshot,marketData:{dataset,manifest}};
  }
  const bars=dataset.bars.filter(b=>b[0]>=start&&b[0]+FOUR_HOUR_MS<=end),expected=horizonHours/4,times=new Set(bars.map(b=>b[0])),missing=Array.from({length:expected},(_,i)=>start+i*FOUR_HOUR_MS).filter(t=>!times.has(t));
  check(bars.every((b,i)=>b[0]+FOUR_HOUR_MS<=current&&(i===0||b[0]>bars[i-1][0])),'OBSERVATION_FUTURE_DATA','후속 관측에는 현재까지 확정된 순서의 봉을 사용하세요.');
  availability={...availability,status:missing.length?'WAITING_DATA':'READY',availableAt:forward?manifest.availableAt:now,availableThrough:dataset.endAt,missingBars:missing.length,missingCloseTimes:missing.map(t=>iso(t+FOUR_HOUR_MS)),sourceHash:manifest.datasetSha256,sourceSnapshotId:marketSnapshot?.id??null,message:missing.length?`관측 종료 ${iso(end)}의 확정 봉 ${missing.length}개가 부족합니다. 확보 자료 종료 ${dataset.endAt}.`:`관측 종료 ${iso(end)}까지 확정 봉 ${expected}개를 확보했습니다.`};
  if(missing.length||bars.length!==expected)return {ready:false,availability};
  const price=bars.at(-1)[4],maxPrice=Math.max(experience.referencePrice,...bars.map(b=>b[2])),minPrice=Math.min(experience.referencePrice,...bars.map(b=>b[3]));
  const source={kind:availability.sourceKind,...(forward?{provider,loaderVersion:manifest.loaderVersion,dataOrigin:manifest.dataOrigin,validationMode:'PUBLIC'}:{}),datasetSha256:manifest.datasetSha256,sourceSnapshotId:marketSnapshot?.id??null,sourceSnapshotSha256:marketSnapshot?.sha256??null,barRange:{startAt:iso(start),endAt:iso(end),count:bars.length},barsSha256:hashInputPackage(bars),availableAt:availability.availableAt,observedAt:forward?readNow():now};
  const performance=decisionPerformance({record,account,referencePrice:experience.referencePrice,price,bars,asOf:iso(end)});
  const observation={asOf:iso(end),horizonHours,price,maxPrice,minPrice,details:`${forward?PROVIDERS[provider].label:'보관 BTCUSDT'} 확정 4시간봉 · ${horizonHours}시간 후속 관측`,availability,source,performance,counterfactual:{allCashReturn:performance.benchmarks.allCashReturn,holdingReturn:performance.benchmarks.holdingReturn,buyAndHoldReturn:performance.benchmarks.buyAndHoldReturn,comparison:'선택 당시 잔고 유지·현금·비용 반영 매수 보유 대조'},costAssumption:clone(performance.costAssumption)};
  return {ready:true,availability,observation,marketSnapshot};
}
