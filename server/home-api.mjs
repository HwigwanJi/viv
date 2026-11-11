import {RepositoryError,WorkspaceRepository} from './repository.mjs';
import {readHomePerformance} from './home-performance.mjs';

const PATH='/api/workspace/home-performance';
const json=(value,status=200,extra={})=>Response.json(value,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...extra}});
const check=(ok,code,message,status=400)=>{if(!ok)throw new RepositoryError(code,message,status);};

/** Home reads preserve account, trade and experiment records; refresh reads public marks only. */
export async function handleHomeAPI(request,env={},options={}){
  const url=new URL(request.url);if(url.pathname!==PATH)return null;
  try{
    const ownerId=request.headers.get('oai-authenticated-user-id');
    check(typeof ownerId==='string'&&ownerId.trim().length>0,'UNAUTHORIZED','로그인이 필요합니다.',401);
    check((!request.headers.get('Origin')||request.headers.get('Origin')===url.origin)&&request.headers.get('Sec-Fetch-Site')!=='cross-site','ORIGIN','앱에서 다시 조회하세요.',403);
    check(request.method==='GET','HOME_PERFORMANCE_METHOD','성과 조회 경로를 확인하세요.',405);
    const allowed=['executionMode','refreshValuations','includeInvestorMetrics'];
    check([...url.searchParams.keys()].every(k=>allowed.includes(k)&&url.searchParams.getAll(k).length===1),'HOME_PERFORMANCE_QUERY','조회 조건을 확인하세요.');
    const executionMode=url.searchParams.get('executionMode')??'paper',refresh=url.searchParams.get('refreshValuations')??'false',investor=url.searchParams.get('includeInvestorMetrics')??'false';
    check(['paper','live'].includes(executionMode)&&['true','false'].includes(refresh)&&['true','false'].includes(investor),'HOME_PERFORMANCE_QUERY','운용 모드와 평가 갱신 여부를 확인하세요.');
    const db=env.DB,repository=options.repository??new WorkspaceRepository(db);
    return json(await readHomePerformance({repository,db,ownerId,executionMode,includeInvestorMetrics:investor==='true',refreshValuations:refresh==='true',now:options.now,fetchImpl:options.fetchImpl,quoteLoader:options.quoteLoader,env,periodMarketLoader:options.periodMarketLoader}));
  }catch(error){
    const known=error instanceof RepositoryError;
    return json({ok:false,code:known?error.code:'HOME_PERFORMANCE_FAILED',message:known?error.message:'성과를 불러오지 못했습니다. 다시 조회하세요.'},known?error.status:500,error.status===405?{Allow:'GET'}:{});
  }
}
