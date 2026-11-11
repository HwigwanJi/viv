import {researchSha256} from '../dist/domain/research.mjs';
import {marketKnowledgeExample} from '../dist/domain/market-knowledge.mjs';
import {WorkspaceRepository,readOperationalWorkspace} from './repository.mjs';
import {gzipSync} from 'node:zlib';
export const PORTFOLIO_NEWS_FEEDS=Object.freeze([{id:'fed',publisher:'Federal Reserve',url:'https://www.federalreserve.gov/feeds/press_all.xml',host:'www.federalreserve.gov'},{id:'sec',publisher:'SEC',url:'https://www.sec.gov/news/pressreleases.rss',host:'www.sec.gov'},{id:'bls-employment',publisher:'Bureau of Labor Statistics',url:'https://www.bls.gov/feed/empsit.rss',host:'www.bls.gov'}]);
const decode=s=>s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1').replace(/<[^>]*>/g,' ').replace(/&(amp|lt|gt|quot|apos);/g,(_,k)=>({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"})[k]).replace(/&#(x[0-9a-f]+|\d+);/gi,(_,v)=>String.fromCodePoint(v[0].toLowerCase()==='x'?parseInt(v.slice(1),16):Number(v))).replace(/\s+/g,' ').trim();
export function parsePortfolioNewsFeed(raw,source,{asOf}){
 if(typeof raw!=='string'||raw.length>500000||/<!DOCTYPE|<!ENTITY/i.test(raw)||!/<(?:rss|feed)\b/i.test(raw))throw Error('공식 RSS 원문의 형식과 크기를 확인하세요.');
 const items=[];for(const [item,kind]of raw.matchAll(/<(item|entry)(?:\s[^>]*)?>[\s\S]*?<\/\1>/gi)){
  const field=tag=>decode(item.match(new RegExp('<'+tag+'(?:\\s[^>]*)?>([\\s\\S]*?)<\\/'+tag+'>','i'))?.[1]??''),title=field('title'),uri=kind.toLowerCase()==='entry'?decode(item.match(/<link\b[^>]*href=["']([^"']+)["']/i)?.[1]??''):field('link'),date=kind.toLowerCase()==='entry'?(field('published')||field('updated')):field('pubDate'),publishedAt=new Date(date).toISOString(),url=new URL(uri);
  if(url.protocol!=='https:'||url.hostname!==source.host||url.username||url.password||!title||publishedAt>asOf)continue;
  const summary=kind.toLowerCase()==='entry'?(field('summary')||field('content')):field('description');items.push({title,uri,publishedAt,summary,publisher:source.publisher,feedId:source.id,sourceHash:researchSha256(item),rawItem:item});
 }
 return items;
}
export async function refreshPortfolioNews({db,owner,env={},fetchImpl=fetch,clock=()=>new Date().toISOString(),maxItems=4,guard=async()=>{}}){
 const bucket=new Date(Math.floor(Date.parse(clock())/10800000)*10800000).toISOString(),repository=new WorkspaceRepository(db);
 await db.prepare('CREATE TABLE IF NOT EXISTS portfolio_news_feed_runs(owner_id TEXT NOT NULL,bucket TEXT NOT NULL,status TEXT NOT NULL,body TEXT NOT NULL,PRIMARY KEY(owner_id,bucket))').bind().run();
 await db.prepare('CREATE TABLE IF NOT EXISTS portfolio_news_classification_attempts(owner_id TEXT NOT NULL,document_id TEXT NOT NULL,status TEXT NOT NULL,body TEXT NOT NULL,PRIMARY KEY(owner_id,document_id))').bind().run();
 await db.prepare('CREATE TABLE IF NOT EXISTS portfolio_news_sources(owner_id TEXT NOT NULL,raw_sha256 TEXT NOT NULL,encoding TEXT NOT NULL,body BLOB NOT NULL,PRIMARY KEY(owner_id,raw_sha256))').bind().run();
 const existing=await db.prepare('SELECT status,body FROM portfolio_news_feed_runs WHERE owner_id=? AND bucket=?').bind(owner,bucket).first();
 const retained=existing?JSON.parse(existing.body):null,contentPolicy='OFFICIAL_ARTICLE_TEXT_V2';
 if(existing?.status==='COMPLETED'&&retained.contentPolicy===contentPolicy)return retained;
 let state=retained?.contentPolicy===contentPolicy?retained:{bucket,contentPolicy,asOf:clock(),sources:[],items:null,completed:[],issues:[],pendingClassification:null,...(retained?{previousReports:[retained]}:{})};
 const save=async(status='RUNNING')=>db.prepare('INSERT INTO portfolio_news_feed_runs VALUES(?,?,?,?) ON CONFLICT(owner_id,bucket) DO UPDATE SET status=excluded.status,body=excluded.body').bind(owner,bucket,status,JSON.stringify(state)).run();
 const internal=async(path,payload)=>{await guard();const workspace=await readOperationalWorkspace(repository,owner),{handleMindStudioAPI}=await import('./mind-studio.mjs'),response=await handleMindStudioAPI(new Request('https://local.cji'+path,{method:'POST',headers:{'Content-Type':'application/json','oai-authenticated-user-id':owner},body:JSON.stringify({...payload,expectedRevision:workspace.revision,idempotencyKey:'news:'+researchSha256(path+JSON.stringify(payload)+':'+workspace.revision).slice(0,48)})}),{...env,DB:db},{repository,fetchImpl,now:()=>Date.parse(clock())}),value=await response.json();if(!response.ok)throw Object.assign(Error(value.message),{code:value.code});return value;};
 await guard();await save();
 if(!state.items){
  const all=[];for(const source of PORTFOLIO_NEWS_FEEDS){await guard();const response=await fetchImpl(source.url,{redirect:'error',headers:{'User-Agent':'ChungJiInvestment personal market research'},signal:AbortSignal.timeout(20000)}),raw=await response.text();if(!response.ok)throw Object.assign(Error('공식 뉴스 원문 조회 실패'),{code:'NEWS_HTTP_'+response.status});state.sources.push({id:source.id,url:source.url,receivedAt:clock(),rawSha256:researchSha256(raw),rawBody:raw});all.push(...parsePortfolioNewsFeed(raw,source,{asOf:clock()}));}
  state.items=all.filter(i=>Date.parse(clock())-Date.parse(i.publishedAt)<=168*3600000).sort((a,b)=>b.publishedAt.localeCompare(a.publishedAt)||a.uri.localeCompare(b.uri)).filter((i,n,a)=>a.findIndex(x=>x.uri===i.uri)===n).slice(0,maxItems);await save();
 }
 for(const item of state.items){
  if(!item.bodyText){
   await guard();const response=await fetchImpl(item.uri,{redirect:'error',headers:{'User-Agent':'ChungJiInvestment personal market research'},signal:AbortSignal.timeout(20000)}),raw=await response.text();if(!response.ok)throw Object.assign(Error('공식 발표 본문 조회 실패'),{code:'NEWS_ARTICLE_HTTP_'+response.status});if(Buffer.byteLength(raw)>5000000)throw Object.assign(Error('공식 발표 원문이 5MB를 초과했습니다.'),{code:'NEWS_ARTICLE_SIZE'});
   const clean=raw.replace(/<(script|style|nav|header|footer)\b[^>]*>[\s\S]*?<\/\1>/gi,''),main=clean.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1]??clean;
   item.bodyText=decode(main).slice(0,40000);item.feedItemHash=item.sourceHash;item.sourceHash=researchSha256(item.rawItem+'\n'+item.bodyText);item.articleRawHash=researchSha256(raw);await db.prepare("INSERT OR IGNORE INTO portfolio_news_sources VALUES(?,?,'GZIP_UTF8',?)").bind(owner,item.articleRawHash,gzipSync(raw)).run();state.sources.push({url:item.uri,receivedAt:clock(),rawSha256:item.articleRawHash,sourceStorage:'portfolio_news_sources'});await save();
  }
  const lineage='news-'+researchSha256(item.uri).slice(0,32),workspace=await readOperationalWorkspace(repository,owner),prior=(workspace.marketKnowledge??[]).filter(e=>e.document.data.lineageId===lineage).sort((a,b)=>b.document.data.version-a.document.data.version)[0];
  let entry=prior?.document.data.publication.sourceRevision===item.sourceHash?prior:null;
  if(entry?.status==='APPROVED'){if(!state.completed.includes(entry.id))state.completed.push(entry.id);continue;}
  if(!entry){
   const now=clock(),doc=marketKnowledgeExample(now),version=(prior?.document.data.version??0)+1;doc.id=lineage+'-v'+version;doc.title=item.title.slice(0,240);doc.source=prior?structuredClone(prior.document.source):{type:'market-provider',id:item.feedId+'-'+researchSha256(item.uri).slice(0,24),uri:item.uri};doc.asOf=item.publishedAt;doc.provenance={createdAt:now,authorId:'portfolio-news-feed',recordRefs:[doc.source.id],contentHashes:[item.sourceHash,item.articleRawHash],classification:null};doc.data={...doc.data,version,lineageId:lineage,previousVersionId:prior?.id??null,sourceType:'news',publisher:item.publisher,summary:item.summary.slice(0,4000)||item.title,body:'공식 발표 본문\n'+item.title+'\n'+item.bodyText,claims:[{id:'published-headline',text:item.title.slice(0,2000),sourceRef:doc.source.id}],publication:{...doc.data.publication,publishedAt:item.publishedAt,sourcePublishedValue:item.publishedAt,retrievedAt:now,sourceRevision:item.sourceHash},coverage:{global:false,assetClasses:['crypto','equity'],economies:[],sectors:[]}};
   await internal('/api/workspace/market-knowledge/write',{document:doc});entry=(await readOperationalWorkspace(repository,owner)).marketKnowledge.find(e=>e.id===doc.id);
  }
  try{
   if(!entry.classificationRecord){
    const attempt=await db.prepare("INSERT INTO portfolio_news_classification_attempts VALUES(?,?,'REQUESTED',?) ON CONFLICT(owner_id,document_id) DO NOTHING RETURNING document_id").bind(owner,entry.id,JSON.stringify({requestedAt:clock(),contentHash:entry.contentHash})).first();
    if(!attempt){state.issues.push({id:entry.id,code:'CLASSIFICATION_OUTCOME_UNCERTAIN'});await save();continue;}
    state.pendingClassification=entry.id;await save();await internal('/api/workspace/market-knowledge/classify',{documentId:entry.id});await db.prepare("UPDATE portfolio_news_classification_attempts SET status='COMPLETED' WHERE owner_id=? AND document_id=?").bind(owner,entry.id).run();state.pendingClassification=null;await save();
   }
   await internal('/api/workspace/market-knowledge/publish',{documentId:entry.id,reason:'공식 뉴스 수집 지시에 따라 출처, 공개 시각과 분류 원문을 자동 대조했습니다. 공식 발표의 본문과 수치를 수집해 분석했습니다.'});state.completed.push(entry.id);await save();
  }catch(error){state.issues.push({id:entry.id,code:error.code??'NEWS_CLASSIFICATION',message:error.message});await save();}
 }
 state.completedAt=clock();await save('COMPLETED');return state;
}
