import type { StoreRow, TransferLine } from "@/lib/db/types";

/**
 * Cart permalinks are an official Shopify mechanism for sending a buyer to a
 * populated checkout without calling the Storefront API. Each request creates
 * a fresh checkout on the destination store.
 */
export function buildCartPermalink(store: StoreRow, lines: TransferLine[]): string {
  if (store.platform !== "shopify") throw new Error("Cart permalink exige uma loja Shopify.");
  const host = store.primary_domain ?? store.shop_domain;
  if (!host) throw new Error("A loja de destino não tem domínio.");
  const items = lines.map((line) => {
    const match = /^gid:\/\/shopify\/ProductVariant\/(\d+)$/.exec(line.bVariantExternalId ?? "");
    if (!match) throw new Error("Variante de destino inválida para o cart permalink.");
    return `${match[1]}:${line.quantity}`;
  });
  if (items.length === 0) throw new Error("Carrinho vazio.");
  return `https://${host}/cart/${items.join(",")}`;
}
