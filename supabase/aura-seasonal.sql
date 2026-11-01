-- AURA: seasonal avatar decorations (Edit Profile > Avatar Decorations).
-- Adds one column to profiles for the frame and accessory you chose, and one function that saves
-- yours. The function can only change your own profile, and only takes a small settings object.
-- Everyone signed in can already see profiles, so friends see your decorations the same way they
-- see your picture. Nothing else changes: no existing rules or data are touched.
-- Run once in Supabase > SQL Editor. Safe to run again. (Added by aura-seasonal-setup.cjs)

alter table public.profiles add column if not exists avatar_decor jsonb;

alter table public.profiles drop constraint if exists profiles_avatar_decor_small;
alter table public.profiles add constraint profiles_avatar_decor_small
  check (avatar_decor is null or (jsonb_typeof(avatar_decor) = 'object' and pg_column_size(avatar_decor) <= 2048));

create or replace function public.set_avatar_decoration(decor jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
begin
  if me is null then raise exception 'You''re not logged in.'; end if;
  if decor is not null and (jsonb_typeof(decor) <> 'object' or pg_column_size(decor) > 2048) then
    raise exception 'That decoration isn''t valid.';
  end if;
  update public.profiles set avatar_decor = decor where id = me;
  if not found then raise exception 'Save your profile first, then your decorations.'; end if;
end $$;
revoke all on function public.set_avatar_decoration(jsonb) from public, anon;
grant execute on function public.set_avatar_decoration(jsonb) to authenticated;
