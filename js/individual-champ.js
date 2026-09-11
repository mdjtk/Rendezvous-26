(function () {
  const DB = window.RV26.DB;
  const UI = window.RV26.UI;
  const esc = UI.escapeHtml;

  const contentEl = document.getElementById('content');

  let students = [];

  function medalSvg(color) {
    return (
      '<svg viewBox="0 0 24 24" class="tp-medal-ico" style="color:' + color +
      '" fill="none" stroke="currentColor" stroke-width="1.5">' +
      '<path d="M8 21h8M12 17v4M7.5 3.5h9l-1 6.2a3.5 3.5 0 0 1-7 0l-1-6.2Z" stroke-linejoin="round"/>' +
      '</svg>'
    );
  }

  function render() {
    contentEl.innerHTML = '';
    students = students
      .filter((s) => (s.points || 0) > 0)
      .sort((a, b) => (b.points || 0) - (a.points || 0));

    if (students.length === 0) {
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

    students.slice(0, 20).forEach((s, i) => {
      const pos = i + 1;
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
        '<span class="tp-pts right"><b>' + esc(s.points) + '</b></span>';
      tbl.appendChild(row);
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

  load();
})();
