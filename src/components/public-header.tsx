import Link from "next/link";
import type { ReactNode } from "react";
import { ThemeToggle } from "@/components/theme-toggle";

export function PublicHeader({ right }: { right?: ReactNode }) {
  return (
    <header className="public-header">
      <div className="public-header-inner">
        <Link href="/" className="brand-lockup" aria-label="ShopSync — início">
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
        <div className="public-header-actions">
          {right}
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
