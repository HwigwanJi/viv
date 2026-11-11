import {hourlyComponentTraining} from '../dist/domain/hourly-model-components.mjs';
import {spawn} from 'node:child_process';
import {access} from 'node:fs/promises';
import {homedir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {hashInputPackage} from '../dist/domain/workspace.mjs';
import {assertHourlyPathModel,HOURLY_PATH_FEATURES} from '../dist/domain/hourly-path-model.mjs';

export async function trainHourlyModel(rows,{cutoff,createdAt=cutoff,components,timeframe='1h',horizonBars=6,targetPolicy,python=process.env.KEYNES_TRAINING_PYTHON??path.join(homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe')}={}){
 if(!(timeframe==='1h'&&horizonBars===6||timeframe==='1m'&&[6,15,42].includes(horizonBars)))throw Error('PATH_TRAIN_TIMEFRAME');
 await access(python);const settings=hourlyComponentTraining(components),payload=JSON.stringify({rows,cutoff,...(components?{settings}: {})}),script=fileURLToPath(new URL('./hourly-model-training.py',import.meta.url));
 const result=await new Promise((resolve,reject)=>{
  const child=spawn(python,['-B',script],{stdio:['pipe','pipe','pipe'],windowsHide:true});let out='',err='';
  const timer=setTimeout(()=>{child.kill();reject(Object.assign(Error('학습 작업의 실행 시간을 확인하세요.'),{code:'HOURLY_TRAIN_TIMEOUT'}));},60000);
  child.stdout.on('data',b=>{out+=b;if(out.length>180000){child.kill();reject(Error('HOURLY_TRAIN_OUTPUT_SIZE'));}});
  child.stderr.on('data',b=>{err=(err+b).slice(-2000);});child.on('error',e=>{clearTimeout(timer);reject(e);});
  child.on('close',code=>{clearTimeout(timer);if(code!==0)return reject(Object.assign(Error('학습 실행 환경과 자료를 확인하세요.'),{code:'HOURLY_TRAIN_FAILED'}));try{resolve(JSON.parse(out));}catch{reject(Error('HOURLY_TRAIN_OUTPUT'));}});
  child.stdin.on('error',()=>{});child.stdin.end(payload);
 });
 const rowsHash=hashInputPackage(rows),body={contractVersion:timeframe==='1m'?(targetPolicy?'minute-policy-path-forest-v3':'minute-pooled-path-forest-v2'):'hourly-path-forest-v1',createdAt,timeframe,horizonBars,features:[...HOURLY_PATH_FEATURES],targetTransform:'LOG1P',training:{lastLabelAt:rows.reduce((v,r)=>r.labelAt>v?r.labelAt:v,rows[0].labelAt),sampleCount:rows.length,rowsSha256:rowsHash},trees:result.trees,...(targetPolicy?{targetPolicy}:{}),sourceSha256:hashInputPackage({trainer:'BOOTSTRAPPED_LOG_PATH_FOREST_16_DEPTH4_MIN40_V1',rowsHash,cutoff,seed:settings.seed,...(timeframe==='1m'?{timeframe,horizonBars}:{}),...(components?{componentTraining:settings}:{})})};
 return assertHourlyPathModel({...body,hash:hashInputPackage(body)});
}
