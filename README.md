# ldcrane.github.io

Personal website of Leland D. Crane. Plain static HTML/CSS/JS served by GitHub
Pages (`.nojekyll` — no build step).

- `index.html` — home / research
- `employment.html` + `employment.js` — the "employment clock": each hour shows a
  different finest-level CES employment series (indexed to 2019 = 100) against
  total nonfarm. Pure client-side; reads `data/employment.json`.
- `styles.css` — shared styles
- `files/` — CV and paper PDFs
- `data/employment.json` — prebuilt series (committed; regenerate with the pipeline)

## Rebuilding the employment data

The `pipeline/` scripts turn the BLS CES flat files into `data/employment.json`
and (optionally) `data/haikus.json`:

```sh
pipeline/download.sh <raw_dir>                       # fetch BLS + Census source files
python3 pipeline/build_data.py <raw_dir> data/employment.json
python3 pipeline/build_data.py <raw_dir> /dev/null --report   # inspect atom selection
```

"Atoms" are the finest seasonally-adjusted all-employee series that partition
total nonfarm; NAICS codes and titles are carried through verbatim from
`ce.industry`. See `pipeline/build_data.py` for the tree/partition logic.

Haiku generation (one per series, shown beside the chart) is optional and lives
in `pipeline/gen_haikus.py` (`prepare` then `generate`). It calls the Anthropic
API, so review `pipeline/haiku_inputs.json` before running `generate`.
