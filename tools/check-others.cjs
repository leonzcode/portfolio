const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const ts = require("typescript");

let puppeteer;
try { puppeteer = require("puppeteer"); }
catch { puppeteer = require(path.join(process.env.APPDATA, "npm", "node_modules", "puppeteer")); }

const root = path.resolve(__dirname, "..");
const base = process.argv[2] || "http://127.0.0.1:4321";
const output = path.join(os.tmpdir(), "codex-others-qa");
fs.mkdirSync(output, { recursive: true });

async function main() {
  const loadProjects = async (code) => {
    const output = ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText;
    return import(`data:text/javascript;base64,${Buffer.from(output).toString("base64")}`);
  };
  const { otherProjects } = await loadProjects(fs.readFileSync(path.join(root, "src/data/projects.ts"), "utf8"));
  const original = execFileSync("git", ["show", "HEAD:src/data/projects.ts"], { cwd: root, encoding: "utf8" });
  const { otherProjects: previous } = await loadProjects(original);
  const withoutDetail = ({ detailHref, ...project }) => project;
  assert.deepEqual(otherProjects.map(withoutDetail), previous.map(withoutDetail), "Existing project data must not be lost or rewritten");
  const count = otherProjects.length;
  for (const project of otherProjects) {
    const url = project.localHref ?? project.href;
    const file = `public${url}${url.endsWith("/") ? "index.html" : ""}`;
    const contents = fs.readFileSync(path.join(root, file), "utf8").replace(/\r\n/g, "\n");
    const before = execFileSync("git", ["show", `HEAD:${file}`], { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).replace(/\r\n/g, "\n");
    const tag = `<script defer src="/others/presence.js?v=1" data-project="${project.slug}"></script>\n`;
    assert(contents.includes(tag), `Presence tracker missing: ${project.slug}`);
    assert.equal(contents.replace(tag, "").trimEnd(), before.replace(tag, "").trimEnd(), `Unexpected implementation changes: ${project.slug}`);
  }
  const browser = await puppeteer.launch({ headless: true });
  const failures = [];
  let textEdits = {};
  let orderEdits = {};
  let suggestionFails = true;
  let statsFail = false;
  let onlineFails = false;
  let onlineCount = 4;
  let presenceRequests = 0;
  let suggestionRequests = 0;

  try {
    const page = await browser.newPage();
    page.setDefaultNavigationTimeout(60000);
    page.on("pageerror", (error) => failures.push(error.message));
    await page.setRequestInterception(true);
    page.on("request", (request) => {
      if (request.url().startsWith("https://apps.leonzhao.dev/mc/site/stats")) {
        if (statsFail) { request.abort("failed"); return; }
        const stats = Object.fromEntries(otherProjects.map((project) => [project.socialKey, { views: 42, likes: 3 }]));
        request.respond({ status: 200, contentType: "application/json", headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify({ stats, text: textEdits, order: orderEdits }) });
      } else if (request.url().startsWith("https://apps.leonzhao.dev/mc/site/online")) {
        request.respond({ status: onlineFails ? 503 : 200, contentType: "application/json", headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify(onlineFails ? { error: "Unavailable" } : { counts: Object.fromEntries(otherProjects.map((project) => [project.slug, onlineCount])) }) });
      } else if (request.url().startsWith("https://apps.leonzhao.dev/mc/site/presence")) {
        presenceRequests++;
        request.respond({ status: 200, contentType: "application/json", headers: { "Access-Control-Allow-Origin": "*" }, body: '{"ok":true}' });
      } else if (request.url() === new URL("/api/suggest", base).href) {
        suggestionRequests++;
        const body = JSON.parse(request.postData());
        assert.equal(body.message, "A museum of clouds");
        assert.equal(body.email, "reader@example.com");
        assert.equal(body.website, "");
        request.respond({ status: suggestionFails ? 503 : 200, contentType: "application/json", body: JSON.stringify(suggestionFails ? { error: "Please try again shortly." } : { ok: true }) });
      } else request.continue();
    });

    await page.setViewport({ width: 1440, height: 1000 });
    await page.goto(`${base}/others`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => document.querySelector("[data-others-stats]:not([hidden])"));
    await page.waitForFunction(() => [...document.querySelectorAll("[data-online-value]")].every((el) => el.textContent === "4 online"));
    assert.equal(await page.$$eval("[data-project-online]", (items) => items.length), count);
    assert.equal(presenceRequests, 0, "The catalogue must not register as an active project");
    assert.equal(await page.$$eval("[data-others-item]", (cards) => cards.length), count);
    assert.equal(await page.$eval('nav a[aria-current="page"]', (a) => a.getAttribute("href")), "/others");
    assert.equal(await page.$$eval("[data-others-item]:not([hidden])", (cards) => cards.length), count);
    assert.equal(await page.$eval("[data-others-count]", (el) => el.textContent.trim()), `${count} projects`);
    console.log(`Catalogue: ${count} original projects retained.`);

    const routes = await page.evaluate(async (projects) => {
      const results = [];
      for (const project of projects) {
        const response = await fetch(project.detailHref);
        const doc = new DOMParser().parseFromString(await response.text(), "text/html");
        results.push({ slug: project.slug, status: response.status, iframe: doc.querySelector("iframe")?.getAttribute("src"), back: doc.querySelector('a[href="/others"]') !== null });
      }
      return results;
    }, otherProjects);
    for (const route of routes) {
      const project = otherProjects.find((p) => p.slug === route.slug);
      assert.equal(route.status, 200, route.slug);
      const implementation = project.localHref ?? project.href;
      const acceptedSources = implementation.endsWith("/") ? [implementation, `${implementation}index.html`] : [implementation];
      assert(acceptedSources.includes(route.iframe), `Implementation changed: ${route.slug}`);
      assert.equal(route.back, true, route.slug);
      const asset = await fetch(new URL(route.iframe, base), { signal: AbortSignal.timeout(10000) });
      assert.equal(asset.status, 200, `Implementation missing: ${route.slug}`);
      await asset.body?.cancel();
    }

    for (const prefix of ["edu", "games"]) {
      const response = await fetch(`${base}/${prefix}`, { redirect: "manual" });
      assert.equal(response.status, 404, `Retired route still exists: ${prefix}`);
      assert.equal(response.headers.get("location"), null);
      for (const project of otherProjects) {
        for (const slug of new Set([project.slug, project.urlSlug ?? project.slug])) {
          const redirected = await fetch(`${base}/${prefix}/${slug}`, { redirect: "manual" });
          assert.equal(redirected.status, 404, `${prefix}/${slug}`);
          assert.equal(redirected.headers.get("location"), null);
        }
      }
    }
    const redirectRules = fs.readFileSync(path.join(root, "public/_redirects"), "utf8");
    assert(!/^\/(?:edu|games)(?:\/|\s)/m.test(redirectRules), "Retired routes must not redirect");
    console.log("All detail pages, implementation URLs, and retired-route 404s verified.");

    await page.evaluate(() => document.querySelectorAll(".project-image img").forEach((img) => img.loading = "eager"));
    await page.waitForFunction(() => [...document.querySelectorAll(".project-image img")].every((img) => img.complete && img.naturalWidth > 0));
    await page.screenshot({ path: path.join(output, "desktop.png"), fullPage: true });
    await page.screenshot({ path: path.join(output, "desktop-top.png"), fullPage: false });
    await page.type("[data-others-search]", "CoCoNuT Simulator");
    assert.equal(await page.$$eval("[data-others-item]:not([hidden])", (cards) => cards.length), 1);
    await page.$eval("[data-others-search]", (input) => { input.value = "no-such-project-xyz"; input.dispatchEvent(new Event("input")); });
    assert.equal(await page.$eval("[data-others-empty]", (el) => el.hidden), false);
    await page.click("[data-others-reset]");
    assert.equal(await page.$$eval("[data-others-item]:not([hidden])", (cards) => cards.length), count);
    await page.select("[data-others-sort]", "title");
    const titles = await page.$$eval("[data-others-item] h2", (items) => items.map((item) => item.textContent.trim()));
    assert.deepEqual(titles, titles.slice().sort(new Intl.Collator(undefined, { numeric: true, sensitivity: "base" }).compare));
    await page.select("[data-others-sort]", "featured");
    assert.deepEqual(await page.$$eval("[data-others-item]", (items) => items.map((item) => item.dataset.key)), otherProjects.map((p) => p.socialKey));

    await page.click("[data-others-suggestion] summary");
    await page.click("[data-others-send]");
    assert.equal(suggestionRequests, 0, "An empty suggestion must not be sent");
    await page.type("#others-message", "A museum of clouds");
    await page.type("#others-email", "invalid-email");
    await page.click("[data-others-send]");
    assert.equal(suggestionRequests, 0, "An invalid email must not be sent");
    await page.$eval("#others-email", (input) => input.value = "");
    await page.type("#others-email", "reader@example.com");
    await page.click("[data-others-send]");
    await page.waitForFunction(() => document.querySelector('[data-others-form-status][data-state="error"]:not([hidden])'));
    assert.equal(await page.$eval("#others-message", (input) => input.value), "A museum of clouds");
    suggestionFails = false;
    await page.click("[data-others-send]");
    await page.waitForFunction(() => document.querySelector('[data-others-form-status][data-state="success"]:not([hidden])'));
    assert.equal(await page.$eval("[data-others-form]", (form) => form.hidden), true);
    await page.click("[data-others-another]");
    assert.equal(await page.$eval("#others-message", (input) => input.value), "");
    assert.equal(suggestionRequests, 2);
    await page.click("[data-others-suggestion] summary");

    for (const width of [768, 390, 320]) {
      await page.setViewport({ width, height: 900 });
      await page.evaluate(() => window.scrollTo(0, 0));
      const overflow = await page.evaluate(() => ({ page: document.documentElement.scrollWidth, viewport: innerWidth }));
      assert(overflow.page <= overflow.viewport, `Horizontal overflow at ${width}: ${JSON.stringify(overflow)}`);
      if (width === 390) await page.screenshot({ path: path.join(output, "mobile.png"), fullPage: false });
    }
    await page.setViewport({ width: 1440, height: 1000 });
    await page.evaluate(() => document.documentElement.classList.add("dark"));
    await page.screenshot({ path: path.join(output, "dark.png"), fullPage: false });

    onlineCount = 0;
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => [...document.querySelectorAll("[data-online-value]")].every((el) => el.textContent === "0 online"));
    onlineFails = true;
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => [...document.querySelectorAll("[data-online-value]")].every((el) => el.textContent === "Unavailable"));
    onlineFails = false;

    textEdits = { "games/snake": { title: "Serpent Notebook", description: "An edited project description." } };
    orderEdits = { games: ["snake", ...otherProjects.filter((p) => p.slug !== "snake").map((p) => p.slug)] };
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => document.querySelector('[data-others-item] h2')?.textContent === "Serpent Notebook");
    await page.type("[data-others-search]", "Serpent Notebook");
    assert.equal(await page.$$eval("[data-others-item]:not([hidden])", (cards) => cards.length), 1);
    statsFail = true;
    await page.reload({ waitUntil: "domcontentloaded" });
    assert.equal(await page.$eval("[data-others-item] h2", (heading) => heading.textContent), "Serpent Notebook");
    assert.equal(await page.$$eval("[data-others-item]:not([hidden])", (cards) => cards.length), count);
    assert.deepEqual(failures, [], "Unexpected browser errors");

    const plain = await browser.newPage();
    await plain.setJavaScriptEnabled(false);
    await plain.goto(`${base}/others`, { waitUntil: "domcontentloaded" });
    assert.equal(await plain.$$eval("[data-others-item]", (cards) => cards.length), count);
    console.log(JSON.stringify({ projects: count, catalogueUnchanged: true, detailRoutes: routes.length, retiredRoutes404: true, onlineCounts: true, zeroAndUnavailableStates: true, catalogueDoesNotRegisterPresence: presenceRequests === 0, search: true, sorting: true, adminEdits: true, suggestionRetry: true, mobile: true, darkMode: true, noJavaScriptLinks: true, browserErrors: failures, screenshots: output }, null, 2));
  } finally {
    await browser.close();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
