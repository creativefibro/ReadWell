// Settings live in this browser's extension storage only.
export const DEFAULTS = {server: 'http://127.0.0.1:4320', key: '', clientId: '', clientSecret: ''};
export async function loadSettings() {
  return {...DEFAULTS, ...(await chrome.storage.local.get(Object.keys(DEFAULTS)))};
}
export async function saveSettings(values) {
  const server = String(values.server || '').trim().replace(/\/+$/, '');
  const url = new URL(server);
  if (!(url.protocol === 'https:' || (url.protocol === 'http:' && url.hostname === '127.0.0.1'))) throw new Error('Use an https address, or http://127.0.0.1 for testing.');
  await chrome.storage.local.set({server, key: String(values.key || '').trim(), clientId: String(values.clientId || '').trim(), clientSecret: String(values.clientSecret || '').trim()});
}
