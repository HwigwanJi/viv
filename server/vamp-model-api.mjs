import {fitVampModel,validateVampModel,assertVampModel} from '../dist/domain/vamp-model.mjs';
import {hashInputPackage} from '../dist/domain/workspace.mjs';
import {getEventDataset,listEventDatasets} from './event-market-datasets.mjs';
const BASE='/api/workspace/strategy-learning/vamp',json=(v,status=200)=>Response.json(v,{status,headers:{'Cache-Control':'no-store'}});
const check=(ok,code,message,status=400)=>{if(!ok)throw Object.assign(new Error(message),{code,status});};
function checkedRun(run){assertVampModel(run.model);const {hash,...body}=run.validation;check(hash===hashInputPackage(body)&&body.modelHash===run.model.hash,'VAMP_VALIDATION_HASH','저장된 모델과 검증 기록을 대조하세요.',409);return run;}
export async function handleVampModelAPI(request,env={},options={}){
 const url=new URL(request.url),owner=options.ownerId??request.headers.get('oai-authenticated-user-id');if(!owner)return json({ok:false,code:'UNAUTHORIZED',message:'로그인이 필요합니다.'},401);
 if(request.headers.get('Origin')&&request.headers.get('Origin')!==url.origin||request.headers.get('Sec-Fetch-Site')==='cross-site')return json({ok:false,code:'ORIGIN',message:'앱에서 다시 실행하세요.'},403);
 try{
  const db=env.DB?.withSession?env.DB.withSession('first-primary'):env.DB;check(db,'VAMP_STORAGE','학습 기록 저장소가 필요합니다.',503);
  await db.prepare('CREATE TABLE IF NOT EXISTS vamp_model_runs (owner_id TEXT NOT NULL,id TEXT NOT NULL,fingerprint TEXT NOT NULL,payload TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(owner_id,id))').bind().run();
  if(request.method==='GET'&&url.pathname===BASE+'/catalog')return json({ok:true,datasets:await listEventDatasets({...options,env}),method:'VAMP_RIDGE',horizonMs:60000,authority:'PAPER_RESEARCH_ONLY'});
  if(request.method==='GET'&&url.pathname===BASE+'/item'){const modelHash=url.searchParams.get('modelHash');if(modelHash)check(/^[a-f0-9]{64}$/.test(modelHash),'VAMP_MODEL_HASH','모델 식별값을 확인하세요.');const row=await db.prepare(modelHash?"SELECT payload FROM vamp_model_runs WHERE owner_id=? AND json_extract(payload,'$.model.hash')=? ORDER BY created_at DESC LIMIT 1":'SELECT payload FROM vamp_model_runs WHERE owner_id=? AND id=?').bind(owner,modelHash??url.searchParams.get('id')).first();check(row,'VAMP_NOT_FOUND','저장된 학습을 찾을 수 없습니다.',404);return json({ok:true,run:checkedRun(JSON.parse(row.payload))});}
  check(request.method==='POST'&&url.pathname===BASE+'/train','VAMP_ROUTE','학습 요청 경로를 확인하세요.',404);
  const text=await request.text();check(text.length<=4000,'VAMP_SIZE','학습 설정은 4KB 이내로 입력하세요.',413);const b=JSON.parse(text);
  check(b&&Object.keys(b).sort().join(',')==='datasetId,idempotencyKey,penalty,training,validation'&&typeof b.datasetId==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(b.idempotencyKey??'')&&b.training?.endAt<b.validation?.startAt,'VAMP_REQUEST','원자료·학습/검증 기간과 요청 키를 확인하세요.');
  const {idempotencyKey,...spec}=b,fingerprint=hashInputPackage(spec),id='vamp-'+hashInputPackage({owner,idempotencyKey}).slice(0,32),prior=await db.prepare('SELECT fingerprint,payload FROM vamp_model_runs WHERE owner_id=? AND id=?').bind(owner,id).first();
  if(prior){check(prior.fingerprint===fingerprint,'VAMP_KEY_CONFLICT','같은 요청 키의 학습 조건을 유지하세요.',409);return json({ok:true,run:checkedRun(JSON.parse(prior.payload)),idempotent:true});}
  const dataset=await getEventDataset(b.datasetId,{...options,env}),createdAt=new Date(typeof options.now==='function'?options.now():Date.now()).toISOString();
  check(dataset.availableAt<=createdAt,'VAMP_SOURCE_TIME','학습 시작 전에 보관한 자료를 선택하세요.');
  const model=fitVampModel({dataset,training:b.training,penalty:b.penalty,createdAt}),validation=validateVampModel({model,dataset,validation:b.validation}),run={id,createdAt,spec,model,validation,authority:'PAPER_RESEARCH_ONLY',providerCalls:0,liveOrders:0};
  await db.prepare('INSERT INTO vamp_model_runs(owner_id,id,fingerprint,payload,created_at) VALUES(?,?,?,?,?) ON CONFLICT(owner_id,id) DO NOTHING').bind(owner,id,fingerprint,JSON.stringify(run),createdAt).run();
  const saved=await db.prepare('SELECT fingerprint,payload FROM vamp_model_runs WHERE owner_id=? AND id=?').bind(owner,id).first();check(saved?.fingerprint===fingerprint,'VAMP_KEY_CONFLICT','동일 학습 요청을 다시 확인하세요.',409);return json({ok:true,run:checkedRun(JSON.parse(saved.payload))});
 }catch(e){return json({ok:false,code:e.code??'VAMP_MODEL_ERROR',message:e.code?e.message:'학습 설정과 자료를 확인하세요.'},e.status??400);}
}
