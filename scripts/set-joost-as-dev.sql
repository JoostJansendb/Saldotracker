-- Geef Joost Jansen de nieuwe dev-rol.
-- Draai dit in Supabase SQL Editor nadat de users.role kolom "dev" accepteert.

update public.users
set role = 'dev'
where name = 'Joost Jansen';
