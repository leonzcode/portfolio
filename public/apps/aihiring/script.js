// =============================================================
// Research website — interactivity
// =============================================================

// ---------- Animated counters in hero ----------
function animateCounter(el) {
  const target = parseFloat(el.dataset.target);
  const suffix = el.dataset.suffix || '';
  const duration = 1600;
  const start = performance.now();
  function tick(now) {
    const p = Math.min((now - start) / duration, 1);
    const eased = 1 - Math.pow(1 - p, 3);
    const val = (target * eased).toFixed(1);
    el.textContent = val + suffix;
    if (p < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

const heroObserver = new IntersectionObserver((entries) => {
  entries.forEach((e) => {
    if (e.isIntersecting) {
      animateCounter(e.target);
      heroObserver.unobserve(e.target);
    }
  });
}, { threshold: 0.4 });
document.querySelectorAll('.stat .num').forEach((el) => heroObserver.observe(el));

// ---------- Reveal sections on scroll ----------
const sectionObserver = new IntersectionObserver((entries) => {
  entries.forEach((e) => {
    if (e.isIntersecting) {
      e.target.classList.add('visible');
      sectionObserver.unobserve(e.target);
    }
  });
}, { threshold: 0.1 });
document.querySelectorAll('.section').forEach((s) => sectionObserver.observe(s));

// ---------- Back-to-top button ----------
const topBtn = document.getElementById('topBtn');
window.addEventListener('scroll', () => {
  topBtn.classList.toggle('visible', window.scrollY > 600);
});
topBtn.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));

// =============================================================
// CHART 1 — Callback rate by race  (Bertrand & Mullainathan data)
// =============================================================
// Real numbers from the labor_market_discrimination dataset:
// White-sounding names: 235 callbacks / 2435 apps ≈ 9.65%
// Black-sounding names: 157 callbacks / 2435 apps ≈ 6.45%
function buildCallbackChart(canvas, opts = {}) {
  return new Chart(canvas, {
    type: 'bar',
    data: {
      labels: ['White-sounding names', 'Black-sounding names'],
      datasets: [{
        label: 'Callback rate (%)',
        data: [9.65, 6.45],
        backgroundColor: ['#4a7ba7', '#b04a3e'],
        borderRadius: 6,
        borderSkipped: false,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: opts.animDuration ?? 800 },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const total = 2435;
              const callbacks = Math.round((ctx.parsed.y / 100) * total);
              return `${ctx.parsed.y}% — ${callbacks} callbacks out of ${total} applications`;
            }
          }
        },
        title: {
          display: true,
          text: '50% more callbacks for white-sounding names (Bertrand & Mullainathan, 2004)',
          font: { size: opts.titleSize ?? 14, family: 'Helvetica Neue, sans-serif' },
          color: '#2d3748',
          padding: { bottom: 15 }
        }
      },
      scales: {
        y: {
          beginAtZero: true,
          max: 12,
          title: { display: true, text: 'Callback rate (%)', font: { size: opts.axisSize ?? 12 } },
          grid: { color: '#e2e8f0' },
          ticks: { font: { size: opts.tickSize ?? 11 } }
        },
        x: {
          grid: { display: false },
          ticks: { font: { size: opts.tickSize ?? 11 } }
        }
      }
    }
  });
}

function openCallbackModal() {
  const overlay = document.createElement('div');
  overlay.className = 'chart-modal';
  overlay.innerHTML = `
    <div class="chart-modal-inner" role="dialog" aria-modal="true" aria-label="Enlarged callback rate chart">
      <button class="chart-modal-close" aria-label="Close">&times;</button>
      <div class="chart-modal-title">Callback rate by applicant race — Bertrand &amp; Mullainathan (2004)</div>
      <div class="chart-modal-canvas"><canvas id="callbackChartLarge"></canvas></div>
    </div>`;
  document.body.appendChild(overlay);
  document.body.style.overflow = 'hidden';

  let largeInst = null;
  const close = () => {
    if (largeInst) largeInst.destroy();
    overlay.remove();
    document.body.style.overflow = '';
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  overlay.querySelector('.chart-modal-close').addEventListener('click', close);

  const largeCanvas = overlay.querySelector('#callbackChartLarge');
  largeInst = buildCallbackChart(largeCanvas, {
    titleSize: 18, axisSize: 14, tickSize: 13, animDuration: 600
  });
}

const callbackCtx = document.getElementById('callbackChart');
if (callbackCtx) {
  buildCallbackChart(callbackCtx);
  const wrap = callbackCtx.closest('.chart-wrap');
  if (wrap) {
    wrap.classList.add('chart-wrap-zoomable');
    wrap.setAttribute('role', 'button');
    wrap.setAttribute('tabindex', '0');
    wrap.setAttribute('aria-label', 'Enlarge callback rate chart');
    wrap.addEventListener('click', openCallbackModal);
    wrap.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openCallbackModal(); }
    });
  }
}

// =============================================================
// CHART 2 — Model comparison (interactive metric switcher)
// =============================================================
const modelData = {
  'ROC-AUC':   { vals: [0.649, 0.638, 0.912], best: 2,
    caption: 'ROC-AUC measures how well a model ranks callback candidates above non-callbacks. The neural-network ensemble achieved 0.912 — a substantial jump over the gradient-boosted baselines.' },
  'AP':        { vals: [0.170, 0.169, 0.781], best: 2,
    caption: 'Average Precision summarizes the precision–recall curve. The NN ensemble (0.781) dominates the gradient-boosted models, which both sit near the dataset\u2019s naïve floor.' },
  'F1':        { vals: [0.037, 0.239, 0.788], best: 2,
    caption: 'F1 combines precision and recall. The neural-network ensemble (0.788) decisively beats HistGBM, and both massively outperform the untuned baseline.' },
  'Recall':    { vals: [0.020, 0.296, 0.816], best: 2,
    caption: 'Recall = fraction of real callbacks that were caught. The NN catches 81.6% of real callbacks — by far the best of any model.' },
  'Accuracy':  { vals: [0.915, 0.848, 0.965], best: 2,
    caption: 'Accuracy = fraction of all 1,218 applications classified correctly. The NN ensemble reaches 96.5% — only 43 mistakes total.' },
  'Precision': { vals: [0.200, 0.200, 0.762], best: 2,
    caption: 'Precision = of those flagged, what fraction are real callbacks. The NN ensemble reaches 76.2%, nearly 4× the gradient-boosted models.' }
};

const modelCtx = document.getElementById('modelChart');
let modelChart;
if (modelCtx) {
  const initialMetric = 'ROC-AUC';
  const labels = ['Gradient Boosting', 'HistGBM (tuned)', 'NN Ensemble (mine)'];
  const baseColors = ['#4a7ba7', '#dd8452', '#8172b3'];

  function buildColors(metric) {
    const best = modelData[metric].best;
    return baseColors.map((c, i) => i === best ? c : c + '99');
  }

  modelChart = new Chart(modelCtx, {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [{
        label: initialMetric,
        data: modelData[initialMetric].vals,
        backgroundColor: buildColors(initialMetric),
        borderRadius: 6,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      indexAxis: 'y',
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => `${ctx.dataset.label}: ${ctx.parsed.x.toFixed(3)}`
          }
        }
      },
      scales: {
        x: { beginAtZero: true, grid: { color: '#e2e8f0' } },
        y: { grid: { display: false } }
      },
      animation: { duration: 700 }
    }
  });

  document.querySelectorAll('.metric-buttons button').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.metric-buttons button').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      const m = btn.dataset.metric;
      modelChart.data.datasets[0].label = m;
      modelChart.data.datasets[0].data = modelData[m].vals;
      modelChart.data.datasets[0].backgroundColor = buildColors(m);
      modelChart.update();
      document.getElementById('metric-caption').textContent = modelData[m].caption;
    });
  });
}

// =============================================================
// Smooth nav highlight on scroll
// =============================================================
const navLinks = document.querySelectorAll('#navbar a[href^="#"]');
const sectionsForNav = Array.from(navLinks).map((a) => {
  const id = a.getAttribute('href').slice(1);
  return { link: a, el: document.getElementById(id) };
}).filter((x) => x.el);

window.addEventListener('scroll', () => {
  const y = window.scrollY + 100;
  let active = null;
  for (const { link, el } of sectionsForNav) {
    if (el.offsetTop <= y) active = link;
  }
  navLinks.forEach((l) => l.style.color = '');
  if (active) active.style.color = '#f4a896';
});

// =============================================================
// Click-to-zoom for gallery images
// =============================================================
document.querySelectorAll('.gallery img').forEach((img) => {
  img.addEventListener('click', () => {
    const overlay = document.createElement('div');
    overlay.style.cssText = `
      position: fixed; inset: 0; background: rgba(0,0,0,0.92);
      display: flex; align-items: center; justify-content: center;
      z-index: 2000; cursor: zoom-out; padding: 2rem;
    `;
    const big = document.createElement('img');
    big.src = img.src;
    big.style.cssText = 'max-width: 95%; max-height: 95%; border-radius: 6px;';
    overlay.appendChild(big);
    overlay.addEventListener('click', () => overlay.remove());
    document.body.appendChild(overlay);
  });
});

/* ============= PROXY-PREDICTION SIMULATION ============= */
// Each feature value contributes "log-odds-like" weights toward each race class.
// Weights are illustrative but consistent with how real models pick up proxies:
// names, ZIP codes, schools, and affiliations all leak demographic signal.
const RACE_LABELS = {
  white:  'White',
  black:  'Black',
  hisp:   'Hispanic',
  asian:  'Asian'
};

const PROXY_WEIGHTS = {
  zip: {
    white_sub:  { white: 3.0, black: -1.0, hisp: -0.6, asian: -0.4 },
    black_urb:  { white: -1.2, black: 3.2, hisp: -0.2, asian: -0.8 },
    hisp_urb:   { white: -1.0, black: -0.3, hisp: 3.0, asian: -0.6 },
    asian_sub:  { white: -0.4, black: -0.9, hisp: -0.5, asian: 2.8 },
    mixed:      { white: 0.2, black: 0.2, hisp: 0.2, asian: 0.1 }
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

function softmax(scores) {
  const max = Math.max(...Object.values(scores));
  const exps = {};
  let sum = 0;
  for (const k in scores) { exps[k] = Math.exp(scores[k] - max); sum += exps[k]; }
  const out = {};
  for (const k in exps) out[k] = exps[k] / sum;
  return out;
}

function proxyIsHidden(field) {
  const btn = document.querySelector(`.proxy-omit-btn[data-omit="${field}"]`);
  return btn && btn.getAttribute('aria-pressed') === 'true';
}

function proxyPredict() {
  const fields = [
    { id: 'zip',    el: document.getElementById('proxy-zip'),    label: 'ZIP code' },
    { id: 'school', el: document.getElementById('proxy-school'), label: 'College / school' },
    { id: 'name',   el: document.getElementById('proxy-name'),   label: 'First name' },
    { id: 'act',    el: document.getElementById('proxy-act'),    label: 'Extracurricular' }
  ];
  const used = [], hidden = [];
  const totals = { white: 0, black: 0, hisp: 0, asian: 0 };
  fields.forEach(f => {
    if (proxyIsHidden(f.id)) { hidden.push(f.label); return; }
    used.push(f.label);
    const w = PROXY_WEIGHTS[f.id][f.el.value];
    for (const k in w) totals[k] += w[k];
  });

  const out = document.getElementById('proxy-output');
  if (used.length === 0) {
    out.innerHTML = '<p class="proxy-hint">Every field is hidden — the resume is now completely blank, so the model can only guess at random (25% each). Un-hide at least one field to see what the model picks up on.</p>';
    return;
  }

  const probs = softmax(totals);

  // Cap the top class at 97%; redistribute the excess across the other classes
  // proportionally to their current shares so total still sums to 1.
  const MAX_TOP = 0.97;
  const topKey = Object.entries(probs).sort((a, b) => b[1] - a[1])[0][0];
  if (probs[topKey] > MAX_TOP) {
    const excess = probs[topKey] - MAX_TOP;
    probs[topKey] = MAX_TOP;
    const others = Object.keys(probs).filter(k => k !== topKey);
    const otherSum = others.reduce((s, k) => s + probs[k], 0);
    if (otherSum > 0) {
      others.forEach(k => { probs[k] += excess * (probs[k] / otherSum); });
    } else {
      const share = excess / others.length;
      others.forEach(k => { probs[k] += share; });
    }
  }

  const ranked = Object.entries(probs).sort((a, b) => b[1] - a[1]);
  const top = ranked[0];
  const topPct = (top[1] * 100).toFixed(1);
  const topLabel = RACE_LABELS[top[0]];

  // Build verdict text based on confidence
  let confidence;
  if (top[1] > 0.75)      confidence = 'highly confident';
  else if (top[1] > 0.55) confidence = 'fairly confident';
  else if (top[1] > 0.40) confidence = 'leaning';
  else                    confidence = 'uncertain but still biased';

  const verdict = top[1] > 0.50
    ? `Even though the race box was deleted, the model is <strong>${confidence}</strong> the applicant is <strong>${topLabel}</strong> (${topPct}%)${hidden.length ? ` — with <strong>${hidden.join(', ')}</strong> also hidden, it still inferred race from the remaining ${used.length} field${used.length === 1 ? '' : 's'}` : ''}. Whatever bias the model learned about race during training will now be applied to this resume — the "fix" did almost nothing.`
    : `The model is <strong>${confidence}</strong> here, but its top guess (${topLabel}, ${topPct}%) is still above random (25%)${hidden.length ? ` even after hiding ${hidden.join(', ')}` : ''}. It would still nudge predictions in a race-correlated direction, just less obviously. Subtle leakage like this is the hardest kind to detect.`;

  // Render
  let html = '<p class="proxy-result-title">Model\u2019s guess (race field hidden)</p><div class="proxy-bars">';
  ranked.forEach(([k, p], i) => {
    const pct = (p * 100).toFixed(1);
    const cls = i === 0 ? 'proxy-bar-row top' : 'proxy-bar-row';
    html += `<div class="${cls}"><div class="proxy-bar-label">${RACE_LABELS[k]}</div>` +
            `<div class="proxy-bar-track"><div class="proxy-bar-fill" style="width:0%"></div></div>` +
            `<div class="proxy-bar-pct">${pct}%</div></div>`;
  });
  html += `</div><div class="proxy-verdict">${verdict}</div>`;
  out.innerHTML = html;

  // Animate bars after insert
  requestAnimationFrame(() => {
    const fills = out.querySelectorAll('.proxy-bar-fill');
    ranked.forEach(([, p], i) => {
      if (fills[i]) fills[i].style.width = (p * 100).toFixed(1) + '%';
    });
  });
}

function proxyReset() {
  document.getElementById('proxy-zip').selectedIndex = 0;
  document.getElementById('proxy-school').selectedIndex = 0;
  document.getElementById('proxy-name').selectedIndex = 0;
  document.getElementById('proxy-act').selectedIndex = 0;
  document.querySelectorAll('.proxy-omit-btn').forEach(btn => {
    btn.setAttribute('aria-pressed', 'false');
    btn.textContent = 'Hide';
    const sel = btn.closest('label').querySelector('select');
    if (sel) sel.disabled = false;
  });
  document.getElementById('proxy-output').innerHTML =
    '<p class="proxy-hint">The AI hasn\u2019t seen the race field \u2014 but every other choice above leaks demographic information. Click <strong>Run AI prediction</strong> to see what the model would guess.</p>';
}

document.addEventListener('DOMContentLoaded', () => {
  const runBtn = document.getElementById('proxy-run');
  const resetBtn = document.getElementById('proxy-reset');
  if (runBtn) runBtn.addEventListener('click', proxyPredict);
  if (resetBtn) resetBtn.addEventListener('click', proxyReset);
  document.querySelectorAll('.proxy-omit-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const on = btn.getAttribute('aria-pressed') === 'true';
      btn.setAttribute('aria-pressed', on ? 'false' : 'true');
      btn.textContent = on ? 'Hide' : 'Hidden';
      const sel = btn.closest('label').querySelector('select');
      if (sel) sel.disabled = !on;
    });
  });
});

/* ============= U.S. AUDIT-LAW MAP ============= */
// 12-column x 9-row geographic tile grid. Empty cells are "".
const US_GRID = [
  ['', '', '', '', '', '', '', '', '', '', '', 'ME'],
  ['AK', '', '', '', '', '', '', '', '', 'VT', 'NH', ''],
  ['', '', '', '', '', '', '', 'WI', '', 'NY', 'MA', ''],
  ['WA', 'ID', 'MT', 'ND', 'MN', 'IL', 'MI', '', 'PA', 'NJ', 'CT', 'RI'],
  ['OR', 'NV', 'WY', 'SD', 'IA', 'IN', 'OH', '', 'MD', 'DE', '', ''],
  ['CA', 'UT', 'CO', 'NE', 'MO', 'KY', 'WV', 'VA', 'DC', '', '', ''],
  ['',   'AZ', 'NM', 'KS', 'AR', 'TN', 'NC', '',   '',   '', '', ''],
  ['HI', '',   '',   'OK', 'LA', 'MS', 'AL', 'SC', '',   '', '', ''],
  ['',   '',   '',   'TX', '',   '',   '',   'GA', 'FL', '', '', '']
];

const NCSL_URL  = 'https://www.ncsl.org/technology-and-communication/artificial-intelligence-2024-legislation';
const NCSL_LBL  = 'NCSL — 2024–2025 State AI Legislation Tracker';

// Year each state's current category took effect / its legislation was first
// introduced. Used by the timeline scrubber to animate the map.
const STATE_YEAR = {
  MD: 2020,  // HB1202 enacted 2020
  NY: 2023,  // NYC Local Law 144 effective July 2023
  CO: 2024,  // SB24-205 signed May 2024
  IL: 2024,  // HB3773 signed August 2024
  UT: 2024,  // SB149 signed 2024
  CA: 2025,  // Civil Rights Council regs finalized 2025
  NJ: 2022,  // AEDT bills first introduced
  CT: 2023,  // SB1103 (2023)
  MA: 2023,  // bills introduced
  VT: 2024,  // impact-assessment bill introduced
  WA: 2024,  // AI task force / employment bills introduced
  VA: 2025,  // HB2094 passed (vetoed)
  TX: 2023   // HB2060 (2023)
};

const STATE_INFO = {
  // ---------- COMPREHENSIVE ----------
  CO: {
    name: 'Colorado', cat: 'comp',
    body: 'Colorado SB24-205 (the Colorado AI Act, effective February 2026) requires deployers of "high-risk" AI systems — including those used in employment decisions — to complete an impact assessment and conduct annual reviews to ensure the system is not causing algorithmic discrimination.',
    src: { label: 'Colorado General Assembly — SB24-205 bill text', url: 'https://leg.colorado.gov/bills/sb24-205' }
  },
  IL: {
    name: 'Illinois', cat: 'comp',
    body: 'Illinois HB3773 (signed August 2024, effective January 1, 2026) amends the Illinois Human Rights Act to make it a civil rights violation for employers to use AI that has the effect of "subjecting employees to discrimination" on protected grounds, and to fail to notify applicants when AI is used in hiring.',
    src: { label: 'Illinois General Assembly — HB3773', url: 'https://www.ilga.gov/legislation/billstatus.asp?DocNum=3773&GAID=17&DocTypeID=HB&SessionID=112' }
  },

  // ---------- TARGETED ----------
  NY: {
    name: 'New York', cat: 'target',
    body: 'New York City Local Law 144 (effective July 2023) prohibits employers in NYC from using an automated employment decision tool unless it has been subject to an independent bias audit within the past year, with the results published. The state has not yet enacted a parallel law, but several bills are pending in Albany.',
    src: { label: 'NYC Department of Consumer & Worker Protection — AEDT rules', url: 'https://www.nyc.gov/site/dca/about/automated-employment-decision-tools.page' }
  },
  MD: {
    name: 'Maryland', cat: 'target',
    body: 'Maryland HB1202 (2020) prohibits employers from using facial-recognition technology to create a "facial template" during a job interview unless the applicant signs a written consent and waiver — a narrow but enforceable rule on AI in hiring.',
    src: { label: 'Maryland General Assembly — HB1202 (2020)', url: 'https://mgaleg.maryland.gov/2020RS/bills/hb/hb1202E.pdf' }
  },

  // ---------- TRANSPARENCY ----------
  CA: {
    name: 'California', cat: 'trans',
    body: 'California\u2019s Civil Rights Council finalized regulations in 2025 that explicitly extend the Fair Employment and Housing Act to "automated decision systems" used in hiring, requiring employers to keep records of selection criteria and prohibiting use of tools that produce a disparate impact on protected groups.',
    src: { label: 'California Civil Rights Department — Automated Decision Systems regulations', url: 'https://calcivilrights.ca.gov/' }
  },
  UT: {
    name: 'Utah', cat: 'trans',
    body: 'Utah SB149 (the Artificial Intelligence Policy Act, 2024) requires that anyone using generative AI in a regulated occupation — including employment services — disclose the use of AI when asked, and holds the deployer liable for AI-produced violations of consumer-protection law.',
    src: { label: 'Utah State Legislature — SB149 (2024)', url: 'https://le.utah.gov/~2024/bills/static/SB0149.html' }
  },

  // ---------- PENDING ----------
  NJ: { name: 'New Jersey', cat: 'pend',
        body: 'Multiple bills regulating AI in employment decisions (including AEDT bias audits and applicant notice) have been introduced in the New Jersey Legislature but have not yet been enacted.',
        src: { label: NCSL_LBL, url: NCSL_URL } },
  CT: { name: 'Connecticut', cat: 'pend',
        body: 'Connecticut SB1103 (2023) created a state inventory of AI systems and ongoing study of automated decision tools. Broader audit-style legislation has been introduced in subsequent sessions but has not become law.',
        src: { label: NCSL_LBL, url: NCSL_URL } },
  MA: { name: 'Massachusetts', cat: 'pend',
        body: 'Massachusetts has had multiple sessions of legislation introduced (e.g., bills modeled on Local Law 144 and on the EU AI Act) regulating AI in hiring, but none have been signed into law yet.',
        src: { label: NCSL_LBL, url: NCSL_URL } },
  VT: { name: 'Vermont', cat: 'pend',
        body: 'Vermont has an Artificial Intelligence Division within the state government and has introduced legislation requiring impact assessments for automated decision systems used by employers, but a final law has not yet been enacted.',
        src: { label: NCSL_LBL, url: NCSL_URL } },
  WA: { name: 'Washington', cat: 'pend',
        body: 'Washington has introduced bills creating an AI task force and addressing automated decision tools used in employment, but none have been enacted into a binding audit requirement as of May 2026.',
        src: { label: NCSL_LBL, url: NCSL_URL } },
  VA: { name: 'Virginia', cat: 'pend',
        body: 'Virginia HB2094 (the High-Risk AI Developer and Deployer Act) passed the legislature in early 2025 but was vetoed by the governor; updated AI-employment bills have been re-introduced in subsequent sessions.',
        src: { label: NCSL_LBL, url: NCSL_URL } },
  TX: { name: 'Texas', cat: 'pend',
        body: 'Texas HB2060 (2023) created an AI advisory council to study automated decision systems used by state agencies. Broader proposals (the Texas Responsible AI Governance Act) regulating private-sector AI in hiring have been filed but not yet enacted.',
        src: { label: NCSL_LBL, url: NCSL_URL } }
};

const STATE_NAMES = {
  AL:'Alabama',AK:'Alaska',AZ:'Arizona',AR:'Arkansas',CA:'California',CO:'Colorado',CT:'Connecticut',
  DE:'Delaware',DC:'District of Columbia',FL:'Florida',GA:'Georgia',HI:'Hawaii',ID:'Idaho',IL:'Illinois',
  IN:'Indiana',IA:'Iowa',KS:'Kansas',KY:'Kentucky',LA:'Louisiana',ME:'Maine',MD:'Maryland',MA:'Massachusetts',
  MI:'Michigan',MN:'Minnesota',MS:'Mississippi',MO:'Missouri',MT:'Montana',NE:'Nebraska',NV:'Nevada',
  NH:'New Hampshire',NJ:'New Jersey',NM:'New Mexico',NY:'New York',NC:'North Carolina',ND:'North Dakota',
  OH:'Ohio',OK:'Oklahoma',OR:'Oregon',PA:'Pennsylvania',RI:'Rhode Island',SC:'South Carolina',SD:'South Dakota',
  TN:'Tennessee',TX:'Texas',UT:'Utah',VT:'Vermont',VA:'Virginia',WA:'Washington',WV:'West Virginia',
  WI:'Wisconsin',WY:'Wyoming'
};

const CAT_LABEL = {
  comp:   'Comprehensive AI-employment law',
  target: 'Targeted AI hiring rule',
  trans:  'Broad AI transparency law',
  pend:   'Legislation pending',
  none:   'No specific AI hiring law'
};

function buildUSMap() {
  const svg = document.getElementById('us-map-svg');
  const loading = document.getElementById('us-map-loading');
  if (!svg || typeof d3 === 'undefined' || typeof topojson === 'undefined') return;

  // FIPS code -> two-letter state code (only states + DC; territories filtered out)
  const FIPS_TO_CODE = {
    '01':'AL','02':'AK','04':'AZ','05':'AR','06':'CA','08':'CO','09':'CT','10':'DE',
    '11':'DC','12':'FL','13':'GA','15':'HI','16':'ID','17':'IL','18':'IN','19':'IA',
    '20':'KS','21':'KY','22':'LA','23':'ME','24':'MD','25':'MA','26':'MI','27':'MN',
    '28':'MS','29':'MO','30':'MT','31':'NE','32':'NV','33':'NH','34':'NJ','35':'NM',
    '36':'NY','37':'NC','38':'ND','39':'OH','40':'OK','41':'OR','42':'PA','44':'RI',
    '45':'SC','46':'SD','47':'TN','48':'TX','49':'UT','50':'VT','51':'VA','53':'WA',
    '54':'WV','55':'WI','56':'WY'
  };

  // Tooltip element (one shared)
  let tooltip = document.querySelector('.map-tooltip');
  if (!tooltip) {
    tooltip = document.createElement('div');
    tooltip.className = 'map-tooltip';
    document.body.appendChild(tooltip);
  }

  // Prefer inline data (works from file://). Fall back to CDN fetch.
  if (window.US_TOPOJSON) {
    renderMap(window.US_TOPOJSON);
  } else {
    d3.json('https://cdn.jsdelivr.net/npm/us-atlas@3/states-albers-10m.json')
      .then(renderMap)
      .catch(() => {
        if (loading) loading.textContent = 'U.S. map could not be loaded.';
      });
  }

  function renderMap(us) {
      if (loading) loading.classList.add('hidden');

      const statesFeature = topojson.feature(us, us.objects.states);
      // states-albers-10m.json is pre-projected to a 975x610 viewport; identity geoPath is correct.
      const path = d3.geoPath();

      const svgD3 = d3.select(svg);
      svgD3.selectAll('*').remove();

      const g = svgD3.append('g').attr('class', 'states-layer');

      g.selectAll('path.state')
        .data(statesFeature.features)
        .enter()
        .append('path')
        .attr('class', 'state cat-none')
        .attr('d', path)
        .attr('data-code', (d) => FIPS_TO_CODE[String(d.id).padStart(2, '0')] || '')
        .attr('tabindex', 0)
        .attr('role', 'button')
        .on('click', function (event, d) {
          const code = FIPS_TO_CODE[String(d.id).padStart(2, '0')];
          if (code) showStateDetail(code, this);
        })
        .on('keydown', function (event, d) {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            const code = FIPS_TO_CODE[String(d.id).padStart(2, '0')];
            if (code) showStateDetail(code, this);
          }
        })
        .on('mousemove', function (event, d) {
          const code = FIPS_TO_CODE[String(d.id).padStart(2, '0')];
          if (!code) return;
          const enacted = STATE_YEAR[code];
          const showCat = (STATE_INFO[code] && (!enacted || enacted <= currentMapYear))
            ? STATE_INFO[code].cat : 'none';
          tooltip.innerHTML =
            `${STATE_NAMES[code] || code}<span class="tip-cat">${CAT_LABEL[showCat]}</span>`;
          tooltip.classList.add('visible');
          tooltip.style.left = (event.clientX + 12) + 'px';
          tooltip.style.top  = (event.clientY + 12) + 'px';
        })
        .on('mouseleave', () => {
          tooltip.classList.remove('visible');
        });

      // Initial paint to current year
      applyYearFilter(currentMapYear);
  }
}

// ============= TIMELINE SCRUBBER =============
const MAP_YEAR_MIN = 2020;
const MAP_YEAR_MAX = 2026;
let currentMapYear = MAP_YEAR_MAX;
let mapPlayTimer = null;

function applyYearFilter(year) {
  currentMapYear = year;
  const paths = document.querySelectorAll('#us-map-svg .state');
  paths.forEach((p) => {
    const code = p.getAttribute('data-code');
    let cat = 'none';
    if (code && STATE_INFO[code]) {
      const enacted = STATE_YEAR[code];
      if (!enacted || enacted <= year) cat = STATE_INFO[code].cat;
    }
    // remove existing cat-* classes
    p.classList.remove('cat-comp', 'cat-target', 'cat-trans', 'cat-pend', 'cat-none');
    p.classList.add('cat-' + cat);
  });
  // Update the readout
  const yEl = document.getElementById('map-year-readout');
  if (yEl) yEl.textContent = year;
  const sc = document.getElementById('map-year-scrub');
  if (sc && Number(sc.value) !== year) sc.value = String(year);
  // Live commentary: count enacted-by-this-year states per category
  const counts = { comp: 0, target: 0, trans: 0, pend: 0 };
  Object.keys(STATE_INFO).forEach((code) => {
    const enacted = STATE_YEAR[code];
    if (!enacted || enacted <= year) counts[STATE_INFO[code].cat]++;
  });
  const c = document.getElementById('map-year-counts');
  if (c) c.innerHTML =
    `<strong>${counts.comp}</strong> comprehensive \u00b7 ` +
    `<strong>${counts.target}</strong> targeted \u00b7 ` +
    `<strong>${counts.trans}</strong> transparency \u00b7 ` +
    `<strong>${counts.pend}</strong> pending`;
}

function playMapYears() {
  const btn = document.getElementById('map-year-play');
  if (mapPlayTimer) { stopMapYears(); return; }
  if (currentMapYear >= MAP_YEAR_MAX) applyYearFilter(MAP_YEAR_MIN);
  if (btn) btn.textContent = '\u23f8 Pause';
  mapPlayTimer = setInterval(() => {
    const next = currentMapYear + 1;
    if (next > MAP_YEAR_MAX) { stopMapYears(); return; }
    applyYearFilter(next);
  }, 850);
}

function stopMapYears() {
  if (mapPlayTimer) { clearInterval(mapPlayTimer); mapPlayTimer = null; }
  const btn = document.getElementById('map-year-play');
  if (btn) btn.textContent = '\u25b6 Play 2020 \u2192 2026';
}

function showStateDetail(code, cellEl) {
  const detail = document.getElementById('map-detail');
  if (!detail) return;
  // Clear selection on both old tile cells (legacy) and SVG paths
  document.querySelectorAll('.us-cell.selected, #us-map-svg .state.selected')
    .forEach(el => el.classList.remove('selected'));
  if (cellEl) cellEl.classList.add('selected');

  const info = STATE_INFO[code];
  const name = STATE_NAMES[code] || code;
  if (!info) {
    detail.innerHTML =
      `<div class="detail-head"><span class="detail-state">${name}</span>` +
      `<span class="detail-tag cat-none">${CAT_LABEL.none}</span></div>` +
      `<p class="detail-body">As of May 2026, ${name} has not enacted a law specifically requiring bias audits or impact assessments for AI hiring systems. Federal anti-discrimination law (Title VII of the Civil Rights Act) and EEOC guidance still apply, but there is no state-level AI-specific audit requirement.</p>` +
      `<p class="detail-source">Source: <a href="${NCSL_URL}" target="_blank" rel="noopener">${NCSL_LBL}</a></p>`;
    return;
  }
  detail.innerHTML =
    `<div class="detail-head"><span class="detail-state">${name}</span>` +
    `<span class="detail-tag cat-${info.cat}">${CAT_LABEL[info.cat]}</span></div>` +
    `<p class="detail-body">${info.body}</p>` +
    `<p class="detail-source">Source: <a href="${info.src.url}" target="_blank" rel="noopener">${info.src.label}</a></p>`;
}

document.addEventListener('DOMContentLoaded', buildUSMap);

document.addEventListener('DOMContentLoaded', () => {
  const scrub = document.getElementById('map-year-scrub');
  const play  = document.getElementById('map-year-play');
  if (!scrub) return;
  scrub.addEventListener('input', (e) => {
    stopMapYears();
    applyYearFilter(parseInt(e.target.value, 10));
  });
  play?.addEventListener('click', playMapYears);
  // Initialize readout/counts even before paint completes
  applyYearFilter(parseInt(scrub.value, 10));
});

/* ============= INTERACTIVE FEATURE-IMPORTANCE CHART ============= */
// Top-15 features by permutation importance from the trained HistGBM model.
// Values are the average drop in ROC-AUC when that feature column is shuffled
// (higher = the model relies on that feature more).
const FEATURE_IMPORTANCES = [
  { name: 'Years of experience',           value: 0.0312, desc: 'Total years of work experience listed on the resume.' },
  { name: 'Number of previous jobs',       value: 0.0241, desc: 'Count of distinct prior positions listed.' },
  { name: 'Resume quality (high vs low)',  value: 0.0198, desc: 'Whether Bertrand & Mullainathan classified the resume as a "high-quality" version.' },
  { name: 'City (Boston vs Chicago)',      value: 0.0176, desc: 'Which of the two cities the application was sent in.' },
  { name: 'Has college degree',            value: 0.0154, desc: 'Whether the resume lists a four-year college degree.' },
  { name: 'Min. experience required',      value: 0.0138, desc: 'Minimum years of experience demanded by the job ad.' },
  { name: 'Perceived race',                value: 0.0121, desc: 'Race signaled by the applicant\u2019s first name. Highlighted in red \u2014 even buried at #7 of 60, it still measurably moves predictions.', isRace: true },
  { name: 'Volunteering listed',           value: 0.0094, desc: 'Whether the resume includes volunteer experience.' },
  { name: 'Email contact provided',        value: 0.0081, desc: 'Whether the applicant gave an email vs phone-only.' },
  { name: 'Military service',              value: 0.0067, desc: 'Whether the resume mentions military experience.' },
  { name: 'Honors / awards listed',        value: 0.0058, desc: 'Whether the resume mentions academic or professional honors.' },
  { name: 'Computer-skills section',       value: 0.0049, desc: 'Whether the resume includes a dedicated computer/technical skills section.' },
  { name: 'Special-skills section',        value: 0.0041, desc: 'Whether the resume lists additional special skills (languages, certifications, etc.).' },
  { name: 'Worked during school',          value: 0.0033, desc: 'Whether the resume reports holding a job while in school.' },
  { name: 'Employment holes (gaps)',       value: 0.0027, desc: 'Whether the resume shows any unexplained gaps between jobs.' }
];

let featImpChartInstance = null;

function buildFeatImpChart(canvas, opts = {}) {
  if (typeof Chart === 'undefined') return null;
  const labels = FEATURE_IMPORTANCES.map(f => f.name);
  const values = FEATURE_IMPORTANCES.map(f => f.value);
  const colors = FEATURE_IMPORTANCES.map(f => f.isRace ? '#b04a3e' : '#4a7ba7');
  const borders = FEATURE_IMPORTANCES.map(f => f.isRace ? '#7a2c22' : '#34587a');

  return new Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Drop in ROC-AUC when feature is shuffled',
        data: values,
        backgroundColor: colors,
        borderColor: borders,
        borderWidth: 1,
        borderRadius: 4,
        borderSkipped: false
      }]
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: opts.animDuration ?? 900, easing: 'easeOutCubic' },
      plugins: {
        legend: { display: false },
        title: {
          display: true,
          text: 'Top 15 features by permutation importance (race = #7 of 60)',
          font: { size: opts.titleSize ?? 13, family: 'Helvetica Neue, sans-serif', weight: '600' },
          color: '#1f2933',
          padding: { bottom: 10 }
        },
        tooltip: {
          backgroundColor: '#141928',
          titleFont: { family: 'Helvetica Neue, sans-serif', size: 13, weight: '700' },
          bodyFont: { family: 'Helvetica Neue, sans-serif', size: 12 },
          padding: 10,
          callbacks: {
            title: (items) => FEATURE_IMPORTANCES[items[0].dataIndex].name,
            label: (ctx) => {
              const f = FEATURE_IMPORTANCES[ctx.dataIndex];
              const rank = ctx.dataIndex + 1;
              return [
                `Rank: #${rank} of 60`,
                `\u0394 ROC-AUC when shuffled: ${f.value.toFixed(4)}`
              ];
            },
            afterLabel: (ctx) => '\n' + FEATURE_IMPORTANCES[ctx.dataIndex].desc
          }
        }
      },
      scales: {
        x: {
          beginAtZero: true,
          title: {
            display: true,
            text: 'Drop in ROC-AUC when feature is shuffled',
            font: { family: 'Helvetica Neue, sans-serif', size: 11 },
            color: '#4a525e'
          },
          grid: { color: '#eee2d0' },
          ticks: { font: { family: 'Helvetica Neue, sans-serif', size: 10 } }
        },
        y: {
          grid: { display: false },
          ticks: {
            font: { family: 'Helvetica Neue, sans-serif', size: opts.yTickSize ?? 11 },
            color: (ctx) => FEATURE_IMPORTANCES[ctx.index]?.isRace ? '#8a2f25' : '#1f2933'
          }
        }
      }
    }
  });
}

function openChartModal() {
  // Build the modal
  const overlay = document.createElement('div');
  overlay.className = 'chart-modal';
  overlay.innerHTML = `
    <div class="chart-modal-inner" role="dialog" aria-modal="true" aria-label="Enlarged feature importance chart">
      <button class="chart-modal-close" aria-label="Close">&times;</button>
      <div class="chart-modal-title">Permutation feature importance — top 15 of 60 features</div>
      <div class="chart-modal-canvas"><canvas id="featImpChartLarge"></canvas></div>
    </div>`;
  document.body.appendChild(overlay);
  document.body.style.overflow = 'hidden';

  const close = () => {
    if (largeInst) largeInst.destroy();
    overlay.remove();
    document.body.style.overflow = '';
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });
  overlay.querySelector('.chart-modal-close').addEventListener('click', close);

  const largeCanvas = overlay.querySelector('#featImpChartLarge');
  const largeInst = buildFeatImpChart(largeCanvas, { titleSize: 16, yTickSize: 14, animDuration: 600 });
}

document.addEventListener('DOMContentLoaded', () => {
  const canvas = document.getElementById('featImpChart');
  const wrap = document.getElementById('featImpWrap');
  if (canvas) featImpChartInstance = buildFeatImpChart(canvas);
  if (wrap) {
    wrap.addEventListener('click', openChartModal);
    wrap.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openChartModal(); }
    });
  }
});

/* ============= U.S. RACIAL WEALTH GAP (animated) ============= */
// Median family wealth by race/ethnicity, in thousands of 2022 dollars.
// Source: U.S. Federal Reserve, Survey of Consumer Finances (2022 release).
// Triannual values 1989–2022, reported in Aladangady et al., "Changes in U.S.
// Family Finances from 2019 to 2022," Federal Reserve Bulletin, Oct 2023.
const WEALTH_YEARS = [1989,1992,1995,1998,2001,2004,2007,2010,2013,2016,2019,2022];
const WEALTH_DATA = {
  white:    [130.1,103.9,112.5,130.2,158.3,169.8,192.4,144.4,148.6,181.0,188.2,284.3],
  black:    [  9.2, 16.3, 19.0, 20.7, 24.6, 24.7, 27.0, 20.3, 14.7, 19.5, 24.1, 44.9],
  hispanic: [  9.8, 11.9, 19.9, 16.7, 22.7, 26.2, 30.7, 20.4, 17.0, 25.4, 36.2, 61.6]
};

let wealthChart = null;
let wealthPlayTimer = null;
let wealthIdx = WEALTH_YEARS.length - 1; // start fully drawn

function buildWealthChart() {
  const canvas = document.getElementById('wealthChart');
  if (!canvas || typeof Chart === 'undefined') return;

  // Helper: data up to and including current index, rest as null so the line stops there.
  const sliceTo = (arr, idx) => arr.map((v, i) => i <= idx ? v : null);

  wealthChart = new Chart(canvas, {
    type: 'line',
    data: {
      labels: WEALTH_YEARS,
      datasets: [
        {
          label: 'White families',
          data: sliceTo(WEALTH_DATA.white, wealthIdx),
          borderColor: '#4a7ba7',
          backgroundColor: 'rgba(74,123,167,0.10)',
          borderWidth: 2.2,
          tension: 0.28,
          pointRadius: 3,
          pointHoverRadius: 6,
          fill: false,
          spanGaps: false
        },
        {
          label: 'Hispanic families',
          data: sliceTo(WEALTH_DATA.hispanic, wealthIdx),
          borderColor: '#d97757',
          backgroundColor: 'rgba(217,119,87,0.10)',
          borderWidth: 2.2,
          tension: 0.28,
          pointRadius: 3,
          pointHoverRadius: 6,
          fill: false,
          spanGaps: false
        },
        {
          label: 'Black families',
          data: sliceTo(WEALTH_DATA.black, wealthIdx),
          borderColor: '#8a2f25',
          backgroundColor: 'rgba(138,47,37,0.10)',
          borderWidth: 2.2,
          tension: 0.28,
          pointRadius: 3,
          pointHoverRadius: 6,
          fill: false,
          spanGaps: false
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 300, easing: 'easeOutCubic' },
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: {
          position: 'top',
          align: 'end',
          labels: {
            font: { family: 'Helvetica Neue, sans-serif', size: 11 },
            boxWidth: 12,
            boxHeight: 12,
            usePointStyle: true,
            pointStyle: 'rectRounded',
            color: '#1f2933'
          }
        },
        tooltip: {
          backgroundColor: '#1f2933',
          titleFont: { family: 'Helvetica Neue, sans-serif', size: 12, weight: '700' },
          bodyFont: { family: 'Helvetica Neue, sans-serif', size: 11 },
          padding: 8,
          callbacks: {
            label: (ctx) => `${ctx.dataset.label}: $${(ctx.parsed.y).toFixed(1)}k`
          }
        }
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { font: { family: 'Helvetica Neue, sans-serif', size: 10 }, color: '#6b7280' }
        },
        y: {
          beginAtZero: true,
          title: {
            display: true,
            text: 'Median family wealth (thousands of 2022 $)',
            font: { family: 'Helvetica Neue, sans-serif', size: 11 },
            color: '#4a525e'
          },
          grid: { color: '#f0e8d6' },
          ticks: {
            font: { family: 'Helvetica Neue, sans-serif', size: 10 },
            color: '#6b7280',
            callback: (v) => '$' + v + 'k'
          }
        }
      }
    }
  });
}

function updateWealthChart(idx) {
  if (!wealthChart) return;
  wealthIdx = idx;
  const sliceTo = (arr) => arr.map((v, i) => i <= idx ? v : null);
  wealthChart.data.datasets[0].data = sliceTo(WEALTH_DATA.white);
  wealthChart.data.datasets[1].data = sliceTo(WEALTH_DATA.hispanic);
  wealthChart.data.datasets[2].data = sliceTo(WEALTH_DATA.black);
  wealthChart.update('none'); // skip animation between frames during playback

  const year = WEALTH_YEARS[idx];
  const w = WEALTH_DATA.white[idx];
  const b = WEALTH_DATA.black[idx];
  const ratio = (w / b).toFixed(1);
  const yEl = document.getElementById('wr-year');
  const sEl = document.getElementById('wr-stat');
  if (yEl) yEl.textContent = year;
  if (sEl) sEl.innerHTML =
    `White families hold <strong>${ratio}\u00d7</strong> the wealth of Black families ` +
    `($${w.toFixed(0)}k vs $${b.toFixed(1)}k)`;
  const sc = document.getElementById('wealth-scrub');
  if (sc && Number(sc.value) !== idx) sc.value = String(idx);
}

function playWealth() {
  const btn = document.getElementById('wealth-play');
  if (wealthPlayTimer) { stopWealth(); return; }
  // If we're at the end, restart
  if (wealthIdx >= WEALTH_YEARS.length - 1) {
    updateWealthChart(0);
  }
  if (btn) btn.textContent = '\u23f8 Pause';
  wealthPlayTimer = setInterval(() => {
    const next = wealthIdx + 1;
    if (next >= WEALTH_YEARS.length) {
      stopWealth();
      return;
    }
    updateWealthChart(next);
  }, 650);
}

function stopWealth() {
  if (wealthPlayTimer) {
    clearInterval(wealthPlayTimer);
    wealthPlayTimer = null;
  }
  const btn = document.getElementById('wealth-play');
  if (btn) btn.textContent = '\u25b6 Play';
}

function resetWealth() {
  stopWealth();
  updateWealthChart(WEALTH_YEARS.length - 1);
}

document.addEventListener('DOMContentLoaded', () => {
  if (!document.getElementById('wealthChart')) return;
  buildWealthChart();
  updateWealthChart(WEALTH_YEARS.length - 1);

  document.getElementById('wealth-play')?.addEventListener('click', playWealth);
  document.getElementById('wealth-reset')?.addEventListener('click', resetWealth);
  document.getElementById('wealth-scrub')?.addEventListener('input', (e) => {
    stopWealth();
    updateWealthChart(parseInt(e.target.value, 10));
  });
});

/* ============= GLOSSARY TOOLTIPS ============= */
// Defines technical terms that get a dotted underline + hover definition.
// Order matters: longer phrases first so "ROC-AUC" wins over "AUC", etc.
const GLOSSARY = [
  ['stochastic weight averaging', 'A training trick that averages the model\u2019s weights from the last several training epochs, which smooths out random fluctuations and usually generalizes better.'],
  ['k-fold cross-validation',     'A method that splits the training data into k equal chunks, training k times so every chunk is used as a held-out test set once, giving a more reliable performance estimate.'],
  ['gradient boosted trees',      'A machine-learning method that builds many small decision trees one after another, where each new tree tries to fix the errors of the previous ones.'],
  ['permutation importance',      'A way to measure how much a model relies on a feature by randomly shuffling that column and seeing how much the model\u2019s accuracy drops.'],
  ['confusion matrix',            'A 2\u00d72 table that shows how many predictions a classifier got right vs. wrong, broken down into true positives, false positives, true negatives, and false negatives.'],
  ['calibrated probabilities',    'Probability outputs that have been adjusted so that, e.g., events the model predicts at 70% actually happen about 70% of the time.'],
  ['disparate impact',            'A legal concept where a policy or system that looks neutral on its face still produces significantly worse outcomes for a protected group.'],
  ['algorithmic discrimination',  'Unfair treatment of a person or group that arises from an automated decision system, even when no one explicitly programs it to discriminate.'],
  ['training dataset',            'The historical examples a machine-learning model studies to learn patterns; biases in this data become biases in the model.'],
  ['supervised learning',         'Machine learning where the model is shown many examples with the correct answer attached and learns to predict that answer on new data.'],
  ['machine learning',            'A field of AI in which computers learn patterns from past data instead of being given explicit step-by-step instructions.'],
  ['neural network',              'A machine-learning model built from many interconnected mathematical \u201cneurons\u201d arranged in layers, loosely inspired by the brain.'],
  ['label noise',                 'Errors or inconsistencies in the correct answers used to train a model \u2014 a hard ceiling on how accurate any model can ever be.'],
  ['Title VII',                   'The part of the U.S. Civil Rights Act of 1964 that prohibits employment discrimination on the basis of race, color, religion, sex, or national origin.'],
  ['ROC-AUC',                     'A score from 0.5 (random) to 1.0 (perfect) that measures how well a model separates positive from negative cases across every possible decision threshold.'],
  ['AEDT',                        'Automated Employment Decision Tool \u2014 the legal term New York City\u2019s Local Law 144 uses for any AI system that helps make hiring decisions.'],
  ['AUC',                         'Area Under the (ROC) Curve \u2014 a 0.5\u20131.0 score for how well a classifier ranks positives above negatives.'],
  ['F1 score',                    'The harmonic mean of precision and recall; a single number balancing how often the model is right with how many true positives it catches.'],
  ['ensemble',                    'A group of models whose predictions are combined (averaged or voted) to produce a result that is usually more accurate than any single model alone.'],
  ['mixup',                       'A data-augmentation trick that trains on weighted averages of pairs of examples, which helps prevent overfitting.'],
  ['audit',                       'An independent review that measures whether an AI system\u2019s outputs are biased against any protected group.']
];

function applyGlossary() {
  // Sections in which to auto-tag terms
  const targets = ['story','issue','effects','causes','research','solutions','conclusion'];
  // Tags to skip entirely when walking text nodes
  const SKIP = new Set(['A','SUP','BUTTON','SELECT','OPTION','CODE','SCRIPT','STYLE','CANVAS','SVG','H1','H2','LABEL','TEXTAREA','INPUT']);

  const used = new Set(); // first-occurrence-only per term

  targets.forEach((id) => {
    const root = document.getElementById(id);
    if (!root) return;
    GLOSSARY.forEach(([term, def]) => {
      if (used.has(term)) return;
      // Word-boundary, case-insensitive, allow internal hyphens by escaping properly.
      const safe = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp('\\b' + safe + '\\b', 'i');

      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode: (node) => {
          if (!node.nodeValue || !re.test(node.nodeValue)) return NodeFilter.FILTER_REJECT;
          let p = node.parentNode;
          while (p && p !== root) {
            if (SKIP.has(p.nodeName)) return NodeFilter.FILTER_REJECT;
            if (p.classList && p.classList.contains('glossary')) return NodeFilter.FILTER_REJECT;
            p = p.parentNode;
          }
          return NodeFilter.FILTER_ACCEPT;
        }
      });

      const node = walker.nextNode();
      if (!node) return;
      const text = node.nodeValue;
      const m = text.match(re);
      if (!m) return;
      const before = text.slice(0, m.index);
      const match  = text.slice(m.index, m.index + m[0].length);
      const after  = text.slice(m.index + m[0].length);

      const span = document.createElement('span');
      span.className = 'glossary';
      span.setAttribute('tabindex', '0');
      span.setAttribute('data-def', def);
      span.textContent = match;

      const parent = node.parentNode;
      if (before) parent.insertBefore(document.createTextNode(before), node);
      parent.insertBefore(span, node);
      if (after)  parent.insertBefore(document.createTextNode(after), node);
      parent.removeChild(node);

      used.add(term);
    });
  });
}

document.addEventListener('DOMContentLoaded', applyGlossary);

/* ============= FIGURE 3 · ADOPTION GROWTH CHART ============= */
const ADOPT_YEARS = [2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026];
const ADOPT_PCT   = [  30,   35,   42,   47,   51,   58,   68,   73];
let adoptionChart = null;
let adoptionAnimTimer = null;
const ADOPT_STEP_MS = 650;   // time between revealed years

function buildAdoptionChart() {
  const canvas = document.getElementById('adoptionChart');
  if (!canvas || typeof Chart === 'undefined') return;
  // Start fully drawn — all points visible. The Replay button animates
  // the line growing from 2019 to 2026 on demand.
  adoptionChart = new Chart(canvas, {
    type: 'line',
    data: {
      labels: ADOPT_YEARS,
      datasets: [{
        label: 'Adoption %',
        data: ADOPT_PCT.slice(),
        borderColor: '#8a2f25',
        backgroundColor: 'rgba(217, 119, 87, 0.18)',
        borderWidth: 2.5,
        fill: true,
        tension: 0.35,
        pointRadius: 4,
        pointBackgroundColor: '#8a2f25',
        pointBorderColor: '#fffdf9',
        pointBorderWidth: 1.5,
        spanGaps: false
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: ADOPT_STEP_MS - 50, easing: 'easeOutCubic' },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: { label: (ctx) => ctx.parsed.y + '% of employers' }
        }
      },
      scales: {
        y: {
          min: 0, max: 100,
          ticks: { callback: (v) => v + '%', color: '#4a525e', font: { family: 'Helvetica Neue' } },
          grid: { color: 'rgba(0,0,0,0.05)' }
        },
        x: {
          ticks: { color: '#4a525e', font: { family: 'Helvetica Neue' } },
          grid: { display: false }
        }
      }
    }
  });
}

function setAdoptionReadout(i) {
  const numEl = document.getElementById('adoption-num');
  const yrEl  = document.getElementById('adoption-year');
  if (numEl) numEl.textContent = ADOPT_PCT[i] + '%';
  if (yrEl)  yrEl.textContent  = ADOPT_YEARS[i];
}

function stopAdoption() {
  if (adoptionAnimTimer) { clearInterval(adoptionAnimTimer); adoptionAnimTimer = null; }
  const btn = document.getElementById('adoption-play');
  if (btn) btn.textContent = '\u25b6 Replay growth';
}

function replayAdoption() {
  if (!adoptionChart) return;
  // If already running, treat as pause/stop
  if (adoptionAnimTimer) { stopAdoption(); return; }

  // Reset: only the first point is visible
  const data = adoptionChart.data.datasets[0].data;
  data[0] = ADOPT_PCT[0];
  for (let k = 1; k < data.length; k++) data[k] = null;
  adoptionChart.update('none');   // jump back without animation
  setAdoptionReadout(0);

  const btn = document.getElementById('adoption-play');
  if (btn) btn.textContent = '\u23f8 Pause';

  let i = 1;
  adoptionAnimTimer = setInterval(() => {
    if (i >= ADOPT_YEARS.length) {
      stopAdoption();
      return;
    }
    // Seed the new point at the *previous* point's value so the segment
    // grows continuously out of the existing line rather than rising from
    // the x-axis baseline.
    data[i] = data[i - 1];
    adoptionChart.update('none');
    data[i] = ADOPT_PCT[i];
    adoptionChart.update();   // animated grow from prev value to target
    setAdoptionReadout(i);
    i++;
  }, ADOPT_STEP_MS);
}

document.addEventListener('DOMContentLoaded', () => {
  if (!document.getElementById('adoptionChart')) return;
  buildAdoptionChart();
  setAdoptionReadout(ADOPT_PCT.length - 1);   // show final 73% / 2026
  document.getElementById('adoption-play')?.addEventListener('click', replayAdoption);
});

/* ============= FIGURE 4 · DATASET REPRESENTATION PIE =============
   Source: U.S. Equal Employment Opportunity Commission, 2022 EEO-1
   Aggregate Data Tables (most-recent fully released filing year, covering
   ~62.5 million U.S. private-sector employees). This is the demographic
   distribution that any corporation training an AI hiring tool on its own
   internal hire records will be fitting against. */
const REP_DATA = [
  { label: 'White',                    pct: 60.2, n: 37625000, color: '#8a2f25' },
  { label: 'Hispanic or Latino',       pct: 19.4, n: 12125000, color: '#d97757' },
  { label: 'Black or African American',pct: 13.4, n:  8375000, color: '#e7b76b' },
  { label: 'Asian',                    pct:  6.4, n:  4000000, color: '#b8c8d4' },
  { label: 'Other / Two or more',      pct:  0.6, n:   375000, color: '#ece4d4' }
];

function buildRepChart() {
  const canvas = document.getElementById('repChart');
  if (!canvas || typeof Chart === 'undefined') return;
  new Chart(canvas, {
    type: 'doughnut',
    data: {
      labels: REP_DATA.map((d) => d.label),
      datasets: [{
        data: REP_DATA.map((d) => d.pct),
        backgroundColor: REP_DATA.map((d) => d.color),
        borderColor: '#fffdf9',
        borderWidth: 2,
        hoverOffset: 8
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '55%',
      animation: { duration: 900, easing: 'easeOutCubic' },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const d = REP_DATA[ctx.dataIndex];
              return d.label + ': ' + d.pct + '%  (' + d.n.toLocaleString() + ' records)';
            }
          }
        }
      }
    }
  });

  // Build a custom legend with counts so the message reads at a glance.
  const lg = document.getElementById('repLegend');
  if (lg) {
    lg.innerHTML = REP_DATA.map((d) => (
      '<div class="rep-lgd-row">' +
        '<span class="rep-lgd-sw" style="background:' + d.color + '"></span>' +
        '<span class="rep-lgd-lbl">' + d.label + '</span>' +
        '<span class="rep-lgd-pct">' + d.pct + '%</span>' +
        '<span class="rep-lgd-n">' + d.n.toLocaleString() + '</span>' +
      '</div>'
    )).join('');
  }
}

document.addEventListener('DOMContentLoaded', buildRepChart);


/* ============= FIGURE 5 · BIAS MIRROR SIM ============= */
// Model: starting from a balanced baseline (45% callback for everyone), the
// model's preference shifts in proportion to the (skew/50)^0.9 ratio of each
// group's representation in the training set. Result echoes — and slightly
// amplifies — the historical imbalance, mirroring real-world findings.
function updateMirror(skew) {
  const white   = skew;
  const black   = 100 - skew;
  const base    = 45;
  // Amplification exponent: real audits typically show a multiplicative
  // (not additive) gap, so use a power curve.
  const whiteRate = Math.min(94, Math.round(base * Math.pow(white / 50, 0.9)));
  const blackRate = Math.max(2,  Math.round(base * Math.pow(black / 50, 0.9)));
  const ratio     = blackRate > 0 ? (whiteRate / blackRate) : Infinity;

  // Training-data bar
  const tw = document.getElementById('train-white');
  const tb = document.getElementById('train-black');
  if (tw) { tw.style.width = white + '%'; tw.querySelector('span').textContent = 'White ' + white + '%'; }
  if (tb) { tb.style.width = black + '%'; tb.querySelector('span').textContent = 'Black ' + black + '%'; }

  // Prediction bars
  const pw = document.getElementById('pred-white');
  const pb = document.getElementById('pred-black');
  if (pw) pw.style.width = whiteRate + '%';
  if (pb) pb.style.width = blackRate + '%';
  document.getElementById('pred-white-pct').textContent = whiteRate + '%';
  document.getElementById('pred-black-pct').textContent = blackRate + '%';

  // Readout & note
  const rd = document.getElementById('mirror-readout');
  if (rd) rd.innerHTML = white + '% White&nbsp;\u00b7&nbsp;' + black + '% Black';
  const note = document.getElementById('mirror-note');
  if (note) {
    const r = isFinite(ratio) ? ratio.toFixed(1) : '\u221e';
    note.innerHTML = 'White applicants are called back <strong>' + r + '\u00d7</strong> as often as Black applicants \u2014 ' +
      'even though race is <em>never</em> given to the model as an input feature. It is inherited from the data.';
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const s = document.getElementById('mirror-skew');
  if (!s) return;
  s.addEventListener('input', (e) => updateMirror(parseInt(e.target.value, 10)));
  updateMirror(parseInt(s.value, 10));
});

/* ============= FIGURE 6 · HISTORICAL TIMELINE ============= */
const TIMELINE_EVENTS = [
  { year: 1865, label: '13th Amend.',
    title: 'Slavery abolished — but no economic restitution',
    body: 'Emancipation freed roughly four million people without land, capital, or wages. Promised "forty acres and a mule" was revoked within months. The wealth gap created by 246 years of unpaid labor became the starting point for every subsequent labor-market dataset.' },
  { year: 1877, label: 'End of Reconstruction',
    title: 'The Compromise of 1877 abandons Black Americans to the Jim Crow South',
    body: 'To resolve the disputed Hayes–Tilden election, federal troops are withdrawn from the South. Within a decade, Black voters are purged from the rolls, sharecropping replaces slavery in everything but name, and Black Codes criminalize unemployment so Black men can be leased back to former plantations as convict labor. A century of "free-market" labor data is generated under conditions of state-enforced coercion.' },
  { year: 1896, label: 'Plessy v. Ferguson',
    title: '"Separate but equal" legalizes segregation in every workplace',
    body: 'The Supreme Court rules racial segregation constitutional. For the next 58 years, Black workers are barred by law from most skilled trades, white-collar offices, and unions in the South — and excluded by custom almost everywhere else. The "job history" feature that modern AI weighs so heavily was, for Black Americans, legally restricted to menial work.' },
  { year: 1921, label: 'Tulsa Massacre',
    title: 'The destruction of Black Wall Street',
    body: 'A white mob burns the Greenwood district of Tulsa, Oklahoma — the wealthiest Black community in America — killing as many as 300 people and destroying 1,200 homes, 60 businesses, a hospital, and two newspapers. No insurance claims are paid. Tulsa is the most famous of dozens of such attacks (Wilmington 1898, Atlanta 1906, Chicago 1919, Rosewood 1923) that systematically erased Black-accumulated capital before the redlining era even began.' },
  { year: 1934, label: 'Redlining',
    title: 'FHA redlining locks Black families out of home equity',
    body: 'The Federal Housing Administration refuses to insure mortgages in Black neighborhoods — color-coding them red on official maps — blocking the single biggest source of middle-class wealth in 20th-century America. Decades later, "ZIP code" is one of the most predictive proxies that AI hiring tools learn to use.' },
  { year: 1964, label: 'Civil Rights Act',
    title: 'Title VII bans employment discrimination — but enforcement lags',
    body: 'Title VII makes hiring discrimination illegal, but the EEOC is understaffed for decades and most disparate-impact cases never reach court. Hiring records from 1964–2000 still carry the imprint of pre-Act practices — and those records are what AI is trained on.' },
  { year: 1968, label: 'Fair Housing Act', labelDx: -26,
    title: 'Segregation outlawed on paper, persists in practice',
    body: 'The Fair Housing Act passes a week after Dr. King is assassinated, but residential segregation barely budges. The geographic features (commute distance, neighborhood prestige) that AI tools later mine are direct descendants of this segregation.' },
  { year: 1989, label: 'Wealth gap',
    title: 'Median white family holds 7\u00d7 the wealth of median Black family',
    body: 'The first reliable Survey of Consumer Finances measurement shows a 7-to-1 wealth gap — a direct fiscal echo of 1865, 1877, 1921, and 1934. That gap predicts everything from college attendance to unpaid-internship eligibility — features AI models treat as merit signals.' },
  { year: 2008, label: 'Great Recession',
    title: 'Black households lose 53% of wealth vs. 16% for white households',
    body: 'Subprime lending was steered disproportionately into Black and Hispanic neighborhoods. The crisis widened the racial wealth gap by a generation — and that recovery period (2008–2018) is the prime source of the resume data on which most modern hiring AI was trained.' },
  { year: 2018, label: 'AI hiring boom',
    title: 'Resume-screening AI trained on decades of biased records',
    body: 'Amazon scraps an internal AI recruiting tool after discovering it down-ranks resumes containing the word "women\u2019s." The model wasn\u2019t malicious — it had learned, correctly, that its training data favored men. The same pattern operates on race through proxies like ZIP code, school name, and employment gaps.' },
  { year: 2026, label: 'Today',
    title: '73% of large U.S. employers use AI hiring tools',
    body: 'The pipeline is complete: 161 years of legal exclusion, mob violence, redlining, and uneven enforcement produced biased records; those records trained biased models; and those models now make hiring decisions at scale. Without intervention, the loop reinforces itself.' }
];

function buildTimeline() {
  const track = document.getElementById('timeline-dots');
  const detail = document.getElementById('timeline-detail');
  if (!track || !detail) return;

  const yMin = 1865, yMax = 2026;
  const frag = document.createDocumentFragment();

  TIMELINE_EVENTS.forEach((ev, idx) => {
    const pct = ((ev.year - yMin) / (yMax - yMin)) * 100;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'timeline-dot ' + (idx % 2 === 0 ? 'pos-bot' : 'pos-top');
    btn.style.left = pct + '%';
    btn.setAttribute('data-idx', idx);
    btn.setAttribute('aria-label', ev.year + ' — ' + ev.title);
    btn.innerHTML =
      '<span class="td-dot"></span>' +
      '<span class="td-stem"></span>' +
      '<span class="td-label"' + (ev.labelDx ? ' style="margin-left:' + ev.labelDx + 'px"' : '') + '>' + ev.label + '<br><em>' + ev.year + '</em></span>';
    btn.addEventListener('click', () => showTimelineEvent(idx));
    frag.appendChild(btn);
  });
  track.appendChild(frag);
}

function showTimelineEvent(idx) {
  const ev = TIMELINE_EVENTS[idx];
  if (!ev) return;
  const detail = document.getElementById('timeline-detail');
  if (!detail) return;
  detail.innerHTML =
    '<div class="td-head"><span class="td-year">' + ev.year + '</span>' +
    '<span class="td-title">' + ev.title + '</span></div>' +
    '<p class="td-body">' + ev.body + '</p>';
  // Mark active dot
  document.querySelectorAll('.timeline-dot').forEach((d, i) => {
    d.classList.toggle('active', i === idx);
  });
}

document.addEventListener('DOMContentLoaded', buildTimeline);

/* ============= SECTION REVEALS =============
   Fade + slide each <section> in the first time it enters the viewport.
   Bails out gracefully if IntersectionObserver isn't supported. */
document.addEventListener('DOMContentLoaded', () => {
  const targets = document.querySelectorAll('section.section');
  if (!targets.length) return;

  // No-IO fallback: just show everything.
  if (typeof IntersectionObserver === 'undefined') {
    targets.forEach((s) => s.classList.add('reveal', 'is-visible'));
    return;
  }

  targets.forEach((s) => s.classList.add('reveal'));

  const io = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add('is-visible');
        io.unobserve(entry.target); // one-shot
      }
    });
  }, {
    root: null,
    threshold: 0.12,
    rootMargin: '0px 0px -8% 0px'
  });

  targets.forEach((s) => io.observe(s));

  // If the page loads scrolled to an anchor, reveal anything already in view.
  requestAnimationFrame(() => {
    targets.forEach((s) => {
      const r = s.getBoundingClientRect();
      if (r.top < window.innerHeight && r.bottom > 0) {
        s.classList.add('is-visible');
        io.unobserve(s);
      }
    });
  });
});

