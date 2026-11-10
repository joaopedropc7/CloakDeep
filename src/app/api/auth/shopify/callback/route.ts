import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { appUrl, isProduction } from "@/lib/env";
import {
  clearOAuthStateCookie,
  getAdminSession,
  readOAuthStateCookie,
} from "@/lib/auth";
import { verifySignedPayload } from "@/lib/crypto";
import { INTEGRATION_COOKIE, getPairForStore, getStoreById } from "@/lib/db/stores";
import {
  assertRecentOAuthTimestamp,
  isValidShopDomain,
  normalizeShopDomain,
  verifyOAuthHmac,
} from "@/lib/shopify/oauth";
import { connectShopifyStore } from "@/lib/services/oauth";
import { decryptStoreClientSecret } from "@/lib/shopify/credentials";
import { installThemeIntegration } from "@/lib/services/theme-install";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type OAuthState = {
  nonce: string;
  storeId: string;
  shop: string;
};

function fail(code: string): NextResponse {
  return NextResponse.redirect(new URL(`/admin/stores?error=${encodeURIComponent(code)}`, appUrl()), 303);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const params = url.searchParams;
  try {
    const admin = await getAdminSession();
    if (!admin) return NextResponse.redirect(new URL("/admin/login", appUrl()), 303);

    const cookie = await readOAuthStateCookie();
    if (!cookie) return fail("missing_state");
    const state = verifySignedPayload<OAuthState & Record<string, unknown>>(cookie, {
      maxAgeSeconds: 600,
    });
    if (!state) return fail("invalid_state");
    if (params.get("state") !== state.nonce) return fail("state_mismatch");

    const shop = normalizeShopDomain(params.get("shop") ?? "");
    if (!isValidShopDomain(shop) || shop !== state.shop) return fail("shop_mismatch");

    const store = await getStoreById(state.storeId);
    if (!store || store.platform !== "shopify" || store.shop_domain !== shop) {
      return fail("store_mismatch");
    }
    if (!store.shopify_client_id || !store.shopify_client_secret_cipher) {
      return fail("missing_credentials");
    }
    const hmacValid = verifyOAuthHmac(params, decryptStoreClientSecret(store));
    if (!hmacValid) return fail("invalid_hmac");
    if (!assertRecentOAuthTimestamp(params.get("timestamp"))) return fail("stale_callback");

    const code = params.get("code");
    if (!code) return fail("missing_code");

    const connected = await connectShopifyStore({ storeId: store.id, code });
    const pair = await getPairForStore(connected.id);
    const cookieStore = await cookies();
    if (pair && !cookieStore.get(INTEGRATION_COOKIE)?.value) cookieStore.set(INTEGRATION_COOKIE, pair.id, {
      httpOnly: true,
      secure: isProduction(),
      sameSite: "lax",
      path: "/admin",
      maxAge: 60 * 60 * 24 * 30,
    });
    if (connected.store_type === "storefront") {
      try {
        await installThemeIntegration(connected);
      } catch (error) {
        // The theme status is recorded for the admin; OAuth itself remains valid.
        console.error(
          "[oauth callback] theme install failed",
          error instanceof Error ? error.message : "unknown",
        );
      }
    }
    await clearOAuthStateCookie();
    return NextResponse.redirect(
      new URL(`/admin/stores?connected=${connected.role}`, appUrl()),
      303,
    );
  } catch (error) {
    await clearOAuthStateCookie().catch(() => undefined);
    console.error("[oauth callback] failed", error instanceof Error ? error.message : "unknown");
    return fail("oauth_failed");
  }
}
