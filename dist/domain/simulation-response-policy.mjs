export const SIMULATION_RESPONSE_POLICY='simulation-choice-rounded-2dp-v1';
/** Preserve provider numbers; only a bounded hundredth-grid rounding envelope is accepted. */
export function simulationProbabilityAudit(probabilities){
 const values=Object.values(probabilities??{}),valid=values.length>0&&values.every(v=>typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=1);
 if(!valid)return {accepted:false,normalization:'NONE',reason:'PROBABILITY_RANGE'};
 const rawSum=values.reduce((n,v)=>n+v,0),strict=Math.abs(rawSum-1)<=.005,grid=values.every(v=>Math.abs(v-Math.round(v*100)/100)<=1e-10),integerSum=values.reduce((n,v)=>n+Math.round(v*100),0),lower=values.reduce((n,v)=>n+Math.max(0,v-.005),0),upper=values.reduce((n,v)=>n+Math.min(1,v+.005),0),rounded=grid&&[99,101].includes(integerSum)&&Math.abs(rawSum-1)<=.01+1e-10&&lower<=1&&upper>=1;
 return {accepted:strict||rounded,acceptedBy:strict?'STRICT_SUM':rounded?'SIMULATION_ROUNDED_CHOICE_2DP':'REJECTED',rawSum,roundingGrid:grid?.01:null,integerSum,possibleSum:{lower,upper},normalization:'NONE',policyVersion:SIMULATION_RESPONSE_POLICY};
}
