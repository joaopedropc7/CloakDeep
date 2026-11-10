import Decimal from "decimal.js";
import type { CatalogVariantWithProduct } from "@/lib/db/catalog";
import type { StoreRow } from "@/lib/db/types";
import { amountsEqual, normalizeAmount, priceDifference } from "@/lib/money";

export type IdentityFlags = {
  sku: "match" | "mismatch" | "missing";
  productTitle: "match" | "mismatch";
  variantTitle: "match" | "mismatch" | "missing";
  options: "match" | "mismatch" | "unknown";
};

export type MappingComparison = {
  currencyMatch: boolean;
  priceMatch: boolean;
  priceDiff: string;
  priceDiffPercent: string;
  identity: IdentityFlags;
  warnings: string[];
};

function normalizeText(value: string | null | undefined): string {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeSku(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function optionsMatch(
  a: Array<{ name: string; value: string }>,
  b: Array<{ name: string; value: string }>,
): boolean {
  const normalize = (items: Array<{ name: string; value: string }>) =>
    items
      .map((item) => `${normalizeText(item.name)}=${normalizeText(item.value)}`)
      .sort()
      .join("|");
  return normalize(a) === normalize(b);
}

export function compareShopifyVariants(
  a: CatalogVariantWithProduct,
  b: CatalogVariantWithProduct,
): MappingComparison {
  const aSku = normalizeSku(a.sku);
  const bSku = normalizeSku(b.sku);
  const identity: IdentityFlags = {
    sku: !aSku || !bSku ? "missing" : aSku === bSku ? "match" : "mismatch",
    productTitle:
      normalizeText(a.product.title) === normalizeText(b.product.title) ? "match" : "mismatch",
    variantTitle:
      !normalizeText(a.title) || !normalizeText(b.title)
        ? "missing"
        : normalizeText(a.title) === normalizeText(b.title)
          ? "match"
          : "mismatch",
    options: optionsMatch(a.option_values, b.option_values) ? "match" : "mismatch",
  };
  const diff = priceDifference(a.price_amount, b.price_amount);
  const currencyMatch = a.currency === b.currency;
  const warnings: string[] = [];
  if (!currencyMatch) warnings.push("As moedas das variantes são diferentes.");
  if (!amountsEqual(a.price_amount, b.price_amount)) {
    warnings.push("Os preços são diferentes; o comprador pagará o preço da Loja B.");
  }
  if (identity.sku === "mismatch") warnings.push("Os SKUs são diferentes.");
  if (identity.sku === "missing") warnings.push("Uma das variantes não tem SKU para conferência.");
  if (identity.productTitle === "mismatch") warnings.push("Os títulos dos produtos são diferentes.");
  if (identity.variantTitle === "mismatch") warnings.push("Os títulos das variantes são diferentes.");
  if (identity.options === "mismatch") warnings.push("As opções das variantes são diferentes.");
  return {
    currencyMatch,
    priceMatch: amountsEqual(a.price_amount, b.price_amount),
    priceDiff: diff.amount,
    priceDiffPercent: diff.percent,
    identity,
    warnings,
  };
}

export type ExternalTargetInput = {
  url: string;
  title: string;
  variantTitle: string;
  sku: string;
  price: string;
  currency: string;
};

export function compareExternalTarget(
  a: CatalogVariantWithProduct,
  target: ExternalTargetInput,
  storeCurrency: string,
): MappingComparison {
  const aSku = normalizeSku(a.sku);
  const bSku = normalizeSku(target.sku);
  const identity: IdentityFlags = {
    sku: !aSku || !bSku ? "missing" : aSku === bSku ? "match" : "mismatch",
    productTitle:
      normalizeText(a.product.title) === normalizeText(target.title) ? "match" : "mismatch",
    variantTitle:
      !normalizeText(a.title) || !normalizeText(target.variantTitle)
        ? "missing"
        : normalizeText(a.title) === normalizeText(target.variantTitle)
          ? "match"
          : "mismatch",
    options: "unknown",
  };
  const diff = priceDifference(a.price_amount, target.price);
  const currencyMatch = a.currency === target.currency && target.currency === storeCurrency;
  const warnings: string[] = [];
  if (!currencyMatch) warnings.push("As moedas não correspondem.");
  if (!amountsEqual(a.price_amount, target.price)) {
    warnings.push("Os preços são diferentes; o comprador pagará o preço da Loja B.");
  }
  if (identity.sku === "mismatch") warnings.push("Os SKUs são diferentes.");
  if (identity.sku === "missing") warnings.push("Sem SKU para conferência.");
  if (identity.productTitle === "mismatch") warnings.push("Os títulos dos produtos são diferentes.");
  warnings.push("Confirme manualmente que o produto e a variante do site externo são os mesmos.");
  return {
    currencyMatch,
    priceMatch: amountsEqual(a.price_amount, target.price),
    priceDiff: diff.amount,
    priceDiffPercent: diff.percent,
    identity,
    warnings,
  };
}

export function validateExternalUrl(
  baseUrl: string,
  candidate: string,
  options: { allowHttp?: boolean } = {},
): string {
  let base: URL;
  let target: URL;
  try {
    base = new URL(baseUrl);
    target = new URL(candidate);
  } catch {
    throw new Error("URL do produto externo inválida.");
  }
  const allowHttp = options.allowHttp === true;
  const validProtocol =
    target.protocol === "https:" || (allowHttp && target.protocol === "http:");
  if (!validProtocol) throw new Error("A URL do produto externo deve usar HTTPS.");
  if (target.username || target.password) throw new Error("A URL não pode conter credenciais.");
  if (target.origin !== base.origin) {
    throw new Error("A URL precisa pertencer ao mesmo domínio da Loja B externa.");
  }
  if (candidate.length > 2000) throw new Error("URL do produto externo muito longa.");
  for (const [key, value] of target.searchParams.entries()) {
    if (/(email|e-mail|phone|telefone|token|secret|password|senha|auth|session|customer|cpf|cnpj|card)/i.test(key)) {
      throw new Error("A URL do produto não pode conter dados pessoais ou credenciais.");
    }
    if (/@|\beyJ[A-Za-z0-9_-]{10,}\.|\b(shpat_|shpca_|shprt_|shpss_)/i.test(value)) {
      throw new Error("A URL do produto não pode conter dados pessoais ou credenciais.");
    }
  }
  return target.toString();
}

export function assertCurrencyMatch(...currencies: Array<string | null | undefined>): void {
  const filtered = currencies.filter((currency): currency is string => Boolean(currency));
  if (filtered.length < 2) throw new Error("Moeda não configurada.");
  const [first, ...rest] = filtered;
  if (rest.some((currency) => currency !== first)) {
    throw new Error("As moedas da Loja A e da Loja B precisam ser iguais para ativar o mapeamento.");
  }
}

export function computePriceFields(a: string, b: string): {
  priceA: string;
  priceB: string;
  diff: string;
  percent: string;
} {
  const difference = priceDifference(a, b);
  return {
    priceA: normalizeAmount(a),
    priceB: normalizeAmount(b),
    diff: difference.amount,
    percent: difference.percent,
  };
}

export function nonZeroPriceDiff(diff: string): boolean {
  return !new Decimal(diff).isZero();
}

export function destinationLabel(store: StoreRow): string {
  if (store.platform === "external" && store.external_base_url) {
    try {
      return new URL(store.external_base_url).host;
    } catch {
      return store.external_base_url;
    }
  }
  return store.primary_domain || store.shop_domain || store.name;
}
