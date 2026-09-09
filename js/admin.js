/*
 * Rendezvous '26 — Admin panel
 * Access-gated control panel for publishing results, uploading photos and
 * managing team points on top of the shared DB layer.
 */
(function () {
  const C = window.RV26.CONFIG;
  const DB = window.RV26.DB;
  const UI = window.RV26.UI;
  const esc = UI.escapeHtml;

  const SESSION_KEY = 'rv26_admin';

  const gate = document.getElementById('gate');
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
    if (pw === C.ADMIN_PASSWORD && pw !== '') {
      gateErr.textContent = '';
      gatePw.value = '';
      sessionStorage.setItem(SESSION_KEY, '1');
      boot();
    } else {
      gateErr.textContent = 'Incorrect access code. Try again.';
      gatePw.select();
    }
  }

  function gateReveal() {
    gate.classList.remove('is-hidden');
    dash.classList.add('is-hidden');
  }

  function boot() {
    gate.classList.add('is-hidden');
    dash.classList.remove('is-hidden');
    document.title = 'Admin — Rendezvous \'26';
    const live = DB.isSupabaseConfigured();
    setupBanner.classList.toggle('is-hidden', live);
    setupMsg.textContent = live ? 'Live data mode' : 'Supabase not configured';
    setupMsg2.textContent = live
      ? 'writing to your Supabase project'
      : 'add SUPABASE_URL + SUPABASE_ANON_KEY to js/config.js';
    initTabs();
    loadPhotos();
    loadResults();
    loadTeams();
    loadStudents();
    loadAwardLog();
    startStudentPoll();
  }

  function logout() {
    sessionStorage.removeItem(SESSION_KEY);
    window.location.reload();
  }

  gateForm.addEventListener('submit', (e) => {
    e.preventDefault();
    attempt(gatePw.value.trim());
  });

  if (sessionStorage.getItem(SESSION_KEY) === '1') boot();
  else gateReveal();

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

  const photoGrid = document.getElementById('photoGrid');
  const photoInput = document.getElementById('photoInput');
  const photoCaption = document.getElementById('photoCaption');

  async function loadPhotos() {
    try {
      const gallery = await DB.getGallery();
      renderPhotos(gallery);
    } catch (err) {
      UI.showError(photoGrid, 'Could not load photos.', () => loadPhotos());
    }
  }

  function renderPhotos(gallery) {
    photoGrid.innerHTML = '';
    if (gallery.length === 0) {
      photoGrid.appendChild(
        UI.emptyState({
          title: 'No photos uploaded',
          hint: 'Use the button above to add photos from the festival floor.',
          icon: 'photo',
        })
      );
      return;
    }
    gallery.forEach((p) => {
      const card = document.createElement('div');
      card.className = 'admin-item';
      card.innerHTML =
        '<img src="' + esc(p.url) + '" alt="' + esc(p.caption || 'Festival photo') + '" loading="lazy" />' +
        (p.caption ? '<span class="admin-item-cap">' + esc(p.caption) + '</span>' : '') +
        '<button type="button" class="admin-del" aria-label="Delete photo">' +
        '<svg viewBox="0 0 24 24" style="width:1rem;height:1rem" stroke="currentColor" stroke-width="1.8" fill="none"><path d="M6 6l12 12M18 6L6 18"/></svg>' +
        '</button>';
      card.querySelector('.admin-del').addEventListener('click', async () => {
        if (!window.confirm('Delete this photo?')) return;
        try {
          await DB.deletePhoto(p.id);
          await loadPhotos();
        } catch (err) {
          window.alert('Could not delete the photo.');
        }
      });
      photoGrid.appendChild(card);
    });
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
    await loadPhotos();
  });

  /* ------------------------------- results ------------------------------- */

  const resultForm = document.getElementById('resultForm');
  const eventName = document.getElementById('eventName');
  const categoryField = document.getElementById('category');
  const participantName = document.getElementById('participantName');
  const rankField = document.getElementById('rank');
  const posterInput = document.getElementById('posterInput');
  const posterLabel = document.getElementById('posterLabel');
  const resultMsg = document.getElementById('resultMsg');
  const resultGrid = document.getElementById('resultGrid');

  posterInput.addEventListener('change', () => {
    posterLabel.textContent = posterInput.files && posterInput.files[0]
      ? posterInput.files[0].name
      : 'Choose an image…';
  });

  resultForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const file = posterInput.files && posterInput.files[0];
    if (!file) {
      resultMsg.textContent = 'Choose a poster image first.';
      resultMsg.classList.add('is-error');
      return;
    }
    try {
      await DB.addResult(
        eventName.value.trim(),
        categoryField.value.trim(),
        file,
        participantName.value.trim(),
        rankField.value || null
      );
      resultMsg.textContent = 'Result published. It is now live.';
      resultMsg.classList.remove('is-error');
      eventName.value = '';
      categoryField.value = '';
      participantName.value = '';
      rankField.value = '';
      posterInput.value = '';
      posterLabel.textContent = 'Choose an image…';
      await loadResults();
    } catch (err) {
      resultMsg.textContent = 'Publishing failed — try again.';
      resultMsg.classList.add('is-error');
    }
  });

  async function loadResults() {
    try {
      const results = await DB.getResults();
      renderResults(results);
    } catch (err) {
      UI.showError(resultGrid, 'Could not load published results.', () => loadResults());
    }
  }

  function renderResults(results) {
    resultGrid.innerHTML = '';
    if (results.length === 0) {
      resultGrid.appendChild(
        UI.emptyState({
          title: 'Nothing published yet',
          hint: 'Use the form above to publish the first result poster.',
          icon: 'result',
        })
      );
      return;
    }
    results.forEach((r) => {
      const card = document.createElement('div');
      card.className = 'admin-item';
      card.innerHTML =
        '<img src="' + esc(r.url) + '" alt="' + esc(r.event_name) + '" loading="lazy" />' +
        '<span class="admin-item-cap">' +
          esc(r.event_name) + ' · ' + esc(r.category || '') +
          (r.name ? ' · ' + esc(r.name) : '') + '</span>' +
        '<button type="button" class="admin-del" aria-label="Remove result">' +
        '<svg viewBox="0 0 24 24" style="width:1rem;height:1rem" stroke="currentColor" stroke-width="1.8" fill="none"><path d="M6 6l12 12M18 6L6 18"/></svg>' +
        '</button>';
      card.querySelector('.admin-del').addEventListener('click', async () => {
        if (!window.confirm('Remove this result poster?')) return;
        try {
          await DB.deleteResult(r.id, r.url);
          await loadResults();
        } catch (err) {
          window.alert('Could not remove the result.');
        }
      });
      resultGrid.appendChild(card);
    });
  }

  /* -------------------------------- teams -------------------------------- */

  const teamForm = document.getElementById('teamForm');
  const teamNameField = document.getElementById('teamName');
  const teamList = document.getElementById('teamList');

  let teams = [];

  teamForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = teamNameField.value.trim();
    if (!name) return;
    try {
      await DB.addTeam(name);
      teamNameField.value = '';
      await loadTeams();
    } catch (err) {
      window.alert('Could not add the team.');
    }
  });

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
    teams.forEach((team, i) => {
      const row = document.createElement('div');
      row.className = 'admin-team';
      row.innerHTML =
        '<span class="admin-rank">' + esc(i + 1) + '</span>' +
        '<span class="admin-team-name">' + esc(team.name) + '</span>' +
        '<span class="admin-team-pts">' + esc(team.points) + ' pts</span>' +
        '<span class="admin-team-actions">' +
        '  <button type="button" class="pill-btn" data-act="up">+5</button>' +
        '  <button type="button" class="pill-btn" data-act="down">-5</button>' +
        '  <button type="button" class="pill-btn is-danger" data-act="del" aria-label="Delete team">' +
        '    <svg viewBox="0 0 24 24" style="width:.9rem;height:.9rem" stroke="currentColor" stroke-width="1.8" fill="none"><path d="M7 4h10M3 6h18M8 6l1 13h6l1-13M10 10v5M14 10v5"/></svg>' +
        '  </button>' +
        '</span>';

      row.querySelector('[data-act="up"]').addEventListener('click', () => adjust(team.id, 5));
      row.querySelector('[data-act="down"]').addEventListener('click', () => adjust(team.id, -5));
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

  async function adjust(id, delta) {
    const team = teams.find((t) => t.id === id);
    if (!team) return;
    try {
      await DB.setTeamPoints(id, Math.max(0, team.points + delta));
      await loadTeams();
    } catch (err) {
      window.alert('Could not update the points.');
    }
  }

  /* -------------------------- festivita: students -------------------------- */

  const bulkForm = document.getElementById('bulkForm');
  const studentBulk = document.getElementById('studentBulk');
  const studentTeam = document.getElementById('studentTeam');
  const bulkMsg = document.getElementById('bulkMsg');
  const studentList = document.getElementById('studentList');
  const studentOptions = document.getElementById('studentOptions');
  const printAllQrs = document.getElementById('printAllQrs');
  const qrPrintAll = document.getElementById('qrPrintAll');

  let students = [];

  function bulkNote(msg, isError) {
    bulkMsg.textContent = msg || '';
    bulkMsg.classList.toggle('is-error', Boolean(isError));
  }

  bulkForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const names = (studentBulk.value || '').split('\n');
    if (names.filter((n) => n.trim()).length === 0) return;
    try {
      const count = await DB.addStudentsBulk(names, studentTeam.value);
      bulkNote('Added ' + count + ' student' + (count === 1 ? '' : 's') + '.');
      studentBulk.value = '';
      await loadStudents();
    } catch (err) {
      bulkNote('Import failed — try again.', true);
    }
  });

  async function loadStudents() {
    try {
      students = await DB.getStudents();
      renderStudentOptions();
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
    if (!students.length) {
      studentList.appendChild(
        UI.emptyState({
          title: 'No students imported',
          hint: 'Paste the roster above to generate every QR code.',
          icon: 'points',
        })
      );
      return;
    }
    students.forEach((s) => {
      const row = document.createElement('div');
      row.className = 'student-row';
      row.innerHTML =
        '<span class="student-avatar">' + esc(initials(s.name)) + '</span>' +
        '<span class="student-meta">' +
        '  <span class="student-name">' + esc(s.name) + '</span>' +
        '  <span class="student-team">' + esc(s.team || 'No team') + '</span>' +
        '</span>' +
        '<span class="student-pts">' + esc(s.points) + ' GLP</span>' +
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

  async function studentAdjust(id, delta) {
    const s = students.find((x) => String(x.id) === String(id));
    if (!s) return;
    try {
      await DB.adjustPoints(id, delta, delta > 0 ? 'Manual add' : 'Manual deduct');
      await loadStudents();
    } catch (err) {
      window.alert('Could not update ' + s.name + '.');
    }
  }

  /* ----------------------------- festivita: QR ----------------------------- */

  function qrDataUrl(token) {
    const root = location.origin + location.pathname.slice(0, location.pathname.lastIndexOf('/') + 1);
    return root + 'store.html?code=' + encodeURIComponent(token);
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

  printAllQrs.addEventListener('click', () => {
    if (!students.length) {
      window.alert('Import the roster first.');
      return;
    }
    printQrs('<div class="qr-grid">' + students.map(qrCard).join('') + '</div>');
  });

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
  const awardEvent = document.getElementById('awardEvent');
  const awardRank = document.getElementById('awardRank');
  const awardAmount = document.getElementById('awardAmount');
  const awardMsg = document.getElementById('awardMsg');
  const awardLog = document.getElementById('awardLog');

  const RANK_POINTS = { 1: 25, 2: 15, 3: 10 };

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
      await DB.awardPoints(s.id, amount, reason);
      awardNote('Credited ' + amount + ' GLP to ' + s.name + '.');
      loadStudents();
      loadAwardLog();
      awardStudent.value = '';
      awardEvent.value = '';
      awardRank.value = '1';
      awardAmount.value = '25';
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
        const li = document.createElement('li');
        li.className = 'ledger-row';
        li.innerHTML =
          '<span class="ledger-delta ' + (Number(r.delta) >= 0 ? 'is-add' : 'is-sub') + '">' +
          (Number(r.delta) >= 0 ? '+' : '−') +
          Math.abs(r.delta) +
          '</span>' +
          '<span class="ledger-reason">' + esc(studentName(r.student_id)) + ' · ' + esc(r.reason || 'Festivita point') + '</span>' +
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
    });
  }
})();