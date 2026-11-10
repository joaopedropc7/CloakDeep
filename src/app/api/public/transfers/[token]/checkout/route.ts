import { NextResponse } from "next/server";
import { appUrl } from "@/lib/env";
import { sha256Hex } from "@/lib/crypto";
import {
  checkoutCorsHeaders,
  formValue,
  isRateLimited,
  readJsonBody,
} from "@/lib/http";
import { getStoreById } from "@/lib/db/stores";
import { getTransferByTokenHash } from "@/lib/db/transfers";
import { completeTransferForBuyer, TransferError } from "@/lib/services/transfers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function redirectTo(path: string): NextResponse {
  return NextResponse.redirect(new URL(path, appUrl()), 303);
}

function jsonWithCors(body: unknown, status: number, origin: string | null): NextResponse {
  return NextResponse.json(body, { status, headers: checkoutCorsHeaders(origin) });
}

function wantsJson(request: Request): boolean {
  return (request.headers.get("accept") || "").toLowerCase().includes("application/json");
}

async function resolveOrigin(
  request: Request,
  token: string,
): Promise<{ allowed: boolean; origin: string | null }> {
  const origin = request.headers.get("origin");
  if (!origin) return { allowed: true, origin: null };
  try {
    if (new URL(origin).origin === new URL(appUrl()).origin) {
      return { allowed: true, origin };
    }
  } catch {
    return { allowed: false, origin: null };
  }

  const transfer = await getTransferByTokenHash(sha256Hex(token));
  if (!transfer) return { allowed: false, origin: null };
  const storeA = await getStoreById(transfer.store_a_id);
  if (!storeA) return { allowed: false, origin: null };

  const allowed = new Set<string>();
  for (const value of [storeA.shop_domain, storeA.primary_domain]) {
    if (!value) continue;
    allowed.add(`https://${value.replace(/^https?:\/\//, "").replace(/\/$/, "")}`);
  }
  return allowed.has(origin) ? { allowed: true, origin } : { allowed: false, origin: null };
}

export async function OPTIONS(
  request: Request,
  context: { params: Promise<{ token: string }> },
) {
  const { token } = await context.params;
  if (!/^[A-Za-z0-9_-]{20,200}$/.test(token)) {
    return new NextResponse(null, { status: 403, headers: checkoutCorsHeaders(null) });
  }
  const auth = await resolveOrigin(request, token);
  if (!auth.allowed) {
    return new NextResponse(null, { status: 403, headers: checkoutCorsHeaders(null) });
  }
  return new NextResponse(null, {
    status: 204,
    headers: checkoutCorsHeaders(auth.origin),
  });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ token: string }> },
) {
  const { token } = await context.params;
  const json = wantsJson(request);

  if (!/^[A-Za-z0-9_-]{20,200}$/.test(token)) {
    const requestOrigin = request.headers.get("origin");
    let safeOrigin: string | null = null;
    try {
      if (requestOrigin && new URL(requestOrigin).origin === new URL(appUrl()).origin) {
        safeOrigin = requestOrigin;
      }
    } catch {
      safeOrigin = null;
    }
    return json
      ? jsonWithCors(
          { error: { code: "INVALID_TOKEN", message: "Token inválido." } },
          400,
          safeOrigin,
        )
      : redirectTo("/transfer/invalid");
  }

  const auth = await resolveOrigin(request, token);
  if (!auth.allowed) {
    return jsonWithCors(
      { error: { code: "ORIGIN_NOT_ALLOWED", message: "Origem não autorizada." } },
      403,
      auth.origin,
    );
  }

  if (isRateLimited(request, `checkout:${token.slice(0, 16)}`, 8, 60_000)) {
    return json
      ? jsonWithCors(
          { error: { code: "RATE_LIMITED", message: "Muitas tentativas. Aguarde." } },
          429,
          auth.origin,
        )
      : redirectTo(`/transfer/${token}?error=RATE_LIMITED`);
  }

  let attributionConsent = false;
  try {
    if (json) {
      const body = await readJsonBody(request, 4096);
      attributionConsent =
        Boolean(body) &&
        typeof body === "object" &&
        (body as { attribution_consent?: unknown }).attribution_consent === true;
    } else {
      const formData = await request.formData();
      attributionConsent = formValue(formData, "attribution_consent") === "on";
    }
  } catch {
    return json
      ? jsonWithCors(
          { error: { code: "INVALID_BODY", message: "Requisição inválida." } },
          400,
          auth.origin,
        )
      : redirectTo(`/transfer/${token}?error=INVALID_BODY`);
  }

  try {
    const result = await completeTransferForBuyer({
      token,
      attributionConsent,
      buyerIp: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    });
    if (json) {
      return jsonWithCors({ checkoutUrl: result.checkoutUrl }, 200, auth.origin);
    }
    const response = NextResponse.redirect(result.checkoutUrl, 303);
    response.headers.set("Cache-Control", "no-store");
    response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
    return response;
  } catch (error) {
    if (error instanceof TransferError) {
      return json
        ? jsonWithCors(
            {
              error: {
                code: error.code,
                message: error.message,
                issues: error.issues,
              },
            },
            error.httpStatus,
            auth.origin,
          )
        : redirectTo(`/transfer/${token}?error=${encodeURIComponent(error.code)}`);
    }
    console.error("[public/checkout] unexpected error", error);
    return json
      ? jsonWithCors(
          { error: { code: "CHECKOUT_FAILED", message: "Não foi possível criar o checkout." } },
          502,
          auth.origin,
        )
      : redirectTo(`/transfer/${token}?error=CHECKOUT_FAILED`);
  }
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ token: string }> },
) {
  const { token } = await context.params;
  return redirectTo(`/transfer/${token}`);
}
