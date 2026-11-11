import {RepositoryError} from './repository.mjs';

// A persisted manifest is the migration boundary. Historical accounts retain
// their balances and pins; future paper execution belongs to the mind engine.
export function usesMindExecution(workspace, profileId) {
  return (workspace.mindManifests ?? []).some(m => m.scope?.profileId === profileId);
}
export function legacyForwardBlocked(workspace, deployment) {
  return deployment?.experimentType === 'FORWARD_PAPER' && usesMindExecution(workspace, deployment.investmentProfileId);
}
export function assertLegacyForwardAvailable(workspace, deployment) {
  if (legacyForwardBlocked(workspace, deployment)) {
    const error = new RepositoryError('MIND_EXECUTION_REQUIRED', '마인드의 운용 화면에서 모의 계좌와 자동 실행을 설정하세요. 기존 계좌와 거래는 기록에서 확인할 수 있습니다.', 409);
    error.recovery = {profileId:deployment.investmentProfileId, executionMode:'paper', view:'operations'};
    throw error;
  }
}
export function assertLegacyCommandAvailable(workspace, path, body) {
  if (workspace.commandReceipts?.some(r => r.key === body.idempotencyKey)) return;
  if (path === '/api/workspace/actions') {
    const p = body.payload ?? {};
    if (body.type === 'deployment.create') assertLegacyForwardAvailable(workspace, p);
    if (body.type === 'deployment.status' && p.status === 'running') assertLegacyForwardAvailable(workspace, workspace.deployments.find(d => d.id === p.deploymentId));
    if (['job.create', 'job.resume'].includes(body.type)) {
      const deploymentId = p.deploymentId ?? workspace.scheduler?.jobs.find(j => j.id === p.jobId)?.deploymentId;
      assertLegacyForwardAvailable(workspace, workspace.deployments.find(d => d.id === deploymentId));
    }
  }
  if (['/api/workspace/evaluate', '/api/workspace/execute'].includes(path)) assertLegacyForwardAvailable(workspace, workspace.deployments.find(d => d.id === body.deploymentId));
  if (path === '/api/workspace/comparisons/create' && body.experimentType === 'FORWARD_PAPER') {
    for (const profileId of body.profileIds ?? []) assertLegacyForwardAvailable(workspace, {experimentType:'FORWARD_PAPER', investmentProfileId:profileId});
  }
  if (path === '/api/workspace/comparisons/run' || path === '/api/workspace/comparisons/status' && body.status === 'running') {
    const group = workspace.comparisons?.find(g => g.id === body.comparisonId);
    for (const m of group?.members ?? []) assertLegacyForwardAvailable(workspace, workspace.deployments.find(d => d.id === m.deploymentId));
  }
}
