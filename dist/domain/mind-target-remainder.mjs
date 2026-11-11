const finite=value=>typeof value==='number'&&Number.isFinite(value);

/** A held position can already satisfy a target to within one executable order.
 * Cash, order caps and other holdings never reduce the target remainder here. */
export function mindTargetRemainder({action,targetWeight,equity,currentValue,quantity,minimumNotional}={}){
 if(action!=='buy'||![targetWeight,equity,currentValue,quantity,minimumNotional].every(finite)||targetWeight<0||targetWeight>1||equity<=0||currentValue<=0||quantity<=0||minimumNotional<=0)return null;
 const remainingNotional=Math.max(0,targetWeight*equity-currentValue);
 if(remainingNotional>=minimumNotional)return null;
 return {policyVersion:'mind-target-remainder-v1',code:remainingNotional===0?'TARGET_ALREADY_REACHED':'TARGET_REMAINDER_BELOW_MINIMUM',targetWeight,currentWeight:currentValue/equity,equity,currentValue,remainingNotional,minimumNotional};
}
