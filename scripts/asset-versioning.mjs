import { createHash } from 'node:crypto';
import { build } from 'esbuild';

const LOCAL_ORIGIN = 'https://embedded.invalid';
const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

export function assetBundleVersion(assets, buildInputs = '') {
  const hash = createHash('sha256').update('embedded-assets-v2').update(buildInputs);
  for (const name of Object.keys(assets).sort()) hash.update(JSON.stringify([name, assets[name].type, assets[name].body, assets[name].encoding ?? null]));
  return hash.digest('hex').slice(0, 20);
}

export function versionAssetReference(reference, fromPath, assets, version) {
  if (!/^(?:\.{1,2}\/|\/(?!\/))/.test(reference)) return reference;
  let url, pathname;
  try { url = new URL(reference, new URL(fromPath, LOCAL_ORIGIN)); pathname = decodeURIComponent(url.pathname); } catch { return reference; }
  if (url.origin !== LOCAL_ORIGIN || !hasOwn(assets, pathname)) return reference;
  const hashAt = reference.indexOf('#'), fragment = hashAt < 0 ? '' : reference.slice(hashAt);
  const before = hashAt < 0 ? reference : reference.slice(0, hashAt), queryAt = before.indexOf('?');
  const pathnameText = queryAt < 0 ? before : before.slice(0, queryAt);
  const query = new URLSearchParams(queryAt < 0 ? '' : before.slice(queryAt + 1));
  query.set('v', version);
  return `${pathnameText}?${query}${fragment}`;
}

function runtimeSource(assetPaths, version) {
  // fetch resolves relative to the document; new URL uses its explicit base.
  // Injection binds only global identifiers, preserving locally supplied fetch.
  return `
const assetPaths = new Set(${JSON.stringify(assetPaths)});
function resource(value, base) {
  if (typeof value !== 'string' || !/^(?:\\.{1,2}\\/|\\/(?!\\/))/.test(value)) return value;
  let url;
  try {
    url = new globalThis.URL(value, base || globalThis.location?.href);
    if (url.origin !== new globalThis.URL(globalThis.location?.href).origin) return value;
  }
  catch { return value; }
  let pathname; try { pathname = decodeURIComponent(url.pathname); } catch { return value; }
  if (!assetPaths.has(pathname)) return value;
  const hashAt = value.indexOf('#'), fragment = hashAt < 0 ? '' : value.slice(hashAt);
  const before = hashAt < 0 ? value : value.slice(0, hashAt), queryAt = before.indexOf('?');
  const query = new URLSearchParams(queryAt < 0 ? '' : before.slice(queryAt + 1));
  query.set('v', ${JSON.stringify(version)});
  return (queryAt < 0 ? before : before.slice(0, queryAt)) + '?' + query + fragment;
}
function __embeddedFetch(value, ...options) { return globalThis.fetch(resource(value), ...options); }
class __EmbeddedURL extends globalThis.URL { constructor(value, base) { super(resource(value, base), base); } }
export { __embeddedFetch as fetch, __EmbeddedURL as URL };
`;
}

async function versionParsedAsset(source, name, loader, rewrite, runtime) {
  const runtimePath = '/__embedded_release_runtime__.mjs';
  const result = await build({
    stdin: { contents: source, sourcefile: name, loader },
    bundle: true, write: false, format: 'esm', platform: 'browser', target: 'esnext', charset: 'utf8',
    treeShaking: false, legalComments: 'none', logLevel: 'silent',
    // Computed imports cannot be enumerated safely; fail the build explicitly.
    logOverride: { 'unsupported-dynamic-import': 'error', 'empty-glob': 'error' },
    ...(loader === 'js' ? { inject: [runtimePath] } : {}),
    plugins: [{ name: 'version-local-assets', setup(builder) {
      builder.onResolve({ filter: /^\/__embedded_release_runtime__\.mjs$/ }, () => ({ path: 'runtime', namespace: 'release-runtime' }));
      builder.onLoad({ filter: /.*/, namespace: 'release-runtime' }, () => ({ contents: runtime, loader: 'js' }));
      builder.onResolve({ filter: /.*/ }, args => ({ path: rewrite(args.path), external: true }));
    } }],
  });
  return result.outputFiles[0].text;
}

function versionHtmlTag(text, rewrite, cssStyle) {
  // Match complete attributes, consuming quoted non-URL values in one token.
  return text.replace(/(\s+)([^\s"'<>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g, (attribute, space, name, double, single, unquoted) => {
    const value = double ?? single ?? unquoted;
    if (value === undefined) return attribute;
    const lower = name.toLowerCase(), quote = double !== undefined ? '"' : single !== undefined ? "'" : '';
    let changed = value;
    if (['src', 'href', 'poster'].includes(lower)) changed = rewrite(value);
    else if (lower === 'srcset') changed = value.replace(/(^|,)(\s*)([^\s,]+)/g, (_, comma, gap, url) => comma + gap + rewrite(url));
    else if (lower === 'style') changed = cssStyle(value);
    return changed === value ? attribute : `${space}${name}=${quote}${changed}${quote}`;
  });
}

async function versionHtml(source, name, rewrite, runtime) {
  const tokens = /<!--[\s\S]*?-->|<(script|style)\b(?:[^"'<>]|"[^"]*"|'[^']*')*>[\s\S]*?<\/\1\s*>|<(?:[^"'<>]|"[^"]*"|'[^']*')*>/gi;
  const edits = [];
  const cssStyle = value => value.replace(/\/\*[\s\S]*?\*\/|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|url\(\s*(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^)]*)\s*\)/gi, token => {
    if (!/^url\(/i.test(token)) return token;
    return token.replace(/^(url\(\s*)([\s\S]*?)(\s*\))$/i, (_, before, raw, after) => {
      const quote = /^["']/.test(raw) ? raw[0] : '', path = quote ? raw.slice(1, -1) : raw;
      return before + quote + rewrite(path) + quote + after;
    });
  });
  for (const match of source.matchAll(tokens)) {
    const [text, kind] = match;
    if (text.startsWith('<!--')) continue;
    let changed;
    if (!kind) changed = versionHtmlTag(text, rewrite, cssStyle);
    else {
      const opening = text.match(/^<(?:[^"'<>]|"[^"]*"|'[^']*')*>/)[0];
      const closingStart = text.toLowerCase().lastIndexOf('</' + kind.toLowerCase());
      const body = text.slice(opening.length, closingStart), isStyle = kind.toLowerCase() === 'style';
      const scriptType = opening.match(/\stype\s*=\s*["']([^"']*)["']/i)?.[1];
      const executable = isStyle || !scriptType || /^(?:module|(?:text|application)\/javascript)$/i.test(scriptType);
      const content = body.trim() && executable ? await versionParsedAsset(body, name, isStyle ? 'css' : 'js', rewrite, runtime) : body;
      changed = versionHtmlTag(opening, rewrite, cssStyle) + content + text.slice(closingStart);
    }
    if (changed !== text) edits.push({ start: match.index, end: match.index + text.length, text: changed });
  }
  let result = source;
  for (const edit of edits.reverse()) result = result.slice(0, edit.start) + edit.text + result.slice(edit.end);
  return result;
}

export async function versionAssetBundle(originalAssets, { buildInputs = '' } = {}) {
  const version = assetBundleVersion(originalAssets, buildInputs), assets = {}, references = [];
  const runtime = runtimeSource(Object.keys(originalAssets), version);
  for (const [name, asset] of Object.entries(originalAssets)) {
    const rewrite = reference => {
      const next = versionAssetReference(reference, name, originalAssets, version);
      if (next !== reference) references.push({ from: name, original: reference, versioned: next });
      return next;
    };
    let body = asset.body;
    if (/\.html$/i.test(name)) body = await versionHtml(body, name, rewrite, runtime);
    else if (/\.css$/i.test(name)) body = await versionParsedAsset(body, name, 'css', rewrite, runtime);
    else if (/\.(?:m?js)$/i.test(name)) body = await versionParsedAsset(body, name, 'js', rewrite, runtime);
    assets[name] = { ...asset, body };
  }
  return { assets, version, references };
}
