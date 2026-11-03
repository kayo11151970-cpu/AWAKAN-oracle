import {PGlite} from '@electric-sql/pglite';import {readFile} from 'node:fs/promises';import assert from 'node:assert/strict';
import test from 'node:test';
test('membership authorization and lifecycle in PostgreSQL',async()=>{
const db=new PGlite();
const owner='e77ae592-6316-444f-a4e4-dae3a8d4eb81',customer='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222',pending='33333333-3333-4333-8333-333333333333';
await db.exec(`create role anon; create role authenticated; create schema auth; create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
grant usage on schema auth to authenticated,anon;
create table public.awaken_members(user_id uuid primary key references auth.users(id),membership text not null default 'trial' check(membership in('trial','subscriber','disabled')),trial_used boolean not null default false,last_draw_at timestamptz,last_card_number integer check(last_card_number between 1 and 44),created_at timestamptz not null default now());
alter table public.awaken_members enable row level security;
create policy members_select_own on public.awaken_members for select to authenticated using ((select auth.uid())=user_id);
insert into auth.users values('${owner}','owner@example.com',now()),('${customer}','customer@example.com',now()),('${other}','other@example.com',now()),('${pending}','pending@example.com',null);
insert into public.awaken_members(user_id,membership,trial_used,last_draw_at,last_card_number)values('${owner}','subscriber',true,now(),10);`);
const migration=await readFile(new URL('../supabase/migrations/20261103_member_admin.sql',import.meta.url),'utf8');await db.exec(migration);
async function as(id,sql,args=[]){await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id||'']);await db.exec('set role '+(id?'authenticated':'anon'));try{return await db.query(sql,args);}finally{await db.exec('reset role');}}
const rpc=async(id,name,args=[])=>{const result=await as(id,`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) as data`,args);return result.rows[0].data;};
const fail=async(fn,pattern)=>assert.rejects(fn,pattern);
assert.equal((await rpc(owner,'awaken_status')).state,'subscriber_waiting');assert.equal(await rpc(owner,'awaken_is_admin'),true);assert.equal(await rpc(customer,'awaken_is_admin'),false);
for(const id of [null,customer]){await fail(()=>rpc(id,'awaken_admin_lookup',['customer@example.com']),/permission denied|ADMIN_REQUIRED/);await fail(()=>rpc(id,'awaken_admin_change',[customer,'activate']),/permission denied|ADMIN_REQUIRED/);}
await fail(()=>as(customer,`update public.awaken_members set membership='subscriber'`),/permission denied/);
await fail(()=>as(customer,'select * from awaken_private.administrators'),/permission denied/);
assert.equal((await as(customer,'select * from public.awaken_members')).rows.length,0);
assert.equal((await rpc(owner,'awaken_admin_lookup',['missing@example.com'])).found,false);
await fail(()=>rpc(owner,'awaken_admin_change',[pending,'activate']),/EMAIL_NOT_CONFIRMED/);
assert.equal((await rpc(customer,'awaken_status')).state,'trial_ready');
let draw=(await as(customer,'select * from public.awaken_draw()')).rows[0];assert.ok(draw.card_number>=1&&draw.card_number<=44);await fail(()=>rpc(customer,'awaken_draw'),/TRIAL_ALREADY_USED/);
let state=await rpc(owner,'awaken_admin_lookup',[' CUSTOMER@example.com ']);assert.equal(state.state,'trial_used');assert.equal(state.last_card_number,draw.card_number);
state=await rpc(owner,'awaken_admin_change',[customer,'activate']);assert.equal(state.can_draw,true);assert.equal(state.last_card_number,draw.card_number);
// Repeated activation while already active must not create additional credits.
await rpc(owner,'awaken_admin_change',[customer,'activate']);await as(customer,'select * from public.awaken_draw()');await fail(()=>rpc(customer,'awaken_draw'),/WAIT_SEVEN_DAYS/);
await rpc(owner,'awaken_admin_change',[customer,'activate']);assert.equal((await rpc(customer,'awaken_status')).can_draw,false);
await db.query(`update public.awaken_members set last_draw_at=clock_timestamp()-interval '168 hours'-interval '1 second' where user_id=$1`,[customer]);assert.equal((await rpc(customer,'awaken_status')).can_draw,true);await as(customer,'select * from public.awaken_draw()');await fail(()=>rpc(customer,'awaken_draw'),/WAIT_SEVEN_DAYS/);
state=await rpc(owner,'awaken_admin_change',[customer,'end_month']);const expected=(await db.query("select ((date_trunc('month',clock_timestamp() at time zone 'Asia/Tokyo')+interval '1 month') at time zone 'Asia/Tokyo') as boundary")).rows[0].boundary;assert.equal(new Date(state.membership_expires_at).getTime(),new Date(expected).getTime());
const end=state.membership_expires_at;state=await rpc(owner,'awaken_admin_change',[customer,'end_month']);assert.equal(state.membership_expires_at,end);assert.equal(state.can_draw,false);
await db.query(`update public.awaken_members set membership_expires_at=clock_timestamp()-interval '1 second', activation_credit=true,last_draw_at=clock_timestamp()-interval '8 days' where user_id=$1`,[customer]);assert.equal((await rpc(customer,'awaken_status')).state,'expired');await fail(()=>rpc(customer,'awaken_draw'),/MEMBERSHIP_EXPIRED/);await fail(()=>rpc(owner,'awaken_admin_change',[customer,'end_month']),/NOT_ACTIVE_SUBSCRIBER/);
state=await rpc(owner,'awaken_admin_change',[customer,'activate']);assert.equal(state.can_draw,true);assert.equal(state.membership_expires_at,null);await as(customer,'select * from public.awaken_draw()');
state=await rpc(owner,'awaken_admin_change',[customer,'end_month']);state=await rpc(owner,'awaken_admin_change',[customer,'activate']);assert.equal(state.membership_expires_at,null);assert.equal(state.can_draw,false);
await db.query(`update public.awaken_members set membership='trial',trial_used=false where user_id=$1`,[customer]);await fail(()=>rpc(customer,'awaken_draw'),/TRIAL_ALREADY_USED/);
await db.query(`update public.awaken_members set membership='disabled' where user_id=$1`,[customer]);await fail(()=>rpc(customer,'awaken_draw'),/ACCOUNT_DISABLED/);
assert.equal((await as(other,'select * from public.awaken_members')).rows.length,0);
const row=(await db.query('select * from public.awaken_members where user_id=$1',[owner])).rows[0];const boundary=new Date(new Date(row.last_draw_at).getTime()+168*3600000).toISOString();assert.equal((await db.query('select awaken_private.member_state(m,$1::timestamptz) as data from public.awaken_members m where user_id=$2',[boundary,owner])).rows[0].data.can_draw,true);
const audit=await db.query('select * from awaken_private.membership_audit');assert.ok(audit.rows.length>=5);assert.ok(audit.rows.every(a=>a.actor_id===owner));
// Re-applying the migration preserves trial use, reading history, and admin restrictions.
const before=(await db.query('select * from public.awaken_members order by user_id')).rows;await db.exec(migration);const after=(await db.query('select * from public.awaken_members order by user_id')).rows;assert.deepEqual(after,before);
await db.close();console.log('PASS actual PostgreSQL: role/RLS/admin denial, trial one-time, immediate activation, idempotent activation, 168h, JST month boundary, expiration/renewal, trial non-revival, disabled, audit, migration repeatability.');

});
