/*
 * Rendezvous '26 — Results page
 * Loads published result posters from the DB layer, exposes a search box
 * (filter by participant name, category or event) plus category chips, and
 * opens posters in the shared lightbox.
 */
(function () {
  const DB = window.RV26.DB;
  const UI = window.RV26.UI;
  const esc = UI.escapeHtml;

  const searchEl = document.getElementById('result-search');
  const searchClear = document.getElementById('result-search-clear');
  const filtersEl = document.getElementById('filters');
  const programEl = document.getElementById('program-filter');
  const contentEl = document.getElementById('content');
  const exportSection = document.getElementById('export-section');
  const exportCount = document.getElementById('export-count');

  const PROGRAMS = window.RV26.PROGRAMS;

  let results = [];
  let category = 'all';
  let program = '';
  let query = '';
  let studentMap = new Map();

  const RANK_LABELS = { 1: 'Winner', 2: 'Runner Up', 3: '2nd Runner Up' };
  const RANK_COLORS = { 1: '#e9c46a', 2: '#b8c0cc', 3: '#d19a66' };
  const EXPORT_COLUMNS = ['Event', 'Place', 'Category', 'Participant', 'Team', 'Grade'];

  function cleanName(raw) {
    return String(raw || '').replace(/\s+/g, ' ').trim();
  }

  function norm(value) {
    return String(value || '')
      .toLowerCase()
      .replace(/\s+/g, ' ');
  }

  function placeChip(p, points) {
    if (!p || !p.participant_name) return '';
    const pts = p.rank && points ? Number(points[String(p.rank)]) : 0;
    return (
      '<span class="poster-place">' +
      (p.rank
        ? '<span class="poster-rank" style="--rank:' + RANK_COLORS[p.rank] + '">' +
          esc(RANK_LABELS[p.rank] || p.rank) +
          '</span>'
        : '') +
      '<span class="poster-place-name">' + esc(p.participant_name) + '</span>' +
      (p.grade ? '<span class="placement-grade-badge">' + esc(p.grade) + '</span>' : '') +
      (pts ? '<span class="placement-points-badge">+' + esc(pts) + ' pts</span>' : '') +
      '</span>'
    );
  }

  async function load() {
    UI.showLoading(contentEl, 'Loading results…');
    try {
      const [all, students] = await Promise.all([DB.getResults(), DB.getStudents()]);
      results = all.filter((r) => r.published);
      studentMap = new Map();
      (students || []).forEach((s) => studentMap.set(cleanName(s.name).toLowerCase(), s));
      render();
    } catch (e) {
      UI.showError(
        contentEl,
        'Could not load the results right now. Please try again.',
        load
      );
    }
  }

  function trimmedQuery() {
    return query.trim().toLowerCase();
  }

  function placeNames(r) {
    const names = [];
    if (r.participant_name) names.push(r.participant_name);
    if (Array.isArray(r.places)) {
      r.places.forEach((p) => {
        if (p && p.participant_name) names.push(p.participant_name);
      });
    }
    return names;
  }

  function matchesQuery(r) {
    const q = trimmedQuery();
    if (!q) return true;
    return [r.event_name, r.category]
      .concat(placeNames(r))
      .filter(Boolean)
      .some((v) => norm(v).includes(q));
  }

  function matchesProgram(r) {
    if (!program) return true;
    return norm(r.event_name).includes(program);
  }

  function filtered() {
    return results.filter((r) => {
      if (category !== 'all' && norm(r.category) !== category) return false;
      if (!matchesProgram(r)) return false;
      return matchesQuery(r);
    });
  }

  function renderChips() {
    filtersEl.innerHTML = '';
    const names = PROGRAMS ? PROGRAMS.sections() : [];
    const opts = [{ value: 'all', label: 'All' }].concat(
      names.map((n) => ({ value: norm(n), label: n }))
    );

    opts.forEach((opt) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'chip' + (category === opt.value ? ' is-active' : '');
      btn.textContent = opt.label;
      btn.addEventListener('click', () => {
        category = opt.value;
        renderChips();
        render();
      });
      filtersEl.appendChild(btn);
    });
  }

  function syncClear() {
    if (searchClear) {
      searchClear.style.display = query ? 'flex' : 'none';
    }
  }

  function posterCard(r, onOpen) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'poster-card animate-fade-in';
    btn.setAttribute(
      'aria-label',
      'Open result poster: ' + r.event_name + (r.name ? ', ' + r.name : '')
    );
    btn.innerHTML =
      '<img src="' + esc(r.url) + '" alt="' + esc(r.event_name) + '" loading="lazy" />' +
      '<span class="poster-meta">' +
      '  <span class="poster-event">' + esc(r.event_name) + '</span>' +
      '  <span class="poster-cat">' + esc(r.category || '') + '</span>' +
      (Array.isArray(r.places) && r.places.length
        ? '<span class="poster-places">' +
          r.places.map((p) => placeChip(p, r.points)).join('') +
          '</span>'
        : r.name
          ? '<span class="poster-name">' +
            placeChip({ rank: r.rank, participant_name: r.name }, r.points) +
            '</span>'
          : '') +
      '</span>';
    btn.addEventListener('click', () => onOpen());
    return btn;
  }

  function render() {
    contentEl.innerHTML = '';
    renderChips();
    syncClear();

    const list = filtered();
    updateExport(list);

    if (list.length === 0) {
      if (results.length === 0) {
        UI.showEmpty(contentEl, {
          title: 'No results yet',
          hint: 'Published result posters will appear here as the juries sign them off.',
          icon: 'result',
        });
      } else if (trimmedQuery()) {
        UI.showEmpty(contentEl, {
          title: 'No matches for "' + esc(query.trim()) + '"',
          hint: 'Try a different name or category, or clear the search.',
          icon: 'result',
        });
      } else if (program) {
        UI.showEmpty(contentEl, {
          title: 'Nothing for this programme yet',
          hint: 'Results for that programme will appear here once the jury signs them off.',
          icon: 'result',
        });
      } else {
        UI.showEmpty(contentEl, {
          title: 'Nothing in this category',
          hint: 'Try another filter — posters in other categories are still available.',
          icon: 'result',
        });
      }
      return;
    }

    const meta = document.createElement('div');
    meta.className = 'result-count';
    meta.textContent =
      list.length + (list.length === 1 ? ' result' : ' results') +
      (query.trim() ? ' for "' + query.trim() + '"' : '');
    contentEl.appendChild(meta);

    const grid = document.createElement('div');
    grid.className = 'poster-grid';

    list.forEach((r, i) => {
      grid.appendChild(
        posterCard(r, () => {
          UI.Lightbox.open(list, i, { downloadLabel: 'Save poster' });
        })
      );
    });

    contentEl.appendChild(grid);
  }

  /* ------------------------------ export ------------------------------ */

  function flatRow(r) {
    const cat = cleanName(r.category);
    const places = Array.isArray(r.places)
      ? r.places.filter((p) => p && cleanName(p.participant_name))
      : [];
    if (places.length) {
      return places.map((p) => {
        const st = studentMap.get(cleanName(p.participant_name).toLowerCase());
        return {
          event: cleanName(r.event_name),
          place: RANK_LABELS[p.rank] || String(p.rank || ''),
          category: cat,
          participant: cleanName(p.participant_name),
          team: st && st.team ? st.team : '',
          grade: p.grade || (st && st.category ? st.category : '') || '',
        };
      });
    }
    if (cleanName(r.participant_name)) {
      const st = studentMap.get(cleanName(r.participant_name).toLowerCase());
      return [
        {
          event: cleanName(r.event_name),
          place: RANK_LABELS[r.rank] || String(r.rank || ''),
          category: cat,
          participant: cleanName(r.participant_name),
          team: st && st.team ? st.team : '',
          grade: st && st.category ? st.category : '',
        },
      ];
    }
    return [];
  }

  function flatRows() {
    return filtered().reduce((acc, r) => acc.concat(flatRow(r)), []);
  }

  function countPlacements(list) {
    let n = 0;
    list.forEach((r) => {
      const places = Array.isArray(r.places)
        ? r.places.filter((p) => p && cleanName(p.participant_name))
        : [];
      if (places.length) n += places.length;
      else if (cleanName(r.participant_name)) n += 1;
    });
    return n;
  }

  function csvCell(v) {
    return '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
  }

  function toCSV() {
    const rows = flatRows();
    const lines = [EXPORT_COLUMNS.map(csvCell).join(',')];
    rows.forEach((r) =>
      lines.push(EXPORT_COLUMNS.map((c) => csvCell(r[c.toLowerCase()])).join(','))
    );
    return '\uFEFF' + lines.join('\r\n');
  }

  function toClipboard() {
    const rows = flatRows();
    const lines = [EXPORT_COLUMNS.join('\t')];
    rows.forEach((r) => lines.push(EXPORT_COLUMNS.map((c) => r[c.toLowerCase()]).join('\t')));
    return lines.join('\n');
  }

  function download(filename, text, type) {
    const blob = new Blob([text], { type: type || 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  let flashTimer;
  function flash(btn, label) {
    if (!btn.dataset.originalHtml) btn.dataset.originalHtml = btn.innerHTML;
    btn.innerHTML =
      '<span class="material-symbols-outlined text-[16px]" aria-hidden="true">check</span>' + label;
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => {
      btn.innerHTML = btn.dataset.originalHtml;
    }, 1400);
  }

  function textareaFallback(text) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }

  async function copyExport(btn) {
    const payload = toClipboard();
    try {
      if (navigator.clipboard && window.isSecureContext) {
        try {
          await navigator.clipboard.writeText(payload);
        } catch (err) {
          textareaFallback(payload);
        }
      } else {
        textareaFallback(payload);
      }
      flash(btn, 'Copied');
    } catch (err) {
      flash(btn, 'Copy failed');
    }
  }

  const PRINT_ID = 'export-print-area';

  function rankColor(place) {
    if (place === 'Winner') return RANK_COLORS[1];
    if (place === 'Runner Up') return RANK_COLORS[2];
    if (place === '2nd Runner Up') return RANK_COLORS[3];
    return null;
  }

  function exportRowsHtml() {
    const head = EXPORT_COLUMNS.map((c) => '<th>' + esc(c) + '</th>').join('');
    const groups = [];
    flatRows().forEach((r) => {
      const last = groups[groups.length - 1];
      if (last && last.event === r.event) last.items.push(r);
      else groups.push({ event: r.event, items: [r] });
    });
    const body = groups
      .map((g) => {
        const span = g.items.length > 1 ? ' rowspan="' + g.items.length + '"' : '';
        return g.items
          .map((r, i) => {
            const eventTd =
              i === 0
                ? '<td class="ep-col-event"' + span + '>' + esc(g.event) + '</td>'
                : '';
            const color = rankColor(r.place);
            const chip =
              '<span class="ep-rank-chip"' +
              (color ? ' style="background:' + color + '"' : '') +
              '>' + esc(r.place) + '</span>';
            return (
              '<tr>' +
              eventTd +
              '<td>' + chip + '</td>' +
              '<td>' + esc(r.category) + '</td>' +
              '<td>' + esc(r.participant) + '</td>' +
              '<td>' + esc(r.team) + '</td>' +
              '<td>' + esc(r.grade) + '</td>' +
              '</tr>'
            );
          })
          .join('');
      })
      .join('');
    return '<table class="export-print-table"><thead><tr>' + head + '</tr></thead><tbody>' + body + '</tbody></table>';
  }

  function printPDF() {
    const rows = flatRows();
    const existing = document.getElementById(PRINT_ID);
    if (existing) existing.remove();
    const filters = [];
    if (category !== 'all') filters.push(category);
    if (program) filters.push(program);
    if (query.trim()) filters.push('"' + query.trim() + '"');
    const filterLabel = filters.length ? filters.join(' \u00b7 ') : 'All categories';
    const date = new Date().toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
    const area = document.createElement('div');
    area.id = PRINT_ID;
    area.className = 'export-print-area';
    area.innerHTML =
      '<div class="ep-experience">' +
      '<div class="ep-ambient"></div>' +
      '<div class="ep-main">' +
      '<div class="ep-brand">' +
      '<img src="assets/img/Logo-.png" alt="" />' +
      '<img src="assets/img/rendezvous.webp" alt="Rendezvous 26" />' +
      '</div>' +
      '<h1 class="ep-title">Results</h1>' +
      '<p class="ep-meta">' + esc(filterLabel) +
      ' \u00b7 ' + rows.length + (rows.length === 1 ? ' placement' : ' placements') + '</p>' +
      '<p class="ep-meta ep-date">Generated ' + esc(date) + '</p>' +
      exportRowsHtml() +
      '<p class="ep-foot">Rendezvous \u002726 \u00b7 Jamia Madeenathunnoor \u00b7 SEPT 12\u201313, 2026</p>' +
      '</div>' +
      '</div>';
    document.body.appendChild(area);
    window.print();
    setTimeout(() => {
      const el = document.getElementById(PRINT_ID);
      if (el) el.remove();
    }, 2000);
  }

  function updateExport(list) {
    if (!exportSection) return;
    const placements = countPlacements(list);
    exportCount.textContent =
      list.length + (list.length === 1 ? ' result' : ' results') +
      ' \u00b7 ' + placements + (placements === 1 ? ' placement' : ' placements');
    const empty = list.length === 0;
    exportSection.classList.toggle('is-empty', empty);
    exportSection.querySelectorAll('[data-export]').forEach((b) => {
      b.disabled = empty;
    });
  }

  if (exportSection) {
    exportSection.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-export]');
      if (!btn || btn.disabled) return;
      if (btn.dataset.export === 'csv') {
        download('rendezvous-results.csv', toCSV(), 'text/csv;charset=utf-8');
      } else if (btn.dataset.export === 'copy') {
        copyExport(btn);
      } else if (btn.dataset.export === 'pdf') {
        printPDF();
      }
    });
  }

  window.addEventListener('afterprint', () => {
    const el = document.getElementById(PRINT_ID);
    if (el) el.remove();
  });

  searchEl.addEventListener('input', () => {
    query = searchEl.value;
    render();
  });

  if (programEl) {
    if (PROGRAMS) {
      PROGRAMS.SECTIONS.forEach((s) => {
        s.stages.forEach((st) => {
          if (!st.items.length) return;
          const og = document.createElement('optgroup');
          og.label = s.name + ' · ' + st.stage;
          st.items.forEach((n) => {
            const o = document.createElement('option');
            o.value = n;
            o.textContent = n;
            og.appendChild(o);
          });
          programEl.appendChild(og);
        });
      });
    }
    programEl.addEventListener('change', () => {
      program = programEl.value;
      render();
    });
  }

  if (searchClear) {
    searchClear.addEventListener('click', () => {
      searchEl.value = '';
      query = '';
      searchEl.focus();
      render();
    });
    searchClear.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        searchEl.value = '';
        query = '';
        searchEl.focus();
        render();
      }
    });
  }

  load();

  if (DB.subscribeResults) {
    DB.subscribeResults((next) => {
      results = next.filter((r) => r.published);
      render();
    });
  }
})();