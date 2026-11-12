import {handleOntologyValidationAPI} from './strategy-ontology-api.mjs';
import {handleHourlyLearningAPI} from './hourly-model-learning.mjs';
import {capabilityManifest} from '../dist/system/registry.mjs';
import {handleAppNotificationsAPI} from './app-notifications.mjs';
import {handlePaperAdaptationAPI} from './paper-adaptation.mjs';
import {handleEventPaperAPI} from './event-paper-api.mjs';
import {handleAutomatedTradingAPI} from './automated-trading.mjs';
import {handleBrokerAPI} from './broker-accounts.mjs';
import {handleStrategyLearningAPI} from './strategy-learning.mjs';
import {handleVampModelAPI} from './vamp-model-api.mjs';
import {handleWorkspaceCalendar} from './workspace-calendar.mjs';
import {handleHomeAPI} from './home-api.mjs';
import {handleHomeMarketAPI} from './home-market.mjs';
import {handleWorkspaceReset} from './workspace-reset.mjs';
import { JEV_MODEL } from '../dist/trading/jev.mjs';
import { handleWorkspaceAPI } from './workspace-api.mjs';
import { handleMindStudioAPI } from './mind-studio.mjs';
const json = (value, status = 200) => Response.json(value, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });

export async function handleAPI(request, env = {}, { fetchImpl = fetch, now = () => Date.now() } = {}) {
  const url = new URL(request.url);
  if(url.pathname==='/api/strategy-ontology/validate')return handleOntologyValidationAPI(request);
  if(url.pathname==='/api/app-notifications'||url.pathname.startsWith('/api/app-notifications/'))return handleAppNotificationsAPI(request,env);
  if(url.pathname==='/api/capabilities'){
    if(!request.headers.get('oai-authenticated-user-id'))return json({ok:false,code:'UNAUTHORIZED',message:'로그인이 필요합니다.'},401);
    if(request.method!=='GET')return json({ok:false,code:'METHOD',message:'조회 요청을 확인하세요.'},405);
    if(url.search)return json({ok:false,code:'INPUT',message:'조회 입력을 확인하세요.'},400);
    return json({ok:true,manifest:capabilityManifest()});
  }
  if(url.pathname.startsWith('/api/workspace/hourly-learning'))return handleHourlyLearningAPI(request,env,{fetchImpl,now});
  if(url.pathname==='/api/workspace/calendar')return handleWorkspaceCalendar(request,env,now);
  if(url.pathname.startsWith('/api/workspace/event-paper'))return handleEventPaperAPI(request,env,{fetchImpl,now});
  if(url.pathname.startsWith('/api/workspace/automated-trading'))return handleAutomatedTradingAPI(request,env,{fetchImpl,now});
  if(url.pathname.startsWith('/api/workspace/paper-adaptation'))return handlePaperAdaptationAPI(request,env,{fetchImpl,now});
  if(url.pathname==='/api/workspace/reset')return handleWorkspaceReset(request,env,{fetchImpl,now});
  if(url.pathname.startsWith('/api/workspace/strategy-learning/vamp/'))return handleVampModelAPI(request,env,{fetchImpl,now});
  if(url.pathname.startsWith('/api/workspace/strategy-learning'))return handleStrategyLearningAPI(request,env,{fetchImpl,now});
  if(url.pathname==='/api/workspace/home-performance')return handleHomeAPI(request,env,{fetchImpl,now});
  if(url.pathname==='/api/workspace/home-market'||url.pathname.startsWith('/api/workspace/home-market/'))return handleHomeMarketAPI(request,env,{fetchImpl,now});
  if(url.pathname.startsWith('/api/workspace/brokers'))return handleBrokerAPI(request,env,{fetchImpl,now});
  if (url.pathname.startsWith('/api/workspace')) return await handleMindStudioAPI(request,env,{fetchImpl,now}) ?? handleWorkspaceAPI(request,env,{fetchImpl,now});
  if (url.pathname === '/api/status' && request.method === 'GET') return json({ mode:'paper', jev:{ configured:Boolean(env.TYPESAFE_API_KEY), model:JEV_MODEL }, storage:'server',...(typeof env.BROKERAGE_REPORT_STATUS==='function'?{reporting:env.BROKERAGE_REPORT_STATUS()}:{}),...(typeof env.PREVIEW_RUNNER_STATUS==='function'?{runners:env.PREVIEW_RUNNER_STATUS()}:{}) });
  if (['/api/jev','/api/quotes'].includes(url.pathname)) {
    if (!request.headers.get('oai-authenticated-user-id')) return json({ok:false,code:'UNAUTHORIZED',message:'로그인이 필요합니다.'},401);
    if (request.headers.get('Origin') && request.headers.get('Origin') !== url.origin || request.headers.get('Sec-Fetch-Site') === 'cross-site') return json({ok:false,code:'ORIGIN',message:'앱에서 다시 실행하세요.'},403);
    return json({ok:false,code:'CANONICAL_ENDPOINT_REQUIRED',message:'트레이딩 화면에서 종목과 마인드를 선택해 실행하세요.',replacement:url.pathname === '/api/jev' ? '/api/workspace/terminal/evaluate' : '/api/workspace/terminal'},410);
  }
  return json({ok:false,message:'요청 경로를 확인하세요.'},404);
}
