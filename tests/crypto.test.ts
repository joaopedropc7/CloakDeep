import { describe, expect, it } from "vitest";
import {
  decryptSecret,
  encryptSecret,
  sha256Hex,
  signPayload,
  verifySignedPayload,
} from "@/lib/crypto";

describe("secret storage and signed tokens", () => {
  it("encrypts with AES-256-GCM and binds ciphertext to AAD", () => {
    const cipher = encryptSecret("shpat_secret_token", "store:loja.myshopify.com");
    expect(cipher.startsWith("v1.")).toBe(true);
    expect(cipher).not.toContain("shpat_secret_token");
    expect(decryptSecret(cipher, "store:loja.myshopify.com")).toBe("shpat_secret_token");
    expect(() => decryptSecret(cipher, "store:outra.myshopify.com")).toThrow();
  });

  it("rejects tampered ciphertext", () => {
    const cipher = encryptSecret("refresh-token", "store:x");
    const parts = cipher.split(".");
    parts[3] = parts[3].slice(0, -2) + (parts[3].endsWith("AA") ? "BB" : "AA");
    expect(() => decryptSecret(parts.join("."), "store:x")).toThrow();
  });

  it("signs and verifies expiring payloads", () => {
    const token = signPayload({ mappingId: "abc" }, 60);
    expect(verifySignedPayload<{ mappingId: string }>(token)?.mappingId).toBe("abc");
    expect(verifySignedPayload("abc.def")).toBeNull();
    const expired = signPayload({ mappingId: "abc" }, -1);
    expect(verifySignedPayload(expired)).toBeNull();
  });

  it("hashes opaque transfer tokens deterministically", () => {
    expect(sha256Hex("token")).toBe(sha256Hex("token"));
    expect(sha256Hex("token")).not.toBe(sha256Hex("token2"));
    expect(sha256Hex("token")).toHaveLength(64);
  });
});
