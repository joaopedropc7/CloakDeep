process.env.TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
process.env.SESSION_SECRET = "test-session-secret-with-at-least-32-characters";
process.env.SHOPIFY_API_VERSION = "2026-10";
process.env.SHOPIFY_SCOPES = "read_products,write_themes";
process.env.APP_URL = "https://app.test";
process.env.ALLOW_LOCALHOST_STOREFRONT = "false";
