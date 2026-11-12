export function validateMobileOrigin(value) {
  if (!value) return null;
  const url = new URL(value);
  if (url.origin !== value || url.protocol !== 'https:' || url.port || url.username || url.password || !/^[a-z0-9-]+\.[a-z0-9-]+\.ts\.net$/.test(url.hostname)) throw new Error('Invalid private mobile origin');
  return url.origin;
}

export function privateMobileRouteStatus(config,origin,localOrigin) {
  if(Object.values(config?.AllowFunnel??{}).some(Boolean))return 'public';
  const hostname=new URL(validateMobileOrigin(origin)).hostname;
  const handler=config?.Web?.[hostname+':443']?.Handlers?.['/'];
  const proxy=handler?.Proxy?.replace(/\/$/,'');
  const listener=config?.TCP?.['443'];
  if((handler&&proxy!==localOrigin)||(listener&&!listener.HTTPS))return 'conflict';
  return proxy===localOrigin?'ready':'missing';
}

export async function verifyMobileInstallAddress(origin,setupId,fetchImpl=fetch) {
  try {
    const verifiedOrigin=validateMobileOrigin(origin);
    if(!verifiedOrigin||!setupId)return {status:'unreachable'};
    const url=verifiedOrigin+'/install.html';
    const response=await fetchImpl(url,{method:'HEAD',redirect:'error',signal:AbortSignal.timeout(4000)});
    if(response.ok)return response.headers.get('X-VIV-Setup')===setupId
      ?{status:'ready',url}:{status:'installation-mismatch'};
  }catch{}
  return {status:'unreachable'};
}

export function previewRequestOrigin(request, port, mobileOrigin = null) {
  const host = request.headers.host;
  if (mobileOrigin && host === new URL(mobileOrigin).host && ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(request.socket.remoteAddress)) return mobileOrigin;
  if (['127.0.0.1:' + port, 'localhost:' + port, '[::1]:' + port].includes(host)) return 'http://' + host;
  throw new Error('Unrecognized app host');
}
