// Private configuration on the Mac Studio (Flourish pattern): files must be owned by
// Susan and readable by nobody else.
import {readFileSync, lstatSync} from 'node:fs';
import {isAbsolute, join} from 'node:path';

export const ORIGIN = 'https://readwell.susanpearson.uk';
export const PORT = 4322;

export function privateFile(path) {
  const s = lstatSync(path);
  if (!s.isFile() || s.isSymbolicLink() || (s.mode & 0o077) !== 0 || s.uid !== process.getuid()) throw Error('Configuration files must be private and owned by this user');
  return readFileSync(path);
}

export function loadConfig(home) {
  if (!isAbsolute(home)) throw Error('Use an absolute ReadWell data directory');
  const dir = lstatSync(home);
  if (!dir.isDirectory() || dir.isSymbolicLink() || (dir.mode & 0o077) !== 0 || dir.uid !== process.getuid()) throw Error('ReadWell data directory must be private');
  const c = JSON.parse(privateFile(join(home, 'config.json')));
  if (c.origin !== ORIGIN) throw Error('Unexpected production origin');
  const captureKey = privateFile(join(home, 'capture.key')).toString().trim();
  if (captureKey.length < 24) throw Error('Capture key is missing');
  return {...c, captureKey, port: PORT, home};
}
