import Link from "next/link";
import { getSelectedIntegration, getStoreByRole } from "@/lib/db/stores";
import { catalogStats } from "@/lib/db/catalog";
import { mappingStats } from "@/lib/db/mappings";
import { listRecentTransfers, publicTransferStatus } from "@/lib/db/transfers";
import { getThemeInstallation } from "@/lib/db/theme-installations";
import { StatusBadge, Check, Notice } from "@/components/ui";
import { formatMoney } from "@/lib/money";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const [storeA, storeB, pair] = await Promise.all([
    getStoreByRole("a"),
    getStoreByRole("b"),
    getSelectedIntegration(),
  ]);
  const transfers = await listRecentTransfers(8, pair?.id);
  const mappings = await mappingStats(pair?.id);
  const themeInstall = storeA ? await getThemeInstallation(storeA.id) : null;
  const [catalogA, catalogB] = await Promise.all([
    storeA ? catalogStats(storeA.id) : Promise.resolve({ products: 0, variants: 0 }),
    storeB?.platform === "shopify" ? catalogStats(storeB.id) : Promise.resolve({ products: 0, variants: 0 }),
  ]);

  const storeBReady = Boolean(storeB && storeB.status === "active");
  const checklist = [
    { done: Boolean(storeA && storeA.status === "active"), label: "Loja A (Shopify) conectada por OAuth" },
    { done: Boolean(storeB && storeB.status === "active"), label: "Loja B configurada" },
    { done: storeBReady, label: "Destino pronto para checkout" },
    { done: catalogA.products > 0, label: "Catálogo da Loja A importado" },
    {
      done: storeB?.platform === "external" || catalogB.products > 0,
      label: "Catálogo da Loja B importado (quando Shopify)",
    },
    { done: mappings.active > 0, label: "Ao menos um mapeamento ativo" },
    { done: themeInstall?.status === "installed", label: "Código da integração instalado no tema da Loja A" },
  ];

  return (
    <div className="stack">
      <div className="panel">
        <div className="panel-header">
          <div>
            <h1>Visão geral</h1>
            <p className="muted" style={{ margin: 0 }}>
              Estado da integração, catálogo e transferências recentes.
            </p>
          </div>
          <Link className="button" href="/admin/stores">
            Configurar lojas
          </Link>
        </div>
        {mappings.needsReview > 0 ? (
          <Notice tone="warning">
            {mappings.needsReview} mapeamento(s) precisam de revisão porque produto, variante,
            preço ou disponibilidade mudaram. A transferência desses itens está bloqueada.
          </Notice>
        ) : null}
        <div className="grid-3">
          <div className="kpi">
            <span className="muted small">Mapeamentos ativos</span>
            <strong>{mappings.active}</strong>
          </div>
          <div className="kpi">
            <span className="muted small">Em revisão</span>
            <strong>{mappings.needsReview}</strong>
          </div>
          <div className="kpi">
            <span className="muted small">Variantes Loja A / B</span>
            <strong>
              {catalogA.variants} / {storeB?.platform === "shopify" ? catalogB.variants : "n/a"}
            </strong>
          </div>
        </div>
      </div>

      <div className="grid-2">
        <section className="panel">
          <h2>Checklist</h2>
          <ul className="checklist">
            {checklist.map((item) => (
              <li key={item.label}>
                <Check done={item.done} />
                <span>{item.label}</span>
              </li>
            ))}
          </ul>
          <p className="footer-note">
            A integração é feita por <strong>código no tema</strong> da Loja A. Abra a loja em
            <strong> Lojas</strong> para instalar/restaurar o tema e ver o status.
          </p>
        </section>

        <section className="panel">
          <h2>Lojas</h2>
          <div className="stack-sm">
            <div>
              <strong>Loja A</strong>
              <div className="muted small">
                {storeA
                  ? `${storeA.name} · ${storeA.shop_domain ?? "sem domínio"} · ${storeA.currency ?? "moeda?"}`
                  : "Ainda não conectada"}
              </div>
              {storeA ? <StatusBadge status={storeA.status} /> : null}
            </div>
            <hr />
            <div>
              <strong>Loja B</strong>
              <div className="muted small">
                {storeB
                  ? `${storeB.name} · ${storeB.platform === "shopify" ? storeB.shop_domain : storeB.external_base_url} · ${storeB.currency ?? "moeda?"}`
                  : "Ainda não configurada"}
              </div>
              {storeB ? (
                <div className="row">
                  <StatusBadge status={storeB.status} />
                  <span className="badge">{storeB.platform === "shopify" ? "Shopify" : "Site externo"}</span>
                </div>
              ) : null}
            </div>
          </div>
          <div className="row" style={{ marginTop: "1rem" }}>
            <Link className="button button-secondary" href="/admin/stores">
              Gerenciar lojas
            </Link>
            <Link className="button button-secondary" href="/admin/mappings">
              Mapear produtos
            </Link>
          </div>
        </section>
      </div>

      <section className="panel">
        <div className="panel-header">
          <h2>Transferências recentes</h2>
          <Link href="/admin/transfers">Ver todas</Link>
        </div>
        {transfers.length === 0 ? (
          <p className="muted">Nenhuma transferência registrada ainda.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Data</th>
                  <th>Itens</th>
                  <th>Subtotal</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {transfers.map((transfer) => (
                  <tr key={transfer.id}>
                    <td>{new Date(transfer.created_at).toLocaleString("pt-BR")}</td>
                    <td>{transfer.lines.length}</td>
                    <td>{formatMoney(transfer.subtotal, transfer.currency)}</td>
                    <td>
                      <StatusBadge status={transfer.status} />
                      <div className="tiny muted">{publicTransferStatus(transfer.status)}</div>
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
