import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StoreRow } from "@/lib/db/types";
import { stripLegacyIntegration } from "@/lib/services/theme-install";

const state = vi.hoisted(() => ({
  layout: "<html><body><main>Hello</main></body></html>",
  calls: [] as Array<{ query: string; variables?: Record<string, unknown> }>,
  upsertVariables: null as Record<string, unknown> | null,
  begin: null as Record<string, unknown> | null,
  installed: false,
  failed: null as string | null,
  skipped: null as string | null,
}));

vi.mock("@/lib/db/audit", () => ({ recordAudit: vi.fn(async () => undefined) }));
vi.mock("@/lib/db/theme-installations", () => ({
  beginThemeInstall: vi.fn(async (input: Record<string, unknown>) => {
    state.begin = input;
  }),
  getThemeInstallation: vi.fn(async () => null),
  markThemeInstalled: vi.fn(async () => {
    state.installed = true;
  }),
  markThemeFailed: vi.fn(async (_id: string, message: string) => {
    state.failed = message;
  }),
  markThemeSkipped: vi.fn(async (_id: string, message: string) => {
    state.skipped = message;
  }),
  markThemeRolledBack: vi.fn(async () => undefined),
}));

vi.mock("@/lib/shopify/admin", () => {
  class ShopifyApiError extends Error {
    code: string | null;
    status: number | null;
    retryable: boolean;
    constructor(
      message: string,
      options: { code?: string | null; status?: number | null; retryable?: boolean } = {},
    ) {
      super(message);
      this.code = options.code ?? null;
      this.status = options.status ?? null;
      this.retryable = options.retryable ?? false;
    }
  }
  return {
    adminGraphql: vi.fn(async (_store: StoreRow, options: { query: string; variables?: Record<string, unknown> }) => {
      state.calls.push(options);
      if (options.query.includes("MainTheme")) {
        return {
          themes: {
            nodes: [
              {
                id: "gid://shopify/OnlineStoreTheme/1",
                name: "Dawn",
                role: "MAIN",
                processing: false,
                processingFailed: false,
              },
            ],
          },
        };
      }
      if (options.query.includes("ThemeLayout")) {
        return {
          theme: {
            files: {
              nodes: [{ filename: "layout/theme.liquid", body: { content: state.layout } }],
            },
          },
        };
      }
      if (options.query.includes("UpsertBridgeTheme")) {
        state.upsertVariables = options.variables ?? null;
        return {
          themeFilesUpsert: {
            job: { id: "gid://shopify/Job/1" },
            upsertedThemeFiles: [],
            userErrors: [],
          },
        };
      }
      throw new Error("unexpected query");
    }),
    ShopifyApiError,
  };
});

import { adminGraphql } from "@/lib/shopify/admin";
import { installThemeIntegration } from "@/lib/services/theme-install";

function store(overrides: Partial<StoreRow> = {}): StoreRow {
  return {
    id: "store-a",
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
    scopes: ["read_products", "write_themes"],
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
    ...overrides,
  };
}

beforeEach(() => {
  state.layout = "<html><body><main>Hello</main></body></html>";
  state.calls = [];
  state.upsertVariables = null;
  state.begin = null;
  state.installed = false;
  state.failed = null;
  state.skipped = null;
  vi.clearAllMocks();
});

describe("automatic theme installation", () => {
  it("injects the render before </body> and uploads snippet/assets", async () => {
    const result = await installThemeIntegration(store());
    expect(result.status).toBe("installed");
    expect(state.installed).toBe(true);
    expect(state.begin?.backupLayout).toBe(state.layout);

    const files = (state.upsertVariables?.files ?? []) as Array<{
      filename: string;
      body: { type: string; value: string };
    }>;
    const names = files.map((file) => file.filename);
    expect(names).toContain("snippets/cross-store-bridge.liquid");
    expect(names).toContain("assets/cross-store.js");
    expect(names).toContain("assets/cross-store.css");
    expect(names).toContain("layout/theme.liquid");

    const layout = files.find((file) => file.filename === "layout/theme.liquid")!;
    expect(layout.body.value).toContain("CSB_THEME_INSTALL_V1");
    expect(layout.body.value).toContain("{% render 'cross-store-bridge' %}");
    expect(layout.body.value.indexOf("CSB_THEME_INSTALL_V1")).toBeLessThan(
      layout.body.value.indexOf("</body>"),
    );

    const snippet = files.find((file) => file.filename === "snippets/cross-store-bridge.liquid")!;
    expect(snippet.body.value).toContain("https://app.test");
    expect(snippet.body.value).toContain("data-csb-config");
  });

  it("is idempotent when the marker already exists", async () => {
    state.layout =
      "<html><body>{%- comment -%} CSB_THEME_INSTALL_V1 {%- endcomment -%}{% render 'cross-store-bridge' %}</body></html>";
    const result = await installThemeIntegration(store());
    expect(result.status).toBe("installed");
    const files = (state.upsertVariables?.files ?? []) as Array<{ filename: string }>;
    expect(files.map((file) => file.filename)).not.toContain("layout/theme.liquid");
    expect(state.begin?.backupLayout).toBeNull();
  });

  it("skips when write_themes was not granted", async () => {
    const result = await installThemeIntegration(
      store({ scopes: ["read_products"] }),
    );
    expect(result.status).toBe("skipped");
    expect(state.skipped).toContain("write_themes");
    expect(vi.mocked(adminGraphql)).not.toHaveBeenCalled();
  });

  it("records a failure when Shopify denies theme access", async () => {
    vi.mocked(adminGraphql).mockRejectedValueOnce(
      new (await import("@/lib/shopify/admin")).ShopifyApiError("denied", {
        code: "ACCESS_DENIED",
        status: 403,
      }),
    );
    const result = await installThemeIntegration(store());
    expect(result.status).toBe("failed");
    expect(result.error).toContain("write_themes");
    expect(state.failed).toContain("write_themes");
  });
});

describe("legacy checkout integration cleanup", () => {
  it("removes the previous RS-EXT block from the layout", () => {
    const layout = '<html><head><!-- RS-EXT-S --><script>old()</script><!-- RS-EXT-E --></head><body></body></html>';
    expect(stripLegacyIntegration(layout)).toBe("<html><head></head><body></body></html>");
  });
});
