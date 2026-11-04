// Local development server: loopback only, data in the ignored .local/ folder.
// Never expose this on a network: it has no sign-in. Production uses server/main.mjs.
import {mkdirSync, readFileSync, writeFileSync, existsSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {openDatabase} from '../server/sqlite.mjs';
import {createStore} from '../lib/store.mjs';
import {fetchPage} from '../lib/fetch-page.mjs';
import {createApp} from '../server/app.mjs';
import {serve} from '../server/http.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const dir = process.env.READWELL_DATA || join(root, '.local');
mkdirSync(dir, {recursive: true, mode: 0o700});
const keyFile = join(dir, 'capture.key');
if (!existsSync(keyFile)) writeFileSync(keyFile, randomBytes(24).toString('base64url') + '\n', {mode: 0o600});
const captureKey = readFileSync(keyFile, 'utf8').trim();
const port = Number(process.env.PORT || 4320);
const origin = `http://127.0.0.1:${port}`;

const db = openDatabase(join(dir, 'readwell.sqlite'), join(root, 'migrations'));
const store = createStore(db);
const app = createApp({store, fetchPage: (url) => fetchPage(url), captureKey, origin});
await serve(app, {port, origin, onError: (e) => console.error(e)});
console.log(`ReadWell (development) on ${origin}\nCapture key for the extension: ${captureKey}`);
