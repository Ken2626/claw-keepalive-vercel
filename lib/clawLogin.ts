import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";
import chromium from "@sparticuz/chromium";
import {
  chromium as playwrightChromium,
  type BrowserContext,
  type Locator,
  type Page,
} from "playwright-core";

type StorageState = Awaited<ReturnType<BrowserContext["storageState"]>>;

type LoginResult = {
  finalUrl: string;
  pageTitle: string;
  finishedAt: string;
};

type RequiredEnv = {
  githubUsername: string;
  githubPassword: string;
  clawSigninUrl: string;
  githubOtp?: string;
};

type PageDebugState = {
  url: string;
  title: string;
};

type VerificationChallengePayload = {
  v: 1;
  issuedAt: string;
  expiresAt: string;
  pageUrl: string;
  storageState: StorageState;
};

const VERIFICATION_CHALLENGE_TTL_MS = 10 * 60 * 1000;

const GITHUB_AUTH_URL_RE = /github\.com\/(login|session|sessions|authorize)/i;
const GITHUB_VERIFICATION_URL_RE =
  /github\.com\/sessions\/(two-factor|verified-device)/i;
const CLAW_URL_RE = /run\.claw\.cloud\//i;
const CLAW_SIGNIN_PATH_RE = /\/signin(?:\/|$)/i;

export class DeviceVerificationRequiredError extends Error {
  readonly challengeToken: string;
  readonly expiresAt: string;
  readonly pageUrl: string;

  constructor(params: {
    challengeToken: string;
    expiresAt: string;
    pageUrl: string;
  }) {
    super("GitHub verification code required");
    this.name = "DeviceVerificationRequiredError";
    this.challengeToken = params.challengeToken;
    this.expiresAt = params.expiresAt;
    this.pageUrl = params.pageUrl;
  }
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function loadConfig(): RequiredEnv {
  return {
    githubUsername: requireEnv("GITHUB_USERNAME"),
    githubPassword: requireEnv("GITHUB_PASSWORD"),
    clawSigninUrl: resolveClawSigninUrl(),
    githubOtp: process.env.GITHUB_OTP,
  };
}

function getDeviceFlowSecret(): string {
  const flowSecret = process.env.DEVICE_FLOW_SECRET?.trim();
  if (flowSecret) {
    return flowSecret;
  }
  return requireEnv("CRON_SECRET");
}

function redactUrl(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    // Keep only origin + pathname to avoid leaking OAuth query params.
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return rawUrl;
  }
}

function resolveClawSigninUrl(): string {
  const directUrl = process.env.CLAW_SIGNIN_URL?.trim();
  if (directUrl) {
    return normalizeSigninUrl(directUrl);
  }

  const datacenter = process.env.CLAW_DATACENTER?.trim();
  if (datacenter) {
    return `https://${datacenter}.run.claw.cloud/signin`;
  }

  // Fallback keeps current behavior. Users should set their own region via env.
  return "https://eu-central-1.run.claw.cloud/signin";
}

function normalizeSigninUrl(raw: string): string {
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  const parsed = new URL(withScheme);
  if (!parsed.pathname || parsed.pathname === "/") {
    parsed.pathname = "/signin";
  }
  return parsed.toString();
}

function toBase64Url(buffer: Buffer): string {
  return buffer
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function fromBase64Url(value: string): Buffer {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const remainder = normalized.length % 4;
  const padding = remainder === 0 ? "" : "=".repeat(4 - remainder);
  return Buffer.from(normalized + padding, "base64");
}

function deriveFlowKey(secret: string): Buffer {
  return createHash("sha256").update(secret, "utf8").digest();
}

function encodeChallengePayload(payload: VerificationChallengePayload): string {
  const secret = getDeviceFlowSecret();
  const key = deriveFlowKey(secret);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);

  const plaintext = JSON.stringify(payload);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return `${toBase64Url(iv)}.${toBase64Url(authTag)}.${toBase64Url(encrypted)}`;
}

function decodeChallengePayload(token: string): VerificationChallengePayload {
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new Error("Invalid challenge token format");
  }

  const [ivPart, authTagPart, encryptedPart] = parts;
  const iv = fromBase64Url(ivPart);
  const authTag = fromBase64Url(authTagPart);
  const encrypted = fromBase64Url(encryptedPart);

  const secret = getDeviceFlowSecret();
  const key = deriveFlowKey(secret);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);

  const plaintext = Buffer.concat([
    decipher.update(encrypted),
    decipher.final(),
  ]).toString("utf8");

  const payload = JSON.parse(plaintext) as VerificationChallengePayload;
  if (payload.v !== 1 || !payload.pageUrl || !payload.expiresAt) {
    throw new Error("Invalid challenge token payload");
  }

  if (new Date(payload.expiresAt).getTime() <= Date.now()) {
    throw new Error("Challenge token expired");
  }

  return payload;
}

async function getPageDebugState(page: Page): Promise<PageDebugState> {
  const url = redactUrl(page.url());
  const title = await page.title().catch(() => "unknown");
  return { url, title };
}

async function getAllPagesDebugState(context: BrowserContext): Promise<string> {
  const pages = context.pages();
  const states = await Promise.all(
    pages.map(async (p, index) => {
      const debug = await getPageDebugState(p);
      return `page${index + 1}_url=${debug.url};page${index + 1}_title=${debug.title}`;
    }),
  );
  return states.length > 0 ? states.join(";") : "no_open_pages";
}

function isGithubAuthUrl(url: string): boolean {
  return GITHUB_AUTH_URL_RE.test(url);
}

function isGithubVerificationUrl(url: string): boolean {
  return GITHUB_VERIFICATION_URL_RE.test(url);
}

function isLoggedInClawUrl(url: string): boolean {
  return CLAW_URL_RE.test(url) && !CLAW_SIGNIN_PATH_RE.test(url);
}

async function resolveGithubAuthPage(
  context: BrowserContext,
  originalPage: Page,
  popupPromise: Promise<Page | null>,
  newPagePromise: Promise<Page | null>,
): Promise<Page> {
  if (isGithubAuthUrl(originalPage.url())) {
    return originalPage;
  }

  try {
    await originalPage.waitForURL(GITHUB_AUTH_URL_RE, {
      timeout: 12000,
      waitUntil: "domcontentloaded",
    });
    return originalPage;
  } catch {
    // fall through to check popup/new tab paths
  }

  const existingGithubPage = context
    .pages()
    .find((p) => p !== originalPage && isGithubAuthUrl(p.url()));
  if (existingGithubPage) {
    return existingGithubPage;
  }

  const [popupPage, newPage] = await Promise.all([popupPromise, newPagePromise]);
  const candidates = [popupPage, newPage].filter((p): p is Page => Boolean(p));
  for (const candidate of candidates) {
    await candidate
      .waitForLoadState("domcontentloaded", { timeout: 30000 })
      .catch(() => undefined);
    if (isGithubAuthUrl(candidate.url())) {
      return candidate;
    }

    try {
      await candidate.waitForURL(GITHUB_AUTH_URL_RE, {
        timeout: 30000,
        waitUntil: "domcontentloaded",
      });
      return candidate;
    } catch {
      // check next candidate
    }
  }

  const finalGithubPage = context.pages().find((p) => isGithubAuthUrl(p.url()));
  if (finalGithubPage) {
    return finalGithubPage;
  }

  throw new Error("GitHub login page did not open after clicking sign-in entry");
}

async function waitForClawLoggedInPage(
  context: BrowserContext,
  timeoutMs: number,
): Promise<Page> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const pages = context.pages();
    for (const p of pages) {
      if (isLoggedInClawUrl(p.url())) {
        await p
          .waitForLoadState("domcontentloaded", { timeout: 5000 })
          .catch(() => undefined);
        return p;
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  throw new Error("Timed out waiting for Claw login completion");
}

async function clickFirstVisible(page: Page, selectors: string[]): Promise<boolean> {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    const visible = await locator.isVisible({ timeout: 2500 }).catch(() => false);
    if (visible) {
      await locator.click({ timeout: 5000 });
      return true;
    }
  }
  return false;
}

async function waitForSigninUiReady(page: Page): Promise<void> {
  await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => undefined);
  await page
    .waitForFunction(
      () => Boolean(document.title && document.title.trim().length > 0),
      undefined,
      {
        timeout: 30000,
      },
    )
    .catch(() => undefined);
  await page
    .waitForFunction(
      () =>
        Array.from(document.querySelectorAll("button,a")).some((el) => {
          const text = (el.textContent ?? "").toLowerCase();
          const visible = (el as HTMLElement).offsetParent !== null;
          return visible && text.includes("github");
        }),
      undefined,
      { timeout: 30000 },
    )
    .catch(() => undefined);
}

async function findVerificationInput(page: Page): Promise<Locator | null> {
  const selectors = [
    'input[name="app_otp"]',
    'input[name="otp"]',
    "input#otp",
    'input[name="code"]',
    'input[autocomplete="one-time-code"]',
    'input[name^="character"]',
  ];

  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    const visible = await locator.isVisible({ timeout: 1200 }).catch(() => false);
    if (visible) {
      return locator;
    }
  }

  return null;
}

async function isVerificationStep(page: Page): Promise<boolean> {
  if (isGithubVerificationUrl(page.url())) {
    return true;
  }

  const input = await findVerificationInput(page);
  return Boolean(input);
}

async function createVerificationChallenge(
  context: BrowserContext,
  page: Page,
): Promise<{ challengeToken: string; expiresAt: string; pageUrl: string }> {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + VERIFICATION_CHALLENGE_TTL_MS);

  const payload: VerificationChallengePayload = {
    v: 1,
    issuedAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
    pageUrl: page.url(),
    storageState: await context.storageState(),
  };

  return {
    challengeToken: encodeChallengePayload(payload),
    expiresAt: payload.expiresAt,
    pageUrl: redactUrl(payload.pageUrl),
  };
}

async function submitVerificationCode(page: Page, verificationCode: string): Promise<void> {
  const trimmed = verificationCode.trim();
  if (!trimmed) {
    throw new Error("Verification code is empty");
  }

  const codeInput = await findVerificationInput(page);
  if (!codeInput) {
    throw new Error("GitHub verification input not found");
  }

  await codeInput.click({ timeout: 5000 });

  const name = await codeInput.getAttribute("name").catch(() => null);
  const isSplitInput = Boolean(name?.startsWith("character"));
  if (isSplitInput) {
    await page.keyboard.type(trimmed, { delay: 20 });
  } else {
    await codeInput.fill(trimmed, { timeout: 5000 });
  }

  const submitted = await clickFirstVisible(page, [
    'button[type="submit"]',
    'button:has-text("Verify")',
    'button:has-text("Continue")',
    'input[type="submit"]',
  ]);

  if (!submitted) {
    await page.keyboard.press("Enter").catch(() => undefined);
  }

  await page
    .waitForLoadState("domcontentloaded", { timeout: 30000 })
    .catch(() => undefined);
}

async function maybeClickGithubAuthorize(page: Page): Promise<void> {
  const authorizeVisible = await page
    .locator('button:has-text("Authorize"), input[name="authorize"]')
    .first()
    .isVisible({ timeout: 4000 })
    .catch(() => false);

  if (!authorizeVisible) {
    return;
  }

  await Promise.all([
    page.waitForLoadState("domcontentloaded", { timeout: 30000 }),
    page
      .locator('button:has-text("Authorize"), input[name="authorize"]')
      .first()
      .click(),
  ]);
}

async function buildLoginResult(finalPage: Page): Promise<LoginResult> {
  const finalUrl = finalPage.url();
  if (finalUrl.includes("/signin")) {
    throw new Error("Still on sign-in page, login likely failed");
  }

  return {
    finalUrl: redactUrl(finalUrl),
    pageTitle: await finalPage.title(),
    finishedAt: new Date().toISOString(),
  };
}

async function continueFromGithubPage(
  context: BrowserContext,
  githubPage: Page,
  verificationCode?: string,
): Promise<LoginResult> {
  await githubPage
    .waitForLoadState("domcontentloaded", { timeout: 30000 })
    .catch(() => undefined);

  const needsVerification = await isVerificationStep(githubPage);

  if (needsVerification) {
    if (!verificationCode) {
      const challenge = await createVerificationChallenge(context, githubPage);
      throw new DeviceVerificationRequiredError(challenge);
    }

    await submitVerificationCode(githubPage, verificationCode);
  }

  await maybeClickGithubAuthorize(githubPage);

  const finalPage = await waitForClawLoggedInPage(context, 90000);
  return buildLoginResult(finalPage);
}

async function performInitialGithubLogin(
  context: BrowserContext,
  cfg: RequiredEnv,
): Promise<Page> {
  const page = await context.newPage();

  await page.goto(cfg.clawSigninUrl, {
    waitUntil: "domcontentloaded",
    timeout: 30000,
  });
  await waitForSigninUiReady(page);

  const popupPromise = page.waitForEvent("popup", { timeout: 12000 }).catch(
    () => null,
  );
  const newPagePromise = context.waitForEvent("page", { timeout: 12000 }).catch(
    () => null,
  );

  const clickedGithub = await clickFirstVisible(page, [
    'a[href*="github"]',
    'button:has-text("GitHub")',
    'a:has-text("GitHub")',
  ]);

  if (!clickedGithub) {
    throw new Error("Cannot find GitHub login entry on Claw sign-in page");
  }

  const githubPage = await resolveGithubAuthPage(
    context,
    page,
    popupPromise,
    newPagePromise,
  );

  await githubPage.locator('input[name="login"]').fill(cfg.githubUsername, {
    timeout: 10000,
  });

  await githubPage.locator('input[name="password"]').fill(cfg.githubPassword, {
    timeout: 10000,
  });

  await Promise.all([
    githubPage.waitForLoadState("domcontentloaded", { timeout: 30000 }),
    githubPage
      .locator('input[name="commit"], button[type="submit"]')
      .first()
      .click(),
  ]);

  return githubPage;
}

export async function loginToClawCloud(): Promise<LoginResult> {
  const cfg = loadConfig();

  const browser = await playwrightChromium.launch({
    args: chromium.args,
    executablePath: await chromium.executablePath(),
    headless: true,
  });
  const context = await browser.newContext();

  try {
    const githubPage = await performInitialGithubLogin(context, cfg);
    return await continueFromGithubPage(context, githubPage, cfg.githubOtp);
  } catch (error) {
    if (error instanceof DeviceVerificationRequiredError) {
      throw error;
    }

    const debug = await getAllPagesDebugState(context);
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Login flow failed: ${message}; pages=${debug}`);
  } finally {
    await context.close().catch(() => undefined);
    await browser.close().catch(() => undefined);
  }
}

export async function submitGithubVerificationCode(
  challengeToken: string,
  verificationCode: string,
): Promise<LoginResult> {
  const challenge = decodeChallengePayload(challengeToken);

  const browser = await playwrightChromium.launch({
    args: chromium.args,
    executablePath: await chromium.executablePath(),
    headless: true,
  });

  const context = await browser.newContext({
    storageState: challenge.storageState,
  });
  const page = await context.newPage();

  try {
    await page.goto(challenge.pageUrl, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });

    if (!(await isVerificationStep(page))) {
      throw new Error("Verification page is no longer available; start keepalive again");
    }

    return await continueFromGithubPage(context, page, verificationCode);
  } catch (error) {
    if (error instanceof DeviceVerificationRequiredError) {
      throw error;
    }

    const debug = await getAllPagesDebugState(context);
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Verification flow failed: ${message}; pages=${debug}`);
  } finally {
    await context.close().catch(() => undefined);
    await browser.close().catch(() => undefined);
  }
}
