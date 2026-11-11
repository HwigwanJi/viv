/** Portfolio branches and per-asset execution share the larger canonical graph bounds. */
export function decisionGraphLimits(graph){return graph?.executionScope?.kind==='EACH_ASSET'||graph?.nodes?.some(n=>n?.type==='ORDER'&&n.config?.sizing==='TARGET_WEIGHTS')?{nodes:64,edges:128}:{nodes:32,edges:64};}
