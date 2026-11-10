import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { optionalEnv } from "@/lib/env";
import { logoutAction } from "@/app/admin/actions";
import { SubmitButton } from "@/components/submit-button";
import { AdminNav } from "@/components/admin-nav";
import { ThemeToggle } from "@/components/theme-toggle";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin();

  const required = [
    "SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "TOKEN_ENCRYPTION_KEY",
    "SESSION_SECRET",
  ];
  const missing = required.filter((name) => !optionalEnv(name));
  if (missing.length > 0) {
    return (
      <main className="public-page">
        <div className="public-card">
          <div className="public-card-header">
            <Link href="/admin" className="brand-lockup">
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
            <h1 style={{ marginTop: "1rem" }}>Configuração pendente</h1>
            <p className="muted" style={{ marginBottom: 0 }}>
              O painel já está autenticado, mas faltam variáveis no <code>.env</code> para
              carregar o Supabase e a configuração da aplicação.
            </p>
          </div>
          <div className="public-card-body">
            <div className="notice notice-warning">
              Preencha no <code>.env</code>:{" "}
              {missing.map((name, index) => (
                <span key={name}>
                  <code>{name}</code>
                  {index < missing.length - 1 ? " · " : ""}
                </span>
              ))}
            </div>
            <p className="small muted">
              Depois de preencher, faça um novo deploy. O build gera o módulo de ambiente a
              partir do <code>.env</code>.
            </p>
            <div className="row">
              <Link className="button button-secondary" href="/">
                Voltar ao início
              </Link>
              <form action={logoutAction}>
                <SubmitButton className="secondary" pendingLabel="Saindo...">
                  Sair
                </SubmitButton>
              </form>
            </div>
          </div>
        </div>
      </main>
    );
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Link href="/admin" className="brand-lockup sidebar-brand" aria-label="ShopSync — painel">
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

        <AdminNav />

        <div className="sidebar-footer">
          <div className="sidebar-status">
            <span className="status-dot" />
            <span>Ambiente seguro</span>
          </div>
          <ThemeToggle />
          <form action={logoutAction}>
            <SubmitButton className="secondary sidebar-logout" pendingLabel="Saindo...">
              Sair
            </SubmitButton>
          </form>
        </div>
      </aside>

      <div className="app-main">
        <header className="topbar">
          <div>
            <span className="topbar-eyebrow">Painel administrativo</span>
            <span className="topbar-title">ShopSync</span>
          </div>
          <div className="topbar-actions">
            <span className="badge">Sessão protegida</span>
          </div>
        </header>
        <main className="app-content">{children}</main>
      </div>
    </div>
  );
}
