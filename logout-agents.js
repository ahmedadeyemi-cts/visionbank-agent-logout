require("dotenv").config();
const { chromium } = require("playwright");

const CCM_URL = process.env.CCM_URL;
const CCM_USERNAME = process.env.CCM_USERNAME;
const CCM_PASSWORD = process.env.CCM_PASSWORD;
const BREVO_API_KEY = process.env.BREVO_API_KEY;
const ALERT_TO = process.env.ALERT_TO;
const ALERT_CC = process.env.ALERT_CC || "";
const TIMEZONE = process.env.TIMEZONE || "America/Chicago";

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

  const weekdayRun =
    ["Mon", "Tue", "Wed", "Thu", "Fri"].includes(now.weekday) &&
    now.hhmm === "17:30";

  const saturdayRun =
    now.weekday === "Sat" &&
    now.hhmm === "12:30";

  return weekdayRun || saturdayRun;
}

async function sendEmail({ subject, html, text }) {
  if (!BREVO_API_KEY || !ALERT_TO) return;

  const to = ALERT_TO.split(",").map(email => ({ email: email.trim() })).filter(x => x.email);
  const cc = ALERT_CC.split(",").map(email => ({ email: email.trim() })).filter(x => x.email);

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

async function main() {
  if (!CCM_URL || !CCM_USERNAME || !CCM_PASSWORD) {
    throw new Error("Missing CCM_URL, CCM_USERNAME, or CCM_PASSWORD environment variable.");
  }

  const forceRun = String(process.env.FORCE_RUN || "").toLowerCase() === "true";

  console.log("FORCE_RUN raw:", process.env.FORCE_RUN);
  console.log("FORCE_RUN parsed:", forceRun);
  console.log("Current Chicago time:", JSON.stringify(getChicagoTimeParts()));

  if (!shouldRunNow() && !forceRun) {
    console.log("Not scheduled logout time. Exiting.");
    return;
  }

  const browser = await chromium.launch({
    headless: true
  });

  const page = await browser.newPage();

  try {
    console.log("Opening CCM page...");
    await page.goto(CCM_URL, { waitUntil: "networkidle" });

    console.log("Page title:", await page.title());

    // TODO: We will adjust these selectors after seeing the login page HTML.
    // This is intentionally conservative so we do not guess the login fields.
    await page.screenshot({ path: "ccm-login-page.png", fullPage: true });

    await sendEmail({
      subject: "VisionBank Agent Logout Automation Test",
      text: "The automation opened the CCM page successfully. Next step is mapping login fields and logout controls.",
      html: `
        <p>The automation opened the CCM page successfully.</p>
        <p>Next step is mapping the login fields and logout controls.</p>
      `
    });

    console.log("Automation reached CCM page successfully.");
  } catch (err) {
    console.error("Automation failed:", err);

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
