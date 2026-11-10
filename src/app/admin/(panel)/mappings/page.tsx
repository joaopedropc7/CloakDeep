import Link from "next/link";
import { getSelectedIntegration, getStoreByRole, listIntegrations, listStores } from "@/lib/db/stores";
import { getVariantWithProduct, listVariantsWithProduct } from "@/lib/db/catalog";
import { getMappingByAVariantId, listMappingsWithDetails } from "@/lib/db/mappings";
import type { CatalogVariantWithProduct } from "@/lib/db/catalog";
import type { StoreRow } from "@/lib/db/types";
import {
  compareExternalTarget,
  compareShopifyVariants,
  validateExternalUrl,
} from "@/lib/domain/mapping-rules";
import { formatMoney, normalizeAmount, priceDifference } from "@/lib/money";
import { activateMappingAction, autoMapBySkuAction, deactivateMappingAction, selectIntegrationAction } from "@/app/admin/actions";
import { SubmitButton } from "@/components/submit-button";
import { Notice, StatusBadge } from "@/components/ui";
import { isProduction } from "@/lib/env";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function one(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function searchText(variant: CatalogVariantWithProduct): string {
  return [
    variant.product.title,
    variant.product.handle,
    variant.title,
    variant.sku,
    variant.external_id,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export default async function MappingsPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const aId = one(params.a);
  const bId = one(params.b);
  const q = one(params.q).trim();
  const error = one(params.error);
  const saved = one(params.saved);
  const statusFilter = one(params.status);
  const filterStorefront = one(params.storefront);
  const filterCheckout = one(params.checkout);

  const [storeA, storeB, pair, integrations, allStores] = await Promise.all([
    getStoreByRole("a"),
    getStoreByRole("b"),
    getSelectedIntegration(),
    listIntegrations(),
    listStores(),
  ]);
  if (!storeA || storeA.status !== "active") {
    return (
      <div className="panel">
        <h1>Mapeamentos</h1>
        <Notice tone="warning">Conecte a Loja A e importe o catálogo antes de mapear.</Notice>
        <Link className="button" href="/admin/stores">
          Configurar lojas
        </Link>
      </div>
    );
  }
  if (!storeB || storeB.status !== "active") {
    return (
      <div className="panel">
        <h1>Mapeamentos</h1>
        <Notice tone="warning">Configure a Loja B antes de mapear produtos.</Notice>
        <Link className="button" href="/admin/stores">
          Configurar Loja B
        </Link>
      </div>
    );
  }

  const [variantsA, variantsB, mappings] = await Promise.all([
    listVariantsWithProduct(storeA.id, 1000),
    storeB.platform === "shopify" ? listVariantsWithProduct(storeB.id, 1000) : Promise.resolve([]),
    listMappingsWithDetails(
      300,
      filterStorefront || filterCheckout ? undefined : pair?.id,
      filterStorefront || undefined,
      filterCheckout || undefined,
    ),
  ]);

  const externalKeys = [
    "external_product_url",
    "external_product_title",
    "external_variant_title",
    "external_sku",
    "external_price",
    "external_currency",
  ];
  const externalParams: Record<string, string> = {};
  for (const key of externalKeys) {
    const value = one(params[key]);
    if (value) externalParams[key] = value;
  }

  const mappingByA = new Map(mappings.map((mapping) => [mapping.store_a_variant_id, mapping]));
  const filteredMappings = statusFilter
    ? mappings.filter((mapping) => mapping.status === statusFilter)
    : mappings;
  const statusCounts = {
    all: mappings.length,
    draft: mappings.filter((mapping) => mapping.status === "draft").length,
    needs_review: mappings.filter((mapping) => mapping.status === "needs_review").length,
    active: mappings.filter((mapping) => mapping.status === "active").length,
    disabled: mappings.filter((mapping) => mapping.status === "disabled").length,
  };
  const listSelectedA = aId ? variantsA.find((variant) => variant.id === aId) ?? null : null;
  const rawSelectedA = listSelectedA ?? (aId ? await getVariantWithProduct(aId) : null);
  const selectedA =
    rawSelectedA && rawSelectedA.store_id === storeA.id && rawSelectedA.is_current
      ? rawSelectedA
      : null;
  const existingMapping = selectedA ? await getMappingByAVariantId(selectedA.id, pair?.id) : null;
  const listSelectedB =
    bId && storeB.platform === "shopify"
      ? variantsB.find((variant) => variant.id === bId) ?? null
      : null;
  const rawSelectedB =
    listSelectedB ??
    (bId && storeB.platform === "shopify" ? await getVariantWithProduct(bId) : null);
  const selectedB =
    rawSelectedB && rawSelectedB.store_id === storeB.id && rawSelectedB.is_current
      ? rawSelectedB
      : null;

  return (
    <div className="stack">
      <div className="panel">
        <div className="panel-header">
          <div>
            <h1>Mapeamentos</h1>
            <p className="muted" style={{ margin: 0 }}>
              Cada variante da Loja A deve apontar para a mesma variante real na Loja B. Preço,
              moeda e identificação são exibidos antes da ativação.
            </p>
          </div>
          <div className="row">
            {storeB.platform === "shopify" ? (
              <form action={autoMapBySkuAction}>
                <SubmitButton className="secondary" pendingLabel="Mapeando...">
                  Auto-mapear por SKU
                </SubmitButton>
              </form>
            ) : null}
            <Link className="button button-secondary" href="/admin/products">
              Ver catálogo
            </Link>
          </div>
        </div>
        {saved ? <Notice tone="success">{saved}</Notice> : null}
        {error ? <Notice tone="danger">{error}</Notice> : null}
        <form action={selectIntegrationAction} className="row" style={{ marginBottom: "0.75rem" }}>
          <input type="hidden" name="return_to" value="/admin/mappings" />
          <select name="integration_id" defaultValue={pair?.id ?? ""} aria-label="Filtrar mapeamentos por par" style={{ flex: 1 }}>
            {integrations.map((integration) => (
              <option key={integration.id} value={integration.id}>
                {integration.name} ({integration.status})
              </option>
            ))}
          </select>
          <SubmitButton className="secondary" pendingLabel="Filtrando...">Filtrar por par/lojas</SubmitButton>
        </form>
        <form method="get" className="row" style={{ marginBottom: "0.75rem" }}>
          {statusFilter ? <input type="hidden" name="status" value={statusFilter} /> : null}
          <select name="storefront" defaultValue={filterStorefront} aria-label="Filtrar por loja vitrine" style={{ flex: 1 }}>
            <option value="">Todas as vitrines</option>
            {allStores.filter((store) => store.store_type === "storefront").map((store) => (
              <option key={store.id} value={store.id}>{store.name}</option>
            ))}
          </select>
          <select name="checkout" defaultValue={filterCheckout} aria-label="Filtrar por loja checkout" style={{ flex: 1 }}>
            <option value="">Todos os checkouts</option>
            {allStores.filter((store) => store.store_type === "checkout").map((store) => (
              <option key={store.id} value={store.id}>{store.name}</option>
            ))}
          </select>
          <button type="submit" className="secondary">Filtrar por loja</button>
          {filterStorefront || filterCheckout ? <Link href="/admin/mappings">Limpar</Link> : null}
        </form>
        {pair && pair.status !== "active" ? (
          <Notice tone="warning">
            Este par está <strong>{pair.status}</strong>. Apenas um par ativo por vitrine atende
            o checkout público.
          </Notice>
        ) : null}
        <div className="row" style={{ marginTop: "0.5rem" }}>
          {[
            { key: "", label: "Todos", count: statusCounts.all },
            { key: "needs_review", label: "Em revisão", count: statusCounts.needs_review },
            { key: "draft", label: "Rascunhos", count: statusCounts.draft },
            { key: "active", label: "Ativos", count: statusCounts.active },
            { key: "disabled", label: "Desativados", count: statusCounts.disabled },
          ].map((tab) => (
            <Link
              key={tab.key || "all"}
              href={tab.key ? `/admin/mappings?status=${tab.key}` : "/admin/mappings"}
              className={`badge ${statusFilter === tab.key ? "badge-success" : ""}`}
            >
              {tab.label} · {tab.count}
            </Link>
          ))}
        </div>
        <p className="tiny muted" style={{ marginTop: "0.5rem" }}>
          O auto-mapeamento cria rascunhos por SKU exato e único. Nenhum item é ativado sem revisão.
        </p>
      </div>

      {selectedA ? (
        <MappingEditor
          storeA={storeA}
          storeB={storeB}
          aVariant={selectedA}
          variantsB={variantsB}
          selectedB={selectedB}
          existing={existingMapping}
          externalParams={externalParams}
        />
      ) : (
        <div className="grid-2">
          <section className="panel">
            <h2>Escolha a variante da Loja A</h2>
            <form method="get" className="row" style={{ marginBottom: "0.75rem" }}>
              <input
                type="search"
                name="q"
                defaultValue={q}
                placeholder="Buscar por produto, variante, SKU ou ID"
                aria-label="Buscar variantes da Loja A"
                style={{ flex: 1 }}
              />
              <button type="submit" className="secondary">
                Buscar
              </button>
            </form>
            <p className="tiny muted">
              {variantsA.length} variantes importadas. Exibindo até 200 resultados.
            </p>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Produto / variante</th>
                    <th>Preço</th>
                    <th>Mapeamento</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {variantsA
                    .filter((variant) => !q || searchText(variant).includes(q.toLowerCase()))
                    .slice(0, 200)
                    .map((variant) => {
                      const mapping = mappingByA.get(variant.id);
                      return (
                        <tr key={variant.id}>
                          <td>
                            <strong>{variant.product.title}</strong>
                            <div className="small">{variant.title ?? "Padrão"}</div>
                            <div className="tiny muted mono">{variant.sku ?? "sem SKU"}</div>
                          </td>
                          <td>{formatMoney(variant.price_amount, variant.currency)}</td>
                          <td>
                            {mapping ? <StatusBadge status={mapping.status} /> : <span className="badge">Sem mapa</span>}
                          </td>
                          <td>
                            <Link href={`/admin/mappings?a=${variant.id}`}>Mapear</Link>
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
            {variantsA.length === 0 ? (
              <p className="muted">
                Nenhuma variante importada. <Link href="/admin/products">Importe o catálogo</Link>.
              </p>
            ) : null}
          </section>

          <section className="panel">
            <h2>Mapeamentos existentes</h2>
            {filteredMappings.length === 0 ? (
              <p className="muted">Nenhum mapeamento neste filtro.</p>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Loja A</th>
                      <th>Loja B</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredMappings.slice(0, 100).map((mapping) => (
                      <tr key={mapping.id}>
                        <td>
                          <strong>{mapping.a_variant.product.title}</strong>
                          <div className="tiny muted">{mapping.a_variant.title}</div>
                          <div className="tiny">{formatMoney(mapping.price_a, mapping.currency_a)}</div>
                        </td>
                        <td>
                          {mapping.mode === "shopify" && mapping.b_variant ? (
                            <>
                              <strong>{mapping.b_variant.product.title}</strong>
                              <div className="tiny muted">{mapping.b_variant.title}</div>
                            </>
                          ) : (
                            <>
                              <strong>{mapping.external_product_title}</strong>
                              <div className="tiny muted">{mapping.external_variant_title}</div>
                            </>
                          )}
                          <div className="tiny">{formatMoney(mapping.price_b, mapping.currency_b)}</div>
                        </td>
                        <td>
                          <StatusBadge status={mapping.status} />
                          <div style={{ marginTop: "0.35rem" }}>
                            <Link href={`/admin/mappings?a=${mapping.store_a_variant_id}`}>Revisar</Link>
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
      )}
    </div>
  );
}

function MappingEditor({
  storeA,
  storeB,
  aVariant,
  variantsB,
  selectedB,
  existing,
  externalParams,
}: {
  storeA: StoreRow;
  storeB: StoreRow;
  aVariant: CatalogVariantWithProduct;
  variantsB: CatalogVariantWithProduct[];
  selectedB: CatalogVariantWithProduct | null;
  existing: Awaited<ReturnType<typeof getMappingByAVariantId>>;
  externalParams: Record<string, string>;
}) {
  const baseParams = new URLSearchParams();
  baseParams.set("a", aVariant.id);

  const comparison =
    storeB.platform === "shopify" && selectedB
      ? compareShopifyVariants(aVariant, selectedB)
      : null;

  return (
    <div className="stack">
      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>Conferir correspondência</h2>
            <p className="muted small" style={{ margin: 0 }}>
              Compare produto, variante, SKU, opções, preço e moeda antes de ativar.
            </p>
          </div>
          <Link className="button button-secondary" href="/admin/mappings">
            Trocar variante A
          </Link>
        </div>

        <div className="grid-2">
          <div className="destination">
            <span className="badge">Loja A</span>
            <strong style={{ marginTop: "0.5rem" }}>{aVariant.product.title}</strong>
            <div className="small">{aVariant.title ?? "Padrão"}</div>
            <div className="small muted">SKU: {aVariant.sku ?? "—"}</div>
            <div className="small">Opções: {formatOptions(aVariant)}</div>
            <div style={{ marginTop: "0.5rem", fontWeight: 700 }}>
              {formatMoney(aVariant.price_amount, aVariant.currency)}
            </div>
            <div className="tiny muted">
              {aVariant.available_for_sale ? "Disponível" : "Indisponível"} ·{" "}
              {storeA.shop_domain}
            </div>
          </div>
          <div className="destination">
            <span className="badge">Loja B</span>
            {storeB.platform === "shopify" ? (
              selectedB ? (
                <>
                  <strong style={{ marginTop: "0.5rem" }}>{selectedB.product.title}</strong>
                  <div className="small">{selectedB.title ?? "Padrão"}</div>
                  <div className="small muted">SKU: {selectedB.sku ?? "—"}</div>
                  <div className="small">Opções: {formatOptions(selectedB)}</div>
                  <div style={{ marginTop: "0.5rem", fontWeight: 700 }}>
                    {formatMoney(selectedB.price_amount, selectedB.currency)}
                  </div>
                  <div className="tiny muted">
                    {selectedB.available_for_sale ? "Disponível" : "Indisponível"} ·{" "}
                    {storeB.shop_domain}
                  </div>
                </>
              ) : (
                <p className="muted small" style={{ marginTop: "0.5rem" }}>
                  Selecione a variante correspondente da Loja B abaixo.
                </p>
              )
            ) : (
              <p className="muted small" style={{ marginTop: "0.5rem" }}>
                Destino externo: informe manualmente os dados do produto. O link será validado
                contra <code>{storeB.external_base_url}</code>.
              </p>
            )}
          </div>
        </div>

        {storeB.platform === "shopify" ? (
          <form method="get" className="form-grid" style={{ marginTop: "1rem" }}>
            <input type="hidden" name="a" value={aVariant.id} />
            <div className="full">
              <label htmlFor="b-variant">Variante da Loja B</label>
              <select id="b-variant" name="b" defaultValue={selectedB?.id ?? ""} required>
                <option value="">Selecione...</option>
                {groupByProduct(variantsB).map(([productTitle, variants]) => (
                  <optgroup key={productTitle} label={productTitle}>
                    {variants.map((variant) => (
                      <option key={variant.id} value={variant.id}>
                        {variant.title ?? "Padrão"} — {variant.sku ?? "sem SKU"} —{" "}
                        {formatMoney(variant.price_amount, variant.currency)}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
              {variantsB.length === 0 ? (
                <p className="tiny muted">
                  Nenhuma variante da Loja B importada. Importe o catálogo da Loja B primeiro.
                </p>
              ) : null}
            </div>
            <div className="full">
              <button type="submit" className="secondary" disabled={variantsB.length === 0}>
                Conferir diferenças
              </button>
            </div>
          </form>
        ) : (
          <>
            <ExternalTargetForm
              storeB={storeB}
              aVariant={aVariant}
              existing={existing}
              current={externalParams}
            />
            {externalParams.external_product_url ? (
              <div style={{ marginTop: "1rem" }}>
                <ExternalPreview
                  storeB={storeB}
                  aVariant={aVariant}
                  params={externalParams}
                  existing={existing}
                />
              </div>
            ) : null}
          </>
        )}
      </section>

      {comparison && selectedB ? (
        <ComparisonPanel
          title="Comparação antes da ativação"
          comparison={comparison}
          mode="shopify"
          aVariant={aVariant}
          bPrice={selectedB.price_amount}
          bCurrency={selectedB.currency}
          storeB={storeB}
          hiddenFields={{
            mode: "shopify",
            a_variant_id: aVariant.id,
            b_variant_id: selectedB.id,
          }}
          returnTo={`/admin/mappings?${baseParams.toString()}&b=${selectedB.id}`}
          existing={existing}
        />
      ) : null}
    </div>
  );
}

function ExternalTargetForm({
  storeB,
  aVariant,
  existing,
  current,
}: {
  storeB: StoreRow;
  aVariant: CatalogVariantWithProduct;
  existing: Awaited<ReturnType<typeof getMappingByAVariantId>>;
  current: Record<string, string>;
}) {
  return (
    <form method="get" className="form-grid" style={{ marginTop: "1rem" }}>
      <input type="hidden" name="a" value={aVariant.id} />
      <div className="full">
        <label htmlFor="external-product-url">URL do mesmo produto na Loja B</label>
        <input
          id="external-product-url"
          name="external_product_url"
          type="url"
          defaultValue={current.external_product_url ?? existing?.external_product_url ?? ""}
          placeholder={`${storeB.external_base_url}/produto`}
          required
        />
      </div>
      <div>
        <label htmlFor="external-product-title">Título do produto na Loja B</label>
        <input
          id="external-product-title"
          name="external_product_title"
          type="text"
          defaultValue={
            current.external_product_title ?? existing?.external_product_title ?? aVariant.product.title
          }
          required
        />
      </div>
      <div>
        <label htmlFor="external-variant-title">Variante na Loja B</label>
        <input
          id="external-variant-title"
          name="external_variant_title"
          type="text"
          defaultValue={
            current.external_variant_title ?? existing?.external_variant_title ?? aVariant.title ?? "Padrão"
          }
          required
        />
      </div>
      <div>
        <label htmlFor="external-sku">SKU na Loja B</label>
        <input
          id="external-sku"
          name="external_sku"
          type="text"
          defaultValue={current.external_sku ?? existing?.external_sku ?? aVariant.sku ?? ""}
        />
      </div>
      <div>
        <label htmlFor="external-price">Preço na Loja B</label>
        <input
          id="external-price"
          name="external_price"
          type="text"
          inputMode="decimal"
          defaultValue={current.external_price ?? existing?.price_b ?? ""}
          placeholder="199.90"
          required
        />
      </div>
      <div>
        <label htmlFor="external-currency">Moeda</label>
        <input
          id="external-currency"
          name="external_currency"
          type="text"
          maxLength={3}
          defaultValue={
            current.external_currency ?? existing?.currency_b ?? storeB.currency ?? aVariant.currency
          }
          required
        />
      </div>
      <div className="full">
        <button type="submit" className="secondary">
          Conferir diferenças
        </button>
      </div>
    </form>
  );
}

function ComparisonPanel({
  title,
  comparison,
  mode,
  aVariant,
  bPrice,
  bCurrency,
  storeB,
  hiddenFields,
  returnTo,
  existing,
  externalFields,
}: {
  title: string;
  comparison: ReturnType<typeof compareShopifyVariants>;
  mode: "shopify" | "external";
  aVariant: CatalogVariantWithProduct;
  bPrice: string;
  bCurrency: string;
  storeB: StoreRow;
  hiddenFields: Record<string, string>;
  returnTo: string;
  existing: Awaited<ReturnType<typeof getMappingByAVariantId>>;
  externalFields?: Record<string, string>;
}) {
  const diff = priceDifference(aVariant.price_amount, bPrice);
  const priceDifferent = !comparison.priceMatch;
  return (
    <section className="panel">
      <h2>{title}</h2>
      <div className="table-wrap" style={{ marginBottom: "1rem" }}>
        <table>
          <thead>
            <tr>
              <th>Critério</th>
              <th>Resultado</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Moeda</td>
              <td>
                {comparison.currencyMatch ? "Confere" : <span className="badge badge-danger">Divergente</span>}{" "}
                <span className="muted">
                  ({aVariant.currency} → {bCurrency})
                </span>
              </td>
            </tr>
            <tr>
              <td>Preço</td>
              <td>
                {comparison.priceMatch ? "Confere" : <span className="price-diff">Diferente</span>} ·{" "}
                {formatMoney(aVariant.price_amount, aVariant.currency)} →{" "}
                {formatMoney(bPrice, bCurrency)}
                {priceDifferent ? (
                  <span className="muted small">
                    {" "}
                    (diferença {formatMoney(diff.amount, bCurrency)} / {Number(diff.percent).toFixed(2)}%)
                  </span>
                ) : null}
              </td>
            </tr>
            <tr>
              <td>SKU</td>
              <td>{identityLabel(comparison.identity.sku)}</td>
            </tr>
            <tr>
              <td>Título do produto</td>
              <td>{comparison.identity.productTitle === "match" ? "Confere" : "Diferente"}</td>
            </tr>
            <tr>
              <td>Título da variante</td>
              <td>
                {comparison.identity.variantTitle === "match"
                  ? "Confere"
                  : comparison.identity.variantTitle === "missing"
                    ? "Sem título para conferir"
                    : "Diferente"}
              </td>
            </tr>
            <tr>
              <td>Opções</td>
              <td>
                {comparison.identity.options === "match"
                  ? "Confere"
                  : comparison.identity.options === "unknown"
                    ? "Conferência manual"
                    : "Diferente"}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      {comparison.warnings.length > 0 ? (
        <Notice tone="warning">
          <ul style={{ margin: 0, paddingLeft: "1.1rem" }}>
            {comparison.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </Notice>
      ) : (
        <Notice tone="success">Identificação, moeda e preço conferem.</Notice>
      )}
      {!comparison.currencyMatch ? (
        <Notice tone="danger">
          A ativação é bloqueada enquanto as moedas não forem iguais. Ajuste a moeda da Loja B
          ou do produto.
        </Notice>
      ) : null}
      <div className="destination" style={{ marginBottom: "1rem" }}>
        <strong>Responsável pela venda: {storeB.name}</strong>
        <span className="small">
          Destino: {storeB.platform === "shopify" ? storeB.shop_domain : storeB.external_base_url}. O
          comprador verá esta informação antes de sair da Loja A.
        </span>
      </div>
      <form action={activateMappingAction} className="stack-sm">
        <input type="hidden" name="return_to" value={returnTo} />
        <input type="hidden" name="mode" value={mode} />
        {Object.entries(hiddenFields).map(([key, value]) => (
          <input key={key} type="hidden" name={key} value={value} />
        ))}
        {externalFields
          ? Object.entries(externalFields).map(([key, value]) => (
              <input key={key} type="hidden" name={key} value={value} />
            ))
          : null}
        <label className="consent-box">
          <input
            type="checkbox"
            name="identity_ack"
            required
            defaultChecked={Boolean(existing?.identity_ack)}
          />
          <span>
            Confirmo que as duas variantes representam o <strong>mesmo produto real</strong>,
            com as mesmas opções e identificação.
          </span>
        </label>
        {priceDifferent ? (
          <label className="consent-box">
            <input
              type="checkbox"
              name="price_ack"
              required
              defaultChecked={Boolean(existing?.price_ack)}
            />
            <span>
              Confirmo a diferença de preço. O comprador verá os dois valores e pagará{" "}
              <strong>{formatMoney(bPrice, bCurrency)}</strong> na Loja B.
            </span>
          </label>
        ) : null}
        <div>
          <label htmlFor="mapping-notes">Observações internas (opcional, sem dados pessoais)</label>
          <textarea
            id="mapping-notes"
            name="notes"
            maxLength={500}
            defaultValue={existing?.notes ?? ""}
          />
        </div>
        {existing ? (
          <p className="tiny muted">
            Este mapeamento já existe com status <strong>{existing.status}</strong> e será
            substituído após a nova confirmação.
          </p>
        ) : null}
        <div className="row">
          <SubmitButton pendingLabel="Ativando...">Ativar mapeamento</SubmitButton>
        </div>
      </form>
      {existing ? (
        <form action={deactivateMappingAction} style={{ marginTop: "0.75rem" }}>
          <input type="hidden" name="mapping_id" value={existing.id} />
          <SubmitButton className="danger" pendingLabel="Desativando...">
            Desativar mapeamento atual
          </SubmitButton>
        </form>
      ) : null}
    </section>
  );
}

// External preview is rendered by this separate branch to keep the main editor
// component readable.
function ExternalPreview({
  storeB,
  aVariant,
  params,
  existing,
}: {
  storeB: StoreRow;
  aVariant: CatalogVariantWithProduct;
  params: Record<string, string>;
  existing: Awaited<ReturnType<typeof getMappingByAVariantId>>;
}) {
  const url = params.external_product_url ?? "";
  const title = params.external_product_title ?? "";
  const variantTitle = params.external_variant_title ?? "";
  const sku = params.external_sku ?? "";
  const priceRaw = params.external_price ?? "";
  const currency = (params.external_currency ?? "").toUpperCase();

  let comparison: ReturnType<typeof compareExternalTarget> | null = null;
  let price = "";
  let validationError: string | null = null;
  try {
    validateExternalUrl(storeB.external_base_url ?? "", url, {
      allowHttp: (storeB.external_base_url ?? "").startsWith("http://") && !isProduction(),
    });
    if (!/^[A-Z]{3}$/.test(currency)) throw new Error("Moeda inválida.");
    price = normalizeAmount(priceRaw.replace(",", "."));
    comparison = compareExternalTarget(
      aVariant,
      { url, title, variantTitle, sku, price, currency },
      storeB.currency ?? currency,
    );
  } catch (error) {
    validationError = error instanceof Error ? error.message : "Dados inválidos.";
  }

  if (validationError || !comparison) {
    return (
      <Notice tone="danger">
        {validationError ?? "Preencha os dados do destino externo para conferir."}
      </Notice>
    );
  }

  const hidden: Record<string, string> = {
    external_product_url: url,
    external_product_title: title,
    external_variant_title: variantTitle,
    external_sku: sku,
    external_price: price,
    external_currency: currency,
  };
  const returnParams = new URLSearchParams({ a: aVariant.id, ...params });
  return (
    <ComparisonPanel
      title="Comparação com o site externo"
      comparison={comparison}
      mode="external"
      aVariant={aVariant}
      bPrice={price}
      bCurrency={currency}
      storeB={storeB}
      hiddenFields={{ mode: "external", a_variant_id: aVariant.id }}
      externalFields={hidden}
      returnTo={`/admin/mappings?${returnParams.toString()}`}
      existing={existing}
    />
  );
}

function formatOptions(variant: CatalogVariantWithProduct): string {
  if (!variant.option_values.length) return "—";
  return variant.option_values.map((option) => `${option.name}: ${option.value}`).join(", ");
}

function identityLabel(value: "match" | "mismatch" | "missing"): string {
  if (value === "match") return "Confere";
  if (value === "missing") return "Sem SKU para conferir";
  return "Diferente";
}

function groupByProduct(
  variants: CatalogVariantWithProduct[],
): Array<[string, CatalogVariantWithProduct[]]> {
  const groups = new Map<string, CatalogVariantWithProduct[]>();
  for (const variant of variants) {
    const key = variant.product.title;
    const list = groups.get(key) ?? [];
    list.push(variant);
    groups.set(key, list);
  }
  return [...groups.entries()];
}
