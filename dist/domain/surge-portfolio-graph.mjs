import {createDecisionStrategyNode,compileStrategyGraph} from './strategy-graph.mjs';
import {SURGE_MODEL_FAMILY} from './surge-path-model.mjs';
export function createSurgePortfolioGraph({model,execution='ACCOUNT',policy={}}={}){
 const nodes=[['assets','INPUT',{kind:'ASSET_SET',scope:'MIND_UNIVERSE',timeframe:'1m',required:true}],['surge','MODEL',{family:SURGE_MODEL_FAMILY,model,policy:{candidateCount:12,watchMinutes:5,decisionEveryMinutes:1,forecastExitSlippageBps:10,...policy}}],['risk','RISK',{mode:'PORTFOLIO',maxExposure:1,maxOrderWeight:1}],['order','ORDER',{execution,sizing:'TARGET_WEIGHTS',orderType:'LIMIT_FOK',maxSlippageBps:20,maxQuoteAgeMs:10000,participationRate:.1}]].map(([id,type,config],i)=>createDecisionStrategyNode(type,{id,config,position:{x:i*350,y:0}}));
 nodes[0].label='분봉 후보·호가';nodes[1].label='급등 학습 판단';nodes[2].label='계좌·운용 한도';nodes[3].label='목표 비중 주문';
 const graph={schemaVersion:2,contractVersion:'mind-strategy-decision-graph-v2',nodes,edges:[['assets','surge','data','assets'],['surge','risk','targets','decision'],['risk','order','approved','approved']].map(([from,to,a,b])=>({id:from+'-'+to,from:{nodeId:from,port:a},to:{nodeId:to,port:b}})),outputNodeId:'order',triggers:['closed_bar','market_event']};compileStrategyGraph(graph);return graph;
}
