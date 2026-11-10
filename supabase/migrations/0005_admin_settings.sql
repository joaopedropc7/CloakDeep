-- Configurações administrativas persistentes. A senha é armazenada como hash
-- scrypt; ADMIN_PASSWORD no .env serve apenas como bootstrap inicial.
create table public.admin_settings (
  singleton boolean primary key default true check (singleton),
  password_hash text not null,
  updated_at timestamptz not null default now()
);

alter table public.admin_settings enable row level security;
revoke all on table public.admin_settings from anon, authenticated;
