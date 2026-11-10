import { NextResponse } from "next/server";
import { requireEnv } from "@/lib/env";
import { getNextStoreForSync, markStoreSyncAttempt } from "@/lib/db/stores";
import { syncCatalog } from "@/lib/services/catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function authorized(request: Request): boolean {
  const expected = requireEnv("CRON_SECRET");
  const header = request.headers.get("authorization") ?? "";
  if (header === `Bearer ${expected}`) return true;
  // A Vercel Cron invoca a rota com este header. O fallback só é aceito no
  // ambiente da Vercel; para qualquer scheduler externo use o Bearer token.
  return process.env.VERCEL === "1" && request.headers.get("x-vercel-cron") === "1";
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const store = await getNextStoreForSync();
  if (!store) return NextResponse.json({ ok: true, status: "idle" });
  await markStoreSyncAttempt(store.id);

  try {
    const result = await syncCatalog(store.id);
    return NextResponse.json({
      ok: true,
      status: "synced",
      storeId: store.id,
      storeName: store.name,
      products: result.products,
      variants: result.variants,
      mappingsFlagged: result.mappingsFlagged,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        status: "failed",
        storeId: store.id,
        storeName: store.name,
        error: error instanceof Error ? error.message : "unknown",
      },
      { status: 500 },
    );
  }
}
