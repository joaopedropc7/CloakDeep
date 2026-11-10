import { afterEach, describe, expect, it, vi } from "vitest";
import { encryptSecret } from "@/lib/crypto";
import type { StoreRow } from "@/lib/db/types";
import {
  assertCheckoutUrl,
  createDestinationCart,
  StorefrontApiError,
} from "@/lib/shopify/storefront";

function store(): StoreRow {
  const shopDomain = "loja-b.myshopify.com";
  return {
    id: "store-b",
    role: "b",
    store_type: "checkout",
    platform: "shopify",
    name: "Loja B",
    shop_domain: shopDomain,
    primary_domain: "loja-b.com",
    currency: "BRL",
    admin_token_cipher: null,
    refresh_token_cipher: null,
    token_expires_at: null,
    refresh_token_expires_at: null,
    scopes: ["read_products"],
    storefront_token_cipher: encryptSecret("shpss_private_token", `storefront:${shopDomain}`),
    storefront_token_kind: "private",
    storefront_api_version: "2026-10",
    external_base_url: null,
    shopify_client_id: "client-id",
    shopify_client_secret_cipher: "client-secret-cipher",
    shopify_scopes: "read_products,write_themes",
    last_check_at: null,
    last_check_error: null,
    last_sync_attempt_at: null,
    status: "active",
    connected_at: null,
    last_synced_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

function cartResponse(overrides: {
  subtotal?: string;
  currency?: string;
  quantity?: number;
  merchandiseId?: string;
} = {}) {
  return {
    data: {
      cartCreate: {
        cart: {
          id: "gid://shopify/Cart/1?key=secret",
          checkoutUrl: "https://loja-b.myshopify.com/cart/c/abc?_cs=consent",
          totalQuantity: overrides.quantity ?? 2,
          cost: {
            subtotalAmount: { amount: overrides.subtotal ?? "200.00", currencyCode: overrides.currency ?? "BRL" },
            totalAmount: { amount: "200.00", currencyCode: overrides.currency ?? "BRL" },
          },
          lines: {
            nodes: [
              {
                id: "gid://shopify/CartLine/1",
                quantity: overrides.quantity ?? 2,
                merchandise: {
                  id: overrides.merchandiseId ?? "gid://shopify/ProductVariant/2",
                },
              },
            ],
          },
        },
        userErrors: [],
        warnings: [],
      },
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Storefront cart creation", () => {
  it("uses the private token, buyer IP and mapped price", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify(cartResponse()), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await createDestinationCart({
      store: store(),
      lines: [
        {
          variantId: "gid://shopify/ProductVariant/2",
          quantity: 2,
          expectedUnitPrice: "100.00",
        },
      ],
      attributes: { csb_transfer_id: "transfer-1" },
      marketingConsent: true,
      buyerIp: "203.0.113.10",
    });

    expect(result.checkoutUrl).toContain("_cs=consent");
    expect(result.totalQuantity).toBe(2);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://loja-b.myshopify.com/api/2026-10/graphql.json");
    const headers = init.headers as Record<string, string>;
    expect(headers["Shopify-Storefront-Private-Token"]).toBe("shpss_private_token");
    expect(headers["Shopify-Storefront-Buyer-IP"]).toBe("203.0.113.10");
    const body = JSON.parse(String(init.body));
    expect(body.query).toContain("@inContext(visitorConsent: $consent)");
    expect(body.variables.input.lines[0]).toMatchObject({
      quantity: 2,
      merchandiseId: "gid://shopify/ProductVariant/2",
    });
    expect(body.variables.consent).toEqual({ marketing: true });
  });

  it("aborts when Shopify charges more than the mapped subtotal", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify(cartResponse({ subtotal: "220.00" })), { status: 200 }),
      ),
    );
    await expect(
      createDestinationCart({
        store: store(),
        lines: [
          {
            variantId: "gid://shopify/ProductVariant/2",
            quantity: 2,
            expectedUnitPrice: "100.00",
          },
        ],
        attributes: { utm_source: "meta" },
        marketingConsent: false,
      }),
    ).rejects.toMatchObject({ code: "PRICE_CHANGED_DURING_CART_CREATION" });
  });

  it("rejects checkout URLs on an unrelated domain", () => {
    expect(() =>
      assertCheckoutUrl("https://attacker.example/cart/c/abc", store()),
    ).toThrow(StorefrontApiError);
    expect(() =>
      assertCheckoutUrl("http://loja-b.com/cart/c/abc", store()),
    ).toThrow(StorefrontApiError);
  });

  it("rejects cart lines with an unexpected variant", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify(cartResponse({ merchandiseId: "gid://shopify/ProductVariant/999" })),
          { status: 200 },
        ),
      ),
    );
    await expect(
      createDestinationCart({
        store: store(),
        lines: [
          {
            variantId: "gid://shopify/ProductVariant/2",
            quantity: 2,
            expectedUnitPrice: "100.00",
          },
        ],
        attributes: {},
        marketingConsent: false,
      }),
    ).rejects.toMatchObject({ code: "UNEXPECTED_CART_LINE" });
  });
});
