import {loadInstrumentMarket} from './instrument-market.mjs';
import {hashInputPackage as hash} from '../dist/domain/workspace.mjs';
import {researchSha256} from '../dist/domain/research.mjs';
/** Same closed-candle provider as strategy queries; no invented market or account input. */
export async function readRegimeProgramInputs(classifier,{marketLoader=loadInstrumentMarket,clock=()=>new Date().toISOString(),env={},fetchImpl=fetch}={}){
 const inputs={},keys=classifier.kind==='AXES'?[classifier.x.input,classifier.y.input]:classifier.inputs;
 for(const key of keys){const source=classifier.inputBindings?.[key];if(source?.kind!=='MARKET')throw Object.assign(Error('입력 변수 '+key+'의 자료 공급원을 연결하세요.'),{code:'REGIME_INPUT_SOURCE'});
  const market=await marketLoader({...source,limit:source.lookbackBars,env,fetchImpl,now:clock}),now=clock(),bars=market.bars;
  if(market.status!=='READY'||market.instrument?.id!==source.instrumentId||market.timeframe!==source.timeframe||!Array.isArray(bars)||bars.length<source.lookbackBars||researchSha256(JSON.stringify(bars))!==market.source?.barsSha256||bars.some(b=>!b.isClosed||b.closeTime>now))throw Object.assign(Error('판단 자료의 종목·확정 시각·원문을 대조하세요.'),{code:'REGIME_MARKET_SOURCE'});
  const value={instrumentId:source.instrumentId,timeframe:source.timeframe,bars:structuredClone(bars),source:structuredClone(market.source)};inputs[key]={value,asOf:bars.at(-1).closeTime,availableAt:now,sourceHash:hash(value)};
 }return inputs;
}
