import "server-only";

import { RUNTIME_ENV } from "@/lib/env.generated";

/**
 * Environment access is lazy so that `next build` can type-check and compile
 * without production secrets. Every accessor fails closed when used.
 */

let cached: Record<string, string> | null = null;

function readEnv(): Record<string, string> {
  if (cached) return cached;
  // .env versionado -> módulo gerado no build. Variáveis do processo (por
  // exemplo, testes) têm precedência.
  cached = { ...RUNTIME_ENV, ...(process.env as Record<string, string>) };
  return cached;
}

export function optionalEnv(name: string): string | undefined {
  const value = readEnv()[name];
  return value && value.trim().length > 0 ? value.trim() : undefined;
}

export function requireEnv(name: string): string {
  const value = optionalEnv(name);
  if (!value) {
    throw new Error(`Variável de ambiente obrigatória ausente: ${name}`);
  }
  return value;
}

export function appUrl(): string {
  const configured = optionalEnv("APP_URL");
  const raw = configured ?? (process.env.VERCEL ? "" : `http://localhost:${process.env.PORT ?? "3000"}`);
  if (!raw) {
    throw new Error("APP_URL é obrigatório na Vercel.");
  }
  const url = new URL(raw);
  if (url.protocol !== "https:" && url.hostname !== "localhost" && url.hostname !== "127.0.0.1") {
    throw new Error("APP_URL deve usar HTTPS fora de localhost.");
  }
  return url.origin;
}

export function shopifyApiVersion(): string {
  return optionalEnv("SHOPIFY_API_VERSION") ?? "2026-10";
}

export function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

export function allowLocalhostStorefront(): boolean {
  return optionalEnv("ALLOW_LOCALHOST_STOREFRONT") === "true" && !isProduction();
}

