import "server-only";

import crypto from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { optionalEnv, requireEnv, isProduction } from "@/lib/env";
import { signPayload, timingSafeEqualStrings, verifySignedPayload } from "@/lib/crypto";
import { getAdminPasswordHash, saveAdminPasswordHash } from "@/lib/db/admin-settings";

export const ADMIN_COOKIE = "csb_admin";
export const OAUTH_COOKIE = "csb_oauth";
const SESSION_TTL_SECONDS = 60 * 60 * 8;

export type AdminSession = {
  sub: "admin";
  iat: number;
  exp: number;
};

type ScryptHash = {
  n: number;
  r: number;
  p: number;
  salt: Buffer;
  digest: Buffer;
};

function parsePasswordHash(value: string): ScryptHash {
  const parts = value.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") {
    throw new Error("Hash de senha administrativa inválido.");
  }
  const n = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (!Number.isInteger(n) || !Number.isInteger(r) || !Number.isInteger(p) || n < 2 || n > 2 ** 20) {
    throw new Error("Parâmetros de scrypt inválidos no hash administrativo.");
  }
  return {
    n,
    r,
    p,
    salt: Buffer.from(parts[4], "base64"),
    digest: Buffer.from(parts[5], "base64"),
  };
}

function scrypt(password: string, salt: Buffer, n: number, r: number, p: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, 64, { N: n, r, p, maxmem: 128 * 1024 * 1024 }, (error, derived) => {
      if (error) reject(error);
      else resolve(derived);
    });
  });
}

async function verifyHash(password: string, hash: string): Promise<boolean> {
  const parsed = parsePasswordHash(hash);
  const derived = await scrypt(password, parsed.salt, parsed.n, parsed.r, parsed.p);
  return crypto.timingSafeEqual(derived, parsed.digest);
}

async function verifyBootstrapPassword(password: string): Promise<boolean> {
  const bootstrap = optionalEnv("ADMIN_PASSWORD");
  if (!bootstrap) return false;
  // Salt fixo apenas para comparação em tempo constante do bootstrap; a senha
  // definitiva é persistida como hash scrypt no banco.
  const salt = Buffer.from("cross-store-bridge-admin-bootstrap", "utf8");
  const [provided, expected] = await Promise.all([
    scrypt(password, salt, 16384, 8, 1),
    scrypt(bootstrap, salt, 16384, 8, 1),
  ]);
  return crypto.timingSafeEqual(provided, expected);
}

export async function verifyAdminPassword(password: string): Promise<boolean> {
  if (!password || password.length > 512) return false;
  const stored = await getAdminPasswordHash().catch(() => null);
  if (stored) return verifyHash(password, stored);
  return verifyBootstrapPassword(password);
}

export async function hasPersistedAdminPassword(): Promise<boolean> {
  return Boolean(await getAdminPasswordHash().catch(() => null));
}

export async function changeAdminPassword(currentPassword: string, newPassword: string): Promise<void> {
  if (newPassword.length < 12) throw new Error("A nova senha deve ter pelo menos 12 caracteres.");
  if (newPassword.length > 512) throw new Error("A nova senha é longa demais.");
  const valid = await verifyAdminPassword(currentPassword);
  if (!valid) throw new Error("Senha atual incorreta.");
  await saveAdminPasswordHash(await hashPassword(newPassword));
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const n = 16384;
  const r = 8;
  const p = 1;
  const derived = await scrypt(password, salt, n, r, p);
  return `scrypt$${n}$${r}$${p}$${salt.toString("base64")}$${derived.toString("base64")}`;
}

export async function createAdminSession(): Promise<void> {
  const token = signPayload({ sub: "admin" }, SESSION_TTL_SECONDS);
  (await cookies()).set(ADMIN_COOKIE, token, {
    httpOnly: true,
    secure: isProduction(),
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
}

export async function clearAdminSession(): Promise<void> {
  (await cookies()).delete(ADMIN_COOKIE);
}

export async function getAdminSession(): Promise<AdminSession | null> {
  const token = (await cookies()).get(ADMIN_COOKIE)?.value;
  if (!token) return null;
  const payload = verifySignedPayload<AdminSession>(token, { maxAgeSeconds: SESSION_TTL_SECONDS });
  if (!payload || payload.sub !== "admin") return null;
  return payload;
}

export async function requireAdmin(): Promise<AdminSession> {
  const session = await getAdminSession();
  if (!session) redirect("/admin/login");
  return session;
}

export async function setOAuthStateCookie(value: string): Promise<void> {
  (await cookies()).set(OAUTH_COOKIE, value, {
    httpOnly: true,
    secure: isProduction(),
    sameSite: "lax",
    path: "/api/auth/shopify",
    maxAge: 10 * 60,
  });
}

export async function readOAuthStateCookie(): Promise<string | null> {
  return (await cookies()).get(OAUTH_COOKIE)?.value ?? null;
}

export async function clearOAuthStateCookie(): Promise<void> {
  (await cookies()).set(OAUTH_COOKIE, "", {
    httpOnly: true,
    secure: isProduction(),
    sameSite: "lax",
    path: "/api/auth/shopify",
    maxAge: 0,
  });
}

export function safeCompare(a: string, b: string): boolean {
  return timingSafeEqualStrings(a, b);
}
