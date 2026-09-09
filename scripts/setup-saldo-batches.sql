-- Saldo-aanpassingen als groep: een admin verwerkt één bedrag voor meerdere spelers tegelijk
-- en kan die groep later in de app bewerken (bedrag, richting en spelers).
-- Dit bestand is opnieuw te draaien: alles is idempotent.

-- 1. Alle transacties uit één actie krijgen dezelfde batch_id. Oude transacties zonder batch_id
--    telt de app als een groep van één; bij bewerken krijgen ze alsnog een batch_id.
alter table public.transactions
  add column if not exists batch_id uuid;

create index if not exists transactions_batch_id_idx
  on public.transactions (batch_id);

-- 2. Was het ingevoerde bedrag een totaal (verdeeld over de spelers) of een bedrag per speler?
--    Alleen gevuld voor saldotransacties; boetes en vaste lasten laten dit leeg.
alter table public.transactions
  add column if not exists amount_mode text;

alter table public.transactions
  drop constraint if exists transactions_amount_mode_check;

alter table public.transactions
  add constraint transactions_amount_mode_check
  check (amount_mode is null or amount_mode in ('totaal', 'individueel'));

-- Controle:
-- select column_name from information_schema.columns where table_name = 'transactions' and column_name in ('batch_id', 'amount_mode');
