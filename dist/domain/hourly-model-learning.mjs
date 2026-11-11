import {hourlyComponentTraining} from './hourly-model-components.mjs';
import {hourlyPathFeatures} from './hourly-path-model.mjs';
import {hashInputPackage} from './workspace.mjs';
const H=3600000,iso=t=>new Date(t).toISOString(),check=(v,c)=>{if(!v)throw Object.assign(Error(c),{code:c,status:409});};

export const HOURLY_LEARNING_CONTRACT='hourly-model-refresh-v1';
export function hourlyTrainingRows(candles,{cutoff,trainingDays=7,components}={}){
 if(components)trainingDays=hourlyComponentTraining(components).trainingDays;
 const end=Date.parse(cutoff),start=end-trainingDays*24*H;check(Number.isFinite(end)&&Number.isSafeInteger(trainingDays)&&trainingDays>=1&&trainingDays<=7,'HOURLY_TRAIN_WINDOW');
 const byMarket=new Map();for(const c of candles){check(Array.isArray(c.bar)&&c.bar.length===6&&c.bar.every(Number.isFinite)&&Number.isFinite(Date.parse(c.availableAt)),'HOURLY_TRAIN_CANDLE');if(Date.parse(c.availableAt)>end||c.bar[0]+H>end)continue;const map=byMarket.get(c.market)??new Map();const old=map.get(c.bar[0]);check(!old||JSON.stringify(old.bar)===JSON.stringify(c.bar),'HOURLY_TRAIN_CANDLE_CONFLICT');map.set(c.bar[0],c);byMarket.set(c.market,map);}
 const rows=[];for(const [market,map]of byMarket){const keys=[...map.keys()].sort((a,b)=>a-b);for(const open of keys){const at=open+H;if(at<start||at+6*H>end)continue;const history=Array.from({length:30},(_,i)=>map.get(at-(30-i)*H)?.bar),future=Array.from({length:6},(_,i)=>map.get(at+i*H)?.bar);if([...history,...future].some(v=>!v))continue;const x=hourlyPathFeatures(history,{asOf:iso(at),components}),reference=history.at(-1)[4];rows.push({market,at:iso(at),labelAt:iso(at+6*H),x,y:[future.at(-1)[4]/reference-1,Math.min(...future.map(b=>b[3]))/reference-1]});}}
 return rows.sort((a,b)=>a.at.localeCompare(b.at)||a.market.localeCompare(b.market));
}

export function learningCurveMetrics(curve,initialCapital){
 if(!curve.length)return null;let peak=initialCapital,mdd=0,peakAt=curve[0].at,underwaterAt=null,recoveredAt=null,maxRecoveryMs=0,gaps=0;
 for(let i=0;i<curve.length;i++){const p=curve[i];check(Number.isFinite(p.equity)&&p.equity>=0&&(!i||p.at>curve[i-1].at),'HOURLY_LEARNING_CURVE');if(i&&Date.parse(p.at)-Date.parse(curve[i-1].at)>90000)gaps++;if(p.equity>=peak){if(underwaterAt){maxRecoveryMs=Math.max(maxRecoveryMs,Date.parse(p.at)-Date.parse(peakAt));recoveredAt=p.at;}peak=p.equity;peakAt=p.at;underwaterAt=null;}else underwaterAt??=p.at;mdd=Math.max(mdd,peak?1-p.equity/peak:0);}
 const last=curve.at(-1);return {netReturn:last.equity/initialCapital-1,finalEquity:last.equity,observedMdd:mdd,mdd:gaps?null:mdd,sampling:'OBSERVED_60_SECOND_LIQUIDATION_VALUE',missingIntervals:gaps,recovery:gaps?null:underwaterAt?{status:'UNRECOVERED',since:peakAt,observedMs:Date.parse(last.at)-Date.parse(peakAt)}:{status:'RECOVERED',at:recoveredAt,maxRecoveryMs},continuousMdd:null};
}

export function assessHourlyTrial(trial){
 if(Date.parse(trial.endsAt)-Date.parse(trial.startsAt)!==24*H)return {contractVersion:HOURLY_LEARNING_CONTRACT,status:'INVALID_COMPARISON_WINDOW',metrics:{},cashReturn:0};
 const metrics=Object.fromEntries(Object.entries(trial.arms).map(([k,a])=>[k,learningCurveMetrics(a.curve,Number(trial.initialCapital))]));
 const base=metrics.baseline,candidate=metrics.candidate,btc=metrics.btc;
 const common={contractVersion:HOURLY_LEARNING_CONTRACT,metrics,cashReturn:0,criteria:'24h prospective; candidate has a completed round trip, positive net liquidation return, higher net return and no greater sampled MDD than the frozen baseline; complete sampled valuation path. Fees, recovery and BTC excess shown.',modelOnly:true};
 if(!base||!candidate||!btc||trial.asOf<trial.endsAt)return {...common,status:'COMPARING'};
 if(Object.values(metrics).some(m=>m.mdd===null)||Object.values(trial.arms).some(a=>a.curve[0].at!==trial.startsAt||a.curve.at(-1).at<trial.endsAt||a.curve.at(-1).at>trial.asOf))return {...common,status:'VALUATION_GAPS'};
 const wins=trial.arms.candidate.closedTrades>0&&candidate.netReturn>0&&candidate.netReturn>base.netReturn&&candidate.mdd<=base.mdd;
 return {...common,status:wins?'READY_TO_APPLY':'KEEP_CURRENT',netImprovement:candidate.netReturn-base.netReturn,mddChange:candidate.mdd-base.mdd,candidateBtcExcess:candidate.netReturn-btc.netReturn,baselineBtcExcess:base.netReturn-btc.netReturn,fees:Object.fromEntries(Object.entries(trial.arms).map(([k,a])=>[k,a.feesPaid??'0'])),evidenceHash:hashInputPackage({trialId:trial.id,metrics,closed:trial.arms.candidate.closedTrades})};
}
