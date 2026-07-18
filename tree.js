/* Browse all series — the CES employment hierarchy drawn as a zoomable,
   pannable node-link tree. Leaves are sized by share of total nonfarm
   employment and link to employment.html?ces=CODE. */

(function () {
  "use strict";

  var SVGNS = "http://www.w3.org/2000/svg";
  var DX = 172, DY = 24, R_MIN = 2.6, R_MAX = 21, PAD = 34;

  var canvas = document.getElementById("canvas");
  var svg = document.getElementById("svg");
  var vp = document.getElementById("vp");
  var tip = document.getElementById("tip");
  var elSearch = document.getElementById("search");
  var elCount = document.getElementById("count");

  var view = { k: 1, tx: 0, ty: 0 };
  var leafEls = [];        // {node, g, share, x, y}
  var contentBox = null;   // {x, y, w, h} in world units

  function el(name, attrs) {
    var e = document.createElementNS(SVGNS, name);
    if (attrs) for (var k in attrs) e.setAttribute(k, attrs[k]);
    return e;
  }
  function fmtJobs(t) {
    return t >= 1000 ? (t / 1000).toFixed(1) + "M jobs"
                     : Math.round(t).toLocaleString() + "K jobs";
  }
  function fmtPct(p) { var s = p.toFixed(1); return (s === "0.0" ? p.toFixed(2) : s) + "%"; }
  function apply() { vp.setAttribute("transform", "translate(" + view.tx + "," + view.ty + ") scale(" + view.k + ")"); }

  fetch("data/employment.json").then(function (r) { return r.json(); }).then(function (D) {
    build(D);
  }).catch(function (err) {
    canvas.innerHTML = "<p style='padding:1rem;color:var(--muted)'>Couldn't load the data.</p>";
    console.error(err);
  });

  function build(D) {
    var atoms = D.atoms, total = D.total.latest_thousands;

    // 1. assign leaf order (DFS) and node coordinates
    var leaves = [];
    (function assign(node, depth) {
      node._depth = depth;
      if (node.atom != null) { node._y = leaves.length; leaves.push(node); }
      else {
        node.children.forEach(function (c) { assign(c, depth + 1); });
        var kids = node.children;
        node._y = (kids[0]._y + kids[kids.length - 1]._y) / 2;
      }
    })(D.tree, 0);

    var maxShare = 0;
    leaves.forEach(function (lf) {
      lf._share = 100 * atoms[lf.atom].latest_thousands / total;
      if (lf._share > maxShare) maxShare = lf._share;
    });
    function X(n) { return PAD + n._depth * DX; }
    function Y(n) { return PAD + n._y * DY; }
    function R(share) { return R_MIN + (R_MAX - R_MIN) * Math.sqrt(share / maxShare); }

    // 2. draw edges (under nodes)
    var edges = el("g");
    (function link(node) {
      if (node.atom != null) return;
      var px = X(node), py = Y(node);
      node.children.forEach(function (c) {
        var cx = X(c), cy = Y(c), mx = (px + cx) / 2;
        edges.appendChild(el("path", { "class": "link",
          d: "M" + px + "," + py + "C" + mx + "," + py + " " + mx + "," + cy + " " + cx + "," + cy }));
        link(c);
      });
    })(D.tree);
    vp.appendChild(edges);

    // 3. draw nodes
    (function draw(node) {
      var x = X(node), y = Y(node);
      if (node.atom != null) {
        var a = atoms[node.atom], r = R(node._share);
        var g = el("g", { "class": "leaf" });
        g.appendChild(el("circle", { "class": "leaf-dot", cx: x, cy: y, r: r }));
        var lab = el("text", { "class": "label leaf-label", x: x + r + 6, y: y + 4 });
        lab.textContent = node.title;
        g.appendChild(lab);
        // generous transparent hit target over dot + label
        var hit = el("rect", { "class": "leaf-hit", x: x - r - 2, y: y - 9,
          width: r + 12 + node.title.length * 6.6, height: 18 });
        g.appendChild(hit);
        var rec = { node: node, g: g, share: node._share,
                    hay: (node.title + " " + node.code + " " + (a.naics || "")).toLowerCase() };
        var go = function () { location.href = "employment.html?ces=" + encodeURIComponent(node.code); };
        [hit, lab].forEach(function (t) {
          t.addEventListener("click", function () { if (!dragged) go(); });
          t.addEventListener("pointerenter", function (e) { showTip(e, node, a, true); });
          t.addEventListener("pointermove", moveTip);
          t.addEventListener("pointerleave", hideTip);
        });
        leafEls.push(rec);
        vp.appendChild(g);
      } else {
        vp.appendChild(el("circle", { "class": "node-dot", cx: x, cy: y, r: node._depth === 0 ? 4 : 3 }));
        if (node._depth <= 2) {
          var t = el("text", { "class": "label node-label",
            x: x, y: y - 8, "text-anchor": "middle" });
          t.textContent = node.title;
          vp.appendChild(t);
        }
        // hover on internal dots too
        var hd = el("circle", { cx: x, cy: y, r: 9, fill: "transparent" });
        hd.addEventListener("pointerenter", function (e) { showTip(e, node, null, false); });
        hd.addEventListener("pointermove", moveTip);
        hd.addEventListener("pointerleave", hideTip);
        vp.appendChild(hd);
        node.children.forEach(draw);
      }
    })(D.tree);

    // content bounds in world units
    var maxDepth = 0, longest = 0;
    leaves.forEach(function (lf) {
      if (lf._depth > maxDepth) maxDepth = lf._depth;
      longest = Math.max(longest, X(lf) + R(lf._share) + 6 + lf.title.length * 6.6);
    });
    contentBox = { x: 0, y: 0, w: longest + PAD, h: PAD * 2 + (leaves.length - 1) * DY };

    elCount.textContent = D.meta.n_atoms + " series · leaf size shows share of total nonfarm employment";
    wireInteractions();
    fit();
    window.addEventListener("resize", fit);
  }

  // ---------- tooltip ----------
  function showTip(e, node, atom, isLeaf) {
    tip.innerHTML = "";
    var t = document.createElement("div"); t.className = "t"; t.textContent = node.title; tip.appendChild(t);
    var c = document.createElement("div"); c.className = "c";
    c.textContent = (node.naics ? "NAICS " + node.naics + "  ·  " : "") + "CES " + node.code;
    tip.appendChild(c);
    if (isLeaf) {
      var s = document.createElement("div"); s.className = "s";
      s.textContent = fmtJobs(atom.latest_thousands) + "  ·  " + fmtPct(node._share) + " of total nonfarm";
      tip.appendChild(s);
    }
    tip.style.opacity = 1;
    moveTip(e);
  }
  function moveTip(e) {
    var b = canvas.getBoundingClientRect();
    var x = e.clientX - b.left, y = e.clientY - b.top;
    var tw = tip.offsetWidth, th = tip.offsetHeight;
    tip.style.left = Math.min(x + 14, b.width - tw - 6) + "px";
    tip.style.top = Math.max(Math.min(y + 14, b.height - th - 6), 6) + "px";
  }
  function hideTip() { tip.style.opacity = 0; }

  // ---------- zoom / pan ----------
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  function zoomAround(cx, cy, factor) {
    var nk = clamp(view.k * factor, 0.15, 9);
    factor = nk / view.k;
    view.tx = cx - (cx - view.tx) * factor;
    view.ty = cy - (cy - view.ty) * factor;
    view.k = nk;
    apply();
  }
  function fit() {
    if (!contentBox) return;
    var w = canvas.clientWidth, h = canvas.clientHeight, m = 24;
    var k = clamp(Math.min((w - m * 2) / contentBox.w, (h - m * 2) / contentBox.h), 0.15, 9);
    view.k = k;
    view.tx = (w - contentBox.w * k) / 2 - contentBox.x * k;
    view.ty = (h - contentBox.h * k) / 2 - contentBox.y * k;
    apply();
  }
  function fitBox(box) {
    var w = canvas.clientWidth, h = canvas.clientHeight, m = 40;
    var k = clamp(Math.min((w - m * 2) / box.w, (h - m * 2) / box.h), 0.15, 4);
    view.k = k;
    view.tx = (w - box.w * k) / 2 - box.x * k;
    view.ty = (h - box.h * k) / 2 - box.y * k;
    apply();
  }

  var dragged = false;
  function wireInteractions() {
    svg.addEventListener("wheel", function (e) {
      e.preventDefault();
      var b = canvas.getBoundingClientRect();
      zoomAround(e.clientX - b.left, e.clientY - b.top, Math.exp(-e.deltaY * 0.0016));
    }, { passive: false });

    // pan via window-level listeners (no pointer capture, so leaf clicks still fire)
    var down = null;
    svg.addEventListener("pointerdown", function (e) {
      if (e.button !== 0) return;
      down = { x: e.clientX, y: e.clientY, tx: view.tx, ty: view.ty };
      dragged = false;
      canvas.classList.add("grabbing");
    });
    window.addEventListener("pointermove", function (e) {
      if (!down) return;
      var dx = e.clientX - down.x, dy = e.clientY - down.y;
      if (Math.abs(dx) + Math.abs(dy) > 4) dragged = true;
      view.tx = down.tx + dx; view.ty = down.ty + dy; apply();
    });
    window.addEventListener("pointerup", function () {
      down = null; canvas.classList.remove("grabbing");
    });

    document.getElementById("zin").addEventListener("click", function () { center(1.4); });
    document.getElementById("zout").addEventListener("click", function () { center(1 / 1.4); });
    document.getElementById("zfit").addEventListener("click", function () { elSearch.value = ""; runSearch(""); fit(); });
    function center(f) { zoomAround(canvas.clientWidth / 2, canvas.clientHeight / 2, f); }

    elSearch.addEventListener("input", function () { runSearch(elSearch.value); });
  }

  // ---------- search: highlight matches, dim the rest, zoom to fit ----------
  function runSearch(q) {
    q = q.trim().toLowerCase();
    var matches = [];
    leafEls.forEach(function (rec) {
      var hit = q && rec.hay.indexOf(q) >= 0;
      rec.g.classList.toggle("hot", !!hit);
      rec.g.classList.toggle("faded", !!q && !hit);
      if (hit) matches.push(rec);
    });
    vp.querySelectorAll(".link, .node-dot, .node-label").forEach(function (n) {
      n.classList.toggle("faded", !!q);
    });
    if (matches.length) {
      var xs = matches.map(function (m) { return X(m.node); });
      var ys = matches.map(function (m) { return Y(m.node); });
      var box = { x: Math.min.apply(null, xs) - 30, y: Math.min.apply(null, ys) - 30,
        w: (Math.max.apply(null, xs) - Math.min.apply(null, xs)) + 260,
        h: (Math.max.apply(null, ys) - Math.min.apply(null, ys)) + 60 };
      fitBox(box);
    }
    function X(n) { return PAD + n._depth * DX; }
    function Y(n) { return PAD + n._y * DY; }
  }
})();
