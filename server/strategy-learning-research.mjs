import {hashInputPackage} from '../dist/domain/workspace.mjs';
import {mindDocumentHash} from '../dist/domain/mind-manifest.mjs';
import {marketKnowledgeHash} from '../dist/domain/market-knowledge.mjs';

const CONTRACT='EXTERNAL_RESEARCH_PROTOCOL_V1',HASH=/^[a-f0-9]{64}$/,ID=/^[a-zA-Z0-9][a-zA-Z0-9_.:@/-]{0,199}$/;
const clone=structuredClone,plain=v=>v&&typeof v==='object'&&!Array.isArray(v)&&[Object.prototype,null].includes(Object.getPrototypeOf(v));
const exact=(v,keys,required=keys)=>plain(v)&&Object.keys(v).every(k=>keys.includes(k))&&required.every(k=>Object.hasOwn(v,k));
const stamp=v=>typeof v==='string'&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString()===v;
const check=(ok,code,message)=>{if(!ok)throw Object.assign(new Error(message),{code,status:409});};
const first=(db,sql,...args)=>db.prepare(sql).bind(...args).first();
const all=async(db,sql,...args)=>(await db.prepare(sql).bind(...args).all()).results;
const table=async(db,name)=>!!db&&!!await first(db,"SELECT name FROM sqlite_master WHERE type='table' AND name=?",name);
const parse=value=>{try{return JSON.parse(value);}catch{check(false,'LEARNING_RESEARCH_SOURCE','저장한 연구 근거 원문을 확인하세요.');}};
const latest=(...times)=>{const present=times.filter(v=>v!==undefined&&v!==null);check(present.length&&present.every(stamp),'LEARNING_RESEARCH_TIME','근거의 실제 수신·보관 시각을 확인하세요.');return present.sort().at(-1);};
const policyHash=manifest=>mindDocumentHash(manifest);
const refKey=r=>[r.kind,r.subscriptionId??r.activationId??'',r.id].join(':');

export function assertStrategyLearningResearchInput(value){
 check(exact(value,['contractVersion','hypothesis','cutoffAt','sourceManifestHash','references'])&&value.contractVersion===CONTRACT&&typeof value.hypothesis==='string'&&value.hypothesis.trim().length>0&&value.hypothesis.length<=6000&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value.hypothesis)&&stamp(value.cutoffAt)&&HASH.test(value.sourceManifestHash),'LEARNING_RESEARCH_CONTRACT','연구 가설·기준 시각·원정책 해시를 확인하세요.');
 check(Array.isArray(value.references)&&value.references.length>=1&&value.references.length<=32,'LEARNING_RESEARCH_REFERENCES','보관한 근거를 1~32개 연결하세요.');
 for(const r of value.references){
  check(exact(r,['kind','id','contentHash','subscriptionId','activationId'],['kind','id','contentHash'])&&['MARKET_KNOWLEDGE','MIND_DOCUMENT','EVENT_PAPER_RECORD','LIVE_AUTOMATION_EVENT'].includes(r.kind)&&ID.test(r.id)&&HASH.test(r.contentHash),'LEARNING_RESEARCH_REFERENCE','근거 종류·식별자·원문 해시를 확인하세요.');
  check((r.kind==='EVENT_PAPER_RECORD'?ID.test(r.subscriptionId??''):r.subscriptionId===undefined)&&(r.kind==='LIVE_AUTOMATION_EVENT'?ID.test(r.activationId??''):r.activationId===undefined),'LEARNING_RESEARCH_REFERENCE','실제 근거의 운용 식별자를 함께 지정하세요.');
 }
 check(new Set(value.references.map(refKey)).size===value.references.length,'LEARNING_RESEARCH_DUPLICATE','같은 원문은 한 번 연결하세요.');return value;
}

export function strategyLearningResearchProtocol(){return {
 contractVersion:CONTRACT,referenceKinds:['MARKET_KNOWLEDGE','MIND_DOCUMENT','EVENT_PAPER_RECORD','LIVE_AUTOMATION_EVENT'],maximumReferences:32,maximumSourceSnapshotBytes:1048576,
 workflow:[{tool:'read_mind_catalog',purpose:'문서 양식과 마인드를 조회한다'},{tool:'read_strategy_learning',arguments:{view:'catalog'},purpose:'현재 정책·편집 가능 필드·관측 자료·실행 원장을 읽는다'},{tools:['write_market_knowledge','write_mind_document'],purpose:'뉴스·논문·장기 기억 분석 원문을 검토 초안으로 보관한다'},{tool:'create_strategy_learning',purpose:'원정책·연구 근거·후보·훈련 및 검증 기간·비용을 고정한다'},{tool:'step_strategy_learning',purpose:'같은 실행 그래프로 훈련 후보를 비교한 뒤 기준과 선택 후보만 검증한다'},{tool:'adopt_strategy_learning',purpose:'검증을 통과한 정확한 후보를 새 정책 초안으로 저장한다'}],
 authority:'DRAFT_ONLY',publication:'APP_REVIEW',evidenceClass:'RETROSPECTIVE_DEVELOPMENT',historicalDecisionInput:false,forwardValidation:'REQUIRED',maximumCandidates:12,
 researchAvailability:'SOURCE_AVAILABLE_AT_AT_OR_BEFORE_RESEARCH_CUTOFF',decisionAvailability:'FROZEN_APPROVED_INPUTS_AVAILABLE_AT_EACH_DECISION',
 executionMemory:{kind:'market-context',category:'flow',sourceUri:null,sourceId:'STORED_EXECUTION_RECORD_ID',observationSourceRef:'STORED_EXECUTION_RECORD_ID',provenance:{recordRefs:'REFERENCED_STORED_EXECUTION_RECORD_IDS',contentHashes:'MATCHING_STORED_EXECUTION_CONTENT_HASHES'},sourceScope:'SAME_OWNER_MIND_AND_CURRENT_MANIFEST',scope:'EXACT_REFERENCED_TRADE_INSTRUMENTS',availability:'RECEIVED_AT_NOT_AFTER_OBSERVATION_AVAILABLE_AT_AND_DOCUMENT_ASOF'},
 selection:'TRAIN_ONLY_THEN_BASELINE_AND_SELECTED_HOLDOUT',trialAccounting:'ALL_CANDIDATES_AND_PREVIOUS_SESSION_LINEAGE',automaticLiveActivation:false,
};}

async function storedExecutionReference({db,owner,manifest,reference}){
 const paper=reference.kind==='EVENT_PAPER_RECORD',headTable=paper?'event_paper_subscriptions':'live_automation_activations',events=paper?'event_paper_events':'live_automation_events',key=paper?'subscription_id':'activation_id',container=paper?reference.subscriptionId:reference.activationId;
 check(await table(db,headTable)&&await table(db,events),'LEARNING_RESEARCH_SOURCE','해당 운용의 저장 원문이 필요합니다.');
 const head=await first(db,`SELECT body FROM ${headTable} WHERE owner_id=? AND id=?`,owner,container),row=await first(db,`SELECT id,kind,${paper?'at':'recorded_at'} AS available_at,body FROM ${events} WHERE owner_id=? AND ${key}=? AND id=?`,owner,container,reference.id);
 check(head&&row,'LEARNING_RESEARCH_SOURCE','같은 사용자의 실제 운용 원문을 선택하세요.');const h=parse(head.body),document=parse(row.body),pins=paper?h.pins:h.config;
 check((paper?h.profileId:h.config?.profileId)===manifest.scope.profileId&&pins?.manifestId===manifest.id&&pins?.manifestHash===policyHash(manifest),'LEARNING_RESEARCH_POLICY','근거의 마인드와 고정 정책을 연구 대상과 일치시키세요.');
 return {document,availableAt:latest(row.available_at,document.source?.receivedAt,document.reconciliation?.source?.receivedAt),title:row.kind,scope:{profileId:manifest.scope.profileId,manifestId:manifest.id,manifestHash:pins.manifestHash,[paper?'subscriptionId':'activationId']:container}};
}

export async function resolveStrategyLearningResearch({db,owner,workspace,sourceManifest,research,createdAt}){
 if(research===undefined||research===null)return null;assertStrategyLearningResearchInput(research);
 check(typeof owner==='string'&&owner.length>0&&stamp(createdAt)&&research.cutoffAt<=createdAt,'LEARNING_RESEARCH_CUTOFF','연구 시각까지 실제 보관된 근거를 선택하세요.');
 check(research.sourceManifestHash===policyHash(sourceManifest),'LEARNING_RESEARCH_POLICY','현재 원정책 해시를 고정한 뒤 연구를 시작하세요.');
 const references=[],sourceSnapshots=[];let sourceBytes=0;
 for(const r of research.references){
  let value,contentHash,status;
  if(r.kind==='MARKET_KNOWLEDGE'||r.kind==='MIND_DOCUMENT'){
   const knowledge=r.kind==='MARKET_KNOWLEDGE',entry=(workspace[knowledge?'marketKnowledge':'mindDocuments']??[]).find(e=>e.id===r.id);check(entry?.document,'LEARNING_RESEARCH_SOURCE','보관한 자료 원문을 먼저 저장하세요.');
   const document=entry.document;contentHash=knowledge?marketKnowledgeHash(document):mindDocumentHash(document);
   check(!entry.contentHash||entry.contentHash===contentHash,'LEARNING_RESEARCH_HASH','자료의 저장 원문과 해시를 대조하세요.');
   check(!document.scope?.profileId||document.scope.profileId===sourceManifest.scope.profileId,'LEARNING_RESEARCH_SCOPE','현재 마인드에 속한 분석 자료를 선택하세요.');
   value={document,availableAt:latest(document.availableAt,entry.availableAt,entry.importedAt),title:document.title??document.data?.title??document.kind,scope:clone(document.scope??{})};status=entry.status;
  }else value=await storedExecutionReference({db,owner,manifest:sourceManifest,reference:r});
  contentHash??=hashInputPackage(value.document);check(contentHash===r.contentHash,'LEARNING_RESEARCH_HASH','연구에 사용한 원문 해시를 다시 확인하세요.');
  check(value.availableAt<=research.cutoffAt,'LEARNING_RESEARCH_FUTURE','연구 기준 시각 이후에 들어온 자료를 제외하세요.');
  references.push({...clone(r),availableAt:value.availableAt,title:value.title??r.id,scope:value.scope,reviewStatus:status??'STORED_EXECUTION',role:'RESEARCH_BASIS'});
  sourceBytes+=new TextEncoder().encode(JSON.stringify(value.document)).length;check(sourceBytes<=1048576,'LEARNING_RESEARCH_SIZE','한 연구에 고정할 원문은 합계 1MiB 이내로 선택하세요.');sourceSnapshots.push({reference:clone(r),document:clone(value.document)});
 }
 const sealed={...clone(research),references,sourceSnapshots,sourceSnapshotBytes:sourceBytes,createdAt,role:'RESEARCH_BASIS',evidenceClass:'RETROSPECTIVE_DEVELOPMENT',historicalDecisionInput:false,forwardValidation:'REQUIRED'};
 return {...sealed,hash:hashInputPackage(sealed)};
}

const SCALE=10n**18n;
function units(value){check(typeof value==='string'&&/^-?\d+(?:\.\d{1,18})?$/.test(value),'LEARNING_EXECUTION_DECIMAL','체결 원장의 정확한 금액과 수량을 확인하세요.');const neg=value[0]==='-',[a,b='']=(neg?value.slice(1):value).split('.');return (BigInt(a)*SCALE+BigInt(b.padEnd(18,'0')))*(neg?-1n:1n);}
function decimal(v){const neg=v<0n;v=neg?-v:v;return (neg?'-':'')+v/SCALE+(v%SCALE?'.'+String(v%SCALE).padStart(18,'0').replace(/0+$/,''):'');}

/** Descriptive sell-fill cohorts use exact stored fills and proportionally allocated paid fees. */
function summarizeExecutions(records,{mode,containerId,quoteCurrency,completeHistory}){
 const groups=new Map(),issues=[],fills=[],positions=new Map(),cohorts=[],roundTrips=[];
 for(const r of records){
  try{
   const b=r.document,live=mode==='live';if(live&&b.purpose==='FUNDING')continue;
   const o=live?b.order:b,identifier=live?b.identifier:r.id,market=live?b.request?.market:b.market,action=live?(b.request?.side==='bid'?'buy':b.request?.side==='ask'?'sell':null):b.action;
   if(!identifier||!market||!['buy','sell'].includes(action)||!o){issues.push({id:r.id,reason:'ORDER_DETAILS_REQUIRED'});continue;}
   groups.set(identifier,{r,market,action,source:live?o.trades:o.fills,fee:live?o.paidFee:b.feesPaid,quantity:live?o.executedVolume:b.filledQuantity,tradesCount:live?o.tradesCount:undefined,state:b.state});
  }catch{issues.push({id:r.id,reason:'ORDER_DETAILS_REQUIRED'});}
 }
 for(const [identifier,g]of groups){
  try{
   const list=g.source;check(Array.isArray(list),'LEARNING_EXECUTION_DETAIL','체결 원문이 필요합니다.');let fee=units(g.fee),total=0n,q=0n;const normalized=list.map(t=>{const at=mode==='live'?t.createdAt:t.at;check(typeof t.id==='string'&&Number.isFinite(Date.parse(at))&&Date.parse(at)<=Date.parse(g.r.available_at),'LEARNING_EXECUTION_DETAIL','체결 시각을 확인하세요.');const quantity=units(mode==='live'?t.volume:t.quantity),gross=units(mode==='live'?t.funds:t.gross);check(quantity>0n&&gross>=0n,'LEARNING_EXECUTION_DETAIL','체결 수량과 금액을 확인하세요.');q+=quantity;total+=gross;return {id:t.id,at:new Date(at).toISOString(),quantity,gross};}).sort((a,b)=>a.at.localeCompare(b.at)||a.id.localeCompare(b.id));
   check(['FILLED','CANCELLED','REJECTED','CANCELLED_BEFORE_SEND'].includes(g.state)&&q===units(g.quantity)&&fee>=0n&&(g.tradesCount===undefined||g.tradesCount===normalized.length)&&new Set(normalized.map(t=>t.id)).size===normalized.length,'LEARNING_EXECUTION_DETAIL','종결된 주문의 누적 수량·수수료와 체결 상세를 대조하세요.');
   let allocated=0n;for(let i=0;i<normalized.length;i++){const t=normalized[i],part=i===normalized.length-1?fee-allocated:total?fee*t.gross/total:0n;allocated+=part;fills.push({...t,fee:part,market:g.market,action:g.action,identifier,reference:g.r.reference});}
  }catch{issues.push({id:g.r.id,reason:'INCOMPLETE_OR_INVALID_FILL_DETAILS'});}
 }
 fills.sort((a,b)=>a.at.localeCompare(b.at)||a.id.localeCompare(b.id));const seen=new Set();
 for(const f of fills){
  const key=f.market+':'+f.id;if(seen.has(key)){issues.push({id:f.id,reason:'DUPLICATE_TRADE_ID'});continue;}seen.add(key);
  const p=positions.get(f.market)??{quantity:0n,costBasis:0n,tainted:!completeHistory||issues.length>0,cycle:null};
  if(!p.cycle)p.cycle={openedAt:f.at,entryGross:0n,entryFee:0n,exitGross:0n,exitFee:0n,refs:[]};
  p.cycle.refs.push(clone(f.reference));
  let pnl=null,status='OPEN_BUY';
  if(f.action==='buy'){p.quantity+=f.quantity;p.costBasis+=f.gross+f.fee;p.cycle.entryGross+=f.gross;p.cycle.entryFee+=f.fee;}
  else if(p.tainted||p.quantity<f.quantity){p.tainted=true;status='UNKNOWN_COST_BASIS';}
  else{const removed=p.costBasis*f.quantity/p.quantity;p.quantity-=f.quantity;p.costBasis-=removed;pnl=f.gross-removed-f.fee;status=pnl<0n?'LOSS':pnl>0n?'GAIN':'FLAT';p.cycle.exitGross+=f.gross;p.cycle.exitFee+=f.fee;
   if(p.quantity===0n){const c=p.cycle,pricePnl=c.exitGross-c.entryGross,fees=c.entryFee+c.exitFee,net=pricePnl-fees;roundTrips.push({instrumentId:'crypto:upbit:'+f.market,openedAt:c.openedAt,closedAt:f.at,entryGross:decimal(c.entryGross),exitGross:decimal(c.exitGross),pricePnl:decimal(pricePnl),entryFees:decimal(c.entryFee),exitFees:decimal(c.exitFee),feesPaid:decimal(fees),netPnl:decimal(net),status:net<0n?'LOSS':net>0n?'GAIN':'FLAT',sourceRefs:[...new Map(c.refs.map(r=>[refKey(r),r])).values()]});p.cycle=null;}
  }
  positions.set(f.market,p);cohorts.push({tradeId:f.id,orderId:f.identifier,instrumentId:'crypto:upbit:'+f.market,at:f.at,side:f.action,quantity:decimal(f.quantity),gross:decimal(f.gross),fee:decimal(f.fee),realizedPnl:pnl===null?null:decimal(pnl),status,sourceRef:clone(f.reference)});
 }
 const sells=cohorts.filter(c=>c.side==='sell'),known=sells.filter(c=>c.realizedPnl!==null);
 return {mode,containerId,quoteCurrency,status:issues.length||!completeHistory||sells.some(c=>c.realizedPnl===null)?'PARTIAL':'COMPLETE',cohortUnit:'SELL_FILL',costMethod:'MOVING_AVERAGE_WITH_ACTUAL_ENTRY_AND_EXIT_FEES',coverage:{completeHistory,sourceRecordCount:records.length,distinctOrders:groups.size,fillCount:cohorts.length,closedRoundTrips:roundTrips.length},lossCount:known.filter(c=>c.status==='LOSS').length,gainCount:known.filter(c=>c.status==='GAIN').length,unknownSellCount:sells.length-known.length,realizedPnl:issues.length||!completeHistory||sells.some(c=>c.realizedPnl===null)?null:decimal(known.reduce((n,c)=>n+units(c.realizedPnl),0n)),cohorts,roundTrips,issues};
}

export async function readStrategyLearningExecutionIntake({db,owner,manifest,asOf}){
 check(stamp(asOf)&&typeof owner==='string'&&owner.length>0,'LEARNING_EXECUTION_SCOPE','사용자와 조회 시각을 확인하세요.');const manifestHash=policyHash(manifest),items=[],excluded=[];let remainingRecords=1000;
 for(const paper of [true,false]){
  const heads=paper?'event_paper_subscriptions':'live_automation_activations',events=paper?'event_paper_events':'live_automation_events',column=paper?'subscription_id':'activation_id',time=paper?'at':'recorded_at';
  if(!await table(db,heads)||!await table(db,events))continue;
  const matches=await all(db,`SELECT id,body FROM ${heads} WHERE owner_id=? ORDER BY id LIMIT 101`,owner);
  if(matches.length>100)excluded.push({kind:heads,reason:'HEAD_LIMIT',limit:100});
  for(const h of matches.slice(0,100)){
   const head=parse(h.body),pins=paper?head.pins:head.config,profileId=paper?head.profileId:head.config?.profileId;
   if(profileId!==manifest.scope.profileId||pins?.manifestId!==manifest.id||pins?.manifestHash!==manifestHash)continue;
   if(!remainingRecords){excluded.push({containerId:h.id,reason:'SOURCE_RECORD_LIMIT',limit:1000});continue;}
   const limit=remainingRecords,rows=await all(db,`SELECT id,kind,${time} AS available_at,body FROM ${events} WHERE owner_id=? AND ${column}=? AND kind=? AND ${time}<=? ORDER BY ${time},rowid LIMIT ?`,owner,h.id,paper?'STRATEGY_ORDER':'ORDER_RECEIPT',asOf,limit+1),records=[];
   for(const row of rows.slice(0,limit)){const document=parse(row.body),reference={kind:paper?'EVENT_PAPER_RECORD':'LIVE_AUTOMATION_EVENT',id:row.id,contentHash:hashInputPackage(document),[paper?'subscriptionId':'activationId']:h.id};records.push({...row,document,reference});}remainingRecords-=records.length;
   const summary=summarizeExecutions(records,{mode:paper?'paper':'live',containerId:h.id,quoteCurrency:head.config?.quoteCurrency,completeHistory:rows.length<=limit});
   items.push({...summary,sourceManifestHash:manifestHash,sourceRefs:records.map(r=>({...r.reference,availableAt:r.available_at})),sourceRecordsHash:hashInputPackage(records.map(r=>({id:r.id,contentHash:r.reference.contentHash}))) });
  }
 }
 const result={contractVersion:'MATCHED_POLICY_EXECUTION_RESEARCH_V1',asOf,profileId:manifest.scope.profileId,sourceManifestHash:manifestHash,status:excluded.length||items.some(i=>i.status==='PARTIAL')?'PARTIAL':items.some(i=>i.coverage.fillCount)?'OBSERVED':'NO_OBSERVATIONS',limits:{maximumHeadsPerMode:100,maximumSourceRecords:1000},items,excluded,role:'NEXT_CYCLE_RESEARCH_CONTEXT',rewardAuthority:'FIXED_SIMULATION_CHILD_LEDGER',evidenceClass:'RETROSPECTIVE_DEVELOPMENT',automaticWeightChange:false};
 return {...result,hash:hashInputPackage(result)};
}
