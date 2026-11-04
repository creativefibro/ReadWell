import {test} from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync, sign} from 'node:crypto';
import {mkdtempSync, readFileSync, statSync, existsSync, readlinkSync, chmodSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {AccessVerifier} from '../server/access.mjs';
import {createGate, PUBLIC_PATHS} from '../server/production.mjs';
import {loadConfig, ORIGIN} from '../server/config.mjs';
import {setup, articlePage, KEY} from './helpers.mjs';

const {privateKey, publicKey} = generateKeyPairSync('rsa', {modulusLength: 2048});
const jwk = {...publicKey.export({format: 'jwk'}), kid: 'test', alg: 'RS256', use: 'sig'};
const config = {origin: ORIGIN, issuer: 'https://test.cloudflareaccess.com', audience: 'readwell-aud', email: 'susan@example.test', serviceClientId: 'abc123.access'};
const verifier = () => new AccessVerifier(config, async () => new Response(JSON.stringify({keys: [jwk]})));
function token(changes = {}, header = {}) {
  const now = Math.floor(Date.now() / 1000);
  const parts = [{alg: 'RS256', kid: 'test', ...header}, {iss: config.issuer, aud: [config.audience], email: config.email, sub: 'susan-id', type: 'app', iat: now - 1, exp: now + 600, ...changes}]
    .map((x) => Buffer.from(JSON.stringify(x)).toString('base64url'));
  return [...parts, sign('RSA-SHA256', Buffer.from(parts.join('.')), privateKey).toString('base64url')].join('.');
}
const serviceToken = () => token({email: undefined, sub: '', common_name: config.serviceClientId});

async function gated() {
  const t = setup({pages: {'https://example.com/a': articlePage()}});
  // The test app uses the dev origin; rebuild a gate around it with the production origin.
  const {createApp} = await import('../server/app.mjs');
  const app = createApp({store: t.store, fetchPage: async () => ({html: articlePage(), finalUrl: 'https://example.com/a'}), captureKey: KEY, origin: ORIGIN});
  const gate = createGate({config, verifier: verifier(), app});
  const call = (path, {method = 'GET', headers = {}, body} = {}) => gate(new Request(ORIGIN + path, {method, headers: {...(method === 'POST' ? {origin: ORIGIN, 'content-type': 'application/json'} : {}), ...headers}, ...(body ? {body: JSON.stringify(body)} : {})}));
  return {...t, gate, call};
}

test('Access accepts Susan and the ReadWell service token, and nothing else', async () => {
  const v = verifier();
  assert.equal((await v.verify(token())).kind, 'susan');
  assert.equal((await v.verify(serviceToken())).kind, 'service');
  for (const change of [{email: 'other@example.test'}, {iss: 'https://evil.test'}, {aud: ['other']}, {exp: 1}, {nbf: 9999999999}, {type: 'org'}, {sub: ''},
    {email: undefined, sub: '', common_name: 'someone-else.access'}, {email: undefined, sub: ''}])
    await assert.rejects(() => v.verify(token(change)), JSON.stringify(change));
  await assert.rejects(() => v.verify(token({}, {alg: 'none'})));
  await assert.rejects(() => v.verify(token().slice(0, -4) + 'AAAA'));
  await assert.rejects(() => v.verify('not.a.token'));
  await assert.rejects(() => new AccessVerifier(config, async () => { throw Error('offline'); }).verify(token()));
  assert.throws(() => new AccessVerifier({...config, email: ''}));
  const noService = new AccessVerifier({...config, serviceClientId: ''}, async () => new Response(JSON.stringify({keys: [jwk]})));
  await assert.rejects(() => noService.verify(serviceToken()));
});

test('without a valid Access token every page and API route is refused', async () => {
  const t = await gated();
  for (const path of ['/', '/api/queue', '/app.js', '/article/x', '/api/lucky-dip']) {
    const r = await t.call(path, {headers: {'cf-access-authenticated-user-email': config.email}});
    assert.equal(r.status, 401, path);
  }
  const forged = await t.call('/api/queue', {headers: {'cf-access-jwt-assertion': token({email: 'other@example.test'})}});
  assert.equal(forged.status, 401);
  assert.equal((await forged.json()).signIn, true);
});

test('only the Home Screen icons and manifest are public', async () => {
  const t = await gated();
  for (const path of PUBLIC_PATHS) {
    const r = await t.call(path);
    assert.equal(r.status, 200, path);
    assert.match(r.headers.get('cache-control'), /public/);
  }
  assert.equal((await t.call('/icons/../app.js')).status, 401);
  assert.equal((await t.call('/manifest.webmanifest', {method: 'POST'})).status, 401);
});

test('Susan, with Access, uses the app normally', async () => {
  const t = await gated();
  const headers = {'cf-access-jwt-assertion': token()};
  assert.equal((await t.call('/', {headers})).status, 200);
  const saved = await t.call('/api/capture', {method: 'POST', headers: {...headers, 'x-readwell-key': KEY}, body: {url: 'https://example.com/a'}});
  assert.equal(saved.status, 201);
  const q = await (await t.call('/api/queue', {headers})).json();
  assert.equal(q.total, 1);
});

test('the service token can only save, and still needs the capture key', async () => {
  const t = await gated();
  const headers = {'cf-access-jwt-assertion': serviceToken()};
  const noKey = await t.call('/api/capture', {method: 'POST', headers, body: {url: 'https://example.com/a'}});
  assert.equal(noKey.status, 401);
  const saved = await t.call('/api/capture', {method: 'POST', headers: {...headers, 'x-readwell-key': KEY}, body: {url: 'https://example.com/a'}});
  assert.equal(saved.status, 201);
  for (const [path, method] of [['/api/queue', 'GET'], ['/', 'GET'], ['/api/lucky-dip', 'GET'], ['/api/settings/order', 'POST'], ['/api/capture', 'GET']]) {
    const r = await t.call(path, {method, headers, ...(method === 'POST' ? {body: {order: 'newest'}} : {})});
    assert.equal(r.status, 403, `${method} ${path}`);
  }
});

test('the gate stays locked until Access is configured, apart from icons', async () => {
  const t = await gated();
  const {createApp} = await import('../server/app.mjs');
  const gate = createGate({config, verifier: null, app: createApp({store: t.store, fetchPage: async () => ({}), captureKey: KEY, origin: ORIGIN})});
  assert.equal((await gate(new Request(ORIGIN + '/'))).status, 503);
  assert.equal((await gate(new Request(ORIGIN + '/manifest.webmanifest'))).status, 200);
});

test('private configuration must be private and complete', () => {
  const home = mkdtempSync(join(tmpdir(), 'readwell-home-'));
  chmodSync(home, 0o700);
  execFileSync(process.execPath, ['--no-warnings', fileURLToPath(new URL('../scripts/mac-install.mjs', import.meta.url)), '--dry-run'], {env: {...process.env, READWELL_HOME: home}});
  const c = loadConfig(home);
  assert.equal(c.origin, ORIGIN);
  assert.equal(c.port, 4322);
  assert.ok(c.captureKey.length >= 30);
  assert.equal(statSync(join(home, 'config.json')).mode & 0o777, 0o600);
  assert.equal(statSync(join(home, 'capture.key')).mode & 0o777, 0o600);
  assert.ok(existsSync(join(home, 'current', 'server', 'main.mjs')));
  assert.ok(!existsSync(join(home, 'current', 'tests')), 'release holds only what the service needs');
  const firstRelease = readlinkSync(join(home, 'current'));
  const key = readFileSync(join(home, 'capture.key'), 'utf8');
  execFileSync(process.execPath, ['--no-warnings', fileURLToPath(new URL('../scripts/mac-install.mjs', import.meta.url)), '--dry-run'], {env: {...process.env, READWELL_HOME: home}});
  assert.equal(readFileSync(join(home, 'capture.key'), 'utf8'), key, 'updates keep the capture key');
  assert.equal(readlinkSync(join(home, 'current')), firstRelease, 'same source, same release');
  chmodSync(join(home, 'config.json'), 0o644);
  assert.throws(() => loadConfig(home), /private/);
});
