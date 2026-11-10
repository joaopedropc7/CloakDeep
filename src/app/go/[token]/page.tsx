import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getStoreById } from "@/lib/db/stores";
import { getVariantWithProduct } from "@/lib/db/catalog";
import { ALLOWED_ATTRIBUTION_KEYS, sanitizeAttribution } from "@/lib/domain/attribution";
import { destinationLabel } from "@/lib/domain/mapping-rules";
import { formatMoney } from "@/lib/money";
import { resolveExternalLinkToken } from "@/lib/services/transfers";
import { PublicHeader } from "@/components/public-header";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Sair da loja",
  robots: { index: false, follow: false },
  referrer: "strict-origin-when-cross-origin",
};

export default async function ExternalGoPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { token } = await params;
  if (!/^[A-Za-z0-9_-]{20,500}$/.test(token)) notFound();

  const resolution = await resolveExternalLinkToken(token);
  if (!resolution) {
    return (
      <>
        <PublicHeader right={<span className="badge">Saída identificada</span>} />
        <main className="public-page">
          <div className="public-card">
          <div className="public-card-body">
            <h1>Link indisponível</h1>
            <p className="muted">
              Este link de produto expirou ou o mapeamento foi desativado. Volte à loja de
              origem para escolher o produto novamente.
            </p>
            <Link className="button" href="/">
              Voltar
            </Link>
          </div>
          </div>
        </main>
      </>
    );
  }

  const { mapping, storeB, targetUrl } = resolution;
  const [storeA, aVariant] = await Promise.all([
    getStoreById(mapping.store_a_id),
    getVariantWithProduct(mapping.store_a_variant_id),
  ]);
  if (!storeA) notFound();

  const rawParams = await searchParams;
  const rawAttribution: Record<string, string> = {};
  for (const key of ALLOWED_ATTRIBUTION_KEYS) {
    const value = rawParams[key];
    if (typeof value === "string") rawAttribution[key] = value;
  }
  const attribution = sanitizeAttribution(rawAttribution);
  const hasParams = Object.keys(attribution).length > 0;
  const error = typeof rawParams.error === "string" ? rawParams.error : null;

  return (
    <>
      <PublicHeader right={<span className="badge">Saída identificada</span>} />
      <main className="public-page">
        <div className="public-card">
        <div className="public-card-header">
          <span className="badge">Você está saindo da {storeA.name}</span>
          <h1 style={{ marginTop: "0.75rem" }}>Continuar para {storeB.name}?</h1>
          <p className="muted" style={{ marginBottom: 0 }}>
            Este link leva ao mesmo produto no site externo da Loja B, que é a responsável pela
            venda. A Loja A não processa o pagamento desta compra.
          </p>
        </div>
        <div className="public-card-body">
          {error ? (
            <div className="notice notice-danger">
              {error === "RATE_LIMITED"
                ? "Muitas tentativas. Aguarde alguns minutos."
                : "Este link não está mais disponível. Volte à loja de origem."}
            </div>
          ) : null}

          <div className="destination">
            <span className="badge">Loja responsável pela venda</span>
            <strong style={{ marginTop: "0.4rem" }}>{storeB.name}</strong>
            <span className="small break">
              Domínio de destino: <strong>{destinationLabel(storeB)}</strong>
            </span>
            <span className="tiny muted">
              Confira o endereço do site antes de informar dados pessoais ou de pagamento.
            </span>
          </div>

          <div className="grid-2" style={{ marginTop: "1rem" }}>
            <div>
              <h2>Produto na Loja A</h2>
              <strong>{aVariant?.product.title ?? "Produto da Loja A"}</strong>
              <div className="small muted">
                {aVariant?.title ?? "Padrão"}
                {aVariant?.sku ? ` · SKU ${aVariant.sku}` : ""}
              </div>
              <div>{formatMoney(mapping.price_a, mapping.currency_a)}</div>
            </div>
            <div>
              <h2>Produto na Loja B</h2>
              <strong>{mapping.external_product_title}</strong>
              <div className="small muted">
                {mapping.external_variant_title}
                {mapping.external_sku ? ` · SKU ${mapping.external_sku}` : ""}
              </div>
              <div>{formatMoney(mapping.price_b, mapping.currency_b)}</div>
            </div>
          </div>

          <p className="small muted" style={{ marginTop: "1rem" }}>
            Destino: <span className="mono break">{targetUrl}</span>
          </p>

          <form action={`/api/public/go/${encodeURIComponent(token)}`} method="post">
            {hasParams ? (
              <>
                {Object.entries(attribution).map(([key, value]) => (
                  <input key={key} type="hidden" name={key} value={value} />
                ))}
                <label className="consent-box">
                  <input type="checkbox" name="attribution_consent" />
                  <span>
                    Autorizo o compartilhamento de parâmetros de campanha (UTMs/click IDs) com a
                    Loja B para atribuição de marketing. A escolha é opcional e não altera o preço.
                  </span>
                </label>
              </>
            ) : null}
            <div className="row">
              <button type="submit">Continuar para {destinationLabel(storeB)}</button>
              <Link
                className="button button-secondary"
                href={storeA.primary_domain ? `https://${storeA.primary_domain}` : "/"}
              >
                Voltar à {storeA.name}
              </Link>
            </div>
          </form>
        </div>
        <div className="public-card-footer">
          <p className="tiny muted" style={{ margin: 0 }}>
            Nenhum dado pessoal é transmitido pela URL. A Loja B é a vendedora e controla o
            próprio checkout, pagamento, entrega e pós-venda.
          </p>
        </div>
        </div>
      </main>
    </>
  );
}
