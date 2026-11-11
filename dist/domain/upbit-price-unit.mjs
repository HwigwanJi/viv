export const UPBIT_KRW_PRICE_POLICY='upbit-krw-price-bands-20250731-v1';
export const UPBIT_KRW_PRICE_POLICY_SOURCE='https://docs.upbit.com/kr/docs/krw-market-info';
const scale=10n**18n,units=s=>{const [a,b='']=s.split('.');return BigInt(a)*scale+BigInt(b.padEnd(18,'0'));};
const bands=[['1000000','1000'],['500000','500'],['100000','100'],['50000','50'],['10000','10'],['5000','5'],['1000','1'],['100','1'],['10','0.1'],['1','0.01'],['0.1','0.001'],['0.01','0.0001'],['0.001','0.00001'],['0.0001','0.000001'],['0.00001','0.0000001'],['0','0.00000001']].map(([minimum,tick])=>[units(minimum),tick]);
export function hasUpbitKrwPricePolicy(instrument){
 const source=instrument.constraintSources?.tickSize;
 // The deployment hour on July31 is unspecified; older evidence keeps its captured unit.
 return instrument.venueId==='upbit'&&instrument.quoteAsset==='KRW'&&source?.kind==='PUBLIC_API'&&/^https:\/\/api\.upbit\.com\/v1\/orderbook\/instruments(?:\?|$)/.test(source.source??'')&&Number.isFinite(Date.parse(source.asOf))&&source.asOf>='2025-08-01T00:00:00.000Z';
}
export function instrumentPriceUnit(instrument,priceUnits){
 if(!hasUpbitKrwPricePolicy(instrument))return instrument.tickSize;
 if(['KRW-USDT','KRW-USDC'].includes(instrument.symbol)&&priceUnits>=units('1000')&&priceUnits<units('10000'))return '0.5';
 return bands.find(([minimum])=>priceUnits>=minimum)[1];
}
