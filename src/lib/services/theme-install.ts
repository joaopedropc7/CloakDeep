import "server-only";

import { appUrl } from "@/lib/env";
import { recordAudit } from "@/lib/db/audit";
import {
  beginThemeInstall,
  getThemeInstallation,
  markThemeFailed,
  markThemeInstalled,
  markThemeRolledBack,
  markThemeSkipped,
  type ThemeInstallStatus,
} from "@/lib/db/theme-installations";
import type { StoreRow } from "@/lib/db/types";
import { adminGraphql, ShopifyApiError } from "@/lib/shopify/admin";
import { THEME_CSS, THEME_JS, THEME_SNIPPET } from "@/lib/theme/theme-assets.generated";

export const THEME_INSTALL_VERSION = "3";
const MARKER = "CSB_THEME_INSTALL_V1";
const LAYOUT_FILE = "layout/theme.liquid";
const SNIPPET_FILE = "snippets/cross-store-bridge.liquid";
const JS_FILE = "assets/cross-store.js";
const CSS_FILE = "assets/cross-store.css";

export type ThemeInstallResult = {
  status: ThemeInstallStatus;
  installed: boolean;
  themeName: string | null;
  error: string | null;
};

function markerBlock(apiBase: string): string {
  return `\n{%- comment -%} ${MARKER} {%- endcomment -%}\n{% render 'cross-store-bridge' %}\n`;
}

function snippet(apiBase: string): string {
  return THEME_SNIPPET.replace("https://app.exemplo.com", apiBase);
}

const THEMES_QUERY = `#graphql
  query MainTheme {
    themes(first: 10, roles: [MAIN]) {
      nodes { id name role processing processingFailed }
    }
  }
`;

const THEME_LAYOUT_QUERY = `#graphql
  query ThemeLayout($id: ID!) {
    theme(id: $id) {
      id
      name
      role
      files(first: 1, filenames: ["layout/theme.liquid"]) {
        nodes {
          filename
          body {
            ... on OnlineStoreThemeFileBodyText { content }
          }
        }
      }
    }
  }
`;

const THEME_FILES_UPSERT = `#graphql
  mutation UpsertBridgeTheme($themeId: ID!, $files: [OnlineStoreThemeFilesUpsertFileInput!]!) {
    themeFilesUpsert(themeId: $themeId, files: $files) {
      job { id }
      upsertedThemeFiles { filename }
      userErrors { field message }
    }
  }
`;

type ThemeNode = {
  id: string;
  name: string;
  role: string;
  processing: boolean;
  processingFailed: boolean;
};

async function mainTheme(store: StoreRow): Promise<ThemeNode> {
  const data = await adminGraphql<{ themes: { nodes: ThemeNode[] } }>(store, {
    query: THEMES_QUERY,
  });
  const theme = data.themes.nodes.find((node) => node.role === "MAIN");
  if (!theme) throw new Error("Nenhum tema publicado (MAIN) foi encontrado.");
  if (theme.processing || theme.processingFailed) {
    throw new Error("O tema publicado está em processamento. Tente novamente em alguns minutos.");
  }
  return theme;
}

async function readLayout(store: StoreRow, themeId: string): Promise<string> {
  const data = await adminGraphql<{
    theme: {
      files: {
        nodes: Array<{
          filename: string;
          body: { content?: string } | null;
        }>;
      } | null;
    } | null;
  }>(store, {
    query: THEME_LAYOUT_QUERY,
    variables: { id: themeId },
  });
  const file = data.theme?.files?.nodes.find((node) => node.filename === LAYOUT_FILE);
  if (!file || typeof file.body?.content !== "string") {
    throw new Error("Não foi possível ler layout/theme.liquid do tema publicado.");
  }
  return file.body.content;
}

const LEGACY_INTEGRATION_BLOCK =
  /<!--\s*RS-EXT-S\s*-->[\s\S]*?<!--\s*RS-EXT-E\s*-->/gi;

/**
 * O tema da DRM Giveaway veio de outro sistema que injetava um script inline
 * entre RS-EXT-S/RS-EXT-E. Esse script intercepta o checkout antes do ShopSync
 * e chama uma API antiga. Removemos o bloco durante a instalação/atualização.
 */
export function stripLegacyIntegration(layout: string): string {
  return layout.replace(LEGACY_INTEGRATION_BLOCK, "").replace(/\n{3,}/g, "\n\n");
}

function injectRender(layout: string, apiBase: string): string {
  const cleaned = stripLegacyIntegration(layout);
  if (cleaned.includes(MARKER)) return cleaned;
  const block = markerBlock(apiBase);
  const index = cleaned.toLowerCase().lastIndexOf("</body>");
  if (index >= 0) return `${cleaned.slice(0, index)}${block}${cleaned.slice(index)}`;
  return `${cleaned}${block}`;
}

async function upsertFiles(
  store: StoreRow,
  themeId: string,
  files: Array<{ filename: string; value: string }>,
): Promise<void> {
  const data = await adminGraphql<{
    themeFilesUpsert: {
      job: { id: string } | null;
      upsertedThemeFiles: Array<{ filename: string }>;
      userErrors: Array<{ field: string[] | null; message: string }>;
    };
  }>(store, {
    query: THEME_FILES_UPSERT,
    variables: {
      themeId,
      files: files.map((file) => ({
        filename: file.filename,
        body: { type: "TEXT", value: file.value },
      })),
    },
  });
  if (data.themeFilesUpsert.userErrors.length > 0) {
    throw new Error(
      data.themeFilesUpsert.userErrors.map((error) => error.message).join(" | ").slice(0, 1000),
    );
  }
}

function themeErrorMessage(error: unknown): string {
  if (error instanceof ShopifyApiError) {
    if (error.code === "ACCESS_DENIED" || error.status === 403) {
      return "A Shopify negou acesso para alterar o tema. Confirme o escopo write_themes e a exemption de theme files.";
    }
    return `Shopify recusou a alteração do tema (${error.code ?? error.status ?? "erro"}).`;
  }
  return error instanceof Error ? error.message : "Falha desconhecida ao instalar no tema.";
}

/**
 * Instala (ou atualiza) o snippet e os assets no tema MAIN da Loja A.
 * Requer write_themes + exemption da Shopify. A função não lança: registra o
 * estado e devolve um resultado para que o sync de catálogo não falhe por causa
 * de uma restrição de tema.
 */
export async function installThemeIntegration(store: StoreRow): Promise<ThemeInstallResult> {
  if (store.role !== "a" || store.platform !== "shopify") {
    return { status: "skipped", installed: false, themeName: null, error: "Loja A não é Shopify." };
  }
  if (!store.scopes.includes("write_themes")) {
    const message =
      "A Loja A foi conectada sem write_themes. Reconecte-a com o escopo write_themes para instalar o tema automaticamente.";
    try {
      await markThemeSkipped(store.id, message);
    } catch {
      /* migration/DB issue: still return a non-throwing result for the sync */
    }
    return { status: "skipped", installed: false, themeName: null, error: message };
  }

  let themeName: string | null = null;
  try {
    const apiBase = appUrl();
    const theme = await mainTheme(store);
    themeName = theme.name;
    const layout = await readLayout(store, theme.id);
    const cleanedLayout = stripLegacyIntegration(layout);
    const nextLayout = injectRender(cleanedLayout, apiBase);
    const isNewInstall = nextLayout !== layout;

    await beginThemeInstall({
      storeId: store.id,
      themeId: theme.id,
      themeName: theme.name,
      backupLayout: isNewInstall ? cleanedLayout : null,
      version: THEME_INSTALL_VERSION,
    });

    const files = [
      { filename: SNIPPET_FILE, value: snippet(apiBase) },
      { filename: JS_FILE, value: THEME_JS },
      { filename: CSS_FILE, value: THEME_CSS },
    ];
    if (isNewInstall) files.push({ filename: LAYOUT_FILE, value: nextLayout });

    await upsertFiles(store, theme.id, files);
    await markThemeInstalled(store.id);
    await recordAudit({
      storeId: store.id,
      eventType: "theme_installed",
      metadata: {
        themeId: theme.id,
        themeName: theme.name,
        version: THEME_INSTALL_VERSION,
        layoutChanged: isNewInstall,
      },
    });
    return { status: "installed", installed: true, themeName: theme.name, error: null };
  } catch (error) {
    const message = themeErrorMessage(error);
    try {
      await markThemeFailed(store.id, message);
    } catch {
      /* keep the sync result non-throwing even if the status write fails */
    }
    await recordAudit({
      storeId: store.id,
      eventType: "theme_install_failed",
      metadata: { themeName, code: error instanceof ShopifyApiError ? error.code : "THEME_ERROR" },
    });
    return { status: "failed", installed: false, themeName, error: message };
  }
}

/** Restaura o layout salvo antes da primeira instalação. */
export async function rollbackThemeIntegration(store: StoreRow): Promise<void> {
  if (store.role !== "a") throw new Error("Rollback disponível apenas para a Loja A.");
  const installation = await getThemeInstallation(store.id);
  if (!installation?.theme_id || !installation.backup_layout) {
    throw new Error("Não há backup de layout disponível para rollback.");
  }
  await upsertFiles(store, installation.theme_id, [
    { filename: LAYOUT_FILE, value: installation.backup_layout },
  ]);
  await markThemeRolledBack(store.id);
  await recordAudit({
    storeId: store.id,
    eventType: "theme_install_failed",
    metadata: { action: "rollback", themeId: installation.theme_id },
  });
}
