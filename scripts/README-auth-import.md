# Import `public.users` into Supabase Auth

This script creates Auth users from your existing `public.users` table while keeping username login possible.

## What it does

- Reads users from `public.users` (or custom table via env var).
- Uses `username` + `password` from that table.
- Creates Auth user with email format: `<username>@saldo.local` (configurable domain).
- Writes a JSON report to `scripts/output/`.

## Required env vars

- `SUPABASE_URL` (or `NEXT_PUBLIC_SUPABASE_URL`)
- `SUPABASE_SERVICE_ROLE_KEY` (server-side only, never in frontend)

## Optional env vars

- `AUTH_EMAIL_DOMAIN` (default: `saldo.local`)
- `USERS_TABLE` (default: `users`)
- `DRY_RUN` (default: `true`)
- `OUTPUT_DIR` (default: `scripts/output`)

## Run

Dry run first:

```powershell
$env:SUPABASE_URL="https://YOUR-PROJECT.supabase.co"
$env:SUPABASE_SERVICE_ROLE_KEY="YOUR_SERVICE_ROLE_KEY"
$env:DRY_RUN="true"
npm run auth:import-users
```

Real import:

```powershell
$env:DRY_RUN="false"
npm run auth:import-users
```

## After import (important)

- Migrate your app login to `supabase.auth.signInWithPassword`.
- Remove `password` usage from frontend.
- Enable RLS and policies on `users` and `transactions`.
- Stop trusting `localStorage` user role data.

## Keep UUIDs in sync (recommended)

After import, you can sync `public.users.id` to the new `auth.users.id` using metadata (`legacy_user_id`) created by the import script.

Dry run first:

```powershell
$env:SUPABASE_URL="https://YOUR-PROJECT.supabase.co"
$env:SUPABASE_SERVICE_ROLE_KEY="YOUR_SERVICE_ROLE_KEY"
$env:DRY_RUN="true"
npm run auth:sync-uuids
```

Apply:

```powershell
$env:DRY_RUN="false"
npm run auth:sync-uuids
```

What it updates:

- `public.transactions.user_id` from old legacy UUID -> new auth UUID
- `public.users.id` from old legacy UUID -> new auth UUID

Always run a backup before the apply step.

### Foreign key requirement

For the safest sync, make sure `transactions.user_id -> users.id` is configured with `ON UPDATE CASCADE`.

```sql
alter table public.transactions
drop constraint if exists transactions_user_id_fkey;

alter table public.transactions
add constraint transactions_user_id_fkey
foreign key (user_id)
references public.users(id)
on update cascade
on delete restrict;
```
