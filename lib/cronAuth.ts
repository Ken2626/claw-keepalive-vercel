import { timingSafeEqual } from "node:crypto";

function parseBearerToken(authorizationHeader: string | undefined): string | null {
  if (!authorizationHeader) {
    return null;
  }

  const match = authorizationHeader.match(/^Bearer\s+(.+)$/i);
  if (!match || !match[1]) {
    return null;
  }

  return match[1].trim();
}

export function hasValidCronSecret(
  authorizationHeader: string | undefined,
  expectedSecret: string | undefined,
): boolean {
  const normalizedExpected = expectedSecret?.trim();
  if (!normalizedExpected) {
    return false;
  }

  const providedToken = parseBearerToken(authorizationHeader);
  if (!providedToken) {
    return false;
  }

  const provided = Buffer.from(providedToken);
  const expected = Buffer.from(normalizedExpected);

  if (provided.length !== expected.length) {
    return false;
  }

  return timingSafeEqual(provided, expected);
}
