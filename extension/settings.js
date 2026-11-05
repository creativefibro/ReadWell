// Settings live in this browser's extension storage only.
export const DEFAULTS = {server: 'https://readwell.susanpearson.uk', key: '', clientId: '', clientSecret: ''};
export async function loadSettings() {
  return {...DEFAULTS, ...(await chrome.storage.local.get(Object.keys(DEFAULTS)))};
}
export async function saveSettings(values) {
  const server = String(values.server || '').trim().replace(/\/+$/, '');
  const url = new URL(server);
  if (!(url.protocol === 'https:' || (url.protocol === 'http:' && url.hostname === '127.0.0.1'))) throw new Error('Use an https address, or http://127.0.0.1 for testing.');
  const tidy = (v) => String(v || '').replace(/[\s\u200B-\u200D\uFEFF"'“”‘’]/g, '');
  const clientId = tidy(values.clientId);
  if (clientId && !/^[0-9a-f]{32}\.access$/.test(clientId)) throw new Error('The Client ID should be 32 letters and numbers followed by “.access”.');
  await chrome.storage.local.set({server, key: tidy(values.key), clientId, clientSecret: tidy(values.clientSecret)});
}
