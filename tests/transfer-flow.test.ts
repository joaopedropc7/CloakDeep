import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  MappingRow,
  StoreRow,
  TransferLine,
  TransferRow,
} from "@/lib/db/types";
import type { CatalogVariantWithProduct } from "@/lib/db/catalog";
import type { CreateTransferInput } from "@/lib/db/transfers";
import type { AdminVariant } from "@/lib/shopify/admin";

const state = vi.hoisted(() => ({
  transfer: null as TransferRow | null,
  created: null as CreateTransferInput | null,
  checkoutCalls: 0,
  sessionCreates: 0,
  failed: null as { code: string; detail: string } | null,
}));

vi.mock("@/lib/db/stores", () => ({
  getStoreByRole: vi.fn(),
  getStoreByRoleForIntegration: vi.fn(),
  getIntegrationForStoreA: vi.fn(),
  getShopifyStoreByDomain: vi.fn(),
  getStoreById: vi.fn(),
}));

vi.mock("@/lib/db/catalog", () => ({
  getVariantByExternalId: vi.fn(),
  getVariantsWithProductByIds: vi.fn(),
}));

vi.mock("@/lib/db/mappings", () => ({
  getMappingById: vi.fn(),
  getMappingsForAVariantIds: vi.fn(),
}));

vi.mock("@/lib/db/transfers", () => ({
  createTransferSession: vi.fn(async (input: CreateTransferInput) => {
    state.created = input;
    state.sessionCreates += 1;
    const transfer: TransferRow = {
      id: "transfer-1",
      token_hash: input.token_hash,
      store_a_id: input.store_a_id,
      store_b_id: input.store_b_id,
      status: "pending",
      lines: input.lines,
      currency: input.currency,
      subtotal: input.subtotal,
      attribution: input.attribution,
      attribution_consent: input.attribution_consent,
      visitor_consent: input.visitor_consent,
      checkout_url: null,
      claim_token: null,
      expires_at: input.expires_at,
      consumed_at: null,
      error_code: null,
      error_detail: null,
      created_at: new Date().toISOString(),
    };
    state.transfer = transfer;
    return transfer;
  }),
  getTransferByTokenHash: vi.fn(async (hash: string) =>
    state.transfer && state.transfer.token_hash === hash ? state.transfer : null,
  ),
  getTransferById: vi.fn(async () => state.transfer),
  claimTransfer: vi.fn(async (_id: string, claimToken: string) => {
    if (!state.transfer || state.transfer.status !== "pending") {
      return { claimed: false, transfer: state.transfer };
    }
    state.transfer = { ...state.transfer, status: "processing", claim_token: claimToken };
    return { claimed: true, transfer: state.transfer };
  }),
  completeTransfer: vi.fn(async (_id: string, checkoutUrl: string) => {
    if (state.transfer) {
      state.transfer = {
        ...state.transfer,
        status: "completed",
        checkout_url: checkoutUrl,
        claim_token: null,
      };
    }
  }),
  failTransfer: vi.fn(async (_id: string, code: string, detail: string) => {
    state.failed = { code, detail };
    if (state.transfer) state.transfer = { ...state.transfer, status: "failed" };
  }),
  expireTransfer: vi.fn(async () => {
    if (state.transfer) state.transfer = { ...state.transfer, status: "expired" };
  }),
}));

vi.mock("@/lib/db/audit", () => ({
  recordAudit: vi.fn(async () => undefined),
}));

vi.mock("@/lib/shopify/admin", () => ({
  fetchLiveVariants: vi.fn(),
}));

import {
  getIntegrationForStoreA,
  getShopifyStoreByDomain,
  getStoreById,
  getStoreByRoleForIntegration,
} from "@/lib/db/stores";
import { getVariantByExternalId, getVariantsWithProductByIds } from "@/lib/db/catalog";
import { getMappingById, getMappingsForAVariantIds } from "@/lib/db/mappings";
import { fetchLiveVariants } from "@/lib/shopify/admin";
import { completeTransferForBuyer, prepareTransfer, TransferError } from "@/lib/services/transfers";

const STORE_A = "store-a";
const STORE_B = "store-b";
const A_VARIANT_ID = "a-variant-uuid";
const B_VARIANT_ID = "b-variant-uuid";
const A_GID = "gid://shopify/ProductVariant/101";
const B_GID = "gid://shopify/ProductVariant/202";

function storeA(): StoreRow {
  return {
    id: STORE_A,
    role: "a",
    store_type: "storefront",
    platform: "shopify",
    name: "Loja A",
    shop_domain: "loja-a.myshopify.com",
    primary_domain: "loja-a.com",
    currency: "BRL",
    admin_token_cipher: "x",
    refresh_token_cipher: null,
    token_expires_at: null,
    refresh_token_expires_at: null,
    scopes: ["read_products"],
    storefront_token_cipher: null,
    storefront_token_kind: null,
    storefront_api_version: null,
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

function storeB(): StoreRow {
  return {
    ...storeA(),
    id: STORE_B,
    role: "b",
    name: "Loja B",
    shop_domain: "loja-b.myshopify.com",
    primary_domain: "loja-b.com",
    storefront_token_cipher: "encrypted-storefront-token",
    storefront_token_kind: "private",
    storefront_api_version: "2026-10",
  };
}

function aVariant(overrides: Partial<CatalogVariantWithProduct> = {}): CatalogVariantWithProduct {
  return {
    id: A_VARIANT_ID,
    store_id: STORE_A,
    product_id: "product-a",
    external_id: A_GID,
    sku: "SKU-1",
    title: "Azul / M",
    option_values: [{ name: "Cor", value: "Azul" }],
    price_amount: "100.000000",
    currency: "BRL",
    available_for_sale: true,
    is_current: true,
    raw: null,
    synced_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    product: {
      id: "product-a",
      title: "Camiseta",
      handle: "camiseta",
      external_id: "gid://shopify/Product/1",
    },
    ...overrides,
  };
}

function bVariant(): CatalogVariantWithProduct {
  return {
    ...aVariant(),
    id: B_VARIANT_ID,
    store_id: STORE_B,
    product_id: "product-b",
    external_id: B_GID,
    price_amount: "120.000000",
    product: {
      id: "product-b",
      title: "Camiseta",
      handle: "camiseta",
      external_id: "gid://shopify/Product/2",
    },
  };
}

function mapping(): MappingRow {
  return {
    id: "mapping-1",
    integration_id: "integration-1",
    store_a_id: STORE_A,
    store_a_variant_id: A_VARIANT_ID,
    store_b_id: STORE_B,
    store_b_variant_id: B_VARIANT_ID,
    mode: "shopify",
    status: "active",
    currency_a: "BRL",
    currency_b: "BRL",
    price_a: "100.000000",
    price_b: "120.000000",
    price_diff: "20.000000",
    price_diff_percent: "20.000000",
    external_product_url: null,
    external_product_title: null,
    external_variant_title: null,
    external_sku: null,
    identity_ack: true,
    price_ack: true,
    notes: null,
    activated_at: new Date().toISOString(),
    last_checked_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

function liveVariant(input: {
  gid: string;
  price: string;
  status?: string;
  available?: boolean;
}): AdminVariant {
  return {
    id: input.gid,
    title: "Azul / M",
    sku: "SKU-1",
    price: input.price,
    availableForSale: input.available ?? true,
    options: [{ name: "Cor", value: "Azul" }],
    product: {
      id: "product",
      title: "Camiseta",
      handle: "camiseta",
      status: input.status ?? "ACTIVE",
    },
  };
}

function setupHappyPath(options: { aPrice?: string; bPrice?: string } = {}) {
  vi.mocked(getShopifyStoreByDomain).mockResolvedValue(storeA());
  vi.mocked(getIntegrationForStoreA).mockResolvedValue({
    id: "integration-1",
    name: "Integração",
    storefront_id: STORE_A,
    checkout_id: "store-b",
    status: "active",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
  vi.mocked(getStoreByRoleForIntegration).mockResolvedValue(storeB());
  vi.mocked(getStoreById).mockImplementation(async (id) => (id === STORE_A ? storeA() : storeB()));
  vi.mocked(getVariantByExternalId).mockResolvedValue(aVariant());
  vi.mocked(getMappingsForAVariantIds).mockResolvedValue([mapping()]);
  vi.mocked(getMappingById).mockResolvedValue(mapping());
  vi.mocked(getVariantsWithProductByIds).mockResolvedValue([bVariant()]);
  vi.mocked(fetchLiveVariants).mockImplementation(async (store) => {
    const map = new Map<string, AdminVariant>();
    if (store.id === STORE_A) {
      map.set(
        A_GID,
        liveVariant({ gid: A_GID, price: options.aPrice ?? "100.00" }),
      );
    } else {
      map.set(
        B_GID,
        liveVariant({ gid: B_GID, price: options.bPrice ?? "120.00" }),
      );
    }
    return map;
  });
}

beforeEach(() => {
  state.transfer = null;
  state.created = null;
  state.checkoutCalls = 0;
  state.sessionCreates = 0;
  state.failed = null;
  vi.clearAllMocks();
  setupHappyPath();
});

describe("transfer business flow", () => {
  it("prepares a fully validated cart and creates the Store B checkout", async () => {
    const prepared = await prepareTransfer({
      shopDomain: "loja-a.myshopify.com",
      items: [{ variantId: A_GID, quantity: 2 }],
      attribution: { utm_source: "meta", utm_campaign: "verao" },
      marketingConsent: true,
    });

    expect(prepared.lineCount).toBe(1);
    expect(prepared.subtotal).toContain("240");
    expect(state.created).not.toBeNull();
    const line = state.created!.lines[0] as TransferLine;
    expect(line.aVariantExternalId).toBe(A_GID);
    expect(line.bVariantExternalId).toBe(B_GID);
    expect(line.unitPriceB).toBe("120.000000");
    expect(state.created!.attribution).toEqual({
      utm_source: "meta",
      utm_campaign: "verao",
    });

    const completed = await completeTransferForBuyer({
      token: prepared.token,
      attributionConsent: true,
      buyerIp: "203.0.113.9",
    });

    expect(completed.checkoutUrl).toContain("https://loja-b.com/cart/202:2");
    expect(completed.checkoutUrl).toContain("utm_source=meta");
    expect(completed.checkoutUrl).toContain("utm_campaign=verao");
    expect(state.transfer?.status).toBe("completed");
  });

  it("blocks the entire transfer when one item is not mapped and explains why", async () => {
    vi.mocked(getMappingsForAVariantIds).mockResolvedValue([]);
    await expect(
      prepareTransfer({
        shopDomain: "loja-a.myshopify.com",
        items: [{ variantId: A_GID, quantity: 1 }],
        marketingConsent: true,
      }),
    ).rejects.toMatchObject({
      code: "TRANSFER_BLOCKED",
      issues: [expect.objectContaining({ code: "NOT_MAPPED", productTitle: "Camiseta" })],
    });
    expect(state.sessionCreates).toBe(0);
  });

  it("blocks when the live Store A price differs from the activated mapping", async () => {
    setupHappyPath({ aPrice: "99.00" });
    await expect(
      prepareTransfer({
        shopDomain: "loja-a.myshopify.com",
        items: [{ variantId: A_GID, quantity: 1 }],
      }),
    ).rejects.toMatchObject({
      code: "TRANSFER_BLOCKED",
      issues: [expect.objectContaining({ code: "SOURCE_PRICE_CHANGED" })],
    });
    expect(state.sessionCreates).toBe(0);
  });

  it("blocks when the destination price changed", async () => {
    setupHappyPath({ bPrice: "130.00" });
    await expect(
      prepareTransfer({
        shopDomain: "loja-a.myshopify.com",
        items: [{ variantId: A_GID, quantity: 1 }],
      }),
    ).rejects.toMatchObject({
      code: "TRANSFER_BLOCKED",
      issues: [expect.objectContaining({ code: "DESTINATION_PRICE_CHANGED" })],
    });
  });

  it("does not forward attribution without buyer consent on the bridge", async () => {
    const prepared = await prepareTransfer({
      shopDomain: "loja-a.myshopify.com",
      items: [{ variantId: A_GID, quantity: 1 }],
      attribution: { utm_source: "meta" },
      marketingConsent: true,
    });
    const completed = await completeTransferForBuyer({
      token: prepared.token,
      attributionConsent: false,
    });
    expect(completed.checkoutUrl).toContain("https://loja-b.com/cart/202:1");
    expect(completed.checkoutUrl).not.toContain("utm_source");
  });

  it("is idempotent for an already completed transfer", async () => {
    const prepared = await prepareTransfer({
      shopDomain: "loja-a.myshopify.com",
      items: [{ variantId: A_GID, quantity: 1 }],
    });
    const first = await completeTransferForBuyer({ token: prepared.token, attributionConsent: false });
    const second = await completeTransferForBuyer({ token: prepared.token, attributionConsent: false });
    expect(second.checkoutUrl).toBe(first.checkoutUrl);
    expect(first.checkoutUrl).toContain("https://loja-b.com/cart/202:1");
  });

  it("rejects unknown transfer tokens", async () => {
    state.transfer = null;
    await expect(
      completeTransferForBuyer({ token: "unknown-token-value-1234567890", attributionConsent: false }),
    ).rejects.toBeInstanceOf(TransferError);
  });

  it("blocks an external destination from cart transfer", async () => {
    const external = { ...storeB(), platform: "external" as const, shop_domain: null, external_base_url: "https://loja-b.com" };
    vi.mocked(getStoreByRoleForIntegration).mockResolvedValue(external);
    await expect(
      prepareTransfer({
        shopDomain: "loja-a.myshopify.com",
        items: [{ variantId: A_GID, quantity: 1 }],
      }),
    ).rejects.toMatchObject({ code: "EXTERNAL_NO_CART" });
  });
});
