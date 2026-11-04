import {PGlite} from '@electric-sql/pglite';import {readFile} from 'node:fs/promises';import assert from 'node:assert/strict';import test from 'node:test';
test('admin listing is read-only, private, complete, filtered and paginated',async()=>{
 const db=new PGlite();const owner='e77ae592-6316-444f-a4e4-dae3a8d4eb81';
 const ids=Array.from({length:9},(_,i)=>`11111111-1111-4111-8111-${String(i+1).padStart(12,'0')}`);
 try{
 await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,created_at timestamptz default now());
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to anon,authenticated;
 create table public.awaken_members(user_id uuid primary key references auth.users(id),membership text not null default 'trial' check(membership in('trial','subscriber','disabled')),trial_used boolean not null default false,last_draw_at timestamptz,last_card_number integer check(last_card_number between 1 and 44),created_at timestamptz not null default now());
 alter table public.awaken_members enable row level security;create policy members_select_own on public.awaken_members for select to authenticated using ((select auth.uid())=user_id);
 insert into auth.users(id,email,email_confirmed_at)values('${owner}','owner@example.test',now());`);
 for(const [i,id] of ids.entries())await db.query('insert into auth.users(id,email,email_confirmed_at)values($1,$2,$3)',[id,i===8?'needle_100%@example.test':['unused','trial-consumed','ready','waiting','ending-customer','ending-admin','expired','disabled'][i]+'@example.test',i===8?null:new Date()]);
 for(const file of ['20261103_member_admin.sql','20261103_self_cancellation.sql'])await db.exec(await readFile(new URL('../supabase/migrations/'+file,import.meta.url),'utf8'));
 await db.query(`insert into public.awaken_members(user_id,membership,trial_used,last_draw_at,last_card_number,ever_subscriber,membership_expires_at,membership_end_source)values
 ($1,'trial',true,clock_timestamp(),22,false,null,null),
 ($2,'subscriber',true,clock_timestamp()-interval '8 days',23,true,null,null),
 ($3,'subscriber',true,clock_timestamp(),24,true,null,null),
 ($4,'subscriber',true,clock_timestamp(),25,true,clock_timestamp()+interval '2 days','customer'),
 ($5,'subscriber',true,clock_timestamp(),26,true,clock_timestamp()+interval '2 days','admin'),
 ($6,'subscriber',true,clock_timestamp(),27,true,clock_timestamp()-interval '1 second','customer'),
 ($7,'disabled',true,clock_timestamp(),28,true,null,null)`,ids.slice(1,8));
 const sql=await readFile(new URL('../supabase/migrations/20261104_admin_list.sql',import.meta.url),'utf8');await db.exec(sql);
 async function as(id,query,params=[]){await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id||'']);await db.exec('set role '+(id?'authenticated':'anon'));try{return await db.query(query,params);}finally{await db.exec('reset role');}}
 const list=async(filter='all',search='',page=1,size=25,id=owner)=>(await as(id,'select public.awaken_admin_list($1,$2,$3,$4) as data',[filter,search,page,size])).rows[0].data;
 for(const id of [null,ids[0]])await assert.rejects(()=>list('all','',1,25,id),/ADMIN_REQUIRED|permission denied/);
 await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({app_metadata:{admin:true}})]);await assert.rejects(()=>list('all','',1,25,ids[0]),/ADMIN_REQUIRED/);
 const before=(await db.query('select * from public.awaken_members order by user_id')).rows;
 await db.exec('begin read only');let all;try{all=await list();}finally{await db.exec('commit');}
 assert.equal(all.total,10);assert.equal(all.rows.length,10);assert.ok(all.rows.every(r=>r.found&&r.user_id&&r.email));
 const untouched=all.rows.find(r=>r.user_id===ids[0]);assert.equal(untouched.state,'trial_ready');assert.equal(untouched.trial_used,false);assert.equal(untouched.last_draw_at,null);
 assert.equal(all.rows.find(r=>r.user_id===ids[8]).email_confirmed,false);
 assert.deepEqual(new Set((await list('members')).rows.map(r=>r.user_id)),new Set(ids.slice(2,6)));
 assert.equal((await list('trial')).total,4);assert.deepEqual(new Set((await list('ending')).rows.map(r=>r.membership_end_source)),new Set(['customer','admin']));
 assert.equal((await list('ended')).rows[0].user_id,ids[6]);assert.equal((await list('disabled')).rows[0].user_id,ids[7]);
 const exact=await list('all',' TRIAL-CONSUMED@EXAMPLE.TEST ');assert.equal(exact.total,1);assert.equal(exact.rows[0].user_id,ids[1]);
 assert.equal((await list('all','%')).total,1);assert.equal((await list('all',"' or true --")).total,0);
 const first=await list('all','',1,4),second=await list('all','',2,4),third=await list('all','',3,4);assert.equal(new Set([...first.rows,...second.rows,...third.rows].map(r=>r.user_id)).size,10);
 assert.deepEqual((await list('all','',1,4)).rows,first.rows);assert.equal((await list('all','',100,4)).rows.length,0);
 for(const args of [['bogus'],['all','',0,25],['all','',1,101],['all','',100001,25],['all','x'.repeat(255)]])await assert.rejects(()=>list(...args),/INVALID_/);
 assert.deepEqual((await db.query('select * from public.awaken_members order by user_id')).rows,before);assert.equal((await db.query('select count(*)::int as count from awaken_private.membership_audit')).rows[0].count,0);
 const privilege=(await db.query("select provolatile,prosecdef,has_function_privilege('anon',oid,'execute') as anon from pg_proc where proname='awaken_admin_list'")).rows[0];assert.equal(privilege.provolatile,'s');assert.equal(privilege.prosecdef,true);assert.equal(privilege.anon,false);
 await db.exec(sql);assert.deepEqual((await db.query('select * from public.awaken_members order by user_id')).rows,before);
 console.log('PASS read-only PostgreSQL transaction, admin-only access, unplayed registrations, expired/source filters, literal search, deterministic paging, input bounds, zero usage/audit mutation.');
 }finally{await db.close();}
});
