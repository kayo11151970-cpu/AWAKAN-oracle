begin;

-- Additive migration: do not reset existing reading history or trial use.
alter table public.awaken_members
  add column if not exists membership_expires_at timestamptz,
  add column if not exists activation_credit boolean not null default false,
  add column if not exists ever_subscriber boolean not null default false;
update public.awaken_members
set ever_subscriber = true
where membership = 'subscriber' and not ever_subscriber;

create schema if not exists awaken_private;
revoke all on schema awaken_private from public, anon, authenticated;
create table if not exists awaken_private.administrators (
  user_id uuid primary key references auth.users(id),
  created_at timestamptz not null default now()
);
create table if not exists awaken_private.membership_audit (
  id bigint generated always as identity primary key,
  actor_id uuid not null,
  target_id uuid not null,
  action text not null,
  before_state jsonb not null,
  after_state jsonb not null,
  created_at timestamptz not null default clock_timestamp()
);
alter table awaken_private.administrators enable row level security;
alter table awaken_private.membership_audit enable row level security;
revoke all on all tables in schema awaken_private from public, anon, authenticated;
revoke all on all sequences in schema awaken_private from public, anon, authenticated;

-- Bootstrap only the verified owner account. No client can add administrators.
do $$
begin
  if not exists (
    select 1 from auth.users
    where id = 'e77ae592-6316-444f-a4e4-dae3a8d4eb81'::uuid
      and email_confirmed_at is not null
  ) then
    raise exception 'OWNER_ACCOUNT_NOT_VERIFIED';
  end if;
  insert into awaken_private.administrators (user_id)
  values ('e77ae592-6316-444f-a4e4-dae3a8d4eb81')
  on conflict do nothing;
end;
$$;

create or replace function public.awaken_is_admin()
returns boolean language sql stable security definer set search_path = ''
as $$
  select auth.uid() is not null and exists (
    select 1 from awaken_private.administrators a where a.user_id = auth.uid()
  );
$$;

create or replace function awaken_private.member_state(
  m public.awaken_members, at_time timestamptz
)
returns jsonb language plpgsql stable set search_path = ''
as $$
declare
  state text;
  allowed boolean := false;
  next_at timestamptz;
begin
  if m.membership = 'disabled' then
    state := 'disabled';
  elsif m.membership = 'subscriber' then
    if m.membership_expires_at is not null and at_time >= m.membership_expires_at then
      state := 'expired';
    elsif m.activation_credit or m.last_draw_at is null
          or at_time >= m.last_draw_at + interval '168 hours' then
      state := 'subscriber_ready'; allowed := true;
    else
      state := 'subscriber_waiting';
      next_at := m.last_draw_at + interval '168 hours';
    end if;
  elsif m.membership = 'trial' and not m.trial_used and not m.ever_subscriber then
    state := 'trial_ready'; allowed := true;
  else
    state := 'trial_used';
  end if;
  return jsonb_build_object(
    'membership', m.membership, 'state', state, 'can_draw', allowed,
    'trial_used', m.trial_used, 'last_draw_at', m.last_draw_at,
    'last_card_number', m.last_card_number, 'next_available_at', next_at,
    'membership_expires_at', m.membership_expires_at
  );
end;
$$;
revoke all on function awaken_private.member_state(public.awaken_members,timestamptz)
  from public, anon, authenticated;

create or replace function public.awaken_status()
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  m public.awaken_members%rowtype;
begin
  if uid is null then raise exception 'LOGIN_REQUIRED'; end if;
  insert into public.awaken_members (user_id) values (uid) on conflict do nothing;
  select * into m from public.awaken_members where user_id = uid;
  return awaken_private.member_state(m, clock_timestamp());
end;
$$;

-- Preserve the original RPC's signature so existing clients continue working.
create or replace function public.awaken_draw()
returns table (card_number integer, drawn_at timestamptz, next_available_at timestamptz)
language plpgsql security definer set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  m public.awaken_members%rowtype;
  at_time timestamptz;
  status jsonb;
  selected integer;
begin
  if uid is null then raise exception 'LOGIN_REQUIRED'; end if;
  insert into public.awaken_members (user_id) values (uid) on conflict do nothing;
  select * into m from public.awaken_members where user_id = uid for update;
  at_time := clock_timestamp();
  status := awaken_private.member_state(m, at_time);
  if not (status->>'can_draw')::boolean then
    case status->>'state'
      when 'disabled' then raise exception 'ACCOUNT_DISABLED';
      when 'expired' then raise exception 'MEMBERSHIP_EXPIRED';
      when 'subscriber_waiting' then raise exception 'WAIT_SEVEN_DAYS';
      else raise exception 'TRIAL_ALREADY_USED';
    end case;
  end if;
  selected := floor(random() * 44)::integer + 1;
  update public.awaken_members set
    trial_used = true,
    activation_credit = false,
    last_draw_at = at_time,
    last_card_number = selected
  where user_id = uid;
  return query select selected, at_time,
    case when m.membership = 'subscriber' then at_time + interval '168 hours'
    else null::timestamptz end;
end;
$$;

create or replace function public.awaken_admin_lookup(p_email text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  target uuid;
  email_address text;
  confirmed boolean;
  m public.awaken_members%rowtype;
begin
  if not public.awaken_is_admin() then raise exception 'ADMIN_REQUIRED'; end if;
  if p_email is null or length(trim(p_email)) > 254 or trim(p_email) = '' then
    raise exception 'INVALID_EMAIL';
  end if;
  select u.id, u.email, (u.email_confirmed_at is not null)
    into target, email_address, confirmed
    from auth.users u where lower(u.email) = lower(trim(p_email));
  if target is null then return jsonb_build_object('found', false); end if;
  select * into m from public.awaken_members where user_id = target;
  if m.user_id is null then
    m.user_id := target; m.membership := 'trial'; m.trial_used := false;
    m.activation_credit := false; m.ever_subscriber := false;
  end if;
  return awaken_private.member_state(m, clock_timestamp()) ||
    jsonb_build_object('found', true, 'user_id', target, 'email', email_address,
                      'email_confirmed', confirmed);
end;
$$;

create or replace function public.awaken_admin_change(p_user_id uuid, p_action text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  m public.awaken_members%rowtype;
  before_value jsonb;
  at_time timestamptz;
  month_end timestamptz;
  address text;
  confirmed boolean;
begin
  if not public.awaken_is_admin() then raise exception 'ADMIN_REQUIRED'; end if;
  if p_action is null or p_action not in ('activate', 'end_month') then
    raise exception 'INVALID_ACTION';
  end if;
  select email, (email_confirmed_at is not null) into address, confirmed
    from auth.users where id = p_user_id for share;
  if address is null then raise exception 'USER_NOT_FOUND'; end if;
  if not confirmed then raise exception 'EMAIL_NOT_CONFIRMED'; end if;
  insert into public.awaken_members(user_id) values (p_user_id) on conflict do nothing;
  select * into m from public.awaken_members where user_id = p_user_id for update;
  at_time := clock_timestamp();
  before_value := to_jsonb(m);
  if p_action = 'activate' then
    if m.membership = 'subscriber' and
       (m.membership_expires_at is null or m.membership_expires_at > at_time) then
      -- Continuing an active membership never grants an additional draw.
      update public.awaken_members set membership_expires_at = null
      where user_id = p_user_id;
    else
      -- One activation credit; preserve the card/date and the used trial record.
      update public.awaken_members set membership = 'subscriber',
        ever_subscriber = true, trial_used = true, activation_credit = true,
        membership_expires_at = null
      where user_id = p_user_id;
    end if;
  else
    if m.membership <> 'subscriber' or
       (m.membership_expires_at is not null and m.membership_expires_at <= at_time) then
      raise exception 'NOT_ACTIVE_SUBSCRIBER';
    end if;
    month_end := (date_trunc('month', at_time at time zone 'Asia/Tokyo')
                    + interval '1 month') at time zone 'Asia/Tokyo';
    update public.awaken_members
    set membership_expires_at = least(coalesce(m.membership_expires_at, month_end),month_end)
    where user_id = p_user_id;
  end if;
  select * into m from public.awaken_members where user_id = p_user_id;
  if before_value is distinct from to_jsonb(m) then
    insert into awaken_private.membership_audit(actor_id,target_id,action,before_state,after_state)
    values (actor,p_user_id,p_action,before_value,to_jsonb(m));
  end if;
  return awaken_private.member_state(m, clock_timestamp()) ||
    jsonb_build_object('found', true, 'user_id', p_user_id, 'email', address,
                      'email_confirmed', confirmed);
end;
$$;

-- Clients cannot update membership, reset trials, or change their own admin role.
alter table public.awaken_members enable row level security;
drop policy if exists awaken_members_owner_guard on public.awaken_members;
create policy awaken_members_owner_guard on public.awaken_members
  as restrictive for select to authenticated
  using ((select auth.uid()) = user_id);
revoke all on public.awaken_members from public, anon, authenticated;
grant select on public.awaken_members to authenticated;
revoke all on function public.awaken_is_admin() from public, anon, authenticated;
revoke all on function public.awaken_status() from public, anon, authenticated;
revoke all on function public.awaken_draw() from public, anon, authenticated;
revoke all on function public.awaken_admin_lookup(text) from public, anon, authenticated;
revoke all on function public.awaken_admin_change(uuid,text) from public, anon, authenticated;
grant execute on function public.awaken_is_admin() to authenticated;
grant execute on function public.awaken_status() to authenticated;
grant execute on function public.awaken_draw() to authenticated;
grant execute on function public.awaken_admin_lookup(text) to authenticated;
grant execute on function public.awaken_admin_change(uuid,text) to authenticated;

notify pgrst, 'reload schema';
commit;
