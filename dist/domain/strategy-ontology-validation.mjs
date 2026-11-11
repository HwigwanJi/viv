import {STRATEGY_ONTOLOGY_VERSION,STRATEGY_ENTITY_TYPES,STRATEGY_RELATIONS,STRATEGY_NUMBER_UNITS,STRATEGY_VALUE_TYPES,LISTING_STATUS_VALUES,assertInstrumentReference,instrumentReference} from './strategy-ontology.mjs';

export const ONTOLOGY_VALIDATION_VERSION='ontology-fact-validation-v1';
export const ONTOLOGY_VALIDATION_SCHEMA=Object.freeze({type:'object',additionalProperties:false,required:['objects','links'],properties:{objects:{type:'array',maxItems:1024,items:{type:'object'}},links:{type:'array',maxItems:4096,items:{type:'object'}},asOf:{type:'string'},complete:{type:'boolean'}}});
const plain=v=>!!v&&typeof v==='object'&&!Array.isArray(v)&&[Object.prototype,null].includes(Object.getPrototypeOf(v));
const iso=v=>typeof v==='string'&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString()===v;
const hash=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const present=v=>v!==null&&v!==undefined&&v!=='';
export function validOntologyValidationInput(input){return plain(input)&&Object.keys(input).every(k=>Object.hasOwn(ONTOLOGY_VALIDATION_SCHEMA.properties,k))&&Array.isArray(input.objects)&&input.objects.length<=1024&&Array.isArray(input.links)&&input.links.length<=4096&&(!Object.hasOwn(input,'asOf')||iso(input.asOf))&&(!Object.hasOwn(input,'complete')||typeof input.complete==='boolean');}
export function ontologyIssue(code,message,focusNode,resultPath,sourceConstraintComponent,sourceShape='StrategyOntology',severity='Violation'){
 return {code,message,severity,focusNode,resultPath,sourceConstraintComponent,sourceShape};
}

/** Inspect an explicit fact projection; never infer a listing, source, permission or missing fact. */
export function validateOntologyFacts(input){
 if(!validOntologyValidationInput(input))throw Object.assign(new TypeError('온톨로지 객체·관계와 검사 시각을 확인하세요.'),{code:'ONTOLOGY_VALIDATION_INPUT',status:400});
 const {objects,links,asOf,complete=false}=input,results=[],byId=new Map(),identities=new Map(),counts=new Map(),seen=new Set(),ancestry=new Map();
 const add=(code,message,id,path,constraint,shape)=>results.push(ontologyIssue(code,message,id,path,constraint,shape));
 for(const [index,object]of objects.entries()){
  const id=typeof object?.id==='string'?object.id:'objects:'+index;
  if(!plain(object)||Object.keys(object).some(k=>!['id','type','value'].includes(k))||typeof object.id!=='string'||!object.id||typeof object.type!=='string'||!Object.hasOwn(STRATEGY_ENTITY_TYPES,object.type)||!plain(object.value)){
   add('ONTOLOGY_OBJECT','객체의 ID·종류·값을 확인하세요.',id,[],'ObjectShapeConstraint');continue;
  }
  if(byId.has(id)){add('ONTOLOGY_DUPLICATE_ID','객체 ID를 한 번만 사용하세요.',id,['id'],'UniqueIdentityConstraint');continue;}
  byId.set(id,object);const v=object.value,shape='Entity:'+object.type;
  for(const key of STRATEGY_ENTITY_TYPES[object.type].identity)if(typeof v[key]!=='string'||!v[key])add('ONTOLOGY_REQUIRED','식별에 필요한 '+key+' 문자열을 기록하세요.',id,['value',key],'IdentityConstraint',shape);
  const keys=STRATEGY_ENTITY_TYPES[object.type].identity;
  if(keys.length&&keys.every(key=>typeof v[key]==='string'&&v[key])){const identity=JSON.stringify([object.type,...keys.map(key=>v[key])]);if(identities.has(identity))add('ONTOLOGY_DUPLICATE_IDENTITY','같은 대상의 식별값을 다른 객체 ID로 중복 기록하지 마세요.',id,['value'],'UniqueIdentityConstraint',shape);else identities.set(identity,id);}
  if(object.type==='INSTRUMENT')try{assertInstrumentReference(v);}catch{add('ONTOLOGY_INSTRUMENT_IDENTITY','종목 ID와 거래소·거래쌍·통화가 같은 종목 참조를 사용하세요.',id,['value'],'InstrumentIdentityConstraint',shape);}
  for(const key of ['asOf','decisionAt','availableAt','announcedAt','effectiveAt','effectiveUntil','publishedAt','startedAt','endedAt','trainedThrough'])if(present(v[key])&&!iso(v[key]))add('ONTOLOGY_DATE','UTC ISO 시각을 기록하세요.',id,['value',key],'DateTimeConstraint',shape);
  for(const key of ['sourceHash','modelHash'])if(present(v[key])&&!hash(v[key]))add('ONTOLOGY_HASH','원문 또는 모델의 SHA-256 해시를 기록하세요.',id,['value',key],'HashConstraint',shape);
  if(asOf&&iso(v.availableAt)&&v.availableAt>asOf)add('ONTOLOGY_FUTURE_DATA','검사 시각 이후에 알게 된 자료입니다.',id,['value','availableAt'],'AvailableTimeConstraint',shape);
  for(const [earlier,later]of [['asOf','availableAt'],['publishedAt','availableAt'],['announcedAt','availableAt'],['startedAt','endedAt'],['effectiveAt','effectiveUntil']])if(iso(v[earlier])&&iso(v[later])&&v[earlier]>v[later])add('ONTOLOGY_TIME_ORDER',earlier+'와 '+later+'의 순서를 확인하세요.',id,['value',later],'TimeOrderConstraint',shape);
  if(object.type==='OBSERVATION'){
   if(!iso(v.availableAt))add('ONTOLOGY_REQUIRED','자료를 알 수 있었던 시각을 기록하세요.',id,['value','availableAt'],'MinCountConstraint',shape);
   if(typeof v.unit!=='string'||!STRATEGY_NUMBER_UNITS.includes(v.unit)&&!Object.hasOwn(STRATEGY_VALUE_TYPES,v.unit))add('ONTOLOGY_UNIT','정의된 단위를 기록하세요.',id,['value','unit'],'UnitConstraint',shape);
  }
  if(object.type==='LISTING_STATUS'){
   if(!LISTING_STATUS_VALUES.includes(v.status))add('ONTOLOGY_LISTING_STATUS','정의된 거래 지원 상태를 사용하세요.',id,['value','status'],'EnumerationConstraint',shape);
   for(const key of ['availableAt','announcedAt'])if(!iso(v[key]))add('ONTOLOGY_REQUIRED',key+' 시각을 기록하세요.',id,['value',key],'MinCountConstraint',shape);
  }
  if(object.type==='CONDITION'&&![true,false,null].includes(v.value))add('ONTOLOGY_CONDITION','조건은 참·거짓·미확인(null)으로 기록하세요.',id,['value','value'],'ConditionValueConstraint',shape);
 }
 for(const [index,link]of links.entries()){
  const path=['links',index],rule=STRATEGY_RELATIONS.find(r=>r.id===link?.relation),from=byId.get(link?.from),to=byId.get(link?.to),shape='Relation:'+(rule?.id??'unknown');
  if(!plain(link)||Object.keys(link).some(k=>!['relation','from','to'].includes(k))||!rule){add('ONTOLOGY_RELATION','정의된 관계를 사용하세요.',link?.from??null,path,'RelationShapeConstraint',shape);continue;}
  if(!from||!to){add('ONTOLOGY_DANGLING_LINK','관계 양쪽의 객체 원문을 함께 제공하세요.',link.from,path,'ReferenceConstraint',shape);continue;}
  if(from.type!==rule.from||to.type!==rule.to){add('ONTOLOGY_RELATION_TYPE',rule.from+'에서 '+rule.to+'로 연결하세요.',from.id,path,'DomainRangeConstraint',shape);continue;}
  const edge=JSON.stringify([link.relation,link.from,link.to]),group=JSON.stringify([link.relation,link.from]);
  if(seen.has(edge)){add('ONTOLOGY_DUPLICATE_LINK','같은 관계를 중복해서 기록하지 마세요.',from.id,path,'UniqueLinkConstraint',shape);continue;}seen.add(edge);
  const count=(counts.get(group)??0)+1;counts.set(group,count);
  if(['ONE','OPTIONAL'].includes(rule.cardinality)&&count>1)add('ONTOLOGY_CARDINALITY','이 관계의 연결 대상은 하나까지입니다.',from.id,path,'MaxCountConstraint',shape);
  for(const [a,b]of rule.equalFields??[])if(!present(from.value[a])||!present(to.value[b])||from.value[a]!==to.value[b])add('ONTOLOGY_RELATION_SCOPE','관계의 '+a+'와 '+b+'가 같은 대상을 가리켜야 합니다.',from.id,path,'ScopeEqualityConstraint',shape);
  if(rule.timeOrder){const [sourceTime,targetTime]=rule.timeOrder,a=to.value[sourceTime],b=from.value[targetTime];
   if(!iso(a)||!iso(b))add('ONTOLOGY_CAUSAL_TIME_REQUIRED','이 관계의 원자료·사용 시각을 함께 기록하세요.',from.id,path,'CausalTimeConstraint',shape);
   else if(a>b)add('ONTOLOGY_CAUSAL_TIME','결과를 만든 시각에 원자료를 사용할 수 없었습니다.',from.id,path,'CausalTimeConstraint',shape);
  }
  if(rule.acyclic){const next=ancestry.get(from.id)??[];next.push(to.id);ancestry.set(from.id,next);}
 }
 if(complete)for(const object of byId.values())for(const rule of STRATEGY_RELATIONS.filter(r=>r.from===object.type&&r.cardinality==='ONE'))if(!counts.get(JSON.stringify([rule.id,object.id])))add('ONTOLOGY_REQUIRED_LINK',rule.id+' 관계를 하나 연결하세요.',object.id,['relations',rule.id],'MinCountConstraint','Relation:'+rule.id);
 const visiting=new Set(),done=new Set();
 function visit(id){if(visiting.has(id)){add('ONTOLOGY_PROVENANCE_CYCLE','자료 계보의 순환을 해제하세요.',id,['relations','DERIVED_FROM'],'AcyclicConstraint','Relation:DERIVED_FROM');return;}if(done.has(id))return;visiting.add(id);for(const next of ancestry.get(id)??[])visit(next);visiting.delete(id);done.add(id);}
 for(const id of ancestry.keys())visit(id);
 return {contractVersion:ONTOLOGY_VALIDATION_VERSION,ontologyVersion:STRATEGY_ONTOLOGY_VERSION,conforms:results.length===0,complete,asOf:asOf??null,coverage:{objects:objects.length,links:links.length,completeness:complete?'REQUIRED_RELATIONS_CHECKED':'PROVIDED_FACTS_ONLY'},results};
}

/** A legacy TEXT constant may identify an instrument only when it is a canonical instrument ID. */
export function instrumentConnectionIssue(source,target,toPort){
 if(target?.type!=='MEMBER'||toPort!=='instrument')return null;
 if(source?.type==='INPUT'&&source.config?.kind==='EXECUTION_ASSET')return null;
 if(source?.type==='VALUE'&&['TEXT','INSTRUMENT'].includes(source.config?.dataType))try{if(instrumentReference(source.config.value).id===source.config.value)return null;}catch{}
 return ontologyIssue('GRAPH_INSTRUMENT_SEMANTIC','종목 입력에는 현재 평가 종목 또는 정식 종목 식별값을 연결하세요. 일반 문자는 종목으로 사용할 수 없습니다.',target.id,['inputs',toPort],'InstrumentReferenceConstraint','Port:MEMBER.instrument');
}
