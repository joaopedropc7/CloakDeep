import "server-only";

import { recordAudit } from "@/lib/db/audit";
import {
  failSyncRun,
  finishSyncRun,
  flagStaleMappings,
  replaceCatalog,
  startSyncRun,
} from "@/lib/db/catalog";
import { getStoreById, markStoreSynced, updateStoreStatus } from "@/lib/db/stores";
import type { StoreRow } from "@/lib/db/types";
import { fetchCatalog, ShopifyApiError, ShopifyReauthError } from "@/lib/shopify/admin";
import {
  installThemeIntegration,
  type ThemeInstallResult,
} from "@/lib/services/theme-install";

export type SyncResult = {
  store: StoreRow;
  products: number;
  variants: number;
  mappingsFlagged: number;
  themeInstall: ThemeInstallResult | null;
};

export async function syncCatalog(storeId: string): Promise<SyncResult> {
  const store = await getStoreById(storeId);
  if (!store) throw new Error("Loja não encontrada.");
  if (store.platform !== "shopify") throw new Error("Importação disponível apenas para lojas Shopify.");
  if (!store.admin_token_cipher) throw new Error("Conecte a loja à Shopify antes de importar.");

  const run = await startSyncRun(store.id);
  try {
    const { products } = await fetchCatalog(store);
    const counts = await replaceCatalog(store.id, products);
    await markStoreSynced(store.id);
    const mappingsFlagged = await flagStaleMappings(store.id);
    await finishSyncRun(run.id, counts);
    await recordAudit({
      storeId: store.id,
      eventType: "catalog_imported",
      metadata: { products: counts.products, variants: counts.variants, mappingsFlagged },
    });

    let themeInstall: ThemeInstallResult | null = null;
    if (store.role === "a") {
      try {
        themeInstall = await installThemeIntegration(store);
      } catch (error) {
        themeInstall = {
          status: "failed",
          installed: false,
          themeName: null,
          error: error instanceof Error ? error.message : "Falha ao instalar no tema.",
        };
      }
    }

    return { store, ...counts, mappingsFlagged, themeInstall };
  } catch (error) {
    const code = error instanceof ShopifyApiError ? error.code ?? "SYNC_ERROR" : "SYNC_ERROR";
    const message = error instanceof Error ? error.message : "Falha desconhecida na importação.";
    await failSyncRun(run.id, code, message);
    if (error instanceof ShopifyReauthError) {
      await updateStoreStatus(store.id, "needs_reauth");
    }
    throw error;
  }
}
