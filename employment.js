/* Employment clock — a different indexed CES employment "atom" each minute,
   drawn against indexed total nonfarm (2019 = 100). Pure static JS.

   The display order is a single fixed, deterministic shuffle of the atoms
   (ORDER). Every visitor sees the same series at the same wall-clock minute;
   "show next"/"show previous" step through that same order. */

(function () {
  "use strict";

  var MS_PER_MIN = 60000;
  var SEED = 20260718;           // fixed -> the order never changes
  var elChart = document.getElementById("chart");
  var elTitle = document.getElementById("atom-title");
  var elPath = document.getElementById("atom-path");
  var elCode = document.getElementById("atom-code");
  var elHaiku = document.getElementById("haiku");
  var elMeta = document.getElementById("chart-meta");
  var elCountdown = document.getElementById("countdown");

  // pos === null  -> follow the clock (live); otherwise a fixed slot in ORDER
  var DATA = null, HAIKUS = {}, ORDER = [], STATE = { pos: null };

  // deterministic PRNG (mulberry32)
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function shuffledOrder(n, seed) {
    var rnd = mulberry32(seed >>> 0);
    var idx = [];
    for (var i = 0; i < n; i++) idx.push(i);
    for (var j = n - 1; j > 0; j--) {
      var k = Math.floor(rnd() * (j + 1));
      var tmp = idx[j]; idx[j] = idx[k]; idx[k] = tmp;
    }
    return idx;
  }

  // slot in ORDER for the current wall-clock minute
  function liveSlot() {
    return Math.floor(Date.now() / MS_PER_MIN) % ORDER.length;
  }
  function currentSlot() {
    return STATE.pos == null ? liveSlot() : STATE.pos;
  }

  function ym(str) { // "YYYY-MM" -> absolute month index
    var y = parseInt(str.slice(0, 4), 10), m = parseInt(str.slice(5, 7), 10);
    return y * 12 + (m - 1);
  }
  var MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  function labelFor(mi) { return MONTHS[mi % 12] + " " + Math.floor(mi / 12); }
  function yearFor(mi) { return Math.floor(mi / 12); }

  function fmtJobs(thousands) {
    if (thousands >= 1000) return (thousands / 1000).toFixed(1) + "M jobs";
    return Math.round(thousands).toLocaleString() + "K jobs";
  }

  var SVGNS = "http://www.w3.org/2000/svg";
  function el(name, attrs) {
    var e = document.createElementNS(SVGNS, name);
    if (attrs) for (var k in attrs) e.setAttribute(k, attrs[k]);
    return e;
  }

  function render(atom) {
    var total = DATA.total;
    var a0 = ym(atom.start), aVals = atom.values;
    var t0 = ym(total.start), tVals = total.values;

    var xStart = a0;
    var xEnd = a0 + aVals.length - 1;          // atom's last month
    // clip total to the atom's window
    var tSlice = [];
    for (var mi = xStart; mi <= xEnd; mi++) {
      var ti = mi - t0;
      tSlice.push(ti >= 0 && ti < tVals.length ? tVals[ti] : null);
    }

    // y domain from both visible series, always including 100
    var lo = 100, hi = 100, i;
    for (i = 0; i < aVals.length; i++) { lo = Math.min(lo, aVals[i]); hi = Math.max(hi, aVals[i]); }
    for (i = 0; i < tSlice.length; i++) if (tSlice[i] != null) { lo = Math.min(lo, tSlice[i]); hi = Math.max(hi, tSlice[i]); }
    var pad = (hi - lo) * 0.08 || 5;
    lo = Math.floor((lo - pad) / 5) * 5;
    hi = Math.ceil((hi + pad) / 5) * 5;

    // geometry
    var W = 820, H = 460, mL = 46, mR = 104, mT = 26, mB = 36;
    var pw = W - mL - mR, ph = H - mT - mB;
    var span = xEnd - xStart || 1;
    function X(mi) { return mL + (mi - xStart) / span * pw; }
    function Y(v) { return mT + (hi - v) / (hi - lo) * ph; }

    while (elChart.firstChild) elChart.removeChild(elChart.firstChild);
    var svg = el("svg", {
      viewBox: "0 0 " + W + " " + H, width: "100%",
      preserveAspectRatio: "xMidYMid meet", role: "img",
      "aria-label": atom.title + " employment index versus total nonfarm, 2019 equals 100"
    });

    // y gridlines + ticks
    var ticks = [];
    var stepGuess = Math.max(5, Math.round((hi - lo) / 6 / 5) * 5);
    for (var v = Math.ceil(lo / stepGuess) * stepGuess; v <= hi; v += stepGuess) ticks.push(v);
    ticks.forEach(function (t) {
      var y = Y(t);
      svg.appendChild(el("line", { x1: mL, y1: y, x2: mL + pw, y2: y,
        stroke: "var(--grid)", "stroke-width": 1 }));
      var lab = el("text", { x: mL - 8, y: y + 4, "text-anchor": "end", class: "tick" });
      lab.textContent = t;
      svg.appendChild(lab);
    });

    // x ticks: about one per 2-4 years
    var yrStart = yearFor(xStart), yrEnd = yearFor(xEnd);
    var yrSpanN = yrEnd - yrStart;
    var xStepYears = yrSpanN > 24 ? 5 : yrSpanN > 12 ? 4 : yrSpanN > 6 ? 2 : 1;
    for (var yr = Math.ceil(yrStart / xStepYears) * xStepYears; yr <= yrEnd; yr += xStepYears) {
      var mi2 = yr * 12; if (mi2 < xStart || mi2 > xEnd) continue;
      var x = X(mi2);
      svg.appendChild(el("line", { x1: x, y1: mT, x2: x, y2: mT + ph,
        stroke: "var(--grid)", "stroke-width": 1, opacity: 0.5 }));
      var xl = el("text", { x: x, y: mT + ph + 20, "text-anchor": "middle", class: "tick" });
      xl.textContent = yr;
      svg.appendChild(xl);
    }

    // baseline
    svg.appendChild(el("line", { x1: mL, y1: mT + ph, x2: mL + pw, y2: mT + ph,
      stroke: "var(--axis)", "stroke-width": 1 }));

    function path(getV, count, offset) {
      var d = "", started = false;
      for (var m = 0; m < count; m++) {
        var val = getV(m); if (val == null) { started = false; continue; }
        var cmd = started ? "L" : "M";
        d += cmd + X(xStart + m + (offset || 0)).toFixed(1) + " " + Y(val).toFixed(1) + " ";
        started = true;
      }
      return d;
    }

    // total nonfarm (recessive reference), then atom (accent) on top
    svg.appendChild(el("path", { d: path(function (m) { return tSlice[m]; }, tSlice.length),
      fill: "none", stroke: "var(--ref-line)", "stroke-width": 2,
      "stroke-linejoin": "round", "stroke-linecap": "round" }));
    svg.appendChild(el("path", { d: path(function (m) { return aVals[m]; }, aVals.length),
      fill: "none", stroke: "var(--series-1)", "stroke-width": 2.5,
      "stroke-linejoin": "round", "stroke-linecap": "round" }));

    // end markers + direct labels
    function endMark(val, color, text, dy) {
      var x = X(xEnd), y = Y(val);
      svg.appendChild(el("circle", { cx: x, cy: y, r: 4.5, fill: color,
        stroke: "var(--surface)", "stroke-width": 2 }));
      var tl = el("text", { x: x + 10, y: y + (dy || 0) + 4, class: "endlab" });
      tl.setAttribute("fill", color);
      tl.textContent = text;
      return tl;
    }
    var aEnd = aVals[aVals.length - 1];
    var tEnd = tSlice[tSlice.length - 1];
    var aLabel = endMark(aEnd, "var(--series-1)", Math.round(aEnd), 0);
    var tLabel = tEnd != null ? endMark(tEnd, "var(--ref-line)", Math.round(tEnd), 0) : null;
    // nudge labels apart if they collide
    if (tLabel && Math.abs(Y(aEnd) - Y(tEnd)) < 14) {
      var up = Y(aEnd) <= Y(tEnd);
      aLabel.setAttribute("y", (Y(aEnd) + (up ? -3 : 11)) + "");
      tLabel.setAttribute("y", (Y(tEnd) + (up ? 11 : -3)) + "");
    }
    svg.appendChild(aLabel);
    if (tLabel) svg.appendChild(tLabel);

    // ---- hover crosshair + tooltip ----
    var hover = el("g", { opacity: 0 });
    var vline = el("line", { y1: mT, y2: mT + ph, stroke: "var(--axis)", "stroke-width": 1 });
    var dotA = el("circle", { r: 4.5, fill: "var(--series-1)", stroke: "var(--surface)", "stroke-width": 2 });
    var dotT = el("circle", { r: 4.5, fill: "var(--ref-line)", stroke: "var(--surface)", "stroke-width": 2 });
    hover.appendChild(vline); hover.appendChild(dotT); hover.appendChild(dotA);
    svg.appendChild(hover);

    var hit = el("rect", { x: mL, y: mT, width: pw, height: ph, fill: "transparent" });
    svg.appendChild(hit);

    function moveTo(evt) {
      var pt = svg.getBoundingClientRect();
      var px = (evt.clientX - pt.left) / pt.width * W;
      var m = Math.round((px - mL) / pw * span);
      if (m < 0) m = 0; if (m > span) m = span;
      var mi = xStart + m;
      var av = aVals[m], tv = tSlice[m];
      hover.setAttribute("opacity", 1);
      vline.setAttribute("x1", X(mi)); vline.setAttribute("x2", X(mi));
      dotA.setAttribute("cx", X(mi)); dotA.setAttribute("cy", Y(av));
      if (tv != null) { dotT.setAttribute("opacity", 1); dotT.setAttribute("cx", X(mi)); dotT.setAttribute("cy", Y(tv)); }
      else dotT.setAttribute("opacity", 0);
      showTip(evt, labelFor(mi), av, tv, atom.title);
    }
    hit.addEventListener("pointermove", moveTo);
    hit.addEventListener("pointerleave", function () { hover.setAttribute("opacity", 0); hideTip(); });

    elChart.appendChild(svg);
  }

  // ---- tooltip (HTML overlay) ----
  var tip = document.getElementById("tip");
  function showTip(evt, date, av, tv, name) {
    tip.innerHTML = "";
    var d = document.createElement("div"); d.className = "tip-date"; d.textContent = date;
    tip.appendChild(d);
    tip.appendChild(tipRow("var(--series-1)", name, av));
    if (tv != null) tip.appendChild(tipRow("var(--ref-line)", "Total nonfarm", tv));
    tip.style.opacity = 1;
    var host = elChart.getBoundingClientRect();
    var x = evt.clientX - host.left, y = evt.clientY - host.top;
    var tw = tip.offsetWidth;
    tip.style.left = Math.min(Math.max(x + 14, 4), host.width - tw - 4) + "px";
    tip.style.top = Math.max(y - 10, 4) + "px";
  }
  function tipRow(color, name, val) {
    var r = document.createElement("div"); r.className = "tip-row";
    var k = document.createElement("span"); k.className = "tip-key"; k.style.background = color;
    var n = document.createElement("span"); n.className = "tip-name"; n.textContent = name;
    var v = document.createElement("span"); v.className = "tip-val"; v.textContent = val.toFixed(1);
    r.appendChild(k); r.appendChild(n); r.appendChild(v);
    return r;
  }
  function hideTip() { tip.style.opacity = 0; }

  function show(atom) {
    elTitle.textContent = atom.title;
    elPath.textContent = atom.path.join("  ›  ");
    var codeTxt = "CES " + atom.ces;
    if (atom.naics && atom.naics !== "-") codeTxt += "  ·  NAICS " + atom.naics;
    elCode.textContent = codeTxt + "  ·  " + fmtJobs(atom.latest_thousands);
    var hk = HAIKUS[atom.ces];
    if (hk) {
      elHaiku.hidden = false;
      elHaiku.innerHTML = "";
      hk.split("\n").forEach(function (line) {
        var p = document.createElement("span"); p.textContent = line; elHaiku.appendChild(p);
      });
    } else {
      elHaiku.hidden = true;
    }
    render(atom);
    elMeta.textContent = "Index, 2019 average = 100 · seasonally adjusted · " +
      "BLS Current Employment Statistics · latest " + prettyMonth(DATA.meta.latest);
  }

  function prettyMonth(s) {
    var y = s.slice(0, 4), m = parseInt(s.slice(5, 7), 10);
    return MONTHS[m - 1] + " " + y;
  }

  function currentAtom() {
    return DATA.atoms[ORDER[currentSlot()]];
  }

  var elPrev, elNext, elReset, elEyebrow;

  // reflect nav state in the controls + eyebrow + countdown
  function syncControls() {
    var navigating = STATE.pos != null;
    elPrev.hidden = !navigating;
    elReset.hidden = !navigating;
    elEyebrow.textContent = navigating ? "Browsing" : "This minute's industry";
  }

  function tickCountdown() {
    if (STATE.pos != null) { elCountdown.textContent = ""; return; }
    var ss = Math.ceil((MS_PER_MIN - (Date.now() % MS_PER_MIN)) / 1000);
    elCountdown.textContent = "next series in " + ss + "s";
  }

  function goTo(pos) {
    STATE.pos = ((pos % ORDER.length) + ORDER.length) % ORDER.length;
    show(currentAtom());
    syncControls();
    tickCountdown();
  }
  function goLive() {
    STATE.pos = null;
    lastSlot = liveSlot();
    show(currentAtom());
    syncControls();
    tickCountdown();
  }

  var lastSlot = null;
  function poll() {
    if (STATE.pos == null) {
      var s = liveSlot();
      if (s !== lastSlot) { lastSlot = s; show(currentAtom()); }
    }
    tickCountdown();
  }

  function init() {
    elPrev = document.getElementById("prev");
    elNext = document.getElementById("next");
    elReset = document.getElementById("reset");
    elEyebrow = document.getElementById("eyebrow");
    elNext.addEventListener("click", function (e) { e.preventDefault(); goTo(currentSlot() + 1); });
    elPrev.addEventListener("click", function (e) { e.preventDefault(); goTo(currentSlot() - 1); });
    elReset.addEventListener("click", function (e) { e.preventDefault(); goLive(); });

    // deep link: employment.html?ces=CODE opens that series in browse mode
    var want = new URLSearchParams(location.search).get("ces");
    if (want) {
      var ai = DATA.atoms.findIndex(function (a) { return a.ces === want; });
      if (ai >= 0) STATE.pos = ORDER.indexOf(ai);
    }

    lastSlot = liveSlot();
    show(currentAtom());
    syncControls();
    tickCountdown();
    setInterval(poll, 1000);
    window.addEventListener("resize", function () { show(currentAtom()); });
  }

  Promise.all([
    fetch("data/employment.json").then(function (r) { return r.json(); }),
    fetch("data/haikus.json").then(function (r) { return r.ok ? r.json() : {}; }).catch(function () { return {}; })
  ]).then(function (res) {
    DATA = res[0]; HAIKUS = res[1] || {};
    ORDER = shuffledOrder(DATA.atoms.length, SEED);
    init();
  }).catch(function (err) {
    elChart.innerHTML = "<p style='color:var(--muted)'>Couldn't load the employment data.</p>";
    console.error(err);
  });
})();
