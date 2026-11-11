import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { capabilityManifest } from '../dist/system/registry.mjs';
import {checkCanonicalRegistry} from './check-canonical-registry.mjs';
await checkCanonicalRegistry();
const manifest = capabilityManifest();
const content = JSON.stringify(manifest, null, 2) + '\n';
const target = new URL('../design/generated/system-manifest.json', import.meta.url);
if (process.argv.includes('--check')) {
  if (await readFile(target, 'utf8').catch(() => '') !== content) { console.error('Capability manifest needs regeneration.'); process.exitCode = 1; }
  else console.log('Capability manifest matches its registry.');
} else { await mkdir(new URL('../design/generated/', import.meta.url), { recursive: true }); await writeFile(target, content); console.log('Capability manifest generated.'); }
