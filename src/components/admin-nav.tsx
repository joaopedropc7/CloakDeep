"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS = [
  { href: "/admin", label: "Visão geral", icon: "grid" },
  { href: "/admin/stores", label: "Lojas", icon: "store" },
  { href: "/admin/pairs", label: "Pares", icon: "link" },
  { href: "/admin/products", label: "Produtos", icon: "box" },
  { href: "/admin/mappings", label: "Mapeamentos", icon: "link" },
  { href: "/admin/transfers", label: "Transferências", icon: "arrow" },
  { href: "/admin/settings", label: "Segurança", icon: "shield" },
] as const;

function Icon({ name }: { name: (typeof ITEMS)[number]["icon"] }) {
  if (name === "grid") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <rect x="3" y="3" width="7" height="7" rx="1.5" />
        <rect x="14" y="3" width="7" height="7" rx="1.5" />
        <rect x="3" y="14" width="7" height="7" rx="1.5" />
        <rect x="14" y="14" width="7" height="7" rx="1.5" />
      </svg>
    );
  }
  if (name === "store") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 10v9a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-9" />
        <path d="M3 10h18l-1.5-5.5a1 1 0 0 0-1-.7h-13a1 1 0 0 0-1 .7L3 10Z" />
        <path d="M9 20v-5h6v5" />
      </svg>
    );
  }
  if (name === "box") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z" />
        <path d="m4 7.5 8 4.5 8-4.5M12 12v9" />
      </svg>
    );
  }
  if (name === "link") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M10 13a5 5 0 0 0 7.5.5l1.5-1.5a5 5 0 0 0-7-7L10.5 6.5" />
        <path d="M14 11a5 5 0 0 0-7.5-.5L5 12a5 5 0 0 0 7 7l1.5-1.5" />
      </svg>
    );
  }
  if (name === "arrow") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 12h16M14 6l6 6-6 6" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3 5 6v5c0 4.5 3 8 7 10 4-2 7-5.5 7-10V6l-7-3Z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}

export function AdminNav() {
  const pathname = usePathname();
  return (
    <nav className="sidebar-nav" aria-label="Navegação administrativa">
      {ITEMS.map((item) => {
        const active = item.href === "/admin" ? pathname === "/admin" : pathname.startsWith(item.href);
        return (
          <Link key={item.href} href={item.href} className={active ? "active" : undefined} aria-current={active ? "page" : undefined}>
            <Icon name={item.icon} />
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
