import Link from "next/link";
import { notFound } from "next/navigation";
import { getTransferById } from "@/lib/db/transfers";
import { getStoreById } from "@/lib/db/stores";
import { destinationLabel } from "@/lib/domain/mapping-rules";
import { formatMoney } from "@/lib/money";
import { StatusBadge } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function TransferDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const transfer = await getTransferById(id);
  if (!transfer) notFound();
  const [storeA, storeB] = await Promise.all([
    getStoreById(transfer.store_a_id),
    getStoreById(transfer.store_b_id),
  ]);

  return (
    <div className="stack">
      <div className="panel">
        <div className="panel-header">
          <div>
            <Link href="/admin/transfers" className="small">
              ← Voltar às transferências
            </Link>
            <h1 style={{ marginTop: "0.5rem" }}>Transferência</h1>
            <p className="muted mono small" style={{ margin: 0 }}>{transfer.id}</p>
          </div>
          <StatusBadge status={transfer.status} />
        </div>
        <div className="grid-3">
          <div className="kpi">
            <span className="muted small">Criada</span>
            <strong style={{ fontSize: "0.95rem" }}>{new Date(transfer.created_at).toLocaleString("pt-BR")}</strong>
          </div>
          <div className="kpi">
            <span className="muted small">Expira</span>
            <strong style={{ fontSize: "0.95rem" }}>{new Date(transfer.expires_at).toLocaleString("pt-BR")}</strong>
          </div>
          <div className="kpi">
            <span className="muted small">Subtotal</span>
            <strong style={{ fontSize: "1.2rem" }}>{formatMoney(transfer.subtotal, transfer.currency)}</strong>
          </div>
        </div>
      </div>

      <div className="grid-2">
        <section className="panel">
          <h2>Origem</h2>
          <p><strong>{storeA?.name ?? "Loja A removida"}</strong></p>
          <p className="small muted">{storeA?.shop_domain ?? "—"}</p>
        </section>
        <section className="panel">
          <h2>Destino</h2>
          <p><strong>{storeB?.name ?? "Loja B removida"}</strong></p>
          <p className="small muted">{storeB ? destinationLabel(storeB) : "—"}</p>
        </section>
      </div>

      <section className="panel">
        <h2>Itens</h2>
        {transfer.lines.map((line) => (
          <div className="line-item" key={`${line.mappingId}-${line.bVariantExternalId}`}>
            <div>
              <strong>{line.aProductTitle}</strong>
              <div className="small muted">
                {line.aVariantTitle ?? "Padrão"} · {line.quantity}× · SKU {line.aSku ?? "—"}
              </div>
              <div className="tiny muted">Destino: {line.bProductTitle} — {line.bVariantTitle ?? "Padrão"}</div>
            </div>
            <div className="line-total">{formatMoney(line.unitPriceB, line.currency)}</div>
          </div>
        ))}
        <div className="total-row">
          <span>Subtotal</span>
          <span>{formatMoney(transfer.subtotal, transfer.currency)}</span>
        </div>
      </section>

      {transfer.error_code || transfer.error_detail ? (
        <section className="panel">
          <h2>Erro</h2>
          <p className="mono small">{transfer.error_code ?? "—"}</p>
          {transfer.error_detail ? <pre className="code-block">{transfer.error_detail}</pre> : null}
        </section>
      ) : null}

      {transfer.checkout_url ? (
        <section className="panel">
          <h2>Checkout criado</h2>
          <p className="small break mono">{transfer.checkout_url}</p>
        </section>
      ) : null}

      <section className="panel">
        <h2>Atribuição</h2>
        {Object.keys(transfer.attribution).length === 0 ? (
          <p className="muted small">Nenhum parâmetro de campanha transferido.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <tbody>
                {Object.entries(transfer.attribution).map(([key, value]) => (
                  <tr key={key}><th>{key}</th><td className="mono break">{value}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="tiny muted">Consentimento de atribuição: {transfer.attribution_consent ? "sim" : "não"}.</p>
      </section>
    </div>
  );
}
