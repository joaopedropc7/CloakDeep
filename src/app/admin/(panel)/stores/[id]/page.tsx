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
import { CopyButton } from "@/components/copy-button";
import { buildExternalCheckoutScript } from "@/lib/external-checkout-script";

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

  const externalScript = store.platform === "external" ? buildExternalCheckoutScript(store.name) : null;
  const externalButtonHtml = `<a href="/checkout" class="shopsync-checkout" data-shopsync-checkout>\n  Finalizar compra\n</a>`;
  const externalButtonCss = `.shopsync-checkout {\n  display: inline-flex;\n  align-items: center;\n  justify-content: center;\n  min-height: 48px;\n  padding: 0.8rem 1.4rem;\n  border-radius: 0.5rem;\n  background: #111827;\n  color: #ffffff;\n  font: inherit;\n  font-weight: 700;\n  text-decoration: none;\n}\n\n.shopsync-checkout:hover {\n  background: #1f2937;\n  color: #ffffff;\n}`;
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

      {externalScript ? (
        <section className="panel">
          <div className="panel-header">
            <div>
              <h2>Script da loja externa</h2>
              <p className="muted small" style={{ margin: 0 }}>
                Cole o bloco abaixo antes de <code>&lt;/head&gt;</code> em todas as páginas da
                loja externa. Ele só age quando a URL chega com o marcador do ShopSync.
              </p>
            </div>
            <CopyButton value={externalScript} />
          </div>
          <pre className="code-block">{externalScript}</pre>
          <details open style={{ marginTop: "1rem" }}>
            <summary className="button button-secondary">Ver instruções de instalação na loja externa</summary>
            <div className="stack" style={{ marginTop: "0.9rem" }}>
              <div>
                <h3>1. Script no head</h3>
                <p className="small muted">
                  Cole o script acima antes de <code>&lt;/head&gt;</code> em <strong>todas as
                  páginas</strong> da loja externa: produto, carrinho, checkout e páginas de
                  campanha.
                </p>
              </div>

              <div>
                <h3>2. Botão/link de checkout no produto</h3>
                <p className="small muted">
                  Na página de produto, o link ou botão final de checkout deve ter o atributo
                  <code> data-shopsync-checkout</code>. Exemplo em HTML vanilla:
                </p>
                <div className="row">
                  <CopyButton value={externalButtonHtml} label="Copiar HTML" />
                </div>
                <pre className="code-block">{externalButtonHtml}</pre>
                <p className="tiny muted">
                  O atributo é a forma mais confiável. Sem ele, o script tenta links contendo
                  <code> /checkout</code> e botões com o texto “Finalizar compra”.
                </p>
              </div>

              <div>
                <h3>3. CSS opcional</h3>
                <p className="small muted">
                  Se a loja externa já tem um botão próprio, não precisa deste CSS. Se quiser um
                  botão padrão do ShopSync:
                </p>
                <div className="row">
                  <CopyButton value={externalButtonCss} label="Copiar CSS" />
                </div>
                <pre className="code-block">{externalButtonCss}</pre>
              </div>

              <div>
                <h3>4. Como testar</h3>
                <ol className="small muted" style={{ margin: 0, paddingLeft: "1.2rem" }}>
                  <li>Cadastre a URL completa do produto no mapeamento da vitrine.</li>
                  <li>Abra a página de produto da vitrine e clique no botão de compra.</li>
                  <li>Confirme que a URL da loja externa chega com <code>?shopsync_checkout=1</code>.</li>
                  <li>O script deve clicar no botão marcado e abrir o checkout da loja externa.</li>
                  <li>Se não encontrar o botão, o aviso de fallback aparece no rodapé da página.</li>
                </ol>
              </div>

              <Notice tone="info">
                O comprador chega primeiro à página do produto externo; o script então aciona o
                checkout daquela página. Não há redirecionamento silencioso.
              </Notice>
            </div>
          </details>
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
