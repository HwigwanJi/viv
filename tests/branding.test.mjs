import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {APP_BRAND,investmentFilename,investmentBrandMarkup} from '../dist/ui/brand.mjs';

const read=path=>readFile(new URL('../'+path,import.meta.url),'utf8');
const unescape=value=>value.replaceAll('&amp;','&');

test('browser, loading screen and installed app identify VIV',async()=>{
  const html=await read('dist/index.html');assert.equal(unescape(html.match(/<title>([^<]+)<\/title>/)[1]),APP_BRAND.name);
  assert.equal(unescape(html.match(/name="application-name" content="([^"]+)"/)[1]),APP_BRAND.name);
  assert.ok(unescape(html.match(/name="description" content="([^"]+)"/)[1]).startsWith(APP_BRAND.name));
  const iconPath=html.match(/rel="icon"[^>]+href="\.\/([^"]+)"/)[1],icon=await read('dist/'+iconPath);assert.match(icon,/<svg[^>]+viewBox="0 0 64 64"/);assert.match(icon,/aria-label="VIV"/);assert.doesNotMatch(icon,/<image|<script|(?:href|src)=["']https?:\/\//);
  assert.equal(JSON.parse(await read('dist/manifest.json')).short_name,APP_BRAND.name);
  assert.match(html,/good vibe, good investment/);
  assert.match(await read('dist/ui/viv-intro.css'),/prefers-reduced-motion/);
});

test('sidebar brand has an accessible VIV name and a compact mark',async()=>{
  const html=investmentBrandMarkup(),app=await read('dist/app.mjs'),css=await read('styles/components/trading-terminal.css');
  assert.match(html,/aria-label="VIV"/);assert.match(html,/class="brand-mark" aria-hidden="true"/);assert.match(html,/VIV<small>Vibe Investment<\/small>/);
  assert.match(app,/investmentBrandMarkup\(\{href:primaryHref\(route,'home'\)\}\)/);assert.match(css,/\.studio-shell \.brand-name\s*\{[^}]*@apply min-w-0;[^}]*@apply whitespace-nowrap;[^}]*@apply overflow-hidden;/);
  assert.match(html,/<a class="brand" href="#home" data-nav="home"/);
  assert.match(investmentBrandMarkup({href:'#home?executionMode=live&currency=USD'}),/href="#home\?executionMode=live&amp;currency=USD"/);
});

test('export filenames use the new brand while existing browser preferences retain their storage identity',async()=>{
  assert.equal(investmentFilename('records-page.json'),'viv-records-page.json');assert.equal(investmentFilename('policy.yaml'),'viv-policy.yaml');
  const controller=await read('dist/ui/studio-controller.mjs'),shell=await read('dist/ui/shell.mjs');assert.doesNotMatch(controller,/keynes-records|keynes-server|`keynes-\$/);assert.match(controller,/investmentFilename\('records-page\.json'\)/);assert.match(controller,/'keynes-watchlist-v1'/);assert.match(shell,/'keynes-theme'/);assert.match(shell,/'keynes-lab-sidebar'/);
});
