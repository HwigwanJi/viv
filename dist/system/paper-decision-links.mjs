export const PAPER_HOME_ENTRY = '#home?executionMode=paper';
export const PAPER_DECISION_ENTRY = '#trade?executionMode=paper';
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

export function paperResultReturnHash(hash) {
  if(!hash?.startsWith('#minds?'))return PAPER_HOME_ENTRY;
  const params=new URLSearchParams(hash.slice('#minds?'.length));
  if(params.get('executionMode')!=='paper')return PAPER_HOME_ENTRY;
  const isId=value=>/^[a-zA-Z0-9][a-zA-Z0-9_.:@-]{0,199}$/.test(value??'');
  const view=params.get('view'),simulationId=params.get('simulationId'),decisionId=params.get('search');
  if(view==='simulations'&&isId(simulationId))return paperPracticeReportHash(simulationId);
  if(view==='records'&&params.get('kind')==='decisions'&&isId(decisionId))return paperDecisionRecordHash(decisionId);
  return PAPER_HOME_ENTRY;
}
