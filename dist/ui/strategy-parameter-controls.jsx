import React from 'react';
import {StrategyGlyph} from './strategy-part-card.jsx';
import {Handle,Position} from '@xyflow/react';
import {strategyParameters,parameterSpec,parameterLiteral,applyParameterValue,setParameterConnection,STRATEGY_TIMEFRAMES} from '../domain/strategy-parameters.mjs';
import {decisionNodePortContract,inspectDecisionConnection} from '../domain/strategy-decision-graph.mjs';
import {getInstrument,listInstruments} from '../domain/instruments.mjs';

const periodLabels={'1m':'1분','3m':'3분','5m':'5분','1h':'1시간','4h':'4시간','1d':'1일'};
const title=node=>node.label||node.id;
export function parameterConnectionChoices(graph,node,spec){
 if(!graph.nodes.some(n=>n.id===node.id&&parameterSpec(n,spec.portId)))return [];
 const unlinked=setParameterConnection(graph,{nodeId:node.id,field:spec.key});
 return graph.nodes.filter(n=>n.id!==node.id).flatMap(source=>decisionNodePortContract(source).outputs.filter(port=>inspectDecisionConnection(unlinked,{from:source.id,to:node.id,fromPort:port.id,toPort:spec.portId}).ok).map(port=>({value:source.id+'|'+port.id,label:title(source)+' · '+port.dataType})));
}
export function parameterDisplayValue(value,spec){return value==null||value===''?'':Array.isArray(value)?value.join('\n'):spec.unit==='ms'?value/1000:spec.unit==='ratio'?value*100:value;}
export function ParameterLiteral({data,spec,value,variable=false}){
 const section=variable?'variable':'pin',key=data.node.id+':'+section+':'+spec.key,current=data.fieldDrafts?.[key]??parameterDisplayValue(value,spec),name=title(data.node)+' · '+spec.label,disabled=data.saving||data.readOnly||data.lockDefinition;
 if(spec.dataType==='INSTRUMENT_SET')return <textarea className="nodrag nopan nowheel" aria-label={name} value={current} placeholder="한 줄에 종목 참조 하나 · 미지정 시 마인드 전체" disabled={disabled} onChange={e=>data.onField?.(key,e.target.value,e.currentTarget)} onBlur={()=>data.onCommit?.(data.node,section,spec.key,key)}/>;
 if(spec.dataType==='TIMEFRAME'){const periods=spec.choices??STRATEGY_TIMEFRAMES;return <select className="nodrag nopan" aria-label={name} value={value??''} disabled={disabled} onChange={e=>data.onPatch?.(data.node,{config:{...data.node.config,[spec.key]:e.target.value}})}><option value="" disabled>봉 주기 선택</option>{value&&!periods.includes(value)&&<option value={value}>지원하지 않는 주기 · {value}</option>}{periods.map(v=><option key={v} value={v}>{periodLabels[v]??v}</option>)}</select>;}
 if(spec.dataType==='INSTRUMENT'){
  const instruments=listInstruments();if(value&&value!=='execution:current'&&!instruments.some(i=>i.id===value))try{instruments.push(getInstrument(value));}catch{}
  return <select className="nodrag nopan" aria-label={name} value={value??''} disabled={disabled} onChange={e=>data.onPatch?.(data.node,{config:{...data.node.config,[spec.key]:e.target.value}})}><option value="" disabled>종목 선택</option>{value&&value!=='execution:current'&&!instruments.some(i=>i.id===value)&&<option value={value}>종목 확인 필요 · {value}</option>}{value==='execution:current'&&<option value="execution:current">이번 평가 종목</option>}{instruments.map(i=><option key={i.id} value={i.id}>{i.symbol} · {i.venue} · {i.quoteCurrency}</option>)}</select>;
 }
 return <input className="nodrag nopan nowheel" type={spec.dataType==='NUMBER'?'number':'text'} step="any" aria-label={name} value={current} title={String(value??'미지정')} placeholder={spec.key==='instrumentId'?'종목 식별값':'기본값 사용'} aria-invalid={data.invalidField===key||undefined} disabled={disabled} onChange={e=>data.onField?.(key,e.target.value,e.currentTarget)} onBlur={()=>data.onCommit?.(data.node,section,spec.key,key)} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();data.onCommit?.(data.node,section,spec.key,key);}}}/>;
}
function sourceValue(source,spec){
 const {dataType,value}=source.config;
 if(dataType==='INSTRUMENT'){if(value==null||value==='')return '종목 미지정';try{return getInstrument(value).symbol;}catch{return '종목 확인 필요';}}
 return dataType==='TIMEFRAME'?((periodLabels[value]??value)||'주기 미지정'):parameterDisplayValue(value,spec);
}
export function StrategyParameterControls({data,showHandles=true}){
 if(data.graph.schemaVersion!==2)return null;
 const parameters=strategyParameters(data.node);if(!parameters.length)return null;
 return <div className="strategy-parameter-pins" aria-label={title(data.node)+' 변수 입력'}>{parameters.map(spec=>{
  const edge=data.graph.edges.find(e=>e.to.nodeId===data.node.id&&e.to.port===spec.portId),source=edge&&data.graph.nodes.find(n=>n.id===edge.from.nodeId),choices=parameterConnectionChoices(data.graph,data.node,spec),unit=spec.unit==='ms'?'초':spec.unit==='ratio'?'%':spec.unit==='count'?'개':spec.unit==='signed_score'?'점수':spec.unit??'';
  return <div className="strategy-parameter-row" key={spec.key} data-parameter-field={spec.key} data-parameter-mode={edge?'CONNECTED':'LITERAL'}>
   {showHandles&&<Handle type="target" position={Position.Left} id={spec.portId} className="strategy-parameter-port" data-port-type={spec.dataType} aria-label={title(data.node)+' · '+spec.label+' 입력 포트'} title={spec.label+' · '+spec.dataType}/>}
   <div className="strategy-parameter-caption"><span>{spec.label}</span><small>{unit}</small></div>
   <div className="strategy-parameter-values">{source?<button type="button" className="strategy-parameter-source nodrag nopan" title={'출처: '+title(source)+' · 저장된 직접 입력값: '+String(parameterLiteral(data.node,spec)??'기본값')} onClick={()=>data.onParameterFocus?.(source.id)}><span>{title(source)}</span>{source.type==='VALUE'&&<small title={String(source.config.value??'미지정')}>{sourceValue(source,spec)}</small>}</button>:<ParameterLiteral data={data} spec={spec} value={parameterLiteral(data.node,spec)}/>}
    <span className="strategy-binding-select" data-connected={Boolean(edge)} title={spec.label+' 변수 연결'}><StrategyGlyph id="link"/><select className="strategy-parameter-picker nodrag nopan" aria-label={title(data.node)+' · '+spec.label+' 연결'} value={edge?edge.from.nodeId+'|'+edge.from.port:''} disabled={data.saving||data.readOnly||data.lockDefinition} onChange={e=>data.onParameterConnection?.(data.node,spec.key,e.target.value)}><option value="">직접 입력</option>{choices.map(c=><option key={c.value} value={c.value}>{c.label}</option>)}{edge&&!choices.some(c=>c.value===edge.from.nodeId+'|'+edge.from.port)&&<option value={edge.from.nodeId+'|'+edge.from.port}>연결 확인 필요</option>}<option value="__new__">현재 값을 변수로 분리</option></select></span>
   </div>
  </div>;
 })}</div>;
}
export function StrategyVariableControl({data}){
 const c=data.node.config;if(!['NUMBER','INSTRUMENT','INSTRUMENT_SET','TIMEFRAME'].includes(c.dataType))return null;
 const spec={key:'value',label:'변수 값',dataType:c.dataType,unit:c.unit??null};return <div className="strategy-variable-value"><ParameterLiteral data={data} spec={spec} value={c.value} variable/><small>{c.dataType==='INSTRUMENT_SET'?'종목 목록':c.dataType==='INSTRUMENT'?'종목':c.dataType==='TIMEFRAME'?'주기':c.unit==='ratio'?'%':c.unit==='ms'?'초':c.unit==='count'?'개':c.unit??'숫자'}</small></div>;
}

export function StrategySettingsFrame({data,children}){
 if(data.graph.schemaVersion!==2||!strategyParameters(data.node).length)return children;
 const connected=data.graph.edges.some(e=>e.to.nodeId===data.node.id&&e.to.port.startsWith('param:'));
 return <><section aria-label="속성별 변수 연결"><StrategyParameterControls data={data} showHandles={false}/></section><details className="strategy-parameters"><summary>{connected?'연결 해제 시 기본값 · 세부 설정':'세부 설정'}</summary>{children}</details></>;
}
