const list=value=>Array.isArray(value)?value:[];
const tabs=new Set(['all','crypto','stock','watchlist']);
const normalize=value=>({tab:tabs.has(value?.tab)?value.tab:'all',q:String(value?.q||'').slice(0,160),market:['KR','US'].includes(value?.market)?value.market:'',assetType:['stock','etf','reit','etn','preferred','other'].includes(value?.assetType)?value.assetType:'',sectorId:typeof value?.sectorId==='string'?value.sectorId:''});
export function terminalUniverseSearchPath(filters={},cursor=''){
 const value=normalize(filters),params=new URLSearchParams({limit:'40'});
 if(value.tab==='crypto')params.set('assetClass','crypto');
 if(value.tab==='stock')params.set('assetClass','equity');
 if(value.q.trim())params.set('q',value.q.trim());
 if(value.market&&value.tab==='stock')params.set('market',value.market);
  if(value.tab==='stock')for(const name of ['assetType','sectorId'])if(value[name])params.set(name,value[name]);
 if(cursor)params.set('cursor',cursor);
 return '/api/workspace/universe/search?'+params;
}

/** Discovery state never writes a mind policy. Only watched IDs are managed locally. */
export function createTerminalUniverse({request,onChange=()=>{},onItems=()=>{},getWatched=()=>[],storage=null,debounceMs=250}={}){
 let saved;try{saved=JSON.parse(storage?.getItem('cji-terminal-universe-v1')||'null');}catch{}
 let filters=normalize(saved),result=null,loading=false,error='',collectionError='',generation=0,abort=null,timer=null,page=0,cursors=[''],loadedKey='',disposed=false,sectors=[],facetsLoaded=false,facetsLoading=false,facetsError='',collecting=false,collectAvailable=false;
 if(filters.tab!=='stock')filters={...filters,market:'',assetType:'',sectorId:''};
 const state=()=>({filters:{...filters},items:list(result?.items),total:result?.total??null,source:result?.source??null,sources:list(result?.source?.sources??result?.sources),asOf:result?.asOf??null,coverage:result?.coverage??{},sectors,facetsLoading,facetsError,collecting,collectAvailable:result?.toss?.collectAvailable??collectAvailable,loading,error,collectionError,page,canPrevious:page>0,canNext:!!result?.nextCursor,loaded:!!result});
 const emit=()=>{if(!disposed)onChange(state());};
 const remember=()=>{try{storage?.setItem('cji-terminal-universe-v1',JSON.stringify(filters));}catch{}};
 const cancel=()=>{clearTimeout(timer);timer=null;generation++;abort?.abort();abort=null;};
 async function loadFacets(){if(facetsLoaded||facetsLoading||disposed)return;facetsLoading=true;facetsError='';try{const value=await request('/api/workspace/universe/catalog');if(disposed)return;sectors=list(value.sectors);collectAvailable=value.toss?.collectAvailable===true;facetsLoaded=true;}catch{facetsError='섹터 목록 조회 실패';}finally{facetsLoading=false;emit();}}
 function watchedResult(){
  const query=filters.q.trim().toLocaleLowerCase(),items=list(getWatched()).filter(i=>!query||[i.name,i.englishName,i.symbol,i.id,i.venue].some(v=>String(v||'').toLocaleLowerCase().includes(query)));
  const start=page*40;return {items:items.slice(start,start+40),total:items.length,nextCursor:items.length>start+40?String(page+1):null,source:{provider:'watchlist',status:'READY',count:items.length}};
 }
 async function load({force=false,direction=null}={}){
  if(disposed)return;
  if(filters.tab==='stock')void loadFacets();
  if(direction==='previous'&&page>0)page--;else if(direction==='next'&&result?.nextCursor){cursors[page+1]=result.nextCursor;page++;}
  else if(direction)return;
  const key=terminalUniverseSearchPath(filters,cursors[page]);
  if(!force&&!direction&&loadedKey===key&&(loading||result))return;
  cancel();const token=generation;abort=new AbortController();loading=true;error='';result=null;loadedKey=key;emit();
  if(filters.tab==='watchlist'){
   result=watchedResult();loading=false;emit();return;
  }
  try{
   const value=await request(key,undefined,{signal:abort.signal});
   if(disposed||generation!==token)return;
   if(!Array.isArray(value.items)||!Number.isSafeInteger(value.total)||value.total<0)throw new Error('종목 목록을 다시 조회하세요.');
   result=value;onItems(value.items);
  }catch(problem){
   if(disposed||generation!==token||problem.name==='AbortError')return;
   error=problem.message||'종목 목록을 다시 조회하세요.';
   if(problem.code==='UNIVERSE_SEARCH_CURSOR'){page=0;cursors=[''];}
   loadedKey='';
  }finally{if(!disposed&&generation===token){loading=false;emit();}}
 }
 function change(patch,{debounce=false}={}){
  if(disposed)return;
  cancel();filters=normalize({...filters,...patch});
  if(['market','assetType','sectorId'].some(name=>Object.hasOwn(patch,name)&&filters[name]))filters.tab='stock';
  if(filters.tab!=='stock')filters={...filters,market:'',assetType:'',sectorId:''};
  page=0;cursors=[''];result=null;loadedKey='';error='';collectionError='';loading=true;remember();emit();
  if(debounce)timer=setTimeout(()=>load({force:true}),debounceMs);else return load({force:true});
 }
 function refreshWatchlist(){if(filters.tab==='watchlist'){if(page*40>=watchedResult().total){page=0;cursors=[''];}return load({force:true});}emit();}
 async function collectCatalog(collect){
  if(disposed||collecting)return;
  const scope=JSON.stringify(filters);collecting=true;collectionError='';emit();
  try{await collect();if(!disposed)await load({force:true});}
  catch(problem){if(!disposed&&JSON.stringify(filters)===scope)collectionError=problem.message||'종목 목록을 다시 가져오세요.';}
  finally{collecting=false;emit();}
 }
 async function collectSector(collect){if(disposed||collecting||!filters.sectorId)return;const scope={...filters};collecting=true;error='';emit();try{await collect(scope);if(!disposed&&JSON.stringify(filters)===JSON.stringify(scope))await load({force:true});}catch(problem){if(!disposed&&JSON.stringify(filters)===JSON.stringify(scope))error=problem.message||'섹터 자료를 다시 가져오세요.';}finally{collecting=false;emit();}}
 return {state,load,change,refreshWatchlist,collectSector,collectCatalog,dispose(){disposed=true;cancel();}};
}
