-- Vários pares independentes Loja A ↔ Loja B.
-- Cada store pertence a uma integration e tem um role (a/b) dentro dela.

create table public.integrations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  status text not null default 'draft'
    check (status in ('draft', 'active', 'disabled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger integrations_set_updated_at
before update on public.integrations
for each row execute function public.set_updated_at();

alter table public.stores add column integration_id uuid;

-- Migra o par único existente (se houver) para uma integração inicial.
with created as (
  insert into public.integrations (name, status)
  select 'Integração principal', 'active'
  where exists (select 1 from public.stores)
  returning id
)
update public.stores
set integration_id = (select id from created)
where integration_id is null;

alter table public.stores alter column integration_id set not null;
alter table public.stores
  add constraint stores_integration_fk
  foreign key (integration_id) references public.integrations(id) on delete cascade;

alter table public.stores drop constraint stores_role_unique;
alter table public.stores
  add constraint stores_integration_role_unique unique (integration_id, role);

alter table public.mappings add column integration_id uuid;

update public.mappings m
set integration_id = s.integration_id
from public.stores s
where s.id = m.store_a_id;

alter table public.mappings alter column integration_id set not null;
alter table public.mappings
  add constraint mappings_integration_fk
  foreign key (integration_id) references public.integrations(id) on delete cascade;

create index mappings_integration_idx on public.mappings (integration_id, status);
create index stores_integration_idx on public.stores (integration_id);

alter table public.integrations enable row level security;
revoke all on table public.integrations from anon, authenticated;
