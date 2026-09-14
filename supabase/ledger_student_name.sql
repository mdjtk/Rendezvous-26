-- Add a denormalized student_name column to glocal_ledger, backfill it from
-- students, and keep it filled automatically on new inserts.
-- Run in the Supabase SQL Editor (or apply like the other sql files).

alter table public.glocal_ledger add column if not exists student_name text;

update public.glocal_ledger g
set student_name = s.name
from public.students s
where s.id = g.student_id
  and g.student_name is null;

create or replace function public.glocal_ledger_fill_name() returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  new.student_name := (select name from public.students where id = new.student_id);
  return new;
end $$;

drop trigger if exists glocal_ledger_fill_name on public.glocal_ledger;
create trigger glocal_ledger_fill_name
  before insert on public.glocal_ledger
  for each row execute function public.glocal_ledger_fill_name();