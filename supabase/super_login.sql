-- ============================================================
-- Rendezvous '26 — SQL login fallback (rv26_login RPC)
--
-- Provide a PII-free, server-side PIN check that does NOT depend
-- on the edge-function runtime. If /verify-pin is unreachable, the
-- browser falls back to POST /rest/v1/rpc/rv26_login. The function
-- is `security definer` so anon callers can never read the hashes:
-- they live in rv26_settings with RLS on and no policies.
--
-- Secrets are inserted separately (never committed):
--   INSERT INTO public.rv26_settings(key, value) VALUES
--     ('ADMIN_PIN_HASH','<hex>'), ('STORE_PIN_HASH','<hex>'),
--     ('BOOKSTALL_PIN_HASH','<hex>'), ('SUPER_PIN_HASH','<hex>'),
--     ('JWT_SECRET','<postgrest jwt secret>')
--   ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
--
-- Mint hashes with: node supabase/generate-pins.mjs
-- ============================================================

create extension if not exists pgcrypto;

create table if not exists public.rv26_settings (
  key text primary key,
  value text not null
);

alter table public.rv26_settings enable row level security;

create or replace function public.rv26_login(pin text)
returns jsonb
language plpgsql
security definer
set search_path = extensions, public, pg_catalog
as $$
declare
  role text := null;
  stored text;
  secret text := (select value from public.rv26_settings where key = 'JWT_SECRET');
  now_s bigint := floor(extract(epoch from now()));
  header text;
  payload text;
  payload64 text;
  data text;
  sig bytea;
  token text;
begin
  if pin is null or trim(pin) = '' then
    return jsonb_build_object('error', 'Enter an access code.', 'status', 400);
  end if;

  if secret is null then
    return jsonb_build_object('error', 'rv26_login is not configured yet.', 'status', 503);
  end if;

  stored := (select value from public.rv26_settings where key = 'ADMIN_PIN_HASH');
  if stored is not null and encode(digest('rv26:admin:' || pin, 'sha256'), 'hex') = stored then
    role := 'admin';
  end if;

  stored := (select value from public.rv26_settings where key = 'STORE_PIN_HASH');
  if role is null and stored is not null and encode(digest('rv26:store:' || pin, 'sha256'), 'hex') = stored then
    role := 'store';
  end if;

  stored := (select value from public.rv26_settings where key = 'BOOKSTALL_PIN_HASH');
  if role is null and stored is not null and encode(digest('rv26:bookstall:' || pin, 'sha256'), 'hex') = stored then
    role := 'bookstall';
  end if;

  stored := (select value from public.rv26_settings where key = 'SUPER_PIN_HASH');
  if role is null and stored is not null and encode(digest('rv26:super:' || pin, 'sha256'), 'hex') = stored then
    role := 'super';
  end if;

  if role is null then
    return jsonb_build_object('error', 'Incorrect access code.', 'status', 401);
  end if;

  header := replace(replace(replace(trim(trailing '=' from encode(convert_to('{"alg":"HS256","typ":"JWT"}', 'utf8'), 'base64')), chr(10)::text, ''), '+', '-'), '/', '_');
  payload := '{"sub":"' || role || '","role":"authenticated","iat":' || now_s || ',"exp":' || (now_s + 28800) || ',"rv26_role":"' || role || '"}';
  payload64 := replace(replace(replace(trim(trailing '=' from encode(convert_to(payload, 'utf8'), 'base64')), chr(10)::text, ''), '+', '-'), '/', '_');
  data := header || '.' || payload64;
  sig := hmac(data, secret, 'sha256');
  token := data || '.' || replace(replace(replace(trim(trailing '=' from encode(sig, 'base64')), chr(10)::text, ''), '+', '-'), '/', '_');

  return jsonb_build_object('token', token, 'role', role, 'expires_at', (now_s + 28800) * 1000);
end;
$$;

grant execute on function public.rv26_login(text) to anon, authenticated;