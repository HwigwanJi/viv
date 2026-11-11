const existingFields = {
  'mean-reversion': [['window','조회 기간','봉',2,500,1],['entryDeviation','매수 기준 이탈률','%',.1,50,.1],['exitDeviation','매도 기준 이탈률','%',0,49,.1]],
  trend: [['shortWindow','단기 이동평균','봉',2,100,1],['longWindow','장기 이동평균','봉',3,500,1],['threshold','추세 기준','%',0,50,.1]],
  'cross-venue-spread': [['entryGap','진입 기준 가격 차이','%',.1,50,.1],['exitGap','청산 기준 가격 차이','%',0,49,.1]],
};
const hints={
  shortWindow:'단기 이동평균을 계산할 봉 수입니다.',longWindow:'단기 이동평균 기간보다 길게 설정합니다.',breakoutWindow:'현재 봉을 제외한 이전 고점과 비교합니다.',
  trendThreshold:'단기·장기 평균 차이와 가격 움직임의 기준입니다.',minOpportunity:'설정한 가격 조건을 얼마나 충족하는지 나타내는 점수입니다.',
  baseWeightRatio:'종목별 최대 비중에 곱하는 기본 투입 비율입니다.',addProfitThreshold:'이 기준 이상 수익 중일 때만 추가 매수합니다.',trailingStopRatio:'매수 후 최고 가격 대비 하락률입니다.',
};
const fieldLabels={shortWindow:'단기 이동평균 기간',longWindow:'장기 이동평균 기간',breakoutWindow:'돌파 확인 기간',trendThreshold:'추세 기준',addProfitThreshold:'추가 매수 최소 수익률',trailingStopRatio:'고점 대비 청산 하락률',baseWeightRatio:'기본 투입 비율'};
export function getStrategyFields(definition){
  if(!definition.parameterSchema?.length)return (existingFields[definition.id]||[]).map(field=>[...field,field[2]==='%'?'진입과 청산 조건을 조정합니다.':'조회 기간의 종가를 사용합니다.']);
  return definition.parameterSchema.map(f=>{const ratio=f.unit==='ratio',unit=f.key==='minOpportunity'?'점':ratio?'%':f.unit;return [f.key,fieldLabels[f.key]||f.label,unit,ratio?f.min*100:f.min,ratio?f.max*100:f.max,ratio?Number((f.step*100).toFixed(8)):f.step,hints[f.key]||''];});
}
export const isScaledUnit=unit=>unit==='%'||unit==='점';
export const regimeLabel=regime=>({quiet:'횡보',trending:'상승 추세',burning:'강한 상승 추세',cooling:'하락·추세 둔화',unknown:'자료 부족'})[regime]||'확인 전';
export function indicatorView(key,value){
  const labels={averagePrice:'평균 가격',deviation:'평균 대비 이탈률',shortAverage:'단기 이동평균',longAverage:'장기 이동평균',gap:'이동평균 차이',lossRatio:'손실률',opportunityScore:'기회 점수',previousHigh:'이전 최고 가격',trendGap:'단기·장기 이동평균 차이',momentum:'가격 변화율',breakoutDistance:'이전 고점 대비 차이',closeVolatility:'종가 변동성',positionPnlRatio:'보유 평가수익률',highWaterPrice:'매수 후 최고 가격',trailingDrawdown:'최고 가격 대비 하락률',targetWeightFactor:'최대 비중 대비 투입 비율'};
  const prices=['averagePrice','shortAverage','longAverage','previousHigh','highWaterPrice'];
  const money=new Intl.NumberFormat('ko-KR',{maximumFractionDigits:0});
  return {label:labels[key]||'추가 지표',value:key==='opportunityScore'?`${(value*100).toFixed(0)}점`:prices.includes(key)?`${money.format(value)}원`:`${(value*100).toFixed(2)}%`};
}
