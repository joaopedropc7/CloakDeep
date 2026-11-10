(() => {
  'use strict';

  /* ---------------- Sticky offsets (header + abas) ---------------- */
  const root = document.documentElement;
  const headerEl = document.querySelector('.shopify-section-group-header-group') || document.querySelector('.site-header');
  const subnavEl = document.querySelector('.product-subnav');
  const setOffsets = () => {
    if (headerEl) root.style.setProperty('--header-h', `${headerEl.offsetHeight}px`);
    root.style.setProperty('--subnav-h', `${subnavEl ? subnavEl.offsetHeight : 0}px`);
  };
  setOffsets();
  window.addEventListener('resize', setOffsets);
  if ('ResizeObserver' in window) {
    const ro = new ResizeObserver(setOffsets);
    if (headerEl) ro.observe(headerEl);
    if (subnavEl) ro.observe(subnavEl);
  }

  /* ---------------- Countdown ---------------- */
  const pad = (n) => String(n).padStart(2, '0');
  const parseDate = (s) => new Date(s.replace(/([+-]\d{2})(\d{2})$/, '$1:$2'));

  const countdowns = [...document.querySelectorAll('[data-countdown]')].map((el) => ({
    el,
    end: parseDate(el.dataset.countdown).getTime(),
    d: el.querySelector('[data-d]'),
    h: el.querySelector('[data-h]'),
    m: el.querySelector('[data-m]'),
    s: el.querySelector('[data-s]'),
  })).filter((c) => !Number.isNaN(c.end));

  const tick = () => {
    const now = Date.now();
    countdowns.forEach((c) => {
      if (c.done) return;
      let diff = Math.max(0, Math.floor((c.end - now) / 1000));
      if (diff === 0) {
        c.done = true;
        c.el.textContent = c.el.dataset.endedLabel || '';
        return;
      }
      const d = Math.floor(diff / 86400); diff -= d * 86400;
      const h = Math.floor(diff / 3600); diff -= h * 3600;
      const m = Math.floor(diff / 60); const s = diff - m * 60;
      const boxes = c.el.classList.contains('countdown--boxes');
      if (c.d) c.d.textContent = d;
      if (c.h) c.h.textContent = boxes ? pad(h) : h;
      if (c.m) c.m.textContent = boxes ? pad(m) : m;
      if (c.s) c.s.textContent = boxes ? pad(s) : s;
    });
  };
  if (countdowns.length) { tick(); setInterval(tick, 1000); }

  /* ---------------- Drawer menu (+ barra de sorteios) ---------------- */
  const drawer = document.querySelector('[data-drawer]');
  const drawerToggle = document.querySelector('[data-drawer-open]');
  if (drawer) {
    let opener = null;
    const views = [...drawer.querySelectorAll('[data-drawer-view]')];
    const panel = drawer.querySelector('.drawer__panel');
    const showView = (name) => {
      views.forEach((v) => { v.hidden = v.dataset.drawerView !== name; });
      if (panel) panel.scrollTop = 0;
    };
    const open = (view = 'main') => {
      opener = document.activeElement;
      showView(view);
      drawer.hidden = false;
      drawerToggle?.setAttribute('aria-expanded', 'true');
      document.body.style.overflow = 'hidden';
      drawer.querySelector('[data-drawer-close].icon-btn')?.focus();
    };
    const close = () => {
      drawer.hidden = true;
      drawerToggle?.setAttribute('aria-expanded', 'false');
      document.body.style.overflow = '';
      opener?.focus?.();
    };
    drawerToggle?.addEventListener('click', () => open('main'));
    const hasGw = views.some((v) => v.dataset.drawerView === 'giveaways');
    if (hasGw) {
      document.querySelectorAll('[data-gw-open]').forEach((el) => el.addEventListener('click', (e) => {
        e.preventDefault();
        if (drawer.hidden) open('giveaways'); else showView('giveaways');
        drawer.querySelector('[data-gw-back]')?.focus();
      }));
      drawer.querySelector('[data-gw-back]')?.addEventListener('click', () => showView('main'));
    }
    drawer.querySelectorAll('[data-drawer-close]').forEach((b) => b.addEventListener('click', close));
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !drawer.hidden) close(); });
  }

  /* ---------------- Lightbox ---------------- */
  const lightbox = document.querySelector('[data-lightbox]');
  if (lightbox) {
    const slides = [...lightbox.querySelectorAll('[data-lightbox-slide]')];
    const counter = lightbox.querySelector('[data-lightbox-counter]');
    let index = 0;
    const show = (i) => {
      index = (i + slides.length) % slides.length;
      slides.forEach((s, n) => { s.hidden = n !== index; });
      if (counter) counter.textContent = `${index + 1} / ${slides.length}`;
    };
    document.querySelectorAll('[data-lightbox-open]').forEach((btn) => {
      btn.addEventListener('click', () => { show(parseInt(btn.dataset.lightboxOpen, 10) || 0); lightbox.showModal(); });
    });
    lightbox.querySelector('[data-lightbox-close]')?.addEventListener('click', () => lightbox.close());
    lightbox.querySelector('[data-lightbox-prev]')?.addEventListener('click', () => show(index - 1));
    lightbox.querySelector('[data-lightbox-next]')?.addEventListener('click', () => show(index + 1));
    lightbox.addEventListener('click', (e) => { if (e.target === lightbox) lightbox.close(); });
    lightbox.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowLeft') show(index - 1);
      if (e.key === 'ArrowRight') show(index + 1);
    });
    let startX = null;
    lightbox.addEventListener('touchstart', (e) => { startX = e.touches[0].clientX; }, { passive: true });
    lightbox.addEventListener('touchend', (e) => {
      if (startX === null) return;
      const dx = e.changedTouches[0].clientX - startX;
      if (Math.abs(dx) > 40) show(index + (dx < 0 ? 1 : -1));
      startX = null;
    });
  }

  /* ---------------- Video modal ---------------- */
  const videoModal = document.querySelector('[data-video-modal]');
  if (videoModal) {
    const frame = videoModal.querySelector('[data-video-frame]');
    document.querySelectorAll('[data-video-native]').forEach((btn) => {
      btn.addEventListener('click', () => {
        frame.innerHTML = `<video src="${btn.dataset.videoNative}" controls autoplay playsinline></video>`;
        videoModal.showModal();
      });
    });
    document.querySelectorAll('[data-video-open]').forEach((btn) => {
      btn.addEventListener('click', () => {
        frame.innerHTML = `<iframe src="${btn.dataset.videoOpen}" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen title="Video"></iframe>`;
        videoModal.showModal();
      });
    });
    const closeVideo = () => videoModal.close();
    videoModal.querySelector('[data-video-close]')?.addEventListener('click', closeVideo);
    videoModal.addEventListener('click', (e) => { if (e.target === videoModal) closeVideo(); });
    videoModal.addEventListener('close', () => { frame.innerHTML = ''; });
  }

  /* ---------------- Card inside description ---------------- */
  document.querySelectorAll('[data-insert-before]').forEach((card) => {
    const marker = (card.dataset.insertBefore || '').trim().toLowerCase();
    const desc = card.parentElement.querySelector('[data-description]');
    if (!marker || !desc) return;
    const target = [...desc.querySelectorAll('h1,h2,h3,h4,h5,h6,p,strong')]
      .find((el) => el.textContent.trim().toLowerCase().startsWith(marker));
    if (!target) return;
    let node = target;
    while (node.parentElement && node.parentElement !== desc) node = node.parentElement;
    // se o título está dentro de um bloco (div), insere antes do próprio título dentro dele
    const before = node === target || node.firstElementChild === target ? node : target;
    before.parentElement.insertBefore(card, before);
  });

  /* ---------------- Donation panel (tela cheia no celular) ---------------- */
  const donation = document.querySelector('[data-donation]');
  const mobileMq = window.matchMedia('(max-width: 989px)');
  let donationTrigger = null;
  const openDonation = (e) => {
    if (!donation) return;
    e?.preventDefault();
    if (!mobileMq.matches) {
      donation.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    donationTrigger = document.activeElement;
    donation.classList.add('is-open');
    donation.setAttribute('role', 'dialog');
    donation.setAttribute('aria-modal', 'true');
    donation.scrollTop = 0;
    document.body.classList.add('has-modal');
    donation.querySelector('[data-donation-close]')?.focus();
    donation.dispatchEvent(new Event('donation:open'));
  };
  const closeDonation = () => {
    if (!donation || !donation.classList.contains('is-open')) return;
    donation.classList.remove('is-open');
    donation.removeAttribute('role');
    donation.removeAttribute('aria-modal');
    document.body.classList.remove('has-modal');
    donationTrigger?.focus?.();
  };
  if (donation) {
    document.querySelectorAll('[data-donation-open]').forEach((el) => el.addEventListener('click', openDonation));
    donation.querySelector('[data-donation-close]')?.addEventListener('click', closeDonation);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && donation.classList.contains('is-open') && document.querySelector('[data-cart-drawer]')?.hidden !== false) closeDonation();
    });
    const moreWrap = donation.querySelector('[data-ticket-more-wrap]');
    if (moreWrap) {
      const list = moreWrap.closest('[data-ticket-list]');
      const options = [...list.querySelectorAll('.ticket-option')];
      const text = moreWrap.querySelector('[data-ticket-more-text]');
      const below = () => {
        const limit = donation.getBoundingClientRect().bottom - 24;
        return options.filter((o) => o.getBoundingClientRect().top > limit);
      };
      const update = () => {
        if (!donation.classList.contains('is-open')) return;
        const n = below().length;
        moreWrap.classList.toggle('is-hidden', n === 0);
        if (n > 0) text.textContent = n === 1 ? moreWrap.dataset.labelOne : moreWrap.dataset.label.replace('[count]', n);
      };
      donation.addEventListener('scroll', () => requestAnimationFrame(update), { passive: true });
      window.addEventListener('resize', update);
      donation.addEventListener('donation:open', () => requestAnimationFrame(update));
      moreWrap.querySelector('[data-ticket-more]').addEventListener('click', () => {
        donation.scrollBy({ top: donation.clientHeight * 0.6, behavior: 'smooth' });
      });
    }
    if (location.hash === '#donation' && mobileMq.matches) openDonation();
    mobileMq.addEventListener?.('change', (e) => { if (!e.matches) closeDonation(); });
  }

  /* ---------------- Fullscreen info modals (rules, prize details) ---------------- */
  document.querySelectorAll('[data-info-modal]').forEach((modal) => {
    const open = (e) => {
      e?.preventDefault();
      modal.showModal();
      document.body.classList.add('has-modal');
      const body = modal.querySelector('[data-modal-body]');
      if (body) body.scrollTop = 0;
    };
    document.querySelectorAll(`[data-modal-open="${modal.id}"]`).forEach((el) => el.addEventListener('click', open));
    modal.querySelector('[data-modal-close]')?.addEventListener('click', () => modal.close());
    modal.addEventListener('close', () => { if (!donation?.classList.contains('is-open')) document.body.classList.remove('has-modal'); });
    modal.querySelector('[data-modal-enter]')?.addEventListener('click', (e) => {
      e.preventDefault();
      modal.close();
      openDonation();
    });
    if (location.hash === `#${modal.id}`) open();
  });

  /* ---------------- Cart drawer ---------------- */
  const cartDrawer = document.querySelector('[data-cart-drawer]');
  if (cartDrawer) {
    const $ = (sel) => cartDrawer.querySelector(sel);
    const itemBox = $('[data-cart-item]');
    const emptyMsg = $('[data-cart-empty]');
    let lastKey = null;
    let lastTrigger = null;

    const setCount = (n) => {
      document.querySelectorAll('[data-cart-count]').forEach((el) => { el.textContent = n; el.hidden = n === 0; });
      const d = $('[data-cart-count-drawer]'); if (d) d.textContent = n;
    };
    const setText = (sel, val) => { const el = $(sel); el.textContent = val || ''; el.hidden = !val; };
    const openDrawer = () => {
      cartDrawer.hidden = false;
      document.body.classList.add('has-modal');
      $('.cart-drawer__x')?.focus();
    };
    const closeDrawer = () => {
      cartDrawer.hidden = true;
      if (!document.querySelector('[data-donation].is-open')) document.body.classList.remove('has-modal');
      lastTrigger?.focus();
    };
    cartDrawer.querySelectorAll('[data-cart-close]').forEach((el) => el.addEventListener('click', closeDrawer));
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !cartDrawer.hidden) closeDrawer(); });

    document.querySelectorAll('form[data-drawer-add]').forEach((form) => {
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        lastTrigger = form.querySelector('button');
        form.classList.add('is-loading');
        try {
          const id = Number(form.querySelector('[name="id"]').value);
          const res = await fetch('/cart/add.js', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify({ items: [{ id, quantity: 1 }] }),
          });
          if (!res.ok) throw new Error(String(res.status));
          const added = await res.json();
          const item = added.items ? added.items[0] : added;
          lastKey = item.key;
          const ds = form.dataset;
          setText('[data-ci-draw]', ds.draw);
          setText('[data-ci-title]', ds.title);
          setText('[data-ci-number]', ds.number);
          setText('[data-ci-price]', ds.price);
          setText('[data-ci-label]', ds.label);
          itemBox.hidden = false; emptyMsg.hidden = true;
          const cart = await (await fetch('/cart.js', { headers: { Accept: 'application/json' } })).json();
          setCount(cart.item_count);
          openDrawer();
        } catch (err) {
          HTMLFormElement.prototype.submit.call(form); // fallback: envio normal
        } finally {
          form.classList.remove('is-loading');
        }
      });
    });

    $('[data-cart-remove]')?.addEventListener('click', async () => {
      if (!lastKey) return;
      try {
        const res = await fetch('/cart/change.js', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ id: lastKey, quantity: 0 }),
        });
        const cart = await res.json();
        setCount(cart.item_count);
        itemBox.hidden = true;
        emptyMsg.hidden = cart.item_count > 0;
        lastKey = null;
      } catch (err) { /* ignora */ }
    });
  }

  /* ---------------- Promo code ---------------- */
  const promo = document.querySelector('[data-promo]');
  if (promo) {
    const row = promo.querySelector('[data-promo-row]');
    const form = promo.querySelector('[data-promo-form]');
    const msg = promo.querySelector('[data-promo-msg]');
    const input = form.querySelector('input');
    const saved = sessionStorage.getItem('promo_code');
    const showMsg = (text, error) => { msg.textContent = text; msg.hidden = false; msg.classList.toggle('is-error', !!error); };
    if (saved) showMsg(`${promo.dataset.success} (${saved})`);

    promo.querySelector('[data-promo-toggle]').addEventListener('click', () => { row.hidden = true; form.hidden = false; input.focus(); });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const code = input.value.trim().toUpperCase();
      if (!code) return;
      try {
        const res = await fetch(`/discount/${encodeURIComponent(code)}?redirect=/cart.js`, { credentials: 'same-origin' });
        if (!res.ok) throw new Error(res.status);
        sessionStorage.setItem('promo_code', code);
        showMsg(`${promo.dataset.success} (${code})`);
        form.hidden = true; row.hidden = false;
      } catch (err) {
        showMsg(promo.dataset.error, true);
      }
    });
  }
})();
