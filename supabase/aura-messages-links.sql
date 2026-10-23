-- AURA link previews in messages
--
-- Run this in Supabase (SQL Editor > New query > paste > Run) AFTER the other messages files.
-- It is safe to run more than once.
--
-- A message with a link can carry a small preview of it: the page's title, a short description,
-- the site's name and a small picture. The preview is made on the sender's PC when they send the
-- link and saved with the message, so the other person's PC never visits the website just
-- because a message arrived. The picture is stored as a small JPEG inside the preview itself.
-- (AURA checks every preview again before showing it.)
--
-- Added by aura-messages-links-setup.cjs.

alter table public.messages add column if not exists link jsonb;
alter table public.messages drop constraint if exists messages_link_shape;
alter table public.messages add constraint messages_link_shape check (
  link is null or (jsonb_typeof(link) = 'object' and pg_column_size(link) <= 65536 and jsonb_typeof(link -> 'url') = 'string')
);

-- A deleted message loses its preview too
create or replace function public.messages_clear_link()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.deleted_at is not null then new.link := null; end if;
  return new;
end $$;
revoke all on function public.messages_clear_link() from public, anon, authenticated;
drop trigger if exists messages_clear_link on public.messages;
create trigger messages_clear_link before insert or update on public.messages
  for each row execute function public.messages_clear_link();
