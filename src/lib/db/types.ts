export type StoreRole = "a" | "b";
export type StorePlatform = "shopify" | "external";
export type StoreStatus = "pending" | "active" | "needs_reauth" | "disconnected";
export type StorefrontTokenKind = "public" | "private";

export type StoreRow = {
  id: string;
  role: StoreRole;
  store_type: "storefront" | "checkout";
  platform: StorePlatform;
  name: string;
  shop_domain: string | null;
  primary_domain: string | null;
  currency: string | null;
  admin_token_cipher: string | null;
  refresh_token_cipher: string | null;
  token_expires_at: string | null;
  refresh_token_expires_at: string | null;
  scopes: string[];
  storefront_token_cipher: string | null;
  storefront_token_kind: StorefrontTokenKind | null;
  storefront_api_version: string | null;
  external_base_url: string | null;
  shopify_client_id: string | null;
  shopify_client_secret_cipher: string | null;
  shopify_scopes: string;
  last_check_at: string | null;
  last_check_error: string | null;
  last_sync_attempt_at: string | null;
  status: StoreStatus;
  connected_at: string | null;
  last_synced_at: string | null;
  created_at: string;
  updated_at: string;
};

export type IntegrationStatus = "draft" | "active" | "disabled";

export type IntegrationRow = {
  id: string;
  name: string;
  storefront_id: string;
  checkout_id: string;
  status: IntegrationStatus;
  created_at: string;
  updated_at: string;
};

export type ProductRow = {
  id: string;
  store_id: string;
  external_id: string;
  handle: string | null;
  title: string;
  vendor: string | null;
  product_type: string | null;
  status: string | null;
  currency: string;
  is_current: boolean;
  raw: unknown;
  synced_at: string;
  created_at: string;
  updated_at: string;
};

export type VariantRow = {
  id: string;
  store_id: string;
  product_id: string;
  external_id: string;
  sku: string | null;
  title: string | null;
  option_values: Array<{ name: string; value: string }>;
  price_amount: string;
  currency: string;
  available_for_sale: boolean;
  is_current: boolean;
  raw: unknown;
  synced_at: string;
  created_at: string;
  updated_at: string;
};

export type MappingMode = "shopify" | "external";
export type MappingStatus = "draft" | "active" | "needs_review" | "disabled";

export type MappingRow = {
  id: string;
  integration_id: string;
  store_a_id: string;
  store_a_variant_id: string;
  store_b_id: string;
  store_b_variant_id: string | null;
  mode: MappingMode;
  status: MappingStatus;
  currency_a: string;
  currency_b: string;
  price_a: string;
  price_b: string;
  price_diff: string;
  price_diff_percent: string;
  external_product_url: string | null;
  external_product_title: string | null;
  external_variant_title: string | null;
  external_sku: string | null;
  identity_ack: boolean;
  price_ack: boolean;
  notes: string | null;
  activated_at: string | null;
  last_checked_at: string | null;
  created_at: string;
  updated_at: string;
};

export type TransferStatus = "pending" | "processing" | "completed" | "failed" | "expired";

export type TransferLine = {
  mappingId: string;
  aVariantId: string;
  aVariantExternalId: string;
  aProductTitle: string;
  aVariantTitle: string | null;
  aSku: string | null;
  quantity: number;
  unitPriceA: string;
  bVariantId: string | null;
  bVariantExternalId: string | null;
  bProductTitle: string;
  bVariantTitle: string | null;
  bSku: string | null;
  unitPriceB: string;
  currency: string;
};

export type TransferRow = {
  id: string;
  token_hash: string;
  store_a_id: string;
  store_b_id: string;
  status: TransferStatus;
  lines: TransferLine[];
  currency: string;
  subtotal: string;
  attribution: Record<string, string>;
  attribution_consent: boolean;
  visitor_consent: Record<string, boolean | null>;
  checkout_url: string | null;
  claim_token: string | null;
  expires_at: string;
  consumed_at: string | null;
  error_code: string | null;
  error_detail: string | null;
  created_at: string;
};

export type SyncRunRow = {
  id: string;
  store_id: string;
  status: "running" | "success" | "error";
  products_seen: number;
  variants_seen: number;
  error_code: string | null;
  error_message: string | null;
  started_at: string;
  finished_at: string | null;
};

export type MappingWithDetails = MappingRow & {
  a_variant: VariantRow & {
    product: Pick<ProductRow, "id" | "title" | "handle" | "external_id">;
  };
  b_variant:
    | (VariantRow & {
        product: Pick<ProductRow, "id" | "title" | "handle" | "external_id">;
      })
    | null;
  store_a: Pick<StoreRow, "id" | "name" | "shop_domain" | "primary_domain" | "platform">;
  store_b: Pick<StoreRow, "id" | "name" | "shop_domain" | "primary_domain" | "platform" | "external_base_url">;
};

export function isStoreActive(store: StoreRow | null): store is StoreRow {
  return Boolean(store && store.status === "active");
}

export function destinationDomain(store: StoreRow): string {
  if (store.platform === "external" && store.external_base_url) {
    try {
      return new URL(store.external_base_url).host;
    } catch {
      return store.external_base_url;
    }
  }
  return store.primary_domain || store.shop_domain || store.name;
}
