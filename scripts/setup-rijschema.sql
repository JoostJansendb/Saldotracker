-- Rijschema: per seizoen de wedstrijden met rijders, voorheen hardcoded in app/page.tsx.
-- Dit bestand is opnieuw te draaien: alles is idempotent.

-- 1. De wedstrijden zelf. Kilometers blijven leeg bij een thuiswedstrijd.
create table if not exists public.ride_schedule (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  season text not null,
  match_date date not null,
  team text not null,
  location text not null,
  kilometers integer,
  riders text[] not null default '{}'
);

alter table public.ride_schedule
  drop constraint if exists ride_schedule_location_check;

alter table public.ride_schedule
  add constraint ride_schedule_location_check
  check (location in ('uit', 'thuis'));

-- Een team speelt per seizoen maar een keer op dezelfde datum: dat maakt de insert hieronder herhaalbaar.
create unique index if not exists ride_schedule_season_date_team_idx
  on public.ride_schedule (season, match_date, team);

-- 2. Iedereen die is ingelogd mag het rijschema lezen; alleen een admin of dev mag het beheren.
alter table public.ride_schedule enable row level security;

drop policy if exists "Ride schedule is readable" on public.ride_schedule;
create policy "Ride schedule is readable"
on public.ride_schedule
for select
to authenticated
using (true);

drop policy if exists "Admins manage ride schedule" on public.ride_schedule;
create policy "Admins manage ride schedule"
on public.ride_schedule
for all
to authenticated
using (
  exists (
    select 1 from public.users u
    where u.id = auth.uid() and u.role in ('admin', 'dev')
  )
)
with check (
  exists (
    select 1 from public.users u
    where u.id = auth.uid() and u.role in ('admin', 'dev')
  )
);

-- 3. Realtime updates voor de nieuwe tabel, zoals bij users, transactions en fixed_charges.
do $$
begin
  alter publication supabase_realtime add table public.ride_schedule;
exception
  when duplicate_object then null;
end $$;

-- 4. Seizoen 2025-2026 en 2026-2027.
insert into public.ride_schedule (season, match_date, team, location, kilometers, riders)
values
  ('2025-2026', '2026-03-01', 'tilburg H7',      'uit',   34,   array['sewi', 'bram', 'olivier', 'hugo']),
  ('2025-2026', '2026-03-08', 'Don Quishoot H3', 'uit',   37,   array['brek', 'jonathan', 'joost', 'max']),
  ('2025-2026', '2026-03-15', 'Push H3',         'thuis', null, array[]::text[]),
  ('2025-2026', '2026-03-22', 'Push H4',         'uit',   21,   array['pepijn', 'sewi', 'timon', 'tim']),
  ('2025-2026', '2026-03-29', 'Rosmalen',        'thuis', null, array[]::text[]),
  ('2025-2026', '2026-04-12', 'Were Di H4',      'uit',   26,   array['tijn', 'pepijn', 'hugo', 'pieter']),
  ('2025-2026', '2026-04-19', 'Drunen',          'thuis', null, array[]::text[]),
  ('2025-2026', '2026-05-10', 'Best',            'thuis', null, array[]::text[]),
  ('2025-2026', '2026-05-17', 'Geel-Zwart',      'uit',   21,   array['tim', 'timon', 'pieter', 'jonathan']),
  ('2025-2026', '2026-05-31', 'Den Bosch',       'thuis', null, array[]::text[]),
  ('2025-2026', '2026-06-07', 'Oranje-Rood',     'uit',   43,   array['sam', 'tom', 'bas', 'thomas']),
  ('2025-2026', '2026-06-14', 'tilburg H7',      'thuis', null, array[]::text[]),
  ('2026-2027', '2026-09-06', 'DDHC H2-O',       'uit',   37,   array['bas', 'brek', 'tijn', 'olivier']),
  ('2026-2027', '2026-09-13', 'Zwart-Wit H5',    'thuis', null, array[]::text[]),
  ('2026-2027', '2026-09-20', 'Zwart-Wit H4',    'uit',   55,   array['hugo', 'matthijs', 'joost', 'thomas']),
  ('2026-2027', '2026-09-27', 'Drunen H2-O',     'thuis', null, array[]::text[]),
  ('2026-2027', '2026-10-04', 'Zevenbergen H1',  'uit',   65,   array['pepijn', 'sam', 'tim', 'pieter']),
  ('2026-2027', '2026-10-11', 'Push H5',         'uit',   51,   array['tom', 'bas', 'sewi', 'pieter']),
  ('2026-2027', '2026-11-01', 'Warande H4',      'thuis', null, array[]::text[]),
  ('2026-2027', '2026-11-08', 'DDHC H2-O',       'thuis', null, array[]::text[]),
  ('2026-2027', '2026-11-15', 'Zwart-Wit H5',    'uit',   55,   array['tijn', 'brek', 'thomas', 'olivier']),
  ('2026-2027', '2026-11-22', 'Zwart-Wit H6',    'thuis', null, array[]::text[])
on conflict (season, match_date, team) do update
set location = excluded.location,
    kilometers = excluded.kilometers,
    riders = excluded.riders;
