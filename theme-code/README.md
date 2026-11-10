# Código do tema da Loja A

Este diretório contém o código que o painel instala automaticamente no tema da Loja A via Admin API (`themeFilesUpsert`). A instalação exige `write_themes` e a exemption da Shopify.

## Arquivos

```text
theme-code/
  assets/
    cross-store.js
    cross-store.css
  snippets/
    cross-store-bridge.liquid
```

## O que o código faz

- Carrega o JS em todas as páginas para capturar UTMs com consentimento.
- Na página de carrinho, intercepta o botão/link de checkout da Loja A.
- Envia itens/quantidades para `/api/public/transfers`.
- Se todos os itens tiverem mapeamento válido, o backend cria o checkout da B e o navegador é redirecionado ao `checkoutUrl` da B.
- Se houver item sem mapa, bloqueia e mostra o motivo, com opção de continuar no checkout da Loja A.
- O carrinho da Loja B é criado pelo **backend** via Storefront API; o token da B nunca fica no tema.
- O comprador vê o aviso de domínio/loja responsável antes de seguir para a B.

## Instalação automática

O painel tenta instalar ao sincronizar a Loja A. O instalador:

1. encontra o tema `MAIN`;
2. lê `layout/theme.liquid`;
3. insere `{% render 'cross-store-bridge' %}` antes de `</body>` (marcador idempotente);
4. envia o snippet e os assets com `themeFilesUpsert`;
5. guarda o layout original como backup.

Se a Shopify negar `write_themes`/exemption, o painel registra o erro e mantém o tema intacto.

## Instalação manual (fallback)

1. Envie os assets para **Assets**.
2. Envie `cross-store-bridge.liquid` para **Snippets**.
3. Ajuste `csb_api_base` para o `APP_URL`.
4. No `layout/theme.liquid`, antes de `</body>`:
   ```liquid
   {% render 'cross-store-bridge' %}
   ```
5. Salve e teste no domínio publicado.

## Observações

- A interceptação cobre o checkout padrão do carrinho. Botões de checkout dinâmico (Shop Pay/Apple Pay/Google Pay, quando renderizados em iframe pela Shopify) não podem ser interceptados pelo tema; eles continuam o fluxo nativo da Loja A.
- Se o tema tiver CSP própria, libere a origem do `APP_URL` em `connect-src`.
- O snippet global é instalado no layout; não é necessário app block, app embed ou edição manual por template.
- A instalação automática altera o tema. Faça backup/rollback pelo painel e teste em tema de desenvolvimento antes de produção.
