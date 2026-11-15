-- ImagingTech: run once in Supabase dashboard → SQL Editor → New query → Run.
-- Before running, replace EDITOR_EMAIL near the bottom with the email you'll log in with.

-- 1. One table holds the menu (collection 'site', id 'menu') and every product page
create table if not exists public.docs (
  collection text not null,
  id         text not null,
  data       jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (collection, id)
);

-- 2. Who may edit
create table if not exists public.editors (email text primary key);
alter table public.editors enable row level security;  -- no policies: hidden from the public

create or replace function public.is_editor() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.editors where lower(email) = lower(auth.jwt() ->> 'email'));
$$;

-- 3. Everyone can read; only editors can write
alter table public.docs enable row level security;
drop policy if exists "docs read"   on public.docs;
drop policy if exists "docs insert" on public.docs;
drop policy if exists "docs update" on public.docs;
drop policy if exists "docs delete" on public.docs;
create policy "docs read"   on public.docs for select using (true);
create policy "docs insert" on public.docs for insert with check (public.is_editor());
create policy "docs update" on public.docs for update using (public.is_editor()) with check (public.is_editor());
create policy "docs delete" on public.docs for delete using (public.is_editor());

-- 4. Live updates in the admin and on the pages
do $$ begin
  alter publication supabase_realtime add table public.docs;
exception when duplicate_object then null; end $$;

-- 5. Public image bucket (20 MB max, images only); only editors can upload or delete
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('uploads', 'uploads', true, 20971520, array['image/png','image/jpeg','image/webp','image/gif'])
on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "uploads insert" on storage.objects;
drop policy if exists "uploads update" on storage.objects;
drop policy if exists "uploads delete" on storage.objects;
create policy "uploads insert" on storage.objects for insert with check (bucket_id = 'uploads' and public.is_editor());
create policy "uploads update" on storage.objects for update using (bucket_id = 'uploads' and public.is_editor());
create policy "uploads delete" on storage.objects for delete using (bucket_id = 'uploads' and public.is_editor());

-- 6. Add yourself as an editor (repeat this line for anyone else)
insert into public.editors (email) values ('EDITOR_EMAIL') on conflict do nothing;

-- 7. Order requests from cart.html: anyone can send one, only editors can read or change them
create table if not exists public.orders (
  id         uuid primary key default gen_random_uuid(),
  ref        text not null,
  created_at timestamptz not null default now(),
  status     text not null default 'new',
  customer   jsonb not null,
  items      jsonb not null,
  subtotal   numeric(12,2),
  constraint orders_sane check (
    jsonb_typeof(items) = 'array' and jsonb_array_length(items) between 1 and 100
    and octet_length(customer::text) < 5000 and octet_length(items::text) < 100000
    and length(ref) < 40
  )
);
alter table public.orders enable row level security;
drop policy if exists "orders insert" on public.orders;
drop policy if exists "orders read"   on public.orders;
drop policy if exists "orders update" on public.orders;
drop policy if exists "orders delete" on public.orders;
create policy "orders insert" on public.orders for insert to anon, authenticated with check (status = 'new');
create policy "orders read"   on public.orders for select using (public.is_editor());
create policy "orders update" on public.orders for update using (public.is_editor()) with check (public.is_editor());
create policy "orders delete" on public.orders for delete using (public.is_editor());
