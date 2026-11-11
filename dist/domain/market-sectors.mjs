/** Pure supplied-response normalization; no transport, credentials or writes. */
import {hashInputPackage} from './workspace.mjs';
import {researchSha256} from './research.mjs';

export const SECTOR_CONTRACT='MARKET_SECTOR_SNAPSHOT_V1';
// mind-studio's complete JSON request cap (200KB) is stricter than the
// repository's 500KB source object cap. Include the actual command envelope.
export const SECTOR_IMPORT_REQUEST_BYTE_LIMIT=200000;
export function sectorImportRequestByteLength(snapshot,{expectedRevision=Number.MAX_SAFE_INTEGER}={}){
  return new TextEncoder().encode(JSON.stringify({provider:'toss-import',snapshot,idempotencyKey:'00000000-0000-4000-8000-000000000000',expectedRevision})).length;
}
export const TOSS_TAXONOMY='toss-equity';
export const TOSS_OPENAPI=Object.freeze({version:'1.2.24',url:'https://openapi.tossinvest.com/openapi-docs/latest/openapi.json',sha256:'7e753c21dc4b938d8f9610ce3efd6542783018977cb030e39db5a006f5b59d40'});
const operations=Object.freeze({getSectors:'/api/v1/sectors',getSectorStocks:'/api/v1/sectors/{sectorId}/stocks',getSectorEtfs:'/api/v1/sectors/{sectorId}/etfs',getSectorRankings:'/api/v1/sectors/rankings'});
const plain=v=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.getPrototypeOf(v)===Object.prototype;
const id=v=>typeof v==='string'&&/^[A-Za-z0-9][A-Za-z0-9:._/-]{0,199}$/.test(v);
const providerId=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,40}$/.test(v);
const iso=v=>typeof v==='string'&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString()===v;
const sha=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const text=v=>typeof v==='string'&&v.trim().length>0&&v.length<=500&&!/[\u0000-\u001f]/.test(v);
const decimal=v=>v===null||typeof v==='string'&&v.length<=30&&/^\d+(?:\.\d+)?$/.test(v);
const cmp=(a,b)=>a<b?-1:a>b?1:0;
const clone=v=>structuredClone(v);
function freeze(v){if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;}
export class SectorError extends TypeError{constructor(code,message){super(message);this.name='SectorError';this.code=code;}}
const check=(ok,code,message)=>{if(!ok)throw new SectorError(code,message);};
const seal=v=>freeze({...v,contentHash:hashInputPackage(v)});
const unseal=({contentHash,...value})=>value;
const sealed=v=>plain(v)&&sha(v.contentHash)&&hashInputPackage(unseal(v))===v.contentHash;
export const sectorKey=sectorId=>{check(providerId(sectorId),'SECTOR_ID','공급자의 섹터 ID를 확인하세요.');return 'sector:'+TOSS_TAXONOMY+':'+sectorId;};
export function tossSectorCaptureBody(capture){
  if(typeof capture?.rawBody==='string'&&!Object.hasOwn(capture,'rawBodyChunks'))return capture.rawBody;
  check(!Object.hasOwn(capture??{},'rawBody')&&Array.isArray(capture?.rawBodyChunks)&&capture.rawBodyChunks.length>0&&capture.rawBodyChunks.length<=40&&capture.rawBodyChunks.every(part=>typeof part==='string'&&part.length<=60000),'SECTOR_RAW_BODY','섹터 원문 조각을 확인하세요.');return capture.rawBodyChunks.join('');
}
const captureBodyFields=rawBody=>{if(rawBody.length<=280000)return {rawBody};const rawBodyChunks=[];for(let i=0;i<rawBody.length;i+=60000)rawBodyChunks.push(rawBody.slice(i,i+60000));return {rawBodyChunks};};
function dedupe(rows,key){const result=new Map();for(const row of rows){const k=key(row),prior=result.get(k);check(!prior||hashInputPackage(prior)===hashInputPackage(row),'SECTOR_DUPLICATE_CONFLICT','같은 식별자의 원본 값이 다릅니다.');if(!prior)result.set(k,row);}return [...result.values()];}

function taxonomy(rows){
  check(Array.isArray(rows)&&rows.length<=10000,'SECTOR_TAXONOMY','섹터 목록 응답을 확인하세요.');
  const nodes=dedupe(rows.map(row=>{check(plain(row)&&providerId(row.sectorId)&&text(row.name)&&Number.isInteger(row.depth)&&row.depth>=0&&row.depth<=2&&(row.parentSectorId===null||providerId(row.parentSectorId)),'SECTOR_NODE','분류 ID·이름·계층을 확인하세요.');return {id:sectorKey(row.sectorId),providerSectorId:row.sectorId,name:row.name,depth:row.depth,parentId:row.parentSectorId===null?null:sectorKey(row.parentSectorId)};}),row=>row.id),byId=new Map(nodes.map(row=>[row.id,row]));
  for(const node of nodes){const seen=new Set();let current=node;while(current){check(!seen.has(current.id),'SECTOR_PARENT_CYCLE','상위 분류가 순환합니다.');seen.add(current.id);if(current.parentId!==null)check(byId.has(current.parentId),'SECTOR_PARENT_MISSING','상위 분류 원본이 없습니다.');current=current.parentId===null?null:byId.get(current.parentId);}}
  for(const node of nodes)check(node.depth===0?node.parentId===null:node.parentId!==null&&byId.get(node.parentId).depth===node.depth-1,'SECTOR_PARENT_DEPTH','상위 분류와 단계가 맞지 않습니다.');
  return nodes.sort((a,b)=>a.depth-b.depth||cmp(a.providerSectorId,b.providerSectorId));
}
function symbols(rows,country,etf){
  check(Array.isArray(rows)&&rows.length<=10000,'SECTOR_SYMBOLS','구성 종목 배열을 확인하세요.');
  return dedupe(rows.map(row=>{
    check(plain(row)&&typeof row.symbol==='string'&&(country==='KR'?/^(?:[A-Za-z0-9]{6}|[A-Za-z0-9]{8})$/:/^[A-Za-z0-9.\-]{1,32}$/).test(row.symbol)&&text(row.name),'SECTOR_SYMBOL','종목 심볼·이름을 확인하세요.');
    const base={symbol:row.symbol.toUpperCase(),name:row.name};if(etf)return base;
    check(decimal(row.volume)&&decimal(row.tradingAmount)&&decimal(row.marketCapitalization)&&typeof row.currency==='string'&&/^[A-Z]{3}$/.test(row.currency),'SECTOR_DECIMAL','금액 원문 문자열·통화를 확인하세요.');
    return {...base,volume:row.volume,tradingAmount:row.tradingAmount,marketCapitalization:row.marketCapitalization,currency:row.currency};
  }),row=>row.symbol).sort((a,b)=>cmp(a.symbol,b.symbol));
}
function rankings(rows){
 check(Array.isArray(rows)&&rows.length<=100,'SECTOR_RANKINGS','섹터 순위 목록을 확인하세요.');
 const values=rows.map(row=>{check(plain(row)&&Number.isInteger(row.rank)&&row.rank>=1&&row.rank<=100&&providerId(row.sectorId)&&text(row.name)&&typeof row.changeRate==='string'&&/^-?\d+(?:\.\d+)?$/.test(row.changeRate)&&row.changeRate.length<=30&&Number.isFinite(Number(row.changeRate))&&decimal(row.tradingAmount)&&decimal(row.marketCapitalization)&&['KRW','USD'].includes(row.currency),'SECTOR_RANKING_ROW','섹터 순위·등락률·금액 원문을 확인하세요.');return {rank:row.rank,sectorId:sectorKey(row.sectorId),name:row.name,changeRate:row.changeRate,tradingAmount:row.tradingAmount,marketCapitalization:row.marketCapitalization,currency:row.currency};});
 check(new Set(values.map(row=>row.rank)).size===values.length&&new Set(values.map(row=>row.sectorId)).size===values.length,'SECTOR_RANKING_DUPLICATE','섹터 순위와 식별자의 중복을 확인하세요.');return values.sort((a,b)=>a.rank-b.rank);
}

export function normalizeTossSectorCapture({id:captureId,operation,params={},rawBody,requestStartedAt,receivedAt,availableAt,httpStatus=200,expectedRawBodySha256=null,origin='SYNTHETIC_TEST'}){
  check(id(captureId)&&Object.hasOwn(operations,operation)&&plain(params)&&['SYNTHETIC_TEST','PROVIDER_CAPTURE'].includes(origin),'SECTOR_CAPTURE','원본 식별자·조회 종류를 확인하세요.');
  check(httpStatus===200&&typeof rawBody==='string'&&new TextEncoder().encode(rawBody).byteLength<=2000000,'SECTOR_CAPTURE_HTTP','정상 응답 원문과 크기를 확인하세요.');
  check([requestStartedAt,receivedAt,availableAt].every(iso)&&requestStartedAt<=receivedAt&&receivedAt<=availableAt,'SECTOR_CAPTURE_TIME','요청·수신·사용 가능 시각을 확인하세요.');
  const rawBodySha256=researchSha256(rawBody);check(expectedRawBodySha256===null||expectedRawBodySha256===rawBodySha256,'SECTOR_RAW_HASH','원응답 바이트 해시가 다릅니다.');
  const list=operation==='getSectors',ranking=operation==='getSectorRankings';check(list?Object.keys(params).length===0:ranking?Object.keys(params).length===3&&['KR','US'].includes(params.marketCountry)&&['TOP_GAINERS','MARKET_TRADING_AMOUNT'].includes(params.type)&&['1d','1w','1mo','3mo','6mo','1y'].includes(params.duration):Object.keys(params).length===2&&['KR','US'].includes(params.marketCountry)&&providerId(params.sectorId),'SECTOR_QUERY','시장을 KR·US로 구분하고 문서의 실제 조회 필드만 사용하세요.');
  let body;try{body=JSON.parse(rawBody);}catch{throw new SectorError('SECTOR_JSON','JSON 응답 원문을 확인하세요.');}
  check(plain(body)&&plain(body.result)&&!Object.hasOwn(body,'error'),'SECTOR_ENVELOPE','성공 응답의 result를 확인하세요.');
  const normalized=list?{sectors:taxonomy(body.result.sectors)}:ranking?{rankings:rankings(body.result.rankings)}:operation==='getSectorStocks'?{stocks:symbols(body.result.stocks,params.marketCountry,false)}:{etfs:symbols(body.result.etfs,params.marketCountry,true)};
  return seal({schemaVersion:1,kind:'TOSS_SECTOR_CAPTURE',id:captureId,operation,params:clone(params),origin,transportVerification:'CALLER_RESPONSIBILITY',httpStatus,requestStartedAt,receivedAt,availableAt,sourceAsOf:null,documentation:TOSS_OPENAPI,url:'https://openapi.tossinvest.com'+operations[operation].replace('{sectorId}',encodeURIComponent(params.sectorId||''))+(list?'':ranking?'?'+new URLSearchParams({type:params.type,marketCountry:params.marketCountry,duration:params.duration}):'?marketCountry='+params.marketCountry),...captureBodyFields(rawBody),rawBodySha256,normalized});
}
function assertCapture(capture){
  check(sealed(capture),'SECTOR_CAPTURE_HASH','보관 원본 해시를 확인하세요.');
  const rebuilt=normalizeTossSectorCapture({...capture,rawBody:tossSectorCaptureBody(capture),id:capture.id,expectedRawBodySha256:capture.rawBodySha256});
  check(rebuilt.contentHash===capture.contentHash,'SECTOR_CAPTURE_PROJECTION','정규화 결과와 보관 원문이 다릅니다.');return capture;
}
function normalizeMappings(mappings){
  check(Array.isArray(mappings)&&mappings.length<=10000,'SECTOR_MAPPINGS','종목 식별 매핑 목록을 확인하세요.');
  const rows=dedupe(mappings.map(row=>{check(plain(row)&&id(row.instrumentId)&&row.instrumentId.startsWith('equity:')&&row.assetClass==='equity'&&['COMMON_STOCK','ETF'].includes(row.instrumentType)&&['KR','US'].includes(row.marketCountry)&&typeof row.providerSymbol==='string'&&/^[A-Za-z0-9.\-]{1,32}$/.test(row.providerSymbol)&&sha(row.sourceHash)&&iso(row.availableAt),'SECTOR_INSTRUMENT_MAPPING','주식의 명시적 종목 ID·시장·원본 매핑을 확인하세요.');return {...clone(row),providerSymbol:row.providerSymbol.toUpperCase()};}),row=>row.instrumentId).sort((a,b)=>cmp(a.instrumentId,b.instrumentId));
  const bySymbol=new Map();for(const row of rows){const parts=row.instrumentId.split(':'),country={KRX:'KR',NASDAQ:'US',NYSE:'US',NYSE_ARCA:'US',AMEX:'US',US_ETC:'US'}[parts[1]];check(parts.length===3&&parts[2]===row.providerSymbol&&country===row.marketCountry,'SECTOR_MAPPING_IDENTITY','정본 종목 ID와 원본 시장·심볼을 일치시키세요.');const key=row.marketCountry+':'+row.providerSymbol;check(!bySymbol.has(key)||bySymbol.get(key)===row.instrumentId,'SECTOR_SYMBOL_AMBIGUOUS','같은 시장·심볼에 서로 다른 종목 ID가 연결됐습니다.');bySymbol.set(key,row.instrumentId);}return rows;
}
function sourceRef(capture){return {captureId:capture.id,operation:capture.operation,marketCountry:capture.params.marketCountry??null,requestedSectorId:capture.params.sectorId?sectorKey(capture.params.sectorId):null,rawBodySha256:capture.rawBodySha256,captureHash:capture.contentHash,receivedAt:capture.receivedAt,availableAt:capture.availableAt};}

/** A new version accumulates independently fetched query scopes while preserving each original capture. */
export function mergeSectorCaptureScopes(previousSnapshots,captures,{asOf,maxAgeMs=86400000}={}){
  check(iso(asOf)&&Number.isSafeInteger(maxAgeMs)&&maxAgeMs>=0&&Array.isArray(previousSnapshots)&&Array.isArray(captures)&&captures.length>0,'SECTOR_MERGE_INPUT','분류 원문의 기준 시각을 확인하세요.');
  const origin=captures[0].origin,scopes=new Map();
  for(const capture of [...previousSnapshots.flatMap(s=>assertSectorSnapshot(s).captures),...captures]){
    assertCapture(capture);if(capture.origin!==origin||capture.availableAt>asOf||Date.parse(asOf)-Date.parse(capture.receivedAt)>maxAgeMs)continue;
    const key=capture.operation+':'+hashInputPackage(capture.params),prior=scopes.get(key);if(!prior||capture.receivedAt>=prior.receivedAt)scopes.set(key,capture);
  }
  const tree=scopes.get('getSectors:'+hashInputPackage({})),known=new Set(tree?.normalized.sectors.map(s=>s.id)??[]);
  return [...scopes.values()].filter(c=>c.operation==='getSectors'||c.operation==='getSectorRankings'?c.operation==='getSectors'||c.normalized.rankings.every(r=>known.has(r.sectorId)):known.has(sectorKey(c.params.sectorId)));
}

export function buildSectorSnapshot({id:snapshotId,version,previousVersionId=null,captures,instrumentMappings=[],availableAt}){
  check(id(snapshotId)&&Number.isSafeInteger(version)&&version>0&&(previousVersionId===null||id(previousVersionId))&&snapshotId!==previousVersionId&&iso(availableAt),'SECTOR_SNAPSHOT_ID','스냅샷 버전·시각을 확인하세요.');
  check(Array.isArray(captures)&&captures.length>0&&captures.length<=1000,'SECTOR_CAPTURE_SET','분류 원본과 조회 원본을 제공하세요.');
  const records=dedupe(captures.map(assertCapture),capture=>capture.id).sort((a,b)=>cmp(a.id,b.id)),scopeKeys=new Set();
  check(new Set(records.map(c=>c.origin)).size===1,'SECTOR_CAPTURE_ORIGIN_MIXED','검사용 자료와 공급원 수신 자료는 별도 스냅샷으로 보관하세요.');
  for(const capture of records){const key=capture.operation+':'+hashInputPackage(capture.params);check(!scopeKeys.has(key),'SECTOR_CAPTURE_SCOPE_DUPLICATE','같은 조회 범위는 한 원본으로 고정하세요.');scopeKeys.add(key);check(capture.availableAt<=availableAt,'SECTOR_SNAPSHOT_AVAILABILITY','모든 원본의 사용 가능 시각 이후에 스냅샷을 고정하세요.');}
  const trees=records.filter(c=>c.operation==='getSectors');check(trees.length===1,'SECTOR_TAXONOMY_REQUIRED','전체 분류 트리 원본 하나를 고정하세요.');
  const sectors=trees[0].normalized.sectors,known=new Set(sectors.map(s=>s.id)),mappings=normalizeMappings(instrumentMappings),bySymbol=new Map(mappings.map(m=>[m.marketCountry+':'+m.providerSymbol,m]));
  for(const mapping of mappings)check(mapping.availableAt<=availableAt,'SECTOR_MAPPING_AVAILABILITY','식별 매핑의 사용 가능 시각 이후에 고정하세요.');
  const stocks=[],etfs=[],unmapped=[],coverage=[],rankingRows=[];
  for(const capture of records.filter(c=>c.operation==='getSectorRankings'))for(const row of capture.normalized.rankings){check(known.has(row.sectorId),'SECTOR_RANKING_TAXONOMY','순위에 포함된 섹터의 공식 분류를 확인하세요.');rankingRows.push({...clone(row),...clone(capture.params),sourceRef:capture.id,availableAt:capture.availableAt});}
  for(const capture of records.filter(c=>['getSectorStocks','getSectorEtfs'].includes(c.operation))){
    const sectorId=sectorKey(capture.params.sectorId),country=capture.params.marketCountry,isEtf=capture.operation==='getSectorEtfs',rows=isEtf?capture.normalized.etfs:capture.normalized.stocks;
    check(known.has(sectorId),'SECTOR_UNKNOWN_PARENT_SCOPE','조회한 섹터가 고정 분류 트리에 없습니다.');
    coverage.push({operation:capture.operation,sectorId,marketCountry:country,includesDescendants:!isEtf,sourceRef:capture.id,resultCount:rows.length});
    for(const row of rows){const mapping=bySymbol.get(country+':'+row.symbol),base={sectorId,marketCountry:country,providerSymbol:row.symbol,sourceRef:capture.id};
      if(!mapping){unmapped.push({...base,reason:'INSTRUMENT_MAPPING_REQUIRED'});continue;}
      check(mapping.instrumentType===(isEtf?'ETF':'COMMON_STOCK'),'SECTOR_INSTRUMENT_TYPE','보통주 소속과 ETF 관련 관계를 구별하세요.');
      const edge={...base,instrumentId:mapping.instrumentId,relation:isEtf?'RELATED_ETF_DIRECT':'MEMBER_INCLUDING_DESCENDANTS'};(isEtf?etfs:stocks).push(edge);
    }
  }
  const order=(a,b)=>cmp(a.sectorId,b.sectorId)||cmp(a.marketCountry,b.marketCountry)||cmp(a.instrumentId||a.providerSymbol,b.instrumentId||b.providerSymbol)||cmp(a.sourceRef,b.sourceRef),received=records.map(c=>c.receivedAt).sort(cmp),started=records.map(c=>c.requestStartedAt).sort(cmp);
  return seal({schemaVersion:1,contractVersion:SECTOR_CONTRACT,id:snapshotId,version,previousVersionId,taxonomyId:TOSS_TAXONOMY,asOf:received.at(-1),asOfKind:'LAST_RESPONSE_RECEIVED',sourceAsOf:null,availableAt,captureWindow:{startedAt:started[0],completedAt:received.at(-1)},documentation:TOSS_OPENAPI,evidenceMode:records.every(c=>c.origin==='SYNTHETIC_TEST')?'SYNTHETIC_TEST':'SUPPLIED_PROVIDER_CAPTURE',sectors:clone(sectors),stockMemberships:stocks.sort(order),etfRelations:etfs.sort(order),unmapped:unmapped.sort(order),coverage:coverage.sort((a,b)=>cmp(a.sourceRef,b.sourceRef)),instrumentMappings:mappings,mappingHash:hashInputPackage(mappings),sourceRefs:records.map(sourceRef),captures:clone(records),...(records.some(c=>c.operation==='getSectorRankings')?{rankings:rankingRows}:{} )});
}

export function assertSectorSnapshot(snapshot){
  check(sealed(snapshot)&&snapshot.contractVersion===SECTOR_CONTRACT&&snapshot.schemaVersion===1,'SECTOR_SNAPSHOT_HASH','스냅샷 계약·해시를 확인하세요.');
  const rebuilt=buildSectorSnapshot({id:snapshot.id,version:snapshot.version,previousVersionId:snapshot.previousVersionId,captures:snapshot.captures,instrumentMappings:snapshot.instrumentMappings,availableAt:snapshot.availableAt});
  check(rebuilt.contentHash===snapshot.contentHash,'SECTOR_SNAPSHOT_PROJECTION','정본과 파생 관계를 다시 대조하세요.');return snapshot;
}
/** Import diagnostics keep the supplied object untouched. The canonical source
 * validator remains the final authority for hashes, mappings and projections. */
export function parseSectorSnapshotImport(text,{expectedRevision=Number.MAX_SAFE_INTEGER}={}){
  let snapshot;try{snapshot=JSON.parse(text);}catch{throw new SectorError('SECTOR_IMPORT_JSON','JSON 형식을 읽을 수 없습니다. 입력 내용을 확인하고 앱의 섹터 양식으로 만든 수집본 전체 JSON을 다시 가져오세요.');}
  const requestBytes=sectorImportRequestByteLength(snapshot,{expectedRevision});
  if(requestBytes>SECTOR_IMPORT_REQUEST_BYTE_LIMIT){const error=new SectorError('SECTOR_IMPORT_SIZE','섹터 자료의 저장 요청이 '+requestBytes.toLocaleString('ko-KR')+'바이트로 200,000바이트 한도를 넘었습니다. 수집 범위를 좁혀 만든 스냅샷 전체를 다시 가져오세요.');error.requestBytes=requestBytes;error.byteLimit=SECTOR_IMPORT_REQUEST_BYTE_LIMIT;throw error;}
  const fields=['schemaVersion','contractVersion','id','version','previousVersionId','taxonomyId','asOf','asOfKind','sourceAsOf','availableAt','captureWindow','documentation','evidenceMode','sectors','stockMemberships','etfRelations','unmapped','coverage','instrumentMappings','mappingHash','sourceRefs','captures','contentHash'];
  const missing=fields.filter(field=>!plain(snapshot)||!Object.hasOwn(snapshot,field));
  if(missing.length){const error=new SectorError('SECTOR_IMPORT_FIELDS','섹터 스냅샷에 필요한 자료가 없습니다. 필수 항목: '+missing.join(', ')+'. 앱의 섹터 양식으로 만든 수집본 전체 JSON을 다시 가져오세요.');error.missingFields=missing;throw error;}
  check(snapshot.schemaVersion===1&&snapshot.contractVersion===SECTOR_CONTRACT,'SECTOR_IMPORT_CONTRACT','섹터 스냅샷 형식은 '+SECTOR_CONTRACT+' · schemaVersion 1입니다. 해당 형식으로 저장한 수집본 전체 JSON을 가져오세요.');
  const badTimes=['asOf','availableAt'].filter(field=>!iso(snapshot[field]));
  if(!plain(snapshot.captureWindow))badTimes.push('captureWindow');else for(const field of ['startedAt','completedAt'])if(!iso(snapshot.captureWindow[field]))badTimes.push('captureWindow.'+field);
  check(Array.isArray(snapshot.captures)&&snapshot.captures.length>0,'SECTOR_IMPORT_CAPTURES','섹터 분류와 구성 종목의 수집 원본이 필요합니다. captures를 포함한 스냅샷 전체 JSON을 다시 가져오세요.');
  snapshot.captures.forEach((capture,index)=>{for(const field of ['requestStartedAt','receivedAt','availableAt'])if(!iso(capture?.[field]))badTimes.push('captures['+index+'].'+field);});
  if(badTimes.length){const error=new SectorError('SECTOR_IMPORT_TIME','섹터 자료의 수집 시각을 확인할 수 없습니다: '+badTimes.join(', ')+'. 수집 시각을 보존한 스냅샷 전체를 다시 가져오세요.');error.invalidTimeFields=badTimes;throw error;}
  for(const [index,capture]of snapshot.captures.entries()){
    check(sha(capture.rawBodySha256)&&researchSha256(tossSectorCaptureBody(capture))===capture.rawBodySha256,'SECTOR_IMPORT_RAW_HASH','수집 원본 captures['+index+']의 원문 검증값이 일치하지 않아 저장할 수 없습니다. 수집한 원문과 함께 보관한 스냅샷 전체를 다시 가져오세요.');
  }
  check(sealed(snapshot),'SECTOR_IMPORT_HASH','스냅샷 전체의 검증값이 일치하지 않아 저장할 수 없습니다. 수집한 섹터 스냅샷 전체를 다시 가져오세요.');
  return assertSectorSnapshot(snapshot);
}
export function sectorSnapshotRef(snapshot){assertSectorSnapshot(snapshot);return {id:snapshot.id,version:snapshot.version,contentHash:snapshot.contentHash};}

export function selectSectorSnapshot(snapshots,{asOf,expectedRef=null,maxAgeMs=86400000}={}){
  check(iso(asOf)&&Number.isSafeInteger(maxAgeMs)&&maxAgeMs>=0,'SECTOR_READ_TIME','조회 시각과 허용 자료 나이를 확인하세요.');
  check(Array.isArray(snapshots),'SECTOR_SNAPSHOT_SET','보관 스냅샷 목록을 확인하세요.');
  const rows=dedupe(snapshots.map(assertSectorSnapshot),s=>s.id+':'+s.version);
  if(expectedRef)check(id(expectedRef.id)&&Number.isSafeInteger(expectedRef.version)&&sha(expectedRef.contentHash),'SECTOR_PIN','고정 스냅샷 참조를 확인하세요.');
  const matching=expectedRef?rows.filter(s=>s.id===expectedRef.id&&s.version===expectedRef.version&&s.contentHash===expectedRef.contentHash):rows;
  const valid=matching.filter(s=>s.asOf<=asOf&&s.availableAt<=asOf&&s.sourceRefs.every(r=>r.receivedAt<=asOf&&r.availableAt<=asOf)&&s.instrumentMappings.every(m=>m.availableAt<=asOf)).sort((a,b)=>cmp(b.availableAt,a.availableAt)||b.version-a.version||cmp(a.id,b.id));
  const snapshot=valid[0];if(!snapshot)return {status:expectedRef&&!matching.length?'PIN_NOT_FOUND':'HISTORY_UNAVAILABLE',snapshot:null,ref:expectedRef,reasons:['사용 가능한 시점의 고정 섹터 원본이 없습니다.']};
  if(snapshot.sourceRefs.some(ref=>Date.parse(asOf)-Date.parse(ref.receivedAt)>maxAgeMs))return {status:'STALE',snapshot:null,ref:sectorSnapshotRef(snapshot),reasons:['섹터 원본이 허용 자료 나이를 지났습니다.']};
  return {status:'READY',snapshot,ref:sectorSnapshotRef(snapshot),reasons:[]};
}

export function instrumentSectorContext(snapshots,{instrumentId,asOf,expectedRef=null,maxAgeMs=86400000}={}){
  check(id(instrumentId),'SECTOR_INSTRUMENT','종목 ID를 확인하세요.');
  if(instrumentId.startsWith('crypto:'))return {status:'NOT_APPLICABLE',instrumentId,taxonomyId:TOSS_TAXONOMY,stockSectorIds:[],relatedEtfSectorIds:[],sourceRefs:[],snapshotRef:null};
  const selected=selectSectorSnapshot(snapshots,{asOf,expectedRef,maxAgeMs});if(!selected.snapshot)return {...selected,instrumentId,stockSectorIds:[],relatedEtfSectorIds:[],sourceRefs:[]};
  const s=selected.snapshot,mapping=s.instrumentMappings.find(m=>m.instrumentId===instrumentId);if(!mapping)return {status:'MAPPING_REQUIRED',instrumentId,stockSectorIds:[],relatedEtfSectorIds:[],sourceRefs:[],snapshotRef:selected.ref};
  const stocks=s.stockMemberships.filter(e=>e.instrumentId===instrumentId),etfs=s.etfRelations.filter(e=>e.instrumentId===instrumentId),byId=new Map(s.sectors.map(node=>[node.id,node])),stockIds=new Set();
  for(const edge of stocks){let node=byId.get(edge.sectorId);while(node){stockIds.add(node.id);node=node.parentId?byId.get(node.parentId):null;}}
  return {status:'READY',instrumentId,taxonomyId:s.taxonomyId,marketCountry:mapping.marketCountry,instrumentType:mapping.instrumentType,asOf:s.asOf,asOfKind:s.asOfKind,sourceAsOf:null,availableAt:s.availableAt,snapshotRef:selected.ref,stockSectorIds:[...stockIds].sort(cmp),relatedEtfSectorIds:[...new Set(etfs.map(e=>e.sectorId))].sort(cmp),stockRelations:clone(stocks),etfRelations:clone(etfs),sourceRefs:s.sourceRefs.filter(ref=>stocks.some(e=>e.sourceRef===ref.captureId)||etfs.some(e=>e.sourceRef===ref.captureId)),coverage:clone(s.coverage.filter(row=>row.marketCountry===mapping.marketCountry))};
}

/** Apply only to coverage from a validated snapshot at its selected source time. */
export function hasSectorMembershipCoverage(coverage,{sectorId,marketCountry,instrumentType}){
  const operation=instrumentType==='ETF'?'getSectorEtfs':'getSectorStocks';
  return coverage.some(row=>row.operation===operation&&row.sectorId===sectorId&&row.marketCountry===marketCountry);
}

/** All consumers use this tri-state predicate: unknown coverage is never an implicit match. */
export function matchSectorCoverage(snapshots,{instrumentId,sectorIds,asOf,expectedRef=null,maxAgeMs=86400000,includeRelatedEtfs=false}={}){
  check(Array.isArray(sectorIds)&&sectorIds.length>0&&new Set(sectorIds).size===sectorIds.length&&sectorIds.every(v=>typeof v==='string'&&v.startsWith('sector:'+TOSS_TAXONOMY+':')),'SECTOR_SCOPE','공급자 분류 ID로 범위를 지정하세요.');
  const context=instrumentSectorContext(snapshots,{instrumentId,asOf,expectedRef,maxAgeMs});if(context.status!=='READY')return {status:context.status,match:null,context};
  const found=new Set([...context.stockSectorIds,...(includeRelatedEtfs?context.relatedEtfSectorIds:[])]),matchedSectorIds=sectorIds.filter(v=>found.has(v));if(matchedSectorIds.length)return {status:'MATCH',match:true,matchedSectorIds,context};
  const covered=sectorIds.every(sectorId=>hasSectorMembershipCoverage(context.coverage,{sectorId,marketCountry:context.marketCountry,instrumentType:context.instrumentType}));
  return {status:covered?'NO_MATCH':'COVERAGE_REQUIRED',match:covered?false:null,matchedSectorIds:[],context};
}
