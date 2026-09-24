-- ZINAX Order Builder — backend schema (Supabase/Postgres)
--
-- Run this once in the Supabase project's SQL editor (Dashboard → SQL Editor → New query).
-- It creates one row per tenant (factory) and scopes every order to its own
-- tenant via Row Level Security, so one factory's Supabase Auth user can
-- never read or write another factory's data even though they share the
-- same database and the client talks to Postgres directly.

create table if not exists tenants (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users (id) on delete cascade,
  company_name text not null,
  slug text unique not null,
  created_at timestamptz not null default now()
);

create table if not exists orders (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  order_no text not null,
  order_date text not null,
  customer_name text not null default '',
  project_name text not null default '',
  salesperson text not null default '',
  total_doors integer not null default 0,
  status text not null default 'Draft',
  updated_at timestamptz not null default now(),
  header jsonb not null,
  rows jsonb not null,
  invoice jsonb not null,
  invoice_mode boolean not null default false,
  unique (tenant_id, order_no)
);

create index if not exists orders_tenant_id_updated_at_idx on orders (tenant_id, updated_at desc);

-- The factory's own door-design codes (e.g. Ali's A101, Hossein's HO201) —
-- published here so the public, no-login customer portal can show each
-- factory's own catalog by reading its tenant_id, never another factory's.
create table if not exists designs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  code text not null,
  name text not null default '',
  price_per_door numeric not null default 0,
  active boolean not null default true,
  updated_at timestamptz not null default now(),
  unique (tenant_id, code)
);

-- Orders submitted by an end customer through the public portal, before
-- the factory has reviewed/accepted them into its real order history.
-- Deliberately a separate table from `orders`: the public portal writes
-- here (write-only, no login), never directly into the factory's real
-- order data.
create table if not exists customer_submissions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  submitted_at timestamptz not null default now(),
  customer_name text not null default '',
  end_customer_name text not null default '',
  site_name text not null default '',
  items jsonb not null,
  status text not null default 'new'
);

alter table tenants enable row level security;
alter table orders enable row level security;
alter table designs enable row level security;
alter table customer_submissions enable row level security;

-- A user can only see/manage the tenant row they own.
create policy "tenant owner can read own tenant" on tenants
  for select using (owner_user_id = auth.uid());

-- The public customer portal needs to resolve a factory's slug to its
-- name/id before the visitor logs in at all — company_name and slug
-- aren't sensitive, so this is safe to expose to anyone.
create policy "public can read tenant directory info" on tenants
  for select using (true);

create policy "tenant owner can insert own tenant" on tenants
  for insert with check (owner_user_id = auth.uid());

create policy "tenant owner can update own tenant" on tenants
  for update using (owner_user_id = auth.uid());

-- Orders are only visible/editable through the tenant the caller owns —
-- this is the actual multi-tenant boundary, enforced by Postgres itself,
-- not by client-side code.
create policy "tenant owner can read own orders" on orders
  for select using (
    tenant_id in (select id from tenants where owner_user_id = auth.uid())
  );

create policy "tenant owner can insert own orders" on orders
  for insert with check (
    tenant_id in (select id from tenants where owner_user_id = auth.uid())
  );

create policy "tenant owner can update own orders" on orders
  for update using (
    tenant_id in (select id from tenants where owner_user_id = auth.uid())
  );

create policy "tenant owner can delete own orders" on orders
  for delete using (
    tenant_id in (select id from tenants where owner_user_id = auth.uid())
  );

-- Designs: the factory manages its own codes...
create policy "tenant owner can manage own designs" on designs
  for all using (
    tenant_id in (select id from tenants where owner_user_id = auth.uid())
  )
  with check (
    tenant_id in (select id from tenants where owner_user_id = auth.uid())
  );

-- ...and anyone (the unauthenticated customer portal) can read the active ones.
create policy "public can read active designs" on designs
  for select using (active = true);

-- Customer submissions: anyone can submit an order through the public
-- portal (write-only mailbox — no select/update/delete for the public).
create policy "public can submit customer orders" on customer_submissions
  for insert with check (true);

-- Only the tenant that owns the submissions can read them.
create policy "tenant owner can read own submissions" on customer_submissions
  for select using (
    tenant_id in (select id from tenants where owner_user_id = auth.uid())
  );
