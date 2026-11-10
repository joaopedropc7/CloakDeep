import type { MappingRow, ProductRow, StoreRow, VariantRow } from "@/lib/db/types";

function numericString(value: unknown): string {
  if (value === null || value === undefined) return "0";
  return String(value);
}

export function normalizeStore(row: unknown): StoreRow {
  const store = row as StoreRow;
  return {
    ...store,
    scopes: Array.isArray(store.scopes) ? store.scopes : [],
  };
}

export function normalizeProduct(row: unknown): ProductRow {
  return row as ProductRow;
}

export function normalizeVariant(row: unknown): VariantRow {
  const variant = row as VariantRow;
  return {
    ...variant,
    price_amount: numericString(variant.price_amount),
    option_values: Array.isArray(variant.option_values) ? variant.option_values : [],
  };
}

export function normalizeMapping(row: unknown): MappingRow {
  const mapping = row as MappingRow;
  return {
    ...mapping,
    price_a: numericString(mapping.price_a),
    price_b: numericString(mapping.price_b),
    price_diff: numericString(mapping.price_diff),
    price_diff_percent: numericString(mapping.price_diff_percent),
  };
}

export function normalizeNestedProduct(row: unknown): Pick<ProductRow, "id" | "title" | "handle" | "external_id"> {
  const product = row as Pick<ProductRow, "id" | "title" | "handle" | "external_id">;
  return {
    id: product.id,
    title: product.title,
    handle: product.handle ?? null,
    external_id: product.external_id,
  };
}
