import {WorkspaceRepository,readOperationalWorkspace} from './repository.mjs';
import {runMindSubscriptions,runDueMindObservations,MIND_LOCAL_DELIVERY} from './mind-subscriptions.mjs';
import {runPaperAdaptations} from './paper-adaptation.mjs';
import {MAX_ACTIVE_MIND_SUBSCRIPTIONS} from '../dist/domain/mind-subscriptions.mjs';
import {setMindPaperRunnerState,mindPaperRunnerStatus} from './mind-paper-runtime.mjs';

const safeFailure=(error,at)=>({code:typeof error?.code==='string'&&/^[A-Z0-9_]{1,100}$/.test(error.code)?error.code:'PAPER_RUNNER_FAILED',occurredAt:at});

/** Local lifecycle owns delivery only; approved subscriptions own every trade. */
export function createMindPaperRunner({env,ownerId,url,repository=new WorkspaceRepository(env.DB),options={},intervalMs=30000,clock=()=>Date.now(),dispatch=runMindSubscriptions,observe=runDueMindObservations,adapt=runPaperAdaptations,setTimer=setTimeout,clearTimer=clearTimeout}={}){
  if(!ownerId||!Number.isSafeInteger(intervalMs)||intervalMs<1000||intervalMs>60000)throw new TypeError('Valid paper runner owner and interval required');
  const request=new Request(new URL('/api/workspace/mind-subscriptions',url));
  let timer=null,heartbeatTimer=null,inFlight=null,stopped=true;
  let state={status:'STOPPED',startedAt:null,heartbeatAt:null,lastDispatchAt:null,lastCompletedAt:null,lastFailure:null,intervalMs,dispatchCount:0,lastReport:null};
  const now=()=>new Date(clock()).toISOString(),publish=patch=>{state={...state,...patch};setMindPaperRunnerState(env.DB,ownerId,state);};
  const beat=()=>{if(stopped)return;publish({heartbeatAt:now()});heartbeatTimer=setTimer(beat,intervalMs);heartbeatTimer?.unref?.();};
  async function work(){
    const at=now();publish({heartbeatAt:at,status:'RUNNING',lastDispatchAt:at,dispatchCount:state.dispatchCount+1});
    try{
      const workspace=await readOperationalWorkspace(repository,ownerId);
      if(workspace){
        const args={request,env,ownerId,repository,options:{...options,now,[MIND_LOCAL_DELIVERY]:true},maxJobs:MAX_ACTIVE_MIND_SUBSCRIPTIONS};
        const automatic=await dispatch(args),busy=automatic.deliveryStatus==='IN_PROGRESS',observations=busy?{processed:0,completed:0,failed:0,skipped:0,retried:0,results:[]}:await observe(args),adaptations=busy?{processed:0,results:[]}:await adapt(args),failed=[...automatic.results,...observations.results,...adaptations.results].find(r=>r.status==='FAILED'||r.status==='PORTFOLIO_FAILED'||r.status==='ACTION_REQUIRED'||r.status==='failed'||r.ok===false);
        publish({lastReport:{processed:automatic.processed+observations.processed,completed:automatic.completed+observations.completed,failed:automatic.failed+observations.failed,skipped:automatic.skipped+observations.skipped,retried:automatic.retried+observations.retried,subscriptions:automatic.results,observations:observations.results,adaptations:adaptations.results},lastFailure:failed?{code:failed.code??(failed.ok===false?failed.status:null)??'PAPER_RUN_FAILED',occurredAt:now(),subscriptionId:failed.subscriptionId??null}:null});
      }
      publish({status:stopped?'STOPPED':'IDLE',lastCompletedAt:now(),heartbeatAt:now()});
    }catch(error){publish({status:stopped?'STOPPED':'ERROR',lastFailure:safeFailure(error,now()),heartbeatAt:now()});}
  }
  function tick(){if(stopped)return Promise.resolve(false);if(inFlight)return inFlight;if(timer!==null)clearTimer(timer);timer=null;inFlight=work().finally(()=>{inFlight=null;if(!stopped){timer=setTimer(tick,intervalMs);timer?.unref?.();}});return inFlight;}
  return {
    start(){if(!stopped)return;stopped=false;publish({status:'STARTING',startedAt:now(),heartbeatAt:now()});beat();timer=setTimer(tick,0);timer?.unref?.();},
    tick,
    async stop(){stopped=true;if(timer!==null)clearTimer(timer);if(heartbeatTimer!==null)clearTimer(heartbeatTimer);await inFlight;publish({status:'STOPPED',heartbeatAt:now()});},
    async status(){return mindPaperRunnerStatus(env.DB,ownerId,await readOperationalWorkspace(repository,ownerId)??{}, {now:now()});}
  };
}
