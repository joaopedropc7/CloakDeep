import Link from "next/link";
import { PublicHeader } from "@/components/public-header";

function FlowIcon({ kind }: { kind: "store" | "sync" | "check" }) {
  if (kind === "store") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 10v9a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-9" />
        <path d="M3 10h18l-1.5-5.5a1 1 0 0 0-1-.7h-13a1 1 0 0 0-1 .7L3 10Z" />
        <path d="M9 20v-5h6v5" />
      </svg>
    );
  }
  if (kind === "sync") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M20 7h-7M20 7l-3-3M20 7l-3 3M4 17h7M4 17l3-3M4 17l3 3" />
        <path d="M7 7h2M15 17h2" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

export default function HomePage() {
  return (
    <>
      <PublicHeader
        right={
          <Link className="button button-secondary" href="/admin">
            Entrar no painel
          </Link>
        }
      />
      <main className="landing">
        <div className="container">
          <section className="hero">
            <div className="hero-copy">
              <span className="eyebrow">Integração transparente</span>
              <h1>
                Sua vitrine Shopify,
                <br />
                <span>checkout sem atrito.</span>
              </h1>
              <p className="hero-lead">
                O ShopSync conecta a Loja A a uma Loja B Shopify ou externa. Cada item é
                conferido por produto, variante, preço e moeda antes de o comprador continuar
                para o checkout da loja vendedora — sem cloaking e sem substituições.
              </p>
              <div className="hero-actions">
                <Link className="button" href="/admin">
                  Abrir painel
                </Link>
                <a className="button button-secondary" href="#como-funciona">
                  Como funciona
                </a>
              </div>
            </div>

            <div className="hero-visual" aria-label="Fluxo de transferência entre lojas">
              <div className="flow-row">
                <span className="flow-icon">
                  <FlowIcon kind="store" />
                </span>
                <div>
                  <strong>Loja A · Shopify</strong>
                  <small>Vitrine, catálogo e carrinho de origem</small>
                </div>
              </div>
              <div className="flow-row">
                <span className="flow-icon">
                  <FlowIcon kind="sync" />
                </span>
                <div>
                  <strong>ShopSync</strong>
                  <small>Confere mapeamento, preço, moeda e disponibilidade</small>
                </div>
              </div>
              <div className="flow-row">
                <span className="flow-icon">
                  <FlowIcon kind="check" />
                </span>
                <div>
                  <strong>Loja B · checkout</strong>
                  <small>Shopify via Storefront API ou site externo por produto</small>
                </div>
              </div>
            </div>
          </section>

          <section id="como-funciona" className="feature-grid">
            <article className="feature-card">
              <span className="feature-number">01</span>
              <h3>Mapeamento conferido</h3>
              <p>
                Produto, variante, SKU, preço e moeda são comparados antes da ativação. Qualquer
                divergência bloqueia a transferência.
              </p>
            </article>
            <article className="feature-card">
              <span className="feature-number">02</span>
              <h3>Checkout identificado</h3>
              <p>
                O comprador vê a loja responsável pela venda e o domínio de destino antes de sair
                da vitrine. O pagamento acontece no checkout da Loja B.
              </p>
            </article>
            <article className="feature-card">
              <span className="feature-number">03</span>
              <h3>Operação segura</h3>
              <p>
                Tokens e credenciais ficam cifrados no servidor. UTMs e click IDs só seguem com
                consentimento e dentro de uma allowlist.
              </p>
            </article>
          </section>

          <section className="panel" style={{ marginTop: "2rem" }}>
            <div className="panel-header">
              <div>
                <span className="eyebrow">Transparência por padrão</span>
                <h2 style={{ marginTop: "0.6rem" }}>O que o ShopSync faz — e o que não faz</h2>
              </div>
              <Link className="button button-secondary" href="/admin/login">
                Acessar painel
              </Link>
            </div>
            <div className="grid-2">
              <ul>
                <li>Mesmo produto real, mesma variante e mesma moeda entre as lojas.</li>
                <li>Bloqueio quando qualquer item não tem correspondência válida.</li>
                <li>Página de confirmação com itens, preços e loja vendedora.</li>
              </ul>
              <ul>
                <li>Sem cloaking, ocultação de produtos ou conteúdo por revisor.</li>
                <li>Sem substituição de produto e sem burlar regras de anúncio ou pagamento.</li>
                <li>Nenhum dado pessoal de comprador é persistido pela aplicação.</li>
              </ul>
            </div>
          </section>

          <p className="footer-note">
            ShopSync · a Loja B é a responsável pela venda, pelo checkout, pelo pagamento e pelo
            pós-venda. A Loja A não processa o pagamento desta compra.
          </p>
        </div>
      </main>
    </>
  );
}
