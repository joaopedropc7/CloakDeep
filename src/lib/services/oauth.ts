import "server-only";

import { appUrl } from "@/lib/env";
import { encryptSecret } from "@/lib/crypto";
import { recordAudit } from "@/lib/db/audit";
import { getStoreById, updateStoreConnection } from "@/lib/db/stores";
import type { StoreRow } from "@/lib/db/types";
import { exchangeAuthorizationCode, isValidShopDomain, missingScopes } from "@/lib/shopify/oauth";
import { decryptStoreClientSecret } from "@/lib/shopify/credentials";
import { fetchShopInfoWithToken } from "@/lib/shopify/admin";

export async function connectShopifyStore(input: {
  storeId: string;
  code: string;
}): Promise<StoreRow> {
  const existing = await getStoreById(input.storeId);
  if (!existing || existing.platform !== "shopify" || !existing.shop_domain) {
    throw new Error("Loja Shopify não encontrada para esta integração.");
  }
  if (!isValidShopDomain(existing.shop_domain)) throw new Error("Domínio Shopify inválido.");
  if (!existing.shopify_client_id || !existing.shopify_client_secret_cipher) {
    throw new Error("Cadastre o Client ID e o Client Secret desta loja antes do OAuth.");
  }
  const shopDomain = existing.shop_domain;
  const token = await exchangeAuthorizationCode({
    shopDomain,
    code: input.code,
    clientId: existing.shopify_client_id,
    clientSecret: decryptStoreClientSecret(existing),
  });

  // write_themes is required for the automatic installer, but a store can
  // still be connected with read_products and use the manual theme fallback if
  // Shopify does not grant theme writes.
  const required = existing.shopify_scopes
    .split(",")
    .map((scope) => scope.trim())
    .filter((scope) => scope && !["write_themes", "read_themes"].includes(scope));
  const missing = missingScopes(token.scopes, required);
  if (missing.length > 0) {
    throw new Error(`A loja não concedeu os escopos necessários: ${missing.join(", ")}`);
  }

  const info = await fetchShopInfoWithToken(shopDomain, token.accessToken);
  if (info.myshopifyDomain !== shopDomain) {
    throw new Error("O domínio retornado pela Shopify não corresponde ao domínio autorizado.");
  }

  const aad = `store:${shopDomain}`;
  const store = await updateStoreConnection({
    storeId: existing.id,
    shopDomain,
    primaryDomain: info.primaryDomain?.toLowerCase() ?? null,
    name: info.name,
    currency: info.currencyCode,
    adminTokenCipher: encryptSecret(token.accessToken, aad),
    refreshTokenCipher: token.refreshToken ? encryptSecret(token.refreshToken, aad) : null,
    tokenExpiresAt: token.expiresAt,
    refreshTokenExpiresAt: token.refreshTokenExpiresAt,
    scopes: token.scopes.length > 0 ? token.scopes : required,
  });

  await recordAudit({
    storeId: store.id,
    eventType: "store_connected",
    metadata: {
      role: existing.role,
      platform: "shopify",
      scopes: store.scopes,
    },
  });

  return store;
}

export function oauthRedirectUri(): string {
  return `${appUrl().replace(/\/$/, "")}/api/auth/shopify/callback`;
}
