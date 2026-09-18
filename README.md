# PR Lanes for GitHub

A dozen bots comment on every pull request, and the two humans arguing about the actual change get buried
between coverage reports and CI summaries. PR Lanes splits a GitHub conversation into two lanes you switch
between: **Humans** and **Bots**.

Works on `github.com` pull requests and issues, in Chrome and Firefox.

## What it does

- Adds a lane switcher that costs no vertical space: at rest it is a vertical strip of icons in the left
  gutter, tucked under the author's avatar. Scroll past it and it becomes a horizontal switcher in GitHub's
  sticky header. Pages with neither an avatar nor a header get it in the tab row, or its own row above the
  timeline.
- Humans and Bots colour themselves — green or amber when that lane holds comments, grey when it does not.
  No counts: comments arrive while you read, and a number that drifts out of date is worse than no number.
- In the Humans lane, bot reviewers drop out of the **Reviewers** sidebar too, so the list shows the people
  whose review you are actually waiting on. Teams stay, since a team is people.
- **Humans** shows people's comments and reviews. **Bots** shows everything posted by apps, CI, and review
  bots — including the timeline events they generate. **All** is GitHub's normal view.
- A review thread that a bot started but a human replied to stays in the Humans lane — that is a human
  discussion, and it needs the bot comment above it for context.
- The pull request description and the comment box never disappear, whichever lane is selected, even when
  a bot opened the pull request.
- The same filter applies to inline review threads on the **Files changed** tab.

## Install

Build the two bundles first:

```bash
node build.mjs      # writes dist/chrome, dist/firefox and matching .zip files
```

**Chrome** — `chrome://extensions` → enable *Developer mode* → *Load unpacked* → select `dist/chrome`.

**Firefox** — `about:debugging#/runtime/this-firefox` → *Load Temporary Add-on* → select
`dist/firefox/manifest.json`. A temporary add-on is removed when Firefox restarts; use `dist/firefox.zip`
for a signed install through addons.mozilla.org.

The extension is entirely local: one `storage` permission for settings, no network calls, no background
worker.

## Settings

Chrome: `chrome://extensions` → *Details* → *Extension options*. Firefox: `about:addons` → *Preferences*.
Or click the gear in the lane switcher.

| Setting | Default | What it does |
| --- | --- | --- |
| Default lane | Humans | Lane a conversation opens in |
| Show timeline events | on | Labels, commits, reviews and merges appear next to comments. Each event follows its own author's lane |
| Remember the lane per pull request | off | Keep a per-PR choice instead of one global lane |
| Extra bot accounts | — | Logins that post through a token and look human |
| Always treat as human | — | Overrides every bot signal |
| Name heuristics | on | Treat `*[bot]`, `*-bot`, `*-ci`, `*-app` logins as bots |

## How a bot is recognised

Every row gets two facts: who wrote it (`human`, `bot`, or nobody) and what it is (a comment, a timeline
event, or page furniture such as the comment box). Lanes filter on the author; the *Show timeline events*
setting filters on the form. Page furniture matches no hiding rule at all, so anything the extension does
not recognise is left alone rather than hidden.

Authorship is decided in order: the human override list, a `name[bot]` login **or an author link pointing at
`/apps/…`** (every GitHub App has one, whatever display name it uses — this is what catches `Copilot`, which
shows an `AI` badge and no bot suffix), the built-in bot list (~37 accounts that post through a token and
carry no other signal, plus the most common apps), a GitHub App avatar
(`avatars.githubusercontent.com/in/…`), a `bot` or `AI` badge next to the author, then the name heuristics.
Anything unrecognised counts as human, so a misdetection hides nothing.

Two things keep that from misfiring in either direction. Avatars inside a comment body are ignored, so a
commenter cannot post a bot avatar to hide their own comment. Badges are read next to the author only, not
anywhere in the row, so an event like "you requested a review from Copilot" stays in the Humans lane — it is
your action, not the bot's. And a comment box with no author of its own (a collapsed "Show resolved" thread,
for instance) does not vote on who wrote the row it sits in.

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
```

```bash
npm test            # unit tests, then the headless-Chrome end-to-end test
npm run test:unit
npm run test:e2e    # needs Chrome; override with CHROME=/path/to/chrome
npm run test:serve  # serves the real content scripts against test/e2e-page.html to eyeball in a browser
node build.mjs
```

`test/e2e.mjs` loads `content/classify.js` and `content/lanes.js` into a page with a stubbed extension API
rather than installing the extension, because Chrome 137+ refuses `--load-extension` in branded builds. The
manifest itself is checked with `"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --pack-extension=dist/chrome`.

## Limits

- Scoped to `github.com`. For GitHub Enterprise, add your host to `matches` and `host_permissions` in
  `extension/manifest.json` and rebuild.
- Classification reads GitHub's DOM. The classic timeline (`.js-discussion`, `.TimelineItem`, including the
  `rails-partial` wrappers GitHub now nests them in) is verified against live pull request markup; selectors
  for the newer React issue view (`issue-viewer-comments-container`) are present but fall back to treating
  each child of the timeline container as one item. Unrecognised rows classify as page furniture and are
  never hidden, so unfamiliar markup degrades to GitHub's normal view. If GitHub reshuffles its markup,
  `content/classify.js` is the one file to update.
- Nothing is deleted or collapsed server-side — hiding is CSS on your machine, so everyone else sees the
  usual thread.
