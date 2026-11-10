"use client";

import { useState } from "react";
import { SubmitButton } from "@/components/submit-button";

type StoreType = "storefront" | "checkout";
type Platform = "shopify" | "external";

export function StoreCreateForm({
  action,
}: {
  action: (formData: FormData) => void | Promise<void>;
}) {
  const [storeType, setStoreType] = useState<StoreType>("checkout");
  const [platform, setPlatform] = useState<Platform>("shopify");
  const [currency, setCurrency] = useState("BRL");

  const isStorefront = storeType === "storefront";
  const isExternal = !isStorefront && platform === "external";

  function changeType(next: StoreType) {
    setStoreType(next);
    if (next === "storefront") setPlatform("shopify");
  }

  return (
    <form action={action} className="form-grid" style={{ marginTop: "0.75rem" }}>
      <div>
        <label htmlFor="store-name">Nome da loja</label>
        <input id="store-name" name="name" type="text" required />
      </div>
      <div>
        <label htmlFor="store-type">Tipo</label>
        <select
          id="store-type"
          name="store_type"
          value={storeType}
          onChange={(event) => changeType(event.target.value as StoreType)}
        >
          <option value="storefront">Vitrine</option>
          <option value="checkout">Checkout</option>
        </select>
      </div>

      {isStorefront ? (
        <>
          <input type="hidden" name="platform" value="shopify" />
          <div className="full">
            <p className="tiny muted" style={{ margin: 0 }}>
              A loja Vitrine é sempre Shopify. A moeda e o domínio público são lidos no OAuth.
            </p>
          </div>
        </>
      ) : (
        <>
          <div>
            <label htmlFor="store-platform">Plataforma</label>
            <select
              id="store-platform"
              name="platform"
              value={platform}
              onChange={(event) => setPlatform(event.target.value as Platform)}
            >
              <option value="shopify">Shopify</option>
              <option value="external">Site externo</option>
            </select>
          </div>
        </>
      )}

      {!isExternal ? (
        <>
          <div>
            <label htmlFor="store-domain">Domínio .myshopify.com</label>
            <input id="store-domain" name="shop_domain" type="text" placeholder="loja.myshopify.com" required />
          </div>
          <div>
            <label htmlFor="store-client-id">Client ID</label>
            <input id="store-client-id" name="client_id" type="text" required />
          </div>
          <div>
            <label htmlFor="store-client-secret">Client Secret</label>
            <input id="store-client-secret" name="client_secret" type="password" autoComplete="off" required />
          </div>
          <div>
            <label htmlFor="store-scopes">Escopos</label>
            <input
              key={isStorefront ? "storefront-scopes" : "checkout-scopes"}
              id="store-scopes"
              name="scopes"
              type="text"
              defaultValue={isStorefront ? "read_products,write_themes" : "read_products"}
            />
            <p className="tiny muted">
              {isStorefront
                ? "A Vitrine precisa de write_themes para instalar o snippet no tema."
                : "O Checkout só precisa ler o catálogo; nenhum código é instalado no tema dele."}
            </p>
          </div>
        </>
      ) : (
        <>
          <div className="full">
            <label htmlFor="store-external-url">Origem externa do checkout</label>
            <input
              id="store-external-url"
              name="external_base_url"
              type="url"
              placeholder="https://checkout.sua-loja.com"
              required
            />
            <p className="tiny muted">
              Informe somente a origem HTTPS, sem caminho ou query. Ex.:{" "}
              <code>https://checkout.sua-loja.com</code>.
            </p>
          </div>
          <div>
            <label htmlFor="store-currency">Moeda</label>
            <select
              id="store-currency"
              name="currency"
              value={currency}
              onChange={(event) => setCurrency(event.target.value)}
            >
              <option value="USD">Dólar (USD)</option>
              <option value="BRL">Real (BRL)</option>
              <option value="EUR">Euro (EUR)</option>
            </select>
            <p className="tiny muted">Usada para validar preços e exibir valores do checkout externo.</p>
          </div>
        </>
      )}

      <div className="full">
        <SubmitButton pendingLabel="Cadastrando...">Cadastrar loja</SubmitButton>
      </div>
    </form>
  );
}
