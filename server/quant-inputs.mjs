import {resolveCampaignInput} from '../dist/domain/campaign-input.mjs';
import {resolvePositionInput} from '../dist/domain/position-input.mjs';
import {resolveSelectionInput} from '../dist/domain/selection-input.mjs';
import {assertMindDocument,mindDocumentHash} from '../dist/domain/mind-manifest.mjs';
import {hashInputPackage} from '../dist/domain/workspace.mjs';
import {quantInputMetric,observationMetricId,normalizeQuantMetric,QUANT_INPUT_CATALOG_VERSION} from '../dist/domain/quant-input-catalog.mjs';
import {selectMarketKnowledge} from '../dist/domain/market-knowledge.mjs';
import {getInstrument} from '../dist/domain/instruments.mjs';
import {compactGraphInputs,effectiveStrategyInputBinding} from '../dist/domain/strategy-graph-inputs.mjs';
import {resolveQueryParameters,bindPreparedInput} from '../dist/domain/strategy-parameters.mjs';

const FOUR=14400000,DAY=86400000,clone=structuredClone;
const iso=value=>typeof value==='string'&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value;
const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const blocked=(asOf,...missing)=>({ready:false,value:null,unit:null,asOf,availableAt:null,sourceRefs:[],missing:[...new Set(missing)]});
const maxTime=(...values)=>values.filter(iso).sort().at(-1)??null;

/** Resolve only approved values available at the decision boundary; never fill missing fundamentals. */
export function resolveQuantMetric({binding,manifest,contexts=[],asOf}={}){
 const metric=quantInputMetric(binding.metricId);if(!metric)return blocked(asOf,'UNKNOWN_METRIC');
 if(!String(binding.instrumentId).startsWith('equity:'))return blocked(asOf,'METRIC_ASSET_SCOPE');
 const candidates=[],excluded=[];
 for(const entry of contexts){
  const document=entry?.document;
  try{assertMindDocument(document);}catch{excluded.push({id:document?.id??null,reason:'INVALID_DOCUMENT'});continue;}
  const matching=document.kind==='market-context'?document.data.observations.filter(o=>observationMetricId(o)===metric.id):[];if(!matching.length)continue;
  let reason=null;const contentHash=mindDocumentHash(document),approvedAt=entry.review?.reviewedAt??entry.review?.approvedAt??entry.approvedAt;
  if(entry.status!=='APPROVED')reason='APPROVAL_REQUIRED';
  else if(!iso(approvedAt))reason='APPROVAL_TIME_REQUIRED';
  else if(entry.contentHash&&entry.contentHash!==contentHash)reason='SOURCE_HASH_MISMATCH';
  else if(document.scope.profileId!==manifest.scope.profileId||document.scope.instrumentIds.length!==1||document.scope.instrumentIds[0]!==binding.instrumentId||document.scope.experimentId!==null&&document.scope.experimentId!==manifest.scope.experimentId)reason='METRIC_SCOPE_MISMATCH';
  else if(document.asOf>asOf||document.availableAt>asOf||approvedAt>asOf||entry.importedAt>asOf)reason='NOT_AVAILABLE';
  else if(document.data.validUntil!==null&&document.data.validUntil<asOf)reason='EXPIRED';
  if(reason){excluded.push({id:document.id,reason});continue;}
  for(const observation of matching){
   const availableAt=maxTime(document.availableAt,observation.availableAt,approvedAt,entry.importedAt),normalized=normalizeQuantMetric(metric.id,observation.value,observation.unit);
   const period=observation.fiscalPeriod??null;
   let missing=normalized.missing[0]??null;
   if(observation.asOf>asOf||availableAt>asOf)missing='NOT_AVAILABLE';
   else if(metric.fiscalPeriodRequired&&!period)missing='FISCAL_PERIOD_REQUIRED';
   else if(period&&period.endAt>observation.asOf)missing='FISCAL_PERIOD_NOT_ENDED';
   else if(binding.maxAgeMs!==undefined&&Date.parse(asOf)-Date.parse(observation.asOf)>binding.maxAgeMs)missing='METRIC_STALE';
   else if(![document.source.id,...document.provenance.recordRefs].includes(observation.sourceRef))missing='SOURCE_REFERENCE_REQUIRED';
   if(missing){excluded.push({id:document.id,reason:missing});continue;}
   candidates.push({...normalized,metricId:metric.id,catalogVersion:QUANT_INPUT_CATALOG_VERSION,instrumentId:binding.instrumentId,asOf:observation.asOf,availableAt,fiscalPeriod:clone(period),sourceRefs:[{id:document.id,contentHash,sourceRef:observation.sourceRef,observationHash:hashInputPackage(observation),sourceUri:document.source.uri}],missing:[]});
  }
 }
 candidates.sort((a,b)=>b.asOf.localeCompare(a.asOf)||b.availableAt.localeCompare(a.availableAt)||a.sourceRefs[0].id.localeCompare(b.sourceRefs[0].id));
 return candidates.length?{...candidates[0],excluded}:{...blocked(asOf,...(excluded.length?excluded.map(item=>item.reason):['METRIC_OBSERVATION_REQUIRED'])),metricId:metric.id,instrumentId:binding.instrumentId,excluded};
}

function scopedDocuments(entries,manifest,instrumentId,asOf,kinds){return entries.flatMap(entry=>{
 const doc=entry?.document;try{assertMindDocument(doc);}catch{return [];}
 const approvedAt=entry.review?.reviewedAt??entry.review?.approvedAt??entry.approvedAt;
 if(entry.status!=='APPROVED'||!iso(approvedAt)||approvedAt>asOf||doc.availableAt>asOf||doc.asOf>asOf||entry.importedAt>asOf||!kinds.includes(doc.kind)||doc.scope.profileId!==manifest.scope.profileId||doc.scope.instrumentIds.length&&!doc.scope.instrumentIds.includes(instrumentId)||doc.scope.experimentId!==null&&doc.scope.experimentId!==manifest.scope.experimentId||doc.data.validUntil&&doc.data.validUntil<asOf)return [];
 const contentHash=mindDocumentHash(doc);if(entry.contentHash&&entry.contentHash!==contentHash)return [];
 return [{id:doc.id,value:clone(doc.data),asOf:doc.asOf,availableAt:maxTime(doc.availableAt,approvedAt,entry.importedAt),contentHash,sourceRef:doc.source.id}];
}).sort((a,b)=>b.availableAt.localeCompare(a.availableAt)||a.id.localeCompare(b.id)).slice(0,16);}
function legacyMemories(entries,manifest,asOf){return entries.flatMap(entry=>{
 const memory=entry?.document??entry,id=memory?.candidateId??memory?.id;
 if(memory?.kind||typeof id!=='string'||typeof memory.title!=='string'||typeof memory.text!=='string'||!iso(memory.approvedAt)||!iso(memory.availableAt)||memory.approvedAt>memory.availableAt||memory.availableAt>asOf||memory.investmentProfileId&&memory.investmentProfileId!==manifest.scope.profileId||memory.experimentId!==undefined&&memory.experimentId!==manifest.scope.experimentId)return [];
 if(memory.deploymentId&&memory.deploymentId!==manifest.source.id&&!memory.authorizations?.some(a=>a.deploymentId===manifest.source.id&&a.experimentId===manifest.scope.experimentId&&iso(a.authorizedAt)&&a.authorizedAt<=asOf))return [];
 return [{id,value:clone(memory),asOf:memory.approvedAt,availableAt:memory.availableAt,contentHash:hashInputPackage(memory),sourceRef:id}];
});}

export function resolveStrategyGraphInputs({graph,manifest,account=null,market=null,bars=[],dailyBars=[],daily=dailyBars,contexts=[],memories=[],knowledge=[],asOf,contextAsOf=asOf,historicalReplay=null,source=market?.source??{},trigger='manual',instrumentBinding=null,selection=null,campaign=null,hourlyValueSnapshot=null,executionInstrumentId=null,barsTimeframe=market?.timeframe??'4h',dataCatalog=[]}={}){
 if(!iso(asOf)||!iso(contextAsOf)||contextAsOf<asOf||!['manual','closed_bar'].includes(trigger))throw new TypeError('확정 입력 시각과 지원 트리거를 확인하세요.');
 const output={};
 for(const original of graph?.nodes??[]){if(original.type!=='INPUT')continue;const resolution=resolveQueryParameters(graph,original,{executionInstrumentId:executionInstrumentId??market?.instrument?.id??instrumentBinding?.instrumentId});if(!resolution.ready){output[original.id]=blocked(asOf,...resolution.missing);continue;}const node=resolution.node,rawBinding=node.config.binding??node.config,binding=rawBinding.instrumentId==='execution:current'?{...rawBinding,instrumentId:executionInstrumentId??market?.instrument?.id}:effectiveStrategyInputBinding(rawBinding,resolution.bindings.some(b=>b.field==='instrumentId')?null:instrumentBinding);if(binding.enabled===false){output[node.id]={ready:false,missing:['INPUT_DISABLED']};continue;}
  if(binding.kind==='CONTEXT'&&binding.instrumentId==='hourly-value:upbit:state'){
   const value=hourlyValueSnapshot,valid=value?.contractVersion==='hourly-value-input-v1'&&value.asOf===contextAsOf&&value.account?.profileId===manifest.scope.profileId&&Array.isArray(value.markets)&&value.markets.every(m=>manifest.data.universe.instrumentIds.includes('crypto:upbit:'+m.market));
   const digest=valid?hashInputPackage(value):null;output[node.id]=valid?{ready:true,value:clone(value),asOf:contextAsOf,availableAt:contextAsOf,sourceRefs:[{id:'hourly-value-'+digest.slice(0,24),contentHash:digest,sourceRef:'assigned-account-and-market-snapshot'}],missing:[]}:blocked(contextAsOf,'HOURLY_VALUE_SNAPSHOT_REQUIRED');continue;
  }
  if(!manifest?.data.universe.instrumentIds.includes(binding.instrumentId)){output[node.id]=blocked(asOf,'INPUT_OUTSIDE_UNIVERSE');continue;}
  if(binding.kind==='METRIC'){output[node.id]=resolveQuantMetric({binding,manifest,contexts,asOf:contextAsOf});continue;}
  if(binding.kind==='KNOWLEDGE'){
   const result=selectMarketKnowledge(knowledge,manifest,getInstrument(binding.instrumentId),contextAsOf,{historicalReplay}),values=result.selected.filter(value=>binding.maxAgeMs===undefined||Date.parse(contextAsOf)-Date.parse(value.asOf)<=binding.maxAgeMs);
   output[node.id]=values.length?{ready:true,value:clone(values),unit:'documents',asOf:maxTime(...values.map(v=>v.asOf)),availableAt:maxTime(...values.map(v=>v.availableAt)),sourceRefs:values.map(({id,contentHash,source})=>({id,contentHash,sourceRef:source?.id??id})),missing:[],selectionPolicy:result.policy,excluded:result.excluded}:{...blocked(contextAsOf,'KNOWLEDGE_DOCUMENT_REQUIRED'),excluded:result.excluded};continue;
  }
  if(binding.kind==='OHLCV'){
   const catalog=dataCatalog.find(s=>s.instrumentId===binding.instrumentId&&s.timeframe===binding.timeframe),baseInstrumentId=market?.instrument?.id??instrumentBinding?.instrumentId??manifest.data.strategyPlan?.scope.instrumentId,matched=!!catalog||binding.instrumentId===baseInstrumentId;
   const interval=binding.timeframe==='1d'?DAY:binding.timeframe==='4h'?FOUR:binding.timeframe==='1m'?60000:binding.timeframe==='1h'?3600000:null;
   if(!interval){output[node.id]=blocked(asOf,'INPUT_TIMEFRAME_UNSUPPORTED');continue;}
   if(!matched){output[node.id]=blocked(asOf,dataCatalog.some(s=>s.instrumentId===binding.instrumentId)?'OHLCV_TIMEFRAME_MISMATCH':'OHLCV_INSTRUMENT_MISMATCH');continue;}
   if(resolution.bindings.length&&!catalog&&binding.timeframe!=='1d'&&binding.timeframe!==barsTimeframe){output[node.id]=blocked(asOf,'OHLCV_TIMEFRAME_MISMATCH');continue;}
   const raw=catalog?.bars??(binding.timeframe==='1d'?daily:bars),inputSource=catalog?.source??source,allClosed=raw.filter(bar=>Array.isArray(bar)&&bar.length>=6&&bar.slice(0,6).every(Number.isFinite)&&bar[0]+interval<=Date.parse(asOf)),closed=(binding.lookbackBars?allClosed.slice(-binding.lookbackBars):allClosed).map(bar=>clone(bar));
   const stamp=closed.length?new Date(closed.at(-1)[0]+interval).toISOString():null,sourceHash=inputSource.datasetSha256??inputSource.rawSha256??inputSource.barsSha256;
   const boundary=new Date(Math.floor(Date.parse(asOf)/interval)*interval).toISOString();
   if(resolution.bindings.length&&binding.lookbackBars&&closed.length<binding.lookbackBars){output[node.id]=blocked(asOf,'OHLCV_HISTORY_REQUIRED');continue;}
   if(!closed.length||stamp!==boundary||!hash(sourceHash)){output[node.id]=blocked(asOf,!closed.length?'CLOSED_BARS_REQUIRED':stamp!==boundary?'LATEST_CLOSED_BAR_REQUIRED':'SOURCE_HASH_REQUIRED');continue;}
   output[node.id]={ready:true,value:{bars:closed,dailyBars:(catalog?.dailyBars??daily).filter(bar=>bar[0]+DAY<=Date.parse(asOf)&&(!binding.lookbackBars||bar[0]>=closed[0][0])).map(bar=>clone(bar))},unit:'OHLCV',instrumentId:binding.instrumentId,timeframe:binding.timeframe,asOf:stamp,availableAt:binding.timeframe==='1h'||resolution.bindings.length?maxTime(stamp,inputSource.availableAt,inputSource.receivedAt):stamp,sourceRefs:[{id:inputSource.marketDataRef??'archived-bars-'+sourceHash.slice(0,24),contentHash:sourceHash,sourceRef:inputSource.marketDataRef??'public-archive',receivedAt:inputSource.receivedAt??null,availabilityBasis:'CLOSED_BAR_BOUNDARY',observedBarsHash:hashInputPackage(closed)}],missing:[]};continue;
  }
  if(binding.kind==='CAMPAIGN'){output[node.id]=resolveCampaignInput(binding,{campaign,profileId:manifest.scope.profileId,accountId:account?.id,asOf:contextAsOf});continue;}
  if(binding.kind==='POSITION'){output[node.id]=resolvePositionInput({binding,account,profileId:manifest.scope.profileId,asOf:contextAsOf});continue;}
  if(binding.kind==='SELECTION'){
   output[node.id]=selection?.selectedInstrumentIds?.some(id=>!manifest.data.universe.instrumentIds.includes(id))?blocked(asOf,'SELECTION_OUTSIDE_UNIVERSE'):resolveSelectionInput(binding,{selection,profileId:manifest.scope.profileId,asOf});continue;
  }
  if(['CONTEXT','MEMORY'].includes(binding.kind)){
   const documents=scopedDocuments(binding.kind==='CONTEXT'?contexts:memories,manifest,binding.instrumentId,contextAsOf,binding.kind==='CONTEXT'?['market-context']:['trade-review','principle-evidence']);
   const values=[...documents,...(binding.kind==='MEMORY'?legacyMemories(memories,manifest,contextAsOf):[])].filter(value=>binding.maxAgeMs===undefined||Date.parse(contextAsOf)-Date.parse(value.asOf)<=binding.maxAgeMs).sort((a,b)=>b.availableAt.localeCompare(a.availableAt)||a.id.localeCompare(b.id)).slice(0,16);
   output[node.id]=values.length?{ready:true,value:values,unit:'documents',asOf:maxTime(...values.map(v=>v.asOf)),availableAt:maxTime(...values.map(v=>v.availableAt)),sourceRefs:values.map(({id,contentHash,sourceRef})=>({id,contentHash,sourceRef})),missing:[]}:{...blocked(contextAsOf,binding.kind+'_DOCUMENT_REQUIRED')};continue;
  }
  output[node.id]=blocked(asOf,'INPUT_KIND_UNSUPPORTED');
 }
 for(const node of graph?.nodes??[])if(output[node.id]){const resolution=resolveQueryParameters(graph,node,{executionInstrumentId:executionInstrumentId??market?.instrument?.id??instrumentBinding?.instrumentId});if(resolution.ready)output[node.id]=bindPreparedInput(output[node.id],resolution);}
 return compactGraphInputs(output,{graph});
}
