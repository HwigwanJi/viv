import {isHourlyRegimeGraph} from '../domain/hourly-regime.mjs';
import {currencyAmount} from './currency-format.mjs';

export const PORTFOLIO_ASSET_MODE='UPBIT_BTC_PORTFOLIO';
export const EVENT_ASSET_MODE='UPBIT_EVENT_STREAM';
export const MULTI_EVENT_ASSET_MODE='UPBIT_EVENT_UNIVERSE';
export const observedEventAssetMode=mode=>[EVENT_ASSET_MODE,MULTI_EVENT_ASSET_MODE].includes(mode);
export const multiEventGraph=graph=>graph?.executionScope?.kind==='EACH_ASSET';
export function portfolioGraph(graph){return Boolean(graph?.nodes?.some(node=>node.type==='INPUT'&&node.config?.kind==='ASSET_SET'));}
export function eventGraph(graph){return isHourlyRegimeGraph(graph)||multiEventGraph(graph)||Boolean(graph?.nodes?.some(node=>node.type==='MODEL'&&node.config?.family==='HOURLY_VALUE_FOREST'||node.type==='INPUT'&&node.config?.kind==='MICROSTRUCTURE'));}
export function simulationAssetParameters(draft={},caps={},manifest=null){
 draft??={};caps??={};
 const graph=manifest?.data?.strategyPlan?.graph,assetMode=graph?(graph.nodes?.some(n=>n.type==='SESSION_RULE')?'US_EQUITY_SESSION':multiEventGraph(graph)?MULTI_EVENT_ASSET_MODE:eventGraph(graph)?EVENT_ASSET_MODE:portfolioGraph(graph)?PORTFOLIO_ASSET_MODE:null):draft.assetMode??caps.assetMode;
 if(assetMode===MULTI_EVENT_ASSET_MODE)return {assetMode,datasetIds:[...(draft.datasetIds??caps.datasetIds??[])]};
 if(!['US_EQUITY_SESSION',PORTFOLIO_ASSET_MODE,EVENT_ASSET_MODE].includes(assetMode))return {};
 const datasetId=draft.datasetId??caps.datasetId??caps.source?.datasetId;
 return {assetMode,...(datasetId?{datasetId}:{})};
}
export function simulationMarketScope(value={},caps={}){
 value??={};caps??={};
 const cfg=value.config??value;if(cfg.assetMode==='US_EQUITY_SESSION'||caps.assetMode==='US_EQUITY_SESSION'){const source=value.source??caps.source??{},symbol=source.symbol??value.manifest?.data?.strategyPlan?.graph?.nodes?.find(n=>n.type==='SESSION_RULE')?.config.symbol??'TQQQ';return {sessionRule:true,portfolio:false,eventStream:false,multiEvent:false,btcValuation:false,currency:'USD',timeframe:'1d',instrumentId:source.instrumentId,label:symbol+' / USD 일봉 근사',provider:'Yahoo Finance',amount:n=>Number.isFinite(n)?new Intl.NumberFormat('ko-KR',{maximumFractionDigits:2}).format(n):'—'};}
 const c=value.config??value,source=value.source??caps.source??{},graph=value.manifest?.data?.strategyPlan?.graph,micro=graph?.nodes?.find(node=>node.type==='INPUT'&&node.config?.kind==='MICROSTRUCTURE')?.config,multiEvent=c.assetMode===MULTI_EVENT_ASSET_MODE||caps.assetMode===MULTI_EVENT_ASSET_MODE||multiEventGraph(graph),portfolio=!multiEvent&&(c.assetMode===PORTFOLIO_ASSET_MODE||caps.assetMode===PORTFOLIO_ASSET_MODE),eventStream=multiEvent||observedEventAssetMode(c.assetMode)||observedEventAssetMode(caps.assetMode)||Boolean(micro),sources=source.sources??caps.sources??[];
 const instrumentId=c.instrumentId??source.instrumentId??(micro?.instrumentId==='execution:current'?undefined:micro?.instrumentId),symbol=source.symbol??source.market??instrumentId?.split(':').at(-1),currency=c.quoteCurrency??source.quoteCurrency??caps.preflight?.config?.quoteCurrency??sources[0]?.quoteCurrency??sources[0]?.market?.split('-')[0]??(eventStream?symbol?.split('-')[0]??'—':portfolio?'BTC':'USDT'),timeframe=c.timeframe??source.timeframe??graph?.executionScope?.timeframe??caps.preflight?.config?.timeframe??sources[0]?.timeframe??micro?.timeframe??(portfolio?'1d':eventStream?'':'4h');
 const count=multiEvent?sources.length||c.datasetIds?.length||caps.datasetIds?.length||0:Array.isArray(source.instruments)?source.instruments.length:0;
 return {portfolio,eventStream,multiEvent,btcValuation:eventStream&&!multiEvent,currency,timeframe,instrumentId,label:multiEvent?'업비트 · '+(currency==='—'?'같은 통화 후보':currency+' 마켓')+' · '+count+'종목'+(timeframe?' · '+timeframe.replace(/m$/,'분봉'):'')+' · 호가·체결':eventStream?'업비트 · '+(symbol??'종목 확인')+(timeframe?' · '+timeframe.replace(/m$/,'분봉'):'')+' · 호가·체결':portfolio?'업비트 · BTC 마켓'+(count?' · '+count+'종목':'')+' · 일봉':'BTC-USDT · 4시간봉',amount:amount=>currency==='BTC'?currencyAmount(amount,currency):Number.isFinite(amount)?new Intl.NumberFormat('ko-KR',{maximumFractionDigits:2}).format(amount):'—',provider:portfolio||eventStream?'업비트':'Binance'};
}
export function simulationObservedCosts(value={},caps={},models=[]){
 caps??={};
 const source=value?.source??caps?.source??{},fees=source.sources??caps.sources??caps.costPolicy?.sources??[],fee=source.feeSnapshot??value?.config?.feeSnapshot??fees[0]?.feeSnapshot;
 const bps=rate=>rate!==null&&rate!==undefined&&rate!==''&&Number.isFinite(Number(rate))?new Intl.NumberFormat('ko-KR',{maximumFractionDigits:4}).format(Number(rate)*10000)+'bp':'—';
 const orders=models.map(model=>model?.data?.strategyPlan?.graph?.nodes?.filter(node=>node.type==='ORDER')??[]);
 const limits=orders.map(nodes=>nodes.length?nodes.map(node=>Number.isFinite(node.config?.maxSlippageBps)?node.config.maxSlippageBps+'bp':'미설정').join(' · '):'—');
 const feeLabels=fees.map(item=>'매수 '+bps(item.feeSnapshot?.takerBuyRate)+' · 매도 '+bps(item.feeSnapshot?.takerSellRate));
 return {fee,feeLabel:new Set(feeLabels).size>1?'종목별 관측 수수료':'매수 '+bps(fee?.takerBuyRate)+' · 매도 '+bps(fee?.takerSellRate),feeDetails:fees.map((item,index)=>(item.market??item.instrumentId??'후보 '+(index+1))+' · '+feeLabels[index]).join('; '),slippageLabel:limits.map((value,index)=>(index?'B':'A')+' '+value).join(' · ')};
}
export function simulationEventReturnBasis(value){
 const scope=simulationMarketScope(value),native=value?.report?.nativeQuoteMetrics??value?.nativeQuoteMetrics,currency=native?.quoteCurrency??scope.currency,currencyLabel=currency==='KRW'?'원화':currency;
 if(scope.multiEvent)return {label:currencyLabel+' 계좌 수익률',drawdownLabel:currencyLabel+' 최대 낙폭',help:'공용 '+currencyLabel+' 현금과 현재 보유를 같은 결제 통화로 평가한 수익률입니다. 종목 변경은 보유 청산 후 남은 실제 현금으로 이어지며 각 종목의 관측 수수료를 포함합니다.',nativeLabel:null};
 return {label:'BTC 기준 수익률',drawdownLabel:'BTC 기준 최대 낙폭',help:(scope.currency==='KRW'?'원화':'결제 통화')+' 평가자산을 같은 시각의 BTC 가격으로 환산한 수익률입니다. 매매가 없어도 BTC 가격이 달라지면 환산 수익률은 달라집니다. 수수료는 원래 결제 통화 원장에 기록합니다.',nativeLabel:Number.isFinite(native?.totalReturn)?currencyLabel+' 수익률 '+(native.totalReturn*100).toFixed(2)+'%':null};
}
