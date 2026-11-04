// ReadWell production service on the Mac Studio. Listens on loopback only; the
// Cloudflare Tunnel is the only way in, and every request is checked by server/production.mjs.
import {appendFileSync, mkdirSync, readdirSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {AccessVerifier} from './access.mjs';
import {openDatabase} from './sqlite.mjs';
import {loadConfig} from './config.mjs';
import {createStore} from '../lib/store.mjs';
import {fetchPage} from '../lib/fetch-page.mjs';
import {createApp} from './app.mjs';
import {createGate} from './production.mjs';
import {serve} from './http.mjs';

process.umask(0o077);
const home = process.argv[2];
let config;
try { config = loadConfig(home); } catch { console.error('ReadWell cannot start: check its private configuration.'); process.exit(1); }

const logDir = join(home, 'logs');
mkdirSync(logDir, {recursive: true, mode: 0o700});
// Safe event log: no URLs, article titles, tokens or keys. Last 14 days kept.
function log(event) {
  const day = new Date().toISOString().slice(0, 10);
  appendFileSync(join(logDir, day + '.log'), new Date().toISOString() + ' ' + event + '\n', {mode: 0o600});
  for (const name of readdirSync(logDir).filter((n) => /^\d{4}-\d{2}-\d{2}\.log$/.test(n)).sort().slice(0, -14)) rmSync(join(logDir, name));
}

let verifier = null;
try { verifier = new AccessVerifier(config); } catch { log('Access setup incomplete; everything except the icons is locked.'); }

const db = openDatabase(join(home, 'readwell.sqlite'), fileURLToPath(new URL('../migrations/', import.meta.url)));
const store = createStore(db);
const app = createApp({store, fetchPage: (url) => fetchPage(url), captureKey: config.captureKey, origin: config.origin});
const gate = createGate({config, verifier, app});

const server = await serve(gate, {port: config.port, origin: config.origin, onError: () => log('Request failed; no details recorded.')});
log('ReadWell listening on loopback.');
function stop() {
  server.close(() => { db.close(); log('ReadWell stopped cleanly.'); process.exit(0); });
  setTimeout(() => process.exit(1), 10000).unref();
}
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
process.on('uncaughtException', () => { log('Unexpected failure; the service will restart.'); process.exit(1); });
process.on('unhandledRejection', () => { log('Unexpected failure; the service will restart.'); process.exit(1); });
