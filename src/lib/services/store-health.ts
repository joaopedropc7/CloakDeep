import "server-only";

import { getStoreById, markStoreCheck } from "@/lib/db/stores";
import { fetchShopInfo } from "@/lib/shopify/admin";

export async function testStoreConnection(storeId: string): Promise<string> {
  const store = await getStoreById(storeId);
  if (!store) throw new Error("Loja não encontrada.");

  if (store.platform === "external") {
    if (!store.external_base_url) throw new Error("A Loja B externa não tem URL configurada.");
    const url = new URL(store.external_base_url);
    if (url.protocol !== "https:" && url.hostname !== "localhost" && url.hostname !== "127.0.0.1") {
      throw new Error("A URL externa precisa usar HTTPS.");
    }
    await markStoreCheck(store.id, null);
    return `Destino externo válido: ${url.origin}`;
  }

  if (!store.admin_token_cipher) {
    throw new Error("A loja ainda não foi conectada por OAuth.");
  }

  try {
    const info = await fetchShopInfo(store);
    await markStoreCheck(store.id, null);
    return `Conexão OK: ${info.name} (${info.myshopifyDomain}) · ${info.currencyCode}`;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha ao consultar a Shopify.";
    await markStoreCheck(store.id, message.slice(0, 500));
    throw error;
  }
}

export function safeExternalOrigin(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.origin;
  } catch {
    return null;
  }
}
