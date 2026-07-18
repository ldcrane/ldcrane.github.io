#!/usr/bin/env python3
"""
Build employment.json for the hourly employment-atom visualization.

Pipeline:
  1. Parse CES flat files (ce.industry, ce.data.01a.CurrentSeasAE) downloaded
     from https://download.bls.gov/pub/time.series/ce/
  2. Build the CES industry tree from display_level + sort_sequence, dropping
     the four overlapping top aggregates (Total private, Goods-producing,
     Service-providing, Private service-providing) so that the 11 supersectors
     partition Total nonfarm.
  3. Recursively select "atoms": the finest seasonally adjusted all-employees
     series that partition Total nonfarm. A node is split into its children
     only if every child has SA data through the latest month, every child's
     history starts by MAX_CHILD_START, and the children sum to the parent
     within tolerance in every overlapping month.
  4. Index every atom and Total nonfarm to 2019 average = 100 and write JSON.

NAICS codes and titles are carried through verbatim from ce.industry
(naics_code, industry_name); an expanded code list is also derived for
joining to Census NAICS descriptions (e.g. "212311,3,9" -> 212311, 212313,
212319 via sequential suffix replacement).

Usage: python3 build_data.py <raw_dir> <out_json> [--report]
"""

import json
import re
import sys
from collections import defaultdict
from datetime import date, datetime, timezone

MAX_CHILD_START = (2015, 1)   # every child must have data at or before this
SUM_CHECK_FROM = (1990, 1)    # SA additivity only holds for the modern era;
                              # pre-1990 history splices SIC-era estimates
BASE_YEAR = 2019              # index base: 2019 average = 100
SERIES_FROM = 1939            # keep full history; JSON stays small enough
DROP_AGGREGATES = {"05000000", "06000000", "07000000", "08000000"}
ROOT = "00000000"
# BLS sort order shows "Other Federal government" after USPS, but numerically
# it is a component of Federal-except-USPS (verified: 90916220 + 90919110 +
# 90919999 = 90911000), so stack parenting needs one correction.
PARENT_OVERRIDES = {"90919999": "90911000"}


def parse_industry(path):
    rows = []
    with open(path) as f:
        header = f.readline().rstrip("\n").split("\t")
        idx = {name.strip(): i for i, name in enumerate(header)}
        for line in f:
            parts = [p.strip() for p in line.rstrip("\n").split("\t")]
            if len(parts) < len(header):
                continue
            rows.append({
                "code": parts[idx["industry_code"]],
                "naics": parts[idx["naics_code"]],
                "name": parts[idx["industry_name"]],
                "level": int(parts[idx["display_level"]]),
                "sort": int(parts[idx["sort_sequence"]]),
            })
    rows.sort(key=lambda r: r["sort"])
    return rows


def expand_naics(raw):
    """Expand a CES naics_code string into a list of individual codes.

    Grammar (empirical, covers every non-numeric form in ce.industry):
      - "-"            -> []            (non-NAICS series, e.g. government)
      - "part 2381"    -> ["2381"]      (partial-industry split, flagged)
      - tokens after the first (split on "," or ";") replace the trailing
        len(token) characters of the PREVIOUS expanded code
      - a token like "6-9" is an inclusive range of same-length suffixes
    Returns (codes, is_part).
    """
    raw = raw.strip()
    if raw in ("-", ""):
        return [], False
    m = re.match(r"^part\s+(\d+)$", raw)
    if m:
        return [m.group(1)], True
    tokens = re.split(r"[,;]", raw)
    codes = [tokens[0]]
    for tok in tokens[1:]:
        tok = tok.strip()
        rng = re.match(r"^(\d+)-(\d+)$", tok)
        subs = []
        if rng:
            a, b = rng.group(1), rng.group(2)
            width = len(a)
            subs = [str(v).zfill(width) for v in range(int(a), int(b) + 1)]
        else:
            subs = [tok]
        for sub in subs:
            prev = codes[-1]
            codes.append(prev[: len(prev) - len(sub)] + sub)
    return codes, False


def parse_data(path):
    """Return {industry_code: {(year, month): value}} for SA all-employee series."""
    series = defaultdict(dict)
    with open(path) as f:
        f.readline()
        for line in f:
            parts = line.split("\t")
            sid = parts[0].strip()
            period = parts[2].strip()
            if not period.startswith("M") or period == "M13":
                continue
            if not (sid.startswith("CES") and sid.endswith("01")):
                continue
            year = int(parts[1])
            if year < SERIES_FROM:
                continue
            val = parts[3].strip()
            if val in ("", "-"):
                continue
            industry = sid[3:11]
            series[industry][(year, int(period[1:]))] = float(val)
    return series


def build_tree(rows):
    """Parent = nearest preceding row (sort order) with lower display_level.

    Rows whose naics_code is "part ..." (the residential/nonresidential
    construction splits) overlap the NAICS breakdown and interleave badly in
    sort order, so they are excluded from the main tree and attached to their
    longest-prefix NAICS ancestor as an *alternative* partition
    (part_children).
    """
    children = defaultdict(list)
    part_children = defaultdict(list)
    parent = {}
    normal = [r for r in rows if not r["naics"].startswith("part")
              and r["code"] not in DROP_AGGREGATES]
    codes = {r["code"] for r in normal}
    stack = []  # (level, code)
    for r in normal:
        while stack and stack[-1][0] >= r["level"]:
            stack.pop()
        if stack:
            parent[r["code"]] = stack[-1][1]
            children[stack[-1][1]].append(r["code"])
        stack.append((r["level"], r["code"]))
    for r in rows:
        if not r["naics"].startswith("part"):
            continue
        c = r["code"].rstrip("0")
        while len(c) > 2:
            c = c[:-1]
            cand = c.ljust(8, "0")
            if cand in codes:
                parent[r["code"]] = cand
                part_children[cand].append(r["code"])
                break
        else:
            raise ValueError("no prefix parent for part row %s" % r["code"])
    for code, new_parent in PARENT_OVERRIDES.items():
        old = parent.get(code)
        if old:
            children[old].remove(code)
        parent[code] = new_parent
        children[new_parent].append(code)
    return children, part_children, parent


def drop_redundant_aggregates(children, info, report):
    """Remove convenience aggregates that duplicate their siblings.

    ce.industry contains a few unmarked aggregate rows (e.g. 65620001
    "Health care", naics "621,2,3", alongside siblings 621, 622, 623) whose
    expanded NAICS codes are entirely covered by other children of the same
    parent. Keeping both would double-count, so the coarser row is dropped.
    """
    def covered(code, others):
        return any(code == o or code.startswith(o) for o in others)

    for par, kids in children.items():
        expanded = {k: expand_naics(info[k]["naics"])[0] for k in kids}
        keep = list(kids)
        for k in sorted(kids, key=lambda k: -len(expanded[k])):
            if len(expanded[k]) < 2:
                continue
            others = set()
            for o in keep:
                if o != k:
                    others.update(expanded[o])
            if all(covered(c, others) for c in expanded[k]):
                keep.remove(k)
                report.append((par, "dropped redundant aggregate %s (%s, naics %s)"
                               % (k, info[k]["name"], info[k]["naics"])))
        children[par] = keep


def month_range(d):
    keys = sorted(d.keys())
    return keys[0], keys[-1]


def prev_month(m):
    return (m[0] - 1, 12) if m[1] == 1 else (m[0], m[1] - 1)


def kids_ok(code, kids, series, latest, report):
    """Check one candidate child set: coverage, currency (detailed CES series
    lag total nonfarm by one month), start date, and additivity."""
    if not kids:
        return False
    ok_ends = {latest, prev_month(latest)}
    for k in kids:
        if k not in series:
            report.append((code, "child %s has no SA series" % k))
            return False
        start, end = month_range(series[k])
        if end not in ok_ends:
            report.append((code, "child %s ends %d-%02d" % (k, *end)))
            return False
        if start > MAX_CHILD_START:
            report.append((code, "child %s starts %d-%02d" % (k, *start)))
            return False
    # sum check over months present in parent and every child
    months = [m for m in series[code]
              if m >= SUM_CHECK_FROM and all(m in series[k] for k in kids)]
    tol = 0.6 + 0.11 * len(kids)  # rounding: each series rounded to 0.1
    worst = max(abs(sum(series[k][m] for k in kids) - series[code][m])
                for m in months)
    if worst > tol:
        report.append((code, "%d children fail sum check, worst dev %.2f (tol %.2f)"
                       % (len(kids), worst, tol)))
        return False
    return True


def select_atoms(code, children, part_children, series, latest, report):
    """Return list of atom codes under (and including) `code`.

    Prefers the NAICS child set (finer); falls back to the "part"
    (residential/nonresidential) split where the NAICS set fails.
    """
    for kids in (children.get(code, []), part_children.get(code, [])):
        if kids and kids_ok(code, kids, series, latest, report):
            out = []
            for k in kids:
                out.extend(select_atoms(k, children, part_children,
                                        series, latest, report))
            return out
    return [code]


def index_series(d, start=None):
    """Index to BASE_YEAR average = 100. Returns (start_ym, [values]) or None."""
    base = [v for (y, _), v in d.items() if y == BASE_YEAR]
    if len(base) != 12:
        return None
    b = sum(base) / 12.0
    keys = sorted(d.keys())
    if start:
        keys = [k for k in keys if k >= start]
    # verify contiguity
    for a, bb in zip(keys, keys[1:]):
        nxt = (a[0] + 1, 1) if a[1] == 12 else (a[0], a[1] + 1)
        if bb != nxt:
            raise ValueError("gap in series at %s -> %s" % (a, bb))
    vals = [round(100.0 * d[k] / b, 2) for k in keys]
    return "%d-%02d" % keys[0], vals


def main():
    raw_dir, out_path = sys.argv[1], sys.argv[2]
    report_mode = "--report" in sys.argv

    rows = parse_industry(raw_dir + "/ce.industry")
    info = {r["code"]: r for r in rows}
    series = parse_data(raw_dir + "/ce.data.01a.CurrentSeasAE")
    print("industries: %d, SA all-employee series: %d" % (len(rows), len(series)))

    latest = month_range(series[ROOT])[1]
    print("latest month: %d-%02d" % latest)

    children, part_children, parent = build_tree(rows)
    report = []
    drop_redundant_aggregates(children, info, report)
    atoms = select_atoms(ROOT, children, part_children, series, latest, report)
    print("atoms: %d" % len(atoms))

    # verify atoms partition total nonfarm over every fully-covered month
    months = [m for m in series[ROOT]
              if all(m in series[a] for a in atoms)]
    common = min(months)
    worst = max(abs(sum(series[a][m] for a in atoms) - series[ROOT][m])
                for m in months)
    check_last = max(months)
    total_last = series[ROOT][check_last]
    atom_sum = sum(series[a][check_last] for a in atoms)
    print("partition check: %d atoms, common window %d-%02d..%d-%02d, worst dev %.1f"
          % (len(atoms), common[0], common[1], check_last[0], check_last[1], worst))
    print("last common month: atoms sum %.1f vs total %.1f (of total %.1f)"
          % (atom_sum, total_last, series[ROOT][latest]))

    if report_mode:
        for code, msg in report:
            r = info[code]
            print("STOP %-9s L%d %-55s %s" % (code, r["level"], r["name"][:55], msg))
        starts = defaultdict(int)
        for a in atoms:
            starts[month_range(series[a])[0][0]] += 1
        print("atom start-year distribution:", dict(sorted(starts.items())))
        return

    def path_titles(code):
        names = []
        c = code
        while c in parent:
            c = parent[c]
            names.append(info[c]["name"])
        return list(reversed(names))

    atom_objs = []
    for a in sorted(atoms, key=lambda c: info[c]["sort"]):
        r = info[a]
        naics_list, is_part = expand_naics(r["naics"])
        idx = index_series(series[a])
        if idx is None:
            raise ValueError("atom %s missing %d coverage" % (a, BASE_YEAR))
        start, vals = idx
        d = series[a]
        latest_level = d[month_range(d)[1]]  # detailed series lag total by a month
        feb20, apr20 = d.get((2020, 2)), d.get((2020, 4))
        atom_objs.append({
            "ces": a,
            "naics": r["naics"],
            "naics_codes": naics_list,
            "naics_part": is_part,
            "title": r["name"],
            "path": path_titles(a),
            "level": r["level"],
            "start": start,
            "latest_thousands": latest_level,
            "covid_drop_pct": (round(100.0 * (apr20 - feb20) / feb20, 1)
                               if feb20 and apr20 else None),
            "values": vals,
        })

    t_start, t_vals = index_series(series[ROOT])
    out = {
        "meta": {
            "generated": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
            "source": "BLS Current Employment Statistics (CES), seasonally adjusted all employees",
            "base": "%d average = 100" % BASE_YEAR,
            "latest": "%d-%02d" % latest,
            "n_atoms": len(atom_objs),
        },
        "total": {"ces": ROOT, "title": info[ROOT]["name"], "start": t_start,
                  "latest_thousands": series[ROOT][latest], "values": t_vals},
        "atoms": atom_objs,
    }
    with open(out_path, "w") as f:
        json.dump(out, f, separators=(",", ":"))
    print("wrote %s (%.1f KB)" % (out_path, len(json.dumps(out, separators=(",", ":"))) / 1024))


if __name__ == "__main__":
    main()
