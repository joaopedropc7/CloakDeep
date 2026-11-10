# ShopSync

Integração transparente entre vitrines **Shopify** e destinos **Shopify** ou **sites externos**, com várias lojas, pares vitrine↔checkout e foco em:

- mapeamento manual de produto/variante entre as lojas;
- bloqueio de qualquer transferência com item sem correspondência válida;
- checkout na Loja B Shopify via cart permalink oficial;
- links diretos por produto quando a Loja B é externa (sem carrinho);
- aviso explícito de saída de domínio e da loja responsável pela venda;
- atribuição (UTMs/click IDs) somente por allowlist e com consentimento;
- segredos apenas no servidor, com persistência no Supabase/PostgreSQL.

> **Não implementado por princípio:** cloaking, ocultação de produtos, diferenciação para revisores, substituição por produtos diferentes, redirecionamentos enganosos ou qualquer mecanismo para contornar regras de anúncios/checkout. O comprador sempre vê o produto real, o preço real, o domínio de destino e a loja vendedora.

## Stack

- **Next.js 16 (App Router) + TypeScript** — toda a lógica de negócio.
- **Supabase PostgreSQL** — apenas persistência, acessada exclusivamente no servidor com `service_role`.
- **Shopify Admin API 2026-10** — OAuth, lojas, produtos e variantes.
- **Shopify cart permalink** — abertura do checkout da Loja B com variantes e quantidades validadas, sem token da Storefront API.
- **Lojas independentes + pares Vitrine↔Checkout** — cada loja tem tipo, nome e credenciais próprias; uma vitrine pode ter vários pares, mas só um ativo; um checkout pode atender várias vitrines.
- **`write_themes` + instalação automática no tema** — o snippet é inserido no layout da Loja A via Admin API (`themeFilesUpsert`); sem app block/app embed. Requer exemption da Shopify.
- **Vitest** — 39 testes de unidade e de fluxo com Shopify/banco simulados.
- **Operação administrativa** — integrações com renomear/desativar/excluir, edição de loja, teste de conexão, escopos por loja, auto-mapeamento por SKU, fila de revisão e transferências filtradas com detalhe.
- **Catálogo agendado** — cron diário sincroniza uma loja por execução, além da importação manual.

## Arquitetura em uma tela

```text
Comprador na Loja A (Shopify)
        │
        └─ snippet global no layout ──► intercepta o checkout do carrinho
                                        └─ POST /api/public/transfers
                                        ├─ valida TODOS os itens
                                        ├─ consulta preço/estoque atuais A e B
                                        ├─ bloqueia se houver divergência
                                        ├─ cria sessão opaca (token com hash)
                                        └─ POST /checkout (JSON, mesma origem)
                                                ├─ revalida tudo
                                                ├─ cart permalink na B
                                                └─ devolve checkoutUrl
                                                        │
                                                        ▼
                                        navegador redireciona ao checkout B
                                        (aviso de loja/domínio aparece acima
                                         do botão de checkout da A)
```

Para **Loja B externa** não há interceptação de carrinho; o fluxo de carrinho continua na Loja A. Links diretos para `/go/<token>` podem ser usados em conteúdo/CTA próprio do tema, mas a integração automática atual é focada no checkout da B Shopify.

## Começo rápido

### 1. Instalar dependências e validar

```bash
npm install
npm test
npm run typecheck
npm run build
```

### 2. Criar o banco

No Supabase, crie um projeto e aplique as migrations [`0001_init.sql`](supabase/migrations/0001_init.sql), [`0002_theme_installations.sql`](supabase/migrations/0002_theme_installations.sql), [`0003_integrations.sql`](supabase/migrations/0003_integrations.sql), [`0004_store_oauth_credentials.sql`](supabase/migrations/0004_store_oauth_credentials.sql), [`0005_admin_settings.sql`](supabase/migrations/0005_admin_settings.sql), [`0006_store_admin_extras.sql`](supabase/migrations/0006_store_admin_extras.sql) e [`0007_store_pairs.sql`](supabase/migrations/0007_store_pairs.sql) e [`0008_store_pairs_repair.sql`](supabase/migrations/0008_store_pairs_repair.sql) e [`0009_activate_connected_stores.sql`](supabase/migrations/0009_activate_connected_stores.sql) pelo SQL Editor ou CLI. Não há Edge Functions. RLS fica habilitado e sem policies públicas; a `service_role` é usada apenas no servidor.

### 3. Configurar variáveis

O [`.env`](.env) é a fonte única de configuração e é versionado. Preencha `APP_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `TOKEN_ENCRYPTION_KEY`, `SESSION_SECRET` e `ADMIN_PASSWORD`. Os Client ID/Secret da Shopify são cadastrados **por loja** no painel, não no `.env`. Gere as chaves com:

```bash
npm run secrets:generate
```

O build lê o `.env` e gera `src/lib/env.generated.ts` (ignorado pelo Git), então a Vercel não precisa de Environment Variables no painel. **Atenção:** segredos no GitHub ficam no histórico; use repositório privado e rotacione se houver exposição. Guia: [docs/VERCEL.md](docs/VERCEL.md).

### 4. Rodar

```bash
npm run dev
```

Abra `http://localhost:3000/admin`, entre com a senha gerada e siga o checklist. Em **Lojas**, cadastre cada loja e abra o detalhe para editar, conectar e importar. Em **Pares**, monte as combinações Vitrine↔Checkout. Uma vitrine pode ter vários pares, mas só um ativo.

### 5. Instalação automática no tema

A Loja A é conectada por OAuth com `read_products,write_themes`. Ao conectar a Loja A e ao importar o catálogo, o backend:

1. encontra o tema `MAIN`;
2. lê `layout/theme.liquid`;
3. insere `{% render 'cross-store-bridge' %}` antes de `</body>` (marcador idempotente);
4. envia `snippets/cross-store-bridge.liquid` e os assets via `themeFilesUpsert`;
5. guarda o layout anterior como backup e registra o status.

A instalação automática exige que a Shopify conceda `write_themes` e a **exemption para alterar arquivos de tema**. A Shopify ainda exige que o lojista aprove o escopo no OAuth; isso não pode ser ocultado nem contornado. Se a Shopify negar, o painel mantém o tema intacto e oferece o fallback manual em [`theme-code/`](theme-code).

O snippet intercepta o checkout padrão do carrinho da A. Se todos os itens tiverem mapeamento válido, o backend cria a transferência e o navegador é redirecionado ao checkout da B via cart permalink oficial. Se houver item sem mapa, a transferência é bloqueada com explicação, e o comprador pode continuar no checkout normal da A. O aviso de checkout/loja responsável aparece acima do botão de checkout da A; não há redirecionamento silencioso.

## Fluxos

### Loja B Shopify

1. Conecte A e B por OAuth Authorization Code Grant (`read_products`; a A também precisa de `write_themes`).
2. Importe produtos/variantes das duas lojas.
3. Não é necessário configurar token da Storefront API; o checkout usa cart permalink oficial da Shopify.
4. Ative os mapeamentos conferindo produto, variante, SKU, opções, preço e moeda.
5. No carrinho da Loja A, o snippet global intercepta o checkout, envia itens/quantidades para a API e, se tudo estiver válido, redireciona diretamente ao checkout da B.
6. A API valida tudo novamente e abre o checkout da B por cart permalink.

### Loja B externa

1. Configure a origem HTTPS (sem caminho) da B e a moeda.
2. Mapeie cada variante da A informando a URL do **mesmo** produto no domínio da B, título, variante, SKU, preço e moeda.
3. O comprador vê a página de saída, com domínio e loja responsável, e só então é redirecionado. Sem carrinho.

## Segurança e privacidade

- Tokens Shopify são cifrados com AES-256-GCM e AAD por loja; nunca são enviados ao browser.
- Sessão administrativa em cookie HttpOnly assinado (HMAC), senha com scrypt.
- OAuth com `state` assinado, validação de HMAC, domínio ancorado em `.myshopify.com` e janela de tempo.
- Nenhum dado pessoal de comprador é persistido. URLs não carregam e-mail, telefone, token ou credencial.
- UTMs/click IDs só entram em allowlist; valores com aparência de PII/credencial são descartados.
- O repasse de UTMs à Loja B respeita a Customer Privacy API da Shopify; o comprador vê o aviso de loja/domínio antes de sair da A. O repasse só ocorre com consentimento de marketing.
- CORS restrito ao domínio da Loja A; rate limit por IP; validações de host no `checkoutUrl`; URLs externas restritas à origem configurada.
- Webhooks de compliance com verificação HMAC; `shop/redact` apaga os dados da loja.

### Consentimento e transparência

- O escopo `write_themes` sempre aparece na tela de consentimento OAuth da Shopify. Não é possível concedê-lo silenciosamente; a instalação automática começa somente depois da aprovação.
- O comprador sempre vê o aviso de que o checkout será concluído na Loja B, com o domínio e a loja responsável. Não há redirecionamento silencioso para outro domínio.
- A instalação no tema é automática **depois** dessa autorização; não há uma segunda confirmação de instalação no painel.

Detalhes em [docs/SECURITY.md](docs/SECURITY.md).

## Documentação

- [Arquitetura e modelo de dados](docs/ARCHITECTURE.md)
- [Configuração externa da Shopify](docs/SHOPIFY-SETUP.md)
- [Segurança e limitações](docs/SECURITY.md)
- [Validação executada e roteiro E2E](docs/VALIDATION.md)
- [Deploy na Vercel](docs/VERCEL.md)

## Estrutura

```text
src/app/                  rotas Next.js, painel, páginas públicas e APIs
src/lib/auth.ts           sessão administrativa, scrypt, cookies assinados
src/lib/crypto.ts         AES-256-GCM, HMAC, tokens opacos
src/lib/shopify/          OAuth, Admin API e cart permalink
src/lib/domain/           regras de mapeamento e atribuição (puras/testáveis)
src/lib/services/         orquestração: OAuth, catálogo, mapeamentos, transferência
src/lib/db/               repositórios Supabase
supabase/migrations/      schema PostgreSQL + RLS
theme-code/               snippet global e assets JS/CSS instalados automaticamente no tema da Loja A
tests/                    testes de unidade e fluxo
docs/                     guias operacionais
```

## Deploy

O projeto está preparado para a Vercel (`vercel.json`, build `npm run build`, runtime Node.js). O `.env` versionado é lido no build e o módulo gerado é embutido no servidor; não é necessário cadastrar variáveis no painel da Vercel. Veja [docs/VERCEL.md](docs/VERCEL.md) e o aviso de segurança sobre segredos no Git.

## Limitações conhecidas

- Lojas independentes com tipo Vitrine ou Checkout. Uma vitrine pode ter vários pares/rascunhos, mas apenas um par ativo por vitrine. Um checkout pode ser usado por várias vitrines. Loja, nome, domínio e URL externa não podem se repetir.
- Exige a mesma moeda entre A e B (moeda de loja, não presentment currency de Markets); preços são comparados com o snapshot do mapeamento. Alterações bloqueiam a transferência até revisão manual.
- A transferência cobre variantes padrão. Selling plans/assinaturas, bundles, gift cards, descontos do carrinho da A e sessão de cliente da A não são transportados; o checkout da B aplica as próprias regras de frete, impostos, descontos e pagamento.
- O checkout é o checkout web da Shopify da Loja B; a Loja A não cria pedido nem processa o pagamento.
- O checkout da B Shopify usa cart permalink oficial; nenhum token da Storefront API é solicitado ou usado. O projeto não cria tokens automaticamente.
- O OAuth com `write_themes` exige aprovação do lojista na tela de consentimento da Shopify; não é possível conceder o escopo silenciosamente.
- Botões de checkout dinâmico (Shop Pay/Apple Pay/Google Pay em iframe) não são interceptados pelo tema; o checkout padrão do carrinho é.
- A instalação automática altera o tema publicado e exige `write_themes` + exemption da Shopify. Se a Shopify negar, o tema não é alterado e o fallback manual fica disponível.
- Rate limit em memória é por instância. Em produção, adicione um limitador distribuído/WAF.
- O fluxo de loja externa é manual por natureza: não há importação nem validação automática do catálogo externo. O administrador confirma a identidade e a URL é validada contra a origem da B.
