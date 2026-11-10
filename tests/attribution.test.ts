import { describe, expect, it } from "vitest";
import {
  appendAttributionToUrl,
  extractAttributionFromQuery,
  sanitizeAttribution,
} from "@/lib/domain/attribution";

describe("attribution sanitization", () => {
  it("keeps allowlisted campaign parameters", () => {
    const result = sanitizeAttribution({
      utm_source: "meta",
      utm_campaign: "lancamento",
      gclid: "abc123",
      email: "buyer@example.com",
      foo: "bar",
    });
    expect(result).toEqual({
      utm_source: "meta",
      utm_campaign: "lancamento",
      gclid: "abc123",
    });
  });

  it("rejects PII-looking and credential-looking values", () => {
    const result = sanitizeAttribution({
      utm_source: "buyer@example.com",
      utm_campaign: "shpat_1234567890",
      utm_term: "4111111111111111",
      utm_content: "campanha ok",
    });
    expect(result).toEqual({ utm_content: "campanha ok" });
  });

  it("extracts only allowlisted values from a query string", () => {
    const result = extractAttributionFromQuery(
      "?utm_source=google&utm_medium=cpc&telefone=11999999999&session=abc",
    );
    expect(result).toEqual({ utm_source: "google", utm_medium: "cpc" });
  });

  it("preserves Shopify _cs consent parameter when appending attribution", () => {
    const url = appendAttributionToUrl(
      "https://store-b.myshopify.com/cart/c/abc?_cs=consent-token",
      { utm_source: "instagram", utm_campaign: "verao" },
    );
    const parsed = new URL(url);
    expect(parsed.searchParams.get("_cs")).toBe("consent-token");
    expect(parsed.searchParams.get("utm_source")).toBe("instagram");
    expect(parsed.searchParams.get("utm_campaign")).toBe("verao");
  });
});
