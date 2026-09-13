(function () {
  const DB = window.RV26.DB;
  const UI = window.RV26.UI;
  const esc = UI.escapeHtml;

  const contentEl = document.getElementById('content');
  const catFilter = document.getElementById('champCatFilter');

  const CHAMP_CAT_ORDER = ['Minor', 'Premier', 'Sub junior', 'General'];

  let students = [];

  function medalSvg(color) {
    return (
      '<svg viewBox="0 0 24 24" class="tp-medal-ico" style="color:' + color +
      '" fill="none" stroke="currentColor" stroke-width="1.5">' +
      '<path d="M8 21h8M12 17v4M7.5 3.5h9l-1 6.2a3.5 3.5 0 0 1-7 0l-1-6.2Z" stroke-linejoin="round"/>' +
      '</svg>'
    );
  }

  function championCatRank(key) {
    const known = CHAMP_CAT_ORDER.indexOf(key);
    if (known !== -1) return known;
    if (key === '—') return 99;
    return CHAMP_CAT_ORDER.length;
  }

  function championSharedRanks(list) {
    const ranks = new Array(list.length);
    let prevPts = null;
    let prevRank = 0;
    list.forEach((s, i) => {
      if (prevPts === null || (s.points || 0) < prevPts) prevRank = i + 1;
      ranks[i] = prevRank;
      prevPts = s.points || 0;
    });
    return ranks;
  }

  function render() {
    contentEl.innerHTML = '';
    const scoring = students.filter((s) => (s.points || 0) > 0);
    const cat = catFilter ? catFilter.value : '';
    const topPerCat = cat ? 20 : 5;

    if (scoring.length === 0) {
      UI.showEmpty(contentEl, {
        title: 'No individual champions yet',
        hint: 'Individual champion points will appear here once results are published.',
        icon: 'points',
      });
      return;
    }

    const groups = new Map();
    scoring.forEach((s) => {
      const key = s.category || '—';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(s);
    });

    const buckets = [...groups.entries()]
      .map(([key, list]) => ({
        key,
        list: [...list].sort(
          (a, b) =>
            (b.points || 0) - (a.points || 0) ||
            String(a.name || '').localeCompare(String(b.name || ''))
        ),
      }))
      .filter((b) => !cat || b.key === cat)
      .sort(
        (a, b) =>
          championCatRank(a.key) - championCatRank(b.key) ||
          String(a.key).localeCompare(String(b.key))
      );

    if (buckets.length === 0) {
      UI.showEmpty(contentEl, {
        title: 'No individual champions yet',
        hint: 'Individual champion points will appear here once results are published.',
        icon: 'points',
      });
      return;
    }

    const sec = document.createElement('div');
    sec.className = 'tp-block';
    sec.innerHTML =
      '<div class="tp-block-label"><span class="material-symbols-outlined">leaderboard</span> Individual Champions</div>';

    const tbl = document.createElement('div');
    tbl.className = 'tp-table';

    const th = document.createElement('div');
    th.className = 'tp-th';
    th.innerHTML = '<span>#</span><span>Student</span><span>Category</span><span class="right">Points</span>';
    tbl.appendChild(th);

    buckets.forEach((b) => {
      const head = document.createElement('div');
      head.className = 'tp-cat';
      head.innerHTML =
        '<span>' + esc(b.key) + '</span>' +
        '<span>' + b.list.length + ' scoring</span>';
      tbl.appendChild(head);

      const ranks = championSharedRanks(b.list);
      b.list.slice(0, topPerCat).forEach((s, i) => {
        const pos = ranks[i];
        const lead = pos === 1;
        const row = document.createElement('div');
        row.className = 'tp-tr' + (lead ? ' is-1' : '');
        row.style.animationDelay = i * 60 + 'ms';
        row.innerHTML =
          '<span class="tp-rank">' + (lead ? medalSvg('#a3e635') : esc(pos)) + '</span>' +
          '<span class="tp-team">' +
          '<span class="tp-name">' + esc(s.name) + '</span>' +
          (s.team ? '<span class="tp-crown-sm material-symbols-outlined" style="font-size:14px" title="' + esc(s.team) + '">group</span>' : '') +
          '</span>' +
          '<span class="tp-pts"><b>' + esc(s.category || '—') + '</b></span>' +
          '<span class="tp-pts champ-pts right"><b>' + esc(s.points) + '</b></span>';
        tbl.appendChild(row);
      });
    });

    sec.appendChild(tbl);
    contentEl.appendChild(sec);
  }

  async function load() {
    UI.showLoading(contentEl, 'Loading individual standings…');
    try {
      students = await DB.getStudents();
      render();
      DB.subscribeStudents((next) => {
        students = next;
        render();
      });
    } catch (e) {
      UI.showError(contentEl, 'Could not load the standings right now. Please try again.', load);
    }
  }

  if (catFilter) catFilter.addEventListener('change', render);

  load();
})();