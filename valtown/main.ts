declare const Deno: {
  env: {
    get(name: string): string | undefined;
  };
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
    throw new Error(`keepalive failed: ${response.status} ${responseText}`);
  }

  return {
    ok: true,
    status: response.status,
    body: responseText,
    triggeredAt: new Date().toISOString(),
  };
}
