/*
 * Rendezvous '26 — /chat Edge Function
 *
 * The always-available half of the hybrid supervisor assistant. Backed by
 * Google Gemini (gemini-2.5-flash) with function-calling tools that run
 * against the real database through the caller's own JWT, so RLS still
 * applies — the owner ("super") can read and write; admin/store can only
 * read; write tools always insert an audit_log row with actor "bot".
 *
 * Client half: bridge/relay.mjs (local opencode). Portal picks either.
 *
 * Deploy:
 *   supabase functions deploy chat
 *   supabase secrets set GEMINI_API_KEY=<Google AI Studio key> \
 *     SUPER_PIN_HASH=... ADMIN_PIN_HASH=... STORE_PIN_HASH=... BOOKSTALL_PIN_HASH=... \
 *     JWT_SECRET=<Dashboard -> Settings -> API -> JWT Secret>
 *
 * Kill-switch: set BOT_WRITES=paused to freeze every bot write (reads stay on).
 */

const enc = new TextEncoder();

const TTL_GRACE_SEC = 300; // tolerate tokens up to 5 min past exp during clock skew
const TABLES = new Set([
  'students', 'teams', 'results', 'gallery', 'glocal_ledger', 'schedule',
  'programs', 'audit_log',
]);
const MAX_TOOL_TURNS = 8;
const MODEL = 'gemini-2.5-flash';
const BUCKETS = { results: 'results', gallery: 'gallery' };

/* ----------------------------- jwt verify ----------------------------- */

function b64urlFromBytes(bytes) {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function bytesFromB64url(s) {
  const pad = s.length % 4 ? '='.repeat(4 - (s.length % 4)) : '';
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function verifyJwt(token, secret) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return null;
  const sig = bytesFromB64url(parts[2]);
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const expected = new Uint8Array(
    await crypto.subtle.sign('HMAC', key, enc.encode(parts[0] + '.' + parts[1]))
  );
  if (expected.length !== sig.length) return null;
  for (let i = 0; i < expected.length; i++) if (expected[i] !== sig[i]) return null;
  const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')) || '{}');
  const now = Math.floor(Date.now() / 1000);
  if (!payload.exp || payload.exp < now - TTL_GRACE_SEC) return null;
  return payload;
}

/* ------------------------------- http ------------------------------- */

function json(status, obj) {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Cache-Control': 'no-store',
  };
  return new Response(JSON.stringify(obj), { status, headers });
}

const ipCounts = new Map();
function limiter(ip, max, winMs) {
  const now = Date.now();
  const hist = (ipCounts.get(ip) || []).filter((t) => now - t < winMs);
  hist.push(now);
  ipCounts.set(ip, hist);
  if (ipCounts.size > 5000) ipCounts.clear();
  return hist.length > max;
}
function clientIp(req) {
  return req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || 'unknown';
}

/* --------------------------- data access --------------------------- */

function pgUrl(table, opts) {
  const params = ['select=' + (opts.select || '*')];
  const order = opts.order || 'created_at';
  const dir = opts.ascending ? 'asc' : 'desc';
  params.push('order=' + order + '.' + dir + '.nullslast');
  if (opts.limit != null) params.push('limit=' + Number(opts.limit));
  if (opts.offset != null) params.push('offset=' + Number(opts.offset));
  if (opts.filters) {
    for (const col of Object.keys(opts.filters)) {
      const f = opts.filters[col];
      if (f === null || f === undefined || f === '') continue;
      if (typeof f === 'object') {
        for (const op of Object.keys(f)) params.push(col + '=' + op + '.' + encodeURIComponent(f[op]));
      } else {
        params.push(col + '=eq.' + encodeURIComponent(String(f)));
      }
    }
  }
  return `${Deno.env.get('SUPABASE_URL')}/rest/v1/${table}?${params.join('&')}`;
}

const restHeaders = (auth) => ({ apikey: Deno.env.get('SUPABASE_ANON_KEY'), Authorization: 'Bearer ' + auth, 'Content-Type': 'application/json' });

async function pgGet(table, opts, auth) {
  const res = await fetch(pgUrl(table, opts), { headers: restHeaders(auth) });
  if (!res.ok) throw new Error('Read failed (' + res.status + ')');
  return res.json();
}

async function pgInsert(table, row, auth) {
  const res = await fetch(`${Deno.env.get('SUPABASE_URL')}/rest/v1/${table}`, {
    method: 'POST',
    headers: { ...restHeaders(auth), Prefer: 'return=representation' },
    body: JSON.stringify(row),
  });
  if (!res.ok) throw new Error('Insert failed (' + res.status + ')');
  return (await res.json())[0];
}

async function pgUpdate(table, id, patch, auth) {
  const res = await fetch(`${Deno.env.get('SUPABASE_URL')}/rest/v1/${table}?id=eq.${id}`, {
    method: 'PATCH',
    headers: { ...restHeaders(auth), Prefer: 'return=representation' },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error('Update failed (' + res.status + ')');
  return (await res.json())[0];
}

async function pgDelete(table, id, auth) {
  const res = await fetch(`${Deno.env.get('SUPABASE_URL')}/rest/v1/${table}?id=eq.${id}`, {
    method: 'DELETE',
    headers: restHeaders(auth),
  });
  if (!res.ok) throw new Error('Delete failed (' + res.status + ')');
}

function cleanName(raw) {
  return String(raw || '').replace(/\s+/g, ' ').trim();
}
function ordinal(n) {
  n = Number(n);
  if (n === 1) return 'st';
  if (n === 2) return 'nd';
  if (n === 3) return 'rd';
  return 'th';
}

async function audit(auth, action, entityType, entityId, entityName, detail) {
  try {
    await pgInsert('audit_log', {
      actor: 'bot',
      action: String(action || 'action'),
      entity_type: entityType || null,
      entity_id: entityId != null ? String(entityId) : null,
      entity_name: entityName != null ? String(entityName) : null,
      detail: detail ? JSON.parse(JSON.stringify(detail)) : null,
    }, auth);
  } catch (e) { /* audit must never break the reply */ }
}

function checkNotPaused() {
  return Deno.env.get('BOT_WRITES') === 'paused';
}

/* ------------------------------ tools ------------------------------ */

/* Mirrors db.js deleteResult + reverseAwards so the bot and the UI agree. */
async function toolDeleteResult(auth, args) {
  if (checkNotPaused()) return { paused: true, note: 'Writes are paused (BOT_WRITES=paused).' };
  const id = String(args.id || '');
  if (!id) throw new Error('Missing result id');
  const rows = await pgGet('results', { filters: { id } }, auth).catch(async () => {
    const all = await pgGet('results', { limit: 1000, order: 'created_at', ascending: false }, auth);
    return all.filter((r) => String(r.id) === id);
  });
  const row = rows[0];
  if (!row) throw new Error('Result #' + id + ' not found');

  const summary = row.places ? await reverseAwards(auth, row) : { teamPts: 0, champPts: 0, coins: 0, students: 0 };

  if (row.poster_path) {
    try {
      await fetch(
        `${Deno.env.get('SUPABASE_URL')}/storage/v1/object/${BUCKETS.results}/${row.poster_path.split('/').map(encodeURIComponent).join('/')}`,
        { method: 'DELETE', headers: restHeaders(auth) }
      );
    } catch (e) { /* best effort */ }
  }
  await pgDelete('results', id, auth);
  await audit(auth, 'result.delete', 'results', id, row.event_name, {
    summary, actor_note: 'via bot', participant_name: row.participant_name,
  });
  return { deleted: String(id), event: row.event_name, summary };
}

async function reverseAwards(auth, result) {
  const students = await pgGet('students', { order: 'name', ascending: true }, auth);
  const teams = await pgGet('teams', { order: 'name', ascending: true }, auth);
  const sByName = new Map(students.map((s) => [cleanName(s.name).toLowerCase(), s]));
  const tByName = new Map(teams.map((t) => [t.name.toLowerCase(), t]));

  const teamDeltas = {};
  const studentDeltas = [];
  for (const place of result.places || []) {
    if (!place.participant_name || !place.rank) continue;
    const pts = result.points ? result.points[String(place.rank)] : 0;
    const coins = Math.max(0, Math.floor(+place.coins || 0));
    const student = sByName.get(cleanName(place.participant_name).toLowerCase());
    if (pts && student && student.team) {
      const team = tByName.get(String(student.team).toLowerCase());
      if (team) teamDeltas[team.id] = (teamDeltas[team.id] || 0) + Number(pts);
    }
    if (student) {
      studentDeltas.push({
        id: student.id, champPts: Number(pts) || 0, coins,
        reason: 'Result removed ' + place.rank + ordinal(place.rank) + ' in ' + result.event_name,
      });
    }
  }

  const summary = { teamPts: 0, champPts: 0, coins: 0, students: studentDeltas.length };
  for (const [teamId, delta] of Object.entries(teamDeltas)) {
    const team = teams.find((t) => String(t.id) === String(teamId));
    if (!team) continue;
    const next = Math.max(0, Number(team.points) - delta);
    if (next !== Number(team.points)) {
      await pgUpdate('teams', team.id, { points: next }, auth);
      summary.teamPts += delta;
    }
  }
  for (const u of studentDeltas) {
    const st = students.find((s) => String(s.id) === String(u.id));
    if (!st) continue;
    if (u.champPts) {
      const next = Math.max(0, Number(st.points) - u.champPts);
      if (next !== Number(st.points)) {
        await pgUpdate('students', st.id, { points: next }, auth);
        summary.champPts += u.champPts;
      }
    }
    if (u.coins) {
      const next = Math.max(0, Number(st.coins) - u.coins);
      if (next !== Number(st.coins)) {
        await pgUpdate('students', st.id, { coins: next }, auth);
        await pgInsert('glocal_ledger', {
          student_id: st.id, delta: -u.coins, reason: u.reason, channel: 'bot',
        }, auth);
        summary.coins += u.coins;
      }
    }
  }
  return summary;
}

async function toolDeleteStudent(auth, args) {
  if (checkNotPaused()) return { paused: true, note: 'Writes are paused (BOT_WRITES=paused).' };
  const id = String(args.id || '');
  if (!id) throw new Error('Missing student id');
  const rows = await pgGet('students', { filters: { id } }, auth).catch(async () => []);
  const student = rows[0];
  await pgDelete('students', id, auth);
  await audit(auth, 'student.delete', 'students', id, student ? student.name : null, { name: student ? student.name : null, actor_note: 'via bot' });
  return { deleted: String(id), name: student ? student.name : null };
}

async function toolAwardCoins(auth, args) {
  if (checkNotPaused()) return { paused: true, note: 'Writes are paused (BOT_WRITES=paused).' };
  const id = String(args.student_id || '');
  const amt = Math.max(0, Math.floor(+args.amount || 0));
  if (!id) throw new Error('Missing student_id');
  if (!amt) throw new Error('Amount must be at least 1');
  const reason = cleanName(args.reason) || 'Award';
  const rows = await pgGet('students', { filters: { id } }, auth).catch(async () => []);
  const student = rows[0];
  if (!student) throw new Error('Student #' + id + ' not found');
  await pgUpdate('students', id, { coins: Number(student.coins) + amt }, auth);
  await pgInsert('glocal_ledger', { student_id: id, delta: amt, reason, channel: 'award' }, auth);
  await audit(auth, 'coins.award', 'students', id, reason, { amount: amt, actor_note: 'via bot' });
  return { awarded: amt, student: student.name, new_balance: Number(student.coins) + amt };
}

async function toolAdjustPoints(auth, args) {
  if (checkNotPaused()) return { paused: true, note: 'Writes are paused (BOT_WRITES=paused).' };
  const id = String(args.student_id || '');
  const delta = Math.floor(+args.delta || 0);
  if (!id || delta === 0) throw new Error('Need student_id and a non-zero delta');
  const reason = cleanName(args.reason) || 'Bot adjustment';
  const rows = await pgGet('students', { filters: { id } }, auth).catch(async () => []);
  const student = rows[0];
  if (!student) throw new Error('Student #' + id + ' not found');
  const next = Math.max(0, Number(student.points) + delta);
  await pgUpdate('students', id, { points: next }, auth);
  await audit(auth, 'student.points.adjust', 'students', id, student.name, { delta, reason, actor_note: 'via bot' });
  return { student: student.name, points_before: student.points, points_after: next };
}

async function toolGetTable(auth, args) {
  const table = String(args.table || '').trim();
  if (!TABLES.has(table)) throw new Error('Unknown table. Allowed: ' + Array.from(TABLES).join(', '));
  const limit = Math.min(100, Math.max(1, +args.limit || 20));
  const filters = {};
  if (args.column && args.query) filters[args.column] = { ilike: '*' + String(args.query).replace(/\*/g, '') + '*' };
  const rows = await pgGet(table, { limit, filters }, auth);
  return { table, count: rows.length, rows };
}

async function toolStudentWallet(auth, args) {
  const q = cleanName(args.name || args.id || '').toLowerCase();
  if (!q) throw new Error('Pass a name (or id) to look up.');
  const students = await pgGet('students', { order: 'name', ascending: true }, auth);
  const student = students.find((s) => String(s.id).toLowerCase() === q) ||
    students.find((s) => cleanName(s.name).toLowerCase() === q);
  if (!student) throw new Error('No student matches "' + q + '".');
  const ledger = await pgGet('glocal_ledger', { filters: { student_id: student.id }, limit: 30 }, auth);
  const results = await pgGet('results', { limit: 300 }, auth);
  const won = results.filter((r) => (r.places || []).some(
    (p) => cleanName(p.participant_name).toLowerCase() === cleanName(student.name).toLowerCase()
  ) || cleanName(r.participant_name).toLowerCase() === cleanName(student.name).toLowerCase());
  return {
    student: { id: student.id, name: student.name, team: student.team, category: student.category, points: student.points, coins: student.coins, roster_no: student.roster_no, qr_token: student.qr_token },
    ledger,
    results_won: won.map((r) => ({ id: r.id, event: r.event_name, category: r.category })),
  };
}

async function toolAnomalies(auth) {
  const students = await pgGet('students', { order: 'name', ascending: true }, auth);
  const teams = await pgGet('teams', { order: 'name', ascending: true }, auth);
  const results = await pgGet('results', { limit: 2000, order: 'created_at', ascending: false }, auth);
  const ledger = await pgGet('glocal_ledger', { limit: 5000, order: 'created_at', ascending: false }, auth);

  const sByName = new Map(students.map((s) => [cleanName(s.name).toLowerCase(), s]));
  const issues = [];

  const unmatched = [];
  for (const r of results || []) {
    const names = new Set();
    (r.places || []).forEach((p) => p && p.participant_name && names.add(cleanName(p.participant_name).toLowerCase()));
    if (r.participant_name) names.add(cleanName(r.participant_name).toLowerCase());
    names.forEach((n) => { if (n && !sByName.has(n)) unmatched.push({ id: r.id, event: r.event_name, name: n }); });
  }
  if (unmatched.length) issues.push({ sev: 'high', type: 'unmatched winner name', count: unmatched.length, sample: unmatched.slice(0, 5) });

  const seen = new Map();
  for (const r of results || []) {
    const key = [cleanName(r.event_name), cleanName(r.category), cleanName(r.participant_name)].join('|');
    if (!seen.has(key)) seen.set(key, []);
    seen.get(key).push(r.id);
  }
  const dupes = Array.from(seen.values()).filter((a) => a.length > 1);
  if (dupes.length) issues.push({ sev: 'high', type: 'duplicate result posters', count: dupes.length, ids: dupes });

  const negatives = students.filter((s) => (+s.coins || 0) < 0 || (+s.points || 0) < 0);
  if (negatives.length) issues.push({ sev: 'high', type: 'negative balance', count: negatives.length, sample: negatives.map((s) => s.name) });

  const ledgerSum = {};
  (ledger || []).forEach((l) => { ledgerSum[l.student_id] = (ledgerSum[l.student_id] || 0) + (+l.delta || 0); });
  const walletMismatch = students.filter((s) => (+s.coins || 0) !== (ledgerSum[s.id] || 0))
    .sort((a, b) => Math.abs((+b.coins || 0) - (ledgerSum[b.id] || 0)) - Math.abs((+a.coins || 0) - (ledgerSum[a.id] || 0)))
    .slice(0, 10)
    .map((s) => ({ name: s.name, coins: s.coins, ledger: ledgerSum[s.id] || 0 }));
  if (walletMismatch.length) issues.push({ sev: 'med', type: 'wallet vs ledger mismatch', count: walletMismatch.length, sample: walletMismatch });

  const pending = (results || []).filter((r) => r.published === false).map((r) => r.id);
  if (pending.length) issues.push({ sev: 'med', type: 'unpublished results', count: pending.length, ids: pending });

  const tByName = new Map(teams.map((t) => [t.name.toLowerCase(), t]));
  const expected = {};
  for (const r of results || []) {
    for (const pl of r.places || []) {
      if (!pl.participant_name || !pl.rank) continue;
      const st = sByName.get(cleanName(pl.participant_name).toLowerCase());
      const pts = r.points ? +r.points[String(pl.rank)] || 0 : 0;
      if (pts && st && st.team) {
        const t = tByName.get(String(st.team).toLowerCase());
        if (t) expected[t.id] = (expected[t.id] || 0) + pts;
      }
    }
  }
  const drift = teams.filter((t) => Math.round((expected[t.id] || 0) - (+t.points || 0)) !== 0)
    .map((t) => ({ team: t.name, table: t.points, recomputed: expected[t.id] || 0 }));
  if (drift.length) issues.push({ sev: 'high', type: 'team points drift', count: drift.length, sample: drift });

  return issues.length ? { count: issues.length, issues } : { count: 0, issues: [], note: 'All clear.' };
}

const WRITE_TOOLS = {
  delete_result: toolDeleteResult,
  delete_student: toolDeleteStudent,
  award_coins: toolAwardCoins,
  adjust_student_points: toolAdjustPoints,
};

async function runTool(auth, role, name, args) {
  switch (name) {
    case 'get_table': return { ok: true, result: await toolGetTable(auth, args) };
    case 'student_wallet': return { ok: true, result: await toolStudentWallet(auth, args) };
    case 'run_anomalies': return { ok: true, result: await toolAnomalies(auth) };
    case 'execute_admin_write': {
      if (role !== 'super') return { ok: false, result: { error: 'Writes are super-admin only. Your role: ' + role } };
      const fn = WRITE_TOOLS[String(args.action || '')];
      if (!fn) return { ok: false, result: { error: 'Unknown write action. Allowed: ' + Object.keys(WRITE_TOOLS).join(', ') } };
      return { ok: true, result: await fn(auth, args.payload || {}) };
    }
    default: return { ok: false, result: { error: 'Unknown tool: ' + name } };
  }
}

/* ---------------------------- gemini call ---------------------------- */

const SYSTEM_INSTRUCTION = `You are the Rendezvous '26 supervisor assistant, embedded in the owner's private console.

DATA MODEL
- students: id, name, team, category (Minor/Premier/Sub junior/General), points (champion points), coins (spendable wallet), roster_no, qr_token.
- teams: id, name, points (team stand tables).
- results: id, event_name, category, participant_name, rank, poster_path, places[] (rank, participant_name, grade, coins), points map like {"1":10,"2":7,"3":5}, published.
- glocal_ledger: student_id, delta, reason, channel (award / store / bot).
- gallery / schedule / programs / audit_log (actor, action, entity_* , detail, created_at).

Awarding rules: each rank gives team points (per result.points), the podium student gets champion points + coins (their place.coins). Deleting a result reverses all of it (clamped at zero).

TOOLS
- get_table (read exact rows from whitelisted tables — prefer student_wallet over raw scans for people).
- student_wallet (full picture: student + ledger + results won).
- run_anomalies (duplicates, unmatched winner names, negatives, wallet vs ledger, unpublished, team drift).
- execute_admin_write (super admin only; every write is audited as actor "bot"). Actions: delete_result, delete_student, award_coins, adjust_student_points.

RULES
1. Answer only from live tool data. Never invent numbers, names or balances.
2. If data is asked about but tools are missing/error, say you could not verify it.
3. Be concise and useful: smallest answer that fully answers the question.
4. If a user asks for a change (delete a result, adjust coins...) use execute_admin_write and report exactly what changed (audit summary).
5. Use run_anomalies when asked about problems, anomalies, discrepancies, or "check everything".
6. Money comes from coins only; points are separate. Confirm which one the user means if unclear.
7. Current date: ${new Date().toISOString()}.`;

const TOOLS = [
  {
    functionDeclarations: [
      {
        name: 'get_table',
        description: 'Query exact rows from a table. Use only select=* semantics. Returns up to 100 rows.',
        parameters: {
          type: 'OBJECT',
          properties: {
            table: { type: 'STRING', enum: Array.from(TABLES), description: 'table to read' },
            column: { type: 'STRING', description: 'column to filter on' },
            query: { type: 'STRING', description: 'substring to search for (case-insensitive)' },
            limit: { type: 'INTEGER', description: 'rows to return (max 100)' },
          },
          required: ['table'],
        },
      },
      {
        name: 'student_wallet',
        description: 'Get one student by name or id with their full wallet: ledger history and results won.',
        parameters: {
          type: 'OBJECT',
          properties: {
            name: { type: 'STRING', description: "student's exact name or numeric id" },
            id: { type: 'STRING', description: "numeric student id (or pass in name)" },
          },
        },
      },
      {
        name: 'run_anomalies',
        description: 'Scan the whole event for anomalies: duplicate posters, winner names that match no student, negative balances, wallet vs ledger mismatches, unpublished results, team points drift.',
        parameters: { type: 'OBJECT', properties: {} },
      },
      {
        name: 'execute_admin_write',
        description: 'Super-admin write. Performs a real change and always writes an audit_log row (actor "bot"). Actions: delete_result {id,poster_path?}, delete_student {id}, award_coins {student_id,amount,reason}, adjust_student_points {student_id,delta,reason}.',
        parameters: {
          type: 'OBJECT',
          properties: {
            action: { type: 'STRING', enum: ['delete_result', 'delete_student', 'award_coins', 'adjust_student_points'] },
            payload: { type: 'OBJECT', description: 'action-specific arguments (see description)' },
          },
          required: ['action'],
        },
      },
    ],
  },
];

async function geminiTurn(contents, key) {
  const body = {
    systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
    contents,
    tools: TOOLS,
    toolConfig: { functionCallingConfig: { mode: 'AUTO' } },
    generationConfig: { temperature: 0.3, maxOutputTokens: 4096 },
  };
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${key}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error('Gemini error (' + res.status + '): ' + txt.slice(0, 300));
  }
  const data = await res.json();
  if (!data.candidates || !data.candidates.length) {
    const hint = data.promptFeedback && data.promptFeedback.blockReason;
    throw new Error('Gemini returned nothing' + (hint ? ' (blocked: ' + hint + ')' : '.'));
  }
  return data.candidates[0].content.parts || [];
}

/* -------------------------------- main -------------------------------- */

export default async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return json(200, { ok: true });
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' });

  const ip = clientIp(req);
  if (limiter(ip, 240, 60 * 1000)) return json(429, { error: 'Rate limited. Slow down.' });

  const secret = Deno.env.get('JWT_SECRET');
  const geminiKey = Deno.env.get('GEMINI_API_KEY');
  if (!secret || !geminiKey) return json(503, { error: 'chat is not configured yet (set JWT_SECRET and GEMINI_API_KEY).' });

  const authHeader = String(req.headers.get('authorization') || '');
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  const payload = token ? await verifyJwt(token, secret) : null;
  if (!payload) return json(401, { error: 'Your session is missing or expired. Re-enter the access code.' });
  const role = String(payload.rv26_role || '');

  let body: { messages?: { role?: string; content?: string }[] } = {};
  try {
    body = await req.json();
  } catch (e) {
    return json(400, { error: 'Malformed request' });
  }
  const messages = (body.messages || []).filter(
    (m) => m && typeof m.content === 'string' && ['user', 'model'].includes(m.role || '')
  );
  if (!messages.length) return json(400, { error: 'Send at least one message.' });

  const contents = messages.map((m) => ({ role: m.role === 'model' ? 'model' : 'user', parts: [{ text: m.content.slice(0, 4000) }] }));

  try {
    for (let turn = 0; turn < MAX_TOOL_TURNS; turn++) {
      const parts = await geminiTurn(contents, geminiKey);
      const text = parts.filter((p: any) => p.text).map((p: any) => p.text).join('');
      const calls = parts.filter((p: any) => p.functionCall);

      if (!calls.length) {
        return json(200, { reply: text || '(no reply)', role });
      }

      contents.push({ role: 'model', parts: calls.map((c: any) => ({ functionCall: c.functionCall })) });

      const responses = [];
      for (const call of calls) {
        const fn = call.functionCall;
        let out;
        try {
          const r = await runTool(token, role, fn.name, fn.args || {});
          out = r.ok ? { ok: true, data: r.result } : { ok: false, error: (r.result && r.result.error) || 'Tool failed' };
        } catch (e: any) {
          out = { ok: false, error: String((e && e.message) || e) };
        }
        responses.push({ functionResponse: { name: fn.name, response: out } });
      }
      contents.push({ role: 'function', parts: responses });
    }
    return json(200, { reply: 'I could not finish reasoning within the tool loop. Ask again or rephrase.', role, truncated: true });
  } catch (e: any) {
    return json(500, { error: String((e && e.message) || e) });
  }
};