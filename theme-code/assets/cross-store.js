(function () {
  "use strict";

  if (window.__CROSS_STORE_BRIDGE_LOADED__) return;
  window.__CROSS_STORE_BRIDGE_LOADED__ = true;

  var ALLOWED_KEYS = [
    "utm_source",
    "utm_medium",
    "utm_campaign",
    "utm_content",
    "utm_term",
    "utm_id",
    "campaign_id",
    "adset_id",
    "ad_id",
    "gclid",
    "dclid",
    "wbraid",
    "gbraid",
    "fbclid",
    "msclkid",
    "ttclid",
    "twclid",
    "li_fat_id",
  ];
  var STORAGE_KEY = "csb_attribution_v1";
  var privacyReady = null;

  function config() {
    var node = document.querySelector("[data-csb-config]");
    if (!node) return null;
    var apiBase = (node.getAttribute("data-api-base") || "").replace(/\/+$/, "");
    if (!apiBase) return null;
    try {
      var parsed = new URL(apiBase);
      if (parsed.protocol !== "https:" && parsed.hostname !== "localhost" && parsed.hostname !== "127.0.0.1") {
        return null;
      }
      apiBase = parsed.toString().replace(/\/+$/, "");
    } catch (error) {
      return null;
    }
    return {
      apiBase: apiBase,
      shop: node.getAttribute("data-shop") || "",
      template: node.getAttribute("data-template") || "",
      sourceName: node.getAttribute("data-shop-name") || "Loja A",
    };
  }

  function element(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  function clear(node) {
    while (node && node.firstChild) node.removeChild(node.firstChild);
  }

  function looksSensitive(value) {
    return (
      value.indexOf("@") !== -1 ||
      /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+/.test(value) ||
      /\b(shpat_|shpca_|shprt_|shpss_|shpua_)/i.test(value) ||
      /\b(password|senha|secret|token|authorization|card_number|cpf|cnpj)\b/i.test(value)
    );
  }

  function loadPrivacy() {
    if (privacyReady) return privacyReady;
    privacyReady = new Promise(function (resolve) {
      try {
        if (!window.Shopify) return resolve(false);
        if (window.Shopify.customerPrivacy) return resolve(true);
        if (typeof window.Shopify.loadFeatures !== "function") return resolve(false);
        var settled = false;
        function done() {
          if (settled) return;
          settled = true;
          resolve(Boolean(window.Shopify && window.Shopify.customerPrivacy));
        }
        window.Shopify.loadFeatures(
          [{ name: "consent-tracking-api", version: "0.2" }],
          done,
        );
        window.setTimeout(done, 2500);
      } catch (error) {
        resolve(false);
      }
    });
    return privacyReady;
  }

  function marketingAllowedNow() {
    try {
      return Boolean(
        window.Shopify &&
          window.Shopify.customerPrivacy &&
          window.Shopify.customerPrivacy.marketingAllowed(),
      );
    } catch (error) {
      return false;
    }
  }

  function readStored() {
    try {
      var raw = window.sessionStorage.getItem(STORAGE_KEY);
      if (!raw) return {};
      var parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
      var result = {};
      ALLOWED_KEYS.forEach(function (key) {
        if (
          typeof parsed[key] === "string" &&
          parsed[key].length <= 200 &&
          !looksSensitive(parsed[key])
        ) {
          result[key] = parsed[key];
        }
      });
      return result;
    } catch (error) {
      return {};
    }
  }

  function readFromLocation() {
    var params = new URLSearchParams(window.location.search);
    var result = {};
    var count = 0;
    ALLOWED_KEYS.forEach(function (key) {
      if (count >= 20) return;
      var value = params.get(key);
      if (!value || value.length > 200) return;
      if (/[\u0000-\u001f\u007f]/.test(value)) return;
      if (looksSensitive(value)) return;
      result[key] = value;
      count += 1;
    });
    return result;
  }

  async function currentAttribution() {
    await loadPrivacy();
    if (!marketingAllowedNow()) {
      try {
        window.sessionStorage.removeItem(STORAGE_KEY);
      } catch (error) {
        /* ignore */
      }
      return {};
    }
    var merged = Object.assign({}, readStored(), readFromLocation());
    try {
      if (Object.keys(merged).length > 0) {
        window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
      }
    } catch (error) {
      /* storage is optional */
    }
    return merged;
  }

  async function readError(response) {
    try {
      var body = await response.json();
      if (body && body.error) return body.error;
      return { message: "Não foi possível concluir a operação." };
    } catch (error) {
      return { message: "Não foi possível concluir a operação." };
    }
  }

  async function fetchConfig(cfg) {
    try {
      var response = await fetch(
        cfg.apiBase + "/api/public/config?shop=" + encodeURIComponent(cfg.shop),
        { credentials: "omit", headers: { Accept: "application/json" } },
      );
      if (!response.ok) return null;
      return await response.json();
    } catch (error) {
      return null;
    }
  }

  async function fetchCartItems() {
    try {
      var response = await fetch("/cart.js", {
        credentials: "same-origin",
        headers: { Accept: "application/json" },
      });
      if (!response.ok) return [];
      var cart = await response.json();
      return (cart.items || [])
        .map(function (item) {
          return {
            variantId: /^\d+$/.test(String(item.variant_id))
              ? "gid://shopify/ProductVariant/" + item.variant_id
              : "",
            quantity: item.quantity,
          };
        })
        .filter(function (item) {
          return item.variantId && item.quantity > 0;
        });
    } catch (error) {
      return [];
    }
  }

  async function postTransfer(cfg, items) {
    var attribution = await currentAttribution();
    var consent = { marketing: Object.keys(attribution).length > 0 };
    try {
      var response = await fetch(
        cfg.apiBase + "/api/public/transfers?shop=" + encodeURIComponent(cfg.shop),
        {
          method: "POST",
          credentials: "omit",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ items: items, attribution: attribution, consent: consent }),
        },
      );
      if (!response.ok) {
        return { ok: false, error: await readError(response) };
      }
      var result = await response.json();
      if (!result || typeof result.transferToken !== "string") {
        return { ok: false, error: { message: "Resposta inválida da integração." } };
      }
      return { ok: true, transferToken: result.transferToken };
    } catch (error) {
      return {
        ok: false,
        error: { message: "Não foi possível falar com a integração. Tente novamente." },
      };
    }
  }


  async function postCheckout(cfg, transferToken, attributionConsent) {
    try {
      var response = await fetch(
        cfg.apiBase +
          "/api/public/transfers/" +
          encodeURIComponent(transferToken) +
          "/checkout",
        {
          method: "POST",
          credentials: "omit",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ attribution_consent: attributionConsent }),
        },
      );
      if (!response.ok) {
        return { ok: false, error: await readError(response) };
      }
      var result = await response.json();
      if (!result || typeof result.checkoutUrl !== "string") {
        return { ok: false, error: { message: "Resposta inválida do checkout." } };
      }
      return { ok: true, checkoutUrl: result.checkoutUrl };
    } catch (error) {
      return {
        ok: false,
        error: { message: "Não foi possível criar o checkout da loja parceira." },
      };
    }
  }

  function textOf(node) {
    return String(node && (node.innerText || node.value || node.getAttribute("aria-label") || ""))
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  }

  function isCheckoutControl(node) {
    if (!node || !node.matches) return false;
    if (node.closest(".csb-checkout-notice")) return false;
    if (node.matches('button[name="checkout"], input[name="checkout"], input[type="submit"][name="checkout"]')) {
      return true;
    }
    if (node.matches('button, input[type="submit"]')) {
      var text = textOf(node);
      if (text && text.length <= 80 && text.indexOf("checkout") !== -1) return true;
    }
    if (node.matches("a[href]")) {
      try {
        var url = new URL(node.href, window.location.origin);
        if (url.origin !== window.location.origin) return false;
        if (url.pathname === "/checkout") return true;
        var linkText = textOf(node);
        return linkText.length <= 80 && linkText.indexOf("checkout") !== -1;
      } catch (error) {
        return false;
      }
    }
    return false;
  }

  function checkoutControls() {
    var controls = [];
    document
      .querySelectorAll('button, input[type="submit"], input[name="checkout"], a[href]')
      .forEach(function (node) {
        if (isCheckoutControl(node)) controls.push(node);
      });
    return controls;
  }

  function buildUi(control, publicConfig, cfg) {
    var root = element("div", "csb-checkout-notice");
    root.hidden = true;

    var issues = element("div", "csb-checkout-issues");
    issues.setAttribute("role", "alert");
    issues.hidden = true;
    root.appendChild(issues);

    var anchor = control.closest("form") || control;
    if (anchor && anchor.parentNode) {
      anchor.parentNode.insertBefore(root, anchor);
    } else {
      document.body.appendChild(root);
    }
    return {
      root: root,
      issues: issues,
      busy: false,
      cfg: cfg,
      destinationName: publicConfig.destination.name,
      loading: null,
    };
  }


  function showLoading(ui) {
    if (ui.loading) return;
    var overlay = element("div", "csb-checkout-loading");
    overlay.setAttribute("role", "status");
    overlay.setAttribute("aria-live", "assertive");
    overlay.setAttribute("aria-busy", "true");

    var card = element("div", "csb-checkout-loading__card");
    var spinner = element("span", "csb-checkout-loading__spinner");
    spinner.setAttribute("aria-hidden", "true");
    var title = element("strong", "csb-checkout-loading__title", "Preparando seu checkout...");
    var text = element(
      "span",
      "csb-checkout-loading__text",
      "Aguarde enquanto validamos os itens e abrimos o checkout da " +
        (ui.destinationName || "loja de destino") +
        ".",
    );
    card.appendChild(spinner);
    card.appendChild(title);
    card.appendChild(text);
    overlay.appendChild(card);
    document.body.appendChild(overlay);
    ui.loading = overlay;
  }

  function hideLoading(ui) {
    if (!ui.loading) return;
    if (ui.loading.parentNode) ui.loading.parentNode.removeChild(ui.loading);
    ui.loading = null;
  }

  function showIssues(ui, error) {
    ui.root.hidden = false;
    clear(ui.issues);
    ui.issues.hidden = false;
    ui.issues.appendChild(
      element("p", "csb-checkout-error", error.message || "A transferência foi bloqueada."),
    );
    if (Array.isArray(error.issues) && error.issues.length > 0) {
      var list = element("ul", "csb-checkout-issues-list");
      error.issues.forEach(function (issue) {
        list.appendChild(element("li", "", issue.message || "Item sem correspondência."));
      });
      ui.issues.appendChild(list);
    }
    var fallback = element("a", "csb-checkout-fallback", "Continuar na Loja A");
    fallback.href = "/checkout";
    ui.issues.appendChild(fallback);
  }

  async function runTransfer(ui) {
    if (ui.busy) return;
    ui.busy = true;
    if (!document.body.contains(ui.root)) {
      ui.root.classList.add("csb-checkout-notice--floating");
      document.body.appendChild(ui.root);
    }
    ui.root.classList.add("csb-checkout-busy");
    ui.root.hidden = true;
    clear(ui.issues);
    ui.issues.hidden = true;

    try {
      var items = await fetchCartItems();
      if (items.length === 0) {
        window.location.assign("/checkout");
        return;
      }
      var prepared = await postTransfer(ui.cfg, items);
      if (!prepared.ok) {
        showIssues(ui, prepared.error);
        return;
      }
      var attribution = await currentAttribution();
      var checkout = await postCheckout(
        ui.cfg,
        prepared.transferToken,
        Object.keys(attribution).length > 0,
      );
      if (!checkout.ok) {
        showIssues(ui, checkout.error);
        return;
      }
      keepLoading = true;
      window.location.assign(checkout.checkoutUrl);
    } catch (error) {
      showIssues(ui, { message: "Não foi possível preparar a transferência." });
    } finally {
      if (!keepLoading) hideLoading(ui);
      ui.busy = false;
      ui.root.classList.remove("csb-checkout-busy");
    }
  }

  function bindControl(control, ui) {
    if (!control || control.getAttribute("data-csb-bound") === "1") return;
    control.setAttribute("data-csb-bound", "1");
    control.addEventListener(
      "click",
      function (event) {
        if (event.__csbBypass) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        void runTransfer(ui);
      },
      true,
    );
  }

  function bindDocumentClicks(ui) {
    if (document.documentElement.getAttribute("data-csb-document-bound") === "1") return;
    document.documentElement.setAttribute("data-csb-document-bound", "1");
    document.addEventListener(
      "click",
      function (event) {
        if (event.__csbBypass) return;
        var target = event.target;
        if (!target || !target.closest) return;
        if (target.closest(".csb-checkout-notice")) return;
        var control = target.closest('button, input[type="submit"], input[name="checkout"], a[href]');
        if (!control || !isCheckoutControl(control)) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        void runTransfer(ui);
      },
      true,
    );
  }

  function bindCartForms(ui) {
    document.querySelectorAll('form[action*="/cart"]').forEach(function (form) {
      if (form.getAttribute("data-csb-form-bound") === "1") return;
      form.setAttribute("data-csb-form-bound", "1");
      form.addEventListener(
        "submit",
        function (event) {
          if (event.__csbBypass) return;
          var submitter = event.submitter;
          if (submitter && submitter.name && submitter.name !== "checkout") return;
          if (!form.querySelector('[name="checkout"]')) return;
          event.preventDefault();
          event.stopImmediatePropagation();
          void runTransfer(ui);
        },
        true,
      );
    });
  }


  function withCheckoutMarker(url) {
    try {
      var next = new URL(url, window.location.href);
      next.searchParams.set("shopsync_checkout", "1");
      return next.toString();
    } catch (error) {
      return url + (url.indexOf("?") === -1 ? "?" : "&") + "shopsync_checkout=1";
    }
  }

  function numericVariantId(form) {
    var input = form.querySelector('input[name="id"], select[name="id"]');
    var value = input ? String(input.value || "").trim() : "";
    return /^\d+$/.test(value) ? value : "";
  }

  async function prepareExternalProductForm(cfg, form) {
    if (form.getAttribute("data-csb-external-prepared") === "1") return;
    var numeric = numericVariantId(form);
    if (!numeric) return;
    form.setAttribute("data-csb-external-prepared", "1");
    var variantId = "gid://shopify/ProductVariant/" + numeric;
    try {
      var response = await fetch(
        cfg.apiBase +
          "/api/public/product?shop=" +
          encodeURIComponent(cfg.shop) +
          "&variant=" +
          encodeURIComponent(variantId),
        { credentials: "omit", headers: { Accept: "application/json" } },
      );
      if (!response.ok) return;
      var mapping = await response.json();
      if (!mapping || !mapping.available || mapping.mode !== "external" || !mapping.externalUrl) {
        return;
      }
      form.setAttribute("data-csb-external-url", mapping.externalUrl);
      if (form.getAttribute("data-csb-external-bound") !== "1") {
        form.setAttribute("data-csb-external-bound", "1");
        form.addEventListener(
          "submit",
          function (event) {
            if (event.__csbBypass) return;
            var target = form.getAttribute("data-csb-external-url");
            if (!target) return;
            event.preventDefault();
            event.stopImmediatePropagation();
            window.location.assign(withCheckoutMarker(target));
          },
          true,
        );
      }
      var noteId = "csb-external-product-note";
      if (!document.getElementById(noteId) && form.parentNode) {
        var note = element("p", "csb-external-product-note");
        note.id = noteId;
        note.textContent =
          "Compra concluída em " +
          (mapping.destination && mapping.destination.name ? mapping.destination.name : "outra loja") +
          ". Você será levado ao mesmo produto na loja responsável pela venda.";
        form.parentNode.insertBefore(note, form);
      }
    } catch (error) {
      /* mantém o carrinho normal da vitrine */
    }
  }

  function initExternalProduct(cfg) {
    function scan() {
      document.querySelectorAll('form[action*="/cart/add"]').forEach(function (form) {
        void prepareExternalProductForm(cfg, form);
      });
    }
    scan();
    document.addEventListener(
      "change",
      function (event) {
        var target = event.target;
        if (!target || !target.matches || !target.matches('input[name="id"], select[name="id"]')) return;
        var form = target.closest("form");
        if (!form) return;
        form.removeAttribute("data-csb-external-prepared");
        form.removeAttribute("data-csb-external-url");
        void prepareExternalProductForm(cfg, form);
      },
      true,
    );
    var scheduled = false;
    var observer = new MutationObserver(function () {
      if (scheduled) return;
      scheduled = true;
      window.setTimeout(function () {
        scheduled = false;
        scan();
      }, 200);
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }
  async function init() {
    var cfg = config();
    if (!cfg || !cfg.shop) return;

    // Captura UTMs em qualquer página onde o snippet global for renderizado.
    void currentAttribution();

    if (cfg.template === "product") {
      initExternalProduct(cfg);
    }

    // O tema pode usar cart drawer em qualquer página (produto, home etc.).
    // Nesse caso o checkout não está no template "cart"; está no drawer.
    var hasCartDrawer = Boolean(
      document.querySelector("cart-drawer-component, #cart-drawer, .cart-drawer"),
    );
    if (cfg.template !== "cart" && !hasCartDrawer) return;

    var publicConfig = await fetchConfig(cfg);
    if (!publicConfig || !publicConfig.enabled || publicConfig.mode !== "transfer") {
      // Loja B externa ou indisponível: não intercepta o checkout normal da A.
      return;
    }

    var controls = checkoutControls();
    var anchor = controls[0] || document.querySelector('form[action*="/cart"]') || document.body;
    var ui = buildUi(anchor, publicConfig, cfg);
    controls.forEach(function (control) {
      bindControl(control, ui);
    });
    bindCartForms(ui);
    bindDocumentClicks(ui);
  }

  function start() {
    void init();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
