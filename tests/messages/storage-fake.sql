-- A stand-in for Supabase Storage's tables: same names, same columns AURA relies on, RLS on.
create schema storage;
create table storage.buckets (id text primary key, name text not null unique, public boolean default false, file_size_limit bigint, allowed_mime_types text[], created_at timestamptz default now());
create table storage.objects (
  id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id), name text,
  owner uuid, owner_id text, metadata jsonb, created_at timestamptz default now(), unique (bucket_id, name));
alter table storage.objects enable row level security;
alter table storage.buckets enable row level security;
create function storage.foldername(name text) returns text[] language plpgsql immutable as $$
declare _parts text[];
begin
  select string_to_array(name, '/') into _parts;
  return _parts[1:array_length(_parts,1)-1];
end $$;
grant usage on schema storage to anon, authenticated;
grant all on storage.objects, storage.buckets to anon, authenticated;
grant execute on function storage.foldername(text) to anon, authenticated;
