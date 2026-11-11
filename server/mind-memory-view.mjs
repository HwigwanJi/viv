import {selectMemories} from './mind-engine.mjs';
import {RepositoryError} from './repository.mjs';
import {mindDocumentHash} from '../dist/domain/mind-manifest.mjs';
import {hashInputPackage} from '../dist/domain/workspace.mjs';
const list=v=>Array.isArray(v)?v:[],identity=entry=>{const d=entry?.document??entry;return d?.candidateId??d?.id;};
const sentHash=(doc,typed)=>typed?mindDocumentHash(doc):hashInputPackage({id:identity(doc),title:doc.title,text:doc.text,knowledgeType:doc.knowledgeType??'HYPOTHESIS',approvedAt:doc.approvedAt,availableAt:doc.availableAt,experienceIds:doc.experienceIds??[],evidenceSummary:doc.evidenceSummary??null,validation:doc.validation??null});
const eventTime=r=>r.decisionCompletedAt??r.completedAt??r.provider?.answeredAt??r.provider?.startedAt??r.decisionAt??r.rawRequest?.state?.decisionAt??r.createdAt??'';

/** Reuses the decision engine selector without a price fetch or model request. */
export function buildMindMemoryView(workspace,{profileId='all',manifests=[],now=new Date().toISOString()}={}){
  if(profileId!=='all'&&!list(workspace.investmentProfiles).some(p=>p.id===profileId))throw new RepositoryError('MIND_NOT_FOUND','마인드를 선택하세요.',404);
  const selectedManifests=manifests.filter(m=>profileId==='all'||m.scope.profileId===profileId),items=[],policies=[];
  for(const manifest of selectedManifests){
    const approved=list(workspace.mindDocuments).filter(e=>e.status==='APPROVED'&&e.document.scope.profileId===manifest.scope.profileId&&['trade-review','principle-evidence'].includes(e.document.kind));
    const entries=[...manifest.data.approvedMemory,...approved],selectionEntries=entries.filter(entry=>!entry.document||entry.document.availableAt<=now),byInstrument=new Map(manifest.data.universe.instrumentIds.map(id=>[id,selectMemories(selectionEntries,manifest,id,now)]));
    const firstSelection=[...byInstrument.values()][0];
    policies.push({profileId:manifest.scope.profileId,manifestId:manifest.id,manifestVersion:manifest.data.version,selectionPolicy:firstSelection?.policy??null,byteLimit:firstSelection?.byteLimit??null,instrumentIds:[...byInstrument.keys()],byInstrument:[...byInstrument].map(([instrumentId,s])=>({instrumentId,policy:s.policy,byteLimit:s.byteLimit,selectedByteCount:s.selectedByteCount,requestedCount:s.requestedCount,eligibleCount:s.eligibleCount,selectedCount:s.selectedCount}))});
    for(const entry of entries){
      const doc=entry.document??entry,id=identity(entry),typed=!!entry.document,eligibleInstrumentIds=[],excludedInstrumentReasons=[],contentHash=typed?mindDocumentHash(doc):null;
      for(const [instrumentId,selection]of byInstrument){if(selection.selected.some(d=>identity(d)===id))eligibleInstrumentIds.push(instrumentId);else excludedInstrumentReasons.push({instrumentId,code:selection.excluded.find(d=>d.id===id)?.reason??(typed&&doc.availableAt>now?'NOT_AVAILABLE':'MEMORY_NOT_AVAILABLE')});}
      const expectedHash=sentHash(doc,typed),matches=d=>{if(identity(d)!==id)return false;try{return sentHash(d,typed)===expectedHash;}catch{return false;}},recent=(a,b)=>eventTime(b).localeCompare(eventTime(a))||b.id.localeCompare(a.id);
      const uses=list(workspace.mindRuns).filter(r=>r.profileId===manifest.scope.profileId&&list(r.rawRequest?.state?.approvedMemory).some(matches)).sort(recent);
      const selections=list(workspace.mindSelections).filter(s=>s.profileId===manifest.scope.profileId&&list(s.rawRequest?.state?.candidates).some(c=>list(c.approvedMemory).some(matches))).sort(recent),last=uses[0],lastSelection=selections[0];
      const lastTransmittedDecision=last?{kind:'decision',id:last.id,instrumentId:last.instrumentId,manifestId:last.manifestId,completedAt:last.decisionCompletedAt??last.provider?.answeredAt??null,requestAt:last.provider?.startedAt??last.decisionAt??null}:null;
      const lastTransmittedSelection=lastSelection?{kind:'selection',id:lastSelection.id,selectedInstrumentId:lastSelection.selectedInstrumentId??null,candidateInstrumentIds:list(lastSelection.rawRequest?.state?.candidates).filter(c=>list(c.approvedMemory).some(matches)).map(c=>c.instrumentId),completedAt:lastSelection.completedAt??lastSelection.provider?.answeredAt??null,requestAt:lastSelection.provider?.startedAt??lastSelection.rawRequest?.state?.decisionAt??null}:null;
      const lastTransmission=!lastTransmittedDecision?lastTransmittedSelection:!lastTransmittedSelection?lastTransmittedDecision:eventTime(lastSelection)>eventTime(last)?lastTransmittedSelection:lastTransmittedDecision;
      items.push({id,documentId:typed?doc.id:null,candidateId:typed?null:id,kind:typed?doc.kind:'approved-memory',origin:typed?'APPROVED_DOCUMENT':'PINNED_MANIFEST_MEMORY',title:doc.title,version:typed?doc.version??null:null,profileId:manifest.scope.profileId,manifestId:manifest.id,manifestVersion:manifest.data.version,availableAt:doc.availableAt,approvedAt:typed?entry.review?.reviewedAt??entry.review?.approvedAt??null:doc.approvedAt,contentHash,eligibleInstrumentIds,excludedInstrumentReasons,lastTransmittedDecision,lastTransmittedSelection,lastTransmission,actionTransmissionCount:uses.length,selectionTransmissionCount:selections.length,transmissionCount:uses.length+selections.length});
    }
  }
  return {ok:true,revision:workspace.revision,asOf:now,scope:{profileId},policies,items};
}
