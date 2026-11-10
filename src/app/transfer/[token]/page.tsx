import Link from "next/link";
import Decimal from "decimal.js";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { sha256Hex } from "@/lib/crypto";
import { getTransferByTokenHash } from "@/lib/db/transfers";
import { getStoreById } from "@/lib/db/stores";
import { destinationLabel } from "@/lib/domain/mapping-rules";
import { formatMoney } from "@/lib/money";
import { StatusBadge } from "@/components/ui";
import { PublicHeader } from "@/components/public-header";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Continuar para o checkout",
  robots: { index: false, follow: false },
  referrer: "strict-origin-when-cross-origin",
};

const ERROR_MESSAGES: Record<string, string> = {
  TRANSFER_EXPIRED: "Esta transferência expirou. Refaça a transferência a partir do carrinho da Loja A.",
  TRANSFER_NOT_FOUND: "Transferência não encontrada.",
  TRANSFER_INVALIDATED:
    "Produto, variante, preço ou disponibilidade mudaram. A compra foi interrompida e o carrinho precisa ser refeito.",
  TRANSFER_FAILED: "A transferência não pôde ser concluída.",
  TRANSFER_IN_PROGRESS: "O checkout já está sendo criado. Aguarde e tente novamente.",
  DESTINATION_NOT_READY: "A loja de destino não está disponível agora.",
  LIVE_CHECK_FAILED: "Não foi possível conferir os produtos agora. Tente novamente.",
  PRICE_CHANGED_DURING_CART_CREATION:
    "O preço mudou no momento de criar o checkout. A compra foi interrompida por segurança.",
  RATE_LIMITED: "Muitas tentativas. Aguarde alguns minutos.",
  CHECKOUT_FAILED: "A loja de destino não conseguiu criar o checkout.",
};

export default async function TransferPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { token } = await params;
  const { error } = await searchParams;
  if (!/^[A-Za-z0-9_-]{20,200}$/.test(token)) notFound();

  const transfer = await getTransferByTokenHash(sha256Hex(token));
  if (!transfer) notFound();

  const [storeA, storeB] = await Promise.all([
    getStoreById(transfer.store_a_id),
    getStoreById(transfer.store_b_id),
  ]);
  if (!storeA || !storeB) notFound();

  const isExpired = new Date(transfer.expires_at).getTime() <= Date.now();
  const blocked =
    transfer.status === "failed" ||
    transfer.status === "expired" ||
    isExpired ||
    storeB.status !== "active" ||
    storeB.platform !== "shopify";
  const errorMessage = error ? ERROR_MESSAGES[error] ?? "Não foi possível concluir a transferência." : null;


  return (
    <>
      <PublicHeader right={<span className="badge">Checkout identificado</span>} />
      <main className="public-page">
        <div className="public-card">
        <div className="public-card-header">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <span className="badge">Transferência transparente</span>
            <StatusBadge status={transfer.status} />
          </div>
          <h1 style={{ marginTop: "0.75rem" }}>Continuar para o checkout</h1>
          <p className="muted" style={{ marginBottom: 0 }}>
            Revise os itens e a loja responsável pela venda antes de sair de{" "}
            <strong>{storeA.name}</strong>.
          </p>
        </div>

        <div className="public-card-body">
          {errorMessage ? (
            <div className="notice notice-danger">
              <p>{errorMessage}</p>
              <p className="small">
                Volte ao carrinho da Loja A para refazer a transferência. Nenhum pagamento foi
                processado por esta página.
              </p>
            </div>
          ) : null}

          {blocked && !errorMessage ? (
            <div className="notice notice-danger">
              <p>Esta transferência não está mais disponível.</p>
              <p className="small">Refaça a transferência a partir do carrinho da Loja A.</p>
            </div>
          ) : null}

          <div className="destination">
            <span className="badge">Loja responsável pela venda</span>
            <strong style={{ marginTop: "0.4rem" }}>{storeB.name}</strong>
            <span className="small break">
              Domínio de destino: <strong>{destinationLabel(storeB)}</strong>
            </span>
            <span className="tiny muted">
              O checkout, o pagamento, a entrega e o pós-venda são de responsabilidade da Loja B.
              A Loja A não processa o pagamento desta compra.
            </span>
          </div>

          <h2 style={{ marginTop: "1.5rem" }}>Itens</h2>
          <div>
            {transfer.lines.map((line) => (
              <div className="line-item" key={`${line.mappingId}-${line.bVariantExternalId}`}>
                <div>
                  <strong>{line.aProductTitle}</strong>
                  <div className="small muted">
                    {line.aVariantTitle ? `${line.aVariantTitle} · ` : ""}
                    {line.aSku ? `SKU ${line.aSku} · ` : ""}
                    {line.quantity}×
                  </div>
                  <div className="tiny muted">
                    Preço na Loja A: {formatMoney(line.unitPriceA, line.currency)} · Na Loja B:{" "}
                    {formatMoney(line.unitPriceB, line.currency)}
                  </div>
                  <div className="tiny muted">
                    Destino: {line.bProductTitle}
                    {line.bVariantTitle ? ` — ${line.bVariantTitle}` : ""}
                  </div>
                </div>
                <div className="line-total">
                  {formatMoney(
                    new Decimal(line.unitPriceB).times(line.quantity).toFixed(2),
                    line.currency,
                  )}
                </div>
              </div>
            ))}
          </div>

          <div className="total-row">
            <span>Subtotal na Loja B</span>
            <span>{formatMoney(transfer.subtotal, transfer.currency)}</span>
          </div>
          <p className="tiny muted" style={{ marginTop: "0.5rem" }}>
            Impostos, frete e descontos aplicáveis serão calculados no checkout da Loja B. Os
            valores acima refletem o carrinho transferido.
          </p>

          {!blocked ? (
            <form action={`/api/public/transfers/${encodeURIComponent(token)}/checkout`} method="post">
              {Object.keys(transfer.attribution).length > 0 ? (
                <label className="consent-box">
                  <input type="checkbox" name="attribution_consent" />
                  <span>
                    Autorizo o compartilhamento de parâmetros de campanha (UTMs/click IDs) com a
                    Loja B para atribuição de marketing. A escolha é opcional e não altera o preço.
                  </span>
                </label>
              ) : null}
              <div className="row">
                <button type="submit">Ir para o checkout da {storeB.name}</button>
                <Link
                  className="button button-secondary"
                  href={storeA.primary_domain ? `https://${storeA.primary_domain}` : "/"}
                >
                  Voltar à Loja A
                </Link>
              </div>
              <p className="tiny muted" style={{ marginTop: "0.75rem" }}>
                Você será redirecionado para <strong>{destinationLabel(storeB)}</strong>. Confira
                o endereço do site antes de informar seus dados de pagamento.
              </p>
            </form>
          ) : (
            <div className="row">
              <Link
                className="button"
                href={storeA.primary_domain ? `https://${storeA.primary_domain}` : "/"}
              >
                Voltar à Loja A
              </Link>
            </div>
          )}
        </div>

        <div className="public-card-footer">
          <p className="tiny muted" style={{ margin: 0 }}>
            Esta página não coleta dados pessoais. O link expira em{" "}
            {new Date(transfer.expires_at).toLocaleString("pt-BR")}. Se você não reconhece esta
            compra, feche a página.
          </p>
        </div>
        </div>
      </main>
    </>
  );
}
