import {createDecisionStrategyNode} from './strategy-graph.mjs';
import {assertAdaptivePortfolioGraph} from './adaptive-portfolio-graph.mjs';
/** Explicit daily entry and weekly/daily retention branches; no hidden expert card. */
export function createPriceStructureGraph({budget=1,maxPositions=3,maxAssetWeight=.5,execution='ACCOUNT'}={}){
 const graph={schemaVersion:2,contractVersion:'mind-strategy-decision-graph-v2',nodes:[],edges:[],outputNodeId:'order',triggers:['manual','closed_bar','market_event']};
 const add=(type,id,label,config,x,y)=>graph.nodes.push({...createDecisionStrategyNode(type,{id,config,position:{x,y}}),label});
 const link=(a,b,p,q)=>graph.edges.push({id:a+'-'+b+'-'+q,from:{nodeId:a,port:p},to:{nodeId:b,port:q}});
 add('INPUT','assets','확정 일봉 · 주봉 계산 원본',{kind:'ASSET_SET',scope:'MIND_UNIVERSE',timeframe:'1d',required:true},0,400);
 const metrics=[['fast','일봉 빠른 평균 대비','EMA_DISTANCE',10],['slow','일봉 느린 평균 대비','EMA_DISTANCE',20],['cross','빠른 평균 / 느린 평균','EMA_RATIO',10],['weekly','확정 주봉 평균 대비','WEEKLY_EMA_DISTANCE',10],['breakout','직전 고점 돌파','BREAKOUT',5]];
 metrics.forEach(([id,label,metric,lookback],i)=>{
  add('ASSET_METRIC',id,label,{metric,lookback,...(metric==='EMA_RATIO'?{slowLookback:20}:{})},350,i*250);
  add('ASSET_COMPARE',id+'-ok',label+' 조건',{operator:id==='slow'?'gte':'gt',value:0},700,i*250);
  link('assets',id,'data','assets');link(id,id+'-ok','values','values');
 });
 for(const[id,label,value,y]of [['fast-period','빠른 평균 일수',10,0],['slow-period','느린 평균 일수',20,250],['week-period','주봉 평균 기간',10,500],['break-period','돌파 비교 일수',5,750]])add('VALUE',id,label,{dataType:'NUMBER',unit:'count',value},0,y-500);
 link('fast-period','fast','value','param:lookback');link('fast-period','cross','value','param:lookback');link('slow-period','slow','value','param:lookback');link('slow-period','cross','value','param:slowLookback');link('week-period','weekly','value','param:lookback');link('break-period','breakout','value','param:lookback');
 add('ASSET_LOGIC','entry','신규 진입 조건 모두 충족',{operation:'ALL'},1050,100);
 add('ASSET_LOGIC','hold','기존 보유 추세 유지',{operation:'ALL'},1050,700);
 for(const id of ['fast','cross','weekly','breakout'])link(id+'-ok','entry','conditions','conditions');
 for(const id of ['slow','weekly'])link(id+'-ok','hold','conditions','conditions');
 for(const[branch,y]of [['entry',100],['hold',700]]){
  add('ASSET_FILTER',branch+'-assets',branch==='entry'?'신규 진입 후보':'보유 유지 후보',{},1400,y);link('assets',branch+'-assets','data','assets');link(branch,branch+'-assets','conditions','conditions');
  add('FILTER',branch+'-eligible','거래 가능 후보 확인',{minHistoryBars:21,minQuoteVolume:0,excludeWarnings:true,conditions:[]},1750,y);link(branch+'-assets',branch+'-eligible','assets','assets');
  add('RANK',branch+'-rank','추세 강도 / 변동성 순위',{terms:[{metric:'LOG_MOMENTUM',lookback:20,weight:1}],volatilityBars:20,direction:'DESC',minScore:null,scoreNormalization:branch==='entry'?'VOLATILITY':'NONE',normalizationLookback:20},2100,y);link(branch+'-eligible',branch+'-rank','assets','assets');
 }
 add('VALUE','budget','운용 비중',{dataType:'NUMBER',unit:'ratio',value:budget},2100,1100);
 add('ALLOCATE','allocate','보유 우선 · 남은 자리 신규 진입',{method:'EQUAL',maxPositions,minBudget:0,maxBudget:1,maxAssetWeight,preserveMembers:true},2450,400);
 link('entry-rank','allocate','rank','rank');link('hold-rank','allocate','rank','retain');link('budget','allocate','value','budget');
 add('RISK','risk','공동 예산 한도',{mode:'PORTFOLIO',maxExposure:1,maxOrderWeight:1},2800,400);
 add('ORDER','order','계좌 목표 비중',{execution,sizing:'TARGET_WEIGHTS',orderType:'LIMIT_FOK',maxSlippageBps:20,participationRate:.1},3150,400);
 link('allocate','risk','targets','decision');link('risk','order','approved','approved');
 return assertAdaptivePortfolioGraph(graph);
}
