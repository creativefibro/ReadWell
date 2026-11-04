// Installs or updates ReadWell as a login service on the Mac Studio (Flourish pattern).
//   node scripts/mac-install.mjs            install or update
//   node scripts/mac-install.mjs --dry-run  build the release folder only (any OS, for tests)
// Changes nothing in Cloudflare, DNS or Flourish.
import {cpSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, symlinkSync, writeFileSync, lstatSync, chmodSync, rmSync} from 'node:fs';
import {createHash, randomBytes, randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {request} from 'node:http';
import {ORIGIN, PORT} from '../server/config.mjs';

process.umask(0o077);
const dry = process.argv.includes('--dry-run');
const source = fileURLToPath(new URL('../', import.meta.url));
const home = process.env.READWELL_HOME || join(homedir(), 'Library', 'Application Support', 'ReadWell');
const LABEL = 'uk.creativefibro.readwell';
if (!dry && process.platform !== 'darwin') throw Error('The service installer is for macOS; use --dry-run elsewhere');
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 13)) throw Error('ReadWell needs Node 22.13 or later');

// 1. Private data folder, configuration and capture key (first install only).
if (existsSync(home)) {
  const s = lstatSync(home);
  if (s.isSymbolicLink() || !s.isDirectory() || (s.mode & 0o077) || s.uid !== process.getuid()) throw Error('ReadWell data folder must be private to you');
} else mkdirSync(home, {recursive: true, mode: 0o700});
const first = !existsSync(join(home, 'config.json'));
if (first) {
  const config = {origin: ORIGIN, issuer: '', audience: '', email: '', serviceClientId: ''};
  writeFileSync(join(home, 'config.json'), JSON.stringify(config, null, 2) + '\n', {mode: 0o600, flag: 'wx'});
}
if (!existsSync(join(home, 'capture.key'))) writeFileSync(join(home, 'capture.key'), randomBytes(24).toString('base64url') + '\n', {mode: 0o600, flag: 'wx'});

// 2. Versioned release: only the files the service needs, named by their content.
const parts = ['server', 'lib', 'web', 'migrations', 'package.json'];
const hash = createHash('sha256');
const walk = (rel) => {
  const full = join(source, rel);
  if (lstatSync(full).isDirectory()) for (const name of readdirSync(full).sort()) walk(join(rel, name));
  else { hash.update(rel); hash.update(readFileSync(full)); }
};
parts.forEach(walk);
const release = hash.digest('hex').slice(0, 16);
const target = join(home, 'releases', release);
if (!existsSync(target)) {
  const temp = target + '.tmp-' + randomUUID();
  mkdirSync(temp, {recursive: true, mode: 0o700});
  for (const p of parts) cpSync(join(source, p), join(temp, p), {recursive: true});
  renameSync(temp, target);
}
const link = join(home, 'current.new-' + randomUUID());
symlinkSync(target, link);
renameSync(link, join(home, 'current'));
if (dry) { console.log(`Dry run: release ${release} prepared in ${home}. No service registered.`); process.exit(0); }

// 3. Login service: starts at login, restarts on failure, logs nothing to the console.
const xml = (x) => x.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const agentDir = join(homedir(), 'Library', 'LaunchAgents');
const agent = join(agentDir, LABEL + '.plist');
const args = [process.execPath, '--no-warnings', join(home, 'current', 'server', 'main.mjs'), home];
mkdirSync(agentDir, {recursive: true});
writeFileSync(agent, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict><key>Label</key><string>${LABEL}</string><key>ProgramArguments</key><array>${args.map((a) => '<string>' + xml(a) + '</string>').join('')}</array>
<key>RunAtLoad</key><true/><key>KeepAlive</key><true/><key>ThrottleInterval</key><integer>10</integer><key>Umask</key><integer>63</integer>
<key>StandardOutPath</key><string>/dev/null</string><key>StandardErrorPath</key><string>/dev/null</string></dict></plist>
`, {mode: 0o600});
chmodSync(agent, 0o600);
execFileSync('/usr/bin/plutil', ['-lint', agent], {stdio: 'ignore'});
const domain = `gui/${process.getuid()}`;
try { execFileSync('/bin/launchctl', ['bootout', `${domain}/${LABEL}`], {stdio: 'ignore'}); } catch { /* not running yet */ }
for (let i = 0; ; i++) {
  try { execFileSync('/bin/launchctl', ['bootstrap', domain, agent], {stdio: 'ignore'}); break; }
  catch (e) { if (i >= 10) throw e; await new Promise((r) => setTimeout(r, 500)); }
}

// 4. Health check: the public manifest answers on loopback with the expected host.
const healthy = () => new Promise((resolve) => {
  const req = request({hostname: '127.0.0.1', port: PORT, path: '/manifest.webmanifest', headers: {Host: new URL(ORIGIN).host}, timeout: 1000},
    (res) => { res.resume(); resolve(res.statusCode === 200); });
  req.on('error', () => resolve(false)); req.on('timeout', () => req.destroy()); req.end();
});
for (let i = 0; i < 40; i++) {
  if (await healthy()) {
    // Keep the newest three releases.
    const dir = join(home, 'releases');
    for (const name of readdirSync(dir).filter((n) => n !== release && !n.includes('.tmp-'))
      .map((n) => ({n, t: lstatSync(join(dir, n)).mtimeMs})).sort((a, b) => b.t - a.t).slice(2)) rmSync(join(dir, name.n), {recursive: true});
    console.log(`ReadWell ${first ? 'installed' : 'updated'} (release ${release}) and running on this Mac only, port ${PORT}.`);
    console.log(first ? 'It stays locked until its Cloudflare Access details are added. Nothing in Cloudflare or DNS was changed.' : 'No settings were changed.');
    process.exit(0);
  }
  await new Promise((r) => setTimeout(r, 250));
}
throw Error('ReadWell did not start. Check ~/Library/Application Support/ReadWell/logs.');
