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
