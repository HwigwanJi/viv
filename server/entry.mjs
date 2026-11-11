import { assets } from '../.runtime/site-assets.mjs';
import { handleAPI } from './api.mjs';
import { handleMcp } from './mcp.mjs';
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if(url.pathname==='/mcp')return handleMcp(request,env);
    if (url.pathname.startsWith('/api/')) return handleAPI(request, env);
    if (!['GET', 'HEAD'].includes(request.method)) return new Response('Method not allowed', { status: 405 });
    let pathname; try { pathname = decodeURIComponent(url.pathname); } catch { return new Response('Bad path', { status: 400 }); }
    const asset = assets[pathname === '/' ? '/index.html' : pathname];
    if (!asset) return new Response('Not found', { status: 404 });
    const headers = { 'Content-Type': asset.type, 'Cache-Control': asset.type.startsWith('text/html')?'no-store':'no-cache', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin' };
    const body=asset.encoding==='base64'?Uint8Array.from(atob(asset.body),character=>character.charCodeAt(0)):asset.body;
    return new Response(request.method === 'HEAD' ? null : body, { headers });
  },
};
