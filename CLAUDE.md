# CLAUDE.md

Context for working on this repo. Read alongside `README.md` (which covers how
to run things); this file covers **why things are the way they are**, the
invariants that are easy to break, and the bugs already found so they are not
rediscovered the hard way.

## What this is

The personal website of **Leland D. Crane, a principal economist at the Federal
Reserve Board**. Static HTML/CSS/JS on GitHub Pages, no build step. The audience
is other economists, so the design brief is *clean and modern, nothing that
reads as weird to an academic*. Deploy = `git push origin main`.

Two non-obvious consequences of who the author is:

- The site carries a disclaimer that views are his own, not the Board's. Keep it.
- **Be careful with editorial content about industries the Fed regulates.** One
  generated haiku read "Rich men gambling with your age" for the securities
  series; it was replaced. If generated text editorializes about finance,
  monetary policy, or named institutions, flag it rather than shipping it.

## Architecture

Everything is precomputed into two committed JSON files and read by plain JS in
the browser. There is no server and no runtime dependency.

```
BLS CES flat files ──► pipeline/build_data.py  ──► data/employment.json ──┐
Census NAICS xlsx  ──► pipeline/gen_haikus.py  ──► data/haikus.json   ──┤
                                                                        ▼
                                     employment.html / employment.js (the chart)
                                     tree.html / tree.js (the browse tree)
```

Run the pipelines via `pipeline/refresh_ces.sh` and `pipeline/refresh_haikus.sh`,
not by invoking the Python directly — the wrappers handle raw-file location,
dependency and key checks, and post-run verification.

## Core domain concept: "atoms"

The chart shows a partition of total nonfarm employment. An **atom** is the
finest seasonally-adjusted CES series such that the atoms are mutually exclusive
and sum to total nonfarm. There are currently **136**.

`build_data.py` selects them by walking the CES industry tree and splitting a
node only if *every* child has SA data, is current, starts early enough, and the
children **sum to the parent within tolerance in every overlapping month**. That
additivity check is the whole ballgame — without it you get double counting.

Things that will bite you here:

- **CES codes are not hierarchical by digit prefix.** The tree is built from
  `display_level` + `sort_sequence` in `ce.industry`, not by string prefixes.
- **Four aggregates overlap the supersectors** (Total private, Goods-producing,
  Service-providing, Private service-providing) and are dropped, or the
  partition double counts.
- **`naics_code` is messy**: ranges (`31-33`), lists (`21221,3,9`), `part 238`
  splits, and `-` for government series with no NAICS at all. `expand_naics()`
  handles these; government series legitimately have no NAICS.
- **Detailed series lag total nonfarm by one month.** The currency check accepts
  the latest month *or* the one before it.
- Construction uses residential/nonresidential `part` splits as an alternative
  partition when the NAICS children fail the sum check.

If the atom count changes after a refresh, `data/haikus.json` is out of sync —
run the haiku pipeline to fill in new series.

## Site behaviour worth knowing

- **Rotation is per minute, deterministic.** `employment.js` builds one fixed
  shuffle of the atoms (`SEED = 20260718`) and indexes it by
  `floor(Date.now() / 60000) % n`. Every visitor sees the same series at the
  same wall-clock minute. Do not make this random per load — next/previous
  navigation and shareability depend on it being deterministic.
- **Deep links**: `employment.html?ces=<CES code>` opens a specific series.
- **The hero photo is landing-page only.** Its CSS lives inline in `index.html`,
  not in `styles.css`, so it cannot leak onto the other pages.
- The chart is hand-rolled SVG (no D3). Two series only: the atom in accent
  blue, total nonfarm in muted grey.

## Bugs already found and fixed — do not reintroduce

1. **Census writes a literal string `"NULL"`** as the description at aggregate
   NAICS levels (e.g. 1133 Logging, 4551 Department Stores). 21 of 136 series
   had no usable prose. `lookup()` now treats `"NULL"` as empty and falls back
   to the 6-digit children's descriptions.
2. **The model returned `"ces 10113300"` as the JSON key** instead of
   `"10113300"`. Keys are now normalized and validated against the codes
   actually requested. If this silently regresses, every haiku lookup on the
   site fails and no haiku renders — while the file still looks populated.
3. **Batching in CES sort order made every batch a single sector** (all mining,
   all retail), so "vary the angle" produced twelve consecutive melancholy
   decline poems. Records are now shuffled with a fixed seed before batching.
4. **`#haiku { display:flex }` beat the `[hidden]` attribute**, so an empty
   haiku block showed a stray border. Needs the explicit
   `#haiku[hidden] { display: none }`.
5. **A background-image hero cropped the photo's bottom clouds off** and a
   fade-to-page-background blacked them out. The hero is anchored
   `center bottom` and tall enough for both towers and cloud bank; do not
   reintroduce a bottom fade.

## Conventions

- **No frameworks, no CDNs, no build step.** Everything must work as committed.
- Keep `data/*.json` committed — the site fetches them directly.
- Raw BLS files are large and stay out of git (`.cache/`).
- Match the existing code style: plain ES5-ish JS in IIFEs, CSS custom
  properties for theming, both light and dark mode supported everywhere.
- Verify UI changes in a browser before claiming they work; check light **and**
  dark, desktop **and** mobile.

## Environment gotchas

- **Shell env does not inherit.** The agent's Bash tool runs a non-login,
  non-interactive shell with `BASH_ENV` unset, so it sources *no* dotfile —
  exports added to `~/.profile` or `~/.zshrc` will not reach it. That is why the
  haiku pipeline reads the key from `~/.anthropic_key` at call time. (The user's
  login shell is Homebrew bash; there is no `.zshrc`.)
- **BLS blocks default user agents.** `refresh_ces.sh` sends a browser-like UA
  with a contact address, per BLS's request for automated downloads.
- Python deps are user-site installs: `pip3 install --user openpyxl anthropic`.
- **Never commit an API key**, and never print one into the transcript. Never
  commit an image without stripping EXIF — the original hero photo carried GPS.
