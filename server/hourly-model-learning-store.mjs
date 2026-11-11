import {hashInputPackage} from '../dist/domain/workspace.mjs';
const stmt=(db,sql,...args)=>db.prepare(sql).bind(...args);
export const learningRows=async(db,sql,...args)=>(await stmt(db,sql,...args).all()).results??[];
export const learningFirst=(db,sql,...args)=>stmt(db,sql,...args).first();
export async function initializeHourlyLearning(db){await db.batch([
 stmt(db,'CREATE TABLE IF NOT EXISTS hourly_model_learning(owner_id TEXT NOT NULL,profile_id TEXT NOT NULL,revision INTEGER NOT NULL,body TEXT NOT NULL,PRIMARY KEY(owner_id,profile_id))'),
 stmt(db,'CREATE TABLE IF NOT EXISTS hourly_learning_trials(owner_id TEXT NOT NULL,id TEXT NOT NULL,profile_id TEXT NOT NULL,revision INTEGER NOT NULL,mutation_token TEXT NOT NULL,body TEXT NOT NULL,PRIMARY KEY(owner_id,id))'),
 stmt(db,'CREATE TABLE IF NOT EXISTS hourly_learning_events(owner_id TEXT NOT NULL,trial_id TEXT NOT NULL,id TEXT NOT NULL,at TEXT NOT NULL,kind TEXT NOT NULL,body TEXT NOT NULL,PRIMARY KEY(owner_id,trial_id,id))'),
 stmt(db,'CREATE TABLE IF NOT EXISTS hourly_learning_candles(owner_id TEXT NOT NULL,market TEXT NOT NULL,open_at INTEGER NOT NULL,body TEXT NOT NULL,PRIMARY KEY(owner_id,market,open_at))'),
 stmt(db,'CREATE TABLE IF NOT EXISTS hourly_learning_scores(owner_id TEXT NOT NULL,profile_id TEXT NOT NULL,event_id TEXT NOT NULL,market TEXT NOT NULL,forecast_at TEXT NOT NULL,label_at TEXT NOT NULL,body TEXT NOT NULL,PRIMARY KEY(owner_id,profile_id,event_id,market))')
 ]);await db.batch([
 stmt(db,'CREATE INDEX IF NOT EXISTS hourly_learning_event_time ON hourly_learning_events(owner_id,trial_id,at)'),
 stmt(db,'CREATE INDEX IF NOT EXISTS hourly_learning_score_time ON hourly_learning_scores(owner_id,profile_id,forecast_at)')
]);}
export async function readLearning(db,owner,profile){const r=await learningFirst(db,'SELECT body,revision FROM hourly_model_learning WHERE owner_id=? AND profile_id=?',owner,profile);return r?{...JSON.parse(r.body),revision:r.revision}:null;}
export async function writeLearning(db,owner,previous,next){
 const {revision,...body}=next,text=JSON.stringify(body),r=previous?await stmt(db,'UPDATE hourly_model_learning SET body=?,revision=revision+1 WHERE owner_id=? AND profile_id=? AND revision=?',text,owner,next.profileId,previous.revision).run():await stmt(db,'INSERT OR IGNORE INTO hourly_model_learning(owner_id,profile_id,revision,body) VALUES(?,?,0,?)',owner,next.profileId,text).run();
 if(r.meta.changes!==1)throw Object.assign(Error('학습 설정이 갱신됐습니다. 최신 상태에서 이어갑니다.'),{code:'HOURLY_LEARNING_REVISION',status:409});return {...body,revision:previous?previous.revision+1:0};
}
export async function readLearningTrial(db,owner,id){const r=await learningFirst(db,'SELECT body,revision FROM hourly_learning_trials WHERE owner_id=? AND id=?',owner,id);return r?{...JSON.parse(r.body),revision:r.revision}:null;}
export async function writeLearningTrial(db,owner,head,trial,events=[]){
 const {revision,...body}=trial,token=crypto.randomUUID(),text=JSON.stringify(body);if(text.length>12000000)throw Error('HOURLY_LEARNING_TRIAL_SIZE');
 const fence="EXISTS(SELECT 1 FROM hourly_model_learning WHERE owner_id=? AND profile_id=? AND revision=? AND json_extract(body,'$.enabled')=1)",args=[owner,head.profileId,head.revision];
 const update=revision===undefined?stmt(db,'INSERT OR IGNORE INTO hourly_learning_trials(owner_id,id,profile_id,revision,mutation_token,body) SELECT ?,?,?,0,?,? WHERE '+fence,owner,trial.id,head.profileId,token,text,...args):stmt(db,'UPDATE hourly_learning_trials SET body=?,revision=revision+1,mutation_token=? WHERE owner_id=? AND id=? AND revision=? AND '+fence,text,token,owner,trial.id,revision,...args);
 const rs=await db.batch([update,...events.map(e=>stmt(db,'INSERT OR IGNORE INTO hourly_learning_events(owner_id,trial_id,id,at,kind,body) SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM hourly_learning_trials WHERE owner_id=? AND id=? AND mutation_token=?)',owner,trial.id,e.id??hashInputPackage(e),e.at,e.kind,JSON.stringify(e.body),owner,trial.id,token))]);
 if(rs[0].meta.changes!==1)throw Object.assign(Error('HOURLY_LEARNING_REVISION'),{code:'HOURLY_LEARNING_REVISION'});trial.revision=revision===undefined?0:revision+1;return trial;
}
export async function saveLearningCandles(db,owner,candles){
 for(let i=0;i<candles.length;i+=100)await db.batch(candles.slice(i,i+100).map(c=>stmt(db,'INSERT OR IGNORE INTO hourly_learning_candles(owner_id,market,open_at,body) VALUES(?,?,?,?)',owner,c.market,c.bar[0],JSON.stringify(c))));
}
