/* Racial Bias in AI Hiring Systems: figures and page behavior */
(function () {
  "use strict";

  var root = document.documentElement;
  var reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function cssVar(name) {
    return getComputedStyle(root).getPropertyValue(name).trim();
  }

  /* ---------------- theme toggle ---------------- */
  function isDark() {
    var t = root.getAttribute("data-theme");
    if (t === "dark") return true;
    if (t === "light") return false;
    return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  }

  var themeBtn = document.getElementById("theme-btn");
  if (themeBtn) {
    themeBtn.addEventListener("click", function () {
      var next = isDark() ? "light" : "dark";
      root.setAttribute("data-theme", next);
      try { localStorage.setItem("theme", next); } catch (e) {}
      rebuildCharts();
    });
  }
  if (window.matchMedia) {
    var mq = window.matchMedia("(prefers-color-scheme: dark)");
    var onScheme = function () { if (!root.getAttribute("data-theme")) rebuildCharts(); };
    if (mq.addEventListener) mq.addEventListener("change", onScheme);
    else if (mq.addListener) mq.addListener(onScheme);
  }

  /* ---------------- contents highlighting ---------------- */
  var tocLinks = Array.prototype.slice.call(document.querySelectorAll(".toc a[href^='#']"));
  var tocTargets = tocLinks.map(function (a) { return document.getElementById(a.getAttribute("href").slice(1)); });
  if ("IntersectionObserver" in window && tocLinks.length) {
    var visible = {};
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) { visible[e.target.id] = e.isIntersecting; });
      var current = null;
      for (var i = 0; i < tocTargets.length; i++) {
        if (tocTargets[i] && visible[tocTargets[i].id]) { current = tocTargets[i].id; break; }
      }
      if (!current) return;
      tocLinks.forEach(function (a) { a.classList.toggle("active", a.getAttribute("href") === "#" + current); });
    }, { rootMargin: "-70px 0px -65% 0px" });
    tocTargets.forEach(function (el) { if (el) io.observe(el); });
  }

  /* ---------------- chart helpers ---------------- */
  var charts = {};
  var hasChart = typeof window.Chart !== "undefined";

  function applyDefaults() {
    if (!hasChart) return;
    Chart.defaults.font.family = "'Source Sans 3', 'Segoe UI', system-ui, sans-serif";
    Chart.defaults.font.size = 13;
    Chart.defaults.color = cssVar("--muted");
    Chart.defaults.borderColor = cssVar("--rule");
    Chart.defaults.animation.duration = reduceMotion ? 0 : 500;
    Chart.defaults.plugins.tooltip.backgroundColor = cssVar("--text");
    Chart.defaults.plugins.tooltip.titleColor = cssVar("--bg");
    Chart.defaults.plugins.tooltip.bodyColor = cssVar("--bg");
    Chart.defaults.plugins.tooltip.cornerRadius = 3;
  }

  function withAlpha(hex, a) {
    var h = hex.replace("#", "");
    if (h.length === 3) h = h.split("").map(function (c) { return c + c; }).join("");
    var n = parseInt(h, 16);
    return "rgba(" + ((n >> 16) & 255) + "," + ((n >> 8) & 255) + "," + (n & 255) + "," + a + ")";
  }

  function make(id, config) {
    var el = document.getElementById(id);
    if (!el || !hasChart) return null;
    if (charts[id]) charts[id].destroy();
    charts[id] = new Chart(el, config);
    return charts[id];
  }

  /* ---------------- Figure 1: wealth gap ---------------- */
  var WEALTH_YEARS = [1989, 1992, 1995, 1998, 2001, 2004, 2007, 2010, 2013, 2016, 2019, 2022];
  var WEALTH = {
    white:    [130.1, 103.9, 112.5, 130.2, 158.3, 169.8, 192.4, 144.4, 148.6, 181.0, 188.2, 284.3],
    black:    [9.2, 16.3, 19.0, 20.7, 24.6, 24.7, 27.0, 20.3, 14.7, 19.5, 24.1, 44.9],
    hispanic: [9.8, 11.9, 19.9, 16.7, 22.7, 26.2, 30.7, 20.4, 17.0, 25.4, 36.2, 61.6]
  };
  var wealthIdx = WEALTH_YEARS.length - 1;
  var wealthTimer = null;

  function sliceTo(arr, idx) { return arr.map(function (v, i) { return i <= idx ? v : null; }); }

  function buildWealth() {
    var c1 = cssVar("--c1"), c2 = cssVar("--c2"), c3 = cssVar("--c3");
    make("wealthChart", {
      type: "line",
      data: {
        labels: WEALTH_YEARS,
        datasets: [
          { label: "White", data: sliceTo(WEALTH.white, wealthIdx), borderColor: c1, backgroundColor: c1, borderWidth: 2.2, pointRadius: 2.5, tension: 0 },
          { label: "Hispanic", data: sliceTo(WEALTH.hispanic, wealthIdx), borderColor: c3, backgroundColor: c3, borderWidth: 2.2, pointRadius: 2.5, tension: 0 },
          { label: "Black", data: sliceTo(WEALTH.black, wealthIdx), borderColor: c2, backgroundColor: c2, borderWidth: 2.2, pointRadius: 2.5, tension: 0 }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false, spanGaps: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { position: "top", align: "start", labels: { boxWidth: 12, boxHeight: 2 } },
          tooltip: { callbacks: { label: function (ctx) { return ctx.dataset.label + ": $" + ctx.parsed.y.toFixed(1) + "k"; } } }
        },
        scales: {
          y: { beginAtZero: true, max: 300, title: { display: true, text: "Median net worth (thousands of 2022 dollars)" } },
          x: { grid: { display: false } }
        }
      }
    });
    updateWealthReadout();
  }

  function updateWealthReadout() {
    var out = document.getElementById("wealth-readout");
    var scrub = document.getElementById("wealth-scrub");
    if (scrub) scrub.value = String(wealthIdx);
    if (!out) return;
    var ratio = WEALTH.white[wealthIdx] / WEALTH.black[wealthIdx];
    out.innerHTML = "<strong>" + WEALTH_YEARS[wealthIdx] + "</strong> · white-to-Black ratio <strong>" + ratio.toFixed(1) + "×</strong>";
  }

  function setWealth(idx) {
    wealthIdx = idx;
    var ch = charts.wealthChart;
    if (ch) {
      ch.data.datasets[0].data = sliceTo(WEALTH.white, idx);
      ch.data.datasets[1].data = sliceTo(WEALTH.hispanic, idx);
      ch.data.datasets[2].data = sliceTo(WEALTH.black, idx);
      ch.update(reduceMotion ? "none" : undefined);
    }
    updateWealthReadout();
  }

  function stopWealth() {
    if (wealthTimer) { clearInterval(wealthTimer); wealthTimer = null; }
    var b = document.getElementById("wealth-play");
    if (b) { b.textContent = "Play"; b.setAttribute("aria-pressed", "false"); }
  }

  function playWealth() {
    if (wealthTimer) { stopWealth(); return; }
    var b = document.getElementById("wealth-play");
    if (b) { b.textContent = "Pause"; b.setAttribute("aria-pressed", "true"); }
    if (wealthIdx >= WEALTH_YEARS.length - 1) setWealth(0);
    wealthTimer = setInterval(function () {
      if (wealthIdx >= WEALTH_YEARS.length - 1) { stopWealth(); return; }
      setWealth(wealthIdx + 1);
    }, reduceMotion ? 250 : 650);
  }

  var wp = document.getElementById("wealth-play");
  if (wp) wp.addEventListener("click", playWealth);
  var wr = document.getElementById("wealth-reset");
  if (wr) wr.addEventListener("click", function () { stopWealth(); setWealth(WEALTH_YEARS.length - 1); });
  var ws = document.getElementById("wealth-scrub");
  if (ws) ws.addEventListener("input", function (e) { stopWealth(); setWealth(parseInt(e.target.value, 10)); });

  /* ---------------- Figure 2: callbacks ---------------- */
  function buildCallback() {
    var c1 = cssVar("--c1"), c2 = cssVar("--c2");
    make("callbackChart", {
      type: "bar",
      data: {
        labels: [["White-sounding", "names"], ["Black-sounding", "names"]],
        datasets: [{ data: [9.65, 6.45], backgroundColor: [c1, c2], borderRadius: 2, maxBarThickness: 90 }]
      },
      options: {
        indexAxis: "y", responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: function (ctx) {
            var calls = ctx.dataIndex === 0 ? 235 : 157;
            return ctx.parsed.x + "% (" + calls + " callbacks of 2,435 resumes)";
          } } }
        },
        scales: {
          x: { beginAtZero: true, max: 12, title: { display: true, text: "Callback rate (%)" } },
          y: { grid: { display: false } }
        }
      }
    });
  }

  /* ---------------- Figure 3: AI use estimates ---------------- */
  function buildAdoption() {
    var c1 = cssVar("--c1");
    make("adoptionChart", {
      type: "bar",
      data: {
        labels: ["Fortune 500 companies", ["Other companies,", "2025"], ["Other companies,", "end of 2025 (projected)"]],
        datasets: [{
          data: [98.4, 51, 68],
          backgroundColor: [c1, c1, withAlpha(c1, 0.4)],
          borderColor: [c1, c1, c1], borderWidth: [0, 0, 1.5], borderRadius: 2, maxBarThickness: 44
        }]
      },
      options: {
        indexAxis: "y", responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: function (ctx) { return ctx.parsed.x + "%"; } } } },
        scales: {
          x: { beginAtZero: true, max: 100, title: { display: true, text: "Share using AI in hiring (%)" } },
          y: { grid: { display: false } }
        }
      }
    });
  }

  /* ---------------- Figure 4: EEO-1 composition ---------------- */
  function buildRep() {
    var rows = [
      ["White", 60.2], ["Hispanic or Latino", 19.4], ["Black or African American", 13.4], ["Asian", 6.4], ["Other or two or more", 0.6]
    ];
    var c1 = cssVar("--c1"), c5 = cssVar("--c5");
    make("repChart", {
      type: "bar",
      data: {
        labels: rows.map(function (r) { return r[0]; }),
        datasets: [{ data: rows.map(function (r) { return r[1]; }), backgroundColor: rows.map(function (r, i) { return i === 0 ? c1 : c5; }), borderRadius: 2, maxBarThickness: 34 }]
      },
      options: {
        indexAxis: "y", responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: function (ctx) { return ctx.parsed.x + "% of employees"; } } } },
        scales: {
          x: { beginAtZero: true, max: 70, title: { display: true, text: "Share of private-sector employees (%)" } },
          y: { grid: { display: false } }
        }
      }
    });
  }

  /* ---------------- Figure A1: model comparison ---------------- */
  var MODEL_DATA = {
    "ROC-AUC":   { vals: [0.649, 0.638, 0.912], caption: "ROC-AUC measures how well a model ranks callback candidates above non-callbacks (0.5 is random guessing)." },
    "AP":        { vals: [0.170, 0.169, 0.781], caption: "Average precision summarizes the precision–recall curve. With about 8% callbacks, a model that guesses at random scores about 0.08." },
    "F1":        { vals: [0.037, 0.239, 0.788], caption: "F1 combines precision and recall into one score." },
    "Recall":    { vals: [0.020, 0.296, 0.816], caption: "Recall is the share of real callbacks that the model caught." },
    "Precision": { vals: [0.200, 0.200, 0.762], caption: "Precision is the share of flagged applications that really received a callback." },
    "Accuracy":  { vals: [0.915, 0.848, 0.965], caption: "Accuracy is the share of all 1,218 applications classified correctly. Because only about 8% received callbacks, predicting “no callback” for everyone would already score about 0.92." }
  };
  var currentMetric = "ROC-AUC";

  function buildModel() {
    var c1 = cssVar("--c1"), c3 = cssVar("--c3"), c4 = cssVar("--c4");
    make("modelChart", {
      type: "bar",
      data: {
        labels: ["GBM", "HistGBM (tuned)", "NN ensemble (under re-check)"],
        datasets: [{
          label: currentMetric,
          data: MODEL_DATA[currentMetric].vals,
          backgroundColor: [c1, c4, withAlpha(c3, 0.35)],
          borderColor: [c1, c4, c3], borderWidth: [0, 0, 1.5], borderRadius: 2, maxBarThickness: 40
        }]
      },
      options: {
        indexAxis: "y", responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: function (ctx) { return ctx.dataset.label + ": " + ctx.parsed.x.toFixed(3); } } } },
        scales: { x: { beginAtZero: true, max: 1 }, y: { grid: { display: false } } }
      }
    });
  }

  Array.prototype.forEach.call(document.querySelectorAll("#figA1 [data-metric]"), function (btn) {
    btn.addEventListener("click", function () {
      currentMetric = btn.getAttribute("data-metric");
      Array.prototype.forEach.call(document.querySelectorAll("#figA1 [data-metric]"), function (b) { b.classList.toggle("active", b === btn); });
      var ch = charts.modelChart;
      if (ch) { ch.data.datasets[0].label = currentMetric; ch.data.datasets[0].data = MODEL_DATA[currentMetric].vals; ch.update(); }
      var cap = document.getElementById("metric-caption");
      if (cap) cap.textContent = MODEL_DATA[currentMetric].caption;
    });
  });

  /* ---------------- Figure A2: feature importance ---------------- */
  var FEATURES = [
    ["Years of experience", 0.0312], ["Number of previous jobs", 0.0241], ["Resume quality (high vs. low)", 0.0198],
    ["City (Boston vs. Chicago)", 0.0176], ["Has college degree", 0.0154], ["Min. experience required", 0.0138],
    ["Perceived race", 0.0121], ["Volunteering listed", 0.0094], ["Email address provided", 0.0081],
    ["Military service", 0.0067], ["Honors listed", 0.0058], ["Computer-skills section", 0.0049],
    ["Special-skills section", 0.0041], ["Worked during school", 0.0033], ["Employment gaps", 0.0027]
  ];

  function buildFeat() {
    var accent = cssVar("--accent"), c5 = cssVar("--c5");
    make("featChart", {
      type: "bar",
      data: {
        labels: FEATURES.map(function (f) { return f[0]; }),
        datasets: [{
          data: FEATURES.map(function (f) { return f[1]; }),
          backgroundColor: FEATURES.map(function (f) { return f[0] === "Perceived race" ? accent : c5; }),
          borderRadius: 2, maxBarThickness: 18
        }]
      },
      options: {
        indexAxis: "y", responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: function (ctx) { return "Drop in ROC-AUC: " + ctx.parsed.x.toFixed(4); } } } },
        scales: {
          x: { beginAtZero: true, title: { display: true, text: "Mean drop in ROC-AUC when shuffled" } },
          y: { grid: { display: false }, ticks: { autoSkip: false } }
        }
      }
    });
  }

  function rebuildCharts() {
    if (!hasChart) return;
    applyDefaults();
    buildWealth(); buildCallback(); buildAdoption(); buildRep(); buildModel(); buildFeat();
  }

  /* ---------------- Figure 5: proxy illustration ---------------- */
  var RACE_LABELS = { white: "White", black: "Black", hisp: "Hispanic", asian: "Asian" };
  var PROXY_WEIGHTS = {
    zip: {
      white_sub: { white: 3.0, black: -1.0, hisp: -0.6, asian: -0.4 },
      black_urb: { white: -1.2, black: 3.2, hisp: -0.2, asian: -0.8 },
      hisp_urb:  { white: -1.0, black: -0.3, hisp: 3.0, asian: -0.6 },
      asian_sub: { white: -0.4, black: -0.9, hisp: -0.5, asian: 2.8 },
      mixed:     { white: 0.2, black: 0.2, hisp: 0.2, asian: 0.1 }
    },
    school: {
      ivy:   { white: 1.4, black: -0.2, hisp: -0.2, asian: 0.9 },
      hbcu:  { white: -1.5, black: 3.4, hisp: -0.4, asian: -0.9 },
      hsi:   { white: -0.4, black: -0.2, hisp: 2.6, asian: -0.4 },
      aapi:  { white: -0.2, black: -0.6, hisp: -0.4, asian: 2.4 },
      state: { white: 0.4, black: 0.2, hisp: 0.2, asian: 0.0 },
      cc:    { white: 0.0, black: 0.3, hisp: 0.4, asian: -0.1 }
    },
    name: {
      white:   { white: 2.6, black: -0.9, hisp: -0.7, asian: -0.6 },
      black:   { white: -1.3, black: 3.0, hisp: -0.4, asian: -0.7 },
      hisp:    { white: -0.6, black: -0.5, hisp: 2.8, asian: -0.6 },
      asian:   { white: -0.6, black: -0.7, hisp: -0.5, asian: 2.7 },
      neutral: { white: 0.1, black: 0.0, hisp: 0.0, asian: 0.0 }
    },
    act: {
      lacrosse: { white: 1.8, black: -0.7, hisp: -0.4, asian: -0.2 },
      nsbe:     { white: -1.1, black: 2.9, hisp: -0.3, asian: -0.6 },
      shpe:     { white: -0.5, black: -0.3, hisp: 2.7, asian: -0.5 },
      aaa:      { white: -0.4, black: -0.6, hisp: -0.4, asian: 2.5 },
      generic:  { white: 0.0, black: 0.0, hisp: 0.0, asian: 0.0 }
    }
  };
  var PROXY_FIELDS = [
    { id: "zip", label: "ZIP code" }, { id: "school", label: "school" },
    { id: "name", label: "first name" }, { id: "act", label: "activity" }
  ];

  function isHidden(field) {
    var b = document.querySelector(".omit[data-omit='" + field + "']");
    return b && b.getAttribute("aria-pressed") === "true";
  }

  function softmax(scores) {
    var keys = Object.keys(scores);
    var max = Math.max.apply(null, keys.map(function (k) { return scores[k]; }));
    var sum = 0, out = {};
    keys.forEach(function (k) { out[k] = Math.exp(scores[k] - max); sum += out[k]; });
    keys.forEach(function (k) { out[k] = out[k] / sum; });
    return out;
  }

  function runProxy() {
    var out = document.getElementById("proxy-out");
    if (!out) return;
    var totals = { white: 0, black: 0, hisp: 0, asian: 0 };
    var used = [], hidden = [];
    PROXY_FIELDS.forEach(function (f) {
      if (isHidden(f.id)) { hidden.push(f.label); return; }
      used.push(f.label);
      var sel = document.getElementById("proxy-" + f.id);
      var w = PROXY_WEIGHTS[f.id][sel.value];
      Object.keys(w).forEach(function (k) { totals[k] += w[k]; });
    });
    if (!used.length) {
      out.innerHTML = "<p class='verdict'>Every field is hidden, so the illustration can only guess at random (25% each).</p>";
      return;
    }
    var probs = softmax(totals);
    var ranked = Object.keys(probs).map(function (k) { return [k, probs[k]]; }).sort(function (a, b) { return b[1] - a[1]; });
    if (ranked[0][1] > 0.97) {
      var excess = ranked[0][1] - 0.97, rest = 1 - ranked[0][1];
      ranked[0][1] = 0.97;
      for (var i = 1; i < ranked.length; i++) ranked[i][1] += rest > 0 ? excess * ranked[i][1] / rest : excess / (ranked.length - 1);
    }
    var html = "";
    ranked.forEach(function (r, i) {
      html += "<div class='bar-row" + (i === 0 ? " top" : "") + "'><span>" + RACE_LABELS[r[0]] + "</span>" +
        "<div class='bar-track'><div class='bar-fill' data-w='" + (r[1] * 100).toFixed(1) + "'></div></div>" +
        "<span class='pct'>" + (r[1] * 100).toFixed(1) + "%</span></div>";
    });
    var top = ranked[0];
    var hiddenNote = hidden.length ? " Hidden fields: " + hidden.join(", ") + "." : "";
    html += "<p class='verdict'>" + (top[1] > 0.5
      ? "Without ever seeing race, the illustration guesses " + RACE_LABELS[top[0]] + " at " + (top[1] * 100).toFixed(1) + "%, using the " + used.join(", ") + "."
      : "The top guess (" + RACE_LABELS[top[0]] + ", " + (top[1] * 100).toFixed(1) + "%) is weaker but still above random (25%).") + hiddenNote + "</p>";
    out.innerHTML = html;
    requestAnimationFrame(function () {
      Array.prototype.forEach.call(out.querySelectorAll(".bar-fill"), function (el) { el.style.width = el.getAttribute("data-w") + "%"; });
    });
  }

  function resetProxy() {
    PROXY_FIELDS.forEach(function (f) {
      var sel = document.getElementById("proxy-" + f.id);
      if (sel) { sel.selectedIndex = 0; sel.disabled = false; }
      var b = document.querySelector(".omit[data-omit='" + f.id + "']");
      if (b) { b.setAttribute("aria-pressed", "false"); b.textContent = "Hide"; }
    });
    var out = document.getElementById("proxy-out");
    if (out) out.innerHTML = "<p class='verdict'>Choose resume details, hide any you like, and run the prediction. The race field is never used.</p>";
  }

  Array.prototype.forEach.call(document.querySelectorAll(".omit"), function (b) {
    b.addEventListener("click", function (e) {
      e.preventDefault();
      var on = b.getAttribute("aria-pressed") === "true";
      b.setAttribute("aria-pressed", on ? "false" : "true");
      b.textContent = on ? "Hide" : "Hidden";
      var sel = document.getElementById("proxy-" + b.getAttribute("data-omit"));
      if (sel) sel.disabled = !on;
    });
  });
  var pr = document.getElementById("proxy-run");
  if (pr) pr.addEventListener("click", runProxy);
  var px = document.getElementById("proxy-reset");
  if (px) px.addEventListener("click", resetProxy);

  /* ---------------- Figure 6: state law map ---------------- */
  var NCSL = { label: "NCSL, state artificial intelligence legislation tracker", url: "https://www.ncsl.org/technology-and-communication/artificial-intelligence-2024-legislation" };
  var CAT_LABEL = {
    audit: "Bias audit or impact assessment required",
    rule: "AI hiring rule (anti-discrimination, notice, or consent)",
    trans: "General AI disclosure law",
    pend: "Bills introduced, none enacted",
    none: "No AI-specific hiring law found"
  };
  var LAWS = {
    NY: { steps: [[2023, "audit"]],
      body: "New York City’s Local Law 144 (enforced since July 2023) bars employers in the city from using an automated employment decision tool unless it has had an independent bias audit within the past year, and requires a summary of the results to be published. This entry reflects the city law; New York State has no matching law.",
      src: [{ label: "NYC Department of Consumer and Worker Protection, AEDT", url: "https://www.nyc.gov/site/dca/about/automated-employment-decision-tools.page" }] },
    CO: { steps: [[2024, "audit"], [2026, "rule"]],
      body: "SB24-205 (signed May 2024) would have required deployers of high-risk AI systems, including those used in employment decisions, to complete impact assessments and annual reviews. In May 2026, before it took effect, Colorado repealed and replaced it with SB26-189. Starting January 1, 2027, the new law requires notice, a plain-language explanation after an adverse decision, correction of personal data, and human review, instead of impact assessments.",
      src: [{ label: "Colorado General Assembly, SB24-205", url: "https://leg.colorado.gov/bills/sb24-205" }, { label: "Colorado General Assembly, SB26-189", url: "https://leg.colorado.gov/bills/sb26-189" }] },
    IL: { steps: [[2024, "rule"]],
      body: "HB3773 (signed August 2024, effective January 1, 2026) amends the Illinois Human Rights Act to make it a civil rights violation for employers to use AI that has the effect of discriminating on protected grounds, or to fail to notify applicants when AI is used.",
      src: [{ label: "Illinois General Assembly, HB3773", url: "https://www.ilga.gov/legislation/billstatus.asp?DocNum=3773&GAID=17&DocTypeID=HB&SessionID=112" }] },
    TX: { steps: [[2023, "pend"], [2025, "rule"]],
      body: "The Texas Responsible Artificial Intelligence Governance Act (HB 149), signed June 22, 2025 and effective January 1, 2026, bars developing or deploying AI with the intent to unlawfully discriminate against a protected class. Unequal outcomes alone do not violate it; federal law still covers disparate impact.",
      src: [{ label: "Texas Legislature Online, HB 149 (89th Legislature)", url: "https://capitol.texas.gov/BillLookup/History.aspx?LegSess=89R&Bill=HB149" }] },
    CA: { steps: [[2025, "rule"]],
      body: "In 2025, California’s Civil Rights Council finalized regulations applying the Fair Employment and Housing Act to automated-decision systems used in hiring, including recordkeeping requirements and liability for tools that discriminate against protected groups.",
      src: [{ label: "California Civil Rights Department", url: "https://calcivilrights.ca.gov/" }] },
    MD: { steps: [[2020, "rule"]],
      body: "HB1202 (2020) bars employers from using facial recognition to create a facial template during a job interview unless the applicant signs a consent waiver. It is a narrow rule on one use of AI in hiring.",
      src: [{ label: "Maryland General Assembly, HB1202 (2020)", url: "https://mgaleg.maryland.gov/2020RS/bills/hb/hb1202E.pdf" }] },
    UT: { steps: [[2024, "trans"]],
      body: "The Artificial Intelligence Policy Act (SB149, 2024) requires disclosure of generative AI use in some regulated occupations and consumer interactions. It is a general transparency law, not a hiring-specific rule.",
      src: [{ label: "Utah State Legislature, SB149 (2024)", url: "https://le.utah.gov/~2024/bills/static/SB0149.html" }] },
    NJ: { steps: [[2022, "pend"]], body: "Bills on AI in employment decisions, including bias audits and applicant notice, have been introduced but not enacted.", src: [NCSL] },
    CT: { steps: [[2023, "pend"]], body: "SB1103 (2023) created an inventory of state AI systems. Broader bills on automated decision tools have been introduced but not enacted.", src: [NCSL] },
    MA: { steps: [[2023, "pend"]], body: "Bills regulating AI in hiring have been introduced in several sessions but not enacted.", src: [NCSL] },
    VT: { steps: [[2024, "pend"]], body: "Legislation requiring impact assessments for automated decision systems used by employers has been introduced but not enacted.", src: [NCSL] },
    WA: { steps: [[2024, "pend"]], body: "Bills on an AI task force and on automated decision tools in employment have been introduced, but no binding audit requirement has been enacted.", src: [NCSL] },
    VA: { steps: [[2025, "pend"]], body: "HB2094, the High-Risk AI Developer and Deployer Act, passed the legislature in 2025 but was vetoed by the governor.", src: [NCSL] }
  };
  var STATE_NAMES = {
    AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado", CT: "Connecticut",
    DE: "Delaware", DC: "District of Columbia", FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois",
    IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland", MA: "Massachusetts",
    MI: "Michigan", MN: "Minnesota", MS: "Mississippi", MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada",
    NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota",
    OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota",
    TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont", VA: "Virginia", WA: "Washington", WV: "West Virginia",
    WI: "Wisconsin", WY: "Wyoming"
  };
  var FIPS = {
    "01": "AL", "02": "AK", "04": "AZ", "05": "AR", "06": "CA", "08": "CO", "09": "CT", "10": "DE", "11": "DC", "12": "FL",
    "13": "GA", "15": "HI", "16": "ID", "17": "IL", "18": "IN", "19": "IA", "20": "KS", "21": "KY", "22": "LA", "23": "ME",
    "24": "MD", "25": "MA", "26": "MI", "27": "MN", "28": "MS", "29": "MO", "30": "MT", "31": "NE", "32": "NV", "33": "NH",
    "34": "NJ", "35": "NM", "36": "NY", "37": "NC", "38": "ND", "39": "OH", "40": "OK", "41": "OR", "42": "PA", "44": "RI",
    "45": "SC", "46": "SD", "47": "TN", "48": "TX", "49": "UT", "50": "VT", "51": "VA", "53": "WA", "54": "WV", "55": "WI", "56": "WY"
  };
  var mapYear = 2026, mapTimer = null, selectedCode = null;

  function catFor(code, year) {
    var law = LAWS[code];
    if (!law) return "none";
    var cat = "none";
    law.steps.forEach(function (s) { if (s[0] <= year) cat = s[1]; });
    return cat;
  }

  function paintMap() {
    var counts = { audit: 0, rule: 0, trans: 0, pend: 0 };
    Array.prototype.forEach.call(document.querySelectorAll("#us-map .state"), function (p) {
      var code = p.getAttribute("data-code");
      var cat = catFor(code, mapYear);
      p.setAttribute("class", "state cat-" + cat + (code === selectedCode ? " selected" : ""));
    });
    Object.keys(LAWS).forEach(function (code) { var c = catFor(code, mapYear); if (counts[c] !== undefined) counts[c]++; });
    var r = document.getElementById("map-readout");
    if (r) r.innerHTML = "<strong>" + mapYear + "</strong> · " + counts.audit + " audit · " + counts.rule + " hiring rule · " + counts.trans + " disclosure · " + counts.pend + " pending";
    var s = document.getElementById("map-scrub");
    if (s) s.value = String(mapYear);
    if (selectedCode) showState(selectedCode);
  }

  function showState(code) {
    var d = document.getElementById("map-detail");
    if (!d) return;
    var cat = catFor(code, mapYear);
    var name = STATE_NAMES[code] || code;
    var law = LAWS[code];
    var html = "<div class='d-head'><span class='d-state'>" + name + "</span><span class='d-tag cat-" + cat + "'><i></i>" + CAT_LABEL[cat] + " (" + mapYear + ")</span></div>";
    if (law && cat !== "none") {
      html += "<p>" + law.body + "</p><p>Source: " + law.src.map(function (s) {
        return "<a href='" + s.url + "' target='_blank' rel='noopener'>" + s.label + "</a>";
      }).join("; ") + "</p>";
    } else if (law) {
      html += "<p>No law in this category yet in " + mapYear + ". Move the slider to a later year.</p>";
    } else {
      html += "<p>No state law found that specifically regulates AI in hiring. Federal anti-discrimination law, including Title VII of the Civil Rights Act, still applies.</p><p>Source: <a href='" + NCSL.url + "' target='_blank' rel='noopener'>" + NCSL.label + "</a></p>";
    }
    d.innerHTML = html;
  }

  function stopMap() {
    if (mapTimer) { clearInterval(mapTimer); mapTimer = null; }
    var b = document.getElementById("map-play");
    if (b) { b.textContent = "Play 2020–2026"; b.setAttribute("aria-pressed", "false"); }
  }

  function playMap() {
    if (mapTimer) { stopMap(); return; }
    var b = document.getElementById("map-play");
    if (b) { b.textContent = "Pause"; b.setAttribute("aria-pressed", "true"); }
    if (mapYear >= 2026) { mapYear = 2020; paintMap(); }
    mapTimer = setInterval(function () {
      if (mapYear >= 2026) { stopMap(); return; }
      mapYear += 1; paintMap();
    }, reduceMotion ? 400 : 850);
  }

  function buildMap() {
    var svg = document.getElementById("us-map");
    var loading = document.getElementById("map-loading");
    if (!svg) return;
    if (typeof d3 === "undefined" || typeof topojson === "undefined" || !window.US_TOPOJSON) {
      if (loading) loading.textContent = "The map could not be loaded.";
      return;
    }
    var tip = document.getElementById("map-tip");
    var states = topojson.feature(window.US_TOPOJSON, window.US_TOPOJSON.objects.states);
    var path = d3.geoPath();
    var sel = d3.select(svg);
    sel.selectAll("*").remove();
    sel.append("g").selectAll("path")
      .data(states.features.filter(function (f) { return FIPS[String(f.id).padStart(2, "0")]; }))
      .enter().append("path")
      .attr("d", path)
      .attr("data-code", function (f) { return FIPS[String(f.id).padStart(2, "0")]; })
      .attr("class", "state cat-none")
      .attr("tabindex", 0)
      .attr("role", "button")
      .attr("aria-label", function (f) { return STATE_NAMES[FIPS[String(f.id).padStart(2, "0")]]; })
      .on("click", function () { selectedCode = this.getAttribute("data-code"); paintMap(); })
      .on("keydown", function (event) {
        if (event.key === "Enter" || event.key === " ") { event.preventDefault(); selectedCode = this.getAttribute("data-code"); paintMap(); }
      })
      .on("mousemove", function (event) {
        if (!tip) return;
        var code = this.getAttribute("data-code");
        tip.innerHTML = (STATE_NAMES[code] || code) + "<span>" + CAT_LABEL[catFor(code, mapYear)] + "</span>";
        tip.style.left = (event.clientX + 12) + "px";
        tip.style.top = (event.clientY + 12) + "px";
        tip.classList.add("on");
      })
      .on("mouseleave", function () { if (tip) tip.classList.remove("on"); });
    if (loading) loading.classList.add("hidden");
    paintMap();
  }

  var mpl = document.getElementById("map-play");
  if (mpl) mpl.addEventListener("click", playMap);
  var msc = document.getElementById("map-scrub");
  if (msc) msc.addEventListener("input", function (e) { stopMap(); mapYear = parseInt(e.target.value, 10); paintMap(); });

  /* ---------------- init ---------------- */
  rebuildCharts();
  buildMap();
})();
