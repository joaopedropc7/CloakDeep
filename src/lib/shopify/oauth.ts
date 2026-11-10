import "server-only";

import crypto from "node:crypto";
import { timingSafeEqualStrings } from "@/lib/crypto";

export const SHOP_DOMAIN_PATTERN = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;

export function normalizeShopDomain(input: string): string {
  return input.trim().toLowerCase();
}

export function isValidShopDomain(input: string): boolean {
  return input.length <= 255 && SHOP_DOMAIN_PATTERN.test(normalizeShopDomain(input));
}

export function buildAuthorizeUrl(input: {
  shopDomain: string;
  state: string;
  apiKey: string;
  scopes: string;
  redirectUri: string;
}): string {
  if (!isValidShopDomain(input.shopDomain)) throw new Error("Domínio Shopify inválido.");
  const url = new URL(`https://${input.shopDomain}/admin/oauth/authorize`);
  url.searchParams.set("client_id", input.apiKey);
  url.searchParams.set("scope", input.scopes);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("state", input.state);
  return url.toString();
}

/** Shopify callback HMAC: remove hmac/signature, sort keys, join k=v, HMAC-SHA256. */
export function verifyOAuthHmac(params: URLSearchParams, secret: string): boolean {
  const hmac = params.get("hmac");
  if (!hmac || !/^[a-f0-9]{64}$/i.test(hmac)) return false;

  const pairs: Array<[string, string]> = [];
  for (const [key, value] of params.entries()) {
    if (key === "hmac" || key === "signature") continue;
    pairs.push([key, value]);
  }
  pairs.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const message = pairs.map(([key, value]) => `${key}=${value}`).join("&");
  const digest = crypto.createHmac("sha256", secret).update(message, "utf8").digest("hex");
  return timingSafeEqualStrings(digest, hmac.toLowerCase());
}

export function assertRecentOAuthTimestamp(timestamp: string | null, maxAgeSeconds = 600): boolean {
  if (!timestamp) return false;
  const seconds = Number(timestamp);
  if (!Number.isFinite(seconds)) return false;
  const age = Math.abs(Math.floor(Date.now() / 1000) - seconds);
  return age <= maxAgeSeconds;
}

export class ShopifyOAuthError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ShopifyOAuthError";
    this.status = status;
  }
}

export type AccessTokenResponse = {
  accessToken: string;
  refreshToken: string | null;
  scopes: string[];
  expiresAt: Date | null;
  refreshTokenExpiresAt: Date | null;
};

type RawTokenResponse = {
  access_token?: string;
  refresh_token?: string;
  scope?: string;
  expires_in?: number;
  refresh_token_expires_in?: number;
};

function parseTokenResponse(raw: RawTokenResponse): AccessTokenResponse {
  if (!raw.access_token) throw new Error("Shopify não retornou access_token.");
  const now = Date.now();
  return {
    accessToken: raw.access_token,
    refreshToken: raw.refresh_token ?? null,
    scopes: raw.scope ? raw.scope.split(",").map((scope) => scope.trim()).filter(Boolean) : [],
    expiresAt: typeof raw.expires_in === "number" && raw.expires_in > 0
      ? new Date(now + raw.expires_in * 1000)
      : null,
    refreshTokenExpiresAt:
      typeof raw.refresh_token_expires_in === "number" && raw.refresh_token_expires_in > 0
        ? new Date(now + raw.refresh_token_expires_in * 1000)
        : null,
  };
}

async function tokenRequest(shopDomain: string, body: URLSearchParams): Promise<RawTokenResponse> {
  const response = await fetch(`https://${shopDomain}/admin/oauth/access_token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body,
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw new ShopifyOAuthError(`Troca de token Shopify falhou (HTTP ${response.status}).`, response.status);
  }
  return (await response.json()) as RawTokenResponse;
}

export async function exchangeAuthorizationCode(input: {
  shopDomain: string;
  code: string;
  clientId: string;
  clientSecret: string;
}): Promise<AccessTokenResponse> {
  const raw = await tokenRequest(
    input.shopDomain,
    new URLSearchParams({
      client_id: input.clientId,
      client_secret: input.clientSecret,
      code: input.code,
      expiring: "1",
    }),
  );
  return parseTokenResponse(raw);
}

export async function refreshAccessToken(input: {
  shopDomain: string;
  refreshToken: string;
  clientId: string;
  clientSecret: string;
}): Promise<AccessTokenResponse> {
  const raw = await tokenRequest(
    input.shopDomain,
    new URLSearchParams({
      client_id: input.clientId,
      client_secret: input.clientSecret,
      grant_type: "refresh_token",
      refresh_token: input.refreshToken,
    }),
  );
  return parseTokenResponse(raw);
}

export function missingScopes(granted: string[], required: string[]): string[] {
  return required.filter((scope) => {
    if (granted.includes(scope)) return false;
    if (scope.startsWith("read_") && granted.includes(`write_${scope.slice(5)}`)) return false;
    return true;
  });
}
