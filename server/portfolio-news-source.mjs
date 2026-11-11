import {marketKnowledgeHash} from '../dist/domain/market-knowledge.mjs';
import {PORTFOLIO_NEWS_VERSION,assertPortfolioNews} from '../dist/domain/portfolio-news.mjs';
export function portfolioNewsFromKnowledge(entries,{asOf,maxAgeHours=168,publisherWeights={}}){
 const events=[],sourceRefs=[],excluded=[];
 for(const e of entries){
  const d=e.document,c=e.classificationRecord,publication=d?.data?.publication;
  if(e.status!=='APPROVED'||!c||c.contentHash!==e.contentHash||e.contentHash!==marketKnowledgeHash(d)){excluded.push({id:e.id,reason:'SOURCE_CLASSIFICATION_OR_APPROVAL'});continue;}
  if(e.availableAt>asOf||publication.publishedAt>asOf||Date.parse(asOf)-Date.parse(publication.publishedAt)>maxAgeHours*3600000){excluded.push({id:e.id,reason:'PUBLICATION_WINDOW'});continue;}
  const p=c.rawResponse?.answers?.sentiment?.probabilities;if(!p||!Number.isFinite(p.positive)||!Number.isFinite(p.negative)){excluded.push({id:e.id,reason:'CLASSIFICATION_PROBABILITIES'});continue;}
  const coverage=d.data.coverage,classes=coverage.global?['crypto','equity']:coverage.assetClasses.length?coverage.assetClasses:[...new Set(d.scope.instrumentIds.map(id=>id.startsWith('crypto:')?'crypto':'equity'))],classification=c.classification;
  const first=entries.filter(x=>x.status==='APPROVED'&&x.availableAt<=asOf&&x.document.data.lineageId===d.data.lineageId).sort((a,b)=>a.document.data.version-b.document.data.version)[0];
  const novelty=({new_fact:1,corroboration:.5,known:0,uncertain:1})[(first??e).classificationRecord.classification.novelty],confidence=classification.confidence.sentiment,reliability=publisherWeights[d.data.publisher]??1;
  for(const assetClass of classes)events.push({id:d.data.lineageId,sourceHash:e.contentHash,sourceUrl:d.source.uri,publishedAt:publication.publishedAt,availableAt:e.availableAt,assetClass,instrumentIds:d.scope.instrumentIds,direction:p.positive-p.negative,confidence,novelty,reliability});
  sourceRefs.push({id:d.id,contentHash:e.contentHash,sourceRef:d.source.uri});
 }
 return assertPortfolioNews({contractVersion:PORTFOLIO_NEWS_VERSION,asOf,events:events.slice(-200),sourceRefs:sourceRefs.slice(-200),selection:{qualifiedDocuments:sourceRefs.length,excluded,noveltyPolicy:'UNKNOWN_USES_EXPLICIT_INITIAL_WEIGHT_ONE',publisherWeightBasis:'EXPLICIT_SOURCE_PRIOR'}});
}
export async function readPortfolioNews({db,owner,asOf,publisherWeights={}}){
 const rows=(await db.prepare("SELECT payload FROM workspace_objects WHERE owner_id=? AND kind='marketKnowledge' AND json_extract(payload,'$.status')='APPROVED' AND json_extract(payload,'$.availableAt')<=? ORDER BY json_extract(payload,'$.availableAt') DESC LIMIT 100").bind(owner,asOf).all()).results??[];
 return portfolioNewsFromKnowledge(rows.map(r=>JSON.parse(r.payload)),{asOf,publisherWeights});
}
