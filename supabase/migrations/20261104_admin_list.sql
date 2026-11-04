begin;

-- Read-only listing: no changes to draw/cancellation RPCs, tables, or policies.
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
  if p_filter is null or p_filter not in ('all','members','trial','ending','ended','disabled') then
    raise exception 'INVALID_FILTER';
  end if;
  if p_page is null or p_page < 1 or p_page > 100000
     or p_page_size is null or p_page_size < 1 or p_page_size > 100
     or length(search_text) > 254 then
    raise exception 'INVALID_PAGINATION_OR_SEARCH';
  end if;

  with candidates as materialized (
    select u.id, u.email, (u.email_confirmed_at is not null) as email_confirmed,
      u.created_at as registered_at,
      case when m.user_id is null then
        jsonb_populate_record(null::public.awaken_members, jsonb_build_object(
          'user_id',u.id, 'membership','trial', 'trial_used',false,
          'activation_credit',false, 'ever_subscriber',false, 'created_at',u.created_at
        ))
      else m end as member
    from auth.users u
    left join public.awaken_members m on m.user_id = u.id
    where u.email is not null
      and (search_text = '' or strpos(lower(u.email), search_text) > 0)
  ), states as materialized (
    select id,email,email_confirmed,registered_at,
      awaken_private.member_state(member, at_time) as status
    from candidates
  ), filtered as materialized (
    select * from states
    where p_filter = 'all'
      or (p_filter = 'members' and status->>'state' in ('subscriber_ready','subscriber_waiting'))
      or (p_filter = 'trial' and status->>'state' in ('trial_ready','trial_used'))
      or (p_filter = 'ending' and status->>'state' in ('subscriber_ready','subscriber_waiting')
          and (status->>'membership_expires_at')::timestamptz > at_time)
      or (p_filter = 'ended' and status->>'state' = 'expired')
      or (p_filter = 'disabled' and status->>'state' = 'disabled')
  ), page_rows as (
    select * from filtered
    order by registered_at desc nulls last, id
    offset ((p_page::bigint - 1) * p_page_size)
    limit p_page_size
  )
  select jsonb_build_object(
    'total', (select count(*) from filtered),
    'page', p_page, 'page_size', p_page_size, 'server_time', at_time,
    'rows', coalesce((
      select jsonb_agg(status || jsonb_build_object(
        'found',true, 'user_id',id, 'email',email,
        'email_confirmed',email_confirmed, 'registered_at',registered_at
      ) order by registered_at desc nulls last,id)
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

notify pgrst, 'reload schema';
commit;
