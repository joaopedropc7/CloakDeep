#!/usr/bin/env node
import crypto from "node:crypto";

const password = process.env.ADMIN_PASSWORD ?? process.argv[2];
if (!password) {
  console.error("Uso: ADMIN_PASSWORD='sua-senha-forte' npm run admin:hash");
  console.error("A senha não deve ser passada como argumento em ambientes compartilhados.");
  process.exit(1);
}
if (password.length < 12) {
  console.error("Use pelo menos 12 caracteres.");
  process.exit(1);
}

const salt = crypto.randomBytes(16);
const n = 16384;
const r = 8;
const p = 1;
const derived = crypto.scryptSync(password, salt, 64, { N: n, r, p, maxmem: 128 * 1024 * 1024 });
console.log(`scrypt$${n}$${r}$${p}$${salt.toString("base64")}$${derived.toString("base64")}`);
