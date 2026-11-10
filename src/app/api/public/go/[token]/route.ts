import { NextResponse } from "next/server";
import { appUrl } from "@/lib/env";
import { recordAudit } from "@/lib/db/audit";
import { appendAttributionToUrl, sanitizeAttribution } from "@/lib/domain/attribution";
import { formValue, isRateLimited } from "@/lib/http";
import { resolveExternalLinkToken } from "@/lib/services/transfers";
import { destinationLabel } from "@/lib/domain/mapping-rules";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function redirectTo(url: string): NextResponse {
  const response = NextResponse.redirect(url, 303);
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  return response;
}

export async function POST(
  request: Request,
  context: { params: Promise<{ token: string }> },
) {
  const { token } = await context.params;
  if (!/^[A-Za-z0-9_-]{20,500}$/.test(token)) {
    return redirectTo(new URL("/go/invalid", appUrl()).toString());
  }
  const origin = request.headers.get("origin");
  if (origin) {
    try {
      if (new URL(origin).origin !== new URL(appUrl()).origin) {
        return new NextResponse("Origem não autorizada.", { status: 403 });
      }
    } catch {
      return new NextResponse("Origem inválida.", { status: 403 });
    }
  }
  if (isRateLimited(request, "external-go", 30, 60_000)) {
    return redirectTo(new URL(`/go/${token}?error=RATE_LIMITED`, appUrl()).toString());
  }

  const resolution = await resolveExternalLinkToken(token);
  if (!resolution) {
    return redirectTo(new URL(`/go/${token}?error=UNAVAILABLE`, appUrl()).toString());
  }

  const formData = await request.formData();
  const consent = formValue(formData, "attribution_consent") === "on";
  const raw: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value === "string") raw[key] = value;
  }
  const attribution = consent ? sanitizeAttribution(raw) : {};
  const target = consent ? appendAttributionToUrl(resolution.targetUrl, attribution) : resolution.targetUrl;

  await recordAudit({
    storeId: resolution.storeB.id,
    eventType: "external_link_followed",
    metadata: {
      mappingId: resolution.mapping.id,
      destination: destinationLabel(resolution.storeB),
      attributionShared: consent && Object.keys(attribution).length > 0,
    },
  });

  return redirectTo(target);
}
