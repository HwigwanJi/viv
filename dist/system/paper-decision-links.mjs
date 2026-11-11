export const PAPER_DECISION_ENTRY = '#trade?executionMode=paper';

export function paperDecisionRecordHash(id) {
  return '#minds?' + new URLSearchParams({profileId:'all',view:'records',executionMode:'paper',kind:'decisions',search:id});
}
