import "server-only";

import Decimal from "decimal.js";
import { randomToken, sha256Hex, signPayload, verifySignedPayload } from "@/lib/crypto";
import { recordAudit } from "@/lib/db/audit";
import {
  getIntegrationById,
  getIntegrationForStoreA,
  getShopifyStoreByDomain,
  getStoreById,
  getStoreByRoleForIntegration,
} from "@/lib/db/stores";
import {
  getMappingById,
  getMappingsForAVariantIds,
} from "@/lib/db/mappings";
import {
  getVariantByExternalId,
  getVariantsWithProductByIds,
} from "@/lib/db/catalog";
import {
  claimTransfer,
  completeTransfer,
  createTransferSession,
  expireTransfer,
  failTransfer,
  getTransferByTokenHash,
} from "@/lib/db/transfers";
import type { MappingRow, StoreRow, TransferLine, TransferRow } from "@/lib/db/types";
import {
  appendAttributionToUrl,
  hasAttribution,
  sanitizeAttribution,
  type Attribution,
} from "@/lib/domain/attribution";
import { validateExternalUrl, destinationLabel } from "@/lib/domain/mapping-rules";
import { amountsEqual, sumAmounts } from "@/lib/money";
import { isProduction } from "@/lib/env";
import { fetchLiveVariants, type AdminVariant } from "@/lib/shopify/admin";
import { createDestinationCart, StorefrontApiError } from "@/lib/shopify/storefront";

const GID_PATTERN = /^gid:\/\/shopify\/ProductVariant\/\d+$/;
const TRANSFER_TTL_MS = 30 * 60 * 1000;

export type TransferIssue = {
  code: string;
  message: string;
  variantId?: string;
  productTitle?: string;
  variantTitle?: string | null;
  quantity?: number;
};

export class TransferError extends Error {
  readonly code: string;
  readonly httpStatus: number;
  readonly issues: TransferIssue[];

  constructor(message: string, options: {
    code: string;
    httpStatus?: number;
    issues?: TransferIssue[];
  }) {
    super(message);
    this.name = "TransferError";
    this.code = options.code;
    this.httpStatus = options.httpStatus ?? 400;
    this.issues = options.issues ?? [];
  }
}

type NormalizedItem = { variantId: string; quantity: number };

function normalizeItems(raw: unknown): NormalizedItem[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new TransferError("O carrinho está vazio.", { code: "EMPTY_CART", httpStatus: 400 });
  }
  if (raw.length > 50) {
    throw new TransferError("Há itens demais no carrinho para uma transferência.", {
      code: "TOO_MANY_ITEMS",
      httpStatus: 400,
    });
  }
  const merged = new Map<string, number>();
  for (const item of raw) {
    if (!item || typeof item !== "object") {
      throw new TransferError("Item de carrinho inválido.", { code: "INVALID_ITEM", httpStatus: 400 });
    }
    const variantId = (item as { variantId?: unknown }).variantId;
    const quantity = (item as { quantity?: unknown }).quantity;
    if (typeof variantId !== "string" || !GID_PATTERN.test(variantId)) {
      throw new TransferError("Identificador de variante inválido.", {
        code: "INVALID_VARIANT_ID",
        httpStatus: 400,
      });
    }
    if (!Number.isInteger(quantity) || (quantity as number) < 1 || (quantity as number) > 99) {
      throw new TransferError("Quantidade inválida.", { code: "INVALID_QUANTITY", httpStatus: 400 });
    }
    const next = (merged.get(variantId) ?? 0) + (quantity as number);
    if (next > 99) {
      throw new TransferError("A quantidade somada de um item passa de 99.", {
        code: "INVALID_QUANTITY",
        httpStatus: 400,
      });
    }
    merged.set(variantId, next);
  }
  return [...merged.entries()].map(([variantId, quantity]) => ({ variantId, quantity }));
}

function issueFor(
  code: string,
  message: string,
  details: Partial<Pick<TransferIssue, "variantId" | "productTitle" | "variantTitle" | "quantity">> = {},
): TransferIssue {
  return { code, message, ...details };
}

type ItemContext = {
  item: NormalizedItem;
  aVariant: Awaited<ReturnType<typeof getVariantByExternalId>>;
  mapping: MappingRow | null;
};

async function loadContexts(
  storeA: StoreRow,
  storeB: StoreRow,
  items: NormalizedItem[],
  integrationId: string,
): Promise<{ contexts: ItemContext[]; issues: TransferIssue[] }> {
  const issues: TransferIssue[] = [];
  const aVariants = await Promise.all(
    items.map((item) => getVariantByExternalId(storeA.id, item.variantId)),
  );
  const mappingRows = await getMappingsForAVariantIds(
    aVariants.filter((variant): variant is NonNullable<typeof variant> => Boolean(variant)).map((variant) => variant.id),
  );
  const mappingByVariant = new Map(
    mappingRows
      .filter((mapping) => mapping.integration_id === integrationId)
      .map((mapping) => [mapping.store_a_variant_id, mapping]),
  );

  const contexts: ItemContext[] = items.map((item, index) => {
    const aVariant = aVariants[index];
    const mapping = aVariant ? mappingByVariant.get(aVariant.id) ?? null : null;
    if (!aVariant) {
      issues.push(
        issueFor("VARIANT_NOT_IMPORTED", "Este item ainda não foi importado para a integração.", {
          variantId: item.variantId,
          quantity: item.quantity,
        }),
      );
      return { item, aVariant, mapping };
    }
    const details = {
      variantId: item.variantId,
      productTitle: aVariant.product.title,
      variantTitle: aVariant.title,
      quantity: item.quantity,
    };
    if (!mapping) {
      issues.push(
        issueFor(
          "NOT_MAPPED",
          `"${aVariant.product.title}" não tem correspondência na Loja B. A transferência do carrinho foi bloqueada.`,
          details,
        ),
      );
    } else if (mapping.status === "needs_review") {
      issues.push(
        issueFor(
          "MAPPING_NEEDS_REVIEW",
          `"${aVariant.product.title}" está com o mapeamento em revisão. A transferência foi bloqueada até a loja confirmar produto, variante e preço.`,
          details,
        ),
      );
    } else if (mapping.status !== "active") {
      issues.push(
        issueFor(
          "MAPPING_INACTIVE",
          `"${aVariant.product.title}" não está disponível para transferência.`,
          details,
        ),
      );
    } else if (mapping.store_b_id !== storeB.id) {
      issues.push(
        issueFor("WRONG_DESTINATION", "Este item está mapeado para outra loja de destino.", details),
      );
    } else if (mapping.mode !== "shopify") {
      issues.push(
        issueFor(
          "EXTERNAL_DESTINATION",
          "A Loja B é externa: este item só pode ser aberto por link direto, sem transferência de carrinho.",
          details,
        ),
      );
    } else if (!mapping.store_b_variant_id) {
      issues.push(
        issueFor("MISSING_DESTINATION_VARIANT", "A variante de destino não está mais disponível.", details),
      );
    }
    return { item, aVariant, mapping };
  });

  return { contexts, issues };
}

function compareLive(input: {
  context: ItemContext;
  liveA: AdminVariant | undefined;
  liveB: AdminVariant | undefined;
  storeA: StoreRow;
  storeB: StoreRow;
}): TransferIssue | null {
  const { context, liveA, liveB, storeA, storeB } = input;
  const details = {
    variantId: context.item.variantId,
    productTitle: context.aVariant?.product.title,
    variantTitle: context.aVariant?.title,
    quantity: context.item.quantity,
  };
  if (!liveA) {
    return issueFor("SOURCE_VARIANT_MISSING", "A variante não existe mais na Loja A.", details);
  }
  if (!liveA.availableForSale || liveA.product.status !== "ACTIVE") {
    return issueFor("SOURCE_UNAVAILABLE", "Este item não está disponível na Loja A.", details);
  }
  if (!context.mapping) return issueFor("MAPPING_INACTIVE", "Mapeamento indisponível.", details);
  if (!amountsEqual(liveA.price, context.mapping.price_a)) {
    return issueFor(
      "SOURCE_PRICE_CHANGED",
      "O preço na Loja A mudou desde a ativação do mapeamento. A transferência foi bloqueada para conferência.",
      details,
    );
  }
  if (!liveB) {
    return issueFor(
      "DESTINATION_VARIANT_MISSING",
      "A variante correspondente não existe mais na Loja B.",
      details,
    );
  }
  if (!liveB.availableForSale || liveB.product.status !== "ACTIVE") {
    return issueFor("DESTINATION_UNAVAILABLE", "Este item está indisponível na Loja B.", details);
  }
  if (!amountsEqual(liveB.price, context.mapping.price_b)) {
    return issueFor(
      "DESTINATION_PRICE_CHANGED",
      "O preço na Loja B mudou desde a ativação do mapeamento. A transferência foi bloqueada para evitar cobrança divergente.",
      details,
    );
  }
  if (context.aVariant?.currency !== context.mapping.currency_a) {
    return issueFor("CURRENCY_MISMATCH", "As moedas do mapeamento são incompatíveis.", details);
  }
  if (!storeA.currency || !storeB.currency || storeA.currency !== storeB.currency) {
    return issueFor("CURRENCY_MISMATCH", "As lojas usam moedas diferentes.", details);
  }
  if (context.mapping.currency_a !== storeA.currency || context.mapping.currency_b !== storeB.currency) {
    return issueFor("CURRENCY_MISMATCH", "A moeda do mapeamento não corresponde às lojas.", details);
  }
  return null;
}

export type PrepareTransferResult = {
  token: string;
  expiresAt: string;
  lineCount: number;
  subtotal: string;
  currency: string;
};

export async function prepareTransfer(input: {
  shopDomain: string;
  items: unknown;
  attribution?: unknown;
  marketingConsent?: unknown;
}): Promise<PrepareTransferResult> {
  const items = normalizeItems(input.items);
  const storeA = await getShopifyStoreByDomain(input.shopDomain);
  if (!storeA || storeA.status !== "active" || storeA.platform !== "shopify" || storeA.role !== "a") {
    throw new TransferError("A Loja A não está disponível para transferência.", {
      code: "SOURCE_NOT_READY",
      httpStatus: 503,
    });
  }
  const integration = await getIntegrationForStoreA(storeA.id);
  if (!integration) {
    throw new TransferError("Esta Loja A não está vinculada a uma integração.", {
      code: "INTEGRATION_NOT_FOUND",
      httpStatus: 503,
    });
  }
  if (integration.status === "disabled") {
    throw new TransferError("Esta integração está desativada.", {
      code: "INTEGRATION_DISABLED",
      httpStatus: 503,
    });
  }
  const storeB = await getStoreByRoleForIntegration("b", integration.id);
  if (!storeB || storeB.status !== "active") {
    throw new TransferError("A Loja B não está disponível para transferência.", {
      code: "DESTINATION_NOT_READY",
      httpStatus: 503,
    });
  }
  if (storeB.platform !== "shopify") {
    throw new TransferError(
      "A Loja B é externa. Use os links de produto; não há carrinho para transferir.",
      { code: "EXTERNAL_NO_CART", httpStatus: 409 },
    );
  }
  if (!storeB.storefront_token_cipher) {
    throw new TransferError("A Loja B ainda não configurou o checkout.", {
      code: "DESTINATION_NOT_READY",
      httpStatus: 503,
    });
  }
  if (!storeA.currency || !storeB.currency || storeA.currency !== storeB.currency) {
    throw new TransferError("As lojas precisam usar a mesma moeda.", {
      code: "CURRENCY_MISMATCH",
      httpStatus: 409,
    });
  }

  const { contexts, issues } = await loadContexts(storeA, storeB, items, integration.id);
  if (issues.length > 0) {
    throw new TransferError("A transferência foi bloqueada por itens sem correspondência válida.", {
      code: "TRANSFER_BLOCKED",
      httpStatus: 409,
      issues,
    });
  }

  const aGids = contexts.map((context) => context.item.variantId);
  const bGids = contexts
    .map((context) => context.mapping?.store_b_variant_id)
    .filter((value): value is string => Boolean(value));
  const bVariantRows = await getVariantsWithProductByIds(bGids);
  const bRowMap = new Map(bVariantRows.map((variant) => [variant.id, variant]));
  const bGidById = new Map(bVariantRows.map((variant) => [variant.id, variant.external_id]));

  const destinationSeen = new Map<string, string>();
  const duplicateIssues: TransferIssue[] = [];
  for (const context of contexts) {
    const bDb = bRowMap.get(context.mapping!.store_b_variant_id!);
    if (!bDb) continue;
    if (destinationSeen.has(bDb.external_id)) {
      duplicateIssues.push(
        issueFor(
          "DUPLICATE_DESTINATION",
          "Mais de um item da Loja A aponta para a mesma variante da Loja B. Ajuste os mapeamentos antes de transferir.",
          {
            variantId: context.item.variantId,
            productTitle: context.aVariant?.product.title,
            variantTitle: context.aVariant?.title,
            quantity: context.item.quantity,
          },
        ),
      );
    } else {
      destinationSeen.set(bDb.external_id, context.item.variantId);
    }
  }
  if (duplicateIssues.length > 0) {
    throw new TransferError("A transferência foi bloqueada por mapeamentos duplicados no destino.", {
      code: "TRANSFER_BLOCKED",
      httpStatus: 409,
      issues: duplicateIssues,
    });
  }

  let liveA: Map<string, AdminVariant>;
  let liveB: Map<string, AdminVariant>;
  try {
    [liveA, liveB] = await Promise.all([
      fetchLiveVariants(storeA, aGids),
      fetchLiveVariants(storeB, [...bGidById.values()]),
    ]);
  } catch {
    throw new TransferError("Não foi possível conferir os produtos agora. Tente novamente.", {
      code: "LIVE_CHECK_FAILED",
      httpStatus: 503,
    });
  }

  const liveIssues: TransferIssue[] = [];
  for (const context of contexts) {
    const mapping = context.mapping!;
    const bDb = bRowMap.get(mapping.store_b_variant_id!);
    if (!bDb || !bDb.is_current) {
      liveIssues.push(
        issueFor("DESTINATION_VARIANT_MISSING", "A variante de destino não está mais disponível.", {
          variantId: context.item.variantId,
          productTitle: context.aVariant?.product.title,
          variantTitle: context.aVariant?.title,
          quantity: context.item.quantity,
        }),
      );
      continue;
    }
    const issue = compareLive({
      context,
      liveA: liveA.get(context.item.variantId),
      liveB: liveB.get(bDb.external_id),
      storeA,
      storeB,
    });
    if (issue) liveIssues.push(issue);
  }
  if (liveIssues.length > 0) {
    throw new TransferError("A transferência foi bloqueada por divergência de produto, preço ou estoque.", {
      code: "TRANSFER_BLOCKED",
      httpStatus: 409,
      issues: liveIssues,
    });
  }

  const lines: TransferLine[] = contexts.map((context) => {
    const mapping = context.mapping!;
    const bDb = bRowMap.get(mapping.store_b_variant_id!)!;
    const liveAValue = liveA.get(context.item.variantId)!;
    const liveBValue = liveB.get(bDb.external_id)!;
    return {
      mappingId: mapping.id,
      aVariantId: context.aVariant!.id,
      aVariantExternalId: context.item.variantId,
      aProductTitle: liveAValue.product.title,
      aVariantTitle: liveAValue.title,
      aSku: liveAValue.sku,
      quantity: context.item.quantity,
      unitPriceA: mapping.price_a,
      bVariantId: bDb.id,
      bVariantExternalId: bDb.external_id,
      bProductTitle: liveBValue.product.title,
      bVariantTitle: liveBValue.title,
      bSku: liveBValue.sku,
      unitPriceB: mapping.price_b,
      currency: mapping.currency_b,
    };
  });

  const subtotal = sumAmounts(lines.map((line) => new Decimal(line.unitPriceB).times(line.quantity).toFixed(6)));
  const marketingConsent = input.marketingConsent === true;
  const attribution = marketingConsent ? sanitizeAttribution(input.attribution) : {};
  const token = randomToken(32);
  const expiresAt = new Date(Date.now() + TRANSFER_TTL_MS).toISOString();

  await createTransferSession({
    token_hash: sha256Hex(token),
    store_a_id: storeA.id,
    store_b_id: storeB.id,
    lines,
    currency: storeB.currency,
    subtotal,
    attribution,
    attribution_consent: false,
    visitor_consent: { marketing: marketingConsent },
    expires_at: expiresAt,
  });

  await recordAudit({
    storeId: storeA.id,
    eventType: "transfer_prepared",
    metadata: {
      lines: lines.length,
      currency: storeB.currency,
      subtotal,
      destination: destinationLabel(storeB),
    },
  });

  return { token, expiresAt, lineCount: lines.length, subtotal, currency: storeB.currency };
}

export type CompleteTransferResult = {
  checkoutUrl: string;
  warnings: string[];
};

export async function completeTransferForBuyer(input: {
  token: string;
  attributionConsent: boolean;
  buyerIp?: string | null;
}): Promise<CompleteTransferResult> {
  if (!input.token || input.token.length > 200) {
    throw new TransferError("Link de transferência inválido.", {
      code: "INVALID_TRANSFER_TOKEN",
      httpStatus: 400,
    });
  }
  const tokenHash = sha256Hex(input.token);
  const transfer = await getTransferByTokenHash(tokenHash);
  if (!transfer) {
    throw new TransferError("Transferência não encontrada.", {
      code: "TRANSFER_NOT_FOUND",
      httpStatus: 404,
    });
  }
  if (transfer.status === "completed" && transfer.checkout_url) {
    return { checkoutUrl: transfer.checkout_url, warnings: [] };
  }
  if (transfer.status === "failed") {
    throw new TransferError("Esta transferência não pôde ser concluída. Volte ao carrinho.", {
      code: "TRANSFER_FAILED",
      httpStatus: 409,
    });
  }
  if (transfer.status === "expired" || new Date(transfer.expires_at).getTime() <= Date.now()) {
    await expireTransfer(transfer.id);
    throw new TransferError("Esta transferência expirou. Refaça a transferência a partir do carrinho.", {
      code: "TRANSFER_EXPIRED",
      httpStatus: 410,
    });
  }
  if (transfer.status === "processing") {
    throw new TransferError("O checkout já está sendo criado. Aguarde alguns segundos.", {
      code: "TRANSFER_IN_PROGRESS",
      httpStatus: 409,
    });
  }

  const storeA = await getStoreById(transfer.store_a_id);
  const storeB = await getStoreById(transfer.store_b_id);
  if (!storeA || !storeB || storeA.status !== "active" || storeB.status !== "active" || storeB.platform !== "shopify") {
    throw new TransferError("A loja de destino não está disponível.", {
      code: "DESTINATION_NOT_READY",
      httpStatus: 503,
    });
  }

  const claimToken = randomToken(16);
  const claim = await claimTransfer(transfer.id, claimToken);
  if (!claim.claimed || !claim.transfer || claim.transfer.claim_token !== claimToken) {
    const current = claim.transfer;
    if (current?.status === "completed" && current.checkout_url) {
      return { checkoutUrl: current.checkout_url, warnings: [] };
    }
    throw new TransferError("Esta transferência já está sendo processada.", {
      code: "TRANSFER_IN_PROGRESS",
      httpStatus: 409,
    });
  }

  try {
    const checked = await revalidateTransfer(claim.transfer, storeA, storeB);
    const attributionConsent =
      input.attributionConsent && hasAttribution(checked.attribution);
    const attributes = buildCheckoutAttributes({
      transfer: checked,
      storeA,
      storeB,
      attribution: attributionConsent ? checked.attribution : {},
    });
    const cart = await createDestinationCart({
      store: storeB,
      lines: checked.lines.map((line) => ({
        variantId: line.bVariantExternalId!,
        quantity: line.quantity,
        expectedUnitPrice: line.unitPriceB,
        attributes: {
          csb_source_product: line.aProductTitle,
          csb_source_variant: line.aVariantTitle ?? "",
          csb_source_sku: line.aSku ?? "",
          csb_source_shop: storeA.name,
        },
      })),
      attributes,
      marketingConsent: attributionConsent,
      buyerIp: input.buyerIp,
    });
    let checkoutUrl = cart.checkoutUrl;
    if (attributionConsent) {
      checkoutUrl = appendAttributionToUrl(checkoutUrl, checked.attribution);
    }
    await completeTransfer(checked.id, checkoutUrl);
    await recordAudit({
      storeId: storeA.id,
      eventType: "checkout_created",
      metadata: {
        transferId: checked.id,
        currency: cart.currency,
        lines: checked.lines.length,
        destination: destinationLabel(storeB),
        attributionShared: attributionConsent,
        warnings: cart.warnings.length,
      },
    });
    return { checkoutUrl, warnings: cart.warnings };
  } catch (error) {
    const code = error instanceof TransferError
      ? error.code
      : error instanceof StorefrontApiError
        ? error.code
        : "CHECKOUT_FAILED";
    const message = error instanceof Error ? error.message : "Falha ao criar o checkout.";
    await failTransfer(transfer.id, code, message);
    await recordAudit({
      storeId: storeA.id,
      eventType: "checkout_failed",
      metadata: { transferId: transfer.id, code },
    });
    if (error instanceof TransferError) throw error;
    if (error instanceof StorefrontApiError) {
      throw new TransferError(
        error.code === "PRICE_CHANGED_DURING_CART_CREATION"
          ? "O preço mudou ao criar o checkout. A compra foi interrompida por segurança."
          : "A loja de destino não conseguiu criar o checkout.",
        { code: error.code, httpStatus: 502, issues: [] },
      );
    }
    throw new TransferError("Não foi possível criar o checkout na Loja B.", {
      code: "CHECKOUT_FAILED",
      httpStatus: 502,
    });
  }
}

async function revalidateTransfer(
  transfer: TransferRow,
  storeA: StoreRow,
  storeB: StoreRow,
): Promise<TransferRow> {
  const issues: TransferIssue[] = [];
  const mappingIds = [...new Set(transfer.lines.map((line) => line.mappingId))];
  const mappingRows = await Promise.all(mappingIds.map((id) => getMappingById(id)));
  const mappingById = new Map(
    mappingRows.filter((mapping): mapping is MappingRow => Boolean(mapping)).map((mapping) => [mapping.id, mapping]),
  );

  const bVariantIds = transfer.lines
    .map((line) => line.bVariantId)
    .filter((id): id is string => Boolean(id));
  const bRows = await getVariantsWithProductByIds(bVariantIds);
  const bRowById = new Map(bRows.map((variant) => [variant.id, variant]));
  if (new Set(bVariantIds).size !== bVariantIds.length) {
    throw new TransferError("A transferência contém mapeamentos duplicados no destino.", {
      code: "TRANSFER_INVALIDATED",
      httpStatus: 409,
      issues: [
        issueFor(
          "DUPLICATE_DESTINATION",
          "Mais de um item aponta para a mesma variante da Loja B. Refaça a transferência.",
        ),
      ],
    });
  }

  const aGids = transfer.lines.map((line) => line.aVariantExternalId);
  const bGids = bRows.map((variant) => variant.external_id);
  let liveA: Map<string, AdminVariant>;
  let liveB: Map<string, AdminVariant>;
  try {
    [liveA, liveB] = await Promise.all([
      fetchLiveVariants(storeA, aGids),
      fetchLiveVariants(storeB, bGids),
    ]);
  } catch {
    throw new TransferError("Não foi possível conferir os produtos agora.", {
      code: "LIVE_CHECK_FAILED",
      httpStatus: 503,
    });
  }

  for (const line of transfer.lines) {
    const mapping = mappingById.get(line.mappingId);
    const bRow = line.bVariantId ? bRowById.get(line.bVariantId) : undefined;
    const details = {
      variantId: line.aVariantExternalId,
      productTitle: line.aProductTitle,
      variantTitle: line.aVariantTitle,
      quantity: line.quantity,
    };
    if (!mapping || mapping.status !== "active" || mapping.mode !== "shopify") {
      issues.push(
        issueFor("MAPPING_CHANGED", "O mapeamento deste item mudou. Refaça a transferência.", details),
      );
      continue;
    }
    if (
      mapping.store_b_id !== storeB.id ||
      mapping.store_b_variant_id !== line.bVariantId ||
      !amountsEqual(mapping.price_a, line.unitPriceA) ||
      !amountsEqual(mapping.price_b, line.unitPriceB) ||
      mapping.currency_a !== line.currency ||
      mapping.currency_b !== line.currency
    ) {
      issues.push(
        issueFor("MAPPING_CHANGED", "Os dados do mapeamento mudaram. Refaça a transferência.", details),
      );
      continue;
    }
    if (!bRow) {
      issues.push(
        issueFor("DESTINATION_VARIANT_MISSING", "A variante de destino não existe mais.", details),
      );
      continue;
    }
    if (
      !amountsEqual(bRow.price_amount, line.unitPriceB) ||
      bRow.currency !== line.currency
    ) {
      issues.push(
        issueFor("DESTINATION_PRICE_CHANGED", "O preço na Loja B mudou. Refaça a transferência.", details),
      );
      continue;
    }
    if (mapping.store_a_variant_id !== line.aVariantId) {
      issues.push(
        issueFor("MAPPING_CHANGED", "A variante de origem do mapeamento mudou. Refaça a transferência.", details),
      );
      continue;
    }
    const a = liveA.get(line.aVariantExternalId);
    const b = liveB.get(bRow.external_id);
    if (!a || !a.availableForSale || a.product.status !== "ACTIVE") {
      issues.push(issueFor("SOURCE_UNAVAILABLE", "O item não está mais disponível na Loja A.", details));
      continue;
    }
    if (!b || !b.availableForSale || b.product.status !== "ACTIVE") {
      issues.push(issueFor("DESTINATION_UNAVAILABLE", "O item não está mais disponível na Loja B.", details));
      continue;
    }
    if (!amountsEqual(a.price, line.unitPriceA)) {
      issues.push(
        issueFor("SOURCE_PRICE_CHANGED", "O preço na Loja A mudou. Refaça a transferência.", details),
      );
      continue;
    }
    if (!amountsEqual(b.price, line.unitPriceB)) {
      issues.push(
        issueFor("DESTINATION_PRICE_CHANGED", "O preço na Loja B mudou. Refaça a transferência.", details),
      );
    }
  }

  if (
    !storeA.currency ||
    !storeB.currency ||
    storeA.currency !== storeB.currency ||
    transfer.currency !== storeB.currency
  ) {
    throw new TransferError("A moeda da transferência não corresponde mais às lojas.", {
      code: "CURRENCY_MISMATCH",
      httpStatus: 409,
    });
  }

  if (issues.length > 0) {
    throw new TransferError("A transferência não pôde ser concluída porque os dados mudaram.", {
      code: "TRANSFER_INVALIDATED",
      httpStatus: 409,
      issues,
    });
  }
  return transfer;
}

function buildCheckoutAttributes(input: {
  transfer: TransferRow;
  storeA: StoreRow;
  storeB: StoreRow;
  attribution: Attribution;
}): Record<string, string> {
  const attributes: Record<string, string> = {
    csb_integration: "cross-store-bridge",
    csb_source_store: input.storeA.name,
    csb_sale_owner: input.storeB.name,
    csb_destination_domain: destinationLabel(input.storeB),
    csb_transfer_id: input.transfer.id,
  };
  for (const [key, value] of Object.entries(input.attribution)) {
    attributes[key] = value;
  }
  return attributes;
}

export type PublicProductMapping =
  | { available: false; reason: "not_mapped" | "needs_review" | "destination_unavailable" | "external_unavailable" }
  | {
      available: true;
      mode: "transfer" | "external";
      destination: { name: string; domain: string; platform: "shopify" | "external" };
      priceA: string;
      priceB: string;
      currency: string;
      disclosure: string;
      linkPath?: string;
    };

export async function resolveProductMapping(input: {
  shopDomain: string;
  variantId: string;
}): Promise<PublicProductMapping> {
  if (!GID_PATTERN.test(input.variantId)) return { available: false, reason: "not_mapped" };
  const storeA = await getShopifyStoreByDomain(input.shopDomain);
  if (!storeA || storeA.role !== "a" || storeA.status !== "active") {
    return { available: false, reason: "not_mapped" };
  }
  const aVariant = await getVariantByExternalId(storeA.id, input.variantId);
  if (!aVariant) return { available: false, reason: "not_mapped" };
  const pair = await getIntegrationForStoreA(storeA.id);
  if (!pair) return { available: false, reason: "not_mapped" };
  const mappings = await getMappingsForAVariantIds([aVariant.id]);
  const mapping = mappings.find((row) => row.integration_id === pair.id) ?? null;
  if (!mapping) return { available: false, reason: "not_mapped" };
  if (mapping.status === "needs_review") return { available: false, reason: "needs_review" };
  if (mapping.status !== "active") return { available: false, reason: "not_mapped" };
  const integration = await getIntegrationById(mapping.integration_id);
  if (!integration || integration.status !== "active") {
    return { available: false, reason: "not_mapped" };
  }

  const storeB = await getStoreById(mapping.store_b_id);
  if (!storeB || storeB.status !== "active") return { available: false, reason: "destination_unavailable" };

  if (mapping.mode === "external") {
    if (!storeB.external_base_url || !mapping.external_product_url) {
      return { available: false, reason: "external_unavailable" };
    }
    try {
      validateExternalUrl(storeB.external_base_url, mapping.external_product_url, {
        allowHttp: storeB.external_base_url.startsWith("http://") && !isProduction(),
      });
    } catch {
      return { available: false, reason: "external_unavailable" };
    }
    const linkToken = signPayload({ mappingId: mapping.id }, 3600);
    return {
      available: true,
      mode: "external",
      destination: {
        name: storeB.name,
        domain: destinationLabel(storeB),
        platform: "external",
      },
      priceA: mapping.price_a,
      priceB: mapping.price_b,
      currency: mapping.currency_b,
      disclosure: `Você será levado ao site da ${storeB.name} (${destinationLabel(storeB)}), responsável pela venda.`,
      linkPath: `/go/${linkToken}`,
    };
  }

  if (storeB.platform !== "shopify" || !storeB.storefront_token_cipher) {
    return { available: false, reason: "destination_unavailable" };
  }
  return {
    available: true,
    mode: "transfer",
    destination: {
      name: storeB.name,
      domain: destinationLabel(storeB),
      platform: "shopify",
    },
    priceA: mapping.price_a,
    priceB: mapping.price_b,
    currency: mapping.currency_b,
    disclosure: `A compra será concluída no checkout da ${storeB.name} (${destinationLabel(storeB)}), responsável pela venda.`,
  };
}

export type ExternalLinkResolution = {
  mapping: MappingRow;
  storeB: StoreRow;
  targetUrl: string;
};

export async function resolveExternalLinkToken(token: string): Promise<ExternalLinkResolution | null> {
  const payload = verifySignedPayload<{ mappingId: string }>(token, { maxAgeSeconds: 3600 });
  if (!payload || typeof payload.mappingId !== "string") return null;
  const mapping = await getMappingById(payload.mappingId);
  if (!mapping || mapping.status !== "active" || mapping.mode !== "external") return null;
  const integration = await getIntegrationById(mapping.integration_id);
  if (!integration || integration.status !== "active") return null;
  const [storeA, storeB] = await Promise.all([
    getStoreById(mapping.store_a_id),
    getStoreById(mapping.store_b_id),
  ]);
  if (!storeA || storeA.status !== "active") return null;
  if (!storeB || storeB.status !== "active" || storeB.platform !== "external" || !storeB.external_base_url) {
    return null;
  }
  if (!mapping.external_product_url) return null;
  let targetUrl: string;
  try {
    targetUrl = validateExternalUrl(storeB.external_base_url, mapping.external_product_url, {
      allowHttp: storeB.external_base_url.startsWith("http://") && !isProduction(),
    });
  } catch {
    return null;
  }
  return { mapping, storeB, targetUrl };
}

export async function publicStorefrontConfig(shopDomain: string): Promise<{
  enabled: boolean;
  destination?: { name: string; domain: string; platform: "shopify" | "external" };
  mode?: "transfer" | "external";
}> {
  const storeA = await getShopifyStoreByDomain(shopDomain);
  if (!storeA || storeA.role !== "a" || storeA.status !== "active") return { enabled: false };
  const integration = await getIntegrationForStoreA(storeA.id);
  if (!integration || integration.status === "disabled") return { enabled: false };
  const storeB = await getStoreByRoleForIntegration("b", integration.id);
  if (!storeB || storeB.status !== "active") return { enabled: false };
  if (storeB.platform === "shopify" && !storeB.storefront_token_cipher) return { enabled: false };
  if (storeB.platform === "external" && !storeB.external_base_url) return { enabled: false };
  return {
    enabled: true,
    mode: storeB.platform === "shopify" ? "transfer" : "external",
    destination: {
      name: storeB.name,
      domain: destinationLabel(storeB),
      platform: storeB.platform,
    },
  };
}
