import {createMindPaperRunner} from '../server/mind-paper-runner.mjs';
import {createEventPaperRunner} from '../server/event-paper-runner.mjs';
import {createEventAutomationRunner} from '../server/event-automation-runner.mjs';
import {listLiveAutomations} from '../server/live-automation-store.mjs';
import {createMonthlyPortfolioCandidateSource} from './monthly-portfolio-candidate-source.mjs';

const disabledStatus=()=>({status:'DISABLED',running:false,inFlight:false,heartbeatAt:null,lastTickAt:null,lastCompletedAt:null,lastError:null,policies:{}});
/** Host lifecycle only: inspection never constructs any execution loop. */
export function createPreviewRunners({env,processEnv=process.env,argv=process.argv,ownerId='local-preview-owner',url,factories={},approvedActivationIds=null}={}){
 env.READ_MANAGED_PORTFOLIO_CANDIDATE??=createMonthlyPortfolioCandidateSource();
 let runnersDisabled=processEnv.KEYNES_RUNNERS_DISABLED==='1'||argv.includes('--no-runners'),allowed=approvedActivationIds?new Set(approvedActivationIds):null;const paperRequested=processEnv.KEYNES_MIND_PAPER_RUNNER==='1'||argv.includes('--paper-runner');
 const paperRunner=!runnersDisabled&&paperRequested?(factories.paper??createMindPaperRunner)({env,ownerId,url}):null;
 const eventPaperRunner=paperRunner?(factories.eventPaper??createEventPaperRunner)({env,ownerId}):null;
 const live=()=> (factories.live??createEventAutomationRunner)({env,ownerId,...(allowed?{options:{listAutomations:async()=> (await listLiveAutomations({db:env.DB,owner:ownerId})).filter(p=>allowed.has(p.id))}}:{})});
 let eventRunner=!runnersDisabled?live():null;const runners=[paperRunner,eventPaperRunner,eventRunner];
 env.EVENT_PAPER_STATUS=()=>eventPaperRunner?.status()??disabledStatus();
 env.EVENT_AUTOMATION_STATUS=()=>eventRunner?.status()??disabledStatus();
 env.PREVIEW_RUNNER_STATUS=()=>({disabled:runnersDisabled,paper:{status:paperRunner?'CONFIGURED':'DISABLED'},eventPaper:env.EVENT_PAPER_STATUS(),live:env.EVENT_AUTOMATION_STATUS()});
 return {get runnersDisabled(){return runnersDisabled;},paperRunner,eventPaperRunner,get eventRunner(){return eventRunner;},runners,start(){paperRunner?.start();eventPaperRunner?.start();eventRunner?.start();},approvedIds:()=>allowed?[...allowed]:null,enableApprovedLive(ids){
  if(!Array.isArray(ids)||!ids.length||ids.some(id=>typeof id!=='string'||!id.startsWith('live-')))throw Error('APPROVED_ACTIVATIONS_REQUIRED');
  if(runnersDisabled)allowed??=new Set();for(const id of ids)allowed?.add(id);runnersDisabled=false;
  if(!eventRunner){eventRunner=live();runners[2]=eventRunner;}return eventRunner.start();
 }};
}
