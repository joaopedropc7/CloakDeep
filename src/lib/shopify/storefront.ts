import "server-only";

import { shopifyApiVersion } from "@/lib/env";
import { decryptSecret } from "@/lib/crypto";
import type { StoreRow } from "@/lib/db/types";
import Decimal from "decimal.js";

const REQUEST_TIMEOUT_MS = 30_000;

export class StorefrontApiError extends Error {
  readonly code: string;
  readonly details: string[];
  constructor(message: string, code = "STOREFRONT_ERROR", details: string[] = []) {
    super(message);
    this.name = "StorefrontApiError";
    this.code = code;
    this.details = details;
  }
}

function storefrontAad(store: StoreRow): string {
  if (!store.shop_domain) throw new StorefrontApiError("Loja de destino sem domínio.", "INVALID_DESTINATION");
  return `storefront:${store.shop_domain}`;
}

type StorefrontOptions = {
  query: string;
  variables?: Record<string, unknown>;
  buyerIp?: string | null;
};

async function storefrontRequest<T>(store: StoreRow, options: StorefrontOptions): Promise<T> {
  if (store.platform !== "shopify" || !store.shop_domain) {
    throw new StorefrontApiError("A loja de destino não é Shopify.", "NOT_SHOPIFY");
  }
  if (!store.storefront_token_cipher || !store.storefront_token_kind) {
    throw new StorefrontApiError(
      "A Loja B ainda não tem token da Storefront API configurado.",
      "MISSING_STOREFRONT_TOKEN",
    );
  }
  const token = decryptSecret(store.storefront_token_cipher, storefrontAad(store));
  const version = store.storefront_api_version || shopifyApiVersion();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (store.storefront_token_kind === "private") {
    headers["Shopify-Storefront-Private-Token"] = token;
    if (options.buyerIp) headers["Shopify-Storefront-Buyer-IP"] = options.buyerIp;
  } else {
    headers["X-Shopify-Storefront-Access-Token"] = token;
  }

  let response: Response;
  try {
    response = await fetch(`https://${store.shop_domain}/api/${version}/graphql.json`, {
      method: "POST",
      headers,
      body: JSON.stringify({ query: options.query, variables: options.variables ?? {} }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new StorefrontApiError("Não foi possível alcançar a loja de destino.", "STOREFRONT_UNREACHABLE");
  }

  if (!response.ok) {
    throw new StorefrontApiError(
      `A Storefront API respondeu HTTP ${response.status}.`,
      response.status === 429 ? "THROTTLED" : "STOREFRONT_HTTP_ERROR",
    );
  }

  const envelope = (await response.json()) as {
    data?: T;
    errors?: Array<{ message: string; extensions?: { code?: string } }>;
  };
  if (envelope.errors?.length) {
    throw new StorefrontApiError(
      envelope.errors[0].message,
      envelope.errors[0].extensions?.code ?? "STOREFRONT_GRAPHQL_ERROR",
      envelope.errors.map((error) => error.message),
    );
  }
  if (!envelope.data) {
    throw new StorefrontApiError("A Storefront API não retornou dados.", "EMPTY_STOREFRONT_RESPONSE");
  }
  return envelope.data;
}

export type CartLineRequest = {
  variantId: string;
  quantity: number;
  expectedUnitPrice: string;
  attributes?: Record<string, string>;
};

export type CartCreateResult = {
  cartId: string;
  checkoutUrl: string;
  totalQuantity: number;
  subtotalAmount: string;
  currency: string;
  warnings: string[];
};

const CART_CREATE_MUTATION = `#graphql
  mutation CreateBridgeCart($input: CartInput!, $consent: VisitorConsent) @inContext(visitorConsent: $consent) {
    cartCreate(input: $input) {
      cart {
        id
        checkoutUrl
        totalQuantity
        cost {
          subtotalAmount { amount currencyCode }
          totalAmount { amount currencyCode }
        }
        lines(first: 100) {
          nodes {
            id
            quantity
            merchandise {
              ... on ProductVariant { id }
            }
          }
        }
      }
      userErrors { field message }
      warnings { message }
    }
  }
`;

export async function createDestinationCart(input: {
  store: StoreRow;
  lines: CartLineRequest[];
  attributes: Record<string, string>;
  marketingConsent: boolean;
  buyerIp?: string | null;
}): Promise<CartCreateResult> {
  if (input.lines.length === 0) {
    throw new StorefrontApiError("Carrinho vazio.", "EMPTY_CART");
  }
  if (input.lines.length > 100) {
    throw new StorefrontApiError("Muitos itens para uma única transferência.", "TOO_MANY_LINES");
  }

  const attributes = Object.entries(input.attributes)
    .filter(([key, value]) => key.length > 0 && value.length > 0)
    .slice(0, 100)
    .map(([key, value]) => ({ key: key.slice(0, 100), value: value.slice(0, 255) }));

  const data = await storefrontRequest<{
    cartCreate: {
      cart: {
        id: string;
        checkoutUrl: string;
        totalQuantity: number;
        cost: {
          subtotalAmount: { amount: string; currencyCode: string };
          totalAmount: { amount: string; currencyCode: string };
        };
        lines: {
          nodes: Array<{
            id: string;
            quantity: number;
            merchandise: { id: string } | null;
          }>;
        };
      } | null;
      userErrors: Array<{ field: string[] | null; message: string }>;
      warnings: Array<{ message: string }>;
    };
  }>(input.store, {
    query: CART_CREATE_MUTATION,
    variables: {
      input: {
        lines: input.lines.map((line) => ({
          quantity: line.quantity,
          merchandiseId: line.variantId,
          attributes: Object.entries(line.attributes ?? {})
            .filter(([key, value]) => key.length > 0 && value.length > 0)
            .slice(0, 20)
            .map(([key, value]) => ({ key: key.slice(0, 100), value: value.slice(0, 255) })),
        })),
        attributes,
      },
      consent: { marketing: input.marketingConsent },
    },
    buyerIp: input.buyerIp,
  });

  const payload = data.cartCreate;
  if (payload.userErrors.length > 0) {
    throw new StorefrontApiError(
      "A loja de destino recusou o carrinho.",
      "CART_USER_ERRORS",
      payload.userErrors.map((error) => error.message),
    );
  }
  if (!payload.cart) {
    throw new StorefrontApiError("A loja de destino não criou o carrinho.", "CART_NOT_CREATED");
  }

  const expected = new Map(input.lines.map((line) => [line.variantId, line]));
  for (const line of payload.cart.lines.nodes) {
    const merchandiseId = line.merchandise?.id;
    if (!merchandiseId) {
      throw new StorefrontApiError("Item sem variante no carrinho de destino.", "UNEXPECTED_CART_LINE");
    }
    const request = expected.get(merchandiseId);
    if (!request) {
      throw new StorefrontApiError(
        "A loja de destino adicionou um item não solicitado.",
        "UNEXPECTED_CART_LINE",
      );
    }
    if (line.quantity !== request.quantity) {
      throw new StorefrontApiError(
        "A quantidade no carrinho de destino não corresponde à solicitada.",
        "QUANTITY_MISMATCH",
      );
    }
  }

  if (payload.cart.totalQuantity !== input.lines.reduce((total, line) => total + line.quantity, 0)) {
    throw new StorefrontApiError("A quantidade total do carrinho não confere.", "QUANTITY_MISMATCH");
  }

  const expectedSubtotal = input.lines
    .reduce(
      (total, line) => total.add(new Decimal(line.expectedUnitPrice).mul(line.quantity)),
      new Decimal(0),
    )
    .toFixed(6);
  const actualSubtotal = new Decimal(payload.cart.cost.subtotalAmount.amount);
  if (
    payload.cart.cost.subtotalAmount.currencyCode !== payload.cart.cost.totalAmount.currencyCode ||
    actualSubtotal.gt(new Decimal(expectedSubtotal))
  ) {
    throw new StorefrontApiError(
      "O preço dos itens mudou entre a validação e a criação do checkout.",
      "PRICE_CHANGED_DURING_CART_CREATION",
    );
  }

  const checkoutUrl = payload.cart.checkoutUrl;
  assertCheckoutUrl(checkoutUrl, input.store);

  return {
    cartId: payload.cart.id,
    checkoutUrl,
    totalQuantity: payload.cart.totalQuantity,
    subtotalAmount: payload.cart.cost.subtotalAmount.amount,
    currency: payload.cart.cost.totalAmount.currencyCode,
    warnings: payload.warnings.map((warning) => warning.message),
  };
}

export function assertCheckoutUrl(checkoutUrl: string, store: StoreRow): void {
  let url: URL;
  try {
    url = new URL(checkoutUrl);
  } catch {
    throw new StorefrontApiError("URL de checkout inválida.", "INVALID_CHECKOUT_URL");
  }
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new StorefrontApiError("O checkout de destino não usa HTTPS.", "INVALID_CHECKOUT_URL");
  }
  const allowed = new Set(
    [store.shop_domain, store.primary_domain]
      .filter((value): value is string => Boolean(value))
      .map((value) => value.toLowerCase()),
  );
  const host = url.hostname.toLowerCase();
  if (!allowed.has(host) && !host.endsWith(".myshopify.com") && !host.endsWith(".shopify.com")) {
    throw new StorefrontApiError("O checkout aponta para um domínio inesperado.", "INVALID_CHECKOUT_URL");
  }
}

export async function validateStorefrontToken(store: StoreRow): Promise<{ currencyCode: string; shopName: string }> {
  const data = await storefrontRequest<{
    shop: { name: string; currencyCode: string };
  }>(store, {
    query: `#graphql
      query ValidateStorefrontAccess {
        shop { name currencyCode }
      }
    `,
  });
  if (!data.shop) {
    throw new StorefrontApiError("A Storefront API não retornou a loja.", "INVALID_STOREFRONT_TOKEN");
  }
  return { currencyCode: data.shop.currencyCode, shopName: data.shop.name };
}
