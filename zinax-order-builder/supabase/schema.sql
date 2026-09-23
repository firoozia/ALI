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

alter table tenants enable row level security;
alter table orders enable row level security;

-- A user can only see/manage the tenant row they own.
create policy "tenant owner can read own tenant" on tenants
  for select using (owner_user_id = auth.uid());

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
