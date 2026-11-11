import {hashInputPackage} from './workspace.mjs';
import {getInstrument} from './instruments.mjs';

export const CAMPAIGN_INPUT_VERSION='mind-campaign-context-v1';
const HASH=/^[a-f0-9]{64}$/,ID=/^[a-zA-Z0-9][a-zA-Z0-9_.:@/-]{0,199}$/;
const plain=value=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.getPrototypeOf(value)===Object.prototype;
const iso=value=>typeof value==='string'&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value;
const instrument=value=>{try{return typeof value==='string'&&getInstrument(value).id===value;}catch{return false;}};
const bindingValid=binding=>binding?.kind==='CAMPAIGN'&&binding.metricId==='EXIT_REQUESTED'&&instrument(binding.instrumentId);
const fail=code=>({ready:false,value:null,unit:'boolean',sourceRefs:[],missing:[code]});

/** A persisted exit request belongs to one mind account and the current evaluation time. */
export function validCampaignContext(campaign,{profileId,accountId,asOf}={}){
 const required=['contractVersion','profileId','accountId','asOf','exitRequested','sourceHash'],optional=['subscriptionId','requestRunId','requestedAt'];
 if(!plain(campaign)||!required.every(key=>Object.hasOwn(campaign,key))||Object.keys(campaign).some(key=>!required.includes(key)&&!optional.includes(key))||campaign.contractVersion!==CAMPAIGN_INPUT_VERSION||!ID.test(profileId??'')||campaign.profileId!==profileId||!ID.test(campaign.accountId??'')||(accountId!==undefined&&campaign.accountId!==accountId)||!iso(asOf)||campaign.asOf!==asOf||typeof campaign.exitRequested!=='boolean'||!HASH.test(campaign.sourceHash??'')||['subscriptionId','requestRunId'].some(key=>Object.hasOwn(campaign,key)&&!ID.test(campaign[key]??''))||Object.hasOwn(campaign,'requestedAt')&&(!iso(campaign.requestedAt)||campaign.requestedAt>asOf))return false;
 const {sourceHash,...original}=campaign;return hashInputPackage(original)===sourceHash;
}

export function resolveCampaignInput(binding,{campaign,profileId,accountId,asOf}={}){
 if(!bindingValid(binding))return fail('CAMPAIGN_INPUT_BINDING');
 if(!validCampaignContext(campaign,{profileId,accountId,asOf}))return fail('CAMPAIGN_CONTEXT_REQUIRED');
 return {ready:true,value:campaign.exitRequested,unit:'boolean',instrumentId:binding.instrumentId,metricId:'EXIT_REQUESTED',campaign:structuredClone(campaign),asOf,availableAt:asOf,sourceRefs:[{id:'campaign:'+campaign.sourceHash,contentHash:campaign.sourceHash,sourceRef:CAMPAIGN_INPUT_VERSION}],missing:[]};
}

export function validCampaignInput(binding,input,{profileId,accountId,asOf}={}){
 return bindingValid(binding)&&input?.ready===true&&input.instrumentId===binding.instrumentId&&input.metricId==='EXIT_REQUESTED'&&input.unit==='boolean'&&typeof input.value==='boolean'&&input.asOf===asOf&&input.availableAt===asOf&&validCampaignContext(input.campaign,{profileId,accountId,asOf})&&input.value===input.campaign.exitRequested&&Array.isArray(input.sourceRefs)&&input.sourceRefs.length===1&&input.sourceRefs[0]?.id==='campaign:'+input.campaign.sourceHash&&input.sourceRefs[0]?.contentHash===input.campaign.sourceHash&&input.sourceRefs[0]?.sourceRef===CAMPAIGN_INPUT_VERSION;
}
