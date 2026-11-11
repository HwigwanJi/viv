const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const list=value=>Array.isArray(value)?value:[];
export const EQUITY_ASSET_TYPES=[['stock','주식'],['etf','ETF'],['reit','리츠'],['etn','ETN'],['preferred','우선주'],['other','기타']];
const typeName=item=>({DEPOSITARY_RECEIPT:'예탁증서',STOCK_WARRANTS:'신주인수권',INFRASTRUCTURE_FUND:'인프라 펀드'})[item.securityType]||EQUITY_ASSET_TYPES.find(([id])=>id===item.assetType)?.[1]||'주식';
const marketName=item=>({KOSPI:'코스피',KOSDAQ:'코스닥',KONEX:'코넥스',KRX:'한국거래소',NASDAQ:'나스닥',NYSE:'뉴욕증권거래소',NYSE_ARCA:'NYSE Arca',AMEX:'NYSE American'})[item.market||item.venue]||item.market||item.venue;
const label=item=>[item.name||item.symbol,item.symbol,marketName(item)].filter(Boolean).join(' · ');
const time=value=>value&&Number.isFinite(Date.parse(value))?new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}).format(new Date(value)):'갱신 시각 확인';
export function catalogSummary(result,{sectorId=''}={}){
 if(!result)return '';
 if(result.source?.status==='COLLECTION_REQUIRED')return '기본 목록 · 전체 목록 수집 필요';
 const count=sectorId&&['COLLECTION_REQUIRED','STALE'].includes(result.coverage?.sectorStatus)?(result.coverage.sectorStatus==='STALE'?'구성 종목 갱신 필요':'구성 종목 수집 필요'):new Intl.NumberFormat('ko-KR').format(result.total??result.items?.length??0)+'개 종목';
 const sourced=result.source?.provider==='toss'&&typeof result.source?.id==='string'&&typeof result.source?.contentHash==='string';
 return count+(sourced?' · 토스증권 · '+time(result.asOf):' · 출처 시각 확인')+(result.source?.status==='STALE'?' · 갱신 필요':'');
}

export function catalogSearchPath(endpoint,filters={},cursor=''){
 const params=new URLSearchParams({limit:'40',assetClass:'equity'});
 for(const key of ['q','market','assetType','sectorId'])if(typeof filters[key]==='string'&&filters[key].trim())params.set(key,filters[key].trim());
 if(cursor)params.set('cursor',cursor);
 return endpoint+'?'+params;
}
export function catalogSelectionMarkup(items,{name='',mode='multiple'}={}){
 if(mode==='navigate')return '';
 return '<div class="catalog-selection" data-catalog-selected><span class="catalog-selection-count">선택 '+items.length+'개</span>'+items.map(item=>'<span class="catalog-selection-chip"><input type="hidden" name="'+esc(name)+'" value="'+esc(item.id)+'"><span title="'+esc(label(item))+'">'+esc(item.name||item.symbol||item.id)+'</span><button type="button" class="catalog-remove" data-catalog-remove="'+esc(item.id)+'" aria-label="'+esc(item.name||item.symbol||item.id)+' 선택 해제">×</button></span>').join('')+(items.length?'<button class="button small" type="button" data-catalog-clear>모두 해제</button>':'')+'</div>';
}
export function catalogResultsMarkup(result,{selectedIds=[],mode='multiple',loading=false,error='',sectorId='',sectorCollectAvailable=false,collecting=false}={}){
 if(error)return '<p class="error-text" role="alert">'+esc(error)+'</p><button type="button" class="button small" data-catalog-retry>다시 조회</button>';
 if(loading)return '<p class="catalog-empty" role="status">종목을 찾는 중…</p>';
 if(!result)return '<p class="catalog-empty">종목명이나 티커를 검색하세요.</p>';
 const items=list(result.items),selected=new Set(selectedIds);
 const status=result.source?.status??result.status;
 const sectorMissing=!!sectorId&&['COLLECTION_REQUIRED','STALE'].includes(result.coverage?.sectorStatus),canCollect=result.toss?.collectAvailable??sectorCollectAvailable;
 const sectorNotice=sectorMissing?'<div class="catalog-empty" role="status"><p>섹터 구성 종목을 불러오세요.</p>'+(canCollect?'<button type="button" class="button small" data-catalog-collect-sector'+(collecting?' disabled':'')+'>'+(collecting?'가져오는 중…':'섹터 종목 가져오기')+'</button>':'<a class="button small" href="#settings?view=accounts&amp;executionMode=live">토스 계좌 연결</a>')+'</div>':'';
 if(!items.length)return sectorNotice||'<p class="catalog-empty" role="status">'+(status==='COLLECTION_REQUIRED'?'토스 종목 목록을 가져오세요.':'검색 조건에 맞는 종목이 없습니다.')+'</p>';
 return sectorNotice+'<ul class="catalog-results">'+items.map(item=>'<li class="catalog-result"><div class="catalog-result-name"><strong title="'+esc(item.name||item.symbol)+'">'+esc(item.name||item.symbol)+'</strong><span title="'+esc(label(item))+'">'+esc([item.symbol,marketName(item),typeName(item)].filter(Boolean).join(' · '))+'</span></div><button type="button" class="button small" data-catalog-choose="'+esc(item.id)+'"'+(mode==='navigate'?'':' aria-pressed="'+selected.has(item.id)+'"')+' aria-label="'+esc(item.name||item.symbol)+' '+(mode==='navigate'?'차트 열기':selected.has(item.id)?'선택 해제':'추가')+'">'+(mode==='navigate'?'차트 열기':selected.has(item.id)?'선택됨':'추가')+'</button></li>').join('')+'</ul>';
}
export function universeCatalogPickerMarkup(catalog,{key='equities',name='explicitIncludeIds',title='주식 직접 선택',selected=[],mode='multiple',query=''}={}){
 const endpoint=catalog.search?.endpoint||'/api/workspace/universe/search',instruments=list(catalog.instruments),items=selected.map(id=>instruments.find(item=>item.id===id)||{id,symbol:id.split(':').at(-1),name:id.split(':').at(-1)});
 return '<section class="universe-catalog-picker" data-universe-catalog-picker data-catalog-endpoint="'+esc(endpoint)+'" data-catalog-sector-collect="'+(catalog.toss?.collectAvailable===true)+'" data-catalog-key="'+esc(key)+'" data-catalog-name="'+esc(name)+'" data-catalog-mode="'+esc(mode)+'"><h3>'+esc(title)+'</h3><div class="catalog-search-row"><label class="field"><span class="visually-hidden">'+esc(title)+' 검색</span><input type="search" data-catalog-query data-universe-options-search data-universe-options-key="'+esc(key)+'" value="'+esc(query)+'" placeholder="종목명·티커·종목 코드" aria-label="'+esc(title)+' 검색"></label><button type="button" class="button small" data-catalog-search>검색</button></div><div class="catalog-filters"><label class="field">국가<select data-catalog-filter="market"><option value="">전체 국가</option><option value="KR">한국</option><option value="US">미국</option></select></label><label class="field">자산 유형<select data-catalog-filter="assetType"><option value="">전체 유형</option>'+EQUITY_ASSET_TYPES.map(([id,text])=>'<option value="'+id+'">'+text+'</option>').join('')+'</select></label><label class="field">섹터<select data-catalog-filter="sectorId"><option value="">전체 섹터</option>'+list(catalog.sectors).map(item=>'<option value="'+esc(item.id)+'">'+esc(item.name)+'</option>').join('')+'</select></label></div><div data-catalog-selection>'+catalogSelectionMarkup(items,{name,mode})+'</div><div class="catalog-result-summary" data-catalog-summary aria-live="polite"></div><div class="catalog-results-region" data-catalog-results>'+catalogResultsMarkup(null)+'</div><div class="catalog-pager"><button type="button" class="button small" data-catalog-page="previous" disabled>이전</button><span data-catalog-page-label>1쪽</span><button type="button" class="button small" data-catalog-page="next" disabled>다음</button></div></section>';
}

/** Selection is stored independently from each result page and serialized by native FormData. */
export function createCatalogPickerState({selected=[],request,endpoint='/api/workspace/universe/search',onChange=()=>{}}={}){
 const selection=new Map(selected.map(item=>[item.id,item]));let filters={q:'',market:'',assetType:'',sectorId:''},result=null,loading=false,collecting=false,error='',generation=0,page=0,cursors=[''],disposed=false;
 const state=()=>({filters:{...filters},result,loading,collecting,error,page,canPrevious:page>0,canNext:!!result?.nextCursor,selected:[...selection.values()]});
 async function load(nextFilters=null,direction=null){
  if(disposed)return;if(nextFilters){filters={...filters,...nextFilters};page=0;cursors=[''];}
  if(direction==='previous'&&page>0)page--;else if(direction==='next'&&result?.nextCursor){cursors[page+1]=result.nextCursor;page++;}
  const token=++generation;loading=true;error='';onChange(state());
  try{const value=await request(catalogSearchPath(endpoint,filters,cursors[page]));if(disposed||token!==generation)return;result=value;for(const item of list(value.items))if(selection.has(item.id))selection.set(item.id,item);}
  catch(problem){if(!disposed&&token===generation){result=null;error=problem.message||'종목 목록을 다시 조회하세요.';if(problem.code==='UNIVERSE_SEARCH_CURSOR'){page=0;cursors=[''];}}}
  finally{if(!disposed&&token===generation){loading=false;onChange(state());}}
 }
 function toggle(item){if(selection.has(item.id))selection.delete(item.id);else selection.set(item.id,item);onChange(state());}
 function remove(id){selection.delete(id);onChange(state());}
 function clear(){selection.clear();onChange(state());}
 async function collectSector(collect){
  if(disposed||collecting||!collect||!filters.sectorId)return;
  const target={...filters};collecting=true;error='';onChange(state());
  try{await collect(target);if(!disposed)await load({...filters});}
  catch(problem){if(!disposed&&JSON.stringify(target)===JSON.stringify(filters))error=problem.message||'섹터 자료를 다시 가져오세요.';}
  finally{collecting=false;if(!disposed)onChange(state());}
 }
 return {state,load,toggle,remove,clear,collectSector,dispose(){disposed=true;generation++;}};
}

export function bindUniverseCatalogPickers(container,{request,onChoose=()=>{},onItems=()=>{},onCollectSector}={}){
 const cleanups=[];
 for(const node of container?.querySelectorAll?.('[data-universe-catalog-picker]')||[]){
  const mode=node.dataset.catalogMode||'multiple',name=node.dataset.catalogName,selected=[...node.querySelectorAll('[data-catalog-selected] input[type="hidden"]')].map(input=>({id:input.value,name:input.parentElement.querySelector('span')?.textContent||input.value}));
  let current=null;
  function paint(state){
   if(!node.isConnected)return;
   const active=node.ownerDocument?.activeElement,focused=active&&node.contains(active)?{choose:active.dataset?.catalogChoose,remove:active.dataset?.catalogRemove}:null;
   current=state;onItems(list(state.result?.items));node.querySelector('[data-catalog-selection]').innerHTML=catalogSelectionMarkup(state.selected,{mode,name});node.querySelector('[data-catalog-results]').innerHTML=catalogResultsMarkup(state.result,{mode,loading:state.loading,error:state.error,selectedIds:state.selected.map(item=>item.id),sectorId:state.filters.sectorId,sectorCollectAvailable:node.dataset.catalogSectorCollect==='true',collecting:state.collecting});node.querySelector('[data-catalog-summary]').textContent=state.loading?'':catalogSummary(state.result,state.filters);node.querySelector('[data-catalog-page-label]').textContent=(state.page+1)+'쪽';node.querySelector('[data-catalog-page="previous"]').disabled=state.loading||!state.canPrevious;node.querySelector('[data-catalog-page="next"]').disabled=state.loading||!state.canNext;node.querySelector('[data-catalog-search]').disabled=state.loading;node.setAttribute('aria-busy',String(state.loading||state.collecting));
   if(focused?.choose||focused?.remove){const replacement=[...node.querySelectorAll('button')].find(button=>focused.choose?button.dataset.catalogChoose===focused.choose:button.dataset.catalogRemove===focused.remove);(replacement||node.querySelector('[data-catalog-query]')).focus({preventScroll:true});}
  }
  const model=createCatalogPickerState({selected,request,endpoint:node.dataset.catalogEndpoint,onChange:paint});
  const filters=()=>Object.fromEntries([['q',node.querySelector('[data-catalog-query]').value],...[...node.querySelectorAll('[data-catalog-filter]')].map(input=>[input.dataset.catalogFilter,input.value])]);

  const click=event=>{const target=event.target.closest?.('button');if(!target||target.disabled||!node.contains(target))return;event.preventDefault();if(target.hasAttribute('data-catalog-collect-sector'))return model.collectSector(onCollectSector);if(target.hasAttribute('data-catalog-search'))return model.load(filters());if(target.hasAttribute('data-catalog-retry'))return model.load();if(target.hasAttribute('data-catalog-clear'))return model.clear();if(target.dataset.catalogRemove)return model.remove(target.dataset.catalogRemove);if(target.dataset.catalogPage)return model.load(null,target.dataset.catalogPage);if(target.dataset.catalogChoose){const item=current?.result?.items.find(item=>item.id===target.dataset.catalogChoose);if(item)return mode==='navigate'?onChoose(item):model.toggle(item);}};
  const change=event=>{if(event.target.matches?.('[data-catalog-filter]'))model.load(filters());};
  const keydown=event=>{if(event.key==='Enter'&&event.target.matches?.('[data-catalog-query]')){event.preventDefault();event.stopPropagation();model.load(filters());}};
  node.addEventListener('click',click);node.addEventListener('change',change);node.addEventListener('keydown',keydown);model.load(filters());
  cleanups.push(()=>{model.dispose();node.removeEventListener('click',click);node.removeEventListener('change',change);node.removeEventListener('keydown',keydown);});
 }
 return ()=>cleanups.forEach(fn=>fn());
}
