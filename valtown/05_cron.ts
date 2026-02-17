declare const Deno: {
  env: {
    get(name: string): string | undefined;
  };
};

// Note:
// - Val Town schedule is configured in the Val Town UI, not in this file.
// - This val only defines what to do when the cron trigger fires.
export default async function () {
  const apiUrl = Deno.env.get("VERCEL_KEEPALIVE_URL");
  const cronSecret = Deno.env.get("CRON_SECRET");

  if (!apiUrl) {
    throw new Error("Missing VERCEL_KEEPALIVE_URL in Val Town env");
  }

  if (!cronSecret) {
    throw new Error("Missing CRON_SECRET in Val Town env");
  }

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
