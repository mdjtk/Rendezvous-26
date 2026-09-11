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
      try {
        await sbRemoveObjects(C().STORAGE_BUCKETS.gallery, [row.photo_path]);
      } catch (e) {
        /* best effort — storage permission may deny removal; row deletion must still succeed */
      }
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

  async function addResults(eventName, category, file, placements) {
    requireConfigured();
    const path = uniquePath('posters', file);
    await sbUpload(C().STORAGE_BUCKETS.results, path, file);
    const places = placements
      .filter((p) => p && p.participant_name)
      .map((p) => ({
        rank: p.rank ? Number(p.rank) : null,
        participant_name: String(p.participant_name).trim(),
        grade: p.grade || null,
        coins: Math.max(0, Math.floor(+p.coins || 0)) || null,
      }));
    const rankPoints = {};
    placements.forEach((p) => {
      if (p.rank && p.points) rankPoints[String(p.rank)] = Number(p.points);
    });
    const first = places[0] || {};
    const row = await sbInsert('results', {
      event_name: eventName,
      category: category || null,
      participant_name: first.participant_name || null,
      rank: first.rank || null,
      places: places.length ? places : null,
      poster_path: path,
      points: Object.keys(rankPoints).length ? rankPoints : null,
      published: false,
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
      try {
        await sbRemoveObjects(C().STORAGE_BUCKETS.results, [row.poster_path]);
      } catch (e) {
        /* best effort — storage permission may deny removal; row deletion must still succeed */
      }
    }
    await sbDelete('results', id);
  }

  async function getResultsCounts() {
    requireConfigured();
    const res = await fetch(`${C().SUPABASE_URL}/rest/v1/results?select=id,published`, {
      headers: headers(),
    });
    if (!res.ok) throw new Error('Read failed (' + res.status + ')');
    const rows = await res.json();
    return {
      total: rows.length,
      published: rows.filter((r) => r.published).length,
      pending: rows.filter((r) => !r.published).length,
    };
  }

  async function publishResults(limit) {
    requireConfigured();
    let query = 'results?published=eq.false&select=*&order=created_at.asc';
    if (limit > 0) query += '&limit=' + limit;
    const res = await fetch(`${C().SUPABASE_URL}/rest/v1/${query}`, { headers: headers() });
    if (!res.ok) throw new Error('Read failed (' + res.status + ')');
    const toPublish = await res.json();
    if (toPublish.length === 0) return { published: 0, teams: await getTeams() };

    const allStudents = await getStudents();
    const studentByName = new Map();
    allStudents.forEach((s) => studentByName.set(cleanName(s.name).toLowerCase(), s));

    const allTeams = await getTeams();
    const teamByName = new Map();
    allTeams.forEach((t) => teamByName.set(t.name.toLowerCase(), t));

    const teamDeltas = {};
    const studentUpdates = [];

    for (const result of toPublish) {
      if (result.places) {
        for (const place of result.places) {
          if (!place.participant_name || !place.rank) continue;
          const pts = result.points ? result.points[String(place.rank)] : 0;
          const placeCoins = Math.max(0, Math.floor(+place.coins || 0));
          const student = studentByName.get(cleanName(place.participant_name).toLowerCase());

          // Award team points
          if (pts && student && student.team) {
            const team = teamByName.get(student.team.toLowerCase());
            if (team) teamDeltas[team.id] = (teamDeltas[team.id] || 0) + pts;
          }

          // Award individual champ points + coins to student
          if (student) {
            const champPts = pts || 0;
            studentUpdates.push({
              id: student.id,
              champPts: champPts,
              coins: placeCoins,
              reason: 'Result · ' + place.rank + ordinal(place.rank) + ' · ' + result.event_name,
            });
          }
        }
      }
      await sbUpdate('results', result.id, { published: true });
    }

    for (const [teamId, delta] of Object.entries(teamDeltas)) {
      const team = allTeams.find((t) => String(t.id) === String(teamId));
      if (team) await setTeamPoints(team.id, team.points + delta);
    }

    for (const u of studentUpdates) {
      if (u.champPts) {
        await withPointsUpdate(u.id, (p) => p + u.champPts);
      }
      if (u.coins) {
        await withCoinsUpdate(u.id, (c) => c + u.coins);
        await pushLedger(u.id, u.coins, u.reason);
      }
    }

    return { published: toPublish.length, teams: await getTeams() };
  }

  function ordinal(n) {
    n = Number(n);
    if (n === 1) return 'st';
    if (n === 2) return 'nd';
    if (n === 3) return 'rd';
    return 'th';
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
  async function addStudentsBulk(lines, team, category) {
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
      const derived = num ? sectionForRosterNo(Number(num)) : null;
      return {
        name,
        team: team || null,
        category: category || derived || null,
        qr_token: token,
        roster_no: !taken && num ? Number(num) : null,
      };
    });
    await sbInsertAll('students', rows);
    return rows.length;
  }

  // 1001 → 'Minor', 2001 → 'Premier', 3001 → 'Sub junior', 4001 → 'General'
  function sectionForRosterNo(n) {
    if (n >= 4000) return 'General';
    if (n >= 3000) return 'Sub junior';
    if (n >= 2000) return 'Premier';
    if (n >= 1000) return 'Minor';
    return null;
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

  async function withCoinsUpdate(id, apply) {
    requireConfigured();
    const res = await fetch(
      `${C().SUPABASE_URL}/rest/v1/students?id=eq.${id}&select=*`,
      { headers: headers() }
    );
    if (!res.ok) throw new Error('Read failed (' + res.status + ')');
    const rows = await res.json();
    const student = rows[0];
    if (!student) throw new Error('Student not found');
    const next = apply(student.coins);
    return sbUpdate('students', id, { coins: next });
  }

  // Credits coins and writes an award ledger row.
  async function awardCoins(studentId, amount, reason) {
    const amt = Math.max(0, Math.floor(+amount || 0));
    if (!amt) return withCoinsUpdate(studentId, (c) => c);
    const updated = await withCoinsUpdate(studentId, (c) => c + amt);
    await pushLedger(studentId, amt, cleanName(reason) || 'Award');
    return updated;
  }

  // Debits coins at the counter. Throws { code: 'INSUFFICIENT' } if the
  // student cannot cover the amount — re-checked at the moment of purchase.
  async function deductForStore(studentId, amount, reason) {
    const amt = Math.max(0, Math.floor(+amount || 0));
    if (!amt) throw new Error('Enter a valid amount');
    let updated;
    await (async () => {
      updated = await withCoinsUpdate(studentId, (c) => {
        if (c < amt) throw { code: 'INSUFFICIENT', balance: c, need: amt };
        return c - amt;
      });
    })();
    await pushLedger(studentId, -amt, cleanName(reason) || 'Store purchase');
    return updated;
  }

  // Manual +/− coin tweak in admin (negative allowed).
  async function adjustCoins(studentId, delta, reason) {
    const d = Math.floor(+delta || 0);
    if (!d) return withCoinsUpdate(studentId, (c) => c);
    const updated = await withCoinsUpdate(studentId, (c) => c + d);
    await pushLedger(studentId, d, cleanName(reason) || 'Adjustment');
    return updated;
  }

  function subscribeStudents(onChange) {
    let last = null;
    const poll = async () => {
      try {
        const students = await getStudents();
        const key = JSON.stringify(students.map((s) => [s.id, s.points, s.coins]));
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

  function subscribeResults(onChange) {
    let last = null;
    const poll = async () => {
      try {
        const list = await getResults();
        const key = JSON.stringify(
          list.map((r) => [
            r.id,
            r.poster_path,
            r.event_name,
            r.category,
            r.published,
            r.created_at,
            r.participant_name,
            JSON.stringify(r.places || null),
            JSON.stringify(r.points || null),
          ])
        );
        if (key !== last) {
          last = key;
          onChange(list);
        }
      } catch (e) {
        /* ignore transient errors */
      }
    };
    poll();
    const timer = setInterval(poll, 10000);
    return () => clearInterval(timer);
  }

  /* ----------------------- programme list ----------------------- */

  async function getPrograms() {
    requireConfigured();
    const rows = await sbGet('programs', 'id', true);
    rows.sort(
      (a, b) =>
        a.section_order - b.section_order ||
        (a.stage === 'On Stage' ? 0 : 1) - (b.stage === 'On Stage' ? 0 : 1) ||
        a.position - b.position
    );
    return rows;
  }

  /* ------------------------- schedule ------------------------- */

  async function sbDelete(table, id) {
    const res = await fetch(`${C().SUPABASE_URL}/rest/v1/${table}?id=eq.${id}`, {
      method: 'DELETE',
      headers: headers(),
    });
    if (!res.ok) throw new Error('Delete failed (' + res.status + ')');
  }

  async function getSchedule() {
    requireConfigured();
    const rows = await sbGet('schedule', 'position', true);
    const order = { Minor: 1, Premier: 2, 'Sub junior': 3, General: 4 };
    rows.sort(
      (a, b) =>
        (order[a.section] || 0) - (order[b.section] || 0) ||
        a.position - b.position ||
        a.day - b.day
    );
    return rows;
  }

  async function addScheduleEntry(row) {
    requireConfigured();
    return sbInsert('schedule', {
      day: row.day,
      time: row.time || '',
      title: row.title,
      location: row.location || null,
      tag: row.tag || null,
      position: row.position,
      section: row.section || null,
    });
  }

  async function updateScheduleEntry(id, patch) {
    requireConfigured();
    await sbUpdate('schedule', id, {
      day: patch.day,
      time: patch.time || '',
      title: patch.title,
      location: patch.location || null,
      tag: patch.tag || null,
      position: patch.position,
      section: patch.section || null,
    });
  }

  async function deleteScheduleEntry(id) {
    requireConfigured();
    await sbDelete('schedule', id);
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
    addResults,
    deleteResult,
    getResultsCounts,
    publishResults,
    subscribeTeams,
    getStudents,
    addStudentsBulk,
    deleteStudent,
    getStudentByToken,
    getStudentByName,
    getLedger,
    getLedgerAll,
    awardCoins,
    deductForStore,
    adjustCoins,
    subscribeStudents,
    subscribeResults,
    getPrograms,
    getSchedule,
    addScheduleEntry,
    updateScheduleEntry,
    deleteScheduleEntry,
    isSupabaseConfigured: configured,
  };
})();