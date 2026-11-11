import {helpLabel} from './help-tooltip.mjs';

const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

/** One set of cells serves the desktop table and labelled mobile records. */
export function renderDataTable(columns,rows,{className=''}={}){
  const fields=columns.map(column=>typeof column==='string'?{label:column}:column);
  const heading=field=>field.help?helpLabel(field.label,field.help):esc(field.label);
  return '<div class="studio-table-scroll"><table role="table" class="studio-table studio-table-responsive'+(className?' '+className:'')+'">'+
    (fields.some(f=>f.widthClass)?'<colgroup>'+fields.map(f=>'<col'+(f.widthClass?' class="'+esc(f.widthClass)+'"':'')+'>').join('')+'</colgroup>':'')+
    '<thead role="rowgroup"><tr role="row">'+fields.map(f=>'<th role="columnheader" scope="col"'+(f.numeric?' class="text-right"':'')+'>'+heading(f)+'</th>').join('')+'</tr></thead><tbody role="rowgroup">'+rows.map(cells=>'<tr role="row">'+cells.map((cell,i)=>'<td role="cell"'+(fields[i].numeric?' class="text-right tabular-nums"':'')+'><span class="studio-table-cell-label">'+heading(fields[i])+'</span><div class="studio-table-cell-value">'+cell+'</div></td>').join('')+'</tr>').join('')+'</tbody></table></div>';
}
