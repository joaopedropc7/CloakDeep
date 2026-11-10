"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import {
  changeAdminPassword,
  clearAdminSession,
  createAdminSession,
  requireAdmin,
  verifyAdminPassword,
} from "@/lib/auth";
import { recordAudit } from "@/lib/db/audit";
import { rateLimit } from "@/lib/rate-limit";
import { isProduction } from "@/lib/env";
import {
  INTEGRATION_COOKIE,
  configureExternalStore,
  activatePair,
  createPair,
  createStore,
  deleteIntegration,
  disconnectStore,
  getIntegrationById,
  getStoreById,
  getStoreByRole,
  setIntegrationStatus,
  switchStoreBToShopify,
  updateIntegrationName,
  updateStoreDetails,
  updateStoreOAuthCredentials,
} from "@/lib/db/stores";
import { testStoreConnection } from "@/lib/services/store-health";
import { autoMapDraftsBySku } from "@/lib/services/mappings";
import { isValidShopDomain, normalizeShopDomain } from "@/lib/shopify/oauth";
import { syncCatalog } from "@/lib/services/catalog";
import { configureStorefrontAccess } from "@/lib/services/storefront-access";
import {
  activateExternalMapping,
  activateShopifyMapping,
  deactivateMapping,
} from "@/lib/services/mappings";
import { installThemeIntegration, rollbackThemeIntegration } from "@/lib/services/theme-install";

function loginError(message: string): never {
  redirect(`/admin/login?error=${encodeURIComponent(message)}`);
}

export async function loginAction(formData: FormData): Promise<void> {
  const requestHeaders = await headers();
  const ip =
    requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    requestHeaders.get("x-real-ip") ??
    "unknown";
  const limit = rateLimit(`admin-login:${ip}`, 6, 15 * 60 * 1000);
  if (!limit.allowed) loginError("Muitas tentativas. Aguarde 15 minutos.");

  const password = formData.get("password");
  if (typeof password !== "string" || !password) loginError("Informe a senha.");

  let valid = false;
  try {
    valid = await verifyAdminPassword(password);
  } catch {
    loginError("Senha administrativa não configurada. Defina ADMIN_PASSWORD ou use /admin/settings.");
  }
  if (!valid) loginError("Senha incorreta.");
  await createAdminSession();
  redirect("/admin");
}



export async function renameIntegrationAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = stringField(formData, "integration_id");
  const name = stringField(formData, "name");
  try {
    if (name.length < 2) throw new Error("Informe um nome para a integração.");
    await updateIntegrationName(id, name);
    revalidatePath("/admin/stores");
    redirectWithMessage("/admin/stores", "saved", "Integração renomeada.");
  } catch (error) {
    if (isRedirectError(error)) throw error;
    redirectWithMessage("/admin/stores", "error", error instanceof Error ? error.message : "Falha.");
  }
}

export async function setIntegrationStatusAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = stringField(formData, "integration_id");
  const status = stringField(formData, "status");
  try {
    if (!["draft", "active", "disabled"].includes(status)) throw new Error("Status inválido.");
    await setIntegrationStatus(id, status as "draft" | "active" | "disabled");
    revalidatePath("/admin/stores");
    redirectWithMessage("/admin/stores", "saved", "Status da integração atualizado.");
  } catch (error) {
    if (isRedirectError(error)) throw error;
    redirectWithMessage("/admin/stores", "error", error instanceof Error ? error.message : "Falha.");
  }
}

export async function deleteIntegrationAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = stringField(formData, "integration_id");
  const confirm = stringField(formData, "confirm");
  try {
    if (confirm !== "EXCLUIR") throw new Error('Digite EXCLUIR para confirmar a exclusão.');
    await deleteIntegration(id);
    const cookieStore = await cookies();
    if (cookieStore.get(INTEGRATION_COOKIE)?.value === id) cookieStore.delete(INTEGRATION_COOKIE);
    revalidatePath("/admin");
    revalidatePath("/admin/stores");
    redirectWithMessage("/admin/stores", "saved", "Integração excluída.");
  } catch (error) {
    if (isRedirectError(error)) throw error;
    redirectWithMessage("/admin/stores", "error", error instanceof Error ? error.message : "Falha.");
  }
}

export async function updateStoreDetailsAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const storeId = stringField(formData, "store_id");
  const name = stringField(formData, "name");
  const shopDomain = normalizeShopDomain(stringField(formData, "shop_domain"));
  const scopes = stringField(formData, "shopify_scopes");
  const externalBase = stringField(formData, "external_base_url");
  const currency = stringField(formData, "currency").toUpperCase();
  try {
    const store = await getStoreById(storeId);
    if (!store) throw new Error("Loja não encontrada.");
    if (!name) throw new Error("Informe o nome da loja.");
    if (store.platform === "shopify") {
      if (!isValidShopDomain(shopDomain)) throw new Error("Domínio Shopify inválido.");
      await updateStoreDetails({ storeId, name, shopDomain, scopes });
    } else {
      let url: URL;
      try {
        url = new URL(externalBase);
      } catch {
        throw new Error("URL externa inválida.");
      }
      const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
      if (url.protocol !== "https:" && !(process.env.NODE_ENV !== "production" && url.protocol === "http:" && local)) {
        throw new Error("A Loja B externa precisa usar HTTPS.");
      }
      if (url.username || url.password || url.search || url.hash || (url.pathname && url.pathname !== "/")) {
        throw new Error("Informe apenas a origem da Loja B externa.");
      }
      if (!/^[A-Z]{3}$/.test(currency)) throw new Error("Moeda inválida.");
      await updateStoreDetails({ storeId, name, externalBaseUrl: url.origin, currency });
    }
    revalidatePath("/admin/stores");
    redirectWithMessage("/admin/stores", "saved", "Dados da loja atualizados.");
  } catch (error) {
    if (isRedirectError(error)) throw error;
    redirectWithMessage("/admin/stores", "error", error instanceof Error ? error.message : "Falha.");
  }
}

export async function switchStoreBToShopifyAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const storeId = stringField(formData, "store_id");
  const name = stringField(formData, "name");
  const shopDomain = normalizeShopDomain(stringField(formData, "shop_domain"));
  const clientId = stringField(formData, "client_id");
  const clientSecret = stringField(formData, "client_secret");
  const scopes = stringField(formData, "shopify_scopes");
  try {
    if (!name) throw new Error("Informe o nome da Loja B.");
    if (!isValidShopDomain(shopDomain)) throw new Error("Domínio Shopify inválido.");
    if (clientId.length < 10) throw new Error("Informe o Client ID.");
    if (clientSecret.length < 10) throw new Error("Informe o Client Secret.");
    await switchStoreBToShopify({ storeId, name, shopDomain, clientId, clientSecret, scopes });
    revalidatePath("/admin/stores");
    redirectWithMessage("/admin/stores", "saved", "Loja B convertida para Shopify. Conecte por OAuth.");
  } catch (error) {
    if (isRedirectError(error)) throw error;
    redirectWithMessage("/admin/stores", "error", error instanceof Error ? error.message : "Falha.");
  }
}

export async function testStoreConnectionAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const storeId = stringField(formData, "store_id");
  try {
    const message = await testStoreConnection(storeId);
    revalidatePath("/admin/stores");
    redirectWithMessage("/admin/stores", "saved", message);
  } catch (error) {
    if (isRedirectError(error)) throw error;
    revalidatePath("/admin/stores");
    redirectWithMessage("/admin/stores", "error", error instanceof Error ? error.message : "Falha no teste.");
  }
}

export async function autoMapBySkuAction(): Promise<void> {
  await requireAdmin();
  try {
    const result = await autoMapDraftsBySku();
    revalidatePath("/admin/mappings");
    revalidatePath("/admin");
    redirectWithMessage(
      "/admin/mappings?status=draft",
      "saved",
      `Auto-mapeamento: ${result.matched} rascunho(s), ${result.skipped} ignorado(s), ${result.duplicatesInB} SKU(s) duplicado(s) na Loja B.`,
    );
  } catch (error) {
    if (isRedirectError(error)) throw error;
    redirectWithMessage("/admin/mappings", "error", error instanceof Error ? error.message : "Falha.");
  }
}

export async function changeAdminPasswordAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const current = stringField(formData, "current_password");
  const next = stringField(formData, "new_password");
  const confirm = stringField(formData, "confirm_password");
  try {
    if (!current) throw new Error("Informe a senha atual.");
    if (next !== confirm) throw new Error("A confirmação da nova senha não confere.");
    await changeAdminPassword(current, next);
    await recordAudit({ eventType: "admin_password_changed", metadata: {} });
    revalidatePath("/admin/settings");
    redirectWithMessage("/admin/settings", "saved", "Senha administrativa alterada.");
  } catch (error) {
    if (isRedirectError(error)) throw error;
    redirectWithMessage("/admin/settings", "error", error instanceof Error ? error.message : "Falha.");
  }
}

export async function logoutAction(): Promise<void> {
  await clearAdminSession();
  redirect("/admin/login");
}

function cleanMessage(value: unknown): string {
  return (typeof value === "string" ? value : "Falha inesperada.")
    .replace(/\s+/g, " ")
    .slice(0, 300);
}

function redirectWithMessage(path: string, key: "error" | "saved", message: string): never {
  const separator = path.includes("?") ? "&" : "?";
  redirect(`${path}${separator}${key}=${encodeURIComponent(cleanMessage(message))}`);
}

function safeReturnTo(value: FormDataEntryValue | null): string {
  if (typeof value !== "string" || value.length > 4000) return "/admin/mappings";
  try {
    const parsed = new URL(value, "http://internal.invalid");
    if (parsed.origin !== "http://internal.invalid") return "/admin/mappings";
    if (parsed.pathname !== "/admin/mappings" && !parsed.pathname.startsWith("/admin/mappings/")) {
      return "/admin/mappings";
    }
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return "/admin/mappings";
  }
}

function checkbox(formData: FormData, name: string): boolean {
  return formData.get(name) === "on";
}

function stringField(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}


async function selectIntegrationCookie(id: string): Promise<void> {
  (await cookies()).set(INTEGRATION_COOKIE, id, {
    httpOnly: true,
    secure: isProduction(),
    sameSite: "lax",
    path: "/admin",
    maxAge: 60 * 60 * 24 * 30,
  });
}


export async function saveStoreOAuthCredentialsAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const storeId = stringField(formData, "store_id");
  const clientId = stringField(formData, "client_id");
  const clientSecret = stringField(formData, "client_secret");
  const scopes = stringField(formData, "scopes");
  try {
    if (!/^[0-9a-f-]{36}$/i.test(storeId)) throw new Error("Loja inválida.");
    if (clientId.length < 10) throw new Error("Informe o Client ID.");
    await updateStoreOAuthCredentials({
      storeId,
      clientId,
      clientSecret: clientSecret || null,
      scopes: scopes || null,
    });
    revalidatePath("/admin/stores");
    redirectWithMessage(
      "/admin/stores",
      "saved",
      "Credenciais salvas. Conecte a loja por OAuth para gerar um novo token.",
    );
  } catch (error) {
    if (isRedirectError(error)) throw error;
    redirectWithMessage("/admin/stores", "error", error instanceof Error ? error.message : "Falha.");
  }
}

export async function createStoreAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const name = stringField(formData, "name");
  const storeType = stringField(formData, "store_type");
  const platform = stringField(formData, "platform");
  const shopDomain = normalizeShopDomain(stringField(formData, "shop_domain"));
  const externalBase = stringField(formData, "external_base_url");
  const currency = stringField(formData, "currency").toUpperCase();
  const clientId = stringField(formData, "client_id");
  const clientSecret = stringField(formData, "client_secret");
  const scopes = stringField(formData, "scopes");
  try {
    if (name.length < 2) throw new Error("Informe um nome para a loja.");
    if (storeType !== "storefront" && storeType !== "checkout") throw new Error("Tipo de loja inválido.");
    if (platform !== "shopify" && platform !== "external") throw new Error("Plataforma inválida.");
    if (storeType === "storefront" && platform !== "shopify") {
      throw new Error("A loja Vitrine precisa ser Shopify.");
    }
    let externalOrigin: string | null = null;
    if (platform === "shopify") {
      if (!isValidShopDomain(shopDomain)) throw new Error("Domínio Shopify inválido.");
      if (clientId.length < 10) throw new Error("Informe o Client ID.");
      if (clientSecret.length < 10) throw new Error("Informe o Client Secret.");
    } else {
      if (storeType !== "checkout") throw new Error("Uma vitrine não pode ser externa.");
      let url: URL;
      try {
        url = new URL(externalBase);
      } catch {
        throw new Error("URL externa inválida.");
      }
      const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
      if (url.protocol !== "https:" && !(process.env.NODE_ENV !== "production" && url.protocol === "http:" && local)) {
        throw new Error("A loja externa precisa usar HTTPS.");
      }
      if (url.username || url.password || url.search || url.hash || (url.pathname && url.pathname !== "/")) {
        throw new Error("Informe apenas a origem da loja externa.");
      }
      if (!/^[A-Z]{3}$/.test(currency)) throw new Error("Moeda inválida.");
      externalOrigin = url.origin;
    }
    await createStore({
      name,
      storeType,
      platform,
      shopDomain: platform === "shopify" ? shopDomain : null,
      externalBaseUrl: externalOrigin,
      currency: platform === "external" ? currency : null,
      clientId: platform === "shopify" ? clientId : null,
      clientSecret: platform === "shopify" ? clientSecret : null,
      scopes: platform === "shopify" ? scopes : null,
    });
    revalidatePath("/admin/stores");
    redirectWithMessage("/admin/stores", "saved", "Loja cadastrada.");
  } catch (error) {
    if (isRedirectError(error)) throw error;
    redirectWithMessage("/admin/stores", "error", error instanceof Error ? error.message : "Falha.");
  }
}

export async function createPairAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const name = stringField(formData, "name");
  const storefrontId = stringField(formData, "storefront_id");
  const checkoutId = stringField(formData, "checkout_id");
  const activate = formData.get("activate") === "on";
  try {
    if (name.length < 2) throw new Error("Informe um nome para o par.");
    const pair = await createPair({ name, storefrontId, checkoutId, activate: false });
    await selectIntegrationCookie(pair.id);
    if (activate) {
      try {
        await activatePair(pair.id);
      } catch (activationError) {
        revalidatePath("/admin/stores");
        redirectWithMessage(
          "/admin/stores",
          "error",
          `Par criado como rascunho, mas não foi ativado: ${
            activationError instanceof Error ? activationError.message : "verifique as lojas."
          }`,
        );
      }
    }
    revalidatePath("/admin/stores");
    redirectWithMessage("/admin/stores", "saved", activate ? "Par criado e ativado." : "Par criado como rascunho.");
  } catch (error) {
    if (isRedirectError(error)) throw error;
    redirectWithMessage("/admin/stores", "error", error instanceof Error ? error.message : "Falha.");
  }
}

export async function selectIntegrationAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = stringField(formData, "integration_id");
  try {
    const integration = await getIntegrationById(id);
    if (!integration) throw new Error("Integração não encontrada.");
    await selectIntegrationCookie(integration.id);
    const returnTo = stringField(formData, "return_to") === "/admin/mappings" ? "/admin/mappings" : "/admin/stores";
    redirectWithMessage(returnTo, "saved", `Par selecionado: ${integration.name}.`);
  } catch (error) {
    if (isRedirectError(error)) throw error;
    redirectWithMessage("/admin/stores", "error", error instanceof Error ? error.message : "Falha.");
  }
}

export async function saveExternalStoreAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const name = stringField(formData, "name");
  const baseUrlRaw = stringField(formData, "base_url");
  const currency = stringField(formData, "currency").toUpperCase();

  try {
    if (name.length < 2) throw new Error("Informe o nome da Loja B.");
    if (!/^[A-Z]{3}$/.test(currency)) throw new Error("Informe a moeda com 3 letras (ex.: BRL).");
    let baseUrl: URL;
    try {
      baseUrl = new URL(baseUrlRaw);
    } catch {
      throw new Error("URL da Loja B inválida.");
    }
    const isLocal = baseUrl.hostname === "localhost" || baseUrl.hostname === "127.0.0.1";
    if (baseUrl.protocol !== "https:" && !(process.env.NODE_ENV !== "production" && baseUrl.protocol === "http:" && isLocal)) {
      throw new Error("A Loja B externa precisa usar HTTPS.");
    }
    if (baseUrl.username || baseUrl.password) throw new Error("A URL não pode conter credenciais.");
    if ((baseUrl.pathname && baseUrl.pathname !== "/") || baseUrl.search || baseUrl.hash) {
      throw new Error("Informe apenas a origem da Loja B, sem caminho, query ou fragmento.");
    }

    const storeA = await getStoreByRole("a");
    if (storeA?.currency && storeA.currency !== currency) {
      throw new Error(`A Loja B deve usar a mesma moeda da Loja A (${storeA.currency}).`);
    }

    await configureExternalStore({
      name,
      baseUrl: baseUrl.origin,
      currency,
    });
    revalidatePath("/admin/stores");
    redirectWithMessage("/admin/stores", "saved", "Loja B externa configurada.");
  } catch (error) {
    if (isRedirectError(error)) throw error;
    redirectWithMessage("/admin/stores", "error", error instanceof Error ? error.message : "Falha.");
  }
}

export async function saveStorefrontTokenAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const token = stringField(formData, "token");
  const kind = stringField(formData, "kind");
  const apiVersion = stringField(formData, "api_version");
  try {
    if (kind !== "private" && kind !== "public") throw new Error("Escolha o tipo de token.");
    await configureStorefrontAccess({
      token,
      kind,
      apiVersion: apiVersion || "2026-10",
    });
    revalidatePath("/admin/stores");
    redirectWithMessage("/admin/stores", "saved", "Storefront API validada e configurada.");
  } catch (error) {
    if (isRedirectError(error)) throw error;
    redirectWithMessage("/admin/stores", "error", error instanceof Error ? error.message : "Falha.");
  }
}

export async function importCatalogAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const storeId = stringField(formData, "store_id");
  try {
    const result = await syncCatalog(storeId);
    revalidatePath("/admin");
    revalidatePath("/admin/stores");
    revalidatePath("/admin/products");
    revalidatePath("/admin/mappings");
    const themeMessage =
      result.themeInstall?.status === "installed"
        ? " Integração instalada automaticamente no tema da Loja A."
        : result.themeInstall
          ? ` Tema: ${result.themeInstall.error ?? result.themeInstall.status}.`
          : "";
    redirectWithMessage(
      "/admin/products",
      "saved",
      `${result.products} produtos e ${result.variants} variantes importados. ${result.mappingsFlagged} mapeamento(s) sinalizado(s) para revisão.${themeMessage}`,
    );
  } catch (error) {
    if (isRedirectError(error)) throw error;
    revalidatePath("/admin/stores");
    redirectWithMessage(
      "/admin/stores",
      "error",
      error instanceof Error ? error.message : "Falha na importação.",
    );
  }
}

export async function installThemeAction(): Promise<void> {
  await requireAdmin();
  const storeA = await getStoreByRole("a");
  if (!storeA) {
    redirectWithMessage("/admin/stores", "error", "Conecte a Loja A antes de instalar no tema.");
  }
  try {
    const result = await installThemeIntegration(storeA);
    revalidatePath("/admin/stores");
    revalidatePath("/admin");
    if (result.installed) {
      redirectWithMessage("/admin/stores", "saved", "Integração instalada/atualizada automaticamente no tema.");
    }
    redirectWithMessage(
      "/admin/stores",
      "error",
      result.error ?? "Não foi possível instalar no tema.",
    );
  } catch (error) {
    if (isRedirectError(error)) throw error;
    redirectWithMessage("/admin/stores", "error", error instanceof Error ? error.message : "Falha.");
  }
}

export async function rollbackThemeAction(): Promise<void> {
  await requireAdmin();
  const storeA = await getStoreByRole("a");
  if (!storeA) {
    redirectWithMessage("/admin/stores", "error", "Conecte a Loja A antes de restaurar o tema.");
  }
  try {
    await rollbackThemeIntegration(storeA);
    revalidatePath("/admin/stores");
    redirectWithMessage("/admin/stores", "saved", "Layout do tema restaurado a partir do backup.");
  } catch (error) {
    if (isRedirectError(error)) throw error;
    redirectWithMessage("/admin/stores", "error", error instanceof Error ? error.message : "Falha.");
  }
}

export async function disconnectStoreAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const storeId = stringField(formData, "store_id");
  try {
    await disconnectStore(storeId);
    revalidatePath("/admin");
    revalidatePath("/admin/stores");
    redirectWithMessage("/admin/stores", "saved", "Loja desconectada e tokens removidos.");
  } catch (error) {
    if (isRedirectError(error)) throw error;
    redirectWithMessage("/admin/stores", "error", error instanceof Error ? error.message : "Falha.");
  }
}

export async function activateMappingAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const returnTo = safeReturnTo(formData.get("return_to"));
  const mode = stringField(formData, "mode");
  const aVariantId = stringField(formData, "a_variant_id");
  const identityAck = checkbox(formData, "identity_ack");
  const priceAck = checkbox(formData, "price_ack");
  const notes = stringField(formData, "notes").slice(0, 500) || null;

  try {
    if (!aVariantId) throw new Error("Variante da Loja A não informada.");
    if (mode === "shopify") {
      const bVariantId = stringField(formData, "b_variant_id");
      if (!bVariantId) throw new Error("Selecione a variante da Loja B.");
      await activateShopifyMapping({ aVariantId, bVariantId, identityAck, priceAck, notes });
    } else if (mode === "external") {
      await activateExternalMapping({
        aVariantId,
        productUrl: stringField(formData, "external_product_url"),
        productTitle: stringField(formData, "external_product_title"),
        variantTitle: stringField(formData, "external_variant_title"),
        sku: stringField(formData, "external_sku"),
        price: stringField(formData, "external_price"),
        currency: stringField(formData, "external_currency"),
        identityAck,
        priceAck,
        notes,
      });
    } else {
      throw new Error("Modo de mapeamento inválido.");
    }
    revalidatePath("/admin/mappings");
    revalidatePath("/admin");
    redirectWithMessage("/admin/mappings", "saved", "Mapeamento ativado.");
  } catch (error) {
    if (isRedirectError(error)) throw error;
    const separator = returnTo.includes("?") ? "&" : "?";
    redirect(`${returnTo}${separator}error=${encodeURIComponent(cleanMessage(error instanceof Error ? error.message : "Falha."))}`);
  }
}

export async function deactivateMappingAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const mappingId = stringField(formData, "mapping_id");
  try {
    await deactivateMapping(mappingId);
    revalidatePath("/admin/mappings");
    revalidatePath("/admin");
    redirectWithMessage("/admin/mappings", "saved", "Mapeamento desativado.");
  } catch (error) {
    if (isRedirectError(error)) throw error;
    redirectWithMessage("/admin/mappings", "error", error instanceof Error ? error.message : "Falha.");
  }
}

/**
 * Next.js redirect() works by throwing a special error. Re-throw it untouched so
 * a redirect inside a try/catch is not converted into a query-string message.
 */
function isRedirectError(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      "digest" in error &&
      typeof (error as { digest?: unknown }).digest === "string" &&
      (error as { digest: string }).digest.startsWith("NEXT_REDIRECT"),
  );
}
