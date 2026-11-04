import {chromium} from 'playwright';import {readFile} from 'node:fs/promises';import assert from 'node:assert/strict';
const html=await readFile(new URL('../admin/index.html',import.meta.url),'utf8');const browser=await chromium.launch({...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{}),args:['--no-sandbox']});
async function setup(admin=true){
 const ctx=await browser.newContext({viewport:{width:1280,height:900}});await ctx.addInitScript(()=>localStorage.setItem('awaken-auth-v1',JSON.stringify({access_token:'fixture',refresh_token:'refresh',expires_at:Date.now()/1000+3600})));
 const page=await ctx.newPage(),calls=[],errors=[];let pending=null;page.on('pageerror',e=>errors.push(e.message));
 await page.route('https://mmfsavdfiskhvypkrjnb.supabase.co/**',async route=>{
  const req=route.request(),path=new URL(req.url()).pathname,body=req.postData()?req.postDataJSON():null;calls.push({path,body});let data;
  if(path==='/auth/v1/user')data={id:'fixture',email:'owner@example.test'};
  else if(path.endsWith('/awaken_is_admin'))data=admin;
  else if(path.endsWith('/awaken_admin_list'))data={total:pending?1:0,rows:pending?[pending]:[]};
  else if(path.endsWith('/awaken_admin_preregister'))data=pending={found:true,user_id:null,email:body.p_email.toLowerCase().trim(),email_confirmed:false,membership:'preregistered',state:'preregistered',can_draw:false,trial_used:false,last_draw_at:null,next_available_at:null,membership_expires_at:null,preregistration_pending:true,registration_kind:'pending'};
  else if(path.endsWith('/awaken_admin_cancel_preregistration')){assert.equal(body.p_email,pending.email);pending=null;data={cancelled:true};}
  else throw new Error('Unexpected endpoint '+path);
  await route.fulfill({contentType:'application/json',body:JSON.stringify(data)});
 });
 await page.route('https://awaken.test/**',r=>r.fulfill({contentType:'text/html',body:html}));await page.goto('https://awaken.test/admin/');return {ctx,page,calls,errors};
}
let s=await setup();await s.page.locator('#manager').waitFor();await s.page.waitForFunction(()=>!document.getElementById('preregister-submit').disabled);
await s.page.locator('#preregister-email').fill('paid@example.test');s.page.once('dialog',d=>d.dismiss());await s.page.locator('#preregister-submit').click();assert.equal(s.calls.some(c=>c.path.endsWith('/awaken_admin_preregister')),false);
s.page.on('dialog',d=>{assert.match(d.message(),/メールを送信しません|アカウントやカード記録は削除しません/);d.accept();});await s.page.locator('#preregister-submit').click();await s.page.waitForFunction(()=>document.getElementById('preregister-message').textContent.includes('事前登録しました'));
assert.match(await s.page.locator('#registrants').textContent(),/paid@example.test/);assert.match(await s.page.locator('#registrants').textContent(),/事前登録/);assert.equal(await s.page.locator('#activate').isVisible(),false);assert.equal(await s.page.locator('#end-month').isVisible(),false);assert.equal(await s.page.locator('#cancel-preregistration').isVisible(),true);
for(const width of [320,390,1280]){await s.page.setViewportSize({width,height:900});assert.ok(await s.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'overflow '+width);}
await s.page.locator('#registrants button[data-action="cancel_prereg"]').click();await s.page.waitForFunction(()=>document.getElementById('preregister-message').textContent.includes('取り消しました'));assert.equal(await s.page.locator('#registrants tr').count(),0);
assert.equal(s.calls.filter(c=>c.path.endsWith('/awaken_admin_preregister')).length,1);assert.ok(!s.calls.some(c=>c.path.includes('/otp')||c.path.includes('/invite')||c.path.includes('/signup')||c.path.endsWith('awaken_draw')));assert.deepEqual(s.errors,[]);await s.ctx.close();
s=await setup(false);await s.page.waitForFunction(()=>document.getElementById('gate-message').textContent.includes('管理権限がありません'));assert.equal(await s.page.locator('#preregister-submit').isVisible(),false);assert.equal(s.calls.some(c=>c.path.includes('preregister')),false);await s.ctx.close();await browser.close();console.log('PASS preregistration UI: confirmation/abort, pending rows, owner-only form, correction cancellation, mobile widths; no auth email/invite/signup calls.');
