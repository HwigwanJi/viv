import {researchSha256} from '../dist/domain/research.mjs';
const encode=value=>new TextEncoder().encode(value),plain=v=>v&&typeof v==='object'&&!Array.isArray(v),finite=Number.isFinite;
function scrub(text,env){for(const [key,value] of Object.entries(env??{}))if(/key|secret|token|passphrase/i.test(key)&&typeof value==='string'&&value.length)text=text.split(value).join('[redacted]');return text;}
export function choiceValidationDiagnostics(request,response){
 const diagnostics=[];if(!plain(request?.questions)||!plain(response?.answers))return [{code:'RESPONSE_STRUCTURE_UNAVAILABLE'}];
 for(const [question,q] of Object.entries(request.questions)){
  const a=response.answers[question],expectedKeys=Object.keys(q.criteria??{}),actualKeys=plain(a?.probabilities)?Object.keys(a.probabilities):null,probabilities=actualKeys?Object.values(a.probabilities):null,allFinite=probabilities?.every(finite)??false,sum=allFinite?probabilities.reduce((n,p)=>n+p,0):null,max=allFinite?Math.max(...probabilities):null,chosen=plain(a?.probabilities)&&finite(a.probabilities[a.choice])?a.probabilities[a.choice]:null,reasons=[];
  if(!plain(a))reasons.push('ANSWER_MISSING');else{if(a.type!=='choice')reasons.push('ANSWER_TYPE');if(!expectedKeys.includes(a.choice))reasons.push('CHOICE_KEY');if(!finite(a.confidence)||a.confidence<0||a.confidence>1)reasons.push('CONFIDENCE_RANGE');if(a.probabilities!==undefined){if(!actualKeys||actualKeys.length!==expectedKeys.length||expectedKeys.some(k=>!actualKeys.includes(k)))reasons.push('PROBABILITY_KEYS');if(!allFinite||probabilities.some(p=>p<0||p>1))reasons.push('PROBABILITY_RANGE');if(sum!==null&&Math.abs(sum-1)>.005)reasons.push('PROBABILITY_SUM');if(chosen!==null&&max!==null&&chosen+1e-8<max)reasons.push('CHOICE_NOT_MAXIMUM');}}
  if(reasons.length)diagnostics.push({question,reasons,choice:typeof a?.choice==='string'?a.choice:null,expectedKeys,actualKeys,sum,maximumProbability:max,chosenProbability:chosen,sumTolerance:.005,maximumTolerance:1e-8});
 }
 return diagnostics;
}
function boundedText(text,maxBytes,format){const bytes=encode(text);let kept=bytes.slice(0,Math.max(0,maxBytes)),prefix='';for(let i=0;i<4;i++){try{prefix=new TextDecoder('utf-8',{fatal:true}).decode(kept);break;}catch{kept=kept.slice(0,-1);}}const chunks=[];for(let i=0;i<prefix.length;i+=12000)chunks.push(prefix.slice(i,i+12000));return {format,hashContract:'SANITIZED_SOURCE_UTF8_SHA256_V1',sha256:researchSha256(text),byteCount:bytes.length,retainedByteCount:encode(prefix).length,retention:kept.length===bytes.length?'FULL':kept.length?'PREFIX':'HASH_ONLY',jsonChunks:chunks};}

/** Preserve the actual request/failure evidence; absent response bytes stay absent. */
export function captureMindProviderFailure(error,{attemptKey=null,now,env={},maxBytes=64000}={}){
 if(!error?.provider&&!error?.rawRequest&&!error?.rawResponse&&!error?.rawResponseText)return null;
 const unavailable=['NOT_RECEIVED','NOT_RETAINED'].includes(error.responseAvailability)?error.responseAvailability:null,hasResponse=!unavailable&&(typeof error.rawResponseText==='string'||Object.hasOwn(error,'rawResponse')&&error.rawResponse!==undefined),requestText=error.rawRequest===undefined?null:scrub(JSON.stringify(error.rawRequest),env),responseText=hasResponse?scrub(typeof error.rawResponseText==='string'?error.rawResponseText:JSON.stringify(error.rawResponse),env):null,responseFormat=typeof error.rawResponseText==='string'?'PROVIDER_RESPONSE_TEXT':'JSON',budget=Math.max(0,Math.min(96000,maxBytes));
 const record={schemaVersion:1,attemptKey,code:typeof error.code==='string'?error.code.slice(0,100):'MIND_JEV_FAILED',recordedAt:now,provider:error.provider?JSON.parse(scrub(JSON.stringify(error.provider),env)):null,responseAvailability:hasResponse?'RECEIVED':unavailable??'NOT_RECEIVED',validationDiagnostics:hasResponse?choiceValidationDiagnostics(error.rawRequest,error.rawResponse):[{code:unavailable==='NOT_RETAINED'?'RESPONSE_BODY_NOT_RETAINED':'RESPONSE_NOT_RECEIVED'}],request:requestText===null?null:boundedText(requestText,0,'JSON'),response:responseText===null?null:boundedText(responseText,0,responseFormat)};
 const overhead=encode(JSON.stringify(record)).length,room=Math.max(0,budget-overhead-1000),responseRoom=responseText===null?0:Math.min(encode(responseText).length,Math.floor(room*.6)),requestRoom=Math.max(0,room-responseRoom);
 if(requestText!==null)record.request=boundedText(requestText,requestRoom,'JSON');if(responseText!==null)record.response=boundedText(responseText,responseRoom,responseFormat);
 // JSON escaping can expand a retained prefix. Preserve the provider's reason
 // first, then fit the request prefix to the remaining serialized byte budget.
 let requestLimit=requestRoom,responseLimit=responseRoom;
 while(encode(JSON.stringify(record)).length>budget&&(requestLimit||responseLimit)){
  if(requestLimit){requestLimit=Math.floor(requestLimit/2);record.request=boundedText(requestText,requestLimit,'JSON');}
  else {responseLimit=Math.floor(responseLimit/2);record.response=boundedText(responseText,responseLimit,responseFormat);}
 }
 return record;
}
