import "server-only";

import { getDb } from "@/lib/supabase";
import { getStoresForIntegration } from "@/lib/db/stores";
import type { TransferLine, TransferRow, TransferStatus } from "@/lib/db/types";

export type CreateTransferInput = {
  token_hash: string;
  store_a_id: string;
  store_b_id: string;
  lines: TransferLine[];
  currency: string;
  subtotal: string;
  attribution: Record<string, string>;
  attribution_consent: boolean;
  visitor_consent: Record<string, boolean | null>;
  expires_at: string;
};

export async function createTransferSession(input: CreateTransferInput): Promise<TransferRow> {
  const { data, error } = await getDb()
    .from("transfer_sessions")
    .insert({ ...input, status: "pending" })
    .select("*")
    .single();
  if (error) throw new Error(`Falha ao criar sessão de transferência: ${error.message}`);
  return data as TransferRow;
}

export async function getTransferByTokenHash(tokenHash: string): Promise<TransferRow | null> {
  const { data, error } = await getDb()
    .from("transfer_sessions")
    .select("*")
    .eq("token_hash", tokenHash)
    .maybeSingle();
  if (error) throw new Error(`Falha ao ler sessão de transferência: ${error.message}`);
  return (data as TransferRow | null) ?? null;
}

export async function getTransferById(id: string): Promise<TransferRow | null> {
  const { data, error } = await getDb()
    .from("transfer_sessions")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`Falha ao ler sessão de transferência: ${error.message}`);
  return (data as TransferRow | null) ?? null;
}

export async function claimTransfer(id: string, claimToken: string): Promise<{
  claimed: boolean;
  transfer: TransferRow | null;
}> {
  const { data, error } = await getDb()
    .from("transfer_sessions")
    .update({ status: "processing", claim_token: claimToken })
    .eq("id", id)
    .eq("status", "pending")
    .select("*")
    .maybeSingle();
  if (error) throw new Error(`Falha ao reservar sessão de transferência: ${error.message}`);
  if (data) return { claimed: true, transfer: data as TransferRow };
  return { claimed: false, transfer: await getTransferById(id) };
}

export async function completeTransfer(id: string, checkoutUrl: string): Promise<void> {
  const { error } = await getDb()
    .from("transfer_sessions")
    .update({
      status: "completed",
      checkout_url: checkoutUrl,
      claim_token: null,
      consumed_at: new Date().toISOString(),
      error_code: null,
      error_detail: null,
    })
    .eq("id", id);
  if (error) throw new Error(`Falha ao concluir transferência: ${error.message}`);
}

export async function failTransfer(id: string, code: string, detail: string): Promise<void> {
  const { error } = await getDb()
    .from("transfer_sessions")
    .update({
      status: "failed",
      claim_token: null,
      error_code: code,
      error_detail: detail.slice(0, 1000),
    })
    .eq("id", id);
  if (error) throw new Error(`Falha ao marcar transferência: ${error.message}`);
}

export async function expireTransfer(id: string): Promise<void> {
  const { error } = await getDb()
    .from("transfer_sessions")
    .update({ status: "expired" })
    .eq("id", id)
    .eq("status", "pending");
  if (error) throw new Error(`Falha ao expirar transferência: ${error.message}`);
}

export async function listRecentTransfers(
  limit = 50,
  integrationId?: string,
  offset = 0,
): Promise<TransferRow[]> {
  let storeAIds: string[] | null = null;
  if (integrationId) {
    const stores = await getStoresForIntegration(integrationId);
    storeAIds = stores.filter((store) => store.role === "a").map((store) => store.id);
    if (storeAIds.length === 0) return [];
  }
  let query = getDb()
    .from("transfer_sessions")
    .select("*")
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);
  if (storeAIds) query = query.in("store_a_id", storeAIds);
  const { data, error } = await query;
  if (error) throw new Error(`Falha ao listar transferências: ${error.message}`);
  return (data ?? []) as TransferRow[];
}

export function isExpired(transfer: Pick<TransferRow, "expires_at">, now = Date.now()): boolean {
  return new Date(transfer.expires_at).getTime() <= now;
}

export function publicTransferStatus(status: TransferStatus): string {
  switch (status) {
    case "pending":
      return "Aguardando confirmação";
    case "processing":
      return "Criando checkout";
    case "completed":
      return "Checkout criado";
    case "failed":
      return "Falhou";
    case "expired":
      return "Expirada";
  }
}
