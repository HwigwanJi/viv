import {regimeNodePorts} from '../dist/domain/regime-program-graph.mjs';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {AUTOMATION_ACTIONS} from '../dist/system/automation-contracts.mjs';
import {STRATEGY_NODE_TYPES} from '../dist/domain/strategy-node-registry.mjs';

// This service uses literal GET branches and POST branches after its POST gate.
export function inspectAutomationCoverage(source,actions=AUTOMATION_ACTIONS){
 const implemented=[...source.matchAll(/if\(request\.method==='GET'&&path==='([^']*)'\)/g)].map(match=>'GET '+match[1]);
 implemented.push(...[...source.matchAll(/(?:if|check)\(path==='([^']*)'/g)].map(match=>'POST '+match[1]));
 const registered=actions.map(action=>action.api.method+' '+action.api.path.replace('/api/workspace/automated-trading',''));
 return {implemented,registered,unregistered:implemented.filter(route=>!registered.includes(route)),unimplemented:registered.filter(route=>!implemented.includes(route)),duplicateImplemented:implemented.filter((route,index)=>implemented.indexOf(route)!==index),duplicateRegistered:registered.filter((route,index)=>registered.indexOf(route)!==index)};
}
export function inspectNodeCoverage(source,types=STRATEGY_NODE_TYPES){
 const runtime=source.slice(source.indexOf('export function evaluateDecisionStrategyGraph(')),implemented=[...new Set([...runtime.matchAll(/n\.type==='([A-Z_]+)'/g),...regimeNodePorts.toString().matchAll(/node\.type==='([A-Z_]+)'/g)].map(match=>match[1]))];
 return {unregistered:implemented.filter(type=>!types.includes(type)),unimplemented:types.filter(type=>!implemented.includes(type))};
}
export async function checkCanonicalRegistry(){
 const source=await readFile(new URL('../server/automated-trading.mjs',import.meta.url),'utf8'),coverage=inspectAutomationCoverage(source);
 for(const kind of ['unregistered','unimplemented','duplicateImplemented','duplicateRegistered'])if(coverage[kind].length)throw Error('AUTOMATION_REGISTRY_'+kind+': '+coverage[kind].join(', '));
 for(const required of ['automationRoute(request.method,u.pathname)','validAutomationInput(action,body)','validAutomationInput(action,Object.fromEntries(u.searchParams))'])if(!source.includes(required))throw Error('AUTOMATION_CONTRACT_DISCONNECTED: '+required);
 const nodes=inspectNodeCoverage(await readFile(new URL('../dist/domain/strategy-decision-graph.mjs',import.meta.url),'utf8'));
 const programRunner=await readFile(new URL('../server/event-automation-runner.mjs',import.meta.url),'utf8');if(!programRunner.includes('runRegimeProgram({program:deployment.program')||!programRunner.includes('await processActivation(actual,claim,child)'))throw Error('PROGRAM_RUNNER_DISCONNECTED');
 if(nodes.unregistered.length||nodes.unimplemented.length)throw Error('NODE_REGISTRY_COVERAGE: '+JSON.stringify(nodes));
 return coverage;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const result=await checkCanonicalRegistry();console.log('Canonical automation coverage: '+result.registered.length+' routes, bidirectional match.');
}
