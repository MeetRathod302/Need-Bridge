-- NeedBridge AI — Supabase PostgreSQL Schema
-- Run this in the Supabase SQL editor to set up the platform database

create extension if not exists "uuid-ossp";
create extension if not exists "postgis";

-- =============================================
--   ORGANISATIONS
-- =============================================
create table if not exists organisations (
  id            uuid primary key default uuid_generate_v4(),
  name          text not null,
  org_type      text not null check (org_type in ('NGO', 'Hospital', 'School', 'Donor')),
  email         text unique not null,
  phone         text,
  address       text,
  lat           float8 not null,
  lng           float8 not null,
  verified      boolean default false,
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

-- =============================================
--   LISTINGS
-- =============================================
create table if not exists listings (
  id            uuid primary key default uuid_generate_v4(),
  org_id        uuid references organisations(id) on delete set null,
  org_name      text not null,
  org_type      text not null check (org_type in ('NGO', 'Hospital', 'School', 'Donor')),
  listing_type  text not null check (listing_type in ('HAVE', 'NEED')),
  category      text not null,
  item_name     text not null,
  quantity      text,
  condition     text,
  urgency_score int check (urgency_score between 1 and 5) default 3,
  lat           float8 not null,
  lng           float8 not null,
  raw_text      text,
  status        text not null default 'active' check (status in ('active', 'matched', 'fulfilled', 'expired')),
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

create index if not exists listings_type_idx on listings(listing_type);
create index if not exists listings_category_idx on listings(category);
create index if not exists listings_status_idx on listings(status);
create index if not exists listings_geo_idx on listings using gist (
  st_makepoint(lng, lat)::geography
);

-- =============================================
--   MATCHES
-- =============================================
create table if not exists matches (
  id                   uuid primary key default uuid_generate_v4(),
  source_listing_id    uuid references listings(id) on delete cascade,
  target_listing_id    uuid references listings(id) on delete cascade,
  score                int check (score between 0 and 100),
  distance_km          float8,
  status               text default 'pending' check (status in ('pending', 'accepted', 'rejected', 'fulfilled')),
  created_at           timestamptz default now(),
  unique (source_listing_id, target_listing_id)
);

-- =============================================
--   PUSH SUBSCRIPTIONS
-- =============================================
create table if not exists push_subscriptions (
  id         uuid primary key default uuid_generate_v4(),
  org_id     uuid references organisations(id) on delete cascade,
  endpoint   text unique not null,
  keys       jsonb not null,
  created_at timestamptz default now()
);

-- =============================================
--   MESSAGES
-- =============================================
create table if not exists messages (
  id          uuid primary key default uuid_generate_v4(),
  match_id    uuid references matches(id) on delete cascade,
  sender_id   uuid references organisations(id) on delete set null,
  content     text not null,
  sent_at     timestamptz default now()
);

-- =============================================
--   ROW LEVEL SECURITY
-- =============================================
alter table listings enable row level security;
alter table matches enable row level security;
alter table messages enable row level security;
alter table push_subscriptions enable row level security;

-- Public read on active listings (for matching engine scan)
create policy "read_active_listings" on listings
  for select using (status = 'active');

-- Service key bypasses RLS for writes (backend only)
-- Frontend should NEVER use the service key

-- =============================================
--   TRIGGER: auto-update updated_at
-- =============================================
create or replace function update_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger listings_updated_at
  before update on listings
  for each row execute procedure update_updated_at();

create trigger orgs_updated_at
  before update on organisations
  for each row execute procedure update_updated_at();

-- =============================================
--   SEED: Sample data for local dev / demo
-- =============================================
insert into organisations (name, org_type, email, lat, lng, verified) values
  ('Rotary Club Bandra', 'NGO', 'rotary.bandra@example.com', 19.0596, 72.8295, true),
  ('Sion Hospital Trust', 'Hospital', 'trust@sionhospital.example.com', 19.0382, 72.8646, true),
  ('Dharavi Municipal School', 'School', 'school@dharavi.example.com', 19.0405, 72.8541, true),
  ('Tata CSR Foundation', 'Donor', 'csr@tata.example.com', 18.9548, 72.8347, true)
on conflict (email) do nothing;
