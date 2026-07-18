# ldcrane.github.io

Personal website of Leland D. Crane. Plain static HTML/CSS/JS served by GitHub
Pages — **no build step, no framework, no dependencies at runtime**. The
`.nojekyll` file tells Pages to serve the files exactly as committed.

Deploy is `git push origin main`. The live site rebuilds within a minute or two.

---

## Pages

| File | What it is |
|---|---|
| `index.html` | Landing page: photographic hero, bio, full publication list |
| `employment.html` + `employment.js` | **Industry of the minute** — a different CES employment series each minute, indexed to 2019 = 100 and drawn against total nonfarm, with a haiku |
| `tree.html` + `tree.js` | **Browse all series** — the CES hierarchy as a zoomable, searchable tree |
| `styles.css` | Shared styles (palette, typography, nav, publication list) |
| `data/employment.json` | Prebuilt indexed series (~464 KB, committed) |
| `data/haikus.json` | One haiku per series (committed) |
| `images/towers.jpg` | Landing-page hero photo (metadata stripped — see below) |
| `files/` | CV and paper PDFs |

There is no server. Both data files are committed and fetched by the browser.

### Viewing it locally

```sh
python3 -m http.server 8000     # then open http://localhost:8000
```

Opening the HTML files directly with `file://` will **not** work — the pages
`fetch()` their JSON, which browsers block on `file://`.

---

## The two pipelines

They are deliberately separate. The CES one is free and run monthly; the haiku
one costs money and is run rarely.

### 1. CES data — run monthly, free

```sh
./pipeline/refresh_ces.sh              # download + rebuild data/employment.json
./pipeline/refresh_ces.sh --report     # dry run: audit which series were chosen
```

Downloads the BLS CES flat files and rebuilds `data/employment.json`. Needs only
`python3` and `curl`. Raw files (~20 MB) land in `.cache/ces/`, which is
gitignored and never committed.

Afterwards, check the printed partition line — the selected series must sum to
total nonfarm within a few thousand jobs. **If the series count changes**, new
industries appeared or old ones vanished, so run the haiku pipeline to fill in
the gaps.

### 2. Haikus — run rarely, costs ~6 cents

```sh
./pipeline/refresh_haikus.sh --prepare   # free: build the model inputs, then stop
./pipeline/refresh_haikus.sh --trial     # ~$0.005: 12 haikus, then stop
./pipeline/refresh_haikus.sh             # fill in whatever is missing
./pipeline/refresh_haikus.sh --all       # discard and redo all 136
```

Requires an Anthropic API key, either in `~/.anthropic_key` (a file containing
just the key, `chmod 600`) or exported as `ANTHROPIC_API_KEY`. Get one at
console.anthropic.com — **API usage bills to Console credits, not to a Claude
subscription.** Also needs `pip3 install --user openpyxl anthropic`.

**Always run `--prepare` and skim `pipeline/haiku_inputs.json` before spending.**
That review caught two real bugs the first time round (see CLAUDE.md).

Generation is incremental: existing haikus are kept and only missing ones are
requested, so a trial run is never wasted.

---

## Notes

**The hero photo.** `images/towers.jpg` was converted from an iPhone HEIC (which
browsers cannot display) and re-encoded from raw pixels, so it carries no EXIF,
ICC, or XMP. The original HEIC embedded **GPS coordinates, altitude, compass
bearing, capture time, and device model** — if you ever swap the photo, strip
metadata the same way and verify with:

```sh
python3 -c "from PIL import Image; im=Image.open('images/towers.jpg'); print(dict(im.getexif()) or 'clean')"
```

**Monthly refresh, end to end.**

```sh
./pipeline/refresh_ces.sh
# if the series count changed:
./pipeline/refresh_haikus.sh
git add -A && git commit -m "Refresh CES data through <month>" && git push origin main
```

For implementation detail, invariants, and the bugs already found and fixed, see
**CLAUDE.md**.
