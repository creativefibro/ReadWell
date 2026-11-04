# ReadWell

Susan's calm read-it-later web app: save articles from Vivaldi or the iPhone Share
menu, choose something to read, read comfortably, then finish with an optional rating.

Production will follow Flourish's pattern (Node and SQLite on the Mac Studio, a
Cloudflare Tunnel, Cloudflare Access). See `docs/BRIEF.md`, `docs/STORIES.md` and
`docs/research/hosting.md`. Milestone 1 runs locally only.

## Run locally

Node 22.13 or later (Node 24 on the Mac Studio). No packages to install: the server
uses only Node's built-in modules, and Mozilla Readability is vendored in `web/vendor/`.

    npm test          # unit tests
    npm start         # http://127.0.0.1:4320, data in .local/

The development server listens on this Mac only and has no sign-in. Never expose it on
a network. It prints the **capture key** the extension needs (also in `.local/capture.key`).

## Vivaldi extension

1. Open `vivaldi://extensions`, turn on **Developer mode**, choose **Load unpacked**, and
   pick the `extension` folder.
2. The extension's settings open: keep the address `http://127.0.0.1:4320` for now and
   paste the capture key. Choose **Save Settings**.
3. On any article, choose the ReadWell toolbar button (or press Option-Shift-R).
   It shows **Saved to ReadWell** or **Already in your Queue**.

The extension sends the page as you see it, so articles you're signed in to are saved
in full. Medium articles are always saved as **Opens in Medium**.

## How saving works

- `POST /api/capture` with `X-ReadWell-Key` accepts `{url, title?, html?, source}`.
- With `html` (the extension), the page is used as sent. Without it (the Shortcut), the
  server fetches the link. Local and private network addresses are refused.
- The server reads title, author, site and date, and recognises duplicates by link,
  ignoring tracking parameters. Medium articles keep their details but no text.
- The app tidies the article in the browser (Readability plus an allowlist sanitiser in
  `web/clean.js`) and stores the clean version. Article HTML is sanitised again before
  every display, under a strict Content Security Policy.

## Checks

- `npm test`: unit tests, one per acceptance line marked [unit] in `docs/STORIES.md`.
- `tools/snap.py`: screenshots of every page at phone and desktop width, light and dark,
  failing on horizontal overflow or console errors.
- `tools/flow_check.py`: reading position, Lucky Dip, Finish, remembered choices.
- `tools/extension_check.py`: loads the extension in Chrome and saves a page twice.

These tools need Python Playwright and Chrome.
