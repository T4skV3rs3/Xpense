-- Xpense Phase 2: private individual finances plus a separate shared household budget.
-- Additive only: existing personal tables and their owner-only RLS policies are not relaxed.
-- Apply only after reviewing in a disposable Supabase project; this migration has not been applied to a live database.

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated;

create table if not exists public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 1 and 60),
  created_by uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, created_by)
);

create table if not exists public.household_members (
  household_id uuid not null references public.households (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete restrict,
  role text not null check (role in ('owner', 'member')),
  joined_at timestamptz not null default now(),
  left_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (household_id, user_id)
);

-- Invitation rows are deliberately inaccessible through the client Data API.
-- Only narrowly scoped SECURITY DEFINER functions may create/consume these records.
create table if not exists public.household_invitations (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  invited_by uuid not null references auth.users (id) on delete restrict,
  invitee_email text not null check (char_length(invitee_email) between 3 and 254),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  accepted_at timestamptz,
  accepted_by uuid references auth.users (id) on delete restrict,
  revoked_at timestamptz,
  constraint household_invitation_acceptance_pair
    check ((accepted_at is null and accepted_by is null) or (accepted_at is not null and accepted_by is not null)),
  constraint household_invitation_expiry_check check (expires_at > created_at)
);

create unique index if not exists household_invitations_one_pending_per_household_idx
  on public.household_invitations (household_id)
  where accepted_at is null and revoked_at is null;

create table if not exists public.household_categories (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 50),
  created_at timestamptz not null default now(),
  unique (household_id, name),
  unique (id, household_id)
);

create table if not exists public.household_budgets (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  category_id uuid not null,
  monthly_limit numeric(14,2) not null check (monthly_limit >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint household_budgets_category_scope_fk
    foreign key (category_id, household_id)
    references public.household_categories (id, household_id) on delete cascade,
  unique (household_id, category_id)
);

create table if not exists public.household_entries (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  kind text not null check (kind in ('expense', 'contribution', 'refund')),
  amount numeric(14,2) not null check (amount > 0),
  transaction_date date not null default current_date,
  category_id uuid,
  member_user_id uuid not null,
  note text check (note is null or char_length(note) <= 120),
  evidence_type text not null default 'none' check (evidence_type in ('none', 'paper', 'digital')),
  evidence_note text check (evidence_note is null or char_length(evidence_note) <= 160),
  created_by uuid not null default auth.uid() references auth.users (id) on delete restrict,
  updated_by uuid not null default auth.uid() references auth.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint household_entries_member_scope_fk
    foreign key (household_id, member_user_id)
    references public.household_members (household_id, user_id) on delete restrict,
  constraint household_entries_category_scope_fk
    foreign key (category_id, household_id)
    references public.household_categories (id, household_id) on delete restrict,
  constraint household_entries_category_shape_check check (
    (kind = 'contribution' and category_id is null)
    or (kind in ('expense', 'refund') and category_id is not null)
  )
);

create index if not exists household_members_user_active_idx
  on public.household_members (user_id, household_id) where left_at is null;
create index if not exists household_categories_household_idx
  on public.household_categories (household_id);
create index if not exists household_budgets_household_idx
  on public.household_budgets (household_id);
create index if not exists household_entries_household_date_idx
  on public.household_entries (household_id, transaction_date desc);
create index if not exists household_entries_member_date_idx
  on public.household_entries (household_id, member_user_id, transaction_date desc);

alter table public.households enable row level security;
alter table public.household_members enable row level security;
alter table public.household_invitations enable row level security;
alter table public.household_categories enable row level security;
alter table public.household_budgets enable row level security;
alter table public.household_entries enable row level security;

-- The private helpers avoid recursive RLS checks on household_members.
-- They return membership facts only for the signed-in user and are not in an exposed API schema.
create or replace function private.is_household_member(p_household_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.household_members hm
    where hm.household_id = p_household_id
      and hm.user_id = (select auth.uid())
      and hm.left_at is null
  );
$$;

create or replace function private.is_household_owner(p_household_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.household_members hm
    where hm.household_id = p_household_id
      and hm.user_id = (select auth.uid())
      and hm.role = 'owner'
      and hm.left_at is null
  );
$$;

revoke all on function private.is_household_member(uuid) from public, anon;
revoke all on function private.is_household_owner(uuid) from public, anon;
grant execute on function private.is_household_member(uuid) to authenticated;
grant execute on function private.is_household_owner(uuid) to authenticated;

-- A new household and its owner membership are created atomically.
create or replace function public.create_xpense_household(p_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_name text := nullif(btrim(p_name), '');
  v_household_id uuid;
begin
  if v_user_id is null then
    raise exception 'Sign in before creating a household' using errcode = '28000';
  end if;
  if v_name is null or char_length(v_name) > 60 then
    raise exception 'Household name must contain 1 to 60 characters' using errcode = '22023';
  end if;

  insert into public.households (name, created_by)
  values (v_name, v_user_id)
  returning id into v_household_id;

  insert into public.household_members (household_id, user_id, role)
  values (v_household_id, v_user_id, 'owner');

  return v_household_id;
end;
$$;

-- Creates a single-use invite, stores only its SHA-256 hash, and returns the raw token once.
-- The app can put the token in a URL fragment or copyable link; no paid email provider is required.
create or replace function public.create_household_invitation(
  p_household_id uuid,
  p_invitee_email text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_current_email text := lower(coalesce((select auth.jwt() ->> 'email'), ''));
  v_invitee_email text := lower(btrim(p_invitee_email));
  v_active_members integer;
  v_token text;
begin
  if v_user_id is null then
    raise exception 'Sign in before creating an invitation' using errcode = '28000';
  end if;
  if not private.is_household_owner(p_household_id) then
    raise exception 'Only the household owner may invite a member' using errcode = '42501';
  end if;
  if v_invitee_email is null or char_length(v_invitee_email) not between 3 and 254
     or position('@' in v_invitee_email) < 2
     or position(' ' in v_invitee_email) > 0 then
    raise exception 'Enter a valid invitee email address' using errcode = '22023';
  end if;
  if v_invitee_email = v_current_email then
    raise exception 'You cannot invite your own email address' using errcode = '22023';
  end if;

  -- Serialize invitations with acceptance so two simultaneous invites cannot overfill the household.
  perform 1 from public.households h where h.id = p_household_id for update;
  if not found then
    raise exception 'Household not found' using errcode = 'P0002';
  end if;

  select count(*) into v_active_members
  from public.household_members hm
  where hm.household_id = p_household_id and hm.left_at is null;

  if v_active_members >= 2 then
    raise exception 'This household already has its two members' using errcode = '23514';
  end if;

  update public.household_invitations
    set revoked_at = now()
    where household_id = p_household_id
      and accepted_at is null
      and revoked_at is null;

  v_token := encode(extensions.gen_random_bytes(32), 'hex');

  insert into public.household_invitations (
    household_id, invited_by, invitee_email, token_hash, expires_at
  )
  values (
    p_household_id,
    v_user_id,
    v_invitee_email,
    encode(extensions.digest(v_token, 'sha256'), 'hex'),
    now() + interval '7 days'
  );

  return v_token;
end;
$$;

-- Accept only while signed in with a verified email matching the invitation.
-- The household row is locked before the invitation row to serialize against invite creation.
create or replace function public.accept_household_invitation(p_token text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_email text;
  v_email_confirmed_at timestamptz;
  v_token_hash text;
  v_household_id uuid;
  v_invitation public.household_invitations%rowtype;
  v_active_members integer;
begin
  if v_user_id is null then
    raise exception 'Sign in before accepting an invitation' using errcode = '28000';
  end if;
  if p_token is null or char_length(p_token) <> 64 or p_token !~ '^[0-9a-fA-F]{64}$' then
    raise exception 'Invitation is invalid or expired' using errcode = '22023';
  end if;

  select lower(u.email), u.email_confirmed_at
    into v_email, v_email_confirmed_at
    from auth.users u
    where u.id = v_user_id;

  if v_email is null or v_email_confirmed_at is null then
    raise exception 'Verify your email before accepting a household invitation' using errcode = '42501';
  end if;

  v_token_hash := encode(extensions.digest(lower(p_token), 'sha256'), 'hex');

  select hi.household_id into v_household_id
  from public.household_invitations hi
  where hi.token_hash = v_token_hash
    and hi.accepted_at is null
    and hi.revoked_at is null
    and hi.expires_at > now();

  if not found then
    raise exception 'Invitation is invalid, already used, or expired' using errcode = 'P0002';
  end if;

  perform 1 from public.households h where h.id = v_household_id for update;
  if not found then
    raise exception 'Household not found' using errcode = 'P0002';
  end if;

  select hi.* into v_invitation
  from public.household_invitations hi
  where hi.household_id = v_household_id
    and hi.token_hash = v_token_hash
    and hi.accepted_at is null
    and hi.revoked_at is null
    and hi.expires_at > now()
  for update;

  if not found then
    raise exception 'Invitation is invalid, already used, or expired' using errcode = 'P0002';
  end if;
  if lower(v_invitation.invitee_email) <> v_email then
    raise exception 'Sign in with the email address this invitation was sent to' using errcode = '42501';
  end if;

  select count(*) into v_active_members
  from public.household_members hm
  where hm.household_id = v_household_id and hm.left_at is null;

  if v_active_members >= 2 then
    raise exception 'This household already has its two members' using errcode = '23514';
  end if;

  if exists (
    select 1 from public.household_members hm
    where hm.household_id = v_household_id
      and hm.user_id = v_user_id
      and hm.role = 'owner'
  ) then
    raise exception 'The household owner cannot accept their own invitation' using errcode = '23514';
  end if;

  insert into public.household_members (household_id, user_id, role)
  values (v_household_id, v_user_id, 'member')
  on conflict (household_id, user_id)
  do update set joined_at = now(), left_at = null
  where public.household_members.role = 'member';

  if not found then
    raise exception 'This account cannot rejoin this household' using errcode = '23514';
  end if;

  update public.household_invitations
    set accepted_at = now(), accepted_by = v_user_id
    where id = v_invitation.id;

  return v_household_id;
end;
$$;

create or replace function public.leave_xpense_household(p_household_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
begin
  if v_user_id is null then
    raise exception 'Sign in before leaving a household' using errcode = '28000';
  end if;

  update public.household_members
    set left_at = now()
    where household_id = p_household_id
      and user_id = v_user_id
      and role = 'member'
      and left_at is null;

  if not found then
    raise exception 'Only an active household member can leave; the owner must delete the household or transfer ownership in a future release' using errcode = '42501';
  end if;
end;
$$;

create or replace function public.remove_xpense_household_member(
  p_household_id uuid,
  p_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_household_owner(p_household_id) then
    raise exception 'Only the household owner may remove a member' using errcode = '42501';
  end if;
  if p_user_id = (select auth.uid()) then
    raise exception 'The owner cannot remove themselves in this release' using errcode = '22023';
  end if;

  update public.household_members
    set left_at = now()
    where household_id = p_household_id
      and user_id = p_user_id
      and role = 'member'
      and left_at is null;

  if not found then
    raise exception 'Active household member not found' using errcode = 'P0002';
  end if;
end;
$$;

-- Keep audit identity stable while allowing either active household member to manage shared entries.
create or replace function private.guard_household_entry_audit()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if new.household_id <> old.household_id
       or new.created_by <> old.created_by
       or new.created_at <> old.created_at then
      raise exception 'Household entry scope and creator are immutable' using errcode = '42501';
    end if;
  else
    new.created_by := (select auth.uid());
    new.created_at := now();
  end if;

  if not exists (
    select 1 from public.household_members hm
    where hm.household_id = new.household_id
      and hm.user_id = new.member_user_id
      and hm.left_at is null
  ) then
    raise exception 'The selected household member is not active' using errcode = '23514';
  end if;

  new.updated_by := (select auth.uid());
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function private.guard_household_entry_audit() from public, anon, authenticated;
create trigger household_entries_audit_guard
  before insert or update on public.household_entries
  for each row execute function private.guard_household_entry_audit();

-- Explicit grants: no direct client insert/update to membership, no client access to invitations.
revoke all on public.households, public.household_members, public.household_invitations,
  public.household_categories, public.household_budgets, public.household_entries
  from public, anon, authenticated;

grant select, update, delete on public.households to authenticated;
grant select on public.household_members to authenticated;
grant select, insert, update, delete on public.household_categories,
  public.household_budgets, public.household_entries to authenticated;

-- Households are created only through create_xpense_household().
create policy households_read_members on public.households
  for select to authenticated
  using (private.is_household_member(id));

create policy households_update_owner on public.households
  for update to authenticated
  using (private.is_household_owner(id))
  with check (private.is_household_owner(id) and created_by = (select auth.uid()));

create policy households_delete_owner on public.households
  for delete to authenticated
  using (private.is_household_owner(id));

create policy household_members_read_members on public.household_members
  for select to authenticated
  using (private.is_household_member(household_id));

-- Membership writes are available only through the constrained RPC functions above.
-- Invitations have RLS enabled but intentionally have no client policies or client grants.

create policy household_categories_member_access on public.household_categories
  for all to authenticated
  using (private.is_household_member(household_id))
  with check (private.is_household_member(household_id));

create policy household_budgets_member_access on public.household_budgets
  for all to authenticated
  using (private.is_household_member(household_id))
  with check (private.is_household_member(household_id));

create policy household_entries_member_read on public.household_entries
  for select to authenticated
  using (private.is_household_member(household_id));

create policy household_entries_member_insert on public.household_entries
  for insert to authenticated
  with check (
    private.is_household_member(household_id)
    and created_by = (select auth.uid())
    and updated_by = (select auth.uid())
  );

create policy household_entries_member_update on public.household_entries
  for update to authenticated
  using (private.is_household_member(household_id))
  with check (private.is_household_member(household_id));

create policy household_entries_member_delete on public.household_entries
  for delete to authenticated
  using (private.is_household_member(household_id));

-- Only authenticated users may call these narrowly scoped SECURITY DEFINER functions.
revoke all on function public.create_xpense_household(text) from public, anon, authenticated;
revoke all on function public.create_household_invitation(uuid, text) from public, anon, authenticated;
revoke all on function public.accept_household_invitation(text) from public, anon, authenticated;
revoke all on function public.leave_xpense_household(uuid) from public, anon, authenticated;
revoke all on function public.remove_xpense_household_member(uuid, uuid) from public, anon, authenticated;

grant execute on function public.create_xpense_household(text) to authenticated;
grant execute on function public.create_household_invitation(uuid, text) to authenticated;
grant execute on function public.accept_household_invitation(text) to authenticated;
grant execute on function public.leave_xpense_household(uuid) to authenticated;
grant execute on function public.remove_xpense_household_member(uuid, uuid) to authenticated;

comment on table public.household_entries is
  'Shared household budget ledger only. Entries do not mutate either member private accounts or personal transaction ledger.';
comment on table public.household_invitations is
  'Invitation tokens are single-use and stored as SHA-256 hashes. Client roles have no table grants; use constrained RPC functions.';
comment on table public.household_members is
  'At most two active users per household are enforced by the invite-accept RPC, which locks the household row.';
