import "server-only";

import Decimal from "decimal.js";
import { recordAudit } from "@/lib/db/audit";
import { getVariantWithProduct } from "@/lib/db/catalog";
import { getMappingById, getMappingsForAVariantIds, setMappingStatus, upsertMapping } from "@/lib/db/mappings";
import { listVariantsWithProduct } from "@/lib/db/catalog";
import { getSelectedIntegration, getStoreByRole } from "@/lib/db/stores";
import type { MappingRow } from "@/lib/db/types";
import {
  assertCurrencyMatch,
  compareExternalTarget,
  compareShopifyVariants,
  computePriceFields,
  destinationLabel,
  nonZeroPriceDiff,
  validateExternalUrl,
} from "@/lib/domain/mapping-rules";
import { normalizeAmount } from "@/lib/money";
import { isProduction } from "@/lib/env";
import { installThemeIntegration } from "@/lib/services/theme-install";

function requireAcknowledgements(identityAck: boolean, priceAck: boolean, diff: string): void {
  if (!identityAck) {
    throw new Error("Confirme que as variantes representam o mesmo produto real.");
  }
  if (nonZeroPriceDiff(diff) && !priceAck) {
    throw new Error("Confirme a diferença de preço antes de ativar o mapeamento.");
  }
}

function validatePrice(value: string): string {
  let amount: Decimal;
  try {
    amount = new Decimal(value.replace(",", ".").trim());
  } catch {
    throw new Error("Preço da Loja B inválido.");
  }
  if (!amount.isFinite() || amount.isNegative()) throw new Error("Preço da Loja B inválido.");
  return normalizeAmount(amount.toFixed(6));
}

export async function activateShopifyMapping(input: {
  aVariantId: string;
  bVariantId: string;
  identityAck: boolean;
  priceAck: boolean;
  notes: string | null;
}): Promise<MappingRow> {
  const [storeA, storeB] = await Promise.all([getStoreByRole("a"), getStoreByRole("b")]);
  if (!storeA || storeA.status !== "active" || storeA.platform !== "shopify") {
    throw new Error("A Loja A (Shopify) precisa estar conectada.");
  }
  if (!storeB || storeB.status !== "active" || storeB.platform !== "shopify") {
    throw new Error("A Loja B (Shopify) precisa estar conectada e com a Storefront API configurada.");
  }

  const [aVariant, bVariant] = await Promise.all([
    getVariantWithProduct(input.aVariantId),
    getVariantWithProduct(input.bVariantId),
  ]);
  if (!aVariant || aVariant.store_id !== storeA.id || !aVariant.is_current) {
    throw new Error("Variante da Loja A inválida ou desatualizada.");
  }
  if (!bVariant || bVariant.store_id !== storeB.id || !bVariant.is_current) {
    throw new Error("Variante da Loja B inválida ou desatualizada.");
  }

  const pair = await getSelectedIntegration();
  if (!pair || pair.storefront_id !== storeA.id || pair.checkout_id !== storeB.id) {
    throw new Error("Selecione o par vitrine↔checkout correto antes de ativar o mapeamento.");
  }
  assertCurrencyMatch(aVariant.currency, bVariant.currency, storeA.currency, storeB.currency);
  const comparison = compareShopifyVariants(aVariant, bVariant);
  const prices = computePriceFields(aVariant.price_amount, bVariant.price_amount);
  requireAcknowledgements(input.identityAck, input.priceAck, prices.diff);

  const mapping = await upsertMapping({
    integration_id: pair.id,
    store_a_id: storeA.id,
    store_a_variant_id: aVariant.id,
    store_b_id: storeB.id,
    store_b_variant_id: bVariant.id,
    mode: "shopify",
    status: "active",
    currency_a: aVariant.currency,
    currency_b: bVariant.currency,
    price_a: prices.priceA,
    price_b: prices.priceB,
    price_diff: prices.diff,
    price_diff_percent: prices.percent,
    external_product_url: null,
    external_product_title: null,
    external_variant_title: null,
    external_sku: null,
    identity_ack: input.identityAck,
    price_ack: input.priceAck,
    notes: input.notes?.slice(0, 500) || null,
    activated_at: new Date().toISOString(),
    last_checked_at: new Date().toISOString(),
  });

  await recordAudit({
    storeId: storeA.id,
    eventType: "mapping_activated",
    metadata: {
      mode: "shopify",
      mappingId: mapping.id,
      currency: aVariant.currency,
      priceDifference: prices.diff,
      identitySku: comparison.identity.sku,
      destination: destinationLabel(storeB),
    },
  });
  return mapping;
}

export async function activateExternalMapping(input: {
  aVariantId: string;
  productUrl: string;
  productTitle: string;
  variantTitle: string;
  sku: string;
  price: string;
  currency: string;
  identityAck: boolean;
  priceAck: boolean;
  notes: string | null;
}): Promise<MappingRow> {
  const [storeA, storeB] = await Promise.all([getStoreByRole("a"), getStoreByRole("b")]);
  if (!storeA || storeA.status !== "active" || storeA.platform !== "shopify") {
    throw new Error("A Loja A (Shopify) precisa estar conectada.");
  }
  if (!storeB || storeB.status !== "active" || storeB.platform !== "external" || !storeB.external_base_url) {
    throw new Error("A Loja B externa precisa estar configurada.");
  }
  const aVariant = await getVariantWithProduct(input.aVariantId);
  if (!aVariant || aVariant.store_id !== storeA.id || !aVariant.is_current) {
    throw new Error("Variante da Loja A inválida ou desatualizada.");
  }
  const pair = await getSelectedIntegration();
  if (!pair || pair.storefront_id !== storeA.id || pair.checkout_id !== storeB.id) {
    throw new Error("Selecione o par vitrine↔checkout correto antes de ativar o mapeamento.");
  }

  const currency = input.currency.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error("Moeda da Loja B inválida.");
  assertCurrencyMatch(aVariant.currency, storeB.currency, currency);

  const targetUrl = validateExternalUrl(storeB.external_base_url, input.productUrl, {
    allowHttp: storeB.external_base_url.startsWith("http://") && !isProduction(),
  });
  const title = input.productTitle.trim().slice(0, 255);
  const variantTitle = input.variantTitle.trim().slice(0, 255);
  const sku = input.sku.trim().slice(0, 255);
  if (!title || !variantTitle) throw new Error("Informe o produto e a variante do destino externo.");

  const price = validatePrice(input.price);
  const comparison = compareExternalTarget(
    aVariant,
    {
      url: targetUrl,
      title,
      variantTitle,
      sku,
      price,
      currency,
    },
    storeB.currency ?? currency,
  );
  const prices = computePriceFields(aVariant.price_amount, price);
  requireAcknowledgements(input.identityAck, input.priceAck, prices.diff);

  const mapping = await upsertMapping({
    integration_id: pair.id,
    store_a_id: storeA.id,
    store_a_variant_id: aVariant.id,
    store_b_id: storeB.id,
    store_b_variant_id: null,
    mode: "external",
    status: "active",
    currency_a: aVariant.currency,
    currency_b: currency,
    price_a: prices.priceA,
    price_b: prices.priceB,
    price_diff: prices.diff,
    price_diff_percent: prices.percent,
    external_product_url: targetUrl,
    external_product_title: title,
    external_variant_title: variantTitle,
    external_sku: sku || null,
    identity_ack: input.identityAck,
    price_ack: input.priceAck,
    notes: input.notes?.slice(0, 500) || null,
    activated_at: new Date().toISOString(),
    last_checked_at: new Date().toISOString(),
  });

  await recordAudit({
    storeId: storeA.id,
    eventType: "mapping_activated",
    metadata: {
      mode: "external",
      mappingId: mapping.id,
      currency,
      priceDifference: prices.diff,
      identitySku: comparison.identity.sku,
      destination: destinationLabel(storeB),
    },
  });

  // O mapeamento externo depende do script de produto no tema da vitrine.
  // Atualiza o tema automaticamente para não exigir uma ação manual extra.
  try {
    await installThemeIntegration(storeA);
  } catch {
    // O mapeamento continua ativo; o status do tema fica registrado para o painel.
  }

  return mapping;
}

export async function deactivateMapping(mappingId: string): Promise<void> {
  const mapping = await getMappingById(mappingId);
  if (!mapping) throw new Error("Mapeamento não encontrado.");
  await setMappingStatus(mappingId, "disabled");
  await recordAudit({
    storeId: mapping.store_a_id,
    eventType: "mapping_needs_review",
    metadata: { mappingId, action: "disabled" },
  });
}

export async function autoMapDraftsBySku(): Promise<{
  matched: number;
  skipped: number;
  duplicatesInB: number;
}> {
  const [storeA, storeB] = await Promise.all([getStoreByRole("a"), getStoreByRole("b")]);
  if (!storeA || storeA.status !== "active" || storeA.platform !== "shopify") {
    throw new Error("A Loja A (Shopify) precisa estar conectada.");
  }
  if (!storeB || storeB.status !== "active" || storeB.platform !== "shopify") {
    throw new Error("A Loja B (Shopify) precisa estar conectada.");
  }
  if (storeA.currency !== storeB.currency) {
    throw new Error("As lojas precisam usar a mesma moeda para o auto-mapeamento.");
  }
  const pair = await getSelectedIntegration();
  if (!pair || pair.storefront_id !== storeA.id || pair.checkout_id !== storeB.id) {
    throw new Error("Selecione o par vitrine↔checkout correto antes de auto-mapear.");
  }

  const [variantsA, variantsB] = await Promise.all([
    listVariantsWithProduct(storeA.id, 1000),
    listVariantsWithProduct(storeB.id, 1000),
  ]);
  const aIds = variantsA.map((variant) => variant.id);
  const existing = [];
  for (let index = 0; index < aIds.length; index += 200) {
    existing.push(...(await getMappingsForAVariantIds(aIds.slice(index, index + 200))));
  }
  const mappedA = new Set(
    existing
      .filter((mapping) => mapping.integration_id === pair.id)
      .map((mapping) => mapping.store_a_variant_id),
  );

  const bySku = new Map<string, typeof variantsB>();
  for (const variant of variantsB) {
    const sku = variant.sku?.trim().toLowerCase();
    if (!sku) continue;
    const list = bySku.get(sku) ?? [];
    list.push(variant);
    bySku.set(sku, list);
  }

  let matched = 0;
  let skipped = 0;
  let duplicatesInB = 0;
  for (const aVariant of variantsA) {
    const sku = aVariant.sku?.trim().toLowerCase();
    if (!sku || mappedA.has(aVariant.id)) {
      skipped += 1;
      continue;
    }
    const candidates = bySku.get(sku) ?? [];
    if (candidates.length !== 1) {
      if (candidates.length > 1) duplicatesInB += 1;
      skipped += 1;
      continue;
    }
    const bVariant = candidates[0];
    const prices = computePriceFields(aVariant.price_amount, bVariant.price_amount);
    await upsertMapping({
      integration_id: pair.id,
      store_a_id: storeA.id,
      store_a_variant_id: aVariant.id,
      store_b_id: storeB.id,
      store_b_variant_id: bVariant.id,
      mode: "shopify",
      status: "draft",
      currency_a: aVariant.currency,
      currency_b: bVariant.currency,
      price_a: prices.priceA,
      price_b: prices.priceB,
      price_diff: prices.diff,
      price_diff_percent: prices.percent,
      external_product_url: null,
      external_product_title: null,
      external_variant_title: null,
      external_sku: null,
      identity_ack: false,
      price_ack: false,
      notes: "Rascunho criado por auto-mapeamento de SKU. Revise antes de ativar.",
      activated_at: null,
      last_checked_at: new Date().toISOString(),
    });
    matched += 1;
  }

  await recordAudit({
    storeId: storeA.id,
    eventType: "mapping_draft_created",
    metadata: { matched, skipped, duplicatesInB },
  });
  return { matched, skipped, duplicatesInB };
}
