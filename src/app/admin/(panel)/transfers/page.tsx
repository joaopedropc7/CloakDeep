import Link from "next/link";
import { listRecentTransfers } from "@/lib/db/transfers";
import { StatusBadge } from "@/components/ui";
import { formatMoney } from "@/lib/money";
import { destinationLabel } from "@/lib/domain/mapping-rules";
import { getSelectedIntegration, getStoreById, getStoresForIntegration } from "@/lib/db/stores";

export const dynamic = "force-dynamic";

export default async function TransfersPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const params = await searchParams;
  const page = Math.max(0, Math.min(1000, Number.parseInt(params.page ?? "0", 10) || 0));
  const pageSize = 25;
  const integration = await getSelectedIntegration();
  const storesInIntegration = integration ? await getStoresForIntegration(integration.id) : [];
  const rows = await listRecentTransfers(pageSize + 1, integration?.id, page * pageSize);
  const hasNext = rows.length > pageSize;
  const transfers = rows.slice(0, pageSize);
  const storeIds = new Set(transfers.map((transfer) => transfer.store_b_id));
  const stores = new Map(
    (await Promise.all([...storeIds].map((id) => getStoreById(id))))
      .filter((store): store is NonNullable<typeof store> => Boolean(store))
      .map((store) => [store.id, store]),
  );

  return (
    <div className="stack">
      <div className="panel">
        <div className="panel-header">
          <div>
            <h1>Transferências</h1>
            <p className="muted" style={{ margin: 0 }}>
              {integration ? `Integração: ${integration.name}. ` : ""}
              Registro operacional sem dados pessoais. Os itens, valores e a loja responsável
              pela venda aparecem abaixo.
            </p>
          </div>
          <Link href="/admin/mappings" className="button button-secondary">
            Mapeamentos
          </Link>
        </div>
      </div>

      <section className="panel">
        {transfers.length === 0 ? (
          <p className="muted">Nenhuma transferência registrada ainda.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Data</th>
                  <th>Destino</th>
                  <th>Itens</th>
                  <th>Subtotal</th>
                  <th>Status</th>
                  <th>Erro</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {transfers.map((transfer) => {
                  const store = stores.get(transfer.store_b_id);
                  return (
                    <tr key={transfer.id}>
                      <td>{new Date(transfer.created_at).toLocaleString("pt-BR")}</td>
                      <td>
                        {store ? (
                          <>
                            <strong>{store.name}</strong>
                            <div className="tiny muted">{destinationLabel(store)}</div>
                          </>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td>
                        {transfer.lines.map((line) => (
                          <div key={`${transfer.id}-${line.mappingId}`} className="small">
                            {line.quantity}× {line.bProductTitle}
                            {line.bVariantTitle ? ` — ${line.bVariantTitle}` : ""}
                          </div>
                        ))}
                      </td>
                      <td>{formatMoney(transfer.subtotal, transfer.currency)}</td>
                      <td>
                        <StatusBadge status={transfer.status} />
                        <div className="tiny muted">
                          expira {new Date(transfer.expires_at).toLocaleString("pt-BR")}
                        </div>
                      </td>
                      <td className="tiny mono">{transfer.error_code ?? "—"}</td>
                      <td>
                        <Link href={`/admin/transfers/${transfer.id}`}>Detalhes</Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <div className="row" style={{ marginTop: "1rem" }}>
          {page > 0 ? (
            <Link className="button button-secondary" href={`/admin/transfers?page=${page - 1}`}>
              Página anterior
            </Link>
          ) : null}
          {hasNext ? (
            <Link className="button button-secondary" href={`/admin/transfers?page=${page + 1}`}>
              Próxima página
            </Link>
          ) : null}
          <span className="tiny muted">Página {page + 1}</span>
        </div>
        {storesInIntegration.length === 0 && integration ? (
          <p className="tiny muted">Esta integração ainda não tem lojas configuradas.</p>
        ) : null}
      </section>
    </div>
  );
}
