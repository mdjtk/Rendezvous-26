/*
 * Rendezvous '26 — Team Points page
 * Renders a head-to-head duel between the houses and the top-10 standings
 * table, and subscribes to live updates via the DB layer (10s polling over
 * Supabase REST).
 */
(function () {
  const DB = window.RV26.DB;
  const UI = window.RV26.UI;
  const esc = UI.escapeHtml;

  const contentEl = document.getElementById('content');

  let teams = [];

  const TEAM_META = [
    { match: /tanzanian/i, code: 'TT', color: '#A52A2A' },
    { match: /isfahan/i, code: 'II', color: '#676700' },
  ];
  const FALLBACK_COLOR = '#a3e635';

  function teamMeta(team) {
    const name = team ? String(team.name || '') : '';
    for (const m of TEAM_META) {
      if (m.match.test(name)) return { code: m.code, color: m.color };
    }
    const initials =
      name
        .split(/\s+/)
        .map((w) => (w[0] || '').toUpperCase())
        .join('')
        .slice(0, 2) || '?';
    return { code: initials, color: FALLBACK_COLOR };
  }

  function medalSvg(color) {
    return (
      '<svg viewBox="0 0 24 24" class="tp-medal-ico" style="color:' + color +
      '" fill="none" stroke="currentColor" stroke-width="1.5">' +
      '<path d="M8 21h8M12 17v4M7.5 3.5h9l-1 6.2a3.5 3.5 0 0 1-7 0l-1-6.2Z" stroke-linejoin="round"/>' +
      '</svg>'
    );
  }

  function shareOfLeader(team) {
    const top = teams.reduce((m, t) => Math.max(m, t.points || 0), 0);
    return top > 0 ? Math.round(((team.points || 0) / top) * 100) : 0;
  }

  function shareOfTotal(team) {
    const total = teams.reduce((s, t) => s + (t.points || 0), 0);
    return total > 0 ? Math.round(((team.points || 0) / total) * 100) : 0;
  }

  function duelSide(team, lead) {
    const meta = teamMeta(team);
    const side = document.createElement('div');
    side.className = 'tp-side-card' + (lead ? ' is-lead' : '');
    side.style.setProperty('--team', meta.color);
    side.innerHTML =
      '<div class="tp-side-top">' +
      (lead ? '<span class="tp-crown material-symbols-outlined" aria-hidden="true">emoji_events</span>' : '') +
      '</div>' +
      '<span class="tp-side-name">' + esc(team.name) + '</span>' +
      '<span class="tp-side-points"><b>' + esc(team.points) + '</b><i>pts</i></span>' +
      '<span class="tp-side-track"><span class="tp-side-fill" style="width:' + shareOfLeader(team) + '%"></span></span>';
    return side;
  }

  function buildBattle() {
    const sec = document.createElement('div');
    sec.className = 'tp-block';
    sec.innerHTML =
      '<div class="tp-block-label"><span class="material-symbols-outlined">sports_score</span> Head to Head</div>';

    const wrap = document.createElement('div');
    wrap.className = 'tp-battle';

    const duel = document.createElement('div');
    duel.className = 'tp-duel';
    const lead =
      (teams[0].points || 0) > (teams.length > 1 ? teams[1].points || 0 : 0);
    duel.appendChild(duelSide(teams[0], lead));
    if (teams.length > 1) {
      const vs = document.createElement('div');
      vs.className = 'tp-vs';
      vs.setAttribute('aria-hidden', 'true');
      vs.textContent = 'VS';
      duel.appendChild(vs);
      duel.appendChild(duelSide(teams[1], false));
    }
    wrap.appendChild(duel);

    if (teams.length > 1) {
      const split = document.createElement('div');
      split.className = 'tp-split';
      split.setAttribute('role', 'img');
      split.setAttribute('aria-label', 'Share of total points between the houses');
      teams.forEach((t) => {
        const seg = document.createElement('span');
        seg.style.width = shareOfTotal(t) + '%';
        seg.style.background = teamMeta(t).color;
        split.appendChild(seg);
      });
      wrap.appendChild(split);

      const legend = document.createElement('div');
      legend.className = 'tp-split-legend';
      teams.forEach((t) => {
        const meta = teamMeta(t);
        const item = document.createElement('span');
        item.className = 'tp-legend-item';
        item.innerHTML =
          '<span class="tp-legend-dot" style="--dot:' + meta.color + '"></span>' +
          esc(t.name) + ' · ' + shareOfTotal(t) + '%';
        legend.appendChild(item);
      });
      wrap.appendChild(legend);
    }

    sec.appendChild(wrap);
    return sec;
  }

  function leagueTable() {
    const sec = document.createElement('div');
    sec.className = 'tp-block';
    sec.innerHTML =
      '<div class="tp-block-label"><span class="material-symbols-outlined">leaderboard</span> Standings</div>';

    const hasBars = teams.length > 1;
    const top = teams.slice(0, 10);

    const tbl = document.createElement('div');
    tbl.className = 'tp-table';

    const th = document.createElement('div');
    th.className = 'tp-th';
    th.innerHTML =
      '<span>#</span><span>Team</span>' +
      (hasBars ? '<span class="tp-colbar">Share of Leader</span>' : '<span class="tp-colbar"></span>') +
      '<span class="right">Points</span>';
    tbl.appendChild(th);

    top.forEach((team, i) => {
      const pos = i + 1;
      const meta = teamMeta(team);
      const lead = pos === 1;
      const row = document.createElement('div');
      row.className = 'tp-tr' + (lead ? ' is-1' : '');
      row.style.setProperty('--team', meta.color);
      row.style.animationDelay = i * 60 + 'ms';
      row.innerHTML =
        '<span class="tp-rank">' + (lead ? medalSvg(meta.color) : esc(pos)) + '</span>' +
        '<span class="tp-team">' +
        '<span class="tp-dot" style="background:var(--team)"></span>' +
        '<span class="tp-name">' + esc(team.name) + '</span>' +
        (lead ? '<span class="tp-crown-sm material-symbols-outlined">emoji_events</span>' : '') +
        '</span>' +
        '<span class="tp-colbar"><span class="tp-bar"><span class="tp-fill" style="width:' + shareOfLeader(team) + '%"></span></span></span>' +
        '<span class="tp-pts right"><b>' + esc(team.points) + '</b></span>';
      tbl.appendChild(row);
    });

    sec.appendChild(tbl);
    return sec;
  }

  function render() {
    contentEl.innerHTML = '';
    teams = teams.slice().sort((a, b) => (b.points || 0) - (a.points || 0));

    if (teams.length === 0) {
      UI.showEmpty(contentEl, {
        title: 'No teams yet',
        hint: 'Team standings will appear here once the competition begins.',
        icon: 'points',
      });
      return;
    }

    contentEl.appendChild(buildBattle());
    contentEl.appendChild(leagueTable());
  }

  async function load() {
    UI.showLoading(contentEl, 'Loading standings…');
    try {
      teams = await DB.getTeams();
      render();
      DB.subscribeTeams((next) => {
        teams = next;
        render();
      });
    } catch (e) {
      UI.showError(contentEl, 'Could not load the standings right now. Please try again.', load);
    }
  }

  load();
})();