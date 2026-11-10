import Link from "next/link";
import { appUrl } from "@/lib/env";
import { getSelectedIntegration, getStoreByRole, listIntegrations, listStores } from "@/lib/db/stores";
import { catalogStats, getLatestSyncRun } from "@/lib/db/catalog";
import { optionalEnv } from "@/lib/env";
import { StoreCreateForm } from "@/components/store-create-form";
import { getThemeInstallation } from "@/lib/db/theme-installations";
import {
  createPairAction,
  createStoreAction,
  deleteIntegrationAction,
  disconnectStoreAction,
  importCatalogAction,
  installThemeAction,
  renameIntegrationAction,
  rollbackThemeAction,
  saveExternalStoreAction,
  saveStoreOAuthCredentialsAction,
  saveStorefrontTokenAction,
  selectIntegrationAction,
  setIntegrationStatusAction,
  switchStoreBToShopifyAction,
  testStoreConnectionAction,
  updateStoreDetailsAction,
} from "@/app/admin/actions";
import { SubmitButton } from "@/components/submit-button";
import { Notice, StatusBadge } from "@/components/ui";

export const dynamic = "force-dynamic";

const OAUTH_ERRORS: Record<string, string> = {
  invalid_role: "Papel de loja inválido.",
  invalid_shop: "Informe um domínio .myshopify.com válido.",
  invalid_hmac: "A assinatura do retorno OAuth da Shopify é inválida.",
  stale_callback: "O retorno OAuth expirou. Tente conectar novamente.",
  missing_state: "O estado OAuth não foi encontrado. Tente novamente.",
  invalid_state: "O estado OAuth é inválido. Tente novamente.",
  state_mismatch: "O estado OAuth não corresponde. Tente novamente.",
  shop_mismatch: "O domínio retornado não corresponde ao autorizado.",
  missing_code: "A Shopify não retornou o código de autorização.",
  oauth_failed: "Não foi possível concluir a conexão com a Shopify.",
};

function publicAppUrl(): string | null {
  try {
    return appUrl();
  } catch {
    return null;
  }
}

export default async function StoresPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; saved?: string; connected?: string }>;
}) {
  const params = await searchParams;
  const [integrations, selectedIntegration, allStores] = await Promise.all([
    listIntegrations(),
    getSelectedIntegration(),
    listStores(),
  ]);
  const [storeA, storeB] = await Promise.all([getStoreByRole("a"), getStoreByRole("b")]);
  const storefronts = allStores.filter((store) => store.store_type === "storefront");
  const checkouts = allStores.filter((store) => store.store_type === "checkout");
  const activePairs = integrations.filter((integration) => integration.status === "active");
  const appUrlConfigured = Boolean(optionalEnv("APP_URL"));
  const [statsA, statsB, lastSyncA, lastSyncB, themeInstall] = await Promise.all([
    storeA ? catalogStats(storeA.id) : Promise.resolve({ products: 0, variants: 0 }),
    storeB?.platform === "shopify" ? catalogStats(storeB.id) : Promise.resolve({ products: 0, variants: 0 }),
    storeA ? getLatestSyncRun(storeA.id) : Promise.resolve(null),
    storeB?.platform === "shopify" ? getLatestSyncRun(storeB.id) : Promise.resolve(null),
    storeA ? getThemeInstallation(storeA.id) : Promise.resolve(null),
  ]);
  const apiBase = publicAppUrl();

  const errorMessage = params.error
    ? OAUTH_ERRORS[params.error] ?? params.error
    : null;

  return (
    <div className="stack">
      <div className="panel">
        <h1>Lojas e instalação</h1>
        <p className="muted">
          A Loja A é sempre Shopify. A Loja B pode ser Shopify (transferência de carrinho) ou
          um site externo (link direto por produto). Segredos ficam apenas no servidor.
        </p>
        {errorMessage ? <Notice tone="danger">{errorMessage}</Notice> : null}
        {params.saved ? <Notice tone="success">{params.saved}</Notice> : null}
        {params.connected ? (
          <Notice tone="success">
            Loja {params.connected === "a" ? "A" : "B"} conectada.{" "}
            {params.connected === "b" && storeB?.platform === "shopify" && !storeB.storefront_token_cipher
              ? "Falta configurar o token da Storefront API abaixo."
              : ""}
          </Notice>
        ) : null}
      </div>

      {!appUrlConfigured ? (
        <Notice tone="warning">
          <strong>APP_URL não está definido.</strong> O OAuth usará{" "}
          <code>http://localhost:3000</code>, mas o Shopify exige que o host do redirect seja
          igual ao <strong>Application URL</strong> do app. Configure o <code>APP_URL</code> com
          a URL pública/túnel e atualize as URLs do app antes de conectar.
        </Notice>
      ) : null}

      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>Pares Vitrine ↔ Checkout</h2>
            <p className="muted small" style={{ margin: 0 }}>
              Um par liga uma loja Vitrine a uma loja Checkout. Uma vitrine pode ter vários
              pares, mas somente <strong>um par ativo</strong>. Um checkout pode atender várias
              vitrines.
            </p>
          </div>
          {selectedIntegration ? <StatusBadge status={selectedIntegration.status} /> : null}
        </div>

        {activePairs.length > 0 ? (
          <Notice tone="success">
            <strong>Par(es) ativo(s) por vitrine:</strong>{" "}
            {activePairs.map((pair) => {
              const front = allStores.find((store) => store.id === pair.storefront_id);
              const checkout = allStores.find((store) => store.id === pair.checkout_id);
              return `${front?.name ?? "?"} → ${checkout?.name ?? "?"}`;
            }).join(" · ")}
          </Notice>
        ) : (
          <Notice tone="warning">Nenhum par ativo. Ative um par para liberar o checkout público.</Notice>
        )}
        {integrations.length === 0 ? (
          <Notice tone="warning">Nenhum par cadastrado. Crie as lojas e depois o primeiro par.</Notice>
        ) : (
          <form action={selectIntegrationAction} className="row" style={{ marginBottom: "1rem" }}>
            <select name="integration_id" defaultValue={selectedIntegration?.id ?? ""} aria-label="Par selecionado" style={{ flex: 1 }}>
              {integrations.map((integration) => (
                <option key={integration.id} value={integration.id}>
                  {integration.name} ({integration.status})
                </option>
              ))}
            </select>
            <SubmitButton className="secondary" pendingLabel="Selecionando...">Selecionar par</SubmitButton>
          </form>
        )}

        {selectedIntegration ? (
          <div className="grid-2" style={{ marginBottom: "1rem" }}>
            <form action={renameIntegrationAction} className="stack-sm">
              <input type="hidden" name="integration_id" value={selectedIntegration.id} />
              <div>
                <label htmlFor="rename-integration">Nome do par</label>
                <input id="rename-integration" name="name" type="text" defaultValue={selectedIntegration.name} required />
              </div>
              <SubmitButton className="secondary" pendingLabel="Salvando...">Renomear par</SubmitButton>
            </form>
            <div className="stack-sm">
              <form action={setIntegrationStatusAction} className="row">
                <input type="hidden" name="integration_id" value={selectedIntegration.id} />
                <select name="status" defaultValue={selectedIntegration.status} aria-label="Status do par" style={{ flex: 1 }}>
                  <option value="draft">Rascunho</option>
                  <option value="active">Ativo</option>
                  <option value="disabled">Desativado</option>
                </select>
                <SubmitButton className="secondary" pendingLabel="Salvando...">Status do par</SubmitButton>
              </form>
              <details>
                <summary className="small">Excluir par</summary>
                <form action={deleteIntegrationAction} className="row" style={{ marginTop: "0.5rem" }}>
                  <input type="hidden" name="integration_id" value={selectedIntegration.id} />
                  <input name="confirm" placeholder="Digite EXCLUIR" aria-label="Confirmação de exclusão" style={{ flex: 1 }} />
                  <SubmitButton className="danger" pendingLabel="Excluindo...">Excluir</SubmitButton>
                </form>
                <p className="tiny muted">Exclui apenas o par e seus mapeamentos. As lojas continuam cadastradas.</p>
              </details>
            </div>
          </div>
        ) : null}

        <details>
          <summary className="button button-secondary">+ Criar par Vitrine ↔ Checkout</summary>
          <form action={createPairAction} className="form-grid" style={{ marginTop: "0.75rem" }}>
            <div className="full">
              <label htmlFor="pair-name">Nome do par</label>
              <input id="pair-name" name="name" type="text" placeholder="Ex.: Vitrine principal → Checkout B" required />
            </div>
            <div>
              <label htmlFor="pair-storefront">Loja Vitrine</label>
              <select id="pair-storefront" name="storefront_id" required defaultValue="">
                <option value="">Selecione...</option>
                {storefronts.map((store) => (
                  <option key={store.id} value={store.id}>{store.name} · {store.shop_domain ?? "sem domínio"}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="pair-checkout">Loja Checkout</label>
              <select id="pair-checkout" name="checkout_id" required defaultValue="">
                <option value="">Selecione...</option>
                {checkouts.map((store) => (
                  <option key={store.id} value={store.id}>{store.name} · {store.platform === "external" ? store.external_base_url : store.shop_domain}</option>
                ))}
              </select>
            </div>
            <label className="consent-box full" style={{ margin: 0 }}>
              <input type="checkbox" name="activate" />
              <span>Ativar este par agora. Se já existir um par ativo para a vitrine, ele será desativado.</span>
            </label>
            <div className="full">
              <SubmitButton pendingLabel="Criando...">Criar par</SubmitButton>
            </div>
          </form>
        </details>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>Lojas cadastradas</h2>
            <p className="muted small" style={{ margin: 0 }}>
              Cadastre quantas lojas precisar. Nome e domínio/URL não podem se repetir. Depois
              monte os pares Vitrine ↔ Checkout.
            </p>
          </div>
          <span className="badge">{allStores.length} loja(s)</span>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Loja</th><th>Tipo</th><th>Plataforma</th><th>Domínio / URL</th><th>Status</th><th /></tr>
            </thead>
            <tbody>
              {allStores.map((store) => (
                <tr key={store.id}>
                  <td><strong>{store.name}</strong></td>
                  <td><span className="badge">{store.store_type === "storefront" ? "Vitrine" : "Checkout"}</span></td>
                  <td>{store.platform === "shopify" ? "Shopify" : "Externo"}</td>
                  <td className="small mono break">{store.shop_domain ?? store.external_base_url ?? "—"}</td>
                  <td><StatusBadge status={store.status} /></td>
                  <td>
                    {store.platform === "shopify" ? (
                      store.shopify_client_id && store.shopify_client_secret_cipher ? (
                        <a className="small" href={`/api/auth/shopify/install?store=${store.id}`}>
                          {store.admin_token_cipher ? "Reconectar" : "Conectar"}
                        </a>
                      ) : (
                        <span className="tiny muted">Sem credenciais</span>
                      )
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <details style={{ marginTop: "1rem" }}>
          <summary className="button">+ Cadastrar nova loja</summary>
          <StoreCreateForm action={createStoreAction} />
        </details>
      </section>

      <div className="grid-2">
        <section className="panel">
          <div className="panel-header">
            <div>
              <span className="badge">Vitrine</span>
              <h2 style={{ marginTop: "0.5rem" }}>Loja Vitrine</h2>
            </div>
            {storeA ? <StatusBadge status={storeA.status} /> : null}
          </div>

          {!storeA ? (
            <Notice tone="warning">
              Esta integração ainda não tem Loja A. Recarregue a página ou crie outra
              integração com o domínio da Loja A.
            </Notice>
          ) : (
            <div className="stack-sm">
              <p>
                <strong>{storeA.name}</strong>
                <br />
                <span className="mono break">{storeA.shop_domain}</span>
              </p>
              <p className="small muted">
                Client ID: <code className="break">{storeA.shopify_client_id ?? "não cadastrado"}</code>
              </p>
              {!storeA.shopify_client_id || !storeA.shopify_client_secret_cipher ? (
                <Notice tone="warning">
                  Cadastre o Client ID e o Client Secret do app Shopify desta loja antes de
                  conectar.
                </Notice>
              ) : !storeA.admin_token_cipher ? (
                <Notice tone="warning">
                  Loja A ainda não autorizada. Conecte por OAuth com{" "}
                  <code>read_products,write_themes</code>.
                  <br />
                  <a className="button" href={`/api/auth/shopify/install?store=${storeA.id}`}>
                    Conectar Loja A
                  </a>
                </Notice>
              ) : null}
              <p className="small muted">
                Moeda: {storeA.currency ?? "não informada"} · Domínio público:{" "}
                {storeA.primary_domain ?? "não informado"}
              </p>
              <p className="small muted">
                Escopos concedidos: {storeA.scopes.length ? storeA.scopes.join(", ") : "nenhum"}
              </p>
              <p className="small muted">
                Catálogo: {statsA.products} produtos, {statsA.variants} variantes.
                {lastSyncA ? ` Última importação: ${new Date(lastSyncA.started_at).toLocaleString("pt-BR")}.` : ""}
              </p>
              <div className="row">
                <form action={importCatalogAction}>
                  <input type="hidden" name="store_id" value={storeA.id} />
                  <SubmitButton pendingLabel="Importando...">Importar produtos</SubmitButton>
                </form>
                <form action={disconnectStoreAction}>
                  <input type="hidden" name="store_id" value={storeA.id} />
                  <SubmitButton className="secondary" pendingLabel="Desconectando...">
                    Desconectar
                  </SubmitButton>
                </form>
                <form action={testStoreConnectionAction}>
                  <input type="hidden" name="store_id" value={storeA.id} />
                  <SubmitButton className="secondary" pendingLabel="Testando...">
                    Testar conexão
                  </SubmitButton>
                </form>
              </div>
              <details>
                <summary className="small">Editar dados da Loja A</summary>
                <form action={updateStoreDetailsAction} className="form-grid" style={{ marginTop: "0.75rem" }}>
                  <input type="hidden" name="store_id" value={storeA.id} />
                  <div>
                    <label htmlFor="a-edit-name">Nome</label>
                    <input id="a-edit-name" name="name" type="text" defaultValue={storeA.name} required />
                  </div>
                  <div>
                    <label htmlFor="a-edit-domain">Domínio .myshopify.com</label>
                    <input id="a-edit-domain" name="shop_domain" type="text" defaultValue={storeA.shop_domain ?? ""} required />
                  </div>
                  <div>
                    <label htmlFor="a-edit-scopes">Escopos solicitados</label>
                    <input id="a-edit-scopes" name="shopify_scopes" type="text" defaultValue={storeA.shopify_scopes} />
                  </div>
                  <div className="full">
                    <SubmitButton className="secondary" pendingLabel="Salvando...">Salvar dados</SubmitButton>
                  </div>
                  <p className="tiny muted full">Trocar o domínio exige reconectar o OAuth e reimportar o catálogo.</p>
                </form>
              </details>

              <details>
                <summary className="small">Credenciais do app Shopify desta loja</summary>
                <form action={saveStoreOAuthCredentialsAction} className="form-grid" style={{ marginTop: "0.75rem" }}>
                  <input type="hidden" name="store_id" value={storeA.id} />
                  <div>
                    <label htmlFor="a-client-id">Client ID</label>
                    <input
                      id="a-client-id"
                      name="client_id"
                      type="text"
                      defaultValue={storeA.shopify_client_id ?? ""}
                      required
                    />
                  </div>
                  <div>
                    <label htmlFor="a-client-secret">Novo Client Secret (opcional)</label>
                    <input id="a-client-secret" name="client_secret" type="password" autoComplete="off" />
                    <p className="tiny muted">Deixe vazio para manter o secret atual.</p>
                  </div>
                  <div>
                    <label htmlFor="a-client-scopes">Escopos</label>
                    <input id="a-client-scopes" name="scopes" type="text" defaultValue={storeA.shopify_scopes} />
                  </div>
                  <div className="full">
                    <SubmitButton className="secondary" pendingLabel="Salvando...">
                      Salvar credenciais da Loja A
                    </SubmitButton>
                  </div>
                </form>
              </details>
              <details>
                <summary className="small">Reconectar OAuth</summary>
                <p className="small muted" style={{ marginTop: "0.75rem" }}>
                  Reconecta a mesma loja para renovar o token e conceder novos escopos.
                </p>
                {storeA.shopify_client_id && storeA.shopify_client_secret_cipher ? (
                  <a
                    className="button button-secondary"
                    href={`/api/auth/shopify/install?store=${storeA.id}`}
                  >
                    Reconectar Loja A
                  </a>
                ) : (
                  <p className="small muted">Cadastre as credenciais antes de reconectar.</p>
                )}
              </details>
            </div>
          )}
        </section>

        <section className="panel">
          <div className="panel-header">
            <div>
              <span className="badge">Checkout</span>
              <h2 style={{ marginTop: "0.5rem" }}>Loja Checkout</h2>
            </div>
            {storeB ? (
              <div className="pill-list">
                <StatusBadge status={storeB.status} />
                <span className="badge">{storeB.platform === "shopify" ? "Shopify" : "Externo"}</span>
              </div>
            ) : null}
          </div>

          {!storeB ? (
            <Notice tone="warning">
              Esta integração ainda não tem Loja B. Crie outra integração com a Loja B
              configurada.
            </Notice>
          ) : storeB.platform === "shopify" ? (
            <div className="stack-sm">
              <p>
                <strong>{storeB.name}</strong>
                <br />
                <span className="mono break">{storeB.shop_domain}</span>
              </p>
              <p className="small muted">
                Client ID: <code className="break">{storeB.shopify_client_id ?? "não cadastrado"}</code>
              </p>
              {!storeB.shopify_client_id || !storeB.shopify_client_secret_cipher ? (
                <Notice tone="warning">
                  Cadastre o Client ID e o Client Secret do app Shopify desta loja antes de
                  conectar.
                </Notice>
              ) : !storeB.admin_token_cipher ? (
                <Notice tone="warning">
                  Loja B ainda não autorizada. Conecte por OAuth antes de configurar a
                  Storefront API.
                  <br />
                  <a className="button" href={`/api/auth/shopify/install?store=${storeB.id}`}>
                    Conectar Loja B
                  </a>
                </Notice>
              ) : null}
              <p className="small muted">
                Moeda: {storeB.currency ?? "não informada"} · Catálogo: {statsB.products} produtos,{" "}
                {statsB.variants} variantes.
              </p>
              <div className="row">
                <form action={importCatalogAction}>
                  <input type="hidden" name="store_id" value={storeB.id} />
                  <SubmitButton pendingLabel="Importando...">Importar produtos</SubmitButton>
                </form>
                <form action={disconnectStoreAction}>
                  <input type="hidden" name="store_id" value={storeB.id} />
                  <SubmitButton className="secondary" pendingLabel="Desconectando...">
                    Desconectar
                  </SubmitButton>
                </form>
                <form action={testStoreConnectionAction}>
                  <input type="hidden" name="store_id" value={storeB.id} />
                  <SubmitButton className="secondary" pendingLabel="Testando...">
                    Testar conexão
                  </SubmitButton>
                </form>
              </div>

              <hr />
              <details>
                <summary className="small">Editar dados da Loja B</summary>
                <form action={updateStoreDetailsAction} className="form-grid" style={{ marginTop: "0.75rem" }}>
                  <input type="hidden" name="store_id" value={storeB.id} />
                  <div>
                    <label htmlFor="b-edit-name">Nome</label>
                    <input id="b-edit-name" name="name" type="text" defaultValue={storeB.name} required />
                  </div>
                  <div>
                    <label htmlFor="b-edit-domain">Domínio .myshopify.com</label>
                    <input id="b-edit-domain" name="shop_domain" type="text" defaultValue={storeB.shop_domain ?? ""} required />
                  </div>
                  <div>
                    <label htmlFor="b-edit-scopes">Escopos solicitados</label>
                    <input id="b-edit-scopes" name="shopify_scopes" type="text" defaultValue={storeB.shopify_scopes} />
                  </div>
                  <div className="full">
                    <SubmitButton className="secondary" pendingLabel="Salvando...">Salvar dados</SubmitButton>
                  </div>
                  <p className="tiny muted full">Trocar o domínio exige reconectar o OAuth e reimportar o catálogo.</p>
                </form>
              </details>
              <details>
                <summary className="small">Credenciais do app Shopify desta loja</summary>
                <form action={saveStoreOAuthCredentialsAction} className="form-grid" style={{ marginTop: "0.75rem" }}>
                  <input type="hidden" name="store_id" value={storeB.id} />
                  <div>
                    <label htmlFor="b-client-id">Client ID</label>
                    <input
                      id="b-client-id"
                      name="client_id"
                      type="text"
                      defaultValue={storeB.shopify_client_id ?? ""}
                      required
                    />
                  </div>
                  <div>
                    <label htmlFor="b-client-secret">Novo Client Secret (opcional)</label>
                    <input id="b-client-secret" name="client_secret" type="password" autoComplete="off" />
                    <p className="tiny muted">Deixe vazio para manter o secret atual.</p>
                  </div>
                  <div>
                    <label htmlFor="b-client-scopes">Escopos</label>
                    <input id="b-client-scopes" name="scopes" type="text" defaultValue={storeB.shopify_scopes} />
                  </div>
                  <div className="full">
                    <SubmitButton className="secondary" pendingLabel="Salvando...">
                      Salvar credenciais da Loja B
                    </SubmitButton>
                  </div>
                </form>
              </details>

              <hr />
              <h3>Storefront API</h3>
              {storeB.storefront_token_cipher ? (
                <Notice tone="success">
                  Token {storeB.storefront_token_kind === "private" ? "privado" : "público"} configurado
                  para a versão {storeB.storefront_api_version}. O valor nunca é exibido.
                </Notice>
              ) : (
                <Notice tone="warning">
                  O checkout da Loja B exige um token da Storefront API com permissão de
                  produtos e checkouts. Crie/obtenha o token pela Headless channel.
                </Notice>
              )}
              <details open={!storeB.storefront_token_cipher}>
                <summary className="small">
                  {storeB.storefront_token_cipher ? "Substituir token" : "Configurar token"}
                </summary>
                <form action={saveStorefrontTokenAction} className="form-grid" style={{ marginTop: "0.75rem" }}>
                  <div className="full">
                    <label htmlFor="storefront-token">Token da Storefront API</label>
                    <input
                      id="storefront-token"
                      name="token"
                      type="password"
                      autoComplete="off"
                      required
                    />
                    <p className="tiny muted">
                      Permissões necessárias: produtos e checkouts (leitura e escrita). Recomenda-se
                      token privado, usado somente no servidor.
                    </p>
                  </div>
                  <div>
                    <label htmlFor="storefront-kind">Tipo</label>
                    <select id="storefront-kind" name="kind" defaultValue="private">
                      <option value="private">Privado (recomendado)</option>
                      <option value="public">Público</option>
                    </select>
                  </div>
                  <div>
                    <label htmlFor="storefront-version">Versão da API</label>
                    <input
                      id="storefront-version"
                      name="api_version"
                      type="text"
                      defaultValue={storeB.storefront_api_version ?? "2026-10"}
                      pattern="\d{4}-\d{2}"
                      required
                    />
                  </div>
                  <div className="full">
                    <SubmitButton pendingLabel="Validando...">Validar e salvar token</SubmitButton>
                  </div>
                </form>
              </details>
              <details>
                <summary className="small">Reconectar Shopify ou trocar por site externo</summary>
                <p className="small muted" style={{ marginTop: "0.75rem" }}>
                  Reconecta a mesma loja B para renovar o token/conceder escopos.
                </p>
                {storeB.shopify_client_id && storeB.shopify_client_secret_cipher ? (
                  <a className="button button-secondary" href={`/api/auth/shopify/install?store=${storeB.id}`}>
                    Reconectar Loja B
                  </a>
                ) : (
                  <p className="small muted">Cadastre as credenciais antes de reconectar.</p>
                )}
                <form action={saveExternalStoreAction} className="form-grid" style={{ marginTop: "0.75rem" }}>
                  <input type="hidden" name="name" value={storeB.name} />
                  <input type="hidden" name="currency" value={storeA?.currency ?? storeB.currency ?? "BRL"} />
                  <div className="full">
                    <label htmlFor="shop-b-external-switch">Trocar para site externo (origem HTTPS)</label>
                    <input id="shop-b-external-switch" name="base_url" type="url" required />
                  </div>
                  <div className="full">
                    <SubmitButton className="secondary" pendingLabel="Salvando...">
                      Trocar para externo
                    </SubmitButton>
                  </div>
                </form>
              </details>
            </div>
          ) : (
            <div className="stack-sm">
              <p>
                <strong>{storeB.name}</strong>
                <br />
                <span className="mono break">{storeB.external_base_url}</span>
              </p>
              <p className="small muted">Moeda: {storeB.currency}. Sem carrinho: links diretos por produto.</p>
              <form action={saveExternalStoreAction} className="form-grid">
                <div>
                  <label htmlFor="external-name-edit">Nome exibido</label>
                  <input id="external-name-edit" name="name" type="text" defaultValue={storeB.name} required />
                </div>
                <div>
                  <label htmlFor="external-url-edit">Origem HTTPS</label>
                  <input
                    id="external-url-edit"
                    name="base_url"
                    type="url"
                    defaultValue={storeB.external_base_url ?? ""}
                    required
                  />
                </div>
                <div>
                  <label htmlFor="external-currency-edit">Moeda</label>
                  <input
                    id="external-currency-edit"
                    name="currency"
                    type="text"
                    maxLength={3}
                    defaultValue={storeB.currency ?? storeA?.currency ?? "BRL"}
                    required
                  />
                </div>
                <div className="full">
                  <SubmitButton className="secondary" pendingLabel="Salvando...">
                    Salvar destino externo
                  </SubmitButton>
                </div>
              </form>
              <details>
                <summary className="small">Trocar esta Loja B externa por Shopify</summary>
                <form action={switchStoreBToShopifyAction} className="form-grid" style={{ marginTop: "0.75rem" }}>
                  <input type="hidden" name="store_id" value={storeB.id} />
                  <div>
                    <label htmlFor="b-switch-name">Nome</label>
                    <input id="b-switch-name" name="name" type="text" defaultValue={storeB.name} required />
                  </div>
                  <div>
                    <label htmlFor="b-switch-domain">Domínio .myshopify.com</label>
                    <input id="b-switch-domain" name="shop_domain" type="text" required />
                  </div>
                  <div>
                    <label htmlFor="b-switch-client-id">Client ID</label>
                    <input id="b-switch-client-id" name="client_id" type="text" required />
                  </div>
                  <div>
                    <label htmlFor="b-switch-client-secret">Client Secret</label>
                    <input id="b-switch-client-secret" name="client_secret" type="password" autoComplete="off" required />
                  </div>
                  <div className="full">
                    <label htmlFor="b-switch-scopes">Escopos</label>
                    <input id="b-switch-scopes" name="shopify_scopes" type="text" defaultValue="read_products,write_themes" />
                  </div>
                  <div className="full">
                    <SubmitButton className="secondary" pendingLabel="Convertendo...">Converter para Shopify</SubmitButton>
                  </div>
                  <p className="tiny muted full">Os mapeamentos existentes serão sinalizados para revisão.</p>
                </form>
              </details>
            </div>
          )}
        </section>
      </div>

      <section className="panel">
        <h2>Instalação no tema da Loja A</h2>
        <p className="small muted">
          A integração é feita por <strong>código no tema</strong>, instalado automaticamente
          pela Admin API no tema publicado. Não há app block nem app embed. O app Shopify
          continua sendo usado apenas para OAuth, Admin API e webhooks.
        </p>

        {storeA ? (
          <div className="stack-sm">
            <div
              className={`notice ${
                themeInstall?.status === "installed"
                  ? "notice-success"
                  : themeInstall?.status === "failed"
                    ? "notice-danger"
                    : "notice-warning"
              }`}
            >
              <div className="row" style={{ justifyContent: "space-between" }}>
                <strong>Instalação automática no tema</strong>
                <StatusBadge status={themeInstall?.status ?? "pending"} />
              </div>
              {themeInstall?.status === "installed" ? (
                <p className="small" style={{ margin: "0.4rem 0 0" }}>
                  Tema <strong>{themeInstall.theme_name}</strong> atualizado em{" "}
                  {themeInstall.installed_at
                    ? new Date(themeInstall.installed_at).toLocaleString("pt-BR")
                    : "instalação registrada"}
                  . A interceptação do checkout entra em vigor no tema publicado.
                </p>
              ) : (
                <p className="small" style={{ margin: "0.4rem 0 0" }}>
                  A instalação roda automaticamente ao conectar a Loja A e após cada
                  importação. Se ainda não rodou, use o botão abaixo. É necessário ter concedido{" "}
                  <code>write_themes</code> no OAuth e a Shopify precisa permitir a alteração
                  de arquivos de tema.
                </p>
              )}
              {themeInstall?.last_error ? (
                <p className="small" style={{ margin: "0.4rem 0 0" }}>
                  <strong>Último erro:</strong> {themeInstall.last_error}
                </p>
              ) : null}
              {!storeA.scopes.includes("write_themes") ? (
                <p className="small" style={{ margin: "0.4rem 0 0" }}>
                  A Loja A está conectada sem <code>write_themes</code>. Reconecte-a no cartão
                  acima para conceder o escopo.
                </p>
              ) : null}
            </div>
            <div className="row">
              <form action={installThemeAction}>
                <SubmitButton pendingLabel="Instalando no tema...">
                  Instalar/atualizar no tema agora
                </SubmitButton>
              </form>
              {themeInstall?.backup_layout ? (
                <form action={rollbackThemeAction}>
                  <SubmitButton className="secondary" pendingLabel="Restaurando...">
                    Restaurar layout anterior
                  </SubmitButton>
                </form>
              ) : null}
            </div>
          </div>
        ) : null}

        <hr />
        <h3>Fallback manual</h3>
        <p className="small muted">
          Use apenas se a Shopify negar a instalação automática. O lojista adiciona o snippet
          e os assets em <strong>Loja virtual → Temas → Editar código</strong>.
        </p>
        {!storeA || !apiBase ? (
          <Notice tone="warning">
            Conecte a Loja A e configure <code>APP_URL</code> para gerar as instruções com a URL
            correta da API.
          </Notice>
        ) : (
          <div className="stack-sm">
            <p>
              <strong>1. Envie os arquivos</strong>
            </p>
            <ul className="small">
              <li><code>assets/cross-store.js</code></li>
              <li><code>assets/cross-store.css</code></li>
              <li><code>snippets/cross-store-bridge.liquid</code></li>
            </ul>
            <p className="tiny muted">
              Os arquivos estão em <code>theme-code/</code> no projeto. Use o editor de código do
              tema ou <code>shopify theme push</code>.
            </p>

            <p>
              <strong>2. Aponte o snippet para a API</strong>
              <br />
              Em <code>cross-store-bridge.liquid</code>, substitua{" "}
              <code>assign csb_api_base = &apos;...&apos;</code> por:
              <br />
              <code className="break">assign csb_api_base = &apos;{apiBase}&apos;</code>
            </p>

            <p>
              <strong>3. Inclua o snippet</strong> no <code>layout/theme.liquid</code>, antes de{" "}
              <code>&lt;/body&gt;</code>:
            </p>
            <pre className="code-block">{`{% render 'cross-store-bridge' %}`}</pre>
            <p className="small">
              O JS intercepta o checkout padrão do carrinho. Não é necessário adicionar bloco
              de produto, app embed ou snippet por template.
            </p>
          </div>
        )}
        <p className="footer-note">
          A Loja B é a responsável pela venda e pelo checkout. O comprador vê o aviso de saída
          de domínio e a loja responsável antes de continuar.
        </p>
      </section>

      <p className="footer-note">
        Precisa de ajuda com as credenciais? Consulte <Link href="/admin/products">Produtos</Link>{" "}
        após importar ou o README do projeto para as configurações externas.
      </p>
    </div>
  );
}
