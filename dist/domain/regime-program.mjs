import {regimeGraphDefinition} from './regime-program-graph.mjs';
import {hashInputPackage as hash} from './workspace.mjs';
import {assertStrategyModel,assertMindPreset,strategyModelPin} from './strategy-model.mjs';
import {getInstrument} from './instruments.mjs';

const copy=structuredClone;
const check=(ok,code,message)=>{if(!ok)throw Object.assign(new Error(message),{code,status:400});};
const stamp=v=>typeof v==='string'&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString()===v;
export const REGIME_CASES=Object.freeze(['Q1_LOW','Q1_HIGH','Q2_LOW','Q2_HIGH','Q3_LOW','Q3_HIGH','Q4_LOW','Q4_HIGH']);
// Legacy axis template only; JEV programs derive their branches from their saved choice list.
export const regimeChoices=p=>p.classifier.kind==='AXES'?REGIME_CASES.map(id=>({id,label:id,description:id})):(p.classifier.choices??Object.entries(p.classifier.criteria??{}).map(([id,description])=>({id,label:id,description})));
export const regimeTargetPin=target=>target.kind==='mind-preset'?{kind:'mind-preset',id:target.id,version:1,contentHash:assertMindPreset(target).contentHash}:strategyModelPin(target);
export function regimeTargetMembers(target){return target.kind==='mind-preset'?assertMindPreset(target).minds.map(m=>({id:m.sourceProfileId,name:m.name,manifest:copy(m.manifest)})):[{id:target.id,name:target.name,manifest:copy(assertStrategyModel(target).policy)}];}
const digest=value=>hash(Object.fromEntries(Object.entries(value).filter(([key])=>key!=='contentHash')));

/** Axis meanings and thresholds are part of the saved program, never an engine guess. */
export function createRegimeProgram({id,name,classifier,routes,createdAt,handover='DRAIN',minimumDwellMs=0,graph=null,version=1,previousVersion=null}){
 const c=copy(classifier);if(c?.choices)c.criteria=Object.fromEntries(c.choices.map(v=>[v.id,v.description]));
 const value={schemaVersion:1,kind:'regime-program',id,name,classifier:c,routes:copy(routes),createdAt,handover,minimumDwellMs,version,previousVersion:copy(previousVersion),...(graph?{graph:copy(graph)}:{})};value.contentHash=digest(value);return assertRegimeProgram(value);
}
export function assertRegimeProgram(p){
 check(p?.schemaVersion===1&&p.kind==='regime-program'&&typeof p.id==='string'&&p.id.length>0&&typeof p.name==='string'&&p.name.length>0&&stamp(p.createdAt)&&p.contentHash===digest(p),'REGIME_PROGRAM_HASH','국면 라우터 원문과 저장 해시를 확인하세요.');
 check(p.handover==='DRAIN'&&Number.isSafeInteger(p.minimumDwellMs)&&p.minimumDwellMs>=0,'REGIME_HANDOVER','기존 전략이 자기 보유를 정리한 뒤 다음 전략으로 인계합니다.');
 check(p.version===undefined||Number.isSafeInteger(p.version)&&p.version>=1,'REGIME_VERSION','라우터 버전을 확인하세요.');
 if(p.previousVersion)check(typeof p.previousVersion.id==='string'&&p.previousVersion.id.length>0&&Number.isSafeInteger(p.previousVersion.version)&&p.previousVersion.version===(p.version??1)-1&&/^[a-f0-9]{64}$/.test(p.previousVersion.contentHash),'REGIME_VERSION','이전 라우터 버전 원문을 확인하세요.');
 if(p.graph)check(hash(regimeGraphDefinition(p.graph))===hash({classifier:p.classifier,routes:p.routes,handover:p.handover,minimumDwellMs:p.minimumDwellMs}),'REGIME_GRAPH_BINDING','저장한 노드 연결과 국면 정의를 대조하세요.');
 const c=p.classifier;check(['AXES','JEV','FIXED'].includes(c?.kind)&&Number.isSafeInteger(c.periodMs)&&c.periodMs>0&&Number.isSafeInteger(c.maxAgeMs)&&c.maxAgeMs>=0,'REGIME_CLASSIFIER','판단 종류·갱신 주기·자료 신선도를 지정하세요.');
 if(c.kind==='AXES')for(const axis of ['x','y'])check(typeof c[axis]?.input==='string'&&c[axis].input.length>0&&typeof c[axis].label==='string'&&c[axis].label.length>0&&Number.isFinite(c[axis].center)&&Number.isFinite(c[axis].scale)&&c[axis].scale>0,'REGIME_AXIS','두 축의 입력·의미·중심·정규화 단위를 연결하세요.');
 if(c.kind==='AXES')check(Number.isFinite(c.highIntensity)&&c.highIntensity>0,'REGIME_INTENSITY','정규화 거리의 강도 경계를 지정하세요.');
 const choices=regimeChoices(p),keys=choices.map(v=>v.id);
 if(c.kind==='FIXED')check(choices.length===1&&choices[0].id==='fixed'&&Array.isArray(c.inputs)&&c.inputs.length===0,'REGIME_FIXED_TARGET','저장한 묶음 전체를 고정 실행 대상으로 연결하세요.');
 for(const [key,binding]of Object.entries(c.inputBindings??{})){const instrument=getInstrument(binding.instrumentId);check((c.kind==='AXES'?[c.x.input,c.y.input]:c.inputs).includes(key)&&Object.keys(binding).every(k=>['kind','instrumentId','timeframe','lookbackBars'].includes(k))&&binding.kind==='MARKET'&&instrument.timeframes.includes(binding.timeframe)&&Number.isSafeInteger(binding.lookbackBars)&&binding.lookbackBars>=2&&binding.lookbackBars<=(instrument.assetClass==='crypto'?999:299),'REGIME_INPUT_BINDING','입력 출처의 종목·봉 주기·조회 개수를 확인하세요.');}
 if(c.kind==='JEV')check(typeof c.nodeId==='string'&&c.nodeId.length>0&&Array.isArray(c.inputs)&&c.inputs.length>0&&new Set(c.inputs).size===c.inputs.length&&c.inputs.every(i=>typeof i==='string'&&i.length>0)&&typeof c.question==='string'&&c.question.trim().length>0&&choices.length>=2&&choices.length<=32&&new Set(keys).size===keys.length&&choices.every(v=>/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(v.id)&&typeof v.label==='string'&&v.label.trim().length>0&&typeof v.description==='string'&&v.description.trim().length>0&&v.description===c.criteria?.[v.id])&&Object.keys(c.criteria??{}).length===keys.length,'REGIME_JEV_INPUTS','고유한 선택지 ID·이름·판단 기준과 연결할 자료를 지정하세요.');
 check(p.routes&&Object.keys(p.routes).length===keys.length&&keys.every(k=>p.routes[k]&&(!p.routes[k].kind||p.routes[k].kind==='mind-preset')&&typeof p.routes[k].id==='string'&&Number.isSafeInteger(p.routes[k].version)&&p.routes[k].version>=1&&/^[a-f0-9]{64}$/.test(p.routes[k].contentHash)),'REGIME_ROUTES','선택지마다 사용할 전략·묶음 버전을 연결하세요.');return p;
}
export function resolveRegimeModel(program,caseId,models){
 assertRegimeProgram(program);check(regimeChoices(program).some(v=>v.id===caseId),'REGIME_CHOICE','등록한 선택지 중 하나를 선택하세요.');const pin=program.routes[caseId],model=models.find(m=>m.id===pin.id&&(m.version??1)===pin.version&&m.contentHash===pin.contentHash);check(model,'REGIME_MODEL_PIN','연결한 전략·묶음 버전의 원문을 찾을 수 없습니다.');if(pin.kind==='mind-preset')assertMindPreset(model);else assertStrategyModel(model);return model;
}
export function regimeInputs(program,inputs,now){
 assertRegimeProgram(program);check(stamp(now),'REGIME_CLOCK','판단 시각을 확인하세요.');const c=program.classifier,keys=c.kind==='AXES'?[c.x.input,c.y.input]:c.inputs,selected={};
 for(const key of keys){const value=inputs[key];check(value&&stamp(value.asOf)&&stamp(value.availableAt)&&value.asOf<=value.availableAt&&value.availableAt<=now&&Date.parse(now)-Date.parse(value.asOf)<=c.maxAgeMs&&/^[a-f0-9]{64}$/.test(value.sourceHash??''),'REGIME_INPUT_TIME','연결된 입력의 공개 시각·신선도·출처를 확인하세요.');selected[key]=copy(value);}return selected;
}
export function classifyRegimeAxes(program,inputs,now){
 const values=regimeInputs(program,inputs,now),c=program.classifier;check(c.kind==='AXES','REGIME_CLASSIFIER','숫자 축 판단기를 선택하세요.');
 const axis=a=>{const v=values[a.input].value;check(Number.isFinite(v),'REGIME_AXIS_VALUE','축에 숫자 입력을 연결하세요.');return (v-a.center)/a.scale;},x=axis(c.x),y=axis(c.y),quadrant=x>=0?(y>=0?1:4):(y>=0?2:3),intensity=Math.hypot(x,y);
 return {caseId:'Q'+quadrant+'_'+(intensity>=c.highIntensity?'HIGH':'LOW'),asOf:now,inputHash:hash(values),evidence:{x,y,intensity,axes:{x:c.x.label,y:c.y.label}}};
}
const clear=own=>!own.hasPosition&&!own.hasOpenOrders&&!own.hasUnknownOrders&&!own.providerPending;
/** Persist this result before executing. A flat ledger is the strategy ownership boundary. */
export function advanceRegimeProgram({program,state=null,classification,own,now,models}){
 assertRegimeProgram(program);check(stamp(now)&&own&&['hasPosition','hasOpenOrders','hasUnknownOrders','providerPending'].every(k=>typeof own[k]==='boolean'),'REGIME_LEDGER','계좌의 보유·주문·미확정 상태를 대조하세요.');
 if(state)check(state.programHash===program.contentHash&&state.updatedAt<=now,'REGIME_STATE_PIN','저장된 국면과 라우터 버전을 대조하세요.');
 const next=state?copy(state):{schemaVersion:1,programHash:program.contentHash,active:null,pending:null,epoch:0,classification:null,updatedAt:now};
 if(classification){check(stamp(classification.asOf)&&classification.asOf<=now&&(!next.classification||classification.asOf>=next.classification.asOf)&&Date.parse(now)-Date.parse(classification.asOf)<=program.classifier.periodMs&&/^[a-f0-9]{64}$/.test(classification.inputHash??''),'REGIME_CLASSIFICATION_TIME','유효한 새 국면 판단 원문을 연결하세요.');resolveRegimeModel(program,classification.caseId,models);next.classification=copy(classification);}
 if(next.classification){const model=resolveRegimeModel(program,next.classification.caseId,models),desired={caseId:next.classification.caseId,model:regimeTargetPin(model)};
  if(next.active&&hash(next.active.model)===hash(desired.model)){next.active.caseId=desired.caseId;next.pending=null;}
  else next.pending=desired;
 }
 const unsettled=!clear(own),dwell=next.active&&Date.parse(now)-Date.parse(next.active.since)<program.minimumDwellMs;
 if(next.pending&&!unsettled&&!dwell){next.active={...next.pending,since:now};next.pending=null;next.epoch++;}
 const classificationExpired=!next.classification||Date.parse(now)-Date.parse(next.classification.asOf)>=program.classifier.periodMs;
 next.phase=!next.active?'WAIT_CLASSIFICATION':next.pending?'DRAINING':classificationExpired?'CLASSIFICATION_DUE':'ACTIVE';next.updatedAt=now;
 return {state:next,activeModel:next.active?resolveRegimeModel(program,next.active.caseId,models):null,allowEntry:next.phase==='ACTIVE'&&!own.hasUnknownOrders&&!own.providerPending,continueExit:!!next.active,selectionHash:hash({programHash:program.contentHash,active:next.active,epoch:next.epoch}),needsClassification:classificationExpired};
}
