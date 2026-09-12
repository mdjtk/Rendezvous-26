/*
 * Rendezvous '26 — local opencode bridge
 *
 * The on-your-PC half of the hybrid supervisor assistant. Exposes a tiny
 * HTTP API (default http://127.0.0.1:4888) that the Super Admin console
 * can reach. Each question is forwarded to `opencode run` executed inside
 * the repo, so the assistant can read the codebase AND query the live
 * Supabase data itself (node/curl + the anon key from js/config.js).
 *
 * Run from the project root:  npm run bridge
 * Endpoints:
 *   GET  /health   → { ok: true }
 *   POST /message  → { message, history? } → { reply }
 */
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';

const PORT = Number(process.env.PORT || 4888);
const TIMEOUT_MS = 3 * 60 * 1000;

let busy = false;

function readConfig() {
  try {
    const src = readFileSync('js/config.js', 'utf8');
    const url = (src.match(/SUPABASE_URL\s*[:=]\s*["']([^"']+)/) || [])[1] || '?';
    const key = (src.match(/SUPABASE_ANON_KEY\s*[:=]\s*["']([^"']+)/) || [])[1] || '?';
    return { url, key };
  } catch (e) {
    return { url: '(config unreadable)', key: '(config unreadable)' };
  }
}

const PREAMBLE = `You are the Rendezvous '26 supervisor assistant running locally through opencode.
You have live access to this project's files and, via your bash tool, to its real data:
- Supabase URL: ${readConfig().url}
- anon key: ${readConfig().key}. Use it as the 'apikey' header (reads are public; writes need a staff JWT — if an authenticated action is required, say so instead of guessing).
Live data also includes: js/db.js (data layer), js/superadmin.js (supervisor console), supabase/* (schema, edge functions).
Query tables like: curl -s -H "apikey: $KEY" "$URL/rest/v1/students?select=*"
Rules:
1. Answer from real data you fetched. Never invent numbers, names or balances.
2. If you cannot verify something, say so plainly.
3. Be concise — the user wants the answer, not a tour.
4. If the user asks for a risky change, explain exactly what it would do and ask for confirmation first.`;

function runOpencode(message, history) {
  return new Promise((resolve, reject) => {
    const lines = [PREAMBLE];
    if (Array.isArray(history) && history.length) {
      lines.push('Earlier conversation (oldest first):');
      for (const m of history.slice(-12)) {
        lines.push(`— user: ${String(m.content || '').slice(0, 1500)}`);
      }
    }
    lines.push(`User says: ${String(message).slice(0, 4000)}`);
    lines.push('Reply with ONLY the final answer to the user, no preamble, no triple-backticks wrapper, max ~500 words.');

    const prompt = lines.join('\n\n');

    let child;
    try {
      child = spawn('opencode', ['run', prompt], {
        cwd: process.cwd(),
        stdio: ['ignore', 'pipe', 'pipe'],
        env: process.env,
        windowsHide: true,
        shell: process.platform === 'win32' ? true : false,
      });
    } catch (e) {
      reject(new Error('Could not start opencode: ' + e.message));
      return;
    }

    let out = '';
    let err = '';
    const timer = setTimeout(() => {
      try { child.kill(); } catch (e) { /* */ }
      reject(new Error('opencode timed out after ' + TIMEOUT_MS / 1000 + 's. Try a shorter question.'));
    }, TIMEOUT_MS);

    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });

    child.on('error', (e) => {
      clearTimeout(timer);
      reject(new Error('opencode failed to launch — is it installed and in PATH? (' + e.message + ')'));
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      const raw = (out || '').trim();
      let reply = raw.split(/\r?\n/)
        .filter((l) => !/^(\s*persona|Task \d|Mode:|\s*●)/.test(l))
        .join('\n')
        .trim();
      if (!reply && err.trim()) reply = (code === 0 ? '' : 'opencode exited (' + code + ').\n') + err.trim().slice(-1500);
      resolve(reply || '(empty reply — opencode returned nothing. Try again or switch to ☁ Gemini.)');
    });
  });
}

function json(res, status, obj) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'content-type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(obj));
}

const server = createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return json(res, 200, { ok: true });

  if (req.url === '/health' && req.method === 'GET') {
    return json(res, 200, { ok: true, busy });
  }

  if (req.url === '/message' && req.method === 'POST') {
    let bodyText = '';
    for await (const chunk of req) bodyText += chunk;
    let body = {};
    try { body = JSON.parse(bodyText || '{}'); } catch (e) { body = {}; }
    const message = String(body.message || '').trim();
    if (!message) return json(res, 400, { error: 'Missing message' });
    if (busy) return json(res, 429, { error: 'A previous question is still running. Wait for it to finish.' });

    busy = true;
    const started = Date.now();
    try {
      const reply = await runOpencode(message, body.history || []);
      json(res, 200, { reply, ms: Date.now() - started });
    } catch (e) {
      json(res, 500, { error: String((e && e.message) || e) });
    } finally {
      busy = false;
    }
    return;
  }

  json(res, 404, { error: 'Not found. Use GET /health or POST /message.' });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[bridge] opencode relay on http://127.0.0.1:${PORT} (busy=false)`);
  const cfg = readConfig();
  console.log(`[bridge] repo cwd: ${process.cwd()}`);
  console.log(`[bridge] supabase: ${cfg.url}`);
});