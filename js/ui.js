/*
 * Rendezvous '26 — shared UI helpers
 * Loaded on every page: shell wiring (mobile nav, footer year), tiny DOM
 * builders for loading / empty / error states, and the modal lightbox used
 * by the gallery and results pages.
 */
(function () {
  function escapeHtml(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /* --------------------------- shell wiring --------------------------- */

  function initShell() {
    const loader = document.getElementById('loader');
    if (loader) {
      let dismissed = false;
      const finish = () => {
        if (dismissed) return;
        dismissed = true;
        loader.classList.add('done');
        setTimeout(() => loader.remove(), 600);
      };
      const prefersReduced = window.matchMedia &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (prefersReduced) {
        finish();
      } else {
        const MIN = 3200;
        const started = Date.now();
        const pending = () => Math.max(0, MIN - (Date.now() - started));
        window.addEventListener('load', () => setTimeout(finish, pending()), { once: true });
        setTimeout(finish, MIN);
      }
    }
    const toggle = document.getElementById('nav-toggle');
    const menu = document.getElementById('nav-menu');
    if (toggle && menu) {
      toggle.addEventListener('click', () => {
        const open = menu.classList.toggle('open');
        toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      });
    }
    const year = document.getElementById('year');
    if (year) year.textContent = String(new Date().getFullYear());
    initPillNav();
  }

  /* --------------------------- bottom pill nav ------------------------ */

  function initPillNav() {
    const base = (location.pathname.split('/').pop() || '').toLowerCase();
    const file = base || 'index.html';
    document.querySelectorAll('.pill-nav a[href]').forEach(function (a) {
      const href = (a.getAttribute('href') || '').split(/[?#]/)[0].toLowerCase();
      if (href && href === file) {
        a.classList.add('is-active');
        a.setAttribute('aria-current', 'page');
      }
    });
  }

  /* --------------------------- feedback DOM --------------------------- */

  function spinner(svgClass) {
    return (
      '<svg class="spinner ' +
      (svgClass || '') +
      '" viewBox="0 0 24 24" fill="none" aria-label="Loading">' +
      '  <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" opacity="0.15" />' +
      '  <path d="M22 12a10 10 0 0 1-10 10" stroke="currentColor" stroke-width="3" stroke-linecap="round" />' +
      '</svg>'
    );
  }

  function showLoading(container, text) {
    container.innerHTML = '';
    const el = document.createElement('div');
    el.className = 'loading';
    el.innerHTML =
      '<span style="color:var(--leaf-400)">' + spinner('') + '</span>' + escapeHtml(text);
    container.appendChild(el);
  }

  function emptyState({ title, hint, icon }) {
    const svg = icon === 'photo'
      ? '<svg viewBox="0 0 24 24" style="width:1.75rem;height:1.75rem" stroke="currentColor" stroke-width="1.5" fill="none"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m5 18 5-5 3 3 3-3 3 3"/></svg>'
      : icon === 'points'
        ? '<svg viewBox="0 0 24 24" style="width:1.75rem;height:1.75rem" stroke="currentColor" stroke-width="1.5" fill="none"><path d="M6 20V10M12 20V4M18 20v-8" stroke-linecap="round"/></svg>'
        : '<svg viewBox="0 0 24 24" style="width:1.75rem;height:1.75rem" stroke="currentColor" stroke-width="1.5" fill="none"><path d="M12 3c2 3 5 4.5 5 8a5 5 0 0 1-10 0c0-3.5 3-5 5-8Zm0 12v6M9.5 18h5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    const out = document.createElement('div');
    out.className = 'empty-state';
    out.innerHTML =
      '<span class="icon">' + svg + '</span>' +
      '<h3>' + escapeHtml(title) + '</h3>' +
      (hint ? '<p>' + escapeHtml(hint) + '</p>' : '');
    return out;
  }

  function showEmpty(container, opts) {
    container.innerHTML = '';
    container.appendChild(emptyState(opts));
  }

  function errorNote(message, retryFn) {
    const box = document.createElement('div');
    box.className = 'error-note';
    const p = document.createElement('p');
    p.textContent = message;
    box.appendChild(p);
    if (retryFn) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn-retry';
      btn.textContent = 'Try again';
      btn.addEventListener('click', retryFn);
      box.appendChild(btn);
    }
    return box;
  }

  function showError(container, message, retryFn) {
    container.innerHTML = '';
    container.appendChild(errorNote(message, retryFn));
  }

  /* ------------------------------ lightbox ---------------------------- */

  const Lightbox = {
    items: [],
    index: 0,
    downloadLabel: 'Download',
    el: null,

    open(items, index, opts) {
      this.items = items;
      this.index = index;
      this.downloadLabel = (opts && opts.downloadLabel) || 'Download';
      this.render();
      document.addEventListener('keydown', this.onKey);
      document.body.style.overflow = 'hidden';
    },

    onKey(e) {
      const lb = window.RV26.UI.Lightbox;
      if (e.key === 'Escape') lb.close();
      else if (e.key === 'ArrowLeft') lb.prev();
      else if (e.key === 'ArrowRight') lb.next();
    },

    current() {
      return this.items[this.index];
    },

    prev() {
      if (this.items.length > 1) {
        this.index = (this.index - 1 + this.items.length) % this.items.length;
        this.render();
      }
    },

    next() {
      if (this.items.length > 1) {
        this.index = (this.index + 1) % this.items.length;
        this.render();
      }
    },

    close() {
      if (!this.el) return;
      document.removeEventListener('keydown', this.onKey);
      document.body.style.overflow = '';
      this.el.remove();
      this.el = null;
    },

    render() {
      if (this.el) this.el.remove();
      const item = this.current();
      if (!item) return this.close();

      const title = item.caption || item.event_name || 'Festival photograph';

      const el = document.createElement('div');
      el.className = 'lightbox animate-fade-in';

      const closeBtn = document.createElement('button');
      closeBtn.type = 'button';
      closeBtn.className = 'round-btn lb-close';
      closeBtn.setAttribute('aria-label', 'Close');
      closeBtn.innerHTML =
        '<svg viewBox="0 0 24 24" style="width:1.25rem;height:1.25rem" stroke="currentColor" stroke-width="1.8" fill="none"><path d="M6 6l12 12M18 6L6 18"/></svg>';
      closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.close();
      });

      const figure = document.createElement('figure');

      const img = document.createElement('img');
      img.src = item.url;
      img.alt = title;

      figure.appendChild(img);
      if (title) {
        const fig = document.createElement('figcaption');
        fig.textContent = title;
        figure.appendChild(fig);
      }

      const controls = document.createElement('div');
      controls.className = 'lb-controls';

      if (this.items.length > 1) {
        const prev = document.createElement('button');
        prev.type = 'button';
        prev.className = 'round-btn';
        prev.setAttribute('aria-label', 'Previous');
        prev.innerHTML =
          '<svg viewBox="0 0 24 24" style="width:1.25rem;height:1.25rem" stroke="currentColor" stroke-width="1.8" fill="none"><path d="M15 6l-6 6 6 6"/></svg>';
        prev.addEventListener('click', (e) => {
          e.stopPropagation();
          this.prev();
        });

        const dl = document.createElement('a');
        dl.className = 'btn-download';
        dl.href = item.url;
        dl.download = '';
        dl.target = '_blank';
        dl.rel = 'noreferrer';
        dl.innerHTML =
          '<svg viewBox="0 0 24 24" style="width:1rem;height:1rem" stroke="currentColor" stroke-width="2" fill="none"><path d="M12 4v11m0 0-4-4m4 4 4-4M5 19h14"/></svg>' +
          escapeHtml(this.downloadLabel);
        dl.addEventListener('click', (e) => e.stopPropagation());

        const next = document.createElement('button');
        next.type = 'button';
        next.className = 'round-btn';
        next.setAttribute('aria-label', 'Next');
        next.innerHTML =
          '<svg viewBox="0 0 24 24" style="width:1.25rem;height:1.25rem" stroke="currentColor" stroke-width="1.8" fill="none"><path d="M9 6l6 6-6 6"/></svg>';
        next.addEventListener('click', (e) => {
          e.stopPropagation();
          this.next();
        });

        controls.appendChild(prev);
        controls.appendChild(dl);
        controls.appendChild(next);
      } else {
        const dl = document.createElement('a');
        dl.className = 'btn-download';
        dl.href = item.url;
        dl.download = '';
        dl.target = '_blank';
        dl.rel = 'noreferrer';
        dl.innerHTML =
          '<svg viewBox="0 0 24 24" style="width:1rem;height:1rem" stroke="currentColor" stroke-width="2" fill="none"><path d="M12 4v11m0 0-4-4m4 4 4-4M5 19h14"/></svg>' +
          escapeHtml(this.downloadLabel);
        dl.addEventListener('click', (e) => e.stopPropagation());
        controls.appendChild(dl);
      }

      figure.appendChild(controls);

      figure.addEventListener('click', (e) => e.stopPropagation());
      el.addEventListener('click', () => this.close());

      el.appendChild(closeBtn);
      el.appendChild(figure);

      document.body.appendChild(el);
      this.el = el;
    },
  };

  const UI = {
    escapeHtml,
    initShell,
    showLoading,
    showEmpty,
    showError,
    emptyState,
    Lightbox,
  };

  window.RV26 = window.RV26 || {};
  window.RV26.UI = UI;
})();