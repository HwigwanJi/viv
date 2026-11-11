import {automationAction} from '../dist/system/automation-contracts.mjs';
import {handleMcp} from './mcp.mjs';

const allowed=['read','prepare','activate','stop','capital.read','capital.update'].map(id=>automationAction('automation.trading.'+id));
const tools=new Set(allowed.map(action=>action.mcp_tool)),paths=new Set(allowed.map(action=>action.api.path));
const serverInfo={name:'chung-ji-trading-controls',version:'1.0.0'};

export function createAutomatedTradingMcpBridge({upstream='http://127.0.0.1:4905',fetchImpl=fetch}={}){
 const base=new URL(upstream);
 if(base.protocol!=='http:'||base.hostname!=='127.0.0.1'||base.username||base.password||base.pathname!=='/'||base.search||base.hash)throw new Error('LOCAL_AUTOMATION_UPSTREAM_REQUIRED');
 return async input=>{
  const reply=result=>({jsonrpc:'2.0',id:input?.id??null,result});
  if(!input||Array.isArray(input)||input.jsonrpc!=='2.0'||typeof input.method!=='string')return {jsonrpc:'2.0',id:null,error:{code:-32600,message:'Invalid request'}};
  if(!Object.hasOwn(input,'id'))return undefined;
  if(input.method==='initialize')return reply({protocolVersion:['2025-11-25','2025-06-18','2025-03-26','2024-11-05'].includes(input.params?.protocolVersion)?input.params.protocolVersion:'2025-11-25',capabilities:{tools:{}},serverInfo});
  if(input.method==='ping')return reply({});
  if(input.method==='tools/call'&&!tools.has(input.params?.name))return reply({isError:true,content:[{type:'text',text:'Unknown trading control tool'}]});
  const automatedTradingHandler=async request=>{
   const url=new URL(request.url);if(!paths.has(url.pathname))throw new Error('AUTOMATION_PATH_REQUIRED');
   // The existing local app supplies its owner and performs all activation checks.
   return fetchImpl(new URL(url.pathname+url.search,base),{method:request.method,headers:{Accept:'application/json',...(request.method==='POST'?{'Content-Type':'application/json'}:{})},...(request.method==='POST'?{body:await request.text()}:{}),redirect:'error',signal:AbortSignal.timeout(60000)});
  };
  const response=await handleMcp(new Request(new URL('/mcp',base),{method:'POST',headers:{'Content-Type':'application/json','oai-authenticated-user-id':'local-preview-owner'},body:JSON.stringify(input)}),{},{automatedTradingHandler});
  const result=await response.json();
  if(input.method==='tools/list'&&result.result)result.result.tools=result.result.tools.filter(tool=>tools.has(tool.name));
  if(input.method==='server/discover'&&result.result)result.result.serverInfo=serverInfo;
  return result;
 };
}
