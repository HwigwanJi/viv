const DAY=86400000;
/** The period picker uses one named reference series; all trading frames use the full frozen universe. */
export function buildPortfolioBenchmarkCatalog(bundle){
 const dataset=bundle.datasets.find(d=>d.market==='BTC-ETH'),startAt=bundle.index.coverage.startAt,endAt=bundle.index.coverage.endAt;
 if(!dataset?.rows?.length)throw new TypeError('기간 선택용 ETH/BTC 자료를 확인하세요.');
 const rows=dataset.rows,stride=Math.max(1,Math.ceil(rows.length/400)),overview=rows.filter((r,i)=>i%stride===0||i===rows.length-1).map(r=>[r.time,r.close]);
 const definition=[['training-2024','학습 · 2024','2024-01-01T00:00:00.000Z','2025-01-01T00:00:00.000Z'],['forward-2025','검증 · 2025~최근','2025-01-01T00:00:00.000Z',endAt],['recent-90','최근 90일',new Date(Date.parse(endAt)-90*DAY).toISOString(),endAt]];
 const presets=definition.map(([id,label,a,b])=>{const selected=rows.filter(r=>r.time>=a&&r.closeTime<=b),available=a>=startAt&&b<=endAt&&selected.length>0;return {id,label,startAt:a,endAt:b,available,...(available?{priceReturn:selected.at(-1).close/selected[0].open-1,barCount:selected.length}:{})};});
 return {version:'portfolio-period-picker-v1',timeframe:'1d',stepMs:DAY,instrumentId:'crypto:upbit:BTC-ETH',datasetSha256:bundle.indexSha256,sourceStartAt:startAt,sourceEndAt:endAt,displayLabel:'ETH/BTC · 업비트 · 일봉',returnLabel:'ETH/BTC 참고 수익률',helpText:'ETH/BTC 가격은 테스트 기간을 고르는 참고 그래프입니다. 실제 전략은 마인드에 등록한 전체 BTC 마켓 종목을 선별합니다. 양 끝을 끌거나 방향키로 하루씩 조정하세요. 학습과 검증 프리셋은 서로 겹치지 않는 달력 구간입니다.',defaultPresetId:'forward-2025',overview,presets,source:{datasetId:bundle.index.id,market:dataset.market,role:'PERIOD_SELECTION_REFERENCE'}};
}
