const list = value => Array.isArray(value) ? value : [];
const iso = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const firstTime = (...values) => values.find(iso) ?? null;

/** A historical record owns its original policy name. Current names are used
 * only when their recorded availability precedes this record's actual request. */
export function resolveInvestmentProfileIdentity(workspace, profileId, {record = null, asOf = null} = {}) {
  const profile = list(workspace?.investmentProfiles).find(value => value.id === profileId);
  if (!profile) return {name: null, sourceKind: null, sourceId: null, sourceAsOf: null};
  const input = record?.inputPackage ?? {}, state = record?.rawRequest?.state ?? {};
  const cutoff = firstTime(record?.provider?.startedAt, record?.decisionAt, input.contextBuiltAt, record?.createdAt, asOf, record?.asOf, input.asOf);
  const manifestId = record?.manifestId ?? state.manifestId;
  const pinned = manifestId ? list(workspace.mindManifests).find(m => m.id === manifestId && m.scope?.profileId === profileId) : null;
  if (pinned && iso(pinned.availableAt) && (!cutoff || pinned.availableAt <= cutoff)) {
    return {name: pinned.data?.name ?? pinned.title ?? null, sourceKind: 'mind-manifest', sourceId: pinned.id, sourceAsOf: pinned.availableAt};
  }
  if (!record && cutoff) {
    const current = list(workspace.mindManifests).filter(m => m.scope?.profileId === profileId && iso(m.availableAt) && m.availableAt <= cutoff).sort((a,b) => (a.data?.version ?? 0) - (b.data?.version ?? 0) || a.availableAt.localeCompare(b.availableAt)).at(-1);
    if (current) return {name: current.data?.name ?? current.title ?? null, sourceKind: 'mind-manifest', sourceId: current.id, sourceAsOf: current.availableAt};
  }
  const changedAt = firstTime(profile.updatedAt, profile.createdAt);
  if (cutoff && changedAt && changedAt > cutoff || manifestId && !pinned) return {name: null, sourceKind: 'unavailable-profile-snapshot', sourceId: manifestId ?? profile.id, sourceAsOf: null};
  return {name: profile.name ?? null, sourceKind: changedAt ? 'profile' : 'profile-undated', sourceId: profile.id, sourceAsOf: changedAt};
}
