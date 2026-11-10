# Configuração externa da Shopify

Este guia cobre o que **não** pode ser feito apenas pelo código local: criar o app na Shopify, configurar URLs/escopos e autorizar a instalação automática no **código do tema** da Loja A.

A integração da vitrine **não usa app block, app embed ou theme app extension**. O backend instala automaticamente um snippet global e assets no tema publicado via Admin API (`themeFilesUpsert`), o que exige `write_themes` e exemption da Shopify. O app Shopify é usado para OAuth, Admin API, instalação do tema e webhooks.

## 0. Pré-requisitos

- Node.js 20.9+ (testado com Node 24).
- Uma conta de desenvolvedor Shopify/Partner e duas lojas de desenvolvimento (A e B) ou lojas reais.
- Um projeto Supabase.
- Acesso ao editor de código do tema da Loja A (ou Shopify CLI, se quiser usar `shopify theme push`).
- Para testar OAuth a partir da sua máquina, use um túnel HTTPS (por exemplo, `cloudflared`/`ngrok`) e defina `APP_URL` com a URL pública. A Shopify exige HTTPS no redirect; `localhost` serve apenas para o painel local e smoke tests.

Shopify CLI é opcional para este projeto:

```bash
npm install -g @shopify/cli@latest
shopify version
```

## 1. Criar um app Shopify por loja

Neste modelo, **cada loja Shopify tem seu próprio Client ID/Secret**, cadastrado no painel e cifrado no Supabase. Não existe Client ID/Secret global no `.env`.

Para cada loja (A e B de cada integração):

1. Crie um app/custom app no Dev Dashboard ou no admin daquela loja.
2. Configure o redirect URI exatamente como:
   ```text
   https://SEU_APP/api/auth/shopify/callback
   ```
3. Configure os escopos:
   ```text
   read_products,write_themes
   ```
4. Copie o **Client ID** e o **Client Secret** daquele app.
5. No painel, em **Lojas e instalação**, crie a integração e informe as credenciais da Loja A e da Loja B (quando Shopify).

O app é standalone: o painel é o Next.js; não é um app embutido no admin. O mesmo redirect URI serve para todas as lojas; cada loja tem seu próprio par de credenciais.

Cada loja faz OAuth com suas próprias credenciais; o token gerado fica cifrado no banco. A moeda e os escopos concedidos são gravados por loja.

### Por que `read_products,write_themes`?

- `read_products`: importar produtos, variantes, preços e moeda das duas lojas Shopify e revalidar preço/estoque.
- `write_themes`: ler o tema `MAIN` e instalar/atualizar o snippet e os assets via `themeFilesUpsert`.
- Não precisamos de `write_products`, pedidos, clientes ou pagamentos. Não pedimos protected customer data.

A documentação atual da Shopify condiciona `themeFilesUpsert` a `write_themes` **e** uma exemption para alterar arquivos de tema:

- <https://shopify.dev/docs/api/admin-graphql/2026-10/mutations/themeFilesUpsert>
- <https://shopify.dev/docs/api/usage/access-scopes#theme-permissions>

O escopo `write_themes` aparece na tela de consentimento OAuth da Shopify. **Não é possível concedê-lo silenciosamente nem ocultar essa tela**; a instalação automática só roda depois que o lojista aprova o escopo e a Shopify permite a exemption.

### Por que código no tema e não app block/app embed?

O requisito do projeto é que a integração viva no **código do tema**, sem blocos. O backend instala um único snippet global no `layout/theme.liquid`, que carrega o JS e intercepta o checkout padrão do carrinho. Não há app extension, app block, app embed nem etapa manual no editor de tema (quando a exemption é concedida).

A contrapartida é que a instalação automática altera o tema publicado; por isso o backend guarda o layout anterior como backup e oferece restauração no painel.

## 2. Supabase

1. Crie o projeto.
2. Rode [`0001_init.sql`](../supabase/migrations/0001_init.sql), [`0002_theme_installations.sql`](../supabase/migrations/0002_theme_installations.sql), [`0003_integrations.sql`](../supabase/migrations/0003_integrations.sql), [`0004_store_oauth_credentials.sql`](../supabase/migrations/0004_store_oauth_credentials.sql), [`0005_admin_settings.sql`](../supabase/migrations/0005_admin_settings.sql), [`0006_store_admin_extras.sql`](../supabase/migrations/0006_store_admin_extras.sql) e [`0007_store_pairs.sql`](../supabase/migrations/0007_store_pairs.sql) e [`0008_store_pairs_repair.sql`](../supabase/migrations/0008_store_pairs_repair.sql) no SQL Editor.
3. Copie `Project URL` e `service_role key` para `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY`.

Não crie policies públicas. O Next.js acessa com `service_role` apenas no servidor. Não há Edge Functions.

## 3. Criar a integração e conectar a Loja A

Você pode manter várias lojas e vários pares. Cada loja tem um tipo: **Vitrine** ou **Checkout**.

1. Suba o app (`npm run dev` ou deploy).
2. Entre em `/admin` com a senha.
3. Em **Lojas e instalação → Lojas cadastradas**, crie a loja **Vitrine** com nome único, domínio Shopify, Client ID/Secret e escopos.
4. Crie a loja **Checkout** (Shopify com Client ID/Secret ou site externo com URL/moeda).
5. Conecte cada loja Shopify por OAuth na lista de lojas.
6. Em **Pares Vitrine ↔ Checkout**, crie o par escolhendo a vitrine e o checkout. Marque **Ativar este par agora** se as duas lojas já estiverem prontas.
7. Uma vitrine pode ter vários pares, mas só um ativo. Um checkout pode atender várias vitrines.

O callback valida HMAC com o secret daquela loja, `state`, timestamp e domínio; o token é cifrado e salvo.

Se o callback falhar:

- `invalid_hmac`: Client secret errado, redirect diferente ou relógio do servidor fora de sincronia.
- `invalid_state`/`missing_state`: cookie expirou ou o navegador bloqueou cookies; tente novamente em menos de 10 minutos.
- `shop_mismatch`: o domínio do callback não é o mesmo iniciado no painel.

## 4. Conectar a Loja Checkout (Shopify)

Na lista de lojas, clique em **Conectar** na loja Checkout e repita o OAuth. Ela também precisa de `read_products` para importar o catálogo e revalidar preços. Depois do OAuth, a loja fica ativa para catálogo e checkout; nenhum token da Storefront API é obrigatório.

### 4.1 Checkout da Loja B

O checkout da Loja B Shopify é aberto por **cart permalink oficial** da Shopify, usando as variantes e quantidades validadas. Não é necessário criar nem configurar token da Storefront API.

Cada comprador recebe um checkout novo no domínio da Loja B.

## 5. Importar catálogos

No painel:

- **Produtos → Importar agora** para A;
- **Produtos → Importar agora** para B (Shopify).

A importação:

- pagina produtos e variantes via GraphQL Admin API;
- grava snapshots e moeda;
- marca itens ausentes como históricos;
- sinaliza mapeamentos ativos afetados como `needs_review`.

## 6. Mapear produtos

Em **Mapeamentos**:

1. Escolha a variante da Loja A.
2. Escolha a variante da Loja B (ou preencha os dados do site externo).
3. Confira SKU, títulos, opções, preço e moeda.
4. Confirme a identidade e, se houver diferença de preço, confirme também o preço.
5. Ative.

Regras bloqueantes:

- moedas diferentes;
- ausência de confirmação de identidade;
- diferença de preço sem confirmação;
- URL externa fora da origem da B.

## 7. Instalação automática no tema da Loja A

O painel tenta instalar o código ao conectar a Loja A por OAuth e depois de cada importação. O fluxo é:

1. encontra o tema `MAIN`;
2. lê `layout/theme.liquid` com `read_themes`/`write_themes`;
3. se o marcador ainda não existe, insere antes de `</body>`:
   ```liquid
   {%- comment -%} CSB_THEME_INSTALL_V1 {%- endcomment -%}
   {% render 'cross-store-bridge' %}
   ```
4. envia via `themeFilesUpsert`:
   - `snippets/cross-store-bridge.liquid`;
   - `assets/cross-store.js`;
   - `assets/cross-store.css`;
   - `layout/theme.liquid` (somente quando necessário);
5. guarda o layout original em `theme_installations.backup_layout`;
6. registra `installed`, `failed` ou `skipped` no painel. A gravação de arquivos é uma operação assíncrona (`job`); valide a vitrine após alguns segundos.

O snippet global:
- carrega o JS em todas as páginas para capturar UTMs com consentimento;
- na página de carrinho, intercepta o botão/link de checkout padrão;
- envia itens/quantidades ao backend;
- se todos os itens tiverem mapa, o backend cria o checkout da B e o navegador é redirecionado ao `checkoutUrl`;
- se algum item não tiver mapa, bloqueia e explica, oferecendo “Continuar na Loja A”;
- o checkout da B é aberto por cart permalink oficial;
- o comprador vê o aviso de loja responsável/domínio antes de seguir para a B.

### Se a Shopify negar

O painel mostra o erro e **não deixa o tema alterado**. Nesse caso:

- verifique se o app tem `write_themes` e a exemption;
- reconecte a Loja A para conceder o escopo novamente;
- use o botão **Instalar/atualizar no tema agora**;
- se a exemption for negada, use o fallback manual em [`theme-code/`](../theme-code).

### Fallback manual (somente se necessário)

1. Envie `theme-code/assets/cross-store.js` e `cross-store.css` para **Assets**.
2. Envie `theme-code/snippets/cross-store-bridge.liquid` para **Snippets**.
3. Ajuste `csb_api_base` para o `APP_URL`.
4. No `layout/theme.liquid`, antes de `</body>`:
   ```liquid
   {% render 'cross-store-bridge' %}
   ```
5. Teste no domínio publicado.

### Limitação de checkout dinâmico

Botões de checkout dinâmico (Shop Pay/Apple Pay/Google Pay) renderizados pela Shopify em iframe não podem ser interceptados pelo tema. A interceptação cobre o checkout padrão do carrinho. Se isso for crítico, avalie desativar esses botões no tema ou aceitar que eles sigam o fluxo nativo da Loja A.

## 8. Loja B externa (sem carrinho)

Em **Lojas e instalação → Loja B externa**, informe:

- nome exibido ao comprador;
- origem HTTPS, ex.: `https://loja-b.com` (sem caminho/query);
- moeda (precisa ser igual à da Loja A).

Depois mapeie cada variante da A informando a URL do **mesmo** produto na B. A URL precisa pertencer exatamente à mesma origem da URL base. O app não faz scraping nem fetch da URL externa; o comprador vê uma página de divulgação e só então é redirecionado.

A instalação automática atual foca no checkout padrão da B Shopify; para B externa não há carrinho/interceptação. Links `/go/<token>` podem ser usados em CTAs manuais do tema, se necessário.

## 9. Produção

- Use HTTPS no `APP_URL`. OAuth e cookies `Secure` exigem isso.
- Atualize a Redirect URL no Dev Dashboard para o domínio de produção.
- No ambiente de produção, rode **Instalar/atualizar no tema agora** (ou importe a Loja A) para atualizar o snippet/assets com o `APP_URL` de produção.
- Valide a instalação automática em um tema de desenvolvimento antes de publicar em produção.
- Configure `NODE_ENV=production`, `ALLOW_LOCALHOST_STOREFRONT=false`.
- Mantenha `TOKEN_ENCRYPTION_KEY`, `SESSION_SECRET`, `ADMIN_PASSWORD` e `SUPABASE_SERVICE_ROLE_KEY` no `.env` versionado (com o risco documentado). Os Client ID/Secret de cada app Shopify ficam cifrados no banco, cadastrados por loja.
- Se distribuir publicamente na App Store, implemente/atualize os webhooks de compliance (já presentes em `/api/webhooks/compliance`) e as políticas exigidas. Este repositório é uma base funcional, não um app já aprovado pela Shopify.
- Ao atualizar snippets/assets no repositório, rode **Instalar/atualizar no tema agora** (ou importe a Loja A) para atualizar o tema de produção.

## 10. Troubleshooting

| Sintoma | Causa provável | Ação |
| --- | --- | --- |
| `ORIGIN_NOT_ALLOWED` no console | domínio da vitrine não é o `shop_domain`/`primary_domain` salvo | reconecte a Loja A no domínio correto; em dev, use `ALLOW_LOCALHOST_STOREFRONT=true` apenas localmente |
| Instalação automática não roda | Loja A sem `write_themes`, sem exemption ou tema em processamento | reconecte A com `write_themes`, confirme a exemption e use **Instalar/atualizar no tema agora** |
| Tema foi alterado mas o checkout não é interceptado | snippet não está no layout, B desabilitada ou CSP do tema | confira `theme_installations`, o `layout/theme.liquid` e o console/CSP |
| Shopify negou alteração do tema | exemption ausente ou negada | use o fallback manual ou ajuste a distribuição/exemption do app |
| Checkout dinâmico (Shop Pay/Apple Pay) não é interceptado | botão em iframe da Shopify | limitação conhecida; use o checkout padrão do carrinho |
| Checkout interceptado retorna 409 com `NOT_MAPPED` | item do carrinho sem mapeamento ativo | mapeie a variante e reimporte se necessário; o comprador pode continuar na Loja A |
| `SOURCE_PRICE_CHANGED` / `DESTINATION_PRICE_CHANGED` | preço mudou desde o snapshot | reimporte o catálogo e reative o mapeamento após conferir |

| `CART_USER_ERRORS` | produto da B não publicado no canal/canal sem permissão, estoque ou variante inválida | confira publicação, estoque e permissões da Headless channel |
| `invalid_hmac` | secret/redirect/relógio | corrija no Dev Dashboard e no `.env` |
| Cookie de sessão não persiste | HTTPS/domínio ou SameSite | use o mesmo domínio do `APP_URL`; não abra o painel por IP diferente |
| CSP bloqueia `fetch` do tema | o tema define uma CSP que não inclui a origem do app | libere a origem em `connect-src` ou remova a CSP restritiva do tema |
| Transferência funciona no preview mas não no domínio | CORS pelo domínio não cadastrado / CSP do preview | teste no domínio publicado e reconecte a Loja A se o domínio mudou |
