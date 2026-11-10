import { NextResponse } from "next/server";
import { appUrl } from "@/lib/env";
import { getAdminSession, setOAuthStateCookie } from "@/lib/auth";
import { randomToken, signPayload } from "@/lib/crypto";
import { getStoreById } from "@/lib/db/stores";
import { buildAuthorizeUrl, isValidShopDomain } from "@/lib/shopify/oauth";
import { oauthRedirectUri } from "@/lib/services/oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const admin = await getAdminSession();
  if (!admin) {
    return NextResponse.redirect(new URL("/admin/login", appUrl()), 302);
  }

  const url = new URL(request.url);
  const storeId = (url.searchParams.get("store") ?? "").trim();
  if (!/^[0-9a-f-]{36}$/i.test(storeId)) {
    return NextResponse.redirect(new URL("/admin/stores?error=invalid_store", appUrl()), 302);
  }

  const store = await getStoreById(storeId);
  if (!store || store.platform !== "shopify" || !store.shop_domain) {
    return NextResponse.redirect(new URL("/admin/stores?error=invalid_store", appUrl()), 302);
  }
  if (!store.shopify_client_id || !store.shopify_client_secret_cipher) {
    return NextResponse.redirect(new URL("/admin/stores?error=missing_credentials", appUrl()), 302);
  }
  if (!isValidShopDomain(store.shop_domain)) {
    return NextResponse.redirect(new URL("/admin/stores?error=invalid_shop", appUrl()), 302);
  }

  const nonce = randomToken(24);
  const state = signPayload({ nonce, storeId: store.id, shop: store.shop_domain }, 600);
  await setOAuthStateCookie(state);

  const authorizeUrl = buildAuthorizeUrl({
    shopDomain: store.shop_domain,
    state: nonce,
    apiKey: store.shopify_client_id,
    scopes: store.shopify_scopes,
    redirectUri: oauthRedirectUri(),
  });
  return NextResponse.redirect(authorizeUrl, 302);
}
