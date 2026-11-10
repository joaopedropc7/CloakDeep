import { describe, expect, it } from "vitest";
import { buildCartPermalink } from "@/lib/shopify/cart-permalink";
import type { StoreRow, TransferLine } from "@/lib/db/types";

const store = {
  platform: "shopify",
  shop_domain: "loja-b.myshopify.com",
  primary_domain: null,
} as StoreRow;

const lines = [
  { bVariantExternalId: "gid://shopify/ProductVariant/123", quantity: 2 },
  { bVariantExternalId: "gid://shopify/ProductVariant/456", quantity: 1 },
] as TransferLine[];

describe("Shopify cart permalink", () => {
  it("builds a multi-item checkout permalink", () => {
    expect(buildCartPermalink(store, lines)).toBe(
      "https://loja-b.myshopify.com/cart/123:2,456:1",
    );
  });

  it("uses the primary domain when available", () => {
    expect(buildCartPermalink({ ...store, primary_domain: "loja-b.com" }, lines)).toBe(
      "https://loja-b.com/cart/123:2,456:1",
    );
  });

  it("rejects malformed destination variants", () => {
    expect(() =>
      buildCartPermalink(store, [{ bVariantExternalId: "bad", quantity: 1 }] as TransferLine[]),
    ).toThrow(/inválida/);
  });
});
