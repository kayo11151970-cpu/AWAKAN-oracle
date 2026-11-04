begin;

create table if not exists awaken_private.paid_preregistrations (
  email text primary key check(email = lower(trim(email))),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default clock_timestamp(),
  claimed_by uuid references auth.users(id),
  claimed_at timestamptz,
  cancelled_at timestamptz,
  check ((claimed_by is null) = (claimed_at is null))
);
alter table awaken_private.paid_preregistrations enable row level security;
revoke all on awaken_private.paid_preregistrations from public,anon,authenticated;

create or replace function awaken_private.registration_view(p_email text, at_time timestamptz)
returns jsonb language plpgsql stable set search_path = ''
as $$
declare
  target uuid; address text; confirmed boolean := false; registered timestamptz;
  pending awaken_private.paid_preregistrations%rowtype;
  m public.awaken_members%rowtype; result jsonb;
begin
  select u.id,u.email,u.email_confirmed_at is not null,u.created_at
    into target,address,confirmed,registered from auth.users u
    where lower(u.email)=lower(trim(p_email));
  select * into pending from awaken_private.paid_preregistrations
    where email=lower(trim(p_email)) and claimed_at is null and cancelled_at is null;
  if target is null and pending.email is null then return jsonb_build_object('found',false); end if;
  if target is not null then select * into m from public.awaken_members where user_id=target; end if;
  if m.user_id is null then
    m.user_id:=target;m.membership:='trial';m.trial_used:=false;m.ever_subscriber:=false;m.activation_credit:=false;
  end if;
  result:=awaken_private.member_state(m,at_time);
  if pending.email is not null and m.membership='trial' and not m.ever_subscriber then
    result:=result||jsonb_build_object('membership','preregistered','state','preregistered','can_draw',false,'next_available_at',null);
    registered:=pending.created_at;
  end if;
  return result||jsonb_build_object('found',true,'user_id',target,'email',coalesce(address,pending.email),
    'email_confirmed',coalesce(confirmed,false),'registered_at',registered,
    'preregistration_pending',pending.email is not null);
end;
$$;
revoke all on function awaken_private.registration_view(text,timestamptz) from public,anon,authenticated;

create or replace function awaken_private.claim_paid_registration(uid uuid)
returns void language plpgsql set search_path = ''
as $$
declare
  address text; confirmed boolean; p awaken_private.paid_preregistrations%rowtype;
  m public.awaken_members%rowtype; before_value jsonb;
begin
  select email,email_confirmed_at is not null into address,confirmed
    from auth.users where id=uid for share;
  if not coalesce(confirmed,false) then return; end if;
  select * into p from awaken_private.paid_preregistrations
    where email=lower(address) and claimed_at is null and cancelled_at is null for update;
  if not found then return; end if;
  insert into public.awaken_members(user_id)values(uid)on conflict do nothing;
  select * into m from public.awaken_members where user_id=uid for update;
  before_value:=to_jsonb(m);
  if m.membership='trial' and not m.ever_subscriber then
    update public.awaken_members set membership='subscriber',ever_subscriber=true,trial_used=true,
      activation_credit=true,membership_expires_at=null,membership_end_source=null where user_id=uid;
    select * into m from public.awaken_members where user_id=uid;
    insert into awaken_private.membership_audit(actor_id,target_id,action,before_state,after_state)
      values(p.created_by,uid,'preregistration_claim',before_value,to_jsonb(m));
  elsif m.membership='subscriber' and (m.membership_expires_at is null or m.membership_expires_at>clock_timestamp()) then
    -- An independently activated member keeps their cooldown and cancellation.
    null;
  else
    -- Never revive disabled/expired accounts from a stale reservation.
    return;
  end if;
  update awaken_private.paid_preregistrations set claimed_by=uid,claimed_at=clock_timestamp()
    where email=p.email;
end;
$$;
revoke all on function awaken_private.claim_paid_registration(uuid) from public,anon,authenticated;

create or replace function public.awaken_admin_preregister(p_email text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  address text:=lower(trim(p_email)); target uuid; confirmed boolean;
  p awaken_private.paid_preregistrations%rowtype; m public.awaken_members%rowtype; result jsonb;
begin
  if not public.awaken_is_admin() then raise exception 'ADMIN_REQUIRED';end if;
  if address is null or length(address)>254 or address !~ '^[^[:space:]@]+@[^[:space:]@]+$' then
    raise exception 'INVALID_EMAIL';end if;
  select id,email_confirmed_at is not null into target,confirmed from auth.users
    where lower(email)=address for share;
  if target is not null and confirmed then
    select * into p from awaken_private.paid_preregistrations where email=address for update;
    select * into m from public.awaken_members where user_id=target for update;
    if m.membership='subscriber' and (m.membership_expires_at is null or m.membership_expires_at>clock_timestamp()) then
      result:=awaken_private.registration_view(address,clock_timestamp());
    else
      result:=public.awaken_admin_change(target,'activate');
    end if;
    update awaken_private.paid_preregistrations set claimed_by=target,claimed_at=clock_timestamp()
      where email=address and claimed_at is null and cancelled_at is null;
    return result||jsonb_build_object('registration_kind','activated','preregistration_pending',false);
  end if;
  if target is not null then
    select * into m from public.awaken_members where user_id=target;
    if m.user_id is not null and (m.membership<>'trial' or m.ever_subscriber) then
      raise exception 'EMAIL_NOT_CONFIRMED';end if;
  end if;
  insert into awaken_private.paid_preregistrations(email,created_by)values(address,auth.uid())on conflict do nothing;
  select * into p from awaken_private.paid_preregistrations where email=address for update;
  if p.claimed_at is not null then raise exception 'REGISTRATION_ALREADY_LINKED';end if;
  if p.cancelled_at is not null then
    update awaken_private.paid_preregistrations set cancelled_at=null,created_by=auth.uid(),created_at=clock_timestamp()where email=address;
  end if;
  return awaken_private.registration_view(address,clock_timestamp())||jsonb_build_object('registration_kind','pending');
end;
$$;

create or replace function public.awaken_admin_cancel_preregistration(p_email text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  address text:=lower(trim(p_email)); p awaken_private.paid_preregistrations%rowtype;
begin
  if not public.awaken_is_admin() then raise exception 'ADMIN_REQUIRED';end if;
  select * into p from awaken_private.paid_preregistrations where email=address for update;
  if not found or p.claimed_at is not null then raise exception 'NO_PENDING_REGISTRATION';end if;
  update awaken_private.paid_preregistrations set cancelled_at=coalesce(cancelled_at,clock_timestamp())where email=address;
  return jsonb_build_object('cancelled',true,'email',address);
end;
$$;

create or replace function public.awaken_admin_lookup(p_email text)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.awaken_is_admin()then raise exception 'ADMIN_REQUIRED';end if;
  if p_email is null or length(trim(p_email))>254 or trim(p_email)=''then raise exception 'INVALID_EMAIL';end if;
  return awaken_private.registration_view(p_email,clock_timestamp());
end;
$$;

create or replace function public.awaken_status()
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  m public.awaken_members%rowtype;
begin
  if uid is null then raise exception 'LOGIN_REQUIRED'; end if;
  perform awaken_private.claim_paid_registration(uid);
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
  perform awaken_private.claim_paid_registration(uid);
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

create or replace function public.awaken_admin_list(
  p_filter text default 'all',
  p_search text default '',
  p_page integer default 1,
  p_page_size integer default 25
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  at_time timestamptz := clock_timestamp();
  search_text text := lower(trim(coalesce(p_search, '')));
  response jsonb;
begin
  if not public.awaken_is_admin() then raise exception 'ADMIN_REQUIRED'; end if;
  if p_filter is null or p_filter not in ('all','members','trial','ending','ended','disabled','preregistered') then
    raise exception 'INVALID_FILTER';
  end if;
  if p_page is null or p_page < 1 or p_page > 100000
     or p_page_size is null or p_page_size < 1 or p_page_size > 100
     or length(search_text) > 254 then
    raise exception 'INVALID_PAGINATION_OR_SEARCH';
  end if;

  with emails as (
    select lower(email) as email from auth.users where email is not null
    union
    select email from awaken_private.paid_preregistrations where claimed_at is null and cancelled_at is null
  ), states as materialized (
    select awaken_private.registration_view(email,at_time) as status from emails
    where search_text='' or strpos(email,search_text)>0
  ), filtered as materialized (
    select * from states
    where p_filter = 'all'
      or (p_filter = 'members' and status->>'state' in ('subscriber_ready','subscriber_waiting'))
      or (p_filter = 'trial' and status->>'state' in ('trial_ready','trial_used'))
      or (p_filter = 'ending' and status->>'state' in ('subscriber_ready','subscriber_waiting')
          and (status->>'membership_expires_at')::timestamptz > at_time)
      or (p_filter = 'ended' and status->>'state' = 'expired')
      or (p_filter = 'preregistered' and status->>'state' = 'preregistered')
      or (p_filter = 'disabled' and status->>'state' = 'disabled')
  ), page_rows as (
    select * from filtered
    order by (status->>'registered_at')::timestamptz desc nulls last,status->>'email'
    offset ((p_page::bigint - 1) * p_page_size)
    limit p_page_size
  )
  select jsonb_build_object(
    'total', (select count(*) from filtered),
    'page', p_page, 'page_size', p_page_size, 'server_time', at_time,
    'rows', coalesce((
      select jsonb_agg(status order by (status->>'registered_at')::timestamptz desc nulls last,status->>'email')
      from page_rows
    ), '[]'::jsonb)
  ) into response;
  return response;
end;
$$;

revoke all on function public.awaken_admin_list(text,text,integer,integer)
  from public, anon, authenticated;
grant execute on function public.awaken_admin_list(text,text,integer,integer)
  to authenticated;

revoke all on function public.awaken_admin_preregister(text) from public,anon,authenticated;
revoke all on function public.awaken_admin_cancel_preregistration(text) from public,anon,authenticated;
revoke all on function public.awaken_admin_lookup(text) from public,anon,authenticated;
grant execute on function public.awaken_admin_preregister(text) to authenticated;
grant execute on function public.awaken_admin_cancel_preregistration(text) to authenticated;
grant execute on function public.awaken_admin_lookup(text) to authenticated;
notify pgrst,'reload schema';
commit;
