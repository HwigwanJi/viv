export const JEV_EXECUTION_CALL_LIMIT=10000;
/** General JEV primitives. This contract produces typed values for graph consumers. */
export const JEV_QUESTION_CONTRACT='jev-question-v1';
export const JEV_ANSWER_CONTRACT='jev-question-answer-v1';
export const JEV_RESPONSE_CONTRACT='jev-question-response-v1';
export const JEV_QUESTION_VALIDATION_POLICY='jev-primitives-rounded-2dp-v1';
export const JEV_QUESTION_TYPES=Object.freeze(['choice','score','noul']);
// Application bounds; the provider itself accepts a request body up to 32 MiB.
export const JEV_QUESTION_LIMITS=Object.freeze({questions:32,candidates:255,scoreLevels:10,depth:64,requestBytes:2000000,responseBytes:2000000});
const clone=structuredClone,plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&[Object.prototype,null].includes(Object.getPrototypeOf(value));
const finite=value=>typeof value==='number'&&Number.isFinite(value),ratio=value=>finite(value)&&value>=0&&value<=1;
const forbidden=new Set(['__proto__','constructor','prototype']);
const id=value=>typeof value==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9_.:@/-]{0,199}$/.test(value)&&!forbidden.has(value);
const exact=(value,required,optional=[])=>plain(value)&&required.every(key=>Object.hasOwn(value,key))&&Object.keys(value).every(key=>required.includes(key)||optional.includes(key));
const bytes=value=>new TextEncoder().encode(value).length;
export class JevQuestionError extends TypeError{constructor(code,message,status=400){super(message);this.name='JevQuestionError';this.code=code;this.status=status;}}
const check=(condition,code,message,status)=>{if(!condition)throw new JevQuestionError(code,message,status);};

export function assertJevQuestionData(value,{maximumBytes=JEV_QUESTION_LIMITS.requestBytes}={}){
 const seen=new WeakSet();
 function visit(item,depth){
  if(depth>JEV_QUESTION_LIMITS.depth)return false;
  if(item===null||typeof item==='boolean'||finite(item))return true;
  if(typeof item==='string'){check(item.length<=maximumBytes,'JEV_QUESTION_SIZE','질문과 연결 자료의 크기를 줄여 주세요.');return true;}
  if(!Array.isArray(item)&&!plain(item)||seen.has(item))return false;
  seen.add(item);const descriptors=Object.getOwnPropertyDescriptors(item),keys=Reflect.ownKeys(descriptors);
  const valid=keys.every(key=>typeof key==='string'&&!forbidden.has(key)&&Object.hasOwn(descriptors[key],'value')&&(Array.isArray(item)&&key==='length'||descriptors[key].enumerable&&visit(descriptors[key].value,depth+1)))&&(!Array.isArray(item)||keys.length===item.length+1);
  seen.delete(item);return valid;
 }
 check(visit(value,0),'JEV_QUESTION_DATA','문자열과 유효한 JSON 값을 사용하세요.');
 check(bytes(JSON.stringify(value))<=maximumBytes,'JEV_QUESTION_SIZE','질문과 연결 자료의 크기를 줄여 주세요.');return value;
}
const entry=value=>value===null||typeof value==='string'||Array.isArray(value)||plain(value);
export function assertJevQuestionModel(model){check(typeof model==='string'&&/^jev-(?:latest|preview|\d+\.\d+\.\d+)$/.test(model),'JEV_QUESTION_MODEL','JEV 모델 별칭 또는 버전을 지정하세요.');return model;}

export function assertJevQuestion(question){
 assertJevQuestionData(question);
 const type=question?.type,required=['schemaVersion','contractVersion','id','type','instructions',...(type==='choice'?['candidates']:type==='score'?['levels']:[])];
 check(exact(question,required,type==='noul'?['criteria']:[])&&question.schemaVersion===1&&question.contractVersion===JEV_QUESTION_CONTRACT&&id(question.id)&&JEV_QUESTION_TYPES.includes(type)&&entry(question.instructions),'JEV_QUESTION_SCHEMA','질문 종류·고유 ID·지침을 확인하세요.');
 if(type==='choice'||type==='score'){
  const values=type==='choice'?question.candidates:question.levels,max=type==='choice'?JEV_QUESTION_LIMITS.candidates:JEV_QUESTION_LIMITS.scoreLevels;
  check(Array.isArray(values)&&values.length>=2&&values.length<=max&&new Set(values.map(value=>value?.id)).size===values.length&&values.every(value=>exact(value,['id','description'],['label'])&&id(value.id)&&entry(value.description)&&(!Object.hasOwn(value,'label')||typeof value.label==='string'&&value.label.trim().length>0&&value.label.length<=200)),'JEV_QUESTION_CRITERIA','서로 다른 후보 ID와 설명을 지정하세요. 점수 등급은 낮은 순서로 배치하세요.');
 }else if(Object.hasOwn(question,'criteria'))check(exact(question.criteria,['true','false'])&&entry(question.criteria.true)&&entry(question.criteria.false),'JEV_QUESTION_CRITERIA','예와 아니오의 기준을 각각 지정하세요.');
 return question;
}
function assertQuestions(questions){assertJevQuestionData(questions);check(Array.isArray(questions)&&questions.length>0&&questions.length<=JEV_QUESTION_LIMITS.questions,'JEV_QUESTION_LIST','실행할 질문을 선택하세요.');questions.forEach(assertJevQuestion);check(new Set(questions.map(q=>q.id)).size===questions.length,'JEV_QUESTION_ID','질문 ID를 서로 다르게 지정하세요.');return questions;}
const description=item=>Object.hasOwn(item,'label')?{label:item.label,description:clone(item.description)}:clone(item.description);

export function buildJevQuestionRequest({model='jev-latest',state,questions}={}){
 assertJevQuestionModel(model);assertJevQuestionData(state);check(typeof state==='string'||Array.isArray(state)||plain(state),'JEV_QUESTION_STATE','평가할 텍스트 또는 JSON 자료를 연결하세요.');assertQuestions(questions);
 const request={model,state:clone(state),questions:Object.fromEntries(questions.map(question=>[question.id,{type:question.type,instructions:clone(question.instructions),...(question.type==='choice'?{criteria:Object.fromEntries(question.candidates.map(candidate=>[candidate.id,description(candidate)]))}:question.type==='score'?{criteria:question.levels.map(description)}:Object.hasOwn(question,'criteria')?{criteria:clone(question.criteria)}:{})}]))};
 assertJevQuestionData(request);return request;
}

export function inspectJevQuestionProbabilities(probabilities){
 assertJevQuestionData(probabilities,{maximumBytes:JEV_QUESTION_LIMITS.responseBytes});
 const values=plain(probabilities)?Object.values(probabilities):[];
 check(values.length>0&&values.every(ratio),'JEV_QUESTION_DISTRIBUTION','각 후보의 확률을 0~1 범위로 확인하세요.');
 const rawSum=values.reduce((sum,value)=>sum+value,0),strict=Math.abs(rawSum-1)<=.005,grid=values.every(value=>Math.abs(value-Math.round(value*100)/100)<=1e-10),integerSum=values.reduce((sum,value)=>sum+Math.round(value*100),0),lower=values.reduce((sum,value)=>sum+Math.max(0,value-.005),0),upper=values.reduce((sum,value)=>sum+Math.min(1,value+.005),0),rounded=grid&&[99,101].includes(integerSum)&&Math.abs(rawSum-1)<=.01+1e-10&&lower<=1+1e-10&&upper>=1-1e-10;
 check(strict||rounded,'JEV_QUESTION_DISTRIBUTION','확률 합계와 반올림 정밀도를 확인하세요.');
 return {policyVersion:JEV_QUESTION_VALIDATION_POLICY,acceptedBy:strict?'STRICT_SUM':'ROUNDED_2DP',rawSum,roundingGrid:grid?.01:null,integerSum,possibleSum:{lower,upper},normalization:'NONE'};
}

const canonical=value=>Array.isArray(value)?'['+value.map(canonical).join(',')+']':plain(value)?'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}':JSON.stringify(value);
const matchesKeys=(object,keys)=>plain(object)&&Object.keys(object).length===keys.length&&keys.every(key=>Object.hasOwn(object,key));
function scoreExpectation(score,probabilities,distribution){
 const values=Object.values(probabilities),weightedSum=values.reduce((sum,value,index)=>sum+value*index,0),delta=score-weightedSum;
 if(Math.abs(delta)<=.005+1e-10)return {acceptedBy:'STRICT_EXPECTATION',rawWeightedSum:weightedSum,delta,tolerance:.005,normalization:'NONE'};
 const scoreOnGrid=Math.abs(score-Math.round(score*100)/100)<=1e-10;
 check(distribution.roundingGrid===.01&&scoreOnGrid,'JEV_QUESTION_SCORE','점수와 등급별 확률의 대응을 확인하세요.');
 function bound(descending){const low=values.map(value=>Math.max(0,value-.005)),high=values.map(value=>Math.min(1,value+.005));let remaining=1-low.reduce((sum,value)=>sum+value,0),result=low.reduce((sum,value,index)=>sum+index*value,0);const order=values.map((_,i)=>i);if(descending)order.reverse();for(const index of order){const add=Math.min(Math.max(0,remaining),high[index]-low[index]);result+=index*add;remaining-=add;}return result;}
 const lower=bound(false),upper=bound(true),scoreLower=Math.max(0,score-.005),scoreUpper=Math.min(values.length-1,score+.005);
 check(scoreUpper>=lower-1e-10&&scoreLower<=upper+1e-10,'JEV_QUESTION_SCORE','점수와 등급별 확률의 대응을 확인하세요.');
 return {acceptedBy:'ROUNDED_EXPECTATION_2DP',rawWeightedSum:weightedSum,delta,possibleExpectation:{lower,upper},possibleScore:{lower:scoreLower,upper:scoreUpper},normalization:'NONE'};
}

export function inspectJevQuestionAnswer(answer,question){
 assertJevQuestion(question);assertJevQuestionData(answer,{maximumBytes:JEV_QUESTION_LIMITS.responseBytes});
 const type=question.type,base={contractVersion:JEV_ANSWER_CONTRACT,questionId:question.id,type};
 if(type==='noul'){
  check(exact(answer,['type','noul'])&&answer.type===type&&ratio(answer.noul),'JEV_QUESTION_NOUL','예 확률을 0~1 범위로 확인하세요.');
  return {...base,value:answer.noul,validation:{policyVersion:JEV_QUESTION_VALIDATION_POLICY,valueKind:'YES_PROBABILITY',normalization:'NONE'}};
 }
 check(exact(answer,type==='choice'?['type','choice','probabilities','confidence']:['type','score','legend','probabilities','confidence'])&&answer.type===type&&ratio(answer.confidence),'JEV_QUESTION_ANSWER','질문 종류와 응답 형식·확신도를 확인하세요.');
 const keys=type==='choice'?question.candidates.map(candidate=>candidate.id):question.levels.map((_,index)=>String(index));
 check(matchesKeys(answer.probabilities,keys),'JEV_QUESTION_DISTRIBUTION','원래 후보와 응답의 확률 목록을 대조하세요.');
 const distribution=inspectJevQuestionProbabilities(answer.probabilities);
 if(type==='choice'){
  check(keys.includes(answer.choice)&&answer.probabilities[answer.choice]>=Math.max(...Object.values(answer.probabilities))-1e-10,'JEV_QUESTION_CHOICE','응답이 원래 후보 중 최고 확률을 선택했는지 확인하세요.');
  return {...base,value:answer.choice,probabilities:clone(answer.probabilities),confidence:answer.confidence,validation:{policyVersion:JEV_QUESTION_VALIDATION_POLICY,distribution,normalization:'NONE'}};
 }
 check(finite(answer.score)&&answer.score>=0&&answer.score<=question.levels.length-1&&matchesKeys(answer.legend,keys)&&question.levels.every((level,index)=>canonical(answer.legend[String(index)])===canonical(description(level))),'JEV_QUESTION_SCORE','점수 범위와 원래 등급 설명을 대조하세요.');
 const ordered=Object.fromEntries(keys.map(key=>[key,answer.probabilities[key]])),expectation=scoreExpectation(answer.score,ordered,distribution);
 return {...base,value:answer.score,probabilities:Object.fromEntries(question.levels.map((level,index)=>[level.id,answer.probabilities[String(index)]])),confidence:answer.confidence,scale:{minimum:0,maximum:question.levels.length-1,levels:question.levels.map((level,index)=>({id:level.id,index}))},validation:{policyVersion:JEV_QUESTION_VALIDATION_POLICY,distribution,expectation,normalization:'NONE'}};
}

export function inspectJevQuestionResponse(raw,questions,{requestedModel='jev-latest'}={}){
 assertQuestions(questions);assertJevQuestionModel(requestedModel);assertJevQuestionData(raw,{maximumBytes:JEV_QUESTION_LIMITS.responseBytes});
 check(exact(raw,['model','answers','usage'])&&typeof raw.model==='string'&&/^jev-\d+\.\d+\.\d+$/.test(raw.model)&&(['jev-latest','jev-preview'].includes(requestedModel)||raw.model===requestedModel)&&matchesKeys(raw.answers,questions.map(q=>q.id)),'JEV_QUESTION_RESPONSE','실제 모델 버전과 질문별 응답을 대조하세요.');
 check(exact(raw.usage,['input_tokens','output_tokens'])&&Object.values(raw.usage).every(value=>Number.isSafeInteger(value)&&value>=0),'JEV_QUESTION_USAGE','공급자가 반환한 토큰 사용량을 확인하세요.');
 return {contractVersion:JEV_RESPONSE_CONTRACT,model:raw.model,answers:Object.fromEntries(questions.map(question=>[question.id,inspectJevQuestionAnswer(raw.answers[question.id],question)])),usage:clone(raw.usage),validation:{policyVersion:JEV_QUESTION_VALIDATION_POLICY,normalization:'NONE'}};
}
