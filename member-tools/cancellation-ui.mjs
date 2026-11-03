import {chromium} from 'playwright';import {readFile} from 'node:fs/promises';import assert from 'node:assert/strict';
const html=await readFile(new URL('../number-draw/index.html',import.meta.url),'utf8');
const browser=await chromium.launch({...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{}),args:['--no-sandbox']});
const now=new Date(),japan=new Date(now.getTime()+9*3600000),end=new Date(Date.UTC(japan.getUTCFullYear(),japan.getUTCMonth()+1,1)-9*3600000).toISOString();
const waiting={membership:'subscriber',state:'subscriber_waiting',can_draw:false,trial_used:true,last_draw_at:now.toISOString(),last_card_number:22,next_available_at:new Date(now.getTime()+168*3600000).toISOString(),membership_expires_at:null,membership_end_source:null,can_request_cancellation:true,can_cancel_cancellation:false,cancellation_effective_at:end};
async function setup(initial,{mutationError=null}={}){
 const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});await context.addInitScript(()=>localStorage.setItem('awaken-auth-v1',JSON.stringify({access_token:'fixture',refresh_token:'refresh',expires_at:Date.now()/1000+3600})));
 const page=await context.newPage();const errors=[],mutations=[],dialogs=[];let state=structuredClone(initial);page.on('pageerror',e=>errors.push(e.message));
 await page.route('https://mmfsavdfiskhvypkrjnb.supabase.co/**',async route=>{
  const req=route.request(),path=new URL(req.url()).pathname;let data,status=200;
  if(path==='/auth/v1/user')data={id:'11111111-1111-4111-8111-111111111111',email:'customer@example.com'};
  else if(path.endsWith('/awaken_is_admin'))data=false;
  else if(path.endsWith('/awaken_status'))data=state;
  else if(path.endsWith('/awaken_self_cancellation')){
   const body=req.postDataJSON();assert.deepEqual(Object.keys(body).sort(),['p_action','p_expected_end_at']);assert.equal(body.p_expected_end_at,end);mutations.push(body);
   await new Promise(r=>setTimeout(r,50));
   if(mutationError){status=400;data={message:mutationError};if(mutationError==='ADMIN_CANCELLATION_LOCKED')state={...state,membership_end_source:'admin',can_cancel_cancellation:false};}
   else if(body.p_action==='request')data=state={...state,membership_expires_at:end,membership_end_source:'customer',can_request_cancellation:false,can_cancel_cancellation:true};
   else if(body.p_action==='undo')data=state={...state,membership_expires_at:null,membership_end_source:null,can_request_cancellation:true,can_cancel_cancellation:false};
   else throw new Error('invalid action');
  }else throw new Error('Unexpected '+path);
  await route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});
 });
 await page.route('https://awaken.test/**',r=>r.fulfill({contentType:'text/html',body:html}));
 await page.goto('https://awaken.test/');await page.waitForFunction(()=>document.getElementById('account').hidden===false);await page.waitForTimeout(80);
 return {page,context,mutations,errors,dialogs};
}
let s=await setup(waiting);await s.page.locator('#membership-actions').waitFor();assert.equal(await s.page.locator('#draw').isDisabled(),true);assert.equal(await s.page.locator('#undo-cancellation').isVisible(),false);
s.page.once('dialog',d=>d.dismiss());await s.page.locator('#request-cancellation').tap();assert.equal(s.mutations.length,0);
s.page.on('dialog',d=>{s.dialogs.push(d.message());d.accept();});
await s.page.locator('#request-cancellation').tap();await s.page.waitForFunction(()=>document.getElementById('cancellation-feedback').textContent.includes('受け付けました'));
assert.equal(s.mutations.length,1);assert.equal(await s.page.locator('#undo-cancellation').isVisible(),true);assert.equal(await s.page.locator('#request-cancellation').isVisible(),false);assert.equal(await s.page.locator('#number').textContent(),'22');assert.equal(await s.page.locator('#draw').isDisabled(),true);assert.match(s.dialogs[0],/日本時間/);assert.match(s.dialogs[0],/継続課金は停止されません/);
await s.page.locator('#undo-cancellation').tap();await s.page.waitForFunction(()=>document.getElementById('cancellation-feedback').textContent.includes('取り消しました'));
assert.equal(s.mutations.length,2);assert.equal(await s.page.locator('#draw').isDisabled(),true);assert.equal(await s.page.locator('#number').textContent(),'22');assert.equal(await s.page.locator('#request-cancellation').isVisible(),true);
for(const width of [320,390,768]){await s.page.setViewportSize({width,height:844});assert.ok(await s.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));}
assert.deepEqual(s.errors,[]);await s.context.close();
const own={...waiting,membership_expires_at:end,membership_end_source:'customer',can_request_cancellation:false,can_cancel_cancellation:true};
s=await setup({...own,membership_end_source:'admin',can_cancel_cancellation:false});await s.page.locator('#membership-actions').waitFor();assert.equal(await s.page.locator('#undo-cancellation').isVisible(),false);assert.match(await s.page.locator('#cancellation-status').textContent(),/取り消せません/);await s.page.evaluate(()=>selfCancellation('undo'));assert.equal(s.mutations.length,0);await s.context.close();
for(const state of [{...waiting,membership:'trial',state:'trial_used',can_request_cancellation:false,can_cancel_cancellation:false},{...own,state:'expired',can_cancel_cancellation:false}]){
 s=await setup(state);assert.equal(await s.page.locator('#request-cancellation').isVisible(),false);assert.equal(await s.page.locator('#undo-cancellation').isVisible(),false);assert.equal(await s.page.locator('#draw').isDisabled(),true);await s.context.close();
}
s=await setup(waiting,{mutationError:'CANCELLATION_DATE_CHANGED'});s.page.on('dialog',d=>d.accept());await s.page.locator('#request-cancellation').tap();await s.page.waitForFunction(()=>document.getElementById('cancellation-feedback').textContent.includes('最新の終了日時'));assert.equal(s.mutations.length,1);assert.equal(await s.page.locator('#draw').isDisabled(),true);await s.context.close();
s=await setup(own,{mutationError:'ADMIN_CANCELLATION_LOCKED'});s.page.on('dialog',d=>d.accept());await s.page.locator('#undo-cancellation').tap();await s.page.waitForFunction(()=>document.getElementById('cancellation-feedback').textContent.includes('管理者が設定した終了予約'));assert.equal(s.mutations.length,1);assert.equal(await s.page.locator('#undo-cancellation').isVisible(),false);await s.context.close();
await browser.close();console.log('PASS cancellation UI: confirm/abort, request/undo, unchanged card/cooldown, admin lock, trial/expired hiding, stale month/admin change, billing notice, mobile widths. Mocked APIs; live migration pending.');
