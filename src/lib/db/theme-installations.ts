import "server-only";

import { getDb } from "@/lib/supabase";

export type ThemeInstallStatus = "pending" | "installed" | "failed" | "skipped" | "rolled_back";

export type ThemeInstallationRow = {
  id: string;
  store_id: string;
  theme_id: string | null;
  theme_name: string | null;
  status: ThemeInstallStatus;
  version: string;
  backup_layout: string | null;
  last_error: string | null;
  installed_at: string | null;
  created_at: string;
  updated_at: string;
};

export async function getThemeInstallation(storeId: string): Promise<ThemeInstallationRow | null> {
  const { data, error } = await getDb()
    .from("theme_installations")
    .select("*")
    .eq("store_id", storeId)
    .maybeSingle();
  if (error) throw new Error(`Falha ao ler instalação do tema: ${error.message}`);
  return (data as ThemeInstallationRow | null) ?? null;
}

export async function beginThemeInstall(input: {
  storeId: string;
  themeId: string;
  themeName: string;
  backupLayout: string | null;
  version: string;
}): Promise<void> {
  const existing = await getThemeInstallation(input.storeId);
  if (!existing) {
    const { error } = await getDb()
      .from("theme_installations")
      .insert({
        store_id: input.storeId,
        theme_id: input.themeId,
        theme_name: input.themeName,
        status: "pending",
        version: input.version,
        backup_layout: input.backupLayout,
        last_error: null,
      });
    if (error) throw new Error(`Falha ao iniciar instalação do tema: ${error.message}`);
    return;
  }

  const patch: Record<string, unknown> = {
    theme_id: input.themeId,
    theme_name: input.themeName,
    status: "pending",
    version: input.version,
    last_error: null,
  };
  if (existing.theme_id !== input.themeId) {
    // Trocou de tema: o backup do tema anterior não serve para rollback.
    patch.backup_layout = input.backupLayout;
    patch.installed_at = null;
  } else if (input.backupLayout && !existing.backup_layout) {
    patch.backup_layout = input.backupLayout;
  }
  const { error } = await getDb()
    .from("theme_installations")
    .update(patch)
    .eq("store_id", input.storeId);
  if (error) throw new Error(`Falha ao atualizar instalação do tema: ${error.message}`);
}

export async function markThemeInstalled(storeId: string): Promise<void> {
  const { error } = await getDb()
    .from("theme_installations")
    .update({
      status: "installed",
      installed_at: new Date().toISOString(),
      last_error: null,
    })
    .eq("store_id", storeId);
  if (error) throw new Error(`Falha ao marcar tema instalado: ${error.message}`);
}

export async function markThemeFailed(storeId: string, message: string): Promise<void> {
  const { error } = await getDb()
    .from("theme_installations")
    .update({ status: "failed", last_error: message.slice(0, 1500) })
    .eq("store_id", storeId);
  if (error) throw new Error(`Falha ao registrar erro do tema: ${error.message}`);
}

export async function markThemeSkipped(storeId: string, message: string): Promise<void> {
  const { error } = await getDb()
    .from("theme_installations")
    .update({ status: "skipped", last_error: message.slice(0, 1500) })
    .eq("store_id", storeId);
  if (error) throw new Error(`Falha ao registrar tema ignorado: ${error.message}`);
}

export async function markThemeRolledBack(storeId: string): Promise<void> {
  const { error } = await getDb()
    .from("theme_installations")
    .update({ status: "rolled_back", last_error: null })
    .eq("store_id", storeId);
  if (error) throw new Error(`Falha ao marcar rollback do tema: ${error.message}`);
}
