-- Row level security voor public.transactions.
-- Zonder dit kan iedereen met de anon key (die in de browserbundel zit) alle transacties
-- lezen en aanpassen, ook zonder in te loggen.
--
-- Draai dit in de Supabase SQL Editor. De service role key blijft RLS omzeilen,
-- dus de onderhoudsscripts in scripts/ blijven gewoon werken.

alter table public.transactions enable row level security;

-- 1. Iedereen die is ingelogd ziet alle transacties: de app toont het hele teamoverzicht.
--    Dit is ook wat realtime gebruikt, dus zonder deze policy stoppen de live updates.
drop policy if exists "Transactions are readable when signed in" on public.transactions;
create policy "Transactions are readable when signed in"
on public.transactions
for select
to authenticated
using (true);

-- 2. Alleen een admin of dev mag transacties aanmaken, wijzigen of verwijderen.
--    De app doet dit alleen vanuit het admin-paneel; gewone gebruikers lezen alleen.
drop policy if exists "Admins manage transactions" on public.transactions;
create policy "Admins manage transactions"
on public.transactions
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

-- Controle: hierna hoort rowsecurity true te zijn en staan er twee policies.
-- select relname, relrowsecurity from pg_class where relname = 'transactions';
-- select policyname, cmd from pg_policies where tablename = 'transactions';
