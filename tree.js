/* Browse all series — renders the CES employment hierarchy as an
   expand/collapse tree. Leaves (atoms) link to employment.html?ces=CODE.
   A search box filters by title or code and reveals matches in context. */

(function () {
  "use strict";

  var elTree = document.getElementById("tree");
  var elSearch = document.getElementById("search");
  var elCount = document.getElementById("count");
  var elEmpty = document.getElementById("empty");
  var N_ATOMS = 0;

  function elc(tag, cls) { var e = document.createElement(tag); if (cls) e.className = cls; return e; }

  function codeText(node) {
    var bits = [];
    if (node.naics) bits.push("NAICS " + node.naics);
    bits.push("CES " + node.code);
    return bits.join("  ·  ");
  }

  // build DOM; returns the <li>. Group nodes get a toggle; atoms get a link.
  function build(node, depth) {
    var li = elc("li", "node");
    var isLeaf = node.atom != null;

    if (isLeaf) {
      var a = elc("a", "leaf row");
      a.href = "employment.html?ces=" + encodeURIComponent(node.code);
      a.appendChild(elc("span", "tw"));
      var nm = elc("span", "name"); nm.textContent = node.title; a.appendChild(nm);
      var cd = elc("span", "code"); cd.textContent = codeText(node); a.appendChild(cd);
      a.dataset.search = (node.title + " " + node.code + " " + (node.naics || "")).toLowerCase();
      li.appendChild(a);
      return li;
    }

    li.classList.add("group");
    if (depth <= 0) li.classList.add("open");     // root open; supersectors collapsed
    var row = elc("div", "row");
    var tw = elc("span", "tw"); tw.textContent = "▸"; row.appendChild(tw);
    var nm2 = elc("span", "name"); nm2.textContent = node.title; row.appendChild(nm2);
    var cd2 = elc("span", "code"); cd2.textContent = codeText(node); row.appendChild(cd2);
    row.addEventListener("click", function () {
      li.classList.toggle("open");
      tw.textContent = li.classList.contains("open") ? "▾" : "▸";
    });
    tw.textContent = li.classList.contains("open") ? "▾" : "▸";
    li.appendChild(row);

    var ul = elc("ul");
    (node.children || []).forEach(function (c) { ul.appendChild(build(c, depth + 1)); });
    li.appendChild(ul);
    return li;
  }

  // ---- search / filter ----
  function clearMarks(root) {
    root.querySelectorAll("a.leaf .name").forEach(function (nm) {
      if (nm.dataset.orig != null) { nm.textContent = nm.dataset.orig; delete nm.dataset.orig; }
    });
  }
  function markMatch(nm, q) {
    var txt = nm.textContent, i = txt.toLowerCase().indexOf(q);
    if (i < 0) return;
    nm.dataset.orig = txt;
    nm.textContent = "";
    nm.appendChild(document.createTextNode(txt.slice(0, i)));
    var m = document.createElement("mark"); m.textContent = txt.slice(i, i + q.length);
    nm.appendChild(m);
    nm.appendChild(document.createTextNode(txt.slice(i + q.length)));
  }

  function filter(q) {
    q = q.trim().toLowerCase();
    clearMarks(elTree);
    var leaves = elTree.querySelectorAll("a.leaf");
    var shown = 0;

    if (!q) {
      // reset: show everything, collapse back to supersector level
      elTree.querySelectorAll(".node").forEach(function (li) { li.classList.remove("hidden"); });
      elTree.querySelectorAll(".group").forEach(function (li, idx) {
        var open = li === elTree.firstChild;           // only root open
        li.classList.toggle("open", open);
        var tw = li.querySelector(":scope > .row > .tw");
        if (tw && !li.classList.contains("open")) tw.textContent = "▸";
        else if (tw) tw.textContent = "▾";
      });
      elEmpty.classList.add("hidden");
      elCount.textContent = N_ATOMS + " series across " + elTree.querySelectorAll(".group").length + " groups";
      return;
    }

    // hide all, then reveal matching leaves and their ancestors
    elTree.querySelectorAll(".node").forEach(function (li) { li.classList.add("hidden"); });
    leaves.forEach(function (a) {
      if (a.dataset.search.indexOf(q) < 0) return;
      shown++;
      markMatch(a.querySelector(".name"), q);
      var li = a.parentNode;
      while (li && li !== elTree.parentNode) {
        if (li.classList && li.classList.contains("node")) {
          li.classList.remove("hidden");
          if (li.classList.contains("group")) {
            li.classList.add("open");
            var tw = li.querySelector(":scope > .row > .tw");
            if (tw) tw.textContent = "▾";
          }
        }
        li = li.parentNode;
      }
    });
    elEmpty.classList.toggle("hidden", shown > 0);
    elCount.textContent = shown + (shown === 1 ? " series" : " series") + " matching “" + q + "”";
  }

  fetch("data/employment.json").then(function (r) { return r.json(); }).then(function (D) {
    N_ATOMS = D.meta.n_atoms;
    var root = build(D.tree, 0);
    // lift the root's children up to the top level (don't show "Total nonfarm" as a wrapper)
    elTree.appendChild(root);
    filter("");
    elSearch.addEventListener("input", function () { filter(elSearch.value); });
  }).catch(function (err) {
    elTree.innerHTML = "<li class='empty'>Couldn't load the data.</li>";
    console.error(err);
  });
})();
