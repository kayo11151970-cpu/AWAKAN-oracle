import {chromium} from 'playwright';import {readFile} from 'node:fs/promises';import assert from 'node:assert/strict';
const html=await readFile(new URL('../admin/index.html',import.meta.url),'utf8');
const browser=await chromium.launch({...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{}),args:['--no-sandbox']});
const stamp=new Date(),japan=new Date(stamp.getTime()+9*3600000),end=new Date(Date.UTC(japan.getUTCFullYear(),japan.getUTCMonth()+1,1)-9*3600000).toISOString();
const records=Array.from({length:58},(_,i)=>{
 const kind=i%8,member=[2,3,4,5,6].includes(kind),ending=[4,5,6].includes(kind),used=kind!==0;
 const state=['trial_ready','trial_used','subscriber_ready','subscriber_waiting','subscriber_waiting','subscriber_waiting','expired','disabled'][kind];
 return {found:true,user_id:`11111111-1111-4111-8111-${String(i+1).padStart(12,'0')}`,email:`person-${String(i+1).padStart(3,'0')}@example.test`,email_confirmed:true,membership:kind===7?'disabled':member?'subscriber':'trial',state,can_draw:[0,2].includes(kind),trial_used:used,last_draw_at:used?new Date(stamp.getTime()-(kind===2?169:1)*3600000).toISOString():null,last_card_number:used?22:null,next_available_at:[3,4,5].includes(kind)?new Date(stamp.getTime()+167*3600000).toISOString():null,membership_expires_at:ending?(kind===6?new Date(stamp.getTime()-86400000).toISOString():end):null,membership_end_source:ending?(kind===4?'customer':'admin'):null};
});
records[56]={...records[56],email:'unconfirmed@example.test',email_confirmed:false};records[57].email='long-address-'+'x'.repeat(120)+'@example.test';
async function setup(admin=true,{delayed=false}={}){
 const context=await browser.newContext({viewport:{width:1440,height:1000}});await context.addInitScript(()=>localStorage.setItem('awaken-auth-v1',JSON.stringify({access_token:'fixture',refresh_token:'refresh',expires_at:Date.now()/1000+3600})));
 const page=await context.newPage();const calls=[],errors=[],dialogs=[];let listDelay=delayed;
 page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>{dialogs.push(d.message());d.accept();});
 await page.route('https://mmfsavdfiskhvypkrjnb.supabase.co/**',async route=>{
  const req=route.request(),path=new URL(req.url()).pathname,body=req.postData()?req.postDataJSON():null;calls.push({path,body});let data,status=200;
  if(path==='/auth/v1/user')data={id:admin?'e77ae592-6316-444f-a4e4-dae3a8d4eb81':records[0].user_id,email:admin?'owner@example.test':records[0].email};
  else if(path.endsWith('/awaken_is_admin'))data=admin;
  else if(path.endsWith('/awaken_admin_list')){
   if(!admin){status=403;data={message:'ADMIN_REQUIRED'};}else{
    if(listDelay)await new Promise(r=>setTimeout(r,500));
    const states={members:['subscriber_ready','subscriber_waiting'],trial:['trial_ready','trial_used'],ended:['expired'],disabled:['disabled']};
    const rows=records.filter(r=>(body.p_filter==='all'||body.p_filter==='ending'?body.p_filter==='all'||['subscriber_ready','subscriber_waiting'].includes(r.state)&&r.membership_expires_at:states[body.p_filter].includes(r.state))&&r.email.toLowerCase().includes(body.p_search.toLowerCase()));
    data={total:rows.length,page:body.p_page,page_size:body.p_page_size,rows:rows.slice((body.p_page-1)*body.p_page_size,body.p_page*body.p_page_size)};
   }
  }else if(path.endsWith('/awaken_admin_lookup'))data=records.find(r=>r.email===body.p_email)||{found:false};
  else if(path.endsWith('/awaken_admin_change')){
   const record=records.find(r=>r.user_id===body.p_user_id);assert.ok(record);assert.equal(record.email_confirmed,true);
   if(body.p_action==='activate')Object.assign(record,{membership:'subscriber',state:'subscriber_ready',can_draw:true,trial_used:true,membership_expires_at:null,membership_end_source:null});
   else if(body.p_action==='end_month')Object.assign(record,{membership_expires_at:end,membership_end_source:'admin'});
   else throw new Error('Unexpected action');data={...record};
  }else throw new Error('Unexpected API '+path);
  await route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});
 });
 await page.route('https://awaken.test/**',r=>r.fulfill({contentType:'text/html',body:html}));
 await page.goto('https://awaken.test/admin/');return {context,page,calls,errors,dialogs};
}
const wait=page=>page.waitForFunction(()=>!document.getElementById('apply-filter').disabled&&!document.getElementById('list-message').textContent.includes('読み込んでいます'));
let s=await setup();await s.page.locator('#manager').waitFor();await wait(s.page);assert.equal(await s.page.locator('#registrants tr').count(),25);assert.match(await s.page.locator('#list-count').textContent(),/全58件/);
await s.page.locator('#next-page').click();await wait(s.page);assert.equal(await s.page.locator('#page-label').textContent(),'2 / 3');await s.page.locator('#next-page').click();await wait(s.page);assert.equal(await s.page.locator('#registrants tr').count(),8);
await s.page.locator('#page-size').selectOption('50');await wait(s.page);assert.equal(await s.page.locator('#page-label').textContent(),'1 / 2');assert.equal(await s.page.locator('#registrants tr').count(),50);
await s.page.locator('#status-filter').selectOption('ending');await s.page.locator('#apply-filter').click();await wait(s.page);assert.ok(await s.page.locator('#registrants tr').count()>0);for(const row of await s.page.locator('#registrants tr').all()){assert.equal(await row.locator('td').nth(1).textContent(),'会員');assert.match(await row.locator('td').nth(5).textContent(),/^あり/);}
await s.page.locator('#status-filter').selectOption('trial');await s.page.locator('#list-email').fill('person-002');await s.page.locator('#apply-filter').click();await wait(s.page);assert.equal(await s.page.locator('#registrants tr').count(),1);const last=records[1].last_draw_at;
await s.page.locator('#registrants button[data-action="activate"]').click();await wait(s.page);assert.equal(await s.page.locator('#registrants tr').count(),0);assert.equal(records[1].last_draw_at,last);assert.equal(await s.page.locator('#result-email').textContent(),'person-002@example.test');assert.equal(s.calls.filter(c=>c.path.endsWith('/awaken_admin_change')).length,1);
await s.page.locator('#status-filter').selectOption('members');await s.page.locator('#apply-filter').click();await wait(s.page);assert.equal(await s.page.locator('#registrants tr').count(),1);await s.page.locator('#registrants button[data-action="end_month"]').click();await wait(s.page);assert.match(await s.page.locator('#registrants tr td').nth(5).textContent(),/あり（管理者）/);assert.equal(await s.page.locator('#registrants button[data-action="end_month"]').isDisabled(),true);assert.ok(s.dialogs.some(m=>m.includes('person-002@example.test')&&m.includes('取り消せなく')));
await s.page.locator('#registrants button[data-action="details"]').click();assert.equal(await s.page.locator('#result-email').textContent(),'person-002@example.test');
await s.page.locator('#status-filter').selectOption('all');await s.page.locator('#list-email').fill('unconfirmed');await s.page.locator('#apply-filter').click();await wait(s.page);assert.match(await s.page.locator('#registrants .email-cell').textContent(),/メール未確認/);assert.equal(await s.page.locator('#registrants button[data-action="activate"]').isDisabled(),true);
await s.page.locator('#list-email').fill('not-existing');await s.page.locator('#apply-filter').click();await wait(s.page);assert.equal(await s.page.locator('#registrants tr').count(),0);assert.match(await s.page.locator('#list-message').textContent(),/一致する登録者はいません/);
await s.page.locator('#list-email').fill('');await s.page.locator('#apply-filter').click();await wait(s.page);
for(const width of [320,390,768,1440]){await s.page.setViewportSize({width,height:1000});assert.ok(await s.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'overflow '+width);}
assert.ok(!s.calls.some(c=>c.path.endsWith('/awaken_draw')||c.path.endsWith('/awaken_self_cancellation')));assert.deepEqual(s.errors,[]);await s.page.setViewportSize({width:1440,height:1000});await s.page.screenshot({path:'/workspace/awaken-testing/admin-list-desktop.png',fullPage:true});await s.page.setViewportSize({width:390,height:844});await s.page.screenshot({path:'/workspace/awaken-testing/admin-list-mobile.png',fullPage:true});await s.context.close();
s=await setup(false);await s.page.waitForFunction(()=>document.getElementById('gate-message').textContent.includes('管理権限がありません'));assert.equal(await s.page.locator('#manager').isVisible(),false);assert.equal(s.calls.some(c=>c.path.endsWith('/awaken_admin_list')),false);await s.context.close();
s=await setup(true,{delayed:true});await s.page.waitForFunction(()=>document.getElementById('list-message').textContent.includes('読み込んでいます'));await s.page.evaluate(()=>window.dispatchEvent(new StorageEvent('storage',{key:'awaken-auth-v1',newValue:null})));await s.page.waitForTimeout(650);assert.equal(await s.page.locator('#manager').isVisible(),false);assert.equal(await s.page.locator('#registrants tr').count(),0);await s.context.close();
await browser.close();console.log('PASS admin list UI: desktop/mobile, all filters, search, paging/page size, row actions via existing RPC, refresh after mutation, unconfirmed/empty states, normal-user denial, stale-session privacy; no draw/cancellation RPC changes.');
