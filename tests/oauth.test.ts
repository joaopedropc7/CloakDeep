import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  assertRecentOAuthTimestamp,
  isValidShopDomain,
  missingScopes,
  verifyOAuthHmac,
} from "@/lib/shopify/oauth";

const SECRET = "test-client-secret";

function signedParams(values: Record<string, string>): URLSearchParams {
  const pairs = Object.entries(values)
    .filter(([key]) => key !== "hmac")
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const message = pairs.map(([key, value]) => `${key}=${value}`).join("&");
  const hmac = crypto.createHmac("sha256", SECRET).update(message).digest("hex");
  return new URLSearchParams({ ...values, hmac });
}

describe("Shopify OAuth", () => {
  it("accepts only anchored .myshopify.com domains", () => {
    expect(isValidShopDomain("loja-a.myshopify.com")).toBe(true);
    expect(isValidShopDomain("loja-a.myshopify.com.attacker.example")).toBe(false);
    expect(isValidShopDomain("https://loja-a.myshopify.com")).toBe(false);
    expect(isValidShopDomain("admin.shopify.com")).toBe(false);
  });

  it("verifies the callback HMAC over sorted params", () => {
    const params = signedParams({
      code: "code-123",
      shop: "loja-a.myshopify.com",
      state: "nonce",
      timestamp: String(Math.floor(Date.now() / 1000)),
    });
    expect(verifyOAuthHmac(params, SECRET)).toBe(true);
    params.set("shop", "outra.myshopify.com");
    expect(verifyOAuthHmac(params, SECRET)).toBe(false);
  });

  it("rejects stale timestamps", () => {
    const now = Math.floor(Date.now() / 1000);
    expect(assertRecentOAuthTimestamp(String(now))).toBe(true);
    expect(assertRecentOAuthTimestamp(String(now - 4000))).toBe(false);
  });

  it("treats a write scope as satisfying its read counterpart", () => {
    expect(missingScopes(["write_products"], ["read_products"])).toEqual([]);
    expect(missingScopes(["read_products"], ["read_products", "read_orders"])).toEqual([
      "read_orders",
    ]);
  });
});
