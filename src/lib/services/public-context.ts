import { NextResponse } from "next/server";
import { getShopifyStoreByDomain } from "@/lib/db/stores";
import type { StoreRow } from "@/lib/db/types";
import { jsonPublic, errorPublic, storefrontOrigin } from "@/lib/http";

export type PublicOriginContext = {
  store: StoreRow;
  origin: string;
  shopDomain: string;
};

export async function getPublicOriginContext(
  request: Request,
): Promise<PublicOriginContext | NextResponse> {
  const url = new URL(request.url);
  const shopDomain = (url.searchParams.get("shop") ?? "").trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shopDomain)) {
    return NextResponse.json(
      { error: { code: "INVALID_SHOP", message: "Loja não informada." } },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
  const store = await getShopifyStoreByDomain(shopDomain);
  if (!store || store.role !== "a" || store.status !== "active") {
    return NextResponse.json(
      { error: { code: "UNKNOWN_STORE", message: "Loja não habilitada." } },
      { status: 403, headers: { "Cache-Control": "no-store" } },
    );
  }
  const origin = storefrontOrigin(request, store);
  if (!origin) {
    return NextResponse.json(
      { error: { code: "ORIGIN_NOT_ALLOWED", message: "Origem não autorizada." } },
      { status: 403, headers: { "Cache-Control": "no-store" } },
    );
  }
  return { store, origin, shopDomain };
}

export function isResponse(value: unknown): value is NextResponse {
  return value instanceof NextResponse;
}

export function publicError(
  context: PublicOriginContext,
  status: number,
  code: string,
  message: string,
  issues?: unknown[],
): NextResponse {
  return errorPublic(context.origin, status, code, message, issues);
}

export function publicJson(context: PublicOriginContext, status: number, body: unknown): NextResponse {
  return jsonPublic(body, { status, origin: context.origin });
}
