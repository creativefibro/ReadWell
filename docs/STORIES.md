# ReadWell stories

Checks: [unit] automated test, [snap] screenshot at phone (390 px) and desktop
(1280 px) widths in light and dark, [self] scripted end-to-end check against a
running server, [manual] Susan tries it on her own device.
Snapshot pages: queue, queue-empty, search, reader, reader-link, finish.

## M1 Save and read (local development)
Ends with: ReadWell running locally with real saved articles, read on the Mac.

### S-001 Save an article by its link
As Susan, I send a link to ReadWell and it appears in my Queue with its title,
site, author, date and reading length.
Screens: queue
Acceptance:
- [unit] A saved page stores title, author, site, original link, published date when present, date saved and reading length.
- [unit] Article text is cleaned: no scripts, styles, frames, forms, event attributes or javascript: links survive.
- [unit] A page that cannot be fetched is still saved with its link and a title taken from the link, marked "Couldn't fetch this page".
- [self] Saving a real public article returns "Saved" within 15 seconds. (Verified with real page snapshots; live fetch from the Mac checked in M2.)
UX:
- Flow: extension or Shortcut sends link -> server fetches and cleans -> article appears in Queue on next open
- Surface: none in the app; result shown by the sender (extension badge, Shortcut notification)
- States: fetch failure keeps the article with a quiet "Couldn't fetch this page. Opens in original." line
- Words: "Saved to ReadWell", "Couldn't fetch this page"
Status: done

### S-002 Recognise an article already in the Queue
As Susan, saving the same article twice tells me it is already there and keeps one copy.
Depends: S-001
Acceptance:
- [unit] Links differing only by tracking parameters (utm_*, fbclid, gclid, Medium source=), fragment, trailing slash or host case match.
- [unit] A second save returns "Already in your Queue" and does not create a copy.
- [unit] Saving an article finished before still saves it, and says when it was last finished.
UX:
- Words: "Already in your Queue", "Saved to ReadWell. You finished this on 3 Nov 2026."
Status: done

### S-003 Save a Medium article as Opens in Medium
As Susan, a Medium article is saved with its details but opens in Medium, with no text copied.
Depends: S-001
Acceptance:
- [unit] medium.com links, *.medium.com links and pages that declare Medium's app metadata are saved without article text.
- [snap] The Queue row shows "Opens in Medium"; reading length is omitted unless supplied.
UX:
- Words: "Opens in Medium" on the row; generic sites use "Opens in original"
Status: done

### S-004 Browse the Queue in my preferred order
As Susan, I open ReadWell and see my Queue straight away, ordered Oldest first, Newest first or Shortest first, and ReadWell remembers my choice.
Screens: queue, queue-empty
Acceptance:
- [unit] Each order returns articles correctly; ties fall back to oldest first.
- [unit] The chosen order is stored on the server and used on every device.
- [snap] Each row shows title, site, reading length and how long ago it was saved; nothing else competes for attention.
- [snap] Empty Queue says "Nothing waiting. Save an article from Vivaldi or the Share menu and it will appear here."
UX:
- Flow: open ReadWell -> Queue is the first and only start page -> choose order from a small menu above the list
- Surface: home page; order is an inline menu (changes one value on screen)
- States: empty as above; error "Unable to load your Queue. Check your connection and try again." with "Try Again"
- Words: "Oldest first", "Newest first", "Shortest first"
- Access: rows are links reachable by keyboard; the order menu is a native select with a label
Status: done

### S-005 Search the Queue
As Susan, I type a word or phrase and see matching articles.
Screens: search
Depends: S-004
Acceptance:
- [unit] Search matches title, author, site and article text, case-insensitively, and treats input as plain text.
- [snap] No match shows "No articles match "phrase"." with "Clear Search".
UX:
- Flow: search field above the list -> results replace the list as you type -> Clear Search or Escape restores it
- Surface: inline field
- Access: field labelled "Search your Queue"
Status: done

### S-006 Lucky Dip
As Susan, I choose Lucky Dip and ReadWell opens a random article from my Queue.
Depends: S-004
Acceptance:
- [unit] Lucky Dip only picks Queue articles, never the one currently in Continue Reading when others exist.
- [self] Choosing Lucky Dip opens the Reader or the original for that article.
UX:
- Surface: one quiet button beside the order menu; hidden when the Queue is empty
- Words: "Lucky Dip", hover help "Open a random article from your Queue"
Status: done

### S-007 Continue Reading
As Susan, the article I was last reading sits at the top of the Queue so I can carry on in one step.
Depends: S-008
Acceptance:
- [unit] Continue Reading is the most recently opened unfinished article.
- [snap] It shows as a single card above the list with its title and "Continue Reading"; it does not appear twice.
UX:
- Surface: card at the top of the Queue page
- States: hidden when nothing has been opened
Status: done

### S-008 Read an article and come back to the same place
As Susan, I open an article in a calm Reader, and when I return later it opens where I left off.
Screens: reader
Depends: S-001
Acceptance:
- [snap] Reader shows title, site, author, date, reading length and the cleaned text in a comfortable column, in light and dark.
- [unit] Reading position is saved as a fraction of the article and restored on open, on any device.
- [self] Opening an article records today as a reading day.
- [snap] A text size control offers three sizes and remembers the choice on this device.
UX:
- Flow: choose a row -> Reader opens -> scroll -> Back returns to the Queue at the same scroll place
- Surface: full page (a self-contained task)
- Words: "Back to Queue", "Open Original", "Finish…"
- Access: article is a single landmark with a heading; links in the text open in a new tab
Status: done

### S-009 Open an article that Opens in Medium or the original
As Susan, choosing an "Opens in Medium" article opens it in Medium, and when I return ReadWell asks if I finished it.
Screens: reader-link
Depends: S-003
Acceptance:
- [snap] The page shows the article details with "Open in Medium" (or "Open Original") as the main action and "Finish…" beside it.
- [unit] Opening it records a reading day and makes it Continue Reading.
- [manual] On iPhone the Medium link opens the Medium app.
UX:
- Surface: small details page instead of the Reader
- Words: "Open in Medium", "Finished it? Finish…"
Status: done (iPhone check that the Medium link opens the Medium app is in M2)

### S-010 Finish an article with an optional rating, then delete it
As Susan, I finish an article, optionally give it one to five stars, and delete it; its history and rating stay.
Screens: finish
Depends: S-008
Acceptance:
- [unit] Finishing writes a History entry (title, author, site, link, date finished, rating or none, outcome) before the article is removed.
- [unit] The article leaves the Queue only after the History entry is saved.
- [snap] The Finish dialog shows five stars (optional) and "Delete" with "Cancel". Export and Archive options appear in M4.
UX:
- Flow: Finish… -> choose stars (optional) -> Delete -> back to Queue with "Finished. Rating saved." and the next suggestion
- Surface: sheet (one short task that must finish or cancel)
- Words: title "Finish Article"; "How much did you enjoy or gain from it?"; buttons "Delete" and "Cancel"
- Access: stars are a radio group labelled "Rating", Escape cancels
Status: done

### S-011 Save the current page from Vivaldi
As Susan, I choose the ReadWell button in Vivaldi and the page I'm reading, including signed-in content, is saved.
Depends: S-001, S-002
Acceptance:
- [unit] The extension sends the page as shown (scripts and styles removed); ReadWell tidies and sanitises it like any saved page.
- [self] Loaded unpacked in a Chromium browser, saving a real article shows "Saved" on the button; saving again shows "Already in your Queue".
- [manual] Susan loads it in Vivaldi and saves an article she is signed in to.
UX:
- Surface: toolbar button with a small popup showing the result
- Words: "Saved to ReadWell", "Already in your Queue", "Unable to reach ReadWell. Is your Mac Studio on?"
Status: done (live in Vivaldi 5 Nov)

## M2 Live on your devices
- S-020 Install ReadWell as a login service on the Mac Studio (Flourish installer pattern, own folder and port 4322). Done 5 Nov.
- S-021 Publish readwell.susanpearson.uk through its own Cloudflare Tunnel. Done 5 Nov (tunnel "ReadWell Mac Studio"; token rotated after an on-screen exposure).
- S-022 Protect it with its own Access application: accounts@susanpearson.uk, email code or passkey, one-month session. Done 5 Nov.
- S-023 Serve icon and manifest paths publicly so Home Screen install works. Done 5 Nov (Access path overrides, as Flourish).
- S-024 Show "Sign in again" when the session expires, without losing anything. Built.
- S-025 Capture path accepts only a service token plus a ReadWell capture key. Done 5 Nov: separate "ReadWell Save" Access app, preflight bypass for extension CORS; first live save from Vivaldi.
- S-026 "Save to ReadWell" Shortcut: accepts web pages, links and text containing a link; confirms in a notification.
- S-027 Shortcut fallback to an iCloud Drive inbox when the Mac is unreachable; imported once on next start.
- S-028 Shortcut tested from Medium, Quiche, the Fastmail app (Medium Daily Digest links) and two more apps (checklist with Susan). Susan uses Fastmail, not Apple Mail.
- S-029 Install on iPhone and iPad Home Screens; stays signed in through a week of use.

## M3 Offline, highlights and notes
- S-030 Save for Offline: article text and images stored on the device.
- S-031 Offline reading from the Home Screen app with no connection.
- S-032 Changes made offline (position, highlights, notes, tags, finishes) queue and send on reconnect.
- S-033 Highlight a passage in one of four colours (Mac and touch selection).
- S-034 Add or edit a Note on a Highlight.
- S-035 Remove or recolour a Highlight.
- S-036 Add optional Tags and filter the Queue by Tag.

## M4 Finish and export
- S-040 Finish with highlights: Export to Obsidian (one note per article in Commonplace/ReadWell, highlights with notes, source details, optional full article).
- S-041 Export to Capacities through API 2.0 with source details and highlights.
- S-042 Finish without highlights: Archive to Anybox or Delete.
- S-043 Article stays in the Queue as "Exporting…" until every chosen export succeeds; failures retry and say why.
- S-044 One-year rule: unread articles saved over a year ago are deleted daily.
- S-045 Encrypted iCloud backups and recovery (Flourish pattern).

## M5 Reading Insights and polish
- S-050 Reading Insights: sites and publications, article and highlight counts.
- S-051 Calendar heatmap of reading days (read / didn't read only).
- S-052 History list with ratings.
- S-053 Icon specification for Clara; final empty states and settings.

## Dropped
- Medium text extraction and Medium highlights: Medium app and Web Highlights cover them.
- Native apps, Krystal hosting, Share Sheet extension: replaced by the web app, Mac hosting and the Shortcut.
- Reading-time tracking, streaks, badges, targets, reminders: not wanted.
- In-app AI chat: conversations happen in Susan's own AI apps.

## Later
- Agent access for Clara: scoped token, add articles with added_by, read highlights and ratings.
