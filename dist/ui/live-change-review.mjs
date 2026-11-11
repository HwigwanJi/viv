import {currencyAmount} from './currency-format.mjs';

const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=(value,currency)=>currencyAmount(Number(value),currency,Number.isInteger(Number(value))?0:2)+(currency==='KRW'?'원':' '+currency);
export function readableLiveChanges(rows){
 return rows.flatMap(row=>{
  if(row.field!=='세부 설정')return [row];
  let a,b;try{a=JSON.parse(row.before);b=JSON.parse(row.after);}catch{return [row];}
  const choices=v=>Array.isArray(v)&&v.length>0&&new Set(v.map(c=>c?.id)).size===v.length&&v.every(c=>c&&typeof c.id==='string'&&typeof c.description==='string');
  if(!choices(a)||!choices(b))return [row];
  const changes=[];
  for(const id of new Set([...a,...b].map(c=>c.id))){
   const before=a.find(c=>c.id===id),after=b.find(c=>c.id===id),name=after?.label??before?.label??id;
   if(!before||!after){changes.push({name:row.name,field:name,state:after?'선택지 추가':'선택지 제거'});continue;}
   for(const [key,label]of [['label','이름'],['description','판단 기준']])if(before[key]!==after[key])changes.push({name:row.name,field:name+' '+label,before:before[key]??id,after:after[key]??id});
  }
  if(a.length===b.length&&a.every(c=>b.some(v=>v.id===c.id))&&a.some((c,i)=>c.id!==b[i].id))changes.push({name:row.name,field:'선택지 순서',before:a.map(c=>c.label??c.id).join(', '),after:b.map(c=>c.label??c.id).join(', ')});
  return changes.length?changes:[row];
 });
}
export function liveChangeReview({name,before={},after={},changes=[]}={}){
 const currency=after.quoteCurrency??before.quoteCurrency??'KRW',rows=[];
 for(const [key,label,format]of [['perOrderLimit','1회 주문 한도',v=>money(v,currency)],['maxJevCallsPerDay','일 AI 호출 한도',v=>v+'회']]){
  const same=Number(before[key])===Number(after[key]);
  if(after[key]===undefined||key==='maxJevCallsPerDay'&&(before[key]===undefined||same))continue;
  rows.push({label,before:before[key]===undefined||same?null:format(before[key]),after:format(after[key])});
 }
 return {name:name??'현재 운용',rows,changes,capital:after.capitalLimit??before.capitalLimit,currency,marketIds:after.marketIds??before.marketIds??[],nodeCount:after.graph?.nodes?.length??null};
}
export function renderLiveChangeReview(review){
 const changes=readableLiveChanges(review.changes??[]),details=changes.map(row=>`<li><span>${esc(row.name)}${row.field?' / '+esc(row.field):''}</span><strong>${row.state?esc(row.state):esc(row.before)+' → '+esc(row.after)}</strong></li>`).join('');
 return `<div class="live-change-review"><p class="live-change-name">${esc(review.name)}</p>${review.summary?`<p class="live-change-summary">${esc(review.summary)}</p>`:''}${review.rows.length?`<dl class="live-change-values">${review.rows.map(row=>`<div><dt>${esc(row.label)}</dt><dd>${row.before?`<span class="live-change-before">${esc(row.before)}</span><span aria-label="변경 후">→</span>`:''}<strong>${esc(row.after)}</strong></dd></div>`).join('')}</dl>`:''}${changes.length?`<p class="live-change-node-count">노드 변경 ${changes.length}개</p>`:''}${review.capital!==undefined?`<p class="live-change-preserved">총 배정액 ${esc(money(review.capital,review.currency))} 유지</p>`:''}${changes.length||review.marketIds.length?`<details><summary>변경 상세${changes.length?' '+changes.length+'개':''}</summary>${details?`<ul>${details}</ul>`:''}${review.nodeCount?`<p>전략 노드 ${review.nodeCount}개</p>`:''}${review.marketIds.length?`<p>투자 범위 ${review.marketIds.map(esc).join(', ')}</p>`:''}</details>`:''}</div>`;
}
