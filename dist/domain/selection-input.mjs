import {hashInputPackage} from './workspace.mjs';
import {getInstrument} from './instruments.mjs';

export const SELECTION_INPUT_VERSION='mind-selection-context-v1';
const HASH=/^[a-f0-9]{64}$/,ID=/^[a-zA-Z0-9][a-zA-Z0-9_.:@/-]{0,199}$/;
const plain=value=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.getPrototypeOf(value)===Object.prototype;
const iso=value=>typeof value==='string'&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value;
const instrument=value=>{try{return typeof value==='string'&&getInstrument(value).id===value;}catch{return false;}};
const bindingValid=binding=>binding?.kind==='SELECTION'&&binding.metricId==='IS_SELECTED'&&instrument(binding.instrumentId);
const fail=code=>({ready:false,value:null,unit:'boolean',sourceRefs:[],missing:[code]});

/** The selected set is an immutable result for one mind and one decision time. */
export function validSelectionContext(selection,{profileId,asOf}={}){
 if(!plain(selection)||Object.keys(selection).sort().join(',')!=='asOf,contractVersion,phase,profileId,selectedInstrumentIds,sourceHash'||selection.contractVersion!==SELECTION_INPUT_VERSION||!ID.test(profileId??'')||selection.profileId!==profileId||!iso(asOf)||selection.asOf!==asOf||!['SCREENING','FINAL'].includes(selection.phase)||!Array.isArray(selection.selectedInstrumentIds)||selection.selectedInstrumentIds.length>500||new Set(selection.selectedInstrumentIds).size!==selection.selectedInstrumentIds.length||!selection.selectedInstrumentIds.every(instrument)||!HASH.test(selection.sourceHash??''))return false;
 const {sourceHash,...original}=selection;
 return hashInputPackage(original)===sourceHash;
}

export function resolveSelectionInput(binding,{selection,profileId,asOf}={}){
 if(!bindingValid(binding))return fail('SELECTION_INPUT_BINDING');
 if(!validSelectionContext(selection,{profileId,asOf}))return fail('SELECTION_CONTEXT_REQUIRED');
 return {ready:true,value:selection.selectedInstrumentIds.includes(binding.instrumentId),unit:'boolean',instrumentId:binding.instrumentId,metricId:'IS_SELECTED',selection:structuredClone(selection),asOf,availableAt:asOf,sourceRefs:[{id:'selection:'+selection.sourceHash,contentHash:selection.sourceHash,sourceRef:SELECTION_INPUT_VERSION}],missing:[]};
}

export function validSelectionInput(binding,input,{profileId,asOf}={}){
 return bindingValid(binding)&&input?.ready===true&&input.instrumentId===binding.instrumentId&&input.metricId==='IS_SELECTED'&&input.unit==='boolean'&&typeof input.value==='boolean'&&input.asOf===asOf&&input.availableAt===asOf&&validSelectionContext(input.selection,{profileId,asOf})&&input.value===input.selection.selectedInstrumentIds.includes(binding.instrumentId)&&Array.isArray(input.sourceRefs)&&input.sourceRefs.length===1&&input.sourceRefs[0]?.id==='selection:'+input.selection.sourceHash&&input.sourceRefs[0]?.contentHash===input.selection.sourceHash&&input.sourceRefs[0]?.sourceRef===SELECTION_INPUT_VERSION;
}
