import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import postcss from 'postcss';
import {visibleCopy,inspectCopy} from './check-ui-copy.mjs';
import {currencyAmount} from '../dist/ui/currency-format.mjs';

const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const SHA=value=>createHash('sha256').update(value).digest('hex');
const VOID=new Set(['area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr']);
const OWN=(value,key)=>Object.hasOwn(value,key);
const decode=value=>String(value).replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos);/gi,(_,entity)=>entity[0]==='#'?String.fromCodePoint(Number.parseInt(entity.slice(entity[1]?.toLowerCase()==='x'?2:1),entity[1]?.toLowerCase()==='x'?16:10)):({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"})[entity.toLowerCase()]);
// A template's content is inert until the preview controller mounts it outside the card.
// Parsing still checks its authored tag nesting; rendered controls only include active DOM.
const nodes=(root,predicate)=>{const result=[];function walk(node){if(node.tag==='template')return;if(predicate(node))result.push(node);for(const child of node.children??[])walk(child);}walk(root);return result;};
const has=(node,name)=>OWN(node.attrs??{},name);
const text=node=>node.tag==='template'?'':node.tag==='#text'?node.value:(node.children??[]).map(text).join('');
const accessible=node=>node.tag==='template'?'':node.attrs?.['aria-label']??(node.children??[]).filter(child=>child.attrs?.['aria-hidden']!=='true').map(child=>child.tag==='#text'?child.value:accessible(child)).join('').trim();
const insideHud=node=>{for(let p=node;p;p=p.parent)if(has(p,'data-mind-hud'))return true;return false;};
const interactive=node=>['button','input','select','textarea','summary'].includes(node.tag)||node.tag==='a'&&has(node,'href')||['button','link','checkbox','radio','switch','tab','option'].includes(node.attrs?.role)||has(node,'tabindex')&&Number(node.attrs.tabindex)>=0||has(node,'contenteditable')&&node.attrs.contenteditable!=='false';

/** Inspect authored nesting before the browser repairs invalid nested links or buttons. */
export function parseCompanionMarkup(markup){
  if(typeof markup!=='string'||markup.length>1000000)throw new TypeError('카드 마크업 크기를 확인하세요.');
  const root={tag:'#root',attrs:{},children:[],parent:null},stack=[root];let at=0;
  const append=node=>{node.parent=stack.at(-1);node.parent.children.push(node);};
  while(at<markup.length){
    if(markup.startsWith('<!--',at)){const end=markup.indexOf('-->',at+4);if(end<0)throw new TypeError('닫히지 않은 주석입니다.');at=end+3;continue;}
    if(markup[at]!=='<'){const end=markup.indexOf('<',at);append({tag:'#text',value:decode(markup.slice(at,end<0?markup.length:end)),children:[]});at=end<0?markup.length:end;continue;}
    let end=at+1,quote=null;for(;end<markup.length;end++){const c=markup[end];if(quote){if(c===quote)quote=null;}else if(c==='"'||c==="'")quote=c;else if(c==='>')break;}
    if(end===markup.length)throw new TypeError('닫히지 않은 태그입니다.');
    const source=markup.slice(at+1,end).trim();at=end+1;if(source.startsWith('!'))continue;
    if(source.startsWith('/')){const tag=source.slice(1).trim().toLowerCase();if(stack.at(-1).tag!==tag)throw new TypeError('태그의 닫힘 순서를 확인하세요: '+tag);stack.pop();continue;}
    const match=/^([A-Za-z][\w:-]*)/.exec(source);if(!match)throw new TypeError('태그 이름을 확인하세요.');
    const tag=match[1].toLowerCase(),attrs={};let i=match[0].length;
    while(i<source.length){while(/\s/.test(source[i]??''))i++;if(i>=source.length||source[i]==='/')break;const start=i;while(i<source.length&&!/[\s=/>]/.test(source[i]))i++;const name=source.slice(start,i).toLowerCase();if(!name||OWN(attrs,name))throw new TypeError('중복되거나 빈 속성입니다.');while(/\s/.test(source[i]??''))i++;let value='';if(source[i]==='='){i++;while(/\s/.test(source[i]??''))i++;const q=source[i];if(q==='"'||q==="'"){i++;const stop=source.indexOf(q,i);if(stop<0)throw new TypeError('속성 따옴표를 확인하세요.');value=source.slice(i,stop);i=stop+1;}else{const begin=i;while(i<source.length&&!/[\s>]/.test(source[i]))i++;value=source.slice(begin,i);}}attrs[name]=decode(value);}
    const node={tag,attrs,children:[]};append(node);if(!VOID.has(tag)&&!source.endsWith('/'))stack.push(node);
  }
  if(stack.length!==1)throw new TypeError('닫히지 않은 태그입니다: '+stack.at(-1).tag);return root;
}

const routeOf=node=>{try{const value=new URL(node.attrs.href,'https://local.invalid/');if(value.origin!=='https://local.invalid'||value.pathname!=='/')return null;const [page,...query]=value.hash.slice(1).split('?');return {page,params:new URLSearchParams(query.join('?'))};}catch{return null;}};
const phaseNames=new Set(['sleep','idle','observing','investing','clutch','attention']);
const appearanceFields={bodyVariant:{attribute:'data-body',values:['blob','pear','heart','frog','cat','rabbit']},colorPalette:{attribute:'data-palette',values:['blue','amber','violet','sage']},eyeVariant:{attribute:'data-eyes',values:['natural','focused','sleepy']},accessory:{attribute:'data-accessory',values:['none','glasses','sunglasses','bowtie']},motionIntensity:{attribute:'data-motion',values:['subtle','off']}};
const formattedReturn=value=>(value>0?'+':'')+new Intl.NumberFormat('ko-KR',{minimumFractionDigits:2,maximumFractionDigits:2}).format(value*100)+'%';
const list=value=>Array.isArray(value)?value:[];
const digest=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const decimal=value=>typeof value==='string'&&/^-?\d+(?:\.\d{1,18})?$/.test(value)&&Number.isFinite(Number(value));
const privateField=value=>value&&typeof value==='object'&&Object.entries(value).some(([key,item])=>/^(?:nonce|accessKey|secretKey|credentials?|privatePrompt|rawBody|rawRequest|rawSources?)$/i.test(key)||privateField(item));

/** Live data uses its activation's immutable policy, not a newer published mind policy. */
function inspectLiveModel(model,add){
  const activity=model.liveActivity;
  if(list(model.currencies).length||model.accountScope!=='LIVE_ACCOUNTS'||model.paperActivity)add('LIVE_PAPER_PERFORMANCE','실전 카드에 모의 계좌·활동을 섞을 수 없습니다.');
  if(!activity){if(model.connected||model.lastDecision||model.latestRunId||model.holdings?.hasHoldings)add('LIVE_PAPER_PERFORMANCE','실전 원장이 없는 카드에 판단·보유·성과를 만들 수 없습니다.');return;}
  if(activity.profileId!==model.profileId||!/^live-[A-Za-z0-9_.:@-]+$/.test(activity.activationId??'')||typeof activity.accountId!=='string'||!activity.accountId||activity.accountId.toLowerCase().includes('paper')||activity.executionMode&&activity.executionMode!=='live'||activity.quoteCurrency!==activity.ledger?.quoteCurrency)add('LIVE_ACTIVITY_SCOPE','실전 활동의 마인드·운용·계좌·통화 범위를 보존하세요.');
  if(privateField(activity))add('LIVE_ACTIVITY_PRIVATE_DATA','실전 카드에는 비밀값·비공개 요청 원문을 전달할 수 없습니다.');
  if(!model.connected||model.automation?.enabled!==(activity.status==='ENABLED')||!activity.manifest?.id||!digest(activity.manifest?.hash)||!digest(activity.manifest?.graphHash))add('LIVE_ACTIVITY_PROVENANCE','연결 상태와 고정 정책을 실제 실전 활동에서 읽으세요.');
  const last=activity.lastDecision,shown=model.lastDecision,positions=list(activity.ledger?.positions).filter(p=>decimal(p.quantity)&&Number(p.quantity)>0);
  if((shown?.id??null)!==(last?.id??null)||(shown?.action??null)!==(last?.action??null)||(shown?.at??null)!==(last?.at??null)||(model.latestRunId??null)!==(last?.id??null)||model.holdings?.hasHoldings!==(positions.length>0)||model.holdings?.count!==positions.length||JSON.stringify(model.holdings?.instrumentIds)!==JSON.stringify(positions.map(p=>p.instrumentId)))add('LIVE_DECISION_PROVENANCE','최근 판단과 보유는 같은 실전 운용 원장에서 표시하세요.');
  const trace=last?.trace,graph=activity.graph;
  if(trace?.status==='VERIFIED'){
    const ids=list(trace.nodeIds),steps=list(trace.nodes),known=new Set(list(graph?.nodes).map(n=>n.id)),edges=new Map(list(graph?.edges).map(e=>[e.id,e])),members=new Set(ids);
    const valid=graph&&digest(trace.graphHash)&&trace.graphHash===graph.graphHash&&trace.graphHash===activity.manifest.graphHash&&ids.length>0&&ids.length===steps.length&&members.size===ids.length&&steps.every((n,i)=>n.id===ids[i]&&known.has(n.id))&&list(trace.edgeIds).every(id=>{const e=edges.get(id);return e&&members.has(e.from.nodeId)&&members.has(e.to.nodeId);});
    if(!valid)add('LIVE_GRAPH_PROVENANCE','재생은 고정 정책과 해시가 일치하는 실제 처리 순서·연결만 표시하세요.');
  }else if(trace&&(list(trace.nodeIds).length||list(trace.edgeIds).length||list(trace.nodes).length))add('LIVE_GRAPH_PROVENANCE','검증되지 않은 판단 경로는 재생할 수 없습니다.');
  for(const event of list(activity.recentActivity))if(event.kind==='FUNDING'&&event.funding!==true||event.kind==='STRATEGY_ORDER'&&event.activationId!==activity.activationId)add('LIVE_ACTIVITY_SCOPE','거래 자금 전환과 같은 운용의 전략 체결을 구분하세요.');
  if(activity.funding&&activity.funding.profitIncluded!==false)add('LIVE_ACTIVITY_PROVENANCE','거래 자금 전환은 전략 수익과 분리하세요.');
}

/** A model-to-markup contract. This reports structural failures, not browser E2E success. */
export function inspectCompanionMarkup(markup,{view,requirePerformanceOrigin=true}={}){
  const errors=[],add=(code,message)=>errors.push({code,message});let root;
  try{root=parseCompanionMarkup(markup);}catch(error){return [{code:'MALFORMED_MARKUP',message:error.message}];}
  const cards=nodes(root,node=>has(node,'data-mind-companion'));
  for(const node of nodes(root,interactive)){if(!accessible(node))add('UNNAMED_CONTROL','동작 요소의 접근성 이름이 필요합니다.');for(let ancestor=node.parent;ancestor;ancestor=ancestor.parent)if(interactive(ancestor)){add('NESTED_INTERACTION','링크·버튼·키보드 동작 요소를 중첩할 수 없습니다.');break;}}
  if(!view||!['paper','live'].includes(view.executionMode)||!Array.isArray(view.cards))return [{code:'MODEL_REQUIRED',message:'실제 마인드 카드 모델이 필요합니다.'}];
  if(view.executionMode==='live'&&nodes(root,node=>has(node,'data-companion-currency')||has(node,'data-performance-as-of')).length)add('LIVE_PAPER_PERFORMANCE','실전 연결 보기에서 모의 성과가 노출됐습니다.');
  if(cards.length!==view.cards.length)add('CARD_COUNT','실제 마인드 목록과 카드 수가 다릅니다.');
  const seen=new Set();
  for(const card of cards){
    const id=card.attrs['data-profile-id'],model=view.cards.find(value=>value.profileId===id);
    if(seen.has(id)||!model){add('CARD_SCOPE','중복되거나 모델에 없는 마인드 카드입니다.');continue;}seen.add(id);
    if(card.tag!=='article'||interactive(card)||Object.keys(card.attrs).some(key=>key.startsWith('on'))||has(card,'data-studio-action'))add('INTERACTIVE_CARD_WRAPPER','카드 외곽은 비동작 article로 유지하세요.');
    if(card.attrs['data-execution-mode']!==model.executionMode||model.executionMode!==view.executionMode)add('EXECUTION_MODE_SCOPE','카드의 실행 모드가 모델과 다릅니다.');
    if(model.executionMode==='live'){inspectLiveModel(model,add);if(nodes(card,n=>n.tag==='#text'&&!insideHud(n)).some(n=>n.value.includes('%')))add('LIVE_PAPER_PERFORMANCE','실전 카드에는 원장 실현 손익과 통화를 표시하세요.');}
    if(!phaseNames.has(model.phase)||card.attrs['data-phase']!==model.phase)add('PHASE_PROVENANCE','카드 상태를 실제 모델의 phase에 연결하세요.');
    const avatars=nodes(card,node=>has(node,'data-mind-avatar'));if(avatars.length!==1||avatars[0].attrs['data-phase']!==model.phase||avatars[0].attrs['aria-hidden']!=='true')add('AVATAR_STATE','캐릭터 상태와 텍스트 상태의 연결을 확인하세요.');
    if(model.appearance){const appearance=model.appearance.config;if(!appearance||Object.keys(appearance).length!==5||!['SAVED','IDENTITY_DEFAULT'].includes(model.appearance.source))add('APPEARANCE_CONTRACT','저장 또는 기본 외형의 다섯 설정과 출처를 확인하세요.');for(const [key,spec]of Object.entries(appearanceFields))if(!spec.values.includes(appearance?.[key])||avatars[0]?.attrs[spec.attribute]!==appearance[key])add('APPEARANCE_PROVENANCE','캐릭터의 '+key+'를 같은 마인드의 실제 UI 설정에 연결하세요.');}
    const statuses=nodes(card,node=>has(node,'data-companion-state'));if(statuses.length!==1||text(statuses[0]).trim()!==model.label)add('STATE_LABEL','모델에서 계산한 상태 이름을 표시하세요.');
    const primary=nodes(card,node=>has(node,'data-mind-companion-open')),edit=nodes(card,node=>node.attrs?.['data-companion-action']==='edit'),customize=nodes(card,node=>node.attrs?.['data-companion-action']==='customize'),automation=nodes(card,node=>node.attrs?.['data-companion-action']==='automation'),archive=nodes(card,node=>node.attrs?.['data-companion-action']==='archive');
    const visibleControls=nodes(card,node=>interactive(node)&&!has(node,'hidden')&&!insideHud(node));
    if(primary.length!==1||edit.length!==1||customize.length!==1||automation.length!==(model.archived?0:1)||archive.length!==1||visibleControls.length!==4||nodes(card,node=>interactive(node)&&!insideHud(node)).length!==(model.archived?4:5))add('CARD_ACTIONS','마인드 열기·원칙 편집·캐릭터 꾸미기·다음 행동을 각각 한 개로 제공하고 보관은 메뉴에서 제공하세요.');
    const huds=nodes(card,n=>has(n,'data-mind-hud'));if(huds.length!==1)add('HUD_CONTRACT','카드의 공용 투자 지표를 한 개로 연결하세요.');for(const hud of huds){const go=nodes(hud,n=>has(n,'data-hud-go')),periods=nodes(hud,n=>has(n,'data-hud-period')),series=nodes(hud,n=>has(n,'data-hud-series')),open=nodes(hud,n=>has(n,'data-hud-open')),allowed=n=>has(n,'data-hud-go')||has(n,'data-hud-period')||has(n,'data-hud-series')||has(n,'data-hud-open')||has(n,'data-help-trigger');if(go.length!==4||new Set(go.map(n=>n.attrs['data-hud-go'])).size!==4||periods.length!==4||!periods.every(n=>['1h','1d','1w','all'].includes(n.attrs['data-hud-period']))||series.length!==3||!series.every(n=>['realizedPnl','netContributions','bookEquity'].includes(n.attrs['data-hud-series']))||open.length!==1||open[0].attrs.href!==primary[0]?.attrs.href||nodes(hud,interactive).some(n=>!allowed(n)))add('HUD_CONTRACT','HUD의 화면 이동·차트 기간·지표·동일 운용 진입 계약을 확인하세요.');if(open.length===1&&open[0].attrs.href!==primary[0]?.attrs.href)add('ROUTE_SCOPE','캐릭터와 이름이 같은 운용 화면을 여는지 확인하세요.');const value=model.investorMetrics??model.liveActivity?.investorMetrics??model.paperActivity?.investorMetrics??null;try{if(JSON.stringify(JSON.parse(hud.attrs['data-hud-metrics']))!==JSON.stringify(value))add('HUD_PERFORMANCE_PROVENANCE','지표는 같은 마인드의 실제 원장에서 연결하세요.');}catch{add('HUD_PERFORMANCE_PROVENANCE','원 지표의 구조를 확인하세요.');}}
    const node=primary[0],route=node&&routeOf(node);if(node?.tag!=='a'||route?.page!=='minds'||route.params.get('profileId')!==id||route.params.get('executionMode')!==model.executionMode||route.params.get('view')!=='operations'||route.params.has('mode'))add('ROUTE_SCOPE','마인드 진입 링크의 마인드·실행 모드·운용 화면 범위를 보존하세요.');
    if(!model.archived){const next=automation[0],event=model.eventStream===true,eventPaper=model.executionMode==='paper'&&model.accountScope==='EVENT_PAPER_ALLOCATION'&&!!model.paperActivity,portfolio=!eventPaper&&!event&&model.executionMode==='paper'&&model.strategyScope==='MIND_UNIVERSE',manual=!eventPaper&&!event&&model.executionMode==='paper'&&model.automaticScopeSupported===false&&!model.automation?.subscriptionId&&!model.automation?.enabled&&!model.automation?.requiresAttention,expectedLabel=eventPaper?'모의 운용 관리':event?(model.executionMode==='live'?(model.liveActivity?'운용 관리':'운용 설정'):'모의 운용 준비'):portfolio?'실험실 열기':manual?'트레이딩 열기':model.executionMode==='live'?'연결 설정':model.automation?.enabled||model.automation?.requiresAttention?'자동 모의 관리':model.automation?.paused||model.automation?.subscriptionId?'자동 모의 시작':'자동 모의 설정';if(next?.tag!=='button'||next.attrs.type!=='button'||next.attrs['data-studio-action']!==(portfolio?'mind-lab':manual?'mind-trade':'mind-automation')||next.attrs['data-studio-id']!==id||has(next,'hidden')||text(next).trim()!==expectedLabel)add('AUTOMATION_SCOPE','같은 마인드의 정책 범위에 맞는 포트폴리오 실험실·트레이딩·자동 모의 관리 또는 실전 연결 설정을 여세요.');}
    const lifecycle=archive[0];if(lifecycle?.tag!=='button'||lifecycle.attrs.type!=='button'||lifecycle.attrs['data-studio-action']!==(model.archived?'profile-restore':'profile-archive')||lifecycle.attrs['data-studio-id']!==id||has(lifecycle,'hidden')===Boolean(model.archived))add('ARCHIVE_SCOPE','보관은 같은 마인드의 메뉴 동작으로, 보관함의 복구는 주요 동작으로 제공하세요.');
    if(edit[0]?.tag!=='button'||edit[0].attrs.type!=='button'||edit[0].attrs['data-studio-action']!=='strategy-graph'||edit[0].attrs['data-studio-id']!==id)add('EDIT_SCOPE','노드 편집은 해당 마인드의 정책 초안 편집 동작에 연결하세요.');
    if(customize[0]?.tag!=='button'||customize[0].attrs.type!=='button'||customize[0].attrs['data-studio-action']!=='mind-customize'||customize[0].attrs['data-studio-id']!==id)add('CUSTOMIZE_SCOPE','캐릭터 꾸미기는 같은 마인드의 독립된 외형 편집에 연결하세요.');
    const currencies=nodes(card,node=>has(node,'data-companion-currency'));
    const liveRows=nodes(card,node=>has(node,'data-live-currency'));
    if(model.executionMode==='live'){
      const ledger=model.liveActivity?.ledger,recorded=decimal(ledger?.realizedPnl),expected=recorded?1:0;
      if(liveRows.length!==expected)add('LIVE_PERFORMANCE_PROVENANCE','실전 실현 손익은 같은 운용 원장의 통화별 값만 표시하세요.');
      for(const row of liveRows){const values=nodes(row,n=>n.tag==='dd'),value=values[0],pnl=Number(ledger?.realizedPnl),formatted=(pnl>0?'+':'')+currencyAmount(pnl,ledger?.quoteCurrency)+' '+ledger?.quoteCurrency;if(!recorded||row.attrs['data-live-currency']!==ledger.quoteCurrency||values.length!==1||text(value).trim()!==formatted||value.attrs['data-performance-source']!=='live-ledger'||has(value,'data-performance-as-of'))add('LIVE_PERFORMANCE_PROVENANCE','실전 실현 손익의 금액·통화·원장 출처를 보존하세요.');}
    }else if(liveRows.length||model.liveActivity)add('EXECUTION_MODE_SCOPE','모의 카드에서 실전 운용 원장을 표시할 수 없습니다.');
    if(currencies.length!==model.currencies.length||new Set(currencies.map(node=>node.attrs['data-companion-currency'])).size!==currencies.length)add('CURRENCY_SCOPE','통화별 성과를 합산하지 않고 각각 표시하세요.');
    for(const row of currencies){const currency=model.currencies.find(value=>value.currency===row.attrs['data-companion-currency']);if(!currency){add('CURRENCY_SCOPE','다른 계좌의 통화가 노출됐습니다.');continue;}const current=Number.isFinite(currency.netReturn),saved=current?currency:Number.isFinite(currency.lastSavedPerformance?.netReturn)?currency.lastSavedPerformance:null,untraded=currency.status==='UNTRADED'||currency.hasPerformance===false,values=nodes(row,node=>node.tag==='dd');if(values.length!==1){add('PERFORMANCE_VALUE','통화별 성과 값은 한 개여야 합니다.');continue;}const value=values[0];if(untraded&&(!text(value).trim()||text(value).includes('%')))add('UNTRADED_PERFORMANCE','거래 전 계좌는 첫 거래 대기 상태로 표시하세요.');if(saved){if((!untraded&&text(value).trim()!==formattedReturn(saved.netReturn))||value.attrs['data-performance-as-of']!==saved.asOf)add('PERFORMANCE_PROVENANCE','수익률과 평가 시각을 같은 원본에서 표시하세요.');if(requirePerformanceOrigin&&value.attrs['data-performance-source']!==(current?'current':'saved'))add('PERFORMANCE_ORIGIN','현재 평가와 마지막 저장 평가를 구분하세요.');}else if(text(value).includes('%')||has(value,'data-performance-as-of'))add('FABRICATED_PERFORMANCE','평가 자료가 없으면 수익률을 만들 수 없습니다.');}
  }
  return errors;
}

export function inspectCompanionModeToggle(markup,mode){
  const errors=[],root=parseCompanionMarkup(markup),buttons=nodes(root,node=>has(node,'data-companion-mode'));
  if(buttons.length!==2||new Set(buttons.map(node=>node.attrs['data-companion-mode'])).size!==2)errors.push({code:'MODE_OPTIONS',message:'모의·실전 보기 선택을 각각 제공하세요.'});
  for(const option of ['paper','live']){const button=buttons.find(node=>node.attrs['data-companion-mode']===option);if(button?.tag!=='button'||button.attrs['aria-pressed']!==String(option===mode)||button.attrs['data-studio-action']!=='execution-mode'||button.attrs['data-studio-id']!==option||!accessible(button))errors.push({code:'MODE_SELECTION',message:'모드 선택 상태와 실행 모드 동작을 일치시키세요.'});}return errors;
}

export function inspectCompanionWorkspaceNavigation(markup,{profileId,executionMode,currentView='operations'}={}){
  const errors=[],root=parseCompanionMarkup(markup),nav=nodes(root,n=>n.tag==='nav'&&n.attrs?.class==='studio-mind-tabs'),links=nav.length===1?nodes(nav[0],n=>n.tag==='a'):[],labels={operations:'운용',principles:'전략',records:'기록',knowledge:'자료',simulations:'실험실'},active=({overview:'operations'})[currentView]??currentView;
  if(links.length!==5)errors.push({code:'MIND_WORKSPACE_TABS',message:'운용·전략·기록·자료·실험실의 다섯 작업을 제공하세요.'});
  const seen=new Set();for(const link of links){const route=routeOf(link),view=route?.params.get('view');if(!OWN(labels,view)||seen.has(view)||text(link)!==labels[view]||route?.page!=='minds'||route.params.get('profileId')!==profileId||route.params.get('executionMode')!==executionMode||has(link,'aria-current')!==(view===active))errors.push({code:'MIND_WORKSPACE_ROUTE',message:'다섯 작업의 마인드·실행 모드·현재 화면과 호환 경로를 보존하세요.'});seen.add(view);}return errors;
}

const cssSelector = value => value.trim().replace(/\s+/g,' ').replace(/\[([\w-]+)=([\w-]+)\]/g,'[$1="$2"]');
const cssDeclarations = rule => Object.fromEntries((rule.nodes??[]).filter(node=>node.type==='decl').map(node=>[node.prop,node.value.trim()+(node.important?' !important':'')]));
const isStopped = value => /^none\s*!important$/i.test(value??'');
const inReducedMotion = rule => { for(let p=rule.parent;p;p=p.parent)if(p.type==='atrule'&&p.name==='media'&&/^\(\s*prefers-reduced-motion\s*:\s*reduce\s*\)$/i.test(p.params))return true;return false; };
const inBaseLayer = rule => { for(let p=rule.parent;p;p=p.parent)if(p.type==='atrule'&&!['layer'].includes(p.name))return false;return true; };
const inKeyframes = rule => {for(let p=rule.parent;p;p=p.parent)if(p.type==='atrule'&&/keyframes$/.test(p.name))return true;return false;};

/** Resolve every declared variant of used motion tokens, including conditional overrides.
 * Both authored tokens and shipped tokens are inspected: a stale build cannot hide a bad token.
 */
function motionValues(roots){
  const definitions=new Map();
  for(const root of roots)root.walkDecls(/^--/,decl=>{const values=definitions.get(decl.prop)??new Set();values.add(decl.value);definitions.set(decl.prop,values);});
  function resolve(value,stack=[]){
    const at=value.indexOf('var(');if(at<0)return [value];let depth=1,end=at+4;
    for(;end<value.length&&depth;end++){if(value[end]==='(')depth++;else if(value[end]===')')depth--;}
    if(depth)throw new TypeError('모션 토큰 괄호를 확인하세요.');
    const argument=value.slice(at+4,end-1);let split=-1,nesting=0;
    for(let i=0;i<argument.length;i++){if(argument[i]==='(')nesting++;else if(argument[i]===')')nesting--;else if(argument[i]===','&&!nesting){split=i;break;}}
    const name=(split<0?argument:argument.slice(0,split)).trim(),fallback=split<0?null:argument.slice(split+1).trim();
    if(!/^--[\w-]+$/.test(name)||stack.includes(name)||stack.length>24)throw new TypeError('순환하거나 잘못된 모션 토큰입니다: '+name);
    const choices=definitions.get(name)??(fallback===null?null:new Set([fallback]));if(!choices?.size)throw new TypeError('모션 토큰 정의가 필요합니다: '+name);
    const resolved=new Set();for(const choice of choices)for(const item of resolve(choice,[...stack,name]))for(const tail of resolve(value.slice(end),stack)){resolved.add(value.slice(0,at)+item+tail);if(resolved.size>64)throw new TypeError('모션 토큰 조합을 64개 이내로 유지하세요.');}
    return [...resolved];
  }
  return value=>resolve(value);
}

export function inspectCompanionMotion(css,{tokenCss=''}={}){
  try{
    const root=postcss.parse(css),tokens=postcss.parse(tokenCss),values=motionValues([tokens,root]),rules=[];
    root.walkRules(rule=>{if(!inKeyframes(rule))rules.push(rule);});
    const base=rules.filter(inBaseLayer),reduced=rules.filter(inReducedMotion),selectors=rule=>postcss.list.comma(rule.selector).map(cssSelector);
    const stopped=rule=>{const d=cssDeclarations(rule);return values(d.animation??'').every(isStopped)&&values(d.transition??'').every(isStopped);};
    const coverage={root:false,descendants:false};
    for(const rule of reduced.filter(stopped))for(const selector of selectors(rule)){if(['*','.mind-avatar','[data-mind-avatar]'].includes(selector))coverage.root=true;if(['*','.mind-avatar *','[data-mind-avatar] *'].includes(selector))coverage.descendants=true;}
    if(!coverage.root||!coverage.descendants)return [{code:'REDUCED_MOTION',message:'모션 감소 환경에서 캐릭터와 모든 하위 요소의 애니메이션·전환을 멈추세요.'}];
    const disabled={root:false,descendants:false};for(const rule of base.filter(stopped))for(const selector of selectors(rule)){if(selector==='.mind-avatar[data-motion="off"]')disabled.root=true;if(selector==='.mind-avatar[data-motion="off"] *')disabled.descendants=true;}
    if(!disabled.root||!disabled.descendants)return [{code:'MOTION_PREFERENCE',message:'저장한 움직임 끄기를 캐릭터와 모든 하위 요소에 적용하세요.'}];
    const cardRules=base.filter(rule=>rule.selector.includes('.mind-companion-card')),moving=rule=>{const animation=cssDeclarations(rule).animation;return animation&&values(animation).some(value=>!/^none(?:\s*!important)?$/.test(value));},cardMotion=cardRules.filter(moving);
    if(!cardMotion.length||cardMotion.some(rule=>selectors(rule).some(selector=>!selector.includes('[data-phase="clutch"]'))))return [{code:'CARD_MOTION_SCOPE',message:'카드 배경의 반복 움직임을 실제 클러치 상태에 한정하세요.'}];
    const keyframes=[];root.walkAtRules('keyframes',rule=>keyframes.push(rule));
    const gradient=cardMotion.find(rule=>{const d=cssDeclarations(rule);return d['background-image']&&values(d['background-image']).every(value=>/linear-gradient\(/.test(value))&&values(d.animation).every(value=>/\binfinite\b/.test(value));});
    let gradientValid=Boolean(gradient);
    if(gradient){
      const d=cssDeclarations(gradient);
      for(const image of values(d['background-image'])){
        const colors=[...image.matchAll(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)/g)].map(match=>match.slice(1).map(Number));
        gradientValid&&=colors.length>0&&colors.every(([r,g,b,a])=>[r,g,b].every(channel=>channel>=0&&channel<=255)&&a>=0&&a<=.2)&&colors.some(([r,g,b,a])=>r>g&&r>b&&a>0);
      }
      for(const animation of values(d.animation)){
        const name=animation.split(/\s+/)[0],frames=keyframes.find(rule=>rule.params.trim()===name),positions=new Set(),stops=[];
        for(const frame of frames?.nodes??[]){const position=cssDeclarations(frame)['background-position'];if(position){const alternatives=new Set(values(position).map(value=>value.replace(/\s+/g,' ').trim()));stops.push(alternatives);for(const value of alternatives)positions.add(value);}}
        // Every stop must vary for each real token alternative; aliases of one position are static.
        const staticVariant=stops.length>0&&[...stops[0]].some(value=>stops.every(stop=>stop.has(value)));gradientValid&&=positions.size>=2&&!staticVariant;
        const duration=animation.match(/(?:^|\s)([\d.]+)(ms|s)(?=\s|$)/);gradientValid&&=Boolean(duration)&&Number(duration[1])>0;
      }
    }
    if(!gradientValid)return [{code:'CLUTCH_GRADIENT',message:'클러치 카드의 옅은 붉은 그라데이션과 반복 배경 위치를 연결하세요.'}];
    const stopAnimation=rule=>values(cssDeclarations(rule).animation??'').every(isStopped);
    const offCard=cardRules.some(rule=>stopAnimation(rule)&&selectors(rule).includes('.mind-companion-card[data-motion="off"]'));
    const inheritedOff=cardRules.some(rule=>stopAnimation(rule)&&selectors(rule).includes('.mind-companion-card:has(.mind-avatar[data-motion="off"])'));
    const reducedCard=reduced.some(rule=>stopAnimation(rule)&&selectors(rule).includes('.mind-companion-card[data-phase="clutch"]'));
    if(!offCard||!inheritedOff||!reducedCard)return [{code:'CARD_MOTION_PREFERENCE',message:'움직임 끄기와 모션 감소에서 클러치 카드 배경도 멈추세요.'}];
    const animated=base.filter(moving).flatMap(selectors);
    if(!animated.some(selector=>selector.includes('.mind-avatar-body'))||!['sleep','observing','investing','clutch'].every(phase=>animated.some(selector=>selector.includes('data-phase="'+phase+'"'))))return [{code:'STATE_MOTION',message:'준비·휴식·대기·보유·클러치 상태의 캐릭터 동작을 연결하세요.'}];return [];
  }catch(error){return [{code:'MOTION_CSS',message:error.message}];}
}

/** Isolated real-ledger fixtures; no prices, decisions or accounts are read from a service. */
export async function companionContractCases({rootDir=ROOT}={}){
  const load=path=>import(pathToFileURL(resolve(rootDir,path)).href),[{createWorkspace,dispatchWorkspaceAction,defaultMindAppearanceConfig},{exportMindPolicy,mindDocumentHash},{createMindPaperAccount,executeMindPaper},{getInstrument},{buildMindCompanions}]=await Promise.all(['dist/domain/workspace.mjs','dist/domain/mind-manifest.mjs','dist/domain/mind-paper.mjs','dist/domain/instruments.mjs','dist/domain/mind-companion.mjs'].map(load));
  const [{createMindStrategyPlan,strategyPlanWithGraph,approveMindStrategyPlan},{createEventQuantScalpingGraph},{strategyGraphHash,evaluateStrategyGraph},{buildMicrostructureSnapshot,resolveMicrostructureInput},{resolvePositionInput},{projectLiveAutomationActivity}]=await Promise.all(['dist/domain/mind-strategy-plan.mjs','dist/domain/event-strategy-presets.mjs','dist/domain/strategy-graph.mjs','dist/domain/microstructure-input.mjs','dist/domain/position-input.mjs','server/live-automation-read-model.mjs'].map(load));
  const created='2026-10-16T00:00:00.000Z',traded='2026-10-16T00:10:00.000Z',read='2026-10-16T00:12:00.000Z',instrumentId='crypto:okx:BTC-USDT';
  function fixture(){const workspace={...createWorkspace({now:created}),revision:14,mindPositions:[],mindRuns:[],mindSubscriptions:[]},profileId=workspace.investmentProfiles[0].id,manifest=exportMindPolicy(workspace,profileId,{now:created,instrumentIds:[instrumentId]});manifest.data.riskPreset={...manifest.data.riskPreset,normalBuyWeight:.1,clutchBuyWeight:.2,maxOrderWeight:.4,maxExposure:.6,minNotional:10,sellWeight:0};workspace.mindPositions.push({...createMindPaperAccount({id:'companion-contract-account',profileId,quoteCurrency:'USDT',initialCash:10000,now:created}),kind:'PAPER_ACCOUNT'});return {workspace,profileId,manifest,minds:[{id:profileId,name:manifest.data.name,version:manifest.data.version,manifestId:manifest.id,manifest}]};}
  function trade(f,{action='buy',stance='normal',at=traded,id='companion-contract-run'}={}){const run={id,profileId:f.profileId,instrumentId,asOf:created,decisionAt:at,decisionCompletedAt:at,manifestId:f.manifest.id,manifestHash:mindDocumentHash(f.manifest),mode:'live',experimentType:'FORWARD_PAPER',decision:{action,stance,confidence:.8,evidenceRefs:[f.manifest.data.principles[0].id],asOf:created,decisionAt:at},risk:{allowed:true,reasons:[]}},quote={instrumentId,price:100,currency:'USDT',asOf:at,receivedAt:at,source:'OKX_PUBLIC_TICKER',rawSha256:'a'.repeat(64)},value=executeMindPaper(f.workspace.mindPositions[0],run,{manifest:f.manifest,instrument:getInstrument(instrumentId),quote,now:at});if(!value.ok)throw new Error('실제 원장 fixture 생성 실패: '+JSON.stringify(value.reasons));f.workspace.mindPositions[0]={...value.account,kind:'PAPER_ACCOUNT'};f.workspace.mindRuns.push(run);return value;}
  const subscription=(f,extra={})=>({id:'companion-contract-subscription',profileId:f.profileId,accountId:f.workspace.mindPositions[0].id,status:'ENABLED',executionMode:'paper',nextCloseAt:'2026-10-16T04:00:00.000Z',updatedAt:traded,attempts:[],...extra});
  const cases=[],add=(name,f,phase,extra={})=>{const before=structuredClone(f),view=buildMindCompanions({...f,executionMode:'paper',asOf:read,...extra});if(JSON.stringify(f)!==JSON.stringify(before))throw new Error('카드 조회가 원본을 변경했습니다.');cases.push({name,view,expectedPhase:phase});};
  const cash=fixture();cash.workspace.mindPositions.push({...createMindPaperAccount({id:'companion-contract-usd',profileId:cash.profileId,quoteCurrency:'USD',initialCash:250,now:created}),kind:'PAPER_ACCOUNT'});add('cash-separated-currencies',cash,'idle');
  const absent=fixture();absent.workspace.mindPositions=[];add('unfunded',absent,'sleep');
  const paused=fixture();paused.workspace.mindSubscriptions.push(subscription(paused,{status:'PAUSED'}));add('explicit-pause',paused,'sleep');
  const waiting=fixture();waiting.workspace.mindSubscriptions.push(subscription(waiting));add('enabled-waiting',waiting,'observing');
  const late=fixture();late.workspace.mindSubscriptions.push(subscription(late,{instrumentId,timeframe:'4h'}));add('enabled-window-passed-without-progress',late,'attention',{asOf:'2026-10-16T04:10:00.001Z'});
  const open=fixture();trade(open);add('held-stale-mark',open,'investing');add('held-fresh-mark',open,'investing',{asOf:'2026-10-16T00:10:30.000Z'});
  const clutch=fixture();trade(clutch,{stance:'clutch'});add('filled-clutch-open-episode',clutch,'clutch');trade(clutch,{action:'hold',stance:'normal',at:'2026-10-16T00:11:00.000Z',id:'companion-contract-release'});add('completed-normal-releases-clutch',clutch,'investing');
  const signal=fixture();trade(signal,{action:'hold',stance:'clutch'});add('clutch-choice-without-fill',signal,'idle');
  const attention=fixture();trade(attention,{stance:'clutch'});attention.workspace.mindSubscriptions.push(subscription(attention,{status:'ACTION_REQUIRED'}));add('unresolved-overrides-clutch',attention,'attention');
  const broken=fixture();broken.workspace.mindPositions[0].cash++;add('invalid-account',broken,'attention');
  const foreign=fixture(),another=foreign.workspace.investmentProfiles[1];foreign.workspace.mindPositions.push({...createMindPaperAccount({id:'companion-foreign-account',profileId:another.id,quoteCurrency:'USDT',initialCash:777,now:created}),kind:'PAPER_ACCOUNT'});foreign.minds.push({id:another.id,name:another.name});add('multiple-minds-isolated',foreign,'idle');
  const live=buildMindCompanions({...clutch,executionMode:'live',asOf:read});cases.push({name:'live-connection-only',view:live,expectedPhase:'sleep'});
  // The production pure projector consumes local activation/event/owned-ledger fixtures.
  // No production account, exchange, saved provider response, or network is read here.
  function liveFixture({held=false,status='ENABLED'}={}){
    const f=fixture(),market='KRW-XRP',assetId='crypto:upbit:'+market,sourceHash='a'.repeat(64),ms=Date.parse(read),graph=createEventQuantScalpingGraph({instrumentId:assetId});
    f.manifest.data.strategyPlan=approveMindStrategyPlan(strategyPlanWithGraph(createMindStrategyPlan({enabled:true}),graph),{now:created,ownerId:'companion-contract-owner'});
    const wallet={id:'contract-live-wallet',profileId:f.profileId,quoteCurrency:'KRW',asOf:read,createdAt:created,updatedAt:read,initialCash:30000,cash:held?20985.25:30000,equity:held?29985.25:30000,netPnl:held?-14.75:0,netReturn:held?-14.75/30000:0,positions:held?[{instrumentId:assetId,quoteCurrency:'KRW',quantity:90,costBasis:9004.5,averageCost:100.05,marketPrice:100,priceAsOf:read}]:[],ledger:held?[{instrumentId:assetId,runId:'contract-prior-buy',at:created,side:'buy',quantity:1,fillPrice:100,fee:0,realizedPnl:0},{instrumentId:assetId,runId:'contract-prior-sell',at:'2026-10-16T00:01:00.000Z',side:'sell',quantity:1,fillPrice:90,fee:.25,realizedPnl:-10.25},{instrumentId:assetId,runId:'contract-live-entry',at:traded,side:'buy',quantity:90,fillPrice:100,fee:4.5,realizedPnl:0}]:[]};
    const bars=Array.from({length:21},(_,i)=>({openTime:new Date(ms-(21-i)*60000).toISOString(),closeTime:new Date(ms-(20-i)*60000).toISOString(),open:100,high:100.1,low:99.9,close:100,volume:100,availableAt:read})),events=[{kind:'ORDER_BOOK',id:'contract-live-book',market,eventTime:read,receivedAt:read,sourceHash,levels:[{askPrice:'100.01',bidPrice:'100',askQuantity:'10000',bidQuantity:'10000'}]}],snapshot=buildMicrostructureSnapshot({instrumentId:assetId,market,asOf:read,timeframe:'1m',bars,events,sourceRefs:[{id:'contract-live-source',contentHash:sourceHash,sourceRef:'fixture:only'}],fees:{takerBuyRate:'0.0005',takerSellRate:'0.0005',observedAt:created,sourceHash}}),inputs=Object.fromEntries(graph.nodes.filter(n=>n.type==='INPUT').map(n=>[n.id,n.config.kind==='MICROSTRUCTURE'?resolveMicrostructureInput({binding:n.config,snapshot,asOf:read,availableAt:read}):resolvePositionInput({binding:n.config,account:wallet,profileId:f.profileId,asOf:read,availableAt:read})]));
    const evaluation=evaluateStrategyGraph(graph,[],{asOf:read,sourceHash,inputs,decisions:{},trigger:'market_event',context:{currentWeight:held?.3:0,inputAvailableAt:read,executionMode:'LIVE'}}),activation={id:'live-companion-contract',status,createdAt:created,userConfirmedAt:created,config:{accountId:'upbit',profileId:f.profileId,manifestId:f.manifest.id,manifestHash:mindDocumentHash(f.manifest),graphHash:strategyGraphHash(graph),quoteCurrency:'KRW',marketIds:[market],capitalLimit:'30000'},funding:{status:'FILLED',market:'KRW-BTC',volume:'0.00027994',executedVolume:'0.00027994',netQuote:'30778.0033',completedAt:created}},account={claims:{[activation.id]:{quoteCurrency:'KRW',capitalLimit:'30000'}},positions:{[activation.id]:held?{XRP:{quantity:'90',costBasis:'9004.5'}}:{}},daily:{[activation.id+':2026-10-16']:{realizedPnl:held?'-10.25':'0',feesPaid:held?'4.75':'0'}}},event={id:'live-contract-decision',kind:'DECISION_SUMMARY',recorded_at:read,body:JSON.stringify({snapshotAsOf:read,inputHash:sourceHash,evaluation,privatePrompt:'LOCAL_PRIVATE_SENTINEL'})};
    const activity=projectLiveAutomationActivity({activation,account,manifest:f.manifest,eventRows:[event],fundingFeeRows:[{applied_fee:'15.3967'}],runtime:{updated_at:read,body:JSON.stringify({lastState:'HOLD',lastEvaluationAt:read})},asOf:read});
    if(activity.lastDecision?.trace.status!=='VERIFIED'||activity.lastDecision.action!=='hold'||evaluation.trace[0]?.output.ready!==true||JSON.stringify(activity).includes('LOCAL_PRIVATE_SENTINEL'))throw new Error('실전 활동 fixture의 정본 경로·원장 일치·allowlist를 확인하세요.');
    const view=buildMindCompanions({...f,executionMode:'live',asOf:read,liveActivities:[activity]});
    view.cards=view.cards.map(card=>({...card,eventStream:graph.nodes.some(n=>n.type==='INPUT'&&n.config.kind==='MICROSTRUCTURE'),automaticScopeSupported:false}));return view;
  }
  cases.push({name:'live-activated-hold',view:liveFixture(),expectedPhase:'observing'},{name:'live-owned-no-mark',view:liveFixture({held:true}),expectedPhase:'investing'},{name:'live-paused-owned',view:liveFixture({held:true,status:'PAUSED'}),expectedPhase:'investing'});
  const customized=fixture();trade(customized);const before=structuredClone(customized.workspace),prior=buildMindCompanions({...customized,executionMode:'paper',asOf:read}).cards[0],defaultConfig=defaultMindAppearanceConfig(customized.profileId),config={bodyVariant:defaultConfig.bodyVariant==='heart'?'frog':'heart',colorPalette:'sage',eyeVariant:'focused',accessory:'bowtie',motionIntensity:'off'};
  const changed=dispatchWorkspaceAction(customized.workspace,{type:'profile.appearance.set',payload:{profileId:customized.profileId,config},expectedRevision:customized.workspace.revision,idempotencyKey:'companion-contract-appearance'},{now:read,actorId:'companion-contract-owner'}).workspace;
  for(const key of new Set([...Object.keys(before),...Object.keys(changed)]))if(!['uiPreferences','revision','updatedAt','activityEvents','commandReceipts'].includes(key)&&JSON.stringify(before[key])!==JSON.stringify(changed[key]))throw new Error('외형 저장이 투자 원본을 변경했습니다: '+key);
  customized.workspace=changed;add('customized-paper-ledger-preserved',customized,'investing');const current=cases.at(-1).view.cards[0],omitAppearance=card=>Object.fromEntries(Object.entries(card).filter(([key])=>key!=='appearance'));if(JSON.stringify(omitAppearance(current))!==JSON.stringify(omitAppearance(prior)))throw new Error('외형 저장이 카드의 투자·성과·활동 상태를 변경했습니다.');if(current.appearance.source!=='SAVED'||JSON.stringify(current.appearance.config)!==JSON.stringify(config))throw new Error('실제 저장한 외형의 모델 연결을 확인하세요.');
  const customLive=buildMindCompanions({...customized,executionMode:'live',asOf:read});if(JSON.stringify(customLive.cards[0].appearance)!==JSON.stringify(current.appearance))throw new Error('모의·실전 보기의 같은 마인드 외형을 유지하세요.');cases.push({name:'customized-live-no-paper-metrics',view:customLive,expectedPhase:'sleep'});return cases;
}

export async function checkMindCompanionUI({rootDir=ROOT}={}){
  const load=path=>readFile(resolve(rootDir,path)),contract=JSON.parse(await load('design/mind-companion-ui-contract.json')),pkg=JSON.parse(await load('package.json')),errors=[],fail=(code,message)=>errors.push({code,message});
  const pin=pkg.mindCompanionUI;
  for(const [key,path]of [['contract','design/mind-companion-ui-contract.json'],['checker','scripts/check-mind-companion-ui.mjs']])if(pin?.[key]?.path!==path||pin[key].sha256!==SHA(await load(path)))fail('RULE_SOURCE_PIN','package.json의 '+key+' 원본 SHA를 갱신하세요.');
  if(!pkg.scripts.check?.includes('node scripts/check-mind-companion-ui.mjs'))fail('CHECK_HOOK','일반 검사에 마인드 카드 계약 검사를 연결하세요.');
  if(contract.schemaVersion!==1||contract.id!=='mind-companion-ui-v1'||contract.status!=='ACTIVE'||contract.stateContract?.policyVersion!=='PAPER_LEDGER_COMPANION_V1'||contract.scope?.executionModeQuery!=='executionMode'||contract.scope?.marketDataModeQuery!=='mode'||JSON.stringify(contract.scope?.supportedExecutionModes)!==JSON.stringify(['paper','live'])||contract.liveActivityContract?.version!=='live-automation-activity-v1'||contract.navigationContract?.primary!=='operations'||JSON.stringify(contract.navigationContract?.tabs)!==JSON.stringify(['operations','principles','records','knowledge','simulations'])||contract.navigationContract?.aliases?.overview!=='operations'||contract.navigationContract?.experimentExecutionMode!=='paper'||contract.appearanceContract?.action!=='profile.appearance.set'||Object.keys(contract.appearanceContract?.config??{}).length!==5||!Object.entries(appearanceFields).every(([key,spec])=>JSON.stringify(spec.values)===JSON.stringify(contract.appearanceContract.config[key])))fail('CONTRACT_SHAPE','마인드 카드·실전 원장·다섯 작업·외형의 활성 계약과 실행·시세 모드 필드를 확인하세요.');
  for(const ref of contract.references??[]){try{const capture=ref.capture,bytes=await load(capture.path);if(SHA(bytes)!==capture.sha256||bytes.length!==capture.bytes||!Number.isFinite(Date.parse(ref.observedAt)))throw new Error('hash/time');if(capture.mediaType==='image/png'?!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):capture.mediaType==='image/jpeg'?bytes[0]!==255||bytes[1]!==216:true)throw new Error('media');}catch{fail('REFERENCE_CAPTURE','실제 레퍼런스 캡처·시각·원본 해시를 연결하세요: '+ref.id);}}
  if(contract.references?.length!==2)fail('REFERENCE_CAPTURE','확인한 Dots와 Pawse 레퍼런스를 연결하세요.');
  const loadModule=path=>import(pathToFileURL(resolve(rootDir,path)).href),ui=await loadModule(contract.implementation.rendererModule),avatar=await loadModule(contract.implementation.avatarModule),route=await loadModule('dist/ui/studio-controller.mjs'),cases=await companionContractCases({rootDir}),copyFragments=new Set(visibleCopy((await load(contract.implementation.rendererModule)).toString('utf8')));
  for(const item of cases){if(item.view.cards[0].phase!==item.expectedPhase)fail('ACTUAL_STATE_TRANSITION',item.name+': 실제 계좌·구독·원장 상태의 phase를 확인하세요.');if(item.name==='held-stale-mark'&&item.view.cards[0].currencies.some(c=>c.netReturn!==null||c.equity!==null||!Number.isFinite(c.lastSavedPerformance?.netReturn)))fail('STALE_CURRENT_PERFORMANCE','오래된 평가를 현재 수익률로 표시할 수 없습니다.');const markup=ui.renderMindCompanions(item.view),tree=parseCompanionMarkup(markup);for(const node of nodes(tree,node=>node.tag==='#text'&&/[가-힣]/.test(node.value)))copyFragments.add(node.value.trim());for(const error of inspectCompanionMarkup(markup,{view:item.view}))fail(error.code,item.name+': '+error.message);for(const card of nodes(tree,node=>has(node,'data-mind-companion'))){const model=item.view.cards.find(model=>model.profileId===card.attrs['data-profile-id']),body=model?.appearance?.config?.bodyVariant,expected=body?appearanceFields.bodyVariant.values.indexOf(body):avatar.mindAvatarIdentity(card.attrs['data-profile-id']).variant,actual=nodes(card,node=>has(node,'data-mind-avatar'))[0]?.attrs['data-mind-avatar'];if(actual!==String(expected))fail('AVATAR_IDENTITY',item.name+': 마인드 ID와 저장 외형에 연결한 캐릭터 정체성을 보존하세요.');}}
  const vocabulary=JSON.parse(await load('design/vocabulary.json'));for(const violation of inspectCopy([...copyFragments],vocabulary))fail('COMPANION_COPY',violation.word+': '+violation.text);
  const shell=await loadModule('dist/ui/studio-shell.mjs');
  for(const mode of ['paper','live']){errors.push(...inspectCompanionModeToggle(ui.renderExecutionModeToggle(mode),mode));for(const id of ['scope-one','scope two & 유저']){const targets=ui.companionActionTargets(id,mode);for(const name of ['overview','operations']){const parsed=route.parseStudioRoute(targets[name]);if(parsed.page!=='minds'||parsed.params.get('profileId')!==id||parsed.params.get('executionMode')!==mode||parsed.params.get('view')!=='operations'||parsed.params.has('mode'))fail('TARGET_SCOPE','카드 대상의 마인드·실행 모드·운용 진입을 보존하세요.');}const current=route.parseStudioRoute('#minds?profileId='+encodeURIComponent(id)+'&view=overview&executionMode='+mode+'&mode=replay'),next=route.parseStudioRoute(route.studioRouteHash(current,'minds',{view:'operations'}));if(next.params.get('executionMode')!==mode||next.params.get('mode')!=='replay'||next.params.get('profileId')!==id)fail('ROUTE_MODE_COLLISION','실행 모드와 시세 자료 모드의 독립성을 보존하세요.');
    for(const currentView of ['overview','operations','principles','knowledge','records','simulations']){const selected=route.parseStudioRoute('#minds?'+new URLSearchParams({profileId:id,view:currentView,executionMode:mode})),navigation={selectedMindId:id,scopeLoaded:true,scopeName:id,minds:[{id,name:id}],items:['operations','principles','records','knowledge','simulations'].map(view=>({id:view,href:route.studioRouteHash(selected,'minds',{view})}))};errors.push(...inspectCompanionWorkspaceNavigation(shell.renderMindWorkspace(navigation,selected,{parseRoute:route.parseStudioRoute,routeHash:route.studioRouteHash}),{profileId:id,executionMode:mode,currentView}));}
  }}
  const identity='scope-one',first=parseCompanionMarkup(avatar.renderMindAvatar({identity,phase:'idle'})),second=parseCompanionMarkup(avatar.renderMindAvatar({identity,phase:'clutch'}));if(nodes(first,node=>has(node,'data-mind-avatar'))[0]?.attrs['data-mind-avatar']!==nodes(second,node=>has(node,'data-mind-avatar'))[0]?.attrs['data-mind-avatar'])fail('AVATAR_IDENTITY','상태가 바뀌어도 마인드 캐릭터 정체성을 유지하세요.');
  const motionTokens=(await load('styles/tokens/companion.css')).toString('utf8')+'\n'+(await load('dist/ui/tailwind.css')).toString('utf8');errors.push(...inspectCompanionMotion((await load(contract.implementation.avatarCss)).toString('utf8'),{tokenCss:motionTokens}));const index=(await load('dist/index.html')).toString('utf8');if(!nodes(parseCompanionMarkup(index),node=>node.tag==='link'&&node.attrs.rel==='stylesheet'&&node.attrs.href==='./ui/mind-avatar.css').length)fail('AVATAR_STYLE_NOT_LOADED','캐릭터 모션·모션 감소 CSS를 실제 앱에 연결하세요.');if(!nodes(parseCompanionMarkup(index),node=>node.tag==='link'&&node.attrs.rel==='stylesheet'&&node.attrs.href==='./ui/tailwind.css').length)fail('AVATAR_TOKENS_NOT_LOADED','캐릭터 색상·크기·움직임 토큰을 실제 앱에 연결하세요.');
  return {status:errors.length?'failed':'passed',policyVersion:contract.id,caseCount:cases.length,copyCount:copyFragments.size,errors,scope:'OFFLINE_MODEL_MARKUP_ROUTE_MOTION_CONTRACT',browserEvidence:'실제 DOM·조작·PNG 증거는 별도로 연결한다. 이 검사는 오프라인 fixture와 구조만 검사하며 외부 상담·공급자를 호출하지 않는다.'};
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{const result=await checkMindCompanionUI();if(result.errors.length){for(const error of result.errors)console.error(error.code+': '+error.message);process.exitCode=1;}else console.log('Mind companion contract passed: '+result.caseCount+' real-ledger model/markup cases, route modes, references, source pins, reduced motion.');}catch(error){console.error('Mind companion contract failed: '+error.message);process.exitCode=1;}
}
