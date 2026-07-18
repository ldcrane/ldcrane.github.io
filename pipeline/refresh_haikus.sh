#!/bin/bash
# ---------------------------------------------------------------------------
# HAIKU PIPELINE — run only when the set of series changes (or to redo the
# poems). This is the ONLY part of the project that spends money.
#
#   ./pipeline/refresh_haikus.sh --prepare      # free: build the model inputs
#   ./pipeline/refresh_haikus.sh --trial        # ~$0.005: 12 haikus, then stop
#   ./pipeline/refresh_haikus.sh                # fill in every missing haiku
#   ./pipeline/refresh_haikus.sh --all          # discard existing, redo all 136
#
# Cost: all 136 series is roughly SIX CENTS on claude-haiku-4-5.
#
# Auth, in order of preference:
#   1. ~/.anthropic_key   — a file containing just the key (chmod 600)
#   2. $ANTHROPIC_API_KEY — already exported in the environment
# Get a key at console.anthropic.com. Note API usage bills to Console credits,
# NOT to a Claude subscription.
#
# ALWAYS run --prepare and skim pipeline/haiku_inputs.json before spending.
# Two real bugs were caught that way: Census "NULL" descriptions, and the model
# returning "ces 10113300" as the key instead of "10113300". See CLAUDE.md.
# ---------------------------------------------------------------------------
set -euo pipefail
cd "$(dirname "$0")/.."          # repo root

RAW_DIR="${RAW_DIR:-.cache/ces}"
INPUTS="pipeline/haiku_inputs.json"
OUT="data/haikus.json"

if [[ ! -f "$RAW_DIR/2022_NAICS_Descriptions.xlsx" ]]; then
  echo "error: $RAW_DIR/2022_NAICS_Descriptions.xlsx not found." >&2
  echo "       run ./pipeline/refresh_ces.sh first (it fetches the Census file)." >&2
  exit 1
fi

# fail fast on missing python deps rather than mid-run with a traceback
missing=()
python3 -c "import openpyxl"  2>/dev/null || missing+=(openpyxl)
python3 -c "import anthropic" 2>/dev/null || missing+=(anthropic)
if (( ${#missing[@]} )); then
  echo "error: missing python packages: ${missing[*]}" >&2
  echo "       run: pip3 install --user ${missing[*]}" >&2
  exit 1
fi

echo "==> preparing model inputs (free, no API calls)"
python3 pipeline/gen_haikus.py prepare "$RAW_DIR" data/employment.json "$INPUTS"

if [[ "${1:-}" == "--prepare" ]]; then
  echo
  echo "==> stopped before any API call. Review $INPUTS, then rerun with --trial."
  exit 0
fi

# resolve the key without ever echoing it
if [[ -z "${ANTHROPIC_API_KEY:-}" ]]; then
  if [[ -f "$HOME/.anthropic_key" ]]; then
    ANTHROPIC_API_KEY="$(tr -d '[:space:]' < "$HOME/.anthropic_key")"
    export ANTHROPIC_API_KEY
  else
    echo "error: no API key. Put one in ~/.anthropic_key (chmod 600) or export" >&2
    echo "       ANTHROPIC_API_KEY. Get one at console.anthropic.com." >&2
    exit 1
  fi
fi
case "${1:-}" in
  --trial)
    echo "==> TRIAL: generating 12 haikus (~half a cent), then stopping"
    python3 pipeline/gen_haikus.py generate "$INPUTS" "$OUT" --limit 12
    echo
    echo "==> review them, then run without --trial to do the rest:"
    echo "    python3 -c \"import json;[print(v,'\\n') for v in json.load(open('$OUT')).values()]\""
    ;;
  --all)
    echo "==> regenerating ALL haikus from scratch (~6 cents)"
    [[ -f "$OUT" ]] && cp "$OUT" "$OUT.bak" && echo "    previous set backed up to $OUT.bak"
    rm -f "$OUT"
    python3 pipeline/gen_haikus.py generate "$INPUTS" "$OUT"
    ;;
  *)
    echo "==> generating any haikus that are missing (existing ones are kept)"
    python3 pipeline/gen_haikus.py generate "$INPUTS" "$OUT"
    ;;
esac

echo
echo "==> verifying every series has a haiku"
python3 - <<'PY'
import json
h = json.load(open("data/haikus.json"))
atoms = {a["ces"] for a in json.load(open("data/employment.json"))["atoms"]}
missing, orphan = atoms - set(h), set(h) - atoms
bad = [k for k, v in h.items() if len(v.split("\n")) != 3]
print("  haikus: %d   series: %d" % (len(h), len(atoms)))
if missing: print("  MISSING haiku for:", sorted(missing))
if orphan:  print("  ORPHAN haikus (series no longer exists):", sorted(orphan))
if bad:     print("  NOT three lines:", bad)
if not (missing or orphan or bad): print("  OK — complete and well-formed.")
PY
