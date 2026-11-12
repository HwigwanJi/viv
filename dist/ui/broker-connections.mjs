import {helpLabel,readonlyTooltip} from './help-tooltip.mjs';
import {renderDataTable} from './data-table.mjs';
import {PAPER_HOME_ENTRY,paperResultReturnHash} from '../system/paper-decision-links.mjs';
const names={toss:'토스증권',upbit:'업비트'};
const urls={toss:'https://www.tossinvest.com/open-api/landing',upbit:'https://upbit.com/mypage/open_api_management'};
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=v=>Number.isFinite(v)?new Intl.NumberFormat('ko-KR',{maximumFractionDigits:2}).format(v):'—';
const quantity=(value,symbol,label,detailLabel='조회 수량')=>Number.isFinite(value)?`<span class="tabular-nums whitespace-nowrap" tabindex="0" aria-label="${esc(label+' '+String(value)+' '+symbol)}">${readonlyTooltip(new Intl.NumberFormat('ko-KR',{maximumSignificantDigits:15}).format(value),detailLabel+': '+String(value)+' '+symbol)}</span>`:'—';
const button=(label,action,id='',disabled=false)=>`<button type="button" class="button small" data-broker-action="${action}" data-broker-provider="${id}" ${disabled?'disabled':''}>${label}</button>`;
const table=(headers,rows)=>renderDataTable(headers.map((header,i)=>({...(typeof header==='string'?{label:header}:header),numeric:i>0})),rows);

const pcSetup=provider=>'#settings?view=accounts&executionMode=live&brokerSetup='+provider;
function pcHandoff(provider){
 const address=globalThis.location?.origin&&new URL(pcSetup(provider),globalThis.location.origin).href;
 return `<section class="spaced" data-broker-handoff><h3>새 키는 PC 웹에서 발급</h3><p>PC에서 VIV 연결 화면을 먼저 열고, 발급한 키를 같은 PC의 VIV 입력창에 붙여 넣으세요.</p>${address?`<div class="actions">${button('PC 연결 주소 복사','copy-pc-link',provider)}</div><textarea class="input" rows="2" aria-label="PC 연결 주소" readonly hidden>${esc(address)}</textarea><p class="tiny muted">다른 기기에는 연결 주소만 보내세요. 주소가 열리지 않으면 설치할 때 표시된 VIV PC 주소에서 계좌·자금을 여세요.</p>`:''}</section>`;
}

export function brokerPaperReturnLink(route){
 const href=paperResultReturnHash(route.params.get('returnTo'));
 return `<a class="button" href="${esc(href)}" data-studio-route data-broker-paper-home>${href===PAPER_HOME_ENTRY?'모의 홈으로':'저장한 모의 결과로 돌아가기'}</a>`;
}
const issueLabels={MARKET_UNAVAILABLE:'원화 거래쌍 없음',MARKET_CATALOG_UNAVAILABLE:'거래 목록 조회 필요',QUOTE_UNAVAILABLE:'시세 조회 필요',QUOTE_INVALID:'시세 응답 확인 필요'};
function valuationNotice(snapshot){
 if(snapshot?.valuationStatus!=='PARTIAL')return '';
 const positions=(snapshot.accounts??[]).flatMap(a=>a.positions??[]),issues=snapshot.valuationIssues?.length?snapshot.valuationIssues:positions.filter(p=>!Number.isFinite(p.marketValue)).map(p=>({symbol:p.symbol,...(p.valuationReason??{code:'QUOTE_UNAVAILABLE',message:'조회된 시세가 없어 평가액을 계산할 수 없습니다.'})}));
 const symbols=[...new Set(issues.map(i=>i.symbol).filter(Boolean))],causes=[...new Set(issues.map(i=>issueLabels[i.code]??'평가 자료 확인 필요'))],label='평가 누락'+(symbols.length?' · '+symbols.slice(0,2).join(', ')+(symbols.length>2?' 외 '+(symbols.length-2)+'종목':''):'')+' · '+(causes.length===1?causes[0]:'평가 자료 확인 필요');
 const detail=issues.map(i=>(i.symbol||i.market||'보유 종목')+': '+(i.message||issueLabels[i.code]||'평가 자료를 확인하세요.')).join('\n')+'\n보유 수량은 잔고 조회 결과입니다. 모든 보유 종목의 시세가 확인되면 보유 평가액과 총자산을 표시합니다.';
 return `<div class="studio-sheet-body tiny" role="status">${helpLabel(label,detail)}</div>`;
}
const snapshotStamp=value=>Number.isFinite(Date.parse(value))?new Date(value).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'})+' KST':'시각 미기록';
const snapshotDay=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'});
function snapshotAgeNotice(snapshot,now){
 const at=Date.parse(snapshot.asOf),unknown=!Number.isFinite(at)||at>now;
 if(!unknown&&snapshotDay.format(at)===snapshotDay.format(now))return '';
 return '<div class="broker-snapshot-notice" role="status"><strong>'+(unknown?'조회 시각 확인 필요':'오늘 이전에 조회한 잔고')+'</strong><span>저장된 조회 결과입니다. 잔고 새로고침으로 현재 상태를 확인하세요.</span></div>';
}
function quoteAssetMarkup(account,provider){
 if(provider!=='upbit'||!account.quoteAssetBalances?.length)return '';
 return `<section class="spaced" data-broker-quote-assets><h4>${helpLabel('BTC·USDT 거래 자금','BTC 마켓은 BTC, USDT 마켓은 USDT를 거래 기준 자산으로 사용합니다. 보유 종목에 포함된 같은 잔고를 거래 기준으로 보여줍니다. 총자산은 원화 평가액에서 한 번 집계합니다. 사용 가능 수량은 미체결 주문에 묶인 수량을 제외한 잔고입니다.')}</h4>${table(['거래 기준 자산','사용 가능 수량','주문 중 수량'],account.quoteAssetBalances.map(a=>[esc(a.currency),quantity(a.available,a.currency,'사용 가능 수량'),quantity(a.locked,a.currency,'주문 중 수량')]))}</section>`;
}
export function createBrokerConnections({request,redraw,open,close,toast,route,getDialogToken,now=()=>Date.now()}){
 let data=null,error='',loading=false,pending=false,pendingProvider='',pendingAction='',retryProvider='',readGeneration=0;
 function acceptSnapshot(provider,snapshot){if(snapshot?.provider!==provider||!Array.isArray(snapshot.accounts))return false;readGeneration++;loading=false;error='';retryProvider='';const previous=data?.connections?.find(c=>c.provider===provider);data={...data,connections:[...(data?.connections??[]).filter(c=>c.provider!==provider),{...previous,provider,snapshot,updatedAt:snapshot.asOf??previous?.updatedAt}]};return true;}
 async function load(){const current=route();if(current.page!=='settings'||current.params.get('view')!=='accounts'||current.params.get('executionMode')!=='live'||loading)return false;const generation=++readGeneration;loading=true;error='';retryProvider='';let loaded=false;try{const value=await request('/api/workspace/brokers');if(generation===readGeneration){data=value;loaded=true;}}catch(e){if(generation===readGeneration)error=e.serverResponse?e.message:'VIV 서버의 응답을 확인하지 못했습니다. 재시작 중이라면 VIV PC 주소가 열린 뒤 다시 확인하세요.';}finally{if(generation===readGeneration)loading=false;redraw();}return loaded;}

 function render(){
  const preferred=route().params.get('brokerSetup');
  const providers=Object.hasOwn(names,preferred)?[preferred,...Object.keys(names).filter(provider=>provider!==preferred)]:Object.keys(names);
  const sections=providers.map(provider=>{const name=names[provider];const connection=data?.connections.find(c=>c.provider===provider),snapshot=connection?.snapshot;
   const balances=(snapshot?.accounts??[]).map(a=>`<div class="studio-sheet-body">${snapshot.accounts.length>1||a.label!==name?`<h3>${esc(a.label)}</h3>`:''}${table(['통화',{label:provider==='toss'?'주문 가능 금액':'사용 가능 현금',help:provider==='toss'?'토스증권의 현금 주문 가능 금액입니다. 결제된 예수금과 총자산은 별도 항목입니다.':'미체결 주문에 묶인 금액을 제외한 현금입니다.'},'주문 중','보유 평가액','총자산'],a.currencies.map(c=>[esc(c.currency),money(c.available),money(c.locked),money(c.holdingsValue),money(c.equity)]))}${quoteAssetMarkup(a,provider)}${a.positions.length?table(['보유 종목','보유 수량',...(provider==='upbit'?['사용 가능 수량',{label:'주문 중 수량',help:'미체결 주문에 묶인 수량이며 보유 수량에 포함됩니다.'}]:[]),'현재가','평가액'],a.positions.map(p=>[esc(p.name||p.symbol),quantity(p.quantity,p.symbol,'보유 수량'),...(provider==='upbit'?[quantity(p.availableQuantity,p.symbol,'사용 가능 수량'),quantity(p.lockedQuantity,p.symbol,'주문 중 수량')]:[]),provider==='upbit'?quantity(p.marketPrice,p.currency,'현재가','조회 현재가'):money(p.marketPrice),money(p.marketValue)+' '+esc(p.currency)])):''}</div>`).join('');
   const canConnect=data?.canConnect===true;
   const connectionHint='새 API 키는 PC 웹에서 발급합니다. '+(canConnect?'발급한 키로 현금과 보유 종목을 조회할 수 있습니다.':'키를 입력하기 전에 VIV 서버를 준비하세요.');
   return `<section class="studio-sheet spaced" data-broker-section="${provider}" aria-labelledby="broker-${provider}-title"><div class="studio-sheet-head"><div><h2 id="broker-${provider}-title" tabindex="-1">${name}</h2>${snapshot?`<span class="tiny muted">저장 조회 ${esc(snapshotStamp(snapshot.asOf))}</span>`:''}</div><div class="actions">${connection?button(pendingProvider===provider&&pendingAction==='refresh'?'잔고 조회 중…':error&&retryProvider===provider?'다시 조회':'잔고 새로고침','refresh',provider,pending):''}${button(connection?'연결 정보 변경':canConnect?'계좌 연결':'연결 준비 보기','connect',provider,pending||!data)}</div></div>${error&&retryProvider===provider?`<div class="broker-snapshot-notice" role="alert"><strong>${name} 잔고 조회 실패</strong><span>${esc(error)}</span>${snapshot?'<span>표시된 잔고는 저장된 조회 결과입니다.</span>':''}</div>`:''}${pendingProvider===provider?`<p class="studio-sheet-body tiny" role="status">${pendingAction==='refresh'?'새 잔고를 조회하고 있습니다.':'연결 정보를 확인하고 있습니다.'}${snapshot?' 표시된 잔고는 저장된 조회 결과입니다.':''}</p>`:''}${snapshot?snapshotAgeNotice(snapshot,now())+valuationNotice(snapshot)+(snapshot.accounts.length?balances:'<div class="studio-sheet-body"><p class="muted">조회된 계좌가 없습니다.</p></div>'):`<div class="studio-sheet-body"><p class="muted">${connection?'연결 정보가 저장되어 있습니다. 잔고 새로고침으로 현금과 보유 종목을 조회하세요.':connectionHint}</p></div>`}</section>`;}).join('');
  return `<div>${error&&!retryProvider?`<p role="alert">${esc(error)} ${button('다시 조회','reload','',pending)}</p>`:''}${!data?(error?'':'<p class="empty" role="status">계좌 연결 정보를 불러오는 중…</p>'):sections}</div>`;
 }
  function connect(provider,{rechecked=false}={}){
  const upbit=provider==='upbit',ready=data?.canConnect===true;
  const networkBlocked=data?.network!=='READY',vaultBlocked=data?.vault==='CONFIGURATION_REQUIRED';
  const issue=networkBlocked?'서버 허용 IP 준비 필요':vaultBlocked?'서버 키 보관 설정 필요':'서버 연결 설정 필요';
  const ip=data?.egressIp?`VIV에 설정된 공인 발신 IPv4는 <strong>${esc(data.egressIp)}</strong>입니다. 현재 서버의 발신 IP와 일치하는지 확인한 뒤 금융기관 허용 IP에 등록하세요. ${button('서버 IP 복사','copy-ip',provider)}`:'금융기관 허용 IP에 VIV 서버의 공인 발신 IPv4를 등록하세요. 직접 설치했다면 VIV가 실행 중인 PC의 인터넷 연결에서 확인하세요. 별도 서버라면 관리자에게 공인 발신 IPv4를 확인하세요.';
  const guideUrl=upbit?'https://docs.upbit.com/kr/docs/api-key':'https://developers.tossinvest.com/';
  const providerLinks=`<div class="actions"><a href="${urls[provider]}" target="_blank" rel="noopener noreferrer">${names[provider]} API 관리 열기 ↗</a><a href="${guideUrl}" target="_blank" rel="noopener noreferrer">공식 발급 안내 ↗</a><a href="https://github.com/HwigwanJi/viv/blob/main/docs/agents/operations/self-host.md#계좌-연결과-잔고-확인" target="_blank" rel="noopener noreferrer">VIV 연결 문제 해결 ↗</a></div>`;
  const permission=upbit?'업비트 PC 웹의 마이페이지 → Open API 관리에서 <strong>자산조회</strong> 권한만 선택하세요. 2채널 인증 후 발급 화면에서 Secret Key를 확인하세요.':'토스증권 PC 웹의 설정 → Open API에서 Client ID와 Client Secret을 발급하세요.';
  const issuing=`<p>${permission}</p><p>${ip}</p><p>발급 안내는 새 탭에서 열립니다.</p>${providerLinks}`;
  const guide=`<details class="spaced" data-broker-guide><summary>${names[provider]} 키 발급과 허용 IP</summary>${issuing}</details>`;
  const paperLink=brokerPaperReturnLink(route());
  const cancel='<button class="button" type="button" data-studio-action="close-dialog">취소</button>';
  if(!ready){
   const serverGuide=`<section class="spaced"><h3>2. VIV 서버 준비</h3>${networkBlocked?'<p>금융기관에서 허용 IP를 등록한 뒤 VIV 설치 폴더의 <code>.env</code>에 <code>BROKER_NETWORK_READY=true</code>를 설정하고 서버를 다시 시작하세요.</p>':''}${vaultBlocked?'<p>VIV 설치 때 생성한 <code>BROKER_VAULT_KEY</code> 설정을 서버에서 확인하세요.</p>':''}<p><a href="https://github.com/HwigwanJi/viv/blob/main/docs/agents/operations/self-host.md#서버-다시-시작" target="_blank" rel="noopener noreferrer">서버 다시 시작 방법 ↗</a></p></section>`;
   open(names[provider]+' 연결',`<p role="status"><strong>${rechecked?'아직 서버 준비가 필요합니다 · ':''}${issue}</strong></p><p data-broker-error role="alert"></p>${pcHandoff(provider)}<section class="spaced"><h3>1. 키 발급과 허용 IP 등록</h3>${issuing}</section>${serverGuide}<section class="spaced"><h3>3. VIV 설정 확인</h3><p><strong>준비 상태 다시 확인</strong>은 VIV 서버의 설정을 읽습니다. 금융기관의 허용 IP와 키 권한은 키를 입력하고 잔고를 조회할 때 확인합니다.</p></section>`,paperLink+button('준비 상태 다시 확인','recheck',provider));
   return;
  }
  const fields=upbit?[['accessKey','Access Key'],['secretKey','Secret Key']]:[['clientId','Client ID'],['clientSecret','Client Secret']];
  open(names[provider]+' 연결',`<form data-broker-form="${provider}" autocomplete="off">${pcHandoff(provider)}${guide}<p>${rechecked?'VIV 서버 설정을 확인했습니다. ':''}잔고 조회를 요청하면 금융기관이 허용 IP와 키 권한을 확인합니다. 키는 아래 입력창에 넣으세요. 서버에 암호화해 보관합니다.</p><div class="form-grid">${fields.map(([name,label])=>`<label class="field">${label}<input class="input" type="password" name="${name}" autocomplete="off" spellcheck="false" required minlength="10" maxlength="8000" /></label>`).join('')}</div><p data-broker-status role="status" aria-live="polite"></p><p data-broker-error role="alert"></p><div class="form-actions">${paperLink}${cancel}<button class="button primary" type="submit">연결하고 잔고 조회</button></div></form>`,'');
 }
 async function click(event){const node=event.target.closest?.('[data-broker-action]');if(!node||node.disabled)return;event.preventDefault();const action=node.dataset.brokerAction,provider=node.dataset.brokerProvider;if(action==='connect'&&!pending)return connect(provider);if(action==='copy-pc-link'){
   const address=node.closest('[data-broker-handoff]').querySelector('textarea');
   try{await navigator.clipboard.writeText(address.value);toast('PC 연결 주소를 복사했습니다.');}
   catch{address.hidden=false;address.focus();address.select();}
   return;
  }if(action==='copy-ip'&&data?.egressIp){
   try{await navigator.clipboard.writeText(data.egressIp);toast('서버 IP를 복사했습니다.');}catch{toast('화면의 서버 IP를 선택해 복사하세요.');}
   return;
  }if(action==='recheck'&&!pending){
   const token=getDialogToken?.(),dialog=node.closest('dialog');node.disabled=true;
   try{
    const loaded=await load();
    if(node.isConnected&&(token===undefined||token===getDialogToken?.())){
     if(loaded)connect(provider,{rechecked:true});
     else if(error){
      const alert=dialog.querySelector('[data-broker-error]');
      alert.textContent=error;
      alert.scrollIntoView({block:'nearest'});
     }
    }
   }
   finally{if(node.isConnected)node.disabled=false;}
   return;
  }if(action==='reload')return load();if(action==='refresh'&&!pending){pending=true;pendingProvider=provider;pendingAction='refresh';error='';retryProvider='';redraw();try{const value=await request('/api/workspace/brokers/refresh',{provider});if(!acceptSnapshot(provider,value?.snapshot))await load();}catch(e){error=e.message;retryProvider=provider;}finally{pending=false;pendingProvider='';pendingAction='';redraw();}}}
 async function submit(event){
  const form=event.target.closest?.('[data-broker-form]');if(!form)return;event.preventDefault();if(pending)return;
  const provider=form.dataset.brokerForm,token=getDialogToken?.();
  const sameDialog=()=>form.isConnected!==false&&(token===undefined||token===getDialogToken?.());
  const submit=form.querySelector('[type="submit"]'),errorNode=form.querySelector('[data-broker-error]'),status=form.querySelector('[data-broker-status]'),cancel=form.querySelector('[data-studio-action="close-dialog"]');
  const report=message=>{if(sameDialog())errorNode.textContent=message;else toast(names[provider]+' · '+message);};
  pending=true;pendingProvider=provider;pendingAction='connect';submit.disabled=true;submit.textContent='연결 확인 중…';errorNode.textContent='';
  status.textContent='연결 요청을 보냈습니다. 창을 닫거나 이동해도 확인은 계속됩니다.';cancel.textContent='닫기';
  try{
   const values=Object.fromEntries(new FormData(form)),result=await request('/api/workspace/brokers/connect',{provider,...values});
   if(result?.ok===true&&result.snapshot?.mode==='READ_ONLY'&&Number.isFinite(Date.parse(result.snapshot.asOf))&&acceptSnapshot(provider,result.snapshot)){
    form.reset();
    if(sameDialog())close();
    toast(names[provider]+' 계좌 연결 및 잔고 조회 완료.');
   }else{
    await load();
    report('이번 연결 결과를 확인하지 못했습니다. 창을 닫고 계좌 카드의 저장 조회 시각을 확인하세요.');
   }
  }catch(e){
   if(e.code==='UPBIT_IP_NOT_ALLOWED'||e.code==='UPBIT_ASSET_SCOPE_REQUIRED'){
    if(sameDialog())form.querySelector('[data-broker-guide]').open=true;
   }
   if(e.serverResponse)report(e.message);
   else{
    await load();
    report('응답이 끊겨 이번 연결 결과를 확인하지 못했습니다. 창을 닫고 계좌 카드의 저장 조회 시각을 확인하세요.');
   }
  }finally{
   pending=false;pendingProvider='';pendingAction='';
   if(sameDialog()){submit.disabled=false;submit.textContent='연결하고 잔고 조회';status.textContent='';cancel.textContent='취소';}
   redraw();
  }
 }

 return {render,load,click,submit};
}
