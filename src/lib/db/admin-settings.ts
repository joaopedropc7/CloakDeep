import "server-only";

import { getDb } from "@/lib/supabase";

export async function getAdminPasswordHash(): Promise<string | null> {
  const { data, error } = await getDb()
    .from("admin_settings")
    .select("password_hash")
    .eq("singleton", true)
    .maybeSingle();
  if (error) throw new Error(`Falha ao ler configuração administrativa: ${error.message}`);
  return (data?.password_hash as string | undefined) ?? null;
}

export async function saveAdminPasswordHash(hash: string): Promise<void> {
  const { error } = await getDb()
    .from("admin_settings")
    .upsert(
      { singleton: true, password_hash: hash, updated_at: new Date().toISOString() },
      { onConflict: "singleton" },
    );
  if (error) throw new Error(`Falha ao salvar senha administrativa: ${error.message}`);
}
