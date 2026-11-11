import {normalizeOperationWindow} from '../domain/operation-window.mjs';
import {JEV_EXECUTION_CALL_LIMIT} from '../domain/jev-question.mjs';

export const AUTOMATION_CONTRACT_VERSION='automation-actions-v1';
export const EVENT_AUTOMATION_RUNNER_VERSION='canonical-live-event-runner-v27';
export function supportsLiveStrategyUpdate(version,{templateMode=false}={}){
 const match=/^canonical-live-event-runner-v([1-9]\d*)$/.exec(version??'');
 return Boolean(match&&Number(match[1])>=(templateMode?4:3)&&Number(match[1])<=Number(EVENT_AUTOMATION_RUNNER_VERSION.split('-v').at(-1)));
}
const base='/api/workspace/automated-trading',binding='server/automated-trading.mjs:handleAutomatedTradingAPI';
const freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};
const id={type:'string',minLength:1,maxLength:200,pattern:'^[a-zA-Z0-9][a-zA-Z0-9_.:@-]{0,199}$'},hash={type:'string',pattern:'^[a-f0-9]{64}$'};
const amount={type:'string',minLength:1,maxLength:90,pattern:'^(?=.*[1-9])\\d+(?:\\.\\d{1,18})?$'},budget={type:'integer',minimum:0,maximum:JEV_EXECUTION_CALL_LIMIT};
const entryLimit={type:'integer',minimum:0,maximum:10000,description:'0은 하루 매수 횟수 제한 없음'};
const object=(properties,required=[])=>({type:'object',properties,required,additionalProperties:false});
const define=(suffix,title,description,method,path,inputSchema,outputs,{tool=null,approval=false,idempotent=method==='GET',effects=[]}={})=>({
 id:'automation.trading.'+suffix,version:AUTOMATION_CONTRACT_VERSION,title,description,inputSchema:suffix==='strategy.update'?{...inputSchema,oneOf:[{required:['graph'],not:{anyOf:[{required:['targetManifestId']},{required:['targetManifestHash']}]}},{required:['targetManifestId','targetManifestHash'],not:{required:['graph']}}]}:inputSchema,
 inputs:inputSchema.required,optional_inputs:Object.keys(inputSchema.properties).filter(key=>!inputSchema.required.includes(key)),outputs,
 api:{method,path:base+path},implementation_binding:binding,enforcement:'SHARED_CONTRACT',capability_mode:method==='GET'?'read':'write',
 policy:approval?'APPROVAL_REQUIRED':method==='GET'?'AUTO':'AUDIT',approvalScope:approval?'STRATEGY_AND_LIMITS':'EXISTING_AUTHORIZATION',
 surfaces:tool?['ui','mcp']:['ui'],actors:['human'],runtime:['server'],status:'implemented',scope:'event-automation-v1',
 ...(tool?{mcp_tool:tool}:{}),idempotent,effects,provenance:{owner_registry:'dist/system/automation-contracts.mjs',source_file:'server/automated-trading.mjs'},
});
export const AUTOMATION_ACTIONS=freeze([
 define('reports.read','포트폴리오 운용보고서','원장과 판단에 연결된 시장·배분·주문·정산·성과·위험·비용 보고서를 조회합니다.','GET','/reports',object({reportId:id,activationId:id}),['items','report'],{tool:'read_portfolio_reports'}),
 define('reports.export','운용보고서 내보내기','저장된 보고서를 HTML 또는 체결·세무 CSV로 내려받습니다.','GET','/report-export',object({reportId:id,format:{type:'string',pattern:'^(html|csv)$'}},['reportId','format']),['report']),
 define('portfolio.read','통합 운용 설정 조회','같은 계좌의 저장된 통합 설정을 다시 열어 확인합니다.','GET','/portfolio',object({previewId:id}),['portfolioPlan'],{tool:'read_managed_portfolio'}),
 define('portfolio.prepare','계좌 통합 운용 설정','원화 계좌의 모든 마인드 배정과 잔여 현금을 하나의 3시간 학습 포트폴리오로 통합할 설정을 만듭니다.','POST','/portfolio/prepare',object({profileId:id,dailyLossLimit:amount},['profileId','dailyLossLimit']),['portfolioPlan','manifest'],{tool:'prepare_managed_portfolio',effects:['ACCOUNT_READ','POLICY_WRITE','PREVIEW_WRITE']}),
 define('portfolio.activate','통합 포트폴리오 시작','확인한 전체 자금과 전략으로 통합 운용을 시작하고 기존 분리 운용을 원자적으로 인계합니다. 이후 3시간 판단과 비중 변경은 자동 실행됩니다.','POST','/portfolio/activate',object({previewId:id,previewHash:hash,nonce:id,userAction:{const:'LIVE_PORTFOLIO_ACTIVATION'}},['previewId','previewHash','nonce','userAction']),['policy'],{tool:'activate_managed_portfolio',approval:true,idempotent:true,effects:['ACCOUNT_ALLOCATION_WRITE','AUTOMATIC_TRADING']}),
 define('allocation.prepare','두 모델 자금 배분 검토','중지한 운용의 남은 자금을 두 모델에 절반씩 배정할 승인안을 저장합니다.','POST','/allocation/prepare',object({sourceActivationId:id,leftProfileId:id,rightProfileId:id,evidence:{type:'object'}},['sourceActivationId','leftProfileId','rightProfileId']),['allocationPlan'],{effects:['PREVIEW_WRITE']}),
 define('allocation.activate','배분 승인 및 두 모델 시작','검토한 두 배정을 한 거래로 저장한 뒤 자동 운용을 시작합니다.','POST','/allocation/activate',object({previewId:id,previewHash:hash,nonce:id,userAction:{const:'LIVE_ALLOCATION_ACTIVATION'}},['previewId','previewHash','nonce','userAction']),['policies'],{approval:true,idempotent:true,effects:['ACCOUNT_ALLOCATION_WRITE','AUTOMATIC_TRADING']}),
 define('read','자동 운용 조회','고정 전략, 한도와 현재 운용 상태를 조회합니다.','GET','',object({profileId:id}),['policies','scope','connection'],{tool:'read_automated_trading'}),
 define('prepare','자동 운용 설정','전략, 계좌, 수수료와 운용 한도를 대조해 검토안을 준비합니다. 매수 횟수는 기본적으로 제한 없이 운용합니다.','POST','/prepare',object({profileId:id,capitalLimit:amount,perOrderLimit:amount,dailyLossLimit:amount,maxTradesPerDay:entryLimit,minIntervalMs:{type:'integer',minimum:0,maximum:86400000},maxJevCallsPerDay:budget,startsAt:{type:'string',format:'date-time'},endsAt:{type:'string',format:'date-time'},idempotencyKey:id},['profileId','capitalLimit','perOrderLimit','dailyLossLimit','minIntervalMs']),['preview','canActivate'],{tool:'prepare_automated_trading',effects:['ACCOUNT_READ','PREVIEW_WRITE']}),
 define('activate','실전 자동 운용 시작','검토한 전략과 한도에 대한 승인으로 봇을 활성화합니다. 이후 주문은 승인 범위에서 자동 실행됩니다.','POST','/activate',object({previewId:id,previewHash:hash,nonce:id,userAction:{const:'LIVE_AUTOMATION_ACTIVATION'}},['previewId','previewHash','nonce','userAction']),['policy'],{tool:'activate_automated_trading',approval:true,effects:['ACTIVATION_WRITE','AUTOMATIC_TRADING']}),
 define('stop','자동 운용 중지','추가 주문을 중지하고 보유 자산과 미확정 주문의 대사를 유지합니다.','POST','/stop',object({activationId:id},['activationId']),['policy'],{tool:'stop_automated_trading',idempotent:true,effects:['ACTIVATION_WRITE']}),
 define('resume','운용 재개','기존 전략·한도·보유·체결을 유지해 재개합니다. 잔고 차액이 있으면 화면에서 확인한 정확한 원금 조정액을 명시해야 합니다.','POST','/resume',object({activationId:id,expectedRevision:{type:'integer',minimum:0},idempotencyKey:id,cashAdjustment:{type:'string',pattern:'^-(?=.*[1-9])\\d+(?:\\.\\d{1,18})?$'},userAction:{const:'LIVE_AUTOMATION_RESUME'}},['activationId','expectedRevision','idempotencyKey','userAction']),['policy'],{tool:'resume_automated_trading',approval:true,idempotent:true,effects:['ACCOUNT_READ','ACCOUNT_ALLOCATION_WRITE','ACTIVATION_WRITE','AUTOMATIC_TRADING']}),
 define('capital.read','운용 자금 조회','현재 계좌의 가용 잔고와 다른 운용의 배정 및 예약을 대조해 최대 운용액을 조회합니다.','GET','/capital',object({activationId:id,profileId:id}),['capital'],{tool:'read_automated_trading_capital',effects:['ACCOUNT_READ']}),
 define('capital.update','운용 금액 변경','현재 운용의 금액과 주문 한도를 변경하고 보유 및 원장, 전략을 유지합니다. 매수 횟수 0은 제한 없이 운용합니다.','POST','/capital',object({activationId:id,expectedRevision:{type:'integer',minimum:0},capitalLimit:amount,perOrderLimit:amount,dailyLossLimit:amount,maxTradesPerDay:entryLimit,idempotencyKey:id,userAction:{const:'LIVE_CAPITAL_UPDATE'}},['activationId','expectedRevision','capitalLimit','perOrderLimit','dailyLossLimit','idempotencyKey','userAction']),['policy','capital'],{tool:'update_automated_trading_capital',approval:true,idempotent:true,effects:['ACCOUNT_ALLOCATION_WRITE','ACTIVATION_WRITE']}),
 define('orders','자동 주문 원장','주문 식별자, 체결 수량, 수수료와 대사 상태를 조회합니다.','GET','/orders',object({activationId:id},['activationId']),['activationId','items']),
 define('permission','주문 권한 확인','거래소 무거래 테스트로 주문 권한을 확인하고 원응답을 보존합니다.','POST','/permission-check',object({market:{type:'string',pattern:'^(KRW|BTC)-[A-Z0-9]+$'}},['market']),['connection','liveOrders'],{effects:['EXCHANGE_PERMISSION_TEST','EVIDENCE_WRITE']}),
 define('activity.read','운용 활동 조회','저장된 판단, 체결과 원장으로 운용 상태를 조회합니다.','GET','/activity',object({profileId:id,activationId:id}),['contractVersion','asOf','items'],{tool:'read_automated_trading_activity'}),
 define('strategy.read','운용 전략 조회','현재 실행기에 고정된 전략과 변경 요청의 반영 상태를 조회합니다.','GET','/strategy',object({activationId:id},['activationId']),['policy','manifest','strategyUpdates'],{tool:'read_automated_trading_strategy'}),
 define('strategy.update','운용 전략 변경','한 번 승인한 그래프를 검증, 저장, 발행하고 실행기 적용을 추적합니다. 기존 보유 자산과 총 배정액을 유지하고 1회 주문 한도를 함께 변경할 수 있습니다.','POST','/update-strategy',object({activationId:id,expectedGraphHash:hash,graph:{type:'object'},targetManifestId:id,targetManifestHash:hash,perOrderLimit:amount,maxJevCallsPerDay:budget,expectedRevision:{type:'integer',minimum:0},idempotencyKey:{...id,maxLength:120},userAction:{const:'LIVE_STRATEGY_UPDATE'}},['activationId','expectedGraphHash','idempotencyKey','userAction']),['policy','update'],{tool:'update_automated_trading_strategy',approval:true,idempotent:true,effects:['POLICY_WRITE','STRATEGY_UPDATE_QUEUE']}),
]);
export function automationAction(id){const action=AUTOMATION_ACTIONS.find(a=>a.id===id);if(!action)throw Error('UNKNOWN_AUTOMATION_ACTION: '+id);return action;}
export function automationTool(name){return AUTOMATION_ACTIONS.find(a=>a.mcp_tool===name)??null;}
export function automationRoute(method,path){return AUTOMATION_ACTIONS.find(a=>a.api.method===method&&a.api.path===path)??null;}
export function validAutomationInput(action,input){
 if(!input||typeof input!=='object'||Array.isArray(input)||![Object.prototype,null].includes(Object.getPrototypeOf(input)))return false;
 const schema=action.inputSchema;
 if(schema.required.some(key=>!Object.hasOwn(input,key))||Object.keys(input).some(key=>!Object.hasOwn(schema.properties,key)))return false;
 for(const [key,value]of Object.entries(input)){
  const rule=schema.properties[key];
  if(Object.hasOwn(rule,'const')&&value!==rule.const)return false;
  if(rule.type==='string'&&(typeof value!=='string'||rule.minLength!==undefined&&value.length<rule.minLength||rule.maxLength!==undefined&&value.length>rule.maxLength||rule.pattern&&!new RegExp(rule.pattern).test(value)))return false;
  if(rule.type==='integer'&&(!Number.isSafeInteger(value)||value<rule.minimum||rule.maximum!==undefined&&value>rule.maximum))return false;
  if(rule.type==='object'&&(!value||typeof value!=='object'||Array.isArray(value)||Object.getPrototypeOf(value)!==Object.prototype))return false;
 }
 try{normalizeOperationWindow(input);}catch{return false;}
 if(action.id==='automation.trading.capital.read')return Object.hasOwn(input,'activationId')!==Object.hasOwn(input,'profileId');
 if(action.id==='automation.trading.strategy.update')return Object.hasOwn(input,'targetManifestId')?!Object.hasOwn(input,'graph')&&Object.hasOwn(input,'targetManifestHash'):Object.hasOwn(input,'graph')&&!Object.hasOwn(input,'targetManifestHash');
 return true;
}
export function automationRequest(id,input={}){
 const action=automationAction(id);
 if(!validAutomationInput(action,input))throw Error('INVALID_AUTOMATION_INPUT: '+id);
 return {action,path:action.api.path+(action.api.method==='GET'&&Object.keys(input).length?'?'+new URLSearchParams(input):''),body:action.api.method==='POST'?input:undefined};
}
export function callAutomation(request,id,input={},options){const call=automationRequest(id,input);return request(call.path,call.body,options);}
export const EXCHANGE_CONNECTION_RECOVERY=Object.freeze({state:'WAIT_EXCHANGE_CONNECTION',retryMs:30000,codes:Object.freeze(['UPBIT_READ_NETWORK','SCALP_PUBLIC_NETWORK','UPBIT_READ_HTTP_502','UPBIT_READ_HTTP_503','SCALP_PUBLIC_HTTP_502','SCALP_PUBLIC_HTTP_503'])});
export const EXCHANGE_DATA_RECOVERY=Object.freeze({state:'WAIT_MARKET_DATA',codes:Object.freeze(['SCALP_PUBLIC_HTTP_429','LIVE_RUNNER_BOOK_TIME','HOURLY_VALUE_FRESH_FRAME_REQUIRED','HOURLY_VALUE_OWN_FRAME_REQUIRED'])});
