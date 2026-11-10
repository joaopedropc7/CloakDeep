import { NextResponse } from "next/server";
import { appUrl } from "@/lib/env";
import { isRateLimited, methodNotAllowed, preflight, readJsonBody, HttpError } from "@/lib/http";
import {
  getPublicOriginContext,
  isResponse,
  publicError,
  publicJson,
} from "@/lib/services/public-context";
import { marketingConsentFrom } from "@/lib/domain/attribution";
import { prepareTransfer, TransferError } from "@/lib/services/transfers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function OPTIONS(request: Request) {
  const context = await getPublicOriginContext(request);
  if (isResponse(context)) return context;
  return preflight(context.origin);
}

export async function POST(request: Request) {
  const context = await getPublicOriginContext(request);
  if (isResponse(context)) return context;
  if (isRateLimited(request, "prepare-transfer", 12, 60_000)) {
    return publicError(context, 429, "RATE_LIMITED", "Muitas tentativas. Aguarde um pouco.");
  }

  try {
    const body = await readJsonBody(request, 32_768);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return publicError(context, 400, "INVALID_BODY", "Requisição inválida.");
    }
    const payload = body as Record<string, unknown>;
    const result = await prepareTransfer({
      shopDomain: context.shopDomain,
      items: payload.items,
      attribution: payload.attribution,
      marketingConsent: marketingConsentFrom(payload.consent),
    });
    return publicJson(context, 200, {
      transferToken: result.token,
      transferUrl: `${appUrl()}/transfer/${result.token}`,
      expiresAt: result.expiresAt,
      lineCount: result.lineCount,
      subtotal: result.subtotal,
      currency: result.currency,
    });
  } catch (error) {
    if (error instanceof TransferError) {
      return publicError(context, error.httpStatus, error.code, error.message, error.issues);
    }
    if (error instanceof HttpError) {
      return publicError(context, error.status, error.code, error.message);
    }
    console.error("[public/transfers] unexpected error", error);
    return publicError(
      context,
      500,
      "INTERNAL_ERROR",
      "Não foi possível preparar a transferência agora.",
    );
  }
}

export function GET() {
  return methodNotAllowed();
}

export function PUT() {
  return NextResponse.json({ error: { code: "METHOD_NOT_ALLOWED" } }, { status: 405 });
}
