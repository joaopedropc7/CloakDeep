#!/usr/bin/env node
import crypto from "node:crypto";

function base64Key() {
  return crypto.randomBytes(32).toString("base64");
}

function sessionSecret() {
  return crypto.randomBytes(48).toString("base64url");
}

console.log("Cole no .env versionado:");
console.log("");
console.log(`TOKEN_ENCRYPTION_KEY=${base64Key()}`);
console.log(`SESSION_SECRET=${sessionSecret()}`);
console.log("");
console.log("Defina também ADMIN_PASSWORD com uma senha inicial de pelo menos 12 caracteres.");
console.log("Depois do primeiro login, troque a senha em /admin/settings; o hash scrypt será");
console.log("armazenado no Supabase e o ADMIN_PASSWORD do .env deixará de ser usado.");
