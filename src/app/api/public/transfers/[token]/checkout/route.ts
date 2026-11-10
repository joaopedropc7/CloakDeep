import { NextResponse } from "next/server";
import { appUrl } from "@/lib/env";
import { formValue, isRateLimited, readJsonBody } from "@/lib/http";
import { completeTransferForBuyer, TransferError } from "@/lib/services/transfers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function redirectTo(path: string): NextResponse {
  return NextResponse.redirect(new URL(path, appUrl()), 303);
}

function sameOriginOnly(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).origin === new URL(appUrl()).origin;
  } catch {
    return false;
  }
}

function wantsJson(request: Request): boolean {
  return (request.headers.get("accept") || "").toLowerCase().includes("application/json");
}

export async function POST(
  request: Request,
  context: { params: Promise<{ token: string }> },
) {
  const { token } = await context.params;
  const json = wantsJson(request);
  if (!/^[A-Za-z0-9_-]{20,200}$/.test(token)) {
    return json
      ? NextResponse.json(
          { error: { code: "INVALID_TOKEN", message: "Token inválido." } },
          { status: 400, headers: { "Cache-Control": "no-store" } },
        )
      : redirectTo("/transfer/invalid");
  }
  if (!sameOriginOnly(request)) {
    return new NextResponse("Origem não autorizada.", { status: 403 });
  }
  if (isRateLimited(request, `checkout:${token.slice(0, 16)}`, 8, 60_000)) {
    return json
      ? NextResponse.json(
          { error: { code: "RATE_LIMITED", message: "Muitas tentativas. Aguarde." } },
          { status: 429, headers: { "Cache-Control": "no-store" } },
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
  } catch (error) {
    return json
      ? NextResponse.json(
          { error: { code: "INVALID_BODY", message: "Requisição inválida." } },
          { status: 400, headers: { "Cache-Control": "no-store" } },
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
      return NextResponse.json(
        { checkoutUrl: result.checkoutUrl },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    const response = NextResponse.redirect(result.checkoutUrl, 303);
    response.headers.set("Cache-Control", "no-store");
    response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
    return response;
  } catch (error) {
    if (error instanceof TransferError) {
      return json
        ? NextResponse.json(
            {
              error: {
                code: error.code,
                message: error.message,
                issues: error.issues,
              },
            },
            { status: error.httpStatus, headers: { "Cache-Control": "no-store" } },
          )
        : redirectTo(`/transfer/${token}?error=${encodeURIComponent(error.code)}`);
    }
    console.error("[public/checkout] unexpected error", error);
    return json
      ? NextResponse.json(
          { error: { code: "CHECKOUT_FAILED", message: "Não foi possível criar o checkout." } },
          { status: 502, headers: { "Cache-Control": "no-store" } },
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
