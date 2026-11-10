-- Instalação automática do código no tema da Loja A.
-- A tabela guarda o backup do layout alterado e o estado da última tentativa.

create table public.theme_installations (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null unique references public.stores(id) on delete cascade,
  theme_id text,
  theme_name text,
  status text not null default 'pending'
    check (status in ('pending', 'installed', 'failed', 'skipped', 'rolled_back')),
  version text not null default '1',
  backup_layout text,
  last_error text,
  installed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger theme_installations_set_updated_at
before update on public.theme_installations
for each row execute function public.set_updated_at();

alter table public.theme_installations enable row level security;
revoke all on table public.theme_installations from anon, authenticated;
