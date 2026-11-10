# Arquitetura

## Visão geral

O sistema é um app **standalone** em Next.js. Não é um app embutido no admin da Shopify e não usa App Bridge nem token exchange. A autenticação das lojas segue o **OAuth Authorization Code Grant** documentado para apps standalone:

- <https://shopify.dev/docs/apps/build/authentication-authorization/authenticate-standalone-apps>

A presença na vitrine da Loja A é feita por **código no tema**, instalado automaticamente pelo backend via Admin API `themeFilesUpsert` no tema `MAIN`. Não há app block, app embed ou `ScriptTag`.

- Snippet: `theme-code/snippets/cross-store-bridge.liquid`
- Assets: `theme-code/assets/cross-store.js` e `cross-store.css`
- A instalação exige `write_themes` e exemption da Shopify; o layout anterior é guardado em backup e há rollback no painel.
- A Shopify ainda exige consentimento OAuth para `write_themes`; isso não pode ser ocultado.

O checkout da Loja B Shopify é aberto por **cart permalink oficial**:

- <https://shopify.dev/docs/storefronts/headless/building-with-the-storefront-api/cart/manage>
- <https://shopify.dev/docs/apps/build/checkout/create-cart-permalinks>

## Componentes

### Next.js

Concentra 100% da lógica:

- OAuth Shopify e refresh de tokens;
- importação de produtos/variantes via GraphQL Admin API;
- regras de comparação e ativação de mapeamento;
- validação de carrinho e criação do checkout na Loja B;
- páginas de transparência (`/transfer/[token]`, `/go/[token]`);
- APIs públicas consumidas pelos snippets do tema;
- webhooks de compliance;
- painel administrativo.

### Supabase/PostgreSQL

Somente persistência. Não há Edge Functions, triggers de negócio, RPC de negócio nem `pg_cron`. As tabelas têm RLS habilitado e nenhuma policy; `anon`/`authenticated` não têm acesso. A `service_role` só existe no servidor.

### Shopify Admin API

- Loja A: `read_products` para importar catálogo e `write_themes` para instalar o código no tema publicado.
- Loja B Shopify: `read_products` para importar catálogo e validar preços/estoque no momento da transferência.
- Não solicitamos dados de clientes, pedidos ou pagamentos. Não há protected customer data.

### Shopify cart permalink

- Nenhum token da Storefront API é necessário.
- O backend monta `https://{loja}/cart/{variant}:{qty},...`, que abre o checkout da Loja B.
- O servidor valida produto, variante, preço, estoque e moeda via Admin API antes de redirecionar.
- Cada comprador recebe um checkout novo no domínio da Loja B.
- UTMs/click IDs só são acrescentados ao permalink com consentimento.

### Código no tema da Loja A

- `cross-store-bridge.liquid`: snippet global instalado no `layout/theme.liquid`; configura a API e carrega os assets.
- `cross-store.js` e `cross-store.css`: assets instalados no tema. O JS captura UTMs com consentimento e, na página de carrinho, intercepta o checkout padrão (opção B).
- A interceptação envia itens/quantidades ao backend; o backend valida tudo e abre o checkout da B por cart permalink.
- Com item sem mapa, a transferência é bloqueada com explicação e o comprador pode continuar no checkout normal da A.
- O comprador vê o aviso de loja responsável/domínio antes de seguir para a B; não há redirecionamento silencioso.
- Botões de checkout dinâmico em iframe (Shop Pay/Apple Pay/Google Pay) não são interceptados.
- A instalação automática altera o tema publicado; o layout anterior é guardado para rollback. Se a Shopify negar `write_themes`/exemption, o tema não é alterado e o fallback manual fica disponível.

## Modelo de dados

```text
stores (lojas independentes; store_type = storefront | checkout)
  ├─ products (snapshot atual + histórico)
  │    └─ variants
  └─ theme_installations (backup/status do tema da vitrine)

integrations (pares Vitrine ↔ Checkout)
  ├─ storefront_id → stores
  ├─ checkout_id   → stores
  └─ mappings (por variante da vitrine, com integration_id)

sync_runs
transfer_sessions
audit_events
```

Pontos importantes:

- Lojas são independentes e têm tipo `storefront` ou `checkout`. Uma vitrine só pode ser Shopify; um checkout pode ser Shopify ou externo. Nome, domínio e URL externa são únicos.
- Cada `integration` é um par Vitrine↔Checkout, único por combinação. Só pode existir **um par ativo por vitrine** (índice parcial no banco); um checkout pode atender várias vitrines.
- `products` e `variants` mantêm `is_current`. Importações marcam o snapshot anterior como histórico em vez de apagar, para que mapeamentos antigos possam ser sinalizados.
- `mappings` é único por `(integration_id, store_a_variant_id)`. A mesma variante da vitrine pode ter mapeamentos em pares diferentes. Estados: `draft`, `active`, `needs_review`, `disabled`.
- `mappings` guarda o snapshot de preço/moeda usado na ativação (`price_a`, `price_b`, `currency_*`).
- `transfer_sessions` guarda apenas dados de catálogo e atribuição; nunca PII. O token bruto nunca é persistido: guardamos SHA-256. `claim_token` evita dupla criação concorrente do checkout.
- `audit_events` não contém PII, tokens ou valores de atribuição.
- O token de acesso Shopify é cifrado com AES-256-GCM e AAD `store:<domínio>`.

## Máquina de estados da transferência

```text
prepareTransfer
  └─ valida A, B, mapeamentos, preços atuais, estoque e moeda
      ├─ qualquer problema → 409, issues[] para o comprador, nada é criado
      └─ ok → transfer_sessions(pending, token com hash, expira em 30 min)

POST /checkout (JSON ou form)
  ├─ claim atômico pending → processing
  ├─ revalida mapeamento, preços, estoque e moeda
  ├─ cart permalink na Loja B
  ├─ valida linhas, quantidades, variante e preço unitário devolvidos
  ├─ anexa UTMs ao checkoutUrl somente com consentimento
  ├─ status completed + checkoutUrl
  └─ devolve checkoutUrl; o JS da A redireciona o navegador
```

O fluxo automático (opção B) intercepta o checkout padrão da A e vai direto ao checkout da B depois da validação. A página `/transfer/<token>` continua disponível como fallback/manual e para sessões já criadas, mas não é uma etapa obrigatória do fluxo automático.

Falhas após o claim marcam `failed` e explicam o motivo na volta. Reenvios de uma sessão `completed` retornam o mesmo `checkoutUrl` (idempotência).

## Regras de mapeamento

- Moeda de A, B e da variante B precisa ser idêntica. Isso é bloqueante.
- Produto, variante, SKU, título e opções são exibidos lado a lado com flags de conferência.
- O administrador precisa confirmar explicitamente que é o mesmo produto real.
- Se o preço for diferente, uma segunda confirmação é obrigatória no mapeamento; o comprador vê o aviso de checkout da B e paga o preço da B.
- A ativação grava o snapshot. Se o preço mudar em qualquer loja depois disso, a transferência é bloqueada até o administrador revisar/reativar.
- Produto/variante excluído, despublicado ou indisponível bloqueia a transferência.
- Loja B externa: URL precisa ser HTTPS e pertencer à mesma origem da URL base configurada; o app não busca a URL externa no servidor (evita SSRF).

## APIs públicas

Todas exigem `shop=<myshopify domain>`, `Origin` do domínio cadastrado da Loja A e rate limit.

| Método | Rota | Uso |
| --- | --- | --- |
| `GET` | `/api/public/config` | modo (transfer/external), destino, enabled |
| `GET` | `/api/public/product` | mapeamento de uma variante e CTA |
| `POST` | `/api/public/transfers` | valida carrinho e cria sessão de transferência |
| `POST` | `/api/public/transfers/[token]/checkout` | mesma origem; cria checkout na B e redireciona |
| `POST` | `/api/public/go/[token]` | mesma origem; confirma saída e redireciona ao site externo |

Rotas administrativas usam Server Actions com sessão HttpOnly e a proteção de origem do Next.js.

## Atribuição

Allowlist em `src/lib/domain/attribution.ts`:

`utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term`, `utm_id`, `campaign_id`, `adset_id`, `ad_id`, `gclid`, `dclid`, `wbraid`, `gbraid`, `fbclid`, `msclkid`, `ttclid`, `twclid`, `li_fat_id`.

- O JS do tema só armazena UTMs se `Shopify.customerPrivacy.marketingAllowed()` permitir.
- O fluxo automático usa o consentimento de marketing da Customer Privacy API da A; a página de saída/transferência, quando usada manualmente, mantém a confirmação explícita adicional.
- O backend sanitiza novamente, descarta chaves desconhecidas e valores com aparência de e-mail, telefone, cartão, JWT ou token.
- Quando consentido, as UTMs vão para os atributos do carrinho (pedido na B) e para o `checkoutUrl`. O parâmetro `_cs` (consentimento codificado pela Shopify) é preservado.
- `visitorConsent` é enviado no `@inContext` apenas com o sinal de marketing consentido; nenhum outro sinal é inventado.

Referências de consentimento usadas:

- <https://shopify.dev/docs/api/customer-privacy>
- <https://shopify.dev/docs/storefronts/mobile-next/checkout-kit/privacy-compliance>
- <https://shopify.dev/docs/api/storefront/2026-10/input-objects/VisitorConsent>

## Decisões e alternativas descartadas

| Decisão | Motivo |
| --- | --- |
| App standalone + OAuth Authorization Code Grant | É o fluxo recomendado pela Shopify para apps fora do admin. |
| Instalação automática no tema | Código no tema sem app block/app embed, via `themeFilesUpsert`; requer `write_themes` + exemption, com backup/rollback e fallback manual. |
| Cart permalink Shopify | Mecanismo oficial que abre o checkout da Loja B sem depender de token da Storefront API. |
| Sem PII no banco | Minimização de dados; a Loja B coleta os dados no próprio checkout. |
| Sem chamadas server-side à URL externa | Evita SSRF e mantém a Loja B como destino de navegação, não de scraping. |
| Snapshot de preço + revalidação dupla | Impede cobrança divergente e mudanças silenciosas entre a vitrine e o checkout. |
| Token de transferência opaco com hash | O link é secreto, expira e não carrega dados pessoais ou IDs internos. |
