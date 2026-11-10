export function buildExternalCheckoutScript(storeName: string): string {
  const safeName = storeName.replace(/[<>&]/g, "").slice(0, 80);
  return `<script>
(function () {
  "use strict";
  // ShopSync — script da loja externa (${safeName})
  // Cole este bloco antes de </head> em todas as páginas da loja externa.
  var MARKER = "shopsync_checkout";
  var params = new URLSearchParams(window.location.search);
  if (params.get(MARKER) !== "1") return;

  var SELECTORS = [
    "[data-shopsync-checkout]",
    "a[href*='/checkout']",
    "a[href*='/finalizar-compra']",
    "button[name='checkout']",
    "button[type='submit'][name='checkout']",
    "#checkout",
    ".checkout-button"
  ];
  var attempts = 0;
  var clicked = false;

  function visible(el) {
    var rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function findByText() {
    var nodes = document.querySelectorAll("a[href], button");
    for (var i = 0; i < nodes.length; i++) {
      var text = String(nodes[i].innerText || nodes[i].value || "").trim().toLowerCase();
      if (text.length > 80) continue;
      if (text.indexOf("finalizar compra") !== -1 || text === "checkout" || text.indexOf("ir para o checkout") !== -1) {
        return nodes[i];
      }
    }
    return null;
  }

  function findControl() {
    for (var i = 0; i < SELECTORS.length; i++) {
      var nodes = document.querySelectorAll(SELECTORS[i]);
      for (var j = 0; j < nodes.length; j++) {
        if (nodes[j] !== document.body && visible(nodes[j])) return nodes[j];
      }
    }
    return findByText();
  }

  function showFallback() {
    if (document.getElementById("shopsync-checkout-fallback")) return;
    var box = document.createElement("div");
    box.id = "shopsync-checkout-fallback";
    box.setAttribute("role", "status");
    box.style.cssText = "position:fixed;z-index:2147483647;left:16px;right:16px;bottom:16px;max-width:560px;margin:0 auto;padding:14px 16px;border-radius:12px;background:#fff;color:#17202a;border:1px solid #cbd5e1;box-shadow:0 10px 35px rgba(15,23,42,.2);font:14px/1.45 system-ui,sans-serif";
    box.innerHTML = "<strong>Checkout do ShopSync</strong><br>Não encontrei o botão de checkout nesta página. Role até o botão de compra e clique nele para continuar.";
    document.body.appendChild(box);
  }

  function run() {
    if (clicked) return;
    var control = findControl();
    if (control) {
      clicked = true;
      try {
        var next = new URL(window.location.href);
        next.searchParams.delete(MARKER);
        window.history.replaceState({}, "", next.toString());
      } catch (error) {
        /* ignore */
      }
      if (control.tagName === "A" && control.href) {
        window.location.assign(control.href);
      } else {
        control.click();
      }
      return;
    }
    attempts += 1;
    if (attempts >= 40) {
      showFallback();
      return;
    }
    window.setTimeout(run, 250);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", run);
  } else {
    run();
  }
})();
</script>`;
}
