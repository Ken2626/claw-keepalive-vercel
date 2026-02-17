declare const Deno: {
  env: {
    get(name: string): string | undefined;
  };
};

type ApiResponse = {
  status: number;
  bodyText: string;
  json: Record<string, unknown> | null;
};

function buildApiUrl(vercelUrl: string, path: string): string {
  const normalized = /^https?:\/\//i.test(vercelUrl)
    ? vercelUrl
    : `https://${vercelUrl}`;
  const parsed = new URL(normalized);
  parsed.pathname = path;
  parsed.search = "";
  return parsed.toString();
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function pageTemplate(title: string, body: string): Response {
  return new Response(
    `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif; margin: 32px auto; max-width: 760px; line-height: 1.5; padding: 0 16px; }
    .card { border: 1px solid #ddd; border-radius: 10px; padding: 16px; margin-bottom: 16px; }
    code { background: #f5f5f5; padding: 2px 6px; border-radius: 6px; }
    input { width: 100%; max-width: 280px; padding: 8px; font-size: 14px; margin: 8px 0 12px; }
    button { padding: 8px 14px; font-size: 14px; }
    .ok { color: #17643a; }
    .err { color: #9f1d1d; }
    pre { white-space: pre-wrap; word-break: break-word; background: #fafafa; border: 1px solid #eee; border-radius: 8px; padding: 10px; }
  </style>
</head>
<body>
  <h1>${escapeHtml(title)}</h1>
  ${body}
</body>
</html>`,
    {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
    },
  );
}

async function postJson(
  url: string,
  cronSecret: string,
  payload: Record<string, unknown>,
): Promise<ApiResponse> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cronSecret}`,
      "Content-Type": "application/json",
      "User-Agent": "val-town-claw-first-login/1.0",
    },
    body: JSON.stringify(payload),
  });

  const bodyText = await response.text();
  let json: Record<string, unknown> | null = null;
  try {
    json = JSON.parse(bodyText) as Record<string, unknown>;
  } catch {
    json = null;
  }

  return { status: response.status, bodyText, json };
}

function renderStartPage(): Response {
  return pageTemplate(
    "Claw First Login",
    `<div class="card">
  <p>Click start to run first login. If GitHub asks for a manual verification code (for example verified-device email code), this page will ask you to input it.</p>
  <p><a href="?run=1"><button>Start first login</button></a></p>
</div>`,
  );
}

function renderSuccessPage(result: ApiResponse): Response {
  return pageTemplate(
    "First Login Success",
    `<div class="card">
  <p class="ok">Login completed successfully.</p>
  <pre>${escapeHtml(result.bodyText)}</pre>
  <p><a href="?run=1"><button>Run again</button></a></p>
</div>`,
  );
}

function renderChallengePage(
  challengeToken: string,
  expiresAt: string,
  pageUrl: string,
  errorMessage = "",
): Response {
  const hint = errorMessage
    ? `<p class=\"err\">${escapeHtml(errorMessage)}</p>`
    : "";

  return pageTemplate(
    "GitHub Verification Required",
    `<div class="card">
  <p>GitHub asked for a verification code.</p>
  ${hint}
  <p>Page: <code>${escapeHtml(pageUrl || "unknown")}</code></p>
  <p>Token expires at: <code>${escapeHtml(expiresAt || "unknown")}</code></p>
  <form method="POST">
    <input type="hidden" name="challengeToken" value="${escapeHtml(challengeToken)}" />
    <label>Verification code</label><br />
    <input name="verificationCode" placeholder="Enter verification code" autocomplete="one-time-code" />
    <br />
    <button type="submit">Submit code</button>
  </form>
</div>`,
  );
}

function renderErrorPage(title: string, message: string, details: string): Response {
  return pageTemplate(
    title,
    `<div class="card">
  <p class="err">${escapeHtml(message)}</p>
  <pre>${escapeHtml(details)}</pre>
  <p><a href="?run=1"><button>Try again</button></a></p>
</div>`,
  );
}

export default async function (req: Request): Promise<Response> {
  const vercelUrl = Deno.env.get("VERCEL_URL")?.trim();
  const cronSecret = Deno.env.get("CRON_SECRET")?.trim();

  if (!vercelUrl) {
    return renderErrorPage(
      "Config Error",
      "Missing VERCEL_URL in Val Town env",
      "Set VERCEL_URL=https://<your-project>.vercel.app/",
    );
  }

  if (!cronSecret) {
    return renderErrorPage(
      "Config Error",
      "Missing CRON_SECRET in Val Town env",
      "Set CRON_SECRET to the same value used in Vercel.",
    );
  }

  const keepaliveUrl = buildApiUrl(vercelUrl, "/api/keepalive");
  const verifyUrl = buildApiUrl(vercelUrl, "/api/verify-device");

  if (req.method === "GET") {
    const run = new URL(req.url).searchParams.get("run");
    if (run !== "1") {
      return renderStartPage();
    }

    const result = await postJson(keepaliveUrl, cronSecret, {
      source: "val-town-first-login",
    });

    if (result.status === 200) {
      return renderSuccessPage(result);
    }

    if (result.status === 428 && result.json) {
      const challengeToken = asString(result.json.challengeToken);
      if (challengeToken) {
        return renderChallengePage(
          challengeToken,
          asString(result.json.expiresAt),
          asString(result.json.pageUrl),
        );
      }
    }

    return renderErrorPage(
      "First Login Failed",
      `keepalive failed: ${result.status}`,
      result.bodyText,
    );
  }

  if (req.method === "POST") {
    const form = await req.formData();
    const challengeToken = asString(form.get("challengeToken")).trim();
    const verificationCode = asString(form.get("verificationCode")).trim();

    if (!challengeToken) {
      return renderErrorPage(
        "Submit Failed",
        "Missing challenge token",
        "Please restart first login.",
      );
    }

    if (!verificationCode) {
      return renderChallengePage(
        challengeToken,
        "",
        "",
        "Verification code cannot be empty.",
      );
    }

    const result = await postJson(verifyUrl, cronSecret, {
      challengeToken,
      verificationCode,
      source: "val-town-first-login",
    });

    if (result.status === 200) {
      return renderSuccessPage(result);
    }

    if (result.status === 428 && result.json) {
      const newChallenge = asString(result.json.challengeToken);
      if (newChallenge) {
        return renderChallengePage(
          newChallenge,
          asString(result.json.expiresAt),
          asString(result.json.pageUrl),
          "Code not accepted yet. Please retry with the latest code.",
        );
      }
    }

    return renderErrorPage(
      "Verification Failed",
      `verify failed: ${result.status}`,
      result.bodyText,
    );
  }

  return new Response("Method not allowed", { status: 405 });
}
