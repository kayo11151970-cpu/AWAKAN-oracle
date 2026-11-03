import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../number-draw/auth.js',import.meta.url),'utf8');
const start=source.indexOf('function emailErrorMessage(');const end=source.indexOf("el('login-form').addEventListener",start);
const explain=new Function(source.slice(start,end)+';return emailErrorMessage;')();
test('auth mail failures distinguish sending quotas, SMTP authorization, provider and signup',()=>{
 for(const code of ['over_email_send_rate_limit','over_request_rate_limit','email_address_not_authorized','email_provider_disabled','signup_disabled','email_address_invalid','email_send_failed','unexpected_failure'])assert.ok(explain({code}).includes(code));
 assert.match(explain({status:429}),/上限|制限/);assert.match(explain({status:500}),/HTTP 500/);assert.match(explain(new TypeError('Failed to fetch')),/通信/);
});
test('raw server text, unknown codes and credentials are never rendered',()=>{
 const privateText='smtp-password-private-fixture';for(const error of [{message:privateText,code:privateText,status:500},{message:privateText},{code:'__proto__',message:privateText}])assert.ok(!explain(error).includes(privateText));
});
