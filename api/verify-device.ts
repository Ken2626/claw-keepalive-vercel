import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  DeviceVerificationRequiredError,
  submitGithubVerificationCode,
} from "../lib/clawLogin";
import { hasValidCronSecret } from "../lib/cronAuth";

type VerifyRequestBody = {
  challengeToken?: unknown;
  verificationCode?: unknown;
};

function parseBody(req: VercelRequest): VerifyRequestBody {
  const raw = req.body;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as VerifyRequestBody;
    } catch {
      return {};
    }
  }

  if (raw && typeof raw === "object") {
    return raw as VerifyRequestBody;
  }

  return {};
}

function readStringField(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

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

  const body = parseBody(req);
  const challengeToken = readStringField(body.challengeToken);
  const verificationCode = readStringField(body.verificationCode);

  if (!challengeToken || !verificationCode) {
    res.status(400).json({
      ok: false,
      error: "Missing challengeToken or verificationCode",
    });
    return;
  }

  try {
    const result = await submitGithubVerificationCode(
      challengeToken,
      verificationCode,
    );

    res.status(200).json({
      ok: true,
      message: "Claw Cloud keepalive verification completed",
      finalUrl: result.finalUrl,
      pageTitle: result.pageTitle,
      finishedAt: result.finishedAt,
    });
  } catch (error) {
    if (error instanceof DeviceVerificationRequiredError) {
      res.status(428).json({
        ok: false,
        error: "GitHub verification required",
        challengeToken: error.challengeToken,
        expiresAt: error.expiresAt,
        pageUrl: error.pageUrl,
      });
      return;
    }

    const message = error instanceof Error ? error.message : "Unknown error";
    console.error(`[verify-device] ${message}`);

    res.status(500).json({
      ok: false,
      error: "Verification submit failed",
    });
  }
}
