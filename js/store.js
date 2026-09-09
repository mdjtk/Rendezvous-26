/*
 * Rendezvous '26 — Festivita Store
 * Student wallet + shopkeeper counter.
 *
 * - Students open their wallet by scanning their QR (store.html?code=FESTI-…)
 *   or by typing their code/name — read only, no PIN.
 * - The "Store counter" section is gated by STORE_PIN (js/config.js). Once
 *   unlocked for the session, an amount typed by the shopkeeper is deducted
 *   from the wallet and written to the festivita ledger.
 */
(function () {
  const ui = window.RV26.UI;
  const db = window.RV26.DB;
  const CONFIG = window.RV26.CONFIG;

  const $ = (id) => document.getElementById(id);
  const esc = (s) => ui.escapeHtml(s);

  let student = null;

  function initials(name) {
    return String(name == null ? '' : name)
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0].toUpperCase())
      .join('') || '?';
  }

  /* ------------------------------- lookup ------------------------------ */

  const lookup = $('lookup');
  const wallet = $('wallet');

  function lookupError(msg) {
    const el = $('lookup-error');
    el.textContent = msg || '';
    el.classList.toggle('hidden', !msg);
  }

  async function resolveToken(token) {
    const t = String(token || '').trim();
    if (!t) return null;
    try {
      return (await db.getStudentByToken(t)) || null;
    } catch (e) {
      return null;
    }
  }

  async function openWallet(s) {
    student = s;
    lookup.classList.add('hidden');
    wallet.classList.remove('hidden');
    await loadWallet(s);
  }

  async function loadWallet(s) {
    $('wallet-avatar').textContent = initials(s.name);
    $('wallet-name').textContent = s.name;
    $('wallet-team').textContent = s.team || 'No team';
    $('wallet-team').style.display = s.team ? '' : 'none';
    $('wallet-points').textContent = s.points;

    const list = $('ledger');
    ui.showLoading(list, 'Loading activity…');
    $('wallet-count').textContent = '';
    try {
      const rows = await db.getLedger(s.id);
      renderLedger(list, rows);
    } catch (e) {
      ui.showError(list, 'Could not load activity.', () => loadWallet(s));
    }
    renderCounter();
  }

  function renderLedger(list, rows) {
    const items = rows || [];
    $('wallet-count').textContent = items.length ? items.length + (items.length === 1 ? ' entry' : ' entries') : '';
    if (!items.length) {
      ui.showEmpty(list, {
        title: 'No activity yet',
        hint: 'Earning points at events will show up here.',
        icon: 'points',
      });
      return;
    }
    list.innerHTML = items
      .map((r) => {
        const pos = Number(r.delta) >= 0;
        const d = new Date(r.created_at || Date.now());
        const date = isNaN(d) ? '' : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
        return (
          '<li class="ledger-row">' +
          '<span class="ledger-delta ' + (pos ? 'is-add' : 'is-sub') + '">' +
          (pos ? '+' : '−') +
          Math.abs(r.delta) +
          '</span>' +
          '<span class="ledger-reason">' + esc(r.reason || 'Festivita point') + '</span>' +
          '<span class="ledger-date">' + esc(date) + '</span>' +
          '</li>'
        );
      })
      .join('');
  }

  /* ------------------------------- counter ----------------------------- */

  function counterOpen() {
    try {
      return sessionStorage.getItem('rv26_store_open') === '1';
    } catch (e) {
      return false;
    }
  }

  function renderCounter() {
    $('counter').classList.remove('hidden');
    const gate = $('counter-gate');
    const purchase = $('purchase');
    if (counterOpen()) {
      gate.classList.add('hidden');
      purchase.classList.remove('hidden');
    } else {
      gate.classList.remove('hidden');
      purchase.classList.add('hidden');
    }
    $('store-pin').value = '';
    $('amount').value = '';
    $('reason').value = '';
    pinError(false);
    purchaseError('');
    purchaseOk(false);
  }

  function pinError(on) {
    $('pin-error').classList.toggle('hidden', !on);
  }

  function purchaseError(msg) {
    const el = $('purchase-error');
    el.textContent = msg || '';
    el.classList.toggle('hidden', !msg);
  }

  function purchaseOk(on) {
    $('purchase-success').classList.toggle('hidden', !on);
  }

  $('counter-toggle').addEventListener('click', () => {
    $('counter').classList.toggle('hidden');
  });

  $('unlock-counter').addEventListener('click', () => {
    if ($('store-pin').value === CONFIG.STORE_PIN) {
      try {
        sessionStorage.setItem('rv26_store_open', '1');
      } catch (e) {
        /* ignore */
      }
      renderCounter();
    } else {
      pinError(true);
      $('store-pin').value = '';
      $('store-pin').focus();
    }
  });

  $('store-pin').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') $('unlock-counter').click();
  });

  $('confirm-purchase').addEventListener('click', async () => {
    const amt = Math.floor(Number($('amount').value));
    const reason = $('reason').value.trim();
    purchaseError('');
    purchaseOk(false);
    if (!amt || amt < 1) {
      purchaseError('Enter an amount to charge.');
      return;
    }
    if (!student) return;

    const btn = $('confirm-purchase');
    btn.disabled = true;
    try {
      const updated = await db.deductForStore(student.id, amt, reason);
      $('wallet-points').textContent = updated.points;
      $('amount').value = '';
      $('reason').value = '';
      purchaseOk(true);
      try {
        const rows = await db.getLedger(student.id);
        renderLedger($('ledger'), rows);
      } catch (e) {
        /* keep quiet — balance already updated */
      }
    } catch (e) {
      if (e && e.code === 'INSUFFICIENT') {
        purchaseError('Not enough points — balance is ' + e.balance + ' FVP.');
      } else {
        purchaseError('Could not record the purchase. Try again.');
      }
    } finally {
      btn.disabled = false;
    }
  });

  /* ------------------------------ by code/name -------------------------- */

  async function doTokenFind() {
    lookupError('');
    const raw = $('token-input').value.trim().toUpperCase();
    if (!raw) return;
    const s = await resolveToken(raw);
    if (s) await openWallet(s);
    else lookupError('No wallet found for that code.');
  }

  async function doNameFind() {
    lookupError('');
    const name = $('name-input').value.trim();
    if (!name) return;
    try {
      const s = await db.getStudentByName(name);
      if (s) await openWallet(s);
      else lookupError('No wallet found for that name.');
    } catch (e) {
      lookupError('Could not look that up. Try again.');
    }
  }

  $('token-find').addEventListener('click', doTokenFind);
  $('token-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') doTokenFind();
  });
  $('name-find').addEventListener('click', doNameFind);
  $('name-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') doNameFind();
  });

  /* -------------------------------- entry ------------------------------ */

  (async function init() {
    const token = new URLSearchParams(location.search).get('code') || '';
    if (token) {
      const s = await resolveToken(token);
      if (s) {
        await openWallet(s);
        return;
      }
      lookupError('No wallet found for that QR code. Try again at the counter.');
    }
    lookup.classList.remove('hidden');
    wallet.classList.add('hidden');
    $('token-input').focus();
  })();
})();