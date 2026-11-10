export const ALLOWED_ATTRIBUTION_KEYS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
  "utm_id",
  "campaign_id",
  "adset_id",
  "ad_id",
  "gclid",
  "dclid",
  "wbraid",
  "gbraid",
  "fbclid",
  "msclkid",
  "ttclid",
  "twclid",
  "li_fat_id",
] as const;

export type AttributionKey = (typeof ALLOWED_ATTRIBUTION_KEYS)[number];
export type Attribution = Partial<Record<AttributionKey, string>>;

const allowed = new Set<string>(ALLOWED_ATTRIBUTION_KEYS);

/**
 * UTMs/click IDs only. PII-looking values and credentials are rejected rather
 * than forwarded to another controller.
 */
const SENSITIVE_VALUE_PATTERNS: RegExp[] = [
  /@/,
  /%40/i,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+/,
  /\b(shpat_|shpca_|shprt_|shpss_|shpua_)/i,
  /\b(bearer|authorization|password|senha|secret|api[_-]?key|cookie)\b/i,
  /\b(password|passwd|senha|token|secret|email|e-mail|telefone|phone|cpf|cnpj|cartao|cartão|card_number)\s*[:=]/i,
  /(^|\D)\d{13,19}(\D|$)/,
];

function cleanValue(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 200) return null;
  if (/[\u0000-\u001f\u007f]/.test(trimmed)) return null;
  if (SENSITIVE_VALUE_PATTERNS.some((pattern) => pattern.test(trimmed))) return null;
  return trimmed;
}

export function sanitizeAttribution(input: unknown): Attribution {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  const result: Attribution = {};
  let count = 0;
  for (const [rawKey, rawValue] of Object.entries(input as Record<string, unknown>)) {
    if (count >= 20) break;
    const key = rawKey.trim().toLowerCase();
    if (!allowed.has(key)) continue;
    const value = cleanValue(rawValue);
    if (!value) continue;
    result[key as AttributionKey] = value;
    count += 1;
  }
  return result;
}

export function extractAttributionFromQuery(query: string): Attribution {
  const params = new URLSearchParams(query.startsWith("?") ? query.slice(1) : query);
  const record: Record<string, string> = {};
  for (const [key, value] of params.entries()) {
    record[key] = value;
  }
  return sanitizeAttribution(record);
}

export function appendAttributionToUrl(url: string, attribution: Attribution): string {
  const parsed = new URL(url);
  for (const [key, value] of Object.entries(attribution)) {
    if (!value || !allowed.has(key)) continue;
    parsed.searchParams.set(key, value);
  }
  return parsed.toString();
}

export function hasAttribution(attribution: Attribution): boolean {
  return Object.keys(attribution).length > 0;
}

export function marketingConsentFrom(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  return (value as { marketing?: unknown }).marketing === true;
}
