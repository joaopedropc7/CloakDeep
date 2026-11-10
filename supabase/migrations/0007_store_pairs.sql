-- Lojas independentes + pares vitrine↔checkout.
-- Uma loja checkout pode atender várias vitrines; uma vitrine tem no máximo
-- um par ativo. Os mapeamentos de produto passam a ser únicos por par.

alter table public.stores add column store_type text;

update public.stores
set store_type = case when role = 'a' then 'storefront' else 'checkout' end
where store_type is null;

alter table public.stores alter column store_type set not null;
alter table public.stores
  add constraint stores_type_check check (store_type in ('storefront', 'checkout'));
alter table public.stores
  add constraint stores_storefront_shopify check (store_type <> 'storefront' or platform = 'shopify');

alter table public.integrations add column storefront_id uuid;
alter table public.integrations add column checkout_id uuid;

update public.integrations i
set storefront_id = (
      select s.id from public.stores s
      where s.integration_id = i.id and s.role = 'a'
      limit 1
    ),
    checkout_id = (
      select s.id from public.stores s
      where s.integration_id = i.id and s.role = 'b'
      limit 1
    );

delete from public.integrations
where storefront_id is null or checkout_id is null;

alter table public.integrations alter column storefront_id set not null;
alter table public.integrations alter column checkout_id set not null;
alter table public.integrations
  add constraint integrations_storefront_fk
  foreign key (storefront_id) references public.stores(id) on delete cascade;
alter table public.integrations
  add constraint integrations_checkout_fk
  foreign key (checkout_id) references public.stores(id) on delete cascade;

alter table public.stores drop constraint stores_integration_role_unique;
alter table public.stores drop constraint stores_integration_fk;
alter table public.stores drop column integration_id;

with ranked as (
  select id,
         row_number() over (partition by lower(name) order by created_at) as rn
  from public.stores
)
update public.stores s
set name = s.name || ' #' || left(s.id::text, 6)
from ranked r
where s.id = r.id and r.rn > 1;

create unique index stores_name_unique on public.stores (lower(name));
create index stores_external_url_idx
  on public.stores (external_base_url)
  where external_base_url is not null;

alter table public.integrations
  add constraint integrations_pair_unique unique (storefront_id, checkout_id);

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

create unique index integrations_one_active_per_storefront
  on public.integrations (storefront_id)
  where status = 'active';

alter table public.mappings drop constraint mappings_a_variant_unique;
alter table public.mappings
  add constraint mappings_pair_variant_unique unique (integration_id, store_a_variant_id);
