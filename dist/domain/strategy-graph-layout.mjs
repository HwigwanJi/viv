/** One flat DAG layout shared by new graph presets and the editor's arrange action. */
export function arrangeFlatStrategyGraph(graph,compiled,{originX,originY,rowStep,columnStep}){
 const depths={},positions={},columns=new Map();
 for(const id of compiled.nodeOrder){const inputs=compiled.incoming[id].map(edge=>typeof edge==='string'?edge:edge.from.nodeId);depths[id]=Math.max(-1,...inputs.map(k=>depths[k]))+1;const column=columns.get(depths[id])??[];column.push(id);columns.set(depths[id],column);}
 for(const [depth,ids]of columns){const targets=ids.map((id,index)=>({id,y:compiled.incoming[id].length?compiled.incoming[id].reduce((sum,input)=>sum+positions[typeof input==='string'?input:input.from.nodeId].y,0)/compiled.incoming[id].length:originY+index*rowStep})).sort((a,b)=>a.y-b.y||a.id.localeCompare(b.id));let previous=-Infinity;for(const target of targets){const y=Math.max(target.y,previous+rowStep);positions[target.id]={x:originX+depth*columnStep,y};previous=y;}}
 return {...graph,nodes:graph.nodes.map(node=>({...node,position:positions[node.id]}))};
}
