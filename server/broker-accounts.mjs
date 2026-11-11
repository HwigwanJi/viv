const enc=new TextEncoder(),dec=new TextDecoder();
const providers=['toss','upbit'];
const check=(ok,code,message,status=400)=>{if(!ok)throw Object.assign(new Error(message),{code,status});};
const b64=bytes=>btoa(String.fromCharCode(...new Uint8Array(bytes)));
const un64=value=>Uint8Array.from(atob(value),c=>c.charCodeAt(0));
const url64=bytes=>b64(bytes).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
const numeric=v=>v!==null&&v!==undefined&&v!==''&&Number.isFinite(Number(v))?Number(v):null;
const providerTimestamp=value=>{const ms=numeric(value);return ms!==null&&ms>0&&Number.isFinite(new Date(ms).getTime())?new Date(ms).toISOString():null;};
const mask=value=>'••••'+String(value).slice(-4);
async function vaultKey(env){check(typeof env.BROKER_VAULT_KEY==='string'&&env.BROKER_VAULT_KEY.length>=32,'VAULT_REQUIRED','계좌 연결 저장소를 준비하고 있습니다.',503);return crypto.subtle.importKey('raw',await crypto.subtle.digest('SHA-256',enc.encode(env.BROKER_VAULT_KEY)),{name:'AES-GCM'},false,['encrypt','decrypt']);}
export async function sealBrokerCredential(value,owner,provider,env){const iv=crypto.getRandomValues(new Uint8Array(12)),key=await vaultKey(env),cipher=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:enc.encode(owner+':'+provider)},key,enc.encode(JSON.stringify(value)));return {iv:b64(iv),cipher:b64(cipher)};}
export async function openBrokerCredential(value,owner,provider,env){const key=await vaultKey(env);return JSON.parse(dec.decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:un64(value.iv),additionalData:enc.encode(owner+':'+provider)},key,un64(value.cipher))));}
export async function upbitAccountToken(accessKey,secretKey){const head=url64(enc.encode(JSON.stringify({alg:'HS512',typ:'JWT'}))),body=url64(enc.encode(JSON.stringify({access_key:accessKey,nonce:crypto.randomUUID()}))),input=head+'.'+body,key=await crypto.subtle.importKey('raw',enc.encode(secretKey),{name:'HMAC',hash:'SHA-512'},false,['sign']);return input+'.'+url64(await crypto.subtle.sign('HMAC',key,enc.encode(input)));}
async function providerJson(fetchImpl,url,options={}){let response;try{response=await fetchImpl(url,{...options,redirect:'error',signal:AbortSignal.timeout(20000)});}catch{throw Object.assign(new Error('금융기관 연결이 지연됩니다. 잠시 후 다시 조회하세요.'),{code:'BROKER_UNREACHABLE',status:502});}check(response.ok,'BROKER_HTTP_'+response.status,response.status===403?'금융기관에 등록한 허용 IP를 확인하세요.':response.status===401?'API 키와 조회 권한을 확인하세요.':response.status===429?'금융기관 조회 한도에 도달했습니다. 잠시 후 다시 조회하세요.':'금융기관 조회에 실패했습니다. 연결 상태를 확인하세요.',response.status===429?429:502);return response.json();}
async function tossAccessToken(credential,{fetchImpl,now}){
 if(!credential.accessToken||Date.parse(credential.expiresAt??0)<=Date.parse(now)){const auth=await providerJson(fetchImpl,'https://openapi.tossinvest.com/oauth2/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'client_credentials',client_id:credential.clientId,client_secret:credential.clientSecret}).toString()});check(typeof auth.access_token==='string'&&Number.isFinite(auth.expires_in),'BROKER_TOKEN_RESPONSE','토스증권 인증 응답을 확인하세요.',502);credential.accessToken=auth.access_token;credential.expiresAt=new Date(Date.parse(now)+Math.max(1,auth.expires_in-60)*1000).toISOString();}
 return credential.accessToken;
}
export async function readBrokerAccount(provider,credential,{fetchImpl=fetch,now=new Date().toISOString()}={}){
 if(provider==='upbit'){
  const token=await upbitAccountToken(credential.accessKey,credential.secretKey),rows=await providerJson(fetchImpl,'https://api.upbit.com/v1/accounts',{headers:{Authorization:'Bearer '+token}});
  check(Array.isArray(rows),'BROKER_RESPONSE','업비트 잔고 응답을 확인하세요.',502);
  const balances=rows.map(r=>({currency:r.currency,available:numeric(r.balance),locked:numeric(r.locked),averagePurchasePrice:numeric(r.avg_buy_price),costCurrency:r.unit_currency}));
  check(balances.every(r=>typeof r.currency==='string'&&r.available!==null&&r.available>=0&&r.locked!==null&&r.locked>=0),'BROKER_RESPONSE','업비트 잔고 단위를 확인하세요.',502);
  const quoteAssetBalances=balances.filter(r=>['BTC','USDT'].includes(r.currency)).map(r=>({currency:r.currency,available:r.available,locked:r.locked,quantity:r.available+r.locked,asOf:now}));
  const holdings=balances.filter(r=>r.currency!=='KRW'&&(r.available+r.locked)>0);let supported=null,prices=[];
  // Resolve listed KRW pairs before batching: one delisted asset must not invalidate other quotes.
  if(holdings.length)try{
   const markets=await providerJson(fetchImpl,'https://api.upbit.com/v1/market/all');
   check(Array.isArray(markets)&&markets.every(r=>r&&typeof r.market==='string'),'BROKER_MARKET_RESPONSE','업비트 거래쌍 목록을 확인하세요.',502);
   supported=new Set(markets.map(r=>r.market));
  }catch{}
  const quotedMarkets=holdings.map(r=>'KRW-'+r.currency).filter(m=>supported?.has(m));
  if(quotedMarkets.length)try{
   const result=await providerJson(fetchImpl,'https://api.upbit.com/v1/ticker?markets='+encodeURIComponent(quotedMarkets.join(',')));
   if(Array.isArray(result))prices=result;
  }catch{}
  const positions=holdings.map(r=>{
   const market='KRW-'+r.currency,matches=prices.filter(p=>p?.market===market),p=matches.length===1?matches[0]:null,rawPrice=numeric(p?.trade_price),quoteAsOf=providerTimestamp(p?.timestamp),tradeAsOf=providerTimestamp(p?.trade_timestamp);
   const code=supported===null?'MARKET_CATALOG_UNAVAILABLE':!supported.has(market)?'MARKET_UNAVAILABLE':matches.length===0?'QUOTE_UNAVAILABLE':!p||rawPrice===null||rawPrice<=0||!quoteAsOf?'QUOTE_INVALID':null;
   const messages={MARKET_CATALOG_UNAVAILABLE:'원화 거래쌍 목록을 조회하지 못했습니다.',MARKET_UNAVAILABLE:'업비트 원화 거래쌍이 없어 평가액을 계산할 수 없습니다.',QUOTE_UNAVAILABLE:'현재 시세를 조회하지 못했습니다.',QUOTE_INVALID:'시세의 가격 또는 기준 시각을 확인할 수 없습니다.'};
   const price=code?null:rawPrice;
   return {symbol:r.currency,market,currency:'KRW',quantity:r.available+r.locked,availableQuantity:r.available,lockedQuantity:r.locked,averagePurchasePrice:r.averagePurchasePrice,marketPrice:price,marketValue:price===null?null:price*(r.available+r.locked),valuationStatus:code?'UNAVAILABLE':'CURRENT',valuationReason:code?{code,message:messages[code]}:null,quoteAsOf,tradeAsOf};
  });
  const cash=balances.find(r=>r.currency==='KRW'),complete=positions.every(p=>p.marketValue!==null),available=cash?.available??0,locked=cash?.locked??0,holdingsValue=complete?positions.reduce((n,p)=>n+p.marketValue,0):null;
  const valuationIssues=positions.filter(p=>p.valuationReason).map(p=>({symbol:p.symbol,market:p.market,...p.valuationReason})),valuationAsOf=complete?(positions.map(p=>p.quoteAsOf).sort()[0]??now):null;
  return {provider,asOf:now,mode:'READ_ONLY',accounts:[{id:'upbit',label:'업비트',currencies:[{currency:'KRW',available,locked,cash:available+locked,holdingsValue,equity:holdingsValue===null?null:available+locked+holdingsValue}],quoteAssetBalances,positions}],valuationStatus:complete?'CURRENT':'PARTIAL',valuationAsOf,valuationIssues};
 }
 check(provider==='toss','BROKER_PROVIDER','연결할 금융기관을 선택하세요.');
 // Existing access tokens are reused: issuing another Toss token revokes the previous one.
 const token=await tossAccessToken(credential,{fetchImpl,now});
 return readTossAccountWithToken(token,{fetchImpl,now});
}
export async function readTossAccountWithToken(token,{fetchImpl=fetch,now=new Date().toISOString()}={}){
 const headers={Authorization:'Bearer '+token},accounts=await providerJson(fetchImpl,'https://openapi.tossinvest.com/api/v1/accounts',{headers}),out=[];
 check(Array.isArray(accounts.result)&&accounts.result.length<=20,'BROKER_RESPONSE','토스증권 계좌 목록을 확인하세요.',502);
 for(const a of accounts.result){const h={...headers,'X-Tossinvest-Account':String(a.accountSeq)},holding=await providerJson(fetchImpl,'https://openapi.tossinvest.com/api/v1/holdings',{headers:h}),currencies=[];
  for(const currency of ['KRW','USD']){const bp=await providerJson(fetchImpl,'https://openapi.tossinvest.com/api/v1/buying-power?currency='+currency,{headers:h}),available=numeric(bp.result?.cashBuyingPower),holdingsValue=numeric(holding.result?.marketValue?.amount?.[currency.toLowerCase()]);currencies.push({currency,available,cash:null,locked:null,holdingsValue,equity:null,cashBasis:'CASH_BUYING_POWER'});}
  out.push({id:String(a.accountSeq),label:'토스증권 '+mask(a.accountNo),currencies,positions:(holding.result?.items??[]).map(p=>({symbol:p.symbol,name:p.name,currency:p.currency,quantity:numeric(p.quantity),averagePurchasePrice:numeric(p.averagePurchasePrice),marketPrice:numeric(p.lastPrice),marketValue:numeric(p.marketValue?.amount)}))});
 }
 return {provider:'toss',asOf:now,mode:'READ_ONLY',accounts:out,valuationStatus:'BUYING_POWER_AND_HOLDINGS'};
}
async function initialize(db){await db.batch([db.prepare('CREATE TABLE IF NOT EXISTS broker_connections (owner_id TEXT NOT NULL, provider TEXT NOT NULL, credential TEXT NOT NULL, snapshot TEXT, updated_at TEXT NOT NULL, PRIMARY KEY(owner_id,provider))').bind(),db.prepare('CREATE TABLE IF NOT EXISTS broker_connection_locks (owner_id TEXT NOT NULL, provider TEXT NOT NULL, token TEXT NOT NULL, expires_at INTEGER NOT NULL, PRIMARY KEY(owner_id,provider))').bind()]);}
/** Server-only read transport. The existing account lock protects single-token issuance. */
export async function withTossReadConnection({db,owner,env,fetchImpl=fetch,clock=()=>new Date().toISOString()},read){
 check(owner,'UNAUTHORIZED','로그인이 필요합니다.',401);check(env.BROKER_NETWORK_READY==='true','BROKER_NETWORK_REQUIRED','API 허용 IP와 서버 연결 경로를 먼저 설정하세요.',409);
 await initialize(db);const now=new Date(clock()).toISOString(),nowMs=Date.parse(now),token=crypto.randomUUID();
 const locked=await db.prepare('INSERT INTO broker_connection_locks(owner_id,provider,token,expires_at) VALUES(?,?,?,?) ON CONFLICT(owner_id,provider) DO UPDATE SET token=excluded.token,expires_at=excluded.expires_at WHERE broker_connection_locks.expires_at<=? RETURNING token').bind(owner,'toss',token,nowMs+1800000,nowMs).first();
 check(locked?.token===token,'BROKER_BUSY','계좌 조회가 진행 중입니다. 완료 후 다시 조회하세요.',409);
 try{const row=await db.prepare('SELECT credential FROM broker_connections WHERE owner_id=? AND provider=?').bind(owner,'toss').first();check(row,'BROKER_NOT_CONNECTED','토스증권 계좌를 먼저 연결하세요.',409);
  const credential=await openBrokerCredential(JSON.parse(row.credential),owner,'toss',env),previousExpiry=credential.expiresAt,previousToken=credential.accessToken,accessToken=await tossAccessToken(credential,{fetchImpl,now});
  if(accessToken!==previousToken||credential.expiresAt!==previousExpiry){const sealed=await sealBrokerCredential(credential,owner,'toss',env);await db.prepare('UPDATE broker_connections SET credential=? WHERE owner_id=? AND provider=?').bind(JSON.stringify(sealed),owner,'toss').run();}
  return await read(accessToken);
 }finally{await db.prepare('DELETE FROM broker_connection_locks WHERE owner_id=? AND provider=? AND token=?').bind(owner,'toss',token).run();}
}
export async function tossReadConnectionStatus(db,owner,env){
 await initialize(db);const row=await db.prepare('SELECT provider FROM broker_connections WHERE owner_id=? AND provider=?').bind(owner,'toss').first();
 return {status:row?env.BROKER_NETWORK_READY==='true'?'CONFIGURED':'NETWORK_REQUIRED':'CONNECTION_REQUIRED',collectAvailable:!!row&&env.BROKER_NETWORK_READY==='true',importAvailable:true};
}
/** Server-only Upbit read callback. Signing a read token never changes this credential. */
export async function withUpbitReadConnection({db,owner,env},read){
 check(owner,'UNAUTHORIZED','로그인이 필요합니다.',401);check(env.BROKER_NETWORK_READY==='true','BROKER_NETWORK_REQUIRED','API 허용 IP와 서버 연결 경로를 먼저 설정하세요.',409);
 const row=await db.prepare('SELECT credential FROM broker_connections WHERE owner_id=? AND provider=?').bind(owner,'upbit').first();check(row,'BROKER_NOT_CONNECTED','업비트 계좌를 먼저 연결하세요.',409);
 const credential=await openBrokerCredential(JSON.parse(row.credential),owner,'upbit',env);return read(credential);
}
async function readConnectionBody(request){const reader=request.body?.getReader();check(reader,'BROKER_BODY','연결 입력을 확인하세요.');const chunks=[];let size=0;try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>12000){await reader.cancel();check(false,'BROKER_BODY','연결 입력 길이를 확인하세요.',413);}chunks.push(value);}}finally{reader.releaseLock();}const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}return JSON.parse(dec.decode(bytes));}
export async function handleBrokerAPI(request,env={},options={}){
 const u=new URL(request.url);if(!u.pathname.startsWith('/api/workspace/brokers'))return null;
 const owner=request.headers.get('oai-authenticated-user-id'),json=(value,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store'}});
 let lease=null;
 try{
  check(owner,'UNAUTHORIZED','로그인이 필요합니다.',401);check(!request.headers.get('origin')||request.headers.get('origin')===u.origin,'ORIGIN','앱에서 다시 연결하세요.',403);check(request.headers.get('sec-fetch-site')!=='cross-site','ORIGIN','앱에서 다시 연결하세요.',403);
  const db=env.DB;await initialize(db);const route=u.pathname.slice('/api/workspace/brokers'.length),now=new Date(options.now?.()??Date.now()).toISOString();
  if(request.method==='GET'&&route===''){const rows=await db.prepare('SELECT provider,snapshot,updated_at FROM broker_connections WHERE owner_id=?').bind(owner).all();return json({ok:true,canConnect:!!env.BROKER_VAULT_KEY&&env.BROKER_NETWORK_READY==='true',network:env.BROKER_NETWORK_READY==='true'?'READY':'IP_CONFIGURATION_REQUIRED',execution:'READ_ONLY',egressIp:env.BROKER_EGRESS_IP??null,connections:rows.results.map(r=>({provider:r.provider,updatedAt:r.updated_at,snapshot:r.snapshot?JSON.parse(r.snapshot):null})),providers});}
  check(request.method==='POST'&&['/connect','/refresh','/disconnect'].includes(route),'BROKER_ROUTE','계좌 연결 경로를 확인하세요.',404);
  const body=await readConnectionBody(request);check(providers.includes(body.provider),'BROKER_PROVIDER','금융기관을 선택하세요.');
  const token=crypto.randomUUID(),nowMs=Date.parse(now),locked=await db.prepare('INSERT INTO broker_connection_locks(owner_id,provider,token,expires_at) VALUES(?,?,?,?) ON CONFLICT(owner_id,provider) DO UPDATE SET token=excluded.token,expires_at=excluded.expires_at WHERE broker_connection_locks.expires_at<=? RETURNING token').bind(owner,body.provider,token,nowMs+1800000,nowMs).first();
  check(locked?.token===token,'BROKER_BUSY','계좌 조회가 진행 중입니다. 완료 후 다시 조회하세요.',409);lease={db,provider:body.provider,token};
  if(route==='/disconnect'){await db.prepare('DELETE FROM broker_connections WHERE owner_id=? AND provider=?').bind(owner,body.provider).run();return json({ok:true,disconnected:true});}
  check(env.BROKER_NETWORK_READY==='true','BROKER_NETWORK_REQUIRED','API 허용 IP와 서버 연결 경로를 먼저 설정하세요.',409);
  let credential;if(route==='/connect'){
   credential=body.provider==='upbit'?{accessKey:body.accessKey,secretKey:body.secretKey}:{clientId:body.clientId,clientSecret:body.clientSecret};check(Object.values(credential).every(v=>typeof v==='string'&&v.length>=10&&v.length<=8000),'BROKER_CREDENTIAL','발급받은 키를 입력하세요.');
  }else{const row=await db.prepare('SELECT credential FROM broker_connections WHERE owner_id=? AND provider=?').bind(owner,body.provider).first();check(row,'BROKER_NOT_CONNECTED','계좌를 먼저 연결하세요.',404);credential=await openBrokerCredential(JSON.parse(row.credential),owner,body.provider,env);}
  const snapshot=await readBrokerAccount(body.provider,credential,{fetchImpl:options.fetchImpl,now}),sealed=await sealBrokerCredential(credential,owner,body.provider,env);
  await db.prepare('INSERT INTO broker_connections(owner_id,provider,credential,snapshot,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(owner_id,provider) DO UPDATE SET credential=excluded.credential,snapshot=excluded.snapshot,updated_at=excluded.updated_at').bind(owner,body.provider,JSON.stringify(sealed),JSON.stringify(snapshot),now).run();
  return json({ok:true,snapshot});
 }catch(error){return json({ok:false,code:error.code??'BROKER_CONNECTION_FAILED',message:error.code?error.message:'연결 정보를 확인하고 다시 시도하세요.'},error.status??400);}
 finally{if(lease)await lease.db.prepare('DELETE FROM broker_connection_locks WHERE owner_id=? AND provider=? AND token=?').bind(owner,lease.provider,lease.token).run();}
}
