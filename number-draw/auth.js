// Authentication and eligibility are checked by Supabase, not browser storage.
const apiUrl='https://mmfsavdfiskhvypkrjnb.supabase.co';
const publishableKey='sb_publishable_L29n6t4Rw-_THcwQQRBNaw_5D78IwDK';
const redirectUrl='https://kayo11151970-cpu.github.io/AWAKAN-oracle/';
const sessionKey='awaken-auth-v1';
const el=id=>document.getElementById(id);
let session=null,user=null,busy=false,refreshing=null,authGeneration=0;
function saveSession(value){session=value;try{if(value)localStorage.setItem(sessionKey,JSON.stringify(value));else localStorage.removeItem(sessionKey);}catch{}}
function normalizedSession(data){return {access_token:data.access_token,refresh_token:data.refresh_token,expires_at:data.expires_at||Math.floor(Date.now()/1000)+Number(data.expires_in||3600)};}
async function request(path,{method='GET',body,token}={}){
 const response=await fetch(apiUrl+path,{method,headers:{apikey:publishableKey,'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},...(body?{body:JSON.stringify(body)}:{})});
 const data=await response.json().catch(()=>null);
 if(!response.ok){const error=new Error(data?.message||data?.msg||data?.error_description||'REQUEST_FAILED');error.status=response.status;error.code=data?.code;throw error;}
 return data;
}
async function accessToken(){
 if(!session)throw new Error('LOGIN_REQUIRED');
 if(session.expires_at*1000>Date.now()+60000)return session.access_token;
 if(!refreshing)refreshing=request('/auth/v1/token?grant_type=refresh_token',{method:'POST',body:{refresh_token:session.refresh_token}}).then(data=>{saveSession(normalizedSession(data));return session.access_token;}).finally(()=>{refreshing=null;});
 return refreshing;
}
function hideResult(){el('card-image').hidden=true;el('details').hidden=true;el('number').textContent='—';}
function loggedOut(){authGeneration++;if(el('admin-link'))el('admin-link').hidden=true;user=null;saveSession(null);hideResult();el('login-form').hidden=false;el('account').hidden=true;el('draw').disabled=true;el('status').textContent='メールでログインしてからカードを引いてください。';}
function dateLabel(value){return new Intl.DateTimeFormat('ja-JP',{timeZone:'Asia/Tokyo',dateStyle:'medium',timeStyle:'short'}).format(new Date(value))+'（日本時間）';}
async function showCard(number,generation=authGeneration){
 if(!Number.isInteger(number)||number<1||number>44)throw new Error('INVALID_CARD');
 const image=new Image();image.src=cardImages[number-1];await image.decode();if(generation!==authGeneration)return;
 el('card-image').src=image.src;el('card-image').alt=`${number}番のオラクルカード`;el('card-image').hidden=false;
 const card=cardRegistry[number-1];el('card-name').textContent=card.name;el('card-message').textContent=card.message;el('keywords').textContent=card.keywords.join(' ／ ');el('details').hidden=false;el('number').textContent=String(number);
}
async function loadMembership(){
 const generation=authGeneration;
 const token=await accessToken();
 let member;
 try{member=await request('/rest/v1/rpc/awaken_status',{method:'POST',body:{},token});}
 catch(error){
  // Compatibility while the additive database migration is being installed.
  if(error.code!=='PGRST202')throw error;
  const rows=await request('/rest/v1/awaken_members?select=membership,trial_used,last_draw_at,last_card_number&user_id=eq.'+encodeURIComponent(user.id),{token});
  member=rows?.[0]||{membership:'trial',trial_used:false};
  const next=member.last_draw_at?new Date(new Date(member.last_draw_at).getTime()+168*3600000):null;
  member.state=member.membership==='disabled'?'disabled':member.membership==='subscriber'?(next&&Date.now()<next?'subscriber_waiting':'subscriber_ready'):(member.trial_used?'trial_used':'trial_ready');
  member.can_draw=['trial_ready','subscriber_ready'].includes(member.state);member.next_available_at=next;
 }
 if(generation!==authGeneration)return;
 if(member.state==='disabled'){hideResult();el('draw').disabled=true;el('status').textContent='現在、このアカウントでは利用できません。管理者にお問い合わせください。';return;}
 if(member.last_card_number)await showCard(member.last_card_number,generation);
 if(generation!==authGeneration)return;
 el('draw').disabled=!member.can_draw;
 const states={trial_ready:'無料体験は、このアカウントで1回だけご利用いただけます。',trial_used:'無料体験は利用済みです。前回のカードを表示しています。',subscriber_ready:'会員として今すぐカードを引けます。次回は今回の抽選から7日後です。',subscriber_waiting:'次に引ける日時：'+(member.next_available_at?dateLabel(member.next_available_at):'確認中'),expired:'会員資格が終了しています。新しくカードを引くには管理者にお問い合わせください。'};
 el('status').textContent=states[member.state]||'利用状況を確認できませんでした。';
 if(member.membership_expires_at&&member.state!=='expired')el('status').textContent+=' 会員資格は '+dateLabel(member.membership_expires_at)+' に終了します。';
}
async function loadAdminLink(){
 if(!el('admin-link'))return;
 const generation=authGeneration;el('admin-link').hidden=true;
 try{const token=await accessToken();const allowed=await request('/rest/v1/rpc/awaken_is_admin',{method:'POST',body:{},token});if(generation===authGeneration)el('admin-link').hidden=allowed!==true;}catch{}
}

function explain(error){
 const text=error.message||'';
 if(text.includes('MEMBERSHIP_EXPIRED'))return '会員資格が終了しています。管理者にお問い合わせください。';
 if(text.includes('ACCOUNT_DISABLED'))return '現在、このアカウントでは利用できません。';
 if(text.includes('TRIAL_ALREADY_USED'))return '無料体験は利用済みです。';
 if(text.includes('WAIT_SEVEN_DAYS'))return '前回から7日後に、もう一度引けます。';
 if(text.includes('LOGIN_REQUIRED')||error.status===401)return 'ログインの有効期限が切れました。ログインし直してください。';
 return '通信または設定の確認が必要です。画面を再読み込みして利用状況を確認してください。';
}
function emailErrorMessage(error){
 const code=error.code;
 const reasons={
  over_email_send_rate_limit:'認証メールの送信回数がSupabaseの上限に達しています。続けて送信せず、送信制限の設定を確認してください。',
  over_request_rate_limit:'短時間のリクエスト上限に達しています。少し時間を空けてください。',
  email_address_not_authorized:'現在の送信サービスでは、このメールアドレスへの送信が許可されていません。管理者による送信元設定の確認が必要です。',
  email_provider_disabled:'Supabaseのメール認証が無効になっています。管理者による設定の確認が必要です。',
  signup_disabled:'新規登録が無効になっています。初めて利用する方は管理者にお問い合わせください。',
  email_address_invalid:'メールアドレスが正しいか確認してください。',
  email_send_failed:'認証メールの送信処理に失敗しました。管理者によるメール送信元・認証ログの確認が必要です。',
  unexpected_failure:'認証サービスで送信処理に失敗しました。管理者による認証ログ・送信元設定の確認が必要です。'
 };
 if(Object.hasOwn(reasons,code))return reasons[code]+'（確認コード：'+code+'）';
 if(error.status===429)return '認証サービスの送信制限に達しています。続けて送信せず、少し時間を空けてください。（HTTP 429）';
 if(Number.isInteger(error.status)&&error.status>=400&&error.status<=599)return 'メールを送信できませんでした。管理者に次の番号をお知らせください。（HTTP '+error.status+'）';
 return '認証サービスに通信できませんでした。インターネット接続を確認し、少し待ってからお試しください。';
}
el('login-form').addEventListener('submit',async event=>{
 event.preventDefault();el('send-link').disabled=true;el('login-status').textContent='ログインメールを送信しています…';
 try{
  await request('/auth/v1/otp?redirect_to='+encodeURIComponent(redirectUrl),{method:'POST',body:{email:el('email').value.trim(),create_user:true}});
  el('login-status').textContent='確認用メールを送信しました。メール内のリンクを開くと、登録・ログインが完了します。';
 }catch(error){el('login-status').textContent=emailErrorMessage(error);}
 finally{el('send-link').disabled=false;}
});
el('logout').addEventListener('click',async()=>{
 const token=session?.access_token;loggedOut();if(token)try{await request('/auth/v1/logout',{method:'POST',token});}catch{}
});
el('draw').addEventListener('click',async()=>{
 if(busy||!user)return;const generation=authGeneration;busy=true;el('draw').disabled=true;el('status').textContent='カードを選んでいます…';
 try{
  const token=await accessToken();
  const result=await request('/rest/v1/rpc/awaken_draw',{method:'POST',body:{},token});
  const reading=result?.[0];if(!reading)throw new Error('INVALID_RESULT');
  if(generation!==authGeneration)return;
  await showCard(reading.card_number,generation);
  if(generation!==authGeneration)return;
  el('status').textContent=reading.next_available_at?'次に引ける日時：'+dateLabel(reading.next_available_at):'無料体験をご利用いただきました。今回のカードはログイン後も確認できます。';
 }catch(error){
  if(generation!==authGeneration)return;
  el('status').textContent=explain(error);
  if(error.status===401){loggedOut();el('login-status').textContent=explain(error);}
 }finally{busy=false;}
});
async function initialize(){
 el('draw').disabled=true;
 try{
  const fragment=new URLSearchParams(location.hash.slice(1));
  if(fragment.has('error')){history.replaceState(null,'',location.pathname+location.search);throw new Error('LINK_EXPIRED');}
  if(fragment.has('access_token')){
   history.replaceState(null,'',location.pathname+location.search);
   if(!fragment.get('refresh_token'))throw new Error('INVALID_SESSION');
   authGeneration++;hideResult();saveSession(normalizedSession(Object.fromEntries(fragment)));
  }else{try{const saved=JSON.parse(localStorage.getItem(sessionKey));if(saved?.access_token&&saved?.refresh_token)session=saved;}catch{}}
  if(!session){loggedOut();return;}
  const token=await accessToken();user=await request('/auth/v1/user',{token});
  el('login-form').hidden=true;el('account').hidden=false;el('account-email').textContent=user.email;
  await loadMembership();
  await loadAdminLink();
 }catch(error){
  if(error.status===401||error.status===400||error.message==='LINK_EXPIRED'||error.message==='INVALID_SESSION'){
   loggedOut();el('login-status').textContent='ログインリンクの期限切れ、または認証情報が無効です。メールを送り直してください。';
  }else if(!session){loggedOut();}else{el('status').textContent=explain(error);}
 }
}
window.addEventListener('storage',event=>{if(event.key===sessionKey){authGeneration++;user=null;session=null;hideResult();el('draw').disabled=true;if(el('admin-link'))el('admin-link').hidden=true;initialize();}});
window.addEventListener('hashchange',()=>{if(location.hash)initialize();});
initialize();
