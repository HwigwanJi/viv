/** Read projection for the active application. The server repository remains
 * the execution/backup source; this view is never accepted as a workspace. */
export const STUDIO_WORKSPACE_VIEW='studio-workspace-view-v1';
const list=v=>Array.isArray(v)?v:[],clone=structuredClone;
const pick=(value,keys)=>Object.fromEntries(keys.filter(k=>Object.hasOwn(value??{},k)).map(k=>[k,value[k]]));
export function projectStudioWorkspace(workspace){
  const view={...workspace},omittedCollections=['commandReceipts','marketSnapshots','mindDocuments','mindManifests','mindSelections','universeSourceSnapshots','newsComparisons','newsComparisonResults'];
  for(const key of omittedCollections)view[key]=[];
  delete view.research;delete view.knowledge;
  view.decisionRecords=list(workspace.decisionRecords).map(record=>({...pick(record,['id','deploymentId','investmentProfileId','createdAt','decisionStatus','outcomeType','decision','investmentProfileVersionId','memoryVersionId','experimentId','experimentType']),ruleResults:list(record.ruleResults).filter(rule=>rule.id==='order.prepare.paper').map(rule=>pick(rule,['id','proposal']))}));
  view.mindRuns=list(workspace.mindRuns).map(run=>({...pick(run,['id','profileId','instrumentId','asOf','createdAt','decisionAt','decisionCompletedAt','manifestId','manifestHash','mode','experimentType','status','decision','provider','observationState','observationDueAt']),execution:run.execution?pick(run.execution,['status','at','reason','retryable','retryAction','errorCode','fee','quantity','currency','outcomeRecord']):null,observation:run.observation?pick(run.observation,['asOf','methodVersion','metrics']):null}));
  // The global workspace only supplies the title of a pinned document. Its
  // content, classification evidence and usage are loaded from the item API.
  view.marketKnowledge=list(workspace.marketKnowledge).map(entry=>({...pick(entry,['id','status','contentHash','availableAt']),document:{...pick(entry.document,['id','title','kind']),data:pick(entry.document?.data,['version','lineageId'])}}));
  if(workspace.scheduler)view.scheduler={...workspace.scheduler,attempts:[],events:[],receipts:[]};
  const collectionCounts=Object.fromEntries(Object.entries(workspace).filter(([,v])=>Array.isArray(v)).map(([key,value])=>[key,value.length]));
  return {workspace:clone(view),workspaceView:{contract:STUDIO_WORKSPACE_VIEW,revision:workspace.revision,completeBackup:false,collectionCounts,omittedCollections:[...omittedCollections,'research','knowledge'],detailSources:{decisions:'/api/workspace/decisions/detail',observations:'/api/workspace/terminal/observation',marketKnowledge:'/api/workspace/market-knowledge/item',fullWorkspace:'/api/workspace'}}};
}
export function studioWorkspaceResponse(payload){return payload?.workspace?{...payload,...projectStudioWorkspace(payload.workspace)}:payload;}
