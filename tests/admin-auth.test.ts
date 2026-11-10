import crypto from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ hash: null as string | null }));

vi.mock("@/lib/db/admin-settings", () => ({
  getAdminPasswordHash: vi.fn(async () => state.hash),
  saveAdminPasswordHash: vi.fn(async (hash: string) => {
    state.hash = hash;
  }),
}));

function makeHash(password: string): string {
  const salt = crypto.randomBytes(16);
  const n = 16384;
  const r = 8;
  const p = 1;
  const derived = crypto.scryptSync(password, salt, 64, { N: n, r, p, maxmem: 128 * 1024 * 1024 });
  return `scrypt$${n}$${r}$${p}$${salt.toString("base64")}$${derived.toString("base64")}`;
}

beforeEach(() => {
  state.hash = null;
  process.env.ADMIN_PASSWORD = "bootstrap password 123";
});

describe("admin password verification", () => {
  it("uses ADMIN_PASSWORD only while no DB hash exists", async () => {
    const { verifyAdminPassword } = await import("@/lib/auth");
    await expect(verifyAdminPassword("bootstrap password 123")).resolves.toBe(true);
    await expect(verifyAdminPassword("wrong password")).resolves.toBe(false);

    state.hash = makeHash("persisted password 456");
    await expect(verifyAdminPassword("persisted password 456")).resolves.toBe(true);
    await expect(verifyAdminPassword("bootstrap password 123")).resolves.toBe(false);
  });

  it("changes the password only with the current password", async () => {
    const { changeAdminPassword, verifyAdminPassword } = await import("@/lib/auth");
    await expect(changeAdminPassword("bootstrap password 123", "new password 789")).resolves.toBeUndefined();
    await expect(verifyAdminPassword("new password 789")).resolves.toBe(true);
    await expect(verifyAdminPassword("bootstrap password 123")).resolves.toBe(false);
    await expect(changeAdminPassword("errada", "outra senha 1234")).rejects.toThrow(/incorreta/);
  });

  it("rejects short new passwords", async () => {
    const { changeAdminPassword } = await import("@/lib/auth");
    await expect(changeAdminPassword("bootstrap password 123", "curta")).rejects.toThrow(/12/);
  });
});
