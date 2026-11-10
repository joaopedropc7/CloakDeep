import "server-only";

import { encryptSecret } from "@/lib/crypto";
import { recordAudit } from "@/lib/db/audit";
import { getStoreByRole, saveStorefrontToken } from "@/lib/db/stores";
import type { StoreRow, StorefrontTokenKind } from "@/lib/db/types";
import { validateStorefrontToken } from "@/lib/shopify/storefront";

export async function configureStorefrontAccess(input: {
  token: string;
  kind: StorefrontTokenKind;
  apiVersion: string;
}): Promise<{ store: StoreRow; shopName: string; currencyCode: string }> {
  const store = await getStoreByRole("b");
  if (!store || store.platform !== "shopify" || !store.shop_domain) {
    throw new Error("Conecte a Loja B como Shopify antes de configurar a Storefront API.");
  }
  if (store.status === "disconnected") {
    throw new Error("A Loja B está desconectada. Reconecte antes de configurar a Storefront API.");
  }
  if (!/^\d{4}-\d{2}$/.test(input.apiVersion)) {
    throw new Error("Versão da Storefront API inválida (use AAAA-MM, ex.: 2026-10).");
  }
  if (input.token.trim().length < 10) {
    throw new Error("Token da Storefront API inválido.");
  }
  if (input.kind !== "private" && input.kind !== "public") {
    throw new Error("Tipo de token inválido.");
  }

  const aad = `storefront:${store.shop_domain}`;
  const cipher = encryptSecret(input.token.trim(), aad);
  const probe: StoreRow = {
    ...store,
    storefront_token_cipher: cipher,
    storefront_token_kind: input.kind,
    storefront_api_version: input.apiVersion,
  };
  const info = await validateStorefrontToken(probe);
  if (store.currency && info.currencyCode !== store.currency) {
    throw new Error(
      `A moeda da Storefront API (${info.currencyCode}) difere da moeda administrativa da loja (${store.currency}).`,
    );
  }

  await saveStorefrontToken({
    storeId: store.id,
    tokenCipher: cipher,
    kind: input.kind,
    apiVersion: input.apiVersion,
  });

  await recordAudit({
    storeId: store.id,
    eventType: "store_connected",
    metadata: { role: "b", platform: "shopify", storefrontTokenKind: input.kind },
  });

  return { store: { ...store, status: "active" }, shopName: info.shopName, currencyCode: info.currencyCode };
}
