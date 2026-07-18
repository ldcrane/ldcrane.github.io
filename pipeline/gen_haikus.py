#!/usr/bin/env python3
"""
Generate a haiku for each employment atom.

Two subcommands:

  prepare <raw_dir> <employment_json> <out_inputs_json>
      Join each atom to its Census 2022 NAICS description(s) and compute a
      compact summary of the series dynamics. Writes the model-ready input
      file (one record per atom).

  generate <inputs_json> <out_haikus_json>
      Call claude-haiku-4-5 over the prepared inputs (batched) and write
      {ces_code: haiku}. Requires ANTHROPIC_API_KEY and `pip install anthropic`.

The haiku brief: slightly melancholy, funny, or referencing the plotted
time-series dynamics — grounded in the Census description of the industry.
"""

import json
import os
import sys

BATCH = 12
MODEL = "claude-haiku-4-5"

SYSTEM = """You write haiku (5-7-5 syllables, three lines) about American industries,
to be displayed next to a time series chart of that industry's employment
(indexed to 2019=100). For each industry you are given the official Census
NAICS description and a summary of its employment dynamics.

Each haiku should take ONE of these angles (vary across industries):
- slightly melancholy (decline, obsolescence, quiet dignity of work)
- funny (dry wit about what the industry actually does)
- the time-series dynamics themselves (the covid crater, a long slide, a boom)

Rules: exactly three lines; aim for 5-7-5; no titles; no quotation marks;
concrete images from the industry's actual work beat abstractions;
never mention "NAICS", index numbers, or percentages by name."""


def load_census_descriptions(path):
    import openpyxl
    wb = openpyxl.load_workbook(path, read_only=True)
    ws = wb.active
    out = {}
    for row in ws.iter_rows(min_row=2, values_only=True):
        if not row or row[0] is None:
            continue
        code = str(row[0]).strip()
        title = str(row[1] or "").strip().rstrip("T").strip()
        desc = str(row[2] or "").strip()
        out[code] = (title, desc)
    return out


def lookup(code, census):
    """Find a Census description for a (possibly padded/partial) CES naics code."""
    c = code
    if c in census:
        return census[c]
    c = c.rstrip("0")
    while c:
        if c in census:
            return census[c]
        c = c[:-1]
    return None


def dynamics(atom):
    vals = atom["values"]
    start_year = int(atom["start"][:4])
    latest = vals[-1]
    peak = max(vals)
    trough = min(vals)
    parts = [
        "employment index (2019 avg = 100), monthly since %d" % start_year,
        "latest: %.0f" % latest,
        "all-time peak: %.0f, low: %.0f" % (peak, trough),
        "current employment: about %s jobs" % fmt_jobs(atom["latest_thousands"]),
    ]
    if atom.get("covid_drop_pct") is not None:
        parts.append("covid Feb-Apr 2020 change: %.0f%%" % atom["covid_drop_pct"])
    if latest < 85:
        parts.append("well below its 2019 level (long decline)")
    elif latest > 115:
        parts.append("well above its 2019 level (strong growth)")
    return "; ".join(parts)


def fmt_jobs(thousands):
    if thousands >= 1000:
        return "%.1f million" % (thousands / 1000.0)
    return "%d thousand" % round(thousands)


def prepare(raw_dir, emp_path, out_path):
    census = load_census_descriptions(
        os.path.join(raw_dir, "2022_NAICS_Descriptions.xlsx"))
    emp = json.load(open(emp_path))
    records = []
    misses = 0
    for a in emp["atoms"]:
        descs = []
        for c in a["naics_codes"]:
            hit = lookup(c, census)
            if hit:
                title, desc = hit
                descs.append("%s: %s" % (title, desc[:700]))
        if not descs:
            misses += 1
            descs = ["(no Census NAICS description; this is a government "
                     "series) Industry: %s, under %s" % (a["title"], " > ".join(a["path"]))]
        records.append({
            "ces": a["ces"],
            "title": a["title"],
            "naics": a["naics"],
            "description": "\n".join(descs)[:1400],
            "dynamics": dynamics(a),
        })
    json.dump(records, open(out_path, "w"), indent=1)
    print("prepared %d records (%d without Census description) -> %s"
          % (len(records), misses, out_path))


def batch_prompt(batch):
    lines = ["Write one haiku for each of the following %d industries. "
             "Respond with ONLY a JSON object mapping each ces code to its "
             "haiku (three lines joined by \\n). No other text.\n" % len(batch)]
    for r in batch:
        lines.append("ces %s | %s\nCensus description: %s\nEmployment dynamics: %s\n"
                     % (r["ces"], r["title"], r["description"], r["dynamics"]))
    return "\n".join(lines)


def generate(inputs_path, out_path):
    import anthropic
    client = anthropic.Anthropic()
    records = json.load(open(inputs_path))
    out = {}
    if os.path.exists(out_path):
        out = json.load(open(out_path))
    todo = [r for r in records if r["ces"] not in out]
    for i in range(0, len(todo), BATCH):
        batch = todo[i:i + BATCH]
        resp = client.messages.create(
            model=MODEL,
            max_tokens=4000,
            system=SYSTEM,
            messages=[{"role": "user", "content": batch_prompt(batch)}],
        )
        text = "".join(b.text for b in resp.content if b.type == "text").strip()
        if text.startswith("```"):
            text = text.strip("`")
            text = text[text.index("{"):text.rindex("}") + 1]
        got = json.loads(text)
        out.update(got)
        json.dump(out, open(out_path, "w"), indent=1, ensure_ascii=False)
        print("batch %d: %d haikus (total %d/%d)"
              % (i // BATCH + 1, len(got), len(out), len(records)))
    missing = [r["ces"] for r in records if r["ces"] not in out]
    if missing:
        print("MISSING:", missing)


if __name__ == "__main__":
    cmd = sys.argv[1]
    if cmd == "prepare":
        prepare(sys.argv[2], sys.argv[3], sys.argv[4])
    elif cmd == "generate":
        generate(sys.argv[2], sys.argv[3])
    else:
        raise SystemExit("usage: gen_haikus.py prepare|generate ...")
