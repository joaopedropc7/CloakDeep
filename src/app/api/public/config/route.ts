import { NextResponse } from "next/server";
import { getPublicOriginContext, isResponse, publicError, publicJson } from "@/lib/services/public-context";
import { preflight, methodNotAllowed, isRateLimited } from "@/lib/http";
import { publicStorefrontConfig } from "@/lib/services/transfers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function OPTIONS(request: Request) {
  const context = await getPublicOriginContext(request);
  if (isResponse(context)) return context;
  return preflight(context.origin);
}

export async function GET(request: Request) {
  const context = await getPublicOriginContext(request);
  if (isResponse(context)) return context;
  if (isRateLimited(request, "public-config", 120, 60_000)) {
    return publicError(context, 429, "RATE_LIMITED", "Muitas requisições. Tente novamente.");
  }
  const config = await publicStorefrontConfig(context.shopDomain);
  return publicJson(context, 200, config);
}

export function POST() {
  return methodNotAllowed();
}

export function PUT() {
  return NextResponse.json({ error: { code: "METHOD_NOT_ALLOWED" } }, { status: 405 });
}
