import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { recordAudit } from "@/lib/db/audit";
import {
  deleteStoreDataByShopDomain,
  disconnectStore,
  getShopifyStoreByDomain,
} from "@/lib/db/stores";
import { isValidShopDomain, normalizeShopDomain } from "@/lib/shopify/oauth";
import { decryptStoreClientSecret } from "@/lib/shopify/credentials";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function verifyWebhook(body: string, hmacHeader: string | null, secret: string): boolean {
  if (!hmacHeader) return false;
  const digest = crypto
    .createHmac("sha256", secret)
    .update(body, "utf8")
    .digest("base64");
  const first = Buffer.from(digest, "utf8");
  const second = Buffer.from(hmacHeader, "utf8");
  return first.length === second.length && crypto.timingSafeEqual(first, second);
}

export async function POST(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    return NextResponse.json({ error: "unsupported_media_type" }, { status: 415 });
  }
  const body = await request.text();
  if (body.length > 1_000_000) {
    return NextResponse.json({ error: "payload_too_large" }, { status: 413 });
  }
  const topic = request.headers.get("x-shopify-topic") ?? "";
  const shopDomain = normalizeShopDomain(request.headers.get("x-shopify-shop-domain") ?? "");
  if (!isValidShopDomain(shopDomain)) {
    return NextResponse.json({ error: "invalid_shop" }, { status: 400 });
  }

  const store = await getShopifyStoreByDomain(shopDomain);
  if (!store || !store.shopify_client_secret_cipher) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!verifyWebhook(body, request.headers.get("x-shopify-hmac-sha256"), decryptStoreClientSecret(store))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  switch (topic) {
    case "customers/data_request":
    case "customers/redact":
      // This integration does not store customer identity, orders or payment
      // data. There is nothing to export or redact.
      await recordAudit({
        storeId: store?.id ?? null,
        eventType: "compliance_request",
        metadata: { topic },
      });
      break;
    case "shop/redact":
      await deleteStoreDataByShopDomain(shopDomain);
      break;
    case "app/uninstalled":
      if (store) await disconnectStore(store.id);
      break;
    default:
      break;
  }

  return NextResponse.json({ ok: true });
}
