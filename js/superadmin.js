/*
 * Rendezvous '26 — Supervisor Console (Super Admin)
 * Owner-only oversight layer: live KPIs, full data explorer, audit trail,
 * anomaly scanner and the hybrid Gemini + local-opencode assistant.
 *
 * Hardened auth: the supervisor code is verified ONLY by the /verify-pin
 * Edge Function (role 'super'). No client-side fallback — if the server is
 * unreachable, the console stays locked.
 */
(function () {
  'use strict';

  const C = window.RV26.CONFIG;
  const DB = window.RV26.DB;

  const SESSION_KEY = 'rv26_role';
  const RELAY = 'http://127.0.0.1:4888';
  const PAGE_SIZE = 200;

  const $ = (id) => document.getElementById(id);

  const gate = $('gate');
  const consoleEl = $('console');
  const gatePw = $('gatePw');
  const gateErr = $('gateErr');
  const gateBtn = $('gateBtn');
  const logoutBtn = $('logoutBtn');
  const roleChip = $('roleChip');
  const clockEl = $('clock');

  let role = null;
  let dataPage = 0;

  /* ------------------------------ utils ------------------------------ */

  function toast(msg, ms) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(t._q);
    t._q = setTimeout(() => t.classList.remove('show'), ms || 2600);
  }

  function fmtTime(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (isNaN(d)) return String(iso);
    return d.toLocaleString(undefined, {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  function shortTime(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    return isNaN(d) ? String(iso) : d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  }

  function cleanName(raw) {
    return String(raw || '').replace(/\s+/g, ' ').trim();
  }

  async function allRows(table, order, ascending, _acc) {
    const acc = _acc || [];
    const { data, count } = await DB.queryTable(table, {
      order: order || 'created_at',
      ascending: !!ascending,
      limit: 1000,
      count: true,
    });
    acc.push(...(data || []));
    if (typeof count === 'number' && count > 1000) {
      for (let off = 1000; off < count; off += 1000) {
        const more = await DB.queryTable(table, {
          order: order || 'created_at',
          ascending: !!ascending,
          limit: 1000,
          offset: off,
        });
        acc.push(...(more || []));
      }
    }
    return acc;
  }

  /* ------------------------------ auth ------------------------------ */

  function currentRole() {
    try {
      return sessionStorage.getItem(SESSION_KEY) || null;
    } catch (e) { return null; }
  }

  async function unlock() {
    const pw = gatePw.value.trim();
    if (!pw) { gateErr.textContent = 'Enter the supervisor access code.'; gatePw.focus(); return; }
    gateBtn.disabled = true;
    gateErr.textContent = '';
    let res;
    try {
      res = await DB.verifyPin(pw);
    } catch (e) {
      gateBtn.disabled = false;
      gateErr.textContent = 'Server unreachable — supervisor access is closed. Check connectivity.';
      return;
    }
    gateBtn.disabled = false;
    if (!res || res.role !== 'super') {
      gateErr.textContent = 'That code is not the supervisor code.';
      gatePw.select();
      return;
    }
    role = 'super';
    try { sessionStorage.setItem(SESSION_KEY, 'super'); } catch (e) { /* ignore */ }
    enter();
  }

  function enter() {
    gate.classList.add('is-hidden');
    consoleEl.classList.remove('is-hidden');
    roleChip.textContent = 'role: ' + (currentRole() || role || 'super');
    roleChip.title = 'supervisor role is issued by the server (JWT claim)';
    start();
  }

  function logout() {
    DB.clearSessionToken();
    try { sessionStorage.removeItem(SESSION_KEY); } catch (e) { /* ignore */ }
    window.location.reload();
  }

  gateBtn.addEventListener('click', unlock);
  gatePw.addEventListener('keydown', (e) => { if (e.key === 'Enter') unlock(); });
  logoutBtn.addEventListener('click', logout);

  setInterval(() => {
    const d = new Date();
    clockEl.textContent = d.toLocaleTimeString(undefined, { hour12: false });
  }, 1000);

  /* ------------------------------ tabs ------------------------------ */

  const tabs = document.querySelectorAll('#console .tab');
  const panels = {
    dashboard: $('panel-dashboard'),
    data: $('panel-data'),
    audit: $('panel-audit'),
    anomalies: $('panel-anomalies'),
    bot: $('panel-bot'),
  };

  function switchTab(name) {
    tabs.forEach((t) => {
      const active = t.dataset.tab === name;
      t.classList.toggle('is-active', active);
      t.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    Object.keys(panels).forEach((k) => panels[k].classList.toggle('is-hidden', k !== name));
  }

  tabs.forEach((t) => t.addEventListener('click', () => {
    switchTab(t.dataset.tab);
    if (t.dataset.tab === 'data') loadData();
    if (t.dataset.tab === 'audit') loadAudit();
    if (t.dataset.tab === 'anomalies') runAnomalies();
    if (t.dataset.tab === 'dashboard') loadDashboard();
  }));

  /* ------------------------------ dashboard ------------------------------ */

  async function loadDashboard() {
    const kpi = $('kpiGrid');
    const ledgerFeed = $('dashLedger');
    const auditFeed = $('dashAudit');
    kpi.innerHTML = '<div class="nb-label">loading…</div>';

    const [students, teams, rCounts, ledger, audit, gallery, schedule, programs] = await Promise.all([
      DB.getStudents().catch(() => []),
      DB.getTeams().catch(() => []),
      DB.getResultsCounts().catch(() => ({ total: 0, published: 0, pending: 0 })),
      DB.getLedgerAll().catch(() => []),
      DB.queryTable('audit_log', { limit: 40, count: false }).then((r) => r || []).catch(() => []),
      DB.getGalleryPage({ limit: 1, offset: 0 }).catch(() => ({ count: 0 })),
      DB.getSchedule().catch(() => []),
      DB.getPrograms().catch(() => []),
    ]);

    const byCategory = {};
    students.forEach((s) => { byCategory[s.category] = (byCategory[s.category] || 0) + 1; });

    let credited = 0, spent = 0;
    ledger.forEach((l) => { if ((+l.delta || 0) > 0) credited += +l.delta; else spent += -l.delta; });

    const cards = [
      { n: students.length, l: 'students', acc: 'var(--lime)' },
      { n: teams.length, l: 'teams', acc: 'var(--yellow)' },
      { n: rCounts.published || 0, s: '/' + (rCounts.total || 0), l: 'results live', acc: 'var(--cyan)' },
      { n: ledger.length, l: 'ledger entries', acc: 'var(--pink)' },
      { n: credited, l: 'coins issued', acc: 'var(--orange)' },
      { n: spent, l: 'coins spent', acc: 'var(--yellow)' },
      { n: gallery.count || 0, l: 'gallery photos', acc: 'var(--cyan)' },
      { n: schedule.length, l: 'schedule entries', acc: 'var(--lime)' },
      { n: programs.length, l: 'programs', acc: 'var(--pink)' },
      { n: audit.length, l: 'audit (last 40)', acc: 'var(--orange)' },
    ];

    kpi.innerHTML = cards.map((c, i) =>
      `<div class="nb-card nb-card--accent kpi-card" style="--acc: ${c.acc}">
         <div class="strip"></div>
         <div class="kpi-num">${c.n}${c.s ? '<small>' + c.s + '</small>' : ''}</div>
         <div class="nb-label kpi-label">${c.l}</div>
         <div class="small muted" style="margin-top:6px">${Object.entries(byCategory).map(([k, v]) => `<span style="margin-right:8px">${k}: ${v}</span>`).join('')}</div>
       </div>`
    ).join('');

    ledgerFeed.innerHTML = (ledger.slice(0, 8).map((l) => {
      const s = students.find((x) => String(x.id) === String(l.student_id));
      return `<div class="feed-item">
        <div class="t">${shortTime(l.created_at)}</div>
        <div class="b"><span class="w">${s ? cleanName(s.name) : '#' + l.student_id}</span>
          <span class="nb-monobadge" style="--acc: ${(+l.delta || 0) >= 0 ? 'var(--lime)' : 'var(--pink)'}">${(+l.delta || 0) >= 0 ? '+' : ''}${l.delta}</span>
          <div class="r">${escapeHtml(l.reason || '')} · <b>${l.channel}</b></div></div>
      </div>`;
    }).join('')) || '<div class="feed-item"><div class="b">No ledger activity yet.</div></div>';

    const today = new Date().toISOString().slice(0, 10);
    auditFeed.innerHTML = (audit.filter((a) => (a.created_at || '').slice(0, 10) === today).slice(0, 8).map((a) =>
      `<div class="feed-item">
        <div class="t">${shortTime(a.created_at)}</div>
        <div class="b"><span class="nb-monobadge" style="--acc: var(--yellow)">${escapeHtml(a.actor || '?')}</span>
          <span class="w"> ${escapeHtml(a.action || '')}</span>
          <div class="r">${escapeHtml(a.entity_name || a.entity_type || '')}${a.entity_id ? ' #' + a.entity_id : ''}</div></div>
      </div>`
    ).join('')) || '<div class="feed-item"><div class="b">No audit rows yet today — they appear as soon as staff act.</div></div>';
  }

  $('dashLedgerBtn').addEventListener('click', loadDashboard);

  /* ------------------------------ data explorer ------------------------------ */

  const dataTableEl = $('dataTable');
  const dataColEl = $('dataCol');
  const dataSearchEl = $('dataSearch');
  const dataLimitEl = $('dataLimit');
  const dataWrap = $('dataTableWrap');
  const dataMeta = $('dataMeta');
  const dataPageEl = $('dataPage');
  const dataDrawer = $('dataDrawer');

  const COL_HINTS = {
    students: ['name', 'team', 'category', 'qr_token'],
    teams: ['name'],
    results: ['event_name', 'category', 'participant_name'],
    gallery: ['caption', 'photo_path'],
    glocal_ledger: ['reason', 'channel'],
    schedule: ['title', 'location', 'tag', 'section'],
    programs: ['name', 'section', 'stage'],
    audit_log: ['actor', 'action', 'entity_type', 'entity_name'],
  };

  async function loadData() {
    const table = dataTableEl.value;
    const q = dataSearchEl.value.trim();
    const col = dataColEl.value;
    const limit = Math.min(500, Math.max(1, +dataLimitEl.value || 200));
    const filters = {};
    if (q && col) filters[col] = { ilike: '*' + q + '*' };
    for (const h of COL_HINTS[table] || []) {
      if (!Array.from(dataColEl.options).some((o) => o.value === h)) {
        dataColEl.appendChild(new Option(h, h));
      }
    }
    const { data, count } = await DB.queryTable(table, {
      order: 'created_at',
      ascending: false,
      limit,
      offset: dataPage * limit,
      filters,
      count: true,
    });
    const rows = data || [];
    dataMeta.textContent = `${count} total · showing ${rows.length} (page ${dataPage + 1})`;
    dataPageEl.textContent = `${dataPage + 1}`;

    const colsSet = new Set();
    rows.forEach((r) => Object.keys(r).forEach((k) => colsSet.add(k)));
    const cols = Array.from(colsSet);
    if (cols.length === 0) { dataWrap.innerHTML = '<div class="feed-item"><div class="b">No rows.</div></div>'; return; }

    dataWrap.innerHTML =
      '<table class="nb-table"><thead><tr>' + cols.map((c) => `<th>${escapeHtml(c)}</th>`).join('') + '</tr></thead><tbody>' +
      rows.map((r) =>
        '<tr class="clickable" data-id="' + escapeHtml(String(r.id)) + '">' +
        cols.map((c) => {
          const v = r[c];
          let s = '';
          if (v === null || v === undefined) s = '';
          else if (typeof v === 'object') s = JSON.stringify(v);
          else s = String(v);
          return '<td title="' + escapeHtml(s).replace(/"/g, '&quot;') + '">' + escapeHtml(s) + '</td>';
        }).join('') + '</tr>'
      ).join('') + '</tbody></table>';

    dataWrap.querySelectorAll('tr.clickable').forEach((tr) => {
      tr.addEventListener('click', () => openDrawer(table, rows.find((r) => String(r.id) === tr.dataset.id)));
    });
  }

  async function openDrawer(table, row) {
    if (!row) return;
    dataDrawer.classList.remove('is-hidden');
    let extra = '';
    if (table === 'students') {
      const ledger = await DB.getLedger(row.id).catch(() => []);
      const all = await DB.getResults().catch(() => []);
      const won = all.filter((r) => {
        const places = Array.isArray(r.places) ? r.places : [];
        return places.some((p) => cleanName(p.participant_name).toLowerCase() === cleanName(row.name).toLowerCase()) ||
          cleanName(r.participant_name).toLowerCase() === cleanName(row.name).toLowerCase();
      });
      const sum = ledger.reduce((a, l) => a + (+l.delta || 0), 0);
      extra = `
        <div class="row mt"><span class="nb-monobadge" style="--acc: var(--lime)">WALLET · points ${row.points} · coins ${row.coins} · ledger sum ${sum}</span></div>
        <pre>${escapeHtml(JSON.stringify({
          id: row.id, name: row.name, team: row.team, category: row.category,
          roster_no: row.roster_no, qr_token: row.qr_token,
          results_won: won.map((r) => r.event_name + (r.category ? ' · ' + r.category : '')),
        }, null, 2))}</pre>
        <div class="nb-label" style="margin-top:12px">ledger (${ledger.length})</div>
        <div class="table-wrap"><table class="nb-table"><thead><tr><th>time</th><th>delta</th><th>channel</th><th>reason</th></tr></thead><tbody>
        ${ledger.slice(0, 40).map((l) =>
          `<tr><td>${fmtTime(l.created_at)}</td><td>${(+l.delta || 0) > 0 ? '+' : ''}${l.delta}</td><td>${escapeHtml(l.channel || '')}</td><td>${escapeHtml(l.reason || '')}</td></tr>`
        ).join('') || '<tr><td colspan="4">no ledger rows</td></tr>'}
        </tbody></table></div>`;
    } else {
      extra = '<pre>' + escapeHtml(JSON.stringify(row, null, 2)) + '</pre>';
    }
    dataDrawer.innerHTML =
      `<div class="row"><span class="nb-label">${escapeHtml(table)} · #${row.id}</span>
       <button type="button" class="nb-btn nb-btn--tiny" id="drawerClose">close</button></div>
       <div class="mt">${extra}</div>`;
    $('drawerClose').addEventListener('click', () => dataDrawer.classList.add('is-hidden'));
  }

  dataTableEl.addEventListener('change', () => { dataPage = 0; loadData(); });
  dataLimitEl.addEventListener('change', () => { dataPage = 0; loadData(); });
  dataSearchEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') { dataPage = 0; loadData(); } });
  $('dataGo').addEventListener('click', () => { dataPage = 0; loadData(); });
  $('dataPrev').addEventListener('click', () => { if (dataPage > 0) { dataPage--; loadData(); } });
  $('dataNext').addEventListener('click', () => { dataPage++; loadData(); });

  /* ------------------------------ audit ------------------------------ */

  async function loadAudit() {
    const actor = $('auditActor').value.trim();
    const action = $('auditAction').value.trim();
    const filters = {};
    if (actor) filters.actor = { ilike: '*' + actor + '*' };
    if (action) filters.action = { ilike: '*' + action + '*' };
    const rows = (await DB.queryTable('audit_log', { limit: 200, filters }).catch(() => [])) || [];
    const feed = $('auditFeed');
    if (rows.length === 0) { feed.innerHTML = '<div class="feed-item"><div class="b">No audit rows match.</div></div>'; return; }
    feed.innerHTML = rows.map((a) =>
      `<div class="audit-item">
        <div class="a-time">${fmtTime(a.created_at)}</div>
        <div><span class="nb-monobadge" style="--acc: var(--yellow)">${escapeHtml(a.actor || '?')}</span></div>
        <div><b>${escapeHtml(a.action || '')}</b>${a.entity_type ? ' · ' + escapeHtml(a.entity_type) : ''}${a.entity_id ? ' #' + escapeHtml(a.entity_id) : ''}${a.entity_name ? ' · ' + escapeHtml(a.entity_name) : ''}
          ${a.detail ? '<pre class="small mt" style="margin-top:6px">' + escapeHtml(JSON.stringify(a.detail, null, 2)) + '</pre>' : ''}</div>
        <div></div>
      </div>`
    ).join('');
  }

  $('auditGo').addEventListener('click', loadAudit);
  $('auditClear').addEventListener('click', () => { $('auditActor').value = ''; $('auditAction').value = ''; loadAudit(); });

  /* ------------------------------ anomalies ------------------------------ */

  function sectionForRoster(n) {
    n = Number(n);
    if (n >= 4000) return 'General';
    if (n >= 3000) return 'Sub junior';
    if (n >= 2000) return 'Premier';
    if (n >= 1000) return 'Minor';
    return null;
  }

  async function runAnomalies() {
    const list = $('anomalyList');
    list.innerHTML = '<div class="nb-label">scanning every corner…</div>';
    const out = [];

    const [students, teams, results, ledger, gallery] = await Promise.all([
      DB.getStudents().catch(() => []),
      DB.getTeams().catch(() => []),
      allRows('results', 'created_at', true).catch(() => []),
      allRows('glocal_ledger', 'created_at', true).catch(() => []),
      allRows('gallery', 'created_at', true).catch(() => []),
    ]);

    const sByName = new Map();
    students.forEach((s) => sByName.set(cleanName(s.name).toLowerCase(), s));

    // 1 — result winner names that match no student (typos / placeholders)
    const unmatched = [];
    const pending = [];
    results.forEach((r) => {
      const names = new Set();
      if (r.places) r.places.forEach((p) => p && p.participant_name && names.add(cleanName(p.participant_name).toLowerCase()));
      if (r.participant_name) names.add(cleanName(r.participant_name).toLowerCase());
      names.forEach((n) => { if (n && !sByName.has(n)) unmatched.push({ id: r.id, event: r.event_name, name: n }); });
      if (r.published === false) pending.push({ id: r.id, event: r.event_name });
    });
    if (unmatched.length) out.push({
      sev: 'high', title: `Winner names that match no student (${unmatched.length})`,
      detail: unmatched.slice(0, 12).map((u) => `result #${u.id} “${u.event}” → “${u.name}”`).join(', '),
      fix: 'These get no points/coins. Delete the poster (points are reversed) and re-upload with the exact roster name.',
    });

    // 2 — duplicate results (same event + category + head winner)
    const seen = new Map();
    results.forEach((r) => {
      const key = [cleanName(r.event_name), cleanName(r.category), cleanName(r.participant_name)].join('|');
      if (!seen.has(key)) seen.set(key, []);
      seen.get(key).push(r);
    });
    const dupes = Array.from(seen.values()).filter((arr) => arr.length > 1);
    if (dupes.length) out.push({
      sev: 'high', title: `Duplicate result posters (${dupes.length} cluster(s))`,
      detail: dupes.slice(0, 8).map((arr) =>
        `“${arr[0].event_name}”${arr[0].category ? ' · ' + arr[0].category : ''} → ids ${arr.map((r) => r.id).join(', ')}`)
        .join(' | '),
      fix: 'keep one, delete the rest (delete reverses its points + coins).',
      results: dupes.flat().slice(1),
    });

    // 3 — pending (unpublished) results
    if (pending.length) out.push({
      sev: 'med', title: `Unpublished results (${pending.length})`,
      detail: pending.slice(0, 8).map((p) => `#${p.id} “${p.event}”`).join(', '),
    });

    // 4 — team points vs recomputed-from-results
    const teamNames = new Map();
    teams.forEach((t) => teamNames.set(t.name.toLowerCase(), t));
    const expected = {};
    results.forEach((r) => {
      if (!r.places) return;
      r.places.forEach((pl) => {
        if (!pl.participant_name || !pl.rank) return;
        const st = sByName.get(cleanName(pl.participant_name).toLowerCase());
        const pts = r.points ? +r.points[String(pl.rank)] || 0 : 0;
        if (pts && st && st.team) {
          const t = teamNames.get(st.team.toLowerCase());
          if (t) expected[t.id] = (expected[t.id] || 0) + pts;
        }
      });
    });
    const drift = teams.filter((t) => Math.round((expected[t.id] || 0) - (+t.points || 0)) !== 0)
      .map((t) => `${t.name}: table ${t.points} vs recomputed ${expected[t.id] || 0}`);
    if (drift.length) out.push({
      sev: 'high', title: `Team points drift (${drift.length})`,
      detail: drift.slice(0, 8).join(' | '), fix: 'Drift means the standings no longer match the result posters.',
    });

    // 5 — wallet vs ledger reconciliation
    const ledgerSum = {};
    ledger.forEach((l) => { ledgerSum[l.student_id] = (ledgerSum[l.student_id] || 0) + (+l.delta || 0); });
    const mismatch = students
      .map((s) => ({ s, sum: ledgerSum[s.id] || 0, diff: (+s.coins || 0) - (ledgerSum[s.id] || 0) }))
      .filter((x) => x.diff !== 0)
      .sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));
    if (mismatch.length) out.push({
      sev: 'med', title: `Wallet vs ledger mismatch (${mismatch.length} student(s))`,
      detail: mismatch.slice(0, 10).map((x) => `${x.s.name}: coins ${x.s.coins} vs ledger ${x.sum} (Δ ${x.diff})`).join(' | '),
      fix: 'Expected only where a removal was clamped at 0. Otherwise coins were changed without a ledger line.',
    });

    // 6 — negative / fractional balances
    const weird = students.filter((s) => (+s.coins || 0) < 0 || (+s.points || 0) < 0 || !Number.isInteger(+s.points) || !Number.isInteger(+s.coins));
    if (weird.length) out.push({
      sev: 'high', title: `Invalid balances (${weird.length})`,
      detail: weird.slice(0, 8).map((s) => `${s.name}: pts ${s.points}, coins ${s.coins}`).join(' | '),
    });

    // 7 — roster numbering out of range for section
    const rosterBad = students.filter((s) => s.roster_no != null && s.category && sectionForRoster(s.roster_no) !== s.category);
    if (rosterBad.length) out.push({
      sev: 'low', title: `Roster number / section mismatch (${rosterBad.length})`,
      detail: rosterBad.slice(0, 8).map((s) => `${s.name}: ${s.roster_no} → ${s.category}`).join(' | '),
    });

    // 8 — QR format
    const qrBad = students.filter((s) => s.qr_token && !/^FESTI-[A-Z0-9]{6}$/.test(s.qr_token) && s.qr_token !== String(s.roster_no));
    if (qrBad.length) out.push({
      sev: 'low', title: `Irregular QR tokens (${qrBad.length})`,
      detail: qrBad.slice(0, 8).map((s) => `${s.name} → ${s.qr_token}`).join(' | '),
    });

    // 9 — storage orphans (best effort)
    let resultObjs = [];
    let galleryObjs = [];
    try {
      const list = (b) => fetch(`${C.SUPABASE_URL}/storage/v1/object/list/${b}`, {
        method: 'POST',
        headers: { apikey: C.SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ prefix: '', limit: 10000, offset: 0 }),
      }).then((r) => (r.ok ? r.json() : [])).catch(() => []);
      const [ro, go] = await Promise.all([list('results'), list('gallery')]);
      resultObjs = ro.map((o) => o.name);
      galleryObjs = go.map((o) => o.name);
      const missingRows = results.filter((r) => r.poster_path && !resultObjs.includes(r.poster_path));
      const missingPhotos = gallery.filter((g) => g.photo_path && !galleryObjs.includes(g.photo_path));
      if (missingRows.length) out.push({
        sev: 'high', title: `Result rows with missing poster files (${missingRows.length})`,
        detail: missingRows.slice(0, 8).map((r) => `#${r.id} ${r.event_name} → ${r.poster_path}`).join(' | '),
      });
      if (missingPhotos.length) out.push({
        sev: 'med', title: `Gallery rows with missing files (${missingPhotos.length})`,
        detail: missingPhotos.slice(0, 8).map((g) => `#${g.id} → ${g.photo_path}`).join(' | '),
      });
      const orphanFiles = resultObjs.filter((f) => !results.some((r) => r.poster_path === f)).slice(0, 5);
      const orphanPhotos = galleryObjs.filter((f) => !gallery.some((g) => g.photo_path === f)).slice(0, 5);
      if (orphanFiles.length) out.push({ sev: 'low', title: 'Orphan poster files (no row)', detail: orphanFiles.join(', ') });
      if (orphanPhotos.length) out.push({ sev: 'low', title: 'Orphan gallery files (no row)', detail: orphanPhotos.join(', ') });
    } catch (e) {
      out.push({ sev: 'low', title: 'Storage check skipped', detail: String(e.message || e) });
    }

    if (out.length === 0) out.push({ sev: 'low', title: 'All clear', detail: 'No anomalies found. Every corner looks honest.' });

    list.innerHTML = out.map((a, i) => `
      <div class="nb-card nb-card--accent anomaly-card sev-${a.sev}">
        <div class="bar">${a.sev.toUpperCase()} · ${escapeHtml(a.title)}</div>
        <div class="body">
          <div>${escapeHtml(a.detail || '')}</div>
          ${a.fix ? `<div class="small muted mt">fix: ${escapeHtml(a.fix)}</div>` : ''}
          ${a.results && a.results.length ? (
            `<div class="row mt">${a.results.map((r) =>
              `<button type="button" class="nb-btn nb-btn--danger nb-btn--tiny anomaly-del" data-id="${r.id}" data-name="${escapeHtml(r.event_name)}">Delete #${r.id} + reverse</button>`
            ).join('')}</div>`
          ) : ''}
        </div>
      </div>`).join('');

    list.querySelectorAll('.anomaly-del').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.id;
        const name = btn.dataset.name;
        if (!window.confirm(`Delete result #${id} (“${name}”) and reverse its awarded points + coins?`)) return;
        try {
          const all = results.find((r) => String(r.id) === String(id));
          const sum = await DB.deleteResult(id, all && all.poster_path);
          toast(`Deleted #${id} — reversed ${sum.teamPts} team pts, ${sum.champPts} champ pts, ${sum.coins} coins.`);
          runAnomalies();
          loadDashboard();
        } catch (e) {
          toast('Delete failed: ' + (e.message || e), 3600);
        }
      });
    });
  }

  /* ------------------------------ bot ------------------------------ */

  const chatMessages = $('chatMessages');
  const chatText = $('chatText');
  const chatSend = $('chatSend');
  const srcGemini = $('srcGemini');
  const srcLocal = $('srcLocal');
  const srcState = $('srcState');

  let source = 'gemini';
  let chatHistory = [];

  function setSource(s) {
    source = s;
    srcGemini.classList.toggle('is-active', s === 'gemini');
    srcLocal.classList.toggle('is-active', s === 'local');
    srcState.textContent = s === 'gemini' ? 'source: gemini (always online)' : 'source: opencode (local bridge)';
  }
  srcGemini.addEventListener('click', () => setSource('gemini'));
  srcLocal.addEventListener('click', () => setSource('local'));

  function pushBadge(msg) {
    chatMessages.insertAdjacentHTML('beforeend', msg);
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }

  function typingEl() {
    return '<div class="msg bot" id="typingRow"><div class="who" style="--acc: var(--lime)">AI</div><div class="bubble typing">thinking…</div></div>';
  }

  function renderUser(text) {
    pushBadge(`<div class="msg user"><div class="who">YOU</div><div class="bubble">${escapeHtml(text)}</div></div>`);
  }

  function renderBot(text, tag) {
    const t = document.getElementById('typingRow');
    if (t) t.remove();
    pushBadge(`<div class="msg bot"><div class="who" style="--acc: var(--lime)">AI</div><div class="bubble">${escapeHtml(text)}<div class="source">${escapeHtml(tag || source)}</div></div></div>`);
  }

  async function send() {
    const msg = chatText.value.trim();
    if (!msg) return;
    chatText.value = '';
    renderUser(msg);
    chatHistory.push({ role: 'user', content: msg });
    chatHistory = chatHistory.slice(-20);
    pushBadge(typingEl());

    try {
      if (source === 'gemini') {
        const res = await fetch(`${C.SUPABASE_URL}/functions/v1/chat`, {
          method: 'POST',
          headers: {
            apikey: C.SUPABASE_ANON_KEY,
            'Content-Type': 'application/json',
            Authorization: 'Bearer ' + (DB.getSessionToken() || ''),
          },
          body: JSON.stringify({ messages: chatHistory }),
        });
        let body;
        try { body = await res.json(); } catch (e) { body = {}; }
        if (!res.ok) throw new Error((body && body.error) || 'Chat failed (' + res.status + ')');
        chatHistory.push({ role: 'model', content: body.reply || '' });
        renderBot(body.reply || '(no reply)', 'gemini');
      } else {
        const res = await fetch(`${RELAY}/message`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: msg, history: chatHistory.slice(0, -1) }),
        });
        let body;
        try { body = await res.json(); } catch (e) { body = {}; }
        if (!res.ok) throw new Error((body && body.error) || 'Bridge error (' + res.status + ')');
        chatHistory.push({ role: 'model', content: body.reply || '' });
        renderBot(body.reply || '(no reply)', 'opencode · local');
      }
    } catch (e) {
      const err = e.message || String(e);
      chatHistory.pop();
      const t = document.getElementById('typingRow');
      if (t) t.remove();
      toast('Bot error: ' + err, 5000);
      if (source === 'local') {
        pushBadge(`<div class="msg bot"><div class="who" style="--acc: var(--red)">AI</div><div class="bubble">The local bridge is offline. Start it with <b>npm run bridge</b> on your PC, or switch to ☁ Gemini.<div class="source">error</div></div></div>`);
      } else {
        pushBadge(`<div class="msg bot"><div class="who" style="--acc: var(--red)">AI</div><div class="bubble">${escapeHtml(err)}<div class="source">error</div></div></div>`);
      }
    }
  }

  chatSend.addEventListener('click', send);
  chatText.addEventListener('keydown', (e) => { if (e.key === 'Enter') send(); });
  document.querySelectorAll('.chip').forEach((b) => {
    b.addEventListener('click', () => { chatText.value = b.dataset.q; send(); });
  });

  function pollBridge() {
    fetch(`${RELAY}/health`, { signal: AbortSignal.timeout(2000) })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((b) => { $('bridgeDot').className = 'dot on'; $('bridgeLabel').textContent = 'bridge on'; })
      .catch(() => { $('bridgeDot').className = 'dot off'; $('bridgeLabel').textContent = 'bridge off'; });
  }

  /* ------------------------------ boot ------------------------------ */

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  function start() {
    pollBridge();
    setInterval(pollBridge, 5000);
    loadDashboard();
    arrayFromCols();
    arrayFromSearch();
    arrayFromAudit();
    arrayFromBot();
  }

  function arrayFromCols() { (COL_HINTS[dataTableEl.value] || []).forEach((h) => { if (!Array.from(dataColEl.options).some((o) => o.value === h)) dataColEl.appendChild(new Option(h, h)); }); }
  function arrayFromSearch() { dataSearchEl.addEventListener('input', () => { clearTimeout(dataSearchEl._q); dataSearchEl._q = setTimeout(() => { dataPage = 0; loadData(); }, 450); }); }
  function arrayFromAudit() { $('auditActor').addEventListener('keydown', (e) => { if (e.key === 'Enter') loadAudit(); }); $('auditAction').addEventListener('keydown', (e) => { if (e.key === 'Enter') loadAudit(); }); }
  function arrayFromBot() { /* no-op placeholder to keep boot tidy */ }

  // Auto-enter if a super session already exists in this browser.
  (function autoAuth() {
    if (currentRole() === 'super' && DB.getSessionToken()) { enter(); }
  })();
})();