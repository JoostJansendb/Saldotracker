-- Topscoorders: per seizoen het aantal doelpunten per speler. De admin past ze aan op de statistiekenpagina.
-- Dit bestand is opnieuw te draaien: alles is idempotent.

-- 1. Eén rij per speler per seizoen. Wie nog nooit is aangepast heeft geen rij en telt als 0.
create table if not exists public.player_goals (
  season text not null,
  user_id uuid not null references public.users (id) on delete cascade,
  goals integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (season, user_id)
);

alter table public.player_goals
  drop constraint if exists player_goals_goals_check;

alter table public.player_goals
  add constraint player_goals_goals_check
  check (goals >= 0);

-- 2. Iedereen die is ingelogd mag de doelpunten lezen; alleen een admin of dev mag ze aanpassen.
alter table public.player_goals enable row level security;

drop policy if exists "Player goals are readable" on public.player_goals;
create policy "Player goals are readable"
on public.player_goals
for select
to authenticated
using (true);

drop policy if exists "Admins manage player goals" on public.player_goals;
create policy "Admins manage player goals"
on public.player_goals
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

-- 3. De plus en min van de app tellen op in de database in plaats van een nieuw totaal te sturen:
--    snel achter elkaar tikken of twee admins tegelijk levert zo nooit een verkeerd aantal op.
--    Onder 0 gaat het niet. Security invoker, dus de policies hierboven gelden ook hier.
create or replace function public.adjust_player_goals(p_season text, p_user_id uuid, p_delta integer)
returns integer
language sql
security invoker
set search_path = public
as $$
  insert into public.player_goals as g (season, user_id, goals)
  values (p_season, p_user_id, greatest(p_delta, 0))
  on conflict (season, user_id) do update
    set goals = greatest(g.goals + p_delta, 0),
        updated_at = now()
  returning g.goals;
$$;

revoke execute on function public.adjust_player_goals(text, uuid, integer) from public, anon;
grant execute on function public.adjust_player_goals(text, uuid, integer) to authenticated;

-- 4. Realtime updates voor de nieuwe tabel, zoals bij de andere tabellen.
do $$
begin
  alter publication supabase_realtime add table public.player_goals;
exception
  when duplicate_object then null;
end $$;

-- Controle:
-- select season, user_id, goals from public.player_goals order by season desc, goals desc;
