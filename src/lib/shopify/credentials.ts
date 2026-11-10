import "server-only";

import { decryptSecret, encryptSecret } from "@/lib/crypto";
import type { StoreRow } from "@/lib/db/types";

export function clientSecretAad(storeId: string): string {
  return `store-oauth:${storeId}`;
}

export function encryptStoreClientSecret(storeId: string, secret: string): string {
  return encryptSecret(secret, clientSecretAad(storeId));
}

export function decryptStoreClientSecret(store: StoreRow): string {
  if (!store.shopify_client_secret_cipher) {
    throw new Error("A loja não tem Client Secret cadastrado.");
  }
  return decryptSecret(store.shopify_client_secret_cipher, clientSecretAad(store.id));
}
