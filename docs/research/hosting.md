# Hosting and sync: reusing the Flourish approach

Research for ReadWell. Done 2026-11-04.
[V] verified in a source, [K] from knowledge, [U] unverified, test first.

## Findings: how Flourish actually runs
- Production is not hosted on Cloudflare compute. It runs on the Mac Studio: Node 24 with
  built-in `node:sqlite`, listening on 127.0.0.1:4318 only, started by a LaunchAgent at
  login and restarted on failure. [V] flourish `docs/MAC-STUDIO.md`, `server/main.mjs`
- Cloudflare provides two free services in front of it:
  - **Tunnel** (remotely managed) maps `flourish.susanpearson.uk` to the loopback port;
    no router ports opened. Token kept in a private 0600 file. [V] `docs/MAC-STUDIO.md`
  - **Access** (Zero Trust Free) allows only one email, with email code or a 1Password
    passkey. The server verifies the Access JWT's signature, issuer, audience, expiry and
    email itself (`server/access.mjs`). [V]
- `susanpearson.uk` DNS moved to Cloudflare Free on 31 Oct 2026; Fastmail mail and the
  Krystal website records were preserved. Adding `readwell.susanpearson.uk` needs no
  nameserver work. [V] `docs/MAC-STUDIO.md`
- The `worker/` code and D1 database belong to the separate OpenAI Sites preview
  (`.openai/hosting.json`, `oai-authenticated-user-id`), not Susan's Cloudflare account. [V]
- "Sync" is one central database: every device talks to the Mac. There is no service
  worker, offline storage or change queue; saves use whole-workspace version checks and
  return 409 on conflict. [V] `web/app.js`, `worker/index.js`
- Encrypted SQLite backups every six hours to iCloud Drive, verified and rotated;
  versioned releases with rollback; public exceptions only for exact icon/manifest paths
  so Home Screen icons work. [V] `docs/MAC-STUDIO.md`, `server/application.mjs`
- Access application sessions can last from immediate to one month (default 24 hours);
  global sessions 15 minutes to one month. [V](https://developers.cloudflare.com/cloudflare-one/identity/users/session-management)
- When a session expires, background requests can be silently blocked; sending
  `X-Requested-With: XMLHttpRequest` makes Access return 401 instead. [V](https://developers.cloudflare.com/cloudflare-one/identity/users/session-management)
- Non-browser clients pass Access with a service token: `CF-Access-Client-Id` and
  `CF-Access-Client-Secret` headers, matched by a Service Auth policy. [V](https://developers.cloudflare.com/cloudflare-one/access-controls/service-credentials/service-tokens/)
- Zero Trust Free covers up to 50 users; tunnels and service tokens have no charge. [K]

## Comparison
| Need | Flourish today | ReadWell |
| --- | --- | --- |
| Server, database | Mac Studio, Node, SQLite | Same pattern, own port, folder, database |
| Public address | Tunnel + proxied DNS | Own tunnel, `readwell.susanpearson.uk` |
| Sign-in | Access, one email, 24 h, passkey | Same, but 1-month session |
| Shortcut and extension | n/a | Service token on capture path only |
| Offline | none | Service worker, IndexedDB, change queue (new) |
| Sync | whole workspace, online only | per-record changes, merge on reconnect (new) |
| Mac-only exports | n/a | Obsidian and Anybox run in the server itself |
| Backups, updates | encrypted iCloud, rollback | Reuse modules |

## Decisions
1. Host ReadWell like Flourish (Mac Studio + Tunnel + Access), not Krystal, because the
   pattern is proven on Susan's account and puts the Obsidian vault and Anybox's local
   API on the same machine as the server. No Mac helper program is needed. Krystal
   enquiry dropped.
2. Keep ReadWell fully separate: own tunnel, Access application, database, LaunchAgents,
   backup key. Planned test: Flourish unaffected after ReadWell install.
3. Access application session one month, passkey sign-in. Planned test: iPhone Home
   Screen app stays signed in across a week of normal use. [U]
4. Capture uses a service token limited to `POST /api/capture`, plus ReadWell's own
   per-device key. Planned test: token cannot read the queue or any other path.
5. Shortcut fallback: if the Mac is unreachable, append the link to a ReadWell Inbox file
   in iCloud Drive; the server imports it on next start. Planned test: Mac asleep, save,
   wake, article appears once.
6. Offline and sync are new code: service worker, IndexedDB, per-record outbox. Planned
   test: aeroplane mode on iPhone, highlight, reconnect, highlight on Mac.

7. Obsidian export writes one Markdown note per article straight into
   `~/Areas/Commonplace` (confirmed by Susan; synced by Obsidian Sync). `~/Areas` is
   outside macOS's protected Documents/Desktop folders, so the background service can
   write there without extra permission prompts. [K] Obsidian Sync uploads the new
   note the next time Obsidian runs on any device. Planned test: export, then note
   appears in Obsidian on iPhone.
8. Capacities export uses API 2.0 with Susan's Pro plan (Believer grandfathered).
   Planned test in M3: create one object from a real token, check source fields and
   highlights render as expected.

## Open questions
- Does an iOS Home Screen web app keep the Access cookie for a month? [U] test in M1.
- RESOLVED: ReadWell sign-in email is accounts@susanpearson.uk (Susan, 4 Nov). Save route is a separate Access application with its own audience.
- RESOLVED: notes go to `~/Areas/Commonplace/ReadWell/` (Susan, 4 Nov). Mac does not sleep; only occasional updates/reboots. Repository: Creative Fibro GitHub organisation (`creativefibro/readwell`).
