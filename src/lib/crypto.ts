import "server-only";

import crypto from "node:crypto";
import { requireEnv } from "@/lib/env";

const KEY_BYTES = 32;
const IV_BYTES = 12;

function encryptionKey(): Buffer {
  const raw = requireEnv("TOKEN_ENCRYPTION_KEY");
  let key: Buffer;
  try {
    key = Buffer.from(raw, "base64");
  } catch {
    throw new Error("TOKEN_ENCRYPTION_KEY deve ser base64.");
  }
  if (key.length !== KEY_BYTES) {
    throw new Error("TOKEN_ENCRYPTION_KEY deve ter exatamente 32 bytes (base64).");
  }
  return key;
}

export function encryptSecret(plaintext: string, aad: string): string {
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  cipher.setAAD(Buffer.from(aad, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", iv.toString("base64url"), tag.toString("base64url"), ciphertext.toString("base64url")].join(".");
}

export function decryptSecret(payload: string, aad: string): string {
  const parts = payload.split(".");
  if (parts.length !== 4 || parts[0] !== "v1") {
    throw new Error("Formato de segredo cifrado inválido.");
  }
  const iv = Buffer.from(parts[1], "base64url");
  const tag = Buffer.from(parts[2], "base64url");
  const ciphertext = Buffer.from(parts[3], "base64url");
  if (iv.length !== IV_BYTES || tag.length !== 16) {
    throw new Error("Segredo cifrado corrompido.");
  }
  const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey(), iv);
  decipher.setAAD(Buffer.from(aad, "utf8"));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

export function sha256(value: string): string {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

export function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString("base64url");
}

function signingSecret(): string {
  return requireEnv("SESSION_SECRET");
}

export type SignedEnvelope = {
  iat: number;
  exp: number;
  [key: string]: unknown;
};

export function signPayload(payload: Record<string, unknown>, ttlSeconds: number): string {
  const now = Math.floor(Date.now() / 1000);
  const body = Buffer.from(
    JSON.stringify({ ...payload, iat: now, exp: now + ttlSeconds }),
    "utf8",
  ).toString("base64url");
  const signature = crypto.createHmac("sha256", signingSecret()).update(body).digest("base64url");
  return `${body}.${signature}`;
}

export function verifySignedPayload<T extends Record<string, unknown>>(
  token: string,
  options: { maxAgeSeconds?: number } = {},
): T | null {
  const [body, signature] = token.split(".");
  if (!body || !signature) return null;
  const expected = crypto.createHmac("sha256", signingSecret()).update(body).digest("base64url");
  if (!timingSafeEqualStrings(signature, expected)) return null;
  let parsed: SignedEnvelope;
  try {
    parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as SignedEnvelope;
  } catch {
    return null;
  }
  const now = Math.floor(Date.now() / 1000);
  if (typeof parsed.exp !== "number" || parsed.exp < now) return null;
  if (options.maxAgeSeconds && typeof parsed.iat === "number" && now - parsed.iat > options.maxAgeSeconds) {
    return null;
  }
  return parsed as unknown as T;
}

export function timingSafeEqualStrings(a: string, b: string): boolean {
  const first = Buffer.from(a, "utf8");
  const second = Buffer.from(b, "utf8");
  if (first.length !== second.length) return false;
  return crypto.timingSafeEqual(first, second);
}

export function sha256Hex(value: string): string {
  return sha256(value);
}
