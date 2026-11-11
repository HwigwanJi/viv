import {createHash,randomUUID} from 'node:crypto';
import {buildJevQuestionRequest,inspectJevQuestionResponse,JEV_QUESTION_LIMITS,JevQuestionError} from '../dist/domain/jev-question.mjs';

export const JEV_QUESTION_ENDPOINT='https://api.typesafe.ai/v1/systemone';
export const JEV_QUESTION_TIMEOUT_MS=90000;
const hash=text=>createHash('sha256').update(text).digest('hex');
const safeText=(value,secret)=>String(value).split(JSON.stringify(secret).slice(1,-1)).join('[redacted]').split(secret).join('[redacted]');
const containsSecret=(value,secret)=>typeof value==='string'?value.includes(secret):Array.isArray(value)?value.some(item=>containsSecret(item,secret)):value&&typeof value==='object'?Object.entries(value).some(([key,item])=>key.includes(secret)||containsSecret(item,secret)):false;
const now=clock=>new Date(clock()).toISOString();
async function readBody(response){
 if(!response.body?.getReader){const value=await response.text();if(Buffer.byteLength(value)>JEV_QUESTION_LIMITS.responseBytes)throw new JevQuestionError('JEV_QUESTION_RESPONSE_SIZE','JEV 응답 크기를 확인하세요.',502);return value;}
 const reader=response.body.getReader(),chunks=[];let size=0;
 try{while(true){const item=await reader.read();if(item.done)break;size+=item.value.byteLength;if(size>JEV_QUESTION_LIMITS.responseBytes){await reader.cancel();throw new JevQuestionError('JEV_QUESTION_RESPONSE_SIZE','JEV 응답 크기를 확인하세요.',502);}chunks.push(item.value);}}catch(error){error.receivedBodyBytes=size;error.partialResponseText=new TextDecoder().decode(Buffer.concat(chunks));throw error;}finally{reader.releaseLock?.();}
 return new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks));
}

/** Server-only transport. One explicit call, no retries and no trading actions. */
export async function callJevQuestions({model='jev-latest',state,questions,env={},fetchImpl=fetch,clock=()=>new Date().toISOString()}={}){
 const request=buildJevQuestionRequest({model,state,questions}),secret=typeof env.TYPESAFE_API_KEY==='string'?env.TYPESAFE_API_KEY.trim():'';
 if(!secret||/[\s\u0000-\u001f]/.test(secret))throw new JevQuestionError('JEV_CONNECTION_REQUIRED','서버의 JEV 연결을 설정하세요.',409);
 const requestText=JSON.stringify(request);
 if(containsSecret(request,secret))throw new JevQuestionError('JEV_QUESTION_SECRET_IN_INPUT','연결 자료에서 서버 인증 값을 제거하세요.');
 const canonicalQuestions=structuredClone(questions),rawRequest=structuredClone(request),rawRequestHash=hash(requestText),started=Date.now();
 const configuredTimeout=Number(env.JEV_QUESTION_TIMEOUT_MS??JEV_QUESTION_TIMEOUT_MS),timeoutMs=Number.isInteger(configuredTimeout)&&configuredTimeout>=20000&&configuredTimeout<=120000?configuredTimeout:JEV_QUESTION_TIMEOUT_MS;
 const provider={endpoint:JEV_QUESTION_ENDPOINT,requestId:randomUUID(),requestedModel:model,model:null,startedAt:now(clock),responseReceivedAt:null,answeredAt:null,providerRequestId:null,httpStatus:null,latencyMs:null,usage:null,attempts:1,timeoutMs,responseBodyBytes:0};
 let response,rawResponse=null,rawResponseText=null,rawResponseHash=null,receivedResponseHash=null;
 const fail=(code,message,status=502)=>{const error=new JevQuestionError(code,message,status);error.provider={...provider,latencyMs:Math.max(0,Date.now()-started),failedAt:now(clock)};error.rawRequest=rawRequest;error.rawRequestHash=rawRequestHash;error.rawResponse=rawResponse;error.rawResponseText=rawResponseText;error.rawResponseHash=rawResponseHash;error.receivedResponseHash=receivedResponseHash;error.hashContract='SHA256_UTF8_EXACT_REQUEST_AND_RETAINED_RESPONSE_V1';error.responseAvailability=rawResponseText===null?'NOT_RETAINED':'RETAINED';return error;};
 try{response=await fetchImpl(JEV_QUESTION_ENDPOINT,{method:'POST',headers:{Authorization:'Bearer '+secret,'Content-Type':'application/json'},body:requestText,redirect:'manual',signal:AbortSignal.timeout(timeoutMs)});}catch{const error=fail('JEV_QUESTION_NETWORK','JEV 연결을 완료하지 못했습니다. 연결 상태와 재시도 시각을 확인하세요.');error.responseAvailability='NOT_RECEIVED';throw error;}
 provider.httpStatus=response.status;provider.providerRequestId=response.headers?.get?.('x-request-id')?safeText(response.headers.get('x-request-id').slice(0,200),secret):null;
 let body;
 try{body=await readBody(response);}catch(error){provider.responseBodyBytes=Number.isSafeInteger(error.receivedBodyBytes)?error.receivedBodyBytes:null;if(error.partialResponseText){rawResponseText=safeText(error.partialResponseText,secret);rawResponseHash=hash(rawResponseText);}throw fail(error.code==='JEV_QUESTION_RESPONSE_SIZE'?error.code:'JEV_QUESTION_RESPONSE_READ',error.code==='JEV_QUESTION_RESPONSE_SIZE'?'JEV 응답 크기를 확인하세요.':'JEV 응답 본문을 끝까지 수신하지 못했습니다.');}
 provider.responseBodyBytes=Buffer.byteLength(body);
 provider.responseReceivedAt=now(clock);receivedResponseHash=hash(body);rawResponseText=safeText(body,secret);rawResponseHash=hash(rawResponseText);provider.redactionApplied=rawResponseText!==body;
 if(!response.ok){rawResponse={httpStatus:response.status,body:rawResponseText};throw fail('JEV_QUESTION_HTTP','JEV 요청을 완료하지 못했습니다. ('+response.status+')');}
 try{rawResponse=JSON.parse(rawResponseText);}catch{throw fail('JEV_QUESTION_RESPONSE_JSON','JEV 응답 JSON 형식을 확인하세요.');}
 if(typeof rawResponse?.model==='string'&&/^jev-\d+\.\d+\.\d+$/.test(rawResponse.model))provider.model=rawResponse.model;
 if(rawResponse?.usage&&['input_tokens','output_tokens'].every(key=>Number.isSafeInteger(rawResponse.usage[key])&&rawResponse.usage[key]>=0))provider.usage=Object.fromEntries(['input_tokens','output_tokens'].map(key=>[key,rawResponse.usage[key]]));
 let inspected;
 try{inspected=inspectJevQuestionResponse(rawResponse,canonicalQuestions,{requestedModel:model});}catch(error){throw fail(error.code??'JEV_QUESTION_RESPONSE',error instanceof JevQuestionError?error.message:'JEV 응답 형식을 확인하세요.');}
 provider.model=inspected.model;provider.usage=structuredClone(inspected.usage);provider.responseValidation=structuredClone(inspected.validation);provider.answeredAt=now(clock);provider.latencyMs=Math.max(0,Date.now()-started);
 return {...inspected,rawRequest,rawResponse,rawResponseText,rawRequestHash,rawResponseHash,receivedResponseHash,hashContract:'SHA256_UTF8_EXACT_REQUEST_AND_RETAINED_RESPONSE_V1',provider};
}
