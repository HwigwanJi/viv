export const PAPER_DECISION_ENTRY = '#trade?executionMode=paper';
export const PAPER_PRACTICE_ENTRY = '#minds?profileId=all&view=simulations&executionMode=paper&setup=new&practice=quant';

export function paperDecisionRecordHash(id) {
  return '#minds?' + new URLSearchParams({profileId:'all',view:'records',executionMode:'paper',kind:'decisions',search:id});
}
