require("dotenv").config();
const { chromium } = require("playwright");
const BUILD_VERSION = "2026-05-18-logout-v6-tenant-login";
const CONFIG_URL = process.env.CONFIG_URL;
let runtimeConfig = null;
console.log("BUILD_VERSION:", BUILD_VERSION);


const CCM_URL = process.env.CCM_URL;
const CCM_USERNAME = process.env.CCM_USERNAME;
// const CCM_ACCOUNT_ID = process.env.CCM_ACCOUNT_ID;
const CCM_PASSWORD = process.env.CCM_PASSWORD;
const BREVO_API_KEY = process.env.BREVO_API_KEY;
const ALERT_TO = process.env.ALERT_TO;
const ALERT_CC = process.env.ALERT_CC || "";
const TIMEZONE = process.env.TIMEZONE || "America/Chicago";

const FORCE_RUN = String(process.env.FORCE_RUN || "").toLowerCase() === "true";
const DRY_RUN = String(process.env.DRY_RUN || "true").toLowerCase() === "true";
const TARGET_AGENT_NAME = process.env.TARGET_AGENT_NAME || "";

function getChicagoTimeParts() {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: TIMEZONE,
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    }).formatToParts(new Date()).map(p => [p.type, p.value])
  );

  return {
    weekday: parts.weekday,
    hhmm: `${parts.hour}:${parts.minute}`
  };
}

function shouldRunNow(config) {
  if (!config?.enabled) return false;

  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Chicago",
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    }).formatToParts(new Date()).map(p => [p.type, p.value])
  );

  const now = {
    weekday: parts.weekday,
    hhmm: `${parts.hour}:${parts.minute}`
  };

  console.log("Runtime schedule check:", JSON.stringify(now));

  const weekdayRun =
    ["Mon", "Tue", "Wed", "Thu", "Fri"].includes(now.weekday) &&
    now.hhmm === (config.weekdayTime || "17:30");

  const saturdayRun =
    now.weekday === "Sat" &&
    now.hhmm === (config.saturdayTime || "12:30");

  return weekdayRun || saturdayRun;
}

async function sendEmail({ subject, html, text }) {
  if (!BREVO_API_KEY || !ALERT_TO) {
    console.log("Email skipped. Missing BREVO_API_KEY or ALERT_TO.");
    return;
  }

  const to = ALERT_TO.split(",")
    .map(email => ({ email: email.trim() }))
    .filter(x => x.email);

  const cc = ALERT_CC.split(",")
    .map(email => ({ email: email.trim() }))
    .filter(x => x.email);

  const payload = {
    sender: {
      email: "security@onenecklab.com",
      name: "VisionBank Contact Center"
    },
    to,
    subject,
    textContent: text || "VisionBank agent logout automation notification.",
    htmlContent: html || "<p>VisionBank agent logout automation notification.</p>"
  };

  if (cc.length) payload.cc = cc;

  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "api-key": BREVO_API_KEY
    },
    body: JSON.stringify(payload)
  });

  const responseText = await res.text();
  console.log("Brevo status:", res.status, responseText);
}

async function getAllFrames(page) {
  await page.waitForTimeout(10000);

const frames = page.frames();

console.log(
  "Detected frames:",
  frames.map(f => f.url())
);

return frames;
}

async function fillFirstVisible(page, selectors, value, label) {
  const frames = await getAllFrames(page);

  for (const frame of frames) {
    for (const selector of selectors) {
      try {
        const locator = frame.locator(selector).first();
        console.log(`Checking selector ${selector} in frame ${frame.url()}`);
        if (await locator.count()) {
          await locator.waitFor({ state: "visible", timeout: 3000 });
          await locator.fill(value);
          console.log(`Filled ${label} using ${selector} in frame ${frame.url()}`);
          return true;
        }
      } catch {}
    }
  }

  return false;
}

async function clickFirstVisible(page, selectors, label) {
  const frames = await getAllFrames(page);

  for (const frame of frames) {
    for (const selector of selectors) {
      try {
        const locator = frame.locator(selector).first();

        if (await locator.count()) {
          await locator.waitFor({ state: "visible", timeout: 3000 });
          await locator.click();
          console.log(`Clicked ${label} using ${selector} in frame ${frame.url()}`);
          return true;
        }
      } catch {}
    }
  }

  return false;
}
async function loadRuntimeConfig() {
  if (!CONFIG_URL) {
    console.log("No CONFIG_URL set. Using local env defaults.");
    return {
      enabled: true,
      timezone: "America/Chicago",
      weekdayTime: "17:30",
      saturdayTime: "12:30",
      targetMode: TARGET_AGENT_NAME ? "specific" : "all",
      targetAgentName: TARGET_AGENT_NAME,
      dryRun: DRY_RUN
    };
  }

  const res = await fetch(CONFIG_URL, {
    method: "GET",
    headers: {
      "Accept": "application/json"
    }
  });

  const text = await res.text();

  if (!res.ok) {
    throw new Error(`Failed to load logout config: HTTP ${res.status} - ${text}`);
  }

  return JSON.parse(text);
}

async function loginToCcm(page) {
  console.log("Attempting CCM login...");

  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(10000);

  console.log("LOGIN PAGE URL:", page.url());
  console.log("LOGIN PAGE TITLE:", await page.title());

  await page.waitForSelector("#GenericSignIn_txtUsername", { timeout: 30000 });
  await page.waitForSelector("#GenericSignIn_txtPassword", { timeout: 30000 });

  await page.fill("#GenericSignIn_txtUsername", CCM_USERNAME);
  await page.fill("#GenericSignIn_txtPassword", CCM_PASSWORD);

  console.log("Username and password entered.");

  await page.click("#GenericSignIn_btnSignIn");
  console.log("Sign in button clicked.");

  await page.waitForTimeout(15000);

  await page.waitForLoadState("networkidle", { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(10000);

  console.log("POST LOGIN URL:", page.url());
  console.log("POST LOGIN TITLE:", await page.title());

  await page.goto("https://pop1-apps.mycontactcenter.net/admin/ccm.aspx", {
    waitUntil: "networkidle",
    timeout: 60000
  });

  await page.waitForTimeout(10000);

  console.log("CCM URL:", page.url());
  console.log("CCM TITLE:", await page.title());
}
async function findAgentRows(page) {
  return await page.locator("tr").evaluateAll(trs =>
    trs.map((tr, index) => ({
      index,
      text: tr.innerText || ""
    })).filter(r => r.text.trim().length > 0)
  );
}

async function selectAgentRows(page) {
  console.log("Finding logged-in agent rows...");

  const rows = await page.locator("tr");
  const rowCount = await rows.count();

  console.log(`Detected ${rowCount} table rows.`);

  const configuredTarget =
    runtimeConfig?.targetMode === "specific"
      ? String(runtimeConfig.targetAgentName || "").trim()
      : "";

  const effectiveDryRun = runtimeConfig?.dryRun === true;

  const selectedAgents = [];

  for (let i = 0; i < rowCount; i++) {
    const tr = rows.nth(i);

    const agentCheckbox = tr
      .locator('input[type="checkbox"][name*="btnAgentCheckbox"], input[type="checkbox"][id*="btnAgentCheckbox"]')
      .first();

    if (!(await agentCheckbox.count())) {
      continue;
    }

    const rowText = (await tr.innerText().catch(() => "")).trim();

    if (!rowText) {
      continue;
    }

    if (configuredTarget && !rowText.toLowerCase().includes(configuredTarget.toLowerCase())) {
      continue;
    }

    const agentName =
      rowText.split("\n").map(x => x.trim()).filter(Boolean)[0] ||
      rowText.slice(0, 80);

    if (!effectiveDryRun) {
      await agentCheckbox.check({ force: true });
    }

    selectedAgents.push(agentName);

    console.log(`${effectiveDryRun ? "DRY RUN selected" : "Selected"} agent: ${agentName}`);
  }

  console.log("Selected agents:", JSON.stringify(selectedAgents, null, 2));

  if (!selectedAgents.length) {
    await page.screenshot({ path: "no-agent-rows-found.png", fullPage: true });
  }

  return selectedAgents;
}

async function logoutSelectedAgents(page) {
  if (runtimeConfig?.dryRun === true) {
  console.log("Cloudflare dryRun=true, skipping Log Agent Out click.");
  return;
}

  console.log("Clicking Log Agent Out...");

  page.once("dialog", async dialog => {
    console.log("Confirmation dialog:", dialog.message());
    await dialog.accept();
    console.log("Confirmation accepted.");
  });

  const clicked = await clickFirstVisible(
    page,
    [
      'input[value="Log Agent Out"]',
      'input[value*="Log Agent Out"]',
      'button:has-text("Log Agent Out")',
      'a:has-text("Log Agent Out")',
      'text=Log Agent Out'
    ],
    "Log Agent Out"
  );

  if (!clicked) {
    await page.screenshot({ path: "logout-button-not-found.png", fullPage: true });
    throw new Error("Unable to find Log Agent Out button.");
  }

  await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(5000);

  await page.screenshot({ path: "after-agent-logout.png", fullPage: true });
}

async function main() {
if (!CCM_URL || !CCM_USERNAME || !CCM_PASSWORD) {
  throw new Error("Missing CCM_URL, CCM_USERNAME, or CCM_PASSWORD environment variable.");
}
runtimeConfig = await loadRuntimeConfig();

  console.log("Runtime config:", JSON.stringify(runtimeConfig));
  console.log("FORCE_RUN raw:", process.env.FORCE_RUN);
  console.log("FORCE_RUN parsed:", FORCE_RUN);
  console.log("DRY_RUN parsed:", DRY_RUN);
  console.log("TARGET_AGENT_NAME:", TARGET_AGENT_NAME || "(all matching logged-in agents)");
  console.log("Current Chicago time:", JSON.stringify(getChicagoTimeParts()));

  if (!shouldRunNow(runtimeConfig) && !FORCE_RUN) {
  console.log("Not scheduled logout time. Exiting.");
  return;
}

 const browser = await chromium.launch({
  headless: true,
  args: [
    "--disable-blink-features=AutomationControlled",
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-dev-shm-usage"
  ]
});

const context = await browser.newContext({
  viewport: {
  width: 1920,
  height: 1080
},
  userAgent:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36"
});

const page = await context.newPage();
await page.emulateMedia({ media: "screen" });
await page.addInitScript(() => {
  Object.defineProperty(navigator, "webdriver", {
    get: () => false
  });
});
  try {
    console.log("Opening CCM page...");
    await page.goto(CCM_URL, { waitUntil: "networkidle", timeout: 60000 });
    await page.waitForTimeout(15000);
    console.log("Page title:", await page.title());
    await page.screenshot({ path: "ccm-login-page.png", fullPage: true });

    await loginToCcm(page);

    const title = await page.title();
    const bodyText = await page.locator("body").innerText().catch(() => "");

    if (/sign in|login/i.test(title) || /sign in|login/i.test(bodyText.slice(0, 500))) {
      throw new Error("Login appears unsuccessful. Still on sign-in page.");
    }

    const selectedAgents = await selectAgentRows(page);

    if (!selectedAgents.length) {
      await sendEmail({
        subject: "VisionBank Agent Logout Automation - No Agents Found",
        text: "No matching logged-in agents were found.",
        html: `
          <p>No matching logged-in agents were found.</p>
          <p><strong>Target Agent:</strong> ${TARGET_AGENT_NAME || "All matching agents"}</p>
          <p><strong>Dry Run:</strong> ${DRY_RUN}</p>
        `
      });

      console.log("No matching agents found.");
      return;
    }

    await logoutSelectedAgents(page);

    await sendEmail({
      subject: runtimeConfig?.dryRun === true
  ? "VisionBank Agent Logout Automation - Dry Run"
  : "VisionBank Agent Logout Automation - Completed",
      text: `Agents processed: ${selectedAgents.join(", ")}`,
      html: `
        <h2>VisionBank Agent Logout Automation</h2>
        <p><strong>Dry Run:</strong> ${DRY_RUN}</p>
        <p><strong>Processed Agents:</strong></p>
        <ul>
          ${selectedAgents.map(a => `<li>${a}</li>`).join("")}
        </ul>
        <p><strong>Chicago Time:</strong> ${JSON.stringify(getChicagoTimeParts())}</p>
      `
    });

    console.log("Automation completed successfully.");
  } catch (err) {
    console.error("Automation failed:", err);

    await page.screenshot({ path: "automation-failed.png", fullPage: true }).catch(() => {});

    await sendEmail({
      subject: "VisionBank Agent Logout Automation Failed",
      text: err.message,
      html: `<p><strong>Automation failed:</strong></p><pre>${err.message}</pre>`
    });

    throw err;
  } finally {
    await browser.close();
  }
}

main();
