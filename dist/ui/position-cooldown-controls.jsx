import React from 'react';

export function positionMetricConfig(config,metricId){
 const {cooldownMs,intentNodeId,cooldownScope,...rest}=config;
 return {...rest,metricId,...(metricId==='INTENT_COOLDOWN_READY'?{cooldownMs:cooldownMs??86400000,intentNodeId:intentNodeId??'profit-stage-0-sell',...(cooldownScope?{cooldownScope}:{})}:{})};
}
export function PositionCooldownControls({data}){
 const c=data.node.config;if(c.kind!=='POSITION'||c.metricId!=='INTENT_COOLDOWN_READY')return null;
 const patch=change=>data.onPatch(data.node,{config:{...c,...change}}),nodes=data.graph.nodes.filter(n=>n.type==='QUANT'&&n.config.sellIntent==='TAKE_PROFIT');
 return <section aria-label="구간 매도 재실행 간격"><label className="field">연결한 익절 동작<select aria-label="재실행을 기다릴 익절 노드" value={c.intentNodeId} disabled={data.saving} onChange={e=>patch({intentNodeId:e.target.value})}>{!nodes.some(n=>n.id===c.intentNodeId)&&<option value={c.intentNodeId}>{c.intentNodeId}</option>}{nodes.map(n=><option key={n.id} value={n.id}>{n.label||n.id}</option>)}</select></label><label className="field">체결 후 대기 · 시간<input type="number" min="0" step="1" aria-label="구간 익절 후 대기 시간" value={c.cooldownMs/3600000} disabled={data.saving} onChange={e=>patch({cooldownMs:Math.round(Number(e.target.value)*3600000)})}/></label><label className="field">대기 범위<select aria-label="익절 재실행 대기 범위" value={c.cooldownScope??'ASSET'} disabled={data.saving} onChange={e=>patch({cooldownScope:e.target.value})}><option value="ASSET">종목 전체 체결</option><option value="POSITION">현재 보유 회차</option></select></label><p>같은 종목·익절 동작의 실제 체결부터 기다립니다. 현재 보유 회차를 선택하면 전량 청산 후 새로 진입할 때 이전 회차의 대기가 끝납니다. 서버 재시작과 미체결은 대기 시간을 초기화하지 않습니다.</p></section>;
}
