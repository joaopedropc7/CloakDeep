import { hasPersistedAdminPassword } from "@/lib/auth";
import { changeAdminPasswordAction } from "@/app/admin/actions";
import { SubmitButton } from "@/components/submit-button";
import { Notice } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const params = await searchParams;
  const persisted = await hasPersistedAdminPassword();

  return (
    <div className="stack">
      <div className="panel">
        <h1>Segurança</h1>
        <p className="muted">
          A senha administrativa é armazenada como hash scrypt no Supabase. O valor
          <code>ADMIN_PASSWORD</code> no <code>.env</code> serve apenas como bootstrap inicial e
          deixa de ser usado depois que você define uma senha aqui.
        </p>
        {params.saved ? <Notice tone="success">{params.saved}</Notice> : null}
        {params.error ? <Notice tone="danger">{params.error}</Notice> : null}
        {persisted ? (
          <Notice tone="success">
            Existe uma senha persistida no banco. O bootstrap do <code>.env</code> não é mais
            consultado.
          </Notice>
        ) : (
          <Notice tone="warning">
            Nenhuma senha persistida ainda. O login está usando o <code>ADMIN_PASSWORD</code> do
            <code>.env</code>. Defina uma nova senha abaixo para gravar o hash no banco.
          </Notice>
        )}
      </div>

      <section className="panel">
        <h2>Alterar senha administrativa</h2>
        <form action={changeAdminPasswordAction} className="form-grid">
          <div className="full">
            <label htmlFor="current-password">Senha atual</label>
            <input id="current-password" name="current_password" type="password" autoComplete="current-password" required />
          </div>
          <div>
            <label htmlFor="new-password">Nova senha (mínimo 12 caracteres)</label>
            <input id="new-password" name="new_password" type="password" autoComplete="new-password" minLength={12} required />
          </div>
          <div>
            <label htmlFor="confirm-password">Confirmar nova senha</label>
            <input id="confirm-password" name="confirm_password" type="password" autoComplete="new-password" minLength={12} required />
          </div>
          <div className="full">
            <SubmitButton pendingLabel="Alterando...">Salvar nova senha</SubmitButton>
          </div>
        </form>
        <p className="footer-note">
          Depois da troca, você pode remover ou deixar em branco o <code>ADMIN_PASSWORD</code> no
          <code>.env</code> e fazer novo deploy. Guarde a nova senha; não há recuperação automática.
        </p>
      </section>
    </div>
  );
}
