import Link from "next/link";
import { listStores } from "@/lib/db/stores";
import { createStoreAction } from "@/app/admin/actions";
import { StoreCreateForm } from "@/components/store-create-form";
import { Notice, StatusBadge } from "@/components/ui";
import { optionalEnv } from "@/lib/env";

export const dynamic = "force-dynamic";

type SearchParams = Promise<{
  saved?: string;
  error?: string;
  connected?: string;
}>;

export default async function StoresPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const stores = await listStores();
  const appUrlConfigured = Boolean(optionalEnv("APP_URL"));

  return (
    <div className="stack">
      <div className="panel">
        <div className="panel-header">
          <div>
            <h1>Lojas</h1>
            <p className="muted" style={{ margin: 0 }}>
              Cadastre e gerencie lojas do tipo Vitrine ou Checkout. Os pares entre elas ficam
              em uma tela separada.
            </p>
          </div>
          <Link className="button button-secondary" href="/admin/pairs">
            Pares Vitrine ↔ Checkout
          </Link>
        </div>

        {params.saved ? <Notice tone="success">{params.saved}</Notice> : null}
        {params.error ? <Notice tone="danger">{params.error}</Notice> : null}
        {params.connected ? (
          <Notice tone="success">
            Loja {params.connected === "a" ? "Vitrine" : "Checkout"} conectada.
          </Notice>
        ) : null}
        {!appUrlConfigured ? (
          <Notice tone="warning">
            <strong>APP_URL não está definido.</strong> Para o OAuth funcionar, configure a URL
            pública/túnel no <code>.env</code> e no app Shopify.
          </Notice>
        ) : null}
      </div>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>Lojas cadastradas</h2>
            <p className="muted small" style={{ margin: 0 }}>
              {stores.length} loja(s). Nome, domínio Shopify e URL externa não podem se repetir.
            </p>
          </div>
          <details>
            <summary className="button">+ Nova loja</summary>
            <div className="panel" style={{ marginTop: "0.75rem", boxShadow: "none" }}>
              <StoreCreateForm action={createStoreAction} />
            </div>
          </details>
        </div>

        {stores.length === 0 ? (
          <p className="muted">Nenhuma loja cadastrada ainda.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Loja</th>
                  <th>Tipo</th>
                  <th>Plataforma</th>
                  <th>Domínio / URL</th>
                  <th>Status</th>
                  <th>Ações</th>
                </tr>
              </thead>
              <tbody>
                {stores.map((store) => (
                  <tr key={store.id}>
                    <td>
                      <strong>{store.name}</strong>
                    </td>
                    <td>
                      <span className="badge">
                        {store.store_type === "storefront" ? "Vitrine" : "Checkout"}
                      </span>
                    </td>
                    <td>{store.platform === "shopify" ? "Shopify" : "Externo"}</td>
                    <td className="mono small break">
                      {store.shop_domain ?? store.external_base_url ?? "—"}
                    </td>
                    <td><StatusBadge status={store.status} /></td>
                    <td>
                      <div className="row" style={{ gap: "0.75rem" }}>
                        <Link href={`/admin/stores/${store.id}`} className="small">Editar</Link>
                        {store.platform === "shopify" &&
                        store.shopify_client_id &&
                        store.shopify_client_secret_cipher ? (
                          <a className="small" href={`/api/auth/shopify/install?store=${store.id}`}>
                            {store.admin_token_cipher ? "Reconectar" : "Conectar"}
                          </a>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
