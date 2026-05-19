require("dotenv").config();
const { chromium } = require("playwright");
const BUILD_VERSION = "2026-05-18-logout-v3-accountid";
console.log("BUILD_VERSION:", BUILD_VERSION);


const CCM_URL = process.env.CCM_URL;
const CCM_USERNAME = process.env.CCM_USERNAME;
const CCM_ACCOUNT_ID = process.env.CCM_ACCOUNT_ID;
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

function shouldRunNow() {
  const now = getChicagoTimeParts();

  return (
    ["Mon", "Tue", "Wed", "Thu", "Fri"].includes(now.weekday) &&
    now.hhmm === "17:30"
  ) || (
    now.weekday === "Sat" &&
    now.hhmm === "12:30"
  );
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
  await page.waitForTimeout(5000);
  return page.frames();
}

async function fillFirstVisible(page, selectors, value, label) {
  const frames = await getAllFrames(page);

  for (const frame of frames) {
    for (const selector of selectors) {
      try {
        const locator = frame.locator(selector).first();

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

async function loginToCcm(page) {
  console.log("Attempting CCM login...");

  if (!CCM_ACCOUNT_ID) {
    throw new Error("Missing CCM_ACCOUNT_ID environment variable.");
  }

  await page.waitForLoadState("networkidle", { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(10000);

  console.log("LOGIN PAGE URL:", page.url());
  console.log("LOGIN PAGE TITLE:", await page.title());

  const html = await page.content();
  console.log("PAGE HTML SAMPLE:", html.slice(0, 8000));

const genericIndex = html.indexOf("GenericSignIn");
console.log("GENERIC SIGNIN INDEX:", genericIndex);

if (genericIndex >= 0) {
  console.log(
    "GENERIC SIGNIN HTML:",
    html.slice(Math.max(0, genericIndex - 2000), genericIndex + 12000)
  );
}
  console.log("PAGE HTML SAMPLE:", html.slice(0, 8000));

  const fieldCandidates = [
    {
      label: "account id",
      value: CCM_ACCOUNT_ID,
      selectors: [
        'input[id*="Account" i]',
        'input[name*="Account" i]',
        'input[id*="AccountId" i]',
        'input[name*="AccountId" i]',
        'input[id*="txtAccount" i]',
        'input[name*="txtAccount" i]'
      ]
    },
    {
      label: "username",
      value: CCM_USERNAME,
      selectors: [
        'input[id*="UserName" i]',
        'input[name*="UserName" i]',
        'input[id*="Username" i]',
        'input[name*="Username" i]',
        'input[id*="txtUser" i]',
        'input[name*="txtUser" i]'
      ]
    },
    {
      label: "password",
      value: CCM_PASSWORD,
      selectors: [
        'input[type="password"]',
        'input[id*="Password" i]',
        'input[name*="Password" i]',
        'input[id*="txtPassword" i]',
        'input[name*="txtPassword" i]'
      ]
    }
  ];

  for (const field of fieldCandidates) {
    let filled = false;

    for (const selector of field.selectors) {
      const locator = page.locator(selector).first();

      if (await locator.count()) {
        try {
          await locator.waitFor({ state: "visible", timeout: 5000 });
          await locator.fill(field.value);
          console.log(`Filled ${field.label} using ${selector}`);
          filled = true;
          break;
        } catch {}
      }
    }

    if (!filled) {
      console.log(`Could not fill ${field.label} with direct selector.`);
    }
  }

  const visibleInputs = page.locator('input:not([type="hidden"])');
  const visibleCount = await visibleInputs.count();

  console.log("VISIBLE INPUT COUNT:", visibleCount);

  if (visibleCount >= 3) {
    await visibleInputs.nth(0).fill(CCM_ACCOUNT_ID);
    await visibleInputs.nth(1).fill(CCM_USERNAME);
    await visibleInputs.nth(2).fill(CCM_PASSWORD);
    console.log("Filled account, username, password by visible input order.");
  } else {
    await page.screenshot({ path: "login-fields-missing.png", fullPage: true });
    throw new Error("Login fields are still not visible. Need full HTML around GenericSignIn controls.");
  }

  const clicked = await clickFirstVisible(
    page,
    [
      'input[type="submit"]',
      'button[type="submit"]',
      'input[value*="Sign" i]',
      'input[value*="Login" i]',
      'button:has-text("Sign in")',
      'button:has-text("Login")',
      'a:has-text("Sign in")',
      'a:has-text("Login")'
    ],
    "login button"
  );

  if (!clicked) {
    await page.keyboard.press("Enter");
    console.log("Pressed Enter to submit login form.");
  }

  await page.waitForLoadState("networkidle", { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(10000);

  console.log("POST LOGIN TITLE:", await page.title());
  console.log("POST LOGIN URL:", page.url());

  await page.screenshot({ path: "after-login.png", fullPage: true });
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

  const rows = await findAgentRows(page);
  console.log(`Detected ${rows.length} table rows.`);

  const matchingRows = rows.filter(r => {
    const text = r.text.toLowerCase();

    if (TARGET_AGENT_NAME) {
      return text.includes(TARGET_AGENT_NAME.toLowerCase());
    }

    return (
      text.includes("available") ||
      text.includes("not available") ||
      text.includes("on break") ||
      text.includes("wrap") ||
      text.includes("call")
    );
  });

  console.log("Matching agent rows:", JSON.stringify(matchingRows, null, 2));

  if (!matchingRows.length) {
    await page.screenshot({ path: "no-agent-rows-found.png", fullPage: true });
    return [];
  }

  const selectedAgents = [];

  for (const row of matchingRows) {
    const tr = page.locator("tr").nth(row.index);
    const checkbox = tr.locator('input[type="checkbox"]').first();

    if (await checkbox.count()) {
      const agentName =
        row.text.split("\n").map(x => x.trim()).filter(Boolean)[0] ||
        row.text.slice(0, 80);

      if (!DRY_RUN) {
        await checkbox.check({ force: true });
      }

      selectedAgents.push(agentName);
      console.log(`${DRY_RUN ? "DRY RUN selected" : "Selected"} agent: ${agentName}`);
    }
  }

  return selectedAgents;
}

async function logoutSelectedAgents(page) {
  if (DRY_RUN) {
    console.log("DRY_RUN=true, skipping Log Agent Out click.");
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

  console.log("FORCE_RUN raw:", process.env.FORCE_RUN);
  console.log("FORCE_RUN parsed:", FORCE_RUN);
  console.log("DRY_RUN parsed:", DRY_RUN);
  console.log("TARGET_AGENT_NAME:", TARGET_AGENT_NAME || "(all matching logged-in agents)");
  console.log("Current Chicago time:", JSON.stringify(getChicagoTimeParts()));

  if (!shouldRunNow() && !FORCE_RUN) {
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
  viewport: { width: 1600, height: 1000 },
  userAgent:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36"
});

const page = await context.newPage();

await page.addInitScript(() => {
  Object.defineProperty(navigator, "webdriver", {
    get: () => false
  });
});
  try {
    console.log("Opening CCM page...");
    await page.goto(CCM_URL, { waitUntil: "networkidle", timeout: 60000 });

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
      subject: DRY_RUN
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
