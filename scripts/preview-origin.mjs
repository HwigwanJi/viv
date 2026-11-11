export function validateMobileOrigin(value) {
  if (!value) return null;
  const url = new URL(value);
  if (url.origin !== value || url.protocol !== 'https:' || url.port || url.username || url.password || !/^[a-z0-9-]+\.[a-z0-9-]+\.ts\.net$/.test(url.hostname)) throw new Error('Invalid private mobile origin');
  return url.origin;
}

export function previewRequestOrigin(request, port, mobileOrigin = null) {
  const host = request.headers.host;
  if (mobileOrigin && host === new URL(mobileOrigin).host && ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(request.socket.remoteAddress)) return mobileOrigin;
  if (['127.0.0.1:' + port, 'localhost:' + port, '[::1]:' + port].includes(host)) return 'http://' + host;
  throw new Error('Unrecognized app host');
}
