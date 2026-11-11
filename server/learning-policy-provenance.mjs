import {hashInputPackage} from '../dist/domain/workspace.mjs';
import {strategyGraphHash} from '../dist/domain/strategy-graph.mjs';
import {adoptStrategyLearningProposal} from '../dist/domain/strategy-learning.mjs';
import {StrategyLearningStore} from './strategy-learning-store.mjs';

const CONTRACT='STRATEGY_LEARNING_POLICY_PROVENANCE_V1';
const check=(value,code,message)=>{if(!value)throw Object.assign(new Error(message),{code,status:409});};
const clone=structuredClone;

/** Evidence describes its original research graph; a later edit retains that lineage. */
export function learningPolicyProvenance(session,adoption,graph){
 const {hash,...plan}=session?.plan??{};
 check(session?.status==='COMPLETED'&&hashInputPackage(plan)===hash&&session.proposal?.planHash===hash,'LEARNING_POLICY_SOURCE','완료된 원학습과 계획 해시를 확인하세요.');
 const expected=adoptStrategyLearningProposal({proposal:session.proposal,currentGraph:session.plan.graph,adoptedAt:adoption?.adoptedAt}).adoption;
 check(adoption?.hash===expected.hash,'LEARNING_POLICY_ADOPTION','원학습의 채택 영수증을 확인하세요.');
 return {contractVersion:CONTRACT,learningSessionId:session.id,planHash:hash,proposalHash:session.proposal.hash,adoptionHash:expected.hash,candidateGraphHash:expected.candidateGraphHash,adoptedAt:expected.adoptedAt,evidenceClass:'RETROSPECTIVE_DEVELOPMENT',forwardValidation:'REQUIRED',graphRelationship:strategyGraphHash(graph)===expected.candidateGraphHash?'ADOPTED_CANDIDATE':'USER_EDITED_DERIVATIVE'};
}

export function syncLearningPolicyGraph(document){
 const evidence=document?.data?.learningProvenance;
 if(evidence)evidence.graphRelationship=strategyGraphHash(document.data.strategyPlan.graph)===evidence.candidateGraphHash?'ADOPTED_CANDIDATE':'USER_EDITED_DERIVATIVE';
 return document;
}

/** Server-only creation context; ordinary HTTP input never supplies this authority. */
export async function applyLearningPolicyProvenance(workspace,document,{db,owner,pending=null}={}){
 const claimed=document.data.learningProvenance,id=pending?.sessionId??claimed?.learningSessionId;
 if(!id)return document;
 const head=(workspace.learningSessions??[]).find(s=>s.id===id);
 check(head?.mindId===document.scope.profileId,'LEARNING_POLICY_SOURCE','같은 소유자와 마인드의 원학습 기록을 가져오세요.');
 const session=await new StrategyLearningStore(db).unpack(owner,head),adoption=pending?.adoption??session.adoption;
 const evidence=learningPolicyProvenance(session,adoption,document.data.strategyPlan.graph);
 check(evidence.adoptedAt<=document.availableAt,'LEARNING_POLICY_TIME','채택 이후의 정책 문서 시각을 사용하세요.');
 if(pending){
  check(evidence.graphRelationship==='ADOPTED_CANDIDATE','LEARNING_POLICY_GRAPH','검증한 후보 그래프를 그대로 초안에 저장하세요.');
  document.data.learningProvenance=clone(evidence);
 }else check(hashInputPackage(claimed)===hashInputPackage(evidence),'LEARNING_POLICY_PROVENANCE','초안의 학습 출처를 원계획·제안·채택 해시와 대조하세요.');
 document.provenance.recordRefs=[...new Set([...document.provenance.recordRefs,id])];
 document.provenance.contentHashes=[...new Set([...document.provenance.contentHashes,evidence.planHash,evidence.proposalHash,evidence.adoptionHash])];
 return document;
}
