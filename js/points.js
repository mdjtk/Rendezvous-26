/*
 * Rendezvous '26 — Festivita Points
 * Student self-serve points checker.
 *
 * - Students open their balance by scanning their QR (points.html?code=…)
 *   or by typing their student ID — read only, no PIN.
 */
(function () {
  const ui = window.RV26.UI;
  const db = window.RV26.DB;

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
    $('wallet-points').textContent = s.coins;

    const list = $('ledger');
    ui.showLoading(list, 'Loading activity…');
    $('wallet-count').textContent = '';
    try {
      const rows = await db.getLedger(s.id);
      renderLedger(list, rows);
    } catch (e) {
      ui.showError(list, 'Could not load activity.', () => loadWallet(s));
    }
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
          '<span class="ledger-reason">' + esc(r.reason || 'Festivita coin') + '</span>' +
          '<span class="ledger-date">' + esc(date) + '</span>' +
          '</li>'
        );
      })
      .join('');
  }

  /* ------------------------------ by ID / QR --------------------------- */

  async function doTokenFind() {
    lookupError('');
    const raw = $('token-input').value.trim();
    if (!raw) return;
    const s = await resolveToken(raw);
    if (s) await openWallet(s);
    else lookupError('No student found for that ID.');
  }

  $('token-find').addEventListener('click', doTokenFind);
  $('token-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') doTokenFind();
  });

  $('reset-lookup').addEventListener('click', () => {
    student = null;
    lookupError('');
    wallet.classList.add('hidden');
    lookup.classList.remove('hidden');
    $('token-input').value = '';
    $('token-input').focus();
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
      lookupError('No student found for that QR code. Try again with your ID.');
    }
    lookup.classList.remove('hidden');
    wallet.classList.add('hidden');
    $('token-input').focus();
  })();
})();