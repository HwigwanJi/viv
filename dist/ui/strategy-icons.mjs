// One 24-unit, round-stroke vocabulary for the editor, component library and SVG exports.
const path=d=>['path',{d}],circle=(cx,cy,r)=>['circle',{cx,cy,r}],rect=(x,y,width,height,rx=2)=>['rect',{x,y,width,height,rx}];
export const STRATEGY_ICONS=Object.freeze(Object.fromEntries([
 ['variable','변수',[path('M8 4H6v6l-3 2 3 2v6h2m8-16h2v6l3 2-3 2v6h-2M10 9l4 6m0-6-4 6')]],
 ['instrument','종목',[circle(9,9,6),path('M15 8a6 6 0 1 1-7 7M7 7h4m-2 0v4')]],
 ['timeframe','봉 주기',[circle(12,12,9),path('M12 7v5l3 2')]],
 ['number','숫자',[path('m10 3-2 18m8-18-2 18M4 8h17M3 16h17')]],
 ['text','텍스트',[path('M4 5h16M12 5v15M8 20h8')]],
 ['boolean','참·거짓',[rect(3,7,18,10,5),circle(8,12,2)]],
 ['candles','시세',[path('M6 3v18m6-16v14m6-17v20'),rect(4,7,4,8,1),rect(10,9,4,6,1),rect(16,5,4,8,1)]],
 ['database','자료',[['ellipse',{cx:12,cy:5,rx:8,ry:3}],path('M4 5v14c0 4 16 4 16 0V5M4 12c0 4 16 4 16 0')]],
 ['book','호가',[path('M4 4h6v16H4M14 4h6v16h-6M4 8h4m-4 4h4m-4 4h4m8-8h4m-4 4h4m-4 4h4')]],
 ['portfolio','계좌',[rect(3,5,18,15),path('M7 5V3h10v2M3 11h18m-11-2v4h4V9')]],
 ['documents','자료·기억',[path('M7 3h10l4 4v12H7ZM17 3v5h4M3 7v14h14M10 12h7m-7 4h5')]],
 ['universe','후보 종목',[circle(6,7,3),circle(18,7,3),circle(12,18,3),path('m8 10 3 5m5-5-3 5M9 7h6')]],
 ['formula','계산',[path('M18 4H7l7 8-7 8h11M3 4h1m-1 8h1m-1 8h1')]],
 ['model','학습 모델',[rect(8,8,8,8),circle(4,4,2),circle(20,4,2),circle(4,20,2),circle(20,20,2),path('m6 6 2 2m8 0 2-2M6 18l2-2m8 0 2 2M11 11h2v2h-2')]],
 ['compare','조건 비교',[path('m12 3 9 9-9 9-9-9ZM8 10h8m-8 4h8')]],
 ['logic','조건 조합',[path('M3 6h5m-5 12h5M8 4h4a8 8 0 0 1 0 16H8ZM20 12h2')]],
 ['branch','분기',[path('M4 12h6m0 0 6-7h5m-11 7 6 7h5'),circle(10,12,2)]],
 ['merge','결합',[path('M3 5h4l6 7h8M3 19h4l6-7m4-3 4 3-4 3')]],
 ['rank','순위',[path('M4 6h8M4 12h12M4 18h16m-3-15 3 3 3-3M20 3v7')]],
 ['filter','필터',[path('M3 4h18l-7 9v6l-4 2v-8Z')]],
 ['select','선택',[rect(3,3,18,18),path('m7 12 3 3 7-7')]],
 ['allocate','배분',[circle(12,12,9),path('M12 3v9h9M12 12l-6 7')]],
 ['decision','투자 결정',[path('M7 20V4m-4 4 4-4 4 4m6-4v16m-4-4 4 4 4-4')]],
 ['guard','실행 검사',[path('m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6Zm-4 9 3 3 5-6')]],
 ['execute','주문 실행',[path('m3 11 18-8-8 18-2-8-8-2Zm8 2L21 3')]],
 ['question','AI 질문',[rect(3,4,18,14),path('m7 18-2 3m6-12a2 2 0 1 1 3 2l-2 1m0 3h.01')]],
 ['component','컴포넌트',[rect(3,3,7,7),rect(14,3,7,7),rect(3,14,7,7),rect(14,14,7,7)]],
 ['link','연결',[path('m10 14 4-4m-5 7-2 2a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0m2-2 2-2a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0')]],
 ['fit','전체 보기',[path('M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5'),rect(8,8,8,8,1)]],
 ['plus','추가',[path('M12 4v16M4 12h16')]],
 ['undo','되돌리기',[path('m8 4-5 5 5 5M3 9h10a7 7 0 0 1 0 14')]],
 ['close','닫기',[path('m6 6 12 12M6 18 18 6')]],
 ['explore','전략 탐험',[circle(12,12,9),path('m16 8-2 6-6 2 2-6ZM10 10l4 4')]],
 ['more','더보기',[circle(5,12,1),circle(12,12,1),circle(19,12,1)]],
 ['arrange','자동 정렬',[rect(3,3,6,6,1),rect(15,3,6,6,1),rect(9,15,6,6,1),path('M6 9v3h12V9m-6 3v3')]],
].map(([id,label,shapes])=>[id,Object.freeze({id,label,shapes})])));
const lookup=(map,key,fallback)=>Object.hasOwn(map,key)?map[key]:fallback;
const nodeIcons={MARKET_STATE:'formula',PORTFOLIO_EXPERT:'decision',PORTFOLIO_ROUTER:'allocate',CHOICE_LIST:'variable',REGIME_INPUT:'variable',REGIME_CLASSIFIER:'compare',STRATEGY_REFERENCE:'component',REGIME_ROUTER:'branch',INPUT:'database',VALUE:'variable',SIGNAL:'formula',MODEL:'model',CONDITION:'compare',BOOLEAN_LOGIC:'logic',JEV_QUESTION:'question',JEV:'question',VIBE:'question',QUANT:'decision',ROUTER:'branch',DECISION_ROUTER:'branch',COMBINER:'merge',DECISION_MIXER:'merge',FILTER:'filter',ASSET_FILTER:'filter',ASSET_METRIC:'formula',ASSET_REDUCE:'formula',ASSET_COMPARE:'compare',ASSET_LOGIC:'logic',RANK:'rank',SELECT:'select',MEMBER:'select',ALLOCATE:'allocate',REBALANCE:'allocate',RISK:'guard',ORDER:'execute',SESSION_SIGNAL:'formula',SESSION_RULE:'decision',SESSION_TREND:'decision'};
export function strategyIconId(node){if(typeof node==='string')return lookup(nodeIcons,node,Object.hasOwn(STRATEGY_ICONS,node)?node:'component');if(node?.type==='VALUE')return lookup({INSTRUMENT:'instrument',TIMEFRAME:'timeframe',NUMBER:'number',TEXT:'text',BOOLEAN:'boolean'},node.config?.dataType,'variable');if(node?.type==='INPUT')return lookup({OHLCV:'candles',MICROSTRUCTURE:'book',EXECUTION_ASSET:'instrument',ASSET_SET:'universe',POSITION:'portfolio',CONTEXT:'database',MEMORY:'documents',KNOWLEDGE:'documents',METRIC:'formula',SELECTION:'select',CAMPAIGN:'branch'},node.config?.kind,'database');return lookup(nodeIcons,node?.type,'component');}
const escape=v=>String(v).replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;');
export function strategyIconSvg(id,{symbol=false}={}){const icon=lookup(STRATEGY_ICONS,id,null);if(!icon)throw new TypeError('등록된 아이콘을 선택하세요.');const content=icon.shapes.map(([tag,attrs])=>'<'+tag+' '+Object.entries(attrs).map(([k,v])=>k+'="'+escape(v)+'"').join(' ')+'/>').join('');return symbol?'<symbol id="'+id+'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'+content+'</symbol>':'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'+content+'</svg>';}
