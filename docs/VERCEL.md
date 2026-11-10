# Deploy na Vercel

O projeto é um app Next.js com route handlers em Node.js e Supabase. Não usa Edge Functions do Supabase, nem funções Edge da Vercel.

## 1. Importar o repositório

1. Envie o projeto para o GitHub.
2. Na Vercel, **Add New → Project** e importe o repositório.
3. Framework: **Next.js** (detectado automaticamente).
4. Build Command: `npm run build`.
5. Install Command: `npm install`.
6. Node.js: 20.9+ (recomendado 24), conforme `package.json`.

O [`vercel.json`](../vercel.json) já define framework, build e install.

## 2. Configuração no `.env` versionado

Este projeto foi ajustado para usar [`.env`](../.env) como fonte única, inclusive na Vercel, **sem Environment Variables do painel**.

1. Preencha o [`.env`](../.env) na raiz com `APP_URL`, credenciais Shopify, Supabase, chaves de cifra/sessão e hash da senha admin.
2. Faça commit do `.env` no GitHub.
3. No build, `scripts/generate-runtime-env.mjs` lê o `.env` e gera `src/lib/env.generated.ts` (ignorado pelo Git), que é empacotado no servidor Next.js.
4. A Vercel apenas importa o repositório e executa `npm run build`; não é necessário cadastrar variáveis no painel.

### Aviso de segurança

Segredos no Git ficam no histórico do repositório. Se o repositório for público, qualquer pessoa poderá ler `SUPABASE_SERVICE_ROLE_KEY`, `TOKEN_ENCRYPTION_KEY`, `SESSION_SECRET` e o hash da senha admin. Os segredos dos apps Shopify ficam cifrados no Supabase, mas as credenciais de cada app são cadastradas no painel. Se for privado, o risco continua para todos com acesso e para clones/forks. Se houver exposição:

- rotacione o client secret Shopify e reconecte as lojas;
- rotacione a `service_role` do Supabase;
- gere novas `TOKEN_ENCRYPTION_KEY`/`SESSION_SECRET`;
- troque a senha administrativa.

A geração do módulo `src/lib/env.generated.ts` é necessária porque a Vercel pode não carregar `.env` em runtime de forma confiável; o arquivo gerado é embutido no bundle do servidor. Ele contém os segredos e não deve ser commitado.

### Variáveis esperadas

| Variável | Origem |
| --- | --- |
| `APP_URL` | URL pública da Vercel, com HTTPS |
| Client ID/Secret Shopify | cadastrados por loja no painel (cifrados no banco) |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | projeto Supabase |
| `TOKEN_ENCRYPTION_KEY`, `SESSION_SECRET` | `npm run secrets:generate` |
| `ADMIN_PASSWORD` | senha inicial escolhida por você; troca em `/admin/settings` |
| `CRON_SECRET` | protege `/api/cron/sync`; gerado no `.env` |
| `ALLOW_LOCALHOST_STOREFRONT` | `false` em produção |

## 3. Banco

Aplique no Supabase, nesta ordem:

1. [`0001_init.sql`](../supabase/migrations/0001_init.sql)
2. [`0002_theme_installations.sql`](../supabase/migrations/0002_theme_installations.sql)
3. [`0003_integrations.sql`](../supabase/migrations/0003_integrations.sql)
4. [`0004_store_oauth_credentials.sql`](../supabase/migrations/0004_store_oauth_credentials.sql)
5. [`0005_admin_settings.sql`](../supabase/migrations/0005_admin_settings.sql)
6. [`0006_store_admin_extras.sql`](../supabase/migrations/0006_store_admin_extras.sql)
7. [`0007_store_pairs.sql`](../supabase/migrations/0007_store_pairs.sql)
8. [`0008_store_pairs_repair.sql`](../supabase/migrations/0008_store_pairs_repair.sql)

Não há Edge Functions. O Next.js acessa o PostgreSQL com a `service_role` apenas no servidor.

## 3.1 Sincronização agendada

O [`vercel.json`](../vercel.json) registra um cron diário em `/api/cron/sync`. Cada execução sincroniza **uma** loja Shopify ativa, priorizando a que está há mais tempo sem sync. Isso evita estourar o tempo da função e distribui as lojas ao longo dos dias.

- A rota exige `CRON_SECRET` via `Authorization: Bearer ...`.
- A Vercel Cron também é aceita pelo header `x-vercel-cron` quando `VERCEL=1`.
- Para um scheduler externo, envie o Bearer token.
- Ajuste a frequência em [`vercel.json`](../vercel.json) conforme o plano da Vercel e o número de lojas.
- Se uma loja falhar, a próxima execução tenta novamente; erros de autenticação marcam a loja como `needs_reauth`.

O botão **Importar agora** continua disponível para sincronização manual.

## 4. Shopify

No Dev Dashboard:

- App URL: `https://SEU_DOMINIO`
- Redirect URL: `https://SEU_DOMINIO/api/auth/shopify/callback`
- Escopo: `read_products,write_themes`
- Embedded: desativado
- Solicite a exemption de theme files para `themeFilesUpsert`.

Depois do deploy:

1. Acesse `/admin`.
2. Cadastre as lojas como **Vitrine** ou **Checkout** e crie os pares Vitrine↔Checkout. Uma vitrine só pode ter um par ativo; um checkout pode atender várias vitrines.
3. Conecte a Loja A e a Loja B da integração selecionada por OAuth.
4. Reconecte a Loja A para conceder `write_themes` se ela já existia sem o escopo.
5. A instalação no tema roda automaticamente na conexão e no próximo sync.
4. Se a Shopify negar a exemption, o tema não é alterado; use o fallback manual em [`theme-code/`](../theme-code).

## 5. Domínio e OAuth

- Use o domínio de produção da Vercel (ou domínio customizado) em `APP_URL`.
- O redirect da Shopify precisa ser **exatamente** `APP_URL/api/auth/shopify/callback`.
- Cookies de sessão usam `Secure` em produção; por isso o painel deve ser acessado por HTTPS.
- Atualize o redirect URI em **cada app Shopify de cada loja** no Dev Dashboard/admin: `https://SEU_DOMINIO/api/auth/shopify/callback`. Não existe um `shopify.app.toml` único neste modelo.

## 6. Limites e observações

- O callback OAuth e o checkout têm `maxDuration = 60` para acomodar a instalação no tema e a criação do checkout.
- A instalação no tema é uma chamada assíncrona (`themeFilesUpsert`); valide a vitrine após alguns segundos.
- Não há escrita em filesystem no runtime; os assets do tema são gerados em build (`npm run theme:assets`, chamado no `prebuild`).
- Não configure `NODE_ENV` manualmente na Vercel; ela já define `production`.
- Se usar Preview Deployments, use um `APP_URL`/redirect separado ou não conecte OAuth de produção neles.

## 7. Checklist pós-deploy

- [ ] `GET https://SEU_DOMINIO/` responde 200.
- [ ] `/admin/login` abre e a senha funciona.
- [ ] OAuth da Loja A conclui e o token aparece como conectado.
- [ ] `write_themes` está nos escopos da Loja A.
- [ ] `theme_installations` mostra `installed` e o layout tem o marcador `CSB_THEME_INSTALL_V1`.
- [ ] OAuth da Loja B conclui e o checkout usa cart permalink.
- [ ] Catálogos importados e mapeamentos ativos.
- [ ] Checkout da A é interceptado; itens válidos vão ao checkout da B; item sem mapa bloqueia com explicação.
- [ ] Webhook de compliance responde 401 com HMAC inválido.
