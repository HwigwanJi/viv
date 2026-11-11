import {MindDocumentError,mindDocumentHash} from '../dist/domain/mind-manifest.mjs';

export const MIND_INPUT_REQUIREMENTS_POLICY='ELIGIBLE_REQUIRED_INPUTS_V2';
const CONTEXT_IDS=new Set(['macro','news','price','flow','onchain','event']);
const labels={'price-ohlcv':'확정 가격·거래량','approved-memory':'승인 기억','external-knowledge':'연결한 시장 자료',macro:'매크로 자료',news:'뉴스 자료',price:'가격 맥락',flow:'자금 흐름',onchain:'온체인 자료',event:'이벤트 자료'};

/** Availability is derived from eligible selections, never configured status. */
export function mindInputAvailability(manifest,{price,contextSelection,memorySelection,knowledgeSelection}){
  const inputs=structuredClone(manifest.data.inputs);
  for(const id of ['price-ohlcv','approved-memory','macro','news','external-knowledge'])
    if(!inputs.some(input=>input.id===id))inputs.push({id,status:'unavailable',required:id==='price-ohlcv',sourceRefs:[]});
  return inputs.map(input=>{
    if(input.id==='price-ohlcv')return {...input,status:price?.closedBars?.length?'connected':'unavailable',sourceRefs:price?.source?.barsSha256?[price.source.barsSha256]:[],transmittedCount:price?.closedBars?.length??0};
    const contextual=contextSelection.selected.filter(doc=>doc.data.category===input.id),publicCategory=input.id==='news'?'news':input.id==='macro'?'macro-release':null;
    const publicSignals=publicCategory?knowledgeSelection.selected.filter(doc=>doc.sourceType===publicCategory):[];
    const selected=input.id==='approved-memory'?memorySelection.selected:input.id==='external-knowledge'?knowledgeSelection.selected:[...contextual,...publicSignals];
    const sourceDetails=selected.map(doc=>({sourceKind:knowledgeSelection.selected.includes(doc)?'MARKET_KNOWLEDGE':input.id==='approved-memory'?'APPROVED_MEMORY':'MARKET_CONTEXT',sourceId:doc.id,contentHash:doc.contentHash??(doc.kind?mindDocumentHash(doc):null),availableAt:doc.availableAt??null}));
    return {...input,status:selected.length?'approved-context':'unavailable',sourceRefs:[...new Set(selected.map(doc=>doc.id))],sourceDetails,transmittedCount:selected.length,countBasis:'ELIGIBLE_TRANSMITTED_RECORDS',...(input.id==='external-knowledge'?{enabled:knowledgeSelection.enabled}:{})};
  });
}

export function assertRequiredMindInputs(manifest,selections,{now,phase='decision'}={}){
  const availability=mindInputAvailability(manifest,selections);
  const blockedInputs=availability.filter(input=>input.required&&input.transmittedCount===0).map(input=>({
    id:input.id,reason:input.id==='external-knowledge'&&!selections.knowledgeSelection.enabled?'EXTERNAL_KNOWLEDGE_DISABLED':!['price-ohlcv','approved-memory','external-knowledge'].includes(input.id)&&!CONTEXT_IDS.has(input.id)?'UNSUPPORTED_REQUIRED_INPUT':'NO_ELIGIBLE_INPUT',
    message:(labels[input.id]??input.id)+'의 사용 가능한 승인 자료를 연결하세요.',sourceRefs:[],transmittedCount:0,
  }));
  const inputRequirementPolicy={version:MIND_INPUT_REQUIREMENTS_POLICY,manifestId:manifest.id,manifestHash:mindDocumentHash(manifest),evaluatedAt:now,phase};
  if(blockedInputs.length){
    const error=new MindDocumentError('MIND_REQUIRED_INPUTS_UNAVAILABLE','필수 자료를 준비하세요: '+blockedInputs.map(input=>labels[input.id]??input.id).join(', '));
    Object.assign(error,{status:409,blockedInputs,inputRequirementPolicy});throw error;
  }
  return {availability,inputRequirementPolicy};
}
