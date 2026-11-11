import React,{useEffect,useMemo,useRef,useState} from 'react';
import {explainStrategyNode,strategyGuideLabel,strategyExplorationStart,strategyExplorationStep} from '../domain/strategy-node-guide.mjs';
import {StrategyGlyph} from './strategy-part-card.jsx';

function Story({text}){
 return text.split('\n').map((paragraph,i)=><p key={i}>{paragraph.split(/([+−-]?\d[\d,]*(?:\.\d+)?(?:\s?(?:%p|%|시간봉|분봉|일봉|시간|분|초|봉|개|회|점|일|bp))?)/g).map((part,j)=>j%2?<strong key={j}>{part}</strong>:part)}</p>);
}
function Conditions({condition}){
 if(condition.items)return <div className="guide-condition-group"><p>{({ALL:'모든 조건 충족',ANY:'하나 이상의 조건 충족',NOT:'다음 조건 미충족'})[condition.operation]}</p><div>{condition.items.map((item,i)=><Conditions key={i} condition={item}/>)}</div></div>;
 return <div className="guide-condition-row"><span>{condition.label}{condition.note&&<small>{condition.note}</small>}</span><strong>{condition.value}</strong></div>;
}

export function StrategyExplorer({graph,selectedNodeId=null,strategyName='',onFocus,onClose}){
 const [journey,setJourney]=useState(()=>strategyExplorationStart(graph,selectedNodeId)),[error,setError]=useState(''),[nextId,setNextId]=useState(''),[direction,setDirection]=useState('next');
 const currentRef=useRef(journey),graphRef=useRef(graph),heading=useRef(null),focusRef=useRef(onFocus);currentRef.current=journey;focusRef.current=onFocus;
 useEffect(()=>{if(graphRef.current!==graph){graphRef.current=graph;const next=strategyExplorationStart(graph,selectedNodeId);currentRef.current=next;setJourney(next);setError('');return;}if(selectedNodeId&&selectedNodeId!==currentRef.current.currentId&&graph.nodes.some(n=>n.id===selectedNodeId))setJourney(s=>strategyExplorationStep(graph,s,{type:'jump',nodeId:selectedNodeId}));},[selectedNodeId,graph]);
 const safe=graph.nodes.some(n=>n.id===journey.currentId)?journey:strategyExplorationStart(graph,selectedNodeId),view=useMemo(()=>explainStrategyNode(graph,safe.currentId),[graph,safe.currentId]),frame=safe.frames.at(-1),choice=safe.choices[view.nodeId],next=frame?.kind==='branch'?explainStrategyNode(graph,frame.nodeId).next:view.next;
 const selectedNext=next.find(e=>e.edgeId===nextId)??next[0],complete=view.terminal&&!frame&&(!view.branches.length||Boolean(choice)),needsChoice=view.branches.length>0&&!frame&&!complete;
 useEffect(()=>{setNextId('');heading.current?.focus({preventScroll:true});heading.current?.closest('[data-guide-stage]')?.scrollTo({top:0,behavior:'instant'});},[safe.currentId]);
 function move(action){try{const state=strategyExplorationStep(graph,safe,action);setDirection(action.type==='back'?'back':'next');currentRef.current=state;setJourney(state);setError('');focusRef.current?.(state.currentId);}catch(problem){setError(problem.message);}}
 function advance(){if(complete){onClose();return;}if(needsChoice)return;if(frame)move({type:frame.kind==='branch'?'continue':'return',...(frame.kind==='branch'&&selectedNext?{edgeId:selectedNext.edgeId}:{})});else if(selectedNext)move({type:'next',edgeId:selectedNext.edgeId});}
 const visited=new Set([...safe.trail.map(s=>s.currentId),safe.currentId]),node=graph.nodes.find(n=>n.id===view.nodeId),inputFacts=view.type==='INPUT'?view.facts.filter(f=>['체결 집계 기간','종목'].includes(f.label)):[];
 return <section className="strategy-explorer strategy-presentation" data-strategy-explorer data-guide-node={view.nodeId} aria-label="전략 프레젠테이션" onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();onClose();return;}if(event.target.closest('button,select,input,textarea,summary'))return;if(event.key==='ArrowLeft'&&safe.trail.length){event.preventDefault();move({type:'back'});}if(event.key==='ArrowRight'&&!needsChoice){event.preventDefault();advance();}}}>
  <header className="guide-presentation-header"><div><span>전략 탐험</span><small title={strategyName}>{strategyName}</small></div><div className="guide-presentation-tools"><details className="guide-node-menu"><summary>노드 목록</summary><label><span className="sr-only">탐험할 노드</span><select aria-label="탐험할 노드" value={view.nodeId} onChange={e=>{move({type:'jump',nodeId:e.target.value});e.target.closest('details').open=false;}}>{graph.nodes.map(n=><option key={n.id} value={n.id}>{strategyGuideLabel(n)}</option>)}</select></label></details><button type="button" className="guide-presentation-close" aria-label="탐험 마치고 편집으로" onClick={onClose}><StrategyGlyph id="close"/></button></div></header>
  <div className="guide-progress"><progress value={visited.size} max={graph.nodes.length} aria-label="확인한 노드"/><span>확인 {visited.size} / {graph.nodes.length}</span></div>
  <div className="guide-presentation-stage" data-guide-stage role="region" aria-label="노드 설명">
   <div className="guide-slide" data-direction={direction} key={view.nodeId+':'+safe.trail.length}>
    <p className="guide-slide-role"><StrategyGlyph node={node}/>{view.role}{view.disabled?' · 사용 해제':''}</p>
    <h2 ref={heading} tabIndex={-1}>{view.presentation.heading}</h2>
    <p className="guide-node-title">{view.title}</p>
    {view.presentation.condition?<div data-guide-conditions><Conditions condition={view.presentation.condition}/></div>:<div className="guide-slide-story" data-guide-story><Story text={view.presentation.statement}/></div>}
    {inputFacts.length>0&&<dl className="guide-key-values">{inputFacts.map(f=><div key={f.label}><dt>{f.label}</dt><dd>{f.value}</dd></div>)}</dl>}
    {view.branches.length>0&&<div className="guide-slide-branches" aria-label="확인할 경우 선택">{view.branches.map(b=><button type="button" key={b.id} data-guide-branch={b.id} disabled={!b.nodeId} aria-pressed={choice?.id===b.id} onClick={()=>move({type:'branch',id:b.id})}><span>{view.branches.length===2&&['true','false'].includes(b.id)?b.id==='true'?'조건 충족':'조건 미충족':b.label}</span><strong>{b.action}</strong><span className="guide-branch-arrow" aria-hidden="true">→</span></button>)}</div>}
    {next.length>1&&!needsChoice&&<label className="guide-next-path"><span>다음 연결</span><select aria-label="다음 노드 경로" value={selectedNext?.edgeId??''} onChange={e=>setNextId(e.target.value)}>{next.map(e=><option value={e.edgeId} key={e.edgeId}>{e.label}</option>)}</select></label>}
    <details className="guide-slide-details"><summary>설정·연결 상세</summary><div className="guide-slide-detail-content"><p data-guide-narrative>{view.narrative}</p><dl>{view.facts.map((f,i)=><div key={i}><dt>{f.label}</dt><dd title={f.raw??f.value}>{f.value}</dd></div>)}</dl>{view.inbound.length>0&&<div className="guide-input-links"><h3>입력 노드</h3>{view.inbound.map(e=><button type="button" key={e.edgeId} onClick={()=>move({type:'input',edgeId:e.edgeId})}>{e.label}<span aria-hidden="true"> ↗</span></button>)}</div>}{view.bindings.length>0&&<p className="guide-variable-source">{view.bindings.map(b=>b.label+' ← '+b.sourceLabel+(b.status==='RUNTIME'?' · 실행 시 입력값':'')).join('\n')}</p>}</div></details>
   </div>
   {error&&<p role="alert" className="guide-presentation-error">{error}</p>}
  </div>
  <footer className="guide-presentation-footer"><div className="guide-presentation-position" role="status"><small>{needsChoice?'조건별 결과를 선택하세요':frame?.kind==='input'?'복귀: '+frame.label:complete?'마지막 노드':'다음: '+(selectedNext?.label??'연결 확인 필요')}</small></div><div className="guide-navigation"><button type="button" className="guide-previous" disabled={!safe.trail.length} data-guide-back onClick={()=>move({type:'back'})}><span aria-hidden="true">←</span> 이전 노드</button><button type="button" className="guide-next" data-guide-advance disabled={needsChoice||!complete&&!frame&&!selectedNext} onClick={advance}>{complete?'탐험 마치기':'다음 노드'} <span aria-hidden="true">→</span></button></div></footer>
 </section>;
}
