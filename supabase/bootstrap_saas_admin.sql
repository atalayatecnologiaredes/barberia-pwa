-- Run once after creating this person in Supabase Auth and public.profiles.
-- Replace the email below with the email used to sign in as the SaaS owner.
insert into public.saas_admins(profile_id)
select p.id
from public.profiles p
where lower(p.email) = lower('admin@tu-dominio.com')
on conflict (profile_id) do nothing;
