import {createDecisionStrategyNode} from './strategy-graph.mjs';
import {createPriceStructureGraph} from './price-structure-graph.mjs';
import {assertAdaptivePortfolioGraph} from './adaptive-portfolio-graph.mjs';

/** Editable research candidate: monthly risk permission, alt leadership, and native target branches. */
export function createNativeRegimePortfolioGraph({execution='PAPER',instrumentId='crypto:upbit:KRW-BTC',instrumentIds=null,budget=1}={}){
 const graph=createPriceStructureGraph({execution,budget});
 const add=(type,id,label,config,x,y)=>graph.nodes.push({...createDecisionStrategyNode(type,{id,config,position:{x,y}}),label});
 const link=(a,b,p,q)=>graph.edges.push({id:a+'-'+b+'-'+q,from:{nodeId:a,port:p},to:{nodeId:b,port:q}});
 if(instrumentIds){add('VALUE','decision-universe','판단 대상 종목 목록',{dataType:'INSTRUMENT_SET',value:instrumentIds},-350,400);link('decision-universe','assets','value','param:instrumentIds');}
 add('VALUE','benchmark','비교 기준 종목',{dataType:'INSTRUMENT',value:instrumentId},0,1700);
 add('INPUT','benchmark-assets','기준 종목 · 월말 원본',{kind:'ASSET_SET',scope:'MIND_UNIVERSE',instrumentId,timeframe:'1d',required:true},350,1700);link('benchmark','benchmark-assets','value','param:instrumentId');
 add('VALUE','regime-period','상대 강도 비교 일수',{dataType:'NUMBER',unit:'count',value:20},0,2000);
 add('VALUE','monthly-period','월말 평균 기간',{dataType:'NUMBER',unit:'count',value:10},0,2300);
 for(const[id,label,metric,source,period,y]of [['monthly','월말 평균 대비','MONTHLY_SMA_DISTANCE','benchmark-assets','monthly-period',1700],['relative','후보 로그 수익률','LOG_MOMENTUM','assets','regime-period',2000],['benchmark-return','기준 종목 로그 수익률','LOG_MOMENTUM','benchmark-assets','regime-period',2300],['breadth-values','후보 일봉 평균 대비','SMA_DISTANCE','assets','regime-period',2600]]){
  add('ASSET_METRIC',id,label,{metric,lookback:period==='monthly-period'?10:20},700,y);link(source,id,'data','assets');link(period,id,'value','param:lookback');
 }
 for(const[id,label,source,operation,exclude,y]of [['monthly-value','기준 종목 월말 지표','monthly','MEDIAN',false,1700],['relative-value','기준 종목 제외 · 수익률 중앙값','relative','MEDIAN',true,2000],['benchmark-value','기준 종목 수익률','benchmark-return','MEDIAN',false,2300],['breadth-value','기준 종목 제외 · 상승 비율','breadth-values','POSITIVE_FRACTION',true,2600]]){
  add('ASSET_REDUCE',id,label,{operation},1050,y);link(source,id,'values','values');if(exclude)link('benchmark',id,'value','exclude');
 }
 add('CONDITION','monthly-positive','월말 추세 양수',{operator:'gt',value:0},1400,1700);link('monthly-value','monthly-positive','value','value');
 add('CONDITION','relative-positive','후보 중앙값 > 기준 종목',{operator:'gt',rightOperand:'INPUT'},1400,2100);link('relative-value','relative-positive','value','value');link('benchmark-value','relative-positive','value','compare');
 add('CONDITION','breadth-positive','상승 비율 절반 이상',{operator:'gte',value:.5},1400,2600);link('breadth-value','breadth-positive','value','value');
 add('BOOLEAN_LOGIC','alt-lead','시장 폭과 상대 강도 충족',{operation:'ALL'},1750,2100);link('relative-positive','alt-lead','condition','conditions');link('breadth-positive','alt-lead','condition','conditions');
 add('RANK','benchmark-rank','기준 종목 전달',{terms:[{metric:'MOMENTUM',lookback:2,weight:1}],volatilityBars:2,direction:'DESC',minScore:null},700,3000);link('benchmark-assets','benchmark-rank','data','assets');
 for(const[id,label,budgetId,y]of [['benchmark-hold','기준 종목 보유','budget',3000],['cash','현금 보유','cash-budget',3300]]){
  add('ALLOCATE',id,label,{method:'EQUAL',maxPositions:1,minBudget:0,maxBudget:1,maxAssetWeight:1,preserveMembers:true},2100,y);link('benchmark-rank',id,'rank','rank');link(budgetId,id,'value','budget');
 }
 add('VALUE','cash-budget','현금 선택 · 위험자산 비중',{dataType:'NUMBER',unit:'ratio',value:0},1750,3300);
 add('DECISION_ROUTER','leader-route','다종목 추세 또는 기준 종목',{mode:'CONDITION',payload:'TARGET_WEIGHTS'},2450,2100);
 add('DECISION_ROUTER','regime-route','시장 참여 또는 현금',{mode:'CONDITION',payload:'TARGET_WEIGHTS'},2800,2100);
 graph.edges=graph.edges.filter(e=>e.to.nodeId!=='risk');
 for(const[a,b,p,q]of [['alt-lead','leader-route','condition','condition'],['allocate','leader-route','targets','true'],['benchmark-hold','leader-route','targets','false'],['monthly-positive','regime-route','condition','condition'],['leader-route','regime-route','targets','true'],['cash','regime-route','targets','false'],['regime-route','risk','targets','decision']])link(a,b,p,q);
 return assertAdaptivePortfolioGraph(graph);
}
