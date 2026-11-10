-- Cross-Store Bridge — schema inicial
-- Persistência apenas. Toda a lógica de negócio vive no Next.js.
--
-- Segurança: RLS habilitado em todas as tabelas e nenhuma policy pública.
-- Somente a service_role (usada exclusivamente no servidor Next.js) acessa os dados.

create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Uma linha por papel (A/B). O painel substitui a configuração existente.
create table public.stores (
  id uuid primary key default gen_random_uuid(),
  role text not null check (role in ('a', 'b')),
  platform text not null check (platform in ('shopify', 'external')),
  name text not null,
  shop_domain text unique,
  primary_domain text,
  currency text check (currency is null or currency ~ '^[A-Z]{3}$'),
  admin_token_cipher text,
  refresh_token_cipher text,
  token_expires_at timestamptz,
  refresh_token_expires_at timestamptz,
  scopes text[] not null default '{}',
  storefront_token_cipher text,
  storefront_token_kind text check (storefront_token_kind in ('public', 'private')),
  storefront_api_version text,
  external_base_url text,
  status text not null default 'pending'
    check (status in ('pending', 'active', 'needs_reauth', 'disconnected')),
  connected_at timestamptz,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint stores_role_unique unique (role),
  constraint stores_shopify_domain_required
    check (platform <> 'shopify' or shop_domain is not null),
  constraint stores_external_url_required
    check (platform <> 'external' or external_base_url is not null)
);

create trigger stores_set_updated_at
before update on public.stores
for each row execute function public.set_updated_at();

create table public.products (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  external_id text not null,
  handle text,
  title text not null,
  vendor text,
  product_type text,
  status text,
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  is_current boolean not null default true,
  raw jsonb,
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (store_id, external_id)
);

create index products_store_idx on public.products (store_id, is_current);
create trigger products_set_updated_at
before update on public.products
for each row execute function public.set_updated_at();

create table public.variants (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  external_id text not null,
  sku text,
  title text,
  option_values jsonb not null default '[]'::jsonb,
  price_amount numeric(20, 6) not null check (price_amount >= 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  available_for_sale boolean not null default false,
  is_current boolean not null default true,
  raw jsonb,
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (store_id, external_id)
);

create index variants_store_idx on public.variants (store_id, is_current);
create index variants_product_idx on public.variants (product_id);
create trigger variants_set_updated_at
before update on public.variants
for each row execute function public.set_updated_at();

create table public.mappings (
  id uuid primary key default gen_random_uuid(),
  store_a_id uuid not null references public.stores(id) on delete cascade,
  store_a_variant_id uuid not null references public.variants(id) on delete cascade,
  store_b_id uuid not null references public.stores(id) on delete cascade,
  store_b_variant_id uuid references public.variants(id) on delete cascade,
  mode text not null check (mode in ('shopify', 'external')),
  status text not null default 'draft'
    check (status in ('draft', 'active', 'needs_review', 'disabled')),
  currency_a text not null check (currency_a ~ '^[A-Z]{3}$'),
  currency_b text not null check (currency_b ~ '^[A-Z]{3}$'),
  price_a numeric(20, 6) not null check (price_a >= 0),
  price_b numeric(20, 6) not null check (price_b >= 0),
  price_diff numeric(20, 6) not null default 0,
  price_diff_percent numeric(12, 6) not null default 0,
  external_product_url text,
  external_product_title text,
  external_variant_title text,
  external_sku text,
  identity_ack boolean not null default false,
  price_ack boolean not null default false,
  notes text,
  activated_at timestamptz,
  last_checked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint mappings_a_variant_unique unique (store_a_variant_id),
  constraint mappings_mode_fields
    check (
      (mode = 'shopify' and store_b_variant_id is not null)
      or
      (mode = 'external' and external_product_url is not null)
    )
);

create index mappings_status_idx on public.mappings (status);
create index mappings_b_variant_idx on public.mappings (store_b_variant_id);
create trigger mappings_set_updated_at
before update on public.mappings
for each row execute function public.set_updated_at();

create table public.sync_runs (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  status text not null default 'running'
    check (status in ('running', 'success', 'error')),
  products_seen integer not null default 0,
  variants_seen integer not null default 0,
  error_code text,
  error_message text,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

create index sync_runs_store_idx on public.sync_runs (store_id, started_at desc);

create table public.transfer_sessions (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  store_a_id uuid not null references public.stores(id) on delete cascade,
  store_b_id uuid not null references public.stores(id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'completed', 'failed', 'expired')),
  lines jsonb not null,
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  subtotal numeric(20, 6) not null,
  attribution jsonb not null default '{}'::jsonb,
  attribution_consent boolean not null default false,
  visitor_consent jsonb not null default '{}'::jsonb,
  checkout_url text,
  claim_token text,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  error_code text,
  error_detail text,
  created_at timestamptz not null default now()
);

create index transfer_sessions_status_idx on public.transfer_sessions (status, expires_at);

create table public.audit_events (
  id bigserial primary key,
  store_id uuid references public.stores(id) on delete set null,
  event_type text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index audit_events_created_idx on public.audit_events (created_at desc);

alter table public.stores enable row level security;
alter table public.products enable row level security;
alter table public.variants enable row level security;
alter table public.mappings enable row level security;
alter table public.sync_runs enable row level security;
alter table public.transfer_sessions enable row level security;
alter table public.audit_events enable row level security;

revoke all on table public.stores from anon, authenticated;
revoke all on table public.products from anon, authenticated;
revoke all on table public.variants from anon, authenticated;
revoke all on table public.mappings from anon, authenticated;
revoke all on table public.sync_runs from anon, authenticated;
revoke all on table public.transfer_sessions from anon, authenticated;
revoke all on table public.audit_events from anon, authenticated;

revoke all on sequence public.audit_events_id_seq from anon, authenticated;
