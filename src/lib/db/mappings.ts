import "server-only";

import { getDb } from "@/lib/supabase";
import { normalizeMapping } from "@/lib/db/normalize";
import { getVariantsWithProductByIds } from "@/lib/db/catalog";
import { getStoreById, listStores } from "@/lib/db/stores";
import type {
  MappingRow,
  MappingStatus,
  MappingWithDetails,
  StoreRow,
} from "@/lib/db/types";

export type MappingInput = {
  integration_id: string;
  store_a_id: string;
  store_a_variant_id: string;
  store_b_id: string;
  store_b_variant_id: string | null;
  mode: "shopify" | "external";
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
};

export async function upsertMapping(input: MappingInput): Promise<MappingRow> {
  const { data, error } = await getDb()
    .from("mappings")
    .upsert(input, { onConflict: "integration_id,store_a_variant_id" })
    .select("*")
    .single();
  if (error) throw new Error(`Falha ao salvar mapeamento: ${error.message}`);
  return normalizeMapping(data);
}

export async function getMappingById(id: string): Promise<MappingRow | null> {
  const { data, error } = await getDb().from("mappings").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(`Falha ao ler mapeamento: ${error.message}`);
  return data ? normalizeMapping(data) : null;
}

export async function getMappingByAVariantId(
  id: string,
  integrationId?: string,
): Promise<MappingRow | null> {
  let query = getDb().from("mappings").select("*").eq("store_a_variant_id", id);
  if (integrationId) query = query.eq("integration_id", integrationId);
  const { data, error } = await query.maybeSingle();
  if (error) throw new Error(`Falha ao ler mapeamento: ${error.message}`);
  return data ? normalizeMapping(data) : null;
}

export async function listMappings(
  limit = 500,
  integrationId?: string,
  storefrontId?: string,
  checkoutId?: string,
): Promise<MappingRow[]> {
  let query = getDb()
    .from("mappings")
    .select("*")
    .order("updated_at", { ascending: false })
    .limit(limit);
  if (integrationId) query = query.eq("integration_id", integrationId);
  if (storefrontId) query = query.eq("store_a_id", storefrontId);
  if (checkoutId) query = query.eq("store_b_id", checkoutId);
  const { data, error } = await query;
  if (error) throw new Error(`Falha ao listar mapeamentos: ${error.message}`);
  return (data ?? []).map(normalizeMapping);
}

export async function listMappingsWithDetails(
  limit = 300,
  integrationId?: string,
  storefrontId?: string,
  checkoutId?: string,
): Promise<MappingWithDetails[]> {
  const mappings = await listMappings(limit, integrationId, storefrontId, checkoutId);
  if (mappings.length === 0) return [];

  const variantIds = new Set<string>();
  const storeIds = new Set<string>();
  for (const mapping of mappings) {
    variantIds.add(mapping.store_a_variant_id);
    if (mapping.store_b_variant_id) variantIds.add(mapping.store_b_variant_id);
    storeIds.add(mapping.store_a_id);
    storeIds.add(mapping.store_b_id);
  }

  const [variants, stores] = await Promise.all([
    getVariantsWithProductByIds([...variantIds]),
    listStores(),
  ]);
  const variantMap = new Map(variants.map((variant) => [variant.id, variant]));
  const storeMap = new Map(stores.filter((store) => storeIds.has(store.id)).map((store) => [store.id, store]));

  const result: MappingWithDetails[] = [];
  for (const mapping of mappings) {
    const aVariant = variantMap.get(mapping.store_a_variant_id);
    const storeA = storeMap.get(mapping.store_a_id);
    const storeB = storeMap.get(mapping.store_b_id);
    if (!aVariant || !storeA || !storeB) continue;
    const bVariant = mapping.store_b_variant_id
      ? variantMap.get(mapping.store_b_variant_id) ?? null
      : null;
    result.push({
      ...mapping,
      a_variant: aVariant,
      b_variant: bVariant,
      store_a: pickStoreA(storeA),
      store_b: pickStoreB(storeB),
    });
  }
  return result;
}

function pickStoreA(store: StoreRow): MappingWithDetails["store_a"] {
  return {
    id: store.id,
    name: store.name,
    shop_domain: store.shop_domain,
    primary_domain: store.primary_domain,
    platform: store.platform,
  };
}

function pickStoreB(store: StoreRow): MappingWithDetails["store_b"] {
  return {
    id: store.id,
    name: store.name,
    shop_domain: store.shop_domain,
    primary_domain: store.primary_domain,
    platform: store.platform,
    external_base_url: store.external_base_url,
  };
}

export async function setMappingStatus(id: string, status: MappingStatus): Promise<void> {
  const patch: Record<string, unknown> = { status };
  if (status === "active") {
    patch.activated_at = new Date().toISOString();
    patch.last_checked_at = new Date().toISOString();
  }
  const { error } = await getDb().from("mappings").update(patch).eq("id", id);
  if (error) throw new Error(`Falha ao atualizar mapeamento: ${error.message}`);
}

export async function mappingStats(integrationId?: string): Promise<{
  active: number;
  draft: number;
  needsReview: number;
  disabled: number;
}> {
  const db = getDb();
  const statuses: MappingStatus[] = ["active", "draft", "needs_review", "disabled"];
  const counts = await Promise.all(
    statuses.map((status) => {
      let query = db
        .from("mappings")
        .select("id", { count: "exact", head: true })
        .eq("status", status);
      if (integrationId) query = query.eq("integration_id", integrationId);
      return query;
    }),
  );
  for (const count of counts) {
    if (count.error) throw new Error(`Falha ao contar mapeamentos: ${count.error.message}`);
  }
  return {
    active: counts[0].count ?? 0,
    draft: counts[1].count ?? 0,
    needsReview: counts[2].count ?? 0,
    disabled: counts[3].count ?? 0,
  };
}

export async function getMappingsForAVariantIds(variantIds: string[]): Promise<MappingRow[]> {
  if (variantIds.length === 0) return [];
  const { data, error } = await getDb()
    .from("mappings")
    .select("*")
    .in("store_a_variant_id", variantIds);
  if (error) throw new Error(`Falha ao ler mapeamentos: ${error.message}`);
  return (data ?? []).map(normalizeMapping);
}

export async function getActiveMappingForVariant(
  variantId: string,
  integrationId?: string,
): Promise<MappingRow | null> {
  let query = getDb()
    .from("mappings")
    .select("*")
    .eq("store_a_variant_id", variantId)
    .eq("status", "active");
  if (integrationId) query = query.eq("integration_id", integrationId);
  const { data, error } = await query.maybeSingle();
  if (error) throw new Error(`Falha ao ler mapeamento ativo: ${error.message}`);
  return data ? normalizeMapping(data) : null;
}

