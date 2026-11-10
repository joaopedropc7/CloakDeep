import "server-only";

import { shopifyApiVersion } from "@/lib/env";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { decryptStoreClientSecret } from "@/lib/shopify/credentials";
import { getStoreById, updateStoreTokens, updateStoreStatus } from "@/lib/db/stores";
import type { StoreRow } from "@/lib/db/types";
import {
  missingScopes,
  refreshAccessToken,
  ShopifyOAuthError,
} from "@/lib/shopify/oauth";

const REQUEST_TIMEOUT_MS = 30_000;
const TOKEN_REFRESH_MARGIN_MS = 120_000;

export class ShopifyApiError extends Error {
  readonly code: string | null;
  readonly status: number | null;
  readonly retryable: boolean;

  constructor(message: string, options: { code?: string | null; status?: number | null; retryable?: boolean } = {}) {
    super(message);
    this.name = "ShopifyApiError";
    this.code = options.code ?? null;
    this.status = options.status ?? null;
    this.retryable = options.retryable ?? false;
  }
}

export class ShopifyReauthError extends ShopifyApiError {
  constructor(message = "A loja precisa ser reconectada à Shopify.") {
    super(message, { code: "REAUTH_REQUIRED", retryable: false });
    this.name = "ShopifyReauthError";
  }
}

const refreshInFlight = new Map<string, Promise<string>>();

function tokenAad(store: StoreRow): string {
  if (!store.shop_domain) throw new ShopifyReauthError("Loja sem domínio Shopify.");
  return `store:${store.shop_domain}`;
}

function decryptAdminToken(store: StoreRow): string {
  if (!store.admin_token_cipher) throw new ShopifyReauthError("Loja sem token administrativo.");
  return decryptSecret(store.admin_token_cipher, tokenAad(store));
}

function tokenNeedsRefresh(store: StoreRow): boolean {
  if (!store.token_expires_at) return false;
  return new Date(store.token_expires_at).getTime() - TOKEN_REFRESH_MARGIN_MS <= Date.now();
}

async function storeNewTokens(store: StoreRow, result: Awaited<ReturnType<typeof refreshAccessToken>>): Promise<string> {
  const aad = tokenAad(store);
  await updateStoreTokens({
    storeId: store.id,
    adminTokenCipher: encryptSecret(result.accessToken, aad),
    refreshTokenCipher: result.refreshToken ? encryptSecret(result.refreshToken, aad) : null,
    tokenExpiresAt: result.expiresAt,
    refreshTokenExpiresAt: result.refreshTokenExpiresAt,
    scopes: result.scopes.length > 0 ? result.scopes : undefined,
  });
  await updateStoreStatus(store.id, "active");
  return result.accessToken;
}

export async function getValidAdminToken(store: StoreRow, forceRefresh = false): Promise<string> {
  if (!store.shop_domain) throw new ShopifyReauthError();
  if (!forceRefresh && !tokenNeedsRefresh(store)) {
    return decryptAdminToken(store);
  }

  // Another request (or another instance) may have refreshed already. Re-read
  // before consuming the rotating refresh token.
  if (!forceRefresh) {
    const latest = await getStoreById(store.id);
    if (latest && latest.admin_token_cipher && !tokenNeedsRefresh(latest)) {
      return decryptAdminToken(latest);
    }
    if (latest) store = latest;
  }

  if (!store.refresh_token_cipher) {
    if (forceRefresh || tokenNeedsRefresh(store)) {
      await updateStoreStatus(store.id, "needs_reauth");
      throw new ShopifyReauthError("O token expirou e não há refresh token. Reconecte a loja.");
    }
    return decryptAdminToken(store);
  }

  const existing = refreshInFlight.get(store.id);
  if (existing) return existing;

  const promise = (async () => {
    try {
      const refreshToken = decryptSecret(store.refresh_token_cipher!, tokenAad(store));
      if (!store.shopify_client_id || !store.shopify_client_secret_cipher) {
        throw new ShopifyReauthError("A loja não tem Client ID/Secret cadastrados.");
      }
      const result = await refreshAccessToken({
        shopDomain: store.shop_domain!,
        refreshToken,
        clientId: store.shopify_client_id,
        clientSecret: decryptStoreClientSecret(store),
      });
      const required = store.shopify_scopes
        .split(",")
        .map((scope) => scope.trim())
        .filter(Boolean);
      const missing = missingScopes(result.scopes, required);
      if (missing.length > 0) {
        await updateStoreStatus(store.id, "needs_reauth");
        throw new ShopifyReauthError(`Escopos ausentes após renovação: ${missing.join(", ")}`);
      }
      return await storeNewTokens(store, result);
    } catch (error) {
      if (error instanceof ShopifyOAuthError && (error.status === 400 || error.status === 401)) {
        await updateStoreStatus(store.id, "needs_reauth");
        throw new ShopifyReauthError("O refresh token expirou ou foi revogado. Reconecte a loja.");
      }
      if (error instanceof ShopifyReauthError) throw error;
      throw new ShopifyApiError("Não foi possível renovar o token da Shopify.", {
        code: "TOKEN_REFRESH_FAILED",
        retryable: true,
      });
    } finally {
      refreshInFlight.delete(store.id);
    }
  })();

  refreshInFlight.set(store.id, promise);
  return promise;
}

type GraphqlEnvelope<T> = {
  data?: T;
  errors?: Array<{ message: string; extensions?: { code?: string } }>;
};

type AdminRequestOptions = {
  query: string;
  variables?: Record<string, unknown>;
};

async function graphqlRequest<T>(
  shopDomain: string,
  token: string,
  options: AdminRequestOptions,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(
      `https://${shopDomain}/admin/api/${shopifyApiVersion()}/graphql.json`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": token,
        },
        body: JSON.stringify(options),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      },
    );
  } catch {
    throw new ShopifyApiError("Não foi possível alcançar a Shopify.", {
      code: "SHOPIFY_UNREACHABLE",
      retryable: true,
    });
  }

  if (response.status === 401) {
    throw new ShopifyReauthError("A Shopify rejeitou o token da loja.");
  }
  if (response.status === 429) {
    throw new ShopifyApiError("Limite de requisições da Shopify.", {
      code: "THROTTLED",
      status: 429,
      retryable: true,
    });
  }
  if (!response.ok) {
    throw new ShopifyApiError(`Erro HTTP da Shopify: ${response.status}`, {
      status: response.status,
      retryable: response.status >= 500,
    });
  }

  let envelope: GraphqlEnvelope<T>;
  try {
    envelope = (await response.json()) as GraphqlEnvelope<T>;
  } catch {
    throw new ShopifyApiError("Resposta inválida da Shopify.", { code: "INVALID_RESPONSE" });
  }

  if (envelope.errors && envelope.errors.length > 0) {
    const first = envelope.errors[0];
    const code = first.extensions?.code ?? null;
    throw new ShopifyApiError(first.message, {
      code,
      retryable: code === "THROTTLED" || code === "INTERNAL_SERVER_ERROR",
    });
  }
  if (!envelope.data) {
    throw new ShopifyApiError("A Shopify não retornou dados.", { code: "EMPTY_RESPONSE" });
  }
  return envelope.data;
}

async function adminRequest<T>(store: StoreRow, token: string, options: AdminRequestOptions): Promise<T> {
  if (!store.shop_domain) throw new ShopifyReauthError();
  return graphqlRequest<T>(store.shop_domain, token, options);
}

export async function adminGraphql<T>(
  store: StoreRow,
  options: AdminRequestOptions,
): Promise<T> {
  let token = await getValidAdminToken(store);
  let forceRefresh = false;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      return await adminRequest<T>(store, token, options);
    } catch (error) {
      if (error instanceof ShopifyReauthError && !forceRefresh && store.refresh_token_cipher) {
        forceRefresh = true;
        token = await getValidAdminToken(store, true);
        continue;
      }
      if (error instanceof ShopifyApiError && error.retryable && attempt < 3) {
        await sleep(1000 * 2 ** attempt);
        continue;
      }
      throw error;
    }
  }
  throw new ShopifyApiError("A Shopify não respondeu após várias tentativas.", {
    code: "RETRIES_EXHAUSTED",
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type ShopifyShopInfo = {
  name: string;
  myshopifyDomain: string;
  currencyCode: string;
  primaryDomain: string | null;
};

const SHOP_QUERY = `#graphql
  query ShopInfo {
    shop {
      name
      myshopifyDomain
      currencyCode
      primaryDomain { host url }
    }
  }
`;

export async function fetchShopInfoWithToken(
  shopDomain: string,
  accessToken: string,
): Promise<ShopifyShopInfo> {
  const data = await graphqlRequest<{
    shop: {
      name: string;
      myshopifyDomain: string;
      currencyCode: string;
      primaryDomain: { host: string | null; url: string | null } | null;
    };
  }>(shopDomain, accessToken, { query: SHOP_QUERY });
  return {
    name: data.shop.name,
    myshopifyDomain: data.shop.myshopifyDomain,
    currencyCode: data.shop.currencyCode,
    primaryDomain: data.shop.primaryDomain?.host ?? null,
  };
}

export async function fetchShopInfo(store: StoreRow): Promise<ShopifyShopInfo> {
  if (!store.shop_domain) throw new ShopifyReauthError();
  const accessToken = await getValidAdminToken(store);
  return fetchShopInfoWithToken(store.shop_domain, accessToken);
}

export type AdminVariant = {
  id: string;
  title: string | null;
  sku: string | null;
  price: string;
  availableForSale: boolean;
  options: Array<{ name: string; value: string }>;
  product: {
    id: string;
    title: string;
    handle: string | null;
    status: string | null;
  };
};

type VariantNode = {
  id: string;
  title: string | null;
  sku: string | null;
  price: string;
  availableForSale: boolean;
  selectedOptions: Array<{ name: string; value: string }>;
  product: {
    id: string;
    title: string;
    handle: string | null;
    status: string | null;
  } | null;
};

function toAdminVariant(node: VariantNode): AdminVariant | null {
  if (!node.product) return null;
  return {
    id: node.id,
    title: node.title,
    sku: node.sku,
    price: node.price,
    availableForSale: node.availableForSale,
    options: node.selectedOptions ?? [],
    product: {
      id: node.product.id,
      title: node.product.title,
      handle: node.product.handle,
      status: node.product.status,
    },
  };
}

const VARIANTS_BY_IDS_QUERY = `#graphql
  query VariantsByIds($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on ProductVariant {
        id
        title
        sku
        price
        availableForSale
        selectedOptions { name value }
        product { id title handle status }
      }
    }
  }
`;

export async function fetchLiveVariants(
  store: StoreRow,
  variantIds: string[],
): Promise<Map<string, AdminVariant>> {
  const unique = [...new Set(variantIds)];
  const result = new Map<string, AdminVariant>();
  for (const ids of chunk(unique, 100)) {
    if (ids.length === 0) continue;
    const data = await adminGraphql<{ nodes: Array<VariantNode | null> }>(store, {
      query: VARIANTS_BY_IDS_QUERY,
      variables: { ids },
    });
    for (const node of data.nodes) {
      if (!node) continue;
      const variant = toAdminVariant(node);
      if (variant) result.set(variant.id, variant);
    }
  }
  return result;
}

const PRODUCTS_PAGE_QUERY = `#graphql
  query ProductsPage($first: Int!, $after: String) {
    products(first: $first, after: $after, sortKey: UPDATED_AT, reverse: true) {
      nodes {
        id
        title
        handle
        vendor
        productType
        status
        variants(first: 250) {
          nodes {
            id
            title
            sku
            price
            availableForSale
            selectedOptions { name value }
          }
          pageInfo { hasNextPage endCursor }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

const PRODUCT_VARIANTS_PAGE_QUERY = `#graphql
  query ProductVariantsPage($id: ID!, $after: String) {
    product(id: $id) {
      variants(first: 250, after: $after) {
        nodes {
          id
          title
          sku
          price
          availableForSale
          selectedOptions { name value }
        }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
`;

type ImportVariantNode = Omit<VariantNode, "product">;

type ImportProductNode = {
  id: string;
  title: string;
  handle: string | null;
  vendor: string | null;
  productType: string | null;
  status: string | null;
  variants: {
    nodes: ImportVariantNode[];
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
  };
};

export async function fetchCatalog(store: StoreRow): Promise<{
  shop: ShopifyShopInfo;
  products: Array<{
    external_id: string;
    handle: string | null;
    title: string;
    vendor: string | null;
    product_type: string | null;
    status: string | null;
    currency: string;
    raw: unknown;
    variants: Array<{
      external_id: string;
      sku: string | null;
      title: string | null;
      option_values: Array<{ name: string; value: string }>;
      price_amount: string;
      currency: string;
      available_for_sale: boolean;
      raw: unknown;
    }>;
  }>;
}> {
  const shop = await fetchShopInfo(store);
  const products: Awaited<ReturnType<typeof fetchCatalog>>["products"] = [];
  let after: string | null = null;

  for (;;) {
    const data: {
      products: {
        nodes: ImportProductNode[];
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
      };
    } = await adminGraphql(store, {
      query: PRODUCTS_PAGE_QUERY,
      variables: { first: 50, after },
    });

    for (const product of data.products.nodes) {
      const variants = [...product.variants.nodes];
      let variantsAfter = product.variants.pageInfo.hasNextPage
        ? product.variants.pageInfo.endCursor
        : null;
      while (variantsAfter) {
        const next: {
          product: {
            variants: {
              nodes: ImportVariantNode[];
              pageInfo: { hasNextPage: boolean; endCursor: string | null };
            };
          } | null;
        } = await adminGraphql(store, {
          query: PRODUCT_VARIANTS_PAGE_QUERY,
          variables: { id: product.id, after: variantsAfter },
        });
        if (!next.product) break;
        variants.push(...next.product.variants.nodes);
        variantsAfter = next.product.variants.pageInfo.hasNextPage
          ? next.product.variants.pageInfo.endCursor
          : null;
      }

      products.push({
        external_id: product.id,
        handle: product.handle,
        title: product.title,
        vendor: product.vendor,
        product_type: product.productType,
        status: product.status,
        currency: shop.currencyCode,
        raw: {
          id: product.id,
          handle: product.handle,
          vendor: product.vendor,
          productType: product.productType,
          status: product.status,
        },
        variants: variants.map((variant) => ({
          external_id: variant.id,
          sku: variant.sku,
          title: variant.title,
          option_values: variant.selectedOptions ?? [],
          price_amount: variant.price,
          currency: shop.currencyCode,
          available_for_sale: variant.availableForSale,
          raw: {
            id: variant.id,
            sku: variant.sku,
            selectedOptions: variant.selectedOptions ?? [],
          },
        })),
      });
    }

    if (!data.products.pageInfo.hasNextPage) break;
    after = data.products.pageInfo.endCursor;
    if (!after) break;
  }

  return { shop, products };
}

export function chunk<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}
