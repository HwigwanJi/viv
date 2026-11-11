const kinds={'mind-policy':'전략 정책','market-context':'시장 참고 자료','trade-review':'거래 복기','principle-evidence':'원칙 검증 자료','weight-proposal':'가중치 변경안','market-knowledge':'공용 투자 자료'};
const sourceTypes={'system-export':'시스템 내보내기','user-note':'사용자 작성','user-upload':'파일 가져오기','external':'외부 자료','saved-record':'운용 기록'};
/** A document's publication effect follows its existing consumer, never its filename or title. */
export function mindDocumentImpact(doc,{profileName='대상 마인드',currentPolicy=null}={}){
 const kind=doc.kind,source=doc.source??{},policy=kind==='mind-policy',weight=kind==='weight-proposal';
 const effects={
  'mind-policy':['발행 정책',profileName+' · 정책 v'+doc.data?.version,'검토한 정책 버전을 발행합니다. 진행 중인 실전 운용은 해당 운용의 정책 변경 경로에서 반영합니다.'],
  'market-context':['참고 자료',profileName+' · 시장 맥락 자료함','승인된 참고 자료로 저장합니다. 자료 연결 설정이 있는 판단에서 사용 여부를 확인합니다.'],
  'trade-review':['학습 근거',profileName+' · 거래 복기 자료함','검토한 거래 결과를 학습 근거로 저장합니다. 예측 모델의 재학습·교체는 별도 학습 경로에서 수행합니다.'],
  'principle-evidence':['학습 근거',profileName+' · 원칙 검증 자료함','원칙의 성과와 반례를 검토 자료로 저장합니다. 가중치·모델 변경은 변경안 검증 경로로 이어집니다.'],
  'weight-proposal':['가중치 변경안',profileName+' · 기억 가중치','독립 표본과 통제 비교 검증을 충족한 변경안을 승인하고 저장된 가중치 변경을 적용합니다.'],
  'market-knowledge':['공용 참고 자료','공용 투자 자료 → 연결한 마인드의 자료 입력','분류와 출처를 검토해 공용 자료로 발행합니다. 사용 정책이 연결된 마인드의 다음 자료 수집에서 선택될 수 있습니다.']
 };
 const [purpose,destination,effect]=effects[kind]??['검토 자료',profileName+' · 자료함','원문과 적용 경로를 확인한 뒤 발행합니다.'];
 const changed=[];if(policy&&currentPolicy){const previous=currentPolicy.data??{},next=doc.data??{};for(const [key,label]of [['strategyPlan','노드 구성'],['universe','투자 범위'],['profileSettings','기본 설정'],['externalKnowledge','외부 자료 연결'],['principles','투자 원칙'],['strategySettings','판단 설정']])if(JSON.stringify(previous[key])!==JSON.stringify(next[key]))changed.push(label);}
 return {kindLabel:kinds[kind]??'검토 자료',purpose,destination,effect,action:policy?'변경 검토':weight?'검증 결과 검토':'자료 검토',sourceLabel:sourceTypes[source.type]??source.type??'출처 미기록',sourceId:source.id??null,sourceUri:source.uri??null,version:policy?doc.data?.version:null,currentVersion:currentPolicy?.data?.version??null,changes:changed};
}
