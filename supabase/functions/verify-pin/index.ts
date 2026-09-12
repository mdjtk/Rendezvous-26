/*
 * Rendezvous '26 — /verify-pin Edge Function
 *
 * Turns the admin/store PIN into a short-lived JWT that PostgREST accepts,
 * so write policies can be enforced server-side via the `rv26_role` claim.
 * The PIN is never shipped to the browser and is never sent again after
 * login. Brute-force attempts are throttled best-effort (Edge Functions are
 * stateless, so this is per-instance only).
 *
 * Deploy steps (from project root):
 *   supabase functions deploy verify-pin
 *   supabase secrets set \
 *     ADMIN_PIN_HASH=<sha256 of "rv26:admin:<pin>"> \
 *     STORE_PIN_HASH=<sha256 of "rv26:store:<pin>"> \
 *     BOOKSTALL_PIN_HASH=<sha256 of "rv26:bookstall:<pin>"> \
 *     SUPER_PIN_HASH=<sha256 of "rv26:super:<pin>"> \
 *     JWT_SECRET=<Dashboard -> Settings -> API -> JWT Secret>
 *
 * The owner ("super") role is optional — omit SUPER_PIN_HASH to disable it.
 * Unlike admin/store/bookstall, the super PIN is never verifiable client-side.
 *
 * Mint sample hashes with:  node supabase/generate-pins.mjs
 */

const TTL_SECONDS = 8 * 60 * 60; // 8h session, PIN rarely re-entered
const MAX_FAILED = 6;            // per IP / 5 min window
const WINDOW_MS = 5 * 60 * 1000;

const enc = new TextEncoder();
const attempts = new Map();

function b64urlFromBytes(bytes) {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64url(input) {
  return b64urlFromBytes(enc.encode(input));
}

async function sha256Hex(text) {
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(text));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function signJwt(payload, secret) {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify(payload));
  const data = header + '.' + body;
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(data));
  return data + '.' + b64urlFromBytes(new Uint8Array(sig));
}

function json(status, obj) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Cache-Control': 'no-store',
    },
  });
}

function clientIp(req) {
  return (
    req.headers.get('x-forwarded-for') ||
    req.headers.get('x-real-ip') ||
    'unknown'
  );
}

function throttled(ip) {
  const now = Date.now();
  const rec = attempts.get(ip) || { failTimes: [], last: 0 };
  rec.failTimes = rec.failTimes.filter((t) => now - t < WINDOW_MS);
  const over = rec.failTimes.length >= MAX_FAILED;
  // reset the counter after a quiet window
  if (!over && now - rec.last > WINDOW_MS) rec.failTimes = [];
  attempts.set(ip, rec);
  return { rec, over };
}

async function recordFailure(ip) {
  const { rec } = throttled(ip);
  rec.failTimes.push(Date.now());
  rec.last = Date.now();
}

export default async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return json(200, { ok: true });

  const ip = clientIp(req);
  const { over } = throttled(ip);
  if (over) return json(429, { error: 'Too many attempts. Wait a few minutes.' });

  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' });

  const secret = Deno.env.get('JWT_SECRET');
  const adminHash = Deno.env.get('ADMIN_PIN_HASH');
  const storeHash = Deno.env.get('STORE_PIN_HASH');
  const bookstallHash = Deno.env.get('BOOKSTALL_PIN_HASH');
  const superHash = Deno.env.get('SUPER_PIN_HASH');
  if (!secret || !adminHash || !storeHash || !bookstallHash) {
    return json(503, { error: 'verify-pin is not configured yet (set ADMIN_PIN_HASH, STORE_PIN_HASH, BOOKSTALL_PIN_HASH, JWT_SECRET).' });
  }

  let body: { pin?: string } = {};
  try {
    body = await req.json();
  } catch (e) {
    return json(400, { error: 'Malformed request' });
  }
  const pin = String(body.pin || '').trim();
  if (!pin) return json(400, { error: 'Enter an access code.' });

  let role: string | null = null;
  if ((await sha256Hex('rv26:admin:' + pin)) === adminHash) role = 'admin';
  else if ((await sha256Hex('rv26:store:' + pin)) === storeHash) role = 'store';
  else if ((await sha256Hex('rv26:bookstall:' + pin)) === bookstallHash) role = 'bookstall';
  else if (superHash && (await sha256Hex('rv26:super:' + pin)) === superHash) role = 'super';

  if (!role) {
    await recordFailure(ip);
    return json(401, { error: 'Incorrect access code.' });
  }

  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + TTL_SECONDS;
  const payload = {
    sub: role,
    role: 'authenticated',
    iat: now,
    exp: expiresAt,
    rv26_role: role,
  };
  const token = await signJwt(payload, secret);

  // keep nonce/attempt map from growing forever
  if (attempts.size > 5000) attempts.clear();

  return json(200, { token, role, expires_at: expiresAt * 1000 });
};