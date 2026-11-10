# Segurança, privacidade e limitações

## Princípios

1. **Segredos só no servidor.** Nenhum token Shopify, chave Supabase ou hash de senha é enviado ao browser.
2. **Minimização de dados.** A integração não persiste nome, e-mail, telefone, endereço, CPF, cartão ou pedido do comprador.
3. **Transparência.** O comprador vê produto, variante, preço, moeda, domínio de destino e loja responsável antes de sair da Loja A.
4. **Falha fechada.** Divergência de preço, moeda, variante, estoque ou mapeamento bloqueia a transferência.
5. **Sem contorno de regras.** Não há cloaking, ocultação, troca de produto, conteúdo para revisor ou redirecionamento enganoso.

## Segredos versionados

Por decisão operacional, o `.env` é versionado no GitHub e o build gera um módulo de ambiente embutido no servidor (`src/lib/env.generated.ts`, ignorado pelo Git). Isso não é o padrão recomendado pela Shopify/Vercel: segredos ficam no histórico do repositório. Use repositório privado, restrinja acesso e rotacione todas as chaves se houver exposição. O módulo gerado fica fora do Git, mas o `.env` e os valores permanecem no repositório.

## Controles implementados

### Autenticação e sessão administrativa

- Senha verificada com `scrypt` (N=16384, r=8, p=1, salt aleatório, 64 bytes derivados), comparação em tempo constante.
- Sessão em cookie `HttpOnly`, `SameSite=Lax`, `Secure` em produção, assinado com HMAC-SHA256 e expiração de 8 horas.
- Rate limit no login: 6 tentativas por IP a cada 15 minutos (em memória, por instância).
- Todas as Server Actions chamam `requireAdmin()`. O layout protegido também redireciona sem sessão.

### OAuth Shopify

- `state` aleatório de 24 bytes, guardado em cookie assinado com expiração de 10 minutos e comparado no callback.
- Validação HMAC-SHA256 do callback em tempo constante, removendo `hmac`/`signature` e ordenando os parâmetros.
- Timestamp do callback com janela máxima de 10 minutos.
- Domínio validado por regex ancorada `^[a-z0-9][a-z0-9-]*\.myshopify\.com$` — impede `loja.myshopify.com.attacker.example`.
- Escopos concedidos verificados antes de persistir o token.
- Tokens de acesso com expiração e refresh token; renovação automática, com marcação `needs_reauth` em falha terminal.
- Token de acesso e refresh cifrados com AES-256-GCM; AAD vinculado ao domínio da loja.

### Banco de dados

- Acesso exclusivamente com `service_role` no servidor Next.js.
- RLS habilitado em todas as tabelas e nenhuma policy pública; `anon` e `authenticated` têm acesso revogado.
- `service_role` nunca é exposta em variável `NEXT_PUBLIC_*` nem em componentes client.
- Transferências guardam SHA-256 do token, não o token bruto.
- `claim_token` reduz a janela de corrida na criação de checkout.

### Superfície pública

- CORS restrito a `https://<shop_domain>` e `https://<primary_domain>` da Loja A cadastrada.
- `Origin` é obrigatório nas APIs públicas; `GET`/`POST`/`OPTIONS` verificados.
- Rate limit por IP (hash truncado) e rota.
- Tamanho máximo de corpo e validação de `Content-Type`.
- Preços enviados pelo browser são ignorados; o servidor consulta Admin API da A e da B.
- A Loja A da requisição é identificada pelo `shop` e precisa estar `active`; o domínio não é confiado a partir do corpo sem checagem.
- `checkoutUrl` validado: HTTPS e host da Loja B (ou subdomínio `*.myshopify.com`/`*.shopify.com`). Evita redirecionar para domínio arbitrário.
- URL externa: HTTPS (ou HTTP localhost em dev), sem credenciais, mesma origem da URL base da B. Nenhum fetch server-side da URL externa, evitando SSRF.
- Formulários de checkout/saída exigem mesma origem; o token opaco de alta entropia também funciona como capability.
- Webhooks Shopify: HMAC base64 em tempo constante, corpo máximo, `shop/redact` apaga a loja.

### XSS, CSRF e injeção

- React escapa todo o conteúdo renderizado; não há `dangerouslySetInnerHTML` com dados de API.
- O código do tema usa `textContent`/`createElement`, nunca `innerHTML` com dados remotos.
- Server Actions do Next.js têm proteção de origem; o OAuth usa `state`.
- Não há SQL concatenado: acesso via PostgREST/Supabase com parâmetros.
- CSP com `default-src 'self'`, `frame-ancestors 'none'`, `object-src 'none'`; `script-src` inclui `'unsafe-inline'` por necessidade do bootstrap do Next.js. Endurecer com nonces é uma evolução possível.

### Privacidade e atribuição

- Nenhum dado pessoal é gravado. O IP é usado transitoriamente para rate limit (hash) e, quando o token da Storefront for privado, encaminhado como `Shopify-Storefront-Buyer-IP` para a Shopify; não é persistido.
- UTMs/click IDs passam por allowlist e rejeitam valores com aparência de e-mail, telefone, cartão, JWT ou credenciais.
- O JS no tema só armazena atribuição se `Shopify.customerPrivacy.marketingAllowed()` permitir.
- A página de transferência/saída exige consentimento explícito adicional. Sem consentimento, a URL da B e os atributos do carrinho não recebem UTMs e `visitorConsent.marketing` é `false`.
- Nenhum parâmetro de atribuição é incluído em `/transfer` ou `/go` além dos UTMs de campanha, e o link opaco não contém dados de comprador.
- Compliance webhooks respondem a `customers/data_request`, `customers/redact` e `shop/redact`; como não há PII, os dois primeiros apenas registram o evento, e o último remove os dados da loja.
- Observações internas de mapeamento são texto operacional; não insira dados pessoais de compradores.

## Riscos residuais e mitigações operacionais

| Risco | Situação | Recomendação |
| --- | --- | --- |
| Rate limit em memória | por instância; reinícios zeram | usar WAF/limitador distribuído em produção |
| Senha administrativa única | sem MFA/SSO | colocar atrás de SSO corporativo ou proxy autenticado; usar senha longa |
| `service_role` comprometida | acesso total ao banco | rotação imediata, least privilege de secrets, auditoria do provedor |
| Chave de cifra comprometida | tokens legíveis | rotacionar `TOKEN_ENCRYPTION_KEY` com migração de recriptografia; revogar tokens Shopify |
| UTMs em atributos do pedido | aparecem no pedido da B | confirmar que é aceitável para o merchant; não enviam PII |
| Shopify pode ajustar preço/estoque | revalidação Admin API antes do permalink | falha fechada; comprador refaz a transferência |
| Produto "mesmo" é julgamento humano | sistema confere dados, não o objeto físico | dupla confirmação do administrador; revisão periódica |
| Preview do tema e CORS/CSP | ambiente de preview pode não refletir produção | testar no domínio publicado/`myshopify.com` |
| CSP `unsafe-inline` | necessário ao bootstrap | implementar nonces em uma evolução |
| `write_themes` é um escopo poderoso | pode alterar o tema | usar apenas na Loja A, com backup/rollback, teste em tema de desenvolvimento e revisão das alterações |
| Instalação automática pode conflitar com tema | `themeFilesUpsert` altera arquivos | marcador idempotente, backup do layout, rollback e fallback manual |
| Exemption de tema negada | Shopify bloqueia a escrita | manter tema intacto, registrar erro e oferecer fallback manual |
| Auditoria não é imutável | tabela comum | exportar logs para storage WORM se necessário |

## Retenção

- `transfer_sessions`: válidas por 30 minutos; linhas concluídas/falhas podem ser apagadas após o período operacional desejado. Não contêm PII.
- `audit_events`: sem PII; ajuste a retenção à política da empresa.
- Catálogo/mapeamentos: mantidos enquanto a integração existir.
- Tokens: removidos em `disconnectStore` e `shop/redact`.

Exemplo de limpeza periódica (executar fora do runtime, como operação administrativa no SQL Editor; não é uma Edge Function):

```sql
delete from public.transfer_sessions
where created_at < now() - interval '90 days';

delete from public.audit_events
where created_at < now() - interval '365 days';
```

## Rotação de segredos

1. **Client secret Shopify:** rotacione o secret do app de cada loja no Dev Dashboard; atualize as credenciais daquela loja no painel e reconecte o OAuth. Os tokens antigos podem exigir reconexão.
2. **`SESSION_SECRET`:** invalida sessões administrativas e links assinados em aberto. Faça deploy e entre novamente.
3. **`TOKEN_ENCRYPTION_KEY`:** não basta trocar a env; os tokens existentes precisam ser decifrados com a chave antiga e recifrados com a nova. Implemente um script de migração antes da troca.
4. **Senha administrativa:** troque em `/admin/settings`; o hash scrypt fica no banco. O `ADMIN_PASSWORD` do `.env` é apenas bootstrap e pode ser esvaziado depois.
5. **Storefront token da B:** gere outro na Headless channel e substitua no painel.

## O que este projeto deliberadamente não faz

- Não cria pedido na Loja A. A venda é concluída na Loja B, que aparece como responsável.
- Não processa pagamento, não vê dados de cartão e não acessa pedidos/clientes.
- Não importa catálogo de site externo nem faz scraping.
- Altera o tema da Loja A **somente** via Admin API `themeFilesUpsert`, no tema `MAIN`, com `write_themes` + exemption, backup do layout e rollback no painel.
- Não usa `ScriptTag`, não usa app block/app embed e não usa Edge Functions do Supabase.
- O OAuth de `write_themes` exige consentimento do lojista na Shopify; não há concessão silenciosa.
- O comprador não é redirecionado silenciosamente: vê o aviso de checkout/loja responsável antes de seguir à Loja B.
- Não esconde produtos sem mapeamento atrás de conteúdo diferente: simplesmente não há CTA de compra cruzada.
- Não diferencia revisores, não substitui produtos e não cria mecanismos para burlar políticas de anúncio ou pagamento.
