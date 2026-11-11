import { readFile, writeFile, readdir, mkdir, cp } from 'node:fs/promises';
import { build } from 'esbuild';
import path from 'node:path';
import { versionAssetBundle } from './asset-versioning.mjs';
import {checkCopy} from './check-ui-copy.mjs';
await checkCopy();
const root = path.resolve('dist');
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.md': 'text/plain; charset=utf-8', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
const originalAssets = {};
async function collect(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name === 'server' || entry.name === '.openai') continue;
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) await collect(file);
    else { const extension=path.extname(file),binary=['.png','.woff2'].includes(extension),type=extension==='.png'?'image/png':mime[extension]; if (type) originalAssets['/' + path.relative(root, file).replaceAll('\\', '/')] = { type, ...(binary?{encoding:'base64'}:{}), body: binary?(await readFile(file)).toString('base64'):await readFile(file, 'utf8') }; }
  }
}
await collect(root);
const buildInputs = await readFile(new URL('./asset-versioning.mjs', import.meta.url), 'utf8') + await readFile(new URL('./build-worker.mjs', import.meta.url), 'utf8');
const { assets, version, references } = await versionAssetBundle(originalAssets, { buildInputs });
await mkdir('.runtime', { recursive: true });
await mkdir('dist/.openai', { recursive: true });
await cp('.openai/hosting.json', 'dist/.openai/hosting.json');
await cp('drizzle', 'dist/.openai/drizzle', { recursive: true });
await writeFile('.runtime/site-assets.mjs', `export const assets = ${JSON.stringify(assets)};\n`);
await mkdir('dist/server', { recursive: true });
// Both supported native APIs retain cryptography and lossless execution journals.
const runtimeExternals = ['node:crypto','node:zlib'];
const result = await build({ entryPoints: ['server/entry.mjs'], outfile: 'dist/server/index.js', bundle: true, format: 'esm', platform: 'browser', external: runtimeExternals, metafile: true, target: 'es2022', minify: true, legalComments: 'none' });
const externalImports = [...new Set(Object.values(result.metafile.outputs).flatMap(output => output.imports.filter(entry => entry.external).map(entry => entry.path)))];
if (externalImports.some(name => !runtimeExternals.includes(name))) throw new Error('Worker contains an unsupported external runtime import.');
const worker = await readFile('dist/server/index.js', 'utf8');
const mod = await import('data:text/javascript;base64,' + Buffer.from(worker).toString('base64'));
if (typeof mod.default?.fetch !== 'function') throw new Error('Worker fetch export missing.');
const response = await mod.default.fetch(new Request('https://preview.local/'), {});
if (!response.ok || !(await response.text()).includes('id="app"')) throw new Error('Built app entrypoint failed.');
for (const reference of references) {
  const url = new URL(reference.versioned, new URL(reference.from, 'https://preview.local'));
  const response = await mod.default.fetch(new Request(url), {});
  if (!response.ok) throw new Error(`Versioned asset lookup failed: ${reference.from} -> ${url.pathname}`);
  const original=originalAssets[url.pathname];
  if (original?.encoding==='base64'&&!Buffer.from(await response.arrayBuffer()).equals(Buffer.from(original.body,'base64'))) throw new Error(`Binary asset changed during packaging: ${url.pathname}`);
}
console.log(`Built server with ${Object.keys(assets).length} embedded assets, release ${version}, ${references.length} versioned references (${worker.length} bytes).`);
