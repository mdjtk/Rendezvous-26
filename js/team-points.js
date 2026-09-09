/*
 * Rendezvous '26 — Team Points page
 * Renders the stats strip, trophy podium and the full standings table, and
 * subscribes to live updates via the DB layer (10s polling over Supabase REST).
 */
(function () {
  const DB = window.RV26.DB;
  const UI = window.RV26.UI;
  const esc = UI.escapeHtml;

  const contentEl = document.getElementById('content');
  const liveBadge = document.getElementById('liveBadge');

  let teams = [];
  let flashTimer = null;

  const MEDALS = { 1: '#e9c46a', 2: '#b8c0cc', 3: '#d19a66' };
  const AVATAR_COLORS = [
    '#a3e635', '#7dd3fc', '#fbbf24', '#f472b6',
    '#f87171', '#c084fc', '#34d399', '#fca5a5',
  ];

  function medalSvg(color) {
    return (
      '<svg viewBox="0 0 24 24" class="tp-medal-ico" style="color:' + color +
      '" fill="none" stroke="currentColor" stroke-width="1.5">' +
      '<path d="M8 21h8M12 17v4M7.5 3.5h9l-1 6.2a3.5 3.5 0 0 1-7 0l-1-6.2Z" stroke-linejoin="round"/>' +
      '</svg>'
    );
  }

  function pct(team) {
    return teams[0] && teams[0].points > 0
      ? Math.round((team.points / teams[0].points) * 100)
      : 0;
  }

  function statsStrip() {
    const total = teams.reduce((s, t) => s + (t.points || 0), 0);
    const leader = teams[0];
    const data = [
      { icon: 'groups', value: String(teams.length), label: 'Teams' },
      { icon: 'savings', value: total.toLocaleString(), label: 'Total Points' },
      { icon: 'emoji_events', value: leader ? leader.name : '—', label: 'Leading House' },
    ];
    const wrap = document.createElement('div');
    wrap.className = 'tp-stats';
    data.forEach((d, i) => {
      const cell = document.createElement('div');
      cell.className = 'tp-stat' + (i === 2 ? ' tp-stat-lead' : '');
      cell.innerHTML =
        '<span class="tp-stat-ico material-symbols-outlined">' + esc(d.icon) + '</span>' +
        '<span class="tp-stat-value">' + esc(d.value) + '</span>' +
        '<span class="tp-stat-label">' + esc(d.label) + '</span>';
      wrap.appendChild(cell);
    });
    return wrap;
  }

  function podiumSpot(team, pos) {
    const spot = document.createElement('div');
    spot.className = 'tp-pod rank-' + pos;
    spot.style.setProperty('--pod-color', MEDALS[pos]);

    const top = document.createElement('div');
    top.className = 'tp-pod-top';
    top.innerHTML =
      (pos === 1 ? '<span class="tp-crown material-symbols-outlined">emoji_events</span>' : '') +
      '<span class="tp-medal">' + medalSvg(MEDALS[pos]) + '</span>';

    const rankLabel =
      pos === 1 ? 'Champion' : pos === 2 ? 'Runner Up' : 'Second Runner Up';

    const card = document.createElement('div');
    card.className = 'tp-pod-card';
    card.style.animationDelay = (pos * 90) + 'ms';
    card.innerHTML =
      '<span class="tp-pod-label">' + rankLabel + '</span>' +
      '<span class="tp-pod-name">' + esc(team.name) + '</span>' +
      '<span class="tp-pod-points"><b>' + esc(team.points) + '</b><i>pts</i></span>' +
      '<span class="tp-pod-track"><span class="tp-pod-fill" style="width:' + pct(team) + '%"></span></span>';

    spot.appendChild(top);
    spot.appendChild(card);
    return spot;
  }

  function buildPodium() {
    const sec = document.createElement('div');
    sec.className = 'tp-block';
    sec.innerHTML =
      '<div class="tp-block-label"><span class="material-symbols-outlined">workspace_premium</span> Top 3 Houses</div>';
    const podium = document.createElement('div');
    podium.className = 'tp-podium';
    teams.slice(0, 3).forEach((team, i) => podium.appendChild(podiumSpot(team, i + 1)));
    sec.appendChild(podium);
    return sec;
  }

  function leagueTable() {
    const sec = document.createElement('div');
    sec.className = 'tp-block';
    sec.innerHTML =
      '<div class="tp-block-label"><span class="material-symbols-outlined">leaderboard</span> Full Standings</div>';

    const hasBars = teams.length > 1;

    const tbl = document.createElement('div');
    tbl.className = 'tp-table';

    const th = document.createElement('div');
    th.className = 'tp-th';
    th.innerHTML =
      '<span>#</span><span>Team</span>' +
      (hasBars ? '<span class="tp-colbar">Share of Leader</span>' : '<span class="tp-colbar"></span>') +
      '<span class="right">Points</span>';
    tbl.appendChild(th);

    teams.forEach((team, i) => {
      const pos = i + 1;
      const row = document.createElement('div');
      row.className = 'tp-tr is-' + (pos <= 3 ? pos : 0);
      row.style.setProperty('--avatar', AVATAR_COLORS[i % AVATAR_COLORS.length]);
      row.style.animationDelay = (i * 60) + 'ms';
      row.innerHTML =
        '<span class="tp-rank rank-' + pos + '">' +
        (pos <= 3 ? medalSvg(MEDALS[pos]) : esc(pos)) +
        '</span>' +
        '<span class="tp-team">' +
        '<span class="tp-avatar">' + esc((team.name || '?').charAt(0).toUpperCase()) + '</span>' +
        '<span class="tp-name">' + esc(team.name) + '</span>' +
        (pos === 1 ? '<span class="tp-crown-sm material-symbols-outlined">emoji_events</span>' : '') +
        '</span>' +
        '<span class="tp-colbar"><span class="tp-bar"><span class="tp-fill" style="width:' + pct(team) + '%"></span></span></span>' +
        '<span class="tp-pts right"><b>' + esc(team.points) + '</b></span>';
      tbl.appendChild(row);
    });

    sec.appendChild(tbl);
    return sec;
  }

  function render() {
    contentEl.innerHTML = '';
    liveBadge.classList.add('is-live');
    clearTimeout(flashTimer);
    if (teams.length > 0) {
      liveBadge.classList.add('flash');
      flashTimer = setTimeout(() => liveBadge.classList.remove('flash'), 900);
    }

    if (teams.length === 0) {
      UI.showEmpty(contentEl, {
        title: 'No teams yet',
        hint: 'Team standings will appear here once the competition begins.',
        icon: 'points',
      });
      return;
    }

    contentEl.appendChild(statsStrip());
    contentEl.appendChild(buildPodium());
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