const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const code=value=>'<code>'+esc(value)+'</code>';
const table=(headers,rows)=>'<div class="studio-table-scroll"><table class="studio-table"><thead><tr>'+headers.map(h=>'<th scope="col">'+h+'</th>').join('')+'</tr></thead><tbody>'+rows.map(row=>'<tr>'+row.map(cell=>'<td>'+cell+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';
const ports=items=>items.map(p=>code(p.id)+': '+esc(p.dataType)).join('<br>')||'없음';
const expanded=(state,id,fallback=false)=>(Object.hasOwn(state,id)?state[id]:fallback)?' open':'';
const ontologySection=(ontology,state)=>!ontology?'':'<details class="studio-sheet spaced" data-capability-group data-capability-group-id="ontology"'+expanded(state,'ontology')+'><summary class="studio-sheet-body">부품 온톨로지 · '+esc(ontology.version)+'</summary><p class="studio-sheet-body">종목의 정체성, 자료의 시점, 판단과 주문의 관계를 같은 정의에서 읽습니다. 종목 참조는 거래소·거래쌍·통화를 포함합니다. 종목 변수를 포트로 연결하는 기능은 다음 구현 단계입니다.</p>'+table(['모범 사례','이번 적용'],(ontology.references??[]).map(row=>['<a href="'+esc(row.url)+'" target="_blank" rel="noopener noreferrer">'+esc(row.label)+'</a>',esc(row.adopted)]))+table(['역할 코호트','역할','출력 의미'],Object.values(ontology.cohorts).map(row=>[esc(row.label),code(row.operation),code(row.result)]))+table(['대상','식별 기준','속성'],Object.values(ontology.entities).map(row=>[esc(row.label),esc(row.identity.join(' + ')||'값 자체'),esc(row.dimensions.join(', '))]))+table(['관계','시작 대상','연결 대상'],ontology.relations.map(row=>[code(row.id),esc(ontology.entities[row.from].label),esc(ontology.entities[row.to].label)]))+'<details class="studio-sheet-body"><summary>자료형·변수 범위·불변 규칙</summary><pre>'+esc(JSON.stringify(ontology,null,2))+'</pre></details></details>';
const actions=items=>table(['기능 / 식별값','호출 경로','입력 / 출력','실행 계약'],items.map(action=>[
 '<strong>'+esc(action.title)+'</strong><br>'+code(action.id)+'<p>'+esc(action.description)+'</p>',
 code(action.api? action.api.method+' '+action.api.path:action.implementation_binding),
 '필수: '+esc(action.inputs.join(', ')||'없음')+'<br>선택: '+esc((action.optional_inputs??[]).join(', ')||'없음')+'<br>출력: '+esc(action.outputs.join(', ')),
 esc(action.enforcement==='SHARED_CONTRACT'?'공용 입력 검사':'등록된 실행 연결')+'<br>'+esc(action.surfaces.join(', '))+'<details><summary>계약 보기</summary><pre>'+esc(JSON.stringify(action,null,2))+'</pre></details>',
 ]));
export function filterCapabilityCatalog(catalog,query,openGroups={}){
 const normalize=value=>String(value??'').normalize('NFKC').toLocaleLowerCase().replaceAll('_',' '),terms=normalize(query).trim().split(/\s+/).filter(Boolean);
 let count=0;
 for(const row of catalog.querySelectorAll('tbody tr')){const text=normalize(row.textContent);row.hidden=!terms.every(term=>text.includes(term));if(!row.hidden)count++;}
 for(const group of catalog.querySelectorAll('[data-capability-group]')){group.hidden=terms.length>0&&![...group.querySelectorAll('tbody tr')].some(row=>!row.hidden);group.open=terms.length>0?!group.hidden:Object.hasOwn(openGroups,group.dataset.capabilityGroupId)?openGroups[group.dataset.capabilityGroupId]:group.dataset.defaultOpen==='true';}
 catalog.querySelector('[data-capability-count]').textContent=terms.length?(count?count+'개 검색 결과':'검색 결과가 없습니다. 검색어를 바꾸거나 지워 보세요.'):'';
 catalog.querySelector('[data-capability-clear]').hidden=!query;
 return count;
}
export function renderCapabilityCatalog({data,error,loading,openGroups={},query=''}={}){
 if(error&&!data)return '<p role="alert">'+esc(error)+'</p>';
 if(!data)return '<p role="status">기능 목록을 불러오는 중…</p>';
 const {nodes,actions:all,nodeContract}=data,shared=all.filter(a=>a.enforcement==='SHARED_CONTRACT'),other=all.filter(a=>a.enforcement!=='SHARED_CONTRACT');
  return '<div data-capability-catalog>'+(error?'<p class="error-text" role="alert">목록을 갱신하지 못했습니다. 이전 목록을 표시합니다. '+esc(error)+'</p>':'')+'<p>'+nodes.length+'개 노드와 '+all.length+'개 액션. 공용 입력 검사 '+shared.length+'개. '+(loading?'갱신 중…':'')+'</p><div class="studio-catalog-search"><label class="field">기능 찾기<input type="search" data-capability-search value="'+esc(query)+'" placeholder="이름, 노드 종류, API 경로…"></label><button type="button" class="button small" data-studio-action="capability-search-clear" data-capability-clear'+(query?'':' hidden')+'>검색어 지우기</button><span data-capability-count role="status" aria-live="polite"></span></div>'+
  '<details class="studio-sheet" data-capability-group data-capability-group-id="nodes" data-default-open="true"'+expanded(openGroups,'nodes',true)+'><summary class="studio-sheet-body">전략 노드 '+nodes.length+'개</summary><p class="studio-sheet-body">입출력은 기본 설정 기준입니다. 노드 종류와 설정에 따른 연결 규칙은 편집기와 컴파일러가 같은 계약에서 계산합니다.</p><div class="studio-catalog-results">'+table(['노드','역할 코호트','기능','기본 입력','기본 출력'],nodes.map(n=>['<strong>'+esc(n.title)+'</strong><br>'+code(n.type),esc(data.ontology?.cohorts[n.cohort]?.label??n.cohort??'미분류'),esc(n.description),ports(n.defaultPorts.inputs),ports(n.defaultPorts.outputs)]))+'</div><details class="studio-sheet-body"><summary>노드 실행 계약</summary><pre>'+esc(JSON.stringify(nodeContract,null,2))+'</pre></details></details>'+
  ontologySection(data.ontology,openGroups)+'<details class="studio-sheet spaced" data-capability-group data-capability-group-id="automation"'+expanded(openGroups,'automation')+'><summary class="studio-sheet-body">자동 운용 액션 '+shared.length+'개</summary><div class="studio-catalog-results">'+actions(shared)+'</div></details>'+
  '<details class="studio-sheet spaced" data-capability-group data-capability-group-id="actions"'+expanded(openGroups,'actions')+'><summary class="studio-sheet-body">전체 액션 '+other.length+'개 더 보기</summary><div class="studio-catalog-results">'+actions(other)+'</div></details></div>';
}
