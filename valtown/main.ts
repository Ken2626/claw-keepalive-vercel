declare const Deno: {
  env: {
    get(name: string): string | undefined;
  };
};

type KeepaliveApiPayload = {
  ok?: boolean;
  error?: string;
  message?: string;
  finalUrl?: string;
  pageTitle?: string;
  finishedAt?: string;
  challengeToken?: string;
};

function buildKeepaliveUrl(vercelUrl: string): string {
  const normalized = /^https?:\/\//i.test(vercelUrl)
    ? vercelUrl
    : `https://${vercelUrl}`;
  const parsed = new URL(normalized);

  if (parsed.pathname.endsWith("/api/keepalive")) {
    return parsed.toString();
  }

  parsed.pathname = parsed.pathname.replace(/\/$/, "") + "/api/keepalive";
  return parsed.toString();
}

function parseJsonMaybe(raw: string): KeepaliveApiPayload | null {
  try {
    return JSON.parse(raw) as KeepaliveApiPayload;
  } catch {
    return null;
  }
}

function summarizeFailure(status: number, rawText: string): string {
  const payload = parseJsonMaybe(rawText);
  if (!payload) {
    return `keepalive failed: ${status} ${rawText}`;
  }

  const safePayload = { ...payload };
  if (safePayload.challengeToken) {
    safePayload.challengeToken = "[redacted]";
  }

  return `keepalive failed: ${status} ${JSON.stringify(safePayload)}`;
}

// Note:
// - Val Town schedule is configured in the Val Town UI, not in this file.
// - This val only defines what to do when the cron trigger fires.
export default async function () {
  const vercelUrl = Deno.env.get("VERCEL_URL")?.trim();
  const cronSecret = Deno.env.get("CRON_SECRET")?.trim();

  if (!vercelUrl) {
    throw new Error("Missing VERCEL_URL in Val Town env");
  }

  if (!cronSecret) {
    throw new Error("Missing CRON_SECRET in Val Town env");
  }

  const apiUrl = buildKeepaliveUrl(vercelUrl);

  const response = await fetch(apiUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cronSecret}`,
      "Content-Type": "application/json",
      "User-Agent": "val-town-claw-keepalive/1.0",
    },
    body: JSON.stringify({ source: "val-town" }),
  });

  const responseText = await response.text();
  if (!response.ok) {
    const failure = summarizeFailure(response.status, responseText);
    console.error(`[cron] ${failure}`);
    throw new Error(failure);
  }

  const payload = parseJsonMaybe(responseText);
  const success = {
    ok: true,
    status: response.status,
    message: payload?.message ?? "Keepalive completed",
    finalUrl: payload?.finalUrl ?? "",
    finishedAt: payload?.finishedAt ?? new Date().toISOString(),
    triggeredAt: new Date().toISOString(),
  };
  console.log(`[cron] success ${JSON.stringify(success)}`);

  return {
    ...success,
    body: responseText,
  };
}
