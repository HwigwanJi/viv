import {hashInputPackage} from './workspace.mjs';
import {getInstrument} from './instruments.mjs';

const clone=structuredClone,HASH=/^[a-f0-9]{64}$/;
const plain=v=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.getPrototypeOf(v)===Object.prototype;
const check=(ok,code,message)=>{if(!ok){const error=new Error(message);error.code=code;error.status=409;throw error;}};
const ohlcv=value=>plain(value)&&Array.isArray(value.bars)&&Array.isArray(value.dailyBars);
const kind=(graph,id)=>graph?.nodes?.find(n=>n.id===id)?.config?.kind;

/** A universe selection changes runtime identity while the saved template stays immutable. */
export function effectiveStrategyInputBinding(binding,instrumentBinding){
 check(plain(binding),'GRAPH_INPUT_BINDING','입력 자료의 연결 설정을 확인하세요.');
 if(instrumentBinding===undefined||instrumentBinding===null)return clone(binding);
 check(plain(instrumentBinding)&&Object.keys(instrumentBinding).sort().join(',')==='instrumentId,policy,templateInstrumentId'&&instrumentBinding.policy==='UNIVERSE_CURRENT','GRAPH_INSTRUMENT_BINDING','투자 범위에서 선택한 실행 종목의 연결 정책을 확인하세요.');
 try{for(const key of ['templateInstrumentId','instrumentId'])check(typeof instrumentBinding[key]==='string'&&getInstrument(instrumentBinding[key]).id===instrumentBinding[key],'GRAPH_INSTRUMENT_BINDING','실행 종목의 정식 식별값을 확인하세요.');}catch(error){if(error.code==='GRAPH_INSTRUMENT_BINDING')throw error;check(false,'GRAPH_INSTRUMENT_BINDING','실행 종목의 정식 식별값을 확인하세요.');}
 return binding.instrumentId===instrumentBinding.templateInstrumentId?{...clone(binding),instrumentId:instrumentBinding.instrumentId}:clone(binding);
}

/** Store identical OHLCV values once. Each INPUT keeps its own provenance and time metadata. */
export function compactGraphInputs(inputs,{graph}={}){
 check(plain(inputs)&&Object.keys(inputs).length<=32,'GRAPH_INPUT_REFERENCE_SCHEMA','그래프 입력 목록과 최대 노드 수를 확인하세요.');
 const next=clone(inputs),values=new Map();
 for(const [id,input] of Object.entries(next)){
  if(!plain(input)||input.ready!==true||input.unit!=='OHLCV'||!ohlcv(input.value)||(graph&&kind(graph,id)!=='OHLCV'))continue;
  check(!Object.hasOwn(input,'valueRef'),'GRAPH_INPUT_REFERENCE_SCHEMA','입력 원문과 참조 중 하나를 저장하세요.');
  const valueHash=hashInputPackage(input.value),first=values.get(valueHash);
  if(first){delete input.value;input.valueRef={nodeId:first,valueHash};}else values.set(valueHash,id);
 }
 return next;
}

/** Materialization preserves the requesting node's metadata; only its value is resolved. */
export function resolveGraphInput(inputs,nodeId,{graph}={}){
 check(plain(inputs),'GRAPH_INPUT_REFERENCE_SCHEMA','그래프 입력 원문 목록을 확인하세요.');
 const visited=new Set();
 function visit(id){
  check(!visited.has(id),'GRAPH_INPUT_REFERENCE_CYCLE','입력 원문 참조의 순환을 해제하세요.');visited.add(id);
  const input=inputs[id];if(input===undefined&&id===nodeId)return undefined;
  check(plain(input),'GRAPH_INPUT_REFERENCE_MISSING','참조한 입력 원문을 함께 보관하세요.');
  if(!Object.hasOwn(input,'valueRef'))return clone(input);
  const ref=input.valueRef;
  check(!Object.hasOwn(input,'value')&&plain(ref)&&Object.keys(ref).length===2&&typeof ref.nodeId==='string'&&HASH.test(ref.valueHash??''),'GRAPH_INPUT_REFERENCE_SCHEMA','입력 참조의 노드와 원문 해시를 확인하세요.');
  check(input.unit==='OHLCV'&&(!graph||kind(graph,id)==='OHLCV'&&kind(graph,ref.nodeId)==='OHLCV'),'GRAPH_INPUT_REFERENCE_TYPE','같은 OHLCV 입력 종류의 원문을 참조하세요.');
  const original=visit(ref.nodeId);
  check(original?.unit==='OHLCV'&&ohlcv(original.value),'GRAPH_INPUT_REFERENCE_TYPE','참조한 OHLCV 원문의 자료형을 확인하세요.');
  check(hashInputPackage(original.value)===ref.valueHash,'GRAPH_INPUT_REFERENCE_HASH','참조한 입력 원문과 저장 해시를 대조하세요.');
  const {valueRef,...metadata}=clone(input);return {...metadata,value:clone(original.value)};
 }
 return visit(nodeId);
}

export function materializeGraphInputs(inputs,nodeIds=Object.keys(inputs),options={}){
 const ids=[...nodeIds];check(ids.length<=32&&new Set(ids).size===ids.length,'GRAPH_INPUT_REFERENCE_SCHEMA','연결된 입력 노드를 한 번씩 선택하세요.');
 return Object.fromEntries(ids.map(id=>[id,resolveGraphInput(inputs,id,options)]));
}
