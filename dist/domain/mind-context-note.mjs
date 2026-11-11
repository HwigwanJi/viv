import {assertMindDocument} from './mind-manifest.mjs';

export function createMindContextNote({profileId,instrumentIds=[],title,summary,sourceUri='',category='event',asOf,uncertainty='사용자가 작성한 관찰 기록'}, {now=new Date().toISOString(),id='note-'+crypto.randomUUID()}={}){
 const document={schemaVersion:1,id,kind:'market-context',title:title?.trim(),source:{type:'user',id,uri:sourceUri.trim()||null},asOf:asOf||now,availableAt:now,scope:{profileId,instrumentIds:[...instrumentIds],experimentId:null},principleRefs:[],provenance:{createdAt:now,authorId:'workspace-owner',recordRefs:[id],contentHashes:[],classification:null},data:{category,summary:summary?.trim(),observations:[{name:'관찰 주제',value:title?.trim(),unit:'기록',asOf:asOf||now,availableAt:now,sourceRef:id}],regime:'unknown',validUntil:null,uncertainty:uncertainty.trim()}};
 assertMindDocument(document);return document;
}
