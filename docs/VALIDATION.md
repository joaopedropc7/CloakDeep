# Validação

## Executado neste ambiente

Data da validação: 2026-11-09.

### Testes automatizados

```bash
npm test
```

Resultado:

```text
✓ tests/attribution.test.ts (4 tests)
✓ tests/crypto.test.ts (4 tests)
✓ tests/mapping-rules.test.ts (4 tests)
✓ tests/oauth.test.ts (4 tests)
✓ tests/storefront.test.ts (4 tests)
✓ tests/transfer-flow.test.ts (8 tests)
✓ tests/theme-install.test.ts (4 tests)
✓ tests/admin-auth.test.ts (1 test)

Test Files  8 passed (8)
Tests       33 passed (33)
```

Cobertura funcional dos testes:

- allowlist de UTMs, rejeição de PII/credenciais, preservação de `_cs`;
- OAuth: HMAC, timestamp, domínio ancorado, escopos;
- AES-256-GCM com AAD, assinatura/expiração de tokens, hash de transferência;
- comparação A/B de SKU, opções, preço e moeda; URL externa mesma origem;
- cart permalink: token privado, `Shopify-Storefront-Buyer-IP`, `@inContext(visitorConsent)`, subtotal cobrado acima do esperado, variante inesperada e `checkoutUrl` fora do domínio;
- instalação automática no tema: injeção do render antes de `</body>`, upload de snippet/assets, idempotência, falta de `write_themes` e negação da Shopify;
- verificação de senha administrativa com scrypt;
- fluxo completo com Shopify/banco simulados: preparar carrinho, bloquear item sem mapa, bloquear mudança de preço A/B, consentimento de atribuição, idempotência e destino externo sem carrinho.

### Sintaxe do código do tema

- `node --check theme-code/assets/cross-store.js` passou.
- O snippet `theme-code/snippets/cross-store-bridge.liquid` e os assets JS/CSS foram revisados; o instalador automático monta o snippet com o `APP_URL`, insere o render no layout e envia os arquivos via `themeFilesUpsert`.
- Não há `shopify.app.toml` nem theme app extension. Cada loja tem Client ID/Secret próprios, cadastrados no painel e cifrados no Supabase; o HMAC do webhook é validado com o secret daquela loja.
- A compilação Liquid real do tema depende do tema e do editor da Loja A; não há Shopify CLI/credenciais neste ambiente.

### Typecheck

```bash
npm run typecheck
```

Sem erros.

### Build de produção

```bash
npm run build
```

Build concluído com Next.js 16.4.5 (Turbopack). Todas as rotas do painel, APIs, `/transfer/[token]` e `/go/[token]` foram compiladas. As rotas são dinâmicas (`ƒ`), o que é intencional para dados de sessão/banco.

### Smoke test HTTP

Ver seção “Smoke test” abaixo para o resultado obtido com `next start`.

## O que não pôde ser validado aqui

Não há credenciais de Shopify nem projeto Supabase neste ambiente. Portanto **não** foram executados:

- OAuth real em lojas de desenvolvimento;
- importação real via Admin API;
- redirecionamento real para o checkout da Loja B via cart permalink;
- instalação automática real no tema publicado da Loja A (exige `write_themes` + exemption);
- pedido real na Loja B e conferência de atributos do pedido;
- webhooks reais da Shopify;
- Redirect URL/HTTPS de produção.

Esses passos estão no roteiro abaixo e precisam ser executados com as credenciais do projeto.

## Roteiro E2E manual (duas lojas de desenvolvimento)

### Preparação

1. Aplicar as migrations `0001_init.sql`, `0002_theme_installations.sql`, `0003_integrations.sql`, `0004_store_oauth_credentials.sql`, `0005_admin_settings.sql`, `0006_store_admin_extras.sql`, `0007_store_pairs.sql` e `0008_store_pairs_repair.sql` no Supabase.
2. Criar o app Shopify, configurar `APP_URL` e redirect exato `APP_URL/api/auth/shopify/callback`, escopo `read_products,write_themes`.
3. Preencher `.env.local` com `npm run secrets:generate`.
4. `npm run dev`.
5. Garantir a exemption de theme files da Shopify. A instalação no tema é automática via `themeFilesUpsert`; não há app extension para publicar.

### Loja A

1. Criar 2 produtos na A, com variantes diferentes, SKUs e preços.
2. Criar a integração A+B no painel e conectar a A por OAuth com `read_products,write_themes`.
3. Importar o catálogo da A; o painel deve instalar automaticamente `snippets/cross-store-bridge.liquid` e os assets no tema `MAIN`, inserindo `{% render 'cross-store-bridge' %}` no layout. Conferir o status em **Lojas e instalação**.
4. Verificar que o layout antigo foi guardado como backup e que o botão de rollback aparece.

### Loja B Shopify

1. Criar os mesmos produtos/variantes na B. O SKU deve ser preferencialmente igual.
2. Selecionar a mesma integração, conectar a B por OAuth e importar.
3. Criar Headless channel/storefront e token privado com permissões de produtos e checkouts.
4. Salvar o token no painel.
5. Mapear uma variante com preço igual e outra com preço diferente.
6. Confirmar que a UI mostra as diferenças e exige os checkboxes.
7. Testar moeda diferente: a ativação deve ser bloqueada.

### Transferência

1. Adicionar ao carrinho da A uma variante mapeada e uma não mapeada.
2. Clicar no checkout padrão do carrinho da A (o snippet intercepta).
3. Confirmar HTTP 409 e a lista dos itens problemáticos; nada deve ser criado no banco (`transfer_sessions`). O comprador deve ver a opção “Continuar na Loja A”.
4. Remover o item sem mapa e clicar no checkout novamente.
5. Antes de clicar no checkout da A, conferir o aviso com nome da Loja B, domínio e responsabilidade pela venda/checkout.
6. Com consentimento de marketing no banner da A, clicar no checkout e confirmar o redirecionamento direto ao `checkoutUrl` da B. Sem consentimento, confirmar que as UTMs não são repassadas.
7. Opcionalmente, abrir `/transfer/<token>` para validar a página de fallback/divulgação.
8. Verificar no pedido da B:
   - itens e quantidades corretos;
   - atributos `csb_sale_owner`, `csb_source_store`, `csb_destination_domain`, `csb_transfer_id`;
   - UTMs presentes somente com consentimento.
9. Repetir o POST de checkout com o mesmo token: deve retornar o mesmo checkout, sem criar outro carrinho.

Para simular mudança de preço:

1. Depois de mapear, altere o preço na B.
2. Reimporte o catálogo da B (isso deve marcar o mapeamento como `needs_review`).
3. Tente transferir: deve bloquear com explicação.
4. Reative o mapeamento após conferir o novo preço.

### Loja B externa

1. Trocar a B para externa (`https://loja-b.exemplo`) e configurar a moeda.
2. Mapear uma variante informando a URL completa do mesmo produto na B.
3. Testar uma URL de outro domínio: deve ser rejeitada.
4. A opção B automática foca no checkout da B Shopify; para B externa, o checkout da A não é interceptado.
5. Se usar links `/go/<token>` manualmente, verificar a página com domínio e loja responsável.
6. Sem consentimento, a URL final não deve conter UTMs.
7. Com consentimento, a URL final pode conter apenas UTMs/click IDs da allowlist.

### Segurança

1. Tentar acessar `/admin` sem sessão: deve redirecionar ao login.
2. Testar login com senha errada 7 vezes: deve haver bloqueio temporário.
3. Chamar `/api/public/product` sem `Origin` ou com origem estranha: 403.
4. Inspecionar o HTML/JS do painel: nenhum token, client secret, service key ou hash de senha.
5. Verificar headers de segurança na resposta (`Content-Security-Policy`, `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`).
6. Acionar webhook com HMAC inválido: 401. Com HMAC válido de `shop/redact`: dados da loja removidos.

## Smoke test

Executado com `next start` e variáveis sintéticas, sem banco/Shopify reais:

```text
GET /                   200, página inicial
GET /admin              307 para /admin/login (sem sessão)
GET /admin/login        200, formulário de login
GET /transfer/invalid   404 (token inválido)
```

O smoke confirma que o build standalone inicia e que as rotas públicas/protegidas respondem sem expor segredos. A validação de banco e Shopify depende das credenciais externas descritas acima.
