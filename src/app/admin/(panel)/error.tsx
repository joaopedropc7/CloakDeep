"use client";

import Link from "next/link";

export default function AdminError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="panel">
      <h1>Não foi possível carregar o painel</h1>
      <p className="muted">
        Verifique a configuração do Supabase, as variáveis de ambiente e o schema aplicado. A
        aplicação não exibe detalhes internos em produção.
      </p>
      <div className="row">
        <button type="button" onClick={() => reset()}>
          Tentar novamente
        </button>
        <Link className="button button-secondary" href="/admin/login">
          Voltar ao login
        </Link>
      </div>
    </div>
  );
}
