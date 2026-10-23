-- Xpense Phase 1 cloud schema foundation.
-- Every user-owned row is protected by RLS and keyed to the Supabase Auth user.
-- Do not expose service_role credentials to the browser.

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text check (display_name is null or char_length(display_name) <= 80),
  currency_code text not null default 'PHP' check (currency_code ~ '^[A-Z]{3}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 60),
  account_type text not null check (account_type in ('cash', 'bank', 'ewallet', 'credit')),
  opening_balance numeric(14,2) not null default 0 check (opening_balance >= 0),
  opening_date date not null default current_date,
  is_archived boolean not null default false,
  created_at timestamptz not null default now(),
  unique (id, user_id)
);

create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 50),
  kind text not null check (kind in ('expense', 'income')),
  is_custom boolean not null default true,
  created_at timestamptz not null default now(),
  unique (user_id, name, kind),
  unique (id, user_id)
);

create table if not exists public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('expense', 'income', 'transfer', 'adjustment')),
  amount numeric(14,2) not null check (amount > 0),
  transaction_date date not null default current_date,
  account_id uuid,
  from_account_id uuid,
  to_account_id uuid,
  category text,
  note text check (note is null or char_length(note) <= 120),
  evidence_type text not null default 'none' check (evidence_type in ('none', 'paper', 'digital')),
  evidence_note text check (evidence_note is null or char_length(evidence_note) <= 160),
  adjustment_delta numeric(14,2),
  created_at timestamptz not null default now(),
  constraint transactions_account_owner_fk
    foreign key (account_id, user_id) references public.accounts (id, user_id) on delete restrict,
  constraint transactions_from_account_owner_fk
    foreign key (from_account_id, user_id) references public.accounts (id, user_id) on delete restrict,
  constraint transactions_to_account_owner_fk
    foreign key (to_account_id, user_id) references public.accounts (id, user_id) on delete restrict,
  constraint transactions_kind_shape_check check (
    (
      kind in ('expense', 'income')
      and account_id is not null
      and from_account_id is null
      and to_account_id is null
      and adjustment_delta is null
    )
    or (
      kind = 'transfer'
      and account_id is null
      and from_account_id is not null
      and to_account_id is not null
      and from_account_id <> to_account_id
      and adjustment_delta is null
    )
    or (
      kind = 'adjustment'
      and account_id is not null
      and from_account_id is null
      and to_account_id is null
      and adjustment_delta is not null
      and abs(adjustment_delta) = amount
    )
  )
);

create table if not exists public.budgets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  category text not null check (char_length(trim(category)) between 1 and 50),
  monthly_limit numeric(14,2) not null default 0 check (monthly_limit >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, category)
);

create index if not exists accounts_user_id_idx on public.accounts (user_id);
create index if not exists categories_user_id_idx on public.categories (user_id);
create index if not exists transactions_user_date_idx on public.transactions (user_id, transaction_date desc);
create index if not exists transactions_user_account_idx on public.transactions (user_id, account_id);
create index if not exists transactions_user_category_idx on public.transactions (user_id, category);
create index if not exists budgets_user_id_idx on public.budgets (user_id);

alter table public.profiles enable row level security;
alter table public.accounts enable row level security;
alter table public.categories enable row level security;
alter table public.transactions enable row level security;
alter table public.budgets enable row level security;

drop policy if exists "profile owner can read" on public.profiles;
create policy "profile owner can read" on public.profiles
  for select to authenticated using (id = (select auth.uid()));
drop policy if exists "profile owner can create" on public.profiles;
create policy "profile owner can create" on public.profiles
  for insert to authenticated with check (id = (select auth.uid()));
drop policy if exists "profile owner can update" on public.profiles;
create policy "profile owner can update" on public.profiles
  for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));
drop policy if exists "profile owner can delete" on public.profiles;
create policy "profile owner can delete" on public.profiles
  for delete to authenticated using (id = (select auth.uid()));

drop policy if exists "accounts are private to owner" on public.accounts;
create policy "accounts are private to owner" on public.accounts
  for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
drop policy if exists "categories are private to owner" on public.categories;
create policy "categories are private to owner" on public.categories
  for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
drop policy if exists "transactions are private to owner" on public.transactions;
create policy "transactions are private to owner" on public.transactions
  for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
drop policy if exists "budgets are private to owner" on public.budgets;
create policy "budgets are private to owner" on public.budgets
  for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

grant select, insert, update, delete on public.profiles, public.accounts, public.categories, public.transactions, public.budgets to authenticated;

-- Create a profile row when Supabase Auth creates an account.
create or replace function public.handle_new_xpense_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, nullif(new.raw_user_meta_data ->> 'display_name', ''))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_xpense on auth.users;
create trigger on_auth_user_created_xpense
  after insert on auth.users
  for each row execute procedure public.handle_new_xpense_user();

comment on table public.accounts is 'Xpense accounts. Credit-card balances are positive debt owed; assets are positive funds held.';
comment on table public.transactions is 'Xpense ledger. Amounts are positive; adjustment_delta carries reconciliation sign; transfers do not count as expenses or income.';
comment on table public.budgets is 'Monthly category limits per authenticated Xpense user.';
