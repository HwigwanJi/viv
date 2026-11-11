import {importHourlyPathModel,HOURLY_PATH_FEATURES} from '../domain/hourly-path-model.mjs';
import {createHourlyValueStrategyGraph} from '../domain/hourly-value-graph.mjs';
import {createDecisionStrategyGraph,createDecisionStrategyNode,compileStrategyGraph} from '../domain/strategy-graph.mjs';
import {setParameterConnection} from '../domain/strategy-parameters.mjs';
export function strategyUiSampleGraph(){
 let graph=createDecisionStrategyGraph({instrumentId:'crypto:okx:ETH-USDT',moduleId:'SMA_TREND'});
 graph.nodes.find(n=>n.id==='market').label='확정 시세';graph.nodes.find(n=>n.id==='market').config.timeframe='1h';graph.nodes.find(n=>n.id==='signal').label='이동평균 계산';
 for(const [id,label,dataType,value,unit]of [['asset','종목 변수','INSTRUMENT','crypto:okx:ETH-USDT'],['period','봉 주기 변수','TIMEFRAME','1h'],['count','관측 기간','NUMBER',60,'count'],['weight','목표 비중','NUMBER',.5,'ratio']])graph.nodes.push({...createDecisionStrategyNode('VALUE',{id,position:{x:-340,y:graph.nodes.length*100},config:{dataType,value,...(unit?{unit}:{})}}),label});
 for(const [nodeId,field,sourceNodeId]of [['market','instrumentId','asset'],['market','timeframe','period'],['market','lookbackBars','count'],['signal','lookbackBars','count'],['quant','buyTargetWeight','weight']])graph=setParameterConnection(graph,{nodeId,field,sourceNodeId});compileStrategyGraph(graph);return graph;
}
export function strategyUiGalleryGraph(){const graph=strategyUiSampleGraph();graph.nodes.push({...createDecisionStrategyNode('CONDITION',{id:'compare',config:{operator:'gte',value:.2}}),label:'목표 수익 도달'},{...createDecisionStrategyNode('DECISION_ROUTER',{id:'branch',config:{mode:'CONDITION'}}),label:'조건에 따라 선택'});return graph;}
export const STRATEGY_UI_ROLE_SAMPLES=Object.freeze([
 {role:'VALUE',nodeId:'asset',description:'여러 부품이 함께 쓰는 종목·기간·숫자.'},
 {role:'DATA',nodeId:'market',description:'연결된 종목과 기간으로 자료를 읽습니다.'},
 {role:'COMPUTE',nodeId:'signal',description:'입력 자료로 지표나 모델 예측을 계산합니다.'},
 {role:'CONDITION',nodeId:'compare',description:'연결값을 비교해 참·거짓을 전달합니다.'},
 {role:'FLOW',nodeId:'branch',description:'조건에 따라 연결된 경로 하나를 선택합니다.'},
 {role:'DECISION',nodeId:'quant',description:'신호를 매수·보유·매도와 비중으로 바꿉니다.'},
 {role:'GUARD',nodeId:'risk',description:'사용자가 정한 실행 범위와 한도를 확인합니다.'},
 {role:'EXECUTE',nodeId:'order',description:'검사를 통과한 계획을 주문 경로로 보냅니다.'},
]);

export function strategyUiModelGraph(){
 const hash='a'.repeat(64),model=importHourlyPathModel({role:'RESEARCH_SHARED_MARKET_PATH_FOREST',at:'2026-10-01T00:00:00.000Z',timeframe:'1h',horizonBars:6,features:[...HOURLY_PATH_FEATURES],trainingRowsSha256:hash,targetTransform:'LOG1P',models:{pooled:{samples:80,lastLabelAt:'2026-09-30T18:00:00.000Z',trees:[[{feature:0,threshold:0,left:1,right:2},{values:[Math.log1p(-.01),Math.log1p(-.03)],count:40},{values:[Math.log1p(.02),Math.log1p(-.01)],count:40}]]}}},{sourceSha256:hash});
 return createHourlyValueStrategyGraph({model,policy:{forecastExitSlippageBps:5,entrySlippageBps:5,readyDelayMs:180000}});
}
