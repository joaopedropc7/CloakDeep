import "server-only";

import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { getDb } from "@/lib/supabase";
import { normalizeStore } from "@/lib/db/normalize";
import { encryptStoreClientSecret } from "@/lib/shopify/credentials";
import type {
  IntegrationRow,
  IntegrationStatus,
  StoreRole,
  StoreRow,
  StoreStatus,
} from "@/lib/db/types";

export const INTEGRATION_COOKIE = "csb_integration";

async function flagMappingsForStore(storeId: string): Promise<void> {
  const { error } = await getDb()
    .from("mappings")
    .update({ status: "needs_review", last_checked_at: new Date().toISOString() })
    .or(`store_a_id.eq.${storeId},store_b_id.eq.${storeId}`)
    .eq("status", "active");
  if (error) throw new Error(`Falha ao sinalizar mapeamentos da loja: ${error.message}`);
}

export async function getIntegrationById(id: string): Promise<IntegrationRow | null> {
  const { data, error } = await getDb().from("integrations").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(`Falha ao ler par: ${error.message}`);
  return data ? (data as IntegrationRow) : null;
}

export async function listIntegrations(): Promise<IntegrationRow[]> {
  const { data, error } = await getDb()
    .from("integrations")
    .select("*")
    .order("created_at", { ascending: true });
  if (error) throw new Error(`Falha ao listar pares: ${error.message}`);
  return (data ?? []) as IntegrationRow[];
}

/** Par selecionado no painel (cookie), com fallback para o primeiro. */
export async function getSelectedIntegration(): Promise<IntegrationRow | null> {
  const all = await listIntegrations();
  if (all.length === 0) return null;
  const selectedId = (await cookies()).get(INTEGRATION_COOKIE)?.value;
  return all.find((integration) => integration.id === selectedId) ?? all[0];
}

export async function getStoresForIntegration(integrationId: string): Promise<StoreRow[]> {
  const integration = await getIntegrationById(integrationId);
  if (!integration) return [];
  const { data, error } = await getDb()
    .from("stores")
    .select("*")
    .in("id", [integration.storefront_id, integration.checkout_id])
    .order("role");
  if (error) throw new Error(`Falha ao listar lojas do par: ${error.message}`);
  return (data ?? []).map(normalizeStore);
}

export async function getStoreByRoleForIntegration(
  role: StoreRole,
  integrationId: string,
): Promise<StoreRow | null> {
  const integration = await getIntegrationById(integrationId);
  if (!integration) return null;
  const id = role === "a" ? integration.storefront_id : integration.checkout_id;
  return getStoreById(id);
}

/** Admin-only: lojas do par selecionado. */
export async function getStoreByRole(role: StoreRole): Promise<StoreRow | null> {
  const integration = await getSelectedIntegration();
  if (!integration) return null;
  return getStoreByRoleForIntegration(role, integration.id);
}

/** Par ativo de uma vitrine. É o único que o fluxo público usa. */
export async function getIntegrationForStoreA(storeId: string): Promise<IntegrationRow | null> {
  const { data, error } = await getDb()
    .from("integrations")
    .select("*")
    .eq("storefront_id", storeId)
    .eq("status", "active")
    .maybeSingle();
  if (error) throw new Error(`Falha ao ler par ativo: ${error.message}`);
  return data ? (data as IntegrationRow) : null;
}

export async function getPairForStore(storeId: string): Promise<IntegrationRow | null> {
  const { data, error } = await getDb()
    .from("integrations")
    .select("*")
    .or(`storefront_id.eq.${storeId},checkout_id.eq.${storeId}`)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`Falha ao ler par da loja: ${error.message}`);
  return data ? (data as IntegrationRow) : null;
}

export async function getPairsForStorefront(storeId: string): Promise<IntegrationRow[]> {
  const { data, error } = await getDb()
    .from("integrations")
    .select("*")
    .eq("storefront_id", storeId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(`Falha ao listar pares da vitrine: ${error.message}`);
  return (data ?? []) as IntegrationRow[];
}

export async function getStoreById(id: string): Promise<StoreRow | null> {
  const { data, error } = await getDb().from("stores").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(`Falha ao ler loja: ${error.message}`);
  return data ? normalizeStore(data) : null;
}

export async function getShopifyStoreByDomain(shopDomain: string): Promise<StoreRow | null> {
  const { data, error } = await getDb()
    .from("stores")
    .select("*")
    .eq("shop_domain", shopDomain)
    .maybeSingle();
  if (error) throw new Error(`Falha ao ler loja por domínio: ${error.message}`);
  return data ? normalizeStore(data) : null;
}

export async function listStores(): Promise<StoreRow[]> {
  const { data, error } = await getDb().from("stores").select("*").order("name");
  if (error) throw new Error(`Falha ao listar lojas: ${error.message}`);
  return (data ?? []).map(normalizeStore);
}

/**
 * O status do par é uma escolha explícita do operador. Não derivamos
 * automaticamente para não trocar o par ativo sem intenção.
 */
export async function refreshIntegrationStatus(_integrationId: string): Promise<void> {
  return;
}

export type CreateStoreInput = {
  name: string;
  storeType: "storefront" | "checkout";
  platform: "shopify" | "external";
  shopDomain?: string | null;
  externalBaseUrl?: string | null;
  currency?: string | null;
  clientId?: string | null;
  clientSecret?: string | null;
  scopes?: string | null;
};

export async function createStore(input: CreateStoreInput): Promise<StoreRow> {
  const name = input.name.trim();
  const duplicateName = await getDb()
    .from("stores")
    .select("id")
    .ilike("name", name)
    .limit(1)
    .maybeSingle();
  if (duplicateName.error) throw new Error(`Falha ao verificar nome da loja: ${duplicateName.error.message}`);
  if (duplicateName.data) throw new Error("Já existe uma loja com esse nome.");
  if (input.externalBaseUrl) {
    const duplicateUrl = await getDb()
      .from("stores")
      .select("id")
      .eq("external_base_url", input.externalBaseUrl)
      .limit(1)
      .maybeSingle();
    if (duplicateUrl.error) throw new Error(`Falha ao verificar URL da loja: ${duplicateUrl.error.message}`);
    if (duplicateUrl.data) throw new Error("Já existe uma loja com essa URL externa.");
  }
  const id = randomUUID();
  const isExternal = input.platform === "external";
  const row = {
    id,
    role: input.storeType === "storefront" ? "a" : "b",
    store_type: input.storeType,
    platform: input.platform,
    name: input.name.trim(),
    shop_domain: isExternal ? null : input.shopDomain?.trim().toLowerCase() ?? null,
    primary_domain: null,
    currency: input.currency?.trim().toUpperCase() || null,
    status: isExternal ? "active" : "pending",
    external_base_url: isExternal ? input.externalBaseUrl?.trim() ?? null : null,
    connected_at: isExternal ? new Date().toISOString() : null,
    admin_token_cipher: null,
    refresh_token_cipher: null,
    token_expires_at: null,
    refresh_token_expires_at: null,
    scopes: [],
    storefront_token_cipher: null,
    storefront_token_kind: null,
    storefront_api_version: null,
    last_synced_at: null,
    last_check_at: null,
    last_check_error: null,
    last_sync_attempt_at: null,
    shopify_client_id: isExternal ? null : input.clientId?.trim() || null,
    shopify_client_secret_cipher:
      !isExternal && input.clientSecret ? encryptStoreClientSecret(id, input.clientSecret) : null,
    shopify_scopes: input.scopes?.trim() || "read_products,write_themes",
  };
  const { data, error } = await getDb().from("stores").insert(row).select("*").single();
  if (error) throw new Error(`Falha ao criar loja: ${error.message}`);
  return normalizeStore(data);
}

export async function createPair(input: {
  name: string;
  storefrontId: string;
  checkoutId: string;
  activate: boolean;
}): Promise<IntegrationRow> {
  const [storefront, checkout] = await Promise.all([
    getStoreById(input.storefrontId),
    getStoreById(input.checkoutId),
  ]);
  if (!storefront || storefront.store_type !== "storefront") {
    throw new Error("Selecione uma loja do tipo Vitrine.");
  }
  if (!checkout || checkout.store_type !== "checkout") {
    throw new Error("Selecione uma loja do tipo Checkout.");
  }
  const { data, error } = await getDb()
    .from("integrations")
    .insert({
      name: input.name.trim(),
      storefront_id: input.storefrontId,
      checkout_id: input.checkoutId,
      status: "draft",
    })
    .select("*")
    .single();
  if (error) throw new Error(`Falha ao criar par: ${error.message}`);
  const pair = data as IntegrationRow;
  if (input.activate) await activatePair(pair.id);
  return pair;
}

export async function activatePair(integrationId: string): Promise<void> {
  const pair = await getIntegrationById(integrationId);
  if (!pair) throw new Error("Par não encontrado.");
  const [storefront, checkout] = await Promise.all([
    getStoreById(pair.storefront_id),
    getStoreById(pair.checkout_id),
  ]);
  if (!storefront || storefront.status !== "active") {
    throw new Error("A loja Vitrine precisa estar conectada antes de ativar o par.");
  }
  if (!checkout || checkout.status !== "active") {
    throw new Error("A loja Checkout precisa estar configurada antes de ativar o par.");
  }
  const { error: clearError } = await getDb()
    .from("integrations")
    .update({ status: "draft", updated_at: new Date().toISOString() })
    .eq("storefront_id", pair.storefront_id)
    .eq("status", "active")
    .neq("id", pair.id);
  if (clearError) throw new Error(`Falha ao desativar par anterior: ${clearError.message}`);
  const { error } = await getDb()
    .from("integrations")
    .update({ status: "active", updated_at: new Date().toISOString() })
    .eq("id", pair.id);
  if (error) throw new Error(`Falha ao ativar par: ${error.message}`);
}

export async function updateIntegrationName(integrationId: string, name: string): Promise<void> {
  const { error } = await getDb()
    .from("integrations")
    .update({ name, updated_at: new Date().toISOString() })
    .eq("id", integrationId);
  if (error) throw new Error(`Falha ao renomear par: ${error.message}`);
}

export async function setIntegrationStatus(
  integrationId: string,
  status: IntegrationStatus,
): Promise<void> {
  if (status === "active") {
    await activatePair(integrationId);
    return;
  }
  const { error } = await getDb()
    .from("integrations")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", integrationId);
  if (error) throw new Error(`Falha ao atualizar par: ${error.message}`);
}

export async function deleteIntegration(integrationId: string): Promise<void> {
  const { error } = await getDb().from("integrations").delete().eq("id", integrationId);
  if (error) throw new Error(`Falha ao excluir par: ${error.message}`);
}

export async function configureExternalStore(input: {
  name: string;
  baseUrl: string;
  currency: string;
}): Promise<StoreRow> {
  const integration = await getSelectedIntegration();
  if (!integration) throw new Error("Nenhum par selecionado.");
  const existing = await getStoreByRoleForIntegration("b", integration.id);
  if (!existing) throw new Error("Este par não tem loja Checkout.");
  await flagMappingsForStore(existing.id);
  const { data, error } = await getDb()
    .from("stores")
    .update({
      platform: "external",
      name: input.name,
      shop_domain: null,
      primary_domain: null,
      currency: input.currency.toUpperCase(),
      status: "active",
      external_base_url: input.baseUrl,
      admin_token_cipher: null,
      refresh_token_cipher: null,
      token_expires_at: null,
      refresh_token_expires_at: null,
      scopes: [],
      storefront_token_cipher: null,
      storefront_token_kind: null,
      storefront_api_version: null,
      last_synced_at: null,
      connected_at: new Date().toISOString(),
      shopify_client_id: null,
      shopify_client_secret_cipher: null,
    })
    .eq("id", existing.id)
    .select("*")
    .single();
  if (error) throw new Error(`Falha ao atualizar loja externa: ${error.message}`);
  return normalizeStore(data);
}

export async function updateStoreDetails(input: {
  storeId: string;
  name: string;
  shopDomain?: string | null;
  externalBaseUrl?: string | null;
  currency?: string | null;
  scopes?: string | null;
}): Promise<StoreRow> {
  const existing = await getStoreById(input.storeId);
  if (!existing) throw new Error("Loja não encontrada.");

  if (existing.store_type === "storefront" || existing.platform === "shopify") {
    const nextDomain = input.shopDomain?.trim().toLowerCase() || existing.shop_domain;
    const domainChanged = Boolean(nextDomain && nextDomain !== existing.shop_domain);
    if (domainChanged) await flagMappingsForStore(existing.id);
    const patch: Record<string, unknown> = {
      name: input.name.trim(),
      shop_domain: nextDomain,
      shopify_scopes: input.scopes?.trim() || existing.shopify_scopes,
    };
    if (domainChanged) {
      patch.primary_domain = null;
      patch.currency = null;
      patch.status = "pending";
      patch.admin_token_cipher = null;
      patch.refresh_token_cipher = null;
      patch.token_expires_at = null;
      patch.refresh_token_expires_at = null;
      patch.storefront_token_cipher = null;
      patch.storefront_token_kind = null;
      patch.storefront_api_version = null;
      patch.scopes = [];
      patch.last_synced_at = null;
    }
    const { data, error } = await getDb()
      .from("stores")
      .update(patch)
      .eq("id", existing.id)
      .select("*")
      .single();
    if (error) throw new Error(`Falha ao atualizar loja: ${error.message}`);
    return normalizeStore(data);
  }

  const { data, error } = await getDb()
    .from("stores")
    .update({
      name: input.name.trim(),
      external_base_url: input.externalBaseUrl?.trim() || existing.external_base_url,
      currency: input.currency?.trim().toUpperCase() || existing.currency,
      status: "active",
    })
    .eq("id", existing.id)
    .select("*")
    .single();
  if (error) throw new Error(`Falha ao atualizar loja externa: ${error.message}`);
  return normalizeStore(data);
}

export async function switchStoreBToShopify(input: {
  storeId: string;
  name: string;
  shopDomain: string;
  clientId: string;
  clientSecret: string;
  scopes?: string | null;
}): Promise<void> {
  const existing = await getStoreById(input.storeId);
  if (!existing || existing.store_type !== "checkout") throw new Error("Loja Checkout não encontrada.");
  const cipher = encryptStoreClientSecret(existing.id, input.clientSecret);
  await flagMappingsForStore(existing.id);
  const { error } = await getDb()
    .from("stores")
    .update({
      platform: "shopify",
      name: input.name.trim(),
      shop_domain: input.shopDomain.trim().toLowerCase(),
      primary_domain: null,
      currency: null,
      external_base_url: null,
      status: "pending",
      shopify_client_id: input.clientId.trim(),
      shopify_client_secret_cipher: cipher,
      shopify_scopes: input.scopes?.trim() || "read_products,write_themes",
      admin_token_cipher: null,
      refresh_token_cipher: null,
      token_expires_at: null,
      refresh_token_expires_at: null,
      storefront_token_cipher: null,
      storefront_token_kind: null,
      storefront_api_version: null,
      scopes: [],
      last_synced_at: null,
      last_check_at: null,
      last_check_error: null,
      connected_at: null,
    })
    .eq("id", existing.id);
  if (error) throw new Error(`Falha ao trocar a loja para Shopify: ${error.message}`);
}

export async function updateStoreOAuthCredentials(input: {
  storeId: string;
  clientId: string;
  clientSecret?: string | null;
  scopes?: string | null;
}): Promise<void> {
  const existing = await getStoreById(input.storeId);
  if (!existing || existing.platform !== "shopify") throw new Error("Loja Shopify não encontrada.");
  if (existing.shopify_client_id !== input.clientId && !input.clientSecret) {
    throw new Error("Ao trocar o Client ID, informe também o novo Client Secret.");
  }
  const cipher = input.clientSecret
    ? encryptStoreClientSecret(existing.id, input.clientSecret)
    : existing.shopify_client_secret_cipher;
  if (!cipher) throw new Error("Informe o Client Secret.");
  const { error } = await getDb()
    .from("stores")
    .update({
      shopify_client_id: input.clientId,
      shopify_client_secret_cipher: cipher,
      shopify_scopes: input.scopes?.trim() || existing.shopify_scopes,
      status: "pending",
      admin_token_cipher: null,
      refresh_token_cipher: null,
      token_expires_at: null,
      refresh_token_expires_at: null,
      scopes: [],
    })
    .eq("id", existing.id);
  if (error) throw new Error(`Falha ao salvar credenciais da loja: ${error.message}`);
}

export async function updateStoreConnection(input: {
  storeId: string;
  shopDomain: string;
  primaryDomain: string | null;
  name: string;
  currency: string;
  adminTokenCipher: string;
  refreshTokenCipher: string | null;
  tokenExpiresAt: Date | null;
  refreshTokenExpiresAt: Date | null;
  scopes: string[];
}): Promise<StoreRow> {
  const existing = await getStoreById(input.storeId);
  if (!existing) throw new Error("Loja não encontrada.");
  if (existing.platform !== "shopify") throw new Error("A loja não é Shopify.");

  const sameShop = existing.shop_domain === input.shopDomain;
  const status: StoreStatus =
    existing.store_type === "storefront" || Boolean(existing.storefront_token_cipher && sameShop)
      ? "active"
      : "pending";
  if (!sameShop) await flagMappingsForStore(existing.id);

  const patch: Record<string, unknown> = {
    name: input.name,
    shop_domain: input.shopDomain,
    primary_domain: input.primaryDomain?.toLowerCase() ?? null,
    currency: input.currency,
    admin_token_cipher: input.adminTokenCipher,
    refresh_token_cipher: input.refreshTokenCipher,
    token_expires_at: input.tokenExpiresAt?.toISOString() ?? null,
    refresh_token_expires_at: input.refreshTokenExpiresAt?.toISOString() ?? null,
    scopes: input.scopes,
    status,
    connected_at: new Date().toISOString(),
    external_base_url: null,
    platform: "shopify",
  };
  if (!sameShop) {
    patch.storefront_token_cipher = null;
    patch.storefront_token_kind = null;
    patch.storefront_api_version = null;
    patch.last_synced_at = null;
  }

  const { data, error } = await getDb()
    .from("stores")
    .update(patch)
    .eq("id", existing.id)
    .select("*")
    .single();
  if (error) throw new Error(`Falha ao salvar loja Shopify: ${error.message}`);
  return normalizeStore(data);
}

export async function saveStorefrontToken(input: {
  storeId: string;
  tokenCipher: string;
  kind: "public" | "private";
  apiVersion: string;
}): Promise<void> {
  const { error } = await getDb()
    .from("stores")
    .update({
      storefront_token_cipher: input.tokenCipher,
      storefront_token_kind: input.kind,
      storefront_api_version: input.apiVersion,
      status: "active",
    })
    .eq("id", input.storeId);
  if (error) throw new Error(`Falha ao salvar token da Storefront API: ${error.message}`);
}

export async function updateStoreStatus(storeId: string, status: StoreStatus): Promise<void> {
  const { error } = await getDb().from("stores").update({ status }).eq("id", storeId);
  if (error) throw new Error(`Falha ao atualizar status da loja: ${error.message}`);
}

export async function disconnectStore(storeId: string): Promise<void> {
  const { error } = await getDb()
    .from("stores")
    .update({
      status: "disconnected",
      admin_token_cipher: null,
      refresh_token_cipher: null,
      token_expires_at: null,
      refresh_token_expires_at: null,
      storefront_token_cipher: null,
      storefront_token_kind: null,
    })
    .eq("id", storeId);
  if (error) throw new Error(`Falha ao desconectar loja: ${error.message}`);
}

export async function markStoreSynced(storeId: string): Promise<void> {
  const { error } = await getDb()
    .from("stores")
    .update({ last_synced_at: new Date().toISOString() })
    .eq("id", storeId);
  if (error) throw new Error(`Falha ao marcar sincronização: ${error.message}`);
}

export async function updateStoreTokens(input: {
  storeId: string;
  adminTokenCipher: string;
  refreshTokenCipher: string | null;
  tokenExpiresAt: Date | null;
  refreshTokenExpiresAt: Date | null;
  scopes?: string[];
}): Promise<void> {
  const patch: Record<string, unknown> = {
    admin_token_cipher: input.adminTokenCipher,
    refresh_token_cipher: input.refreshTokenCipher,
    token_expires_at: input.tokenExpiresAt?.toISOString() ?? null,
    refresh_token_expires_at: input.refreshTokenExpiresAt?.toISOString() ?? null,
  };
  if (input.scopes) patch.scopes = input.scopes;
  const { error } = await getDb().from("stores").update(patch).eq("id", input.storeId);
  if (error) throw new Error(`Falha ao atualizar tokens: ${error.message}`);
}

export async function markStoreCheck(storeId: string, error: string | null): Promise<void> {
  const { error: dbError } = await getDb()
    .from("stores")
    .update({ last_check_at: new Date().toISOString(), last_check_error: error })
    .eq("id", storeId);
  if (dbError) throw new Error(`Falha ao registrar teste da loja: ${dbError.message}`);
}

export async function markStoreSyncAttempt(storeId: string): Promise<void> {
  const { error } = await getDb()
    .from("stores")
    .update({ last_sync_attempt_at: new Date().toISOString() })
    .eq("id", storeId);
  if (error) throw new Error(`Falha ao registrar tentativa de sync: ${error.message}`);
}

export async function getNextStoreForSync(): Promise<StoreRow | null> {
  const { data, error } = await getDb()
    .from("stores")
    .select("*")
    .eq("platform", "shopify")
    .eq("status", "active")
    .not("admin_token_cipher", "is", null)
    .order("last_sync_attempt_at", { ascending: true, nullsFirst: true })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`Falha ao selecionar loja para sincronização: ${error.message}`);
  return data ? normalizeStore(data) : null;
}

/** Erases all data for a shop (GDPR shop/redact). Cascades remove variants, mappings and transfers. */
export async function deleteStoreDataByShopDomain(shopDomain: string): Promise<void> {
  const { error } = await getDb().from("stores").delete().eq("shop_domain", shopDomain);
  if (error) throw new Error(`Falha ao apagar dados da loja: ${error.message}`);
}
