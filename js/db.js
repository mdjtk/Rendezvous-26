/*
 * Rendezvous '26 â€” data layer (Supabase only)
 *
 * Every read/write goes to Supabase through its plain REST API using fetch()
 * â€” no SDK, no build step. Configure SUPABASE_URL and SUPABASE_ANON_KEY in
 * js/config.js. Team points refresh on the public page by simple polling.
 */
(function () {
  const C = () => window.RV26.CONFIG;
  const configured = () => window.RV26.isSupabaseConfigured;

  function requireConfigured() {
    if (!configured()) {
      throw new Error(
        'Supabase not configured â€” paste your SUPABASE_URL and SUPABASE_ANON_KEY into js/config.js'
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

  /* ---------------------- staff session (JWT) ---------------------- */

  function storedToken() {
    try {
      return sessionStorage.getItem('rv26_token') || '';
    } catch (e) {
      return '';
    }
  }

  let sessionToken = storedToken();

  function setSessionToken(token) {
    sessionToken = token ? String(token) : '';
    try {
      if (token) sessionStorage.setItem('rv26_token', token);
      else sessionStorage.removeItem('rv26_token');
    } catch (e) {
      /* private mode â€” token just lives for this tab */
    }
  }

  function getSessionToken() {
    return sessionToken || storedToken();
  }

  function clearSessionToken() {
    setSessionToken(null);
  }

  /* Writes attach the staff JWT; reads stay anon (they're public by policy). */
  function writeHeaders() {
    const h = headers();
    const tok = getSessionToken();
    if (tok) h.Authorization = 'Bearer ' + tok;
    return h;
  }

  /*
   * Exchange a PIN for a short-lived JWT via the /verify-pin Edge Function.
   * On success the token is stored and auto-attached to every write.
   * If the edge runtime is unreachable (cold-start/outage), falls back to
   * POST /rest/v1/rpc/rv26_login, a server-side SQL twin of verify-pin.
   */
  async function verifyPin(pin) {
    requireConfigured();
    const pinStr = String(pin || '').trim();
    let res = null;
    let body = {};
    let fetchErr = null;
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 8000);
    try {
      res = await fetch(`${C().SUPABASE_URL}/functions/v1/verify-pin`, {
        method: 'POST',
        headers: { apikey: C().SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: pinStr }),
        signal: ctrl.signal,
      });
      clearTimeout(to);
      try {
        body = await res.json();
      } catch (e) {
        body = {};
      }
    } catch (e) {
      clearTimeout(to);
      fetchErr = e;
    }
    const unreachable =
      !!fetchErr || (res && [502, 503, 504, 546].includes(res.status));
    if (!unreachable) {
      if (!res.ok) {
        const err = new Error((body && body.error) || 'Sign in failed (' + res.status + ')');
        err.status = res.status;
        throw err;
      }
      if (!body.token) throw new Error('Sign in failed - unexpected response');
      setSessionToken(body.token);
      return { role: body.role, expiresAt: body.expires_at };
    }
    /* SQL fallback: rv26_login mints the same JWT server-side. */
    let rpc = null;
    let rpcBody = {};
    const rpcCtrl = new AbortController();
    const rpcTo = setTimeout(() => rpcCtrl.abort(), 10000);
    try {
      rpc = await fetch(`${C().SUPABASE_URL}/rest/v1/rpc/rv26_login`, {
        method: 'POST',
        headers: {
          apikey: C().SUPABASE_ANON_KEY,
          Authorization: 'Bearer ' + C().SUPABASE_ANON_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ pin: pinStr }),
        signal: rpcCtrl.signal,
      });
      clearTimeout(rpcTo);
      try {
        rpcBody = await rpc.json();
      } catch (e) {
        rpcBody = {};
      }
    } catch (e) {
      clearTimeout(rpcTo);
      const err = new Error(
        fetchErr ? fetchErr.message : 'Server unreachable - supervisor access is closed. Check connectivity.'
      );
      err.status = 0;
      throw err;
    }
    if (!rpcBody || !rpcBody.token) {
      const err = new Error(
        (rpcBody && rpcBody.error) || 'Sign in failed (' + (rpc ? rpc.status : 0) + ')'
      );
      err.status = (rpcBody && rpcBody.status) || (rpc ? rpc.status : 0);
      throw err;
    }
    setSessionToken(rpcBody.token);
    return { role: rpcBody.role, expiresAt: rpcBody.expires_at };
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

  /*
   * Generic paginated/filtered read against PostgREST.
   * opts:
   *   select    â€” column list ("*" by default)
   *   order     â€” column to order by (default created_at)
   *   ascending â€” false â†’ desc
   *   limit     â€” page size
   *   offset    â€” page start
   *   filters   â€” { col: value } â†’ col=eq.value  or  { col: { ilike: 'term' } }
   *   count     â€” true adds Prefer: count=exact and returns { data, count }
   * With count:false returns a plain array (backward compatible with sbGet).
   */
  async function sbQuery(table, opts) {
    const o = opts || {};
    const params = ['select=' + (o.select || '*')];
    const order = o.order || 'created_at';
    const dir = o.ascending ? 'asc' : 'desc';
    params.push('order=' + order + '.' + dir + '.nullslast');
    if (o.limit != null) params.push('limit=' + Number(o.limit));
    if (o.offset != null) params.push('offset=' + Number(o.offset));
    if (o.filters) {
      Object.keys(o.filters).forEach((col) => {
        const f = o.filters[col];
        if (f === null || f === undefined || f === '') return;
        if (typeof f === 'object') {
          Object.keys(f).forEach((op) => params.push(col + '=' + op + '.' + encodeURIComponent(f[op])));
        } else {
          params.push(col + '=eq.' + encodeURIComponent(String(f)));
        }
      });
    }
    const res = await fetch(`${C().SUPABASE_URL}/rest/v1/${table}?${params.join('&')}`, {
      headers: o.count ? { ...headers(), Prefer: 'count=exact' } : headers(),
    });
    if (!res.ok) throw new Error('Read failed (' + res.status + ')');
    const data = await res.json();
    if (!o.count) return data;
    let count = Array.isArray(data) ? data.length : 0;
    const range = res.headers.get('Content-Range');
    if (range) {
      const m = range.match(/\/(\d+)$/);
      if (m) count = parseInt(m[1], 10);
    }
    return { data: data || [], count };
  }

  async function sbInsert(table, row) {
    const res = await fetch(`${C().SUPABASE_URL}/rest/v1/${table}`, {
      method: 'POST',
      headers: { ...writeHeaders(), Prefer: 'return=representation' },
      body: JSON.stringify(row),
    });
    if (!res.ok) throw new Error('Insert failed (' + res.status + ')');
    const rows = await res.json();
    return rows[0];
  }

  async function sbInsertAll(table, rows) {
    const res = await fetch(`${C().SUPABASE_URL}/rest/v1/${table}`, {
      method: 'POST',
      headers: { ...writeHeaders(), Prefer: 'return=representation' },
      body: JSON.stringify(rows),
    });
    if (!res.ok) throw new Error('Insert failed (' + res.status + ')');
    return res.json();
  }

  async function sbUpdate(table, id, patch) {
    const res = await fetch(`${C().SUPABASE_URL}/rest/v1/${table}?id=eq.${id}`, {
      method: 'PATCH',
      headers: { ...writeHeaders(), Prefer: 'return=representation' },
      body: JSON.stringify(patch),
    });
    if (!res.ok) throw new Error('Update failed (' + res.status + ')');
    const rows = await res.json();
    return rows[0];
  }

  async function sbDelete(table, id) {
    const res = await fetch(`${C().SUPABASE_URL}/rest/v1/${table}?id=eq.${id}`, {
      method: 'DELETE',
      headers: writeHeaders(),
    });
    if (!res.ok) throw new Error('Delete failed (' + res.status + ')');
  }

  async function sbUpload(bucket, path, file) {
    const encoded = path.split('/').map(encodeURIComponent).join('/');
    const res = await fetch(`${C().SUPABASE_URL}/storage/v1/object/${bucket}/${encoded}`, {
      method: 'POST',
      headers: {
        ...writeHeaders(),
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
      headers: writeHeaders(),
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

  // Relative +/− adjustment of a team's points (admin). Floored at 0.
  async function adjustTeamPoints(id, delta) {
    requireConfigured();
    const d = Math.floor(+delta || 0);
    if (!d) return getTeams();
    const res = await fetch(
      `${C().SUPABASE_URL}/rest/v1/teams?id=eq.${id}&select=*`,
      { headers: headers() }
    );
    if (!res.ok) throw new Error('Read failed (' + res.status + ')');
    const rows = await res.json();
    const team = rows[0];
    if (!team) throw new Error('Team not found');
    const next = Math.max(0, Number(team.points) + d);
    await sbUpdate('teams', id, { points: next, updated_at: new Date().toISOString() });
    audit('team.points.adjust', 'teams', id, team.name, { delta: d, from: team.points, to: next });
    return getTeams();
  }

  async function addTeam(name) {
    requireConfigured();
    const clean = String(name || '').trim();
    if (!clean) return null;
    const row = await sbInsert('teams', { name: clean, points: 0 });
    audit('team.add', 'teams', row.id, clean);
    return row;
  }

  async function deleteTeam(id) {
    requireConfigured();
    const rows = await sbGet('teams', 'points', false).then((r) =>
      r.filter((x) => String(x.id) === String(id))
    );
    const team = rows[0];
    await sbDelete('teams', id);
    audit('team.delete', 'teams', id, team ? team.name : null, team ? { name: team.name } : null);
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

  async function getGalleryPage(opts) {
    requireConfigured();
    const o = opts || {};
    const filters = {};
    if (o.search) filters.caption = { ilike: '*' + o.search + '*' };
    const { data, count } = await sbQuery('gallery', {
      select: 'id,photo_path,caption,created_at',
      order: 'created_at',
      ascending: false,
      limit: o.limit,
      offset: o.offset,
      filters,
      count: true,
    });
    return {
      data: (data || []).map((r) => ({
        ...r,
        url: publicUrl(C().STORAGE_BUCKETS.gallery, r.photo_path),
      })),
      count,
    };
  }

  async function addPhoto(file, caption) {
    requireConfigured();
    const path = uniquePath('photos', file);
    await sbUpload(C().STORAGE_BUCKETS.gallery, path, file);
    const row = await sbInsert('gallery', {
      photo_path: path,
      caption: caption || null,
    });
    audit('gallery.add', 'gallery', row.id, caption || row.photo_path, { path });
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
        /* best effort â€” storage permission may deny removal; row deletion must still succeed */
      }
    }
    await sbDelete('gallery', id);
    audit('gallery.delete', 'gallery', id, row ? row.photo_path : null, row ? { caption: row.caption } : null);
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

  async function getResultsPage(opts) {
    requireConfigured();
    const o = opts || {};
    const filters = {};
    if (o.published === true || o.published === false) filters.published = o.published;
    if (o.category) filters.category = o.category;
    if (o.search) filters.event_name = { ilike: '*' + o.search + '*' };
    const { data, count } = await sbQuery('results', {
      select: 'id,event_name,category,participant_name,rank,places,points,poster_path,published,created_at',
      order: 'created_at',
      ascending: false,
      limit: o.limit,
      offset: o.offset,
      filters,
      count: true,
    });
    return {
      data: (data || []).map((r) => ({
        ...r,
        url: publicUrl(C().STORAGE_BUCKETS.results, r.poster_path),
      })),
      count,
    };
  }

  async function getResultDetail(id) {
    requireConfigured();
    const rows = await sbGet('results').then((r) =>
      (r || []).filter((x) => String(x.id) === String(id))
    );
    const row = rows[0];
    if (!row) return null;
    const allStudents = await getStudents();
    const byName = new Map();
    allStudents.forEach((s) => byName.set(cleanName(s.name).toLowerCase(), s));
    const places = Array.isArray(row.places)
      ? row.places
          .filter((p) => p && String(p.participant_name || '').trim())
          .map((p) => {
            const st = byName.get(cleanName(p.participant_name).toLowerCase());
            return {
              rank: p.rank != null ? Number(p.rank) : null,
              name: String(p.participant_name).trim(),
              team: st ? st.team : null,
              grade: p.grade || (st ? st.category : null) || null,
              points:
                row.points && p.rank != null && row.points[String(p.rank)] != null
                  ? Number(row.points[String(p.rank)])
                  : null,
            };
          })
      : [];
    return {
      ...row,
      places,
      url: publicUrl(C().STORAGE_BUCKETS.results, row.poster_path),
    };
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
      published: true,
    });
    audit('result.add', 'results', row.id, eventName, { category, participant_name: row.participant_name });
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
      published: true,
    });
    audit('result.add', 'results', row.id, eventName, {
      category,
      placements: places.length,
      poster_path: path,
    });
    return { ...row, url: publicUrl(C().STORAGE_BUCKETS.results, path) };
  }

  async function deleteResult(id, url) {
    requireConfigured();
    const rows = await sbGet('results', 'created_at', false).then((r) =>
      r.filter((x) => String(x.id) === String(id))
    );
    const row = rows[0];
    const summary = row
      ? await reverseAwards(row)
      : { teamPts: 0, champPts: 0, coins: 0, students: 0 };
    markNotAwarded(id);
    if (row && row.poster_path) {
      try {
        await sbRemoveObjects(C().STORAGE_BUCKETS.results, [row.poster_path]);
      } catch (e) {
        /* best effort â€” storage permission may deny removal; row deletion must still succeed */
      }
    }
    await sbDelete('results', id);
    audit('result.delete', 'results', id, row ? row.event_name : null, {
      summary,
      participant_name: row ? row.participant_name : null,
      poster_path: row ? row.poster_path : null,
    });
    return summary;
  }

  async function getResultsCounts() {
    requireConfigured();
    const total = await sbQuery('results', { select: 'id', limit: 1, count: true });
    const published = await sbQuery('results', {
      select: 'id',
      filters: { published: true },
      limit: 1,
      count: true,
    });
    return {
      total: total.count,
      published: published.count,
      pending: Math.max(0, total.count - published.count),
    };
  }

// Results are live the moment they are uploaded. Awarding grants per-rank
  // team / champion points and coins exactly once per result, either through
  // the Team Points Publish button or automatically when a result is added.
  // Double-awarding is prevented by a persisted award store, so results stay
  // marked across reloads and sessions without needing extra DB columns.
  const awardStoreKey = () => 'rv26:awarded:' + C().SUPABASE_URL;

  function loadAwardStore() {
    try {
      const raw = JSON.parse(window.localStorage.getItem(awardStoreKey()) || '[]');
      return new Set(Array.isArray(raw) ? raw.map(String) : []);
    } catch (e) {
      return new Set();
    }
  }

  function saveAwardStore(set) {
    try {
      window.localStorage.setItem(awardStoreKey(), JSON.stringify(Array.from(set)));
    } catch (e) { /* best effort */ }
  }

  let awardStoreCache = null;

  function cachedAwardStore() {
    if (!awardStoreCache) awardStoreCache = loadAwardStore();
    return awardStoreCache;
  }

  function markAwarded(id) {
    const set = cachedAwardStore();
    set.add(String(id));
    saveAwardStore(set);
  }

  function markNotAwarded(id) {
    const set = cachedAwardStore();
    if (set.delete(String(id))) saveAwardStore(set);
  }

  // First award pass: treat the already-published backlog as awarded so the
  // bulk button never double-awards results that predate the auto-award flow.
  function primeAwardStore(rows) {
    if (awardStoreCache) return;
    const set = loadAwardStore();
    (rows || []).forEach((r) => set.add(String(r.id)));
    saveAwardStore(set);
    awardStoreCache = set;
  }

  // Accumulates team + student deltas for a single result into the given maps.
  function collectResultAwards(result, studentByName, teamByName, teamDeltas, studentUpdates) {
    if (!result.places) return;
    for (const place of result.places) {
      if (!place.participant_name || !place.rank) continue;
      const pts = result.points ? result.points[String(place.rank)] : 0;
      const placeCoins = Math.max(0, Math.floor(+place.coins || 0));
      const student = studentByName.get(cleanName(place.participant_name).toLowerCase());

      if (pts && student && student.team) {
        const team = teamByName.get(student.team.toLowerCase());
        if (team) teamDeltas[team.id] = (teamDeltas[team.id] || 0) + pts;
      }

      if (student) {
        studentUpdates.push({
          id: student.id,
          champPts: pts || 0,
          coins: placeCoins,
          reason: 'Result ' + place.rank + ordinal(place.rank) + ' in ' + result.event_name,
        });
      }
    }
  }

  async function applyAwards(teamDeltas, studentUpdates, allTeams) {
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
        await pushLedger(u.id, u.coins, u.reason, 'award');
      }
    }
  }

  async function awardResults(limit) {
    requireConfigured();
    let query = 'results?published=eq.true&select=*&order=created_at.asc';
    if (limit > 0) query += '&limit=' + limit;
    const res = await fetch(`${C().SUPABASE_URL}/rest/v1/${query}`, { headers: headers() });
    if (!res.ok) throw new Error('Read failed (' + res.status + ')');
    const candidates = await res.json();
    primeAwardStore(candidates);
    const marked = cachedAwardStore();
    const toAward = (candidates || []).filter((r) => !marked.has(String(r.id)));
    if (toAward.length === 0) return { awarded: 0, teams: await getTeams() };

    const allStudents = await getStudents();
    const studentByName = new Map();
    allStudents.forEach((s) => studentByName.set(cleanName(s.name).toLowerCase(), s));

    const allTeams = await getTeams();
    const teamByName = new Map();
    allTeams.forEach((t) => teamByName.set(t.name.toLowerCase(), t));

    const teamDeltas = {};
    const studentUpdates = [];

    for (const result of toAward) {
      collectResultAwards(result, studentByName, teamByName, teamDeltas, studentUpdates);
      markAwarded(result.id);
    }

    await applyAwards(teamDeltas, studentUpdates, allTeams);
    audit('result.award.bulk', 'results', null, String(toAward.length) + ' results', {
      awarded: toAward.length,
      team_deltas: Object.keys(teamDeltas).length,
      placements: studentUpdates.length,
    });

    return { awarded: toAward.length, teams: await getTeams() };
  }

  // Awards a single freshly-added result so points land the moment a result
  // is saved from the Result Posters tab.
  async function awardSingle(result) {
    requireConfigured();
    const allStudents = await getStudents();
    const studentByName = new Map();
    allStudents.forEach((s) => studentByName.set(cleanName(s.name).toLowerCase(), s));

    const allTeams = await getTeams();
    const teamByName = new Map();
    allTeams.forEach((t) => teamByName.set(t.name.toLowerCase(), t));

    const teamDeltas = {};
    const studentUpdates = [];
    collectResultAwards(result, studentByName, teamByName, teamDeltas, studentUpdates);
    await applyAwards(teamDeltas, studentUpdates, allTeams);
    markAwarded(result.id);
    audit('result.award', 'results', result.id, result.event_name, {
      placements: studentUpdates.length,
    });

    return { awarded: 1, placements: studentUpdates.length };
  }

  // Reverses everything a single result awarded: team points, the winner's
  // individual champion points and their coins (with a ledger entry). Deltas
  // are clamped so balances never go negative, and results that were never
  // awarded simply decrement nothing.
  async function reverseAwards(result) {
    const allStudents = await getStudents();
    const studentByName = new Map();
    allStudents.forEach((s) => studentByName.set(cleanName(s.name).toLowerCase(), s));

    const allTeams = await getTeams();
    const teamByName = new Map();
    allTeams.forEach((t) => teamByName.set(t.name.toLowerCase(), t));

    const teamDeltas = {};
    const studentDeltas = [];
    if (result.places) {
      for (const place of result.places) {
        if (!place.participant_name || !place.rank) continue;
        const pts = result.points ? result.points[String(place.rank)] : 0;
        const placeCoins = Math.max(0, Math.floor(+place.coins || 0));
        const student = studentByName.get(cleanName(place.participant_name).toLowerCase());

        if (pts && student && student.team) {
          const team = teamByName.get(student.team.toLowerCase());
          if (team) teamDeltas[team.id] = (teamDeltas[team.id] || 0) + pts;
        }

        if (student) {
          studentDeltas.push({
            id: student.id,
            champPts: pts || 0,
            coins: placeCoins,
            reason: 'Result removed ' + place.rank + ordinal(place.rank) + ' in ' + result.event_name,
          });
        }
      }
    }

    const summary = { teamPts: 0, champPts: 0, coins: 0, students: studentDeltas.length };
    for (const [teamId, delta] of Object.entries(teamDeltas)) {
      const team = allTeams.find((t) => String(t.id) === String(teamId));
      if (!team) continue;
      const next = Math.max(0, team.points - delta);
      if (next !== team.points) {
        await setTeamPoints(team.id, next);
        summary.teamPts += delta;
      }
    }
    for (const u of studentDeltas) {
      if (u.champPts) {
        await withPointsUpdate(u.id, (p) => Math.max(0, p - u.champPts));
        summary.champPts += u.champPts;
      }
      if (u.coins) {
        await withCoinsUpdate(u.id, (c) => Math.max(0, c - u.coins));
        await pushLedger(u.id, -u.coins, u.reason, 'remove');
        summary.coins += u.coins;
      }
    }
    return summary;
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
    audit('student.add.bulk', 'students', null, String(rows.length) + ' students', {
      count: rows.length,
      team: team || null,
      category: category || null,
    });
    return rows.length;
  }

  // 1001 â†’ 'Minor', 2001 â†’ 'Premier', 3001 â†’ 'Sub junior', 4001 â†’ 'General'
  function sectionForRosterNo(n) {
    if (n >= 4000) return 'General';
    if (n >= 3000) return 'Sub junior';
    if (n >= 2000) return 'Premier';
    if (n >= 1000) return 'Minor';
    return null;
  }

  async function deleteStudent(id) {
    requireConfigured();
    const rows = await sbGet('students', 'name', true).then((r) =>
      r.filter((x) => String(x.id) === String(id))
    );
    const student = rows[0];
    // Ledger rows are removed by the foreign key on delete cascade.
    await sbDelete('students', id);
    audit('student.delete', 'students', id, student ? student.name : null, student ? { name: student.name } : null);
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

  async function getLedgerAll(channel) {
    requireConfigured();
    return sbQuery('glocal_ledger', {
      order: 'created_at',
      ascending: false,
      filters: channel ? { channel } : undefined,
    });
  }

  async function pushLedger(studentId, delta, reason, channel) {
    requireConfigured();
    await sbInsert('glocal_ledger', {
      student_id: studentId,
      delta,
      reason: reason || null,
      channel: channel || 'store',
    });
  }

  /* --------------------- audit + owner reads --------------------- */

  // Owner-visible record of who changed what. Best-effort: audit must never
  // block the work it is reporting on.
  async function audit(action, entityType, entityId, entityName, detail) {
    try {
      let actor = 'staff';
      try {
        actor = window.sessionStorage.getItem('rv26_role') || 'staff';
      } catch (e) { /* ignore */ }
      await sbInsert('audit_log', {
        actor,
        action: String(action || 'action'),
        entity_type: entityType || null,
        entity_id: entityId != null ? String(entityId) : null,
        entity_name: entityName != null ? String(entityName) : null,
        detail: detail ? JSON.parse(JSON.stringify(detail)) : null,
      });
    } catch (e) { /* silent */ }
  }

  // Super-admin read that attaches the staff JWT. Mirrors sbQuery so the
  // owner can read owner-only tables (audit_log) from the console.
  async function queryTable(table, opts) {
    requireConfigured();
    const o = opts || {};
    const params = ['select=' + (o.select || '*')];
    const order = o.order || 'created_at';
    const dir = o.ascending ? 'asc' : 'desc';
    params.push('order=' + order + '.' + dir + '.nullslast');
    if (o.limit != null) params.push('limit=' + Number(o.limit));
    if (o.offset != null) params.push('offset=' + Number(o.offset));
    if (o.filters) {
      Object.keys(o.filters).forEach((col) => {
        const f = o.filters[col];
        if (f === null || f === undefined || f === '') return;
        if (typeof f === 'object') {
          Object.keys(f).forEach((op) =>
            params.push(col + '=' + op + '.' + encodeURIComponent(f[op]))
          );
        } else {
          params.push(col + '=eq.' + encodeURIComponent(String(f)));
        }
      });
    }
    const res = await fetch(`${C().SUPABASE_URL}/rest/v1/${table}?${params.join('&')}`, {
      headers: o.count ? { ...writeHeaders(), Prefer: 'count=exact' } : writeHeaders(),
    });
    if (!res.ok) throw new Error('Read failed (' + res.status + ')');
    const data = await res.json();
    if (!o.count) return data;
    let count = Array.isArray(data) ? data.length : 0;
    const range = res.headers.get('Content-Range');
    if (range) {
      const m = range.match(/\/(\d+)$/);
      if (m) count = parseInt(m[1], 10);
    }
    return { data: data || [], count };
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
    await pushLedger(studentId, amt, cleanName(reason) || 'Award', 'award');
    audit('coins.award', 'students', studentId, cleanName(reason) || 'Award', { amount: amt });
    return updated;
  }

  // Debits coins at the counter. Throws { code: 'INSUFFICIENT' } if the
  // student cannot cover the amount â€” re-checked at the moment of purchase.
  async function deductForStore(studentId, amount, reason, channel) {
    const amt = Math.max(0, Math.floor(+amount || 0));
    if (!amt) throw new Error('Enter a valid amount');
    let updated;
    await (async () => {
      updated = await withCoinsUpdate(studentId, (c) => {
        if (c < amt) throw { code: 'INSUFFICIENT', balance: c, need: amt };
        return c - amt;
      });
    })();
    await pushLedger(studentId, -amt, cleanName(reason) || 'Store purchase', channel);
    audit('coins.deduct', 'students', studentId, cleanName(reason) || 'Store purchase', {
      amount: -amt,
      channel: channel || 'store',
    });
    return updated;
  }

  // Manual +/âˆ’ coin tweak in admin (negative allowed).
  async function adjustCoins(studentId, delta, reason) {
    const d = Math.floor(+delta || 0);
    if (!d) return withCoinsUpdate(studentId, (c) => c);
    const updated = await withCoinsUpdate(studentId, (c) => c + d);
    await pushLedger(studentId, d, cleanName(reason) || 'Adjustment', 'adjust');
    audit('coins.adjust', 'students', studentId, cleanName(reason) || 'Adjustment', { delta: d });
    return updated;
  }

  // Relative +/− adjustment of an individual champion's points (admin). Floored at 0.
  async function adjustStudentPoints(id, delta) {
    const d = Math.floor(+delta || 0);
    if (!d) return withPointsUpdate(id, (p) => p);
    const updated = await withPointsUpdate(id, (p) => Math.max(0, Number(p) + d));
    audit('points.adjust', 'students', id, null, { delta: d });
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
      headers: writeHeaders(),
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
    const created = await sbInsert('schedule', {
      day: row.day,
      time: row.time || '',
      title: row.title,
      location: row.location || null,
      tag: row.tag || null,
      position: row.position,
      section: row.section || null,
    });
    audit('schedule.add', 'schedule', created.id, row.title, row);
    return created;
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
    audit('schedule.update', 'schedule', id, patch.title || null, patch);
  }

  async function deleteScheduleEntry(id) {
    requireConfigured();
    const rows = await sbGet('schedule', 'position', true).then((r) =>
      r.filter((x) => String(x.id) === String(id))
    );
    const entry = rows[0];
    await sbDelete('schedule', id);
    audit('schedule.delete', 'schedule', id, entry ? entry.title : null, entry ? entry : null);
  }

  window.RV26.DB = {
    getTeams,
    setTeamPoints,
    adjustTeamPoints,
    addTeam,
    deleteTeam,
    getGallery,
    getGalleryPage,
    addPhoto,
    deletePhoto,
    getResults,
    getResultsPage,
    addResult,
    addResults,
    deleteResult,
    reverseResult: reverseAwards,
    getResultsCounts,
    awardResults,
    awardSingle,
    subscribeTeams,
    getStudents,
    addStudentsBulk,
    deleteStudent,
    getStudentByToken,
    getStudentByName,
    getLedger,
    getLedgerAll,
    queryTable,
    audit,
    awardCoins,
    deductForStore,
    adjustCoins,
    adjustStudentPoints,
    subscribeStudents,
    subscribeResults,
    getPrograms,
    getSchedule,
    addScheduleEntry,
    updateScheduleEntry,
    deleteScheduleEntry,
    verifyPin,
    setSessionToken,
    getSessionToken,
    clearSessionToken,
    isSupabaseConfigured: configured,
  };
})();