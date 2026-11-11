import {renderActionMenu} from './action-menu.mjs';

const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const icons={stop:'<rect x="7" y="7" width="10" height="10" rx="1"/>',play:'<path d="m9 5 11 7-11 7Z"/>',settings:'<path d="M4 7h16M4 17h16M8 4v6M16 14v6"/>',capital:'<path d="M3 7h18M3 17h18M6 4l3 16 3-12 3 12 3-16"/>'};
export const operationIcon=name=>'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+(icons[name]??icons.settings)+'</svg>';
function control(action,{icon,label=action.label,primary=false,currency}={}){
 const attrs=Object.entries(action.attributes??{}).filter(([key])=>/^data-[a-z0-9-]+$/.test(key)).map(([key,value])=>' '+key+'="'+esc(value)+'"').join('');
 const glyph=icon==='capital'&&currency&&currency!=='KRW'?'<span class="operation-currency" aria-hidden="true">'+esc(currency==='USD'?'$':currency==='BTC'?'₿':currency)+'</span>':operationIcon(icon);
 return '<button type="button" class="button small operation-control'+(primary?' operation-control-primary':' operation-control-icon')+'" data-operation-slot="'+(primary?'primary':icon)+'"'+attrs+' aria-label="'+esc(action.label)+'" title="'+esc(action.label)+'"'+(action.disabled?' disabled':'')+'>'+glyph+(primary?'<span>'+esc(label)+'</span>':'')+'</button>';
}

/** Presentation only. Each controller supplies its existing action and capability. */
export function renderOperationControls({id,primary,capital,settings,items=[],pending=false,currency='KRW'}={}){
 const tools=(capital?control({...capital,disabled:pending||capital.disabled},{icon:'capital',currency}):'')+(settings?control({...settings,disabled:pending||settings.disabled},{icon:'settings'}):'')+(items.length?renderActionMenu({id,label:'운용 더보기',compact:true,items:items.map(item=>({...item,disabled:pending||item.disabled}))}):'');
 if(!primary&&!tools)return '';
 return '<div class="operation-actions" data-operation-actions data-operation-key="'+esc(id)+'" role="group" aria-label="운용 제어"'+(pending?' aria-busy="true"':'')+'>'+(primary?control({...primary,disabled:pending||primary.disabled},{primary:true,icon:primary.icon,label:pending?'처리 중':primary.shortLabel}):'')+(tools?'<span class="operation-tools" role="group" aria-label="금액과 설정">'+tools+'</span>':'')+'</div>';
}
