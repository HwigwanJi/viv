import {loadBinanceMarket,validateMarketSnapshot,getBinanceExecutableQuote,BINANCE_MARKET_VERSION,BINANCE_MARKET_ORIGIN,MarketDataError} from './market.mjs';
import {loadOkxMarket,validateOkxMarketSnapshot,getOkxExecutableQuote,OKX_MARKET_VERSION,OKX_MARKET_ORIGIN} from './okx-market.mjs';

export const MARKET_PROVIDERS=Object.freeze({
  binance:Object.freeze({id:'binance',label:'Binance',origin:BINANCE_MARKET_ORIGIN,loaderVersion:BINANCE_MARKET_VERSION,load:loadBinanceMarket,validate:validateMarketSnapshot,quote:getBinanceExecutableQuote}),
  okx:Object.freeze({id:'okx',label:'OKX',origin:OKX_MARKET_ORIGIN,loaderVersion:OKX_MARKET_VERSION,load:loadOkxMarket,validate:validateOkxMarketSnapshot,quote:getOkxExecutableQuote})
});
export function marketProvider(id){const value=MARKET_PROVIDERS[id];if(!Object.hasOwn(MARKET_PROVIDERS,id))throw new MarketDataError('MARKET_PROVIDER_UNKNOWN','등록된 시세 공급원을 선택하세요.');return value;}
export function configuredMarketProvider(env={}){return marketProvider(env.MARKET_DATA_PROVIDER??'binance').id;}
export function providerForSnapshot(snapshot){
  const manifest=snapshot?.manifest??snapshot?.marketData?.manifest,source=snapshot?.sourceSnapshot??(snapshot?.marketData?snapshot:null);
  const provider=Object.values(MARKET_PROVIDERS).find(p=>p.loaderVersion===manifest?.loaderVersion);
  if(!provider||source?.provider&&source.provider!==provider.id)throw new MarketDataError('MARKET_PROVIDER_UNKNOWN','저장된 시세 원본의 공급원과 수집 계약을 확인하세요.');
  return provider.id;
}
export async function loadPublicMarket({provider='binance',...options}={}){return marketProvider(provider).load(options);}
export function validatePublicMarketSnapshot(snapshot,options={}){try{return marketProvider(providerForSnapshot(snapshot)).validate(snapshot,options);}catch(error){return {ok:false,reasons:[{code:error.code??'MARKET_PROVIDER_UNKNOWN',message:error.message}]};}}
export async function getPublicExecutableQuote({provider='binance',...options}={}){return marketProvider(provider).quote(options);}
