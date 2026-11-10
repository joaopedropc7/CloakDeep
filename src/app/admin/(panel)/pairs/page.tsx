import Link from "next/link";
import { listIntegrations, listStores } from "@/lib/db/stores";
import { createPairAction } from "@/app/admin/actions";
import { SubmitButton } from "@/components/submit-button";
import { Notice, StatusBadge } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function PairsPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const params = await searchParams;
  const [pairs, stores] = await Promise.all([listIntegrations(), listStores()]);
  const storefronts = stores.filter((store) => store.store_type === "storefront");
  const checkouts = stores.filter((store) => store.store_type === "checkout");
  const active = pairs.filter((pair) => pair.status === "active");

  return (
    <div className="stack">
      <div className="panel">
        <div className="panel-header">
          <div>
            <h1>Pares Vitrine ↔ Checkout</h1>
            <p className="muted" style={{ margin: 0 }}>
              Um par liga uma loja Vitrine a uma loja Checkout. Só um par pode ficar ativo por
              vitrine; um checkout pode atender várias vitrines.
            </p>
          </div>
          <Link className="button button-secondary" href="/admin/stores">Gerenciar lojas</Link>
        </div>
        {params.saved ? <Notice tone="success">{params.saved}</Notice> : null}
        {params.error ? <Notice tone="danger">{params.error}</Notice> : null}
        {active.length > 0 ? (
          <Notice tone="success">
            <strong>Ativos:</strong>{" "}
            {active.map((pair) => {
              const front = stores.find((store) => store.id === pair.storefront_id);
              const checkout = stores.find((store) => store.id === pair.checkout_id);
              return `${front?.name ?? "?"} → ${checkout?.name ?? "?"}`;
            }).join(" · ")}
          </Notice>
        ) : (
          <Notice tone="warning">Nenhum par ativo. O checkout público fica bloqueado.</Notice>
        )}
      </div>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>Pares cadastrados</h2>
            <p className="muted small" style={{ margin: 0 }}>{pairs.length} par(es).</p>
          </div>
          <details>
            <summary className="button">+ Novo par</summary>
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
                    <option key={store.id} value={store.id}>
                      {store.name} · {store.platform === "external" ? store.external_base_url : store.shop_domain}
                    </option>
                  ))}
                </select>
              </div>
              <label className="consent-box full" style={{ margin: 0 }}>
                <input type="checkbox" name="activate" />
                <span>Ativar este par agora. Se já houver outro ativo para a vitrine, ele será desativado.</span>
              </label>
              <div className="full">
                <SubmitButton pendingLabel="Criando...">Criar par</SubmitButton>
              </div>
            </form>
          </details>
        </div>

        {pairs.length === 0 ? (
          <p className="muted">Nenhum par cadastrado. Cadastre lojas e crie o primeiro par.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Nome</th><th>Vitrine</th><th>Checkout</th><th>Status</th><th /></tr>
              </thead>
              <tbody>
                {pairs.map((pair) => {
                  const front = stores.find((store) => store.id === pair.storefront_id);
                  const checkout = stores.find((store) => store.id === pair.checkout_id);
                  return (
                    <tr key={pair.id}>
                      <td><strong>{pair.name}</strong></td>
                      <td>{front?.name ?? "—"}</td>
                      <td>{checkout?.name ?? "—"}</td>
                      <td><StatusBadge status={pair.status} /></td>
                      <td><Link href={`/admin/pairs/${pair.id}`}>Gerenciar</Link></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
