import {getInstrument} from '../domain/instruments.mjs';

export const PAPER_HOME_ENTRY = '#home?executionMode=paper';
export const PAPER_DECISION_INSTRUMENT = 'crypto:okx:BTC-USDT';
export const PAPER_DECISION_TIMEFRAME = '4h';
export const PAPER_DECISION_ENTRY = '#trade?' + new URLSearchParams({
  executionMode:'paper',firstDecision:'1',instrumentId:PAPER_DECISION_INSTRUMENT,timeframe:PAPER_DECISION_TIMEFRAME
});
export const PAPER_PRACTICE_ENTRY = '#minds?profileId=all&view=simulations&executionMode=paper&setup=new&practice=quant';

export function paperPracticeEntry(mindId) {
  return mindId&&mindId!=='all'?PAPER_PRACTICE_ENTRY+'&'+new URLSearchParams({practiceMind:mindId}):PAPER_PRACTICE_ENTRY;
}

export function paperPracticeReportHash(id) {
  return '#minds?' + new URLSearchParams({profileId:'all',view:'simulations',executionMode:'paper',simulationId:id,tab:'report'});
}

export function paperDecisionRecordHash(id) {
  return '#minds?' + new URLSearchParams({profileId:'all',view:'records',executionMode:'paper',kind:'decisions',search:id});
}

const isId=value=>/^[a-zA-Z0-9][a-zA-Z0-9_.:@-]{0,199}$/.test(value??'');

export function paperBrokerReturnHash(hash) {
  if(hash?.startsWith('#trade?'))return firstDecisionReturnHash(new URLSearchParams(hash.slice('#trade?'.length)));
  if(!hash?.startsWith('#minds?'))return PAPER_HOME_ENTRY;
  const params=new URLSearchParams(hash.slice('#minds?'.length));
  if(params.get('executionMode')!=='paper')return PAPER_HOME_ENTRY;
  const view=params.get('view'),simulationId=params.get('simulationId'),decisionId=params.get('search');
  if(view==='simulations'&&isId(simulationId))return paperPracticeReportHash(simulationId);
  if(view==='records'&&params.get('kind')==='decisions'&&isId(decisionId))return paperDecisionRecordHash(decisionId);
  return PAPER_HOME_ENTRY;
}

function firstDecisionReturnHash(params) {
  if(params.get('executionMode')!=='paper'||params.get('firstDecision')!=='1'||
     params.has('comparisonId')||(params.has('mode')&&params.get('mode')!=='live'))return PAPER_HOME_ENTRY;
  const profileId=params.get('profileId'),instrumentId=params.get('instrumentId')??PAPER_DECISION_INSTRUMENT;
  let instrument;
  try{instrument=getInstrument(instrumentId);}catch{return PAPER_HOME_ENTRY;}
  const timeframe=params.get('timeframe')??instrument.defaultTimeframe;
  if((profileId!==null&&!isId(profileId))||!instrument.timeframes.includes(timeframe))return PAPER_HOME_ENTRY;
  const target=new URLSearchParams({executionMode:'paper',firstDecision:'1',instrumentId:instrument.id,timeframe});
  if(profileId)target.set('profileId',profileId);
  const tab=params.get('tab');
  if(['decisions','positions','knowledge'].includes(tab))target.set('tab',tab);
  const source=params.get('returnTo');
  if(source?.startsWith('#minds?')){
    const report=new URLSearchParams(source.slice('#minds?'.length));
    const id=report.get('simulationId');
    if(report.get('view')==='simulations'&&report.get('executionMode')==='paper'&&isId(id))target.set('returnTo',paperPracticeReportHash(id));
  }
  return '#trade?'+target;
}
