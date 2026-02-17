import type { VercelRequest, VercelResponse } from "@vercel/node";
import { loginToClawCloud } from "../lib/clawLogin";
import { hasValidCronSecret } from "../lib/cronAuth";

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  if (req.method !== "POST") {
    res.status(405).json({ ok: false, error: "Method not allowed" });
    return;
  }

  if (
    !hasValidCronSecret(req.headers.authorization, process.env.CRON_SECRET)
  ) {
    res.status(401).json({ ok: false, error: "Unauthorized" });
    return;
  }

  try {
    const result = await loginToClawCloud();
    res.status(200).json({
      ok: true,
      message: "Claw Cloud keepalive login completed",
      finalUrl: result.finalUrl,
      pageTitle: result.pageTitle,
      finishedAt: result.finishedAt,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error(`[keepalive] ${message}`);

    res.status(500).json({
      ok: false,
      error: "Keepalive login failed",
    });
  }
}
