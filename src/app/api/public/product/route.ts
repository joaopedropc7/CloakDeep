import { getPublicOriginContext, isResponse, publicError, publicJson } from "@/lib/services/public-context";
import { isRateLimited, methodNotAllowed, preflight } from "@/lib/http";
import { resolveProductMapping } from "@/lib/services/transfers";

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
  if (isRateLimited(request, "public-product", 120, 60_000)) {
    return publicError(context, 429, "RATE_LIMITED", "Muitas requisições. Tente novamente.");
  }
  const url = new URL(request.url);
  const variantId = (url.searchParams.get("variant") ?? "").trim();
  if (!/^gid:\/\/shopify\/ProductVariant\/\d+$/.test(variantId)) {
    return publicError(context, 400, "INVALID_VARIANT", "Variante inválida.");
  }
  const mapping = await resolveProductMapping({
    shopDomain: context.shopDomain,
    variantId,
  });
  return publicJson(context, 200, mapping);
}

export function POST() {
  return methodNotAllowed();
}
