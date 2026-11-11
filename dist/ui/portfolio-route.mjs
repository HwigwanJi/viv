export const PORTFOLIO_VIEWS = ['overview','decisions','trades','experiences','knowledge','settings'];
const sizes = [10,20,50];
const clean = (value,max=200) => typeof value === 'string' ? value.slice(0,max) : '';

export function normalizePortfolioRoute(value={}) {
  return {
    page:['paper','portfolio','desk'].includes(value.page)?value.page:'paper',
    comparison:clean(value.comparison), mind:clean(value.mind)||'all',
    view:PORTFOLIO_VIEWS.includes(value.view)?value.view:'overview',
    cursor:clean(value.cursor,1600), pageSize:sizes.includes(Number(value.pageSize))?Number(value.pageSize):20,
    search:clean(value.search,120), status:clean(value.status,64), bot:clean(value.bot),
  };
}

export function parsePortfolioRoute(hash='') {
  const [page,query=''] = String(hash).replace(/^#/,'').split('?',2);
  return normalizePortfolioRoute(['paper','portfolio','desk'].includes(page)?{...Object.fromEntries(new URLSearchParams(query)),page}:{});
}

export function serializePortfolioRoute(route) {
  const value=normalizePortfolioRoute(route),params=new URLSearchParams();
  for(const key of ['comparison','mind','view','cursor','pageSize','search','status','bot']) {
    if(!value[key]||(key==='mind'&&value[key]==='all')||(key==='view'&&value[key]==='overview')||(key==='pageSize'&&value[key]===20))continue;
    params.set(key,String(value[key]));
  }
  return '#'+value.page+(params.size?'?'+params:'');
}

export function portfolioRequestPath(route) {
  const r=normalizePortfolioRoute(route),q=new URLSearchParams({comparisonId:r.comparison,profileId:r.mind,view:r.view==='settings'?'overview':r.view,pageSize:String(r.pageSize)});
  for(const key of ['cursor','search','status'])if(r[key])q.set(key,r[key]);
  return '/api/workspace/portfolio-view?'+q;
}

export function portfolioQueryKey(route) { return portfolioRequestPath(route); }
export function portfolioFinancialKey(route) {const r=normalizePortfolioRoute(route);return JSON.stringify([r.comparison,r.mind]);}

/** A changed scope clears the old scope's data; late requests cannot replace it. */
export function createPortfolioQuery({request,onChange=()=>{}}) {
  let state={data:null,loading:false,error:null,key:null,financialKey:null,requestedRevision:null},generation=0,controller=null,pending=null,destroyed=false;
  const emit=()=>{if(!destroyed)onChange(state);};
  async function load(route,{revision=0,force=false}={}) {
    const key=portfolioQueryKey(route),financialKey=portfolioFinancialKey(route);
    if(!force&&state.key===key&&state.requestedRevision===revision)return pending||state.data;
    const sameQuery=state.key===key,sameFinancialScope=state.financialKey===financialKey,token=++generation;
    controller?.abort();controller=new AbortController();
    const data=sameQuery?state.data:sameFinancialScope&&state.data?{...state.data,page:null}:null;
    state={data,loading:true,error:null,resetCursor:false,key,financialKey,requestedRevision:revision};emit();
    const signal=controller.signal;
    pending=(async()=>{
      try {
        const response=await request(key,undefined,{signal});
        if(destroyed||token!==generation||signal.aborted)return null;
        const data=response?.portfolioView||response?.portfolio||response?.result||response;
        if(data?.schemaVersion!==1||!data.summary||!data.page)throw new Error('조회 결과를 확인하지 못했습니다. 다시 조회하세요.');
        if(Number.isInteger(data.revision)&&data.revision<revision)throw new Error('최근 저장 기록을 다시 조회하세요.');
        state={...state,data,loading:false,error:null,resetCursor:false};emit();return data;
      } catch(error) {
        if(destroyed||token!==generation||signal.aborted)return null;
        state={...state,loading:false,error:error?.message||'목록을 불러오지 못했습니다.',resetCursor:error?.resetCursor===true||error?.code==='PORTFOLIO_CURSOR_STALE'};emit();return null;
      } finally {if(token===generation)pending=null;}
    })();
    return pending;
  }
  return {load,state:()=>state,destroy(){destroyed=true;generation++;controller?.abort();}};
}

export function createPortfolioRoute({window:browser,onChange=()=>{},initialHash}={}) {
  let current=parsePortfolioRoute(initialHash??browser?.location?.hash??''),destroyed=false;
  const restored=()=>{if(destroyed||!/^#(?:paper|portfolio|desk)(?:\?|$)/.test(String(browser?.location?.hash||'')))return;current=parsePortfolioRoute(browser.location.hash);onChange(current,{restored:true});};
  browser?.addEventListener?.('hashchange',restored);browser?.addEventListener?.('popstate',restored);
  function set(patch,{replace=false,resetCursor=true}={}) {
    const changedScope=['comparison','mind','view','pageSize','search','status','bot'].some(k=>Object.hasOwn(patch,k)&&patch[k]!==current[k]);
    current=normalizePortfolioRoute({...current,...patch,...(resetCursor&&changedScope&&!Object.hasOwn(patch,'cursor')?{cursor:''}:{})});
    const hash=serializePortfolioRoute(current);
    if(browser?.location&&browser.location.hash!==hash)browser.history?.[replace?'replaceState':'pushState']?.(null,'',hash);
    if(!destroyed)onChange(current,{restored:false});return current;
  }
  return {state:()=>current,set,destroy(){destroyed=true;browser?.removeEventListener?.('hashchange',restored);browser?.removeEventListener?.('popstate',restored);}};
}
