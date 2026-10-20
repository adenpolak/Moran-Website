-- My Sweetart orders table. Run once in Supabase → SQL editor (project "my-sweetart").
-- Only the server touches this table, with the service-role key. RLS is on with no policies, so the anon key sees nothing.

create table if not exists public.orders (
  id                    uuid primary key default gen_random_uuid(),
  created_at            timestamptz not null default now(),
  paid_at               timestamptz,
  ref                   text not null,
  status                text not null default 'pending'
                        check (status in ('pending','paid','in_progress','ready','completed','cancelled','refunded')),
  stripe_session_id     text unique,
  stripe_payment_intent text,
  customer_name         text not null,
  customer_email        text not null,
  customer_phone        text not null,
  method                text not null check (method in ('pickup','delivery')),
  pickup_date           date not null,
  pickup_window         text not null,
  address               text,
  notes                 text,
  items                 jsonb not null,   -- [{productId, name, options, summary, qty, unit_cents, amount_cents}]
  subtotal_cents        integer not null,
  delivery_fee_cents    integer not null default 0,
  total_cents           integer not null,
  currency              text not null default 'usd'
);
create index if not exists orders_pickup_date_idx on public.orders (pickup_date, status);
create index if not exists orders_created_at_idx on public.orders (created_at);
alter table public.orders enable row level security;   -- no policies: only the service role (server) can read/write
