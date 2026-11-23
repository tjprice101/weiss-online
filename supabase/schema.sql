-- Weiss Online Mat: Supabase schema
-- Paste this whole file into Supabase Dashboard → SQL Editor → New query → Run.

-- ───────────── cards (every user's uploaded card images) ─────────────
create table if not exists public.cards (
  id          uuid primary key default gen_random_uuid(),
  owner       uuid not null default auth.uid() references auth.users(id) on delete cascade,
  hash        text not null,
  name        text not null,
  is_climax   boolean not null default false,
  landscape   boolean not null default false,
  path        text not null,
  created_at  timestamptz not null default now(),
  unique (owner, hash)
);
create index if not exists cards_owner_idx on public.cards(owner);
create index if not exists cards_name_idx on public.cards using gin (to_tsvector('simple', name));

alter table public.cards enable row level security;

-- Anyone signed in can browse every card (community library). Only the owner can change their own.
drop policy if exists "cards: read all" on public.cards;
create policy "cards: read all"     on public.cards for select to authenticated using (true);
drop policy if exists "cards: insert own" on public.cards;
create policy "cards: insert own"   on public.cards for insert to authenticated with check (auth.uid() = owner);
drop policy if exists "cards: update own" on public.cards;
create policy "cards: update own"   on public.cards for update to authenticated using (auth.uid() = owner);
drop policy if exists "cards: delete own" on public.cards;
create policy "cards: delete own"   on public.cards for delete to authenticated using (auth.uid() = owner);

-- ───────────── decks ─────────────
create table if not exists public.decks (
  id          uuid primary key default gen_random_uuid(),
  owner       uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name        text not null,
  cards       jsonb not null default '[]'::jsonb,   -- [{ "cardId": uuid, "count": int }]
  updated_at  timestamptz not null default now()
);
create index if not exists decks_owner_idx on public.decks(owner);

alter table public.decks enable row level security;
drop policy if exists "decks: own" on public.decks;
create policy "decks: own" on public.decks for all to authenticated
  using (auth.uid() = owner) with check (auth.uid() = owner);

-- ───────────── storage bucket for card images ─────────────
insert into storage.buckets (id, name, public)
values ('cards', 'cards', true)
on conflict (id) do update set public = true;

-- Public read (so opponents' browsers can load images by URL); users write only inside their own folder: <uid>/<file>.
drop policy if exists "card images: public read" on storage.objects;
create policy "card images: public read" on storage.objects for select
  using (bucket_id = 'cards');
drop policy if exists "card images: upload own" on storage.objects;
create policy "card images: upload own" on storage.objects for insert to authenticated
  with check (bucket_id = 'cards' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "card images: update own" on storage.objects;
create policy "card images: update own" on storage.objects for update to authenticated
  using (bucket_id = 'cards' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "card images: delete own" on storage.objects;
create policy "card images: delete own" on storage.objects for delete to authenticated
  using (bucket_id = 'cards' and (storage.foldername(name))[1] = auth.uid()::text);
