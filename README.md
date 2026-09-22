# PR Lanes for GitHub

[![Install for Chrome](https://img.shields.io/badge/Chrome-Install-4285F4?logo=googlechrome&logoColor=white)](https://chromewebstore.google.com/detail/hangdlmlkjibcjmnhecohkkplkagnhip) [![Install for Firefox](https://img.shields.io/badge/Firefox-Install-FF7139?logo=firefoxbrowser&logoColor=white)](https://addons.mozilla.org/en-US/firefox/addon/pr-lanes-hide-bots-on-github/)

Bots comment on every pull request, and the two humans arguing about the actual change get buried between coverage reports and CI summaries. PR Lanes splits a GitHub conversation into two lanes you switch between: **Humans** and **Bots**.

## What it does

**Humans** shows people's comments and reviews, **Bots** everything posted by apps, CI and review bots including the timeline events they generate, and **All** is GitHub's normal view. Press `h` to cycle between them; it is ignored while you are typing in a comment box. The same filter applies to inline review threads on the **Files changed** tab, and in the Humans lane bot reviewers drop out of the **Reviewers** sidebar as well, so the list shows the people whose review you are actually waiting on. Nothing useful disappears: the pull request description and the comment box survive every lane, and a thread a bot started but a human replied to stays in Humans, bot comment and all.

The extension is entirely local: `storage` for settings and host access to `github.com`, no other permission, no network calls, no background worker.

## Settings

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

Authorship is decided in this order, and the first rule that matches wins:

1. The *Always treat as human* list.
2. A `name[bot]` login, or an author link pointing at `/apps/…`.
3. The built-in bot list.
4. A GitHub App avatar (`avatars.githubusercontent.com/in/…`).
5. A `bot` or `AI` badge next to the author.
6. The name heuristics, when they are on.

- Avatars inside a comment body are ignored, so a commenter cannot post a bot avatar to hide their own comment.
- Badges are read next to the author only, not anywhere in the row, so an event like "you requested a review from Copilot" stays in the Humans lane: it is your action, not the bot's.
- A comment box with no author of its own, such as a collapsed "Show resolved" thread, does not vote on who wrote the row it sits in.

Accounts that comment through a personal access token — some Codecov and internal release setups — carry no bot signal at all. Add those under *Extra bot accounts*.

## Development

```bash
npm test            # unit tests, then the headless-Chrome end-to-end test
npm run test:unit
npm run test:e2e    # needs Chrome; override with CHROME=/path/to/chrome
npm run test:serve  # serves the real content scripts against test/e2e-page.html to eyeball in a browser
npm run build
npm run sign:firefox -- --channel listed --dry-run
npm run publish:chrome -- --dry-run
```

`test/e2e.mjs` loads `content/classify.js` and `content/lanes.js` into a page with a stubbed extension API rather than installing the extension, because Chrome 137+ refuses `--load-extension` in branded builds. The manifest itself is checked with `"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --pack-extension=dist/chrome`.

## Licence

MIT. See [LICENSE](LICENSE).
