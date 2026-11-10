-- Credenciais OAuth por loja. Cada loja pode usar um app Shopify próprio.
alter table public.stores add column shopify_client_id text;
alter table public.stores add column shopify_client_secret_cipher text;
