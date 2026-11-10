import type { ReactNode } from "react";

const TONES = {
  info: "",
  success: "notice-success",
  warning: "notice-warning",
  danger: "notice-danger",
} as const;

export function Notice({
  tone = "info",
  children,
}: {
  tone?: keyof typeof TONES;
  children: ReactNode;
}) {
  return <div className={`notice ${TONES[tone]}`}>{children}</div>;
}

const STATUS_LABELS: Record<string, string> = {
  active: "Ativo",
  pending: "Pendente",
  needs_reauth: "Reconectar",
  disconnected: "Desconectado",
  draft: "Rascunho",
  needs_review: "Em revisão",
  disabled: "Desativado",
  success: "Sucesso",
  error: "Erro",
  running: "Em andamento",
  completed: "Concluída",
  failed: "Falhou",
  installed: "Instalado",
  skipped: "Ignorado",
  rolled_back: "Revertido",
  expired: "Expirada",
  processing: "Processando",
};

export function StatusBadge({ status }: { status: string }) {
  const tone =
    status === "active" || status === "success" || status === "completed" || status === "installed"
      ? "badge-success"
      : status === "needs_review" ||
          status === "pending" ||
          status === "running" ||
          status === "processing" ||
          status === "skipped" ||
          status === "rolled_back"
        ? "badge-warning"
        : status === "needs_reauth" || status === "failed" || status === "error" || status === "expired"
          ? "badge-danger"
          : "";
  return <span className={`badge ${tone}`}>{STATUS_LABELS[status] ?? status}</span>;
}

export function Check({ done }: { done: boolean }) {
  return <span className={`check ${done ? "check-ok" : "check-todo"}`}>{done ? "✓" : "○"}</span>;
}
