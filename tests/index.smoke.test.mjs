import assert from "node:assert/strict";
import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { mkdirSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
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

const STYLE_FILE_PATH = path.join(ROOT_DIR, "style.css");
const ARTIFACT_DIR = path.join(ROOT_DIR, "artifacts");

function logFooterCapture(message, details) {
  if (process.env.DEBUG_FOOTER_CAPTURE !== "1") return;
  if (details) {
    // eslint-disable-next-line no-console
    console.log(`[footer-capture] ${message}`, details);
  } else {
    // eslint-disable-next-line no-console
    console.log(`[footer-capture] ${message}`);
  }
}

async function captureFooterRenderState(page, label, viewport) {
  const targetViewport = viewport || { width: 1366, height: 768 };
  const suffix = Math.random().toString(36).slice(2, 10);
  const closedScreenshot = path.join(ARTIFACT_DIR, `${label}-closed-${suffix}.png`);
  const openScreenshot = path.join(ARTIFACT_DIR, `${label}-open-${suffix}.png`);
  const footerClip = {
    x: 0,
    y: Math.max(0, targetViewport.height - 560),
    width: targetViewport.width,
    height: Math.min(560, targetViewport.height),
  };
  const footerToggle = page.locator('[data-mpr-footer="toggle-button"]');
  await footerToggle.waitFor({ state: "visible" });
  await page.setViewportSize(targetViewport);
  logFooterCapture(`setting viewport for ${label}`, targetViewport);
  await page.waitForTimeout(250);
  await page.evaluate(() => window.scrollTo(0, 0));
  await captureScreenshot(page, closedScreenshot, footerClip);
  logFooterCapture(`captured closed screenshot for ${label}`, { path: closedScreenshot });
  await page.evaluate(() => {
    const toggle = document.querySelector('[data-mpr-footer="toggle-button"]');
    if (toggle) {
      toggle.click();
    }
  });
  await page.waitForTimeout(450);
  await captureScreenshot(page, openScreenshot, footerClip);
  logFooterCapture(`captured open screenshot for ${label}`, { path: openScreenshot });

  return {
    label,
    viewport: targetViewport,
    closedScreenshot,
    openScreenshot,
  };
}

function assertFooterMenuRenderState(state) {
  const stateLabel = `footer ${state.label}`;
  const openStatePsnr = measurePsnr(state.closedScreenshot, state.openScreenshot);

  assert.equal(openStatePsnr < 60, true, `${stateLabel}: open state should differ from closed in rendered output`);
  assert.equal(
    Number.isFinite(openStatePsnr),
    true,
    `${stateLabel}: open state should produce a finite render delta`,
  );
  assert.equal(statSync(state.closedScreenshot).size > 0, true, `${stateLabel}: closed screenshot should be written`);
  assert.equal(statSync(state.openScreenshot).size > 0, true, `${stateLabel}: open screenshot should be written`);
}

function measurePsnr(referenceImage, candidateImage) {
  const stats = spawnSync("ffmpeg", ["-i", referenceImage, "-i", candidateImage, "-lavfi", "psnr=stats_file=-", "-f", "null", "-"], {
    encoding: "utf8",
    maxBuffer: 10_000_000,
  });
  const output = `${stats.stdout || ""}${stats.stderr || ""}`;
  const match = output.match(/psnr_avg:([0-9.]+|inf)/i) || output.match(/average:([0-9.]+|inf)/i);
  if (!match) {
    throw new Error(`failed to parse psnr from ffmpeg output for ${referenceImage}, ${candidateImage}`);
  }
  if (match[1] === "inf") return Number.POSITIVE_INFINITY;
  return Number.parseFloat(match[1]);
}

async function captureScreenshot(page, filePath, clip) {
  const screenshotOptions = {
    path: filePath,
    type: "png",
    timeout: 30000,
  };
  if (clip) {
    screenshotOptions.clip = clip;
  }
  try {
    await page.screenshot(screenshotOptions);
    return;
  } catch (error) {
    if (process.env.DEBUG_FOOTER_CAPTURE === "1") {
      // eslint-disable-next-line no-console
      console.log(
        `[footer-capture] screenshot fallback triggered for ${filePath}`,
        error && error.message ? error.message : error,
      );
    }

    const fallbackOptions = {
      path: filePath,
      type: "png",
      timeout: 30000,
    };
    if (clip) {
      fallbackOptions.clip = clip;
    }
    await page.screenshot(fallbackOptions);
  }
}

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

  await page.route("**/loopaware.mprlab.com/pixel.js*", (route) => {
    route.fulfill({
      status: 200,
      contentType: "application/javascript; charset=utf-8",
      body: "",
    });
  });

  await page.route("**/loopaware-api.mprlab.com/public/visits*", (route) => {
    route.fulfill({
      status: 204,
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

async function openPage(requestPath = "/") {
  const page = await browserContext.newPage();

  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(`pageerror:${err.message}`));
  page.on("console", (msg) => {
    if (msg.type() === "error") pageErrors.push(`console:${msg.text()}`);
  });

  await installExternalStubs(page);
  const pageUrl = new URL(requestPath, `${baseUrl}/`).toString();
  const response = await page.goto(pageUrl, { waitUntil: "domcontentloaded" });

  await page.waitForFunction(() => {
    const selectionCount = document.querySelectorAll('#selectionList input[type="checkbox"]').length;
    const rowCount = document.querySelectorAll("#resultsBody tr").length;
    return selectionCount === 50 && rowCount > 0;
  });

  return { page, pageErrors, response };
}

async function clickById(page, elementId) {
  await page.evaluate((id) => {
    const element = document.getElementById(id);
    if (!element) {
      throw new Error(`Unable to locate #${id} for interaction`);
    }
    element.click();
  }, elementId);
}

async function setInputValue(page, elementId, value) {
  await page.evaluate((payload) => {
    const element = document.getElementById(payload.id);
    if (!element) {
      throw new Error(`Unable to locate #${payload.id} for input update`);
    }
    const nextValue = String(payload.value);
    element.value = nextValue;
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  }, { id: elementId, value });
}

async function setChecked(page, elementId, value) {
  await page.evaluate((payload) => {
    const element = document.getElementById(payload.id);
    if (!element) {
      throw new Error(`Unable to locate #${payload.id} for checked update`);
    }
    element.checked = Boolean(payload.value);
    element.dispatchEvent(new Event("change", { bubbles: true }));
  }, { id: elementId, value });
}

async function setSelectOption(page, elementId, value) {
  await page.evaluate((payload) => {
    const element = document.getElementById(payload.id);
    if (!element) {
      throw new Error(`Unable to locate #${payload.id} for select update`);
    }
    element.value = payload.value;
    element.dispatchEvent(new Event("change", { bubbles: true }));
  }, { id: elementId, value });
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

test("opens /index.html directly as a regular HTML document", async () => {
  const { page, pageErrors, response } = await openPage("/index.html");
  try {
    const selectionCount = await page.locator('#selectionList input[type="checkbox"]').count();
    const selectedCount = await page.locator('#selectionList input[type="checkbox"]:checked').count();
    const tableRows = await page.locator("#resultsBody tr").count();

    assert.equal(response?.status(), 200, "index.html should be served successfully");
    assert.match(
      response?.headers()["content-type"] || "",
      /^text\/html/i,
      "index.html should be served with an HTML content type",
    );
    assert.match(page.url(), /\/index\.html$/, "page URL should remain on /index.html");
    assert.equal(selectionCount, 50, "should render one selector checkbox per state");
    assert.equal(selectedCount, 5, "should auto-select first 5 jurisdictions");
    assert.equal(tableRows, 5, "table should render the selected jurisdictions");
    assert.deepEqual(pageErrors, [], `index.html should load without JS errors: ${pageErrors.join(" | ")}`);
  } finally {
    await page.close();
  }
});

test("selection controls update table and chart state", async () => {
  const { page, pageErrors } = await openPage();
  try {
    await clickById(page, "selectAllBtn");
    await page.waitForFunction(() => document.querySelectorAll("#resultsBody tr").length === 50);

    await clickById(page, "selectNoneBtn");
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
    await setInputValue(page, "incomeValue", "123456");
    await setSelectOption(page, "householdType", "single");
    await setInputValue(page, "spendRatio", "0.25");
    await setInputValue(page, "homeValue", "500000");
    await setChecked(page, "goalSchoolChoice", true);
    await setChecked(page, "goalSpeech", true);
    await setInputValue(page, "weightFiscal", "10");
    await setInputValue(page, "weightPermission", "90");

    await clickById(page, "resetButton");
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

test("footer built-by menu opens and renders full site list", {
  skip: !process.env.RUN_FOOTER_SCREENSHOT_TESTS,
}, async () => {
  if (!process.env.RUN_FOOTER_SCREENSHOT_TESTS) {
    return;
  }
  mkdirSync(ARTIFACT_DIR, { recursive: true });
  const desktopSession = await openPage();
  const mobileSession = await openPage("/index.html");
  const desktopPage = desktopSession.page;
  const mobilePage = mobileSession.page;
  const desktopPageErrors = desktopSession.pageErrors;
  const mobilePageErrors = mobileSession.pageErrors;

  try {
    const desktopState = await captureFooterRenderState(desktopPage, "desktop", { width: 1366, height: 768 });
    const mobileState = await captureFooterRenderState(mobilePage, "mobile", { width: 390, height: 844 });

    assertFooterMenuRenderState(desktopState);
    assertFooterMenuRenderState(mobileState);

    assert.deepEqual(desktopPageErrors, [], `desktop screenshot flow should not produce JS errors: ${desktopPageErrors.join(" | ")}`);
    assert.deepEqual(mobilePageErrors, [], `mobile screenshot flow should not produce JS errors: ${mobilePageErrors.join(" | ")}`);
  } finally {
    await desktopPage.close();
    await mobilePage.close();
  }
});

test("header and footer legal links point to expected destinations", async () => {
  const { page, pageErrors } = await openPage();
  try {
    const headerBrand = page.locator('[data-mpr-header="brand"]');
    const privacyLink = page.locator('[data-mpr-footer="privacy-link"]');

    const headerHref = (await headerBrand.getAttribute("href")) || "";
    const privacyHref = (await privacyLink.getAttribute("href")) || "";
    const privacyLabel = (await privacyLink.innerText())?.trim();

    assert.equal(
      headerHref,
      "https://open.substack.com/pub/vadymtyemirov/p/the-vector-of-liberty",
      "header brand should link to The Vector of Liberty page",
    );
    assert.equal(privacyHref, "https://mprlab.com", "footer privacy/legal link should point at mprlab.com");
    assert.equal(privacyLabel, "Marco Polo Research Lab", "footer privacy/legal label should be set");
    assert.deepEqual(pageErrors, [], `header/footer link checks should not produce JS errors: ${pageErrors.join(" | ")}`);
  } finally {
    await page.close();
  }
});

test("local stylesheet does not override mpr header/footer primitives", async () => {
  const localCss = readFileSync(STYLE_FILE_PATH, "utf8");
  const hasHeaderOrFooterSelectors = /\bmpr-(header|footer)\b/.test(localCss);
  const hasLocalOverrides =
    /\[data-mpr-(header|footer)\]/.test(localCss) ||
    /\.mpr-(header|footer)\b/.test(localCss);
  assert.equal(hasHeaderOrFooterSelectors, false, "style.css should not target mpr-header/mpr-footer");
  assert.equal(hasLocalOverrides, false, "style.css should not target [data-mpr-header] or [data-mpr-footer]");
});
