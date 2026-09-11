-- Rendezvous '26 — seed the On Stage event schedule (idempotent)
-- Only runs when the schedule table is empty, so admin edits are never overwritten.
-- Derives every row from the On Stage programmes in public.programs and assigns
-- indicative timings (editable in the admin Schedule tab).

insert into public.schedule (day, time, title, location, tag, position, section)
select
  case p.section_order when 1 then 1 when 2 then 1 when 3 then 2 when 4 then 2 end as day,
  case
    when p.section_order in (1, 3) and p.position = 1 then '09:00'
    when p.section_order in (1, 3) and p.position = 2 then '09:45'
    when p.section_order in (1, 3) and p.position = 3 then '10:30'
    when p.section_order in (1, 3) and p.position = 4 then '11:15'
    when p.section_order in (1, 3) and p.position = 5 then '12:00'
    when p.section_order in (1, 3) and p.position = 6 then '12:45'
    when p.section_order in (1, 3) and p.position = 7 then '13:30'
    when p.section_order in (2, 4) and p.position = 1 then '14:00'
    when p.section_order in (2, 4) and p.position = 2 then '14:45'
    when p.section_order in (2, 4) and p.position = 3 then '15:30'
    when p.section_order in (2, 4) and p.position = 4 then '16:15'
    else '17:00'
  end as time,
  p.name as title,
  null as location,
  null as tag,
  p.position as position,
  p.section as section
from public.programs p
where p.stage = 'On Stage'
  and not exists (select 1 from public.schedule limit 1)
order by p.section_order, p.position;