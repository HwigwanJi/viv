import {hashInputPackage} from './workspace.mjs';

export const VAMP_MODEL_VERSION='vamp-ridge-return-v1';
export const VAMP_FEATURES=Object.freeze(['VAMP_BBO_BPS','VAMP_DEPTH_BPS','SPREAD_BPS','ORDERBOOK_IMBALANCE']);
const check=(ok,code,message)=>{if(!ok)throw Object.assign(new Error(message),{code,status:409});};
const iso=v=>typeof v==='string'&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString()===v;
const finite=Number.isFinite,clone=structuredClone;
const seal=body=>({...body,hash:hashInputPackage(body)});

/** Cross-side price × quantity; fixed top-five levels, not a learned estimator. */
export function vampBookFeatures(book){
 const levels=book?.levels;if(!Array.isArray(levels)||!levels.length)return null;
 const rows=levels.slice(0,5).map(l=>Object.fromEntries(['bidPrice','askPrice','bidQuantity','askQuantity'].map(k=>[k,Number(l[k])])));
 if(!rows.every((l,i)=>Object.values(l).every(finite)&&l.bidPrice>0&&l.askPrice>l.bidPrice&&l.bidQuantity>=0&&l.askQuantity>=0&&(i===0||l.bidPrice<rows[i-1].bidPrice&&l.askPrice>rows[i-1].askPrice)))return null;
 const first=rows[0],mid=(first.bidPrice+first.askPrice)/2,total=rows.reduce((n,l)=>n+l.bidQuantity+l.askQuantity,0),top=first.bidQuantity+first.askQuantity;
 if(!(total>0&&top>0))return null;
 const bbo=(first.bidPrice*first.askQuantity+first.askPrice*first.bidQuantity)/top,depth=rows.reduce((n,l)=>n+l.bidPrice*l.askQuantity+l.askPrice*l.bidQuantity,0)/total;
 const bid=rows.reduce((n,l)=>n+l.bidPrice*l.bidQuantity,0),ask=rows.reduce((n,l)=>n+l.askPrice*l.askQuantity,0);
 return {mid,VAMP_BBO_BPS:(bbo/mid-1)*10000,VAMP_DEPTH_BPS:(depth/mid-1)*10000,SPREAD_BPS:(first.askPrice-first.bidPrice)/mid*10000,ORDERBOOK_IMBALANCE:(bid-ask)/(bid+ask)};
}

export function assertVampModel(model){
 check(model&&Object.keys(model).sort().join(',')==='authority,contractVersion,createdAt,depthLevels,features,formulaSource,hash,horizonMs,instrumentId,intercept,mean,method,penalty,scale,training,weights','VAMP_MODEL_SCHEMA','학습 모델의 정식 필드를 확인하세요.');
 check(model&&model.contractVersion===VAMP_MODEL_VERSION&&model.authority==='PAPER_RESEARCH_ONLY'&&iso(model.createdAt)&&typeof model.instrumentId==='string'&&model.horizonMs===60000&&model.depthLevels===5&&JSON.stringify(model.features)===JSON.stringify(VAMP_FEATURES),'VAMP_MODEL_SCHEMA','VAMP 학습 모델의 형식과 연구 범위를 확인하세요.');
 const {hash,...body}=model;check(hash===hashInputPackage(body),'VAMP_MODEL_HASH','학습 모델 원문 해시를 확인하세요.');
 check([model.mean,model.scale,model.weights].every(v=>Array.isArray(v)&&v.length===4&&v.every(finite))&&model.scale.every(v=>v>0)&&finite(model.intercept)&&finite(model.penalty)&&model.penalty>=.000001&&model.penalty<=1000000&&model.method==='STANDARDIZED_RIDGE_WITH_UNPENALIZED_INTERCEPT'&&typeof model.formulaSource==='string','VAMP_MODEL_COEFFICIENTS','유효한 학습 계수와 정규화를 확인하세요.');
 const t=model.training;check(t&&Object.keys(t).sort().join(',')==='datasetHash,endAt,lastLabelAt,sampleCount,sampleHash,startAt'&&[t.startAt,t.endAt,t.lastLabelAt].every(iso)&&t.startAt<t.endAt&&t.lastLabelAt>t.startAt&&t.lastLabelAt<=t.endAt&&Number.isSafeInteger(t.sampleCount)&&t.sampleCount>=40&&/^[a-f0-9]{64}$/.test(t.sampleHash??'')&&/^[a-f0-9]{64}$/.test(t.datasetHash??''),'VAMP_MODEL_TRAINING','학습 구간·표본과 원자료 핀을 확인하세요.');
 check(JSON.stringify(model).length<=16000,'VAMP_MODEL_SIZE','학습 모델은 16KB 이내로 보관하세요.');return model;
}

export function predictVampModel(model,snapshot,{asOf,executionMode='PAPER'}={}){
 assertVampModel(model);const fail=reason=>({ready:false,status:'BLOCKED',reasonCodes:[reason]});
 if(executionMode!=='PAPER')return fail('VAMP_RESEARCH_ONLY');
 if(!iso(asOf)||asOf<=model.training.lastLabelAt)return fail('VAMP_TRAINING_CUTOFF');
 if(snapshot?.instrumentId!==model.instrumentId||snapshot?.asOf!==asOf||!iso(snapshot?.availableAt)||snapshot.availableAt>asOf)return fail('VAMP_INPUT_SCOPE');
 const {sourceHash,...body}=snapshot;if(snapshot.contractVersion!=='market-microstructure-input-v1'||sourceHash!==hashInputPackage(body))return fail('VAMP_INPUT_HASH');
 const vector=VAMP_FEATURES.map(k=>snapshot.metrics[k]?.value);if(!vector.every(finite)||!finite(snapshot.metrics.QUOTE_AGE_MS?.value)||snapshot.metrics.QUOTE_AGE_MS.value>3000)return fail('VAMP_FEATURES_REQUIRED');
 const value=model.intercept+vector.reduce((n,x,i)=>n+model.weights[i]*(x-model.mean[i])/model.scale[i],0);
 if(!finite(value))return fail('VAMP_PREDICTION_INVALID');
 return {ready:true,status:'READY',value,unit:'bps',modelHash:model.hash,trainingLabelCutoff:model.training.lastLabelAt,horizonMs:model.horizonMs,features:Object.fromEntries(VAMP_FEATURES.map((k,i)=>[k,vector[i]])),authority:model.authority,researchRole:'RETROSPECTIVE_DEVELOPMENT',basisRefs:['vamp-model:'+model.hash]};
}

/** One sample per second. Labels use only a book received by t+60s, within its window. */
export function vampTrainingSamples(dataset,window){
 check(window&&Object.keys(window).sort().join(',')==='endAt,startAt'&&[window.startAt,window.endAt].every(iso)&&window.startAt>=dataset.startAt&&window.endAt<=dataset.endAt&&Date.parse(window.endAt)-Date.parse(window.startAt)>=120000&&Date.parse(window.endAt)-Date.parse(window.startAt)<=86400000,'VAMP_WINDOW','관측 범위 안에서 2분~24시간의 구간을 선택하세요.');
 const books=dataset.events.filter(e=>e.kind==='ORDER_BOOK'&&e.market===dataset.market).toSorted((a,b)=>a.receivedAt.localeCompare(b.receivedAt));let cursor=0,latest=null;
 const marks=[];for(let t=Date.parse(window.startAt);t<=Date.parse(window.endAt);t+=1000){const now=new Date(t).toISOString();while(cursor<books.length&&books[cursor].receivedAt<=now){const b=books[cursor++];if(b.eventTime<=now&&(!latest||b.eventTime>latest.eventTime||b.eventTime===latest.eventTime&&b.receivedAt>latest.receivedAt))latest=b;}
  const f=latest&&t-Date.parse(latest.eventTime)<=3000&&t-Date.parse(latest.receivedAt)<=3000?vampBookFeatures(latest):null;marks.push(f?{asOf:now,bookId:latest.id,bookHash:latest.sourceHash,features:f}:null);
 }
 const rows=[];for(let i=0;i+60<marks.length;i++){const a=marks[i],b=marks[i+60];if(!a||!b)continue;rows.push({at:a.asOf,labelAt:b.asOf,inputBookHash:a.bookHash,labelBookHash:b.bookHash,x:VAMP_FEATURES.map(k=>a.features[k]),y:(b.features.mid/a.features.mid-1)*10000});}return rows;
}

function solve(a,b){const n=b.length,m=a.map((r,i)=>[...r,b[i]]);for(let k=0;k<n;k++){let p=k;for(let i=k+1;i<n;i++)if(Math.abs(m[i][k])>Math.abs(m[p][k]))p=i;[m[k],m[p]]=[m[p],m[k]];check(Math.abs(m[k][k])>1e-12,'VAMP_SINGULAR','학습 표본의 변동이 부족합니다.');const d=m[k][k];for(let j=k;j<=n;j++)m[k][j]/=d;for(let i=0;i<n;i++)if(i!==k){const v=m[i][k];for(let j=k;j<=n;j++)m[i][j]-=v*m[k][j];}}return m.map(r=>r[n]);}
export function fitVampModel({dataset,training,penalty=1,createdAt}={}){
 check(iso(createdAt)&&finite(penalty)&&penalty>=.000001&&penalty<=1000000,'VAMP_FIT_CONFIG','학습 시각과 양수 정규화 강도를 확인하세요.');
 const rows=vampTrainingSamples(dataset,training);check(rows.length>=40,'VAMP_TRAINING_SAMPLES','신선한 호가로 만든 학습 표본 40개 이상이 필요합니다.');
 const mean=VAMP_FEATURES.map((_,j)=>rows.reduce((n,r)=>n+r.x[j],0)/rows.length),scale=mean.map((m,j)=>Math.sqrt(rows.reduce((n,r)=>n+(r.x[j]-m)**2,0)/rows.length)||1),a=Array.from({length:5},()=>Array(5).fill(0)),b=Array(5).fill(0);
 for(const row of rows){const x=[1,...row.x.map((v,j)=>(v-mean[j])/scale[j])];for(let j=0;j<5;j++){b[j]+=x[j]*row.y;for(let k=0;k<5;k++)a[j][k]+=x[j]*x[k];}}
 for(let j=1;j<5;j++)a[j][j]+=penalty;const [intercept,...weights]=solve(a,b);
 const model=seal({contractVersion:VAMP_MODEL_VERSION,authority:'PAPER_RESEARCH_ONLY',createdAt,instrumentId:dataset.instrumentId,horizonMs:60000,depthLevels:5,features:[...VAMP_FEATURES],penalty,mean,scale,intercept,weights,training:{...clone(training),lastLabelAt:rows.at(-1).labelAt,sampleCount:rows.length,sampleHash:hashInputPackage(rows),datasetHash:dataset.sourceHash},method:'STANDARDIZED_RIDGE_WITH_UNPENALIZED_INTERCEPT',formulaSource:'https://hftbacktest.readthedocs.io/en/py-v2.4.2/tutorials/Market%20Making%20with%20Alpha%20-%20Order%20Book%20Imbalance.html'});assertVampModel(model);return model;
}
export function validateVampModel({model,dataset,validation}={}){
 assertVampModel(model);check(dataset.instrumentId===model.instrumentId&&dataset.sourceHash===model.training.datasetHash&&validation.startAt>model.training.endAt,'VAMP_TEMPORAL_SPLIT','학습 종료 뒤의 별도 검증 구간과 같은 원자료를 선택하세요.');
 const rows=vampTrainingSamples(dataset,validation);check(rows.length>=20,'VAMP_VALIDATION_SAMPLES','검증 표본 20개 이상이 필요합니다.');
 let error=0,baseline=0,correct=0;for(const r of rows){const p=model.intercept+r.x.reduce((n,x,i)=>n+model.weights[i]*(x-model.mean[i])/model.scale[i],0);error+=(p-r.y)**2;baseline+=r.y**2;correct+=Number(Math.sign(p)===Math.sign(r.y));}
 return seal({contractVersion:'vamp-holdout-v1',modelHash:model.hash,datasetHash:dataset.sourceHash,window:clone(validation),sampleCount:rows.length,sampleHash:hashInputPackage(rows),rmseBps:Math.sqrt(error/rows.length),zeroReturnBaselineRmseBps:Math.sqrt(baseline/rows.length),directionAccuracy:correct/rows.length,selection:'FIXED_CONFIG_TRAIN_ONLY',profitability:'NOT_ESTABLISHED',generalization:'SHORT_SINGLE_SESSION_NOT_ESTABLISHED',role:'RETROSPECTIVE_DEVELOPMENT'});
}
