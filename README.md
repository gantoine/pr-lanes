# PR Lanes for GitHub

Bots comment on every pull request, and the two humans arguing about the actual change get buried
between coverage reports and CI summaries. PR Lanes splits a GitHub conversation into two lanes you switch
between: **Humans** and **Bots**.

Works on `github.com` pull requests and issues, in Chrome and Firefox.

## What it does

- Adds a lane switcher that costs no vertical space: at rest it is a vertical strip of icons in the left
  gutter, tucked under the author's avatar. Scroll past it and it becomes a horizontal switcher in GitHub's
  sticky header. Pages with neither an avatar nor a header get it in the tab row, or its own row above the
  timeline.
- The Humans and Bots buttons turn green or amber when that lane holds comments, grey when it does not.
  The pull request description does not count: every pull request has one, so counting it would light the
  human side of every page. No counts either: comments arrive while you read, and a number that drifts out
  of date is worse than no number.
- In the Humans lane, bot reviewers drop out of the **Reviewers** sidebar too, so the list shows the people
  whose review you are actually waiting on. Teams stay, since a team is people.
- Press `h` to cycle Humans → Bots → All. It is ignored while you are typing in a comment box.
- **Humans** shows people's comments and reviews. **Bots** shows everything posted by apps, CI, and review
  bots — including the timeline events they generate. **All** is GitHub's normal view. A setting strips
  timeline events out of the Humans lane too, if you want only what people wrote.
- A review thread that a bot started but a human replied to stays in the Humans lane — that is a human
  discussion, and it needs the bot comment above it for context.
- The pull request description and the comment box never disappear, whichever lane is selected, even when
  a bot opened the pull request.
- The same filter applies to inline review threads on the **Files changed** tab.

## Install

Build the two bundles first:

```bash
npm run build       # writes dist/chrome, dist/firefox and matching .zip files
```

**Chrome** — `chrome://extensions` → enable *Developer mode* → *Load unpacked* → select `dist/chrome`.

**Firefox** — `about:debugging#/runtime/this-firefox` → *Load Temporary Add-on* → select
`dist/firefox/manifest.json`. A temporary add-on is removed when Firefox restarts; use `dist/firefox.zip`
for a signed install through addons.mozilla.org.

The extension is entirely local: `storage` for settings and host access to `github.com`, no other
permission, no network calls, no background worker.

## Releasing

`git tag v0.3.0 && git push --tags`, or publish a GitHub Release against a new `v0.3.0` tag — either way the
tag push starts `.github/workflows/release.yml`, which refuses to go further unless the tag matches
`version` in `extension/manifest.json` and the tests pass. It then submits the Firefox add-on to
addons.mozilla.org, uploads and publishes the Chrome bundle, and attaches `chrome.zip` and `firefox.zip` to
the release.

Firefox and Chrome publish in separate jobs, so a Mozilla outage does not hold up the Chrome release, or the
other way around.

### One-time setup

**Firefox** — create the add-on once on [addons.mozilla.org](https://addons.mozilla.org/developers/) under
the id `pr-lanes@gantoine.com` (`build.mjs` writes it into the Firefox manifest) and fill in its listing.
Then create an API key pair at [the API key page](https://addons.mozilla.org/developers/addon/api/key/) and
store it as the repository secrets `WEB_EXT_API_KEY` and `WEB_EXT_API_SECRET`.

CI signs with `--channel listed --approval-timeout 0`: it uploads and exits rather than waiting out a review
that can take days. Mozilla emails you when the review finishes, and the listing updates itself — so a green
`firefox` job means *submitted*, not *live*.

**Chrome** — create the item once in the
[Web Store dashboard](https://chrome.google.com/webstore/devconsole) by uploading `dist/chrome.zip` by hand
and completing the store listing. Then, in a Google Cloud project with the Chrome Web Store API enabled,
make an OAuth client of type *Desktop app* and mint a refresh token for the
`https://www.googleapis.com/auth/chromewebstore` scope. Store:

| Name | Kind | Where it comes from |
| --- | --- | --- |
| `CHROME_EXTENSION_ID` | repository **variable** | the 32-letter id in the Web Store listing URL |
| `CHROME_CLIENT_ID` | secret | the OAuth client |
| `CHROME_CLIENT_SECRET` | secret | the OAuth client |
| `CHROME_REFRESH_TOKEN` | secret | the token exchange |

Publishing sends the upload to review. A green `chrome` job means the Web Store accepted and queued it.

### Running either step by hand

Both scripts read the same names from a gitignored `.env` when they are not already in the environment, so
`cp .env.example .env` and fill it in to drive a release from your machine. Each takes `--dry-run`, which
prints what it would send and which credentials it found without submitting anything:

```bash
npm run sign:firefox -- --channel listed --dry-run
npm run publish:chrome -- --dry-run
```

The repository declares no dependencies, so signing fetches `web-ext` through `npx` and needs the network
on its first run.

`npm run sign:firefox` with no `--channel` still signs **unlisted**, the self-distribution path: the `.xpi`
lands in `signed/`, and you host it anywhere and open the link in Firefox. Bump `version` in
`extension/manifest.json` before each unlisted run: addons.mozilla.org rejects a version it has already
signed. The script checks `signed/` for an `.xpi` carrying the current version and stops before uploading
if it finds one. On a fresh clone, or after `signed/` is cleared, a duplicate version surfaces as a failed
upload instead.

Chrome has no self-distribution equivalent. It refuses `.crx` installs from outside the Web Store unless
enterprise policy allows the extension id, so off-store sharing means handing people `dist/chrome.zip` to
unzip and *Load unpacked*, with manual updates.

## Settings

Chrome: `chrome://extensions` → *Details* → *Extension options*. Firefox: `about:addons` → *Preferences*.
Or click the gear in the lane switcher.

| Setting | Default | What it does |
| --- | --- | --- |
| Default lane | Humans | Lane a conversation opens in |
| Hide timeline events in the Humans lane | off | Labels, commits, reviews and merges drop out of the Humans lane, leaving only what people wrote. They still show in Bots and All |
| Hide resolved review threads | off | Threads somebody has already resolved drop out of the Humans and Bots lanes. They stay in All |
| Remember the lane per pull request | off | Keep a per-PR choice instead of one global lane |
| Extra bot accounts | — | Logins that post through a token and look human |
| Always treat as human | — | Overrides every bot signal |
| Name heuristics | on | Treat `*[bot]`, `*-bot`, `*-ci`, `*-app` logins as bots |

## How a bot is recognised

Every row gets two facts: who wrote it (`human`, `bot`, or nobody) and what it is (a comment, a timeline
event, or page furniture such as the comment box). Lanes filter on who wrote it; *Hide timeline events*
filters on what it is. Page furniture matches no hiding rule at all, so anything the extension does not
recognise is left alone rather than hidden.

Authorship is decided in this order, and the first rule that matches wins:

1. The *Always treat as human* list.
2. A `name[bot]` login, or an author link pointing at `/apps/…`.
3. The built-in bot list: 37 accounts, covering the most common apps and the accounts that post through a
   token and carry no other signal.
4. A GitHub App avatar (`avatars.githubusercontent.com/in/…`).
5. A `bot` or `AI` badge next to the author.
6. The name heuristics, when they are on.

Rule 2 is what catches `Copilot`, which carries no bot suffix. Every GitHub App has an `/apps/` link,
whatever display name it uses. Anything unrecognised counts as human, so a misdetection hides nothing.

Three things keep that from misfiring in either direction. Avatars inside a comment body are ignored, so a
commenter cannot post a bot avatar to hide their own comment. Badges are read next to the author only, not
anywhere in the row, so an event like "you requested a review from Copilot" stays in the Humans lane: it is
your action, not the bot's. A comment box with no author of its own, such as a collapsed "Show resolved"
thread, does not vote on who wrote the row it sits in.

Accounts that comment through a personal access token — some Codecov and internal release setups — carry no
bot signal at all. Add those under *Extra bot accounts*.

## Development

```
extension/
  manifest.json          Chrome MV3 manifest; build.mjs derives the Firefox one
  content/classify.js    Bot/human classification and timeline DOM traversal
  content/lanes.js       Lane state, the bar, storage, mutation and navigation handling
  content/lanes.css      Bar styling and the lane hiding rules
  options/               Settings page
test/
  classify.test.mjs      Unit tests for classification (node --test)
  e2e.mjs                Drives headless Chrome over CDP against the real content scripts
  e2e-page.html          A GitHub timeline in miniature: the markup both the test and --serve run against
  extension-stub.js      Minimal chrome.storage/runtime stand-in so the content scripts run in a plain page
tools/
  make-icons.mjs         Regenerates extension/icons
build.mjs                Writes dist/chrome and dist/firefox and their .zip files
sign.mjs                 Submits the Firefox bundle to addons.mozilla.org
publish-chrome.mjs       Uploads and publishes the Chrome bundle to the Web Store
env.mjs                  Reads .env when the credentials are not already in the environment
```

```bash
npm test            # unit tests, then the headless-Chrome end-to-end test
npm run test:unit
npm run test:e2e    # needs Chrome; override with CHROME=/path/to/chrome
npm run test:serve  # serves the real content scripts against test/e2e-page.html to eyeball in a browser
npm run build
npm run sign:firefox -- --channel listed --dry-run
npm run publish:chrome -- --dry-run
```

`test/e2e.mjs` loads `content/classify.js` and `content/lanes.js` into a page with a stubbed extension API
rather than installing the extension, because Chrome 137+ refuses `--load-extension` in branded builds. The
manifest itself is checked with `"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --pack-extension=dist/chrome`.

## Limits

- Scoped to `github.com`. For GitHub Enterprise, add your host to `matches` and `host_permissions` in
  `extension/manifest.json` and rebuild.
- Classification reads GitHub's DOM. The classic timeline (`.js-discussion`, `.TimelineItem`, including the
  `rails-partial` wrappers GitHub now nests them in) is verified against live pull request markup. Selectors
  for the newer React issue view (`issue-viewer-comments-container`) are present, but fall back to treating
  each child of the timeline container as one item. Unrecognised rows classify as page furniture and are
  never hidden, so unfamiliar markup degrades to GitHub's normal view. If GitHub reshuffles its markup,
  `content/classify.js` is the one file to update.
- Nothing is deleted or collapsed server-side — hiding is CSS on your machine, so everyone else sees the
  usual thread.

## Licence

MIT. See [LICENSE](LICENSE).
