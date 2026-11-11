import {resolveQueryParameters,isParameterPort} from '../dist/domain/strategy-parameters.mjs';
import {loadInstrumentMarket} from './instrument-market.mjs';
import {researchSha256} from '../dist/domain/research.mjs';

/** Reuse the existing provider boundary. Query variables never grant a wider universe. */
export async function loadStrategyParameterData({manifest,baseMarket,env={},fetchImpl,clock=()=>new Date().toISOString(),marketLoader=loadInstrumentMarket}={}){
 const graph=manifest.data.strategyPlan.graph,queries=new Map(),executionInstrumentId=baseMarket.instrument.id;if(!graph)return [];
 for(const node of graph.nodes.filter(n=>n.type==='INPUT'&&n.config.kind==='OHLCV'&&graph.edges.some(e=>e.to.nodeId===n.id&&isParameterPort(e.to.port)))){
  const result=resolveQueryParameters(graph,node,{executionInstrumentId});if(!result.ready)throw Object.assign(Error('조회 변수를 확정할 수 없습니다.'),{code:result.missing[0]});
  const c=result.node.config,id=c.instrumentId==='execution:current'?executionInstrumentId:c.instrumentId;
  if(!manifest.data.universe.instrumentIds.includes(id))throw Object.assign(Error('마인드 투자 범위에 포함된 종목을 연결하세요.'),{code:'INPUT_OUTSIDE_UNIVERSE'});
  if(id===executionInstrumentId&&c.timeframe===baseMarket.timeframe)continue;
  const key=id+'|'+c.timeframe,prior=queries.get(key);queries.set(key,{instrumentId:id,timeframe:c.timeframe,limit:Math.max(prior?.limit??0,c.lookbackBars??240)});
 }
 const result=[];
 for(const query of queries.values()){
  const market=await marketLoader({...query,strategyHistory:true,env,fetchImpl,now:clock,universeResolution:manifest.data.universe.resolution});
  if(market.status!=='READY'||market.instrument.id!==query.instrumentId||market.timeframe!==query.timeframe||researchSha256(JSON.stringify(market.bars))!==market.source?.barsSha256)throw Object.assign(Error('조회한 종목·주기·원문을 대조할 수 없습니다.'),{code:'GRAPH_PARAMETER_DATA_IDENTITY'});
  const bars=market.bars.map(b=>[Date.parse(b.openTime),b.open,b.high,b.low,b.close,b.volume]),datasetSha256=researchSha256(JSON.stringify({instrumentId:query.instrumentId,timeframe:query.timeframe,bars}));
  result.push({instrumentId:query.instrumentId,timeframe:query.timeframe,bars,dailyBars:query.timeframe==='1d'?bars:[],source:{...market.source,datasetSha256},barCount:bars.length});
 }
 return result;
}
