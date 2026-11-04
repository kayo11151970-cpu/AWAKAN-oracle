import {chromium} from 'playwright';import {readFile} from 'node:fs/promises';import assert from 'node:assert/strict';
const customerHtml=await readFile(new URL('../number-draw/index.html',import.meta.url),'utf8');const adminHtml=await readFile(new URL('../admin/index.html',import.meta.url),'utf8');const cards=JSON.parse(await readFile(new URL('../number-draw/cards.json',import.meta.url),'utf8'));
const browser=await chromium.launch({...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{}),args:['--no-sandbox']});
const key='awaken-auth-v1',origin='https://awaken.test',calls=[];let cardNumber=1;
const fixture={access_token:'offline-fake-expired',refresh_token:'offline-fake-refresh',expires_at:1};
const storage={cookies:[],origins:[{origin,localStorage:[{name:key,value:JSON.stringify(fixture)}]}]};
async function makeContext(saved){
 const context=await browser.newContext({storageState:saved,viewport:{width:390,height:844}});const errors=[];
 context.on('page',p=>p.on('pageerror',e=>errors.push(e.message)));
 // Every request is intercepted. No real network, SMTP or Supabase state is used.
 await context.route('**/*',async route=>{
  const req=route.request(),url=new URL(req.url());calls.push(url.pathname);
  if(url.origin===origin){await route.fulfill({contentType:'text/html',body:url.pathname.startsWith('/admin')?adminHtml:customerHtml});return;}
  assert.equal(url.hostname,'mmfsavdfiskhvypkrjnb.supabase.co');let data;
  if(url.pathname==='/auth/v1/token')data={access_token:'offline-fake-renewed',refresh_token:'offline-fake-renewed-refresh',expires_in:3600};
  else if(url.pathname==='/auth/v1/user')data={id:'e77ae592-6316-444f-a4e4-dae3a8d4eb81',email:'owner@example.test'};
  else if(url.pathname.endsWith('/awaken_is_admin'))data=true;
  else if(url.pathname.endsWith('/awaken_status'))data={membership:'subscriber',state:'subscriber_waiting',can_draw:false,trial_used:true,last_card_number:cardNumber,last_draw_at:new Date().toISOString(),next_available_at:new Date(Date.now()+168*3600000).toISOString(),membership_expires_at:null,membership_end_source:null,can_request_cancellation:true,can_cancel_cancellation:false,cancellation_effective_at:'2099-01-01T00:00:00Z'};
  else if(url.pathname.endsWith('/awaken_admin_list'))data={rows:[],total:0,page:1,page_size:25};
  else throw new Error('Forbidden offline test request: '+url.pathname);
  await route.fulfill({contentType:'application/json',body:JSON.stringify(data)});
 });
 return {context,errors};
}
let s=await makeContext(storage),page=await s.context.newPage();
for(let n=1;n<=44;n++){
 cardNumber=n;await page.goto(origin+'/?offline-card='+n);await page.waitForFunction(n=>document.getElementById('number').textContent===String(n),n);
 assert.equal(await page.locator('#card-name').textContent(),cards[n-1].name);assert.equal(await page.locator('#card-message').textContent(),cards[n-1].message);assert.equal(await page.locator('#keywords').textContent(),cards[n-1].keywords.join(' ／ '));assert.ok(await page.locator('#card-image').evaluate(i=>i.complete&&i.naturalWidth>0));assert.equal(await page.locator('#draw').isDisabled(),true);
}
assert.equal(calls.filter(p=>p==='/auth/v1/token').length,1);
await page.goto(origin+'/admin/');await page.locator('#manager').waitFor();await page.waitForFunction(()=>!document.getElementById('preregister-submit').disabled);assert.equal(await page.locator('#gate').isVisible(),false);assert.equal(await page.locator('#preregister-submit').isVisible(),true);
const saved=await s.context.storageState();assert.deepEqual(s.errors,[]);await s.context.close();
s=await makeContext(saved);page=await s.context.newPage();await page.goto(origin+'/');await page.waitForFunction(()=>!document.getElementById('account').hidden);assert.equal(await page.locator('#login-form').isVisible(),false);await page.goto(origin+'/admin/');await page.locator('#manager').waitFor();assert.equal(calls.filter(p=>p==='/auth/v1/token').length,1);assert.deepEqual(s.errors,[]);
for(const path of calls)assert.ok(!['/auth/v1/otp','/auth/v1/signup','/auth/v1/invite','/rest/v1/rpc/awaken_draw','/rest/v1/rpc/awaken_admin_preregister'].includes(path),path);
await s.context.close();await browser.close();console.log('PASS offline: all 44 original images and approved messages/keywords, stored-session restore, token refresh without email, shared admin session, simulated browser reopen; zero real network/mail/draw/membership mutations.');
