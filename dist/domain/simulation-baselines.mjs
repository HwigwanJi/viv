import {FOUR_HOURS_MS,DAY_MS} from '../trading/model.mjs';
import {validateSimulationConfig,SimulationError} from './simulation.mjs';
import {hashInputPackage} from './workspace.mjs';

export const SIMULATION_BASELINE_VERSION='SIMULATION_BASELINE_COMPARISON_V1';
export const SIMULATION_BASELINE_POLICY=Object.freeze({
  id:'DCA_EQUAL_DAILY_BUDGET',version:'DCA_EQUAL_DAILY_BUDGET_V1',
  funding:'ALL_INITIAL_CASH_AVAILABLE_AT_START',budget:'INITIAL_CASH_DIVIDED_BY_PURCHASE_DAYS_FEE_INCLUSIVE',
  calendar:'UTC',execution:'FIRST_SELECTED_4H_BAR_OPEN_PER_UTC_DAY',period:'START_INCLUSIVE_END_EXCLUSIVE',
  missingData:'REJECT_NONCONTIGUOUS_SELECTED_WINDOW',marketCalendar:'BTC_CONTINUOUS_24_7',
  quantity:'FRACTIONAL_BTC',minimumNotional:0,mark:'SELECTED_4H_BAR_CLOSE',
  averageExposure:'ARITHMETIC_MEAN_OF_EACH_SELECTED_4H_CLOSE_EXPOSURE',
  finalLiquidation:false,externalCashFlows:0,
});
const HASH=/^[a-f0-9]{64}$/;
const check=(condition,code,message)=>{if(!condition)throw new SimulationError(code,message);};
const iso=value=>new Date(value).toISOString();
const closeEnough=(a,b)=>Math.abs(a-b)<=Math.max(1e-7,Math.abs(b)*1e-10);

function baseline(id,bars,config,schedule){
  let cash=config.initialCash,quantity=0,feesPaid=0,slippagePaid=0,peak=config.initialCash,maxDrawdown=0,exposureSum=0,maximumExposure=0;
  const fills=[],curve=[],feeRate=config.feeBps/10000,slip=config.slippageBps/10000;
  for(const bar of bars){
    const plannedBudget=schedule.get(bar[0]);
    if(plannedBudget!==undefined){
      const budget=Math.min(plannedBudget,cash),marketOpenPrice=bar[1],fillPrice=marketOpenPrice*(1+slip);
      const bought=budget/(fillPrice*(1+feeRate)),gross=bought*fillPrice,fee=gross*feeRate,slippageCost=(fillPrice-marketOpenPrice)*bought;
      quantity+=bought;cash=Math.max(0,cash-gross-fee);feesPaid+=fee;slippagePaid+=slippageCost;
      fills.push({id:id+':'+fills.length,side:'buy',at:iso(bar[0]),decisionAt:iso(bar[0]),sourceBarOpenTime:bar[0],
        executionBasis:'NEXT_EXECUTION_BAR_OPEN',budget,marketOpenPrice,fillPrice,quantity:bought,gross,fee,slippageCost,cashFlow:-(gross+fee),cashAfter:cash});
    }
    const equity=cash+quantity*bar[4],exposure=quantity*bar[4]/equity;
    peak=Math.max(peak,equity);const drawdown=(peak-equity)/peak;
    maxDrawdown=Math.max(maxDrawdown,drawdown);exposureSum+=exposure;maximumExposure=Math.max(maximumExposure,exposure);
    curve.push({at:iso(bar[0]+FOUR_HOURS_MS),equity,cash,quantity,exposure,drawdown});
  }
  const finalEquity=curve.at(-1).equity,totalReturn=finalEquity/config.initialCash-1;
  return {id,initialEquity:config.initialCash,finalEquity,totalReturn,totalReturnPct:totalReturn*100,maxDrawdown,
    averageExposure:exposureSum/bars.length,maximumExposure,feesPaid,slippagePaid,totalCosts:feesPaid+slippagePaid,
    tradeCount:fills.length,buyCount:fills.length,sellCount:0,endingCash:cash,quantity,
    firstFillAt:fills[0]?.at??null,lastFillAt:fills.at(-1)?.at??null,fills,curve};
}

/** Read-only derivation from a completed simulation's original data and costs. */
export function buildSimulationBaselineComparison(state,dataset,{originReportHash=null,pinnedPolicy=null}={}){
  check(state?.status==='COMPLETED'&&state.cursor===state.coverage?.totalDecisionFrames,'SIMULATION_INCOMPLETE','선택 기간을 완료한 뒤 기준 수익률을 비교하세요.');
  check(originReportHash===null||HASH.test(originReportHash),'SIMULATION_BASELINE_REPORT_HASH','원본 보고서 식별값을 확인하세요.');
  const policyHash=hashInputPackage(SIMULATION_BASELINE_POLICY);
  check(pinnedPolicy===null||hashInputPackage(pinnedPolicy)===policyHash,'SIMULATION_BASELINE_POLICY','고정된 정액 매수 기준 버전을 확인하세요.');
  check(hashInputPackage(state.config)===state.pins.configHash&&hashInputPackage(dataset)===state.pins.datasetHash,'SIMULATION_SOURCE_CHANGED','원본 기간·가격·비용 조건을 대조하세요.');
  const checked=validateSimulationConfig(dataset,state.config);
  check(checked.ok,checked.reasons[0]?.code,checked.reasons[0]?.message);
  const {firstBarIndex,lastBarIndex}=checked.coverage,bars=dataset.bars.slice(firstBarIndex,lastBarIndex+1),config=state.config;
  const days=new Map();for(const bar of bars){const day=Math.floor(bar[0]/DAY_MS);if(!days.has(day))days.set(day,bar[0]);}
  const purchaseDayCount=days.size,dailyBudget=config.initialCash/purchaseDayCount;
  const dcaSchedule=new Map([...days.values()].map(at=>[at,dailyBudget]));
  const buyAndHold=baseline('BUY_AND_HOLD',bars,config,new Map([[bars[0][0],config.initialCash]]));
  const dailyDca={...baseline('DCA_EQUAL_DAILY_BUDGET',bars,config,dcaSchedule),purchaseDayCount,dailyBudget};
  const stored=state.benchmark?.account;
  check(stored&&['equity','quantity','feesPaid','slippagePaid'].every(key=>closeEnough(stored[key],buyAndHold[key==='equity'?'finalEquity':key])),
    'SIMULATION_BASELINE_PARITY','원본 일시 매수 기준의 가격·수수료·슬리피지를 대조하세요.');
  const cash={id:'CASH',initialEquity:config.initialCash,finalEquity:config.initialCash,totalReturn:0,totalReturnPct:0,maxDrawdown:0,
    averageExposure:0,maximumExposure:0,feesPaid:0,slippagePaid:0,totalCosts:0,tradeCount:0,buyCount:0,sellCount:0,endingCash:config.initialCash,quantity:0,firstFillAt:null,lastFillAt:null,fills:[]};
  const curve=bars.map((_,i)=>({at:dailyDca.curve[i].at,buyAndHoldEquity:buyAndHold.curve[i].equity,dailyDcaEquity:dailyDca.curve[i].equity,
    cashBenchmarkEquity:config.initialCash,buyAndHoldExposure:buyAndHold.curve[i].exposure,dailyDcaExposure:dailyDca.curve[i].exposure}));
  delete buyAndHold.curve;delete dailyDca.curve;
  const strategyReturn=state.account.equity/config.initialCash-1;
  const result={schemaVersion:1,contractVersion:SIMULATION_BASELINE_VERSION,policy:structuredClone(SIMULATION_BASELINE_POLICY),policyHash,
    provenance:{derivation:pinnedPolicy?'PINNED_AT_CREATE':'READ_ONLY_DERIVATION',simulationId:state.id,originReportHash,
      configHash:state.pins.configHash,datasetHash:state.pins.datasetHash,selectedPriceHash:hashInputPackage(bars),
      startAt:config.startAt,endAt:config.endAt,initialCash:config.initialCash,feeBps:config.feeBps,slippageBps:config.slippageBps,
      dataInstrumentId:state.pins.dataInstrumentId,providerCalls:0,originalReportPreserved:true},
    benchmarks:{buyAndHold,dailyDca,cash},excessReturn:{buyAndHold:strategyReturn-buyAndHold.totalReturn,dailyDca:strategyReturn-dailyDca.totalReturn,cash:strategyReturn},curve,
    buyAndHoldParity:{status:'MATCH',storedFinalEquity:stored.equity,derivedFinalEquity:buyAndHold.finalEquity,difference:buyAndHold.finalEquity-stored.equity}};
  return {...result,hash:hashInputPackage(result)};
}
