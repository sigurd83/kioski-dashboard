-- Drop existing tables if re-running
drop table if exists sales;
drop table if exists expenses;
drop table if exists invoices;

-- Sales table (Sandstar OPS XLSX import)
create table if not exists sales (
  id uuid primary key default gen_random_uuid(),
  order_time timestamptz not null,
  route text,
  machine text,
  custom_machine_number text,
  product_name text not null,
  product_barcode text,
  quantity numeric not null default 1,
  unit_price numeric not null,
  sales_volume numeric not null,
  imported_at timestamptz not null default now()
);

-- Expenses table (Pleo XLSX import)
create table if not exists expenses (
  id uuid primary key default gen_random_uuid(),
  expense_id text unique,           -- Pleo Expense ID (UUID)
  date timestamptz not null,
  merchant text,                    -- Text / Source description
  amount numeric not null,          -- Total inkl. moms (positiv)
  net_amount numeric,               -- Ex. moms
  tax_amount numeric,               -- Moms
  currency text default 'DKK',
  category text,
  owner text,                       -- Medarbejder
  receipt_url text,                 -- URL til PDF kvittering
  receipt_items jsonb,              -- Udtrukket fra PDF via Claude
  imported_at timestamptz not null default now()
);

-- Invoices table (PDF fakturaer fra leverandører)
create table if not exists invoices (
  id uuid primary key default gen_random_uuid(),
  filename text not null,
  supplier text,
  invoice_date date,
  due_date date,
  amount numeric,
  vat numeric,
  total_amount numeric,
  raw_text text,
  uploaded_at timestamptz not null default now()
);

-- Index for hurtig søgning på produkt og dato
create index if not exists sales_product_name_idx on sales (product_name);
create index if not exists sales_order_time_idx on sales (order_time);
create index if not exists expenses_date_idx on expenses (date);
create index if not exists expenses_merchant_idx on expenses (merchant);
