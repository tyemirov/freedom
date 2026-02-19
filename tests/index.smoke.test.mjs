import assert from "node:assert/strict";
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { mkdirSync } from "node:fs";
import { spawn } from "node:child_process";
import os from "node:os";
import { createServer as createNetServer } from "node:net";
import path from "node:path";
import { after, before, test } from "node:test";
import { chromium } from "playwright-core";

const ROOT_DIR = process.cwd();
const CHROMIUM_PATH = process.env.CHROMIUM_PATH || "/usr/bin/chromium-browser";

let server;
let baseUrl;
let browser;
let browserContext;
let chromiumProcess;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getFreePort() {
  return new Promise((resolve, reject) => {
    const tcp = createNetServer();
    tcp.once("error", reject);
    tcp.listen(0, "127.0.0.1", () => {
      const address = tcp.address();
      const port = address.port;
      tcp.close(() => resolve(port));
    });
  });
}

async function waitForCdp(port, timeoutMs = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) return;
    } catch (_) {
      // Retry until timeout.
    }
    await delay(150);
  }
  throw new Error(`CDP endpoint did not become ready on port ${port}`);
}

function contentTypeFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".html") return "text/html; charset=utf-8";
  if (ext === ".css") return "text/css; charset=utf-8";
  if (ext === ".js") return "application/javascript; charset=utf-8";
  if (ext === ".json") return "application/json; charset=utf-8";
  if (ext === ".md") return "text/markdown; charset=utf-8";
  return "application/octet-stream";
}

function startStaticServer(rootDir) {
  const root = path.resolve(rootDir);
  return createServer((req, res) => {
    const reqUrl = new URL(req.url || "/", "http://localhost");
    let requestPath = decodeURIComponent(reqUrl.pathname);
    if (requestPath === "/") requestPath = "/index.html";

    const resolved = path.resolve(root, `.${requestPath}`);
    if (!resolved.startsWith(root)) {
      res.statusCode = 403;
      res.end("Forbidden");
      return;
    }

    if (!existsSync(resolved) || !statSync(resolved).isFile()) {
      res.statusCode = 404;
      res.end("Not found");
      return;
    }

    res.statusCode = 200;
    res.setHeader("Content-Type", contentTypeFor(resolved));
    createReadStream(resolved).pipe(res);
  });
}

async function installExternalStubs(page) {
  await page.route("**/loopaware.mprlab.com/widget.js*", (route) => {
    route.fulfill({
      status: 200,
      contentType: "application/javascript; charset=utf-8",
      body: "",
    });
  });

  await page.route("**/plotly.min.js*", (route) => {
    route.fulfill({
      status: 200,
      contentType: "application/javascript; charset=utf-8",
      body: `
        window.__plotCalls = [];
        window.__plotPurges = [];
        window.Plotly = {
          newPlot: function(id, data) {
            window.__plotCalls.push({ id: id, traceCount: Array.isArray(data) ? data.length : 0 });
            return Promise.resolve();
          },
          purge: function(id) {
            window.__plotPurges.push(id);
          }
        };
      `,
    });
  });
}

async function openPage() {
  const page = await browserContext.newPage();

  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(`pageerror:${err.message}`));
  page.on("console", (msg) => {
    if (msg.type() === "error") pageErrors.push(`console:${msg.text()}`);
  });

  await installExternalStubs(page);
  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });

  await page.waitForFunction(() => {
    const selectionCount = document.querySelectorAll('#selectionList input[type="checkbox"]').length;
    const rowCount = document.querySelectorAll("#resultsBody tr").length;
    return selectionCount === 50 && rowCount > 0;
  });

  return { page, pageErrors };
}

before(async () => {
  server = startStaticServer(ROOT_DIR);
  await new Promise((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  baseUrl = `http://127.0.0.1:${address.port}`;

  const cdpPort = await getFreePort();
  const userDataDir = path.join(os.homedir(), "snap/chromium/common", `freedom-cdp-profile-${process.pid}`);
  mkdirSync(userDataDir, { recursive: true });

  chromiumProcess = spawn(
    CHROMIUM_PATH,
    [
      "--headless",
      "--disable-gpu",
      "--no-sandbox",
      "--disable-dev-shm-usage",
      `--remote-debugging-port=${cdpPort}`,
      `--user-data-dir=${userDataDir}`,
      "about:blank",
    ],
    { stdio: "ignore" },
  );

  await waitForCdp(cdpPort);
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`);
  browserContext = browser.contexts()[0];
});

after(async () => {
  if (browser) await browser.close();
  if (chromiumProcess && !chromiumProcess.killed) chromiumProcess.kill("SIGTERM");
  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("loads dataset and renders default results", async () => {
  const { page, pageErrors } = await openPage();
  try {
    const selectionCount = await page.locator('#selectionList input[type="checkbox"]').count();
    const selectedCount = await page.locator('#selectionList input[type="checkbox"]:checked').count();
    const tableRows = await page.locator("#resultsBody tr").count();
    const methodologyText = await page.locator("details summary").first().innerText();
    const plotCalls = await page.evaluate(() => window.__plotCalls || []);

    assert.equal(selectionCount, 50, "should render one selector checkbox per state");
    assert.equal(selectedCount, 5, "should auto-select first 5 jurisdictions");
    assert.equal(tableRows, 5, "table should render the selected jurisdictions");
    assert.match(methodologyText, /Methodology/i, "methodology section should exist");
    assert.ok(plotCalls.length >= 2, "should render both radar and scatter charts");
    assert.deepEqual(pageErrors, [], `page should load without JS errors: ${pageErrors.join(" | ")}`);
  } finally {
    await page.close();
  }
});

test("selection controls update table and chart state", async () => {
  const { page, pageErrors } = await openPage();
  try {
    await page.locator("#selectAllBtn").click();
    await page.waitForFunction(() => document.querySelectorAll("#resultsBody tr").length === 50);

    await page.locator("#selectNoneBtn").click();
    await page.waitForFunction(() => document.querySelectorAll("#resultsBody tr").length === 0);

    const tableRows = await page.locator("#resultsBody tr").count();
    const purges = await page.evaluate(() => window.__plotPurges || []);

    assert.equal(tableRows, 0, "table should be empty after clearing selection");
    assert.ok(purges.includes("radarChart"), "clearing selection should purge radar chart");
    assert.ok(purges.includes("scatterChart"), "clearing selection should purge scatter chart");
    assert.deepEqual(pageErrors, [], `selection flow should not produce JS errors: ${pageErrors.join(" | ")}`);
  } finally {
    await page.close();
  }
});

test("reset restores default controls and rerenders results", async () => {
  const { page, pageErrors } = await openPage();
  try {
    await page.fill("#incomeValue", "123456");
    await page.selectOption("#householdType", "single");
    await page.fill("#spendRatio", "0.25");
    await page.fill("#homeValue", "500000");
    await page.locator("#goalSchoolChoice").check();
    await page.locator("#goalSpeech").check();
    await page.fill("#weightFiscal", "10");
    await page.fill("#weightPermission", "90");

    await page.locator("#resetButton").click();
    await page.waitForFunction(() => document.querySelectorAll("#resultsBody tr").length === 5);

    const income = await page.locator("#incomeValue").inputValue();
    const household = await page.locator("#householdType").inputValue();
    const spend = await page.locator("#spendRatio").inputValue();
    const home = await page.locator("#homeValue").inputValue();
    const school = await page.locator("#goalSchoolChoice").isChecked();
    const speech = await page.locator("#goalSpeech").isChecked();
    const weightFiscal = await page.locator("#weightFiscal").inputValue();
    const weightPermission = await page.locator("#weightPermission").inputValue();
    const tableRows = await page.locator("#resultsBody tr").count();

    assert.equal(income, "400000");
    assert.equal(household, "couple_two_kids");
    assert.equal(spend, "0.55");
    assert.equal(home, "1200000");
    assert.equal(school, false);
    assert.equal(speech, false);
    assert.equal(weightFiscal, "60");
    assert.equal(weightPermission, "40");
    assert.equal(tableRows, 5, "default selection should rerender 5 rows after reset");
    assert.deepEqual(pageErrors, [], `reset flow should not produce JS errors: ${pageErrors.join(" | ")}`);
  } finally {
    await page.close();
  }
});
