import {createPortfolioRoute,createPortfolioQuery,portfolioRequestPath,portfolioFinancialKey} from './portfolio-route.mjs';
const FOUR_HOURS = 14400000;
const DAY = 86400000;
const ACTIONS = {buy:'매수',hold:'유지',sell:'매도'};
const STANCES = {normal:'기본',clutch:'기회 집중',defensive:'방어'};
const KNOWLEDGE_TYPES = {OBSERVED_FACT:'관측 사실',HYPOTHESIS:'가설',VALIDATED_HEURISTIC:'검증된 경험칙',OPERATING_PROCEDURE:'운영 절차'};
const READ_ACTIONS = new Set(['refresh','portfolio-retry','mind-select','mind-knowledge','view-select','page-next','page-prev','standalone-history','knowledge-detail','decision','experience','group-records','bot-select','history-more','profiles','experience-profile']);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const list = value => Array.isArray(value) ? value : [];
const find = (items,id) => list(items).find(item => item.id === id);
const finite = value => typeof value === 'number' && Number.isFinite(value);
const num = (value,digits=2) => finite(value) ? new Intl.NumberFormat('ko-KR',{minimumFractionDigits:digits,maximumFractionDigits:digits}).format(value) : '—';
const pct = value => finite(value) ? num(value*100,2)+'%' : '—';
const validTime = value => Number.isFinite(Date.parse(value));
const time = value => validTime(value) ? new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(value))+' KST' : '—';
const utc = value => validTime(value) ? new Date(value).toISOString().replace('T',' ').slice(0,19)+' UTC' : '—';
const stamp = value => `<time title="${esc(utc(value))}"${validTime(value)?` datetime="${esc(value)}"`:''}>${esc(time(value))}</time>`;
const pill = (label,tone='') => `<span class="pill ${tone}">${esc(label)}</span>`;
const button = (label,action,id='',options={}) => `<button type="button" class="button ${options.primary?'primary':''} ${options.small?'small':''}" data-console-action="${action}" data-console-id="${esc(id)}"${options.disabled?' disabled':''}>${esc(label)}</button>`;
const row = (label,value) => `<div class="detail-row"><span>${esc(label)}</span><strong>${value}</strong></div>`;
const block = (title,body,actions='') => `<section class="panel section"><div class="panel-head"><h2>${esc(title)}</h2><div class="actions">${actions}</div></div><div class="panel-body">${body}</div></section>`;
const raw = (value,label='원본 기록 보기') => `<details class="spaced console-raw"><summary>${esc(label)}</summary><pre class="code">${esc(JSON.stringify(value,null,2))}</pre></details>`;
const table = (heads,rows,caption='') => `<div class="table-scroll"><table class="table console-table">${caption?`<caption class="visually-hidden">${esc(caption)}</caption>`:''}<thead><tr>${heads.map(h=>`<th scope="col"${/자금|평가자산|수익률|현금|수수료|수량|체결가/.test(h)?' class="console-numeric"':''}>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>`<tr>${r.map(v=>`<td${String(v).includes('console-number')?' class="console-numeric"':''}>${v}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
const input = (label,name,value,type='text',extra='') => `<label class="field">${esc(label)}<input name="${name}" type="${type}" value="${esc(value)}" ${extra}></label>`;
const select = (label,name,items,selected='') => `<label class="field">${esc(label)}<select name="${name}" required>${items.map(([id,label])=>`<option value="${esc(id)}"${id===selected?' selected':''}>${esc(label)}</option>`).join('')}</select></label>`;
const versionName = (versions,id) => {const value=find(versions,id);return value?'v'+value.version:'—';};
const entityName = (workspace,collection,id,fallback='이름 없음') => find(workspace?.[collection],id)?.name || fallback;
const actualResponse = record => record?.jevResponse?.answers ? record.jevResponse : record?.jevResponse?.response?.answers ? record.jevResponse.response : null;
const fillsFor = (workspace,record) => list(workspace?.accounts).flatMap(a=>list(a.ledger)).filter(f=>f.decisionId===record.id && (!f.deploymentId || f.deploymentId===record.deploymentId));
const latestFor = (workspace,deploymentId) => list(workspace?.decisionRecords).filter(r=>r.deploymentId===deploymentId).at(-1);
export const consoleProviderLabel = provider => ({binance:'Binance',okx:'OKX',BINANCE_PUBLIC_REST:'Binance',OKX_PUBLIC_REST:'OKX',ARCHIVED_DATASET:'Binance 과거 자료'})[provider]||'출처 확인 필요';
const providerFromUrl = value => {try{const host=new URL(value).hostname;return host==='okx.com'||host.endsWith('.okx.com')?'okx':host==='binance.com'||host.endsWith('.binance.com')||host==='binance.vision'||host.endsWith('.binance.vision')?'binance':null;}catch{return null;}};
const urlOrigin = value => {try{return new URL(value).origin;}catch{return null;}};

/** Saved execution provenance takes priority over today's connection setting. */
export function consoleMarketSource(record,workspace={}) {
  const input=record?.inputPackage||{},capture=find(workspace.marketSnapshots,input.marketDataRef),inline=input.marketData,manifest=inline?.manifest||capture?.marketData?.manifest;
  const loaderVersion=input.marketLoaderVersion||manifest?.loaderVersion||capture?.loaderVersion||null;
  const recordedUrl=input.marketOrigin||list(capture?.records)[0]?.url||list(manifest?.sources)[0]?.url;
  const archived=['HISTORICAL_FUNCTIONAL_REPLAY','RETROSPECTIVE_POLICY_SIMULATION','MECHANICAL_BACKTEST','POINT_IN_TIME_BACKTEST'].includes(input.experimentType);
  const provider=input.marketProvider||capture?.provider||manifest?.provider||(loaderVersion==='okx-closed-rest-v1'?'okx':loaderVersion==='binance-closed-rest-v1'?'binance':null)||providerFromUrl(recordedUrl)||(archived?'binance':null);
  return {provider,providerLabel:consoleProviderLabel(provider),origin:input.marketOrigin||urlOrigin(recordedUrl),loaderVersion:loaderVersion||(archived?'archived-dataset-v1':null),symbol:provider==='okx'?'BTC-USDT':provider==='binance'?'BTCUSDT':null,archived};
}

/** This projection uses recorded prices only; a missing price stays unavailable. */
export function consoleAccountMetrics(account,record) {
  if(!account)return {equity:null,price:null,totalReturn:null};
  const latest=list(account.ledger).at(-1),close=record?.inputPackage?.marketSnapshot?.features?.close;
  const price=latest?.at===account.asOf&&finite(latest?.referencePrice)?latest.referencePrice:finite(close)?close:null;
  const equity=account.btcQuantity===0?account.cash:price!==null?account.cash+account.btcQuantity*price:null;
  return {equity,price,totalReturn:equity!==null&&account.initialEquity>0?equity/account.initialEquity-1:null};
}

export function consoleRecordStatus(workspace,record,now=Date.now()) {
  if(record.decisionStatus==='FAILED')return {label:'실행 실패',tone:'danger'};
  if(fillsFor(workspace,record).length)return {label:'모의 체결 완료',tone:'success'};
  if(record.decisionStatus==='REJECTED'||record.outcomeType==='ORDER_REJECTED')return {label:'주문 제한',tone:'warning'};
  if(record.decisionStatus==='INVALIDATED'||record.outcomeType==='PROPOSAL_INVALIDATED')return {label:'새 실행 필요',tone:'warning'};
  if(record.outcomeType==='HOLD_SELECTED')return {label:'보유량 유지',tone:''};
  if(record.outcomeType==='NO_ORDER_REQUIRED')return {label:'추가 주문 없음',tone:''};
  if(record.outcomeType==='TRADE_PROPOSED') {
    const newer=list(workspace?.activityEvents).filter(e=>e.eventType==='DEPLOYMENT_EVALUATION_STARTED'&&e.resourceId===record.deploymentId).at(-1);
    if(newer&&newer.payload?.commandKey!==record.inputPackage?.executionCommandKey)return {label:'새 실행 필요',tone:'warning'};
    if(validTime(record.expiresAt)&&Date.parse(record.expiresAt)<=now)return {label:'주문 제안 만료',tone:'warning'};
    return {label:'주문 검토 대기',tone:'info'};
  }
  return {label:'실행 기록 저장',tone:''};
}

export function consoleObservationDue(experience) {
  const start=Date.parse(experience?.occurredAt);
  if(!Number.isFinite(start))return null;
  if(experience.experienceType==='EXECUTION_OPERATION')return validTime(experience.observationDueAt)?experience.observationDueAt:experience.occurredAt;
  return new Date(Math.max(start+DAY,Date.parse(experience.observationDueAt)||0)).toISOString();
}

/** Match an explicitly recorded group frame; never substitute another candle's latest result. */
export function consoleComparisonFrame(workspace,group) {
  const saved=list(group?.history).filter(h=>list(h.members).some(m=>m.decisionId));
  const frame=group?.round||saved.filter(h=>h.status==='COMPLETED').at(-1)||saved.at(-1);
  if(!frame)return null;
  const members=list(group.members).map(member=>{
    const checkpoint=list(frame.members).find(m=>m.deploymentId===member.deploymentId);
    const candidate=find(workspace?.decisionRecords,checkpoint?.decisionId);
    const record=candidate?.deploymentId===member.deploymentId&&candidate.inputPackage?.asOf===frame.asOf?candidate:null;
    return {...member,checkpoint:checkpoint||null,record};
  });
  const actions=members.map(m=>m.record?.decision?.action);
  return {asOf:frame.asOf,frame,members,inProgress:frame===group.round,sameAction:members.length>1&&members.every(m=>m.record?.decisionStatus!=='FAILED')&&actions.every(a=>a&&a===actions[0])};
}

export function consoleExperienceNextAction(experience,candidates=[],now=Date.now()) {
  const pending=list(candidates).filter(c=>['CANDIDATE','VALIDATED'].includes(c.status)).at(-1);
  if(experience?.status==='AWAITING_OBSERVATION'){
    if(experience.experienceType==='EXECUTION_OPERATION')return {label:'복구 결과 기록',action:'experience-review',id:experience.id};
    const due=consoleObservationDue(experience);
    return due&&Date.parse(due)<=now?{label:'24시간 진단 수집',action:'observation-collect',id:experience.id}:{label:'후속 자료 상태 확인',action:'observation-check',id:experience.id};
  }
  if(experience?.status==='OBSERVED')return {label:'경험 평가',action:'experience-review',id:experience.id};
  if(pending)return {label:pending.status==='VALIDATED'?'승인 검토':'검증 기록',action:'candidate-review',id:pending.id};
  if(experience?.status==='EVALUATED'&&!list(candidates).some(c=>c.status==='APPROVED'))return {label:'학습 후보 작성',action:'experience-review',id:experience.id};
  return null;
}

export function consoleGroupRunLabel(group,{replayRunning=false,now=Date.now()}={}) {
  if(replayRunning)return '브라우저 6봉 재생 중';
  if(group?.status!=='running')return group?.experimentType==='FORWARD_PAPER'?'일시중지':'과거 재생 일시중지';
  const leaseActive=Number.isFinite(group.round?.lease?.until)&&group.round.lease.until>now;
  if(leaseActive&&list(group.round?.members).some(m=>['EVALUATING','EXECUTING'].includes(m.stage)))return '전략 실행 중';
  if(list(group.round?.members).some(m=>m.stage==='FAILED'))return '실행 확인 필요';
  if(group.round)return list(group.round.members).some(m=>m.stage==='COMPLETED')?'일부 완료 · 이어서 실행':'처리 대기';
  return group.experimentType==='FORWARD_PAPER'?'다음 실행 대기':group.completedBars>0?'다음 재생 봉 대기':'과거 재생 준비';
}

/** Recent bars come from an actual JEV request or its captured input, never a fixture. */
export function consolePriceSeries(workspace,records,dataset=null) {
  const ordered=list(records).slice().sort((a,b)=>Date.parse(a.inputPackage?.asOf)-Date.parse(b.inputPackage?.asOf));
  let points=[],source='실행 기록',sourceRecord=ordered.at(-1)||null;
  for(const r of ordered.slice().reverse()) {
    const input=r.inputPackage||{},capture=find(workspace?.marketSnapshots,input.marketDataRef);
    const replay=input.experimentType!=='FORWARD_PAPER';
    const bars=r.jevRequest?.state?.recentBars || input.recentBars || input.marketData?.dataset?.bars || capture?.marketData?.dataset?.bars || (replay?dataset?.bars:null);
    if(Array.isArray(bars)&&bars.length){
      const cutoff=Date.parse(input.asOf);
      points=bars.filter(b=>Array.isArray(b)&&finite(b[0])&&finite(b[4])&&b[4]>0&&b[0]+FOUR_HOURS<=cutoff).slice(-64).map(b=>({at:b[0]+FOUR_HOURS,price:b[4]}));
      if(points.length){source='확정 4시간봉 종가';sourceRecord=r;break;}
    }
  }
  const identity=consoleMarketSource(sourceRecord,workspace),sourceKey=r=>{const s=consoleMarketSource(r,workspace);return s.provider||(r.inputPackage?.sourceHash||r.id);},selectedKey=sourceRecord?sourceKey(sourceRecord):null;
  if(!points.length)points=ordered.filter(r=>sourceKey(r)===selectedKey).map(r=>({at:Date.parse(r.inputPackage?.asOf),price:r.inputPackage?.marketSnapshot?.features?.close})).filter(p=>finite(p.at)&&finite(p.price)&&p.price>0);
  const deduped=new Map(points.map(p=>[p.at,p]));
  return {points:[...deduped.values()].sort((a,b)=>a.at-b.at),...identity,sourceHash:sourceRecord?.inputPackage?.sourceHash||null,sourceRecordId:sourceRecord?.id||null,source:points.length>1&&source==='실행 기록'?'실제 실행 시점의 기록 가격':source==='실행 기록'?'실제 실행 기록':source};
}

function distribution(values,labels=ACTIONS) {
  if(!values||typeof values!=='object')return '<p class="tiny muted">선택 분포가 응답에 포함되지 않았습니다.</p>';
  return `<div class="console-distribution">${Object.entries(values).map(([key,value])=>`<div><span>${esc(labels[key]||'선택 항목')}</span><strong>${pct(value)}</strong><span class="console-meter" aria-hidden="true"><i style="width:${finite(value)?Math.max(0,Math.min(100,value*100)):0}%"></i></span></div>`).join('')}</div>`;
}

function priceChart(workspace,records,deploymentIds,dataset) {
  const series=consolePriceSeries(workspace,records,dataset),points=series.points;
  if(!points.length)return '<div class="empty">실행에 사용한 가격 자료가 쌓이면 실제 기록을 표시합니다.</div>';
  if(points.length===1)return `<div class="console-price-single"><strong>${num(points[0].price)} <small>USDT</small></strong><p class="tiny muted">${esc(series.providerLabel)} · ${stamp(new Date(points[0].at).toISOString())} · 기록된 가격 1개</p></div>`;
  const from=points[0].at,to=points.at(-1).at;
  const accountIds=new Set(list(workspace.deployments).filter(d=>deploymentIds.includes(d.id)).map(d=>d.accountId));
  const fills=list(workspace.accounts).filter(a=>accountIds.has(a.id)).flatMap(a=>list(a.ledger)).filter(f=>{const record=find(workspace.decisionRecords,f.decisionId),provider=f.quote?.provider||consoleMarketSource(record,workspace).provider,sameSource=series.provider?provider===series.provider:series.sourceHash?record?.inputPackage?.sourceHash===series.sourceHash:record?.id===series.sourceRecordId;return sameSource&&validTime(f.at)&&Date.parse(f.at)>=from&&Date.parse(f.at)<=to+FOUR_HOURS&&finite(f.fillPrice);});
  const min=Math.min(...points.map(p=>p.price),...fills.map(f=>f.fillPrice)),max=Math.max(...points.map(p=>p.price),...fills.map(f=>f.fillPrice)),range=max-min||max*.02||1;
  const end=Math.max(to,...fills.map(f=>Date.parse(f.at))),width=900,height=230,left=72,right=20,top=20,bottom=35;
  const x=t=>left+(t-from)/Math.max(1,end-from)*(width-left-right),y=p=>top+(max+range*.1-p)/(range*1.2)*(height-top-bottom);
  const segments=[];let part=[];
  for(const p of points){if(part.length&&p.at-part.at(-1).at>FOUR_HOURS){segments.push(part);part=[];}part.push(p);}if(part.length)segments.push(part);
  const grids=[0,.5,1].map(k=>{const p=min+(max-min)*k;return `<line x1="${left}" x2="${width-right}" y1="${y(p)}" y2="${y(p)}"/><text x="${left-8}" y="${y(p)+4}" text-anchor="end">${num(p,0)}</text>`;}).join('');
  const lines=segments.map(ps=>ps.length===1?`<circle cx="${x(ps[0].at)}" cy="${y(ps[0].price)}" r="3" class="console-price-line"/>`:`<polyline points="${ps.map(p=>x(p.at).toFixed(1)+','+y(p.price).toFixed(1)).join(' ')}" class="console-price-line"/>`).join('');
  const markers=fills.map(f=>`<g class="console-fill-${f.side==='buy'?'buy':'sell'}"><circle cx="${x(Date.parse(f.at))}" cy="${y(f.fillPrice)}" r="5"/><title>${esc(ACTIONS[f.side]||'체결')} ${num(f.quantity,8)} BTC · ${num(f.fillPrice)} USDT · ${esc(time(f.at))}</title></g>`).join('');
  return `<div class="console-chart"><svg viewBox="0 0 ${width} ${height}" role="img" aria-label="실제 기록 가격과 모의 체결 위치"><g class="console-chart-grid">${grids}</g>${lines}${markers}<text x="${left}" y="${height-8}">${esc(time(new Date(from).toISOString()))}</text><text x="${width-right}" y="${height-8}" text-anchor="end">${esc(time(new Date(end).toISOString()))}</text></svg></div><p class="tiny muted console-chart-caption">${esc(series.providerLabel)} ${esc(series.symbol||'')} · ${esc(series.source)} · ${points.length}개 · USDT${fills.length?' · 같은 출처 모의 체결 '+fills.length+'건':''}</p>`;
}

function evidenceCard(item,type,selectedIds=[]) {
  const id=item.id||item.candidateId,title=item.title||'승인 근거',selected=selectedIds.includes(id)||selectedIds.includes('memory_'+item.candidateId);
  return `<article class="console-evidence"><div class="console-evidence-head"><h4>${esc(title)}</h4>${pill(type)}${KNOWLEDGE_TYPES[item.knowledgeType]?pill(KNOWLEDGE_TYPES[item.knowledgeType]):''}${item.version!==undefined?pill('v'+item.version):''}${selected?pill('선택에 사용','success'):''}</div><p>${esc(item.text||item.content||'보존된 본문이 없습니다.')}</p>${item.sourceTitle?`<p class="tiny muted">${esc(item.sourceTitle)} · ${esc(item.sourceLocator||'')}</p>`:''}${item.availableAt||item.approvedAt?`<p class="tiny muted">사용 가능 ${stamp(item.availableAt||item.approvedAt)}</p>`:''}${Number.isSafeInteger(item.experienceCount)?`<p class="tiny muted">근거 경험 ${item.experienceCount}건</p>`:''}</article>`;
}

function performancePanel(experience) {
  const o=experience.observation,p=o?.performance;
  if(!o)return '';
  if(experience.experienceType==='EXECUTION_OPERATION')return `<p class="readable">${esc(o.details||'운영 복구 기록')}</p>${row('관측 시각',stamp(o.asOf))}`;
  if(!p)return `<div class="callout warning">후속 가격 관측은 보존되어 있습니다. 해당 선택의 계좌·체결·비용을 반영한 성과 계산은 아직 없습니다.</div>${row('관측 종가',num(o.price)+' USDT')}${row('관측 종료',stamp(o.asOf))}`;
  const b=p.benchmarks||{},rows=[['해당 선택·체결 반영',p.endingEquity,p.netReturn],['기존 현금·보유 유지',b.holdingEquity,b.holdingReturn],['전액 현금 대조',b.allCashEquity,b.allCashReturn],['비용 반영 매수·보유 대조',b.buyAndHoldEquity,b.buyAndHoldReturn]];
  return `<p class="tiny muted">${esc(p.assumption||'선택 당시 계좌와 해당 선택의 체결을 기준으로 계산합니다.')}</p>${row('진단 자료 출처',esc(consoleProviderLabel(o.source?.provider||o.source?.kind)))}${row('진단 기간',stamp(p.fromAt||experience.occurredAt)+' — '+stamp(p.asOf||o.asOf))}${row('수익률 분모 · 선택 시점 평가자산',num(p.initialEquity)+' USDT')}${row('체결 반영 후 고정 현금',num(p.endingCash)+' USDT')}${row('체결 반영 후 고정 BTC 수량',num(p.endingQuantity,8)+' BTC')}${table(['진단 기준','종료 평가자산 (USDT)','수익률'],rows.map(([label,equity,ret])=>[esc(label),num(equity),pct(ret)]),'선택 후 진단의 계좌·보유·현금 비교')}${row('기준 가격의 단순 변화',finite(p.referencePrice)&&p.referencePrice>0?pct(o.price/p.referencePrice-1):'—')}${row('반영한 모의 체결',list(p.fillIds).length+'건')}${row('진단 반영 수수료',num(p.feesPaid)+' USDT')}${row('비용 가정 · 수수료 / 슬리피지',num(p.costAssumption?.feeBps,1)+' / '+num(p.costAssumption?.slippageBps,1)+' bp')}${row('자산 경로 최대 상승 / 하락',pct(p.maxFavorableExcursion)+' / '+pct(p.maxAdverseExcursion))}<p class="tiny muted spaced">${esc(p.excursionBasis||'')}</p><p class="tiny muted spaced">종료 가격으로 평가한 결과입니다. ${p.fillIds?.length?'체결 후 보유 중인 수량의 평가손익을 포함합니다.':'해당 선택에 연결된 체결 손익은 없습니다.'}</p>`;
}

/** All writes pass through the host's authenticated action/receipt helper. */
export function createInvestmentConsole(hooks) {
  let selectedGroup='',selectedBot='',historyLimit=20,busy=false,error='',replayRunning=false,replayGroupId=null,replayStop=false,destroyed=false;
  let initialized=false,queryQueuedKey='',searchTimer=null,screenMode='paper',searchDraft='',searchDraftKey='';
  const cursorTrail=[];
  const availability=new Map(),singleTimes=new Map();
  const workspace=()=>hooks.getWorkspace?.();
  const redraw=()=>{
    if(destroyed)return;
    const search=document.activeElement?.matches?.('[data-console-form="portfolio-search"] input[name="search"]')?document.activeElement:null;
    const selection=search?[search.selectionStart,search.selectionEnd]:null;
    hooks.render?.();
    if(search){const next=document.querySelector?.('[data-console-form="portfolio-search"] input[name="search"]');next?.focus?.({preventScroll:true});if(selection?.every(Number.isInteger))next?.setSelectionRange?.(...selection);}
  };
  const blocked=()=>busy||Boolean(hooks.getBusy?.());
  const groups=()=>list(workspace()?.comparisons);
  const currentGroup=()=>find(groups(),selectedGroup);
  const deploymentIds=group=>list(group?.members).map(member=>member.deploymentId);
  const groupType=group=>group?.experimentType||'HISTORICAL_FUNCTIONAL_REPLAY';
  const browser=hooks.window??globalThis.window;
  const route=createPortfolioRoute({window:browser,onChange:(r,meta)=>{selectedGroup=r.comparison||selectedGroup;selectedBot=r.bot;if(meta.restored)searchDraftKey='';redraw();}});
  const query=createPortfolioQuery({request:(...args)=>hooks.request(...args),onChange:state=>{if(state.resetCursor&&route.state().cursor){cursorTrail.length=0;route.set({cursor:''},{replace:true});}redraw();}});
  selectedGroup=route.state().comparison;selectedBot=route.state().bot;
  function standaloneBots(){const owned=new Set(groups().flatMap(deploymentIds));return list(workspace()?.deployments).filter(d=>!owned.has(d.id));}
  function selectedDeployments(){const w=workspace(),g=currentGroup(),mind=route.state().mind;return list(w?.deployments).filter(d=>(g?deploymentIds(g).includes(d.id):standaloneBots().some(b=>b.id===d.id))&&(!selectedBot||d.id===selectedBot)&&(mind==='all'||d.investmentProfileId===mind));}
  function records(){const ids=selectedDeployments().map(d=>d.id);return list(workspace()?.decisionRecords).filter(r=>ids.includes(r.deploymentId)).slice().sort((a,b)=>Date.parse(b.inputPackage?.asOf)-Date.parse(a.inputPackage?.asOf)||Date.parse(b.createdAt)-Date.parse(a.createdAt));}
  async function mutate(type,payload,endpoint){if(blocked())return;busy=true;error='';redraw();try{return await hooks.action(type,payload,endpoint);}catch(e){error=e.message||'요청을 완료하지 못했습니다.';hooks.toast?.(error);throw e;}finally{busy=false;redraw();}}
  function form(title,kind,body,submit='시작',id=''){hooks.open(title,`<form data-console-form="${kind}" data-console-id="${esc(id)}"><div class="form-grid">${body}</div><div class="error-text spaced" data-console-error role="alert"></div><div class="form-actions"><button type="submit" class="button primary">${esc(submit)}</button></div></form>`);}
  function costSummary(formNode){
    const target=formNode.querySelector('[data-console-capital-total]');if(!target)return;
    const count=formNode.querySelectorAll('input[name="profileIds"]:checked').length,cash=Number(formNode.querySelector('[name="initialCash"]')?.value);
    target.textContent=`선택 ${count}개 프로필 · 각 ${num(cash,0)} USDT · 합계 ${num(cash*count,0)} USDT의 독립 모의 자금`;
  }
  function startForm(mode='FORWARD_PAPER') {
    const w=workspace(),profiles=list(w.investmentProfiles),strategies=list(w.strategies).map(s=>[s.currentVersionId,s.name+' '+versionName(w.strategyVersions,s.currentVersionId)]),presets=list(w.riskPresets).map(s=>[s.currentVersionId,s.name+' '+versionName(w.riskPresetVersions,s.currentVersionId)]),replay=mode!=='FORWARD_PAPER';
    if(!profiles.length||!strategies.length||!presets.length){hooks.toast?.('투자 프로필·전략·운용 프리셋을 먼저 추가하세요.');return;}
    const end=hooks.getMarket?.()?.defaultAsOf||'2026-10-14T20:00:00.000Z';
    const configured=hooks.getMarket?.(),sourceNotice=replay?'Binance BTCUSDT 과거 자료':(configured?.providerLabel||consoleProviderLabel(configured?.provider))+' BTC / USDT · 현재 실시간 연결 설정';
    form(replay?'과거 재생 시작':'실시간 모의투자 시작','comparison-create',input('운용 이름','name',replay?'세 프로필 과거 비교':'세 프로필 실시간 모의투자','text','required maxlength="120"')+`<input type="hidden" name="experimentType" value="${mode}"><fieldset class="console-profile-picker field full"><legend>비교할 투자 프로필</legend>${profiles.map((p,i)=>{const v=find(w.profileVersions,p.currentVersionId);return `<label><input type="checkbox" name="profileIds" value="${esc(p.id)}"${i<3?' checked':''}><span><strong>${esc(p.name)}</strong><small>${esc(v?.settings?.philosophy||'')}</small></span></label>`;}).join('')}</fieldset>`+select('공통 전략','strategyVersionId',strategies)+select('공통 운용 프리셋','riskPresetVersionId',presets)+input('프로필당 모의 자금 (USDT)','initialCash',100000,'number','min="100" max="100000000" step="100" required')+(replay?input('첫 기준 봉 마감 (UTC)','startAt','2020-01-18T04:00','datetime-local',`min="2020-01-18T04:00" max="${esc(end.slice(0,16))}" step="14400" required`):'<div class="field"><span>실행 주기</span><strong>생성 이후 확정 4시간봉 · 마감 5분 후</strong></div>')+input('공통 모의 수수료 (bp)','feeBps',10,'number','min="0" max="100" step="0.1" required')+input('공통 모의 슬리피지 (bp)','slippageBps',0,'number','min="0" max="100" step="0.1" required')+`<div class="full callout"><p>${esc(sourceNotice)}</p><p data-console-capital-total>선택 ${Math.min(3,profiles.length)}개 프로필 · 각 100,000 USDT · 합계 ${num(Math.min(3,profiles.length)*100000,0)} USDT의 독립 모의 자금</p><p class="tiny spaced">전략·비용·첫 기준 봉을 동일하게 맞춰 비교합니다.</p><p class="tiny spaced">${replay?'과거의 가격과 현재 모델·승인 지식으로 기능을 재생합니다. 결과는 과거 운용 성과 검증과 구분해 보관합니다.':'새 확정 봉마다 JEV 선택과 위험·비용 검사를 거쳐 필요한 모의 주문을 실행합니다. 각 프로필의 다음 실행 시각을 콘솔에서 확인합니다.'}</p><p class="tiny spaced">모의 자금과 비용 가정입니다. 1bp = 0.01%.</p></div>`,replay?'비교 재생 만들기':'모의운용 시작');
  }
  function groupHeader(g){
    const w=workspace(),bots=list(w.deployments).filter(d=>deploymentIds(g).includes(d.id)),jobs=list(w.scheduler?.jobs).filter(j=>bots.some(d=>d.id===j.deploymentId)),next=jobs.map(j=>j.nextCloseAt).filter(validTime).sort()[0]||g.cursorAt,last=list(w.decisionRecords).filter(r=>bots.some(d=>d.id===r.deploymentId)).at(-1),active=g.status==='running';
    const cursor=g.cursorAt||g.startAt;
    const statusLabel=consoleGroupRunLabel(g,{replayRunning:replayRunning&&replayGroupId===g.id});
    const sourceNotice=groupType(g)==='FORWARD_PAPER'?'현재 실시간 수집 설정 · '+(hooks.getMarket?.()?.providerLabel||consoleProviderLabel(hooks.getMarket?.()?.provider)):'과거 재생 자료 · Binance BTCUSDT';
    const conditions=g.conditions||{},roundMembers=list(g.round?.members),stageLabels={PENDING:'실행 대기',EVALUATING:'JEV 요청 중',EVALUATED:'선택 저장',EXECUTING:'모의 체결 중',COMPLETED:'처리 완료',FAILED:'실행 실패',RETRY_WAIT:'재시도 대기',SKIPPED:'건너뜀',READY:'실행 준비'},outcomeLabels={TRADE_FILLED:'모의 체결 완료',TRADE_PROPOSED:'모의 주문 준비',HOLD_SELECTED:'보유량 유지',NO_ORDER_REQUIRED:'추가 주문 없음',ORDER_REJECTED:'주문 제한',DECISION_REQUEST_FAILED:'JEV 요청 실패'};
    const round=roundMembers.length?`<details class="spaced" open><summary>이번 봉 처리 ${time(g.round.asOf)}</summary><p class="tiny spaced">${roundMembers.filter(m=>m.stage==='COMPLETED').length}/${roundMembers.length}개 프로필 처리 완료 · 완료된 거래와 수수료를 보존하고 남은 프로필부터 이어서 처리합니다.</p>${table(['운용 봇','처리 단계','결과',''],roundMembers.map(member=>[esc(entityName(w,'deployments',member.deploymentId)),esc(stageLabels[String(member.stage||'').toUpperCase()]||'진행 기록'),esc(member.error?.message||outcomeLabels[member.outcome]||'—'),member.decisionId?button('실행 상세','decision',member.decisionId,{small:true}):'']))}</details>`:'';
    const first=!active&&!g.completedBars&&!g.round&&!list(g.history).length,firstNotice=first?`<p class="callout spaced">설정을 저장했습니다. ${groupType(g)==='FORWARD_PAPER'?'아래 자동 모의운용 시작을 누르면 다음 확정 봉부터 서버 예약을 실행합니다.':'아래 첫 봉 실행을 누르면 세 프로필을 같은 봉에서 재생합니다.'}</p>`:'';
    const controls=button(first?(groupType(g)==='FORWARD_PAPER'?'자동 모의운용 시작':'첫 봉 실행'):active?'전체 일시중지':'전체 재개',first&&groupType(g)!=='FORWARD_PAPER'?'comparison-first':'comparison-status',g.id,{primary:first,disabled:blocked()})+button(busy?'전략 실행 중…':g.round?'남은 프로필 이어서 실행':groupType(g)==='FORWARD_PAPER'?'실행 상태 확인':'다음 봉 실행','comparison-run',g.id,{primary:active,disabled:blocked()||replayRunning||!active})+(groupType(g)!=='FORWARD_PAPER'?button(replayRunning?'연속 재생 중지':'6봉 연속 재생','comparison-replay',g.id,{disabled:blocked()&&!replayRunning||!active}):'');
    return block(g.name||'프로필 비교 운용',`<div class="console-summary"><div>${pill(groupType(g)==='FORWARD_PAPER'?'실시간 모의투자':'과거 기능 재생','info')} ${pill(statusLabel,active?'success':'')}</div><div><span>최근 완료 봉</span><strong>${stamp(g.lastCompletedAt)}</strong></div><div><span>${groupType(g)==='FORWARD_PAPER'?'다음 봉 마감':'다음 재생 봉'}</span><strong>${stamp(groupType(g)==='FORWARD_PAPER'?next:cursor)}</strong></div><div><span>비교 프로필</span><strong>${bots.length}개 · 동일 자금·비용</strong></div></div><p class="tiny muted spaced">${esc(sourceNotice)}</p><p class="tiny muted spaced">공통 실행·일시중지·재개는 그룹의 ${deploymentIds(g).length}개 프로필에 적용합니다. 운용 봇 필터는 조회 범위입니다.</p><p class="tiny muted spaced">프로필당 ${num(conditions.initialCash,0)} USDT · 수수료 ${num(conditions.feeBps,1)}bp · 슬리피지 ${num(conditions.slippageBps,1)}bp · 완료 ${Number.isSafeInteger(g.completedBars)?g.completedBars:0}봉</p>${groupType(g)==='FORWARD_PAPER'?'<p class="tiny muted spaced">봉 마감 5분 후 예약 실행합니다. 시각은 한국 시간이며, 시각에 마우스를 올리면 UTC를 확인할 수 있습니다.</p>':'<p class="tiny muted spaced">한 봉씩 세 프로필의 선택과 필요한 모의 체결을 처리합니다. 유지·주문 없음도 다음 공통 봉으로 진행합니다.</p>'}${round}${firstNotice}`,controls);
  }
  function botCard(d){
    const w=workspace(),a=find(w.accounts,d.accountId),r=latestFor(w,d.id),profile=find(w.investmentProfiles,d.investmentProfileId),pv=find(w.profileVersions,d.investmentProfileVersionId),applied=find(w.memoryVersions,d.memoryVersionId),latest=find(w.memoryVersions,profile?.currentMemoryVersionId),metrics=consoleAccountMetrics(a,r),job=list(w.scheduler?.jobs).find(j=>j.deploymentId===d.id&&j.status!=='stopped'),attempt=list(w.scheduler?.attempts).filter(x=>x.deploymentId===d.id).at(-1),recordState=r?consoleRecordStatus(w,r):null;
    const ownerGroup=groups().find(g=>deploymentIds(g).includes(d.id)),serverScheduled=ownerGroup&&groupType(ownerGroup)==='FORWARD_PAPER',nextScheduled=serverScheduled&&validTime(ownerGroup.cursorAt)?new Date(Date.parse(ownerGroup.cursorAt)+(ownerGroup.conditions?.settleDelayMs??300000)).toISOString():null;
    const scheduleText=serverScheduled?'다음 실행 '+stamp(nextScheduled)+' · '+(ownerGroup.status==='running'?'서버 예약 대상 · 다음 실행 대기':'운용 시작 대기'):d.experimentType!=='FORWARD_PAPER'?'과거 재생 · 브라우저에서 실행':job?'다음 봉 '+stamp(job.nextCloseAt)+' · '+(job.autoExecute?'모의 주문 자동':'주문 직접 검토'):'자동 실행 설정 없음';
    const runLabel=ownerGroup?consoleGroupRunLabel(ownerGroup,{replayRunning:replayRunning&&replayGroupId===ownerGroup.id}):attempt?.status==='RETRY_WAIT'?'재시도 대기':attempt?.status==='FAILED'?'실행 확인 필요':d.runtimeStatus==='stopped'?'중지':d.experimentType!=='FORWARD_PAPER'?(d.runtimeStatus==='running'?'과거 재생 준비':'과거 재생 일시중지'):d.runtimeStatus==='running'?'다음 실행 대기':'일시중지';
    const stateTone=attempt?.status==='FAILED'?'danger':attempt?.status==='RETRY_WAIT'?'warning':d.runtimeStatus==='running'?'success':'';
    const lastRequest=list(w.decisionRecords).filter(record=>record.deploymentId===d.id&&record.jevRequest?.state).at(-1),sentMemory=list(lastRequest?.jevRequest?.state?.approvedPersonalMemory),hasApprovedMemory=list(w.memoryVersions).some(v=>v.investmentProfileId===d.investmentProfileId&&list(v.items).length);
    const memoryRecord=lastRequest?`최근 요청에 포함 ${sentMemory.length}건 · ${time(lastRequest.inputPackage?.asOf)}`:'개인 기억 전송 기록 · 첫 실행 대기';
    const recordedSource=r?consoleMarketSource(r,w):null,sourceNotice=recordedSource?'최근 실행 자료 · '+recordedSource.providerLabel+' '+(recordedSource.symbol||''):d.experimentType==='FORWARD_PAPER'?'다음 수집 연결 · '+(hooks.getMarket?.()?.providerLabel||consoleProviderLabel(hooks.getMarket?.()?.provider)):'Binance BTCUSDT 과거 자료';
    return `<article class="panel console-bot-card"><div class="panel-head"><div><p class="tiny muted">${esc(profile?.name||'투자 프로필')}</p><h3>${esc(d.name)}</h3></div>${pill(runLabel,stateTone)}</div><div class="panel-body"><p class="console-profile-principle">${esc(pv?.settings?.philosophy||'')}</p><p class="tiny muted">${esc(sourceNotice)}</p><div class="console-equity"><strong>${num(metrics.equity)}</strong><span>USDT</span><span class="${finite(metrics.totalReturn)&&metrics.totalReturn<0?'negative':'positive'}">${pct(metrics.totalReturn)}</span></div><dl class="console-balances"><div><dt>현금</dt><dd>${num(a?.cash)} USDT</dd></div><div><dt>보유 BTC</dt><dd>${num(a?.btcQuantity,8)}</dd></div><div><dt>누적 수수료</dt><dd>${num(a?.feesPaid)} USDT</dd></div></dl>${r?`<button type="button" class="console-last-decision" data-console-action="decision" data-console-id="${esc(r.id)}"><span>${stamp(r.inputPackage.asOf)}</span><strong>${esc(ACTIONS[r.decision?.action]||'확인 필요')} ${pill(STANCES[r.decision?.stance]||'기본')}</strong><span>${pill(recordState.label,recordState.tone)}</span><span class="console-link-text">실행 상세 열기 →</span></button>`:'<p class="console-waiting">첫 확정 봉의 선택을 기다리고 있습니다.</p>'}<div class="console-versions"><span>프로필 ${versionName(w.profileVersions,d.investmentProfileVersionId)}</span><span>전략 ${versionName(w.strategyVersions,d.strategyVersionId)}</span><span>프리셋 ${versionName(w.riskPresetVersions,d.riskPresetVersionId)}</span><span>적용 기억 ${applied?'v'+applied.version:'—'} · 승인 항목 ${list(applied?.items).length}건</span><span>${esc(memoryRecord)}</span></div>${latest&&applied&&latest.id!==applied.id?`<div class="callout warning spaced">새 승인 기억 v${latest.version} · ${list(latest.items).length}건</div>`:''}<p class="tiny muted spaced">${scheduleText}${attempt?.retryAt?' · 재시도 '+stamp(attempt.retryAt):''}</p>${attempt?.lastError?.message?`<p class="error-text">${esc(attempt.lastError.message)}</p>`:''}<div class="actions spaced">${button('실행 기록','bot-select',d.id,{small:true})}${button('경험·학습','experience-profile',d.investmentProfileId,{small:true})}${button('적용 버전','bot-configure',d.id,{small:true})}${hasApprovedMemory?button('기억 적용 검토','memory-apply',d.id,{small:true}):''}${!currentGroup()?button('전략 실행','individual-run',d.id,{small:true,disabled:blocked()})+(recordState?.label==='주문 검토 대기'?button('모의 주문 검토','individual-review',r.id,{small:true,disabled:blocked()}):'')+button(d.runtimeStatus==='running'?'일시중지':'재개','bot-status',d.id,{small:true,disabled:blocked()}):''}</div></div></article>`;
  }
  function comparisonChoice(record,key){
    const answer=actualResponse(record)?.answers?.[key];
    if(!answer)return '<span class="tiny muted">JEV 응답 대기</span>';
    const rules=list(record.jevRequest?.state?.rules),evidenceLabels={none:'근거 없음',...Object.fromEntries(rules.map((r,i)=>['r'+i,r.title||'승인 근거']))},labels=key==='action'?ACTIONS:key==='stance'?STANCES:evidenceLabels,selected=labels[answer.choice]||'선택 항목',values=answer.probabilities;
    const valuesHtml=values?Object.entries(values).map(([choice,value])=>`<span>${esc(labels[choice]||'선택 항목')} ${pct(value)}</span>`).join(' · '):'응답에 분포 없음';
    return `<strong>${esc(selected)}</strong><small>선택 신뢰도 ${pct(answer.confidence)}</small>${key==='buyEvidence'||key==='sellEvidence'?`<details class="spaced"><summary>선택 분포 ${values?Object.keys(values).length:0}개</summary><p class="tiny">${valuesHtml}</p></details>`:`<p class="tiny spaced">${valuesHtml}</p>`}`;
  }
  function comparisonPanel(group){
    const w=workspace(),frame=consoleComparisonFrame(w,group);
    if(!frame)return block('이번 봉 비교','<p class="muted">첫 봉을 실행하면 같은 기준 봉의 프로필별 행동·강도·근거 선택을 비교합니다.</p>',button('저장·복구 상태','group-records',group.id,{small:true}));
    const summary=frame.sameAction?`${frame.members.length}개 프로필 동일 행동 · 선택 분포 및 강도 비교`:frame.members.every(m=>m.record)?'프로필별 최종 행동·선택 분포·강도 비교':'같은 기준 봉의 프로필별 처리 결과를 기다립니다.';
    const sourceLabels=[...new Set(frame.members.filter(m=>m.record).map(m=>consoleMarketSource(m.record,w).providerLabel))];
    const rows=frame.members.map(member=>{
      const r=member.record,status=r?consoleRecordStatus(w,r):null;
      return [`<strong>${esc(entityName(w,'investmentProfiles',member.profileId))}</strong><small>${esc(entityName(w,'deployments',member.deploymentId))}</small>${r?pill(ACTIONS[r.decision?.action]||'확인 필요')+' '+pill(STANCES[r.decision?.stance]||'기본'):pill(member.checkpoint?.stage==='FAILED'?'실행 실패':'처리 대기')}`,comparisonChoice(r,'action'),comparisonChoice(r,'stance'),comparisonChoice(r,'buyEvidence'),comparisonChoice(r,'sellEvidence'),status?pill(status.label,status.tone):esc(member.checkpoint?.error?.message||'기록 대기'),r?button('실행 상세','decision',r.id,{small:true}):''];
    });
    return block('이번 봉 비교',`<p><strong>${stamp(frame.asOf)}</strong> · ${frame.inProgress?'진행 중인 봉':frame.frame.status==='COMPLETED'?'마지막 완료 봉':'최근 저장 봉'}</p><p class="tiny muted spaced">${esc(summary)} · 저장된 시세 출처 ${esc(sourceLabels.join(" / ")||"기록 대기")}</p>${table(['프로필 / 최종 행동','JEV 행동 선택·분포','운용 강도·분포','매수 근거 선택·분포','매도 근거 선택·분포','실행 결과',''],rows,'동일 기준 봉의 실제 JEV 네 질문 응답 비교')}<p class="tiny muted spaced">각 질문의 분포·신뢰도는 저장된 JEV 응답입니다. 최종 행동에는 신호 결합·위험 검사를 반영합니다.</p>`,button('저장·복구 상태','group-records',group.id,{small:true}));
  }
  function groupRecords(id){
    const w=workspace(),g=find(groups(),id);if(!g)return;
    const frames=[...(g.round?[g.round]:[]),...list(g.history).slice(-6).reverse()],receipts=list(w.commandReceipts),ledger=list(w.accounts).flatMap(a=>list(a.ledger)),stageLabels={EVALUATING:'선택 요청',EVALUATED:'선택 저장',EXECUTING:'모의 체결',COMPLETED:'처리 완료',FAILED:'실행 실패',SKIPPED:'건너뜀'};
    const rows=frames.flatMap(frame=>list(frame.members).map(member=>{
      const saved=find(w.decisionRecords,member.decisionId),evaluateReceipt=receipts.find(r=>r.key===member.evaluateKey||member.decisionId&&r.result?.decisionRecord?.id===member.decisionId),executeReceipt=receipts.find(r=>r.key===member.executeKey),fillCount=list(member.executionIds).filter(id=>ledger.some(f=>f.id===id)).length;
      return [stamp(frame.asOf),esc(entityName(w,'deployments',member.deploymentId)),esc(stageLabels[member.stage]||'진행 기록'),saved?'선택 저장 확인':'선택 기록 대기',evaluateReceipt?'요청 처리 저장 확인':'현재 조회에 처리 기록 없음',fillCount?`체결 ${fillCount}건 저장 확인`:member.outcome==='HOLD_SELECTED'?'보유량 유지 저장':member.outcome==='NO_ORDER_REQUIRED'?'주문 없음 저장':executeReceipt?'체결 요청 처리 저장':'체결 없음',saved?button('실행 상세','decision',saved.id,{small:true}):''];
    }));
    const events=list(w.activityEvents).filter(e=>e.resourceId===id&&e.eventType?.startsWith('COMPARISON_')).slice(-8).reverse(),eventLabels={COMPARISON_STARTED:'봉 처리 시작',COMPARISON_MEMBER_EVALUATED:'선택 단계 저장',COMPARISON_MEMBER_EXECUTING:'체결 단계 저장',COMPARISON_MEMBER_COMPLETED:'구성원 처리 저장',COMPARISON_COMPLETED:'봉 처리 완료 저장',COMPARISON_PARTIAL:'일부 구성원 후속 처리 대기',COMPARISON_RECOVERED:'중단 지점 복구',COMPARISON_WAITING:'새 확정 봉 대기',COMPARISON_BARS_SKIPPED:'누락 봉 건너뜀',COMPARISON_PAUSED:'일시중지',COMPARISON_RESUMED:'재개'};
    hooks.open('비교 운용 저장·복구 상태',`<div class="investment-console console-detail"><h3>${esc(g.name)}</h3>${row('현재 상태',esc(consoleGroupRunLabel(g,{replayRunning:replayRunning&&replayGroupId===g.id})))}${row('마지막 처리 봉',stamp(g.lastCompletedAt))}${row('다음 기준 봉',stamp(g.cursorAt))}${g.round?row('현재 봉 처리 시작',stamp(g.round.startedAt))+row('실행 소유 유효 시각',Number.isFinite(g.round.lease?.until)?stamp(new Date(g.round.lease.until).toISOString()):'현재 실행 소유 없음'):''}${block('최근 봉별 처리 단계',rows.length?table(['기준 봉','운용 봇','처리 단계','선택 기록','요청 처리 기록','체결 기록',''],rows):'<p class="muted">봉 처리를 시작하면 단계별 저장 기록을 확인할 수 있습니다.</p>')}${events.length?block('최근 저장 사건',table(['시각','사건'],events.map(e=>[stamp(e.occurredAt),esc(eventLabels[e.eventType]||'비교 운용 기록 저장')]))):''}${raw({round:g.round,history:list(g.history).slice(-6),requestReceipts:receipts.filter(r=>r.type?.startsWith('comparison.')&&r.result?.comparisonId===id)},'처리 식별자·저장 원본 보기')}</div>`);
  }
  function historyPanel(rows){
    const w=workspace(),visible=rows.slice(0,historyLimit);
    return block('실행 기록',visible.length?table(['기준 봉','투자 프로필 / 운용 봇','JEV 선택','행동 분포 · 매수 / 유지 / 매도','실행 결과',''],visible.map(r=>{const rawResponse=actualResponse(r),p=rawResponse?.answers?.action?.probabilities||r.decision?.choiceDistribution,status=consoleRecordStatus(w,r);return [stamp(r.inputPackage?.asOf),`<strong>${esc(entityName(w,'investmentProfiles',r.investmentProfileId))}</strong><small>${esc(entityName(w,'deployments',r.deploymentId))}</small>`,`<strong>${esc(ACTIONS[r.decision?.action]||'확인 필요')}</strong><small>${esc(STANCES[r.decision?.stance]||'기본')}</small>`,p?['buy','hold','sell'].map(k=>pct(p[k])).join(' / '):'응답 분포 없음',pill(status.label,status.tone),button('상세','decision',r.id,{small:true})];}),'운용 봇의 봉별 선택과 체결 결과')+(rows.length>historyLimit?`<div class="actions spaced">${button('이전 기록 더 보기','history-more')}</div>`:''):'<p class="muted">첫 전략 실행 후 봉별 선택·근거·체결 결과가 표시됩니다.</p>');
  }
  function experienceRows(rows){
    const w=workspace(),ids=new Set(rows.map(r=>r.id)),items=list(w.experiences).filter(e=>ids.has(e.decisionId)).slice().sort((a,b)=>Date.parse(b.occurredAt)-Date.parse(a.occurredAt)).slice(0,12);
    return block('경험·학습',items.length?table(['프로필 / 기준 봉','관측 상태','후속 결과',''],items.map(e=>{
      const due=consoleObservationDue(e),p=e.observation?.performance,wait=e.status==='AWAITING_OBSERVATION',operation=e.experienceType==='EXECUTION_OPERATION',isDue=due&&Date.parse(due)<=Date.now(),label=wait?(operation?'복구 관측 대기':isDue?'후속 자료 확인':'24시간 관측 대기'):e.status==='OBSERVED'?'평가 대기':'평가 완료';
      return [`<strong>${esc(entityName(w,'investmentProfiles',e.investmentProfileId))}</strong><small>${time(e.occurredAt)}</small>`,`${pill(label)}${wait&&!operation?'<small>관측 종료 '+time(due)+'</small>':''}`,p?`${pct(p.netReturn)}<small>체결 ${list(p.fillIds).length}건 · 수수료 ${num(p.feesPaid)} USDT</small>`:operation?'실패 원인·복구 결과 검토':wait?'후속 결과 대기':'성과 계산 자료 없음',button('관측·학습 열기','experience',e.id,{small:true})];
    }),'프로필별 경험의 후속 관측과 평가'):'<p class="muted">매수·유지·매도와 실행 실패의 경험을 기록합니다. 실행을 마치면 관련 경험을 여기에서 검토합니다.</p>',button('투자 프로필 열기','profiles'));
  }
  function navigateView(patch,{replace=false}={}){cursorTrail.length=0;return route.set({...((patch.view&&patch.view!==route.state().view)?{status:''}:{}),...patch},{replace});}
  function ensurePortfolio(g){
    if(!g||!hooks.request)return;
    const r={...route.state(),comparison:g.id},revision=workspace().revision||0,key=portfolioRequestPath(r)+'|'+revision,state=query.state();
    if(state.key===portfolioRequestPath(r)&&state.requestedRevision===revision||queryQueuedKey===key)return;
    queryQueuedKey=key;queueMicrotask(()=>{
      if(queryQueuedKey===key)queryQueuedKey='';
      const current=currentGroup(),currentRevision=workspace()?.revision||0;
      if(!destroyed&&current?.id===g.id&&portfolioRequestPath({...route.state(),comparison:current.id})+'|'+currentRevision===key)void query.load(route.state(),{revision});
    });
  }
  const emptyRow=message=>`<div class="console-query-empty">${esc(message)}</div>`;
  const signed=value=>finite(value)?(value>0?'+':'')+num(value):'—';
  const valueClass=value=>finite(value)&&value<0?'negative':finite(value)&&value>0?'positive':'';
  function accountBand(summary,{aggregate=false}={}){
    if(!summary)return '<div class="console-account-band" aria-busy="true"><span class="muted">계좌 요약 조회 중…</span></div>';
    const money=summary.hasPerformance?'평가자산':'시작 자금';
    const values=aggregate?`<div><dt>${summary.hasPerformance?'합산 평가자산':'합산 시작 자금'} <small>USDT</small></dt><dd>${num(summary.equity)}</dd><small>현금 ${num(summary.cash)} USDT</small></div><div><dt>합산 손익 <small>USDT</small></dt><dd class="${valueClass(summary.pnl)}">${signed(summary.pnl)} <small>${pct(summary.totalReturn)}</small></dd></div><div><dt>총 보유 <small>BTC</small></dt><dd>${num(summary.btcQuantity,6)}</dd></div><div><dt>수수료 <small>USDT</small></dt><dd>${num(summary.feesPaid)}</dd></div>`:`<div><dt>${money} <small>USDT</small></dt><dd>${num(summary.equity)}</dd></div><div><dt>평가손익 <small>USDT</small></dt><dd class="${valueClass(summary.pnl)}">${signed(summary.pnl)}</dd></div><div><dt>수익률</dt><dd class="${valueClass(summary.totalReturn)}">${pct(summary.totalReturn)}</dd></div><div><dt>현금 <small>USDT</small></dt><dd>${num(summary.cash)}</dd></div><div><dt>보유 <small>BTC</small></dt><dd>${num(summary.btcQuantity,6)}</dd></div><div><dt>수수료 <small>USDT</small></dt><dd>${num(summary.feesPaid)}</dd></div>`;
    return `<dl class="console-account-band${aggregate?' console-account-aggregate':''}">${values}</dl>${summary.hasPerformance?`<div class="console-valuation-meta"><span>평가 봉 ${stamp(summary.asOf)}</span><span>잔고 기준 ${stamp(summary.accountAsOf||summary.asOf)}</span><details><summary>계산 기준</summary><p>수익률 = 평가손익 ÷ 초기 자금 ${num(summary.initialCapital)} USDT</p><p>평가손익 = 평가자산 − 초기 자금 · 모의 수수료 반영</p>${raw(summary,'평가 시각·출처·저장 버전')}</details></div>`:''}`;
  }
  function equityChart(view){
    const points=list(view?.curve).filter(p=>validTime(p.asOf)&&finite(p.equity));
    if(!points.length)return emptyRow(!view?.summary?'평가 기록을 불러오는 중…':view.summary.hasPerformance?'표시할 평가자산 기록이 없습니다.':'공통 봉 처리가 끝나면 평가자산을 표시합니다.');
    const width=900,height=180,left=76,right=16,top=18,bottom=28,min=Math.min(...points.map(p=>p.equity)),max=Math.max(...points.map(p=>p.equity)),range=max-min||Math.max(max*.02,1),from=Date.parse(points[0].asOf),to=Date.parse(points.at(-1).asOf);
    const x=p=>left+(Date.parse(p.asOf)-from)/Math.max(to-from,1)*(width-left-right),y=p=>top+(max+range*.1-p)/(range*1.2)*(height-top-bottom);
    const line=points.length===1?`<circle cx="${x(points[0])}" cy="${y(points[0].equity)}" r="3" class="console-equity-line"/>`:`<polyline points="${points.map(p=>x(p).toFixed(1)+','+y(p.equity).toFixed(1)).join(' ')}" class="console-equity-line"/>`;
    return `<div class="console-chart console-performance-chart"><svg viewBox="0 0 ${width} ${height}" role="img" aria-label="공통 완료 봉 기준 평가자산"><g class="console-chart-grid">${[min,max].map(v=>`<line x1="${left}" x2="${width-right}" y1="${y(v)}" y2="${y(v)}"/><text x="${left-8}" y="${y(v)+4}" text-anchor="end">${num(v,0)}</text>`).join('')}</g>${line}<text x="${left}" y="${height-6}">${esc(time(points[0].asOf))}</text><text x="${width-right}" y="${height-6}" text-anchor="end">${esc(time(points.at(-1).asOf))}</text></svg></div>`;
  }
  function groupControls(g){
    if(!g)return '';
    const active=g.status==='running',first=!active&&!g.completedBars&&!g.round&&!list(g.history).length,replay=groupType(g)!=='FORWARD_PAPER';
    const leaseActive=Number.isFinite(g.round?.lease?.until)&&g.round.lease.until>Date.now(),failed=list(g.round?.members).some(m=>m.stage==='FAILED'),needsRecovery=!!g.round&&!blocked()&&!replayRunning&&(failed||!leaseActive);
    return button(first?(replay?'첫 봉 실행':'운용 시작'):active?'일시중지':'재개',first&&replay?'comparison-first':'comparison-status',g.id,{small:true,primary:first,disabled:blocked()})+button(busy||leaseActive?'실행 중…':g.round?'이어서 실행':replay?'다음 봉':'실행 확인','comparison-run',g.id,{small:true,disabled:blocked()||replayRunning||leaseActive||!active})+(replay?button(replayRunning?'재생 중지':'6봉 재생','comparison-replay',g.id,{small:true,disabled:blocked()&&!replayRunning||leaseActive||!active}):'')+(needsRecovery?button('저장·복구','group-records',g.id,{small:true}):'');
  }
  function toolbar(g){
    const other=standaloneBots(),state=route.state(),source=g?.experimentType==='FORWARD_PAPER'?(hooks.getMarket?.()?.providerLabel||consoleProviderLabel(hooks.getMarket?.()?.provider)):'Binance',type=g?(groupType(g)==='FORWARD_PAPER'?'실시간 모의':'과거 재생'):'개별 모의운용';
    return `<header class="console-toolbar"><h1 tabindex="-1">${screenMode==='portfolio'?'자산':screenMode==='desk'?'대시보드':'모의투자'}</h1><label class="console-scope-select"><span class="visually-hidden">비교 운용</span><select data-console-group aria-label="비교 운용">${groups().map(v=>`<option value="${esc(v.id)}"${g?.id===v.id?' selected':''}>${esc(v.name)}</option>`).join('')}${other.length?`<option value="other"${!g?' selected':''}>기타 운용</option>`:''}${!g&&!other.length?'<option value="">운용 없음</option>':''}</select></label>${!g&&other.length?`<label class="console-scope-select"><span class="visually-hidden">운용 봇</span><select data-console-bot aria-label="운용 봇">${other.map(d=>`<option value="${esc(d.id)}"${selectedBot===d.id?' selected':''}>${esc(d.name)}</option>`).join('')}</select></label>`:''}<span class="console-source-label">${esc(type)}${g?' · '+esc(source):''}</span><div class="console-toolbar-actions">${button('실시간 시작','start-forward','',{small:true,primary:!groups().length,disabled:blocked()})}${button('과거 재생','start-replay','',{small:true,disabled:blocked()})}${button('새로고침','refresh','',{small:true,disabled:blocked()})}</div></header>`;
  }
  function mindTabs(g,view){
    if(!g)return '';
    const w=workspace(),members=list(view?.scope?.memberProfiles).length?view.scope.memberProfiles:list(g.members).map(m=>({profileId:m.profileId||find(w.deployments,m.deploymentId)?.investmentProfileId,profileName:entityName(w,'investmentProfiles',m.profileId||find(w.deployments,m.deploymentId)?.investmentProfileId)}));
    const tabs=[{profileId:'all',profileName:'전체'},...members.filter((m,i,a)=>m.profileId&&a.findIndex(v=>v.profileId===m.profileId)===i)];
    return `<nav class="console-mind-tabs" aria-label="투자 프로필">${tabs.map(m=>`<button type="button" data-console-action="mind-select" data-console-id="${esc(m.profileId)}"${route.state().mind===m.profileId?' aria-current="page"':''}>${esc(m.profileName)}</button>`).join('')}<span>${list(g.members).length}개 프로필</span></nav>`;
  }
  function viewTabs(){const r=route.state(),tabs=[['overview','개요'],['decisions','실행 기록'],['trades','거래 내역'],['experiences','경험'],['knowledge','지식'],['settings','설정']];return `<nav class="console-view-tabs" aria-label="운용 정보">${tabs.map(([id,label])=>`<button type="button" data-console-action="view-select" data-console-id="${id}"${r.view===id?' aria-current="page"':''}>${label}</button>`).join('')}</nav>`;}
  function profileRows(view,g){
    const w=workspace(),items=Array.isArray(view?.profiles)?view.profiles:list(g?.members).map(m=>{const d=find(w.deployments,m.deploymentId);return {profileId:m.profileId||d?.investmentProfileId,profileName:entityName(w,'investmentProfiles',m.profileId||d?.investmentProfileId),deploymentId:m.deploymentId,deploymentName:d?.name};}).filter(p=>route.state().mind==='all'||p.profileId===route.state().mind);
    return table(['프로필','배정 자금','평가자산','수익률','현금','수수료','운용 상태','최근 선택',''],items.map(p=>{
      const d=find(w.deployments,p.deploymentId),progress=list(g?.round?.members).find(m=>m.deploymentId===p.deploymentId)||list(view?.progress?.members).find(m=>m.deploymentId===p.deploymentId),last=p.lastDecision,stage={PENDING:'실행 대기',EVALUATING:'JEV 요청 중',EVALUATED:'선택 저장',EXECUTING:'모의 체결 중',COMPLETED:'이번 봉 완료',FAILED:'실행 실패',RETRY_WAIT:'재시도 대기'}[progress?.stage],state=stage||(g?consoleGroupRunLabel(g):d?.runtimeStatus==='running'?'다음 실행 대기':'일시중지');
      return [`<button class="console-text-button" data-console-action="mind-select" data-console-id="${esc(p.profileId)}">${esc(p.profileName)}</button>`,`<span class="console-number">${num(p.initialCapital)}</span>`,`<span class="console-number">${num(p.equity)}</span>`,`<span class="console-number ${valueClass(p.totalReturn)}">${pct(p.totalReturn)}</span>`,`<span class="console-number">${num(p.cash)}</span>`,`<span class="console-number">${num(p.feesPaid)}</span>`,esc(state),last?`<button class="console-text-button" data-console-action="decision" data-console-id="${esc(last.id)}">${esc(ACTIONS[last.action]||'확인 필요')} · ${esc(STANCES[last.stance]||'기본')}</button>`:'첫 실행 대기',button('지식','mind-knowledge',p.profileId,{small:true})];
    }),'공통 완료 봉의 프로필별 계좌 상태 · USDT');
  }
  function compactDecision(d,r){
    if(!d)return emptyRow('투자 프로필을 선택하세요.');
    const w=workspace(),a=find(w.accounts,d.accountId),status=r?consoleRecordStatus(w,r):null,response=actualResponse(r),answer=response?.answers?.action,applied=find(w.memoryVersions,d.memoryVersionId),lastRequest=list(w.decisionRecords).filter(v=>v.deploymentId===d.id&&v.jevRequest?.state).at(-1),sent=list(lastRequest?.jevRequest?.state?.approvedPersonalMemory),fills=r?fillsFor(w,r):[],pending=r&&status?.label==='주문 검토 대기'&&list(r.ruleResults).some(v=>v.id==='order.prepare.paper'&&v.proposal)?1:0,experience=list(w.experiences).filter(e=>e.decisionId===r?.id).at(-1);
    const observation=experience?({AWAITING_OBSERVATION:experience.experienceType==='EXECUTION_OPERATION'?'복구 관측 대기':'24시간 관측 대기',OBSERVED:'관측 완료 · 평가 대기',EVALUATED:'평가 완료'})[experience.status]||'관측 기록 보존':'후속 관측 기록 대기';
    return `<aside class="console-order-pane"><div class="console-pane-heading"><h2>최근 실행</h2>${r?button('상세','decision',r.id,{small:true}):''}</div>${r?`<div class="console-selected-action"><strong>${esc(ACTIONS[r.decision?.action]||'확인 필요')}</strong><span>${esc(STANCES[r.decision?.stance]||'기본')}</span><span class="console-position">보유 ${num(a?.btcQuantity,6)} BTC</span></div><p class="tiny muted">${stamp(r.inputPackage?.asOf)}</p><p class="console-execution-count">이번 결정 · 체결 ${fills.length}건 · 추가 주문 ${pending}건</p><p>${pill(status.label,status.tone)}</p><p class="console-distribution-line tiny muted">${['buy','hold','sell'].map(k=>ACTIONS[k]+' '+pct(answer?.probabilities?.[k]??r.decision?.choiceDistribution?.[k])).join(' · ')}</p><details><summary>규칙 기반 요약</summary><p class="tiny muted">선택 신뢰도 ${pct(answer?.confidence??r.decision?.choiceConfidence)}</p><ul class="console-reasons">${list(r.decision?.reasons).map(reason=>`<li>${esc(typeof reason==='string'?reason:reason.message||'실행 검사 기록')}</li>`).join('')||'<li>보존된 요약 없음</li>'}</ul></details>`:'<p class="muted">첫 실행 대기</p>'}${!currentGroup()?`<div class="console-pane-controls">${button('전략 실행','individual-run',d.id,{small:true,primary:true,disabled:blocked()})}${status?.label==='주문 검토 대기'?button('모의 주문 검토','individual-review',r.id,{small:true,disabled:blocked()}):''}${button(d.runtimeStatus==='running'?'일시중지':'재개','bot-status',d.id,{small:true,disabled:blocked()})}</div>`:''}<p class="tiny muted console-memory-state">활성 기억 ${applied?'v'+applied.version:'—'} · 승인 항목 ${list(applied?.items).length}건 · ${lastRequest?'최근 전송 '+sent.length+'건':'첫 전송 대기'}</p><button class="console-text-button console-observation-state" data-console-action="${experience?'experience':'view-select'}" data-console-id="${esc(experience?.id||'experiences')}">${esc(observation)}</button></aside>`;
  }
  function queryFilters(page){
    const r=route.state(),options={decisions:[['READY','선택 완료'],['FAILED','실패'],['REJECTED','주문 제한']],trades:[['BUY','매수'],['SELL','매도']],experiences:[['AWAITING_OBSERVATION','관측 대기'],['OBSERVED','평가 대기'],['EVALUATED','평가 완료']],knowledge:[['CANDIDATE','검증 대기'],['VALIDATED','승인 검토'],['APPROVED','승인'],['REJECTED','반려'],['PROPOSED','초안']]};
    const draftKey=portfolioFinancialKey(r)+'|'+r.view;if(searchDraftKey!==draftKey){searchDraft=r.search;searchDraftKey=draftKey;}
    return `<form class="console-query-tools" data-console-form="portfolio-search"><label class="console-search"><span class="visually-hidden">현재 목록 검색</span><input name="search" value="${esc(searchDraft)}" placeholder="현재 목록 검색" aria-label="현재 목록 검색" maxlength="120"></label><button class="button small" type="submit">검색</button><select data-console-status aria-label="상태 필터"><option value="">전체 상태</option>${list(options[r.view]).map(([id,name])=>`<option value="${id}"${r.status===id?' selected':''}>${name}</option>`).join('')}</select><label class="console-page-size"><span class="visually-hidden">페이지당 항목</span><select data-console-page-size aria-label="페이지당 항목">${[10,20,50].map(n=>`<option value="${n}"${r.pageSize===n?' selected':''}>${n}건씩</option>`).join('')}</select></label><span class="tiny muted">${page?num(page.total,0)+'건 중 '+list(page.items).length+'건':'목록 조회 중'}</span></form>`;
  }
  function pageFooter(page){return `<footer class="console-page-footer"><span class="tiny muted">${page?'저장 기록 '+num(page.total,0)+'건':''}</span><div>${route.state().cursor?button(cursorTrail.length?'이전':'처음','page-prev','',{small:true}):''}${button('다음','page-next',page?.nextCursor||'',{small:true,disabled:!page?.hasMore||query.state().loading})}</div></footer>`;}
  function pagedList(view){
    const r=route.state(),page=view?.page,items=list(page?.items),w=workspace();let content='';
    if(r.view==='decisions')content=table(['기준 봉','프로필','JEV 선택','매수 / 유지 / 매도','결과',''],items.map(x=>[stamp(x.asOf),esc(x.profileName),`${esc(ACTIONS[x.action]||'확인 필요')}<small>${esc(STANCES[x.stance]||'기본')}</small>`,x.distribution?['buy','hold','sell'].map(k=>pct(x.distribution[k])).join(' / '):'응답 없음',esc(({FAILED:'실행 실패',REJECTED:'주문 제한',READY:'선택 완료'})[x.status]||'기록됨'),button('상세','decision',x.id,{small:true})]));
    if(r.view==='trades')content=table(['체결 시각','프로필','방향','수량 (BTC)','체결가 (USDT)','수수료 (USDT)','출처',''],items.map(x=>[stamp(x.at),esc(x.profileName),esc(ACTIONS[String(x.side).toLowerCase()]||'체결'),`<span class="console-number">${num(x.quantity,8)}</span>`,`<span class="console-number">${num(x.fillPrice)}</span>`,`<span class="console-number">${num(x.fee)}</span>`,esc(consoleProviderLabel(x.marketProvider)),button('실행 상세','decision',x.decisionId,{small:true})]));
    if(r.view==='experiences')content=table(['기준 봉 / 프로필','경험','상태','24시간 진단',''],items.map(x=>[stamp(x.occurredAt)+`<small>${esc(x.profileName)}</small>`,esc(x.summary),esc(({AWAITING_OBSERVATION:'관측 대기',OBSERVED:'평가 대기',EVALUATED:'평가 완료'})[x.status]||'기록됨'),x.observation?`<span class="console-number ${valueClass(x.observation.netReturn)}">${pct(x.observation.netReturn)}</span>`:'후속 결과 대기',button('관측·학습','experience',x.id,{small:true})]));
    if(r.view==='knowledge')content=table(['제목','유형','검토 상태','운용 적용','범위 / 버전','사용 가능 시각',''],items.map(x=>[esc(x.title)+`<small>${esc(x.preview||'')}</small>`,esc(KNOWLEDGE_TYPES[x.knowledgeType]||({CANDIDATE:'학습 후보',APPROVED_MEMORY:'승인 기억',COMMON_NOTE:'공통 노트',RESEARCH_RULE:'실행 규칙'})[x.kind]||'지식'),esc(({CANDIDATE:'검증 대기',VALIDATED:'승인 검토',APPROVED:'승인',REJECTED:'반려',PROPOSED:'초안'})[x.status]||'기록됨'),esc(({AVAILABLE:'본 운용 사용 가능',APPLIED_WAITING:'적용 · 가용 시각 대기',APPROVED_UNAPPLIED:'승인 · 미적용',SHARED_SOURCE:'공통 자료'})[x.usage]||'후보 검토'),esc(x.profileId?entityName(w,'investmentProfiles',x.profileId):'공통')+(x.memoryVersion||x.version?'<small>v'+esc(x.memoryVersion||x.version)+'</small>':''),stamp(x.availableAt),button(x.kind==='CANDIDATE'?'검토':'상세',x.kind==='CANDIDATE'?'candidate-review':'knowledge-detail',x.kind==='CANDIDATE'?x.entityId:x.id,{small:true})]));
    const loading=query.state().loading||!page&&!query.state().error,noItems=!items.length;
    return `<section class="console-list-workspace" aria-busy="${loading}">${queryFilters(page)}<div class="console-list-scroll">${noItems?emptyRow(loading?'목록을 불러오는 중…':r.search||r.status?'조건에 맞는 기록이 없습니다.':({decisions:'아직 실행 기록이 없습니다.',trades:'아직 모의 체결이 없습니다.',experiences:'아직 경험 기록이 없습니다.',knowledge:'아직 연결된 지식이 없습니다.'})[r.view]||'기록이 없습니다.'):content}</div>${pageFooter(page)}</section>`;
  }
  function settingsView(bots,g){const w=workspace();return `<div class="console-settings-grid">${bots.map(d=>{
    const p=find(w.investmentProfiles,d.investmentProfileId),memory=find(w.memoryVersions,d.memoryVersionId),presetVersion=find(w.riskPresetVersions,d.riskPresetVersionId),presetId=presetVersion?.entityId||list(w.riskPresets).find(v=>v.currentVersionId===d.riskPresetVersionId)?.id;
    const editButton=(label,op,id)=>`<button type="button" class="button small" data-op="${op}" data-id="${esc(id)}">${esc(label)}</button>`;
    return `<section><h2>${esc(p?.name||d.name)}</h2>${row('운용 봇',esc(d.name))}${row('프로필',versionName(w.profileVersions,d.investmentProfileVersionId))}${row('전략',versionName(w.strategyVersions,d.strategyVersionId))}${row('운용 프리셋',versionName(w.riskPresetVersions,d.riskPresetVersionId))}${row('적용 기억',memory?'v'+memory.version+' · 승인 항목 '+list(memory.items).length+'건':'—')}<div class="actions">${p?editButton('투자 원칙 편집','profile-edit',p.id):''}${presetId?editButton('운용 프리셋 편집','preset-edit',presetId):''}${button('적용 버전','bot-configure',d.id,{small:true})}${button('기억 적용 검토','memory-apply',d.id,{small:true})}${button('경험·학습','experience-profile',d.investmentProfileId,{small:true})}</div><p class="tiny muted spaced">새 운용에서 변경 버전을 선택합니다.</p></section>`;
  }).join('')}${g?`<details><summary>공통 운용 조건</summary>${row('프로필당 자금',num(g.conditions?.initialCash)+' USDT')}${row('모의 수수료 / 슬리피지',num(g.conditions?.feeBps,1)+' / '+num(g.conditions?.slippageBps,1)+' bp')}${button('저장·복구 상태','group-records',g.id,{small:true})}</details>`:''}</div>`;}
  function individualOverview(view,bot){
    if(!bot)return emptyRow('운용 봇을 선택하세요.');
    const p=list(view?.profiles).find(p=>p.deploymentId===bot.id),memory=p?.latestMemory,knowledge=p?.knowledge,w=workspace(),waiting=list(w.experiences).filter(e=>e.deploymentId===bot.id&&e.status==='AWAITING_OBSERVATION').length;
    return table(['운용 정보','현재 기록',''],[
      ['운용 봇',esc(bot.name),button('설정','view-select','settings',{small:true})],
      ['기억 버전',memory?'적용 v'+esc(memory.appliedVersion)+' · 최근 승인 v'+esc(memory.latestVersion):'조회 중',button('기억 적용','memory-apply',bot.id,{small:true})],
      ['최근 JEV에 전송한 기억',memory&&Number.isSafeInteger(memory.lastSentItemCount)?memory.lastSentItemCount+'건 · '+time(memory.lastSentAsOf):'첫 실행 대기',button('지식','view-select','knowledge',{small:true})],
      ['후속 관측 대기',waiting+'건',button('경험 보기','view-select','experiences',{small:true})],
      ['학습 후보',knowledge?knowledge.candidateCount+'건 · 승인 검토 '+knowledge.validatedCount+'건':'조회 중',button('학습 검토','experience-profile',bot.investmentProfileId,{small:true})],
    ],'선택한 프로필의 운용과 학습 상태');
  }
  function standaloneSummary(d){const w=workspace(),a=find(w.accounts,d?.accountId),r=latestFor(w,d?.id),m=consoleAccountMetrics(a,r);return {initialCapital:a?.initialEquity,equity:m.equity,cash:a?.cash,btcQuantity:a?.btcQuantity,pnl:finite(m.equity)&&finite(a?.initialEquity)?m.equity-a.initialEquity:null,totalReturn:m.totalReturn,feesPaid:a?.feesPaid,hasPerformance:!!r,asOf:a?.asOf};}
  function render(options={}){
    const requestedMode=['portfolio','desk'].includes(options.mode)?options.mode:'paper';
    // Back/forward can notify this child before the app updates its current page.
    // The browser owns the restored top-level path throughout that transition.
    screenMode=String(browser?.location?.hash||'').match(/^#(paper|portfolio|desk)(?:\?|$)/)?.[1]||requestedMode;
    const w=workspace();if(!w)return '<div class="investment-console console-workspace"><header class="console-toolbar"><h1 tabindex="-1">모의투자</h1></header><div class="console-query-empty" role="status">운용 기록을 불러오는 중…</div></div>';
    if(!initialized){initialized=true;if(!selectedGroup){selectedGroup=groups().at(-1)?.id||'other';route.set({comparison:selectedGroup},{replace:true});}}
    if(selectedGroup==='all')selectedGroup='other';
    if(selectedGroup!=='other'&&!find(groups(),selectedGroup)&&groups().length){selectedGroup=groups().at(-1).id;route.set({comparison:selectedGroup,mind:'all',bot:''},{replace:true});}
    const g=currentGroup();if(!g&&!selectedBot&&standaloneBots().length){selectedBot=standaloneBots()[0].id;route.set({comparison:'other',bot:selectedBot,mind:'all'},{replace:true});}
    if(route.state().page!==screenMode||route.state().comparison!==selectedGroup)route.set({page:screenMode,comparison:selectedGroup},{replace:true,resetCursor:false});
    ensurePortfolio(g);
    const r=route.state(),q=query.state(),requestRoute={...r,comparison:g?.id||r.comparison},view=q.key===portfolioRequestPath(requestRoute)?q.data:q.financialKey===portfolioFinancialKey(requestRoute)&&q.data?{...q.data,page:null}:null,bots=selectedDeployments(),rows=records(),individual=r.mind!=='all'||!g,bot=bots[0],record=bot?latestFor(w,bot.id):null,summary=g?view?.summary:bot?standaloneSummary(bot):null;
    const source=summary?.actualSource,status=g?consoleGroupRunLabel(g,{replayRunning:replayRunning&&replayGroupId===g.id}):'독립 운용',next=g?.experimentType==='FORWARD_PAPER'&&validTime(g.cursorAt)?new Date(Date.parse(g.cursorAt)+(g.conditions?.settleDelayMs??300000)).toISOString():g?.cursorAt,partial=g?.round;
    const statusRow=g?`<div class="console-status-line"><span>${pill(status,partial?'warning':'')}</span><span class="tiny muted">${summary?.hasPerformance?'평가 기준 '+time(summary.asOf):summary?'공통 완료 봉 대기':'평가 기록 조회 중'} · ${g.experimentType==='FORWARD_PAPER'?'다음 실행':'다음 봉'} ${time(next)}</span><div class="console-run-controls">${groupControls(g)}</div></div>`:'';
    const roundNotice=partial?`<div class="console-round-notice" role="status"><strong>${summary?.hasPerformance?'공통 완료 봉 기준 '+time(summary.asOf):summary?'초기 자금 기준':'평가 기준 조회 중'}</strong><span>새 봉 처리 ${busy||replayRunning||Number.isFinite(partial.lease?.until)&&partial.lease.until>Date.now()?'중':'대기'} ${list(partial.members).filter(m=>m.stage==='COMPLETED').length}/${list(g.members).length} · 완료 시 합산 성과 갱신</span></div>`:'';
    let active='';
    if(r.view==='overview')active=g?(individual?individualOverview(view,bot):profileRows(view,g))+`<details class="console-comparison-details"><summary>이번 봉 JEV 선택 비교</summary>${comparisonPanel(g)}</details>`:bot?`<div class="console-independent-note">기타 운용 · ${esc(bot.name)}${row('계좌 평가 시각',stamp(summary?.asOf))}<div class="actions">${button('실행 기록','standalone-history',bot.id,{small:true})}${button('경험·학습','experience-profile',bot.investmentProfileId,{small:true})}</div></div>`:emptyRow('실시간 시작 또는 과거 재생으로 첫 운용을 만드세요.');
    else if(r.view==='settings')active=settingsView(bots,g);
    else if(g)active=pagedList(view);
    else active=r.view==='decisions'?historyPanel(rows):r.view==='experiences'?experienceRows(rows):r.view==='knowledge'?settingsView(bots,null):bot?table(['체결 시각','방향','수량 (BTC)','체결가','수수료'],list(find(w.accounts,bot.accountId)?.ledger).slice(-20).reverse().map(f=>[stamp(f.at),esc(ACTIONS[f.side]),num(f.quantity,8),num(f.fillPrice),num(f.fee)])):emptyRow('운용 봇을 선택하세요.');
    const mainChart=individual?`<div class="console-individual-workbench"><section class="console-price-workspace"><div class="console-chart-heading"><h2>BTC / USDT</h2><span>${record?esc(consoleMarketSource(record,w).providerLabel):'실행 자료 대기'} · 4시간</span></div>${priceChart(w,rows,bots.map(d=>d.id),hooks.getDataset?.())}</section>${compactDecision(bot,record)}</div>`:`<section class="console-aggregate-workbench"><div class="console-chart-heading"><h2>평가자산 <small>USDT</small></h2><span>${source?esc(source.providerLabel||consoleProviderLabel(source.provider))+' · ':''}${view?.curveCoverage?.truncated?'최근 '+view.curveCoverage.retainedFrames+'개 공통 완료 봉':summary?.hasPerformance?'공통 완료 '+summary.completedBars+'봉':summary?'공통 완료 봉 대기':'평가 기록 조회 중'}</span></div>${equityChart(view)}</section>`;
    return `<div class="investment-console console-workspace" data-console-scope="${g?'comparison':'standalone'}">${toolbar(g)}${statusRow}${mindTabs(g,view)}${error?`<div class="console-inline-error" role="alert">${esc(error)}</div>`:''}${q.error&&g?`<div class="console-inline-error" role="alert">${esc(q.error)} ${button('다시 조회','portfolio-retry','',{small:true})}</div>`:''}${roundNotice}${accountBand(summary,{aggregate:!!g&&!individual})}${mainChart}<div class="console-tab-workspace">${viewTabs()}<div class="console-tab-content" data-console-view="${esc(r.view)}"${g&&q.loading?' aria-busy="true"':''}>${active}</div></div>${replayRunning?'<div class="console-replay-status" role="status">브라우저 6봉 재생 중 '+button('중지','replay-stop')+'</div>':''}</div>`;
  }
  function choicePanel(record){
    const response=actualResponse(record),answers=response?.answers||{},questions=record.jevRequest?.questions||{},labels={action:'행동 선택',stance:'운용 강도',buyEvidence:'매수 근거 선택',sellEvidence:'매도 근거 선택'};
    const allRules=list(record.jevRequest?.state?.rules),evidenceLabels={none:'선택 근거 없음',...Object.fromEntries(allRules.map((r,i)=>['r'+i,r.title||'승인 근거 '+(i+1)]))};
    return `<div class="console-choice-grid">${Object.entries(labels).map(([key,title])=>{const answer=answers[key];if(!answer)return `<section class="console-choice"><h4>${title}</h4><p class="tiny muted">보존된 JEV 응답 없음</p></section>`;const selected=key==='action'?ACTIONS[answer.choice]:key==='stance'?STANCES[answer.choice]:evidenceLabels[answer.choice];const category=key==='action'?ACTIONS:key==='stance'?STANCES:evidenceLabels;return `<section class="console-choice"><h4>${title}</h4><strong>${esc(selected||questions[key]?.criteria?.[answer.choice]||'선택 근거')}</strong><p class="tiny muted">선택 신뢰도 ${pct(answer.confidence)}</p>${distribution(answer.probabilities,category)}</section>`;}).join('')}</div><p class="tiny muted spaced">선택 신뢰도는 JEV의 선택 응답 값이며, 투자 성공률은 후속 운용 성과로 평가합니다.</p>`;
  }
  function decisionModal(record){
    const w=workspace(),d=find(w.deployments,record.deploymentId),input=record.inputPackage||{},decision=record.decision||{},response=actualResponse(record),status=consoleRecordStatus(w,record),fills=fillsFor(w,record),experiences=list(w.experiences).filter(e=>e.decisionId===record.id),started=input.decisionStartedAt,completed=input.decisionCompletedAt,latency=validTime(started)&&validTime(completed)?Date.parse(completed)-Date.parse(started):null,proposal=list(record.ruleResults).find(r=>r.id==='order.prepare.paper')?.proposal,used=list(decision.evidenceRefs),submitted=list(record.jevRequest?.state?.rules),sentMemory=list(record.jevRequest?.state?.approvedPersonalMemory),approvedNotes=list(input.approvedNotes),researchRules=list(input.approvedResearchRules),memory=list(input.approvedMemory);
    const heading=`<div class="console-detail-heading"><div><p class="tiny muted">${esc(entityName(w,'investmentProfiles',record.investmentProfileId))} · ${esc(d?.name||'운용 봇')}</p><h3>${esc(ACTIONS[decision.action]||'확인 필요')} · ${esc(STANCES[decision.stance]||'기본')}</h3><p>${stamp(input.asOf)}</p></div>${pill(status.label,status.tone)}</div>`;
    const notes=submitted.length?submitted.map(item=>evidenceCard(item,item.id?.startsWith('memory_')?'프로필 기억':researchRules.some(r=>r.id===item.id)?'실행 규칙':'투자 노트',used)).join(''):'<p class="muted">요청에 전송한 근거 선택 후보가 없습니다.</p>';
    const sentMemoryBody=sentMemory.length?sentMemory.map(item=>evidenceCard(item,'전송한 개인 기억',used)).join(''):'<p class="muted">요청에 별도로 전송한 개인 기억이 없습니다.</p>';
    const availableBody=row('당시 사용 가능 승인 노트',approvedNotes.length+'개 · 매매 규칙 '+approvedNotes.filter(n=>n.kind==='rule').length+'개 포함')+row('당시 사용 가능 실행 규칙',researchRules.length+'개')+row('당시 사용 가능 개인 기억',memory.length+'개')+row('사용 가능 지식 기준',stamp(input.knowledgeAsOf))+'<p class="tiny muted spaced">실행 당시 입력 스냅샷에 보존한 사용 가능 자료의 개수입니다. 위 전송 목록은 저장된 JEV 요청에서 확인합니다.</p>';
    const source=consoleMarketSource(record,w),sourceBody=row('입력 시세 출처',esc(source.providerLabel)+' '+esc(source.symbol||''))+row('자료 수집 주소',esc(source.origin||'저장된 주소 없음'))+row('자료 수집 계약',esc(source.loaderVersion||'이전 기록 · 계약 정보 없음'))+row('기준 봉',stamp(input.asOf));
    const versions=table(['적용 항목','저장된 버전'],[['투자 프로필',versionName(w.profileVersions,record.investmentProfileVersionId)],['전략',versionName(w.strategyVersions,record.strategyVersionId)],['운용 프리셋',versionName(w.riskPresetVersions,record.riskPresetVersionId)],['프로필 기억',versionName(w.memoryVersions,record.memoryVersionId)],['실제 JEV 모델',esc(response?.model||decision.model||'응답 없음')],['질문 계약',esc(decision.questionVersion||input.decisionContractVersionId||'—')],['신호 결합 정책',esc(input.fusionPolicyVersionId||'—')]],'실행 당시 적용 버전');
    const usage=response?.usage||decision.usage;
    const times=row('선택 시작',stamp(started))+row('선택 완료',stamp(completed))+row('응답 소요 시간',latency===null?'기록 없음':num(latency/1000,2)+'초')+row('입력 / 출력 토큰',usage?num(usage.input_tokens,0)+' / '+num(usage.output_tokens,0):'응답에 사용량 없음')+row('사용 가능 지식 기준',stamp(input.knowledgeAsOf));
    const guards=list(record.ruleResults).map(rule=>{const labels={'mechanical-baseline':'가격 구조 기준','semantic-conflict-policy':'신호 결합','mechanical-direction-confirmation':'방향 일치 검사','order.prepare.paper':'비중·비용·주문 검사','provider-error':'JEV 요청 오류'},message=list(rule.reasons).map(r=>r.message||'조건을 확인하세요.').join(' · ');return `<div class="console-guard"><strong>${esc(labels[rule.id]||'실행 검사')}</strong><span>${rule.action?esc(ACTIONS[rule.action]||'확인 필요'):rule.ok===true?'주문 조건 충족':rule.ok===false?'주문 조건 제한':rule.result==='HOLD'?'보유량 유지':rule.httpStatus?'응답 상태 '+rule.httpStatus:rule.mode==='advisory'?'계량 신호 참고':rule.mode==='confirmatory'?'같은 방향 확인':'검사 기록 보존'}</span>${message?`<p class="tiny muted">${esc(message)}</p>`:''}</div>`;}).join('');
    const order=proposal?row('목표 보유 비중',pct(proposal.targetWeight))+row('주문 방향',esc(ACTIONS[proposal.side]||'—'))+row('제안 유효 시각',stamp(record.expiresAt)):row('주문 결과',status.label);
    const fillContent=fills.length?fills.map(f=>`<article class="console-fill-detail">${row('모의 체결',esc(ACTIONS[f.side]||'—')+' '+num(f.quantity,8)+' BTC')}${row('체결 가격 공급처',esc(f.quote?consoleProviderLabel(f.quote.provider||providerFromUrl(f.quote.sourceUrl)):source.archived?'Binance 과거 봉 시가':'출처 확인 필요'))}${row('체결 시각',stamp(f.at))}${validTime(input.decisionCompletedAt)&&validTime(f.at)&&Date.parse(f.at)>=Date.parse(input.decisionCompletedAt)?row('선택 완료 후 체결까지',num((Date.parse(f.at)-Date.parse(input.decisionCompletedAt))/1000,2)+'초'):''}${row('체결 가격',num(f.fillPrice)+' USDT')}${row('수수료 / 슬리피지 비용',num(f.fee)+' / '+num(f.slippageCost)+' USDT')}${row('스프레드 비용',finite(f.spreadCost)?num(f.spreadCost)+' USDT':'과거 재생 기준')}${row('매도 실현손익',f.side==='sell'?num(f.realizedPnl)+' USDT':'매수 후 보유 중')}${f.quote?row('매수 / 매도 호가',num(f.quote.bid)+' / '+num(f.quote.ask)+' USDT')+row('주문 가능 시각',stamp(f.quote.orderEligibleAt))+row('호가 요청 시작',stamp(f.quote.requestStartedAt))+row('호가 관측 시각',stamp(f.quote.quoteObservedAt))+row('호가 잔량',num(f.quote.quantityAvailable,8)+' BTC')+row('가격 출처',esc(f.quote.priceSource||'—')):''}</article>`).join(''):'<p class="muted">이 선택에 연결된 모의 체결이 없습니다.</p>';
    const expContent=experiences.map(e=>`<article class="console-experience-link"><strong>${e.experienceType==='EXECUTION_OPERATION'?'실행·운영 경험':'선택 후속 관측'}</strong><p class="tiny muted">${e.status==='AWAITING_OBSERVATION'?'관측 대기 · 종료 '+time(consoleObservationDue(e)):e.status==='OBSERVED'?'관측 완료 · 평가 대기':'평가 완료'}</p>${button('관측·학습 열기','experience',e.id,{small:true})}</article>`).join('')||'<p class="muted">관련 경험을 아직 찾지 못했습니다.</p>';
    return heading+block('JEV 선택 결과',choicePanel(record))+block('규칙 기반 요약',`<ul class="console-reasons">${list(decision.reasons).map(reason=>`<li>${esc(reason)}</li>`).join('')}</ul>${row('최종 행동',esc(ACTIONS[decision.action]||'확인 필요'))}`)+block('JEV 근거 선택 후보',notes+`<p class="tiny muted spaced">요청에 전송한 근거 선택 후보 ${submitted.length}개 · 최대 16개. 매수·매도 근거 질문의 선택지를 구성합니다.</p>`)+block('전송한 개인 기억',sentMemoryBody)+block('당시 사용 가능 자료',availableBody)+block('시세 자료 출처',sourceBody)+block('버전·요청 정보',versions+times)+block('주문 조건',guards+order)+block('모의 체결·비용',fillContent)+block('경험·학습',expContent)+(status.label==='주문 검토 대기'?'<div class="form-actions">'+button('모의 주문 검토','individual-review',record.id,{primary:true,disabled:blocked()})+'</div>':'')+raw({decisionId:record.id,requestId:record.requestId,inputHash:record.inputPackageHash,sourceHash:input.sourceHash,marketDataRef:input.marketDataRef,record},'입력·응답·검사 원본 보기');
  }
  function openDecision(id){const record=find(workspace()?.decisionRecords,id);if(record)hooks.open('전략 실행 상세',`<div class="investment-console console-detail">${decisionModal(record)}</div>`);}
  function experienceModal(id){
    const w=workspace(),e=find(w.experiences,id);if(!e)return;
    const due=consoleObservationDue(e),waiting=e.status==='AWAITING_OBSERVATION',operation=e.experienceType==='EXECUTION_OPERATION',a=availability.get(id)||e.observation?.availability,isDue=due&&Date.parse(due)<=Date.now(),candidates=list(w.memoryCandidates).filter(c=>list(c.experienceIds).includes(id));
    const state=waiting?(operation?'운영 복구 관측 대기':isDue?'후속 자료 확인':'24시간 관측 대기'):e.status==='OBSERVED'?'관측 완료 · 평가 대기':'평가 완료';
    const next=consoleExperienceNextAction(e,candidates),nextButton=next?`<div class="actions spaced">${button(next.label,next.action,next.id,{primary:true,disabled:blocked()})}</div>`:'';
    const account=find(w.accounts,e.accountId||find(w.deployments,e.deploymentId)?.accountId),metrics=consoleAccountMetrics(account,latestFor(w,e.deploymentId)),unrealized=finite(metrics.price)&&finite(account?.averageCost)?account.btcQuantity*(metrics.price-account.averageCost):null;
    const ledgerSummary=account?block('계좌 원장 성과',row('현재 계좌 평가자산',num(metrics.equity)+' USDT')+row('모의 수익률 / 최초 자금',pct(metrics.totalReturn)+' / '+num(account.initialEquity)+' USDT')+row('누적 실현손익 / 평가손익',num(account.realizedPnl)+' / '+num(unrealized)+' USDT')+row('누적 수수료',num(account.feesPaid)+' USDT')+row('평가 기준 시세 출처',esc(consoleMarketSource(latestFor(w,e.deploymentId),w).providerLabel))+row('계좌 기준 시각',stamp(account.asOf))+'<p class="tiny muted spaced">이 계좌에 저장한 후속 선택·체결을 모두 포함한 원장 기준 성과입니다.</p>'):'';
    const diagnosticTitle=operation?'운영 후속 관측':'선택 후 '+(e.observation?.horizonHours||24)+'시간 진단';
    const source=consoleMarketSource(find(w.decisionRecords,e.decisionId),w),observationSource=e.observation?.source;
    const waitingContent=operation?'<p class="callout spaced">실행 실패의 원인과 복구 결과를 기록합니다.</p>':`<p class="tiny muted spaced">${isDue?'종료 시점까지의 연속 확정 봉과 해당 선택의 체결을 조회합니다.':'관측 기간이 끝나면 후속 가격과 계좌·비용을 함께 확인할 수 있습니다.'}</p>`;
    const body=`<div class="investment-console console-detail"><p class="tiny muted">${esc(entityName(w,'investmentProfiles',e.investmentProfileId))} · ${esc(entityName(w,'deployments',e.deploymentId))}</p><h3>${esc(state)}</h3>${nextButton}<p class="readable spaced">${esc(e.summary)}</p>${row('기준 봉',stamp(e.occurredAt))}${row('선택 입력 시세',esc(source.providerLabel)+' '+esc(source.symbol||''))}${observationSource?row('후속 진단 시세',esc(consoleProviderLabel(observationSource.provider||observationSource.kind))):''}${row('관측 종료 예정',stamp(due))}${a?row('자료 확보 상태',esc(a.message||({WAITING_TIME:'관측 기간 대기',WAITING_DATA:'확정 봉 부족',READY:'후속 봉 확보'})[a.status]||'조회 완료'))+row('자료 종료',stamp(a.availableThrough))+row('부족한 확정 봉',Number.isSafeInteger(a.missingBars)?a.missingBars+'개':'—'):''}${ledgerSummary}${waiting?waitingContent:block(diagnosticTitle,performancePanel(e))}${e.evaluation?block('경험 평가',`<p class="readable">${esc(e.evaluation.summary)}</p><p class="tiny muted">평가 완료 ${stamp(e.evaluationCompletedAt)}</p>`):''}${candidates.length?block('연결된 학습 후보',candidates.map(c=>`<article class="console-evidence"><h4>${esc(c.title)}</h4><p>${esc(c.text)}</p>${pill(({CANDIDATE:'검증 대기',VALIDATED:'사용자 검증 기록 완료',APPROVED:'승인',REJECTED:'반려'})[c.status]||'기록됨')}</article>`).join('')):''}<div class="actions spaced">${button('원인 실행 열기','decision',e.decisionId)}${button('경험 평가·학습 후보 관리','experience-profile',e.investmentProfileId)}</div>${raw(e,'경험 원본 보기')}</div>`;
    hooks.open('경험 관측·학습',body);
  }
  async function runGroup(id){
    const initial=find(groups(),id);if(!initial)return;
    const cursor=initial.cursorAt;let result;
    // One visible bar can use up to three short server requests. Each response
    // checkpoints a member; completed members are reused by the next request.
    for(let segment=0;segment<3&&!destroyed;segment++){
      result=await mutate('',{comparisonId:id},'/api/workspace/comparisons/run');
      const current=find(groups(),id),report=result?.report;
      if(!current||current.cursorAt!==cursor||current.status!=='running'||report?.status!=='partial'||report.failed>0||!(report.processed>0))break;
    }
    return result;
  }
  function manualRunForm(id){
    const w=workspace(),d=find(w.deployments,id),a=find(w.accounts,d?.accountId),last=latestFor(w,id);
    if(!d)return;
    if(d.experimentType==='FORWARD_PAPER')return mutate('',{deploymentId:id},'/api/workspace/evaluate');
    const next=singleTimes.get(id)||(last?new Date(Date.parse(last.inputPackage.asOf)+FOUR_HOURS).toISOString():a.asOf);
    form('과거 봉의 전략 실행','individual-run',`<p class="tiny full">${esc(d.name)} · 새 실행은 이전 주문 제안을 해제합니다.</p>`+input('기준 봉 마감 (UTC)','asOf',next.slice(0,16),'datetime-local',`min="2020-01-18T04:00" max="${esc((hooks.getMarket?.()?.defaultAsOf||next).slice(0,16))}" step="14400" required`),'전략 실행',id);
  }
  function orderReview(id){
    const w=workspace(),record=find(w.decisionRecords,id);if(!record)return;
    const status=consoleRecordStatus(w,record),proposal=list(record.ruleResults).find(r=>r.id==='order.prepare.paper')?.proposal;
    if(status.label!=='주문 검토 대기'||!proposal){hooks.toast?.(status.label);return;}
    hooks.open('모의 주문 검토',`<div class="investment-console">${row('운용 봇',esc(entityName(w,'deployments',record.deploymentId)))}${row('방향',esc(ACTIONS[proposal.side]))}${row('목표 비중',pct(proposal.targetWeight))}${row('기준 봉',stamp(record.inputPackage.asOf))}${row('제안 유효 시각',stamp(record.expiresAt))}<p class="tiny muted spaced">${record.inputPackage.executionPolicyVersionId==='FORWARD_PAPER_FIRST_EXECUTABLE_V1'?'결정 완료 후 새 매수·매도 호가와 잔량·스프레드·비용 한도를 확인해 모의 체결합니다.':'다음 연속 4시간봉 시가와 해당 운용의 비용 가정을 적용합니다.'}</p>${raw(proposal,'주문 제안 원본 보기')}<div class="form-actions">${button('모의 주문 실행','individual-execute',id,{primary:true})}</div></div>`);
  }
  function memoryApplyReview(id){
    const w=workspace(),d=find(w.deployments,id),profile=find(w.investmentProfiles,d?.investmentProfileId),applied=find(w.memoryVersions,d?.memoryVersionId),latest=find(w.memoryVersions,profile?.currentMemoryVersionId);
    if(!d)return;
    const versions=list(w.memoryVersions).filter(v=>v.investmentProfileId===d.investmentProfileId);
    if(!versions.length){hooks.toast?.('승인된 기억이 없습니다. 경험·학습에서 후보를 검토하세요.');return;}
    const selected=versions.find(v=>v.id===latest?.id)||versions.at(-1);
    form('승인 기억 적용','memory-apply',`<div class="full"><p>${esc(d.name)}</p>${row('현재 적용 기억',applied?'v'+applied.version+' · '+list(applied.items).length+'건':'—')}</div>`+select('적용할 승인 기억','sourceMemoryVersionId',versions.map(v=>[v.id,'v'+v.version+' · '+list(v.items).length+'건 · '+time(v.approvedAt)]),selected.id)+`<div class="console-memory-preview full">${list(selected.items).map(item=>evidenceCard(item,'승인 기억')).join('')||'<p class="tiny muted">이 버전은 기억 0건입니다. 적용하면 대상 운용의 개인 기억 입력을 비웁니다. 기존 경험과 승인 기억 버전은 보존합니다.</p>'}</div><label class="field full">적용 이유<textarea name="reason" required maxlength="1000" placeholder="적용할 운용과 기대하는 검토 효과를 기록하세요."></textarea></label><p class="full callout">이 봇과 연결된 비교 운용을 일시중지한 뒤, 승인 기억을 해당 운용에 적용할 새 버전으로 발행합니다. 원본 경험과 출처를 보존하며, 사용 가능 시점 이후 확정 봉부터 적용합니다.</p>`,'일시중지 후 기억 적용',id);
  }
  async function replaySix(id){
    if(replayRunning){replayStop=true;return;}replayRunning=true;replayGroupId=id;replayStop=false;redraw();
    try{for(let i=0;i<6&&!replayStop&&!destroyed;i++){const group=find(groups(),id);if(!group||group.status!=='running')break;const previousCursor=group.cursorAt;await runGroup(id);if(find(groups(),id)?.cursorAt===previousCursor){error='일부 프로필의 처리가 끝나지 않아 연속 재생을 멈췄습니다. 이번 봉의 처리 단계와 오류를 확인하세요.';break;}}}
    catch{}finally{replayRunning=false;replayGroupId=null;replayStop=false;redraw();}
  }
  async function click(event){
    const target=event.target.closest?.('[data-console-action]');if(!target)return;event.preventDefault();const action=target.dataset.consoleAction,id=target.dataset.consoleId;
    if(blocked()&&!READ_ACTIONS.has(action)&&action!=='replay-stop'&&!(action==='comparison-replay'&&replayRunning))return;
    try{
      if(action==='start-forward')return startForm();if(action==='start-replay')return startForm('HISTORICAL_FUNCTIONAL_REPLAY');
      if(action==='refresh'){await hooks.refresh?.();if(currentGroup())await query.load({...route.state(),comparison:currentGroup().id},{revision:workspace()?.revision||0,force:true});return;}
      if(action==='portfolio-retry')return query.load(route.state(),{revision:workspace()?.revision||0,force:true});
      if(action==='mind-select')return navigateView({mind:id,bot:'',view:'overview'});
      if(action==='mind-knowledge')return navigateView({mind:id,bot:currentGroup()?'':selectedBot,view:'knowledge'});
      if(action==='view-select')return navigateView({view:id});
      if(action==='page-next'){if(!id)return;cursorTrail.push(route.state().cursor);return route.set({cursor:id},{resetCursor:false});}
      if(action==='page-prev')return route.set({cursor:cursorTrail.pop()||''},{resetCursor:false});
      if(action==='standalone-history')return navigateView({view:'decisions'});
      if(action==='knowledge-detail'){
        const item=list(query.state().data?.page?.items).find(v=>v.id===id);if(!item)return;
        const memory=list(workspace().memoryVersions).find(m=>m.id===item.memoryVersionId),original=item.kind==='APPROVED_MEMORY'?list(memory?.items).find(i=>i.candidateId===item.entityId):item.kind==='COMMON_NOTE'?find(workspace().knowledge?.items,item.entityId):item.kind==='RESEARCH_RULE'?list(workspace().research?.rules).filter(v=>v.id===item.entityId).at(-1):null;
        return hooks.open('지식 상세',`<div class="investment-console console-detail"><h3>${esc(item.title)}</h3><p class="readable">${esc(original?.text||item.preview||'보관된 본문 없음')}</p>${row('유형',esc(KNOWLEDGE_TYPES[item.knowledgeType]||({APPROVED_MEMORY:'승인 기억',COMMON_NOTE:'공통 노트',RESEARCH_RULE:'실행 규칙'})[item.kind]||'지식'))}${row('사용 가능 시각',stamp(item.availableAt))}${row('적용 범위',esc(item.profileId?entityName(workspace(),'investmentProfiles',item.profileId):'공통'))}${raw(original||item,'저장된 출처·버전 보기')}</div>`);
      }
      if(action==='comparison-run')return await runGroup(id);
      if(action==='comparison-first'){await mutate('',{comparisonId:id,status:'running'},'/api/workspace/comparisons/status');return await runGroup(id);}
      if(action==='comparison-replay')return await replaySix(id);if(action==='replay-stop'){replayStop=true;return;}
      if(action==='comparison-status'){const g=find(groups(),id);return await mutate('',{comparisonId:id,status:g.status==='running'?'paused':'running'},'/api/workspace/comparisons/status');}
      if(action==='decision')return openDecision(id);if(action==='experience')return experienceModal(id);
      if(action==='group-records')return groupRecords(id);
      if(action==='experience-review'){hooks.close?.();if(hooks.reviewExperience)return hooks.reviewExperience(id);return hooks.navigateExperience?.(find(workspace().experiences,id)?.investmentProfileId,id);}
      if(action==='candidate-review'){hooks.close?.();if(hooks.reviewCandidate)return hooks.reviewCandidate(id);return hooks.navigateExperience?.(find(workspace().memoryCandidates,id)?.investmentProfileId);}
      if(action==='bot-select'){selectedBot=id;historyLimit=20;return navigateView({mind:find(workspace().deployments,id)?.investmentProfileId||'all',bot:currentGroup()?'':id,view:'decisions'});}
      if(action==='history-more'){historyLimit+=30;redraw();return;}
      if(action==='profiles')return hooks.navigate?.('profiles');
      if(action==='experience-profile'){hooks.close?.();if(hooks.navigateExperience)return hooks.navigateExperience(id);return hooks.navigate?.('profiles');}
      if(action==='memory-apply')return memoryApplyReview(id);
      if(action==='bot-configure'){hooks.close?.();return hooks.configureBot?.(id);}
      if(action==='individual-run')return await manualRunForm(id);
      if(action==='individual-review')return orderReview(id);
      if(action==='individual-execute'){const record=find(workspace().decisionRecords,id);await mutate('',{deploymentId:record.deploymentId,decisionId:id},'/api/workspace/execute');return openDecision(id);}
      if(action==='bot-status'){const w=workspace(),d=find(w.deployments,id),job=list(w.scheduler?.jobs).find(j=>j.deploymentId===id&&j.status!=='stopped');return await mutate(job?(job.status==='active'?'job.pause':'job.resume'):'deployment.status',job?{jobId:job.id}:{deploymentId:id,status:d.runtimeStatus==='running'?'paused':'running'});}
      if(action==='observation-check'){
        if(!hooks.request){hooks.toast?.('자료 상태 조회 연결을 확인하세요.');return;}
        busy=true;try{const result=await hooks.request('/api/workspace/observations/availability?experienceId='+encodeURIComponent(id)+'&horizonHours=24');availability.set(id,result.availability||result.result?.availability||result);experienceModal(id);}finally{busy=false;redraw();}return;
      }
      if(action==='observation-collect'){try{await mutate('experience.observe.market',{experienceId:id,horizonHours:24});}catch(e){if(e.availability)availability.set(id,e.availability);else if(e.details?.availability)availability.set(id,e.details.availability);else throw e;}experienceModal(id);return;}
    }catch(e){error=e.message||'요청을 확인하세요.';hooks.toast?.(error);redraw();}
  }
  async function submit(event){
    const node=event.target.closest?.('[data-console-form]');if(!node)return;event.preventDefault();if(node.dataset.consoleForm!=='portfolio-search'&&blocked())return;
    const formData=new FormData(node),values=Object.fromEntries(formData);
    try{
      if(node.dataset.consoleForm==='portfolio-search')return navigateView({search:values.search||''});
      if(node.dataset.consoleForm==='memory-apply'){
        const deploymentId=node.dataset.consoleId,group=groups().find(g=>deploymentIds(g).includes(deploymentId));
        if(group?.status==='running')await mutate('',{comparisonId:group.id,status:'paused'},'/api/workspace/comparisons/status');
        const d=find(workspace().deployments,deploymentId),job=list(workspace().scheduler?.jobs).find(j=>j.deploymentId===deploymentId&&j.status==='active');
        if(job)await mutate('job.pause',{jobId:job.id});else if(d.runtimeStatus==='running')await mutate('deployment.status',{deploymentId,status:'paused'});
        const result=await mutate('',{deploymentId,sourceMemoryVersionId:values.sourceMemoryVersionId,reason:values.reason},'/api/workspace/memory/apply');
        hooks.open('승인 기억 적용 완료',`<div class="investment-console">${row('적용 기억',result?.memoryVersion?'v'+result.memoryVersion.version:'새 승인 버전')}${row('다음 적용 가능 봉',stamp(result?.nextEligibleAsOf))}<p class="tiny muted spaced">적용 버전을 확인한 뒤 비교 운용 또는 봇을 재개하세요.</p></div>`);return;
      }
      if(node.dataset.consoleForm==='individual-run'){
        const asOf=new Date(values.asOf+'Z').toISOString(),deploymentId=node.dataset.consoleId;singleTimes.set(deploymentId,asOf);return await mutate('',{deploymentId,asOf},'/api/workspace/evaluate');
      }
      if(node.dataset.consoleForm==='comparison-create'){
        const profileIds=formData.getAll('profileIds');if(!profileIds.length)throw new Error('비교할 투자 프로필을 한 개 이상 선택하세요.');if(profileIds.length>3)throw new Error('한 비교 운용에는 프로필을 최대 세 개 선택하세요.');
        const replay=values.experimentType!=='FORWARD_PAPER';
        const payload={name:values.name,profileIds,strategyVersionId:values.strategyVersionId,riskPresetVersionId:values.riskPresetVersionId,initialCash:Number(values.initialCash),feeBps:Number(values.feeBps),slippageBps:Number(values.slippageBps),experimentType:values.experimentType,...(replay?{startAt:new Date(values.startAt+'Z').toISOString()}:{})};
        const result=await mutate('',payload,'/api/workspace/comparisons/create');const group=result?.comparison||result?.group||result;if(group?.id)selectedGroup=group.id;else selectedGroup=groups().at(-1)?.id||'';selectedBot='';navigateView({comparison:selectedGroup,mind:'all',view:'overview',bot:''});
      }
    }catch(e){const alert=node.isConnected&&node.querySelector('[data-console-error]');if(alert)alert.textContent=e.message;hooks.toast?.(e.message);}
  }
  function change(event){
    if(event.target.matches?.('[data-console-group]')){selectedGroup=event.target.value==='all'?'other':event.target.value;selectedBot='';historyLimit=20;navigateView({comparison:selectedGroup,mind:'all',view:'overview',bot:''});}
    if(event.target.matches?.('[data-console-bot]')){selectedBot=event.target.value;historyLimit=20;navigateView({bot:selectedBot,mind:'all'});}
    if(event.target.matches?.('[data-console-status]'))navigateView({status:event.target.value});
    if(event.target.matches?.('[data-console-page-size]'))navigateView({pageSize:Number(event.target.value)});
    if(event.target.closest?.('[data-console-form="comparison-create"]'))costSummary(event.target.closest('[data-console-form]'));
    if(event.target.matches?.('[name="sourceMemoryVersionId"]')){const preview=event.target.closest('[data-console-form]')?.querySelector('.console-memory-preview');if(preview){const memory=find(workspace().memoryVersions,event.target.value);preview.innerHTML=list(memory?.items).map(item=>evidenceCard(item,'승인 기억')).join('')||'<p class="tiny muted">이 버전은 기억 0건입니다. 적용하면 대상 운용의 개인 기억 입력을 비웁니다. 기존 경험과 승인 기억 버전은 보존합니다.</p>';}}
  }
  function inputChanged(event){
    if(event.target.name==='search'&&event.target.closest?.('[data-console-form="portfolio-search"]')){searchDraft=String(event.target.value||'').slice(0,120);searchDraftKey=portfolioFinancialKey(route.state())+'|'+route.state().view;}
    const formNode=event.target.closest?.('[data-console-form="comparison-create"]');if(formNode)costSummary(formNode);
  }
  document.addEventListener('click',click);document.addEventListener('submit',submit);document.addEventListener('change',change);document.addEventListener('input',inputChanged);
  return {render,openDecision,openExperience:experienceModal,selectGroup(id){selectedGroup=id==='all'?'other':id||'';selectedBot='';navigateView({comparison:selectedGroup,mind:'all',view:'overview',bot:''});},selectMind(id){navigateView({mind:id||'all',bot:'',view:'overview'});},selectView(id){navigateView({view:id});},queryState:()=>query.state(),async loadView(){if(currentGroup())return query.load({...route.state(),comparison:currentGroup().id},{revision:workspace()?.revision||0,force:true});},destroy(){destroyed=true;replayStop=true;clearTimeout(searchTimer);route.destroy();query.destroy();document.removeEventListener('click',click);document.removeEventListener('submit',submit);document.removeEventListener('change',change);document.removeEventListener('input',inputChanged);}};
}
