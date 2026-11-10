-- Reparo idempotente da migration 0007.
-- Pode ser executado no SQL Editor do Supabase mesmo que a 0007 tenha falhado
-- no meio. Também é seguro se a 0007 já tiver sido aplicada corretamente.

alter table public.stores add column if not exists store_type text;

update public.stores
set store_type = case when role = 'a' then 'storefront' else 'checkout' end
where store_type is null and role in ('a', 'b');

alter table public.stores alter column store_type set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'stores_type_check'
      and conrelid = 'public.stores'::regclass
  ) then
    alter table public.stores
      add constraint stores_type_check
      check (store_type in ('storefront', 'checkout'));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'stores_storefront_shopify'
      and conrelid = 'public.stores'::regclass
  ) then
    alter table public.stores
      add constraint stores_storefront_shopify
      check (store_type <> 'storefront' or platform = 'shopify');
  end if;
end $$;

alter table public.integrations add column if not exists storefront_id uuid;
alter table public.integrations add column if not exists checkout_id uuid;

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'stores'
      and column_name = 'integration_id'
  ) then
    execute $sql$
      update public.integrations i
      set storefront_id = coalesce(i.storefront_id, (
            select s.id from public.stores s
            where s.integration_id = i.id and s.role = 'a'
            limit 1
          )),
          checkout_id = coalesce(i.checkout_id, (
            select s.id from public.stores s
            where s.integration_id = i.id and s.role = 'b'
            limit 1
          ))
    $sql$;
  end if;
end $$;

delete from public.integrations
where storefront_id is null or checkout_id is null;

alter table public.integrations alter column storefront_id set not null;
alter table public.integrations alter column checkout_id set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'integrations_storefront_fk'
      and conrelid = 'public.integrations'::regclass
  ) then
    alter table public.integrations
      add constraint integrations_storefront_fk
      foreign key (storefront_id) references public.stores(id) on delete cascade;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'integrations_checkout_fk'
      and conrelid = 'public.integrations'::regclass
  ) then
    alter table public.integrations
      add constraint integrations_checkout_fk
      foreign key (checkout_id) references public.stores(id) on delete cascade;
  end if;
end $$;

alter table public.stores drop constraint if exists stores_integration_role_unique;
alter table public.stores drop constraint if exists stores_integration_fk;
alter table public.stores drop column if exists integration_id;

with ranked as (
  select id,
         row_number() over (partition by lower(name) order by created_at) as rn
  from public.stores
)
update public.stores s
set name = s.name || ' #' || left(s.id::text, 6)
from ranked r
where s.id = r.id and r.rn > 1;

create unique index if not exists stores_name_unique
  on public.stores (lower(name));

create index if not exists stores_external_url_idx
  on public.stores (external_base_url)
  where external_base_url is not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'integrations_pair_unique'
      and conrelid = 'public.integrations'::regclass
  ) then
    alter table public.integrations
      add constraint integrations_pair_unique unique (storefront_id, checkout_id);
  end if;
end $$;

with ranked as (
  select id,
         row_number() over (partition by storefront_id order by created_at desc) as rn
  from public.integrations
  where status = 'active'
)
update public.integrations i
set status = 'draft'
from ranked r
where i.id = r.id and r.rn > 1;

create unique index if not exists integrations_one_active_per_storefront
  on public.integrations (storefront_id)
  where status = 'active';

alter table public.mappings drop constraint if exists mappings_store_a_variant_id_key;
alter table public.mappings drop constraint if exists mappings_a_variant_unique;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'mappings_pair_variant_unique'
      and conrelid = 'public.mappings'::regclass
  ) then
    alter table public.mappings
      add constraint mappings_pair_variant_unique
      unique (integration_id, store_a_variant_id);
  end if;
end $$;
