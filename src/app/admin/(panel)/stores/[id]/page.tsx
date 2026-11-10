import Link from "next/link";
import { notFound } from "next/navigation";
import { getStoreById } from "@/lib/db/stores";
import { catalogStats, getLatestSyncRun } from "@/lib/db/catalog";
import { getThemeInstallation } from "@/lib/db/theme-installations";
import {
  deleteStoreAction,
  disconnectStoreAction,
  importCatalogAction,
  installThemeAction,
  rollbackThemeAction,
  saveStoreOAuthCredentialsAction,
  testStoreConnectionAction,
  updateStoreDetailsAction,
} from "@/app/admin/actions";
import { SubmitButton } from "@/components/submit-button";
import { Notice, StatusBadge } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function StoreDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const store = await getStoreById(id);
  if (!store) notFound();

  const [stats, lastSync, themeInstall] = await Promise.all([
    catalogStats(store.id),
    store.platform === "shopify" ? getLatestSyncRun(store.id) : Promise.resolve(null),
    store.store_type === "storefront" ? getThemeInstallation(store.id) : Promise.resolve(null),
  ]);

  return (
    <div className="stack">
      <div className="panel">
        <div className="panel-header">
          <div>
            <Link href="/admin/stores" className="small">← Voltar para lojas</Link>
            <div className="row" style={{ marginTop: "0.6rem", marginBottom: "0.35rem" }}>
              <span className="badge">{store.store_type === "storefront" ? "Vitrine" : "Checkout"}</span>
              <span className="badge">{store.platform === "shopify" ? "Shopify" : "Externo"}</span>
              <StatusBadge status={store.status} />
            </div>
            <h1>{store.name}</h1>
            <p className="muted small" style={{ margin: 0 }}>
              {store.shop_domain ?? store.external_base_url ?? "sem domínio"} ·{" "}
              {store.currency ?? "moeda não informada"}
            </p>
          </div>
          {store.platform === "shopify" && store.shopify_client_id && store.shopify_client_secret_cipher ? (
            <a className="button" href={`/api/auth/shopify/install?store=${store.id}`}>
              {store.admin_token_cipher ? "Reconectar OAuth" : "Conectar OAuth"}
            </a>
          ) : null}
        </div>
        {query.saved ? <Notice tone="success">{query.saved}</Notice> : null}
        {query.error ? <Notice tone="danger">{query.error}</Notice> : null}
      </div>

      <div className="grid-2">
        <section className="panel">
          <h2>Dados da loja</h2>
          {store.platform === "shopify" ? (
            <form action={updateStoreDetailsAction} className="form-grid">
              <input type="hidden" name="store_id" value={store.id} />
              <div>
                <label htmlFor="detail-name">Nome</label>
                <input id="detail-name" name="name" type="text" defaultValue={store.name} required />
              </div>
              <div>
                <label htmlFor="detail-domain">Domínio .myshopify.com</label>
                <input id="detail-domain" name="shop_domain" type="text" defaultValue={store.shop_domain ?? ""} required />
              </div>
              <div>
                <label htmlFor="detail-scopes">Escopos</label>
                <input id="detail-scopes" name="shopify_scopes" type="text" defaultValue={store.shopify_scopes} />
              </div>
              <div className="full">
                <SubmitButton className="secondary" pendingLabel="Salvando...">Salvar dados</SubmitButton>
              </div>
            </form>
          ) : (
            <form action={updateStoreDetailsAction} className="form-grid">
              <input type="hidden" name="store_id" value={store.id} />
              <div>
                <label htmlFor="detail-name">Nome</label>
                <input id="detail-name" name="name" type="text" defaultValue={store.name} required />
              </div>
              <div>
                <label htmlFor="detail-url">Origem externa</label>
                <input id="detail-url" name="external_base_url" type="url" defaultValue={store.external_base_url ?? ""} required />
              </div>
              <div>
                <label htmlFor="detail-currency">Moeda</label>
                <select id="detail-currency" name="currency" defaultValue={store.currency ?? "BRL"}>
                  <option value="USD">Dólar (USD)</option>
                  <option value="BRL">Real (BRL)</option>
                  <option value="EUR">Euro (EUR)</option>
                </select>
              </div>
              <div className="full">
                <SubmitButton className="secondary" pendingLabel="Salvando...">Salvar dados</SubmitButton>
              </div>
            </form>
          )}
        </section>

        <section className="panel">
          <h2>Catálogo</h2>
          {store.platform === "shopify" ? (
            <>
              <p className="small">
                <strong>{stats.products}</strong> produtos · <strong>{stats.variants}</strong> variantes
                {lastSync ? ` · última importação ${new Date(lastSync.started_at).toLocaleString("pt-BR")}` : ""}
              </p>
              <div className="row">
                <form action={importCatalogAction}>
                  <input type="hidden" name="store_id" value={store.id} />
                  <SubmitButton pendingLabel="Importando...">Importar catálogo</SubmitButton>
                </form>
                <form action={testStoreConnectionAction}>
                  <input type="hidden" name="store_id" value={store.id} />
                  <SubmitButton className="secondary" pendingLabel="Testando...">Testar conexão</SubmitButton>
                </form>
                <form action={disconnectStoreAction}>
                  <input type="hidden" name="store_id" value={store.id} />
                  <SubmitButton className="secondary" pendingLabel="Desconectando...">Desconectar</SubmitButton>
                </form>
              </div>
            </>
          ) : (
            <p className="muted small">Loja externa: catálogo não é importado; os produtos são informados nos mapeamentos.</p>
          )}
        </section>
      </div>

      {store.platform === "shopify" ? (
        <section className="panel">
          <h2>Credenciais OAuth</h2>
          <form action={saveStoreOAuthCredentialsAction} className="form-grid">
            <input type="hidden" name="store_id" value={store.id} />
            <div>
              <label htmlFor="detail-client-id">Client ID</label>
              <input id="detail-client-id" name="client_id" type="text" defaultValue={store.shopify_client_id ?? ""} required />
            </div>
            <div>
              <label htmlFor="detail-client-secret">Novo Client Secret (opcional)</label>
              <input id="detail-client-secret" name="client_secret" type="password" autoComplete="off" />
              <p className="tiny muted">Deixe vazio para manter o secret atual.</p>
            </div>
            <div>
              <label htmlFor="detail-client-scopes">Escopos</label>
              <input id="detail-client-scopes" name="scopes" type="text" defaultValue={store.shopify_scopes} />
            </div>
            <div className="full">
              <SubmitButton className="secondary" pendingLabel="Salvando...">Salvar credenciais</SubmitButton>
            </div>
          </form>
        </section>
      ) : null}

      {store.store_type === "storefront" ? (
        <section className="panel">
          <div className="panel-header">
            <div>
              <h2>Instalação no tema</h2>
              <p className="muted small" style={{ margin: 0 }}>
                Código global no tema publicado da vitrine, com backup e rollback.
              </p>
            </div>
            <StatusBadge status={themeInstall?.status ?? "skipped"} />
          </div>
          {themeInstall?.last_error ? <Notice tone="danger">{themeInstall.last_error}</Notice> : null}
          <div className="row">
            <form action={installThemeAction}>
              <input type="hidden" name="store_id" value={store.id} />
              <SubmitButton pendingLabel="Instalando...">Instalar/atualizar tema</SubmitButton>
            </form>
            <form action={rollbackThemeAction}>
              <input type="hidden" name="store_id" value={store.id} />
              <SubmitButton className="secondary" pendingLabel="Restaurando...">Restaurar backup</SubmitButton>
            </form>
          </div>
        </section>
      ) : null}

      <section className="panel">
        <h2>Excluir loja</h2>
        <p className="small muted">
          Exclui a loja e os pares/mapeamentos vinculados. Esta ação não pode ser desfeita.
        </p>
        <form action={deleteStoreAction} className="row">
          <input type="hidden" name="store_id" value={store.id} />
          <input name="confirm" placeholder="Digite EXCLUIR" aria-label="Confirmação de exclusão" style={{ flex: 1 }} />
          <SubmitButton className="danger" pendingLabel="Excluindo...">Excluir loja</SubmitButton>
        </form>
      </section>
    </div>
  );
}
