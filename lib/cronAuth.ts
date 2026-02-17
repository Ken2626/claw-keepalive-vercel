import { timingSafeEqual } from "node:crypto";

function parseBearerToken(authorizationHeader: string | undefined): string | null {
  if (!authorizationHeader) {
    return null;
  }

  const [scheme, token] = authorizationHeader.split(" ");
  if (scheme !== "Bearer" || !token) {
    return null;
  }

  return token;
}

export function hasValidCronSecret(
  authorizationHeader: string | undefined,
  expectedSecret: string | undefined,
): boolean {
  if (!expectedSecret) {
    return false;
  }

  const providedToken = parseBearerToken(authorizationHeader);
  if (!providedToken) {
    return false;
  }

  const provided = Buffer.from(providedToken);
  const expected = Buffer.from(expectedSecret);

  if (provided.length !== expected.length) {
    return false;
  }

  return timingSafeEqual(provided, expected);
}
