-- Potjes: per maand een vast bedrag per deelnemer, bijvoorbeeld om te sparen voor het teamweekend.
-- Staat los van saldo en transacties: de admin vinkt per persoon per maand af wie betaald heeft.
-- Dit bestand is opnieuw te draaien: alles is idempotent.

-- 1. De potjes zelf. Een maand staat opgeslagen als de eerste dag van die maand (2026-11-01).
create table if not exists public.pots (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  name text not null,
  icon text not null default 'tent',
  monthly_amount numeric(10, 2) not null,
  start_month date not null,
  end_month date not null,
  archived_at timestamptz
);

alter table public.pots
  drop constraint if exists pots_monthly_amount_check;

alter table public.pots
  add constraint pots_monthly_amount_check
  check (monthly_amount > 0);

alter table public.pots
  drop constraint if exists pots_period_check;

alter table public.pots
  add constraint pots_period_check
  check (
    end_month >= start_month
    and extract(day from start_month) = 1
    and extract(day from end_month) = 1
  );

alter table public.pots
  drop constraint if exists pots_icon_check;

alter table public.pots
  add constraint pots_icon_check
  check (icon in ('tent', 'utensils', 'plane', 'trophy'));

-- 2. Wie er meedoet. start_month blijft leeg voor wie er vanaf het begin bij is;
--    wie later instapt, betaalt pas vanaf die maand en de maanden ervoor tellen niet mee.
create table if not exists public.pot_participants (
  pot_id uuid not null references public.pots (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  start_month date,
  created_at timestamptz not null default now(),
  primary key (pot_id, user_id)
);

alter table public.pot_participants
  drop constraint if exists pot_participants_start_month_check;

alter table public.pot_participants
  add constraint pot_participants_start_month_check
  check (start_month is null or extract(day from start_month) = 1);

-- 3. Eén rij = die persoon heeft die maand betaald. Geen rij = nog niet betaald.
--    Haalt de admin iemand uit het potje, dan verdwijnen zijn vinkjes mee.
create table if not exists public.pot_payments (
  pot_id uuid not null,
  user_id uuid not null,
  month date not null,
  created_at timestamptz not null default now(),
  marked_by uuid default auth.uid() references public.users (id) on delete set null,
  primary key (pot_id, user_id, month),
  foreign key (pot_id, user_id) references public.pot_participants (pot_id, user_id) on delete cascade
);

alter table public.pot_payments
  drop constraint if exists pot_payments_month_check;

alter table public.pot_payments
  add constraint pot_payments_month_check
  check (extract(day from month) = 1);

-- 4. Iedereen die is ingelogd mag de potjes lezen; alleen een admin of dev mag ze beheren.
alter table public.pots enable row level security;
alter table public.pot_participants enable row level security;
alter table public.pot_payments enable row level security;

drop policy if exists "Pots are readable" on public.pots;
create policy "Pots are readable"
on public.pots
for select
to authenticated
using (true);

drop policy if exists "Admins manage pots" on public.pots;
create policy "Admins manage pots"
on public.pots
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

drop policy if exists "Pot participants are readable" on public.pot_participants;
create policy "Pot participants are readable"
on public.pot_participants
for select
to authenticated
using (true);

drop policy if exists "Admins manage pot participants" on public.pot_participants;
create policy "Admins manage pot participants"
on public.pot_participants
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

drop policy if exists "Pot payments are readable" on public.pot_payments;
create policy "Pot payments are readable"
on public.pot_payments
for select
to authenticated
using (true);

drop policy if exists "Admins manage pot payments" on public.pot_payments;
create policy "Admins manage pot payments"
on public.pot_payments
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

-- 5. Realtime updates voor de nieuwe tabellen, zoals bij de andere tabellen.
do $$
begin
  alter publication supabase_realtime add table public.pots;
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.pot_participants;
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.pot_payments;
exception
  when duplicate_object then null;
end $$;

-- Controle:
-- select p.name, count(distinct pp.user_id) as deelnemers, count(pay.*) as betaalde_maanden
-- from public.pots p
-- left join public.pot_participants pp on pp.pot_id = p.id
-- left join public.pot_payments pay on pay.pot_id = p.id and pay.user_id = pp.user_id
-- group by p.id, p.name
-- order by p.start_month desc;
