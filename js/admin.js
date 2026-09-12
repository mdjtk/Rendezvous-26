/*
 * Rendezvous '26 — Admin panel
 * Access-gated control panel for publishing results, uploading photos and
 * managing team points on top of the shared DB layer.
 */
(function () {
  const C = window.RV26.CONFIG;
  const DB = window.RV26.DB;
  const UI = window.RV26.UI;
  const PROGRAMS = window.RV26.PROGRAMS;
  const esc = UI.escapeHtml;

  const SESSION_KEY = 'rv26_role';

  const gate = document.getElementById('gate');
  const hero = document.getElementById('hero');
  const gatePw = document.getElementById('gatePw');
  const gateErr = document.getElementById('gateErr');
  const gateForm = document.getElementById('gateForm');
  const dash = document.getElementById('adminDash');
  const setupBanner = document.getElementById('setupBanner');
  const setupMsg = document.getElementById('setupMsg');
  const setupMsg2 = document.getElementById('setupMsg2');
  const logoutBtn = document.getElementById('logoutBtn');
  const tabs = document.querySelectorAll('.tab');
  const panels = document.querySelectorAll('.panel');

  let tabsReady = false;

  /* ------------------------------ security ----------------------------- */

  function attempt(pw) {
    if (!pw) {
      gateErr.textContent = 'Enter an access code.';
      gatePw.focus();
      return;
    }
    const btn = gateForm.querySelector('button[type="submit"], button');
    if (btn) btn.disabled = true;
    gateErr.textContent = '';
    const pins = (C && C.PIN) || {};
    const role = pw === pins.admin ? 'admin' : pw === pins.store ? 'store' : pw === pins.bookstall ? 'bookstall' : null;
    if (btn) btn.disabled = false;
    if (role) {
      grant(role);
    } else {
      gateErr.textContent = 'Incorrect access code. Try again.';
      gatePw.select();
    }
  }

  function grant(role) {
    gateErr.textContent = '';
    gatePw.value = '';
    try {
      sessionStorage.setItem(SESSION_KEY, role);
    } catch (e) {
      /* ignore */
    }
    boot(role);
  }

  function gateReveal() {
    gate.classList.remove('is-hidden');
    if (hero) hero.classList.remove('is-hidden');
    dash.classList.add('is-hidden');
  }

  function boot(role) {
    gate.classList.add('is-hidden');
    if (hero) hero.classList.add('is-hidden');
    dash.classList.remove('is-hidden');
    document.title = role === 'store' || role === 'bookstall' ? 'Store Counter — Rendezvous \'26' : 'Admin — Rendezvous \'26';
    const live = DB.isSupabaseConfigured();
    setupBanner.classList.toggle('is-hidden', live);
    setupMsg.textContent = live ? 'Live data mode' : 'Supabase not configured';
    setupMsg2.textContent = live
      ? 'writing to your Supabase project'
      : 'add SUPABASE_URL + SUPABASE_ANON_KEY to js/config.js';
    if (role === 'store' || role === 'bookstall') {
      storeBoot();
      return;
    }
    initTabs();
    loadPhotos();
    loadResults();
    loadResultPrograms();
    loadTeams();
    loadResultsCounts();
    loadStudents();
    loadChamp();
    loadSchedule();
    loadAwardPrograms();
    loadAwardLog();
    startStudentPoll();
  }

  function logout() {
    DB.clearSessionToken();
    sessionStorage.removeItem(SESSION_KEY);
    window.location.reload();
  }

  gateForm.addEventListener('submit', (e) => {
    e.preventDefault();
    attempt(gatePw.value.trim());
  });

  if (logoutBtn) logoutBtn.addEventListener('click', logout);

  /* -------------------------------- tabs -------------------------------- */

  function initTabs() {
    if (tabsReady) return;
    tabsReady = true;
    const showTab = (name) => {
      tabs.forEach((t) => {
        const active = t.dataset.tab === name;
        t.classList.toggle('is-active', active);
        t.setAttribute('aria-selected', active ? 'true' : 'false');
      });
      panels.forEach((p) => p.classList.toggle('is-hidden', p.id !== 'panel-' + name));
    };
    tabs.forEach((t) => t.addEventListener('click', () => showTab(t.dataset.tab)));
  }

  /* ------------------------------- photos ------------------------------- */

  const PHOTO_PAGE = 24;

  const photoGrid = document.getElementById('photoGrid');
  const photoInput = document.getElementById('photoInput');
  const photoCaption = document.getElementById('photoCaption');
  const photoSearch = document.getElementById('photoSearch');
  const photoCount = document.getElementById('photoCount');
  const photoPager = document.getElementById('photoPager');
  const photoLoadMore = document.getElementById('photoLoadMore');
  let photoTotal = 0;
  let photoOffset = 0;
  let photoSearchText = '';

  async function loadPhotos() {
    try {
      const page = await DB.getGalleryPage({
        limit: PHOTO_PAGE,
        offset: photoOffset,
        search: photoSearchText || undefined,
      });
      photoTotal = page.count;
      renderPhotos(page.data, photoOffset === 0);
    } catch (err) {
      UI.showError(photoGrid, 'Could not load photos.', () => loadPhotos());
    }
  }

  function renderPhotos(gallery, isFirst) {
    if (isFirst) photoGrid.innerHTML = '';
    if (gallery.length === 0 && isFirst) {
      photoGrid.appendChild(
        UI.emptyState({
          title: photoSearchText ? 'No photos matched' : 'No photos uploaded',
          hint: photoSearchText
            ? 'Try a different caption search.'
            : 'Use the button above to add photos from the festival floor.',
          icon: 'photo',
        })
      );
    } else {
      gallery.forEach((p) => {
        const card = document.createElement('div');
        card.className = 'admin-item';
        card.innerHTML =
          '<img src="' + esc(p.url) + '" alt="' + esc(p.caption || 'Festival photo') + '" loading="lazy" />' +
          (p.caption ? '<span class="admin-item-cap">' + esc(p.caption) + '</span>' : '') +
          '<button type="button" class="admin-dl" title="Download photo" aria-label="Download photo">' +
          '<svg viewBox="0 0 24 24" style="width:1rem;height:1rem" stroke="currentColor" stroke-width="1.8" fill="none"><path d="M12 4v11m0 0l-4-4m4 4l4-4M5 20h14"/></svg>' +
          '</button>' +
          '<button type="button" class="admin-del" aria-label="Delete photo">' +
          '<svg viewBox="0 0 24 24" style="width:1rem;height:1rem" stroke="currentColor" stroke-width="1.8" fill="none"><path d="M6 6l12 12M18 6L6 18"/></svg>' +
          '</button>';
        card.querySelector('.admin-dl').addEventListener('click', () => {
          UI.saveImage(p.url, (p.caption || 'photo ' + p.id) + UI.extOf(p.url));
        });
        card.querySelector('.admin-del').addEventListener('click', async () => {
          if (!window.confirm('Delete this photo?')) return;
          try {
            await DB.deletePhoto(p.id);
            photoOffset = 0;
            await loadPhotos();
          } catch (err) {
            window.alert('Could not delete the photo.');
          }
        });
        photoGrid.appendChild(card);
      });
    }
    const shown = photoGrid.querySelectorAll('.admin-item').length;
    photoCount.textContent =
      photoTotal === 0
        ? (photoSearchText ? 'No photos found' : 'No photos yet')
        : 'Showing ' + shown + ' of ' + photoTotal + ' photo' + (photoTotal === 1 ? '' : 's');
    photoPager.classList.toggle('is-hidden', photoOffset + PHOTO_PAGE >= photoTotal);
  }

  photoInput.addEventListener('change', async () => {
    const files = Array.from(photoInput.files || []);
    const caption = photoCaption.value.trim();
    if (files.length === 0) return;
    for (const f of files) {
      try {
        await DB.addPhoto(f, caption);
      } catch (err) {
        window.alert('Could not upload "' + f.name + '".');
      }
    }
    photoInput.value = '';
    photoCaption.value = '';
    photoOffset = 0;
    await loadPhotos();
  });

  photoLoadMore.addEventListener('click', () => {
    photoOffset += PHOTO_PAGE;
    loadPhotos();
  });

  let photoDebounce;
  photoSearch.addEventListener('input', () => {
    clearTimeout(photoDebounce);
    photoDebounce = setTimeout(() => {
      photoSearchText = photoSearch.value.trim();
      photoOffset = 0;
      loadPhotos();
    }, 300);
  });

  /* ------------------------------- results ------------------------------- */

  const resultForm = document.getElementById('resultForm');
  const eventName = document.getElementById('eventName');
  const categoryField = document.getElementById('category');
  const placementList = document.getElementById('placementList');
  const addPlacementBtn = document.getElementById('addPlacement');

  function addPlacementRow(rankValue, removable) {
    const DEFAULTS = { 1: 10, 2: 6, 3: 3 };
    const COIN_DEFAULTS = { 1: 50, 2: 30, 3: 20 };
    const INPUT_CLS = 'h-11 bg-surface-container-high/70 border border-white/10 rounded-lg px-space-md text-on-background font-body-md text-body-md focus:outline-none focus:border-primary/60 transition-all';
    const rankSel = document.createElement('select');
    rankSel.className = 'placement-rank w-[110px] shrink-0 ' + INPUT_CLS;
    rankSel.innerHTML =
      '<option value="">Position</option>' +
      '<option value="1">1 — Winner</option>' +
      '<option value="2">2 — Runner Up</option>' +
      '<option value="3">3 — 2nd Runner Up</option>';
    rankSel.value = String(rankValue || '');
    rankSel.setAttribute('aria-label', 'Place rank');
    const nameInp = document.createElement('input');
    nameInp.type = 'text';
    nameInp.placeholder = 'Participant name';
    nameInp.setAttribute('aria-label', 'Participant name for this place');
    nameInp.setAttribute('list', 'placementOptions');
    nameInp.setAttribute('autocomplete', 'off');
    nameInp.className = 'placement-name flex-1 min-w-0 ' + INPUT_CLS.replace(INPUT_CLS, INPUT_CLS + ' placeholder:text-on-surface-variant/50');
    const ptsLabel = document.createElement('span');
    ptsLabel.className = 'font-label-code text-[10px] text-on-surface-variant uppercase tracking-widest shrink-0';
    ptsLabel.textContent = 'Pts';
    const ptsInp = document.createElement('input');
    ptsInp.type = 'number';
    ptsInp.step = '1';
    ptsInp.min = '0';
    ptsInp.value = String(DEFAULTS[rankValue] || 0);
    ptsInp.placeholder = 'Pts';
    ptsInp.className = 'placement-points w-[60px] shrink-0 ' + INPUT_CLS + ' text-center';
    ptsInp.setAttribute('aria-label', 'Points for this place');
    const gradeSel = document.createElement('select');
    gradeSel.className = 'placement-grade w-[72px] shrink-0 ' + INPUT_CLS;
    gradeSel.innerHTML =
      '<option value="">No Grade</option>' +
      '<option value="A+">A+</option><option value="A">A</option>' +
      '<option value="B">B</option><option value="C">C</option>';
    gradeSel.setAttribute('aria-label', 'Grade');
    const coinsLabel = document.createElement('span');
    coinsLabel.className = 'font-label-code text-[10px] text-on-surface-variant uppercase tracking-widest shrink-0';
    coinsLabel.textContent = 'Coins';
    const coinsInp = document.createElement('input');
    coinsInp.type = 'number';
    coinsInp.step = '1';
    coinsInp.min = '0';
    coinsInp.value = String(COIN_DEFAULTS[rankValue] || 0);
    coinsInp.placeholder = '0';
    coinsInp.className = 'placement-coins w-[60px] shrink-0 ' + INPUT_CLS + ' text-center';
    coinsInp.setAttribute('aria-label', 'Coins for this place');
    rankSel.addEventListener('change', () => {
      const r = Number(rankSel.value);
      if (DEFAULTS[r] != null && !ptsInp.dataset.custom) ptsInp.value = String(DEFAULTS[r]);
      if (COIN_DEFAULTS[r] != null && !coinsInp.dataset.custom) coinsInp.value = String(COIN_DEFAULTS[r]);
    });
    ptsInp.addEventListener('input', () => {
      ptsInp.dataset.custom = ptsInp.value ? '1' : '';
    });
    coinsInp.addEventListener('input', () => {
      coinsInp.dataset.custom = coinsInp.value ? '1' : '';
    });
    const row = document.createElement('div');
    row.className = 'placement-row flex items-center gap-space-sm flex-wrap';
    row.appendChild(rankSel);
    row.appendChild(nameInp);
    row.appendChild(ptsLabel);
    row.appendChild(ptsInp);
    row.appendChild(gradeSel);
    row.appendChild(coinsLabel);
    row.appendChild(coinsInp);
    if (removable) {
      const rm = document.createElement('button');
      rm.type = 'button';
      rm.className =
        'placement-remove h-11 px-space-sm shrink-0 rounded-lg text-on-surface-variant hover:text-error hover:bg-error/10 transition-colors inline-flex items-center justify-center';
      rm.setAttribute('aria-label', 'Remove place');
      rm.innerHTML =
        '<svg viewBox="0 0 24 24" style="width:1.1rem;height:1.1rem" stroke="currentColor" stroke-width="1.8" fill="none"><path d="M6 6l12 12M18 6L6 18"/></svg>';
      rm.addEventListener('click', () => row.remove());
      row.appendChild(rm);
    }
    return row;
  }

  function resetPlacements() {
    placementList.innerHTML = '';
    placementList.appendChild(addPlacementRow(1, false));
    placementList.appendChild(addPlacementRow(2, false));
    placementList.appendChild(addPlacementRow(3, false));
  }

  resetPlacements();

  addPlacementBtn.addEventListener('click', () => {
    const row = addPlacementRow(2, true);
    placementList.appendChild(row);
    row.querySelector('.placement-name').focus();
  });
  const posterInput = document.getElementById('posterInput');
  const posterLabel = document.getElementById('posterLabel');
  const resultMsg = document.getElementById('resultMsg');
  const posterPreview = document.getElementById('posterPreview');
  const posterDropBody = document.getElementById('posterDropBody');
  const posterDropTitle = document.getElementById('posterDropTitle');
  const posterDropHint = document.getElementById('posterDropHint');
  const resultGrid = document.getElementById('resultGrid');

  const eventOptions = document.getElementById('eventName');
  const placementOptions = document.getElementById('placementOptions');

  let resultPrograms = [];
  async function loadResultPrograms() {
    try {
      resultPrograms = await DB.getPrograms();
    } catch (err) {
      resultPrograms = [];
    }
    syncResultOptions();
  }

  function syncResultOptions() {
    const cat = categoryField.value;
    eventOptions.innerHTML =
      '<option value="">' + esc(cat ? 'Choose event…' : 'Choose category first…') + '</option>';
    resultPrograms
      .filter((p) => p.section === cat)
      .forEach((p) => {
        const off = p.stage === 'Off Stage';
        const opt = document.createElement('option');
        opt.value = p.name;
        opt.textContent = p.name + (off ? ' — Off Stage' : '');
        if (off) opt.dataset.stage = 'off';
        eventOptions.appendChild(opt);
      });
    placementOptions.innerHTML = students
      .filter((s) => s.category === cat)
      .map((s) => '<option value="' + esc(s.name) + '"></option>')
      .join('');
  }

  categoryField.addEventListener('change', syncResultOptions);

  posterInput.addEventListener('change', () => {
    const file = posterInput.files && posterInput.files[0];
    previewPoster(file);
  });

  posterLabel.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      posterInput.click();
    }
  });

  function previewPoster(file) {
    if (!file) {
      posterPreview.hidden = true;
      posterPreview.removeAttribute('src');
      posterDropBody.hidden = false;
      posterDropTitle.textContent = 'Click to upload';
      posterDropHint.textContent = 'Result poster · JPG or PNG';
      posterLabel.classList.remove('has-preview');
      return;
    }
    if (/^image\//.test(file.type)) {
      const reader = new FileReader();
      reader.onload = () => {
        posterPreview.src = reader.result;
        posterPreview.hidden = false;
        posterDropBody.hidden = true;
        posterLabel.classList.add('has-preview');
      };
      reader.readAsDataURL(file);
    } else {
      posterPreview.hidden = true;
      posterDropBody.hidden = false;
      posterDropTitle.textContent = 'Click to upload';
      posterDropHint.textContent = file.name;
    }
  }

  resultForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const file = posterInput.files && posterInput.files[0];
    if (!file) {
      resultMsg.textContent = 'Choose a poster image first.';
      resultMsg.classList.add('is-error');
      return;
    }
    const placements = Array.from(placementList.querySelectorAll('.placement-row'))
      .map((row) => ({
        rank: row.querySelector('.placement-rank').value || null,
        participant_name: (row.querySelector('.placement-name').value || '').trim(),
        points: parseInt(row.querySelector('.placement-points').value, 10) || 0,
        grade: row.querySelector('.placement-grade').value || null,
        coins: parseInt(row.querySelector('.placement-coins').value, 10) || 0,
      }))
      .filter((p) => p.participant_name);
    if (placements.length === 0) {
      resultMsg.textContent = 'Add at least one place.';
      resultMsg.classList.add('is-error');
      return;
    }
    try {
      await DB.addResults(
        eventName.value.trim(),
        categoryField.value.trim() || 'Minor',
        file,
        placements
      );
      resultMsg.textContent = 'Saved — it is live for students. Press Publish in the Teams tab to award points.';
      resultMsg.classList.remove('is-error');
      eventName.value = '';
      categoryField.value = 'Minor';
      resetPlacements();
      syncResultOptions();
      posterInput.value = '';
      previewPoster(null);
      resultOffset = 0;
      await loadResults();
    } catch (err) {
      resultMsg.textContent = 'Saving failed — try again.';
      resultMsg.classList.add('is-error');
    }
  });

  const RESULT_PAGE = 24;

  const resultSearch = document.getElementById('resultSearch');
  const resultCatFilter = document.getElementById('resultCatFilter');
  const resultCount = document.getElementById('resultCount');
  const resultPager = document.getElementById('resultPager');
  const resultLoadMore = document.getElementById('resultLoadMore');
  let resultTotal = 0;
  let resultOffset = 0;
  let resultSearchText = '';

  async function loadResults() {
    try {
      const page = await DB.getResultsPage({
        limit: RESULT_PAGE,
        offset: resultOffset,
        search: resultSearchText || undefined,
        category: resultCatFilter.value || undefined,
      });
      resultTotal = page.count;
      renderResults(page.data, resultOffset === 0);
    } catch (err) {
      UI.showError(resultGrid, 'Could not load results.', () => loadResults());
    }
  }

  function renderResults(results, isFirst) {
    if (isFirst) resultGrid.innerHTML = '';
    if (results.length === 0 && isFirst) {
      resultGrid.appendChild(
        UI.emptyState({
          title: resultSearchText || resultCatFilter.value ? 'No results matched' : 'No results yet',
          hint: resultSearchText || resultCatFilter.value
            ? 'Try a different search or category.'
            : 'Use the form above to add the first result poster.',
          icon: 'result',
        })
      );
    } else {
      results.forEach((r) => {
        const card = document.createElement('div');
        card.className = 'admin-poster';
        const status = r.published
          ? '<span class="admin-poster-status is-live">Live</span>'
          : '<span class="admin-poster-status is-pending">Pending</span>';
        card.innerHTML =
          '<div class="admin-poster-thumb">' +
          status +
          '<img src="' + esc(r.url) + '" alt="' + esc(r.event_name) + '" loading="lazy" />' +
          '<button type="button" class="admin-dl" title="Download poster" aria-label="Download poster: ' + esc(r.event_name) + '">' +
          '<svg viewBox="0 0 24 24" style="width:0.9rem;height:0.9rem" stroke="currentColor" stroke-width="1.8" fill="none"><path d="M12 4v11m0 0l-4-4m4 4l4-4M5 20h14"/></svg>' +
          '</button>' +
          '<button type="button" class="admin-del" title="Delete result" aria-label="Delete result: ' + esc(r.event_name) + '">' +
          '<svg viewBox="0 0 24 24" style="width:0.9rem;height:0.9rem" stroke="currentColor" stroke-width="1.8" fill="none"><path d="M6 6l12 12M18 6L6 18"/></svg>' +
          '</button>' +
          '</div>' +
          '<div class="admin-poster-meta">' +
          '<span class="admin-poster-title">' + esc(r.event_name) + '</span>' +
          '<span class="admin-poster-cat">' + esc(r.category || '') + (r.name ? ' · ' + esc(r.name) : '') + '</span>' +
          '</div>';
        card.querySelector('.admin-dl').addEventListener('click', () => {
          UI.saveImage(r.url, r.event_name + UI.extOf(r.url));
        });
        card.querySelector('.admin-del').addEventListener('click', async () => {
          if (!window.confirm('Delete the "' + r.event_name + '" result poster?')) return;
          try {
            await DB.deleteResult(r.id, r.url);
            resultOffset = 0;
            await loadResults();
          } catch (err) {
            window.alert('Could not remove the result.');
          }
        });
        resultGrid.appendChild(card);
      });
    }
    const shown = resultGrid.querySelectorAll('.admin-poster').length;
    const catLabel = resultCatFilter.value ? ' · ' + resultCatFilter.value + ' only' : '';
    resultCount.textContent =
      resultTotal === 0
        ? (resultSearchText || resultCatFilter.value ? 'No results matched' : 'No results yet')
        : 'Showing ' + shown + ' of ' + resultTotal + ' results' + catLabel;
    resultPager.classList.toggle('is-hidden', resultOffset + RESULT_PAGE >= resultTotal);
  }

  resultLoadMore.addEventListener('click', () => {
    resultOffset += RESULT_PAGE;
    loadResults();
  });

  let resultDebounce;
  resultSearch.addEventListener('input', () => {
    clearTimeout(resultDebounce);
    resultDebounce = setTimeout(() => {
      resultSearchText = resultSearch.value.trim();
      resultOffset = 0;
      loadResults();
    }, 300);
  });

  resultCatFilter.addEventListener('change', () => {
    resultOffset = 0;
    loadResults();
  });

  /* -------------------------------- teams -------------------------------- */

  const teamList = document.getElementById('teamList');
  const resultsCountEl = document.getElementById('resultsCount');
  const publishLimitEl = document.getElementById('publishLimit');
  const publishBtnEl = document.getElementById('publishBtn');

  let teams = [];

  async function loadResultsCounts() {
    try {
      const c = await DB.getResultsCounts();
      resultsCountEl.textContent =
        c.total === 0
          ? 'No results uploaded yet.'
          : c.published + ' of ' + c.total + ' results published (' + c.pending + ' pending).';
    } catch (err) {
      resultsCountEl.textContent = 'Could not load result counts.';
    }
  }

  async function loadTeams() {
    try {
      teams = await DB.getTeams();
      renderTeams();
    } catch (err) {
      UI.showError(teamList, 'Could not load teams.', () => loadTeams());
    }
  }

  function renderTeams() {
    teamList.innerHTML = '';
    if (teams.length === 0) {
      teamList.appendChild(
        UI.emptyState({
          title: 'No teams yet',
          hint: 'Add the competing teams to start the standings.',
          icon: 'points',
        })
      );
      return;
    }
    const sorted = teams.slice().sort((a, b) => b.points - a.points);
    sorted.forEach((team, i) => {
      const row = document.createElement('div');
      row.className = 'admin-team';
      row.innerHTML =
        '<span class="admin-rank">' + esc(i + 1) + '</span>' +
        '<span class="admin-team-name">' + esc(team.name) + '</span>' +
        '<span class="admin-team-pts">' + esc(team.points) + ' pts</span>' +
        '<span class="admin-team-actions">' +
        '  <button type="button" class="pill-btn is-danger" data-act="del" aria-label="Delete team">' +
        '    <svg viewBox="0 0 24 24" style="width:.9rem;height:.9rem" stroke="currentColor" stroke-width="1.8" fill="none"><path d="M7 4h10M3 6h18M8 6l1 13h6l1-13M10 10v5M14 10v5"/></svg>' +
        '  </button>' +
        '</span>';
      row.querySelector('[data-act="del"]').addEventListener('click', async () => {
        if (!window.confirm('Delete "' + team.name + '"?')) return;
        try {
          await DB.deleteTeam(team.id);
          await loadTeams();
        } catch (err) {
          window.alert('Could not delete the team.');
        }
      });
      teamList.appendChild(row);
    });
  }

  publishBtnEl.addEventListener('click', async () => {
    const limit = parseInt(publishLimitEl.value, 10) || 0;
    publishBtnEl.disabled = true;
    try {
      const res = await DB.awardResults(limit);
      teams = res.teams || teams;
      renderTeams();
      await loadResultsCounts();
      loadChamp();
      resultOffset = 0;
      await loadResults();
      if (res.awarded === 0) {
        window.alert('Nothing new to award — all entered results already have their points awarded.');
      } else {
        window.alert(res.awarded + ' result(s) awarded. Team + champion points updated.');
      }
    } catch (err) {
      window.alert('Publishing failed — try again.');
    } finally {
      publishBtnEl.disabled = false;
    }
  });

  /* --------------------- individual champions (champ) --------------------- */

  const champContent = document.getElementById('champContent');
  const champCatFilter = document.getElementById('champCatFilter');
  const CHAMP_CAT_ORDER = ['Minor', 'Premier', 'Sub junior', 'General'];
  let champStudents = [];
  let champAwards = new Map();
  let champAwardsLoaded = false;
  const champOpenNames = new Set();

  function champCleanName(raw) {
    return String(raw || '').replace(/\s+/g, ' ').trim().toLowerCase();
  }

  function champRankLabel(n) {
    return n === 1 ? '1st' : n === 2 ? '2nd' : n === 3 ? '3rd' : n + 'th';
  }

  function buildChampAwards(results) {
    champAwards = new Map();
    (results || []).forEach((r) => {
      const awarded =
        r.points_awarded === undefined ? r.published === true : r.points_awarded === true;
      if (!awarded || !r.places) return;
      (r.places || []).forEach((p) => {
        if (!p || !p.participant_name || !p.rank) return;
        const pts = r.points ? r.points[String(p.rank)] : 0;
        const key = champCleanName(p.participant_name);
        if (!champAwards.has(key)) champAwards.set(key, []);
        champAwards.get(key).push({
          event: r.event_name || '—',
          rank: p.rank,
          pts: Number(pts) || 0,
        });
      });
    });
    champAwards.forEach((list) => {
      list.sort(
        (a, b) => b.pts - a.pts || String(a.event).localeCompare(String(b.event))
      );
    });
  }

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

  function renderChamp() {
    champContent.innerHTML = '';
    const cat = champCatFilter ? champCatFilter.value : '';
    const topPerCat = cat ? 20 : 5;

    const groups = new Map();
    champStudents
      .filter((s) => (s.points || 0) > 0)
      .forEach((s) => {
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
      champContent.appendChild(
        UI.emptyState({
          title: 'No individual champions yet',
          hint: 'Individual champion points are awarded automatically when results are published.',
          icon: 'points',
        })
      );
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

      b.list.slice(0, topPerCat).forEach((s, i) => {
        const pos = i + 1;
        const lead = pos === 1;
        const nameKey = champCleanName(s.name);
        const detail = champAwards.get(nameKey) || [];
        const hasDetail = detail.length > 0 || !cat;
        const row = document.createElement('div');
        row.className = 'tp-tr' + (lead ? ' is-1' : '') + (hasDetail ? ' has-detail' : '');
        row.style.animationDelay = i * 60 + 'ms';
        if (hasDetail) row.setAttribute('role', 'button');
        if (hasDetail) row.tabIndex = 0;
        row.innerHTML =
          '<span class="tp-rank">' + (lead ? medalSvg('#a3e635') : esc(pos)) + '</span>' +
          '<span class="tp-team">' +
          '<span class="tp-name">' + esc(s.name) + '</span>' +
          (s.team ? '<span class="tp-crown-sm material-symbols-outlined" style="font-size:14px" title="' + esc(s.team) + '">group</span>' : '') +
          '</span>' +
          '<span class="tp-pts"><b>' + esc(s.category || '—') + '</b></span>' +
          '<span class="tp-pts champ-pts right"><b>' + esc(s.points) + '</b>' +
          (hasDetail
            ? '<span class="champ-toggle" aria-hidden="true">' +
              '<svg viewBox="0 0 24 24" style="width:1rem;height:1rem" stroke="currentColor" stroke-width="2" fill="none"><path d="M6 9l6 6 6-6"/></svg>' +
              '</span>'
            : '') +
          '</span>';
        tbl.appendChild(row);
        if (hasDetail) {
          const wrap = document.createElement('div');
          wrap.className = 'champ-detail';
          wrap.innerHTML = detail.length
            ? detail
                .map(
                  (d) =>
                    '<div class="champ-drow"><span class="champ-devent">' + esc(d.event) + '</span>' +
                    '<span class="champ-drank">' + esc(champRankLabel(d.rank)) + '</span>' +
                    '<span class="champ-dpts">' + esc(d.pts) + ' Pts</span></div>'
                )
                .join('')
            : '<div class="champ-drow"><span class="champ-devent">Individual points</span>' +
              '<span class="champ-drank">—</span>' +
              '<span class="champ-dpts">' + esc(s.points) + ' Pts</span></div>';
          wrap.addEventListener('click', (e) => e.stopPropagation());
          if (champOpenNames.has(nameKey)) {
            row.classList.add('is-open');
            row.setAttribute('aria-expanded', 'true');
          }
          row.addEventListener('click', () => toggle());
          row.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              toggle();
            }
          });
          function toggle() {
            const open = !row.classList.contains('is-open');
            row.classList.toggle('is-open', open);
            row.setAttribute('aria-expanded', String(open));
            if (open) champOpenNames.add(nameKey);
            else champOpenNames.delete(nameKey);
          }
          tbl.appendChild(wrap);
        }
      });
    });

    sec.appendChild(tbl);
    champContent.appendChild(sec);
  }

  if (champCatFilter) champCatFilter.addEventListener('change', renderChamp);

  async function loadChamp() {
    try {
      const [studentsList, results] = await Promise.all([DB.getStudents(), DB.getResults()]);
      champStudents = studentsList;
      buildChampAwards(results);
      champAwardsLoaded = true;
      renderChamp();
    } catch (err) {
      UI.showError(champContent, 'Could not load individual champions.', () => loadChamp());
    }
  }

  /* -------------------------- festivita: students -------------------------- */

  const studentList = document.getElementById('studentList');
  const studentOptions = document.getElementById('studentOptions');
  const qrPrintAll = document.getElementById('qrPrintAll');
  const studentCatFilter = document.getElementById('studentCatFilter');
  const studentSort = document.getElementById('studentSort');
  const studentCountEl = document.getElementById('studentCount');

  let students = [];

  function filteredStudents() {
    const cat = studentCatFilter ? studentCatFilter.value : '';
    const sortKey = studentSort ? studentSort.value : 'pts';
    const list = students.filter((s) => !cat || (s.category || '') === cat);
    const byName = (a, b) => String(a.name || '').localeCompare(String(b.name || ''));
    if (sortKey === 'team') {
      list.sort((a, b) => {
        const cmp = String(a.team || '').localeCompare(String(b.team || ''));
        return cmp !== 0 ? cmp : byName(a, b);
      });
    } else if (sortKey === 'name') {
      list.sort(byName);
    } else {
      list.sort((a, b) => (b.points || 0) - (a.points || 0) || (b.coins || 0) - (a.coins || 0) || byName(a, b));
    }
    if (studentCountEl) {
      studentCountEl.textContent = list.length + ' student' + (list.length === 1 ? '' : 's');
    }
    return list;
  }

  async function loadStudents() {
    try {
      students = await DB.getStudents();
      renderStudentOptions();
      syncResultOptions();
      renderStudents();
    } catch (err) {
      UI.showError(studentList, 'Could not load students.', () => loadStudents());
    }
  }

  function renderStudentOptions() {
    studentOptions.innerHTML = students
      .map((s) => '<option value="' + esc(s.name) + '"></option>')
      .join('');
  }

  function initials(name) {
    return String(name || '?')
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0].toUpperCase())
      .join('') || '?';
  }

  function renderStudents() {
    studentList.innerHTML = '';
    const list = filteredStudents();
    if (!list.length) {
      studentList.appendChild(
        UI.emptyState({
          title: 'No students to show',
          hint: 'Add students to the festivita roster and they will appear here.',
          icon: 'points',
        })
      );
      return;
    }
    list.forEach((s) => {
      const row = document.createElement('div');
      row.className = 'student-row';
      row.innerHTML =
        '<span class="student-avatar">' + esc(initials(s.name)) + '</span>' +
        '<span class="student-meta">' +
        '  <span class="student-name">' + esc(s.name) + '</span>' +
        '  <span class="student-team">' + esc([s.category, s.team].filter(Boolean).join(' · ') || 'No team') + '</span>' +
        '</span>' +
        '<span class="student-coins">' + esc(s.coins) + ' Coins</span>' +
        '<span class="student-pts">' + esc(s.points) + ' Pts</span>' +
        '<span class="student-actions">' +
        '  <button type="button" class="pill-btn" data-act="qr">QR</button>' +
        '  <button type="button" class="pill-btn" data-act="up" aria-label="Add 5 points">+5</button>' +
        '  <button type="button" class="pill-btn is-danger" data-act="del" aria-label="Remove student">' +
        '    <svg viewBox="0 0 24 24" style="width:.9rem;height:.9rem" stroke="currentColor" stroke-width="1.8" fill="none"><path d="M7 4h10M3 6h18M8 6l1 13h6l1-13M10 10v5M14 10v5"/></svg>' +
        '  </button>' +
        '</span>';

      row.querySelector('[data-act="qr"]').addEventListener('click', () => openQrModal(s));
      row.querySelector('[data-act="up"]').addEventListener('click', () => studentAdjust(s.id, 5));
      row.querySelector('[data-act="del"]').addEventListener('click', async () => {
        if (!window.confirm('Remove ' + s.name + ' and their wallet?')) return;
        try {
          await DB.deleteStudent(s.id);
          await loadStudents();
        } catch (err) {
          window.alert('Could not remove the student.');
        }
      });

      studentList.appendChild(row);
    });
  }

  if (studentCatFilter) studentCatFilter.addEventListener('change', renderStudents);
  if (studentSort) studentSort.addEventListener('change', renderStudents);

  async function studentAdjust(id, delta) {
    const s = students.find((x) => String(x.id) === String(id));
    if (!s) return;
    try {
      await DB.adjustCoins(id, delta, delta > 0 ? 'Manual add' : 'Manual deduct');
      await loadStudents();
    } catch (err) {
      window.alert('Could not update ' + s.name + '.');
    }
  }

  /* ----------------------------- festivita: QR ----------------------------- */

  function qrDataUrl(token) {
    const root = location.origin + location.pathname.slice(0, location.pathname.lastIndexOf('/') + 1);
    return root + 'points.html?code=' + encodeURIComponent(token);
  }

  function qrImgTag(token) {
    if (typeof window.qrcode !== 'function') {
      return '<p class="font-body-sm text-body-sm">QR library unavailable.</p>';
    }
    try {
      const qr = window.qrcode(0, 'M');
      qr.addData(qrDataUrl(token));
      qr.make();
      return qr.createImgTag(4, 8);
    } catch (e) {
      return '<p class="font-body-sm text-body-sm">Could not draw QR.</p>';
    }
  }

  function qrCard(s) {
    return (
      '<div class="qr-card">' +
      '<div class="qr-card-top"><span>Rendezvous \'26</span><span>Festivita Points</span></div>' +
      '<div class="qr-img">' + qrImgTag(s.qr_token) + '</div>' +
      '<div class="qr-card-name">' + esc(s.name) + '</div>' +
      '<div class="qr-card-line">' + esc(s.team || 'No team') + ' · ' + esc(s.qr_token) + '</div>' +
      '</div>'
    );
  }

  function printQrs(cardsHtml) {
    qrPrintAll.innerHTML = cardsHtml;
    qrPrintAll.setAttribute('aria-hidden', 'false');
    window.print();
    const cleanup = () => {
      qrPrintAll.innerHTML = '';
      qrPrintAll.setAttribute('aria-hidden', 'true');
      window.removeEventListener('afterprint', cleanup);
    };
    window.addEventListener('afterprint', cleanup, { once: true });
    setTimeout(cleanup, 5000);
  }

  const qrModal = document.createElement('div');
  qrModal.className = 'qr-modal';
  qrModal.innerHTML =
    '<div class="qr-modal-card">' +
    '  <button type="button" class="round-btn qr-close" aria-label="Close">' +
    '    <svg viewBox="0 0 24 24" style="width:1.25rem;height:1.25rem" stroke="currentColor" stroke-width="1.8" fill="none"><path d="M6 6l12 12M18 6L6 18"/></svg>' +
    '  </button>' +
    '  <p class="font-label-code text-label-code text-on-surface-variant uppercase tracking-widest mb-space-xs">Scan this with your phone</p>' +
    '  <div class="qr-body"></div>' +
    '  <p class="qr-token font-label-code text-label-code text-primary"></p>' +
    '  <button type="button" class="btn-lime qr-print-single" style="width:100%">Print QR</button>' +
    '</div>';

  let qrStudent = null;

  qrModal.querySelector('.qr-close').addEventListener('click', closeQrModal);
  qrModal.addEventListener('click', (e) => {
    if (e.target === qrModal) closeQrModal();
  });
  qrModal.querySelector('.qr-print-single').addEventListener('click', () => {
    if (qrStudent) printQrs(qrCard(qrStudent));
  });

  function openQrModal(s) {
    qrStudent = s;
    qrModal.querySelector('.qr-body').innerHTML = qrImgTag(s.qr_token);
    qrModal.querySelector('.qr-token').textContent = (s.qr_token || '') + ' · ' + s.name;
    document.body.appendChild(qrModal);
  }

  function closeQrModal() {
    if (qrModal.parentNode) qrModal.parentNode.removeChild(qrModal);
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeQrModal();
  });

  /* ----------------------------- festivita: awards -------------------------- */

  const awardForm = document.getElementById('awardForm');
  const awardStudent = document.getElementById('awardStudent');
  const awardCategoryNote = document.getElementById('awardCategoryNote');
  const awardEvent = document.getElementById('awardEvent');
  const awardRank = document.getElementById('awardRank');
  const awardAmount = document.getElementById('awardAmount');
  const awardMsg = document.getElementById('awardMsg');
  const awardLog = document.getElementById('awardLog');

  const RANK_POINTS = { 1: 25, 2: 15, 3: 10 };
  let awardPrograms = [];
  let lastAwardCategory = '';

  function sectionOfRosterNo(n) {
    if (n >= 4000) return 'General';
    if (n >= 3000) return 'Sub junior';
    if (n >= 2000) return 'Premier';
    if (n >= 1000) return 'Minor';
    return null;
  }

  async function loadAwardPrograms() {
    try {
      awardPrograms = await DB.getPrograms();
      syncAwardEvents();
    } catch (err) {
      awardPrograms = [];
    }
  }

  function awardStudentOf(raw) {
    const v = String(raw || '').replace(/\s+/g, ' ').trim();
    if (!v) return null;
    const exact = students.find((x) => String(x.name).toLowerCase() === v.toLowerCase());
    if (exact) return exact;
    const initials = v.toLowerCase();
    const matches = students.filter((x) => String(x.name).toLowerCase().startsWith(initials));
    if (matches.length === 1) return matches[0];
    return students.find((x) => String(x.name).toLowerCase().includes(initials));
  }

  function renderAwardEventOptions(category) {
    const opts = awardPrograms.filter((p) => p.section === category);
    const html = ['<option value="">' + esc(category ? 'Choose event…' : 'Choose a student first…') + '</option>'];
    opts.forEach((p) => {
      html.push(
        '<option value="' + esc(p.name) + (p.stage === 'Off Stage' ? '" data-stage="off"' : '"') + '>' +
        esc(p.name) + (p.stage === 'Off Stage' ? ' — Off Stage' : '') +
        '</option>'
      );
    });
    awardEvent.innerHTML = html.join('');
  }

  function syncAwardEvents() {
    const s = awardStudentOf(awardStudent.value);
    const cat = s ? s.category || sectionOfRosterNo(s.roster_no) || '' : '';
    if (!s) {
      awardCategoryNote.textContent = awardStudent.value.trim() ? 'No matching student' : '';
    } else {
      awardCategoryNote.textContent = cat ? s.name + ' · ' + cat : s.name + ' · no category set';
    }
    if (cat !== lastAwardCategory) {
      lastAwardCategory = cat;
      awardEvent.value = '';
      renderAwardEventOptions(cat || null);
    }
  }

  awardStudent.addEventListener('input', syncAwardEvents);
  awardStudent.addEventListener('change', syncAwardEvents);

  awardRank.addEventListener('change', () => {
    const pts = RANK_POINTS[awardRank.value];
    if (pts) awardAmount.value = pts;
  });

  function awardNote(msg, isError) {
    awardMsg.textContent = msg || '';
    awardMsg.classList.toggle('is-error', Boolean(isError));
  }

  function ordinal(n) {
    n = Number(n);
    if (n === 1) return 'st';
    if (n === 2) return 'nd';
    if (n === 3) return 'rd';
    return 'th';
  }

  awardForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = awardStudent.value.trim();
    const amount = Math.floor(Number(awardAmount.value));
    if (!name) {
      awardNote('Pick a student first.', true);
      return;
    }
    if (!amount || amount < 1) {
      awardNote('Enter a point value.', true);
      return;
    }
    if (!students.length) {
      awardNote('Import the roster first.', true);
      return;
    }
    const s = students.find((x) => String(x.name).toLowerCase() === name.toLowerCase());
    if (!s) {
      awardNote('No student with that exact name.', true);
      return;
    }
    try {
      const rank = awardRank.value;
      const reason =
        'Award · ' +
        (rank ? rank + ordinal(rank) + ' · ' : '') +
        (awardEvent.value.trim() || 'Event');
      await DB.awardCoins(s.id, amount, reason);
      awardNote('Credited ' + amount + ' Coins to ' + s.name + '.');
      loadStudents();
      loadAwardLog();
      awardStudent.value = '';
      awardEvent.value = '';
      awardRank.value = '1';
      awardAmount.value = '25';
      syncAwardEvents();
    } catch (err) {
      awardNote('Could not credit points.', true);
    }
  });

  function studentName(id) {
    const s = students.find((x) => String(x.id) === String(id));
    return s ? s.name : 'Student #' + id;
  }

  async function loadAwardLog() {
    try {
      const rows = await DB.getLedgerAll();
      const recent = rows.slice(0, 10);
      awardLog.innerHTML = '';
      if (!recent.length) {
        awardLog.appendChild(
          UI.emptyState({
            title: 'No activity yet',
            hint: 'Awards and counter purchases will appear here.',
            icon: 'points',
          })
        );
        return;
      }
      recent.forEach((r) => {
        const ch = (CHANNEL_TAGS[channelOf(r)] || CHANNEL_TAGS.store);
        const li = document.createElement('li');
        li.className = 'ledger-row';
        li.innerHTML =
          '<span class="ledger-delta ' + (Number(r.delta) >= 0 ? 'is-add' : 'is-sub') + '">' +
          (Number(r.delta) >= 0 ? '+' : '−') +
          Math.abs(r.delta) +
          '</span>' +
          '<span class="ledger-reason">' + esc(studentName(r.student_id)) + ' · ' + esc(r.reason || 'Festivita point') +
          ' <span class="ledger-tag ' + ch.cls + '">' + ch.label + '</span></span>' +
          '<span class="ledger-date">' + esc(ledgerDate(r)) + '</span>';
        awardLog.appendChild(li);
      });
    } catch (err) {
      awardLog.innerHTML = '';
    }
  }

  function ledgerDate(r) {
    const d = new Date(r.created_at || Date.now());
    return isNaN(d) ? '' : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  }

  function startStudentPoll() {
    if (window.RV26._studentPollActive) return;
    window.RV26._studentPollActive = true;
    DB.subscribeStudents(async (list) => {
      students = list;
      renderStudentOptions();
      renderStudents();
      loadAwardLog();
      champStudents = list;
      if (!champAwardsLoaded) loadChamp();
      else renderChamp();
    });
  }

  /* ------------------------------ schedule ------------------------------ */

  const scheduleForm = document.getElementById('scheduleForm');
  const schedSection = document.getElementById('schedSection');
  const schedProgram = document.getElementById('schedProgram');
  const schedDay = document.getElementById('schedDay');
  const schedTime = document.getElementById('schedTime');
  const schedSubmit = document.getElementById('schedSubmit');
  const schedSubmitLabel = document.getElementById('schedSubmitLabel');
  const schedSubmitIcon = document.getElementById('schedSubmitIcon');
  const schedCancel = document.getElementById('schedCancel');
  const scheduleMsg = document.getElementById('scheduleMsg');
  const schedList = document.getElementById('schedList');

  const SECTION_ORDER = ['Minor', 'Premier', 'Sub junior', 'General'];

  let scheduleRows = [];
  let editingScheduleId = null;
  let dragId = null;
  let dragRow = null;

  function onStagePrograms(section) {
    const sec = PROGRAMS.section(section);
    const stage = sec && sec.stages.find((s) => s.stage === 'On Stage');
    if (!stage) return [];
    return stage.items.map((it) => (typeof it === 'string' ? it : it.name));
  }

  function populateProgramSelect() {
    if (!schedProgram) return;
    const list = document.getElementById('schedProgramOptions');
    if (list) list.innerHTML = '';
    const opts = onStagePrograms(schedSection.value);
    opts.forEach((name) => {
      const o = document.createElement('option');
      o.value = name;
      o.textContent = name;
      if (list) list.appendChild(o);
    });
  }

  async function loadSchedule() {
    if (!schedList || !DB.isSupabaseConfigured()) return;
    try {
      scheduleRows = await DB.getSchedule();
    } catch (e) {
      scheduleMsg.textContent = 'Could not load schedule.';
      return;
    }
    renderSchedule();
  }

  function renderSchedule() {
    schedList.innerHTML = '';
    SECTION_ORDER.forEach((section, idx) => {
      const items = scheduleRows.filter((r) => r.section === section);
      const head = document.createElement('div');
      head.className = 'flex items-baseline gap-space-sm mb-space-xs';
      head.innerHTML =
        '<span class="font-heading text-title-md font-bold text-on-surface">' +
        section +
        '</span>' +
        '<span class="font-label-code text-label-code uppercase tracking-widest text-on-surface-variant">On Stage</span>';
      schedList.appendChild(head);

      const ul = document.createElement('ul');
      ul.className = 'space-y-space-xs';
      if (items.length === 0) {
        const li = document.createElement('li');
        li.className = 'font-body-sm text-body-sm text-on-surface-variant';
        li.textContent = 'Nothing scheduled for this section yet.';
        ul.appendChild(li);
      } else {
        items.forEach((r) => ul.appendChild(scheduleRow(r, section)));
        ul.addEventListener('dragover', onScheduleDragOver);
        ul.addEventListener('drop', onScheduleDrop);
      }
      schedList.appendChild(ul);
    });
  }

  function onScheduleDragOver(e) {
    if (dragRow === null) return;
    const ul = e.currentTarget;
    if (!ul.contains(dragRow)) return;
    e.preventDefault();
    if (!e.dataTransfer) e.dataTransfer = { dropEffect: 'move' };
    const others = Array.from(ul.querySelectorAll('li')).filter(
      (li) => li !== dragRow
    );
    const after = others.find((li) => {
      const rect = li.getBoundingClientRect();
      return e.clientY < rect.top + rect.height / 2;
    });
    if (after) ul.insertBefore(dragRow, after);
    else ul.appendChild(dragRow);
  }

  async function onScheduleDrop(e) {
    const ul = e.currentTarget;
    if (dragRow === null || !ul.contains(dragRow)) return;
    e.preventDefault();
    const section = dragRow.dataset.section;
    const ids = Array.from(ul.querySelectorAll('li')).map((li) => li.dataset.id);
    dragRow.classList.remove('opacity-40');
    dragId = null;
    dragRow = null;
    await persistScheduleOrder(section, ids);
  }

  const SLOT_TIMES = {
    Minor: ['09:00', '09:45', '10:30', '11:15', '12:00', '12:45', '13:30'],
    Premier: ['14:00', '14:45', '15:30', '16:15', '17:00', '17:45', '18:30'],
    'Sub junior': ['09:00', '09:45', '10:30', '11:15', '12:00', '12:45', '13:30'],
    General: ['14:00', '14:45', '15:30', '16:15', '17:00'],
  };
  function slotTime(section, position) {
    const slot = SLOT_TIMES[section];
    return slot && slot[position - 1] ? slot[position - 1] : '';
  }

  async function persistScheduleOrder(section, ids) {
    const rowsById = {};
    scheduleRows.forEach((r) => {
      rowsById[r.id] = r;
    });
    const retry = async (fn, tries) => {
      for (let i = 0; i < tries; i++) {
        try {
          return await fn();
        } catch (err) {
          if (i === tries - 1) throw err;
          await new Promise((res) => setTimeout(res, 500));
        }
      }
    };
    try {
      for (let i = 0; i < ids.length; i++) {
        const row = rowsById[Number(ids[i])];
        if (!row) continue;
        if (row.position !== i + 1) {
          await retry(
            () =>
              DB.updateScheduleEntry(row.id, {
                section: row.section,
                title: row.title,
                day: row.day,
                time: slotTime(row.section, i + 1) || row.time,
                location: row.location,
                tag: row.tag,
                position: i + 1,
              }),
            3
          );
        }
      }
      scheduleMsg.textContent = 'Order saved.';
      await loadSchedule();
    } catch (err) {
      scheduleMsg.textContent = 'Reorder failed — try again.';
      await loadSchedule();
    }
  }

  function scheduleRow(r, section) {
    const li = document.createElement('li');
    li.className =
      'flex items-start gap-space-md bg-surface-container-low border border-white/5 rounded-lg px-space-md py-space-sm';
    li.dataset.id = r.id;
    li.dataset.section = section;
    li.draggable = true;

    const grip = document.createElement('span');
    grip.className =
      'grip-handle flex-none self-center cursor-grab text-on-surface-variant hover:text-primary flex items-center justify-center active:cursor-grabbing select-none';
    grip.innerHTML = '<span class="material-symbols-outlined text-[18px]">drag_indicator</span>';
    grip.setAttribute('aria-label', 'Drag to reorder');
    li.appendChild(grip);

    li.addEventListener('dragstart', (e) => {
      dragId = r.id;
      dragRow = li;
      li.classList.add('opacity-40');
      try {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', String(r.id));
      } catch (err) {}
    });
    li.addEventListener('dragend', () => {
      dragId = null;
      dragRow = null;
      li.classList.remove('opacity-40');
    });

    const day = document.createElement('span');
    day.className =
      'flex-none w-[4.5rem] font-label-code text-label-code text-primary pt-0.5';
    day.textContent = 'Day 0' + (r.day || 1) + ' · ' + (r.time || 'TBA');
    li.appendChild(day);

    const body = document.createElement('div');
    body.className = 'min-w-0 flex-1';
    const title = document.createElement('p');
    title.className = 'font-title-md text-body-sm font-semibold text-on-surface';
    title.textContent = r.title;
    body.appendChild(title);
    li.appendChild(body);

    const actions = document.createElement('div');
    actions.className = 'flex flex-none items-center gap-space-2xs self-center';

    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className =
      'h-9 px-space-md rounded-lg bg-surface-container-high text-on-surface hover:text-primary font-title-md text-body-sm transition-colors inline-flex items-center gap-space-2xs';
    editBtn.innerHTML =
      '<span class="material-symbols-outlined text-[15px]">edit</span>Edit';
    editBtn.addEventListener('click', () => editSchedule(r));
    actions.appendChild(editBtn);

    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className =
      'w-9 h-9 rounded-lg bg-surface-container-high text-on-surface hover:text-error font-title-md text-body-sm transition-colors inline-flex items-center justify-center';
    delBtn.innerHTML = '<span class="material-symbols-outlined text-[15px]">delete</span>';
    delBtn.setAttribute('aria-label', 'Delete entry');
    delBtn.addEventListener('click', () => deleteScheduleEntry(r.id));
    actions.appendChild(delBtn);

    li.appendChild(actions);
    return li;
  }

  function scheduleFormValues() {
    return {
      section: schedSection.value,
      title: schedProgram.value.trim(),
      day: Number(schedDay.value),
      time: schedTime.value,
    };
  }

  function nextPositionInSection(section) {
    const items = scheduleRows.filter((r) => r.section === section);
    return items.length === 0 ? 1 : 1 + Math.max(...items.map((r) => r.position));
  }

  function editSchedule(r) {
    editingScheduleId = r.id;
    if (SECTION_ORDER.includes(r.section)) schedSection.value = r.section;
    populateProgramSelect();
    schedProgram.value = r.title;
    schedDay.value = String(r.day || 1);
    schedTime.value = r.time || '';
    schedSubmitLabel.textContent = 'Save Changes';
    schedSubmitIcon.textContent = 'save';
    schedCancel.classList.remove('is-hidden');
    scheduleMsg.textContent = 'Editing "' + r.title + '".';
  }

  function cancelScheduleEdit() {
    editingScheduleId = null;
    scheduleForm.reset();
    if (schedDay) schedDay.value = '1';
    populateProgramSelect();
    schedSubmitLabel.textContent = 'Add Entry';
    schedSubmitIcon.textContent = 'add';
    schedCancel.classList.add('is-hidden');
    scheduleMsg.textContent = '';
  }

  if (schedSection) {
    schedSection.addEventListener('change', populateProgramSelect);
  }

  scheduleForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const v = scheduleFormValues();
    if (!v.title) return;
    try {
      if (editingScheduleId) {
        const row = scheduleRows.find((r) => r.id === editingScheduleId);
        await DB.updateScheduleEntry(editingScheduleId, {
          ...v,
          position: row ? row.position : 1,
        });
        scheduleMsg.textContent = 'Entry updated.';
      } else {
        const dup = scheduleRows.find(
          (r) => r.section === v.section && r.title === v.title
        );
        if (dup) {
          scheduleMsg.textContent = 'That programme is already on the schedule.';
          return;
        }
        await DB.addScheduleEntry({ ...v, position: nextPositionInSection(v.section) });
        scheduleMsg.textContent = 'Entry added.';
      }
      cancelScheduleEdit();
      await loadSchedule();
    } catch (err) {
      scheduleMsg.textContent = 'Save failed — try again.';
    }
  });

  if (schedCancel) {
    schedCancel.addEventListener('click', cancelScheduleEdit);
  }

  async function deleteScheduleEntry(id) {
    const row = scheduleRows.find((r) => r.id === id);
    if (!row) return;
    if (!confirm('Remove "' + row.title + '" from the schedule?')) return;
    try {
      await DB.deleteScheduleEntry(id);
      scheduleMsg.textContent = 'Entry removed.';
      await loadSchedule();
    } catch (err) {
      scheduleMsg.textContent = 'Delete failed — try again.';
    }
  }

  /* --------------------------- store counter role ------------------------- */

  const tabsBar = document.querySelector('.tabs');
  const storePanel = document.getElementById('panel-store');
  const scQ = document.getElementById('scQ');
  const scFind = document.getElementById('scFind');
  const scErr = document.getElementById('scErr');
  const scCard = document.getElementById('scCard');
  const scAvatar = document.getElementById('scAvatar');
  const scNameOut = document.getElementById('scNameOut');
  const scTeam = document.getElementById('scTeam');
  const scBalance = document.getElementById('scBalance');
  const scAmount = document.getElementById('scAmount');
  const scReason = document.getElementById('scReason');
  const scCharge = document.getElementById('scCharge');
  const scMsg = document.getElementById('scMsg');
  const scCount = document.getElementById('scCount');
  const scLedger = document.getElementById('scLedger');
  const scLedgerTitle = document.getElementById('scLedgerTitle');
  const scSummary = document.getElementById('scSummary');
  const scKind = document.getElementById('scKind');
  const scKindBook = document.getElementById('scKindBook');
  const scKindStore = document.getElementById('scKindStore');

  let scStudent = null;
  let storeLedgerRows = [];

  async function storeBoot() {
    if (tabsBar) tabsBar.classList.add('is-hidden');
    panels.forEach((p) => p.classList.add('is-hidden'));
    storePanel.classList.remove('is-hidden');
    scQ.focus();
    try {
      await loadStudents();
    } catch (e) {
      /* students list is best-effort for ledger name resolution */
    }
    loadStoreLedger();
  }

  function scErrOn(msg) {
    scErr.textContent = msg || '';
    scErr.classList.toggle('hidden', !msg);
  }

  function scMsgOn(msg, isError) {
    scMsg.textContent = msg || '';
    scMsg.classList.toggle('is-error', Boolean(isError));
    scMsg.classList.toggle('hidden', !msg);
  }

  function setScKind(kind) {
    scKind.value = kind === 'store' ? 'store' : 'book';
    scKindBook.classList.toggle('is-active', scKind.value === 'book');
    scKindStore.classList.toggle('is-active', scKind.value === 'store');
  }

  scKindBook.addEventListener('click', () => setScKind('book'));
  scKindStore.addEventListener('click', () => setScKind('store'));
  if (scKind.value) setScKind(scKind.value);

  function showScStudent(s) {
    scStudent = s;
    scAvatar.textContent = initials(s.name);
    scNameOut.textContent = s.name;
    scTeam.textContent = s.team || 'No team';
    scTeam.style.display = s.team ? '' : 'none';
    scBalance.textContent = s.coins;
    scCard.classList.remove('hidden');
    scAmount.value = '';
    scReason.value = '';
    scMsgOn('');
    renderStoreLedgerFor(s);
  }

  async function findSc() {
    scErrOn('');
    const raw = (scQ.value || '').replace(/[·•]/g, '.').trim();
    if (!raw) return;
    let s = null;
    if (/^\d+$/.test(raw) || /^FESTI-/i.test(raw)) {
      s = await DB.getStudentByToken(raw).catch(() => null);
    }
    if (!s) {
      try {
        s = await DB.getStudentByName(raw);
      } catch (e) {
        s = null;
      }
    }
    if (s) showScStudent(s);
    else scErrOn('No wallet found for that code or name.');
  }

  scFind.addEventListener('click', findSc);
  scQ.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') findSc();
  });

  scCharge.addEventListener('click', async () => {
    const amt = Math.floor(Number(scAmount.value));
    const reason = scReason.value.trim();
    scMsgOn('');
    if (!scStudent) {
      scMsgOn('Find a wallet first.', true);
      return;
    }
    if (!amt || amt < 1) {
      scMsgOn('Enter an amount to charge.', true);
      return;
    }
    scCharge.disabled = true;
    try {
      const kind = scKind.value === 'store' ? 'store' : 'book';
      const updated = await DB.deductForStore(scStudent.id, amt, reason, kind);
      scBalance.textContent = updated.coins;
      scMsgOn(
        'Charged ' + amt + ' Coins · ' + (kind === 'book' ? 'Book' : 'Store') +
          ' — new balance ' + updated.coins + '.'
      );
      scAmount.value = '';
      scReason.value = '';
      loadStoreLedger();
    } catch (e) {
      if (e && e.code === 'INSUFFICIENT') {
        scMsgOn('Not enough coins — balance is ' + e.balance + '.', true);
      } else {
        scMsgOn('Could not record the purchase. Try again.', true);
      }
    } finally {
      scCharge.disabled = false;
    }
  });

  async function loadStoreLedger() {
    try {
      const all = await DB.getLedgerAll();
      storeLedgerRows = all.filter(
        (r) => (r.channel || 'store') === 'book' || (r.channel || 'store') === 'store'
      );
    } catch (e) {
      storeLedgerRows = [];
    }
    renderStoreLedgerFor(scStudent);
  }

  const CHANNEL_TAGS = {
    book: { label: 'Book', cls: 'is-book' },
    store: { label: 'Store', cls: 'is-store' },
    award: { label: 'Award', cls: 'is-award' },
    adjust: { label: 'Adjust', cls: 'is-adjust' },
  };

  function channelOf(r) {
    return r && r.channel ? r.channel : 'store';
  }

  function renderStoreLedgerFor(s) {
    scLedgerTitle.textContent = s ? 'Activity · ' + s.name : 'All activity';
    const rows = s
      ? storeLedgerRows.filter((r) => String(r.student_id) === String(s.id))
      : storeLedgerRows;
    renderStoreLedger(rows);
  }

  function renderStoreLedger(rows) {
    scCount.textContent = rows && rows.length ? rows.length + (rows.length === 1 ? ' entry' : ' entries') : '';
    let bookN = 0;
    let storeN = 0;
    (rows || []).forEach((r) => {
      if (channelOf(r) === 'book') bookN += 1;
      else storeN += 1;
    });
    if (rows && rows.length) {
      scSummary.innerHTML =
        (storeN ? '<span class="is-store">Store ' + storeN + '</span>' : '') +
        (bookN ? '<span class="is-book">Book ' + bookN + '</span>' : '');
    } else {
      scSummary.innerHTML = '';
    }
    scLedger.innerHTML = '';
    if (!rows || !rows.length) {
      scLedger.appendChild(
        UI.emptyState({
          title: 'No activity yet',
          hint: 'Store items and book purchases will appear here.',
          icon: 'points',
        })
      );
      return;
    }
    rows.forEach((r) => {
      const ch = CHANNEL_TAGS[channelOf(r)] || CHANNEL_TAGS.store;
      const li = document.createElement('li');
      li.className = 'ledger-row';
      li.innerHTML =
        '<span class="ledger-delta ' + (Number(r.delta) >= 0 ? 'is-add' : 'is-sub') + '">' +
        (Number(r.delta) >= 0 ? '+' : '−') +
        Math.abs(r.delta) +
        '</span>' +
        '<span class="ledger-reason">' + esc(studentName(r.student_id)) + ' · ' + esc(r.reason || 'Festivita point') +
        ' <span class="ledger-tag ' + ch.cls + '">' + ch.label + '</span></span>' +
        '<span class="ledger-date">' + esc(ledgerDate(r)) + '</span>';
      scLedger.appendChild(li);
    });
  }

  let role = null;
  try {
    role = sessionStorage.getItem(SESSION_KEY);
  } catch (e) {
    role = null;
  }
  if (role === 'admin' || role === 'store' || role === 'bookstall') boot(role);
  else gateReveal();
})();