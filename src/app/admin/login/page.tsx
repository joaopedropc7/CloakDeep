import Link from "next/link";
import { redirect } from "next/navigation";
import { getAdminSession } from "@/lib/auth";
import { loginAction } from "@/app/admin/actions";
import { SubmitButton } from "@/components/submit-button";
import { Notice } from "@/components/ui";
import { PublicHeader } from "@/components/public-header";

export const dynamic = "force-dynamic";

export const metadata = { title: "Entrar" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await getAdminSession().catch(() => null);
  if (session) redirect("/admin");
  const { error } = await searchParams;

  return (
    <>
      <PublicHeader right={<Link href="/" className="small muted">Voltar ao início</Link>} />
      <main className="public-page" style={{ paddingTop: "1.5rem" }}>
        <div className="auth-shell">
          <aside className="auth-aside">
            <Link href="/" className="brand-lockup">
              <span className="brand-mark" aria-hidden="true">
                <svg viewBox="0 0 24 24">
                  <path d="M7 7h10M7 17h10M9 4 6 7l3 3M15 14l3 3-3 3" />
                </svg>
              </span>
              <span>
                <strong>ShopSync</strong>
                <small>Commerce bridge</small>
              </span>
            </Link>
            <div>
              <h2>Uma ponte transparente entre suas lojas.</h2>
              <p>
                Catálogo, mapeamentos e transferências em um só lugar. Acesso restrito ao
                operador da integração.
              </p>
            </div>
            <div className="auth-points">
              <div className="auth-point">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M20 6 9 17l-5-5" />
                </svg>
                Tokens e credenciais cifrados no servidor
              </div>
              <div className="auth-point">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M20 6 9 17l-5-5" />
                </svg>
                Mapeamento manual com conferência de preço
              </div>
              <div className="auth-point">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M20 6 9 17l-5-5" />
                </svg>
                Checkout e loja vendedora sempre identificados
              </div>
            </div>
          </aside>

          <section className="auth-card">
            <span className="badge">Painel administrativo</span>
            <h1 style={{ marginTop: "0.7rem" }}>Entrar no ShopSync</h1>
            <p className="auth-sub">Use a senha administrativa para continuar.</p>
            {error ? <Notice tone="danger">{error}</Notice> : null}
            <form action={loginAction} className="stack">
              <div>
                <label htmlFor="password">Senha administrativa</label>
                <input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  autoFocus
                />
              </div>
              <SubmitButton pendingLabel="Entrando...">Entrar</SubmitButton>
            </form>
            <p className="footer-note">
              A senha é verificada no servidor. A sessão usa cookie HttpOnly assinado.
            </p>
          </section>
        </div>
      </main>
    </>
  );
}
