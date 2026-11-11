import {hashInputPackage} from './workspace.mjs';
export const MIND_SUBSCRIPTION_HISTORY_KIND='mindSubscriptionAttemptHistory';
export const MIND_SUBSCRIPTION_HISTORY_VERSION='mind-subscription-attempt-history-v1';
const ZERO='0'.repeat(64),clone=structuredClone;
export function checkpointMindAttempts(subscription,attempts){
 let previous=subscription.attemptCheckpoint??{count:0,throughBarCloseAt:null,tailHash:ZERO};const records=[];
 for(const attempt of attempts){
  const value={contractVersion:MIND_SUBSCRIPTION_HISTORY_VERSION,ownerId:subscription.ownerId,subscriptionId:subscription.id,profileId:subscription.profileId,sequence:previous.count+1,previousHash:previous.tailHash,attempt:clone(attempt)},record={...value,contentHash:hashInputPackage(value)};records.push(record);previous={contractVersion:MIND_SUBSCRIPTION_HISTORY_VERSION,count:record.sequence,throughBarCloseAt:attempt.barCloseAt,tailHash:record.contentHash};
 }
 return {checkpoint:attempts.length?previous:subscription.attemptCheckpoint,records};
}
export function verifyMindAttemptHistory(record,{ownerId,subscriptionId,profileId}={}){
 if(!record||record.contractVersion!==MIND_SUBSCRIPTION_HISTORY_VERSION||record.ownerId!==ownerId||record.subscriptionId!==subscriptionId||record.profileId!==profileId||!Number.isSafeInteger(record.sequence)||record.sequence<1||!/^[a-f0-9]{64}$/.test(record.previousHash??'')||!['COMPLETED','FAILED','ABANDONED'].includes(record.attempt?.status))return false;
 const {contentHash,...original}=record;return contentHash===hashInputPackage(original)&&(record.sequence!==1||record.previousHash===ZERO);
}
