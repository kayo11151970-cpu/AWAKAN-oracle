begin;

-- Existing expiry reservations were made by the owner, so preserve their lock.
alter table public.awaken_members
  add column if not exists membership_end_source text
    check (membership_end_source in ('customer', 'admin'));
update public.awaken_members set membership_end_source = 'admin'
where membership_expires_at is not null and membership_end_source is null;

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
    'membership_expires_at', m.membership_expires_at,
    'membership_end_source', m.membership_end_source,
    'can_request_cancellation', (m.membership = 'subscriber' and m.membership_expires_at is null),
    'can_cancel_cancellation', coalesce((m.membership = 'subscriber' and m.membership_expires_at > at_time and m.membership_end_source = 'customer'), false),
    'cancellation_effective_at', case
      when m.membership = 'subscriber' and m.membership_expires_at is null then
        (date_trunc('month', at_time at time zone 'Asia/Tokyo') + interval '1 month') at time zone 'Asia/Tokyo'
      else m.membership_expires_at end
  );
end;
$$;
revoke all on function awaken_private.member_state(public.awaken_members,timestamptz)
  from public, anon, authenticated;

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
      update public.awaken_members set membership_expires_at = null, membership_end_source = null
      where user_id = p_user_id;
    else
      -- One activation credit; preserve the card/date and the used trial record.
      update public.awaken_members set membership = 'subscriber',
        ever_subscriber = true, trial_used = true, activation_credit = true,
        membership_expires_at = null, membership_end_source = null
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
    set membership_expires_at = least(coalesce(m.membership_expires_at, month_end),month_end),
        membership_end_source = 'admin'
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

create or replace function public.awaken_self_cancellation(
  p_action text,
  p_expected_end_at timestamptz default null
)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  m public.awaken_members%rowtype;
  before_value jsonb;
  at_time timestamptz;
  month_end timestamptz;
begin
  if uid is null then raise exception 'LOGIN_REQUIRED'; end if;
  if p_action is null or p_action not in ('request', 'undo') then
    raise exception 'INVALID_ACTION';
  end if;
  select * into m from public.awaken_members where user_id = uid for update;
  if not found or m.membership <> 'subscriber' then
    raise exception 'NOT_ACTIVE_SUBSCRIBER';
  end if;
  at_time := clock_timestamp();
  if m.membership_expires_at is not null and m.membership_expires_at <= at_time then
    raise exception 'MEMBERSHIP_EXPIRED';
  end if;
  before_value := to_jsonb(m);
  if m.membership_expires_at is not null and m.membership_end_source is distinct from 'customer' then
    raise exception 'ADMIN_CANCELLATION_LOCKED';
  end if;
  if p_action = 'request' then
    month_end := coalesce(m.membership_expires_at,
      (date_trunc('month', at_time at time zone 'Asia/Tokyo') + interval '1 month') at time zone 'Asia/Tokyo');
    if p_expected_end_at is distinct from month_end then
      raise exception 'CANCELLATION_DATE_CHANGED';
    end if;
    -- Repeated requests preserve the original deadline, not another month.
    if m.membership_expires_at is null then
      update public.awaken_members
      set membership_expires_at = month_end, membership_end_source = 'customer'
      where user_id = uid;
    end if;
  else
    if m.membership_expires_at is not null then
      if p_expected_end_at is distinct from m.membership_expires_at then
        raise exception 'CANCELLATION_DATE_CHANGED';
      end if;
      update public.awaken_members
      set membership_expires_at = null, membership_end_source = null
      where user_id = uid;
    end if;
  end if;
  select * into m from public.awaken_members where user_id = uid;
  if before_value is distinct from to_jsonb(m) then
    insert into awaken_private.membership_audit(actor_id,target_id,action,before_state,after_state)
    values (uid,uid,case when p_action = 'request' then 'customer_end_month' else 'customer_cancel_end' end,
            before_value,to_jsonb(m));
  end if;
  return awaken_private.member_state(m, clock_timestamp());
end;
$$;
revoke all on function public.awaken_self_cancellation(text,timestamptz)
  from public, anon, authenticated;
grant execute on function public.awaken_self_cancellation(text,timestamptz)
  to authenticated;
revoke all on function public.awaken_admin_change(uuid,text)
  from public, anon, authenticated;
grant execute on function public.awaken_admin_change(uuid,text)
  to authenticated;

notify pgrst, 'reload schema';
commit;
