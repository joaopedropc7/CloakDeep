import "server-only";

import { getDb } from "@/lib/supabase";

export type AuditEventType =
  | "store_connected"
  | "store_disconnected"
  | "catalog_imported"
  | "mapping_activated"
  | "mapping_needs_review"
  | "transfer_prepared"
  | "checkout_created"
  | "checkout_failed"
  | "admin_password_changed"
  | "mapping_draft_created"
  | "theme_installed"
  | "theme_install_failed"
  | "external_link_followed"
  | "compliance_request";

export async function recordAudit(input: {
  storeId?: string | null;
  eventType: AuditEventType;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  try {
    const { error } = await getDb()
      .from("audit_events")
      .insert({
        store_id: input.storeId ?? null,
        event_type: input.eventType,
        metadata: input.metadata ?? {},
      });
    if (error) {
      console.error("[audit] failed to persist event", input.eventType, error.message);
    }
  } catch (error) {
    // Auditing must never break a buyer-facing flow.
    console.error("[audit] unexpected error", input.eventType, error);
  }
}
