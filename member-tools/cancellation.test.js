import {PGlite} from '@electric-sql/pglite';import {readFile} from 'node:fs/promises';import assert from 'node:assert/strict';import test from 'node:test';
test('self cancellation is owner-only, admin-locked, idempotent and preserves eligibility',async()=>{
 const db=new PGlite();
 const owner='e77ae592-6316-444f-a4e4-dae3a8d4eb81',a='11111111-1111-4111-8111-111111111111',b='22222222-2222-4222-8222-222222222222',free='33333333-3333-4333-8333-333333333333';
 try{
 await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth to authenticated,anon;
 create table public.awaken_members(user_id uuid primary key references auth.users(id),membership text not null default 'trial' check(membership in('trial','subscriber','disabled')),trial_used boolean not null default false,last_draw_at timestamptz,last_card_number integer check(last_card_number between 1 and 44),created_at timestamptz not null default now());
 alter table public.awaken_members enable row level security;
 create policy members_select_own on public.awaken_members for select to authenticated using ((select auth.uid())=user_id);
 insert into auth.users values('${owner}','owner@example.com',now()),('${a}','a@example.com',now()),('${b}','b@example.com',now()),('${free}','free@example.com',now());
 insert into public.awaken_members(user_id,membership,trial_used,last_draw_at,last_card_number) values('${a}','subscriber',true,clock_timestamp(),22),('${b}','subscriber',true,clock_timestamp(),23),('${free}','trial',false,null,null);`);
 const old=await readFile(new URL('../supabase/migrations/20261103_member_admin.sql',import.meta.url),'utf8');await db.exec(old);
 await db.query(`update public.awaken_members set membership_expires_at=clock_timestamp()+interval '10 days' where user_id=$1`,[b]);
 const sql=await readFile(new URL('../supabase/migrations/20261103_self_cancellation.sql',import.meta.url),'utf8');await db.exec(sql);
 async function as(id,query,params=[]){await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id||'']);await db.exec('set role '+(id?'authenticated':'anon'));try{return await db.query(query,params);}finally{await db.exec('reset role');}}
 async function rpc(id,name,args=[]){return (await as(id,`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) as data`,args)).rows[0].data;}
 const row=async id=>(await db.query('select * from public.awaken_members where user_id=$1',[id])).rows[0];
 const fields=m=>({last_draw_at:m.last_draw_at,last_card_number:m.last_card_number,activation_credit:m.activation_credit,trial_used:m.trial_used,ever_subscriber:m.ever_subscriber});
 assert.equal((await row(b)).membership_end_source,'admin');
 await assert.rejects(()=>rpc(null,'awaken_self_cancellation',['request',null]),/permission denied/);
 await assert.rejects(()=>rpc(free,'awaken_self_cancellation',['request',null]),/NOT_ACTIVE_SUBSCRIBER/);
 await assert.rejects(()=>rpc(a,'awaken_admin_change',[b,'activate']),/ADMIN_REQUIRED/);
 await assert.rejects(()=>as(a,"update public.awaken_members set membership_end_source='customer' where user_id=$1",[b]),/permission denied/);
 const beforeA=await row(a),beforeB=await row(b);let state=await rpc(a,'awaken_status');const expected=state.cancellation_effective_at;
 assert.equal(state.can_request_cancellation,true);assert.equal(state.can_cancel_cancellation,false);
 await assert.rejects(()=>rpc(a,'awaken_self_cancellation',['request','2099-01-01T00:00:00Z']),/CANCELLATION_DATE_CHANGED/);assert.deepEqual(await row(a),beforeA);
 state=await rpc(a,'awaken_self_cancellation',['request',expected]);assert.equal(state.membership_end_source,'customer');assert.equal(state.can_cancel_cancellation,true);assert.equal(state.can_draw,false);assert.equal(state.state,'subscriber_waiting');
 const saved=await row(a);assert.deepEqual(fields(saved),fields(beforeA));assert.deepEqual(await row(b),beforeB);
 const calculated=(await db.query("select ((date_trunc('month',clock_timestamp() at time zone 'Asia/Tokyo')+interval '1 month') at time zone 'Asia/Tokyo') as time")).rows[0].time;assert.equal(new Date(state.membership_expires_at).getTime(),new Date(calculated).getTime());
 await rpc(a,'awaken_self_cancellation',['request',expected]);assert.deepEqual(await row(a),saved);
 state=await rpc(a,'awaken_self_cancellation',['undo',expected]);assert.equal(state.membership_expires_at,null);assert.equal(state.membership_end_source,null);assert.equal(state.can_draw,false);assert.deepEqual(fields(await row(a)),fields(beforeA));
 await rpc(a,'awaken_self_cancellation',['undo',expected]);assert.deepEqual(fields(await row(a)),fields(beforeA));
 // A reservation does not block the usual 168-hour draw or grant extra draws.
 state=await rpc(a,'awaken_status');await rpc(a,'awaken_self_cancellation',['request',state.cancellation_effective_at]);await assert.rejects(()=>rpc(a,'awaken_draw'),/WAIT_SEVEN_DAYS/);
 await db.query("update public.awaken_members set last_draw_at=clock_timestamp()-interval '169 hours' where user_id=$1",[a]);const reading=(await as(a,'select * from public.awaken_draw()')).rows[0];assert.ok(reading.card_number>=1&&reading.card_number<=44);assert.equal((await row(a)).membership_end_source,'customer');await assert.rejects(()=>rpc(a,'awaken_draw'),/WAIT_SEVEN_DAYS/);
 // Owner takeover cannot be reversed by the customer, even with an old valid date.
 state=await rpc(owner,'awaken_admin_change',[a,'end_month']);assert.equal(state.membership_end_source,'admin');const locked=await row(a);
 for(const action of ['request','undo'])await assert.rejects(()=>rpc(a,'awaken_self_cancellation',[action,state.membership_expires_at]),/ADMIN_CANCELLATION_LOCKED/);
 assert.deepEqual(await row(a),locked);
 state=await rpc(owner,'awaken_admin_change',[a,'activate']);assert.equal(state.membership_end_source,null);assert.equal(state.membership_expires_at,null);assert.equal(state.can_draw,false);
 // Expiration takes precedence over cooldown/activation; only the admin may reactivate.
 await db.query("update public.awaken_members set membership_expires_at=clock_timestamp()-interval '1 second',membership_end_source='customer',activation_credit=true where user_id=$1",[a]);
 state=await rpc(a,'awaken_status');assert.equal(state.state,'expired');assert.equal(state.can_cancel_cancellation,false);assert.equal(state.can_request_cancellation,false);
 await assert.rejects(()=>rpc(a,'awaken_self_cancellation',['undo',state.membership_expires_at]),/MEMBERSHIP_EXPIRED/);await assert.rejects(()=>rpc(a,'awaken_draw'),/MEMBERSHIP_EXPIRED/);
 state=await rpc(owner,'awaken_admin_change',[a,'activate']);assert.equal(state.can_draw,true);assert.equal(state.membership_end_source,null);await as(a,'select * from public.awaken_draw()');await assert.rejects(()=>rpc(a,'awaken_draw'),/WAIT_SEVEN_DAYS/);
 // At the exact exclusive deadline, customer undo and draw are both unavailable.
 await db.query("update public.awaken_members set membership_expires_at=clock_timestamp()+interval '1 day',membership_end_source='customer' where user_id=$1",[a]);
 const boundary=(await db.query('select awaken_private.member_state(m,m.membership_expires_at) as data from public.awaken_members m where user_id=$1',[a])).rows[0].data;assert.equal(boundary.state,'expired');assert.equal(boundary.can_cancel_cancellation,false);assert.equal(boundary.can_draw,false);
 // Disabled subscribers and used trials remain restricted.
 await db.query("update public.awaken_members set membership='disabled' where user_id=$1",[a]);await assert.rejects(()=>rpc(a,'awaken_self_cancellation',['request',null]),/NOT_ACTIVE_SUBSCRIBER/);await assert.rejects(()=>rpc(a,'awaken_draw'),/ACCOUNT_DISABLED/);
 await as(free,'select * from public.awaken_draw()');await assert.rejects(()=>rpc(free,'awaken_draw'),/TRIAL_ALREADY_USED/);
 const before=(await db.query('select * from public.awaken_members order by user_id')).rows;await db.exec(sql);assert.deepEqual((await db.query('select * from public.awaken_members order by user_id')).rows,before);
 const audits=(await db.query("select * from awaken_private.membership_audit where action like 'customer_%'")).rows;assert.ok(audits.length>=3);assert.ok(audits.every(x=>x.actor_id===a&&x.target_id===a));await assert.rejects(()=>as(a,'select * from awaken_private.membership_audit'),/permission denied/);
 console.log('PASS customer request/undo, owner locks, identity isolation, exact expiry, JST month-end, 168h/trial regressions, no credit reset, no extra draws, audits, repeatable migration.');
 }finally{await db.close();}
});
