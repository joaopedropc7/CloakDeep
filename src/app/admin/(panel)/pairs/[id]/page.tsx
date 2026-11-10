import Link from "next/link";
import { notFound } from "next/navigation";
import {
  deleteIntegrationAction,
  renameIntegrationAction,
  selectIntegrationAction,
  setIntegrationStatusAction,
} from "@/app/admin/actions";
import { getIntegrationById, getStoreById } from "@/lib/db/stores";
import { SubmitButton } from "@/components/submit-button";
import { Notice, StatusBadge } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function PairDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const pair = await getIntegrationById(id);
  if (!pair) notFound();
  const [storefront, checkout] = await Promise.all([
    getStoreById(pair.storefront_id),
    getStoreById(pair.checkout_id),
  ]);

  return (
    <div className="stack">
      <div className="panel">
        <div className="panel-header">
          <div>
            <Link href="/admin/pairs" className="small">← Voltar para pares</Link>
            <h1 style={{ marginTop: "0.5rem" }}>{pair.name}</h1>
            <p className="muted small" style={{ margin: 0 }}>
              {storefront?.name ?? "Vitrine removida"} → {checkout?.name ?? "Checkout removido"}
            </p>
          </div>
          <StatusBadge status={pair.status} />
        </div>
        {query.saved ? <Notice tone="success">{query.saved}</Notice> : null}
        {query.error ? <Notice tone="danger">{query.error}</Notice> : null}
        {pair.status !== "active" ? (
          <Notice tone="warning">
            Este par não está ativo. Ative-o para liberar o checkout público desta vitrine.
          </Notice>
        ) : null}
      </div>

      <div className="grid-2">
        <section className="panel">
          <h2>Nome</h2>
          <form action={renameIntegrationAction} className="stack-sm">
            <input type="hidden" name="integration_id" value={pair.id} />
            <input name="name" type="text" defaultValue={pair.name} required aria-label="Nome do par" />
            <SubmitButton className="secondary" pendingLabel="Salvando...">Renomear par</SubmitButton>
          </form>
        </section>

        <section className="panel">
          <h2>Status</h2>
          <form action={setIntegrationStatusAction} className="stack-sm">
            <input type="hidden" name="integration_id" value={pair.id} />
            <select name="status" defaultValue={pair.status} aria-label="Status do par">
              <option value="draft">Rascunho</option>
              <option value="active">Ativo</option>
              <option value="disabled">Desativado</option>
            </select>
            <SubmitButton className="secondary" pendingLabel="Salvando...">Atualizar status</SubmitButton>
          </form>
        </section>
      </div>

      <section className="panel">
        <h2>Lojas do par</h2>
        <div className="grid-2">
          <div className="destination">
            <span className="badge">Vitrine</span>
            <strong>{storefront?.name ?? "—"}</strong>
            <span className="small mono">{storefront?.shop_domain ?? "—"}</span>
          </div>
          <div className="destination">
            <span className="badge">Checkout</span>
            <strong>{checkout?.name ?? "—"}</strong>
            <span className="small mono">
              {checkout?.platform === "external" ? checkout.external_base_url : checkout?.shop_domain ?? "—"}
            </span>
          </div>
        </div>
        <div className="row" style={{ marginTop: "1rem" }}>
          <form action={selectIntegrationAction}>
            <input type="hidden" name="integration_id" value={pair.id} />
            <input type="hidden" name="return_to" value="/admin/mappings" />
            <SubmitButton className="secondary" pendingLabel="Selecionando...">Usar este par nos mapeamentos</SubmitButton>
          </form>
          <Link className="button button-secondary" href="/admin/mappings">Ver mapeamentos</Link>
        </div>
      </section>

      <section className="panel">
        <h2>Excluir par</h2>
        <p className="small muted">Exclui o par e seus mapeamentos. As lojas continuam cadastradas.</p>
        <form action={deleteIntegrationAction} className="row">
          <input type="hidden" name="integration_id" value={pair.id} />
          <input name="confirm" placeholder="Digite EXCLUIR" style={{ flex: 1 }} aria-label="Confirmação de exclusão" />
          <SubmitButton className="danger" pendingLabel="Excluindo...">Excluir par</SubmitButton>
        </form>
      </section>
    </div>
  );
}
