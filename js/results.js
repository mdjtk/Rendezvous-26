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

  const PROGRAMS = window.RV26.PROGRAMS;

  let results = [];
  let category = 'all';
  let program = '';
  let query = '';

  const RANK_LABELS = { 1: 'Winner', 2: 'Runner Up', 3: '2nd Runner Up' };
  const RANK_COLORS = { 1: '#e9c46a', 2: '#b8c0cc', 3: '#d19a66' };

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
      const all = await DB.getResults();
      results = all.filter((r) => r.published);
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