// Connects the installed ReadWell service to Cloudflare (run once, after the dashboard steps).
//   node scripts/mac-connect.mjs             asks for the codes, stores them privately, starts the tunnel
//   node scripts/mac-connect.mjs --dry-run   write configuration only (any OS, for tests; values from env)
// Secrets go into private files, never into command-line arguments or the LaunchAgent.
import {existsSync, readFileSync, writeFileSync, mkdirSync, renameSync, chmodSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {createInterface} from 'node:readline';
import {randomUUID} from 'node:crypto';
import {loadConfig, ORIGIN} from '../server/config.mjs';

process.umask(0o077);
const dry = process.argv.includes('--dry-run');
const home = process.env.READWELL_HOME || join(homedir(), 'Library', 'Application Support', 'ReadWell');
const ISSUER = 'https://billowing-night-42d9.cloudflareaccess.com'; // Susan's Zero Trust team (shared with Flourish)
const EMAIL = 'accounts@susanpearson.uk';
const TUNNEL_LABEL = 'uk.creativefibro.readwell.tunnel';
if (!dry && process.platform !== 'darwin') throw Error('Run this on the Mac Studio');
if (!existsSync(join(home, 'config.json'))) throw Error('Install ReadWell first: node scripts/mac-install.mjs');

// Hidden input for secrets: characters are not echoed.
function ask(question, {secret = false} = {}) {
  return new Promise((resolve) => {
    const rl = createInterface({input: process.stdin, output: process.stdout, terminal: true});
    if (secret) rl._writeToOutput = (s) => { if (s.includes(question)) process.stdout.write(s); };
    rl.question(question, (answer) => { rl.close(); if (secret) process.stdout.write('\n'); resolve(answer.trim()); });
  });
}
async function value(env, question, check, hint, opts) {
  if (dry) { const v = process.env[env] || ''; if (!check(v)) throw Error(`${env}: ${hint}`); return v; }
  for (;;) {
    const v = await ask(question, opts);
    if (check(v)) return v;
    console.log('  ' + hint);
  }
}

const isAud = (v) => /^[0-9a-f]{64}$/.test(v);
const isClientId = (v) => /^[0-9a-f]{32}\.access$/.test(v);
export function tunnelId(token) {
  try { const t = JSON.parse(Buffer.from(token, 'base64').toString()); return typeof t.t === 'string' && t.a && t.s ? t.t : null; } catch { return null; }
}

console.log('ReadWell: connect to Cloudflare. Paste each value from the setup guide, then press Return.\n');
const audience = await value('READWELL_AUD', '1. ReadWell application Audience (AUD) tag: ', isAud, 'That should be 64 letters and numbers, from the ReadWell application’s Overview.');
const captureAudience = await value('READWELL_SAVE_AUD', '2. ReadWell Save application Audience (AUD) tag: ', (v) => isAud(v) && v !== audience, 'Use the AUD tag of the separate “ReadWell Save” application.');
const serviceClientId = await value('READWELL_CLIENT_ID', '3. Service token Client ID: ', isClientId, 'It ends in “.access”.');
const tunnelToken = await value('READWELL_TUNNEL_TOKEN', '4. Tunnel token (hidden as you paste): ', (v) => !!tunnelId(v), 'Copy only the long token after “--token” in the tunnel’s install command.', {secret: true});

// Private configuration, written atomically.
const configPath = join(home, 'config.json');
const config = {...JSON.parse(readFileSync(configPath, 'utf8')), origin: ORIGIN, issuer: ISSUER, email: EMAIL, audience, captureAudience, serviceClientId};
const temp = configPath + '.' + randomUUID();
writeFileSync(temp, JSON.stringify(config, null, 2) + '\n', {mode: 0o600});
renameSync(temp, configPath);
const tokenPath = join(home, 'tunnel.token');
writeFileSync(tokenPath, tunnelToken + '\n', {mode: 0o600});
chmodSync(tokenPath, 0o600);
loadConfig(home); // refuses anything not private or incomplete
if (dry) { console.log(`Dry run: configuration saved for tunnel ${tunnelId(tunnelToken)}.`); process.exit(0); }

// Tunnel connector as a login service, reading its token from the private file.
const find = ['/opt/homebrew/bin/cloudflared', join(homedir(), '.homebrew/bin/cloudflared'), '/usr/local/bin/cloudflared'];
let cloudflared = find.find((p) => existsSync(p));
if (!cloudflared) { try { cloudflared = execFileSync('/usr/bin/which', ['cloudflared']).toString().trim(); } catch {} }
if (!cloudflared) throw Error('cloudflared is not installed. Flourish uses it, so check with: which cloudflared');
const version = (execFileSync(cloudflared, ['--version']).toString().match(/(\d{4})\.(\d+)\.(\d+)/) || []).slice(1).map(Number);
if (!(version[0] > 2025 || (version[0] === 2025 && version[1] >= 4))) throw Error('cloudflared 2025.4.0 or later is needed (brew upgrade cloudflared)');
const xml = (x) => x.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const agentDir = join(homedir(), 'Library', 'LaunchAgents');
const agent = join(agentDir, TUNNEL_LABEL + '.plist');
const args = [cloudflared, 'tunnel', '--no-autoupdate', 'run', '--token-file', tokenPath];
mkdirSync(agentDir, {recursive: true});
writeFileSync(agent, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict><key>Label</key><string>${TUNNEL_LABEL}</string><key>ProgramArguments</key><array>${args.map((a) => '<string>' + xml(a) + '</string>').join('')}</array>
<key>RunAtLoad</key><true/><key>KeepAlive</key><true/><key>ThrottleInterval</key><integer>10</integer>
<key>StandardOutPath</key><string>/dev/null</string><key>StandardErrorPath</key><string>/dev/null</string></dict></plist>
`, {mode: 0o600});
execFileSync('/usr/bin/plutil', ['-lint', agent], {stdio: 'ignore'});
const domain = `gui/${process.getuid()}`;
try { execFileSync('/bin/launchctl', ['bootout', `${domain}/${TUNNEL_LABEL}`], {stdio: 'ignore'}); } catch {}
await new Promise((r) => setTimeout(r, 500));
execFileSync('/bin/launchctl', ['bootstrap', domain, agent], {stdio: 'ignore'});
// Restart ReadWell so it reads the new Access details.
execFileSync('/bin/launchctl', ['kickstart', '-k', `${domain}/uk.creativefibro.readwell`], {stdio: 'ignore'});

// Capture key to the clipboard, for the extension and the Shortcut.
const key = readFileSync(join(home, 'capture.key'), 'utf8').trim();
execFileSync('/usr/bin/pbcopy', [], {input: key});
console.log('\nDone. The tunnel starts now and at every login; ReadWell has restarted with its Access details.');
console.log('Your ReadWell capture key is on the clipboard: save it in 1Password as “ReadWell capture key”.');
console.log(`Next: open ${ORIGIN} in Vivaldi and sign in with ${EMAIL}.`);
