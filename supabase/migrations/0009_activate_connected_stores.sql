-- Lojas Shopify que já concluíram o OAuth não precisam mais ficar pendentes
-- aguardando token da Storefront API. O checkout usa cart permalink.
update public.stores
set status = 'active'
where platform = 'shopify'
  and admin_token_cipher is not null
  and status = 'pending';
