import {chromium} from 'playwright';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const root=new URL('../',import.meta.url);
const adminHtml=await readFile(new URL('admin/index.html',root),'utf8');
const customerHtml=await readFile(new URL('number-draw/index.html',root),'utf8');
const cards=JSON.parse(await readFile(new URL('number-draw/cards.json',root),'utf8'));
const browser=await chromium.launch({...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{}),args:['--no-sandbox']});
const owner='e77ae592-6316-444f-a4e4-dae3a8d4eb81';
const customer='11111111-1111-4111-8111-111111111111';
const key='awaken-auth-v1';
const trial={found:true,user_id:customer,email:'customer@example.com',email_confirmed:true,membership:'trial',state:'trial_used',trial_used:true,can_draw:false,last_draw_at:new Date().toISOString(),last_card_number:22,next_available_at:null,membership_expires_at:null};
async function pageFor({admin=true,loggedIn=true}={}){
 const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
 if(loggedIn)await context.addInitScript(({key})=>{if(!localStorage.getItem(key))localStorage.setItem(key,JSON.stringify({access_token:'fixture',refresh_token:'fixture-refresh',expires_at:Date.now()/1000+3600}));},{key});
 const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));const calls=[];let record=structuredClone(trial),draws=0;
 await page.route('https://mmfsavdfiskhvypkrjnb.supabase.co/**',async route=>{
  const req=route.request();const path=new URL(req.url()).pathname;let body,status=200;calls.push({path,data:req.postData()?JSON.parse(req.postData()):null});
  if(path==='/auth/v1/user')body={id:admin?owner:customer,email:admin?'owner@example.com':'customer@example.com'};
  else if(path==='/auth/v1/otp'){assert.equal(req.postDataJSON().create_user,true);body={};}
  else if(path.endsWith('/awaken_is_admin'))body=admin;
  else if(path.endsWith('/awaken_admin_lookup')){
   if(!admin){status=400;body={message:'ADMIN_REQUIRED'};}else body=req.postDataJSON().p_email==='customer@example.com'?record:{found:false};
  }else if(path.endsWith('/awaken_admin_change')){
   if(!admin){status=400;body={message:'ADMIN_REQUIRED'};}else{
    const change=req.postDataJSON();assert.equal(change.p_user_id,customer);
    if(change.p_action==='activate'){record={...record,membership:'subscriber',state:'subscriber_ready',can_draw:true,membership_expires_at:null};}
    else if(change.p_action==='end_month'){const now=new Date();const japan=new Date(now.getTime()+9*3600000);const end=new Date(Date.UTC(japan.getUTCFullYear(),japan.getUTCMonth()+1,1)-9*3600000);record={...record,membership_expires_at:end.toISOString()};}
    else throw new Error('invalid action');body=record;
   }
  }else if(path.endsWith('/awaken_status'))body=record;
  else if(path.endsWith('/awaken_draw')){draws++;body=[{card_number:31,next_available_at:new Date(Date.now()+168*3600000).toISOString()}];}
  else if(path==='/auth/v1/logout')body={};
  else throw new Error('Unexpected API: '+path);
  await route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
 });
 await page.route('https://awaken.test/**',route=>route.fulfill({contentType:'text/html',body:route.request().url().includes('/admin')?adminHtml:customerHtml}));
 return {page,context,calls,errors,setRecord:value=>record=value,draws:()=>draws};
}
let s=await pageFor();await s.page.goto('https://awaken.test/admin/');await s.page.locator('#manager').waitFor();
await s.page.locator('#customer-email').fill('unknown@example.com');await s.page.locator('#search').tap();await s.page.waitForFunction(()=>!document.getElementById('search').disabled);assert.equal(await s.page.locator('#customer').isVisible(),false);assert.match(await s.page.locator('#message').textContent(),/見つかりません/);
await s.page.locator('#customer-email').fill('customer@example.com');await s.page.locator('#search').tap();await s.page.locator('#customer').waitFor();assert.equal(await s.page.locator('#activate').isDisabled(),false);assert.equal(await s.page.locator('#end-month').isDisabled(),true);
s.page.on('dialog',dialog=>dialog.accept());await s.page.locator('#activate').tap();await s.page.waitForFunction(()=>document.getElementById('activate').textContent==='会員です');assert.equal(await s.page.locator('#activate').isDisabled(),true);assert.equal(await s.page.locator('#end-month').isDisabled(),false);
await s.page.locator('#end-month').tap();await s.page.waitForFunction(()=>document.getElementById('activate').textContent==='終了予約を取り消す');assert.equal(await s.page.locator('#end-month').isDisabled(),true);assert.match(await s.page.locator('#end-date').textContent(),/日本時間/);
assert.deepEqual(s.calls.filter(c=>c.path.endsWith('awaken_admin_change')).map(c=>c.data.p_action),['activate','end_month']);
for(const width of [320,390,768]){await s.page.setViewportSize({width,height:844});assert.ok(await s.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));}
await s.page.locator('#customer-email').fill('other@example.com');assert.equal(await s.page.locator('#customer').isVisible(),false);assert.equal(await s.page.locator('#activate').isDisabled(),true);assert.deepEqual(s.errors,[]);await s.context.close();
for(const opts of [{admin:false},{loggedIn:false}]){s=await pageFor(opts);await s.page.goto('https://awaken.test/admin/');await s.page.waitForFunction(()=>!document.getElementById('gate-message').textContent.includes('確認しています'));assert.equal(await s.page.locator('#manager').isVisible(),false);assert.equal(s.calls.some(c=>c.path.includes('awaken_admin_lookup')),false);await s.context.close();}
// Customer page: only the owner sees management, activation credits override old trial date.
s=await pageFor({admin:false});s.setRecord({...trial,membership:'subscriber',state:'subscriber_ready',can_draw:true});await s.page.goto('https://awaken.test/');await s.page.waitForFunction(()=>!document.getElementById('draw').disabled);assert.equal(await s.page.locator('#admin-link').isVisible(),false);
await s.page.locator('#draw').tap();await s.page.waitForFunction(()=>document.getElementById('number').textContent==='31');assert.equal(await s.page.locator('#card-name').textContent(),cards[30].name);assert.equal(await s.page.locator('#card-message').textContent(),cards[30].message);assert.equal(await s.page.locator('#keywords').textContent(),cards[30].keywords.join(' ／ '));assert.equal(s.draws(),1);assert.equal(await s.page.locator('#draw').isDisabled(),true);await s.context.close();
s=await pageFor();await s.page.goto('https://awaken.test/');await s.page.locator('#admin-link').waitFor();assert.equal(await s.page.locator('#admin-link').getAttribute('href'),'https://kayo11151970-cpu.github.io/AWAKAN-oracle/admin/');await s.context.close();
s=await pageFor({admin:false});s.setRecord({...trial,membership:'subscriber',state:'expired',can_draw:false});await s.page.goto('https://awaken.test/');await s.page.waitForFunction(()=>document.getElementById('status').textContent.includes('会員資格が終了'));assert.equal(await s.page.locator('#draw').isDisabled(),true);assert.equal(await s.page.locator('#card-image').isVisible(),true);await s.context.close();
s=await pageFor({loggedIn:false});await s.page.goto('https://awaken.test/');await s.page.locator('#email').fill('new@example.com');await s.page.locator('#send-link').tap();await s.page.waitForFunction(()=>!document.getElementById('send-link').disabled);assert.ok(s.calls.some(c=>c.path==='/auth/v1/otp'&&c.data.create_user===true));assert.equal(await s.page.locator('#draw').isDisabled(),true);await s.context.close();
await browser.close();console.log('PASS UI: owner gate, ordinary/anonymous denial, exact-email lookup, activation, month-end, confirmation, stale-target protection, mobile layout, owner-only menu, self signup, immediate member credit, expiration and card contents. Mocked Supabase; live setup pending.');
