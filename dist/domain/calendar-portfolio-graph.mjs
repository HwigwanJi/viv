import {createDecisionStrategyNode} from './strategy-graph.mjs';
import {assertAdaptivePortfolioGraph} from './adaptive-portfolio-graph.mjs';
/** Published monthly rule composed from the same editable primitives as other strategies. */
export function createCalendarPortfolioGraph({instrumentId='crypto:upbit:KRW-BTC',months=10,budget=1,execution='ACCOUNT'}={}){
 const graph={schemaVersion:2,contractVersion:'mind-strategy-decision-graph-v2',nodes:[],edges:[],outputNodeId:'order',triggers:['manual','closed_bar','market_event']};
 const add=(type,id,label,config,x,y)=>graph.nodes.push({...createDecisionStrategyNode(type,{id,config,position:{x,y}}),label});
 const link=(a,b,p,q)=>graph.edges.push({id:a+'-'+b+'-'+q,from:{nodeId:a,port:p},to:{nodeId:b,port:q}});
 add('VALUE','instrument','운용 종목',{dataType:'INSTRUMENT',value:instrumentId},0,0);
 add('INPUT','assets','확정 일봉',{kind:'ASSET_SET',scope:'MIND_UNIVERSE',instrumentId,timeframe:'1d',required:true},350,0);
 add('VALUE','months','월말 계산 기간',{dataType:'NUMBER',unit:'count',value:months},0,300);
 add('ASSET_METRIC','monthly','월말 종가 / 월말 평균 − 1',{metric:'MONTHLY_SMA_DISTANCE',lookback:months},700,0);
 add('ASSET_COMPARE','above','월말 평균 초과',{operator:'gt',value:0},1050,0);
 add('ASSET_FILTER','qualified','추세 조건 통과',{ },1400,0);
 add('FILTER','eligible','유의 종목 확인',{minHistoryBars:2,minQuoteVolume:0,excludeWarnings:true,conditions:[]},1750,0);
 add('RANK','rank','통과 종목 전달',{terms:[{metric:'MOMENTUM',lookback:2,weight:1}],volatilityBars:2,direction:'DESC',minScore:null},2100,0);
 add('VALUE','budget','운용 비중',{dataType:'NUMBER',unit:'ratio',value:budget},1750,300);
 add('ALLOCATE','allocate','통과 종목 보유 · 미통과 현금',{method:'EQUAL',maxPositions:1,minBudget:0,maxBudget:1,maxAssetWeight:1},2450,0);
 add('REBALANCE','calendar','월 변경 시 비중 결정',{everyDays:1,minWeightChange:0,calendar:'UTC_MONTH'},2800,0);
 add('RISK','risk','공동 예산 한도',{mode:'PORTFOLIO',maxExposure:1,maxOrderWeight:1},3150,0);
 add('ORDER','order','계좌 주문',{execution,sizing:'TARGET_WEIGHTS',orderType:'LIMIT_FOK',maxSlippageBps:20,participationRate:.1},3500,0);
 link('instrument','assets','value','param:instrumentId');link('months','monthly','value','param:lookback');
 link('assets','monthly','data','assets');link('monthly','above','values','values');link('assets','qualified','data','assets');link('above','qualified','conditions','conditions');
 link('qualified','eligible','assets','assets');link('eligible','rank','assets','assets');link('rank','allocate','rank','rank');link('budget','allocate','value','budget');
 link('allocate','calendar','targets','targets');link('calendar','risk','targets','decision');link('risk','order','approved','approved');
 return assertAdaptivePortfolioGraph(graph);
}
