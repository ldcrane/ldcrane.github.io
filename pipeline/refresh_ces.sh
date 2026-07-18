#!/bin/bash
# ---------------------------------------------------------------------------
# CES PIPELINE — run this monthly, after BLS publishes the new employment month.
#
#   ./pipeline/refresh_ces.sh            # download + rebuild data/employment.json
#   ./pipeline/refresh_ces.sh --report   # dry run: print the atom-selection audit
#   RAW_DIR=/tmp/ces ./pipeline/refresh_ces.sh   # keep raw files somewhere else
#
# Needs: bash, curl, python3. No API key, no cost, no network beyond BLS/Census.
# Does NOT touch the haikus — see refresh_haikus.sh for that.
#
# The raw BLS files are ~20MB and are deliberately NOT committed; they land in
# RAW_DIR (default: .cache/ces, which is gitignored).
# ---------------------------------------------------------------------------
set -euo pipefail
cd "$(dirname "$0")/.."          # repo root

RAW_DIR="${RAW_DIR:-.cache/ces}"
OUT="data/employment.json"

# Identify yourself to BLS. They block generic/default user agents outright,
# and ask that automated downloads carry a contact address.
CONTACT="${BLS_CONTACT:-leland.mina.shared@gmail.com}"
UA="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36 (contact: ${CONTACT})"

mkdir -p "$RAW_DIR"

echo "==> downloading BLS CES flat files into $RAW_DIR"
for f in ce.industry ce.series ce.data.01a.CurrentSeasAE; do
  echo "    $f"
  curl -sfS -A "$UA" -o "$RAW_DIR/$f" "https://download.bls.gov/pub/time.series/ce/$f"
done

# Only needed by the haiku pipeline, but it is a Census file fetched the same
# way and it costs nothing to keep it current alongside the CES files.
echo "    2022_NAICS_Descriptions.xlsx (Census; used by refresh_haikus.sh)"
curl -sfS -A "$UA" -o "$RAW_DIR/2022_NAICS_Descriptions.xlsx" \
  "https://www.census.gov/naics/2022NAICS/2022_NAICS_Descriptions.xlsx"

if [[ "${1:-}" == "--report" ]]; then
  echo "==> atom-selection audit (no files written)"
  exec python3 pipeline/build_data.py "$RAW_DIR" /dev/null --report
fi

echo "==> building $OUT"
python3 pipeline/build_data.py "$RAW_DIR" "$OUT"

cat <<'NOTE'

==> done.

Check the printed partition line: the atoms must sum to total nonfarm within a
few thousand (rounding across ~136 series). A large residual means the atom
selection drifted — rerun with --report to see which node stopped splitting.

If the atom COUNT changed, the haikus are now out of sync: series were added or
removed, so run ./pipeline/refresh_haikus.sh to fill in the new ones.
NOTE
