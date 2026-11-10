import "server-only";

import { NextResponse } from "next/server";
import { sha256 } from "@/lib/crypto";
import { allowLocalhostStorefront } from "@/lib/env";
import type { StoreRow } from "@/lib/db/types";
import { clientIp, rateLimit } from "@/lib/rate-limit";

export type PublicErrorBody = {
  error: {
    code: string;
    message: string;
    issues?: unknown[];
  };
};

export function jsonPublic(
  body: unknown,
  options: { status?: number; origin: string },
): NextResponse {
  return NextResponse.json(body, {
    status: options.status ?? 200,
    headers: {
      "Access-Control-Allow-Origin": options.origin,
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "600",
      Vary: "Origin",
      "Cache-Control": "no-store",
    },
  });
}

export function errorPublic(
  origin: string,
  status: number,
  code: string,
  message: string,
  issues?: unknown[],
): NextResponse<PublicErrorBody> {
  return NextResponse.json(
    { error: { code, message, ...(issues ? { issues } : {}) } },
    {
      status,
      headers: {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Max-Age": "600",
        Vary: "Origin",
        "Cache-Control": "no-store",
      },
    },
  );
}

export function preflight(origin: string): NextResponse {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "600",
      Vary: "Origin",
    },
  });
}


export function checkoutCorsHeaders(origin: string | null): HeadersInit {
  const headers: Record<string, string> = {
    Vary: "Origin",
    "Cache-Control": "no-store",
  };
  if (origin) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Methods"] = "POST, OPTIONS";
    headers["Access-Control-Allow-Headers"] = "Content-Type";
    headers["Access-Control-Max-Age"] = "600";
  }
  return headers;
}

export function allowedStoreOrigins(store: StoreRow): Set<string> {
  const origins = new Set<string>();
  for (const value of [store.shop_domain, store.primary_domain]) {
    if (!value) continue;
    origins.add(`https://${value.replace(/^https?:\/\//, "").replace(/\/$/, "")}`);
  }
  if (allowLocalhostStorefront()) {
    origins.add("http://localhost:3000");
    origins.add("http://127.0.0.1:3000");
  }
  return origins;
}

export function storefrontOrigin(request: Request, store: StoreRow): string | null {
  const origin = request.headers.get("origin");
  if (!origin) return null;
  return allowedStoreOrigins(store).has(origin) ? origin : null;
}

export function isRateLimited(request: Request, key: string, limit: number, windowMs: number): boolean {
  const ipHash = sha256(clientIp(request)).slice(0, 24);
  return !rateLimit(`public:${key}:${ipHash}`, limit, windowMs).allowed;
}

export async function readJsonBody(
  request: Request,
  maxBytes = 32_768,
): Promise<unknown> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    throw new HttpError(415, "UNSUPPORTED_MEDIA_TYPE", "Envie JSON.");
  }
  const text = await request.text();
  if (text.length > maxBytes) {
    throw new HttpError(413, "BODY_TOO_LARGE", "Corpo da requisição grande demais.");
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, "INVALID_JSON", "JSON inválido.");
  }
}

export class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
  }
}

export function formValue(formData: FormData, key: string, maxLength = 500): string {
  const value = formData.get(key);
  if (typeof value !== "string") return "";
  return value.trim().slice(0, maxLength);
}

export function methodNotAllowed(): NextResponse {
  return NextResponse.json(
    { error: { code: "METHOD_NOT_ALLOWED", message: "Método não permitido." } },
    { status: 405, headers: { Allow: "GET, POST, OPTIONS" } },
  );
}
