import Link from "next/link";
import { listStores } from "@/lib/db/stores";
import { catalogStats, getLatestSyncRun, listVariantsWithProduct } from "@/lib/db/catalog";
import { importCatalogAction } from "@/app/admin/actions";
import { SubmitButton } from "@/components/submit-button";
import { Notice, StatusBadge } from "@/components/ui";
import { formatMoney } from "@/lib/money";
import type { CatalogVariantWithProduct } from "@/lib/db/catalog";
import type { StoreRow } from "@/lib/db/types";

export const dynamic = "force-dynamic";

type SearchParams = Promise<{
  store?: string;
  q?: string;
  saved?: string;
  error?: string;
}>;

export default async function ProductsPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const stores = await listStores();
  const selectedStore = stores.find((store) => store.id === params.store) ?? stores[0] ?? null;
  const q = (params.q ?? "").trim().toLowerCase();

  const [stats, lastSync, variants] = selectedStore
    ? await Promise.all([
        catalogStats(selectedStore.id),
        getLatestSyncRun(selectedStore.id),
        selectedStore.platform === "shopify"
          ? listVariantsWithProduct(selectedStore.id, 500)
          : Promise.resolve([]),
      ])
    : [
        { products: 0, variants: 0 },
        null,
        [] as CatalogVariantWithProduct[],
      ];

  const filtered = q
    ? variants.filter((variant) =>
        [
          variant.product.title,
          variant.product.handle,
          variant.title,
          variant.sku,
          variant.external_id,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(q),
      )
    : variants;

  return (
    <div className="stack">
      <div className="panel">
        <div className="panel-header">
          <div>
            <h1>Produtos e variantes</h1>
            <p className="muted" style={{ margin: 0 }}>
              Escolha uma loja para ver o catálogo importado. Cada loja tem seu próprio
              snapshot; nenhuma listagem mistura vitrine e checkout.
            </p>
          </div>
          <Link className="button button-secondary" href="/admin/mappings">
            Ir para mapeamentos
          </Link>
        </div>
        {params.saved ? <Notice tone="success">{params.saved}</Notice> : null}
        {params.error ? <Notice tone="danger">{params.error}</Notice> : null}

        {stores.length === 0 ? (
          <Notice tone="warning">
            Nenhuma loja cadastrada. <Link href="/admin/stores">Cadastre uma loja</Link>.
          </Notice>
        ) : (
          <form method="get" className="row">
            <select name="store" defaultValue={selectedStore?.id ?? ""} aria-label="Filtrar produtos por loja" style={{ flex: 1 }}>
              {stores.map((store) => (
                <option key={store.id} value={store.id}>
                  {store.name} · {store.store_type === "storefront" ? "Vitrine" : "Checkout"} ·{" "}
                  {store.platform === "shopify" ? "Shopify" : "Externo"}
                </option>
              ))}
            </select>
            {q ? <input type="hidden" name="q" value={params.q ?? ""} /> : null}
            <button type="submit" className="secondary">Filtrar loja</button>
          </form>
        )}
      </div>

      {selectedStore ? (
        <>
          <StoreCatalogPanel store={selectedStore} stats={stats} lastSync={lastSync?.started_at ?? null} />

          {selectedStore.platform === "shopify" ? (
            <>
              <section className="panel">
                <div className="panel-header">
                  <div>
                    <h2>Variantes de {selectedStore.name}</h2>
                    <p className="small muted" style={{ margin: 0 }}>
                      {filtered.length} exibida(s) de {variants.length} importada(s)
                      {q ? ` para “${params.q}”` : ""}.
                    </p>
                  </div>
                  <form method="get" className="row">
                    <input type="hidden" name="store" value={selectedStore.id} />
                    <input
                      type="search"
                      name="q"
                      defaultValue={params.q ?? ""}
                      placeholder="Produto, variante, SKU ou ID"
                      aria-label="Buscar variantes da loja"
                    />
                    <button type="submit" className="secondary">Buscar</button>
                    {q ? <Link href={`/admin/products?store=${selectedStore.id}`}>Limpar</Link> : null}
                  </form>
                </div>
              </section>

              {filtered.length > 0 ? (
                <VariantsTable variants={filtered} />
              ) : (
                <section className="panel">
                  <p className="muted">
                    {q
                      ? "Nenhuma variante corresponde à busca."
                      : "Nenhuma variante importada ainda. Use “Importar agora” acima."}
                  </p>
                </section>
              )}
            </>
          ) : (
            <section className="panel">
              <h2>Catálogo externo</h2>
              <p className="muted">
                Lojas checkout externas não têm catálogo importado. Os produtos são mapeados
                manualmente com URL, título, variante, SKU, preço e moeda na página de mapeamentos.
              </p>
              <Link className="button button-secondary" href="/admin/mappings">
                Ir para mapeamentos
              </Link>
            </section>
          )}
        </>
      ) : null}
    </div>
  );
}

function StoreCatalogPanel({
  store,
  stats,
  lastSync,
}: {
  store: StoreRow;
  stats: { products: number; variants: number };
  lastSync: string | null;
}) {
  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <div className="row" style={{ marginBottom: "0.35rem" }}>
            <span className="badge">{store.store_type === "storefront" ? "Vitrine" : "Checkout"}</span>
            <span className="badge">{store.platform === "shopify" ? "Shopify" : "Externo"}</span>
            <StatusBadge status={store.status} />
          </div>
          <h2>{store.name}</h2>
          <p className="small muted" style={{ margin: 0 }}>
            {store.shop_domain ?? store.external_base_url ?? "sem domínio"} ·{" "}
            {store.currency ?? "moeda não informada"}
          </p>
        </div>
        {store.platform === "shopify" ? (
          <form action={importCatalogAction}>
            <input type="hidden" name="store_id" value={store.id} />
            <SubmitButton pendingLabel="Importando catálogo...">Importar agora</SubmitButton>
          </form>
        ) : null}
      </div>
      {store.platform === "shopify" ? (
        <p className="small" style={{ margin: 0 }}>
          <strong>{stats.products}</strong> produtos · <strong>{stats.variants}</strong> variantes
          {lastSync ? ` · última importação ${new Date(lastSync).toLocaleString("pt-BR")}` : ""}
        </p>
      ) : (
        <p className="small muted" style={{ margin: 0 }}>
          Catálogo externo: os dados são informados no mapeamento de cada produto.
        </p>
      )}
    </section>
  );
}

function VariantsTable({ variants }: { variants: CatalogVariantWithProduct[] }) {
  return (
    <section className="panel">
      {variants.length >= 500 ? (
        <p className="tiny muted">
          Exibindo as primeiras 500 variantes. Refine a busca para localizar itens específicos.
        </p>
      ) : null}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Produto</th>
              <th>Variante</th>
              <th>SKU</th>
              <th>Preço</th>
              <th>Disponível</th>
              <th>ID externo</th>
            </tr>
          </thead>
          <tbody>
            {variants.map((variant) => (
              <tr key={variant.id}>
                <td>
                  <strong>{variant.product.title}</strong>
                  <div className="tiny muted">{variant.product.handle}</div>
                </td>
                <td>{variant.title ?? "Padrão"}</td>
                <td className="mono">{variant.sku ?? "—"}</td>
                <td>{formatMoney(variant.price_amount, variant.currency)}</td>
                <td>{variant.available_for_sale ? "Sim" : "Não"}</td>
                <td className="mono tiny break">{variant.external_id}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
