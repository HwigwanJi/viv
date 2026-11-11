import React from 'react';
import {STRATEGY_ICONS,strategyIconId} from './strategy-icons.mjs';
import {strategyNodeCohort} from '../domain/strategy-node-registry.mjs';
import {STRATEGY_COHORTS} from '../domain/strategy-ontology.mjs';

export function StrategyGlyph({node,id,className='',...props}){const icon=STRATEGY_ICONS[id??strategyIconId(node)];return <svg className={'strategy-glyph '+className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>{icon.shapes.map(([tag,attrs],i)=>React.createElement(tag,{...attrs,key:i}))}</svg>;}
export function StrategyToolButton({icon,label,compact=false,children,...props}){return <button type="button" className={'button small strategy-tool-button'+(compact?' strategy-tool-compact':'')} aria-label={label} title={label} {...props}><StrategyGlyph id={icon}/><span>{children??label}</span></button>;}
export function StrategyPartCard({node,title,kindLabel,subtitle,selected=false,connectionState='VALID',executionState='idle',excluded=false,hasParameters=false,provenance=null,cohortId=null,iconId=null,children}){
 const cohort=STRATEGY_COHORTS[cohortId]??strategyNodeCohort(node)??STRATEGY_COHORTS[{COMBINER:'COMPUTE',ROUTER:'FLOW',JEV:'DECISION'}[node.type]];
 return <div className={'strategy-node strategy-node-summary-card '+(hasParameters?'strategy-node-has-parameters ':'')+(selected?'selected ':'')+'strategy-node-'+node.type.toLowerCase()+' connection-'+connectionState.toLowerCase()+' execution-'+executionState+(excluded?' strategy-node-excluded':'')} data-node-cohort={cohort?.id}>
  <header className="strategy-part-heading" title={provenance??undefined}><span className="strategy-node-symbol"><StrategyGlyph node={node} id={iconId??undefined}/></span><div className="strategy-node-heading"><span className="strategy-node-kind" title={kindLabel??cohort?.label}>{kindLabel&&kindLabel!==title?kindLabel:cohort?.label}</span><strong title={title}>{title}</strong></div><span className="strategy-part-status" title={connectionState==='VALID'?'연결 검사 통과':connectionState==='INVALID'?'연결 확인 필요':'입력 연결 필요'} aria-label={connectionState==='VALID'?'연결 검사 통과':'연결 확인 필요'}/></header>
  {subtitle&&<p className="strategy-node-meta" title={subtitle}>{subtitle}</p>}
  {children}
 </div>;
}
