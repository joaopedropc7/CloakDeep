-- Escopos solicitados por loja, último teste de conexão e suporte à gestão
-- administrativa das integrações/lojas.
alter table public.stores
  add column shopify_scopes text not null default 'read_products,write_themes';

alter table public.stores
  add column last_check_at timestamptz;

alter table public.stores
  add column last_check_error text;

alter table public.stores add column last_sync_attempt_at timestamptz;
