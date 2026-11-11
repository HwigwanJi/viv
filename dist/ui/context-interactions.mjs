/** Entity actions are projected from their existing controls, including disabled states. */
export const CONTEXT_SURFACES=Object.freeze([
 {id:'notification',selector:'[data-context-entity="notification"]',label:'알림',actions:['열기','읽음 상태 변경','링크 복사','처리 완료 후 삭제','휴지통에서 복원']},
 {id:'mind',selector:'[data-mind-companion],[data-mind-entity]',label:'마인드',actions:['운용 보기','기록 보기','노드 편집','꾸미기','현재 상태의 운용·보관 작업']},
 {id:'operation',selector:'[data-context-entity="operation"]',label:'운용',actions:['현재 운용 설정','현재 상태에서 제공되는 원래 운용 작업','식별값 복사']},
 {id:'row',selector:'tbody tr',label:'행',actions:['대상의 기존 상세·편집·보관 작업','현재 행 복사']},
 {id:'activity',selector:'[data-context-entity="activity"],[data-mind-activity-card],[data-activity-kind]',label:'활동',actions:['당시 판단·주문·체결 원문','고정 정책','현재 제공되는 기록 작업']},
 {id:'card',selector:'article,.studio-template-card,[data-context-entity]',label:'항목',actions:['현재 카드의 기존 작업','현재 내용 복사']},
]);
export const CONTEXT_ENTITY_SELECTOR=CONTEXT_SURFACES.map(group=>group.selector).join(',');
export const CONTEXT_NATIVE_SELECTOR='input,textarea,select,[contenteditable]:not([contenteditable="false"])';
export const CONTEXT_CONTROL_SELECTOR='button,a[href],[role="button"]';
export const CONTEXT_NATIVE_REASONS=Object.freeze({
 editing:'입력·편집·선택 텍스트는 브라우저의 복사·붙여넣기 메뉴를 사용합니다.',
 navigation:'일반 링크는 새 탭 열기·주소 복사 메뉴를 유지합니다.',
 primitive:'탭·필터·양식·닫기·새로고침은 해당 직접 조작과 키보드 동작을 사용합니다.',
 graph:'전략 캔버스의 노드·연결·빈 공간은 편집기의 전용 메뉴를 사용합니다.',
 readonly:'읽기 전용 값은 텍스트 선택과 브라우저 복사 기능을 사용합니다.',
});
