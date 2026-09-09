/*
 * Rendezvous '26 — data layer (Supabase only)
 *
 * Every read/write goes to Supabase through its plain REST API using fetch()
 * — no SDK, no build step. Configure SUPABASE_URL and SUPABASE_ANON_KEY in
 * js/config.js. Team points refresh on the public page by simple polling.
 */
(function () {
  const C = () => window.RV26.CONFIG;
  const configured = () => window.RV26.isSupabaseConfigured;

  function requireConfigured() {
    if (!configured()) {
      throw new Error(
        'Supabase not configured — paste your SUPABASE_URL and SUPABASE_ANON_KEY into js/config.js'
      );
    }
  }

  /* ------------------------- supabase helpers ------------------------- */

  function headers() {
    return {
      apikey: C().SUPABASE_ANON_KEY,
      Authorization: 'Bearer ' + C().SUPABASE_ANON_KEY,
      'Content-Type': 'application/json',
    };
  }

  async function sbGet(table, orderCol, ascending) {
    const dir = ascending ? 'asc' : 'desc';
    const res = await fetch(
      `${C().SUPABASE_URL}/rest/v1/${table}?select=*&order=${orderCol}.${dir}.nullslast`,
      { headers: headers() }
    );
    if (!res.ok) throw new Error('Read failed (' + res.status + ')');
    return res.json();
  }

  async function sbInsert(table, row) {
    const res = await fetch(`${C().SUPABASE_URL}/rest/v1/${table}`, {
      method: 'POST',
      headers: { ...headers(), Prefer: 'return=representation' },
      body: JSON.stringify(row),
    });
    if (!res.ok) throw new Error('Insert failed (' + res.status + ')');
    const rows = await res.json();
    return rows[0];
  }

  async function sbInsertAll(table, rows) {
    const res = await fetch(`${C().SUPABASE_URL}/rest/v1/${table}`, {
      method: 'POST',
      headers: { ...headers(), Prefer: 'return=representation' },
      body: JSON.stringify(rows),
    });
    if (!res.ok) throw new Error('Insert failed (' + res.status + ')');
    return res.json();
  }

  async function sbUpdate(table, id, patch) {
    const res = await fetch(`${C().SUPABASE_URL}/rest/v1/${table}?id=eq.${id}`, {
      method: 'PATCH',
      headers: { ...headers(), Prefer: 'return=representation' },
      body: JSON.stringify(patch),
    });
    if (!res.ok) throw new Error('Update failed (' + res.status + ')');
    const rows = await res.json();
    return rows[0];
  }

  async function sbDelete(table, id) {
    const res = await fetch(`${C().SUPABASE_URL}/rest/v1/${table}?id=eq.${id}`, {
      method: 'DELETE',
      headers: headers(),
    });
    if (!res.ok) throw new Error('Delete failed (' + res.status + ')');
  }

  async function sbUpload(bucket, path, file) {
    const encoded = path.split('/').map(encodeURIComponent).join('/');
    const res = await fetch(`${C().SUPABASE_URL}/storage/v1/object/${bucket}/${encoded}`, {
      method: 'POST',
      headers: {
        apikey: C().SUPABASE_ANON_KEY,
        Authorization: 'Bearer ' + C().SUPABASE_ANON_KEY,
        'Content-Type': file.type || 'application/octet-stream',
        'x-upsert': 'false',
      },
      body: file,
    });
    if (!res.ok) throw new Error('Upload failed (' + res.status + ')');
    const data = await res.json();
    return data.Key || path;
  }

  async function sbRemoveObjects(bucket, paths) {
    const res = await fetch(`${C().SUPABASE_URL}/storage/v1/object/${bucket}/remove`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ prefixes: paths }),
    });
    if (!res.ok) throw new Error('Storage delete failed (' + res.status + ')');
    return res.json();
  }

  function publicUrl(bucket, path) {
    if (!path) return '';
    return `${C().SUPABASE_URL}/storage/v1/object/public/${bucket}/${path}`;
  }

  function uniquePath(prefix, file) {
    const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^\w]+/g, '');
    const stamp = Date.now();
    const rand = Math.random().toString(36).slice(2, 8);
    return `${prefix}/${stamp}-${rand}.${ext}`;
  }

  /* ------------------------------- teams ------------------------------ */

  async function getTeams() {
    requireConfigured();
    return sbGet('teams', 'points', false);
  }

  async function setTeamPoints(id, points) {
    requireConfigured();
    await sbUpdate('teams', id, { points, updated_at: new Date().toISOString() });
    return getTeams();
  }

  async function addTeam(name) {
    requireConfigured();
    const clean = String(name || '').trim();
    if (!clean) return null;
    return sbInsert('teams', { name: clean, points: 0 });
  }

  async function deleteTeam(id) {
    requireConfigured();
    await sbDelete('teams', id);
  }

  /* ------------------------------ gallery ----------------------------- */

  async function getGallery() {
    requireConfigured();
    const rows = await sbGet('gallery', 'created_at', false);
    return rows.map((r) => ({
      ...r,
      url: publicUrl(C().STORAGE_BUCKETS.gallery, r.photo_path),
    }));
  }

  async function addPhoto(file, caption) {
    requireConfigured();
    const path = uniquePath('photos', file);
    await sbUpload(C().STORAGE_BUCKETS.gallery, path, file);
    const row = await sbInsert('gallery', {
      photo_path: path,
      caption: caption || null,
    });
    return { ...row, url: publicUrl(C().STORAGE_BUCKETS.gallery, path) };
  }

  async function deletePhoto(id) {
    requireConfigured();
    const rows = await sbGet('gallery', 'created_at', false).then((r) =>
      r.filter((x) => String(x.id) === String(id))
    );
    const row = rows[0];
    if (row && row.photo_path) {
      await sbRemoveObjects(C().STORAGE_BUCKETS.gallery, [row.photo_path]);
    }
    await sbDelete('gallery', id);
  }

  /* ------------------------------ results ----------------------------- */

  async function getResults() {
    requireConfigured();
    const rows = await sbGet('results', 'created_at', false);
    return rows.map((r) => ({
      ...r,
      url: publicUrl(C().STORAGE_BUCKETS.results, r.poster_path),
    }));
  }

  async function addResult(eventName, category, file, name, rank) {
    requireConfigured();
    const path = uniquePath('posters', file);
    await sbUpload(C().STORAGE_BUCKETS.results, path, file);
    const row = await sbInsert('results', {
      event_name: eventName,
      category: category || null,
      participant_name: name ? String(name).trim() : null,
      rank: rank ? Number(rank) : null,
      poster_path: path,
    });
    return { ...row, url: publicUrl(C().STORAGE_BUCKETS.results, path) };
  }

  async function deleteResult(id) {
    requireConfigured();
    const rows = await sbGet('results', 'created_at', false).then((r) =>
      r.filter((x) => String(x.id) === String(id))
    );
    const row = rows[0];
    if (row && row.poster_path) {
      await sbRemoveObjects(C().STORAGE_BUCKETS.results, [row.poster_path]);
    }
    await sbDelete('results', id);
  }

  /* ------------------------------ realtime ---------------------------- */

  // Simple 10s polling. onChange is only called when the standings actually
  // changed, so the LIVE pill does not pulse needlessly.
  function subscribeTeams(onChange) {
    let last = null;
    const poll = async () => {
      try {
        const teams = await getTeams();
        const key = JSON.stringify(teams.map((t) => [t.id, t.points]));
        if (key !== last) {
          last = key;
          onChange(teams);
        }
      } catch (e) {
        /* ignore transient errors */
      }
    };
    poll();
    const timer = setInterval(poll, 10000);
    return () => clearInterval(timer);
  }

  /* ----------------------- festivita points: students ---------------------- */

  function cleanName(raw) {
    return String(raw || '').replace(/\s+/g, ' ').trim();
  }

  function genToken(used) {
    let token = '';
    do {
      token = 'FESTI-' + Math.random().toString(36).slice(2, 8).toUpperCase();
    } while (used.has(token));
    return token;
  }

  async function getStudents() {
    requireConfigured();
    return sbGet('students', 'name', true);
  }

  // lines: array of raw roster lines, e.g. "1001. Ziyad Abdulkareem". A
  // leading number (when present) becomes the student's roster_no and QR token.
  async function addStudentsBulk(lines, team) {
    requireConfigured();
    const entries = (lines || [])
      .map(cleanName)
      .filter(Boolean)
      .map((line) => {
        const m = line.match(/^(\d{3,})\s*[.)\s:-]\s*(.*)$/);
        return m ? { name: m[2], num: m[1] } : { name: line, num: null };
      })
      .filter((x) => x.name);
    if (entries.length === 0) return 0;

    const used = new Set(
      (await sbGet('students', 'name', true)).map((s) => String(s.qr_token).toUpperCase())
    );
    const rows = entries.map(({ name, num }) => {
      const taken = num && used.has(String(num).toUpperCase());
      const token = taken ? genToken(used) : num ? String(num) : genToken(used);
      used.add(token.toUpperCase());
      return {
        name,
        team: team || null,
        qr_token: token,
        roster_no: !taken && num ? Number(num) : null,
      };
    });
    await sbInsertAll('students', rows);
    return rows.length;
  }

  async function deleteStudent(id) {
    requireConfigured();
    // Ledger rows are removed by the foreign key on delete cascade.
    await sbDelete('students', id);
  }

  async function getStudentByToken(token) {
    requireConfigured();
    const t = String(token || '').trim().toUpperCase();
    if (!t) return null;
    const res = await fetch(
      `${C().SUPABASE_URL}/rest/v1/students?qr_token=eq.${encodeURIComponent(t)}&select=*`,
      { headers: headers() }
    );
    if (!res.ok) throw new Error('Read failed (' + res.status + ')');
    const rows = await res.json();
    return rows[0] || null;
  }

  async function getStudentByName(name) {
    requireConfigured();
    const n = cleanName(name);
    if (!n) return null;
    const pattern = '*' + n.split(/\s+/).join('*') + '*';
    const res = await fetch(
      `${C().SUPABASE_URL}/rest/v1/students?name=ilike.${encodeURIComponent(pattern)}&select=*&limit=1`,
      { headers: headers() }
    );
    if (!res.ok) throw new Error('Read failed (' + res.status + ')');
    const rows = await res.json();
    return rows[0] || null;
  }

  async function getLedger(studentId) {
    requireConfigured();
    const res = await fetch(
      `${C().SUPABASE_URL}/rest/v1/glocal_ledger?student_id=eq.${studentId}&select=*&order=created_at.desc.nullslast`,
      { headers: headers() }
    );
    if (!res.ok) throw new Error('Read failed (' + res.status + ')');
    return res.json();
  }

  async function getLedgerAll() {
    requireConfigured();
    return sbGet('glocal_ledger', 'created_at', false);
  }

  async function pushLedger(studentId, delta, reason) {
    requireConfigured();
    await sbInsert('glocal_ledger', { student_id: studentId, delta, reason: reason || null });
  }

  async function withPointsUpdate(id, apply) {
    requireConfigured();
    const res = await fetch(
      `${C().SUPABASE_URL}/rest/v1/students?id=eq.${id}&select=*`,
      { headers: headers() }
    );
    if (!res.ok) throw new Error('Read failed (' + res.status + ')');
    const rows = await res.json();
    const student = rows[0];
    if (!student) throw new Error('Student not found');
    const next = apply(student.points);
    return sbUpdate('students', id, { points: next });
  }

  // Credits points and writes an award ledger row.
  async function awardPoints(studentId, amount, reason) {
    const amt = Math.max(0, Math.floor(+amount || 0));
    if (!amt) return withPointsUpdate(studentId, (p) => p);
    const updated = await withPointsUpdate(studentId, (p) => p + amt);
    await pushLedger(studentId, amt, cleanName(reason) || 'Award');
    return updated;
  }

  // Debits points at the counter. Throws { code: 'INSUFFICIENT' } if the
  // student cannot cover the amount — re-checked at the moment of purchase.
  async function deductForStore(studentId, amount, reason) {
    const amt = Math.max(0, Math.floor(+amount || 0));
    if (!amt) throw new Error('Enter a valid amount');
    let updated;
    await (async () => {
      updated = await withPointsUpdate(studentId, (p) => {
        if (p < amt) throw { code: 'INSUFFICIENT', balance: p, need: amt };
        return p - amt;
      });
    })();
    await pushLedger(studentId, -amt, cleanName(reason) || 'Store purchase');
    return updated;
  }

  // Manual +/− tweak in admin (negative allowed).
  async function adjustPoints(studentId, delta, reason) {
    const d = Math.floor(+delta || 0);
    if (!d) return withPointsUpdate(studentId, (p) => p);
    const updated = await withPointsUpdate(studentId, (p) => p + d);
    await pushLedger(studentId, d, cleanName(reason) || 'Adjustment');
    return updated;
  }

  function subscribeStudents(onChange) {
    let last = null;
    const poll = async () => {
      try {
        const students = await getStudents();
        const key = JSON.stringify(students.map((s) => [s.id, s.points]));
        if (key !== last) {
          last = key;
          onChange(students);
        }
      } catch (e) {
        /* ignore transient errors */
      }
    };
    poll();
    const timer = setInterval(poll, 10000);
    return () => clearInterval(timer);
  }

  window.RV26.DB = {
    getTeams,
    setTeamPoints,
    addTeam,
    deleteTeam,
    getGallery,
    addPhoto,
    deletePhoto,
    getResults,
    addResult,
    deleteResult,
    subscribeTeams,
    getStudents,
    addStudentsBulk,
    deleteStudent,
    getStudentByToken,
    getStudentByName,
    getLedger,
    getLedgerAll,
    awardPoints,
    deductForStore,
    adjustPoints,
    subscribeStudents,
    isSupabaseConfigured: configured,
  };
})();