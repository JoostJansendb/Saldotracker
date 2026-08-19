-- Vaste lasten: een doorlopende pot met per seizoenshelft een eigen post.
-- Dit bestand is opnieuw te draaien: alles is idempotent.

-- 1. De posten zelf. De admin maakt er elke seizoenshelft een aan met een naam.
create table if not exists public.fixed_charges (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  name text not null
);

-- Een totaalbedrag is overbodig: elke transactie op een post telt als betaald.
alter table public.fixed_charges
  drop column if exists total_amount;

-- 2. Transacties koppelen aan een post. Blijft leeg voor saldo- en boetetransacties.
alter table public.transactions
  add column if not exists fixed_charge_id uuid;

create index if not exists transactions_fixed_charge_id_idx
  on public.transactions (fixed_charge_id);

-- on delete restrict: een post met transacties eraan kan niet verwijderd worden.
alter table public.transactions
  drop constraint if exists transactions_fixed_charge_id_fkey;

alter table public.transactions
  add constraint transactions_fixed_charge_id_fkey
  foreign key (fixed_charge_id) references public.fixed_charges (id) on delete restrict;

-- 3. De oorspronkelijke check constraint liet alleen 'saldo' en 'boete' toe.
alter table public.transactions
  drop constraint if exists transactions_category_check;

alter table public.transactions
  add constraint transactions_category_check
  check (category in ('saldo', 'boete', 'vaste_lasten'));

-- 4. Iedereen die is ingelogd mag de posten lezen; alleen een admin of dev mag ze beheren.
alter table public.fixed_charges enable row level security;

drop policy if exists "Fixed charges are readable" on public.fixed_charges;
create policy "Fixed charges are readable"
on public.fixed_charges
for select
to authenticated
using (true);

drop policy if exists "Admins manage fixed charges" on public.fixed_charges;
create policy "Admins manage fixed charges"
on public.fixed_charges
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

-- 5. Realtime updates voor de nieuwe tabel, zoals bij users en transactions.
do $$
begin
  alter publication supabase_realtime add table public.fixed_charges;
exception
  when duplicate_object then null;
end $$;
