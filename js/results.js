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
  const contentEl = document.getElementById('content');

  let results = [];
  let category = 'all';
  let query = '';

  const RANK_LABELS = { 1: 'Winner', 2: 'Runner Up', 3: '2nd Runner Up' };
  const RANK_COLORS = { 1: '#e9c46a', 2: '#b8c0cc', 3: '#d19a66' };

  async function load() {
    UI.showLoading(contentEl, 'Loading results…');
    try {
      results = await DB.getResults();
      render();
    } catch (e) {
      UI.showError(
        contentEl,
        'Could not load the results right now. Please try again.',
        load
      );
    }
  }

  function categories() {
    const set = new Set();
    results.forEach((r) => {
      if (r.category) set.add(r.category);
    });
    return Array.from(set).sort();
  }

  function trimmedQuery() {
    return query.trim().toLowerCase();
  }

  function matchesQuery(r) {
    const q = trimmedQuery();
    if (!q) return true;
    return [r.name, r.category, r.event_name]
      .filter(Boolean)
      .some((v) => String(v).toLowerCase().includes(q));
  }

  function filtered() {
    return results.filter((r) => {
      if (category !== 'all' && r.category !== category) return false;
      return matchesQuery(r);
    });
  }

  function renderChips() {
    filtersEl.innerHTML = '';
    const cats = categories();
    if (results.length === 0) return;

    const opts = [{ value: 'all', label: 'All' }].concat(
      cats.map((c) => ({ value: c, label: c }))
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
      (r.name
        ? '<span class="poster-name">' +
          (r.rank
            ? '<span class="poster-rank" style="--rank:' + RANK_COLORS[r.rank] + '">' +
              esc(RANK_LABELS[r.rank] || r.rank) +
              '</span>'
            : '') +
          '<span>' + esc(r.name) + '</span>' +
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
})();