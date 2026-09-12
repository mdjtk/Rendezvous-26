-- ============================================================
-- Rendezvous '26 — security migration
-- Replaces every "writable by anyone" policy with claim-gated
-- policies. Writes now require a short-lived JWT minted by the
-- /verify-pin Edge Function, which carries the `rv26_role` claim.
--
-- Apply AFTER deploying the function and setting secrets:
--   supabase functions deploy verify-pin
--   supabase secrets set ADMIN_PIN_HASH=... STORE_PIN_HASH=... BOOKSTALL_PIN_HASH=... JWT_SECRET=...
-- Then run this file in the Supabase SQL editor.
-- ============================================================

-- ---------- Helper: who is the caller? ----------
create or replace function public.rv26_role() returns text
language sql stable
as $$
  select nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'rv26_role', '')
$$;

-- ---------- Remove the old open-write policies ----------
drop policy if exists "teams writable by anyone" on public.teams;
drop policy if exists "results writable by anyone" on public.results;
drop policy if exists "gallery writable by anyone" on public.gallery;
drop policy if exists "students writable by anyone" on public.students;
drop policy if exists "glocal_ledger writable by anyone" on public.glocal_ledger;
drop policy if exists "programs writable by anyone" on public.programs;
drop policy if exists "schedule writable by anyone" on public.schedule;

-- Idempotent: safe to run again / on a fresh schema.sql database
drop policy if exists "teams admin writes" on public.teams;
drop policy if exists "results admin writes" on public.results;
drop policy if exists "gallery admin writes" on public.gallery;
drop policy if exists "programs admin writes" on public.programs;
drop policy if exists "schedule admin writes" on public.schedule;
drop policy if exists "students staff insert" on public.students;
drop policy if exists "students staff update" on public.students;
drop policy if exists "students admin deletes" on public.students;
drop policy if exists "ledger staff inserts" on public.glocal_ledger;
drop policy if exists "ledger admin deletes" on public.glocal_ledger;
drop policy if exists "gallery admin uploads" on storage.objects;
drop policy if exists "gallery admin deletes" on storage.objects;
drop policy if exists "results admin uploads" on storage.objects;
drop policy if exists "results admin deletes" on storage.objects;
drop policy if exists "gallery public reads" on storage.objects;

-- ---------- Admin-only tables (points/results/teams/programs) ----------
create policy "teams admin writes" on public.teams
  for all to anon, authenticated
  using (public.rv26_role() = 'admin')
  with check (public.rv26_role() = 'admin');

create policy "results admin writes" on public.results
  for all to anon, authenticated
  using (public.rv26_role() = 'admin')
  with check (public.rv26_role() = 'admin');

create policy "gallery admin writes" on public.gallery
  for all to anon, authenticated
  using (public.rv26_role() = 'admin')
  with check (public.rv26_role() = 'admin');

create policy "programs admin writes" on public.programs
  for all to anon, authenticated
  using (public.rv26_role() = 'admin')
  with check (public.rv26_role() = 'admin');

create policy "schedule admin writes" on public.schedule
  for all to anon, authenticated
  using (public.rv26_role() = 'admin')
  with check (public.rv26_role() = 'admin');

-- ---------- Students: staff modify, admin only delete ----------
create policy "students staff insert" on public.students
  for insert to anon, authenticated
  with check (public.rv26_role() in ('admin', 'store', 'bookstall'));

create policy "students staff update" on public.students
  for update to anon, authenticated
  using (public.rv26_role() in ('admin', 'store', 'bookstall'))
  with check (public.rv26_role() in ('admin', 'store', 'bookstall'));

create policy "students admin deletes" on public.students
  for delete to anon, authenticated
  using (public.rv26_role() = 'admin');

-- ---------- Ledger: staff record entries, admin deletes ----------
create policy "ledger staff inserts" on public.glocal_ledger
  for insert to anon, authenticated
  with check (public.rv26_role() in ('admin', 'store', 'bookstall'));

create policy "ledger admin deletes" on public.glocal_ledger
  for delete to anon, authenticated
  using (public.rv26_role() = 'admin');

-- ---------- Storage: only admins upload/delete; keeps public reads ----------
drop policy if exists "public upload to gallery" on storage.objects;
drop policy if exists "public upload to results" on storage.objects;

create policy "gallery admin uploads" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'gallery' and public.rv26_role() = 'admin');

create policy "gallery admin deletes" on storage.objects
  for delete to authenticated
  using (bucket_id = 'gallery' and public.rv26_role() = 'admin');

create policy "results admin uploads" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'results' and public.rv26_role() = 'admin');

create policy "results admin deletes" on storage.objects
  for delete to authenticated
  using (bucket_id = 'results' and public.rv26_role() = 'admin');

create policy "gallery public reads" on storage.objects
  for select to anon, authenticated
  using (bucket_id in ('gallery', 'results'));