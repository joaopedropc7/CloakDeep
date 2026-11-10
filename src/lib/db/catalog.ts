import "server-only";

import { getDb } from "@/lib/supabase";
import { normalizeMapping, normalizeVariant } from "@/lib/db/normalize";
import type { MappingRow, ProductRow, SyncRunRow, VariantRow } from "@/lib/db/types";
import { amountsEqual } from "@/lib/money";

export type CatalogVariant = {
  external_id: string;
  sku: string | null;
  title: string | null;
  option_values: Array<{ name: string; value: string }>;
  price_amount: string;
  currency: string;
  available_for_sale: boolean;
  raw: unknown;
};

export type CatalogProduct = {
  external_id: string;
  handle: string | null;
  title: string;
  vendor: string | null;
  product_type: string | null;
  status: string | null;
  currency: string;
  raw: unknown;
  variants: CatalogVariant[];
};

export type CatalogVariantWithProduct = VariantRow & {
  product: Pick<ProductRow, "id" | "title" | "handle" | "external_id">;
};

function chunk<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

function normalizeWithProduct(row: unknown): CatalogVariantWithProduct {
  const raw = row as CatalogVariantWithProduct;
  const product = raw.product;
  return {
    ...normalizeVariant(raw),
    product: {
      id: product.id,
      title: product.title,
      handle: product.handle ?? null,
      external_id: product.external_id,
    },
  };
}

/**
 * Replaces the current catalog snapshot. Historical rows stay in place with
 * is_current=false so old mappings can be flagged instead of silently following
 * a deleted product.
 */
export async function replaceCatalog(storeId: string, catalog: CatalogProduct[]): Promise<{
  products: number;
  variants: number;
}> {
  const db = getDb();
  const now = new Date().toISOString();

  const { error: resetProductsError } = await db
    .from("products")
    .update({ is_current: false })
    .eq("store_id", storeId);
  if (resetProductsError) throw new Error(`Falha ao preparar catálogo: ${resetProductsError.message}`);

  const { error: resetVariantsError } = await db
    .from("variants")
    .update({ is_current: false })
    .eq("store_id", storeId);
  if (resetVariantsError) throw new Error(`Falha ao preparar variantes: ${resetVariantsError.message}`);

  const productRows = catalog.map((product) => ({
    store_id: storeId,
    external_id: product.external_id,
    handle: product.handle,
    title: product.title,
    vendor: product.vendor,
    product_type: product.product_type,
    status: product.status,
    currency: product.currency,
    is_current: true,
    raw: product.raw ?? null,
    synced_at: now,
  }));

  const productIds = new Map<string, string>();
  for (const rows of chunk(productRows, 100)) {
    const { data, error } = await db
      .from("products")
      .upsert(rows, { onConflict: "store_id,external_id" })
      .select("id,external_id");
    if (error) throw new Error(`Falha ao importar produtos: ${error.message}`);
    for (const row of data ?? []) {
      productIds.set(row.external_id as string, row.id as string);
    }
  }

  const variantRows = catalog.flatMap((product) => {
    const productId = productIds.get(product.external_id);
    if (!productId) throw new Error(`Produto importado sem ID interno: ${product.external_id}`);
    return product.variants.map((variant) => ({
      store_id: storeId,
      product_id: productId,
      external_id: variant.external_id,
      sku: variant.sku,
      title: variant.title,
      option_values: variant.option_values,
      price_amount: variant.price_amount,
      currency: variant.currency,
      available_for_sale: variant.available_for_sale,
      is_current: true,
      raw: variant.raw ?? null,
      synced_at: now,
    }));
  });

  for (const rows of chunk(variantRows, 100)) {
    const { error } = await db
      .from("variants")
      .upsert(rows, { onConflict: "store_id,external_id" });
    if (error) throw new Error(`Falha ao importar variantes: ${error.message}`);
  }

  return { products: catalog.length, variants: variantRows.length };
}

/**
 * Active mappings whose stored identity/price no longer matches the imported
 * snapshot are marked needs_review. They are never silently redirected.
 */
export async function flagStaleMappings(storeId: string): Promise<number> {
  const db = getDb();
  const { data: mappings, error } = await db
    .from("mappings")
    .select("*")
    .eq("status", "active")
    .or(`store_a_id.eq.${storeId},store_b_id.eq.${storeId}`);
  if (error) throw new Error(`Falha ao verificar mapeamentos: ${error.message}`);

  const rows = (mappings ?? []).map(normalizeMapping);
  if (rows.length === 0) return 0;

  const variantIds = new Set<string>();
  for (const mapping of rows) {
    variantIds.add(mapping.store_a_variant_id);
    if (mapping.store_b_variant_id) variantIds.add(mapping.store_b_variant_id);
  }

  const variantMap = new Map<string, VariantRow>();
  const ids = [...variantIds];
  for (const idsChunk of chunk(ids, 100)) {
    const { data: variants, error: variantError } = await db
      .from("variants")
      .select("*")
      .in("id", idsChunk);
    if (variantError) throw new Error(`Falha ao verificar variantes: ${variantError.message}`);
    for (const variant of variants ?? []) {
      const normalized = normalizeVariant(variant);
      variantMap.set(normalized.id, normalized);
    }
  }

  let flagged = 0;
  for (const mapping of rows) {
    const a = variantMap.get(mapping.store_a_variant_id);
    const b = mapping.store_b_variant_id ? variantMap.get(mapping.store_b_variant_id) : null;
    const invalid =
      !a ||
      !a.is_current ||
      (mapping.mode === "shopify" && (!b || !b.is_current)) ||
      a.currency !== mapping.currency_a ||
      !amountsEqual(a.price_amount, mapping.price_a) ||
      (mapping.mode === "shopify" &&
        b &&
        (b.currency !== mapping.currency_b || !amountsEqual(b.price_amount, mapping.price_b)));

    if (invalid) {
      const { error: updateError } = await db
        .from("mappings")
        .update({ status: "needs_review", last_checked_at: new Date().toISOString() })
        .eq("id", mapping.id)
        .eq("status", "active");
      if (updateError) throw new Error(`Falha ao sinalizar mapeamento: ${updateError.message}`);
      flagged += 1;
    }
  }
  return flagged;
}

export async function listVariantsWithProduct(storeId: string, limit = 500): Promise<CatalogVariantWithProduct[]> {
  const { data, error } = await getDb()
    .from("variants")
    .select(
      "*, product:products!variants_product_id_fkey(id,title,handle,external_id)",
    )
    .eq("store_id", storeId)
    .eq("is_current", true)
    .order("external_id", { ascending: true })
    .limit(limit);
  if (error) throw new Error(`Falha ao listar variantes: ${error.message}`);
  return (data ?? []).map(normalizeWithProduct);
}

export async function getVariantWithProduct(variantId: string): Promise<CatalogVariantWithProduct | null> {
  const { data, error } = await getDb()
    .from("variants")
    .select("*, product:products!variants_product_id_fkey(id,title,handle,external_id)")
    .eq("id", variantId)
    .maybeSingle();
  if (error) throw new Error(`Falha ao ler variante: ${error.message}`);
  return data ? normalizeWithProduct(data) : null;
}

export async function getVariantsWithProductByIds(ids: string[]): Promise<CatalogVariantWithProduct[]> {
  if (ids.length === 0) return [];
  const { data, error } = await getDb()
    .from("variants")
    .select("*, product:products!variants_product_id_fkey(id,title,handle,external_id)")
    .in("id", ids);
  if (error) throw new Error(`Falha ao ler variantes: ${error.message}`);
  return (data ?? []).map(normalizeWithProduct);
}

export async function getVariantByExternalId(
  storeId: string,
  externalId: string,
): Promise<CatalogVariantWithProduct | null> {
  const { data, error } = await getDb()
    .from("variants")
    .select("*, product:products!variants_product_id_fkey(id,title,handle,external_id)")
    .eq("store_id", storeId)
    .eq("external_id", externalId)
    .eq("is_current", true)
    .maybeSingle();
  if (error) throw new Error(`Falha ao ler variante por ID externo: ${error.message}`);
  return data ? normalizeWithProduct(data) : null;
}

export async function listProducts(storeId: string, limit = 200): Promise<ProductRow[]> {
  const { data, error } = await getDb()
    .from("products")
    .select("*")
    .eq("store_id", storeId)
    .eq("is_current", true)
    .order("title", { ascending: true })
    .limit(limit);
  if (error) throw new Error(`Falha ao listar produtos: ${error.message}`);
  return (data ?? []) as ProductRow[];
}

export async function catalogStats(storeId: string): Promise<{ products: number; variants: number }> {
  const db = getDb();
  const [products, variants] = await Promise.all([
    db
      .from("products")
      .select("id", { count: "exact", head: true })
      .eq("store_id", storeId)
      .eq("is_current", true),
    db
      .from("variants")
      .select("id", { count: "exact", head: true })
      .eq("store_id", storeId)
      .eq("is_current", true),
  ]);
  if (products.error) throw new Error(`Falha ao contar produtos: ${products.error.message}`);
  if (variants.error) throw new Error(`Falha ao contar variantes: ${variants.error.message}`);
  return { products: products.count ?? 0, variants: variants.count ?? 0 };
}


export async function startSyncRun(storeId: string): Promise<SyncRunRow> {
  const { data, error } = await getDb()
    .from("sync_runs")
    .insert({ store_id: storeId, status: "running" })
    .select("*")
    .single();
  if (error) throw new Error(`Falha ao iniciar sincronização: ${error.message}`);
  return data as SyncRunRow;
}

export async function finishSyncRun(
  id: string,
  counts: { products: number; variants: number },
): Promise<void> {
  const { error } = await getDb()
    .from("sync_runs")
    .update({
      status: "success",
      products_seen: counts.products,
      variants_seen: counts.variants,
      finished_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) throw new Error(`Falha ao concluir sincronização: ${error.message}`);
}

export async function failSyncRun(id: string, code: string, message: string): Promise<void> {
  const { error } = await getDb()
    .from("sync_runs")
    .update({
      status: "error",
      error_code: code.slice(0, 100),
      error_message: message.slice(0, 1000),
      finished_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) throw new Error(`Falha ao registrar erro de sincronização: ${error.message}`);
}

export async function getLatestSyncRun(storeId: string): Promise<SyncRunRow | null> {
  const { data, error } = await getDb()
    .from("sync_runs")
    .select("*")
    .eq("store_id", storeId)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`Falha ao ler sincronizações: ${error.message}`);
  return (data as SyncRunRow | null) ?? null;
}
