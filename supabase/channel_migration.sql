-- Tags every coin ledger row with a channel so the bookstall counter view
-- (store purchases/top-ups, channel 'store') can be told apart from
-- automated result awards (channel 'award') and manual adjustments
-- (channel 'adjust'). Backfills existing rows to the store channel.
alter table public.glocal_ledger
  add column if not exists channel text not null default 'store';

update public.glocal_ledger set channel = 'store' where channel is null;