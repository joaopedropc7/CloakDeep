import { describe, expect, it } from "vitest";
import type { CatalogVariantWithProduct } from "@/lib/db/catalog";
import {
  compareExternalTarget,
  compareShopifyVariants,
  validateExternalUrl,
} from "@/lib/domain/mapping-rules";

function variant(overrides: Partial<CatalogVariantWithProduct> = {}): CatalogVariantWithProduct {
  return {
    id: "v1",
    store_id: "s1",
    product_id: "p1",
    external_id: "gid://shopify/ProductVariant/1",
    sku: "SKU-1",
    title: "Azul / M",
    option_values: [
      { name: "Cor", value: "Azul" },
      { name: "Tamanho", value: "M" },
    ],
    price_amount: "100.000000",
    currency: "BRL",
    available_for_sale: true,
    is_current: true,
    raw: null,
    synced_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    product: {
      id: "p1",
      title: "Camiseta",
      handle: "camiseta",
      external_id: "gid://shopify/Product/1",
    },
    ...overrides,
  };
}

describe("mapping comparison", () => {
  it("detects matching identity, currency and price", () => {
    const comparison = compareShopifyVariants(variant(), variant({ id: "v2" }));
    expect(comparison.currencyMatch).toBe(true);
    expect(comparison.priceMatch).toBe(true);
    expect(comparison.identity.sku).toBe("match");
    expect(comparison.identity.options).toBe("match");
    expect(comparison.warnings).toEqual([]);
  });

  it("surfaces price and currency differences instead of hiding them", () => {
    const comparison = compareShopifyVariants(
      variant(),
      variant({ id: "v2", price_amount: "129.90", currency: "USD", sku: "SKU-2" }),
    );
    expect(comparison.currencyMatch).toBe(false);
    expect(comparison.priceMatch).toBe(false);
    expect(comparison.priceDiff).toBe("29.900000");
    expect(comparison.warnings.join(" ")).toContain("moedas");
    expect(comparison.warnings.join(" ")).toContain("preços");
  });

  it("flags external targets that do not belong to the configured origin", () => {
    expect(
      validateExternalUrl("https://loja-b.com", "https://loja-b.com/produto/1"),
    ).toBe("https://loja-b.com/produto/1");
    expect(() =>
      validateExternalUrl("https://loja-b.com", "https://attacker.example/produto"),
    ).toThrow(/mesmo domínio/);
    expect(() =>
      validateExternalUrl("https://loja-b.com", "http://loja-b.com/produto"),
    ).toThrow(/HTTPS/);
    expect(() =>
      validateExternalUrl("https://loja-b.com", "https://loja-b.com/produto?email=buyer@example.com"),
    ).toThrow(/dados pessoais ou credenciais/);
    expect(() =>
      validateExternalUrl("https://loja-b.com", "https://loja-b.com/produto", {
        allowHttp: true,
      }),
    ).not.toThrow();
  });

  it("requires manual confirmation for external product identity", () => {
    const comparison = compareExternalTarget(
      variant(),
      {
        url: "https://loja-b.com/p",
        title: "Camiseta",
        variantTitle: "Azul / M",
        sku: "SKU-1",
        price: "100.00",
        currency: "BRL",
      },
      "BRL",
    );
    expect(comparison.currencyMatch).toBe(true);
    expect(comparison.identity.options).toBe("unknown");
    expect(comparison.warnings.join(" ")).toContain("Confirme manualmente");
  });
});
