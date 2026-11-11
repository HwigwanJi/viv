import dataset from '../dist/data/btc-4h.json' with { type: 'json' };
import manifest from '../dist/data/btc-source-manifest.json' with { type: 'json' };
import { precomputeFeatures, decideSnapshot } from '../dist/trading/model.mjs';
let prepared;
const canonical = value => JSON.stringify(value, (_key, v) => v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v);
export function bindSourceContext(input) {
  if (input.sourceHash !== manifest.datasetSha256) throw new TypeError('자료 버전이 변경되었습니다. 페이지를 새로 열어 주세요.');
  const index = dataset.bars.findIndex(bar => bar[0] + 14400000 === Date.parse(input.snapshot.asOf));
  if (index < 0 || canonical(input.recentBars) !== canonical(dataset.bars.slice(Math.max(0, index - 63), index + 1))) throw new TypeError('원본 가격 이력과 기준 시각을 대조하세요.');
  prepared ||= precomputeFeatures(dataset);
  const snapshot = decideSnapshot(prepared.features[index], { config: prepared.config, currentWeight: input.portfolio.weight });
  for (const field of ['modelVersion', 'asOf', 'ready', 'features', 'categoryScores', 'S', 'C', 'probabilities', 'action', 'targetWeight', 'currentWeight']) if (canonical(input.snapshot[field]) !== canonical(snapshot[field])) throw new TypeError('가격 지표를 원본 자료에서 다시 계산해 주세요.');
  return { ...input, snapshot };
}
