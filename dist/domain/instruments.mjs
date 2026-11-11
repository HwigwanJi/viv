/** Instrument identity and selection are independent of a mind's trading rules. */
export const INSTRUMENT_SCHEMA_VERSION = 1;
export const MARKET_TIMEFRAME_MS = Object.freeze({'1m':60000,'3m':180000,'5m':300000,'1h':3600000,'4h':14400000,'1d':86400000});
export const UPBIT_MINUTE_UNITS = Object.freeze({'1m':1,'3m':3,'5m':5,'1h':60,'4h':240});
export const UPBIT_TIMEFRAMES = Object.freeze([...Object.keys(UPBIT_MINUTE_UNITS),'1d']);
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
const cryptoInstrument = (symbol, name) => ({ id: `crypto:okx:${symbol}-USDT`, symbol: `${symbol}-USDT`, name, assetClass: 'crypto', instrumentType: 'SPOT', venue: 'OKX', provider: 'okx', baseAsset: symbol, quoteCurrency: 'USDT', timezone: 'UTC', session: { kind: 'CONTINUOUS', weekdays: [0,1,2,3,4,5,6], calendarStatus: 'CONTINUOUS' }, tick: { kind: 'EXCHANGE_METADATA', value: null, source: 'https://www.okx.com/docs-v5/en/#public-data-rest-api-get-instruments' }, timeframes: ['1h','4h','1d'], defaultTimeframe: '4h', capabilities: { publicCandles: true, authenticatedCandles: false, liveOrders: false, executionAllowed: false } });
const equityInstrument = (venue, symbol, name, currency, timezone, code) => ({ id: `equity:${venue}:${symbol}`, symbol, name, assetClass: 'equity', instrumentType: symbol === 'SPY' ? 'ETF' : 'COMMON_STOCK', venue, provider: 'kis', baseAsset: symbol, quoteCurrency: currency, timezone, ...(code?{kisExchangeCode:code}:{}), session: { kind: 'EXCHANGE_CALENDAR', weekdays: [1,2,3,4,5], regularOpen: currency === 'KRW' ? '09:00' : '09:30', regularClose: currency === 'KRW' ? '15:30' : '16:00', calendarStatus: 'HOLIDAY_AND_EARLY_CLOSE_CALENDAR_REQUIRED' }, tick: { kind: 'BROKER_MARKET_RULE', value: null, source: 'https://apiportal.koreainvestment.com/' }, timeframes: ['1d'], defaultTimeframe: '1d', capabilities: { publicCandles: false, authenticatedCandles: true, liveOrders: false, executionAllowed: false } });
export const INSTRUMENTS = freeze([
  cryptoInstrument('BTC','Bitcoin'), cryptoInstrument('ETH','Ethereum'), cryptoInstrument('SOL','Solana'), cryptoInstrument('XRP','XRP'),
  equityInstrument('NASDAQ','AAPL','Apple','USD','America/New_York','NAS'),
  equityInstrument('NASDAQ','MSFT','Microsoft','USD','America/New_York','NAS'),
  equityInstrument('NYSE_ARCA','SPY','SPDR S&P 500 ETF Trust','USD','America/New_York','AMS'),
  equityInstrument('KRX','005930','삼성전자','KRW','Asia/Seoul','J'),
  equityInstrument('KRX','000660','SK하이닉스','KRW','Asia/Seoul','J'),
]);
const aliases = freeze({ 'equity:NASDAQ:SPY': 'equity:NYSE_ARCA:SPY', BTCUSDT:'crypto:okx:BTC-USDT', 'BTC-USDT':'crypto:okx:BTC-USDT' });
export class InstrumentError extends TypeError { constructor(code, message) { super(message); this.name = 'InstrumentError'; this.code = code; } }
/** Pure identity parsing is not proof of an active listing or investment permission. */
export function getInstrument(id, options={}) {
  const canonical = typeof id === 'string' && Object.hasOwn(aliases,id) ? aliases[id] : id;
  const item = INSTRUMENTS.find(value => value.id === canonical);
  if(typeof canonical==='string'&&/^crypto:upbit:(?:KRW|BTC|USDT)-[A-Z0-9]{1,30}$/.test(canonical)){
    const symbol=canonical.slice('crypto:upbit:'.length),[quoteCurrency,baseAsset]=symbol.split('-');
    const source=options?.resolution?.candidates?.find(row=>row.id===canonical)??options?.snapshot?.instruments?.find(row=>row.id===canonical);
    return {id:canonical,symbol,name:source?.name||symbol,...(source?.englishName?{englishName:source.englishName}:{}),assetClass:'crypto',instrumentType:'SPOT',venue:'UPBIT',exchange:'upbit',provider:'upbit',baseAsset,quoteCurrency,timezone:'UTC',session:{kind:'CONTINUOUS',weekdays:[0,1,2,3,4,5,6],calendarStatus:'CONTINUOUS'},tick:{kind:'EXCHANGE_METADATA',value:null,source:'https://docs.upbit.com/kr/reference/list-trading-pairs'},timeframes:[...UPBIT_TIMEFRAMES],defaultTimeframe:'4h',capabilities:{publicCandles:true,authenticatedCandles:false,liveOrders:false,executionAllowed:false},identityPolicy:'UPBIT_CANONICAL_PAIR_IDENTITY_V1'};
  }
  if(!item&&typeof canonical==='string'&&/^equity:(?:KRX|NASDAQ|NYSE|NYSE_ARCA|AMEX|US_ETC):[A-Z0-9.\-]{1,32}$/.test(canonical)){
    const [,venue,symbol]=canonical.split(':'),korea=venue==='KRX';if(korea&&!/^(?:[A-Z0-9]{6}|[A-Z0-9]{8})$/.test(symbol))throw new InstrumentError('INSTRUMENT_NOT_FOUND','국내 주식의 정식 종목 코드를 확인하세요.');
    const source=options?.resolution?.candidates?.find(row=>row.id===canonical)??options?.snapshot?.instruments?.find(row=>row.id===canonical)??options?.snapshot?.instrumentMappings?.find(row=>row.instrumentId===canonical);
    return {...equityInstrument(venue,symbol,source?.name||symbol,korea?'KRW':'USD',korea?'Asia/Seoul':'America/New_York',({KRX:'J',NASDAQ:'NAS',NYSE:'NYS',NYSE_ARCA:'AMS',AMEX:'AMS'})[venue]),...source,id:canonical,instrumentType:source?.instrumentType??'UNSPECIFIED',marketCountry:korea?'KR':'US',identityPolicy:'EQUITY_VENUE_SYMBOL_IDENTITY_V1'};
  }
  if (!item) throw new InstrumentError('INSTRUMENT_NOT_FOUND','등록된 종목을 선택하세요.');
  const source=options?.resolution?.candidates?.find(row=>row.id===canonical)??options?.snapshot?.instruments?.find(row=>row.id===canonical);
  return {...structuredClone(item),...structuredClone(source??{}),id:canonical,capabilities:structuredClone(item.capabilities)};
}
export function listInstruments(options={}) {const rows=structuredClone(INSTRUMENTS);for(const item of options?.resolution?.candidates||[])if(!rows.some(row=>row.id===item.id))rows.push(getInstrument(item.id,options));return rows;}
/** Optional liquidity metrics must carry a recent, source-backed observation. */
export function selectInstrumentUniverse(selection, { metrics = [], now = new Date().toISOString(), maxMetricAgeMs = 300000 } = {}) {
  const fail = () => { throw new InstrumentError('INVALID_UNIVERSE','종목 선정 방식과 필터를 확인하세요.'); };
  if (!selection || typeof selection !== 'object' || Array.isArray(selection) || !['single','universe'].includes(selection.mode)) fail();
  if (Object.keys(selection).some(key => !['mode','instrumentId','instrumentIds','assetClasses','venues','quoteCurrencies','minQuoteVolume','maxSpreadBps','limit'].includes(key))) fail();
  for (const key of ['instrumentIds','assetClasses','venues','quoteCurrencies']) if (selection[key] !== undefined && (!Array.isArray(selection[key]) || selection[key].some(value => typeof value !== 'string') || new Set(selection[key]).size !== selection[key].length)) fail();
  for (const key of ['minQuoteVolume','maxSpreadBps']) if (selection[key] !== undefined && (!Number.isFinite(selection[key]) || selection[key] < 0)) fail();
  if (!Number.isFinite(Date.parse(now)) || !Number.isInteger(maxMetricAgeMs) || maxMetricAgeMs < 0 || selection.limit !== undefined && (!Number.isInteger(selection.limit) || selection.limit < 1 || selection.limit > 100)) fail();
  if (selection.mode === 'single' && (typeof selection.instrumentId !== 'string' || selection.instrumentIds !== undefined)) fail();
  const requested = selection.mode === 'single' ? [getInstrument(selection.instrumentId)] : selection.instrumentIds ? selection.instrumentIds.map(getInstrument) : listInstruments();
  if (new Set(requested.map(item=>item.id)).size !== requested.length) fail();
  const selected = [], excluded = [];
  for (const item of requested) {
    const reasons = [];
    for (const [key,field] of [['assetClasses','assetClass'],['venues','venue'],['quoteCurrencies','quoteCurrency']]) if (selection[key]?.length && !selection[key].includes(item[field])) reasons.push(`FILTER_${key.toUpperCase()}`);
    if (selection.minQuoteVolume !== undefined || selection.maxSpreadBps !== undefined) {
      const metric = metrics.find(value => value.instrumentId === item.id), age = Date.parse(now) - Date.parse(metric?.asOf);
      if (!metric || !Number.isFinite(age) || age < 0 || age > maxMetricAgeMs || typeof metric.sourceHash !== 'string' || !/^[a-f0-9]{64}$/.test(metric.sourceHash)) reasons.push('LIQUIDITY_DATA_REQUIRED');
      else {
        if (selection.minQuoteVolume !== undefined && (!Number.isFinite(metric.quoteVolume) || metric.quoteVolume < selection.minQuoteVolume || metric.quoteCurrency !== item.quoteCurrency)) reasons.push('QUOTE_VOLUME_FILTER');
        if (selection.maxSpreadBps !== undefined && (!Number.isFinite(metric.spreadBps) || metric.spreadBps < 0 || metric.spreadBps > selection.maxSpreadBps)) reasons.push('SPREAD_FILTER');
      }
    }
    if (reasons.length) excluded.push({instrumentId:item.id,reasons}); else selected.push(item);
  }
  return { schemaVersion:1, mode:selection.mode, asOf:new Date(now).toISOString(), instruments:selected.slice(0,selection.limit ?? 100), excluded, selectionPolicy:'CATALOG_ORDER_FILTERS_V1' };
}
