import chromium from "@sparticuz/chromium";
import {
  chromium as playwrightChromium,
  type BrowserContext,
  type Page,
} from "playwright-core";

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

const GITHUB_AUTH_URL_RE = /github\.com\/(login|session|sessions|authorize)/i;
const CLAW_URL_RE = /run\.claw\.cloud\//i;
const CLAW_SIGNIN_PATH_RE = /\/signin(?:\/|$)/i;

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
    await candidate.waitForLoadState("domcontentloaded", { timeout: 30000 }).catch(() => undefined);
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
        await p.waitForLoadState("domcontentloaded", { timeout: 5000 }).catch(() => undefined);
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
    .waitForFunction(() => Boolean(document.title && document.title.trim().length > 0), undefined, {
      timeout: 30000,
    })
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

export async function loginToClawCloud(): Promise<LoginResult> {
  const cfg = loadConfig();

  const browser = await playwrightChromium.launch({
    args: chromium.args,
    executablePath: await chromium.executablePath(),
    headless: true,
  });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
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

    const otpInput = githubPage
      .locator('input[name="app_otp"], input#otp, input[name="otp"]')
      .first();
    const otpVisible = await otpInput.isVisible({ timeout: 5000 }).catch(() => false);

    if (otpVisible) {
      if (!cfg.githubOtp) {
        throw new Error("GitHub OTP required but GITHUB_OTP is not set");
      }

      await otpInput.fill(cfg.githubOtp);
      await Promise.all([
        githubPage.waitForLoadState("domcontentloaded", { timeout: 30000 }),
        otpInput.press("Enter"),
      ]);
    }

    const authorizeVisible = await githubPage
      .locator('button:has-text("Authorize"), input[name="authorize"]')
      .first()
      .isVisible({ timeout: 4000 })
      .catch(() => false);

    if (authorizeVisible) {
      await Promise.all([
        githubPage.waitForLoadState("domcontentloaded", { timeout: 30000 }),
        githubPage
          .locator('button:has-text("Authorize"), input[name="authorize"]')
          .first()
          .click(),
      ]);
    }

    const finalPage = await waitForClawLoggedInPage(context, 90000);

    const finalUrl = finalPage.url();
    if (finalUrl.includes("/signin")) {
      throw new Error("Still on sign-in page, login likely failed");
    }

    return {
      finalUrl: redactUrl(finalUrl),
      pageTitle: await finalPage.title(),
      finishedAt: new Date().toISOString(),
    };
  } catch (error) {
    const debug = await getAllPagesDebugState(context);
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Login flow failed: ${message}; pages=${debug}`,
    );
  } finally {
    await context.close().catch(() => undefined);
    await browser.close().catch(() => undefined);
  }
}
